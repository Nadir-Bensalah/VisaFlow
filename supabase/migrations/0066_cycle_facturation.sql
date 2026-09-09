-- 0066 · Le cycle de vie de la facturation.
--
-- Le module d'abonnement de la migration 0049 sait dire QUEL plan une agence a,
-- et ce qu'elle doit. Il ne sait pas dire OÙ ELLE EN EST : depuis quand elle
-- essaie, quand elle bascule, à partir de quand on coupe. Résultat, une agence
-- qui ne paie jamais reste ouverte pour toujours, et personne ne s'en aperçoit.
--
-- LA RÈGLE COMMERCIALE, dans l'ordre du temps :
--
--   1. Une agence naît en ESSAI de 15 jours.
--   2. Pendant l'essai, elle voit son compte à rebours dans son propre espace.
--   3. L'essai fini, un DÉLAI DE GRÂCE de 7 jours commence. Elle travaille
--      toujours, mais elle est prévenue, trois fois.
--   4. Au-delà, si le super-admin n'a enregistré aucun paiement, elle est
--      SUSPENDUE. Jamais supprimée.
--   5. Une agence suspendue : l'employé lit « votre agence n'a plus accès »,
--      le propriétaire lit « contactez le service facturation ».
--
-- CE FICHIER N'ENCAISSE RIEN, et c'est structurel. L'abonnement se règle par
-- virement, sur facture TTN : il n'existe pas de prélèvement récurrent par
-- carte en Tunisie. Le seul geste de paiement est celui du super-admin qui
-- constate un virement reçu (`platform_record_payment`). Aucune fonction ici
-- ne parle à une banque.
--
-- LES DURÉES NE SONT PAS ÉCRITES EN DUR. Elles vivent dans `plans`
-- (`trial_days`, `grace_days`), parce qu'une durée d'essai se négocie avec un
-- gros client, et qu'on ne redéploie pas une migration pour lui accorder une
-- semaine de plus.
--
-- AUCUN TARIF N'EST INVENTÉ ICI. La seule base tarifaire reste celle de 0049 :
-- 45 DT par utilisateur et par mois, et la facture par unité d'œuvre que
-- l'article 3 de la circulaire BCT 2016-09 exige. Le montant d'un règlement
-- est celui que le super-admin saisit, jamais un montant deviné.

-- ------------------------------------------------------------------
-- 1 · Les durées, dans la grille
-- ------------------------------------------------------------------

alter table plans add column if not exists grace_days int not null default 7
  check (grace_days >= 0);

comment on column plans.grace_days is
  'Le délai de grâce après la fin de l''essai ou après une échéance, en jours. L''agence travaille encore, mais elle est prévenue. Sept par défaut.';

-- L'essai passait à 30 jours en 0049. Le patron a tranché : 15. On ne force
-- que la valeur historique, jamais une durée déjà négociée : si quelqu'un a
-- posé 20 jours pour un gros client, ce fichier rejoué ne les lui reprend pas.
update plans set trial_days = 15 where code = 'essai' and trial_days = 30;
alter table plans alter column trial_days set default 15;

comment on column plans.trial_days is
  'La durée de l''essai, en jours. Quinze par défaut. Elle se négocie : c''est pour ça qu''elle est une donnée et pas une constante du code.';

-- ------------------------------------------------------------------
-- 2 · Le cycle, sur la souscription
-- ------------------------------------------------------------------
--
-- POURQUOI UN `billing_state` À CÔTÉ DU `status` DE 0049, ET PAS À SA PLACE :
-- `status` est lu par `agency_has_feature`, par la console, par les politiques
-- et par le front. Le changer de sens casserait tout ce qui s'y appuie.
-- `billing_state` dit où l'on en est DANS LE TEMPS ; `status` dit ce que
-- l'agence a le droit de faire. Un déclencheur les tient d'accord (section 4).

alter table subscriptions
  add column if not exists trial_ends_on   date,
  add column if not exists grace_ends_on   date,
  add column if not exists billing_state   text,
  add column if not exists last_payment_on date,
  add column if not exists suspended_on    date,
  add column if not exists suspend_reason  text;

comment on column subscriptions.trial_ends_on is
  'Le dernier jour de l''essai. Le compte à rebours de l''agence se calcule contre cette date.';
comment on column subscriptions.grace_ends_on is
  'Le dernier jour où l''agence travaille sans avoir payé. Au-delà, la balayeuse suspend.';
comment on column subscriptions.billing_state is
  'Où en est le cycle : essai, grace, a_jour, impayee, suspendue, resiliee. Le droit de faire, lui, se lit dans `status`.';
comment on column subscriptions.last_payment_on is
  'Le jour où le super-admin a constaté le dernier règlement. C''est ce champ qui empêche une suspension injuste.';
comment on column subscriptions.suspended_on is
  'Le jour de la suspension automatique. Non nul veut dire « déjà suspendue » : c''est le verrou qui rend la balayeuse idempotente.';

-- Reprise de l'existant. Une colonne ajoutée vide se lirait comme « jamais
-- d'essai », et la balayeuse suspendrait tout le parc à son premier passage.
update subscriptions set billing_state = case status
    when 'essai'     then 'essai'
    when 'active'    then 'a_jour'
    when 'impayee'   then 'impayee'
    when 'suspendue' then 'suspendue'
    when 'resiliee'  then 'resiliee'
    else 'essai' end
where billing_state is null;

update subscriptions s set
  trial_ends_on = case when s.status = 'essai'
    then coalesce(s.renewal_on, s.started_on + coalesce(p.trial_days, 15))
    -- Une agence qui paie déjà a son essai derrière elle. On le date au
    -- démarrage : la date sert d'histoire, pas d'échéance.
    else s.started_on end
from plans p
where p.id = s.plan_id and s.trial_ends_on is null;

update subscriptions s set
  grace_ends_on = case when s.status = 'essai'
    then s.trial_ends_on + coalesce(p.grace_days, 7)
    else coalesce(s.renewal_on, current_date) + coalesce(p.grace_days, 7) end
