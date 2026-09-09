-- Banc d'essai des rôles de la plateforme et du journal (migration 0068).
--
-- Ce qu'on vérifie, dans l'ordre où ça casse en vrai :
--   · la grille des capacités est celle du contrat, ligne pour ligne ;
--   · un rôle sans la capacité est refusé avec le message que l'écran attend ;
--   · un admin désactivé n'est plus admin du tout, lectures comprises ;
--   · chaque geste laisse une ligne de journal, avec l'agence dans le détail ;
--   · l'équipe se gère sans pouvoir se saboter : ni soi-même, ni le dernier
--     superuser, ni un superuser par un non-superuser ;
--   · la fiche à 360 degrés et le poste de pilotage rendent la forme exacte
--     du contrat, y compris sur une base presque vide ;
--   · et rien de tout cela n'est ouvert à l'anonyme.
--
-- Rejouable : le prologue efface ce que le passage précédent a laissé.

\set ON_ERROR_STOP on
set search_path = public;

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then raise notice 'OK    %', label;
  else raise exception 'ÉCHEC %', label; end if;
end $$;

-- ---------------------------------------------------------------
-- Prologue : effacer le passage précédent
-- ---------------------------------------------------------------
delete from platform_support_log where agency_id in
  (select id from agencies where slug like 'banc-plateforme-%');
delete from platform_support_log where admin_id in
  (select id from auth.users where email like '%@banc-plateforme.test');
delete from agency_signups where email = 'demande@banc-plateforme.test';
delete from agencies where slug in ('banc-plateforme-a','banc-plateforme-b','banc-plateforme-c','banc-plateforme-d');
delete from platform_audit where admin_email like '%@banc-plateforme.test';
delete from platform_admins where email like '%@banc-plateforme.test';
delete from auth.users where email like '%@banc-plateforme.test';
delete from announcements where title ->> 'fr' = 'Banc plateforme';

-- Le jumeau local n'a pas pg_cron, donc pas la migration 0058 : on pose ici
-- `job_runs` et `run_job` à l'identique, pour pouvoir lancer une tâche.
do $$
begin
  if to_regclass('public.job_runs') is null then
    create table job_runs (
      id bigserial primary key, job text not null,
      started_at timestamptz not null default now(), ended_at timestamptz,
      ok boolean, affected int, detail text);
    alter table job_runs enable row level security;
    alter table job_runs force row level security;
    create policy job_runs_platform on job_runs for select to authenticated using (is_platform_admin());
    revoke all on job_runs from anon, authenticated;
    grant select on job_runs to authenticated;
    grant all on job_runs to service_role;
    grant usage, select on sequence job_runs_id_seq to service_role;
  end if;
  if to_regprocedure('public.run_job(text,text)') is null then
    create function run_job(p_job text, p_sql text) returns void
    language plpgsql security definer set search_path = public as $f$
    declare v_id bigint; v_n int := 0;
    begin
      insert into job_runs (job) values (p_job) returning id into v_id;
      begin
        execute p_sql;
        get diagnostics v_n = row_count;
        update job_runs set ended_at = now(), ok = true, affected = v_n where id = v_id;
      exception when others then
        update job_runs set ended_at = now(), ok = false, detail = left(sqlerrm, 500) where id = v_id;
      end;
    end $f$;
    revoke all on function run_job(text, text) from public, anon, authenticated;
  end if;
end $$;
delete from job_runs where job in ('banc_plateforme', 'menage_journal');

-- Se faire passer pour un compte, le temps d'un appel. Le rôle authenticated
-- est posé dans la même sous-transaction que l'appel : une exception le
-- défait, et `reset role` derrière ne coûte rien.
create or replace function pf_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role authenticated';
end $$;
revoke all on function pf_as(uuid) from public, anon;

do $$
declare
  v_su uuid; v_su2 uuid; v_adm uuid; v_op uuid; v_fac uuid; v_lec uuid; v_nobody uuid;
  v_ag uuid; v_ag2 uuid; v_ag3 uuid; v_agc uuid;
  v_off uuid; v_off2 uuid; v_member uuid; v_signup uuid; v_signup2 uuid;
  v_ticket uuid; v_feedback uuid; v_annonce uuid; v_msg uuid; v_paiement uuid;
  n int; ok boolean; j jsonb; u jsonb; c jsonb; t0 timestamptz; ms int; s text;
