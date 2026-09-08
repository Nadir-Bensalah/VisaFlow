-- 0050 · Sécurité et audit.
--
-- Pourquoi ce fichier existe, en une phrase : le décret-loi 2023-17 impose un
-- audit de sécurité tous les 12 mois, sous peine de 50 000 à 100 000 DT, et un
-- auditeur qui ouvre VisaFlow demande toujours la même chose en premier. Qui a
-- touché quoi, quand, et est-ce que le journal peut être réécrit.
--
-- Il complète 0008, il ne le remplace pas. Deux journaux cohabitent, et ils ne
-- racontent pas la même histoire :
--
--   · `activity_events` (0008) raconte le MÉTIER. « Dossier passé en dépôt »,
--     « rappel envoyé », « consultation du portail ». C'est ce qu'on montre au
--     client et à l'agent, en français, dans le fil du dossier.
--   · `audit_logs` (ici) raconte la DONNÉE. « clients.passport_number est passé
--     de AA123456 à AA123457, par Amira, le 8 septembre à 14 h 02, depuis
--     41.226.x.x ». Personne ne le lit au quotidien. On le lit le jour où un
--     consulat conteste une pièce, où un client dit qu'on a changé son numéro,
--     ou où l'INPDP demande la preuve d'une fuite circonscrite.
--
-- Les fondre en un seul aurait donné un journal illisible pour l'agent et
-- inexploitable pour l'auditeur. Ils restent séparés, et le second est écrit
-- par un déclencheur, jamais par du code applicatif qu'on peut oublier
-- d'appeler.
--
-- ------------------------------------------------------------------
-- La règle qui tient tout le fichier : un journal ne se modifie pas
-- ------------------------------------------------------------------
--
-- `audit_logs`, `security_events` et `document_versions` sont en AJOUT SEUL.
-- Aucune politique `for update`, aucune politique `for delete`, et aucun
-- `grant update` ni `grant delete` à `authenticated`. Pour personne, propriétaire
-- de l'agence compris. Un journal que l'acteur peut réécrire ne prouve rien :
-- il ne sert alors qu'à donner l'illusion d'une preuve, ce qui est pire que de
-- ne rien avoir. C'est le premier point qu'un auditeur vérifie, et il le
-- vérifie sur le schéma, pas sur une promesse d'interface.
--
-- Ce que le module NE fait PAS, dit ici pour que personne ne le croie :
--   · aucune analyse antivirale des fichiers déposés (voir file_accept) ;
--   · aucun chiffrement applicatif au repos ajouté par cette migration ;
--   · aucune géolocalisation : `approx_city` est déclarative, pas mesurée ;
--   · `user_sessions` ne remplace pas `auth.sessions` et ne déconnecte personne.

-- ------------------------------------------------------------------
-- 0 · Ce que la requête HTTP dit d'elle-même
-- ------------------------------------------------------------------
--
-- PostgREST expose les en-têtes de la requête dans un réglage de session.
-- L'adresse est celle que le proxy de Supabase rapporte : c'est la meilleure
-- que la base puisse connaître, ce n'est pas une preuve d'origine. Hors appel
-- HTTP (tâche planifiée, banc d'essai, psql), les deux valent NULL, et c'est
-- normal. On ne fabrique jamais une adresse plausible pour remplir la colonne.

create or replace function sec_req_ip() returns inet
language plpgsql stable set search_path = public as $$
declare raw text;
begin
  raw := btrim(split_part(
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-forwarded-for',
    ',', 1));
  if raw is null or raw = '' then return null; end if;
  return raw::inet;
exception when others then
  -- En-tête absent, malformé, ou réglage inexistant : pas d'adresse, pas de
  -- panne. Le journal vaut mieux sans IP qu'absent.
  return null;
end $$;

create or replace function sec_req_agent() returns text
language plpgsql stable set search_path = public as $$
begin
  return left(nullif(
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'user-agent',
    ''), 400);
exception when others then
  return null;
end $$;

revoke all on function sec_req_ip() from public, anon;
revoke all on function sec_req_agent() from public, anon;
grant execute on function sec_req_ip() to authenticated;
grant execute on function sec_req_agent() to authenticated;

-- ------------------------------------------------------------------
-- 1 · audit_logs · le journal de la donnée
-- ------------------------------------------------------------------

create table if not exists audit_logs (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies on delete cascade,
  office_id     uuid,
  -- Pas de clé étrangère sur l'auteur, volontairement. Un journal doit
  -- survivre à la suppression du compte qui l'a rempli : une trace qui
  -- s'efface avec son auteur est exactement ce qu'un fraudeur cherche.
  user_id       uuid,
  action        text not null check (action in (
                  'create','update','delete','read_sensitive',
                  'export','login','permission_change')),
  entity_type   text not null,
  entity_id     uuid,
  -- Seulement les champs qui ont bougé. Recopier la ligne entière à chaque
  -- écriture donne, au bout d'un an, une deuxième base de données dans le
  -- journal : plus lourde que l'originale, aussi sensible, et jamais purgée.
  old_values    jsonb,
  new_values    jsonb,
  changed_fields text[],
  ip_address    inet,
  user_agent    text,
  at            timestamptz not null default now()
);

create index if not exists audit_logs_agency on audit_logs (agency_id, at desc);
create index if not exists audit_logs_entity on audit_logs (entity_type, entity_id, at desc);
create index if not exists audit_logs_actor  on audit_logs (agency_id, user_id, at desc);

comment on table audit_logs is
  'Le journal de la donnée, en ajout seul. Il dit quel champ a changé, de quelle valeur à quelle valeur, par qui. Il contient donc des données sensibles en clair (numéros de passeport) : sa lecture est réservée à auth_can(''audit:view''). activity_events, lui, raconte le métier en français.';

alter table audit_logs enable row level security;
alter table audit_logs force row level security;

drop policy if exists audit_logs_select on audit_logs;
drop policy if exists audit_logs_insert on audit_logs;
drop policy if exists audit_logs_platform_read on audit_logs;

create policy audit_logs_select on audit_logs for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('audit:view'));
create policy audit_logs_insert on audit_logs for insert to authenticated
  with check (agency_id = auth_agency_id());
