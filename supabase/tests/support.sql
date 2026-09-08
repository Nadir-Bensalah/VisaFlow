-- Banc d'essai du support et du démarrage (migration 0056).
--
-- Ce banc garde quatre promesses qu'on ne peut pas vérifier à l'œil :
--   1. une étape de démarrage se coche TOUTE SEULE quand la donnée existe ;
--   2. une agence de visas ne voit jamais un écran de fret, et l'inverse ;
--   3. le ticket d'une agence est invisible pour l'agence d'à côté ;
--   4. le tableau des idées ne révèle JAMAIS l'agence d'origine.
--
-- La quatrième est la plus facile à casser sans s'en apercevoir : il suffit
-- d'ajouter un champ au jsonb rendu par `feedback_board`. On vérifie donc les
-- CLÉS du jsonb, pas seulement ses valeurs.

\set ON_ERROR_STOP on
set search_path = public;

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then raise notice 'OK    %', label;
  else raise exception 'ÉCHEC %', label; end if;
end $$;

create or replace function _sup_login(p_user uuid, p_agency uuid, p_role text, p_office uuid)
returns void language plpgsql as $$
declare c jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  c := jsonb_build_object('sub', p_user, 'agency_role', coalesce(p_role, 'owner'),
                          'office_id', coalesce(p_office::text, ''));
  -- Une agence nulle (le compte de la plateforme) ne pose pas la revendication :
  -- poser une chaîne vide ferait croire à une agence.
  if p_agency is not null then c := c || jsonb_build_object('agency_id', p_agency); end if;
  perform set_config('request.jwt.claims', c::text, true);
end $$;

do $$
declare
  ag_v uuid; ag_f uuid; o_v uuid; o_f uuid;
  u_v uuid; u_v2 uuid; u_f uuid; u_admin uuid;
  cl uuid; tk uuid; tk_f uuid; fb uuid; an_all uuid; an_one uuid; an_draft uuid;
  d jsonb; e jsonb; n int; p1 int; p2 int;
