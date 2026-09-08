-- 0048 · La logistique aval : entre le navire et le client.
--
-- Le fret s'arrête au port (voir 0029), la douane s'arrête au bon à enlever
-- (voir 0030). Entre le quai et le magasin du client, il reste une semaine de
-- travail, et c'est celle qui coûte le plus cher quand elle est mal tenue :
-- l'avis d'arrivée qu'on lit trois jours trop tard, l'entrepôt dont personne
-- ne connaît le stock, la livraison faite sans preuve, et les frais qu'on
-- oublie de refacturer.
--
-- Trois principes tenus ici :
--
-- 1. ON NE REFAIT PAS CE QUI EXISTE. Les compteurs de stationnement, les
--    barèmes, les tronçons et les connaissements vivent dans 0029. L'avis
--    d'arrivée s'y raccorde : il prend ses jours francs dans le barème de
--    l'agence, il ne les invente pas.
--
-- 2. LE POIDS TAXABLE AÉRIEN N'EST PAS LA RÈGLE W/M. En maritime on facture
--    le plus élevé de la tonne et du mètre cube (0029, `chargeable_units`).
--    En aérien on facture le plus élevé du poids réel et du volume divisé par
--    6 000, soit 166,67 kg par mètre cube. Confondre les deux fait facturer
--    un envoi aérien au sixième de son prix.
--
-- 3. UNE PREUVE DE LIVRAISON NE SE MODIFIE PAS. Une signature qu'on peut
--    réécrire ne prouve plus rien devant un client qui conteste. La table est
--    en ajout seul, garantie par un déclencheur et par l'absence de droit.
--
-- Ce que cette migration ne fait PAS : livrer un tarif. Aucun barème portuaire
-- ni de manutention n'est public en Tunisie. La règle du module fret vaut ici.

-- ------------------------------------------------------------------
-- 0 · Deux aides communes à toutes les tables du module
-- ------------------------------------------------------------------

-- Chaque table du module porte un bureau, pour que la politique de lecture
-- puisse filtrer avec `auth_sees_office`. Le bureau n'est presque jamais saisi
-- à la main : il se déduit de la cargaison, de l'entrepôt ou de la livraison.
-- Sans ce report, un agent de Sfax verrait les livraisons de Tunis, ce que la
-- règle des bureaux interdit depuis le socle.
create or replace function logistique_fill_office()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_parent uuid;
  v_office uuid;
begin
  if new.office_id is not null then return new; end if;
  v_parent := (to_jsonb(new) ->> TG_ARGV[1])::uuid;
  if v_parent is null then return new; end if;
  execute format('select office_id from public.%I where id = $1', TG_ARGV[0])
    into v_office using v_parent;
  new.office_id := v_office;
  return new;
end $$;

revoke all on function logistique_fill_office() from public, anon, authenticated;

-- ------------------------------------------------------------------
-- 1 · L'avis d'arrivée, et le jour où les surestaries démarrent
-- ------------------------------------------------------------------
--
-- L'avis d'arrivée est le papier qui déclenche tout : il donne le lieu, la
-- date, et surtout le début du stockage. Les jours francs comptés à partir de
-- là, c'est le seul délai gratuit de toute la chaîne. Le passer coûte de cent
-- à plusieurs centaines de dinars par jour et par conteneur.

create table if not exists arrival_notices (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references agencies on delete cascade,
  -- Reporté depuis la cargaison par déclencheur (voir logistique_fill_office).
  office_id           uuid references offices on delete set null,
  shipment_id         uuid not null references shipments on delete cascade,
  carrier_name        text,
  reference           text,
  arrival_location    text,
  estimated_arrival   timestamptz,
  actual_arrival      timestamptz,
  -- Le jour où la marchandise commence à stationner. C'est lui qui fait
  -- partir le décompte, pas la date du courrier de l'armateur.
  storage_start_date  date,
  free_days           int check (free_days is null or free_days >= 0),
  -- Calculé, jamais saisi : deux personnes qui posent la date à la main
  -- finissent par ne plus être d'accord. Les jours francs, eux, viennent du
  -- barème de l'agence quand l'avis ne les porte pas (voir le déclencheur
  -- ci-dessous, qui interroge `tariff_for` de la migration 0029).
  demurrage_start_date date generated always as (storage_start_date + free_days) stored,
  document_path       text,
  received_at         timestamptz,
  note                text,
  created_at          timestamptz not null default now()
);
create index if not exists arrival_notices_ship on arrival_notices (shipment_id);
create index if not exists arrival_notices_watch
  on arrival_notices (agency_id, demurrage_start_date);

comment on table arrival_notices is
  'L''avis d''arrivée du transporteur. Sa seule donnée vraiment chère est le début du stockage : les jours francs comptent à partir de là, et au-delà chaque journée se facture.';
comment on column arrival_notices.demurrage_start_date is
  'Premier jour facturable. Calculé, jamais saisi : début de stockage plus jours francs. Les jours francs viennent du barème de l''agence (migration 0029) quand l''avis ne les porte pas.';

-- Les jours francs ne se réinventent pas : ils sont déjà dans le barème de
-- l'agence, par armateur, par port et par type de conteneur, avec sa période
-- de validité. On va les y chercher plutôt que d'en poser un de plus.
create or replace function arrival_notice_free_days()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s record;
  ct text;
  t demurrage_tariffs;
