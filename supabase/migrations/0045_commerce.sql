-- 0045 · Le cycle commercial : catalogue, devis, facture, dépense, marge.
--
-- Jusqu'ici l'argent n'existait qu'une fois encaissé. `payments` sait dire
-- « on a pris 300 dinars », jamais « on a vendu quoi, à quel prix, et
-- combien il en reste ». Une agence qui ne sait pas ce qu'elle a promis ne
-- sait pas non plus ce qu'on lui doit : le devis et la facture manquaient.
--
-- Trois règles portées par le modèle, parce que les tenir dans le navigateur
-- revient à ne pas les tenir du tout.
--   1. Les totaux sont calculés par le serveur. Une remise appliquée deux
--      fois côté écran ne se voit qu'au moment du contrôle.
--   2. Le solde d'une facture ne se saisit jamais : il descend des
--      règlements. Un solde saisi à la main ment tôt ou tard.
--   3. La marge se calcule, elle ne se stocke pas. Une marge figée devient
--      fausse à la première dépense ajoutée après coup.
--
-- Et une règle de contenu : AUCUN TARIF N'EST LIVRÉ. Le catalogue de départ
-- arrive avec treize services et treize prix à zéro. Aucun barème tunisien
-- n'est public : les honoraires d'agence ne sont publiés nulle part, les frais
-- consulaires changent par note de service, et les prix de transit se
-- négocient au dossier. Inventer un chiffre ici ferait facturer faux, tous les
-- jours, avec l'autorité d'un logiciel. L'agence saisit les siens.

-- ------------------------------------------------------------------
-- 1 · Deux nouvelles suites de références
-- ------------------------------------------------------------------
--
-- On réutilise le compteur existant plutôt que d'en poser un deuxième : c'est
-- lui qui garantit qu'une suite ne saute jamais et que deux agences ne
-- partagent pas un numéro. Il lui manquait seulement deux genres.

alter table reference_counters drop constraint if exists reference_counters_kind_check;
alter table reference_counters add constraint reference_counters_kind_check
  check (kind in ('case','shipment','request','receipt','quote','invoice'));

