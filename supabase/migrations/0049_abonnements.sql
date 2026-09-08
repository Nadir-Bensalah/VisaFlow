-- 0049 · L'abonnement, les quotas et ce qui se facture.
--
-- Jusqu'ici l'abonnement tenait dans une seule colonne, `agencies.plan`, avec
-- quatre valeurs et aucune limite derrière. On ne savait donc ni ce qu'une
-- agence a le droit d'utiliser, ni ce qu'elle doit payer, ni depuis quand.
--
-- CE QUE LA LOI IMPOSE, et qui commande tout le reste de ce fichier :
--
--   · L'abonnement se facture à l'année, sur facture, au format TTN. Il
--     n'existe pas de prélèvement récurrent par carte en Tunisie, et Stripe ne
--     couvre pas le pays. Rien ici ne prélève, rien ici n'encaisse.
--   · L'article 3 de la circulaire BCT 2016-09 fait refuser le transfert d'un
--     forfait sans unité quantifiable. La grille est donc PAR UNITÉ D'ŒUVRE :
--     45 DT par utilisateur et par mois. Les bureaux, les dossiers et le
--     stockage ne sont pas des prix, ce sont des garde-fous. La ligne de
--     facture, elle, se lit « N utilisateurs × 45 DT × 12 mois ».
--   · La plateforme ne touche jamais l'argent des clients des agences. Ce
--     fichier ne facture QUE l'abonnement de l'agence à la plateforme.
--
-- On ne touche pas à `agencies.plan` : sa contrainte n'accepte que quatre
-- valeurs historiques, et six modules travaillent en parallèle sur ce schéma.
-- Le plan effectif d'une agence se lit désormais dans `subscriptions`.

-- ------------------------------------------------------------------
-- 1 · La grille : des plans, et le prix est toujours par utilisateur
-- ------------------------------------------------------------------
--
-- Dans toute cette table, `null` veut dire ILLIMITÉ. Zéro voudrait dire
-- « rien du tout », ce n'est pas la même chose, et confondre les deux est la
-- façon la plus simple de bloquer une agence qui a payé.

create table if not exists plans (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique
                       check (code in ('essai','starter','pro','business','enterprise')),
  name                 text not null,
  -- La seule base tarifaire. Tout le reste de la ligne est un garde-fou.
  price_per_user_month numeric(10,3) not null default 45,
  currency             char(3) not null default 'TND',
  billing_period       text not null default 'annuel'
                       check (billing_period in ('annuel','mensuel')),
  max_offices          int,   -- null = illimité
  max_users            int,   -- null = illimité
  max_active_cases     int,   -- null = illimité
  max_active_shipments int,   -- null = illimité
  max_storage_mb       int,   -- null = illimité
  trial_days           int not null default 0,
  active               boolean not null default true,
  position             int not null default 0,
  note                 text
);

comment on table plans is
  'La grille tarifaire de la plateforme. Le prix est TOUJOURS par utilisateur et par mois : l''article 3 de la circulaire BCT 2016-09 fait refuser le transfert d''un forfait sans unité quantifiable. Une limite à null veut dire illimité, jamais zéro.';

-- Les plans réels. Le prix est le même partout, 45 DT par utilisateur et par
-- mois : ce qui distingue les plans, ce sont les volumes, pas le tarif à
-- l'unité. Un plan plus grand coûte plus cher parce qu'il compte plus
-- d'utilisateurs, et c'est exactement ce que la banque veut lire.
insert into plans (code, name, price_per_user_month, billing_period,
                   max_offices, max_users, max_active_cases, max_active_shipments,
                   max_storage_mb, trial_days, position, note)
values
  ('essai', 'Essai', 0, 'annuel',
   null, null, null, null, null, 30, 0,
   'L''essai n''est pas bridé en volume, il est borné dans le temps. Il ne se facture pas.'),
  ('starter', 'Starter', 45, 'annuel',
   1, 3, 100, 100, 5000, 0, 1,
   'Une agence d''un seul bureau. 1 bureau, 3 utilisateurs, 100 dossiers actifs.'),
  ('pro', 'Pro', 45, 'annuel',
   3, 15, 1000, 1000, 25000, 0, 2,
   'Plusieurs bureaux. 3 bureaux, 15 utilisateurs, 1000 dossiers actifs.'),
  ('business', 'Business', 45, 'annuel',
   10, 50, 5000, 5000, 100000, 0, 3,
   'Un réseau. 10 bureaux, 50 utilisateurs, 5000 dossiers actifs.'),
  ('enterprise', 'Enterprise', 45, 'annuel',
   null, null, null, null, null, 0, 4,
   'Sans limite de volume. Le montant reste le nombre d''utilisateurs signés × 45 DT × 12 mois.')
on conflict (code) do update set
  name = excluded.name,
  price_per_user_month = excluded.price_per_user_month,
  billing_period = excluded.billing_period,
  max_offices = excluded.max_offices,
  max_users = excluded.max_users,
  max_active_cases = excluded.max_active_cases,
  max_active_shipments = excluded.max_active_shipments,
  max_storage_mb = excluded.max_storage_mb,
  trial_days = excluded.trial_days,
  position = excluded.position,
  note = excluded.note;

