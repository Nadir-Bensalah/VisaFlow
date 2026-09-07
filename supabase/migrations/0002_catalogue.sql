-- 0002 · Le catalogue : ce que l'agence vend, et ce qu'elle exige.
-- C'est le vrai savoir du métier. Tout y est configurable, rien n'est en dur.

-- ------------------------------------------------------------------
-- Listes de pièces, versionnées
-- ------------------------------------------------------------------
-- Une liste change quand un consulat change ses exigences. Un dossier ouvert
-- la semaine dernière doit rester conforme à la liste qui lui a été annoncée :
-- on garde donc la version, et le dossier pointe la version qu'il a reçue.

create table if not exists checklists (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references agencies on delete cascade,
  name       jsonb not null,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists checklist_versions (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists on delete cascade,
  agency_id    uuid not null references agencies on delete cascade,
  version      int  not null,
  -- [{ key, label, help, required, validity_days, accepts }]
  items        jsonb not null default '[]',
  note         text,
  created_by   uuid references profiles on delete set null,
  created_at   timestamptz not null default now(),
  unique (checklist_id, version)
);
create index if not exists checklist_versions_current on checklist_versions (checklist_id, version desc);

create or replace function current_checklist_version(p_checklist uuid) returns uuid
language sql stable as $$
  select id from checklist_versions where checklist_id = p_checklist
  order by version desc limit 1
$$;

-- ------------------------------------------------------------------
-- Étapes, configurables par agence
-- ------------------------------------------------------------------

create table if not exists stage_definitions (
  id        uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies on delete cascade,
  domain    text not null check (domain in ('visa','fret')),
  key       text not null,
  label     jsonb not null,
  position  int not null,
  -- Une étape terminale ferme le dossier.
  terminal  boolean not null default false,
  unique (agency_id, domain, key)
);
create index if not exists stage_definitions_order on stage_definitions (agency_id, domain, position);

-- ------------------------------------------------------------------
-- Types de visa
-- ------------------------------------------------------------------

create table if not exists visa_types (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references agencies on delete cascade,
  country_code    char(2) not null,
  country         jsonb not null,
  label           jsonb not null,
  category        text not null default 'tourisme'
                  check (category in ('tourisme','affaires','etudes','travail','transit','famille')),
  processing_days int not null default 10 check (processing_days between 1 and 365),
  -- Les honoraires sont à l'agence. Les débours sont encaissés puis reversés :
  -- ils ne sont pas du chiffre d'affaires, et les rapports doivent le savoir.
  fee_agency      numeric(12,2) not null default 0 check (fee_agency >= 0),
  fee_consulate   numeric(12,2) not null default 0 check (fee_consulate >= 0),
  currency        char(3) not null default 'TND',
  checklist_id    uuid references checklists on delete set null,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists visa_types_agency on visa_types (agency_id, active);

-- ------------------------------------------------------------------
-- Modèles de message
-- ------------------------------------------------------------------

create table if not exists message_templates (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references agencies on delete cascade,
  key               text not null,
  name              jsonb not null,
  channel           text not null default 'whatsapp'
                    check (channel in ('whatsapp','email','sms','portail','interne')),
  body              jsonb not null,
  variables         text[] not null default '{}',
  -- Identifiant du modèle approuvé côté Meta, par langue.
  meta_template_ids jsonb not null default '{}',
  category          text not null default 'utility'
                    check (category in ('utility','authentication','marketing')),
  archived          boolean not null default false,
  unique (agency_id, key)
);

-- ------------------------------------------------------------------
-- Automatisations
-- ------------------------------------------------------------------

create table if not exists automation_rules (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  name        jsonb not null,
  trigger     jsonb not null,
  action      jsonb not null,
  active      boolean not null default true,
  -- Le garde-fou qui manquait : une relance par dossier et par fenêtre, toutes
  -- règles confondues. Sans lui, un dossier bloqué reçoit un message par jour
  -- et le client bloque le numéro de l'agence.
  cooldown_hours int not null default 48 check (cooldown_hours >= 0),
  runs        int not null default 0,
  last_run_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists automation_firings (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references agencies on delete cascade,
  rule_id    uuid not null references automation_rules on delete cascade,
  subject    text not null,
  fired_at   timestamptz not null default now()
);
create index if not exists automation_firings_recent on automation_firings (rule_id, subject, fired_at desc);

-- ------------------------------------------------------------------
-- Apporteurs d'affaires
-- ------------------------------------------------------------------
-- Une partie des dossiers vient d'un hôtel, d'une agence de voyage ou d'un
-- cousin, et l'agence paie une commission. Sans cette table, « partenaire »
-- dans la source d'un dossier ne veut rien dire.

create table if not exists partners (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  name           text not null,
  phone          text,
  email          citext,
  commission_kind text not null default 'fixe' check (commission_kind in ('fixe','pourcentage')),
  commission_value numeric(12,2) not null default 0,
  active         boolean not null default true,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists partners_agency on partners (agency_id, active);
