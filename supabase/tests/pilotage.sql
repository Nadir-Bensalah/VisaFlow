-- Banc d'essai du pilotage (migration 0055).
--
-- Ce banc protège deux choses, et la première compte plus que la seconde.
--
-- 1. L'ÉTANCHÉITÉ. Toutes les fonctions de ce module sont SECURITY DEFINER :
--    elles traversent les politiques de sécurité. Un filtre par bureau oublié
--    ne se voit pas, parce que le résultat est un nombre et qu'un nombre ne
--    montre pas d'où il vient. On vérifie donc, indicateur par indicateur,
--    qu'un agent de Sfax lit Sfax, que le propriétaire lit les deux bureaux, et
--    qu'une agence voisine ne lit rien du tout.
--
-- 2. L'EXACTITUDE. Le décor pose des dates choisies, et le banc affirme des
--    chiffres calculés à la main dans le commentaire. Une moyenne de délai qui
--    dérive de deux dixièmes après une réécriture doit faire tomber le banc.

\set ON_ERROR_STOP on
set search_path = public;

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

-- Lire un compteur du tableau « À traiter ». Absent vaut zéro : une entrée à
-- zéro ne sort pas de la fonction, c'est sa règle.
create or replace function _pt(d jsonb, k text) returns bigint
language sql as $$
  select coalesce((select (i ->> 'count')::bigint
                     from jsonb_array_elements(d -> 'items') i
                    where i ->> 'key' = k), 0)
$$;

do $$
declare
  ag uuid; ag2 uuid; o_t uuid; o_s uuid; o_x uuid;
  u_own uuid; u_ag uuid; u_out uuid;
  cl_t uuid; cl_s uuid; vt uuid; co uuid;
  c_t1 uuid; c_t2 uuid; c_t3 uuid; c_s1 uuid; c_s2 uuid;
  s_t1 uuid; s_s1 uuid;
  d jsonb; r jsonb; n bigint; nn int; num numeric; txt text;
  caps_own text[] := array['case:read','case:write','reports:view','finance:global',
                           'settings:manage','payment:write','team:manage'];
  -- L'agent reçoit `reports:view` par un écart au rôle, exactement comme le
  -- permet la migration 0044. Il n'a PAS `finance:global` : c'est ce qui rend
  -- le test des montants intéressant.
  caps_ag  text[] := array['case:read','case:write','reports:view','payment:write'];
