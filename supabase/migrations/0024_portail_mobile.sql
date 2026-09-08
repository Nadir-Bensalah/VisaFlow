-- 0024 · Ce que les apps mobiles appellent, et qui manquait.
--
-- Les deux apps client appellent portal_send (envoyer un message depuis le
-- suivi) et un dépôt de pièce. Ces fonctions n'existaient pas : les apps
-- tournaient en démonstration. On les crée, gardées par le jeton de suivi,
-- sans jamais exposer une table.

-- ------------------------------------------------------------------
-- Le client écrit à l'agence depuis son suivi
-- ------------------------------------------------------------------
create or replace function portal_send(p_token text, p_body text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare c cases;
begin
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'message vide' using errcode = 'P0001';
  end if;
  -- Débit par jeton : un client ne noie pas l'agence de messages.
  if not rate_allow('portal_send', coalesce(p_token, 'nul'), 20, interval '1 hour') then
    raise exception 'trop de messages' using errcode = 'P0001';
  end if;

  select * into c from cases where portal_token = p_token
    and (portal_expires_at is null or portal_expires_at > now());
  if c.id is null then return jsonb_build_object('ok', false); end if;

  -- Le message est entrant, il vient du client. Il n'a pas d'auteur employé :
  -- un message écrit par un client ne doit jamais porter le nom d'un agent.
  insert into messages (agency_id, case_id, client_id, channel, direction, body, status, automated)
  values (c.agency_id, c.id, c.client_id, 'portail', 'entrant', btrim(p_body), 'remis', false);

  insert into activity_events (agency_id, case_id, client_id, type, detail, automated)
  values (c.agency_id, c.id, c.client_id, 'message_recu',
          jsonb_build_object('fr', 'Message reçu du client par le portail.'), true);

  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------
-- La cible d'un dépôt de pièce, validée par jeton
-- ------------------------------------------------------------------
-- Appelée par la fonction de bord portal-upload, avec la clé de service. Elle
-- dit où déposer, et seulement si le jeton et la pièce vont ensemble. Sans
-- elle, le bord devrait faire confiance à un chemin fourni par le client.
create or replace function portal_doc_target(p_token text, p_doc_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare c cases; d case_documents;
begin
  select * into c from cases where portal_token = p_token
    and (portal_expires_at is null or portal_expires_at > now());
  if c.id is null then return null; end if;

  select * into d from case_documents where case_id = c.id and key = p_doc_key;
  if d.id is null then return null; end if;

  return jsonb_build_object(
    'agency_id', c.agency_id,
    'case_id', c.id,
    'document_id', d.id,
    'bucket', 'pieces',
    -- Le chemin porte l'agence en tête : c'est ce préfixe que les politiques
    -- de stockage vérifient. Le client ne choisit jamais son chemin.
    'path', c.agency_id || '/' || c.id || '/' || p_doc_key
  );
end $$;

-- Après le dépôt réussi, le bord marque la pièce reçue. Le client n'écrit
-- jamais directement dans case_documents.
create or replace function portal_doc_received(p_document uuid, p_path text, p_name text, p_size bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare d case_documents;
begin
  select * into d from case_documents where id = p_document;
  if d.id is null then return; end if;
  update case_documents
     set storage_path = p_path, file_name = p_name, file_size = p_size,
         state = 'recue', received_at = now(), received_channel = 'portail',
         rejection_reason = null
   where id = p_document;
  insert into activity_events (agency_id, case_id, type, detail, automated)
  values (d.agency_id, d.case_id, 'piece_recue',
          jsonb_build_object('fr', 'Pièce déposée depuis l''application.'), true);
end $$;

-- portal_send est ouverte au client (anon) ; les deux autres ne le sont qu'à
-- la clé de service, appelées par le bord.
revoke all on function portal_send(text, text) from public;
revoke all on function portal_doc_target(text, text) from public, anon, authenticated;
revoke all on function portal_doc_received(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function portal_send(text, text) to anon, authenticated;