create policy audit_logs_platform_read on audit_logs for select to authenticated
  using (is_platform_admin());
-- Aucune politique d'update. Aucune politique de delete. C'est le point.

grant select, insert on audit_logs to authenticated;
grant all on audit_logs to service_role;

-- ------------------------------------------------------------------
-- 2 · security_events · ce qui arrive au compte, pas à la donnée
-- ------------------------------------------------------------------

create table if not exists security_events (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid references agencies on delete cascade,
  user_id    uuid,
  kind       text not null check (kind in (
               'LOGIN_FAILED','NEW_DEVICE','PASSWORD_CHANGED','MFA_ENABLED',
               'MFA_DISABLED','EXPORT_DATA','PERMISSION_CHANGED',
               'SUSPICIOUS_ACTIVITY','SESSION_REVOKED')),
  -- La gravité n'est pas choisie par l'appelant : elle est déduite du type,
  -- ici et nulle part ailleurs. Sinon le front finit par tout classer en
  -- « info » pour ne pas alarmer, et l'écran de sécurité ne sert plus à rien.
  severity   text not null check (severity in ('info','attention','critique')),
  detail     jsonb not null default '{}',
  ip_address inet,
  user_agent text,
  at         timestamptz not null default now()
);

create index if not exists security_events_agency on security_events (agency_id, at desc);
create index if not exists security_events_grave  on security_events (agency_id, at desc)
  where severity = 'critique';

comment on table security_events is
  'Les événements de sécurité du compte : échec de connexion, nouvel appareil, export, changement de droits. En ajout seul, comme audit_logs.';

alter table security_events enable row level security;
alter table security_events force row level security;

drop policy if exists security_events_select on security_events;
drop policy if exists security_events_insert on security_events;
drop policy if exists security_events_platform_read on security_events;

create policy security_events_select on security_events for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('audit:view'));
create policy security_events_insert on security_events for insert to authenticated
  with check (agency_id = auth_agency_id());
create policy security_events_platform_read on security_events for select to authenticated
  using (is_platform_admin());
-- Ni update ni delete, pour personne.

grant select, insert on security_events to authenticated;
grant all on security_events to service_role;

-- La gravité, déduite du type. Une table de correspondance et rien d'autre.
create or replace function sec_severity(p_kind text) returns text
language sql immutable set search_path = public as $$
  select case p_kind
    when 'SUSPICIOUS_ACTIVITY' then 'critique'
    when 'LOGIN_FAILED'        then 'attention'
    when 'NEW_DEVICE'          then 'attention'
    when 'MFA_DISABLED'        then 'attention'
    when 'EXPORT_DATA'         then 'attention'
    when 'PERMISSION_CHANGED'  then 'attention'
    else 'info'
  end
$$;
revoke all on function sec_severity(text) from public, anon;
grant execute on function sec_severity(text) to authenticated;

-- Déposer un événement sur le compte courant. Appelable par le front et par
-- les fonctions de bord. L'agence et l'auteur viennent du jeton, jamais d'un
-- paramètre : un appelant qui choisirait son agence pourrait salir le journal
-- d'une autre.
create or replace function security_note(p_kind text, p_detail jsonb default '{}')
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid;
begin
  insert into security_events (agency_id, user_id, kind, severity, detail, ip_address, user_agent)
  values (auth_agency_id(), auth.uid(), p_kind, sec_severity(p_kind),
          coalesce(p_detail, '{}'::jsonb), sec_req_ip(), sec_req_agent())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function security_note(text, jsonb) from public, anon;
grant execute on function security_note(text, jsonb) to authenticated;

-- ------------------------------------------------------------------
-- 3 · Le déclencheur d'audit, générique
-- ------------------------------------------------------------------
--
-- Deux décisions de conception, écrites parce qu'elles se discutent.
--
-- A. LE DÉCLENCHEUR NE BLOQUE JAMAIS L'ÉCRITURE MÉTIER.
--    Tout le corps est sous `exception when others`. Si le journal échoue, on
--    émet un avertissement et l'écriture de l'agent passe quand même.
--    L'alternative, un journal qui bloque, est séduisante sur le papier :
--    « pas de trace, pas d'écriture ». En pratique, le jour où elle bloque le
--    comptoir un samedi matin, quelqu'un désactive le déclencheur, et
--    l'agence se retrouve sans journal du tout, sans le savoir. Un journal
--    désactivé est pire qu'un journal qui a un trou daté. On accepte donc de
--    perdre des lignes plutôt que de perdre le journal.
--    Contrepartie assumée, à dire à l'auditeur : ce journal est un très bon
--    élément de preuve, ce n'est pas une garantie d'exhaustivité absolue.
--
-- B. CE QUI EST GARDÉ SELON L'OPÉRATION.
--    · UPDATE : uniquement les champs dont la valeur a changé, avant et après.
--      C'est le cas qui compte, et celui qui ferait exploser le volume si on
--      recopiait la ligne.
--    · INSERT : les champs non nuls de la ligne créée. Une création n'arrive
--      qu'une fois par ligne, et savoir avec quelles valeurs un dossier a été
--      ouvert est précisément ce qu'on cherche en cas de litige.
--    · DELETE : la ligne effacée, entière. C'est la dernière trace qui existe
--      d'elle. La garder est le seul moyen de répondre à « qu'est-ce qui a
--      disparu ».

