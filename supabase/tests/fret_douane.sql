-- Banc d'essai du fret et de la douane.
--
-- Ce banc garde trois choses qui coûtent de l'argent quand elles sont fausses :
-- le trajet en tronçons (il n'existe aucune ligne directe Chine vers Radès),
-- les trois compteurs de stationnement qu'on ne doit jamais confondre, et la
-- cascade fiscale douanière avec ses trois pièges documentés.
--
-- Les valeurs attendues de la cascade sont calculées à la main dans les
-- commentaires : si un jour quelqu'un « simplifie » la formule, le banc le dit.

\set ON_ERROR_STOP on
set search_path = public;

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then
    raise notice 'OK    %', label;
  else
    raise exception 'ECHEC %', label;
  end if;
end $$;

do $$
declare
  a1 uuid; o1 uuid; u1 uuid; cl_a uuid; cl_b uuid;
  sh uuid; sh2 uuid;
  lot_a uuid; lot_b uuid;
  mbl uuid;
  d1 uuid; d2 uuid; d3 uuid; d4 uuid;
  j jsonb; k jsonb; q jsonb;
  n int; ok boolean;
begin
  insert into auth.users (id) values (gen_random_uuid()) returning id into u1;
  insert into agencies (slug, name, services) values ('fretdouane', 'Test Fret', '{fret}') returning id into a1;
  insert into offices (agency_id, name, country, country_code) values (a1, 'Tunis', 'Tunisie', 'TN') returning id into o1;
  insert into profiles (id, agency_id, office_id, name, role) values (u1, a1, o1, 'Agent', 'agent');
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (a1, o1, 'Mohamed', 'Bouazizi', '+216 20 000 010') returning id into cl_a;
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (a1, o1, 'Sonia', 'Kefi', '+216 20 000 011') returning id into cl_b;

  -- ================================================================
  raise notice '--- 1 · Le trajet en tronçons ---';
  -- ================================================================
  -- Une expédition Chine vers Radès. Le tirant d'eau de Radès (-8,8 m) interdit
  -- toute ligne directe : il faut au moins un transbordement.
  insert into shipments (agency_id, reference, mode, country_from, country_to,
                         origin_port, dest_port, containers_count, container_type,
                         carrier, handler)
    values (a1, 'EXP-2026-0001', 'maritime_lcl', 'CN', 'TN',
            'Shanghai', 'Radès', 2, '40', 'CMA CGM', 'STAM')
    returning id into sh;

  perform assert(route_warning(sh) = 'aucun_troncon',
    'sans aucun tronçon saisi, le trajet est signalé');

  -- Un seul tronçon Shanghai vers Radès : physiquement impossible.
  insert into shipment_legs (agency_id, shipment_id, seq, mode, from_place, to_place, etd, eta)
    values (a1, sh, 1, 'maritime', 'Shanghai', 'Radès', date '2026-06-01', date '2026-07-10');
  perform assert(route_warning(sh) = 'transbordement_manquant',
    'un seul tronçon Chine vers Radès est signalé comme impossible');

  -- Le vrai trajet : long-courrier jusqu'à Malte, attente au hub, puis feeder.
  update shipment_legs set to_place = 'Malte (Marsaxlokk)', eta = date '2026-06-28'
    where shipment_id = sh and seq = 1;
  insert into shipment_legs (agency_id, shipment_id, seq, mode, from_place, to_place, etd, eta, carrier)
    values (a1, sh, 2, 'maritime', 'Malte (Marsaxlokk)', 'Radès',
            date '2026-07-03', date '2026-07-06', 'CMA CGM');

  perform assert(route_warning(sh) is null,
    'avec le transbordement, le trajet ne déclenche plus d''avis');

  j := shipment_route(sh);
  perform assert((j->>'legs_count')::int = 2, 'le trajet compte deux tronçons');
  perform assert((j->>'transship_count')::int = 1, 'un transbordement est compté');
  -- L'attente au hub : arrivée à Malte le 28/06, départ du feeder le 03/07.
  perform assert((j->'legs'->0->>'hub_wait_days')::int = 5,
    'l''attente au hub est de 5 jours, et elle est mesurée séparément');
  perform assert((j->'legs'->0->>'days')::int = 27,
    'le long-courrier dure 27 jours, distinct de l''attente');

  -- ================================================================
  raise notice '--- 2 · Les trois compteurs, jamais confondus ---';
  -- ================================================================
  perform assert(tier_amount('[{"from_day":1,"to_day":3,"rate":45},{"from_day":4,"to_day":null,"rate":90}]'::jsonb, 5) = 315,
    'les paliers sont progressifs : 3x45 + 2x90, pas 5x90');
  perform assert(tier_amount('[{"from_day":1,"to_day":3,"rate":45}]'::jsonb, 0) = 0,
    'zéro jour de dépassement ne facture rien');

  -- Sans barème saisi, on montre l'horloge mais on ne chiffre pas.
  update shipments set discharged_at = now() - interval '12 days',
                       gate_out_at   = now() - interval '4 days'
    where id = sh;
  j := shipment_counters(sh);
  perform assert(j->0->>'status' = 'tarif_absent',
    'sans barème saisi, on ne chiffre pas : on dit que le tarif manque');

  -- Les trois barèmes, saisis par l'agence. Aucun n'est livré par défaut.
  insert into demurrage_tariffs (agency_id, kind, billed_by, port, container_type, free_days, tiers, valid_from)
    values (a1, 'surestaries', 'CMA CGM', 'Radès', '40', 5,
            '[{"from_day":1,"to_day":3,"rate":45},{"from_day":4,"to_day":null,"rate":90}]'::jsonb,
            current_date - 60);
  insert into demurrage_tariffs (agency_id, kind, billed_by, port, container_type, free_days, tiers, valid_from)
    values (a1, 'detention', 'CMA CGM', 'Radès', '40', 3,
            '[{"from_day":1,"to_day":null,"rate":60}]'::jsonb, current_date - 60);
  insert into demurrage_tariffs (agency_id, kind, billed_by, port, container_type, free_days, tiers, valid_from)
    values (a1, 'magasinage', 'STAM', 'Radès', '40', 7,
            '[{"from_day":1,"to_day":null,"rate":20}]'::jsonb, current_date - 60);

  j := shipment_counters(sh);

  -- Surestaries : conteneur RESTÉ dans le terminal, du déchargement à la sortie.
  -- 12 jours écoulés, 5 francs, 7 de dépassement : 3x45 + 4x90 = 495, x2 conteneurs.
  perform assert(j->0->>'kind' = 'surestaries', 'le premier compteur est celui des surestaries');
  perform assert((j->0->>'elapsed_days')::int = 8,
    'les surestaries s''arrêtent à la SORTIE du terminal, pas aujourd''hui');
  perform assert((j->0->>'overdue_days')::int = 3, 'huit jours moins cinq francs font trois');
  perform assert((j->0->>'amount')::numeric = 270,
    'surestaries : 3 jours à 45 font 135, multipliés par 2 conteneurs');
  perform assert(j->0->>'billed_by' = 'CMA CGM', 'les surestaries sont facturées par l''armateur');

  -- Détention : conteneur SORTI et non restitué, de la sortie à aujourd'hui.
  perform assert(j->1->>'kind' = 'detention', 'le deuxième compteur est la détention');
  perform assert((j->1->>'elapsed_days')::int = 4, 'la détention part de la sortie du terminal');
  perform assert((j->1->>'overdue_days')::int = 1, 'quatre jours moins trois francs font un');
  perform assert((j->1->>'amount')::numeric = 120, 'détention : 1 jour à 60, pour 2 conteneurs');
  perform assert((j->1->>'running')::boolean, 'la détention tourne encore, le conteneur n''est pas rendu');

  -- Magasinage : stationnement de la MARCHANDISE, facturé par le manutentionnaire.
  perform assert(j->2->>'kind' = 'magasinage', 'le troisième compteur est le magasinage');
  perform assert(j->2->>'billed_by' = 'STAM',
    'le magasinage est facturé par le manutentionnaire, pas par l''armateur');
  perform assert((j->2->>'elapsed_days')::int = 12, 'le magasinage court toujours : rien n''est enlevé');
  perform assert((j->2->>'containers')::int = 1,
    'le magasinage porte sur la marchandise : il ne se multiplie pas par les conteneurs');
  perform assert((j->2->>'amount')::numeric = 100, 'magasinage : 5 jours à 20');

  perform assert(not (j->0->>'tarif_hors_periode')::boolean,
    'le barème en vigueur au démarrage du compteur est utilisé tel quel');

  -- Le jour de la mise en service, tous les conteneurs déjà au port ont démarré
  -- leur compteur avant que l'agence n'ait saisi le moindre barème. On chiffre
  -- quand même, avec le plus ancien barème connu, et on le signale.
  insert into shipments (agency_id, reference, mode, dest_port, containers_count,
                         container_type, carrier, handler, discharged_at, gate_out_at)
    values (a1, 'EXP-2026-0009', 'maritime_fcl', 'Sfax', 1, '20', 'MSC', 'GMS',
            now() - interval '20 days', now() - interval '9 days')
    returning id into sh2;
  insert into demurrage_tariffs (agency_id, kind, billed_by, port, container_type, free_days, tiers, valid_from)
    values (a1, 'surestaries', 'MSC', 'Sfax', '20', 4,
            '[{"from_day":1,"to_day":null,"rate":50}]'::jsonb, current_date);
  k := shipment_counters(sh2);
  perform assert(k->0->>'status' = 'en_depassement',
    'un conteneur arrivé avant la saisie du barème est quand même chiffré');
  perform assert((k->0->>'tarif_hors_periode')::boolean,
    'et le montant est signalé comme calculé hors période de validité');
  perform assert((k->0->>'amount')::numeric = 350, '11 jours moins 4 francs, à 50 : 350');

  -- Restituer le conteneur arrête la détention, et elle seule.
  update shipments set container_returned_at = now() - interval '2 days' where id = sh;
  j := shipment_counters(sh);
  perform assert((j->1->>'elapsed_days')::int = 2, 'la restitution arrête la détention');
  perform assert(not (j->1->>'running')::boolean, 'la détention ne tourne plus');
  perform assert((j->2->>'elapsed_days')::int = 12,
    'rendre le conteneur n''arrête pas le magasinage de la marchandise');

  -- ================================================================
  raise notice '--- 3 · Deux connaissements, jamais un ---';
  -- ================================================================
  insert into bills_of_lading (agency_id, shipment_id, kind, number, issuer, release_type)
    values (a1, sh, 'master', 'CMAU-MBL-0001', 'CMA CGM', 'telex_release')
    returning id into mbl;

  insert into shipment_lots (agency_id, shipment_id, client_id, volume_cbm, weight_kg)
    values (a1, sh, cl_a, 6, 1000) returning id into lot_a;
  insert into shipment_lots (agency_id, shipment_id, client_id, volume_cbm, weight_kg)
    values (a1, sh, cl_b, 2, 500) returning id into lot_b;

  insert into bills_of_lading (agency_id, shipment_id, kind, parent_id, lot_id, number, issuer)
    values (a1, sh, 'house', mbl, lot_a, 'HBL-0001', 'Groupeur');

  -- Un House sans Master n'existe pas dans le métier : la base le refuse.
  ok := false;
  begin
    insert into bills_of_lading (agency_id, shipment_id, kind, number)
      values (a1, sh, 'house', 'HBL-ORPHELIN');
  exception when check_violation then ok := true;
  end;
  perform assert(ok, 'un House B/L sans Master est refusé par la base');

  -- Un Master ne descend de rien.
  ok := false;
  begin
    insert into bills_of_lading (agency_id, shipment_id, kind, parent_id, number)
      values (a1, sh, 'master', mbl, 'MBL-AVEC-PARENT');
  exception when check_violation then ok := true;
  end;
  perform assert(ok, 'un Master B/L avec un parent est refusé');

  -- ================================================================
  raise notice '--- 4 · La solidarité de fait entre lots ---';
  -- ================================================================
  update shipment_lots set blocked_reason = 'fret impayé', blocked_since = now()
    where id = lot_a;

  j := lot_solidarity(sh);
  perform assert((j->>'active')::boolean,
    'tant que le conteneur n''est pas dépoté, la solidarité joue');
  perform assert((j->>'lots_blocked')::int = 1, 'un lot bloque');
  perform assert((j->>'lots_hostage')::int = 1,
    'l''autre lot est otage : il ne doit rien et il attend quand même');

  -- Le dépotage éteint la solidarité : après lui, chacun son sort.
  update shipments set stripped_at = now() where id = sh;
  j := lot_solidarity(sh);
  perform assert(not (j->>'active')::boolean, 'le dépotage éteint la solidarité');
  perform assert((j->>'lots_hostage')::int = 0, 'plus personne n''est otage après le dépotage');

  -- ================================================================
  raise notice '--- 5 · La règle W/M, et le forfait qui écrase les petits lots ---';
  -- ================================================================
  perform assert(chargeable_units(40, 0.2) = 1,
    'un carton de 40 kg pour 0,2 CBM se facture 1 unité, jamais 0,04');
  perform assert(chargeable_units(3000, 2) = 3, 'le poids l''emporte quand la marchandise est lourde');
  perform assert(chargeable_units(500, 4.5) = 4.5, 'le volume l''emporte quand elle est encombrante');

  -- Fret 100 par unité, dépotage 400 pour le conteneur, documentation 80 par House B/L.
  q := lot_quote(lot_a, 100, 400, 80);
  perform assert((q->>'chargeable_units')::numeric = 6, 'le gros lot fait 6 unités payantes');
  -- 6x100 = 600 de fret, 400 x 6/8 = 300 de dépotage, 80 de documentation.
  perform assert((q->>'total')::numeric = 980, 'gros lot : 600 + 300 + 80');
  perform assert((q->'lines'->1->>'amount')::numeric = 300,
    'le dépotage se répartit au prorata du CBM');

  k := lot_quote(lot_b, 100, 400, 80);
  -- 2x100 = 200, 400 x 2/8 = 100, 80 de forfait : 380 pour 2 unités.
  perform assert((k->>'total')::numeric = 380, 'petit lot : 200 + 100 + 80');
  perform assert((k->>'cost_per_unit')::numeric > (q->>'cost_per_unit')::numeric,
    'le forfait de documentation rend le petit lot plus cher à l''unité : le devis doit le montrer');

  j := consolidation_advice(sh);
  perform assert(j->>'advice' = 'groupage_pertinent', 'à 8 CBM, le groupage a du sens');
  update shipment_lots set volume_cbm = 14 where id = lot_a;
  perform assert(consolidation_advice(sh)->>'advice' = 'passer_en_fcl',
    'au-delà de 15 CBM cumulés, il faut comparer un conteneur complet');

  -- ================================================================
  raise notice '--- 6 · L''origine : la Chine n''ouvre aucun préférentiel ---';
  -- ================================================================
  perform assert(not origin_preferential_allowed('CN'),
    'la Chine ne figure dans aucun accord préférentiel tunisien');
  perform assert(origin_preferential_allowed('LY'), 'la Libye ouvre droit au préférentiel');
  perform assert(origin_preferential_allowed('MA'), 'le Maroc ouvre droit au préférentiel');
  perform assert(not origin_preferential_allowed('US'), 'les États-Unis, non');
  perform assert(ndp_valid('8517120010'), 'une NDP de dix chiffres est valable');
  perform assert(not ndp_valid('851712'), 'six chiffres ne font pas une NDP');

  insert into customs_declarations (agency_id, shipment_id, number, fx_rate, currency, vat_registered)
    values (a1, sh, 'DEC-0001', 3.1, 'USD', true) returning id into d1;

  -- Le code 404 sur une origine chinoise doit être refusé par la base.
  ok := false;
  begin
    insert into customs_articles (agency_id, declaration_id, line_no, designation,
                                  origin_country, preferential_code, invoice_value)
      values (a1, d1, 99, 'Marchandise chinoise', 'CN', '404', 100);
  exception when check_violation then ok := true;
  end;
  perform assert(ok, 'le code préférentiel 404 est refusé sur une origine chinoise');

  -- ================================================================
  raise notice '--- 7 · La cascade fiscale, et ses trois pièges ---';
  -- ================================================================
  -- Facture 10 000 USD, transport jusqu'à introduction 1 000, taux 3,1.
  -- Une commission à l'achat de 500 est déductible en droit MAIS n'est pas
  -- facturée distinctement : elle ne se retranche pas.
  --   vd_caf   = (10000 + 1000 - 0) x 3,1 = 34 100
  --   dd       = 34100 x 20 %  =  6 820
  --   dc       = 34100 x 10 %  =  3 410
  --   fodec    = 34100 x  1 %  =    341
  --   base_tva = 34100 + 6820 + 3410 + 341 = 44 671   <- le DC est dedans
  --   tva      = 44671 x 19 %  =  8 487,49
  --   somme_dt = 6820 + 3410 + 341 + 8487,49 = 19 058,49
  --   rpd      = max(19058,49 x 3 % ; 10) = 571,755
  --   total_dt = 19 630,245
  insert into customs_articles (agency_id, declaration_id, line_no, designation, origin_country,
                                invoice_value, additions, deductions,
                                dd_rate, dc_rate, fodec_rate, tva_rate)
    values (a1, d1, 1, 'Accessoires téléphonie', 'CN', 10000,
            '[{"code":"transport_assurance_jusqu_introduction","amount":1000}]'::jsonb,
            '[{"code":"commissions_achat","amount":500,"invoiced_separately":false}]'::jsonb,
            20, 10, 1, 19);

  j := customs_compute(d1);
  perform assert((j->'lignes'->0->>'vd_caf')::numeric = 34100,
    'la valeur en douane est convertie au taux du jour d''enregistrement');
  perform assert((j->'lignes'->0->>'deductions_art31_refusees')::numeric = 500,
    'une déduction non facturée distinctement n''est PAS retranchée');
  perform assert((j->'lignes'->0->>'base_tva')::numeric = 44671,
    'PIÈGE 1 : le droit de consommation entre dans l''assiette de la TVA');
  perform assert((j->'lignes'->0->>'tva')::numeric = 8487.49, 'la TVA vaut 8 487,49');
  perform assert((j->>'somme_dt')::numeric = 19058.49, 'la somme des droits et taxes est juste');
  perform assert((j->>'rpd')::numeric = 571.755, 'la RPD vaut 3 % de la somme');
  perform assert((j->>'total_dt')::numeric = 19630.245, 'le total liquidé est juste');
  perform assert(j->'alertes'->0->>'code' = 'deduction_non_facturee_distinctement',
    'l''agent est prévenu de la déduction refusée, il ne la découvre pas au redressement');

  -- PIÈGE 2 : le non-assujetti subit la majoration de 25 % de l'assiette TVA.
  --   base_tva = 44 671 x 1,25 = 55 838,75 · tva = 10 609,363
  insert into customs_declarations (agency_id, shipment_id, number, fx_rate, currency, vat_registered)
    values (a1, sh, 'DEC-0002', 3.1, 'USD', false) returning id into d2;
  insert into customs_articles (agency_id, declaration_id, line_no, designation, invoice_value,
                                additions, dd_rate, dc_rate, fodec_rate, tva_rate)
    values (a1, d2, 1, 'Idem, importateur non assujetti', 10000,
            '[{"code":"transport_assurance_jusqu_introduction","amount":1000}]'::jsonb,
            20, 10, 1, 19);
  j := customs_compute(d2);
  perform assert((j->'lignes'->0->>'base_tva')::numeric = 55838.75,
    'PIÈGE 2 : le non-assujetti voit son assiette TVA majorée de 25 %');
  perform assert((j->'lignes'->0->>'tva')::numeric = 10609.363, 'sa TVA vaut 10 609,363');
  perform assert((j->>'total_dt')::numeric = 21815.774, 'son total liquidé est plus lourd de 2 185');

  -- PIÈGE 3 : le plancher de RPD est de 10 DT PAR ARTICLE.
  insert into customs_declarations (agency_id, shipment_id, number, fx_rate, currency)
    values (a1, sh, 'DEC-0003', 1, 'TND') returning id into d3;
  insert into customs_articles (agency_id, declaration_id, line_no, designation,
                                invoice_value, dd_rate, tva_rate)
    select a1, d3, g, 'Article ' || g, 0, 0, 0 from generate_series(1, 12) g;
  j := customs_compute(d3);
  perform assert((j->>'articles')::int = 12, 'la déclaration compte douze articles');
  perform assert((j->>'rpd')::numeric = 120,
    'PIÈGE 3 : le plancher de RPD est de 10 DT PAR ARTICLE, soit 120, pas 10');
  perform assert((j->>'rpd_au_plancher')::boolean, 'et l''interface peut dire qu''on est au plancher');

  -- Une déduction FACTURÉE DISTINCTEMENT, elle, se retranche bien.
  insert into customs_declarations (agency_id, shipment_id, number, fx_rate, currency, air_applicable)
    values (a1, sh, 'DEC-0004', 1, 'TND', true) returning id into d4;
  insert into customs_articles (agency_id, declaration_id, line_no, designation, invoice_value,
                                deductions, dd_rate, tva_rate)
    values (a1, d4, 1, 'Avec commission à l''achat facturée à part', 1200,
            '[{"code":"commissions_achat","amount":200,"invoiced_separately":true}]'::jsonb,
            0, 0);
  j := customs_compute(d4);
  perform assert((j->'lignes'->0->>'vd_caf')::numeric = 1000,
    'une déduction facturée distinctement se retranche bien');
  -- AIR : (1000 + 10) x 10 % = 101, avec la RPD au plancher de 10 pour 1 article.
  perform assert((j->>'rpd')::numeric = 10, 'un seul article : plancher de 10 DT');
  perform assert((j->>'air')::numeric = 101,
    'le code 480 déclenche l''avance sur impôt de 10 % sur valeur plus droits');
  perform assert((j->>'total_a_payer')::numeric = 111, 'le total à payer inclut l''avance');

  -- ================================================================
  raise notice '--- 8 · Le titre de commerce extérieur et les délais ---';
  -- ================================================================
  declare
    tce uuid;
  begin
    insert into tce_titles (agency_id, shipment_id, form, number, designation, amount, quantity, currency)
      values (a1, sh, 'facture_commerciale', 'TCE-0001', 'Accessoires téléphonie', 10000, 500, 'USD')
      returning id into tce;

    j := tce_needs_amendment(tce, 'Accessoires téléphonie', 10500, 500);
    perform assert(not (j->>'necessaire')::boolean,
      'une hausse de 5 % ne demande pas de modification du titre');

    j := tce_needs_amendment(tce, 'Accessoires téléphonie', 11500, 500);
    perform assert((j->>'necessaire')::boolean,
      'une hausse de 15 % impose de modifier le titre, sinon le virement est bloqué');

    j := tce_needs_amendment(tce, 'Accessoires téléphonie', 8000, 500);
    perform assert(not (j->>'necessaire')::boolean,
      'une BAISSE de prix n''impose rien : seule la hausse compte');

    j := tce_needs_amendment(tce, 'Pièces détachées', 10000, 500);
    perform assert((j->>'necessaire')::boolean,
      'changer la désignation impose de modifier le titre');
  end;

  -- Les délais durs. La déclaration sommaire est due 1 jour franc après
  -- l'arrivée, dimanches non comptés.
  update shipments set arrived_at = timestamptz '2026-09-05 08:00+01' where id = sh;  -- un samedi
  j := customs_deadlines(sh);
  perform assert((j->'declaration_sommaire'->>'echeance')::date = date '2026-09-07',
    'arrivée le samedi : l''échéance saute le dimanche et tombe au lundi');
  perform assert(extract(dow from (j->'declaration_sommaire'->>'echeance')::date) <> 0,
    'l''échéance ne tombe jamais un dimanche');
  perform assert((j->'sejour_magasin'->>'echeance')::date = date '2026-09-20',
    'le séjour maximum en magasin est de quinze jours');

  raise notice '--- banc du fret et de la douane : tout est vert ---';
end $$;
