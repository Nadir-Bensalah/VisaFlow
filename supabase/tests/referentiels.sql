-- Banc d'essai des référentiels du fret.
--
-- Il garde cinq choses qui coûtent de l'argent quand elles sont fausses :
--   1. La clé de contrôle ISO 6346. Un numéro de conteneur mal saisi fait
--      perdre la boîte, et personne ne relie la panne à la faute de frappe.
--   2. Les totaux d'une cargaison, qui ne doivent JAMAIS compter la même
--      caisse trois fois, ni additionner des dollars avec des euros.
--   3. La résolution des intervenants, avec le repli sur le texte : la
--      migration ne convertit rien, l'ancien doit continuer de s'afficher.
--   4. Le cloisonnement des répertoires entre agences.
--   5. Le fait qu'un compte d'agence ne peut pas écrire dans un référentiel
--      partagé. Un code ISO corrigé par une agence le serait pour toutes.
--
-- Les vecteurs de la clé de contrôle sont calculés à la main dans les
-- commentaires. Si quelqu'un « simplifie » la formule un jour, le banc le dit.

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
  a1 uuid; a2 uuid; o1 uuid; o2 uuid;
  u1 uuid; u2 uuid;
  cl1 uuid;
  sh uuid; sh2 uuid;
  f1 uuid; f2 uuid; d1 uuid; e1 uuid; tr1 uuid; cd1 uuid;
  loc_rades uuid; loc_shanghai uuid;
  cont uuid;
  j jsonb; n int; ok boolean; s shipments;