create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  -- Les colonnes de bruit : elles changent à chaque écriture sans rien
  -- apprendre à personne, et la colonne `at` du journal dit déjà l'heure.
  ignore constant text[] := array['updated_at'];
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_action text;
  v_row jsonb;
  o jsonb;
  n jsonb;
begin
  begin
    if tg_op = 'INSERT' then
      v_row := to_jsonb(new);
      v_new := jsonb_strip_nulls(v_row);
      select array_agg(k order by k) into v_changed from jsonb_object_keys(v_new) k;
      v_action := 'create';

    elsif tg_op = 'UPDATE' then
      v_row := to_jsonb(new);
      o := to_jsonb(old);
      n := v_row;
      select array_agg(k order by k) into v_changed
        from jsonb_object_keys(n) k
        where not (k = any (ignore))
          and (n -> k) is distinct from (o -> k);
      -- Rien n'a bougé (ou seulement du bruit) : pas de ligne de journal.
      -- Un journal qui enregistre les non-événements devient illisible.
      if v_changed is null then return null; end if;
      select jsonb_object_agg(k, coalesce(o -> k, 'null'::jsonb)) into v_old from unnest(v_changed) k;
      select jsonb_object_agg(k, coalesce(n -> k, 'null'::jsonb)) into v_new from unnest(v_changed) k;
      -- Un changement de rôle n'est pas une modification comme une autre.
      if tg_table_name = 'profiles' and 'role' = any (v_changed) then
        v_action := 'permission_change';
      else
        v_action := 'update';
      end if;

    else
      v_row := to_jsonb(old);
      v_old := jsonb_strip_nulls(v_row);
      v_action := 'delete';
    end if;

    insert into audit_logs (
      agency_id, office_id, user_id, action, entity_type, entity_id,
      old_values, new_values, changed_fields, ip_address, user_agent)
    values (
      nullif(v_row ->> 'agency_id', '')::uuid,
      nullif(v_row ->> 'office_id', '')::uuid,
      auth.uid(),
      v_action,
      tg_table_name,
      nullif(v_row ->> 'id', '')::uuid,
      v_old, v_new, v_changed,
      sec_req_ip(), sec_req_agent());

    -- Une promotion se lit dans le fil de sécurité, pas seulement dans le
    -- journal technique : c'est l'événement que l'on regarde après une fuite.
    if v_action = 'permission_change' then
      insert into security_events (agency_id, user_id, kind, severity, detail, ip_address, user_agent)
      values (nullif(v_row ->> 'agency_id', '')::uuid, auth.uid(), 'PERMISSION_CHANGED',
              sec_severity('PERMISSION_CHANGED'),
              jsonb_build_object('profile', v_row ->> 'id',
                                 'avant', o ->> 'role', 'apres', n ->> 'role'),
              sec_req_ip(), sec_req_agent());
    end if;

    return null;

  exception when others then
    -- Voir la décision A ci-dessus. On crie, on ne bloque pas.
    raise warning 'audit: ligne non journalisée sur % (%) : %', tg_table_name, tg_op, sqlerrm;
    return null;
  end;
end $$;

revoke all on function audit_trigger() from public, anon;
-- Personne n'appelle un déclencheur à la main : aucun `grant execute` à
-- `authenticated`. Il s'exécute par le déclencheur, sous l'identité du
-- propriétaire, et c'est tout.

-- Les tables qui portent des données sensibles au sens de la loi 2004-63 :
-- identité et passeport (clients), le dossier lui-même (cases), l'argent
-- (payments), la garde physique du passeport (passport_custody), les comptes
-- et leurs droits (profiles), les pièces justificatives (case_documents).
do $$
declare t text;
begin
  foreach t in array array[
    'clients','cases','payments','passport_custody','profiles','case_documents'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function audit_trigger()', 'audit_' || t, t);
  end loop;
end $$;

-- ------------------------------------------------------------------
-- 4 · user_sessions · les appareils, vus par leur propriétaire
-- ------------------------------------------------------------------
--
-- Supabase tient ses propres sessions dans `auth.sessions`, et c'est lui qui
-- décide de la validité d'un jeton. On ne les remplace pas, on ne les lit même
-- pas. Cette table est le JOURNAL VISIBLE de l'utilisateur : « voici les
-- appareils depuis lesquels ton compte s'est connecté ». Elle est alimentée à
-- la connexion, par le front, via session_touch().
--
-- `approx_city` est déclarative. Rien ici ne géolocalise personne : si la
-- colonne est remplie un jour, ce sera par un service qui le dit, pas par une
-- déduction maison. Tant qu'elle est vide, l'écran n'affiche rien.

create table if not exists user_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  -- Nulle pour un admin de la plateforme, qui n'appartient à aucune agence.
  agency_id    uuid references agencies on delete cascade,
  device_label text,
  browser      text,
  platform     text,
  ip_address   inet,
  approx_city  text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid
);

create index if not exists user_sessions_user on user_sessions (user_id, last_seen_at desc);
create index if not exists user_sessions_agency on user_sessions (agency_id, last_seen_at desc);

comment on table user_sessions is
  'Le journal des appareils d''un compte, montré à son propriétaire. Ce n''est pas auth.sessions : révoquer ici écrit la trace, la déconnexion réelle est faite par Supabase côté front.';

