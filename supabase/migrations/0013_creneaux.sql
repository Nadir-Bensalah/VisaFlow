-- 0013 · Le créneau, les consulats, les motifs de refus codés.
--
-- Le goulot du métier n'est pas le dossier, c'est le rendez-vous. Deux centres
-- TLScontact pour toute la Tunisie, et sur un ticket d'environ 550 dinars,
-- 200 à 350 viennent d'avoir décroché le créneau. Ce travail n'existait dans
-- aucune table : l'agent ouvrait le site, il n'y avait rien, il recommençait.

-- ------------------------------------------------------------------
-- Les postes consulaires
-- ------------------------------------------------------------------
-- Le taux de refus est une propriété du consulat, pas du pays : 15,4 % chez
-- la France et 46,3 % chez la Tchéquie sur le même terrain la même année.

create table if not exists consulates (
  id                   uuid primary key default gen_random_uuid(),
  agency_id            uuid not null references agencies on delete cascade,
  country_code         text not null,
  country              jsonb not null default '{}'::jsonb,
  -- Ville de représentation, pas de résidence du client. La France instruit
  -- à Tunis et à Sfax, et les deux n'ont pas le même taux.
  city                 text not null,
  centre               text not null default 'consulat'
                       check (centre in ('tls_tunis','tls_sfax','vfs_tunis','consulat','autre')),
  -- Presque toujours faux. L'exiger éliminerait la clientèle libyenne : en
  -- 2015, 530 Libyens seulement avaient une carte de séjour tunisienne, alors
  -- que la France, l'Autriche et la Suisse instruisent leurs dossiers à Tunis.
  requires_residence   boolean not null default false,
  fee_consulate        numeric(12,3) not null default 0,
  currency             text not null default 'TND',
  -- Le délai de recours est un paramètre, jamais une constante : les sources
  -- publiques donnent 30 jours ici et 2 mois là. On stocke donc aussi d'où il
  -- vient et quand on l'a vérifié.
  appeal_days          integer check (appeal_days is null or appeal_days between 1 and 365),
  appeal_source        text,
  appeal_checked_at    date,
  -- Référence officielle publiée par la Commission européenne, par consulat.
  -- Elle ne sert qu'à se comparer : le taux qui compte est celui que l'agence
  -- mesure sur ses propres dossiers.
  ref_year             integer,
  ref_refusal_rate     numeric(5,2) check (ref_refusal_rate is null or ref_refusal_rate between 0 and 100),
  ref_multi_entry      numeric(5,2) check (ref_multi_entry is null or ref_multi_entry between 0 and 100),
  announced_days       integer,
  notes                text,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  unique (agency_id, country_code, city)
);
create index if not exists consulates_agency on consulates (agency_id) where active;

-- ------------------------------------------------------------------
-- Le dossier gagne son poste, sa catégorie et son motif codé
-- ------------------------------------------------------------------

alter table cases
  add column if not exists consulate_id uuid references consulates on delete set null,
  -- Première demande ou déjà visé : ni les mêmes pièces, ni les mêmes délais,
  -- ni le même taux de refus.
  add column if not exists track text check (track is null or track in ('primo','vise')),
  -- Le code fermé, pas le texte libre. Un champ libre ne produit aucune
  -- statistique exploitable : c'est le code qui permet de dire d'où viennent
  -- les refus, et donc quelles pièces renforcer.
  add column if not exists refusal_code text check (refusal_code is null or refusal_code in (
    'document_faux','objet_non_justifie','moyens_insuffisants','sejours_epuises',
    'signalement','ordre_public','assurance_absente','justificatifs_non_fiables',
    'sortie_non_etablie','autre')),
  add column if not exists appeal_due_at date,
  add column if not exists appeal_filed_at timestamptz;

create index if not exists cases_consulate on cases (agency_id, consulate_id)
  where consulate_id is not null;
-- L'échéance de recours est une alerte : elle doit se lire sans balayer tout.
create index if not exists cases_appeal_due on cases (agency_id, appeal_due_at)
  where appeal_due_at is not null and appeal_filed_at is null;

-- ------------------------------------------------------------------
-- Le client gagne son statut professionnel et sa biométrie
-- ------------------------------------------------------------------

alter table clients
  -- Le troisième axe de la liste de pièces. Une checklist « France » n'existe
  -- pas : il faut France + salarié, France + étudiant, France + retraité. Les
  -- pièces de revenu et d'autorisation parentale changent complètement.
  add column if not exists professional_status text
    check (professional_status is null or professional_status in (
      'salarie','independant','fonctionnaire','etudiant','retraite','sans_emploi','mineur')),
  add column if not exists employer text,
  -- Les empreintes restent valables 59 mois. Un client encore couvert n'a pas
  -- à se déplacer, ce qui change le prix, le délai et le besoin de créneau.
  add column if not exists biometrics_at date;

-- ------------------------------------------------------------------
-- La file d'attente
-- ------------------------------------------------------------------

