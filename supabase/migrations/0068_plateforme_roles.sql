-- 0068 · Les rôles de l'équipe plateforme, et le journal de la plateforme.
--
-- Jusqu'ici, la console ne connaissait qu'un seul étage : être dans
-- `platform_admins`, ou ne pas y être. Un stagiaire qui répond aux tickets
-- avait le même pouvoir que Nadir : supprimer une agence, changer un tarif,
-- inviter un autre administrateur. Et rien ne disait ensuite QUI avait fait
-- QUOI : les gestes de la plateforme ne laissaient aucune trace, sauf
-- l'entrée en vue support.
--
-- CE QUE CETTE MIGRATION POSE :
--
--   1. Cinq rôles (superuser, admin, operateur, facturation, lecture) et
--      treize capacités. La table `platform_role_permissions` est LA vérité ;
--      le contrat du front (`web/src/data/plateforme.ts`) en porte une copie
--      pour l'écran d'équipe, à l'identique.
--   2. `platform_can(code)` et `platform_require(code)` : chaque fonction qui
--      MODIFIE exige une capacité. Les lectures restent ouvertes à tout admin
--      actif, y compris au rôle lecture.
--   3. `platform_audit` : un journal en ajout seul. Chaque geste de la console
--      y entre, avec l'agence concernée dans `detail.agency_id`, pour que la
--      fiche d'une agence puisse relire son histoire.
--   4. Les fonctions existantes sont recopiées telles quelles, avec la garde
--      remplacée et une ligne de journal ajoutée. Aucune signature ne change.
--   5. Le poste de pilotage (`platform_cockpit`) et la fiche à 360 degrés
--      (`platform_agency_360`) : une seule requête chacune pour un écran.
--
-- Un compte désactivé (`active = false`) n'est plus admin du tout :
-- `is_platform_admin()` le refuse, donc toutes les politiques et toutes les
-- fonctions le refusent d'un coup. La ligne reste, l'historique aussi.

-- ------------------------------------------------------------------
-- 1 · Les colonnes de l'équipe
-- ------------------------------------------------------------------

alter table platform_admins
  add column if not exists role text not null default 'admin',
  add column if not exists active boolean not null default true,
  add column if not exists must_reset_password boolean not null default false,
  add column if not exists invited_by uuid references auth.users on delete set null;

alter table platform_admins drop constraint if exists platform_admins_role_check;
alter table platform_admins add constraint platform_admins_role_check
  check (role in ('superuser','admin','operateur','facturation','lecture'));

-- Les superusers d'avant restent superusers.
update platform_admins set role = 'superuser' where superuser and role <> 'superuser';

-- La colonne `superuser` reste, parce que 0020 la lit dans ses politiques et
-- que la fonction de bord l'écrit. Elle suit le rôle, dans les deux sens :
-- écrire l'une, c'est écrire l'autre.
create or replace function platform_admins_sync_role()
returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.superuser and new.role <> 'superuser' then
      new.role := 'superuser';
    end if;
  elsif new.role is distinct from old.role then
    -- Le rôle a bougé : la colonne booléenne suit.
    null;
  elsif new.superuser is distinct from old.superuser then
    -- Seul le booléen a bougé : le rôle suit.
    new.role := case when new.superuser then 'superuser'
                     when old.role = 'superuser' then 'admin'
                     else old.role end;
  end if;
  new.superuser := (new.role = 'superuser');
  return new;
end $$;

drop trigger if exists platform_admins_sync_role on platform_admins;
create trigger platform_admins_sync_role
  before insert or update on platform_admins
  for each row execute function platform_admins_sync_role();

-- ------------------------------------------------------------------
-- 2 · Les capacités, et qui les a
-- ------------------------------------------------------------------

create table if not exists platform_permissions (
  code        text primary key,
  label       text not null,
  description text,
  sort        int not null default 0
);

create table if not exists platform_role_permissions (
  role text not null,
  code text not null references platform_permissions on delete cascade,
  primary key (role, code)
);

insert into platform_permissions (code, label, description, sort) values
  ('agences.ouvrir',        'Ouvrir une agence',        'Créer une agence, convertir une demande.', 10),
  ('agences.modifier',      'Modifier une agence',      'Bureaux, membres, coordonnées.', 20),
  ('agences.suspendre',     'Suspendre une agence',     'Suspendre ou réactiver l''accès.', 30),
  ('agences.supprimer',     'Supprimer une agence',     'Marquage de suppression, jamais un DELETE.', 40),
  ('agences.entrer',        'Entrer dans une agence',   'Ouvrir une agence en lecture seule (vue support).', 50),
  ('demandes.traiter',      'Traiter les demandes',     'Avancer une demande de souscription.', 60),
  ('abonnements.modifier',  'Modifier un abonnement',   'Plan, sièges, échéance, commission.', 70),
  ('facturation.encaisser', 'Encaisser',                'Constater un règlement, générer les factures.', 80),
  ('facturation.reactiver', 'Rouvrir une grâce',        'Rouvrir une agence sans encaisser.', 90),
  ('assistance.repondre',   'Répondre à l''assistance', 'Tickets et retours.', 100),
  ('annonces.publier',      'Publier une annonce',      'Rédiger et publier les annonces.', 110),
  ('equipe.gerer',          'Gérer l''équipe',          'Inviter, changer un rôle, désactiver un admin.', 120),
  ('taches.lancer',         'Lancer une tâche',         'Lancer une tâche planifiée à la main.', 130)
on conflict (code) do update
  set label = excluded.label, description = excluded.description, sort = excluded.sort;

-- La grille, à l'identique de ROLE_CAPS dans le contrat. Rejouable : on
-- repart de zéro pour que la table dise exactement ceci et rien d'autre.
delete from platform_role_permissions;
insert into platform_role_permissions (role, code)
select 'superuser', code from platform_permissions
union all
select 'admin', unnest(array['agences.ouvrir','agences.modifier','agences.suspendre','agences.entrer',
  'demandes.traiter','abonnements.modifier','facturation.encaisser','facturation.reactiver',
  'assistance.repondre','annonces.publier','taches.lancer'])
union all
select 'operateur', unnest(array['agences.entrer','agences.modifier','demandes.traiter',
  'assistance.repondre','annonces.publier'])
union all
select 'facturation', unnest(array['abonnements.modifier','facturation.encaisser','facturation.reactiver']);
-- Le rôle lecture n'a aucune ligne : il voit tout, ne touche à rien.

alter table platform_permissions enable row level security;
alter table platform_permissions force row level security;
alter table platform_role_permissions enable row level security;
alter table platform_role_permissions force row level security;

drop policy if exists platform_permissions_read on platform_permissions;
create policy platform_permissions_read on platform_permissions for select to authenticated
  using (is_platform_admin());
drop policy if exists platform_role_permissions_read on platform_role_permissions;
create policy platform_role_permissions_read on platform_role_permissions for select to authenticated
  using (is_platform_admin());

-- Piège 0015 : les droits par défaut donnent tout à authenticated. On reprend.
revoke all on platform_permissions from anon, authenticated;
revoke all on platform_role_permissions from anon, authenticated;
grant select on platform_permissions to authenticated;
grant select on platform_role_permissions to authenticated;
grant all on platform_permissions to service_role;
grant all on platform_role_permissions to service_role;

-- ------------------------------------------------------------------
-- 3 · Qui est admin, et ce qu'il peut
-- ------------------------------------------------------------------

-- Un compte désactivé n'est plus admin. Une seule fonction à changer, et
-- toutes les politiques de 0020, 0028 et suivantes suivent.
create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from platform_admins where id = auth.uid() and active)
$$;

create or replace function platform_can(p_code text) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from platform_admins a
    where a.id = auth.uid() and a.active
      and (a.role = 'superuser'
           or exists (select 1 from platform_role_permissions rp
                      where rp.role = a.role and rp.code = p_code))
  )
$$;

create or replace function platform_require(p_code text) returns void
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  if not platform_can(p_code) then
    raise exception 'capacité requise : %', p_code using errcode = '42501';
  end if;
end $$;

-- Ce que la console demande en s'ouvrant. Un compte désactivé reçoit sa ligne
-- avec `active = false` et aucune capacité : l'écran peut lui dire pourquoi
-- il ne voit rien, au lieu d'un null qui ressemble à une panne.
create or replace function platform_me() returns jsonb
language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'id', a.id, 'email', a.email, 'name', a.name, 'role', a.role,
    'superuser', a.superuser, 'active', a.active,
    'caps', case when not a.active then '[]'::jsonb
                 when a.role = 'superuser' then
                   (select coalesce(jsonb_agg(p.code order by p.sort), '[]'::jsonb) from platform_permissions p)
                 else
                   (select coalesce(jsonb_agg(p.code order by p.sort), '[]'::jsonb)
                    from platform_role_permissions rp join platform_permissions p on p.code = rp.code
                    where rp.role = a.role)
            end,
    'must_reset_password', a.must_reset_password)
  from platform_admins a where a.id = auth.uid()
$$;

