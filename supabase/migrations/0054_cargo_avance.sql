-- 0054 · Le cargo avancé : ce qui bloque une marchandise, ce qui coûte cher,
-- et ce qu'on n'a pas le droit de promettre au client.
--
-- Le socle du fret et de la douane existe déjà (0029 et 0030). Cette migration
-- ne le refait pas : elle s'y branche. Elle ajoute les sept choses qui, sur le
-- terrain, immobilisent un conteneur ou font perdre de l'argent, et une
-- huitième qui protège l'agence d'elle-même.
--
--   1. La marchandise dangereuse. Un numéro ONU manquant, et l'armateur refuse
--      l'embarquement au quai, pas au dépôt.
--   2. La température. Une rupture de chaîne du froid se prouve par un relevé
--      horodaté, jamais par une déclaration après coup.
--   3. L'assurance. Personne ne la retrouve le jour du sinistre.
--   4. Les inspections. Le contrôle technique et le phytosanitaire sont les
--      deux qui retiennent le plus souvent une marchandise au port.
--   5. Les achats et le solde fournisseur, qui se calcule et ne se stocke pas.
--   6. Le crédit client, dont l'encours se recalcule à chaque lecture.
--   7. La checklist douanière, configurable, croisée avec les pièces reçues.
--   8. Le statut public douanier, qui ne promet RIEN.
--
-- CE QUE CETTE MIGRATION N'INVENTE PAS, ET NE POURRA JAMAIS INVENTER :
--   · aucun tarif ;
--   · aucune sous-division de classe de danger (elle vient de la fiche de
--     données de sécurité du fournisseur, et d'elle seule) ;
--   · aucune obligation réglementaire non justifiable. Une pièce dont on ne
--     peut pas prouver l'obligation est semée FACULTATIVE, et le dit.
--
-- Les tables des modules voisins (suppliers, containers, shipment_goods,
-- carriers, invoices) sont écrites en parallèle. On ne pose AUCUNE clé
-- étrangère vers elles : un uuid nu, commenté, et `to_regclass` avant toute
-- lecture ou toute modification.

-- ==================================================================
-- 1 · Marchandises dangereuses (section 149)
-- ==================================================================

-- Les neuf classes principales de l'ADR et de l'IMDG, avec leur intitulé.
-- ET RIEN DE PLUS. Les classes 4, 5 et 6 ont des sous-divisions (4.1, 4.2,
-- 4.3, 5.1, 5.2, 6.1, 6.2) dont la liste exacte et l'attribution relèvent de
-- la FICHE DE DONNÉES DE SÉCURITÉ du fournisseur, jamais du logiciel. On
-- accepte donc une sous-division saisie, on ne la propose pas.
create table if not exists dangerous_goods_classes (
  code     text primary key check (code in ('1','2','3','4','5','6','7','8','9')),
  label    jsonb not null,
  position int not null default 100
);

insert into dangerous_goods_classes (code, label, position) values
  ('1', jsonb_build_object(
      'fr','Matières et objets explosibles',
      'en','Explosive substances and articles',
      'ar','المواد والأشياء المتفجرة',
      'zh','爆炸品'), 1),
  ('2', jsonb_build_object(
      'fr','Gaz',
      'en','Gases',
      'ar','الغازات',
      'zh','气体'), 2),
  ('3', jsonb_build_object(
      'fr','Liquides inflammables',
      'en','Flammable liquids',
      'ar','السوائل القابلة للاشتعال',
      'zh','易燃液体'), 3),
  ('4', jsonb_build_object(
      'fr','Matières solides inflammables, matières sujettes à l''inflammation spontanée, matières qui au contact de l''eau dégagent des gaz inflammables',
      'en','Flammable solids, substances liable to spontaneous combustion, substances which in contact with water emit flammable gases',
      'ar','المواد الصلبة القابلة للاشتعال والمواد القابلة للاشتعال التلقائي والمواد التي تنبعث منها غازات قابلة للاشتعال عند ملامسة الماء',
      'zh','易燃固体、易于自燃的物质、遇水放出易燃气体的物质'), 4),
  ('5', jsonb_build_object(
      'fr','Matières comburantes et peroxydes organiques',
      'en','Oxidizing substances and organic peroxides',
      'ar','المواد المؤكسدة والبيروكسيدات العضوية',
      'zh','氧化性物质和有机过氧化物'), 5),
  ('6', jsonb_build_object(
      'fr','Matières toxiques et matières infectieuses',
      'en','Toxic and infectious substances',
      'ar','المواد السامة والمواد المعدية',
      'zh','毒性物质和感染性物质'), 6),
  ('7', jsonb_build_object(
      'fr','Matières radioactives',
      'en','Radioactive material',
      'ar','المواد المشعة',
      'zh','放射性物质'), 7),
  ('8', jsonb_build_object(
      'fr','Matières corrosives',
      'en','Corrosive substances',
      'ar','المواد الأكالة',
      'zh','腐蚀性物质'), 8),
  ('9', jsonb_build_object(
      'fr','Matières et objets dangereux divers',
      'en','Miscellaneous dangerous substances and articles',
      'ar','المواد والأشياء الخطرة المتنوعة',
      'zh','杂项危险物质和物品'), 9)
on conflict (code) do update set label = excluded.label, position = excluded.position;

comment on table dangerous_goods_classes is
  'Les neuf classes principales ADR et IMDG, avec leur intitulé. Les sous-divisions (4.1, 5.2, 6.1 et les autres) ne sont PAS livrées : elles se lisent sur la fiche de données de sécurité du fournisseur, et une liste inventée ici ferait étiqueter faux.';

create table if not exists dangerous_goods_details (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  shipment_id uuid not null references shipments on delete cascade,
  -- Uuid nu vers `shipment_goods`, créée par le module des référentiels (0047).
  -- Pas de clé étrangère : les deux migrations s'écrivent en parallèle et une
  -- dépendance dure ferait échouer celle qui passe la première.
  goods_id    uuid,
  -- Le numéro ONU commande l'emballage, l'étiquetage, et parfois le refus de
  -- l'armateur. Même expression régulière que `shipment_goods` en 0047.
  un_number   text check (un_number is null or un_number ~ '^(UN)?[0-9]{4}$'),
  -- Classe principale, éventuellement suivie d'une sous-division. On contrôle
  -- la FORME, jamais l'existence de la sous-division : elle vient de la FDS.
  hazard_class text check (hazard_class is null or hazard_class ~ '^[1-9](\.[1-9])?$'),
  packing_group text check (packing_group is null or packing_group in ('I','II','III')),
  -- La désignation officielle de transport, recopiée de la FDS telle quelle.
  proper_shipping_name text,
  -- Point d'éclair, en degrés Celsius. Il commande le classement des liquides.
  flash_point numeric(6,2),
  msds_path   text,
  -- Le numéro joignable 24 heures sur 24. Sans lui, le dossier est incomplet
  -- et personne ne s'en aperçoit avant le quai.
  emergency_contact text,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists dangerous_goods_details_ship on dangerous_goods_details (shipment_id);
create index if not exists dangerous_goods_details_goods on dangerous_goods_details (goods_id);

comment on column dangerous_goods_details.hazard_class is
  'Classe de danger. La forme est contrôlée, le contenu ne l''est pas : la sous-division exacte relève de la fiche de données de sécurité du fournisseur. VisaFlow ne classe aucune marchandise à sa place.';

-- ==================================================================
-- 2 · Température contrôlée (section 150)
-- ==================================================================

create table if not exists reefer_requirements (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  shipment_id    uuid not null references shipments on delete cascade,
  -- Uuid nu vers `containers` (0047), écrite en parallèle.
  container_id   uuid,
  temperature_min numeric(6,2),
  temperature_max numeric(6,2),
  unit           char(1) not null default 'C' check (unit in ('C','F')),
  humidity_pct   numeric(5,2) check (humidity_pct is null or (humidity_pct >= 0 and humidity_pct <= 100)),
  -- Le renouvellement d'air, en m3/h ou en pourcentage selon l'armateur : on
  -- garde le texte du bon de réservation, on ne le convertit pas.
  ventilation    text,
  product_kind   text not null default 'autre'
                 check (product_kind in ('alimentaire','pharmaceutique','autre')),
  note           text,
  created_at     timestamptz not null default now(),
  check (temperature_min is null or temperature_max is null or temperature_max >= temperature_min)
);
create index if not exists reefer_requirements_ship on reefer_requirements (shipment_id);

comment on table reefer_requirements is
  'La consigne de température d''un conteneur frigorifique. Elle vient du bon de réservation, pas du logiciel : VisaFlow ne connaît aucune plage réglementaire par produit et n''en propose aucune.';

create table if not exists reefer_readings (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  shipment_id  uuid not null references shipments on delete cascade,
  container_id uuid,
  reading_at   timestamptz not null default now(),
  temperature  numeric(6,2) not null,
  -- D'où vient le relevé. Une rupture de chaîne du froid contestée se gagne ou
  -- se perd sur ce mot : un relevé de sonde et une valeur dictée au téléphone
  -- n'ont pas la même force devant un assureur.
  source       text not null default 'manuel'
               check (source in ('manuel','sonde','transporteur')),
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists reefer_readings_ship on reefer_readings (shipment_id, reading_at desc);
create index if not exists reefer_readings_container on reefer_readings (container_id, reading_at desc);

comment on table reefer_readings is
  'Les relevés horodatés. Une rupture de chaîne du froid se PROUVE par un relevé, jamais par une déclaration : sans cette table, l''agence n''a que sa parole face à l''assureur.';

comment on column reefer_readings.temperature is
  'Exprimée dans l''unité de la consigne du même conteneur (reefer_requirements.unit). On ne convertit pas : convertir en silence ferait afficher une rupture là où il n''y en a pas, ou l''inverse.';

-- Ce que la carte affiche : la consigne, le dernier relevé, et les relevés
-- HORS PLAGE. On ne dit pas « la chaîne est rompue » : on montre les relevés
-- qui sortent de la consigne, avec leur heure et leur source.
create or replace function reefer_status(p_shipment uuid)
returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x->>'container_id' nulls first), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'requirement_id', r.id,
      'container_id', r.container_id,
      'temperature_min', r.temperature_min,
      'temperature_max', r.temperature_max,
      'unit', r.unit,
      'humidity_pct', r.humidity_pct,
      'product_kind', r.product_kind,
      'readings', (
        select count(*) from reefer_readings d
        where d.shipment_id = r.shipment_id
          and d.container_id is not distinct from r.container_id),
      'last_reading', (
        select jsonb_build_object('at', d.reading_at, 'temperature', d.temperature, 'source', d.source)
        from reefer_readings d
        where d.shipment_id = r.shipment_id
          and d.container_id is not distinct from r.container_id
        order by d.reading_at desc limit 1),
      'out_of_range', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'at', d.reading_at, 'temperature', d.temperature, 'source', d.source)
               order by d.reading_at)
        from reefer_readings d
        where d.shipment_id = r.shipment_id
          and d.container_id is not distinct from r.container_id
          and ((r.temperature_min is not null and d.temperature < r.temperature_min)
            or (r.temperature_max is not null and d.temperature > r.temperature_max))
      ), '[]'::jsonb)
    ) as x
    from reefer_requirements r
    where r.shipment_id = p_shipment
  ) s
