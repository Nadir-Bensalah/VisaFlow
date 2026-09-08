-- Banc d'essai des modèles de poste (migration 0062).
--
-- Ce que ce banc protège : un modèle est un raccourci de saisie, il ne doit
-- JAMAIS pouvoir donner un droit que le rôle ne saurait pas porter, ni servir
-- de porte dérobée pour se promouvoir soi-même. On vérifie donc les deux faces :
-- que le raccourci pose bien ce qu'il annonce, et qu'il refuse tout le reste.

\set ON_ERROR_STOP on
set search_path = public;

-- BANC REJOUABLE : on efface d'abord ce qu'un passage précédent aurait laissé.
-- Sans ça, le deuxième lancement échoue sur le slug déjà pris, et on croit à
-- une régression alors que c'est un résidu.
delete from agencies where slug in ('postes', 'postes2');

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then raise notice 'OK    %', label;
  else raise exception 'ÉCHEC %', label; end if;
end $$;

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
  ag uuid; ag2 uuid; o_tunis uuid; o_sfax uuid; o_autre uuid;
  u_owner uuid; u_agent uuid; u_second uuid; u_autre uuid;
  t_conseiller uuid; t_verif uuid; t_caisse uuid; t_compta uuid;
  t_gestion uuid; t_coursier uuid; t_maison uuid; t_voisin uuid;
  n int; caps text[]; v_role text;
