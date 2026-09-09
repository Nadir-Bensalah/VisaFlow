-- 0070 · La grille Essai / Active / Premium.
--
-- La grille de 0049 vendait 45 DT par utilisateur et par mois, et rien
-- d'autre. Elle avait un défaut de fond : elle faisait payer le compte, alors
-- que ce qui coûte à la plateforme, c'est l'agence (son support, ses bureaux,
-- ses fichiers), pas la personne qui s'y connecte. Une agence de deux
-- personnes payait 90 DT, une grande de vingt-cinq payait 1 125 DT : la
-- première était sous-vendue, la seconde était invendable.
--
-- LA DÉCISION DU 9 SEPTEMBRE 2026, tous prix hors taxes :
--
--   · Essai   : 0, quinze jours, tout ouvert, borné en volume (10 comptes,
--               30 dossiers, 2 Go) pour qu'un essai abandonné ne laisse pas
--               20 Go de photos dans le seau.
--   · Active  : 179 DT par mois, un bureau, quatre comptes, tout le métier.
--               Un compte en plus : 35 DT. Un bureau en plus : 119 DT, qui
--               apporte 2 comptes, 75 dossiers, 50 cargaisons et 6 Go.
--   · Premium : 890 DT par mois, bureaux et comptes sans limite (usage
--               raisonnable : 60 comptes, 15 bureaux), marque blanche, API,
--               rapports avancés, rôles sur mesure.
--   · En euros, pour l'export : 59 / 11 / 39 / 289.
--
-- Annuel = mensuel × 12, sans mois offert. Le semestre existe, à +10 %.
-- Les remises (lancement, FTAV) sont plafonnées à 15 % et ne se cumulent pas.
--
-- CE QUE CE FICHIER FAIT, ET CE QU'IL NE FAIT PAS :
--
--   · Il ajoute des colonnes à `plans` et à `subscriptions`. Il n'en retire
--     aucune : `price_per_user_month` reste, six modules la lisent, elle vaut
--     zéro sur les nouveaux plans.
--   · Il remplace des fonctions par `create or replace`, en recopiant leur
--     dernière version (0049, 0055, 0066, 0068) et en n'y changeant que ce
--     qui touche au montant.
--   · Il migre les souscriptions vivantes des anciens plans vers la grille
--     neuve. Les résiliées gardent leur histoire.
--   · Il compte l'usage EN DIRECT (`agency_usage`, `platform_agency_usage`)
--     pour que l'agence et la console voient les limites sans attendre la
--     tâche de nuit.
--   · Il ne touche pas au cycle de 0066 : essai, grâce, suspension,
--     règlement constaté. Il s'y branche.
--   · Rien, nulle part, n'encaisse. Toujours.
--
-- LA DEVISE EST UNE LIGNE DE PLAN, PAS UN TAUX. Les prix en euros sont des
-- prix commerciaux arrondis (59 €, pas 52,86 × 1,10) : ils s'affichent tels
-- quels et se révisent à part. La clé de `plans` devient (code, devise), et
-- une souscription porte sa devise par son plan.
--
-- LE PRIX EST FIGÉ À LA SIGNATURE, comme avant. Les prix du socle, du compte
-- et du bureau sont recopiés du plan dans la souscription au moment où on la
-- pose. Une hausse de la grille ne rattrape pas une agence en cours d'année.
-- Ils se relisent du plan dans trois cas seulement : à la création, au
-- changement de plan, et quand une échéance nouvelle est signée (le
-- renouvellement se fait au prix de la grille en vigueur).

-- ------------------------------------------------------------------
-- 1 · La table `plans` : les colonnes de la grille
-- ------------------------------------------------------------------
--
-- Les colonnes `max_*` changent de sens : elles disent ce que le SOCLE
-- inclut. La limite effective d'une agence = socle + ajouts (section 6).
-- `null` veut toujours dire illimité.

alter table plans
  add column if not exists base_price_month             numeric(10,3) not null default 0,
  add column if not exists extra_user_price_month       numeric(10,3),
  add column if not exists extra_office_price_month     numeric(10,3),
  add column if not exists office_included_users        int not null default 0,
  add column if not exists office_included_cases        int not null default 0,
  add column if not exists office_included_shipments    int not null default 0,
  add column if not exists office_included_storage_mb   int not null default 0,
  add column if not exists extra_user_storage_mb        int not null default 0,
  add column if not exists fair_use_users               int,
  add column if not exists fair_use_offices             int,
  add column if not exists fair_use_storage_mb_per_user int,
  add column if not exists fair_use_storage_min_mb      int,
  add column if not exists emails_per_case_month        int,
  add column if not exists emails_min_month             int,
  add column if not exists egress_gb_per_user_month     int,
  add column if not exists support_hours_month          numeric(4,1),
  add column if not exists office_support_hours_month   numeric(4,1),
  add column if not exists semester_allowed             boolean not null default false,
  add column if not exists semester_factor              numeric(4,3) not null default 1.100;

comment on column plans.price_per_user_month is
  'Obsolète depuis 0070, voir base_price_month. Vaut 0 sur les plans de la grille Active / Premium. Conservée parce que six modules la lisent.';
comment on column plans.base_price_month is
  'Le prix mensuel du socle, hors taxes. C''est la base tarifaire depuis 0070.';
comment on column plans.extra_user_price_month is
  'Le prix mensuel d''un compte en plus. null = pas d''ajout possible (essai, premium).';
comment on column plans.extra_office_price_month is
  'Le prix mensuel d''un bureau en plus. null = pas d''ajout possible.';
comment on column plans.max_users is
  'Les comptes que le socle inclut. La limite effective ajoute les comptes achetés et ceux des bureaux en plus. null = illimité.';
comment on column plans.fair_use_users is
  'Usage raisonnable de Premium. Signalé dans la console, jamais gardé.';
comment on column plans.semester_factor is
  'Le semestre = mensuel × 6 × ce facteur. 1,100 : l''option semestrielle coûte dix pour cent de plus.';

-- La contrainte des codes est inline dans 0049 : on la retrouve par son nom
-- dans pg_constraint, on la supprime, on la recrée. Les quatre codes anciens
-- restent acceptés pour les lignes historiques.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'plans'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%code%'
  loop
    execute format('alter table plans drop constraint %I', c);
  end loop;
end $$;
alter table plans add constraint plans_code_check
  check (code in ('essai','active','premium','starter','pro','business','enterprise'));

-- Le semestre entre dans les périodes. `mensuel` reste accepté pour les
-- lignes anciennes, il n'est plus proposé.
alter table plans drop constraint if exists plans_billing_period_check;
alter table plans add constraint plans_billing_period_check
  check (billing_period in ('annuel','mensuel','semestriel'));

-- La clé devient (code, devise) : une ligne par formule et par devise.
alter table plans drop constraint if exists plans_code_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plans_code_currency_key') then
    alter table plans add constraint plans_code_currency_key unique (code, currency);
  end if;
end $$;

-- Les six lignes de la grille. Rejouable : `on conflict` remet les valeurs
-- de la décision, y compris si quelqu'un les a touchées à la main. La ligne
-- `essai` en TND est celle de 0049 : elle garde son identifiant, et les
-- souscriptions d'essai qui pointent dessus ne bougent pas.
insert into plans (code, name, currency, price_per_user_month, billing_period,
                   base_price_month, extra_user_price_month, extra_office_price_month,
                   max_offices, max_users, max_active_cases, max_active_shipments, max_storage_mb,
                   office_included_users, office_included_cases, office_included_shipments,
                   office_included_storage_mb, extra_user_storage_mb,
                   fair_use_users, fair_use_offices, fair_use_storage_mb_per_user, fair_use_storage_min_mb,
                   emails_per_case_month, emails_min_month, egress_gb_per_user_month,
                   support_hours_month, office_support_hours_month,
                   semester_allowed, semester_factor, trial_days, grace_days, active, position, note)
values
  ('essai', 'Essai', 'TND', 0, 'annuel',
   0, null, null,
   1, 10, 30, 10, 2048,
   0, 0, 0, 0, 0,
   null, null, null, null,
   20, null, 10,
   0, null,
   false, 1.100, 15, 7, true, 0,
   'Quinze jours, tout ouvert, sans carte. Borné en volume pour qu''un essai abandonné ne pèse rien.'),
  ('active', 'Active', 'TND', 0, 'annuel',
   179, 35, 119,
   1, 4, 150, 100, 12288,
   2, 75, 50, 6144, 3072,
   null, null, null, null,
   20, null, 10,
   2, 1,
   true, 1.100, 0, 7, true, 1,
   'Un bureau, quatre comptes, tout le métier. Un compte de plus pour 35, un bureau de plus pour 119.'),
  ('premium', 'Premium', 'TND', 0, 'annuel',
   890, null, null,
   null, null, null, null, null,
   0, 0, 0, 0, 0,
   60, 15, 4096, 61440,
   20, 5000, 10,
   6, null,
   true, 1.100, 0, 7, true, 2,
   'La grande agence et le réseau : bureaux et comptes sans limite, marque blanche, API, rapports avancés, support prioritaire.'),
  ('essai', 'Essai', 'EUR', 0, 'annuel',
   0, null, null,
   1, 10, 30, 10, 2048,
   0, 0, 0, 0, 0,
   null, null, null, null,
   20, null, 10,
   0, null,
   false, 1.100, 15, 7, true, 0,
   'Quinze jours, tout ouvert, sans carte. Borné en volume pour qu''un essai abandonné ne pèse rien.'),
  ('active', 'Active', 'EUR', 0, 'annuel',
   59, 11, 39,
   1, 4, 150, 100, 12288,
   2, 75, 50, 6144, 3072,
   null, null, null, null,
   20, null, 10,
   2, 1,
   true, 1.100, 0, 7, true, 1,
   'Un bureau, quatre comptes, tout le métier. Un compte de plus pour 11, un bureau de plus pour 39.'),
  ('premium', 'Premium', 'EUR', 0, 'annuel',
   289, null, null,
   null, null, null, null, null,
   0, 0, 0, 0, 0,
   60, 15, 4096, 61440,
   20, 5000, 10,
   6, null,
   true, 1.100, 0, 7, true, 2,
   'La grande agence et le réseau : bureaux et comptes sans limite, marque blanche, API, rapports avancés, support prioritaire.')
on conflict (code, currency) do update set
  name = excluded.name,
  price_per_user_month = excluded.price_per_user_month,
  billing_period = excluded.billing_period,
  base_price_month = excluded.base_price_month,
  extra_user_price_month = excluded.extra_user_price_month,
  extra_office_price_month = excluded.extra_office_price_month,
  max_offices = excluded.max_offices,
  max_users = excluded.max_users,
  max_active_cases = excluded.max_active_cases,
  max_active_shipments = excluded.max_active_shipments,
  max_storage_mb = excluded.max_storage_mb,
  office_included_users = excluded.office_included_users,
  office_included_cases = excluded.office_included_cases,
  office_included_shipments = excluded.office_included_shipments,
  office_included_storage_mb = excluded.office_included_storage_mb,
  extra_user_storage_mb = excluded.extra_user_storage_mb,
  fair_use_users = excluded.fair_use_users,
  fair_use_offices = excluded.fair_use_offices,
  fair_use_storage_mb_per_user = excluded.fair_use_storage_mb_per_user,
  fair_use_storage_min_mb = excluded.fair_use_storage_min_mb,
  emails_per_case_month = excluded.emails_per_case_month,
  emails_min_month = excluded.emails_min_month,
  egress_gb_per_user_month = excluded.egress_gb_per_user_month,
  support_hours_month = excluded.support_hours_month,
  office_support_hours_month = excluded.office_support_hours_month,
  semester_allowed = excluded.semester_allowed,
  semester_factor = excluded.semester_factor,
  trial_days = excluded.trial_days,
  grace_days = excluded.grace_days,
  active = excluded.active,
  position = excluded.position,
  note = excluded.note;

-- Les anciens plans sortent de la vente. Ils restent pour l'histoire.
update plans set active = false, note = coalesce(note, '') || ' Retiré de la grille en 0070.'
where code in ('starter','pro','business','enterprise') and active;

-- Ce que chaque formule ouvre. Essai et Premium ouvrent tout ; Active ouvre
-- le métier, le portail, le commercial, WhatsApp et la comptabilité. WhatsApp
-- n'a pas de plafond : le compte Meta est celui de l'agence, Meta la facture.
delete from plan_features pf using plans p
where p.id = pf.plan_id and p.code in ('essai','active','premium');

insert into plan_features (plan_id, feature_id, limit_value)
select p.id, f.id, null
from plans p
join features f on (p.code in ('essai','premium')
                    or f.code in ('VISA','CARGO','CLIENT_PORTAL','CRM','WHATSAPP','ACCOUNTING'))
where p.code in ('essai','active','premium')
on conflict do nothing;

-- ------------------------------------------------------------------
-- 2 · La souscription : les ajouts, les prix figés, la remise
-- ------------------------------------------------------------------

alter table subscriptions
  add column if not exists extra_users              int not null default 0 check (extra_users >= 0),
  add column if not exists extra_offices            int not null default 0 check (extra_offices >= 0),
  add column if not exists base_price_month         numeric(10,3) not null default 0,
  add column if not exists extra_user_price_month   numeric(10,3),
  add column if not exists extra_office_price_month numeric(10,3),
  add column if not exists discount_pct             numeric(5,2) not null default 0
                                                    check (discount_pct between 0 and 15),
  add column if not exists discount_label           text,
  add column if not exists discount_until           date;

comment on column subscriptions.extra_users is 'Les comptes en plus signés, au-delà de ceux du socle et des bureaux.';
comment on column subscriptions.extra_offices is 'Les bureaux en plus signés.';
comment on column subscriptions.base_price_month is 'Le prix du socle, figé à la signature, copié du plan.';
comment on column subscriptions.discount_pct is 'Remise de lancement ou FTAV, jamais les deux. Plafond 15.';
comment on column subscriptions.discount_until is 'Fin de la remise. Lancement : fin de la première période. null = sans fin.';
comment on column subscriptions.seats is
  'Les comptes autorisés, calculés à chaque écriture : socle + comptes achetés + comptes des bureaux en plus. Premium : les comptes actifs réels, à titre indicatif.';

alter table subscriptions drop constraint if exists subscriptions_billing_period_check;
alter table subscriptions add constraint subscriptions_billing_period_check
  check (billing_period in ('annuel','mensuel','semestriel'));

-- Le journal apprend deux moments : le prorata d'un ajout se lit dans
-- `changement_plan`, et le dépassement d'usage raisonnable de Premium a sa
-- propre entrée.
alter table subscription_events drop constraint if exists subscription_events_kind_check;
alter table subscription_events add constraint subscription_events_kind_check
  check (kind in ('creee','changement_plan','renouvelee','suspendue','reactivee',
                  'resiliee','quota_depasse','usage_raisonnable',
                  'entree_grace','impayee','avertissement','paiement'));