alter table user_sessions enable row level security;
alter table user_sessions force row level security;

drop policy if exists user_sessions_select on user_sessions;
drop policy if exists user_sessions_platform_read on user_sessions;

-- Chacun voit ses appareils. Le responsable qui a le droit d'audit voit ceux
-- de son agence : c'est lui qui répond de l'accès, il doit pouvoir regarder.
create policy user_sessions_select on user_sessions for select to authenticated
  using (user_id = auth.uid()
         or (agency_id = auth_agency_id() and auth_can('audit:view')));
create policy user_sessions_platform_read on user_sessions for select to authenticated
  using (is_platform_admin());

-- Lecture seule pour tout le monde. Les deux fonctions ci-dessous sont les
-- seules à écrire ici : sans cela, n'importe qui effacerait la ligne de
-- l'appareil avec lequel il vient d'entrer.
grant select on user_sessions to authenticated;
grant all on user_sessions to service_role;

create or replace function session_touch(
  p_label text default null, p_browser text default null, p_platform text default null)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_new boolean := false;
begin
  if v_user is null then return null; end if;

  -- Un appareil, c'est le triplet (libellé, navigateur, plateforme). Deux
  -- connexions du même poste rafraîchissent la même ligne : l'écran doit
  -- montrer trois appareils, pas trois cents connexions.
  select id into v_id from user_sessions
   where user_id = v_user and revoked_at is null
     and device_label is not distinct from p_label
     and browser is not distinct from p_browser
     and platform is not distinct from p_platform
   order by last_seen_at desc limit 1;

  if v_id is null then
    insert into user_sessions (user_id, agency_id, device_label, browser, platform, ip_address)
    values (v_user, auth_agency_id(), p_label, p_browser, p_platform, sec_req_ip())
    returning id into v_id;
    v_new := true;
  else
    update user_sessions
       set last_seen_at = now(), ip_address = coalesce(sec_req_ip(), ip_address)
     where id = v_id;
  end if;

  -- Un appareil jamais vu est le signal le plus utile du lot : c'est celui
  -- qui trahit un mot de passe partagé ou volé.
  if v_new then
    insert into security_events (agency_id, user_id, kind, severity, detail, ip_address, user_agent)
    values (auth_agency_id(), v_user, 'NEW_DEVICE', sec_severity('NEW_DEVICE'),
            jsonb_build_object('appareil', p_label, 'navigateur', p_browser, 'plateforme', p_platform),
            sec_req_ip(), sec_req_agent());
  end if;

  -- La connexion elle-même, dans le journal de la donnée. `auth.users` en
  -- garde une trace, mais elle n'est pas lisible par l'agence.
  insert into audit_logs (agency_id, user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
  values (auth_agency_id(), v_user, 'login', 'user_sessions', v_id,
          jsonb_build_object('nouvel_appareil', v_new), sec_req_ip(), sec_req_agent());

  return v_id;
end $$;
revoke all on function session_touch(text, text, text) from public, anon;
grant execute on function session_touch(text, text, text) to authenticated;

-- Marquer une session comme révoquée.
--
-- Attention à ce que cette fonction fait et ne fait pas : elle écrit la TRACE
-- de la révocation. Elle n'invalide aucun jeton, parce que la base n'a pas le
-- droit de toucher au schéma `auth` de Supabase, et qu'une fonction qui
-- s'arrogerait ce droit deviendrait le maillon le plus dangereux du produit.
-- La déconnexion réelle est faite par le front (supabase.auth.signOut, ou
-- l'API d'administration pour la session d'un autre). Le front appelle donc
-- les deux : d'abord Supabase, ensuite celle-ci.
create or replace function session_revoke(p_session uuid)
returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare s user_sessions;
begin
  select * into s from user_sessions where id = p_session;
  if s.id is null then return false; end if;

  -- La sienne, toujours. Celle d'un autre, seulement pour qui administre
  -- l'équipe, et seulement dans sa propre agence.
  if s.user_id <> auth.uid()
     and not (s.agency_id = auth_agency_id() and auth_can('team:manage')) then
    raise exception 'révocation non autorisée' using errcode = '42501';
  end if;

  update user_sessions set revoked_at = coalesce(revoked_at, now()), revoked_by = auth.uid()
   where id = p_session;

  insert into security_events (agency_id, user_id, kind, severity, detail, ip_address, user_agent)
  values (s.agency_id, s.user_id, 'SESSION_REVOKED', sec_severity('SESSION_REVOKED'),
          jsonb_build_object('session', p_session, 'par', auth.uid(),
                             'appareil', s.device_label),
          sec_req_ip(), sec_req_agent());
  return true;
end $$;
revoke all on function session_revoke(uuid) from public, anon;
grant execute on function session_revoke(uuid) to authenticated;

-- Mes appareils. Pas de SECURITY DEFINER : la fonction s'exécute avec les
-- droits de l'appelant, la politique de lecture fait le reste. Moins de
-- privilège, moins de surface.
create or replace function my_sessions()
returns setof user_sessions
language sql stable set search_path = public as $$
  select * from user_sessions
   where user_id = auth.uid()
   order by revoked_at nulls first, last_seen_at desc
$$;
revoke all on function my_sessions() from public, anon;
grant execute on function my_sessions() to authenticated;

-- ------------------------------------------------------------------
-- 5 · tracking_links · les liens de suivi, révocables
-- ------------------------------------------------------------------
--
-- Les dossiers et les cargaisons portent déjà un `portal_token` unique. Il a
-- deux défauts : il n'y en a qu'un, et on ne peut pas le retirer sans casser
-- le suivi pour tout le monde. Quand une agence envoie le lien au client, puis
-- au conjoint, puis au partenaire, elle a envoyé le même secret trois fois et
-- ne saura jamais lequel a fuité.
--
-- Cette table émet plusieurs liens pour la même entité, chacun révocable
-- séparément, avec sa date d'expiration et son compteur d'ouvertures. Le
-- jeton n'est JAMAIS stocké : seule son empreinte SHA-256 l'est. Une base
-- volée ne donne donc aucun lien utilisable, exactement comme pour un mot de
-- passe.

create table if not exists tracking_links (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  client_id    uuid references clients on delete set null,
  entity_kind  text not null check (entity_kind in ('VISA_CASE','SHIPMENT')),
  entity_id    uuid not null,
  -- L'empreinte, jamais le jeton. On ne peut pas le réafficher : c'est voulu,
  -- et l'écran le dit à l'émission.
  token_hash   text not null unique,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  requires_otp boolean not null default false,
  revoked_at   timestamptz,
  last_opened_at timestamptz,
  open_count   int not null default 0
);

create index if not exists tracking_links_entity on tracking_links (agency_id, entity_kind, entity_id, created_at desc);

comment on table tracking_links is
  'Les liens de suivi émis pour un dossier ou une cargaison. Seule l''empreinte du jeton est conservée : la base volée ne rend aucun lien ouvrable.';

alter table tracking_links enable row level security;
alter table tracking_links force row level security;

drop policy if exists tracking_links_select on tracking_links;
drop policy if exists tracking_links_platform_read on tracking_links;

create policy tracking_links_select on tracking_links for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('case:read'));
create policy tracking_links_platform_read on tracking_links for select to authenticated
  using (is_platform_admin());

-- Lecture seule : émettre et révoquer passent par les fonctions, qui vérifient
-- l'entité et écrivent la trace. Un `insert` direct permettrait de poser une
-- empreinte sur le dossier d'une autre agence.
grant select on tracking_links to authenticated;
grant all on tracking_links to service_role;

-- Émettre un lien. Le jeton est renvoyé UNE SEULE FOIS, à cet appel. Ensuite
-- il n'existe plus nulle part côté serveur.
create or replace function tracking_issue(
  p_entity_kind text, p_entity_id uuid,
  p_days int default 30, p_requires_otp boolean default false)
returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  v_agency uuid; v_office uuid; v_client uuid;
  v_token text; v_id uuid; v_days int;
begin
  if p_entity_kind = 'VISA_CASE' then
    select c.agency_id, c.office_id, c.client_id into v_agency, v_office, v_client
      from cases c where c.id = p_entity_id;
    if not auth_can('case:write') then
      raise exception 'émission de lien non autorisée' using errcode = '42501';
    end if;
  elsif p_entity_kind = 'SHIPMENT' then
    select s.agency_id, s.office_id, null::uuid into v_agency, v_office, v_client
      from shipments s where s.id = p_entity_id;
    if not auth_can('shipment:write') then
      raise exception 'émission de lien non autorisée' using errcode = '42501';
    end if;
  else
    raise exception 'type d''entité inconnu' using errcode = 'P0001';
  end if;

  -- L'entité doit exister, être celle de l'appelant, et dans son périmètre.
  -- Sans ces trois contrôles, l'identifiant d'un dossier suffirait à ouvrir un
  -- accès sur l'agence d'à côté.
  if v_agency is null or v_agency <> auth_agency_id() or not auth_sees_office(v_office) then
    raise exception 'entité introuvable' using errcode = 'P0002';
  end if;

  -- Bornes de durée : jamais illimité, jamais plus d'un an. Un lien de suivi
  -- qui ne meurt pas est un mot de passe permanent envoyé par WhatsApp.
  v_days := greatest(1, least(coalesce(p_days, 30), 365));
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into tracking_links (
    agency_id, client_id, entity_kind, entity_id, token_hash,
    created_by, expires_at, requires_otp)
  values (
    v_agency, v_client, p_entity_kind, p_entity_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    auth.uid(), now() + make_interval(days => v_days), coalesce(p_requires_otp, false))
  returning id into v_id;

  insert into audit_logs (agency_id, office_id, user_id, action, entity_type, entity_id,
                          new_values, changed_fields, ip_address, user_agent)
  values (v_agency, v_office, auth.uid(), 'create', 'tracking_links', v_id,
          jsonb_build_object('entity_kind', p_entity_kind, 'entity_id', p_entity_id,
                             'expires_at', now() + make_interval(days => v_days),
                             'requires_otp', coalesce(p_requires_otp, false)),
          array['entity_kind','entity_id','expires_at','requires_otp'],
          sec_req_ip(), sec_req_agent());

  return v_token;
end $$;
revoke all on function tracking_issue(text, uuid, int, boolean) from public, anon;
grant execute on function tracking_issue(text, uuid, int, boolean) to authenticated;

create or replace function tracking_revoke(p_link uuid)
returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare l tracking_links;
begin
  select * into l from tracking_links where id = p_link;
  if l.id is null or l.agency_id <> auth_agency_id() then
    raise exception 'lien introuvable' using errcode = 'P0002';
  end if;
  if not (auth_can('case:write') or auth_can('shipment:write')) then
    raise exception 'révocation non autorisée' using errcode = '42501';
  end if;

  update tracking_links set revoked_at = coalesce(revoked_at, now()) where id = p_link;

  insert into audit_logs (agency_id, user_id, action, entity_type, entity_id,
                          new_values, changed_fields, ip_address, user_agent)
  values (l.agency_id, auth.uid(), 'update', 'tracking_links', p_link,
          jsonb_build_object('revoked_at', now()), array['revoked_at'],
          sec_req_ip(), sec_req_agent());
  return true;
end $$;
revoke all on function tracking_revoke(uuid) from public, anon;
grant execute on function tracking_revoke(uuid) to authenticated;

-- Résoudre un jeton et compter l'ouverture.
--
-- Limite connue, dite franchement : cette fonction n'est PAS ouverte à
-- l'anonyme, donc le portail public ne peut pas encore l'appeler. Le banc des
-- droits fige la liste nominative des fonctions accessibles sans compte, et il
-- ne m'appartient pas. Tant que ce nom n'y est pas ajouté, `open_count` n'est
-- alimenté que par un appel authentifié. C'est un point de câblage, pas une
-- fonctionnalité livrée.
create or replace function tracking_open(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare l tracking_links;
begin
  select * into l from tracking_links
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if l.id is null or l.revoked_at is not null
     or (l.expires_at is not null and l.expires_at < now()) then
    return null;
  end if;

  update tracking_links
     set open_count = open_count + 1, last_opened_at = now()
   where id = l.id;

  return jsonb_build_object('entity_kind', l.entity_kind, 'entity_id', l.entity_id,
                            'requires_otp', l.requires_otp, 'client_id', l.client_id);
end $$;
revoke all on function tracking_open(text) from public, anon;
grant execute on function tracking_open(text) to authenticated;

-- ------------------------------------------------------------------
-- 6 · document_versions · la pièce d'avant
-- ------------------------------------------------------------------
--
-- Remplacer une pièce écrase aujourd'hui `storage_path` sans rien garder. Le
-- jour où un consulat écrit « le justificatif fourni le 12 mars n'était pas
-- celui-ci », l'agence n'a rien à opposer. Chaque dépôt crée donc une version,
-- et la version précédente reste.
--
-- `document_id` est un uuid nu, sans clé étrangère : il pointe soit
-- `case_documents`, soit `shipment_documents`, et `document_kind` dit lequel.
-- Une clé étrangère ne peut pas viser deux tables, et la choisir aurait
-- interdit l'historique côté fret.

create table if not exists document_versions (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  document_id    uuid not null,
  document_kind  text not null check (document_kind in ('case','shipment')),
  version_number int not null check (version_number > 0),
  storage_path   text,
  file_name      text,
  file_size      bigint,
  -- L'empreinte du contenu. C'est elle qui répond à « est-ce bien le même
  -- fichier ». Elle est calculée par le client au dépôt : la base ne voit pas
  -- l'octet, elle ne peut donc pas la recalculer ni la garantir.
  sha256         text,
  uploaded_by    uuid,
  created_at     timestamptz not null default now(),
  unique (document_id, version_number)
);

create index if not exists document_versions_doc on document_versions (document_id, version_number desc);
create index if not exists document_versions_agency on document_versions (agency_id, created_at desc);

comment on table document_versions is
  'L''historique des pièces. En ajout seul : une version qu''on peut réécrire ne prouve rien face à un consulat qui conteste.';

alter table document_versions enable row level security;
alter table document_versions force row level security;

drop policy if exists document_versions_select on document_versions;
drop policy if exists document_versions_insert on document_versions;
drop policy if exists document_versions_platform_read on document_versions;

create policy document_versions_select on document_versions for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('case:read'));
create policy document_versions_insert on document_versions for insert to authenticated
  with check (agency_id = auth_agency_id()
              and (auth_can('case:write') or auth_can('shipment:write')));
create policy document_versions_platform_read on document_versions for select to authenticated
  using (is_platform_admin());
-- Ni update ni delete. Une version remplacée n'est pas une version corrigée.

grant select, insert on document_versions to authenticated;
grant all on document_versions to service_role;

-- Le numéro de version se calcule côté serveur, sous verrou. Le calculer dans
-- le navigateur donnerait deux versions numéro 3 le jour où deux agents
-- déposent en même temps, et la contrainte d'unicité renverrait une erreur
-- incompréhensible à l'un des deux.
create or replace function document_version_add(
  p_document uuid, p_kind text, p_storage_path text,
  p_file_name text default null, p_file_size bigint default null,
  p_sha256 text default null)
returns int
language plpgsql security definer set search_path = public, auth as $$
declare v_agency uuid := auth_agency_id(); v_next int;
begin
  if v_agency is null then
    raise exception 'agence inconnue' using errcode = '42501';
  end if;
  if not (auth_can('case:write') or auth_can('shipment:write')) then
    raise exception 'dépôt non autorisé' using errcode = '42501';
  end if;
  if p_kind not in ('case','shipment') then
    raise exception 'type de pièce inconnu' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_document::text, 0));

  select coalesce(max(version_number), 0) + 1 into v_next
    from document_versions where document_id = p_document;

  insert into document_versions (
    agency_id, document_id, document_kind, version_number,
    storage_path, file_name, file_size, sha256, uploaded_by)
  values (v_agency, p_document, p_kind, v_next,
          p_storage_path, p_file_name, p_file_size, p_sha256, auth.uid());

  return v_next;