$$;

comment on function reefer_status(uuid) is
  'La consigne, le dernier relevé et les relevés hors plage. La fonction ne conclut pas à la rupture : elle montre les preuves, et c''est l''agence qui déclare le sinistre.';

-- ==================================================================
-- 3 · Assurance de la cargaison (section 151)
-- ==================================================================

create table if not exists cargo_insurance (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references agencies on delete cascade,
  shipment_id     uuid not null references shipments on delete cascade,
  insurer         text,
  policy_number   text,
  coverage_amount numeric(14,2) check (coverage_amount is null or coverage_amount >= 0),
  currency        char(3) not null default 'TND',
  -- La franchise reste à la charge de l'assuré. Elle se lit sur la police, on
  -- ne la déduit d'aucune règle : aucun barème n'est livré.
  deductible      numeric(14,2) check (deductible is null or deductible >= 0),
  start_date      date,
  end_date        date,
  document_path   text,
  status          text not null default 'a_souscrire'
                  check (status in ('a_souscrire','active','expiree','resiliee')),
  note            text,
  created_at      timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists cargo_insurance_ship on cargo_insurance (shipment_id);

comment on table cargo_insurance is
  'La police d''assurance de la cargaison. Le jour du sinistre, personne ne la retrouve : elle vit ici, avec son numéro, sa couverture et sa franchise. Aucun tarif n''est livré, aucune obligation d''assurance n''est affirmée : elle dépend de l''incoterm et du contrat.';

-- ==================================================================
-- 4 · Inspections et contrôle technique (sections 152 et 163)
-- ==================================================================

create table if not exists shipment_inspections (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies on delete cascade,
  shipment_id   uuid not null references shipments on delete cascade,
  kind          text not null check (kind in (
                  'DOUANE','TECHNIQUE','PHYTOSANITAIRE','SANITAIRE','SCANNER','AUTRE')),
  scheduled_at  timestamptz,
  performed_at  timestamptz,
  -- L'organisme qui contrôle, en toutes lettres. VisaFlow ne tient aucune
  -- liste d'autorités compétentes : elle change, et une liste fausse envoie
  -- l'agent au mauvais guichet.
  authority     text,
  result        text not null default 'en_attente'
                check (result in ('en_attente','conforme','non_conforme','reserve')),
  findings      text,
  document_path text,
  cost          numeric(14,2) check (cost is null or cost >= 0),
  currency      char(3) not null default 'TND',
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists shipment_inspections_ship on shipment_inspections (shipment_id, kind);

comment on table shipment_inspections is
  'Les contrôles subis par une marchandise. Le contrôle technique et le contrôle phytosanitaire sont les deux qui la retiennent le plus souvent au port : le module doit dire lequel manque, sans jamais AFFIRMER lequel est légalement exigible pour ce produit.';

create table if not exists technical_control_documents (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies on delete cascade,
  shipment_id   uuid not null references shipments on delete cascade,
  reference     text,
  authority     text,
  submitted_on  date,
  status        text not null default 'a_deposer'
                check (status in ('a_deposer','depose','approuve','rejete')),
  decision_on   date,
  document_path text,
  note          text,
  created_at    timestamptz not null default now(),
  check (decision_on is null or submitted_on is null or decision_on >= submitted_on)
);
create index if not exists technical_control_documents_ship on technical_control_documents (shipment_id);

comment on table technical_control_documents is
  'Les pièces du contrôle technique à l''importation. VisaFlow ne dit PAS quels produits y sont soumis : la liste est réglementaire, elle bouge, et l''affirmer à tort ferait déposer un dossier inutile ou en oublier un obligatoire.';

-- Ce que l'écran montre en un coup d'oeil : pour chacun des six genres de
-- contrôle, le dernier état connu. « absente » veut dire « aucun contrôle
-- enregistré », pas « aucun contrôle requis » : la nuance est tout le sujet.
create or replace function shipment_inspections_state(p_shipment uuid)
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'par_genre', coalesce((
      select jsonb_object_agg(k.kind, coalesce(
        (select jsonb_build_object(
           'result', i.result, 'scheduled_at', i.scheduled_at,
           'performed_at', i.performed_at, 'authority', i.authority,
           'findings', i.findings)
         from shipment_inspections i
         where i.shipment_id = p_shipment and i.kind = k.kind
         order by coalesce(i.performed_at, i.scheduled_at, i.created_at) desc
         limit 1),
        jsonb_build_object('result', 'absente')))
      from (values ('DOUANE'),('TECHNIQUE'),('PHYTOSANITAIRE'),
                   ('SANITAIRE'),('SCANNER'),('AUTRE')) as k(kind)
    ), '{}'::jsonb),
    -- Le contrôle technique déposé, séparément : il a sa propre pièce et son
    -- propre circuit, et c'est lui qui retient le plus souvent la marchandise.
    'controle_technique', coalesce((
      select jsonb_build_object('status', d.status, 'reference', d.reference,
                                'submitted_on', d.submitted_on, 'decision_on', d.decision_on)
      from technical_control_documents d
      where d.shipment_id = p_shipment
      order by coalesce(d.decision_on, d.submitted_on, d.created_at::date) desc
      limit 1
    ), jsonb_build_object('status', 'absent')),
    'non_conformes', (
      select count(*) from shipment_inspections i
      where i.shipment_id = p_shipment and i.result = 'non_conforme'),
    'en_attente', (
      select count(*) from shipment_inspections i
      where i.shipment_id = p_shipment and i.result = 'en_attente')
  )
$$;

comment on function shipment_inspections_state(uuid) is
  '« absente » signifie « aucun contrôle enregistré », jamais « aucun contrôle requis ». VisaFlow n''affirme aucune obligation de contrôle : elle dépend du produit et de la réglementation en vigueur.';

-- ==================================================================
-- 5 · Achats et fournisseurs (sections 156 et 157)
-- ==================================================================

create table if not exists purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies on delete cascade,
  -- Une commande est passée depuis un bureau : c'est lui qui la suit et qui la
  -- paie. D'où le cloisonnement par bureau sur cette table, et sur elle seule.
  office_id     uuid references offices on delete set null,
  shipment_id   uuid references shipments on delete set null,
  -- Uuid nu vers `suppliers` (0047), écrite en parallèle.
  supplier_id   uuid,
  po_number     text,
  currency      char(3) not null default 'USD',
  subtotal      numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0,
  status        text not null default 'brouillon'
                check (status in ('brouillon','envoye','confirme','expedie','recu','annule')),
  issued_on     date,
  expected_on   date,
  document_path text,
  note          text,
  created_at    timestamptz not null default now(),
  unique (agency_id, po_number)
);
create index if not exists purchase_orders_supplier on purchase_orders (supplier_id);
create index if not exists purchase_orders_ship on purchase_orders (shipment_id);
create index if not exists purchase_orders_office on purchase_orders (agency_id, office_id, status);

