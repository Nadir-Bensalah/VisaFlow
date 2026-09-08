-- 0029 · Le fret réel : trois tronçons, trois compteurs, deux connaissements.
--
-- Le modèle de départ supposait un trajet d'un seul tenant, un seul compteur de
-- stationnement et un seul connaissement. L'étude de marché établit que les
-- trois hypothèses sont fausses, et chacune coûte de l'argent à l'agence.
--
-- 1. IL N'EXISTE AUCUNE LIGNE DIRECTE CHINE VERS RADÈS. La cause est physique :
--    le tirant d'eau des postes porte-conteneurs de Radès est de -8,8 m, aucun
--    grand porte-conteneurs asiatique ne peut y toucher. Les onze lignes
--    régulières viennent toutes de Méditerranée (Malte, Gioia Tauro, Valence,
--    Algésiras, Le Pirée, Marseille, Gênes, Barcelone). Toute expédition
--    comporte donc AU MOINS un transbordement, et le retard le plus fréquent
--    n'est pas sur le long-courrier : il est sur le raccordement au feeder.
--    Un « transit time » unique est un mensonge. D'où une table de tronçons.
--
-- 2. TROIS COMPTEURS, JAMAIS UN. Surestaries, détention et magasinage sont
--    trois factures, trois débiteurs, trois points de départ différents. Les
--    confondre est la première cause de perte d'argent des importateurs.
--
-- 3. DEUX CONNAISSEMENTS, JAMAIS UN. Le Master B/L est émis par l'armateur au
--    nom du groupeur ; le House B/L est émis par le groupeur au client final.
--    L'importateur n'a JAMAIS le Master B/L.
--
-- Ce que cette migration ne fait PAS : livrer des tarifs. Les tarifs tunisiens
-- de magasinage et de surestaries ne sont pas publics (site STAM en erreur,
-- barème portuaire en PDF scanné, pages tarifaires des armateurs en 403). Ce
-- sont donc des paramètres saisis par l'agence, par armateur, par port et par
-- type de conteneur, avec historique de validité. Les RÈGLES de calcul, elles,
-- sont stables : c'est tout ce qu'on code ici.

-- ------------------------------------------------------------------
-- 1 · Les tronçons
-- ------------------------------------------------------------------

create table if not exists shipment_legs (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  shipment_id uuid not null references shipments on delete cascade,
  -- L'ordre du trajet. 1 = le long-courrier, 2 = le feeder, etc.
  seq         int  not null check (seq > 0),
  mode        text not null check (mode in ('maritime','aerien','routier','ferroviaire')),
  -- Le lieu, et son code UN/LOCODE quand on l'a. Le libellé seul ne suffit pas
  -- pour rapprocher deux sources ; le code seul est illisible pour l'agent.
  from_place  text not null,
  from_code   text,
  to_place    text not null,
  to_code     text,
  carrier     text,
  -- Le navire, le numéro de vol, l'immatriculation du camion : même colonne,
  -- le mode dit ce que c'est.
  conveyance  text,
  voyage      text,
  etd         date,
  eta         date,
  atd         timestamptz,
  ata         timestamptz,
  note        text,
  unique (shipment_id, seq)
);
create index if not exists shipment_legs_ship on shipment_legs (shipment_id, seq);

comment on table shipment_legs is
  'Un tronçon de transport. Une expédition Chine vers Radès en compte au moins deux : le long-courrier jusqu''au hub méditerranéen, puis le feeder. L''attente au hub se déduit de l''écart entre l''arrivée d''un tronçon et le départ du suivant.';

