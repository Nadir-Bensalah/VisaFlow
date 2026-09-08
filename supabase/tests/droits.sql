-- Banc d'essai des droits.
--
-- Il existe parce que le banc de cloisonnement ne suffisait pas : il posait
-- `grant all` à tout le monde, donc il testait des politiques que la
-- production n'atteignait jamais. Deux couches à vérifier, pas une :
-- d'abord le droit de toucher la table, ensuite la politique qui filtre.

\set ON_ERROR_STOP on
set search_path = public;

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then
    raise notice 'OK    %', label;
  else
    raise exception 'ÉCHEC %', label;
  end if;
end $$;

do $$
declare n int; total int;
begin
  -- ---------------------------------------------------------------
  -- La couche que tout le monde oublie : le GRANT
  -- ---------------------------------------------------------------
  select count(*) into total from pg_tables where schemaname = 'public';

  select count(distinct table_name) into n
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'SELECT';
  perform assert(n >= total - 3, 'authenticated peut lire les tables (' || n || ' sur ' || total || ')');

  -- ---------------------------------------------------------------
  -- Ce que RLS ne protège pas
  -- ---------------------------------------------------------------
  -- TRUNCATE échappe à la sécurité au niveau des lignes. Une politique qui
  -- filtre ligne par ligne ne sert à rien face à un ordre qui vide la table.
  select count(*) into n
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
    and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');
  perform assert(n = 0, 'ni anon ni authenticated ne peuvent vider une table');

  -- ---------------------------------------------------------------
  -- L'anonyme n'entre que par des fonctions
  -- ---------------------------------------------------------------
  select count(*) into n
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon';
  perform assert(n = 0, 'anon n''a aucun droit direct sur les tables');

  -- Les trois tables verrouillées : pas de droit, pas de politique.
  select count(*) into n
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'authenticated'
    and table_name in ('otp_codes', 'client_devices', 'rate_limits');
  perform assert(n = 0, 'les codes, appareils et compteurs restent hors de portée');

  -- ---------------------------------------------------------------
  -- Les fonctions ouvertes à l'anonyme, nommément
  -- ---------------------------------------------------------------
  -- PostgreSQL accorde EXECUTE à PUBLIC par défaut. Sans reprise explicite,
  -- une fonction SECURITY DEFINER écrite un mardi est publique le mercredi.
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'execute')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and p.proname not in (
      'slug_available', 'provision_agency', 'issue_otp', 'verify_otp',
      'portal_case', 'portal_shipment', 'portal_mine', 'portal_queue',
      'portal_submit_request', 'portal_send',
      -- L'outil du banc lui-même, absent de la production.
      'assert'
    );
  perform assert(n = 0, 'aucune fonction hors portail n''est ouverte à l''anonyme (' || n || ' de trop)');

  -- Les destructrices, nommément citées : c'est la faute qui a été trouvée
  -- en production, elle ne doit pas revenir en silence.
  perform assert(
    not has_function_privilege('anon', 'purge_expired(uuid)', 'execute'),
    'purge_expired est fermée à l''anonyme'
  );
  perform assert(
    not has_function_privilege('anon', 'run_automations(uuid,boolean)', 'execute'),
    'run_automations est fermée à l''anonyme'
  );

  -- ---------------------------------------------------------------
  -- Et le garde qui remplace l'absence de droit
  -- ---------------------------------------------------------------
  -- run_automations reste appelable par un compte d'agence. Encore faut-il
  -- qu'il ne puisse pas passer l'identifiant d'une autre agence.
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'run_automations'
    and pg_get_functiondef(p.oid) like '%auth_agency_id()%';
  perform assert(n = 1, 'run_automations vérifie l''agence de l''appelant');

  -- ---------------------------------------------------------------
  -- Le search_path figé sur tout ce qui est SECURITY DEFINER
  -- ---------------------------------------------------------------
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  perform assert(n = 0, 'aucune fonction SECURITY DEFINER sans search_path figé');

  -- ---------------------------------------------------------------
  -- La clé de service, qui doit tout pouvoir
  -- ---------------------------------------------------------------
  -- Elle contourne la sécurité au niveau des lignes, c'est sa raison d'être.
  -- Sans droits, les fonctions de bord échouent en silence : elles écrivent
  -- par l'API REST, et une erreur 403 n'y ressemble pas à une panne.
  select count(distinct table_name) into n
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'service_role' and privilege_type = 'SELECT';
  perform assert(n >= total, 'la clé de service lit toutes les tables (' || n || ' sur ' || total || ')');

  select count(distinct table_name) into n
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'service_role'
    and privilege_type = 'INSERT'
    and table_name in ('otp_codes', 'client_devices', 'rate_limits');
  perform assert(n = 3, 'la clé de service atteint les trois tables verrouillées');

  raise notice '--- banc des droits : tout est vert ---';
end $$;
