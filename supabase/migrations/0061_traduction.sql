-- 0061 · Les traductions : un carnet de suivi, pas un intermédiaire.
--
-- CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS.
--
-- VisaFlow ne passe commande à personne. Il n'envoie aucun message, ne
-- contacte aucun traducteur, n'ouvre aucun portail traducteur. L'agence confie
-- sa traduction comme elle le fait déjà, par téléphone ou par WhatsApp, puis
-- vient NOTER ici : à qui, quelles pages, quel prix, quelle date promise, et
-- le fichier quand il revient. Tout ce fichier tient un carnet de suivi.
-- Écrire « commande envoyée » quelque part laisserait croire qu'un message est
-- parti, et l'agence attendrait une réponse qui ne viendrait jamais.
--
-- POURQUOI CE CARNET MANQUE AUJOURD'HUI.
--
-- La traduction est une source de marge régulière dans une agence de visas, et
-- c'est aussi la première cause de dossier qui dort : trois semaines chez un
-- traducteur, personne ne s'en aperçoit tant que le client n'appelle pas. Deux
-- chiffres suffisent à changer ça : la date promise, et la date réellement
-- constatée.
--
-- AUCUN TARIF N'EST LIVRÉ, AUCUN TRADUCTEUR N'EST FOURNI. Le prix à la page se
-- négocie entre l'agence et son traducteur, il n'est publié nulle part. Une
-- liste de traducteurs livrée avec le produit enverrait l'agent au mauvais
-- numéro. L'agence saisit les siens.
--
-- LA MARGE NE S'ÉCRIT PAS. C'est une colonne générée : le navigateur ne peut
-- pas la poser, même en trichant sur la requête. C'est le premier chiffre
-- qu'on serait tenté d'arranger.

-- ------------------------------------------------------------------
-- 1 · Les langues, un petit référentiel partagé
-- ------------------------------------------------------------------
--
-- Partagé par toutes les agences, et sans agency_id : le nom de l'arabe ne
-- change pas d'une agence à l'autre. Il sert l'écran, il ne ferme rien : une
-- agence qui traduit vers une langue absente d'ici doit pouvoir la saisir
-- quand même, c'est pourquoi les couples des commandes ne pointent PAS cette
-- table par une clé étrangère.

create table if not exists translation_languages (
  code    text primary key check (code ~ '^[a-z]{2,3}$'),
  name_fr text not null,
  name_en text not null,
  name_ar text not null,
  -- L'arabe s'écrit de droite à gauche : l'écran en a besoin pour poser le
  -- sens du texte, sinon un nom arabe s'affiche à l'envers dans une liste.
  rtl     boolean not null default false,
  active  boolean not null default true
);

comment on table translation_languages is
  'Les langues proposées à l''écran. Aucune commande n''y est attachée par clé étrangère : une agence qui traduit vers le russe ne doit pas être bloquée par un référentiel.';

-- On ne sème que ce dont on est sûr dans les trois langues. Une langue de plus
-- mal nommée vaut moins qu'une langue de moins.
insert into translation_languages (code, name_fr, name_en, name_ar, rtl) values
  ('fr', 'Français', 'French',   'الفرنسية',   false),
  ('ar', 'Arabe',    'Arabic',   'العربية',    true),
  ('en', 'Anglais',  'English',  'الإنجليزية', false),
  ('it', 'Italien',  'Italian',  'الإيطالية',  false),
  ('de', 'Allemand', 'German',   'الألمانية',  false),
  ('es', 'Espagnol', 'Spanish',  'الإسبانية',  false),
  ('tr', 'Turc',     'Turkish',  'التركية',    false),
  ('zh', 'Chinois',  'Chinese',  'الصينية',    false)
on conflict (code) do update set
  name_fr = excluded.name_fr, name_en = excluded.name_en,
  name_ar = excluded.name_ar, rtl = excluded.rtl;

-- ------------------------------------------------------------------
-- 2 · Les traducteurs de l'agence
-- ------------------------------------------------------------------

