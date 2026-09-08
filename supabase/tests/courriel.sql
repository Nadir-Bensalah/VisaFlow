-- Banc d'essai du courriel (migration 0064).
--
-- Ce qu'il garde, dans l'ordre où ça compte :
--   · une trace ne se corrige pas. Ni update, ni delete, pour personne ;
--   · une trace ne se fabrique pas non plus depuis l'application : seule
--     email_record écrit, et elle n'est pas ouverte aux comptes connectés ;
--   · la date d'envoi n'existe QUE sur un envoi réussi. C'est la règle qui a
--     déjà mordu ce projet : une fonction disait « envoyé » sans rien envoyer ;
--   · une agence ne voit pas les traces d'une autre, et personne d'autre que
--     la plateforme ne voit celles de la plateforme ;
--   · email_ready() rend faux tant qu'aucune clé n'a été constatée ;
--   · la limite de débit, parce qu'un domaine d'envoi grillé se répare en
--     semaines.

\set ON_ERROR_STOP on
set search_path = public;

-- BANC REJOUABLE : on efface d'abord ce qu'un passage précédent aurait laissé.
delete from agencies where slug in ('mailtest', 'mailtest2');
delete from email_log where to_address like '%@banc-courriel.test';
delete from rate_limits where bucket = 'email';
update email_config set ready = false, provider = null, from_address = null,
       note = null, checked_at = null where id;

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then raise notice 'OK    %', label;
  else raise exception 'ÉCHEC %', label; end if;
end $$;

do $$
declare
  a uuid; a2 uuid; o uuid; o2 uuid;
  u_own uuid; u_view uuid; u_own2 uuid; u_admin uuid;
  t1 uuid; t2 uuid; t3 uuid;
  n int; i int; ok boolean; ts timestamptz;
