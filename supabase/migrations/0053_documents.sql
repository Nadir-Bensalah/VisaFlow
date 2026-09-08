-- 0053 · Les documents : ce qu'on imprime, ce qu'on importe, ce qu'on exporte.
--
-- Trois besoins qui se ressemblent et qu'on traite ensemble, parce qu'ils
-- partagent la même règle : rien ne sort de l'application sans laisser de
-- trace, et rien n'entre sans que quelqu'un ait vu ce qui va entrer.
--
-- ------------------------------------------------------------------
-- LA DÉCISION D'ARCHITECTURE : OÙ SE FABRIQUE LE PDF
-- ------------------------------------------------------------------
--
-- Le choix retenu est le MOTEUR D'IMPRESSION DU NAVIGATEUR : on compose une
-- page HTML complète, on la donne au navigateur, l'employé fait « Enregistrer
-- en PDF ». Aucune bibliothèque, aucun serveur. Le détail vit dans
-- `web/src/lib/pdf.ts`, qui porte le même commentaire.
--
-- Le motif tient en un mot : l'ARABE. Une facture pour une agence libyenne
-- s'imprime en arabe, de droite à gauche. Or aucune bibliothèque PDF en
-- JavaScript ne sait façonner l'arabe : ni jsPDF, ni pdfmake, ni pdf-lib ne
-- font le liage contextuel des lettres ni le réordonnancement bidirectionnel.
-- Elles poseraient les glyphes isolés, à l'envers, ou des carrés. Le moteur du
-- navigateur, lui, embarque HarfBuzz et l'algorithme bidi d'Unicode : il fait
-- ce travail depuis vingt ans, et il le fait bien.
--
-- Le second motif : le site de démonstration est servi par GitHub Pages, sans
-- backend. Une fonction de bord aurait été inutilisable là-bas, et Deno n'a de
-- toute façon pas de moteur PDF confortable.
--
-- Ce qu'on paie pour ça, et qu'il faut dire : le rendu dépend du poste (police
-- installée, marges du pilote d'impression), et le fichier n'est pas produit
-- en silence, l'employé passe par la boîte d'impression. On ne peut donc pas
-- ranger l'octet du PDF dans un seau. C'est pourquoi `generated_documents`
-- garde l'EMPREINTE de ce qui a été composé, et non le fichier : elle suffit à
-- prouver que deux impressions de la même facture ont produit le même
-- document, ce qui est la question comptable.

-- ------------------------------------------------------------------
-- 1 · Les modèles de document
-- ------------------------------------------------------------------
--
-- En Tunisie, une facture sans matricule fiscal est refusée. Le matricule vit
-- déjà sur l'agence (agencies.tax_id), mais les mentions qui l'entourent
-- changent d'une agence à l'autre : capital, RC, régime de TVA, code TVA de
-- l'exportateur. Elles ne se devinent pas, elles se saisissent une fois.

create table if not exists document_templates (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  kind           text not null check (kind in (
                   'devis','facture','recu','checklist','bon_livraison',
                   'fiche_client','fiche_dossier','cargaison','rapport')),
  name           text not null,
  -- La langue du modèle. Une agence libyenne imprime en arabe, la même agence
  -- imprime en français pour le consulat : deux modèles, une seule nature.
  locale         text not null default 'fr' check (locale in ('fr','en','ar','zh')),
  -- L'en-tête et le pied sont du HTML, pas du texte : une agence veut son
  -- logo, ses coordonnées sur deux colonnes, et parfois un tableau. Le champ
  -- n'est jamais injecté tel quel dans le DOM de l'application : il n'est
  -- écrit que dans le document imprimé, qui vit dans son propre cadre isolé.
  header_html    text,
  footer_html    text,
  css            text,
  logo_position  text not null default 'gauche'
                 check (logo_position in ('gauche','centre','droite','aucun')),
  -- Le cachet et la signature scannés. Beaucoup d'administrations tunisiennes
  -- refusent un document sans cachet, même envoyé par courriel.
  show_stamp     boolean not null default false,
  -- Le bloc légal du pied de page. C'est ici que vit le matricule fiscal, le
  -- RC, le capital. Un texte libre : la loi change plus vite qu'un schéma.
  legal_mentions text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
create index if not exists document_templates_agency
  on document_templates (agency_id, kind) where active;

comment on table document_templates is
  'Les modèles d''impression d''une agence. Le bloc légal n''est pas décoratif : en Tunisie, une facture sans matricule fiscal est refusée.';

-- Une seule ligne active par nature et par langue : deux modèles actifs pour
-- « facture / fr » et personne ne sait lequel s'imprime.
create unique index if not exists document_templates_unique_active
  on document_templates (agency_id, kind, locale) where active;

-- ------------------------------------------------------------------
-- 2 · La trace de chaque document produit
-- ------------------------------------------------------------------
--
-- Une facture régénérée avec un autre montant, sans trace, est un problème
-- comptable : personne ne peut dire quelle version le client a reçue. On garde
-- donc qui a imprimé quoi, quand, et l'empreinte de ce qui a été composé.

create table if not exists generated_documents (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  office_id    uuid references offices on delete set null,
  kind         text not null check (kind in (
                 'devis','facture','recu','checklist','bon_livraison',
                 'fiche_client','fiche_dossier','cargaison','rapport')),
  -- La nature de l'objet imprimé et son identifiant. Volontairement SANS clé
  -- étrangère : les tables du commerce et de la logistique s'écrivent en
  -- parallèle (0045 à 0052), et une trace ne doit pas disparaître le jour où
  -- la facture est purgée. Une trace qui s'efface avec son sujet ne trace rien.
  entity_kind  text not null,
  entity_id    uuid,
  -- Le numéro du document imprimé, quand il en a un (FAC-2026-0007). Une fiche
  -- client n'en a pas : le champ reste vide plutôt que d'inventer une série.
  number       text,
  locale       text not null default 'fr' check (locale in ('fr','en','ar','zh')),
  -- Le chemin dans le seau, si un jour le document y est déposé. Vide dans le
  -- fonctionnement normal : le navigateur imprime, il ne téléverse pas.
  storage_path text,
  -- L'empreinte de ce qui a été composé, calculée côté navigateur sur le
  -- contenu imprimé. C'est elle qui répond à « est-ce le même document ? ».
  sha256       text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  generated_by uuid references profiles on delete set null,
  generated_at timestamptz not null default now()
);
create index if not exists generated_documents_agency
  on generated_documents (agency_id, generated_at desc);
create index if not exists generated_documents_entity
  on generated_documents (entity_kind, entity_id, generated_at desc);

comment on table generated_documents is
  'Qui a imprimé quoi, quand, et avec quelle empreinte. Sans cette table, une facture réimprimée avec un autre montant ne se voit nulle part.';

-- ------------------------------------------------------------------
-- 3 · Les imports
-- ------------------------------------------------------------------
--
-- Un import qui crée trois cents doublons se répare en trois jours. La table
-- ne sert donc pas qu'au compte rendu : elle garde la correspondance des
-- colonnes choisie par l'utilisateur, pour qu'un second fichier de la même
-- source se rejoue à l'identique sans qu'on la refasse de tête.

create table if not exists import_jobs (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies on delete cascade,
  office_id     uuid references offices on delete set null,
  entity_kind   text not null check (entity_kind in (
                  'clients','prospects','dossiers','factures','contacts','cargaisons')),
  file_name     text not null,
  total_rows    int not null default 0,
  imported_rows int not null default 0,
  skipped_rows  int not null default 0,
  -- Les lignes refusées, avec leur numéro et le motif. Un import qui dit
  -- « 12 lignes ignorées » sans dire lesquelles oblige à tout reprendre.
  errors        jsonb not null default '[]'::jsonb,
  mapping       jsonb not null default '{}'::jsonb,
  status        text not null default 'analyse'
                check (status in ('analyse','pret','en_cours','termine','echoue')),
  created_by    uuid references profiles on delete set null,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,
  check (imported_rows >= 0 and skipped_rows >= 0 and total_rows >= 0)
);
create index if not exists import_jobs_agency
  on import_jobs (agency_id, created_at desc);

comment on table import_jobs is
  'Le journal des imports. La correspondance des colonnes y reste : le mois suivant, le même fichier se rejoue sans qu''on la refasse de mémoire.';

-- ------------------------------------------------------------------
-- 4 · Tout ce qu'un document doit imprimer, en un seul aller-retour
-- ------------------------------------------------------------------
--
-- L'écran d'impression ne fait qu'UN appel. Huit requêtes pour imprimer une
-- facture, c'est huit occasions d'imprimer un document à moitié rempli quand
-- la troisième échoue.
--
-- La fonction est en SECURITY INVOKER, et c'est la décision de sécurité de ce
-- lot. En SECURITY DEFINER, elle aurait contourné les politiques de sécurité
-- et un agent aurait pu imprimer le dossier d'un bureau qu'il ne voit pas :
-- l'impression serait devenue le trou par lequel on lit tout. Ici, les
-- politiques s'appliquent normalement, la ligne ne remonte pas, et on refuse.
--
-- Les tables du commerce et de la logistique (0045 à 0052) sont testées avec
-- `to_regclass` : elles s'écrivent en parallèle, et cette migration doit
-- s'appliquer qu'elles soient là ou non.

create or replace function document_payload(p_kind text, p_entity uuid default null)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  v_agency uuid; v_office uuid; v_client uuid;
  v_entity_kind text := 'inconnu';
  v_number text;
  v_meta   jsonb := '{}'::jsonb;
  v_lines  jsonb := '[]'::jsonb;
  v_totals jsonb := '{}'::jsonb;
  v_extra  jsonb := '{}'::jsonb;
  v_locale text;
  v_agency_j jsonb; v_office_j jsonb; v_client_j jsonb; v_tpl_j jsonb;
begin
  if p_kind is null or p_kind not in (
      'devis','facture','recu','checklist','bon_livraison',
      'fiche_client','fiche_dossier','cargaison','rapport') then
    raise exception 'nature de document inconnue : %', p_kind using errcode = 'P0001';
  end if;

  -- ---------------- Le devis ----------------
  if p_kind = 'devis' then
    v_entity_kind := 'quote';
    if to_regclass('public.quotes') is null then
      raise exception 'le module commercial n''est pas installé' using errcode = 'P0001';
    end if;
    execute $q$
      select q.agency_id, q.office_id, q.client_id, q.number,
             jsonb_build_object(
               'number', q.number, 'kind', q.kind, 'status', q.status,
               'currency', q.currency, 'valid_until', q.valid_until,
               'note', q.note, 'created_at', q.created_at,
               'sent_at', q.sent_at, 'decided_at', q.decided_at,
               'case_id', q.case_id, 'shipment_id', q.shipment_id),
             jsonb_build_object(
               'subtotal', q.subtotal, 'tax_total', q.tax_total,
               'discount', q.discount, 'total', q.total)
        from quotes q where q.id = $1
    $q$ into v_agency, v_office, v_client, v_number, v_meta, v_totals using p_entity;

    if to_regclass('public.quote_items') is not null then
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object(
                 'line_no', l.line_no, 'description', l.description,
                 'quantity', l.quantity, 'unit_price', l.unit_price,
                 'tax_rate', l.tax_rate, 'discount', l.discount,
                 'line_total', l.line_total, 'service', s.name)
               order by l.line_no), '[]'::jsonb)
          from quote_items l
          left join services s on s.id = l.service_id
         where l.quote_id = $1 and l.deleted_at is null
      $q$ into v_lines using p_entity;
    end if;

  -- ---------------- La facture ----------------
  elsif p_kind = 'facture' then
    v_entity_kind := 'invoice';
    if to_regclass('public.invoices') is null then
      raise exception 'le module commercial n''est pas installé' using errcode = 'P0001';
    end if;
    execute $q$
      select i.agency_id, i.office_id, i.client_id, i.number,
             jsonb_build_object(
               'number', i.number, 'status', i.status, 'currency', i.currency,
               'issue_date', i.issue_date, 'due_date', i.due_date,
               'note', i.note, 'created_at', i.created_at,
               'case_id', i.case_id, 'shipment_id', i.shipment_id,
               'quote_id', i.quote_id),
             jsonb_build_object(
               'subtotal', i.subtotal, 'tax_total', i.tax_total,
               'discount', i.discount, 'total', i.total,
               'paid', i.paid_amount, 'balance', i.balance_due)
        from invoices i where i.id = $1
    $q$ into v_agency, v_office, v_client, v_number, v_meta, v_totals using p_entity;

    if to_regclass('public.invoice_items') is not null then
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object(
                 'line_no', l.line_no, 'description', l.description,
                 'quantity', l.quantity, 'unit_price', l.unit_price,
                 'tax_rate', l.tax_rate, 'discount', l.discount,
                 'line_total', l.line_total, 'service', s.name)
               order by l.line_no), '[]'::jsonb)
          from invoice_items l
          left join services s on s.id = l.service_id
         where l.invoice_id = $1 and l.deleted_at is null
      $q$ into v_lines using p_entity;
    end if;

    -- Les règlements déjà encaissés s'impriment sous le total : c'est la
    -- première question du client quand il reçoit une facture partielle.
    select jsonb_build_object('payments', coalesce(jsonb_agg(jsonb_build_object(
             'at', p.at, 'amount', p.amount, 'method', p.method,
             'receipt_no', p.receipt_no) order by p.at), '[]'::jsonb))
      into v_extra
      from payments p
     where p.client_id = v_client and p.state = 'regle'
       and (v_meta ->> 'case_id') is not distinct from p.case_id::text;

  -- ---------------- Le reçu ----------------
  elsif p_kind = 'recu' then
    v_entity_kind := 'payment';
    select p.agency_id, p.office_id, p.client_id, p.receipt_no,
           jsonb_build_object(
             'receipt_no', p.receipt_no, 'kind', p.kind, 'label', p.label,
             'method', p.method, 'state', p.state, 'at', p.at,
             'currency', p.currency, 'case_id', p.case_id,
             'shipment_id', p.shipment_id),
           jsonb_build_object('total', p.amount, 'paid', p.amount, 'balance', 0)
      into v_agency, v_office, v_client, v_number, v_meta, v_totals
      from payments p where p.id = p_entity;

    v_lines := jsonb_build_array(jsonb_build_object(
      'line_no', 1, 'description', v_meta -> 'label',
      'quantity', 1, 'unit_price', v_totals -> 'total',
      'tax_rate', 0, 'discount', 0, 'line_total', v_totals -> 'total'));

  -- ---------------- La checklist de pièces ----------------
  elsif p_kind = 'checklist' or p_kind = 'fiche_dossier' then
    v_entity_kind := 'case';
    select c.agency_id, c.office_id, c.client_id, c.reference,
           jsonb_build_object(
             'reference', c.reference, 'stage', c.stage, 'status', c.status,
             'priority', c.priority, 'opened_at', c.opened_at,
             'travel_date', c.travel_date, 'due_at', c.due_at,
             'decision_at', c.decision_at, 'refusal_reason', c.refusal_reason,
             'consulate_ref', c.consulate_ref, 'currency', c.currency,
             'visa', (select jsonb_build_object('country', v.country, 'label', v.label,
                        'category', v.category, 'processing_days', v.processing_days)
                      from visa_types v where v.id = c.visa_type_id)),
           jsonb_build_object('total', c.amount_total, 'paid', c.amount_paid,
                              'balance', c.amount_total - c.amount_paid)
      into v_agency, v_office, v_client, v_number, v_meta, v_totals
      from cases c where c.id = p_entity;

    -- Les pièces sont les « lignes » du document : c'est ce que le client coche
    -- au comptoir, et c'est ce qui s'imprime.
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', d.key, 'label', d.label, 'help', d.help,
             'state', d.state, 'required', d.required,
             'received_at', d.received_at, 'validated_at', d.validated_at,
             'rejection_reason', d.rejection_reason, 'expires_at', d.expires_at)
           order by d.required desc, d.key), '[]'::jsonb)
      into v_lines
      from case_documents d where d.case_id = p_entity;

    if p_kind = 'fiche_dossier' then
      -- La fiche complète ajoute l'argent et le prochain rendez-vous. La
      -- checklist ne les porte pas : elle part au client, pas au dossier.
      select jsonb_build_object(
        'payments', coalesce((select jsonb_agg(jsonb_build_object(
            'at', p.at, 'amount', p.amount, 'method', p.method,
            'kind', p.kind, 'state', p.state, 'receipt_no', p.receipt_no)
          order by p.at) from payments p where p.case_id = p_entity), '[]'::jsonb),
        'appointment', (select jsonb_build_object('kind', a.kind, 'at', a.at,
            'location', a.location, 'status', a.status)
          from appointments a where a.case_id = p_entity and a.status = 'prevu'
          order by a.at limit 1),
        'notes', coalesce((select jsonb_agg(jsonb_build_object(
            'text', n.text, 'at', n.at) order by n.at desc)
          from (select * from case_notes where case_id = p_entity
                order by at desc limit 10) n), '[]'::jsonb))
        into v_extra;
    end if;

  -- ---------------- Le bon de livraison ----------------
  elsif p_kind = 'bon_livraison' then
    v_entity_kind := 'delivery';
    if to_regclass('public.deliveries') is null then
      raise exception 'le module logistique n''est pas installé' using errcode = 'P0001';
    end if;
    execute $q$
      select d.agency_id, d.office_id, d.client_id, null::text,
             jsonb_build_object(
               'address', d.address, 'contact_name', d.contact_name,
               'contact_phone', d.contact_phone, 'planned_at', d.planned_at,
               'delivered_at', d.delivered_at, 'driver_name', d.driver_name,
               'driver_phone', d.driver_phone, 'vehicle', d.vehicle,
               'status', d.status, 'failure_reason', d.failure_reason,
               'note', d.note, 'shipment_id', d.shipment_id,
               'shipment', (select jsonb_build_object('reference', s.reference,
                              'mode', s.mode, 'goods', s.goods,
                              'packages', s.packages, 'weight_kg', s.weight_kg,
                              'volume_cbm', s.volume_cbm, 'container_no', s.container_no)
                            from shipments s where s.id = d.shipment_id))
        from deliveries d where d.id = $1
    $q$ into v_agency, v_office, v_client, v_number, v_meta using p_entity;

    if to_regclass('public.shipment_goods') is not null then
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object(
                 'description', g.description, 'quantity', g.quantity,
                 'unit', g.unit, 'hs_code', g.hs_code,
                 'gross_weight_kg', g.gross_weight_kg) order by g.description), '[]'::jsonb)
          from shipment_goods g
         where g.shipment_id = (select shipment_id from deliveries where id = $1)
      $q$ into v_lines using p_entity;
    end if;

  -- ---------------- La fiche client ----------------
  elsif p_kind = 'fiche_client' then
    v_entity_kind := 'client';
    select c.agency_id, c.office_id, c.id, null::text,
           jsonb_build_object(
             'first_name', c.first_name, 'last_name', c.last_name,
             'native_name', c.native_name, 'email', c.email, 'phone', c.phone,
             'whatsapp', c.whatsapp, 'nationality', c.nationality,
             'passport_number', c.passport_number,
             'passport_expiry', c.passport_expiry, 'birth_date', c.birth_date,
             'address', c.address, 'locale', c.locale, 'tags', c.tags,
             'professional_status', c.professional_status,
             'employer', c.employer, 'created_at', c.created_at)
      into v_agency, v_office, v_client, v_number, v_meta
      from clients c where c.id = p_entity and c.deleted_at is null;

    -- Ses dossiers font le corps de la fiche : c'est son historique.
    select coalesce(jsonb_agg(jsonb_build_object(
             'reference', k.reference, 'stage', k.stage, 'status', k.status,
             'opened_at', k.opened_at, 'travel_date', k.travel_date,
             'amount_total', k.amount_total, 'amount_paid', k.amount_paid,
             'currency', k.currency,
             'visa', (select jsonb_build_object('country', v.country, 'label', v.label)
                      from visa_types v where v.id = k.visa_type_id))
           order by k.opened_at desc), '[]'::jsonb)
      into v_lines
      from cases k where k.client_id = p_entity;

    select jsonb_build_object(
      'contacts', coalesce((select jsonb_agg(jsonb_build_object(
          'kind', ct.kind, 'name', ct.name, 'relationship', ct.relationship,
          'email', ct.email, 'phone', ct.phone, 'is_primary', ct.is_primary))
        from client_contacts ct
        where ct.client_id = p_entity and ct.deleted_at is null), '[]'::jsonb),
      'stays', coalesce((select jsonb_agg(jsonb_build_object(
          'entry', s.entry_date, 'exit', s.exit_date, 'country', s.country)
        order by s.entry_date)
        from schengen_stays s where s.client_id = p_entity), '[]'::jsonb))
      into v_extra;

  -- ---------------- Le récapitulatif de cargaison ----------------
  elsif p_kind = 'cargaison' then
    v_entity_kind := 'shipment';
    select s.agency_id, s.office_id, null::uuid, s.reference,
           jsonb_build_object(
             'reference', s.reference, 'mode', s.mode, 'stage', s.stage,
             'status', s.status, 'supplier', s.supplier, 'goods', s.goods,
             'origin_city', s.origin_city, 'origin_port', s.origin_port,
             'dest_city', s.dest_city, 'dest_port', s.dest_port,
             'country_from', s.country_from, 'country_to', s.country_to,
             'incoterm', s.incoterm, 'container_no', s.container_no,
             'bl_number', s.bl_number, 'vessel', s.vessel,
             'packages', s.packages, 'weight_kg', s.weight_kg,
             'volume_cbm', s.volume_cbm, 'etd', s.etd, 'eta', s.eta,
             'arrived_at', s.arrived_at, 'cleared_at', s.cleared_at,
             'delivered_at', s.delivered_at, 'free_days', s.free_days)
      into v_agency, v_office, v_client, v_number, v_meta
      from shipments s where s.id = p_entity;

    select coalesce(jsonb_agg(jsonb_build_object(
             'description', g.description, 'quantity', g.quantity,
             'unit', g.unit, 'hs_code', g.hs_code, 'origin_country', g.origin_country,
             'gross_weight_kg', g.gross_weight_kg, 'net_weight_kg', g.net_weight_kg,
             'total_value', g.total_value, 'currency', g.currency)
           order by g.description), '[]'::jsonb)
      into v_lines
      from shipment_goods g where g.shipment_id = p_entity;

    if to_regclass('public.containers') is not null then
      execute $q$
        select jsonb_build_object('containers', coalesce(jsonb_agg(jsonb_build_object(
                 'container_number', c.container_number, 'container_type', c.container_type,
                 'seal_number', c.seal_number, 'gross_weight_kg', c.gross_weight_kg,
                 'volume_cbm', c.volume_cbm, 'status', c.status)
               order by c.container_number), '[]'::jsonb))
          from containers c where c.shipment_id = $1
      $q$ into v_extra using p_entity;
    end if;

  -- ---------------- Le rapport d'agence ----------------
  else
    -- Le rapport n'a pas d'objet : p_entity désigne un bureau, ou rien du tout
    -- pour l'agence entière. Il ne se lit pas sans le droit de voir les
    -- rapports, sinon l'impression contournerait l'écran des rapports.
    v_entity_kind := 'office';
    if not auth_can('reports:view') then
      raise exception 'droit insuffisant' using errcode = '42501';
    end if;
    v_agency := auth_agency_id();
    v_office := p_entity;
    if v_office is not null and not auth_sees_office(v_office) then
      raise exception 'bureau hors de votre périmètre' using errcode = '42501';
    end if;

    -- Les chiffres passent par les politiques comme le reste : un agent qui
    -- imprime le rapport n'y voit que ses bureaux, et c'est voulu.
    select jsonb_build_object(
        'cases_total', count(*) filter (where true),
        'cases_open', count(*) filter (where k.status = 'en_cours'),
        'cases_won', count(*) filter (where k.status = 'accepte'),
        'cases_lost', count(*) filter (where k.status = 'refuse'))
      into v_meta
      from cases k
     where k.agency_id = v_agency
       and (v_office is null or k.office_id = v_office);

    select jsonb_build_object(
        'clients', (select count(*) from clients c where c.agency_id = v_agency
                    and (v_office is null or c.office_id = v_office)),
        'shipments', (select count(*) from shipments s where s.agency_id = v_agency
                      and (v_office is null or s.office_id = v_office)),
        'collected', (select coalesce(sum(p.amount), 0) from payments p
                      where p.agency_id = v_agency and p.state = 'regle'
                        and (v_office is null or p.office_id = v_office)))
      into v_totals;

    -- Le détail par bureau, pour que le rapport d'agence se lise sans ouvrir
    -- huit écrans. Un bureau invisible ne remonte pas : la politique le filtre.
    select coalesce(jsonb_agg(jsonb_build_object(
             'office_id', o.id, 'name', o.name, 'city', o.city,
             'cases', (select count(*) from cases k where k.office_id = o.id))
           order by o.name), '[]'::jsonb)
      into v_lines
      from offices o
     where o.agency_id = v_agency and (v_office is null or o.id = v_office);
  end if;

  -- Rien n'est remonté : soit l'objet n'existe pas, soit les politiques l'ont
  -- écarté. On ne distingue pas les deux cas, dire « il existe mais pas pour
  -- vous » renseigne déjà celui qui cherche.
  if v_agency is null then
    raise exception 'document introuvable ou hors de votre périmètre'
      using errcode = '42501';
  end if;

  -- ---------------- Le décor commun : agence, bureau, client ----------------
  select jsonb_build_object(
      'id', a.id, 'name', coalesce(a.display_name, a.name),
      'legal_name', a.legal_name, 'tax_id', a.tax_id,
      'rc_number', a.rc_number, 'rc_court', a.rc_court,
      'legal_form', a.legal_form, 'capital', a.capital,
      'license_number', a.license_number, 'license_category', a.license_category,
      'ttn_ref', a.ttn_ref, 'inpdp_ref', a.inpdp_ref,
      'country', a.country, 'email', a.email, 'phone', a.phone,
      'website', a.website, 'currency', a.currency, 'mark', a.mark,
      'accent', coalesce(a.accent_color, a.accent), 'logo_path', a.logo_path,
      'default_locale', a.default_locale)
    into v_agency_j
    from agencies a where a.id = v_agency;

  select jsonb_build_object(
      'id', o.id, 'name', o.name, 'city', o.city, 'country', o.country,
      'country_code', o.country_code, 'phone', o.phone, 'address', o.address)
    into v_office_j
    from offices o where o.id = v_office;

  select jsonb_build_object(
      'id', c.id, 'first_name', c.first_name, 'last_name', c.last_name,
      'native_name', c.native_name, 'email', c.email, 'phone', c.phone,
      'address', c.address, 'nationality', c.nationality,
      'passport_number', c.passport_number, 'locale', c.locale)
    into v_client_j
    from clients c where c.id = v_client;

  -- La langue du document : celle du client s'il en a une, sinon celle de
  -- l'agence. Une facture part dans la langue de celui qui la lit.
  v_locale := coalesce(v_client_j ->> 'locale', v_agency_j ->> 'default_locale', 'fr');

  -- Le modèle : celui de la langue du document en priorité, sinon un autre
  -- modèle actif de la même nature. Aucun modèle n'est pas une erreur : le
  -- front sait imprimer sans, avec l'en-tête minimal.
  select jsonb_build_object(
      'id', t.id, 'name', t.name, 'locale', t.locale,
      'header_html', t.header_html, 'footer_html', t.footer_html,
      'css', t.css, 'logo_position', t.logo_position,
      'show_stamp', t.show_stamp, 'legal_mentions', t.legal_mentions)
    into v_tpl_j
    from document_templates t
   where t.agency_id = v_agency and t.kind = p_kind and t.active
   order by (t.locale = v_locale) desc, t.created_at
   limit 1;

  return jsonb_build_object(
    'kind', p_kind,
    'entity_kind', v_entity_kind,
    'entity_id', p_entity,
    'number', v_number,
    'locale', v_locale,
    'generated_at', now(),
    'agency', v_agency_j,
    'office', v_office_j,
    'client', v_client_j,
    'template', v_tpl_j,
    'meta', coalesce(v_meta, '{}'::jsonb),
    'lines', coalesce(v_lines, '[]'::jsonb),
    'totals', coalesce(v_totals, '{}'::jsonb),
    'extra', coalesce(v_extra, '{}'::jsonb),
    -- Les mentions légales sortent du modèle, à défaut du matricule de
    -- l'agence. Une facture tunisienne sans matricule est refusée : on aime
    -- mieux imprimer le matricule seul qu'un pied de page vide.
    'legal', jsonb_build_object(
      'mentions', v_tpl_j ->> 'legal_mentions',
      'tax_id', v_agency_j ->> 'tax_id',
      'rc_number', v_agency_j ->> 'rc_number',
      'capital', v_agency_j -> 'capital',
      'missing_tax_id', (v_agency_j ->> 'tax_id') is null)
  );
