-- 0015 · Les droits. La couche que le banc local masquait.
--
-- Découvert en poussant sur la vraie base : `authenticated` n'avait AUCUN
-- droit sur les 45 tables. Les 148 politiques n'étaient jamais atteintes,
-- PostgreSQL refusait avant. L'espace agence n'aurait rien affiché du tout.
--
-- La cause est dans le banc d'essai : il posait un `alter default privileges
-- grant all`, que Supabase ne fait pas pour des tables créées par l'API de
-- gestion. Un banc plus permissif que la production ne prouve rien. Le
-- harness a été corrigé en même temps que cette migration.
--
-- Deuxième trouvaille : PostgreSQL accorde EXECUTE à PUBLIC sur toute
-- fonction, par défaut. Résultat, `purge_expired` et `run_automations`,
-- toutes deux SECURITY DEFINER et sans garde interne, étaient appelables par
-- un anonyme avec l'identifiant d'agence de son choix.

-- ------------------------------------------------------------------
-- 1. Les tables : RLS décide, encore faut-il pouvoir la consulter
-- ------------------------------------------------------------------

-- Ces trois-là gardent zéro droit et zéro politique. Seules les fonctions
-- SECURITY DEFINER y touchent : un code à usage unique, un appareil reconnu
-- et un compteur d'appels n'ont aucune raison d'être lisibles par un client.
create or replace function private_tables() returns text[]
language sql immutable as $$ select array['otp_codes','client_devices','rate_limits'] $$;

do $$
declare r record;
begin
  for r in
    select tablename as name from pg_tables where schemaname = 'public'
    union all
    select viewname as name from pg_views where schemaname = 'public'
  loop
    if r.name = any (private_tables()) then continue; end if;

    if exists (select 1 from pg_views where schemaname = 'public' and viewname = r.name) then
      -- Une vue ne s'écrit pas. `revenue_lines` reste protégée par la
      -- politique de ses tables sources et par la capacité finance:global.
      execute format('grant select on public.%I to authenticated', r.name);
    else
      execute format('grant select, insert, update, delete on public.%I to authenticated', r.name);
    end if;
  end loop;
end $$;

grant usage on all sequences in schema public to authenticated;

-- Pour tout ce qui sera créé ensuite : ne jamais refaire l'oubli.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- `anon` ne reçoit rien sur les tables. Il n'entre que par des fonctions qui
-- décident elles-mêmes de ce qu'elles rendent, et le portail client n'a pas
-- besoin d'autre chose.

-- ------------------------------------------------------------------
-- 2. Deux fonctions destructrices, sans garde, ouvertes à tous
-- ------------------------------------------------------------------

-- On ne recopie pas les corps : on les renomme et on pose un garde devant.
-- Recopier un corps, c'est le laisser diverger au premier correctif.

alter function run_automations(uuid, boolean) rename to run_automations_unchecked;
revoke all on function run_automations_unchecked(uuid, boolean) from public;

create or replace function run_automations(p_agency uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sans ce test, un compte de l'agence A déclenchait les automatisations de
  -- l'agence B en passant son identifiant. Et un anonyme, celles de n'importe qui.
  if p_agency is distinct from auth_agency_id() or not auth_can('automation:manage') then
    raise exception 'interdit';
  end if;
  return run_automations_unchecked(p_agency, p_dry_run);
end;
$$;

-- La purge efface des pièces. Elle reste au service, appelée par une tâche
-- planifiée, jamais par un client. Un bouton « purger » se rajoutera le jour
-- où quelqu'un le demandera, avec son propre garde.
revoke all on function purge_expired(uuid) from public;

-- ------------------------------------------------------------------
-- 3. Reprendre EXECUTE à PUBLIC, puis rendre ce qui est nécessaire
-- ------------------------------------------------------------------

-- Uniquement nos fonctions : celles des extensions (citext et ses opérateurs)
-- doivent rester exécutables, sinon la moindre requête sur un e-mail casse.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- Le portail client, sans compte. C'est tout ce qu'un anonyme peut appeler.
do $$
declare f text;
begin
  foreach f in array array[
    'slug_available(text)',
    'provision_agency(text,text,text,text,text,text,text[])',
    'issue_otp(text,text,text)',
    'verify_otp(text,text,text)',
    'portal_case(text)',
    'portal_shipment(text)',
    'portal_mine(text,text)',
    'portal_queue(text)',
    'portal_submit_request(text,jsonb)'
  ] loop
    -- Une signature qui a bougé ne doit pas faire échouer toute la migration :
    -- on note et on continue, plutôt que de tout laisser à moitié appliqué.
    begin
      execute format('grant execute on function public.%s to anon, authenticated', f);
    exception when undefined_function then
      raise notice 'signature absente, ignorée : %', f;
    end;
  end loop;
end $$;

-- L'espace agence. Les fonctions d'aide des politiques en font partie : une
-- politique s'évalue avec les droits de celui qui interroge.
do $$
declare f text;
begin
  foreach f in array array[
    'auth_agency_id()',
    'auth_role()',
    'auth_office_id()',
    'auth_can(text)',
    'auth_sees_office(uuid)',
    'current_checklist_version(uuid)',
    'demurrage_days(uuid)',
    'open_case(uuid,uuid,uuid,date,text,uuid)',
    'convert_request(uuid,uuid)',
    'collect_payment(uuid,text,uuid)',
    'release_passport(uuid,text)',
    'run_automations(uuid,boolean)',
    'serve_queue(uuid,timestamptz,text)',
    'record_decision(uuid,text,text,text)',
    'queue_rank(uuid)',
    'real_wait_days(uuid)',
    'wa_window_open(uuid)',
    'wa_outbox(uuid,integer)',
    'wa_match_client(uuid,text)',
    'wa_latest_case(uuid)',
    'whatsapp_window_open(uuid)',
    'next_reference(uuid,text)'
  ] loop
    begin
      execute format('grant execute on function public.%s to authenticated', f);
    exception when undefined_function then
      raise notice 'signature absente, ignorée : %', f;
    end;
  end loop;
end $$;

-- Le hook de jeton n'appartient qu'au service d'authentification.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on table public.profiles to supabase_auth_admin;

-- Reste sans aucun droit, donc réservé à la clé de service et aux
-- déclencheurs : seed_catalogue, purge_expired, apply_automation,
-- automation_matches, wa_receive, wa_status, vault_read, rls_auto_enable,
-- guard_profile_change, close_case_token, run_automations_unchecked.
-- Un déclencheur n'exige pas EXECUTE de celui qui provoque l'écriture.
