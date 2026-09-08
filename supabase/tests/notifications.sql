-- Banc d'essai des notifications, des règles et des webhooks (migration 0051).
--
-- Ce qu'il garde, dans l'ordre où ça compte :
--   · une notification se dépose, et une seule porte y mène ;
--   · un rôle se résout en comptes réels, pas en intentions ;
--   · une règle éteinte n'envoie rien ;
--   · une règle vers le CLIENT ne part pas tant qu'une agence ne l'a pas
--     activée. C'est la règle qui coûte de l'argent quand elle tombe ;
--   · le compteur de non-lus, le marquage comme lu ;
--   · le recul croissant des remises de webhook ;
--   · la balayeuse quotidienne sur un jeu connu, et son idempotence ;
--   · le cloisonnement : un agent d'un autre bureau ne voit rien.

\set ON_ERROR_STOP on
set search_path = public;


-- BANC REJOUABLE : on efface d'abord ce qu'un passage précédent aurait laissé.
delete from agencies where slug in ('notiftest', 'notiftest2');

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then raise notice 'OK    %', label;
  else raise exception 'ÉCHEC %', label; end if;
end $$;

-- Redevenir personne. Le banc alterne entre des appels sans session (comme la
-- clé de service) et des appels signés.
create or replace function test_logout() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

do $$
declare
  a uuid; a2 uuid;
  o1 uuid; o2 uuid;
  u_own uuid; u_mgr uuid; u_a1 uuid; u_a2 uuid;
  ck uuid; vt uuid;
  c1 uuid; k1 uuid; k2 uuid; sh uuid;
  doc uuid; ap uuid; pay uuid;
  w_on uuid; w_off uuid; del uuid;
  n int; m int; v_id uuid; ok boolean; res jsonb;
  t1 timestamptz; t2 timestamptz;
