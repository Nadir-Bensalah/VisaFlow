-- 0046 · Le CRM commercial.
--
-- L'outil savait suivre un dossier une fois le client acquis. Il ne savait
-- rien de ce qui se passe AVANT : l'appel de mardi, le devis envoyé jeudi, la
-- relance oubliée, l'affaire perdue sans que personne ne sache pourquoi. Une
-- agence de visas et de fret vit pourtant de ça.
--
-- Trois choses tiennent ce module :
--   1. Le prospect (`leads`) est distinct du client. Il devient client par une
--      conversion explicite, une seule fois, et le lien reste visible.
--   2. Rien ne bouge sans laisser de trace. Chaque changement d'état écrit son
--      événement par trigger, pas par la bonne volonté de l'écran. Un pipeline
--      sans historique ne dit jamais pourquoi une affaire a été perdue.
--   3. Les chiffres sont comptés, jamais estimés. `crm_stats` lit les lignes
--      réelles ; aucune moyenne n'est câblée en dur.
--
-- Le formulaire public existant (`client_requests`) n'est pas touché : une
-- demande peut désormais devenir un prospect qualifiable, et le lien est gardé.

-- ------------------------------------------------------------------
-- 1 · Le prospect
-- ------------------------------------------------------------------

create table if not exists leads (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references agencies on delete cascade,
  office_id        uuid references offices on delete set null,
  assigned_user_id uuid references profiles on delete set null,
  first_name       text,
  last_name        text,
  -- Le fret parle à des sociétés, le visa à des personnes. Les deux entrent
  -- dans le même tuyau commercial, d'où les deux identités possibles.
  company_name     text,
  email            citext,
  phone            text,
  whatsapp         text,
  service_interest text not null default 'autre'
                   check (service_interest in ('visa','import','export','transit','shipping','autre')),
  source           text not null default 'autre'
                   check (source in ('facebook','instagram','tiktok','site','whatsapp','comptoir','recommandation','google','telephone','autre')),
  status           text not null default 'nouveau'
                   check (status in ('nouveau','contacte','qualifie','rendez_vous','devis_envoye','relance','gagne','perdu')),
  estimated_value  numeric(14,3) not null default 0 check (estimated_value >= 0),
  currency         char(3) not null default 'TND',
  lost_reason      text,
  note             text,
  -- Rempli à la conversion. Non vide signifie « déjà converti », et c'est ce
  -- qui interdit la deuxième conversion.
  client_id        uuid references clients on delete set null,
  -- D'où vient le prospect quand il vient du formulaire public.
  request_id       uuid references client_requests on delete set null,
  next_action_at   timestamptz,
  -- Depuis quand l'affaire dort dans cet état. Le tableau de bord en a besoin
  -- pour montrer ce qui stagne, et le déduire du journal coûterait une
  -- sous-requête par ligne à chaque affichage.
  status_since     timestamptz not null default now(),
  -- L'instant exact de la conversion. Sans lui, le délai moyen de conversion
  -- serait deviné à partir de `updated_at`, que la moindre retouche fausse.
  converted_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  -- Un prospect sans nom ni société n'est rien qu'une ligne vide.
  check (coalesce(nullif(trim(last_name), ''), nullif(trim(company_name), '')) is not null)
);

create index if not exists leads_agency_status on leads (agency_id, status, created_at desc);
create index if not exists leads_agency_office on leads (agency_id, office_id);
create index if not exists leads_follow on leads (agency_id, next_action_at) where deleted_at is null;
-- Une demande du formulaire public ne donne qu'un seul prospect : c'est cet
-- index qui rend le refus de la double transformation infaillible, même si
-- deux employés cliquent en même temps.
create unique index if not exists leads_one_per_request on leads (request_id) where request_id is not null;

comment on table leads is
  'Le prospect commercial, avant qu''il ne soit client. Il devient client par lead_convert, une seule fois, et garde le lien.';