-- ------------------------------------------------------------------
-- 3 · Les taux de la facture, dans les réglages
-- ------------------------------------------------------------------
--
-- La TVA (19 % en pratique, 13 % si la note DGELF 3411 s'applique) et la
-- retenue à la source (1 %, 1,5 % pour une personne physique) ne sont pas
-- écrites dans une fonction : l'expert-comptable n'a pas encore tranché, et
-- on ne redéploie pas une migration pour un taux.

alter table billing_settings
  add column if not exists vat_rate         numeric(5,4) not null default 0.19,
  add column if not exists withholding_rate numeric(5,4) not null default 0.01;

comment on column billing_settings.vat_rate is
  'Le taux de TVA appliqué aux factures en TND. 0,19 par défaut, à faire trancher par l''expert-comptable.';
comment on column billing_settings.withholding_rate is
  'La retenue à la source que le client déduit du TTC. 0,01 par défaut. Le règlement est complet au net à payer.';

-- ------------------------------------------------------------------
-- 4 · Les compteurs : depuis quand on dépasse, et les compteurs du mois
-- ------------------------------------------------------------------

alter table usage_counters
  add column if not exists over_since_cases     date,
  add column if not exists over_since_shipments date,
  add column if not exists over_since_storage   date,
  add column if not exists emails_month         int not null default 0,
  add column if not exists egress_bytes_month   bigint not null default 0,
  add column if not exists month_started_on     date not null default date_trunc('month', current_date)::date;

comment on column usage_counters.over_since_cases is
  'Le premier jour où les dossiers actifs ont atteint la limite. null sous la limite. C''est ce qui fait tomber le blocage à trente jours.';
comment on column usage_counters.emails_month is
  'Les courriels sortants du mois. Remis à zéro le premier par refresh_usage.';
comment on column usage_counters.egress_bytes_month is
  'La sortie réseau du mois, en octets. Remise à zéro le premier par refresh_usage.';

-- ------------------------------------------------------------------
-- 5 · Lire la souscription vivante, et calculer le mensuel
-- ------------------------------------------------------------------

-- La souscription qui compte : la vivante, à défaut la dernière résiliée. La
-- même règle qu'`agency_plan` et `agency_access_state`, écrite une fois.
create or replace function agency_live_subscription(p_agency uuid)
returns subscriptions
language sql stable security definer set search_path = public as $$
  select x.* from subscriptions x
  where x.agency_id = p_agency
  order by (x.status = 'resiliee'), x.started_on desc, x.created_at desc
  limit 1
$$;

-- Ce qu'un compte lit de l'argent d'une agence : le sien, celui de la
-- plateforme, ou rien. Sans session (tâche planifiée, autre fonction
-- SECURITY DEFINER), le test ne s'applique pas : même convention qu'en 0066.
-- Écrit en `case` et pas en `or` : l'ordre d'évaluation d'un `or` n'est pas
-- garanti, et `auth_agency_id()` lit les revendications du jeton, qu'un
-- compte de plateforme n'a pas forcément.
create or replace function agency_money_readable(p_agency uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then true
    when is_platform_admin() then true
    else p_agency = auth_agency_id()
  end
$$;

-- La formule de la section 5.3, sur un plan de la grille et des nombres de
-- comptes et de bureaux. Elle sert à l'estimation publique, aux demandes de
-- souscription et au potentiel des essais. null si le plan n'existe pas.
create or replace function plan_monthly_amount(
  p_code text, p_currency text, p_users int, p_offices int
) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare p plans; v_bureaux int; v_inclus int; v_comptes int;
begin
  select * into p from plans
   where code = p_code and currency = upper(coalesce(nullif(trim(p_currency), ''), 'TND')) and active;
  if p.id is null then return null; end if;
  if p.code = 'essai' then return 0; end if;
  if p.code = 'premium' then return p.base_price_month; end if;
  v_bureaux := greatest(0, coalesce(p_offices, 1) - coalesce(p.max_offices, 1));
  v_inclus  := coalesce(p.max_users, 0) + v_bureaux * p.office_included_users;
  v_comptes := greatest(0, coalesce(p_users, 1) - v_inclus);
  return p.base_price_month
       + v_bureaux * coalesce(p.extra_office_price_month, 0)
       + v_comptes * coalesce(p.extra_user_price_month, 0);
end $$;

-- L'estimation de la page publique et des demandes (section 5.7) : la
-- formule conseillée, son mensuel, son annuel, et les deux prix côte à côte.
create or replace function plan_estimate(p_users int, p_offices int, p_currency text default 'TND')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cur text := upper(coalesce(nullif(trim(p_currency), ''), 'TND'));
  v_users int := greatest(1, coalesce(p_users, 1));
  v_offices int := greatest(1, coalesce(p_offices, 1));
  v_active numeric; v_premium numeric; v_plan text; v_month numeric; v_devis boolean;
  v_bureaux int; v_comptes int;
begin
  v_active  := plan_monthly_amount('active', v_cur, v_users, v_offices);
  v_premium := plan_monthly_amount('premium', v_cur, v_users, v_offices);
  if v_active is null or v_premium is null then return null; end if;
  v_devis := v_users > 60 or v_offices > 15;
  v_plan := case when v_offices >= 7 or v_active >= v_premium or v_devis then 'premium' else 'active' end;
  v_month := case v_plan when 'premium' then v_premium else v_active end;
  v_bureaux := greatest(0, v_offices - 1);
  v_comptes := greatest(0, v_users - 4 - 2 * v_bureaux);
  return jsonb_build_object(
    'plan', v_plan,
    'currency', v_cur,
    'monthly', v_month,
    'annual', v_month * 12,
    'active_monthly', v_active,
    'premium_monthly', v_premium,
    'extra_offices', v_bureaux,
    'extra_users', v_comptes,
    'devis', v_devis
  );
end $$;

-- Le mensuel d'UNE ligne de souscription, aux prix figés de la ligne. Une
-- ligne restée sur un ancien plan (résiliée avant 0070) garde sa formule
-- d'avant : sièges × prix par utilisateur. C'est ce qui permet de relire le
-- MRR des douze derniers mois sans réécrire l'histoire.
create or replace function subscription_row_monthly_amount(s subscriptions)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v_code text;
begin
  if s.id is null or s.status = 'essai' then return 0; end if;
  select code into v_code from plans where id = s.plan_id;
  if v_code is null or v_code = 'essai' then return 0; end if;
  if v_code = 'premium' then return coalesce(s.base_price_month, 0); end if;
  if v_code in ('starter','pro','business','enterprise') then
    return round(coalesce(s.seats, 0) * coalesce(s.price_per_user_month, 0), 3);
  end if;
  return round(coalesce(s.base_price_month, 0)
             + coalesce(s.extra_offices, 0) * coalesce(s.extra_office_price_month, 0)
             + coalesce(s.extra_users, 0) * coalesce(s.extra_user_price_month, 0), 3);
end $$;

-- Le mensuel d'une agence : sa souscription vivante, aux prix figés. Un essai
-- ou une agence résiliée ne doit rien.
create or replace function subscription_monthly_amount(p_agency uuid)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare s subscriptions;
begin
  if not agency_money_readable(p_agency) then return 0; end if;
  select * into s from subscriptions
   where agency_id = p_agency and status <> 'resiliee'
   order by started_on desc, created_at desc limit 1;
  if s.id is null then return 0; end if;
  return subscription_row_monthly_amount(s);
end $$;

comment on function subscription_monthly_amount(uuid) is
  'Le mensuel hors taxes d''une agence : socle + bureaux en plus + comptes en plus, aux prix figés à la signature. Un essai ne doit rien.';

-- ------------------------------------------------------------------
-- 6 · Le montant de la facture, ses lignes, ses totaux
-- ------------------------------------------------------------------

-- Le montant hors taxes de la facture : douze mois payés, aucun mois offert.
-- Le semestre coûte dix pour cent de plus, arrondi au dinar. La remise
-- s'applique tant que `discount_until` n'est pas dépassée.
create or replace function subscription_invoice_amount(p_agency uuid)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare s subscriptions; p plans; v_mensuel numeric; v_brut numeric;
begin
  if not agency_money_readable(p_agency) then return 0; end if;
  select * into s from subscriptions
   where agency_id = p_agency and status <> 'resiliee'
   order by started_on desc, created_at desc limit 1;
  -- Pas de souscription, ou un essai : rien n'est dû.
  if s.id is null or s.status = 'essai' then return 0; end if;
  select * into p from plans where id = s.plan_id;
  v_mensuel := subscription_row_monthly_amount(s);
  if s.billing_period = 'semestriel' then
    v_brut := round(v_mensuel * 6 * coalesce(p.semester_factor, 1.100), 0);
  else
    v_brut := v_mensuel * 12;
  end if;
  if coalesce(s.discount_pct, 0) > 0
     and (s.discount_until is null or s.discount_until >= current_date) then
    return round(v_brut * (1 - s.discount_pct / 100), 3);
  end if;
  return round(v_brut, 3);
end $$;

comment on function subscription_invoice_amount(uuid) is
  'Le montant hors taxes de la facture en cours : mensuel × 12 (ou × 6 × 1,10 au semestre), remise déduite tant qu''elle court. Un essai ne doit rien.';

-- Les lignes que la facture TTN imprime, en unités, pour la banque du client
-- et pour l''export : « 12 mois de licence Active à 179 », « 2 comptes × 12
-- mois à 35 ». Au semestre, la ligne du socle absorbe l'arrondi au dinar pour
-- que la somme des lignes soit exactement le montant facturé.
create or replace function subscription_invoice_lines(p_agency uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s subscriptions; p plans; v_mois int; v_f numeric; v_lines jsonb := '[]'::jsonb;
  v_brut numeric; v_bureaux numeric := 0; v_comptes numeric := 0; v_socle numeric;
  v_pu numeric; v_po numeric; v_pb numeric; v_remise numeric;
begin
  if not agency_money_readable(p_agency) then return '[]'::jsonb; end if;
  select * into s from subscriptions
   where agency_id = p_agency and status <> 'resiliee'
   order by started_on desc, created_at desc limit 1;
  if s.id is null or s.status = 'essai' then return '[]'::jsonb; end if;
  select * into p from plans where id = s.plan_id;
  if p.code = 'essai' then return '[]'::jsonb; end if;

  v_mois := case when s.billing_period = 'semestriel' then 6 else 12 end;
  v_f := case when s.billing_period = 'semestriel' then coalesce(p.semester_factor, 1.100) else 1 end;
  v_brut := case when s.billing_period = 'semestriel'
                 then round(subscription_row_monthly_amount(s) * 6 * v_f, 0)
                 else subscription_row_monthly_amount(s) * 12 end;

  v_pb := round(coalesce(s.base_price_month, 0) * v_f, 3);
  v_po := round(coalesce(s.extra_office_price_month, 0) * v_f, 3);
  v_pu := round(coalesce(s.extra_user_price_month, 0) * v_f, 3);

  if p.code not in ('premium') and coalesce(s.extra_offices, 0) > 0 then
    v_bureaux := round(s.extra_offices * v_mois * v_po, 3);
    v_lines := v_lines || jsonb_build_object(
      'label', 'Bureau supplémentaire, mois' || case when v_f <> 1 then ' (option semestrielle)' else '' end,
      'quantity', s.extra_offices * v_mois, 'unit_price', v_po, 'total', v_bureaux, 'kind', 'bureau');
  end if;
  if p.code not in ('premium') and coalesce(s.extra_users, 0) > 0 then
    v_comptes := round(s.extra_users * v_mois * v_pu, 3);
    v_lines := v_lines || jsonb_build_object(
      'label', 'Compte supplémentaire, mois' || case when v_f <> 1 then ' (option semestrielle)' else '' end,
      'quantity', s.extra_users * v_mois, 'unit_price', v_pu, 'total', v_comptes, 'kind', 'compte');
  end if;

  -- Le socle en tête, et il porte l'arrondi du semestre.
  v_socle := round(v_brut - v_bureaux - v_comptes, 3);
  v_lines := jsonb_build_array(jsonb_build_object(
      'label', 'Licence ' || p.name || ', mois' || case when v_f <> 1 then ' (option semestrielle)' else '' end,
      'quantity', v_mois, 'unit_price', v_pb, 'total', v_socle, 'kind', 'socle')) || v_lines;

  if coalesce(s.discount_pct, 0) > 0
     and (s.discount_until is null or s.discount_until >= current_date) then
    v_remise := round(v_brut * (1 - s.discount_pct / 100), 3) - v_brut;
    v_lines := v_lines || jsonb_build_object(
      'label', 'Remise « ' || coalesce(s.discount_label, 'commerciale') || ' »',
      'quantity', 1, 'unit_price', -s.discount_pct, 'total', v_remise, 'kind', 'remise');
  end if;
  return v_lines;
end $$;

comment on function subscription_invoice_lines(uuid) is
  'Les lignes de la facture TTN, en unités : socle, bureaux, comptes, remise. Leur somme est le montant hors taxes.';

-- Les totaux de la facture : hors taxes, TVA, TTC, retenue à la source, net
-- à payer. En euros (export de services), ni TVA ni retenue : le client
-- retient selon la loi de son pays, à sa charge, et le prix reste net.
create or replace function subscription_invoice_totals(p_agency uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s subscriptions; v_ht numeric; v_tva_rate numeric; v_ret_rate numeric;
  v_tva numeric; v_ttc numeric; v_ret numeric; v_cur text; v_period text;
begin
  if not agency_money_readable(p_agency) then
    return jsonb_build_object('currency', 'TND', 'ht', 0, 'tva_rate', 0, 'tva', 0, 'ttc', 0,
                              'withholding_rate', 0, 'retenue', 0, 'net_a_payer', 0,
                              'period', 'annuel', 'monthly', 0);
  end if;
  select * into s from subscriptions
   where agency_id = p_agency and status <> 'resiliee'
   order by started_on desc, created_at desc limit 1;
  v_cur := coalesce(s.currency, 'TND');
  v_period := case when s.billing_period = 'semestriel' then 'semestriel' else 'annuel' end;
  v_ht := subscription_invoice_amount(p_agency);
  if v_cur = 'TND' then
    select coalesce(b.vat_rate, 0.19), coalesce(b.withholding_rate, 0.01)
      into v_tva_rate, v_ret_rate from billing_settings b where b.id;
    v_tva_rate := coalesce(v_tva_rate, 0.19);
    v_ret_rate := coalesce(v_ret_rate, 0.01);
  else
    v_tva_rate := 0; v_ret_rate := 0;
  end if;
  v_tva := round(v_ht * v_tva_rate, 3);
  v_ttc := round(v_ht + v_tva, 3);
  v_ret := round(v_ttc * v_ret_rate, 3);
  return jsonb_build_object(
    'currency', v_cur,
    'ht', v_ht,
    'tva_rate', v_tva_rate,
    'tva', v_tva,
    'ttc', v_ttc,
    'withholding_rate', v_ret_rate,
    'retenue', v_ret,
    'net_a_payer', round(v_ttc - v_ret, 3),
    'period', v_period,
    'monthly', subscription_monthly_amount(p_agency)
  );
end $$;

comment on function subscription_invoice_totals(uuid) is
  'HT, TVA, TTC, retenue à la source et net à payer de la facture en cours. Les taux viennent de billing_settings. En euros, TVA et retenue valent zéro.';

-- Ce qu'il reste à régler sur la période en cours : le net à payer moins les
-- règlements dont la période couvre aujourd'hui. Jamais négatif. C'est ce qui
-- empêche qu'une retenue à la source de 25 DT soit lue comme un impayé, et
-- ce qui fait apparaître un demi-virement comme un solde, pas comme un
-- règlement complet.
create or replace function subscription_balance(p_agency uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s subscriptions; v_net numeric; v_regle numeric; v_last date;
begin
  if not agency_money_readable(p_agency) then
    return jsonb_build_object('net_a_payer', 0, 'regle', 0, 'solde_du', 0, 'dernier_reglement_le', null);
  end if;
  s := agency_live_subscription(p_agency);
  select max(recorded_at)::date into v_last from subscription_payments where agency_id = p_agency;
  if s.id is null or s.status in ('essai','resiliee') then
    return jsonb_build_object('net_a_payer', 0, 'regle', 0, 'solde_du', 0, 'dernier_reglement_le', v_last);
  end if;
  v_net := coalesce((subscription_invoice_totals(p_agency) ->> 'net_a_payer')::numeric, 0);
  select coalesce(sum(amount), 0) into v_regle
    from subscription_payments
   where subscription_id = s.id
     and period_start <= current_date and period_end >= current_date;
  return jsonb_build_object(
    'net_a_payer', v_net,
    'regle', v_regle,
    -- Un dinar de tolérance, le même qu'au règlement : l'arrondi bancaire
    -- n'est pas un solde.
    'solde_du', case when v_net - v_regle < 1 then 0 else round(v_net - v_regle, 3) end,
    'dernier_reglement_le', v_last
  );
end $$;

-- ------------------------------------------------------------------
-- 7 · Les quotas : socle + ajouts, le garde qui cite le prix, le palier doux
-- ------------------------------------------------------------------

-- La limite effective d'une ressource : ce que le socle inclut, plus les
-- ajouts signés. Si la colonne du plan est nulle (Premium), la limite est
-- nulle, quels que soient les ajouts. En octets pour le stockage.
create or replace function quota_limit(p_agency uuid, p_resource text)
returns bigint
language plpgsql stable security definer set search_path = public as $$
declare s subscriptions; p plans; v_xu int := 0; v_xo int := 0;
begin
  s := agency_live_subscription(p_agency);
  if s.id is null then
    select * into p from plans where code = 'essai' and currency = 'TND' order by active desc limit 1;
  else
    select * into p from plans where id = s.plan_id;
    v_xu := coalesce(s.extra_users, 0);
    v_xo := coalesce(s.extra_offices, 0);
  end if;
  return case p_resource
    when 'users'     then case when p.max_users is null then null
                               else p.max_users + v_xu + v_xo * coalesce(p.office_included_users, 0) end
    when 'offices'   then case when p.max_offices is null then null
                               else p.max_offices + v_xo end
    when 'clients'   then null          -- aucun plan ne plafonne les clients
    when 'cases'     then case when p.max_active_cases is null then null
                               else p.max_active_cases + v_xo * coalesce(p.office_included_cases, 0) end
    when 'shipments' then case when p.max_active_shipments is null then null
                               else p.max_active_shipments + v_xo * coalesce(p.office_included_shipments, 0) end
    when 'storage'   then case when p.max_storage_mb is null then null
                               else (p.max_storage_mb
                                     + v_xu * coalesce(p.extra_user_storage_mb, 0)
                                     + v_xo * coalesce(p.office_included_storage_mb, 0))::bigint * 1024 * 1024 end
    else null
  end;
end $$;

-- Le garde dur des comptes et des bureaux. Il lève, il ne signale pas, et son
-- message cite le prix de l'ajout : l'agence sait tout de suite ce que coûte
-- le compte de plus, et le super-admin l'ajoute en une minute.
create or replace function quota_guard(p_agency uuid, p_resource text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lim bigint; v_use bigint; s subscriptions; p plans; v_prix numeric; v_dev text; v_code text;
begin
  v_lim := quota_limit(p_agency, p_resource);
  if v_lim is null then return; end if;
  v_use := coalesce(quota_used(p_agency, p_resource), 0);
  -- Appelé AVANT l'insertion : la ligne en cours n'est pas encore comptée.
  -- Atteindre la limite suffit donc à refuser la suivante.
  if v_use < v_lim then return; end if;

  s := agency_live_subscription(p_agency);
  if s.id is not null then select * into p from plans where id = s.plan_id; end if;
  v_code := coalesce(p.code, 'essai');
  v_dev := case coalesce(s.currency, p.currency, 'TND') when 'TND' then 'DT' else coalesce(s.currency, p.currency) end;

  if p_resource = 'users' then
    v_prix := case when s.id is null then null
                   else coalesce(s.extra_user_price_month, p.extra_user_price_month) end;
    if v_prix is not null then
      raise exception '% comptes sur %, un compte de plus coûte % % par mois',
        v_use, v_lim, rtrim(rtrim(v_prix::text, '0'), '.'), v_dev
        using errcode = 'P0001';
    end if;
    raise exception '% comptes sur % : l''essai est borné en volume, passez en Active pour en ouvrir davantage',
      v_use, v_lim using errcode = 'P0001';
  elsif p_resource = 'offices' then
    v_prix := case when s.id is null then null
                   else coalesce(s.extra_office_price_month, p.extra_office_price_month) end;
    if v_prix is not null then
      raise exception '% bureaux sur %, un bureau de plus coûte % % par mois',
        v_use, v_lim, rtrim(rtrim(v_prix::text, '0'), '.'), v_dev
        using errcode = 'P0001';
    end if;
    raise exception '% bureaux sur % : l''essai est borné en volume, passez en Active pour en ouvrir davantage',
      v_use, v_lim using errcode = 'P0001';
  end if;

  raise exception 'quota atteint : % (% sur %), plan %', p_resource, v_use, v_lim, v_code
    using errcode = 'P0001';
end $$;

-- Les deux déclencheurs du garde, recopiés de 0049 avec une exception de
-- plus : SANS SESSION, le garde ne s'applique pas. Sans session, personne ne
-- clique : ce sont les bancs, les jeux de données et la clé de service, qui
-- posent des agences à plusieurs bureaux d'un trait. L'essai est borné à un
-- bureau pour l'agence qui essaie, pas pour l'outil qui la prépare. Le
-- premier bureau et le premier compte passent toujours, comme avant.
create or replace function guard_office_quota() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not exists (select 1 from offices where agency_id = new.agency_id) then
    return new;
  end if;
  perform quota_guard(new.agency_id, 'offices');
  return new;
end $$;

create or replace function guard_profile_quota() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not exists (select 1 from profiles where agency_id = new.agency_id) then
    return new;
  end if;
  -- Réactiver quelqu'un n'est pas une insertion : le garde ne voit que les
  -- comptes neufs. Le dépassement par réactivation se voit dans la console.
  if not coalesce(new.active, true) then return new; end if;
  perform quota_guard(new.agency_id, 'users');
  return new;
end $$;

-- Le palier doux des dossiers, des cargaisons et du stockage. Pas de garde :
-- un niveau, et une date. `info` à 80 %, `attention` à 100 %, `bloque` à
-- 120 % ou à 100 % depuis plus de trente jours. Le front refuse alors la
-- seule création ; consulter, modifier, clôturer, envoyer continuent.
--
-- Premium n'a pas de limite : on compare à l'usage raisonnable, et le niveau
-- ne dépasse jamais `attention`. C'est une conversation, pas un mur.
create or replace function quota_soft_state(p_agency uuid, p_resource text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s subscriptions; p plans; v_premium boolean := false;
  v_lim bigint; v_use bigint; v_pct numeric; v_depuis date; v_niveau text; u usage_counters;
begin
  if p_resource not in ('users','offices','cases','shipments','storage') then
    raise exception 'ressource inconnue : %', p_resource using errcode = 'P0001';
  end if;
  if not agency_money_readable(p_agency) then
    return jsonb_build_object('niveau', 'ok', 'depuis', null, 'used', 0, 'limit', null, 'pct', null);
  end if;

  s := agency_live_subscription(p_agency);
  if s.id is not null then
    select * into p from plans where id = s.plan_id;
    v_premium := p.code = 'premium';
  end if;
  v_use := coalesce(quota_used(p_agency, p_resource), 0);

  if v_premium then
    v_lim := case p_resource
      when 'users'   then p.fair_use_users
      when 'offices' then p.fair_use_offices
      when 'storage' then case when p.fair_use_storage_min_mb is null and p.fair_use_storage_mb_per_user is null then null
                               else greatest(coalesce(p.fair_use_storage_mb_per_user, 0)
                                               * coalesce(quota_used(p_agency, 'users'), 0),
                                             coalesce(p.fair_use_storage_min_mb, 0))::bigint * 1024 * 1024 end
      else null end;
  else
    v_lim := quota_limit(p_agency, p_resource);
  end if;

  if v_lim is null or v_lim <= 0 then
    return jsonb_build_object('niveau', 'ok', 'depuis', null, 'used', v_use, 'limit', v_lim, 'pct', null);
  end if;

  v_pct := round(100.0 * v_use / v_lim, 1);
  select * into u from usage_counters where agency_id = p_agency;
  v_depuis := case p_resource
    when 'cases'     then u.over_since_cases
    when 'shipments' then u.over_since_shipments
    when 'storage'   then u.over_since_storage
    else null end;
  -- Le compteur peut avoir des heures de retard : si on est au-dessus
  -- maintenant et qu'il ne le sait pas encore, « depuis » est aujourd'hui.
  v_depuis := case when v_pct >= 100 then coalesce(v_depuis, current_date) else null end;

  v_niveau := case
    when v_pct >= 120 then 'bloque'
    when v_pct >= 100 and v_depuis <= current_date - 30 then 'bloque'
    when v_pct >= 100 then 'attention'
    when v_pct >= 80 then 'info'
    else 'ok' end;
  if v_premium and v_niveau = 'bloque' then v_niveau := 'attention'; end if;

  return jsonb_build_object('niveau', v_niveau, 'depuis', v_depuis,
                            'used', v_use, 'limit', v_lim, 'pct', v_pct);
end $$;

comment on function quota_soft_state(uuid, text) is
  'Le palier doux d''une ressource : ok, info (80 %), attention (100 %), bloque (120 % ou 100 % depuis trente jours). Premium ne bloque jamais.';

-- Recompter la consommation, tenir la date du dépassement, remettre les
-- compteurs du mois à zéro le premier, et journaliser. Recopiée de 0049.
create or replace function refresh_usage(p_agency uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_over text[]; r text; v_lim bigint; v_use bigint; v_since date;
  v_premium boolean; v_fair text[];
begin
  insert into usage_counters (agency_id, users_count, offices_count, clients_count,
                              active_cases, active_shipments, storage_bytes, computed_at)
  values (
    p_agency,
    quota_used(p_agency, 'users')::int,
    quota_used(p_agency, 'offices')::int,
    quota_used(p_agency, 'clients')::int,
    quota_used(p_agency, 'cases')::int,
    quota_used(p_agency, 'shipments')::int,
    quota_used(p_agency, 'storage'),
    now()
  )
  on conflict (agency_id) do update set
    users_count = excluded.users_count,
    offices_count = excluded.offices_count,
    clients_count = excluded.clients_count,
    active_cases = excluded.active_cases,
    active_shipments = excluded.active_shipments,
    storage_bytes = excluded.storage_bytes,
    computed_at = excluded.computed_at;

  -- Le premier du mois, les compteurs du mois repartent de zéro.
  update usage_counters set emails_month = 0, egress_bytes_month = 0,
                            month_started_on = date_trunc('month', current_date)::date
   where agency_id = p_agency and month_started_on < date_trunc('month', current_date)::date;

  -- Depuis quand on dépasse : posé au premier passage à la limite, effacé
  -- dès qu'on repasse dessous. C'est la date que lit le palier doux.
  foreach r in array array['cases','shipments','storage'] loop
    v_lim := quota_limit(p_agency, r);
    v_use := coalesce(quota_used(p_agency, r), 0);
    if v_lim is not null and v_use >= v_lim then
      execute format('update usage_counters set over_since_%I = coalesce(over_since_%I, current_date) where agency_id = $1', r, r)
        using p_agency;
    else
      execute format('update usage_counters set over_since_%I = null where agency_id = $1', r)
        using p_agency;
    end if;
  end loop;

  -- Le dépassement s'inscrit ICI, pas dans le garde : le garde lève une
  -- exception, et une exception annule l'écriture du journal avec le reste.
  v_over := '{}';
  foreach r in array array['users','offices','cases','shipments','storage'] loop
    if (quota_check(p_agency, r) ->> 'depasse')::boolean then
      v_over := v_over || r;
    end if;
  end loop;

  if array_length(v_over, 1) > 0
     and not exists (select 1 from subscription_events
                      where agency_id = p_agency and kind = 'quota_depasse'
                        and at > now() - interval '24 hours') then
    insert into subscription_events (agency_id, subscription_id, kind, detail)
    select p_agency,
           (select id from subscriptions where agency_id = p_agency
             and status <> 'resiliee' order by started_on desc limit 1),
           'quota_depasse',
           jsonb_build_object('ressources', to_jsonb(v_over));
  end if;

  -- Premium : l'usage raisonnable dépassé se note pour Nadir, au plus une fois
  -- par jour. Jamais un message bloquant à l'agence.
  select (p.code = 'premium') into v_premium
    from subscriptions s join plans p on p.id = s.plan_id
   where s.agency_id = p_agency and s.status <> 'resiliee'
   order by s.started_on desc, s.created_at desc limit 1;
  if coalesce(v_premium, false) then
    v_fair := '{}';
    foreach r in array array['users','offices','storage'] loop
      if (quota_soft_state(p_agency, r) ->> 'niveau') in ('attention','bloque') then
        v_fair := v_fair || r;
      end if;
    end loop;
    if array_length(v_fair, 1) > 0
       and not exists (select 1 from subscription_events
                        where agency_id = p_agency and kind = 'usage_raisonnable'
                          and at > now() - interval '24 hours') then
      insert into subscription_events (agency_id, subscription_id, kind, detail)
      select p_agency,
             (select id from subscriptions where agency_id = p_agency
               and status <> 'resiliee' order by started_on desc limit 1),
             'usage_raisonnable',
             jsonb_build_object('ressources', to_jsonb(v_fair));
    end if;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 7 bis · L'usage en temps réel, pour l'agence et pour la console
-- ------------------------------------------------------------------
--
-- `usage_counters` est un cache, rafraîchi par la tâche de nuit. Une agence
-- qui vient d'ouvrir son quatrième compte doit voir « 4 sur 4 » tout de
-- suite, pas demain matin. Cette fonction COMPTE EN DIRECT, sur des index
-- par agence : six comptages, moins de cinquante millisecondes.
--
-- Une ressource par ligne, la même forme pour tout le monde :
--   { code, label_fr, used, limit, pct, niveau, depuis, unit,
--     addon_price, addon_currency }
-- `limit` nul = illimité. Pour Premium, `limit` est l'usage raisonnable et
-- `premium` est vrai : le niveau ne descend jamais à `bloque`. Les comptes
-- et les bureaux ont un garde dur : leur niveau s'arrête à `attention`, le
-- garde fait le reste. Les courriels ne se bloquent pas non plus : les
-- envois manuels passent toujours, seules les relances automatiques
-- attendent le lendemain.

create or replace function agency_usage_build(p_agency uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s subscriptions; p plans; u usage_counters; v_premium boolean := false;
  n_users bigint; n_offices bigint; n_cases bigint; n_ship bigint; n_bytes bigint; n_mails bigint;
  v_res jsonb := '[]'::jsonb; r record;
  v_ratio numeric; v_pct int; v_depuis date; v_niveau text;
begin
  s := agency_live_subscription(p_agency);
  if s.id is null then
    select * into p from plans where code = 'essai' and currency = 'TND' order by active desc limit 1;
  else
    select * into p from plans where id = s.plan_id;
    v_premium := p.code = 'premium';
  end if;
  select * into u from usage_counters where agency_id = p_agency;

  select count(*) into n_users from profiles where agency_id = p_agency and active;
  select count(*) into n_offices from offices where agency_id = p_agency and active;
  select count(*) into n_cases from cases where agency_id = p_agency and status = 'ouvert';
  select count(*) into n_ship from shipments where agency_id = p_agency and status = 'en_cours';
  -- Seules les pièces des dossiers portent une taille. Les pièces des
  -- cargaisons n'en ont pas : c'est le même comptage que quota_used.
  select coalesce(sum(file_size), 0) into n_bytes from case_documents where agency_id = p_agency;
  select count(*) into n_mails from email_log
   where agency_id = p_agency and status = 'envoye' and created_at >= date_trunc('month', now());

  for r in
    select * from (values
      ('users', 'Comptes actifs', 'compte', n_users,
       case when v_premium then p.fair_use_users::bigint else quota_limit(p_agency, 'users') end,
       true, null::date,
       case when s.id is null then null else s.extra_user_price_month end, 1),
      ('offices', 'Bureaux actifs', 'bureau', n_offices,
       case when v_premium then p.fair_use_offices::bigint else quota_limit(p_agency, 'offices') end,
       true, null::date,
       case when s.id is null then null else s.extra_office_price_month end, 2),
      ('cases', 'Dossiers ouverts', 'dossier', n_cases,
       case when v_premium then null else quota_limit(p_agency, 'cases') end,
       false, u.over_since_cases, null::numeric, 3),
      ('shipments', 'Cargaisons en cours', 'cargaison', n_ship,
       case when v_premium then null else quota_limit(p_agency, 'shipments') end,
       false, u.over_since_shipments, null::numeric, 4),
      ('storage', 'Stockage', 'octet', n_bytes,
       case when v_premium then
              case when p.fair_use_storage_min_mb is null and p.fair_use_storage_mb_per_user is null then null
                   else greatest(coalesce(p.fair_use_storage_mb_per_user, 0) * n_users,
                                 coalesce(p.fair_use_storage_min_mb, 0))::bigint * 1024 * 1024 end
            else quota_limit(p_agency, 'storage') end,
       false, u.over_since_storage, null::numeric, 5),
      ('emails', 'Courriels du mois', 'courriel', n_mails,
       case when v_premium then greatest(coalesce(p.emails_per_case_month, 20) * n_cases, coalesce(p.emails_min_month, 0))::bigint
            else (coalesce(p.emails_per_case_month, 20) * n_cases)::bigint end,
       false, null::date, null::numeric, 6)
    ) as v(code, label_fr, unit, used, lim, hard, depuis, addon, pos)
    order by pos
  loop
    if r.lim is null or r.lim <= 0 then
      v_ratio := null; v_pct := null;
    else
      v_ratio := 100.0 * r.used / r.lim;
      v_pct := round(v_ratio)::int;
    end if;
    -- La date du dépassement, pour les trois ressources qui la mémorisent.
    v_depuis := case when v_ratio >= 100 and r.code in ('cases','shipments','storage')
                     then coalesce(r.depuis, current_date) else null end;
    v_niveau := case
      when v_ratio is null then 'ok'
      when v_ratio >= 120 then 'bloque'
      when v_ratio >= 100 and v_depuis <= current_date - 30 then 'bloque'
      when v_ratio >= 100 then 'attention'
      when v_ratio >= 80 then 'info'
      else 'ok' end;
    if v_niveau = 'bloque' and (v_premium or r.code = 'emails') then
      v_niveau := 'attention';
    end if;
    -- Les comptes et les bureaux ont un garde dur : à 100 % ils sont pleins,
    -- pas en dépassement. Une agence Active à un bureau est à « 1 sur 1 »
    -- toute sa vie ; en faire une alerte noierait le cockpit et le bandeau.
    -- La jauge reste pleine, et le prix de l'ajout s'affiche : c'est une
    -- capacité à vendre, pas un incident.
    if r.hard and not v_premium then v_niveau := 'ok'; end if;
    v_res := v_res || jsonb_build_object(
      'code', r.code, 'label_fr', r.label_fr, 'used', r.used, 'limit', r.lim,
      'pct', v_pct, 'niveau', v_niveau, 'depuis', v_depuis, 'unit', r.unit,
      'addon_price', r.addon,
      'addon_currency', case when r.addon is null then null else coalesce(s.currency, p.currency) end);
  end loop;

  return jsonb_build_object(
    'plan_code', p.code,
    'currency', coalesce(s.currency, p.currency),
    'premium', v_premium,
    'computed_at', now(),
    'resources', v_res
  );
end $$;

-- Ce qu'un compte de l'agence lit : son agence, et rien d'autre. Tout
-- compte actif peut l'appeler, le bandeau se voit par tous.
create or replace function agency_usage()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_agency uuid;
begin
  v_agency := auth_agency_id();
  if v_agency is null then
    raise exception 'aucune agence dans le jeton' using errcode = '42501';
  end if;
  return agency_usage_build(v_agency);
end $$;

comment on function agency_usage() is
  'L''usage de l''agence connectée, compté en direct : comptes, bureaux, dossiers, cargaisons, stockage, courriels, avec la limite, le pourcentage, le niveau et le prix de l''ajout suivant.';

-- La même chose, pour la console, sur n'importe quelle agence.
create or replace function platform_agency_usage(p_agency uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  return agency_usage_build(p_agency);
end $$;

-- Le pire niveau d'une liste de ressources : bloque, attention, info, ok.
create or replace function usage_worst_level(p_resources jsonb)
returns text
language sql immutable as $$
  select coalesce((
    select r ->> 'niveau' from jsonb_array_elements(coalesce(p_resources, '[]'::jsonb)) r
    order by case r ->> 'niveau' when 'bloque' then 0 when 'attention' then 1 when 'info' then 2 else 3 end
    limit 1), 'ok')
$$;

-- ------------------------------------------------------------------
-- 8 · Le plan effectif d'une agence, avec ses montants
-- ------------------------------------------------------------------
--
-- Recopiée de 0049. `limits` devient la limite EFFECTIVE (socle + ajouts),
-- `included` dit ce que le socle apporte. Les montants et les lignes de
-- facture s'ajoutent : `my_plan` les rend à l'agence sans changer.

create or replace function agency_plan(p_agency uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s subscriptions; p plans; v_status text;
begin
  select * into s from subscriptions
   where agency_id = p_agency and status <> 'resiliee'
   order by started_on desc, created_at desc limit 1;

  -- Plus rien de vivant : on montre la DERNIÈRE souscription, résiliée. Une
  -- agence qui a résilié n'est pas une agence qui recommence un essai.
  if s.id is null then
    select * into s from subscriptions
     where agency_id = p_agency
     order by coalesce(ends_on, started_on) desc, created_at desc limit 1;
  end if;

  if s.id is null then
    select * into p from plans where code = 'essai' and currency = 'TND' order by active desc limit 1;
    v_status := 'essai';
  else
    select * into p from plans where id = s.plan_id;
    v_status := s.status;
  end if;

  return jsonb_build_object(
    'agency_id', p_agency,
    'code', p.code,
    'plan_code', p.code,
    'name', p.name,
    'status', v_status,
    'seats', coalesce(s.seats, 0),
    'seats_allowed', quota_limit(p_agency, 'users'),
    'price_per_user_month', coalesce(s.price_per_user_month, p.price_per_user_month),
    'base_price_month', coalesce(s.base_price_month, p.base_price_month),
    'extra_user_price_month', case when s.id is null then p.extra_user_price_month else s.extra_user_price_month end,
    'extra_office_price_month', case when s.id is null then p.extra_office_price_month else s.extra_office_price_month end,
    'extra_users', coalesce(s.extra_users, 0),
    'extra_offices', coalesce(s.extra_offices, 0),
    'currency', coalesce(s.currency, p.currency),
    'billing_period', coalesce(s.billing_period, p.billing_period),
    'discount_pct', coalesce(s.discount_pct, 0),
    'discount_label', s.discount_label,
    'discount_until', s.discount_until,
    'started_on', s.started_on,
    'renewal_on', s.renewal_on,
    'ends_on', s.ends_on,
    'trial_days', p.trial_days,
    'grace_days', p.grace_days,
    'monthly_amount', subscription_monthly_amount(p_agency),
    'annual_amount', subscription_invoice_amount(p_agency),
    'invoice_lines', subscription_invoice_lines(p_agency),
    'invoice_totals', subscription_invoice_totals(p_agency),
    -- null = illimité, jusque dans le jsonb rendu à l'écran.
    'limits', jsonb_build_object(
      'offices', quota_limit(p_agency, 'offices'),
      'users', quota_limit(p_agency, 'users'),
      'cases', quota_limit(p_agency, 'cases'),
      'shipments', quota_limit(p_agency, 'shipments'),
      'storage_mb', quota_limit(p_agency, 'storage') / 1024 / 1024
    ),
    'included', jsonb_build_object(
      'offices', p.max_offices,
      'users', p.max_users,
      'cases', p.max_active_cases,
      'shipments', p.max_active_shipments,
      'storage_mb', p.max_storage_mb,
      'office_users', p.office_included_users,
      'office_cases', p.office_included_cases,
      'office_shipments', p.office_included_shipments,
      'office_storage_mb', p.office_included_storage_mb,
      'extra_user_storage_mb', p.extra_user_storage_mb
    ),
    'fair_use', case
      when p.fair_use_users is null and p.fair_use_offices is null
           and p.fair_use_storage_min_mb is null then null
      else jsonb_build_object(
        'users', p.fair_use_users,
        'offices', p.fair_use_offices,
        'storage_mb_per_user', p.fair_use_storage_mb_per_user,
        'storage_min_mb', p.fair_use_storage_min_mb,
        'emails_min_month', p.emails_min_month) end,
    'support_hours_month', p.support_hours_month,
    'semester_allowed', p.semester_allowed,
    'features', (
      select coalesce(jsonb_agg(f.code order by f.code), '[]'::jsonb)
      from plan_features pf join features f on f.id = pf.feature_id
      where pf.plan_id = p.id
    )
  );
end $$;

-- ------------------------------------------------------------------
-- 9 · L'essai naît sur la ligne TND
-- ------------------------------------------------------------------
--
-- Il y a désormais deux lignes `essai` (TND, EUR). Un `select ... where code
-- = 'essai'` en prendrait une au hasard. L'essai naît en TND : c'est la
-- devise du pays, et le passage à l'euro se décide à la signature. Recopiées
-- de 0049 et 0066, avec la devise.

create or replace function agency_start_trial() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_plan plans; v_sub uuid;
begin
  select * into v_plan from plans where code = 'essai' and currency = 'TND' order by active desc limit 1;
  if v_plan.id is null then return new; end if;

  insert into subscriptions (agency_id, plan_id, status, started_on, renewal_on,
                             billing_period, price_per_user_month, currency, seats,
                             base_price_month, extra_user_price_month, extra_office_price_month, note)
  values (new.id, v_plan.id, 'essai', current_date,
          (current_date + (coalesce(v_plan.trial_days, 15) || ' days')::interval)::date,
          v_plan.billing_period, v_plan.price_per_user_month, v_plan.currency, 1,
          0, null, null,
          'Essai ouvert à la création de l''agence.')
  on conflict do nothing
  returning id into v_sub;

  insert into usage_counters (agency_id) values (new.id)
    on conflict (agency_id) do nothing;

  if v_sub is not null then
    insert into subscription_events (agency_id, subscription_id, kind, detail, by_user)
    values (new.id, v_sub, 'creee',
            jsonb_build_object('plan', 'essai', 'jours', v_plan.trial_days,
                               'origine', 'creation_agence'),
            auth.uid());
  end if;
  return new;
end $$;

create or replace function agency_open_billing_cycle() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_trial int; v_grace int; v_fin date;
begin
  select coalesce(p.trial_days, 15), coalesce(p.grace_days, 7)
    into v_trial, v_grace
  from plans p where p.code = 'essai' and p.currency = 'TND'
  order by p.active desc limit 1;
  v_trial := coalesce(v_trial, 15);
  v_grace := coalesce(v_grace, 7);
  v_fin := current_date + v_trial;

  update subscriptions set
    trial_ends_on = v_fin,
    grace_ends_on = v_fin + v_grace,
    billing_state = 'essai',
    renewal_on    = v_fin,
    updated_at    = now()
  where agency_id = new.id and trial_ends_on is null;

  return new;
end $$;

-- ------------------------------------------------------------------
-- 10 · La console : lister, poser, encaisser
-- ------------------------------------------------------------------

-- Recopiée de 0049, avec les montants de la grille sur chaque ligne.
create or replace function platform_subscriptions()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) from (
      select jsonb_build_object(
        'agency_id', a.id,
        'slug', a.slug,
        'name', a.name,
        'country', a.country,
        'suspended', a.suspended_at is not null,
        'plan', pl -> 'code',
        'plan_code', pl -> 'code',
        'plan_name', pl -> 'name',
        'status', pl -> 'status',
        'seats', pl -> 'seats',
        'seats_allowed', pl -> 'seats_allowed',
        'price_per_user_month', pl -> 'price_per_user_month',
        'base_price_month', pl -> 'base_price_month',
        'extra_user_price_month', pl -> 'extra_user_price_month',
        'extra_office_price_month', pl -> 'extra_office_price_month',
        'extra_users', pl -> 'extra_users',
        'extra_offices', pl -> 'extra_offices',
        'currency', pl -> 'currency',
        'billing_period', pl -> 'billing_period',
        'discount_pct', pl -> 'discount_pct',
        'discount_label', pl -> 'discount_label',
        'discount_until', pl -> 'discount_until',
        'renewal_on', pl -> 'renewal_on',
        'ends_on', pl -> 'ends_on',
        'limits', pl -> 'limits',
        'monthly_amount', pl -> 'monthly_amount',
        'annual_amount', pl -> 'annual_amount',
        'usage', jsonb_build_object(
          'users', coalesce(u.users_count, 0),
          'offices', coalesce(u.offices_count, 0),
          'clients', coalesce(u.clients_count, 0),
          'cases', coalesce(u.active_cases, 0),
          'shipments', coalesce(u.active_shipments, 0),
          'storage_bytes', coalesce(u.storage_bytes, 0)
        ),
        'computed_at', u.computed_at,
        -- Les ressources en dépassement, nommées.
        'over', (
          select coalesce(jsonb_agg(r), '[]'::jsonb)
          from unnest(array['users','offices','cases','shipments','storage']) r
          where (quota_check(a.id, r) ->> 'depasse')::boolean
        )
      ) as x
      from agencies a
      left join usage_counters u on u.agency_id = a.id
      cross join lateral (select agency_plan(a.id) as pl) g
      where a.deleted_at is null
    ) s
  );
end $$;

-- Poser ou changer l'abonnement d'une agence. Recopiée de 0068 (garde
-- `abonnements.modifier`, trace au journal) et étendue : les ajouts, la
-- période, la remise, la devise. Sept paramètres de plus, tous à défaut nul.
--
-- La signature change : l'ancienne à cinq paramètres est retirée, sinon un
-- appel à cinq arguments serait ambigu entre les deux.
--
-- `p_seats` reste accepté pour l'ancien code : sur Active il est ignoré
-- (les sièges se calculent), sur Premium aussi (ce sont les comptes réels).
--
-- LE PRORATA. Un compte ou un bureau ajouté en cours de période se facture
-- au prix figé, sur les mois qui restent, arrondis au mois entier supérieur.
-- La fonction calcule ce montant et l'écrit dans l'événement ; la facture
-- complémentaire est émise à la main par le super-admin.
drop function if exists platform_set_subscription(uuid, text, int, date, text);

create or replace function platform_set_subscription(
  p_agency         uuid,
  p_plan_code      text,
  p_seats          int     default null,
  p_renewal_on     date    default null,
  p_status         text    default 'active',
  p_extra_users    int     default null,
  p_extra_offices  int     default null,
  p_billing_period text    default null,
  p_discount_pct   numeric default null,
  p_discount_label text    default null,
  p_discount_until date    default null,
  p_currency       text    default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_plan plans; s subscriptions; v_kind text; v_id uuid; v_seats int;
  v_currency text; v_old_code text; v_same_code boolean; v_same_plan boolean;
  v_xu int; v_xo int; v_period text; v_pct numeric; v_label text; v_until date;
  v_base numeric; v_pu numeric; v_po numeric; v_renewal date;
  v_prorata numeric := 0; v_mois int := 0; v_nouvelle_echeance boolean := false;
  v_monthly numeric; v_annual numeric; v_prix_ajout numeric := 0;
begin
  perform platform_require('abonnements.modifier');

  if p_status not in ('essai','active','impayee','resiliee','suspendue') then
    raise exception 'état inconnu : %', p_status using errcode = 'P0001';
  end if;

  select * into s from subscriptions
   where agency_id = p_agency and status <> 'resiliee'
   order by started_on desc, created_at desc limit 1;
  if s.id is not null then
    select code into v_old_code from plans where id = s.plan_id;
  end if;

  -- La devise : celle qu'on demande, sinon celle de la souscription, sinon
  -- le dinar. Une agence libyenne porte LYD en devise de travail, mais sa
  -- grille est en TND : si la grille n'existe pas dans sa devise, TND.
  v_currency := upper(coalesce(nullif(trim(p_currency), ''), s.currency, 'TND'));
  select * into v_plan from plans where code = p_plan_code and currency = v_currency and active;
  if v_plan.id is null and p_currency is null and v_currency <> 'TND' then
    v_currency := 'TND';
    select * into v_plan from plans where code = p_plan_code and currency = 'TND' and active;
  end if;
  if v_plan.id is null then
    raise exception 'plan inconnu : % (%)', p_plan_code, v_currency using errcode = 'P0002';
  end if;

  v_same_plan := s.id is not null and v_plan.id = s.plan_id;
  v_same_code := s.id is not null and v_old_code = v_plan.code;

  -- Les ajouts : ce qu'on demande, sinon ce qui était signé sur la même
  -- formule, sinon rien. Un plan sans ajout possible (essai, premium) les
  -- remet à zéro quoi qu'on demande.
  v_xu := greatest(0, coalesce(p_extra_users, case when v_same_code then s.extra_users end, 0));
  v_xo := greatest(0, coalesce(p_extra_offices, case when v_same_code then s.extra_offices end, 0));
  if v_plan.extra_user_price_month is null then v_xu := 0; end if;
  if v_plan.extra_office_price_month is null then v_xo := 0; end if;

  -- La période : annuelle par défaut. Le semestre, seulement là où la grille
  -- le permet. `mensuel` d'une ligne ancienne n'est pas reconduit.
  v_period := coalesce(p_billing_period,
                       case when s.billing_period in ('annuel','semestriel') then s.billing_period end,
                       'annuel');
  if v_period not in ('annuel','semestriel') then
    raise exception 'période inconnue : %', v_period using errcode = 'P0001';
  end if;
  if v_period = 'semestriel' and not v_plan.semester_allowed then
    raise exception 'le semestre n''est pas proposé sur le plan %', v_plan.code using errcode = 'P0001';
  end if;

  -- La remise : plafonnée à 15, jamais cumulée. Zéro efface le libellé.
  v_pct := coalesce(p_discount_pct, s.discount_pct, 0);
  if v_pct < 0 or v_pct > 15 then
    raise exception 'remise hors barème : % (plafond 15)', v_pct using errcode = 'P0001';
  end if;
  v_label := case when v_pct = 0 then null else coalesce(p_discount_label, s.discount_label) end;
  v_until := case when v_pct = 0 then null else coalesce(p_discount_until, s.discount_until) end;

  -- L'échéance. Un essai qui devient payant ouvre une période neuve à partir
  -- d'aujourd'hui : garder l'échéance de l'essai ferait « se renouveler dans
  -- 15 jours » une agence qui vient de signer un an.
  v_renewal := coalesce(p_renewal_on,
                        case when s.id is not null and s.status <> 'essai' and p_plan_code <> 'essai'
                             then s.renewal_on end,
                        (current_date + case when v_period = 'semestriel'
                                             then interval '6 months' else interval '1 year' end)::date);
  v_nouvelle_echeance := s.id is not null and p_renewal_on is not null
                         and s.renewal_on is not null and p_renewal_on > s.renewal_on;

  -- Les prix figés : ceux du plan à la création, au changement de plan (la
  -- devise comprise) et à une échéance nouvelle. Figés sinon.
  if s.id is null or not v_same_plan or v_nouvelle_echeance then
    v_base := v_plan.base_price_month;
    v_pu := v_plan.extra_user_price_month;
    v_po := v_plan.extra_office_price_month;
  else
    v_base := s.base_price_month;
    v_pu := s.extra_user_price_month;
    v_po := s.extra_office_price_month;
  end if;

  -- Les sièges : calculés sur Active, réels sur Premium, informatifs à l'essai.
  v_seats := case
    when v_plan.code = 'premium' then greatest(1, coalesce(quota_used(p_agency, 'users')::int, 1))
    when v_plan.code = 'essai' or v_plan.max_users is null
      then greatest(1, coalesce(p_seats, quota_used(p_agency, 'users')::int, 1))
    else v_plan.max_users + v_xu + v_xo * coalesce(v_plan.office_included_users, 0)
  end;

  -- Le prorata d'un ajout en cours de période, sur la même formule.
  if s.id is not null and v_same_plan and not v_nouvelle_echeance
     and p_status in ('active','impayee')
     and (v_xu > coalesce(s.extra_users, 0) or v_xo > coalesce(s.extra_offices, 0)) then
    if v_renewal > current_date then
      v_mois := ceil((v_renewal - current_date) / 30.0)::int;
    else
      v_mois := 0;
    end if;
    v_prix_ajout := greatest(0, v_xu - coalesce(s.extra_users, 0)) * coalesce(v_pu, 0)
                  + greatest(0, v_xo - coalesce(s.extra_offices, 0)) * coalesce(v_po, 0);
    v_prorata := round(v_prix_ajout * v_mois, 3);
  end if;

  if s.id is null then
    insert into subscriptions (agency_id, plan_id, status, started_on, renewal_on,
                               billing_period, price_per_user_month, currency, seats,
                               extra_users, extra_offices,
                               base_price_month, extra_user_price_month, extra_office_price_month,
                               discount_pct, discount_label, discount_until)
    values (p_agency, v_plan.id, p_status, current_date, v_renewal,
            v_period, v_plan.price_per_user_month, v_plan.currency, v_seats,
            v_xu, v_xo, v_base, v_pu, v_po, v_pct, v_label, v_until)
    returning id into v_id;
    v_kind := 'creee';
  else
    v_kind := case
      when p_status = 'resiliee' then 'resiliee'
      when p_status = 'suspendue' then 'suspendue'
      when s.status in ('suspendue','impayee') and p_status = 'active' then 'reactivee'
      when not v_same_plan then 'changement_plan'
      when v_xu <> coalesce(s.extra_users, 0) or v_xo <> coalesce(s.extra_offices, 0) then 'changement_plan'
      when p_renewal_on is not null and p_renewal_on is distinct from s.renewal_on then 'renouvelee'
      else 'renouvelee'
    end;

    update subscriptions set
      plan_id = v_plan.id,
      status = p_status,
      seats = v_seats,
      extra_users = v_xu,
      extra_offices = v_xo,
      renewal_on = v_renewal,
      ends_on = case when p_status = 'resiliee' then coalesce(ends_on, current_date) else null end,
      price_per_user_month = case when v_same_plan then price_per_user_month else v_plan.price_per_user_month end,
      base_price_month = v_base,
      extra_user_price_month = v_pu,
      extra_office_price_month = v_po,
      discount_pct = v_pct,
      discount_label = v_label,
      discount_until = v_until,
      currency = v_plan.currency,
      billing_period = v_period,
      updated_at = now()
    where id = s.id
    returning id into v_id;
  end if;

  v_monthly := subscription_monthly_amount(p_agency);
  v_annual := subscription_invoice_amount(p_agency);

  insert into subscription_events (agency_id, subscription_id, kind, detail, by_user)
  values (p_agency, v_id, v_kind,
          jsonb_build_object(
            'plan', v_plan.code,
            'plan_avant', v_old_code,
            'devise', v_plan.currency,
            'statut', p_status,
            'statut_avant', s.status,
            'sieges', v_seats,
            'sieges_avant', s.seats,
            'extra_users', v_xu,
            'extra_users_avant', s.extra_users,
            'extra_offices', v_xo,
            'extra_offices_avant', s.extra_offices,
            'periode', v_period,
            'remise_pct', v_pct,
            'remise', v_label,
            'remise_jusqu_au', v_until,
            'echeance', v_renewal,
            'montant_mensuel', v_monthly,
            'montant_annuel', v_annual,
            'prix_ajout_mensuel', v_prix_ajout,
            'mois_restants', v_mois,
            'prorata', v_prorata),
          auth.uid());

  perform refresh_usage(p_agency);
  perform platform_log('abonnement.modifie', 'abonnement', v_id,
    (select name from agencies where id = p_agency),
    jsonb_build_object('agency_id', p_agency, 'subscription_id', v_id, 'kind', v_kind,
                       'plan', v_plan.code, 'plan_avant', v_old_code, 'devise', v_plan.currency,
                       'statut', p_status, 'statut_avant', s.status,
                       'sieges', v_seats, 'sieges_avant', s.seats,
                       'extra_users', v_xu, 'extra_offices', v_xo,
                       'periode', v_period, 'remise_pct', v_pct,
                       'renewal_on', p_renewal_on,
                       'montant_mensuel', v_monthly, 'montant_annuel', v_annual,
                       'prorata', v_prorata));
  return agency_plan(p_agency) || jsonb_build_object(
    'monthly_amount', v_monthly,
    'annual_amount', v_annual,
    'prorata', v_prorata,
    'mois_restants', v_mois);
end $$;

comment on function platform_set_subscription(uuid, text, int, date, text, int, int, text, numeric, text, date, text) is
  'Poser ou changer l''abonnement d''une agence : plan, ajouts, période, remise, devise. Les prix sont figés à la signature. Un ajout en cours de période rend son prorata. Réservé à la plateforme.';

-- Constater un règlement. Recopiée de 0068, même signature, un ajout : le
-- règlement est COMPLET quand ce qui a été reçu sur la période atteint le
-- net à payer, à un dinar près (l'arrondi bancaire). Un règlement complet
-- remet à jour et repousse l'échéance, comme avant. Un règlement partiel est
-- enregistré, entre au journal avec son solde, et ne repousse rien : le
-- super-admin voit le solde dans la console. C'est ce qui empêche qu'une
-- retenue à la source de 25 DT soit lue comme un impayé.
create or replace function platform_record_payment(
  p_agency       uuid,
  p_amount       numeric,
  p_currency     text default 'TND',
  p_period_start date default null,
  p_period_end   date default null,
  p_method       text default 'virement',
  p_reference    text default null,
  p_note         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s          subscriptions;
  v_grace    int;
  v_debut    date;
  v_fin      date;
  v_paiement uuid;
  v_etait    boolean;
  v_net      numeric;
  v_recu     numeric;
  v_complet  boolean;
  v_solde    numeric;
begin
  perform platform_require('facturation.encaisser');
  if p_agency is null then
    raise exception 'agence absente' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'un règlement se saisit avec son montant' using errcode = 'P0001';
  end if;

  select * into s from subscriptions
   where agency_id = p_agency
   order by (status = 'resiliee'), started_on desc, created_at desc
   limit 1;
  if s.id is null then
    raise exception 'cette agence n''a pas d''abonnement' using errcode = 'P0002';
  end if;

  if p_reference is not null and exists (
    select 1 from subscription_payments
    where agency_id = p_agency and reference = p_reference
  ) then
    raise exception 'ce règlement est déjà enregistré : %', p_reference
      using errcode = 'P0001';
  end if;

  select coalesce(p.grace_days, 7) into v_grace from plans p where p.id = s.plan_id;
  v_grace := coalesce(v_grace, 7);

  v_debut := coalesce(p_period_start, current_date);
  v_fin   := coalesce(p_period_end,
                      (v_debut + case when s.billing_period = 'semestriel'
                                      then interval '6 months' else interval '1 year' end
                               - interval '1 day')::date);
  if v_fin < v_debut then
    raise exception 'la période finit avant de commencer' using errcode = 'P0001';
  end if;

  -- Le net à payer, et ce qui a déjà été reçu sur cette période.
  v_net := coalesce((subscription_invoice_totals(p_agency) ->> 'net_a_payer')::numeric, 0);
  select coalesce(sum(amount), 0) into v_recu
    from subscription_payments
   where subscription_id = s.id
     and period_start <= v_fin and period_end >= v_debut;
  v_complet := v_net <= 0 or (v_recu + p_amount) >= v_net - 1;
  v_solde := greatest(0, round(v_net - v_recu - p_amount, 3));

  insert into subscription_payments (agency_id, subscription_id, amount, currency,
                                     period_start, period_end, method, reference, note,
                                     recorded_by)
  values (p_agency, s.id, p_amount, upper(coalesce(p_currency, 'TND')),
          v_debut, v_fin, coalesce(p_method, 'virement'), p_reference, p_note, auth.uid())
  returning id into v_paiement;

  if not v_complet then
    insert into subscription_events (agency_id, subscription_id, kind, detail, by_user)
    values (p_agency, s.id, 'paiement',
            jsonb_build_object('paiement_id', v_paiement,
                               'montant', p_amount,
                               'devise', upper(coalesce(p_currency, 'TND')),
                               'periode_debut', v_debut,
                               'periode_fin', v_fin,
                               'methode', coalesce(p_method, 'virement'),
                               'reference', p_reference,
                               'etat_avant', s.billing_state,
                               'partiel', true,
                               'net_a_payer', v_net,
                               'recu_avant', v_recu,
                               'solde_du', v_solde),
            auth.uid());

    perform platform_log('reglement.enregistre', 'reglement', v_paiement,
      (select name from agencies where id = p_agency),
      jsonb_build_object('agency_id', p_agency, 'paiement_id', v_paiement,
                         'montant', p_amount, 'devise', upper(coalesce(p_currency, 'TND')),
                         'periode_debut', v_debut, 'periode_fin', v_fin,
                         'methode', coalesce(p_method, 'virement'), 'reference', p_reference,
                         'partiel', true, 'solde_du', v_solde, 'reactivee', false));

    return jsonb_build_object(
      'ok', true,
      'agency_id', p_agency,
      'paiement_id', v_paiement,
      'etat', s.billing_state,
      'renewal_on', s.renewal_on,
      'grace_ends_on', s.grace_ends_on,
      'reactivee', false,
      'complet', false,
      'solde_du', v_solde,
      'net_a_payer', v_net
    );
  end if;

  -- Suspendue POUR IMPAYÉ ? `suspended_on` le dit. Une agence gelée à la main
  -- pour une autre raison ne porte pas cette date : on ne la rouvre pas.
  v_etait := s.billing_state = 'suspendue' and s.suspended_on is not null;

  update subscriptions set
    billing_state   = 'a_jour',
    status          = 'active',
    last_payment_on = current_date,
    renewal_on      = v_fin,
    grace_ends_on   = v_fin + v_grace,
    ends_on         = null,
    suspended_on    = null,
    suspend_reason  = null,
    updated_at      = now()
  where id = s.id;

  insert into subscription_events (agency_id, subscription_id, kind, detail, by_user)
  values (p_agency, s.id, 'paiement',
          jsonb_build_object('paiement_id', v_paiement,
                             'montant', p_amount,
                             'devise', upper(coalesce(p_currency, 'TND')),
                             'periode_debut', v_debut,
                             'periode_fin', v_fin,
                             'methode', coalesce(p_method, 'virement'),
                             'reference', p_reference,
                             'etat_avant', s.billing_state,
                             'partiel', false,
                             'net_a_payer', v_net,
                             'recu_avant', v_recu,
                             'solde_du', 0),
          auth.uid());

  if v_etait then
    update agencies set suspended_at = null where id = p_agency;
    insert into subscription_events (agency_id, subscription_id, kind, detail, by_user)
    values (p_agency, s.id, 'reactivee',
            jsonb_build_object('motif', 'paiement_enregistre',
                               'paiement_id', v_paiement),
            auth.uid());
  end if;

  perform platform_log('reglement.enregistre', 'reglement', v_paiement,
    (select name from agencies where id = p_agency),
    jsonb_build_object('agency_id', p_agency, 'paiement_id', v_paiement,
                       'montant', p_amount, 'devise', upper(coalesce(p_currency, 'TND')),
                       'periode_debut', v_debut, 'periode_fin', v_fin,
                       'methode', coalesce(p_method, 'virement'), 'reference', p_reference,
                       'partiel', false, 'solde_du', 0, 'reactivee', v_etait));

  return jsonb_build_object(
    'ok', true,
    'agency_id', p_agency,
    'paiement_id', v_paiement,
    'etat', 'a_jour',
    'renewal_on', v_fin,
    'grace_ends_on', v_fin + v_grace,
    'reactivee', v_etait,
    'complet', true,
    'solde_du', 0,
    'net_a_payer', v_net
  );
end $$;

comment on function platform_record_payment(uuid, numeric, text, date, date, text, text, text) is
  'Constater un règlement reçu. Complet au net à payer, à un dinar près : remet à jour, repousse l''échéance, réactive si suspendue pour impayé. Partiel sinon : enregistré, journalisé avec le solde, l''échéance ne bouge pas.';

-- Le tableau de facturation. Recopié de 0066, avec les montants de la
-- grille, les totaux de la facture et le solde dû sur chaque ligne.
create or replace function platform_billing_board()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(l.ligne order by l.rang, l.jours nulls last, l.nom), '[]'::jsonb)
    from (
      select
        a.name as nom,
        case g.etat ->> 'etat'
          when 'suspendue' then 0
          when 'grace'     then 1
          when 'essai'     then 2
          else 3
        end as rang,
        (g.etat ->> 'jours_restants')::int as jours,
        jsonb_build_object(
          'agency_id', a.id,
          'slug', a.slug,
          'name', a.name,
          'country', a.country,
          'etat', g.etat ->> 'etat',
          'severite', g.etat ->> 'severite',
          'bloquant', (g.etat ->> 'bloquant')::boolean,
          'jours_restants', (g.etat ->> 'jours_restants')::int,
          'echeance', g.etat ->> 'echeance',
          'billing_state', s.billing_state,
          'statut', s.status,
          'plan', (select p.code from plans p where p.id = s.plan_id),
          'plan_code', (select p.code from plans p where p.id = s.plan_id),
          'sieges', coalesce(s.seats, 0),
          'extra_users', coalesce(s.extra_users, 0),
          'extra_offices', coalesce(s.extra_offices, 0),
          -- Le montant ATTENDU sur la période, hors taxes. La ligne de
          -- facture, pas une somme encaissée.
          'montant_attendu', subscription_invoice_amount(a.id),
          'annual_amount', subscription_invoice_amount(a.id),
          'monthly_amount', subscription_monthly_amount(a.id),
          'invoice_totals', subscription_invoice_totals(a.id),
          'solde_du', (b.solde ->> 'solde_du')::numeric,
          'dernier_reglement_le', b.solde ->> 'dernier_reglement_le',
          'devise', coalesce(s.currency, 'TND'),
          'currency', coalesce(s.currency, 'TND'),
          'dernier_paiement', s.last_payment_on,
          'dernier_montant', (select sp.amount from subscription_payments sp
                               where sp.agency_id = a.id
                               order by sp.recorded_at desc limit 1),
          'suspendue_le', s.suspended_on,
          'motif', s.suspend_reason,
          'suspendue', a.suspended_at is not null
        ) as ligne
      from agencies a
      cross join lateral (select agency_access_state(a.id) as etat) g
      cross join lateral (select subscription_balance(a.id) as solde) b
      left join lateral (
        select * from subscriptions x where x.agency_id = a.id
        order by (x.status = 'resiliee'), x.started_on desc, x.created_at desc limit 1
      ) s on true
      where a.deleted_at is null
    ) l
  );
end $$;

-- ------------------------------------------------------------------
-- 11 · La fiche à 360 degrés et le poste de pilotage
-- ------------------------------------------------------------------

-- Recopiée de 0068. Le bloc `abonnement` dit les ajouts et les montants de
-- la grille ; `mensuel` est le mensuel réel, plus sièges × prix.
create or replace function platform_agency_360(p_agency uuid) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare a agencies; g jsonb; s record;
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  select * into a from agencies where id = p_agency;
  if a.id is null then raise exception 'agence introuvable' using errcode = 'P0002'; end if;

  g := agency_access_state(p_agency);
  select x.*, p.code as plan_code, p.name as plan_name into s
    from subscriptions x left join plans p on p.id = x.plan_id
   where x.agency_id = p_agency
   order by (x.status = 'resiliee'), x.started_on desc, x.created_at desc limit 1;

  return jsonb_build_object(
    'agence', jsonb_build_object(
      'id', a.id, 'slug', a.slug, 'name', a.name, 'country', a.country, 'city', a.city,
      'phone', a.phone, 'email', a.email, 'plan', a.plan, 'created_at', a.created_at,
      'suspended_at', a.suspended_at, 'deleted_at', a.deleted_at,
      'commission_kind', a.commission_kind, 'commission_amount', a.commission_amount,
      'work_mode', a.work_mode),
    'acces', jsonb_build_object(
      'etat', g ->> 'etat',
      'jours_restants', (g ->> 'jours_restants')::int,
      'trial_ends_on', s.trial_ends_on, 'grace_ends_on', s.grace_ends_on, 'renewal_on', s.renewal_on,
      'coupee', a.suspended_at is not null or a.deleted_at is not null,
      'bloquant', coalesce((g ->> 'bloquant')::boolean, false)),
    'abonnement', jsonb_build_object(
      'id', s.id, 'plan_code', s.plan_code, 'plan_name', s.plan_name,
      'status', s.status, 'billing_state', s.billing_state,
      'seats', s.seats, 'price_per_user_month', s.price_per_user_month,
      'seats_allowed', case when s.id is null then null else quota_limit(p_agency, 'users') end,
      'extra_users', s.extra_users, 'extra_offices', s.extra_offices,
      'base_price_month', s.base_price_month,
      'extra_user_price_month', s.extra_user_price_month,
      'extra_office_price_month', s.extra_office_price_month,
      'discount_pct', s.discount_pct, 'discount_label', s.discount_label, 'discount_until', s.discount_until,
      'billing_period', s.billing_period, 'currency', s.currency,
      'started_on', s.started_on, 'renewal_on', s.renewal_on,
      'trial_ends_on', s.trial_ends_on, 'grace_ends_on', s.grace_ends_on,
      'last_payment_on', s.last_payment_on,
      'monthly_amount', case when s.id is null then null else subscription_monthly_amount(p_agency) end,
      'annual_amount', case when s.id is null then null else subscription_invoice_amount(p_agency) end,
      'invoice_totals', case when s.id is null then null else subscription_invoice_totals(p_agency) end,
      'solde_du', case when s.id is null then null else (subscription_balance(p_agency) ->> 'solde_du')::numeric end,
      'mensuel', case when s.id is null then null else subscription_monthly_amount(p_agency) end),
    'bureaux', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'city', o.city, 'active', o.active,
        'members', (select count(distinct u) from (
                      select p.id as u from profiles p where p.office_id = o.id and p.active
                      union
                      select m.user_id from office_members m where m.office_id = o.id and m.active) z)
      ) order by o.created_at), '[]'::jsonb)
      from offices o where o.agency_id = p_agency),
    'membres', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'email', p.email, 'role', p.role, 'active', p.active,
        'office_name', (select o.name from offices o where o.id = p.office_id),
        'last_sign_in_at', (select u.last_sign_in_at from auth.users u where u.id = p.id)
      ) order by case p.role when 'owner' then 0 when 'manager' then 1 when 'agent' then 2 else 3 end, p.name),
      '[]'::jsonb)
      from profiles p where p.agency_id = p_agency),
    'compteurs', jsonb_build_object(
      'clients', (select count(*) from clients c where c.agency_id = p_agency and c.deleted_at is null),
      'cases_open', (select count(*) from cases c where c.agency_id = p_agency and c.status = 'ouvert'),
      'cases_total', (select count(*) from cases c where c.agency_id = p_agency),
      'shipments_open', (select count(*) from shipments sh where sh.agency_id = p_agency and sh.status = 'en_cours'),
      'documents',
        (select count(*) from case_documents d where d.agency_id = p_agency and d.storage_path is not null)
        + (select count(*) from shipment_documents d where d.agency_id = p_agency and d.storage_path is not null)
        + (select count(*) from generated_documents d where d.agency_id = p_agency),
      'storage_bytes', greatest(
        coalesce((select u.storage_bytes from usage_counters u where u.agency_id = p_agency), 0),
        coalesce((select sum(d.file_size)::bigint from case_documents d where d.agency_id = p_agency), 0)),
      'connexions_7j', (select count(distinct us.user_id) from user_sessions us
                         where us.last_seen_at >= now() - interval '7 days'
                           and (us.agency_id = p_agency
                                or us.user_id in (select p.id from profiles p where p.agency_id = p_agency)))),
    'reglements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'paid_on', x.recorded_at, 'amount', x.amount, 'currency', x.currency,
        'method', x.method, 'reference', x.reference,
        'period_start', x.period_start, 'period_end', x.period_end,
        'recorded_by_email', (select u.email from auth.users u where u.id = x.recorded_by)
      ) order by x.recorded_at desc), '[]'::jsonb)
      from (select * from subscription_payments where agency_id = p_agency
             order by recorded_at desc limit 10) x),
    'tickets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'subject', t.subject, 'priority', t.priority, 'status', t.status,
        'created_at', t.created_at
      ) order by t.created_at desc), '[]'::jsonb)
      from support_tickets t
      where t.agency_id = p_agency and t.status in ('ouvert','pris_en_charge','en_attente_client')),
    'journal', platform_audit_list(15, null, p_agency, null),
    'usage', agency_usage_build(p_agency),
    'activite_30j', (
      select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'n',
        (select count(*) from activity_events e
          where e.agency_id = p_agency and e.at >= d.day and e.at < d.day + interval '1 day'))
        order by d.day)
      from generate_series(current_date - 29, current_date, interval '1 day') as d(day))
  );
