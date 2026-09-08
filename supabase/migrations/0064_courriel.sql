-- 0064 · Le courriel, et la répartition des webhooks.
--
-- CE QUI MANQUAIT.
--
-- Le projet n'envoyait aucun courriel. Pas de mot de passe oublié, pas de
-- facture par courriel, pas d'invitation par lien, pas de vérification
-- d'adresse. C'était le dernier vrai bloquant du produit : `invite-user` rend
-- un mot de passe provisoire à recopier au téléphone, faute de mieux.
--
-- Et la table `webhook_deliveries` se remplissait depuis la migration 0051
-- sans que personne n'appelle jamais rien : `webhook_pending` et
-- `webhook_mark` attendaient une fonction de bord qui n'existait pas.
--
-- LA RÈGLE QUI GOUVERNE TOUT CE FICHIER.
--
-- On ne prétend jamais qu'un message est parti s'il n'est pas parti. C'est la
-- faute qui a déjà mordu ce projet une fois. Conséquences concrètes ici :
--
--   · `email_log.sent_at` n'est PAS un paramètre. La fonction le pose
--     elle-même, et seulement quand le statut vaut « envoye ». Un appelant
--     ne peut donc pas dater un envoi qui n'a pas eu lieu.
--   · le statut « non_configure » existe justement pour dire « rien n'est
--     parti, et voici ce qui serait parti ». Le produit continue de marcher
--     sans courriel, comme aujourd'hui, mais il le dit.
--   · `email_ready()` rend FAUX tant que rien n'a prouvé le contraire. Un
--     bouton grisé vaut mieux qu'une action qui échoue.
--
-- ET LA RÈGLE DU COFFRE. Jamais la valeur d'un secret en base, seulement son
-- nom. La clé du fournisseur de courriel vit dans les variables de la fonction
-- de bord. Le secret qui signe l'appel de la tâche planifiée vers la fonction
-- de bord vit dans le coffre : `edge_settings` n'en garde que le NOM.

-- ------------------------------------------------------------------
-- 1 · email_log · la trace, en ajout seul
-- ------------------------------------------------------------------
--
-- Une trace par tentative. Pas de mise à jour : une ligne qui se corrige est
-- une ligne dont on ne peut plus rien conclure. Si la deuxième tentative part,
-- elle écrit sa propre ligne, et les deux racontent l'histoire complète.
--
-- Le corps du message n'est PAS conservé. Une facture, un mot de passe
-- provisoire ou un lien d'invitation dans un journal, c'est une deuxième base
-- de données aussi sensible que l'originale, et jamais purgée. On garde qui,
-- quoi, quand, et le résultat.

create table if not exists email_log (
  id           uuid primary key default gen_random_uuid(),
  -- Nul pour les envois de la plateforme : un mot de passe oublié part avant
  -- qu'on sache à quelle agence appartient l'adresse.
  agency_id    uuid references agencies on delete cascade,
  kind         text not null check (kind in (
                 'invitation','mot_de_passe','facture','devis','rappel',
                 'decision','document_demande','systeme')),
  to_address   text not null,
  subject      text not null,
  provider     text,
  provider_id  text,
  status       text not null check (status in (
                 'prepare','envoye','echoue','non_configure')),
  error        text,
  -- Pas de clé étrangère sur l'auteur, comme pour audit_logs : une trace doit
  -- survivre à la suppression du compte qui l'a déclenchée.
  sent_by      uuid,
  created_at   timestamptz not null default now(),
  -- Posé par email_record, et par elle seule, quand le statut vaut « envoye ».
  sent_at      timestamptz,
  -- Le garde de la règle, écrit dans le schéma plutôt que dans un commentaire :
  -- une ligne datée d'un envoi sans statut d'envoi ne peut pas exister.
  constraint email_log_envoi_date check (
    (status = 'envoye' and sent_at is not null)
    or (status <> 'envoye' and sent_at is null))
);

