-- 0033 · Le suivi de cargaison côté client : ce qu'il lui manquait pour être
-- servi par le serveur, et le trajet en tronçons.
--
-- Même défaut que pour le suivi de dossier : la page web lisait le magasin
-- local. Pour qu'elle puisse s'en passer, `portal_shipment` doit servir ce
-- qu'elle affiche : la marchandise, le volume, les villes et le bureau à
-- appeler. On en profite pour donner au client ce qu'il réclame vraiment, et
-- que personne ne lui dit : OÙ EST SON CONTENEUR, tronçon par tronçon, avec
-- l'attente au hub qui explique le retard.
--
-- Ce qui reste hors du portail, et qui ne doit jamais y entrer : le
-- connaissement, le fournisseur et la valeur déclarée. Ce sont des secrets
-- commerciaux de l'agence et de ses autres clients, et un jeton public ne les
-- mérite pas. Le numéro de conteneur suit la même logique : sur un groupage il
-- désigne une boîte partagée avec d'autres clients, on ne le donne donc qu'au
-- client d'un conteneur complet.

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
      'origin_city', s.origin_city, 'origin_port', s.origin_port,
      'dest_city', s.dest_city, 'dest_port', s.dest_port,
      'etd', s.etd, 'eta', s.eta, 'delivered_at', s.delivered_at,
      'blocked_reason', s.blocked_reason,
      'packages', s.packages, 'weight_kg', s.weight_kg, 'volume_cbm', s.volume_cbm,
      'goods', s.goods,
      -- Sur un groupage, le conteneur est partagé : son numéro ne regarde pas
      -- un client en particulier.
      'container_no', case when not s.consolidated then s.container_no end
      -- Ni le connaissement, ni le fournisseur, ni la valeur : secrets commerciaux.
    ),
    'agency', jsonb_build_object('name', a.name, 'mark', a.mark, 'accent', a.accent),
    'office', (
      select jsonb_build_object('name', o.name, 'address', o.address, 'phone', o.phone)
      from offices o where o.id = s.office_id
    ),
    -- Le trajet réel. Il n'existe aucune ligne directe Chine vers Radès : le
    -- client qui voit « Shanghai → Malte → Radès » comprend enfin pourquoi son
    -- conteneur met quarante jours, et où il attend.
    'legs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'seq', l.seq, 'mode', l.mode,
        'from_place', l.from_place, 'to_place', l.to_place,
        'carrier', l.carrier, 'conveyance', l.conveyance,
        'etd', l.etd, 'eta', l.eta, 'atd', l.atd, 'ata', l.ata
      ) order by l.seq), '[]')
      from shipment_legs l where l.shipment_id = s.id
    ),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object('stage', e.stage, 'at', e.at, 'location', e.location) order by e.at), '[]')
      from shipment_events e where e.shipment_id = s.id
    ),
    'documents', (
      select coalesce(jsonb_agg(jsonb_build_object('key', d.key, 'label', d.label, 'state', d.state)), '[]')
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

revoke all on function portal_shipment(text) from public;
grant execute on function portal_shipment(text) to anon, authenticated;