-- ------------------------------------------------------------------
-- 2 · Ce qu'un plan ouvre : les fonctionnalités
-- ------------------------------------------------------------------

create table if not exists features (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique
              check (code in ('VISA','CARGO','CRM','WHATSAPP','CLIENT_PORTAL',
                              'ADVANCED_REPORTS','API','WHITE_LABEL',
                              'CUSTOM_ROLES','ACCOUNTING')),
  name        text not null,
  description text
);

insert into features (code, name, description) values
  ('VISA', 'Visas', 'Les dossiers de visa, les pièces, les rendez-vous et les créneaux.'),
  ('CARGO', 'Fret', 'Les cargaisons, les lots, les tronçons et la douane.'),
  ('CRM', 'Relation client', 'Les prospects, les relances et le suivi commercial.'),
  ('WHATSAPP', 'WhatsApp', 'L''envoi et la réception de messages WhatsApp depuis les dossiers.'),
  ('CLIENT_PORTAL', 'Portail client', 'Le suivi en ligne remis au client, par jeton.'),
  ('ADVANCED_REPORTS', 'Rapports avancés', 'Les statistiques par bureau, par poste et par agent.'),
  ('API', 'API', 'L''accès programmatique pour brancher un autre outil.'),
  ('WHITE_LABEL', 'Marque blanche', 'Le portail et les documents aux couleurs et au nom de l''agence seule.'),
  ('CUSTOM_ROLES', 'Rôles sur mesure', 'Des rôles et des permissions définis par l''agence.'),
  ('ACCOUNTING', 'Comptabilité', 'Les exports comptables et le rapprochement des règlements.')
on conflict (code) do update set
  name = excluded.name, description = excluded.description;

create table if not exists plan_features (
  plan_id     uuid not null references plans on delete cascade,
  feature_id  uuid not null references features on delete cascade,
  -- Un plafond propre à la fonctionnalité : par exemple le nombre de messages
  -- WhatsApp par mois. null = sans limite.
  limit_value int,
  primary key (plan_id, feature_id)
);

comment on table plan_features is
  'Ce que chaque plan ouvre. La clé est composite : une fonctionnalité n''apparaît qu''une fois par plan.';

-- L'essai ouvre tout : il est borné dans le temps, pas en périmètre. Une
-- agence qui essaie doit voir ce qu'elle achète.
insert into plan_features (plan_id, feature_id, limit_value)
select p.id, f.id, null
from plans p, features f
where p.code in ('essai','enterprise')
on conflict do nothing;

insert into plan_features (plan_id, feature_id, limit_value)
select p.id, f.id, v.limit_value
from (values
  -- Starter : le métier, et le suivi qu'on remet au client.
  ('starter', 'VISA', null::int),
  ('starter', 'CARGO', null),
  ('starter', 'CLIENT_PORTAL', null),
  -- Pro : le commercial, les messages et les chiffres.
  ('pro', 'VISA', null),
  ('pro', 'CARGO', null),
  ('pro', 'CLIENT_PORTAL', null),
  ('pro', 'CRM', null),
  ('pro', 'WHATSAPP', 2000),
  ('pro', 'ADVANCED_REPORTS', null),
  ('pro', 'ACCOUNTING', null),
  -- Business : le réseau, donc l'ouverture aux autres outils.
  ('business', 'VISA', null),
  ('business', 'CARGO', null),
  ('business', 'CLIENT_PORTAL', null),
  ('business', 'CRM', null),
  ('business', 'WHATSAPP', 10000),
  ('business', 'ADVANCED_REPORTS', null),
  ('business', 'ACCOUNTING', null),
  ('business', 'API', null),
  ('business', 'CUSTOM_ROLES', null)
) as v(plan_code, feature_code, limit_value)
join plans p on p.code = v.plan_code
join features f on f.code = v.feature_code
on conflict (plan_id, feature_id) do update set limit_value = excluded.limit_value;

-- ------------------------------------------------------------------
-- 3 · La souscription d'une agence
-- ------------------------------------------------------------------
--
-- `seats` est le nombre d'utilisateurs FACTURÉS, celui qui a été signé. Il
-- peut différer du nombre réel : une agence qui a signé pour dix et n'en a
-- ouvert que six paie dix. C'est ce chiffre-là, et lui seul, qui va sur la
-- facture. Le nombre réel vit dans `usage_counters`, et l'écart entre les deux
-- est ce que la console montre au commercial.

create table if not exists subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  agency_id            uuid not null references agencies on delete cascade,
  plan_id              uuid not null references plans,
  status               text not null default 'essai'
                       check (status in ('essai','active','impayee','resiliee','suspendue')),
  started_on           date not null default current_date,
  renewal_on           date,
  ends_on              date,
  billing_period       text not null default 'annuel'
                       check (billing_period in ('annuel','mensuel')),
  -- Le prix est figé à la signature. Une hausse de la grille ne rattrape pas
  -- une agence en cours d'année : ce serait une facture qu'on ne peut pas
  -- justifier, et la banque la refuserait.
  price_per_user_month numeric(10,3) not null default 45,
  currency             char(3) not null default 'TND',
  seats                int not null default 1 check (seats > 0),
  note                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Une seule souscription vivante par agence. Les résiliées restent, elles
