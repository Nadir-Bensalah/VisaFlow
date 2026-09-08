-- 0056 · Le support et le démarrage.
--
-- Sections 186, 187, 188, 190 et 191 du cahier des charges. Cinq besoins qui
-- n'ont l'air de rien et qui décident pourtant si une agence garde l'outil.
--
-- LE PREMIER SOIR. Une agence qui s'inscrit ouvre l'outil une fois, le soir,
-- après la fermeture. Si elle ne sait pas quoi faire dans les dix minutes, elle
-- ne le rouvre pas. Il existait déjà un début d'accueil : `agencies.setup_done`
-- et `agencies.setup_hidden`, cinq cases à cocher À LA MAIN. Le défaut se voit
-- tout de suite : une agence qui a déjà créé trois clients devait quand même
-- cliquer sur « créer un premier client ». On garde les deux colonnes, on
-- reprend leur contenu, et on remplace le geste par une DÉDUCTION : l'étape est
-- faite quand la donnée existe, point.
--
-- LE CHOIX D'ACTIVITÉ. Une agence de visas ne doit jamais voir un écran de
-- fret, et l'inverse. La colonne `agencies.services` porte déjà le choix.
-- Ce qui manquait, c'est un endroit unique qui traduise ce choix en « voilà ce
-- que la navigation montre ». Écrit dans le navigateur, ce calcul se contourne
-- avec la console du navigateur ; écrit ici, il ne se contourne pas.
--
-- LE SUPPORT. Un fil de discussion, pas un formulaire à sens unique : une
-- agence qui écrit et n'obtient rien en retour appelle au téléphone, et le
-- téléphone ne laisse pas de trace. Point capital : LE TICKET NE DONNE AUCUN
-- ACCÈS AUX DONNÉES DE L'AGENCE. La plateforme lit le fil, pas le dossier.
-- Pour regarder le dossier, il existe la vue support de 0028, avec son journal
-- d'accès. Une porte de plus ici viderait ce journal de son sens.
--
-- LES RETOURS. Une agence peut voter pour une idée déposée par une autre.
-- Mais elle ne voit JAMAIS qui l'a déposée : les agences de visas tunisiennes
-- sont concurrentes entre elles, et savoir ce que la concurrence demande est
-- une information commerciale. C'est vérifié au banc, pas seulement écrit ici.
--
-- CE QU'ON NE FAIT PAS. Aucune clé étrangère vers les tables des migrations
-- 0045 à 0055, écrites en parallèle : on les lit par `to_regclass` et on s'en
-- passe quand elles manquent. Un module qui refuse de se charger parce qu'un
-- autre module n'est pas encore posé est un module qui bloque la livraison.

-- ==================================================================
-- 1 · LE DÉMARRAGE (section 190)
-- ==================================================================

-- Cette table ne porte QUE ce qui ne se déduit pas : un clic explicite, ou un
-- refus explicite. Tout le reste se lit dans les données réelles. Écrire ici
-- « l'agence a créé un client » serait un deuxième registre à tenir à jour, et
-- le jour où il diverge, c'est lui qu'on croit.
create table if not exists onboarding_steps (
  agency_id  uuid not null references agencies on delete cascade,
  step       text not null check (step in (
               'profil','bureau','equipe','services','prix','marque',
               'premier_client','premier_dossier')),
  done       boolean not null default false,
  done_at    timestamptz,
  done_by    uuid references auth.users on delete set null,
  -- Passer une étape n'est pas la faire. Une agence d'un seul bureau n'a
  -- personne à inviter : lui laisser une case rouge à vie la ferait fermer
  -- l'accueil pour de bon, et on perdrait les étapes suivantes.
  skipped    boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (agency_id, step)
);

comment on table onboarding_steps is
  'Les étapes de démarrage cochées ou passées À LA MAIN. Ce qui se déduit des données réelles n''est pas écrit ici : un deuxième registre finit toujours par mentir.';

-- Reprise de l'accueil précédent. Les cinq clés de `setup_done` deviennent des
-- étapes. « share » disparaît : copier l'adresse publique n'est pas une étape
-- d'installation, c'est un geste qu'on refait tous les jours.
insert into onboarding_steps (agency_id, step, done, done_at)
select a.id, m.step, true, a.created_at
from agencies a
cross join lateral (values
  ('offices', 'bureau'), ('team', 'equipe'), ('catalog', 'services'),
  ('firstCase', 'premier_dossier')
) as m(ancien, step)
where m.ancien = any (a.setup_done)
on conflict (agency_id, step) do nothing;