create table if not exists translators (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  -- Vide veut dire « toute l'agence ». Un traducteur ne se range dans un
  -- bureau que si l'agence le veut : la plupart travaillent pour tous.
  office_id      uuid references offices on delete set null,
  name           text not null,
  kind           text not null default 'externe'
                 check (kind in ('interne','externe','bureau')),
  -- Assermenté ou non. C'est l'agence qui coche, sur ce qu'elle sait de son
  -- traducteur : le logiciel ne vérifie aucune inscription et n'en a pas les
  -- moyens.
  sworn          boolean not null default false,
  -- La cour d'appel de rattachement, en texte libre et SANS LISTE. On ne sait
  -- pas quelle cour assermente qui, et une liste fausse enverrait l'agent au
  -- mauvais guichet.
  sworn_court    text,
  -- Les couples traités, forme « fr>ar ».
  languages      text[] not null default '{}',
  phone          text,
  email          text,
  address        text,
  -- LE TARIF EST SAISI PAR L'AGENCE. Aucun prix à la page n'est livré : il se
  -- négocie au traducteur, il n'est publié nulle part, et un chiffre inventé
  -- ici ferait facturer faux tous les jours.
  rate_per_page  numeric(12,2) check (rate_per_page is null or rate_per_page >= 0),
  rate_currency  char(3),
  -- Le délai que le traducteur ANNONCE. Le délai constaté se lit ailleurs,
  -- dans translator_stats, sur les dates réellement enregistrées.
  lead_time_days int check (lead_time_days is null or lead_time_days >= 0),
  active         boolean not null default true,
  note           text,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint translators_languages_form check (
    array_to_string(languages, ' ') ~ '^([a-z]{2,3}>[a-z]{2,3})?( [a-z]{2,3}>[a-z]{2,3})*$'
  )
);
create index if not exists translators_agency on translators (agency_id, name) where deleted_at is null;
create index if not exists translators_active on translators (agency_id) where active and deleted_at is null;

comment on table translators is
  'Le répertoire des traducteurs de l''agence. Aucun traducteur n''est livré avec le produit : une liste toute faite enverrait l''agent au mauvais numéro.';
comment on column translators.rate_per_page is
  'Le prix à la page convenu avec ce traducteur. Saisi par l''agence, jamais fourni.';

-- ------------------------------------------------------------------
-- 3 · Les traductions confiées
-- ------------------------------------------------------------------
--
-- Une traduction porte sur UNE pièce du dossier. `document_id` pointe
-- `case_documents` sans clé étrangère : `document_kind` dit de quelle famille
-- de pièces il s'agit, comme le fait déjà `document_versions` en 0050. Poser
-- une clé étrangère fermerait la porte aux pièces de cargaison.

create table if not exists translation_orders (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  office_id      uuid references offices on delete set null,
  case_id        uuid references cases on delete cascade,
  client_id      uuid references clients on delete set null,
  -- uuid nu, voir plus haut. Il pointe case_documents.
  document_id    uuid,
  document_kind  text not null default 'case' check (document_kind in ('case','shipment')),
  order_number   text not null,
  translator_id  uuid references translators on delete set null,
  source_lang    text check (source_lang is null or source_lang ~ '^[a-z]{2,3}$'),
  target_lang    text check (target_lang is null or target_lang ~ '^[a-z]{2,3}$'),
  -- Coché par l'agence quand le consulat attend une traduction assermentée.
  sworn_required boolean not null default false,
  pages          int check (pages is null or pages >= 0),
  words          int check (words is null or words >= 0),
  status         text not null default 'a_commander'
                 check (status in ('a_commander','commandee','en_cours','livree','remise_client','annulee')),
  -- Les quatre dates du carnet. Elles sont enregistrées, jamais estimées :
  -- c'est sur elles seules que se calculent le retard et le délai constaté.
  ordered_at     timestamptz,
  promised_at    timestamptz,
  delivered_at   timestamptz,
  handed_at      timestamptz,
  -- Ce que l'agence vend au client, et ce que le traducteur lui coûte.
  sold_amount    numeric(14,2) check (sold_amount is null or sold_amount >= 0),
  cost_amount    numeric(14,2) check (cost_amount is null or cost_amount >= 0),
  currency       char(3) not null default 'TND',
  -- Le taux vers la devise de l'agence, au jour où la traduction est confiée.
  -- Le recalculer plus tard au cours courant réécrirait l'histoire.
  fx_rate        numeric(14,6) not null default 1 check (fx_rate > 0),
  -- La marge ne se saisit pas. Colonne générée : le navigateur ne peut pas
  -- l'écrire, même en trichant sur la requête.
  margin         numeric(14,2) generated always as
                 (coalesce(sold_amount, 0) - coalesce(cost_amount, 0)) stored,
  source_path    text,
  translated_path text,
  note           text,
  created_by     uuid references profiles on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (agency_id, order_number)
);
create index if not exists translation_orders_agency on translation_orders (agency_id, status) where deleted_at is null;
create index if not exists translation_orders_case on translation_orders (case_id) where deleted_at is null;
create index if not exists translation_orders_translator on translation_orders (translator_id) where deleted_at is null;
create index if not exists translation_orders_document on translation_orders (document_id) where deleted_at is null;
create index if not exists translation_orders_promised on translation_orders (agency_id, promised_at)
  where deleted_at is null and delivered_at is null;

