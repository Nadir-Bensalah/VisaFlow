-- Banc d'essai du créneau.
-- Le rang annoncé au client doit être juste, un dossier ne doit jamais
-- occuper deux places, et le portail ne doit rendre qu'un chiffre.

\set ON_ERROR_STOP on
set search_path = public;


-- BANC REJOUABLE : on efface d'abord ce qu'un passage précédent aurait laissé.
-- Sans ça, le deuxième lancement échoue sur le slug déjà pris, et on croit à
-- une régression alors que c'est un résidu.
delete from agencies where slug in ('creneaux');

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
  a1 uuid; o1 uuid; u_agent uuid; cl uuid; ck uuid; vt uuid;
  cs_fr uuid; cs_it uuid;
  k_a uuid; k_b uuid; k_c uuid; k_d uuid;
  q_a uuid; q_b uuid; q_c uuid;
  n int; r record; ok boolean;
begin
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_agent;
  insert into agencies (slug, name, services) values ('creneaux', 'Test Créneaux', '{visas}') returning id into a1;
  insert into offices (agency_id, name, country, country_code) values (a1, 'Tunis', 'Tunisie', 'TN') returning id into o1;
  insert into profiles (id, agency_id, office_id, name, role)
    values (u_agent, a1, o1, 'Agent', 'agent');

  insert into checklists (agency_id, name) values (a1, '{"fr":"Schengen"}') returning id into ck;
  insert into visa_types (agency_id, country_code, country, label, checklist_id)
    values (a1, 'FR', '{"fr":"France"}', '{"fr":"Tourisme"}', ck) returning id into vt;
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (a1, o1, 'Amine', 'Ben Salah', '+216 20 000 001') returning id into cl;

  insert into consulates (agency_id, country_code, country, city, centre, appeal_days, ref_refusal_rate)
    values (a1, 'FR', '{"fr":"France"}', 'Tunis', 'tls_tunis', 30, 15.4) returning id into cs_fr;
  insert into consulates (agency_id, country_code, country, city, centre, ref_refusal_rate)
    values (a1, 'IT', '{"fr":"Italie"}', 'Tunis', 'tls_tunis', 32.0) returning id into cs_it;

  -- Quatre dossiers, tous prêts à attendre un créneau.
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, consulate_id, stage)
    values (a1, 'VF-0001', cl, vt, o1, cs_fr, 'rendez_vous') returning id into k_a;
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, consulate_id, stage)
    values (a1, 'VF-0002', cl, vt, o1, cs_fr, 'rendez_vous') returning id into k_b;
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, consulate_id, stage)
    values (a1, 'VF-0003', cl, vt, o1, cs_fr, 'rendez_vous') returning id into k_c;
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, consulate_id, stage)
    values (a1, 'VF-0004', cl, vt, o1, cs_it, 'rendez_vous') returning id into k_d;

  -- ---------------------------------------------------------------
  -- Le rang : ancienneté, puis priorité qui passe devant
  -- ---------------------------------------------------------------
  insert into appointment_queue (agency_id, case_id, consulate_id, joined_at, priority)
    values (a1, k_a, cs_fr, now() - interval '10 days', 'normale') returning id into q_a;
  insert into appointment_queue (agency_id, case_id, consulate_id, joined_at, priority)
    values (a1, k_b, cs_fr, now() - interval '5 days', 'normale') returning id into q_b;
  insert into appointment_queue (agency_id, case_id, consulate_id, joined_at, priority)
    values (a1, k_c, cs_fr, now() - interval '1 day', 'urgente') returning id into q_c;
  insert into appointment_queue (agency_id, case_id, consulate_id, joined_at)
    values (a1, k_d, cs_it, now() - interval '3 days');

  select * into r from queue_rank(k_c);
  perform assert(r.rank = 1, 'l''urgent passe devant, même arrivé en dernier');
  select * into r from queue_rank(k_a);
  perform assert(r.rank = 2, 'à priorité égale, le plus ancien est devant');
  select * into r from queue_rank(k_b);
  perform assert(r.rank = 3 and r.total = 3, 'le plus récent est dernier, sur trois');

  -- La file d'un poste ne compte pas les dossiers d'un autre poste.
  select * into r from queue_rank(k_d);
  perform assert(r.rank = 1 and r.total = 1, 'la file italienne ignore la file française');

  -- ---------------------------------------------------------------
  -- Un dossier n'attend qu'une fois
  -- ---------------------------------------------------------------
  ok := true;
  begin
    insert into appointment_queue (agency_id, case_id, consulate_id) values (a1, k_a, cs_fr);
    ok := false;
  exception when unique_violation then ok := true;
  end;
  perform assert(ok, 'un double clic ne crée pas une deuxième place');

  -- Sorti de la file, il peut y revenir : l'index ne vise que « attente ».
  update appointment_queue set status = 'abandonne', left_at = now() where id = q_a;
  insert into appointment_queue (agency_id, case_id, consulate_id) values (a1, k_a, cs_fr);
  select count(*) into n from appointment_queue where case_id = k_a;
  perform assert(n = 2, 'on peut revenir dans la file après en être sorti');

  -- ---------------------------------------------------------------
  -- Servir la file, avec les droits de l'agent
  -- ---------------------------------------------------------------
  perform test_login(u_agent, a1, 'agent', o1);

  perform serve_queue(q_c, now() + interval '20 days');

  select count(*) into n from appointments where case_id = k_c and kind = 'consulat';
  perform assert(n = 1, 'servir la file crée le rendez-vous');
  select count(*) into n from appointment_queue where id = q_c and status = 'servi';
  perform assert(n = 1, 'la place est marquée servie');
  select count(*) into n from cases where id = k_c and stage = 'depot';
  perform assert(n = 1, 'le dossier avance au dépôt');
  select count(*) into n from slot_attempts where case_id = k_c and result = 'creneau_pris';
  perform assert(n = 1, 'la tentative réussie entre au registre');
  select count(*) into n from activity_events where case_id = k_c and type = 'creneau_obtenu';
  perform assert(n = 1, 'le journal garde la trace');

  -- Le lieu par défaut vient du centre, pas de la ville.
  select count(*) into n from appointments where case_id = k_c and location like 'TLScontact%';
  perform assert(n = 1, 'le lieu par défaut nomme le centre de dépôt');

  -- Servir deux fois est refusé.
  ok := false;
  begin
    perform serve_queue(q_c, now() + interval '25 days');
  exception when others then ok := true;
  end;
  perform assert(ok, 'une place déjà servie ne se sert pas deux fois');

  -- ---------------------------------------------------------------
  -- La décision : code fermé, échéance de recours, sortie de file
  -- ---------------------------------------------------------------
  perform record_decision(k_b, 'refuse', 'sortie_non_etablie', 'Attaches jugées faibles.');

  select count(*) into n from cases
   where id = k_b and status = 'refuse' and refusal_code = 'sortie_non_etablie'
     and appeal_due_at = (now() + interval '30 days')::date;
  perform assert(n = 1, 'le refus arme l''échéance de recours depuis le délai du poste');
  select count(*) into n from appointment_queue where case_id = k_b and status = 'attente';
  perform assert(n = 0, 'une décision sort le dossier de la file');

  -- Un code inconnu est refusé par la contrainte.
  ok := false;
  begin
    perform record_decision(k_a, 'refuse', 'motif_invente');
  exception when others then ok := true;
  end;
  perform assert(ok, 'un motif hors liste est refusé');

  -- ---------------------------------------------------------------
  -- Le délai réel, mesuré
  -- ---------------------------------------------------------------
  perform assert(real_wait_days(cs_fr) is not null, 'le délai réel se calcule dès la première file servie');
  perform assert(real_wait_days(cs_it) is null, 'sans file servie, on n''invente pas de délai');

  -- ---------------------------------------------------------------
  -- Le portail rend un chiffre, pas la file
  -- ---------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from portal_queue(
    (select portal_token from cases where id = k_d)
  );
  perform assert(n = 1, 'le portail rend une ligne pour un dossier en attente');
  select count(*) into n from portal_queue('jeton_qui_n_existe_pas');
  perform assert(n = 0, 'un jeton inconnu ne rend rien');

  raise notice '--- banc des créneaux : tout est vert ---';
end $$;