create or replace function platform_admin_password_reset_done() returns void
language sql security definer set search_path = public, auth as $$
  update platform_admins set must_reset_password = false where id = auth.uid()
$$;

-- ------------------------------------------------------------------
-- 4 · Le journal de la plateforme
-- ------------------------------------------------------------------
--
-- En ajout seul. `admin_email` et `admin_name` sont recopiés au moment du
-- geste : si l'admin est retiré plus tard, la ligne dit encore qui c'était.
-- Pas de clé étrangère sur `target_id` : la cible peut être une agence, un
-- ticket, un admin, et une trace doit survivre à sa cible.

create table if not exists platform_audit (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid,
  admin_email  text,
  admin_name   text,
  action       text not null,
  target_kind  text not null,
  target_id    uuid,
  target_label text,
  detail       jsonb not null default '{}'::jsonb,
  ip           inet,
  at           timestamptz not null default now()
);
create index if not exists platform_audit_at     on platform_audit (at desc);
create index if not exists platform_audit_target on platform_audit (target_id);
create index if not exists platform_audit_admin  on platform_audit (admin_id);
-- La fiche d'une agence relit aussi les lignes où elle n'est que dans le détail.
create index if not exists platform_audit_agency on platform_audit ((detail ->> 'agency_id'));

alter table platform_audit enable row level security;
alter table platform_audit force row level security;

drop policy if exists platform_audit_select on platform_audit;
create policy platform_audit_select on platform_audit for select to authenticated
  using (is_platform_admin());
drop policy if exists platform_audit_insert on platform_audit;
create policy platform_audit_insert on platform_audit for insert to authenticated
  with check (is_platform_admin() and admin_id = auth.uid());

revoke all on platform_audit from anon, authenticated;
grant select, insert on platform_audit to authenticated;
grant all on platform_audit to service_role;

create or replace function platform_log(
  p_action text, p_target_kind text, p_target_id uuid, p_target_label text,
  p_detail jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare a platform_admins; v_id uuid; v_ip inet;
begin
  select * into a from platform_admins where id = auth.uid() and active;
  if a.id is null then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  begin
    v_ip := sec_req_ip();
  exception when others then
    v_ip := null;
  end;
  insert into platform_audit (admin_id, admin_email, admin_name, action, target_kind,
                              target_id, target_label, detail, ip)
  values (a.id, a.email, a.name, p_action, p_target_kind, p_target_id, p_target_label,
          coalesce(p_detail, '{}'::jsonb), v_ip)
  returning id into v_id;
  return v_id;
end $$;

create or replace function platform_audit_list(
  p_limit int default 100, p_action text default null,
  p_agency uuid default null, p_admin uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'at', x.at, 'admin_id', x.admin_id, 'admin_email', x.admin_email,
      'admin_name', x.admin_name, 'action', x.action, 'target_kind', x.target_kind,
      'target_id', x.target_id, 'target_label', x.target_label, 'detail', x.detail
    ) order by x.at desc), '[]'::jsonb)
    from (
      select * from platform_audit l
      where (p_action is null or l.action = p_action)
        and (p_admin is null or l.admin_id = p_admin)
        and (p_agency is null or l.target_id = p_agency or l.detail ->> 'agency_id' = p_agency::text)
      order by l.at desc
      limit greatest(1, least(coalesce(p_limit, 100), 1000))
    ) x
  );
end $$;

-- ------------------------------------------------------------------
-- 5 · L'équipe : la liste, les rôles, la mise à l'écart
-- ------------------------------------------------------------------

create or replace function platform_admins_list() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'email', a.email, 'role', a.role, 'active', a.active,
      'created_at', a.created_at, 'last_seen_at', a.last_seen_at,
      'invited_by_email', coalesce(
        (select b.email from platform_admins b where b.id = a.invited_by),
        (select u.email from auth.users u where u.id = a.invited_by)),
      'actions_30j', (select count(*) from platform_audit l
                       where l.admin_id = a.id and l.at >= now() - interval '30 days'),
      'must_reset_password', a.must_reset_password
    ) order by
      case a.role when 'superuser' then 0 when 'admin' then 1 when 'operateur' then 2
                  when 'facturation' then 3 else 4 end,
      a.created_at), '[]'::jsonb)
    from platform_admins a
  );
end $$;

-- Le garde commun aux trois gestes d'équipe. Toucher un superuser, ou faire
-- un superuser, exige d'en être un. On ne se touche jamais soi-même : un
-- superuser qui se rétrograde par erreur ne pourrait plus se réparer.
create or replace function platform_admin_guard(p_admin uuid, p_touches_superuser boolean)
returns platform_admins
language plpgsql stable security definer set search_path = public, auth as $$
declare me platform_admins; t platform_admins;
begin
  perform platform_require('equipe.gerer');
  if p_admin = auth.uid() then
    raise exception 'on ne modifie pas son propre compte' using errcode = '42501';
  end if;
  select * into t from platform_admins where id = p_admin;
  if t.id is null then
    raise exception 'administrateur introuvable' using errcode = 'P0002';
  end if;
  select * into me from platform_admins where id = auth.uid();
  if (p_touches_superuser or t.role = 'superuser') and me.role <> 'superuser' then
    raise exception 'réservé au super-administrateur' using errcode = '42501';
  end if;
  return t;
end $$;

-- Reste-t-il un superuser actif si celui-ci cesse de l'être ?
create or replace function platform_admin_other_superuser(p_admin uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins
                 where role = 'superuser' and active and id <> p_admin)
$$;