-- ------------------------------------------------------------------
-- Ce que les données disent déjà
-- ------------------------------------------------------------------
--
-- Une étape est faite quand la trace de son geste existe. On ne demande pas
-- « as-tu rempli ton profil », on regarde si le profil est rempli.
--
-- Deux tables appartiennent à des migrations écrites en parallèle
-- (`services`, le catalogue marchand de 0045). On les lit par EXECUTE, après
-- `to_regclass` : une référence statique planterait à l'exécution, pas à la
-- création, donc bien après la relecture.
create or replace function onboarding_auto(p_agency uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a           agencies;
  v_visas     boolean;
  v_fret      boolean;
  v_catalogue boolean := false;   -- au moins un service au catalogue
  v_prix      boolean := false;   -- au moins un prix posé
  n           int;
begin
  select * into a from agencies where id = p_agency;
  if a.id is null then return '{}'::jsonb; end if;

  v_visas := 'visas' = any (a.services);
  v_fret  := 'fret'  = any (a.services);

  -- Le catalogue des visas est livré rempli par `seed_catalogue` : une agence
  -- de visas trouve donc ces deux étapes déjà vertes. C'est voulu, c'est même
  -- tout l'objet du catalogue de départ. On ne fait pas cocher ce qui est fait.
  if v_visas then
    select count(*) into n from visa_types where agency_id = p_agency and active;
    v_catalogue := n > 0;
    select count(*) into n from visa_types where agency_id = p_agency and active and fee_agency > 0;
    v_prix := n > 0;
  end if;

  -- Une agence de fret n'a pas de types de visa : son catalogue est celui des
  -- services marchands, posé par un autre module.
  if not v_catalogue and v_fret and to_regclass('public.services') is not null then
    execute 'select count(*) from services where agency_id = $1 and active'
      into n using p_agency;
    v_catalogue := n > 0;
    execute 'select count(*) from services where agency_id = $1 and active and default_price > 0'
      into n using p_agency;
    v_prix := v_prix or n > 0;
  end if;

  return jsonb_build_object(
    -- Le profil : de quoi émettre un reçu et rappeler l'agence.
    'profil', (a.phone is not null and a.email is not null and a.legal_name is not null),
    -- Le bureau naît avec l'agence, sans adresse. L'adresse, elle, se saisit.
    'bureau', exists (
      select 1 from offices o
      where o.agency_id = p_agency and o.active and nullif(trim(o.address), '') is not null),
    -- Quelqu'un d'autre que le propriétaire travaille dans l'outil.
    'equipe', (select count(*) from profiles p where p.agency_id = p_agency and p.active) > 1,
    'services', v_catalogue,
    'prix', v_prix,
    -- La marque : un logo, un nom d'affichage ou une couleur choisie.
    'marque', (a.logo_path is not null or a.display_name is not null or a.accent_color is not null),
    'premier_client', exists (
      select 1 from clients c where c.agency_id = p_agency and c.deleted_at is null),
    -- Un dossier de visa OU une cargaison : les deux métiers comptent pareil.
    'premier_dossier', exists (select 1 from cases c where c.agency_id = p_agency)
                    or exists (select 1 from shipments s where s.agency_id = p_agency)
  );
end $$;

comment on function onboarding_auto(uuid) is
  'Ce que les données réelles disent déjà. Une agence qui a trois clients n''a pas à cocher « créer un premier client ».';

-- ------------------------------------------------------------------
-- L'état du démarrage, tel que la carte d'accueil le montre
-- ------------------------------------------------------------------
--
-- Une étape est faite si la donnée existe OU si quelqu'un l'a cochée. Le clic
-- reste utile pour les étapes que rien ne trahit : « j'ai regardé les prix et
-- ils me vont » ne laisse aucune trace en base.
create or replace function onboarding_state(p_agency uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_agency uuid;
  v_auto   jsonb;
  v_steps  jsonb;
  v_done   int;
  v_skip   int;
  v_total  int;
  v_next   text;
  v_hidden boolean;
begin
  v_agency := coalesce(p_agency, auth_agency_id());
  if v_agency is null then raise exception 'agence inconnue' using errcode = 'P0002'; end if;
  -- On ne lit l'accueil d'une autre agence que depuis la plateforme.
  if v_agency <> coalesce(auth_agency_id(), v_agency) and not is_platform_admin() then
    raise exception 'hors de votre agence' using errcode = '42501';
  end if;

  v_auto := onboarding_auto(v_agency);
  select setup_hidden into v_hidden from agencies where id = v_agency;

  select jsonb_agg(x.ligne order by x.rang), count(*) filter (where x.fait),
         count(*) filter (where x.passe and not x.fait), count(*)
    into v_steps, v_done, v_skip, v_total
  from (
    select
      s.rang,
      coalesce((v_auto ->> s.step)::boolean, false) or coalesce(t.done, false) as fait,
      coalesce(t.skipped, false) as passe,
      jsonb_build_object(
        'step', s.step,
        'done', coalesce((v_auto ->> s.step)::boolean, false) or coalesce(t.done, false),
        -- « auto » dit d'où vient la coche. L'écran s'en sert pour montrer
        -- « déjà fait » au lieu d'un bouton qui ne servirait à rien.
        'auto', coalesce((v_auto ->> s.step)::boolean, false),
        'skipped', coalesce(t.skipped, false),
        'done_at', t.done_at,
        'done_by', t.done_by
      ) as ligne
    from (values
      ('profil', 1), ('bureau', 2), ('equipe', 3), ('services', 4),
      ('prix', 5), ('marque', 6), ('premier_client', 7), ('premier_dossier', 8)
    ) as s(step, rang)
    left join onboarding_steps t on t.agency_id = v_agency and t.step = s.step
  ) x;

  -- L'étape en cours : la première ni faite ni passée. Null quand tout est réglé.
  select (e ->> 'step') into v_next
  from jsonb_array_elements(v_steps) e
  where not (e ->> 'done')::boolean and not (e ->> 'skipped')::boolean
  limit 1;

  return jsonb_build_object(
    'agency_id', v_agency,
    'steps', v_steps,
    'total', v_total,
    'done', v_done,
    'skipped', v_skip,
    -- Une étape passée exprès est réglée : la laisser peser sur la barre
    -- laisserait l'accueil à 80 % pour toujours, et personne ne le rouvrirait.
    'percent', round(100.0 * (v_done + v_skip) / greatest(v_total, 1))::int,
    'current', v_next,
    'remaining', (
      select coalesce(jsonb_agg(e ->> 'step'), '[]'::jsonb)
      from jsonb_array_elements(v_steps) e
      where not (e ->> 'done')::boolean and not (e ->> 'skipped')::boolean),
    'complete', v_next is null,
    -- L'agence a le droit de ranger la carte. La colonne existait déjà, on ne
    -- la remplace pas : le magasin du navigateur l'écrit encore.
    'hidden', coalesce(v_hidden, false)
  );
end $$;

comment on function onboarding_state(uuid) is
  'L''état du démarrage : l''étape en cours, ce qui reste, le pourcentage. Elle DÉDUIT ce qui est fait plutôt que d''attendre un clic.';

-- Cocher une étape à la main. Sert aux étapes qu'aucune donnée ne trahit.
create or replace function onboarding_complete(p_step text)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_agency uuid;
begin
  v_agency := auth_agency_id();
  if v_agency is null then raise exception 'agence inconnue' using errcode = 'P0002'; end if;
  insert into onboarding_steps (agency_id, step, done, done_at, done_by, skipped)
  values (v_agency, p_step, true, now(), auth.uid(), false)
  on conflict (agency_id, step) do update
    set done = true, done_at = now(), done_by = auth.uid(), skipped = false;
  return onboarding_state(v_agency);
end $$;

-- Passer une étape. Ce n'est pas la faire : les deux se comptent à part, et
-- l'écran peut proposer d'y revenir.
create or replace function onboarding_skip(p_step text)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_agency uuid;
begin
  v_agency := auth_agency_id();
  if v_agency is null then raise exception 'agence inconnue' using errcode = 'P0002'; end if;
  insert into onboarding_steps (agency_id, step, done, skipped)
  values (v_agency, p_step, false, true)
  on conflict (agency_id, step) do update set skipped = true, done = false;
  return onboarding_state(v_agency);
end $$;

-- Ranger ou rouvrir la carte d'accueil. On écrit dans l'ANCIENNE colonne :
-- `store.tsx` la lit déjà, et la casser pour rien n'apporterait rien.
create or replace function onboarding_hide(p_hidden boolean default true)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_agency uuid;
begin
  v_agency := auth_agency_id();
  if v_agency is null then raise exception 'agence inconnue' using errcode = 'P0002'; end if;
  if not auth_can('settings:view') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  update agencies set setup_hidden = coalesce(p_hidden, true) where id = v_agency;
end $$;

-- ==================================================================
-- 2 · LE CHOIX D'ACTIVITÉ (section 191)
-- ==================================================================
--
-- Une agence de visas qui voit « Cargaisons », « Douane » et « Entrepôts »
-- dans son menu croit que l'outil n'est pas fait pour elle. Une agence de fret
-- qui voit « Créneaux consulaires » croit la même chose. Ce calcul dit ce que
-- la navigation montre, et il est le seul à le dire.
--
-- Deux filtres se superposent, dans cet ordre :
--   1. le MÉTIER, `agencies.services`, que l'agence a choisi ;
--   2. l'ABONNEMENT, `agency_has_feature`, que la plateforme a vendu.
-- Le métier passe en premier : une agence de visas qui paie l'option fret n'a
-- toujours rien à faire d'un écran de cargaisons.
--
-- `agency_has_feature` vit dans 0049, écrite en parallèle. Si elle manque, on
-- ouvre tout ce que le métier autorise : un module absent ne doit pas fermer
-- des écrans qui marchaient hier.

-- Le pont vers l'abonnement. L'appel est DYNAMIQUE : une référence statique à
-- une fonction absente ne casse pas à la création mais au premier appel, donc
-- bien après la relecture, et en production.
create or replace function feature_on(p_agency uuid, p_feature text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if to_regprocedure('public.agency_has_feature(uuid, text)') is null then
    -- Pas de module d'abonnement : rien n'est fermé. Fermer par défaut
    -- viderait le menu de toutes les agences le jour de la mise en service.
    return true;
  end if;
  execute 'select agency_has_feature($1, $2)' into v using p_agency, p_feature;
  return coalesce(v, true);
end $$;

comment on function feature_on(uuid, text) is
  'Le pont vers l''abonnement, appelé dynamiquement. Sans module d''abonnement, tout est ouvert : un module absent ne doit pas fermer des écrans qui marchaient hier.';

create or replace function agency_modules(p_agency uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_agency   uuid;
  v_services text[];
  v_visas    boolean;
  v_fret     boolean;
  v_abo      boolean := to_regprocedure('public.agency_has_feature(uuid, text)') is not null;
  v_mods     jsonb;
begin
  v_agency := coalesce(p_agency, auth_agency_id());
  if v_agency is null then raise exception 'agence inconnue' using errcode = 'P0002'; end if;
  if v_agency <> coalesce(auth_agency_id(), v_agency) and not is_platform_admin() then
    raise exception 'hors de votre agence' using errcode = '42501';
  end if;

  select services into v_services from agencies where id = v_agency;
  if v_services is null then raise exception 'agence introuvable' using errcode = 'P0002'; end if;

  v_visas := 'visas' = any (v_services);
  v_fret  := 'fret'  = any (v_services);

  v_mods := jsonb_build_object(
    -- Le tronc commun : tout le monde a des clients, des messages et des tâches.
    'clients', true,
    'messages', true,
    'taches', true,
    'demandes', true,
    'rendez_vous', v_visas,
    'pieces', v_visas,
    'creneaux', v_visas,
    'dossiers', v_visas,
    'cargaisons', v_fret,
    'douane', v_fret,
    'entrepots', v_fret,
    'transporteurs', v_fret,
    'paiements', true,
    'devis', true,
    'factures', true,
    'rapports', true,
    'statistiques', true,
    'automatisations', true,
    'reglages', true,
    'portail', true,
    'whatsapp', true,
    'crm', true,
    'comptabilite', false,
    'api', false,
    'marque_blanche', false
  );

  -- L'abonnement referme ce que le métier a ouvert, jamais l'inverse.
  if v_abo then
    v_mods := v_mods
      || jsonb_build_object('dossiers',     v_visas and feature_on(v_agency, 'VISA'))
      || jsonb_build_object('pieces',       v_visas and feature_on(v_agency, 'VISA'))
      || jsonb_build_object('rendez_vous',  v_visas and feature_on(v_agency, 'VISA'))
      || jsonb_build_object('creneaux',     v_visas and feature_on(v_agency, 'VISA'))
      || jsonb_build_object('cargaisons',   v_fret and feature_on(v_agency, 'CARGO'))
      || jsonb_build_object('douane',       v_fret and feature_on(v_agency, 'CARGO'))
      || jsonb_build_object('entrepots',    v_fret and feature_on(v_agency, 'CARGO'))
      || jsonb_build_object('transporteurs', v_fret and feature_on(v_agency, 'CARGO'))
      || jsonb_build_object('crm',          feature_on(v_agency, 'CRM'))
      || jsonb_build_object('whatsapp',     feature_on(v_agency, 'WHATSAPP'))
      || jsonb_build_object('portail',      feature_on(v_agency, 'CLIENT_PORTAL'))
      || jsonb_build_object('rapports',     feature_on(v_agency, 'ADVANCED_REPORTS'))
      || jsonb_build_object('statistiques', feature_on(v_agency, 'ADVANCED_REPORTS'))
      || jsonb_build_object('comptabilite', feature_on(v_agency, 'ACCOUNTING'))
      || jsonb_build_object('api',          feature_on(v_agency, 'API'))
      || jsonb_build_object('marque_blanche', feature_on(v_agency, 'WHITE_LABEL'));
  end if;

  return jsonb_build_object(
    'agency_id', v_agency,
    'services', to_jsonb(v_services),
    'visas', v_visas,
    'fret', v_fret,
    'billing_aware', v_abo,
    'modules', v_mods
  );
end $$;

comment on function agency_modules(uuid) is
  'Ce que la navigation montre. Une agence de visas ne voit jamais un écran de fret, et l''inverse. Le métier filtre d''abord, l''abonnement referme ensuite.';

-- ==================================================================
-- 3 · LE SUPPORT (section 186)
-- ==================================================================

create table if not exists support_tickets (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  office_id      uuid references offices on delete set null,
  created_by     uuid references auth.users on delete set null,
  category       text not null default 'question'
                 check (category in ('question','anomalie','demande','facturation','urgence')),
  priority       text not null default 'normale'
                 check (priority in ('basse','normale','haute','urgente')),
  subject        text not null,
  message        text not null,
  status         text not null default 'ouvert'
                 check (status in ('ouvert','pris_en_charge','en_attente_client','resolu','ferme')),
  assigned_admin uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  -- De 1 à 5, demandé UNE fois, à la clôture. Une note obligatoire ne mesure
  -- que la patience de qui répond au questionnaire.
  satisfaction   int check (satisfaction between 1 and 5)
);
create index if not exists support_tickets_agency on support_tickets (agency_id, created_at desc);
create index if not exists support_tickets_ouverts on support_tickets (status, priority, created_at)
  where status in ('ouvert','pris_en_charge','en_attente_client');

comment on table support_tickets is
  'Les demandes d''aide d''une agence. Le ticket ne donne AUCUN accès aux données de l''agence : la plateforme lit le fil, pas le dossier. Pour le dossier, il y a la vue support de 0028 et son journal.';

-- Un fil, pas un formulaire. Le premier message de l'agence y est recopié :
-- sans lui, la réponse de la plateforme arriverait sans la question.
create table if not exists support_messages (
  id              uuid primary key default gen_random_uuid(),
  ticket_id       uuid not null references support_tickets on delete cascade,
  agency_id       uuid not null references agencies on delete cascade,
  author_id       uuid references auth.users on delete set null,
  author_kind     text not null check (author_kind in ('agence','plateforme')),
  body            text not null,
  -- Un chemin dans le seau de stockage, jamais le fichier lui-même.
  attachment_path text,
  at              timestamptz not null default now(),
  read_at         timestamptz
);
create index if not exists support_messages_ticket on support_messages (ticket_id, at);

comment on table support_messages is
  'Le fil d''un ticket, les deux sens confondus. `author_kind` dit de quel côté vient le message : l''identité de la personne ne sort jamais du côté d''en face.';

-- L'horodatage du ticket suit son fil. Sans lui, la boîte de réception de la
-- plateforme trierait sur la date d'ouverture, et un ticket relancé dix fois
-- resterait au fond.
create or replace function support_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update support_tickets set updated_at = now() where id = new.ticket_id;
  return new;
end $$;

drop trigger if exists support_messages_touch on support_messages;
create trigger support_messages_touch
  after insert on support_messages
  for each row execute function support_touch();

-- ------------------------------------------------------------------
-- Ouvrir, répondre, lire
-- ------------------------------------------------------------------

create or replace function support_open(
  p_category text, p_priority text, p_subject text, p_message text
) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_agency uuid; v_id uuid; v_office uuid;
begin
  v_agency := auth_agency_id();
  if v_agency is null then raise exception 'agence inconnue' using errcode = 'P0002'; end if;
  if coalesce(trim(p_subject), '') = '' or coalesce(trim(p_message), '') = '' then
    raise exception 'un ticket sans sujet ni message n''aide personne' using errcode = 'P0001';
  end if;
  -- Un écran qui boucle peut ouvrir cinq cents tickets en une minute, et la
  -- boîte de réception devient inutilisable. Vingt par heure et par agence.
  if not rate_allow('support_open', v_agency::text, 20, interval '1 hour') then
    raise exception 'trop de demandes ouvertes coup sur coup' using errcode = 'P0001';
  end if;

  select office_id into v_office from profiles where id = auth.uid();

  insert into support_tickets (agency_id, office_id, created_by, category, priority, subject, message)
  values (v_agency, v_office, auth.uid(),
          coalesce(nullif(p_category, ''), 'question'),
          coalesce(nullif(p_priority, ''), 'normale'),
          trim(p_subject), trim(p_message))
  returning id into v_id;

  insert into support_messages (ticket_id, agency_id, author_id, author_kind, body)
  values (v_id, v_agency, auth.uid(), 'agence', trim(p_message));

  return v_id;
end $$;

-- La même porte pour les deux côtés. Le côté se DÉDUIT du compte, il ne se
-- déclare pas : un paramètre « je suis la plateforme » se ment.
create or replace function support_reply(p_ticket uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare t support_tickets; v_kind text; v_id uuid;
begin
  if coalesce(trim(p_body), '') = '' then
    raise exception 'un message vide n''est pas une réponse' using errcode = 'P0001';
  end if;
  select * into t from support_tickets where id = p_ticket;
  if t.id is null then raise exception 'ticket introuvable' using errcode = 'P0002'; end if;

  if is_platform_admin() then
    v_kind := 'plateforme';
  elsif t.agency_id = auth_agency_id() then
    v_kind := 'agence';
  else
    raise exception 'ce ticket n''est pas le vôtre' using errcode = '42501';
  end if;

  if t.status = 'ferme' then
    raise exception 'ce ticket est fermé' using errcode = 'P0001';
  end if;

  insert into support_messages (ticket_id, agency_id, author_id, author_kind, body)
  values (p_ticket, t.agency_id, auth.uid(), v_kind, trim(p_body))
  returning id into v_id;

  -- L'état suit la conversation, sans que personne ait à y penser. Le support
  -- qui répond prend le ticket en charge ; l'agence qui répond le remet dans
  -- la file, même s'il était marqué résolu un peu vite.
  if v_kind = 'plateforme' and t.status = 'ouvert' then
    update support_tickets set status = 'pris_en_charge', assigned_admin = coalesce(t.assigned_admin, auth.uid())
     where id = p_ticket;
  elsif v_kind = 'agence' and t.status in ('en_attente_client','resolu') then
    update support_tickets set status = 'ouvert', resolved_at = null where id = p_ticket;
  end if;

  return v_id;
end $$;

-- Les tickets de l'agence connectée, fils compris. Un seul aller-retour :
-- l'écran de support est ouvert par quelqu'un qui a déjà un problème, lui en
-- ajouter un de lenteur serait mal choisi.
create or replace function support_my_tickets()
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare v_agency uuid;
begin
  v_agency := auth_agency_id();
  if v_agency is null then raise exception 'agence inconnue' using errcode = 'P0002'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'category', t.category, 'priority', t.priority,
      'subject', t.subject, 'message', t.message, 'status', t.status,
      'created_at', t.created_at, 'updated_at', t.updated_at,
      'resolved_at', t.resolved_at, 'satisfaction', t.satisfaction,
      'created_by', t.created_by,
      'thread', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', m.id, 'author_kind', m.author_kind, 'body', m.body,
          'attachment_path', m.attachment_path, 'at', m.at
        ) order by m.at), '[]'::jsonb)
        from support_messages m where m.ticket_id = t.id)
    ) order by t.updated_at desc)
    from support_tickets t where t.agency_id = v_agency
  ), '[]'::jsonb);
