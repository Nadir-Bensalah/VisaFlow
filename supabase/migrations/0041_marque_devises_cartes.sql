-- 0041 · La marque de l'agence, ses devises, et l'encaissement par carte.
--
-- ============================================================================
-- LA RÈGLE QUI COMMANDE TOUT LE RESTE DE CE FICHIER
-- ============================================================================
--
-- VisaFlow n'encaisse JAMAIS l'argent des clients d'une agence. Jamais un
-- dinar, jamais un dollar, jamais une seconde. Ce n'est pas une préférence
-- d'architecture, c'est la seule position légale possible :
--
--   · Encaisser pour le compte d'autrui puis reverser, c'est fournir un service
--     de paiement. En Tunisie, cela suppose un agrément de la Banque centrale.
--   · Les fonds de Paymee ont été gelés par la CTAF en février 2023 pour
--     exactement cela.
--
-- Conséquence sur ce que ce fichier modélise : chaque agence branche SON PROPRE
-- compte chez SON prestataire. VisaFlow fabrique le lien de paiement avec les
-- identifiants de l'agence, enregistre ce que le prestataire répond, et n'est à
-- aucun moment sur le chemin de l'argent. La banque paie l'agence directement.
--
-- Sur Stripe, puisque la question se pose : Stripe Connect sait très bien faire
-- une plateforme multi-agences, c'est même son objet. Mais un compte connecté
-- doit résider dans un pays couvert, et NI LA TUNISIE NI LA LIBYE ne le sont.
-- Stripe reste donc utilisable par une agence qui possède une entité dans un
-- pays couvert, et par elle seule. Le modèle ci-dessous ne privilégie donc
-- aucun prestataire : il accueille celui que l'agence a déjà.
--
-- Aucun secret de prestataire n'est stocké ici. On garde le NOM d'un secret
-- dans le coffre, jamais sa valeur, exactement comme pour WhatsApp.

-- ------------------------------------------------------------------
-- 1 · La marque de l'agence
-- ------------------------------------------------------------------

-- Le logo vit dans un seau à part, lisible sans session : il s'affiche sur la
-- page publique et dans le suivi client, où personne n'est connecté.
insert into storage.buckets (id, name, public)
values ('marques', 'marques', true)
on conflict (id) do update set public = true;

alter table agencies add column if not exists logo_path text;
-- La couleur de la barre latérale, distincte de la couleur d'accent : l'une
-- habille le meuble, l'autre signale l'action.
alter table agencies add column if not exists sidebar_color text
  check (sidebar_color is null or sidebar_color ~ '^#[0-9a-fA-F]{6}$');
alter table agencies add column if not exists accent_color text
  check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$');
-- Le titre affiché, quand il diffère de la raison sociale.
alter table agencies add column if not exists display_name text;

comment on column agencies.logo_path is
  'Chemin du logo dans le seau « marques », public : il s''affiche sur la page publique et le suivi client, où personne n''est connecté.';
comment on column agencies.sidebar_color is
  'Couleur de la barre latérale. Le contraste du texte est calculé, jamais demandé : une agence ne doit pas avoir à choisir aussi la couleur de son texte.';

-- ------------------------------------------------------------------
-- 2 · Les devises acceptées
-- ------------------------------------------------------------------
--
-- `currency` reste la devise de REFERENCE, celle des rapports et des totaux.
-- `currencies` est ce que l'agence accepte d'encaisser. Un client libyen paie
-- volontiers en dollars ; une agence tunisienne tient ses comptes en dinars.

alter table agencies add column if not exists currencies text[] not null default '{}';

comment on column agencies.currencies is
  'Devises acceptées à l''encaissement. La colonne `currency` reste la devise de référence, celle des totaux et des rapports.';

-- Toute agence accepte au moins sa propre devise : sans cela, l'écran de
-- paiement n'offrirait rien du tout.
update agencies
   set currencies = array[currency]
 where currencies = '{}' and currency is not null;

/*
 * Le taux appliqué à un encaissement en devise.
 *
 * On ne va PAS chercher un taux sur internet : celui qui compte est celui que
 * la banque de l'agence a réellement appliqué, et il n'est connu qu'après. Le
 * champ est donc saisi, avec sa date, et la conversion affichée porte la
 * mention de ce taux. Inventer un taux de marché ferait des totaux faux.
 */
create or replace function payment_in_base(p_amount numeric, p_fx numeric)
returns numeric language sql immutable as $$
  select round(coalesce(p_amount, 0) * coalesce(nullif(p_fx, 0), 1), 3)
$$;

-- ------------------------------------------------------------------
-- 3 · Les moyens d'encaissement de l'agence
-- ------------------------------------------------------------------

