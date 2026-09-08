-- 0043 · Plusieurs bureaux par agence, une équipe par bureau, et des comptes
-- qui peuvent enfin être créés.
--
-- L'étanchéité par bureau EXISTE depuis le socle : `auth_sees_office` laisse
-- le propriétaire et le manager voir toute l'agence, et confine tout le monde
-- d'autre à son bureau. Ce qui manquait, c'est tout ce qui permet de s'en
-- servir : créer un bureau, y mettre quelqu'un, et surtout LUI OUVRIR UN COMPTE.
--
-- Car un profil référence auth.users : sans compte, pas de profil. Et un compte
-- ne se crée qu'avec la clé de service, qui ne doit jamais toucher un
-- navigateur. Aujourd'hui, en production, personne ne peut donc ajouter un
-- employé, ni la plateforme, ni l'agence. La création passe par une fonction de
-- bord (invite-user) ; ce fichier prépare ce dont elle a besoin en base.

-- ------------------------------------------------------------------
-- 1 · Le premier mot de passe est provisoire
-- ------------------------------------------------------------------
--
-- Le projet n'a pas de serveur d'envoi de courriels : Supabase en offre deux par
-- heure, avec des liens vers localhost. On n'y confie donc pas l'invitation.
-- Le compte naît avec un mot de passe provisoire remis une seule fois à qui
-- invite, qui le transmet par téléphone ou WhatsApp, comme une agence
-- tunisienne le ferait de toute façon. À la première connexion, l'outil impose
-- d'en choisir un autre.

alter table profiles add column if not exists must_reset_password boolean not null default false;

comment on column profiles.must_reset_password is
  'Vrai tant que le mot de passe provisoire remis à l''invitation n''a pas été remplacé. L''application bloque tout jusque-là.';

-- Une fois le mot de passe changé, l'utilisateur lève lui-même le drapeau. Il
-- ne peut lever QUE le sien, et ne peut rien changer d'autre par ce chemin.
create or replace function password_reset_done()
returns void
language sql security definer set search_path = public as $$
  update profiles set must_reset_password = false where id = auth.uid()
$$;
revoke all on function password_reset_done() from public, anon;
grant execute on function password_reset_done() to authenticated;

-- ------------------------------------------------------------------
-- 2 · L'adresse e-mail est obligatoire pour souscrire
-- ------------------------------------------------------------------
--
-- C'est l'identifiant de connexion : sans elle, aucun compte ne peut être
-- ouvert au propriétaire. Le formulaire la rendait facultative.

update agency_signups set email = phone || '@a-completer.invalid' where email is null;
alter table agency_signups alter column email set not null;

-- ------------------------------------------------------------------
-- 3 · Créer une agence crée aussi son premier bureau
-- ------------------------------------------------------------------
--
-- Une agence sans bureau ne peut accueillir personne : chaque profil pointe un
-- bureau. La création en pose donc un d'office, dans la ville de l'agence.

-- L'ancienne signature disparaît : PostgREST refuse de choisir entre deux
-- surcharges quand les paramètres nommés conviennent aux deux.
drop function if exists platform_create_agency(text, text, text, text, numeric);

