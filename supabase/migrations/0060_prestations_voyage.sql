-- 0060 · Les prestations de voyage : ce que l'agence vend AUTOUR du visa.
--
-- Une agence de visas ne vend pas que le visa. Elle vend le billet, l'hôtel,
-- l'assurance, le transfert. Aujourd'hui rien de tout ça n'existe dans la
-- base : le patron ne sait donc pas ce que chaque ligne lui rapporte, et
-- l'étude de marché dit toujours la même chose, à savoir que la billetterie
-- rapporte peu et que c'est l'assistance qui fait vivre l'agence. Encore
-- faut-il pouvoir le lire.
--
-- CE QUE CE MODULE N'EST PAS, ET C'EST LE POINT LE PLUS IMPORTANT.
--
-- VisaFlow ne réserve rien. Il n'y a ici ni moteur de réservation, ni
-- intermédiation, ni appel à une compagnie aérienne, à un hôtelier ou à un
-- assureur. L'agence réserve ailleurs, avec ses propres accès, puis elle vient
-- NOTER ici la référence, les dates, le prix et le document. C'est un carnet
-- de suivi, pas un distributeur.
--
-- Cette phrase n'est pas de la décoration : elle commande tout le reste. Un
-- carnet qui enregistre une information ne réalise aucune opération
-- réglementée. Les gardes de ce fichier rappellent donc, elles ne bloquent
-- jamais. Voir la section 4 et son relevé de ce qui n'a pas pu être affirmé.
--
-- TROIS RÈGLES PORTÉES PAR LE MODÈLE.
--   1. La marge est une colonne GÉNÉRÉE. C'est le premier chiffre qu'on serait
--      tenté d'arranger, et une marge saisie à la main ne se contredit jamais
--      elle-même : elle ment tranquillement.
--   2. Le coût n'est lisible par personne en direct, pas même par le patron.
--      Il ne sort que par les fonctions de marge, qui vérifient le droit à
--      chaque appel. Voir la section 7.
--   3. La marge du dossier RÉUTILISE `case_margin` de 0045. Deux calculs de
--      marge qui se contredisent, c'est le pire résultat possible : le patron
--      qui voit deux chiffres différents pour le même dossier ne rouvre plus
--      ni l'un ni l'autre.
--
-- ET LA RÈGLE DE CONTENU DU PROJET, RAPPELÉE ICI : aucun tarif, aucune
-- compagnie, aucun assureur, aucun barème n'est livré. Pas de catalogue de
-- compagnies aériennes, pas de liste d'assureurs, pas de prix par défaut.
-- L'agence saisit ce qu'elle a payé et ce qu'elle a vendu.

-- ==================================================================
-- 1 · La table centrale
-- ==================================================================