begin
  -- ---------------------------------------------------------------
  -- Le décor
  -- ---------------------------------------------------------------
  insert into agencies (slug, name, services, email)
    values ('mailtest', 'Courriel Test', '{visas}', 'contact@mailtest.tn') returning id into a;
  insert into offices (agency_id, name, country, country_code)
    values (a, 'Tunis', 'Tunisie', 'TN') returning id into o;
  insert into agencies (slug, name, services)
    values ('mailtest2', 'Courriel Test 2', '{visas}') returning id into a2;
  insert into offices (agency_id, name, country, country_code)
    values (a2, 'Sfax', 'Tunisie', 'TN') returning id into o2;

  insert into auth.users (email) values ('own@banc-courriel.test') returning id into u_own;
  insert into auth.users (email) values ('view@banc-courriel.test') returning id into u_view;
  insert into auth.users (email) values ('own2@banc-courriel.test') returning id into u_own2;
  insert into auth.users (email) values ('admin@banc-courriel.test') returning id into u_admin;
  insert into profiles (id, agency_id, office_id, name, email, role)
    values (u_own, a, o, 'Patron', 'own@banc-courriel.test', 'owner');
  insert into profiles (id, agency_id, office_id, name, email, role)
    values (u_view, a, o, 'Lecteur', 'view@banc-courriel.test', 'viewer');
  insert into profiles (id, agency_id, office_id, name, email, role)
    values (u_own2, a2, o2, 'Patron 2', 'own2@banc-courriel.test', 'owner');
  insert into platform_admins (id, name, email)
    values (u_admin, 'Banc Courriel', 'admin@banc-courriel.test');

  -- ---------------------------------------------------------------
  -- 1 · email_ready() ment par défaut dans le bon sens
  -- ---------------------------------------------------------------
  perform assert(email_ready() = false,
    'sans clé constatée, email_ready() rend faux');

  perform email_state_set('resend', 'VisaFlow <no-reply@visaflow.app>', true, 'clé présente');
  perform assert(email_ready() = true,
    'une fois la clé constatée, email_ready() rend vrai');

  perform email_state_set('resend', null, false, 'RESEND_API_KEY absente');
  perform assert(email_ready() = false,
    'la clé retirée, email_ready() redevient faux');
  perform assert((select note from email_config where id) = 'RESEND_API_KEY absente',
    'l''état garde la raison, pas seulement le booléen');

  -- ---------------------------------------------------------------
  -- 2 · La règle : jamais dire qu'un message est parti
  -- ---------------------------------------------------------------
  t1 := email_record(a, 'facture', 'client@banc-courriel.test', 'Votre facture',
                     'envoye', 'resend', 'msg-1', null, u_own);
  select sent_at into ts from email_log where id = t1;
  perform assert(ts is not null, 'une trace « envoye » porte une date d''envoi');

  t2 := email_record(a, 'facture', 'client@banc-courriel.test', 'Votre facture',
                     'echoue', 'resend', null, 'adresse refusée', u_own);
  select sent_at into ts from email_log where id = t2;
  perform assert(ts is null, 'une trace « echoue » n''a PAS de date d''envoi');

  t3 := email_record(a, 'mot_de_passe', 'perdu@banc-courriel.test', 'Mot de passe',
                     'non_configure', null, null, 'aucune clé de fournisseur', u_own);
  select sent_at into ts from email_log where id = t3;
  perform assert(ts is null,
    'une trace « non_configure » n''a pas de date d''envoi : rien n''est parti');
  select count(*) into n from email_log where id = t3 and error is not null;
  perform assert(n = 1,
    'et elle garde quand même la raison, pour que l''agence sache pourquoi');

  -- La contrainte de la table, pas seulement la politesse de la fonction.
  begin
    insert into email_log (agency_id, kind, to_address, subject, status, sent_at)
      values (a, 'systeme', 'x@banc-courriel.test', 'x', 'echoue', now());
    perform assert(false, 'une trace ratée datée d''un envoi devrait être refusée');
  exception when check_violation then
    perform assert(true, 'le schéma refuse une trace ratée datée d''un envoi');
  end;

  -- ---------------------------------------------------------------
  -- 3 · Le vocabulaire est fermé
  -- ---------------------------------------------------------------
  begin
    perform email_record(a, 'newsletter', 'x@banc-courriel.test', 'x', 'envoye');
    perform assert(false, 'un genre inconnu devrait être refusé');
  exception when others then
    perform assert(true, 'un genre de courriel inconnu est refusé');
  end;

  begin
    perform email_record(a, 'systeme', 'x@banc-courriel.test', 'x', 'peut_etre');
    perform assert(false, 'un statut inconnu devrait être refusé');
  exception when others then
    perform assert(true, 'un statut de courriel inconnu est refusé');
  end;

  begin
    perform email_record(a, 'systeme', '  ', 'x', 'envoye');
    perform assert(false, 'un destinataire vide devrait être refusé');
  exception when others then
    perform assert(true, 'un destinataire vide est refusé');
  end;

  -- ---------------------------------------------------------------
  -- 4 · Une trace ne se corrige pas
  -- ---------------------------------------------------------------
  perform test_login(u_own, a, 'owner', o);
  set local role authenticated;

  begin
    update email_log set status = 'envoye' where id = t2;
    reset role;
    perform assert(false, 'une trace ne devrait pas pouvoir être modifiée');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'un compte connecté ne peut pas modifier une trace');
  end;

  set local role authenticated;
  begin
    delete from email_log where id = t2;
    reset role;
    perform assert(false, 'une trace ne devrait pas pouvoir être supprimée');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'un compte connecté ne peut pas supprimer une trace');
  end;

  set local role authenticated;
  begin
    insert into email_log (agency_id, kind, to_address, subject, status)
      values (a, 'facture', 'faux@banc-courriel.test', 'Faux', 'envoye');
    reset role;
    perform assert(false, 'une trace ne devrait pas pouvoir être fabriquée');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'un compte connecté ne peut pas fabriquer une trace');
  end;

  -- ---------------------------------------------------------------
  -- 5 · Le cloisonnement
  -- ---------------------------------------------------------------
  perform email_record(a2, 'devis', 'autre@banc-courriel.test', 'Devis', 'envoye', 'resend', 'msg-2');
  perform email_record(null, 'mot_de_passe', 'oubli@banc-courriel.test', 'Mot de passe',
                       'envoye', 'resend', 'msg-3');

  perform test_login(u_own, a, 'owner', o);
  set local role authenticated;
  select count(*) into n from email_log;
  reset role;
  perform assert(n = 3, 'le patron voit les trois traces de SON agence (' || n || ')');

  perform test_login(u_own, a, 'owner', o);
  set local role authenticated;
  select count(*) into n from email_log where agency_id = a2;
  reset role;
  perform assert(n = 0, 'et aucune de l''agence voisine');

  perform test_login(u_own, a, 'owner', o);
  set local role authenticated;
  select count(*) into n from email_log where agency_id is null;
  reset role;
  perform assert(n = 0,
    'les envois de la plateforme restent invisibles à une agence');

  -- Un lecteur n'a pas settings:view : le journal ne le regarde pas.
  perform test_login(u_view, a, 'viewer', o);
  set local role authenticated;
  select count(*) into n from email_log;
  reset role;
  perform assert(n = 0, 'un lecteur ne voit aucune trace');

  perform test_login(u_admin, null, null, null);
  set local role authenticated;
  select count(*) into n from email_log;
  reset role;
  perform assert(n = 5, 'la plateforme voit tout, agence par agence (' || n || ')');

  -- ---------------------------------------------------------------
  -- 6 · Les réglages de bord ne se lisent pas depuis une agence
  -- ---------------------------------------------------------------
  perform test_login(u_own, a, 'owner', o);
  set local role authenticated;
  select count(*) into n from edge_settings;
  reset role;
  perform assert(n = 0,
    'le nom du secret de la clé de service reste hors de portée d''une agence');

  perform test_login(u_admin, null, null, null);
  set local role authenticated;
  select count(*) into n from edge_settings;
  reset role;
  perform assert(n = 1, 'la plateforme, elle, lit ses réglages de bord');

  -- ---------------------------------------------------------------
  -- 7 · La limite de débit
  -- ---------------------------------------------------------------
  delete from rate_limits where bucket = 'email';
  ok := true;
  for i in 1..200 loop
    ok := email_rate_ok(a);
  end loop;
  perform assert(ok, 'les deux cents premiers courriels de l''heure passent');
  perform assert(email_rate_ok(a) = false,
    'le deux cent unième est refusé : un domaine grillé se répare en semaines');
  perform assert(email_rate_ok(a2) = true,
    'et la limite est par agence : la voisine n''est pas punie');

  raise notice '--- banc courriel : tout est vert ---';