-- Le corps ne change pas, seuls deux préfixes s'ajoutent. La fonction reste
-- interdite à `authenticated` (voir 0022) : seuls les déclencheurs et les
-- fonctions definer de ce fichier l'appellent.
create or replace function next_reference(p_agency uuid, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare
  y int := extract(year from now())::int;
  n int;
  prefix text := case p_kind
    when 'case' then 'VF' when 'shipment' then 'EXP'
    when 'request' then 'DEM'
    when 'quote' then 'DEV' when 'invoice' then 'FAC'
    else 'REC' end;
begin
  insert into reference_counters (agency_id, kind, year, last)
  values (p_agency, p_kind, y, 1)
  on conflict (agency_id, kind, year)
    do update set last = reference_counters.last + 1
  returning last into n;
  return prefix || '-' || y || '-' || lpad(n::text, 4, '0');
end $$;

-- ------------------------------------------------------------------
-- 2 · Le catalogue de services
-- ------------------------------------------------------------------

create table if not exists services (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies on delete cascade,
  category      text not null default 'OTHER'
                check (category in ('VISA','CARGO','CUSTOMS','TRANSPORT','DOCUMENT','INSURANCE','OTHER')),
  -- Le nom est traduit comme le reste du catalogue métier : une agence de
  -- Sfax facture en français, sa cliente chinoise lit la même ligne en
  -- chinois. Le français fait foi, `tt()` retombe dessus.
  name          jsonb not null,
  description   text,
  -- Zéro, et jamais autre chose. Voir l'en-tête de ce fichier.
  default_price numeric(12,2) not null default 0 check (default_price >= 0),
  currency      char(3) not null default 'TND',
  -- 19 % est le taux normal de TVA en Tunisie depuis la loi de finances 2018.
  -- Il est modifiable ligne par ligne : les prestations à l'export sont
  -- exonérées, et une agence peut être hors champ.
  tax_rate      numeric(5,2) not null default 19 check (tax_rate >= 0 and tax_rate <= 100),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists services_agency on services (agency_id, category) where active;

comment on table services is
  'Le catalogue vendable de l''agence. Les prix arrivent à zéro : aucun barème tunisien n''est public, et un chiffre inventé ferait facturer faux tous les jours.';

-- Le catalogue de départ. Treize lignes, zéro dinar : ce que le produit
-- apporte, c'est la LISTE, pas le prix.
create or replace function seed_services(p_agency uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_currency char(3); n integer;
begin
  -- Sans jeton (clé de service, migration, tâche planifiée) on laisse passer.
  -- Avec un jeton, on ne sème que chez soi, et seulement si l'on gère les
  -- réglages.
  if auth_agency_id() is not null
     and (p_agency is distinct from auth_agency_id() or not auth_can('settings:manage')) then
    raise exception 'interdit' using errcode = '42501';
  end if;

  select currency into v_currency from agencies where id = p_agency;
  if v_currency is null then raise exception 'agence inconnue' using errcode = 'P0002'; end if;

  -- Idempotent : un deuxième appel ne double pas le catalogue.
  if exists (select 1 from services where agency_id = p_agency) then return 0; end if;

  insert into services (agency_id, category, name, default_price, currency, tax_rate)
  select p_agency, v.cat, v.label, 0, v_currency, 19
  from (values
    ('VISA',      '{"fr":"Assistance visa","en":"Visa assistance","ar":"مساعدة في التأشيرة","zh":"签证协助"}'::jsonb),
    ('VISA',      '{"fr":"Montage du dossier","en":"File preparation","ar":"إعداد الملف","zh":"材料整理"}'::jsonb),
    ('DOCUMENT',  '{"fr":"Traduction","en":"Translation","ar":"ترجمة","zh":"翻译"}'::jsonb),
    ('INSURANCE', '{"fr":"Assurance voyage","en":"Travel insurance","ar":"تأمين السفر","zh":"旅行保险"}'::jsonb),
    ('CUSTOMS',   '{"fr":"Dédouanement","en":"Customs clearance","ar":"التخليص الجمركي","zh":"清关"}'::jsonb),
    ('CUSTOMS',   '{"fr":"Transit","en":"Transit","ar":"العبور","zh":"过境"}'::jsonb),
    ('TRANSPORT', '{"fr":"Transport maritime","en":"Sea freight","ar":"النقل البحري","zh":"海运"}'::jsonb),
    ('TRANSPORT', '{"fr":"Transport aérien","en":"Air freight","ar":"النقل الجوي","zh":"空运"}'::jsonb),
    ('TRANSPORT', '{"fr":"Transport routier","en":"Road freight","ar":"النقل البري","zh":"陆运"}'::jsonb),
    ('CARGO',     '{"fr":"Stockage","en":"Storage","ar":"التخزين","zh":"仓储"}'::jsonb),
    ('CARGO',     '{"fr":"Livraison","en":"Delivery","ar":"التوصيل","zh":"配送"}'::jsonb),
    ('DOCUMENT',  '{"fr":"Certificat d''origine","en":"Certificate of origin","ar":"شهادة المنشأ","zh":"原产地证书"}'::jsonb),
    ('DOCUMENT',  '{"fr":"Gestion documentaire","en":"Document handling","ar":"إدارة الوثائق","zh":"单证管理"}'::jsonb)
  ) as v(cat, label);

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function seed_services(uuid) from public, anon;
grant execute on function seed_services(uuid) to authenticated;

-- ------------------------------------------------------------------
-- 3 · Les devis
-- ------------------------------------------------------------------

create table if not exists quotes (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  office_id   uuid references offices on delete set null,
  client_id   uuid references clients on delete set null,
  kind        text not null default 'visa' check (kind in ('visa','cargo','autre')),
  -- Posé par le déclencheur depuis le compteur de l'agence. Jamais par le
  -- navigateur : deux postes qui éditent en même temps donneraient le même.
  number      text not null,
  case_id     uuid references cases on delete set null,
  shipment_id uuid references shipments on delete set null,
  currency    char(3) not null default 'TND',
  subtotal    numeric(14,2) not null default 0,
  tax_total   numeric(14,2) not null default 0,
  -- Remise commerciale globale, exprimée hors taxe. Elle réduit donc aussi la
  -- base taxable : facturer la TVA sur un montant qu'on n'encaisse pas est une
  -- erreur qui se paie au contrôle.
  discount    numeric(14,2) not null default 0 check (discount >= 0),
  total       numeric(14,2) not null default 0,
  status      text not null default 'brouillon'
              check (status in ('brouillon','envoye','accepte','refuse','expire')),
  valid_until date,
  note        text,
  created_by  uuid references profiles on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  sent_at     timestamptz,
  decided_at  timestamptz,
  unique (agency_id, number)
);
create index if not exists quotes_agency_status on quotes (agency_id, status, created_at desc);
create index if not exists quotes_client on quotes (client_id);
create index if not exists quotes_case on quotes (case_id);

create table if not exists quote_items (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  quote_id    uuid not null references quotes on delete cascade,
  service_id  uuid references services on delete set null,
  description text,
  quantity    numeric(12,3) not null default 1 check (quantity > 0),
  unit_price  numeric(14,2) not null default 0,
  tax_rate    numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  discount    numeric(14,2) not null default 0 check (discount >= 0),
  -- Toutes taxes comprises, remise de ligne déduite. Colonne générée : le
  -- navigateur ne peut pas l'écrire, même en trichant sur la requête.
  line_total  numeric(14,2) generated always as (
                round(greatest(quantity * unit_price - discount, 0) * (1 + tax_rate / 100), 2)
              ) stored,
  line_no     integer not null default 0,
  created_at  timestamptz not null default now(),
  -- Retirer une ligne d'un devis déjà envoyé effacerait la trace de ce qu'on
  -- avait promis. On la range, on ne la détruit pas.
  deleted_at  timestamptz
);
create index if not exists quote_items_quote on quote_items (quote_id, line_no);

-- ------------------------------------------------------------------
-- 4 · Les factures
-- ------------------------------------------------------------------

create table if not exists invoices (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  office_id   uuid references offices on delete set null,
  client_id   uuid references clients on delete set null,
  number      text not null,
  quote_id    uuid references quotes on delete set null,
  case_id     uuid references cases on delete set null,
  shipment_id uuid references shipments on delete set null,
  issue_date  date not null default current_date,
  due_date    date,
  currency    char(3) not null default 'TND',
  subtotal    numeric(14,2) not null default 0,
  tax_total   numeric(14,2) not null default 0,
  discount    numeric(14,2) not null default 0 check (discount >= 0),
  total       numeric(14,2) not null default 0,
  -- Ces deux-là ne se saisissent pas : `invoice_totals` les redescend des
  -- règlements à chaque mouvement.
  paid_amount numeric(14,2) not null default 0,
  balance_due numeric(14,2) not null default 0,
  status      text not null default 'brouillon'
              check (status in ('brouillon','emise','partiellement_reglee','reglee','en_retard','annulee')),
  note        text,
  created_by  uuid references profiles on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (agency_id, number)
);
create index if not exists invoices_agency_status on invoices (agency_id, status, issue_date desc);
create index if not exists invoices_client on invoices (client_id);
create index if not exists invoices_case on invoices (case_id);
-- Un devis ne donne qu'une facture. La garde vit dans l'index, pas seulement
-- dans la fonction : une insertion directe passerait à côté de la fonction.
create unique index if not exists invoices_one_per_quote on invoices (quote_id) where quote_id is not null;

create table if not exists invoice_items (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  invoice_id  uuid not null references invoices on delete cascade,
  service_id  uuid references services on delete set null,
  description text,
  quantity    numeric(12,3) not null default 1 check (quantity > 0),
  unit_price  numeric(14,2) not null default 0,
  tax_rate    numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  discount    numeric(14,2) not null default 0 check (discount >= 0),
  line_total  numeric(14,2) generated always as (
                round(greatest(quantity * unit_price - discount, 0) * (1 + tax_rate / 100), 2)
              ) stored,
  line_no     integer not null default 0,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists invoice_items_invoice on invoice_items (invoice_id, line_no);

-- Un règlement s'impute à une facture. La colonne est ajoutée à la table
-- existante : c'est elle qui porte déjà la caisse, le reçu et le mode de
-- paiement, et en poser une deuxième ferait deux vérités sur le même argent.
alter table payments add column if not exists invoice_id uuid references invoices on delete set null;
create index if not exists payments_invoice on payments (invoice_id) where invoice_id is not null;

comment on column payments.invoice_id is
  'La facture à laquelle ce règlement s''impute. Le solde de la facture en descend, il ne se saisit jamais.';

-- ------------------------------------------------------------------
-- 5 · Les dépenses
-- ------------------------------------------------------------------

create table if not exists expenses (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  office_id      uuid references offices on delete set null,
  case_id        uuid references cases on delete cascade,
  shipment_id    uuid references shipments on delete cascade,
  category       text not null default 'autre'
                 check (category in ('consulat','transport','douane','sous_traitance',
                                     'fourniture','commission','loyer','salaire','autre')),
  supplier_name  text,
  amount         numeric(14,2) not null check (amount >= 0),
  currency       char(3) not null default 'TND',
  -- Le fret se paie en euros ou en dollars, la marge se lit en dinars. On
  -- garde le taux du jour de la dépense : le recalculer plus tard au cours
  -- courant réécrirait l'histoire.
  fx_rate        numeric(14,6) not null default 1 check (fx_rate > 0),
  amount_base    numeric(14,2) generated always as (round(amount * fx_rate, 2)) stored,
  payment_method text check (payment_method in ('especes','virement','carte','cheque','compensation')),
  receipt_path   text,
  spent_on       date not null default current_date,
  note           text,
  created_by     uuid references profiles on delete set null,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists expenses_agency on expenses (agency_id, spent_on desc) where deleted_at is null;
create index if not exists expenses_case on expenses (case_id) where deleted_at is null;
create index if not exists expenses_shipment on expenses (shipment_id) where deleted_at is null;

comment on table expenses is
  'Ce que le dossier ou la cargaison a coûté. Sans elle, la marge affichée serait le chiffre d''affaires, et un patron qui le découvre une fois ne rouvre plus l''écran.';

-- ------------------------------------------------------------------
-- 6 · Les numéros, posés par le serveur
-- ------------------------------------------------------------------

create or replace function commerce_set_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.number is null or btrim(new.number) = '' then
    new.number := next_reference(new.agency_id, tg_argv[0]);
  end if;
  return new;
end $$;

drop trigger if exists quotes_number on quotes;
create trigger quotes_number before insert on quotes
  for each row execute function commerce_set_number('quote');

drop trigger if exists invoices_number on invoices;
create trigger invoices_number before insert on invoices
  for each row execute function commerce_set_number('invoice');

-- ------------------------------------------------------------------
-- 7 · Les totaux, calculés par le serveur
-- ------------------------------------------------------------------
--
-- La remise globale est hors taxe. On la retranche de la base, puis on réduit
-- la TVA dans la même proportion. Faire l'inverse (remise sur le TTC) ferait
-- déclarer une TVA collectée supérieure à celle réellement encaissée.

create or replace function quote_totals(p_quote uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ht numeric := 0; v_tax numeric := 0;
  v_disc numeric; v_ratio numeric; v_sub numeric; v_taxt numeric;
begin
  select coalesce(sum(greatest(quantity * unit_price - discount, 0)), 0),
         coalesce(sum(greatest(quantity * unit_price - discount, 0) * tax_rate / 100), 0)
    into v_ht, v_tax
    from quote_items where quote_id = p_quote and deleted_at is null;

  select least(discount, v_ht) into v_disc from quotes where id = p_quote;
  if v_disc is null then return; end if;

  v_ratio := case when v_ht > 0 then (v_ht - v_disc) / v_ht else 0 end;
  v_sub  := round(v_ht - v_disc, 2);
  v_taxt := round(v_tax * v_ratio, 2);

  update quotes
     set subtotal = v_sub, tax_total = v_taxt, total = v_sub + v_taxt, updated_at = now()
   where id = p_quote;
end $$;

revoke all on function quote_totals(uuid) from public, anon;
grant execute on function quote_totals(uuid) to authenticated;

create or replace function invoice_totals(p_invoice uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  inv invoices;
  v_ht numeric := 0; v_tax numeric := 0;
  v_disc numeric; v_ratio numeric; v_sub numeric; v_taxt numeric; v_total numeric;
  v_paid numeric := 0; v_balance numeric; v_status text;
begin
  select * into inv from invoices where id = p_invoice;
  if inv.id is null then return; end if;

  select coalesce(sum(greatest(quantity * unit_price - discount, 0)), 0),
         coalesce(sum(greatest(quantity * unit_price - discount, 0) * tax_rate / 100), 0)
    into v_ht, v_tax
    from invoice_items where invoice_id = p_invoice and deleted_at is null;

  v_disc  := least(inv.discount, v_ht);
  v_ratio := case when v_ht > 0 then (v_ht - v_disc) / v_ht else 0 end;
  v_sub   := round(v_ht - v_disc, 2);
  v_taxt  := round(v_tax * v_ratio, 2);
  v_total := v_sub + v_taxt;

  -- L'encaissé descend des règlements réglés, jamais d'une saisie.
  select coalesce(sum(amount), 0) into v_paid
    from payments where invoice_id = p_invoice and state = 'regle';

  v_balance := round(v_total - v_paid, 2);

  -- Un brouillon et une facture annulée gardent leur état : le premier n'est
  -- pas encore une créance, la seconde n'en est plus une.
  v_status := inv.status;
  if v_status not in ('brouillon','annulee') then
    if v_total > 0 and v_balance <= 0 then
      v_status := 'reglee';
    elsif inv.due_date is not null and inv.due_date < current_date then
      v_status := 'en_retard';
    elsif v_paid > 0 then
      v_status := 'partiellement_reglee';
    else
      v_status := 'emise';
    end if;
  end if;

  update invoices
     set subtotal = v_sub, tax_total = v_taxt, total = v_total,
         paid_amount = v_paid, balance_due = v_balance,
         status = v_status, updated_at = now()
   where id = p_invoice;
end $$;

revoke all on function invoice_totals(uuid) from public, anon;
grant execute on function invoice_totals(uuid) to authenticated;

-- Les déclencheurs. Toute écriture sur une ligne relance le total du document,
-- pour que rien ne dépende d'un appel que l'écran aurait oublié de faire.

create or replace function quote_items_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform quote_totals(coalesce(new.quote_id, old.quote_id));
  return null;
end $$;

drop trigger if exists quote_items_totals on quote_items;
create trigger quote_items_totals after insert or update or delete on quote_items
  for each row execute function quote_items_touch();

create or replace function invoice_items_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform invoice_totals(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;

drop trigger if exists invoice_items_totals on invoice_items;
create trigger invoice_items_totals after insert or update or delete on invoice_items
  for each row execute function invoice_items_touch();

-- Changer la remise globale change le total. Le recalcul qui suit ne touche
-- pas à `discount` : la clause WHEN ne se déclenche donc pas une deuxième
-- fois, et il n'y a pas de récursion.
create or replace function quote_discount_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform quote_totals(new.id);
  return null;
end $$;

drop trigger if exists quotes_discount on quotes;
create trigger quotes_discount after update on quotes
  for each row when (new.discount is distinct from old.discount)
  execute function quote_discount_touch();

create or replace function invoice_discount_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform invoice_totals(new.id);
  return null;
end $$;

drop trigger if exists invoices_discount on invoices;
create trigger invoices_discount after update on invoices
  for each row when (new.discount is distinct from old.discount)
  execute function invoice_discount_touch();

-- Un règlement imputé à une facture doit être de la même agence et dans la
-- même devise, sinon le solde additionne des dinars et des euros.
create or replace function payment_invoice_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  if new.invoice_id is null then return new; end if;
  select * into inv from invoices where id = new.invoice_id;
  if inv.id is null then
    raise exception 'facture inconnue' using errcode = 'P0002';
  end if;
  if inv.agency_id is distinct from new.agency_id then
    raise exception 'facture d''une autre agence' using errcode = '42501';
  end if;
  if inv.currency is distinct from new.currency then
    raise exception 'le règlement doit être dans la devise de la facture' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists payments_invoice_guard on payments;
create trigger payments_invoice_guard before insert or update of invoice_id, amount, currency, agency_id on payments
  for each row execute function payment_invoice_guard();

create or replace function payment_invoice_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Un règlement déplacé d'une facture à l'autre en laisse deux à corriger.
  if tg_op <> 'INSERT' and old.invoice_id is not null then
    perform invoice_totals(old.invoice_id);
  end if;
  if tg_op <> 'DELETE' and new.invoice_id is not null then
    perform invoice_totals(new.invoice_id);
  end if;
  return null;
end $$;

drop trigger if exists payments_invoice_totals on payments;
create trigger payments_invoice_totals after insert or update or delete on payments
  for each row execute function payment_invoice_touch();

-- ------------------------------------------------------------------
-- 8 · Du devis à la facture
-- ------------------------------------------------------------------

create or replace function quote_to_invoice(p_quote uuid, p_due_days integer default 30)
returns uuid
language plpgsql security definer set search_path = public as $$
declare a uuid := auth_agency_id(); q quotes; v_id uuid;
begin
  if a is null or not auth_can('payment:write') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;

  select * into q from quotes where id = p_quote and agency_id = a;
  if q.id is null then raise exception 'devis inconnu' using errcode = 'P0002'; end if;
  if q.status <> 'accepte' then
    raise exception 'seul un devis accepté se convertit' using errcode = 'P0001';
  end if;
  if exists (select 1 from invoices where quote_id = p_quote) then
    raise exception 'devis déjà converti' using errcode = 'P0001';
  end if;

  insert into invoices (agency_id, office_id, client_id, number, quote_id, case_id, shipment_id,
                        issue_date, due_date, currency, discount, status, note, created_by)
  values (q.agency_id, q.office_id, q.client_id, null, q.id, q.case_id, q.shipment_id,
          current_date, current_date + coalesce(p_due_days, 30), q.currency, q.discount,
          'emise', q.note, auth.uid())
  returning id into v_id;

  insert into invoice_items (agency_id, invoice_id, service_id, description,
                             quantity, unit_price, tax_rate, discount, line_no)
  select q.agency_id, v_id, i.service_id, i.description,
         i.quantity, i.unit_price, i.tax_rate, i.discount, i.line_no
    from quote_items i
   where i.quote_id = q.id and i.deleted_at is null
   order by i.line_no, i.created_at;

  perform invoice_totals(v_id);
  return v_id;
end $$;

revoke all on function quote_to_invoice(uuid, integer) from public, anon;
grant execute on function quote_to_invoice(uuid, integer) to authenticated;

-- ------------------------------------------------------------------
-- 9 · La marge
-- ------------------------------------------------------------------
--
-- Le revenu retenu est le HORS TAXE. La TVA n'est pas du chiffre d'affaires :
-- l'agence la collecte pour l'État et la reverse, exactement comme les frais
-- de consulat (voir 0005). La compter dans la marge la gonflerait de 19 %.

create or replace function commerce_margin(p_billed numeric, p_collected numeric,
                                           p_spent numeric, p_currency char(3))
returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'billed', p_billed, 'collected', p_collected, 'expenses', p_spent,
    'margin', p_billed - p_spent,
    'margin_pct', case when p_billed > 0 then round((p_billed - p_spent) * 100 / p_billed, 2) end,
    'currency', p_currency)
$$;

revoke all on function commerce_margin(numeric, numeric, numeric, char) from public, anon;
grant execute on function commerce_margin(numeric, numeric, numeric, char) to authenticated;

create or replace function case_margin(p_case uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a uuid := auth_agency_id(); v_cur char(3);
  v_billed numeric; v_paid numeric; v_spent numeric;
begin
  if a is null or not auth_can('finance:global') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  select currency into v_cur from agencies where id = a;
  if not exists (select 1 from cases where id = p_case and agency_id = a) then
    raise exception 'dossier inconnu' using errcode = 'P0002';
  end if;

  select coalesce(sum(subtotal), 0), coalesce(sum(paid_amount), 0)
    into v_billed, v_paid
    from invoices where case_id = p_case and status <> 'annulee';
  select coalesce(sum(amount_base), 0) into v_spent
    from expenses where case_id = p_case and deleted_at is null;

  return commerce_margin(v_billed, v_paid, v_spent, v_cur);
end $$;

revoke all on function case_margin(uuid) from public, anon;
grant execute on function case_margin(uuid) to authenticated;

create or replace function shipment_margin(p_shipment uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a uuid := auth_agency_id(); v_cur char(3);
  v_billed numeric; v_paid numeric; v_spent numeric;
begin
  if a is null or not auth_can('finance:global') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  select currency into v_cur from agencies where id = a;
  if not exists (select 1 from shipments where id = p_shipment and agency_id = a) then
    raise exception 'cargaison inconnue' using errcode = 'P0002';
  end if;

  select coalesce(sum(subtotal), 0), coalesce(sum(paid_amount), 0)
    into v_billed, v_paid
    from invoices where shipment_id = p_shipment and status <> 'annulee';
  select coalesce(sum(amount_base), 0) into v_spent
    from expenses where shipment_id = p_shipment and deleted_at is null;

  return commerce_margin(v_billed, v_paid, v_spent, v_cur);
end $$;

revoke all on function shipment_margin(uuid) from public, anon;
grant execute on function shipment_margin(uuid) to authenticated;

-- Le tableau d'ensemble : un bureau, ou toute l'agence quand p_office est nul.
create or replace function agency_finance_summary(
  p_office uuid default null, p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a uuid := auth_agency_id(); v_cur char(3);
  d1 date := coalesce(p_from, current_date - 365);
  d2 date := coalesce(p_to, current_date);
  v_billed numeric; v_paid numeric; v_unpaid numeric; v_spent numeric;
begin
  if a is null or not auth_can('finance:global') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  -- Un responsable de bureau ne regarde pas les chiffres d'un autre bureau.
  if not auth_sees_office(p_office) then
    raise exception 'bureau hors périmètre' using errcode = '42501';
  end if;
  select currency into v_cur from agencies where id = a;

  select coalesce(sum(subtotal), 0), coalesce(sum(paid_amount), 0),
         coalesce(sum(balance_due) filter (where status in ('emise','partiellement_reglee','en_retard')), 0)
    into v_billed, v_paid, v_unpaid
    from invoices
   where agency_id = a and status <> 'annulee'
     and issue_date between d1 and d2
     and (p_office is null or office_id = p_office);

  select coalesce(sum(amount_base), 0) into v_spent
    from expenses
   where agency_id = a and deleted_at is null
     and spent_on between d1 and d2
     and (p_office is null or office_id = p_office);

  return commerce_margin(v_billed, v_paid, v_spent, v_cur)
      || jsonb_build_object('unpaid', v_unpaid, 'from', d1, 'to', d2);
end $$;

revoke all on function agency_finance_summary(uuid, date, date) from public, anon;
grant execute on function agency_finance_summary(uuid, date, date) to authenticated;

-- ------------------------------------------------------------------
-- 10 · Le cloisonnement
-- ------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['services','quotes','quote_items','invoices','invoice_items','expenses'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

drop policy if exists services_select on services;
drop policy if exists services_insert on services;
drop policy if exists services_update on services;
drop policy if exists services_platform_read on services;

create policy services_select on services for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('case:read'));
create policy services_insert on services for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('settings:manage'));
create policy services_update on services for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('settings:manage'))
  with check (agency_id = auth_agency_id());
create policy services_platform_read on services for select to authenticated
  using (is_platform_admin());

drop policy if exists quotes_select on quotes;
drop policy if exists quotes_insert on quotes;
drop policy if exists quotes_update on quotes;
drop policy if exists quotes_platform_read on quotes;

create policy quotes_select on quotes for select to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('case:read'));
create policy quotes_insert on quotes for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('payment:write'));
create policy quotes_update on quotes for update to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('payment:write'))
  with check (agency_id = auth_agency_id());
create policy quotes_platform_read on quotes for select to authenticated
  using (is_platform_admin());

-- Les lignes suivent leur document, sans jamais élargir le périmètre.
drop policy if exists quote_items_select on quote_items;
drop policy if exists quote_items_insert on quote_items;
drop policy if exists quote_items_update on quote_items;
drop policy if exists quote_items_platform_read on quote_items;

create policy quote_items_select on quote_items for select to authenticated
  using (exists (select 1 from quotes q where q.id = quote_id
                 and q.agency_id = auth_agency_id() and auth_sees_office(q.office_id)));
create policy quote_items_insert on quote_items for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('payment:write')
              and exists (select 1 from quotes q where q.id = quote_id and q.agency_id = auth_agency_id()));
create policy quote_items_update on quote_items for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('payment:write'))
  with check (agency_id = auth_agency_id());
create policy quote_items_platform_read on quote_items for select to authenticated
  using (is_platform_admin());

drop policy if exists invoices_select on invoices;
drop policy if exists invoices_insert on invoices;
drop policy if exists invoices_update on invoices;
drop policy if exists invoices_platform_read on invoices;

create policy invoices_select on invoices for select to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('case:read'));
create policy invoices_insert on invoices for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('payment:write'));
create policy invoices_update on invoices for update to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('payment:write'))
  with check (agency_id = auth_agency_id());
