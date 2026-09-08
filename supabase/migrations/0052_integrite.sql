-- 0052 · L'intégrité des données.
--
-- Ce lot ne rajoute pas un métier de plus. Il répare ce que le schéma perdait
-- en silence, et c'est toujours la même perte : une donnée qui change sans
-- laisser d'auteur, une donnée qui se corrige au lieu de s'ajouter, une donnée
-- qui existe deux fois sans que personne ne le sache.
--
-- QUATRE PRINCIPES, TENUS PARTOUT DANS CE FICHIER.
--
-- 1. Un historique ne se modifie pas. `status_history` reçoit des insertions et
--    rien d'autre : aucun droit d'update, aucun droit de delete, aucune
--    politique d'update. Un journal qu'on peut réécrire ne prouve rien, et le
--    jour d'un litige avec un consulat c'est la seule pièce qui vaille.
--
-- 2. Un paiement ne se modifie jamais. Un remboursement est un MOUVEMENT DE
--    PLUS, jamais une correction de l'ancien. Corriger le montant encaissé
--    efface la trace de ce que le client a réellement payé, et la caisse du
--    soir ne retombe plus jamais juste.
--
-- 3. Rien ne se supprime. Une annulation est une date et une raison posées sur
--    la ligne, pas un DELETE. Une fusion de clients marque l'absorbé et dit où
--    ses données sont parties.
--
-- 4. Une fusion sans compte rendu est irréversible et invérifiable. C'est
--    pourquoi `client_merge` rend le détail ligne par ligne de ce qui a bougé.
--
-- CE QU'ON NE FAIT PAS, ET POURQUOI.
--
-- Le cahier des charges suggérait deux tables d'historique, une pour les
-- dossiers et une pour les cargaisons. On n'en fait qu'une. Deux tables
-- jumelles, ce sont deux jeux de politiques, deux jeux d'index, deux
-- déclencheurs et deux écrans à tenir alignés : le jour où l'un reçoit une
-- colonne que l'autre n'a pas, la moitié de l'historique devient illisible. Et
-- l'écran a exactement le même besoin des deux côtés : qui, quand, depuis quoi,
-- vers quoi. Une table, une colonne `entity_kind`, et les prospects et les
-- factures y entrent le jour où on les branche, sans migration.

-- ------------------------------------------------------------------
-- 1 · L'historique des statuts, en ajout seul (sections 176, 177)
-- ------------------------------------------------------------------

create table if not exists status_history (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  office_id   uuid references offices on delete set null,
  entity_kind text not null check (entity_kind in ('VISA_CASE','SHIPMENT','LEAD','INVOICE')),
  -- Pas de clé étrangère : la ligne pointe quatre tables différentes, et deux
  -- d'entre elles naissent dans des lots voisins écrits en parallèle.
  entity_id   uuid not null,
  field       text not null check (field in ('stage','status')),
  from_value  text,
  to_value    text,
  -- Pas de clé étrangère non plus, et c'est délibéré : le jour où un compte est
  -- supprimé, l'historique doit rester lisible, et surtout une écriture
  -- d'historique ne doit JAMAIS faire échouer le changement d'étape qui la
  -- déclenche. Un journal qui bloque le métier finit par être désactivé.
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  location    text,
  note        text
);
create index if not exists status_history_entity on status_history (entity_kind, entity_id, changed_at desc);
create index if not exists status_history_agency on status_history (agency_id, changed_at desc);

comment on table status_history is
  'Qui a fait passer quel dossier ou quelle cargaison de quelle étape à quelle autre, et quand. Une seule table pour les quatre domaines : deux tables jumelles divergent toujours, et l''écran pose exactement la même question des deux côtés.';

-- Le déclencheur est SECURITY DEFINER pour une raison précise : l'écriture de
-- l'historique ne doit dépendre d'aucune politique, sinon un changement d'étape
-- fait par une fonction de bord ou par le portail échouerait pour cause de
-- journal inaccessible.
create or replace function status_history_write() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare v_kind text := tg_argv[0];
begin
  if new.stage is distinct from old.stage then
    insert into status_history (agency_id, office_id, entity_kind, entity_id,
                                field, from_value, to_value, changed_by)
    values (new.agency_id, new.office_id, v_kind, new.id,
            'stage', old.stage, new.stage, auth.uid());
  end if;
  if new.status is distinct from old.status then
    insert into status_history (agency_id, office_id, entity_kind, entity_id,
                                field, from_value, to_value, changed_by)
    values (new.agency_id, new.office_id, v_kind, new.id,
            'status', old.status, new.status, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists cases_status_history on cases;
create trigger cases_status_history after update of stage, status on cases
  for each row execute function status_history_write('VISA_CASE');

drop trigger if exists shipments_status_history on shipments;
create trigger shipments_status_history after update of stage, status on shipments
  for each row execute function status_history_write('SHIPMENT');

alter table status_history enable row level security;
alter table status_history force row level security;

drop policy if exists status_history_select on status_history;
create policy status_history_select on status_history for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('case:read') and auth_sees_office(office_id));
drop policy if exists status_history_insert on status_history;
create policy status_history_insert on status_history for insert to authenticated
  with check (agency_id = auth_agency_id());
drop policy if exists status_history_platform_read on status_history;
create policy status_history_platform_read on status_history for select to authenticated
  using (is_platform_admin());
-- Aucune politique d'update, aucune politique de delete. Pour personne, jamais.

revoke all on status_history from anon, authenticated;
grant select, insert on status_history to authenticated;
grant all on status_history to service_role;

-- ------------------------------------------------------------------
-- 2 · Les remboursements (section 180) et les annulations (section 181)
-- ------------------------------------------------------------------
--
-- Section 178 : un règlement encaissé ne se modifie jamais. Rembourser, c'est
-- écrire une ligne DE PLUS qui dit « on a rendu tant, tel jour, pour telle
-- raison, décidé par untel ». Corriger le montant du règlement d'origine
-- effacerait ce que le client a réellement versé au comptoir, et la caisse du
-- soir ne retomberait plus jamais juste. Aucune fonction de ce fichier ne
-- touche à `payments`, et le banc le vérifie.