create or replace function platform_admin_set_role(p_admin uuid, p_role text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare t platform_admins;
begin
  if p_role not in ('superuser','admin','operateur','facturation','lecture') then
    raise exception 'rôle inconnu : %', p_role using errcode = 'P0001';
  end if;
  t := platform_admin_guard(p_admin, p_role = 'superuser');
  if t.role = 'superuser' and t.active and p_role <> 'superuser'
     and not platform_admin_other_superuser(p_admin) then
    raise exception 'il faut garder au moins un super-administrateur actif' using errcode = 'P0001';
  end if;
  update platform_admins set role = p_role where id = p_admin;
  perform platform_log('admin.role', 'admin', p_admin, t.email,
    jsonb_build_object('role_avant', t.role, 'role', p_role));
end $$;

create or replace function platform_admin_set_active(p_admin uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
declare t platform_admins;
begin
  t := platform_admin_guard(p_admin, false);
  if t.role = 'superuser' and t.active and not p_active
     and not platform_admin_other_superuser(p_admin) then
    raise exception 'il faut garder au moins un super-administrateur actif' using errcode = 'P0001';
  end if;
  update platform_admins set active = coalesce(p_active, true) where id = p_admin;
  perform platform_log('admin.actif', 'admin', p_admin, t.email,
    jsonb_build_object('actif_avant', t.active, 'actif', coalesce(p_active, true)));
end $$;

-- Retirer la ligne. Le compte de connexion reste : il ne donne plus accès à
-- rien, et le journal garde son nom et son adresse.
create or replace function platform_admin_remove(p_admin uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare t platform_admins;
begin
  t := platform_admin_guard(p_admin, true);
  if t.role = 'superuser' and t.active and not platform_admin_other_superuser(p_admin) then
    raise exception 'il faut garder au moins un super-administrateur actif' using errcode = 'P0001';
  end if;
  -- Le journal d'abord : la ligne porte encore le nom de l'admin retiré.
  perform platform_log('admin.retire', 'admin', p_admin, t.email,
    jsonb_build_object('role', t.role, 'name', t.name));
  delete from platform_admins where id = p_admin;
end $$;

-- Les politiques d'écriture directes de 0020 lisaient `superuser` brut. Elles
-- lisent maintenant la capacité : c'est la même chose aujourd'hui (seul le
-- superuser a `equipe.gerer`), et ça suivra la grille si elle change.
drop policy if exists platform_admins_insert on platform_admins;
drop policy if exists platform_admins_update on platform_admins;
drop policy if exists platform_admins_delete on platform_admins;
create policy platform_admins_insert on platform_admins for insert to authenticated
  with check (platform_can('equipe.gerer'));
create policy platform_admins_update on platform_admins for update to authenticated
  using (platform_can('equipe.gerer')) with check (platform_can('equipe.gerer'));
create policy platform_admins_delete on platform_admins for delete to authenticated
  using (platform_can('equipe.gerer') and id <> auth.uid());

-- ------------------------------------------------------------------
-- 6 · Les fonctions existantes, avec leur capacité et leur trace
-- ------------------------------------------------------------------
--
-- Chaque corps est recopié de sa dernière définition. Seules deux lignes
-- changent : la garde, et la ligne de journal. `agency_id` entre toujours
-- dans `detail`, pour que la fiche d'une agence retrouve ses lignes.

-- 0020 · suspendre, réactiver, supprimer
create or replace function platform_set_agency_state(p_agency uuid, p_state text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_name text;
begin
  select name into v_name from agencies where id = p_agency;
  if p_state = 'suspendue' then
    perform platform_require('agences.suspendre');
    update agencies set suspended_at = now() where id = p_agency;
    perform platform_log('agence.suspendue', 'agence', p_agency, v_name,
      jsonb_build_object('agency_id', p_agency, 'etat', p_state));
  elsif p_state = 'active' then
    perform platform_require('agences.suspendre');
    update agencies set suspended_at = null where id = p_agency;
    perform platform_log('agence.reactivee', 'agence', p_agency, v_name,
      jsonb_build_object('agency_id', p_agency, 'etat', p_state));
  elsif p_state = 'supprimee' then
    perform platform_require('agences.supprimer');
    update agencies set deleted_at = now(), suspended_at = coalesce(suspended_at, now()) where id = p_agency;
    perform platform_log('agence.supprimee', 'agence', p_agency, v_name,
      jsonb_build_object('agency_id', p_agency, 'etat', p_state));
  else
    raise exception 'état inconnu : %', p_state;
  end if;
end;
$$;

-- 0043 · créer une agence
create or replace function platform_create_agency(
  p_name text, p_slug text, p_country text default 'Tunisie',
  p_commission_kind text default 'par_dossier', p_commission_amount numeric default 8,
  p_city text default null, p_phone text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform platform_require('agences.ouvrir');
  if not slug_available(p_slug) then raise exception 'slug indisponible' using errcode='P0001'; end if;

  insert into agencies (slug, name, country, currency, services, plan,
                        commission_kind, commission_amount, phone)
  values (lower(p_slug), p_name, p_country,
          case when p_country = 'Libye' then 'LYD' else 'TND' end,
          '{visas}', 'essai', p_commission_kind, p_commission_amount, p_phone)
  returning id into v_id;

  -- Le premier bureau, nommé d'après la ville, ou « Siège » à défaut.
  insert into offices (agency_id, name, city, country, country_code, phone, timezone)
  values (v_id, coalesce(nullif(trim(p_city), ''), 'Siège'), nullif(trim(p_city), ''),
          p_country, case when p_country = 'Libye' then 'LY' else 'TN' end, p_phone,
          case when p_country = 'Libye' then 'Africa/Tripoli' else 'Africa/Tunis' end);

  perform seed_catalogue(v_id, '{visas}');
  perform platform_log('agence.ouverte', 'agence', v_id, p_name,
    jsonb_build_object('agency_id', v_id, 'slug', lower(p_slug), 'country', p_country,
                       'commission_kind', p_commission_kind, 'commission_amount', p_commission_amount));
  return v_id;
end $$;

-- 0043 · convertir une demande
create or replace function platform_convert_signup(
  p_signup uuid, p_slug text,
  p_commission_kind text default 'par_dossier',
  p_commission_amount numeric default 8
) returns uuid
language plpgsql security definer set search_path = public as $$
declare s agency_signups; v_id uuid;
begin
  perform platform_require('agences.ouvrir');
  select * into s from agency_signups where id = p_signup;
  if s.id is null then raise exception 'demande introuvable' using errcode = 'P0002'; end if;
  if s.agency_id is not null then raise exception 'demande déjà convertie' using errcode = 'P0001'; end if;

  -- La ville et le téléphone de la demande deviennent ceux du premier bureau.
  v_id := platform_create_agency(s.agency_name, p_slug, s.country, p_commission_kind,
                                 p_commission_amount, s.city, s.phone);
  update agencies set services = s.services, email = s.email where id = v_id;
  update agency_signups
     set status = 'convertie', agency_id = v_id, handled_at = now(), handled_by = auth.uid()
   where id = p_signup;
  perform platform_log('demande.convertie', 'demande', p_signup, s.agency_name,
    jsonb_build_object('agency_id', v_id, 'signup_id', p_signup, 'slug', lower(p_slug)));
  return v_id;
end $$;

-- 0042 · avancer une demande
create or replace function platform_signup_update(
  p_signup uuid, p_status text,
  p_quoted_users int default null, p_quoted_amount numeric default null,
  p_refusal_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare s agency_signups;
begin
  perform platform_require('demandes.traiter');
  update agency_signups
     set status = p_status,
         quoted_users = coalesce(p_quoted_users, quoted_users),
         quoted_amount = coalesce(p_quoted_amount, quoted_amount),
         refusal_reason = case when p_status = 'ecartee' then p_refusal_reason else refusal_reason end,
         handled_at = now(),
         handled_by = auth.uid()
   where id = p_signup
   returning * into s;
  if s.id is null then raise exception 'demande introuvable' using errcode = 'P0002'; end if;
  perform platform_log('demande.mise_a_jour', 'demande', p_signup, s.agency_name,
    jsonb_build_object('agency_id', s.agency_id, 'signup_id', p_signup, 'status', p_status,
                       'quoted_users', p_quoted_users, 'quoted_amount', p_quoted_amount,
                       'refusal_reason', p_refusal_reason));
end $$;

-- 0027 · la commission
create or replace function platform_set_commission(
  p_agency uuid, p_kind text, p_amount numeric
) returns void
language plpgsql security definer set search_path = public as $$
declare a agencies;
begin
  perform platform_require('abonnements.modifier');
  select * into a from agencies where id = p_agency;
  update agencies set commission_kind = p_kind, commission_amount = p_amount where id = p_agency;
  perform platform_log('commission.modifiee', 'agence', p_agency, a.name,
    jsonb_build_object('agency_id', p_agency, 'kind_avant', a.commission_kind, 'kind', p_kind,
                       'amount_avant', a.commission_amount, 'amount', p_amount));
end $$;

-- 0049 · l'abonnement
create or replace function platform_set_subscription(
  p_agency uuid,
  p_plan_code text,
  p_seats int default null,
  p_renewal_on date default null,
  p_status text default 'active'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_plan plans; s subscriptions; v_kind text; v_id uuid; v_seats int;
begin
  perform platform_require('abonnements.modifier');

  select * into v_plan from plans where code = p_plan_code and active;
  if v_plan.id is null then
    raise exception 'plan inconnu : %', p_plan_code using errcode = 'P0002';
  end if;
  if p_status not in ('essai','active','impayee','resiliee','suspendue') then
    raise exception 'état inconnu : %', p_status using errcode = 'P0001';
  end if;

  select * into s from subscriptions
   where agency_id = p_agency and status <> 'resiliee'
   order by started_on desc, created_at desc limit 1;

  -- Les sièges facturés : ce qui est demandé, sinon ce qui était signé, sinon
  -- le nombre réel de comptes actifs. Jamais zéro : une facture à zéro siège
  -- n'a pas d'unité d'œuvre, et la banque la refuse.
  v_seats := greatest(1, coalesce(p_seats, s.seats,
                                  quota_used(p_agency, 'users')::int, 1));

  if s.id is null then
    insert into subscriptions (agency_id, plan_id, status, started_on, renewal_on,
                               billing_period, price_per_user_month, currency, seats)
    values (p_agency, v_plan.id, p_status, current_date,
            coalesce(p_renewal_on, (current_date + interval '1 year')::date),
            v_plan.billing_period, v_plan.price_per_user_month, v_plan.currency, v_seats)
    returning id into v_id;
    v_kind := 'creee';
  else
    v_kind := case
      when p_status = 'resiliee' then 'resiliee'
      when p_status = 'suspendue' then 'suspendue'
      when s.status in ('suspendue','impayee') and p_status = 'active' then 'reactivee'
      when v_plan.id is distinct from s.plan_id then 'changement_plan'
      when p_renewal_on is not null and p_renewal_on is distinct from s.renewal_on then 'renouvelee'
      else 'renouvelee'
    end;

    update subscriptions set
      plan_id = v_plan.id,
      status = p_status,
      seats = v_seats,
      renewal_on = coalesce(p_renewal_on, renewal_on, (current_date + interval '1 year')::date),
      ends_on = case when p_status = 'resiliee' then coalesce(ends_on, current_date) else null end,
      -- Le prix suit le plan au changement de plan, et reste figé sinon.
      price_per_user_month = case when v_plan.id is distinct from s.plan_id
                                  then v_plan.price_per_user_month else price_per_user_month end,
      currency = v_plan.currency,
      billing_period = v_plan.billing_period,
      updated_at = now()
    where id = s.id
    returning id into v_id;
  end if;

  insert into subscription_events (agency_id, subscription_id, kind, detail, by_user)
  values (p_agency, v_id, v_kind,
          jsonb_build_object(
            'plan', v_plan.code,
            'plan_avant', (select code from plans where id = s.plan_id),
            'statut', p_status,
            'statut_avant', s.status,
            'sieges', v_seats,
            'sieges_avant', s.seats,
            'montant_annuel', round(v_seats * v_plan.price_per_user_month * 12, 3)),
          auth.uid());

  perform refresh_usage(p_agency);
  perform platform_log('abonnement.modifie', 'abonnement', v_id,
    (select name from agencies where id = p_agency),
    jsonb_build_object('agency_id', p_agency, 'subscription_id', v_id, 'kind', v_kind,
                       'plan', v_plan.code, 'plan_avant', (select code from plans where id = s.plan_id),
                       'statut', p_status, 'statut_avant', s.status,
                       'sieges', v_seats, 'sieges_avant', s.seats, 'renewal_on', p_renewal_on));
  return agency_plan(p_agency);
end $$;

-- 0066 · constater un règlement
create or replace function platform_record_payment(
  p_agency       uuid,
  p_amount       numeric,
  p_currency     text default 'TND',
  p_period_start date default null,
  p_period_end   date default null,
  p_method       text default 'virement',
  p_reference    text default null,
  p_note         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s          subscriptions;
  v_grace    int;
  v_debut    date;
  v_fin      date;
  v_paiement uuid;
  v_etait    boolean;
begin
  perform platform_require('facturation.encaisser');
  if p_agency is null then
    raise exception 'agence absente' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'un règlement se saisit avec son montant' using errcode = 'P0001';
  end if;

  select * into s from subscriptions
   where agency_id = p_agency
   order by (status = 'resiliee'), started_on desc, created_at desc
   limit 1;
  if s.id is null then
    raise exception 'cette agence n''a pas d''abonnement' using errcode = 'P0002';
  end if;

  -- La même référence deux fois, c'est le même virement saisi deux fois. On
  -- refuse AVANT d'écrire : repousser une échéance d'un an par mégarde ne se
  -- voit qu'un an plus tard.
  if p_reference is not null and exists (
    select 1 from subscription_payments
    where agency_id = p_agency and reference = p_reference
  ) then
    raise exception 'ce règlement est déjà enregistré : %', p_reference
      using errcode = 'P0001';
  end if;

  select coalesce(p.grace_days, 7) into v_grace from plans p where p.id = s.plan_id;
  v_grace := coalesce(v_grace, 7);

  -- La période couverte : ce que le super-admin dit, sinon un an à partir
  -- d'aujourd'hui. L'abonnement se facture à l'année.
  v_debut := coalesce(p_period_start, current_date);
  v_fin   := coalesce(p_period_end, (v_debut + interval '1 year' - interval '1 day')::date);
  if v_fin < v_debut then
    raise exception 'la période finit avant de commencer' using errcode = 'P0001';
  end if;

  insert into subscription_payments (agency_id, subscription_id, amount, currency,
                                     period_start, period_end, method, reference, note,
                                     recorded_by)
  values (p_agency, s.id, p_amount, upper(coalesce(p_currency, 'TND')),
          v_debut, v_fin, coalesce(p_method, 'virement'), p_reference, p_note, auth.uid())
  returning id into v_paiement;

  -- Suspendue POUR IMPAYÉ ? `suspended_on` le dit. Une agence gelée à la main
  -- par la plateforme pour une autre raison (fraude, litige) ne porte pas
  -- cette date : un règlement ne doit pas la rouvrir dans son dos.
  v_etait := s.billing_state = 'suspendue' and s.suspended_on is not null;

  update subscriptions set
    billing_state   = 'a_jour',
    status          = 'active',
    last_payment_on = current_date,
    renewal_on      = v_fin,
    grace_ends_on   = v_fin + v_grace,
    ends_on         = null,
    suspended_on    = null,
    suspend_reason  = null,
    updated_at      = now()
  where id = s.id;

  insert into subscription_events (agency_id, subscription_id, kind, detail, by_user)
  values (p_agency, s.id, 'paiement',
          jsonb_build_object('paiement_id', v_paiement,
                             'montant', p_amount,
                             'devise', upper(coalesce(p_currency, 'TND')),
                             'periode_debut', v_debut,
                             'periode_fin', v_fin,
                             'methode', coalesce(p_method, 'virement'),
                             'reference', p_reference,
                             'etat_avant', s.billing_state),
          auth.uid());

  if v_etait then
    update agencies set suspended_at = null where id = p_agency;
    insert into subscription_events (agency_id, subscription_id, kind, detail, by_user)
    values (p_agency, s.id, 'reactivee',
            jsonb_build_object('motif', 'paiement_enregistre',
                               'paiement_id', v_paiement),
            auth.uid());
  end if;

  perform platform_log('reglement.enregistre', 'reglement', v_paiement,
    (select name from agencies where id = p_agency),
    jsonb_build_object('agency_id', p_agency, 'paiement_id', v_paiement,
                       'montant', p_amount, 'devise', upper(coalesce(p_currency, 'TND')),
                       'periode_debut', v_debut, 'periode_fin', v_fin,
                       'methode', coalesce(p_method, 'virement'), 'reference', p_reference,
                       'reactivee', v_etait));

  return jsonb_build_object(
    'ok', true,
    'agency_id', p_agency,
    'paiement_id', v_paiement,
    'etat', 'a_jour',
    'renewal_on', v_fin,
    'grace_ends_on', v_fin + v_grace,
    'reactivee', v_etait
  );
end $$;

-- 0027 · générer les factures de commission
create or replace function platform_generate_invoices(p_period date default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_period date := coalesce(p_period, date_trunc('month', now())::date); n integer := 0; a record;
begin
  perform platform_require('facturation.encaisser');

  for a in select * from agencies where deleted_at is null loop
    declare
      cases_count integer;
      amount numeric;
    begin
      select count(*) into cases_count from cases
       where agency_id = a.id and opened_at >= v_period and opened_at < v_period + interval '1 month';

      amount := case a.commission_kind
        when 'gratuit' then 0
        when 'mensuel' then a.commission_amount
        when 'pourcentage' then 0  -- le pourcentage se calcule sur le revenu, laissé à part
        else cases_count * a.commission_amount   -- par dossier
      end;

      insert into platform_invoices (agency_id, period, cases_billed, amount, currency, status)
      values (a.id, v_period, cases_count, amount, coalesce(a.commission_currency, 'TND'), 'brouillon')
      on conflict (agency_id, period) do update
        set cases_billed = excluded.cases_billed, amount = excluded.amount
        where platform_invoices.status = 'brouillon';  -- on ne réécrit pas une facture déjà envoyée
      n := n + 1;
    end;
  end loop;
  perform platform_log('factures.generees', 'plateforme', null, to_char(v_period, 'YYYY-MM'),
    jsonb_build_object('periode', v_period, 'agences', n));
  return n;
end $$;

-- 0066 · rouvrir sans encaisser
create or replace function platform_reactivate_agency(p_agency uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare s subscriptions; v_grace int; v_fin date;
begin
  perform platform_require('facturation.reactiver');

  select * into s from subscriptions
   where agency_id = p_agency
   order by (status = 'resiliee'), started_on desc, created_at desc limit 1;
  if s.id is null then
    raise exception 'cette agence n''a pas d''abonnement' using errcode = 'P0002';
  end if;

  select coalesce(p.grace_days, 7) into v_grace from plans p where p.id = s.plan_id;
  v_grace := coalesce(v_grace, 7);
  v_fin := current_date + v_grace;

  update subscriptions set
    billing_state  = 'grace',
    status         = 'active',
    grace_ends_on  = v_fin,
    suspended_on   = null,
    suspend_reason = null,
    ends_on        = null,
    updated_at     = now()
  where id = s.id;

  update agencies set suspended_at = null where id = p_agency;

  insert into subscription_events (agency_id, subscription_id, kind, detail, by_user)
  values (p_agency, s.id, 'reactivee',
          jsonb_build_object('motif', 'geste_commercial',
                             'grace_jusqu_au', v_fin,
                             'note', p_note),
          auth.uid());

  perform platform_log('grace.rouverte', 'agence', p_agency,
    (select name from agencies where id = p_agency),
    jsonb_build_object('agency_id', p_agency, 'subscription_id', s.id,
                       'grace_ends_on', v_fin, 'note', p_note, 'etat_avant', s.billing_state));

  return jsonb_build_object('ok', true, 'agency_id', p_agency,
                            'etat', 'grace', 'grace_ends_on', v_fin);
end $$;

-- 0028 · entrer dans une agence en lecture seule
create or replace function platform_open_agency(p_agency uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_name text;
begin
  perform platform_require('agences.entrer');
  select name into v_name from agencies where id = p_agency;
  if v_name is null then
    raise exception 'agence introuvable' using errcode = 'P0002';
  end if;
  insert into platform_support_log(admin_id, agency_id) values (auth.uid(), p_agency);
  perform platform_log('agence.entree_support', 'agence', p_agency, v_name,
    jsonb_build_object('agency_id', p_agency));
end $$;

-- 0043 · un membre
create or replace function platform_set_member(
  p_profile uuid, p_office uuid, p_role text, p_active boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  perform platform_require('agences.modifier');
  select * into p from profiles where id = p_profile;
  if p.id is null then raise exception 'profil introuvable' using errcode = 'P0002'; end if;
  update profiles set office_id = p_office, role = p_role, active = p_active where id = p_profile;
  perform platform_log('membre.modifie', 'membre', p_profile,
    (select name from agencies where id = p.agency_id),
    jsonb_build_object('agency_id', p.agency_id, 'profile_id', p_profile, 'membre', p.name,
                       'office_avant', p.office_id, 'office_id', p_office,
                       'role_avant', p.role, 'role', p_role,
                       'actif_avant', p.active, 'actif', p_active));
end $$;

-- 0043 · un bureau
create or replace function platform_save_office(
  p_agency uuid, p_office uuid, p_name text, p_city text,
  p_country text, p_phone text default null, p_address text default null, p_active boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform platform_require('agences.modifier');
  if p_office is null then
    insert into offices (agency_id, name, city, country, country_code, phone, address, timezone, active)
    values (p_agency, p_name, p_city, p_country,
            case when p_country = 'Libye' then 'LY' when p_country = 'Chine' then 'CN' else 'TN' end,
            p_phone, p_address,
            case when p_country = 'Libye' then 'Africa/Tripoli' when p_country = 'Chine' then 'Asia/Shanghai' else 'Africa/Tunis' end,
            p_active)
    returning id into v_id;
  else
    update offices set name = p_name, city = p_city, country = p_country,
                       phone = p_phone, address = p_address, active = p_active
     where id = p_office and agency_id = p_agency
     returning id into v_id;
  end if;
  perform platform_log('bureau.enregistre', 'bureau', v_id,
    (select name from agencies where id = p_agency),
    jsonb_build_object('agency_id', p_agency, 'office_id', v_id, 'bureau', p_name,
                       'city', p_city, 'active', p_active, 'cree', p_office is null));
  return v_id;
end $$;

-- 0056 · les tickets
create or replace function platform_ticket_reply(p_ticket uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid; t support_tickets;
begin
  perform platform_require('assistance.repondre');
  v_id := support_reply(p_ticket, p_body);
  select * into t from support_tickets where id = p_ticket;
  perform platform_log('ticket.repondu', 'ticket', p_ticket,
    (select name from agencies where id = t.agency_id),
    jsonb_build_object('agency_id', t.agency_id, 'ticket_id', p_ticket, 'message_id', v_id,
                       'subject', t.subject));
  return v_id;
end $$;

create or replace function platform_ticket_status(p_ticket uuid, p_status text)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare t support_tickets;
begin
  perform platform_require('assistance.repondre');
  if p_status not in ('ouvert','pris_en_charge','en_attente_client','resolu','ferme') then
    raise exception 'état inconnu' using errcode = 'P0001';
  end if;
  select * into t from support_tickets where id = p_ticket;
  update support_tickets
     set status = p_status,
         assigned_admin = coalesce(assigned_admin, auth.uid()),
         -- La date de résolution se pose et se retire toute seule : un ticket
         -- rouvert qui garde sa date de résolution fausse toutes les mesures.
         resolved_at = case when p_status in ('resolu','ferme') then coalesce(resolved_at, now()) else null end
   where id = p_ticket;
  if not found then raise exception 'ticket introuvable' using errcode = 'P0002'; end if;
  perform platform_log('ticket.statut', 'ticket', p_ticket,
    (select name from agencies where id = t.agency_id),
    jsonb_build_object('agency_id', t.agency_id, 'ticket_id', p_ticket, 'subject', t.subject,
                       'statut_avant', t.status, 'statut', p_status));
end $$;

-- 0056 · les retours
create or replace function platform_feedback_handle(p_feedback uuid, p_status text, p_response text default null)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare f feedback;
begin
  perform platform_require('assistance.repondre');
  if p_status not in ('nouveau','lu','planifie','fait','ecarte') then
    raise exception 'état inconnu' using errcode = 'P0001';
  end if;
  select * into f from feedback where id = p_feedback;
  update feedback
     set status = p_status, response = coalesce(p_response, response),
         handled_at = now(), handled_by = auth.uid()
   where id = p_feedback;
  if not found then raise exception 'retour introuvable' using errcode = 'P0002'; end if;
  perform platform_log('retour.traite', 'plateforme', p_feedback,
    (select name from agencies where id = f.agency_id),
    jsonb_build_object('agency_id', f.agency_id, 'feedback_id', p_feedback, 'kind', f.kind,
                       'statut_avant', f.status, 'statut', p_status, 'repondu', p_response is not null));
end $$;

-- 0056 · les annonces
create or replace function platform_save_announcement(
  p_id uuid, p_kind text, p_title jsonb, p_body jsonb, p_severity text,
  p_starts_at timestamptz, p_ends_at timestamptz,
  p_target text, p_target_agency uuid
) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid;
begin
  perform platform_require('annonces.publier');
  if coalesce(p_title ->> 'fr', '') = '' then
    raise exception 'le titre français fait foi, il ne peut pas être vide' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into announcements (kind, title, body, severity, starts_at, ends_at,
                               target, target_agency_id, created_by)
    values (p_kind, p_title, coalesce(p_body, '{}'::jsonb), coalesce(p_severity, 'info'),
            coalesce(p_starts_at, now()), p_ends_at,
            coalesce(p_target, 'toutes'), p_target_agency, auth.uid())
    returning id into v_id;
  else
    update announcements
       set kind = p_kind, title = p_title, body = coalesce(p_body, '{}'::jsonb),
           severity = coalesce(p_severity, 'info'),
           starts_at = coalesce(p_starts_at, starts_at), ends_at = p_ends_at,
           target = coalesce(p_target, 'toutes'), target_agency_id = p_target_agency
     where id = p_id
     returning id into v_id;
    if v_id is null then raise exception 'annonce introuvable' using errcode = 'P0002'; end if;
  end if;
  perform platform_log('annonce.enregistree', 'annonce', v_id, p_title ->> 'fr',
    jsonb_build_object('agency_id', p_target_agency, 'kind', p_kind, 'severity', p_severity,
                       'target', coalesce(p_target, 'toutes'), 'cree', p_id is null));
  return v_id;
end $$;

create or replace function platform_publish_announcement(p_id uuid, p_published boolean default true)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare an announcements;
begin
  perform platform_require('annonces.publier');
  update announcements set published_at = case when p_published then coalesce(published_at, now()) end
   where id = p_id
   returning * into an;
  if an.id is null then raise exception 'annonce introuvable' using errcode = 'P0002'; end if;
  perform platform_log('annonce.publiee', 'annonce', p_id, an.title ->> 'fr',
    jsonb_build_object('agency_id', an.target_agency_id, 'published', coalesce(p_published, true)));
end $$;

-- ------------------------------------------------------------------
-- 7 · Les nouveaux gestes
-- ------------------------------------------------------------------

-- Rattacher une demande à une agence déjà née (créée à la main, avant que la
-- demande n'arrive, ou par un autre chemin).
create or replace function platform_signup_link(p_signup uuid, p_agency uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare s agency_signups; v_name text;
begin
  perform platform_require('demandes.traiter');
  select * into s from agency_signups where id = p_signup;
  if s.id is null then raise exception 'demande introuvable' using errcode = 'P0002'; end if;
  select name into v_name from agencies where id = p_agency and deleted_at is null;
  if v_name is null then raise exception 'agence introuvable' using errcode = 'P0002'; end if;
  update agency_signups
     set status = 'convertie', agency_id = p_agency, handled_at = now(), handled_by = auth.uid()
   where id = p_signup;
  perform platform_log('demande.convertie', 'demande', p_signup, s.agency_name,
    jsonb_build_object('agency_id', p_agency, 'signup_id', p_signup, 'agence', v_name,
                       'rattachee', true));
end $$;

-- Supprimer une agence : un marquage, jamais un DELETE. Le nom exact est
-- exigé : on ne supprime pas dix ans de dossiers de visa sur un clic.
create or replace function platform_delete_agency(p_agency uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare a agencies; v_sub uuid;
begin
  perform platform_require('agences.supprimer');
  select * into a from agencies where id = p_agency and deleted_at is null;
  if a.id is null then raise exception 'agence introuvable' using errcode = 'P0002'; end if;
  if p_confirm is null or btrim(p_confirm) <> a.name then
    raise exception 'le nom ne correspond pas' using errcode = 'P0001';
  end if;

  update agencies set deleted_at = now(), suspended_at = coalesce(suspended_at, now())
   where id = p_agency;

  -- L'abonnement vivant se résilie : il ne sera plus jamais facturé.
  select id into v_sub from subscriptions
   where agency_id = p_agency and status <> 'resiliee'
   order by started_on desc, created_at desc limit 1;
  if v_sub is not null then
    update subscriptions set status = 'resiliee', billing_state = 'resiliee',
                             ends_on = coalesce(ends_on, current_date), updated_at = now()
     where id = v_sub;
    insert into subscription_events (agency_id, subscription_id, kind, detail, by_user)
    values (p_agency, v_sub, 'resiliee',
            jsonb_build_object('motif', 'agence_supprimee'), auth.uid());
  end if;

  perform platform_log('agence.supprimee', 'agence', p_agency, a.name,
    jsonb_build_object('agency_id', p_agency, 'slug', a.slug, 'subscription_id', v_sub,
                       'etait_suspendue', a.suspended_at is not null));
end $$;

-- Lancer une tâche planifiée à la main. En production, on rejoue l'ordre
-- exact que pg_cron connaît ; en local (sans pg_cron), la même table de
-- correspondance qu'en 0058, 0064 et 0066. `run_job` avale l'erreur et
-- l'écrit dans job_runs : on relit cette ligne pour répondre.
create or replace function platform_run_job(p_job text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cmd text; v_short text; v_t0 timestamptz; v_ms int; v_last bigint;
  v_ok boolean; v_affected int; v_detail text;
begin
  perform platform_require('taches.lancer');
  if p_job is null or p_job not like 'visaflow\_%' then
    raise exception 'tâche inconnue : %', coalesce(p_job, '(vide)') using errcode = 'P0002';
  end if;
  -- Sans 0058 (pg_cron absent, donc `job_runs` et `run_job` absents), il n'y a
  -- rien à lancer. Le jumeau local est dans ce cas.
  if to_regclass('public.job_runs') is null or to_regprocedure('public.run_job(text,text)') is null then
    raise exception 'tâches planifiées non installées' using errcode = 'P0001';
  end if;
  v_short := replace(p_job, 'visaflow_', '');

  if to_regclass('cron.job') is not null then
    execute 'select command from cron.job where jobname = $1' into v_cmd using p_job;
  end if;
  if v_cmd is null then
    v_cmd := case p_job
      when 'visaflow_alertes'          then $c$select run_job('alertes', 'select notification_sweep()')$c$
      when 'visaflow_automatisations'  then $c$select run_job('automatisations', 'select run_automations_all()')$c$
      when 'visaflow_consommation'     then $c$select run_job('consommation', 'select refresh_usage_all()')$c$
      when 'visaflow_purge'            then $c$select run_job('purge', 'select purge_expired_all()')$c$
      when 'visaflow_menage_jetons'    then $c$select run_job('menage_jetons', 'delete from otp_codes where expires_at < now() - interval ''1 day''')$c$
      when 'visaflow_menage_journal'   then $c$select run_job('menage_journal', 'delete from job_runs where started_at < now() - interval ''60 days''')$c$
      when 'visaflow_webhooks'         then $c$select run_job('webhooks', 'select dispatch_webhooks()')$c$
      when 'visaflow_facturation'      then $c$select run_job('facturation', 'select billing_sweep()')$c$
      else null
    end;
  end if;
  if v_cmd is null then
    raise exception 'tâche inconnue : %', p_job using errcode = 'P0002';
  end if;

  -- `job_runs.started_at` vaut now(), l'heure du début de la transaction :
  -- on repère le passage par son identifiant, pas par l'horloge.
  execute 'select coalesce(max(id), 0) from job_runs where job = $1' into v_last using v_short;
  v_t0 := clock_timestamp();
  execute v_cmd;
  v_ms := (extract(epoch from clock_timestamp() - v_t0) * 1000)::int;

  execute 'select ok, affected, detail from job_runs where job = $1 and id > $2 '
          'order by id desc limit 1'
     into v_ok, v_affected, v_detail using v_short, v_last;

  perform platform_log('tache.lancee', 'tache', null, p_job,
    jsonb_build_object('job', p_job, 'ok', coalesce(v_ok, false), 'affected', v_affected,
                       'detail', v_detail, 'ms', v_ms));

  return jsonb_build_object('ok', coalesce(v_ok, false), 'affected', v_affected,
                            'detail', v_detail, 'ms', v_ms);
end $$;

-- ------------------------------------------------------------------
-- 8 · Une agence à 360 degrés
-- ------------------------------------------------------------------

create or replace function platform_agency_360(p_agency uuid) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare a agencies; g jsonb; s record;
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  select * into a from agencies where id = p_agency;
  if a.id is null then raise exception 'agence introuvable' using errcode = 'P0002'; end if;

  g := agency_access_state(p_agency);
  select x.*, p.code as plan_code, p.name as plan_name into s
    from subscriptions x left join plans p on p.id = x.plan_id
   where x.agency_id = p_agency
   order by (x.status = 'resiliee'), x.started_on desc, x.created_at desc limit 1;

  return jsonb_build_object(
    'agence', jsonb_build_object(
      'id', a.id, 'slug', a.slug, 'name', a.name, 'country', a.country, 'city', a.city,
      'phone', a.phone, 'email', a.email, 'plan', a.plan, 'created_at', a.created_at,
      'suspended_at', a.suspended_at, 'deleted_at', a.deleted_at,
      'commission_kind', a.commission_kind, 'commission_amount', a.commission_amount,
      'work_mode', a.work_mode),
    'acces', jsonb_build_object(
      'etat', g ->> 'etat',
      'jours_restants', (g ->> 'jours_restants')::int,
      'trial_ends_on', s.trial_ends_on, 'grace_ends_on', s.grace_ends_on, 'renewal_on', s.renewal_on,
      'coupee', a.suspended_at is not null or a.deleted_at is not null,
      'bloquant', coalesce((g ->> 'bloquant')::boolean, false)),
    'abonnement', jsonb_build_object(
      'id', s.id, 'plan_code', s.plan_code, 'plan_name', s.plan_name,
      'status', s.status, 'billing_state', s.billing_state,
      'seats', s.seats, 'price_per_user_month', s.price_per_user_month,
      'billing_period', s.billing_period, 'currency', s.currency,
      'started_on', s.started_on, 'renewal_on', s.renewal_on,
      'trial_ends_on', s.trial_ends_on, 'grace_ends_on', s.grace_ends_on,
      'last_payment_on', s.last_payment_on,
      'mensuel', case when s.id is null then null
                      else round(coalesce(s.seats, 0) * coalesce(s.price_per_user_month, 0), 3) end),
    'bureaux', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'city', o.city, 'active', o.active,
        'members', (select count(distinct u) from (
                      select p.id as u from profiles p where p.office_id = o.id and p.active
                      union
                      select m.user_id from office_members m where m.office_id = o.id and m.active) z)
      ) order by o.created_at), '[]'::jsonb)
      from offices o where o.agency_id = p_agency),
    'membres', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'email', p.email, 'role', p.role, 'active', p.active,
        'office_name', (select o.name from offices o where o.id = p.office_id),
        'last_sign_in_at', (select u.last_sign_in_at from auth.users u where u.id = p.id)
      ) order by case p.role when 'owner' then 0 when 'manager' then 1 when 'agent' then 2 else 3 end, p.name),
      '[]'::jsonb)
      from profiles p where p.agency_id = p_agency),
    'compteurs', jsonb_build_object(
      'clients', (select count(*) from clients c where c.agency_id = p_agency and c.deleted_at is null),
      'cases_open', (select count(*) from cases c where c.agency_id = p_agency and c.status = 'ouvert'),
      'cases_total', (select count(*) from cases c where c.agency_id = p_agency),
      'shipments_open', (select count(*) from shipments sh where sh.agency_id = p_agency and sh.status = 'en_cours'),
      'documents',
        (select count(*) from case_documents d where d.agency_id = p_agency and d.storage_path is not null)
        + (select count(*) from shipment_documents d where d.agency_id = p_agency and d.storage_path is not null)
        + (select count(*) from generated_documents d where d.agency_id = p_agency),
      'storage_bytes', greatest(
        coalesce((select u.storage_bytes from usage_counters u where u.agency_id = p_agency), 0),
        coalesce((select sum(d.file_size)::bigint from case_documents d where d.agency_id = p_agency), 0)),
      'connexions_7j', (select count(distinct us.user_id) from user_sessions us
                         where us.last_seen_at >= now() - interval '7 days'
                           and (us.agency_id = p_agency
                                or us.user_id in (select p.id from profiles p where p.agency_id = p_agency)))),
    'reglements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'paid_on', x.recorded_at, 'amount', x.amount, 'currency', x.currency,
        'method', x.method, 'reference', x.reference,
        'period_start', x.period_start, 'period_end', x.period_end,
        'recorded_by_email', (select u.email from auth.users u where u.id = x.recorded_by)
      ) order by x.recorded_at desc), '[]'::jsonb)
      from (select * from subscription_payments where agency_id = p_agency
             order by recorded_at desc limit 10) x),
    'tickets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'subject', t.subject, 'priority', t.priority, 'status', t.status,
        'created_at', t.created_at
      ) order by t.created_at desc), '[]'::jsonb)
      from support_tickets t
      where t.agency_id = p_agency and t.status in ('ouvert','pris_en_charge','en_attente_client')),
    'journal', platform_audit_list(15, null, p_agency, null),
    'activite_30j', (
      select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'n',
        (select count(*) from activity_events e
          where e.agency_id = p_agency and e.at >= d.day and e.at < d.day + interval '1 day'))
        order by d.day)
      from generate_series(current_date - 29, current_date, interval '1 day') as d(day))
  );