from plans p
where p.id = s.plan_id and s.grace_ends_on is null;

-- Une agence déjà suspendue avant ce fichier porte sa date : sans elle, la
-- balayeuse la suspendrait « une deuxième fois » et rejouerait l'événement.
update subscriptions s set
  suspended_on   = coalesce(a.suspended_at::date, current_date),
  suspend_reason = coalesce(s.suspend_reason, 'reprise_0066')
from agencies a
where a.id = s.agency_id and s.billing_state = 'suspendue' and s.suspended_on is null;

update subscriptions set billing_state = 'essai' where billing_state is null;
alter table subscriptions alter column billing_state set default 'essai';
alter table subscriptions alter column billing_state set not null;

alter table subscriptions drop constraint if exists subscriptions_billing_state_check;
alter table subscriptions add constraint subscriptions_billing_state_check
  check (billing_state in ('essai','grace','a_jour','impayee','suspendue','resiliee'));

-- Deux index. Le premier sert la lecture qui part à CHAQUE ouverture de
-- l'application ; le second sert la balayeuse, qui cherche par échéance.
create index if not exists subscriptions_agence on subscriptions (agency_id);
create index if not exists subscriptions_cycle
  on subscriptions (billing_state, grace_ends_on)
  where billing_state in ('essai','grace','impayee','a_jour');

-- Le journal de 0049 ne connaissait pas les moments du cycle. On élargit sa
-- contrainte, on ne la remplace pas : les sept valeurs d'origine restent.
alter table subscription_events drop constraint if exists subscription_events_kind_check;
alter table subscription_events add constraint subscription_events_kind_check
  check (kind in ('creee','changement_plan','renouvelee','suspendue','reactivee',
                  'resiliee','quota_depasse',
                  'entree_grace','impayee','avertissement','paiement'));

-- ------------------------------------------------------------------
-- 3 · Les règlements constatés, et l'adresse du service facturation
-- ------------------------------------------------------------------
--
-- POURQUOI UNE TABLE À PART ET PAS `platform_invoices` : cette table-là porte
-- la commission par dossier, et `platform_overview` en fait la somme du mois.
-- Y déposer un abonnement annuel de plusieurs milliers de dinars ferait mentir
-- le tableau de bord de la commission. Deux revenus, deux tables.

create table if not exists subscription_payments (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references agencies on delete cascade,
  subscription_id uuid references subscriptions on delete set null,
  amount          numeric(12,3) not null check (amount > 0),
  currency        char(3) not null default 'TND',
  period_start    date not null,
  period_end      date not null,
  method          text not null default 'virement'
                  check (method in ('virement','cheque','especes','carte','autre')),
  reference       text,
  note            text,
  recorded_at     timestamptz not null default now(),
  recorded_by     uuid references auth.users on delete set null,
  check (period_end >= period_start)
);

-- Un virement porte une référence bancaire unique. La saisir deux fois est
-- l'erreur la plus banale du monde, et elle repousserait l'échéance d'un an
-- pour rien. L'index refuse le doublon avant qu'on ait à s'en apercevoir.
create unique index if not exists subscription_payments_reference
  on subscription_payments (agency_id, reference) where reference is not null;
create index if not exists subscription_payments_agence
  on subscription_payments (agency_id, recorded_at desc);

comment on table subscription_payments is
  'Les règlements de l''abonnement, constatés à la main par le super-admin après réception du virement. Rien ici ne prélève : il n''existe pas de prélèvement récurrent par carte en Tunisie.';

-- L'adresse que lit le propriétaire d'une agence suspendue. Elle est une
-- donnée et pas une constante : le jour où le service facturation change
-- d'adresse, on ne repasse pas une migration.
create table if not exists billing_settings (
  id            boolean primary key default true check (id),
  contact_email text not null default 'contact@capmedia.tn',
  contact_phone text,
  updated_at    timestamptz not null default now()
);
insert into billing_settings (id) values (true) on conflict (id) do nothing;

comment on table billing_settings is
  'Le contact du service facturation, montré au propriétaire d''une agence suspendue. Une seule ligne.';

-- ------------------------------------------------------------------
-- 4 · Tenir `status` et `billing_state` d'accord
-- ------------------------------------------------------------------
--
-- La console existante appelle `platform_set_subscription`, qui ne connaît que
-- `status`. Sans ce déclencheur, un abonnement posé « actif » depuis la console
-- resterait « en essai » pour le cycle, et la balayeuse le suspendrait alors
-- qu'il vient d'être payé. On ne réécrit pas la fonction de 0049 : on rattrape
-- son écriture.
--
-- La règle est asymétrique, volontairement : le déclencheur ne parle que quand
-- `status` bouge SANS que `billing_state` bouge. Les fonctions de ce fichier,
-- qui posent les deux, ne se font donc jamais contredire.

create or replace function subscription_sync_billing_state() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_grace int;
begin
  -- À l'insertion, la colonne porte son défaut « essai » : on ne peut donc pas
  -- distinguer « laissé au défaut » de « posé à essai exprès ». On corrige donc
  -- le défaut, et on respecte tout état explicitement autre. Sans cela, un
  -- abonnement posé « actif » depuis la console naîtrait en essai pour le
  -- cycle, et la balayeuse le suspendrait quinze jours plus tard.
  if tg_op = 'INSERT' then
    if new.billing_state is null or new.billing_state = 'essai' then
      new.billing_state := case new.status
        when 'active'    then 'a_jour'
        when 'impayee'   then 'impayee'
        when 'suspendue' then 'suspendue'
        when 'resiliee'  then 'resiliee'
        else 'essai' end;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     and new.billing_state is not distinct from old.billing_state then
    new.billing_state := case new.status
      when 'active'    then 'a_jour'
      when 'impayee'   then 'impayee'
      when 'suspendue' then 'suspendue'
      when 'resiliee'  then 'resiliee'
      else 'essai' end;

    select coalesce(p.grace_days, 7) into v_grace from plans p where p.id = new.plan_id;

    -- Un abonnement remis à jour depuis la console repousse sa grâce avec son
    -- échéance : sinon la balayeuse le rattraperait dès le lendemain.
    if new.billing_state in ('a_jour','impayee') and new.renewal_on is not null then
      new.grace_ends_on := new.renewal_on + coalesce(v_grace, 7);
    end if;

    -- Sortir de la suspension efface la trace de la suspension, pas
    -- l'événement au journal : c'est lui qui garde l'histoire.
    if new.billing_state <> 'suspendue' then
      new.suspended_on := null;
      new.suspend_reason := null;
    elsif new.suspended_on is null then
      new.suspended_on := current_date;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists subscriptions_billing_state on subscriptions;