comment on column leads.status_since is
  'Depuis quand l''affaire est dans cet état. Tenu par le trigger, jamais à la main.';
comment on column leads.converted_at is
  'L''instant de la conversion. Le délai moyen se mesure dessus, il ne s''estime pas.';

alter table leads enable row level security;
alter table leads force row level security;

drop policy if exists leads_select on leads;
drop policy if exists leads_insert on leads;
drop policy if exists leads_update on leads;
drop policy if exists leads_platform_read on leads;

create policy leads_select on leads for select to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and deleted_at is null);
create policy leads_insert on leads for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('client:write'));
create policy leads_update on leads for update to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('client:write'))
  with check (agency_id = auth_agency_id());
create policy leads_platform_read on leads for select to authenticated
  using (is_platform_admin());

-- Le droit de suppression arrive par les privilèges par défaut posés en 0015.
-- On le retire : ici on marque `deleted_at`, on n'efface pas une affaire.
grant select, insert, update on leads to authenticated;
revoke delete on leads from authenticated;
revoke all on leads from anon;
grant all on leads to service_role;

-- ------------------------------------------------------------------
-- 2 · Le journal des échanges
-- ------------------------------------------------------------------
--
-- En ajout seul, comme `activity_events`. Un journal qu'on peut réécrire ne
-- prouve rien le jour où l'on cherche pourquoi une affaire est partie.

create table if not exists lead_events (
  id        uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies on delete cascade,
  lead_id   uuid not null references leads on delete cascade,
  kind      text not null
            check (kind in ('appel','whatsapp','email','visite','note','changement_etat')),
  body      text,
  at        timestamptz not null default now(),
  author_id uuid references profiles on delete set null
);

create index if not exists lead_events_lead on lead_events (lead_id, at desc);
create index if not exists lead_events_agency on lead_events (agency_id, at desc);

comment on table lead_events is
  'Le journal d''un prospect, en ajout seul. Les changements d''état y entrent par trigger : l''écran ne peut pas oublier de les écrire.';

alter table lead_events enable row level security;
alter table lead_events force row level security;

drop policy if exists lead_events_select on lead_events;
drop policy if exists lead_events_insert on lead_events;
drop policy if exists lead_events_platform_read on lead_events;

-- L'événement suit son prospect, sans jamais élargir le périmètre : le bureau
-- se lit sur le prospect, pas ici.
create policy lead_events_select on lead_events for select to authenticated
  using (exists (select 1 from leads l where l.id = lead_id
                 and l.agency_id = auth_agency_id() and auth_sees_office(l.office_id)));
create policy lead_events_insert on lead_events for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('client:write'));
create policy lead_events_platform_read on lead_events for select to authenticated
  using (is_platform_admin());
-- Aucune politique de mise à jour ni de suppression. Pour personne.

grant select, insert on lead_events to authenticated;
revoke update, delete on lead_events from authenticated;
revoke all on lead_events from anon;
grant all on lead_events to service_role;

-- ------------------------------------------------------------------
-- 3 · Le changement d'état s'écrit tout seul
-- ------------------------------------------------------------------
--
-- Volontairement SANS security definer : le trigger doit s'exécuter avec les
-- droits de celui qui modifie, sinon la politique d'insertion, écrite « to
-- authenticated », ne s'appliquerait plus et l'écriture serait refusée en
-- production. Qui peut modifier un prospect a déjà `client:write`.

create or replace function lead_touch() returns trigger
language plpgsql set search_path = public as $$
declare v_author uuid;
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.status_since := now();
    -- L'auteur n'est cité que s'il a un profil : une écriture de la clé de
    -- service ou d'un travail de fond n'a pas d'employé derrière elle.
    select p.id into v_author from profiles p where p.id = auth.uid();
    insert into lead_events (agency_id, lead_id, kind, body, author_id)
    values (new.agency_id, new.id, 'changement_etat',
            old.status || ' > ' || new.status
              || coalesce(' · ' || nullif(trim(new.lost_reason), ''), ''),
            v_author);
  end if;
  return new;