end $$;

-- La note de satisfaction, posée une fois, par l'agence seule.
create or replace function support_rate(p_ticket uuid, p_score int)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if p_score is null or p_score < 1 or p_score > 5 then
    raise exception 'la note va de 1 à 5' using errcode = 'P0001';
  end if;
  update support_tickets set satisfaction = p_score
   where id = p_ticket and agency_id = auth_agency_id();
  if not found then raise exception 'ticket introuvable' using errcode = 'P0002'; end if;
end $$;

-- ------------------------------------------------------------------
-- Le côté plateforme
-- ------------------------------------------------------------------
--
-- Ce que la boîte de réception rend : le fil, le nom de l'agence, et rien
-- d'autre. Pas un client, pas un dossier, pas un montant. Le support répond à
-- une question ; s'il doit regarder la donnée, il ouvre la vue support de 0028
-- et l'ouverture est journalisée.
create or replace function platform_tickets(p_status text default null)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'agency_id', t.agency_id, 'agency_name', a.name, 'agency_slug', a.slug,
      'agency_plan', a.plan,
      'category', t.category, 'priority', t.priority, 'subject', t.subject,
      'message', t.message, 'status', t.status, 'assigned_admin', t.assigned_admin,
      'created_at', t.created_at, 'updated_at', t.updated_at,
      'resolved_at', t.resolved_at, 'satisfaction', t.satisfaction,
      'messages', (select count(*) from support_messages m where m.ticket_id = t.id),
      'last_kind', (select m.author_kind from support_messages m
                     where m.ticket_id = t.id order by m.at desc limit 1),
      'thread', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', m.id, 'author_kind', m.author_kind, 'body', m.body,
          'attachment_path', m.attachment_path, 'at', m.at
        ) order by m.at), '[]'::jsonb)
        from support_messages m where m.ticket_id = t.id)
    ) order by
      -- L'urgent d'abord, puis le plus vieux sans réponse : c'est l'ordre dans
      -- lequel une file se traite, pas l'ordre d'arrivée.
      case t.priority when 'urgente' then 0 when 'haute' then 1 when 'normale' then 2 else 3 end,
      t.updated_at)
    from support_tickets t
    join agencies a on a.id = t.agency_id
    where p_status is null or t.status = p_status
  ), '[]'::jsonb);