create table if not exists purchase_order_items (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  po_id       uuid not null references purchase_orders on delete cascade,
  description text,
  hs_code     text,
  quantity    numeric(14,3) not null default 1 check (quantity >= 0),
  unit        text,
  unit_price  numeric(14,4) not null default 0 check (unit_price >= 0),
  -- Calculé par la base. Une ligne d'achat recalculée dans le navigateur finit
  -- par afficher un total que le bon de commande imprimé dément.
  total       numeric(18,4) generated always as (round(quantity * unit_price, 4)) stored,
  line_no     int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists purchase_order_items_po on purchase_order_items (po_id, line_no);

-- Le sous-total et le total du bon de commande descendent des lignes. Sans ce
-- déclencheur, l'entête et les lignes divergent au premier oubli.
create or replace function purchase_order_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_po uuid; v_sum numeric;
begin
  v_po := coalesce(new.po_id, old.po_id);
  select coalesce(sum(total), 0) into v_sum from purchase_order_items where po_id = v_po;
  -- Le total reste égal au sous-total : aucune taxe n'est appliquée ici. Les
  -- droits et la TVA d'importation se liquident en douane (0030), pas sur le
  -- bon de commande du fournisseur étranger.
  update purchase_orders set subtotal = round(v_sum, 2), total = round(v_sum, 2)
   where id = v_po;
  return null;
end $$;

drop trigger if exists purchase_order_items_totals on purchase_order_items;
create trigger purchase_order_items_totals
  after insert or update or delete on purchase_order_items
  for each row execute function purchase_order_totals();

create table if not exists supplier_transactions (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  -- Uuid nu vers `suppliers` (0047).
  supplier_id uuid not null,
  shipment_id uuid references shipments on delete set null,
  kind        text not null check (kind in ('facture','paiement','avoir')),
  reference   text,
  amount      numeric(14,2) not null check (amount >= 0),
  currency    char(3) not null default 'USD',
  fx_rate     numeric(14,6) not null default 1 check (fx_rate > 0),
  -- Converti dans la devise de l'agence au taux du mouvement, et figé. Le
  -- recalculer au taux du jour ferait bouger un solde déjà réglé.
  amount_base numeric(18,4) generated always as (round(amount * fx_rate, 4)) stored,
  occurred_on date not null default current_date,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists supplier_transactions_supplier on supplier_transactions (supplier_id, occurred_on);
create index if not exists supplier_transactions_ship on supplier_transactions (shipment_id);

comment on table supplier_transactions is
  'Les mouvements d''un compte fournisseur : ses factures, nos paiements, ses avoirs. Le solde n''est PAS une colonne : un solde stocké dérive au premier mouvement oublié, et on paie deux fois.';

-- Le solde réel, dans la devise de l'agence. Positif : on doit au fournisseur.
create or replace function supplier_balance(p_supplier uuid)
returns numeric
language sql stable
set search_path = public
as $$
  select coalesce(sum(
    case t.kind
      when 'facture'  then  t.amount_base
      when 'paiement' then -t.amount_base
      when 'avoir'    then -t.amount_base
    end), 0)
  from supplier_transactions t
  where t.supplier_id = p_supplier
$$;

comment on function supplier_balance(uuid) is
  'Calculé à chaque appel, jamais stocké. Positif : l''agence doit au fournisseur. Un avoir se retranche comme un paiement, parce qu''il éteint la dette de la même façon.';

-- ==================================================================
-- 6 · Crédit client (section 155)
-- ==================================================================

create table if not exists client_credit (
  client_id          uuid primary key references clients on delete cascade,
  agency_id          uuid not null references agencies on delete cascade,
  credit_limit       numeric(14,2) not null default 0 check (credit_limit >= 0),
  payment_terms_days int not null default 0 check (payment_terms_days >= 0),
  currency           char(3) not null default 'TND',
  on_hold            boolean not null default false,
  hold_reason        text,
  updated_by         uuid references profiles on delete set null,
  updated_at         timestamptz not null default now()
);
create index if not exists client_credit_agency on client_credit (agency_id, on_hold);

comment on table client_credit is
  'La ligne de crédit d''un client professionnel. Elle porte la LIMITE, jamais l''encours : un encours stocké dérive, et une dérive fait vendre à crédit à un client qui ne paie plus.';

-- L'état du crédit, recalculé à chaque lecture.
--
-- L'encours se lit dans les factures quand le module commercial est installé,
-- et à défaut dans les règlements. Les deux modules s'écrivent en parallèle :
-- `to_regclass` avant toute lecture, sinon la fonction casse chez qui n'a pas
-- encore la table.
create or replace function client_credit_state(p_client uuid)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  c        client_credit;
  v_encours numeric := 0;
  v_retard  int := 0;
  v_source  text;
  v_bloque  boolean;
  v_configure boolean;
begin
  select * into c from client_credit where client_id = p_client;
  v_configure := c.client_id is not null;

  if to_regclass('public.invoices') is not null then
    v_source := 'factures';
    execute $q$
      select coalesce(sum(balance_due), 0),
             coalesce(max(case when due_date < current_date and balance_due > 0
                               then current_date - due_date end), 0)
      from invoices
      where client_id = $1 and status <> 'annulee'
    $q$ into v_encours, v_retard using p_client;
  else
    -- Repli : le module commercial n'est pas installé. Les règlements dus
    -- portent la même information, en moins fin.
    v_source := 'reglements';
    select coalesce(sum(p.amount * p.fx_rate), 0),
           coalesce(max(case when p.due_at < current_date then current_date - p.due_at end), 0)
      into v_encours, v_retard
    from payments p
    where p.client_id = p_client and p.state in ('du','partiel');
  end if;

  -- Un client sans ligne de crédit configurée n'est pas bloqué : l'agence n'a
  -- rien décidé, et bloquer par défaut arrêterait la vente au comptant.
  if not v_configure then
    v_bloque := false;
  else
    v_bloque := c.on_hold or v_encours > c.credit_limit;
  end if;

  return jsonb_build_object(
    'limite', coalesce(c.credit_limit, 0),
    'encours', round(v_encours, 2),
    'disponible', round(greatest(coalesce(c.credit_limit, 0) - v_encours, 0), 2),
    'jours_de_retard', coalesce(v_retard, 0),
    'bloque', v_bloque,
    'devise', coalesce(c.currency, 'TND'),
    'delai_paiement_jours', coalesce(c.payment_terms_days, 0),
    'motif', case when v_bloque then coalesce(c.hold_reason,
               case when c.on_hold then 'compte suspendu' else 'limite dépassée' end) end,
    'configure', v_configure,
    'source', v_source);
end $$;

comment on function client_credit_state(uuid) is
  'L''encours est CALCULÉ depuis les factures, ou à défaut depuis les règlements dus. Jamais stocké : un encours figé fait vendre à crédit à un client qui ne paie plus.';

-- ==================================================================
-- 7 · Checklist douanière configurable (section 148)
-- ==================================================================

create table if not exists customs_checklists (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references agencies on delete cascade,
  name                text not null,
  -- Chaque critère laissé vide veut dire « quel que soit ». Plus une liste
  -- remplit de critères, plus elle est spécifique, et c'est la plus spécifique
  -- qui gagne.
  direction           text check (direction is null or direction in ('IMPORT','EXPORT','TRANSIT')),
  origin_country      char(2) check (origin_country is null or origin_country ~ '^[A-Z]{2}$'),
  destination_country char(2) check (destination_country is null or destination_country ~ '^[A-Z]{2}$'),
  hs_chapter          char(2) check (hs_chapter is null or hs_chapter ~ '^[0-9]{2}$'),
  transport_mode      text check (transport_mode is null or transport_mode in
                        ('maritime','aerien','routier','ferroviaire')),
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);
create index if not exists customs_checklists_agency on customs_checklists (agency_id, active);

create table if not exists customs_checklist_items (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  checklist_id uuid not null references customs_checklists on delete cascade,
  -- Le code croise `shipment_documents.key`. Les codes du socle sont repris
  -- tels quels : en inventer de nouveaux ferait apparaître comme manquante une
  -- pièce déjà reçue.
  code         text not null,
  label        jsonb not null,
  required     boolean not null default false,
  position     int not null default 100,
  help         text,
  unique (checklist_id, code)
);
create index if not exists customs_checklist_items_list on customs_checklist_items (checklist_id, position);

comment on column customs_checklist_items.required is
  'Faux par défaut, et c''est délibéré. Une pièce marquée obligatoire alors qu''elle ne l''est pas fait courir l''agent après un papier inutile ; l''inverse se voit tout de suite au guichet. En cas de doute sur une obligation réglementaire, la pièce reste FACULTATIVE et le champ `help` dit pourquoi.';

-- Le socle tunisien, semé par agence.
--
-- CE QUI EST MARQUÉ OBLIGATOIRE, ET POURQUOI :
--   · facture commerciale, liste de colisage, titre de transport : ce sont les
--     pièces sans lesquelles la déclaration ne peut pas être établie ;
--   · la déclaration en détail (DDM) : elle EST le dédouanement ;
--   · le titre de commerce extérieur à l'import : la migration 0030 le tient
--     déjà pour bloquant (sans TCE domicilié, pas de transfert de devises).
--
-- CE QUI RESTE FACULTATIF, ET POURQUOI :
--   · le certificat d'origine : il n'ouvre un avantage que sous accord
--     préférentiel, et la Chine n'en a aucun avec la Tunisie ;
--   · le contrôle technique : la liste des produits qui y sont soumis est
--     réglementaire et bouge. VisaFlow ne l'affirme pas ;
--   · l'assurance : elle dépend de l'incoterm, pas de la loi ;
--   · le TCE à l'export : la forme du titre dépend du régime, et on ne peut
--     pas la trancher pour toutes les agences.
create or replace function seed_customs_checklists(p_agency uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare v_import uuid; v_export uuid; n int := 0;
begin
  if exists (select 1 from customs_checklists where agency_id = p_agency) then
    return 0;
  end if;

  insert into customs_checklists (agency_id, name, direction, destination_country)
    values (p_agency, 'Import Tunisie, socle', 'IMPORT', 'TN')
    returning id into v_import;
  insert into customs_checklists (agency_id, name, direction, origin_country)
    values (p_agency, 'Export Tunisie, socle', 'EXPORT', 'TN')
    returning id into v_export;

  insert into customs_checklist_items (agency_id, checklist_id, code, label, required, position, help) values
    (p_agency, v_import, 'facture', jsonb_build_object(
       'fr','Facture commerciale','en','Commercial invoice','ar','الفاتورة التجارية','zh','商业发票'),
     true, 10, 'La facture définitive du fournisseur. Sans elle, aucune valeur en douane ne peut être établie.'),
    (p_agency, v_import, 'packing', jsonb_build_object(
       'fr','Liste de colisage','en','Packing list','ar','قائمة التعبئة','zh','装箱单'),
     true, 20, 'Le détail des colis, des poids et des marques.'),
    (p_agency, v_import, 'bl', jsonb_build_object(
       'fr','Titre de transport','en','Transport document','ar','وثيقة النقل','zh','运输单据'),
     true, 30, 'Connaissement maritime, lettre de transport aérien ou lettre de voiture CMR, selon le mode.'),
    (p_agency, v_import, 'origine', jsonb_build_object(
       'fr','Certificat d''origine','en','Certificate of origin','ar','شهادة المنشأ','zh','原产地证'),
     false, 40, 'FACULTATIF ici. Il n''ouvre un avantage tarifaire que sous accord préférentiel, et la Chine n''en a aucun avec la Tunisie. Votre transitaire dira s''il est exigé pour ce dossier.'),
    (p_agency, v_import, 'titre', jsonb_build_object(
       'fr','Titre de commerce extérieur','en','Foreign trade title','ar','عنوان التجارة الخارجية','zh','外贸凭证'),
     true, 50, 'Domicilié en banque. Sans lui, pas de transfert de devises au fournisseur.'),
    (p_agency, v_import, 'douane', jsonb_build_object(
       'fr','Déclaration en détail','en','Customs declaration','ar','التصريح المفصل','zh','报关单'),
     true, 60, 'La déclaration déposée au bureau de douane.'),
    (p_agency, v_import, 'dct', jsonb_build_object(
       'fr','Contrôle technique','en','Technical control','ar','المراقبة الفنية','zh','技术检验'),
     false, 70, 'FACULTATIF ici. Seuls certains produits y sont soumis, et la liste est réglementaire : VisaFlow ne l''affirme pas à votre place.'),
    (p_agency, v_import, 'assurance', jsonb_build_object(
       'fr','Attestation d''assurance','en','Insurance certificate','ar','شهادة التأمين','zh','保险单'),
     false, 80, 'FACULTATIF ici. Cela dépend de l''incoterm : en CIF le vendeur assure, en FOB l''acheteur.');
  get diagnostics n = row_count;

  insert into customs_checklist_items (agency_id, checklist_id, code, label, required, position, help) values
    (p_agency, v_export, 'facture', jsonb_build_object(
       'fr','Facture commerciale','en','Commercial invoice','ar','الفاتورة التجارية','zh','商业发票'),
     true, 10, 'La facture définitive à l''acheteur étranger.'),
    (p_agency, v_export, 'packing', jsonb_build_object(
       'fr','Liste de colisage','en','Packing list','ar','قائمة التعبئة','zh','装箱单'),
     true, 20, 'Le détail des colis expédiés.'),
    (p_agency, v_export, 'bl', jsonb_build_object(
       'fr','Titre de transport','en','Transport document','ar','وثيقة النقل','zh','运输单据'),
     true, 30, 'Connaissement, lettre de transport aérien ou lettre de voiture CMR.'),
    (p_agency, v_export, 'douane', jsonb_build_object(
       'fr','Déclaration en détail','en','Customs declaration','ar','التصريح المفصل','zh','报关单'),
     true, 40, 'La déclaration d''exportation.'),
    (p_agency, v_export, 'origine', jsonb_build_object(
       'fr','Certificat d''origine','en','Certificate of origin','ar','شهادة المنشأ','zh','原产地证'),
     false, 50, 'FACULTATIF ici. Il est demandé par l''acheteur ou par son administration, pas systématiquement.'),
    (p_agency, v_export, 'titre', jsonb_build_object(
       'fr','Titre de commerce extérieur','en','Foreign trade title','ar','عنوان التجارة الخارجية','zh','外贸凭证'),
     false, 60, 'FACULTATIF ici. La forme du titre dépend du régime d''exportation : VisaFlow ne la tranche pas.'),
    (p_agency, v_export, 'assurance', jsonb_build_object(
       'fr','Attestation d''assurance','en','Insurance certificate','ar','شهادة التأمين','zh','保险单'),
     false, 70, 'FACULTATIF ici. Cela dépend de l''incoterm convenu.'),
    (p_agency, v_export, 'dct', jsonb_build_object(
       'fr','Contrôle technique','en','Technical control','ar','المراقبة الفنية','zh','技术检验'),
     false, 80, 'FACULTATIF ici. Seuls certains produits sont soumis à un contrôle à l''exportation.');

  return n + 8;
end $$;

-- Une agence nouvelle repart avec le socle. Sans ce déclencheur, l'écran de
-- réglages s'ouvrirait vide et personne ne saurait par où commencer.
create or replace function seed_customs_checklists_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform seed_customs_checklists(new.id);
  return new;
end $$;

drop trigger if exists agencies_seed_customs_checklists on agencies;
create trigger agencies_seed_customs_checklists
  after insert on agencies for each row execute function seed_customs_checklists_trg();

-- Les agences déjà installées reçoivent le socle une fois.
do $$
declare a record;
begin
  for a in select id from agencies loop
    perform seed_customs_checklists(a.id);
  end loop;
end $$;

-- La checklist qui s'applique à une cargaison, et ce qui manque.
--
-- Le choix : parmi les listes actives de l'agence dont AUCUN critère rempli ne
-- contredit la cargaison, on prend celle qui en remplit le plus. Une liste sans
-- aucun critère s'applique à tout, et perd contre n'importe quelle autre.
create or replace function customs_checklist_for(p_shipment uuid)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  s          record;
  v_direction text;
  v_mode     text;
  v_chapter  char(2);
  cl         record;
  v_pieces   jsonb;
begin
  select * into s from shipments where id = p_shipment;
  if not found then return null; end if;

  -- Le sens du mouvement se déduit des pays, pas d'une saisie de plus.
  v_direction := case
    when s.country_to = 'TN' and coalesce(s.country_from, '') <> 'TN' then 'IMPORT'
    when s.country_from = 'TN' and coalesce(s.country_to, '') <> 'TN' then 'EXPORT'
    when s.country_from is not null and s.country_to is not null then 'TRANSIT'
  end;

  v_mode := case
    when s.mode in ('maritime_fcl','maritime_lcl') then 'maritime'
    when s.mode = 'aerien' then 'aerien'
    when s.mode = 'routier' then 'routier'
  end;

  -- Le chapitre du SH vient des marchandises, table écrite par le module des
  -- référentiels. Absente, on cherche simplement sans ce critère.
  if to_regclass('public.shipment_goods') is not null then
    execute $q$
      select substring(regexp_replace(coalesce(hs_code, ''), '[^0-9]', '', 'g') from 1 for 2)
      from shipment_goods
      where shipment_id = $1 and hs_code is not null
      order by created_at limit 1
    $q$ into v_chapter using p_shipment;
    if coalesce(v_chapter, '') !~ '^[0-9]{2}$' then v_chapter := null; end if;
  end if;

  select c.id, c.name, c.direction, c.origin_country, c.destination_country,
         c.hs_chapter, c.transport_mode,
         (  (c.direction is not null)::int + (c.origin_country is not null)::int
          + (c.destination_country is not null)::int + (c.hs_chapter is not null)::int
          + (c.transport_mode is not null)::int) as score
    into cl
  from customs_checklists c
  where c.agency_id = s.agency_id and c.active
    and (c.direction is null           or c.direction = v_direction)
    and (c.origin_country is null      or c.origin_country = s.country_from)
    and (c.destination_country is null or c.destination_country = s.country_to)
    and (c.hs_chapter is null          or c.hs_chapter = v_chapter)
    and (c.transport_mode is null      or c.transport_mode = v_mode)
  order by score desc, c.created_at, c.name
  limit 1;

  if not found or cl.id is null then
    return jsonb_build_object('checklist', null, 'direction', v_direction,
                              'pieces', '[]'::jsonb, 'manquantes', 0, 'manquantes_requises', 0);
  end if;

  -- Le croisement avec les pièces réellement reçues. « Présente » veut dire
  -- reçue ou validée : demandée n'est pas reçue, et refusée encore moins.
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', i.code, 'label', i.label, 'required', i.required,
           'position', i.position, 'help', i.help,
           'document_state', d.state,
           'etat', case when d.state in ('recue','validee') then 'presente' else 'manquante' end,
           'received_at', d.received_at
         ) order by i.position, i.code), '[]'::jsonb)
    into v_pieces
  from customs_checklist_items i
  left join lateral (
    select sd.state, sd.received_at
    from shipment_documents sd
    where sd.shipment_id = p_shipment and sd.key = i.code
    order by case sd.state when 'validee' then 0 when 'recue' then 1 else 2 end
    limit 1
  ) d on true
  where i.checklist_id = cl.id;

  return jsonb_build_object(
    'checklist', jsonb_build_object(
      'id', cl.id, 'name', cl.name, 'direction', cl.direction,
      'origin_country', cl.origin_country, 'destination_country', cl.destination_country,
      'hs_chapter', cl.hs_chapter, 'transport_mode', cl.transport_mode,
      'specificite', cl.score),
    'direction', v_direction,
    'transport_mode', v_mode,
    'hs_chapter', v_chapter,
    'pieces', v_pieces,
    'manquantes', (
      select count(*) from jsonb_array_elements(v_pieces) p
      where p->>'etat' = 'manquante'),
    'manquantes_requises', (
      select count(*) from jsonb_array_elements(v_pieces) p
      where p->>'etat' = 'manquante' and (p->>'required')::boolean));
