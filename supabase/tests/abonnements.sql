-- Banc d'essai de l'abonnement et des quotas (migration 0049).
--
-- Ce qu'on vérifie, dans l'ordre où ça casse en vrai :
--   · une agence naît avec son essai, sa ligne de consommation et son journal ;
--   · le premier bureau et le premier compte passent TOUJOURS, même quota nul,
--     sinon `platform_create_agency` ne peut plus créer personne ;
--   · le garde refuse le bureau de trop, et il refuse AVANT, pas après ;
--   · la facture se calcule en sièges × 45 DT × 12, jamais en forfait ;
--   · une agence en essai a tout, une agence suspendue n'a rien ;
--   · et une agence ne change pas son propre plan, quoi qu'elle tente.

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
  v_admin uuid; v_ag uuid; v_ag2 uuid; v_ag3 uuid;
  v_off uuid; v_owner uuid; v_u2 uuid; v_u3 uuid; v_u4 uuid; v_ag3_never uuid;
  n int; ok boolean; j jsonb; q jsonb; m numeric;
  sfx text := substr(md5(random()::text), 1, 8);
begin
  -- Un super-admin de plateforme, posé pour le banc.
  insert into auth.users (id) values (gen_random_uuid()) returning id into v_admin;
  insert into platform_admins (id, name, email) values (v_admin, 'Banc Abo', 'abo@visaflow.test');
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- ---------------------------------------------------------------
  -- 1 · Créer une agence, c'est ouvrir son essai
  -- ---------------------------------------------------------------
  set local role authenticated;
  v_ag := platform_create_agency('Banc Abonnement', 'banc-abo-' || sfx, 'Tunisie', 'par_dossier', 8, 'Tunis');
  reset role;

  select count(*) into n from subscriptions where agency_id = v_ag and status = 'essai';
  perform assert(n = 1, 'créer une agence crée sa souscription d''essai');

  select count(*) into n from usage_counters where agency_id = v_ag;
  perform assert(n = 1, 'créer une agence crée sa ligne de consommation');

  select count(*) into n from subscription_events where agency_id = v_ag and kind = 'creee';
  perform assert(n = 1, 'l''ouverture de l''essai entre au journal');

  select count(*) into n from offices where agency_id = v_ag;
  perform assert(n = 1, 'le premier bureau est passé malgré le garde');

  j := agency_plan(v_ag);
  perform assert(j ->> 'code' = 'essai', 'le plan effectif d''une agence neuve est l''essai');
  perform assert(j -> 'limits' ->> 'offices' is null, 'l''essai n''est pas bridé en volume (null = illimité)');
  perform assert((j ->> 'renewal_on')::date > current_date, 'l''essai porte une échéance dans le futur');

  -- Une agence en essai a TOUT, y compris la marque blanche.
  perform assert(agency_has_feature(v_ag, 'WHITE_LABEL'), 'une agence en essai a tout');
  perform assert(subscription_invoice_amount(v_ag) = 0, 'un essai ne doit rien');

  -- ---------------------------------------------------------------
  -- 2 · La consommation se recompte
  -- ---------------------------------------------------------------
  select id into v_off from offices where agency_id = v_ag limit 1;
  insert into auth.users (id) values (gen_random_uuid()) returning id into v_owner;
  insert into profiles (id, agency_id, office_id, name, role) values (v_owner, v_ag, v_off, 'Slim', 'owner');
  insert into auth.users (id) values (gen_random_uuid()) returning id into v_u2;
  insert into profiles (id, agency_id, office_id, name, role) values (v_u2, v_ag, v_off, 'Amira', 'manager');
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (v_ag, v_off, 'Mohamed', 'Bouazizi', '+216 20 000 ' || substr(sfx, 1, 3));

  perform refresh_usage(v_ag);
  select * into j from (select to_jsonb(u) from usage_counters u where u.agency_id = v_ag) t(to_jsonb);
  perform assert((j ->> 'offices_count')::int = 1, 'la consommation compte un bureau');
  perform assert((j ->> 'users_count')::int = 2, 'la consommation compte deux comptes');
  perform assert((j ->> 'clients_count')::int = 1, 'la consommation compte un client');
  perform assert((j ->> 'computed_at') is not null, 'la consommation est horodatée');

  -- ---------------------------------------------------------------
  -- 3 · Passer au payant : le plan, la facture, les fonctionnalités
  -- ---------------------------------------------------------------
  set local role authenticated;
  j := platform_set_subscription(v_ag, 'starter', 3, (current_date + 365)::date, 'active');
  reset role;

  perform assert(j ->> 'code' = 'starter', 'la plateforme pose le plan Starter');
  perform assert((j ->> 'seats')::int = 3, 'les sièges signés sont ceux qu''on a demandés');
  perform assert((j ->> 'price_per_user_month')::numeric = 45, 'le prix reste 45 DT par utilisateur et par mois');

  select count(*) into n from subscription_events where agency_id = v_ag and kind = 'changement_plan';
  perform assert(n = 1, 'le changement de plan entre au journal');

  -- LA ligne de facture : quantifiable, jamais un forfait.
  m := subscription_invoice_amount(v_ag);
  perform assert(m = 3 * 45 * 12, 'le montant annuel est sièges × 45 DT × 12 mois (' || m || ')');

  perform assert(agency_has_feature(v_ag, 'CLIENT_PORTAL'), 'Starter ouvre le portail client');
  perform assert(not agency_has_feature(v_ag, 'API'), 'Starter n''ouvre pas l''API');
  perform assert(not agency_has_feature(v_ag, 'WHITE_LABEL'), 'Starter n''ouvre pas la marque blanche');

  -- ---------------------------------------------------------------
  -- 4 · Le quota des bureaux, mesuré puis appliqué
  -- ---------------------------------------------------------------
  q := quota_check(v_ag, 'offices');
  perform assert((q ->> 'limite')::int = 1, 'Starter plafonne à un bureau');
  perform assert((q ->> 'utilise')::int = 1, 'un bureau est déjà occupé');
  perform assert((q ->> 'reste')::int = 0, 'il n''en reste aucun');
  -- Plein n'est pas dépassé : une agence qui a rempli ce qu'elle a payé est
  -- en règle, et son voyant reste éteint.
  perform assert(not (q ->> 'depasse')::boolean, 'plein n''est pas dépassé');

  ok := false;
  begin
    insert into offices (agency_id, name, country, country_code)
      values (v_ag, 'Sfax', 'Tunisie', 'TN');
  exception when others then ok := true;
  end;
  perform assert(ok, 'le deuxième bureau est refusé au-delà du quota');

  select count(*) into n from offices where agency_id = v_ag;
  perform assert(n = 1, 'le bureau refusé n''a rien laissé derrière lui');

  -- Monter de plan lève le mur, tout de suite.
  set local role authenticated;
  perform platform_set_subscription(v_ag, 'pro', 5, null, 'active');
  reset role;
  insert into offices (agency_id, name, country, country_code) values (v_ag, 'Sfax', 'Tunisie', 'TN');
  select count(*) into n from offices where agency_id = v_ag;
  perform assert(n = 2, 'passé en Pro, le deuxième bureau passe');
  perform assert(agency_has_feature(v_ag, 'CRM'), 'Pro ouvre la relation client');
  perform assert(not agency_has_feature(v_ag, 'API'), 'Pro n''ouvre toujours pas l''API');
  perform assert(subscription_invoice_amount(v_ag) = 5 * 45 * 12, 'la facture suit les sièges signés');

  select limit_value into n from plan_features pf
    join plans p on p.id = pf.plan_id join features f on f.id = pf.feature_id
   where p.code = 'pro' and f.code = 'WHATSAPP';
  perform assert(n = 2000, 'un plan peut plafonner une fonctionnalité, pas seulement l''ouvrir');

  -- ---------------------------------------------------------------
  -- 5 · Le quota des comptes
  -- ---------------------------------------------------------------
  -- Redescendre de plan avec deux bureaux ouverts : LÀ, c'est un vrai
  -- dépassement, et il doit s'inscrire au journal.
  set local role authenticated;
  perform platform_set_subscription(v_ag, 'starter', 3, null, 'active');
  reset role;
  q := quota_check(v_ag, 'offices');
  perform assert((q ->> 'utilise')::int = 2 and (q ->> 'limite')::int = 1,
                 'deux bureaux ouverts pour un seul payé');
  perform assert((q ->> 'depasse')::boolean, 'redescendre de plan met l''agence en dépassement');
  select count(*) into n from subscription_events where agency_id = v_ag and kind = 'quota_depasse';
  perform assert(n = 1, 'le dépassement constaté entre au journal');

  -- Starter : trois utilisateurs. On referme le bureau en trop, sinon c'est le
  -- quota des bureaux qui parle avant celui des comptes.
  update offices set active = false where agency_id = v_ag and name = 'Sfax';
  perform assert(not (quota_check(v_ag, 'offices') ->> 'depasse')::boolean,
                 'refermer le bureau en trop éteint le voyant');

  insert into auth.users (id) values (gen_random_uuid()) returning id into v_u3;
  insert into profiles (id, agency_id, office_id, name, role) values (v_u3, v_ag, v_off, 'Hatem', 'agent');
  perform assert((quota_check(v_ag, 'users') ->> 'utilise')::int = 3, 'trois comptes actifs sont comptés');

  ok := false;
  begin
    insert into auth.users (id) values (gen_random_uuid()) returning id into v_u4;
    insert into profiles (id, agency_id, office_id, name, role) values (v_u4, v_ag, v_off, 'Stage', 'viewer');
  exception when others then ok := true;
  end;
  perform assert(ok, 'le quatrième compte est refusé au-delà du quota');

  -- Un compte désactivé ne consomme pas de siège : on facture ce qui travaille.
  update profiles set active = false where id = v_u3;
  perform assert((quota_check(v_ag, 'users') ->> 'utilise')::int = 2, 'un compte désactivé libère son siège');

  -- ---------------------------------------------------------------
  -- 6 · Le premier bureau et le premier compte passent TOUJOURS
  -- ---------------------------------------------------------------
  -- On serre l'essai à zéro le temps du test : c'est la seule façon de
  -- prouver que le garde laisse passer les fondations. Sans cette exception,
  -- `platform_create_agency` ne pourrait plus créer aucune agence.
  update plans set max_offices = 0, max_users = 0 where code = 'essai';

  set local role authenticated;
  v_ag2 := platform_create_agency('Banc Fondations', 'banc-fond-' || sfx, 'Tunisie', 'par_dossier', 8, 'Bizerte');
  reset role;
  select count(*) into n from offices where agency_id = v_ag2;
  perform assert(n = 1, 'quota à zéro, le premier bureau passe quand même');

  select id into v_off from offices where agency_id = v_ag2 limit 1;
  insert into auth.users (id) values (gen_random_uuid()) returning id into v_u4;
  insert into profiles (id, agency_id, office_id, name, role) values (v_u4, v_ag2, v_off, 'Fondateur', 'owner');
  select count(*) into n from profiles where agency_id = v_ag2;
  perform assert(n = 1, 'quota à zéro, le premier compte passe quand même');

  ok := false;
  begin
    insert into offices (agency_id, name, country, country_code) values (v_ag2, 'Nabeul', 'Tunisie', 'TN');
  exception when others then ok := true;
  end;
  perform assert(ok, 'le deuxième bureau, lui, tombe sur le garde');

  update plans set max_offices = null, max_users = null where code = 'essai';

  -- ---------------------------------------------------------------
  -- 7 · Suspendre, c'est tout couper
  -- ---------------------------------------------------------------
  set local role authenticated;
  perform platform_set_subscription(v_ag, 'pro', 5, null, 'suspendue');
  reset role;
  perform assert(not agency_has_feature(v_ag, 'VISA'), 'une agence suspendue n''a plus rien, pas même les visas');
  perform assert(not agency_has_feature(v_ag, 'CLIENT_PORTAL'), 'une agence suspendue n''a plus le portail');
  select count(*) into n from subscription_events where agency_id = v_ag and kind = 'suspendue';
  perform assert(n = 1, 'la suspension entre au journal');

  set local role authenticated;
  perform platform_set_subscription(v_ag, 'pro', 5, null, 'active');
  reset role;
  perform assert(agency_has_feature(v_ag, 'VISA'), 'réactivée, l''agence retrouve son plan');
  select count(*) into n from subscription_events where agency_id = v_ag and kind = 'reactivee';
  perform assert(n = 1, 'la réactivation entre au journal');

  -- ---------------------------------------------------------------
  -- 8 · Une seule souscription vivante par agence
  -- ---------------------------------------------------------------
  ok := false;
  begin
    insert into subscriptions (agency_id, plan_id, status, price_per_user_month, seats)
    select v_ag, id, 'active', 45, 2 from plans where code = 'business';
  exception when unique_violation then ok := true;
  end;
  perform assert(ok, 'une agence n''a qu''une souscription vivante à la fois');

  -- ---------------------------------------------------------------
  -- 9 · Une agence ne change pas son propre plan
  -- ---------------------------------------------------------------
  select id into v_off from offices where agency_id = v_ag and active limit 1;
  perform test_login(v_owner, v_ag, 'owner', v_off);
  set local role authenticated;

  -- Elle LIT son abonnement : c'est ce que la carte du plan affiche.
  select count(*) into n from subscriptions where agency_id = v_ag;
  perform assert(n = 1, 'une agence lit sa propre souscription');
  perform assert((my_plan() ->> 'code') = 'pro', 'my_plan rend le plan de l''agence connectée');
  perform assert((my_plan() -> 'usage' ->> 'offices')::int >= 1, 'my_plan rend aussi la consommation');

  -- Mais elle ne l'écrit pas.
  update subscriptions set plan_id = (select id from plans where code = 'enterprise')
   where agency_id = v_ag;
  get diagnostics n = row_count;
  perform assert(n = 0, 'une agence ne change pas son propre plan');

  ok := false;
  begin
    insert into subscriptions (agency_id, plan_id, status, price_per_user_month, seats)
    select v_ag2, id, 'active', 45, 99 from plans where code = 'enterprise';
  exception when others then ok := true;
  end;
  perform assert(ok, 'une agence ne se pose pas non plus un abonnement à la main');

  -- Et elle ne voit pas celui du voisin.
  select count(*) into n from subscriptions where agency_id = v_ag2;
  perform assert(n = 0, 'une agence ne voit pas la souscription d''une autre');

  -- La console de plateforme lui est fermée.
  ok := false;
  begin
    perform platform_subscriptions();
  exception when others then ok := true;
  end;
  perform assert(ok, 'la liste des abonnements est refusée à un compte d''agence');

  ok := false;
  begin
    perform platform_set_subscription(v_ag, 'enterprise', 99, null, 'active');
  exception when others then ok := true;
  end;
  perform assert(ok, 'poser un abonnement est refusé à un compte d''agence');

  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  perform assert((select code from plans p join subscriptions s on s.plan_id = p.id
                   where s.agency_id = v_ag and s.status <> 'resiliee') = 'pro',
                 'après toutes ces tentatives, le plan est resté Pro');

  -- ---------------------------------------------------------------
  -- 10 · La console de la plateforme
  -- ---------------------------------------------------------------
  set local role authenticated;
  j := platform_subscriptions();
  reset role;
  perform assert(jsonb_array_length(j) >= 2, 'la console liste les agences avec leur abonnement');
  perform assert(exists (select 1 from jsonb_array_elements(j) e
                          where (e ->> 'agency_id')::uuid = v_ag
                            and e ->> 'plan' = 'pro'
                            and (e ->> 'annual_amount')::numeric = 5 * 45 * 12),
                 'la console montre le plan et le montant annuel de chaque agence');
  perform assert(exists (select 1 from jsonb_array_elements(j) e
                          where (e ->> 'agency_id')::uuid = v_ag
                            and e -> 'usage' ->> 'users' is not null),
                 'la console montre la consommation');

  set local role authenticated;
  j := platform_subscription_events(v_ag, 50);
  reset role;
  perform assert(jsonb_array_length(j) >= 4, 'le journal de l''abonnement se relit en entier');

  -- ---------------------------------------------------------------
  -- 11 · Résilier, sans confondre avec « jamais souscrit »
  -- ---------------------------------------------------------------
  -- Une agence née avant 0049 n'a aucune ligne de souscription. On la simule
  -- en retirant celle que le trigger vient de poser.
  insert into agencies (slug, name, services)
    values ('banc-jamais-' || sfx, 'Banc Sans Souscription', '{visas}') returning id into v_ag3_never;
  delete from subscriptions where agency_id = v_ag3_never;

  set local role authenticated;
  perform platform_set_subscription(v_ag, 'pro', 5, null, 'resiliee');
  reset role;
  perform assert((select ends_on from subscriptions where agency_id = v_ag) = current_date,
                 'la résiliation date la fin');
  perform assert(subscription_invoice_amount(v_ag) = 0, 'une agence résiliée ne doit plus rien');
  perform assert(not agency_has_feature(v_ag, 'VISA'), 'une agence résiliée n''a plus rien');
  perform assert((agency_plan(v_ag) ->> 'status') = 'resiliee',
                 'une agence résiliée reste lisible comme résiliée, elle ne repart pas en essai');
  -- Une agence qui n'a JAMAIS eu de souscription, elle, est bien en essai.
  perform assert(agency_has_feature(v_ag3_never, 'API'),
                 'un compte né avant ce fichier est traité comme un essai');

  -- ---------------------------------------------------------------
  -- 12 · Les garde-fous du garde lui-même
  -- ---------------------------------------------------------------
  ok := false;
  begin
    perform quota_check(v_ag, 'ressource_inventee');
  exception when others then ok := true;
  end;
  perform assert(ok, 'une ressource inconnue est refusée, pas rendue vide');

  -- Aucun plan ne plafonne les clients : une agence ne se fait pas couper le
  -- carnet d'adresses qu'elle a construit.
  perform assert(quota_limit(v_ag2, 'clients') is null, 'le nombre de clients n''est jamais plafonné');
  perform assert((quota_check(v_ag2, 'storage') ->> 'limite') is null,
                 'l''essai ne plafonne pas le stockage');

  raise notice '--- banc des abonnements : tout est vert ---';
end $$;
