-- VisaFlow, schema Postgres pour Supabase.
-- Il suit exactement web/src/data/types.ts.
-- Les libelles traduits sont en jsonb : { "fr": "...", "en": "...", "ar": "...", "zh": "..." }

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------------
-- Agences et bureaux
-- ------------------------------------------------------------------

create table agencies (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  name          text not null,
  legal_name    text,
  mark          text not null,
  accent        text not null default '#0066CC',
  email         text,
  phone         text,
  website       text,
  locales       text[] not null default '{fr,en,ar,zh}',
  default_locale text not null default 'fr',
  currency      text not null default 'TND',
  inpdp_ref     text,
  plan          text not null default 'essai',
  created_at    timestamptz not null default now()
);

create table offices (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  name         text not null,
  city         text not null,
  country      text not null,
  country_code text not null,
  phone        text,
  address      text,
  timezone     text not null default 'Africa/Tunis'
);

-- Les comptes vivent dans auth.users ; profiles porte le metier.
create table profiles (
  id         uuid primary key references auth.users on delete cascade,
  agency_id  uuid not null references agencies on delete cascade,
  office_id  uuid references offices on delete set null,
  name       text not null,
  phone      text,
  role       text not null default 'agent' check (role in ('owner','manager','agent','viewer')),
  locale     text not null default 'fr',
  active     boolean not null default true
);

-- ------------------------------------------------------------------
-- Clients
-- ------------------------------------------------------------------

create table clients (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references agencies on delete cascade,
  office_id       uuid references offices on delete set null,
  first_name      text not null,
  last_name       text not null,
  native_name     text,
  email           text,
  phone           text not null,
  whatsapp        text,
  nationality     text,
  passport_number text,
  passport_expiry date,
  birth_date      date,
  address         text,
  locale          text not null default 'fr',
  tags            text[] not null default '{}',
  created_at      timestamptz not null default now()
);
create index on clients (agency_id, last_name);
create index on clients (agency_id, phone);

-- ------------------------------------------------------------------
-- Types de visa et listes de pieces
-- ------------------------------------------------------------------

create table checklists (
  id        uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies on delete cascade,
  name      jsonb not null,
  -- [{ key, label, help, required, validityDays }]
  items     jsonb not null default '[]'
);

create table visa_types (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references agencies on delete cascade,
  country_code    text not null,
  country         jsonb not null,
  label           jsonb not null,
  category        text not null,
  processing_days int  not null default 10,
  fee_agency      numeric(10,2) not null default 0,
  fee_consulate   numeric(10,2) not null default 0,
  checklist_id    uuid references checklists on delete set null,
  stages          text[] not null,
  active          boolean not null default true
);

-- ------------------------------------------------------------------
-- Dossiers
-- ------------------------------------------------------------------

create table cases (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  reference      text not null,
  client_id      uuid not null references clients on delete restrict,
  visa_type_id   uuid not null references visa_types on delete restrict,
  office_id      uuid references offices on delete set null,
  assignee_id    uuid references profiles on delete set null,
  stage          text not null default 'nouveau',
  status         text not null default 'ouvert' check (status in ('ouvert','accepte','refuse','annule')),
  priority       text not null default 'normale',
  source         text not null default 'comptoir',
  opened_at      timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  travel_date    date,
  due_at         date,
  consulate_ref  text,
  decision_at    timestamptz,
  refusal_reason text,
  amount_total   numeric(10,2) not null default 0,
  amount_paid    numeric(10,2) not null default 0,
  notes          text,
  -- Jeton de suivi client : lecture seule, sans compte, revoque a la cloture.
  portal_token   text not null unique default encode(gen_random_bytes(24), 'hex'),
  portal_expires_at timestamptz,
  unique (agency_id, reference)
);
create index on cases (agency_id, status, stage);
create index on cases (agency_id, travel_date);

create table case_documents (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references cases on delete cascade,
  key              text not null,
  label            jsonb not null,
  state            text not null default 'manquante'
                   check (state in ('manquante','demandee','recue','validee','refusee','expiree')),
  required         boolean not null default true,
  requested_at     timestamptz,
  received_at      timestamptz,
  validated_at     timestamptz,
  validated_by     uuid references profiles on delete set null,
  rejection_reason text,
  expires_at       date,
  storage_path     text,
  file_name        text,
  reminders        int not null default 0,
  last_reminder_at timestamptz,
  unique (case_id, key)
);

-- ------------------------------------------------------------------
-- Echanges
-- ------------------------------------------------------------------

create table message_templates (
  id        uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies on delete cascade,
  key       text not null,
  name      jsonb not null,
  channel   text not null default 'whatsapp',
  body      jsonb not null,
  variables text[] not null default '{}',
  -- Identifiant du modele approuve cote Meta, par langue.
  meta_template_ids jsonb not null default '{}',
  unique (agency_id, key)
);

create table messages (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  case_id      uuid references cases on delete cascade,
  shipment_id  uuid,
  channel      text not null default 'whatsapp',
  direction    text not null check (direction in ('entrant','sortant')),
  body         text not null,
  locale       text not null default 'fr',
  author_id    uuid references profiles on delete set null,
  template_key text,
  at           timestamptz not null default now(),
  status       text not null default 'file' check (status in ('file','envoye','remis','lu','echec')),
  automated    boolean not null default false,
  provider_id  text
);
create index on messages (case_id, at);
create index on messages (agency_id, status) where status = 'file';