end $$;

comment on function customs_checklist_for(uuid) is
  'La liste la plus spécifique qui corresponde, croisée avec les pièces reçues. Elle rend ce qui MANQUE, sans affirmer aucune obligation réglementaire : c''est le champ `required` de la liste, réglé par l''agence, qui le dit.';

-- ==================================================================
-- 8 · Origine des marchandises (section 164)
-- ==================================================================
--
-- `shipment_goods` est créée par le module des référentiels (0047), écrit en
-- parallèle. On ne la crée pas, on ne la suppose pas : on regarde si elle est
-- là, et on complète seulement dans ce cas.
--
-- La cohérence avec 0030 est obligatoire : la Chine n'ouvre AUCUN régime
-- préférentiel, et la base refuse déjà les codes 404 et 971 de la case 42/2 sur
-- une origine non préférentielle. Une marchandise déclarée d'origine
-- préférentielle depuis un pays sans accord serait la même faute, en amont.
do $$
begin
  if to_regclass('public.shipment_goods') is null then
    raise notice '0054 : shipment_goods absente, colonnes d''origine reportées';
    return;
  end if;

  execute 'alter table shipment_goods add column if not exists preferential_origin boolean not null default false';
  -- Le type du certificat se recopie du papier, on ne le contraint pas : les
  -- formulaires changent de nom au gré des accords, et une liste figée ferait
  -- refuser un certificat valable.
  execute 'alter table shipment_goods add column if not exists certificate_type text';
  execute 'alter table shipment_goods add column if not exists origin_rule text';
  execute 'alter table shipment_goods add column if not exists supporting_document_path text';

  execute 'alter table shipment_goods drop constraint if exists shipment_goods_origine_preferentielle_check';
  execute $c$
    alter table shipment_goods add constraint shipment_goods_origine_preferentielle_check
      check (not preferential_origin or origin_preferential_allowed(origin_country)) not valid
  $c$;

  execute $c$
    comment on constraint shipment_goods_origine_preferentielle_check on shipment_goods is
      'Une origine préférentielle réclamée depuis un pays sans accord est refusée. Même règle que la case 42/2 en 0030 : la Chine ne figure dans aucun accord tunisien, et réclamer le préférentiel là-bas se paie au redressement.'
  $c$;

  execute $c$
    comment on column shipment_goods.origin_rule is
      'La règle d''origine invoquée, recopiée du certificat (ouvraison suffisante, valeur ajoutée, changement de position). VisaFlow ne la déduit pas : elle dépend de l''accord et du produit.'
  $c$;
