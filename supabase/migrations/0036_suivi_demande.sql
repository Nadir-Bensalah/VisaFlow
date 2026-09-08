-- 0036 · Le suivi d'une demande, avant qu'elle ne devienne un dossier.
--
-- Le prospect qui vient de déposer sa demande reçoit un lien de suivi. Ce lien
-- pointait sur une page qui cherchait la demande dans le magasin local du
-- navigateur : il tombait donc sur « aucun résultat » juste après avoir été
-- remercié. La toute première impression du produit, et elle était cassée.
--
-- On sert la demande par son jeton, et rien de plus que ce que le porteur du
-- jeton a déposé lui-même. Si la demande a été convertie en dossier, on donne
-- le jeton du dossier pour que le suivi continue sans couture.

create or replace function portal_request(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not rate_allow('portal_request', coalesce(p_token, 'nul'), 60, interval '1 hour') then
    raise exception 'trop de tentatives' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'request', jsonb_build_object(
      'reference', r.reference,
      'kind', r.kind,
      'status', r.status,
      'received_at', r.received_at,
      'first_name', r.first_name,
      'destination', r.destination,
      'travel_date', r.travel_date,
      'goods', r.goods,
      'note', r.note,
      'refusal_reason', case when r.status = 'ecartee' then r.refusal_reason end
    ),
    'agency', jsonb_build_object('name', a.name, 'mark', a.mark, 'accent', a.accent),
    'office', (
      select jsonb_build_object('name', o.name, 'address', o.address, 'phone', o.phone)
      from offices o where o.agency_id = a.id and o.active order by o.created_at limit 1
    ),
    -- La demande devenue dossier : on passe le relais au suivi complet plutôt
    -- que de laisser le client sur une page qui ne bougera plus.
    'case_token', (
      select c.portal_token from cases c where c.id = r.case_id
    ),
    'case_reference', (
      select c.reference from cases c where c.id = r.case_id
    )
  ) into result
  from client_requests r
  join agencies a on a.id = r.agency_id
  where r.portal_token = p_token;

  return result;
end $$;

revoke all on function portal_request(text) from public;
grant execute on function portal_request(text) to anon, authenticated;

comment on function portal_request(text) is
  'Le suivi d''une demande par son jeton. Rend aussi le jeton du dossier quand la demande a été convertie, pour que le client ne perde pas le fil.';