begin
  -- ---------------------------------------------------------------
  -- Le décor : une agence de visas, une agence de fret, un admin
  -- ---------------------------------------------------------------
  insert into agencies (slug, name, services) values ('supvisa', 'Banc Visas', '{visas}') returning id into ag_v;
  insert into agencies (slug, name, services) values ('supfret', 'Banc Fret', '{fret}') returning id into ag_f;

  insert into offices (agency_id, name, country, country_code) values (ag_v, 'Tunis', 'Tunisie', 'TN') returning id into o_v;
  insert into offices (agency_id, name, country, country_code) values (ag_f, 'Sfax', 'Tunisie', 'TN') returning id into o_f;

  insert into auth.users (id) values (gen_random_uuid()) returning id into u_v;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_v2;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_f;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_admin;

  insert into profiles (id, agency_id, office_id, name, email, role) values
    (u_v,  ag_v, o_v, 'Slim',  'slim@supvisa.test',  'owner'),
    (u_v2, ag_v, o_v, 'Amira', 'amira@supvisa.test', 'agent'),
    (u_f,  ag_f, o_f, 'Hatem', 'hatem@supfret.test', 'owner');

  insert into platform_admins (id, name, email, superuser)
  values (u_admin, 'Nadir', 'nadir@visaflow.test', true);

  -- ===============================================================
  -- 1 · LE DÉMARRAGE
  -- ===============================================================
  perform _sup_login(u_v, ag_v, 'owner', o_v);

  d := onboarding_state();
  perform assert(jsonb_array_length(d -> 'steps') = 8, 'le démarrage compte huit étapes');
  perform assert((d ->> 'total')::int = 8, 'et le total les compte toutes');

  -- L'étape « premier client » n'est pas faite : aucun client n'existe.
  perform assert(not (d #> '{steps,6}' ->> 'done')::boolean, 'sans client, l''étape du premier client n''est pas faite');
  p1 := (d ->> 'percent')::int;

  -- On crée un client. PERSONNE ne coche quoi que ce soit.
  insert into clients (agency_id, office_id, first_name, last_name, phone)
  values (ag_v, o_v, 'Mohamed', 'Trabelsi', '+21620000001') returning id into cl;

  d := onboarding_state();
  perform assert((d #> '{steps,6}' ->> 'done')::boolean,
    'créer un client coche l''étape toute seule : on ne fait pas cocher ce qui est déjà fait');
  perform assert((d #> '{steps,6}' ->> 'auto')::boolean,
    'et la coche se dit « déduite », pour que l''écran n''offre pas un bouton inutile');
  p2 := (d ->> 'percent')::int;
  perform assert(p2 > p1, 'le pourcentage d''avancement monte avec la donnée (' || p1 || ' puis ' || p2 || ')');

  -- Le premier dossier suit la même règle, et il compte pour les deux métiers.
  perform assert(not (d #> '{steps,7}' ->> 'done')::boolean, 'sans dossier, l''étape du premier dossier reste ouverte');
  perform assert((d ->> 'current') is not null, 'tant qu''il reste une étape, il y a une étape en cours');

  -- Le clic reste utile pour ce qu'aucune donnée ne trahit.
  set local role authenticated;
  d := onboarding_complete('prix');
  reset role;
  perform assert((d #> '{steps,4}' ->> 'done')::boolean, 'une étape se coche aussi à la main');

  -- L'équipe, elle, se déduit : deux comptes actifs, donc l'étape est faite.
  perform assert((d #> '{steps,2}' ->> 'done')::boolean,
    'un deuxième compte dans l''agence coche l''étape de l''équipe, sans clic');

  -- Passer n'est pas faire : les deux se comptent à part. Le bureau n'a pas
  -- d'adresse, donc rien ne le coche tout seul : c'est le bon cobaye.
  set local role authenticated;
  d := onboarding_skip('bureau');
  reset role;
  perform assert((d #> '{steps,1}' ->> 'skipped')::boolean, 'une étape peut être passée');
  perform assert(not (d #> '{steps,1}' ->> 'done')::boolean, 'passer une étape n''est pas la faire');
  perform assert((d ->> 'skipped')::int = 1, 'et les étapes passées se comptent à part');
  perform assert((d ->> 'current') <> 'bureau', 'l''étape passée n''est plus l''étape en cours');
  perform assert(not (d -> 'remaining' ? 'bureau'), 'ni ce qui reste à faire');

  -- Ranger la carte écrit dans l'ANCIENNE colonne : le magasin la lit déjà.
  set local role authenticated;
  perform onboarding_hide(true);
  reset role;
  perform assert((select setup_hidden from agencies where id = ag_v),
    'ranger la carte d''accueil écrit dans agencies.setup_hidden, la colonne d''origine');
  perform assert((onboarding_state() ->> 'hidden')::boolean, 'et l''état le dit');

  -- On ne regarde pas le démarrage de l'agence d'à côté.
  begin
    d := onboarding_state(ag_f);
    perform assert(false, 'on ne lit pas le démarrage d''une autre agence');
  exception when insufficient_privilege then
    perform assert(true, 'on ne lit pas le démarrage d''une autre agence');
  end;

  -- ===============================================================
  -- 2 · LE CHOIX D'ACTIVITÉ
  -- ===============================================================
  d := agency_modules();
  perform assert((d #> '{modules,dossiers}')::text = 'true', 'une agence de visas voit les dossiers');
  perform assert((d #> '{modules,creneaux}')::text = 'true', 'et les créneaux consulaires');
  perform assert((d #> '{modules,cargaisons}')::text = 'false',
    'une agence de visas ne voit AUCUN écran de fret : cargaisons');
  perform assert((d #> '{modules,douane}')::text = 'false', 'ni la douane');
  perform assert((d #> '{modules,entrepots}')::text = 'false', 'ni les entrepôts');
  perform assert((d ->> 'visas')::boolean and not (d ->> 'fret')::boolean, 'et son métier est dit tel quel');

  perform _sup_login(u_f, ag_f, 'owner', o_f);
  d := agency_modules();
  perform assert((d #> '{modules,cargaisons}')::text = 'true', 'une agence de fret voit les cargaisons');
  perform assert((d #> '{modules,dossiers}')::text = 'false', 'et ne voit aucun écran de visa : dossiers');
  perform assert((d #> '{modules,creneaux}')::text = 'false', 'ni les créneaux consulaires');
  perform assert((d #> '{modules,clients}')::text = 'true', 'le tronc commun reste ouvert aux deux métiers');

  -- ===============================================================
  -- 3 · LE SUPPORT
  -- ===============================================================
  perform _sup_login(u_v, ag_v, 'owner', o_v);
  set local role authenticated;
  tk := support_open('anomalie', 'haute', 'Le portail ne répond pas',
                     'Depuis ce matin, les clients ont une page blanche.');
  reset role;
  perform assert(tk is not null, 'une agence ouvre un ticket');

  select count(*) into n from support_messages where ticket_id = tk;
  perform assert(n = 1, 'et le premier message ouvre le fil : sans lui la réponse arriverait sans la question');

  perform _sup_login(u_f, ag_f, 'owner', o_f);
  set local role authenticated;
  tk_f := support_open('question', 'normale', 'Ajouter un transporteur', 'Comment ajouter CMA CGM ?');
  select count(*) into n from support_tickets;
  reset role;
  perform assert(n = 1, 'le ticket d''une agence est invisible pour l''agence d''à côté');

  set local role authenticated;
  select count(*) into n from support_messages;
  reset role;
  perform assert(n = 1, 'et son fil aussi : la question elle-même ne fuit pas');

  -- Répondre au ticket d'une autre agence est refusé, même en connaissant l'id.
  set local role authenticated;
  begin
    perform support_reply(tk, 'Bonjour, je regarde chez vous.');
    reset role;
    perform assert(false, 'on ne répond pas dans le ticket d''une autre agence');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'on ne répond pas dans le ticket d''une autre agence, même en connaissant son identifiant');
  end;

  -- La plateforme, elle, voit les deux.
  perform _sup_login(u_admin, null, null, null);
  set local role authenticated;
  select count(*) into n from support_tickets;
  d := platform_tickets(null);
  reset role;
  perform assert(n = 2, 'la plateforme voit les tickets des deux agences');
  perform assert(jsonb_array_length(d) = 2, 'et la boîte de réception les rend tous les deux');
  perform assert((d #>> '{0,priority}') = 'haute', 'l''urgent remonte en tête de file, pas le plus ancien');
  perform assert((d #>> '{0,agency_name}') = 'Banc Visas', 'le nom de l''agence accompagne le ticket');

  -- Ce que la boîte de réception ne contient pas : la donnée de l'agence.
  -- Le support répond à une question ; pour regarder le dossier il passe par
  -- la vue support de 0028, et l'ouverture y est journalisée.
  perform assert(not (d -> 0 ? 'clients') and not (d -> 0 ? 'cases'),
    'le ticket ne donne aucun accès aux données de l''agence');

  set local role authenticated;
  perform platform_ticket_reply(tk, 'Bonjour, nous regardons. Pouvez-vous nous dire depuis quelle heure ?');
  reset role;
  select status into d from (select to_jsonb(status) as status from support_tickets where id = tk) x;
  perform assert(d #>> '{}' = 'pris_en_charge', 'répondre prend le ticket en charge, sans geste en plus');

  select count(*) into n from support_messages where ticket_id = tk;
  perform assert(n = 2, 'le fil garde les deux sens');

  set local role authenticated;
  perform platform_ticket_status(tk, 'resolu');
  reset role;
  perform assert((select resolved_at is not null from support_tickets where id = tk),
    'clore un ticket pose sa date de résolution');

  -- L'agence répond après coup : le ticket rouvre, et la date part.
  perform _sup_login(u_v, ag_v, 'owner', o_v);
  set local role authenticated;
  perform support_reply(tk, 'Non, ce n''est pas réglé.');
  d := support_my_tickets();
  reset role;
  perform assert((select status = 'ouvert' and resolved_at is null from support_tickets where id = tk),
    'une agence qui répond rouvre son ticket : un ticket refermé trop vite ne se perd pas');
  perform assert(jsonb_array_length(d) = 1, 'une agence ne relit que ses propres tickets');
  perform assert(jsonb_array_length(d #> '{0,thread}') = 3, 'avec tout son fil');

  -- Une agence n'ouvre pas la boîte de réception de la plateforme.
  set local role authenticated;
  begin
    d := platform_tickets(null);
    reset role;
    perform assert(false, 'une agence n''ouvre pas la boîte de réception de la plateforme');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'une agence n''ouvre pas la boîte de réception de la plateforme');
  end;

  -- ===============================================================
  -- 4 · LES ANNONCES
  -- ===============================================================
  perform _sup_login(u_admin, null, null, null);
  set local role authenticated;
  an_all := platform_save_announcement(null, 'maintenance',
    '{"fr":"Coupure samedi","en":"Saturday maintenance","ar":"صيانة السبت","zh":"周六维护"}'::jsonb,
    '{"fr":"De 22 h à minuit."}'::jsonb, 'attention', now() - interval '1 hour', null, 'toutes', null);
  an_one := platform_save_announcement(null, 'pays',
    '{"fr":"Consulat de France fermé"}'::jsonb, '{}'::jsonb, 'critique',
    now() - interval '1 hour', null, 'une_agence', ag_v);
  an_draft := platform_save_announcement(null, 'nouveaute',
    '{"fr":"Brouillon"}'::jsonb, '{}'::jsonb, 'info', now() - interval '1 hour', null, 'toutes', null);
  perform platform_publish_announcement(an_all, true);
  perform platform_publish_announcement(an_one, true);
  reset role;

  perform _sup_login(u_v, ag_v, 'owner', o_v);
  d := active_announcements();
  perform assert(jsonb_array_length(d) = 2, 'l''agence visée voit l''annonce générale et la sienne');
  perform assert((d #>> '{0,severity}') = 'critique', 'et le plus grave passe devant');

  perform _sup_login(u_f, ag_f, 'owner', o_f);
  d := active_announcements();
  perform assert(jsonb_array_length(d) = 1, 'une annonce ciblée n''apparaît qu''à sa cible');
  perform assert((d #>> '{0,id}') = an_all::text, 'et c''est bien la générale qui reste');
  perform assert(not (d #> '{0,read}')::boolean, 'une annonce jamais ouverte est non lue');

  set local role authenticated;
  perform announcement_read(an_all);
  reset role;
  perform assert((active_announcements() #> '{0,read}')::text = 'true', 'la lire la marque lue');

  -- Un brouillon ne sort pas de la console.
  perform assert(not exists (
    select 1 from jsonb_array_elements(active_announcements()) x where x ->> 'id' = an_draft::text),
    'un brouillon non publié n''est vu par personne');

  -- ===============================================================
  -- 5 · LES RETOURS
  -- ===============================================================
  perform _sup_login(u_v, ag_v, 'owner', o_v);
  set local role authenticated;
  fb := feedback_send('idee', 'Pouvoir imprimer la liste des rendez-vous du jour.', '/rendez-vous');
  reset role;

  -- L'agence d'à côté ne lit PAS la ligne. Pas de repli, pas de fuite.
  perform _sup_login(u_f, ag_f, 'owner', o_f);
  set local role authenticated;
  select count(*) into n from feedback;
  d := feedback_board(null);
  reset role;
  perform assert(n = 0, 'une agence ne lit pas la table des retours d''une autre');
  perform assert(jsonb_array_length(d) = 1, 'mais elle voit l''idée dans le tableau des idées');

  -- Le point le plus facile à casser sans s'en apercevoir : une clé de trop.
  e := d -> 0;
  perform assert(not (e ? 'agency_id'), 'le tableau des idées ne rend pas l''agence d''origine');
  perform assert(not (e ? 'user_id'), 'ni son auteur');
  perform assert(not (e ? 'page'),
    'ni la page d''où part le retour : elle dit souvent quel métier fait l''agence');
  perform assert(not (e ? 'agency_name'), 'ni le nom de l''agence, sous aucun autre nom');
  perform assert(not (e ->> 'mine')::boolean, 'et l''agence sait seulement que ce n''est pas le sien');

  -- Un vote, une agence. Deux personnes de la même agence ne pèsent pas deux.
  set local role authenticated;
  n := feedback_vote(fb);
  reset role;
  perform assert(n = 1, 'une agence vote pour l''idée d''une autre');

  perform _sup_login(u_f, ag_f, 'agent', o_f);
  set local role authenticated;
  n := feedback_vote(fb);
  reset role;
  perform assert(n = 1, 'un vote ne compte qu''une fois par agence, même à deux comptes');

  perform _sup_login(u_v, ag_v, 'owner', o_v);
  set local role authenticated;
  n := feedback_vote(fb);
  d := feedback_board(null);
  reset role;
  perform assert(n = 2, 'une deuxième agence ajoute une voix');
  perform assert((d #> '{0,votes}')::text = '2', 'et le tableau montre le compte recalculé');
  perform assert((d #> '{0,voted}')::text = 'true', 'chacun sait s''il a déjà voté');

  -- La plateforme, elle, voit l'origine : elle n'est pas concurrente.
  perform _sup_login(u_admin, null, null, null);
  set local role authenticated;
  d := platform_feedback(null);
  perform platform_feedback_handle(fb, 'planifie', 'Prévu pour la version de novembre.');
  reset role;
  perform assert((d #>> '{0,agency_name}') = 'Banc Visas',
    'la plateforme voit l''origine du retour : elle n''est pas concurrente des agences');
  perform assert((select status = 'planifie' and response is not null from feedback where id = fb),
    'et elle répond publiquement à l''idée');

  -- Ménage.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  delete from announcements where id in (an_all, an_one, an_draft);
  delete from agencies where id in (ag_v, ag_f);
  delete from platform_admins where id = u_admin;
  delete from auth.users where id in (u_v, u_v2, u_f, u_admin);
  raise notice '--- banc du support et du démarrage : tout est vert ---';
end $$;

drop function _sup_login(uuid, uuid, text, uuid);