begin
  if new.free_days is not null or new.storage_start_date is null then
    return new;
  end if;

  select * into s from shipments where id = new.shipment_id;
  if not found then return new; end if;

  -- Le même repli que `shipment_counters` : un groupage sans type de conteneur
  -- est du LCL, le reste est un 40 pieds tant qu'on n'a pas mieux.
  ct := coalesce(s.container_type, case when s.mode = 'maritime_lcl' then 'LCL' else '40' end);

  t := tariff_for(new.agency_id, 'surestaries',
                  coalesce(new.arrival_location, s.dest_port, ''), ct,
                  new.storage_start_date);
  if t.id is not null then
    new.free_days := t.free_days;
  end if;
  return new;
end $$;

revoke all on function arrival_notice_free_days() from public, anon, authenticated;

drop trigger if exists arrival_notices_office on arrival_notices;
create trigger arrival_notices_office before insert or update on arrival_notices
  for each row execute function logistique_fill_office('shipments', 'shipment_id');

drop trigger if exists arrival_notices_francs on arrival_notices;
create trigger arrival_notices_francs before insert or update on arrival_notices
  for each row execute function arrival_notice_free_days();

-- ------------------------------------------------------------------
-- 2 · Les certificats d'origine
-- ------------------------------------------------------------------
--
-- Le certificat d'origine décide du taux de droit de douane. Se tromper de
-- formulaire, c'est payer le NPF plein sur une marchandise qui ouvrait droit
-- au préférentiel, ou l'inverse : un redressement.

create table if not exists origin_certificates (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references agencies on delete cascade,
  office_id           uuid references offices on delete set null,
  shipment_id         uuid not null references shipments on delete cascade,
  lot_id              uuid references shipment_lots on delete cascade,
  kind                text not null check (kind in (
                        'EUR1','EURMED','ORIGINE_ARABE','CERTIFICAT_ORIGINE',
                        'DECLARATION_FACTURE','AUTRE')),
  origin_country      char(2),
  destination_country char(2),
  reference           text,
  issue_date          date,
  expiry_date         date,
  issuer              text,
  status              text not null default 'a_demander'
                      check (status in ('a_demander','demande','obtenu','refuse','expire')),
  document_path       text,
  note                text,
  created_at          timestamptz not null default now(),
  check (expiry_date is null or issue_date is null or expiry_date >= issue_date)
);
create index if not exists origin_certificates_ship on origin_certificates (shipment_id);
create index if not exists origin_certificates_lot on origin_certificates (lot_id);

comment on table origin_certificates is
  'Le papier qui décide du taux de droit de douane. Le module douane (0030) sait déjà quels pays ouvrent un régime préférentiel : ici on avertit, on ne bloque pas.';

-- Un EUR.1 sur une origine chinoise est presque toujours une erreur : la Chine
-- ne figure dans aucun accord préférentiel tunisien, et le module douane refuse
-- déjà les codes 404 et 971 sur cette origine. Presque toujours, pas toujours :
-- une marchandise peut avoir été transformée ailleurs, et l'agence peut avoir
-- une raison de saisir ce qu'elle a en main. On avertit donc, sans refuser.
-- Une base qui bloque une saisie légitime pousse l'agence à saisir faux
-- ailleurs, et on perd la trace.
create or replace function origin_certificate_warning(p_kind text, p_origin text)
returns text
language sql stable security definer set search_path = public as $$
  select case
    -- Ces quatre formulaires ne servent qu'à revendiquer un préférentiel.
    when p_kind in ('EUR1','EURMED','ORIGINE_ARABE','DECLARATION_FACTURE')
     and p_origin is not null
     and not origin_preferential_allowed(p_origin::char(2))
    then 'origine_sans_preferentiel'
  end
$$;

comment on function origin_certificate_warning(text, text) is
  'Avertit quand un formulaire préférentiel est saisi pour une origine qui n''ouvre aucun préférentiel, la Chine en tête. C''est un avis, jamais un refus : l''agence peut avoir une raison, et une saisie bloquée se recopie ailleurs, hors de vue.';

drop trigger if exists origin_certificates_office on origin_certificates;
create trigger origin_certificates_office before insert or update on origin_certificates
  for each row execute function logistique_fill_office('shipments', 'shipment_id');

-- ------------------------------------------------------------------
-- 3 · L'aérien, et son poids taxable
-- ------------------------------------------------------------------

-- La règle IATA : un mètre cube pèse 166,67 kg pour la facturation, et on
-- retient le plus lourd du réel et de ce volumétrique. Elle n'a rien à voir
-- avec la règle W/M du maritime (0029, `chargeable_units`), qui compare des
-- TONNES à des mètres cubes. Un envoi de 100 kg pour 1 m³ vaut 1 unité
-- payante en maritime, et 166,67 kg taxables en aérien.
create or replace function air_chargeable_weight(p_weight_kg numeric, p_volume_cbm numeric)
returns numeric
language sql immutable security definer set search_path = public as $$
  select round(
    greatest(
      coalesce(p_weight_kg, 0),
      -- 1 m³ = 1 000 000 cm³, divisé par le diviseur IATA de 6 000.
      coalesce(p_volume_cbm, 0) * 1000000 / 6000.0
    ), 2)