create table if not exists refunds (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  office_id    uuid references offices on delete set null,
  payment_id   uuid not null references payments on delete cascade,
  amount       numeric(14,2) not null check (amount > 0),
  currency     char(3) not null default 'TND',
  reason       text,
  -- Qui a décidé, qui a sorti l'argent : ce ne sont presque jamais les mêmes,
  -- et c'est tout l'intérêt de la ligne.
  approved_by  uuid references auth.users on delete set null,
  processed_by uuid references auth.users on delete set null,
  status       text not null default 'demande'
               check (status in ('demande','approuve','verse','refuse')),
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists refunds_payment on refunds (payment_id);
create index if not exists refunds_agency on refunds (agency_id, status, created_at desc);

comment on table refunds is
  'Un remboursement est un mouvement de plus, jamais une correction du règlement d''origine. Le montant encaissé au comptoir reste écrit tel qu''il a été encaissé.';

-- Demander un remboursement. Le plafond est le montant réellement encaissé,
-- moins ce qui a déjà été rendu : sans ce garde, deux demandes successives
-- rendent deux fois la même somme.
create or replace function refund_request(p_payment uuid, p_amount numeric, p_reason text)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare p payments; v_deja numeric; v_id uuid;
begin
  if not auth_can('payment:write') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  select * into p from payments where id = p_payment;
  if p.id is null or p.agency_id is distinct from auth_agency_id() then
    raise exception 'règlement inconnu' using errcode = 'P0001';
  end if;
  select coalesce(sum(amount), 0) into v_deja
  from refunds where payment_id = p_payment and status <> 'refuse';
  if p_amount is null or p_amount <= 0 or v_deja + p_amount > p.amount then
    raise exception 'un remboursement ne dépasse pas ce qui a été encaissé' using errcode = 'P0001';
  end if;
  insert into refunds (agency_id, office_id, payment_id, amount, currency, reason)
  values (p.agency_id, p.office_id, p_payment, p_amount, p.currency, p_reason)
  returning id into v_id;
  return v_id;
end $$;

alter table refunds enable row level security;
alter table refunds force row level security;

drop policy if exists refunds_select on refunds;
create policy refunds_select on refunds for select to authenticated
  using (agency_id = auth_agency_id()
         and (auth_can('payment:write') or auth_can('finance:global')));
drop policy if exists refunds_insert on refunds;
create policy refunds_insert on refunds for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('payment:write'));
-- Approuver et verser sont des gestes de direction. Un agent demande, il ne
-- signe pas.
drop policy if exists refunds_update on refunds;
create policy refunds_update on refunds for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('finance:global'))
  with check (agency_id = auth_agency_id());
drop policy if exists refunds_platform_read on refunds;
create policy refunds_platform_read on refunds for select to authenticated
  using (is_platform_admin());

revoke all on refunds from anon, authenticated;
grant select, insert, update on refunds to authenticated;
grant all on refunds to service_role;

-- L'annulation, section 181. Rien ne se supprime : un dossier annulé garde son
-- histoire, ses pièces et ses règlements. Ce qui change, c'est trois colonnes.
alter table cases add column if not exists cancelled_at timestamptz;
alter table cases add column if not exists cancelled_by uuid;
alter table cases add column if not exists cancellation_reason text;

alter table shipments add column if not exists cancelled_at timestamptz;
alter table shipments add column if not exists cancelled_by uuid;
alter table shipments add column if not exists cancellation_reason text;

comment on column cases.cancellation_reason is
  'Pourquoi le dossier a été annulé. Rien ne se supprime : la ligne reste, avec sa raison, et les statistiques de refus restent honnêtes.';

-- ------------------------------------------------------------------
-- 3 · Les champs personnalisés (section 135)
-- ------------------------------------------------------------------
--
-- Chaque agence a deux ou trois informations qu'elle note à la main sur un
-- carnet parce que le logiciel ne les prévoit pas : le nom du rabatteur, le
-- numéro de dossier du consulat, la couleur de la valise. Sans ces champs,
-- elles tiennent un deuxième fichier à côté, et c'est ce deuxième fichier qui
-- devient la vérité.

create table if not exists custom_fields (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  entity_kind text not null check (entity_kind in ('CLIENT','VISA_CASE','SHIPMENT','LEAD')),
  code        text not null check (code ~ '^[a-z][a-z0-9_]{0,38}$'),
  -- Le libellé est traduit comme le reste du catalogue métier : une agence de
  -- Sfax saisit en français, sa cliente chinoise lit la même étiquette.
  label       jsonb not null,
  kind        text not null default 'texte'
              check (kind in ('texte','nombre','date','liste','booleen')),
  options     text[] not null default '{}',
  required    boolean not null default false,
  position    int not null default 100,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (agency_id, entity_kind, code),
  -- Une liste sans choix est un champ mort : il s'affiche et ne se remplit pas.
  constraint custom_fields_liste_a_des_choix
    check (kind <> 'liste' or array_length(options, 1) >= 1)
);
create index if not exists custom_fields_agency on custom_fields (agency_id, entity_kind, position);

create table if not exists custom_field_values (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  field_id    uuid not null references custom_fields on delete cascade,
  -- Uuid nu : la valeur pointe un client, un dossier, une cargaison ou un
  -- prospect selon le champ. Le genre est porté par le champ, pas répété ici.
  entity_id   uuid not null,
  value_text   text,
  value_number numeric(18,4),
  value_date   date,
  value_bool   boolean,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  unique (field_id, entity_id)
);
create index if not exists custom_field_values_entity on custom_field_values (entity_id);

comment on table custom_field_values is
  'Une valeur par champ et par fiche. La colonne utilisée dépend du type du champ : une date rangée dans du texte ne se trie pas, et ne se filtre pas non plus.';

-- Ce que l'écran affiche : les champs actifs du genre demandé, dans l'ordre,
-- chacun avec sa valeur s'il en a une. L'écran ne fait pas deux requêtes et ne
-- recolle rien.
create or replace function custom_values(p_entity_kind text, p_entity_id uuid)
returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'field_id', f.id,
    'code', f.code,
    'label', f.label,
    'kind', f.kind,
    'options', to_jsonb(f.options),
    'required', f.required,
    'position', f.position,
    'value', case f.kind
      when 'nombre'  then to_jsonb(v.value_number)
      when 'date'    then to_jsonb(v.value_date)
      when 'booleen' then to_jsonb(v.value_bool)
      else to_jsonb(v.value_text) end,
    'updated_at', v.updated_at
  ) order by f.position, f.code), '[]'::jsonb)
  from custom_fields f
  left join custom_field_values v on v.field_id = f.id and v.entity_id = p_entity_id
  where f.entity_kind = p_entity_kind
    and f.active
    and f.agency_id = auth_agency_id()
$$;

-- Poser une valeur. Le type se vérifie ICI et pas dans le navigateur : une
-- validation qui ne vit que dans l'écran se contourne avec deux lignes de
-- console, et c'est la base qui garde la donnée pour dix ans.
create or replace function set_custom_value(p_field uuid, p_entity uuid, p_value text)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  f custom_fields;
  v_txt text; v_num numeric; v_date date; v_bool boolean;
  v_vide boolean;
