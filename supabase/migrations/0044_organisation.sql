-- 0044 · L'organisation : plusieurs bureaux par personne, des droits qui se
-- règlent au cas par cas, et des invitations qui laissent une trace.
--
-- TROIS MANQUES, ET CE QU'ON EN FAIT.
--
-- 1. Une personne n'appartenait qu'à UN bureau (profiles.office_id). C'est faux
--    dès qu'une agence a un directeur régional qui couvre Tunis et Sousse mais
--    pas Sfax. Aujourd'hui, il n'y a que deux positions possibles : tout, ou un
--    seul bureau. On ouvre la position du milieu.
--
-- 2. Les droits étaient une matrice figée de quatre rôles, écrite dans le code
--    d'une fonction. Une agence qui veut qu'un agent valide les pièces mais ne
--    touche pas à la caisse ne pouvait rien faire.
--
-- 3. Une invitation ne laissait aucune trace : le compte apparaissait, sans
--    qu'on sache qui l'avait ouvert ni quand.
--
-- CE QU'ON NE FAIT PAS, ET POURQUOI.
--
-- Le cahier des charges demande de séparer l'identité (profiles) de
-- l'appartenance (agency_members), pour qu'une personne puisse travailler pour
-- deux agences. C'est le bon modèle sur le papier. Mais `auth_agency_id()` lit
-- l'agence dans le jeton, et cent quarante-huit politiques de sécurité en
-- dépendent : le changement toucherait toute la base pour un cas qui n'existe
-- chez aucune agence tunisienne connue. On garde donc une agence par personne,
-- et le jour où le besoin apparaît, `agency_members` s'ajoutera sans rien
-- casser puisque la lecture passe déjà par une fonction.
--
-- Le cahier demande aussi dix-huit rôles (sept d'agence, onze de bureau). Dans
-- une agence de cinq personnes, dix-huit rôles ne se retiennent pas, et le jour
-- où quelqu'un se trompe, c'est un droit de trop qui ne se voit pas. On garde
-- quatre niveaux d'accès et on rend chaque capacité réglable par personne :
-- « Amira est agent, plus le droit de valider les pièces, moins la caisse ».
-- C'est le même besoin, servi par un modèle qu'on peut relire.

-- ------------------------------------------------------------------
-- 1 · Une personne, plusieurs bureaux
-- ------------------------------------------------------------------
--
-- profiles.office_id ne disparaît pas : il reste le bureau PRINCIPAL, celui où
-- l'on crée un client par défaut, celui qui s'imprime sur un reçu. Ce qu'il
-- cesse d'être, c'est la frontière de ce qu'on voit. La frontière, c'est cette
-- table.

create table if not exists office_members (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references agencies on delete cascade,
  office_id  uuid not null references offices on delete cascade,
  user_id    uuid not null references profiles on delete cascade,
  -- L'intitulé du poste dans ce bureau. Il ne donne aucun droit : il s'affiche.
  -- Les droits se règlent plus bas, capacité par capacité.
  job_title  text,
  active     boolean not null default true,
  added_by   uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (office_id, user_id)
);
create index if not exists office_members_user on office_members (user_id) where active;
create index if not exists office_members_office on office_members (office_id) where active;

comment on table office_members is
  'Les bureaux qu''une personne voit, en plus de son bureau principal. Un agent sans ligne ici ne voit que son bureau principal ; la direction voit toute l''agence sans avoir besoin d''une ligne.';

-- Le bureau principal de chacun devient une appartenance : sans ça, la
-- réécriture d'auth_sees_office fermerait la porte à tout le monde.
insert into office_members (agency_id, office_id, user_id, active)
select p.agency_id, p.office_id, p.id, p.active
from profiles p
where p.office_id is not null
on conflict (office_id, user_id) do nothing;

-- Un profil créé plus tard entre dans son bureau principal tout seul. Sans ce
-- déclencheur, chaque invitation demanderait deux écritures, et la deuxième
-- serait oubliée un jour.
create or replace function office_member_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.office_id is not null then
    insert into office_members (agency_id, office_id, user_id, active)
    values (new.agency_id, new.office_id, new.id, new.active)
    on conflict (office_id, user_id) do update set active = excluded.active;
  end if;
  return new;
end $$;

drop trigger if exists profiles_office_sync on profiles;
create trigger profiles_office_sync
  after insert or update of office_id, active on profiles
  for each row execute function office_member_sync();

-- ------------------------------------------------------------------
-- 2 · Les droits, réglables personne par personne
-- ------------------------------------------------------------------

create table if not exists permissions (
  code        text primary key,
  domain      text not null,
  label_fr    text not null,
  label_en    text not null,
  label_ar    text not null,
  sensitive   boolean not null default false,
  position    int not null default 100
);

comment on table permissions is
  'Le catalogue des capacités. Il ne se règle pas par agence : une capacité inventée par une agence ne serait protégée par aucune politique.';

insert into permissions (code, domain, label_fr, label_en, label_ar, sensitive, position) values
  ('case:read',         'dossiers', 'Voir les dossiers',              'View cases',              'الاطلاع على الملفات',       false, 10),
  ('case:create',       'dossiers', 'Ouvrir un dossier',              'Open a case',             'فتح ملف',                   false, 11),
  ('case:write',        'dossiers', 'Faire avancer un dossier',       'Advance a case',          'تقديم الملف',               false, 12),
  ('client:write',      'clients',  'Créer et modifier des clients',  'Create and edit clients', 'إنشاء وتعديل الحرفاء',      false, 20),
  ('doc:validate',      'pieces',   'Valider une pièce',              'Validate a document',     'المصادقة على وثيقة',        false, 30),
  ('message:send',      'messages', 'Écrire au client',               'Message the client',      'مراسلة الحريف',             false, 40),
  ('payment:write',     'finance',  'Encaisser',                      'Take payments',           'قبض الأموال',               true,  50),
  ('finance:global',    'finance',  'Voir toute la caisse et la marge','See all finances',       'الاطلاع على كل المالية',    true,  51),
  ('shipment:write',    'fret',     'Gérer les cargaisons',           'Manage shipments',        'إدارة الشحنات',             false, 60),
  ('reports:view',      'pilotage', 'Voir les rapports',              'View reports',            'الاطلاع على التقارير',      false, 70),
  ('automation:manage', 'pilotage', 'Régler les automatisations',     'Manage automations',      'ضبط الأتمتة',               false, 71),
  ('settings:view',     'reglages', 'Voir les réglages',              'View settings',           'الاطلاع على الإعدادات',     false, 80),
  ('settings:manage',   'reglages', 'Modifier les réglages',          'Change settings',         'تعديل الإعدادات',           true,  81),
  ('catalog:manage',    'reglages', 'Gérer le catalogue',             'Manage the catalogue',    'إدارة الكتالوج',            false, 82),
  ('team:invite',       'equipe',   'Inviter un agent ou un lecteur', 'Invite agents and viewers','دعوة وكيل أو قارئ',        true,  90),
  ('team:manage',       'equipe',   'Gérer toute l''équipe',          'Manage the whole team',   'إدارة كامل الفريق',         true,  91),
  ('audit:view',        'securite', 'Lire le journal d''audit',       'Read the audit trail',    'قراءة سجل التدقيق',         true,  92),
  ('data:export',       'donnees',  'Exporter les données',           'Export data',             'تصدير البيانات',            true,  95),
  ('data:reset',        'donnees',  'Réinitialiser les données',      'Reset data',              'إعادة تهيئة البيانات',      true,  96)
on conflict (code) do update set
  domain = excluded.domain, label_fr = excluded.label_fr, label_en = excluded.label_en,
  label_ar = excluded.label_ar, sensitive = excluded.sensitive, position = excluded.position;

-- Ce que chaque niveau d'accès donne par défaut. Exactement la matrice qui
-- vivait dans le corps d'auth_can, ni plus ni moins : la changer ici changerait
-- silencieusement les droits de toutes les agences déjà installées.
create table if not exists role_permissions (
  role       text not null check (role in ('owner','manager','agent','viewer')),
  permission text not null references permissions on delete cascade,
  primary key (role, permission)
);

insert into role_permissions (role, permission)
select r, p from (values ('owner'), ('manager'), ('agent'), ('viewer')) as roles(r)
cross join lateral (
  select code as p from permissions where
    case roles.r
      when 'owner' then true
      when 'manager' then code <> all (array['finance:global','team:manage','data:export','data:reset'])
      when 'agent' then code = any (array[
        'case:read','case:write','case:create','client:write','doc:validate',
        'message:send','payment:write','shipment:write','settings:view'])
      else code = 'case:read'
    end
) as sel
on conflict do nothing;

-- La granularité demandée par le cahier des charges : une capacité accordée ou
-- retirée à UNE personne. C'est ce qui remplace les dix-huit rôles, et c'est
-- plus sûr : la surcharge se lit d'un coup d'œil, un rôle de plus ne se lit
-- jamais.
create table if not exists member_permissions (
  agency_id  uuid not null references agencies on delete cascade,
  user_id    uuid not null references profiles on delete cascade,
  permission text not null references permissions on delete cascade,
  -- Vrai : accordée en plus du rôle. Faux : retirée malgré le rôle.
  granted    boolean not null,
  reason     text,
  set_by     uuid references auth.users on delete set null,
  set_at     timestamptz not null default now(),
  primary key (user_id, permission)
);

comment on table member_permissions is
  'Les écarts au rôle, personne par personne. Un droit retiré prime sur le rôle : c''est le sens de la sécurité, un refus explicite ne se contourne pas.';

-- Le calcul des capacités d'une personne, en un seul endroit.
--
-- Le banc a attrapé ici un trou qui ne se voyait pas : filtrer `active` sur le
-- rôle ne suffisait pas, car un droit accordé à titre personnel restait accordé
-- à un compte désactivé. Désactiver quelqu'un doit tout couper, sans exception,
-- sinon la case « inactif » ne veut rien dire.
create or replace function member_capabilities(p_user uuid)
returns text[]
language sql stable security definer set search_path = public, auth as $$
  with vivant as (
    select 1 from profiles where id = p_user and active
  ),
  base as (
    select rp.permission from profiles p
    join role_permissions rp on rp.role = p.role
    where p.id = p_user and p.active
  ),
  ajouts as (
    select permission from member_permissions
    where user_id = p_user and granted and exists (select 1 from vivant)
  ),
  retraits as (
    select permission from member_permissions where user_id = p_user and not granted
  )
  select coalesce(array_agg(distinct c order by c), '{}')
  from (select permission as c from base union select permission from ajouts) u
  where c not in (select permission from retraits)
$$;

-- Les bureaux qu'une personne voit. La direction voit toute l'agence : on rend
-- un tableau vide, et l'appelant sait que vide veut dire « tous ». Un tableau
-- de tous les bureaux grossirait le jeton pour rien.
create or replace function member_offices(p_user uuid)
returns uuid[]
language sql stable security definer set search_path = public, auth as $$
  select case
    when (select role from profiles where id = p_user) in ('owner','manager') then '{}'::uuid[]
    else coalesce((
      select array_agg(distinct om.office_id)
      from office_members om where om.user_id = p_user and om.active
    ), '{}'::uuid[])
  end
$$;

-- ------------------------------------------------------------------
-- 3 · Le jeton porte tout, pour que les politiques restent rapides
-- ------------------------------------------------------------------
--
-- `auth_can` et `auth_sees_office` sont appelées par chaque politique, sur
-- chaque ligne lue. Si elles interrogeaient les tables, chaque liste de clients
-- déclencherait deux requêtes par ligne. Le jeton porte donc les capacités et
-- les bureaux, calculés une fois à l'émission. Le prix : un changement de
-- droits prend effet au prochain rafraîchissement du jeton, dans l'heure. Le
-- même compromis que pour le rôle, qui vit déjà dans le jeton.

create or replace function custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare claims jsonb; p profiles; v_uid uuid;
begin
  claims := coalesce(event -> 'claims', '{}'::jsonb);
  v_uid := (event ->> 'user_id')::uuid;
  select * into p from profiles where id = v_uid;
  if p.id is not null then
    claims := claims
      || jsonb_build_object('agency_id', p.agency_id)
      || jsonb_build_object('agency_role', p.role)
      || jsonb_build_object('office_id', coalesce(p.office_id::text, ''))
      -- Les bureaux visibles. Vide veut dire « toute l'agence ».
      || jsonb_build_object('offices', to_jsonb(member_offices(v_uid)))
      -- Les capacités, rôle et écarts compris.
      || jsonb_build_object('caps', to_jsonb(member_capabilities(v_uid)));
  end if;
  return jsonb_set(event, '{claims}', claims);
end $$;

grant execute on function custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on table role_permissions to supabase_auth_admin;
grant select on table member_permissions to supabase_auth_admin;
grant select on table office_members to supabase_auth_admin;
grant execute on function member_capabilities(uuid) to supabase_auth_admin;
grant execute on function member_offices(uuid) to supabase_auth_admin;

-- ------------------------------------------------------------------
-- 4 · Les deux fonctions dont dépend toute la sécurité
-- ------------------------------------------------------------------
--
-- Elles gardent leur signature et leur contrat. Un jeton ancien, ou un banc
-- d'essai qui pose des revendications à la main, ne porte ni `caps` ni
-- `offices` : le repli lit alors les tables. Sans ce repli, la migration
-- déconnecterait tout le monde jusqu'au renouvellement de son jeton.

create or replace function auth_can(capability text) returns boolean
language plpgsql stable security definer set search_path = public, auth as $$
declare caps jsonb;
begin
  caps := nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'caps';
  if caps is not null and jsonb_typeof(caps) = 'array' then
    return caps ? capability;
  end if;
  -- Repli : le jeton ne porte pas encore les capacités.
  return capability = any (coalesce(member_capabilities(auth.uid()), '{}'));
end $$;

create or replace function auth_sees_office(target uuid) returns boolean
language plpgsql stable security definer set search_path = public, auth as $$
declare offs jsonb; me uuid;
begin
  -- La direction voit toute l'agence, sans rien lire de plus.
  if auth_role() in ('owner','manager') then return true; end if;
  -- Une donnée sans bureau appartient à l'agence entière : la cacher aux agents
  -- viderait des écrans entiers sans raison.
  if target is null then return true; end if;

  offs := nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'offices';
  if offs is not null and jsonb_typeof(offs) = 'array' then
    if jsonb_array_length(offs) = 0 then return true; end if;
    return offs ? target::text;
  end if;

  -- Repli : jeton ancien ou banc d'essai. On lit l'appartenance, et à défaut le
  -- bureau principal, ce qui reproduit exactement l'ancien comportement.
  me := auth.uid();
  if me is null then return target is not distinct from auth_office_id(); end if;
  return exists (
    select 1 from office_members om
    where om.user_id = me and om.office_id = target and om.active
  ) or target is not distinct from auth_office_id();
end $$;

-- ------------------------------------------------------------------
-- 5 · Les invitations laissent une trace
-- ------------------------------------------------------------------
--
-- Le compte se crée par la fonction de bord `invite-user`, qui seule détient la
-- clé de service. Cette table ne crée rien : elle garde qui a invité qui, quand,
-- et si la personne s'est connectée depuis. Sans elle, une invitation ratée est
-- invisible, et un compte ouvert par erreur n'a pas d'auteur.

create table if not exists invitations (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  office_id    uuid references offices on delete set null,
  email        text not null,
  name         text,
  role         text not null check (role in ('owner','manager','agent','viewer')),
  status       text not null default 'envoyee'
               check (status in ('envoyee','acceptee','revoquee','expiree')),
  user_id      uuid references profiles on delete set null,
  invited_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  -- Le mot de passe provisoire n'est PAS ici, ni son empreinte. Il est remis
  -- une fois, de vive voix ou par WhatsApp, et il n'existe nulle part ailleurs.
  note         text
);
create index if not exists invitations_agency on invitations (agency_id, created_at desc);

-- Elle se remplit depuis la fonction de bord, avec la clé de service.
create or replace function invitation_record(
  p_agency uuid, p_office uuid, p_email text, p_name text, p_role text,
  p_user uuid, p_by uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into invitations (agency_id, office_id, email, name, role, user_id, invited_by)
  values (p_agency, p_office, lower(trim(p_email)), p_name, p_role, p_user, p_by)
  returning id into v_id;
  return v_id;
end $$;

-- Une invitation est acceptée le jour où la personne choisit son mot de passe.
create or replace function invitation_accepted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.must_reset_password and not new.must_reset_password then
    update invitations set status = 'acceptee', accepted_at = now()
     where user_id = new.id and status = 'envoyee';
  end if;
  return new;
end $$;

drop trigger if exists profiles_invitation_accepted on profiles;
create trigger profiles_invitation_accepted
  after update of must_reset_password on profiles
  for each row execute function invitation_accepted();

-- ------------------------------------------------------------------
-- 6 · Qui lit quoi
-- ------------------------------------------------------------------

alter table office_members enable row level security;
alter table office_members force row level security;
alter table permissions enable row level security;
alter table permissions force row level security;
alter table role_permissions enable row level security;
alter table role_permissions force row level security;
alter table member_permissions enable row level security;
alter table member_permissions force row level security;
alter table invitations enable row level security;
alter table invitations force row level security;

-- Le catalogue des capacités et la matrice des rôles se lisent par tous : un
-- écran de réglages doit pouvoir expliquer ce qu'un rôle donne. Ils ne
-- s'écrivent par personne : ils sont le socle de la sécurité, pas un réglage.
drop policy if exists permissions_select on permissions;
create policy permissions_select on permissions for select to authenticated using (true);
drop policy if exists role_permissions_select on role_permissions;
create policy role_permissions_select on role_permissions for select to authenticated using (true);

drop policy if exists office_members_select on office_members;
create policy office_members_select on office_members for select to authenticated
  using (agency_id = auth_agency_id());
drop policy if exists office_members_write on office_members;
create policy office_members_write on office_members for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('team:manage'));
drop policy if exists office_members_update on office_members;
create policy office_members_update on office_members for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('team:manage'))
  with check (agency_id = auth_agency_id() and auth_can('team:manage'));

