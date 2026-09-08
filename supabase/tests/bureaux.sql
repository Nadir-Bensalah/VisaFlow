-- Banc d'essai des bureaux et des équipes (migration 0043).
--
-- Ce qu'on vérifie : une agence naît avec son premier bureau ; la plateforme
-- crée, modifie et ferme des bureaux ; elle déplace quelqu'un d'un bureau à
-- l'autre ; et le drapeau du mot de passe provisoire ne se lève que pour soi.
-- L'étanchéité des bureaux elle-même est couverte par isolation.sql : ici on
-- teste ce qui permet de s'en servir.

\set ON_ERROR_STOP on
set search_path = public;

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then raise notice 'OK    %', label;
  else raise exception 'ÉCHEC %', label; end if;
end $$;

do $$
declare
  v_admin uuid; v_ag uuid; v_ag2 uuid; v_off uuid; v_off2 uuid; n int;
  d jsonb; v_profile uuid; v_home uuid; v_other uuid;
begin
  -- Un super-admin de la plateforme, posé pour le banc.
  insert into auth.users (id) values (gen_random_uuid()) returning id into v_admin;
  insert into platform_admins (id, name, email) values (v_admin, 'Banc', 'banc@visaflow.test');
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  -- ---------------------------------------------------------------
  -- Créer une agence, c'est créer son premier bureau
  -- ---------------------------------------------------------------
  v_ag := platform_create_agency('Banc Bureaux', 'banc-bureaux', 'Libye', 'par_dossier', 8, 'Tripoli', '+218 91 000 0000');
  reset role;
  select count(*) into n from offices where agency_id = v_ag;
  perform assert(n = 1, 'une agence naît avec un bureau');
  select id into v_off from offices where agency_id = v_ag;
  perform assert((select name from offices where id = v_off) = 'Tripoli', 'nommé d''après la ville');
  perform assert((select country_code from offices where id = v_off) = 'LY', 'code pays LY');
  perform assert((select timezone from offices where id = v_off) = 'Africa/Tripoli', 'fuseau de Tripoli');
  perform assert((select phone from offices where id = v_off) = '+218 91 000 0000', 'le téléphone de l''agence devient celui du bureau');
  perform assert((select currency from agencies where id = v_ag) = 'LYD', 'devise LYD pour une agence libyenne');

  set local role authenticated;
  v_ag2 := platform_create_agency('Banc Sans Ville', 'banc-sans-ville');
  reset role;
  perform assert((select name from offices where agency_id = v_ag2) = 'Siège', 'sans ville, le bureau s''appelle Siège');
  perform assert((select timezone from offices where agency_id = v_ag2) = 'Africa/Tunis', 'fuseau de Tunis par défaut');

  -- ---------------------------------------------------------------
  -- Les bureaux depuis la console
  -- ---------------------------------------------------------------
  set local role authenticated;
  v_off2 := platform_save_office(v_ag, null, 'Benghazi', 'Benghazi', 'Libye', '+218 92 000 0000', 'Rue X');
  reset role;
  select count(*) into n from offices where agency_id = v_ag;
  perform assert(n = 2, 'un deuxième bureau');
  perform assert((select country_code from offices where id = v_off2) = 'LY', 'code pays déduit');

  set local role authenticated;
  perform platform_save_office(v_ag, v_off2, 'Benghazi Centre', 'Benghazi', 'Libye', null, null, true);
  reset role;
  perform assert((select name from offices where id = v_off2) = 'Benghazi Centre', 'renommé');

  -- Fermer, pas supprimer.
  set local role authenticated;
  perform platform_save_office(v_ag, v_off2, 'Benghazi Centre', 'Benghazi', 'Libye', null, null, false);
  d := platform_agency_detail(v_ag);
  reset role;
  perform assert(jsonb_array_length(d->'offices') = 2, 'le détail liste les deux bureaux');
  perform assert((select (o->>'active')::boolean from jsonb_array_elements(d->'offices') o where o->>'id' = v_off2::text) = false, 'le bureau fermé est marqué fermé');
  perform assert(jsonb_array_length(d->'team') = 0, 'aucune équipe encore');
  perform assert(d->'agency'->>'slug' = 'banc-bureaux', 'le détail porte l''agence');

  set local role authenticated;
  select offices into n from platform_agencies() where id = v_ag;
  reset role;
  perform assert(n = 1, 'platform_agencies ne compte que les bureaux actifs');

  -- Un bureau ne se modifie pas au nom d'une autre agence.
  set local role authenticated;
  perform platform_save_office(v_ag2, v_off2, 'Piraté', 'X', 'Tunisie', null, null, true);
  reset role;
  perform assert((select name from offices where id = v_off2) = 'Benghazi Centre', 'un bureau ne se modifie pas via une autre agence');

  -- ---------------------------------------------------------------
  -- Déplacer quelqu'un d'un bureau à l'autre
  -- ---------------------------------------------------------------
  -- Un agent du premier bureau, comme la fonction de bord l'aurait créé.
  insert into auth.users (id) values (gen_random_uuid()) returning id into v_profile;
  insert into profiles (id, agency_id, office_id, name, email, role, locale, active, must_reset_password)
  values (v_profile, v_ag, v_off, 'Agent Banc', 'agent@banc.test', 'agent', 'fr', true, true);
  v_home := v_off; v_other := v_off2;
  set local role authenticated;
  d := platform_agency_detail(v_ag);
  reset role;
  perform assert(jsonb_array_length(d->'team') = 1 and d->'team'->0->>'role' = 'agent', 'le détail montre l''équipe');
  perform assert((d->'team'->0->>'must_reset_password')::boolean, 'et signale le mot de passe provisoire');
  set local role authenticated;
  perform platform_set_member(v_profile, v_other, 'agent', true);
  reset role;
  perform assert((select office_id from profiles where id = v_profile) = v_other, 'l''agent est déplacé');
  set local role authenticated;
  perform platform_set_member(v_profile, v_home, 'agent', true);
  reset role;
  perform assert((select office_id from profiles where id = v_profile) = v_home, 'et ramené');

  -- ---------------------------------------------------------------
  -- Le drapeau du mot de passe provisoire ne se lève que pour soi
  -- ---------------------------------------------------------------
  update profiles set must_reset_password = true where id = v_profile;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  set local role authenticated;
  perform password_reset_done();
  reset role;
  perform assert((select must_reset_password from profiles where id = v_profile), 'un autre compte ne lève pas mon drapeau');
  perform set_config('request.jwt.claim.sub', v_profile::text, true);
  set local role authenticated;
  perform password_reset_done();
  reset role;
  perform assert(not (select must_reset_password from profiles where id = v_profile), 'je lève le mien');

  -- ---------------------------------------------------------------
  -- Rien de tout cela sans être la plateforme
  -- ---------------------------------------------------------------
  set local role authenticated;
  begin
    perform platform_save_office(v_ag, null, 'Intrus', 'X', 'Tunisie');
    reset role;
    perform assert(false, 'un simple compte ne crée pas de bureau');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'un simple compte ne crée pas de bureau');
  end;
  set local role authenticated;
  begin
    perform platform_agency_detail(v_ag);
    reset role;
    perform assert(false, 'ni ne lit le détail d''une agence');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'ni ne lit le détail d''une agence');
  end;
  set local role authenticated;
  begin
    perform platform_set_member(v_profile, v_other, 'owner', true);
    reset role;
    perform assert(false, 'ni ne se promeut propriétaire');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'ni ne se promeut propriétaire');
  end;

  -- L'e-mail d'une demande de souscription est obligatoire.
  begin
    insert into agency_signups (agency_name, contact_name, phone, email) values ('X', 'Y', '+216', null);
    perform assert(false, 'une demande sans e-mail est refusée');
  exception when not_null_violation then
    perform assert(true, 'une demande sans e-mail est refusée');
  end;

  -- Ménage.
  delete from agencies where id in (v_ag, v_ag2);
  delete from platform_admins where id = v_admin;
  delete from auth.users where id in (v_admin, v_profile);
end $$;