end $$;

-- Le poste de pilotage. Recopié de 0068. Le MRR est la somme des mensuels
-- des abonnements actifs, en TND ; l'euro a ses propres indicateurs, on
-- n'additionne pas deux devises. Le potentiel des essais est ce qu'ils
-- paieraient en Active avec leurs comptes et leurs bureaux réels.
create or replace function platform_cockpit() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_mrr numeric; v_mrr30 numeric; v_pot numeric; v_taches jsonb;
  v_mrr_eur numeric; v_quota jsonb;
  v_taches_echouees jsonb := '[]'::jsonb; v_taches_en_echec int := 0;
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;

  -- La ressource la plus chargée de chaque agence, quand elle passe 80 %.
  -- Calculée une fois : les urgences et l'indicateur la relisent.
  select coalesce(jsonb_agg(jsonb_build_object(
           'agency_id', a.id, 'name', a.name, 'slug', a.slug,
           'suspended', a.suspended_at is not null,
           'code', q.code, 'label', q.label, 'used', q.used, 'limit', q.lim,
           'pct', q.pct, 'depuis', q.depuis, 'unit', q.unit)), '[]'::jsonb)
    into v_quota
    from agencies a
    cross join lateral (
      select r ->> 'code' as code, r ->> 'label_fr' as label,
             (r ->> 'used')::bigint as used, (r ->> 'limit')::bigint as lim,
             (r ->> 'pct')::int as pct, (r ->> 'depuis')::date as depuis, r ->> 'unit' as unit
      from jsonb_array_elements(agency_usage_build(a.id) -> 'resources') with ordinality as x(r, i)
      -- Les comptes et les bureaux, pleins par construction, ne sont pas des
      -- dépassements : seules les ressources souples entrent ici.
      where (r ->> 'pct')::int >= 80 and (r ->> 'code' not in ('users', 'offices') or r ->> 'niveau' <> 'ok')
      -- À pourcentage égal, l'ordre des ressources tranche : les comptes avant
      -- les bureaux, qui sont presque toujours « 1 sur 1 ».
      order by (r ->> 'pct')::int desc, i
      limit 1
    ) q
    where a.deleted_at is null;

  select coalesce(sum(subscription_row_monthly_amount(s)), 0) into v_mrr
    from subscriptions s where s.status = 'active' and s.currency = 'TND';
  select coalesce(sum(subscription_row_monthly_amount(s)), 0) into v_mrr_eur
    from subscriptions s where s.status = 'active' and s.currency = 'EUR';
  select coalesce(sum(subscription_row_monthly_amount(s)), 0) into v_mrr30
    from subscriptions s
   where s.status = 'active' and s.currency = 'TND' and s.started_on <= current_date - 30
     and (s.ends_on is null or s.ends_on > current_date - 30);
  select coalesce(sum(coalesce(plan_monthly_amount('active', 'TND',
                                                   quota_used(s.agency_id, 'users')::int,
                                                   quota_used(s.agency_id, 'offices')::int), 0)), 0)
    into v_pot
    from subscriptions s join agencies a on a.id = s.agency_id
   where s.status = 'essai' and a.deleted_at is null;

  -- Tout ce qui touche 0058 passe par du SQL dynamique : sans pg_cron (le
  -- jumeau local), `job_runs` et `platform_jobs` n'existent pas.
  v_taches := '[]'::jsonb;
  if to_regclass('cron.job') is not null and to_regprocedure('public.platform_jobs()') is not null then
    execute 'select platform_jobs()' into v_taches;
  end if;
  if to_regclass('public.job_runs') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', 'tache_echouee', 'severity', 'critique',
               'id', r.id::text, 'agency_id', null, 'agency_name', null, 'agency_slug', null,
               'title', r.job, 'detail', r.detail, 'since', r.started_at, 'days', null,
               'url', '/admin/taches') order by r.started_at), '[]'::jsonb),
             count(*)
      from (select distinct on (job) * from job_runs where job not like '%:%'
             order by job, started_at desc) r
      where r.ok = false
    $q$ into v_taches_echouees, v_taches_en_echec;
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'kpis', jsonb_build_object(
      'mrr', v_mrr, 'arr', v_mrr * 12, 'mrr_il_y_a_30j', v_mrr30, 'mrr_potentiel', v_pot,
      'mrr_eur', v_mrr_eur, 'arr_eur', v_mrr_eur * 12,
      'agences_en_depassement', (select count(*) from jsonb_array_elements(v_quota) q where (q ->> 'pct')::int >= 100),
      'agences_total', (select count(*) from agencies where deleted_at is null),
      'agences_actives', (select count(*) from agencies where deleted_at is null and suspended_at is null),
      'agences_suspendues', (select count(*) from agencies where deleted_at is null and suspended_at is not null),
      'essais_en_cours', (select count(*) from subscriptions s join agencies a on a.id = s.agency_id
                           where s.billing_state = 'essai' and a.deleted_at is null),
      'essais_finissant_7j', (select count(*) from subscriptions s join agencies a on a.id = s.agency_id
                               where s.billing_state = 'essai' and a.deleted_at is null
                                 and s.trial_ends_on <= current_date + 7),
      'graces', (select count(*) from subscriptions s join agencies a on a.id = s.agency_id
                  where s.billing_state = 'grace' and a.deleted_at is null),
      'encaisse_mois', (select coalesce(sum(amount), 0) from subscription_payments
                         where recorded_at >= date_trunc('month', now())),
      'encaisse_30j', (select coalesce(sum(amount), 0) from subscription_payments
                        where recorded_at >= now() - interval '30 days'),
      'demandes_nouvelles', (select count(*) from agency_signups where status = 'nouvelle'),
      'tickets_ouverts', (select count(*) from support_tickets where status in ('ouvert','pris_en_charge')),
      'tickets_urgents', (select count(*) from support_tickets
                           where status in ('ouvert','pris_en_charge') and priority = 'urgente'),
      'comptes_actifs', (select count(*) from profiles where active),
      'dossiers_ouverts', (select count(*) from cases where status = 'ouvert'),
      'dossiers_30j', (select count(*) from cases where opened_at >= now() - interval '30 days'),
      'connexions_24h', (select count(distinct user_id) from user_sessions
                          where last_seen_at >= now() - interval '24 hours')),
    'urgents', (
      select coalesce(jsonb_agg(u.row order by u.rang, u.since), '[]'::jsonb)
      from (
        select case when s.received_at < now() - interval '48 hours' then 1 else 2 end as rang,
               s.received_at as since,
               jsonb_build_object(
                 'kind', 'demande',
                 'severity', case when s.received_at < now() - interval '48 hours' then 'attention' else 'info' end,
                 'id', s.id, 'agency_id', null, 'agency_name', null, 'agency_slug', null,
                 'title', s.agency_name,
                 'detail', concat_ws(' · ', s.contact_name, s.phone, s.city),
                 'since', s.received_at,
                 'days', floor(extract(epoch from now() - s.received_at) / 86400)::int,
                 'url', '/admin/demandes?id=' || s.id) as row
        from agency_signups s where s.status = 'nouvelle'
        union all
        select case when t.priority = 'urgente' then 0
                    when t.priority = 'haute' or (t.unanswered and t.last_agence < now() - interval '24 hours') then 1
                    else 2 end,
               t.created_at,
               jsonb_build_object(
                 'kind', 'ticket',
                 'severity', case when t.priority = 'urgente' then 'critique'
                                  when t.priority = 'haute' or (t.unanswered and t.last_agence < now() - interval '24 hours') then 'attention'
                                  else 'info' end,
                 'id', t.id, 'agency_id', t.agency_id, 'agency_name', t.name, 'agency_slug', t.slug,
                 'title', t.subject,
                 'detail', concat_ws(' · ', t.category, t.priority,
                                     case when t.unanswered then 'sans réponse' end),
                 'since', t.created_at,
                 'days', floor(extract(epoch from now() - t.created_at) / 86400)::int,
                 'url', '/admin/assistance?ticket=' || t.id)
        from (
          select t.*, a.name, a.slug,
                 greatest(t.created_at, coalesce(m.last_agence, t.created_at)) as last_agence,
                 (m.last_plateforme is null
                  or m.last_plateforme < greatest(t.created_at, coalesce(m.last_agence, t.created_at))) as unanswered
          from support_tickets t
          join agencies a on a.id = t.agency_id
          left join lateral (
            select max(at) filter (where author_kind = 'plateforme') as last_plateforme,
                   max(at) filter (where author_kind = 'agence') as last_agence
            from support_messages m where m.ticket_id = t.id) m on true
          where t.status in ('ouvert','pris_en_charge')) t
        union all
        select 0, a.suspended_at,
               jsonb_build_object(
                 'kind', 'suspendue', 'severity', 'critique',
                 'id', a.id, 'agency_id', a.id, 'agency_name', a.name, 'agency_slug', a.slug,
                 'title', a.name,
                 'detail', (select coalesce(s.suspend_reason, 'suspendue') from subscriptions s
                             where s.agency_id = a.id order by (s.status = 'resiliee'), s.started_on desc limit 1),
                 'since', a.suspended_at,
                 'days', floor(extract(epoch from now() - a.suspended_at) / 86400)::int,
                 'url', '/admin/agences/' || a.id)
        from agencies a where a.deleted_at is null and a.suspended_at is not null
        union all
        select 1, s.updated_at,
               jsonb_build_object(
                 'kind', 'grace', 'severity', 'attention',
                 'id', s.id, 'agency_id', a.id, 'agency_name', a.name, 'agency_slug', a.slug,
                 'title', a.name,
                 'detail', case when s.grace_ends_on is not null
                                then 'grâce jusqu''au ' || to_char(s.grace_ends_on, 'DD/MM/YYYY') end,
                 'since', s.updated_at,
                 'days', s.grace_ends_on - current_date,
                 'url', '/admin/facturation?agence=' || a.id)
        from subscriptions s join agencies a on a.id = s.agency_id
        where s.billing_state = 'grace' and a.deleted_at is null and a.suspended_at is null
        union all
        select 1, s.started_on::timestamptz,
               jsonb_build_object(
                 'kind', 'essai_fin', 'severity', 'attention',
                 'id', s.id, 'agency_id', a.id, 'agency_name', a.name, 'agency_slug', a.slug,
                 'title', a.name,
                 'detail', 'essai jusqu''au ' || to_char(s.trial_ends_on, 'DD/MM/YYYY'),
                 'since', s.started_on,
                 'days', s.trial_ends_on - current_date,
                 'url', '/admin/facturation?agence=' || a.id)
        from subscriptions s join agencies a on a.id = s.agency_id
        where s.billing_state = 'essai' and a.deleted_at is null and a.suspended_at is null
          and s.trial_ends_on is not null and s.trial_ends_on <= current_date + 3
        union all
        select 0, (e ->> 'since')::timestamptz, e
        from jsonb_array_elements(v_taches_echouees) e
        union all
        -- Les agences dont une ressource passe 80 % : attention à 100 %.
        select case when (q ->> 'pct')::int >= 100 then 1 else 2 end,
               coalesce((q ->> 'depuis')::date, current_date)::timestamptz,
               jsonb_build_object(
                 'kind', 'quota',
                 'severity', case when (q ->> 'pct')::int >= 100 then 'attention' else 'info' end,
                 'id', (q ->> 'agency_id') || ':' || (q ->> 'code'),
                 'agency_id', (q ->> 'agency_id')::uuid, 'agency_name', q ->> 'name', 'agency_slug', q ->> 'slug',
                 'title', (q ->> 'label') || ' à ' || (q ->> 'pct') || ' %',
                 'detail', (q ->> 'label') || ' : ' ||
                   case when q ->> 'unit' = 'octet'
                        then round((q ->> 'used')::numeric / 1048576) || ' Mo sur ' || round((q ->> 'limit')::numeric / 1048576) || ' Mo'
                        else (q ->> 'used') || ' sur ' || (q ->> 'limit') end,
                 'since', coalesce((q ->> 'depuis')::date, current_date)::timestamptz,
                 'days', case when q ->> 'depuis' is null then null else current_date - (q ->> 'depuis')::date end,
                 'url', '/admin/agences/' || (q ->> 'agency_id'))
        from jsonb_array_elements(v_quota) q
        where not (q ->> 'suspended')::boolean
        union all
        select 2, coalesce(e.last_at, a.created_at),
               jsonb_build_object(
                 'kind', 'agence_inactive', 'severity', 'info',
                 'id', a.id, 'agency_id', a.id, 'agency_name', a.name, 'agency_slug', a.slug,
                 'title', a.name,
                 'detail', case when e.last_at is null then 'aucune activité enregistrée'
                                else 'dernière activité le ' || to_char(e.last_at, 'DD/MM/YYYY') end,
                 'since', coalesce(e.last_at, a.created_at),
                 'days', floor(extract(epoch from now() - coalesce(e.last_at, a.created_at)) / 86400)::int,
                 'url', '/admin/agences/' || a.id)
        from agencies a
        left join lateral (select max(at) as last_at from activity_events x where x.agency_id = a.id) e on true
        where a.deleted_at is null and a.suspended_at is null and a.plan <> 'essai'
          and coalesce(e.last_at, a.created_at) < now() - interval '14 days'
      ) u),
    'series', jsonb_build_object(
      'signups_30j', (
        select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'n',
          (select count(*) from agency_signups s where s.received_at >= d.day and s.received_at < d.day + interval '1 day'))
          order by d.day)
        from generate_series(current_date - 29, current_date, interval '1 day') as d(day)),
      'connexions_14j', (
        select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'n',
          (select count(distinct us.user_id) from user_sessions us
            where (us.last_seen_at >= d.day and us.last_seen_at < d.day + interval '1 day')
               or (us.created_at >= d.day and us.created_at < d.day + interval '1 day')))
          order by d.day)
        from generate_series(current_date - 13, current_date, interval '1 day') as d(day)),
      'dossiers_30j', (
        select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'n',
          (select count(*) from cases c where c.opened_at >= d.day and c.opened_at < d.day + interval '1 day'))
          order by d.day)
        from generate_series(current_date - 29, current_date, interval '1 day') as d(day)),
      'encaisse_12m', (
        select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'amount',
          (select coalesce(sum(p.amount), 0) from subscription_payments p
            where p.recorded_at >= m.month and p.recorded_at < m.month + interval '1 month'))
          order by m.month)
        from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()),
                             interval '1 month') as m(month)),
      'mrr_12m', (
        select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'amount',
          (select coalesce(sum(subscription_row_monthly_amount(s)), 0) from subscriptions s
            where s.status in ('active','resiliee') and s.currency = 'TND'
              and s.started_on <= (m.month + interval '1 month' - interval '1 day')::date
              and (s.ends_on is null or s.ends_on >= m.month::date)))
          order by m.month)
        from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()),
                             interval '1 month') as m(month)),
      'agences_12m', (
        select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'n',
          (select count(*) from agencies a
            where a.created_at >= m.month and a.created_at < m.month + interval '1 month'))
          order by m.month)
        from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()),
                             interval '1 month') as m(month))),
    'activite', platform_audit_list(20, null, null, null),
    'taches', v_taches,
    'sante', jsonb_build_object(
      'taches_en_echec', v_taches_en_echec,
      'courriels_echoues_24h', (select count(*) from email_log
        where status in ('echoue','non_configure') and created_at >= now() - interval '24 hours'),
      'webhooks_echoues_24h', (select count(*) from webhook_deliveries
        where status = 'echoue' and created_at >= now() - interval '24 hours'),
      'whatsapp_en_attente', (select count(*) from messages
        where channel = 'whatsapp' and status = 'file'))
  );