-- Le trajet complet, avec ce qui compte vraiment : l'attente au hub. C'est elle
-- qui explique l'écart des durées annoncées, de 21 à 54 jours selon les sources.
create or replace function shipment_route(p_shipment uuid)
returns jsonb
language sql stable
set search_path = public
as $$
  with l as (
    select
      seq, mode, from_place, from_code, to_place, to_code,
      carrier, conveyance, voyage, etd, eta, atd, ata,
      -- Le départ effectif du tronçon suivant, pour mesurer l'attente au hub.
      lead(coalesce(atd::date, etd)) over (order by seq) as next_departure,
      coalesce(ata::date, eta) as arrival
    from shipment_legs
    where shipment_id = p_shipment
  )
  select jsonb_build_object(
    'legs', coalesce(jsonb_agg(jsonb_build_object(
      'seq', seq, 'mode', mode,
      'from', jsonb_build_object('place', from_place, 'code', from_code),
      'to',   jsonb_build_object('place', to_place,   'code', to_code),
      'carrier', carrier, 'conveyance', conveyance, 'voyage', voyage,
      'etd', etd, 'eta', eta, 'atd', atd, 'ata', ata,
      'days', case when coalesce(atd::date, etd) is not null and arrival is not null
                   then arrival - coalesce(atd::date, etd) end,
      -- L'attente au hub : entre l'arrivée de ce tronçon et le départ du suivant.
      'hub_wait_days', case when arrival is not null and next_departure is not null
                            then greatest(0, next_departure - arrival) end
    ) order by seq), '[]'::jsonb),
    'legs_count', count(*),
    'transship_count', greatest(0, count(*)::int - 1)
  )
  from l
$$;

-- Un trajet qui prétend aller de Chine à Radès d'un seul tenant est faux. On ne
-- pose pas une contrainte dure (elle rejetterait des saisies en cours), on rend
-- un avis que l'interface affiche : c'est un signal, pas un mur.
create or replace function route_warning(p_shipment uuid)
returns text
language plpgsql stable
set search_path = public
as $$
declare
  s record;
  n int;
begin
  select * into s from shipments where id = p_shipment;
  if not found then return null; end if;
  select count(*) into n from shipment_legs where shipment_id = p_shipment;

  if s.mode in ('maritime_fcl','maritime_lcl') then
    if n = 0 then
      return 'aucun_troncon';
    end if;
    -- Aucune ligne directe ne dessert Radès depuis l'Asie : le tirant d'eau de
    -- -8,8 m l'interdit physiquement. Un seul tronçon est donc impossible.
    if n = 1 and s.country_from is not null and s.country_from <> 'TN'
       and coalesce(s.dest_port, '') ilike '%rad%' then
      return 'transbordement_manquant';
    end if;
  end if;
  return null;
end $$;

-- ------------------------------------------------------------------
-- 2 · Les trois compteurs, et leurs tarifs saisis
-- ------------------------------------------------------------------
--
--   Surestaries · l'armateur · conteneur RESTÉ dans le terminal
--                · départ : fin des jours francs après déchargement
--   Détention   · l'armateur · conteneur SORTI et non restitué
--                · départ : sortie du terminal
--   Magasinage  · le manutentionnaire (STAM, GMS) · stationnement de la
--                MARCHANDISE · départ : fin du délai franc portuaire
--
-- Trois factures, trois compteurs, trois débiteurs.