create table if not exists travel_services (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies on delete cascade,
  office_id     uuid references offices on delete set null,
  -- Nul volontairement : une agence vend un billet sec à quelqu'un qui n'a
  -- aucun dossier de visa chez elle. Exiger un dossier obligerait à en ouvrir
  -- un faux, et le comptage des dossiers deviendrait faux avec lui.
  case_id       uuid references cases on delete set null,
  client_id     uuid references clients on delete set null,

  kind          text not null
                check (kind in ('BILLET','HEBERGEMENT','ASSURANCE','TRANSFERT','TRANSPORT','AUTRE')),

  supplier_name text,
  -- Identifiant nu, sans clé étrangère. `suppliers` appartient au module des
  -- référentiels du fret : une clé étrangère ferait dépendre les prestations
  -- de voyage d'un module qu'une agence de visas seule n'installera peut-être
  -- jamais. On lit la table avec `to_regclass` avant de la toucher.
  supplier_id   uuid,
  -- Même principe pour le catalogue commercial de 0045. Voir la section 5 :
  -- on rattache, on ne duplique pas.
  service_id    uuid,

  reference     text,

  -- Les états d'un CARNET, pas d'un système de réservation.
  --   a_faire    : l'agence n'a pas encore la référence.
  --   enregistre : elle l'a notée ici.
  --   confirme   : le fournisseur a confirmé, l'agence le constate.
  --   annule / rembourse : deux constats, pas deux gestes de VisaFlow.
  -- Il n'y a pas d'état « émis » : VisaFlow n'émet rien.
  status        text not null default 'a_faire'
                check (status in ('a_faire','enregistre','confirme','annule','rembourse')),

  booked_at     timestamptz,
  cancelled_at  timestamptz,

  document_path text,
  document_name text,
  note          text,

  created_by    uuid references profiles on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Aucune suppression dure : une prestation effacée emporte la trace de ce
  -- qu'on avait facturé au client, et le litige arrive six mois plus tard.
  deleted_at    timestamptz,

  -- ---------------- L'argent ----------------
  --
  -- Zéro par défaut, jamais autre chose. Un coût laissé à zéro affiche la
  -- vente entière en marge : l'écran le dit, la base ne devine pas.
  sold_amount   numeric(14,2) not null default 0 check (sold_amount >= 0),
  cost_amount   numeric(14,2) not null default 0 check (cost_amount >= 0),
  currency      char(3) not null default 'TND',
  -- Le taux du jour où l'agence a noté la prestation. Le recalculer plus tard
  -- au cours courant réécrirait l'histoire d'un dossier déjà clos, exactement
  -- comme pour les dépenses de 0045.
  fx_rate       numeric(14,6) not null default 1 check (fx_rate > 0),

  -- Colonnes générées : le navigateur ne peut pas les écrire, même en
  -- trichant sur la requête. Aucune contrainte de signe ici, et c'est
  -- délibéré : une marge NÉGATIVE est autorisée. Une agence vend parfois à
  -- perte pour garder un client, et le lui interdire ne l'empêcherait pas de
  -- vendre à perte : elle fausserait sa saisie, et le rapport avec.
  margin        numeric(14,2) generated always as (sold_amount - cost_amount) stored,
  -- Les trois montants en devise de base de l'agence. Le rapport et le tableau
  -- de marge additionnent des dinars, jamais des euros et des dinars mêlés.
  sold_base     numeric(14,2) generated always as (round(sold_amount * fx_rate, 2)) stored,
  cost_base     numeric(14,2) generated always as (round(cost_amount * fx_rate, 2)) stored,
  margin_base   numeric(14,2) generated always as (round((sold_amount - cost_amount) * fx_rate, 2)) stored,

  -- ---------------- Le billet ----------------
  carrier        text,
  flight_no_out  text,
  flight_no_back text,
  pnr            text,
  ticket_number  text,
  depart_from    text,
  depart_to      text,
  depart_at      timestamptz,
  return_at      timestamptz,
  passengers     integer check (passengers is null or passengers > 0),
  cabin          text,
  baggage_kg     numeric(6,2) check (baggage_kg is null or baggage_kg >= 0),

  -- ---------------- L'hébergement ----------------
  hotel_name     text,
  hotel_city     text,
  hotel_address  text,
  checkin_date   date,
  checkout_date  date,
  -- Le nombre de nuitées ne se saisit pas : deux dates et une soustraction
  -- suffisent, et une nuitée saisie à la main finit par contredire les dates
  -- qu'elle est censée résumer.
  nights         integer generated always as (
                   case when checkin_date is not null and checkout_date is not null
                        then (checkout_date - checkin_date) end) stored,
  rooms          integer check (rooms is null or rooms > 0),
  guests         integer check (guests is null or guests > 0),
  board          text check (board is null or board in
                   ('chambre_seule','petit_dejeuner','demi_pension','pension_complete','tout_compris')),

  -- ---------------- L'assurance ----------------
  insurer           text,
  policy_number     text,
  coverage_amount   numeric(14,2) check (coverage_amount is null or coverage_amount >= 0),
  coverage_currency char(3),
  cover_from        date,
  cover_to          date,
  cover_area        text,
  assistance_phone  text,

  -- ---------------- Le transfert ----------------
  pickup_place  text,
  dropoff_place text,
  pickup_at     timestamptz,
  vehicle       text,
  driver_phone  text,

  -- ---------------- La cohérence des dates ----------------
  --
  -- Trois inversions que la saisie au clavier produit tous les jours, et qui
  -- ne se voient qu'au moment où le client se présente à l'aéroport.
  constraint travel_services_retour_apres_aller
    check (return_at is null or depart_at is null or return_at >= depart_at),
  constraint travel_services_sortie_apres_entree
    check (checkout_date is null or checkin_date is null or checkout_date >= checkin_date),
  constraint travel_services_couverture_coherente
    check (cover_to is null or cover_from is null or cover_to >= cover_from)
);

create index if not exists travel_services_case
  on travel_services (case_id) where deleted_at is null;
create index if not exists travel_services_agency
  on travel_services (agency_id, kind, status) where deleted_at is null;
create index if not exists travel_services_client
  on travel_services (client_id) where deleted_at is null;
