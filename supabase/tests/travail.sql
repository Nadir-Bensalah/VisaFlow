-- Banc d'essai du mode d'organisation du travail (migration 0063).
--
-- CE QUE CE BANC PROTÈGE, DANS L'ORDRE D'IMPORTANCE.
--
-- 1. LE MODE NE DONNE ET NE RETIRE AUCUN DROIT. C'est la promesse du fichier.
--    On relève les capacités de chacun, on bascule l'agence de portefeuille à
--    file et retour, et on vérifie qu'aucune capacité n'a bougé. Le jour où
--    quelqu'un ajoutera un filtre par mode dans une politique, ce banc tombera.
--
-- 2. LE PÉRIMÈTRE PAR BUREAU. `my_worklist` est SECURITY DEFINER : elle
--    traverse les politiques. Un vérificateur de Sfax qui compterait les pièces
--    de Tunis rendrait un nombre, et un nombre ne montre pas d'où il vient. Les
--    chiffres du décor sont donc différents dans les deux bureaux, exprès.
--
-- 3. L'EXACTITUDE. Tous les chiffres affirmés ici sont comptés à la main dans
--    le commentaire qui les précède. Un compteur qui dérive après une
--    réécriture doit faire tomber le banc, pas s'arrondir.

\set ON_ERROR_STOP on
set search_path = public;

-- BANC REJOUABLE : on efface d'abord ce qu'un passage précédent aurait laissé.
delete from agencies where slug in ('travail', 'travail2');

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

-- Le compte d'un groupe de la file. Absent vaut zéro : un groupe à zéro ne sort
-- pas de la fonction, c'est sa règle.
create or replace function _wg(d jsonb, k text) returns bigint
language sql as $$
  select coalesce((select (x ->> 'compte')::bigint
                     from jsonb_array_elements(d -> 'groupes') x
                    where x ->> 'geste' = k), 0)
$$;

create or replace function _whas(d jsonb, k text) returns boolean
language sql as $$
  select exists (select 1 from jsonb_array_elements(d -> 'groupes') x where x ->> 'geste' = k)
$$;

-- Le même lecteur pour le tableau « À traiter » de la 0055, pour comparer les
-- deux fonctions sur le même chiffre.
create or replace function _pt(d jsonb, k text) returns bigint
language sql as $$
  select coalesce((select (i ->> 'count')::bigint
                     from jsonb_array_elements(d -> 'items') i
                    where i ->> 'key' = k), 0)
$$;

do $$
declare
  ag uuid; ag2 uuid; o_t uuid; o_s uuid; o_x uuid;
  u_own uuid; u_ahmed uuid; u_verif uuid; u_caisse uuid; u_sfax uuid; u_libre uuid; u_out uuid;
  cl_t uuid; cl_s uuid; vt uuid;
  c_t1 uuid; c_t2 uuid; c_s1 uuid;
  t_conseiller uuid; t_verif uuid; t_caisse uuid;
  d jsonb; w jsonb; r jsonb;
  caps_avant jsonb; caps_apres jsonb;
  n bigint; nn int; i int; t0 timestamptz; ms numeric;