create table if not exists demurrage_tariffs (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  kind           text not null check (kind in ('surestaries','detention','magasinage')),
  -- L'armateur pour les deux premiers, le manutentionnaire pour le troisième.
  billed_by      text not null,
  port           text not null,
  container_type text not null check (container_type in ('20','40','40HC','45HC','LCL')),
  free_days      int  not null check (free_days >= 0),
  currency       char(3) not null default 'TND',
  -- Paliers progressifs, tels que les armateurs les pratiquent : le tarif
  -- augmente à partir du 3e ou 4e jour de dépassement. Les jours sont comptés
  -- APRÈS les jours francs. to_day nul = dernier palier, sans borne.
  --   [{"from_day":1,"to_day":3,"rate":45},{"from_day":4,"to_day":null,"rate":90}]
  tiers          jsonb not null default '[]'::jsonb,
  -- Majoration de congestion, constatée de 30 à 50 % en période chargée.
  -- Radès : 6 jours d'attente navire, 63 % des expéditions en retard.
  surcharge_pct  numeric(5,2) not null default 0,
  valid_from     date not null default current_date,
  valid_to       date,
  note           text,
  created_at     timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
create index if not exists demurrage_tariffs_lookup
  on demurrage_tariffs (agency_id, kind, port, container_type, valid_from desc);

comment on table demurrage_tariffs is
  'Tarifs et jours francs, SAISIS par l''agence. Aucune valeur par défaut n''est livrée : les barèmes tunisiens ne sont pas publics (site STAM en erreur de base de données, arrêté portuaire du 18 juillet 2017 en PDF scanné, pages tarifaires des armateurs en 403). Livrer un chiffre inventé ferait facturer faux.';

-- Les jalons qui font partir les compteurs. Ils étaient absents : il n'y avait
-- que arrived_at et cleared_at, ce qui ne permet de calculer qu'un compteur sur
-- trois, et encore, approximativement.
alter table shipments add column if not exists discharged_at   timestamptz;
alter table shipments add column if not exists gate_out_at     timestamptz;
alter table shipments add column if not exists container_returned_at timestamptz;
alter table shipments add column if not exists goods_removed_at timestamptz;
alter table shipments add column if not exists containers_count int not null default 1;
alter table shipments add column if not exists container_type  text
  check (container_type is null or container_type in ('20','40','40HC','45HC','LCL'));
-- Le dépotage du conteneur : le jalon qui met fin à la solidarité entre lots.
alter table shipments add column if not exists stripped_at     timestamptz;
-- Le manutentionnaire facture le magasinage, pas l'armateur.
alter table shipments add column if not exists handler         text;
alter table shipments add column if not exists carrier         text;

comment on column shipments.discharged_at is 'Déchargement du navire. Point de départ des jours francs de surestaries.';
comment on column shipments.gate_out_at is 'Sortie du conteneur du terminal. Point de départ de la détention.';
comment on column shipments.container_returned_at is 'Restitution du conteneur vide à l''armateur. Arrête la détention.';
comment on column shipments.stripped_at is 'Dépotage du conteneur. Tant qu''il n''a pas eu lieu, un lot bloqué bloque tous les autres.';

-- Le tarif applicable à une date : le dernier entré en vigueur, non expiré.
create or replace function tariff_for(
  p_agency uuid, p_kind text, p_port text, p_container text, p_on date
) returns demurrage_tariffs
language sql stable
set search_path = public
as $$
  select *
  from demurrage_tariffs
  where agency_id = p_agency
    and kind = p_kind
    and port = p_port
    and container_type = p_container
    and valid_from <= p_on
    and (valid_to is null or valid_to >= p_on)
  order by valid_from desc
  limit 1
$$;

-- Le montant d'un dépassement, paliers compris. Formule constante du métier :
-- jours de dépassement x tarif journalier x nombre de conteneurs, sauf que le
-- tarif journalier n'est pas constant : il monte par paliers.
create or replace function tier_amount(p_tiers jsonb, p_days int)
returns numeric
language sql immutable
set search_path = public
as $$
  select coalesce(sum(
    -- Nombre de jours du dépassement qui tombent dans ce palier.
    greatest(0,
      least(p_days, coalesce((t->>'to_day')::int, p_days))
      - (t->>'from_day')::int + 1
    ) * (t->>'rate')::numeric
  ), 0)
  from jsonb_array_elements(coalesce(p_tiers, '[]'::jsonb)) t
  where p_days >= (t->>'from_day')::int
$$;

comment on function tier_amount(jsonb, int) is
  'Somme progressive par paliers. Un dépassement de 5 jours avec [1-3 à 45, 4+ à 90] fait 3x45 + 2x90, pas 5x90.';

-- Les trois compteurs d'une expédition, chacun avec sa propre horloge.
create or replace function shipment_counters(p_shipment uuid)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  s        record;
  ct       text;
  res      jsonb := '[]'::jsonb;
  k        text;
  t        demurrage_tariffs;
  start_at date;
  stop_at  date;
  elapsed  int;
  overdue  int;
  amount   numeric;
  hors_periode boolean;
begin
  select * into s from shipments where id = p_shipment;
  if not found then return '[]'::jsonb; end if;
  ct := coalesce(s.container_type, case when s.mode = 'maritime_lcl' then 'LCL' else '40' end);

  foreach k in array array['surestaries','detention','magasinage'] loop
    -- Chaque compteur a son propre départ et son propre arrêt. C'est tout
    -- l'enjeu : les confondre fait facturer le mauvais jour au mauvais débiteur.
    if k = 'surestaries' then
      -- Le conteneur est resté dans le terminal : du déchargement à la sortie.
      start_at := s.discharged_at::date;
      stop_at  := coalesce(s.gate_out_at::date, current_date);
    elsif k = 'detention' then
      -- Le conteneur est sorti et non restitué : de la sortie à la restitution.
      start_at := s.gate_out_at::date;
      stop_at  := coalesce(s.container_returned_at::date, current_date);
    else
      -- La marchandise stationne : de l'arrivée à l'enlèvement.
      start_at := coalesce(s.discharged_at, s.arrived_at)::date;
      stop_at  := coalesce(s.goods_removed_at::date, s.delivered_at::date, current_date);
    end if;

    if start_at is null then
      res := res || jsonb_build_object('kind', k, 'status', 'non_demarre');
      continue;
    end if;

    t := tariff_for(s.agency_id, k, coalesce(s.dest_port, ''), ct, start_at);
    hors_periode := false;
    if t.id is null then
      -- Le compteur a démarré avant que l'agence n'ait saisi son barème : c'est
      -- le cas de tout conteneur déjà au port le jour de la mise en service.
      -- Plutôt que de ne rien chiffrer, on prend le plus ancien barème connu et
      -- on le DIT. Un montant approché, signalé comme tel, vaut mieux qu'une
      -- case vide devant un conteneur qui coûte cent dinars par jour.
      select * into t from demurrage_tariffs
       where agency_id = s.agency_id and kind = k
         and port = coalesce(s.dest_port, '') and container_type = ct
       order by valid_from asc limit 1;
      hors_periode := t.id is not null;
    end if;
    elapsed := greatest(0, stop_at - start_at);

    if t.id is null then
      -- Sans tarif saisi, on montre l'horloge mais on ne chiffre pas. Un zéro
      -- afficherait une facture nulle là où il y a peut-être des milliers de
      -- dinars : mieux vaut dire que le barème manque.
      res := res || jsonb_build_object(
        'kind', k, 'status', 'tarif_absent', 'container_type', ct,
        'start', start_at, 'stop', stop_at, 'elapsed_days', elapsed,
        'billed_by', case when k = 'magasinage' then s.handler else s.carrier end);
      continue;
    end if;

    overdue := greatest(0, elapsed - t.free_days);
    amount  := tier_amount(t.tiers, overdue)
               * (case when k = 'magasinage' then 1 else s.containers_count end)
               * (1 + t.surcharge_pct / 100);

    res := res || jsonb_build_object(
      'kind', k,
      'status', case when overdue > 0 then 'en_depassement' else 'dans_les_francs' end,
      'billed_by', coalesce(t.billed_by, case when k = 'magasinage' then s.handler else s.carrier end),
      'container_type', ct,
      'start', start_at, 'stop', stop_at,
      'elapsed_days', elapsed, 'free_days', t.free_days, 'overdue_days', overdue,
      'containers', case when k = 'magasinage' then 1 else s.containers_count end,
      'surcharge_pct', t.surcharge_pct,
      'tarif_hors_periode', hors_periode,
      'amount', round(amount, 2), 'currency', t.currency,
      'running', (stop_at = current_date));
  end loop;

  return res;
end $$;

-- ------------------------------------------------------------------
-- 3 · Les connaissements : Master et House
-- ------------------------------------------------------------------

create table if not exists bills_of_lading (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  shipment_id  uuid not null references shipments on delete cascade,
  kind         text not null check (kind in ('master','house')),
  -- Un House B/L descend d'un Master B/L. Un Master n'a pas de parent.
  parent_id    uuid references bills_of_lading on delete cascade,
  -- Un House B/L est émis au client final : il pointe donc un lot.
  lot_id       uuid references shipment_lots on delete set null,
  number       text not null,
  issuer       text,
  shipper      text,
  consignee    text,
  notify       text,
  issued_at    date,
  -- Trois manières de libérer la marchandise, et elles ne se valent pas.
  release_type text check (release_type in ('original_endosse','telex_release','express_release')),
  released_at  timestamptz,
  freight_terms text check (freight_terms in ('prepaid','collect')),
  note         text,
  created_at   timestamptz not null default now(),
  unique (agency_id, number),
  -- La règle du métier, tenue par la base : un House descend d'un Master, un
  -- Master ne descend de rien.
  check ((kind = 'house' and parent_id is not null)
      or (kind = 'master' and parent_id is null))
);
create index if not exists bills_of_lading_ship on bills_of_lading (shipment_id, kind);
create index if not exists bills_of_lading_parent on bills_of_lading (parent_id);

comment on table bills_of_lading is
  'Deux connaissements, jamais un. Le Master B/L est émis par l''armateur au nom du groupeur ; le House B/L par le groupeur au client final. L''importateur n''a JAMAIS le Master B/L : le lui promettre est une faute.';

-- ------------------------------------------------------------------
-- 4 · La solidarité de fait entre lots d'un même conteneur
-- ------------------------------------------------------------------
--
-- Le conteneur est une unité douanière et physique indivisible : il ne se
-- dépote qu'une fois, pour tout le monde en même temps. Un fret impayé, un
-- document manquant, un contrôle physique sur UN lot immobilise TOUS les
-- autres. Mais seulement tant que le conteneur n'est pas dépoté. Entre le
-- dépotage et la libération d'un lot, il n'y a plus de solidarité.

alter table shipment_lots add column if not exists released_at   timestamptz;
alter table shipment_lots add column if not exists blocked_reason text;
alter table shipment_lots add column if not exists blocked_since  timestamptz;

comment on column shipment_lots.released_at is
  'Libération du lot à son client. Distinct du dépotage du conteneur : c''est entre les deux jalons que la solidarité entre lots s''éteint.';

create or replace function lot_solidarity(p_shipment uuid)
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    -- La solidarité n'existe que tant que le conteneur n'est pas dépoté.
    'active', (select stripped_at is null from shipments where id = p_shipment),
    'stripped_at', (select stripped_at from shipments where id = p_shipment),
    'blocking', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lot_id', l.id,
        'client_id', l.client_id,
        'reason', l.blocked_reason,
        'since', l.blocked_since))
      from shipment_lots l
      where l.shipment_id = p_shipment and l.blocked_reason is not null
    ), '[]'::jsonb),
    'lots_total', (select count(*) from shipment_lots where shipment_id = p_shipment),
    'lots_blocked', (select count(*) from shipment_lots
                     where shipment_id = p_shipment and blocked_reason is not null),
    -- Les lots qui attendent sans rien devoir : ceux à qui il faut expliquer.
    'lots_hostage', (
      select count(*) from shipment_lots l
      where l.shipment_id = p_shipment
        and l.blocked_reason is null
        and l.released_at is null
        and exists (select 1 from shipment_lots b
                    where b.shipment_id = p_shipment and b.blocked_reason is not null)
        and (select stripped_at from shipments where id = p_shipment) is null)
  )
