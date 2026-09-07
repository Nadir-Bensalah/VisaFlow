-- 0010 · Le cloisonnement.
--
-- Trois règles tenues partout :
--   1. Une politique par opération, jamais un `for all` unique. Lire n'est pas
--      écrire, et `with check` doit exister sur toute insertion.
--   2. L'agence, le rôle et le bureau viennent du jeton (voir 0001).
--   3. Ce qui n'a pas de politique est refusé. C'est le cas voulu pour les
--      codes à usage unique, les appareils clients et les compteurs d'appels :
--      seules les fonctions SECURITY DEFINER y touchent.

-- ------------------------------------------------------------------
-- Activation
-- ------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'agencies','offices','profiles','checklists','checklist_versions',
    'stage_definitions','visa_types','message_templates','automation_rules',
    'automation_firings','partners','clients','case_groups','cases',
    'case_documents','case_notes','passport_custody','shipments','shipment_lots',
    'shipment_documents','shipment_events','payments','cash_sessions',
    'cash_movements','receipts','shipment_finance','partner_commissions',
    'messages','appointments','tasks','client_requests','otp_codes',
    'client_devices','rate_limits','activity_events','document_access_log',
    'consents','retention_policies','reference_counters'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- ------------------------------------------------------------------
-- Le tronc commun : lecture par agence, écriture par capacité
-- ------------------------------------------------------------------

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      -- table, capacité d'écriture
      ('checklists',        'catalog:manage'),
      ('checklist_versions','catalog:manage'),
      ('stage_definitions', 'catalog:manage'),
      ('visa_types',        'catalog:manage'),
      ('message_templates', 'catalog:manage'),
      ('automation_rules',  'automation:manage'),
      ('automation_firings','automation:manage'),
      ('partners',          'settings:manage'),
      ('case_groups',       'case:create'),
      ('case_notes',        'case:write'),
      ('passport_custody',  'case:write'),
      ('shipment_lots',     'shipment:write'),
      ('shipment_documents','shipment:write'),
      ('shipment_events',   'shipment:write'),
      ('cash_sessions',     'payment:write'),
      ('cash_movements',    'payment:write'),
      ('receipts',          'payment:write'),
      ('partner_commissions','finance:global'),
      ('appointments',      'case:write'),
      ('tasks',             'case:write'),
      ('consents',          'client:write')
    ) as v(tbl, cap)
  loop
    execute format($f$
      create policy %1$s_select on %1$I for select to authenticated
        using (agency_id = auth_agency_id() and auth_can('case:read'))
    $f$, spec.tbl);
    execute format($f$
      create policy %1$s_insert on %1$I for insert to authenticated
        with check (agency_id = auth_agency_id() and auth_can(%2$L))
    $f$, spec.tbl, spec.cap);
    execute format($f$
      create policy %1$s_update on %1$I for update to authenticated
        using (agency_id = auth_agency_id() and auth_can(%2$L))
        with check (agency_id = auth_agency_id())
    $f$, spec.tbl, spec.cap);
    execute format($f$
      create policy %1$s_delete on %1$I for delete to authenticated
        using (agency_id = auth_agency_id() and auth_role() in ('owner','manager'))
    $f$, spec.tbl);
  end loop;
end $$;

-- ------------------------------------------------------------------
-- L'agence elle-même
-- ------------------------------------------------------------------
-- Oubliée, elle laisse n'importe quel compte lire et modifier la ligne d'une
-- autre agence, slug compris.

create policy agencies_select on agencies for select to authenticated
  using (id = auth_agency_id());
create policy agencies_update on agencies for update to authenticated
  using (id = auth_agency_id() and auth_can('settings:manage'))
  with check (id = auth_agency_id());

create policy offices_select on offices for select to authenticated
  using (agency_id = auth_agency_id());
create policy offices_write on offices for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('settings:manage'));
create policy offices_update on offices for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('settings:manage'))
  with check (agency_id = auth_agency_id());

-- ------------------------------------------------------------------
-- Les comptes
-- ------------------------------------------------------------------
-- Sans garde, un `viewer` s'accorde le rôle de propriétaire en une requête, et
-- toute la matrice tombe.

create policy profiles_select on profiles for select to authenticated
  using (agency_id = auth_agency_id());
create policy profiles_insert on profiles for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('team:manage'));
create policy profiles_update on profiles for update to authenticated
  using (agency_id = auth_agency_id() and (auth_can('team:manage') or id = auth.uid()))
  with check (agency_id = auth_agency_id());