-- sont l'histoire commerciale du compte.
create unique index if not exists subscriptions_une_vivante
  on subscriptions (agency_id)
  where status in ('essai','active','impayee','suspendue');

create index if not exists subscriptions_echeance on subscriptions (renewal_on)
  where status in ('essai','active','impayee');

comment on table subscriptions is
  'L''abonnement d''une agence à la plateforme. Facturé à l''année sur facture TTN : rien ici ne prélève. `seats` est le nombre d''utilisateurs signés, celui qui va sur la facture, et il peut dépasser le nombre réel.';

-- ------------------------------------------------------------------
-- 4 · La consommation, recomptée à la demande
-- ------------------------------------------------------------------
--
-- Une vue matérialisée serait un piège ici : elle se rafraîchit en bloc, donc
-- recompter une seule agence obligerait à recompter les cinquante autres, et
-- un verrou sur le rafraîchissement bloquerait tout le monde. Une table
-- ordinaire plus une fonction par agence se rafraîchit ligne à ligne, se
-- déclenche à la demande, et la tâche planifiée boucle dessus.

create table if not exists usage_counters (
  agency_id        uuid primary key references agencies on delete cascade,
  users_count      int not null default 0,
  offices_count    int not null default 0,
  clients_count    int not null default 0,
  active_cases     int not null default 0,
  active_shipments int not null default 0,
  storage_bytes    bigint not null default 0,
  computed_at      timestamptz not null default now()
);

comment on table usage_counters is
  'La consommation d''une agence, recomptée par refresh_usage. C''est un cache d''affichage : les quotas, eux, se vérifient sur un comptage vivant, jamais sur cette ligne.';

-- ------------------------------------------------------------------
-- 5 · L'histoire de l'abonnement
-- ------------------------------------------------------------------
--
-- C'est ce qu'on relit le jour où un client conteste une facture. Sans ce
-- journal, on n'a que l'état actuel, et l'état actuel ne dit jamais quand le
-- plan a changé ni qui l'a changé.

create table if not exists subscription_events (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references agencies on delete cascade,
  subscription_id uuid references subscriptions on delete set null,
  kind            text not null
                  check (kind in ('creee','changement_plan','renouvelee',
                                  'suspendue','reactivee','resiliee','quota_depasse')),
  detail          jsonb not null default '{}'::jsonb,
  at              timestamptz not null default now(),
  by_user         uuid references auth.users on delete set null
);
create index if not exists subscription_events_agence on subscription_events (agency_id, at desc);

-- ------------------------------------------------------------------
-- 6 · Lire le plan effectif d'une agence
-- ------------------------------------------------------------------

