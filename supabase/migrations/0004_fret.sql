-- 0004 · Le fret, avec le groupage, la douane et les surestaries.
--
-- Le vrai LCL, ce n'est pas une cargaison pour un client : c'est un conteneur
-- avec quinze clients dedans, chacun ses cartons, sa facture et son
-- dédouanement. Un modèle à un seul client par cargaison rate la moitié du
-- métier.

create table if not exists shipments (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  reference      text not null,
  office_id      uuid references offices on delete set null,
  assignee_id    uuid references profiles on delete set null,
  mode           text not null check (mode in ('maritime_fcl','maritime_lcl','aerien','routier')),
  -- Un conteneur complet a un client, un groupage en a plusieurs (voir lots).
  consolidated   boolean not null default false,
  supplier       text,
  goods          jsonb,
  origin_city    text, origin_port text,
  dest_city      text, dest_port   text,
  country_from   char(2), country_to char(2),
  incoterm       text check (incoterm in ('EXW','FOB','CFR','CIF','DAP','DDP')),
  container_no   text,
  bl_number      text,
  vessel         text,
  packages       int,
  weight_kg      numeric(12,2),
  volume_cbm     numeric(12,3),
  stage          text not null default 'demande',
  status         text not null default 'en_cours'
                 check (status in ('en_cours','livree','bloquee','annulee')),
  blocked_reason text,
  blocked_since  timestamptz,
  etd            date,
  eta            date,
  arrived_at     timestamptz,
  cleared_at     timestamptz,
  delivered_at   timestamptz,
  -- Le transitaire, qui manque toujours quand la douane appelle.
  broker_name    text,
  broker_phone   text,
  -- Jours francs avant que le stationnement ne se facture.
  free_days      int not null default 7,
  demurrage_rate numeric(12,2),
  demurrage_currency char(3) default 'TND',
  portal_token   text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  created_at     timestamptz not null default now(),
  unique (agency_id, reference)
);
create index if not exists shipments_agency_state on shipments (agency_id, status, eta);
create index if not exists shipments_agency_office on shipments (agency_id, office_id);

-- Un lot par client dans une cargaison groupée.
create table if not exists shipment_lots (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  shipment_id  uuid not null references shipments on delete cascade,
  client_id    uuid not null references clients on delete restrict,
  marks        text,
  goods        jsonb,
  packages     int,
  weight_kg    numeric(12,2),
  volume_cbm   numeric(12,3),
  declared_value numeric(14,2),
  declared_currency char(3) default 'USD',
  cleared_at   timestamptz,
  delivered_at timestamptz,
  portal_token text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  note         text
);
create index if not exists shipment_lots_shipment on shipment_lots (shipment_id);
create index if not exists shipment_lots_client on shipment_lots (client_id);

create table if not exists shipment_documents (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  shipment_id  uuid not null references shipments on delete cascade,
  lot_id       uuid references shipment_lots on delete cascade,
  key          text not null,
  label        jsonb not null,
  state        text not null default 'manquante'
               check (state in ('manquante','demandee','recue','validee','refusee','expiree')),
  required     boolean not null default true,
  storage_path text,
  file_name    text,
  received_at  timestamptz,
  reminders    int not null default 0
);
create index if not exists shipment_documents_state on shipment_documents (agency_id, state);

create table if not exists shipment_events (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  shipment_id uuid not null references shipments on delete cascade,
  stage       text not null,
  at          timestamptz not null default now(),
  location    text,
  note        jsonb,
  author_id   uuid references profiles on delete set null
);
create index if not exists shipment_events_ship on shipment_events (shipment_id, at desc);

-- Le stationnement au port. C'est là que l'argent se perd, et c'est ce que
-- l'agence regarde tous les matins.
create or replace function demurrage_days(p_shipment uuid) returns int
language sql stable as $$
  select greatest(0,
    (coalesce(s.cleared_at, now())::date - s.arrived_at::date) - s.free_days)
  from shipments s where s.id = p_shipment and s.arrived_at is not null
$$;

create or replace view shipment_demurrage as
  select
    s.id as shipment_id,
    s.agency_id,
    s.reference,
    s.arrived_at,
    s.free_days,
    demurrage_days(s.id) as overdue_days,
    coalesce(s.demurrage_rate, 0) * demurrage_days(s.id) as amount,
    s.demurrage_currency as currency
  from shipments s
  where s.arrived_at is not null and s.cleared_at is null;