end $$;

-- ------------------------------------------------------------------
-- 9 · Le poste de pilotage
-- ------------------------------------------------------------------
--
-- Une seule requête pour tout l'écran d'accueil. Chaque bloc est protégé par
-- un coalesce : une base vide rend des zéros et des tableaux vides, jamais
-- une erreur. Les séries passent par generate_series : un jour sans rien
-- vaut 0, il n'est pas absent.

create or replace function platform_cockpit() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_mrr numeric; v_mrr30 numeric; v_pot numeric; v_taches jsonb; v_tarif numeric;
  v_taches_echouees jsonb := '[]'::jsonb; v_taches_en_echec int := 0;
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;

  select coalesce(sum(s.seats * s.price_per_user_month), 0) into v_mrr
    from subscriptions s where s.status = 'active';
  select coalesce(sum(s.seats * s.price_per_user_month), 0) into v_mrr30
    from subscriptions s
   where s.status = 'active' and s.started_on <= current_date - 30
     and (s.ends_on is null or s.ends_on > current_date - 30);
  -- Le plan d'essai vaut zéro par construction. Ce qu'un essai rapporterait
  -- s'il signait, c'est le tarif de base de la grille : le plus bas des plans
  -- payants actifs.
  select min(p.price_per_user_month) into v_tarif from plans p
   where p.active and p.price_per_user_month > 0;
  select coalesce(sum(s.seats * case when s.price_per_user_month > 0 then s.price_per_user_month
                                     else coalesce(v_tarif, 0) end), 0) into v_pot
    from subscriptions s join agencies a on a.id = s.agency_id
   where s.status = 'essai' and a.deleted_at is null;

  -- Tout ce qui touche 0058 passe par du SQL dynamique : sans pg_cron (le
  -- jumeau local), `job_runs` et `platform_jobs` n'existent pas, et une
  -- requête statique ne se compilerait même pas.
  v_taches := '[]'::jsonb;
  if to_regclass('cron.job') is not null and to_regprocedure('public.platform_jobs()') is not null then
    execute 'select platform_jobs()' into v_taches;
  end if;
  if to_regclass('public.job_runs') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', 'tache_echouee', 'severity', 'critique',
               'id', r.id::text, 'agency_id', null, 'agency_name', null, 'agency_slug', null,
               'title', r.job, 'detail', r.detail, 'since', r.started_at, 'days', null,
               'url', '/admin/taches') order by r.started_at), '[]'::jsonb),
             count(*)
      from (select distinct on (job) * from job_runs where job not like '%:%'
             order by job, started_at desc) r
      where r.ok = false
    $q$ into v_taches_echouees, v_taches_en_echec;
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'kpis', jsonb_build_object(
      'mrr', v_mrr, 'arr', v_mrr * 12, 'mrr_il_y_a_30j', v_mrr30, 'mrr_potentiel', v_pot,
      'agences_total', (select count(*) from agencies where deleted_at is null),
      'agences_actives', (select count(*) from agencies where deleted_at is null and suspended_at is null),
      'agences_suspendues', (select count(*) from agencies where deleted_at is null and suspended_at is not null),
      'essais_en_cours', (select count(*) from subscriptions s join agencies a on a.id = s.agency_id
                           where s.billing_state = 'essai' and a.deleted_at is null),
      'essais_finissant_7j', (select count(*) from subscriptions s join agencies a on a.id = s.agency_id
                               where s.billing_state = 'essai' and a.deleted_at is null
                                 and s.trial_ends_on <= current_date + 7),
      'graces', (select count(*) from subscriptions s join agencies a on a.id = s.agency_id
                  where s.billing_state = 'grace' and a.deleted_at is null),
      'encaisse_mois', (select coalesce(sum(amount), 0) from subscription_payments
                         where recorded_at >= date_trunc('month', now())),
      'encaisse_30j', (select coalesce(sum(amount), 0) from subscription_payments
                        where recorded_at >= now() - interval '30 days'),
      'demandes_nouvelles', (select count(*) from agency_signups where status = 'nouvelle'),
      'tickets_ouverts', (select count(*) from support_tickets where status in ('ouvert','pris_en_charge')),
      'tickets_urgents', (select count(*) from support_tickets
                           where status in ('ouvert','pris_en_charge') and priority = 'urgente'),
      'comptes_actifs', (select count(*) from profiles where active),
      'dossiers_ouverts', (select count(*) from cases where status = 'ouvert'),
      'dossiers_30j', (select count(*) from cases where opened_at >= now() - interval '30 days'),
      'connexions_24h', (select count(distinct user_id) from user_sessions
                          where last_seen_at >= now() - interval '24 hours')),
    'urgents', (
      select coalesce(jsonb_agg(u.row order by u.rang, u.since), '[]'::jsonb)
      from (
        -- Les demandes de souscription à traiter.
        select case when s.received_at < now() - interval '48 hours' then 1 else 2 end as rang,
               s.received_at as since,
               jsonb_build_object(
                 'kind', 'demande',
                 'severity', case when s.received_at < now() - interval '48 hours' then 'attention' else 'info' end,
                 'id', s.id, 'agency_id', null, 'agency_name', null, 'agency_slug', null,
                 'title', s.agency_name,
                 'detail', concat_ws(' · ', s.contact_name, s.phone, s.city),
                 'since', s.received_at,
                 'days', floor(extract(epoch from now() - s.received_at) / 86400)::int,
                 'url', '/admin/demandes?id=' || s.id) as row
        from agency_signups s where s.status = 'nouvelle'
        union all
        -- Les tickets ouverts : urgent, haute, ou sans réponse depuis un jour.
        select case when t.priority = 'urgente' then 0
                    when t.priority = 'haute' or (t.unanswered and t.last_agence < now() - interval '24 hours') then 1
                    else 2 end,
               t.created_at,
               jsonb_build_object(
                 'kind', 'ticket',
                 'severity', case when t.priority = 'urgente' then 'critique'
                                  when t.priority = 'haute' or (t.unanswered and t.last_agence < now() - interval '24 hours') then 'attention'
                                  else 'info' end,
                 'id', t.id, 'agency_id', t.agency_id, 'agency_name', t.name, 'agency_slug', t.slug,
                 'title', t.subject,
                 'detail', concat_ws(' · ', t.category, t.priority,
                                     case when t.unanswered then 'sans réponse' end),
                 'since', t.created_at,
                 'days', floor(extract(epoch from now() - t.created_at) / 86400)::int,
                 'url', '/admin/assistance?ticket=' || t.id)
        from (
          select t.*, a.name, a.slug,
                 greatest(t.created_at, coalesce(m.last_agence, t.created_at)) as last_agence,
                 (m.last_plateforme is null
                  or m.last_plateforme < greatest(t.created_at, coalesce(m.last_agence, t.created_at))) as unanswered
          from support_tickets t
          join agencies a on a.id = t.agency_id
          left join lateral (
            select max(at) filter (where author_kind = 'plateforme') as last_plateforme,
                   max(at) filter (where author_kind = 'agence') as last_agence
            from support_messages m where m.ticket_id = t.id) m on true
          where t.status in ('ouvert','pris_en_charge')) t
        union all
        -- Les agences suspendues.
        select 0, a.suspended_at,
               jsonb_build_object(
                 'kind', 'suspendue', 'severity', 'critique',
                 'id', a.id, 'agency_id', a.id, 'agency_name', a.name, 'agency_slug', a.slug,
                 'title', a.name,
                 'detail', (select coalesce(s.suspend_reason, 'suspendue') from subscriptions s
                             where s.agency_id = a.id order by (s.status = 'resiliee'), s.started_on desc limit 1),
                 'since', a.suspended_at,
                 'days', floor(extract(epoch from now() - a.suspended_at) / 86400)::int,
                 'url', '/admin/agences/' || a.id)
        from agencies a where a.deleted_at is null and a.suspended_at is not null
        union all
        -- Les grâces en cours.
        select 1, s.updated_at,
               jsonb_build_object(
                 'kind', 'grace', 'severity', 'attention',
                 'id', s.id, 'agency_id', a.id, 'agency_name', a.name, 'agency_slug', a.slug,
                 'title', a.name,
                 'detail', case when s.grace_ends_on is not null
                                then 'grâce jusqu''au ' || to_char(s.grace_ends_on, 'DD/MM/YYYY') end,
                 'since', s.updated_at,
                 'days', s.grace_ends_on - current_date,
                 'url', '/admin/facturation?agence=' || a.id)
        from subscriptions s join agencies a on a.id = s.agency_id
        where s.billing_state = 'grace' and a.deleted_at is null and a.suspended_at is null
        union all
        -- Les essais qui finissent sous trois jours.
        select 1, s.started_on::timestamptz,
               jsonb_build_object(
                 'kind', 'essai_fin', 'severity', 'attention',
                 'id', s.id, 'agency_id', a.id, 'agency_name', a.name, 'agency_slug', a.slug,
                 'title', a.name,
                 'detail', 'essai jusqu''au ' || to_char(s.trial_ends_on, 'DD/MM/YYYY'),
                 'since', s.started_on,
                 'days', s.trial_ends_on - current_date,
                 'url', '/admin/facturation?agence=' || a.id)
        from subscriptions s join agencies a on a.id = s.agency_id
        where s.billing_state = 'essai' and a.deleted_at is null and a.suspended_at is null
          and s.trial_ends_on is not null and s.trial_ends_on <= current_date + 3
        union all
        -- Les tâches dont le dernier passage a échoué (calculées plus haut).
        select 0, (e ->> 'since')::timestamptz, e
        from jsonb_array_elements(v_taches_echouees) e
        union all
        -- Les agences payantes qui ne font plus rien depuis deux semaines.
        select 2, coalesce(e.last_at, a.created_at),
               jsonb_build_object(
                 'kind', 'agence_inactive', 'severity', 'info',
                 'id', a.id, 'agency_id', a.id, 'agency_name', a.name, 'agency_slug', a.slug,
                 'title', a.name,
                 'detail', case when e.last_at is null then 'aucune activité enregistrée'
                                else 'dernière activité le ' || to_char(e.last_at, 'DD/MM/YYYY') end,
                 'since', coalesce(e.last_at, a.created_at),
                 'days', floor(extract(epoch from now() - coalesce(e.last_at, a.created_at)) / 86400)::int,
                 'url', '/admin/agences/' || a.id)
        from agencies a
        left join lateral (select max(at) as last_at from activity_events x where x.agency_id = a.id) e on true
        where a.deleted_at is null and a.suspended_at is null and a.plan <> 'essai'
          and coalesce(e.last_at, a.created_at) < now() - interval '14 days'
      ) u),
    'series', jsonb_build_object(
      'signups_30j', (
        select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'n',
          (select count(*) from agency_signups s where s.received_at >= d.day and s.received_at < d.day + interval '1 day'))
          order by d.day)
        from generate_series(current_date - 29, current_date, interval '1 day') as d(day)),
      'connexions_14j', (
        select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'n',
          (select count(distinct us.user_id) from user_sessions us
            where (us.last_seen_at >= d.day and us.last_seen_at < d.day + interval '1 day')
               or (us.created_at >= d.day and us.created_at < d.day + interval '1 day')))
          order by d.day)
        from generate_series(current_date - 13, current_date, interval '1 day') as d(day)),
      'dossiers_30j', (
        select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'n',
          (select count(*) from cases c where c.opened_at >= d.day and c.opened_at < d.day + interval '1 day'))
          order by d.day)
        from generate_series(current_date - 29, current_date, interval '1 day') as d(day)),
      'encaisse_12m', (
        select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'amount',
          (select coalesce(sum(p.amount), 0) from subscription_payments p
            where p.recorded_at >= m.month and p.recorded_at < m.month + interval '1 month'))
          order by m.month)
        from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()),
                             interval '1 month') as m(month)),
      'mrr_12m', (
        select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'amount',
          (select coalesce(sum(s.seats * s.price_per_user_month), 0) from subscriptions s
            where s.status in ('active','resiliee')
              and s.started_on <= (m.month + interval '1 month' - interval '1 day')::date
              and (s.ends_on is null or s.ends_on >= m.month::date)))
          order by m.month)
        from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()),
                             interval '1 month') as m(month)),
      'agences_12m', (
        select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'n',
          (select count(*) from agencies a
            where a.created_at >= m.month and a.created_at < m.month + interval '1 month'))
          order by m.month)
        from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()),
                             interval '1 month') as m(month))),
    'activite', platform_audit_list(20, null, null, null),
    'taches', v_taches,
    'sante', jsonb_build_object(
      'taches_en_echec', v_taches_en_echec,
      'courriels_echoues_24h', (select count(*) from email_log
        where status in ('echoue','non_configure') and created_at >= now() - interval '24 hours'),
      'webhooks_echoues_24h', (select count(*) from webhook_deliveries
        where status = 'echoue' and created_at >= now() - interval '24 hours'),
      'whatsapp_en_attente', (select count(*) from messages
        where channel = 'whatsapp' and status = 'file'))
  );