create index if not exists travel_services_periode
  on travel_services (agency_id, booked_at desc) where deleted_at is null;

comment on table travel_services is
  'Ce que l''agence vend autour du visa : billet, hébergement, assurance, transfert. VisaFlow ne réserve rien : l''agence réserve ailleurs et vient noter ici la référence, les dates, le prix et le document.';
comment on column travel_services.margin is
  'Vendu moins coût. Colonne générée : le navigateur ne peut pas l''écrire. C''est le premier chiffre qu''on serait tenté d''arranger.';
comment on column travel_services.margin_base is
  'La marge en devise de base de l''agence, au taux noté le jour de la saisie. Le rapport additionne des dinars, jamais des devises mêlées.';
comment on column travel_services.supplier_id is
  'Identifiant nu vers `suppliers`, sans clé étrangère : ce répertoire appartient au module du fret, qu''une agence de visas seule n''installera peut-être jamais.';
comment on column travel_services.service_id is
  'Identifiant nu vers `services` (catalogue de 0045). On rattache la prestation vendue à la ligne du catalogue, on ne crée pas un second catalogue.';
comment on column travel_services.status is
  'États d''un carnet de suivi. Pas d''état « émis » : VisaFlow n''émet aucun titre de transport.';

-- ------------------------------------------------------------------
-- Le garde de cohérence
-- ------------------------------------------------------------------
--
-- Les clés étrangères disent que le dossier existe, jamais qu'il appartient à
-- la même agence. Sans ce garde, une agence rattacherait sa prestation au
-- dossier d'une autre, et la marge de la voisine bougerait toute seule.

create or replace function travel_service_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.case_id is not null
     and not exists (select 1 from cases c where c.id = new.case_id and c.agency_id = new.agency_id) then
    raise exception 'dossier d''une autre agence' using errcode = '42501';
  end if;
  if new.client_id is not null
     and not exists (select 1 from clients c where c.id = new.client_id and c.agency_id = new.agency_id) then
    raise exception 'client d''une autre agence' using errcode = '42501';
  end if;
  if new.office_id is not null
     and not exists (select 1 from offices o where o.id = new.office_id and o.agency_id = new.agency_id) then
    raise exception 'bureau d''une autre agence' using errcode = '42501';
  end if;
  -- Un constat d'annulation porte sa date, sinon personne ne sait quand la
  -- ligne a cessé de compter.
  if new.status in ('annule','rembourse') and new.cancelled_at is null then
    new.cancelled_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists travel_services_guard on travel_services;
create trigger travel_services_guard before insert or update on travel_services
  for each row execute function travel_service_guard();

-- ==================================================================
-- 2 · Le cloisonnement
-- ==================================================================
--
-- Lecture : l'agence, le bureau, et le droit de lire un dossier.
-- Écriture : `payment:write`, celui qui encaisse note aussi la prestation.
-- Le coût et la marge, eux, ne passent PAS par une politique : ils passent par
-- un droit de colonne absent. Voir la section 7, c'est le point délicat.

alter table travel_services enable row level security;
alter table travel_services force row level security;

drop policy if exists travel_services_select on travel_services;
drop policy if exists travel_services_insert on travel_services;
drop policy if exists travel_services_update on travel_services;
drop policy if exists travel_services_platform_read on travel_services;

create policy travel_services_select on travel_services for select to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('case:read'));
create policy travel_services_insert on travel_services for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('payment:write'));
create policy travel_services_update on travel_services for update to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('payment:write'))
  with check (agency_id = auth_agency_id());
-- Aucune politique de suppression : la seule façon de retirer une ligne est
-- `deleted_at`. Le droit DELETE est repris en section 7, sinon la règle ne
-- tiendrait que sur une bonne intention.

-- Le support de la plateforme lit la ligne, comme il lit un dossier. Il ne
-- verra pas le coût pour autant : le droit de colonne le lui refuse comme aux
-- autres, et c'est la règle de 0028, le support regarde un dossier, pas le
-- coût de revient d'une agence cliente.
create policy travel_services_platform_read on travel_services for select to authenticated
  using (is_platform_admin());

-- ==================================================================
-- 3 · Le rattachement au catalogue commercial
-- ==================================================================
--
-- POURQUOI PAS UN SECOND CATALOGUE. La migration 0045 a déjà `services` :
-- le catalogue vendable de l'agence, avec son prix par défaut, sa TVA et son
-- nom traduit en quatre langues. En poser un deuxième pour le voyage donnerait
-- deux endroits où changer un prix, et le jour où l'agence ne change que l'un
-- des deux, la facture et le devis ne diraient plus la même chose. On rattache
-- donc la prestation vendue à la ligne du catalogue par `service_id`, et on
-- lit le prix là où il est déjà saisi.

