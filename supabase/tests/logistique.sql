-- Banc d'essai de la logistique aval (migration 0048).
--
-- Ce banc garde ce qui coûte de l'argent quand c'est faux :
--   · le poids taxable aérien, calculé à la main dans les commentaires ;
--   · le jour où les surestaries démarrent ;
--   · l'immuabilité de la preuve de livraison ;
--   · les coûts, la marge, la tournée et la veille des arrivées ;
--   · le cloisonnement entre agences et entre bureaux.
--
-- Les valeurs attendues sont posées à la main. Si quelqu'un « simplifie » une
-- formule un mardi, le banc le dit le mardi.

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
  a1 uuid; a2 uuid;
  o1 uuid; o2 uuid; o3 uuid;
  u_owner uuid; u_agent uuid; u_other uuid;
  cl_a uuid; cl_b uuid;
  sh1 uuid; sh2 uuid; sh3 uuid; sh4 uuid; sh5 uuid;
  n1 uuid; n2 uuid; n3 uuid;
  awb1 uuid; awb2 uuid;
  wh1 uuid;
  d1 uuid; d2 uuid; d3 uuid;
  pod uuid;
  ev uuid;
  j jsonb; k jsonb;
  n int; ok boolean;
  -- Un suffixe tiré au hasard : le banc doit pouvoir tourner deux fois de
  -- suite sur la même base sans buter sur un identifiant déjà pris.
  sfx text := left(md5(random()::text), 8);
