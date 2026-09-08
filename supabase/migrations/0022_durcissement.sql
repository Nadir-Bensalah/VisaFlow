-- 0022 · Durcissement, suite aux red teams isolation et portail.
--
-- 1. next_reference (faille faible, red team n°1). SECURITY DEFINER sans garde
--    d'agence, et exposée à authenticated par erreur dans 0015. Un employé de
--    TCA pouvait faire avancer les compteurs de références de Sahara, et lire
--    leur volume d'affaires par la valeur de retour. Aucun appelant légitime
--    n'en a besoin : open_case et collect_payment sont eux-mêmes definer.
revoke execute on function next_reference(uuid, text) from public, anon, authenticated;

-- 2. shipment_demurrage (observation red team n°1). Elle a reçu security_invoker
--    en 0019 mais pas le garde finance:global de ses deux sœurs. Le montant de
--    surestaries est un chiffre d'argent : il rejoint la règle « direction
--    seulement », par cohérence avec revenue_lines et shipment_margin.
do $$
declare v_def text;
begin
  select pg_get_viewdef('shipment_demurrage'::regclass, true) into v_def;
  if position('finance:global' in v_def) = 0 then
    execute 'create or replace view shipment_demurrage with (security_invoker = on) as '
         || 'select * from (' || rtrim(v_def, ';') || ') as source where auth_can(''finance:global'')';
  end if;
end $$;

-- 3. open_case et collect_payment (observation red team n°1). Ils
--    n'exigeaient pas que l'assigné, le groupe ou la caisse appartiennent à
--    l'agence de l'appelant. Sans fuite entre agences (la ligne reste
--    estampillée auth_agency_id), mais une référence croisée incohérente peut
--    se créer. On ferme la porte : ce qu'on désigne doit être chez soi.
create or replace function belongs_to_agency(p_table regclass, p_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if p_id is null then return true; end if;
  execute format('select agency_id from %s where id = $1', p_table) into v using p_id;
  return v is not distinct from auth_agency_id();
end $$;

revoke all on function belongs_to_agency(regclass, uuid) from public, anon;
grant execute on function belongs_to_agency(regclass, uuid) to authenticated;

-- On enveloppe open_case d'un garde sur l'assigné et le groupe, sans réécrire
-- son corps : renommer puis envelopper, le patron déjà éprouvé en 0015.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'open_case')
     and not exists (select 1 from pg_proc where proname = 'open_case_unchecked') then
    alter function open_case(uuid, uuid, uuid, date, text, uuid) rename to open_case_unchecked;
  end if;
end $$;

create or replace function open_case(
  p_client uuid, p_visa_type uuid, p_assignee uuid,
  p_travel date default null, p_source text default 'comptoir', p_group uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  -- Le client et le type de visa sont déjà vérifiés dans le corps d'origine
  -- (« client ou type de visa inconnu »). Ici on ajoute l'assigné et le groupe.
  if not belongs_to_agency('profiles', p_assignee) then
    raise exception 'assigné hors de l''agence' using errcode = '42501';
  end if;
  if not belongs_to_agency('case_groups', p_group) then
    raise exception 'groupe hors de l''agence' using errcode = '42501';
  end if;
  return open_case_unchecked(p_client, p_visa_type, p_assignee, p_travel, p_source, p_group);
end $$;

revoke all on function open_case(uuid, uuid, uuid, date, text, uuid) from public, anon;
revoke all on function open_case_unchecked(uuid, uuid, uuid, date, text, uuid) from public, anon, authenticated;
grant execute on function open_case(uuid, uuid, uuid, date, text, uuid) to authenticated;