create table appointments (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  case_id      uuid not null references cases on delete cascade,
  kind         text not null,
  at           timestamptz not null,
  duration_min int not null default 30,
  location     text,
  status       text not null default 'prevu',
  notes        text
);
create index on appointments (agency_id, at);

create table payments (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references agencies on delete cascade,
  case_id    uuid references cases on delete cascade,
  shipment_id uuid,
  label      jsonb not null,
  amount     numeric(10,2) not null,
  state      text not null default 'du' check (state in ('du','partiel','regle','rembourse')),
  method     text,
  at         timestamptz,
  due_at     date,
  receipt_no text
);

-- ------------------------------------------------------------------
-- Cargaisons
-- ------------------------------------------------------------------

create table shipments (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  reference      text not null,
  client_id      uuid not null references clients on delete restrict,
  case_id        uuid references cases on delete set null,
  office_id      uuid references offices on delete set null,
  assignee_id    uuid references profiles on delete set null,
  mode           text not null check (mode in ('maritime_fcl','maritime_lcl','aerien','routier')),
  supplier       text,
  goods          jsonb not null,
  origin_city    text, origin_port text,
  dest_city      text, dest_port   text,
  country_from   text, country_to  text,
  incoterm       text,
  container_no   text,
  bl_number      text,
  packages       int,
  weight_kg      numeric(10,2),
  volume_cbm     numeric(10,2),
  declared_value numeric(12,2),
  freight_cost   numeric(12,2),
  customs_duty   numeric(12,2),
  amount_paid    numeric(12,2) not null default 0,
  stage          text not null default 'demande',
  status         text not null default 'en_cours' check (status in ('en_cours','livree','bloquee','annulee')),
  etd            date,
  eta            date,
  delivered_at   timestamptz,
  notes          text,
  portal_token   text not null unique default encode(gen_random_bytes(24), 'hex'),
  unique (agency_id, reference)
);
create index on shipments (agency_id, status, eta);

create table shipment_documents (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments on delete cascade,
  key         text not null,
  label       jsonb not null,
  state       text not null default 'manquante',
  required    boolean not null default true,
  storage_path text,
  file_name   text,
  received_at timestamptz,
  reminders   int not null default 0,
  unique (shipment_id, key)
);

create table shipment_events (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments on delete cascade,
  stage       text not null,
  at          timestamptz not null default now(),
  location    text,
  note        jsonb
);

-- ------------------------------------------------------------------
-- Automatisations, taches, journal
-- ------------------------------------------------------------------

create table automation_rules (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  name        jsonb not null,
  trigger     jsonb not null,
  action      jsonb not null,
  active      boolean not null default true,
  runs        int not null default 0,
  last_run_at timestamptz
);

create table tasks (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  case_id     uuid references cases on delete cascade,
  shipment_id uuid references shipments on delete cascade,
  assignee_id uuid references profiles on delete set null,
  title       jsonb not null,
  due_at      timestamptz,
  done        boolean not null default false,
  automated   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table activity_events (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  case_id     uuid references cases on delete cascade,
  shipment_id uuid references shipments on delete cascade,
  client_id   uuid references clients on delete set null,
  actor_id    uuid references profiles on delete set null,
  type        text not null,
  detail      jsonb not null,
  at          timestamptz not null default now(),
  automated   boolean not null default false
);
create index on activity_events (agency_id, at desc);

-- ------------------------------------------------------------------
-- Cloisonnement : une agence ne voit jamais une autre agence
-- ------------------------------------------------------------------

create or replace function current_agency_id() returns uuid
language sql stable as $$
  select agency_id from profiles where id = auth.uid()
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'offices','profiles','clients','checklists','visa_types','cases',
    'message_templates','messages','appointments','payments','shipments',
    'automation_rules','tasks','activity_events'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format($f$
      create policy agence_cloisonnee on %I
        for all
        using (agency_id = current_agency_id())
        with check (agency_id = current_agency_id())
    $f$, t);
  end loop;
end $$;

-- Les tables filles passent par leur parent.
alter table case_documents enable row level security;
create policy agence_cloisonnee on case_documents for all
  using (exists (select 1 from cases c where c.id = case_id and c.agency_id = current_agency_id()));

alter table shipment_documents enable row level security;
create policy agence_cloisonnee on shipment_documents for all
  using (exists (select 1 from shipments s where s.id = shipment_id and s.agency_id = current_agency_id()));

alter table shipment_events enable row level security;
create policy agence_cloisonnee on shipment_events for all
  using (exists (select 1 from shipments s where s.id = shipment_id and s.agency_id = current_agency_id()));

-- ------------------------------------------------------------------
-- Acces client par jeton, en lecture seule.
-- Le portail n'interroge jamais les tables directement : il appelle cette
-- fonction, qui ne rend que le dossier correspondant au jeton.
-- ------------------------------------------------------------------

create or replace function portal_case(token text)
returns jsonb
language sql security definer stable as $$
  select jsonb_build_object(
    'case', to_jsonb(c) - 'notes' - 'portal_token',
    'documents', (select coalesce(jsonb_agg(to_jsonb(d) - 'storage_path'), '[]') from case_documents d where d.case_id = c.id),
    'appointments', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from appointments a where a.case_id = c.id and a.status = 'prevu'),
    'payments', (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from payments p where p.case_id = c.id)
  )
  from cases c
  where c.portal_token = token
    and (c.portal_expires_at is null or c.portal_expires_at > now())
$$;
