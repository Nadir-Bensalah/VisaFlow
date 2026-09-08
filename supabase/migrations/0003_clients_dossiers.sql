-- 0003 · Clients, dossiers, pièces, notes, et le registre des passeports.

create table if not exists clients (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references agencies on delete cascade,
  office_id         uuid references offices on delete set null,
  first_name        text not null,
  last_name         text not null,
  native_name       text,
  email             citext,
  phone             text not null,
  whatsapp          text,
  nationality       text,
  passport_number   text,
  passport_expiry   date,
  birth_date        date,
  address           text,
  locale            text not null default 'fr',
  tags              text[] not null default '{}',
  partner_id        uuid references partners on delete set null,
  -- Le numéro est l'identité du client dans cette agence, et nulle part
  -- ailleurs. Vérifié une fois, il ouvre le suivi sur n'importe quel appareil.
  phone_verified_at timestamptz,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (agency_id, phone)
);
create index if not exists clients_agency_name on clients (agency_id, last_name);
create index if not exists clients_agency_office on clients (agency_id, office_id);

-- Cinq personnes qui partent ensemble sont un seul dossier dans la tête de
-- l'agence : un paiement, un rendez-vous, une décision.
create table if not exists case_groups (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references agencies on delete cascade,
  label      text not null,
  created_at timestamptz not null default now()
);

create table if not exists cases (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  reference      text not null,
  client_id      uuid not null references clients on delete restrict,
  group_id       uuid references case_groups on delete set null,
  visa_type_id   uuid not null references visa_types on delete restrict,
  office_id      uuid references offices on delete set null,
  assignee_id    uuid references profiles on delete set null,
  partner_id     uuid references partners on delete set null,
  -- La version de liste de pièces annoncée au client. Elle ne bouge plus.
  checklist_version_id uuid references checklist_versions on delete set null,
  stage          text not null default 'nouveau',
  status         text not null default 'ouvert'
                 check (status in ('ouvert','accepte','refuse','annule')),
  priority       text not null default 'normale'
                 check (priority in ('basse','normale','haute','urgente')),
  source         text not null default 'comptoir',
  opened_at      timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  travel_date    date,
  due_at         date,
  consulate_ref  text,
  decision_at    timestamptz,
  refusal_reason text,
  -- Une nouvelle tentative après un refus garde le lien avec la précédente.
  retry_of       uuid references cases on delete set null,
  amount_total   numeric(12,2) not null default 0,
  amount_paid    numeric(12,2) not null default 0,
  currency       char(3) not null default 'TND',
  -- Jeton de suivi : lecture seule, sans compte, révoqué à la clôture.
  portal_token   text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  portal_expires_at timestamptz,
  closed_at      timestamptz,
  purge_after    date,
  unique (agency_id, reference)
);
create index if not exists cases_agency_state on cases (agency_id, status, stage);
create index if not exists cases_agency_office on cases (agency_id, office_id);
create index if not exists cases_travel on cases (agency_id, travel_date) where status = 'ouvert';
create index if not exists cases_client on cases (client_id);

create table if not exists case_documents (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references agencies on delete cascade,
  case_id          uuid not null references cases on delete cascade,
  key              text not null,
  label            jsonb not null,
  help             jsonb,
  state            text not null default 'manquante'
                   check (state in ('manquante','demandee','recue','validee','refusee','expiree')),
  required         boolean not null default true,
  requested_at     timestamptz,
  received_at      timestamptz,
  received_channel text check (received_channel in ('portail','comptoir','whatsapp','email')),
  validated_at     timestamptz,
  validated_by     uuid references profiles on delete set null,
  rejection_reason text,
  expires_at       date,
  storage_path     text,
  file_name        text,
  file_size        int,
  reminders        int not null default 0,
  last_reminder_at timestamptz,
  unique (case_id, key)
);
create index if not exists case_documents_state on case_documents (agency_id, state);

-- Les notes s'empilent, datées et signées. Elles ne s'écrasent jamais.
create table if not exists case_notes (
  id        uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies on delete cascade,
  case_id   uuid references cases on delete cascade,
  shipment_id uuid,
  author_id uuid references profiles on delete set null,
  kind      text not null default 'note' check (kind in ('note','appel','comptoir','interne')),
  text      text not null,
  at        timestamptz not null default now()
);
create index if not exists case_notes_case on case_notes (case_id, at desc);

-- ------------------------------------------------------------------
-- Le registre des passeports
-- ------------------------------------------------------------------
-- Une agence garde en permanence des dizaines de passeports dans son coffre.
-- C'est son plus gros risque physique, et aucun logiciel de suivi ne le traite.

create table if not exists passport_custody (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  client_id    uuid not null references clients on delete restrict,
  case_id      uuid references cases on delete set null,
  passport_number text not null,
  received_at  timestamptz not null default now(),
  received_by  uuid references profiles on delete set null,
  -- Où il se trouve physiquement, à l'instant.
  location     text not null default 'coffre'
               check (location in ('coffre','consulat','partenaire','transit','rendu')),
  location_note text,
  returned_at  timestamptz,
  returned_by  uuid references profiles on delete set null,
  -- Signature du client au dépôt et au retrait, stockées comme fichiers.
  deposit_slip_path text,
  return_slip_path  text
);
create index if not exists passport_custody_open on passport_custody (agency_id, location)
  where returned_at is null;

comment on table passport_custody is
  'Qui a déposé quel passeport, quel jour, où il est, et qui l''a rendu.';