create trigger subscriptions_billing_state
  before insert or update on subscriptions
  for each row execute function subscription_sync_billing_state();

-- ------------------------------------------------------------------
-- 5 · L'essai s'ouvre avec l'agence
-- ------------------------------------------------------------------
--
-- 0049 pose déjà un déclencheur `agencies_trial` qui crée la souscription
-- d'essai. On ne le réécrit pas et on ne touche pas non plus à
-- `platform_create_agency` : on ajoute le nôtre APRÈS. PostgreSQL déclenche
-- dans l'ordre alphabétique des noms, et « agencies_trial » précède
-- « agencies_trial_cycle » puisqu'il en est le préfixe. La souscription existe
-- donc déjà quand celui-ci pose ses dates.

create or replace function agency_open_billing_cycle() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_trial int; v_grace int; v_fin date;
begin
  select coalesce(p.trial_days, 15), coalesce(p.grace_days, 7)
    into v_trial, v_grace
  from plans p where p.code = 'essai';
  v_trial := coalesce(v_trial, 15);
  v_grace := coalesce(v_grace, 7);
  v_fin := current_date + v_trial;

  -- `trial_ends_on is null` est le garde-fou : si un jour un autre chemin pose
  -- déjà les dates, celui-ci ne les écrase pas.
  update subscriptions set
    trial_ends_on = v_fin,
    grace_ends_on = v_fin + v_grace,
    billing_state = 'essai',
    renewal_on    = v_fin,
    updated_at    = now()
  where agency_id = new.id and trial_ends_on is null;

  return new;
end $$;

drop trigger if exists agencies_trial_cycle on agencies;
create trigger agencies_trial_cycle after insert on agencies
  for each row execute function agency_open_billing_cycle();

-- ------------------------------------------------------------------
-- 6 · L'état d'accès : la fonction que l'application appelle en s'ouvrant
-- ------------------------------------------------------------------
--
-- Elle part à chaque chargement, pour chaque compte. Elle est donc écrite en
-- SQL pur, et elle ne touche que deux lignes : l'agence par sa clé primaire,
-- sa souscription par l'index `subscriptions_agence`. Aucun comptage, aucune
-- jointure sur les plans : le cycle ne dépend que de trois dates.
--
-- CE QU'ELLE REND, ET RIEN D'AUTRE :
--   { etat, jours_restants, echeance, message_cle, severite, bloquant }
--
-- `message_cle` est une CLÉ DE TRADUCTION, jamais une phrase. L'agence lit son
-- bandeau en arabe si elle travaille en arabe, et une phrase écrite ici serait
-- française pour tout le monde. `message_cle` nul veut dire « rien à dire » :
-- c'est ce qui éteint le bandeau d'une agence à jour.
--
-- Les six états du cycle se replient sur quatre états d'affichage :
--   · `impayee` s'affiche comme `grace` : dans les deux cas l'agence travaille
--     et doit être relancée. Distinguer les deux à l'écran n'apprendrait rien
--     au client.
--   · `resiliee` s'affiche comme `suspendue` : dans les deux cas la porte est
--     fermée. Le journal, lui, garde la différence.

create or replace function agency_access_state(p_agency uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select
      (a.suspended_at is not null or a.deleted_at is not null) as coupee,
      sub.billing_state, sub.trial_ends_on, sub.grace_ends_on, sub.renewal_on
    from agencies a
    left join lateral (
      select x.billing_state, x.trial_ends_on, x.grace_ends_on, x.renewal_on
      from subscriptions x
      where x.agency_id = a.id
      -- Le vivant d'abord, la résiliée à défaut : la même règle qu'`agency_plan`.
      order by (x.status = 'resiliee'), x.started_on desc, x.created_at desc
      limit 1
    ) sub on true
    where a.id = p_agency
      -- Une agence ne lit que son propre état. Sans session (tâche planifiée,
      -- clé de service, autre fonction SECURITY DEFINER), le test ne
      -- s'applique pas : c'est la même convention que `notify_event`.
      and (auth.uid() is null or a.id = auth_agency_id() or is_platform_admin())
  ),
  e as (
    select s.*, case
      when s.coupee then 'suspendue'
      when s.billing_state in ('suspendue','resiliee') then 'suspendue'
      when s.billing_state in ('grace','impayee') then 'grace'
      -- L'essai dont la date est passée est déjà en grâce à l'écran, même si
      -- la balayeuse n'est pas encore passée cette nuit. Un client ne doit
      -- jamais lire « il vous reste -2 jours d'essai ».
      when s.billing_state = 'essai' and s.trial_ends_on is not null
           and current_date > s.trial_ends_on then 'grace'
      when s.billing_state = 'essai' then 'essai'
      -- Aucune souscription du tout : les comptes nés avant 0049. On ne bloque
      -- pas un compte historique sur une ligne absente.
      else 'a_jour'
    end as etat from s
  ),
  d as (
    select e.*, case e.etat
      when 'essai' then e.trial_ends_on
      when 'grace' then e.grace_ends_on
      when 'suspendue' then e.grace_ends_on
      else e.renewal_on
    end as echeance from e
  ),
  j as (select d.*, (d.echeance - current_date) as jours from d)
  select coalesce(
    (select jsonb_build_object(
      'etat', j.etat,
      -- Négatif quand l'échéance est dépassée. C'est voulu : « en retard de
      -- 3 jours » se lit sur le même chiffre que « dans 3 jours ».
      'jours_restants', j.jours,
      'echeance', j.echeance,
      'message_cle', case
        when j.etat = 'suspendue' and j.billing_state = 'resiliee' then 'bill.terminated'
        when j.etat = 'suspendue' then 'bill.suspended'
        -- Deux clés par état, pas une avec un pluriel : « 1 jours » n'existe
        -- ni en français ni en arabe, et le front n'a pas de règle de pluriel.
        when j.etat = 'grace' then
          case when coalesce(j.jours, 0) <= 1 then 'bill.graceLast' else 'bill.graceLeft' end
        when j.etat = 'essai' then
          case when coalesce(j.jours, 0) <= 1 then 'bill.trialLast' else 'bill.trialLeft' end
        when j.jours is not null and j.jours <= 30 then 'bill.renewalSoon'
        else null
      end,
      'severite', case
        when j.etat = 'suspendue' then 'critique'
        when j.etat = 'grace' then
          case when coalesce(j.jours, 0) <= 2 then 'critique' else 'attention' end
        when j.etat = 'essai' then
          case when coalesce(j.jours, 0) <= 3 then 'attention' else 'info' end
        else 'info'
      end,
      'bloquant', j.etat = 'suspendue'
    ) from j),
    -- Agence introuvable, identifiant nul, ou lecture qui ne la regarde pas :
    -- un état neutre et non bloquant. Rendre `null` ferait planter le bandeau,
    -- et rendre « bloquant » enfermerait un client pour une requête ratée.
    jsonb_build_object('etat', 'a_jour', 'jours_restants', null, 'echeance', null,
                       'message_cle', null, 'severite', 'info', 'bloquant', false)
  )