create or replace function platform_create_agency(
  p_name text, p_slug text, p_country text default 'Tunisie',
  p_commission_kind text default 'par_dossier', p_commission_amount numeric default 8,
  p_city text default null, p_phone text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_platform_admin() then raise exception 'réservé à la plateforme' using errcode='42501'; end if;
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
  return v_id;
end $$;

create or replace function platform_convert_signup(
  p_signup uuid, p_slug text,
  p_commission_kind text default 'par_dossier',
  p_commission_amount numeric default 8
) returns uuid
language plpgsql security definer set search_path = public as $$
declare s agency_signups; v_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
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
  return v_id;
end $$;

-- ------------------------------------------------------------------
-- 4 · Ce que la plateforme voit d'une agence : ses bureaux, son équipe
-- ------------------------------------------------------------------

drop function if exists platform_agencies();
create or replace function platform_agencies()
returns table (
  id uuid, slug text, name text, country text, plan text,
  suspended boolean, created_at timestamptz,
  users bigint, offices bigint, clients bigint, cases_open bigint, last_activity timestamptz,
  commission_kind text, commission_amount numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  return query
  select a.id, a.slug, a.name, a.country, a.plan,
         a.suspended_at is not null, a.created_at,
         (select count(*) from profiles p where p.agency_id = a.id),
         (select count(*) from offices o where o.agency_id = a.id and o.active),
         (select count(*) from clients c where c.agency_id = a.id and c.deleted_at is null),
         (select count(*) from cases c where c.agency_id = a.id and c.status = 'ouvert'),
         (select max(e.at) from activity_events e where e.agency_id = a.id),
         a.commission_kind, a.commission_amount
  from agencies a
  where a.deleted_at is null
  order by a.created_at desc;
end $$;
revoke all on function platform_agencies() from public, anon;
grant execute on function platform_agencies() to authenticated;

-- Le détail d'une agence pour la console : ses bureaux et qui travaille où.
create or replace function platform_agency_detail(p_agency uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'agency', (select jsonb_build_object('id', a.id, 'slug', a.slug, 'name', a.name,
                 'country', a.country, 'email', a.email, 'phone', a.phone, 'services', to_jsonb(a.services))
               from agencies a where a.id = p_agency),
    'offices', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'city', o.city, 'country', o.country,
        'phone', o.phone, 'address', o.address, 'active', o.active,
        'team', (select count(*) from profiles p where p.office_id = o.id and p.active),
        'clients', (select count(*) from clients c where c.office_id = o.id and c.deleted_at is null),
        'cases_open', (select count(*) from cases c where c.office_id = o.id and c.status = 'ouvert')
      ) order by o.created_at), '[]'::jsonb)
      from offices o where o.agency_id = p_agency),
    'team', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'email', p.email, 'phone', p.phone,
        'role', p.role, 'office_id', p.office_id, 'active', p.active,
        'must_reset_password', p.must_reset_password,
        'last_seen_at', p.last_seen_at,
        'last_sign_in_at', (select u.last_sign_in_at from auth.users u where u.id = p.id)
      ) order by case p.role when 'owner' then 0 when 'manager' then 1 when 'agent' then 2 else 3 end, p.name), '[]'::jsonb)
      from profiles p where p.agency_id = p_agency)
  );
end $$;
revoke all on function platform_agency_detail(uuid) from public, anon;
grant execute on function platform_agency_detail(uuid) to authenticated;

-- Créer ou modifier un bureau depuis la console. L'agence, elle, passe par la
-- politique offices_write qui existe déjà.
create or replace function platform_save_office(
  p_agency uuid, p_office uuid, p_name text, p_city text,
  p_country text, p_phone text default null, p_address text default null, p_active boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
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
  return v_id;
end $$;
revoke all on function platform_save_office(uuid, uuid, text, text, text, text, text, boolean) from public, anon;
grant execute on function platform_save_office(uuid, uuid, text, text, text, text, text, boolean) to authenticated;

-- Déplacer quelqu'un d'un bureau à l'autre, ou changer son rôle, depuis la
-- console. Le jeton se met à jour à son prochain rafraîchissement : le hook lit
-- profiles à chaque émission.
create or replace function platform_set_member(
  p_profile uuid, p_office uuid, p_role text, p_active boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  update profiles set office_id = p_office, role = p_role, active = p_active where id = p_profile;
end $$;
revoke all on function platform_set_member(uuid, uuid, text, boolean) from public, anon;
grant execute on function platform_set_member(uuid, uuid, text, boolean) to authenticated;

-- ------------------------------------------------------------------
-- 5 · Rien de tout cela n'est ouvert à l'anonyme
-- ------------------------------------------------------------------
--
-- Une fonction recréée sous une nouvelle signature repart avec les droits par
-- défaut de PostgreSQL : exécutable par tout le monde. Elle refuse d'elle-même
-- qui n'est pas la plateforme, mais le banc des droits exige que la porte soit
-- fermée AVANT la vérification, pas seulement derrière.
revoke all on function platform_create_agency(text, text, text, text, numeric, text, text) from public, anon;
grant execute on function platform_create_agency(text, text, text, text, numeric, text, text) to authenticated;
-- Même oubli dans 0041 : la conversion en devise de base est un calcul interne.
revoke all on function payment_in_base(numeric, numeric) from public, anon;
grant execute on function payment_in_base(numeric, numeric) to authenticated;
