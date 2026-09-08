-- Banc d'essai du module documents (migration 0053).
--
-- Ce qu'il garde :
--   1. le rassemblement du contenu d'un document en UN SEUL appel ;
--   2. la trace de chaque document produit ;
--   3. le cloisonnement entre agences ;
--   4. le fait qu'un agent d'un autre bureau ne peut pas produire le document
--      d'un dossier qu'il ne voit pas. C'est le point qui a décidé de
--      l'architecture : `document_payload` est en SECURITY INVOKER, et sans ce
--      banc rien ne rappellerait pourquoi.
--
-- Le banc monte son décor et le démonte : il tourne autant de fois qu'on veut.

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

-- Le décor peut rester d'un essai interrompu : on le retire d'abord.
delete from agencies where slug in ('banc-doc-1', 'banc-doc-2');

do $$
declare
  a1 uuid; a2 uuid; o_tunis uuid; o_sfax uuid; o2 uuid;
  u_owner uuid; u_agent uuid; u_far uuid; u_other uuid;
  ck uuid; vt uuid; cl uuid; k1 uuid; f1 uuid; q1 uuid;
  pay uuid; sh uuid; dl uuid; tpl uuid; job uuid; trace uuid;
  d jsonb; n int; ok boolean; v_num text;
begin
  -- ---------------------------------------------------------------
  -- Le décor : deux agences, deux bureaux dans la première
  -- ---------------------------------------------------------------
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_owner;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_agent;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_far;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_other;

  insert into agencies (slug, name, services, tax_id, rc_number, capital, default_locale)
    values ('banc-doc-1', 'Banc Documents', '{visas,fret}', '1234567/A/M/000', 'B0112345', 10000, 'fr')
    returning id into a1;
  -- La voisine n'a PAS de matricule fiscal : le payload doit le dire.
  insert into agencies (slug, name, services)
    values ('banc-doc-2', 'Agence Voisine', '{visas}') returning id into a2;

  insert into offices (agency_id, name, city, country, country_code)
    values (a1, 'Tunis', 'Tunis', 'Tunisie', 'TN') returning id into o_tunis;
  insert into offices (agency_id, name, city, country, country_code)
    values (a1, 'Sfax', 'Sfax', 'Tunisie', 'TN') returning id into o_sfax;
  insert into offices (agency_id, name, city, country, country_code)
    values (a2, 'Tripoli', 'Tripoli', 'Libye', 'LY') returning id into o2;

  insert into profiles (id, agency_id, office_id, name, role) values
    (u_owner, a1, o_tunis, 'Slim',  'owner'),
    (u_agent, a1, o_tunis, 'Amira', 'agent'),
    (u_far,   a1, o_sfax,  'Hatem', 'agent'),
    (u_other, a2, o2,      'Rania', 'owner');

  insert into checklists (agency_id, name) values (a1, '{"fr":"Schengen"}') returning id into ck;
  insert into visa_types (agency_id, country_code, country, label, checklist_id)
    values (a1, 'FR', '{"fr":"France"}', '{"fr":"Tourisme"}', ck) returning id into vt;

  insert into clients (agency_id, office_id, first_name, last_name, phone, native_name, locale)
    values (a1, o_tunis, 'Amine', 'Ben Salah', '+216 20 000 077', 'أمين بن صالح', 'fr')
    returning id into cl;

  insert into cases (agency_id, reference, client_id, visa_type_id, office_id, amount_total, amount_paid)
    values (a1, 'VF-BANC-DOC', cl, vt, o_tunis, 500, 200) returning id into k1;

  insert into case_documents (agency_id, case_id, key, label, required, state) values
    (a1, k1, 'passeport', '{"fr":"Passeport"}', true, 'recue'),
    (a1, k1, 'photo',     '{"fr":"Photo"}',     true, 'manquante'),
    (a1, k1, 'assurance', '{"fr":"Assurance"}', false, 'manquante');

  insert into quotes (agency_id, office_id, client_id, kind, case_id, currency, created_by)
    values (a1, o_tunis, cl, 'visa', k1, 'TND', u_owner) returning id, number into q1, v_num;
  insert into quote_items (agency_id, quote_id, description, quantity, unit_price, tax_rate, line_no)
    values (a1, q1, 'Assistance visa', 2, 100, 19, 1);

  insert into invoices (agency_id, office_id, client_id, case_id, currency, created_by)
    values (a1, o_tunis, cl, k1, 'TND', u_owner) returning id into f1;
  insert into invoice_items (agency_id, invoice_id, description, quantity, unit_price, tax_rate, line_no)
    values (a1, f1, 'Assistance visa', 2, 100, 19, 1),
           (a1, f1, 'Traduction',      1, 50,  0,  2);

  insert into payments (agency_id, case_id, client_id, office_id, label, kind, amount, currency, state, method, at)
    values (a1, k1, cl, o_tunis, '{"fr":"Acompte"}', 'honoraires', 200, 'TND', 'regle', 'especes', now())
    returning id into pay;

  insert into shipments (agency_id, reference, office_id, mode, goods, origin_city, dest_city, incoterm)
    values (a1, 'EXP-BANC-DOC', o_tunis, 'maritime_fcl', '{"fr":"Pièces détachées"}', 'Shanghai', 'Radès', 'FOB')
    returning id into sh;
  insert into shipment_goods (agency_id, shipment_id, description, quantity, gross_weight_kg)
    values (a1, sh, 'Cartons', 12, 340);
  insert into containers (agency_id, shipment_id, container_number, container_type)
    values (a1, sh, 'MSCU1234566', '40HC');
  insert into deliveries (agency_id, office_id, shipment_id, client_id, address, contact_name, status)
    values (a1, o_tunis, sh, cl, 'Rue de Marseille, Tunis', 'Amine Ben Salah', 'programmee')
    returning id into dl;

  insert into document_templates (agency_id, kind, name, locale, legal_mentions, footer_html)
    values (a1, 'facture', 'Facture standard', 'fr',
            'Matricule fiscal 1234567/A/M/000 · RC B0112345 · TVA 19 %',
            '<p>Merci de votre confiance.</p>')
    returning id into tpl;
  -- Le même modèle en arabe : la sélection doit préférer la langue du client.
  insert into document_templates (agency_id, kind, name, locale, legal_mentions)
    values (a1, 'facture', 'فاتورة', 'ar', 'المعرف الجبائي 1234567/A/M/000');

  -- ---------------------------------------------------------------
  -- 1. La facture : tout arrive en un seul appel
  -- ---------------------------------------------------------------
  perform test_login(u_owner, a1, 'owner', o_tunis);
  set local role authenticated;

  d := document_payload('facture', f1);

  perform assert(d -> 'agency' ->> 'name' = 'Banc Documents',
    'un seul appel ramène l''agence');
  perform assert(d -> 'office' ->> 'name' = 'Tunis',
    'un seul appel ramène le bureau');
  perform assert(d -> 'client' ->> 'last_name' = 'Ben Salah',
    'un seul appel ramène le client');
  perform assert(jsonb_array_length(d -> 'lines') = 2,
    'un seul appel ramène les deux lignes de la facture');
  perform assert((d -> 'totals' ->> 'total')::numeric = 288.00,
    'les totaux descendent du serveur : 250 HT, 38 de TVA, 288 TTC');
  perform assert(d ->> 'number' like 'FAC-%',
    'le numéro de la facture accompagne le document : ' || (d ->> 'number'));

  -- Le contrôle du « un seul aller-retour » : les huit blocs sont là.
  perform assert(
    (d ? 'agency') and (d ? 'office') and (d ? 'client') and (d ? 'template')
    and (d ? 'meta') and (d ? 'lines') and (d ? 'totals') and (d ? 'legal'),
    'les huit blocs d''un document tiennent dans une seule réponse');

  -- ---------------------------------------------------------------
  -- 2. Les mentions légales : sans matricule, la facture est refusée
  -- ---------------------------------------------------------------
  perform assert(d -> 'legal' ->> 'tax_id' = '1234567/A/M/000',
    'le matricule fiscal s''imprime : sans lui la facture est refusée en Tunisie');
  perform assert(d -> 'legal' ->> 'mentions' like 'Matricule fiscal%',
    'les mentions légales du modèle descendent avec le document');
  perform assert((d -> 'legal' ->> 'missing_tax_id')::boolean = false,
    'une agence en règle n''est pas signalée');
  perform assert(d -> 'template' ->> 'locale' = 'fr',
    'le modèle choisi est celui de la langue du client');

  -- ---------------------------------------------------------------
  -- 3. Les autres natures de document
  -- ---------------------------------------------------------------
  d := document_payload('devis', q1);
  perform assert(d ->> 'entity_kind' = 'quote' and (d -> 'totals' ->> 'total')::numeric = 238.00,
    'le devis rassemble ses lignes et son total');

  d := document_payload('recu', pay);
  perform assert((d -> 'totals' ->> 'total')::numeric = 200
                 and jsonb_array_length(d -> 'lines') = 1,
    'le reçu porte le montant encaissé, sur une ligne');

  d := document_payload('checklist', k1);
  perform assert(jsonb_array_length(d -> 'lines') = 3,
    'la checklist imprime les trois pièces du dossier');

  d := document_payload('fiche_dossier', k1);
  perform assert(jsonb_array_length(d -> 'extra' -> 'payments') = 1,
    'la fiche dossier ajoute les règlements, la checklist non');

  d := document_payload('fiche_client', cl);
  perform assert(jsonb_array_length(d -> 'lines') = 1
                 and d -> 'meta' ->> 'native_name' = 'أمين بن صالح',
    'la fiche client porte son historique et son nom en arabe');

  d := document_payload('cargaison', sh);
  perform assert(jsonb_array_length(d -> 'extra' -> 'containers') = 1
                 and jsonb_array_length(d -> 'lines') = 1,
    'le récapitulatif de cargaison porte marchandises et conteneurs');

  d := document_payload('bon_livraison', dl);
  perform assert(d -> 'meta' -> 'shipment' ->> 'reference' = 'EXP-BANC-DOC',
    'le bon de livraison rappelle la cargaison livrée');

  d := document_payload('rapport', null);
  perform assert((d -> 'totals' ->> 'clients')::int = 1
                 and (d -> 'meta' ->> 'cases_total')::int = 1,
    'le rapport d''agence compte ce que l''agence voit');

  -- Une nature inventée ne s'imprime pas.
  ok := false;
  begin
    perform document_payload('bulletin_de_paie', k1);
  exception when others then ok := true;
  end;
  perform assert(ok, 'une nature de document inconnue est refusée');

  -- ---------------------------------------------------------------
  -- 4. La trace de chaque document produit
  -- ---------------------------------------------------------------
  trace := document_trace('facture', 'invoice', f1, 'FAC-2026-0001', 'fr',
    repeat('a', 64), null, o_tunis);
  select count(*) into n from generated_documents where id = trace;
  perform assert(n = 1, 'chaque document produit laisse sa trace');

  select count(*) into n from generated_documents
   where id = trace and sha256 = repeat('a', 64) and generated_by = u_owner;
  perform assert(n = 1, 'la trace garde l''empreinte du document et son auteur');

  -- Une empreinte mal formée n'entre pas : une trace fausse vaut moins que pas
  -- de trace du tout.
  ok := false;
  begin
    perform document_trace('facture', 'invoice', f1, 'FAC-X', 'fr', 'pas-une-empreinte');
  exception when others then ok := true;
  end;
  perform assert(ok, 'une empreinte qui n''en est pas une est refusée');

  -- Une trace ne se réécrit pas : sans ça elle ne prouve rien.
  ok := false;
  begin
    update generated_documents set number = 'FAC-TRAFIQUEE' where id = trace;
    perform assert(false, 'une trace ne se réécrit pas');
  exception when insufficient_privilege then ok := true;
  end;
  perform assert(ok, 'une trace ne se réécrit pas : sinon elle ne prouve rien');

  -- ---------------------------------------------------------------
  -- 5. Le cloisonnement entre agences
  -- ---------------------------------------------------------------
  reset role;
  perform test_login(u_other, a2, 'owner', o2);
  set local role authenticated;

  select count(*) into n from generated_documents;
  perform assert(n = 0, 'l''agence voisine ne voit aucune trace de la première');

  select count(*) into n from document_templates;
  perform assert(n = 0, 'l''agence voisine ne voit aucun modèle de la première');

  ok := false;
  begin
    perform document_payload('facture', f1);
  exception when others then ok := true;
  end;
  perform assert(ok, 'l''agence voisine ne produit pas la facture de la première');

  -- Elle ne pose pas non plus une trace au nom de la première.
  ok := false;
  begin
    insert into generated_documents (agency_id, office_id, kind, entity_kind, entity_id)
      values (a1, o_tunis, 'facture', 'invoice', f1);
    perform assert(false, 'une trace ne se pose pas chez le voisin');
  exception when others then ok := true;
  end;
  perform assert(ok, 'une trace ne se pose pas au nom d''une autre agence');

  -- Son rapport ne compte que ses propres chiffres.
  d := document_payload('rapport', null);
  perform assert((d -> 'totals' ->> 'clients')::int = 0,
    'le rapport de la voisine ne compte pas les clients de la première');
  perform assert((d -> 'legal' ->> 'missing_tax_id')::boolean = true,
    'une agence sans matricule fiscal est signalée, pas maquillée');

  -- ---------------------------------------------------------------
  -- 6. Le bureau : un agent n'imprime pas ce qu'il ne voit pas
  -- ---------------------------------------------------------------
  reset role;
  perform test_login(u_far, a1, 'agent', o_sfax);
  set local role authenticated;

  ok := false;
  begin
    perform document_payload('fiche_dossier', k1);
  exception when others then ok := true;
  end;
  perform assert(ok,
    'un agent de Sfax ne produit pas la fiche d''un dossier de Tunis');

  ok := false;
  begin
    perform document_payload('facture', f1);
  exception when others then ok := true;
  end;
  perform assert(ok,
    'un agent de Sfax ne produit pas la facture d''un dossier de Tunis');

  ok := false;
  begin
    perform document_payload('fiche_client', cl);
  exception when others then ok := true;
  end;
  perform assert(ok,
    'un agent de Sfax ne produit pas la fiche d''un client de Tunis');

  -- Il ne voit pas davantage la trace posée par le bureau de Tunis.
  select count(*) into n from generated_documents;
  perform assert(n = 0,
    'un agent de Sfax ne voit pas les impressions du bureau de Tunis');

  -- Son rapport se limite à son bureau, et il ne s'ouvre pas sur Tunis.
  ok := false;
  begin
    perform document_payload('rapport', o_tunis);
  exception when others then ok := true;
  end;
  perform assert(ok, 'un agent ne tire pas le rapport d''un bureau qu''il ne voit pas');

  -- ---------------------------------------------------------------
  -- 7. Le journal des imports
  -- ---------------------------------------------------------------
  reset role;
  perform test_login(u_agent, a1, 'agent', o_tunis);
  set local role authenticated;

  insert into import_jobs (agency_id, office_id, entity_kind, file_name, total_rows, mapping)
    values (a1, o_tunis, 'clients', 'clients-2026.csv', 300,
            '{"firstName":0,"lastName":1,"phone":2}')
    returning id into job;
  perform assert(job is not null, 'un import ouvre son journal avant d''écrire');

  perform import_job_finish(job, 'termine', 297, 3,
    '[{"row":12,"reason":"doublon"},{"row":45,"reason":"telephone"},{"row":88,"reason":"vide"}]');
  select count(*) into n from import_jobs
   where id = job and status = 'termine' and imported_rows = 297 and skipped_rows = 3
     and jsonb_array_length(errors) = 3 and finished_at is not null;
  perform assert(n = 1,
    'le compte rendu dit combien de lignes sont passées et pourquoi les autres non');

  select count(*) into n from import_jobs where id = job and mapping ->> 'phone' = '2';
  perform assert(n = 1,
    'la correspondance des colonnes reste : le même fichier se rejoue sans la refaire');

  reset role;
  perform test_login(u_far, a1, 'agent', o_sfax);
  set local role authenticated;
  select count(*) into n from import_jobs;
  perform assert(n = 0, 'un import de Tunis ne se lit pas depuis Sfax');

  -- ---------------------------------------------------------------
  -- 8. L'anonyme n'a rien
  -- ---------------------------------------------------------------
  reset role;
  perform assert(not has_function_privilege('anon', 'document_payload(text, uuid)', 'execute'),
    'un anonyme ne rassemble pas le contenu d''un document');
  perform assert(not has_function_privilege('anon', 'document_trace(text, text, uuid, text, text, text, text, uuid)', 'execute'),
    'un anonyme ne pose pas de trace');
  perform assert(not has_table_privilege('anon', 'generated_documents', 'select'),
    'un anonyme ne lit pas le registre des impressions');
  perform assert(not has_table_privilege('authenticated', 'generated_documents', 'update'),
    'personne ne modifie une trace, pas même un propriétaire');

  select count(*) into n from pg_class
   where relname in ('document_templates','generated_documents','import_jobs')
     and relrowsecurity and relforcerowsecurity;
  perform assert(n = 3, 'les trois tables ont la sécurité au niveau des lignes, activée et forcée');

  -- ---------------------------------------------------------------
  -- Ménage
  -- ---------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  delete from agencies where id in (a1, a2);
  delete from auth.users where id in (u_owner, u_agent, u_far, u_other);
  raise notice '--- banc des documents : tout est vert ---';
end $$;