begin
  -- ---------------------------------------------------------------
  -- 1 · La grille des capacités est celle du contrat
  -- ---------------------------------------------------------------
  select count(*) into n from platform_permissions;
  perform assert(n = 13, 'treize capacités, comme PlatformCap');
  select count(*) into n from platform_role_permissions where role = 'superuser';
  perform assert(n = 13, 'le superuser a les treize');
  select count(*) into n from platform_role_permissions where role = 'admin';
  perform assert(n = 11, 'l''admin en a onze : tout sauf gérer l''équipe et supprimer');
  perform assert(not exists (select 1 from platform_role_permissions
                             where role = 'admin' and code in ('equipe.gerer','agences.supprimer')),
                 'l''admin ne gère pas l''équipe et ne supprime pas d''agence');
  select count(*) into n from platform_role_permissions where role = 'operateur';
  perform assert(n = 5, 'l''opérateur en a cinq');
  perform assert(exists (select 1 from platform_role_permissions where role = 'operateur' and code = 'agences.entrer')
                 and not exists (select 1 from platform_role_permissions where role = 'operateur' and code = 'agences.ouvrir'),
                 'l''opérateur entre dans une agence mais n''en ouvre pas');
  select count(*) into n from platform_role_permissions where role = 'facturation';
  perform assert(n = 3, 'la facturation en a trois');
  select count(*) into n from platform_role_permissions where role = 'lecture';
  perform assert(n = 0, 'la lecture n''en a aucune');

  -- ---------------------------------------------------------------
  -- 2 · L'équipe du banc, et la colonne superuser qui suit le rôle
  -- ---------------------------------------------------------------
  insert into auth.users (id, email) values (gen_random_uuid(), 'su@banc-plateforme.test') returning id into v_su;
  insert into auth.users (id, email) values (gen_random_uuid(), 'adm@banc-plateforme.test') returning id into v_adm;
  insert into auth.users (id, email) values (gen_random_uuid(), 'op@banc-plateforme.test') returning id into v_op;
  insert into auth.users (id, email) values (gen_random_uuid(), 'fac@banc-plateforme.test') returning id into v_fac;
  insert into auth.users (id, email) values (gen_random_uuid(), 'lec@banc-plateforme.test') returning id into v_lec;
  insert into auth.users (id, email) values (gen_random_uuid(), 'nobody@banc-plateforme.test') returning id into v_nobody;

  insert into platform_admins (id, name, email, role) values (v_su, 'Banc Super', 'su@banc-plateforme.test', 'superuser');
  perform assert((select superuser from platform_admins where id = v_su),
                 'écrire le rôle superuser pose la colonne superuser');

  -- L'ancienne écriture (fonction de bord d'avant 0068) doit encore marcher.
  insert into platform_admins (id, name, email, superuser) values (v_adm, 'Banc Admin', 'adm@banc-plateforme.test', true);
  perform assert((select role from platform_admins where id = v_adm) = 'superuser',
                 'écrire superuser = true pose le rôle superuser');
  update platform_admins set role = 'admin' where id = v_adm;
  perform assert((select superuser from platform_admins where id = v_adm) = false,
                 'changer le rôle remet la colonne superuser à jour');

  insert into platform_admins (id, name, email, role, invited_by) values (v_op, 'Banc Opérateur', 'op@banc-plateforme.test', 'operateur', v_su);
  insert into platform_admins (id, name, email, role) values (v_fac, 'Banc Facturation', 'fac@banc-plateforme.test', 'facturation');
  insert into platform_admins (id, name, email, role) values (v_lec, 'Banc Lecture', 'lec@banc-plateforme.test', 'lecture');

  begin
    insert into platform_admins (id, name, email, role) values (v_nobody, 'X', 'x@banc-plateforme.test', 'patron');
    ok := false;
  exception when check_violation then ok := true;
  end;
  perform assert(ok, 'un rôle hors liste est refusé par le schéma');

  -- ---------------------------------------------------------------
  -- 3 · Qui suis-je
  -- ---------------------------------------------------------------
  perform pf_as(v_su);
  j := platform_me();
  reset role;
  perform assert(j ->> 'role' = 'superuser' and (j ->> 'superuser')::boolean and (j ->> 'active')::boolean,
                 'platform_me rend le rôle du superuser');
  perform assert(jsonb_array_length(j -> 'caps') = 13, 'le superuser voit ses treize capacités');
  perform assert(j ? 'id' and j ? 'email' and j ? 'name' and j ? 'must_reset_password',
                 'platform_me porte toutes les clés de PlatformMe');

  perform pf_as(v_op);
  j := platform_me();
  reset role;
  perform assert(jsonb_array_length(j -> 'caps') = 5 and j -> 'caps' ? 'assistance.repondre',
                 'l''opérateur voit ses cinq capacités');

  perform pf_as(v_lec);
  j := platform_me();
  reset role;
  perform assert(jsonb_array_length(j -> 'caps') = 0, 'la lecture voit zéro capacité');

  perform pf_as(v_nobody);
  j := platform_me();
  reset role;
  perform assert(j is null, 'platform_me rend null à qui n''est pas de la plateforme');

  perform pf_as(v_su);
  perform assert(platform_can('equipe.gerer'), 'platform_can dit oui au superuser');
  reset role;
  perform pf_as(v_op);
  perform assert(platform_can('demandes.traiter') and not platform_can('agences.ouvrir'),
                 'platform_can suit la grille pour l''opérateur');
  reset role;

  -- ---------------------------------------------------------------
  -- 4 · La garde : capacité requise, avec le message exact
  -- ---------------------------------------------------------------
  begin
    perform pf_as(v_lec);
    perform platform_create_agency('Banc Lecture', 'banc-plateforme-x');
    ok := false;
  exception when others then
    ok := sqlstate = '42501' and sqlerrm = 'capacité requise : agences.ouvrir';
  end;
  reset role;
  perform assert(ok, 'la lecture ne crée pas d''agence, et l''erreur nomme la capacité');

  begin
    perform pf_as(v_nobody);
    perform platform_create_agency('Banc Personne', 'banc-plateforme-x');
    ok := false;
  exception when others then
    ok := sqlstate = '42501' and sqlerrm = 'réservé à la plateforme';
  end;
  reset role;
  perform assert(ok, 'un compte hors plateforme est refusé avant même la capacité');

  perform pf_as(v_lec);
  j := platform_overview();
  reset role;
  perform assert(j ? 'agencies_total', 'la lecture lit la vue d''ensemble');

  -- ---------------------------------------------------------------
  -- 5 · Ouvrir une agence laisse une trace
  -- ---------------------------------------------------------------
  perform pf_as(v_su);
  v_ag := platform_create_agency('Banc Plateforme A', 'banc-plateforme-a', 'Tunisie', 'par_dossier', 8, 'Tunis', '+21670000000');
  reset role;
  perform assert(v_ag is not null, 'le superuser ouvre une agence');

  select count(*) into n from platform_audit where action = 'agence.ouverte' and target_id = v_ag;
  perform assert(n = 1, 'l''ouverture entre au journal');
  perform assert((select target_label from platform_audit where action = 'agence.ouverte' and target_id = v_ag) = 'Banc Plateforme A',
                 'le journal porte le nom de l''agence');
  perform assert((select detail ->> 'agency_id' from platform_audit where action = 'agence.ouverte' and target_id = v_ag) = v_ag::text,
                 'le journal porte agency_id dans le détail');
  perform assert((select admin_email from platform_audit where action = 'agence.ouverte' and target_id = v_ag) = 'su@banc-plateforme.test'
                 and (select admin_name from platform_audit where action = 'agence.ouverte' and target_id = v_ag) = 'Banc Super',
                 'le journal recopie l''adresse et le nom de l''admin');

  perform pf_as(v_adm);
  v_ag2 := platform_create_agency('Banc Plateforme B', 'banc-plateforme-b', 'Libye', 'mensuel', 100, 'Tripoli');
  reset role;
  perform assert(v_ag2 is not null, 'l''admin ouvre aussi une agence');

  -- ---------------------------------------------------------------
  -- 6 · Suspendre, réactiver, supprimer : trois capacités
  -- ---------------------------------------------------------------
  begin
    perform pf_as(v_op);
    perform platform_set_agency_state(v_ag, 'suspendue');
    ok := false;
  exception when others then ok := sqlerrm = 'capacité requise : agences.suspendre';
  end;
  reset role;
  perform assert(ok, 'l''opérateur ne suspend pas');

  perform pf_as(v_adm);
  perform platform_set_agency_state(v_ag, 'suspendue');
  reset role;
  perform assert((select suspended_at from agencies where id = v_ag) is not null, 'l''admin suspend');
  perform assert(exists (select 1 from platform_audit where action = 'agence.suspendue' and target_id = v_ag),
                 'la suspension entre au journal');

  perform pf_as(v_adm);
  perform platform_set_agency_state(v_ag, 'active');
  reset role;
  perform assert(exists (select 1 from platform_audit where action = 'agence.reactivee' and target_id = v_ag),
                 'la réactivation entre au journal');

  begin
    perform pf_as(v_adm);
    perform platform_set_agency_state(v_ag, 'supprimee');
    ok := false;
  exception when others then ok := sqlerrm = 'capacité requise : agences.supprimer';
  end;
  reset role;
  perform assert(ok, 'l''admin ne supprime pas, même par l''ancien chemin');

  -- ---------------------------------------------------------------
  -- 7 · Les demandes
  -- ---------------------------------------------------------------
  insert into agency_signups (agency_name, contact_name, phone, email, country, city, received_at)
  values ('Banc Demande', 'Contact', '+21600000000', 'demande@banc-plateforme.test', 'Tunisie', 'Sfax', now() - interval '3 days')
  returning id into v_signup;
  insert into agency_signups (agency_name, contact_name, phone, email, country)
  values ('Banc Demande Deux', 'Contact', '+21600000001', 'demande@banc-plateforme.test', 'Tunisie')
  returning id into v_signup2;

  begin
    perform pf_as(v_fac);
    perform platform_signup_update(v_signup, 'devis_envoye', 4, 2160);
    ok := false;
  exception when others then ok := sqlerrm = 'capacité requise : demandes.traiter';
  end;
  reset role;
  perform assert(ok, 'la facturation ne traite pas les demandes');

  perform pf_as(v_op);
  perform platform_signup_update(v_signup, 'devis_envoye', 4, 2160);
  reset role;
  perform assert((select status from agency_signups where id = v_signup) = 'devis_envoye', 'l''opérateur qualifie une demande');
  perform assert(exists (select 1 from platform_audit where action = 'demande.mise_a_jour' and target_id = v_signup
                         and detail ->> 'status' = 'devis_envoye'),
                 'la mise à jour d''une demande entre au journal avec le statut');

  begin
    perform pf_as(v_op);
    perform platform_convert_signup(v_signup, 'banc-plateforme-c');
    ok := false;
  exception when others then ok := sqlerrm = 'capacité requise : agences.ouvrir';
  end;
  reset role;
  perform assert(ok, 'l''opérateur ne convertit pas : convertir, c''est ouvrir');

  perform pf_as(v_adm);
  v_agc := platform_convert_signup(v_signup, 'banc-plateforme-c');
  reset role;
  perform assert((select agency_id from agency_signups where id = v_signup) = v_agc, 'l''admin convertit la demande');
  perform assert(exists (select 1 from platform_audit where action = 'demande.convertie' and target_id = v_signup
                         and detail ->> 'agency_id' = v_agc::text),
                 'la conversion entre au journal, l''agence née dans le détail');
  perform assert(exists (select 1 from platform_audit where action = 'agence.ouverte' and target_id = v_agc),
                 'et l''ouverture de l''agence aussi');

  perform pf_as(v_op);
  perform platform_signup_link(v_signup2, v_ag2);
  reset role;
  perform assert((select status from agency_signups where id = v_signup2) = 'convertie'
                 and (select agency_id from agency_signups where id = v_signup2) = v_ag2,
                 'rattacher une demande à une agence existante la passe en convertie');
  perform assert(exists (select 1 from platform_audit where action = 'demande.convertie' and target_id = v_signup2
                         and (detail ->> 'rattachee')::boolean),
                 'le rattachement entre au journal');

  -- ---------------------------------------------------------------
  -- 8 · Abonnement, commission, règlements : la facturation
  -- ---------------------------------------------------------------
  begin
    perform pf_as(v_op);
    perform platform_set_commission(v_ag, 'mensuel', 50);
    ok := false;
  exception when others then ok := sqlerrm = 'capacité requise : abonnements.modifier';
  end;
  reset role;
  perform assert(ok, 'l''opérateur ne touche pas à la commission');

  perform pf_as(v_fac);
  perform platform_set_commission(v_ag, 'mensuel', 50);
  reset role;
  perform assert((select commission_kind from agencies where id = v_ag) = 'mensuel', 'la facturation change la commission');
  perform assert(exists (select 1 from platform_audit where action = 'commission.modifiee' and target_id = v_ag
                         and detail ->> 'kind_avant' = 'par_dossier'),
                 'la commission entre au journal avec l''ancienne valeur');

  perform pf_as(v_fac);
  j := platform_set_subscription(v_ag, 'pro', 3, current_date + 365, 'active');
  reset role;
  perform assert((select seats from subscriptions where agency_id = v_ag and status = 'active') = 3,
                 'la facturation pose un abonnement à trois sièges');
  perform assert(exists (select 1 from platform_audit where action = 'abonnement.modifie'
                         and detail ->> 'agency_id' = v_ag::text and (detail ->> 'sieges')::int = 3),
                 'l''abonnement entre au journal avec les sièges');

  begin
    perform pf_as(v_op);
    perform platform_record_payment(v_ag, 1620, 'TND', null, null, 'virement', 'BANC-001');
    ok := false;
  exception when others then ok := sqlerrm = 'capacité requise : facturation.encaisser';
  end;
  reset role;
  perform assert(ok, 'l''opérateur n''encaisse pas');

  perform pf_as(v_fac);
  j := platform_record_payment(v_ag, 1620, 'TND', null, null, 'virement', 'BANC-001');
  reset role;
  v_paiement := (j ->> 'paiement_id')::uuid;
  perform assert((j ->> 'ok')::boolean, 'la facturation encaisse');
  perform assert(exists (select 1 from platform_audit where action = 'reglement.enregistre' and target_id = v_paiement
                         and detail ->> 'agency_id' = v_ag::text and (detail ->> 'montant')::numeric = 1620),
                 'le règlement entre au journal avec son montant');

  perform pf_as(v_fac);
  n := platform_generate_invoices(date_trunc('month', now())::date);
  reset role;
  perform assert(n >= 1, 'la facturation génère les factures de commission');
  perform assert(exists (select 1 from platform_audit where action = 'factures.generees' and target_kind = 'plateforme'),
                 'la génération des factures entre au journal');

  -- Une agence suspendue pour impayé, rouverte sans encaisser.
  update subscriptions set billing_state = 'suspendue', suspended_on = current_date where agency_id = v_ag2;
  update agencies set suspended_at = now() where id = v_ag2;
  begin
    perform pf_as(v_op);
    perform platform_reactivate_agency(v_ag2, 'test');
    ok := false;
  exception when others then ok := sqlerrm = 'capacité requise : facturation.reactiver';
  end;
  reset role;
  perform assert(ok, 'l''opérateur ne rouvre pas une grâce');
  perform pf_as(v_fac);
  j := platform_reactivate_agency(v_ag2, 'virement annoncé');
  reset role;
  perform assert(j ->> 'etat' = 'grace', 'la facturation rouvre une grâce');
  perform assert(exists (select 1 from platform_audit where action = 'grace.rouverte' and target_id = v_ag2),
                 'la réouverture entre au journal');

  -- ---------------------------------------------------------------
  -- 9 · Entrer, modifier un bureau, un membre : l'opérateur
  -- ---------------------------------------------------------------
  begin
    perform pf_as(v_fac);
    perform platform_open_agency(v_ag);
    ok := false;
  exception when others then ok := sqlerrm = 'capacité requise : agences.entrer';
  end;
  reset role;
  perform assert(ok, 'la facturation n''entre pas dans une agence');

  perform pf_as(v_op);
  perform platform_open_agency(v_ag);
  reset role;
  perform assert(exists (select 1 from platform_support_log where admin_id = v_op and agency_id = v_ag),
                 'l''entrée en vue support garde sa trace d''origine');
  perform assert(exists (select 1 from platform_audit where action = 'agence.entree_support' and target_id = v_ag and admin_id = v_op),
                 'et entre aussi au journal de la plateforme');

  perform pf_as(v_op);
  v_off2 := platform_save_office(v_ag, null, 'Sousse', 'Sousse', 'Tunisie');
  reset role;
  perform assert(v_off2 is not null, 'l''opérateur crée un bureau');
  perform assert(exists (select 1 from platform_audit where action = 'bureau.enregistre' and target_id = v_off2
                         and detail ->> 'agency_id' = v_ag::text and (detail ->> 'cree')::boolean),
                 'le bureau entre au journal');

  select id into v_off from offices where agency_id = v_ag order by created_at limit 1;
  insert into auth.users (id, email) values (gen_random_uuid(), 'membre@banc-plateforme.test') returning id into v_member;
  insert into profiles (id, agency_id, office_id, name, email, role)
  values (v_member, v_ag, v_off, 'Banc Membre', 'membre@banc-plateforme.test', 'agent');

  -- Depuis 0069, la plateforme change aussi le rôle d'un membre : le garde
  -- de 0010 l'accepte pour un admin de plateforme, jamais pour soi-même.
  perform pf_as(v_op);
  perform platform_set_member(v_member, v_off2, 'manager', true);
  reset role;
  perform assert((select role from profiles where id = v_member) = 'manager',
                 'la plateforme change le rôle d''un membre (0069)');
  perform assert((select office_id from profiles where id = v_member) = v_off2,
                 'l''opérateur déplace un membre de bureau');
  perform assert(exists (select 1 from platform_audit where action = 'membre.modifie' and target_id = v_member
                         and detail ->> 'office_avant' = v_off::text and detail ->> 'office_id' = v_off2::text),
                 'le membre entre au journal avec l''avant et l''après');

  -- ---------------------------------------------------------------
  -- 10 · L'assistance et les annonces
  -- ---------------------------------------------------------------
  insert into support_tickets (agency_id, created_by, subject, message, priority)
  values (v_ag, v_member, 'Banc ticket', 'Rien ne marche', 'urgente') returning id into v_ticket;

  begin
    perform pf_as(v_lec);
    perform platform_ticket_reply(v_ticket, 'Je regarde.');
    ok := false;
  exception when others then ok := sqlerrm = 'capacité requise : assistance.repondre';
  end;
  reset role;
  perform assert(ok, 'la lecture ne répond pas aux tickets');

  perform pf_as(v_op);
  v_msg := platform_ticket_reply(v_ticket, 'Je regarde.');
  reset role;
  perform assert(v_msg is not null, 'l''opérateur répond à un ticket');
  perform assert(exists (select 1 from platform_audit where action = 'ticket.repondu' and target_id = v_ticket
                         and target_label = 'Banc Plateforme A' and detail ->> 'agency_id' = v_ag::text),
                 'la réponse entre au journal, au nom de l''agence');

  perform pf_as(v_op);
  perform platform_ticket_status(v_ticket, 'en_attente_client');
  reset role;
  perform assert(exists (select 1 from platform_audit where action = 'ticket.statut' and target_id = v_ticket
                         and detail ->> 'statut' = 'en_attente_client'),
                 'le changement de statut entre au journal');

  insert into feedback (agency_id, user_id, kind, message) values (v_ag, v_member, 'idee', 'Banc retour')
  returning id into v_feedback;
  perform pf_as(v_op);
  perform platform_feedback_handle(v_feedback, 'lu', 'Merci.');
  reset role;
  perform assert(exists (select 1 from platform_audit where action = 'retour.traite' and target_id = v_feedback),
                 'le retour traité entre au journal');

  begin
    perform pf_as(v_fac);
    v_annonce := platform_save_announcement(null, 'nouveaute', '{"fr":"Banc plateforme"}', '{}', 'info', now(), null, 'toutes', null);
    ok := false;
  exception when others then ok := sqlerrm = 'capacité requise : annonces.publier';
  end;
  reset role;
  perform assert(ok, 'la facturation ne rédige pas d''annonce');

  perform pf_as(v_op);
  v_annonce := platform_save_announcement(null, 'nouveaute', '{"fr":"Banc plateforme"}', '{}', 'info', now(), null, 'toutes', null);
  perform platform_publish_announcement(v_annonce, true);
  reset role;
  perform assert((select published_at from announcements where id = v_annonce) is not null, 'l''opérateur publie une annonce');
  perform assert(exists (select 1 from platform_audit where action = 'annonce.enregistree' and target_id = v_annonce)
                 and exists (select 1 from platform_audit where action = 'annonce.publiee' and target_id = v_annonce),
                 'la rédaction et la publication entrent au journal');

  -- ---------------------------------------------------------------
  -- 11 · Le journal se lit, se filtre, ne se modifie pas
  -- ---------------------------------------------------------------
  perform pf_as(v_lec);
  j := platform_audit_list(1000, null, null, null);
  reset role;
  perform assert(jsonb_array_length(j) >= 20, 'la lecture lit le journal entier');
  perform assert((j -> 0) ? 'id' and (j -> 0) ? 'at' and (j -> 0) ? 'admin_id' and (j -> 0) ? 'admin_email'
                 and (j -> 0) ? 'admin_name' and (j -> 0) ? 'action' and (j -> 0) ? 'target_kind'
                 and (j -> 0) ? 'target_id' and (j -> 0) ? 'target_label' and (j -> 0) ? 'detail',
                 'chaque ligne porte les dix clés d''AuditRow');
  perform assert((j -> 0 ->> 'at')::timestamptz >= (j -> 1 ->> 'at')::timestamptz,
                 'les plus récents d''abord');

  perform pf_as(v_lec);
  j := platform_audit_list(100, 'agence.ouverte', null, null);
  reset role;
  -- D'autres bancs ouvrent aussi des agences : on ne compte que les nôtres.
  perform assert((select bool_and(e ->> 'action' = 'agence.ouverte') from jsonb_array_elements(j) e)
                 and (select count(*) from jsonb_array_elements(j) e
                       where e ->> 'admin_email' like '%@banc-plateforme.test') = 3,
                 'le filtre par action ne rend que cette action');

  perform pf_as(v_lec);
  j := platform_audit_list(100, null, v_ag, null);
  reset role;
  perform assert(jsonb_array_length(j) >= 8, 'le filtre par agence rassemble ses lignes');
  perform assert((select bool_and(e ->> 'target_id' = v_ag::text or e -> 'detail' ->> 'agency_id' = v_ag::text)
                  from jsonb_array_elements(j) e),
                 'y compris celles où l''agence n''est que dans le détail');
  perform assert(exists (select 1 from jsonb_array_elements(j) e where e ->> 'action' = 'reglement.enregistre'),
                 'le règlement de l''agence est dans sa liste');

  perform pf_as(v_lec);
  j := platform_audit_list(100, null, null, v_op);
  reset role;
  perform assert((select bool_and(e ->> 'admin_id' = v_op::text) from jsonb_array_elements(j) e)
                 and jsonb_array_length(j) >= 5,
                 'le filtre par admin ne rend que ses gestes');

  perform pf_as(v_lec);
  j := platform_audit_list(2, null, null, null);
  reset role;
  perform assert(jsonb_array_length(j) = 2, 'la limite est respectée');

  begin
    perform pf_as(v_su);
    update platform_audit set action = 'x' where admin_id = v_su;
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  perform assert(ok, 'même le superuser ne réécrit pas le journal');

  begin
    perform pf_as(v_su);
    delete from platform_audit where admin_id = v_su;
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  perform assert(ok, 'ni ne l''efface');

  begin
    perform pf_as(v_nobody);
    perform platform_log('agence.ouverte', 'agence', v_ag, 'faux', '{}');
    ok := false;
  exception when others then ok := sqlstate = '42501';
  end;
  reset role;
  perform assert(ok, 'un compte hors plateforme n''écrit pas dans le journal');

  perform pf_as(v_nobody);
  select count(*) into n from platform_audit;
  reset role;
  perform assert(n = 0, 'un compte hors plateforme ne lit pas le journal');

  -- ---------------------------------------------------------------
  -- 12 · L'équipe : liste, rôles, mise à l'écart
  -- ---------------------------------------------------------------
  perform pf_as(v_lec);
  j := platform_admins_list();
  reset role;
  perform assert(jsonb_array_length(j) >= 5, 'la liste de l''équipe se lit');
  select e into u from jsonb_array_elements(j) e where e ->> 'id' = v_op::text;
  perform assert(u ->> 'invited_by_email' = 'su@banc-plateforme.test', 'la liste dit qui a invité qui');
  perform assert((u ->> 'actions_30j')::int >= 5, 'la liste compte les gestes des trente derniers jours');
  perform assert(u ? 'name' and u ? 'email' and u ? 'role' and u ? 'active' and u ? 'created_at'
                 and u ? 'last_seen_at' and u ? 'must_reset_password',
                 'chaque ligne porte les clés d''AdminRow');

  begin
    perform pf_as(v_adm);
    perform platform_admin_set_role(v_lec, 'operateur');
    ok := false;
  exception when others then ok := sqlerrm = 'capacité requise : equipe.gerer';
  end;
  reset role;
  perform assert(ok, 'l''admin ne change pas les rôles');

  begin
    perform pf_as(v_su);
    perform platform_admin_set_role(v_su, 'admin');
    ok := false;
  exception when others then ok := sqlstate = '42501';
  end;
  reset role;
  perform assert(ok, 'on ne change pas son propre rôle');

  begin
    perform pf_as(v_su);
    perform platform_admin_set_role(v_lec, 'patron');
    ok := false;
  exception when others then ok := sqlstate = 'P0001';
  end;
  reset role;
  perform assert(ok, 'un rôle inconnu est refusé');

  perform pf_as(v_su);
  perform platform_admin_set_role(v_lec, 'operateur');
  reset role;
  perform assert((select role from platform_admins where id = v_lec) = 'operateur', 'le superuser change un rôle');
  perform assert(exists (select 1 from platform_audit where action = 'admin.role' and target_id = v_lec
                         and detail ->> 'role_avant' = 'lecture' and detail ->> 'role' = 'operateur'),
                 'le changement de rôle entre au journal');
  perform pf_as(v_su);
  perform platform_admin_set_role(v_lec, 'lecture');
  reset role;

  -- Un second superuser, promu par le premier.
  perform pf_as(v_su);
  perform platform_admin_set_role(v_adm, 'superuser');
  reset role;
  perform assert((select superuser from platform_admins where id = v_adm), 'promouvoir en superuser pose la colonne');
  v_su2 := v_adm;

  -- Il rétrograde le premier : il en reste un, c'est permis.
  perform pf_as(v_su2);
  perform platform_admin_set_role(v_su, 'admin');
  reset role;
  perform assert((select role from platform_admins where id = v_su) = 'admin', 'un superuser peut en rétrograder un autre');

  begin
    perform pf_as(v_su);
    perform platform_admin_set_role(v_lec, 'admin');
    ok := false;
  exception when others then ok := sqlerrm = 'capacité requise : equipe.gerer';
  end;
  reset role;
  perform assert(ok, 'rétrogradé, il ne gère plus l''équipe');

  perform pf_as(v_su2);
  perform platform_admin_set_role(v_su, 'superuser');
  reset role;

  begin
    perform pf_as(v_su2);
    perform platform_admin_set_active(v_su2, false);
    ok := false;
  exception when others then ok := sqlstate = '42501';
  end;
  reset role;
  perform assert(ok, 'on ne se désactive pas soi-même');

  perform pf_as(v_su2);
  perform platform_admin_set_active(v_lec, false);
  reset role;
  perform assert((select active from platform_admins where id = v_lec) = false, 'un admin se désactive');
  perform assert(exists (select 1 from platform_audit where action = 'admin.actif' and target_id = v_lec
                         and (detail ->> 'actif')::boolean = false),
                 'la désactivation entre au journal');

  -- Désactivé, il n'est plus admin du tout.
  perform pf_as(v_lec);
  perform assert(not is_platform_admin(), 'un admin désactivé n''est plus admin');
  j := platform_me();
  reset role;
  perform assert(j is not null and (j ->> 'active')::boolean = false and jsonb_array_length(j -> 'caps') = 0,
                 'platform_me le dit : inactif, zéro capacité');
  begin
    perform pf_as(v_lec);
    j := platform_overview();
    ok := false;
  exception when others then ok := sqlstate = '42501';
  end;
  reset role;
  perform assert(ok, 'désactivé, même les lectures lui sont fermées');
  begin
    perform pf_as(v_lec);
    j := platform_audit_list(10, null, null, null);
    ok := false;
  exception when others then ok := sqlstate = '42501';
  end;
  reset role;
  perform assert(ok, 'le journal aussi');

  perform pf_as(v_su2);
  perform platform_admin_set_active(v_lec, true);
  reset role;
  perform assert((select active from platform_admins where id = v_lec), 'et il se réactive');

  begin
    perform pf_as(v_su);
    perform platform_admin_remove(v_su);
    ok := false;
  exception when others then ok := sqlstate = '42501';
  end;
  reset role;
  perform assert(ok, 'on ne se retire pas soi-même');

  perform pf_as(v_su);
  perform platform_admin_remove(v_su2);
  reset role;
  perform assert(not exists (select 1 from platform_admins where id = v_su2), 'le superuser retire un autre superuser');
  perform assert(exists (select 1 from auth.users where id = v_su2), 'le compte de connexion, lui, reste');
  perform assert(exists (select 1 from platform_audit where action = 'admin.retire' and target_id = v_su2
                         and target_label = 'adm@banc-plateforme.test'),
                 'le retrait entre au journal, avec l''adresse de qui est parti');

  -- L'écriture directe suit la même capacité.
  begin
    perform pf_as(v_lec);
    update platform_admins set role = 'superuser' where id = v_lec;
    get diagnostics n = row_count;
    ok := n = 0;
  exception when others then ok := true;
  end;
  reset role;
  perform assert(ok, 'la lecture ne se promeut pas par une écriture directe');
  perform assert((select role from platform_admins where id = v_lec) = 'lecture', 'et son rôle n''a pas bougé');

  perform pf_as(v_su);
  update platform_admins set superuser = true where id = v_op;
  reset role;
  perform assert((select role from platform_admins where id = v_op) = 'superuser',
                 'le superuser écrit en direct, et la colonne superuser entraîne le rôle');
  perform pf_as(v_su);
  update platform_admins set superuser = false where id = v_op;
  reset role;
  perform assert((select role from platform_admins where id = v_op) = 'admin',
                 'retirer la colonne superuser en direct redescend en admin');
  update platform_admins set role = 'operateur' where id = v_op;

  -- Le mot de passe provisoire.
  update platform_admins set must_reset_password = true where id = v_op;
  perform pf_as(v_op);
  perform platform_admin_password_reset_done();
  j := platform_me();
  reset role;
  perform assert((j ->> 'must_reset_password')::boolean = false, 'le drapeau du mot de passe provisoire se lève');

  -- ---------------------------------------------------------------
  -- 13 · Une tâche lancée à la main
  -- ---------------------------------------------------------------
  begin
    perform pf_as(v_lec);
    j := platform_run_job('visaflow_menage_journal');
    ok := false;
  exception when others then ok := sqlerrm = 'capacité requise : taches.lancer';
  end;
  reset role;
  perform assert(ok, 'la lecture ne lance pas de tâche');

  begin
    perform pf_as(v_su);
    j := platform_run_job('visaflow_inconnue');
    ok := false;
  exception when others then ok := sqlstate = 'P0002';
  end;
  reset role;
  perform assert(ok, 'une tâche inconnue est refusée');

  begin
    perform pf_as(v_su);
    j := platform_run_job('drop table agencies');
    ok := false;
  exception when others then ok := sqlstate = 'P0002';
  end;
  reset role;
  perform assert(ok, 'seul un nom visaflow_* passe');

  perform pf_as(v_su);
  j := platform_run_job('visaflow_menage_journal');
  reset role;
  perform assert((j ->> 'ok')::boolean and j ? 'affected' and j ? 'detail' and (j ->> 'ms')::int >= 0,
                 'lancer le ménage du journal rend ok, affected, detail, ms');
  perform assert(exists (select 1 from job_runs where job = 'menage_journal' and job_runs.ok), 'la tâche a laissé son passage dans job_runs');
  perform assert(exists (select 1 from platform_audit where action = 'tache.lancee' and target_label = 'visaflow_menage_journal'),
                 'le lancement entre au journal');

  -- ---------------------------------------------------------------
  -- 14 · Supprimer une agence : le nom exact, et un marquage
  -- ---------------------------------------------------------------
  begin
    perform pf_as(v_op);
    perform platform_delete_agency(v_agc, 'Banc Demande');
    ok := false;
  exception when others then ok := sqlerrm = 'capacité requise : agences.supprimer';
  end;
  reset role;
  perform assert(ok, 'l''opérateur ne supprime pas d''agence');

  begin
    perform pf_as(v_su);
    perform platform_delete_agency(v_agc, 'Banc Demandé');
    ok := false;
  exception when others then ok := sqlerrm = 'le nom ne correspond pas';
  end;
  reset role;
  perform assert(ok, 'un nom qui ne correspond pas refuse, avec le message attendu');
  perform assert((select deleted_at from agencies where id = v_agc) is null, 'et l''agence est intacte');

  perform pf_as(v_su);
  perform platform_delete_agency(v_agc, 'Banc Demande');
  reset role;
  perform assert((select deleted_at from agencies where id = v_agc) is not null
                 and (select suspended_at from agencies where id = v_agc) is not null,
                 'le nom exact supprime : marquage, et suspension');
  perform assert(exists (select 1 from agencies where id = v_agc), 'la ligne existe toujours, rien n''est effacé');
  perform assert(not exists (select 1 from subscriptions where agency_id = v_agc and status <> 'resiliee'),
                 'l''abonnement vivant est résilié');
  perform assert(exists (select 1 from platform_audit where action = 'agence.supprimee' and target_id = v_agc),
                 'la suppression entre au journal');

  -- ---------------------------------------------------------------
  -- 15 · Une agence à 360 degrés
  -- ---------------------------------------------------------------
  insert into activity_events (agency_id, type, detail) values (v_ag, 'banc', '{}');
  insert into user_sessions (user_id, agency_id, device_label) values (v_member, v_ag, 'banc');

  perform pf_as(v_lec);
  j := platform_agency_360(v_ag);
  reset role;
  perform assert(j ? 'agence' and j ? 'acces' and j ? 'abonnement' and j ? 'bureaux' and j ? 'membres'
                 and j ? 'compteurs' and j ? 'reglements' and j ? 'tickets' and j ? 'journal' and j ? 'activite_30j',
                 'la fiche porte les dix blocs d''Agence360');
  perform assert(j -> 'agence' ->> 'name' = 'Banc Plateforme A' and j -> 'agence' ->> 'commission_kind' = 'mensuel'
                 and (j -> 'agence') ? 'work_mode' and (j -> 'agence') ? 'deleted_at',
                 'le bloc agence est celui du contrat');
  perform assert(j -> 'acces' ->> 'etat' = 'a_jour' and (j -> 'acces') ? 'coupee' and (j -> 'acces') ? 'bloquant'
                 and (j -> 'acces') ? 'trial_ends_on' and (j -> 'acces') ? 'grace_ends_on' and (j -> 'acces') ? 'renewal_on',
                 'le bloc accès dit à jour, avec ses sept clés');
  perform assert(j -> 'abonnement' ->> 'plan_code' = 'pro' and (j -> 'abonnement' ->> 'seats')::int = 3
                 and (j -> 'abonnement' ->> 'mensuel')::numeric = 3 * 45,
                 'l''abonnement dit son plan et ce qu''il vaut par mois');
  perform assert(jsonb_array_length(j -> 'bureaux') = 2, 'les deux bureaux sont là');
  perform assert((select (b ->> 'members')::int from jsonb_array_elements(j -> 'bureaux') b where b ->> 'id' = v_off2::text) = 1,
                 'le bureau compte son membre');
  perform assert(jsonb_array_length(j -> 'membres') = 1 and j -> 'membres' -> 0 ->> 'office_name' = 'Sousse'
                 and (j -> 'membres' -> 0) ? 'last_sign_in_at',
                 'le membre est là, avec son bureau et sa dernière connexion');
  perform assert((j -> 'compteurs' ->> 'connexions_7j')::int = 1 and (j -> 'compteurs') ? 'storage_bytes'
                 and (j -> 'compteurs') ? 'documents' and (j -> 'compteurs') ? 'shipments_open',
                 'les compteurs comptent la connexion de la semaine');
  perform assert(jsonb_array_length(j -> 'reglements') = 1 and j -> 'reglements' -> 0 ->> 'recorded_by_email' = 'fac@banc-plateforme.test'
                 and (j -> 'reglements' -> 0) ? 'paid_on',
                 'le règlement est là, avec qui l''a saisi');
  perform assert(jsonb_array_length(j -> 'tickets') = 1 and j -> 'tickets' -> 0 ->> 'status' = 'en_attente_client',
                 'le ticket en attente du client est là');
  perform assert(jsonb_array_length(j -> 'journal') >= 8 and jsonb_array_length(j -> 'journal') <= 15,
                 'le journal de l''agence est là, quinze lignes au plus');
  perform assert(jsonb_array_length(j -> 'activite_30j') = 30
                 and (j -> 'activite_30j' -> 29 ->> 'n')::int = 1
                 and j -> 'activite_30j' -> 29 ->> 'day' = to_char(current_date, 'YYYY-MM-DD'),
                 'l''activité fait trente points, le dernier est aujourd''hui');

  -- Une agence sans abonnement (les comptes d'avant 0049) ne fait pas planter la fiche.
  delete from subscriptions where agency_id = v_ag2;
  perform pf_as(v_lec);
  j := platform_agency_360(v_ag2);
  reset role;
  perform assert(j -> 'abonnement' ->> 'id' is null and (j -> 'abonnement') ? 'mensuel'
                 and j -> 'acces' ->> 'etat' = 'a_jour',
                 'sans abonnement, la fiche rend des nuls, pas une erreur');

  begin
    perform pf_as(v_lec);
    j := platform_agency_360(gen_random_uuid());
    ok := false;
  exception when others then ok := sqlstate = 'P0002';
  end;
  reset role;
  perform assert(ok, 'une agence inconnue est une erreur claire');

  -- ---------------------------------------------------------------
  -- 16 · Le poste de pilotage
  -- ---------------------------------------------------------------
  -- De quoi remplir chaque urgence : un ticket urgent (déjà là), une demande
  -- vieille de trois jours, une agence suspendue, une grâce, un essai qui
  -- finit, une tâche échouée, une agence payante silencieuse.
  update agency_signups set status = 'nouvelle', agency_id = null where id = v_signup;
  update support_tickets set status = 'ouvert' where id = v_ticket;
  perform pf_as(v_su);
  perform platform_set_agency_state(v_ag2, 'suspendue');
  v_ag3 := platform_create_agency('Banc Plateforme D', 'banc-plateforme-d');
  reset role;
  update subscriptions set trial_ends_on = current_date + 2 where agency_id = v_ag3;
  update subscriptions set billing_state = 'grace', grace_ends_on = current_date + 4 where agency_id = v_ag;
  update agencies set plan = 'standard', created_at = now() - interval '40 days' where id = v_ag;
  delete from activity_events where agency_id = v_ag;
  insert into job_runs (job, ended_at, ok, detail) values ('banc_plateforme', now(), false, 'boum');
  insert into subscription_payments (agency_id, subscription_id, amount, currency, period_start, period_end,
                                     recorded_by, recorded_at)
  select v_ag, id, 500, 'TND', current_date - 90, current_date - 1, v_fac, now() - interval '3 months'
    from subscriptions where agency_id = v_ag;

  perform pf_as(v_lec);
  t0 := clock_timestamp();
  c := platform_cockpit();
  ms := (extract(epoch from clock_timestamp() - t0) * 1000)::int;
  reset role;
  raise notice 'cockpit en % ms', ms;
  perform assert(ms < 1500, 'le poste de pilotage répond vite (' || ms || ' ms)');
  perform assert(c ? 'generated_at' and c ? 'kpis' and c ? 'urgents' and c ? 'series' and c ? 'activite'
                 and c ? 'taches' and c ? 'sante',
                 'le cockpit porte les sept blocs du contrat');

  j := c -> 'kpis';
  perform assert((select count(*) from jsonb_object_keys(j)) = 19, 'dix-neuf indicateurs, comme le contrat');
  perform assert((j ->> 'mrr')::numeric = (select coalesce(sum(seats * price_per_user_month), 0) from subscriptions where status = 'active')
                 and (j ->> 'mrr')::numeric >= 135,
                 'le MRR est la somme des sièges × prix des abonnements actifs');
  perform assert((j ->> 'arr')::numeric = (j ->> 'mrr')::numeric * 12, 'l''ARR est douze fois le MRR');
  perform assert((j ->> 'mrr_potentiel')::numeric >= 45, 'les essais valent quelque chose s''ils signent');
  perform assert((j ->> 'agences_suspendues')::int >= 1 and (j ->> 'graces')::int >= 1
                 and (j ->> 'essais_finissant_7j')::int >= 1 and (j ->> 'demandes_nouvelles')::int >= 1
                 and (j ->> 'tickets_urgents')::int >= 1,
                 'les compteurs d''alerte voient ce qu''on a posé');
  perform assert((j ->> 'encaisse_mois')::numeric >= 1620 and (j ->> 'encaisse_30j')::numeric >= 1620
                 and (j ->> 'encaisse_30j')::numeric < (j ->> 'encaisse_mois')::numeric + 500,
                 'l''encaissé du mois et des trente jours excluent le règlement d''il y a trois mois');
  perform assert((j ->> 'connexions_24h')::int >= 1, 'la connexion du membre compte dans les 24 h');
  perform assert(not exists (select 1 from jsonb_each(j) e where e.value = 'null'::jsonb),
                 'aucun indicateur n''est nul');

  j := c -> 'urgents';
  perform assert(jsonb_array_length(j) >= 7, 'les urgences sont là');
  perform assert((select bool_and(e ? 'kind' and e ? 'severity' and e ? 'id' and e ? 'agency_id' and e ? 'agency_name'
                                  and e ? 'agency_slug' and e ? 'title' and e ? 'detail' and e ? 'since' and e ? 'days' and e ? 'url')
                  from jsonb_array_elements(j) e),
                 'chaque urgence porte les onze clés d''Urgent');
  perform assert(j -> 0 ->> 'severity' = 'critique', 'les critiques d''abord');
  perform assert((select string_agg(e ->> 'severity', ',') from jsonb_array_elements(j) e)
                 ~ '^(critique,)*(attention,)*(info,?)*$',
                 'critique, puis attention, puis info');
  select e into u from jsonb_array_elements(j) e where e ->> 'kind' = 'demande' and e ->> 'id' = v_signup::text;
  perform assert(u ->> 'severity' = 'attention' and (u ->> 'days')::int = 3 and u ->> 'url' = '/admin/demandes?id=' || v_signup,
                 'une demande de trois jours est une attention, avec son lien');
  select e into u from jsonb_array_elements(j) e where e ->> 'kind' = 'ticket' and e ->> 'id' = v_ticket::text;
  perform assert(u ->> 'severity' = 'critique' and u ->> 'agency_id' = v_ag::text and u ->> 'url' = '/admin/assistance?ticket=' || v_ticket,
                 'un ticket urgent est critique, rattaché à son agence');
  select e into u from jsonb_array_elements(j) e where e ->> 'kind' = 'suspendue' and e ->> 'agency_id' = v_ag2::text;
  perform assert(u ->> 'severity' = 'critique' and u ->> 'url' = '/admin/agences/' || v_ag2,
                 'une agence suspendue est critique');
  select e into u from jsonb_array_elements(j) e where e ->> 'kind' = 'grace' and e ->> 'agency_id' = v_ag::text;
  perform assert(u ->> 'severity' = 'attention' and (u ->> 'days')::int = 4 and u ->> 'url' = '/admin/facturation?agence=' || v_ag,
                 'une grâce dit ses jours restants');
  select e into u from jsonb_array_elements(j) e where e ->> 'kind' = 'essai_fin' and e ->> 'agency_id' = v_ag3::text;
  perform assert(u ->> 'severity' = 'attention' and (u ->> 'days')::int = 2, 'un essai qui finit dans deux jours dit deux');
  select e into u from jsonb_array_elements(j) e where e ->> 'kind' = 'tache_echouee' and e ->> 'title' = 'banc_plateforme';
  perform assert(u ->> 'severity' = 'critique' and u ->> 'detail' = 'boum' and u ->> 'url' = '/admin/taches'
                 and u -> 'agency_id' = 'null'::jsonb and u -> 'days' = 'null'::jsonb,
                 'une tâche échouée est critique, sans agence ni jours');
  select e into u from jsonb_array_elements(j) e where e ->> 'kind' = 'agence_inactive' and e ->> 'agency_id' = v_ag::text;
  perform assert(u ->> 'severity' = 'info' and (u ->> 'days')::int >= 14, 'une agence payante silencieuse est une information');

  j := c -> 'series';
  perform assert(jsonb_array_length(j -> 'signups_30j') = 30 and jsonb_array_length(j -> 'connexions_14j') = 14
                 and jsonb_array_length(j -> 'dossiers_30j') = 30,
                 'les séries par jour ont leurs trente et quatorze points');
  perform assert(jsonb_array_length(j -> 'encaisse_12m') = 12 and jsonb_array_length(j -> 'mrr_12m') = 12
                 and jsonb_array_length(j -> 'agences_12m') = 12,
                 'les séries par mois ont douze points');
  perform assert(j -> 'encaisse_12m' -> 11 ->> 'month' = to_char(now(), 'YYYY-MM')
                 and (j -> 'encaisse_12m' -> 11 ->> 'amount')::numeric >= 1620
                 and (j -> 'encaisse_12m' -> 8 ->> 'amount')::numeric >= 500,
                 'l''encaissé mensuel place chaque règlement dans son mois');
  perform assert((j -> 'mrr_12m' -> 11 ->> 'amount')::numeric >= 135, 'le MRR du mois courant compte l''abonnement actif');
  perform assert((j -> 'signups_30j' -> 26 ->> 'n')::int >= 1 and j -> 'signups_30j' -> 26 ->> 'day' = to_char(current_date - 3, 'YYYY-MM-DD'),
                 'la demande d''il y a trois jours est sur son jour');
  perform assert((j -> 'connexions_14j' -> 13 ->> 'n')::int >= 1, 'la connexion du jour est sur la série');
  perform assert((j -> 'agences_12m' -> 11 ->> 'n')::int >= 3, 'les agences du mois sont comptées');

  perform assert(jsonb_array_length(c -> 'activite') = 20 and (c -> 'activite' -> 0) ? 'admin_email',
                 'l''activité rend les vingt derniers gestes, en AuditRow');
  perform assert(jsonb_typeof(c -> 'taches') = 'array', 'les tâches sont un tableau, vide sans pg_cron');
  perform assert((c -> 'sante' ->> 'taches_en_echec')::int >= 1 and (c -> 'sante') ? 'courriels_echoues_24h'
                 and (c -> 'sante') ? 'webhooks_echoues_24h' and (c -> 'sante') ? 'whatsapp_en_attente',
                 'la santé voit la tâche échouée et porte ses quatre clés');

  begin
    perform pf_as(v_nobody);
    c := platform_cockpit();
    ok := false;
  exception when others then ok := sqlstate = '42501';
  end;
  reset role;
  perform assert(ok, 'le cockpit est fermé à qui n''est pas de la plateforme');

  -- ---------------------------------------------------------------
  -- 17 · Rien n'est ouvert à l'anonyme
  -- ---------------------------------------------------------------
  perform assert(not has_function_privilege('anon', 'platform_cockpit()', 'execute')
                 and not has_function_privilege('anon', 'platform_agency_360(uuid)', 'execute')
                 and not has_function_privilege('anon', 'platform_run_job(text)', 'execute')
                 and not has_function_privilege('anon', 'platform_delete_agency(uuid,text)', 'execute')
                 and not has_function_privilege('anon', 'platform_log(text,text,uuid,text,jsonb)', 'execute')
                 and not has_function_privilege('anon', 'platform_me()', 'execute'),
                 'aucune fonction de 0068 n''est ouverte à l''anonyme');
  perform assert(not has_function_privilege('authenticated', 'platform_admin_guard(uuid,boolean)', 'execute')
                 and not has_function_privilege('authenticated', 'platform_admins_sync_role()', 'execute'),
                 'les fonctions internes ne sont pas appelables directement');
  perform assert(not has_table_privilege('authenticated', 'platform_audit', 'update')
                 and not has_table_privilege('authenticated', 'platform_audit', 'delete')
                 and not has_table_privilege('authenticated', 'platform_role_permissions', 'insert')
                 and not has_table_privilege('authenticated', 'platform_permissions', 'update'),
                 'le journal est en ajout seul, la grille en lecture seule');

  -- ---------------------------------------------------------------
  -- Épilogue : tout ce que le banc a posé s'en va. Les autres bancs
  -- comptent des tickets et des annonces sur toute la base : une agence
  -- laissée ici fausserait leur compte.
  -- ---------------------------------------------------------------
  delete from platform_support_log where admin_id in (v_su, v_su2, v_adm, v_op, v_fac, v_lec)
     or agency_id in (v_ag, v_ag2, v_ag3, v_agc);
  delete from agency_signups where id in (v_signup, v_signup2);
  delete from agencies where id in (v_ag, v_ag2, v_ag3, v_agc);
  delete from announcements where id = v_annonce;
  delete from platform_audit where admin_email like '%@banc-plateforme.test';
  delete from platform_admins where email like '%@banc-plateforme.test';
  delete from auth.users where email like '%@banc-plateforme.test';
  delete from job_runs where job in ('banc_plateforme', 'menage_journal');

  raise notice '--- banc de la plateforme : tout est vert ---';
end $$;

drop function if exists pf_as(uuid);
