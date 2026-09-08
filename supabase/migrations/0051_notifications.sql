-- 0051 · Notifications, règles et webhooks.
--
-- Ce que le produit savait déjà faire : un moteur de relances (automation_rules,
-- 0002), une file d'envoi WhatsApp (les messages en statut « file », vidés par
-- wa_outbox, 0014), et une cloche qui devinait les nouvelles en relisant les
-- données déjà chargées dans le navigateur.
--
-- Ce qui manquait : un endroit où une nouvelle EXISTE. Une cloche qui dérive
-- ses lignes des données du navigateur ne sait pas ce qui a déjà été lu, ne
-- survit pas à un changement de poste, ne dit rien à qui n'a pas la page
-- ouverte, et ne peut pas prévenir un logiciel tiers. Cette migration pose la
-- table, le routage, et la sortie vers l'extérieur.
--
-- Trois règles gouvernent tout le fichier.
--
--   1. RIEN NE PART VERS UN CLIENT SANS QU'UNE AGENCE L'AIT DEMANDÉ. Un
--      message WhatsApp coûte de l'argent et engage l'agence. Les règles qui
--      écrivent au client naissent donc DÉSACTIVÉES, sans exception.
--   2. ON COMPLÈTE, ON NE REMPLACE PAS. Les messages sortants continuent de
--      passer par `messages` en statut « file » et par `wa_outbox`. Ce module
--      dépose dans la file existante, il n'en ouvre pas une deuxième.
--   3. JAMAIS LA VALEUR D'UN SECRET EN BASE. Un webhook garde le NOM de son
--      secret dans le coffre, comme whatsapp_accounts garde celui du jeton.

-- ------------------------------------------------------------------
-- 1 · Les notifications
-- ------------------------------------------------------------------

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies on delete cascade,
  -- Le bureau concerné. Il sert au cloisonnement quand la notification
  -- n'a pas de destinataire nommé.
  office_id   uuid references offices on delete cascade,
  -- Le destinataire. Nul veut dire « tout le bureau » : c'est un geste à
  -- faire une fois, pas une nouvelle personnelle.
  user_id     uuid references profiles on delete cascade,
  kind        text not null check (kind in (
                'decision','piece','rendez_vous','prospect','message',
                'paiement','cargaison','douane','livraison','systeme')),
  severity    text not null default 'info'
              check (severity in ('info','attention','urgent')),
  -- Le titre porte un CODE d'événement, pas une phrase. L'agence travaille en
  -- quatre langues et la ligne est écrite une fois pour toutes : traduire au
  -- moment du dépôt figerait la langue de celui qui a déclenché. Le front
  -- résout `notif.e.<title>` et retombe sur le texte brut s'il ne connaît pas
  -- la clé. Le corps, lui, est du texte libre (un nom, une référence).
  title       text not null,
  body        text,
  -- À quoi la ligne se rapporte. Pas de clé étrangère : l'entité peut vivre
  -- dans cases, shipments, clients, payments, ou dans une table d'un module
  -- encore en construction. Une clé étrangère ici casserait au premier module
  -- livré après celui-ci.
  entity_type text,
  entity_id   uuid,
  -- Où le clic mène, côté application. Chemin relatif, jamais une URL externe.
  url         text,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz
);

-- La requête de la cloche, toutes les minutes, pour chaque agent connecté.
-- C'est le seul index qui compte vraiment ici.
create index if not exists notifications_inbox on notifications (user_id, read_at);
-- Et celle du bureau, quand la ligne n'a pas de destinataire nommé.
create index if not exists notifications_office on notifications (agency_id, office_id, created_at desc)
  where user_id is null;
-- Le ménage quotidien, qui balaie par date d'expiration.
create index if not exists notifications_expiry on notifications (expires_at)
  where expires_at is not null;

comment on table notifications is
  'Une nouvelle qui existe côté serveur. La cloche la lit au lieu de la deviner : ce qui est lu reste lu d''un poste à l''autre, et ce qui n''a été vu par personne ne disparaît pas au rechargement de la page.';
comment on column notifications.user_id is
  'Nul veut dire « tout le bureau ». Le premier qui la traite la marque lue pour tout le monde : une notification de bureau représente un geste à faire une fois, pas une nouvelle à lire chacun de son côté.';
comment on column notifications.created_at is
  'Sert aussi de moment d''échéance : une règle avec un délai dépose la ligne datée du futur, et la cloche ne montre que ce qui est arrivé à terme. Aucun ordonnanceur n''est nécessaire pour ça.';

-- ------------------------------------------------------------------
-- 2 · Les règles de notification
-- ------------------------------------------------------------------
--
-- Elles ne remplacent pas `automation_rules` : celles-là décrivent des
-- RELANCES temporelles (« pièce manquante depuis 3 jours »), avec un délai de
-- garde par dossier. Celles-ci décrivent un ROUTAGE : quand tel fait se
-- produit, qui est prévenu, par quel canal. Les deux se croisent sans se
-- recouvrir, et fusionner les deux modèles rendrait les deux illisibles.

create table if not exists notification_rules (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies on delete cascade,
  event         text not null check (event in (
                  'client.cree','dossier.cree','dossier.etape','dossier.decision',
                  'piece.manquante','piece.recue','piece.expiree',
                  'rendez_vous.pris','rendez_vous.demain',
                  'passeport.recu','passeport.disponible','passeport.remis',
                  'paiement.recu','paiement.solde','facture.echue',
                  'prospect.nouveau','prospect.relance',
                  'cargaison.creee','cargaison.depart','cargaison.arrivee',
                  'cargaison.douane','cargaison.mainlevee','cargaison.livraison',
                  'surestaries.risque','quota.depasse')),
  channel       text not null check (channel in ('in_app','email','whatsapp','sms','push')),
  recipient     text not null check (recipient in ('client','agent','manager','owner','bureau')),
  -- La clé d'un modèle de `message_templates`. Obligatoire, en pratique, pour
  -- tout ce qui sort de l'agence : sans corps, rien n'est envoyé.
  template_key  text,
  enabled       boolean not null default false,
  -- Le décalage. Utile pour laisser à l'agent le temps de corriger avant que
  -- le client ne soit prévenu.
  delay_minutes int not null default 0 check (delay_minutes >= 0),
  created_at    timestamptz not null default now(),
  unique (agency_id, event, channel, recipient)
);
create index if not exists notification_rules_lookup
  on notification_rules (agency_id, event) where enabled;