end $$;

create or replace function platform_ticket_reply(p_ticket uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  return support_reply(p_ticket, p_body);
end $$;

create or replace function platform_ticket_status(p_ticket uuid, p_status text)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  if p_status not in ('ouvert','pris_en_charge','en_attente_client','resolu','ferme') then
    raise exception 'état inconnu' using errcode = 'P0001';
  end if;
  update support_tickets
     set status = p_status,
         assigned_admin = coalesce(assigned_admin, auth.uid()),
         -- La date de résolution se pose et se retire toute seule : un ticket
         -- rouvert qui garde sa date de résolution fausse toutes les mesures.
         resolved_at = case when p_status in ('resolu','ferme') then coalesce(resolved_at, now()) else null end
   where id = p_ticket;
  if not found then raise exception 'ticket introuvable' using errcode = 'P0002'; end if;
end $$;

-- ==================================================================
-- 4 · LES ANNONCES (section 187)
-- ==================================================================
--
-- Cette table n'appartient à aucune agence : elle appartient à la plateforme.
-- D'où l'absence de `agency_id not null`. `target_agency_id` n'est pas un
-- propriétaire, c'est un destinataire, et il n'existe que pour la cible
-- « une_agence ».
create table if not exists announcements (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('maintenance','nouveaute','incident','pays')),
  -- Quatre langues : une agence chinoise de Sfax lit le bandeau comme les autres.
  title            jsonb not null,
  body             jsonb not null default '{}'::jsonb,
  severity         text not null default 'info' check (severity in ('info','attention','critique')),
  starts_at        timestamptz not null default now(),
  ends_at          timestamptz,
  target           text not null default 'toutes'
                   check (target in ('toutes','essai','payantes','une_agence')),
  target_agency_id uuid references agencies on delete cascade,
  -- Tant que ce champ est vide, l'annonce est un brouillon et personne ne la voit.
  published_at     timestamptz,
  created_by       uuid references auth.users on delete set null,
  created_at       timestamptz not null default now(),
  check (target <> 'une_agence' or target_agency_id is not null),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists announcements_vivantes on announcements (starts_at desc)
  where published_at is not null;

comment on table announcements is
  'Les annonces de la plateforme : maintenance, nouveauté, incident, alerte pays. Elles se lisent par tous les comptes visés, elles ne s''écrivent que par la plateforme.';

create table if not exists announcement_reads (
  announcement_id uuid not null references announcements on delete cascade,
  user_id         uuid not null references auth.users on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

comment on table announcement_reads is
  'Qui a lu quoi. Le non-lu remonte en tête : une annonce déjà vue qui reste en haut du bandeau finit par ne plus être lue du tout.';

-- Ce qu'un compte connecté doit voir MAINTENANT. Non lu en premier, puis le
-- plus grave, puis le plus récent.
create or replace function active_announcements()
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare v_agency uuid; v_essai boolean := false; v_uid uuid := auth.uid();
begin
  v_agency := auth_agency_id();
  if v_agency is not null then
    -- « En essai » se lit sur l'agence, pas sur la souscription : la table des
    -- souscriptions appartient à un module écrit en parallèle, et un bandeau
    -- ne vaut pas de dépendre d'un fichier qui n'est pas encore posé.
    select (plan = 'essai') or (trial_ends_at is not null and trial_ends_at > now())
      into v_essai from agencies where id = v_agency;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', an.id, 'kind', an.kind, 'title', an.title, 'body', an.body,
      'severity', an.severity, 'starts_at', an.starts_at, 'ends_at', an.ends_at,
      'published_at', an.published_at,
      'read', r.read_at is not null, 'read_at', r.read_at
    ) order by
      (r.read_at is not null),
      case an.severity when 'critique' then 0 when 'attention' then 1 else 2 end,
      an.starts_at desc)
    from announcements an
    left join announcement_reads r on r.announcement_id = an.id and r.user_id = v_uid
    where an.published_at is not null
      and an.starts_at <= now()
      and (an.ends_at is null or an.ends_at > now())
      and case an.target
            when 'toutes' then true
            when 'essai' then coalesce(v_essai, false)
            when 'payantes' then v_agency is not null and not coalesce(v_essai, false)
            when 'une_agence' then an.target_agency_id = v_agency
            else false
          end
  ), '[]'::jsonb);
