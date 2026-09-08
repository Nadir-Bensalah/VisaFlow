-- Banc d'essai local : les morceaux de Supabase que le schéma suppose.
-- Il ne sert qu'aux tests, jamais en production.

-- Supabase installe pgcrypto dans le schéma `extensions`, pas `public`.
-- Le banc doit refléter ça, sinon `extensions.crypt` casse en local et
-- laisse repartir un trou déjà rencontré (migration 0021).
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to public;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- L'utilisateur courant du test, posé par set_config.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table if not exists storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid
);
alter table storage.objects enable row level security;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;

grant usage on schema public, auth, storage to authenticated, anon, service_role;

-- Ce banc accordait autrefois `grant all` par défaut à tout le monde. Il était
-- donc plus permissif que la production, et il a masqué pendant des semaines
-- le fait que `authenticated` n'avait AUCUN droit sur les 45 tables : les
-- politiques n'étaient jamais atteintes, PostgreSQL refusait avant.
--
-- La règle tient maintenant : le banc n'accorde rien que la production
-- n'accorde. C'est la migration 0015 qui distribue les droits, ici comme
-- là-bas, et le banc les vérifie (voir droits.sql).
--
-- La clé de service contourne tout, elle, et c'est sa raison d'être.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- Se faire passer pour quelqu'un, le temps d'un test.
create or replace function test_login(p_user uuid, p_agency uuid, p_role text, p_office uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'agency_id', p_agency, 'agency_role', p_role,
    'office_id', coalesce(p_office::text, '')
  )::text, true);
end $$;