create table if not exists payment_providers (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  -- Les prestataires réellement disponibles sur la zone, plus « autre » pour
  -- ne bloquer personne. Aucun n'est privilégié : c'est le compte que l'agence
  -- possède déjà qui décide.
  kind         text not null check (kind in (
                 'clictopay','paymee','konnect','flouci',   -- Tunisie
                 'sadad','moamalat',                        -- Libye
                 'stripe','adyen','paypal',                 -- hors zone, si l'agence a une entité couverte
                 'virement','cheque','especes','autre')),
  label        text not null,
  -- Ce que ce moyen accepte. Une carte tunisienne ne débite pas des dollars.
  currencies   text[] not null default '{}',
  -- L'identifiant PUBLIC du commerçant chez son prestataire. Jamais un secret.
  merchant_ref text,
  -- Le NOM du secret dans le coffre, jamais sa valeur. Même règle que WhatsApp.
  secret_name  text,
  mode         text not null default 'test' check (mode in ('test','live')),
  active       boolean not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  unique (agency_id, kind, label)
);
create index if not exists payment_providers_agency on payment_providers (agency_id, active);

comment on table payment_providers is
  'Les moyens d''encaissement de l''agence, avec SON compte chez SON prestataire. VisaFlow fabrique le lien et enregistre la réponse ; l''argent va de la banque à l''agence sans jamais passer par la plateforme. Encaisser pour autrui supposerait un agrément BCT, et les fonds de Paymee ont été gelés par la CTAF en février 2023 pour cela.';
comment on column payment_providers.secret_name is
  'NOM du secret dans le coffre, jamais sa valeur. Une clé de paiement en clair dans une table est une clé perdue.';

-- ------------------------------------------------------------------
-- 4 · Les liens de paiement
-- ------------------------------------------------------------------

create table if not exists payment_links (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  payment_id   uuid not null references payments on delete cascade,
  provider_id  uuid not null references payment_providers on delete restrict,
  amount       numeric(14,2) not null check (amount > 0),
  currency     char(3) not null,
  url          text,
  -- La référence rendue par le prestataire. C'est elle qui permet de
  -- rapprocher, jamais le montant seul.
  external_ref text,
  status       text not null default 'cree'
               check (status in ('cree','ouvert','paye','expire','echoue','annule')),
  created_at   timestamptz not null default now(),
  opened_at    timestamptz,
  paid_at      timestamptz,
  failed_reason text,
  unique (provider_id, external_ref)
);
create index if not exists payment_links_payment on payment_links (payment_id);

comment on table payment_links is
  'Un lien de paiement fabriqué avec le compte de l''agence. VisaFlow enregistre l''état que le prestataire lui renvoie ; il ne reçoit ni ne redistribue aucun fonds.';

-- ------------------------------------------------------------------
-- 5 · Sécurité
-- ------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['payment_providers','payment_links'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

do $$
declare spec record;
begin
  for spec in
    select * from (values
      -- Brancher un compte de paiement est un réglage : cela engage l'argent
      -- de l'agence.
      ('payment_providers', 'settings:manage'),
      ('payment_links',     'payment:write')
    ) as v(tbl, cap)
  loop
    execute format('drop policy if exists %1$s_select on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_insert on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_update on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_delete on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_platform_read on %1$I', spec.tbl);
    execute format($f$
      create policy %1$s_select on %1$I for select to authenticated
        using (agency_id = auth_agency_id() and auth_can('payment:read'))
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
  end loop;
end $$;

-- La vue support de la plateforme lit les LIENS, pour dépanner un paiement qui
-- coince. Elle ne lit PAS les comptes de paiement : le nom du secret d'une
-- agence ne regarde pas l'éditeur.
drop policy if exists payment_links_platform_read on payment_links;
create policy payment_links_platform_read on payment_links for select to authenticated
  using (is_platform_admin());

grant select, insert, update, delete on payment_providers, payment_links to authenticated;
grant all on payment_providers, payment_links to service_role;

-- Le logo : chacun écrit dans son dossier, tout le monde peut lire.
drop policy if exists marques_lecture on storage.objects;
create policy marques_lecture on storage.objects for select
  using (bucket_id = 'marques');

drop policy if exists marques_ecriture on storage.objects;
create policy marques_ecriture on storage.objects for insert to authenticated
  with check (
    bucket_id = 'marques'
    and (storage.foldername(name))[1] = auth_agency_id()::text
    and auth_can('settings:manage')
  );

drop policy if exists marques_maj on storage.objects;
create policy marques_maj on storage.objects for update to authenticated
  using (
    bucket_id = 'marques'
    and (storage.foldername(name))[1] = auth_agency_id()::text
    and auth_can('settings:manage')
  );

drop policy if exists marques_suppression on storage.objects;
create policy marques_suppression on storage.objects for delete to authenticated
  using (
    bucket_id = 'marques'
    and (storage.foldername(name))[1] = auth_agency_id()::text
    and auth_can('settings:manage')
  );

revoke all on function payment_in_base(numeric, numeric) from public, anon;
grant execute on function payment_in_base(numeric, numeric) to authenticated;