comment on table translation_orders is
  'Le carnet des traductions confiées. Aucun message ne part d''ici : l''agence confie par téléphone ou WhatsApp, et note ce qu''elle a confié.';
comment on column translation_orders.margin is
  'Prix vendu moins coût du traducteur, calculé par la base. Une marge saisie à la main est le premier chiffre qu''on arrange.';
comment on column translation_orders.document_id is
  'La pièce du dossier traduite. uuid nu : document_kind dit de quelle famille de pièces il s''agit, comme document_versions en 0050.';

-- Le numéro est posé par le serveur, sous verrou. Le calculer dans le
-- navigateur donnerait deux fois le même numéro le jour où deux postes
-- confient une traduction à la même seconde.
create or replace function translation_set_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare y int := extract(year from now())::int; n int;
begin
  if new.order_number is null or btrim(new.order_number) = '' then
    perform pg_advisory_xact_lock(hashtextextended('traduction:' || new.agency_id::text, 0));
    select coalesce(max(nullif(regexp_replace(order_number, '^.*-', ''), '')::int), 0) + 1
      into n
      from translation_orders
     where agency_id = new.agency_id and order_number like 'TRA-' || y || '-%';
    new.order_number := 'TRA-' || y || '-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists translation_orders_number on translation_orders;
create trigger translation_orders_number before insert on translation_orders
  for each row execute function translation_set_number();

create or replace function translation_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists translation_orders_touch on translation_orders;
create trigger translation_orders_touch before update on translation_orders
  for each row execute function translation_touch();

-- ------------------------------------------------------------------
-- 4 · Le raccordement à la pièce du dossier
-- ------------------------------------------------------------------
--
-- La liste des pièces existe déjà, avec son état par pièce. On ne pose pas un
-- second système de documents à côté : on marque la pièce qui a besoin d'une
-- traduction, et on garde le lien vers son suivi.

alter table case_documents add column if not exists needs_translation boolean not null default false;
alter table case_documents add column if not exists translation_order_id uuid;

comment on column case_documents.needs_translation is
  'Cette pièce doit être traduite pour le consulat. Coché par l''agence.';
comment on column case_documents.translation_order_id is
  'Le suivi de traduction de cette pièce. uuid nu, sans clé étrangère croisée : les deux modules restent indépendants.';

-- ------------------------------------------------------------------
-- 5 · Confier une traduction
-- ------------------------------------------------------------------
--
-- L'écran dit « Confier la traduction ». Cette fonction n'envoie rien : elle
-- inscrit au carnet ce que l'agence vient de confier de vive voix.
--
-- Le COÛT descend du tarif du traducteur multiplié par le nombre de pages :
-- c'est le calcul que l'agent fait de tête aujourd'hui, et qu'il se trompe une
-- fois sur dix. Le PRIX DE VENTE reste à la saisie : il se négocie au client,
-- aucun barème ne le donne.
--
-- Trois refus, et pourquoi :
--   · un traducteur d'une autre agence : le cloisonnement ne se contourne pas ;
--   · un traducteur retiré du répertoire : on ne confie pas à quelqu'un qu'on
--     a rangé, c'est le genre d'erreur qui coûte trois semaines ;
--   · un traducteur non assermenté quand l'agence a coché « assermentation
--     exigée ». Ce dernier refus est une GARDE DE COHÉRENCE DE SAISIE, pas une
--     règle de droit : le logiciel ne dit pas ce que le consulat exige, il
--     empêche seulement de contredire ce que l'agence a elle-même coché.

create or replace function translation_order_place(
  p_translator     uuid,
  p_source_lang    text default null,
  p_target_lang    text default null,
  p_case           uuid default null,
  p_document       uuid default null,
  p_client         uuid default null,
  p_sworn_required boolean default false,
  p_pages          int default 1,
  p_words          int default null,
  p_sold_amount    numeric default null,
  p_currency       char(3) default null,
  p_promised_at    timestamptz default null,
  p_source_path    text default null,
  p_note           text default null
) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  a uuid := auth_agency_id();
  tr translators;
  v_case cases;
  v_office uuid;
  v_client uuid := p_client;
  v_cost numeric;
  v_currency char(3);
  v_promised timestamptz := p_promised_at;
  v_id uuid;