create policy profiles_delete on profiles for delete to authenticated
  using (agency_id = auth_agency_id() and auth_can('team:manage') and id <> auth.uid());

create or replace function guard_profile_change() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then return new; end if;
  -- On ne change ni son propre rôle, ni son agence, jamais.
  if new.agency_id is distinct from old.agency_id then
    raise exception 'changement d''agence interdit';
  end if;
  if new.role is distinct from old.role and not auth_can('team:manage') then
    raise exception 'changement de rôle interdit';
  end if;
  if new.role is distinct from old.role and new.id = auth.uid() then
    raise exception 'on ne se promeut pas soi-même';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on profiles;
create trigger profiles_guard before update on profiles
  for each row execute function guard_profile_change();

-- ------------------------------------------------------------------
-- Ce qui porte un bureau : clients, dossiers, cargaisons
-- ------------------------------------------------------------------

create policy clients_select on clients for select to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and deleted_at is null);
create policy clients_insert on clients for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('client:write'));
create policy clients_update on clients for update to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('client:write'))
  with check (agency_id = auth_agency_id());

create policy cases_select on cases for select to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id));
create policy cases_insert on cases for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('case:create'));
create policy cases_update on cases for update to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('case:write'))
  with check (agency_id = auth_agency_id());
create policy cases_delete on cases for delete to authenticated
  using (agency_id = auth_agency_id() and auth_role() = 'owner');

create policy shipments_select on shipments for select to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id));
create policy shipments_insert on shipments for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('shipment:write'));
create policy shipments_update on shipments for update to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('shipment:write'))
  with check (agency_id = auth_agency_id());

-- Les pièces suivent leur dossier, sans jamais élargir le périmètre.
create policy case_documents_select on case_documents for select to authenticated
  using (exists (select 1 from cases c where c.id = case_id
                 and c.agency_id = auth_agency_id() and auth_sees_office(c.office_id)));
create policy case_documents_insert on case_documents for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('case:write'));
create policy case_documents_update on case_documents for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('doc:validate'))
  with check (agency_id = auth_agency_id());

-- ------------------------------------------------------------------
-- L'argent
-- ------------------------------------------------------------------
-- Un agent encaisse au comptoir : il voit donc les règlements de son bureau.
-- Le coût du fret et la marge, eux, vivent dans leur propre table, parce
-- qu'une politique filtre des lignes et jamais des colonnes.

create policy payments_select on payments for select to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id));
create policy payments_insert on payments for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('payment:write'));
create policy payments_update on payments for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('payment:write'))
  with check (agency_id = auth_agency_id());

create policy shipment_finance_select on shipment_finance for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('finance:global'));
create policy shipment_finance_write on shipment_finance for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('finance:global'));
create policy shipment_finance_update on shipment_finance for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('finance:global'))
  with check (agency_id = auth_agency_id());

-- ------------------------------------------------------------------
-- Messages et demandes
-- ------------------------------------------------------------------

create policy messages_select on messages for select to authenticated
  using (agency_id = auth_agency_id());
create policy messages_insert on messages for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('message:send'));
create policy messages_update on messages for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('message:send'))
  with check (agency_id = auth_agency_id());

create policy client_requests_select on client_requests for select to authenticated
  using (agency_id = auth_agency_id());
create policy client_requests_update on client_requests for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('case:create'))
  with check (agency_id = auth_agency_id());
-- L'insertion vient du portail, par une fonction SECURITY DEFINER. Aucun
-- compte authentifié n'insère ici directement.

-- ------------------------------------------------------------------
-- Le journal, en ajout seul
-- ------------------------------------------------------------------

create policy activity_events_select on activity_events for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('audit:view'));
create policy activity_events_insert on activity_events for insert to authenticated
  with check (agency_id = auth_agency_id());
-- Aucune politique de mise à jour ni de suppression. Pour personne.

create policy document_access_log_select on document_access_log for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('audit:view'));
create policy document_access_log_insert on document_access_log for insert to authenticated
  with check (agency_id = auth_agency_id());

create policy retention_select on retention_policies for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('settings:view'));
create policy retention_update on retention_policies for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('settings:manage'))
  with check (agency_id = auth_agency_id());

create policy counters_select on reference_counters for select to authenticated
  using (agency_id = auth_agency_id());

-- otp_codes, client_devices et rate_limits : aucune politique, donc aucun
-- accès depuis un compte authentifié. Volontaire.