end $$;

-- ==================================================================
-- 9 · Intégrations transporteurs (sections 165, 166, 167)
-- ==================================================================
--
-- L'ARCHITECTURE SEULEMENT. Aucune intégration réelle n'est livrée ici : ni
-- client d'API, ni format d'EDI, ni correspondance de statuts. Ce qui est posé,
-- c'est où brancher, et où ranger ce qui arrive.
--
-- ET LE SUIVI MANUEL RESTE TOUJOURS POSSIBLE (section 166). Beaucoup de
-- transporteurs tunisiens et de commissionnaires n'ont aucune interface : ils
-- envoient un message ou ils appellent. `shipment_legs` et `shipment_events` se
-- remplissent à la main comme avant, et rien ici ne les remplace.

create table if not exists carrier_integrations (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  -- Uuid nu vers `carriers` (0047), écrite en parallèle.
  carrier_id   uuid,
  provider     text not null,
  api_kind     text not null default 'aucune'
               check (api_kind in ('rest','edi','webhook','aucune')),
  -- LE NOM DU SECRET DANS LE COFFRE, JAMAIS SA VALEUR. Une clé d'API écrite
  -- dans une table est lisible par toute personne qui lit la table, et elle
  -- part dans la moindre sauvegarde.
  secret_name  text,
  base_url     text,
  active       boolean not null default false,
  last_sync_at timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  unique (agency_id, provider)
);
create index if not exists carrier_integrations_carrier on carrier_integrations (carrier_id);

