-- Banc d'essai du cargo avancé (migration 0054).
--
-- Il garde huit choses qui coûtent cher quand elles sont fausses :
--   · le solde fournisseur, calculé sur des mouvements connus ;
--   · l'encours d'un client, qui décide de vendre à crédit ou pas ;
--   · le choix de la checklist douanière, et ce qu'elle dit qui manque ;
--   · le statut public, qui ne doit contenir AUCUNE prévision ;
--   · la cohérence de l'origine préférentielle avec la Chine ;
--   · le cloisonnement entre agences et entre bureaux.
--
-- Les montants attendus sont calculés à la main dans les commentaires. Si
-- quelqu'un « simplifie » une formule un jour, le banc le dit.

\set ON_ERROR_STOP on
set search_path = public;

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then
    raise notice 'OK    %', label;
  else
    raise exception 'ÉCHEC %', label;
  end if;
end $$;

do $$
declare
  a1 uuid; a2 uuid; o_tunis uuid; o_sfax uuid; o_autre uuid;
  u_owner uuid; u_agent uuid; u_autre uuid;
  cl1 uuid; sh uuid; sh2 uuid;
  fournisseur uuid; po uuid; decl uuid;
  liste_generique uuid; liste_precise uuid; liste_export uuid;
  j jsonb; k jsonb;
  n int; ok boolean; v_hook uuid; v_num numeric;
