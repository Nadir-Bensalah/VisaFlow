-- 0007 · L'identité du client final, et le portail.
--
-- Le numéro de téléphone est l'identité, pas un compte avec un mot de passe :
-- presque aucun de ces clients n'a d'adresse e-mail active, tous ont WhatsApp.
--
-- Trois niveaux :
--   0. Le lien à jeton ouvre le suivi non sensible. Un lien qui fuite ne
--      fait fuiter qu'un état d'avancement.
--   1. Un code à usage unique ouvre la couche sensible, puis l'appareil est
--      reconnu 90 jours. Le code n'est donc demandé qu'une fois par appareil,
--      ce qui rend le coût d'envoi tenable.
--   2. Le comptoir, seul niveau qui autorise un changement de numéro.

create table if not exists otp_codes (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  phone       text not null,
  -- Jamais le code en clair. Il ne sert qu'à être comparé.
  code_hash   text not null,
  purpose     text not null default 'suivi' check (purpose in ('suivi','demande','changement')),
  attempts    int not null default 0,
  max_attempts int not null default 5,
  expires_at  timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz,
  created_at  timestamptz not null default now(),
  source_ip   inet
);
create index if not exists otp_codes_lookup on otp_codes (agency_id, phone, created_at desc);

create table if not exists client_devices (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies on delete cascade,
  client_id     uuid references clients on delete cascade,
  phone         text not null,
  -- Jeton d'appareil, haché. Le navigateur ou l'app garde le clair.
  token_hash    text not null unique,
  label         text,
  platform      text check (platform in ('web','ios','android')),
  push_token    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  expires_at    timestamptz not null default now() + interval '90 days',
  revoked_at    timestamptz
);
create index if not exists client_devices_phone on client_devices (agency_id, phone) where revoked_at is null;

-- Compteur d'appels, par agence et par sujet. Un compteur côté navigateur se
-- remet à zéro en rechargeant la page.
create table if not exists rate_limits (
  bucket     text not null,
  subject    text not null,
  window_start timestamptz not null,
  count      int not null default 0,
  primary key (bucket, subject, window_start)
);

create or replace function rate_allow(p_bucket text, p_subject text, p_limit int, p_window interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := date_trunc('minute', now()) - (extract(epoch from now())::bigint % greatest(1, extract(epoch from p_window)::bigint)) * interval '1 second';
  c int;
begin
  insert into rate_limits (bucket, subject, window_start, count)
  values (p_bucket, p_subject, w, 1)
  on conflict (bucket, subject, window_start) do update set count = rate_limits.count + 1
  returning count into c;
  return c <= p_limit;
end $$;

-- ------------------------------------------------------------------
-- Les points d'entrée du portail
-- ------------------------------------------------------------------
-- Le portail n'interroge jamais les tables. Il appelle ces fonctions, qui ne
-- rendent que la projection du dossier correspondant au jeton, et rien d'autre.
-- La référence, elle, n'ouvre plus rien : elle est séquentielle, donc
-- énumérable.

-- Volatile, et non STABLE : cette fonction journalise chaque consultation.
-- Sans ce journal, un jeton qui fuite s'utilise sans laisser de trace.
create or replace function portal_case(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not rate_allow('portal_case', coalesce(p_token, 'nul'), 60, interval '1 hour') then
    raise exception 'trop de tentatives' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'case', jsonb_build_object(
      'reference', c.reference,
      'stage', c.stage,
      'status', c.status,
      'travel_date', c.travel_date,
      'decision_at', c.decision_at,
      'refusal_reason', c.refusal_reason,
      'balance', c.amount_total - c.amount_paid,
      'currency', c.currency
    ),
    'agency', jsonb_build_object('name', a.name, 'mark', a.mark, 'accent', a.accent, 'inpdp_ref', a.inpdp_ref),
    'visa', jsonb_build_object('country', v.country, 'label', v.label, 'processing_days', v.processing_days),
    'client', jsonb_build_object('first_name', cl.first_name, 'locale', cl.locale),
    'documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', d.key, 'label', d.label, 'help', d.help,
        'state', d.state, 'required', d.required, 'received_at', d.received_at,
        'rejection_reason', case when d.state = 'refusee' then d.rejection_reason end
      ) order by d.required desc, d.key), '[]')
      from case_documents d where d.case_id = c.id
    ),
    'appointment', (
      select jsonb_build_object('kind', ap.kind, 'at', ap.at, 'location', ap.location)
      from appointments ap
      where ap.case_id = c.id and ap.status = 'prevu' and ap.at > now()
      order by ap.at limit 1
    ),
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object('direction', m.direction, 'body', m.body, 'at', m.at) order by m.at desc), '[]')
      from (select * from messages where case_id = c.id and channel <> 'interne' order by at desc limit 10) m
    )
  ) into result
  from cases c
  join agencies a on a.id = c.agency_id
  join visa_types v on v.id = c.visa_type_id
  join clients cl on cl.id = c.client_id
  where c.portal_token = p_token
    and (c.portal_expires_at is null or c.portal_expires_at > now());

  if result is not null then
    insert into activity_events (agency_id, case_id, type, detail, at, automated)
    select c.agency_id, c.id, 'connexion_portail',
           jsonb_build_object('fr', 'Consultation du suivi client.'), now(), true
    from cases c where c.portal_token = p_token;
  end if;

  return result;