begin
  -- =================================================================
  -- Le décor
  -- =================================================================
  insert into agencies (slug, name, services, country)
    values ('travail', 'Banc Travail', '{visas,fret}', 'Tunisie') returning id into ag;
  insert into agencies (slug, name, services, country)
    values ('travail2', 'Agence Voisine', '{visas}', 'Tunisie') returning id into ag2;

  insert into offices (agency_id, name, country, country_code)
    values (ag, 'Tunis', 'Tunisie', 'TN') returning id into o_t;
  insert into offices (agency_id, name, country, country_code)
    values (ag, 'Sfax', 'Tunisie', 'TN') returning id into o_s;
  insert into offices (agency_id, name, country, country_code)
    values (ag2, 'Ailleurs', 'Tunisie', 'TN') returning id into o_x;

  insert into auth.users (id) values (gen_random_uuid()) returning id into u_own;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_ahmed;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_verif;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_caisse;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_sfax;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_libre;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_out;

  insert into profiles (id, agency_id, office_id, name, email, role) values
    (u_own,    ag,  o_t, 'Slim',   'slim@travail.test',   'owner'),
    (u_ahmed,  ag,  o_t, 'Ahmed',  'ahmed@travail.test',  'agent'),
    (u_verif,  ag,  o_t, 'Amira',  'amira@travail.test',  'agent'),
    (u_caisse, ag,  o_t, 'Nizar',  'nizar@travail.test',  'agent'),
    (u_sfax,   ag,  o_s, 'Hatem',  'hatem@travail.test',  'agent'),
    (u_libre,  ag,  o_t, 'Sonia',  'sonia@travail.test',  'agent'),
    (u_out,    ag2, o_x, 'Rania',  'rania@travail2.test', 'owner');

  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (ag, o_t, 'Nour', 'Ben Ali', '+21620000101') returning id into cl_t;
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (ag, o_s, 'Yassine', 'Trabelsi', '+21620000102') returning id into cl_s;

  insert into visa_types (agency_id, country_code, country, label, category, processing_days)
    values (ag, 'FR', '{"fr":"France"}', '{"fr":"Tourisme"}', 'tourisme', 15)
    returning id into vt;

  -- Trois dossiers, et les chiffres qui en découlent, comptés à la main :
  --   T1 · Tunis, responsable Ahmed, ouvert, 2 pièces manquantes, solde 300.
  --   T2 · Tunis, responsable Slim,  ouvert, 1 pièce manquante,   soldé.
  --   S1 · Sfax,  responsable Slim,  ouvert, 5 pièces manquantes, soldé.
  -- Donc : pièces de Tunis = 3, pièces de Sfax = 5. Deux nombres différents,
  -- exprès : un filtre par bureau oublié se verrait tout de suite.
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, assignee_id,
                     stage, status, opened_at, updated_at, amount_total, amount_paid)
    values (ag, 'TRV-T1', cl_t, vt, o_t, u_ahmed, 'pieces', 'ouvert',
            now() - interval '3 days', now(), 500, 200) returning id into c_t1;
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, assignee_id,
                     stage, status, opened_at, updated_at, amount_total, amount_paid)
    values (ag, 'TRV-T2', cl_t, vt, o_t, u_own, 'pieces', 'ouvert',
            now() - interval '2 days', now(), 300, 300) returning id into c_t2;
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, assignee_id,
                     stage, status, opened_at, updated_at, amount_total, amount_paid)
    values (ag, 'TRV-S1', cl_s, vt, o_s, u_own, 'pieces', 'ouvert',
            now() - interval '2 days', now(), 200, 200) returning id into c_s1;

  insert into case_documents (agency_id, case_id, key, label, state, required)
    select ag, c_t1, 'p' || g, '{"fr":"Pièce"}', 'manquante', true from generate_series(1, 2) g;
  insert into case_documents (agency_id, case_id, key, label, state, required)
    select ag, c_t2, 'p' || g, '{"fr":"Pièce"}', 'demandee', true from generate_series(1, 1) g;
  insert into case_documents (agency_id, case_id, key, label, state, required)
    select ag, c_s1, 'p' || g, '{"fr":"Pièce"}', 'manquante', true from generate_series(1, 5) g;

  -- Un rendez-vous aujourd'hui sur T1 : c'est le rendez-vous d'Ahmed.
  insert into appointments (agency_id, case_id, office_id, kind, at, status)
    values (ag, c_t1, o_t, 'agence', now() + interval '2 hours', 'prevu');

  -- Un règlement échu sur T1. Avec le solde de T1, l'encaissement de Tunis
  -- vaut donc 2 : un règlement dû, plus un dossier au solde non nul.
  insert into payments (agency_id, case_id, office_id, label, amount, state, due_at)
    values (ag, c_t1, o_t, '{"fr":"Acompte"}', 300, 'du', current_date - 2);

  -- =================================================================
  -- 1. Les colonnes et les neuf postes
  -- =================================================================
  perform assert((select work_mode from agencies where id = ag) = 'portefeuille',
                 'une agence naît en portefeuille');

  select count(*) into nn from job_templates
   where agency_id is null and work_style in ('portefeuille','file');
  perform assert(nn = 9, 'les neuf postes livrés portent un style');

  perform assert((select work_style from job_templates where agency_id is null and code = 'conseiller') = 'portefeuille'
             and (select focus from job_templates where agency_id is null and code = 'conseiller') = '{}',
                 'le conseiller est en portefeuille, sans geste');
  perform assert((select work_style from job_templates where agency_id is null and code = 'proprietaire') = 'portefeuille',
                 'le propriétaire est en portefeuille');
  perform assert((select work_style from job_templates where agency_id is null and code = 'lecture') = 'portefeuille',
                 'la lecture seule est en portefeuille');
  perform assert((select focus from job_templates where agency_id is null and code = 'verification_pieces') = '{pieces}',
                 'le vérificateur est en file, sur les pièces');
  perform assert((select focus from job_templates where agency_id is null and code = 'caisse') = '{encaissement,factures}',
                 'le caissier est en file, sur l''argent');
  perform assert((select focus from job_templates where agency_id is null and code = 'creneaux') = '{creneaux,passeports}',
                 'le chargé de créneaux est en file, sur les rendez-vous et les passeports');
  perform assert((select focus from job_templates where agency_id is null and code = 'comptabilite') = '{factures,encaissement}',
                 'le comptable est en file, sur les factures');
  perform assert((select focus from job_templates where agency_id is null and code = 'coursier') = '{passeports}',
                 'le coursier est en file, sur les passeports');

  -- Le vocabulaire est clos. Un geste inventé ne serait compté nulle part.
  begin
    update job_templates set focus = '{bricolage}' where agency_id is null and code = 'conseiller';
    perform assert(false, 'un geste inconnu doit être refusé');
  exception when check_violation then
    perform assert(true, 'un geste inconnu est refusé à l''écriture');
  end;

  -- =================================================================
  -- 2. Les postes appliqués, et le style qui en découle
  -- =================================================================
  select id into t_conseiller from job_templates where agency_id is null and code = 'conseiller';
  select id into t_verif      from job_templates where agency_id is null and code = 'verification_pieces';
  select id into t_caisse     from job_templates where agency_id is null and code = 'caisse';

  perform _login(u_own, ag, 'owner', o_t);
  perform apply_job_template(u_ahmed,  t_conseiller);
  perform apply_job_template(u_verif,  t_verif);
  perform apply_job_template(u_caisse, t_caisse);
  perform apply_job_template(u_sfax,   t_verif);

  -- Sonia n'a aucun poste : un seul écart, qu'aucun modèle ne porte.
  insert into member_permissions (agency_id, user_id, permission, granted)
    values (ag, u_libre, 'message:send', false);

  w := member_work_style(u_ahmed);
  perform assert(w ->> 'style' = 'portefeuille' and w ->> 'poste' = 'conseiller',
                 'le style d''Ahmed se déduit de son poste de conseiller');
  w := member_work_style(u_verif);
  perform assert(w ->> 'style' = 'file' and w ->> 'poste' = 'verification_pieces',
                 'le style d''Amira se déduit de son poste de vérificatrice');
  perform assert(w -> 'focus' = '["pieces"]'::jsonb, 'le focus d''Amira vient de son poste');
  w := member_work_style(u_caisse);
  perform assert(w ->> 'style' = 'file' and (w -> 'focus') ? 'encaissement',
                 'le caissier est en file, sur l''encaissement');
  w := member_work_style(u_own);
  perform assert(w ->> 'style' = 'portefeuille' and w ->> 'poste' = 'proprietaire',
                 'le propriétaire retrouve son poste sans qu''on le lui applique');

  -- La personne sans poste retombe sur le mode de l'agence, et le suit.
  w := member_work_style(u_libre);
  perform assert(w ->> 'source' = 'agence' and w ->> 'poste' is null,
                 'Sonia n''a aucun poste : son style vient de l''agence');
  perform assert(w ->> 'style' = 'portefeuille', 'sans poste, en agence portefeuille : portefeuille');
  perform set_agency_work_mode('file');
  w := member_work_style(u_libre);
  perform assert(w ->> 'style' = 'file', 'sans poste, en agence file : file');
  w := member_work_style(u_ahmed);
  perform assert(w ->> 'style' = 'portefeuille',
                 'le mode de l''agence ne touche pas celui qui a un poste');
  perform set_agency_work_mode('portefeuille');

  -- Changer le poste change le style, sans qu'on écrive le style nulle part.
  perform apply_job_template(u_ahmed, t_verif);
  perform assert(member_work_style(u_ahmed) ->> 'style' = 'file',
                 'changer le poste change le style, tout seul');
  perform apply_job_template(u_ahmed, t_conseiller);
  perform assert(member_work_style(u_ahmed) ->> 'style' = 'portefeuille',
                 'et le retour au poste précédent ramène le style');

  -- =================================================================
  -- 3. En portefeuille : ses dossiers, et rien que les siens
  -- =================================================================
  perform _login(u_ahmed, ag, 'agent', o_t);
  w := my_work_style();
  perform assert(w ->> 'style' = 'portefeuille' and w ->> 'poste' = 'conseiller',
                 'my_work_style rend le style de la personne connectée');

  d := my_worklist();
  perform assert(d ->> 'style' = 'portefeuille', 'la file d''Ahmed est un portefeuille');
  perform assert(d ->> 'titre_cle' = 'pil.myCases', 'le titre du portefeuille est « mes dossiers »');
  -- T1 porte 2 pièces, et T1 est le seul dossier dont Ahmed est responsable.
  -- Tunis en compte 3 : s'il voyait 3, il verrait le dossier de Slim.
  perform assert(_wg(d, 'pieces') = 2, 'Ahmed voit les 2 pièces de SON dossier, pas les 3 de Tunis');
  perform assert(_wg(d, 'encaissement') = 1, 'Ahmed voit le seul solde impayé de son portefeuille');
  perform assert(_wg(d, 'creneaux') = 1, 'Ahmed voit son rendez-vous du jour');
  perform assert(_wg(d, 'passeports') = 0, 'aucun passeport détenu : le groupe ne sort pas');
  perform assert((d ->> 'total')::bigint = 4, 'le total du portefeuille d''Ahmed vaut 2 + 1 + 1');

  -- Slim est responsable de T2 (Tunis) et S1 (Sfax), et il voit les deux bureaux.
  perform _login(u_own, ag, 'owner', o_t);
  d := my_worklist();
  perform assert(d ->> 'style' = 'portefeuille', 'le propriétaire est en portefeuille');
  perform assert(_wg(d, 'pieces') = 6, 'Slim voit les 1 + 5 pièces de SES deux dossiers');
  perform assert(_wg(d, 'encaissement') = 0, 'ses deux dossiers sont soldés : pas de groupe argent');

  -- =================================================================
  -- 4. En file : le geste du poste, sur tous les dossiers du bureau
  -- =================================================================
  perform _login(u_verif, ag, 'agent', o_t);
  d := my_worklist();
  perform assert(d ->> 'style' = 'file', 'la vérificatrice est en file');
  perform assert(d ->> 'titre_cle' = 'pil.myQueue', 'le titre de la file est « ce qui attend mon geste »');
  perform assert(_wg(d, 'pieces') = 3, 'Amira voit les 3 pièces de TOUS les dossiers de Tunis');
  perform assert(not _whas(d, 'encaissement'), 'la vérificatrice ne voit pas l''encaissement');
  perform assert(not _whas(d, 'creneaux'), 'la vérificatrice ne voit pas les rendez-vous');
  perform assert((d ->> 'total')::bigint = 3, 'son total est celui de son seul geste');

  -- On ne recompte pas : le chiffre de la file est celui de dashboard_today.
  r := dashboard_today(null);
  perform assert(_wg(d, 'pieces') = _pt(r, 'docsMissing'),
                 'la file reprend le compteur de dashboard_today, elle ne le recalcule pas');

  -- Le cloisonnement par bureau. Hatem fait le MÊME métier, à Sfax.
  perform _login(u_sfax, ag, 'agent', o_s);
  d := my_worklist();
  perform assert(_wg(d, 'pieces') = 5, 'le vérificateur de Sfax voit les 5 pièces de Sfax');
  perform assert(_wg(d, 'pieces') <> 3, 'et il ne voit pas celles de Tunis');

  -- Le caissier de Tunis : l'argent, jamais les pièces.
  perform _login(u_caisse, ag, 'agent', o_t);
  d := my_worklist();
  perform assert(not _whas(d, 'pieces'), 'le caissier ne voit pas les pièces à vérifier');
  -- Un règlement échu, plus un dossier au solde non nul : 2.
  perform assert(_wg(d, 'encaissement') = 2, 'le caissier voit les 2 gestes d''argent de Tunis');

  -- L'agence voisine ne voit rien de tout ça.
  perform _login(u_out, ag2, 'owner', o_x);
  d := my_worklist();
  perform assert((d ->> 'total')::bigint = 0, 'l''agence voisine ne voit aucun de ces chiffres');

  -- =================================================================
  -- 5. Le mode ne touche AUCUN droit
  -- =================================================================
  select jsonb_object_agg(p.email, to_jsonb(member_capabilities(p.id))) into caps_avant
    from profiles p where p.agency_id = ag;

  perform _login(u_own, ag, 'owner', o_t);
  perform set_agency_work_mode('file');
  perform set_agency_work_mode('mixte');

  select jsonb_object_agg(p.email, to_jsonb(member_capabilities(p.id))) into caps_apres
    from profiles p where p.agency_id = ag;
  perform assert(caps_avant = caps_apres, 'changer le mode ne change AUCUN droit de personne');

  -- Et il ne change pas non plus ce que chacun voit.
  perform _login(u_sfax, ag, 'agent', o_s);
  perform assert(_wg(my_worklist(), 'pieces') = 5,
                 'en mixte, le vérificateur de Sfax voit toujours Sfax et rien d''autre');

  perform _login(u_own, ag, 'owner', o_t);
  perform set_agency_work_mode('portefeuille');

  -- =================================================================
  -- 6. Qui règle le mode, et ce que le réglage montre
  -- =================================================================
  perform _login(u_ahmed, ag, 'agent', o_t);
  begin
    perform set_agency_work_mode('file');
    perform assert(false, 'un agent ne doit pas pouvoir changer le mode');
  exception when insufficient_privilege then
    perform assert(true, 'un agent ne peut pas changer le mode');
  end;
  perform assert((select work_mode from agencies where id = ag) = 'portefeuille',
                 'et le mode n''a pas bougé');

  perform _login(u_own, ag, 'owner', o_t);
  begin
    perform set_agency_work_mode('brouillon');
    perform assert(false, 'un mode inconnu doit être refusé');
  exception when raise_exception then
    perform assert(true, 'un mode inconnu est refusé');
  end;

  select count(*) into n from activity_events
   where agency_id = ag and type = 'mode_travail_change';
  -- Cinq bascules réelles depuis le début du banc : portefeuille vers file,
  -- retour, puis file, mixte, retour. Les deux refus n'écrivent rien.
  perform assert(n = 5, 'chaque bascule laisse une ligne au journal, et un refus n''en laisse aucune');

  -- Six personnes actives : Slim et Ahmed en portefeuille, Amira, Nizar et
  -- Hatem en file, Sonia sans poste qui suit l'agence, donc en portefeuille.
  r := agency_work_mode();
  perform assert(r ->> 'mode' = 'portefeuille', 'le réglage rend le mode courant');
  perform assert((r ->> 'portefeuille')::int = 3, '3 personnes travaillent en portefeuille');
  perform assert((r ->> 'file')::int = 3, '3 personnes travaillent en file');
  perform assert((r ->> 'sans_poste')::int = 1, 'une personne n''a aucun poste');
  perform assert(jsonb_array_length(r -> 'membres') = 6, 'le réglage nomme les six personnes');
  perform assert((r ->> 'can_change')::boolean, 'le propriétaire peut changer le mode');

  perform _login(u_ahmed, ag, 'agent', o_t);
  perform assert(not (agency_work_mode() ->> 'can_change')::boolean,
                 'un agent lit le réglage sans pouvoir le changer');

  -- Les postes proposés en premier suivent le mode, sans jamais cacher
  -- les autres : un mélange se fait en descendant d'une ligne.
  perform _login(u_own, ag, 'owner', o_t);
  select count(*) into n from job_templates_ranked();
  perform assert(n = 9, 'tous les postes restent proposés');
  select count(*) into n from job_templates_ranked() where suggested;
  perform assert(n = 4, 'en portefeuille, 4 postes sont mis en avant');
  perform set_agency_work_mode('file');
  select count(*) into n from job_templates_ranked() where suggested;
  perform assert(n = 5, 'en file, ce sont les 5 autres');
  perform set_agency_work_mode('mixte');
  select count(*) into n from job_templates_ranked() where suggested;
  perform assert(n = 9, 'en mixte, tous sont mis en avant : c''est ce que mixte veut dire');
  perform set_agency_work_mode('portefeuille');

  -- =================================================================
  -- 7. Le temps que ça coûte
  -- =================================================================
  -- `my_worklist` s'appelle à chaque ouverture de l'application, par chaque
  -- employé. En file elle traverse `dashboard_today`, qui est la branche la
  -- plus chère : c'est celle qu'on mesure.
  perform _login(u_verif, ag, 'agent', o_t);
  t0 := clock_timestamp();
  for i in 1..20 loop perform my_worklist(); end loop;
  ms := extract(epoch from clock_timestamp() - t0) * 1000 / 20;
  raise notice 'MESURE my_worklist (file) : % ms par appel', round(ms, 1);
  perform assert(ms < 200, 'my_worklist tient sous 200 ms');

  perform _login(u_ahmed, ag, 'agent', o_t);
  t0 := clock_timestamp();
  for i in 1..20 loop perform my_worklist(); end loop;
  ms := extract(epoch from clock_timestamp() - t0) * 1000 / 20;
  raise notice 'MESURE my_worklist (portefeuille) : % ms par appel', round(ms, 1);
  perform assert(ms < 200, 'my_worklist en portefeuille tient sous 200 ms');

  -- Ménage.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  delete from agencies where id in (ag, ag2);
  delete from auth.users where id in (u_own, u_ahmed, u_verif, u_caisse, u_sfax, u_libre, u_out);
  raise notice '--- banc du mode de travail : tout est vert ---';
end $$;

-- Les aides du banc s'effacent avec lui. PostgreSQL accorde EXECUTE à PUBLIC
-- sur toute fonction nouvelle : une aide de banc laissée derrière est une
-- fonction ouverte à l'anonyme, et le banc des droits la compte. Même ménage
-- qu'en fin de pilotage.sql.
drop function if exists _login(uuid, uuid, text, uuid, text[], uuid[]);
drop function if exists _pt(jsonb, text);
drop function if exists _wg(jsonb, text);
drop function if exists _whas(jsonb, text);
