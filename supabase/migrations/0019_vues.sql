-- 0019 · Les vues, qui contournaient la sécurité au niveau des lignes.
--
-- Trouvé par le banc d'étanchéité : un agent lisait `revenue_lines`. Le
-- chiffre d'affaires devait être réservé à la direction, c'était une exigence
-- explicite.
--
-- Deux fautes, pas une, et la seconde est la plus grave des deux :
--
-- 1. **Une vue PostgreSQL s'exécute avec les droits de son propriétaire.**
--    Tant que `security_invoker` est à `off`, la sécurité au niveau des
--    lignes des tables sous-jacentes ne s'applique PAS. Ici la fuite n'a pas
--    traversé le mur entre agences parce que les vues filtrent elles-mêmes
--    sur `auth_agency_id()`. C'est de la chance, pas de la sécurité : la
--    prochaine vue écrite un mardi sans ce filtre ouvrirait tout.
--
-- 2. La capacité `finance:global` n'était vérifiée nulle part dans la vue.
--    Un droit de table ne sait pas distinguer un propriétaire d'un agent :
--    les deux sont le même rôle PostgreSQL, `authenticated`. La distinction
--    ne peut donc vivre que dans la définition de la vue.

alter view revenue_lines      set (security_invoker = on);
alter view shipment_demurrage set (security_invoker = on);
alter view shipment_margin    set (security_invoker = on);

-- Le revenu : direction seulement. On ne retire pas le droit de table, on
-- rend la vue vide pour qui n'a pas la capacité. Le résultat est le même et
-- l'écran n'a pas à distinguer « refusé » de « rien à montrer ».
do $$
declare v_def text;
begin
  select pg_get_viewdef('revenue_lines'::regclass, true) into v_def;
  -- Idempotent : on ne réempile pas le garde si un rejeu passe par ici.
  if position('finance:global' in v_def) = 0 then
    execute 'create or replace view revenue_lines with (security_invoker = on) as '
         || 'select * from (' || rtrim(v_def, ';') || ') as source where auth_can(''finance:global'')';
  end if;
end $$;

do $$
declare v_def text;
begin
  select pg_get_viewdef('shipment_margin'::regclass, true) into v_def;
  if position('finance:global' in v_def) = 0 then
    execute 'create or replace view shipment_margin with (security_invoker = on) as '
         || 'select * from (' || rtrim(v_def, ';') || ') as source where auth_can(''finance:global'')';
  end if;
end $$;

comment on view revenue_lines is
  'Le chiffre d''affaires. Vide pour qui n''a pas finance:global : un droit de table ne distingue pas un propriétaire d''un agent, les deux sont le rôle authenticated.';

-- Toute vue future part avec security_invoker. Ce n'est pas une option de
-- confort : sans lui, une vue est un trou dans le mur.
create or replace function views_without_invoker() returns setof text
language sql stable
set search_path = public
as $$
  select c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and coalesce((select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), 'off') <> 'on';
$$;

revoke all on function views_without_invoker() from public, anon;
grant execute on function views_without_invoker() to authenticated;
