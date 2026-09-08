-- 0038 · La conformité, celle qui porte des amendes chiffrées.
--
-- Ces règles ne sont pas des options de confort : chacune a un montant en face,
-- et c'est l'agence qui paie. Le produit doit donc les tenir, et surtout les
-- dire AVANT le geste, pas dans un rapport après coup.
--
--   · Espèces à partir de 5 000 DT : article 83 ter du code des droits et
--     procédures fiscaux, amende de 20 % du montant, MINIMUM 2 000 DT.
--     Attention, l'étude de marché s'illustre elle-même de travers : elle dit
--     qu'un dossier à 6 000 DT en liquide « coûte 1 200 DT », or 20 % de 6 000
--     font justement 1 200, ce qui passe SOUS le plancher de 2 000. On applique
--     la règle telle qu'elle est écrite, pas l'exemple : 2 000 DT. Le plancher
--     mord jusqu'à 10 000 DT d'encaissement, au-delà c'est le pourcentage.
--   · Promesse de délai dans un message : article 13 de la loi 92-117,
--     publicité trompeuse sur les résultats attendus, 1 000 à 20 000 DT. Un
--     « visa en 24 heures » a valu une intervention du commissariat à Sousse
--     en octobre 2025.
--   · Catégorie de licence : une agence B ne peut ni organiser de circuit, ni
--     faire de la réception, NI DE L'OMRA. La catégorie C n'existe pas.
--
-- Ce que cette migration ne fait PAS : fixer une politique de remboursement.
-- Aucun texte tunisien ne la fixe, et aucune source ne dit que les frais
-- consulaires sont non remboursables. Une valeur par défaut de l'éditeur serait
-- une invention opposable à l'agence : c'est elle qui la déclare.

-- ------------------------------------------------------------------
-- 1 · Ce que l'agence doit déclarer sur elle-même
-- ------------------------------------------------------------------

alter table agencies add column if not exists license_category char(1)
  check (license_category is null or license_category in ('A', 'B'));
alter table agencies add column if not exists license_number text;
-- Mentions obligatoires de toute facture : article 18 II du code TVA,
-- article 25 de la loi 91-64, article 67 de la loi 95-44.
alter table agencies add column if not exists rc_number text;
alter table agencies add column if not exists rc_court  text;
alter table agencies add column if not exists legal_form text;
alter table agencies add column if not exists capital numeric(14,2);
-- L'obligation TTN ne mord qu'à l'ADHÉSION EFFECTIVE au réseau. Celui qui a
-- seulement déposé sa demande continue d'émettre du papier régulièrement.
alter table agencies add column if not exists ttn_member boolean not null default false;
alter table agencies add column if not exists ttn_ref text;
-- La politique de remboursement en cas de refus : déclarée par l'agence, jamais
-- livrée par l'éditeur.
alter table agencies add column if not exists refund_policy jsonb;
-- Échéances ONTT : changement de siège ou de représentant sous 30 jours,
-- états financiers sous 3 mois (article 19 du décret-loi 73-13).
alter table agencies add column if not exists ontt_change_at date;
alter table agencies add column if not exists ontt_financials_at date;

comment on column agencies.license_category is
  'A ou B. Une agence B ne peut ni organiser de circuit, ni faire de la réception, ni de l''Omra. La catégorie C n''existe pas.';
comment on column agencies.ttn_member is
  'Adhésion EFFECTIVE au réseau TTN. Tant qu''elle est fausse, la facture papier reste régulière : l''obligation du 1er janvier 2026 ne vise que les adhérents.';
comment on column agencies.refund_policy is
  'Politique de remboursement en cas de refus, DÉCLARÉE PAR L''AGENCE. Aucune valeur par défaut : aucun texte tunisien ne la fixe.';

-- ------------------------------------------------------------------
-- 2 · L'espèces à 5 000 DT
-- ------------------------------------------------------------------