end $$;


-- La liste des agences. Recopiée de 0043 : `returns table` ne s'étend pas
-- par `create or replace`, on la retire et on la recrée avec deux colonnes
-- de plus, le pourcentage le plus haut et le pire niveau d'usage. La console
-- voit d'un coup d'œil qui est à l'étroit.
drop function if exists platform_agencies();
create or replace function platform_agencies()
returns table (
  id uuid, slug text, name text, country text, plan text,
  suspended boolean, created_at timestamptz,
  users bigint, offices bigint, clients bigint, cases_open bigint, last_activity timestamptz,
  commission_kind text, commission_amount numeric,
  usage_max_pct int, usage_niveau text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  return query
  select a.id, a.slug, a.name, a.country, a.plan,
         a.suspended_at is not null, a.created_at,
         (select count(*) from profiles p where p.agency_id = a.id),
         (select count(*) from offices o where o.agency_id = a.id and o.active),
         (select count(*) from clients c where c.agency_id = a.id and c.deleted_at is null),
         (select count(*) from cases c where c.agency_id = a.id and c.status = 'ouvert'),
         (select max(e.at) from activity_events e where e.agency_id = a.id),
         a.commission_kind, a.commission_amount,
         (select max((r ->> 'pct')::int) from jsonb_array_elements(g.usage -> 'resources') r
           where r ->> 'code' not in ('users', 'offices') or r ->> 'niveau' <> 'ok'),
         usage_worst_level(g.usage -> 'resources')
  from agencies a
  cross join lateral (select agency_usage_build(a.id) as usage) g
  where a.deleted_at is null
  order by a.created_at desc;
end $$;

-- ------------------------------------------------------------------
-- 12 · L'analyse de 0055 et les demandes de 0042, alignées
-- ------------------------------------------------------------------

-- Recopiée de 0055. Seule la somme change : le mensuel de chaque ligne au
-- lieu de sièges × prix par utilisateur.
create or replace function platform_analytics()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v      jsonb;
  abos   boolean := to_regclass('public.subscriptions') is not null;
  mrr_m  numeric := 0;
  mrr_a  numeric := 0;
  source text := 'platform_invoices';
  n_essai bigint := 0; n_conv bigint := 0; n_churn bigint := 0;
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;

  if abos then
    source := 'subscriptions';
    -- Le mensuel est déjà exprimé par MOIS. Un contrat mensuel entre tel
    -- quel ; un contrat annuel ou semestriel vaut le même douzième une fois
    -- ramené au mois.
    execute 'select
        coalesce(sum(subscription_row_monthly_amount(s))
                 filter (where s.billing_period = ''mensuel''), 0),
        coalesce(sum(subscription_row_monthly_amount(s))
                 filter (where s.billing_period <> ''mensuel''), 0),
        count(*) filter (where s.status = ''essai'')
      from subscriptions s where s.status in (''active'',''essai'')'
      into mrr_m, mrr_a, n_essai;

    if to_regclass('public.subscription_events') is not null then
      execute 'select
          count(*) filter (where e.kind = ''creee'' and e.at >= now() - interval ''90 days''),
          count(*) filter (where e.kind = ''resiliee'' and e.at >= now() - interval ''90 days'')
        from subscription_events e'
        into n_conv, n_churn;
    end if;
  else
    select coalesce(sum(amount), 0) into mrr_m from platform_invoices
     where period = date_trunc('month', current_date)::date
       and status in ('envoyee','reglee');
    select count(*) into n_essai from agencies
     where plan = 'essai' and deleted_at is null;
  end if;

  select jsonb_build_object(
    'generated_at', now(),

    'mrr_source', source,
    'mrr_monthly_plans', round(mrr_m, 3),
    'mrr_annual_twelfth', round(mrr_a, 3),
    'mrr_total', round(mrr_m + mrr_a, 3),
    'arr', round((mrr_m + mrr_a) * 12, 3),
    'mrr_note', 'Un abonnement annuel réglé sur facture est ramené au douzième pour être comparé à un abonnement mensuel. Ce n''est pas le même revenu : il tombe une fois par an.',

    'agencies_total',     (select count(*) from agencies where deleted_at is null),
    'agencies_active',    (select count(*) from agencies
                            where deleted_at is null and suspended_at is null),
    'agencies_suspended', (select count(*) from agencies
                            where deleted_at is null and suspended_at is not null),
    'trials', n_essai,
    'trials_ending_30d',  (select count(*) from agencies
                            where deleted_at is null and plan = 'essai'
                              and trial_ends_at between now() and now() + interval '30 days'),
    'conversions_90d', n_conv,
    'churn_90d', n_churn,
    'churn_rate_90d', (select round(100.0 * n_churn / nullif(count(*), 0), 1)
                        from agencies where deleted_at is null and suspended_at is null),

    'accounts',   (select count(*) from profiles where active),
    'offices',    (select count(*) from offices),
    'clients',    (select count(*) from clients where deleted_at is null),
    'cases',      (select count(*) from cases),
    'cases_open', (select count(*) from cases where status = 'ouvert'),
    'shipments',  (select count(*) from shipments),
    'shipments_open', (select count(*) from shipments where status = 'en_cours'),

    'storage_bytes', (select coalesce(sum(storage_bytes), 0) from usage_counters),

    'by_plan', (
      select coalesce(jsonb_object_agg(t.plan, t.n), '{}'::jsonb)
      from (select plan, count(*) as n from agencies
             where deleted_at is null group by plan) t),

    'signups_by_month', (
      select coalesce(jsonb_agg(jsonb_build_object('month', to_char(t.m, 'YYYY-MM'), 'n', t.n)
                                order by t.m), '[]'::jsonb)
      from (select date_trunc('month', created_at)::date as m, count(*) as n
              from agencies where deleted_at is null
                and created_at >= date_trunc('month', now()) - interval '11 months'
             group by 1) t)
  ) into v;

  return v;
end $$;

-- Recopiée de 0042. `suggested_year` était `team_size × 45 × 12`. C'est
-- désormais l'estimation de la section 5.7 : la formule conseillée pour
-- `team_size` comptes et un bureau, en TND, avec son mensuel et son annuel.
create or replace function platform_signups(p_status text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'agency_name', s.agency_name, 'country', s.country, 'city', s.city,
      'services', to_jsonb(s.services),
      'contact_name', s.contact_name, 'phone', s.phone, 'email', s.email,
      'team_size', s.team_size, 'monthly_cases', s.monthly_cases,
      'current_tool', s.current_tool, 'note', s.note, 'locale', s.locale,
      'status', s.status, 'received_at', s.received_at,
      'quoted_users', s.quoted_users, 'quoted_amount', s.quoted_amount,
      'quoted_currency', s.quoted_currency,
      'refusal_reason', s.refusal_reason,
      'agency_id', s.agency_id,
      'agency_slug', (select a.slug from agencies a where a.id = s.agency_id),
      'suggested_plan', g.est ->> 'plan',
      'suggested_month', (g.est ->> 'monthly')::numeric,
      'suggested_year', (g.est ->> 'annual')::numeric
    ) order by s.received_at desc), '[]'::jsonb)
    from agency_signups s
    cross join lateral (
      select case when s.team_size is null then null
                  else plan_estimate(s.team_size, 1, 'TND') end as est
    ) g
    where p_status is null or s.status = p_status
  );
