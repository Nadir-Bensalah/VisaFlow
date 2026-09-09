-- Banc d'essai de la grille Essai / Active / Premium (migration 0070).
--
-- Ce qu'on vérifie, dans l'ordre où ça casse en vrai :
--   · les six lignes de la grille, aux prix de la décision du 9 septembre ;
--   · la formule du mensuel sur les huit agences types, en dinars et en euros ;
--   · la facture : annuelle, semestrielle, remisée, ses lignes et ses totaux
--     (TVA 19 %, retenue 1 %, net à payer ; zéro en euros) ;
--   · les limites socle + ajouts, le garde dur qui cite le prix, le palier
--     doux à 80 / 100 / 120 % et à trente jours, Premium qui ne bloque jamais ;
--   · le prorata d'un ajout en cours d'année ;
--   · le règlement partiel : le net à payer est complet, la moitié ne l'est pas ;
--   · la console : liste, tableau, fiche, poste de pilotage, demandes ;
--   · la page publique lit la grille sans session, et rien d'autre ;
--   · la migration des anciennes lignes, payées ou non.
--
-- Rejouable : le prologue efface ce que le passage précédent a laissé.

\set ON_ERROR_STOP on
set search_path = public;

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then raise notice 'OK    %', label;
  else raise exception 'ÉCHEC %', label; end if;
end $$;

-- Se faire passer pour un compte de plateforme, le temps d'un geste.
create or replace function gr_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role authenticated';
end $$;
revoke all on function gr_as(uuid) from public, anon;

-- Prologue : rien du passage précédent ne doit rester.
delete from agency_signups where email like '%@banc-grille.test';
delete from agencies where slug like 'banc-grille-%';
delete from platform_audit where admin_email like '%@banc-grille.test';
delete from platform_admins where email like '%@banc-grille.test';
delete from auth.users where email like '%@banc-grille.test';
update plans set max_active_cases = 150, max_active_shipments = 100, max_storage_mb = 12288
 where code = 'active' and currency = 'TND';
update plans set fair_use_users = 60 where code = 'premium';