$$;

comment on function agency_access_state(uuid) is
  'L''état du cycle de facturation d''une agence, pour le bandeau et pour le mur. Appelable par n''importe quel compte de l''agence : le compte à rebours se voit par tous, pas seulement par le propriétaire.';

-- ------------------------------------------------------------------
-- 7 · Le mur de connexion
-- ------------------------------------------------------------------
--
-- POURQUOI LE BLOCAGE EST CÔTÉ APPLICATION ET PAS CÔTÉ BASE.
--
-- La tentation serait d'ajouter `auth_agency_active()` aux 148 politiques : une
-- agence suspendue ne lirait plus rien, la coupure serait absolue. Trois
-- raisons de ne pas le faire, et elles sont toutes des raisons de terrain :
--
--   1. Couper les politiques empêcherait l'agence de lire SA PROPRE FACTURE et
--      son propre journal d'abonnement. Le propriétaire verrait une page vide
--      au lieu de la raison de la coupure, il appellerait pour comprendre, et
--      on aurait transformé un recouvrement en incident de support.
--   2. La réactivation deviendrait risquée. Une politique qui filtre sur un
--      état ne se teste qu'en le provoquant : pour vérifier qu'une agence
--      rouvre bien, il faudrait la suspendre en production.
--   3. Une modification de 148 politiques dans une migration est un
--      changement qu'on ne peut pas relire. Six modules travaillent en
--      parallèle sur ce schéma ; la dernière migration appliquée gagnerait, et
--      les politiques des autres disparaîtraient sans bruit.
--
-- Ce qui coupe réellement, et qui existe déjà : `agency_has_feature` rend faux
-- pour une agence suspendue (0049), et `portal_agency` refuse de servir sa
-- vitrine publique (0035). Le mur ajouté ici est le message, pas la serrure.

create or replace function auth_agency_blocked()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((agency_access_state(auth_agency_id()) ->> 'bloquant')::boolean, false)
$$;

comment on function auth_agency_blocked() is
  'Vrai quand l''agence de l''appelant est suspendue. Un compte de plateforme, qui n''a pas d''agence, n''est jamais bloqué.';

-- Ce que le front appelle au chargement, avant de dessiner quoi que ce soit.
-- Le message DIFFÈRE selon le rôle, et c'est tout l'objet de cette fonction :
-- un employé n'a rien à faire du service facturation, il doit voir sa
-- direction ; le propriétaire, lui, doit pouvoir payer, donc il reçoit
-- l'adresse. Ce sont des clés de traduction, jamais des phrases.
create or replace function agency_gate()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_agency uuid; v_role text; v_bloc boolean;
begin
  v_agency := auth_agency_id();
  if v_agency is null then
    -- Un super-admin n'a pas d'agence. Rien ne le bloque, et il ne doit
    -- surtout pas se retrouver enfermé par le mur des autres.
    return jsonb_build_object('bloquant', false, 'role', null,
                              'message_cle', null, 'contact', null);
  end if;

  v_bloc := coalesce((agency_access_state(v_agency) ->> 'bloquant')::boolean, false);
  v_role := auth_role();

  return jsonb_build_object(
    'bloquant', v_bloc,
    'role', v_role,
    'message_cle', case
      when not v_bloc then null
      when v_role = 'owner' then 'bill.wallOwner'
      else 'bill.wallStaff' end,
    -- L'adresse ne part qu'au propriétaire. Un employé qui écrit au service
    -- facturation d'une agence dont il n'est pas responsable fait perdre du
    -- temps à tout le monde.
    'contact', case when v_bloc and v_role = 'owner'
                    then (select b.contact_email from billing_settings b where b.id)
                    else null end
  );
end $$;

comment on function agency_gate() is
  'Le mur de connexion : bloquant, rôle, clé de message et contact. Le blocage est côté application, pas côté politiques : une agence suspendue doit pouvoir lire sa facture pour comprendre et payer.';