begin
  -- ================================================================
  -- Le décor : deux agences, deux bureaux, une cargaison de Chine
  -- ================================================================
  -- Le banc se rejoue. Sans ce ménage, la deuxième exécution tombe sur
  -- « duplicate key agencies_slug_key » et on ne voit plus aucune assertion.
  delete from agencies where slug in ('cargo2', 'cargo2b');

  insert into auth.users (id) values (gen_random_uuid()) returning id into u_owner;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_agent;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_autre;

  insert into agencies (slug, name, services) values ('cargo2', 'Banc Cargo', '{fret}') returning id into a1;
  insert into agencies (slug, name, services) values ('cargo2b', 'Agence Voisine', '{fret}') returning id into a2;

  insert into offices (agency_id, name, country, country_code) values (a1, 'Tunis', 'Tunisie', 'TN') returning id into o_tunis;
  insert into offices (agency_id, name, country, country_code) values (a1, 'Sfax', 'Tunisie', 'TN') returning id into o_sfax;
  insert into offices (agency_id, name, country, country_code) values (a2, 'Ailleurs', 'Tunisie', 'TN') returning id into o_autre;

  insert into profiles (id, agency_id, office_id, name, role) values
    (u_owner, a1, o_tunis, 'Slim',  'owner'),
    (u_agent, a1, o_sfax,  'Hatem', 'agent'),
    (u_autre, a2, o_autre, 'Rania', 'owner');

  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (a1, o_tunis, 'Mohamed', 'Bouazizi', '+216 20 900 001') returning id into cl1;

  insert into shipments (agency_id, office_id, reference, mode, country_from, country_to,
                         origin_port, dest_port, containers_count, container_type)
    values (a1, o_tunis, 'CG2-0001', 'maritime_lcl', 'CN', 'TN', 'Shanghai', 'Radès', 1, '40')
    returning id into sh;

  -- ================================================================
  raise notice '--- 1 · Marchandises dangereuses : les neuf classes, et rien de plus ---';
  -- ================================================================
  select count(*) into n from dangerous_goods_classes;
  perform assert(n = 9, 'les neuf classes principales sont livrées, sans aucune sous-division inventée');

  perform assert(
    (select label->>'fr' from dangerous_goods_classes where code = '3') = 'Liquides inflammables',
    'la classe 3 porte son intitulé exact');

  -- Une sous-division saisie est acceptée : elle vient de la fiche de données
  -- de sécurité, VisaFlow ne la propose pas mais ne la refuse pas.
  insert into dangerous_goods_details (agency_id, shipment_id, un_number, hazard_class,
                                       packing_group, proper_shipping_name, emergency_contact)
    values (a1, sh, 'UN1263', '3', 'II', 'PEINTURE', '+216 71 000 000');
  perform assert(
    (select count(*) from dangerous_goods_details where shipment_id = sh) = 1,
    'une marchandise dangereuse s''enregistre avec son numéro ONU et son groupe d''emballage');

  ok := false;
  begin
    insert into dangerous_goods_details (agency_id, shipment_id, packing_group)
      values (a1, sh, 'IV');
  exception when check_violation then ok := true;
  end;
  perform assert(ok, 'un groupe d''emballage IV n''existe pas : la base le refuse');

  ok := false;
  begin
    insert into dangerous_goods_details (agency_id, shipment_id, hazard_class)
      values (a1, sh, '10');
  exception when check_violation then ok := true;
  end;
  perform assert(ok, 'il n''existe pas de classe 10 : la base la refuse');

  -- ================================================================
  raise notice '--- 2 · Température : la rupture se prouve par un relevé ---';
  -- ================================================================
  insert into reefer_requirements (agency_id, shipment_id, temperature_min, temperature_max,
                                   unit, product_kind)
    values (a1, sh, -18, -16, 'C', 'alimentaire');
  insert into reefer_readings (agency_id, shipment_id, reading_at, temperature, source) values
    (a1, sh, now() - interval '3 days', -17.5, 'sonde'),
    (a1, sh, now() - interval '2 days', -12.0, 'sonde'),
    (a1, sh, now() - interval '1 day',  -17.0, 'manuel');

  j := reefer_status(sh);
  perform assert(jsonb_array_length(j->0->'out_of_range') = 1,
    'un seul relevé sort de la consigne, et c''est lui qui prouve la rupture');
  perform assert((j->0->'out_of_range'->0->>'temperature')::numeric = -12.0,
    'le relevé hors plage est bien celui de moins douze degrés');
  perform assert((j->0->'last_reading'->>'temperature')::numeric = -17.0,
    'le dernier relevé est le plus récent, pas le plus grave');

  -- ================================================================
  raise notice '--- 3 · Assurance ---';
  -- ================================================================
  insert into cargo_insurance (agency_id, shipment_id, insurer, policy_number,
                               coverage_amount, currency, deductible, start_date, end_date, status)
    values (a1, sh, 'STAR Assurances', 'P-2026-441', 120000, 'TND', 1500,
            current_date - 10, current_date + 80, 'active');
  ok := false;
  begin
    insert into cargo_insurance (agency_id, shipment_id, start_date, end_date)
      values (a1, sh, current_date, current_date - 1);
  exception when check_violation then ok := true;
  end;
  perform assert(ok, 'une police qui finit avant de commencer est refusée');

  -- ================================================================
  raise notice '--- 4 · Inspections : savoir lequel manque ---';
  -- ================================================================
  j := shipment_inspections_state(sh);
  perform assert(j->'par_genre'->'TECHNIQUE'->>'result' = 'absente',
    'aucun contrôle technique enregistré : le genre est dit « absente », jamais « non requis »');
  perform assert(j->'controle_technique'->>'status' = 'absent',
    'et la pièce du contrôle technique manque aussi');

  insert into shipment_inspections (agency_id, shipment_id, kind, authority, performed_at, result, findings)
    values (a1, sh, 'PHYTOSANITAIRE', 'Protection des végétaux', now(), 'non_conforme', 'Palettes non traitées');
  insert into technical_control_documents (agency_id, shipment_id, reference, submitted_on, status)
    values (a1, sh, 'DCT-2026-77', current_date - 3, 'depose');

  j := shipment_inspections_state(sh);
  perform assert(j->'par_genre'->'PHYTOSANITAIRE'->>'result' = 'non_conforme',
    'le phytosanitaire non conforme se voit en un coup d''oeil');
  perform assert((j->>'non_conformes')::int = 1, 'un contrôle non conforme est compté');
  perform assert(j->'controle_technique'->>'status' = 'depose',
    'le contrôle technique déposé change d''état');

  -- ================================================================
  raise notice '--- 5 · Achats et solde fournisseur ---';
  -- ================================================================
  fournisseur := gen_random_uuid();
  insert into purchase_orders (agency_id, office_id, shipment_id, supplier_id, po_number,
                               currency, status, issued_on)
    values (a1, o_tunis, sh, fournisseur, 'PO-0001', 'USD', 'envoye', current_date)
    returning id into po;
  -- 10 x 25,50 = 255 ; 3 x 100 = 300 ; total 555.
  insert into purchase_order_items (agency_id, po_id, description, quantity, unit, unit_price, line_no)
    values (a1, po, 'Coques téléphone', 10, 'carton', 25.50, 1);
  insert into purchase_order_items (agency_id, po_id, description, quantity, unit, unit_price, line_no)
    values (a1, po, 'Chargeurs', 3, 'carton', 100, 2);

  select subtotal into v_num from purchase_orders where id = po;
  perform assert(v_num = 555, 'le total du bon de commande descend des lignes : 255 + 300');
  perform assert((select total from purchase_order_items
                  where po_id = po and line_no = 1) = 255,
    'le total d''une ligne d''achat est calculé par la base, pas par le navigateur');

  -- Facture 10 000 USD au taux 3,1 = 31 000. Paiement 4 000 = 12 400.
  -- Avoir 1 000 = 3 100. Solde : 31 000 - 12 400 - 3 100 = 15 500.
  insert into supplier_transactions (agency_id, supplier_id, shipment_id, kind, reference, amount, currency, fx_rate, occurred_on)
    values (a1, fournisseur, sh, 'facture', 'INV-CN-9001', 10000, 'USD', 3.1, current_date - 30);
  insert into supplier_transactions (agency_id, supplier_id, kind, reference, amount, currency, fx_rate, occurred_on)
    values (a1, fournisseur, 'paiement', 'VIR-1', 4000, 'USD', 3.1, current_date - 20);
  insert into supplier_transactions (agency_id, supplier_id, kind, reference, amount, currency, fx_rate, occurred_on)
    values (a1, fournisseur, 'avoir', 'AV-1', 1000, 'USD', 3.1, current_date - 10);

  perform assert(supplier_balance(fournisseur) = 15500,
    'le solde fournisseur est calculé : 31 000 facturés, 12 400 payés, 3 100 d''avoir');
  perform assert(supplier_balance(gen_random_uuid()) = 0,
    'un fournisseur sans mouvement a un solde nul, pas une case vide');

  -- ================================================================
  raise notice '--- 6 · Crédit client : l''encours se calcule ---';
  -- ================================================================
  j := client_credit_state(cl1);
  perform assert(not (j->>'configure')::boolean,
    'un client sans ligne de crédit n''est pas configuré');
  perform assert(not (j->>'bloque')::boolean,
    'et il n''est pas bloqué pour autant : l''agence n''a rien décidé');

  -- L'encours : 2 000 en retard de 20 jours, 4 000 à échoir, 9 000 annulés
  -- qui ne comptent pas. Total dû : 6 000.
  if to_regclass('public.invoices') is not null then
    execute format($q$
      insert into invoices (agency_id, office_id, client_id, issue_date, due_date, currency,
                            subtotal, total, paid_amount, balance_due, status)
      values (%L, %L, %L, current_date - 50, current_date - 20, 'TND', 2000, 2000, 0, 2000, 'en_retard'),
             (%L, %L, %L, current_date - 5,  current_date + 10, 'TND', 4000, 4000, 0, 4000, 'emise'),
             (%L, %L, %L, current_date - 60, current_date - 40, 'TND', 9000, 9000, 0, 9000, 'annulee')
    $q$, a1, o_tunis, cl1, a1, o_tunis, cl1, a1, o_tunis, cl1);
  else
    insert into payments (agency_id, shipment_id, client_id, label, kind, amount, currency, fx_rate, state, due_at) values
      (a1, sh, cl1, '{"fr":"Fret"}'::jsonb, 'fret', 2000, 'TND', 1, 'du', current_date - 20),
      (a1, sh, cl1, '{"fr":"Fret"}'::jsonb, 'fret', 4000, 'TND', 1, 'du', current_date + 10),
      (a1, sh, cl1, '{"fr":"Fret"}'::jsonb, 'fret', 9000, 'TND', 1, 'regle', current_date - 40);
  end if;

  insert into client_credit (client_id, agency_id, credit_limit, payment_terms_days, currency, updated_by)
    values (cl1, a1, 5000, 30, 'TND', u_owner);

  j := client_credit_state(cl1);
  perform assert((j->>'limite')::numeric = 5000, 'la limite est celle que l''agence a posée');
  perform assert((j->>'encours')::numeric = 6000,
    'l''encours est calculé : 2 000 en retard plus 4 000 à échoir, l''annulée ne compte pas');
  perform assert((j->>'disponible')::numeric = 0,
    'au-delà de la limite, le disponible tombe à zéro et jamais en dessous');
  perform assert((j->>'jours_de_retard')::int = 20,
    'le retard le plus ancien est de vingt jours');
  perform assert((j->>'bloque')::boolean,
    'un client au-delà de sa limite est bloqué : c''est tout l''intérêt du calcul');

  update client_credit set credit_limit = 10000 where client_id = cl1;
  j := client_credit_state(cl1);
  perform assert((j->>'disponible')::numeric = 4000, 'limite relevée à 10 000 : il reste 4 000');
  perform assert(not (j->>'bloque')::boolean, 'et le client n''est plus bloqué');

  update client_credit set on_hold = true, hold_reason = 'chèque impayé' where client_id = cl1;
  j := client_credit_state(cl1);
  perform assert((j->>'bloque')::boolean and j->>'motif' = 'chèque impayé',
    'une suspension manuelle bloque même sous la limite, et dit pourquoi');
  update client_credit set on_hold = false, hold_reason = null where client_id = cl1;

  -- ================================================================
  raise notice '--- 7 · La checklist douanière ---';
  -- ================================================================
  select count(*) into n from customs_checklists where agency_id = a1;
  perform assert(n = 2, 'une agence nouvelle reçoit le socle import et le socle export');

  j := customs_checklist_for(sh);
  perform assert(j->>'direction' = 'IMPORT',
    'le sens du mouvement se déduit des pays : Chine vers Tunisie est un import');
  perform assert(j->'checklist'->>'name' = 'Import Tunisie, socle',
    'la liste d''import est retenue, pas celle d''export');
  perform assert((j->'checklist'->>'specificite')::int = 2,
    'le socle remplit deux critères : le sens et le pays de destination');

  -- Une liste plus précise : même sens, même destination, plus l'origine et le
  -- mode. Quatre critères contre deux : c'est elle qui doit gagner.
  insert into customs_checklists (agency_id, name, direction, origin_country,
                                  destination_country, transport_mode)
    values (a1, 'Import Chine maritime', 'IMPORT', 'CN', 'TN', 'maritime')
    returning id into liste_precise;
  insert into customs_checklist_items (agency_id, checklist_id, code, label, required, position) values
    (a1, liste_precise, 'facture', '{"fr":"Facture commerciale","en":"Commercial invoice","ar":"الفاتورة التجارية","zh":"商业发票"}'::jsonb, true, 10),
    (a1, liste_precise, 'packing', '{"fr":"Liste de colisage","en":"Packing list","ar":"قائمة التعبئة","zh":"装箱单"}'::jsonb, true, 20),
    (a1, liste_precise, 'bl',      '{"fr":"Connaissement","en":"Bill of lading","ar":"سند الشحن","zh":"提单"}'::jsonb, true, 30),
    (a1, liste_precise, 'origine', '{"fr":"Certificat d''origine","en":"Certificate of origin","ar":"شهادة المنشأ","zh":"原产地证"}'::jsonb, false, 40);

  j := customs_checklist_for(sh);
  perform assert(j->'checklist'->>'name' = 'Import Chine maritime',
    'la liste la plus spécifique gagne : quatre critères remplis contre deux');
  perform assert((j->'checklist'->>'specificite')::int = 4,
    'et sa spécificité est bien de quatre');

  perform assert((j->>'manquantes')::int = 4,
    'sans aucune pièce reçue, les quatre manquent');
  perform assert((j->>'manquantes_requises')::int = 3,
    'trois d''entre elles sont exigées ; le certificat d''origine reste facultatif');

  insert into shipment_documents (agency_id, shipment_id, key, label, state, required, received_at) values
    (a1, sh, 'facture', '{"fr":"Facture commerciale"}'::jsonb, 'validee', true, now()),
    (a1, sh, 'packing', '{"fr":"Liste de colisage"}'::jsonb, 'recue', true, now()),
    (a1, sh, 'bl',      '{"fr":"Connaissement"}'::jsonb, 'demandee', true, null);

  j := customs_checklist_for(sh);
  perform assert((j->>'manquantes')::int = 2,
    'facture validée et colisage reçu : il ne manque plus que deux pièces');
  perform assert((j->>'manquantes_requises')::int = 1,
    'une pièce demandée n''est pas une pièce reçue : le connaissement manque toujours');
  perform assert(
    (select p->>'etat' from jsonb_array_elements(j->'pieces') p where p->>'code' = 'bl') = 'manquante',
    'une pièce seulement demandée est comptée manquante, jamais présente');

  -- Une liste d'export ne doit pas s'appliquer à un import.
  insert into customs_checklists (agency_id, name, direction, origin_country, destination_country, transport_mode, hs_chapter)
    values (a1, 'Export vers la Libye', 'EXPORT', 'TN', 'LY', 'routier', '85')
    returning id into liste_export;
  j := customs_checklist_for(sh);
  perform assert(j->'checklist'->>'name' = 'Import Chine maritime',
    'une liste d''export, même très spécifique, ne s''applique pas à un import');

  -- ================================================================
  raise notice '--- 8 · Origine préférentielle : la Chine n''ouvre rien ---';
  -- ================================================================
  perform assert(not origin_preferential_allowed('CN'),
    'la Chine ne figure dans aucun accord préférentiel tunisien');
  perform assert(origin_preferential_allowed('FR'),
    'la France, elle, ouvre droit au préférentiel');

  if to_regclass('public.shipment_goods') is not null then
    perform assert(exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'shipment_goods'
        and column_name = 'preferential_origin'),
      'les quatre colonnes d''origine sont posées sur shipment_goods');

    ok := false;
    begin
      execute format($q$
        insert into shipment_goods (agency_id, shipment_id, description, origin_country,
                                    preferential_origin)
        values (%L, %L, 'Accessoires', 'CN', true)
      $q$, a1, sh);
    exception when check_violation then ok := true;
    end;
    perform assert(ok,
      'une origine préférentielle réclamée depuis la Chine est refusée, comme les codes 404 et 971 en 0030');

    execute format($q$
      insert into shipment_goods (agency_id, shipment_id, description, origin_country,
                                  preferential_origin, certificate_type)
      values (%L, %L, 'Pièces françaises', 'FR', true, 'EUR.1')
    $q$, a1, sh);
    perform assert(true, 'une origine préférentielle française passe');
  else
    raise notice 'shipment_goods absente : le module s''est protégé, les colonnes d''origine sont reportées';
  end if;

  -- ================================================================
  raise notice '--- 9 · Le statut public : aucune prévision, aucun engagement ---';
  -- ================================================================
  j := customs_public_status(sh);
  perform assert(j->>'code' = 'piece_manquante',
    'une pièce exigée qui manque se dit, sans annoncer quoi que ce soit');

  insert into customs_declarations (agency_id, shipment_id, number, fx_rate, currency, status)
    values (a1, sh, 'DEC-CG2-1', 3.1, 'USD', 'deposee') returning id into decl;

  j := customs_public_status(sh);
  perform assert(j->>'code' = 'en_attente_de_mainlevee',
    'déclaration déposée : le dossier est EN ATTENTE de mainlevée, il n''est pas « libéré demain »');
  perform assert(j->'label'->>'fr' = 'Le dossier est en attente de mainlevée.',
    'le libellé français est un constat, pas une promesse');
  perform assert(
    (j->'label' ? 'fr') and (j->'label' ? 'en') and (j->'label' ? 'ar') and (j->'label' ? 'zh'),
    'le libellé existe dans les quatre langues');

  -- Aucun libellé du vocabulaire ne contient de prévision ni d'engagement.
  select count(*) into n from customs_public_statuses
   where label->>'fr' ~* '(demain|sera |seront |d''ici|sous [0-9]|dans [0-9]|prévu|garant|promis)'
      or label->>'en' ~* '(tomorrow|will be|within [0-9]|expected|guarantee|promise)';
  perform assert(n = 0,
    'aucun statut public ne contient de prévision ni d''engagement');

  -- La garde : on ne peut pas écrire un statut inventé.
  ok := false;
  begin
    insert into customs_public_statuses (code, label)
      values ('bidon', jsonb_build_object(
        'fr','Votre marchandise sera libérée demain.',
        'en','Your goods will be released tomorrow.'));
  exception when check_violation then ok := true;
  end;
  perform assert(ok,
    'un statut qui annonce une décision douanière est refusé par la base');

  ok := false;
  begin
    insert into customs_public_notices (agency_id, shipment_id, code)
      values (a1, sh, 'sortie_prevue_demain');
  exception when foreign_key_violation then ok := true;
  end;
  perform assert(ok, 'on ne publie pas un code de statut qui n''existe pas');

  insert into customs_public_notices (agency_id, shipment_id, code, set_by)
    values (a1, sh, 'controle_en_cours', u_owner);
  perform assert(customs_public_status(sh)->>'code' = 'controle_en_cours',
    'le statut publié à la main prime, et il vient du vocabulaire clos');

  -- ================================================================
  raise notice '--- 10 · Transporteurs : l''architecture, et le suivi manuel ---';
  -- ================================================================
  insert into carrier_integrations (agency_id, provider, api_kind, secret_name, base_url, active)
    values (a1, 'demo_tracking', 'webhook', 'CARRIER_DEMO_TOKEN', 'https://exemple.invalid/api', true);

  v_hook := carrier_event_ingest('demo_tracking', 'CG2-0001',
    jsonb_build_object('status', 'chargement', 'location', 'Shanghai'));
  perform assert(
    (select shipment_id from carrier_tracking_webhooks where id = v_hook) = sh,
    'un événement se rattache à la cargaison par sa référence');
  perform assert(
    (select count(*) from shipment_events where shipment_id = sh and stage = 'chargement') = 1,
    'et il écrit une étape de suivi');
  perform assert(
    (select processed_at is not null from carrier_tracking_webhooks where id = v_hook),
    'l''événement traité est marqué comme tel');

  -- Une référence inconnue ne se devine pas : on garde l'événement et on dit
  -- pourquoi il n'est rattaché à rien.
  v_hook := carrier_event_ingest('demo_tracking', 'REF-INCONNUE', '{}'::jsonb);
  perform assert(
    (select shipment_id is null and error is not null from carrier_tracking_webhooks where id = v_hook),
    'une référence inconnue est conservée avec son motif, pas rattachée au hasard');

  ok := false;
  begin
    perform carrier_event_ingest('fournisseur_inconnu', 'X', '{}'::jsonb);
  exception when others then ok := true;
  end;
  perform assert(ok,
    'un événement qu''on ne peut rattacher à aucune agence est refusé, jamais rangé au hasard');

  -- ================================================================
  raise notice '--- 11 · Le cloisonnement ---';
  -- ================================================================
  insert into shipments (agency_id, office_id, reference, mode)
    values (a1, o_sfax, 'CG2-0002', 'routier') returning id into sh2;
  insert into purchase_orders (agency_id, office_id, shipment_id, supplier_id, po_number, status)
    values (a1, o_sfax, sh2, fournisseur, 'PO-SFAX-1', 'brouillon');

  -- L'agence voisine ne voit rien de tout ça.
  perform test_login(u_autre, a2, 'owner', o_autre);
  set local role authenticated;
  select count(*) into n from cargo_insurance;
  perform assert(n = 0, 'l''agence voisine ne voit aucune police de la première');
  select count(*) into n from purchase_orders;
  perform assert(n = 0, 'ni aucun de ses bons de commande');
  select count(*) into n from supplier_transactions;
  perform assert(n = 0, 'ni aucun mouvement de son compte fournisseur');
  select count(*) into n from customs_checklists;
  perform assert(n = 2, 'elle voit ses deux listes à elle, et seulement les siennes');
  reset role;

  -- Le propriétaire voit ses deux bons de commande, l'agent de Sfax un seul.
  perform test_login(u_owner, a1, 'owner', o_tunis);
  set local role authenticated;
  select count(*) into n from purchase_orders;
  perform assert(n = 2, 'la direction voit les achats des deux bureaux');
  select count(*) into n from client_credit;
  perform assert(n = 1, 'et la ligne de crédit du client, parce qu''elle relève de la finance');
  reset role;

  perform test_login(u_agent, a1, 'agent', o_sfax);
  set local role authenticated;
  select count(*) into n from purchase_orders;
  perform assert(n = 1, 'l''agent de Sfax ne voit que les achats de Sfax');
  select count(*) into n from client_credit;
  perform assert(n = 0,
    'et il ne voit aucune ligne de crédit : elle est réservée à la finance');
  reset role;

  raise notice '--- banc du cargo avancé : tout est vert ---';
end $$;
