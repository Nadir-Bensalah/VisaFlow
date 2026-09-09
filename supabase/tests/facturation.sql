-- Banc d'essai du cycle de vie de la facturation (migration 0066).
--
-- Ce qu'on vérifie, dans l'ordre où ça casse en vrai :
--   · une agence neuve est en essai, quinze jours, et son compte à rebours
--     descend jour après jour ;
--   · l'essai fini, la grâce s'ouvre, et l'agence travaille encore ;
--   · les avertissements partent à 5, 2 et 1 jour, une seule fois chacun ;
--   · la balayeuse ne suspend jamais sans avoir averti, jamais une agence qui
--     a payé, et jamais deux fois ;
--   · une suspension ne supprime rien, et un paiement la lève ;
--   · l'employé et le propriétaire d'une agence suspendue ne lisent pas le
--     même message, et ce sont des clés, pas des phrases ;
--   · une agence à jour n'a aucun bandeau ;
--   · et un compte d'agence n'enregistre pas de paiement, quoi qu'il tente.
--
-- Les dates sont posées à la main : on ne peut pas faire avancer l'horloge de
-- PostgreSQL, on fait donc reculer les échéances. C'est équivalent, et ça se
-- relit.

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
  v_admin uuid; v_ag uuid; v_ag2 uuid; v_ag3 uuid; v_ag4 uuid;
  v_off uuid; v_off2 uuid; v_owner uuid; v_agent uuid; v_owner2 uuid;
  n int; ok boolean; j jsonb; g jsonb; p jsonb;
  d_essai date; d_grace date; v_bal int;
  sfx text := substr(md5(random()::text), 1, 8);
