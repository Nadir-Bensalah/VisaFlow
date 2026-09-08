-- 0032 · Le portail web servait la démonstration, pas l'agence.
--
-- Trouvé en branchant le compteur 90/180 : la page de suivi client du web lit
-- le magasin LOCAL du navigateur et n'appelle jamais `portal_case`. Sur le site
-- de démonstration c'est sans conséquence, c'est même voulu. Mais chez une
-- agence branchée sur sa base, un client qui ouvre son lien de suivi cherche
-- son dossier dans un jeu de données fictif : il ne trouve rien.
--
-- Les applications mobiles, elles, appellent bien la fonction. Le trou ne
-- concernait que le web, c'est-à-dire la voie que prend la majorité des clients
-- qui n'installeront jamais d'application.
--
-- Cette migration complète `portal_case` avec les deux choses qui manquaient
-- pour que la page web puisse s'en contenter : les étapes du type de visa (la
-- barre de progression) et le détail des paiements du client. Rien de plus : le
-- portail reste un jeton public, il ne doit jamais rendre autre chose que ce
-- que le porteur du jeton a le droit de voir.

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

  select * into v_place from queue_rank(v_case.id);

  select jsonb_build_object(
    'case', jsonb_build_object(
      'reference', c.reference, 'stage', c.stage, 'status', c.status,
      'travel_date', c.travel_date, 'decision_at', c.decision_at,
      'refusal_reason', c.refusal_reason,
      'balance', c.amount_total - c.amount_paid, 'currency', c.currency
    ),
    'agency', jsonb_build_object('name', a.name, 'mark', a.mark, 'accent', a.accent, 'inpdp_ref', a.inpdp_ref),
    -- Les étapes du parcours : sans elles, la page web ne sait pas dessiner
    -- « étape 3 sur 7 », qui est la première chose que le client regarde.
    'visa', jsonb_build_object(
      'country', v.country, 'label', v.label,
      'processing_days', v.processing_days,
      'stages', (
        select coalesce(jsonb_agg(sd.key order by sd.position), '[]'::jsonb)
        from stage_definitions sd
        where sd.agency_id = c.agency_id and sd.domain = 'visa'
      )
    ),
    'client', jsonb_build_object('first_name', cl.first_name, 'locale', cl.locale),
    -- Le bureau qui suit le dossier : le client doit pouvoir appeler quelqu'un.
    'office', (
      select jsonb_build_object('name', o.name, 'address', o.address, 'phone', o.phone)
      from offices o where o.id = c.office_id
    ),
    'queue', case when v_place.rank is not null then (
      select jsonb_build_object('rank', v_place.rank, 'total', v_place.total,
        'country', co.country, 'city', co.city, 'wait_days', real_wait_days(co.id))
      from consulates co where co.id = v_place.consulate_id
    ) else null end,
    'stays', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'entry', s.entry_date, 'exit', s.exit_date, 'country', s.country
      ) order by s.entry_date), '[]')
      from schengen_stays s where s.client_id = c.client_id
    ),
    'documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', d.key, 'label', d.label, 'help', d.help,
        'state', d.state, 'required', d.required, 'received_at', d.received_at,
        'rejection_reason', case when d.state = 'refusee' then d.rejection_reason end
      ) order by d.required desc, d.key), '[]')
      from case_documents d where d.case_id = c.id
    ),
    -- Ce que le client doit, ligne par ligne. Le libellé, le montant et l'état,
    -- rien d'autre : ni la marge, ni les notes internes, ni le mode de règlement.
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'label', p.label, 'amount', p.amount, 'state', p.state
      ) order by p.due_at nulls last), '[]')
      from payments p where p.case_id = c.id
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