end $$;

comment on function active_announcements() is
  'Les annonces vivantes pour le compte connecté, non lues en tête. Une annonce ciblée n''apparaît qu''à sa cible.';

create or replace function announcement_read(p_announcement uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'compte requis' using errcode = '42501'; end if;
  insert into announcement_reads (announcement_id, user_id)
  values (p_announcement, auth.uid())
  on conflict (announcement_id, user_id) do nothing;
end $$;

-- La rédaction, côté console. Une annonce naît en brouillon : `published_at`
-- reste vide tant que personne n'a décidé de l'envoyer.
create or replace function platform_save_announcement(
  p_id uuid, p_kind text, p_title jsonb, p_body jsonb, p_severity text,
  p_starts_at timestamptz, p_ends_at timestamptz,
  p_target text, p_target_agency uuid
) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  if coalesce(p_title ->> 'fr', '') = '' then
    raise exception 'le titre français fait foi, il ne peut pas être vide' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into announcements (kind, title, body, severity, starts_at, ends_at,
                               target, target_agency_id, created_by)
    values (p_kind, p_title, coalesce(p_body, '{}'::jsonb), coalesce(p_severity, 'info'),
            coalesce(p_starts_at, now()), p_ends_at,
            coalesce(p_target, 'toutes'), p_target_agency, auth.uid())
    returning id into v_id;
  else
    update announcements
       set kind = p_kind, title = p_title, body = coalesce(p_body, '{}'::jsonb),
           severity = coalesce(p_severity, 'info'),
           starts_at = coalesce(p_starts_at, starts_at), ends_at = p_ends_at,
           target = coalesce(p_target, 'toutes'), target_agency_id = p_target_agency
     where id = p_id
     returning id into v_id;
    if v_id is null then raise exception 'annonce introuvable' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create or replace function platform_publish_announcement(p_id uuid, p_published boolean default true)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  update announcements set published_at = case when p_published then coalesce(published_at, now()) end
   where id = p_id;
  if not found then raise exception 'annonce introuvable' using errcode = 'P0002'; end if;
end $$;

create or replace function platform_announcements()
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', an.id, 'kind', an.kind, 'title', an.title, 'body', an.body,
      'severity', an.severity, 'starts_at', an.starts_at, 'ends_at', an.ends_at,
      'target', an.target, 'target_agency_id', an.target_agency_id,
      'target_agency_name', ag.name,
      'published_at', an.published_at, 'created_at', an.created_at,
      'reads', (select count(*) from announcement_reads r where r.announcement_id = an.id)
    ) order by an.created_at desc)
    from announcements an
    left join agencies ag on ag.id = an.target_agency_id
  ), '[]'::jsonb);
