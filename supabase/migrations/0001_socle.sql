-- 0001 · Socle : extensions, agences, bureaux, comptes, et la lecture des
-- droits depuis le jeton.
--
-- Principe qui gouverne tout le schéma : l'agence, le rôle et le bureau de
-- l'appelant viennent du JETON, jamais d'une lecture de table. Une politique
-- qui lit `profiles` pour protéger `profiles` boucle à l'infini, et une
-- politique qui lit une table à chaque ligne coûte une requête par ligne.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ------------------------------------------------------------------
-- Agences et bureaux
-- ------------------------------------------------------------------

create table if not exists agencies (
  id             uuid primary key default gen_random_uuid(),
  slug           text unique not null
                 check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name           text not null,
  legal_name     text,
  tax_id         text,
  country        text not null default 'Tunisie',
  mark           text not null default 'VF',
  accent         text not null default '#0066CC',
  email          citext,
  phone          text,
  website        text,
  locales        text[] not null default '{fr,en,ar,zh}',
  default_locale text not null default 'fr' check (default_locale in ('fr','en','ar','zh')),
  currency       char(3) not null default 'TND',
  services       text[] not null default '{visas}'
                 check (services <@ array['visas','fret']),
  plan           text not null default 'essai'
                 check (plan in ('essai','standard','multi_bureaux','suspendu')),
  trial_ends_at  timestamptz,
  -- Le numéro de déclaration INPDP. Sans lui, l'agence reste en essai : c'est
  -- le meilleur garde-fou contre les fausses agences, et il ne coûte rien.
  inpdp_ref      text,
  verified_at    timestamptz,
  setup_done     text[] not null default '{}',
  setup_hidden   boolean not null default false,
  created_at     timestamptz not null default now(),
  suspended_at   timestamptz,
  deleted_at     timestamptz
);

comment on column agencies.verified_at is
  'Validation manuelle du dossier de l''agence. Aucun vrai passeport avant.';

create table if not exists offices (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  name         text not null,
  city         text,
  country      text not null,
  country_code char(2) not null,
  phone        text,
  address      text,
  timezone     text not null default 'Africa/Tunis',
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists offices_agency on offices (agency_id);

-- Les comptes vivent dans auth.users ; profiles porte le métier.
create table if not exists profiles (
  id         uuid primary key references auth.users on delete cascade,
  agency_id  uuid not null references agencies on delete cascade,
  office_id  uuid references offices on delete set null,
  name       text not null,
  email      citext,
  phone      text,
  role       text not null default 'agent'
             check (role in ('owner','manager','agent','viewer')),
  locale     text not null default 'fr',
  active     boolean not null default true,
  invited_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create index if not exists profiles_agency on profiles (agency_id, active);

-- ------------------------------------------------------------------
-- Les droits, lus dans le jeton
-- ------------------------------------------------------------------

-- Posé par le hook de jeton d'accès (voir 0010). Repli sur une lecture de
-- table pour la toute première requête d'une session, d'où le SECURITY DEFINER
-- et le search_path figé : sans lui, la politique de `profiles` boucle.
create or replace function auth_agency_id() returns uuid
language plpgsql stable security definer set search_path = public, auth as $$
declare v uuid;
begin
  v := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'agency_id', '')::uuid;
  if v is not null then return v; end if;
  select agency_id into v from profiles where id = auth.uid();
  return v;
end $$;

create or replace function auth_role() returns text
language plpgsql stable security definer set search_path = public, auth as $$
declare v text;
begin
  v := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'agency_role', '');
  if v is not null then return v; end if;
  select role into v from profiles where id = auth.uid();
  return coalesce(v, 'viewer');
end $$;

create or replace function auth_office_id() returns uuid
language plpgsql stable security definer set search_path = public, auth as $$
declare v uuid;
begin
  v := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'office_id', '')::uuid;
  if v is not null then return v; end if;
  select office_id into v from profiles where id = auth.uid();
  return v;
end $$;

-- La même matrice que web/src/lib/permissions.ts, avec les mêmes noms.
-- Elle existe deux fois volontairement : une fois pour dessiner l'écran, une
-- fois pour décider. Seule celle-ci protège.
create or replace function auth_can(capability text) returns boolean
language sql stable as $$
  select case auth_role()
    when 'owner' then capability = any (array[
      'case:read','case:write','case:create','client:write','doc:validate',
      'message:send','payment:write','shipment:write','settings:view',
      'reports:view','automation:manage','settings:manage','catalog:manage',
      'audit:view','finance:global','team:manage','data:export','data:reset'])
    when 'manager' then capability = any (array[
      'case:read','case:write','case:create','client:write','doc:validate',
      'message:send','payment:write','shipment:write','settings:view',
      'reports:view','automation:manage','settings:manage','catalog:manage','audit:view'])
    when 'agent' then capability = any (array[
      'case:read','case:write','case:create','client:write','doc:validate',
      'message:send','payment:write','shipment:write','settings:view'])
    else capability = 'case:read'
  end
$$;

-- Le périmètre de lecture : toute l'agence, ou le seul bureau de la personne.
create or replace function auth_sees_office(target uuid) returns boolean
language sql stable as $$
  select auth_role() in ('owner','manager') or target is not distinct from auth_office_id()
$$;

-- ------------------------------------------------------------------
-- Numérotation des références, par agence et par année
-- ------------------------------------------------------------------

create table if not exists reference_counters (
  agency_id uuid not null references agencies on delete cascade,
  kind      text not null check (kind in ('case','shipment','request','receipt')),
  year      int  not null,
  last      int  not null default 0,
  primary key (agency_id, kind, year)
);

create or replace function next_reference(p_agency uuid, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare
  y int := extract(year from now())::int;
  n int;
  prefix text := case p_kind
    when 'case' then 'VF' when 'shipment' then 'EXP'
    when 'request' then 'DEM' else 'REC' end;
begin
  insert into reference_counters (agency_id, kind, year, last)
  values (p_agency, p_kind, y, 1)
  on conflict (agency_id, kind, year)
    do update set last = reference_counters.last + 1
  returning last into n;
  return prefix || '-' || y || '-' || lpad(n::text, 4, '0');
end $$;

comment on function next_reference is
  'Une suite par agence et par année. Deux agences ne partagent jamais une référence.';