begin
  -- ================================================================
  -- Le décor : deux agences, trois bureaux, trois comptes
  -- ================================================================
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_owner;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_agent;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_other;

  insert into agencies (slug, name, services) values ('log-' || sfx, 'Test Logistique', '{fret}')
    returning id into a1;
  insert into agencies (slug, name, services) values ('log2-' || sfx, 'Autre Agence', '{fret}')
    returning id into a2;

  insert into offices (agency_id, name, country, country_code) values (a1, 'Tunis', 'Tunisie', 'TN')
    returning id into o1;
  insert into offices (agency_id, name, country, country_code) values (a1, 'Sfax', 'Tunisie', 'TN')
    returning id into o2;
  insert into offices (agency_id, name, country, country_code) values (a2, 'Tripoli', 'Libye', 'LY')
    returning id into o3;

  insert into profiles (id, agency_id, office_id, name, role) values
    (u_owner, a1, o1, 'Slim',  'owner'),
    (u_agent, a1, o2, 'Hatem', 'agent'),
    (u_other, a2, o3, 'Rania', 'owner');

  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (a1, o1, 'Mohamed', 'Bouazizi', '+216 20 100 010') returning id into cl_a;
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (a1, o2, 'Sonia', 'Kefi', '+216 20 100 011') returning id into cl_b;

  -- La cargaison de référence : un groupage 40 pieds sur Radès, 1 m³.
  insert into shipments (agency_id, office_id, reference, mode, country_from, country_to,
                         origin_port, dest_port, containers_count, container_type,
                         carrier, handler, volume_cbm, weight_kg, eta, status)
    values (a1, o1, 'LOG-2026-0001-' || sfx, 'maritime_lcl', 'CN', 'TN', 'Shanghai', 'Radès',
            1, '40', 'CMA CGM', 'STAM', 1, 800, current_date + 60, 'en_cours')
    returning id into sh1;

  -- Une cargaison qui arrive dans trois jours : la veille doit la voir.
  insert into shipments (agency_id, office_id, reference, mode, dest_port, container_type,
                         carrier, eta, status)
    values (a1, o1, 'LOG-2026-0002-' || sfx, 'maritime_fcl', 'Radès', '40', 'MSC',
            current_date + 3, 'en_cours')
    returning id into sh2;

  -- Une cargaison déjà en dépassement : la veille doit la voir aussi.
  insert into shipments (agency_id, office_id, reference, mode, dest_port, containers_count,
                         container_type, carrier, handler, arrived_at, discharged_at,
                         gate_out_at, status)
    values (a1, o1, 'LOG-2026-0003-' || sfx, 'maritime_fcl', 'Radès', 1, '40', 'CMA CGM', 'STAM',
            now() - interval '20 days', now() - interval '20 days',
            now() - interval '5 days', 'en_cours')
    returning id into sh3;

  -- Une cargaison de l'AUTRE bureau, pour le cloisonnement.
  insert into shipments (agency_id, office_id, reference, mode, dest_port, container_type, status)
    values (a1, o2, 'LOG-2026-0004-' || sfx, 'maritime_fcl', 'Sfax', '40', 'en_cours')
    returning id into sh4;

  -- Une cargaison de l'AUTRE agence.
  insert into shipments (agency_id, office_id, reference, mode, dest_port, status)
    values (a2, o3, 'AUT-2026-0001-' || sfx, 'routier', 'Tripoli', 'en_cours')
    returning id into sh5;

  -- Le barème de l'agence. Aucun chiffre n'est livré par défaut : c'est la
  -- règle du module fret, et elle vaut ici.
  insert into demurrage_tariffs (agency_id, kind, billed_by, port, container_type,
                                 free_days, tiers, valid_from)
    values (a1, 'surestaries', 'CMA CGM', 'Radès', '40', 7,
            '[{"from_day":1,"to_day":null,"rate":50}]'::jsonb, current_date - 90);

  -- ================================================================
  raise notice '--- 1 · Le poids taxable aérien, et sa confusion avec le maritime ---';
  -- ================================================================
  -- Règle IATA : 1 m³ = 1 000 000 cm³ / 6 000 = 166,666... kg, arrondi à 166,67.
  perform assert(air_chargeable_weight(100, 1) = 166.67,
    '100 kg pour 1 m³ : le volume l''emporte, 166,67 kg taxables');
  -- 300 kg de vraie balance pèsent plus que 166,67 : c'est le réel qui gagne.
  perform assert(air_chargeable_weight(300, 1) = 300,
    '300 kg pour 1 m³ : le poids réel l''emporte, 300 kg taxables');
  -- 3 m³ x 166,666... = 500 tout rond.
  perform assert(air_chargeable_weight(100, 3) = 500,
    '100 kg pour 3 m³ : 500 kg taxables');
  perform assert(air_chargeable_weight(500, 2) = 500,
    '500 kg pour 2 m³ : le réel l''emporte sur 333,33');
  perform assert(air_chargeable_weight(null, null) = 0,
    'sans poids ni volume, le poids taxable vaut zéro, pas null');
  -- La règle maritime W/M compare des TONNES à des mètres cubes, et rend une
  -- unité payante. La règle aérienne rend des kilos. Les confondre facture un
  -- envoi aérien au sixième de son prix.
  perform assert(chargeable_units(100, 1) = 1 and air_chargeable_weight(100, 1) = 166.67,
    'la règle maritime W/M et la règle aérienne ne rendent pas la même chose');

  -- ================================================================
  raise notice '--- 2 · La lettre de transport aérien ---';
  -- ================================================================
  -- Le poids taxable manquant se calcule avec le volume de la cargaison, sinon
  -- la case vide se remplit avec le poids réel et l'agence sous-facture.
  insert into air_waybills (agency_id, shipment_id, awb_number, kind, airline,
                            airport_origin, airport_destination, weight_kg, pieces)
    values (a1, sh1, '020-12345675', 'MASTER', 'Tunisair', 'PVG', 'TUN', 100, 12)
    returning id into awb1;
  perform assert((select chargeable_weight_kg from air_waybills where id = awb1) = 166.67,
    'le poids taxable manquant est calculé avec le volume de la cargaison');
  perform assert((select office_id from air_waybills where id = awb1) = o1,
    'la lettre de transport hérite du bureau de la cargaison');

  -- Le poids taxable annoncé par la compagnie fait foi : on ne le recalcule pas.
  insert into air_waybills (agency_id, shipment_id, awb_number, kind, airline,
                            weight_kg, chargeable_weight_kg)
    values (a1, sh1, '020-99999996', 'HOUSE', 'Tunisair', 100, 210)
    returning id into awb2;
  perform assert((select chargeable_weight_kg from air_waybills where id = awb2) = 210,
    'un poids taxable saisi par la compagnie n''est pas réécrit');

  -- ================================================================
  raise notice '--- 3 · L''avis d''arrivée et le départ des surestaries ---';
  -- ================================================================
  -- Jours francs saisis : début de stockage hier, 5 jours francs, donc la
  -- première journée facturable tombe dans 4 jours.
  insert into arrival_notices (agency_id, shipment_id, carrier_name, reference,
                               arrival_location, estimated_arrival, storage_start_date,
                               free_days, received_at)
    values (a1, sh1, 'CMA CGM', 'AVI-0001', 'Radès', now() - interval '1 day',
            current_date - 1, 5, now())
    returning id into n1;
  perform assert((select demurrage_start_date from arrival_notices where id = n1)
                 = current_date + 4,
    'le premier jour facturable est le début de stockage plus les jours francs');
  perform assert((select office_id from arrival_notices where id = n1) = o1,
    'l''avis d''arrivée hérite du bureau de la cargaison');

  -- Jours francs absents : ils viennent du barème de l'agence (0029), on ne les
  -- réinvente pas. Le barème de Radès en 40 pieds en accorde 7.
  insert into arrival_notices (agency_id, shipment_id, carrier_name, reference,
                               arrival_location, storage_start_date, received_at)
    values (a1, sh3, 'CMA CGM', 'AVI-0003', 'Radès', current_date - 20, now())
    returning id into n2;
  perform assert((select free_days from arrival_notices where id = n2) = 7,
    'sans jours francs saisis, on prend ceux du barème de l''agence');
  perform assert((select demurrage_start_date from arrival_notices where id = n2)
                 = current_date - 13,
    'et le premier jour facturable se déduit du même barème');

  -- Sans début de stockage, il n'y a rien à calculer : on ne devine pas une date.
  insert into arrival_notices (agency_id, shipment_id, reference, received_at)
    values (a1, sh2, 'AVI-0002', now()) returning id into n3;
  perform assert((select demurrage_start_date from arrival_notices where id = n3) is null,
    'sans début de stockage, le premier jour facturable reste vide');

  -- ================================================================
  raise notice '--- 4 · Le certificat d''origine : avertir, pas bloquer ---';
  -- ================================================================
  -- La Chine ne figure dans aucun accord préférentiel tunisien (voir 0030).
  perform assert(origin_certificate_warning('EUR1', 'CN') = 'origine_sans_preferentiel',
    'un EUR.1 sur une origine chinoise est signalé');
  perform assert(origin_certificate_warning('EUR1', 'FR') is null,
    'un EUR.1 sur une origine française ne l''est pas');
  perform assert(origin_certificate_warning('CERTIFICAT_ORIGINE', 'CN') is null,
    'un simple certificat d''origine ne revendique aucun préférentiel : pas d''avis');
  perform assert(origin_certificate_warning('ORIGINE_ARABE', 'US') is not null,
    'un certificat d''origine arabe sur une origine américaine est signalé');

  -- Avertie, pas bloquée : l'agence peut avoir une raison, et une saisie
  -- refusée se recopie ailleurs, hors de vue.
  insert into origin_certificates (agency_id, shipment_id, kind, origin_country,
                                   destination_country, reference, status)
    values (a1, sh1, 'EUR1', 'CN', 'TN', 'EUR1-0001', 'demande');
  select count(*) into n from origin_certificates
    where shipment_id = sh1 and kind = 'EUR1' and origin_country = 'CN';
  perform assert(n = 1,
    'un EUR.1 sur une origine chinoise est enregistré quand même : on avertit, on ne bloque pas');

  -- ================================================================
  raise notice '--- 5 · L''entrepôt ---';
  -- ================================================================
  insert into warehouses (agency_id, office_id, name, city, country, capacity_cbm, active)
    values (a1, o1, 'Entrepôt Radès', 'Radès', 'Tunisie', 1200, true)
    returning id into wh1;
  insert into warehouse_movements (agency_id, warehouse_id, shipment_id, direction,
                                   package_count, weight_kg, volume_cbm, at, operator_id)
    values (a1, wh1, sh1, 'ENTREE', 12, 800, 1, now(), u_owner);
  perform assert((select office_id from warehouse_movements
                  where warehouse_id = wh1 limit 1) = o1,
    'un mouvement hérite du bureau de son entrepôt');

  -- ================================================================
  raise notice '--- 6 · La livraison, et sa preuve immuable ---';
  -- ================================================================
  insert into deliveries (agency_id, shipment_id, client_id, address, contact_name,
                          contact_phone, planned_at, driver_name, status)
    values (a1, sh1, cl_a, '12 rue de Marseille, Tunis', 'Mohamed Bouazizi',
            '+216 20 100 010', now(), 'Karim', 'programmee')
    returning id into d1;
  insert into deliveries (agency_id, shipment_id, client_id, address, planned_at, status)
    values (a1, sh1, cl_a, 'Zone industrielle, Ben Arous',
            now() + interval '2 days', 'a_programmer')
    returning id into d2;
  perform assert((select office_id from deliveries where id = d1) = o1,
    'la livraison hérite du bureau de la cargaison');

  insert into proof_of_delivery (agency_id, delivery_id, recipient_name,
                                 recipient_id_number, signature_path, signed_at,
                                 gps_lat, gps_lng)
    values (a1, d1, 'Mohamed Bouazizi', '01234567', 'preuves/d1/signature.png',
            now(), 36.806389, 10.181667)
    returning id into pod;
  update deliveries set status = 'livree', delivered_at = now() where id = d1;
  perform assert(pod is not null, 'une preuve de livraison s''ajoute');

  -- Une preuve qu'on peut réécrire ne prouve rien. La modification échoue.
  ok := false;
  begin
    update proof_of_delivery set recipient_name = 'Quelqu''un d''autre' where id = pod;
  exception when others then ok := true;
  end;
  perform assert(ok, 'modifier une preuve de livraison échoue : elle est immuable');

  perform assert(not has_table_privilege('authenticated', 'proof_of_delivery', 'UPDATE'),
    'aucun droit de mise à jour sur la preuve n''est accordé');
  perform assert(has_table_privilege('authenticated', 'proof_of_delivery', 'INSERT'),
    'mais l''ajout d''une preuve reste ouvert');
  perform assert(not has_table_privilege('authenticated', 'deliveries', 'DELETE'),
    'rien ne s''efface dans ce module : aucun droit de suppression sur les livraisons');

  -- ================================================================
  raise notice '--- 7 · Les coûts et la marge ---';
  -- ================================================================
  -- 1 000 TND de fret refacturable, 500 TND de douane à la charge de l'agence,
  -- 100 USD de transport au taux 3,1 soit 310 TND refacturables.
  --   total_base         = 1000 + 500 + 310 = 1 810
  --   total_refacturable = 1000 + 310       = 1 310
  insert into shipment_costs (agency_id, shipment_id, kind, supplier_name, amount,
                              currency, fx_rate, billable_to_client, incurred_on, created_by)
    values (a1, sh1, 'FRET', 'CMA CGM', 1000, 'TND', 1, true, current_date, u_owner);
  insert into shipment_costs (agency_id, shipment_id, kind, supplier_name, amount,
                              currency, fx_rate, billable_to_client, incurred_on, created_by)
    values (a1, sh1, 'DOUANE', 'Recette des douanes', 500, 'TND', 1, false, current_date, u_owner);
  insert into shipment_costs (agency_id, shipment_id, kind, supplier_name, amount,
                              currency, fx_rate, billable_to_client, incurred_on, created_by)
    values (a1, sh1, 'TRANSPORT', 'Transporteur local', 100, 'USD', 3.1, true, current_date, u_owner);

  perform assert((select amount_base from shipment_costs
                  where shipment_id = sh1 and kind = 'TRANSPORT') = 310,
    '100 USD au taux 3,1 font 310 en devise de l''agence');

  perform test_login(u_owner, a1, 'owner', o1);
  j := shipment_cost_summary(sh1);
  perform assert((j->>'total_base')::numeric = 1810,
    'le total des coûts est de 1 810, toutes devises ramenées à celle de l''agence');
  perform assert((j->'par_nature'->>'FRET')::numeric = 1000,
    'le total par nature isole les 1 000 de fret');
  perform assert((j->'par_nature'->>'DOUANE')::numeric = 500,
    'et les 500 de douane');
  perform assert((j->>'total_refacturable')::numeric = 1310,
    'le refacturable au client vaut 1 310 : la douane reste à la charge de l''agence');
  perform assert((j->>'total_non_refacturable')::numeric = 500,
    'et le non refacturable vaut 500');

  -- 2 000 TND d'honoraires réglés, plus 300 de débours. Les débours sont
  -- encaissés pour être reversés : ils ne sont pas du revenu.
  insert into payments (agency_id, shipment_id, client_id, label, kind, amount,
                        currency, fx_rate, state, office_id)
    values (a1, sh1, cl_a, '{"fr":"Honoraires"}'::jsonb, 'honoraires', 2000,
            'TND', 1, 'regle', o1);
  insert into payments (agency_id, shipment_id, client_id, label, kind, amount,
                        currency, fx_rate, state, office_id)
    values (a1, sh1, cl_a, '{"fr":"Débours douane"}'::jsonb, 'debours', 300,
            'TND', 1, 'regle', o1);

  j := shipment_pnl(sh1);
  perform assert((j->>'facture')::numeric = 2000,
    'le facturé vaut 2 000 : les débours ne sont pas du revenu');
  perform assert((j->>'encaisse')::numeric = 2000, 'et tout est encaissé');
  perform assert((j->>'couts')::numeric = 1810, 'les coûts valent 1 810');
  perform assert((j->>'marge')::numeric = 190, '2 000 moins 1 810 font 190 de marge');
  perform assert((j->>'marge_pct')::numeric = 9.50, 'soit 9,50 % du facturé');
  -- La table des factures est construite par un autre module, en parallèle. La
  -- marge dit si elle a pu la lire, plutôt que de faire semblant.
  perform assert((j->>'source_factures')::boolean = (to_regclass('public.invoices') is not null),
    'la marge annonce si elle a pu lire la table des factures');

  -- ================================================================
  raise notice '--- 8 · La tournée du jour ---';
  -- ================================================================
  j := delivery_plan(o1, current_date);
  perform assert(jsonb_array_length(j) = 1, 'la tournée du jour compte une livraison');
  perform assert(j->0->>'address' = '12 rue de Marseille, Tunis',
    'la feuille de route porte l''adresse');
  perform assert(j->0->>'contact_phone' = '+216 20 100 010',
    'et le téléphone du contact : sans lui le chauffeur tourne en rond');
  perform assert(j->0->>'client' = 'Mohamed Bouazizi', 'et le nom du client');
  perform assert(j->0->>'status' = 'livree', 'et l''état de la livraison');
  perform assert(j->0->'proof'->>'recipient_name' = 'Mohamed Bouazizi',
    'la preuve signée apparaît dans la tournée');

  k := delivery_plan(o1, current_date + 1);
  perform assert(jsonb_array_length(k) = 0,
    'la livraison prévue dans deux jours n''est pas dans la tournée de demain');
  perform assert(jsonb_array_length(delivery_plan(o1, current_date + 2)) = 1,
    'elle est bien dans celle d''après-demain');

  -- ================================================================
  raise notice '--- 9 · La veille des arrivées ---';
  -- ================================================================
  j := arrival_watch(a1, 7);

  -- Ce qui arrive : la cargaison attendue dans trois jours.
  perform assert(exists (
    select 1 from jsonb_array_elements(j->'arrivees') e
    where e->>'reference' = 'LOG-2026-0002-' || sfx),
    'la veille voit la cargaison attendue dans trois jours');
  perform assert(not exists (
    select 1 from jsonb_array_elements(j->'arrivees') e
    where e->>'reference' = 'LOG-2026-0001-' || sfx),
    'et pas celle attendue dans soixante jours');

  -- Les jours francs qui se terminent : l'avis dont le premier jour facturable
  -- tombe dans quatre jours.
  perform assert(exists (
    select 1 from jsonb_array_elements(j->'francs_qui_finissent') e
    where (e->>'notice_id')::uuid = n1 and (e->>'jours_restants')::int = 4),
    'la veille annonce les quatre jours francs qui restent');

  -- Ce qui coûte déjà : les compteurs de 0029 font le chiffrage, pas nous.
  -- Vingt jours de stockage, sortie il y a cinq jours : 15 jours écoulés,
  -- 7 francs, 8 de dépassement à 50, soit 400.
  perform assert(exists (
    select 1 from jsonb_array_elements(j->'en_surestaries') e
    where e->>'reference' = 'LOG-2026-0003-' || sfx),
    'la veille voit la cargaison déjà en dépassement');
  perform assert((
    select (c->>'amount')::numeric
    from jsonb_array_elements(j->'en_surestaries') e,
         jsonb_array_elements(e->'compteurs') c
    where e->>'reference' = 'LOG-2026-0003-' || sfx and c->>'kind' = 'surestaries') = 400,
    'et le montant vient de shipment_counters : 8 jours à 50 font 400');

  perform assert(jsonb_array_length(arrival_watch(a1, 0)->'arrivees') = 0,
    'une veille à zéro jour ne montre rien qui arrive plus tard');

  -- ================================================================
  raise notice '--- 10 · Le suivi complète shipment_events, il ne la double pas ---';
  -- ================================================================
  perform assert(to_regclass('public.shipment_tracking_events') is null,
    'aucune seconde table de suivi : deux journaux donneraient deux dates d''arrivée');

  insert into shipment_events (agency_id, shipment_id, stage, event_type, location)
    values (a1, sh1, 'arrivee', 'ARRIVE', 'Radès') returning id into ev;
  perform assert((select event_at from shipment_events where id = ev) is not null,
    'un événement de suivi sans date d''événement se range à sa date d''écriture');
  perform assert((select source from shipment_events where id = ev) = 'manuel',
    'et sans source déclarée, il a été saisi à la main');

  ok := false;
  begin
    insert into shipment_events (agency_id, shipment_id, stage, event_type)
      values (a1, sh1, 'arrivee', 'ARRIVEE_INVENTEE');
  exception when check_violation then ok := true;
  end;
  perform assert(ok, 'une étape de suivi hors vocabulaire est refusée');

  -- ================================================================
  raise notice '--- 11 · Le cloisonnement entre agences ---';
  -- ================================================================
  insert into deliveries (agency_id, shipment_id, address, planned_at, status)
    values (a2, sh5, 'Souk el Joumaa, Tripoli', now(), 'programmee')
    returning id into d3;

  perform test_login(u_other, a2, 'owner', o3);
  set local role authenticated;
  select count(*) into n from deliveries;
  reset role;
  perform assert(n = 1, 'l''autre agence ne voit que sa propre livraison');

  set local role authenticated;
  select count(*) into n from shipment_costs;
  reset role;
  perform assert(n = 0, 'et aucun coût de la première agence');

  set local role authenticated;
  select count(*) into n from arrival_notices;
  reset role;
  perform assert(n = 0, 'ni aucun avis d''arrivée');

  -- Une fonction SECURITY DEFINER traverse les politiques : elle doit refuser
  -- elle-même, sinon l'identifiant d'une cargaison suffit à tout lire.
  ok := false;
  begin
    perform shipment_cost_summary(sh1);
  exception when others then ok := true;
  end;
  perform assert(ok, 'les coûts d''une cargaison d''une autre agence sont refusés');

  ok := false;
  begin
    perform arrival_watch(a1, 7);
  exception when others then ok := true;
  end;
  perform assert(ok, 'la veille d''une autre agence est refusée');

  ok := false;
  begin
    perform delivery_plan(o1, current_date);
  exception when others then ok := true;
  end;
  perform assert(ok, 'la tournée d''un bureau d''une autre agence est refusée');

  -- ================================================================
  raise notice '--- 12 · Le cloisonnement entre bureaux ---';
  -- ================================================================
  -- Un avis d'arrivée sur la cargaison du bureau de Sfax.
  insert into arrival_notices (agency_id, shipment_id, reference, storage_start_date,
                               free_days, received_at)
    values (a1, sh4, 'AVI-SFAX', current_date, 3, now());

  perform test_login(u_agent, a1, 'agent', o2);
  set local role authenticated;
  select count(*) into n from arrival_notices;
  reset role;
  perform assert(n = 1, 'un agent de Sfax ne voit que l''avis d''arrivée de son bureau');

  set local role authenticated;
  select count(*) into n from deliveries;
  reset role;
  perform assert(n = 0, 'et aucune livraison de Tunis');

  ok := false;
  begin
    perform delivery_plan(o1, current_date);
  exception when others then ok := true;
  end;
  perform assert(ok, 'il ne consulte pas non plus la tournée de Tunis');

  -- La direction, elle, voit toute l'agence.
  perform test_login(u_owner, a1, 'owner', o1);
  set local role authenticated;
  select count(*) into n from arrival_notices;
  reset role;
  perform assert(n = 4, 'le propriétaire voit les quatre avis d''arrivée de son agence');
  perform assert(jsonb_array_length(delivery_plan(o2, current_date)) = 0,
    'et il peut consulter la tournée de Sfax, même vide');

  raise notice '--- banc de la logistique aval : tout est vert ---';
end $$;