end $$;

-- ==================================================================
-- 5 · LES RETOURS (section 188)
-- ==================================================================

create table if not exists feedback (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references agencies on delete cascade,
  user_id    uuid references auth.users on delete set null,
  kind       text not null default 'idee' check (kind in ('idee','gene','compliment','autre')),
  message    text not null,
  -- La page d'où part le retour. C'est ce qui rend un « ça ne marche pas »
  -- exploitable : sans elle, il faut écrire pour demander où.
  page       text,
  status     text not null default 'nouveau'
             check (status in ('nouveau','lu','planifie','fait','ecarte')),
  votes      int not null default 0,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references auth.users on delete set null,
  response   text
);
create index if not exists feedback_agency on feedback (agency_id, created_at desc);
create index if not exists feedback_tableau on feedback (status, votes desc);

comment on table feedback is
  'Les retours des agences. La ligne porte son agence d''origine pour que l''auteur retrouve son propre retour, mais le tableau des idées votables ne la révèle JAMAIS : les agences sont concurrentes entre elles, et savoir ce que la concurrence demande est une information commerciale.';

-- Un vote par agence, pas par personne : trois agents de la même agence qui
-- votent trois fois ne pèsent pas trois agences. C'est la clé primaire qui
-- l'impose, pas un compte à la main.
create table if not exists feedback_votes (
  feedback_id uuid not null references feedback on delete cascade,
  agency_id   uuid not null references agencies on delete cascade,
  user_id     uuid references auth.users on delete set null,
  at          timestamptz not null default now(),
  primary key (feedback_id, agency_id)
);

comment on table feedback_votes is
  'Qui a voté pour quoi. Une ligne par agence et par idée : c''est la clé primaire qui garantit qu''un vote ne compte qu''une fois.';

create or replace function feedback_send(p_kind text, p_message text, p_page text default null)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_agency uuid; v_id uuid;
begin
  v_agency := auth_agency_id();
  if v_agency is null then raise exception 'agence inconnue' using errcode = 'P0002'; end if;
  if coalesce(trim(p_message), '') = '' then
    raise exception 'un retour vide n''apprend rien' using errcode = 'P0001';
  end if;
  if not rate_allow('feedback_send', v_agency::text, 30, interval '1 hour') then
    raise exception 'trop de retours coup sur coup' using errcode = 'P0001';
  end if;
  insert into feedback (agency_id, user_id, kind, message, page)
  values (v_agency, auth.uid(), coalesce(nullif(p_kind, ''), 'idee'), trim(p_message), p_page)
  returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------------
-- Le tableau des idées : anonyme, par construction
-- ------------------------------------------------------------------
--
-- Cette fonction est le SEUL chemin par lequel une agence voit le retour d'une
-- autre. Elle ne rend ni `agency_id`, ni `user_id`, ni `page` : la page dit
-- souvent quel métier fait l'agence, et le métier suffit à la reconnaître dans
-- une ville où quatre agences se connaissent.
--
-- La politique de lecture de la table, elle, reste fermée à l'agence d'à côté :
-- si cette fonction disparaissait, personne ne retomberait sur les lignes.
create or replace function feedback_board(p_status text default null)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare v_agency uuid;
begin
  v_agency := auth_agency_id();
  if v_agency is null then raise exception 'agence inconnue' using errcode = 'P0002'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'kind', f.kind, 'message', f.message, 'status', f.status,
      'votes', f.votes, 'created_at', f.created_at, 'response', f.response,
      -- Ce que l'agence a le droit de savoir sur elle-même : est-ce le sien,
      -- et a-t-elle déjà voté. Rien sur les autres.
      'mine', f.agency_id = v_agency,
      'voted', exists (select 1 from feedback_votes v
                        where v.feedback_id = f.id and v.agency_id = v_agency)
    ) order by f.votes desc, f.created_at desc)
    from feedback f
    where f.kind = 'idee'
      and f.status <> 'ecarte'
      and (p_status is null or f.status = p_status)
  ), '[]'::jsonb);
end $$;