-- ------------------------------------------------------------------
-- 8 · La balayeuse quotidienne
-- ------------------------------------------------------------------
--
-- Elle fait avancer chaque agence d'un état au suivant selon les dates, et
-- elle suspend celles dont la grâce est dépassée sans paiement.
--
-- TROIS GARDE-FOUS, et ils sont la raison d'être de cette fonction :
--
--   GARDE-FOU 1 · Elle ne suspend JAMAIS une agence dont un paiement a été
--     enregistré après le début de la grâce. Le règlement arrive par virement,
--     il met des jours à être vu, et le super-admin le saisit quand il le voit.
--     Suspendre un client qui a payé est la faute qu'on ne rattrape pas.
--
--   GARDE-FOU 2 · Elle ne suspend jamais deux fois. `suspended_on` non nul
--     ferme la porte : deux passages dans la même nuit, ou un rattrapage après
--     une panne, ne rejouent ni la suspension ni son événement.
--
--   GARDE-FOU 3 · Elle ne suspend pas sans avoir averti. Les avertissements
--     partent à 5, 2 et 1 jour de la fin de grâce. Si aucun n'a été déposé pour
--     cette échéance (serveur arrêté une semaine, échéance reprise d'un import),
--     elle envoie un dernier avertissement et REPORTE la suspension au passage
--     suivant. Une suspension sans avertissement, c'est un client perdu et un
--     procès.
--
-- Elle ne supprime rien. Jamais. La suspension est réversible, et c'est tout
-- son intérêt : le client qui paie retrouve ses dossiers intacts.

create or replace function billing_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_n     int := 0;
  v_avert boolean;
begin
  -- La tâche planifiée n'a pas de session : `auth.uid()` y est nul. Un compte
  -- d'agence, lui, n'a rien à faire ici.
  if auth.uid() is not null and not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;

  ------------------------------------------------------------------
  -- 8.1 · L'essai fini entre en grâce
  ------------------------------------------------------------------
  for r in
    select s.id, s.agency_id, s.trial_ends_on, coalesce(p.grace_days, 7) as grace_days
    from subscriptions s
    join agencies a on a.id = s.agency_id and a.deleted_at is null
    left join plans p on p.id = s.plan_id
    where s.billing_state = 'essai'
      and s.trial_ends_on is not null
      and s.trial_ends_on < current_date
  loop
    update subscriptions set
      billing_state = 'grace',
      grace_ends_on = coalesce(grace_ends_on, r.trial_ends_on + r.grace_days),
      updated_at = now()
    where id = r.id;

    insert into subscription_events (agency_id, subscription_id, kind, detail)
    values (r.agency_id, r.id, 'entree_grace',
            jsonb_build_object('essai_fini_le', r.trial_ends_on,
                               'grace_jours', r.grace_days,
                               'automatique', true));
    v_n := v_n + 1;
  end loop;

  ------------------------------------------------------------------
  -- 8.2 · L'échéance passée d'une agence à jour ouvre son impayé
  ------------------------------------------------------------------
  -- Le cycle ne s'arrête pas au premier essai : une agence qui a payé un an
  -- retombe ici l'année suivante. `status` passe à « impayee », qui ne coupe
  -- rien : 0049 laisse tout ouvert à une impayée, c'est la suspension qui
  -- coupe.
  for r in
    select s.id, s.agency_id, s.renewal_on, coalesce(p.grace_days, 7) as grace_days
    from subscriptions s
    join agencies a on a.id = s.agency_id and a.deleted_at is null
    left join plans p on p.id = s.plan_id
    where s.billing_state = 'a_jour'
      and s.renewal_on is not null
      and s.renewal_on < current_date
  loop
    update subscriptions set
      billing_state = 'impayee',
      status = 'impayee',
      grace_ends_on = r.renewal_on + r.grace_days,
      updated_at = now()
    where id = r.id;

    insert into subscription_events (agency_id, subscription_id, kind, detail)
    values (r.agency_id, r.id, 'impayee',
            jsonb_build_object('echeance', r.renewal_on,
                               'grace_jours', r.grace_days,
                               'automatique', true));
    v_n := v_n + 1;
  end loop;

  ------------------------------------------------------------------
  -- 8.3 · Les avertissements, à 5, 2 et 1 jour  (GARDE-FOU 3)
  ------------------------------------------------------------------
  for r in
    select s.id, s.agency_id, s.grace_ends_on,
           (s.grace_ends_on - current_date) as jours
    from subscriptions s
    join agencies a on a.id = s.agency_id
                   and a.deleted_at is null and a.suspended_at is null
    where s.billing_state in ('grace','impayee')
      and s.grace_ends_on is not null
      and (s.grace_ends_on - current_date) in (5, 2, 1)
  loop
    -- La fonction rend faux quand l'avertissement de ce palier est déjà au
    -- journal : deux passages dans la même journée n'en déposent qu'un.
    if avertir_facturation(r.agency_id, r.id, r.grace_ends_on, r.jours) then
      v_n := v_n + 1;
    end if;
  end loop;

  ------------------------------------------------------------------
  -- 8.4 · La suspension
  ------------------------------------------------------------------
  for r in
    select s.id, s.agency_id, s.grace_ends_on, s.last_payment_on,
           (s.grace_ends_on - coalesce(p.grace_days, 7)) as grace_debut
    from subscriptions s
    join agencies a on a.id = s.agency_id and a.deleted_at is null
    left join plans p on p.id = s.plan_id
    where s.billing_state in ('grace','impayee')
      and s.grace_ends_on is not null
      and s.grace_ends_on < current_date
      -- GARDE-FOU 2 : déjà suspendue, on ne repasse pas.
      and s.suspended_on is null
      -- GARDE-FOU 1 : un règlement constaté depuis le début de la grâce
      -- protège l'agence, même si l'état n'a pas encore été remis à jour.
      and (s.last_payment_on is null
           or s.last_payment_on < (s.grace_ends_on - coalesce(p.grace_days, 7)))
  loop
    -- GARDE-FOU 3 : pas d'avertissement au journal pour CETTE échéance, pas de
    -- suspension aujourd'hui. On avertit, et le passage de demain suspendra.
    select exists (
      select 1 from subscription_events e
      where e.agency_id = r.agency_id and e.kind = 'avertissement'
        and (e.detail ->> 'echeance') = r.grace_ends_on::text
    ) into v_avert;

    if not v_avert then
      perform avertir_facturation(r.agency_id, r.id, r.grace_ends_on, 0);
      v_n := v_n + 1;
      continue;
    end if;

    update subscriptions set
      billing_state  = 'suspendue',
      status         = 'suspendue',
      suspended_on   = current_date,
      suspend_reason = 'grace_depassee',
      updated_at     = now()
    where id = r.id;

    -- La suspension de l'agence est un marquage, jamais une suppression.
    update agencies set suspended_at = coalesce(suspended_at, now())
    where id = r.agency_id;

    insert into subscription_events (agency_id, subscription_id, kind, detail)
    values (r.agency_id, r.id, 'suspendue',
            jsonb_build_object('motif', 'grace_depassee',
                               'grace_finie_le', r.grace_ends_on,
                               'grace_ouverte_le', r.grace_debut,
                               'dernier_paiement', r.last_payment_on,
                               'automatique', true));
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

comment on function billing_sweep() is
  'La balayeuse quotidienne du cycle de facturation. Elle avertit avant de suspendre, ne suspend jamais une agence qui a payé, et ne suspend jamais deux fois. Elle ne supprime rien.';

-- ------------------------------------------------------------------
-- 9 · L'avertissement, déposé une seule fois par palier
-- ------------------------------------------------------------------
--
-- Le journal fait office de verrou : un avertissement déposé pour une échéance
-- et un palier ne se redépose pas, même si la balayeuse repasse dans la même
-- journée. C'est ce qui rend l'étape 8.3 idempotente.
--
-- La notification passe par `notify_event` si le module 0051 est là, et sous
-- l'événement `facture.echue`, qui existe déjà dans son référentiel. Un envoi
-- qui échoue ne doit JAMAIS arrêter la balayeuse : le reste du parc attend.

create or replace function avertir_facturation(
  p_agency uuid, p_sub uuid, p_echeance date, p_jours int)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from subscription_events e
    where e.agency_id = p_agency and e.kind = 'avertissement'
      and (e.detail ->> 'echeance') = p_echeance::text
      and (e.detail ->> 'jours')::int = p_jours
  ) then
    return false;
  end if;

  insert into subscription_events (agency_id, subscription_id, kind, detail)
  values (p_agency, p_sub, 'avertissement',
          jsonb_build_object('jours', p_jours,
                             'echeance', p_echeance,
                             'message_cle', 'bill.graceLeft',
                             'severite', case when p_jours <= 2 then 'critique' else 'attention' end));

  if to_regprocedure('public.notify_event(uuid,text,text,uuid,jsonb)') is not null then
    begin
      perform notify_event(p_agency, 'facture.echue', null, null,
        jsonb_build_object(
          'severity', case when p_jours <= 2 then 'urgent' else 'attention' end,
          'url', '/reglages/abonnement'));
    exception when others then
      -- Volontairement avalé. Une cloche qui ne sonne pas est un défaut ;
      -- une balayeuse arrêtée en pleine tournée en est un plus grave.
      null;
    end;
  end if;
  return true;