$$;

comment on function air_chargeable_weight(numeric, numeric) is
  'Poids taxable aérien, règle IATA : le plus élevé du poids réel et du volume divisé par 6 000, soit 166,67 kg le mètre cube. À ne pas confondre avec chargeable_units, qui est la règle maritime W/M.';

create table if not exists air_waybills (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null references agencies on delete cascade,
  office_id             uuid references offices on delete set null,
  shipment_id           uuid not null references shipments on delete cascade,
  awb_number            text not null,
  -- Même partage qu'en maritime : la compagnie émet le Master au groupeur, le
  -- groupeur émet la House au client final.
  kind                  text not null default 'HOUSE' check (kind in ('MASTER','HOUSE')),
  airline               text,
  airport_origin        text,
  airport_destination   text,
  flight_number         text,
  departure_date        date,
  arrival_date          date,
  pieces                int check (pieces is null or pieces >= 0),
  weight_kg             numeric(12,2),
  chargeable_weight_kg  numeric(12,2),
  document_path         text,
  note                  text,
  created_at            timestamptz not null default now()
);
create index if not exists air_waybills_ship on air_waybills (shipment_id);
create index if not exists air_waybills_number on air_waybills (agency_id, awb_number);

comment on table air_waybills is
  'La lettre de transport aérien. Le poids taxable est calculé par air_chargeable_weight quand il n''est pas fourni : c''est lui qui est facturé, pas le poids de la balance.';

-- Le poids taxable saisi par la compagnie fait foi. Quand il manque, on le
-- calcule avec le volume de la cargaison plutôt que de laisser une case vide :
-- une case vide se remplit avec le poids réel, et l'agence sous-facture.
create or replace function air_waybill_fill_weight()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cbm numeric;
begin
  if new.chargeable_weight_kg is not null then return new; end if;
  select volume_cbm into v_cbm from shipments where id = new.shipment_id;
  if new.weight_kg is null and v_cbm is null then return new; end if;
  new.chargeable_weight_kg := air_chargeable_weight(new.weight_kg, v_cbm);
  return new;
end $$;

revoke all on function air_waybill_fill_weight() from public, anon, authenticated;

drop trigger if exists air_waybills_office on air_waybills;
create trigger air_waybills_office before insert or update on air_waybills
  for each row execute function logistique_fill_office('shipments', 'shipment_id');

drop trigger if exists air_waybills_weight on air_waybills;
create trigger air_waybills_weight before insert or update on air_waybills
  for each row execute function air_waybill_fill_weight();

-- ------------------------------------------------------------------
-- 4 · Le routier
-- ------------------------------------------------------------------
--
-- Le camion qui monte de Radès, ou celui qui passe Ras Jedir vers la Libye.
-- Quand la douane ou le client appelle, c'est l'immatriculation, le numéro de
-- CMR et le téléphone du chauffeur qu'on cherche, et qu'on ne trouve jamais.

create table if not exists road_shipments (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references agencies on delete cascade,
  office_id           uuid references offices on delete set null,
  shipment_id         uuid not null references shipments on delete cascade,
  carrier_name        text,
  truck_registration  text,
  trailer_registration text,
  driver_name         text,
  driver_phone        text,
  cmr_number          text,
  border_crossing     text,
  departure_at        timestamptz,
  arrival_at          timestamptz,
  note                text,
  created_at          timestamptz not null default now(),
  check (arrival_at is null or departure_at is null or arrival_at >= departure_at)
);
create index if not exists road_shipments_ship on road_shipments (shipment_id);

comment on table road_shipments is
  'Le tronçon routier vu du bureau : le camion, le chauffeur, la CMR et le poste frontière. Ce sont les quatre informations qu''on cherche quand la douane appelle.';

drop trigger if exists road_shipments_office on road_shipments;
create trigger road_shipments_office before insert or update on road_shipments
  for each row execute function logistique_fill_office('shipments', 'shipment_id');

-- ------------------------------------------------------------------
-- 5 · L'entrepôt et ses mouvements
-- ------------------------------------------------------------------