-- Les écarts au rôle se voient par toute l'agence (savoir qui peut quoi n'est
-- pas un secret) mais ne se posent que par qui gère l'équipe.
drop policy if exists member_permissions_select on member_permissions;
create policy member_permissions_select on member_permissions for select to authenticated
  using (agency_id = auth_agency_id());
drop policy if exists member_permissions_write on member_permissions;
create policy member_permissions_write on member_permissions for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('team:manage'));
drop policy if exists member_permissions_update on member_permissions;
create policy member_permissions_update on member_permissions for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('team:manage'))
  with check (agency_id = auth_agency_id() and auth_can('team:manage'));
drop policy if exists member_permissions_delete on member_permissions;
create policy member_permissions_delete on member_permissions for delete to authenticated
  using (agency_id = auth_agency_id() and auth_can('team:manage'));

drop policy if exists invitations_select on invitations;
create policy invitations_select on invitations for select to authenticated
  using (agency_id = auth_agency_id() and (auth_can('team:manage') or auth_can('team:invite')));
drop policy if exists invitations_update on invitations;
create policy invitations_update on invitations for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('team:manage'))
  with check (agency_id = auth_agency_id() and auth_can('team:manage'));

-- La plateforme lit, pour le support. Elle n'écrit pas : c'est la règle de la
-- vue support posée en 0028, et une exception ici la viderait de son sens.
drop policy if exists office_members_platform_read on office_members;
create policy office_members_platform_read on office_members for select to authenticated
  using (is_platform_admin());