end $$;

comment on function document_payload(text, uuid) is
  'Tout ce qu''un document imprime, en un seul appel. SECURITY INVOKER volontairement : en DEFINER, l''impression serait devenue le trou par lequel on lit les dossiers des autres bureaux.';

-- ------------------------------------------------------------------
-- 5 · La trace, et le journal d'import
-- ------------------------------------------------------------------
--
-- SECURITY INVOKER là aussi : la politique d'insertion s'applique, et l'agence
-- ne peut pas être celle du voisin puisque la fonction la lit dans le jeton.

create or replace function document_trace(
  p_kind text, p_entity_kind text, p_entity uuid,
  p_number text default null, p_locale text default 'fr',
  p_sha256 text default null, p_storage_path text default null,
  p_office uuid default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare v_id uuid;
begin
  insert into generated_documents (
    agency_id, office_id, kind, entity_kind, entity_id,
    number, locale, storage_path, sha256, generated_by)
  values (
    auth_agency_id(), coalesce(p_office, auth_office_id()), p_kind,
    p_entity_kind, p_entity, nullif(btrim(coalesce(p_number, '')), ''),
    coalesce(p_locale, 'fr'), p_storage_path, lower(nullif(p_sha256, '')),
    auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Le compte rendu d'un import, en une écriture. Le front ne fait pas trois
-- allers-retours pour dire « c'est fini » : au milieu d'une coupure réseau, un
-- import se retrouverait éternellement « en cours ».
create or replace function import_job_finish(
  p_job uuid, p_status text, p_imported int, p_skipped int,
  p_errors jsonb default '[]'::jsonb
) returns void
language plpgsql
set search_path = public
as $$
begin
  update import_jobs
     set status = p_status,
         imported_rows = greatest(coalesce(p_imported, 0), 0),
         skipped_rows = greatest(coalesce(p_skipped, 0), 0),
         errors = coalesce(p_errors, '[]'::jsonb),
         finished_at = case when p_status in ('termine','echoue') then now() end
   where id = p_job;
end $$;

-- ------------------------------------------------------------------
-- 6 · Qui lit quoi
-- ------------------------------------------------------------------

alter table document_templates enable row level security;
alter table document_templates force row level security;
alter table generated_documents enable row level security;
alter table generated_documents force row level security;
alter table import_jobs enable row level security;
alter table import_jobs force row level security;

-- Les modèles se lisent par toute l'agence : un agent qui imprime doit voir le
-- modèle. Ils ne se règlent que dans les réglages, avec le droit qui va avec.
drop policy if exists document_templates_select on document_templates;
create policy document_templates_select on document_templates for select to authenticated
  using (agency_id = auth_agency_id());
drop policy if exists document_templates_insert on document_templates;
create policy document_templates_insert on document_templates for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('settings:manage'));
drop policy if exists document_templates_update on document_templates;
create policy document_templates_update on document_templates for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('settings:manage'))
  with check (agency_id = auth_agency_id() and auth_can('settings:manage'));