comment on column carrier_integrations.secret_name is
  'Le NOM du secret dans le coffre, jamais sa valeur. Une clé d''API stockée en clair fuit par la première sauvegarde, et personne ne s''en aperçoit.';

comment on column carrier_integrations.api_kind is
  '« aucune » est une valeur normale, pas un défaut de configuration : la plupart des transporteurs n''offrent aucune interface, et le suivi se saisit à la main.';

create table if not exists carrier_tracking_webhooks (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  provider     text not null,
  shipment_id  uuid references shipments on delete set null,
  -- La référence telle que le transporteur la connaît : numéro de conteneur,
  -- de connaissement, ou référence de dossier.
  external_ref text,
  payload      jsonb not null default '{}'::jsonb,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);
create index if not exists carrier_tracking_webhooks_ship on carrier_tracking_webhooks (shipment_id, received_at desc);
create index if not exists carrier_tracking_webhooks_ref on carrier_tracking_webhooks (provider, external_ref);

-- L'entrée d'un événement transporteur. RÉSERVÉE À LA CLÉ DE SERVICE : elle est
-- appelée par une fonction de bord, jamais depuis un navigateur.
--
-- Elle rattache l'événement à la cargaison par la référence que le transporteur
-- connaît, puis écrit une étape. Un événement qu'on ne peut rattacher à AUCUNE
-- agence n'est pas stocké : `agency_id` est la colonne vertébrale de toute la
-- sécurité, et le ranger sous une agence devinée serait une fuite.
create or replace function carrier_event_ingest(
  p_provider text, p_external_ref text, p_payload jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ship    uuid;
  v_agency  uuid;
  v_hook    uuid;
  v_stage   text;
  v_at      timestamptz;
  n_agencies int;
begin
  -- 1. Retrouver la cargaison par ce que le transporteur nous renvoie.
  select s.id, s.agency_id into v_ship, v_agency
  from shipments s
  where p_external_ref is not null
    and (s.reference = p_external_ref
      or s.container_no = p_external_ref
      or s.bl_number = p_external_ref)
  limit 1;

  if v_ship is null and p_external_ref is not null then
    select b.shipment_id, b.agency_id into v_ship, v_agency
    from bills_of_lading b where b.number = p_external_ref limit 1;
  end if;

  -- 2. Sinon, l'agence qui a déclaré ce fournisseur d'API. Si plusieurs
  --    l'utilisent, on ne devine pas : on refuse.
  if v_agency is null then
    select count(*) into n_agencies from carrier_integrations where provider = p_provider;
    if n_agencies = 1 then
      select agency_id into v_agency from carrier_integrations where provider = p_provider;
    end if;
  end if;

  if v_agency is null then
    raise exception 'événement transporteur non rattachable' using errcode = 'P0001';
  end if;

  insert into carrier_tracking_webhooks (agency_id, provider, shipment_id, external_ref, payload, error)
  values (v_agency, p_provider, v_ship, p_external_ref, coalesce(p_payload, '{}'::jsonb),
          case when v_ship is null then 'cargaison inconnue pour cette référence' end)
  returning id into v_hook;

  if v_ship is not null then
    -- L'étape se pose telle que le transporteur la nomme. On ne traduit PAS
    -- son vocabulaire en jalon douanier : une correspondance inventée ferait
    -- afficher « dédouané » sur un message qui ne dit pas ça.
    v_stage := coalesce(nullif(trim(coalesce(p_payload->>'status', '')), ''), 'suivi_transporteur');
    v_at := coalesce((p_payload->>'at')::timestamptz, now());
    insert into shipment_events (agency_id, shipment_id, stage, at, location, note)
    values (v_agency, v_ship, v_stage, v_at, p_payload->>'location',
            jsonb_build_object('provider', p_provider, 'external_ref', p_external_ref,
                               'payload', coalesce(p_payload, '{}'::jsonb)));
    update carrier_tracking_webhooks set processed_at = now() where id = v_hook;
    update carrier_integrations set last_sync_at = now(), last_error = null
     where agency_id = v_agency and provider = p_provider;
  else
    update carrier_integrations set last_error = 'référence inconnue : ' || coalesce(p_external_ref, 'nulle')
     where agency_id = v_agency and provider = p_provider;
  end if;

  return v_hook;
end $$;

comment on function carrier_event_ingest(text, text, jsonb) is
  'Réservée à la clé de service. Le suivi MANUEL reste toujours possible : beaucoup de transporteurs n''ont aucune interface, et shipment_legs comme shipment_events se remplissent à la main. Cette fonction ajoute une source, elle n''en remplace aucune.';

-- ==================================================================
-- 10 · Le statut public douanier (section 169)
-- ==================================================================
--
-- LA RÈGLE LA PLUS IMPORTANTE DE CE MODULE.
--
-- VisaFlow n'annonce JAMAIS une décision douanière. Jamais « votre marchandise
-- sera libérée demain » : la douane décide, pas nous, et une promesse tenue
-- neuf fois sur dix devient un litige la dixième. On dit l'état du dossier :
-- « le dossier est en attente de mainlevée ». C'est un constat, pas une
-- prévision.
--
-- Le vocabulaire est donc CLOS. On ne peut pas écrire un statut inventé : la
-- clé étrangère l'interdit, et la contrainte de rédaction refuse tout libellé
-- qui contient une prévision ou un engagement.

create or replace function public_status_wording_ok(p_label jsonb)
returns boolean
language sql immutable
set search_path = public
as $$
  select p_label is not null
     and (p_label ? 'fr') and (p_label ? 'en')
     -- Les mots d'une promesse : une date à venir, un délai, un engagement.
     and coalesce(p_label->>'fr', '') !~* '(demain|sera |seront |dès que|d''ici|sous [0-9]|dans [0-9]+ (jour|heure)|avant le |prévu|prevu|garant|promis|assur[ée] que)'
     and coalesce(p_label->>'en', '') !~* '(tomorrow|will be|shall be|within [0-9]|expected|guarantee|promise|by [0-9])'
$$;

comment on function public_status_wording_ok(jsonb) is
  'Refuse tout libellé public qui contient une prévision ou un engagement. C''est la garde de la section 169 : VisaFlow constate l''état du dossier, elle n''annonce aucune décision douanière.';

create table if not exists customs_public_statuses (
  code     text primary key,
  label    jsonb not null,
  position int not null default 100,
  active   boolean not null default true,
  constraint customs_public_statuses_wording check (public_status_wording_ok(label))
);

insert into customs_public_statuses (code, label, position) values
  ('dossier_en_preparation', jsonb_build_object(
     'fr','Le dossier est en préparation.',
     'en','The file is being prepared.',
     'ar','الملف قيد الإعداد.',
     'zh','单证正在准备中。'), 10),
  ('piece_manquante', jsonb_build_object(
     'fr','Une pièce du dossier manque.',
     'en','A document is missing from the file.',
     'ar','تنقص وثيقة من الملف.',
     'zh','单证缺少一份文件。'), 20),
  ('declaration_deposee', jsonb_build_object(
     'fr','La déclaration en détail est déposée.',
     'en','The customs declaration has been lodged.',
     'ar','تم إيداع التصريح المفصل.',
     'zh','报关单已递交。'), 30),
  ('en_attente_de_mainlevee', jsonb_build_object(
     'fr','Le dossier est en attente de mainlevée.',
     'en','The file is awaiting customs release.',
     'ar','الملف في انتظار رفع اليد.',
     'zh','单证正在等待海关放行。'), 40),
  ('controle_en_cours', jsonb_build_object(
     'fr','Un contrôle est en cours.',
     'en','An inspection is under way.',
     'ar','هناك مراقبة جارية.',
     'zh','正在进行查验。'), 50),
  ('mainlevee_obtenue', jsonb_build_object(
     'fr','La mainlevée est obtenue.',
     'en','Customs release has been obtained.',
     'ar','تم الحصول على رفع اليد.',
     'zh','已取得海关放行。'), 60),
  ('marchandise_enlevee', jsonb_build_object(
     'fr','La marchandise est enlevée.',
     'en','The goods have been collected.',
     'ar','تم سحب البضاعة.',
     'zh','货物已提取。'), 70)
on conflict (code) do update set label = excluded.label, position = excluded.position;

comment on table customs_public_statuses is
  'Le vocabulaire CLOS des messages destinés au client. Aucun n''annonce de décision douanière, aucun ne donne de date : la contrainte de rédaction le refuserait.';

-- Ce que l'agence choisit de publier, quand elle veut devancer le calcul. Cette
-- table ne porte AUCUN texte libre, et c'est délibéré : un champ libre servirait
-- à écrire la promesse que le vocabulaire clos interdit.
create table if not exists customs_public_notices (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  shipment_id uuid not null references shipments on delete cascade,
  code        text not null references customs_public_statuses on delete restrict,
  set_by      uuid references profiles on delete set null,
  at          timestamptz not null default now()
);
create index if not exists customs_public_notices_ship on customs_public_notices (shipment_id, at desc);

comment on table customs_public_notices is
  'Le statut publié à la main. Pas de champ de texte libre : c''est la garde. Un commentaire libre destiné au client redeviendrait le « votre marchandise sort demain » que la section 169 interdit.';

-- Le libellé destiné au client, dans les quatre langues.
--
-- Aucune prévision, aucun engagement, aucune date à venir. On lit des FAITS
-- déjà survenus : une déclaration déposée, un contrôle enregistré, une
-- mainlevée obtenue, une marchandise enlevée.
create or replace function customs_public_status(p_shipment uuid)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  s      record;
  v_code text;
  st     customs_public_statuses;
begin
  select * into s from shipments where id = p_shipment;
  if not found then return null; end if;

  -- 1. Ce que l'agence a publié à la main prime, et il vient du vocabulaire clos.
  select code into v_code from customs_public_notices
   where shipment_id = p_shipment order by at desc limit 1;

  -- 2. Sinon, on constate. Du fait le plus avancé au moins avancé.
  if v_code is null then
    if s.goods_removed_at is not null or s.delivered_at is not null then
      v_code := 'marchandise_enlevee';
    elsif s.cleared_at is not null then
      v_code := 'mainlevee_obtenue';
    elsif exists (select 1 from shipment_inspections i
                  where i.shipment_id = p_shipment and i.result = 'en_attente'
                    and i.scheduled_at is not null) then
      v_code := 'controle_en_cours';
    elsif exists (select 1 from customs_declarations d
                  where d.shipment_id = p_shipment
                    and d.status in ('deposee','enregistree','liquidee','payee')) then
      -- La déclaration est déposée : le dossier attend la décision. On le dit
      -- comme une attente, jamais comme une échéance.
      v_code := 'en_attente_de_mainlevee';
    elsif exists (select 1 from shipment_documents sd
                  where sd.shipment_id = p_shipment and sd.required
                    and sd.state not in ('recue','validee')) then
      v_code := 'piece_manquante';
    else
      v_code := 'dossier_en_preparation';
    end if;
  end if;

  select * into st from customs_public_statuses where code = v_code and active;
  if st.code is null then
    -- Un code publié puis désactivé ne doit pas rendre une case vide chez le
    -- client : on retombe sur le constat le plus neutre.
    select * into st from customs_public_statuses where code = 'dossier_en_preparation';
  end if;

  return jsonb_build_object(
    'code', st.code,
    'label', st.label,
    -- Dit explicitement à l'appelant que ce texte n'engage à rien. Le portail
    -- s'en sert pour ne jamais l'habiller d'une date.
    'previsionnel', false,
    'as_of', now());
end $$;

comment on function customs_public_status(uuid) is
  'Le libellé destiné au client, dans les quatre langues. Il ne contient AUCUNE prévision et AUCUN engagement : VisaFlow n''annonce jamais une décision douanière. Le portail client lit cette fonction et rien d''autre.';

-- ==================================================================
-- 11 · Sécurité : les nouvelles tables entrent dans le régime commun
-- ==================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'dangerous_goods_classes','dangerous_goods_details',
    'reefer_requirements','reefer_readings','cargo_insurance',
    'shipment_inspections','technical_control_documents',
    'purchase_orders','purchase_order_items','supplier_transactions',
    'client_credit','customs_checklists','customs_checklist_items',
    'carrier_integrations','carrier_tracking_webhooks',
    'customs_public_statuses','customs_public_notices'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- Les tables d'agence : même moule que 0029 et 0030.
do $$
declare spec record;
begin
  for spec in
    select * from (values
      ('dangerous_goods_details',      'shipment:write'),
      ('reefer_requirements',          'shipment:write'),
      ('reefer_readings',              'shipment:write'),
      ('cargo_insurance',              'shipment:write'),
      ('shipment_inspections',         'shipment:write'),
      ('technical_control_documents',  'shipment:write'),
      ('purchase_order_items',         'shipment:write'),
      ('supplier_transactions',        'shipment:write'),
      ('customs_checklists',           'shipment:write'),
      ('customs_checklist_items',      'shipment:write'),
      ('carrier_integrations',         'shipment:write'),
      ('customs_public_notices',       'shipment:write'),
      -- La ligne de crédit décide de vendre à découvert : elle relève de la
      -- finance, pas de l'exploitation.
      ('client_credit',                'finance:global')
    ) as v(tbl, cap)
  loop
    execute format('drop policy if exists %1$s_select on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_insert on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_update on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_delete on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_platform_read on %1$I', spec.tbl);
    execute format($f$
      create policy %1$s_select on %1$I for select to authenticated
        using (agency_id = auth_agency_id() and auth_can(%2$L))
    $f$, spec.tbl, case when spec.tbl = 'client_credit' then 'finance:global' else 'case:read' end);
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
    execute format($f$
      create policy %1$s_platform_read on %1$I for select to authenticated
        using (is_platform_admin())
    $f$, spec.tbl);
  end loop;
end $$;

-- Les bons de commande portent un bureau : ils suivent la règle des bureaux
-- posée en 0044. Un agent de Sfax ne voit pas les achats de Tunis.
drop policy if exists purchase_orders_select on purchase_orders;
drop policy if exists purchase_orders_insert on purchase_orders;
drop policy if exists purchase_orders_update on purchase_orders;
drop policy if exists purchase_orders_delete on purchase_orders;
drop policy if exists purchase_orders_platform_read on purchase_orders;

create policy purchase_orders_select on purchase_orders for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('case:read') and auth_sees_office(office_id));
create policy purchase_orders_insert on purchase_orders for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('shipment:write') and auth_sees_office(office_id));
create policy purchase_orders_update on purchase_orders for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('shipment:write') and auth_sees_office(office_id))
  with check (agency_id = auth_agency_id() and auth_sees_office(office_id));
