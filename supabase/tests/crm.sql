-- Banc d'essai du CRM commercial.
--
-- Ce qu'il refuse de laisser passer : un prospect converti deux fois, un
-- changement d'état sans trace, deux contacts principaux pour un même client,
-- un taux de conversion inventé, et un bureau qui voit les affaires du voisin.
--
-- Il crée son propre jeu et le retire à la fin. Il ne suppose rien de la base.

\set ON_ERROR_STOP on
set search_path = public;


-- BANC REJOUABLE : on efface d'abord ce qu'un passage précédent aurait laissé.
-- Sans ça, le deuxième lancement échoue sur le slug déjà pris, et on croit à
-- une régression alors que c'est un résidu.
delete from agencies where slug in ('crm-un', 'crm-deux');

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
  a1 uuid; a2 uuid;
  o1 uuid; o2 uuid; o_stats uuid; o_follow uuid; o_autre uuid;
  u_owner uuid; u_agent uuid; u_viewer uuid; u_other uuid;
  cl_exist uuid; req uuid;
  l_site uuid; l_manuel uuid; l_connu uuid; l_perdu uuid;
  c_new uuid; c_again uuid; ct uuid;
  ids uuid[]; v uuid;
  n int; ok boolean; res jsonb; b jsonb; ts timestamptz; t2 timestamptz;