-- Le plan effectif, avec ses limites et ses fonctionnalités. Une agence sans
-- souscription est en essai : c'est le cas des agences nées avant ce fichier,
-- et il ne faut jamais qu'une absence de ligne se lise comme « rien ».
create or replace function agency_plan(p_agency uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s subscriptions; p plans; v_status text;
begin
  select * into s from subscriptions
   where agency_id = p_agency and status <> 'resiliee'
   order by started_on desc, created_at desc limit 1;

  -- Plus rien de vivant : on montre la DERNIÈRE souscription, résiliée. Une
  -- agence qui a résilié n'est pas une agence qui recommence un essai, et la
  -- faire retomber sur l'essai lui rendrait tout ce qu'elle vient de rendre.
  if s.id is null then
    select * into s from subscriptions
     where agency_id = p_agency
     order by coalesce(ends_on, started_on) desc, created_at desc limit 1;
  end if;

  if s.id is null then
    select * into p from plans where code = 'essai';
    v_status := 'essai';
  else
    select * into p from plans where id = s.plan_id;
    v_status := s.status;
  end if;

  return jsonb_build_object(
    'agency_id', p_agency,
    'code', p.code,
    'name', p.name,
    'status', v_status,
    'seats', coalesce(s.seats, 0),
    'price_per_user_month', coalesce(s.price_per_user_month, p.price_per_user_month),
    'currency', coalesce(s.currency, p.currency),
    'billing_period', coalesce(s.billing_period, p.billing_period),
    'started_on', s.started_on,
    'renewal_on', s.renewal_on,
    'ends_on', s.ends_on,
    'trial_days', p.trial_days,
    -- null = illimité, jusque dans le jsonb rendu à l'écran.
    'limits', jsonb_build_object(
      'offices', p.max_offices,
      'users', p.max_users,
      'cases', p.max_active_cases,
      'shipments', p.max_active_shipments,
      'storage_mb', p.max_storage_mb
    ),
    'features', (
      select coalesce(jsonb_agg(f.code order by f.code), '[]'::jsonb)
      from plan_features pf join features f on f.id = pf.feature_id
      where pf.plan_id = p.id
    )
  );
end $$;

-- Le booléen que tout le reste du produit appellera, à chaque écran. Écrite en
-- SQL pur et en une seule expression : PostgreSQL peut l'insérer directement
-- dans la requête appelante, ce qu'il ne sait pas faire d'une fonction plpgsql.
--
-- Trois règles, dans cet ordre :
--   1. Une agence gelée ou supprimée par la plateforme n'a plus rien.
--   2. Une agence en essai a tout : elle doit voir ce qu'elle achète.
--   3. Une agence résiliée ou suspendue n'a rien.
--   4. Une agence qui n'a JAMAIS eu de souscription est en essai (les comptes
--      nés avant ce fichier). Ne pas confondre avec la précédente : « aucune
--      ligne » et « une ligne résiliée » ne se lisent pas pareil.
-- Une agence impayée garde tout : la facture arrive par courrier, le règlement
-- prend des semaines, et couper le service avant la relance ferait perdre le
-- client. C'est la suspension, décidée à la main, qui coupe.
create or replace function agency_has_feature(p_agency uuid, p_feature text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_agency is null or p_feature is null then false
    when exists (select 1 from agencies a
                  where a.id = p_agency
                    and (a.suspended_at is not null or a.deleted_at is not null)) then false
    else coalesce((
      select case
        when s.status in ('suspendue','resiliee') then false
        when s.status = 'essai' then true
        else exists (
          select 1 from plan_features pf join features f on f.id = pf.feature_id
          where pf.plan_id = s.plan_id and f.code = p_feature)
      end
      from subscriptions s
      where s.agency_id = p_agency
      -- Le vivant d'abord ; à défaut la dernière résiliée, qui ne donne rien.
      -- Seule une agence qui n'a JAMAIS eu de souscription tombe sur le
      -- `true` final : c'est le cas des comptes nés avant ce fichier.
      order by (s.status = 'resiliee'), s.started_on desc, s.created_at desc
      limit 1
    ), true)
  end
$$;

comment on function agency_has_feature(uuid, text) is
  'Le portillon du produit. Une agence en essai a tout, une agence suspendue n''a rien, une agence sans souscription est en essai.';

-- ------------------------------------------------------------------
-- 7 · Les quotas
-- ------------------------------------------------------------------

-- Le comptage VIVANT d'une ressource. Le garde ne lit jamais `usage_counters` :
-- ce cache peut avoir des heures de retard, et un quota qui laisse passer par
-- retard de cache est un quota qui ne sert à rien.
--
-- Un compte désactivé ne consomme pas de siège, un bureau fermé ne consomme
-- pas de bureau : on facture ce qui travaille.
create or replace function quota_used(p_agency uuid, p_resource text)
returns bigint
language sql stable security definer set search_path = public as $$
  select case p_resource
    when 'users'     then (select count(*) from profiles where agency_id = p_agency and active)
    when 'offices'   then (select count(*) from offices where agency_id = p_agency and active)
    when 'clients'   then (select count(*) from clients where agency_id = p_agency and deleted_at is null)
    when 'cases'     then (select count(*) from cases where agency_id = p_agency and status = 'ouvert')
    when 'shipments' then (select count(*) from shipments where agency_id = p_agency and status = 'en_cours')
    -- En octets, comme la limite : seul le stockage se compare en volume.
    when 'storage'   then (select coalesce(sum(file_size), 0)::bigint
                             from case_documents where agency_id = p_agency)
    else null
  end
$$;

-- La limite d'une ressource pour une agence, en unités comparables au
-- comptage. null = illimité.
create or replace function quota_limit(p_agency uuid, p_resource text)
returns bigint
language plpgsql stable security definer set search_path = public as $$
declare pl jsonb;
begin
  pl := agency_plan(p_agency) -> 'limits';
  return case p_resource
    when 'users'     then (pl ->> 'users')::bigint
    when 'offices'   then (pl ->> 'offices')::bigint
    when 'clients'   then null          -- aucun plan ne plafonne les clients
    when 'cases'     then (pl ->> 'cases')::bigint
    when 'shipments' then (pl ->> 'shipments')::bigint
    when 'storage'   then (pl ->> 'storage_mb')::bigint * 1024 * 1024
    else null
  end;
end $$;

create or replace function quota_check(p_agency uuid, p_resource text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_lim bigint; v_use bigint;
begin
  if p_resource not in ('users','offices','clients','cases','shipments','storage') then
    raise exception 'ressource inconnue : %', p_resource using errcode = 'P0001';
  end if;
  v_lim := quota_limit(p_agency, p_resource);
  v_use := coalesce(quota_used(p_agency, p_resource), 0);
  -- « Plein » et « dépassé » ne sont pas la même chose. Une agence à 3 bureaux
  -- sur 3 est en règle : `reste` vaut zéro, `depasse` vaut faux. Confondre les
  -- deux allumerait un voyant rouge sur toutes les agences qui ont juste rempli
  -- ce qu'elles ont payé, et le voyant ne voudrait plus rien dire.
  return jsonb_build_object(
    'limite', v_lim,                                       -- null = illimité
    'utilise', v_use,
    'reste', case when v_lim is null then null else greatest(v_lim - v_use, 0) end,
    'depasse', v_lim is not null and v_use > v_lim
  );
end $$;

-- Le garde. Il lève, il ne signale pas : un dépassement annoncé après coup est
-- un dépassement accepté.
create or replace function quota_guard(p_agency uuid, p_resource text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_lim bigint; v_use bigint;
begin
  v_lim := quota_limit(p_agency, p_resource);
  if v_lim is null then return; end if;
  v_use := coalesce(quota_used(p_agency, p_resource), 0);
  -- Appelé AVANT l'insertion : la ligne en cours n'est pas encore comptée.
  -- Atteindre la limite suffit donc à refuser la suivante. C'est bien `>=`
  -- ici, alors que `quota_check` dit `depasse` sur un `>` strict : le garde
  -- refuse ce qui ferait dépasser, l'écran signale ce qui dépasse déjà.
  if v_use >= v_lim then
    raise exception 'quota atteint : % (% sur %), plan %',
      p_resource, v_use, v_lim, (agency_plan(p_agency) ->> 'code')
      using errcode = 'P0001';
  end if;
end $$;

-- Le premier bureau et le premier compte passent TOUJOURS.
--
-- `platform_create_agency` insère l'agence, puis son premier bureau, puis
-- l'invitation ouvre le compte du propriétaire. Un garde qui refuserait à ce
-- moment-là casserait toute création d'agence, et l'erreur remonterait comme
-- « quota atteint » sur une agence qui vient de naître. Une agence sans bureau
-- ne peut accueillir personne, et une agence sans compte n'est joignable par
-- personne : ces deux lignes ne sont pas des dépassements, ce sont les
-- fondations.

create or replace function guard_office_quota() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from offices where agency_id = new.agency_id) then
    return new;
  end if;
  perform quota_guard(new.agency_id, 'offices');
  return new;
end $$;

drop trigger if exists offices_quota on offices;
create trigger offices_quota before insert on offices
  for each row execute function guard_office_quota();

create or replace function guard_profile_quota() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where agency_id = new.agency_id) then
    return new;
  end if;
  -- Réactiver quelqu'un n'est pas une insertion : le garde ne voit que les
  -- comptes neufs. Le dépassement par réactivation se voit dans la console.
  if not coalesce(new.active, true) then return new; end if;
  perform quota_guard(new.agency_id, 'users');
  return new;
end $$;

drop trigger if exists profiles_quota on profiles;
create trigger profiles_quota before insert on profiles
  for each row execute function guard_profile_quota();

-- ------------------------------------------------------------------
-- 8 · Recompter la consommation
-- ------------------------------------------------------------------

create or replace function refresh_usage(p_agency uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_over text[]; r text;
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

  -- Le dépassement s'inscrit ICI, pas dans le garde : le garde lève une
  -- exception, et une exception annule l'écriture du journal avec le reste.
  -- Un dépassement constaté est donc toujours un dépassement déjà en place
  -- (réactivation, changement de plan à la baisse, import).
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
end $$;

-- La boucle de la tâche planifiée. Elle rend le nombre d'agences recomptées :
-- une tâche qui ne dit rien ne se surveille pas.
create or replace function refresh_usage_all()
returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; a uuid;
begin
  for a in select id from agencies where deleted_at is null loop
    perform refresh_usage(a);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------------
-- 9 · Le montant de la facture
-- ------------------------------------------------------------------
--
-- C'est LA ligne que la banque lit pour autoriser le transfert. Elle doit être
-- quantifiable : un nombre d'utilisateurs, un prix unitaire, une durée. Jamais
-- « abonnement annuel : 2 700 DT », toujours « 5 utilisateurs × 45 DT × 12 ».
create or replace function subscription_invoice_amount(p_agency uuid)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare s subscriptions;
begin
  select * into s from subscriptions
   where agency_id = p_agency and status <> 'resiliee'
   order by started_on desc, created_at desc limit 1;
  -- Pas de souscription, ou un essai : rien n'est dû.
  if s.id is null or s.status = 'essai' then return 0; end if;
  return round(s.seats * s.price_per_user_month * 12, 3);
end $$;

comment on function subscription_invoice_amount(uuid) is
  'Le montant annuel dû : sièges signés × prix par utilisateur × 12 mois. Quantifiable, comme l''exige l''article 3 de la circulaire BCT 2016-09. Un essai ne doit rien.';

-- ------------------------------------------------------------------
-- 10 · L'essai naît avec l'agence
-- ------------------------------------------------------------------
--
-- POURQUOI UN TRIGGER PLUTÔT QU'UNE LIGNE DANS `platform_create_agency` :
--
--   1. Ce n'est pas le seul chemin qui crée une agence. `provision_agency`,
--      les bancs d'essai et la clé de service insèrent directement dans
--      `agencies`. Une agence née par un de ces chemins se retrouverait sans
--      abonnement, donc sans plan lisible, et le produit la traiterait comme
--      un compte historique par accident.
--   2. Six modules travaillent en parallèle sur ce schéma. Deux migrations qui
--      réécrivent la même fonction, c'est la dernière appliquée qui gagne, et
--      l'autre disparaît sans bruit. Un trigger s'ajoute sans réécrire.
--   3. La règle « toute agence a un abonnement » est un invariant de la table,
--      pas une politesse d'une fonction. Elle appartient donc à la table.

create or replace function agency_start_trial() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_plan plans; v_sub uuid;
begin
  select * into v_plan from plans where code = 'essai';
  if v_plan.id is null then return new; end if;

  insert into subscriptions (agency_id, plan_id, status, started_on, renewal_on,
                             billing_period, price_per_user_month, currency, seats, note)
  values (new.id, v_plan.id, 'essai', current_date,
          (current_date + (coalesce(v_plan.trial_days, 30) || ' days')::interval)::date,
          v_plan.billing_period, v_plan.price_per_user_month, v_plan.currency, 1,
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

drop trigger if exists agencies_trial on agencies;
create trigger agencies_trial after insert on agencies
  for each row execute function agency_start_trial();

-- ------------------------------------------------------------------
-- 11 · Reprise des agences déjà en place
-- ------------------------------------------------------------------
--
-- Le trigger ne rattrape que l'avenir. Les agences existantes, elles, se
-- verraient attribuer l'essai par défaut, et l'essai serait faux pour une
-- agence qui paie. On reprend donc leur plan historique, avec une règle et pas
-- une correspondance arbitraire : LE PLAN LE MOINS CHER QUI COUVRE DÉJÀ LEUR
-- CONSOMMATION. Aucune agence ne naît donc au-dessus de son propre quota, et
-- rien de ce qui existe ne se casse.

insert into subscriptions (agency_id, plan_id, status, started_on, renewal_on,
                           billing_period, price_per_user_month, currency, seats, note)
select
  a.id, p.id,
  case when a.suspended_at is not null then 'suspendue'
       when a.plan = 'essai' then 'essai'
       else 'active' end,
  a.created_at::date,
  case when a.plan = 'essai'
       then (a.created_at::date + interval '30 days')::date
       else (current_date + interval '1 year')::date end,
  p.billing_period, p.price_per_user_month, p.currency,
  greatest(1, (select count(*) from profiles pr where pr.agency_id = a.id and pr.active)::int),
  'Reprise du plan historique « ' || a.plan || ' » à la migration 0049.'
from agencies a
cross join lateral (
  select pl.* from plans pl
  where pl.active
    and case when a.plan = 'essai' then pl.code = 'essai' else pl.code <> 'essai' end
    and (pl.max_offices is null or pl.max_offices >= (select count(*) from offices o where o.agency_id = a.id))
    and (pl.max_users is null or pl.max_users >= (select count(*) from profiles pr where pr.agency_id = a.id))
    and (pl.max_active_cases is null or pl.max_active_cases >= (select count(*) from cases c where c.agency_id = a.id and c.status = 'ouvert'))
    and (pl.max_active_shipments is null or pl.max_active_shipments >= (select count(*) from shipments s where s.agency_id = a.id and s.status = 'en_cours'))
  order by pl.position
  limit 1
) p
where a.deleted_at is null
  and not exists (select 1 from subscriptions s where s.agency_id = a.id);

insert into subscription_events (agency_id, subscription_id, kind, detail)
select s.agency_id, s.id, 'creee',
       jsonb_build_object('plan', (select code from plans where id = s.plan_id),
                          'origine', 'migration_0049')
from subscriptions s
where s.note like 'Reprise du plan historique%'
  and not exists (select 1 from subscription_events e where e.subscription_id = s.id);

-- Une première photo de la consommation, pour que la console ne s'ouvre pas vide.
do $$ begin perform refresh_usage_all(); end $$;

-- ------------------------------------------------------------------
-- 12 · La console : voir et poser les abonnements
-- ------------------------------------------------------------------

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
        'plan_name', pl -> 'name',
        'status', pl -> 'status',
        'seats', pl -> 'seats',
        'price_per_user_month', pl -> 'price_per_user_month',
        'currency', pl -> 'currency',
        'renewal_on', pl -> 'renewal_on',
        'ends_on', pl -> 'ends_on',
        'limits', pl -> 'limits',
        'annual_amount', subscription_invoice_amount(a.id),
        'usage', jsonb_build_object(
          'users', coalesce(u.users_count, 0),
          'offices', coalesce(u.offices_count, 0),
          'clients', coalesce(u.clients_count, 0),
          'cases', coalesce(u.active_cases, 0),
          'shipments', coalesce(u.active_shipments, 0),
          'storage_bytes', coalesce(u.storage_bytes, 0)
        ),
        'computed_at', u.computed_at,
        -- Les ressources en dépassement, nommées. Une pastille rouge sans le
        -- nom de la ressource oblige à ouvrir l'agence pour comprendre.
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

-- Poser ou changer l'abonnement d'une agence. Réservé à la plateforme : une
-- agence ne change pas son propre plan, elle appelle son commercial. C'est
-- aussi ce qui protège la facture, puisque le montant en découle.
create or replace function platform_set_subscription(
  p_agency uuid,
  p_plan_code text,
  p_seats int default null,
  p_renewal_on date default null,
  p_status text default 'active'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_plan plans; s subscriptions; v_kind text; v_id uuid; v_seats int;
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;

  select * into v_plan from plans where code = p_plan_code and active;
  if v_plan.id is null then
    raise exception 'plan inconnu : %', p_plan_code using errcode = 'P0002';
  end if;
  if p_status not in ('essai','active','impayee','resiliee','suspendue') then
    raise exception 'état inconnu : %', p_status using errcode = 'P0001';
  end if;

  select * into s from subscriptions
   where agency_id = p_agency and status <> 'resiliee'
   order by started_on desc, created_at desc limit 1;

  -- Les sièges facturés : ce qui est demandé, sinon ce qui était signé, sinon
  -- le nombre réel de comptes actifs. Jamais zéro : une facture à zéro siège
  -- n'a pas d'unité d'œuvre, et la banque la refuse.
  v_seats := greatest(1, coalesce(p_seats, s.seats,
                                  quota_used(p_agency, 'users')::int, 1));

  if s.id is null then
    insert into subscriptions (agency_id, plan_id, status, started_on, renewal_on,
                               billing_period, price_per_user_month, currency, seats)
    values (p_agency, v_plan.id, p_status, current_date,
            coalesce(p_renewal_on, (current_date + interval '1 year')::date),
            v_plan.billing_period, v_plan.price_per_user_month, v_plan.currency, v_seats)
    returning id into v_id;
    v_kind := 'creee';
  else
    v_kind := case
      when p_status = 'resiliee' then 'resiliee'
      when p_status = 'suspendue' then 'suspendue'
      when s.status in ('suspendue','impayee') and p_status = 'active' then 'reactivee'
      when v_plan.id is distinct from s.plan_id then 'changement_plan'
      when p_renewal_on is not null and p_renewal_on is distinct from s.renewal_on then 'renouvelee'
      else 'renouvelee'
    end;

    update subscriptions set
      plan_id = v_plan.id,
      status = p_status,
      seats = v_seats,
      renewal_on = coalesce(p_renewal_on, renewal_on, (current_date + interval '1 year')::date),
      ends_on = case when p_status = 'resiliee' then coalesce(ends_on, current_date) else null end,
      -- Le prix suit le plan au changement de plan, et reste figé sinon.
      price_per_user_month = case when v_plan.id is distinct from s.plan_id
                                  then v_plan.price_per_user_month else price_per_user_month end,
      currency = v_plan.currency,
      billing_period = v_plan.billing_period,
      updated_at = now()
    where id = s.id
    returning id into v_id;
  end if;

  insert into subscription_events (agency_id, subscription_id, kind, detail, by_user)
  values (p_agency, v_id, v_kind,
          jsonb_build_object(
            'plan', v_plan.code,
            'plan_avant', (select code from plans where id = s.plan_id),
            'statut', p_status,
            'statut_avant', s.status,
            'sieges', v_seats,
            'sieges_avant', s.seats,
            'montant_annuel', round(v_seats * v_plan.price_per_user_month * 12, 3)),
          auth.uid());

  perform refresh_usage(p_agency);
  return agency_plan(p_agency);
end $$;

-- L'histoire d'un abonnement, pour la console. C'est ce qu'on relit quand un
-- client conteste une facture.
create or replace function platform_subscription_events(p_agency uuid, p_limit int default 50)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'kind', e.kind, 'detail', e.detail, 'at', e.at,
      'by', (select p.name from profiles p where p.id = e.by_user)
    ) order by e.at desc), '[]'::jsonb)
    from (select * from subscription_events where agency_id = p_agency
           order by at desc limit greatest(1, coalesce(p_limit, 50))) e
  );
