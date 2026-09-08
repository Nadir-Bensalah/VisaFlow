-- Banc d'essai de l'intégrité des données (migration 0052).
--
-- Ce banc garde quatre promesses qui ne se vérifient pas à l'œil :
--   · un changement d'étape laisse une trace, et cette trace ne se réécrit pas ;
--   · un remboursement ne touche pas au règlement d'origine ;
--   · une fusion de clients dit exactement ce qu'elle a déplacé ;
--   · une agence déjà installée garde EXACTEMENT sa numérotation.
--
-- Le dernier point est le plus important du lot. Une numérotation qui change
-- toute seule casse le lien entre les dossiers de l'écran et les classeurs de
-- l'étagère, et ça ne se répare pas.

\set ON_ERROR_STOP on
set search_path = public;

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then raise notice 'OK    %', label;
  else raise exception 'ÉCHEC %', label; end if;
end $$;

-- Se faire passer pour quelqu'un, avec ou sans les revendications récentes.
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

-- Redevenir personne. On repose un objet VIDE et non une chaîne vide :
-- auth_agency_id() convertit la revendication en jsonb avant de la tester, et
-- une chaîne vide n'est pas du json.
create or replace function _logout() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

do $$
declare
  ag uuid; ag2 uuid; o_tunis uuid; o_sfax uuid; o_autre uuid;
  u_owner uuid; u_agent uuid; u_autre uuid;
  ck uuid; vt uuid; ck2 uuid; vt2 uuid;
  c1 uuid; c2 uuid; c3 uuid; c_autre uuid;
  k1 uuid; k2 uuid; k3 uuid; k4 uuid; k5 uuid;
  sh uuid; pay1 uuid; pay2 uuid; ref1 uuid;
  f_num uuid; f_liste uuid; f_oblig uuid;
  n int; v_txt text; v_txt2 text; d jsonb; rep jsonb; v_num numeric;
  caps_owner text[] := array[
    'case:read','case:write','case:create','client:write','doc:validate','message:send',
    'payment:write','shipment:write','settings:view','settings:manage','finance:global'];
  caps_agent text[] := array[
    'case:read','case:write','case:create','client:write','payment:write','shipment:write'];
