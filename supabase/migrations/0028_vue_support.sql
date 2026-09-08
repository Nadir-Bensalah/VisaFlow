-- Vue support de la plateforme : l'admin ultime (Nadir) peut ouvrir n'importe
-- quelle agence EN LECTURE SEULE, pour le SAV, et chaque ouverture est tracée.
--
-- Deux principes tiennent l'étanchéité :
--   1. Moindre privilège. On n'ajoute des politiques de LECTURE que sur les
--      tables exactes que l'espace agence charge. Ni les OTP, ni les secrets
--      WhatsApp, ni les tables financières internes ne sont exposés au support.
--   2. Aucune écriture. Il n'existe aucune politique d'écriture pour la
--      plateforme sur les tables des agences : le support regarde, il ne touche
--      pas. Le front l'empêche aussi côté interface, mais la base est la garde
--      qui compte.
--
-- Ces politiques sont gardées par is_platform_admin() : pour un utilisateur
-- d'agence ordinaire elles renvoient faux et n'ajoutent donc rien à ce qu'il
-- voyait déjà. Aucune fuite entre agences.

-- Le journal d'audit : qui a ouvert quelle agence, quand.
create table if not exists platform_support_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id),
  agency_id uuid not null references agencies(id),
  opened_at timestamptz not null default now()
);
alter table platform_support_log enable row level security;
alter table platform_support_log force row level security;
revoke all on platform_support_log from anon, authenticated;
grant select, insert on platform_support_log to authenticated;

drop policy if exists support_log_select on platform_support_log;
create policy support_log_select on platform_support_log for select to authenticated
  using (is_platform_admin());
-- On n'insère que sa propre trace, et seulement si l'on est bien de la plateforme.
drop policy if exists support_log_insert on platform_support_log;
create policy support_log_insert on platform_support_log for insert to authenticated
  with check (is_platform_admin() and admin_id = auth.uid());

-- Lecture seule pour la plateforme, sur exactement les tables que charge
-- l'espace agence (loadSnapshot). Rien de plus.
do $$
declare
  t text;
  tables text[] := array[
    'offices','profiles','clients','visa_types','consulates','checklists',
    'checklist_versions','cases','case_documents','passport_custody','case_notes',
    'messages','message_templates','appointments','payments','automation_rules',
    'activity_events','tasks','shipments','shipment_documents','shipment_events',
    'client_requests','appointment_queue','slot_attempts'];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', t || '_platform_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (is_platform_admin())',
      t || '_platform_read', t);
  end loop;
end $$;

-- La fiche de l'agence elle-même, lue par son id.
drop policy if exists agencies_platform_read on public.agencies;
create policy agencies_platform_read on public.agencies for select to authenticated
  using (is_platform_admin());

-- La porte d'entrée auditée : vérifie le rôle, journalise l'accès. Le front
-- l'appelle avant de charger l'agence en mode support.
create or replace function platform_open_agency(p_agency uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  if not exists (select 1 from agencies where id = p_agency) then
    raise exception 'agence introuvable' using errcode = 'P0002';
  end if;
  insert into platform_support_log(admin_id, agency_id) values (auth.uid(), p_agency);
end $$;
revoke all on function platform_open_agency(uuid) from public, anon;
grant execute on function platform_open_agency(uuid) to authenticated;

-- L'historique des accès support, pour rendre la traçabilité visible.
create or replace function platform_support_history(p_limit int default 100)
returns table(admin_email text, agency_name text, opened_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select u.email, a.name, l.opened_at
  from platform_support_log l
  join agencies a on a.id = l.agency_id
  left join auth.users u on u.id = l.admin_id
  where is_platform_admin()
  order by l.opened_at desc
  limit greatest(1, least(p_limit, 500))
$$;
revoke all on function platform_support_history(int) from public, anon;
grant execute on function platform_support_history(int) to authenticated;