end $$;

-- ------------------------------------------------------------------
-- 10 · Le paiement constaté par le super-admin
-- ------------------------------------------------------------------
--
-- C'est LE geste du patron après avoir vu un virement sur son relevé. Il
-- enregistre le règlement, remet l'agence à jour, repousse l'échéance, et
-- rouvre la porte si elle était fermée pour impayé.
--
-- Le montant est celui qu'il saisit. Rien ici ne le calcule ni ne le devine :
-- la seule base tarifaire du produit est celle de 0049, et un montant inventé
-- sur une facture est un montant que la banque refuse.

create or replace function platform_record_payment(
  p_agency       uuid,
  p_amount       numeric,
  p_currency     text default 'TND',
  p_period_start date default null,
  p_period_end   date default null,
  p_method       text default 'virement',
  p_reference    text default null,
  p_note         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s          subscriptions;
  v_grace    int;
  v_debut    date;
  v_fin      date;
  v_paiement uuid;
  v_etait    boolean;
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  if p_agency is null then
    raise exception 'agence absente' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'un règlement se saisit avec son montant' using errcode = 'P0001';
  end if;

  select * into s from subscriptions
   where agency_id = p_agency
   order by (status = 'resiliee'), started_on desc, created_at desc
   limit 1;
  if s.id is null then
    raise exception 'cette agence n''a pas d''abonnement' using errcode = 'P0002';
  end if;

  -- La même référence deux fois, c'est le même virement saisi deux fois. On
  -- refuse AVANT d'écrire : repousser une échéance d'un an par mégarde ne se
  -- voit qu'un an plus tard.
  if p_reference is not null and exists (
    select 1 from subscription_payments
    where agency_id = p_agency and reference = p_reference
  ) then
    raise exception 'ce règlement est déjà enregistré : %', p_reference
      using errcode = 'P0001';
  end if;

  select coalesce(p.grace_days, 7) into v_grace from plans p where p.id = s.plan_id;
  v_grace := coalesce(v_grace, 7);

  -- La période couverte : ce que le super-admin dit, sinon un an à partir
  -- d'aujourd'hui. L'abonnement se facture à l'année.
  v_debut := coalesce(p_period_start, current_date);
  v_fin   := coalesce(p_period_end, (v_debut + interval '1 year' - interval '1 day')::date);
  if v_fin < v_debut then
    raise exception 'la période finit avant de commencer' using errcode = 'P0001';
  end if;

  insert into subscription_payments (agency_id, subscription_id, amount, currency,
                                     period_start, period_end, method, reference, note,
                                     recorded_by)
  values (p_agency, s.id, p_amount, upper(coalesce(p_currency, 'TND')),
          v_debut, v_fin, coalesce(p_method, 'virement'), p_reference, p_note, auth.uid())
  returning id into v_paiement;

  -- Suspendue POUR IMPAYÉ ? `suspended_on` le dit. Une agence gelée à la main
  -- par la plateforme pour une autre raison (fraude, litige) ne porte pas
  -- cette date : un règlement ne doit pas la rouvrir dans son dos.
  v_etait := s.billing_state = 'suspendue' and s.suspended_on is not null;

  update subscriptions set
    billing_state   = 'a_jour',
    status          = 'active',
    last_payment_on = current_date,
    renewal_on      = v_fin,
    grace_ends_on   = v_fin + v_grace,
    ends_on         = null,
    suspended_on    = null,
    suspend_reason  = null,
    updated_at      = now()
  where id = s.id;

  insert into subscription_events (agency_id, subscription_id, kind, detail, by_user)
  values (p_agency, s.id, 'paiement',
          jsonb_build_object('paiement_id', v_paiement,
                             'montant', p_amount,
                             'devise', upper(coalesce(p_currency, 'TND')),
                             'periode_debut', v_debut,
                             'periode_fin', v_fin,
                             'methode', coalesce(p_method, 'virement'),
                             'reference', p_reference,
                             'etat_avant', s.billing_state),
          auth.uid());

  if v_etait then
    update agencies set suspended_at = null where id = p_agency;
    insert into subscription_events (agency_id, subscription_id, kind, detail, by_user)
    values (p_agency, s.id, 'reactivee',
            jsonb_build_object('motif', 'paiement_enregistre',
                               'paiement_id', v_paiement),
            auth.uid());
  end if;

  return jsonb_build_object(
    'ok', true,
    'agency_id', p_agency,
    'paiement_id', v_paiement,
    'etat', 'a_jour',
    'renewal_on', v_fin,
    'grace_ends_on', v_fin + v_grace,
    'reactivee', v_etait
  );
end $$;

comment on function platform_record_payment(uuid, numeric, text, date, date, text, text, text) is
  'Constater un règlement reçu par virement. Remet l''agence à jour, repousse l''échéance, et la réactive si elle avait été suspendue pour impayé. Réservé au super-admin.';

-- ------------------------------------------------------------------
-- 11 · Le tableau de la console, trié par urgence
-- ------------------------------------------------------------------
--
-- L'ordre n'est pas alphabétique et ne doit pas l'être : ce qu'on ouvre le
-- matin, c'est ce qui brûle. Suspendues d'abord, puis les grâces, puis les
-- essais qui finissent, puis les agences à jour.

create or replace function platform_billing_board()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(l.ligne order by l.rang, l.jours nulls last, l.nom), '[]'::jsonb)
    from (
      select
        a.name as nom,
        case g.etat ->> 'etat'
          when 'suspendue' then 0
          when 'grace'     then 1
          when 'essai'     then 2
          else 3
        end as rang,
        (g.etat ->> 'jours_restants')::int as jours,
        jsonb_build_object(
          'agency_id', a.id,
          'slug', a.slug,
          'name', a.name,
          'country', a.country,
          'etat', g.etat ->> 'etat',
          'severite', g.etat ->> 'severite',
          'bloquant', (g.etat ->> 'bloquant')::boolean,
          'jours_restants', (g.etat ->> 'jours_restants')::int,
          'echeance', g.etat ->> 'echeance',
          'billing_state', s.billing_state,
          'statut', s.status,
          'plan', (select p.code from plans p where p.id = s.plan_id),
          'sieges', coalesce(s.seats, 0),
          -- Le montant ATTENDU, calculé par 0049 : sièges × 45 DT × 12 mois.
          -- C'est la ligne de facture, pas une somme encaissée.
          'montant_attendu', subscription_invoice_amount(a.id),
          'devise', coalesce(s.currency, 'TND'),
          'dernier_paiement', s.last_payment_on,
          'dernier_montant', (select sp.amount from subscription_payments sp
                               where sp.agency_id = a.id
                               order by sp.recorded_at desc limit 1),
          'suspendue_le', s.suspended_on,
          'motif', s.suspend_reason,
          'suspendue', a.suspended_at is not null
        ) as ligne
      from agencies a
      cross join lateral (select agency_access_state(a.id) as etat) g
      left join lateral (
        select * from subscriptions x where x.agency_id = a.id
        order by (x.status = 'resiliee'), x.started_on desc, x.created_at desc limit 1
      ) s on true
      where a.deleted_at is null
    ) l
  );