create table if not exists warehouses (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies on delete cascade,
  office_id     uuid references offices on delete set null,
  name          text not null,
  address       text,
  city          text,
  country       text,
  capacity_cbm  numeric(12,3) check (capacity_cbm is null or capacity_cbm >= 0),
  contact_name  text,
  contact_phone text,
  -- On ferme un entrepôt, on ne l'efface pas : ses mouvements passés restent
  -- la seule explication d'un stock.
  active        boolean not null default true,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists warehouses_agency on warehouses (agency_id, active);

comment on column warehouses.active is
  'Un entrepôt se ferme, il ne s''efface pas. Ses mouvements passés sont la seule explication d''un stock, et une suppression rendrait les inventaires anciens illisibles.';

create table if not exists warehouse_movements (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies on delete cascade,
  office_id     uuid references offices on delete set null,
  warehouse_id  uuid not null references warehouses on delete cascade,
  shipment_id   uuid references shipments on delete set null,
  lot_id        uuid references shipment_lots on delete set null,
  direction     text not null check (direction in ('ENTREE','SORTIE','TRANSFERT')),
  quantity      numeric(12,3),
  package_count int check (package_count is null or package_count >= 0),
  weight_kg     numeric(12,2),
  volume_cbm    numeric(12,3),
  at            timestamptz not null default now(),
  -- Qui a bougé la marchandise. Un mouvement sans nom ne se conteste pas.
  operator_id   uuid references profiles on delete set null,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists warehouse_movements_wh on warehouse_movements (warehouse_id, at desc);
create index if not exists warehouse_movements_ship on warehouse_movements (shipment_id);

comment on table warehouse_movements is
  'Les entrées et sorties de l''entrepôt. Le stock ne se stocke pas : il se recompte à partir des mouvements, sinon deux chiffres finissent par exister et personne ne sait lequel croire.';

drop trigger if exists warehouse_movements_office on warehouse_movements;
create trigger warehouse_movements_office before insert or update on warehouse_movements
  for each row execute function logistique_fill_office('warehouses', 'warehouse_id');

-- ------------------------------------------------------------------
-- 6 · La livraison, et sa preuve
-- ------------------------------------------------------------------

create table if not exists deliveries (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  office_id      uuid references offices on delete set null,
  shipment_id    uuid references shipments on delete cascade,
  lot_id         uuid references shipment_lots on delete cascade,
  client_id      uuid references clients on delete restrict,
  address        text,
  contact_name   text,
  contact_phone  text,
  planned_at     timestamptz,
  delivered_at   timestamptz,
  driver_name    text,
  driver_phone   text,
  vehicle        text,
  status         text not null default 'a_programmer'
                 check (status in ('a_programmer','programmee','en_route','livree','echouee','reportee')),
  -- Une livraison ratée sans raison écrite est une livraison qu'on refera à
  -- l'identique, et qui ratera pareil.
  failure_reason text,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists deliveries_plan on deliveries (office_id, planned_at);
create index if not exists deliveries_ship on deliveries (shipment_id);
create index if not exists deliveries_client on deliveries (client_id);

comment on column deliveries.failure_reason is
  'Pourquoi la livraison a échoué. Sans elle, la tournée du lendemain repart avec la même adresse et le même numéro faux.';

drop trigger if exists deliveries_office on deliveries;
create trigger deliveries_office before insert or update on deliveries
  for each row execute function logistique_fill_office('shipments', 'shipment_id');

-- LA PREUVE EST IMMUABLE.
--
-- Une preuve de livraison sert le jour où le client dit qu'il n'a rien reçu.
-- Si la signature, la photo ou l'heure peuvent être réécrites après coup, la
-- preuve ne prouve plus rien : ni au client, ni à l'assureur, ni au juge. Une
-- politique de mise à jour, même réservée au propriétaire, vide donc la table
-- de sa valeur. On autorise l'ajout, on refuse la modification, et le refus
-- est tenu à deux endroits : aucun droit UPDATE accordé, et un déclencheur
-- qui lève, pour que la règle survive à un droit réaccordé par erreur.
-- Corriger, ici, c'est ajouter une seconde preuve, pas réécrire la première.
create table if not exists proof_of_delivery (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null references agencies on delete cascade,
  office_id          uuid references offices on delete set null,
  delivery_id        uuid not null references deliveries on delete cascade,
  recipient_name     text,
  recipient_id_number text,
  signature_path     text,
  photo_path         text,
  signed_at          timestamptz not null default now(),
  gps_lat            numeric(9,6),
  gps_lng            numeric(9,6),
  note               text,
  created_at         timestamptz not null default now()
);
create index if not exists proof_of_delivery_delivery on proof_of_delivery (delivery_id);

comment on table proof_of_delivery is
  'La preuve de livraison, en ajout seul. Une signature qu''on peut réécrire ne prouve rien : la table refuse toute mise à jour, par absence de droit et par déclencheur. Corriger une preuve, c''est en ajouter une seconde.';

create or replace function proof_of_delivery_immutable()
returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'une preuve de livraison ne se modifie pas : ajoutez-en une seconde'
    using errcode = 'P0001';
end $$;

revoke all on function proof_of_delivery_immutable() from public, anon, authenticated;

drop trigger if exists proof_of_delivery_office on proof_of_delivery;
create trigger proof_of_delivery_office before insert on proof_of_delivery
  for each row execute function logistique_fill_office('deliveries', 'delivery_id');

drop trigger if exists proof_of_delivery_no_update on proof_of_delivery;
create trigger proof_of_delivery_no_update before update on proof_of_delivery
  for each row execute function proof_of_delivery_immutable();

-- ------------------------------------------------------------------
-- 7 · Les coûts d'une cargaison
-- ------------------------------------------------------------------

create table if not exists shipment_costs (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null references agencies on delete cascade,
  office_id          uuid references offices on delete set null,
  shipment_id        uuid not null references shipments on delete cascade,
  lot_id             uuid references shipment_lots on delete cascade,
  kind               text not null check (kind in (
                       'FRET','DOUANE','PORT','MANUTENTION','STOCKAGE','SURESTARIES',
                       'TRANSPORT','ASSURANCE','COMMISSIONNAIRE','DOCUMENT','LIVRAISON','AUTRE')),
  supplier_name      text,
  -- Identifiant nu, sans clé étrangère : le répertoire des fournisseurs est
  -- construit en parallèle par un autre module. Poser la contrainte
  -- maintenant ferait échouer cette migration sur une base où la table
  -- n'existe pas encore. Le lien se posera quand le répertoire sera là.
  supplier_id        uuid,
  amount             numeric(14,2) not null,
  currency           char(3) not null default 'TND',
  -- Taux vers la devise de l'agence au moment de la dépense, comme pour les
  -- règlements (0005) : un taux relu plus tard n'est plus le bon.
  fx_rate            numeric(14,6) not null default 1,
  amount_base        numeric(14,2) generated always as (round(amount * fx_rate, 2)) stored,
  billable_to_client boolean not null default true,
  invoice_reference  text,
  incurred_on        date,
  note               text,
  created_by         uuid references profiles on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists shipment_costs_ship on shipment_costs (shipment_id, kind);
create index if not exists shipment_costs_lot on shipment_costs (lot_id);

comment on column shipment_costs.supplier_id is
  'Identifiant nu, volontairement sans clé étrangère : le répertoire des fournisseurs est un autre module, en construction. Le lien sera posé quand la table existera.';
comment on column shipment_costs.amount_base is
  'Le coût dans la devise de l''agence, calculé au taux du jour de la dépense. Sans lui, additionner des dinars et des dollars donne un total qui ne veut rien dire.';
comment on column shipment_costs.billable_to_client is
  'Refacturable au client ou à la charge de l''agence. C''est cette colonne qui sépare la marge du chiffre d''affaires.';

drop trigger if exists shipment_costs_office on shipment_costs;
create trigger shipment_costs_office before insert or update on shipment_costs
  for each row execute function logistique_fill_office('shipments', 'shipment_id');

-- ------------------------------------------------------------------
-- 8 · Le suivi : on complète shipment_events, on ne la double pas
-- ------------------------------------------------------------------
--
-- POURQUOI PAS DE SECONDE TABLE.
--
-- `shipment_events` existe depuis 0004 et porte déjà les étapes du métier.
-- Créer une table `shipment_tracking_events` à côté produirait deux journaux
-- pour un seul objet : deux dates d'arrivée, deux endroits où chercher, et la
-- certitude qu'un écran affichera l'un pendant qu'un autre affichera l'autre.
-- C'est la même faute que trois compteurs de stationnement confondus en un,
-- prise dans l'autre sens. La fiche cargaison lit une seule frise, et elle
-- doit rester une seule table. On ajoute donc trois colonnes :
--
--   event_type · l'étape normalisée, celle qu'un transporteur ou un EDI sait
--                produire, à côté du `stage` interne déjà en place ;
--   source     · d'où vient l'information. Un suivi qui ne dit pas s'il a été
--                saisi à la main ou reçu du transporteur ne vaut rien le jour
--                où le client conteste une date ;
--   event_at   · QUAND la chose s'est passée, distinct de `at` qui dit quand
--                on l'a écrite. Un événement reçu avec deux jours de retard
--                ne doit pas se ranger au mauvais endroit dans la frise.

alter table shipment_events add column if not exists event_type text;
alter table shipment_events add column if not exists source     text;
alter table shipment_events add column if not exists event_at   timestamptz;

alter table shipment_events drop constraint if exists shipment_events_event_type_check;
alter table shipment_events add constraint shipment_events_event_type_check
  check (event_type is null or event_type in (
    'PRIS_EN_CHARGE','RECU_ENTREPOT','DOUANE_EXPORT','PARTI','EN_TRANSIT',
    'TRANSBORDEMENT','ARRIVE','DOUANE_IMPORT','INSPECTION','DEDOUANE',
    'EN_LIVRAISON','LIVRE')) not valid;

alter table shipment_events drop constraint if exists shipment_events_source_check;
alter table shipment_events add constraint shipment_events_source_check
  check (source is null or source in ('manuel','transporteur','api','edi','ttn')) not valid;

comment on column shipment_events.event_type is
  'L''étape normalisée du suivi, à côté du `stage` interne. Une seule table de suivi, volontairement : deux journaux pour une cargaison donnent deux dates d''arrivée et deux écrans qui se contredisent.';
comment on column shipment_events.event_at is
  'Quand l''événement a eu lieu, distinct de `at` qui dit quand on l''a écrit. Un suivi reçu avec deux jours de retard doit se ranger à sa date, pas à celle de la saisie.';
comment on column shipment_events.source is
  'Manuel, transporteur, API, EDI ou TTN. Un suivi qui ne dit pas d''où il vient ne se défend pas le jour où le client conteste une date.';

create index if not exists shipment_events_tracking
  on shipment_events (shipment_id, event_at desc);

-- Un événement de suivi sans date d'événement se range à sa date d'écriture,
-- et sans source déclarée il a été saisi à la main. Les deux replis sont ce
-- que l'agent aurait tapé de toute façon.
create or replace function shipment_events_tracking_defaults()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.event_type is null then return new; end if;
  if new.event_at is null then new.event_at := coalesce(new.at, now()); end if;
  if new.source is null then new.source := 'manuel'; end if;
  return new;
end $$;

revoke all on function shipment_events_tracking_defaults() from public, anon, authenticated;

drop trigger if exists shipment_events_tracking_defaults on shipment_events;
create trigger shipment_events_tracking_defaults before insert or update on shipment_events
  for each row execute function shipment_events_tracking_defaults();

-- ------------------------------------------------------------------
-- 9 · Les coûts, la marge, la tournée et la veille
-- ------------------------------------------------------------------

-- Le total des coûts d'une cargaison, par nature. Tout est ramené à la devise
-- de l'agence : additionner des dinars et des dollars donne un nombre qui ne
-- veut rien dire, et c'est pourtant ce qu'un tableur fait tous les jours.
create or replace function shipment_cost_summary(p_shipment uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_agency   uuid;
  v_currency char(3);
  result     jsonb;
begin
  select agency_id into v_agency from shipments where id = p_shipment;
  if v_agency is null then return null; end if;
  -- Une fonction SECURITY DEFINER traverse les politiques : sans ce test, un
  -- compte de l'agence A lirait les coûts de l'agence B en passant son
  -- identifiant. C'est la faute déjà payée une fois (voir 0015).
  if v_agency is distinct from auth_agency_id() then
    raise exception 'interdit' using errcode = 'P0001';
  end if;

  select currency into v_currency from agencies where id = v_agency;

  select jsonb_build_object(
    'shipment', p_shipment,
    'currency', v_currency,
    'lignes', coalesce(count(*), 0),
    -- Par nature : c'est la seule vue qui montre où part l'argent.
    'par_nature', coalesce((
      select jsonb_object_agg(k, m) from (
        select kind as k, round(sum(amount_base), 2) as m
        from shipment_costs where shipment_id = p_shipment
        group by kind
      ) g
    ), '{}'::jsonb),
    'total_base', coalesce(round(sum(amount_base), 2), 0),
    -- Ce qui repart chez le client, et ce qui reste à la charge de l'agence.
    'total_refacturable', coalesce(round(sum(amount_base) filter (where billable_to_client), 2), 0),
    'total_non_refacturable', coalesce(round(sum(amount_base) filter (where not billable_to_client), 2), 0)
  ) into result
  from shipment_costs where shipment_id = p_shipment;

  return result;
end $$;

comment on function shipment_cost_summary(uuid) is
  'Les coûts d''une cargaison par nature, en devise de l''agence. Le total refacturable est isolé : c''est lui qui sépare la marge du chiffre d''affaires.';

-- La marge d'une cargaison. Le facturé vient des règlements, et de la table
-- des factures quand elle existe : un autre module la construit en parallèle,
-- donc on teste sa présence au lieu de la supposer.
create or replace function shipment_pnl(p_shipment uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_agency    uuid;
  v_currency  char(3);
  v_facture   numeric := 0;
  v_encaisse  numeric := 0;
  v_factures  numeric := 0;
  v_col       text;
  v_costs     jsonb;
  v_total     numeric;
  v_marge     numeric;
  v_invoices  boolean := false;
begin
  select agency_id into v_agency from shipments where id = p_shipment;
  if v_agency is null then return null; end if;
  if v_agency is distinct from auth_agency_id() then
    raise exception 'interdit' using errcode = 'P0001';
  end if;
  select currency into v_currency from agencies where id = v_agency;

  -- Les débours sont encaissés pour être reversés : ce n'est pas du revenu,
  -- et les compter gonflerait la marge d'un montant qui ne reste jamais.
  select
    coalesce(sum(amount * coalesce(fx_rate, 1)), 0),
    coalesce(sum(amount * coalesce(fx_rate, 1)) filter (where state = 'regle'), 0)
  into v_facture, v_encaisse
  from payments
  where shipment_id = p_shipment and kind not in ('debours','remboursement');

  -- La table des factures, si elle est déjà là. On ne suppose pas son nom de
  -- colonne : on prend la première qui ressemble à un montant, et on ne
  -- compte rien plutôt que de compter faux.
  if to_regclass('public.invoices') is not null then
    begin
      select c.column_name::text into v_col
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'invoices'
        and c.column_name::text in ('amount_base','total_ttc','total_amount','total','amount')
      order by array_position(
        array['amount_base','total_ttc','total_amount','total','amount'], c.column_name::text)
      limit 1;

      if v_col is not null and exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = 'invoices'
          and c.column_name::text = 'shipment_id')
      then
        -- Un brouillon n'est pas facturé, une facture annulée non plus. On
        -- écarte les deux quand la table porte un état, sans supposer son
        -- vocabulaire : on liste les mots qui veulent dire « ça ne compte pas ».
        if exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'invoices'
            and c.column_name::text = 'status')
        then
          execute format($q$
            select coalesce(sum(%I), 0) from public.invoices
            where shipment_id = $1
              and coalesce(status, '') not in
                  ('brouillon','draft','annulee','annule','cancelled','void')
          $q$, v_col) into v_factures using p_shipment;
        else
          execute format(
            'select coalesce(sum(%I), 0) from public.invoices where shipment_id = $1', v_col)
            into v_factures using p_shipment;
        end if;
        v_invoices := true;
      end if;
    exception when others then
      -- Une table homonyme de forme inattendue ne doit pas faire tomber la
      -- marge : on le dit, et on s'en tient aux règlements.
      v_factures := 0;
      v_invoices := false;
    end;
  end if;

  v_costs := shipment_cost_summary(p_shipment);
  v_total := coalesce((v_costs->>'total_base')::numeric, 0);
  v_facture := v_facture + coalesce(v_factures, 0);
  v_marge := v_facture - v_total;

  return jsonb_build_object(
    'shipment', p_shipment,
    'currency', v_currency,
    'facture', round(v_facture, 2),
    'encaisse', round(v_encaisse, 2),
    'reste_a_encaisser', round(greatest(v_facture - v_encaisse, 0), 2),
    'couts', round(v_total, 2),
    'couts_par_nature', v_costs->'par_nature',
    'marge', round(v_marge, 2),
    -- Une marge en pourcentage sur un facturé nul n'existe pas : on rend null,
    -- pas zéro. Zéro se lirait comme « on ne gagne rien », ce qui est faux.
    'marge_pct', case when v_facture > 0 then round(v_marge * 100 / v_facture, 2) end,
    'source_factures', v_invoices);
end $$;

comment on function shipment_pnl(uuid) is
  'Facturé, encaissé, coûts, marge. Le facturé vient des règlements et, quand la table existe, des factures. Les débours en sont exclus : encaissés pour être reversés, ils ne sont pas du revenu.';

-- La tournée du jour, pour un bureau. C'est la feuille de route qu'on donne au
-- chauffeur le matin : l'adresse, à qui s'annoncer, et où en est la livraison.
create or replace function delivery_plan(p_office uuid, p_day date default current_date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_agency uuid;
begin
  select agency_id into v_agency from offices where id = p_office;
  if v_agency is null then return '[]'::jsonb; end if;
  -- Le bureau doit être celui de l'agence connectée, et dans son périmètre :
  -- un agent de Sfax ne consulte pas la tournée de Tunis.
  if v_agency is distinct from auth_agency_id() or not auth_sees_office(p_office) then
    raise exception 'interdit' using errcode = 'P0001';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id,
      'status', d.status,
      'planned_at', d.planned_at,
      'delivered_at', d.delivered_at,
      'address', d.address,
      'contact_name', d.contact_name,
      'contact_phone', d.contact_phone,
      'driver_name', d.driver_name,
      'driver_phone', d.driver_phone,
      'vehicle', d.vehicle,
      'failure_reason', d.failure_reason,
      'client', case when cl.id is not null
                     then trim(coalesce(cl.first_name, '') || ' ' || coalesce(cl.last_name, '')) end,
      'client_id', d.client_id,
      'shipment_id', d.shipment_id,
      'reference', s.reference,
      -- La preuve, quand elle existe : c'est ce qui clôt la livraison.
      'proof', (select jsonb_build_object('signed_at', p.signed_at, 'recipient_name', p.recipient_name)
                from proof_of_delivery p where p.delivery_id = d.id
                order by p.signed_at desc limit 1)
    ) order by d.planned_at nulls last)
    from deliveries d
    left join clients cl on cl.id = d.client_id
    left join shipments s on s.id = d.shipment_id
    where d.agency_id = v_agency
      and d.office_id = p_office
      -- Ce qui est prévu ce jour-là, plus ce qui a été livré ce jour-là : la
      -- feuille du matin et le compte rendu du soir sont le même écran.
      and (d.planned_at::date = p_day or d.delivered_at::date = p_day)
  ), '[]'::jsonb);
end $$;

comment on function delivery_plan(uuid, date) is
  'La tournée du jour d''un bureau : adresse, contact, état, et la preuve quand elle existe.';

-- LA VEILLE DES ARRIVÉES. C'est l'écran qui fait gagner de l'argent.
--
-- Trois listes, dans l'ordre de l'urgence : ce qui arrive, ce dont les jours
-- francs se terminent, et ce qui coûte déjà. Les montants viennent de
-- `shipment_counters` (0029) : on ne recalcule rien ici, sinon deux chiffres
-- finissent par exister.
create or replace function arrival_watch(p_agency uuid, p_days int default 7)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_days int := greatest(coalesce(p_days, 7), 0);
begin
  if p_agency is distinct from auth_agency_id() then
    raise exception 'interdit' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'agency', p_agency,
    'days', v_days,
    -- 1. Ce qui arrive. On regarde l'avis d'arrivée d'abord, l'ETA de la
    -- cargaison ensuite : l'avis est la source qui fait foi.
    'arrivees', coalesce((
      select jsonb_agg(x order by x->>'eta')
      from (
        select jsonb_build_object(
          'shipment_id', s.id, 'reference', s.reference,
          'dest_port', s.dest_port, 'carrier', coalesce(n.carrier_name, s.carrier),
          'eta', coalesce(n.estimated_arrival::date, s.eta),
          'notice_id', n.id,
          'arrival_location', n.arrival_location) as x
        from shipments s
        left join lateral (
          select * from arrival_notices an where an.shipment_id = s.id
          order by an.received_at desc nulls last limit 1
        ) n on true
        where s.agency_id = p_agency
          and s.status = 'en_cours'
          and s.arrived_at is null
          and n.actual_arrival is null
          and coalesce(n.estimated_arrival::date, s.eta)
              between current_date and current_date + v_days
      ) t
    ), '[]'::jsonb),
    -- 2. Les jours francs qui se terminent. C'est la seule liste qu'on regarde
    -- avant midi : après, la journée est facturée.
    'francs_qui_finissent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'notice_id', n.id, 'shipment_id', s.id, 'reference', s.reference,
        'storage_start_date', n.storage_start_date,
        'free_days', n.free_days,
        'demurrage_start_date', n.demurrage_start_date,
        'jours_restants', n.demurrage_start_date - current_date)
        order by n.demurrage_start_date)
      from arrival_notices n
      join shipments s on s.id = n.shipment_id
      where n.agency_id = p_agency
        and n.demurrage_start_date is not null
        and n.demurrage_start_date between current_date and current_date + v_days
        and s.goods_removed_at is null
    ), '[]'::jsonb),
    -- 3. Ce qui coûte déjà. Les compteurs de 0029 font le chiffrage, on ne
    -- refait pas la règle : un deuxième calcul finirait par diverger.
    'en_surestaries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'shipment_id', s.id, 'reference', s.reference, 'dest_port', s.dest_port,
        'compteurs', c.j)
        order by s.reference)
      from shipments s
      cross join lateral (select shipment_counters(s.id) as j) c
      where s.agency_id = p_agency
        and s.discharged_at is not null
        and exists (
          select 1 from jsonb_array_elements(c.j) e
          where e->>'status' = 'en_depassement')
    ), '[]'::jsonb));
