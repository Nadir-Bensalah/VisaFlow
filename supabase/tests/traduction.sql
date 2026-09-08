-- Banc d'essai du module traduction (migration 0061).
--
-- Il répond aux questions qu'une agence pose le jour où elle installe le
-- carnet des traductions :
--   · « Le coût qu'il affiche, il le sort d'où ? »
--   · « Qu'est-ce qui m'empêche de confier un acte assermenté à quelqu'un qui
--      ne l'est pas ? »
--   · « Mon agent au comptoir, il voit ma marge ? »
--   · « Le retard qu'il m'annonce, il le calcule sur quoi ? »
--
-- Rien n'est estimé ici : chaque délai vérifié est posé à la main dans le
-- décor, puis recalculé par la base, et les deux doivent tomber juste.

\set ON_ERROR_STOP on
set search_path = public;

-- BANC REJOUABLE : on efface d'abord ce qu'un passage précédent a laissé.
delete from agencies where slug in ('banc-trad-1', 'banc-trad-2');

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then raise notice 'OK    %', label;
  else raise exception 'ÉCHEC %', label; end if;
end $$;

do $$
declare
  a1 uuid; a2 uuid; o1 uuid; o1b uuid; o2 uuid;
  u_owner uuid; u_agent uuid; u_sousse uuid; u_other uuid;
  ck uuid; vt uuid; cl uuid; k1 uuid; k2 uuid;
  doc1 uuid; doc2 uuid;
  tr_ass uuid; tr_non uuid; tr_off uuid; tr_autre uuid; tr_stats uuid;
  ord1 uuid; ord2 uuid; ord_retard uuid; ord_sousse uuid; s1 uuid; s2 uuid;
  n int; ver int; v_num text; v_cost numeric; v_sold numeric;
  couts jsonb; st jsonb; res jsonb; d1 timestamptz; ok boolean;