do $$
declare
  v_admin uuid; v_ag uuid; v_ag2 uuid; v_ag3 uuid; v_ag4 uuid; v_ag5 uuid; v_ag6 uuid; v_ag7 uuid;
  v_off uuid; v_off2 uuid; v_owner uuid; v_u uuid; v_cl uuid; v_vt uuid; v_case uuid; v_signup uuid; v_signup2 uuid;
  n int; i int; ok boolean; j jsonb; l jsonb; t jsonb; b jsonb; p jsonb; c jsonb; e jsonb; s text;
  m numeric; d date; v_mois int; v_net numeric; v_sub uuid; t0 timestamptz; ms int;
  sfx text := substr(md5(random()::text), 1, 8);
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'su@banc-grille.test') returning id into v_admin;
  insert into platform_admins (id, name, email, role) values (v_admin, 'Banc Grille', 'su@banc-grille.test', 'superuser');
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', '{}', true);

  -- ---------------------------------------------------------------
  -- 1 · Les six lignes de la grille
  -- ---------------------------------------------------------------
  select count(*) into n from plans where active;
  perform assert(n = 6, 'six plans en vente : trois formules, deux devises');
  perform assert((select count(*) from plans where code in ('starter','pro','business','enterprise') and active) = 0,
                 'les quatre anciens plans sont retirés de la vente');
  perform assert((select count(*) from plans where code in ('starter','pro','business','enterprise')) = 4,
                 'mais ils restent pour l''histoire');

  select to_jsonb(x) into p from plans x where code = 'essai' and currency = 'TND';
  perform assert((p ->> 'base_price_month')::numeric = 0 and (p ->> 'trial_days')::int = 15
                 and (p ->> 'max_users')::int = 10 and (p ->> 'max_offices')::int = 1
                 and (p ->> 'max_active_cases')::int = 30 and (p ->> 'max_active_shipments')::int = 10
                 and (p ->> 'max_storage_mb')::int = 2048 and p ->> 'extra_user_price_month' is null
                 and not (p ->> 'semester_allowed')::boolean,
                 'Essai TND : 0, quinze jours, 10 comptes, 1 bureau, 30 dossiers, 2 Go, pas d''ajout');
  select to_jsonb(x) into p from plans x where code = 'active' and currency = 'TND';
  perform assert((p ->> 'base_price_month')::numeric = 179 and (p ->> 'extra_user_price_month')::numeric = 35
                 and (p ->> 'extra_office_price_month')::numeric = 119
                 and (p ->> 'max_users')::int = 4 and (p ->> 'max_offices')::int = 1
                 and (p ->> 'max_active_cases')::int = 150 and (p ->> 'max_active_shipments')::int = 100
                 and (p ->> 'max_storage_mb')::int = 12288,
                 'Active TND : 179, compte 35, bureau 119, 4 comptes, 150 dossiers, 12 Go');
  perform assert((p ->> 'office_included_users')::int = 2 and (p ->> 'office_included_cases')::int = 75
                 and (p ->> 'office_included_shipments')::int = 50 and (p ->> 'office_included_storage_mb')::int = 6144
                 and (p ->> 'extra_user_storage_mb')::int = 3072,
                 'un bureau en plus apporte 2 comptes, 75 dossiers, 50 cargaisons, 6 Go ; un compte 3 Go');
  perform assert((p ->> 'support_hours_month')::numeric = 2 and (p ->> 'office_support_hours_month')::numeric = 1
                 and (p ->> 'semester_allowed')::boolean and (p ->> 'semester_factor')::numeric = 1.1
                 and (p ->> 'emails_per_case_month')::int = 20 and (p ->> 'egress_gb_per_user_month')::int = 10
                 and (p ->> 'grace_days')::int = 7 and (p ->> 'price_per_user_month')::numeric = 0,
                 'Active : 2 h de support, 1 h par bureau, semestre à +10 %, 20 courriels par dossier, prix par utilisateur à zéro');
  select to_jsonb(x) into p from plans x where code = 'premium' and currency = 'TND';
  perform assert((p ->> 'base_price_month')::numeric = 890 and p ->> 'max_users' is null and p ->> 'max_offices' is null
                 and p ->> 'max_active_cases' is null and p ->> 'max_storage_mb' is null
                 and p ->> 'extra_user_price_month' is null and p ->> 'extra_office_price_month' is null,
                 'Premium TND : 890, tout illimité, pas d''ajout');
  perform assert((p ->> 'fair_use_users')::int = 60 and (p ->> 'fair_use_offices')::int = 15
                 and (p ->> 'fair_use_storage_mb_per_user')::int = 4096 and (p ->> 'fair_use_storage_min_mb')::int = 61440
                 and (p ->> 'emails_min_month')::int = 5000 and (p ->> 'support_hours_month')::numeric = 6,
                 'Premium : usage raisonnable 60 comptes, 15 bureaux, 4 Go par compte (60 Go minimum), 5 000 courriels, 6 h');
  perform assert((select base_price_month from plans where code = 'essai' and currency = 'EUR') = 0
                 and (select (base_price_month, extra_user_price_month, extra_office_price_month)
                        from plans where code = 'active' and currency = 'EUR') = (59::numeric, 11::numeric, 39::numeric)
                 and (select base_price_month from plans where code = 'premium' and currency = 'EUR') = 289,
                 'la grille EUR : 0, 59 / 11 / 39, 289');
  perform assert((select (max_users, max_active_cases, office_included_users)
                    from plans where code = 'active' and currency = 'EUR') = (4, 150, 2),
                 'les volumes sont les mêmes en euros');
  perform assert(exists (select 1 from pg_constraint where conname = 'plans_code_currency_key')
                 and not exists (select 1 from pg_constraint where conname = 'plans_code_key'),
                 'la clé de la grille est (code, devise)');

  select count(*) into n from plan_features pf join plans p2 on p2.id = pf.plan_id
   where p2.code = 'active' and p2.currency = 'TND';
  perform assert(n = 6, 'Active ouvre six fonctionnalités');
  perform assert(not exists (select 1 from plan_features pf join plans p2 on p2.id = pf.plan_id join features f on f.id = pf.feature_id
                             where p2.code = 'active' and f.code in ('ADVANCED_REPORTS','API','WHITE_LABEL','CUSTOM_ROLES')),
                 'rapports avancés, API, marque blanche et rôles sur mesure sont Premium seulement');
  perform assert((select count(*) from plan_features pf join plans p2 on p2.id = pf.plan_id where p2.code = 'premium' and p2.currency = 'EUR') = 10
                 and (select count(*) from plan_features pf join plans p2 on p2.id = pf.plan_id where p2.code = 'essai' and p2.currency = 'TND') = 10,
                 'Essai et Premium ouvrent les dix, dans les deux devises');
  perform assert((select limit_value from plan_features pf join plans p2 on p2.id = pf.plan_id join features f on f.id = pf.feature_id
                   where p2.code = 'active' and p2.currency = 'TND' and f.code = 'WHATSAPP') is null,
                 'WhatsApp n''est pas plafonné : le compte Meta est celui de l''agence');

  -- ---------------------------------------------------------------
  -- 2 · La formule du mensuel sur les huit agences types (5.8)
  -- ---------------------------------------------------------------
  perform assert(plan_monthly_amount('active', 'TND', 2, 1) = 179, 'agence de quartier, 2 comptes : 179');
  perform assert(plan_monthly_amount('active', 'TND', 4, 1) = 179, 'petite agence, 4 comptes : 179');
  perform assert(plan_monthly_amount('active', 'TND', 6, 1) = 249, 'petite agence qui grandit, 6 comptes : 249');
  perform assert(plan_monthly_amount('active', 'TND', 5, 1) = 214, 'transitaire de Radès, 5 comptes : 214');
  perform assert(plan_monthly_amount('active', 'TND', 8, 2) = 368, 'Tunis et Sfax, 8 comptes, 2 bureaux : 368');
  perform assert(plan_monthly_amount('active', 'TND', 12, 3) = 557, 'trois bureaux, 12 comptes : 557');
  perform assert(plan_monthly_amount('active', 'TND', 25, 5) = 1110, 'grande agence en Active coûterait 1 110');
  perform assert(plan_monthly_amount('active', 'TND', 40, 8) = 1782, 'réseau en Active coûterait 1 782');
  perform assert(plan_monthly_amount('premium', 'TND', 25, 5) = 890 and plan_monthly_amount('premium', 'TND', 40, 8) = 890,
                 'Premium : 890, quels que soient les comptes et les bureaux');
  perform assert(plan_monthly_amount('active', 'EUR', 2, 1) = 59 and plan_monthly_amount('active', 'EUR', 6, 1) = 81
                 and plan_monthly_amount('active', 'EUR', 5, 1) = 70 and plan_monthly_amount('active', 'EUR', 8, 2) = 120
                 and plan_monthly_amount('active', 'EUR', 12, 3) = 181 and plan_monthly_amount('premium', 'EUR', 25, 5) = 289,
                 'la même formule en euros : 59, 81, 70, 120, 181, 289');
  perform assert(plan_monthly_amount('essai', 'TND', 10, 1) = 0, 'l''essai vaut zéro');
  perform assert(plan_monthly_amount('starter', 'TND', 3, 1) is null and plan_monthly_amount('active', 'XXX', 3, 1) is null,
                 'un plan retiré ou une devise inconnue ne valent rien');

  -- Le point de bascule (1.4) : à un bureau, Premium devient moins cher au 25e compte.
  perform assert(plan_monthly_amount('active', 'TND', 24, 1) = 879 and plan_monthly_amount('active', 'TND', 25, 1) = 914,
                 'à un bureau, 24 comptes font 879 et 25 comptes 914 : la bascule est au 25e');
  perform assert(plan_monthly_amount('active', 'TND', 4, 7) = 893, 'six bureaux en plus dépassent Premium dès le socle');

  -- L'estimation publique (5.7).
  j := plan_estimate(8, 2, 'TND');
  perform assert(j ->> 'plan' = 'active' and (j ->> 'monthly')::numeric = 368 and (j ->> 'annual')::numeric = 4416
                 and (j ->> 'extra_offices')::int = 1 and (j ->> 'extra_users')::int = 2 and (j ->> 'premium_monthly')::numeric = 890,
                 'l''estimation conseille Active à 368 pour 8 comptes et 2 bureaux, Premium en dessous');
  j := plan_estimate(25, 5, 'TND');
  perform assert(j ->> 'plan' = 'premium' and (j ->> 'monthly')::numeric = 890 and (j ->> 'active_monthly')::numeric = 1110
                 and not (j ->> 'devis')::boolean,
                 'la grande agence est conseillée en Premium, avec ce qu''Active lui coûterait');
  perform assert((plan_estimate(4, 7, 'TND') ->> 'plan') = 'premium', 'dès le septième bureau, Premium');
  perform assert((plan_estimate(70, 1, 'TND') ->> 'devis')::boolean and (plan_estimate(70, 1, 'TND') ->> 'plan') = 'premium',
                 'au-delà de 60 comptes, Premium sur devis');
  perform assert((plan_estimate(3, 1, 'EUR') ->> 'monthly')::numeric = 59 and (plan_estimate(3, 1, 'EUR') ->> 'annual')::numeric = 708,
                 'l''agence de Dakar : 59 € par mois, 708 € par an');

  -- ---------------------------------------------------------------
  -- 3 · L'essai naît comme avant, sur la ligne TND
  -- ---------------------------------------------------------------
  perform gr_as(v_admin);
  v_ag := platform_create_agency('Banc Grille A', 'banc-grille-a-' || sfx, 'Tunisie', 'par_dossier', 8, 'Tunis');
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  perform assert((select count(*) from subscriptions s2 join plans p2 on p2.id = s2.plan_id
                   where s2.agency_id = v_ag and s2.status = 'essai' and p2.code = 'essai' and p2.currency = 'TND') = 1,
                 'une agence neuve naît en essai, sur la ligne TND');
  perform assert((select trial_ends_on from subscriptions where agency_id = v_ag) = current_date + 15,
                 'l''essai dure quinze jours');
  j := agency_plan(v_ag);
  perform assert(j ->> 'plan_code' = 'essai' and (j ->> 'monthly_amount')::numeric = 0 and (j ->> 'annual_amount')::numeric = 0
                 and j ->> 'currency' = 'TND' and (j ->> 'base_price_month')::numeric = 0,
                 'l''essai ne doit rien : mensuel et annuel à zéro');
  perform assert((j -> 'limits' ->> 'users')::int = 10 and (j -> 'limits' ->> 'offices')::int = 1
                 and (j -> 'limits' ->> 'cases')::int = 30 and (j -> 'limits' ->> 'shipments')::int = 10
                 and (j -> 'limits' ->> 'storage_mb')::int = 2048 and (j ->> 'seats_allowed')::int = 10,
                 'l''essai est borné en volume : 10 comptes, 1 bureau, 30 dossiers, 10 cargaisons, 2 Go');
  perform assert(j ? 'invoice_lines' and j ? 'invoice_totals' and j ? 'fair_use' and j ? 'extra_users' and j ? 'extra_offices'
                 and j ? 'extra_user_price_month' and j ? 'extra_office_price_month' and j ? 'included',
                 'agency_plan porte les clés nouvelles du contrat');
  perform assert(jsonb_array_length(j -> 'invoice_lines') = 0 and (j -> 'invoice_totals' ->> 'net_a_payer')::numeric = 0,
                 'un essai n''a pas de ligne de facture, et rien à payer');
  perform assert(j -> 'fair_use' = 'null'::jsonb, 'l''usage raisonnable ne concerne pas l''essai');
  perform assert(quota_limit(v_ag, 'storage') = 2048::bigint * 1024 * 1024, 'la limite de stockage se lit en octets');
  perform assert(agency_has_feature(v_ag, 'WHITE_LABEL'), 'une agence en essai a tout, marque blanche comprise');

  -- ---------------------------------------------------------------
  -- 4 · Passer en Active : le socle, puis les ajouts et leur prorata
  -- ---------------------------------------------------------------
  perform gr_as(v_admin);
  j := platform_set_subscription(v_ag, 'active');
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  perform assert(j ->> 'plan_code' = 'active' and j ->> 'status' = 'active' and j ->> 'currency' = 'TND',
                 'la plateforme pose Active en dinars');
  perform assert((j ->> 'monthly_amount')::numeric = 179 and (j ->> 'annual_amount')::numeric = 2148,
                 'le socle : 179 par mois, 2 148 par an');
  perform assert((j ->> 'seats')::int = 4 and (j ->> 'seats_allowed')::int = 4
                 and (j ->> 'extra_users')::int = 0 and (j ->> 'extra_offices')::int = 0,
                 'quatre sièges, calculés, aucun ajout');
  perform assert((j ->> 'base_price_month')::numeric = 179 and (j ->> 'extra_user_price_month')::numeric = 35
                 and (j ->> 'extra_office_price_month')::numeric = 119,
                 'les prix sont figés sur la souscription');
  perform assert((j ->> 'prorata')::numeric = 0, 'poser un plan n''a pas de prorata');
  perform assert((select price_per_user_month from subscriptions where agency_id = v_ag and status = 'active') = 0,
                 'le prix par utilisateur est à zéro sur la souscription neuve');
  perform assert(agency_has_feature(v_ag, 'CRM') and agency_has_feature(v_ag, 'WHATSAPP') and agency_has_feature(v_ag, 'ACCOUNTING')
                 and not agency_has_feature(v_ag, 'API') and not agency_has_feature(v_ag, 'WHITE_LABEL'),
                 'Active ouvre le métier, le commercial, WhatsApp et la comptabilité ; ni API ni marque blanche');

  -- `p_seats` de l'ancien code est ignoré : les sièges se calculent.
  perform gr_as(v_admin);
  j := platform_set_subscription(v_ag, 'active', 99);
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert((j ->> 'seats')::int = 4, 'p_seats est ignoré sur Active : les sièges se calculent');

  -- Les lignes et les totaux du socle seul.
  l := subscription_invoice_lines(v_ag);
  perform assert(jsonb_array_length(l) = 1 and l -> 0 ->> 'kind' = 'socle' and (l -> 0 ->> 'quantity')::int = 12
                 and (l -> 0 ->> 'unit_price')::numeric = 179 and (l -> 0 ->> 'total')::numeric = 2148,
                 'la facture du socle : une ligne, 12 mois à 179, 2 148');
  t := subscription_invoice_totals(v_ag);
  perform assert((t ->> 'ht')::numeric = 2148 and (t ->> 'tva_rate')::numeric = 0.19 and (t ->> 'tva')::numeric = 408.12
                 and (t ->> 'ttc')::numeric = 2556.12,
                 'HT 2 148, TVA 19 % = 408,12, TTC 2 556,12');
  perform assert((t ->> 'withholding_rate')::numeric = 0.01 and (t ->> 'retenue')::numeric = 25.561
                 and (t ->> 'net_a_payer')::numeric = 2530.559,
                 'retenue à la source 1 % = 25,561, net à payer 2 530,559');
  perform assert(t ->> 'period' = 'annuel' and (t ->> 'monthly')::numeric = 179 and t ->> 'currency' = 'TND',
                 'les totaux disent la période, le mensuel et la devise');
  perform assert((select vat_rate from billing_settings where id) = 0.19 and (select withholding_rate from billing_settings where id) = 0.01,
                 'les taux vivent dans billing_settings, 19 % et 1 % par défaut');

  -- Un bureau et deux comptes de plus, en cours d'année : le prorata.
  select renewal_on into d from subscriptions where agency_id = v_ag and status = 'active';
  v_mois := ceil((d - current_date) / 30.0)::int;
  perform gr_as(v_admin);
  j := platform_set_subscription(v_ag, 'active', null, null, 'active', 2, 1);
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert((j ->> 'monthly_amount')::numeric = 368 and (j ->> 'annual_amount')::numeric = 4416,
                 'un bureau et deux comptes en plus : 368 par mois, 4 416 par an');
  perform assert((j ->> 'seats')::int = 8 and (j ->> 'seats_allowed')::int = 8
                 and (j ->> 'extra_users')::int = 2 and (j ->> 'extra_offices')::int = 1,
                 'huit sièges : 4 du socle, 2 du bureau, 2 achetés');
  perform assert((j ->> 'prorata')::numeric = round((2 * 35 + 119) * v_mois, 3) and (j ->> 'mois_restants')::int = v_mois,
                 'le prorata : 189 × ' || v_mois || ' mois restants = ' || (j ->> 'prorata'));
  -- Tous les événements du banc partagent le même `at` (l'heure de la
  -- transaction) : on retrouve la ligne par son contenu, pas par l'heure.
  select detail into e from subscription_events where agency_id = v_ag and kind = 'changement_plan'
     and (detail ->> 'extra_users')::int = 2 and (detail ->> 'extra_offices')::int = 1;
  perform assert((e ->> 'prorata')::numeric = round((2 * 35 + 119) * v_mois, 3)
                 and (e ->> 'extra_users_avant')::int = 0 and (e ->> 'extra_users')::int = 2
                 and (e ->> 'extra_offices')::int = 1 and (e ->> 'mois_restants')::int = v_mois,
                 'l''ajout entre au journal en changement_plan, avec son prorata');
  perform assert((j -> 'limits' ->> 'users')::int = 8 and (j -> 'limits' ->> 'offices')::int = 2
                 and (j -> 'limits' ->> 'cases')::int = 225 and (j -> 'limits' ->> 'shipments')::int = 150
                 and (j -> 'limits' ->> 'storage_mb')::int = 12288 + 2 * 3072 + 6144,
                 'les limites suivent : 8 comptes, 2 bureaux, 225 dossiers, 150 cargaisons, 24 Go');
  perform assert(quota_limit(v_ag, 'users') = 8 and quota_limit(v_ag, 'offices') = 2 and quota_limit(v_ag, 'cases') = 225
                 and quota_limit(v_ag, 'shipments') = 150 and quota_limit(v_ag, 'storage') = 24576::bigint * 1024 * 1024
                 and quota_limit(v_ag, 'clients') is null,
                 'quota_limit lit le socle et les ajouts ; les clients ne sont jamais plafonnés');

  l := subscription_invoice_lines(v_ag);
  perform assert(jsonb_array_length(l) = 3
                 and (select string_agg(x ->> 'kind', ',') from jsonb_array_elements(l) x) = 'socle,bureau,compte',
                 'trois lignes : socle, bureau, compte');
  perform assert((select (x ->> 'quantity')::int from jsonb_array_elements(l) x where x ->> 'kind' = 'bureau') = 12
                 and (select (x ->> 'unit_price')::numeric from jsonb_array_elements(l) x where x ->> 'kind' = 'bureau') = 119
                 and (select (x ->> 'total')::numeric from jsonb_array_elements(l) x where x ->> 'kind' = 'bureau') = 1428,
                 'la ligne du bureau : 12 mois à 119, 1 428');
  perform assert((select (x ->> 'quantity')::int from jsonb_array_elements(l) x where x ->> 'kind' = 'compte') = 24
                 and (select (x ->> 'total')::numeric from jsonb_array_elements(l) x where x ->> 'kind' = 'compte') = 840,
                 'la ligne des comptes : 2 × 12 mois à 35, 840');
  perform assert((select sum((x ->> 'total')::numeric) from jsonb_array_elements(l) x) = subscription_invoice_amount(v_ag),
                 'la somme des lignes est le montant facturé');
  perform assert((select bool_and(x ? 'label' and x ? 'quantity' and x ? 'unit_price' and x ? 'total' and x ? 'kind')
                    from jsonb_array_elements(l) x),
                 'chaque ligne porte ses cinq clés');

  -- Retirer les ajouts : pas de prorata à la baisse.
  perform gr_as(v_admin);
  j := platform_set_subscription(v_ag, 'active', null, null, 'active', 0, 0);
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert((j ->> 'prorata')::numeric = 0 and (j ->> 'monthly_amount')::numeric = 179,
                 'retirer un ajout ne facture rien et ramène au socle');

  -- ---------------------------------------------------------------
  -- 5 · Le semestre, et la remise
  -- ---------------------------------------------------------------
  perform gr_as(v_admin);
  j := platform_set_subscription(v_ag, 'active', null, null, 'active', null, null, 'semestriel');
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert((j ->> 'annual_amount')::numeric = 1181 and j ->> 'billing_period' = 'semestriel',
                 'le semestre : 179 × 6 × 1,10 = 1 181, arrondi au dinar');
  t := subscription_invoice_totals(v_ag);
  perform assert(t ->> 'period' = 'semestriel' and (t ->> 'ht')::numeric = 1181,
                 'les totaux disent semestriel');
  l := subscription_invoice_lines(v_ag);
  perform assert((l -> 0 ->> 'quantity')::int = 6 and (l -> 0 ->> 'total')::numeric = 1181,
                 'la ligne du socle au semestre : 6 mois, 1 181');

  ok := false;
  begin
    perform gr_as(v_admin);
    perform platform_set_subscription(v_ag, 'essai', null, null, 'essai', null, null, 'semestriel');
  exception when others then ok := true;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert(ok, 'le semestre n''existe pas sur l''essai');

  perform gr_as(v_admin);
  j := platform_set_subscription(v_ag, 'active', null, null, 'active', null, null, 'annuel',
                                 15, 'lancement 2027', current_date + 300);
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert((j ->> 'annual_amount')::numeric = 1825.8 and (j ->> 'discount_pct')::numeric = 15
                 and j ->> 'discount_label' = 'lancement 2027',
                 'la remise de lancement : 2 148 moins 15 % = 1 825,8');
  l := subscription_invoice_lines(v_ag);
  perform assert(jsonb_array_length(l) = 2 and l -> 1 ->> 'kind' = 'remise'
                 and (l -> 1 ->> 'total')::numeric = -322.2 and (l -> 1 ->> 'unit_price')::numeric = -15,
                 'la remise est une ligne à part : moins 322,2');
  perform assert((subscription_invoice_totals(v_ag) ->> 'ht')::numeric = 1825.8, 'les totaux partent du montant remisé');

  update subscriptions set discount_until = current_date - 1 where agency_id = v_ag and status = 'active';
  perform assert(subscription_invoice_amount(v_ag) = 2148 and jsonb_array_length(subscription_invoice_lines(v_ag)) = 1,
                 'la remise passée ne s''applique plus : 2 148, sans ligne de remise');

  ok := false;
  begin
    perform gr_as(v_admin);
    perform platform_set_subscription(v_ag, 'active', null, null, 'active', null, null, null, 20);
  exception when others then ok := true;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert(ok, 'une remise de 20 % est refusée : le plafond est 15');

  perform gr_as(v_admin);
  j := platform_set_subscription(v_ag, 'active', null, null, 'active', null, null, null, 0);
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert((j ->> 'discount_pct')::numeric = 0 and j ->> 'discount_label' is null and (j ->> 'annual_amount')::numeric = 2148,
                 'remise à zéro : libellé effacé, plein tarif');

  -- Le prix reste figé : une hausse de la grille ne rattrape pas l'agence.
  update plans set base_price_month = 999 where code = 'active' and currency = 'TND';
  perform assert(subscription_monthly_amount(v_ag) = 179, 'le prix est figé à la signature, la grille peut bouger');
  update plans set base_price_month = 179 where code = 'active' and currency = 'TND';

  -- ---------------------------------------------------------------
  -- 6 · Une agence en euros
  -- ---------------------------------------------------------------
  perform gr_as(v_admin);
  v_ag2 := platform_create_agency('Banc Grille Casablanca', 'banc-grille-b-' || sfx, 'Maroc', 'par_dossier', 8, 'Casablanca');
  j := platform_set_subscription(v_ag2, 'active', null, null, 'active', 2, 1, null, null, null, null, 'EUR');
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert(j ->> 'currency' = 'EUR' and (j ->> 'monthly_amount')::numeric = 120 and (j ->> 'annual_amount')::numeric = 1440,
                 'Casablanca, 8 comptes et 2 bureaux : 120 € par mois, 1 440 € par an');
  t := subscription_invoice_totals(v_ag2);
  perform assert((t ->> 'tva')::numeric = 0 and (t ->> 'retenue')::numeric = 0 and (t ->> 'net_a_payer')::numeric = 1440
                 and t ->> 'currency' = 'EUR' and (t ->> 'tva_rate')::numeric = 0,
                 'en euros : ni TVA ni retenue, net à payer 1 440');
  perform assert((select count(*) from subscriptions s2 join plans p2 on p2.id = s2.plan_id
                   where s2.agency_id = v_ag2 and s2.status = 'active' and p2.currency = 'EUR') = 1,
                 'la souscription pointe sur la ligne EUR du plan');

  -- La devise se garde d'un geste à l'autre.
  perform gr_as(v_admin);
  j := platform_set_subscription(v_ag2, 'active', null, null, 'active', 3);
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert(j ->> 'currency' = 'EUR' and (j ->> 'monthly_amount')::numeric = 131,
                 'sans devise demandée, la souscription garde l''euro : 59 + 39 + 3 × 11 = 131');

  -- ---------------------------------------------------------------
  -- 7 · Premium : illimité, mesuré, jamais bloqué
  -- ---------------------------------------------------------------
  perform gr_as(v_admin);
  v_ag3 := platform_create_agency('Banc Grille Réseau', 'banc-grille-c-' || sfx, 'Tunisie', 'par_dossier', 8, 'Sfax');
  j := platform_set_subscription(v_ag3, 'premium', null, null, 'active', 5, 3);
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert((j ->> 'monthly_amount')::numeric = 890 and (j ->> 'annual_amount')::numeric = 10680,
                 'Premium : 890 par mois, 10 680 par an');
  perform assert((j ->> 'extra_users')::int = 0 and (j ->> 'extra_offices')::int = 0,
                 'les ajouts demandés sur Premium sont ignorés : rien n''est à ajouter');
  perform assert(j ->> 'seats_allowed' is null and quota_limit(v_ag3, 'users') is null and quota_limit(v_ag3, 'offices') is null
                 and quota_limit(v_ag3, 'cases') is null and quota_limit(v_ag3, 'storage') is null,
                 'Premium n''a aucune limite : null partout');
  perform assert((j -> 'fair_use' ->> 'users')::int = 60 and (j -> 'fair_use' ->> 'offices')::int = 15
                 and (j -> 'fair_use' ->> 'storage_min_mb')::int = 61440,
                 'agency_plan dit l''usage raisonnable de Premium');
  perform assert(agency_has_feature(v_ag3, 'API') and agency_has_feature(v_ag3, 'WHITE_LABEL')
                 and agency_has_feature(v_ag3, 'ADVANCED_REPORTS') and agency_has_feature(v_ag3, 'CUSTOM_ROLES'),
                 'Premium ouvre l''API, la marque blanche, les rapports avancés et les rôles sur mesure');
  l := subscription_invoice_lines(v_ag3);
  perform assert(jsonb_array_length(l) = 1 and l -> 0 ->> 'kind' = 'socle' and (l -> 0 ->> 'total')::numeric = 10680
                 and l -> 0 ->> 'label' like 'Licence Premium%',
                 'la facture Premium : une seule ligne, 12 mois à 890');
  perform assert((subscription_invoice_totals(v_ag3) ->> 'net_a_payer')::numeric = round(10680 * 1.19 - round(10680 * 1.19 * 0.01, 3), 3),
                 'les totaux Premium suivent la même règle');

  -- ---------------------------------------------------------------
  -- 8 · Le garde dur cite le prix
  -- ---------------------------------------------------------------
  select id into v_off from offices where agency_id = v_ag limit 1;
  for i in 1..4 loop
    insert into auth.users (id) values (gen_random_uuid()) returning id into v_u;
    insert into profiles (id, agency_id, office_id, name, role)
      values (v_u, v_ag, v_off, 'Compte ' || i, case when i = 1 then 'owner' else 'agent' end);
    if i = 1 then v_owner := v_u; end if;
  end loop;
  perform assert(quota_used(v_ag, 'users') = 4, 'quatre comptes ouverts sur Active');

  s := null;
  begin
    insert into auth.users (id) values (gen_random_uuid()) returning id into v_u;
    insert into profiles (id, agency_id, office_id, name, role) values (v_u, v_ag, v_off, 'Cinquième', 'agent');
  exception when others then s := sqlerrm;
  end;
  perform assert(s is not null, 'le cinquième compte est refusé');
  perform assert(s = '4 comptes sur 4, un compte de plus coûte 35 DT par mois',
                 'et le message cite le prix : « ' || s || ' »');
  perform assert(quota_used(v_ag, 'users') = 4, 'le compte refusé n''a rien laissé');

  s := null;
  begin
    insert into offices (agency_id, name, country, country_code) values (v_ag, 'Sfax', 'Tunisie', 'TN');
  exception when others then s := sqlerrm;
  end;
  perform assert(s = '1 bureaux sur 1, un bureau de plus coûte 119 DT par mois',
                 'le deuxième bureau est refusé, avec son prix : « ' || s || ' »');

  -- Un bureau acheté : il passe, et le troisième est refusé.
  perform gr_as(v_admin);
  perform platform_set_subscription(v_ag, 'active', null, null, 'active', 0, 1);
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  insert into offices (agency_id, name, country, country_code) values (v_ag, 'Sfax', 'Tunisie', 'TN') returning id into v_off2;
  perform assert(quota_used(v_ag, 'offices') = 2, 'le bureau acheté ouvre la porte au deuxième bureau');
  s := null;
  begin
    insert into offices (agency_id, name, country, country_code) values (v_ag, 'Sousse', 'Tunisie', 'TN');
  exception when others then s := sqlerrm;
  end;
  perform assert(s = '2 bureaux sur 2, un bureau de plus coûte 119 DT par mois', 'le troisième tombe sur le garde');
  -- Le bureau apporte deux comptes : le cinquième et le sixième passent.
  for i in 5..6 loop
    insert into auth.users (id) values (gen_random_uuid()) returning id into v_u;
    insert into profiles (id, agency_id, office_id, name, role) values (v_u, v_ag, v_off2, 'Compte ' || i, 'agent');
  end loop;
  perform assert(quota_used(v_ag, 'users') = 6 and quota_limit(v_ag, 'users') = 6,
                 'le bureau en plus apporte deux comptes, qui passent');

  -- En euros, le message est en euros.
  select id into v_off from offices where agency_id = v_ag2 limit 1;
  perform gr_as(v_admin);
  perform platform_set_subscription(v_ag2, 'active', null, null, 'active', 0, 0);
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  for i in 1..4 loop
    insert into auth.users (id) values (gen_random_uuid()) returning id into v_u;
    insert into profiles (id, agency_id, office_id, name, role) values (v_u, v_ag2, v_off, 'Compte ' || i, 'agent');
  end loop;
  s := null;
  begin
    insert into auth.users (id) values (gen_random_uuid()) returning id into v_u;
    insert into profiles (id, agency_id, office_id, name, role) values (v_u, v_ag2, v_off, 'Cinquième', 'agent');
  exception when others then s := sqlerrm;
  end;
  perform assert(s = '4 comptes sur 4, un compte de plus coûte 11 EUR par mois',
                 'en euros, le garde cite 11 EUR : « ' || s || ' »');

  -- À l'essai, il n'y a rien à acheter : le message le dit.
  perform gr_as(v_admin);
  v_ag4 := platform_create_agency('Banc Grille Essai', 'banc-grille-d-' || sfx, 'Tunisie', 'par_dossier', 8, 'Gabès');
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  s := null;
  begin
    insert into offices (agency_id, name, country, country_code) values (v_ag4, 'Nabeul', 'Tunisie', 'TN');
  exception when others then s := sqlerrm;
  end;
  perform assert(s like '1 bureaux sur 1 : l''essai est borné%', 'à l''essai, le garde propose de passer en Active');

  -- Premium ne garde rien.
  select id into v_off from offices where agency_id = v_ag3 limit 1;
  for i in 1..3 loop
    insert into offices (agency_id, name, country, country_code) values (v_ag3, 'Bureau ' || i, 'Tunisie', 'TN');
  end loop;
  perform assert(quota_used(v_ag3, 'offices') = 4, 'Premium ouvre les bureaux sans garde');

  -- ---------------------------------------------------------------
  -- 9 · Le palier doux : 80, 100, 120 %, et trente jours
  -- ---------------------------------------------------------------
  -- On serre le socle à cinq dossiers, deux cargaisons et un mégaoctet le
  -- temps du test : c'est la seule façon de franchir les paliers sans poser
  -- cent cinquante dossiers. Le prologue et la fin remettent la grille.
  update plans set max_active_cases = 5, max_active_shipments = 2, max_storage_mb = 1
   where code = 'active' and currency = 'TND';
  perform gr_as(v_admin);
  perform platform_set_subscription(v_ag, 'active', null, null, 'active', 0, 0);
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert(quota_limit(v_ag, 'cases') = 5, 'le socle serré : cinq dossiers');

  select id into v_off from offices where agency_id = v_ag order by created_at limit 1;
  select id into v_vt from visa_types where agency_id = v_ag limit 1;
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (v_ag, v_off, 'Mohamed', 'Bouazizi', '+216 20 00' || substr(sfx, 1, 4)) returning id into v_cl;

  j := quota_soft_state(v_ag, 'cases');
  perform assert(j ->> 'niveau' = 'ok' and (j ->> 'used')::int = 0 and (j ->> 'limit')::int = 5 and (j ->> 'pct')::numeric = 0,
                 'sans dossier, le palier est ok');
  for i in 1..4 loop
    insert into cases (agency_id, reference, client_id, visa_type_id, office_id)
      values (v_ag, 'GR-' || sfx || '-' || i, v_cl, v_vt, v_off);
  end loop;
  j := quota_soft_state(v_ag, 'cases');
  perform assert(j ->> 'niveau' = 'info' and (j ->> 'pct')::numeric = 80 and j ->> 'depuis' is null,
                 'quatre dossiers sur cinq : 80 %, information');
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id)
    values (v_ag, 'GR-' || sfx || '-5', v_cl, v_vt, v_off) returning id into v_case;
  j := quota_soft_state(v_ag, 'cases');
  perform assert(j ->> 'niveau' = 'attention' and (j ->> 'pct')::numeric = 100 and (j ->> 'depuis')::date = current_date,
                 'cinq sur cinq : 100 %, attention, depuis aujourd''hui');
  perform refresh_usage(v_ag);
  perform assert((select over_since_cases from usage_counters where agency_id = v_ag) = current_date,
                 'refresh_usage mémorise le jour du passage à la limite');
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id)
    values (v_ag, 'GR-' || sfx || '-6', v_cl, v_vt, v_off);
  j := quota_soft_state(v_ag, 'cases');
  perform assert(j ->> 'niveau' = 'bloque' and (j ->> 'pct')::numeric = 120,
                 'six sur cinq : 120 %, la création se bloque');
  -- Tout le reste continue : rien n'empêche de clôturer.
  update cases set status = 'accepte' where reference = 'GR-' || sfx || '-6';
  perform assert((quota_soft_state(v_ag, 'cases') ->> 'niveau') = 'attention',
                 'clôturer un dossier ramène à 100 % : attention, plus bloqué');
  -- À 100 % depuis plus de trente jours, la création se bloque aussi.
  update usage_counters set over_since_cases = current_date - 31 where agency_id = v_ag;
  j := quota_soft_state(v_ag, 'cases');
  perform assert(j ->> 'niveau' = 'bloque' and (j ->> 'depuis')::date = current_date - 31,
                 'à 100 % depuis trente et un jours : bloqué, avec la date');
  perform refresh_usage(v_ag);
  perform assert((select over_since_cases from usage_counters where agency_id = v_ag) = current_date - 31,
                 'refresh_usage garde la date du premier passage, il ne la rajeunit pas');
  update cases set status = 'accepte' where id = v_case;
  perform refresh_usage(v_ag);
  j := quota_soft_state(v_ag, 'cases');
  perform assert(j ->> 'niveau' = 'info' and j ->> 'depuis' is null
                 and (select over_since_cases from usage_counters where agency_id = v_ag) is null,
                 'repasser sous la limite efface la date : information, plus rien de bloqué');

  insert into shipments (agency_id, reference, mode) values (v_ag, 'SH-' || sfx || '-1', 'aerien');
  perform assert((quota_soft_state(v_ag, 'shipments') ->> 'niveau') = 'ok', 'une cargaison sur deux : ok');
  insert into shipments (agency_id, reference, mode) values (v_ag, 'SH-' || sfx || '-2', 'aerien');
  perform assert((quota_soft_state(v_ag, 'shipments') ->> 'niveau') = 'attention', 'deux sur deux : attention');
  insert into shipments (agency_id, reference, mode) values (v_ag, 'SH-' || sfx || '-3', 'aerien');
  perform assert((quota_soft_state(v_ag, 'shipments') ->> 'niveau') = 'bloque', 'trois sur deux : 150 %, bloqué');
  update shipments set status = 'livree' where agency_id = v_ag and reference = 'SH-' || sfx || '-3';
  perform assert((quota_soft_state(v_ag, 'shipments') ->> 'niveau') = 'attention', 'une cargaison livrée libère la place');

  insert into case_documents (agency_id, case_id, key, label, file_size)
    values (v_ag, v_case, 'passeport', '{"fr":"Passeport"}', 900000);
  j := quota_soft_state(v_ag, 'storage');
  perform assert(j ->> 'niveau' = 'info' and (j ->> 'limit')::bigint = 1048576 and (j ->> 'used')::bigint = 900000,
                 '900 Ko sur 1 Mo : 85,8 %, information');
  insert into case_documents (agency_id, case_id, key, label, file_size)
    values (v_ag, v_case, 'photo', '{"fr":"Photo"}', 400000);
  perform assert((quota_soft_state(v_ag, 'storage') ->> 'niveau') = 'bloque', '1,3 Mo sur 1 Mo : 124 %, les dépôts se bloquent');
  perform assert(quota_used(v_ag, 'storage') = 1300000, 'rien n''est effacé : tout reste lisible');
  delete from case_documents where agency_id = v_ag and key = 'photo';

  ok := false;
  begin
    perform quota_soft_state(v_ag, 'ressource_inventee');
  exception when others then ok := true;
  end;
  perform assert(ok, 'une ressource inconnue est refusée, pas rendue vide');

  update plans set max_active_cases = 150, max_active_shipments = 100, max_storage_mb = 12288
   where code = 'active' and currency = 'TND';
  perform assert((quota_soft_state(v_ag, 'cases') ->> 'niveau') = 'ok', 'la grille remise, tout est ok');

  -- Premium : l'usage raisonnable se signale, ne bloque jamais.
  update plans set fair_use_users = 1 where code = 'premium';
  select id into v_off from offices where agency_id = v_ag3 order by created_at limit 1;
  for i in 1..2 loop
    insert into auth.users (id) values (gen_random_uuid()) returning id into v_u;
    insert into profiles (id, agency_id, office_id, name, role) values (v_u, v_ag3, v_off, 'Premium ' || i, 'agent');
  end loop;
  j := quota_soft_state(v_ag3, 'users');
  perform assert(j ->> 'niveau' = 'attention' and (j ->> 'pct')::numeric = 200 and (j ->> 'limit')::int = 1,
                 'Premium à 200 % de l''usage raisonnable : attention, jamais bloqué');
  perform assert((quota_soft_state(v_ag3, 'cases') ->> 'niveau') = 'ok' and (quota_soft_state(v_ag3, 'cases') ->> 'limit') is null,
                 'les dossiers de Premium n''ont pas de palier');
  perform refresh_usage(v_ag3);
  perform assert((select count(*) from subscription_events where agency_id = v_ag3 and kind = 'usage_raisonnable') = 1,
                 'le dépassement d''usage raisonnable entre au journal, pour Nadir');
  perform refresh_usage(v_ag3);
  perform assert((select count(*) from subscription_events where agency_id = v_ag3 and kind = 'usage_raisonnable') = 1,
                 'une fois par vingt-quatre heures, pas plus');
  update plans set fair_use_users = 60 where code = 'premium';

  -- Les compteurs du mois repartent de zéro le premier.
  update usage_counters set emails_month = 12, egress_bytes_month = 999, month_started_on = current_date - 40 where agency_id = v_ag;
  perform refresh_usage(v_ag);
  perform assert((select (emails_month, egress_bytes_month) from usage_counters where agency_id = v_ag) = (0, 0::bigint)
                 and (select month_started_on from usage_counters where agency_id = v_ag) = date_trunc('month', current_date)::date,
                 'les courriels et la sortie du mois sont remis à zéro au changement de mois');
  update usage_counters set emails_month = 12 where agency_id = v_ag;
  perform refresh_usage(v_ag);
  perform assert((select emails_month from usage_counters where agency_id = v_ag) = 12,
                 'dans le mois, refresh_usage ne touche pas aux compteurs du mois');

  -- ---------------------------------------------------------------
  -- 10 · Le règlement constaté : complet au net, partiel sinon
  -- ---------------------------------------------------------------
  perform gr_as(v_admin);
  v_ag5 := platform_create_agency('Banc Grille Payeuse', 'banc-grille-e-' || sfx, 'Tunisie', 'par_dossier', 8, 'Sousse');
  perform platform_set_subscription(v_ag5, 'active');
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select renewal_on into d from subscriptions where agency_id = v_ag5 and status = 'active';
  v_net := (subscription_invoice_totals(v_ag5) ->> 'net_a_payer')::numeric;
  perform assert(v_net = 2530.559, 'le net à payer de Banc Payeuse est 2 530,559');

  b := subscription_balance(v_ag5);
  perform assert((b ->> 'solde_du')::numeric = 2530.559 and (b ->> 'regle')::numeric = 0 and b ->> 'dernier_reglement_le' is null,
                 'avant tout règlement, le solde dû est le net à payer');

  -- La moitié : partiel.
  perform gr_as(v_admin);
  p := platform_record_payment(v_ag5, 1265, 'TND', null, null, 'virement', 'GR-' || sfx || '-1');
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert((p ->> 'ok')::boolean and not (p ->> 'complet')::boolean,
                 'la moitié du net est un règlement partiel');
  perform assert((p ->> 'solde_du')::numeric = 1265.559 and (p ->> 'net_a_payer')::numeric = 2530.559,
                 'la fonction rend le solde et le net');
  perform assert((select renewal_on from subscriptions where agency_id = v_ag5 and status = 'active') = d,
                 'un règlement partiel ne repousse pas l''échéance');
  perform assert((select last_payment_on from subscriptions where agency_id = v_ag5) is null,
                 'ni ne pose la date du dernier règlement complet');
  select detail into e from subscription_events where agency_id = v_ag5 and kind = 'paiement'
     and detail ->> 'reference' = 'GR-' || sfx || '-1';
  perform assert((e ->> 'partiel')::boolean and (e ->> 'solde_du')::numeric = 1265.559 and (e ->> 'montant')::numeric = 1265,
                 'le règlement partiel entre au journal avec son solde');
  perform assert((select count(*) from subscription_payments where agency_id = v_ag5) = 1, 'le règlement est bien enregistré');
  b := subscription_balance(v_ag5);
  perform assert((b ->> 'solde_du')::numeric = 1265.559 and (b ->> 'regle')::numeric = 1265
                 and (b ->> 'dernier_reglement_le')::date = current_date,
                 'le solde dû est le net moins ce qui a été reçu sur la période');

  -- Le reste : complet, à un dinar près.
  perform gr_as(v_admin);
  p := platform_record_payment(v_ag5, 1265, 'TND', null, null, 'virement', 'GR-' || sfx || '-2');
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert((p ->> 'complet')::boolean and (p ->> 'solde_du')::numeric = 0 and p ->> 'etat' = 'a_jour',
                 'le reste, à 0,559 dinar près, complète le règlement');
  perform assert((select renewal_on from subscriptions where agency_id = v_ag5) = (current_date + interval '1 year' - interval '1 day')::date
                 and (select last_payment_on from subscriptions where agency_id = v_ag5) = current_date,
                 'le règlement complet repousse l''échéance et date le dernier règlement');
  select detail into e from subscription_events where agency_id = v_ag5 and kind = 'paiement'
     and detail ->> 'reference' = 'GR-' || sfx || '-2';
  perform assert(not (e ->> 'partiel')::boolean and (e ->> 'solde_du')::numeric = 0, 'le journal dit complet');
  perform assert((subscription_balance(v_ag5) ->> 'solde_du')::numeric = 0, 'plus rien n''est dû');

  -- La retenue à la source : payer le net, c'est payer complet.
  perform gr_as(v_admin);
  p := platform_record_payment(v_ag, 2530.56, 'TND', null, null, 'virement', 'GR-' || sfx || '-3');
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert((p ->> 'complet')::boolean and (p ->> 'solde_du')::numeric = 0,
                 'un virement au net à payer, retenue déduite, est complet');

  -- ---------------------------------------------------------------
  -- 11 · La console : la liste, le tableau, la fiche
  -- ---------------------------------------------------------------
  perform gr_as(v_admin);
  j := platform_subscriptions();
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select x into e from jsonb_array_elements(j) x where (x ->> 'agency_id')::uuid = v_ag2;
  perform assert(e ->> 'plan_code' = 'active' and e ->> 'currency' = 'EUR' and (e ->> 'extra_users')::int = 0
                 and (e ->> 'base_price_month')::numeric = 59 and (e ->> 'extra_user_price_month')::numeric = 11
                 and (e ->> 'extra_office_price_month')::numeric = 39,
                 'la liste dit le plan, la devise, les ajouts et les prix figés');
  perform assert((e ->> 'monthly_amount')::numeric = 59 and (e ->> 'annual_amount')::numeric = 708
                 and (e ->> 'discount_pct')::numeric = 0 and e ? 'discount_label' and e ? 'discount_until'
                 and e ->> 'billing_period' = 'annuel' and (e ->> 'seats_allowed')::int = 4,
                 'la liste dit le mensuel, l''annuel, la remise, la période et les sièges autorisés');
  select x into e from jsonb_array_elements(j) x where (x ->> 'agency_id')::uuid = v_ag3;
  perform assert(e -> 'seats_allowed' = 'null'::jsonb and (e ->> 'monthly_amount')::numeric = 890,
                 'Premium dans la liste : sièges autorisés nuls, 890');

  perform gr_as(v_admin);
  j := platform_billing_board();
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select x into e from jsonb_array_elements(j) x where (x ->> 'agency_id')::uuid = v_ag5;
  perform assert((e ->> 'monthly_amount')::numeric = 179 and (e ->> 'annual_amount')::numeric = 2148
                 and (e ->> 'montant_attendu')::numeric = 2148 and e ->> 'currency' = 'TND' and e ->> 'plan_code' = 'active'
                 and (e ->> 'extra_users')::int = 0 and (e ->> 'extra_offices')::int = 0,
                 'le tableau porte le mensuel, l''annuel, la devise, le plan et les ajouts');
  perform assert((e -> 'invoice_totals' ->> 'net_a_payer')::numeric = 2530.559 and (e -> 'invoice_totals' ->> 'tva')::numeric = 408.12,
                 'le tableau porte les totaux de la facture');
  perform assert((e ->> 'solde_du')::numeric = 0 and (e ->> 'dernier_reglement_le')::date = current_date,
                 'Banc Payeuse a tout réglé : solde nul, dernier règlement aujourd''hui');
  select x into e from jsonb_array_elements(j) x where (x ->> 'agency_id')::uuid = v_ag2;
  perform assert((e ->> 'solde_du')::numeric = 708 and e ->> 'dernier_reglement_le' is null,
                 'Casablanca n''a rien réglé : solde dû 708 €');

  perform gr_as(v_admin);
  j := platform_agency_360(v_ag);
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  e := j -> 'abonnement';
  perform assert((e ->> 'extra_users')::int = 0 and (e ->> 'extra_offices')::int = 0 and (e ->> 'monthly_amount')::numeric = 179
                 and (e ->> 'annual_amount')::numeric = 2148 and e ->> 'currency' = 'TND',
                 'la fiche dit les ajouts et les montants');
  perform assert((e -> 'invoice_totals' ->> 'ht')::numeric = 2148 and (e ->> 'seats_allowed')::int = 4
                 and (e ->> 'mensuel')::numeric = (e ->> 'monthly_amount')::numeric,
                 'la fiche porte les totaux, les sièges autorisés, et mensuel = monthly_amount');

  -- ---------------------------------------------------------------
  -- 12 · Le poste de pilotage : MRR en dinars, l'euro à part
  -- ---------------------------------------------------------------
  perform gr_as(v_admin);
  c := platform_cockpit();
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  j := c -> 'kpis';
  select coalesce(sum(subscription_monthly_amount(s2.agency_id)), 0) into m
    from subscriptions s2 where s2.status = 'active' and s2.currency = 'TND';
  perform assert((j ->> 'mrr')::numeric = m and (j ->> 'mrr')::numeric >= 179 + 890 + 179,
                 'le MRR est la somme des mensuels des abonnements actifs en dinars (' || m || ')');
  perform assert((j ->> 'arr')::numeric = m * 12, 'l''ARR est douze fois le MRR');
  select coalesce(sum(subscription_monthly_amount(s2.agency_id)), 0) into m
    from subscriptions s2 where s2.status = 'active' and s2.currency = 'EUR';
  perform assert((j ->> 'mrr_eur')::numeric = m and m >= 59 and (j ->> 'arr_eur')::numeric = m * 12,
                 'l''euro a son propre MRR et son propre ARR : on n''additionne pas deux devises');
  perform assert((j ->> 'mrr_potentiel')::numeric >= 179, 'les essais valent ce qu''ils paieraient en Active');
  perform assert(j ? 'mrr_il_y_a_30j', 'le MRR d''il y a trente jours est là');
  perform assert(jsonb_array_length(c -> 'series' -> 'mrr_12m') = 12
                 and (c -> 'series' -> 'mrr_12m' -> 11 ->> 'amount')::numeric >= 179,
                 'la série du MRR compte les abonnements actifs en dinars');

  -- L'analyse de 0055 lit les mêmes mensuels.
  perform gr_as(v_admin);
  j := platform_analytics();
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert((j ->> 'mrr_total')::numeric >= 179 + 890 + 179 + 59, 'platform_analytics est alignée sur les mensuels');

  -- ---------------------------------------------------------------
  -- 13 · Les demandes : l'estimation de la page publique
  -- ---------------------------------------------------------------
  insert into agency_signups (agency_name, contact_name, phone, email, team_size)
    values ('Banc Grille Demande', 'Slim', '+216 22 ' || substr(sfx, 1, 6), 'demande@banc-grille.test', 8)
    returning id into v_signup;
  insert into agency_signups (agency_name, contact_name, phone, email, team_size)
    values ('Banc Grille Grande', 'Amira', '+216 23 ' || substr(sfx, 1, 6), 'grande@banc-grille.test', 30)
    returning id into v_signup2;
  perform gr_as(v_admin);
  j := platform_signups();
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select x into e from jsonb_array_elements(j) x where (x ->> 'id')::uuid = v_signup;
  perform assert(e ->> 'suggested_plan' = 'active' and (e ->> 'suggested_month')::numeric = 319
                 and (e ->> 'suggested_year')::numeric = 3828,
                 'huit personnes, un bureau : Active à 319 par mois, 3 828 par an');
  select x into e from jsonb_array_elements(j) x where (x ->> 'id')::uuid = v_signup2;
  perform assert(e ->> 'suggested_plan' = 'premium' and (e ->> 'suggested_month')::numeric = 890
                 and (e ->> 'suggested_year')::numeric = 10680,
                 'trente personnes : Premium à 890 par mois');

  -- ---------------------------------------------------------------
  -- 14 · La page publique lit la grille sans session
  -- ---------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  j := public_plans('TND');
  l := public_plans('EUR');
  t := public_plans('XXX');
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', '{}', true);

  perform assert(jsonb_array_length(j) = 3 and (select string_agg(x ->> 'code', ',') from jsonb_array_elements(j) x) = 'essai,active,premium',
                 'l''anonyme lit trois plans en dinars, dans l''ordre');
  perform assert(not exists (select 1 from jsonb_array_elements(j) x where x ->> 'code' in ('starter','pro','business','enterprise')),
                 'les plans retirés n''apparaissent pas');
  select x into e from jsonb_array_elements(j) x where x ->> 'code' = 'active';
  perform assert((e ->> 'base_price_month')::numeric = 179 and (e ->> 'extra_user_price_month')::numeric = 35
                 and (e ->> 'extra_office_price_month')::numeric = 119 and e ->> 'currency' = 'TND',
                 'Active en dinars : 179, 35, 119');
  perform assert(e ? 'code' and e ? 'name' and e ? 'currency' and e ? 'base_price_month' and e ? 'extra_user_price_month'
                 and e ? 'extra_office_price_month' and e ? 'max_users' and e ? 'max_offices' and e ? 'max_active_cases'
                 and e ? 'max_active_shipments' and e ? 'max_storage_mb' and e ? 'office_included_users'
                 and e ? 'office_included_cases' and e ? 'office_included_shipments' and e ? 'office_included_storage_mb'
                 and e ? 'extra_user_storage_mb' and e ? 'fair_use_users' and e ? 'fair_use_offices'
                 and e ? 'fair_use_storage_mb_per_user' and e ? 'fair_use_storage_min_mb' and e ? 'trial_days'
                 and e ? 'grace_days' and e ? 'support_hours_month' and e ? 'office_support_hours_month'
                 and e ? 'semester_allowed' and e ? 'semester_factor' and e ? 'note' and e ? 'position',
                 'chaque plan porte les vingt-huit champs du contrat');
  perform assert((select count(*) from jsonb_object_keys(e)) = 28, 'et pas un de plus : ni identifiant, ni colonne cachée');
  perform assert(jsonb_array_length(l) = 3
                 and (select (x ->> 'base_price_month')::numeric from jsonb_array_elements(l) x where x ->> 'code' = 'premium') = 289,
                 'en euros : trois plans, Premium à 289');
  perform assert(jsonb_array_length(t) = 0, 'une devise inconnue rend une grille vide, pas une erreur');
  perform assert(has_function_privilege('anon', 'public_plans(text)', 'execute'), 'public_plans est ouverte à l''anonyme');
  perform assert(not has_function_privilege('anon', 'platform_subscriptions()', 'execute')
                 and not has_function_privilege('anon', 'subscription_invoice_totals(uuid)', 'execute')
                 and not has_function_privilege('anon', 'subscription_monthly_amount(uuid)', 'execute')
                 and not has_function_privilege('anon', 'quota_soft_state(uuid,text)', 'execute')
                 and not has_function_privilege('anon', 'plan_estimate(int,int,text)', 'execute'),
                 'rien d''autre de 0070 n''est ouvert à l''anonyme');
  perform assert(not has_table_privilege('authenticated', 'plans', 'update')
                 and not has_table_privilege('authenticated', 'plans', 'insert')
                 and not has_table_privilege('authenticated', 'plans', 'delete')
                 and has_table_privilege('authenticated', 'plans', 'select'),
                 'la grille est en lecture seule pour les comptes : elle se pose par migration');
  perform assert(to_regprocedure('public.platform_set_subscription(uuid,text,int,date,text)') is null
                 and to_regprocedure('public.platform_set_subscription(uuid,text,int,date,text,int,int,text,numeric,text,date,text)') is not null,
                 'l''ancienne signature à cinq paramètres a laissé la place à la nouvelle');

  -- ---------------------------------------------------------------
  -- 15 · Ce que l'agence lit d'elle-même, et rien des autres
  -- ---------------------------------------------------------------
  select id into v_off from offices where agency_id = v_ag order by created_at limit 1;
  perform test_login(v_owner, v_ag, 'owner', v_off);
  set local role authenticated;
  j := my_plan();
  t := subscription_invoice_totals(v_ag2);
  m := subscription_monthly_amount(v_ag2);
  l := subscription_invoice_lines(v_ag2);
  b := quota_soft_state(v_ag2, 'cases');
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert(j ->> 'plan_code' = 'active' and (j ->> 'monthly_amount')::numeric = 179 and (j ->> 'annual_amount')::numeric = 2148
                 and j ? 'invoice_lines' and j ? 'invoice_totals' and j ? 'seats_allowed' and j ? 'fair_use'
                 and (j -> 'invoice_totals' ->> 'net_a_payer')::numeric = 2530.559,
                 'my_plan rend à l''agence son mensuel, son annuel, ses lignes et ses totaux');
  perform assert((j -> 'usage' ->> 'users')::int = 6, 'my_plan rend aussi la consommation');
  perform assert((t ->> 'net_a_payer')::numeric = 0 and m = 0 and jsonb_array_length(l) = 0 and b ->> 'niveau' = 'ok',
                 'une agence ne lit pas la facture ni les paliers d''une autre');

  -- ---------------------------------------------------------------
  -- 16 · La migration des anciennes lignes
  -- ---------------------------------------------------------------
  -- Une agence sur l'ancien plan Pro, deux bureaux, sept comptes, jamais
  -- payée : elle passe en Active avec un bureau et un compte en plus.
  perform gr_as(v_admin);
  v_ag6 := platform_create_agency('Banc Grille Ancienne', 'banc-grille-f-' || sfx, 'Tunisie', 'par_dossier', 8, 'Bizerte');
  v_ag7 := platform_create_agency('Banc Grille Payée', 'banc-grille-g-' || sfx, 'Tunisie', 'par_dossier', 8, 'Monastir');
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  delete from subscriptions where agency_id in (v_ag6, v_ag7);
  insert into subscriptions (agency_id, plan_id, status, started_on, renewal_on, billing_period,
                             price_per_user_month, currency, seats, billing_state)
  select v_ag6, id, 'active', current_date - 100, current_date + 265, 'annuel', 45, 'TND', 7, 'a_jour'
    from plans where code = 'pro';
  insert into subscriptions (agency_id, plan_id, status, started_on, renewal_on, billing_period,
                             price_per_user_month, currency, seats, billing_state, last_payment_on)
  select v_ag7, id, 'active', current_date - 100, current_date + 265, 'annuel', 45, 'TND', 5, 'a_jour', current_date - 100
    from plans where code = 'pro';
  select id into v_off from offices where agency_id = v_ag6 limit 1;
  insert into offices (agency_id, name, country, country_code) values (v_ag6, 'Tunis', 'Tunisie', 'TN');
  for i in 1..7 loop
    insert into auth.users (id) values (gen_random_uuid()) returning id into v_u;
    insert into profiles (id, agency_id, office_id, name, role) values (v_u, v_ag6, v_off, 'Ancien ' || i, 'agent');
  end loop;
  perform assert(subscription_monthly_amount(v_ag6) = 7 * 45, 'avant la migration, l''ancienne formule : 7 × 45');

  n := grille_migrate_0070();
  perform assert(n = 2, 'la migration a repris les deux lignes anciennes (' || n || ')');

  select to_jsonb(s2) into e from subscriptions s2 where agency_id = v_ag6;
  perform assert((select code from plans where id = (e ->> 'plan_id')::uuid) = 'active',
                 'Pro devient Active');
  perform assert((e ->> 'extra_offices')::int = 1 and (e ->> 'extra_users')::int = 1 and (e ->> 'seats')::int = 7,
                 'deux bureaux et sept comptes : un bureau en plus, un compte en plus, sept sièges');
  perform assert((e ->> 'base_price_month')::numeric = 179 and (e ->> 'extra_user_price_month')::numeric = 35
                 and (e ->> 'extra_office_price_month')::numeric = 119 and (e ->> 'price_per_user_month')::numeric = 0,
                 'jamais payée : les prix de la grille neuve');
  perform assert(subscription_monthly_amount(v_ag6) = 179 + 119 + 35, 'elle paie désormais 333 par mois');
  perform assert(e ->> 'status' = 'active' and e ->> 'billing_state' = 'a_jour' and (e ->> 'renewal_on')::date = current_date + 265,
                 'son cycle n''a pas bougé');
  perform assert(exists (select 1 from subscription_events where agency_id = v_ag6 and kind = 'changement_plan'
                          and detail ->> 'origine' = 'migration_0070' and detail ->> 'plan_avant' = 'pro'
                          and (detail ->> 'montant_mensuel_avant')::numeric = 315),
                 'la migration entre au journal, avec l''ancien montant');

  select to_jsonb(s2) into e from subscriptions s2 where agency_id = v_ag7;
  perform assert((e ->> 'base_price_month')::numeric = 225 and (e ->> 'extra_user_price_month')::numeric = 0
                 and (e ->> 'extra_office_price_month')::numeric = 0,
                 'déjà payée : la période en cours garde son montant, 5 × 45 = 225 en socle');
  perform assert(subscription_monthly_amount(v_ag7) = 225 and subscription_invoice_amount(v_ag7) = 2700,
                 'sa facture ne change pas après coup : 2 700');
  perform assert(e ->> 'note' like '%ancien montant conservé%', 'et la note dit au super-admin d''aligner à l''échéance');

  perform assert(grille_migrate_0070() = 0, 'rejouée, la migration ne touche plus rien');

  -- Une agence sans aucune souscription est traitée comme un essai en dinars.
  delete from subscriptions where agency_id = v_ag4;
  j := agency_plan(v_ag4);
  perform assert(j ->> 'code' = 'essai' and j ->> 'currency' = 'TND' and (j -> 'limits' ->> 'users')::int = 10,
                 'sans souscription, le plan est l''essai TND, avec ses volumes');

  -- ---------------------------------------------------------------
  -- 17 · L'usage en temps réel
  -- ---------------------------------------------------------------
  -- Banc Payeuse est Active, sans aucun compte : on en ouvre trois.
  select id into v_off from offices where agency_id = v_ag5 limit 1;
  for i in 1..3 loop
    insert into auth.users (id) values (gen_random_uuid()) returning id into v_u;
    insert into profiles (id, agency_id, office_id, name, role)
      values (v_u, v_ag5, v_off, 'Payeuse ' || i, case when i = 1 then 'owner' else 'agent' end);
    if i = 1 then v_owner := v_u; end if;
  end loop;

  perform test_login(v_owner, v_ag5, 'owner', v_off);
  set local role authenticated;
  t0 := clock_timestamp();
  j := agency_usage();
  ms := (extract(epoch from clock_timestamp() - t0) * 1000)::int;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  raise notice 'agency_usage en % ms', ms;
  perform assert(ms < 50, 'agency_usage répond en moins de cinquante millisecondes (' || ms || ' ms)');
  perform assert(j ->> 'plan_code' = 'active' and not (j ->> 'premium')::boolean and j ->> 'currency' = 'TND'
                 and j ? 'computed_at' and jsonb_typeof(j -> 'resources') = 'array',
                 'agency_usage dit le plan, la devise, Premium ou non, l''heure, et une liste de ressources');
  perform assert((select string_agg(r ->> 'code', ',') from jsonb_array_elements(j -> 'resources') r)
                 = 'users,offices,cases,shipments,storage,emails',
                 'six ressources, dans l''ordre : comptes, bureaux, dossiers, cargaisons, stockage, courriels');
  perform assert((select bool_and(r ? 'code' and r ? 'label_fr' and r ? 'used' and r ? 'limit' and r ? 'pct' and r ? 'niveau'
                                  and r ? 'depuis' and r ? 'unit' and r ? 'addon_price' and r ? 'addon_currency'
                                  and (select count(*) from jsonb_object_keys(r)) = 10)
                    from jsonb_array_elements(j -> 'resources') r),
                 'chaque ressource porte exactement ses dix clés');
  select r into e from jsonb_array_elements(j -> 'resources') r where r ->> 'code' = 'users';
  perform assert((e ->> 'used')::int = 3 and (e ->> 'limit')::int = 4 and (e ->> 'pct')::int = 75 and e ->> 'niveau' = 'ok'
                 and e ->> 'unit' = 'compte' and e ->> 'label_fr' = 'Comptes actifs' and e ->> 'depuis' is null,
                 'trois comptes sur quatre : 75 %, ok, compté en direct');
  perform assert((e ->> 'addon_price')::numeric = 35 and e ->> 'addon_currency' = 'TND',
                 'et le prix du compte suivant : 35 TND');
  select r into e from jsonb_array_elements(j -> 'resources') r where r ->> 'code' = 'offices';
  perform assert((e ->> 'used')::int = 1 and (e ->> 'limit')::int = 1 and (e ->> 'pct')::int = 100 and e ->> 'niveau' = 'ok'
                 and (e ->> 'addon_price')::numeric = 119 and e ->> 'unit' = 'bureau',
                 'un bureau sur un : 100 %, plein mais ok (le garde dur fait le reste), bureau suivant à 119');
  select r into e from jsonb_array_elements(j -> 'resources') r where r ->> 'code' = 'storage';
  perform assert(e ->> 'unit' = 'octet' and (e ->> 'limit')::bigint = 12288::bigint * 1024 * 1024 and (e ->> 'used')::bigint = 0
                 and e ->> 'addon_price' is null,
                 'le stockage se lit en octets, sans prix d''ajout');
  select r into e from jsonb_array_elements(j -> 'resources') r where r ->> 'code' = 'emails';
  perform assert((e ->> 'limit')::int = 0 and e ->> 'pct' is null and e ->> 'niveau' = 'ok' and e ->> 'unit' = 'courriel',
                 'sans dossier ouvert, aucun courriel n''est dû : pas de pourcentage');

  -- Le quatrième compte : plein.
  insert into auth.users (id) values (gen_random_uuid()) returning id into v_u;
  insert into profiles (id, agency_id, office_id, name, role) values (v_u, v_ag5, v_off, 'Payeuse 4', 'agent');
  perform gr_as(v_admin);
  j := platform_agency_usage(v_ag5);
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select r into e from jsonb_array_elements(j -> 'resources') r where r ->> 'code' = 'users';
  perform assert((e ->> 'used')::int = 4 and (e ->> 'pct')::int = 100 and e ->> 'niveau' = 'ok'
                 and (e ->> 'addon_price')::numeric = 35,
                 'quatre sur quatre : 100 %, plein mais ok, jamais une alerte, le compte suivant coûte 35');

  -- Cent trente dossiers sur cent cinquante : information.
  select id into v_vt from visa_types where agency_id = v_ag5 limit 1;
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (v_ag5, v_off, 'Sami', 'Jlassi', '+216 21 00' || substr(sfx, 1, 4)) returning id into v_cl;
  for i in 1..130 loop
    insert into cases (agency_id, reference, client_id, visa_type_id, office_id)
      values (v_ag5, 'US-' || sfx || '-' || i, v_cl, v_vt, v_off);
  end loop;
  perform gr_as(v_admin);
  t0 := clock_timestamp();
  j := platform_agency_usage(v_ag5);
  ms := (extract(epoch from clock_timestamp() - t0) * 1000)::int;
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert(ms < 50, 'avec cent trente dossiers, toujours sous cinquante millisecondes (' || ms || ' ms)');
  select r into e from jsonb_array_elements(j -> 'resources') r where r ->> 'code' = 'cases';
  perform assert((e ->> 'used')::int = 130 and (e ->> 'limit')::int = 150 and (e ->> 'pct')::int = 87 and e ->> 'niveau' = 'info'
                 and e ->> 'unit' = 'dossier',
                 'cent trente dossiers sur cent cinquante : 87 %, information');
  select r into e from jsonb_array_elements(j -> 'resources') r where r ->> 'code' = 'emails';
  perform assert((e ->> 'limit')::int = 2600, 'les courriels du mois : vingt par dossier ouvert, 2 600');

  -- Premium : la limite est l'usage raisonnable, et rien ne bloque.
  perform gr_as(v_admin);
  j := platform_agency_usage(v_ag3);
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert((j ->> 'premium')::boolean and j ->> 'plan_code' = 'premium', 'Premium se dit Premium');
  select r into e from jsonb_array_elements(j -> 'resources') r where r ->> 'code' = 'users';
  perform assert((e ->> 'limit')::int = 60 and (e ->> 'used')::int = 2 and e ->> 'addon_price' is null,
                 'Premium : soixante comptes d''usage raisonnable, pas de prix d''ajout');
  select r into e from jsonb_array_elements(j -> 'resources') r where r ->> 'code' = 'offices';
  perform assert((e ->> 'limit')::int = 15 and (e ->> 'used')::int = 4 and (e ->> 'pct')::int = 27,
                 'quinze bureaux d''usage raisonnable, quatre ouverts');
  select r into e from jsonb_array_elements(j -> 'resources') r where r ->> 'code' = 'storage';
  perform assert((e ->> 'limit')::bigint = 61440::bigint * 1024 * 1024,
                 'le stockage Premium : 4 Go par compte, 60 Go au minimum');
  select r into e from jsonb_array_elements(j -> 'resources') r where r ->> 'code' = 'emails';
  perform assert((e ->> 'limit')::int = 5000, 'les courriels Premium : 5 000 au minimum');
  select r into e from jsonb_array_elements(j -> 'resources') r where r ->> 'code' = 'cases';
  perform assert(e ->> 'limit' is null and e ->> 'pct' is null and e ->> 'niveau' = 'ok',
                 'les dossiers de Premium sont sans limite');
  update plans set fair_use_users = 1 where code = 'premium';
  perform gr_as(v_admin);
  j := platform_agency_usage(v_ag3);
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select r into e from jsonb_array_elements(j -> 'resources') r where r ->> 'code' = 'users';
  perform assert((e ->> 'pct')::int = 200 and e ->> 'niveau' = 'attention',
                 'Premium à 200 % de l''usage raisonnable : attention, jamais bloqué');
  update plans set fair_use_users = 60 where code = 'premium';

  -- Qui n'est pas de l'agence ne lit rien.
  insert into auth.users (id, email) values (gen_random_uuid(), 'personne@banc-grille.test') returning id into v_u;
  perform test_login(v_u, null, null, null);
  set local role authenticated;
  ok := false;
  begin
    j := agency_usage();
  exception when others then ok := sqlstate = '42501';
  end;
  reset role;
  perform assert(ok, 'sans agence dans le jeton, agency_usage refuse');
  perform test_login(v_owner, v_ag5, 'owner', v_off);
  set local role authenticated;
  ok := false;
  begin
    j := platform_agency_usage(v_ag3);
  exception when others then ok := sqlstate = '42501';
  end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert(ok, 'un propriétaire d''agence ne lit pas l''usage d''une autre par la console');

  -- La console voit qui est à l'étroit : la liste, le cockpit, la fiche.
  perform gr_as(v_admin);
  select usage_max_pct, usage_niveau into n, s from platform_agencies() where id = v_ag5;
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert(n = 87 and s = 'info', 'platform_agencies porte le pourcentage le plus haut des ressources souples et le pire niveau');

  perform gr_as(v_admin);
  c := platform_cockpit();
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert((c -> 'kpis' ->> 'agences_en_depassement')::int
                 = (select count(*) from jsonb_array_elements(c -> 'urgents') x
                     where x ->> 'kind' = 'quota' and x ->> 'severity' = 'attention'),
                 'le cockpit compte les agences en dépassement : autant que d''urgences quota à 100 %');
  select x into e from jsonb_array_elements(c -> 'urgents') x
   where x ->> 'kind' = 'quota' and (x ->> 'agency_id')::uuid = v_ag5;
  perform assert(e is not null and e ->> 'severity' = 'info' and e ->> 'title' = 'Dossiers ouverts à 87 %'
                 and e ->> 'detail' = 'Dossiers ouverts : 130 sur 150' and e ->> 'url' = '/admin/agences/' || v_ag5
                 and e ? 'since' and e ? 'days' and e ->> 'agency_slug' like 'banc-grille-e-%',
                 'le cockpit signale « Dossiers ouverts à 87 % », avec le détail et le lien');
  perform assert(not exists (select 1 from jsonb_array_elements(c -> 'urgents') x
                              where x ->> 'kind' = 'quota' and x ->> 'title' like 'Comptes actifs%'),
                 'des comptes pleins ne sont jamais une urgence du cockpit');

  perform gr_as(v_admin);
  j := platform_agency_360(v_ag5);
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform assert(j ? 'usage' and jsonb_array_length(j -> 'usage' -> 'resources') = 6
                 and (j -> 'usage' ->> 'plan_code') = 'active',
                 'la fiche porte l''usage en direct, avec ses six ressources');

  raise notice '--- banc de la grille : tout est vert ---';
end $$;

drop function gr_as(uuid);
