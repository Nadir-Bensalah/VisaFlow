-- 0005 · L'argent : devises, honoraires contre débours, reçus, caisse.
--
-- Deux règles de métier que le modèle doit porter, sinon les rapports mentent.
-- 1. Les frais de consulat ne sont pas du chiffre d'affaires : l'agence les
--    encaisse et les reverse. Un patron qui découvre une fois qu'on les compte
--    dans son chiffre ne rouvre plus jamais l'écran.
-- 2. Le fret se négocie en devises, le taux bouge entre le devis et l'arrivée.

create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  -- Un règlement appartient à un dossier, à une cargaison, ou à un lot.
  case_id      uuid references cases on delete cascade,
  shipment_id  uuid references shipments on delete cascade,
  lot_id       uuid references shipment_lots on delete cascade,
  client_id    uuid references clients on delete set null,
  label        jsonb not null,
  -- honoraires : c'est le revenu. debours : encaissé pour être reversé.
  kind         text not null default 'honoraires'
               check (kind in ('honoraires','debours','fret','penalite','remboursement')),
  amount       numeric(14,2) not null,
  currency     char(3) not null default 'TND',
  -- Taux vers la devise de l'agence au moment de l'encaissement.
  fx_rate      numeric(14,6) not null default 1,
  state        text not null default 'du' check (state in ('du','partiel','regle','rembourse')),
  method       text check (method in ('especes','virement','carte','cheque','compensation')),
  at           timestamptz,
  due_at       date,
  receipt_no   text,
  cash_session_id uuid,
  collected_by uuid references profiles on delete set null,
  office_id    uuid references offices on delete set null,
  created_at   timestamptz not null default now(),
  constraint payments_rattachement check (
    (case_id is not null)::int + (shipment_id is not null)::int + (lot_id is not null)::int >= 1
  )
);
create index if not exists payments_agency_state on payments (agency_id, state);
create index if not exists payments_case on payments (case_id);
create index if not exists payments_shipment on payments (shipment_id);

-- Le revenu réel, débours exclus. C'est cette vue que lisent les rapports.
create or replace view revenue_lines as
  select p.*, (p.amount * p.fx_rate) as amount_agency_currency
  from payments p
  where p.state = 'regle' and p.kind in ('honoraires','fret','penalite');

-- ------------------------------------------------------------------
-- La caisse
-- ------------------------------------------------------------------
-- Le soir, on compte les espèces. Marquer « réglé » dans un écran ne remplace
-- pas un livre de caisse.

create table if not exists cash_sessions (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  office_id   uuid not null references offices on delete cascade,
  opened_by   uuid references profiles on delete set null,
  opened_at   timestamptz not null default now(),
  opening_float numeric(14,2) not null default 0,
  closed_by   uuid references profiles on delete set null,
  closed_at   timestamptz,
  counted_cash numeric(14,2),
  expected_cash numeric(14,2),
  note        text,
  currency    char(3) not null default 'TND'
);
create index if not exists cash_sessions_open on cash_sessions (agency_id, office_id) where closed_at is null;

create table if not exists cash_movements (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references agencies on delete cascade,
  session_id uuid not null references cash_sessions on delete cascade,
  payment_id uuid references payments on delete set null,
  direction  text not null check (direction in ('entree','sortie')),
  amount     numeric(14,2) not null check (amount > 0),
  currency   char(3) not null default 'TND',
  reason     text,
  at         timestamptz not null default now(),
  author_id  uuid references profiles on delete set null
);
create index if not exists cash_movements_session on cash_movements (session_id, at);

-- ------------------------------------------------------------------
-- Reçus et factures
-- ------------------------------------------------------------------

create table if not exists receipts (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  number      text not null,
  client_id   uuid references clients on delete set null,
  case_id     uuid references cases on delete set null,
  shipment_id uuid references shipments on delete set null,
  lines       jsonb not null default '[]',
  total       numeric(14,2) not null default 0,
  currency    char(3) not null default 'TND',
  issued_at   timestamptz not null default now(),
  issued_by   uuid references profiles on delete set null,
  storage_path text,
  cancelled_at timestamptz,
  cancel_reason text,
  unique (agency_id, number)
);

-- ------------------------------------------------------------------
-- Ce qui ne se montre pas à tout le monde
-- ------------------------------------------------------------------
-- Une politique de sécurité filtre des lignes, jamais des colonnes. Le coût du
-- fret et la marge vivent donc dans leur propre table, avec leur propre règle.

create table if not exists shipment_finance (
  shipment_id   uuid primary key references shipments on delete cascade,
  agency_id     uuid not null references agencies on delete cascade,
  freight_cost  numeric(14,2) not null default 0,
  freight_currency char(3) not null default 'USD',
  freight_fx    numeric(14,6) not null default 1,
  customs_duty  numeric(14,2),
  local_charges numeric(14,2),
  quoted_price  numeric(14,2),
  note          text
);

create or replace view shipment_margin as
  select
    f.shipment_id, f.agency_id,
    coalesce(f.quoted_price, 0)
      - (f.freight_cost * f.freight_fx)
      - coalesce(f.customs_duty, 0)
      - coalesce(f.local_charges, 0) as margin
  from shipment_finance f;

-- La commission due à l'apporteur d'affaires, dossier par dossier.
create table if not exists partner_commissions (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references agencies on delete cascade,
  partner_id uuid not null references partners on delete cascade,
  case_id    uuid references cases on delete set null,
  shipment_id uuid references shipments on delete set null,
  amount     numeric(12,2) not null,
  currency   char(3) not null default 'TND',
  state      text not null default 'du' check (state in ('du','regle','annule')),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists partner_commissions_open on partner_commissions (agency_id, state);
