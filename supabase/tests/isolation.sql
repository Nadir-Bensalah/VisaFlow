-- Banc d'essai du cloisonnement.
-- Deux agences, quatre rôles, deux bureaux. Chaque test échoue bruyamment.
-- C'est ce banc qui empêche une requête ajoutée un mardi de tout ouvrir.

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
  u_owner uuid; u_manager uuid; u_agent uuid; u_viewer uuid; u_other uuid;
  c1 uuid; c2 uuid; k1 uuid; k2 uuid; v1 uuid; v2 uuid;
  n int; ok boolean; res jsonb;
begin
  -- ---------------------------------------------------------------
  -- Deux agences, montées avec les droits du service
  -- ---------------------------------------------------------------
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_owner;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_manager;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_agent;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_viewer;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_other;

  insert into agencies (slug, name, services) values ('alpha', 'Alpha Visas', '{visas,fret}') returning id into a1;
  insert into agencies (slug, name, services) values ('beta', 'Beta Voyages', '{visas}') returning id into a2;

  insert into offices (agency_id, name, country, country_code) values (a1, 'Tunis', 'Tunisie', 'TN') returning id into o1;
  insert into offices (agency_id, name, country, country_code) values (a1, 'Tripoli', 'Libye', 'LY') returning id into o2;
  insert into offices (agency_id, name, country, country_code) values (a2, 'Sfax', 'Tunisie', 'TN') returning id into o3;

  insert into profiles (id, agency_id, office_id, name, role) values
    (u_owner,   a1, o1, 'Slim',  'owner'),
    (u_manager, a1, o1, 'Amira', 'manager'),
    (u_agent,   a1, o2, 'Hatem', 'agent'),
    (u_viewer,  a1, o1, 'Stage', 'viewer'),
    (u_other,   a2, o3, 'Rania', 'owner');

  perform seed_catalogue(a1, '{visas,fret}');
  perform seed_catalogue(a2, '{visas}');

  select id into v1 from visa_types where agency_id = a1 limit 1;
  select id into v2 from visa_types where agency_id = a2 limit 1;

  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (a1, o1, 'Mohamed', 'Bouazizi', '+21698111222') returning id into c1;
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (a1, o2, 'Omar', 'Ben Ghazi', '+21891774220') returning id into c2;

  -- ---------------------------------------------------------------
  -- 1. Ouvrir un dossier crée les pièces ET les règlements
  -- ---------------------------------------------------------------
  perform test_login(u_manager, a1, 'manager', o1);
  set local role authenticated;
  k1 := open_case(c1, v1, u_manager, current_date + 30, 'comptoir', null);
  reset role;

  select count(*) into n from case_documents where case_id = k1;
  perform assert(n > 0, 'ouvrir un dossier recopie la liste de pièces (' || n || ')');

  select count(*) into n from payments where case_id = k1;
  perform assert(n = 2, 'ouvrir un dossier crée honoraires et débours');

  select count(*) into n from payments where case_id = k1 and kind = 'debours';
  perform assert(n = 1, 'les frais de consulat sont des débours, pas du revenu');

  select count(*) into n from cases where id = k1 and checklist_version_id is not null;
  perform assert(n = 1, 'le dossier retient la version de liste qui lui a été annoncée');

  -- Un dossier dans l'autre bureau
  perform test_login(u_owner, a1, 'owner', o1);
  set local role authenticated;
  update clients set office_id = o2 where id = c2;
  k2 := open_case(c2, v1, u_agent, current_date + 40, 'comptoir', null);
  reset role;

  -- ---------------------------------------------------------------
  -- 2. Une agence ne voit jamais l'autre
  -- ---------------------------------------------------------------
  perform test_login(u_other, a2, 'owner', o3);
  set local role authenticated;
  select count(*) into n from cases;
  perform assert(n = 0, 'Beta ne voit aucun dossier d''Alpha');
  select count(*) into n from clients;
  perform assert(n = 0, 'Beta ne voit aucun client d''Alpha');
  select count(*) into n from agencies;
  perform assert(n = 1, 'Beta ne voit que sa propre agence');
  select count(*) into n from visa_types;
  perform assert(n > 0, 'Beta voit bien son propre catalogue');
  reset role;

  -- ---------------------------------------------------------------
  -- 3. Un agent ne voit que son bureau
  -- ---------------------------------------------------------------
  perform test_login(u_agent, a1, 'agent', o2);
  set local role authenticated;
  select count(*) into n from cases;
  perform assert(n = 1, 'l''agent de Tripoli ne voit que le dossier de Tripoli');
  select count(*) into n from clients;
  perform assert(n = 1, 'l''agent de Tripoli ne voit que ses clients');
  select count(*) into n from shipment_finance;
  perform assert(n = 0, 'l''agent ne voit pas la table des coûts de fret');
  reset role;

  perform test_login(u_manager, a1, 'manager', o1);
  set local role authenticated;
  select count(*) into n from cases;
  perform assert(n = 2, 'le responsable voit les deux bureaux');
  reset role;

  -- ---------------------------------------------------------------
  -- 4. Le lecteur ne peut rien écrire, ni se promouvoir
  -- ---------------------------------------------------------------
  perform test_login(u_viewer, a1, 'viewer', o1);
  set local role authenticated;
  begin
    insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (a1, o1, 'Faux', 'Client', '+2160000');
    perform assert(false, 'le lecteur ne doit pas pouvoir créer un client');
  exception when insufficient_privilege or check_violation then
    perform assert(true, 'le lecteur ne peut pas créer un client');
  end;

  begin
    update profiles set role = 'owner' where id = u_viewer;
    perform assert(false, 'le lecteur ne doit pas pouvoir se promouvoir');
  exception when others then
    perform assert(true, 'le lecteur ne peut pas se promouvoir : ' || sqlerrm);
  end;
  reset role;

  -- ---------------------------------------------------------------
  -- 5. Le journal est en ajout seul
  -- ---------------------------------------------------------------
  perform test_login(u_owner, a1, 'owner', o1);
  set local role authenticated;
  -- Sans politique de mise à jour, une ligne ne correspond jamais : la requête
  -- passe et ne touche rien. C'est la protection, et elle est silencieuse.
  update activity_events set detail = '{"fr":"réécrit"}' where agency_id = a1;
  get diagnostics n = row_count;
  perform assert(n = 0, 'le journal n''est pas modifiable, même par la direction');

  delete from activity_events where agency_id = a1;
  get diagnostics n = row_count;
  perform assert(n = 0, 'le journal n''est pas effaçable');

  select count(*) into n from activity_events;
  perform assert(n > 0, 'et le journal est bien là, lisible (' || n || ' lignes)');
  reset role;

  -- ---------------------------------------------------------------
  -- 6. Le portail ne rend que son dossier, et rien de sensible
  -- ---------------------------------------------------------------
  update cases set consulate_ref = 'SECRET-42' where id = k1;
  insert into case_notes (agency_id, case_id, text) values (a1, k1, 'Note interne à ne pas montrer');
  insert into messages (agency_id, case_id, client_id, channel, direction, body)
    values (a1, k1, c1, 'interne', 'sortant', 'Message interne à ne pas montrer');

  select portal_case((select portal_token from cases where id = k1)) into res;
  perform assert(res is not null, 'le portail répond sur un jeton valide');
  perform assert(res::text not like '%SECRET-42%', 'le portail ne montre pas la référence consulat');
  perform assert(res::text not like '%Note interne%', 'le portail ne montre pas les notes internes');
  perform assert(res::text not like '%Message interne%', 'le portail ne montre pas le canal interne');
  perform assert(portal_case('jeton-invente') is null, 'un jeton inventé ne rend rien');

  -- ---------------------------------------------------------------
  -- 7. Le code à usage unique
  -- ---------------------------------------------------------------
  perform issue_otp('alpha', '+21698111222', 'suivi');
  select (verify_otp('alpha', '+21698111222', '000000') ->> 'ok')::boolean into ok;
  perform assert(ok = false, 'un mauvais code est refusé');
  select count(*) into n from otp_codes where phone = '+21698111222';
  perform assert(n = 1, 'un seul code émis');

  -- ---------------------------------------------------------------
  -- 8. Le passeport ne sort pas si le solde n'est pas réglé
  -- ---------------------------------------------------------------
  perform test_login(u_manager, a1, 'manager', o1);
  set local role authenticated;
  insert into passport_custody (agency_id, client_id, case_id, passport_number)
    values (a1, c1, k1, 'T123456');
  begin
    perform release_passport((select id from passport_custody where case_id = k1), false);
    perform assert(false, 'le passeport ne doit pas sortir avec un solde dû');
  exception when others then
    perform assert(sqlstate = 'P0003', 'le passeport est retenu tant que le solde est dû');
  end;

  -- On encaisse tout, puis il sort
  perform collect_payment(id, 'especes', null) from payments where case_id = k1;
  perform release_passport((select id from passport_custody where case_id = k1), false);
  select count(*) into n from passport_custody where case_id = k1 and returned_at is not null;
  perform assert(n = 1, 'une fois réglé, le passeport se rend');
  reset role;

  -- ---------------------------------------------------------------
  -- 9. Les relances ne se répètent pas
  -- ---------------------------------------------------------------
  update case_documents set state = 'demandee', requested_at = now() - interval '10 days' where case_id = k2;
  select run_automations(a1, false) into res;
  perform assert((res ->> 'fired')::int > 0, 'les règles se déclenchent (' || (res ->> 'fired') || ')');
  select run_automations(a1, false) into res;
  perform assert((res ->> 'fired')::int = 0, 'la même règle ne rappelle pas le même dossier dans la fenêtre');

  -- ---------------------------------------------------------------
  -- 10. Les références ne se mélangent pas entre agences
  -- ---------------------------------------------------------------
  perform assert(
    (select count(distinct reference) from cases where agency_id = a1) =
    (select count(*) from cases where agency_id = a1),
    'les références sont uniques dans une agence');
  perform assert(next_reference(a2, 'case') like 'VF-%-0001',
    'chaque agence a sa propre suite de références');

  raise notice '--- banc terminé sans échec ---';
end $$;