end $$;

-- ------------------------------------------------------------------
-- 10 · Les droits
-- ------------------------------------------------------------------

revoke all on function platform_admins_sync_role() from public, anon, authenticated;
revoke all on function is_platform_admin() from public, anon;
revoke all on function platform_can(text) from public, anon;
revoke all on function platform_require(text) from public, anon;
revoke all on function platform_me() from public, anon;
revoke all on function platform_admin_password_reset_done() from public, anon;
revoke all on function platform_log(text, text, uuid, text, jsonb) from public, anon;
revoke all on function platform_audit_list(int, text, uuid, uuid) from public, anon;
revoke all on function platform_admins_list() from public, anon;
revoke all on function platform_admin_guard(uuid, boolean) from public, anon, authenticated;
revoke all on function platform_admin_other_superuser(uuid) from public, anon, authenticated;
revoke all on function platform_admin_set_role(uuid, text) from public, anon;
revoke all on function platform_admin_set_active(uuid, boolean) from public, anon;
revoke all on function platform_admin_remove(uuid) from public, anon;
revoke all on function platform_set_agency_state(uuid, text) from public, anon;
revoke all on function platform_create_agency(text, text, text, text, numeric, text, text) from public, anon;
revoke all on function platform_convert_signup(uuid, text, text, numeric) from public, anon;
revoke all on function platform_signup_update(uuid, text, int, numeric, text) from public, anon;
revoke all on function platform_set_commission(uuid, text, numeric) from public, anon;
revoke all on function platform_set_subscription(uuid, text, int, date, text) from public, anon;
revoke all on function platform_record_payment(uuid, numeric, text, date, date, text, text, text) from public, anon;
revoke all on function platform_generate_invoices(date) from public, anon;
revoke all on function platform_reactivate_agency(uuid, text) from public, anon;
revoke all on function platform_open_agency(uuid) from public, anon;
revoke all on function platform_set_member(uuid, uuid, text, boolean) from public, anon;
revoke all on function platform_save_office(uuid, uuid, text, text, text, text, text, boolean) from public, anon;
revoke all on function platform_ticket_reply(uuid, text) from public, anon;
revoke all on function platform_ticket_status(uuid, text) from public, anon;
revoke all on function platform_feedback_handle(uuid, text, text) from public, anon;
revoke all on function platform_save_announcement(uuid, text, jsonb, jsonb, text, timestamptz, timestamptz, text, uuid) from public, anon;
revoke all on function platform_publish_announcement(uuid, boolean) from public, anon;
revoke all on function platform_signup_link(uuid, uuid) from public, anon;
revoke all on function platform_delete_agency(uuid, text) from public, anon;
revoke all on function platform_run_job(text) from public, anon;
revoke all on function platform_agency_360(uuid) from public, anon;
revoke all on function platform_cockpit() from public, anon;

