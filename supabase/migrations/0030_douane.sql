-- 0030 · La douane : valeur en douane, cascade fiscale, origine, délais.
--
-- Contrairement aux tarifs de magasinage, cette partie est officielle, stable
-- et entièrement documentée. Elle se code telle quelle, et elle DOIT être
-- codée : c'est le calcul que l'agence refait à la main sur un coin de table,
-- et où elle se trompe.
--
-- LES TROIS PIÈGES, qui font que le calcul « évident » est faux :
--
--   1. Le droit de consommation ENTRE dans l'assiette de la TVA. On calcule
--      donc la TVA sur un montant qui contient déjà du droit de consommation.
--   2. La majoration de 25 % frappe le NON-ASSUJETTI (lettre M). Un importateur
--      non assujetti paie la TVA sur une base majorée d'un quart.
--   3. Le minimum de RPD de 10 DT est PAR ARTICLE de déclaration, pas par
--      déclaration. Une déclaration à 12 articles a un plancher de 120 DT.
--
-- Base légale : articles 22 à 35 du code des douanes (loi 2008-34) pour la
-- valeur, article 33 pour le taux de change du jour d'enregistrement.

-- ------------------------------------------------------------------
-- 1 · L'origine, et l'absence d'accord avec la Chine
-- ------------------------------------------------------------------
--
-- La liste officielle des partenaires ouvrant droit à un certificat d'origine
-- PRÉFÉRENTIEL ne contient pas la Chine. Une marchandise chinoise est donc au
-- NPF plein. Le certificat d'origine chinois reste exigé au dossier (case 32),
-- mais il ne donne AUCUN avantage tarifaire. Confondre les deux fait réclamer
-- un taux préférentiel auquel on n'a pas droit, et le redressement suit.

create or replace function origin_preferential_allowed(p_country char(2))
returns boolean
language sql immutable
set search_path = public
as $$
  select p_country is not null and upper(p_country) in (
    -- Accords bilatéraux nommément listés par la douane tunisienne.
    'MA','JO','EG','LY','KW','DZ','MR','PS','SY','SD','IR',
    -- Zone Pan-Euro-Méditerranéenne (noyau : Union européenne, AELE, Turquie).
    'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU','IE',
    'IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK',
    'CH','NO','IS','LI','TR',
    -- Grande Zone Arabe de Libre Échange, membres non déjà cités.
    'SA','AE','QA','BH','OM','IQ','YE','LB'
  )
$$;

comment on function origin_preferential_allowed(char) is
  'Vrai si le pays ouvre droit à un régime tarifaire préférentiel. La CHINE n''y figure pas : NPF plein, aucun taux préférentiel, et les codes 404 et 971 de la case 42/2 doivent être refusés.';

-- La nomenclature de dédouanement des produits, portée en case 39 :
-- 6 caractères SH, 2 caractères de nomenclature combinée européenne,
-- 1 caractère de tarif national, 1 caractère NGP, plus une clé de contrôle.
create or replace function ndp_valid(p_ndp text)
returns boolean
language sql immutable
set search_path = public
as $$
  select p_ndp is null or p_ndp ~ '^[0-9]{10}[0-9A-Za-z]?$'
$$;

-- ------------------------------------------------------------------
-- 2 · La déclaration et ses articles
-- ------------------------------------------------------------------

create table if not exists customs_declarations (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies on delete cascade,
  shipment_id   uuid not null references shipments on delete cascade,
  -- En groupage, chaque lot a SA déclaration : le conteneur est indivisible
  -- physiquement, pas douanièrement.
  lot_id        uuid references shipment_lots on delete cascade,
  number        text,
  regime        text,
  -- Le commissionnaire en douane agréé : il exerce à titre personnel, sur des
  -- bureaux nommément désignés, sous un code de 7 chiffres plus une lettre.
  broker_name   text,
  broker_code   text check (broker_code is null or broker_code ~ '^[0-9]{7}[A-Za-z]$'),
  office        text,
  -- Article 33 : la valeur est convertie au taux du jour d'ENREGISTREMENT de
  -- la déclaration. Pas au taux de la facture, pas au taux du jour du calcul.
  registered_on date,
  fx_rate       numeric(14,6) not null default 1 check (fx_rate > 0),
  currency      char(3) not null default 'USD',
  -- La lettre M : le non-assujetti subit la majoration de 25 % de l'assiette TVA.
  vat_registered boolean not null default true,
  -- Le code 480 déclenche l'avance sur impôt de 10 %.
  air_applicable boolean not null default false,
  circuit       text check (circuit is null or circuit in ('vert','orange','rouge')),
  status        text not null default 'brouillon'
                check (status in ('brouillon','deposee','enregistree','liquidee','payee','annulee')),
  note          text,
  created_at    timestamptz not null default now(),
  unique (agency_id, number)
);
create index if not exists customs_declarations_ship on customs_declarations (shipment_id);

