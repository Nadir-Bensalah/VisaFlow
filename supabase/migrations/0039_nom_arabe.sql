-- 0039 · Le nom arabe est la donnée de référence, la version latine une variante.
--
-- Il n'existe aucun standard de translittération des noms arabes en caractères
-- latins. Le problème est reconnu au niveau des ÉTATS : la « correspondance des
-- noms des citoyens entre les deux pays » figure parmi les six conditions de
-- réouverture de Ras Jedir en juin 2024. Le même client revient donc sous trois
-- orthographes, et rapprocher un dossier d'une pièce sur l'égalité stricte des
-- chaînes ne marche pas.
--
-- Trois conséquences, et cette migration les tient :
--
--   B5 · Le nom en arabe est la RÉFÉRENCE. Chaque version latine est une
--        variante, avec sa source : passeport, acte de naissance, réservation
--        d'hôtel, formulaire consulaire. Elles se contredisent, c'est normal.
--   B6 · Le rapprochement se fait sur NUMÉRO DE PASSEPORT plus DATE DE
--        NAISSANCE, jamais sur le nom. Le nom n'est pas une clé.
--   B7 · Le doublon se détecte à la saisie, avant de créer un deuxième dossier
--        pour la même personne.

-- ------------------------------------------------------------------
-- 1 · Les variantes latines d'un même nom
-- ------------------------------------------------------------------

create table if not exists client_name_variants (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references agencies on delete cascade,
  client_id  uuid not null references clients on delete cascade,
  first_name text,
  last_name  text,
  -- D'où vient cette orthographe. C'est ce qui permet de dire « le consulat a
  -- écrit Mohamed, le passeport dit Mohammed », au lieu de choisir au hasard.
  source     text not null default 'saisie'
             check (source in ('passeport','acte_naissance','reservation','formulaire_consulaire','saisie')),
  note       text,
  created_at timestamptz not null default now(),
  unique (client_id, first_name, last_name, source)
);
create index if not exists client_name_variants_client on client_name_variants (client_id);

comment on table client_name_variants is
  'Les orthographes latines d''un même nom arabe, chacune avec sa source. Aucune n''est « la bonne » : elles cohabitent, et le rapprochement ne se fait jamais sur elles.';

-- ------------------------------------------------------------------
-- 2 · Comparer deux noms arabes
-- ------------------------------------------------------------------
--
-- L'arabe s'écrit avec ou sans voyelles, et les formes de l'alef se confondent
-- à la saisie. Comparer sans normaliser fait rater un client sur deux.

create or replace function ar_normalize(p text)
returns text
language sql immutable
set search_path = public
as $$
  select nullif(trim(regexp_replace(
    translate(
      -- Les signes diacritiques (fatha, damma, kasra, sukun, shadda, tanwin)
      -- s'écrivent ou ne s'écrivent pas : ils ne doivent pas départager.
      regexp_replace(coalesce(p, ''), '[ًٌٍَُِّْـ]', '', 'g'),
      -- Alef sous toutes ses formes, ta marbouta, ya finale, hamza portée.
      -- أ إ آ ٱ → ا · ة → ه · ى → ي · ؤ → و · ئ → ي
      'أإآٱةىؤئ',
      'ااااهيوي'
    ),
    '\s+', ' ', 'g')), '')
$$;

comment on function ar_normalize(text) is
  'Normalise un nom arabe pour la comparaison : retire les diacritiques, unifie les formes de l''alef, la ta marbouta et la ya finale. Sans cela, « محمّد » et « محمد » sont deux personnes différentes.';

-- ------------------------------------------------------------------
-- 3 · Le rapprochement, qui ne passe jamais par le nom
-- ------------------------------------------------------------------