begin
  -- =================================================================
  -- Le décor : une agence, deux bureaux, deux personnes, une voisine
  -- =================================================================
  insert into agencies (slug, name, services, country)
    values ('pilotage', 'Banc Pilotage', '{visas,fret}', 'Tunisie') returning id into ag;
  insert into agencies (slug, name, services, country)
    values ('pilotage2', 'Agence Voisine', '{visas}', 'Tunisie') returning id into ag2;

  insert into offices (agency_id, name, country, country_code)
    values (ag, 'Tunis', 'Tunisie', 'TN') returning id into o_t;
  insert into offices (agency_id, name, country, country_code)
    values (ag, 'Sfax', 'Tunisie', 'TN') returning id into o_s;
  insert into offices (agency_id, name, country, country_code)
    values (ag2, 'Ailleurs', 'Tunisie', 'TN') returning id into o_x;

  insert into auth.users (id) values (gen_random_uuid()) returning id into u_own;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_ag;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_out;

  insert into profiles (id, agency_id, office_id, name, email, role) values
    (u_own, ag,  o_t, 'Slim',  'slim@pilotage.test',  'owner'),
    (u_ag,  ag,  o_s, 'Hatem', 'hatem@pilotage.test', 'agent'),
    (u_out, ag2, o_x, 'Rania', 'rania@pilotage2.test','owner');
  insert into member_permissions (agency_id, user_id, permission, granted)
    values (ag, u_ag, 'reports:view', true);

  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (ag, o_t, 'Nour', 'Ben Ali', '+21620000001') returning id into cl_t;
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (ag, o_s, 'Yassine', 'Trabelsi', '+21620000002') returning id into cl_s;

  insert into visa_types (agency_id, country_code, country, label, category, processing_days)
    values (ag, 'FR', '{"fr":"France"}', '{"fr":"Tourisme"}', 'tourisme', 15)
    returning id into vt;
  insert into consulates (agency_id, country_code, country, city, centre,
                          ref_year, ref_refusal_rate)
    values (ag, 'FR', '{"fr":"France"}', 'Tunis', 'tls_tunis', 2024, 20.0)
    returning id into co;

  -- Les dossiers, avec des dates choisies. Les délais qui en découlent sont
  -- écrits en commentaire, et le banc les affirme plus bas.
  --   c_t2 : ouvert il y a 20 j, décidé il y a 10 j  -> 10 jours
  --   c_t3 : ouvert il y a 40 j, décidé il y a 20 j  -> 20 jours
  --   c_s2 : ouvert il y a 15 j, décidé il y a  9 j  ->  6 jours
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, assignee_id,
                     stage, status, opened_at, updated_at, due_at, amount_total, amount_paid)
    values (ag, 'PIL-T1', cl_t, vt, o_t, u_own, 'pieces', 'ouvert',
            now() - interval '30 days', now(), current_date - 3, 500, 200)
    returning id into c_t1;

  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, assignee_id,
                     consulate_id, stage, status, opened_at, updated_at, decision_at,
                     amount_total, amount_paid)
    values (ag, 'PIL-T2', cl_t, vt, o_t, u_own, co, 'decision', 'accepte',
            now() - interval '20 days', now() - interval '10 days', now() - interval '10 days',
            400, 400)
    returning id into c_t2;

  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, assignee_id,
                     consulate_id, stage, status, opened_at, updated_at, decision_at,
                     closed_at, refusal_code, amount_total, amount_paid)
    values (ag, 'PIL-T3', cl_t, vt, o_t, u_own, co, 'clos', 'refuse',
            now() - interval '40 days', now() - interval '18 days', now() - interval '20 days',
            now() - interval '18 days', 'moyens_insuffisants', 300, 300)
    returning id into c_t3;

  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, assignee_id,
                     stage, status, opened_at, updated_at, amount_total, amount_paid)
    values (ag, 'PIL-S1', cl_s, vt, o_s, u_ag, 'pieces', 'ouvert',
            now() - interval '10 days', now() - interval '10 days', 300, 0)
    returning id into c_s1;

  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, assignee_id,
                     consulate_id, stage, status, opened_at, updated_at, decision_at,
                     amount_total, amount_paid)
    values (ag, 'PIL-S2', cl_s, vt, o_s, u_ag, co, 'decision', 'accepte',
            now() - interval '15 days', now() - interval '9 days', now() - interval '9 days',
            200, 100)
    returning id into c_s2;

  -- Les pièces. Deux manquantes à Tunis, une à Sfax, une reçue non validée.
  insert into case_documents (agency_id, case_id, key, label, state, required, requested_at)
    values (ag, c_t1, 'passeport', '{"fr":"Passeport"}', 'manquante', true, null),
           (ag, c_t1, 'photo', '{"fr":"Photo"}', 'demandee', true, now() - interval '10 days'),
           (ag, c_s1, 'passeport', '{"fr":"Passeport"}', 'manquante', true, null),
           (ag, c_t2, 'assurance', '{"fr":"Assurance"}', 'recue', true, now() - interval '5 days');
  update case_documents set received_at = now() - interval '3 days'
   where case_id = c_t2 and key = 'assurance';

  -- Les tâches en retard : une par bureau.
  insert into tasks (agency_id, case_id, assignee_id, title, due_at, done)
    values (ag, c_t1, u_own, '{"fr":"Relancer le client"}', now() - interval '2 days', false),
           (ag, c_s1, u_ag,  '{"fr":"Appeler le client"}',  now() - interval '1 day',  false);

  -- L'argent : 200 encaissés à Tunis, 300 à Sfax, 300 dus à Tunis depuis 5 j.
  insert into payments (agency_id, case_id, client_id, office_id, kind, label, amount, state, at, collected_by)
    values (ag, c_t1, cl_t, o_t, 'honoraires', '{"fr":"Acompte"}', 200, 'regle', now() - interval '1 day', u_own),
           (ag, c_s1, cl_s, o_s, 'honoraires', '{"fr":"Acompte"}', 300, 'regle', now() - interval '1 day', u_ag);
  insert into payments (agency_id, case_id, client_id, office_id, kind, label, amount, state, due_at)
    values (ag, c_t1, cl_t, o_t, 'honoraires', '{"fr":"Solde"}', 300, 'du', current_date - 5);

  -- Un rendez-vous à Tunis aujourd'hui.
  insert into appointments (agency_id, case_id, office_id, kind, at, status)
    values (ag, c_t1, o_t, 'agence', date_trunc('day', now()) + interval '10 hours', 'prevu');

  -- Les cargaisons : une qui arrive aujourd'hui à Tunis, une en douane à Sfax.
  insert into shipments (agency_id, reference, office_id, mode, goods, status, stage,
                         country_from, country_to, etd, eta, created_at, containers_count)
    values (ag, 'PIL-C1', o_t, 'maritime_fcl', '{"fr":"Textile"}', 'en_cours', 'transit',
            'CN', 'TN', current_date - 20, current_date, now() - interval '5 days', 2)
    returning id into s_t1;
  insert into shipments (agency_id, reference, office_id, mode, goods, status, stage,
                         country_from, country_to, etd, eta, arrived_at, created_at)
    values (ag, 'PIL-C2', o_s, 'maritime_lcl', '{"fr":"Pièces"}', 'en_cours', 'douane',
            'IT', 'TN', current_date - 15, current_date + 3, now() - interval '2 days',
            now() - interval '12 days')
    returning id into s_s1;

  -- Les passeports détenus : un à Tunis depuis 70 jours, un à Sfax non réglé.
  insert into passport_custody (agency_id, client_id, case_id, passport_number, received_at)
    values (ag, cl_t, c_t2, 'T123456', now() - interval '70 days'),
           (ag, cl_s, c_s2, 'S654321', now() - interval '5 days');

  -- =================================================================
  -- 1. Le tableau « À traiter » : l'agent ne voit que son bureau
  -- =================================================================
  perform _login(u_ag, ag, 'agent', o_s, caps_ag, array[o_s]);
  d := dashboard_today();

  perform assert(_pt(d, 'docsMissing') = 1,
    'À traiter : un agent de Sfax compte 1 pièce manquante, pas les 2 de Tunis');
  perform assert(_pt(d, 'staleCases') = 1,
    'À traiter : le dossier de Sfax sans activité depuis 10 jours ressort');
  perform assert(_pt(d, 'decisionsUntreated') = 1,
    'À traiter : une décision tombée non clôturée à Sfax');
  perform assert(_pt(d, 'tasksOverdue') = 1, 'À traiter : une tâche en retard à Sfax');
  perform assert(_pt(d, 'apptsToday') = 0,
    'À traiter : le rendez-vous de Tunis n''apparaît pas chez l''agent de Sfax');
  perform assert(_pt(d, 'arrivalsToday') = 0,
    'À traiter : l''arrivée de Tunis n''apparaît pas chez l''agent de Sfax');
  perform assert(_pt(d, 'inCustoms') = 1, 'À traiter : la cargaison de Sfax est en douane');
  perform assert(_pt(d, 'passportsReady') = 1, 'À traiter : un passeport à rendre à Sfax');
  perform assert(_pt(d, 'passportsUnpaid') = 1,
    'À traiter : le passeport de Sfax est retenu faute du solde');
  perform assert(_pt(d, 'passportsHeld') = 0,
    'À traiter : le passeport détenu depuis 70 jours est à Tunis, pas à Sfax');
  perform assert(_pt(d, 'paymentsDue') = 0,
    'À traiter : le paiement dû de Tunis ne fuit pas vers Sfax');

  -- Une entrée à zéro ne sort pas : c'est la règle de l'écran.
  perform assert(not exists (select 1 from jsonb_array_elements(d -> 'items') i
                              where (i ->> 'count')::bigint = 0),
    'À traiter : aucune entrée à zéro, un écran de zéros ne se lit plus');
  perform assert(not exists (select 1 from jsonb_array_elements(d -> 'items') i
                              where coalesce(i ->> 'link', '') = ''),
    'À traiter : chaque entrée porte un lien, sinon ce n''est pas une chose à faire');

  -- =================================================================
  -- 2. Le propriétaire voit les deux bureaux, et sait n'en regarder qu'un
  -- =================================================================
  perform _login(u_own, ag, 'owner', o_t, caps_own, array[]::uuid[]);
  d := dashboard_today();
  perform assert(_pt(d, 'docsMissing') = 3,
    'À traiter : le propriétaire compte les 3 pièces manquantes des deux bureaux');
  perform assert(_pt(d, 'tasksOverdue') = 2, 'À traiter : les 2 tâches en retard');
  perform assert(_pt(d, 'apptsToday') = 1, 'À traiter : le rendez-vous du jour');
  perform assert(_pt(d, 'arrivalsToday') = 1, 'À traiter : l''arrivée du jour');
  perform assert(_pt(d, 'arrivalsWeek') = 2, 'À traiter : les deux arrivées de la semaine');
  perform assert(_pt(d, 'passportsHeld') = 1,
    'À traiter : le passeport détenu depuis 70 jours');
  perform assert(_pt(d, 'paymentsDue') = 1, 'À traiter : le paiement échu depuis 5 jours');
  perform assert(_pt(d, 'caseBalances') = 2, 'À traiter : deux dossiers ouverts avec un solde');

  d := dashboard_today(o_t);
  perform assert(_pt(d, 'docsMissing') = 2,
    'À traiter : la direction qui choisit Tunis voit exactement ce que voit Tunis');
  perform assert(_pt(d, 'staleCases') = 0,
    'À traiter : le dossier dormant de Sfax sort du périmètre quand on regarde Tunis');

  -- =================================================================
  -- 3. Le rapport visa : mêmes bornes, chiffres calculés à la main
  -- =================================================================
  r := report_visa();
  perform assert((r ->> 'cases')::int = 5, 'Rapport visa : 5 dossiers ouverts sur la période');
  perform assert((r ->> 'decided')::int = 3, 'Rapport visa : 3 décisions tombées');
  perform assert((r ->> 'accepted')::int = 2, 'Rapport visa : 2 acceptations');
  perform assert((r ->> 'refused')::int = 1, 'Rapport visa : 1 refus');
  perform assert((r ->> 'success_rate')::numeric = 66.7,
    'Rapport visa : taux d''aboutissement 2 sur 3, soit 66,7 %');
  -- Délais : (10 + 20 + 6) / 3 = 12,0 jours exactement.
  perform assert((r -> 'delays' ->> 'to_decision')::numeric = 12.0,
    'Rapport visa : délai moyen de décision de 12,0 jours sur des dates connues');
  perform assert((r ->> 'revenue')::numeric = 500,
    'Rapport visa : 500 encaissés, visibles parce que le propriétaire a finance:global');

  -- L'observé et la référence ne se confondent jamais.
  select i into d from jsonb_array_elements(r -> 'refusals_by_consulate') i limit 1;
  perform assert((d ->> 'observed_rate')::numeric = 33.3,
    'Rapport visa : taux de refus OBSERVÉ de 1 sur 3, soit 33,3 %');
  perform assert((d ->> 'reference_rate')::numeric = 20.0,
    'Rapport visa : taux de refus PUBLIÉ par le poste, rendu à part');
  perform assert((d ->> 'reference_year')::int = 2024,
    'Rapport visa : l''année de la référence est dite, elle n''est pas celle du rapport');
  perform assert(d ? 'observed_rate' and d ? 'reference_rate' and not (d ? 'rate'),
    'Rapport visa : aucun champ ne fusionne l''observé et la référence');

  -- Le même rapport, borné à Tunis.
  r := report_visa(o_t);
  perform assert((r ->> 'cases')::int = 3, 'Rapport visa (Tunis) : 3 dossiers');
  perform assert((r -> 'delays' ->> 'to_decision')::numeric = 15.0,
    'Rapport visa (Tunis) : (10 + 20) / 2 = 15,0 jours');
  perform assert((r ->> 'revenue')::numeric = 200, 'Rapport visa (Tunis) : 200 encaissés');

  -- =================================================================
  -- 4. Le même rapport, vu par l'agent : son bureau, sans les montants
  -- =================================================================
  perform _login(u_ag, ag, 'agent', o_s, caps_ag, array[o_s]);
  r := report_visa();
  perform assert((r ->> 'cases')::int = 2,
    'Rapport visa : un agent de Sfax ne compte que les 2 dossiers de Sfax');
  perform assert((r ->> 'decided')::int = 1 and (r ->> 'accepted')::int = 1,
    'Rapport visa : la décision de Sfax, et aucune de Tunis');
  perform assert((r ->> 'success_rate')::numeric = 100.0,
    'Rapport visa : 1 sur 1 à Sfax, et non les 66,7 % de l''agence');
  perform assert((r -> 'delays' ->> 'to_decision')::numeric = 6.0,
    'Rapport visa : 6,0 jours à Sfax, mesurés sur des dates connues');
  perform assert(r ->> 'revenue' is null and r ->> 'revenue_reason' = 'finance:global',
    'Rapport visa : sans finance:global le montant est vide, et la raison est dite');
  perform assert(jsonb_array_length(r -> 'refusals_by_consulate') = 1
                 and (r -> 'refusals_by_consulate' -> 0 ->> 'observed_refused')::int = 0,
    'Rapport visa : le refus de Tunis ne remonte pas dans le tableau de Sfax');

  -- Un agent ne peut pas demander le bureau d'à côté.
  begin
    r := report_visa(o_t);
    perform assert(false, 'un agent ne demande pas les chiffres d''un autre bureau');
  exception when insufficient_privilege then
    perform assert(true, 'un agent qui demande Tunis est refusé, pas servi vide');
  end;

  -- =================================================================
  -- 5. La vue consolidée : réservée à qui voit toute l'agence
  -- =================================================================
  begin
    select count(*) into n from dashboard_agency(current_date - 60, current_date);
    perform assert(false, 'un agent n''ouvre pas la vue consolidée');
  exception when insufficient_privilege then
    perform assert(true, 'la vue consolidée refuse un agent : la liste des bureaux est déjà une information');
  end;

  perform _login(u_own, ag, 'owner', o_t, caps_own, array[]::uuid[]);
  select count(*) into n from dashboard_agency(current_date - 60, current_date);
  perform assert(n = 3, 'Vue consolidée : une ligne par bureau, plus le total');
  select cases_opened into nn from dashboard_agency(current_date - 60, current_date) where is_total;
  perform assert(nn = 5, 'Vue consolidée : le total porte les 5 dossiers');
  select cases_opened into nn from dashboard_agency(current_date - 60, current_date)
   where office_name = 'Sfax';
  perform assert(nn = 2, 'Vue consolidée : la ligne de Sfax porte ses 2 dossiers');
  -- Une donnée sans bureau entrerait dans le total et dans aucune ligne : le
  -- total ne se déduit donc pas de la somme des lignes, et c'est pour ça qu'il
  -- est calculé ici plutôt que dans le navigateur.
  select avg_decision_days into num from dashboard_agency(current_date - 60, current_date)
   where is_total;
  perform assert(num = 12.0, 'Vue consolidée : 12,0 jours de délai moyen sur toute l''agence');
  select revenue into num from dashboard_agency(current_date - 60, current_date) where is_total;
  perform assert(num = 500, 'Vue consolidée : 500 encaissés au total');
  select revenue into num from dashboard_agency(current_date - 60, current_date)
   where office_name = 'Tunis';
  perform assert(num = 200, 'Vue consolidée : 200 encaissés à Tunis');

  -- =================================================================
  -- 6. Le tableau de bord de bureau
  -- =================================================================
  d := dashboard_office(o_s, current_date - 60, current_date);
  perform assert((d ->> 'cases_opened')::int = 2, 'Bureau Sfax : 2 dossiers ouverts');
  perform assert((d ->> 'cases_open_now')::int = 1, 'Bureau Sfax : 1 dossier encore ouvert');
  perform assert((d ->> 'acceptance')::numeric = 100.0, 'Bureau Sfax : 100 % d''acceptation');
  perform assert((d -> 'money' ->> 'collected')::numeric = 300,
    'Bureau Sfax : 300 encaissés');
  perform assert((d ->> 'shipments_open_now')::int = 1, 'Bureau Sfax : 1 cargaison en cours');

  -- =================================================================
  -- 7. La performance d'équipe : des chiffres bruts, aucune note
  -- =================================================================
  d := report_team(current_date - 60, current_date);
  perform assert((d ->> 'no_score')::boolean, 'Équipe : la fonction déclare ne rendre aucune note');
  perform assert(not exists (
      select 1 from jsonb_array_elements(d -> 'rows') row_,
                    jsonb_object_keys(row_) k
       where k in ('score','rank','rating','note','classement','feu','performance')),
    'Équipe : aucun champ de note, de rang ni de couleur dans les lignes');
  select count(*) into n from jsonb_array_elements(d -> 'rows') i
   where (i ->> 'cases_active')::int = 1;
  perform assert(n = 2, 'Équipe : chacun porte un dossier ouvert, chiffre brut');

  -- Le même rapport chez l'agent : les chiffres de son bureau seulement.
  perform _login(u_ag, ag, 'agent', o_s, caps_ag, array[o_s]);
  d := report_team(current_date - 60, current_date);
  select (i ->> 'cases_active')::int into nn from jsonb_array_elements(d -> 'rows') i
   where i ->> 'name' = 'Slim';
  perform assert(nn = 0,
    'Équipe : chez l''agent de Sfax, le dossier de Tunis du propriétaire ne compte pas');
  select (i ->> 'revenue') into txt from jsonb_array_elements(d -> 'rows') i
   where i ->> 'name' = 'Hatem';
  perform assert(txt is null,
    'Équipe : sans finance:global, le chiffre d''affaires par personne reste vide');

  -- =================================================================
  -- 8. Les SLA : semés désactivés, ils ne parlent qu'une fois choisis
  -- =================================================================
  perform _login(u_own, ag, 'owner', o_t, caps_own, array[]::uuid[]);
  select count(*) into n from sla_rules where agency_id = ag;
  perform assert(n = 3, 'SLA : les trois exemples de la spécification sont semés');
  select count(*) into n from sla_rules where agency_id = ag and active;
  perform assert(n = 0,
    'SLA : semés DÉSACTIVÉS, un délai non choisi produit des alertes qu''on ignore');

  select count(*) into n from sla_breaches();
  perform assert(n = 0, 'SLA : aucune règle active, aucun dépassement');

  update sla_rules set active = true where agency_id = ag and event = 'document_recu';
  select count(*) into n from sla_breaches();
  perform assert(n = 1, 'SLA : la pièce reçue il y a 3 jours dépasse les 24 heures promises');
  select minutes_over into nn from sla_breaches() limit 1;
  perform assert(nn > 2800,
    'SLA : le dépassement est chiffré (3 jours moins 24 heures, soit plus de 2 800 minutes)');

  perform _login(u_ag, ag, 'agent', o_s, caps_ag, array[o_s]);
  select count(*) into n from sla_breaches();
  perform assert(n = 0, 'SLA : le dépassement de Tunis n''apparaît pas chez l''agent de Sfax');

  -- =================================================================
  -- 9. Les retards : un seul format, un seul écran
  -- =================================================================
  select count(*) into n from overdue_items();
  perform assert(n = 1, 'Retards : l''agent de Sfax n''a que sa tâche en retard');

  perform _login(u_own, ag, 'owner', o_t, caps_own, array[]::uuid[]);
  select count(*) into n from overdue_items();
  perform assert(n = 5,
    'Retards : 1 dossier, 2 tâches, 1 pièce et 1 paiement pour toute l''agence');
  select count(distinct kind) into n from overdue_items();
  perform assert(n = 4, 'Retards : quatre natures, un seul format de ligne');

  -- =================================================================
  -- 10. L'agence voisine ne voit rien du tout
  -- =================================================================
  perform _login(u_out, ag2, 'owner', o_x,
                 array['case:read','reports:view','finance:global'], array[]::uuid[]);
  d := dashboard_today();
  perform assert((d ->> 'total')::int = 0,
    'Étanchéité : l''agence voisine ne compte rien de nos dossiers');
  r := report_visa();
  perform assert((r ->> 'cases')::int = 0 and (r ->> 'decided')::int = 0,
    'Étanchéité : le rapport visa de la voisine est vide');
  perform assert(jsonb_array_length(r -> 'refusals_by_consulate') = 0,
    'Étanchéité : notre consulat n''apparaît pas chez la voisine');
  select count(*) into n from overdue_items();
  perform assert(n = 0, 'Étanchéité : aucun retard de notre agence chez la voisine');

  -- Elle ne peut même pas nommer l'un de nos bureaux.
  begin
    d := dashboard_today(o_t);
    perform assert(false, 'la voisine ne demande pas nos bureaux');
  exception when others then
    perform assert(true, 'la voisine qui nomme notre bureau est refusée');
  end;

  -- =================================================================
  -- 11. L'analyse plateforme reste à la plateforme
  -- =================================================================
  set local role authenticated;
  begin
    d := platform_analytics();
    reset role;
    perform assert(false, 'un compte d''agence n''ouvre pas l''analyse plateforme');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'l''analyse plateforme refuse un compte d''agence');
  end;

  -- Ménage.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  delete from agencies where id in (ag, ag2);
  delete from auth.users where id in (u_own, u_ag, u_out);
  raise notice '--- banc du pilotage : tout est vert ---';
end $$;

drop function _login(uuid, uuid, text, uuid, text[], uuid[]);
drop function _pt(jsonb, text);