grant execute on function is_platform_admin() to authenticated;
grant execute on function platform_can(text) to authenticated;
grant execute on function platform_require(text) to authenticated;
grant execute on function platform_me() to authenticated;
grant execute on function platform_admin_password_reset_done() to authenticated;
grant execute on function platform_log(text, text, uuid, text, jsonb) to authenticated;
grant execute on function platform_audit_list(int, text, uuid, uuid) to authenticated;
grant execute on function platform_admins_list() to authenticated;
grant execute on function platform_admin_set_role(uuid, text) to authenticated;
grant execute on function platform_admin_set_active(uuid, boolean) to authenticated;
grant execute on function platform_admin_remove(uuid) to authenticated;
grant execute on function platform_set_agency_state(uuid, text) to authenticated;
grant execute on function platform_create_agency(text, text, text, text, numeric, text, text) to authenticated;
grant execute on function platform_convert_signup(uuid, text, text, numeric) to authenticated;
grant execute on function platform_signup_update(uuid, text, int, numeric, text) to authenticated;
grant execute on function platform_set_commission(uuid, text, numeric) to authenticated;
grant execute on function platform_set_subscription(uuid, text, int, date, text) to authenticated;
grant execute on function platform_record_payment(uuid, numeric, text, date, date, text, text, text) to authenticated;
grant execute on function platform_generate_invoices(date) to authenticated;
grant execute on function platform_reactivate_agency(uuid, text) to authenticated;
grant execute on function platform_open_agency(uuid) to authenticated;
grant execute on function platform_set_member(uuid, uuid, text, boolean) to authenticated;
grant execute on function platform_save_office(uuid, uuid, text, text, text, text, text, boolean) to authenticated;
grant execute on function platform_ticket_reply(uuid, text) to authenticated;
grant execute on function platform_ticket_status(uuid, text) to authenticated;
grant execute on function platform_feedback_handle(uuid, text, text) to authenticated;
grant execute on function platform_save_announcement(uuid, text, jsonb, jsonb, text, timestamptz, timestamptz, text, uuid) to authenticated;
grant execute on function platform_publish_announcement(uuid, boolean) to authenticated;
grant execute on function platform_signup_link(uuid, uuid) to authenticated;
grant execute on function platform_delete_agency(uuid, text) to authenticated;
grant execute on function platform_run_job(text) to authenticated;
grant execute on function platform_agency_360(uuid) to authenticated;
grant execute on function platform_cockpit() to authenticated;

-- Le piège des fonctions de déclencheur, comme en 0056 : une fonction
-- `returns trigger` reste appelable directement par un anonyme si on ne
-- referme pas. On referme, pour toutes celles du schéma.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
  end loop;
end $$;