$$;

-- ------------------------------------------------------------------
-- 5 · La règle W/M, et pourquoi les tout petits lots ne sont pas rentables
-- ------------------------------------------------------------------
--
-- On facture le plus élevé du poids en tonnes et du volume en CBM, avec un
-- minimum de 1 CBM. Le dépotage se répartit au prorata du CBM, mais les frais
-- de documentation sont un FORFAIT par House B/L. C'est ce forfait qui rend un
-- lot de 0,3 CBM non rentable, et cela doit apparaître dans le devis.

create or replace function chargeable_units(p_weight_kg numeric, p_volume_cbm numeric)
returns numeric
language sql immutable
set search_path = public
as $$
  select greatest(
    coalesce(p_weight_kg, 0) / 1000.0,  -- le poids compte en tonnes
    coalesce(p_volume_cbm, 0),
    1                                   -- minimum d'une unité payante
  )
$$;

comment on function chargeable_units(numeric, numeric) is
  'Règle W/M : le plus élevé du poids en tonnes et du volume en CBM, minimum 1. Un carton de 40 kg pour 0,2 CBM se facture 1, pas 0,04.';

-- Le devis d'un lot, ligne par ligne, pour que le client voie d'où vient le prix.
create or replace function lot_quote(
  p_lot uuid,
  p_freight_rate numeric,      -- par unité payante W/M
  p_stripping_total numeric,   -- coût du dépotage du conteneur entier
  p_doc_fee numeric            -- forfait par House B/L
) returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  l          record;
  total_cbm  numeric;
  units      numeric;
  freight    numeric;
  stripping  numeric;