begin
  if not (auth_can('case:write') or auth_can('client:write')) then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  select * into f from custom_fields where id = p_field;
  if f.id is null or f.agency_id is distinct from auth_agency_id() then
    raise exception 'champ inconnu' using errcode = 'P0001';
  end if;

  v_txt := nullif(trim(coalesce(p_value, '')), '');
  v_vide := v_txt is null;

  if v_vide and f.required then
    raise exception 'le champ « % » est obligatoire', f.code using errcode = 'P0001';
  end if;

  if not v_vide then
    if f.kind = 'nombre' then
      begin v_num := v_txt::numeric;
      exception when others then
        raise exception 'le champ « % » attend un nombre', f.code using errcode = 'P0001';
      end;
    elsif f.kind = 'date' then
      begin v_date := v_txt::date;
      exception when others then
        raise exception 'le champ « % » attend une date', f.code using errcode = 'P0001';
      end;
    elsif f.kind = 'booleen' then
      if lower(v_txt) not in ('true','false','oui','non','1','0') then
        raise exception 'le champ « % » attend oui ou non', f.code using errcode = 'P0001';
      end if;
      v_bool := lower(v_txt) in ('true','oui','1');
    elsif f.kind = 'liste' then
      if not (v_txt = any (f.options)) then
        raise exception 'le champ « % » n''accepte pas cette valeur', f.code using errcode = 'P0001';
      end if;
    end if;
  end if;

  insert into custom_field_values (agency_id, field_id, entity_id,
                                   value_text, value_number, value_date, value_bool, updated_by)
  values (f.agency_id, p_field, p_entity,
          case when f.kind in ('texte','liste') then v_txt end,
          v_num, v_date, v_bool, auth.uid())
  on conflict (field_id, entity_id) do update set
    value_text = excluded.value_text, value_number = excluded.value_number,
    value_date = excluded.value_date, value_bool = excluded.value_bool,
    updated_by = excluded.updated_by, updated_at = now();

  return custom_values(f.entity_kind, p_entity);
end $$;

alter table custom_fields enable row level security;
alter table custom_fields force row level security;
alter table custom_field_values enable row level security;
alter table custom_field_values force row level security;

drop policy if exists custom_fields_select on custom_fields;
create policy custom_fields_select on custom_fields for select to authenticated
  using (agency_id = auth_agency_id());
drop policy if exists custom_fields_insert on custom_fields;
create policy custom_fields_insert on custom_fields for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('settings:manage'));
drop policy if exists custom_fields_update on custom_fields;
create policy custom_fields_update on custom_fields for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('settings:manage'))
  with check (agency_id = auth_agency_id());
drop policy if exists custom_fields_delete on custom_fields;
create policy custom_fields_delete on custom_fields for delete to authenticated
  using (agency_id = auth_agency_id() and auth_role() in ('owner','manager'));
drop policy if exists custom_fields_platform_read on custom_fields;
create policy custom_fields_platform_read on custom_fields for select to authenticated
  using (is_platform_admin());

drop policy if exists custom_field_values_select on custom_field_values;
create policy custom_field_values_select on custom_field_values for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('case:read'));
drop policy if exists custom_field_values_insert on custom_field_values;
create policy custom_field_values_insert on custom_field_values for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('case:write'));
drop policy if exists custom_field_values_update on custom_field_values;
create policy custom_field_values_update on custom_field_values for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('case:write'))
  with check (agency_id = auth_agency_id());
drop policy if exists custom_field_values_delete on custom_field_values;
create policy custom_field_values_delete on custom_field_values for delete to authenticated
  using (agency_id = auth_agency_id() and auth_can('case:write'));

revoke all on custom_fields, custom_field_values from anon, authenticated;
grant select, insert, update, delete on custom_fields to authenticated;
grant select, insert, update, delete on custom_field_values to authenticated;
grant all on custom_fields, custom_field_values to service_role;

-- ------------------------------------------------------------------
-- 4 · Les étiquettes (section 136)
-- ------------------------------------------------------------------
--
-- `clients.tags` existe déjà, en tableau sur la fiche. On n'y touche pas : des
-- centaines de fiches en dépendent, et un tableau sur la ligne est plus rapide
-- à lire que n'importe quelle jointure. Cette table ÉTEND l'étiquetage aux
-- dossiers, aux cargaisons et aux prospects, qui n'avaient rien.

create table if not exists entity_tags (
  agency_id   uuid not null references agencies on delete cascade,
  entity_kind text not null check (entity_kind in ('CLIENT','VISA_CASE','SHIPMENT','LEAD')),
  entity_id   uuid not null,
  tag         text not null check (length(trim(tag)) between 1 and 40),
  added_by    uuid,
  added_at    timestamptz not null default now(),
  primary key (entity_kind, entity_id, tag)
);
create index if not exists entity_tags_agency on entity_tags (agency_id, tag);

comment on table entity_tags is
  'Les étiquettes des dossiers, cargaisons et prospects. Celles des clients restent dans clients.tags : les déplacer casserait des écrans pour ne rien gagner.';

alter table entity_tags enable row level security;
alter table entity_tags force row level security;

drop policy if exists entity_tags_select on entity_tags;
create policy entity_tags_select on entity_tags for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('case:read'));
drop policy if exists entity_tags_insert on entity_tags;
create policy entity_tags_insert on entity_tags for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('case:write'));
drop policy if exists entity_tags_delete on entity_tags;
create policy entity_tags_delete on entity_tags for delete to authenticated
  using (agency_id = auth_agency_id() and auth_can('case:write'));
drop policy if exists entity_tags_platform_read on entity_tags;
create policy entity_tags_platform_read on entity_tags for select to authenticated
  using (is_platform_admin());

revoke all on entity_tags from anon, authenticated;
grant select, insert, delete on entity_tags to authenticated;
grant all on entity_tags to service_role;

-- ------------------------------------------------------------------
-- 5 · Les favoris (section 137)
-- ------------------------------------------------------------------
--
-- Une épingle est un geste privé. Deux personnes du même bureau ne suivent pas
-- les mêmes dossiers, et voir la liste de l'autre n'aide personne : la
-- politique est donc `user_id = auth.uid()`, en lecture comme en écriture.