end $$;

comment on function arrival_watch(uuid, int) is
  'La veille des arrivées : ce qui arrive dans les N jours, ce dont les jours francs se terminent, et ce qui est déjà en dépassement. Les montants viennent de shipment_counters (0029), jamais d''un second calcul.';

-- ------------------------------------------------------------------
-- 10 · Le cloisonnement
-- ------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'arrival_notices','origin_certificates','air_waybills','road_shipments',
    'warehouses','warehouse_movements','deliveries','proof_of_delivery',
    'shipment_costs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'arrival_notices','origin_certificates','air_waybills','road_shipments',
    'warehouses','warehouse_movements','deliveries','proof_of_delivery',
    'shipment_costs'
  ] loop
    execute format('drop policy if exists %1$s_select on %1$I', t);
    execute format('drop policy if exists %1$s_insert on %1$I', t);
    execute format('drop policy if exists %1$s_update on %1$I', t);
    execute format('drop policy if exists %1$s_delete on %1$I', t);
    execute format('drop policy if exists %1$s_platform_read on %1$I', t);

    -- Lecture : son agence, et son bureau. Un agent d'un bureau ne voit pas la
    -- tournée ni l'entrepôt d'un autre.
    execute format($f$
      create policy %1$s_select on %1$I for select to authenticated
        using (agency_id = auth_agency_id() and auth_sees_office(office_id))
    $f$, t);
    execute format($f$
      create policy %1$s_insert on %1$I for insert to authenticated
        with check (agency_id = auth_agency_id() and auth_can('shipment:write'))
    $f$, t);
    -- Aucune politique de suppression : rien ne s'efface dans ce module.
    -- La vue support de la plateforme lit, et ne fait que lire.
    execute format($f$
      create policy %1$s_platform_read on %1$I for select to authenticated
        using (is_platform_admin())
    $f$, t);
  end loop;