end $$;

-- Ce qu'une agence lit de son PROPRE abonnement : son plan, sa consommation,
-- son échéance. Elle ne voit ni le montant des autres, ni le journal.
create or replace function my_plan()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_agency uuid;
begin
  v_agency := auth_agency_id();
  if v_agency is null then
    raise exception 'aucune agence dans le jeton' using errcode = '42501';
  end if;
  return agency_plan(v_agency) || jsonb_build_object(
    'usage', jsonb_build_object(
      'users', quota_used(v_agency, 'users'),
      'offices', quota_used(v_agency, 'offices'),
      'clients', quota_used(v_agency, 'clients'),
      'cases', quota_used(v_agency, 'cases'),
      'shipments', quota_used(v_agency, 'shipments'),
      'storage_bytes', quota_used(v_agency, 'storage')
    ),
    'annual_amount', subscription_invoice_amount(v_agency)
  );
end $$;

-- ------------------------------------------------------------------
-- 13 · Le cloisonnement
-- ------------------------------------------------------------------
--
-- La grille est un référentiel de plateforme : tout le monde la lit, personne
-- ne l'écrit sauf la plateforme. Une agence doit voir ce qu'elle pourrait
-- acheter, sinon le commercial passe son temps à envoyer des tarifs.

do $$
declare t text;
begin
  foreach t in array array['plans','features','plan_features',
                           'subscriptions','usage_counters','subscription_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

drop policy if exists plans_select on plans;
drop policy if exists plans_write on plans;
drop policy if exists plans_update on plans;
drop policy if exists plans_delete on plans;
create policy plans_select on plans for select to authenticated
  using (active or is_platform_admin());
create policy plans_write on plans for insert to authenticated
  with check (is_platform_admin());
create policy plans_update on plans for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());
create policy plans_delete on plans for delete to authenticated
  using (is_platform_admin());