begin
  -- ---------------------------------------------------------------
  -- Le décor : deux agences, quatre bureaux, quatre comptes
  -- ---------------------------------------------------------------
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_owner;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_agent;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_viewer;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_other;

  insert into agencies (slug, name, services) values ('crm-un', 'CRM Un', '{visas,fret}') returning id into a1;
  insert into agencies (slug, name, services) values ('crm-deux', 'CRM Deux', '{visas}') returning id into a2;

  insert into offices (agency_id, name, country, country_code) values (a1, 'Tunis', 'Tunisie', 'TN') returning id into o1;
  insert into offices (agency_id, name, country, country_code) values (a1, 'Sfax', 'Tunisie', 'TN') returning id into o2;
  insert into offices (agency_id, name, country, country_code) values (a1, 'Gabès', 'Tunisie', 'TN') returning id into o_stats;
  insert into offices (agency_id, name, country, country_code) values (a1, 'Sousse', 'Tunisie', 'TN') returning id into o_follow;
  insert into offices (agency_id, name, country, country_code) values (a2, 'Tripoli', 'Libye', 'LY') returning id into o_autre;

  insert into profiles (id, agency_id, office_id, name, role) values
    (u_owner,  a1, o1,      'Slim',  'owner'),
    (u_agent,  a1, o2,      'Hatem', 'agent'),
    (u_viewer, a1, o1,      'Stage', 'viewer'),
    (u_other,  a2, o_autre, 'Rania', 'owner');

  -- ---------------------------------------------------------------
  -- Les étiquettes de départ
  -- ---------------------------------------------------------------
  select count(*) into n from client_tag_defs where agency_id = a1;
  perform assert(n = 9, 'une agence nouvelle reçoit ses neuf étiquettes');
  select count(*) into n from client_tag_defs where agency_id = a1 and label = 'Importateur';
  perform assert(n = 1, 'l''étiquette « Importateur » est semée pour le fret');
  -- Semer deux fois ne double rien.
  perform seed_crm_tags(a1);
  select count(*) into n from client_tag_defs where agency_id = a1;
  perform assert(n = 9, 'semer les étiquettes deux fois ne les double pas');

  -- ---------------------------------------------------------------
  -- Une demande du formulaire public devient un prospect
  -- ---------------------------------------------------------------
  insert into client_requests (agency_id, reference, kind, goods, first_name, last_name, phone, note)
  values (a1, 'DM-0001', 'fret', 'Pièces détachées', 'Karim', 'Trabelsi', '+21620000001', 'Conteneur groupé')
  returning id into req;

  perform test_login(u_owner, a1, 'owner', o1);
  l_site := lead_from_request(req);

  select count(*) into n from leads
   where id = l_site and request_id = req and source = 'site' and service_interest = 'shipping';
  perform assert(n = 1, 'une demande de fret devient un prospect « shipping » venu du site');
  select status into ok from (select status = 'qualifiee' as status from client_requests where id = req) q;
  perform assert(ok, 'la demande passe qualifiée, elle ne clignote plus en nouvelle');

  ok := false;
  begin
    perform lead_from_request(req);
  exception when others then ok := true;
  end;
  perform assert(ok, 'une demande déjà transformée ne l''est pas deux fois');

  -- ---------------------------------------------------------------
  -- Le changement d'état écrit son événement, tout seul
  -- ---------------------------------------------------------------
  select count(*) into n from lead_events where lead_id = l_site and kind = 'changement_etat';
  perform assert(n = 0, 'un prospect qui vient de naître n''a aucun changement d''état');

  -- On vieillit l'affaire de dix jours : sans ça, `now()` étant figé pendant
  -- toute la transaction, la remise à jour de la date ne se verrait pas.
  update leads set status_since = now() - interval '10 days' where id = l_site;
  select status_since into ts from leads where id = l_site;

  set local role authenticated;
  update leads set status = 'contacte' where id = l_site;
  reset role;

  select count(*) into n from lead_events
   where lead_id = l_site and kind = 'changement_etat' and body like 'nouveau > contacte%';
  perform assert(n = 1, 'le passage à « contacté » écrit son événement sans que l''écran y pense');
  select author_id = u_owner into ok from lead_events
   where lead_id = l_site and kind = 'changement_etat' limit 1;
  perform assert(ok, 'l''événement nomme son auteur');

  select status_since into t2 from leads where id = l_site;
  perform assert(t2 > ts, 'la date d''entrée dans l''état est remise à jour');

  -- Le motif de perte entre dans la trace : sans lui, personne ne saura
  -- jamais pourquoi l'affaire est partie.
  set local role authenticated;
  update leads set status = 'perdu', lost_reason = 'Trop cher' where id = l_site;
  reset role;
  select count(*) into n from lead_events
   where lead_id = l_site and body like 'contacte > perdu%Trop cher%';
  perform assert(n = 1, 'le motif de perte est gardé dans le journal');

  -- ---------------------------------------------------------------
  -- Convertir un prospect en client
  -- ---------------------------------------------------------------
  insert into leads (agency_id, office_id, first_name, last_name, phone, source, estimated_value)
  values (a1, o1, 'Nour', 'Ayari', '+21620000010', 'facebook', 1200)
  returning id into l_manuel;

  c_new := lead_convert(l_manuel, o1);
  perform assert(c_new is not null, 'la conversion rend l''identifiant du client');

  select count(*) into n from clients where id = c_new and phone = '+21620000010' and office_id = o1;
  perform assert(n = 1, 'le client est créé au bon bureau, avec le numéro du prospect');
  select count(*) into n from leads
   where id = l_manuel and status = 'gagne' and client_id = c_new and converted_at is not null;
  perform assert(n = 1, 'le prospect est marqué gagné et garde le lien vers son client');
  select count(*) into n from lead_events where lead_id = l_manuel and kind = 'note';
  perform assert(n = 1, 'la conversion laisse sa note au journal');
  select count(*) into n from lead_events where lead_id = l_manuel and kind = 'changement_etat';
  perform assert(n = 1, 'la conversion écrit aussi le changement d''état');

  ok := false;
  begin
    perform lead_convert(l_manuel, o1);
  exception when others then ok := true;
  end;
  perform assert(ok, 'un prospect déjà converti refuse une deuxième conversion');

  -- Un client existant est reconnu à son numéro, jamais à son nom.
  insert into clients (agency_id, office_id, first_name, last_name, phone)
  values (a1, o1, 'Sonia', 'Belhaj', '+21620000020') returning id into cl_exist;
  insert into leads (agency_id, office_id, first_name, last_name, phone, source)
  values (a1, o1, 'Sonia', 'B.', '+21620000020', 'recommandation') returning id into l_connu;
  c_again := lead_convert(l_connu, o1);
  perform assert(c_again = cl_exist, 'un numéro déjà connu retrouve sa fiche au lieu d''en créer une deuxième');

  -- ---------------------------------------------------------------
  -- Un seul contact principal par client
  -- ---------------------------------------------------------------
  insert into client_contacts (agency_id, client_id, kind, name, is_primary)
  values (a1, cl_exist, 'principal', 'Sonia Belhaj', true) returning id into ct;
  insert into client_contacts (agency_id, client_id, kind, name, is_primary)
  values (a1, cl_exist, 'comptable', 'Mehdi', false);

  ok := false;
  begin
    insert into client_contacts (agency_id, client_id, kind, name, is_primary)
    values (a1, cl_exist, 'logistique', 'Fatma', true);
  exception when unique_violation then ok := true;
  end;
  perform assert(ok, 'un deuxième contact principal est refusé');

  -- Retiré, il rend sa place : l'index ne vise que les contacts vivants.
  update client_contacts set deleted_at = now() where id = ct;
  insert into client_contacts (agency_id, client_id, kind, name, is_primary)
  values (a1, cl_exist, 'logistique', 'Fatma', true);
  select count(*) into n from client_contacts where client_id = cl_exist and is_primary and deleted_at is null;
  perform assert(n = 1, 'le contact principal retiré libère la place, et il n''y en a toujours qu''un');

  -- Une seule fiche société par client.
  insert into client_companies (agency_id, office_id, client_id, company_name, tax_id)
  values (a1, o1, cl_exist, 'Belhaj Import', '1234567A');
  ok := false;
  begin
    insert into client_companies (agency_id, office_id, client_id, company_name)
    values (a1, o1, cl_exist, 'Belhaj Export');
  exception when unique_violation then ok := true;
  end;
  perform assert(ok, 'un client n''a qu''une seule fiche société vivante');

  -- ---------------------------------------------------------------
  -- Le pipeline : compte, valeur, et ce qui dort
  -- ---------------------------------------------------------------
  insert into leads (agency_id, office_id, last_name, phone, status, estimated_value, status_since, source)
  values
    (a1, o_stats, 'Pipe A', '+21620001001', 'nouveau',      100, now() - interval '9 days', 'google'),
    (a1, o_stats, 'Pipe B', '+21620001002', 'nouveau',      250, now() - interval '3 days', 'google'),
    (a1, o_stats, 'Pipe C', '+21620001003', 'devis_envoye', 900, now() - interval '5 days', 'comptoir');

  res := crm_pipeline(o_stats);
  perform assert((res->>'total')::int = 3, 'le pipeline compte les trois affaires du bureau');
  perform assert((res->>'total_value')::numeric = 1250, 'le pipeline additionne la valeur estimée');
  perform assert(jsonb_array_length(res->'by_status') = 8, 'les huit états sont rendus, même vides');

  select e into b from jsonb_array_elements(res->'by_status') e where e->>'status' = 'nouveau';
  perform assert((b->>'count')::int = 2 and (b->>'value')::numeric = 350,
                 'l''état « nouveau » porte deux affaires pour 350');
  perform assert((b->>'oldest_at')::timestamptz < now() - interval '8 days',
                 'le pipeline dit depuis quand la plus vieille affaire dort dans l''état');
  select e into b from jsonb_array_elements(res->'by_status') e where e->>'status' = 'gagne';
  perform assert((b->>'count')::int = 0 and b->>'oldest_at' is null,
                 'un état vide rend zéro, pas une date inventée');

  -- ---------------------------------------------------------------
  -- Le taux de conversion, sur des données connues
  -- ---------------------------------------------------------------
  -- Dix prospects entrés dans la fenêtre, trois convertis : 30 %, pas 29,7 ni
  -- « environ un tiers ». Les délais valent 6, 4 et 2 jours : la moyenne est 4.
  delete from leads where office_id = o_stats;

  ids := '{}';
  for n in 1..10 loop
    insert into leads (agency_id, office_id, last_name, phone, status, estimated_value,
                       source, created_at, status_since)
    values (a1, o_stats, 'Stat ' || n, '+2162000200' || n, 'nouveau', 100 * n, 'instagram',
            now() - (n || ' days')::interval, now() - (n || ' days')::interval)
    returning id into v;
    ids := ids || v;
  end loop;

  -- Trois conversions, avec des anciennetés connues.
  perform lead_convert(ids[6], o_stats);
  perform lead_convert(ids[4], o_stats);
  perform lead_convert(ids[2], o_stats);

  -- Deux affaires perdues, avec leurs motifs.
  update leads set status = 'perdu', lost_reason = 'Prix' where id = ids[1];
  update leads set status = 'perdu', lost_reason = 'Prix' where id = ids[3];
  update leads set status = 'perdu', lost_reason = 'Délai' where id = ids[5];

  res := crm_stats(o_stats, now() - interval '30 days', now());
  perform assert((res->>'entries')::int = 10, 'les entrées de la fenêtre sont comptées');
  perform assert((res->>'conversions')::int = 3, 'les conversions sont comptées');
  perform assert((res->>'conversion_rate')::numeric = 30.0, 'le taux de conversion vaut 30 %, calculé');
  perform assert((res->>'won_value')::numeric = 1200, 'la valeur gagnée additionne les trois affaires converties');
  perform assert((res->>'lost_value')::numeric = 900, 'la valeur perdue additionne les trois affaires perdues');
  perform assert((res->>'avg_days_to_convert')::numeric = 4.0, 'le délai moyen de conversion est mesuré, pas estimé');
  perform assert((res->'lost_reasons'->0->>'reason') = 'Prix'
                 and (res->'lost_reasons'->0->>'count')::int = 2,
                 'le motif de perte le plus fréquent remonte en tête');

  -- Une fenêtre vide ne rend pas un taux, elle rend zéro.
  res := crm_stats(o_stats, now() - interval '400 days', now() - interval '300 days');
  perform assert((res->>'entries')::int = 0 and (res->>'conversion_rate')::numeric = 0
                 and res->>'avg_days_to_convert' is null,
                 'sans entrée, aucun taux ni délai n''est inventé');

  -- ---------------------------------------------------------------
  -- Ce qu'il faut relancer
  -- ---------------------------------------------------------------
  insert into leads (agency_id, office_id, last_name, phone, status, source, next_action_at, created_at)
  values
    (a1, o_follow, 'Relance demain', '+21620003001', 'relance',  'whatsapp', now() + interval '1 day', now()),
    (a1, o_follow, 'Relance hier',   '+21620003002', 'contacte', 'whatsapp', now() - interval '1 day', now()),
    (a1, o_follow, 'Silencieux',     '+21620003003', 'qualifie', 'whatsapp', null, now() - interval '90 days'),
    (a1, o_follow, 'Récent',         '+21620003004', 'qualifie', 'whatsapp', null, now() - interval '1 day'),
    (a1, o_follow, 'Déjà gagné',     '+21620003005', 'gagne',    'whatsapp', now() - interval '5 days', now());

  select count(*) into n from leads_to_follow(o_follow, 50);
  perform assert(n = 4, 'les affaires gagnées ou perdues sortent de la liste des relances');

  select last_name into ok from (select last_name = 'Relance hier' as last_name
    from leads_to_follow(o_follow, 50) limit 1) q;
  perform assert(ok, 'la relance en retard passe en tête');

  select last_name into ok from (
    select last_name = 'Silencieux' as last_name
    from leads_to_follow(o_follow, 50) offset 2 limit 1) q;
  perform assert(ok, 'sans date d''action, le prospect sans nouvelle depuis longtemps remonte');

  select silent_days into n from leads_to_follow(o_follow, 50) where last_name = 'Silencieux';
  perform assert(n >= 89, 'le silence est mesuré en jours, sur le dernier événement réel');

  -- ---------------------------------------------------------------
  -- Le cloisonnement : entre agences
  -- ---------------------------------------------------------------
  perform test_login(u_other, a2, 'owner', o_autre);
  set local role authenticated;
  select count(*) into n from leads;
  perform assert(n = 0, 'l''autre agence ne voit aucun prospect du voisin');
  select count(*) into n from lead_events;
  perform assert(n = 0, 'ni aucun de ses échanges');
  select count(*) into n from client_companies;
  perform assert(n = 0, 'ni aucune de ses fiches société');
  select count(*) into n from client_tag_defs;
  perform assert(n = 9, 'elle ne voit que ses propres étiquettes');
  reset role;

  ok := false;
  begin
    perform lead_convert(l_site, o_autre);
  exception when others then ok := true;
  end;
  perform assert(ok, 'elle ne convertit pas le prospect d''une autre agence');

  -- ---------------------------------------------------------------
  -- Le cloisonnement : entre bureaux
  -- ---------------------------------------------------------------
  -- L'agent est à Sfax. Tout ce jeu vit à Tunis, Gabès et Sousse.
  perform test_login(u_agent, a1, 'agent', o2);
  set local role authenticated;
  select count(*) into n from leads;
  perform assert(n = 0, 'un agent ne voit pas les prospects des autres bureaux');
  select count(*) into n from lead_events;
  perform assert(n = 0, 'ni les échanges qui y sont attachés');
  select count(*) into n from client_contacts;
  perform assert(n = 0, 'ni les contacts des clients d''un autre bureau');
  reset role;

  res := crm_pipeline(null);
  perform assert((res->>'total')::int = 0, 'le pipeline de l''agent ne compte que son bureau');

  ok := false;
  begin
    perform crm_pipeline(o_stats);
  exception when others then ok := true;
  end;
  perform assert(ok, 'demander le pipeline d''un bureau qu''on ne voit pas est refusé');

  ok := false;
  begin
    perform lead_convert(ids[8], o2);
  exception when others then ok := true;
  end;
  perform assert(ok, 'un agent ne convertit pas un prospect d''un autre bureau');

  -- Le stagiaire regarde, il n'écrit pas.
  perform test_login(u_viewer, a1, 'viewer', o1);
  set local role authenticated;
  ok := false;
  begin
    insert into leads (agency_id, office_id, last_name, phone, source)
    values (a1, o1, 'Interdit', '+21620009999', 'autre');
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  perform assert(ok, 'un compte en lecture seule ne crée pas de prospect');

  -- ---------------------------------------------------------------
  -- Ménage
  -- ---------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  delete from agencies where id in (a1, a2);
  delete from auth.users where id in (u_owner, u_agent, u_viewer, u_other);

  raise notice '--- banc du CRM : tout est vert ---';
end $$;