begin
  insert into auth.users (id) values (gen_random_uuid()) returning id into u1;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u2;
  insert into agencies (slug, name, services) values ('ref47-alpha', 'Réf Alpha', '{fret}') returning id into a1;
  insert into agencies (slug, name, services) values ('ref47-beta',  'Réf Beta',  '{fret}') returning id into a2;
  insert into offices (agency_id, name, country, country_code) values (a1, 'Tunis', 'Tunisie', 'TN') returning id into o1;
  insert into offices (agency_id, name, country, country_code) values (a2, 'Sfax',  'Tunisie', 'TN') returning id into o2;
  insert into profiles (id, agency_id, office_id, name, role) values (u1, a1, o1, 'Hatem', 'agent');
  insert into profiles (id, agency_id, office_id, name, role) values (u2, a2, o2, 'Rania', 'owner');
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (a1, o1, 'Mohamed', 'Bouazizi', '+216 20 000 047') returning id into cl1;

  -- ================================================================
  raise notice '--- 1 · La clé de contrôle ISO 6346 ---';
  -- ================================================================
  --
  -- CSQU3054383 est le vecteur donné par la norme elle-même.
  -- C=13, S=30, Q=28, U=32, puis 3 0 5 4 3, pondérés 1 2 4 8 16 32 64 128 256 512.
  -- 13 + 60 + 112 + 256 + 48 + 0 + 320 + 512 + 768 + 4096 = 6185.
  -- 6185 = 562 x 11 + 3. La clé vaut donc 3, et c'est bien le dernier chiffre.
  perform assert(container_check_digit('CSQU3054383') = 3,
    'CSQU3054383 : la clé calculée vaut 3, comme la norme le dit');
  perform assert(container_number_valid('CSQU3054383'),
    'CSQU3054383 est accepté');

  -- Le même numéro avec UN chiffre changé doit tomber. C'est tout l'intérêt
  -- de la clé : elle attrape la faute de frappe, pas la faute de forme.
  perform assert(not container_number_valid('CSQU3054384'),
    'CSQU3054384 (dernier chiffre changé) est refusé');
  perform assert(not container_number_valid('CSQU3054883'),
    'CSQU3054883 (un chiffre de série changé) est refusé');
  perform assert(not container_number_valid('CSQV3054383'),
    'CSQV3054383 (une lettre changée) est refusé');

  -- La seule irrégularité de la norme : un reste de 10 s'écrit 0. C'est elle
  -- que les implémentations maison ratent, et elle refuse alors des
  -- conteneurs parfaitement valides.
  perform assert(container_check_digit('MSKU000008') = 0,
    'un reste de 10 s''écrit 0, et pas 10');
  perform assert(container_number_valid('MSKU0000080'),
    'MSKU0000080, dont le reste vaut 10, est accepté');

  -- La forme, avant la clé.
  perform assert(container_check_digit('ABC12345') is null,
    'une forme qui n''est pas celle d''un conteneur ne rend pas de clé');
  perform assert(not container_number_valid('ABCD12345'),
    'six chiffres au lieu de sept : refusé');
  perform assert(not container_number_valid('12CD3054383'),
    'des chiffres à la place des lettres du propriétaire : refusé');

  -- L'écran a besoin de la clé AVANT que l'agent l'ait tapée, et le numéro
  -- est écrit avec des espaces sur la porte du conteneur.
  perform assert(container_check_digit('CSQU305438') = 3,
    'le préfixe seul suffit à calculer la clé, pour la saisie à la frappe');
  perform assert(container_check_digit('csqu 305438 3') = 3,
    'les espaces et les minuscules du connaissement ne gênent pas le calcul');

  -- Le jeu de vecteurs PARTAGÉ avec web/src/lib/conteneur.ts. Le même
  -- algorithme vit des deux côtés, volontairement : le serveur fait autorité,
  -- l'écran répond à la frappe. Ces cinq lignes sont ce qui garantit qu'ils ne
  -- divergent pas. Toute valeur changée ici doit l'être là-bas aussi.
  perform assert(container_check_digit('TGHU0000008') = 8
             and container_check_digit('ZZZZ9999999') = 6
             and container_check_digit('AAAU0000000') = 7
             and container_check_digit('TCLU1234568') = 8
             and container_check_digit('MSKU0000080') = 0,
    'les vecteurs partagés avec le calcul TypeScript donnent les mêmes clés');

  -- ================================================================
  raise notice '--- 2 · Les référentiels partagés, semés sans rien inventer ---';
  -- ================================================================
  select count(*) into n from countries;
  perform assert(n >= 45, 'les pays du métier sont semés (' || n || ')');
  perform assert((select iso3 from countries where iso2 = 'TN') = 'TUN',
    'le code ISO de la Tunisie est exact');
  perform assert((select name_ar from countries where iso2 = 'LY') = 'ليبيا',
    'le nom arabe de la Libye est le nom usuel, pas une translittération');

  select count(*) into n from hs_codes;
  perform assert(n = 99, 'les 99 chapitres du système harmonisé sont semés');
  perform assert((select count(*) from hs_codes where code !~ '^[0-9]{2}$') = 0,
    'aucune position à six ou dix chiffres n''a été inventée');
  perform assert((select description_fr from hs_codes where code = '77') like 'Réservé%',
    'le chapitre 77 est dit réservé, il n''est pas rempli au hasard');

  select count(*) into n from incoterms;
  perform assert(n = 11, 'les onze Incoterms 2020 sont là, pas six');
  perform assert((select mode from incoterms where code = 'FOB') = 'maritime'
             and (select mode from incoterms where code = 'FCA') = 'tous',
    'FOB est maritime, FCA vaut pour tous les modes');

  perform assert((select code from transport_locations
                  where kind = 'PORT' and name like '%Radès%') = 'TNRDS',
    'le port de Radès porte son code de lieu');
  perform assert((select count(*) from transport_locations
                  where kind = 'POSTE_FRONTIERE' and code is not null) = 0,
    'aucun poste frontière n''a de code inventé : le champ reste vide');
  -- TNSFA désigne Sfax, et Sfax a un port ET un aéroport. L'unicité porte sur
  -- le couple genre + code, pas sur le code seul.
  perform assert((select count(*) from transport_locations where code = 'TNSFA') = 2,
    'un code de lieu désigne un lieu, pas un équipement : TNSFA sert deux fois');

  -- ================================================================
  raise notice '--- 3 · Le détail physique et les totaux ---';
  -- ================================================================
  insert into shipments (agency_id, office_id, reference, mode, supplier, carrier, broker_name, handler,
                         origin_port, dest_port, country_from, country_to, incoterm, weight_kg, volume_cbm)
    values (a1, o1, 'EXP-REF47-0001', 'maritime_fcl', 'Ningbo Sunrise CO', 'CMA CGM',
            'Bureau Ben Salah', 'STAM', 'Ningbo', 'Radès', 'CN', 'TN', 'FOB', 999, 9)
    returning id into sh;

  -- Deux conteneurs, numéros réels au sens de la norme.
  insert into containers (agency_id, shipment_id, container_number, container_type,
                          gross_weight_kg, net_weight_kg, volume_cbm, tare_kg, status)
    values (a1, sh, 'CSQU3054383', '40HC', 12000, 10800, 28, 3800, 'en_transit')
    returning id into cont;
  insert into containers (agency_id, shipment_id, container_number, container_type,
                          gross_weight_kg, volume_cbm)
    values (a1, sh, 'MSKU0000080', '40GP', 10000, 30);

  -- La saisie telle qu'elle arrive du quai : minuscules et espaces.
  insert into containers (agency_id, shipment_id, container_number, container_type)
    values (a1, sh, 'tghu 000000 8', '20GP');
  perform assert(exists (select 1 from containers
                         where shipment_id = sh and container_number = 'TGHU0000008'),
    'le numéro tapé « tghu 000000 8 » est rangé normalisé, pas rejeté');

  -- Un numéro faux doit tomber, même écrit par l'API.
  begin
    insert into containers (agency_id, shipment_id, container_number)
      values (a1, sh, 'CSQU3054384');
    ok := true;
  exception when check_violation then ok := false;
  end;
  perform assert(not ok, 'un numéro dont la clé est fausse est refusé par la base');

  begin
    insert into containers (agency_id, shipment_id, container_number)
      values (a1, sh, 'PAS UN NUMERO');
    ok := true;
  exception when check_violation then ok := false;
  end;
  perform assert(not ok, 'un numéro mal formé est refusé par la base');

  -- Les colis. Le volume est calculé, jamais saisi.
  insert into packages (agency_id, shipment_id, package_type, quantity,
                        gross_weight_kg, length_cm, width_cm, height_cm, description)
    values (a1, sh, 'CARTON', 10, 400, 100, 50, 40, 'Accessoires');
  perform assert((select volume_cbm from packages where shipment_id = sh and quantity = 10) = 2.0000,
    'le volume d''un colis est calculé : 100 x 50 x 40 cm, dix fois, font 2 m³');

  insert into packages (agency_id, shipment_id, package_type, quantity, gross_weight_kg)
    values (a1, sh, 'PALETTE', 7, 900);

  -- Les marchandises. La valeur totale est calculée, et les devises ne se
  -- mélangent pas.
  insert into shipment_goods (agency_id, shipment_id, description, hs_code, origin_country,
                              quantity, unit, gross_weight_kg, unit_value, currency)
    values (a1, sh, 'Chargeurs USB', '8504', 'CN', 100, 'PCE', 300, 25, 'USD');
  insert into shipment_goods (agency_id, shipment_id, description, hs_code, origin_country,
                              quantity, unit, unit_value, currency, dangerous_goods, un_number)
    values (a1, sh, 'Batteries lithium', '8507', 'CN', 50, 'PCE', 10, 'USD', true, 'UN3480');
  insert into shipment_goods (agency_id, shipment_id, description, hs_code,
                              quantity, unit, unit_value, currency)
    values (a1, sh, 'Pièces détachées', '8708', 10, 'PCE', 100, 'EUR');

  perform assert((select total_value from shipment_goods
                  where shipment_id = sh and description = 'Chargeurs USB') = 2500,
    'la valeur d''une ligne est calculée : 100 pièces à 25 font 2 500');

  select * into s from shipments where id = sh;
  j := shipment_totals(s);
  perform assert((j->>'containers')::int = 3, 'les trois conteneurs sont comptés');
  perform assert((j->>'packages')::int = 17, 'les colis se comptent en quantité, pas en lignes');
  -- 12 000 + 10 000, et surtout PAS 22 000 + 1 300 de colis + 300 de
  -- marchandises : ce serait peser trois fois la même caisse.
  perform assert((j->>'gross_weight_kg')::numeric = 22000,
    'le poids vient des conteneurs seuls, la même caisse n''est pas pesée trois fois');
  perform assert(j->>'weight_source' = 'conteneurs',
    'le total dit d''où il vient, sinon il n''est pas contestable');
  perform assert((j->>'volume_cbm')::numeric = 58, 'le volume vient des conteneurs');
  perform assert((j->>'dangerous_goods')::boolean,
    'une seule ligne de marchandise dangereuse suffit à marquer la cargaison');
  -- Deux devises, deux montants. Jamais un total unique.
  perform assert(jsonb_array_length(j->'values') = 2,
    'la valeur déclarée reste séparée par devise, elle ne s''additionne pas');
  perform assert((select (x->>'amount')::numeric from jsonb_array_elements(j->'values') x
                  where x->>'currency' = 'USD') = 3000,
    'les deux lignes en dollars font 3 000, sans mélanger l''euro');
  -- Règle W/M de 0029 : le plus élevé du poids en tonnes et du volume.
  perform assert((j->>'chargeable_units')::numeric = 58,
    'l''unité payante suit la règle W/M : 58 m³ l''emportent sur 22 tonnes');

  -- Sans aucune ligne, le total retombe sur ce que porte la cargaison.
  insert into shipments (agency_id, office_id, reference, mode, weight_kg, volume_cbm)
    values (a1, o1, 'EXP-REF47-0002', 'aerien', 640, 3) returning id into sh2;
  select * into s from shipments where id = sh2;
  j := shipment_totals(s);
  perform assert((j->>'gross_weight_kg')::numeric = 640 and j->>'weight_source' = 'cargaison',
    'sans aucune ligne, le total retombe sur la cargaison, et le dit');

  -- ================================================================
  raise notice '--- 4 · Les intervenants : le répertoire d''abord, le texte ensuite ---';
  -- ================================================================
  select * into s from shipments where id = sh;
  j := shipment_actors(s);
  -- Rien n'a été converti par la migration : le texte doit encore s'afficher.
  perform assert(j->'supplier'->>'source' = 'texte'
             and j->'supplier'->>'name' = 'Ningbo Sunrise CO',
    'sans fiche, le fournisseur reste le texte saisi, et le dit');
  perform assert(j->'carrier'->>'source' = 'texte' and j->'carrier'->>'name' = 'CMA CGM',
    'le transporteur en texte libre est rendu tel quel');
  perform assert(j->'broker'->>'name' = 'Bureau Ben Salah',
    'le commissionnaire en texte libre est rendu tel quel');
  perform assert(j->'handler'->>'name' = 'STAM',
    'le manutentionnaire n''a pas de répertoire, il reste en texte, mais il est rendu');
  perform assert(j->'consignee' = 'null'::jsonb,
    'le destinataire n''a pas de repli : shipments n''a jamais eu sa colonne texte');
  perform assert(j->'origin'->>'name' = 'Ningbo' and j->'origin'->>'source' = 'texte',
    'le lieu de départ retombe sur le port écrit à la main');
  -- FOB sur une cargaison maritime : cohérent. Le même sur un vol ne le serait pas.
  perform assert((j->'incoterm'->>'coherent')::boolean and j->'incoterm'->>'code' = 'FOB',
    'l''ancien champ Incoterm est rendu, avec son avis de cohérence');

  -- Maintenant on range le répertoire, et on rattache.
  insert into suppliers (agency_id, company_name, contact_name, country, city, phone, tax_id)
    values (a1, 'Ningbo Sunrise Trading Co. Ltd', 'Li Wei', 'CN', 'Ningbo', '+86 574 000 000', 'CN9100')
    returning id into f1;
  insert into consignees (agency_id, company_name, country, city, customs_code, client_id)
    values (a1, 'Société Bouazizi Import', 'TN', 'Tunis', '1234567A', cl1) returning id into d1;
  insert into shippers (agency_id, company_name, country, contact_name)
    values (a1, 'Ningbo Freight Forwarding', 'CN', 'Chen') returning id into e1;
  insert into carriers (agency_id, name, kind, country, scac_code)
    values (a1, 'CMA CGM', 'compagnie_maritime', 'FR', 'CMDU') returning id into tr1;
  insert into customs_brokers (agency_id, company_name, customs_code, phone)
    values (a1, 'Ben Salah Transit', '7654321B', '+216 71 000 000') returning id into cd1;
  select id into loc_rades from transport_locations where code = 'TNRDS' and kind = 'PORT';

  update shipments set supplier_id = f1, consignee_id = d1, shipper_id = e1,
                       carrier_id = tr1, broker_id = cd1,
                       dest_location_id = loc_rades, incoterm_code = 'FCA'
   where id = sh;

  select * into s from shipments where id = sh;
  j := shipment_actors(s);
  perform assert(j->'supplier'->>'source' = 'repertoire'
             and j->'supplier'->>'name' = 'Ningbo Sunrise Trading Co. Ltd',
    'dès qu''une fiche existe, c''est elle qui parle');
  perform assert(j->'supplier'->>'tax_id' = 'CN9100',
    'la fiche apporte ce que le texte ne portait pas : ici l''identifiant fiscal');
  perform assert(j->'consignee'->>'customs_code' = '1234567A'
             and (j->'consignee'->>'client_id')::uuid = cl1,
    'le destinataire porte son code en douane et son lien vers le client');
  perform assert(j->'carrier'->>'scac_code' = 'CMDU',
    'le transporteur du répertoire apporte son code SCAC');
  perform assert(j->'dest'->>'code' = 'TNRDS' and j->'dest'->>'source' = 'referentiel',
    'le port d''arrivée vient du référentiel, avec son code de lieu');
  -- La vieille colonne texte n'a PAS été touchée par la migration.
  perform assert((select supplier from shipments where id = sh) = 'Ningbo Sunrise CO',
    'la colonne texte d''origine est intacte : aucune reprise par surprise');

  -- ================================================================
  raise notice '--- 5 · Le cloisonnement des répertoires ---';
  -- ================================================================
  insert into suppliers (agency_id, company_name, country)
    values (a2, 'Fournisseur de la Beta', 'TR') returning id into f2;

  perform test_login(u1, a1, 'agent', o1);
  set local role authenticated;

  select count(*) into n from suppliers;
  perform assert(n = 1, 'un compte de l''agence Alpha ne voit que son répertoire (' || n || ')');

  j := directory_search('suppliers', 'sunrise', 10);
  perform assert(jsonb_array_length(j) = 1, 'la recherche trouve la fiche de son agence');
  j := directory_search('suppliers', 'Beta', 10);
  perform assert(jsonb_array_length(j) = 0,
    'la recherche ne traverse pas la cloison : elle est en droits de l''appelant');

  -- Un genre inconnu se signale, il ne rend pas une liste vide muette.
  begin
    j := directory_search('fournisseurs', 'x', 10);
    ok := true;
  exception when others then ok := false;
  end;
  perform assert(not ok, 'un répertoire inconnu lève une erreur au lieu de se taire');

  -- Écrire chez le voisin est refusé, même en donnant son identifiant.
  begin
    insert into suppliers (agency_id, company_name) values (a2, 'Cheval de Troie');
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  perform assert(not ok, 'on n''insère pas une fiche dans le répertoire d''une autre agence');

  -- ================================================================
  raise notice '--- 6 · Les référentiels partagés sont en lecture seule ---';
  -- ================================================================
  select count(*) into n from countries;
  perform assert(n >= 45, 'un compte d''agence LIT les pays : un code ISO n''est le secret de personne');
  select count(*) into n from incoterms;
  perform assert(n = 11, 'un compte d''agence lit les Incoterms');

  begin
    insert into countries (iso2, iso3, name_fr, name_en, name_ar)
      values ('XX', 'XXX', 'Pays inventé', 'Made up', 'مخترع');
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  perform assert(not ok, 'un compte d''agence n''écrit PAS dans les pays');

  -- La politique de modification ne LÈVE pas : elle rend la ligne invisible à
  -- l'ordre, qui ne touche donc rien. C'est plus discret qu'un refus, et c'est
  -- pour ça qu'on vérifie la valeur, pas seulement l'absence d'erreur.
  update incoterms set name_fr = 'Bidon' where code = 'FOB';
  get diagnostics n = row_count;
  perform assert(n = 0, 'la modification d''un Incoterm par une agence ne touche aucune ligne');
  perform assert((select name_fr from incoterms where code = 'FOB') = 'Franco à bord',
    'un compte d''agence ne corrige pas un Incoterm pour tout le monde');

  begin
    insert into hs_codes (code, description_fr, description_en, chapter)
      values ('42', 'Doublon', 'Duplicate', '42');
    ok := true;
  exception when insufficient_privilege or unique_violation then ok := false;
  end;
  perform assert(not ok, 'un compte d''agence n''écrit PAS dans la nomenclature');

  begin
    insert into transport_locations (kind, name, code, country_code)
      values ('PORT', 'Port imaginaire', 'TNZZZ', 'TN');
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  perform assert(not ok, 'un compte d''agence n''ajoute PAS un lieu de transport');

  -- Aucune suppression dure, nulle part : le droit n'est même pas accordé.
  begin
    delete from suppliers where id = f1;
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  perform assert(not ok, 'un répertoire ne se supprime pas : on désactive ou on archive');

  reset role;

  -- L'archivage, lui, marche : deleted_at, et la recherche ne le rend plus.
  update suppliers set deleted_at = now() where id = f1;
  perform test_login(u1, a1, 'agent', o1);
  set local role authenticated;
  j := directory_search('suppliers', 'sunrise', 10);
  perform assert(jsonb_array_length(j) = 0, 'une fiche archivée sort de la recherche');
  reset role;

  -- Une ligne physique saisie par erreur sort des totaux quand on l'archive.
  -- Sans cela, un conteneur tapé deux fois fausserait le poids pour toujours.
  update containers set deleted_at = now() where shipment_id = sh and container_number = 'TGHU0000008';
  select * into s from shipments where id = sh;
  j := shipment_totals(s);
  perform assert((j->>'containers')::int = 2,
    'un conteneur archivé sort du compte, il ne fausse plus les totaux');
  perform assert((j->>'gross_weight_kg')::numeric = 22000,
    'le poids ne bouge pas : la ligne archivée n''en portait pas');

  raise notice '--- banc des référentiels du fret : tout est vert ---';
end $$;