end $$;

drop trigger if exists leads_touch on leads;
create trigger leads_touch before update on leads
  for each row execute function lead_touch();

-- ------------------------------------------------------------------
-- 4 · La fiche entreprise, pour l'import et l'export
-- ------------------------------------------------------------------
--
-- Un dédouanement se fait au nom d'une société, avec un matricule fiscal et un
-- code en douane. Les garder dans la fiche du particulier obligeait l'agent à
-- les retaper à chaque expédition, et à se tromper une fois sur dix.

create table if not exists client_companies (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references agencies on delete cascade,
  office_id           uuid references offices on delete set null,
  client_id           uuid not null references clients on delete cascade,
  company_name        text not null,
  legal_name          text,
  tax_id              text,
  customs_identifier  text,
  commercial_register text,
  activity_sector     text,
  contact_name        text,
  email               citext,
  phone               text,
  whatsapp            text,
  billing_address     text,
  shipping_address    text,
  country             text,
  note                text,
  created_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

-- Une seule fiche entreprise vivante par client : deux matricules pour le même
-- interlocuteur, c'est une déclaration en douane fausse un jour ou l'autre.
create unique index if not exists client_companies_one_per_client
  on client_companies (client_id) where deleted_at is null;
create index if not exists client_companies_agency on client_companies (agency_id, office_id);
-- Le matricule fiscal identifie la société : il ne se répète pas dans l'agence.
create unique index if not exists client_companies_tax_id
  on client_companies (agency_id, tax_id) where tax_id is not null and deleted_at is null;

comment on table client_companies is
  'La fiche société d''un client, pour l''import et l''export : matricule fiscal, code en douane, registre de commerce.';

alter table client_companies enable row level security;
alter table client_companies force row level security;

drop policy if exists client_companies_select on client_companies;
drop policy if exists client_companies_insert on client_companies;
drop policy if exists client_companies_update on client_companies;
drop policy if exists client_companies_platform_read on client_companies;

create policy client_companies_select on client_companies for select to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and deleted_at is null);
create policy client_companies_insert on client_companies for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('client:write'));
create policy client_companies_update on client_companies for update to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('client:write'))
  with check (agency_id = auth_agency_id());
create policy client_companies_platform_read on client_companies for select to authenticated
  using (is_platform_admin());

grant select, insert, update on client_companies to authenticated;
revoke delete on client_companies from authenticated;
revoke all on client_companies from anon;
grant all on client_companies to service_role;

-- ------------------------------------------------------------------
-- 5 · Les contacts d'un client
-- ------------------------------------------------------------------

create table if not exists client_contacts (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  client_id    uuid not null references clients on delete cascade,
  kind         text not null default 'autre'
               check (kind in ('principal','comptable','logistique','urgence','autre')),
  name         text not null,
  relationship text,
  email        citext,
  phone        text,
  whatsapp     text,
  is_primary   boolean not null default false,
  note         text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index if not exists client_contacts_client on client_contacts (client_id);
-- Un seul contact principal par client. Deux, et l'automatisation ne sait plus
-- à qui parler : elle choisit au hasard, ce qui est pire que de ne rien faire.
create unique index if not exists client_contacts_one_primary
  on client_contacts (client_id) where is_primary and deleted_at is null;

comment on table client_contacts is
  'Les personnes à joindre chez un client. Le contact principal est unique, garanti par un index partiel.';

alter table client_contacts enable row level security;
alter table client_contacts force row level security;

drop policy if exists client_contacts_select on client_contacts;
drop policy if exists client_contacts_insert on client_contacts;
drop policy if exists client_contacts_update on client_contacts;
drop policy if exists client_contacts_platform_read on client_contacts;

-- Le contact n'a pas de bureau à lui : il suit celui de son client.
create policy client_contacts_select on client_contacts for select to authenticated
  using (deleted_at is null and exists (
    select 1 from clients c where c.id = client_id
      and c.agency_id = auth_agency_id() and auth_sees_office(c.office_id)));
create policy client_contacts_insert on client_contacts for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('client:write'));
create policy client_contacts_update on client_contacts for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('client:write') and exists (
    select 1 from clients c where c.id = client_id and auth_sees_office(c.office_id)))
  with check (agency_id = auth_agency_id());
