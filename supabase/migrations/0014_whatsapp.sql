-- 0014 · WhatsApp, en émission et en réception.
--
-- L'agence vit sur WhatsApp. Un outil qui ne parle pas WhatsApp est abandonné
-- en trois semaines. Jusqu'ici le produit ne savait que pré-remplir un lien
-- wa.me : le message partait du téléphone de l'employé, et rien ne revenait.

-- ------------------------------------------------------------------
-- Le raccordement d'une agence
-- ------------------------------------------------------------------
-- Le jeton d'accès ne vit PAS ici. Il vit dans le coffre Supabase, et cette
-- table n'en garde que le nom. Une table lisible par l'owner qui contiendrait
-- le jeton permettrait d'écrire au nom de l'agence depuis n'importe où.

create table if not exists whatsapp_accounts (
  agency_id        uuid primary key references agencies on delete cascade,
  -- Identifiants publics côté Meta.
  phone_number_id  text not null,
  waba_id          text,
  display_number   text,
  -- Nom du secret dans le coffre, jamais le secret.
  token_secret     text not null,
  -- Partagé avec Meta à l'abonnement du webhook. Sert à vérifier l'appel.
  verify_token     text not null,
  -- Signature des appels entrants (app secret). Nom de secret, là encore.
  app_secret_name  text,
  active           boolean not null default false,
  linked_at        timestamptz,
  last_error       text,
  last_error_at    timestamptz,
  created_at       timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Les modèles déposés chez Meta
-- ------------------------------------------------------------------
-- Un message hors fenêtre de 24 heures doit passer par un modèle approuvé.
-- Le modèle local (message_templates) est ce que l'agence écrit ; celui-ci est
-- ce que Meta a accepté, langue par langue. Les deux ne se confondent pas :
-- un modèle peut être approuvé en français et refusé en arabe.

create table if not exists whatsapp_templates (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies on delete cascade,
  -- Le modèle local dont il est la déclinaison approuvée.
  template_id   uuid references message_templates on delete set null,
  -- Le nom exact chez Meta, en minuscules et tirets bas.
  meta_name     text not null,
  language      text not null,
  category      text not null default 'utility'
                check (category in ('utility','authentication','marketing')),
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected','paused','disabled')),
  rejected_reason text,
  -- Ordre des variables {{1}}, {{2}} tel que déposé. Sans lui, un envoi met
  -- la date à la place du nom, et Meta accepte sans rien dire.
  variables     text[] not null default '{}',
  submitted_at  timestamptz,
  reviewed_at   timestamptz,
  unique (agency_id, meta_name, language)
);

-- ------------------------------------------------------------------
-- Ce que coûte un envoi
-- ------------------------------------------------------------------
-- Depuis juillet 2025, Meta facture au message modèle envoyé, selon la
-- catégorie et le pays du destinataire. Les messages de service envoyés dans
-- la fenêtre de 24 heures restent gratuits. Répondre coûte donc moins cher
-- que relancer à froid, et c'est une règle de conception, pas un détail.

alter table messages
  add column if not exists wa_template_name text,
  add column if not exists wa_category text
    check (wa_category is null or wa_category in ('utility','authentication','marketing','service')),
  -- Coût facturé par Meta, en devise de facturation. Nul dans la fenêtre.
  add column if not exists wa_cost numeric(10,6),
  add column if not exists wa_currency text,
  -- Le numéro tel que Meta le rend, quand on n'a pas su rattacher.
  add column if not exists from_number text;

create index if not exists messages_provider on messages (provider_id)
  where provider_id is not null;

-- ------------------------------------------------------------------
-- Les messages qui n'ont pas trouvé leur dossier
-- ------------------------------------------------------------------
-- Le point délicat : un même numéro peut porter plusieurs dossiers, et un
-- client peut écrire depuis le téléphone de son cousin. Plutôt que de
-- rattacher au hasard, on met de côté et on demande.

create table if not exists whatsapp_unmatched (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  from_number  text not null,
  profile_name text,
  body         text,
  provider_id  text unique,
  at           timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references profiles on delete set null,
  client_id    uuid references clients on delete set null
);
create index if not exists wa_unmatched_open on whatsapp_unmatched (agency_id, at desc)
  where resolved_at is null;

-- ------------------------------------------------------------------
-- Rattacher un numéro entrant
-- ------------------------------------------------------------------
-- Le rapprochement se fait sur les huit derniers chiffres, comme partout
-- ailleurs dans le produit : les indicatifs s'écrivent de cinq façons et un
-- client tape rarement son numéro deux fois pareil.

-- Rend zéro, une ou deux lignes. Deux, c'est déjà trop : on ne rattache pas.
create or replace function wa_match_client(p_agency uuid, p_number text)
returns setof uuid
language sql stable
set search_path = public
as $$
  select c.id
  from clients c
  where c.agency_id = p_agency
    and c.deleted_at is null
    and (
      right(regexp_replace(coalesce(c.whatsapp, c.phone), '[^0-9]', '', 'g'), 8)
      = right(regexp_replace(p_number, '[^0-9]', '', 'g'), 8)
    )
  -- Un numéro qui répond à deux clients ne rattache rien : mieux vaut la
  -- corbeille des non rattachés qu'un message versé au mauvais dossier.
  limit 2;
$$;

-- Le dossier le plus probable pour un client : celui qui est ouvert et qui a
-- bougé le plus récemment. Un client qui écrit parle de son dossier en cours.
create or replace function wa_latest_case(p_client uuid)
returns uuid
language sql stable
set search_path = public
as $$
  select id from cases
  where client_id = p_client and status = 'ouvert'
  order by updated_at desc
  limit 1;
$$;

-- ------------------------------------------------------------------
-- Recevoir
-- ------------------------------------------------------------------
-- Appelée par la fonction de bord, avec la clé de service. Elle range le
-- message et rouvre la fenêtre de 24 heures.

create or replace function wa_receive(
  p_agency uuid,
  p_from text,
  p_body text,
  p_provider_id text,
  p_profile_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matches uuid[];
  v_client  uuid;
  v_case    uuid;
  v_id      uuid;
begin
  -- Meta rejoue ses appels. Sans cette garde, un message arrive trois fois.
  select id into v_id from messages where provider_id = p_provider_id;
  if found then return v_id; end if;

  select array_agg(x) into v_matches from wa_match_client(p_agency, p_from) as x;

  if v_matches is null or array_length(v_matches, 1) <> 1 then
    insert into whatsapp_unmatched (agency_id, from_number, profile_name, body, provider_id)
    values (p_agency, p_from, p_profile_name, p_body, p_provider_id)
    on conflict (provider_id) do nothing;
    return null;
  end if;

  v_client := v_matches[1];
  v_case := wa_latest_case(v_client);

  insert into messages (agency_id, case_id, client_id, channel, direction, body, status, provider_id, from_number, wa_category)
  values (p_agency, v_case, v_client, 'whatsapp', 'entrant', p_body, 'remis', p_provider_id, p_from, 'service')
  returning id into v_id;

  insert into activity_events (agency_id, case_id, client_id, type, detail, automated)
  values (p_agency, v_case, v_client, 'message_recu',
          jsonb_build_object('fr', 'Message WhatsApp reçu.'), true);

  return v_id;
end;
$$;

-- Retours d'état : remis, lu, échec, et le coût facturé.
create or replace function wa_status(
  p_provider_id text,
  p_status text,
  p_error text default null,
  p_cost numeric default null,
  p_currency text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update messages
     set status = case p_status
                    when 'sent' then 'envoye'
                    when 'delivered' then 'remis'
                    when 'read' then 'lu'
                    when 'failed' then 'echec'
                    else status end,
         status_at = now(),
         read_at = case when p_status = 'read' then now() else read_at end,
         error = coalesce(p_error, error),
         wa_cost = coalesce(p_cost, wa_cost),
         wa_currency = coalesce(p_currency, wa_currency)
   where provider_id = p_provider_id;
end;
$$;

-- ------------------------------------------------------------------
-- La fenêtre de 24 heures, côté serveur
-- ------------------------------------------------------------------
-- Elle existait déjà (0006). On la redit ici pour le cas WhatsApp : hors
-- fenêtre, l'envoi doit passer par un modèle approuvé, et il est facturé.

create or replace function wa_window_open(p_client uuid)
returns boolean
language sql stable
set search_path = public
as $$
  select exists (
    select 1 from messages
    where client_id = p_client
      and channel = 'whatsapp'
      and direction = 'entrant'
      and at > now() - interval '24 hours'
  );
$$;

-- La file d'envoi, vidée par la fonction de bord. On ne rend que ce qui est
-- réellement envoyable : un modèle non approuvé bloque au lieu de brûler.
create or replace function wa_outbox(p_agency uuid, p_limit integer default 50)
returns table (
  id uuid, client_id uuid, to_number text, body text, locale text,
  template_name text, category text, in_window boolean
)
language sql stable
set search_path = public
as $$
  select
    m.id,
    m.client_id,
    coalesce(c.whatsapp, c.phone) as to_number,
    m.body,
    m.locale,
    wt.meta_name,
    coalesce(wt.category, 'utility'),
    wa_window_open(m.client_id)
  from messages m
  join clients c on c.id = m.client_id
  left join message_templates mt on mt.key = m.template_key and mt.agency_id = m.agency_id
  left join whatsapp_templates wt
    on wt.template_id = mt.id and wt.language = m.locale and wt.status = 'approved'
  where m.agency_id = p_agency
    and m.channel = 'whatsapp'
    and m.direction = 'sortant'
    and m.status = 'file'
    -- Hors fenêtre sans modèle approuvé, l'envoi échouerait chez Meta : on
    -- ne le sort pas de la file, on le laisse visible comme bloqué.
    and (wa_window_open(m.client_id) or wt.meta_name is not null)
  order by m.at
  limit p_limit;
$$;

-- ------------------------------------------------------------------
-- Lire le jeton, et personne d'autre
-- ------------------------------------------------------------------
-- Le coffre n'existe pas sur un PostgreSQL nu : le banc d'essai tourne sans.
-- En production, seule la clé de service appelle cette fonction, et elle est
-- la seule porte vers le jeton.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'vault') then
    execute $f$
      create or replace function vault_read(p_name text)
      returns text
      language sql
      security definer
      set search_path = vault, public
      as 'select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1';
    $f$;
    execute 'revoke all on function vault_read(text) from public, anon, authenticated';
  end if;
end $$;

-- ------------------------------------------------------------------
-- Cloisonnement
-- ------------------------------------------------------------------

alter table whatsapp_accounts  enable row level security;
alter table whatsapp_accounts  force  row level security;
alter table whatsapp_templates enable row level security;
alter table whatsapp_templates force  row level security;
alter table whatsapp_unmatched enable row level security;
alter table whatsapp_unmatched force  row level security;

-- Le raccordement est un réglage de direction. Un agent n'a rien à y faire,
-- et personne ne lit le nom du secret sans être propriétaire.
create policy wa_accounts_select on whatsapp_accounts for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('settings:manage'));
create policy wa_accounts_insert on whatsapp_accounts for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_role() = 'owner');
create policy wa_accounts_update on whatsapp_accounts for update to authenticated
  using (agency_id = auth_agency_id() and auth_role() = 'owner')
  with check (agency_id = auth_agency_id());
create policy wa_accounts_delete on whatsapp_accounts for delete to authenticated
  using (agency_id = auth_agency_id() and auth_role() = 'owner');

do $$
declare spec record;
begin
  for spec in
    select * from (values
      ('whatsapp_templates', 'catalog:manage'),
      ('whatsapp_unmatched', 'message:send')
    ) as v(tbl, cap)
  loop
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
  end loop;
end $$;

-- Les fonctions de réception ne sont appelées que par la clé de service.
revoke all on function wa_receive(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function wa_status(text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function wa_window_open(uuid) to authenticated;
grant execute on function wa_outbox(uuid, integer) to authenticated;
grant execute on function wa_match_client(uuid, text) to authenticated;
grant execute on function wa_latest_case(uuid) to authenticated;