begin
  if a is null or not auth_can('case:write') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;

  select * into tr from translators where id = p_translator and deleted_at is null;
  if tr.id is null then
    raise exception 'traducteur inconnu' using errcode = 'P0002';
  end if;
  if tr.agency_id <> a then
    raise exception 'traducteur d''une autre agence' using errcode = '42501';
  end if;
  if not tr.active then
    raise exception 'traducteur retiré du répertoire' using errcode = 'P0001';
  end if;
  if p_sworn_required and not tr.sworn then
    raise exception 'traduction assermentée exigée : ce traducteur ne l''est pas' using errcode = 'P0001';
  end if;

  if p_case is not null then
    select * into v_case from cases where id = p_case and agency_id = a;
    if v_case.id is null then
      raise exception 'dossier inconnu' using errcode = 'P0002';
    end if;
    if not auth_sees_office(v_case.office_id) then
      raise exception 'dossier hors périmètre' using errcode = '42501';
    end if;
    v_office := v_case.office_id;
    v_client := coalesce(v_client, v_case.client_id);
  end if;
  v_office := coalesce(v_office, tr.office_id, auth_office_id());

  -- La pièce doit appartenir au dossier : une traduction rattachée à la pièce
  -- d'un autre dossier est invisible là où on la cherche.
  if p_document is not null and p_case is not null then
    if not exists (select 1 from case_documents d
                    where d.id = p_document and d.case_id = p_case and d.agency_id = a) then
      raise exception 'cette pièce n''appartient pas à ce dossier' using errcode = 'P0001';
    end if;
  end if;

  v_currency := coalesce(p_currency, tr.rate_currency, (select currency from agencies where id = a), 'TND');

  -- Sans tarif saisi, il n'y a pas de coût : on laisse vide plutôt que d'écrire
  -- zéro, qui ferait croire à une traduction gratuite.
  if tr.rate_per_page is not null and p_pages is not null then
    v_cost := round(tr.rate_per_page * p_pages, 2);
  end if;

  if v_promised is null and tr.lead_time_days is not null then
    v_promised := now() + make_interval(days => tr.lead_time_days);
  end if;

  insert into translation_orders (
    agency_id, office_id, case_id, client_id, document_id, document_kind,
    order_number, translator_id, source_lang, target_lang, sworn_required,
    pages, words, status, ordered_at, promised_at,
    sold_amount, cost_amount, currency, source_path, note, created_by)
  values (
    a, v_office, p_case, v_client, p_document, 'case',
    null, p_translator, p_source_lang, p_target_lang, coalesce(p_sworn_required, false),
    p_pages, p_words, 'commandee', now(), v_promised,
    p_sold_amount, v_cost, v_currency, p_source_path, p_note, auth.uid())
  returning id into v_id;

  -- La pièce du dossier porte le lien : c'est là que l'agent la cherche.
  if p_document is not null then
    update case_documents
       set needs_translation = true, translation_order_id = v_id
     where id = p_document and agency_id = a;
  end if;

  return v_id;
end $$;

-- ------------------------------------------------------------------
-- 6 · Enregistrer la traduction reçue
-- ------------------------------------------------------------------
--
-- POURQUOI LA TRADUCTION VIT AVEC LA PIÈCE D'ORIGINE, ET NON À CÔTÉ.
--
-- Le consulat reçoit l'acte de naissance ET sa traduction comme une seule
-- pièce du dossier. Rangée à part, la traduction devient un fichier orphelin :
-- on ne sait plus de quel document elle est la traduction, ni si c'est la
-- version qu'on a déposée. L'historique des versions existe déjà (0050) et il
-- est en ajout seul. Une traduction livrée est donc une version de plus de la
-- même pièce, datée et signée, et le jour où le consulat conteste, la suite se
-- lit dans l'ordre.
--
-- On teste `document_version_add` avec to_regprocedure : si le module de
-- sécurité n'est pas installé, on garde le chemin et on n'échoue pas.

create or replace function translation_deliver(p_order uuid, p_path text)
returns int
language plpgsql security definer set search_path = public, auth as $$
declare
  a uuid := auth_agency_id();
  o translation_orders;
  v_version int;