comment on column customs_declarations.fx_rate is
  'Taux de change du jour d''enregistrement de la déclaration (article 33 du code des douanes). Figé à l''enregistrement : le recalculer au taux du jour fausserait la liquidation.';

create table if not exists customs_articles (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  declaration_id uuid not null references customs_declarations on delete cascade,
  line_no        int  not null check (line_no > 0),
  ndp            text check (ndp_valid(ndp)),
  designation    text not null,
  -- Case 32 : l'origine. C'est elle qui commande le régime tarifaire.
  origin_country char(2),
  -- Case 42/2 : le code de régime préférentiel. 404 et 971 sont interdits
  -- lorsque l'origine n'ouvre pas droit au préférentiel.
  preferential_code text,
  quantity       numeric(14,3),
  invoice_value  numeric(14,2) not null default 0,
  -- Titre CCEC : L = libre, P = exclu du régime de liberté, donc autorisation
  -- d'importation obligatoire avant toute chose.
  ccec_title     char(1) check (ccec_title is null or ccec_title in ('L','P')),
  mp5            boolean not null default false,

  -- Article 30 : ce qui S'AJOUTE, liste limitative.
  --   [{"code":"transport_assurance_jusqu_introduction","amount":1250}]
  additions      jsonb not null default '[]'::jsonb,
  -- Article 31 : ce qui SE RETRANCHE, liste limitative, et seulement si
  -- l'élément est FACTURÉ DISTINCTEMENT.
  --   [{"code":"commissions_achat","amount":300,"invoiced_separately":true}]
  deductions     jsonb not null default '[]'::jsonb,

  -- Les taux ne sont pas livrés : ils dépendent de la position tarifaire, et
  -- le taux de FODEC par position n'a pas été trouvé en source officielle.
  -- Exprimés en pourcentage (19 pour 19 %).
  dd_rate        numeric(6,3),
  dc_rate        numeric(6,3),
  fodec_rate     numeric(6,3),
  tva_rate       numeric(6,3),
  -- Taxes de la série 0xx : elles entrent dans l'assiette de la TVA.
  taxes_0xx      jsonb not null default '[]'::jsonb,
  -- Taxes sectorielles : elles entrent dans la somme des droits, PAS dans
  -- l'assiette de la TVA. Les confondre gonfle la TVA.
  taxes_sector   jsonb not null default '[]'::jsonb,
  unique (declaration_id, line_no)
);
create index if not exists customs_articles_decl on customs_articles (declaration_id, line_no);

-- La règle d'origine, tenue par la base plutôt que par la bonne volonté :
-- un code préférentiel sur une origine non préférentielle est refusé.
create or replace function customs_article_origin_ok(p_origin char(2), p_code text)
returns boolean
language sql immutable
set search_path = public
as $$
  select p_code is null
      or (p_code not in ('404','971'))
      or origin_preferential_allowed(p_origin)
$$;

alter table customs_articles drop constraint if exists customs_articles_origin_check;
alter table customs_articles add constraint customs_articles_origin_check
  check (customs_article_origin_ok(origin_country, preferential_code)) not valid;

comment on constraint customs_articles_origin_check on customs_articles is
  'Les codes 404 et 971 de la case 42/2 sont refusés si l''origine n''ouvre pas droit au préférentiel. Une marchandise chinoise est au NPF plein : la Chine ne figure dans aucun accord.';

