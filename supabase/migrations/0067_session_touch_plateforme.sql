-- 0067 : l'administrateur de la plateforme n'a pas d'agence.
--
-- `session_touch` écrivait la connexion dans `security_events` et `audit_logs`
-- avec l'agence de l'appelant. Pour Nadir, cette agence n'existe pas : la ligne
-- d'audit refusait le NULL et chaque ouverture de la console remontait une
-- erreur 400. La session elle-même était bien créée : c'est la trace, pas
-- l'appareil, qui manquait de destinataire.
--
-- Décision : sans agence, on garde l'appareil (la liste des sessions de la
-- plateforme sert à révoquer un poste) et on n'écrit aucune ligne dans les
-- journaux d'agence. Ces journaux appartiennent à une agence ; une connexion
-- de la plateforme n'a rien à y faire.

create or replace function session_touch(
  p_label text default null, p_browser text default null, p_platform text default null)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  v_user uuid := auth.uid();
  v_agency uuid := auth_agency_id();
  v_id uuid;
  v_new boolean := false;
begin
  if v_user is null then return null; end if;

  select id into v_id from user_sessions
   where user_id = v_user and revoked_at is null
     and device_label is not distinct from p_label
     and browser is not distinct from p_browser
     and platform is not distinct from p_platform
   order by last_seen_at desc limit 1;

  if v_id is null then
    insert into user_sessions (user_id, agency_id, device_label, browser, platform, ip_address)
    values (v_user, v_agency, p_label, p_browser, p_platform, sec_req_ip())
    returning id into v_id;
    v_new := true;
  else
    update user_sessions
       set last_seen_at = now(), ip_address = coalesce(sec_req_ip(), ip_address)
     where id = v_id;
  end if;

  -- Les journaux ci-dessous sont ceux d'une agence. Sans agence, rien à y écrire.
  if v_agency is null then return v_id; end if;

  if v_new then
    insert into security_events (agency_id, user_id, kind, severity, detail, ip_address, user_agent)
    values (v_agency, v_user, 'NEW_DEVICE', sec_severity('NEW_DEVICE'),
            jsonb_build_object('appareil', p_label, 'navigateur', p_browser, 'plateforme', p_platform),
            sec_req_ip(), sec_req_agent());
  end if;

  insert into audit_logs (agency_id, user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
  values (v_agency, v_user, 'login', 'user_sessions', v_id,
          jsonb_build_object('nouvel_appareil', v_new), sec_req_ip(), sec_req_agent());

  return v_id;
end $$;

revoke all on function session_touch(text, text, text) from public, anon;
grant execute on function session_touch(text, text, text) to authenticated;