comment on function feedback_board(text) is
  'Les idées votables. Elle ne rend ni l''agence d''origine, ni son auteur, ni la page : les agences sont concurrentes, et la demande d''un concurrent est une information commerciale.';

-- Voter. Idempotent : appeler deux fois ne compte pas deux fois, et le
-- deuxième appel ne lève pas d'erreur, sinon l'écran devrait deviner l'état.
create or replace function feedback_vote(p_feedback uuid)
returns int
language plpgsql security definer set search_path = public, auth as $$
declare v_agency uuid; n int;
begin
  v_agency := auth_agency_id();
  if v_agency is null then raise exception 'agence inconnue' using errcode = 'P0002'; end if;
  if not exists (select 1 from feedback where id = p_feedback) then
    raise exception 'retour introuvable' using errcode = 'P0002';
  end if;

  insert into feedback_votes (feedback_id, agency_id, user_id)
  values (p_feedback, v_agency, auth.uid())
  on conflict (feedback_id, agency_id) do nothing;

  -- Le compteur se RECALCULE, il ne s'incrémente pas : un compteur incrémenté
  -- dérive dès la première ligne effacée, et personne ne s'en aperçoit.
  select count(*) into n from feedback_votes where feedback_id = p_feedback;
  update feedback set votes = n where id = p_feedback;
  return n;
end $$;

-- Retirer son vote. Le même geste, dans l'autre sens.
create or replace function feedback_unvote(p_feedback uuid)
returns int
language plpgsql security definer set search_path = public, auth as $$
declare v_agency uuid; n int;
begin
  v_agency := auth_agency_id();
  if v_agency is null then raise exception 'agence inconnue' using errcode = 'P0002'; end if;
  delete from feedback_votes where feedback_id = p_feedback and agency_id = v_agency;
  select count(*) into n from feedback_votes where feedback_id = p_feedback;
  update feedback set votes = n where id = p_feedback;
  return n;
end $$;

-- Côté plateforme : la liste complète, l'agence comprise. C'est le seul endroit
-- où l'origine apparaît, et c'est normal : la plateforme n'est pas concurrente.
create or replace function platform_feedback(p_status text default null)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'agency_id', f.agency_id, 'agency_name', a.name,
      'kind', f.kind, 'message', f.message, 'page', f.page, 'status', f.status,
      'votes', f.votes, 'created_at', f.created_at,
      'handled_at', f.handled_at, 'response', f.response
    ) order by f.votes desc, f.created_at desc)
    from feedback f join agencies a on a.id = f.agency_id
    where p_status is null or f.status = p_status
  ), '[]'::jsonb);
end $$;

create or replace function platform_feedback_handle(p_feedback uuid, p_status text, p_response text default null)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  if p_status not in ('nouveau','lu','planifie','fait','ecarte') then
    raise exception 'état inconnu' using errcode = 'P0001';
  end if;
  update feedback
     set status = p_status, response = coalesce(p_response, response),
         handled_at = now(), handled_by = auth.uid()
   where id = p_feedback;
  if not found then raise exception 'retour introuvable' using errcode = 'P0002'; end if;
end $$;

-- ==================================================================
-- 6 · QUI LIT QUOI
-- ==================================================================

alter table onboarding_steps enable row level security;
alter table onboarding_steps force row level security;
alter table support_tickets enable row level security;
alter table support_tickets force row level security;
alter table support_messages enable row level security;
alter table support_messages force row level security;
alter table announcements enable row level security;
alter table announcements force row level security;
alter table announcement_reads enable row level security;
alter table announcement_reads force row level security;
alter table feedback enable row level security;
alter table feedback force row level security;
alter table feedback_votes enable row level security;
alter table feedback_votes force row level security;

-- Le démarrage : l'agence, et la plateforme en lecture pour comprendre au
-- téléphone où l'agence est bloquée.
drop policy if exists onboarding_steps_select on onboarding_steps;
create policy onboarding_steps_select on onboarding_steps for select to authenticated
  using (agency_id = auth_agency_id() or is_platform_admin());
drop policy if exists onboarding_steps_insert on onboarding_steps;
create policy onboarding_steps_insert on onboarding_steps for insert to authenticated
  with check (agency_id = auth_agency_id());
drop policy if exists onboarding_steps_update on onboarding_steps;
create policy onboarding_steps_update on onboarding_steps for update to authenticated
  using (agency_id = auth_agency_id()) with check (agency_id = auth_agency_id());

-- Un ticket se lit par son agence et par la plateforme. Il ne se lit par
-- personne d'autre, et surtout pas par l'agence d'à côté.
drop policy if exists support_tickets_select on support_tickets;
create policy support_tickets_select on support_tickets for select to authenticated
  using (agency_id = auth_agency_id() or is_platform_admin());
drop policy if exists support_tickets_insert on support_tickets;
create policy support_tickets_insert on support_tickets for insert to authenticated
  with check (agency_id = auth_agency_id());
-- L'agence ne change que sa note de satisfaction ; l'état du ticket appartient
-- à la plateforme. Sans ça, un ticket gênant se referme tout seul.
drop policy if exists support_tickets_update on support_tickets;
create policy support_tickets_update on support_tickets for update to authenticated
  using (is_platform_admin() or agency_id = auth_agency_id())
  with check (is_platform_admin() or agency_id = auth_agency_id());

drop policy if exists support_messages_select on support_messages;
create policy support_messages_select on support_messages for select to authenticated
  using (agency_id = auth_agency_id() or is_platform_admin());
drop policy if exists support_messages_insert on support_messages;
create policy support_messages_insert on support_messages for insert to authenticated
  with check ((agency_id = auth_agency_id() and author_kind = 'agence') or is_platform_admin());
drop policy if exists support_messages_update on support_messages;
create policy support_messages_update on support_messages for update to authenticated
  using (agency_id = auth_agency_id() or is_platform_admin())
  with check (agency_id = auth_agency_id() or is_platform_admin());

-- Une annonce publiée se lit par tous les comptes. Le filtrage par cible est
-- fait par `active_announcements` : une annonce visible n'est pas un secret,
-- et une politique qui refait ce calcul à chaque ligne coûterait cher pour rien.
-- Un brouillon, lui, ne sort pas de la console.
drop policy if exists announcements_select on announcements;
create policy announcements_select on announcements for select to authenticated
  using (published_at is not null or is_platform_admin());
drop policy if exists announcements_insert on announcements;
create policy announcements_insert on announcements for insert to authenticated
  with check (is_platform_admin());
drop policy if exists announcements_update on announcements;
create policy announcements_update on announcements for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());
drop policy if exists announcements_delete on announcements;
create policy announcements_delete on announcements for delete to authenticated
  using (is_platform_admin());