create or replace function client_match(
  p_agency uuid, p_passport text, p_birth date
) returns setof clients
language sql stable
set search_path = public
as $$
  -- Passeport ET date de naissance. Le passeport seul se ressaisit de travers,
  -- la date seule est partagée par des milliers de gens.
  select * from clients
  where agency_id = p_agency
    and deleted_at is null
    and p_passport is not null and p_birth is not null
    and upper(replace(passport_number, ' ', '')) = upper(replace(p_passport, ' ', ''))
    and birth_date = p_birth
$$;

/*
 * Les doublons possibles au moment de la saisie.
 *
 * On classe par force de preuve : même passeport ET même date de naissance est
 * une quasi-certitude ; même téléphone est un indice sérieux ; même nom arabe
 * normalisé plus même date de naissance mérite un coup d'œil. Le nom LATIN seul
 * ne figure nulle part : il ne prouve rien, c'est tout le sujet.
 */
create or replace function client_duplicates(
  p_agency uuid,
  p_passport text default null,
  p_birth date default null,
  p_phone text default null,
  p_native text default null,
  p_exclude uuid default null
) returns jsonb
language sql stable
set search_path = public
as $$
  with candidats as (
    select
      c.*,
      -- Le téléphone se compare sur ses huit derniers chiffres : indicatif,
      -- espaces et zéro initial varient d'une saisie à l'autre.
      (p_phone is not null
        and right(regexp_replace(coalesce(c.whatsapp, c.phone), '[^0-9]', '', 'g'), 8)
          = right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 8)) as meme_tel,
      (p_passport is not null and p_birth is not null
        and upper(replace(coalesce(c.passport_number, ''), ' ', '')) = upper(replace(p_passport, ' ', ''))
        and c.birth_date = p_birth) as meme_passeport,
      (p_native is not null and p_birth is not null
        and ar_normalize(c.native_name) is not null
        and ar_normalize(c.native_name) = ar_normalize(p_native)
        and c.birth_date = p_birth) as meme_nom_ar
    from clients c
    where c.agency_id = p_agency
      and c.deleted_at is null
      and (p_exclude is null or c.id <> p_exclude)
  ), classes as (
    select
      id, first_name, last_name, native_name, phone, passport_number, birth_date,
      case when meme_passeport then 1 when meme_tel then 2 else 3 end as rang,
      case when meme_passeport then 'passeport_et_naissance'
           when meme_tel then 'meme_telephone'
           else 'nom_arabe_et_naissance' end as motif
    from candidats
    where meme_passeport or meme_tel or meme_nom_ar
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'client_id', id, 'first_name', first_name, 'last_name', last_name,
    'native_name', native_name, 'phone', phone,
    'passport_number', passport_number, 'birth_date', birth_date,
    'reason', motif, 'rank', rang
  ) order by rang), '[]'::jsonb)
  from (select * from classes order by rang limit 10) x
$$;

-- ------------------------------------------------------------------
-- 4 · Sécurité
-- ------------------------------------------------------------------

alter table client_name_variants enable row level security;
alter table client_name_variants force row level security;

drop policy if exists client_name_variants_select on client_name_variants;
drop policy if exists client_name_variants_insert on client_name_variants;
drop policy if exists client_name_variants_update on client_name_variants;
drop policy if exists client_name_variants_delete on client_name_variants;
drop policy if exists client_name_variants_platform_read on client_name_variants;

create policy client_name_variants_select on client_name_variants for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('case:read'));
create policy client_name_variants_insert on client_name_variants for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('client:write'));
create policy client_name_variants_update on client_name_variants for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('client:write'))
  with check (agency_id = auth_agency_id());
create policy client_name_variants_delete on client_name_variants for delete to authenticated
  using (agency_id = auth_agency_id() and auth_role() in ('owner','manager'));
create policy client_name_variants_platform_read on client_name_variants for select to authenticated
  using (is_platform_admin());

grant select, insert, update, delete on client_name_variants to authenticated;
grant all on client_name_variants to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'ar_normalize(text)',
    'client_match(uuid, text, date)',
    'client_duplicates(uuid, text, date, text, text, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