create policy client_contacts_platform_read on client_contacts for select to authenticated
  using (is_platform_admin());

grant select, insert, update on client_contacts to authenticated;
revoke delete on client_contacts from authenticated;
revoke all on client_contacts from anon;
grant all on client_contacts to service_role;

-- ------------------------------------------------------------------
-- 6 · Les étiquettes, définies par l'agence
-- ------------------------------------------------------------------
--
-- La colonne `clients.tags` existe déjà et ne bouge pas. Ce qui manquait,
-- c'est le vocabulaire : sans liste fermée, chacun tape « VIP », « vip » et
-- « V.I.P » et le filtre ne trouve plus rien.

create table if not exists client_tag_defs (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references agencies on delete cascade,
  label      text not null,
  color      text not null default 'gray',
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (agency_id, label)
);

comment on table client_tag_defs is
  'Le vocabulaire des étiquettes de l''agence, avec une couleur. La colonne clients.tags garde les libellés, cette table dit lesquels existent.';

alter table client_tag_defs enable row level security;
alter table client_tag_defs force row level security;

drop policy if exists client_tag_defs_select on client_tag_defs;
drop policy if exists client_tag_defs_insert on client_tag_defs;
drop policy if exists client_tag_defs_update on client_tag_defs;
drop policy if exists client_tag_defs_platform_read on client_tag_defs;

create policy client_tag_defs_select on client_tag_defs for select to authenticated
  using (agency_id = auth_agency_id());
create policy client_tag_defs_insert on client_tag_defs for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('client:write'));
create policy client_tag_defs_update on client_tag_defs for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('client:write'))
  with check (agency_id = auth_agency_id());
create policy client_tag_defs_platform_read on client_tag_defs for select to authenticated
  using (is_platform_admin());

grant select, insert, update on client_tag_defs to authenticated;
revoke delete on client_tag_defs from authenticated;
revoke all on client_tag_defs from anon;
grant all on client_tag_defs to service_role;