drop policy if exists document_templates_delete on document_templates;
create policy document_templates_delete on document_templates for delete to authenticated
  using (agency_id = auth_agency_id() and auth_can('settings:manage'));

-- La trace se lit par l'agence, dans les limites du bureau. Elle ne se modifie
-- NI ne s'efface : une trace qu'on peut réécrire ne prouve plus rien. Seule la
-- suppression de l'agence l'emporte, par la cascade.
drop policy if exists generated_documents_select on generated_documents;
create policy generated_documents_select on generated_documents for select to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id));
drop policy if exists generated_documents_insert on generated_documents;
create policy generated_documents_insert on generated_documents for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_sees_office(office_id));

drop policy if exists import_jobs_select on import_jobs;
create policy import_jobs_select on import_jobs for select to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id));
drop policy if exists import_jobs_insert on import_jobs;
create policy import_jobs_insert on import_jobs for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_sees_office(office_id)
              and auth_can('client:write'));
drop policy if exists import_jobs_update on import_jobs;
create policy import_jobs_update on import_jobs for update to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id)
         and auth_can('client:write'))
  with check (agency_id = auth_agency_id());
drop policy if exists import_jobs_delete on import_jobs;
create policy import_jobs_delete on import_jobs for delete to authenticated
  using (agency_id = auth_agency_id() and auth_role() in ('owner','manager'));

