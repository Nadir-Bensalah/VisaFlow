-- 0027 · La console plateforme, tous les CRUD.
--
-- L'ingénieur produit l'a chiffrée à 40 % : elle lisait et suspendait, mais ne
-- créait pas d'agence, n'éditait pas la commission, ne générait pas les
-- factures. On complète, toujours réservé au super-admin.

-- Créer une agence depuis la console. L'owner sera invité ensuite : l'agence
-- peut exister sans compte, offices et profiles étant des tables à part.
create or replace function platform_create_agency(
  p_name text, p_slug text, p_country text default 'Tunisie',
  p_commission_kind text default 'par_dossier', p_commission_amount numeric default 8
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_platform_admin() then raise exception 'réservé à la plateforme' using errcode='42501'; end if;
  if not slug_available(p_slug) then raise exception 'slug indisponible' using errcode='P0001'; end if;

  insert into agencies (slug, name, country, currency, services, plan,
                        commission_kind, commission_amount)
  values (lower(p_slug), p_name, p_country,
          case when p_country = 'Libye' then 'LYD' else 'TND' end,
          '{visas}', 'essai', p_commission_kind, p_commission_amount)
  returning id into v_id;

  -- Le catalogue de démarrage, comme à l'inscription : une agence vide décourage.
  perform seed_catalogue(v_id, '{visas}');
  return v_id;
end $$;

-- Éditer les termes de commission d'une agence.
create or replace function platform_set_commission(
  p_agency uuid, p_kind text, p_amount numeric
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'réservé à la plateforme' using errcode='42501'; end if;
  update agencies set commission_kind = p_kind, commission_amount = p_amount where id = p_agency;
end $$;

-- Générer les factures de la plateforme pour un mois : par agence, le nombre de
-- dossiers ouverts dans le mois, multiplié par la commission convenue. C'est la
-- rémunération du projet, calculée au lieu d'être devinée.
create or replace function platform_generate_invoices(p_period date default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_period date := coalesce(p_period, date_trunc('month', now())::date); n integer := 0; a record;
begin
  if not is_platform_admin() then raise exception 'réservé à la plateforme' using errcode='42501'; end if;

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
  return n;
end $$;

-- Lire les factures de la plateforme, pour la console.
create or replace function platform_invoices_list(p_period date default null)
returns table (agency text, slug text, period date, cases_billed integer, amount numeric, currency text, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'réservé à la plateforme' using errcode='42501'; end if;
  return query
  select ag.name, ag.slug, i.period, i.cases_billed, i.amount, i.currency, i.status
  from platform_invoices i join agencies ag on ag.id = i.agency_id
  where p_period is null or i.period = p_period
  order by i.period desc, i.amount desc;
end $$;

revoke all on function platform_create_agency(text,text,text,text,numeric) from public, anon;
revoke all on function platform_set_commission(uuid,text,numeric) from public, anon;
revoke all on function platform_generate_invoices(date) from public, anon;
revoke all on function platform_invoices_list(date) from public, anon;
grant execute on function platform_create_agency(text,text,text,text,numeric) to authenticated;
grant execute on function platform_set_commission(uuid,text,numeric) to authenticated;
grant execute on function platform_generate_invoices(date) to authenticated;
grant execute on function platform_invoices_list(date) to authenticated;