create policy invoices_platform_read on invoices for select to authenticated
  using (is_platform_admin());

drop policy if exists invoice_items_select on invoice_items;
drop policy if exists invoice_items_insert on invoice_items;
drop policy if exists invoice_items_update on invoice_items;
drop policy if exists invoice_items_platform_read on invoice_items;

create policy invoice_items_select on invoice_items for select to authenticated
  using (exists (select 1 from invoices f where f.id = invoice_id
                 and f.agency_id = auth_agency_id() and auth_sees_office(f.office_id)));
create policy invoice_items_insert on invoice_items for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('payment:write')
              and exists (select 1 from invoices f where f.id = invoice_id and f.agency_id = auth_agency_id()));
create policy invoice_items_update on invoice_items for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('payment:write'))
  with check (agency_id = auth_agency_id());
create policy invoice_items_platform_read on invoice_items for select to authenticated
  using (is_platform_admin());

-- La dépense est un chiffre de coût : elle donne la marge par soustraction.
-- Elle rejoint donc la règle « direction seulement » de shipment_finance et de
-- revenue_lines. L'agent qui encaisse peut en SAISIR une (payment:write), il
-- ne lit pas le coût de revient de l'agence.
drop policy if exists expenses_select on expenses;
drop policy if exists expenses_insert on expenses;
drop policy if exists expenses_update on expenses;