create index if not exists email_log_agency on email_log (agency_id, created_at desc);
create index if not exists email_log_kind   on email_log (kind, created_at desc);
create index if not exists email_log_status on email_log (status, created_at desc)
  where status <> 'envoye';

comment on table email_log is
  'Le journal des courriels, en ajout seul. Une ligne par tentative, jamais corrigée. Le corps du message n''y entre pas : un mot de passe provisoire ou une facture dans un journal, c''est une deuxième base aussi sensible que l''originale.';
comment on column email_log.status is
  'prepare : construit, envoi non tenté. envoye : le fournisseur a accusé réception. echoue : le fournisseur a refusé. non_configure : aucune clé de fournisseur, rien n''est parti.';

-- ------------------------------------------------------------------
-- 2 · email_config · ce que le transport sait de lui-même
-- ------------------------------------------------------------------
--
-- La base ne peut pas savoir si la variable RESEND_API_KEY est posée : cette
-- variable vit dans la fonction de bord, pas ici. Deviner mènerait à un
-- bouton actif qui échoue, exactement ce qu'on veut éviter.
--
-- Alors on ne devine pas : la fonction de bord, qui est la seule à savoir,
-- écrit ce qu'elle a constaté à chaque appel. `email_ready()` rend faux tant
-- qu'elle n'a rien écrit. L'application peut forcer la constatation sans
-- envoyer un courriel : `send-email` accepte `{ "probe": true }`, qui met
-- cette ligne à jour et ne poste rien.

create table if not exists email_config (
  -- Une seule ligne, pour toute la plateforme. La contrainte le garantit.
  id           boolean primary key default true check (id),
  provider     text,
  from_address text,
  ready        boolean not null default false,
  note         text,
  checked_at   timestamptz
);
insert into email_config (id) values (true) on conflict (id) do nothing;

comment on table email_config is
  'L''état du transport de courriel, constaté par la fonction de bord et par elle seule. La base ne devine jamais : sans constatation, ready vaut faux.';

-- ------------------------------------------------------------------
-- 3 · edge_settings · comment la base appelle une fonction de bord
-- ------------------------------------------------------------------
--
-- Une tâche planifiée qui doit sortir par le réseau a besoin de deux choses :
-- l'adresse des fonctions, et de quoi prouver que l'appel vient bien de nous.
-- L'adresse n'est pas un secret, elle vit ici. Le secret de signature en est
-- un : cette table n'en garde que le NOM dans le coffre, comme
-- `webhooks.secret_name` et `whatsapp_accounts.token_secret` avant elle.
--
-- POURQUOI UN SECRET DE SIGNATURE ET PAS LA CLÉ DE SERVICE. Voir la section 9 :
-- pg_net range chaque appel en attente, en-têtes compris, dans une table que
-- tout compte connecté peut lire. Une signature qui vaut une minute pour un
-- seul appel n'y sert à rien à celui qui la vole. Une clé de service, si.

create table if not exists edge_settings (
  id            boolean primary key default true check (id),
  -- Par exemple https://xxxxxxxx.supabase.co/functions/v1
  functions_url text,
  -- Le NOM du secret dans le coffre. Jamais sa valeur.
  key_secret    text not null default 'webhook_dispatch_secret',
  updated_at    timestamptz not null default now()
);
insert into edge_settings (id) values (true) on conflict (id) do nothing;
-- Rejouable : `create table if not exists` ne corrige pas un défaut déjà posé.
alter table edge_settings alter column key_secret set default 'webhook_dispatch_secret';

comment on column edge_settings.key_secret is
  'Nom du secret dans le coffre Supabase qui sert à signer l''appel de la tâche planifiée vers la fonction de bord. La valeur n''entre jamais en base : dispatch_webhooks la lit par vault_read au moment de s''en servir.';