create or replace function travel_service_from_catalog(p_service uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a uuid := auth_agency_id(); r jsonb;
begin
  if a is null or not auth_can('case:read') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  -- Le catalogue appartient à un autre module : on vérifie qu'il est là avant
  -- de le lire, sinon ce fichier ne s'installerait plus tout seul.
  if to_regclass('public.services') is null then return null; end if;

  select jsonb_build_object(
    'service_id', s.id, 'name', s.name, 'category', s.category,
    'default_price', s.default_price, 'currency', s.currency, 'tax_rate', s.tax_rate)
    into r
  from services s
  where s.id = p_service and s.agency_id = a and s.active;

  return r;
end $$;

comment on function travel_service_from_catalog(uuid) is
  'Pré-remplit une prestation depuis le catalogue de 0045. Aucun prix n''est inventé : on rend celui que l''agence a saisi, zéro compris.';

-- ==================================================================
-- 4 · La garde de licence, et ce qu'elle ne prétend pas savoir
-- ==================================================================
--
-- CE QUE JE SAIS, PARCE QUE LA MIGRATION 0038 L'A ÉTABLI :
--   · Une agence tunisienne déclare une catégorie de licence, A ou B. La
--     catégorie C n'existe pas.
--   · Une agence de catégorie B ne peut ni organiser de circuit, ni faire de
--     la réception, ni de l'Omra. C'est ce que `agency_may` applique, et cette
--     fonction n'est PAS modifiée ici : une autre migration pourrait la
--     toucher, et deux fichiers qui réécrivent la même garde finissent par se
--     contredire.
--
-- CE QUE JE NE PEUX PAS AFFIRMER, ET QUE JE N'INVENTE DONC PAS :
--   · Je ne peux pas établir avec certitude que la vente de billetterie
--     aérienne soit réservée à la catégorie A, ni qu'elle soit fermée à la
--     catégorie B. Le décret-loi 73-13 et ses textes d'application définissent
--     les catégories, mais je n'ai pas leur rédaction en vigueur sous les
--     yeux, et une interdiction fausse empêcherait une agence de travailler.
--     Une interdiction fausse est PIRE qu'une absence d'interdiction.
--   · Même chose pour la réservation d'hébergement.
--   · Pour l'assurance voyage : la distribution d'un contrat d'assurance
--     relève du code des assurances tunisien, pas seulement de la licence
--     d'agence de voyages. Je ne peux citer ni l'article, ni le régime exact
--     applicable à une agence de voyages qui place un contrat pour son client.
--     On rappelle donc à l'agence de vérifier auprès de sa compagnie qu'elle
--     est habilitée, et on ne dit rien de plus.
--
-- CONSÉQUENCE, ET ELLE EST DÉFINITIVE : cette fonction ne refuse JAMAIS. Elle
-- rend toujours `autorise = true`. Deux raisons, l'une de fond, l'autre de
-- droit. De fond : je ne sais pas, donc je ne tranche pas. De droit : ce
-- module ENREGISTRE UNE INFORMATION, il ne réalise aucune opération
-- réglementée. Bloquer la saisie d'une référence de billet ne protégerait
-- personne, cela empêcherait seulement l'agence de tenir son carnet.
--
-- Les avertissements sont rendus sous forme de CODES, pas de phrases :
-- l'écran les traduit dans les quatre langues, et le texte réglementaire ne
-- se réécrit pas dans une base de données.

create or replace function travel_service_allowed(p_agency uuid, p_kind text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cat      char(1);
  v_activite text;
  v_may      boolean;
  v_codes    jsonb := '[]'::jsonb;
begin
  select license_category into v_cat from agencies where id = p_agency;

  -- On traduit la nature en activité, puis on interroge la garde existante
  -- SANS la réécrire. Aucune de ces activités n'est dans sa liste fermée :
  -- elle répond donc vrai, et c'est exactement l'information utile, à savoir
  -- que rien de connu n'interdit cette saisie.
  v_activite := case p_kind
    when 'BILLET'      then 'billetterie'
    when 'HEBERGEMENT' then 'hebergement'
    when 'ASSURANCE'   then 'assurance'
    when 'TRANSFERT'   then 'transfert'
    when 'TRANSPORT'   then 'transport'
    else 'autre' end;
  v_may := agency_may(p_agency, v_activite);

  -- Sans catégorie déclarée, on ne bloque pas : on le dit. Même choix qu'en
  -- 0038, une agence qui n'a pas fini son profil doit pouvoir travailler.
  if v_cat is null then
    v_codes := v_codes || to_jsonb('categorie_non_declaree'::text);
  elsif v_cat = 'B' and p_kind in ('BILLET','HEBERGEMENT') then
    -- Un rappel, pas un refus. Voir l'en-tête de cette section : je ne peux
    -- pas établir que la catégorie B soit fermée à la billetterie.
    v_codes := v_codes || to_jsonb('licence_b_a_verifier'::text);
  end if;

  -- L'assurance porte son propre rappel, quelle que soit la catégorie : le
  -- code des assurances est un autre texte que la licence d'agence.
  if p_kind = 'ASSURANCE' then
    v_codes := v_codes || to_jsonb('assurance_mandat_a_verifier'::text);
  end if;

  return jsonb_build_object(
    'autorise', true,
    'motif', null,
    'categorie', v_cat,
    'activite', v_activite,
    -- Ce que la garde de 0038 répond, telle quelle, sans interprétation.
    'garde_licence', v_may,
    'avertissement', v_codes->>0,
    'avertissements', v_codes,
    -- Le rappel de ce que fait ce module, pour que l'écran puisse le dire au
    -- lieu de laisser croire à une autorisation délivrée par le logiciel.
    'enregistrement_seulement', true);
end $$;

comment on function travel_service_allowed(uuid, text) is
  'Rappelle ce qu''il y a à vérifier avant de noter une prestation. Ne refuse JAMAIS : ce module enregistre une information, il ne réalise aucune opération réglementée, et une interdiction fausse empêcherait une agence de travailler.';

-- ==================================================================
-- 5 · L'état du voyage, pour la barre de progression du dossier
-- ==================================================================
--
-- Trois questions, trois réponses : l'assurance est-elle notée, l'hôtel
-- est-il noté, le billet est-il noté. Avec la référence courte et la date,
-- pour que la barre puisse afficher autre chose qu'une pastille verte.
--
-- Aucun montant ici, volontairement : cette fonction est lue par tout le monde
-- avec `case:read`, et un chiffre d'argent qui traîne dans une barre de
-- progression est un chiffre d'argent qui a fui.

create or replace function travel_readiness(p_case uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a uuid := auth_agency_id(); r jsonb;
begin
  if a is null or not auth_can('case:read') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  if not exists (select 1 from cases where id = p_case and agency_id = a) then
    raise exception 'dossier inconnu' using errcode = 'P0002';
  end if;

  -- « Noté » veut dire que l'agence a la référence en main. Une ligne encore
  -- « à faire » n'est pas une assurance souscrite : la dire prête ferait
  -- partir un client sans couverture.
  select jsonb_object_agg(k.code, jsonb_build_object(
    'note', t.id is not null,
    'reference', t.ref,
    'date', t.jour,
    'status', t.status
  ))
    into r
  from (values ('billet','BILLET'), ('hebergement','HEBERGEMENT'), ('assurance','ASSURANCE')) as k(code, kind)
  left join lateral (
    select s.id, s.status,
           case s.kind
             when 'BILLET'      then coalesce(nullif(s.pnr, ''), nullif(s.ticket_number, ''), s.reference)
             when 'HEBERGEMENT' then coalesce(nullif(s.reference, ''), s.hotel_name)
             else coalesce(nullif(s.policy_number, ''), s.reference)
           end as ref,
           case s.kind
             when 'BILLET'      then s.depart_at::date
             when 'HEBERGEMENT' then s.checkin_date
             else s.cover_from
           end as jour
    from travel_services s
    where s.case_id = p_case and s.kind = k.kind
      and s.deleted_at is null and s.status in ('enregistre','confirme')
    order by s.updated_at desc
    limit 1
  ) t on true;

  return jsonb_build_object('case_id', p_case) || coalesce(r, '{}'::jsonb);
end $$;

comment on function travel_readiness(uuid) is
  'Assurance, hôtel, billet : notés ou non, avec la référence courte et la date. Aucun montant : cette fonction se lit avec `case:read`.';

-- ==================================================================
-- 6 · Les marges
-- ==================================================================

-- Le pourcentage, en un seul endroit. Sur zéro vendu, il n'existe pas : on
-- rend NULL, pas 0 %, qui laisserait croire à une vente sans marge.
create or replace function travel_margin_pct(p_sold numeric, p_margin numeric)
returns numeric language sql immutable as $$
  select case when p_sold > 0 then round(p_margin * 100 / p_sold, 2) end
$$;

-- ------------------------------------------------------------------
-- 6.1 · Le tableau du dossier, exactement celui que le client a dessiné
-- ------------------------------------------------------------------
--
-- L'ASSISTANCE VISA N'EST PAS UNE PRESTATION DE VOYAGE, et elle doit pourtant
-- figurer dans le tableau : c'est elle qui fait vivre l'agence, et une marge
-- de dossier qui l'oublierait dirait exactement le contraire de la vérité.
--
-- Elle vient de deux endroits, et on ne recalcule NI l'un NI l'autre :
--   · ce que l'agence facture : `case_margin` de 0045 rend le facturé hors
--     taxe des factures du dossier. Quand il n'y a pas encore de facture, on
--     retombe sur `cases.amount_total`, c'est-à-dire le montant convenu avec
--     le client. C'est le chiffre que le comptoir connaît.
--   · ce que le dossier a coûté : `case_margin` rend déjà la somme des
--     dépenses, frais consulaires compris.
--
-- LE PIÈGE À CONNAÎTRE, ET IL EST ÉCRIT ICI PARCE QU'IL SE PAIERA UN JOUR :
-- si l'agence saisit AUSSI le coût d'un billet comme une dépense du dossier,
-- ce coût est compté deux fois, une fois dans `cost_amount` et une fois dans
-- les dépenses. Le coût d'une prestation de voyage se note sur la prestation,
-- pas dans les dépenses. L'écran le rappelle.

create or replace function case_travel_margin(p_case uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a          uuid := auth_agency_id();
  v_cur      char(3);
  v_lines    jsonb := '[]'::jsonb;
  v_t_sold   numeric := 0;
  v_t_cost   numeric := 0;
  v_base     jsonb;
  v_a_sold   numeric := 0;
  v_a_cost   numeric := 0;
  v_total    numeric;
begin
  if a is null or not auth_can('finance:global') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  if not exists (select 1 from cases where id = p_case and agency_id = a) then
    raise exception 'dossier inconnu' using errcode = 'P0002';
  end if;
  select currency into v_cur from agencies where id = a;

  -- Les prestations de voyage, une ligne par vente. Une ligne annulée ne
  -- compte plus : l'agence ne l'encaisse pas et ne la paie pas.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'kind', s.kind,
           'label', coalesce(nullif(s.supplier_name, ''), s.carrier, s.hotel_name, s.insurer),
           'reference', coalesce(nullif(s.reference, ''), s.pnr, s.policy_number),
           'sold', s.sold_base, 'cost', s.cost_base, 'margin', s.margin_base,
           'margin_pct', travel_margin_pct(s.sold_base, s.margin_base),
           'currency', v_cur,
           -- La devise d'origine, pour l'écran qui veut dire « 400 €, notés au
           -- taux du jour ». On ne cache pas la conversion, on l'explique.
           'source_currency', s.currency, 'source_sold', s.sold_amount, 'fx_rate', s.fx_rate
         ) order by s.kind, s.created_at), '[]'::jsonb),
         coalesce(sum(s.sold_base), 0), coalesce(sum(s.cost_base), 0)
    into v_lines, v_t_sold, v_t_cost
  from travel_services s
  where s.case_id = p_case and s.deleted_at is null
    and s.status not in ('annule','rembourse');

  -- L'assistance visa. On APPELLE `case_margin`, on ne la refait pas.
  if to_regprocedure('public.case_margin(uuid)') is not null then
    v_base   := case_margin(p_case);
    v_a_sold := coalesce((v_base->>'billed')::numeric, 0);
    v_a_cost := coalesce((v_base->>'expenses')::numeric, 0);
  end if;

  -- Pas encore de facture : le montant convenu sur le dossier fait foi. C'est
  -- ce que l'agence a annoncé au client, et c'est sur ce chiffre qu'elle
  -- raisonne tant que la facture n'est pas éditée.
  if v_a_sold = 0 then
    select coalesce(amount_total, 0) into v_a_sold from cases where id = p_case;
  end if;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'id', null, 'kind', 'ASSISTANCE',
    'label', null, 'reference', null,
    'sold', v_a_sold, 'cost', v_a_cost, 'margin', v_a_sold - v_a_cost,
    'margin_pct', travel_margin_pct(v_a_sold, v_a_sold - v_a_cost),
    'currency', v_cur,
    'source_currency', v_cur, 'source_sold', v_a_sold, 'fx_rate', 1));

  v_total := (v_t_sold - v_t_cost) + (v_a_sold - v_a_cost);

  return jsonb_build_object(
    'case_id', p_case,
    'currency', v_cur,
    'lines', v_lines,
    -- Le voyage seul, pour l'agence qui veut savoir ce que le hors-visa
    -- rapporte réellement.
    'travel', jsonb_build_object(
      'sold', v_t_sold, 'cost', v_t_cost, 'margin', v_t_sold - v_t_cost,
      'margin_pct', travel_margin_pct(v_t_sold, v_t_sold - v_t_cost)),
    'assistance', jsonb_build_object(
      'sold', v_a_sold, 'cost', v_a_cost, 'margin', v_a_sold - v_a_cost,
      'margin_pct', travel_margin_pct(v_a_sold, v_a_sold - v_a_cost)),
    'total', jsonb_build_object(
      'sold', v_t_sold + v_a_sold, 'cost', v_t_cost + v_a_cost, 'margin', v_total,
      'margin_pct', travel_margin_pct(v_t_sold + v_a_sold, v_total)),
    -- Le rappel du piège, porté par la donnée pour que l'écran l'affiche sans
    -- avoir à le savoir.
    'note', 'cout_prestation_hors_depenses');