drop policy if exists features_select on features;
drop policy if exists features_write on features;
drop policy if exists features_update on features;
drop policy if exists features_delete on features;
create policy features_select on features for select to authenticated using (true);
create policy features_write on features for insert to authenticated
  with check (is_platform_admin());
create policy features_update on features for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());
create policy features_delete on features for delete to authenticated
  using (is_platform_admin());

drop policy if exists plan_features_select on plan_features;
drop policy if exists plan_features_write on plan_features;
drop policy if exists plan_features_update on plan_features;
drop policy if exists plan_features_delete on plan_features;
create policy plan_features_select on plan_features for select to authenticated using (true);
create policy plan_features_write on plan_features for insert to authenticated
  with check (is_platform_admin());
create policy plan_features_update on plan_features for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());
create policy plan_features_delete on plan_features for delete to authenticated
  using (is_platform_admin());

-- L'abonnement, la consommation et le journal : l'agence concernée LIT, la
-- plateforme lit et écrit. Une agence ne change pas son propre plan : il n'y
-- a donc aucune politique d'écriture pour elle, nulle part.
do $$
declare t text;
begin
  foreach t in array array['subscriptions','usage_counters','subscription_events'] loop
    execute format('drop policy if exists %1$s_select on %1$I', t);
    execute format('drop policy if exists %1$s_write on %1$I', t);
    execute format('drop policy if exists %1$s_update on %1$I', t);
    execute format('drop policy if exists %1$s_delete on %1$I', t);
    execute format($f$
      create policy %1$s_select on %1$I for select to authenticated
        using (agency_id = auth_agency_id() or is_platform_admin())
    $f$, t);
    execute format($f$
      create policy %1$s_write on %1$I for insert to authenticated
        with check (is_platform_admin())
    $f$, t);
    execute format($f$
      create policy %1$s_update on %1$I for update to authenticated
        using (is_platform_admin()) with check (is_platform_admin())
    $f$, t);
    execute format($f$
      create policy %1$s_delete on %1$I for delete to authenticated
        using (is_platform_admin())
    $f$, t);
  end loop;