end $$;
revoke all on function document_version_add(uuid, text, text, text, bigint, text) from public, anon;
grant execute on function document_version_add(uuid, text, text, text, bigint, text) to authenticated;

create or replace function document_history(p_document uuid)
returns setof document_versions
language sql stable set search_path = public as $$
  select * from document_versions
   where document_id = p_document
   order by version_number desc
$$;
revoke all on function document_history(uuid) from public, anon;
grant execute on function document_history(uuid) to authenticated;

-- ------------------------------------------------------------------
-- 7 · file_accept · ce qu'on accepte de recevoir
-- ------------------------------------------------------------------
--
-- CE QUE CETTE FONCTION NE FAIT PAS, ET QU'IL NE FAUT PAS LAISSER CROIRE :
-- elle n'analyse pas le contenu du fichier. Aucun antivirus, aucun bac à
-- sable, aucune vérification des octets d'en-tête. Un PDF nommé, typé et
-- dimensionné correctement passe, qu'il soit sain ou vérolé. L'analyse
-- antivirale relève d'un service externe branché sur le seau de stockage
-- (ClamAV en fonction de bord, ou l'offre d'un hébergeur), et elle n'est pas
-- livrée. Écrire « fichiers scannés » quelque part serait un mensonge, et
-- c'est précisément ce qu'un audit relève.
--
-- Ce qu'elle fait, et qui se vérifie ligne à ligne : la taille, le type
-- déclaré, l'extension, la cohérence entre les deux, les noms qui contiennent
-- un chemin, et les doubles extensions.
--
-- Les mêmes règles existent dans web/src/lib/fichiers.ts, pour refuser avant
-- l'envoi. Celle-ci est la seule qui protège.
create or replace function file_accept(p_name text, p_mime text, p_size bigint)
returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  -- 10 Mo. Au-delà, c'est une photo non recadrée, pas une pièce de dossier.
  -- Un consulat refuse déjà les téléversements plus lourds, et une agence sur
  -- une connexion tunisienne moyenne n'enverra jamais 40 Mo au comptoir.
  max_bytes constant bigint := 10 * 1024 * 1024;
  allowed_mime constant text[] := array[
    'image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'];
  allowed_ext constant text[] := array['jpg','jpeg','png','webp','heic','heif','pdf'];
  nom text := btrim(coalesce(p_name, ''));
  mime text := lower(btrim(coalesce(p_mime, '')));
  ext text;
  base text;
  famille text;