create table if not exists pinned_items (
  user_id     uuid not null references auth.users on delete cascade,
  agency_id   uuid not null references agencies on delete cascade,
  entity_kind text not null check (entity_kind in ('CLIENT','VISA_CASE','SHIPMENT','LEAD')),
  entity_id   uuid not null,
  pinned_at   timestamptz not null default now(),
  primary key (user_id, entity_kind, entity_id)
);
create index if not exists pinned_items_user on pinned_items (user_id, pinned_at desc);

alter table pinned_items enable row level security;
alter table pinned_items force row level security;

drop policy if exists pinned_items_select on pinned_items;
create policy pinned_items_select on pinned_items for select to authenticated
  using (user_id = auth.uid() and agency_id = auth_agency_id());
drop policy if exists pinned_items_insert on pinned_items;
create policy pinned_items_insert on pinned_items for insert to authenticated
  with check (user_id = auth.uid() and agency_id = auth_agency_id());
drop policy if exists pinned_items_delete on pinned_items;
create policy pinned_items_delete on pinned_items for delete to authenticated
  using (user_id = auth.uid());
-- Pas de politique de plateforme : les épingles de quelqu'un ne regardent pas
-- le support.

revoke all on pinned_items from anon, authenticated;
grant select, insert, delete on pinned_items to authenticated;
grant all on pinned_items to service_role;

-- ------------------------------------------------------------------
-- 6 · Les filtres enregistrés (section 143)
-- ------------------------------------------------------------------

create table if not exists saved_views (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  -- Vide veut dire « posé par l'agence, pour tout le monde ». C'est ce qui
  -- permet à la direction de figer la vue que l'équipe ouvre le matin.
  user_id     uuid references auth.users on delete cascade,
  office_id   uuid references offices on delete set null,
  name        text not null,
  entity_kind text not null
              check (entity_kind in ('CLIENT','VISA_CASE','SHIPMENT','LEAD','INVOICE','QUOTE')),
  filters     jsonb not null default '{}'::jsonb,
  columns     text[] not null default '{}',
  sort        text,
  shared      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists saved_views_agency on saved_views (agency_id, entity_kind);

alter table saved_views enable row level security;
alter table saved_views force row level security;

drop policy if exists saved_views_select on saved_views;
create policy saved_views_select on saved_views for select to authenticated
  using (agency_id = auth_agency_id()
         and auth_sees_office(office_id)
         and (user_id is null or shared or user_id = auth.uid()));
drop policy if exists saved_views_insert on saved_views;
create policy saved_views_insert on saved_views for insert to authenticated
  with check (agency_id = auth_agency_id()
              and (user_id = auth.uid() or auth_can('settings:manage')));
drop policy if exists saved_views_update on saved_views;
create policy saved_views_update on saved_views for update to authenticated
  using (agency_id = auth_agency_id()
         and (user_id = auth.uid() or auth_can('settings:manage')))
  with check (agency_id = auth_agency_id());
drop policy if exists saved_views_delete on saved_views;
create policy saved_views_delete on saved_views for delete to authenticated
  using (agency_id = auth_agency_id()
         and (user_id = auth.uid() or auth_can('settings:manage')));

revoke all on saved_views from anon, authenticated;
grant select, insert, update, delete on saved_views to authenticated;
grant all on saved_views to service_role;

-- ------------------------------------------------------------------
-- 7 · Les notes à visibilité réglable (section 144)
-- ------------------------------------------------------------------
--
-- « Ce client est un mauvais payeur » ne se met pas sous les yeux de l'agent du
-- comptoir qui l'a en face de lui, et ne se met JAMAIS sous les yeux du
-- support de la plateforme. Quatre niveaux, du plus ouvert au plus fermé.

alter table case_notes add column if not exists visibility text not null default 'agence';
do $$ begin
  alter table case_notes add constraint case_notes_visibility_check
    check (visibility in ('bureau','agence','direction','plateforme_jamais'));
exception when duplicate_object then null;
end $$;

comment on column case_notes.visibility is
  'Qui lit la note. « direction » demande finance:global. « plateforme_jamais » reste lisible par l''agence mais n''apparaît jamais dans la vue de support.';

-- C'est le SEUL endroit de ce fichier où l'on réécrit une politique existante.
-- On la refait entière plutôt que de la rapiécer : une politique de lecture qui
-- se lit en deux morceaux se relit mal, et celle-ci décide qui voit quoi.
drop policy if exists case_notes_select on case_notes;
create policy case_notes_select on case_notes for select to authenticated
  using (
    agency_id = auth_agency_id()
    and auth_can('case:read')
    and (
      coalesce(visibility, 'agence') in ('agence', 'plateforme_jamais')
      or (visibility = 'direction' and auth_can('finance:global'))
      or (visibility = 'bureau' and auth_sees_office(
            (select c.office_id from cases c where c.id = case_notes.case_id)))
    )
  );

-- La vue de support suit la même règle, à l'envers : une note marquée
-- « plateforme_jamais » disparaît pour elle, et une note de direction aussi.
drop policy if exists case_notes_platform_read on case_notes;
create policy case_notes_platform_read on case_notes for select to authenticated
  using (is_platform_admin()
         and coalesce(visibility, 'agence') not in ('plateforme_jamais', 'direction'));

-- ------------------------------------------------------------------
-- 8 · La détection de doublons (section 145)
-- ------------------------------------------------------------------
--
-- La 0039 sait déjà rapprocher DEUX fiches à la saisie : passeport plus date de
-- naissance, téléphone, nom arabe normalisé plus date de naissance. On ne
-- réécrit pas ce travail. Ce qui manquait, c'est le BALAYAGE : ouvrir l'écran
-- et voir d'un coup tous les groupes suspects de l'agence.
--
-- On ajoute deux critères que `client_duplicates` ne porte pas, parce qu'ils
-- n'ont de sens qu'en balayage : l'adresse e-mail, et le numéro de pièce
-- d'identité quand la colonne existe.
--
-- La fonction n'est PAS security definer : elle lit sous les politiques de
-- l'appelant, et le paramètre d'agence est vérifié en plus.

create or replace function duplicate_scan(p_agency uuid, p_entity_kind text default 'CLIENT')
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  v_out  jsonb := '[]'::jsonb;
  v_part jsonb;
  v_cin  text;
begin
  if auth_agency_id() is not null and p_agency is distinct from auth_agency_id() then
    raise exception 'hors de votre agence' using errcode = '42501';
  end if;

  if p_entity_kind = 'CLIENT' then
    -- a. La même adresse e-mail. Deux fiches, une seule boîte : c'est une
    --    ressaisie au comptoir dans la quasi-totalité des cas.
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'CLIENT', 'criterion', 'email', 'value', v, 'members', m)), '[]'::jsonb)
      into v_part
    from (
      select lower(email::text) as v,
             jsonb_agg(jsonb_build_object(
               'id', id, 'label', first_name || ' ' || last_name, 'sublabel', phone)) as m
      from clients
      where agency_id = p_agency and deleted_at is null and email is not null
      group by 1 having count(*) > 1
      limit 50) x;
    v_out := v_out || v_part;

    -- b. La pièce d'identité, si le schéma en porte une un jour. La colonne
    --    n'existe pas encore : on la cherche au lieu de la supposer, pour que
    --    le critère du cahier des charges s'allume tout seul le jour où elle
    --    arrive.
    select column_name into v_cin
    from information_schema.columns
    where table_schema = 'public' and table_name = 'clients'
      and column_name in ('national_id', 'cin', 'id_card_number')
    limit 1;
    if v_cin is not null then
      execute format($q$
        select coalesce(jsonb_agg(jsonb_build_object(
                 'kind', 'CLIENT', 'criterion', 'cin', 'value', v, 'members', m)), '[]'::jsonb)
        from (
          select upper(replace(%1$I, ' ', '')) as v,
                 jsonb_agg(jsonb_build_object(
                   'id', id, 'label', first_name || ' ' || last_name, 'sublabel', phone)) as m
          from clients
          where agency_id = $1 and deleted_at is null and %1$I is not null
          group by 1 having count(*) > 1
          limit 50) x $q$, v_cin)
      into v_part using p_agency;
      v_out := v_out || v_part;
    end if;

    -- c. Le passeport, le téléphone et le nom arabe : c'est `client_duplicates`
    --    qui décide, avec sa hiérarchie de preuve. On se contente d'en faire
    --    des paires, puis des groupes.
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'CLIENT', 'criterion', motif, 'value', null,
             'members', jsonb_build_array(
               jsonb_build_object('id', ca.id, 'label', ca.first_name || ' ' || ca.last_name,
                                  'sublabel', coalesce(ca.passport_number, ca.phone)),
               jsonb_build_object('id', cb.id, 'label', cb.first_name || ' ' || cb.last_name,
                                  'sublabel', coalesce(cb.passport_number, cb.phone))))), '[]'::jsonb)
      into v_part
    from (
      select distinct
        least(c.id, (d ->> 'client_id')::uuid)    as a,
        greatest(c.id, (d ->> 'client_id')::uuid) as b,
        d ->> 'reason'                            as motif
      from clients c
      cross join lateral jsonb_array_elements(
        client_duplicates(p_agency, c.passport_number, c.birth_date,
                          coalesce(c.whatsapp, c.phone), c.native_name, c.id)) as d
      where c.agency_id = p_agency and c.deleted_at is null
      limit 50) p
    join clients ca on ca.id = p.a
    join clients cb on cb.id = p.b;
    v_out := v_out || v_part;

  elsif p_entity_kind = 'SHIPMENT' then
    -- Un numéro de conteneur ou de connaissement en double, c'est presque
    -- toujours la même arrivée saisie deux fois par deux personnes.
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'SHIPMENT', 'criterion', 'conteneur', 'value', v, 'members', m)), '[]'::jsonb)
      into v_part
    from (
      select upper(replace(container_no, ' ', '')) as v,
             jsonb_agg(jsonb_build_object(
               'id', id, 'label', reference,
               'sublabel', coalesce(origin_port, '') || ' → ' || coalesce(dest_port, ''))) as m
      from shipments
      where agency_id = p_agency and container_no is not null
      group by 1 having count(*) > 1
      limit 50) x;
    v_out := v_out || v_part;

    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'SHIPMENT', 'criterion', 'connaissement', 'value', v, 'members', m)), '[]'::jsonb)
      into v_part
    from (
      select upper(replace(bl_number, ' ', '')) as v,
             jsonb_agg(jsonb_build_object(
               'id', id, 'label', reference,
               'sublabel', coalesce(origin_port, '') || ' → ' || coalesce(dest_port, ''))) as m
      from shipments
      where agency_id = p_agency and bl_number is not null
      group by 1 having count(*) > 1
      limit 50) x;
    v_out := v_out || v_part;

  elsif p_entity_kind = 'COMPANY' then
    -- L'identifiant fiscal vit sur la société du client, table posée par le lot
    -- voisin : on teste son existence au lieu de la supposer.
    if to_regclass('public.client_companies') is not null then
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object(
                 'kind', 'COMPANY', 'criterion', 'identifiant_fiscal', 'value', v, 'members', m)), '[]'::jsonb)
        from (
          select upper(replace(tax_id, ' ', '')) as v,
                 jsonb_agg(jsonb_build_object(
                   'id', id, 'label', company_name, 'sublabel', coalesce(phone, email))) as m
          from client_companies
          where agency_id = $1 and deleted_at is null and tax_id is not null
          group by 1 having count(*) > 1
          limit 50) x $q$
      into v_part using p_agency;
      v_out := v_out || v_part;
    end if;
  end if;

  return v_out;