-- ------------------------------------------------------------------
-- 3 · La cascade fiscale
-- ------------------------------------------------------------------
--
--   VD_CAF   = prix facture + ajustements art.30 - déductions art.31
--              converti au taux du jour d'enregistrement
--   DD       = VD_CAF x taux                              [assiette A]
--   DC       = VD_CAF x taux                              [assiette A]
--   FODEC    = VD_CAF x taux                              [assiette A]
--   base_TVA = VD_CAF + DD + DC + FODEC + taxes 0xx       [assiette B]
--              si NON assujetti -> x 1,25
--   TVA      = base_TVA x taux
--   somme_dt = DD + DC + FODEC + TVA + taxes sectorielles
--   RPD      = max(somme_dt x 3% ; 10 DT x NOMBRE D'ARTICLES)  [assiette Y]
--   total_dt = somme_dt + RPD
--   AIR      = (VD_CAF + total_dt) x 10%   si code 480    [assiette O]

create or replace function customs_compute(p_declaration uuid)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  d            customs_declarations;
  a            customs_articles;
  lignes       jsonb := '[]'::jsonb;
  alertes      jsonb := '[]'::jsonb;
  n_articles   int   := 0;
  som_vd       numeric := 0;
  som_dt       numeric := 0;
  -- Par article
  add_tot      numeric;
  ded_tot      numeric;
  ded_refusee  numeric;
  vd_devise    numeric;
  vd_caf       numeric;
  dd           numeric;
  dc           numeric;
  fodec        numeric;
  t0xx         numeric;
  tsect        numeric;
  base_tva     numeric;
  tva          numeric;
  dt_article   numeric;
  -- Au niveau déclaration
  rpd          numeric;
  rpd_plancher numeric;
  total_dt     numeric;
  air          numeric := 0;
begin
  select * into d from customs_declarations where id = p_declaration;
  if not found then return null; end if;

  for a in select * from customs_articles where declaration_id = p_declaration order by line_no loop
    n_articles := n_articles + 1;

    -- Article 30 : tout s'ajoute, sans condition de facturation distincte.
    select coalesce(sum((e->>'amount')::numeric), 0) into add_tot
    from jsonb_array_elements(a.additions) e;

    -- Article 31 : ne se retranche QUE ce qui est facturé distinctement.
    -- C'est la règle absolue, et c'est celle qu'on oublie.
    select coalesce(sum((e->>'amount')::numeric), 0) into ded_tot
    from jsonb_array_elements(a.deductions) e
    where coalesce((e->>'invoiced_separately')::boolean, false);

    select coalesce(sum((e->>'amount')::numeric), 0) into ded_refusee
    from jsonb_array_elements(a.deductions) e
    where not coalesce((e->>'invoiced_separately')::boolean, false);

    if ded_refusee > 0 then
      alertes := alertes || jsonb_build_object(
        'ligne', a.line_no, 'code', 'deduction_non_facturee_distinctement',
        'montant_refuse', ded_refusee);
    end if;

    vd_devise := a.invoice_value + add_tot - ded_tot;
    -- Article 33 : conversion au taux du jour d'enregistrement.
    vd_caf    := round(vd_devise * d.fx_rate, 3);

    if a.dd_rate is null or a.tva_rate is null then
      alertes := alertes || jsonb_build_object(
        'ligne', a.line_no, 'code', 'taux_manquant',
        'dd', a.dd_rate is null, 'tva', a.tva_rate is null);
    end if;
    if a.ccec_title = 'P' then
      alertes := alertes || jsonb_build_object(
        'ligne', a.line_no, 'code', 'autorisation_importation_requise');
    end if;

    dd    := round(vd_caf * coalesce(a.dd_rate, 0)    / 100, 3);
    dc    := round(vd_caf * coalesce(a.dc_rate, 0)    / 100, 3);
    fodec := round(vd_caf * coalesce(a.fodec_rate, 0) / 100, 3);

    select coalesce(sum((e->>'amount')::numeric), 0) into t0xx
    from jsonb_array_elements(a.taxes_0xx) e;
    select coalesce(sum((e->>'amount')::numeric), 0) into tsect
    from jsonb_array_elements(a.taxes_sector) e;

    -- PIÈGE 1 : le droit de consommation entre dans l'assiette de la TVA.
    base_tva := vd_caf + dd + dc + fodec + t0xx;
    -- PIÈGE 2 : le non-assujetti subit la majoration de 25 %.
    if not d.vat_registered then
      base_tva := base_tva * 1.25;
    end if;
    tva := round(base_tva * coalesce(a.tva_rate, 0) / 100, 3);

    dt_article := dd + dc + fodec + tva + tsect;
    som_vd := som_vd + vd_caf;
    som_dt := som_dt + dt_article;

    lignes := lignes || jsonb_build_object(
      'ligne', a.line_no, 'ndp', a.ndp, 'designation', a.designation,
      'origine', a.origin_country,
      'valeur_facture', a.invoice_value,
      'ajustements_art30', add_tot,
      'deductions_art31_retenues', ded_tot,
      'deductions_art31_refusees', ded_refusee,
      'vd_devise', round(vd_devise, 3),
      'vd_caf', vd_caf,
      'dd', dd, 'dc', dc, 'fodec', fodec,
      'taxes_0xx', t0xx, 'taxes_sectorielles', tsect,
      'base_tva', round(base_tva, 3),
      'majoration_non_assujetti', not d.vat_registered,
      'tva', tva,
      'somme_dt_ligne', round(dt_article, 3));
  end loop;

  if n_articles = 0 then
    return jsonb_build_object('articles', 0, 'lignes', '[]'::jsonb,
                              'alertes', alertes, 'total', 0);
  end if;

  -- PIÈGE 3 : le plancher de RPD est de 10 DT PAR ARTICLE, pas par déclaration.
  rpd_plancher := 10 * n_articles;
  rpd := greatest(round(som_dt * 0.03, 3), rpd_plancher);
  total_dt := som_dt + rpd;

  if d.air_applicable then
    air := round((som_vd + total_dt) * 0.10, 3);
  end if;

  return jsonb_build_object(
    'declaration', d.number,
    'devise', d.currency,
    'taux_du_jour', d.fx_rate,
    'assujetti', d.vat_registered,
    'articles', n_articles,
    'lignes', lignes,
    'vd_caf_total', round(som_vd, 3),
    'somme_dt', round(som_dt, 3),
    'rpd', rpd,
    'rpd_plancher', rpd_plancher,
    'rpd_au_plancher', (rpd = rpd_plancher and rpd_plancher > round(som_dt * 0.03, 3)),
    'total_dt', round(total_dt, 3),
    'air', air,
    'total_a_payer', round(total_dt + air, 3),
    'alertes', alertes);
end $$;

comment on function customs_compute(uuid) is
  'La cascade fiscale complète, articles 22 à 35 du code des douanes. Trois pièges tenus : le droit de consommation dans l''assiette TVA, la majoration de 25 % du non-assujetti, et le plancher de RPD de 10 DT PAR ARTICLE.';

-- ------------------------------------------------------------------
-- 4 · Le titre de commerce extérieur, et sa règle des 10 %
-- ------------------------------------------------------------------
--
-- Sans TCE domicilié : pas de dédouanement, et surtout PAS DE TRANSFERT DE
-- DEVISES. La loi interdit la sortie de devises en paiement d'importations
-- avant présentation à la banque des documents confirmant l'expédition. Le
-- connaissement n'est donc pas une pièce logistique : c'est la clé du virement
-- au fournisseur. Un retard de transitaire est un retard de paiement.

create table if not exists tce_titles (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies on delete cascade,
  shipment_id   uuid references shipments on delete cascade,
  lot_id        uuid references shipment_lots on delete cascade,
  -- Les cinq formes du titre.
  form          text not null check (form in (
                  'autorisation_importation','facture_commerciale',
                  'admission_temporaire','facture_definitive_export',
                  'autorisation_exportation')),
  number        text,
  bank          text,
  domiciled_on  date,
  designation   text,
  amount        numeric(14,2),
  currency      char(3) default 'USD',
  quantity      numeric(14,3),
  -- Le titre est fractionnable : plusieurs expéditions sous un même titre.
  divisible     boolean not null default true,
  status        text not null default 'a_domicilier'
                check (status in ('a_domicilier','domicilie','imputé','annule')),
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists tce_titles_ship on tce_titles (shipment_id);

-- Il faut MODIFIER le titre si la désignation change, ou si le prix ou la
-- quantité augmente de plus de 10 %. Au-delà, nouveau titre et annulation de
-- l'ancien. Se tromper ici bloque le virement au fournisseur.
create or replace function tce_needs_amendment(
  p_title uuid, p_new_designation text, p_new_amount numeric, p_new_quantity numeric
) returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  t              tce_titles;
  ecart_montant  numeric := 0;
  ecart_quantite numeric := 0;
  motifs         jsonb := '[]'::jsonb;
begin
  select * into t from tce_titles where id = p_title;
  if not found then return null; end if;

  if p_new_designation is not null and t.designation is not null
     and p_new_designation <> t.designation then
    motifs := motifs || to_jsonb('designation_modifiee'::text);
  end if;

  if p_new_amount is not null and coalesce(t.amount, 0) > 0 then
    ecart_montant := (p_new_amount - t.amount) / t.amount * 100;
    -- Seule la HAUSSE compte : une baisse n'appelle pas de modification.
    if ecart_montant > 10 then
      motifs := motifs || to_jsonb('prix_en_hausse_de_plus_de_10_pct'::text);
    end if;
  end if;

  if p_new_quantity is not null and coalesce(t.quantity, 0) > 0 then
    ecart_quantite := (p_new_quantity - t.quantity) / t.quantity * 100;
    if ecart_quantite > 10 then
      motifs := motifs || to_jsonb('quantite_en_hausse_de_plus_de_10_pct'::text);
    end if;
  end if;

  return jsonb_build_object(
    'necessaire', jsonb_array_length(motifs) > 0,
    'motifs', motifs,
    'ecart_montant_pct', round(ecart_montant, 2),
    'ecart_quantite_pct', round(ecart_quantite, 2));
end $$;

-- ------------------------------------------------------------------
-- 5 · Les délais durs
-- ------------------------------------------------------------------

create or replace function customs_deadlines(p_shipment uuid)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  s        record;
  arrivee  date;
  somm     date;
begin
  select * into s from shipments where id = p_shipment;
  if not found or s.arrived_at is null then return null; end if;
  arrivee := s.arrived_at::date;

  -- Déclaration sommaire : 1 jour franc après l'arrivée, dimanches et jours
  -- fériés non comptés. Les fériés tunisiens ne sont pas en base : on écarte
  -- les dimanches et on le dit, plutôt que de promettre une exactitude fausse.
  somm := arrivee + 1;
  while extract(dow from somm) = 0 loop
    somm := somm + 1;
  end loop;

  return jsonb_build_object(
    'arrivee', arrivee,
    'declaration_sommaire', jsonb_build_object(
      'echeance', somm,
      'jours_restants', somm - current_date,
      'depasse', current_date > somm,
      'reserve', 'dimanches écartés, jours fériés non tenus'),
    -- Séjour maximum en magasin ou aire de dédouanement.
    'sejour_magasin', jsonb_build_object(
      'echeance', arrivee + 15,
      'jours_restants', (arrivee + 15) - current_date,
      'depasse', current_date > arrivee + 15 and s.goods_removed_at is null),
    'entrepot_public_max', arrivee + (5 * 365),
    'entrepot_prive_max',  arrivee + (2 * 365));
end $$;

-- ------------------------------------------------------------------
-- 6 · Sécurité
-- ------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['customs_declarations','customs_articles','tce_titles'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('customs_declarations', 'shipment:write'),
      ('customs_articles',     'shipment:write'),
      ('tce_titles',           'shipment:write')
    ) as v(tbl, cap)
  loop
    execute format('drop policy if exists %1$s_select on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_insert on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_update on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_delete on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_platform_read on %1$I', spec.tbl);
    execute format($f$
      create policy %1$s_select on %1$I for select to authenticated
        using (agency_id = auth_agency_id() and auth_can('case:read'))
    $f$, spec.tbl);
    execute format($f$
      create policy %1$s_insert on %1$I for insert to authenticated
        with check (agency_id = auth_agency_id() and auth_can(%2$L))
    $f$, spec.tbl, spec.cap);
    execute format($f$
      create policy %1$s_update on %1$I for update to authenticated
        using (agency_id = auth_agency_id() and auth_can(%2$L))
        with check (agency_id = auth_agency_id())
    $f$, spec.tbl, spec.cap);
    execute format($f$
      create policy %1$s_delete on %1$I for delete to authenticated
        using (agency_id = auth_agency_id() and auth_role() in ('owner','manager'))
    $f$, spec.tbl);
    execute format($f$
      create policy %1$s_platform_read on %1$I for select to authenticated
        using (is_platform_admin())
    $f$, spec.tbl);
  end loop;
end $$;

grant select, insert, update, delete on customs_declarations, customs_articles, tce_titles to authenticated;
grant all on customs_declarations, customs_articles, tce_titles to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'origin_preferential_allowed(char)', 'ndp_valid(text)',
    'customs_article_origin_ok(char, text)', 'customs_compute(uuid)',
    'tce_needs_amendment(uuid, text, numeric, numeric)',
    'customs_deadlines(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