end $$;

comment on function case_travel_margin(uuid) is
  'Le tableau de marge d''un dossier, ligne par ligne, assistance visa comprise. L''assistance vient de `case_margin` (0045), jamais d''un second calcul : deux marges qui se contredisent, c''est le pire résultat possible.';

-- ------------------------------------------------------------------
-- 6.2 · L'argent ligne par ligne, pour les écrans
-- ------------------------------------------------------------------
--
-- Les colonnes de coût ne sont lisibles par personne en direct (section 7).
-- C'est cette fonction qui les rend, une fois le droit vérifié, à l'écran des
-- prestations et à la fiche du dossier.

create or replace function travel_service_money(
  p_case uuid default null, p_office uuid default null,
  p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a uuid := auth_agency_id(); v_cur char(3);
  d1 date := coalesce(p_from, current_date - 365);
  d2 date := coalesce(p_to, current_date);
begin
  if a is null or not auth_can('finance:global') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  if not auth_sees_office(p_office) then
    raise exception 'bureau hors périmètre' using errcode = '42501';
  end if;
  select currency into v_cur from agencies where id = a;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'kind', s.kind,
      'sold', s.sold_base, 'cost', s.cost_base, 'margin', s.margin_base,
      'margin_pct', travel_margin_pct(s.sold_base, s.margin_base),
      'currency', v_cur, 'source_currency', s.currency, 'fx_rate', s.fx_rate
    ) order by s.created_at desc), '[]'::jsonb)
    from travel_services s
    where s.agency_id = a and s.deleted_at is null
      and auth_sees_office(s.office_id)
      and (p_case is null or s.case_id = p_case)
      and (p_office is null or s.office_id = p_office)
      -- Sur un dossier précis, on ne coupe pas par période : une prestation
      -- notée l'an dernier fait toujours partie du dossier.
      and (p_case is not null or coalesce(s.booked_at, s.created_at)::date between d1 and d2)
  );