begin
  if nom = '' then
    return jsonb_build_object('ok', false, 'raison', 'nom_vide');
  end if;

  -- Un nom de fichier n'est jamais un chemin. « ../../etc/passwd » et
  -- « dossiers/autre_agence/x.pdf » sont refusés ici, avant d'atteindre le
  -- stockage, et pas seulement assainis : un nom qui contient un chemin est
  -- toujours une tentative ou une erreur, jamais un usage légitime.
  if position('/' in nom) > 0 or position('\' in nom) > 0
     or position('..' in nom) > 0 or nom ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'raison', 'chemin_dans_le_nom');
  end if;

  if position('.' in nom) = 0 then
    return jsonb_build_object('ok', false, 'raison', 'extension_refusee');
  end if;

  ext := lower(regexp_replace(nom, '^.*\.', ''));
  if not (ext = any (allowed_ext)) then
    return jsonb_build_object('ok', false, 'raison', 'extension_refusee');
  end if;

  -- Double extension : « passeport.pdf.exe » est déjà refusé plus haut par
  -- l'extension finale, mais « facture.exe.pdf » passerait. Un fichier dont le
  -- nom porte deux extensions est refusé, quelles qu'elles soient.
  -- Faux positif assumé et connu : « carte.id.pdf » est refusé lui aussi. On
  -- préfère faire renommer un fichier que laisser passer un exécutable
  -- déguisé, et le message le dit à l'agent.
  base := left(nom, length(nom) - length(ext) - 1);
  if base ~ '\.[A-Za-z0-9]{2,4}$' then
    return jsonb_build_object('ok', false, 'raison', 'double_extension');
  end if;

  -- Le type déclaré. Certains navigateurs n'en envoient aucun pour un HEIC :
  -- absent, on s'en remet à l'extension plutôt que de refuser une photo
  -- d'iPhone parfaitement valable.
  if mime <> '' then
    if not (mime = any (allowed_mime)) then
      return jsonb_build_object('ok', false, 'raison', 'type_refuse');
    end if;
    famille := case ext
      when 'pdf' then 'application/pdf'
      when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg'
      when 'png' then 'image/png'  when 'webp' then 'image/webp'
      else 'image/heic' end;
    -- Un .pdf annoncé image/png : l'un des deux ment, on ne choisit pas lequel.
    if famille = 'image/heic' then
      if mime not in ('image/heic','image/heif') then
        return jsonb_build_object('ok', false, 'raison', 'type_incoherent');
      end if;
    elsif mime <> famille then
      return jsonb_build_object('ok', false, 'raison', 'type_incoherent');
    end if;
  end if;

  if p_size is null or p_size <= 0 then
    return jsonb_build_object('ok', false, 'raison', 'fichier_vide');
  end if;
  if p_size > max_bytes then
    return jsonb_build_object('ok', false, 'raison', 'trop_gros');
  end if;

  return jsonb_build_object('ok', true, 'raison', null);