-- La plateforme lit pour le support, elle n'écrit pas. Même règle qu'en 0028.
drop policy if exists document_templates_platform_read on document_templates;
create policy document_templates_platform_read on document_templates for select to authenticated
  using (is_platform_admin());
drop policy if exists generated_documents_platform_read on generated_documents;
create policy generated_documents_platform_read on generated_documents for select to authenticated
  using (is_platform_admin());
drop policy if exists import_jobs_platform_read on import_jobs;
create policy import_jobs_platform_read on import_jobs for select to authenticated
  using (is_platform_admin());

revoke all on document_templates, generated_documents, import_jobs from public, anon, authenticated;
grant select, insert, update, delete on document_templates to authenticated;
-- Pas d'update ni de delete : une trace ne se réécrit pas.
grant select, insert on generated_documents to authenticated;
grant select, insert, update, delete on import_jobs to authenticated;
grant all on document_templates, generated_documents, import_jobs to service_role;

revoke all on function document_payload(text, uuid) from public, anon;
revoke all on function document_trace(text, text, uuid, text, text, text, text, uuid) from public, anon;
revoke all on function import_job_finish(uuid, text, int, int, jsonb) from public, anon;
grant execute on function document_payload(text, uuid) to authenticated;
grant execute on function document_trace(text, text, uuid, text, text, text, text, uuid) to authenticated;
grant execute on function import_job_finish(uuid, text, int, int, jsonb) to authenticated;

-- ------------------------------------------------------------------
-- 7 · Le piège des fonctions de déclencheur
-- ------------------------------------------------------------------
--
-- PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction nouvellement créée.
-- Ce lot n'en crée aucune de type déclencheur, mais la boucle reste : elle
-- coûte une milliseconde et elle rattrape l'oubli du lot suivant.
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
