-- 0021 · Deux failles trouvées par la red team du portail client.
--
-- FAILLE 1 (haute) · portal_submit_request croyait le client sur parole.
-- La fonction recopiait un drapeau `p_verified` fourni par l'anonyme dans
-- `phone_verified`. N'importe qui pouvait déposer une demande en se déclarant
-- « numéro vérifié » sans jamais recevoir de code, et convert_request
-- propageait ce mensonge au client créé. Vecteur d'usurpation par téléphone.
-- Le drapeau ne doit passer à vrai QUE par un verify_otp réussi côté serveur.
--
-- FAILLE 2 (haute, fail-closed) · toute la couche OTP était morte en prod.
-- issue_otp, verify_otp et portal_mine appellent pgcrypto (gen_salt, crypt,
-- digest, gen_random_bytes), mais leur search_path était figé à `public`,
-- alors que Supabase installe pgcrypto dans le schéma `extensions`. Résultat :
-- aucun code émis, aucun appareil reconnu. La sécurité échouait fermée, donc
-- sans fuite, mais la fonctionnalité entière ne marchait pas, et ça masquait
-- tout test de force brute. Le banc local ne le voyait pas : en local,
-- pgcrypto vit dans `public`. C'est encore un cas de banc trop indulgent.

-- ------------------------------------------------------------------
-- Faille 1 · le numéro vérifié ne s'auto-déclare plus
-- ------------------------------------------------------------------
-- On garde la signature pour ne pas casser les appelants, mais p_verified est
-- désormais ignoré : une demande entrante est toujours non vérifiée.
create or replace function portal_submit_request(
  p_agency_slug text, p_kind text, p_visa_type uuid, p_travel date,
  p_goods text, p_origin text, p_first text, p_last text, p_phone text,
  p_locale text, p_note text, p_verified boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
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
    p_travel, p_goods, p_origin, p_first, p_last, p_phone, p_locale, p_note,
    -- Jamais le drapeau du client. Une demande entrante est non vérifiée,
    -- point. Le numéro ne devient vérifié que par un code réellement saisi.
    false
  ) returning * into row;

  return jsonb_build_object('reference', row.reference, 'token', row.portal_token);
end $$;

-- ------------------------------------------------------------------
-- Faille 2 · ressusciter la couche OTP
-- ------------------------------------------------------------------
-- On ajoute `extensions` au search_path ET on qualifie chaque appel : la
-- ceinture et les bretelles, parce qu'une couche d'identité qui échoue en
-- silence est pire qu'une erreur bruyante.

create or replace function issue_otp(p_agency_slug text, p_phone text, p_purpose text default 'suivi')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a agencies; code text;
begin
  if not rate_allow('otp', p_phone, 5, interval '1 hour') then
    raise exception 'trop de demandes de code' using errcode = 'P0001';
  end if;
  select * into a from agencies where slug = p_agency_slug and deleted_at is null;
  if a.id is null then raise exception 'agence inconnue'; end if;

  code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into otp_codes (agency_id, phone, code_hash, purpose)
  values (a.id, p_phone, extensions.crypt(code, extensions.gen_salt('bf', 8)), p_purpose);

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
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
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
  if rec.code_hash <> extensions.crypt(p_code, rec.code_hash) then
    return jsonb_build_object('ok', false, 'reason', 'faux');
  end if;

  update otp_codes set consumed_at = now() where id = rec.id;
  select id into cid from clients where agency_id = a.id and phone = p_phone;

  -- Le code saisi et le numéro sont maintenant certains : c'est ici, et
  -- seulement ici, que le numéro devient vérifié.
  update clients set phone_verified_at = coalesce(phone_verified_at, now())
   where agency_id = a.id and phone = p_phone;

  device_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into client_devices (agency_id, client_id, phone, token_hash, platform)
  values (a.id, cid, p_phone, encode(extensions.digest(device_token, 'sha256'), 'hex'), p_platform);

  return jsonb_build_object('ok', true, 'device_token', device_token, 'client_id', cid);
end $$;

create or replace function portal_mine(p_agency_slug text, p_device_token text)
returns jsonb language plpgsql security definer stable set search_path = public, extensions as $$
declare a agencies; d client_devices;
begin
  select * into a from agencies where slug = p_agency_slug;
  select * into d from client_devices
   where agency_id = a.id and token_hash = encode(extensions.digest(p_device_token, 'sha256'), 'hex')
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

-- Les valeurs par défaut des jetons de suivi passent aussi par pgcrypto. Elles
-- sont évaluées avec les droits de qui insère, pas d'une fonction definer : on
-- les qualifie donc explicitement, sinon un INSERT direct casse hors du seed.
alter table cases          alter column portal_token set default encode(extensions.gen_random_bytes(32), 'hex');
alter table shipments      alter column portal_token set default encode(extensions.gen_random_bytes(32), 'hex');
alter table shipment_lots  alter column portal_token set default encode(extensions.gen_random_bytes(32), 'hex');
alter table client_requests alter column portal_token set default encode(extensions.gen_random_bytes(32), 'hex');

grant execute on function issue_otp(text, text, text) to anon, authenticated;
grant execute on function verify_otp(text, text, text, text) to anon, authenticated;
grant execute on function portal_mine(text, text) to anon, authenticated;
grant execute on function portal_submit_request(text, text, uuid, date, text, text, text, text, text, text, text, boolean) to anon, authenticated;