create policy purchase_orders_delete on purchase_orders for delete to authenticated
  using (agency_id = auth_agency_id() and auth_role() in ('owner','manager'));
create policy purchase_orders_platform_read on purchase_orders for select to authenticated
  using (is_platform_admin());

-- Les événements des transporteurs se LISENT par l'agence, et ne s'écrivent que
-- par la clé de service : ils arrivent d'une fonction de bord, jamais d'un
-- navigateur. Laisser un compte d'agence en écrire ouvrirait la porte à un faux
-- suivi, indiscernable du vrai.
drop policy if exists carrier_tracking_webhooks_select on carrier_tracking_webhooks;
drop policy if exists carrier_tracking_webhooks_platform_read on carrier_tracking_webhooks;
create policy carrier_tracking_webhooks_select on carrier_tracking_webhooks for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('case:read'));
create policy carrier_tracking_webhooks_platform_read on carrier_tracking_webhooks for select to authenticated
  using (is_platform_admin());

-- Les deux vocabulaires se lisent par tous et ne s'écrivent par personne : ce
-- sont des socles, pas des réglages d'agence. Une agence qui pourrait écrire
-- son propre statut public contournerait la section 169 en une ligne.
drop policy if exists dangerous_goods_classes_select on dangerous_goods_classes;
create policy dangerous_goods_classes_select on dangerous_goods_classes for select to authenticated using (true);
drop policy if exists customs_public_statuses_select on customs_public_statuses;
create policy customs_public_statuses_select on customs_public_statuses for select to authenticated using (true);