begin
  if a is null or not auth_can('case:write') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;

  select * into o from translation_orders
   where id = p_order and agency_id = a and deleted_at is null;
  if o.id is null then
    raise exception 'traduction inconnue' using errcode = 'P0002';
  end if;
  if not auth_sees_office(o.office_id) then
    raise exception 'traduction hors périmètre' using errcode = '42501';
  end if;
  if o.status = 'annulee' then
    raise exception 'traduction annulée' using errcode = 'P0001';
  end if;

  update translation_orders
     set translated_path = p_path,
         delivered_at = coalesce(delivered_at, now()),
         status = 'livree'
   where id = p_order;

  if o.document_id is not null and p_path is not null
     and to_regprocedure('document_version_add(uuid, text, text, text, bigint, text)') is not null then
    execute 'select document_version_add($1, $2, $3, null, null, null)'
      into v_version using o.document_id, o.document_kind, p_path;
  end if;

  return v_version;
end $$;

-- ------------------------------------------------------------------
-- 7 · Ce qui traîne
-- ------------------------------------------------------------------
--
-- L'écran qui évite qu'un dossier dorme trois semaines chez un traducteur.
-- Le retard se compte sur la date promise ENREGISTRÉE : sans date promise, il
-- n'y a pas de retard, et on n'en invente pas.

create or replace function translation_late(p_office uuid default null)
returns table (
  order_id uuid, order_number text, case_id uuid, document_id uuid,
  translator_id uuid, translator_name text,
  source_lang text, target_lang text,
  promised_at timestamptz, days_late int, status text
)
language plpgsql stable security definer set search_path = public, auth as $$
declare a uuid := auth_agency_id();
begin
  if a is null or not auth_can('case:read') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  if not auth_sees_office(p_office) then
    raise exception 'bureau hors périmètre' using errcode = '42501';
  end if;

  return query
    select o.id, o.order_number, o.case_id, o.document_id,
           o.translator_id, t.name,
           o.source_lang, o.target_lang,
           o.promised_at,
           floor(extract(epoch from (now() - o.promised_at)) / 86400)::int,
           o.status
      from translation_orders o
      left join translators t on t.id = o.translator_id
     where o.agency_id = a
       and o.deleted_at is null
       and o.status not in ('livree','remise_client','annulee')
       and o.promised_at is not null
       and o.promised_at < now()
       and (p_office is null or o.office_id = p_office)
       and auth_sees_office(o.office_id)
     order by o.promised_at;
end $$;

-- ------------------------------------------------------------------
-- 8 · La marge par traducteur et par couple de langues
-- ------------------------------------------------------------------
--
-- Réservée à finance:global, comme les dépenses en 0045 : c'est un coût de
-- revient. On groupe aussi par devise : additionner des dinars et des euros
-- donnerait un total qui ne veut rien dire.

create or replace function translation_margin_report(
  p_office uuid default null, p_from date default null, p_to date default null)
returns table (
  translator_id uuid, translator_name text,
  source_lang text, target_lang text, currency char(3),
  orders int, pages int, sold numeric, cost numeric, margin numeric
)
language plpgsql stable security definer set search_path = public, auth as $$
declare
  a uuid := auth_agency_id();
  d1 date := coalesce(p_from, current_date - 365);
  d2 date := coalesce(p_to, current_date);
begin
  if a is null or not auth_can('finance:global') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  if not auth_sees_office(p_office) then
    raise exception 'bureau hors périmètre' using errcode = '42501';
  end if;

  return query
    select o.translator_id, max(t.name), o.source_lang, o.target_lang, o.currency,
           count(*)::int,
           coalesce(sum(o.pages), 0)::int,
           coalesce(sum(o.sold_amount), 0),
           coalesce(sum(o.cost_amount), 0),
           coalesce(sum(o.margin), 0)
      from translation_orders o
      left join translators t on t.id = o.translator_id
     where o.agency_id = a
       and o.deleted_at is null
       and o.status <> 'annulee'
       and coalesce(o.ordered_at, o.created_at)::date between d1 and d2
       and (p_office is null or o.office_id = p_office)
       and auth_sees_office(o.office_id)
     group by o.translator_id, o.source_lang, o.target_lang, o.currency
     order by coalesce(sum(o.margin), 0) desc;
end $$;