begin
  -- ---------------------------------------------------------------
  -- Le décor : deux agences, deux bureaux, un dossier, deux pièces
  -- ---------------------------------------------------------------
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_owner;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_agent;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_sousse;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_other;

  insert into agencies (slug, name, services) values ('banc-trad-1', 'Banc Traduction', '{visas}') returning id into a1;
  insert into agencies (slug, name, services) values ('banc-trad-2', 'Banc Voisin', '{visas}') returning id into a2;

  insert into offices (agency_id, name, country, country_code) values (a1, 'Tunis', 'Tunisie', 'TN') returning id into o1;
  insert into offices (agency_id, name, country, country_code) values (a1, 'Sousse', 'Tunisie', 'TN') returning id into o1b;
  insert into offices (agency_id, name, country, country_code) values (a2, 'Sfax', 'Tunisie', 'TN') returning id into o2;

  insert into profiles (id, agency_id, office_id, name, role) values
    (u_owner,  a1, o1,  'Slim',  'owner'),
    (u_agent,  a1, o1,  'Hatem', 'agent'),
    (u_sousse, a1, o1b, 'Amira', 'agent'),
    (u_other,  a2, o2,  'Rania', 'owner');

  insert into checklists (agency_id, name) values (a1, '{"fr":"France"}') returning id into ck;
  insert into visa_types (agency_id, country_code, country, label, checklist_id)
    values (a1, 'FR', '{"fr":"France"}', '{"fr":"Tourisme"}', ck) returning id into vt;
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (a1, o1, 'Amine', 'Ben Salah', '+216 20 000 061') returning id into cl;
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id)
    values (a1, 'VF-BANC-TRAD', cl, vt, o1) returning id into k1;
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id)
    values (a1, 'VF-BANC-TRAD-2', cl, vt, o1b) returning id into k2;

  insert into case_documents (agency_id, case_id, key, label)
    values (a1, k1, 'acte_naissance', '{"fr":"Acte de naissance"}') returning id into doc1;
  insert into case_documents (agency_id, case_id, key, label)
    values (a1, k1, 'fiche_paie', '{"fr":"Fiche de paie"}') returning id into doc2;

  -- Les traducteurs sont saisis par l'agence, avec SES tarifs.
  insert into translators (agency_id, name, kind, sworn, sworn_court, languages,
                           rate_per_page, rate_currency, lead_time_days)
    values (a1, 'Traducteur assermenté', 'externe', true, 'Cour d''appel de Tunis',
            '{ar>fr,fr>ar}', 20, 'TND', 3) returning id into tr_ass;
  insert into translators (agency_id, name, kind, sworn, languages, rate_per_page, rate_currency)
    values (a1, 'Traducteur libre', 'externe', false, '{fr>en}', 15, 'TND') returning id into tr_non;
  insert into translators (agency_id, name, kind, sworn, active, rate_per_page, rate_currency)
    values (a1, 'Ancien traducteur', 'externe', true, false, 12, 'TND') returning id into tr_off;
  insert into translators (agency_id, name, kind, sworn, rate_per_page, rate_currency)
    values (a2, 'Traducteur du voisin', 'externe', true, 30, 'TND') returning id into tr_autre;
  insert into translators (agency_id, name, kind, sworn, rate_per_page, rate_currency, lead_time_days)
    values (a1, 'Traducteur mesuré', 'bureau', true, 10, 'TND', 5) returning id into tr_stats;

  -- ---------------------------------------------------------------
  -- 1. Ce que le module pose, et ce qu'il ne pose pas
  -- ---------------------------------------------------------------
  select count(*) into n from pg_class
   where relname in ('translators','translation_orders','translation_languages')
     and relrowsecurity and relforcerowsecurity;
  perform assert(n = 3, 'les trois tables du module ont RLS activée ET forcée');

  select count(*) into n from translation_languages where code = 'ar' and rtl;
  perform assert(n = 1, 'le référentiel connaît l''arabe, et sait qu''il s''écrit de droite à gauche');

  select count(*) into n from translators where agency_id = a2 and name <> 'Traducteur du voisin';
  perform assert(n = 0, 'aucun traducteur n''est livré avec le produit : l''agence saisit les siens');

  select count(*) into n from information_schema.columns
   where table_name = 'case_documents' and column_name in ('needs_translation','translation_order_id');
  perform assert(n = 2, 'la traduction se raccroche à la liste de pièces existante, sans second système de documents');

  -- ---------------------------------------------------------------
  -- 2. Confier une traduction : le coût descend du tarif
  -- ---------------------------------------------------------------
  perform test_login(u_owner, a1, 'owner', o1);
  ord1 := translation_order_place(
    p_translator => tr_ass, p_source_lang => 'ar', p_target_lang => 'fr',
    p_case => k1, p_document => doc1, p_sworn_required => true,
    p_pages => 3, p_sold_amount => 90);

  select order_number, cost_amount, sold_amount into v_num, v_cost, v_sold
    from translation_orders where id = ord1;
  perform assert(v_cost = 60, 'le coût descend du tarif et du nombre de pages : 20 × 3 = ' || v_cost);
  perform assert(v_sold = 90, 'le prix de vente reste celui que l''agence a saisi : aucun barème ne le donne');
  perform assert(v_num like 'TRA-' || extract(year from now())::int || '-%',
    'le numéro de suivi est posé par le serveur (' || v_num || ')');

  select status into v_num from translation_orders where id = ord1;
  perform assert(v_num = 'commandee', 'la traduction est notée comme confiée');

  select promised_at into d1 from translation_orders where id = ord1;
  perform assert(d1::date = (now() + interval '3 days')::date,
    'sans date saisie, la date promise reprend le délai annoncé par le traducteur');

  select needs_translation, translation_order_id = ord1 into ok, ok
    from case_documents where id = doc1;
  select count(*) into n from case_documents
   where id = doc1 and needs_translation and translation_order_id = ord1;
  perform assert(n = 1, 'la pièce du dossier porte le lien : c''est là que l''agent la cherche');

  -- ---------------------------------------------------------------
  -- 3. Les trois refus
  -- ---------------------------------------------------------------
  begin
    perform translation_order_place(
      p_translator => tr_non, p_source_lang => 'ar', p_target_lang => 'fr',
      p_case => k1, p_document => doc2, p_sworn_required => true, p_pages => 2);
    perform assert(false, 'un traducteur non assermenté ne prend pas une traduction assermentée');
  exception when raise_exception then
    perform assert(true, 'on ne confie pas à un traducteur non assermenté ce que l''agence a coché « assermentation exigée »');
  end;

  -- La même personne convient parfaitement quand rien n'est exigé.
  ord2 := translation_order_place(
    p_translator => tr_non, p_source_lang => 'fr', p_target_lang => 'en',
    p_case => k1, p_document => doc2, p_sworn_required => false,
    p_pages => 2, p_sold_amount => 50);
  select cost_amount into v_cost from translation_orders where id = ord2;
  perform assert(v_cost = 30, 'sans assermentation exigée, le même traducteur convient : 15 × 2 = ' || v_cost);

  begin
    perform translation_order_place(p_translator => tr_autre, p_case => k1, p_pages => 1);
    perform assert(false, 'un traducteur d''une autre agence ne devrait pas être joignable');
  exception when insufficient_privilege then
    perform assert(true, 'on ne confie rien au traducteur d''une autre agence');
  end;

  begin
    perform translation_order_place(p_translator => tr_off, p_case => k1, p_pages => 1);
    perform assert(false, 'un traducteur retiré du répertoire ne devrait pas être joignable');
  exception when raise_exception then
    perform assert(true, 'on ne confie rien à un traducteur retiré du répertoire');
  end;

  -- ---------------------------------------------------------------
  -- 4. La marge se calcule, elle ne s'écrit pas
  -- ---------------------------------------------------------------
  couts := translation_costs(ord1);
  perform assert((couts->>'margin')::numeric = 30,
    'la marge est calculée par la base : 90 vendus moins 60 de coût = ' || (couts->>'margin'));

  begin
    update translation_orders set margin = 999 where id = ord1;
    perform assert(false, 'la marge ne devrait pas pouvoir s''écrire');
  exception when others then
    perform assert(true, 'la marge ne s''écrit pas à la main : c''est le premier chiffre qu''on arrangerait');
  end;

  update translation_orders set sold_amount = 120 where id = ord1;
  couts := translation_costs(ord1);
  perform assert((couts->>'margin')::numeric = 60,
    'changer le prix de vente recalcule la marge sans qu''on la touche (' || (couts->>'margin') || ')');
  update translation_orders set sold_amount = 90 where id = ord1;

  -- ---------------------------------------------------------------
  -- 5. La traduction reçue rejoint la pièce d'origine
  -- ---------------------------------------------------------------
  ver := translation_deliver(ord1, 'dossiers/' || k1 || '/acte_naissance_fr.pdf');
  select count(*) into n from translation_orders
   where id = ord1 and status = 'livree' and delivered_at is not null
     and translated_path = 'dossiers/' || k1 || '/acte_naissance_fr.pdf';
  perform assert(n = 1, 'la traduction reçue est notée livrée, avec son chemin');

  select count(*) into n from document_versions
   where document_id = doc1 and storage_path = 'dossiers/' || k1 || '/acte_naissance_fr.pdf';
  perform assert(n = 1, 'la traduction devient une version de la pièce d''origine, pas un fichier orphelin');
  perform assert(ver is not null and ver > 0, 'et elle porte un numéro de version (' || coalesce(ver, 0) || ')');

  -- ---------------------------------------------------------------
  -- 6. Le retard, sur des dates connues
  -- ---------------------------------------------------------------
  insert into translation_orders (agency_id, office_id, case_id, document_id, translator_id,
                                  source_lang, target_lang, pages, status, ordered_at, promised_at,
                                  sold_amount, cost_amount, currency)
    values (a1, o1, k1, null, tr_ass, 'ar', 'fr', 4, 'en_cours',
            now() - interval '288 hours', now() - interval '120 hours', 100, 80, 'TND')
    returning id into ord_retard;

  select count(*) into n from translation_late(null) where order_id = ord_retard;
  perform assert(n = 1, 'une traduction qui dort chez le traducteur remonte dans les retards');

  select days_late into n from translation_late(null) where order_id = ord_retard;
  perform assert(n = 5, 'le retard se compte sur la date promise enregistrée : 5 jours annoncés, ' || n || ' trouvés');

  select count(*) into n from translation_late(null) where order_id = ord1;
  perform assert(n = 0, 'une traduction livrée ne figure plus dans les retards');

  -- ---------------------------------------------------------------
  -- 7. Les chiffres d'un traducteur, sur ses dates réelles
  -- ---------------------------------------------------------------
  -- Deux livraisons posées à la main : 2 jours, puis 3 jours. La moyenne est
  -- donc 2,5 jours, et une seule des deux a dépassé sa date promise.
  insert into translation_orders (agency_id, office_id, case_id, translator_id, source_lang, target_lang,
                                  pages, status, ordered_at, promised_at, delivered_at,
                                  sold_amount, cost_amount, currency)
    values (a1, o1, k1, tr_stats, 'fr', 'ar', 2, 'livree',
            now() - interval '240 hours',
            now() - interval '240 hours' + interval '72 hours',
            now() - interval '240 hours' + interval '48 hours',
            60, 20, 'TND')
    returning id into s1;
  insert into translation_orders (agency_id, office_id, case_id, translator_id, source_lang, target_lang,
                                  pages, status, ordered_at, promised_at, delivered_at,
                                  sold_amount, cost_amount, currency)
    values (a1, o1, k1, tr_stats, 'fr', 'ar', 3, 'livree',
            now() - interval '144 hours',
            now() - interval '144 hours' + interval '48 hours',
            now() - interval '144 hours' + interval '72 hours',
            90, 30, 'TND')
    returning id into s2;
  insert into translation_orders (agency_id, office_id, case_id, translator_id, source_lang, target_lang,
                                  pages, status, ordered_at, sold_amount, cost_amount, currency)
    values (a1, o1, k1, tr_stats, 'fr', 'ar', 1, 'commandee',
            now() - interval '48 hours', 30, 10, 'TND');

  st := translator_stats(tr_stats);
  perform assert((st->>'orders')::int = 3, 'les commandes du traducteur sont comptées (' || (st->>'orders') || ')');
  perform assert((st->>'delivered')::int = 2, 'deux d''entre elles sont livrées');
  perform assert((st->>'avg_days')::numeric = 2.5,
    'le délai moyen est celui des dates réelles : 2 jours puis 3 jours font ' || (st->>'avg_days') || ' jours');
  perform assert((st->>'avg_days_on')::int = 2, 'et le chiffre porte sa taille d''échantillon');
  perform assert((st->>'late')::int = 1 and (st->>'late_on')::int = 2,
    'le taux de retard ne se calcule que sur les commandes qui avaient une date promise');
  perform assert((st->>'late_rate')::numeric = 50.0, 'une livraison en retard sur deux mesurées : ' || (st->>'late_rate') || ' %');
  perform assert(
    not (st ? 'score') and not (st ? 'note') and not (st ? 'rating')
    and not (st ? 'rank') and not (st ? 'fiabilite') and not (st ? 'stars'),
    'aucun score global, aucune note : des chiffres bruts, comme le veut la règle sur les indicateurs de personnes');

  -- Un traducteur sans aucune livraison n'a pas de délai moyen : on ne
  -- l'invente pas, on laisse vide.
  st := translator_stats(tr_non);
  perform assert(st->'avg_days' = 'null'::jsonb,
    'sans livraison, il n''y a pas de délai moyen : la case reste vide, elle ne vaut pas zéro');

  -- ---------------------------------------------------------------
  -- 8. L'agent confie une traduction sans voir la marge
  -- ---------------------------------------------------------------
  perform test_login(u_agent, a1, 'agent', o1);
  set local role authenticated;

  select count(*) into n from translation_orders where id = ord1;
  reset role;
  perform assert(n = 1, 'l''agent lit bien la traduction du dossier : c''est lui qui la suit');

  set local role authenticated;
  select sold_amount into v_sold from translation_orders where id = ord1;
  reset role;
  perform assert(v_sold = 90, 'et il lit le prix vendu au client : c''est lui qui le facture');

  set local role authenticated;
  begin
    select cost_amount into v_cost from translation_orders where id = ord1;
    reset role;
    perform assert(false, 'l''agent ne devrait pas lire le coût du traducteur');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'un agent sans finance:global ne lit pas le coût du traducteur');
  end;

  set local role authenticated;
  begin
    select margin into v_cost from translation_orders where id = ord1;
    reset role;
    perform assert(false, 'l''agent ne devrait pas lire la marge');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'ni la marge de l''agence');
  end;

  begin
    couts := translation_costs(ord1);
    perform assert(false, 'la porte des coûts ne devrait pas s''ouvrir sans finance:global');
  exception when insufficient_privilege then
    perform assert(true, 'la porte des coûts vérifie le droit, elle ne se contourne pas');
  end;

  begin
    select count(*) into n from translation_margin_report(null, null, null);
    perform assert(false, 'le rapport de marge ne devrait pas s''ouvrir sans finance:global');
  exception when insufficient_privilege then
    perform assert(true, 'un agent n''ouvre pas le rapport de marge');
  end;

  st := translator_stats(tr_stats);
  perform assert(not (st ? 'avg_margin'),
    'et les chiffres du traducteur ne lui livrent pas la marge moyenne');

  -- Il confie une traduction, en revanche : c'est son métier.
  ord_sousse := translation_order_place(
    p_translator => tr_ass, p_source_lang => 'ar', p_target_lang => 'fr',
    p_case => k1, p_pages => 1, p_sold_amount => 40);
  perform assert(ord_sousse is not null, 'un agent confie une traduction : case:write suffit');

  -- ---------------------------------------------------------------
  -- 9. La direction, elle, voit les coûts
  -- ---------------------------------------------------------------
  perform test_login(u_owner, a1, 'owner', o1);
  select count(*) into n from translation_margin_report(null, null, null)
   where translator_id = tr_stats and source_lang = 'fr' and target_lang = 'ar';
  perform assert(n = 1, 'le rapport ventile la marge par traducteur et par couple de langues');

  select margin into v_cost from translation_margin_report(null, null, null)
   where translator_id = tr_stats and source_lang = 'fr' and target_lang = 'ar';
  perform assert(v_cost = 120, 'et il additionne les marges du couple : 40 + 60 + 20 = ' || v_cost);

  st := translator_stats(tr_stats);
  perform assert((st->>'avg_margin')::numeric = 40, 'la direction lit la marge moyenne (' || (st->>'avg_margin') || ')');

  -- ---------------------------------------------------------------
  -- 10. Ce que le dossier affiche, et ce que la barre de progression lit
  -- ---------------------------------------------------------------
  res := case_translations(k1);
  perform assert((res->>'total')::int = 2, 'le dossier compte ses pièces à traduire (' || (res->>'total') || ')');
  perform assert((res->>'livrees')::int = 1, 'et celles qui sont revenues');
  perform assert(not (res->>'toutes_livrees')::boolean, 'tant qu''il en reste une, l''étape « Traductions » n''est pas franchie');
  perform assert(jsonb_array_length(res->'pieces') = 2, 'chaque pièce à traduire est décrite avec l''état de son suivi');
  perform assert(not (res->'pieces'->0->'order' ? 'cost_amount')
             and not (res->'pieces'->0->'order' ? 'margin'),
    'le bloc du dossier ne laisse fuir ni le coût ni la marge');

  perform translation_deliver(ord2, 'dossiers/' || k1 || '/fiche_paie_en.pdf');
  res := case_translations(k1);
  perform assert((res->>'toutes_livrees')::boolean, 'la dernière traduction reçue franchit l''étape');

  -- ---------------------------------------------------------------
  -- 11. Le cloisonnement
  -- ---------------------------------------------------------------
  -- Une traduction du bureau de Sousse, pour un agent de Tunis.
  insert into translation_orders (agency_id, office_id, case_id, translator_id, pages, status, sold_amount, cost_amount)
    values (a1, o1b, k2, tr_ass, 1, 'commandee', 40, 20) returning id into ord_sousse;

  perform test_login(u_agent, a1, 'agent', o1);
  set local role authenticated;
  select count(*) into n from translation_orders where id = ord_sousse;
  reset role;
  perform assert(n = 0, 'un agent de Tunis ne voit pas la traduction du bureau de Sousse');

  perform test_login(u_other, a2, 'owner', o2);
  set local role authenticated;
  select count(*) into n from translation_orders;
  reset role;
  perform assert(n = 0, 'l''agence voisine ne voit aucune traduction : le cloisonnement tient');

  set local role authenticated;
  select count(*) into n from translators;
  reset role;
  perform assert(n = 1, 'et elle ne voit que son propre traducteur');

  begin
    res := case_translations(k1);
    perform assert(false, 'l''agence voisine ne devrait pas ouvrir le dossier d''une autre');
  exception when no_data_found then
    perform assert(true, 'l''agence voisine n''ouvre pas les traductions du dossier d''une autre');
  end;

  -- ---------------------------------------------------------------
  -- 12. Aucune suppression dure
  -- ---------------------------------------------------------------
  perform test_login(u_owner, a1, 'owner', o1);
  set local role authenticated;
  begin
    delete from translation_orders where id = ord1;
    reset role;
    perform assert(false, 'une traduction ne devrait pas pouvoir s''effacer');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'aucune suppression dure : une traduction se range, elle ne se détruit pas');
  end;

  set local role authenticated;
  begin
    delete from translators where id = tr_off;
    reset role;
    perform assert(false, 'un traducteur ne devrait pas pouvoir s''effacer');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'un traducteur non plus : son historique de travail reste lisible');
  end;

  -- Ménage.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  delete from agencies where id in (a1, a2);
  delete from auth.users where id in (u_owner, u_agent, u_sousse, u_other);
  raise notice '--- banc des traductions : tout est vert ---';
end $$;