begin
  -- ---------------------------------------------------------------
  -- Le décor : deux agences, pour vérifier le cloisonnement
  -- ---------------------------------------------------------------
  insert into agencies (slug, name, services) values ('postes', 'Banc Postes', '{visas,fret}') returning id into ag;
  insert into agencies (slug, name, services) values ('postes2', 'Agence Voisine', '{visas}') returning id into ag2;

  insert into offices (agency_id, name, country, country_code) values (ag, 'Tunis', 'Tunisie', 'TN') returning id into o_tunis;
  insert into offices (agency_id, name, country, country_code) values (ag, 'Sfax', 'Tunisie', 'TN') returning id into o_sfax;
  insert into offices (agency_id, name, country, country_code) values (ag2, 'Ailleurs', 'Tunisie', 'TN') returning id into o_autre;

  insert into auth.users (id) values (gen_random_uuid()) returning id into u_owner;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_agent;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_second;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_autre;

  insert into profiles (id, agency_id, office_id, name, email, role) values
    (u_owner,  ag,  o_tunis, 'Slim',  'slim@postes.test',  'owner'),
    (u_agent,  ag,  o_tunis, 'Amira', 'amira@postes.test', 'agent'),
    (u_second, ag,  o_sfax,  'Hatem', 'hatem@postes.test', 'agent'),
    (u_autre,  ag2, o_autre, 'Rania', 'rania@postes2.test','owner');

  select id into t_conseiller from job_templates where agency_id is null and code = 'conseiller';
  select id into t_verif      from job_templates where agency_id is null and code = 'verification_pieces';
  select id into t_caisse     from job_templates where agency_id is null and code = 'caisse';
  select id into t_compta     from job_templates where agency_id is null and code = 'comptabilite';
  select id into t_gestion    from job_templates where agency_id is null and code = 'gestionnaire';
  select id into t_coursier   from job_templates where agency_id is null and code = 'coursier';

  -- ---------------------------------------------------------------
  -- 1. Les modèles livrés avec le produit
  -- ---------------------------------------------------------------
  select count(*) into n from job_templates where agency_id is null and active;
  perform assert(n = 9, 'les neuf postes d''une agence tunisienne sont livrés');

  -- Le modèle ne cite que des capacités qui existent : une capacité inventée ne
  -- serait protégée par aucune politique, et l'erreur ne se verrait qu'en
  -- production, sur un compte réel.
  select count(*) into n
  from job_templates jt, unnest(jt.grants || jt.revokes) c
  where not exists (select 1 from permissions p where p.code = c);
  perform assert(n = 0, 'aucun modèle ne cite une capacité qui n''existe pas');

  -- ---------------------------------------------------------------
  -- 2. Appliquer un modèle pose le rôle ET les écarts
  -- ---------------------------------------------------------------
  perform _login(u_owner, ag, 'owner', o_tunis, null, array[]::uuid[]);
  set local role authenticated;
  perform apply_job_template(u_agent, t_verif);
  reset role;

  select role into v_role from profiles where id = u_agent;
  perform assert(v_role = 'agent', 'appliquer un modèle pose le rôle de base');
  select count(*) into n from member_permissions where user_id = u_agent and not granted;
  perform assert(n = 2, 'et pose les deux écarts du vérificateur, pas un de plus');

  caps := member_capabilities(u_agent);
  perform assert('doc:validate' = any (caps), 'le vérificateur valide les pièces');
  perform assert(not ('payment:write' = any (caps)), 'le vérificateur n''encaisse pas');
  perform assert(not ('case:create' = any (caps)), 'et n''ouvre pas de dossier');

  -- ---------------------------------------------------------------
  -- 3. Le caissier : la séparation qui protège la caisse
  -- ---------------------------------------------------------------
  perform _login(u_owner, ag, 'owner', o_tunis, null, array[]::uuid[]);
  set local role authenticated;
  perform apply_job_template(u_agent, t_caisse);
  reset role;

  caps := member_capabilities(u_agent);
  perform assert('payment:write' = any (caps), 'le caissier encaisse');
  perform assert(not ('doc:validate' = any (caps)), 'le caissier ne valide PAS les pièces');
  perform assert(not ('finance:global' = any (caps)), 'et ne voit pas toute la caisse de l''agence');

  -- Changer de poste efface l'ancien : sinon un vieil écart survivrait en
  -- silence, et le compte porterait un droit qu'on croit retiré.
  select count(*) into n from member_permissions where user_id = u_agent;
  perform assert(n = 2, 'changer de poste remplace les écarts, il ne les empile pas');

  -- ---------------------------------------------------------------
  -- 4. Le comptable : l'argent sans les dossiers
  -- ---------------------------------------------------------------
  perform _login(u_owner, ag, 'owner', o_tunis, null, array[]::uuid[]);
  set local role authenticated;
  perform apply_job_template(u_second, t_compta);
  reset role;

  select role into v_role from profiles where id = u_second;
  perform assert(v_role = 'viewer', 'le comptable part du rôle lecteur');
  caps := member_capabilities(u_second);
  perform assert('finance:global' = any (caps), 'le comptable voit toute la caisse');
  perform assert('reports:view' = any (caps), 'et les rapports');
  perform assert(not ('case:write' = any (caps)), 'mais il ne fait pas avancer un dossier');
  perform assert(not ('team:manage' = any (caps)), 'et il ne gère pas l''équipe');

  -- ---------------------------------------------------------------
  -- 5. Le gestionnaire d'agence : organiser sans tout voir
  -- ---------------------------------------------------------------
  perform _login(u_owner, ag, 'owner', o_tunis, null, array[]::uuid[]);
  set local role authenticated;
  perform apply_job_template(u_second, t_gestion);
  reset role;

  caps := member_capabilities(u_second);
  perform assert('settings:manage' = any (caps), 'le gestionnaire règle l''agence');
  perform assert('catalog:manage' = any (caps), 'et tient le catalogue');
  perform assert(not ('finance:global' = any (caps)), 'il ne voit pas la caisse globale');
  perform assert(not ('team:manage' = any (caps)) and not ('team:invite' = any (caps)),
                 'et il ne touche pas aux comptes : c''est le poste que le patron décrit');

  -- ---------------------------------------------------------------
  -- 6. Le coursier : un lecteur, plus une seule capacité
  -- ---------------------------------------------------------------
  perform _login(u_owner, ag, 'owner', o_tunis, null, array[]::uuid[]);
  set local role authenticated;
  perform apply_job_template(u_second, t_coursier);
  reset role;

  caps := member_capabilities(u_second);
  perform assert('doc:validate' = any (caps), 'le coursier constate ce qu''il rapporte');
  perform assert(array_length(caps, 1) = 2, 'et rien d''autre que ça et la lecture des dossiers');

  -- ---------------------------------------------------------------
  -- 7. Retirer le modèle : le rôle nu revient
  -- ---------------------------------------------------------------
  perform _login(u_owner, ag, 'owner', o_tunis, null, array[]::uuid[]);
  set local role authenticated;
  perform apply_job_template(u_agent, t_conseiller);
  reset role;

  select count(*) into n from member_permissions where user_id = u_agent;
  perform assert(n = 0, 'un poste sans écart efface les écarts : le rôle nu revient');
  caps := member_capabilities(u_agent);
  perform assert('payment:write' = any (caps) and 'doc:validate' = any (caps) and 'case:create' = any (caps),
                 'le conseiller retrouve tout ce que le rôle agent donne');

  -- ---------------------------------------------------------------
  -- 8. Ce qu'on ne peut pas faire
  -- ---------------------------------------------------------------
  -- Le propriétaire : lui changer de poste fermerait la porte à tout le monde.
  perform _login(u_owner, ag, 'owner', o_tunis, null, array[]::uuid[]);
  set local role authenticated;
  begin
    perform apply_job_template(u_owner, t_caisse);
    reset role;
    perform assert(false, 'on ne change pas le poste du propriétaire');
  exception when raise_exception then
    reset role;
    perform assert(true, 'on ne change pas le poste du propriétaire : ce serait fermer la porte au patron');
  end;

  -- Un agent ne s'applique pas un modèle : ce serait la porte dérobée.
  perform _login(u_agent, ag, 'agent', o_tunis);
  set local role authenticated;
  begin
    perform apply_job_template(u_agent, t_compta);
    reset role;
    perform assert(false, 'un agent ne se promeut pas lui-même par un modèle');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'un agent ne se promeut pas lui-même par un modèle : un raccourci de saisie n''est pas une porte');
  end;

  -- Ni ne fabrique le sien.
  set local role authenticated;
  begin
    perform save_job_template('mon_poste', '{"fr":"Mon poste"}'::jsonb, 'owner');
    reset role;
    perform assert(false, 'un agent n''écrit pas de modèle');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'un agent n''écrit pas de modèle');
  end;

  -- Une autre agence, jamais.
  perform _login(u_owner, ag, 'owner', o_tunis, null, array[]::uuid[]);
  set local role authenticated;
  begin
    perform apply_job_template(u_autre, t_caisse);
    reset role;
    perform assert(false, 'on ne change pas le poste de quelqu''un d''une autre agence');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'on ne change pas le poste de quelqu''un d''une autre agence');
  end;

  -- Un modèle qui cite une capacité inexistante est refusé à l'écriture.
  set local role authenticated;
  begin
    perform save_job_template('faux', '{"fr":"Faux"}'::jsonb, 'agent', array['tout:pouvoir']);
    reset role;
    perform assert(false, 'un modèle ne cite pas une capacité inventée');
  exception when raise_exception then
    reset role;
    perform assert(true, 'un modèle ne cite pas une capacité inventée : elle ne serait protégée par rien');
  end;

  -- ---------------------------------------------------------------
  -- 9. Une agence écrit son modèle, et elle est seule à le voir
  -- ---------------------------------------------------------------
  perform _login(u_owner, ag, 'owner', o_tunis, null, array[]::uuid[]);
  set local role authenticated;
  t_maison := save_job_template(
    'accueil', '{"fr":"Accueil","en":"Front desk"}'::jsonb, 'agent',
    array[]::text[], array['payment:write','shipment:write']);
  reset role;
  perform assert(t_maison is not null, 'une agence écrit son propre modèle');

  perform _login(u_autre, ag2, 'owner', o_autre, null, array[]::uuid[]);
  set local role authenticated;
  t_voisin := save_job_template('accueil', '{"fr":"Guichet"}'::jsonb, 'viewer');
  reset role;
  perform assert(t_voisin <> t_maison, 'deux agences peuvent porter le même code de poste, chacune le sien');

  perform _login(u_owner, ag, 'owner', o_tunis, null, array[]::uuid[]);
  set local role authenticated;
  select count(*) into n from job_templates_for_agency();
  reset role;
  perform assert(n = 10, 'une agence voit les neuf communs plus le sien, pas celui de la voisine');

  set local role authenticated;
  select count(*) into n from job_templates_for_agency() where id = t_voisin;
  reset role;
  perform assert(n = 0, 'le modèle de la voisine reste invisible : le cloisonnement tient');

  -- Et il ne s'applique pas non plus, même en connaissant son identifiant.
  set local role authenticated;
  begin
    perform apply_job_template(u_agent, t_voisin);
    reset role;
    perform assert(false, 'on n''applique pas le modèle d''une autre agence');
  exception when raise_exception then
    reset role;
    perform assert(true, 'on n''applique pas le modèle d''une autre agence, même en devinant son identifiant');
  end;

  -- Le modèle maison s'applique, lui.
  set local role authenticated;
  perform apply_job_template(u_agent, t_maison);
  reset role;
  caps := member_capabilities(u_agent);
  perform assert(not ('payment:write' = any (caps)) and not ('shipment:write' = any (caps)),
                 'le modèle maison retire ce qu''il annonce');

  -- ---------------------------------------------------------------
  -- 10. Les modèles communs appartiennent au produit
  -- ---------------------------------------------------------------
  set local role authenticated;
  begin
    update job_templates set base_role = 'owner' where id = t_caisse;
    if not found then raise exception 'aucune ligne touchée' using errcode = '42501'; end if;
    reset role;
    perform assert(false, 'une agence ne réécrit pas un modèle commun');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'une agence ne réécrit pas un modèle commun : elle le changerait pour tout le monde');
  end;

  -- ---------------------------------------------------------------
  -- 11. Un modèle ne répète pas ce que le rôle donne déjà
  -- ---------------------------------------------------------------
  -- Sans ce filtre, la liste des écarts d'une personne se remplirait de lignes
  -- qui ne changent rien, et l'écran ne saurait plus dire ce qui a été touché.
  perform _login(u_owner, ag, 'owner', o_tunis, null, array[]::uuid[]);
  set local role authenticated;
  t_maison := save_job_template(
    'redondant', '{"fr":"Redondant"}'::jsonb, 'agent',
    array['case:read'], array['finance:global']);
  perform apply_job_template(u_second, t_maison);
  reset role;
  select count(*) into n from member_permissions where user_id = u_second;
  perform assert(n = 0, 'un écart qui ne change rien ne s''écrit pas');

  -- Ménage.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  delete from agencies where id in (ag, ag2);
  delete from auth.users where id in (u_owner, u_agent, u_second, u_autre);
  raise notice '--- banc des postes : tout est vert ---';
end $$;

drop function _login(uuid, uuid, text, uuid, text[], uuid[]);