create table if not exists appointment_queue (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  case_id        uuid not null references cases on delete cascade,
  consulate_id   uuid not null references consulates on delete cascade,
  joined_at      timestamptz not null default now(),
  priority       text not null default 'normale'
                 check (priority in ('basse','normale','haute','urgente')),
  status         text not null default 'attente'
                 check (status in ('attente','servi','abandonne')),
  served_at      timestamptz,
  served_by      uuid references profiles on delete set null,
  appointment_id uuid references appointments on delete set null,
  left_at        timestamptz,
  note           text
);

-- Un dossier n'attend qu'une fois. Sans cet index, un double clic crée deux
-- lignes et le rang annoncé au client devient faux.
create unique index if not exists queue_one_per_case
  on appointment_queue (case_id) where status = 'attente';
create index if not exists queue_line
  on appointment_queue (agency_id, consulate_id, priority, joined_at) where status = 'attente';

-- ------------------------------------------------------------------
-- Le registre des tentatives
-- ------------------------------------------------------------------
-- C'est le travail réel de l'agent, jusqu'ici totalement invisible.

create table if not exists slot_attempts (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  consulate_id uuid not null references consulates on delete cascade,
  -- Une tentative peut viser un dossier précis, ou balayer la file entière.
  case_id      uuid references cases on delete set null,
  at           timestamptz not null default now(),
  by_id        uuid references profiles on delete set null,
  centre       text not null
               check (centre in ('tls_tunis','tls_sfax','vfs_tunis','consulat','autre')),
  result       text not null
               check (result in ('aucun_creneau','creneau_pris','site_indisponible','compte_bloque','erreur')),
  slot_at      timestamptz,
  note         text
);
create index if not exists attempts_recent on slot_attempts (agency_id, at desc);
create index if not exists attempts_by_consulate on slot_attempts (agency_id, consulate_id, at desc);

-- ------------------------------------------------------------------
-- Le rang, calculé côté serveur
-- ------------------------------------------------------------------
-- Le portail client ne doit jamais lire la file entière pour compter sa place :
-- il verrait les autres dossiers. La fonction rend un seul chiffre.

create or replace function queue_rank(p_case uuid)
returns table (rank integer, total integer, consulate_id uuid, joined_at timestamptz)
language sql stable
set search_path = public
as $$
  with mine as (
    select q.consulate_id, q.joined_at, q.priority
    from appointment_queue q
    where q.case_id = p_case and q.status = 'attente'
  ),
  line as (
    select
      q.case_id,
      row_number() over (
        order by
          case q.priority when 'urgente' then 3 when 'haute' then 2 when 'normale' then 1 else 0 end desc,
          q.joined_at asc
      ) as pos,
      count(*) over () as n
    from appointment_queue q
    join mine m on m.consulate_id = q.consulate_id
    where q.status = 'attente'
  )
  select l.pos::integer, l.n::integer, m.consulate_id, m.joined_at
  from line l cross join mine m
  where l.case_id = p_case;
$$;

-- Délai réel d'obtention, mesuré sur les files déjà servies. C'est ce chiffre
-- qui permet enfin de répondre honnêtement « combien de temps », au lieu de
-- répéter le délai annoncé par le poste.
create or replace function real_wait_days(p_consulate uuid)
returns integer
language sql stable
set search_path = public
as $$
  select round(avg(extract(epoch from (served_at - joined_at)) / 86400))::integer
  from appointment_queue
  where consulate_id = p_consulate and status = 'servi' and served_at is not null;
$$;

-- ------------------------------------------------------------------
-- Servir la file
-- ------------------------------------------------------------------
-- Un seul acte : le créneau est décroché, le rendez-vous se crée, le dossier
-- avance, et la tentative réussie entre au registre. En trois appels séparés,
-- une erreur au milieu laisse la file et l'agenda désaccordés.