-- ------------------------------------------------------------------
-- 4 · Écrire une trace, depuis la fonction de bord
-- ------------------------------------------------------------------
--
-- La date d'envoi n'est pas un paramètre. C'est tout l'intérêt de passer par
-- une fonction plutôt que par une insertion directe.

create or replace function email_record(
  p_agency      uuid,
  p_kind        text,
  p_to          text,
  p_subject     text,
  p_status      text,
  p_provider    text default null,
  p_provider_id text default null,
  p_error       text default null,
  p_sent_by     uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_to is null or btrim(p_to) = '' then
    raise exception 'destinataire absent' using errcode = 'P0001';
  end if;
  -- Les deux contraintes de la table diraient la même chose, mais avec un
  -- message que personne ne comprend dans le journal d'une fonction de bord.
  if p_kind not in ('invitation','mot_de_passe','facture','devis','rappel',
                    'decision','document_demande','systeme') then
    raise exception 'genre de courriel inconnu : %', p_kind using errcode = 'P0001';
  end if;
  if p_status not in ('prepare','envoye','echoue','non_configure') then
    raise exception 'statut de courriel inconnu : %', p_status using errcode = 'P0001';
  end if;

  insert into email_log (
    agency_id, kind, to_address, subject, provider, provider_id,
    status, error, sent_by, sent_at)
  values (
    p_agency, p_kind, left(btrim(p_to), 320), left(coalesce(p_subject, ''), 300),
    p_provider, p_provider_id, p_status, left(p_error, 500), p_sent_by,
    -- Là, et nulle part ailleurs.
    case when p_status = 'envoye' then now() end)
  returning id into v_id;

  return v_id;
end $$;

comment on function email_record(uuid, text, text, text, text, text, text, text, uuid) is
  'La seule porte d''écriture du journal des courriels. La date d''envoi n''est pas un paramètre : elle se pose quand le statut vaut « envoye », et jamais autrement.';

-- ------------------------------------------------------------------
-- 5 · L'état du transport, constaté puis lu
-- ------------------------------------------------------------------

create or replace function email_state_set(
  p_provider text,
  p_from     text,
  p_ready    boolean,
  p_note     text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into email_config (id, provider, from_address, ready, note, checked_at)
  values (true, p_provider, p_from, coalesce(p_ready, false), left(p_note, 300), now())
  on conflict (id) do update set
    provider = excluded.provider,
    from_address = excluded.from_address,
    ready = excluded.ready,
    note = excluded.note,
    checked_at = excluded.checked_at;
end $$;

-- Ce que l'application interroge pour griser ses boutons. Faux par défaut :
-- proposer une action qui échouera est pire que de la montrer indisponible.
create or replace function email_ready()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select ready from email_config where id), false)
$$;

comment on function email_ready() is
  'Vrai seulement si la fonction de bord a constaté une clé de fournisseur. Sans constatation, faux : l''application grise ses boutons au lieu de proposer un envoi qui échouera.';

-- ------------------------------------------------------------------
-- 6 · La limite de débit
-- ------------------------------------------------------------------
--
-- Une boucle mal écrite côté application, ou un import qui relance mille
-- factures, et c'est le domaine d'envoi qui se retrouve sur une liste noire.
-- Le compteur existe déjà en base (rate_allow) : on l'habille avec les
-- valeurs du produit, pour que la fonction de bord n'ait pas à les connaître.
--
-- Deux cents par heure et par agence : très au-dessus d'un usage normal
-- (une agence envoie quelques dizaines de courriels par jour), très en
-- dessous de ce qui grille une réputation d'expéditeur.