end $$;

-- ------------------------------------------------------------------
-- 13 · La grille lue par la page publique
-- ------------------------------------------------------------------
--
-- La page des tarifs n'a pas de session. Elle ne lit que les plans en vente,
-- dans la devise du pays, et rien d'autre : ni les identifiants, ni les
-- plans retirés, ni aucune agence. C'est la seule fonction de ce fichier
-- ouverte à l'anonyme, et elle ne prend qu'une devise.

create or replace function public_plans(p_currency text default 'TND')
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', p.code,
    'name', p.name,
    'currency', p.currency,
    'base_price_month', p.base_price_month,
    'extra_user_price_month', p.extra_user_price_month,
    'extra_office_price_month', p.extra_office_price_month,
    'max_users', p.max_users,
    'max_offices', p.max_offices,
    'max_active_cases', p.max_active_cases,
    'max_active_shipments', p.max_active_shipments,
    'max_storage_mb', p.max_storage_mb,
    'office_included_users', p.office_included_users,
    'office_included_cases', p.office_included_cases,
    'office_included_shipments', p.office_included_shipments,
    'office_included_storage_mb', p.office_included_storage_mb,
    'extra_user_storage_mb', p.extra_user_storage_mb,
    'fair_use_users', p.fair_use_users,
    'fair_use_offices', p.fair_use_offices,
    'fair_use_storage_mb_per_user', p.fair_use_storage_mb_per_user,
    'fair_use_storage_min_mb', p.fair_use_storage_min_mb,
    'trial_days', p.trial_days,
    'grace_days', p.grace_days,
    'support_hours_month', p.support_hours_month,
    'office_support_hours_month', p.office_support_hours_month,
    'semester_allowed', p.semester_allowed,
    'semester_factor', p.semester_factor,
    'note', p.note,
    'position', p.position
  ) order by p.position, p.code), '[]'::jsonb)
  from plans p
  where p.active
    and p.currency = upper(coalesce(nullif(trim(p_currency), ''), 'TND'))