comment on table notification_rules is
  'Le routage : quel fait prévient qui, par quel canal. Une règle vers le client est un engagement financier et commercial de l''agence : elle ne s''active qu''à la main.';

-- ------------------------------------------------------------------
-- 3 · Les webhooks
-- ------------------------------------------------------------------

create table if not exists webhooks (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references agencies on delete cascade,
  -- '*' prend tout. Sinon, un des événements de notification_rules.
  event           text not null,
  endpoint        text not null check (endpoint ~ '^https://'),
  -- Le NOM du secret dans le coffre, jamais sa valeur. Même règle que le
  -- jeton WhatsApp : une table lisible par le propriétaire qui contiendrait
  -- la clé de signature permettrait de forger des appels au nom de l'agence.
  secret_name     text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  last_error      text,
  failure_count   int not null default 0
);
create index if not exists webhooks_lookup on webhooks (agency_id, event) where active;

comment on column webhooks.secret_name is
  'Nom du secret dans le coffre Supabase. La valeur n''entre jamais en base : la fonction de bord la lit par vault_read, et elle seule.';

create table if not exists webhook_deliveries (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references agencies on delete cascade,
  webhook_id       uuid not null references webhooks on delete cascade,
  event            text not null,
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'en_attente'
                   check (status in ('en_attente','envoye','echoue')),
  http_status      int,
  -- Les premiers caractères de la réponse. Un corps entier remplirait la base
  -- pour rien, et la moitié du temps c'est une page HTML d'erreur.
  response_excerpt text,
  attempts         int not null default 0,
  next_attempt_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  delivered_at     timestamptz
);
-- La requête de la fonction de bord : ce qui est dû, dans l'ordre.
create index if not exists webhook_deliveries_due
  on webhook_deliveries (next_attempt_at) where status = 'en_attente';
create index if not exists webhook_deliveries_hist
  on webhook_deliveries (webhook_id, created_at desc);

-- LE RECUL CROISSANT.
--
-- Un serveur tiers tombe, et il retombe. Rejouer toutes les minutes pendant
-- une heure ne le réveille pas, ça le noie. La règle tenue ici :
--
--   1re tentative  : tout de suite
--   après 1 échec  : + 1 minute
--   après 2 échecs : + 2 minutes
--   après 3 échecs : + 4 minutes    (le double à chaque fois)
--   ...            : plafonné à 6 heures
--   après 8 échecs : on abandonne, la remise passe en « echoue »
--
-- Huit tentatives couvrent un peu plus de quatre heures de panne. Au-delà,
-- l'agence doit être prévenue plutôt que la base doit insister.
create or replace function webhook_backoff(p_attempts int)
returns interval
language sql immutable
set search_path = public
as $$
  select least(interval '6 hours',
               interval '1 minute' * power(2, greatest(p_attempts, 1) - 1))
$$;

comment on function webhook_backoff(int) is
  'Le recul entre deux tentatives : une minute, puis le double à chaque échec, plafonné à six heures.';

-- ------------------------------------------------------------------
-- 4 · Deux petites tables de correspondance
-- ------------------------------------------------------------------
-- Elles vivent en fonctions plutôt qu'en tables : elles ne se configurent pas,
-- elles décrivent le vocabulaire du produit.

create or replace function notif_kind_for(p_event text)
returns text
language sql immutable
set search_path = public
as $$
  select case
    when p_event = 'dossier.decision' then 'decision'
    when p_event like 'piece.%' then 'piece'
    -- Un passeport est une pièce : c'est celle qui fait peur à l'agence.
    when p_event like 'passeport.%' then 'piece'
    when p_event like 'rendez_vous.%' then 'rendez_vous'
    when p_event like 'prospect.%' or p_event = 'client.cree' then 'prospect'
    when p_event like 'paiement.%' or p_event = 'facture.echue' then 'paiement'
    when p_event = 'cargaison.douane' or p_event = 'cargaison.mainlevee' then 'douane'
    when p_event = 'cargaison.livraison' then 'livraison'
    when p_event like 'cargaison.%' or p_event = 'surestaries.risque' then 'cargaison'
    when p_event like 'message.%' then 'message'
    else 'systeme'
  end
$$;

create or replace function notif_severity_for(p_event text)
returns text
language sql immutable
set search_path = public
as $$
  select case
    -- Ce qui coûte de l'argent tous les jours, ou qui fait rater un voyage.
    when p_event in ('surestaries.risque','facture.echue','piece.expiree','quota.depasse')
      then 'urgent'
    when p_event in ('piece.manquante','rendez_vous.demain','prospect.relance',
                     'cargaison.douane','paiement.solde','dossier.decision')
      then 'attention'
    else 'info'
  end
$$;

-- Le remplacement des variables d'un modèle. Les modèles du produit s'écrivent
-- avec des accolades : « Bonjour {client}, votre dossier {reference}... ».
create or replace function notif_render(p_body text, p_vars jsonb)
returns text
language plpgsql immutable
set search_path = public
as $$
declare out text := p_body; k text; v text;
begin
  if p_body is null then return null; end if;
  for k, v in select key, value from jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) loop
    out := replace(out, '{' || k || '}', coalesce(v, ''));
  end loop;
  return out;
end $$;

-- ------------------------------------------------------------------
-- 5 · notify : le point d'entrée unique
-- ------------------------------------------------------------------
-- Tout ce qui dépose une notification passe par là. Une insertion directe
-- dans la table est refusée : il n'existe aucune politique d'insertion, et
-- c'est délibéré. Un seul chemin, un seul endroit à relire.