end $$;

comment on function duplicate_scan(uuid, text) is
  'Le balayage des doublons d''une agence. Il s''appuie sur client_duplicates de la 0039 pour les clients : la hiérarchie de preuve y est déjà écrite, et l''écrire deux fois la ferait diverger.';

-- ------------------------------------------------------------------
-- 9 · La fusion de deux clients (section 146)
-- ------------------------------------------------------------------
--
-- La fusion est le geste le plus dangereux du produit : elle déplace des
-- dossiers, des règlements et des passeports d'une fiche à l'autre, et rien ne
-- l'annule. Trois protections, dans cet ordre.
--
--   · Elle REFUSE plutôt que de deviner : deux agences différentes, une fiche
--     déjà supprimée, ou la même fiche deux fois, et rien ne bouge.
--   · Elle ne supprime rien : l'absorbé est marqué, il pointe vers le survivant,
--     et sa raison de fusion reste écrite.
--   · Elle rend le compte rendu LIGNE PAR LIGNE. Sans lui, personne ne peut
--     vérifier après coup que les onze règlements sont bien arrivés.

alter table clients add column if not exists merged_into uuid;
alter table clients add column if not exists merge_note text;

comment on column clients.merged_into is
  'Vers quelle fiche cette fiche a été fusionnée. Un ancien lien qui pointe l''absorbé reste donc résoluble : c''est ce qui rend la fusion vérifiable.';

