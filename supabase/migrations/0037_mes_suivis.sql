-- 0037 · « Retrouver mes suivis » servait le jeu de démonstration.
--
-- Dernière page de la même famille. Un client qui revenait sur le site et
-- entrait son numéro cherchait ses dossiers dans le magasin local du
-- navigateur : il ne trouvait rien, ou pire, il voyait les dossiers fictifs de
-- la démonstration.
--
-- La voie sûre existait déjà côté serveur : un code par WhatsApp, un jeton
-- d'appareil haché en base, et `portal_mine` qui ne rend que ce qui appartient
-- au porteur du jeton. Elle rendait seulement une forme trop maigre pour être
-- affichée : une référence et une étape, sans le pays du visa ni les ports de
-- la cargaison. On l'étoffe de ce que la page montre, et de rien d'autre.
--
-- Au passage : la recherche par RÉFÉRENCE seule est abandonnée côté interface.
-- Les références sont séquentielles (VF-2026-0141) ; ouvrir un suivi sur une
-- référence devinée aurait été une porte grande ouverte sur le dossier des
-- autres. Le fait que la page lisait la démonstration masquait le trou.

create or replace function portal_mine(p_agency_slug text, p_device_token text)
returns jsonb language plpgsql security definer stable set search_path = public, extensions as $$
declare a agencies; d client_devices;
begin
  if not rate_allow('portal_mine', coalesce(p_device_token, 'nul'), 60, interval '1 hour') then
    raise exception 'trop de tentatives' using errcode = 'P0001';
  end if;

  select * into a from agencies where slug = p_agency_slug;
  if a.id is null then return jsonb_build_object('ok', false); end if;

  select * into d from client_devices
   where agency_id = a.id and token_hash = encode(extensions.digest(p_device_token, 'sha256'), 'hex')
     and revoked_at is null and expires_at > now();
  if d.id is null then return jsonb_build_object('ok', false); end if;

  return jsonb_build_object(
    'ok', true,
    'cases', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reference', c.reference, 'stage', c.stage, 'status', c.status,
        'token', c.portal_token,
        'country', v.country, 'label', v.label
      ) order by c.opened_at desc), '[]')
      from cases c
      join visa_types v on v.id = c.visa_type_id
      where c.client_id = d.client_id),
    -- Les cargaisons passent par les LOTS : une cargaison n'appartient pas à un
    -- client, elle en porte plusieurs.
    'shipments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reference', s.reference, 'stage', s.stage,
        'token', s.portal_token,
        'origin_port', s.origin_port, 'dest_port', s.dest_port,
        'goods', coalesce(l.goods, s.goods)
      ) order by s.created_at desc), '[]')
      from shipment_lots l join shipments s on s.id = l.shipment_id
      where l.client_id = d.client_id),
    'requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reference', r.reference, 'status', r.status, 'kind', r.kind,
        'token', r.portal_token,
        'destination', r.destination, 'goods', r.goods
      ) order by r.received_at desc), '[]')
      from client_requests r
      where r.phone = d.phone and r.agency_id = a.id and r.status <> 'convertie')
  );
end $$;

revoke all on function portal_mine(text, text) from public;
grant execute on function portal_mine(text, text) to anon, authenticated;