create or replace function notify(
  p_agency      uuid,
  p_office      uuid,
  p_user        uuid,
  p_kind        text,
  p_severity    text default 'info',
  p_title       text default 'systeme',
  p_body        text default null,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_url         text default null,
  p_delay_minutes int default 0,
  p_expires_at  timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  -- Le garde qui a manqué à `run_automations` avant la migration 0015 : sans
  -- lui, un compte de l'agence A dépose une notification chez l'agence B en
  -- passant simplement son identifiant. Quand l'appelant n'a pas de session
  -- (clé de service, tâche planifiée, autre fonction SECURITY DEFINER),
  -- auth.uid() est nul et le test ne s'applique pas.
  if auth.uid() is not null and p_agency is distinct from auth_agency_id() then
    raise exception 'interdit' using errcode = 'P0001';
  end if;
  if p_agency is null then
    raise exception 'agence absente' using errcode = 'P0001';
  end if;

  insert into notifications (
    agency_id, office_id, user_id, kind, severity, title, body,
    entity_type, entity_id, url, created_at, expires_at)
  values (
    p_agency, p_office, p_user, p_kind, coalesce(p_severity, 'info'),
    p_title, p_body, p_entity_type, p_entity_id, p_url,
    now() + make_interval(mins => greatest(coalesce(p_delay_minutes, 0), 0)),
    p_expires_at)
  returning id into v_id;

  return v_id;
end $$;

-- ------------------------------------------------------------------
-- 6 · notify_event : le cœur du module
-- ------------------------------------------------------------------
--
-- Il lit les règles de l'agence, résout les rôles en comptes réels, dépose les
-- notifications en application, met les messages WhatsApp dans la file
-- EXISTANTE (`messages` en statut « file », que wa_outbox vide déjà), et pose
-- les remises de webhook.
--
-- Ce qu'il ne fait PAS, et pourquoi :
--   · e-mail, SMS et push n'ont aucun transport branché à ce jour. Une règle
--     sur ces canaux se conserve, mais elle ne produit rien. Faire semblant
--     serait pire que ne rien faire : l'agence croirait le client prévenu.
--   · un envoi WhatsApp vers un employé n'existe pas : wa_outbox se raccroche
--     à `clients`, et le produit ne tient pas les numéros WhatsApp du
--     personnel. Une règle whatsapp vers un rôle interne ne produit rien.
--   · rien ne part si le modèle de message est introuvable ou vide. Un
--     message au corps vide part quand même chez Meta, et il est facturé.

create or replace function notify_event(
  p_agency      uuid,
  p_event       text,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_payload     jsonb default '{}'::jsonb
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r            record;
  p            record;
  v_kind       text;
  v_sev        text;
  v_office     uuid;
  v_client     uuid;
  v_case       uuid;
  v_shipment   uuid;
  v_url        text;
  v_body       text;
  v_tpl        jsonb;
  v_locale     text;
  v_count      int := 0;
  v_payload    jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if auth.uid() is not null and p_agency is distinct from auth_agency_id() then
    raise exception 'interdit' using errcode = 'P0001';
  end if;
  if p_agency is null or p_event is null then
    return 0;
  end if;

  v_kind := notif_kind_for(p_event);
  v_sev  := coalesce(v_payload ->> 'severity', notif_severity_for(p_event));

  -- Le contexte : on le déduit de l'entité quand on peut, sinon on prend ce
  -- que l'appelant a joint. Deviner mal vaut mieux que ne rien montrer, mais
  -- déduire vaut mieux que deviner.
  v_office   := nullif(v_payload ->> 'office_id', '')::uuid;
  v_client   := nullif(v_payload ->> 'client_id', '')::uuid;
  v_case     := nullif(v_payload ->> 'case_id', '')::uuid;
  v_shipment := nullif(v_payload ->> 'shipment_id', '')::uuid;

  if p_entity_type = 'case' and p_entity_id is not null then
    select c.office_id, c.client_id, c.id into v_office, v_client, v_case
    from cases c where c.id = p_entity_id and c.agency_id = p_agency;
  elsif p_entity_type = 'shipment' and p_entity_id is not null then
    select s.office_id, s.id into v_office, v_shipment
    from shipments s where s.id = p_entity_id and s.agency_id = p_agency;
  elsif p_entity_type = 'client' and p_entity_id is not null then
    select cl.office_id, cl.id into v_office, v_client
    from clients cl where cl.id = p_entity_id and cl.agency_id = p_agency;
  end if;

  v_office   := coalesce(v_office, nullif(v_payload ->> 'office_id', '')::uuid);
  v_client   := coalesce(v_client, nullif(v_payload ->> 'client_id', '')::uuid);

  -- Où le clic mène. Les chemins suivent ceux de l'application.
  v_url := coalesce(
    nullif(v_payload ->> 'url', ''),
    case p_entity_type
      when 'case'     then '/cases/' || p_entity_id
      when 'shipment' then '/shipments/' || p_entity_id
      when 'client'   then '/clients/' || p_entity_id
      else null end);

  for r in
    select * from notification_rules
    where agency_id = p_agency and event = p_event and enabled
  loop
    ------------------------------------------------------------------
    -- Canal « en application »
    ------------------------------------------------------------------
    if r.channel = 'in_app' then
      if r.recipient = 'client' then
        -- Un client n'a pas de compte : il n'a pas de cloche. Rien à faire.
        continue;

      elsif r.recipient = 'bureau' then
        if v_office is not null then
          perform notify(p_agency, v_office, null, v_kind, v_sev, p_event,
                         v_payload ->> 'body', p_entity_type, p_entity_id, v_url,
                         r.delay_minutes);
          v_count := v_count + 1;
        else
          -- Sans bureau déduit, on prévient chaque bureau actif plutôt que de
          -- déposer une ligne que seuls la direction et les comptes sans
          -- bureau verraient.
          for p in select id from offices where agency_id = p_agency and active loop
            perform notify(p_agency, p.id, null, v_kind, v_sev, p_event,
                           v_payload ->> 'body', p_entity_type, p_entity_id, v_url,
                           r.delay_minutes);
            v_count := v_count + 1;
          end loop;
        end if;

      else
        -- Un rôle se résout en comptes réels. « agent » vise d'abord la
        -- personne à qui le dossier est confié : prévenir les huit agents du
        -- bureau quand une seule personne suit l'affaire fait décrocher tout
        -- le monde.
        for p in
          select pr.id
          from profiles pr
          where pr.agency_id = p_agency and pr.active
            and (
              (r.recipient = 'agent' and (
                 pr.id = coalesce(
                   (select c.assignee_id from cases c where c.id = v_case),
                   (select s.assignee_id from shipments s where s.id = v_shipment))
                 or (
                   coalesce(
                     (select c.assignee_id from cases c where c.id = v_case),
                     (select s.assignee_id from shipments s where s.id = v_shipment)) is null
                   and pr.role = 'agent'
                   and (v_office is null or pr.office_id is not distinct from v_office))))
              or (r.recipient = 'manager' and pr.role = 'manager')
              or (r.recipient = 'owner' and pr.role = 'owner'))
        loop
          perform notify(p_agency, v_office, p.id, v_kind, v_sev, p_event,
                         v_payload ->> 'body', p_entity_type, p_entity_id, v_url,
                         r.delay_minutes);
          v_count := v_count + 1;
        end loop;
      end if;

    ------------------------------------------------------------------
    -- Canal WhatsApp
    ------------------------------------------------------------------
    elsif r.channel = 'whatsapp' then
      -- Seul un client reçoit du WhatsApp : la file existante se raccroche à
      -- `clients`, et le produit ne tient pas les numéros du personnel.
      if r.recipient <> 'client' or v_client is null then
        continue;
      end if;

      select cl.locale into v_locale from clients cl where cl.id = v_client;
      select mt.body into v_tpl
      from message_templates mt
      where mt.agency_id = p_agency and mt.key = r.template_key and not mt.archived;

      v_body := notif_render(
        coalesce(v_tpl ->> coalesce(v_locale, 'fr'), v_tpl ->> 'fr'),
        v_payload);

      -- Pas de modèle, pas de corps, pas d'envoi. Un message vide part quand
      -- même chez Meta, et il est facturé au même prix qu'un vrai.
      if v_body is null or btrim(v_body) = '' then
        continue;
      end if;

      -- La file EXISTANTE. On n'en ouvre pas une deuxième : `wa_outbox` sait
      -- déjà refuser un envoi hors fenêtre sans modèle approuvé, et c'est
      -- exactement le contrôle qu'il ne faut pas contourner.
      insert into messages (
        agency_id, case_id, shipment_id, client_id, channel, direction, body,
        locale, template_key, status, automated, at)
      values (
        p_agency, v_case, v_shipment, v_client, 'whatsapp', 'sortant', v_body,
        coalesce(v_locale, 'fr'), r.template_key, 'file', true,
        now() + make_interval(mins => greatest(r.delay_minutes, 0)));
      v_count := v_count + 1;

    ------------------------------------------------------------------
    -- Les canaux sans transport
    ------------------------------------------------------------------
    else
      -- e-mail, SMS, push : la règle est conservée, elle ne produit rien tant
      -- qu'aucun transport n'est branché. Voir le commentaire d'en-tête.
      continue;
    end if;
  end loop;

  ------------------------------------------------------------------
  -- Les webhooks
  ------------------------------------------------------------------
  -- Ils ne dépendent d'aucune règle de notification : un logiciel tiers
  -- abonné à un événement doit le recevoir même si personne dans l'agence
  -- n'a demandé à être prévenu.
  insert into webhook_deliveries (agency_id, webhook_id, event, payload)
  select p_agency, w.id, p_event,
         jsonb_build_object(
           'event', p_event,
           'entity_type', p_entity_type,
           'entity_id', p_entity_id,
           'at', now(),
           'data', v_payload)
  from webhooks w
  where w.agency_id = p_agency and w.active and w.event in (p_event, '*');

  return v_count;
end $$;

-- ------------------------------------------------------------------
-- 7 · Ce que la cloche lit
-- ------------------------------------------------------------------

create or replace function my_notifications(
  p_limit integer default 40,
  p_only_unread boolean default false
) returns table (
  id uuid, kind text, severity text, title text, body text,
  entity_type text, entity_id uuid, url text,
  read_at timestamptz, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.kind, n.severity, n.title, n.body,
         n.entity_type, n.entity_id, n.url, n.read_at, n.created_at
  from notifications n
  where n.agency_id = auth_agency_id()
    and (n.user_id = auth.uid()
         or (n.user_id is null and auth_sees_office(n.office_id)))
    -- Une ligne datée du futur attend son heure : c'est ainsi qu'un délai est
    -- tenu sans ordonnanceur.
    and n.created_at <= now()
    and (n.expires_at is null or n.expires_at > now())
    and (not p_only_unread or n.read_at is null)
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 40), 200))
$$;