end $$;

-- ------------------------------------------------------------------
-- 6.3 · Le rapport par nature, pour le pilotage
-- ------------------------------------------------------------------
--
-- C'est le tableau qui répond à la seule question qui compte : « qu'est-ce qui
-- me fait vivre ? ». Une agence doit pouvoir constater que ses billets ne lui
-- laissent presque rien et que c'est l'assistance qui paie les salaires.

create or replace function travel_margin_report(
  p_office uuid default null, p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a uuid := auth_agency_id(); v_cur char(3);
  d1 date := coalesce(p_from, current_date - 365);
  d2 date := coalesce(p_to, current_date);
  v_kinds jsonb; v_sold numeric := 0; v_cost numeric := 0; v_count int := 0;
begin
  if a is null or not auth_can('finance:global') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  -- Un responsable de bureau ne regarde pas les chiffres d'un autre bureau.
  -- Même garde qu'`agency_finance_summary` en 0045.
  if not auth_sees_office(p_office) then
    raise exception 'bureau hors périmètre' using errcode = '42501';
  end if;
  select currency into v_cur from agencies where id = a;

  with retenu as (
    select s.kind, s.sold_base, s.cost_base, s.margin_base
    from travel_services s
    where s.agency_id = a and s.deleted_at is null
      and s.status not in ('annule','rembourse')
      and auth_sees_office(s.office_id)
      and (p_office is null or s.office_id = p_office)
      and coalesce(s.booked_at, s.created_at)::date between d1 and d2
  ),
  par_nature as (
    select kind, count(*) as n,
           sum(sold_base) as sold, sum(cost_base) as cost, sum(margin_base) as margin
    from retenu group by kind
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', kind, 'count', n,
           'sold', sold, 'cost', cost, 'margin', margin,
           'margin_pct', travel_margin_pct(sold, margin)
         ) order by margin desc), '[]'::jsonb),
         coalesce(sum(sold), 0), coalesce(sum(cost), 0), coalesce(sum(n), 0)::int
    into v_kinds, v_sold, v_cost, v_count
  from par_nature;

  return jsonb_build_object(
    'from', d1, 'to', d2, 'currency', v_cur, 'office_id', p_office,
    'kinds', v_kinds,
    'total', jsonb_build_object(
      'count', v_count, 'sold', v_sold, 'cost', v_cost,
      'margin', v_sold - v_cost,
      'margin_pct', travel_margin_pct(v_sold, v_sold - v_cost)));