create or replace function email_rate_ok(p_agency uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select rate_allow('email', coalesce(p_agency::text, 'plateforme'), 200, interval '1 hour')
$$;

comment on function email_rate_ok(uuid) is
  'Deux cents courriels par heure et par agence. Au-delà, on refuse : un domaine d''envoi grillé se répare en semaines.';

-- ------------------------------------------------------------------
-- 6 bis · Reconnaître une clé de service, sans comparer des octets
-- ------------------------------------------------------------------
--
-- Une fonction de bord doit savoir si celui qui l'appelle est le serveur ou un
-- compte connecté. La façon évidente, comparer le porteur à la variable
-- SUPABASE_SERVICE_ROLE_KEY, marche tant que le projet n'a qu'une seule clé de
-- service. Supabase en propose désormais deux formes en parallèle, l'ancienne
-- en JWT et la nouvelle en `sb_secret_…` : la comparaison refuse alors une clé
-- pourtant valable, et c'est une panne difficile à comprendre.
--
-- Cette fonction ne fait rien, et c'est son intérêt : c'est le DROIT
-- D'EXÉCUTION qui répond. Elle n'est accordée qu'à `service_role`. Si l'appel
-- passe, le porteur est une clé de service, quelle que soit sa forme, et c'est
-- PostgREST qui a validé le jeton, pas nous.

create or replace function is_service_key()
returns boolean
language sql
immutable
as $$ select true $$;

comment on function is_service_key() is
  'Rend toujours vrai. C''est le droit d''exécution, réservé à service_role, qui porte la réponse : une fonction de bord appelle celle ci avec le porteur qu''on lui présente, et un refus vaut « ce n''est pas une clé de service ».';

revoke all on function is_service_key() from public, anon, authenticated;
grant execute on function is_service_key() to service_role;

-- ------------------------------------------------------------------
-- 7 · Cloisonnement
-- ------------------------------------------------------------------

alter table email_log    enable row level security;
alter table email_log    force  row level security;
alter table email_config enable row level security;
alter table email_config force  row level security;
alter table edge_settings enable row level security;
alter table edge_settings force  row level security;

drop policy if exists email_log_select on email_log;
drop policy if exists email_log_platform_read on email_log;

-- L'agence voit ses propres traces. Le réglage est un réglage : la même
-- capacité que le reste de la configuration, donc un lecteur ne voit rien.
create policy email_log_select on email_log for select to authenticated
  using (agency_id is not null
         and agency_id = auth_agency_id()
         and auth_can('settings:view'));
-- Les envois de la plateforme (agency_id nul) ne regardent que la plateforme :
-- un mot de passe oublié part avant qu'on sache de quelle agence il s'agit.
create policy email_log_platform_read on email_log for select to authenticated
  using (is_platform_admin());

-- AUCUNE politique d'insertion, de mise à jour ni de suppression. `email_record`
-- est le seul chemin. Une insertion depuis l'application permettrait d'écrire
-- « envoye » sans que rien ne soit parti, ce qui est précisément la faute que
-- ce module existe pour ne plus commettre.

drop policy if exists email_config_select on email_config;
-- Personne n'y trouve de secret : le nom du fournisseur, l'adresse d'envoi, et
-- un booléen. Chacun le lit, personne ne l'écrit.
create policy email_config_select on email_config for select to authenticated
  using (true);

drop policy if exists edge_settings_select on edge_settings;
-- L'adresse des fonctions et le nom du secret : réservés à la plateforme.
create policy edge_settings_select on edge_settings for select to authenticated
  using (is_platform_admin());

-- ------------------------------------------------------------------
-- 8 · Les droits
-- ------------------------------------------------------------------
--
-- LE PIÈGE DE LA MIGRATION 0015. Elle pose
-- `alter default privileges in schema public grant select, insert, update,
-- delete on tables to authenticated`. Toute table nouvelle reçoit donc
-- INSERT, UPDATE et DELETE sans que personne ne les écrive : un journal en
-- ajout seul deviendrait un journal effaçable, en silence. On reprend tout.

revoke all on email_log, email_config, edge_settings from anon, authenticated;
grant select on email_log, email_config, edge_settings to authenticated;
grant all on email_log, email_config, edge_settings to service_role;

-- Les quatre fonctions n'ont aucun filtre d'agence : elles écrivent ce qu'on
-- leur donne. Elles ne vont donc qu'à la clé de service. Seule `email_ready`,
-- qui ne rend qu'un booléen de la plateforme, s'ouvre aux comptes connectés.
revoke all on function email_record(uuid, text, text, text, text, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function email_state_set(text, text, boolean, text) from public, anon, authenticated;
revoke all on function email_rate_ok(uuid) from public, anon, authenticated;
grant execute on function email_record(uuid, text, text, text, text, text, text, text, uuid) to service_role;
grant execute on function email_state_set(text, text, boolean, text) to service_role;
grant execute on function email_rate_ok(uuid) to service_role;

revoke all on function email_ready() from public, anon;
grant execute on function email_ready() to authenticated, service_role;

-- ------------------------------------------------------------------
-- 9 · La tâche planifiée qui répartit les webhooks
-- ------------------------------------------------------------------
--
-- POURQUOI UNE FONCTION DE BORD, ALORS QUE 0058 GARDE TOUT EN BASE.
--
-- 0058 le dit lui-même : ce qui doit SORTIR par le réseau reste en fonction de
-- bord. Une remise de webhook est un POST vers un serveur tiers, avec une
-- signature, un délai d'attente et un corps à relire. PostgreSQL n'a rien pour
-- ça, et n'a pas à l'avoir.
--
-- pg_net est donc nécessaire, et lui seul : c'est l'extension qui permet à la
-- base d'appeler une adresse HTTP sans bloquer. Elle est disponible sur le
-- projet (et absente d'un PostgreSQL nu, d'où les gardes de ce bloc, comme
-- pour pg_cron en 0058).
--
-- LE TROU DE pg_net, ET CE QU'ON EN FAIT.
--
-- pg_net range chaque appel en attente dans `net.http_request_queue`, EN-TÊTES
-- COMPRIS, et Supabase accorde d'office l'usage du schéma `net` à `anon` et à
-- `authenticated`. Une clé de service posée dans un en-tête d'autorisation y
-- serait donc lisible, quelques secondes, par n'importe quel compte connecté
-- d'une agence quelconque. C'est pourtant le chemin que montrent la plupart
-- des exemples. On ne le prend pas.
--
-- On tente bien de refermer ces droits, mais SANS COMPTER DESSUS : ils ont été
-- accordés par `supabase_admin`, et `postgres` ne peut pas les révoquer. Le
-- bloc ci dessous le dit, au lieu de faire semblant d'avoir réussi.
--
-- LA VRAIE PARADE : on ne met jamais de clé dans cet en-tête. La tâche SIGNE
-- son appel avec un secret partagé, à la manière de `whatsapp-webhook`. Ce qui
-- transite est une empreinte, valable cinq minutes, pour cet appel là. Volée,
-- elle ne sert à rien.

do $$
begin
  if to_regnamespace('net') is null then return; end if;
  execute 'revoke all on schema net from anon, authenticated';
  execute 'revoke all on all tables in schema net from public, anon, authenticated';
  execute 'revoke all on all sequences in schema net from public, anon, authenticated';
  if has_schema_privilege('authenticated', 'net', 'usage') then
    -- Une révocation qui ne révoque rien ne doit pas passer pour une réussite.
    raise notice 'le schéma net reste ouvert à authenticated : droits posés par supabase_admin, non révocables ici. Aucun secret ne doit transiter par un en-tête pg_net, et c''est pourquoi la tâche signe au lieu de porter une clé.';
  end if;
exception when insufficient_privilege then
  raise notice 'droits du schéma net non modifiables ici : la tâche signe son appel, elle ne porte aucune clé';
end $$;

-- L'appel lui-même. Il échoue BRUYAMMENT si quelque chose manque : appelé par
-- `run_job`, chaque exception atterrit dans `job_runs` avec sa raison. Une
-- tâche qui ne fait rien en silence toutes les cinq minutes est pire que pas
-- de tâche du tout.
create or replace function dispatch_webhooks()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_name   text;
  v_secret text;
  v_ts     text;
  v_sig    text;
  v_req    bigint;
begin
  select functions_url, key_secret into v_url, v_name from edge_settings where id;

  if v_url is null or btrim(v_url) = '' then
    raise exception 'edge_settings.functions_url n''est pas réglé : la base ne sait pas où appeler la fonction de bord'
      using errcode = 'P0001';
  end if;
  if to_regnamespace('net') is null then
    raise exception 'pg_net absent : la base ne peut pas appeler une adresse HTTP'
      using errcode = 'P0001';
  end if;
  if to_regprocedure('public.vault_read(text)') is null then
    raise exception 'le coffre n''est pas disponible : impossible de lire le secret de signature'
      using errcode = 'P0001';
  end if;

  -- Le nom est en base, la valeur est dans le coffre, et elle n'en sort que le
  -- temps de calculer une empreinte. Elle ne part jamais sur le réseau.
  execute 'select vault_read($1)' into v_secret using v_name;
  if v_secret is null or btrim(v_secret) = '' then
    raise exception 'le coffre ne contient pas le secret « % »', v_name using errcode = 'P0001';
  end if;

  -- L'horodatage entre dans la signature : sans lui, une empreinte volée se
  -- rejouerait indéfiniment. La fonction de bord refuse au delà de cinq minutes.
  v_ts := extract(epoch from now())::bigint::text;
  v_sig := encode(extensions.hmac(v_ts, v_secret, 'sha256'), 'hex');

  -- `execute` plutôt qu'un appel direct : la fonction doit se créer même sur
  -- une base sans pg_net, sinon le banc d'essai local ne passe plus.
  execute
    'select net.http_post(url => $1, body => $2::jsonb, headers => $3::jsonb, timeout_milliseconds => $4)'
    into v_req
    using
      rtrim(v_url, '/') || '/webhook-dispatch',
      '{}',
      jsonb_build_object(
        'content-type', 'application/json',
        'x-visaflow-timestamp', v_ts,
        'x-visaflow-auth', 'sha256=' || v_sig)::text,
      20000;

  return v_req;
end $$;

revoke all on function dispatch_webhooks() from public, anon, authenticated;
grant execute on function dispatch_webhooks() to service_role;

comment on function dispatch_webhooks() is
  'Réveille la fonction de bord qui vide webhook_deliveries. Elle ne poste rien elle-même : elle appelle en signant son appel, et la fonction de bord signe à son tour chaque remise.';

-- Toutes les cinq minutes. Le recul croissant de `webhook_backoff` compte en
-- minutes : passer moins souvent rendrait ce recul inopérant, passer plus
-- souvent réveillerait une fonction de bord pour rien la plupart du temps.
do $$
begin
  if to_regclass('public.job_runs') is null then
    raise notice 'job_runs absent (migration 0058 non appliquée) : tâche des webhooks non planifiée';
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent : tâche des webhooks non planifiée';
    return;
  end if;
  if to_regnamespace('net') is null then
    raise notice 'pg_net absent : tâche des webhooks non planifiée';
    return;
  end if;

  perform cron.unschedule('visaflow_webhooks') where exists (
    select 1 from cron.job where jobname = 'visaflow_webhooks');
  perform cron.schedule('visaflow_webhooks', '*/5 * * * *',
    $sql$select run_job('webhooks', 'select dispatch_webhooks()')$sql$);
end $$;

-- ------------------------------------------------------------------
-- 10 · Le piège des fonctions de déclencheur
-- ------------------------------------------------------------------
--
-- PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction nouvellement créée.
-- Pour une fonction de déclencheur, personne ne le remarque : elle s'appelle
-- toute seule. Mais elle reste appelable directement par un anonyme, et une
-- fonction SECURITY DEFINER appelable par un anonyme est une porte ouverte.
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