-- ------------------------------------------------------------------
-- 9 · Les chiffres d'un traducteur
-- ------------------------------------------------------------------
--
-- DES CHIFFRES BRUTS, AUCUN SCORE. Pas de note, pas d'étoiles, pas d'indice
-- de fiabilité. Un score sur une personne se retient à la place des faits, et
-- il se trompe : trois retards sur trois commandes ne font pas un mauvais
-- traducteur, ils font trois commandes. Chaque chiffre porte donc sa taille
-- d'échantillon, et tout est calculé sur les DATES RÉELLEMENT ENREGISTRÉES,
-- jamais sur le délai annoncé.

create or replace function translator_stats(p_translator uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  a uuid := auth_agency_id();
  tr translators;
  v_orders int; v_delivered int; v_measured int; v_late int; v_avg numeric;
  v_margin numeric; v_margin_n int; v_currency char(3);
  result jsonb;
begin
  if a is null or not auth_can('case:read') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  select * into tr from translators where id = p_translator and agency_id = a;
  if tr.id is null then
    raise exception 'traducteur inconnu' using errcode = 'P0002';
  end if;

  select count(*) filter (where o.status <> 'annulee'),
         count(*) filter (where o.delivered_at is not null),
         count(*) filter (where o.delivered_at is not null and o.promised_at is not null),
         count(*) filter (where o.delivered_at is not null and o.promised_at is not null
                            and o.delivered_at > o.promised_at),
         avg(extract(epoch from (o.delivered_at - o.ordered_at)) / 86400)
           filter (where o.delivered_at is not null and o.ordered_at is not null)
    into v_orders, v_delivered, v_measured, v_late, v_avg
    from translation_orders o
   where o.translator_id = p_translator and o.agency_id = a and o.deleted_at is null;

  result := jsonb_build_object(
    'translator_id', p_translator,
    'name', tr.name,
    'orders', coalesce(v_orders, 0),
    'delivered', coalesce(v_delivered, 0),
    -- Le délai moyen constaté, en jours. Vide tant que rien n'est livré : une
    -- moyenne sur zéro livraison n'existe pas.
    'avg_days', case when v_delivered > 0 then round(v_avg, 1) end,
    'avg_days_on', coalesce(v_delivered, 0),
    'late', coalesce(v_late, 0),
    -- Le taux de retard ne se calcule que sur les commandes qui avaient une
    -- date promise. Les autres ne sont ni à l'heure ni en retard.
    'late_on', coalesce(v_measured, 0),
    'late_rate', case when v_measured > 0 then round(v_late * 100.0 / v_measured, 1) end);

  -- La marge est un coût de revient : elle reste à la direction.
  if auth_can('finance:global') then
    select avg(o.margin), count(*), max(o.currency)
      into v_margin, v_margin_n, v_currency
      from translation_orders o
     where o.translator_id = p_translator and o.agency_id = a and o.deleted_at is null
       and o.status <> 'annulee' and o.sold_amount is not null and o.cost_amount is not null;
    result := result || jsonb_build_object(
      'avg_margin', case when v_margin_n > 0 then round(v_margin, 2) end,
      'avg_margin_on', coalesce(v_margin_n, 0),
      'currency', v_currency);
  end if;

  return result;
end $$;

-- ------------------------------------------------------------------
-- 10 · Ce que le dossier affiche
-- ------------------------------------------------------------------
--
-- Le résumé est en tête, parce que la barre de progression du dossier le lit
-- pour cocher l'étape « Traductions ». Sans pièce à traduire, l'étape est
-- franchie : il n'y a rien à attendre.

create or replace function case_translations(p_case uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  a uuid := auth_agency_id();
  v_total int; v_livrees int; v_retard int; items jsonb;
begin
  if a is null or not auth_can('case:read') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  if not exists (select 1 from cases c
                  where c.id = p_case and c.agency_id = a and auth_sees_office(c.office_id)) then
    raise exception 'dossier inconnu' using errcode = 'P0002';
  end if;

  select count(*)::int,
         count(*) filter (where o.status in ('livree','remise_client'))::int,
         count(*) filter (where o.id is not null and o.delivered_at is null
                            and o.status <> 'annulee'
                            and o.promised_at is not null and o.promised_at < now())::int
    into v_total, v_livrees, v_retard
    from case_documents d
    left join translation_orders o
      on o.id = d.translation_order_id and o.deleted_at is null
   where d.case_id = p_case
     and (d.needs_translation or d.translation_order_id is not null);

  select coalesce(jsonb_agg(x order by x->>'key'), '[]'::jsonb) into items from (
    select jsonb_build_object(
      'document_id', d.id,
      'key', d.key,
      'label', d.label,
      'state', d.state,
      'needs_translation', d.needs_translation,
      'order', case when o.id is null then null else jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'translator_id', o.translator_id,
        'translator_name', t.name,
        'source_lang', o.source_lang,
        'target_lang', o.target_lang,
        'sworn_required', o.sworn_required,
        'pages', o.pages,
        'ordered_at', o.ordered_at,
        'promised_at', o.promised_at,
        'delivered_at', o.delivered_at,
        'handed_at', o.handed_at,
        -- Le prix vendu au client se lit ici, le coût et la marge non : ils
        -- ne sortent que par les fonctions réservées à finance:global.
        'sold_amount', o.sold_amount,
        'currency', o.currency,
        'translated_path', o.translated_path,
        'late', o.delivered_at is null and o.status <> 'annulee'
                and o.promised_at is not null and o.promised_at < now()
      ) end) as x
      from case_documents d
      left join translation_orders o
        on o.id = d.translation_order_id and o.deleted_at is null
      left join translators t on t.id = o.translator_id
     where d.case_id = p_case
       and (d.needs_translation or d.translation_order_id is not null)
  ) s;

  return jsonb_build_object(
    'total', coalesce(v_total, 0),
    'livrees', coalesce(v_livrees, 0),
    'en_retard', coalesce(v_retard, 0),
    'toutes_livrees', coalesce(v_livrees, 0) >= coalesce(v_total, 0),
    'pieces', items);
end $$;

-- Le coût et la marge d'une traduction, pour l'écran de la direction. Ils ne
-- sortent pas de la table : les colonnes sont fermées à tout le monde (voir
-- plus bas), et cette porte-là vérifie le droit.
create or replace function translation_costs(p_order uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare a uuid := auth_agency_id(); o translation_orders;
begin
  if a is null or not auth_can('finance:global') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  select * into o from translation_orders where id = p_order and agency_id = a and deleted_at is null;
  if o.id is null then
    raise exception 'traduction inconnue' using errcode = 'P0002';
  end if;
  if not auth_sees_office(o.office_id) then
    raise exception 'traduction hors périmètre' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'sold_amount', o.sold_amount, 'cost_amount', o.cost_amount,
    'margin', o.margin, 'currency', o.currency, 'fx_rate', o.fx_rate);
end $$;

-- ------------------------------------------------------------------
-- 11 · Le cloisonnement
-- ------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['translators','translation_orders','translation_languages'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- Le référentiel des langues se lit par tous les comptes connectés : un écran
-- doit pouvoir nommer une langue. Il ne s'écrit que par la plateforme, comme
-- le catalogue des capacités en 0044 : une agence qui inventerait un code de
-- langue le rendrait faux pour toutes les autres.
drop policy if exists translation_languages_select on translation_languages;
drop policy if exists translation_languages_insert on translation_languages;
drop policy if exists translation_languages_update on translation_languages;
drop policy if exists translation_languages_delete on translation_languages;

create policy translation_languages_select on translation_languages for select to authenticated
  using (true);
create policy translation_languages_insert on translation_languages for insert to authenticated
  with check (is_platform_admin());
create policy translation_languages_update on translation_languages for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());
create policy translation_languages_delete on translation_languages for delete to authenticated
  using (is_platform_admin());

drop policy if exists translators_select on translators;
drop policy if exists translators_insert on translators;
drop policy if exists translators_update on translators;
drop policy if exists translators_platform_read on translators;

-- L'agent lit le répertoire : c'est lui qui choisit le traducteur. Il ne
-- l'écrit pas, comme il n'écrit pas le catalogue de services.
create policy translators_select on translators for select to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('case:read'));
create policy translators_insert on translators for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('settings:manage'));
create policy translators_update on translators for update to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('settings:manage'))
  with check (agency_id = auth_agency_id());