-- Le jeu de départ. Une agence qui ouvre l'écran des clients trouve déjà de
-- quoi trier, plutôt qu'une liste vide qu'il faut inventer.
create or replace function seed_crm_tags(p_agency uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into client_tag_defs (agency_id, label, color)
  select p_agency, d.label, d.color
  from (values
    ('VIP', 'violet'), ('Entreprise', 'blue'), ('Particulier', 'gray'),
    ('Visa fréquent', 'green'), ('Importateur', 'blue'), ('Exportateur', 'green'),
    ('Prospect', 'orange'), ('Urgent', 'red'), ('À relancer', 'orange')
  ) as d(label, color)
  on conflict (agency_id, label) do nothing;
end $$;
revoke all on function seed_crm_tags(uuid) from public, anon;
grant execute on function seed_crm_tags(uuid) to authenticated;

-- Une agence créée après cette migration reçoit le jeu sans que personne n'y
-- pense : la création d'agence passe par trois chemins différents, et les
-- appeler un par un laisserait le quatrième à découvert.
create or replace function seed_crm_tags_on_agency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform seed_crm_tags(new.id);
  return new;
end $$;

drop trigger if exists agencies_seed_crm_tags on agencies;
create trigger agencies_seed_crm_tags after insert on agencies
  for each row execute function seed_crm_tags_on_agency();

-- Et les agences déjà là.
do $$
declare a uuid;
begin
  for a in select id from agencies loop perform seed_crm_tags(a); end loop;
end $$;

-- ------------------------------------------------------------------
-- 7 · Convertir un prospect en client
-- ------------------------------------------------------------------
--
-- Le numéro de téléphone est l'identité du client dans l'agence : un prospect
-- qui rappelle six mois plus tard retrouve sa fiche au lieu d'en créer une
-- deuxième.

create or replace function lead_convert(p_lead uuid, p_office uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a uuid := auth_agency_id();
  l leads;
  v_client uuid;
  v_office uuid;
begin
  if not auth_can('client:write') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;

  select * into l from leads where id = p_lead and agency_id = a and deleted_at is null;
  if l.id is null then raise exception 'prospect inconnu' using errcode = 'P0002'; end if;
  if not auth_sees_office(l.office_id) then
    raise exception 'prospect hors de votre bureau' using errcode = '42501';
  end if;
  if l.client_id is not null then
    raise exception 'prospect déjà converti' using errcode = 'P0001';
  end if;
  if coalesce(trim(l.phone), '') = '' then
    raise exception 'un prospect sans numéro ne devient pas client' using errcode = 'P0001';
  end if;

  v_office := coalesce(p_office, l.office_id, auth_office_id());

  select id into v_client from clients where agency_id = a and phone = l.phone;
  if v_client is null then
    insert into clients (agency_id, office_id, first_name, last_name, email, phone, whatsapp)
    values (a, v_office,
            coalesce(nullif(trim(l.first_name), ''), ''),
            coalesce(nullif(trim(l.last_name), ''), l.company_name),
            l.email, l.phone, l.whatsapp)
    returning id into v_client;
  end if;

  update leads
     set status = 'gagne', client_id = v_client, converted_at = now(),
         office_id = coalesce(office_id, v_office), lost_reason = null
   where id = p_lead;

  -- Le changement d'état entre au journal par le trigger. Cette ligne-ci dit
  -- ce que le trigger ne peut pas savoir : quel client est né de l'affaire.
  insert into lead_events (agency_id, lead_id, kind, body, author_id)
  values (a, p_lead, 'note', 'Prospect converti en client.',
          (select p.id from profiles p where p.id = auth.uid()));

  -- Le prospect venu du formulaire public ferme la boucle : la demande est
  -- marquée convertie, comme si elle était passée par la boîte des demandes.
  if l.request_id is not null then
    update client_requests
       set status = 'convertie', client_id = coalesce(client_id, v_client),
           handled_by = coalesce(handled_by, auth.uid()), handled_at = coalesce(handled_at, now())
     where id = l.request_id and agency_id = a and status <> 'convertie';
  end if;

  return v_client;
end $$;
revoke all on function lead_convert(uuid, uuid) from public, anon;
grant execute on function lead_convert(uuid, uuid) to authenticated;

-- ------------------------------------------------------------------
-- 8 · Une demande du formulaire public devient un prospect
-- ------------------------------------------------------------------
--
-- La demande reste ce qu'elle est : on ne la modifie pas, on ne la convertit
-- pas en dossier. On lui ouvre juste un suivi commercial, ce qui manquait pour
-- les demandes de fret que personne ne pouvait qualifier.

create or replace function lead_from_request(p_request uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a uuid := auth_agency_id();
  r client_requests;
  v_lead uuid;
begin
  if not auth_can('client:write') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;

  select * into r from client_requests where id = p_request and agency_id = a;
  if r.id is null then raise exception 'demande inconnue' using errcode = 'P0002'; end if;
  if exists (select 1 from leads where request_id = p_request) then
    raise exception 'demande déjà transformée' using errcode = 'P0001';
  end if;

  insert into leads (agency_id, office_id, assigned_user_id, first_name, last_name,
                     email, phone, whatsapp, service_interest, source, status,
                     note, request_id)
  values (a, auth_office_id(), (select p.id from profiles p where p.id = auth.uid()),
          r.first_name, r.last_name, r.email, r.phone, r.phone,
          case when r.kind = 'fret' then 'shipping' else 'visa' end,
          'site', 'nouveau',
          coalesce(r.note, '') ||
            case when r.destination is not null then coalesce(nullif(r.note, '') || ' · ', '') || r.destination
                 when r.goods is not null then coalesce(nullif(r.note, '') || ' · ', '') || r.goods
                 else '' end,
          p_request)
  returning id into v_lead;

  insert into lead_events (agency_id, lead_id, kind, body, author_id)
  values (a, v_lead, 'note', 'Prospect ouvert depuis la demande ' || r.reference || '.',
          (select p.id from profiles p where p.id = auth.uid()));

  -- La demande passe qualifiée : quelqu'un s'en occupe, elle ne doit plus
  -- clignoter en « nouvelle » dans la boîte.
  update client_requests
     set status = 'qualifiee', handled_by = coalesce(handled_by, auth.uid()),
         handled_at = coalesce(handled_at, now())
   where id = p_request and status = 'nouvelle';

  return v_lead;
end $$;
revoke all on function lead_from_request(uuid) from public, anon;
grant execute on function lead_from_request(uuid) to authenticated;

-- ------------------------------------------------------------------
-- 9 · Le pipeline, par état
-- ------------------------------------------------------------------
--
-- Les huit états sont rendus même vides : une colonne qui disparaît quand elle
-- se vide fait croire que l'étape n'existe plus.

create or replace function crm_pipeline(p_office uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a uuid := auth_agency_id();
  result jsonb;
begin
  if a is null then raise exception 'sans agence' using errcode = '42501'; end if;
  if p_office is not null and not auth_sees_office(p_office) then
    raise exception 'bureau hors de votre portée' using errcode = '42501';
  end if;

  with visibles as (
    select l.id, l.status, l.estimated_value, l.status_since
    from leads l
    where l.agency_id = a and l.deleted_at is null
      and auth_sees_office(l.office_id)
      and (p_office is null or l.office_id = p_office)
  ),
  etats (status, ord) as (values
    ('nouveau', 1), ('contacte', 2), ('qualifie', 3), ('rendez_vous', 4),
    ('devis_envoye', 5), ('relance', 6), ('gagne', 7), ('perdu', 8)
  ),
  agg as (
    select e.status, e.ord,
           count(v.id) as n,
           coalesce(sum(v.estimated_value), 0) as value,
           -- La plus ancienne entrée dans l'état : c'est elle qui dit ce qui dort.
           min(v.status_since) as oldest_at
    from etats e left join visibles v on v.status = e.status
    group by e.status, e.ord
  )
  select jsonb_build_object(
    'office', p_office,
    'total', (select count(*) from visibles),
    'total_value', (select coalesce(sum(estimated_value), 0) from visibles),
    'by_status', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'status', status, 'count', n, 'value', value, 'oldest_at', oldest_at
      ) order by ord), '[]'::jsonb) from agg)
  ) into result;

  return result;