end $$;
revoke all on function file_accept(text, text, bigint) from public, anon;
grant execute on function file_accept(text, text, bigint) to authenticated;

-- ------------------------------------------------------------------
-- 8 · Les lectures de l'écran
-- ------------------------------------------------------------------

-- Le journal d'une entité. La garde est ici ET dans la politique : la
-- politique protège la table, la garde donne un refus explicite plutôt qu'un
-- résultat vide, qu'un développeur prendrait pour « il ne s'est rien passé ».
create or replace function audit_search(
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 100)
returns table (
  id uuid, at timestamptz, action text, entity_type text, entity_id uuid,
  user_id uuid, user_name text, changed_fields text[],
  old_values jsonb, new_values jsonb, ip_address inet)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not auth_can('audit:view') then
    raise exception 'journal réservé' using errcode = '42501';
  end if;
  return query
    select l.id, l.at, l.action, l.entity_type, l.entity_id, l.user_id,
           p.name, l.changed_fields, l.old_values, l.new_values, l.ip_address
      from audit_logs l
      left join profiles p on p.id = l.user_id
     where l.agency_id = auth_agency_id()
       and (p_entity_type is null or l.entity_type = p_entity_type)
       and (p_entity_id is null or l.entity_id = p_entity_id)
       and (p_from is null or l.at >= p_from)
       and (p_to is null or l.at <= p_to)
     order by l.at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;