end $$;

-- ---------------------------------------------------------------
-- Les droits, hors transaction de décor
-- ---------------------------------------------------------------
do $$
declare n int;
begin
  perform assert(
    not has_function_privilege('anon', 'email_record(uuid,text,text,text,text,text,text,text,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'email_record(uuid,text,text,text,text,text,text,text,uuid)', 'execute'),
    'email_record n''est ouverte ni à l''anonyme ni à un compte connecté');

  perform assert(
    not has_function_privilege('anon', 'email_ready()', 'execute')
    and has_function_privilege('authenticated', 'email_ready()', 'execute'),
    'email_ready() s''ouvre aux comptes connectés, pas à l''anonyme');

  perform assert(
    not has_function_privilege('anon', 'dispatch_webhooks()', 'execute')
    and not has_function_privilege('authenticated', 'dispatch_webhooks()', 'execute'),
    'dispatch_webhooks reste à la clé de service');

  -- Le piège de 0015 : une table nouvelle reçoit UPDATE et DELETE toute seule.
  select count(*) into n
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name in ('email_log', 'email_config', 'edge_settings')
    and grantee in ('anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  perform assert(n = 0,
    'aucune des trois tables ne garde le droit d''écriture hérité de 0015 (' || n || ' de trop)');

  select count(*) into n
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relname in ('email_log', 'email_config', 'edge_settings')
    and c.relrowsecurity and c.relforcerowsecurity;
  perform assert(n = 3, 'RLS activée ET forcée sur les trois tables');

  select count(*) into n from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname = 'email_log' and p.polcmd <> 'r';
  perform assert(n = 0,
    'email_log ne porte aucune politique d''écriture : email_record est la seule porte');

  raise notice '--- banc courriel, droits : tout est vert ---';
end $$;

-- Un banc ne laisse rien derrière lui.
delete from agencies where slug in ('mailtest', 'mailtest2');
delete from platform_admins where email = 'admin@banc-courriel.test';
delete from auth.users where email like '%@banc-courriel.test';
delete from email_log where to_address like '%@banc-courriel.test';
delete from rate_limits where bucket = 'email';