$$;

comment on function public_plans(text) is
  'La grille en vente, dans une devise, pour la page publique des tarifs. Appelable sans session : elle ne rend que des plans actifs, jamais une agence.';

-- ------------------------------------------------------------------
-- 14 · Migrer les souscriptions des anciens plans
-- ------------------------------------------------------------------
--
-- Écrite en fonction pour être vérifiée par le banc, puis appelée une fois.
-- Elle ne touche que les souscriptions VIVANTES posées sur un ancien plan.
-- Les résiliées gardent leur plan d'origine : c'est l'histoire commerciale,
-- et le MRR des douze derniers mois la relit avec l'ancienne formule.
--
--   · enterprise → premium
--   · starter, pro, business → active, avec extra_offices = bureaux actifs
--     moins un, extra_users = comptes actifs moins quatre moins deux par
--     bureau en plus, jamais négatifs.
--   · essai → essai : la ligne TND est celle d'avant, rien à faire.
--
-- Une souscription active DÉJÀ PAYÉE garde son montant sur la période en
-- cours : son socle figé devient l'ancien mensuel, ses ajouts valent zéro,
-- et la note dit au super-admin d'aligner à l'échéance. La facture qui a
-- été réglée ne change pas de montant après coup.

create or replace function grille_migrate_0070()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record; np plans; n int := 0;
  v_code text; v_off int; v_usr int; v_xo int; v_xu int;
  v_ancien numeric; v_paye boolean; v_base numeric; v_pu numeric; v_po numeric; v_seats int;