revoke all on function audit_search(text, uuid, timestamptz, timestamptz, int) from public, anon;
grant execute on function audit_search(text, uuid, timestamptz, timestamptz, int) to authenticated;

create or replace function security_feed(p_limit int default 50)
returns table (
  id uuid, at timestamptz, kind text, severity text, detail jsonb,
  user_id uuid, user_name text, ip_address inet, user_agent text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not auth_can('audit:view') then
    raise exception 'journal réservé' using errcode = '42501';
  end if;
  return query
    select e.id, e.at, e.kind, e.severity, e.detail, e.user_id, p.name,
           e.ip_address, e.user_agent
      from security_events e
      left join profiles p on p.id = e.user_id
     where e.agency_id = auth_agency_id()
     order by e.at desc
     limit greatest(1, least(coalesce(p_limit, 50), 500));
end $$;
revoke all on function security_feed(int) from public, anon;
grant execute on function security_feed(int) to authenticated;

-- Une consultation de donnée sensible. `document_access_log` (0008) couvre les
-- pièces ; celle-ci couvre le reste : ouvrir la fiche complète d'un client,
-- afficher un numéro de passeport, lire un relevé bancaire.
create or replace function audit_read_note(p_entity_type text, p_entity_id uuid)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid;
begin
  insert into audit_logs (agency_id, user_id, action, entity_type, entity_id, ip_address, user_agent)
  values (auth_agency_id(), auth.uid(), 'read_sensitive', p_entity_type, p_entity_id,
          sec_req_ip(), sec_req_agent())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function audit_read_note(text, uuid) from public, anon;
grant execute on function audit_read_note(text, uuid) to authenticated;

-- À appeler AVANT tout export, quel qu'il soit. Un export non tracé est un
-- incident invisible : le jour où une liste de clients circule, personne ne
-- peut dire si elle est sortie d'ici, ni par qui.
--
-- Volontairement NON gardée par `data:export` : si l'appel échouait pour un
-- rôle qui exporte par un autre chemin (un tableau copié, un PDF imprimé), le
-- front finirait par ne plus l'appeler du tout. On préfère une trace complète
-- à une trace vertueuse et vide. Ce que le rôle a le droit d'exporter reste
-- décidé par les politiques des tables exportées, pas par cette ligne.
create or replace function data_export_note(p_scope text)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid;
begin
  insert into audit_logs (agency_id, user_id, action, entity_type, new_values, ip_address, user_agent)
  values (auth_agency_id(), auth.uid(), 'export', coalesce(p_scope, 'inconnu'),
          jsonb_build_object('scope', p_scope), sec_req_ip(), sec_req_agent());

  insert into security_events (agency_id, user_id, kind, severity, detail, ip_address, user_agent)
  values (auth_agency_id(), auth.uid(), 'EXPORT_DATA', sec_severity('EXPORT_DATA'),
          jsonb_build_object('scope', p_scope), sec_req_ip(), sec_req_agent())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function data_export_note(text) from public, anon;
grant execute on function data_export_note(text) to authenticated;

-- ------------------------------------------------------------------
-- 9 · Reprendre les droits que la base accorde toute seule
-- ------------------------------------------------------------------
--
-- Piège trouvé en écrivant le banc, et il vaut d'être écrit noir sur blanc :
-- la migration 0015 a posé
--
--     alter default privileges in schema public
--       grant select, insert, update, delete on tables to authenticated;
--
-- Autrement dit, TOUTE table créée après elle reçoit UPDATE et DELETE pour
-- `authenticated`, sans que personne ne l'écrive. Sur `activity_events` cela
-- passe inaperçu parce qu'aucune politique ne correspond : l'ordre s'exécute,
-- ne touche aucune ligne, et ne dit rien. Le journal est protégé, mais par
-- accident, et le refus est silencieux.
--
-- Pour les journaux de ce module on ne s'en contente pas. On reprend le droit
-- lui-même. La différence compte à deux endroits : un auditeur lit la table
-- des droits avant de lire les politiques, et une tentative de réécriture
-- renvoie « permission denied » au lieu de « 0 ligne modifiée », ce qui est la
-- seule réponse honnête.

do $$
declare t text;
begin
  -- Les trois journaux : lire et ajouter, rien d'autre.
  foreach t in array array['audit_logs','security_events','document_versions'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select, insert on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;

  -- Les appareils et les liens de suivi : lecture seule depuis le navigateur.
  -- Les écritures passent par les fonctions, qui vérifient l'agence, le
  -- périmètre et le droit. Sans cette reprise, n'importe quel compte
  -- effacerait la ligne de l'appareil avec lequel il vient d'entrer, ou
  -- poserait une empreinte de lien sur le dossier d'une autre agence.
  foreach t in array array['user_sessions','tracking_links'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
