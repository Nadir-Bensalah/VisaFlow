-- Banc d'essai de l'organisation (migration 0044).
--
-- Ce banc protège la pièce la plus dangereuse du projet : `auth_can` et
-- `auth_sees_office` ont été réécrites, et cent quarante-huit politiques de
-- sécurité les appellent. Une erreur ici n'ouvre pas une porte, elle ouvre
-- toutes les portes. On vérifie donc les deux chemins : celui du jeton, rapide,
-- et celui du repli, qui lit les tables.

\set ON_ERROR_STOP on
set search_path = public;

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then raise notice 'OK    %', label;
  else raise exception 'ÉCHEC %', label; end if;
end $$;

-- Poser une identité, avec ou sans les nouvelles revendications.
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
  ag uuid; ag2 uuid; o_tunis uuid; o_sousse uuid; o_sfax uuid; o_autre uuid;
  u_owner uuid; u_dir uuid; u_agent uuid; u_autre uuid;
  n int; caps text[]; offs uuid[]; d jsonb; v_inv uuid;
begin
  -- ---------------------------------------------------------------
  -- Le décor : une agence, trois bureaux, quatre personnes
  -- ---------------------------------------------------------------
  insert into agencies (slug, name, services) values ('orga', 'Banc Organisation', '{visas,fret}') returning id into ag;
  insert into agencies (slug, name, services) values ('orga2', 'Agence Voisine', '{visas}') returning id into ag2;

  insert into offices (agency_id, name, country, country_code) values (ag, 'Tunis', 'Tunisie', 'TN') returning id into o_tunis;
  insert into offices (agency_id, name, country, country_code) values (ag, 'Sousse', 'Tunisie', 'TN') returning id into o_sousse;
  insert into offices (agency_id, name, country, country_code) values (ag, 'Sfax', 'Tunisie', 'TN') returning id into o_sfax;
  insert into offices (agency_id, name, country, country_code) values (ag2, 'Ailleurs', 'Tunisie', 'TN') returning id into o_autre;

  insert into auth.users (id) values (gen_random_uuid()) returning id into u_owner;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_dir;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_agent;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_autre;

  insert into profiles (id, agency_id, office_id, name, email, role) values
    (u_owner, ag,  o_tunis,  'Slim',  'slim@orga.test',  'owner'),
    (u_dir,   ag,  o_tunis,  'Amira', 'amira@orga.test', 'agent'),
    (u_agent, ag,  o_sfax,   'Hatem', 'hatem@orga.test', 'agent'),
    (u_autre, ag2, o_autre,  'Rania', 'rania@orga2.test','owner');

  -- ---------------------------------------------------------------
  -- 1. Le bureau principal devient une appartenance, tout seul
  -- ---------------------------------------------------------------
  select count(*) into n from office_members where user_id = u_agent and office_id = o_sfax and active;
  perform assert(n = 1, 'un profil créé entre dans son bureau principal');

  update profiles set office_id = o_sousse where id = u_dir;
  select count(*) into n from office_members where user_id = u_dir and office_id = o_sousse and active;
  perform assert(n = 1, 'changer de bureau principal ajoute l''appartenance');
  select count(*) into n from office_members where user_id = u_dir and active;
  perform assert(n = 2, 'et ne retire pas l''ancienne : l''historique du travail reste lisible');
  update profiles set office_id = o_tunis where id = u_dir;

  -- ---------------------------------------------------------------
  -- 2. Les capacités : le rôle, plus les écarts
  -- ---------------------------------------------------------------
  caps := member_capabilities(u_agent);
  perform assert('case:read' = any (caps), 'un agent lit les dossiers');
  perform assert(not ('finance:global' = any (caps)), 'un agent ne voit pas toute la caisse');
  perform assert('payment:write' = any (caps), 'mais il encaisse');

  caps := member_capabilities(u_owner);
  perform assert('data:reset' = any (caps), 'le propriétaire a tout');

  -- Un droit accordé en plus du rôle.
  insert into member_permissions (agency_id, user_id, permission, granted)
  values (ag, u_agent, 'reports:view', true);
  caps := member_capabilities(u_agent);
  perform assert('reports:view' = any (caps), 'un droit s''accorde à une personne précise');

  -- Un droit retiré malgré le rôle. C'est le sens de la sécurité : un refus
  -- explicite ne se contourne pas par un rôle généreux.
  insert into member_permissions (agency_id, user_id, permission, granted)
  values (ag, u_agent, 'payment:write', false);
  caps := member_capabilities(u_agent);
  perform assert(not ('payment:write' = any (caps)), 'un droit retiré prime sur le rôle');

  -- Les deux en même temps sur la même personne se comportent bien.
  perform assert('reports:view' = any (caps), 'l''ajout survit au retrait d''un autre droit');

  -- Un compte désactivé n'a plus rien, quel que soit son rôle.
  update profiles set active = false where id = u_agent;
  perform assert(coalesce(array_length(member_capabilities(u_agent), 1), 0) = 0, 'un compte désactivé n''a plus aucune capacité');
  update profiles set active = true where id = u_agent;

  -- ---------------------------------------------------------------
  -- 3. Les bureaux visibles
  -- ---------------------------------------------------------------
  offs := member_offices(u_owner);
  perform assert(coalesce(array_length(offs, 1), 0) = 0, 'la direction voit toute l''agence : la liste est vide, pas énumérée');

  offs := member_offices(u_agent);
  perform assert(array_length(offs, 1) = 1 and o_sfax = any (offs), 'un agent ne voit que son bureau');

  insert into office_members (agency_id, office_id, user_id, active) values (ag, o_sousse, u_agent, true);
  offs := member_offices(u_agent);
  perform assert(array_length(offs, 1) = 2, 'un agent peut couvrir deux bureaux : c''est le manque que le cahier des charges a relevé');

  -- ---------------------------------------------------------------
  -- 4. auth_can : le chemin du jeton et le chemin du repli
  -- ---------------------------------------------------------------
  -- Chemin rapide : le jeton porte les capacités.
  perform _login(u_agent, ag, 'agent', o_sfax, array['case:read','client:write'], array[o_sfax]);
  perform assert(auth_can('case:read'), 'auth_can lit le jeton');
  perform assert(not auth_can('finance:global'), 'et refuse ce qui n''y est pas');

  -- Chemin de repli : un jeton ancien, sans capacités. Sans ce repli, la
  -- migration aurait déconnecté tout le monde jusqu'au renouvellement.
  perform _login(u_agent, ag, 'agent', o_sfax);
  perform assert(auth_can('case:read'), 'sans capacités dans le jeton, auth_can lit les tables');
  perform assert(not auth_can('payment:write'), 'et le repli respecte les droits retirés');
  perform assert(auth_can('reports:view'), 'comme il respecte les droits accordés');

  -- ---------------------------------------------------------------
  -- 5. auth_sees_office : l'étanchéité entre bureaux
  -- ---------------------------------------------------------------
  perform _login(u_agent, ag, 'agent', o_sfax, null, array[o_sfax, o_sousse]);
  perform assert(auth_sees_office(o_sfax), 'l''agent voit son bureau');
  perform assert(auth_sees_office(o_sousse), 'et le bureau qu''on lui a ouvert');
  perform assert(not auth_sees_office(o_tunis), 'mais pas celui qu''on ne lui a pas ouvert');

  perform _login(u_owner, ag, 'owner', o_tunis, null, array[]::uuid[]);
  perform assert(auth_sees_office(o_sfax), 'la direction voit tous les bureaux');

  -- Repli sans revendication : l'appartenance en base fait foi.
  perform _login(u_agent, ag, 'agent', o_sfax);
  perform assert(auth_sees_office(o_sousse), 'le repli lit l''appartenance en base');
  perform assert(not auth_sees_office(o_tunis), 'et reste étanche');

  -- Une donnée sans bureau appartient à l'agence : la cacher viderait des
  -- écrans entiers pour un agent, sans protéger quoi que ce soit.
  perform assert(auth_sees_office(null), 'une donnée sans bureau reste visible');

  -- ---------------------------------------------------------------
  -- 6. Ce qu'on ne peut pas faire
  -- ---------------------------------------------------------------
  perform _login(u_owner, ag, 'owner', o_tunis, null, array[]::uuid[]);
  set local role authenticated;
  begin
    perform set_member_permission(u_owner, 'data:reset', false);
    reset role;
    perform assert(false, 'on ne retire pas un droit au propriétaire');
  exception when raise_exception then
    reset role;
    perform assert(true, 'on ne retire pas un droit au propriétaire : fermer la porte au patron ferme tout');
  end;

  set local role authenticated;
  begin
    perform set_member_permission(u_autre, 'case:read', false);
    reset role;
    perform assert(false, 'on ne touche pas aux droits d''une autre agence');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'on ne touche pas aux droits d''une autre agence');
  end;

  set local role authenticated;
  begin
    perform set_member_office(u_agent, o_autre, true);
    reset role;
    perform assert(false, 'on n''affecte personne au bureau d''une autre agence');
  exception when raise_exception then
    reset role;
    perform assert(true, 'on n''affecte personne au bureau d''une autre agence');
  end;

  set local role authenticated;
  begin
    perform set_member_office(u_agent, o_sfax, false);
    reset role;
    perform assert(false, 'le bureau principal ne se retire pas par cette porte');
  exception when raise_exception then
    reset role;
    perform assert(true, 'le bureau principal ne se retire pas par cette porte : la personne serait sans point d''attache');
  end;

  -- Un agent ne se donne pas de droits à lui-même.
  perform _login(u_agent, ag, 'agent', o_sfax);
  set local role authenticated;
  begin
    perform set_member_permission(u_agent, 'finance:global', true);
    reset role;
    perform assert(false, 'un agent ne se promeut pas lui-même');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'un agent ne se promeut pas lui-même');
  end;

  -- ---------------------------------------------------------------
  -- 7. Les invitations laissent une trace
  -- ---------------------------------------------------------------
  v_inv := invitation_record(ag, o_sousse, 'Nouveau@Orga.test', 'Nouveau', 'agent', null, u_owner);
  select count(*) into n from invitations where id = v_inv and email = 'nouveau@orga.test' and status = 'envoyee';
  perform assert(n = 1, 'une invitation se trace, l''adresse en minuscules');

  -- L'acceptation se déduit du changement de mot de passe, sans geste en plus.
  update invitations set user_id = u_agent where id = v_inv;
  update profiles set must_reset_password = true where id = u_agent;
  update profiles set must_reset_password = false where id = u_agent;
  select status into n from (select case when status = 'acceptee' then 1 else 0 end as status from invitations where id = v_inv) x;
  perform assert(n = 1, 'choisir son mot de passe marque l''invitation acceptée');

  -- ---------------------------------------------------------------
  -- 8. Ce que l'écran d'équipe reçoit
  -- ---------------------------------------------------------------
  perform _login(u_owner, ag, 'owner', o_tunis, null, array[]::uuid[]);
  set local role authenticated;
  d := team_overview();
  reset role;
  perform assert(jsonb_array_length(d->'members') = 3, 'l''écran d''équipe voit les trois membres de l''agence, pas ceux de la voisine');
  perform assert(jsonb_array_length(d->'permissions') >= 19, 'et le catalogue des capacités');
  perform assert((d->'roles'->'agent') is not null, 'et ce que chaque rôle donne');
  perform assert(jsonb_array_length(d->'invitations') = 1, 'et les invitations émises');

  -- Un agent n'a pas le droit d'ouvrir cet écran.
  perform _login(u_agent, ag, 'agent', o_sfax, array['case:read'], array[o_sfax]);
  set local role authenticated;
  begin
    d := team_overview();
    reset role;
    perform assert(false, 'un agent sans droit n''ouvre pas l''écran d''équipe');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'un agent sans droit n''ouvre pas l''écran d''équipe');
  end;

  -- ---------------------------------------------------------------
  -- 9. Le catalogue des capacités ne se réécrit pas
  -- ---------------------------------------------------------------
  perform _login(u_owner, ag, 'owner', o_tunis, null, array[]::uuid[]);
  set local role authenticated;
  begin
    insert into permissions (code, domain, label_fr, label_en, label_ar) values ('tout:pouvoir', 'x', 'x', 'x', 'x');
    reset role;
    perform assert(false, 'une agence n''invente pas une capacité');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'une agence n''invente pas une capacité : elle ne serait protégée par aucune politique');
  end;

  -- Ménage.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  delete from agencies where id in (ag, ag2);
  delete from auth.users where id in (u_owner, u_dir, u_agent, u_autre);
  raise notice '--- banc de l''organisation : tout est vert ---';
end $$;

drop function _login(uuid, uuid, text, uuid, text[], uuid[]);