-- Les constantes de l'article 83 ter, et elles seules.
create or replace function cash_rules()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'threshold', 5000,      -- le seuil, en dinars
    'penalty_pct', 20,      -- l'amende, en pourcentage du montant
    'penalty_min', 2000     -- son plancher, en dinars
  )
$$;

/*
 * Ce que coûterait un encaissement en espèces, AVANT de l'accepter.
 *
 * Le seuil s'apprécie sur l'opération, pas sur le versement : trois versements
 * de 2 000 DT sur le même dossier font 6 000 DT en espèces, et l'amende tombe
 * quand même. On cumule donc ce qui a déjà été encaissé en liquide sur le
 * dossier.
 */
create or replace function cash_check(p_case uuid, p_amount numeric, p_currency char(3) default 'TND')
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  r          jsonb := cash_rules();
  deja       numeric := 0;
  total      numeric;
  seuil      numeric := (r->>'threshold')::numeric;
  amende     numeric;
begin
  -- La règle vise le dinar. Un encaissement en devise ne la déclenche pas ici,
  -- mais il relève du contrôle des changes, qui est un autre sujet.
  if p_currency is distinct from 'TND' then
    return jsonb_build_object('applies', false, 'reason', 'devise_etrangere');
  end if;

  select coalesce(sum(p.amount), 0) into deja
  from payments p
  where p.case_id = p_case and p.method = 'especes' and p.state <> 'rembourse';

  total := deja + coalesce(p_amount, 0);

  if total < seuil then
    return jsonb_build_object(
      'applies', true, 'over', false,
      'already_cash', deja, 'total_cash', total,
      'threshold', seuil,
      'headroom', seuil - total);
  end if;

  amende := greatest(total * (r->>'penalty_pct')::numeric / 100, (r->>'penalty_min')::numeric);

  return jsonb_build_object(
    'applies', true, 'over', true,
    'already_cash', deja, 'total_cash', total,
    'threshold', seuil,
    'penalty', round(amende, 3),
    -- Ce qu'on peut encore prendre en liquide sans franchir le seuil, le reste
    -- devant passer par virement ou chèque. Ce n'est pas du fractionnement
    -- artificiel : c'est changer de moyen de paiement, ce que la loi attend.
    -- Arrondi au dinar inférieur : un montant à trois décimales collé au seuil
    -- est illisible au comptoir, et on ne joue pas au millime près avec une
    -- amende de 2 000 DT.
    'cash_max', greatest(0, floor(seuil - deja - 1)),
    'transfer_min', round(total - greatest(0, floor(seuil - deja - 1)), 3));
end $$;

-- ------------------------------------------------------------------
-- 3 · Les promesses de délai dans les modèles de messages
-- ------------------------------------------------------------------
--
-- Article 13 de la loi 92-117 : la publicité trompeuse porte sur LES RÉSULTATS
-- ATTENDUS. Promettre « visa en 24 h » ou « accord garanti », c'est promettre un
-- résultat qui n'appartient pas à l'agence : il appartient au consulat.

create or replace function promise_check(p_text text)
returns jsonb
language plpgsql immutable
set search_path = public
as $$
declare
  motifs jsonb := '[]'::jsonb;
  t text := lower(coalesce(p_text, ''));
begin
  -- Un délai chiffré accolé à l'obtention du visa.
  if t ~ '(visa|accord|réponse|reponse)[^.!?]{0,40}(en|sous|d''ici)\s*[0-9]+\s*(h|heure|jour|semaine)' then
    motifs := motifs || to_jsonb('delai_promis'::text);
  end if;
  if t ~ '(garanti|garantie|assuré|assure|certain|sûr\s+d''obtenir|100\s*%)' then
    motifs := motifs || to_jsonb('resultat_garanti'::text);
  end if;
  if t ~ '(sans\s+refus|aucun\s+refus|jamais\s+de\s+refus)' then
    motifs := motifs || to_jsonb('absence_de_refus_promise'::text);
  end if;
  if t ~ '(rembours[eé]\s+si\s+refus)' and t !~ 'selon' then
    -- Promettre le remboursement sans renvoyer à la politique déclarée engage
    -- l'agence au-delà de ce qu'elle a écrit.
    motifs := motifs || to_jsonb('remboursement_promis_sans_politique'::text);
  end if;

  return jsonb_build_object(
    'clean', jsonb_array_length(motifs) = 0,
    'reasons', motifs);