create policy translators_platform_read on translators for select to authenticated
  using (is_platform_admin());

drop policy if exists translation_orders_select on translation_orders;
drop policy if exists translation_orders_insert on translation_orders;
drop policy if exists translation_orders_update on translation_orders;
drop policy if exists translation_orders_platform_read on translation_orders;

create policy translation_orders_select on translation_orders for select to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('case:read'));
create policy translation_orders_insert on translation_orders for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('case:write'));
create policy translation_orders_update on translation_orders for update to authenticated
  using (agency_id = auth_agency_id() and auth_sees_office(office_id) and auth_can('case:write'))
  with check (agency_id = auth_agency_id());
create policy translation_orders_platform_read on translation_orders for select to authenticated
  using (is_platform_admin());

-- ------------------------------------------------------------------
-- 12 · Les droits, repris à la main
-- ------------------------------------------------------------------
--
-- 0015 a posé un `alter default privileges` qui accorde SELECT, INSERT, UPDATE
-- et DELETE à `authenticated` sur toute table créée ensuite. Personne ne
-- l'écrit, personne ne le voit, et trois modules s'y sont fait prendre : sans
-- cette reprise, la règle « aucune suppression dure » ne tiendrait pas.

do $$
declare t text;
begin
  foreach t in array array['translators','translation_orders','translation_languages'] loop
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