end $$;

create or replace function portal_shipment(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not rate_allow('portal_shipment', coalesce(p_token, 'nul'), 60, interval '1 hour') then
    raise exception 'trop de tentatives' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'shipment', jsonb_build_object(
      'reference', s.reference, 'mode', s.mode, 'stage', s.stage, 'status', s.status,
      'origin_port', s.origin_port, 'dest_port', s.dest_port,
      'etd', s.etd, 'eta', s.eta, 'delivered_at', s.delivered_at,
      'blocked_reason', s.blocked_reason,
      'packages', s.packages, 'weight_kg', s.weight_kg
      -- Ni le connaissement, ni le fournisseur, ni la valeur : ce sont des
      -- secrets commerciaux, et le jeton seul ne les mérite pas.
    ),
    'agency', jsonb_build_object('name', a.name, 'mark', a.mark, 'accent', a.accent),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object('stage', e.stage, 'at', e.at, 'location', e.location) order by e.at), '[]')
      from shipment_events e where e.shipment_id = s.id
    ),
    'documents', (
      select coalesce(jsonb_agg(jsonb_build_object('label', d.label, 'state', d.state)), '[]')
      from shipment_documents d where d.shipment_id = s.id and d.required
    )
  ) into result
  from shipments s
  join agencies a on a.id = s.agency_id
  where s.portal_token = p_token;

  if result is not null then
    insert into activity_events (agency_id, shipment_id, type, detail, automated)
    select s.agency_id, s.id, 'connexion_portail',
           jsonb_build_object('fr', 'Consultation du suivi de cargaison.'), true
    from shipments s where s.portal_token = p_token;
  end if;

  return result;
end $$;

-- Déposer une demande depuis la page publique, sans compte.
create or replace function portal_submit_request(
  p_agency_slug text, p_kind text, p_visa_type uuid, p_travel date,
  p_goods text, p_origin text, p_first text, p_last text, p_phone text,
  p_locale text, p_note text, p_verified boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a agencies; ref text; row client_requests;
begin
  if not rate_allow('submit_request', p_phone, 5, interval '1 hour') then
    raise exception 'trop de demandes' using errcode = 'P0001';
  end if;
  select * into a from agencies where slug = p_agency_slug and deleted_at is null;
  if a.id is null then raise exception 'agence inconnue' using errcode = 'P0002'; end if;

  ref := next_reference(a.id, 'request');
  insert into client_requests (
    agency_id, reference, kind, visa_type_id, destination, travel_date, goods,
    origin_city, first_name, last_name, phone, locale, note, phone_verified
  ) values (
    a.id, ref, p_kind, p_visa_type,
    (select country ->> 'fr' from visa_types where id = p_visa_type),
    p_travel, p_goods, p_origin, p_first, p_last, p_phone, p_locale, p_note, coalesce(p_verified, false)
  ) returning * into row;

  return jsonb_build_object('reference', row.reference, 'token', row.portal_token);
end $$;
