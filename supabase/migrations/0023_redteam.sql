-- 0023 · Les trous trouvés par les red teams 3 et 5.
--
-- Trois failles réelles, en plus de celles déjà refermées (0021 pour l'OTP,
-- 0022 pour next_reference). Deux touchent l'autorisation, une la disponibilité.

-- ------------------------------------------------------------------
-- 1 · release_passport, geste sans garde de capacité (red team n°3)
-- ------------------------------------------------------------------
-- La seule fonction métier SECURITY DEFINER qui vérifiait l'agence mais JAMAIS
-- la capacité. Un lecteur en lecture seule pouvait marquer un passeport rendu,
-- et pire, forcer sa sortie malgré un solde impayé (p_force). C'est justement
-- le garde-fou du comptoir, ouvert à tous et contournable par n'importe qui.
create or replace function release_passport(p_custody uuid, p_force boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare a uuid := auth_agency_id(); cu passport_custody; due numeric;
begin
  -- Rendre un passeport est un geste d'écriture, réservé à qui peut écrire.
  if not auth_can('case:write') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  -- Passer outre un solde impayé engage l'argent : direction seulement.
  if p_force and not auth_can('finance:global') then
    raise exception 'le forçage du solde est réservé à la direction' using errcode = '42501';
  end if;

  select * into cu from passport_custody where id = p_custody and agency_id = a;
  if cu.id is null then raise exception 'dépôt inconnu'; end if;

  select coalesce(sum(amount), 0) into due
    from payments where case_id = cu.case_id and state <> 'regle';

  if due > 0 and not p_force then
    raise exception 'solde de % non réglé', due using errcode = 'P0003';
  end if;

  update passport_custody
     set returned_at = now(), returned_by = auth.uid(), location = 'rendu'
   where id = p_custody;

  insert into activity_events (agency_id, case_id, actor_id, type, detail)
  values (a, cu.case_id, auth.uid(), 'passeport_rendu',
          jsonb_build_object('fr', case when due > 0 then 'Passeport rendu malgré un solde de ' || due
                                        else 'Passeport rendu, solde réglé.' end));
end $$;

-- ------------------------------------------------------------------
-- 2 · rate_allow, la fenêtre était fausse (red team n°5)
-- ------------------------------------------------------------------
-- La clé de fenêtre changeait à chaque seconde : deux appels tombaient dans
-- deux lignes différentes, le compteur n'atteignait jamais la limite. La
-- fenêtre effective valait une seconde, pas une heure. Conséquence : spam de
-- demandes publiques, et surtout, une fois l'OTP réparé, bombardement de
-- codes WhatsApp sur le numéro d'une victime, à ses frais.
--
-- date_bin aligne proprement sur des tranches régulières depuis une origine.
create or replace function rate_allow(p_bucket text, p_subject text, p_limit int, p_window interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := date_bin(p_window, now(), timestamptz 'epoch');
  c int;
begin
  insert into rate_limits (bucket, subject, window_start, count)
  values (p_bucket, p_subject, w, 1)
  on conflict (bucket, subject, window_start) do update set count = rate_limits.count + 1
  returning count into c;
  return c <= p_limit;
end $$;

-- ------------------------------------------------------------------
-- 3 · storage_agency, droit d'exécution oublié (red team n°5)
-- ------------------------------------------------------------------
-- La reprise en masse de 0015 a retiré EXECUTE à tout le monde puis re-donné
-- une liste blanche, où storage_agency manquait. Les politiques des trois
-- seaux l'appellent : sans ce droit, aucun agent ne peut déposer ni lire un
-- passeport. Panne totale du stockage, fermée donc sans fuite, mais panne.
grant execute on function storage_agency(text) to authenticated;