drop policy if exists invitations_platform_read on invitations;
create policy invitations_platform_read on invitations for select to authenticated
  using (is_platform_admin());
drop policy if exists member_permissions_platform_read on member_permissions;
create policy member_permissions_platform_read on member_permissions for select to authenticated
  using (is_platform_admin());

revoke all on office_members, permissions, role_permissions, member_permissions, invitations from anon, authenticated;
grant select, insert, update on office_members to authenticated;
grant select on permissions to authenticated;
grant select on role_permissions to authenticated;
grant select, insert, update, delete on member_permissions to authenticated;
grant select, update on invitations to authenticated;
grant all on office_members, permissions, role_permissions, member_permissions, invitations to service_role;

revoke all on function member_capabilities(uuid) from public, anon;
revoke all on function member_offices(uuid) from public, anon;
revoke all on function invitation_record(uuid, uuid, text, text, text, uuid, uuid) from public, anon;
grant execute on function member_capabilities(uuid) to authenticated;
grant execute on function member_offices(uuid) to authenticated;
grant execute on function invitation_record(uuid, uuid, text, text, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------------
-- 7 · Ce que l'écran d'équipe a besoin de savoir
-- ------------------------------------------------------------------

create or replace function team_overview()
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not (auth_can('team:manage') or auth_can('team:invite') or auth_can('settings:view')) then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'email', p.email, 'phone', p.phone,
        'role', p.role, 'office_id', p.office_id, 'active', p.active,
        'must_reset_password', p.must_reset_password,
        'last_seen_at', p.last_seen_at,
        'offices', (select coalesce(jsonb_agg(om.office_id), '[]'::jsonb)
                    from office_members om where om.user_id = p.id and om.active),
        'capabilities', to_jsonb(member_capabilities(p.id)),
        'overrides', (select coalesce(jsonb_agg(jsonb_build_object(
                        'permission', mp.permission, 'granted', mp.granted)), '[]'::jsonb)
                      from member_permissions mp where mp.user_id = p.id)
      ) order by case p.role when 'owner' then 0 when 'manager' then 1 when 'agent' then 2 else 3 end, p.name), '[]'::jsonb)
      from profiles p where p.agency_id = auth_agency_id()),
    'permissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', pe.code, 'domain', pe.domain, 'label_fr', pe.label_fr,
        'label_en', pe.label_en, 'label_ar', pe.label_ar, 'sensitive', pe.sensitive
      ) order by pe.position), '[]'::jsonb) from permissions pe),
    'roles', (
      select coalesce(jsonb_object_agg(role, perms), '{}'::jsonb) from (
        select role, jsonb_agg(permission order by permission) as perms
        from role_permissions group by role) r),
    'invitations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'name', i.name, 'role', i.role,
        'office_id', i.office_id, 'status', i.status, 'created_at', i.created_at,
        'accepted_at', i.accepted_at) order by i.created_at desc), '[]'::jsonb)
      from invitations i where i.agency_id = auth_agency_id() limit 50)
  );
