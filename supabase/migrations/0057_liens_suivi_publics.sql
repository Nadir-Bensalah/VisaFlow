-- 0057 · Les liens de suivi s'ouvrent vraiment.
--
-- La migration 0050 a fait le plus difficile : émettre un lien de suivi dont
-- seule l'empreinte est conservée, le compter, le révoquer, le faire expirer.
-- Mais `tracking_open` est restée réservée aux comptes connectés, alors que sa
-- seule raison d'exister est d'être appelée par un client qui n'a pas de compte.
-- Une agente pouvait donc émettre un lien, l'envoyer par WhatsApp, et le client
-- tombait sur une page vide. Un lien mort est pire que pas de lien : le client
-- rappelle, et il rappelle fâché.
--
-- POURQUOI C'EST SANS DANGER D'OUVRIR CETTE FONCTION.
--
-- Elle ne prend qu'un jeton, et ne rend RIEN sans jeton valide : ni message
-- d'erreur distinct, ni indice sur ce qui existe. Le jeton lui-même n'est nulle
-- part en base, seule son empreinte SHA-256 y est. Un lien révoqué ou expiré
-- rend `null`, exactement comme un jeton inventé : impossible de deviner par
-- essais successifs si une référence existe. C'est la même forme que
-- `portal_case`, ouverte depuis le premier jour.

-- Elle est déjà limitée par le débit : sans ça, un script essaierait des jetons
-- toute la nuit. Les jetons font 32 octets, donc l'essai exhaustif est vain,
-- mais un compteur coûte moins cher qu'un pari.
create or replace function tracking_open(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, auth, extensions as $$
declare l tracking_links;
begin
  if coalesce(trim(p_token), '') = '' then return null; end if;

  -- Trente essais par heure et par jeton présenté. Un client légitime ouvre
  -- son lien quelques fois par jour, jamais trente fois par heure.
  if not rate_allow('tracking_open', left(p_token, 12), 30, interval '1 hour') then
    return null;
  end if;

  select * into l from tracking_links
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  -- Un jeton inconnu, révoqué ou périmé rendent tous la même chose : rien.
  -- Distinguer les trois cas dirait à un curieux lesquels ont existé.
  if l.id is null or l.revoked_at is not null
     or (l.expires_at is not null and l.expires_at < now()) then
    return null;
  end if;

  update tracking_links
     set open_count = open_count + 1, last_opened_at = now()
   where id = l.id;

  return jsonb_build_object('entity_kind', l.entity_kind, 'entity_id', l.entity_id,
                            'requires_otp', l.requires_otp, 'client_id', l.client_id);
end $$;

revoke all on function tracking_open(text) from public;
grant execute on function tracking_open(text) to anon, authenticated;

-- ------------------------------------------------------------------
-- Le jeton de suivi ouvre le dossier, sans passer par portal_token
-- ------------------------------------------------------------------
--
-- Les dossiers portent déjà un `portal_token` unique, posé à l'ouverture. Les
-- liens de suivi permettent d'en émettre plusieurs, de les révoquer un par un,
-- et de savoir lequel a été ouvert. Pour que la page de suivi accepte les deux,
-- une seule fonction fait la traduction : elle rend le jeton de portail
-- correspondant, et le reste du portail ne change pas d'une ligne.

create or replace function tracking_resolve(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v jsonb; v_portal text; v_kind text;
begin
  v := tracking_open(p_token);
  if v is null then return null; end if;
  v_kind := v ->> 'entity_kind';

  if v_kind = 'VISA_CASE' then
    select portal_token into v_portal from cases where id = (v ->> 'entity_id')::uuid;
  elsif v_kind = 'SHIPMENT' then
    select portal_token into v_portal from shipments where id = (v ->> 'entity_id')::uuid;
  end if;

  if v_portal is null then return null; end if;
  return jsonb_build_object('kind', v_kind, 'portal_token', v_portal,
                            'requires_otp', v -> 'requires_otp');
end $$;

revoke all on function tracking_resolve(text) from public;
grant execute on function tracking_resolve(text) to anon, authenticated;

comment on function tracking_resolve(text) is
  'Traduit un jeton de suivi révocable en jeton de portail. Rend null pour un jeton inconnu, révoqué, expiré, ou dont le dossier a disparu : les quatre cas se ressemblent, pour qu''aucun essai ne renseigne.';