create or replace function serve_queue(p_entry uuid, p_slot_at timestamptz, p_location text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry   appointment_queue;
  v_case    cases;
  v_cons    consulates;
  v_appt    uuid;
  v_place   text;
begin
  select * into v_entry from appointment_queue where id = p_entry;
  if not found or v_entry.status <> 'attente' then
    raise exception 'file introuvable ou deja servie';
  end if;
  if v_entry.agency_id <> auth_agency_id() or not auth_can('case:write') then
    raise exception 'interdit';
  end if;

  select * into v_case from cases where id = v_entry.case_id;
  select * into v_cons from consulates where id = v_entry.consulate_id;

  v_place := coalesce(p_location, case v_cons.centre
    when 'tls_tunis' then 'TLScontact, Les Berges du Lac, Tunis'
    when 'tls_sfax'  then 'TLScontact, Sfax'
    when 'vfs_tunis' then 'VFS Global, Tunis'
    else v_cons.city end);

  insert into appointments (agency_id, case_id, kind, at, duration_min, location, status)
  values (v_entry.agency_id, v_entry.case_id, 'consulat', p_slot_at, 30, v_place, 'prevu')
  returning id into v_appt;

  update appointment_queue
     set status = 'servi', served_at = now(), served_by = auth.uid(), appointment_id = v_appt
   where id = p_entry;

  -- La file servie fait avancer le dossier : c'était l'étape bloquante.
  update cases set stage = 'depot', updated_at = now()
   where id = v_entry.case_id and stage = 'rendez_vous';

  insert into slot_attempts (agency_id, consulate_id, case_id, by_id, centre, result, slot_at)
  values (v_entry.agency_id, v_entry.consulate_id, v_entry.case_id, auth.uid(), v_cons.centre, 'creneau_pris', p_slot_at);

  insert into activity_events (agency_id, case_id, actor_id, type, detail, automated)
  values (v_entry.agency_id, v_entry.case_id, auth.uid(), 'creneau_obtenu',
          jsonb_build_object('fr', 'Créneau obtenu pour ' || coalesce(v_case.reference, '')), false);

  return v_appt;
end;
$$;

-- Enregistrer la décision avec un code fermé, et armer l'échéance de recours
-- depuis le délai du consulat. Une décision sort aussi le dossier de sa file.
create or replace function record_decision(
  p_case uuid,
  p_status text,
  p_code text default null,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case cases;
  v_days integer;
begin
  select * into v_case from cases where id = p_case;
  if not found then raise exception 'dossier introuvable'; end if;
  if v_case.agency_id <> auth_agency_id() or not auth_can('case:write') then
    raise exception 'interdit';
  end if;
  if p_status not in ('accepte','refuse','annule') then
    raise exception 'statut inconnu';
  end if;

  select appeal_days into v_days from consulates where id = v_case.consulate_id;

  update cases
     set status        = p_status,
         stage         = case when p_status = 'accepte' then 'retrait' else 'clos' end,
         decision_at   = now(),
         refusal_code  = case when p_status = 'refuse' then coalesce(p_code, 'autre') else null end,
         refusal_reason = case when p_status = 'refuse' then p_reason else null end,
         appeal_due_at = case when p_status = 'refuse' and v_days is not null
                              then (now() + make_interval(days => v_days))::date end,
         updated_at    = now()
   where id = p_case;

  update appointment_queue
     set status = 'abandonne', left_at = now()
   where case_id = p_case and status = 'attente';

  insert into activity_events (agency_id, case_id, actor_id, type, detail, automated)
  values (v_case.agency_id, p_case, auth.uid(), 'decision_recue',
          jsonb_build_object('fr', coalesce(v_case.reference, '') || ' : ' || p_status), false);
end;
$$;

-- ------------------------------------------------------------------
-- Cloisonnement
-- ------------------------------------------------------------------

alter table consulates          enable row level security;
alter table consulates          force  row level security;
alter table appointment_queue   enable row level security;
alter table appointment_queue   force  row level security;
alter table slot_attempts       enable row level security;
alter table slot_attempts       force  row level security;

do $$
declare spec record;
begin
  for spec in
    select * from (values
      ('consulates',        'catalog:manage'),
      ('appointment_queue', 'case:write'),
      ('slot_attempts',     'case:write')
    ) as v(tbl, cap)
  loop
    execute format($f$
      create policy %1$s_select on %1$I for select to authenticated
        using (agency_id = auth_agency_id() and auth_can('case:read'))
    $f$, spec.tbl);
    execute format($f$
      create policy %1$s_insert on %1$I for insert to authenticated
        with check (agency_id = auth_agency_id() and auth_can(%2$L))
    $f$, spec.tbl, spec.cap);
    execute format($f$
      create policy %1$s_update on %1$I for update to authenticated
        using (agency_id = auth_agency_id() and auth_can(%2$L))
        with check (agency_id = auth_agency_id())
    $f$, spec.tbl, spec.cap);
    execute format($f$
      create policy %1$s_delete on %1$I for delete to authenticated
        using (agency_id = auth_agency_id() and auth_role() in ('owner','manager'))
    $f$, spec.tbl);
  end loop;
end $$;

-- ------------------------------------------------------------------
-- Le portail client : un chiffre, pas la file
-- ------------------------------------------------------------------
-- Le client voit son rang. Il ne voit ni les autres dossiers, ni leur nombre
-- réel de tentatives, ni les noms. C'est la seule lecture ouverte au jeton.

create or replace function portal_queue(p_token text)
returns table (rank integer, total integer, country jsonb, city text, wait_days integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case cases;
begin
  select * into v_case from cases where portal_token = p_token;
  if not found then return; end if;

  return query
  select r.rank, r.total, c.country, c.city, real_wait_days(c.id)
  from queue_rank(v_case.id) r
  join consulates c on c.id = r.consulate_id;
end;
$$;

revoke all on function serve_queue(uuid, timestamptz, text) from public;
revoke all on function record_decision(uuid, text, text, text) from public;
grant execute on function serve_queue(uuid, timestamptz, text) to authenticated;
grant execute on function record_decision(uuid, text, text, text) to authenticated;
grant execute on function queue_rank(uuid) to authenticated;
grant execute on function real_wait_days(uuid) to authenticated;
grant execute on function portal_queue(text) to anon, authenticated;