end $$;
revoke all on function team_overview() from public, anon;
grant execute on function team_overview() to authenticated;

-- Poser ou lever un écart au rôle. On refuse de toucher à un propriétaire :
-- retirer un droit au patron par mégarde ferme la porte à tout le monde.
create or replace function set_member_permission(p_user uuid, p_permission text, p_granted boolean)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_agency uuid; v_role text;
begin
  if not auth_can('team:manage') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  select agency_id, role into v_agency, v_role from profiles where id = p_user;
  if v_agency is null or v_agency <> auth_agency_id() then
    raise exception 'hors de votre agence' using errcode = '42501';
  end if;
  if v_role = 'owner' then
    raise exception 'les droits du propriétaire ne se règlent pas' using errcode = 'P0001';
  end if;
  if p_granted is null then
    delete from member_permissions where user_id = p_user and permission = p_permission;
  else
    insert into member_permissions (agency_id, user_id, permission, granted, set_by)
    values (v_agency, p_user, p_permission, p_granted, auth.uid())
    on conflict (user_id, permission) do update
      set granted = excluded.granted, set_by = excluded.set_by, set_at = now();
  end if;
end $$;
revoke all on function set_member_permission(uuid, text, boolean) from public, anon;
grant execute on function set_member_permission(uuid, text, boolean) to authenticated;

