-- 0031 · Le compteur 90 jours sur 180.
--
-- « Combien de jours me reste-t-il ? » est la question que le client pose le
-- plus souvent, et depuis l'entrée en service de l'EES le 10 avril 2026 elle
-- est devenue quotidienne. L'étude de marché est nette : aucune agence
-- tunisienne ne l'offre. C'est donc à la fois un service et une différence.
--
-- Ce que cette migration apporte : l'ENREGISTREMENT des séjours. Le calcul,
-- lui, vit dans `web/src/lib/schengen.ts` et nulle part ailleurs. C'est
-- délibéré : l'algorithme de fenêtre glissante est exactement le genre de
-- calcul qui se trompe en silence, et l'écrire deux fois double le risque. Le
-- portail reçoit donc les séjours BRUTS et fait le compte avec le même moteur
-- que l'espace agence. Un seul algorithme, un seul banc d'essai.

create table if not exists schengen_stays (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  client_id   uuid not null references clients on delete cascade,
  -- Le jour d'entrée ET le jour de sortie comptent tous les deux. Un
  -- aller-retour dans la journée vaut un jour, pas zéro.
  entry_date  date not null,
  -- Vide = le client est encore à l'intérieur de l'espace.
  exit_date   date,
  country     char(2),
  -- D'où vient l'information : le client l'a dite, on a lu le tampon, on l'a
  -- prise dans l'EES, ou l'agence l'a saisie. Un compteur qui ne dit pas d'où
  -- il tient ses dates ne vaut rien le jour où le client conteste.
  source      text not null default 'declare'
              check (source in ('declare','tampon','ees','agence')),
  note        text,
  created_at  timestamptz not null default now(),
  check (exit_date is null or exit_date >= entry_date)
);
create index if not exists schengen_stays_client on schengen_stays (client_id, entry_date desc);

comment on table schengen_stays is
  'Les séjours dans l''espace Schengen, pour le compteur 90 jours sur 180. Le calcul est fait par le moteur TypeScript, jamais ici : l''écrire deux fois doublerait le risque de se tromper en silence sur une fenêtre glissante.';

alter table schengen_stays enable row level security;
alter table schengen_stays force row level security;

drop policy if exists schengen_stays_select on schengen_stays;
drop policy if exists schengen_stays_insert on schengen_stays;
drop policy if exists schengen_stays_update on schengen_stays;
drop policy if exists schengen_stays_delete on schengen_stays;
drop policy if exists schengen_stays_platform_read on schengen_stays;

create policy schengen_stays_select on schengen_stays for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('case:read'));
create policy schengen_stays_insert on schengen_stays for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('client:write'));
create policy schengen_stays_update on schengen_stays for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('client:write'))
  with check (agency_id = auth_agency_id());
create policy schengen_stays_delete on schengen_stays for delete to authenticated
  using (agency_id = auth_agency_id() and auth_role() in ('owner','manager'));
create policy schengen_stays_platform_read on schengen_stays for select to authenticated
  using (is_platform_admin());

grant select, insert, update, delete on schengen_stays to authenticated;
grant all on schengen_stays to service_role;

-- ------------------------------------------------------------------
-- Le portail : on sert les séjours bruts, le client fait le compte
-- ------------------------------------------------------------------
--
-- On ne renvoie QUE les dates du client concerné, et rien d'autre : ni son
-- nom, ni ses autres dossiers. Le portail est un jeton public, il n'obtient
-- jamais plus que ce que le porteur du jeton a le droit de voir.

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
    'visa', jsonb_build_object('country', v.country, 'label', v.label, 'processing_days', v.processing_days),
    'client', jsonb_build_object('first_name', cl.first_name, 'locale', cl.locale),
    'queue', case when v_place.rank is not null then (
      select jsonb_build_object('rank', v_place.rank, 'total', v_place.total,
        'country', co.country, 'city', co.city, 'wait_days', real_wait_days(co.id))
      from consulates co where co.id = v_place.consulate_id
    ) else null end,
    -- Les séjours du client, bruts. Le compte des 90 jours sur 180 est fait
    -- côté navigateur, par le même moteur que l'espace agence.
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