begin
  select * into l from shipment_lots where id = p_lot;
  if not found then return null; end if;

  select coalesce(sum(coalesce(volume_cbm, 0)), 0) into total_cbm
  from shipment_lots where shipment_id = l.shipment_id;

  units     := chargeable_units(l.weight_kg, l.volume_cbm);
  freight   := units * coalesce(p_freight_rate, 0);
  -- Le dépotage au prorata du CBM, comme le métier le pratique.
  stripping := case when total_cbm > 0
                    then coalesce(p_stripping_total, 0) * coalesce(l.volume_cbm, 0) / total_cbm
                    else 0 end;

  return jsonb_build_object(
    'weight_kg', l.weight_kg,
    'volume_cbm', l.volume_cbm,
    'chargeable_units', round(units, 3),
    'lines', jsonb_build_array(
      jsonb_build_object('label', 'fret', 'basis', 'W/M', 'qty', round(units, 3),
                         'rate', p_freight_rate, 'amount', round(freight, 2)),
      jsonb_build_object('label', 'depotage', 'basis', 'prorata CBM',
                         'amount', round(stripping, 2)),
      -- Le forfait, isolé : c'est lui qui écrase les petits lots.
      jsonb_build_object('label', 'documentation', 'basis', 'forfait par House B/L',
                         'amount', coalesce(p_doc_fee, 0))
    ),
    'total', round(freight + stripping + coalesce(p_doc_fee, 0), 2),
    -- Le prix de l'unité payante réelle : au-dessus du tarif de fret, le lot
    -- est mangé par le forfait.
    'cost_per_unit', case when units > 0
      then round((freight + stripping + coalesce(p_doc_fee, 0)) / units, 2) end
  );