begin
  for r in
    select s.*, p.code as old_code
    from subscriptions s join plans p on p.id = s.plan_id
    where p.code in ('starter','pro','business','enterprise')
      and s.status <> 'resiliee'
  loop
    v_code := case when r.old_code = 'enterprise' then 'premium' else 'active' end;
    select * into np from plans where code = v_code and currency = r.currency and active;
    if np.id is null then
      select * into np from plans where code = v_code and currency = 'TND' and active;
    end if;
    if np.id is null then continue; end if;

    v_off := coalesce(quota_used(r.agency_id, 'offices'), 0)::int;
    v_usr := coalesce(quota_used(r.agency_id, 'users'), 0)::int;
    v_xo := case when v_code = 'active' then greatest(0, v_off - 1) else 0 end;
    v_xu := case when v_code = 'active' then greatest(0, v_usr - 4 - 2 * v_xo) else 0 end;
    v_ancien := round(coalesce(r.seats, 0) * coalesce(r.price_per_user_month, 0), 3);
    v_paye := r.status = 'active' and r.last_payment_on is not null;

    if v_paye then
      v_base := v_ancien; v_pu := 0; v_po := 0;
    else
      v_base := np.base_price_month; v_pu := np.extra_user_price_month; v_po := np.extra_office_price_month;
    end if;
    v_seats := case when v_code = 'premium' then greatest(1, v_usr)
                    else np.max_users + v_xu + v_xo * np.office_included_users end;

    update subscriptions set
      plan_id = np.id,
      currency = np.currency,
      extra_users = v_xu,
      extra_offices = v_xo,
      base_price_month = v_base,
      extra_user_price_month = v_pu,
      extra_office_price_month = v_po,
      price_per_user_month = 0,
      seats = v_seats,
      billing_period = case when billing_period = 'mensuel' then 'annuel' else billing_period end,
      note = concat_ws(' ', note,
        'Migré du plan « ' || r.old_code || ' » à la grille 0070.',
        case when v_paye
             then 'Période en cours payée à ' || v_ancien || ' ' || r.currency || ' par mois (ancien montant conservé) : aligner base_price_month, extra_user_price_month et extra_office_price_month sur la grille à la prochaine échéance.'
             end),
      updated_at = now()
    where id = r.id;

    insert into subscription_events (agency_id, subscription_id, kind, detail)
    values (r.agency_id, r.id, 'changement_plan',
            jsonb_build_object('plan', v_code, 'plan_avant', r.old_code,
                               'origine', 'migration_0070',
                               'sieges', v_seats, 'sieges_avant', r.seats,
                               'extra_users', v_xu, 'extra_offices', v_xo,
                               'montant_mensuel_avant', v_ancien,
                               'montant_mensuel', round(v_base + v_xu * coalesce(v_pu, 0) + v_xo * coalesce(v_po, 0), 3),
                               'periode_payee_conservee', v_paye));
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
declare n int;
begin
  n := grille_migrate_0070();
  raise notice '0070 : % souscription(s) migrée(s) vers la grille Active / Premium', n;
