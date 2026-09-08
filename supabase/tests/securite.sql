-- Banc d'essai du module sécurité et audit (migration 0050).
--
-- Il est écrit pour un auditeur, pas pour un développeur. Chaque assertion
-- répond à une question qu'on posera à l'agence le jour du contrôle :
--   · « Prouvez-moi que vous savez qui a changé ce numéro de passeport. »
--   · « Prouvez-moi que ce journal ne peut pas être réécrit. »
--   · « Prouvez-moi qu'une agence ne lit pas le journal d'une autre. »
--   · « Que se passe-t-il si quelqu'un dépose un exécutable déguisé ? »
--
-- Il crée ses propres agences, avec des identifiants tirés au hasard, pour
-- pouvoir tourner après les autres bancs sur la même base.

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
  tag text := substr(md5(random()::text), 1, 8);
  s1 uuid; s2 uuid; of1 uuid; of2 uuid;
  u_dir uuid; u_ag uuid; u_ext uuid;
  cl1 uuid; k1 uuid; vt1 uuid; doc1 uuid;
  sess1 uuid; sess2 uuid;
  tok text; lien uuid; ver int;
  rec audit_logs; tl tracking_links; se security_events;
  n int; m int; ok boolean; res jsonb;
begin
  -- ---------------------------------------------------------------
  -- Le décor : deux agences, trois comptes
  -- ---------------------------------------------------------------
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_dir;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_ag;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_ext;

  insert into agencies (slug, name, services)
    values ('sec-' || tag, 'Sécurité Voyages', '{visas,fret}') returning id into s1;
  insert into agencies (slug, name, services)
    values ('aut-' || tag, 'Autre Agence', '{visas}') returning id into s2;

  insert into offices (agency_id, name, country, country_code)
    values (s1, 'Tunis', 'Tunisie', 'TN') returning id into of1;
  insert into offices (agency_id, name, country, country_code)
    values (s2, 'Sfax', 'Tunisie', 'TN') returning id into of2;

  insert into profiles (id, agency_id, office_id, name, role) values
    (u_dir, s1, of1, 'Leila',  'owner'),
    (u_ag,  s1, of1, 'Karim',  'agent'),
    (u_ext, s2, of2, 'Sonia',  'owner');

  perform seed_catalogue(s1, '{visas,fret}');
  select id into vt1 from visa_types where agency_id = s1 limit 1;

  -- ---------------------------------------------------------------
  -- 1. Le déclencheur est bien posé, et le schéma tient
  -- ---------------------------------------------------------------
  select count(distinct c.relname) into n
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and t.tgname like 'audit\_%'
     and c.relname in ('clients','cases','payments','passport_custody','profiles','case_documents');
  perform assert(n = 6, 'le déclencheur d''audit est posé sur les 6 tables sensibles (' || n || ')');

  select count(*) into n from pg_class
   where relname in ('audit_logs','security_events','user_sessions','tracking_links','document_versions')
     and relrowsecurity and relforcerowsecurity;
  perform assert(n = 5, 'les 5 tables du module ont RLS activé ET forcé');

  -- ---------------------------------------------------------------
  -- 2. Un numéro de passeport qui change laisse une trace exploitable
  -- ---------------------------------------------------------------
  perform test_login(u_dir, s1, 'owner', of1);
  set local role authenticated;
  insert into clients (agency_id, office_id, first_name, last_name, phone, passport_number, nationality)
    values (s1, of1, 'Nadia', 'Trabelsi', '+2162' || tag, 'AA123456', 'TN')
    returning id into cl1;
  update clients set passport_number = 'AA123457' where id = cl1;
  reset role;

  select count(*) into n from audit_logs
   where entity_type = 'clients' and entity_id = cl1 and action = 'create';
  perform assert(n = 1, 'la création du client est journalisée');

  select * into rec from audit_logs
   where entity_type = 'clients' and entity_id = cl1 and action = 'update'
   order by at desc limit 1;
  perform assert(rec.id is not null, 'la modification du client est journalisée');
  perform assert(rec.old_values ->> 'passport_number' = 'AA123456',
    'le journal garde l''ANCIEN numéro de passeport (' || coalesce(rec.old_values ->> 'passport_number', 'néant') || ')');
  perform assert(rec.new_values ->> 'passport_number' = 'AA123457',
    'le journal garde le NOUVEAU numéro de passeport (' || coalesce(rec.new_values ->> 'passport_number', 'néant') || ')');
  perform assert(rec.changed_fields = array['passport_number'],
    'changed_fields ne nomme que le champ qui a bougé');
  select count(*) into n from jsonb_object_keys(rec.old_values);
  select count(*) into m from jsonb_object_keys(rec.new_values);
  perform assert(n = 1 and m = 1,
    'le journal ne recopie PAS la ligne entière (' || n || ' champ avant, ' || m || ' après)');
  perform assert(rec.old_values ->> 'last_name' is null,
    'les champs non modifiés ne sont pas recopiés dans le journal');
  perform assert(rec.user_id = u_dir, 'le journal nomme l''auteur du changement');

  -- Une écriture qui ne change rien n'a rien à raconter.
  select count(*) into n from audit_logs where entity_id = cl1;
  perform test_login(u_dir, s1, 'owner', of1);
  set local role authenticated;
  update clients set first_name = 'Nadia' where id = cl1;
  reset role;
  select count(*) into m from audit_logs where entity_id = cl1;
  perform assert(n = m, 'une mise à jour sans changement réel n''écrit aucune ligne de journal');

  -- ---------------------------------------------------------------
  -- 3. Le journal ne se modifie pas, et ne s'efface pas
  -- ---------------------------------------------------------------
  perform test_login(u_dir, s1, 'owner', of1);
  set local role authenticated;
  begin
    update audit_logs set action = 'create' where agency_id = s1;
    get diagnostics n = row_count;
    perform assert(n = 0, 'aucune ligne d''audit n''est modifiable, même par la direction');
  exception when insufficient_privilege then
    perform assert(true, 'la direction n''a même pas le droit de modifier le journal d''audit');
  end;
  begin
    delete from audit_logs where agency_id = s1;
    get diagnostics n = row_count;
    perform assert(n = 0, 'aucune ligne d''audit n''est effaçable');
  exception when insufficient_privilege then
    perform assert(true, 'la direction n''a même pas le droit d''effacer le journal d''audit');
  end;
  reset role;

  select count(*) into n from pg_policies
   where schemaname = 'public'
     and tablename in ('audit_logs','security_events','document_versions')
     and cmd in ('UPDATE','DELETE','ALL');
  perform assert(n = 0, 'aucune politique d''update ni de delete sur les trois journaux');

  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated'
     and table_name in ('audit_logs','security_events','document_versions')
     and privilege_type in ('UPDATE','DELETE','TRUNCATE');
  perform assert(n = 0, 'authenticated n''a ni UPDATE ni DELETE ni TRUNCATE sur les journaux');

  -- ---------------------------------------------------------------
  -- 4. Le cloisonnement entre agences, et le droit d'audit
  -- ---------------------------------------------------------------
  perform test_login(u_ext, s2, 'owner', of2);
  set local role authenticated;
  select count(*) into n from audit_logs where agency_id = s1;
  perform assert(n = 0, 'l''autre agence ne lit aucune ligne du journal de la première');
  select count(*) into n from tracking_links where agency_id = s1;
  perform assert(n = 0, 'l''autre agence ne voit aucun lien de suivi de la première');
  reset role;

  perform test_login(u_ag, s1, 'agent', of1);
  set local role authenticated;
  select count(*) into n from audit_logs;
  perform assert(n = 0, 'un agent sans droit d''audit ne lit pas le journal de sa propre agence');
  begin
    select count(*) into n from audit_search('clients', cl1, null, null, 10);
    perform assert(false, 'audit_search doit refuser un agent');
  exception when insufficient_privilege then
    perform assert(true, 'audit_search refuse un compte sans audit:view');
  end;
  begin
    select count(*) into n from security_feed(10);
    perform assert(false, 'security_feed doit refuser un agent');
  exception when insufficient_privilege then
    perform assert(true, 'security_feed refuse un compte sans audit:view');
  end;
  reset role;

  perform test_login(u_dir, s1, 'owner', of1);
  set local role authenticated;
  select count(*) into n from audit_search('clients', cl1, null, null, 50);
  perform assert(n >= 2, 'audit_search rend le journal de l''entité à qui a le droit (' || n || ' lignes)');
  reset role;

  -- ---------------------------------------------------------------
  -- 5. Les événements de sécurité
  -- ---------------------------------------------------------------
  perform test_login(u_dir, s1, 'owner', of1);
  set local role authenticated;
  perform security_note('SUSPICIOUS_ACTIVITY', jsonb_build_object('quoi', 'essai'));
  reset role;

  select * into se from security_events
   where agency_id = s1 and kind = 'SUSPICIOUS_ACTIVITY' order by at desc limit 1;
  perform assert(se.id is not null, 'security_note dépose bien un événement');
  perform assert(se.severity = 'critique', 'la gravité est déduite du type, pas choisie par l''appelant');
  perform assert(se.user_id = u_dir, 'l''événement nomme le compte concerné');

  -- ---------------------------------------------------------------
  -- 6. Un changement de rôle est traité comme ce qu'il est
  -- ---------------------------------------------------------------
  perform test_login(u_dir, s1, 'owner', of1);
  set local role authenticated;
  update profiles set role = 'manager' where id = u_ag;
  reset role;

  select count(*) into n from audit_logs
   where entity_type = 'profiles' and entity_id = u_ag and action = 'permission_change';
  perform assert(n = 1, 'un changement de rôle est journalisé comme permission_change');
  select count(*) into n from security_events
   where agency_id = s1 and kind = 'PERMISSION_CHANGED';
  perform assert(n = 1, 'un changement de rôle remonte aussi dans le fil de sécurité');

  -- ---------------------------------------------------------------
  -- 7. Les appareils
  -- ---------------------------------------------------------------
  perform test_login(u_dir, s1, 'owner', of1);
  set local role authenticated;
  select session_touch('MacBook du comptoir', 'Safari', 'macOS') into sess1;
  select session_touch('MacBook du comptoir', 'Safari', 'macOS') into sess2;
  select count(*) into n from my_sessions();
  reset role;

  perform assert(sess1 is not null and sess1 = sess2,
    'deux connexions du même poste rafraîchissent la même ligne');
  perform assert(n = 1, 'my_sessions rend un seul appareil');

  select count(*) into n from security_events where user_id = u_dir and kind = 'NEW_DEVICE';
  perform assert(n = 1, 'un appareil jamais vu produit un événement NEW_DEVICE, une seule fois');
  select count(*) into n from audit_logs where user_id = u_dir and action = 'login';
  perform assert(n = 2, 'chaque connexion laisse une trace login (' || n || ')');

  perform test_login(u_ext, s2, 'owner', of2);
  set local role authenticated;
  select count(*) into n from my_sessions();
  reset role;
  perform assert(n = 0, 'personne ne voit les appareils d''un autre compte');

  perform test_login(u_dir, s1, 'owner', of1);
  set local role authenticated;
  select session_revoke(sess1) into ok;
  reset role;
  perform assert(ok, 'session_revoke répond vrai');
  select count(*) into n from user_sessions where id = sess1 and revoked_at is not null;
  perform assert(n = 1, 'la révocation est datée dans la table');
  select count(*) into n from security_events where agency_id = s1 and kind = 'SESSION_REVOKED';
  perform assert(n = 1, 'la révocation laisse un événement de sécurité');

  -- ---------------------------------------------------------------
  -- 8. Les liens de suivi : l'empreinte, jamais le jeton
  -- ---------------------------------------------------------------
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id)
    values (s1, 'VF-' || tag || '-0001', cl1, vt1, of1) returning id into k1;

  perform test_login(u_dir, s1, 'owner', of1);
  set local role authenticated;
  select tracking_issue('VISA_CASE', k1, 15, true) into tok;
  reset role;

  perform assert(tok is not null and length(tok) = 64, 'tracking_issue rend un jeton de 64 caractères');
  select * into tl from tracking_links where agency_id = s1 and entity_id = k1;
  perform assert(tl.id is not null, 'le lien est enregistré');
  perform assert(tl.token_hash = encode(extensions.digest(tok, 'sha256'), 'hex'),
    'la table ne garde que l''empreinte SHA-256 du jeton');
  perform assert(to_jsonb(tl)::text not like '%' || tok || '%',
    'le jeton en clair n''apparaît dans AUCUNE colonne de la table');
  perform assert(tl.requires_otp, 'l''exigence de code à usage unique est retenue');
  perform assert(tl.expires_at is not null and tl.expires_at < now() + interval '16 days',
    'un lien de suivi a toujours une date de fin');

  perform test_login(u_dir, s1, 'owner', of1);
  set local role authenticated;
  select tracking_open(tok) into res;
  reset role;
  perform assert(res ->> 'entity_id' = k1::text, 'un jeton valide résout bien vers son dossier');
  select open_count into n from tracking_links where id = tl.id;
  perform assert(n = 1, 'l''ouverture est comptée');

  perform test_login(u_ext, s2, 'owner', of2);
  set local role authenticated;
  begin
    perform tracking_issue('VISA_CASE', k1, 30, false);
    perform assert(false, 'une agence ne doit pas émettre de lien sur le dossier d''une autre');
  exception when others then
    perform assert(sqlstate in ('P0002','42501'),
      'une agence ne peut pas émettre de lien sur le dossier d''une autre');
  end;
  reset role;

  perform test_login(u_dir, s1, 'owner', of1);
  set local role authenticated;
  select tracking_revoke(tl.id) into ok;
  select tracking_open(tok) into res;
  reset role;
  perform assert(ok, 'tracking_revoke répond vrai');
  perform assert(res is null, 'un lien révoqué ne résout plus rien');

  -- ---------------------------------------------------------------
  -- 9. Les versions de pièces
  -- ---------------------------------------------------------------
  insert into case_documents (agency_id, case_id, key, label)
    values (s1, k1, 'passeport', '{"fr":"Passeport"}') returning id into doc1;

  perform test_login(u_dir, s1, 'owner', of1);
  set local role authenticated;
  select document_version_add(doc1, 'case', 'pieces/v1.pdf', 'passeport.pdf', 120000, 'aaa111') into ver;
  perform assert(ver = 1, 'la première version porte le numéro 1');
  select document_version_add(doc1, 'case', 'pieces/v2.pdf', 'passeport.pdf', 130000, 'bbb222') into ver;
  perform assert(ver = 2, 'la pièce remplacée devient la version 2');
  reset role;

  select count(*) into n from document_versions where document_id = doc1;
  perform assert(n = 2, 'les deux versions coexistent');
  select count(*) into n from document_versions
   where document_id = doc1 and version_number = 1 and storage_path = 'pieces/v1.pdf';
  perform assert(n = 1, 'la version précédente est intacte, avec son chemin d''origine');

  perform test_login(u_dir, s1, 'owner', of1);
  set local role authenticated;
  begin
    update document_versions set sha256 = 'réécrit' where document_id = doc1;
    get diagnostics n = row_count;
    perform assert(n = 0, 'une version de pièce ne se réécrit pas');
  exception when insufficient_privilege then
    perform assert(true, 'une version de pièce ne se réécrit pas, le droit n''existe pas');
  end;
  reset role;

  -- ---------------------------------------------------------------
  -- 10. Les fichiers déposés
  -- ---------------------------------------------------------------
  perform assert((file_accept('passeport.pdf', 'application/pdf', 500000) ->> 'ok')::boolean,
    'un PDF de 500 Ko est accepté');
  perform assert((file_accept('photo.heic', '', 300000) ->> 'ok')::boolean,
    'un HEIC sans type déclaré est accepté, comme le fait un iPhone');
  perform assert(file_accept('passeport.pdf', 'application/pdf', 11 * 1024 * 1024) ->> 'raison' = 'trop_gros',
    'un fichier de 11 Mo est refusé : la limite est 10 Mo');
  perform assert(file_accept('outil.exe', 'application/pdf', 1000) ->> 'raison' = 'extension_refusee',
    'une extension hors liste est refusée');
  perform assert(file_accept('facture.exe.pdf', 'application/pdf', 1000) ->> 'raison' = 'double_extension',
    'une double extension est refusée');
  perform assert(file_accept('../../etc/passwd.pdf', 'application/pdf', 1000) ->> 'raison' = 'chemin_dans_le_nom',
    'un nom qui contient un chemin est refusé');
  perform assert(file_accept('photo.png', 'application/pdf', 1000) ->> 'raison' = 'type_incoherent',
    'un .png annoncé application/pdf est refusé : l''un des deux ment');
  perform assert(file_accept('passeport.pdf', 'application/pdf', 0) ->> 'raison' = 'fichier_vide',
    'un fichier vide est refusé');

  -- ---------------------------------------------------------------
  -- 11. L'export tracé
  -- ---------------------------------------------------------------
  perform test_login(u_dir, s1, 'owner', of1);
  set local role authenticated;
  perform data_export_note('clients');
  reset role;
  select count(*) into n from security_events where agency_id = s1 and kind = 'EXPORT_DATA';
  perform assert(n = 1, 'un export dépose un événement EXPORT_DATA');
  select count(*) into n from audit_logs where agency_id = s1 and action = 'export';
  perform assert(n = 1, 'un export laisse aussi une ligne dans le journal de la donnée');

  -- ---------------------------------------------------------------
  -- 12. Les gardes de forme, celles qu'un audit relit
  -- ---------------------------------------------------------------
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'audit_trigger'
     and pg_get_functiondef(p.oid) ilike '%exception when others%';
  perform assert(n = 1, 'le déclencheur d''audit avale son erreur : il ne bloque jamais le comptoir');

  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('sec_req_ip','sec_req_agent','sec_severity','security_note','audit_trigger',
                       'session_touch','session_revoke','my_sessions','tracking_issue','tracking_revoke',
                       'document_version_add','document_history','file_accept',
                       'audit_search','security_feed','audit_read_note','data_export_note')
     and has_function_privilege('anon', p.oid, 'execute');
  perform assert(n = 0, 'aucune fonction du module n''est ouverte à l''anonyme (' || n || ' de trop)');

  -- `tracking_open` fait exception, et c'est sa raison d'être : un client n'a
  -- pas de compte, et un lien de suivi qu'il ne peut pas ouvrir est un lien
  -- mort. Elle ne prend qu'un jeton, ne rend rien sans jeton valide, et rend la
  -- même chose pour un jeton inconnu, révoqué ou périmé : aucun essai ne
  -- renseigne. Ouverte par la migration 0057.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in ('tracking_open', 'tracking_resolve')
     and has_function_privilege('anon', p.oid, 'execute');
  perform assert(n = 2, 'le suivi par lien s''ouvre bien sans compte (' || n || ' sur 2)');

  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prosecdef
     and p.proname in ('security_note','audit_trigger','session_touch','session_revoke',
                       'tracking_issue','tracking_revoke','tracking_open','document_version_add',
                       'audit_search','security_feed','audit_read_note','data_export_note')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  perform assert(n = 0, 'toutes les fonctions SECURITY DEFINER du module ont un search_path figé');

  select count(distinct table_name) into n from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'service_role'
     and table_name in ('audit_logs','security_events','user_sessions','tracking_links','document_versions');
  perform assert(n = 5, 'la clé de service atteint les 5 tables du module');

  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'
     and table_name in ('audit_logs','security_events','user_sessions','tracking_links','document_versions');
  perform assert(n = 0, 'l''anonyme n''a aucun droit direct sur les tables du module');

  raise notice '--- banc sécurité : tout est vert ---';
end $$;