create or replace function client_merge(p_keep uuid, p_absorb uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_keep clients; v_absorb clients;
  v_moved jsonb := '{}'::jsonb;
  v_total int := 0;
  n int;
  spec record;
  v_report jsonb;
begin
  if not auth_can('client:write') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  if p_keep is null or p_absorb is null or p_keep = p_absorb then
    raise exception 'on ne fusionne pas une fiche avec elle-même' using errcode = 'P0001';
  end if;

  select * into v_keep   from clients where id = p_keep;
  select * into v_absorb from clients where id = p_absorb;
  if v_keep.id is null or v_absorb.id is null then
    raise exception 'fiche inconnue' using errcode = 'P0001';
  end if;
  if v_keep.agency_id is distinct from v_absorb.agency_id then
    raise exception 'deux agences différentes ne fusionnent pas' using errcode = 'P0001';
  end if;
  if auth_agency_id() is not null and v_keep.agency_id is distinct from auth_agency_id() then
    raise exception 'hors de votre agence' using errcode = '42501';
  end if;
  if v_keep.deleted_at is not null or v_absorb.deleted_at is not null then
    raise exception 'une fiche supprimée ne se fusionne pas' using errcode = 'P0001';
  end if;

  -- Un contact principal de chaque côté ferait échouer le déplacement sur
  -- l'index unique du lot voisin. On rétrograde ceux de l'absorbé d'abord : le
  -- contact principal du survivant reste le principal.
  if to_regclass('public.client_contacts') is not null then
    execute 'update client_contacts set is_primary = false where client_id = $1 and is_primary'
      using p_absorb;
  end if;

  -- Le déplacement, table par table. La liste est parcourue au lieu d'être
  -- écrite en dur vingt fois : les lots voisins posent leurs propres tables
  -- avec la même colonne, et on les prend si elles sont là.
  for spec in
    select * from (values
      ('cases'),                ('shipment_lots'),      ('payments'),
      ('messages'),             ('appointments'),       ('passport_custody'),
      ('schengen_stays'),       ('client_name_variants'),('client_requests'),
      ('consents'),             ('receipts'),           ('activity_events'),
      ('tracking_links'),       ('whatsapp_unmatched'),
      ('client_contacts'),      ('client_companies'),   ('leads'),
      ('invoices'),             ('quotes'),             ('consignees'),
      ('deliveries')
    ) as v(tbl)
  loop
    if to_regclass('public.' || spec.tbl) is null then continue; end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = spec.tbl and column_name = 'client_id'
    ) then continue; end if;

    execute format('update %I set client_id = $1 where client_id = $2', spec.tbl)
      using p_keep, p_absorb;
    get diagnostics n = row_count;
    if n > 0 then
      v_moved := v_moved || jsonb_build_object(spec.tbl, n);
      v_total := v_total + n;
    end if;
  end loop;

  -- Les étiquettes, les valeurs de champs et les épingles portent l'absorbé
  -- dans leur clé : on les recopie sans écraser ce que le survivant a déjà.
  insert into entity_tags (agency_id, entity_kind, entity_id, tag, added_by, added_at)
  select agency_id, entity_kind, p_keep, tag, added_by, added_at
  from entity_tags where entity_kind = 'CLIENT' and entity_id = p_absorb
  on conflict do nothing;
  delete from entity_tags where entity_kind = 'CLIENT' and entity_id = p_absorb;
  get diagnostics n = row_count;
  if n > 0 then v_moved := v_moved || jsonb_build_object('entity_tags', n); v_total := v_total + n; end if;

  insert into custom_field_values (agency_id, field_id, entity_id, value_text, value_number, value_date, value_bool, updated_by)
  select agency_id, field_id, p_keep, value_text, value_number, value_date, value_bool, updated_by
  from custom_field_values where entity_id = p_absorb
  on conflict (field_id, entity_id) do nothing;
  delete from custom_field_values where entity_id = p_absorb;
  get diagnostics n = row_count;
  if n > 0 then v_moved := v_moved || jsonb_build_object('custom_field_values', n); v_total := v_total + n; end if;

  delete from pinned_items where entity_kind = 'CLIENT' and entity_id = p_absorb;

  -- Les étiquettes de la fiche elle-même se réunissent, sans doublon.
  update clients set tags = (
    select coalesce(array_agg(distinct t), '{}') from (
      select unnest(v_keep.tags) as t union select unnest(v_absorb.tags)) u
  ) where id = p_keep;

  -- L'absorbé est marqué, jamais effacé. Il pointe vers le survivant.
  update clients set
    deleted_at  = now(),
    merged_into = p_keep,
    merge_note  = coalesce(p_reason, 'fusion')
  where id = p_absorb;

  v_report := jsonb_build_object(
    'kept',     p_keep,
    'absorbed', p_absorb,
    'reason',   p_reason,
    'moved',    v_moved,
    'total',    v_total,
    'at',       now()
  );

  -- Deux traces, parce qu'elles ne servent pas au même lecteur : le fil du
  -- client pour l'agent, le journal d'audit pour qui vérifie.
  insert into activity_events (agency_id, client_id, type, detail, automated)
  values (v_keep.agency_id, p_keep, 'fusion_client',
          jsonb_build_object(
            'fr', 'Fusion de deux fiches client : ' || v_total || ' éléments déplacés.',
            'en', 'Two client records merged: ' || v_total || ' items moved.'),
          false);

  if to_regclass('public.audit_logs') is not null then
    execute $q$
      insert into audit_logs (agency_id, office_id, user_id, action, entity_type, entity_id,
                              old_values, new_values, changed_fields)
      values ($1, $2, $3, 'update', 'client', $4, $5, $6, array['client_id'])
    $q$
    using v_keep.agency_id, v_keep.office_id, auth.uid(), p_absorb,
          jsonb_build_object('client', p_absorb, 'deleted_at', null),
          v_report;
  end if;

  return v_report;
end $$;

comment on function client_merge(uuid, uuid, text) is
  'Fusionne deux fiches client de la même agence et rend le détail de ce qui a bougé. Une fusion sans compte rendu est irréversible ET invérifiable : c''est le compte rendu qui la rend acceptable.';

-- ------------------------------------------------------------------
-- 10 · La numérotation configurable (section 134)
-- ------------------------------------------------------------------
--
-- Chaque agence a sa manière de numéroter, souvent héritée d'un registre
-- papier, et souvent imposée par un consulat. On la rend réglable.
--
-- LA RÈGLE QUI PRIME SUR TOUT : sans règle définie, RIEN NE CHANGE. Une agence
-- déjà installée continue à recevoir exactement les références que
-- `next_reference` lui donnait hier. Changer la numérotation d'une agence en
-- production, c'est casser le lien entre ses dossiers et ses classeurs.