revoke all on
  dangerous_goods_classes, dangerous_goods_details, reefer_requirements, reefer_readings,
  cargo_insurance, shipment_inspections, technical_control_documents,
  purchase_orders, purchase_order_items, supplier_transactions, client_credit,
  customs_checklists, customs_checklist_items, carrier_integrations,
  carrier_tracking_webhooks, customs_public_statuses, customs_public_notices
from anon, authenticated;

grant select, insert, update, delete on
  dangerous_goods_details, reefer_requirements, reefer_readings, cargo_insurance,
  shipment_inspections, technical_control_documents, purchase_orders,
  purchase_order_items, supplier_transactions, client_credit,
  customs_checklists, customs_checklist_items, carrier_integrations,
  customs_public_notices
to authenticated;

grant select on dangerous_goods_classes, customs_public_statuses, carrier_tracking_webhooks to authenticated;

grant all on
  dangerous_goods_classes, dangerous_goods_details, reefer_requirements, reefer_readings,
  cargo_insurance, shipment_inspections, technical_control_documents,
  purchase_orders, purchase_order_items, supplier_transactions, client_credit,
  customs_checklists, customs_checklist_items, carrier_integrations,
  carrier_tracking_webhooks, customs_public_statuses, customs_public_notices
to service_role;

-- PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction créée. On referme,
-- fonction par fonction.
do $$
declare f text;
begin
  foreach f in array array[
    'reefer_status(uuid)',
    'shipment_inspections_state(uuid)',
    'supplier_balance(uuid)',
    'client_credit_state(uuid)',
    'customs_checklist_for(uuid)',
    'public_status_wording_ok(jsonb)',
    'customs_public_status(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Le semis appartient aux réglages : il installe le socle d'une agence.
revoke all on function seed_customs_checklists(uuid) from public, anon;
grant execute on function seed_customs_checklists(uuid) to authenticated;

-- L'entrée des événements transporteurs n'est PAS ouverte aux comptes
-- d'agence : elle écrit une étape de suivi sans passer par les politiques.
revoke all on function carrier_event_ingest(text, text, jsonb) from public, anon, authenticated;
grant execute on function carrier_event_ingest(text, text, jsonb) to service_role;

-- ------------------------------------------------------------------
-- Le piège des fonctions de déclencheur (repris de 0044)
-- ------------------------------------------------------------------
--
-- Une fonction `returns trigger` s'appelle toute seule, donc personne ne
-- remarque qu'elle reste appelable directement par un anonyme. Une fonction
-- SECURITY DEFINER appelable par un anonyme est une porte ouverte. On ferme,
-- pour toutes celles du schéma, présentes et ajoutées par ce lot.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
  end loop;
end $$;