end $$;

-- La bascule LCL vers FCL se fait autour de 10 à 15 CBM. Au-delà, continuer en
-- groupage fait payer au client un service qu'il n'a plus besoin de partager.
create or replace function consolidation_advice(p_shipment uuid)
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'total_cbm', t.cbm,
    'lots', t.n,
    'advice', case
      when t.cbm >= 15 then 'passer_en_fcl'
      when t.cbm >= 10 then 'comparer_fcl'
      else 'groupage_pertinent' end,
    -- Volume chargeable RÉEL, pas géométrique : un 20' porte 25 à 28 CBM.
    'container_hint', case
      when t.cbm >= 55 then '40HC'
      when t.cbm >= 25 then '40'
      when t.cbm >= 15 then '20'
      else null end)
  from (
    select coalesce(sum(coalesce(volume_cbm, 0)), 0) as cbm, count(*) as n
    from shipment_lots where shipment_id = p_shipment
  ) t
$$;

-- ------------------------------------------------------------------
-- 6 · Sécurité : les nouvelles tables entrent dans le régime commun
-- ------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['shipment_legs','demurrage_tariffs','bills_of_lading'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('shipment_legs',     'shipment:write'),
      ('bills_of_lading',   'shipment:write'),
      -- Un barème est un réglage, pas une saisie d'exploitation : le modifier
      -- change le montant de toutes les factures à venir.
      ('demurrage_tariffs', 'settings:manage')
    ) as v(tbl, cap)
  loop
    execute format('drop policy if exists %1$s_select on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_insert on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_update on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_delete on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_platform_read on %1$I', spec.tbl);
    execute format($f$
      create policy %1$s_select on %1$I for select to authenticated
        using (agency_id = auth_agency_id() and auth_can('case:read'))
    $f$, spec.tbl);
    execute format($f$
      create policy %1$s_insert on %1$I for insert to authenticated
        with check (agency_id = auth_agency_id() and auth_can(%2$L))
    $f$, spec.tbl, spec.cap);
    execute format($f$
      create policy %1$s_update on %1$I for update to authenticated
        using (agency_id = auth_agency_id() and auth_can(%2$L))
        with check (agency_id = auth_agency_id())
    $f$, spec.tbl, spec.cap);
    execute format($f$
      create policy %1$s_delete on %1$I for delete to authenticated
        using (agency_id = auth_agency_id() and auth_role() in ('owner','manager'))
    $f$, spec.tbl);
    -- La vue support de la plateforme lit, et ne fait que lire.
    execute format($f$
      create policy %1$s_platform_read on %1$I for select to authenticated
        using (is_platform_admin())
    $f$, spec.tbl);
  end loop;
end $$;

grant select, insert, update, delete on shipment_legs, demurrage_tariffs, bills_of_lading to authenticated;
grant all on shipment_legs, demurrage_tariffs, bills_of_lading to service_role;

-- PostgreSQL accorde EXECUTE à PUBLIC par défaut : c'est le trou qu'on a déjà
-- payé une fois. On referme à chaque fonction créée.
do $$
declare f text;
begin
  foreach f in array array[
    'shipment_route(uuid)', 'route_warning(uuid)',
    'tariff_for(uuid, text, text, text, date)', 'tier_amount(jsonb, int)',
    'shipment_counters(uuid)', 'lot_solidarity(uuid)',
    'chargeable_units(numeric, numeric)',
    'lot_quote(uuid, numeric, numeric, numeric)',
    'consolidation_advice(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