end $$;
revoke all on function crm_pipeline(uuid) from public, anon;
grant execute on function crm_pipeline(uuid) to authenticated;

-- ------------------------------------------------------------------
-- 10 · Les chiffres du commerce, comptés
-- ------------------------------------------------------------------
--
-- Le taux de conversion se lit sur une COHORTE : parmi les prospects entrés
-- dans la fenêtre, combien sont devenus clients. C'est la seule définition qui
-- ne bouge pas quand on rejoue le calcul un mois plus tard, et la seule qu'un
-- gérant peut vérifier à la main sur son cahier.

create or replace function crm_stats(
  p_office uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a uuid := auth_agency_id();
  d_from timestamptz := coalesce(p_from, now() - interval '30 days');
  d_to   timestamptz := coalesce(p_to, now());
  result jsonb;
begin
  if a is null then raise exception 'sans agence' using errcode = '42501'; end if;
  if p_office is not null and not auth_sees_office(p_office) then
    raise exception 'bureau hors de votre portée' using errcode = '42501';
  end if;

  with scope as (
    select l.id, l.status, l.estimated_value, l.lost_reason,
           l.created_at, l.converted_at
    from leads l
    where l.agency_id = a and l.deleted_at is null
      and auth_sees_office(l.office_id)
      and (p_office is null or l.office_id = p_office)
      and l.created_at >= d_from and l.created_at <= d_to
  ),
  reasons as (
    select nullif(trim(lost_reason), '') as reason, count(*) as n
    from scope
    where status = 'perdu' and nullif(trim(lost_reason), '') is not null
    group by 1
    order by count(*) desc, 1
    limit 5
  )
  select jsonb_build_object(
    'from', d_from, 'to', d_to, 'office', p_office,
    'entries', (select count(*) from scope),
    'conversions', (select count(*) from scope where converted_at is not null),
    'conversion_rate', (
      select case when count(*) = 0 then 0
             else round((count(*) filter (where converted_at is not null))::numeric * 100 / count(*), 1)
             end from scope),
    'won_value', (select coalesce(sum(estimated_value), 0) from scope where status = 'gagne'),
    'lost_value', (select coalesce(sum(estimated_value), 0) from scope where status = 'perdu'),
    'lost_reasons', (
      select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'count', n)), '[]'::jsonb)
      from reasons),
    -- Sans conversion, on rend null : zéro laisserait croire à une conversion
    -- instantanée.
    'avg_days_to_convert', (
      select round(avg(extract(epoch from (converted_at - created_at)) / 86400)::numeric, 1)
      from scope where converted_at is not null)
  ) into result;

  return result;
