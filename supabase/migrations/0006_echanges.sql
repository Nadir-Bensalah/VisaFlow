-- 0006 · Échanges : messages, rendez-vous, tâches, et les demandes entrantes.

create table if not exists messages (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  case_id      uuid references cases on delete cascade,
  shipment_id  uuid references shipments on delete cascade,
  client_id    uuid references clients on delete set null,
  channel      text not null default 'whatsapp'
               check (channel in ('whatsapp','email','sms','portail','interne')),
  direction    text not null check (direction in ('entrant','sortant')),
  body         text not null,
  locale       text not null default 'fr',
  -- Nul quand le message vient du client ou d'une automatisation. Un message
  -- écrit par un inconnu ne doit jamais porter le nom d'un employé.
  author_id    uuid references profiles on delete set null,
  template_key text,
  at           timestamptz not null default now(),
  status       text not null default 'file'
               check (status in ('file','envoye','remis','lu','echec')),
  status_at    timestamptz,
  error        text,
  automated    boolean not null default false,
  provider_id  text,
  read_at      timestamptz,
  constraint messages_rattachement check (case_id is not null or shipment_id is not null or client_id is not null)
);
create index if not exists messages_case on messages (case_id, at);
create index if not exists messages_queue on messages (agency_id, status) where status = 'file';
create index if not exists messages_unread on messages (agency_id) where direction = 'entrant' and read_at is null;

-- La fenêtre de 24 heures de WhatsApp : y répondre est gratuit, écrire à froid
-- est facturé. Le serveur doit savoir laquelle est ouverte.
create or replace function whatsapp_window_open(p_client uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from messages
    where client_id = p_client and direction = 'entrant'
      and channel = 'whatsapp' and at > now() - interval '24 hours'
  )
$$;

create table if not exists appointments (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  case_id      uuid references cases on delete cascade,
  shipment_id  uuid references shipments on delete cascade,
  office_id    uuid references offices on delete set null,
  kind         text not null check (kind in ('agence','consulat','biometrie','retrait','douane','livraison')),
  at           timestamptz not null,
  duration_min int not null default 30,
  location     text,
  status       text not null default 'prevu' check (status in ('prevu','fait','manque','reporte','annule')),
  notes        text,
  created_by   uuid references profiles on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists appointments_day on appointments (agency_id, at);

create table if not exists tasks (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  case_id     uuid references cases on delete cascade,
  shipment_id uuid references shipments on delete cascade,
  assignee_id uuid references profiles on delete set null,
  title       jsonb not null,
  due_at      timestamptz,
  done        boolean not null default false,
  done_at     timestamptz,
  automated   boolean not null default false,
  created_by  uuid references profiles on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists tasks_open on tasks (agency_id, assignee_id) where done = false;

-- ------------------------------------------------------------------
-- Les demandes entrantes
-- ------------------------------------------------------------------
-- La porte d'entrée du métier : ce qui arrive de la page publique de l'agence,
-- avant que quiconque décide d'en faire un dossier.

create table if not exists client_requests (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  reference      text not null,
  kind           text not null check (kind in ('visa','fret')),
  visa_type_id   uuid references visa_types on delete set null,
  destination    text,
  travel_date    date,
  goods          text,
  origin_city    text,
  first_name     text not null,
  last_name      text not null,
  phone          text not null,
  email          citext,
  locale         text not null default 'fr',
  note           text,
  phone_verified boolean not null default false,
  status         text not null default 'nouvelle'
                 check (status in ('nouvelle','qualifiee','convertie','ecartee')),
  received_at    timestamptz not null default now(),
  handled_by     uuid references profiles on delete set null,
  handled_at     timestamptz,
  refusal_reason text,
  client_id      uuid references clients on delete set null,
  case_id        uuid references cases on delete set null,
  source_ip      inet,
  portal_token   text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  unique (agency_id, reference)
);
create index if not exists client_requests_new on client_requests (agency_id, status, received_at desc);
