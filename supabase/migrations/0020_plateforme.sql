-- 0020 · L'espace plateforme. Le tien, au-dessus de toutes les agences.
--
-- Jusqu'ici, tout était cloisonné par agence : c'est la règle, et elle est
-- juste. Mais il manquait un étage au-dessus, le tien : celui qui voit toutes
-- les agences, les crée, les suspend, et lit le revenu de la plateforme, la
-- commission par dossier.
--
-- Ce pouvoir ne passe PAS par le rôle d'agence. Un owner d'agence reste
-- enfermé dans son agence, quoi qu'il arrive. Le super-admin est une identité
-- distincte, dans une table à part, et rien dans le JWT d'agence ne l'accorde.

create table if not exists platform_admins (
  id         uuid primary key references auth.users on delete cascade,
  name       text not null,
  email      text not null,
  -- Un cran de plus que l'accès : qui peut créer d'autres super-admins.
  superuser  boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

alter table platform_admins enable row level security;
alter table platform_admins force row level security;

-- Es-tu un super-admin ? Lu à chaque politique de plateforme. SECURITY
-- DEFINER pour pouvoir se lire lui-même sans boucler sur sa propre politique.
create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from platform_admins where id = auth.uid())
$$;

-- Un super-admin voit la liste des super-admins. Personne d'autre.
create policy platform_admins_select on platform_admins for select to authenticated
  using (is_platform_admin());
-- Seul un superuser en crée ou en retire d'autres. Se protéger d'un
-- super-admin ordinaire qui se promeut est le minimum.
create policy platform_admins_insert on platform_admins for insert to authenticated
  with check (exists (select 1 from platform_admins where id = auth.uid() and superuser));
create policy platform_admins_update on platform_admins for update to authenticated
  using (exists (select 1 from platform_admins where id = auth.uid() and superuser))
  with check (exists (select 1 from platform_admins where id = auth.uid() and superuser));
create policy platform_admins_delete on platform_admins for delete to authenticated
  using (exists (select 1 from platform_admins where id = auth.uid() and superuser)
         and id <> auth.uid());  -- on ne se supprime pas soi-même par accident

-- ------------------------------------------------------------------
-- La commission de la plateforme : ta rémunération
-- ------------------------------------------------------------------
-- Une ligne par dossier facturé à l'agence. Le modèle exact (montant fixe ou
-- pourcentage) est un paramètre de l'agence, arrêté à l'abonnement.

alter table agencies
  add column if not exists commission_kind text not null default 'par_dossier'
    check (commission_kind in ('par_dossier','mensuel','pourcentage','gratuit')),
  add column if not exists commission_amount numeric(10,3) not null default 0,
  add column if not exists commission_currency text not null default 'TND';

create table if not exists platform_invoices (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  period       date not null,               -- premier jour du mois facturé
  cases_billed integer not null default 0,
  amount       numeric(12,3) not null default 0,
  currency     text not null default 'TND',
  status       text not null default 'brouillon'
               check (status in ('brouillon','envoyee','reglee','annulee')),
  issued_at    timestamptz,
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (agency_id, period)
);

alter table platform_invoices enable row level security;
alter table platform_invoices force row level security;
-- Seul le super-admin voit la facturation de la plateforme. Une agence ne
-- voit jamais ce que les autres paient.
create policy platform_invoices_all on platform_invoices for all to authenticated
  using (is_platform_admin()) with check (is_platform_admin());

-- ------------------------------------------------------------------
-- La vue d'ensemble, réservée au super-admin
-- ------------------------------------------------------------------
-- Une fonction plutôt qu'une vue : elle refuse net qui n'est pas super-admin,
-- au lieu de rendre une vue vide qu'on pourrait croire cassée.

create or replace function platform_overview()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v jsonb;
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'agencies_total',   (select count(*) from agencies where deleted_at is null),
    'agencies_active',  (select count(*) from agencies where deleted_at is null and suspended_at is null),
    'agencies_trial',   (select count(*) from agencies where plan = 'essai' and deleted_at is null),
    'clients_total',    (select count(*) from clients where deleted_at is null),
    'cases_total',      (select count(*) from cases),
    'cases_open',       (select count(*) from cases where status = 'ouvert'),
    'cases_this_month', (select count(*) from cases where opened_at >= date_trunc('month', now())),
    'shipments_open',   (select count(*) from shipments where status = 'en_cours'),
    'commission_month', (select coalesce(sum(amount),0) from platform_invoices
                          where period = date_trunc('month', now())::date),
    'commission_pending',(select coalesce(sum(amount),0) from platform_invoices
                          where status in ('brouillon','envoyee'))
  ) into v;
  return v;
end;
$$;

-- La liste des agences pour le super-admin, avec leurs chiffres vitaux. Une
-- fonction, pas une vue, pour la même raison.
create or replace function platform_agencies()
returns table (
  id uuid, slug text, name text, country text, plan text,
  suspended boolean, created_at timestamptz,
  users bigint, clients bigint, cases_open bigint, last_activity timestamptz,
  commission_kind text, commission_amount numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  return query
  select a.id, a.slug, a.name, a.country, a.plan,
         a.suspended_at is not null, a.created_at,
         (select count(*) from profiles p where p.agency_id = a.id),
         (select count(*) from clients c where c.agency_id = a.id and c.deleted_at is null),
         (select count(*) from cases c where c.agency_id = a.id and c.status = 'ouvert'),
         (select max(e.at) from activity_events e where e.agency_id = a.id),
         a.commission_kind, a.commission_amount
  from agencies a
  where a.deleted_at is null
  order by a.created_at desc;
end;
$$;

-- Suspendre, réactiver, ou supprimer une agence. La suspension est réversible
-- et coupe l'accès sans rien effacer ; la suppression est un marquage, pas un
-- DELETE : on ne perd jamais un dossier de visa par accident.
create or replace function platform_set_agency_state(p_agency uuid, p_state text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  if p_state = 'suspendue' then
    update agencies set suspended_at = now() where id = p_agency;
  elsif p_state = 'active' then
    update agencies set suspended_at = null where id = p_agency;
  elsif p_state = 'supprimee' then
    update agencies set deleted_at = now(), suspended_at = coalesce(suspended_at, now()) where id = p_agency;
  else
    raise exception 'état inconnu : %', p_state;
  end if;
end;
$$;

-- Une agence suspendue ne doit plus rien pouvoir faire. On l'ajoute au socle
-- des politiques : le hook laisse entrer, mais l'agence gelée ne lit ni
-- n'écrit. La fonction d'aide est lue par les politiques du tronc commun.
create or replace function auth_agency_active() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from agencies
    where id = auth_agency_id() and (suspended_at is not null or deleted_at is not null)
  )
$$;

revoke all on function platform_overview() from public, anon;
revoke all on function platform_agencies() from public, anon;
revoke all on function platform_set_agency_state(uuid, text) from public, anon;
revoke all on function is_platform_admin() from public, anon;
revoke all on function auth_agency_active() from public, anon;
grant execute on function platform_overview() to authenticated;
grant execute on function platform_agencies() to authenticated;
grant execute on function platform_set_agency_state(uuid, text) to authenticated;
grant execute on function is_platform_admin() to authenticated;
grant execute on function auth_agency_active() to authenticated;
grant select, insert, update, delete on platform_admins to authenticated;
grant select, insert, update, delete on platform_invoices to authenticated;