create policy expenses_select on expenses for select to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('finance:global'));
create policy expenses_insert on expenses for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('payment:write'));
create policy expenses_update on expenses for update to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('finance:global'))
  with check (agency_id = auth_agency_id());
-- Aucune lecture plateforme sur les dépenses : le support regarde un dossier,
-- pas le coût de revient d'une agence cliente. Même principe qu'en 0028.

-- ------------------------------------------------------------------
-- 11 · Les droits
-- ------------------------------------------------------------------
--
-- 0015 a posé un `alter default privileges` qui accorde aussi DELETE aux
-- tables créées ensuite. Ce module n'efface rien en dur : on reprend ce droit
-- table par table, sinon la règle ne tiendrait que dans les politiques.

do $$
declare t text;
begin
  foreach t in array array['services','quotes','quote_items','invoices','invoice_items','expenses'] loop
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update on %I to authenticated', t);
    execute format('revoke delete, truncate on %I from authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

-- Les fonctions de déclencheur. PostgreSQL accorde EXECUTE à PUBLIC par
-- défaut : sans cette reprise, chacune serait appelable par un anonyme avec
-- l'enregistrement de son choix. Un déclencheur n'exige pas EXECUTE de celui
-- qui provoque l'écriture, on ne rend donc le droit à personne.
do $$
declare f text;
begin
  foreach f in array array[
    'commerce_set_number()',
    'quote_items_touch()',
    'invoice_items_touch()',
    'quote_discount_touch()',
    'invoice_discount_touch()',
    'payment_invoice_guard()',
    'payment_invoice_touch()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
