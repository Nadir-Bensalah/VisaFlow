-- 0012 · Les gestes du métier, côté serveur.
-- Tout ce qui doit être atomique, ou que le navigateur n'a pas le droit de
-- décider : ouvrir un dossier, convertir une demande, encaisser, relancer.

-- ------------------------------------------------------------------
-- Ouvrir un dossier
-- ------------------------------------------------------------------
-- Copie la version de liste de pièces annoncée au client, et crée les lignes
-- de règlement. Sans elles, le solde reste dû à vie et la relance tire dans le
-- vide : c'était le premier défaut relevé sur la maquette.

create or replace function open_case(
  p_client uuid, p_visa_type uuid, p_assignee uuid,
  p_travel date, p_source text, p_group uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a uuid := auth_agency_id();
  v visa_types; c clients; ver checklist_versions; new_id uuid; ref text;
begin
  if not auth_can('case:create') then raise exception 'droit insuffisant'; end if;
  select * into v from visa_types where id = p_visa_type and agency_id = a;
  select * into c from clients where id = p_client and agency_id = a;
  if v.id is null or c.id is null then raise exception 'client ou type de visa inconnu'; end if;

  select * into ver from checklist_versions
   where checklist_id = v.checklist_id order by version desc limit 1;

  ref := next_reference(a, 'case');

  insert into cases (
    agency_id, reference, client_id, group_id, visa_type_id, office_id, assignee_id,
    checklist_version_id, travel_date, due_at, source,
    amount_total, currency, partner_id
  ) values (
    a, ref, p_client, p_group, p_visa_type, c.office_id, coalesce(p_assignee, auth.uid()),
    ver.id, p_travel,
    case when p_travel is not null then p_travel - v.processing_days else null end,
    coalesce(p_source, 'comptoir'),
    v.fee_agency + v.fee_consulate, v.currency, c.partner_id
  ) returning id into new_id;

  -- Les pièces, recopiées. Si le consulat change ses exigences demain, ce
  -- dossier garde la liste qui lui a été annoncée.
  insert into case_documents (agency_id, case_id, key, label, help, required, expires_at)
  select a, new_id, i ->> 'key', i -> 'label', i -> 'help',
         coalesce((i ->> 'required')::boolean, true),
         case when (i ->> 'validity_days') is not null
              then current_date + ((i ->> 'validity_days')::int || ' days')::interval
         end
  from jsonb_array_elements(coalesce(ver.items, '[]')) as i;

  -- Deux lignes de règlement : ce qui revient à l'agence, et ce qu'elle
  -- encaisse pour le reverser. Les confondre fausse tous les rapports.
  insert into payments (agency_id, case_id, client_id, label, kind, amount, currency, due_at, office_id)
  values
    (a, new_id, p_client, '{"fr":"Honoraires agence","en":"Agency fee"}', 'honoraires', v.fee_agency, v.currency, p_travel, c.office_id),
    (a, new_id, p_client, '{"fr":"Frais de consulat","en":"Consulate fee"}', 'debours', v.fee_consulate, v.currency, p_travel, c.office_id);

  if c.partner_id is not null then
    insert into partner_commissions (agency_id, partner_id, case_id, amount, currency)
    select a, p.id, new_id,
           case p.commission_kind when 'fixe' then p.commission_value
                else round(v.fee_agency * p.commission_value / 100, 2) end,
           v.currency
    from partners p where p.id = c.partner_id;
  end if;

  insert into activity_events (agency_id, case_id, client_id, actor_id, type, detail)
  values (a, new_id, p_client, auth.uid(), 'dossier_cree',
          jsonb_build_object('fr', 'Dossier ' || ref || ' ouvert.'));

  return new_id;
end $$;

-- ------------------------------------------------------------------
-- Convertir une demande
-- ------------------------------------------------------------------

create or replace function convert_request(p_request uuid, p_assignee uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  a uuid := auth_agency_id(); r client_requests; cid uuid; kase uuid;
begin
  if not auth_can('case:create') then raise exception 'droit insuffisant'; end if;
  select * into r from client_requests where id = p_request and agency_id = a;
  if r.id is null then raise exception 'demande inconnue'; end if;

  -- Un client existant est reconnu à son numéro, jamais à son nom.
  select id into cid from clients where agency_id = a and phone = r.phone;
  if cid is null then
    insert into clients (agency_id, office_id, first_name, last_name, phone, email, locale, phone_verified_at)
    values (a, auth_office_id(), r.first_name, r.last_name, r.phone, r.email, r.locale,
            case when r.phone_verified then now() end)
    returning id into cid;
  end if;

  kase := open_case(cid, r.visa_type_id, p_assignee, r.travel_date, 'site', null);

  update client_requests
     set status = 'convertie', handled_by = auth.uid(), handled_at = now(),
         client_id = cid, case_id = kase
   where id = p_request;

  return kase;
end $$;

-- ------------------------------------------------------------------
-- Encaisser
-- ------------------------------------------------------------------

create or replace function collect_payment(p_payment uuid, p_method text, p_session uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare a uuid := auth_agency_id(); pay payments;
begin
  if not auth_can('payment:write') then raise exception 'droit insuffisant'; end if;
  select * into pay from payments where id = p_payment and agency_id = a;
  if pay.id is null then raise exception 'règlement inconnu'; end if;
  if pay.state = 'regle' then return; end if;

  update payments
     set state = 'regle', method = p_method, at = now(),
         collected_by = auth.uid(), cash_session_id = p_session,
         receipt_no = coalesce(receipt_no, next_reference(a, 'receipt'))
   where id = p_payment;

  if pay.case_id is not null then
    update cases set amount_paid = least(amount_total, amount_paid + pay.amount), updated_at = now()
     where id = pay.case_id;
  end if;

  if p_method = 'especes' and p_session is not null then
    insert into cash_movements (agency_id, session_id, payment_id, direction, amount, currency, reason, author_id)
    values (a, p_session, p_payment, 'entree', pay.amount, pay.currency, 'encaissement', auth.uid());
  end if;

  insert into activity_events (agency_id, case_id, actor_id, type, detail)
  values (a, pay.case_id, auth.uid(), 'paiement_encaisse',
          jsonb_build_object('fr', 'Encaissement de ' || pay.amount || ' ' || pay.currency));
end $$;

-- ------------------------------------------------------------------
-- Le passeport ne sort pas si le solde n'est pas réglé
-- ------------------------------------------------------------------
-- Ça arrive tous les mois. Une fois le passeport parti, la relance est vaine.

create or replace function release_passport(p_custody uuid, p_force boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare a uuid := auth_agency_id(); cu passport_custody; due numeric;
begin
  select * into cu from passport_custody where id = p_custody and agency_id = a;
  if cu.id is null then raise exception 'dépôt inconnu'; end if;

  select coalesce(sum(amount), 0) into due
    from payments where case_id = cu.case_id and state <> 'regle';

  if due > 0 and not p_force then
    raise exception 'solde de % non réglé', due using errcode = 'P0003';
  end if;

  update passport_custody
     set returned_at = now(), returned_by = auth.uid(), location = 'rendu'
   where id = p_custody;

  insert into activity_events (agency_id, case_id, actor_id, type, detail)
  values (a, cu.case_id, auth.uid(), 'passeport_rendu',
          jsonb_build_object('fr', case when due > 0 then 'Passeport rendu malgré un solde de ' || due
                                        else 'Passeport rendu, solde réglé.' end));
end $$;

-- ------------------------------------------------------------------
-- Les relances, avec le garde-fou
-- ------------------------------------------------------------------
-- Une seule relance par dossier et par fenêtre, toutes règles confondues.
-- Appelée par une tâche planifiée, avec un verrou : deux postes ouverts ne
-- doivent pas relancer deux fois le même client.

create or replace function run_automations(p_agency uuid, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r automation_rules; c cases; fired int := 0; skipped int := 0; touched jsonb := '[]';
begin
  if not pg_try_advisory_xact_lock(hashtext('automations:' || p_agency)) then
    return jsonb_build_object('fired', 0, 'note', 'déjà en cours');
  end if;

  for r in select * from automation_rules where agency_id = p_agency and active loop
    for c in
      select * from cases where agency_id = p_agency and status = 'ouvert'
    loop
      -- Le garde-fou : ce dossier a-t-il déjà été touché récemment ?
      if exists (
        select 1 from automation_firings f
        where f.rule_id = r.id and f.subject = c.id::text
          and f.fired_at > now() - (r.cooldown_hours || ' hours')::interval
      ) then
        skipped := skipped + 1;
        continue;
      end if;

      if not automation_matches(r, c) then continue; end if;

      fired := fired + 1;
      touched := touched || jsonb_build_object('rule', r.name -> 'fr', 'case', c.reference);

      if not p_dry_run then
        insert into automation_firings (agency_id, rule_id, subject) values (p_agency, r.id, c.id::text);
        perform apply_automation(r, c);
      end if;
    end loop;

    if not p_dry_run and fired > 0 then
      update automation_rules set runs = runs + 1, last_run_at = now() where id = r.id;
    end if;
  end loop;

  return jsonb_build_object('fired', fired, 'skipped', skipped, 'details', touched);
end $$;

create or replace function automation_matches(r automation_rules, c cases)
returns boolean language plpgsql stable set search_path = public as $$
declare d int := coalesce((r.trigger ->> 'days')::int, 0);
begin
  return case r.trigger ->> 'type'
    when 'piece_manquante_depuis' then exists (
      select 1 from case_documents cd where cd.case_id = c.id and cd.required
        and cd.state in ('manquante','demandee')
        and coalesce(cd.last_reminder_at, cd.requested_at, c.opened_at) < now() - (d || ' days')::interval)
    when 'dossier_sans_activite' then c.updated_at < now() - (d || ' days')::interval
    when 'rendez_vous_dans' then exists (
      select 1 from appointments ap where ap.case_id = c.id and ap.status = 'prevu'
        and ap.at between now() and now() + (d || ' days')::interval)
    when 'passeport_expire_dans' then exists (
      select 1 from clients cl where cl.id = c.client_id
        and cl.passport_expiry is not null
        and cl.passport_expiry < current_date + (d || ' days')::interval)
    when 'depart_dans' then c.travel_date is not null
        and c.travel_date between current_date and current_date + d
        and c.amount_paid < c.amount_total
    when 'solde_impaye_depuis' then c.amount_paid < c.amount_total
        and c.opened_at < now() - (d || ' days')::interval
    when 'etape_atteinte' then c.stage = (r.trigger ->> 'stage')
    else false
  end;
end $$;

create or replace function apply_automation(r automation_rules, c cases)
returns void language plpgsql security definer set search_path = public as $$
declare tpl message_templates; cl clients; body text; piece text;
begin
  select * into cl from clients where id = c.client_id;

  case r.action ->> 'type'
    when 'message_client' then
      select * into tpl from message_templates
       where agency_id = c.agency_id and key = (r.action ->> 'templateKey');
      if tpl.id is null then return; end if;
      select coalesce(d.label ->> cl.locale, d.label ->> 'fr') into piece
        from case_documents d where d.case_id = c.id and d.state <> 'validee' limit 1;
      body := coalesce(tpl.body ->> cl.locale, tpl.body ->> 'fr');
      body := replace(body, '{client}', cl.first_name);
      body := replace(body, '{reference}', c.reference);
      body := replace(body, '{piece}', coalesce(piece, ''));
      body := replace(body, '{montant}', (c.amount_total - c.amount_paid)::text);
      insert into messages (agency_id, case_id, client_id, channel, direction, body, locale, template_key, automated)
      values (c.agency_id, c.id, cl.id, coalesce(r.action ->> 'channel', 'whatsapp'), 'sortant', body, cl.locale, tpl.key, true);

    when 'tache_agent' then
      insert into tasks (agency_id, case_id, assignee_id, title, due_at, automated)
      values (c.agency_id, c.id, c.assignee_id, r.name, now() + interval '1 day', true);

    when 'alerte_interne' then
      insert into messages (agency_id, case_id, client_id, channel, direction, body, locale, automated)
      values (c.agency_id, c.id, cl.id, 'interne', 'sortant',
              coalesce(r.action -> 'text' ->> 'fr', r.name ->> 'fr'), 'fr', true);

    when 'changer_etape' then
      update cases set stage = r.action ->> 'stage', updated_at = now() where id = c.id;

    else null;
  end case;

  insert into activity_events (agency_id, case_id, type, detail, automated)
  values (c.agency_id, c.id, 'automatisation',
          jsonb_build_object('fr', 'Règle « ' || coalesce(r.name ->> 'fr', '') || ' » déclenchée.'), true);
end $$;

-- ------------------------------------------------------------------
-- Le code à usage unique
-- ------------------------------------------------------------------

create or replace function issue_otp(p_agency_slug text, p_phone text, p_purpose text default 'suivi')
returns jsonb language plpgsql security definer set search_path = public as $$
declare a agencies; code text;
begin
  if not rate_allow('otp', p_phone, 5, interval '1 hour') then
    raise exception 'trop de demandes de code' using errcode = 'P0001';
  end if;
  select * into a from agencies where slug = p_agency_slug and deleted_at is null;
  if a.id is null then raise exception 'agence inconnue'; end if;

  code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into otp_codes (agency_id, phone, code_hash, purpose)
  values (a.id, p_phone, crypt(code, gen_salt('bf', 8)), p_purpose);

  -- Le code part par WhatsApp depuis la fonction d'envoi, il ne revient
  -- jamais au navigateur.
  insert into messages (agency_id, client_id, channel, direction, body, locale, template_key, automated, status)
  select a.id, c.id, 'whatsapp', 'sortant',
         replace(coalesce(t.body ->> c.locale, t.body ->> 'fr'), '{code}', code),
         c.locale, 'code_suivi', true, 'file'
    from clients c
    left join message_templates t on t.agency_id = a.id and t.key = 'code_suivi'
   where c.agency_id = a.id and c.phone = p_phone;

  return jsonb_build_object('sent', true, 'expires_in', 600);
end $$;

create or replace function verify_otp(p_agency_slug text, p_phone text, p_code text, p_platform text default 'web')
returns jsonb language plpgsql security definer set search_path = public as $$
declare a agencies; rec otp_codes; device_token text; cid uuid;
begin
  if not rate_allow('otp_verify', p_phone, 10, interval '1 hour') then
    raise exception 'trop de tentatives' using errcode = 'P0001';
  end if;
  select * into a from agencies where slug = p_agency_slug;
  select * into rec from otp_codes
   where agency_id = a.id and phone = p_phone and consumed_at is null and expires_at > now()
   order by created_at desc limit 1;

  if rec.id is null then return jsonb_build_object('ok', false, 'reason', 'expire'); end if;
  if rec.attempts >= rec.max_attempts then return jsonb_build_object('ok', false, 'reason', 'bloque'); end if;

  update otp_codes set attempts = attempts + 1 where id = rec.id;
  if rec.code_hash <> crypt(p_code, rec.code_hash) then
    return jsonb_build_object('ok', false, 'reason', 'faux');
  end if;

  update otp_codes set consumed_at = now() where id = rec.id;
  select id into cid from clients where agency_id = a.id and phone = p_phone;

  device_token := encode(gen_random_bytes(32), 'hex');
  insert into client_devices (agency_id, client_id, phone, token_hash, platform)
  values (a.id, cid, p_phone, encode(digest(device_token, 'sha256'), 'hex'), p_platform);

  return jsonb_build_object('ok', true, 'device_token', device_token, 'client_id', cid);
end $$;

-- Ce que voit un client reconnu : ses dossiers, ses cargaisons, ses demandes.
create or replace function portal_mine(p_agency_slug text, p_device_token text)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare a agencies; d client_devices;
begin
  select * into a from agencies where slug = p_agency_slug;
  select * into d from client_devices
   where agency_id = a.id and token_hash = encode(digest(p_device_token, 'sha256'), 'hex')
     and revoked_at is null and expires_at > now();
  if d.id is null then return jsonb_build_object('ok', false); end if;

  return jsonb_build_object(
    'ok', true,
    'cases', (select coalesce(jsonb_agg(jsonb_build_object(
        'reference', c.reference, 'stage', c.stage, 'status', c.status, 'token', c.portal_token)), '[]')
      from cases c where c.client_id = d.client_id),
    'shipments', (select coalesce(jsonb_agg(jsonb_build_object(
        'reference', s.reference, 'stage', s.stage, 'token', s.portal_token)), '[]')
      from shipment_lots l join shipments s on s.id = l.shipment_id where l.client_id = d.client_id),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object(
        'reference', r.reference, 'status', r.status, 'token', r.portal_token)), '[]')
      from client_requests r where r.phone = d.phone and r.agency_id = a.id)
  );
end $$;

grant execute on function issue_otp, verify_otp, portal_mine to anon, authenticated;
grant execute on function open_case, convert_request, collect_payment, release_passport, run_automations to authenticated;