end $$;

-- ------------------------------------------------------------------
-- 14 · Les droits
-- ------------------------------------------------------------------
--
-- Deux couches, toujours : le droit de toucher la table, puis la politique qui
-- filtre. Sans le GRANT, PostgreSQL refuse avant même de lire la politique, et
-- on croit à une politique cassée.

grant select, insert, update, delete on plans to authenticated;
grant select, insert, update, delete on features to authenticated;
grant select, insert, update, delete on plan_features to authenticated;
grant select, insert, update, delete on subscriptions to authenticated;
grant select, insert, update, delete on usage_counters to authenticated;
grant select, insert, update, delete on subscription_events to authenticated;

grant all on plans to service_role;
grant all on features to service_role;
grant all on plan_features to service_role;
grant all on subscriptions to service_role;
grant all on usage_counters to service_role;
grant all on subscription_events to service_role;

-- Rien pour l'anonyme. Une fonction SECURITY DEFINER créée un mardi est
-- exécutable par PUBLIC le mercredi si on ne reprend pas le droit.
revoke all on function agency_plan(uuid) from public, anon;
revoke all on function agency_has_feature(uuid, text) from public, anon;
revoke all on function quota_used(uuid, text) from public, anon;
revoke all on function quota_limit(uuid, text) from public, anon;
revoke all on function quota_check(uuid, text) from public, anon;
revoke all on function quota_guard(uuid, text) from public, anon;
revoke all on function guard_office_quota() from public, anon;
revoke all on function guard_profile_quota() from public, anon;
revoke all on function agency_start_trial() from public, anon;
revoke all on function refresh_usage(uuid) from public, anon;
revoke all on function refresh_usage_all() from public, anon;
revoke all on function subscription_invoice_amount(uuid) from public, anon;
revoke all on function platform_subscriptions() from public, anon;
revoke all on function platform_set_subscription(uuid, text, int, date, text) from public, anon;
revoke all on function platform_subscription_events(uuid, int) from public, anon;
revoke all on function my_plan() from public, anon;

grant execute on function agency_plan(uuid) to authenticated;
grant execute on function agency_has_feature(uuid, text) to authenticated;
grant execute on function quota_used(uuid, text) to authenticated;
grant execute on function quota_limit(uuid, text) to authenticated;
grant execute on function quota_check(uuid, text) to authenticated;
grant execute on function quota_guard(uuid, text) to authenticated;
grant execute on function refresh_usage(uuid) to authenticated;
grant execute on function refresh_usage_all() to authenticated;
grant execute on function subscription_invoice_amount(uuid) to authenticated;
grant execute on function platform_subscriptions() to authenticated;
grant execute on function platform_set_subscription(uuid, text, int, date, text) to authenticated;
grant execute on function platform_subscription_events(uuid, int) to authenticated;
grant execute on function my_plan() to authenticated;