end $$;

comment on function platform_billing_board() is
  'La liste de facturation pour la console, triée par urgence : suspendues, grâces, essais qui finissent, puis à jour.';

-- Rouvrir une agence sans encaisser : le geste de dépannage.
--
-- Le virement est parti, la référence manque encore, et le client attend
-- devant son écran. `platform_set_agency_state` ne suffirait pas : elle lève
-- `agencies.suspended_at` mais laisse l'abonnement en « suspendue », et
-- l'agence resterait bloquée par le mur sans qu'on comprenne pourquoi.
--
-- La réouverture ne remet PAS l'agence à jour : aucun règlement n'a été
-- constaté. Elle rouvre une grâce neuve, à partir d'aujourd'hui. Si le
-- virement n'arrive pas, la balayeuse la suspendra de nouveau, en la
-- prévenant, exactement comme la première fois.
create or replace function platform_reactivate_agency(p_agency uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare s subscriptions; v_grace int; v_fin date;
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;

  select * into s from subscriptions
   where agency_id = p_agency
   order by (status = 'resiliee'), started_on desc, created_at desc limit 1;
  if s.id is null then
    raise exception 'cette agence n''a pas d''abonnement' using errcode = 'P0002';
  end if;

  select coalesce(p.grace_days, 7) into v_grace from plans p where p.id = s.plan_id;
  v_grace := coalesce(v_grace, 7);
  v_fin := current_date + v_grace;

  update subscriptions set
    billing_state  = 'grace',
    status         = 'active',
    grace_ends_on  = v_fin,
    suspended_on   = null,
    suspend_reason = null,
    ends_on        = null,
    updated_at     = now()
  where id = s.id;

  update agencies set suspended_at = null where id = p_agency;

  insert into subscription_events (agency_id, subscription_id, kind, detail, by_user)
  values (p_agency, s.id, 'reactivee',
          jsonb_build_object('motif', 'geste_commercial',
                             'grace_jusqu_au', v_fin,
                             'note', p_note),
          auth.uid());

  return jsonb_build_object('ok', true, 'agency_id', p_agency,
                            'etat', 'grace', 'grace_ends_on', v_fin);
end $$;

comment on function platform_reactivate_agency(uuid, text) is
  'Rouvrir une agence suspendue sans encaisser. Elle repart en grâce, pas à jour : aucun règlement n''a été constaté.';

-- Le journal des règlements d'une agence, pour la console. C'est ce qu'on
-- relit quand un client dit « mais j'ai payé ».
create or replace function platform_agency_payments(p_agency uuid, p_limit int default 50)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'amount', x.amount, 'currency', x.currency,
      'period_start', x.period_start, 'period_end', x.period_end,
      'method', x.method, 'reference', x.reference, 'note', x.note,
      'recorded_at', x.recorded_at,
      'recorded_by', (select p.name from profiles p where p.id = x.recorded_by)
    ) order by x.recorded_at desc), '[]'::jsonb)
    from (select * from subscription_payments where agency_id = p_agency
           order by recorded_at desc limit greatest(1, coalesce(p_limit, 50))) x
  );
