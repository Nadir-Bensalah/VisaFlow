-- Banc d'essai de WhatsApp.
-- Un message entrant doit trouver son dossier quel que soit le format du
-- numéro, un appel rejoué par Meta ne doit rien doubler, et un numéro
-- ambigu ne doit jamais atterrir dans le mauvais dossier.

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
  a uuid; o uuid; c1 uuid; c2 uuid; ck uuid; vt uuid; k uuid; m uuid; n int;
begin
  insert into agencies (slug, name, services) values ('watest', 'WA Test', '{visas}') returning id into a;
  insert into offices (agency_id, name, country, country_code) values (a, 'Tunis', 'Tunisie', 'TN') returning id into o;
  insert into checklists (agency_id, name) values (a, '{"fr":"L"}') returning id into ck;
  insert into visa_types (agency_id, country_code, country, label, checklist_id)
    values (a, 'FR', '{"fr":"France"}', '{"fr":"T"}', ck) returning id into vt;
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (a, o, 'Amine', 'B', '+216 20 111 222') returning id into c1;
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id)
    values (a, 'WA-1', c1, vt, o) returning id into k;

  -- Un indicatif écrit autrement doit quand même rattacher.
  m := wa_receive(a, '0021620111222', 'Bonjour, où en est mon dossier ?', 'wamid.AAA', 'Amine');
  perform assert(m is not null, 'un numéro écrit autrement rattache quand même');
  select count(*) into n from messages where id = m and case_id = k and direction = 'entrant';
  perform assert(n = 1, 'le message entrant atterrit dans le dossier ouvert');

  -- Meta rejoue ses appels : le même identifiant ne doit pas doubler.
  perform wa_receive(a, '0021620111222', 'Bonjour, où en est mon dossier ?', 'wamid.AAA', 'Amine');
  select count(*) into n from messages where provider_id = 'wamid.AAA';
  perform assert(n = 1, 'un appel rejoué ne crée pas un deuxième message');

  -- Deux clients sur le même numéro : personne ne reçoit, on met de côté.
  insert into clients (agency_id, office_id, first_name, last_name, phone, whatsapp)
    values (a, o, 'Salma', 'B', '+216 20 111 999', '+216 20 111 222') returning id into c2;
  m := wa_receive(a, '+216 20 111 222', 'Et le mien ?', 'wamid.BBB', 'Salma');
  perform assert(m is null, 'un numéro qui répond à deux clients ne rattache rien');
  select count(*) into n from whatsapp_unmatched where provider_id = 'wamid.BBB';
  perform assert(n = 1, 'le message ambigu part dans la corbeille des non rattachés');

  -- La fenêtre de 24 heures s'ouvre à la réception.
  perform assert(wa_window_open(c1), 'la fenêtre s''ouvre dès qu''un client écrit');

  -- Les retours d'état, coût compris.
  insert into messages (agency_id, case_id, client_id, channel, direction, body, status, provider_id)
    values (a, k, c1, 'whatsapp', 'sortant', 'Vos pièces sont validées.', 'envoye', 'wamid.OUT1');
  perform wa_status('wamid.OUT1', 'read', null, 0.0231, 'USD');
  select count(*) into n from messages
   where provider_id = 'wamid.OUT1' and status = 'lu' and read_at is not null and wa_cost = 0.0231;
  perform assert(n = 1, 'un retour « lu » porte l''heure de lecture et le coût');

  -- La file d'envoi : dans la fenêtre, un message sans modèle passe.
  insert into messages (agency_id, case_id, client_id, channel, direction, body, status)
    values (a, k, c1, 'whatsapp', 'sortant', 'Bonjour', 'file');
  select count(*) into n from wa_outbox(a);
  perform assert(n = 1, 'dans la fenêtre, un message libre est envoyable');

  raise notice '--- banc WhatsApp : tout est vert ---';
end $$;
