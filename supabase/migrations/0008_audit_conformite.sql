-- 0008 · Journal d'audit, consentements, purge.
--
-- Un journal que l'acteur peut réécrire ne prouve rien. Celui-ci est en ajout
-- seul : aucune politique de mise à jour ni de suppression n'existe, pour
-- personne, propriétaire compris. Et l'acteur est déterminé par le serveur,
-- jamais par un champ envoyé par le client.
--
-- Note d'ordre : les fonctions du portail (0007) écrivent dans cette table.
-- PL/pgSQL résout les tables à l'exécution, l'ordre des fichiers n'a donc pas
-- d'importance ici, mais cette migration doit être jouée avant le premier appel.

create table if not exists activity_events (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  case_id     uuid references cases on delete set null,
  shipment_id uuid references shipments on delete set null,
  client_id   uuid references clients on delete set null,
  actor_id    uuid references profiles on delete set null,
  -- Quand l'action vient du portail : le jeton, jamais un employé.
  actor_token text,
  type        text not null,
  detail      jsonb not null,
  at          timestamptz not null default now(),
  automated   boolean not null default false,
  ip          inet
);
create index if not exists activity_events_agency on activity_events (agency_id, at desc);
create index if not exists activity_events_case on activity_events (case_id, at desc);

-- Chaque consultation d'une pièce, pas seulement chaque modification. Sans ce
-- registre, une fuite dont on ignore le périmètre se notifie en entier.
create table if not exists document_access_log (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  document_id uuid,
  document_kind text not null check (document_kind in ('case','shipment')),
  actor_id    uuid references profiles on delete set null,
  actor_token text,
  at          timestamptz not null default now(),
  ip          inet
);
create index if not exists document_access_log_agency on document_access_log (agency_id, at desc);

-- Le consentement au transfert hors de Tunisie. Il porte la version du texte :
-- le jour où la notice change, l'ancien consentement ne couvre plus le nouveau.
create table if not exists consents (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  client_id    uuid not null references clients on delete cascade,
  purpose      text not null check (purpose in ('traitement','transfert','marketing')),
  notice_version text not null,
  granted      boolean not null,
  channel      text not null check (channel in ('portail','comptoir','whatsapp','papier')),
  evidence_path text,
  at           timestamptz not null default now(),
  collected_by uuid references profiles on delete set null
);
create index if not exists consents_client on consents (client_id, purpose, at desc);

-- La rétention. Une durée affichée dans les réglages n'engage à rien tant que
-- rien ne l'exécute.
create table if not exists retention_policies (
  agency_id  uuid primary key references agencies on delete cascade,
  case_months int not null default 24,
  shipment_months int not null default 24,
  message_months int not null default 24,
  last_run_at timestamptz
);

create or replace function purge_expired(p_agency uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; pol retention_policies;
begin
  select * into pol from retention_policies where agency_id = p_agency;
  if pol.agency_id is null then return 0; end if;

  -- On efface les pièces, pas la trace : le dossier reste, vidé de ses fichiers.
  with cible as (
    select d.id from case_documents d
    join cases c on c.id = d.case_id
    where c.agency_id = p_agency
      and c.closed_at is not null
      and c.closed_at < now() - (pol.case_months || ' months')::interval
      and d.storage_path is not null
  )
  update case_documents set storage_path = null, file_name = null
  where id in (select id from cible);
  get diagnostics n = row_count;

  update cases set portal_expires_at = least(coalesce(portal_expires_at, now()), now())
  where agency_id = p_agency and closed_at is not null and portal_expires_at is null;

  insert into activity_events (agency_id, type, detail, automated)
  values (p_agency, 'purge', jsonb_build_object('fr', n || ' pièces effacées.'), true);

  update retention_policies set last_run_at = now() where agency_id = p_agency;
  return n;
end $$;

-- À la clôture, le lien de suivi cesse de fonctionner.
create or replace function close_case_token() returns trigger
language plpgsql as $$
begin
  if new.status <> 'ouvert' and old.status = 'ouvert' then
    new.closed_at := coalesce(new.closed_at, now());
    new.portal_expires_at := coalesce(new.portal_expires_at, now() + interval '30 days');
  end if;
  return new;
end $$;

drop trigger if exists cases_close on cases;
create trigger cases_close before update on cases
  for each row execute function close_case_token();