begin
  -- ---------------------------------------------------------------
  -- Le décor : deux agences, deux bureaux, trois comptes
  -- ---------------------------------------------------------------
  insert into agencies (slug, name, services) values ('integrite', 'Banc Intégrité', '{visas,fret}') returning id into ag;
  insert into agencies (slug, name, services) values ('integrite2', 'Agence Voisine', '{visas}') returning id into ag2;

  insert into offices (agency_id, name, country, country_code) values (ag, 'Tunis', 'Tunisie', 'TN') returning id into o_tunis;
  insert into offices (agency_id, name, country, country_code) values (ag, 'Sfax', 'Tunisie', 'TN') returning id into o_sfax;
  insert into offices (agency_id, name, country, country_code) values (ag2, 'Ailleurs', 'Tunisie', 'TN') returning id into o_autre;

  insert into auth.users (id) values (gen_random_uuid()) returning id into u_owner;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_agent;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_autre;

  insert into profiles (id, agency_id, office_id, name, role) values
    (u_owner, ag,  o_tunis, 'Slim',  'owner'),
    (u_agent, ag,  o_sfax,  'Hatem', 'agent'),
    (u_autre, ag2, o_autre, 'Rania', 'owner');

  insert into checklists (agency_id, name) values (ag, '{"fr":"Schengen"}') returning id into ck;
  insert into visa_types (agency_id, country_code, country, label, checklist_id)
    values (ag, 'FR', '{"fr":"France"}', '{"fr":"Tourisme"}', ck) returning id into vt;
  insert into checklists (agency_id, name) values (ag2, '{"fr":"Schengen"}') returning id into ck2;
  insert into visa_types (agency_id, country_code, country, label, checklist_id)
    values (ag2, 'FR', '{"fr":"France"}', '{"fr":"Tourisme"}', ck2) returning id into vt2;

  -- Deux fiches pour la même personne : même passeport, même date de naissance,
  -- deux orthographes latines. C'est le cas réel, pas un cas d'école.
  insert into clients (agency_id, office_id, first_name, last_name, native_name, phone, email, passport_number, birth_date)
    values (ag, o_tunis, 'Mohamed', 'Ben Salah', 'محمد بن صالح', '+216 20 000 001', 'm.bensalah@test.tn', 'T123456', '1990-05-04')
    returning id into c1;
  insert into clients (agency_id, office_id, first_name, last_name, native_name, phone, passport_number, birth_date)
    values (ag, o_tunis, 'Mohammed', 'Bensalah', 'محمّد بن صالح', '+216 20 000 002', 'T123456', '1990-05-04')
    returning id into c2;
  -- Une troisième fiche, sans passeport, mais avec la même adresse.
  insert into clients (agency_id, office_id, first_name, last_name, phone, email)
    values (ag, o_tunis, 'Mouhamed', 'B.', '+216 20 000 003', 'm.bensalah@test.tn')
    returning id into c3;
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (ag2, o_autre, 'Mohamed', 'Ben Salah', '+216 20 000 001')
    returning id into c_autre;

  insert into cases (agency_id, reference, client_id, visa_type_id, office_id)
    values (ag, 'VF-T-0001', c1, vt, o_tunis) returning id into k1;
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id)
    values (ag, 'VF-T-0002', c1, vt, o_tunis) returning id into k2;
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id)
    values (ag, 'VF-S-0003', c1, vt, o_sfax) returning id into k3;
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id)
    values (ag, 'VF-T-0004', c2, vt, o_tunis) returning id into k4;
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id)
    values (ag, 'VF-T-0005', c2, vt, o_tunis) returning id into k5;

  insert into shipments (agency_id, reference, office_id, mode, container_no, bl_number)
    values (ag, 'EXP-0001', o_tunis, 'maritime_lcl', 'MSCU 1234567', 'BL-99') returning id into sh;

  insert into payments (agency_id, office_id, case_id, client_id, label, amount, currency, state)
    values (ag, o_tunis, k4, c2, '{"fr":"Honoraires"}', 300, 'TND', 'regle') returning id into pay1;
  insert into payments (agency_id, office_id, case_id, client_id, label, amount, currency, state)
    values (ag, o_tunis, k5, c2, '{"fr":"Honoraires"}', 200, 'TND', 'regle') returning id into pay2;

  -- ---------------------------------------------------------------
  -- 1. L'historique s'écrit tout seul, et ne se réécrit pas
  -- ---------------------------------------------------------------
  perform _login(u_owner, ag, 'owner', o_tunis, caps_owner);

  update cases set stage = 'depot' where id = k1;
  select count(*) into n from status_history
   where entity_kind = 'VISA_CASE' and entity_id = k1 and field = 'stage';
  perform assert(n = 1, 'un changement d''étape écrit sa ligne d''historique tout seul');

  select from_value || '→' || to_value into v_txt from status_history
   where entity_id = k1 and field = 'stage';
  perform assert(v_txt = 'nouveau→depot', 'la ligne dit d''où le dossier vient et où il va');

  select count(*) into n from status_history
   where entity_id = k1 and changed_by = u_owner;
  perform assert(n = 1, 'et qui l''a fait bouger');

  update cases set status = 'refuse' where id = k1;
  select count(*) into n from status_history where entity_id = k1 and field = 'status';
  perform assert(n = 1, 'le statut a sa propre ligne : étape et issue ne sont pas la même question');

  -- Une écriture qui ne change rien n'écrit rien : sinon le journal se remplit
  -- d'enregistrements sans information et devient illisible.
  update cases set stage = 'depot' where id = k1;
  select count(*) into n from status_history where entity_id = k1;
  perform assert(n = 2, 'réenregistrer la même étape n''ajoute pas de ligne');

  update shipments set stage = 'transit' where id = sh;
  select count(*) into n from status_history where entity_kind = 'SHIPMENT' and entity_id = sh;
  perform assert(n = 1, 'la cargaison écrit dans le même journal que le dossier');

  select count(*) into n from information_schema.role_table_grants
   where table_name = 'status_history' and grantee = 'authenticated'
     and privilege_type in ('UPDATE', 'DELETE');
  perform assert(n = 0, 'personne n''a le droit de modifier ni d''effacer l''historique');

  select count(*) into n from pg_policy
   where polrelid = 'status_history'::regclass and polcmd in ('w', 'd', '*');
  perform assert(n = 0, 'et aucune politique ne le prévoit : un journal réécrivable ne prouve rien');

  set local role authenticated;
  begin
    update status_history set to_value = 'accepte' where entity_id = k1;
    reset role;
    perform assert(false, 'l''historique se réécrit');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'un compte d''agence ne peut pas réécrire l''historique');
  end;

  -- ---------------------------------------------------------------
  -- 2. Un règlement ne se modifie jamais
  -- ---------------------------------------------------------------
  set local role authenticated;
  ref1 := refund_request(pay1, 100, 'Rendez-vous annulé par le consulat');
  reset role;
  select count(*) into n from refunds where id = ref1 and status = 'demande';
  perform assert(n = 1, 'un remboursement se demande, il ne se verse pas tout seul');

  select amount into v_num from payments where id = pay1;
  perform assert(v_num = 300, 'le règlement encaissé n''a pas bougé d''un millime');

  select count(*) into n from payments where id = pay1 and state = 'regle';
  perform assert(n = 1, 'et son état non plus : le remboursement est un mouvement de plus');

  set local role authenticated;
  begin
    perform refund_request(pay1, 250, 'trop');
    reset role;
    perform assert(false, 'on rembourse plus que l''encaissé');
  exception when raise_exception then
    reset role;
    perform assert(true, 'deux remboursements ne dépassent pas ensemble ce qui a été encaissé');
  end;

  -- ---------------------------------------------------------------
  -- 3. L'annulation ne supprime rien
  -- ---------------------------------------------------------------
  update cases set cancelled_at = now(), cancelled_by = u_owner,
                   cancellation_reason = 'Le client a renoncé', status = 'annule'
   where id = k3;
  select count(*) into n from cases where id = k3 and cancelled_at is not null;
  perform assert(n = 1, 'un dossier annulé reste là, avec sa date et sa raison');

  select count(*) into n from status_history where entity_id = k3 and to_value = 'annule';
  perform assert(n = 1, 'et l''annulation passe dans l''historique comme le reste');

  -- ---------------------------------------------------------------
  -- 4. Les champs personnalisés, validés côté serveur
  -- ---------------------------------------------------------------
  insert into custom_fields (agency_id, entity_kind, code, label, kind, position)
    values (ag, 'VISA_CASE', 'num_consulat', '{"fr":"Numéro consulat"}', 'nombre', 10)
    returning id into f_num;
  insert into custom_fields (agency_id, entity_kind, code, label, kind, options, position)
    values (ag, 'VISA_CASE', 'valise', '{"fr":"Couleur de valise"}', 'liste', array['rouge','bleue'], 20)
    returning id into f_liste;
  insert into custom_fields (agency_id, entity_kind, code, label, kind, required, position)
    values (ag, 'VISA_CASE', 'rabatteur', '{"fr":"Rabatteur"}', 'texte', true, 30)
    returning id into f_oblig;

  begin
    perform set_custom_value(f_num, k1, 'douze');
    perform assert(false, 'un texte entre dans un champ nombre');
  exception when raise_exception then
    perform assert(true, 'un champ « nombre » refuse un texte : la validation vit en base, pas dans l''écran');
  end;

  perform set_custom_value(f_num, k1, '12');
  select count(*) into n from custom_field_values where field_id = f_num and entity_id = k1 and value_number = 12;
  perform assert(n = 1, 'et range le nombre dans la colonne des nombres, pas dans du texte');

  begin
    perform set_custom_value(f_liste, k1, 'verte');
    perform assert(false, 'une valeur hors liste passe');
  exception when raise_exception then
    perform assert(true, 'une liste n''accepte que ses propres choix');
  end;

  begin
    perform set_custom_value(f_oblig, k1, '   ');
    perform assert(false, 'un champ obligatoire accepte le vide');
  exception when raise_exception then
    perform assert(true, 'un champ obligatoire refuse le vide');
  end;

  d := custom_values('VISA_CASE', k1);
  perform assert(jsonb_array_length(d) = 3, 'l''écran reçoit les trois champs, valeur comprise, en une requête');
  perform assert((d -> 0 ->> 'value')::numeric = 12, 'et la valeur déjà saisie est dedans');

  -- ---------------------------------------------------------------
  -- 5. Étiquettes, épingles, filtres
  -- ---------------------------------------------------------------
  insert into entity_tags (agency_id, entity_kind, entity_id, tag, added_by)
    values (ag, 'VISA_CASE', k1, 'urgent', u_owner);
  select count(*) into n from entity_tags where entity_id = k1;
  perform assert(n = 1, 'un dossier s''étiquette, ce que clients.tags ne savait pas faire');

  insert into pinned_items (user_id, agency_id, entity_kind, entity_id) values (u_owner, ag, 'VISA_CASE', k1);
  insert into pinned_items (user_id, agency_id, entity_kind, entity_id) values (u_agent, ag, 'VISA_CASE', k2);

  set local role authenticated;
  select count(*) into n from pinned_items;
  reset role;
  perform assert(n = 1, 'chacun ne voit que ses propres épingles');

  -- ---------------------------------------------------------------
  -- 6. Les notes à visibilité réglable
  -- ---------------------------------------------------------------
  insert into case_notes (agency_id, case_id, author_id, text, visibility)
    values (ag, k1, u_owner, 'Client à surveiller, mauvais payeur.', 'direction');
  insert into case_notes (agency_id, case_id, author_id, text, visibility)
    values (ag, k1, u_owner, 'Passeport déposé au comptoir.', 'agence');

  set local role authenticated;
  select count(*) into n from case_notes where case_id = k1;
  reset role;
  perform assert(n = 2, 'la direction lit les deux notes');

  perform _login(u_agent, ag, 'agent', o_sfax, caps_agent, array[o_sfax, o_tunis]);
  set local role authenticated;
  select count(*) into n from case_notes where case_id = k1;
  reset role;
  perform assert(n = 1, 'l''agent ne lit que la note d''agence : « mauvais payeur » ne se met pas sous ses yeux');

  -- ---------------------------------------------------------------
  -- 7. Le cloisonnement, entre agences et entre bureaux
  -- ---------------------------------------------------------------
  perform _login(u_agent, ag, 'agent', o_sfax, caps_agent, array[o_sfax]);
  set local role authenticated;
  select count(*) into n from status_history where entity_id = k1;
  reset role;
  perform assert(n = 0, 'un agent de Sfax ne lit pas l''historique d''un dossier de Tunis');

  perform _login(u_autre, ag2, 'owner', o_autre, caps_owner);
  set local role authenticated;
  select count(*) into n from status_history;
  reset role;
  perform assert(n = 0, 'et l''agence voisine ne voit rien du tout');

  set local role authenticated;
  select count(*) into n from custom_fields;
  reset role;
  perform assert(n = 0, 'les champs personnalisés d''une agence ne fuient pas chez la voisine');

  -- ---------------------------------------------------------------
  -- 8. La recherche respecte les mêmes frontières
  -- ---------------------------------------------------------------
  perform _login(u_owner, ag, 'owner', o_tunis, caps_owner);
  d := search_everything('Ben Salah', 20);
  select count(*) into n from jsonb_array_elements(d) x
   where x ->> 'kind' = 'client' and (x ->> 'id')::uuid = c_autre;
  perform assert(n = 0, 'la recherche globale ne sort jamais de l''agence');
  select count(*) into n from jsonb_array_elements(d) x where (x ->> 'id')::uuid = c1;
  perform assert(n = 1, 'mais elle trouve bien la fiche de la maison');

  perform _login(u_agent, ag, 'agent', o_sfax, caps_agent, array[o_sfax]);
  d := search_everything('Ben Salah', 20);
  select count(*) into n from jsonb_array_elements(d) x where (x ->> 'id')::uuid = c1;
  perform assert(n = 0, 'et un agent ne trouve pas les clients d''un bureau qu''on ne lui a pas ouvert');

  -- ---------------------------------------------------------------
  -- 9. La détection de doublons
  -- ---------------------------------------------------------------
  perform _login(u_owner, ag, 'owner', o_tunis, caps_owner);
  d := duplicate_scan(ag, 'CLIENT');

  select count(*) into n from jsonb_array_elements(d) g
   where g ->> 'criterion' = 'passeport_et_naissance'
     and exists (select 1 from jsonb_array_elements(g -> 'members') m where (m ->> 'id')::uuid = c2);
  perform assert(n = 1, 'deux orthographes, un seul passeport : le doublon se voit');

  select count(*) into n from jsonb_array_elements(d) g where g ->> 'criterion' = 'email';
  perform assert(n = 1, 'et deux fiches qui partagent une adresse aussi');

  d := duplicate_scan(ag, 'SHIPMENT');
  perform assert(jsonb_typeof(d) = 'array', 'le balayage des cargaisons rend un tableau, vide s''il n''y a rien');

  begin
    perform duplicate_scan(ag2, 'CLIENT');
    perform assert(false, 'on balaie les doublons de la voisine');
  exception when insufficient_privilege then
    perform assert(true, 'on ne balaie pas les doublons d''une autre agence');
  end;

  -- ---------------------------------------------------------------
  -- 10. La fusion : ce qu'elle refuse, et ce qu'elle raconte
  -- ---------------------------------------------------------------
  begin
    perform client_merge(c1, c_autre, 'essai');
    perform assert(false, 'on fusionne entre deux agences');
  exception when raise_exception then
    perform assert(true, 'deux fiches de deux agences différentes ne fusionnent pas');
  end;

  begin
    perform client_merge(c1, c1, 'essai');
    perform assert(false, 'on fusionne une fiche avec elle-même');
  exception when raise_exception then
    perform assert(true, 'une fiche ne fusionne pas avec elle-même');
  end;

  -- Avant la fusion : c2 porte deux dossiers et deux règlements.
  select count(*) into n from cases where client_id = c2;
  perform assert(n = 2, 'le décor est celui qu''on croit : deux dossiers sur la fiche absorbée');

  rep := client_merge(c1, c2, 'Même passeport, même date de naissance');
  perform assert((rep -> 'moved' ->> 'cases')::int = 2, 'le compte rendu dit exactement combien de dossiers ont bougé');
  perform assert((rep -> 'moved' ->> 'payments')::int = 2, 'et combien de règlements');
  perform assert((rep ->> 'total')::int >= 4, 'et le total ne ment pas');

  select count(*) into n from cases where client_id = c1;
  perform assert(n = 5, 'les cinq dossiers sont bien réunis sur le survivant');
  select count(*) into n from payments where client_id = c2;
  perform assert(n = 0, 'et il ne reste rien sur l''absorbée');

  select count(*) into n from clients where id = c2 and deleted_at is not null and merged_into = c1;
  perform assert(n = 1, 'l''absorbée est marquée, jamais supprimée, et elle pointe vers le survivant');
  select merge_note into v_txt from clients where id = c2;
  perform assert(v_txt = 'Même passeport, même date de naissance', 'avec la raison écrite sur la fiche');

  begin
    perform client_merge(c1, c2, 'encore');
    perform assert(false, 'on refusionne une fiche déjà absorbée');
  exception when raise_exception then
    perform assert(true, 'une fiche déjà supprimée ne se fusionne plus');
  end;

  -- ---------------------------------------------------------------
  -- 11. La numérotation : réglable, et surtout rétrocompatible
  -- ---------------------------------------------------------------
  -- L'agence voisine n'a AUCUNE règle. Elle doit recevoir exactement ce que la
  -- numérotation historique lui donnait hier. C'est la promesse du lot.
  perform _logout();
  v_txt := format_reference(ag2, o_autre, 'case');
  perform assert(v_txt = 'VF-' || extract(year from now())::int || '-0001',
                 'sans règle, la numérotation ne change pas d''un caractère');
  v_txt := format_reference(ag2, o_autre, 'case');
  perform assert(v_txt = 'VF-' || extract(year from now())::int || '-0002',
                 'et elle continue de s''incrémenter comme avant');

  insert into numbering_rules (agency_id, kind, pattern, reset_period)
    values (ag, 'case', 'VIS-{OFFICE}-{YYYY}-{SEQ:6}', 'annuel');

  perform _login(u_owner, ag, 'owner', o_tunis, caps_owner);
  v_txt := format_reference(ag, o_tunis, 'case');
  perform assert(v_txt = 'VIS-TUN-' || extract(year from now())::int || '-000001',
                 'le motif {OFFICE} et {SEQ:6} donne VIS-TUN-' || extract(year from now())::int || '-000001');

  v_txt2 := format_reference(ag, o_sfax, 'case');
  perform assert(v_txt2 = 'VIS-SFA-' || extract(year from now())::int || '-000002',
                 'le compteur est celui de l''agence, le code celui du bureau');

  insert into numbering_rules (agency_id, kind, pattern, reset_period)
    values (ag, 'receipt', 'REC-{YY}{MM}-{SEQ:4}', 'mensuel');
  v_txt := format_reference(ag, o_tunis, 'receipt');
  perform assert(v_txt = 'REC-' || to_char(now(), 'YYMM') || '-0001',
                 'une remise à zéro mensuelle numérote au mois');
  select count(*) into n from reference_counters
   where agency_id = ag and kind = 'receipt'
     and year = extract(year from now())::int * 100 + extract(month from now())::int;
  perform assert(n = 1, 'et le compteur mensuel vit dans la table qui existait déjà');

  begin
    perform format_reference(ag2, o_autre, 'case');
    perform assert(false, 'on numérote pour la voisine');
  exception when insufficient_privilege then
    perform assert(true, 'on ne tire pas un numéro dans la suite d''une autre agence');
  end;

  -- ---------------------------------------------------------------
  -- Ménage
  -- ---------------------------------------------------------------
  perform _logout();
  delete from agencies where id in (ag, ag2);
  delete from auth.users where id in (u_owner, u_agent, u_autre);
  raise notice '--- banc de l''intégrité : tout est vert ---';
end $$;

drop function _login(uuid, uuid, text, uuid, text[], uuid[]);
drop function _logout();