end $$;

-- La mise à jour, partout SAUF sur la preuve de livraison.
do $$
declare t text;
begin
  foreach t in array array[
    'arrival_notices','origin_certificates','air_waybills','road_shipments',
    'warehouses','warehouse_movements','deliveries','shipment_costs'
  ] loop
    execute format($f$
      create policy %1$s_update on %1$I for update to authenticated
        using (agency_id = auth_agency_id() and auth_sees_office(office_id)
               and auth_can('shipment:write'))
        with check (agency_id = auth_agency_id())
    $f$, t);
  end loop;
end $$;

-- Les droits de table. La migration 0015 a posé un `alter default privileges`
-- qui accorde aussi DELETE à toute table nouvelle : on le reprend ici, table
-- par table. Rien ne s'efface dans ce module.
grant select, insert, update on
  arrival_notices, origin_certificates, air_waybills, road_shipments,
  warehouses, warehouse_movements, deliveries, shipment_costs
  to authenticated;

revoke delete on
  arrival_notices, origin_certificates, air_waybills, road_shipments,
  warehouses, warehouse_movements, deliveries, shipment_costs, proof_of_delivery
  from authenticated;

-- La preuve : on ajoute et on lit. Jamais on ne modifie.
grant select, insert on proof_of_delivery to authenticated;
revoke update on proof_of_delivery from authenticated;

revoke all on
  arrival_notices, origin_certificates, air_waybills, road_shipments,
  warehouses, warehouse_movements, deliveries, proof_of_delivery, shipment_costs
  from anon;

grant all on
  arrival_notices, origin_certificates, air_waybills, road_shipments,
  warehouses, warehouse_movements, deliveries, shipment_costs
  to service_role;
-- Le service garde tous ses droits par convention, mais le déclencheur
-- d'immuabilité s'applique à lui aussi : personne ne réécrit une signature.
grant all on proof_of_delivery to service_role;

-- PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction créée. C'est le trou
-- déjà payé une fois (voir 0015) : on le referme à chaque fonction.
do $$
declare f text;
begin
  foreach f in array array[
    'air_chargeable_weight(numeric, numeric)',
    'origin_certificate_warning(text, text)',
    'shipment_cost_summary(uuid)',
    'shipment_pnl(uuid)',
    'delivery_plan(uuid, date)',
    'arrival_watch(uuid, int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
