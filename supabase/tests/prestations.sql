-- Banc d'essai des prestations de voyage (migration 0060).
--
-- Ce qu'il garde, dans l'ordre d'importance :
--   1. Les chiffres EXACTS que le client a dessinés. Billet 1420 vendu pour
--      1350 acheté, assurance 85 pour 55, assistance visa 250 pour 40, et
--      310 dinars de marge sur le dossier. Si un jour ces quatre nombres
--      changent sans qu'on l'ait décidé, le banc le dit tout de suite.
--   2. Qu'une marge ne s'écrit pas à la main.
--   3. Qu'un agent note un billet sans jamais lire le coût de l'agence.
--   4. Qu'un rappel réglementaire reste un rappel : jamais un refus.
--
-- Le banc monte son décor et le démonte : il tourne autant de fois qu'on veut.

\set ON_ERROR_STOP on
set search_path = public;

-- BANC REJOUABLE : on efface d'abord ce qu'un passage précédent aurait laissé.
delete from agencies where slug in ('banc-voy-1', 'banc-voy-2');

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then
    raise notice 'OK    %', label;
  else
    raise exception 'ÉCHEC %', label;
  end if;
end $$;

-- Poser une identité, avec ou sans les revendications du jeton.
create or replace function _login(p_user uuid, p_agency uuid, p_role text, p_office uuid,
                                  p_caps text[] default null, p_offices uuid[] default null)
returns void language plpgsql as $$
declare c jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  c := jsonb_build_object('sub', p_user, 'agency_id', p_agency,
                          'agency_role', p_role, 'office_id', coalesce(p_office::text, ''));
  if p_caps is not null then c := c || jsonb_build_object('caps', to_jsonb(p_caps)); end if;
  if p_offices is not null then c := c || jsonb_build_object('offices', to_jsonb(p_offices)); end if;
  perform set_config('request.jwt.claims', c::text, true);
end $$;

do $$
declare
  a1 uuid; a2 uuid; o1 uuid; o2 uuid; o3 uuid;
  u_owner uuid; u_agent uuid; u_agent2 uuid; u_other uuid;
  ck uuid; vt uuid; cl uuid; k1 uuid; k2 uuid;
  t_billet uuid; t_hotel uuid; t_assur uuid; t_libre uuid; t_fx uuid; t_perte uuid;
  s_cat uuid;
  n int; v_dec numeric; v_txt text; d jsonb; l jsonb;