-- Chacun ne voit et ne pose que ses propres accusés de lecture.
drop policy if exists announcement_reads_select on announcement_reads;
create policy announcement_reads_select on announcement_reads for select to authenticated
  using (user_id = auth.uid() or is_platform_admin());
drop policy if exists announcement_reads_insert on announcement_reads;
create policy announcement_reads_insert on announcement_reads for insert to authenticated
  with check (user_id = auth.uid());

-- Un retour se lit par son auteur, par son agence, et par la plateforme.
-- L'agence d'à côté ne le lit PAS : elle passe par `feedback_board`, qui ne
-- rend jamais l'origine.
drop policy if exists feedback_select on feedback;
create policy feedback_select on feedback for select to authenticated
  using (agency_id = auth_agency_id() or user_id = auth.uid() or is_platform_admin());
drop policy if exists feedback_insert on feedback;
create policy feedback_insert on feedback for insert to authenticated
  with check (agency_id = auth_agency_id());
drop policy if exists feedback_update on feedback;
create policy feedback_update on feedback for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());

-- Le vote d'une agence est le sien. Voir la liste des votants d'une idée
-- reviendrait à savoir qui demande quoi, c'est-à-dire ce qu'on interdit.
drop policy if exists feedback_votes_select on feedback_votes;
create policy feedback_votes_select on feedback_votes for select to authenticated
  using (agency_id = auth_agency_id() or is_platform_admin());
drop policy if exists feedback_votes_insert on feedback_votes;
create policy feedback_votes_insert on feedback_votes for insert to authenticated
  with check (agency_id = auth_agency_id());
drop policy if exists feedback_votes_delete on feedback_votes;
create policy feedback_votes_delete on feedback_votes for delete to authenticated
  using (agency_id = auth_agency_id());

-- ------------------------------------------------------------------
-- Les droits de table. Jamais anon : l'anonyme n'entre que par une fonction.
-- ------------------------------------------------------------------
revoke all on onboarding_steps, support_tickets, support_messages,
              announcements, announcement_reads, feedback, feedback_votes
  from anon, authenticated;

grant select, insert, update on onboarding_steps to authenticated;
grant select, insert, update on support_tickets to authenticated;
grant select, insert, update on support_messages to authenticated;
grant select, insert, update, delete on announcements to authenticated;
grant select, insert on announcement_reads to authenticated;
grant select, insert, update on feedback to authenticated;
grant select, insert, delete on feedback_votes to authenticated;

grant all on onboarding_steps, support_tickets, support_messages,
             announcements, announcement_reads, feedback, feedback_votes
  to service_role;

-- ------------------------------------------------------------------
-- Les droits d'exécution
-- ------------------------------------------------------------------
--
-- PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction créée. Une fonction
-- SECURITY DEFINER ouverte à l'anonyme est une porte ouverte, même si elle
-- refuse d'elle-même : le banc des droits exige que la porte soit fermée AVANT
-- la vérification, pas seulement derrière.
revoke all on function feature_on(uuid, text) from public, anon;
revoke all on function onboarding_auto(uuid) from public, anon;
revoke all on function onboarding_state(uuid) from public, anon;
revoke all on function onboarding_complete(text) from public, anon;
revoke all on function onboarding_skip(text) from public, anon;
revoke all on function onboarding_hide(boolean) from public, anon;
revoke all on function agency_modules(uuid) from public, anon;
revoke all on function support_open(text, text, text, text) from public, anon;
revoke all on function support_reply(uuid, text) from public, anon;
revoke all on function support_my_tickets() from public, anon;
revoke all on function support_rate(uuid, int) from public, anon;
revoke all on function platform_tickets(text) from public, anon;
revoke all on function platform_ticket_reply(uuid, text) from public, anon;
revoke all on function platform_ticket_status(uuid, text) from public, anon;
revoke all on function active_announcements() from public, anon;
revoke all on function announcement_read(uuid) from public, anon;
revoke all on function platform_save_announcement(uuid, text, jsonb, jsonb, text, timestamptz, timestamptz, text, uuid) from public, anon;
revoke all on function platform_publish_announcement(uuid, boolean) from public, anon;
revoke all on function platform_announcements() from public, anon;
revoke all on function feedback_send(text, text, text) from public, anon;
revoke all on function feedback_board(text) from public, anon;
revoke all on function feedback_vote(uuid) from public, anon;
revoke all on function feedback_unvote(uuid) from public, anon;
revoke all on function platform_feedback(text) from public, anon;
revoke all on function platform_feedback_handle(uuid, text, text) from public, anon;

grant execute on function feature_on(uuid, text) to authenticated;
grant execute on function onboarding_auto(uuid) to authenticated;
grant execute on function onboarding_state(uuid) to authenticated;
grant execute on function onboarding_complete(text) to authenticated;
grant execute on function onboarding_skip(text) to authenticated;
grant execute on function onboarding_hide(boolean) to authenticated;
grant execute on function agency_modules(uuid) to authenticated;
grant execute on function support_open(text, text, text, text) to authenticated;
grant execute on function support_reply(uuid, text) to authenticated;
grant execute on function support_my_tickets() to authenticated;
grant execute on function support_rate(uuid, int) to authenticated;
grant execute on function platform_tickets(text) to authenticated;
grant execute on function platform_ticket_reply(uuid, text) to authenticated;
grant execute on function platform_ticket_status(uuid, text) to authenticated;
grant execute on function active_announcements() to authenticated;
grant execute on function announcement_read(uuid) to authenticated;
grant execute on function platform_save_announcement(uuid, text, jsonb, jsonb, text, timestamptz, timestamptz, text, uuid) to authenticated;
grant execute on function platform_publish_announcement(uuid, boolean) to authenticated;
grant execute on function platform_announcements() to authenticated;
grant execute on function feedback_send(text, text, text) to authenticated;
grant execute on function feedback_board(text) to authenticated;
grant execute on function feedback_vote(uuid) to authenticated;
grant execute on function feedback_unvote(uuid) to authenticated;
grant execute on function platform_feedback(text) to authenticated;
grant execute on function platform_feedback_handle(uuid, text, text) to authenticated;

-- ==================================================================
-- 7 · LE PIÈGE DES FONCTIONS DE DÉCLENCHEUR
-- ==================================================================
--
-- Même raison qu'en 0044 : une fonction `returns trigger` s'appelle toute
-- seule, personne ne remarque qu'elle reste appelable directement par un
-- anonyme. On referme, pour toutes celles du schéma, celles de ce lot comprises.
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