alter table reference_counters drop constraint if exists reference_counters_kind_check;
alter table reference_counters add constraint reference_counters_kind_check
  check (kind in ('case','shipment','request','receipt','quote','invoice','client'));

create table if not exists numbering_rules (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  kind         text not null
               check (kind in ('client','case','shipment','invoice','quote','receipt')),
  -- Les jetons acceptés : {OFFICE} {YYYY} {YY} {MM} {SEQ:n}.
  pattern      text not null check (pattern ~ '\{SEQ(:[0-9]+)?\}'),
  reset_period text not null default 'annuel'
               check (reset_period in ('jamais','annuel','mensuel')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (agency_id, kind)
);

comment on table numbering_rules is
  'Le motif de numérotation d''une agence, par genre de document. Absence de ligne = comportement historique, exactement. C''est la seule façon de livrer ce réglage sans renuméroter personne.';

-- La période du compteur est rangée dans la colonne `year` qui existe déjà :
-- 0 pour une suite qui ne se remet jamais à zéro, l'année pour une remise
-- annuelle, année*100+mois pour une remise mensuelle. Ajouter une colonne à
-- cette clé primaire aurait touché la numérotation historique, qui marche.
create or replace function format_reference(p_agency uuid, p_office uuid, p_kind text)
returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  r       numbering_rules;
  v_seq   int;
  v_per   int;
  v_code  text;
  v_name  text;
  v_out   text;
  v_width int;
begin
  if auth_agency_id() is not null and p_agency is distinct from auth_agency_id() then
    raise exception 'hors de votre agence' using errcode = '42501';
  end if;

  select * into r from numbering_rules
  where agency_id = p_agency and kind = p_kind and active;

  -- Aucune règle : on rend la main à la numérotation historique, sans rien
  -- toucher. C'est le cas de toutes les agences déjà installées.
  if r.id is null then
    return next_reference(p_agency, p_kind);
  end if;

  v_per := case r.reset_period
             when 'jamais'  then 0
             when 'mensuel' then extract(year from now())::int * 100 + extract(month from now())::int
             else extract(year from now())::int
           end;

  insert into reference_counters (agency_id, kind, year, last)
  values (p_agency, p_kind, v_per, 1)
  on conflict (agency_id, kind, year)
    do update set last = reference_counters.last + 1
  returning last into v_seq;

  -- Le code du bureau. Les bureaux n'en portent pas encore : on le tire des
  -- trois premières lettres du nom, ce qui donne TUN, SOU, SFA. Le jour où la
  -- table `offices` reçoit une vraie colonne `code`, c'est ici et nulle part
  -- ailleurs qu'il faudra la lire.
  select o.name into v_name from offices o
  where o.id = p_office and o.agency_id = p_agency;
  v_code := coalesce(
    nullif(upper(substr(regexp_replace(coalesce(v_name, ''), '[^a-zA-Z]', '', 'g'), 1, 3)), ''),
    'AG');

  v_out := r.pattern;
  v_out := replace(v_out, '{OFFICE}', v_code);
  v_out := replace(v_out, '{YYYY}', to_char(now(), 'YYYY'));
  v_out := replace(v_out, '{YY}',   to_char(now(), 'YY'));
  v_out := replace(v_out, '{MM}',   to_char(now(), 'MM'));

  v_width := (regexp_match(v_out, '\{SEQ:([0-9]+)\}'))[1]::int;
  if v_width is not null then
    v_out := regexp_replace(v_out, '\{SEQ:[0-9]+\}', lpad(v_seq::text, least(v_width, 12), '0'));
  end if;
  v_out := replace(v_out, '{SEQ}', lpad(v_seq::text, 4, '0'));

  return v_out;
end $$;

alter table numbering_rules enable row level security;
alter table numbering_rules force row level security;

drop policy if exists numbering_rules_select on numbering_rules;
create policy numbering_rules_select on numbering_rules for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('settings:view'));
drop policy if exists numbering_rules_insert on numbering_rules;
create policy numbering_rules_insert on numbering_rules for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('settings:manage'));
drop policy if exists numbering_rules_update on numbering_rules;
create policy numbering_rules_update on numbering_rules for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('settings:manage'))
  with check (agency_id = auth_agency_id());
drop policy if exists numbering_rules_delete on numbering_rules;
create policy numbering_rules_delete on numbering_rules for delete to authenticated
  using (agency_id = auth_agency_id() and auth_role() in ('owner','manager'));
drop policy if exists numbering_rules_platform_read on numbering_rules;
create policy numbering_rules_platform_read on numbering_rules for select to authenticated
  using (is_platform_admin());

revoke all on numbering_rules from anon, authenticated;
grant select, insert, update, delete on numbering_rules to authenticated;
grant all on numbering_rules to service_role;

-- ------------------------------------------------------------------
-- 11 · Les index qui manquaient, et la recherche (sections 172, 173)
-- ------------------------------------------------------------------
--
-- Les colonnes citées ci-dessous sont toutes des colonnes de jointure ou de
-- filtre d'écran quotidien. Sans index, chacune vaut un parcours complet de la
-- table à chaque ouverture de fiche, et ça ne se voit qu'au bout d'un an de
-- production.

create index if not exists clients_agency_passport on clients (agency_id, passport_number)
  where passport_number is not null;
create index if not exists clients_agency_email on clients (agency_id, email)
  where email is not null;
create index if not exists clients_vivants on clients (agency_id) where deleted_at is null;
create index if not exists payments_client on payments (client_id) where client_id is not null;
create index if not exists payments_lot on payments (lot_id) where lot_id is not null;
create index if not exists messages_client on messages (client_id) where client_id is not null;
create index if not exists appointments_case on appointments (case_id);
create index if not exists case_notes_shipment on case_notes (shipment_id, at desc)
  where shipment_id is not null;
create index if not exists cases_assignee on cases (agency_id, assignee_id)
  where assignee_id is not null;
create index if not exists shipments_assignee on shipments (agency_id, assignee_id)
  where assignee_id is not null;
create index if not exists shipments_container on shipments (agency_id, container_no)
  where container_no is not null;
create index if not exists shipments_bl on shipments (agency_id, bl_number)
  where bl_number is not null;