begin
  -- ===============================================================
  -- Le décor : deux agences, trois bureaux, deux dossiers
  -- ===============================================================
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_owner;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_agent;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_agent2;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_other;

  -- Une agence de catégorie A, une de catégorie B : c'est la seule différence
  -- que la garde de licence connaisse.
  insert into agencies (slug, name, services, license_category)
    values ('banc-voy-1', 'Banc Voyage', '{visas}', 'A') returning id into a1;
  insert into agencies (slug, name, services, license_category)
    values ('banc-voy-2', 'Banc Voisin', '{visas}', 'B') returning id into a2;

  insert into offices (agency_id, name, country, country_code) values (a1, 'Tunis', 'Tunisie', 'TN') returning id into o1;
  insert into offices (agency_id, name, country, country_code) values (a1, 'Sousse', 'Tunisie', 'TN') returning id into o2;
  insert into offices (agency_id, name, country, country_code) values (a2, 'Sfax', 'Tunisie', 'TN') returning id into o3;

  insert into profiles (id, agency_id, office_id, name, role) values
    (u_owner,  a1, o1, 'Slim',  'owner'),
    (u_agent,  a1, o1, 'Hatem', 'agent'),
    (u_agent2, a1, o2, 'Amira', 'agent'),
    (u_other,  a2, o3, 'Rania', 'owner');

  -- Le catalogue de 0045, semé avant toute identité : `seed_services` refuse un
  -- jeton qui n'est pas celui de l'agence, et aucune session n'est ouverte ici.
  perform seed_services(a1);
  select id into s_cat from services where agency_id = a1 and category = 'INSURANCE' limit 1;

  insert into checklists (agency_id, name) values (a1, '{"fr":"Schengen"}') returning id into ck;
  insert into visa_types (agency_id, country_code, country, label, checklist_id)
    values (a1, 'FR', '{"fr":"France"}', '{"fr":"Tourisme"}', ck) returning id into vt;
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (a1, o1, 'Mohamed', 'Ben Ali', '+216 20 000 060') returning id into cl;

  -- Le dossier du client, avec le montant convenu pour l'assistance visa.
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, amount_total)
    values (a1, 'VF-BANC-VOY-1', cl, vt, o1, 250) returning id into k1;
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id)
    values (a1, 'VF-BANC-VOY-2', cl, vt, o2) returning id into k2;

  -- ===============================================================
  -- 1. Les chiffres du client, à l'unité près
  -- ===============================================================
  insert into travel_services (agency_id, office_id, case_id, client_id, kind, status,
                               supplier_name, carrier, pnr, reference,
                               depart_from, depart_to, depart_at, return_at, passengers,
                               sold_amount, cost_amount, currency, created_by)
    values (a1, o1, k1, cl, 'BILLET', 'enregistre',
            'Agence de billetterie', 'Compagnie notée par l''agence', 'ABC123', 'ABC123',
            'TUN', 'CDG', now() + interval '20 days', now() + interval '35 days', 1,
            1420, 1350, 'TND', u_owner)
    returning id into t_billet;

  select margin into v_dec from travel_services where id = t_billet;
  perform assert(v_dec = 70.00, 'le billet vendu 1420 pour 1350 laisse 70 de marge');

  insert into travel_services (agency_id, office_id, case_id, client_id, kind, status,
                               hotel_name, hotel_city, reference,
                               checkin_date, checkout_date, rooms, guests, board,
                               sold_amount, cost_amount, created_by)
    values (a1, o1, k1, cl, 'HEBERGEMENT', 'enregistre',
            'Hôtel noté par l''agence', 'Paris', 'RES-0001',
            date '2026-10-10', date '2026-10-14', 1, 1, 'petit_dejeuner',
            0, 0, u_owner)
    returning id into t_hotel;

  select nights into n from travel_services where id = t_hotel;
  perform assert(n = 4, 'quatre nuitées se comptent toutes seules entre le 10 et le 14');

  -- ===============================================================
  -- 2. L'état du voyage, ce que la barre de progression lira
  -- ===============================================================
  perform _login(u_owner, a1, 'owner', o1, null, array[]::uuid[]);
  set local role authenticated;
  d := travel_readiness(k1);
  reset role;
  perform assert((d->'billet'->>'note')::boolean, 'le billet est noté');
  perform assert(d->'billet'->>'reference' = 'ABC123', 'et la barre lit sa référence courte');
  perform assert((d->'hebergement'->>'note')::boolean, 'l''hôtel est noté');
  perform assert(not (d->'assurance'->>'note')::boolean, 'l''assurance ne l''est pas encore : on ne dit pas prêt ce qui ne l''est pas');

  insert into travel_services (agency_id, office_id, case_id, client_id, kind, status,
                               insurer, policy_number, coverage_amount, coverage_currency,
                               cover_from, cover_to, cover_area,
                               sold_amount, cost_amount, created_by)
    values (a1, o1, k1, cl, 'ASSURANCE', 'enregistre',
            'Assureur noté par l''agence', 'POL-77', 30000, 'EUR',
            date '2026-10-10', date '2026-10-25', 'Schengen',
            85, 55, u_owner)
    returning id into t_assur;

  select margin into v_dec from travel_services where id = t_assur;
  perform assert(v_dec = 30.00, 'l''assurance vendue 85 pour 55 laisse 30 de marge');

  perform _login(u_owner, a1, 'owner', o1, null, array[]::uuid[]);
  set local role authenticated;
  d := travel_readiness(k1);
  reset role;
  perform assert((d->'assurance'->>'note')::boolean and d->'assurance'->>'reference' = 'POL-77',
                 'une fois notée, l''assurance apparaît avec son numéro de police');

  -- ===============================================================
  -- 3. Le tableau de marge du dossier, assistance visa comprise
  -- ===============================================================
  -- Les frais consulaires du dossier : c'est le coût de l'assistance.
  insert into expenses (agency_id, office_id, case_id, category, amount, currency, spent_on)
    values (a1, o1, k1, 'consulat', 40, 'TND', current_date);

  perform _login(u_owner, a1, 'owner', o1, null, array[]::uuid[]);
  set local role authenticated;
  d := case_travel_margin(k1);
  reset role;

  select e.v into l from jsonb_array_elements(d->'lines') as e(v) where e.v->>'kind' = 'BILLET';
  perform assert((l->>'sold')::numeric = 1420 and (l->>'cost')::numeric = 1350
                 and (l->>'margin')::numeric = 70,
                 'ligne billet : 1420 vendu, 1350 de coût, 70 de marge');
  perform assert((l->>'margin_pct')::numeric = 4.93, 'et son pourcentage de marge, qui est maigre');

  select e.v into l from jsonb_array_elements(d->'lines') as e(v) where e.v->>'kind' = 'ASSURANCE';
  perform assert((l->>'sold')::numeric = 85 and (l->>'cost')::numeric = 55
                 and (l->>'margin')::numeric = 30,
                 'ligne assurance : 85 vendu, 55 de coût, 30 de marge');

  select e.v into l from jsonb_array_elements(d->'lines') as e(v) where e.v->>'kind' = 'ASSISTANCE';
  perform assert((l->>'sold')::numeric = 250 and (l->>'cost')::numeric = 40
                 and (l->>'margin')::numeric = 210,
                 'ligne assistance visa : 250 facturés, 40 de frais, 210 de marge');

  perform assert((d->'total'->>'margin')::numeric = 310,
                 'la marge du dossier fait 310 dinars, exactement le tableau du client');
  perform assert((d->'travel'->>'margin')::numeric = 100,
                 'dont 100 pour le voyage : l''assistance rapporte deux fois plus que tout le reste');
  perform assert(d->>'currency' is not null, 'le tableau dit dans quelle devise il compte');

  -- ===============================================================
  -- 4. Ce que le modèle refuse, et ce qu'il accepte
  -- ===============================================================
  -- La marge ne se saisit pas : c'est le premier chiffre qu'on arrangerait.
  begin
    insert into travel_services (agency_id, office_id, kind, sold_amount, cost_amount, margin)
      values (a1, o1, 'AUTRE', 100, 50, 999);
    perform assert(false, 'une marge écrite à la main');
  exception when others then
    perform assert(sqlstate = '428C9', 'une marge ne s''écrit pas à la main : la colonne est générée');
  end;

  begin
    insert into travel_services (agency_id, office_id, kind, depart_at, return_at)
      values (a1, o1, 'BILLET', now() + interval '10 days', now() + interval '3 days');
    perform assert(false, 'un retour avant l''aller');
  exception when check_violation then
    perform assert(true, 'un retour avant l''aller est refusé');
  end;

  begin
    insert into travel_services (agency_id, office_id, kind, checkin_date, checkout_date)
      values (a1, o1, 'HEBERGEMENT', date '2026-10-14', date '2026-10-10');
    perform assert(false, 'une sortie d''hôtel avant l''entrée');
  exception when check_violation then
    perform assert(true, 'une sortie d''hôtel avant l''entrée est refusée');
  end;

  begin
    insert into travel_services (agency_id, office_id, kind, cover_from, cover_to)
      values (a1, o1, 'ASSURANCE', date '2026-10-20', date '2026-10-01');
    perform assert(false, 'une couverture qui finit avant de commencer');
  exception when check_violation then
    perform assert(true, 'une couverture d''assurance qui finit avant de commencer est refusée');
  end;

  begin
    insert into travel_services (agency_id, office_id, kind, sold_amount, cost_amount)
      values (a1, o1, 'AUTRE', 100, -10);
    perform assert(false, 'un coût négatif');
  exception when check_violation then
    perform assert(true, 'un coût négatif est refusé : personne n''achète pour moins que rien');
  end;

  -- L'état « à réserver » n'existe plus, et « émis » non plus : VisaFlow
  -- n'émet rien et ne réserve rien, il note.
  begin
    insert into travel_services (agency_id, office_id, kind, status)
      values (a1, o1, 'BILLET', 'emis');
    perform assert(false, 'un état inventé');
  exception when check_violation then
    perform assert(true, 'l''état « émis » n''existe pas : VisaFlow n''émet aucun titre');
  end;

  -- Une marge négative, elle, passe. Une agence vend parfois à perte pour
  -- garder un client, et le lui interdire ne ferait que fausser sa saisie.
  insert into travel_services (agency_id, office_id, case_id, kind, status,
                               sold_amount, cost_amount, created_by)
    values (a1, o2, k2, 'AUTRE', 'enregistre', 100, 130, u_owner)
    returning id into t_perte;
  select margin into v_dec from travel_services where id = t_perte;
  perform assert(v_dec = -30.00, 'une marge négative est acceptée : vendre à perte pour garder un client arrive');

  -- Une prestation sans dossier de visa : le billet sec existe.
  insert into travel_services (agency_id, office_id, client_id, kind, status,
                               sold_amount, cost_amount, created_by)
    values (a1, o1, cl, 'BILLET', 'enregistre', 500, 480, u_owner)
    returning id into t_libre;
  select count(*) into n from travel_services where id = t_libre and case_id is null;
  perform assert(n = 1, 'un billet se vend sans dossier de visa : exiger un dossier en ferait ouvrir de faux');

  -- La conversion en devise de base, au taux noté le jour de la saisie.
  insert into travel_services (agency_id, office_id, case_id, kind, status,
                               pickup_place, dropoff_place,
                               sold_amount, cost_amount, currency, fx_rate, created_by)
    values (a1, o2, k2, 'TRANSFERT', 'enregistre',
            'Aéroport', 'Hôtel', 400, 350, 'EUR', 3.4, u_owner)
    returning id into t_fx;
  select margin into v_dec from travel_services where id = t_fx;
  perform assert(v_dec = 50.00, '50 euros de marge restent 50 euros dans la devise de la vente');
  select margin_base into v_dec from travel_services where id = t_fx;
  perform assert(v_dec = 170.00, 'et font 170 dinars en devise de base : la conversion se fait une seule fois');

  -- ===============================================================
  -- 5. L'agent note le billet, il ne lit pas la marge de l'agence
  -- ===============================================================
  perform _login(u_agent, a1, 'agent', o1, null, array[o1]);
  set local role authenticated;

  -- Il voit la ligne et ce qu'on a facturé au client.
  select sold_amount into v_dec from travel_services where id = t_billet;
  reset role;
  perform assert(v_dec = 1420, 'l''agent voit ce qu''on a facturé au client');

  set local role authenticated;
  begin
    execute 'select cost_amount from travel_services where id = $1' into v_dec using t_billet;
    reset role;
    perform assert(false, 'l''agent a lu le coût');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'l''agent ne lit PAS le coût : le droit de colonne n''existe pas');
  end;

  set local role authenticated;
  begin
    execute 'select margin from travel_services where id = $1' into v_dec using t_billet;
    reset role;
    perform assert(false, 'l''agent a lu la marge');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'l''agent ne lit PAS la marge non plus');
  end;

  set local role authenticated;
  begin
    d := case_travel_margin(k1);
    reset role;
    perform assert(false, 'l''agent a ouvert le tableau de marge');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'et le tableau de marge du dossier lui est fermé');
  end;

  -- Mais il note bien une prestation : c'est tout l'intérêt du partage.
  set local role authenticated;
  insert into travel_services (agency_id, office_id, case_id, client_id, kind, status,
                               reference, sold_amount, cost_amount)
    values (a1, o1, k1, cl, 'TRANSPORT', 'enregistre', 'TR-1', 60, 40);
  reset role;
  select count(*) into n from travel_services where case_id = k1 and kind = 'TRANSPORT';
  perform assert(n = 1, 'l''agent note une prestation sans jamais voir la marge de l''agence');

  -- Même la direction ne lit pas la colonne en direct : un droit de colonne
  -- s'accorde à un rôle, et tout le monde partage `authenticated`. Elle passe
  -- par les fonctions, qui vérifient le droit à chaque appel.
  perform _login(u_owner, a1, 'owner', o1, null, array[]::uuid[]);
  set local role authenticated;
  begin
    execute 'select cost_amount from travel_services where id = $1' into v_dec using t_billet;
    reset role;
    perform assert(false, 'la direction a lu la colonne en direct');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'même la direction passe par les fonctions de marge : la colonne est fermée à tous');
  end;

  set local role authenticated;
  d := travel_service_money(k1, null, null, null);
  reset role;
  select e.v into l from jsonb_array_elements(d) as e(v) where e.v->>'id' = t_billet::text;
  perform assert((l->>'cost')::numeric = 1350, 'et par cette porte, elle lit bien le coût du billet');

  -- Aucune suppression dure.
  perform _login(u_owner, a1, 'owner', o1, null, array[]::uuid[]);
  set local role authenticated;
  begin
    execute 'delete from travel_services where id = $1' using t_libre;
    reset role;
    perform assert(false, 'une prestation a été effacée');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'aucune suppression dure : le droit DELETE de 0015 a bien été repris');
  end;

  -- ===============================================================
  -- 6. Le rappel de licence, qui ne bloque jamais
  -- ===============================================================
  d := travel_service_allowed(a2, 'BILLET');
  perform assert((d->>'autorise')::boolean,
                 'une agence de catégorie B peut noter un billet : le module enregistre, il ne vend pas');
  perform assert(d->>'avertissement' = 'licence_b_a_verifier',
                 'mais l''écran lui rappelle de vérifier sa licence');
  perform assert(d->>'categorie' = 'B', 'et le rappel dit de quelle catégorie il parle');

  d := travel_service_allowed(a1, 'BILLET');
  perform assert((d->>'autorise')::boolean and d->>'avertissement' is null,
                 'une agence de catégorie A note son billet sans rappel');

  d := travel_service_allowed(a1, 'ASSURANCE');
  perform assert((d->>'autorise')::boolean
                 and d->'avertissements' @> '["assurance_mandat_a_verifier"]'::jsonb,
                 'l''assurance porte son propre rappel, quelle que soit la catégorie de licence');

  update agencies set license_category = null where id = a1;
  d := travel_service_allowed(a1, 'HEBERGEMENT');
  perform assert((d->>'autorise')::boolean and d->>'avertissement' = 'categorie_non_declaree',
                 'sans catégorie déclarée on ne bloque pas : on le dit');
  update agencies set license_category = 'A' where id = a1;

  -- ===============================================================
  -- 7. Le rapport par nature
  -- ===============================================================
  perform _login(u_owner, a1, 'owner', o1, null, array[]::uuid[]);
  set local role authenticated;
  d := travel_margin_report(o1, current_date - 30, current_date + 1);
  reset role;

  select e.v into l from jsonb_array_elements(d->'kinds') as e(v) where e.v->>'kind' = 'BILLET';
  perform assert((l->>'margin')::numeric = 70 + 20, 'le rapport groupe les deux billets du bureau de Tunis');
  select e.v into l from jsonb_array_elements(d->'kinds') as e(v) where e.v->>'kind' = 'ASSURANCE';
  perform assert((l->>'margin')::numeric = 30, 'et rend l''assurance à part : c''est ce découpage qui montre ce qui fait vivre l''agence');

  set local role authenticated;
  d := travel_margin_report(o2, current_date - 30, current_date + 1);
  reset role;
  perform assert((d->'total'->>'margin')::numeric = 140,
                 'le bureau de Sousse fait 140 : 170 de transfert moins 30 de vente à perte');

  -- ===============================================================
  -- 8. Le cloisonnement
  -- ===============================================================
  -- Entre agences : la voisine ne voit rien, et n'ouvre aucun tableau.
  perform _login(u_other, a2, 'owner', o3, null, array[]::uuid[]);
  set local role authenticated;
  select count(*) into n from travel_services;
  reset role;
  perform assert(n = 0, 'l''agence voisine ne voit aucune prestation');

  set local role authenticated;
  begin
    d := case_travel_margin(k1);
    reset role;
    perform assert(false, 'la voisine a ouvert le tableau d''un dossier qui n''est pas le sien');
  exception when no_data_found then
    reset role;
    perform assert(true, 'et n''ouvre pas le tableau d''un dossier qui n''est pas le sien');
  end;

  -- Entre bureaux : l'agent de Sousse ne voit pas les prestations de Tunis.
  perform _login(u_agent2, a1, 'agent', o2, null, array[o2]);
  set local role authenticated;
  select count(*) into n from travel_services where office_id = o1;
  reset role;
  perform assert(n = 0, 'un agent de Sousse ne voit pas les prestations de Tunis');

  set local role authenticated;
  select count(*) into n from travel_services where office_id = o2;
  reset role;
  perform assert(n = 2, 'mais il voit bien les siennes');

  -- Le garde de cohérence : on ne rattache pas sa prestation au dossier d'une
  -- autre agence, sinon la marge de la voisine bougerait toute seule.
  begin
    insert into travel_services (agency_id, office_id, case_id, kind)
      values (a2, o3, k1, 'BILLET');
    perform assert(false, 'une prestation rattachée au dossier d''une autre agence');
  exception when insufficient_privilege then
    perform assert(true, 'une prestation ne se rattache pas au dossier d''une autre agence');
  end;

  -- ===============================================================
  -- 9. Le catalogue : on rattache, on ne double pas
  -- ===============================================================
  perform _login(u_owner, a1, 'owner', o1, null, array[]::uuid[]);
  set local role authenticated;
  d := travel_service_from_catalog(s_cat);
  reset role;
  perform assert(d->>'service_id' = s_cat::text, 'une prestation se rattache à une ligne du catalogue existant');
  perform assert((d->>'default_price')::numeric = 0, 'et reprend le prix de l''agence, zéro compris : aucun tarif n''est inventé');

  -- Ménage.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  delete from agencies where id in (a1, a2);
  delete from auth.users where id in (u_owner, u_agent, u_agent2, u_other);
  raise notice '--- banc des prestations de voyage : tout est vert ---';
end $$;

drop function _login(uuid, uuid, text, uuid, text[], uuid[]);