create or replace function unread_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from notifications n
  where n.agency_id = auth_agency_id()
    and n.read_at is null
    and (n.user_id = auth.uid()
         or (n.user_id is null and auth_sees_office(n.office_id)))
    and n.created_at <= now()
    and (n.expires_at is null or n.expires_at > now())
$$;

create or replace function notifications_read(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update notifications
     set read_at = now()
   where id = any (coalesce(p_ids, '{}'::uuid[]))
     and read_at is null
     and agency_id = auth_agency_id()
     -- Le même test que la lecture : on ne marque lu que ce qu'on a le droit
     -- de voir. Sans lui, un identifiant deviné éteindrait la cloche d'autrui.
     and (user_id = auth.uid()
          or (user_id is null and auth_sees_office(office_id)));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function notifications_read_all()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update notifications
     set read_at = now()
   where read_at is null
     and agency_id = auth_agency_id()
     and created_at <= now()
     and (user_id = auth.uid()
          or (user_id is null and auth_sees_office(office_id)));
  get diagnostics n = row_count;
  return n;
end $$;

-- ------------------------------------------------------------------
-- 8 · La sortie vers l'extérieur
-- ------------------------------------------------------------------
-- Ces deux fonctions sont pour la fonction de bord, et pour elle seule. Elles
-- ne portent aucun filtre d'agence : un compte authentifié qui pourrait les
-- appeler lirait les remises de toutes les agences. D'où le grant à
-- `service_role` uniquement, et rien d'autre.

create or replace function webhook_pending(p_limit integer default 50)
returns table (
  id uuid, agency_id uuid, webhook_id uuid, event text,
  endpoint text, secret_name text, payload jsonb, attempts int
)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.agency_id, d.webhook_id, d.event,
         w.endpoint, w.secret_name, d.payload, d.attempts
  from webhook_deliveries d
  join webhooks w on w.id = d.webhook_id
  where d.status = 'en_attente'
    and w.active
    and d.next_attempt_at <= now()
  order by d.next_attempt_at
  limit greatest(1, least(coalesce(p_limit, 50), 500))
$$;

create or replace function webhook_mark(
  p_delivery uuid,
  p_ok boolean,
  p_http_status int default null,
  p_excerpt text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare d webhook_deliveries;
begin
  select * into d from webhook_deliveries where id = p_delivery;
  if not found then return; end if;

  if p_ok then
    update webhook_deliveries
       set status = 'envoye', delivered_at = now(),
           attempts = d.attempts + 1,
           http_status = p_http_status,
           response_excerpt = left(coalesce(p_excerpt, ''), 500)
     where id = p_delivery;
    update webhooks
       set last_success_at = now(), last_error = null, failure_count = 0
     where id = d.webhook_id;
  else
    update webhook_deliveries
       set attempts = d.attempts + 1,
           http_status = p_http_status,
           response_excerpt = left(coalesce(p_excerpt, ''), 500),
           -- Huit tentatives, puis on renonce. Voir webhook_backoff.
           status = case when d.attempts + 1 >= 8 then 'echoue' else 'en_attente' end,
           next_attempt_at = now() + webhook_backoff(d.attempts + 1)
     where id = p_delivery;
    update webhooks
       set last_error = left(coalesce(p_excerpt, 'échec'), 500),
           failure_count = webhooks.failure_count + 1
     where id = d.webhook_id;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 9 · La balayeuse quotidienne
-- ------------------------------------------------------------------
--
-- Elle produit les alertes qui ne viennent d'AUCUN geste : personne n'a
-- cliqué, personne n'a saisi, et pourtant la situation a changé parce que le
-- temps a passé. C'est la moitié la plus utile du module, et celle qu'aucune
-- interface ne peut produire.
--
-- Sept veilles :
--   1. le passeport du client expire bientôt (moins de six mois : la règle
--      Schengen exige trois mois de validité APRÈS le retour) ;
--   2. une pièce du dossier est expirée ;
--   3. un rendez-vous a lieu demain ;
--   4. un dossier ouvert n'a pas bougé depuis dix jours ;
--   5. une facture est échue ;
--   6. les jours francs d'un conteneur se terminent ;
--   7. un conteneur est déjà en dépassement.
--
-- Les deux dernières NE RECALCULENT RIEN : elles lisent `shipment_counters`
-- (migration 0029), qui tient déjà les trois horloges, les paliers et la
-- majoration de congestion. Réécrire ce calcul ici le ferait diverger au
-- premier correctif, et un compteur de surestaries qui diverge fait facturer
-- faux tous les jours.
--
-- L'IDEMPOTENCE : la tâche tourne tous les jours, et parfois deux fois le même
-- jour (reprise après incident). Une même alerte ne doit pas s'empiler. On ne
-- pose pas de colonne de déduplication : on refuse de redéposer ce qui a déjà
-- été déposé dans les vingt dernières heures pour la même entité et le même
-- titre. Vingt heures et non vingt-quatre, pour qu'un décalage d'horaire de la
-- tâche ne saute pas une journée.

create or replace function notif_recent(p_agency uuid, p_title text, p_entity uuid)
returns boolean
language sql stable
set search_path = public
as $$
  select exists (
    select 1 from notifications
    where agency_id = p_agency
      and title = p_title
      and entity_id is not distinct from p_entity
      and created_at > now() - interval '20 hours')
$$;

create or replace function notification_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a        record;
  x        record;
  c        jsonb;
  v_n      int := 0;
  v_purged int := 0;
  v_only   uuid;
begin
  -- Appelée sans session par la tâche planifiée. Appelée depuis l'application,
  -- elle se limite à l'agence de l'appelant, et seulement pour qui gère les
  -- automatisations : sinon un `viewer` déclenche le balayage de tout le parc.
  if auth.uid() is not null then
    if not auth_can('automation:manage') then
      raise exception 'interdit' using errcode = 'P0001';
    end if;
    v_only := auth_agency_id();
  end if;

  for a in
    select id from agencies
    where deleted_at is null and suspended_at is null
      and (v_only is null or id = v_only)
  loop
    -- 1 · Le passeport qui expire. Six mois : trois mois de validité après le
    -- retour sont exigés, et un renouvellement tunisien prend des semaines.
    for x in
      select cl.id, cl.office_id, cl.first_name, cl.last_name, cl.passport_expiry
      from clients cl
      where cl.agency_id = a.id and cl.deleted_at is null
        and cl.passport_expiry is not null
        and cl.passport_expiry <= current_date + 180
        and cl.passport_expiry > current_date
        and exists (select 1 from cases k
                    where k.client_id = cl.id and k.status = 'ouvert')
    loop
      if not notif_recent(a.id, 'passeport.expire_bientot', x.id) then
        perform notify(a.id, x.office_id, null, 'piece', 'attention',
                       'passeport.expire_bientot',
                       x.first_name || ' ' || x.last_name || ' · ' || x.passport_expiry,
                       'client', x.id, '/clients/' || x.id);
        v_n := v_n + 1;
      end if;
    end loop;

    -- 2 · La pièce expirée. Elle passe par notify_event : l'agence peut avoir
    -- décidé d'en prévenir le client, et c'est sa décision, pas la nôtre.
    for x in
      select d.id, d.case_id, d.key, k.reference, k.client_id, k.office_id
      from case_documents d
      join cases k on k.id = d.case_id
      where d.agency_id = a.id and k.status = 'ouvert'
        and (d.state = 'expiree'
             or (d.expires_at is not null and d.expires_at < current_date
                 and d.state in ('recue','validee')))
    loop
      -- L'entité portée est la PIÈCE, pas le dossier : deux pièces expirées
      -- sur le même dossier sont deux alertes, pas une.
      if not notif_recent(a.id, 'piece.expiree', x.id) then
        v_n := v_n + notify_event(a.id, 'piece.expiree', 'case_document', x.id,
          jsonb_build_object(
            'body', x.reference || ' · ' || x.key,
            'client_id', x.client_id, 'office_id', x.office_id,
            'case_id', x.case_id, 'url', '/cases/' || x.case_id,
            'piece', x.key, 'reference', x.reference));
      end if;
    end loop;

    -- 3 · Le rendez-vous de demain.
    for x in
      select ap.id, ap.case_id, ap.at, ap.location, ap.office_id,
             k.reference, k.client_id, cl.first_name,
             coalesce(k.office_id, ap.office_id) as off
      from appointments ap
      left join cases k on k.id = ap.case_id
      left join clients cl on cl.id = k.client_id
      where ap.agency_id = a.id and ap.status = 'prevu'
        and ap.at::date = current_date + 1
    loop
      if not notif_recent(a.id, 'rendez_vous.demain', x.id) then
        v_n := v_n + notify_event(a.id, 'rendez_vous.demain', 'appointment', x.id,
          jsonb_build_object(
            'body', coalesce(x.reference, coalesce(x.location, '')),
            'client_id', x.client_id, 'office_id', x.off, 'case_id', x.case_id,
            'url', case when x.case_id is not null
                        then '/cases/' || x.case_id else '/appointments' end,
            'client', coalesce(x.first_name, ''),
            'date', to_char(x.at, 'DD/MM/YYYY HH24:MI'),
            'lieu', coalesce(x.location, ''), 'reference', coalesce(x.reference, '')));
      end if;
    end loop;

    -- 4 · Le dossier endormi. Dix jours sans rien : ni note, ni pièce, ni
    -- message. C'est celui qu'on retrouve la veille du départ.
    for x in
      select k.id, k.reference, k.office_id, k.assignee_id
      from cases k
      where k.agency_id = a.id and k.status = 'ouvert'
        and k.updated_at < now() - interval '10 days'
        and not exists (
          select 1 from activity_events e
          where e.case_id = k.id and e.at > now() - interval '10 days')
    loop
      if not notif_recent(a.id, 'dossier.sans_activite', x.id) then
        perform notify(a.id, x.office_id, x.assignee_id, 'systeme', 'attention',
                       'dossier.sans_activite', x.reference,
                       'case', x.id, '/cases/' || x.id);
        v_n := v_n + 1;
      end if;
    end loop;

    -- 5 · La facture échue.
    for x in
      select p.id, p.case_id, p.shipment_id, p.client_id, p.office_id,
             p.amount, p.currency, p.due_at
      from payments p
      where p.agency_id = a.id and p.state in ('du','partiel')
        and p.due_at is not null and p.due_at < current_date
    loop
      if not notif_recent(a.id, 'facture.echue', x.id) then
        v_n := v_n + notify_event(a.id, 'facture.echue', 'payment', x.id,
          jsonb_build_object(
            'body', x.amount || ' ' || x.currency,
            'client_id', x.client_id, 'office_id', x.office_id,
            'case_id', x.case_id, 'shipment_id', x.shipment_id,
            'url', case when x.case_id is not null
                        then '/cases/' || x.case_id else '/payments' end,
            'montant', x.amount::text, 'devise', x.currency));
      end if;
    end loop;

    -- 6 et 7 · Les conteneurs. On lit `shipment_counters` : les trois horloges,
    -- les jours francs et les paliers y sont déjà, et ils ne se recalculent pas.
    for x in
      select s.id, s.reference, s.office_id
      from shipments s
      where s.agency_id = a.id and s.status = 'en_cours'
        and (s.discharged_at is not null or s.arrived_at is not null)
    loop
      for c in select value from jsonb_array_elements(shipment_counters(x.id)) loop
        if c ->> 'status' = 'en_depassement' then
          if not notif_recent(a.id, 'surestaries.risque', x.id) then
            v_n := v_n + notify_event(a.id, 'surestaries.risque', 'shipment', x.id,
              jsonb_build_object(
                'body', x.reference || ' · ' || (c ->> 'kind') || ' · '
                        || coalesce(c ->> 'amount', '?') || ' ' || coalesce(c ->> 'currency', ''),
                'office_id', x.office_id, 'reference', x.reference));
          end if;
        elsif c ->> 'status' = 'dans_les_francs'
          and (c ->> 'free_days')::int - (c ->> 'elapsed_days')::int <= 2 then
          -- Deux jours avant la fin des jours francs : c'est le dernier moment
          -- où sortir le conteneur ne coûte encore rien.
          if not notif_recent(a.id, 'jours_francs.bientot_finis', x.id) then
            perform notify(a.id, x.office_id, null, 'cargaison', 'attention',
                           'jours_francs.bientot_finis',
                           x.reference || ' · ' || (c ->> 'kind') || ' · J-'
                           || ((c ->> 'free_days')::int - (c ->> 'elapsed_days')::int),
                           'shipment', x.id, '/shipments/' || x.id);
            v_n := v_n + 1;
          end if;
        end if;
      end loop;
    end loop;
  end loop;

  -- Le ménage. Une notification expirée ne sert plus, et une notification lue
  -- il y a trois mois non plus. La table de la cloche doit rester petite : elle
  -- est relue toutes les minutes par chaque poste ouvert.
  -- Quand un compte de l'agence a déclenché le balayage, le ménage se limite
  -- à son agence : une tâche d'une agence n'efface rien chez une autre.
  delete from notifications
  where (v_only is null or agency_id = v_only)
    and ((expires_at is not null and expires_at < now())
      or (read_at is not null and read_at < now() - interval '90 days')
      or created_at < now() - interval '180 days');
  get diagnostics v_purged = row_count;

  return jsonb_build_object('deposees', v_n, 'purgees', v_purged);
end $$;

-- ------------------------------------------------------------------
-- 10 · Le jeu de départ
-- ------------------------------------------------------------------
--
-- Deux moitiés, et elles n'ont pas le même statut.
--
-- CÔTÉ ÉQUIPE, tout est actif : une notification en application ne coûte rien,
-- n'engage rien, et ne sort pas de l'agence. Une agence qui ouvre le produit
-- doit voir la cloche vivre le premier jour, sinon elle conclut qu'elle ne
-- marche pas.
--
-- CÔTÉ CLIENT, TOUT NAÎT DÉSACTIVÉ, sans exception. Trois raisons, et chacune
-- suffirait :
--   · un message WhatsApp est FACTURÉ par Meta à chaque envoi hors fenêtre de
--     24 heures. Livrer des règles actives, c'est prélever sur la trésorerie
--     d'une agence qui n'a rien demandé ;
--   · le texte envoyé engage l'agence devant son client. L'éditeur n'a pas à
--     écrire au nom de l'agence sans qu'elle ait lu la phrase ;
--   · une agence qui découvre que son logiciel a écrit à ses clients dans son
--     dos ne le rouvre pas.
-- L'agence active ce qu'elle veut, une règle à la fois, en connaissance de
-- cause. C'est le seul ordre acceptable.

create or replace function seed_notification_rules(p_agency uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- L'équipe, en application. Actif.
  insert into notification_rules (agency_id, event, channel, recipient, enabled)
  select p_agency, d.event, 'in_app', d.recipient, true
  from (values
    ('dossier.decision',    'agent'),
    ('piece.recue',         'agent'),
    ('piece.manquante',     'agent'),
    ('rendez_vous.demain',  'agent'),
    -- La balayeuse quotidienne écrit par ces trois-là : sans règle en face,
    -- une pièce expirée ou un conteneur qui déborde ne préviendrait personne.
    ('piece.expiree',       'agent'),
    ('passeport.recu',      'agent'),
    ('passeport.disponible','agent'),
    ('prospect.nouveau',    'bureau'),
    ('prospect.relance',    'bureau'),
    ('paiement.recu',       'bureau'),
    ('cargaison.arrivee',   'bureau'),
    ('cargaison.douane',    'bureau'),
    ('cargaison.mainlevee', 'bureau'),
    ('cargaison.livraison', 'bureau'),
    -- L'argent et les compteurs qui tournent remontent à la direction.
    ('facture.echue',       'manager'),
    ('surestaries.risque',  'manager'),
    ('quota.depasse',       'owner')
  ) as d(event, recipient)
  on conflict (agency_id, event, channel, recipient) do nothing;

  -- Le client, par WhatsApp. DÉSACTIVÉ. Voir le commentaire ci-dessus.
  -- Les six événements retenus sont ceux qui concernent vraiment le client :
  -- ce qu'il doit faire, où il doit venir, et ce qu'il attend.
  insert into notification_rules
    (agency_id, event, channel, recipient, template_key, enabled)
  select p_agency, d.event, 'whatsapp', 'client', d.tpl, false
  from (values
    ('piece.manquante',      'piece_manquante'),
    ('rendez_vous.pris',     'rappel_rdv'),
    ('passeport.disponible', 'passeport_pret'),
    -- Ces deux-là n'ont pas de modèle livré : annoncer une décision ou une
    -- arrivée de marchandise avec une phrase écrite par l'éditeur serait
    -- parler au nom de l'agence. Elle écrit le texte, puis elle active.
    ('dossier.decision',     null),
    ('cargaison.arrivee',    null),
    ('cargaison.livraison',  null)
  ) as d(event, tpl)
  -- Pas de rappel WhatsApp de la veille ici : `automation_rules` en pose déjà
  -- un à l'ouverture de l'agence (« Rappeler le rendez-vous la veille »). En
  -- semer un deuxième ferait partir deux messages et deux factures pour le
  -- même rendez-vous. L'agence garde celui qu'elle veut.
  on conflict (agency_id, event, channel, recipient) do nothing;
end $$;

-- Une agence créée après cette migration reçoit le jeu sans que personne n'y
-- pense : la création d'agence passe par plusieurs chemins, et les appeler un
-- par un laisserait le suivant à découvert.
create or replace function seed_notification_rules_on_agency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform seed_notification_rules(new.id);
  return new;
end $$;

drop trigger if exists agencies_seed_notification_rules on agencies;
create trigger agencies_seed_notification_rules after insert on agencies
  for each row execute function seed_notification_rules_on_agency();

-- Et les agences déjà là.
do $$
declare a uuid;
begin
  for a in select id from agencies loop perform seed_notification_rules(a); end loop;
end $$;

-- ------------------------------------------------------------------
-- 11 · Cloisonnement
-- ------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['notifications','notification_rules','webhooks','webhook_deliveries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

drop policy if exists notifications_select on notifications;
drop policy if exists notifications_update on notifications;
drop policy if exists notifications_delete on notifications;

-- La règle du module, celle qui décide de tout : on lit sa propre notification,
-- ou celle de son bureau quand elle n'a pas de destinataire nommé. Un agent
-- d'un autre bureau ne voit rien, propriétaire et responsable voient tout.
create policy notifications_select on notifications for select to authenticated
  using (agency_id = auth_agency_id()
         and (user_id = auth.uid()
              or (user_id is null and auth_sees_office(office_id))));
create policy notifications_update on notifications for update to authenticated
  using (agency_id = auth_agency_id()
         and (user_id = auth.uid()
              or (user_id is null and auth_sees_office(office_id))))
  with check (agency_id = auth_agency_id());
create policy notifications_delete on notifications for delete to authenticated
  using (agency_id = auth_agency_id() and auth_role() in ('owner','manager'));
-- AUCUNE politique d'insertion, pour personne. `notify` est le seul chemin :
-- une insertion directe permettrait de se fabriquer une nouvelle, ou d'en
-- poser une dans la cloche d'un collègue.

drop policy if exists notification_rules_select on notification_rules;
drop policy if exists notification_rules_insert on notification_rules;
drop policy if exists notification_rules_update on notification_rules;
drop policy if exists notification_rules_delete on notification_rules;

-- Les règles se LISENT largement : un agent doit pouvoir vérifier si le client
-- a été prévenu tout seul avant de l'appeler. Elles ne se MODIFIENT qu'avec la
-- capacité qui gouverne déjà les automatisations.
create policy notification_rules_select on notification_rules for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('settings:view'));
create policy notification_rules_insert on notification_rules for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('automation:manage'));
create policy notification_rules_update on notification_rules for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('automation:manage'))
  with check (agency_id = auth_agency_id());
create policy notification_rules_delete on notification_rules for delete to authenticated
  using (agency_id = auth_agency_id() and auth_can('automation:manage'));

drop policy if exists webhooks_select on webhooks;
drop policy if exists webhooks_insert on webhooks;
drop policy if exists webhooks_update on webhooks;
drop policy if exists webhooks_delete on webhooks;

-- Un webhook fait sortir des données de l'agence vers un serveur tiers. Ce
-- n'est pas un réglage d'exploitation : il ne se lit et ne se pose qu'avec la
-- capacité qui gouverne les automatisations.
create policy webhooks_select on webhooks for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('automation:manage'));
create policy webhooks_insert on webhooks for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('automation:manage'));
create policy webhooks_update on webhooks for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('automation:manage'))
  with check (agency_id = auth_agency_id());