grant select, insert, update on translators to authenticated;
grant select on translation_languages to authenticated;
-- La plateforme écrit le référentiel par la clé de service ; les politiques
-- ci-dessus gardent la porte pour le cas où un administrateur passe par là.
grant insert, update, delete on translation_languages to authenticated;

-- UN AGENT CONFIE UNE TRADUCTION SANS VOIR LA MARGE.
--
-- La politique de lecture est au niveau de la LIGNE : elle ne sait pas cacher
-- trois colonnes à l'un et les montrer à l'autre. C'est donc le droit sur les
-- COLONNES qui ferme le coût, la marge et le taux de change, pour tout le
-- monde et sans exception. Qui a `finance:global` les lit par
-- `translation_costs`, `translation_margin_report` et `translator_stats`, qui
-- vérifient le droit. Le prix vendu, lui, reste lisible : c'est ce que le
-- client paie, l'agent le facture.
grant select (
  id, agency_id, office_id, case_id, client_id, document_id, document_kind,
  order_number, translator_id, source_lang, target_lang, sworn_required,
  pages, words, status, ordered_at, promised_at, delivered_at, handed_at,
  sold_amount, currency, source_path, translated_path, note,
  created_by, created_at, updated_at, deleted_at
) on translation_orders to authenticated;

-- L'écriture directe sert au suivi au quotidien : l'état, les dates, le prix
-- vendu, la note, et le rangement. Le coût et le taux ne s'écrivent que par
-- `translation_order_place`, qui les calcule.
grant insert (
  agency_id, office_id, case_id, client_id, document_id, document_kind,
  order_number, translator_id, source_lang, target_lang, sworn_required,
  pages, words, status, ordered_at, promised_at,
  sold_amount, currency, source_path, note, created_by
) on translation_orders to authenticated;

grant update (
  status, promised_at, handed_at, delivered_at, sold_amount, pages, words,
  source_lang, target_lang, sworn_required, translator_id,
  source_path, note, deleted_at
) on translation_orders to authenticated;

-- Aucune suppression dure : `deleted_at`, et rien d'autre.
revoke delete, truncate on translators, translation_orders from authenticated;
revoke truncate on translation_languages from authenticated;

-- ------------------------------------------------------------------
-- 13 · Les fonctions
-- ------------------------------------------------------------------

revoke all on function translation_order_place(uuid, text, text, uuid, uuid, uuid, boolean, int, int, numeric, char, timestamptz, text, text) from public, anon;
revoke all on function translation_deliver(uuid, text) from public, anon;
revoke all on function translation_late(uuid) from public, anon;
revoke all on function translation_margin_report(uuid, date, date) from public, anon;
revoke all on function translator_stats(uuid) from public, anon;
revoke all on function case_translations(uuid) from public, anon;
revoke all on function translation_costs(uuid) from public, anon;

grant execute on function translation_order_place(uuid, text, text, uuid, uuid, uuid, boolean, int, int, numeric, char, timestamptz, text, text) to authenticated;
grant execute on function translation_deliver(uuid, text) to authenticated;
grant execute on function translation_late(uuid) to authenticated;
grant execute on function translation_margin_report(uuid, date, date) to authenticated;
grant execute on function translator_stats(uuid) to authenticated;
grant execute on function case_translations(uuid) to authenticated;
grant execute on function translation_costs(uuid) to authenticated;

-- ------------------------------------------------------------------
-- 14 · Le piège des fonctions de déclencheur
-- ------------------------------------------------------------------
--
-- PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction nouvellement créée.
-- Pour une fonction de déclencheur, personne ne le remarque : elle s'appelle
-- toute seule. Mais elle reste appelable par un anonyme, et une fonction
-- SECURITY DEFINER appelable par un anonyme est une porte ouverte. On ferme
-- pour tout le schéma, comme à la fin de 0044.
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
