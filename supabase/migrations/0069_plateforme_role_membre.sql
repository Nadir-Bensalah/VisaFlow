-- 0069 : la plateforme peut changer le rôle d'un membre d'une agence.
--
-- Le garde de 0010 n'acceptait un changement de rôle que d'un compte de
-- l'agence portant `team:manage`. La console appelle `platform_set_member`
-- avec un compte qui n'a aucune agence : le garde refusait, et l'écran de la
-- fiche promettait un geste que la base rendait impossible. Ce n'est pas un
-- droit nouveau : `platform_set_member` exige déjà la capacité
-- `agences.modifier` et journalise. On aligne le garde sur cette réalité.
--
-- Ce qui ne bouge pas : personne ne change d'agence, et personne ne se
-- promeut soi-même, plateforme comprise.

create or replace function guard_profile_change() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then return new; end if;
  if new.agency_id is distinct from old.agency_id then
    raise exception 'changement d''agence interdit';
  end if;
  if new.role is distinct from old.role
     and not auth_can('team:manage')
     and not is_platform_admin() then
    raise exception 'changement de rôle interdit';
  end if;
  if new.role is distinct from old.role and new.id = auth.uid() then
    raise exception 'on ne se promeut pas soi-même';
  end if;
  return new;
end $$;

revoke all on function guard_profile_change() from public, anon;