end $$;

comment on function promise_check(text) is
  'Cherche une promesse de résultat dans un texte destiné au client. Article 13 de la loi 92-117 : 1 000 à 20 000 DT. Le délai et l''accord appartiennent au consulat, pas à l''agence.';

-- ------------------------------------------------------------------
-- 4 · Ce que la catégorie de licence autorise
-- ------------------------------------------------------------------

create or replace function agency_may(p_agency uuid, p_activity text)
returns boolean
language sql stable
set search_path = public
as $$
  select case
    -- Sans catégorie déclarée, on n'interdit rien : on ne va pas bloquer une
    -- agence parce qu'elle n'a pas encore rempli son profil. L'écran le lui dit.
    when (select license_category from agencies where id = p_agency) is null then true
    when (select license_category from agencies where id = p_agency) = 'A' then true
    -- Une agence B est limitée : ni circuit, ni réception, ni Omra.
    else p_activity not in ('circuit', 'reception', 'omra')
  end
$$;

-- ------------------------------------------------------------------
-- 5 · Les échéances ONTT et l'état de conformité
-- ------------------------------------------------------------------

create or replace function compliance_state(p_agency uuid)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  a       agencies;
  manques jsonb := '[]'::jsonb;
begin
  select * into a from agencies where id = p_agency;
  if a.id is null then return null; end if;

  -- Les mentions sans lesquelles une facture n'est pas régulière.
  if a.tax_id     is null then manques := manques || to_jsonb('matricule_fiscal'::text); end if;
  if a.rc_number  is null then manques := manques || to_jsonb('registre_commerce'::text); end if;
  if a.rc_court   is null then manques := manques || to_jsonb('tribunal'::text); end if;
  if a.legal_form is null then manques := manques || to_jsonb('forme_sociale'::text); end if;
  if a.capital    is null then manques := manques || to_jsonb('capital'::text); end if;
  if a.license_category is null then manques := manques || to_jsonb('categorie_licence'::text); end if;
  if a.license_number   is null then manques := manques || to_jsonb('numero_licence'::text); end if;
  if a.inpdp_ref  is null then manques := manques || to_jsonb('declaration_inpdp'::text); end if;
  -- La politique de remboursement doit être DÉCLARÉE, pas devinée.
  if a.refund_policy is null then manques := manques || to_jsonb('politique_remboursement'::text); end if;

  return jsonb_build_object(
    'ready', jsonb_array_length(manques) = 0,
    'missing', manques,
    'license_category', a.license_category,
    -- Tant que l'adhésion TTN n'est pas effective, la facture papier reste
    -- régulière. Le dire évite une panique inutile au 1er janvier.
    'ttn', jsonb_build_object(
      'member', a.ttn_member,
      'ref', a.ttn_ref,
      'paper_still_valid', not a.ttn_member),
    -- Article 19 du décret-loi 73-13.
    'ontt', jsonb_build_object(
      'change_due', case when a.ontt_change_at is not null
                    then a.ontt_change_at + 30 end,
      'change_late', a.ontt_change_at is not null and current_date > a.ontt_change_at + 30,
      'financials_due', case when a.ontt_financials_at is not null
                        then a.ontt_financials_at + 90 end,
      'financials_late', a.ontt_financials_at is not null
                         and current_date > a.ontt_financials_at + 90),
    'cash_rules', cash_rules());
end $$;

-- ------------------------------------------------------------------
-- 6 · Droits
-- ------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'cash_rules()', 'cash_check(uuid, numeric, char)', 'promise_check(text)',
    'agency_may(uuid, text)', 'compliance_state(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