begin
  -- ---------------------------------------------------------------
  -- Le décor
  -- ---------------------------------------------------------------
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_own;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_mgr;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_a1;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_a2;

  insert into agencies (slug, name, services)
    values ('notiftest', 'Notif Test', '{visas,fret}') returning id into a;
  insert into agencies (slug, name, services)
    values ('notiftest2', 'Notif Voisine', '{visas}') returning id into a2;

  insert into offices (agency_id, name, country, country_code)
    values (a, 'Tunis', 'Tunisie', 'TN') returning id into o1;
  insert into offices (agency_id, name, country, country_code)
    values (a, 'Sfax', 'Tunisie', 'TN') returning id into o2;

  insert into profiles (id, agency_id, office_id, name, role) values
    (u_own, a, o1, 'Slim',  'owner'),
    (u_mgr, a, o1, 'Amira', 'manager'),
    (u_a1,  a, o1, 'Hatem', 'agent'),
    (u_a2,  a, o2, 'Nour',  'agent');

  perform seed_catalogue(a, '{visas,fret}');
  select id into vt from visa_types where agency_id = a limit 1;

  insert into clients (agency_id, office_id, first_name, last_name, phone, whatsapp, locale, passport_expiry)
    values (a, o1, 'Mohamed', 'Bouazizi', '+21698111222', '+21698111222', 'fr', current_date + 60)
    returning id into c1;
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, assignee_id)
    values (a, 'NT-1', c1, vt, o1, u_a1) returning id into k1;

  -- ---------------------------------------------------------------
  -- 1 · Le jeu de départ
  -- ---------------------------------------------------------------
  select count(*) into n from notification_rules where agency_id = a;
  perform assert(n > 0, 'une agence naît avec ses règles de notification');

  select count(*) into n from notification_rules
   where agency_id = a and recipient = 'client' and enabled;
  perform assert(n = 0, 'aucune règle vers le client n''est active à la livraison');

  select count(*) into n from notification_rules
   where agency_id = a and channel = 'in_app' and enabled;
  perform assert(n > 0, 'les règles en application, elles, sont actives');

  select count(*) into n from notification_rules
   where agency_id = a and channel = 'whatsapp' and recipient = 'client'
     and event = 'rendez_vous.demain';
  perform assert(n = 0, 'pas de rappel de la veille en double avec les automatisations');

  -- ---------------------------------------------------------------
  -- 2 · Déposer
  -- ---------------------------------------------------------------
  v_id := notify(a, o1, u_a1, 'systeme', 'info', 'test.depot', 'un corps',
                 'case', k1, '/cases/' || k1);
  select count(*) into n from notifications
   where id = v_id and agency_id = a and user_id = u_a1 and read_at is null;
  perform assert(n = 1, 'notify dépose une notification');

  -- La seule porte : la table n'a aucune politique d'insertion.
  perform test_login(u_own, a, 'owner', o1);
  begin
    set local role authenticated;
    insert into notifications (agency_id, office_id, user_id, kind, title)
      values (a, o1, u_own, 'systeme', 'forge');
    reset role;
    ok := true;
  exception when others then
    reset role;
    ok := false;
  end;
  perform assert(not ok, 'on n''insère pas une notification à la main');

  -- Une agence ne dépose pas chez la voisine.
  begin
    set local role authenticated;
    perform notify(a2, null, null, 'systeme', 'info', 'intrusion');
    reset role;
    ok := true;
  exception when others then
    reset role;
    ok := false;
  end;
  perform assert(not ok, 'notify refuse une autre agence');
  perform test_logout();

  -- ---------------------------------------------------------------
  -- 3 · Un rôle se résout en comptes réels
  -- ---------------------------------------------------------------
  -- La règle livrée : dossier.decision, en application, vers « agent ».
  -- Le dossier est confié à Hatem : c'est lui, et lui seul, qui est prévenu.
  delete from notifications where agency_id = a;
  n := notify_event(a, 'dossier.decision', 'case', k1,
        jsonb_build_object('body', 'NT-1 accepté'));
  perform assert(n = 1, 'un rôle se résout en un compte réel');

  select count(*) into n from notifications
   where agency_id = a and user_id = u_a1 and title = 'dossier.decision';
  perform assert(n = 1, 'la notification va à l''agent qui suit le dossier');

  select count(*) into n from notifications where agency_id = a and user_id = u_a2;
  perform assert(n = 0, 'l''agent de l''autre bureau n''est pas prévenu');

  select count(*) into n from notifications
   where agency_id = a and title = 'dossier.decision' and kind = 'decision'
     and severity = 'attention' and url = '/cases/' || k1;
  perform assert(n = 1, 'la ligne porte son genre, sa gravité et son lien');

  -- Sans personne de désigné, le rôle « bureau » prévient le bureau.
  select count(*) into n from notifications
   where agency_id = a and title = 'prospect.nouveau';
  perform assert(n = 0, 'rien encore côté prospect');
  perform notify_event(a, 'prospect.nouveau', 'client', c1, '{}'::jsonb);
  select count(*) into n from notifications
   where agency_id = a and title = 'prospect.nouveau' and user_id is null and office_id = o1;
  perform assert(n = 1, 'une règle « bureau » dépose une ligne sans destinataire nommé');

  -- ---------------------------------------------------------------
  -- 4 · Une règle éteinte n'envoie rien
  -- ---------------------------------------------------------------
  update notification_rules set enabled = false
   where agency_id = a and event = 'dossier.decision' and channel = 'in_app';
  delete from notifications where agency_id = a and title = 'dossier.decision';
  n := notify_event(a, 'dossier.decision', 'case', k1, '{}'::jsonb);
  perform assert(n = 0, 'une règle éteinte ne dépose rien');
  select count(*) into n from notifications where agency_id = a and title = 'dossier.decision';
  perform assert(n = 0, 'et la table reste vide sur cet événement');
  update notification_rules set enabled = true
   where agency_id = a and event = 'dossier.decision' and channel = 'in_app';

  -- ---------------------------------------------------------------
  -- 5 · Rien ne part au client tant que l'agence n'a rien décidé
  -- ---------------------------------------------------------------
  delete from messages where agency_id = a;
  n := notify_event(a, 'piece.manquante', 'case', k1,
        jsonb_build_object('client', 'Mohamed', 'reference', 'NT-1', 'piece', 'Attestation'));
  select count(*) into m from messages
   where agency_id = a and channel = 'whatsapp' and direction = 'sortant';
  perform assert(m = 0, 'la règle vers le client est éteinte : aucun message ne part');

  -- L'agence l'active. Là, et seulement là, le message entre dans la file.
  update notification_rules set enabled = true
   where agency_id = a and event = 'piece.manquante'
     and channel = 'whatsapp' and recipient = 'client';
  perform notify_event(a, 'piece.manquante', 'case', k1,
        jsonb_build_object('client', 'Mohamed', 'reference', 'NT-1', 'piece', 'Attestation'));
  select count(*) into m from messages
   where agency_id = a and channel = 'whatsapp' and direction = 'sortant'
     and status = 'file' and client_id = c1;
  perform assert(m = 1, 'une fois activée, la règle met le message dans la file existante');

  select count(*) into m from messages
   where agency_id = a and direction = 'sortant' and body like '%Attestation%'
     and body like '%NT-1%' and body not like '%{%';
  perform assert(m = 1, 'le modèle est rendu, variables remplacées');

  -- Sans modèle, rien ne part : un corps vide est facturé comme un vrai.
  update notification_rules set enabled = true, template_key = null
   where agency_id = a and event = 'cargaison.arrivee'
     and channel = 'whatsapp' and recipient = 'client';
  delete from messages where agency_id = a;
  perform notify_event(a, 'cargaison.arrivee', 'client', c1, '{}'::jsonb);
  select count(*) into m from messages where agency_id = a and direction = 'sortant';
  perform assert(m = 0, 'sans modèle, aucun message n''est mis en file');

  -- ---------------------------------------------------------------
  -- 6 · Le délai
  -- ---------------------------------------------------------------
  delete from notifications where agency_id = a;
  update notification_rules set delay_minutes = 30
   where agency_id = a and event = 'piece.recue' and channel = 'in_app';
  perform notify_event(a, 'piece.recue', 'case', k1, '{}'::jsonb);
  select count(*) into n from notifications
   where agency_id = a and title = 'piece.recue' and created_at > now();
  perform assert(n = 1, 'une règle à délai dépose une ligne datée du futur');

  perform test_login(u_a1, a, 'agent', o1);
  set local role authenticated;
  select count(*) into n from my_notifications(40, false);
  reset role;
  perform assert(n = 0, 'la cloche ne montre pas ce qui n''est pas encore dû');
  perform test_logout();
  update notification_rules set delay_minutes = 0
   where agency_id = a and event = 'piece.recue' and channel = 'in_app';

  -- ---------------------------------------------------------------
  -- 7 · Compter, lire, marquer
  -- ---------------------------------------------------------------
  delete from notifications where agency_id = a;
  perform notify(a, o1, u_a1, 'decision', 'info', 'test.un', 'A');
  perform notify(a, o1, u_a1, 'piece', 'info', 'test.deux', 'B');
  perform notify(a, o1, null, 'systeme', 'info', 'test.bureau', 'C');
  perform notify(a, o2, u_a2, 'systeme', 'info', 'test.autre', 'D');

  perform test_login(u_a1, a, 'agent', o1);
  set local role authenticated;
  select unread_count() into n;
  reset role;
  perform assert(n = 3, 'l''agent compte ses deux lignes plus celle de son bureau');

  set local role authenticated;
  select count(*) into n from my_notifications(40, true);
  reset role;
  perform assert(n = 3, 'my_notifications rend les mêmes');

  -- Le cloisonnement : l'agent de Sfax ne voit ni les lignes de Hatem, ni
  -- celles du bureau de Tunis.
  perform test_login(u_a2, a, 'agent', o2);
  set local role authenticated;
  select unread_count() into n;
  select count(*) into m from my_notifications(40, false);
  reset role;
  perform assert(n = 1, 'un agent d''un autre bureau ne voit que la sienne');
  perform assert(m = 1, 'et sa liste ne contient rien d''autre');

  -- Le propriétaire voit les deux bureaux.
  perform test_login(u_own, a, 'owner', o1);
  set local role authenticated;
  select count(*) into n from my_notifications(40, false);
  reset role;
  perform assert(n = 1, 'le propriétaire voit la ligne de bureau, pas celles nommées');

  -- Marquer comme lu, et seulement les siennes.
  perform test_login(u_a1, a, 'agent', o1);
  set local role authenticated;
  select id into v_id from notifications where agency_id = a and title = 'test.un';
  select notifications_read(array[v_id]) into n;
  select unread_count() into m;
  reset role;
  perform assert(n = 1, 'marquer une ligne comme lue');
  perform assert(m = 2, 'le compteur baisse d''une');

  set local role authenticated;
  select id into v_id from notifications where agency_id = a and title = 'test.autre';
  select notifications_read(array[v_id]) into n;
  reset role;
  perform assert(n = 0, 'on ne marque pas comme lue la ligne d''un autre bureau');

  set local role authenticated;
  select notifications_read_all() into n;
  select unread_count() into m;
  reset role;
  perform assert(n = 2, 'tout marquer comme lu vide ce qui reste');
  perform assert(m = 0, 'et le compteur tombe à zéro');
  perform test_logout();

  -- ---------------------------------------------------------------
  -- 8 · Les webhooks
  -- ---------------------------------------------------------------
  insert into webhooks (agency_id, event, endpoint, secret_name)
    values (a, 'dossier.decision', 'https://exemple.test/hook', 'WEBHOOK_NOTIF_A')
    returning id into w_on;
  insert into webhooks (agency_id, event, endpoint, active)
    values (a, 'dossier.decision', 'https://exemple.test/eteint', false)
    returning id into w_off;

  delete from webhook_deliveries where agency_id = a;
  perform notify_event(a, 'dossier.decision', 'case', k1, '{}'::jsonb);
  select count(*) into n from webhook_deliveries where webhook_id = w_on;
  perform assert(n = 1, 'un webhook actif reçoit une remise');
  select count(*) into n from webhook_deliveries where webhook_id = w_off;
  perform assert(n = 0, 'un webhook éteint n''en reçoit aucune');

  select count(*) into n from webhook_deliveries
   where webhook_id = w_on and payload ->> 'event' = 'dossier.decision'
     and payload ->> 'entity_id' = k1::text;
  perform assert(n = 1, 'la charge porte l''événement et l''entité');

  -- Le recul croissant : une minute, puis le double, plafonné à six heures.
  perform assert(webhook_backoff(1) = interval '1 minute', 'premier recul : une minute');
  perform assert(webhook_backoff(2) = interval '2 minutes', 'puis deux');
  perform assert(webhook_backoff(4) = interval '8 minutes', 'puis huit au quatrième');
  perform assert(webhook_backoff(20) = interval '6 hours', 'et jamais plus de six heures');

  select id into del from webhook_deliveries where webhook_id = w_on;
  perform webhook_mark(del, false, 500, 'Internal Server Error');
  select attempts, next_attempt_at into n, t1 from webhook_deliveries where id = del;
  perform assert(n = 1, 'un échec compte une tentative');
  perform assert(t1 > now(), 'et repousse la suivante');
  perform assert((select status from webhook_deliveries where id = del) = 'en_attente',
                 'la remise reste à tenter');

  perform webhook_mark(del, false, 500, 'encore');
  select next_attempt_at into t2 from webhook_deliveries where id = del;
  perform assert(t2 > t1, 'le deuxième échec recule plus loin que le premier');
  perform assert((select failure_count from webhooks where id = w_on) = 2,
                 'le webhook compte ses échecs');

  -- La fonction de bord ne prend que ce qui est dû.
  select count(*) into n from webhook_pending(50) where id = del;
  perform assert(n = 0, 'une remise en attente de son recul n''est pas servie');
  update webhook_deliveries set next_attempt_at = now() - interval '1 minute' where id = del;
  select count(*) into n from webhook_pending(50) where id = del;
  perform assert(n = 1, 'une fois l''heure venue, elle est servie');
  select count(*) into n from webhook_pending(50)
   where id = del and secret_name = 'WEBHOOK_NOTIF_A' and endpoint = 'https://exemple.test/hook';
  perform assert(n = 1, 'la fonction de bord reçoit le NOM du secret, pas sa valeur');

  -- On abandonne à la huitième.
  for m in 3..8 loop
    perform webhook_mark(del, false, 500, 'toujours');
  end loop;
  perform assert((select status from webhook_deliveries where id = del) = 'echoue',
                 'après huit tentatives, on abandonne');
  select count(*) into n from webhook_pending(50) where id = del;
  perform assert(n = 0, 'une remise abandonnée n''est plus servie');

  -- Une réussite efface l'ardoise.
  perform notify_event(a, 'dossier.decision', 'case', k1, '{}'::jsonb);
  select id into del from webhook_deliveries
   where webhook_id = w_on and status = 'en_attente' order by created_at desc limit 1;
  perform webhook_mark(del, true, 200, 'ok');
  perform assert((select status from webhook_deliveries where id = del) = 'envoye',
                 'une remise réussie passe à « envoye »');
  perform assert((select delivered_at from webhook_deliveries where id = del) is not null,
                 'et porte son heure de remise');
  perform assert((select failure_count from webhooks where id = w_on) = 0,
                 'la réussite remet le compteur d''échecs à zéro');

  -- ---------------------------------------------------------------
  -- 9 · La balayeuse quotidienne, sur un jeu connu
  -- ---------------------------------------------------------------
  delete from notifications where agency_id = a;

  -- Un rendez-vous demain.
  insert into appointments (agency_id, case_id, office_id, kind, at)
    values (a, k1, o1, 'consulat', now() + interval '1 day') returning id into ap;
  -- Une pièce expirée.
  insert into case_documents (agency_id, case_id, key, label, state, expires_at)
    values (a, k1, 'attestation', '{"fr":"Attestation"}', 'validee', current_date - 5)
    returning id into doc;
  -- Une facture échue.
  insert into payments (agency_id, case_id, client_id, office_id, label, kind, amount, currency, state, due_at)
    values (a, k1, c1, o1, '{"fr":"Honoraires"}', 'honoraires', 300, 'TND', 'du', current_date - 3)
    returning id into pay;
  -- Un dossier endormi depuis vingt jours.
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, assignee_id, updated_at)
    values (a, 'NT-2', c1, vt, o1, u_a1, now() - interval '20 days') returning id into k2;
  -- Un conteneur en dépassement, avec son barème.
  insert into shipments (agency_id, reference, office_id, mode, dest_port, container_type,
                         discharged_at, arrived_at, status)
    values (a, 'EXP-1', o1, 'maritime_fcl', 'Radès', '40',
            now() - interval '20 days', now() - interval '20 days', 'en_cours')
    returning id into sh;
  insert into demurrage_tariffs (agency_id, kind, billed_by, port, container_type, free_days, tiers, valid_from)
    values (a, 'surestaries', 'CMA CGM', 'Radès', '40', 5,
            '[{"from_day":1,"to_day":3,"rate":45},{"from_day":4,"to_day":null,"rate":90}]',
            current_date - 60);

  perform test_login(u_own, a, 'owner', o1);
  set local role authenticated;
  res := notification_sweep();
  reset role;

  select count(*) into n from notifications where agency_id = a and title = 'rendez_vous.demain';
  perform assert(n >= 1, 'la balayeuse voit le rendez-vous de demain');
  select count(*) into n from notifications
   where agency_id = a and title = 'piece.expiree' and entity_id = doc;
  perform assert(n >= 1, 'elle voit la pièce expirée, et elle porte la pièce');
  select count(*) into n from notifications
   where agency_id = a and title = 'facture.echue' and entity_id = pay and severity = 'urgent';
  perform assert(n >= 1, 'elle voit la facture échue, et la marque urgente');
  select count(*) into n from notifications
   where agency_id = a and title = 'dossier.sans_activite' and entity_id = k2;
  perform assert(n = 1, 'elle réveille le dossier endormi');
  select count(*) into n from notifications
   where agency_id = a and title = 'passeport.expire_bientot' and entity_id = c1;
  perform assert(n = 1, 'elle prévient du passeport qui expire dans deux mois');
  select count(*) into n from notifications
   where agency_id = a and title = 'surestaries.risque' and entity_id = sh and severity = 'urgent';
  perform assert(n >= 1, 'elle lit shipment_counters et alerte sur le dépassement');

  select count(*) into n from notifications where agency_id = a;
  set local role authenticated;
  res := notification_sweep();
  reset role;
  select count(*) into m from notifications where agency_id = a;
  perform assert(m = n, 'un deuxième balayage le même jour ne double rien');
  perform test_logout();

  -- ---------------------------------------------------------------
  -- 10 · La file WhatsApp, complétée et non contournée
  -- ---------------------------------------------------------------
  delete from messages where agency_id = a;
  -- Le client écrit : la fenêtre de 24 heures s'ouvre, un message libre passe.
  insert into messages (agency_id, case_id, client_id, channel, direction, body, status)
    values (a, k1, c1, 'whatsapp', 'entrant', 'Bonjour', 'remis');
  insert into messages (agency_id, case_id, client_id, channel, direction, body, status, at)
    values (a, k1, c1, 'whatsapp', 'sortant', 'Plus tard', 'file', now() + interval '30 minutes');
  select count(*) into n from wa_outbox(a);
  select count(*) into m from wa_outbox_due(a);
  perform assert(n = 1, 'la file existante voit toujours le message');
  perform assert(m = 0, 'mais il n''est pas encore dû, donc il ne part pas');

  raise notice '--- banc notifications : tout est vert ---';
end $$;

-- Un banc ne laisse rien derrière lui. Cette fonction d'essai restait dans la
-- base, ouverte à l'anonyme, et faisait échouer le banc des droits.
drop function if exists test_logout();
