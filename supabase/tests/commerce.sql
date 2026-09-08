-- Banc d'essai du module commercial.
--
-- Ce qu'il garde : un total qui ne se calcule pas deux fois de la même façon,
-- une TVA qui suit la remise, une facture dont le solde descend des
-- règlements, une conversion qui ne se fait qu'une fois, et une agence qui ne
-- voit pas les devis d'une autre.
--
-- Le banc monte son propre décor et le démonte à la fin : il peut tourner
-- autant de fois qu'on veut sur la même base.

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
  a1 uuid; a2 uuid; o1 uuid; o2 uuid;
  u_owner uuid; u_agent uuid; u_other uuid;
  ck uuid; vt uuid; cl uuid; k1 uuid;
  q1 uuid; l1 uuid; l2 uuid; f1 uuid; f2 uuid;
  n int; ok boolean; m jsonb; s jsonb;
  v_num text; v_dec numeric;
begin
  -- ---------------------------------------------------------------
  -- Le décor : deux agences, un dossier, un client
  -- ---------------------------------------------------------------
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_owner;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_agent;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_other;

  insert into agencies (slug, name, services) values ('banc-com-1', 'Banc Commerce', '{visas,fret}') returning id into a1;
  insert into agencies (slug, name, services) values ('banc-com-2', 'Banc Voisin', '{visas}') returning id into a2;

  insert into offices (agency_id, name, country, country_code) values (a1, 'Tunis', 'Tunisie', 'TN') returning id into o1;
  insert into offices (agency_id, name, country, country_code) values (a2, 'Sfax', 'Tunisie', 'TN') returning id into o2;

  insert into profiles (id, agency_id, office_id, name, role) values
    (u_owner, a1, o1, 'Slim',  'owner'),
    (u_agent, a1, o1, 'Hatem', 'agent'),
    (u_other, a2, o2, 'Rania', 'owner');

  insert into checklists (agency_id, name) values (a1, '{"fr":"Schengen"}') returning id into ck;
  insert into visa_types (agency_id, country_code, country, label, checklist_id)
    values (a1, 'FR', '{"fr":"France"}', '{"fr":"Tourisme"}', ck) returning id into vt;
  insert into clients (agency_id, office_id, first_name, last_name, phone)
    values (a1, o1, 'Amine', 'Ben Salah', '+216 20 000 077') returning id into cl;
  insert into cases (agency_id, reference, client_id, visa_type_id, office_id)
    values (a1, 'VF-BANC-COM', cl, vt, o1) returning id into k1;

  -- ---------------------------------------------------------------
  -- 1. Le catalogue de départ
  -- ---------------------------------------------------------------
  perform seed_services(a1);
  select count(*) into n from services where agency_id = a1;
  perform assert(n = 13, 'le catalogue de départ pose treize services');

  select count(*) into n from services where agency_id = a1 and default_price <> 0;
  perform assert(n = 0, 'aucun prix n''est inventé : tout arrive à zéro');

  select count(*) into n from services where agency_id = a1 and tax_rate = 19;
  perform assert(n = 13, 'la TVA tunisienne de 19 % sert de défaut modifiable');

  perform seed_services(a1);
  select count(*) into n from services where agency_id = a1;
  perform assert(n = 13, 'semer deux fois ne double pas le catalogue');

  -- ---------------------------------------------------------------
  -- 2. Le devis, ses lignes et ses totaux
  -- ---------------------------------------------------------------
  perform test_login(u_owner, a1, 'owner', o1);
  set local role authenticated;

  insert into quotes (agency_id, office_id, client_id, kind, case_id, currency, created_by)
    values (a1, o1, cl, 'visa', k1, 'TND', u_owner) returning id, number into q1, v_num;
  perform assert(v_num like 'DEV-%-0001', 'le devis reçoit son numéro du serveur : ' || v_num);

  insert into quote_items (agency_id, quote_id, description, quantity, unit_price, tax_rate, line_no)
    values (a1, q1, 'Assistance visa', 2, 100, 19, 1) returning id into l1;

  select line_total into v_dec from quote_items where id = l1;
  perform assert(v_dec = 238.00, 'la ligne est totalisée par le serveur, TVA comprise');

  select count(*) into n from quotes where id = q1 and subtotal = 200 and tax_total = 38 and total = 238;
  perform assert(n = 1, 'le devis totalise 200 HT, 38 de TVA, 238 TTC');

  -- Une deuxième ligne, avec sa propre remise et sans TVA.
  insert into quote_items (agency_id, quote_id, description, quantity, unit_price, tax_rate, discount, line_no)
    values (a1, q1, 'Traduction', 1, 50, 0, 10, 2) returning id into l2;

  select count(*) into n from quotes where id = q1 and subtotal = 240 and tax_total = 38 and total = 278;
  perform assert(n = 1, 'la remise de ligne se déduit avant la TVA');

  -- La remise globale est hors taxe : elle réduit aussi la base taxable.
  update quotes set discount = 40 where id = q1;
  select count(*) into n from quotes where id = q1 and subtotal = 200 and tax_total = 31.67 and total = 231.67;
  perform assert(n = 1, 'la remise globale réduit la TVA dans la même proportion');

  -- Une ligne rangée sort du total, sans disparaître de la trace.
  update quote_items set deleted_at = now() where id = l2;
  select count(*) into n from quotes where id = q1 and subtotal = 160 and tax_total = 30.40 and total = 190.40;
  perform assert(n = 1, 'une ligne rangée ne compte plus dans le total');
  select count(*) into n from quote_items where id = l2;
  perform assert(n = 1, 'la ligne rangée existe toujours : aucune suppression dure');

  update quotes set discount = 0 where id = q1;
  select count(*) into n from quotes where id = q1 and total = 238;
  perform assert(n = 1, 'retirer la remise remet le total d''origine');

  -- ---------------------------------------------------------------
  -- 3. La conversion en facture
  -- ---------------------------------------------------------------
  ok := false;
  begin
    perform quote_to_invoice(q1, 30);
  exception when others then ok := true;
  end;
  perform assert(ok, 'un devis en brouillon ne se convertit pas');

  update quotes set status = 'accepte', sent_at = now(), decided_at = now() where id = q1;
  f1 := quote_to_invoice(q1, 30);

  select number into v_num from invoices where id = f1;
  perform assert(v_num like 'FAC-%-0001', 'la facture reçoit sa propre suite : ' || v_num);

  select count(*) into n from invoice_items where invoice_id = f1;
  perform assert(n = 1, 'seules les lignes vivantes du devis sont recopiées');

  select count(*) into n from invoices
   where id = f1 and subtotal = 200 and tax_total = 38 and total = 238
     and balance_due = 238 and paid_amount = 0 and status = 'emise';
  perform assert(n = 1, 'la facture reprend les totaux du devis, solde entier dû');

  select count(*) into n from invoices where id = f1 and due_date = current_date + 30;
  perform assert(n = 1, 'l''échéance suit le délai demandé');

  ok := false;
  begin
    perform quote_to_invoice(q1, 30);
  exception when others then ok := true;
  end;
  perform assert(ok, 'un devis déjà converti ne se convertit pas deux fois');

  -- ---------------------------------------------------------------
  -- 4. L'encaissement recalcule le solde, jamais la saisie
  -- ---------------------------------------------------------------
  insert into payments (agency_id, case_id, client_id, invoice_id, label, kind, amount, currency, state, method, at)
    values (a1, k1, cl, f1, '{"fr":"Acompte"}', 'honoraires', 100, 'TND', 'regle', 'especes', now());

  select count(*) into n from invoices
   where id = f1 and paid_amount = 100 and balance_due = 138 and status = 'partiellement_reglee';
  perform assert(n = 1, 'un acompte descend dans le solde et change l''état');

  -- Un règlement dans une autre devise fausserait le solde.
  ok := false;
  begin
    insert into payments (agency_id, case_id, invoice_id, label, kind, amount, currency, state)
      values (a1, k1, f1, '{"fr":"Euros"}', 'honoraires', 50, 'EUR', 'regle');
  exception when others then ok := true;
  end;
  perform assert(ok, 'un règlement d''une autre devise ne s''impute pas à la facture');

  insert into payments (agency_id, case_id, client_id, invoice_id, label, kind, amount, currency, state, method, at)
    values (a1, k1, cl, f1, '{"fr":"Solde"}', 'honoraires', 138, 'TND', 'regle', 'virement', now());

  select count(*) into n from invoices
   where id = f1 and paid_amount = 238 and balance_due = 0 and status = 'reglee';
  perform assert(n = 1, 'le solde à zéro fait passer la facture en réglée');

  -- Le solde ne se saisit pas : une écriture directe est écrasée au recalcul.
  update invoices set balance_due = 999 where id = f1;
  perform invoice_totals(f1);
  select count(*) into n from invoices where id = f1 and balance_due = 0;
  perform assert(n = 1, 'un solde saisi à la main ne survit pas au recalcul');

  -- ---------------------------------------------------------------
  -- 5. L'impayé et le retard
  -- ---------------------------------------------------------------
  insert into invoices (agency_id, office_id, client_id, currency, due_date, status, created_by)
    values (a1, o1, cl, 'TND', current_date - 10, 'emise', u_owner) returning id into f2;
  insert into invoice_items (agency_id, invoice_id, description, quantity, unit_price, tax_rate, line_no)
    values (a1, f2, 'Montage du dossier', 1, 100, 0, 1);

  select count(*) into n from invoices where id = f2 and total = 100 and balance_due = 100 and status = 'en_retard';
  perform assert(n = 1, 'une échéance passée avec du solde bascule en retard');

  -- ---------------------------------------------------------------
  -- 6. Les dépenses et la marge
  -- ---------------------------------------------------------------
  insert into expenses (agency_id, office_id, case_id, category, supplier_name,
                        amount, currency, fx_rate, spent_on, created_by)
    values (a1, o1, k1, 'sous_traitance', 'Correspondant Paris', 50, 'EUR', 3.4, current_date, u_owner);

  select count(*) into n from expenses where case_id = k1 and amount_base = 170.00;
  perform assert(n = 1, 'la dépense en devise est convertie au taux du jour de la dépense');

  m := case_margin(k1);
  perform assert((m->>'billed')::numeric = 200, 'la marge compte le hors taxe, jamais la TVA collectée');
  perform assert((m->>'collected')::numeric = 238, 'l''encaissé reste le montant réellement reçu, TTC');
  perform assert((m->>'expenses')::numeric = 170, 'les dépenses du dossier entrent dans la marge');
  perform assert((m->>'margin')::numeric = 30, 'la marge est le facturé HT moins les dépenses');
  perform assert((m->>'margin_pct')::numeric = 15.00, 'la marge en pourcentage suit');

  s := agency_finance_summary(null, current_date - 1, current_date + 1);
  perform assert((s->>'billed')::numeric = 300, 'le résumé additionne les deux factures, hors taxe');
  perform assert((s->>'unpaid')::numeric = 100, 'l''impayé ne retient que ce qui reste dû');
  perform assert((s->>'margin')::numeric = 130, 'la marge de l''agence se calcule, elle ne se stocke pas');

  s := agency_finance_summary(o1, current_date - 1, current_date + 1);
  perform assert((s->>'billed')::numeric = 300, 'le résumé d''un bureau retient ses propres factures');

  -- ---------------------------------------------------------------
  -- 7. Le cloisonnement
  -- ---------------------------------------------------------------
  reset role;
  perform test_login(u_other, a2, 'owner', o2);
  set local role authenticated;

  select count(*) into n from quotes;
  perform assert(n = 0, 'une autre agence ne voit aucun devis');
  select count(*) into n from invoices;
  perform assert(n = 0, 'une autre agence ne voit aucune facture');
  select count(*) into n from services;
  perform assert(n = 0, 'une autre agence ne voit aucun service');
  select count(*) into n from expenses;
  perform assert(n = 0, 'une autre agence ne voit aucune dépense');

  ok := false;
  begin
    m := case_margin(k1);
  exception when others then ok := true;
  end;
  perform assert(ok, 'la marge d''un dossier étranger est refusée');

  ok := false;
  begin
    perform quote_to_invoice(q1, 30);
  exception when others then ok := true;
  end;
  perform assert(ok, 'on ne convertit pas le devis d''une autre agence');

  s := agency_finance_summary(null, current_date - 1, current_date + 1);
  perform assert((s->>'billed')::numeric = 0, 'le résumé d''une agence vide reste vide');

  -- L'agent encaisse, il ne lit pas le coût de revient.
  reset role;
  perform test_login(u_agent, a1, 'agent', o1);
  set local role authenticated;
  select count(*) into n from expenses;
  perform assert(n = 0, 'un agent ne lit pas les dépenses de l''agence');
  select count(*) into n from quotes;
  perform assert(n = 1, 'le même agent voit bien les devis de son bureau');

  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------------------
  -- 8. Les droits de table
  -- ---------------------------------------------------------------
  perform assert(not has_table_privilege('authenticated', 'quotes', 'delete'),
                 'authenticated n''efface jamais un devis');
  perform assert(not has_table_privilege('authenticated', 'invoices', 'delete'),
                 'authenticated n''efface jamais une facture');
  perform assert(not has_table_privilege('anon', 'invoices', 'select'),
                 'anon ne lit aucune facture');
  perform assert(not has_function_privilege('anon', 'quote_to_invoice(uuid, integer)', 'execute'),
                 'anon ne convertit aucun devis');

  -- ---------------------------------------------------------------
  -- Le ménage
  -- ---------------------------------------------------------------
  delete from agencies where id in (a1, a2);
  delete from auth.users where id in (u_owner, u_agent, u_other);

  raise notice '--- banc du commerce : tout est vert ---';
end $$;