begin
  insert into auth.users (id) values (gen_random_uuid()) returning id into v_admin;
  insert into platform_admins (id, name, email)
    values (v_admin, 'Banc Facturation', 'facturation@visaflow.test');
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- ---------------------------------------------------------------
  -- 1 · Une agence naît en essai de quinze jours
  -- ---------------------------------------------------------------
  set local role authenticated;
  v_ag := platform_create_agency('Banc Cycle', 'banc-cycle-' || sfx, 'Tunisie',
                                 'par_dossier', 8, 'Tunis');
  reset role;

  select trial_ends_on, grace_ends_on into d_essai, d_grace
    from subscriptions where agency_id = v_ag;

  perform assert((select billing_state from subscriptions where agency_id = v_ag) = 'essai',
                 'une agence neuve ouvre son cycle en essai');
  perform assert(d_essai = current_date + 15,
                 'l''essai dure quinze jours, pas trente');
  perform assert(d_grace = d_essai + 7,
                 'le délai de grâce suit l''essai, sept jours');

  -- La durée n'est pas écrite dans le code : elle vient de la grille.
  -- Adapté en 0070 : l'essai existe en deux devises, on lit la ligne TND.
  perform assert((select trial_days from plans where code = 'essai' and currency = 'TND') = 15,
                 'la durée de l''essai vit dans la grille, pas dans le code');
  perform assert((select grace_days from plans where code = 'essai' and currency = 'TND') = 7,
                 'la durée de grâce vit dans la grille aussi');

  j := agency_access_state(v_ag);
  perform assert(j ->> 'etat' = 'essai', 'l''état d''accès d''une agence neuve est l''essai');
  perform assert((j ->> 'jours_restants')::int = 15, 'le compte à rebours part de quinze');
  perform assert((j ->> 'echeance')::date = d_essai, 'l''échéance affichée est la fin de l''essai');
  perform assert(j ->> 'message_cle' = 'bill.trialLeft',
                 'le bandeau reçoit une clé de traduction, jamais une phrase');
  perform assert(j ->> 'severite' = 'info', 'quinze jours devant soi, c''est une information');
  perform assert(not (j ->> 'bloquant')::boolean, 'un essai ne bloque rien');

  -- ---------------------------------------------------------------
  -- 2 · Le compte à rebours descend, et le ton monte
  -- ---------------------------------------------------------------
  update subscriptions set trial_ends_on = current_date + 3 where agency_id = v_ag;
  j := agency_access_state(v_ag);
  perform assert((j ->> 'jours_restants')::int = 3, 'à trois jours, le compte à rebours dit trois');
  perform assert(j ->> 'severite' = 'attention', 'à trois jours, le ton passe à l''attention');

  update subscriptions set trial_ends_on = current_date + 1 where agency_id = v_ag;
  j := agency_access_state(v_ag);
  perform assert(j ->> 'message_cle' = 'bill.trialLast',
                 'le dernier jour a sa propre clé : « 1 jours » n''existe dans aucune langue');

  -- ---------------------------------------------------------------
  -- 3 · L'essai fini ouvre la grâce
  -- ---------------------------------------------------------------
  -- On recule les dates d'un jour au-delà de l'essai : c'est le J+16.
  update subscriptions set trial_ends_on = current_date - 1,
                           grace_ends_on = current_date + 6
   where agency_id = v_ag;

  -- L'écran anticipe la balayeuse : un client ne lit jamais « -1 jour d'essai ».
  j := agency_access_state(v_ag);
  perform assert(j ->> 'etat' = 'grace',
                 'un essai dont la date est passée s''affiche en grâce avant même la balayeuse');

  v_bal := billing_sweep();
  perform assert(v_bal >= 1, 'la balayeuse rend le nombre d''agences qu''elle a fait avancer');
  perform assert((select billing_state from subscriptions where agency_id = v_ag) = 'grace',
                 'la balayeuse fait passer l''essai fini en grâce');
  perform assert((select count(*) from subscription_events
                   where agency_id = v_ag and kind = 'entree_grace') = 1,
                 'l''entrée en grâce entre au journal');

  -- Pendant la grâce, l'agence TRAVAILLE encore. C'est la règle.
  perform assert(agency_has_feature(v_ag, 'VISA'),
                 'une agence en grâce travaille toujours');
  perform assert(not (agency_access_state(v_ag) ->> 'bloquant')::boolean,
                 'la grâce prévient, elle ne bloque pas');

  -- ---------------------------------------------------------------
  -- 4 · Les avertissements, à cinq, deux et un jour
  -- ---------------------------------------------------------------
  update subscriptions set grace_ends_on = current_date + 5 where agency_id = v_ag;
  perform billing_sweep();
  perform assert((select count(*) from subscription_events
                   where agency_id = v_ag and kind = 'avertissement'
                     and (detail ->> 'jours')::int = 5) = 1,
                 'l''avertissement part à cinq jours de la fin de grâce');

  -- Deux passages dans la même journée ne déposent qu'un avertissement.
  perform billing_sweep();
  perform assert((select count(*) from subscription_events
                   where agency_id = v_ag and kind = 'avertissement'
                     and (detail ->> 'jours')::int = 5) = 1,
                 'un deuxième passage ne redépose pas le même avertissement');

  update subscriptions set grace_ends_on = current_date + 2 where agency_id = v_ag;
  perform billing_sweep();
  perform assert((select count(*) from subscription_events
                   where agency_id = v_ag and kind = 'avertissement'
                     and (detail ->> 'jours')::int = 2) = 1,
                 'l''avertissement part à deux jours');
  perform assert((agency_access_state(v_ag) ->> 'severite') = 'critique',
                 'à deux jours de la coupure, le ton est critique');

  update subscriptions set grace_ends_on = current_date + 1 where agency_id = v_ag;
  perform billing_sweep();
  perform assert((select count(*) from subscription_events
                   where agency_id = v_ag and kind = 'avertissement'
                     and (detail ->> 'jours')::int = 1) = 1,
                 'l''avertissement part à un jour');
  perform assert((select count(*) from subscription_events
                   where agency_id = v_ag and kind = 'avertissement') = 3,
                 'trois avertissements sont partis, pas un de plus');

  -- ---------------------------------------------------------------
  -- 5 · La suspension, jamais sans avertissement
  -- ---------------------------------------------------------------
  -- La grâce est dépassée. Aucun avertissement n'existe pour CETTE échéance :
  -- la balayeuse avertit et reporte. C'est le garde-fou qui évite de couper un
  -- client parce que le serveur a dormi une semaine.
  update subscriptions set grace_ends_on = current_date - 1 where agency_id = v_ag;
  perform billing_sweep();
  perform assert((select billing_state from subscriptions where agency_id = v_ag) = 'grace',
                 'la balayeuse n''ose pas suspendre sans avertissement pour cette échéance');
  perform assert((select count(*) from subscription_events
                   where agency_id = v_ag and kind = 'avertissement'
                     and (detail ->> 'jours')::int = 0) = 1,
                 'elle dépose d''abord un dernier avertissement');

  -- Passage suivant : l'avertissement est au journal, la suspension tombe.
  perform billing_sweep();
  perform assert((select billing_state from subscriptions where agency_id = v_ag) = 'suspendue',
                 'grâce dépassée et avertissement donné : la balayeuse suspend');
  perform assert((select status from subscriptions where agency_id = v_ag) = 'suspendue',
                 'le droit de faire suit l''état du cycle');
  perform assert((select suspended_on from subscriptions where agency_id = v_ag) = current_date,
                 'la suspension est datée du jour');
  perform assert((select suspend_reason from subscriptions where agency_id = v_ag) = 'grace_depassee',
                 'le motif de la suspension est écrit');
  perform assert((select suspended_at from agencies where id = v_ag) is not null,
                 'l''agence porte sa suspension');
  perform assert((select count(*) from subscription_events
                   where agency_id = v_ag and kind = 'suspendue') = 1,
                 'la suspension entre au journal');

  -- RIEN N'EST SUPPRIMÉ. C'est tout l'intérêt de la suspension.
  perform assert((select count(*) from agencies where id = v_ag) = 1,
                 'l''agence suspendue existe toujours');
  perform assert((select deleted_at from agencies where id = v_ag) is null,
                 'suspendre n''est pas supprimer');
  perform assert((select count(*) from offices where agency_id = v_ag) >= 1,
                 'les bureaux de l''agence suspendue sont intacts');

  j := agency_access_state(v_ag);
  perform assert(j ->> 'etat' = 'suspendue', 'l''état d''accès d''une agence suspendue est la suspension');
  perform assert((j ->> 'bloquant')::boolean, 'une agence suspendue est bloquante');
  perform assert(j ->> 'severite' = 'critique', 'une suspension est critique');
  perform assert(j ->> 'message_cle' = 'bill.suspended', 'la suspension a sa clé');
  perform assert(not agency_has_feature(v_ag, 'VISA'),
                 'une agence suspendue ne travaille plus');

  -- ---------------------------------------------------------------
  -- 6 · La balayeuse est idempotente
  -- ---------------------------------------------------------------
  perform billing_sweep();
  perform billing_sweep();
  perform assert((select count(*) from subscription_events
                   where agency_id = v_ag and kind = 'suspendue') = 1,
                 'deux passages de plus ne suspendent pas une deuxième fois');
  perform assert((select suspended_on from subscriptions where agency_id = v_ag) = current_date,
                 'la date de suspension n''est pas réécrite à chaque passage');

  -- ---------------------------------------------------------------
  -- 7 · Le mur : l'employé et le propriétaire ne lisent pas la même chose
  -- ---------------------------------------------------------------
  select id into v_off from offices where agency_id = v_ag limit 1;
  insert into auth.users (id) values (gen_random_uuid()) returning id into v_owner;
  insert into profiles (id, agency_id, office_id, name, role)
    values (v_owner, v_ag, v_off, 'Slim', 'owner');
  insert into auth.users (id) values (gen_random_uuid()) returning id into v_agent;
  insert into profiles (id, agency_id, office_id, name, role)
    values (v_agent, v_ag, v_off, 'Amira', 'agent');

  perform test_login(v_agent, v_ag, 'agent', v_off);
  set local role authenticated;
  g := agency_gate();
  ok := auth_agency_blocked();
  reset role;
  perform assert((g ->> 'bloquant')::boolean, 'l''employé d''une agence suspendue est bloqué');
  perform assert(g ->> 'role' = 'agent', 'le mur sait à qui il parle');
  perform assert(g ->> 'message_cle' = 'bill.wallStaff',
                 'l''employé lit le message de l''employé');
  perform assert(g ->> 'contact' is null,
                 'l''employé ne reçoit pas l''adresse du service facturation');
  perform assert(ok, 'auth_agency_blocked dit vrai pour l''employé');

  perform test_login(v_owner, v_ag, 'owner', v_off);
  set local role authenticated;
  g := agency_gate();
  reset role;
  perform assert((g ->> 'bloquant')::boolean, 'le propriétaire est bloqué lui aussi');
  perform assert(g ->> 'message_cle' = 'bill.wallOwner',
                 'le propriétaire lit le message du propriétaire');
  perform assert(g ->> 'contact' = 'contact@capmedia.tn',
                 'le propriétaire reçoit l''adresse du service facturation');

  -- Le bandeau se voit par TOUS les comptes de l'agence, pas par le seul
  -- propriétaire : c'est la raison d'être de la fonction.
  perform test_login(v_agent, v_ag, 'agent', v_off);
  set local role authenticated;
  j := agency_access_state(v_ag);
  reset role;
  perform assert(j ->> 'etat' = 'suspendue',
                 'un simple agent lit l''état de facturation de son agence');

  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- ---------------------------------------------------------------
  -- 8 · Un paiement après suspension réactive l'agence
  -- ---------------------------------------------------------------
  set local role authenticated;
  -- Adapté en 0070 : le montant est celui du socle Active, 179 × 12.
  p := platform_record_payment(v_ag, 179 * 12, 'TND',
         current_date, (current_date + interval '1 year' - interval '1 day')::date,
         'virement', 'VIR-' || sfx, 'Virement reçu le jour même.');
  reset role;

  perform assert((p ->> 'ok')::boolean, 'le paiement est enregistré');
  perform assert((p ->> 'reactivee')::boolean, 'le paiement réactive une agence suspendue');
  perform assert((select suspended_at from agencies where id = v_ag) is null,
                 'l''agence est rouverte');
  perform assert((select billing_state from subscriptions where agency_id = v_ag) = 'a_jour',
                 'l''agence repasse à jour');
  perform assert((select last_payment_on from subscriptions where agency_id = v_ag) = current_date,
                 'la date du dernier règlement est posée');
  perform assert((select suspended_on from subscriptions where agency_id = v_ag) is null,
                 'la trace de suspension est levée, le journal la garde');
  perform assert((select count(*) from subscription_events
                   where agency_id = v_ag and kind = 'reactivee') = 1,
                 'la réactivation entre au journal');
  perform assert((select count(*) from subscription_events
                   where agency_id = v_ag and kind = 'paiement') = 1,
                 'le règlement entre au journal');
  perform assert(agency_has_feature(v_ag, 'VISA'),
                 'l''agence réactivée retrouve son outil');

  -- ---------------------------------------------------------------
  -- 9 · Une agence à jour n'a aucun bandeau
  -- ---------------------------------------------------------------
  j := agency_access_state(v_ag);
  perform assert(j ->> 'etat' = 'a_jour', 'l''agence qui a payé est à jour');
  perform assert(j ->> 'message_cle' is null,
                 'une agence à jour n''a rien à lire : pas de bandeau');
  perform assert(not (j ->> 'bloquant')::boolean, 'et rien ne la bloque');

  perform test_login(v_owner, v_ag, 'owner', v_off);
  set local role authenticated;
  g := agency_gate();
  reset role;
  perform assert(not (g ->> 'bloquant')::boolean, 'le mur laisse passer une agence à jour');
  perform assert(g ->> 'message_cle' is null, 'et il n''a rien à dire');
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- Le même règlement saisi deux fois est refusé : une référence de virement
  -- ne vaut qu'une fois.
  ok := false;
  set local role authenticated;
  begin
    perform platform_record_payment(v_ag, 100, 'TND', null, null, 'virement', 'VIR-' || sfx);
  exception when others then ok := true;
  end;
  reset role;
  perform assert(ok, 'le même virement ne s''enregistre pas deux fois');

  -- ---------------------------------------------------------------
  -- 10 · Un paiement pendant la grâce empêche la suspension
  -- ---------------------------------------------------------------
  set local role authenticated;
  v_ag2 := platform_create_agency('Banc Payée', 'banc-payee-' || sfx, 'Tunisie',
                                  'par_dossier', 8, 'Sfax');
  reset role;

  -- On la met en grâce dépassée, avec un avertissement au journal : tout est
  -- réuni pour qu'elle soit suspendue au prochain passage.
  update subscriptions set billing_state = 'grace',
                           trial_ends_on = current_date - 8,
                           grace_ends_on = current_date - 1
   where agency_id = v_ag2;
  insert into subscription_events (agency_id, subscription_id, kind, detail)
  select v_ag2, id, 'avertissement',
         jsonb_build_object('jours', 1, 'echeance', (current_date - 1)::text)
    from subscriptions where agency_id = v_ag2;

  set local role authenticated;
  perform platform_record_payment(v_ag2, 179 * 12, 'TND', null, null,
                                  'virement', 'VIR2-' || sfx);
  reset role;

  perform billing_sweep();
  perform assert((select billing_state from subscriptions where agency_id = v_ag2) = 'a_jour',
                 'un paiement enregistré pendant la grâce empêche la suspension');
  perform assert((select suspended_at from agencies where id = v_ag2) is null,
                 'et l''agence n''est jamais coupée');

  -- Le garde-fou du dernier recours : même remise de force en grâce dépassée,
  -- une agence dont le règlement est postérieur au début de la grâce n'est pas
  -- suspendue. C'est le cas du virement vu en retard.
  update subscriptions set billing_state = 'grace',
                           grace_ends_on = current_date - 1,
                           last_payment_on = current_date
   where agency_id = v_ag2;
  perform billing_sweep();
  perform assert((select billing_state from subscriptions where agency_id = v_ag2) = 'grace',
                 'un règlement postérieur au début de la grâce protège l''agence');
  perform assert((select suspended_on from subscriptions where agency_id = v_ag2) is null,
                 'elle n''est pas suspendue, même avec la grâce derrière elle');

  -- ---------------------------------------------------------------
  -- 11 · L'échéance passée d'une agence à jour ouvre l'impayé
  -- ---------------------------------------------------------------
  set local role authenticated;
  v_ag3 := platform_create_agency('Banc Renouv', 'banc-renouv-' || sfx, 'Tunisie',
                                  'par_dossier', 8, 'Sousse');
  perform platform_set_subscription(v_ag3, 'active', null, (current_date - 1)::date, 'active');
  reset role;

  perform assert((select billing_state from subscriptions where agency_id = v_ag3) = 'a_jour',
                 'un abonnement posé « actif » depuis la console est à jour pour le cycle');

  perform billing_sweep();
  perform assert((select billing_state from subscriptions where agency_id = v_ag3) = 'impayee',
                 'une échéance passée ouvre l''impayé, pas la coupure');
  perform assert(agency_has_feature(v_ag3, 'VISA'),
                 'une agence impayée travaille encore : c''est la suspension qui coupe');
  perform assert((select grace_ends_on from subscriptions where agency_id = v_ag3)
                 = current_date - 1 + 7,
                 'la grâce se rouvre à partir de l''échéance');

  -- ---------------------------------------------------------------
  -- 12 · Le tableau de la console, trié par urgence
  -- ---------------------------------------------------------------
  set local role authenticated;
  j := platform_billing_board();
  reset role;
  perform assert(jsonb_array_length(j) >= 3, 'le tableau liste les agences');
  perform assert(exists (select 1 from jsonb_array_elements(j) e
                          where (e ->> 'agency_id')::uuid = v_ag3
                            and (e ->> 'montant_attendu')::numeric = 179 * 12),
                 'chaque ligne porte le montant attendu : le socle Active × 12 mois (adapté en 0070)');
  perform assert(exists (select 1 from jsonb_array_elements(j) e
                          where (e ->> 'agency_id')::uuid = v_ag
                            and (e ->> 'dernier_paiement')::date = current_date
                            and (e ->> 'sieges')::int >= 1),
                 'chaque ligne porte le dernier paiement et les sièges');

  -- L'urgence commande l'ordre : on suspend une agence de test et on vérifie
  -- qu'elle remonte en tête.
  set local role authenticated;
  v_ag4 := platform_create_agency('Banc Coupée', 'banc-coupee-' || sfx, 'Tunisie',
                                  'par_dossier', 8, 'Gabès');
  reset role;
  update subscriptions set billing_state = 'suspendue', status = 'suspendue',
                           suspended_on = current_date, suspend_reason = 'grace_depassee'
   where agency_id = v_ag4;
  update agencies set suspended_at = now() where id = v_ag4;

  set local role authenticated;
  j := platform_billing_board();
  reset role;
  perform assert((j -> 0 ->> 'etat') = 'suspendue',
                 'les suspendues passent en tête du tableau');
  perform assert((j -> 0 ->> 'bloquant')::boolean,
                 'et la console voit qu''elles sont bloquantes');

  -- ---------------------------------------------------------------
  -- 13 · Ce qu'un compte d'agence ne peut pas faire
  -- ---------------------------------------------------------------
  perform test_login(v_owner, v_ag, 'owner', v_off);
  set local role authenticated;

  ok := false;
  begin
    perform platform_record_payment(v_ag, 1000, 'TND');
  exception when others then ok := true;
  end;
  perform assert(ok, 'un compte d''agence n''enregistre pas un paiement');

  ok := false;
  begin
    perform platform_billing_board();
  exception when others then ok := true;
  end;
  perform assert(ok, 'un compte d''agence ne lit pas le tableau de facturation');

  ok := false;
  begin
    perform billing_sweep();
  exception when others then ok := true;
  end;
  perform assert(ok, 'un compte d''agence ne déclenche pas la balayeuse');

  -- Et il ne lit pas l'état de facturation du voisin.
  j := agency_access_state(v_ag3);
  perform assert(j ->> 'etat' = 'a_jour' and not (j ->> 'bloquant')::boolean
                 and j ->> 'message_cle' is null,
                 'une agence ne lit pas l''état de facturation d''une autre');

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- ---------------------------------------------------------------
  -- 13 bis · Rouvrir sans encaisser
  -- ---------------------------------------------------------------
  set local role authenticated;
  p := platform_reactivate_agency(v_ag4, 'Virement annoncé, référence à venir.');
  reset role;
  perform assert((p ->> 'ok')::boolean, 'la plateforme peut rouvrir une agence sans encaisser');
  perform assert((select suspended_at from agencies where id = v_ag4) is null,
                 'la réouverture lève la suspension de l''agence');
  perform assert((select billing_state from subscriptions where agency_id = v_ag4) = 'grace',
                 'rouvrir sans règlement remet en grâce, pas à jour : rien n''a été payé');
  perform assert((select grace_ends_on from subscriptions where agency_id = v_ag4)
                 = current_date + 7,
                 'la grâce repart pour sept jours à compter d''aujourd''hui');
  perform assert(not (agency_access_state(v_ag4) ->> 'bloquant')::boolean,
                 'et le mur laisse repasser l''agence');

  -- ---------------------------------------------------------------
  -- 14 · Rien n'a été supprimé, nulle part
  -- ---------------------------------------------------------------
  select count(*) into n from agencies
   where id in (v_ag, v_ag2, v_ag3, v_ag4) and deleted_at is null;
  perform assert(n = 4, 'les quatre agences du banc sont toujours là, aucune supprimée');

  raise notice '--- banc du cycle de facturation : tout est vert ---';
end $$;