end $$;

-- Une nouvelle photo de la consommation : les dates de dépassement et les
-- sièges recalculés doivent être visibles tout de suite dans la console.
do $$ begin perform refresh_usage_all(); end $$;

-- ------------------------------------------------------------------
-- 15 · Les droits
-- ------------------------------------------------------------------
--
-- Piège 0015 : `plans` avait insert, update et delete pour authenticated,
-- filtrés par politique. La grille se pose par migration, jamais depuis un
-- écran : on referme, il ne reste que la lecture. Les nouvelles colonnes de
-- `subscriptions` et d'`usage_counters` suivent les droits de leur table
-- (la plateforme écrit, l'agence lit).

revoke insert, update, delete on plans from authenticated;
grant select on plans to authenticated;

revoke all on function agency_live_subscription(uuid) from public, anon, authenticated;
revoke all on function agency_money_readable(uuid) from public, anon, authenticated;
revoke all on function subscription_row_monthly_amount(subscriptions) from public, anon, authenticated;
revoke all on function grille_migrate_0070() from public, anon, authenticated;

revoke all on function agency_usage_build(uuid) from public, anon, authenticated;
revoke all on function usage_worst_level(jsonb) from public, anon, authenticated;
revoke all on function agency_usage() from public, anon;
revoke all on function platform_agency_usage(uuid) from public, anon;
revoke all on function platform_agencies() from public, anon;
revoke all on function plan_monthly_amount(text, text, int, int) from public, anon;
revoke all on function plan_estimate(int, int, text) from public, anon;
revoke all on function subscription_monthly_amount(uuid) from public, anon;
revoke all on function subscription_invoice_amount(uuid) from public, anon;
revoke all on function subscription_invoice_lines(uuid) from public, anon;
revoke all on function subscription_invoice_totals(uuid) from public, anon;
revoke all on function subscription_balance(uuid) from public, anon;
revoke all on function quota_limit(uuid, text) from public, anon;
revoke all on function quota_guard(uuid, text) from public, anon;
revoke all on function quota_soft_state(uuid, text) from public, anon;
revoke all on function refresh_usage(uuid) from public, anon;
revoke all on function agency_plan(uuid) from public, anon;
revoke all on function guard_office_quota() from public, anon;
revoke all on function guard_profile_quota() from public, anon;
revoke all on function agency_start_trial() from public, anon;
revoke all on function agency_open_billing_cycle() from public, anon;
revoke all on function platform_subscriptions() from public, anon;
revoke all on function platform_set_subscription(uuid, text, int, date, text, int, int, text, numeric, text, date, text) from public, anon;
revoke all on function platform_record_payment(uuid, numeric, text, date, date, text, text, text) from public, anon;
revoke all on function platform_billing_board() from public, anon;
revoke all on function platform_agency_360(uuid) from public, anon;
revoke all on function platform_cockpit() from public, anon;
revoke all on function platform_analytics() from public, anon;
revoke all on function platform_signups(text) from public, anon;
revoke all on function public_plans(text) from public;

grant execute on function agency_usage() to authenticated;
grant execute on function platform_agency_usage(uuid) to authenticated;
grant execute on function platform_agencies() to authenticated;
grant execute on function plan_monthly_amount(text, text, int, int) to authenticated;
grant execute on function plan_estimate(int, int, text) to authenticated;
grant execute on function subscription_monthly_amount(uuid) to authenticated;
grant execute on function subscription_invoice_amount(uuid) to authenticated;
grant execute on function subscription_invoice_lines(uuid) to authenticated;
grant execute on function subscription_invoice_totals(uuid) to authenticated;
grant execute on function subscription_balance(uuid) to authenticated;
grant execute on function quota_limit(uuid, text) to authenticated;
grant execute on function quota_guard(uuid, text) to authenticated;
grant execute on function quota_soft_state(uuid, text) to authenticated;
grant execute on function refresh_usage(uuid) to authenticated;
grant execute on function agency_plan(uuid) to authenticated;
grant execute on function platform_subscriptions() to authenticated;
grant execute on function platform_set_subscription(uuid, text, int, date, text, int, int, text, numeric, text, date, text) to authenticated;
grant execute on function platform_record_payment(uuid, numeric, text, date, date, text, text, text) to authenticated;
grant execute on function platform_billing_board() to authenticated;
grant execute on function platform_agency_360(uuid) to authenticated;
grant execute on function platform_cockpit() to authenticated;
grant execute on function platform_analytics() to authenticated;
grant execute on function platform_signups(text) to authenticated;
-- La page publique des tarifs : la seule ouverture à l'anonyme de ce fichier.
grant execute on function public_plans(text) to anon, authenticated;
grant execute on function grille_migrate_0070() to service_role;

-- Le piège des fonctions de déclencheur, comme en 0056 et 0068 : une
-- fonction `returns trigger` reste appelable par un anonyme si on ne referme
-- pas. On referme, pour toutes celles du schéma.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
  end loop;
end $$;