end $$;

-- ------------------------------------------------------------------
-- 12 · La tâche planifiée
-- ------------------------------------------------------------------
--
-- À 5 h 15 UTC, soit 6 h 15 à Tunis : juste après la balayeuse des alertes de
-- 0058, avant l'ouverture des agences. Un client suspendu doit l'apprendre en
-- arrivant, pas en plein après-midi au milieu d'un dossier.
--
-- On ne planifie que si `run_job` et pg_cron existent : une tâche qui appelle
-- une fonction absente échoue toutes les nuits et remplit le journal de bruit.

do $$
begin
  if to_regprocedure('public.run_job(text,text)') is null then
    raise notice 'run_job absent (migration 0058 non appliquée) : balayeuse de facturation non planifiée';
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent : balayeuse de facturation non planifiée';
    return;
  end if;

  perform cron.unschedule('visaflow_facturation') where exists (
    select 1 from cron.job where jobname = 'visaflow_facturation');
  perform cron.schedule('visaflow_facturation', '15 5 * * *',
    $sql$select run_job('facturation', 'select billing_sweep()')$sql$);
end $$;

-- ------------------------------------------------------------------
-- 13 · Le cloisonnement
-- ------------------------------------------------------------------
--
-- Une agence LIT ses propres règlements. C'est le corollaire du choix de la
-- section 7 : si on lui demande de payer, elle doit pouvoir vérifier ce
-- qu'elle a déjà payé. Elle n'en écrit aucun : c'est le super-admin qui
-- constate, et lui seul.

do $$
declare t text;
begin
  foreach t in array array['subscription_payments','billing_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

drop policy if exists subscription_payments_select on subscription_payments;
drop policy if exists subscription_payments_insert on subscription_payments;
drop policy if exists subscription_payments_update on subscription_payments;
drop policy if exists subscription_payments_delete on subscription_payments;
create policy subscription_payments_select on subscription_payments for select to authenticated
  using (agency_id = auth_agency_id() or is_platform_admin());
create policy subscription_payments_insert on subscription_payments for insert to authenticated
  with check (is_platform_admin());
create policy subscription_payments_update on subscription_payments for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());
-- Aucune politique de suppression : un règlement constaté ne s'efface pas.
-- Une erreur de saisie se corrige par une écriture, jamais par un trou.

drop policy if exists billing_settings_select on billing_settings;
drop policy if exists billing_settings_update on billing_settings;
create policy billing_settings_select on billing_settings for select to authenticated
  using (is_platform_admin());
create policy billing_settings_update on billing_settings for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());

-- ------------------------------------------------------------------
-- 14 · Les droits
-- ------------------------------------------------------------------
--
-- Deux couches, toujours : le droit de toucher la table, puis la politique qui
-- filtre. Sans le GRANT, PostgreSQL refuse avant même de lire la politique, et
-- on croit à une politique cassée.

grant select, insert, update on subscription_payments to authenticated;
grant select, update on billing_settings to authenticated;
grant all on subscription_payments to service_role;
grant all on billing_settings to service_role;

revoke all on function agency_access_state(uuid) from public, anon;
revoke all on function auth_agency_blocked() from public, anon;
revoke all on function agency_gate() from public, anon;
revoke all on function billing_sweep() from public, anon;
revoke all on function avertir_facturation(uuid, uuid, date, int) from public, anon;
revoke all on function platform_record_payment(uuid, numeric, text, date, date, text, text, text) from public, anon;
revoke all on function platform_billing_board() from public, anon;
revoke all on function platform_agency_payments(uuid, int) from public, anon;
revoke all on function platform_reactivate_agency(uuid, text) from public, anon;
revoke all on function subscription_sync_billing_state() from public, anon;
revoke all on function agency_open_billing_cycle() from public, anon;

grant execute on function agency_access_state(uuid) to authenticated;
grant execute on function auth_agency_blocked() to authenticated;
grant execute on function agency_gate() to authenticated;
grant execute on function platform_record_payment(uuid, numeric, text, date, date, text, text, text) to authenticated;
grant execute on function platform_billing_board() to authenticated;
grant execute on function platform_agency_payments(uuid, int) to authenticated;
grant execute on function platform_reactivate_agency(uuid, text) to authenticated;

-- La balayeuse et l'avertissement ne s'appellent pas depuis un navigateur. La
-- tâche planifiée tourne sans session, et le super-admin passe par la console.
revoke all on function billing_sweep() from authenticated;
revoke all on function avertir_facturation(uuid, uuid, date, int) from authenticated;
grant execute on function billing_sweep() to service_role;
grant execute on function avertir_facturation(uuid, uuid, date, int) to service_role;

-- ------------------------------------------------------------------
-- 15 · Le piège des fonctions de déclencheur
-- ------------------------------------------------------------------
--
-- PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction nouvellement créée.
-- Pour une fonction de déclencheur, personne ne le remarque : elle s'appelle
-- toute seule. Mais elle reste appelable directement par un anonyme, et une
-- fonction SECURITY DEFINER appelable par un anonyme est une porte ouverte.
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
