-- 0059 · Le journal d'audit ne se plaint plus quand une agence disparaît.
--
-- Le déclencheur posé en 0050 écrit une ligne pour chaque suppression. Mais
-- quand c'est l'AGENCE qu'on supprime, la cascade efface d'abord les profils,
-- les clients et les dossiers : le déclencheur essaie alors d'écrire dans
-- `audit_logs` en pointant une agence qui n'existe déjà plus, et la clé
-- étrangère refuse. Il avale l'erreur, donc rien ne casse, mais chaque
-- suppression d'agence produit une volée d'avertissements, et un avertissement
-- que l'on apprend à ignorer est un avertissement qui ne sert plus à rien.
--
-- Le corps est celui de 0050, à un garde-fou près. Rien d'autre ne change.

create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  -- Les colonnes de bruit : elles changent à chaque écriture sans rien
  -- apprendre à personne, et la colonne `at` du journal dit déjà l'heure.
  ignore constant text[] := array['updated_at'];
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_action text;
  v_row jsonb;
  o jsonb;
  n jsonb;
begin
  begin
    if tg_op = 'INSERT' then
      v_row := to_jsonb(new);
      v_new := jsonb_strip_nulls(v_row);
      select array_agg(k order by k) into v_changed from jsonb_object_keys(v_new) k;
      v_action := 'create';

    elsif tg_op = 'UPDATE' then
      v_row := to_jsonb(new);
      o := to_jsonb(old);
      n := v_row;
      select array_agg(k order by k) into v_changed
        from jsonb_object_keys(n) k
        where not (k = any (ignore))
          and (n -> k) is distinct from (o -> k);
      -- Rien n'a bougé (ou seulement du bruit) : pas de ligne de journal.
      -- Un journal qui enregistre les non-événements devient illisible.
      if v_changed is null then return null; end if;
      select jsonb_object_agg(k, coalesce(o -> k, 'null'::jsonb)) into v_old from unnest(v_changed) k;
      select jsonb_object_agg(k, coalesce(n -> k, 'null'::jsonb)) into v_new from unnest(v_changed) k;
      -- Un changement de rôle n'est pas une modification comme une autre.
      if tg_table_name = 'profiles' and 'role' = any (v_changed) then
        v_action := 'permission_change';
      else
        v_action := 'update';
      end if;

    else
      v_row := to_jsonb(old);
      v_old := jsonb_strip_nulls(v_row);
      v_action := 'delete';
    end if;

    -- L'agence s'en va : sa cascade emporte `audit_logs` de toute façon, et la
    -- clé étrangère refuse une ligne qui pointe une agence déjà effacée. On ne
    -- tente donc pas d'écrire une ligne condamnée dans la même transaction.
    -- Supprimer un client dans une agence VIVANTE reste journalisé : c'est le
    -- seul cas qui compte, et c'est celui qu'un auditeur vient regarder.
    if nullif(v_row ->> 'agency_id', '') is null
       or not exists (select 1 from agencies a where a.id = (v_row ->> 'agency_id')::uuid) then
      return null;
    end if;

    insert into audit_logs (
      agency_id, office_id, user_id, action, entity_type, entity_id,
      old_values, new_values, changed_fields, ip_address, user_agent)
    values (
      nullif(v_row ->> 'agency_id', '')::uuid,
      nullif(v_row ->> 'office_id', '')::uuid,
      auth.uid(),
      v_action,
      tg_table_name,
      nullif(v_row ->> 'id', '')::uuid,
      v_old, v_new, v_changed,
      sec_req_ip(), sec_req_agent());

    -- Une promotion se lit dans le fil de sécurité, pas seulement dans le
    -- journal technique : c'est l'événement que l'on regarde après une fuite.
    if v_action = 'permission_change' then
      insert into security_events (agency_id, user_id, kind, severity, detail, ip_address, user_agent)
      values (nullif(v_row ->> 'agency_id', '')::uuid, auth.uid(), 'PERMISSION_CHANGED',
              sec_severity('PERMISSION_CHANGED'),
              jsonb_build_object('profile', v_row ->> 'id',
                                 'avant', o ->> 'role', 'apres', n ->> 'role'),
              sec_req_ip(), sec_req_agent());
    end if;

    return null;

  exception when others then
    -- Voir la décision A ci-dessus. On crie, on ne bloque pas.
    raise warning 'audit: ligne non journalisée sur % (%) : %', tg_table_name, tg_op, sqlerrm;
    return null;
  end;
end $$;