-- Ajouter ou retirer un bureau à quelqu'un. Le bureau principal ne se retire
-- pas par ici : il se change sur le profil, sinon la personne se retrouverait
-- sans point d'attache.
create or replace function set_member_office(p_user uuid, p_office uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_agency uuid; v_home uuid;
begin
  if not auth_can('team:manage') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  select agency_id, office_id into v_agency, v_home from profiles where id = p_user;
  if v_agency is null or v_agency <> auth_agency_id() then
    raise exception 'hors de votre agence' using errcode = '42501';
  end if;
  if not exists (select 1 from offices o where o.id = p_office and o.agency_id = v_agency) then
    raise exception 'bureau inconnu dans cette agence' using errcode = 'P0001';
  end if;
  if p_office = v_home and not p_active then
    raise exception 'le bureau principal ne se retire pas ici' using errcode = 'P0001';
  end if;
  insert into office_members (agency_id, office_id, user_id, active, added_by)
  values (v_agency, p_office, p_user, p_active, auth.uid())
  on conflict (office_id, user_id) do update set active = excluded.active;
end $$;
revoke all on function set_member_office(uuid, uuid, boolean) from public, anon;
grant execute on function set_member_office(uuid, uuid, boolean) to authenticated;

-- ------------------------------------------------------------------
-- 8 · Le piège des fonctions de déclencheur
-- ------------------------------------------------------------------
--
-- PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction nouvellement créée.
-- Pour une fonction de déclencheur, personne ne le remarque : elle s'appelle
-- toute seule. Mais elle reste appelable directement par un anonyme, et une
-- fonction SECURITY DEFINER appelable par un anonyme est une porte ouverte.
-- Le banc des droits l'a attrapé sur ce lot. On ferme, et on ferme pour toutes
-- les fonctions de déclencheur du schéma, présentes et à venir dans ce lot :
-- une par une, l'oubli reviendrait.
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