-- La recherche par trigramme. C'est elle qui rend « mohamed » trouvable quand
-- la fiche dit « mohammed » : la translittération des noms arabes n'a pas de
-- standard, et une recherche par préfixe rate une fiche sur deux.
do $$
declare v_ns text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    if exists (select 1 from pg_namespace where nspname = 'extensions') then
      execute 'create extension pg_trgm with schema extensions';
    else
      execute 'create extension pg_trgm';
    end if;
  end if;

  select n.nspname into v_ns
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  -- La classe d'opérateurs se qualifie par son schéma : sur Supabase les
  -- extensions vivent en dehors de `public`, et un index créé sans
  -- qualification échoue selon le search_path du moment.
  execute format(
    'create index if not exists clients_trgm_nom on clients using gin '
    || '((coalesce(first_name, '''') || '' '' || coalesce(last_name, '''') || '' '' '
    || '|| coalesce(native_name, '''')) %I.gin_trgm_ops)', v_ns);
  execute format(
    'create index if not exists cases_trgm_ref on cases using gin (reference %I.gin_trgm_ops)', v_ns);
  execute format(
    'create index if not exists shipments_trgm_ref on shipments using gin (reference %I.gin_trgm_ops)', v_ns);
  if to_regclass('public.client_companies') is not null then
    execute format(
      'create index if not exists client_companies_trgm on client_companies using gin '
      || '((coalesce(company_name, '''') || '' '' || coalesce(legal_name, '''')) %I.gin_trgm_ops)', v_ns);
  end if;
end $$;

-- La recherche globale. Elle n'est PAS security definer : elle lit sous les
-- politiques de l'appelant. Le filtre d'agence et le filtre de bureau sont
-- écrits en plus, explicitement, parce qu'une clé de service contourne les
-- politiques et qu'un balayage global ne doit jamais sortir d'un bureau.
create or replace function search_everything(p_query text, p_limit int default 20)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  v_ag   uuid;
  v_q    text;
  v_lim  int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_out  jsonb := '[]'::jsonb;
  v_part jsonb;
begin
  v_ag := auth_agency_id();
  if v_ag is null then return '[]'::jsonb; end if;

  -- Une lettre unique ramènerait toute l'agence : le trigramme demande trois
  -- caractères pour servir à quelque chose, deux est déjà généreux.
  v_q := trim(coalesce(p_query, ''));
  if length(v_q) < 2 then return '[]'::jsonb; end if;
  v_q := '%' || v_q || '%';

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_part from (
    select jsonb_build_object(
      'kind', 'client', 'id', c.id,
      'label', c.first_name || ' ' || c.last_name,
      'sublabel', coalesce(c.phone, c.email::text, c.passport_number),
      'url', '/clients/' || c.id) as x
    from clients c
    where c.agency_id = v_ag and c.deleted_at is null and auth_sees_office(c.office_id)
      and (c.first_name ilike v_q or c.last_name ilike v_q or c.native_name ilike v_q
           or c.phone ilike v_q or c.whatsapp ilike v_q
           or c.email::text ilike v_q or c.passport_number ilike v_q)
    order by c.last_name limit v_lim) s;
  v_out := v_out || v_part;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_part from (
    select jsonb_build_object(
      'kind', 'case', 'id', k.id,
      'label', k.reference,
      'sublabel', cl.first_name || ' ' || cl.last_name,
      'url', '/dossiers/' || k.id) as x
    from cases k join clients cl on cl.id = k.client_id
    where k.agency_id = v_ag and auth_sees_office(k.office_id)
      and (k.reference ilike v_q or k.consulate_ref ilike v_q
           or cl.first_name ilike v_q or cl.last_name ilike v_q)
    order by k.opened_at desc limit v_lim) s;
  v_out := v_out || v_part;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_part from (
    select jsonb_build_object(
      'kind', 'shipment', 'id', s2.id,
      'label', s2.reference,
      'sublabel', coalesce(s2.container_no, s2.bl_number, s2.dest_port),
      'url', '/cargaisons/' || s2.id) as x
    from shipments s2
    where s2.agency_id = v_ag and auth_sees_office(s2.office_id)
      and (s2.reference ilike v_q or s2.container_no ilike v_q or s2.bl_number ilike v_q
           or s2.vessel ilike v_q)
    order by s2.created_at desc limit v_lim) s;
  v_out := v_out || v_part;

  -- Les trois tables des lots voisins. Elles n'existent pas encore partout :
  -- on les interroge seulement si elles sont là.
  if to_regclass('public.leads') is not null then
    execute $q$
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object(
          'kind', 'lead', 'id', l.id,
          'label', coalesce(nullif(trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')), ''),
                            l.company_name, l.phone),
          'sublabel', coalesce(l.phone, l.email),
          'url', '/pipeline') as x
        from leads l
        where l.agency_id = $1 and l.deleted_at is null and auth_sees_office(l.office_id)
          and (l.first_name ilike $2 or l.last_name ilike $2
               or l.company_name ilike $2 or l.phone ilike $2 or l.email ilike $2)
        limit $3) s $q$
    into v_part using v_ag, v_q, v_lim;
    v_out := v_out || v_part;
  end if;

  if to_regclass('public.invoices') is not null then
    execute $q$
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object(
          'kind', 'invoice', 'id', i.id, 'label', i.number,
          'sublabel', i.total::text || ' ' || i.currency,
          'url', '/factures') as x
        from invoices i
        where i.agency_id = $1 and auth_sees_office(i.office_id) and i.number ilike $2
        limit $3) s $q$
    into v_part using v_ag, v_q, v_lim;
    v_out := v_out || v_part;
  end if;

  if to_regclass('public.quotes') is not null then
    execute $q$
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object(
          'kind', 'quote', 'id', q.id, 'label', q.number,
          'sublabel', q.total::text || ' ' || q.currency,
          'url', '/devis') as x
        from quotes q
        where q.agency_id = $1 and auth_sees_office(q.office_id) and q.number ilike $2
        limit $3) s $q$
    into v_part using v_ag, v_q, v_lim;
    v_out := v_out || v_part;
  end if;

  return v_out;
end $$;

comment on function search_everything(text, int) is
  'La recherche unique : clients, dossiers, cargaisons, prospects, factures, devis. Elle n''est pas security definer, et elle filtre en plus par agence et par bureau : un balayage global est exactement l''endroit où une fuite entre bureaux passerait inaperçue.';

-- ------------------------------------------------------------------
-- 12 · Les droits sur les fonctions
-- ------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'custom_values(text, uuid)',
    'set_custom_value(uuid, uuid, text)',
    'duplicate_scan(uuid, text)',
    'client_merge(uuid, uuid, text)',
    'format_reference(uuid, uuid, text)',
    'refund_request(uuid, numeric, text)',
    'search_everything(text, integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Le piège des fonctions de déclencheur, déjà rencontré au lot précédent :
-- PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction créée, et une fonction
-- de déclencheur SECURITY DEFINER appelable par un anonyme est une porte
-- ouverte que personne ne remarque, puisqu'elle s'appelle toute seule.
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
