-- 0026 · Le rang de file dans le suivi client.
--
-- La red team cliente l'a relevé : le rang dans la file (« vous êtes 4e sur la
-- liste Italie ») est la première question du client, mais portal_case ne le
-- renvoyait pas. Le web le calculait à côté, Android l'affichait depuis la
-- démo, iOS pas du tout. On le sert d'un seul endroit, pour les trois.

create or replace function portal_case(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb; v_case cases; v_place record;
begin
  if not rate_allow('portal_case', coalesce(p_token, 'nul'), 60, interval '1 hour') then
    raise exception 'trop de tentatives' using errcode = 'P0001';
  end if;

  select * into v_case from cases where portal_token = p_token
    and (portal_expires_at is null or portal_expires_at > now());
  if v_case.id is null then return null; end if;

  -- Le rang, calculé sur la file du dossier. Rien d'autre ne fuit : ni les
  -- autres dossiers, ni les noms, juste un chiffre et un délai.
  select * into v_place from queue_rank(v_case.id);

  select jsonb_build_object(
    'case', jsonb_build_object(
      'reference', c.reference, 'stage', c.stage, 'status', c.status,
      'travel_date', c.travel_date, 'decision_at', c.decision_at,
      'refusal_reason', c.refusal_reason,
      'balance', c.amount_total - c.amount_paid, 'currency', c.currency
    ),
    'agency', jsonb_build_object('name', a.name, 'mark', a.mark, 'accent', a.accent, 'inpdp_ref', a.inpdp_ref),
    'visa', jsonb_build_object('country', v.country, 'label', v.label, 'processing_days', v.processing_days),
    'client', jsonb_build_object('first_name', cl.first_name, 'locale', cl.locale),
    -- Le rang, seulement s'il attend un créneau.
    'queue', case when v_place.rank is not null then (
      select jsonb_build_object('rank', v_place.rank, 'total', v_place.total,
        'country', co.country, 'city', co.city, 'wait_days', real_wait_days(co.id))
      from consulates co where co.id = v_place.consulate_id
    ) else null end,
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
      from appointments ap where ap.case_id = c.id and ap.status = 'prevu' and ap.at > now()
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
  where c.id = v_case.id;

  insert into activity_events (agency_id, case_id, type, detail, at, automated)
  values (v_case.agency_id, v_case.id, 'connexion_portail',
          jsonb_build_object('fr', 'Consultation du suivi client.'), now(), true);

  return result;
end $$;

grant execute on function portal_case(text) to anon, authenticated;