end $$;

comment on function travel_margin_report(uuid, date, date) is
  'La marge par nature de prestation sur une période. Répond à « qu''est-ce qui me fait vivre ? », qui est la seule question que le patron pose vraiment.';

-- ==================================================================
-- 7 · Les droits, et le point délicat du coût
-- ==================================================================
--
-- LE PIÈGE DE 0015. Cette migration a posé un `alter default privileges` qui
-- accorde `select, insert, update, delete` à `authenticated` sur TOUTE table
-- créée ensuite. Une table nouvelle reçoit donc DELETE sans que personne ne
-- l'écrive, et la règle « aucune suppression dure » ne tient plus. Trois
-- modules s'y sont fait prendre. On reprend tout, puis on redonne.
--
-- LE COÛT ET LA MARGE : UN DROIT DE COLONNE, PAS UNE POLITIQUE.
--
-- La demande est nette : un agent doit pouvoir noter un billet sans voir la
-- marge de l'agence. La sécurité au niveau des LIGNES ne sait pas faire ça,
-- elle montre ou cache une ligne entière. On retire donc le droit de LIRE
-- quatre colonnes : `cost_amount`, `cost_base`, `margin`, `margin_base`.
--
-- Conséquence à assumer, et elle est volontaire : PERSONNE ne lit ces colonnes
-- en direct, pas même le patron. Un droit de colonne s'accorde à un RÔLE, et
-- tout le monde partage le rôle `authenticated`. La direction lit donc le coût
-- par les fonctions de la section 6, qui vérifient `finance:global` à chaque
-- appel. C'est plus sûr qu'une politique : une requête bricolée ne contourne
-- pas un droit qui n'existe pas.
--
-- L'ÉCRITURE, elle, reste ouverte sur toutes les colonnes : l'agent qui note
-- le billet saisit ce que la compagnie lui a facturé. Il l'écrit, il ne le
-- relit pas. C'est exactement le partage que l'agence demande.

do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'travel_services'
    and column_name not in ('cost_amount', 'cost_base', 'margin', 'margin_base');

  execute 'revoke all on travel_services from anon, authenticated';
  execute format('grant select (%s) on travel_services to authenticated', cols);
  execute 'grant insert, update on travel_services to authenticated';
  execute 'grant all on travel_services to service_role';
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'travel_service_from_catalog(uuid)',
    'travel_service_allowed(uuid, text)',
    'travel_readiness(uuid)',
    'travel_margin_pct(numeric, numeric)',
    'case_travel_margin(uuid)',
    'travel_service_money(uuid, uuid, date, date)',
    'travel_margin_report(uuid, date, date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Le piège des fonctions de déclencheur, repris de 0044 : PostgreSQL accorde
-- EXECUTE à PUBLIC sur toute fonction nouvelle. Pour un déclencheur personne
-- ne le remarque, il s'appelle tout seul. Mais il reste appelable directement
-- par un anonyme, et une fonction SECURITY DEFINER appelable par un anonyme
-- est une porte ouverte. On ferme, pour tout le schéma.
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