end $$;
revoke all on function crm_stats(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function crm_stats(uuid, timestamptz, timestamptz) to authenticated;

-- ------------------------------------------------------------------
-- 11 · Ce qu'il faut relancer aujourd'hui
-- ------------------------------------------------------------------
--
-- L'affaire perdue par oubli est la plus chère de toutes. On trie d'abord par
-- la date d'action prévue, puis par le silence : un prospect sans nouvelle
-- depuis longtemps remonte, même sans rendez-vous noté.

create or replace function leads_to_follow(p_office uuid default null, p_limit int default 20)
returns table (
  id uuid, first_name text, last_name text, company_name text,
  phone text, whatsapp text, email text,
  status text, service_interest text, source text,
  estimated_value numeric, currency text,
  next_action_at timestamptz, last_event_at timestamptz, silent_days int,
  assigned_user_id uuid, office_id uuid
)
language plpgsql stable security definer set search_path = public as $$
declare a uuid := auth_agency_id();
begin
  if a is null then raise exception 'sans agence' using errcode = '42501'; end if;
  if p_office is not null and not auth_sees_office(p_office) then
    raise exception 'bureau hors de votre portée' using errcode = '42501';
  end if;

  return query
  select l.id, l.first_name, l.last_name, l.company_name,
         l.phone, l.whatsapp, l.email::text,
         l.status, l.service_interest, l.source,
         l.estimated_value, l.currency::text,
         l.next_action_at, e.last_at,
         greatest(0, extract(day from now() - e.last_at)::int),
         l.assigned_user_id, l.office_id
  from leads l
  cross join lateral (
    select coalesce(max(ev.at), l.created_at) as last_at
    from lead_events ev where ev.lead_id = l.id
  ) e
  where l.agency_id = a and l.deleted_at is null
    and l.status not in ('gagne','perdu')
    and auth_sees_office(l.office_id)
    and (p_office is null or l.office_id = p_office)
  order by l.next_action_at asc nulls last, e.last_at asc
  limit greatest(1, least(coalesce(p_limit, 20), 200));
end $$;
revoke all on function leads_to_follow(uuid, int) from public, anon;
grant execute on function leads_to_follow(uuid, int) to authenticated;