create policy webhooks_delete on webhooks for delete to authenticated
  using (agency_id = auth_agency_id() and auth_can('automation:manage'));

drop policy if exists webhook_deliveries_select on webhook_deliveries;

-- L'historique se lit, et ne s'écrit pas depuis l'application : il est produit
-- par notify_event et corrigé par la fonction de bord. Le charger d'une
-- politique d'écriture permettrait de maquiller une remise ratée.
create policy webhook_deliveries_select on webhook_deliveries for select to authenticated
  using (agency_id = auth_agency_id() and auth_can('automation:manage'));

-- ------------------------------------------------------------------
-- 12 · Les droits
-- ------------------------------------------------------------------

grant select, insert, update, delete on notification_rules, webhooks to authenticated;
grant select, update, delete on notifications to authenticated;
grant select on webhook_deliveries to authenticated;
revoke all on notifications, notification_rules, webhooks, webhook_deliveries from anon;
grant all on notifications, notification_rules, webhooks, webhook_deliveries to service_role;

-- PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction créée. C'est le trou
-- déjà payé une fois (migration 0015) : on referme à chaque fonction.
do $$
declare f text;
begin
  foreach f in array array[
    'notif_kind_for(text)', 'notif_severity_for(text)',
    'notif_render(text, jsonb)', 'notif_recent(uuid, text, uuid)',
    'webhook_backoff(int)',
    'notify(uuid, uuid, uuid, text, text, text, text, text, uuid, text, int, timestamptz)',
    'notify_event(uuid, text, text, uuid, jsonb)',
    'my_notifications(integer, boolean)', 'unread_count()',
    'notifications_read(uuid[])', 'notifications_read_all()',
    'notification_sweep()',
    'seed_notification_rules(uuid)', 'seed_notification_rules_on_agency()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Les deux fonctions de la fonction de bord ne portent aucun filtre d'agence :
-- elles ne vont donc qu'à la clé de service, jamais à un compte authentifié.
revoke all on function webhook_pending(integer) from public, anon, authenticated;
revoke all on function webhook_mark(uuid, boolean, int, text) from public, anon, authenticated;
grant execute on function webhook_pending(integer) to service_role;
grant execute on function webhook_mark(uuid, boolean, int, text) to service_role;

-- ------------------------------------------------------------------
-- 13 · Un complément à la file WhatsApp, pas un remplacement
-- ------------------------------------------------------------------
--
-- `wa_outbox` (0014) rend ce qui est envoyable, sans regarder la date du
-- message : jusqu'ici aucun message n'était daté du futur. Une règle avec un
-- délai en crée. Plutôt que de toucher à `wa_outbox`, qui décide correctement
-- de la fenêtre de 24 heures et des modèles approuvés, on l'enveloppe.
-- La fonction de bord d'envoi doit appeler celle-ci.

create or replace function wa_outbox_due(p_agency uuid, p_limit integer default 50)
returns table (
  id uuid, client_id uuid, to_number text, body text, locale text,
  template_name text, category text, in_window boolean
)
language sql stable
set search_path = public
as $$
  select o.*
  from wa_outbox(p_agency, p_limit) o
  join messages m on m.id = o.id
  where m.at <= now()
$$;

comment on function wa_outbox_due(uuid, integer) is
  'La file d''envoi, moins ce qui n''est pas encore dû. Un message posé par une règle à délai porte une date future : sans ce filtre il partirait tout de suite, et le délai que l''agence a réglé ne servirait à rien.';

revoke all on function wa_outbox_due(uuid, integer) from public, anon;
grant execute on function wa_outbox_due(uuid, integer) to authenticated;
