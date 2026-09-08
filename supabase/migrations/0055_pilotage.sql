-- 0055 · Le pilotage : les chiffres se calculent en base, pas dans le navigateur.
--
-- LE PROBLÈME.
--
-- Quatre écrans de pilotage existent déjà (Today, Dashboard, Stats, Reports).
-- Trois d'entre eux comptent dans le navigateur, sur l'instantané que le
-- magasin a chargé. À cent dossiers, personne ne s'en aperçoit. À dix mille, la
-- page ne s'ouvre plus, et le jour où elle s'ouvre encore, elle ment : le
-- magasin ne charge qu'une partie des lignes, donc les totaux sont faux sans
-- que rien ne le signale. Un compteur faux est pire qu'un compteur absent.
--
-- Cette migration donne à ces écrans un socle serveur. Elle ne les remplace
-- pas : elle leur fournit des fonctions qui rendent des chiffres déjà comptés,
-- sur TOUTE la donnée, avec le périmètre de l'appelant déjà appliqué.
--
-- LA RÈGLE DE SÉCURITÉ, QUI PRIME SUR TOUT LE RESTE.
--
-- Une fonction de rapport est SECURITY DEFINER : elle traverse les politiques
-- de sécurité. Si elle oublie le filtre par bureau, un agent de Sfax lit les
-- chiffres de Tunis, et personne ne le voit jamais parce que le résultat est un
-- nombre, pas une liste de lignes. C'est exactement le trou que la section 210
-- du cahier des charges interdit. Toute lecture de ce fichier passe donc par
-- deux gardes, sans exception :
--   · `agency_id = auth_agency_id()`  , l'agence de l'appelant ;
--   · `pil_in_scope(office_id, ...)`  , les bureaux que l'appelant voit.
-- Le banc `supabase/tests/pilotage.sql` vérifie les deux, et c'est sa
-- vérification la plus importante.
--
-- CE QU'ON NE FAIT PAS.
--
-- On n'invente aucun chiffre. Un indicateur que la donnée réelle ne porte pas
-- ne s'affiche pas, ou s'affiche vide avec sa raison. Une moyenne sur zéro
-- ligne rend NULL, jamais 0 : zéro jour de délai voudrait dire « instantané »,
-- alors que la vérité est « on ne sait pas encore ».
--
-- On ne dépend d'aucune des tables écrites en parallèle (factures, prospects,
-- conteneurs, livraisons, coûts, abonnements). Aucune clé étrangère vers
-- elles, et `to_regclass` avant chaque lecture : un rapport doit rendre un
-- résultat même quand le module voisin n'est pas encore installé.

-- ------------------------------------------------------------------
-- 1 · Le périmètre, calculé une fois par appel
-- ------------------------------------------------------------------
--
-- `auth_sees_office` lit le jeton et retombe sur les tables. Appelée par ligne
-- sur dix mille dossiers, elle coûte cher. On la résout donc UNE fois, au début
-- de chaque fonction, en une liste de bureaux, et le filtre par ligne devient
-- une comparaison de tableau que le planificateur sait traiter.

-- Les bureaux que l'appelant voit. NULL veut dire « toute l'agence », bornes
-- comprises : un tableau de tous les bureaux exclurait les lignes sans bureau,
-- qui appartiennent à l'agence entière et videraient des écrans de direction.
create or replace function pil_offices_seen()
returns uuid[]
language plpgsql stable security definer set search_path = public, auth as $$
declare a uuid := auth_agency_id(); res uuid[];
begin
  if a is null then return '{}'::uuid[]; end if;
  if auth_role() in ('owner','manager') then return null; end if;
  select array_agg(o.id) into res
    from offices o where o.agency_id = a and auth_sees_office(o.id);
  return coalesce(res, '{}'::uuid[]);
end $$;

-- Le bureau demandé par l'écran, vérifié. Un identifiant qui n'est pas de
-- l'agence, ou que l'appelant ne voit pas, ne rend pas un résultat vide : il
-- refuse. Un tableau de bord vide se prend pour « rien à faire aujourd'hui ».
create or replace function pil_pick_office(p_office uuid)
returns uuid
language plpgsql stable security definer set search_path = public, auth as $$
declare a uuid := auth_agency_id();
begin
  if a is null then raise exception 'hors agence' using errcode = '42501'; end if;
  if p_office is null then return null; end if;
  if not exists (select 1 from offices o where o.id = p_office and o.agency_id = a) then
    raise exception 'bureau inconnu dans cette agence' using errcode = 'P0001';
  end if;
  if not auth_sees_office(p_office) then
    raise exception 'bureau hors de votre périmètre' using errcode = '42501';
  end if;
  return p_office;
end $$;

-- Le filtre par ligne. Pur, donc le planificateur l'aplatit dans la requête au
-- lieu de l'appeler dix mille fois.
create or replace function pil_in_scope(p_office uuid, p_pick uuid, p_offices uuid[])
returns boolean
language sql immutable parallel safe as $$
  select case
    -- Un bureau demandé : ce bureau, et rien d'autre.
    when p_pick is not null then p_office is not distinct from p_pick
    -- Toute l'agence.
    when p_offices is null then true
    -- Les bureaux de la personne, plus ce qui n'appartient à aucun bureau.
    else p_office is null or p_office = any (p_offices)
  end
$$;

-- Ajouter une entrée au tableau « À traiter ». Une entrée à zéro n'entre pas :
-- vingt lignes dont dix-huit à zéro font un écran qu'on cesse de lire.
create or replace function pil_item(
  p_items jsonb, p_group text, p_key text, p_count bigint, p_link text, p_tone text
) returns jsonb
language sql immutable parallel safe as $$
  select case when coalesce(p_count, 0) = 0 then p_items
    else p_items || jsonb_build_object(
           'group', p_group, 'key', p_key, 'count', p_count,
           'label', 'pil.' || p_key, 'link', p_link, 'tone', p_tone)
  end
$$;

-- Les prospects d'une personne. Isolée dans sa fonction parce que la table
-- `leads` appartient à un module écrit en parallèle : elle peut manquer, et un
-- rapport doit rendre un résultat quand même.
create or replace function pil_leads_count(
  p_agency uuid, p_user uuid, p_offices uuid[], p_from date, p_to date, p_won boolean
) returns bigint
language plpgsql stable security definer set search_path = public, auth as $$
declare n bigint;
begin
  if p_agency is null or p_agency is distinct from auth_agency_id() then
    raise exception 'hors de votre agence' using errcode = '42501';
  end if;
  if to_regclass('public.leads') is null then return null; end if;
  if p_won then
    execute 'select count(*) from leads l
              where l.agency_id = $1 and l.deleted_at is null and l.assigned_user_id = $2
                and l.status = ''gagne'' and l.converted_at::date between $4 and $5
                and pil_in_scope(l.office_id, null, $3)'
      into n using p_agency, p_user, p_offices, p_from, p_to;
  else
    execute 'select count(*) from leads l
              where l.agency_id = $1 and l.deleted_at is null and l.assigned_user_id = $2
                and l.created_at::date between $4 and $5
                and pil_in_scope(l.office_id, null, $3)'
      into n using p_agency, p_user, p_offices, p_from, p_to;
  end if;
  return n;
end $$;

revoke all on function pil_offices_seen() from public, anon;
revoke all on function pil_pick_office(uuid) from public, anon;
revoke all on function pil_in_scope(uuid, uuid, uuid[]) from public, anon;
revoke all on function pil_item(jsonb, text, text, bigint, text, text) from public, anon;
revoke all on function pil_leads_count(uuid, uuid, uuid[], date, date, boolean) from public, anon;
grant execute on function pil_offices_seen() to authenticated;
grant execute on function pil_pick_office(uuid) to authenticated;
grant execute on function pil_in_scope(uuid, uuid, uuid[]) to authenticated;
grant execute on function pil_item(jsonb, text, text, bigint, text, text) to authenticated;
grant execute on function pil_leads_count(uuid, uuid, uuid[], date, date, boolean) to authenticated;

-- ------------------------------------------------------------------
-- 2 · Les index. Ces fonctions s'appellent à chaque ouverture d'écran.
-- ------------------------------------------------------------------

create index if not exists cases_agency_opened on cases (agency_id, opened_at);
create index if not exists cases_agency_decision on cases (agency_id, decision_at)
  where decision_at is not null;
create index if not exists cases_stale on cases (agency_id, updated_at)
  where status = 'ouvert';
create index if not exists cases_due on cases (agency_id, due_at)
  where status = 'ouvert' and due_at is not null;
create index if not exists cases_assignee on cases (agency_id, assignee_id);

create index if not exists case_documents_open on case_documents (agency_id, case_id)
  where state in ('manquante','demandee');
create index if not exists case_documents_validated on case_documents (agency_id, validated_by)
  where validated_at is not null;

create index if not exists tasks_due on tasks (agency_id, due_at) where not done;
create index if not exists tasks_done_by on tasks (agency_id, assignee_id, done_at)
  where done;

create index if not exists payments_due_open on payments (agency_id, due_at)
  where state in ('du','partiel');
create index if not exists payments_settled on payments (agency_id, at) where state = 'regle';

create index if not exists appointments_state_day on appointments (agency_id, status, at);

create index if not exists shipments_arrived on shipments (agency_id, arrived_at);
create index if not exists shipments_delivered on shipments (agency_id, delivered_at);
create index if not exists shipments_created on shipments (agency_id, created_at);

create index if not exists passport_custody_held on passport_custody (agency_id, received_at)
  where returned_at is null;

-- Les tables des modules voisins n'existent pas forcément encore. On indexe si
-- elles sont là, sans jamais faire échouer la migration si elles manquent.
do $$
begin
  if to_regclass('public.invoices') is not null then
    execute 'create index if not exists invoices_due_open on invoices (agency_id, due_date)
             where status in (''emise'',''partiellement_reglee'',''en_retard'')';
  end if;
  if to_regclass('public.deliveries') is not null then
    execute 'create index if not exists deliveries_agency_plan on deliveries (agency_id, planned_at)';
  end if;
  if to_regclass('public.shipment_costs') is not null then
    execute 'create index if not exists shipment_costs_agency_day on shipment_costs (agency_id, incurred_on)';
  end if;
  if to_regclass('public.leads') is not null then
    execute 'create index if not exists leads_agency_created on leads (agency_id, created_at)';
  end if;
end $$;

-- ------------------------------------------------------------------
-- 3 · Section 184 · Les délais de service (SLA)
-- ------------------------------------------------------------------
--
-- Les trois exemples de la spécification sont semés DÉSACTIVÉS. C'est
-- délibéré : un délai imposé qu'une agence n'a pas choisi produit dès le
-- premier jour des alertes qu'elle n'a pas demandées, et dès le deuxième jour
-- elle apprend à les ignorer. Une alerte qu'on ignore vaut moins que pas
-- d'alerte du tout, parce qu'elle apprend à ignorer les autres.

create table if not exists sla_rules (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references agencies on delete cascade,
  event          text not null check (event in (
                   'lead_nouveau','document_recu','cargaison_arrivee',
                   'dossier_bloque','message_client','paiement_du')),
  target_minutes integer not null check (target_minutes between 1 and 525600),
  -- À qui la règle s'applique. Vide veut dire « à tout le monde » : une agence
  -- de cinq personnes n'a pas de service dédié.
  applies_to_role text check (applies_to_role in ('owner','manager','agent','viewer')),
  active         boolean not null default false,
  note           text,
  created_at     timestamptz not null default now(),
  unique (agency_id, event)
);
create index if not exists sla_rules_agency on sla_rules (agency_id) where active;

comment on table sla_rules is
  'Les délais que l''agence se donne. Semés désactivés : un délai imposé produit des alertes qu''on apprend à ignorer, et cette habitude déteint sur les autres alertes.';

-- Les trois exemples de la spécification, pour toute agence existante.
insert into sla_rules (agency_id, event, target_minutes, active, note)
select a.id, v.event, v.target, false, v.note
from agencies a
cross join (values
  ('lead_nouveau',      120,  'Répondre à un prospect dans les deux heures.'),
  ('document_recu',     1440, 'Valider une pièce reçue dans la journée.'),
  ('cargaison_arrivee', 120,  'Prendre en charge une arrivée dans les deux heures.')
) as v(event, target, note)
where a.deleted_at is null
on conflict (agency_id, event) do nothing;

-- Une agence créée plus tard reçoit les mêmes trois exemples, désactivés.
create or replace function sla_seed_for_agency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into sla_rules (agency_id, event, target_minutes, active, note)
  values
    (new.id, 'lead_nouveau',      120,  false, 'Répondre à un prospect dans les deux heures.'),
    (new.id, 'document_recu',     1440, false, 'Valider une pièce reçue dans la journée.'),
    (new.id, 'cargaison_arrivee', 120,  false, 'Prendre en charge une arrivée dans les deux heures.')
  on conflict (agency_id, event) do nothing;
  return new;
end $$;

drop trigger if exists agencies_sla_seed on agencies;
create trigger agencies_sla_seed after insert on agencies
  for each row execute function sla_seed_for_agency();

alter table sla_rules enable row level security;
alter table sla_rules force row level security;

drop policy if exists sla_rules_select on sla_rules;
create policy sla_rules_select on sla_rules for select to authenticated
  using (agency_id = auth_agency_id());
drop policy if exists sla_rules_insert on sla_rules;
create policy sla_rules_insert on sla_rules for insert to authenticated
  with check (agency_id = auth_agency_id() and auth_can('settings:manage'));
drop policy if exists sla_rules_update on sla_rules;
create policy sla_rules_update on sla_rules for update to authenticated
  using (agency_id = auth_agency_id() and auth_can('settings:manage'))
  with check (agency_id = auth_agency_id() and auth_can('settings:manage'));
drop policy if exists sla_rules_delete on sla_rules;
create policy sla_rules_delete on sla_rules for delete to authenticated
  using (agency_id = auth_agency_id() and auth_can('settings:manage'));
drop policy if exists sla_rules_platform_read on sla_rules;
create policy sla_rules_platform_read on sla_rules for select to authenticated
  using (is_platform_admin());

revoke all on sla_rules from anon, authenticated;
grant select, insert, update, delete on sla_rules to authenticated;
grant all on sla_rules to service_role;

-- ------------------------------------------------------------------
-- 4 · Section 130 · Le tableau « À traiter »
-- ------------------------------------------------------------------
--
-- Le cahier des charges dit que c'est l'écran le plus important du logiciel, et
-- il a raison : c'est le seul qu'on ouvre tous les matins.
--
-- Sa règle tient en une phrase : CE SONT DES CHOSES À FAIRE, PAS DES
-- STATISTIQUES. Un chiffre sur lequel on ne peut poser aucun geste n'a rien à
-- faire ici, il appartient aux rapports. C'est pourquoi chaque entrée porte un
-- lien : si on ne sait pas où le lien mène, l'entrée ne sert à rien et elle
-- sort de la liste.
--
-- Deuxième règle : une entrée à zéro ne sort pas. Vingt lignes dont dix-huit à
-- zéro, c'est un écran qu'on ne lit plus. Le front affiche « rien à traiter »
-- quand la liste est vide, ce qui est une bonne nouvelle, pas une panne.

create or replace function dashboard_today(p_office uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  a      uuid := auth_agency_id();
  pick   uuid;
  offs   uuid[];
  money  boolean := auth_can('finance:global');
  items  jsonb := '[]'::jsonb;
  n      bigint;
  -- Sans activité depuis combien de jours ? Sept : une semaine sans un mot au
  -- client, c'est le seuil auquel une agence commence à perdre le dossier.
  stale  int := 7;
  -- Un passeport détenu depuis plus de soixante jours est un risque : le client
  -- ne peut ni voyager ni faire une autre démarche pendant ce temps.
  held   int := 60;
begin
  if a is null then raise exception 'hors agence' using errcode = '42501'; end if;
  pick := pil_pick_office(p_office);
  offs := pil_offices_seen();

  -- ---------------- Visa ----------------

  -- Pièces manquantes ou demandées sur les dossiers ouverts.
  select count(*) into n from case_documents d join cases c on c.id = d.case_id
   where d.agency_id = a and c.status = 'ouvert' and d.required
     and d.state in ('manquante','demandee')
     and pil_in_scope(c.office_id, pick, offs);
  items := pil_item(items, 'visa', 'docsMissing', n, '/pieces', 'orange');

  select count(*) into n from appointments ap
   left join cases c on c.id = ap.case_id
   where ap.agency_id = a and ap.status = 'prevu' and ap.at::date = current_date
     and pil_in_scope(coalesce(ap.office_id, c.office_id), pick, offs);
  items := pil_item(items, 'visa', 'apptsToday', n, '/rendez-vous', 'blue');

  select count(*) into n from appointments ap
   left join cases c on c.id = ap.case_id
   where ap.agency_id = a and ap.status = 'prevu' and ap.at::date = current_date + 1
     and pil_in_scope(coalesce(ap.office_id, c.office_id), pick, offs);
  items := pil_item(items, 'visa', 'apptsTomorrow', n, '/rendez-vous', 'gray');

  -- Passeports à remettre : la décision est tombée, le passeport est encore
  -- chez nous. C'est le geste le plus attendu par le client.
  select count(*) into n from passport_custody pc join cases c on c.id = pc.case_id
   where pc.agency_id = a and pc.returned_at is null and c.decision_at is not null
     and pil_in_scope(c.office_id, pick, offs);
  items := pil_item(items, 'visa', 'passportsReady', n, '/dossiers', 'green');

  select count(*) into n from passport_custody pc
   left join cases c on c.id = pc.case_id
   where pc.agency_id = a and pc.returned_at is null
     and pc.received_at < now() - make_interval(days => held)
     and pil_in_scope(c.office_id, pick, offs);
  items := pil_item(items, 'visa', 'passportsHeld', n, '/dossiers', 'red');

  -- Clients à rappeler : un message entrant plus récent que notre dernière
  -- réponse. C'est la définition exacte de « on lui doit un mot ».
  select count(*) into n from cases c
   where c.agency_id = a and c.status = 'ouvert'
     and pil_in_scope(c.office_id, pick, offs)
     and exists (
       select 1 from messages m
        where m.case_id = c.id and m.direction = 'entrant'
          and m.at > coalesce((select max(m2.at) from messages m2
                                where m2.case_id = c.id and m2.direction = 'sortant'),
                              '-infinity'::timestamptz));
  items := pil_item(items, 'visa', 'clientsToCall', n, '/messages', 'blue');

  select count(*) into n from cases c
   where c.agency_id = a and c.status = 'ouvert'
     and c.updated_at < now() - make_interval(days => stale)
     and pil_in_scope(c.office_id, pick, offs);
  items := pil_item(items, 'visa', 'staleCases', n, '/dossiers', 'orange');

  -- Décision tombée, dossier pas encore clôturé : il reste un geste (prévenir,
  -- rendre le passeport, encaisser le solde, classer).
  select count(*) into n from cases c
   where c.agency_id = a and c.decision_at is not null and c.closed_at is null
     and pil_in_scope(c.office_id, pick, offs);
  items := pil_item(items, 'visa', 'decisionsUntreated', n, '/dossiers', 'red');

  -- ---------------- Fret ----------------

  select count(*) into n from shipments s
   where s.agency_id = a and s.status = 'en_cours' and s.eta = current_date
     and pil_in_scope(s.office_id, pick, offs);
  items := pil_item(items, 'cargo', 'arrivalsToday', n, '/cargaisons', 'blue');

  select count(*) into n from shipments s
   where s.agency_id = a and s.status = 'en_cours'
     and s.eta between current_date and current_date + 7
     and pil_in_scope(s.office_id, pick, offs);
  items := pil_item(items, 'cargo', 'arrivalsWeek', n, '/cargaisons', 'gray');

  select count(*) into n from shipments s
   where s.agency_id = a and s.status = 'en_cours'
     and s.arrived_at is not null and s.cleared_at is null
     and pil_in_scope(s.office_id, pick, offs);
  items := pil_item(items, 'cargo', 'inCustoms', n, '/cargaisons', 'orange');

  -- Conteneurs à sortir : déchargés, pas encore sortis du terminal. C'est là
  -- que les surestaries se fabriquent.
  select count(*) into n from shipments s
   where s.agency_id = a and s.status = 'en_cours'
     and s.discharged_at is not null and s.gate_out_at is null
     and pil_in_scope(s.office_id, pick, offs);
  items := pil_item(items, 'cargo', 'containersOut', n, '/cargaisons', 'orange');

  -- Risque de surestaries. On ne recalcule RIEN : `shipment_counters` de la
  -- migration 0029 est la seule autorité sur ces compteurs, et l'écrire deux
  -- fois garantirait deux résultats différents un jour. On l'appelle sur le
  -- seul lot où le risque existe (déchargé, pas sorti), qui reste petit.
  select count(*) into n from (
    select s.id from shipments s
     where s.agency_id = a and s.status = 'en_cours'
       and s.discharged_at is not null and s.gate_out_at is null
       and pil_in_scope(s.office_id, pick, offs)
  ) cand
  where exists (
    select 1 from jsonb_array_elements(shipment_counters(cand.id)) c
     where c ->> 'status' = 'en_depassement');
  items := pil_item(items, 'cargo', 'demurrageRisk', n, '/cargaisons', 'red');

  -- Livraisons du jour. Sans le module logistique, l'entrée n'apparaît pas :
  -- mieux vaut une ligne absente qu'un zéro qui laisse croire qu'il n'y a rien
  -- à livrer aujourd'hui.
  if to_regclass('public.deliveries') is not null then
    execute 'select count(*) from deliveries d
              left join shipments s on s.id = d.shipment_id
             where d.agency_id = $1 and d.planned_at::date = current_date
               and d.status not in (''livree'',''echouee'')
               and pil_in_scope(coalesce(d.office_id, s.office_id), $2, $3)'
      into n using a, pick, offs;
    items := pil_item(items, 'cargo', 'deliveriesToday', n, '/cargaisons', 'blue');
  end if;

  -- ---------------- Argent ----------------
  -- Les montants restent à qui a `finance:global`. Les COMPTES, eux, sont un
  -- geste de comptoir : savoir qu'il y a six encaissements à faire n'apprend
  -- pas ce que gagne l'agence.

  select count(*) into n from payments p
   left join cases c on c.id = p.case_id
   left join shipments s on s.id = p.shipment_id
   where p.agency_id = a and p.state in ('du','partiel')
     and p.due_at is not null and p.due_at <= current_date
     and pil_in_scope(coalesce(p.office_id, c.office_id, s.office_id), pick, offs);
  items := pil_item(items, 'finance', 'paymentsDue', n, '/paiements', 'orange');

  if to_regclass('public.invoices') is not null then
    execute 'select count(*) from invoices i
             where i.agency_id = $1
               and i.status in (''emise'',''partiellement_reglee'',''en_retard'')
               and i.due_date is not null and i.due_date < current_date
               and pil_in_scope(i.office_id, $2, $3)'
      into n using a, pick, offs;
    items := pil_item(items, 'finance', 'invoicesOverdue', n, '/factures', 'red');
  end if;

  select count(*) into n from cases c
   where c.agency_id = a and c.status = 'ouvert'
     and c.amount_total - c.amount_paid > 0
     and pil_in_scope(c.office_id, pick, offs);
  items := pil_item(items, 'finance', 'caseBalances', n, '/dossiers', 'orange');

  -- Passeport retenu faute de paiement : le cas le plus délicat du métier. Il
  -- doit se voir, parce qu'il se règle en une conversation.
  select count(*) into n from passport_custody pc join cases c on c.id = pc.case_id
   where pc.agency_id = a and pc.returned_at is null
     and c.decision_at is not null and c.amount_total - c.amount_paid > 0
     and pil_in_scope(c.office_id, pick, offs);
  items := pil_item(items, 'finance', 'passportsUnpaid', n, '/paiements', 'red');

  -- ---------------- Tâches ----------------

  select count(*) into n from tasks t
   left join cases c on c.id = t.case_id
   left join shipments s on s.id = t.shipment_id
   where t.agency_id = a and not t.done
     and t.due_at is not null and t.due_at < now()
     and pil_in_scope(coalesce(c.office_id, s.office_id), pick, offs);
  items := pil_item(items, 'tasks', 'tasksOverdue', n, '/taches', 'red');

  select count(*) into n from tasks t
   left join cases c on c.id = t.case_id
   left join shipments s on s.id = t.shipment_id
   where t.agency_id = a and not t.done
     and t.due_at::date = current_date
     and pil_in_scope(coalesce(c.office_id, s.office_id), pick, offs);
  items := pil_item(items, 'tasks', 'tasksToday', n, '/taches', 'blue');

  return jsonb_build_object(
    'generated_at', now(),
    'office', pick,
    'stale_days', stale,
    'held_days', held,
    'money_visible', money,
    'total', (select coalesce(sum((i ->> 'count')::bigint), 0)
                from jsonb_array_elements(items) i),
    'items', items
  );
end $$;

-- ------------------------------------------------------------------
-- 5 · Sections 85 et 86 · Bureau et direction
-- ------------------------------------------------------------------

create or replace function dashboard_office(
  p_office uuid default null, p_from date default null, p_to date default null
) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  a     uuid := auth_agency_id();
  pick  uuid;
  offs  uuid[];
  money boolean := auth_can('finance:global');
  d1    date := coalesce(p_from, date_trunc('month', current_date)::date);
  d2    date := coalesce(p_to, current_date);
  v     jsonb;
  extra jsonb := '{}'::jsonb;
  tmp   jsonb;
begin
  if a is null then raise exception 'hors agence' using errcode = '42501'; end if;
  if not auth_can('reports:view') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  if d2 < d1 then raise exception 'période à l''envers' using errcode = 'P0001'; end if;
  pick := pil_pick_office(p_office);
  offs := pil_offices_seen();

  select jsonb_build_object(
    'from', d1, 'to', d2, 'office', pick, 'money_visible', money,

    -- Les dossiers : ouverts sur la période, clos sur la période, en cours
    -- aujourd'hui. Les trois ne se déduisent pas l'un de l'autre.
    'cases_opened', (select count(*) from cases c
       where c.agency_id = a and c.opened_at::date between d1 and d2
         and pil_in_scope(c.office_id, pick, offs)),
    'cases_closed', (select count(*) from cases c
       where c.agency_id = a and c.closed_at::date between d1 and d2
         and pil_in_scope(c.office_id, pick, offs)),
    'cases_open_now', (select count(*) from cases c
       where c.agency_id = a and c.status = 'ouvert'
         and pil_in_scope(c.office_id, pick, offs)),
    'cases_by_stage', (
      select coalesce(jsonb_agg(jsonb_build_object('stage', t.stage, 'n', t.n)
                                order by t.n desc), '[]'::jsonb)
      from (select c.stage, count(*) as n from cases c
             where c.agency_id = a and c.status = 'ouvert'
               and pil_in_scope(c.office_id, pick, offs)
             group by c.stage) t),

    -- Les décisions tombées sur la période, et le taux qui en découle. NULL
    -- quand rien n'est tombé : 0 % voudrait dire « tout refusé ».
    'decided', (select count(*) from cases c
       where c.agency_id = a and c.decision_at::date between d1 and d2
         and pil_in_scope(c.office_id, pick, offs)),
    'accepted', (select count(*) from cases c
       where c.agency_id = a and c.decision_at::date between d1 and d2
         and c.status = 'accepte' and pil_in_scope(c.office_id, pick, offs)),
    'refused', (select count(*) from cases c
       where c.agency_id = a and c.decision_at::date between d1 and d2
         and c.status = 'refuse' and pil_in_scope(c.office_id, pick, offs)),
    'acceptance', (select round(100.0 * count(*) filter (where c.status = 'accepte')
                                / nullif(count(*), 0), 1)
       from cases c where c.agency_id = a and c.decision_at::date between d1 and d2
         and c.status in ('accepte','refuse') and pil_in_scope(c.office_id, pick, offs)),

    -- Le délai réel, mesuré sur les dates enregistrées. Jamais estimé.
    'avg_decision_days', (select round(avg(c.decision_at::date - c.opened_at::date), 1)
       from cases c where c.agency_id = a and c.decision_at::date between d1 and d2
         and pil_in_scope(c.office_id, pick, offs)),

    'docs_missing', (select count(*) from case_documents dd join cases c on c.id = dd.case_id
       where dd.agency_id = a and c.status = 'ouvert' and dd.required
         and dd.state in ('manquante','demandee') and pil_in_scope(c.office_id, pick, offs)),
    'docs_to_validate', (select count(*) from case_documents dd join cases c on c.id = dd.case_id
       where dd.agency_id = a and dd.state = 'recue' and pil_in_scope(c.office_id, pick, offs)),

    'appts_planned', (select count(*) from appointments ap left join cases c on c.id = ap.case_id
       where ap.agency_id = a and ap.at::date between d1 and d2 and ap.status = 'prevu'
         and pil_in_scope(coalesce(ap.office_id, c.office_id), pick, offs)),
    'appts_done', (select count(*) from appointments ap left join cases c on c.id = ap.case_id
       where ap.agency_id = a and ap.at::date between d1 and d2 and ap.status = 'fait'
         and pil_in_scope(coalesce(ap.office_id, c.office_id), pick, offs)),
    'appts_missed', (select count(*) from appointments ap left join cases c on c.id = ap.case_id
       where ap.agency_id = a and ap.at::date between d1 and d2 and ap.status = 'manque'
         and pil_in_scope(coalesce(ap.office_id, c.office_id), pick, offs)),

    'shipments_opened', (select count(*) from shipments s
       where s.agency_id = a and s.created_at::date between d1 and d2
         and pil_in_scope(s.office_id, pick, offs)),
    'shipments_delivered', (select count(*) from shipments s
       where s.agency_id = a and s.delivered_at::date between d1 and d2
         and pil_in_scope(s.office_id, pick, offs)),
    'shipments_open_now', (select count(*) from shipments s
       where s.agency_id = a and s.status = 'en_cours'
         and pil_in_scope(s.office_id, pick, offs)),
    'shipments_blocked', (select count(*) from shipments s
       where s.agency_id = a and s.status = 'bloquee'
         and pil_in_scope(s.office_id, pick, offs)),

    'clients_new', (select count(*) from clients cl
       where cl.agency_id = a and cl.deleted_at is null
         and cl.created_at::date between d1 and d2
         and pil_in_scope(cl.office_id, pick, offs)),

    'tasks_open', (select count(*) from tasks t
       left join cases c on c.id = t.case_id left join shipments s on s.id = t.shipment_id
       where t.agency_id = a and not t.done
         and pil_in_scope(coalesce(c.office_id, s.office_id), pick, offs)),
    'tasks_overdue', (select count(*) from tasks t
       left join cases c on c.id = t.case_id left join shipments s on s.id = t.shipment_id
       where t.agency_id = a and not t.done and t.due_at < now()
         and pil_in_scope(coalesce(c.office_id, s.office_id), pick, offs)),

    -- L'effectif du bureau regardé. Il donne son sens à tout le reste : trente
    -- dossiers, c'est beaucoup à deux et peu à dix.
    'people', (select count(*) from profiles p
       where p.agency_id = a and p.active
         and (pick is null or exists (select 1 from office_members om
                where om.user_id = p.id and om.office_id = pick and om.active))),

    -- La courbe du mois par mois, pour le graphique. Calculée ici : le front
    -- ne regroupe plus rien.
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', to_char(m.mois, 'YYYY-MM'),
               'cases', (select count(*) from cases c
                          where c.agency_id = a
                            and date_trunc('month', c.opened_at)::date = m.mois
                            and pil_in_scope(c.office_id, pick, offs)),
               'shipments', (select count(*) from shipments s
                          where s.agency_id = a
                            and date_trunc('month', s.created_at)::date = m.mois
                            and pil_in_scope(s.office_id, pick, offs))
             ) order by m.mois), '[]'::jsonb)
      from generate_series(date_trunc('month', d1)::date,
                           date_trunc('month', d2)::date,
                           interval '1 month') as m(mois))
  ) into v;

  -- L'argent, seulement pour qui a le droit de le voir.
  if money then
    select jsonb_build_object(
      'collected', (select coalesce(sum(p.amount), 0) from payments p
         left join cases c on c.id = p.case_id left join shipments s on s.id = p.shipment_id
         where p.agency_id = a and p.state = 'regle' and p.at::date between d1 and d2
           and pil_in_scope(coalesce(p.office_id, c.office_id, s.office_id), pick, offs)),
      'outstanding', (select coalesce(sum(p.amount), 0) from payments p
         left join cases c on c.id = p.case_id left join shipments s on s.id = p.shipment_id
         where p.agency_id = a and p.state in ('du','partiel')
           and pil_in_scope(coalesce(p.office_id, c.office_id, s.office_id), pick, offs)),
      'case_balances', (select coalesce(sum(c.amount_total - c.amount_paid), 0) from cases c
         where c.agency_id = a and c.status = 'ouvert' and c.amount_total > c.amount_paid
           and pil_in_scope(c.office_id, pick, offs))
    ) into extra;
    v := v || jsonb_build_object('money', extra);
  else
    -- On dit pourquoi la case est vide. Un tableau de bord muet passe pour cassé.
    v := v || jsonb_build_object('money', null, 'money_reason', 'finance:global');
  end if;

  -- Les prospects, si le module CRM est installé.
  if to_regclass('public.leads') is not null then
    execute 'select jsonb_build_object(
               ''new'', count(*) filter (where l.created_at::date between $4 and $5),
               ''won'', count(*) filter (where l.status = ''gagne'' and l.converted_at::date between $4 and $5),
               ''lost'', count(*) filter (where l.status = ''perdu'' and l.updated_at::date between $4 and $5),
               ''open'', count(*) filter (where l.status not in (''gagne'',''perdu''))
             ) from leads l
             where l.agency_id = $1 and l.deleted_at is null
               and pil_in_scope(l.office_id, $2, $3)'
      into tmp using a, pick, offs, d1, d2;
    v := v || jsonb_build_object('leads', tmp);
  end if;

  return v;
end $$;

-- La vue consolidée de la direction : une ligne par bureau, plus le total.
-- Réservée à qui voit toute l'agence. Un agent de Sfax qui l'appellerait ne
-- doit pas obtenir une ligne « Tunis », même vide : la seule existence de la
-- ligne renseigne sur l'organisation de l'agence.
create or replace function dashboard_agency(
  p_from date default null, p_to date default null
) returns table (
  office_id uuid, office_name text, is_total boolean,
  cases_opened bigint, cases_open_now bigint, decided bigint,
  accepted bigint, refused bigint, acceptance numeric,
  avg_decision_days numeric,
  shipments_open bigint, shipments_delivered bigint,
  clients_new bigint, tasks_overdue bigint,
  revenue numeric, outstanding numeric
)
language plpgsql stable security definer set search_path = public, auth as $$
declare
  a     uuid := auth_agency_id();
  offs  uuid[];
  money boolean := auth_can('finance:global');
  d1    date := coalesce(p_from, date_trunc('month', current_date)::date);
  d2    date := coalesce(p_to, current_date);
begin
  if a is null then raise exception 'hors agence' using errcode = '42501'; end if;
  if not auth_can('reports:view') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  offs := pil_offices_seen();
  if offs is not null then
    raise exception 'la vue consolidée est réservée à qui voit toute l''agence'
      using errcode = '42501';
  end if;
  if d2 < d1 then raise exception 'période à l''envers' using errcode = 'P0001'; end if;

  return query
  with bureaux as (
    select o.id, o.name from offices o where o.agency_id = a
    union all
    -- La ligne du total. Elle vaut mieux qu'une somme faite par le front :
    -- une donnée sans bureau entre dans le total et dans aucune ligne, et la
    -- somme des lignes serait donc plus petite que la vérité.
    select null::uuid, null::text
  ),
  chiffres as (
    select b.id as bid, b.name as bname, b.id is null as total,
      (select count(*) from cases c where c.agency_id = a
         and c.opened_at::date between d1 and d2
         and (b.id is null or c.office_id = b.id)) as opened,
      (select count(*) from cases c where c.agency_id = a and c.status = 'ouvert'
         and (b.id is null or c.office_id = b.id)) as open_now,
      (select count(*) from cases c where c.agency_id = a
         and c.decision_at::date between d1 and d2
         and (b.id is null or c.office_id = b.id)) as dec_n,
      (select count(*) from cases c where c.agency_id = a
         and c.decision_at::date between d1 and d2 and c.status = 'accepte'
         and (b.id is null or c.office_id = b.id)) as acc_n,
      (select count(*) from cases c where c.agency_id = a
         and c.decision_at::date between d1 and d2 and c.status = 'refuse'
         and (b.id is null or c.office_id = b.id)) as ref_n,
      (select round(avg(c.decision_at::date - c.opened_at::date), 1) from cases c
        where c.agency_id = a and c.decision_at::date between d1 and d2
          and (b.id is null or c.office_id = b.id)) as delai,
      (select count(*) from shipments s where s.agency_id = a and s.status = 'en_cours'
         and (b.id is null or s.office_id = b.id)) as ship_open,
      (select count(*) from shipments s where s.agency_id = a
         and s.delivered_at::date between d1 and d2
         and (b.id is null or s.office_id = b.id)) as ship_del,
      (select count(*) from clients cl where cl.agency_id = a and cl.deleted_at is null
         and cl.created_at::date between d1 and d2
         and (b.id is null or cl.office_id = b.id)) as cli_new,
      (select count(*) from tasks t
         left join cases c on c.id = t.case_id left join shipments s on s.id = t.shipment_id
        where t.agency_id = a and not t.done and t.due_at < now()
          and (b.id is null or coalesce(c.office_id, s.office_id) = b.id)) as tache_ret,
      case when money then (select coalesce(sum(p.amount), 0) from payments p
         left join cases c on c.id = p.case_id left join shipments s on s.id = p.shipment_id
        where p.agency_id = a and p.state = 'regle' and p.at::date between d1 and d2
          and (b.id is null or coalesce(p.office_id, c.office_id, s.office_id) = b.id)) end as ca,
      case when money then (select coalesce(sum(p.amount), 0) from payments p
         left join cases c on c.id = p.case_id left join shipments s on s.id = p.shipment_id
        where p.agency_id = a and p.state in ('du','partiel')
          and (b.id is null or coalesce(p.office_id, c.office_id, s.office_id) = b.id)) end as reste
    from bureaux b
  )
  select bid, bname, total, opened, open_now, dec_n, acc_n, ref_n,
         round(100.0 * acc_n / nullif(acc_n + ref_n, 0), 1),
         delai, ship_open, ship_del, cli_new, tache_ret, ca, reste
  from chiffres
  order by total, bname;
end $$;

-- ------------------------------------------------------------------
-- 6 · Section 127 · Le rapport visa
-- ------------------------------------------------------------------
--
-- Un point mérite d'être écrit noir sur blanc, parce qu'il se confond tout
-- seul : le taux de refus OBSERVÉ par l'agence et le taux de refus PUBLIÉ par
-- le consulat ne sont pas la même chose et ne se comparent qu'avec précaution.
-- Le premier porte sur les dossiers de l'agence, souvent quelques dizaines ; le
-- second sur tout le poste, souvent des dizaines de milliers, et sur une année
-- qui n'est pas forcément celle du rapport. On les rend donc dans deux champs
-- distincts, avec l'année de la référence, et on ne calcule JAMAIS une moyenne
-- des deux. L'écart se lit, il ne se fusionne pas.

create or replace function report_visa(
  p_office uuid default null, p_from date default null, p_to date default null
) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  a     uuid := auth_agency_id();
  pick  uuid;
  offs  uuid[];
  money boolean := auth_can('finance:global');
  d1    date := coalesce(p_from, (current_date - 180));
  d2    date := coalesce(p_to, current_date);
  v     jsonb;
begin
  if a is null then raise exception 'hors agence' using errcode = '42501'; end if;
  if not auth_can('reports:view') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  if d2 < d1 then raise exception 'période à l''envers' using errcode = 'P0001'; end if;
  pick := pil_pick_office(p_office);
  offs := pil_offices_seen();

  select jsonb_build_object(
    'from', d1, 'to', d2, 'office', pick, 'money_visible', money,

    'cases', (select count(*) from cases c where c.agency_id = a
       and c.opened_at::date between d1 and d2 and pil_in_scope(c.office_id, pick, offs)),

    'by_country', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'code', t.code, 'label', t.label, 'n', t.n) order by t.n desc), '[]'::jsonb)
      from (select vt.country_code as code, vt.country as label, count(*) as n
              from cases c join visa_types vt on vt.id = c.visa_type_id
             where c.agency_id = a and c.opened_at::date between d1 and d2
               and pil_in_scope(c.office_id, pick, offs)
             group by vt.country_code, vt.country) t),

    'by_type', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id, 'label', t.label, 'category', t.category, 'n', t.n)
             order by t.n desc), '[]'::jsonb)
      from (select vt.id, vt.label, vt.category, count(*) as n
              from cases c join visa_types vt on vt.id = c.visa_type_id
             where c.agency_id = a and c.opened_at::date between d1 and d2
               and pil_in_scope(c.office_id, pick, offs)
             group by vt.id, vt.label, vt.category) t),

    'by_status', (
      select coalesce(jsonb_agg(jsonb_build_object('status', t.status, 'n', t.n)
                                order by t.n desc), '[]'::jsonb)
      from (select c.status, count(*) as n from cases c
             where c.agency_id = a and c.opened_at::date between d1 and d2
               and pil_in_scope(c.office_id, pick, offs)
             group by c.status) t),

    'by_stage', (
      select coalesce(jsonb_agg(jsonb_build_object('stage', t.stage, 'n', t.n)
                                order by t.n desc), '[]'::jsonb)
      from (select c.stage, count(*) as n from cases c
             where c.agency_id = a and c.status = 'ouvert'
               and pil_in_scope(c.office_id, pick, offs)
             group by c.stage) t),

    -- Le taux d'aboutissement : accepté sur décidé. NULL tant qu'aucune
    -- décision n'est tombée, jamais 0.
    'decided', (select count(*) from cases c where c.agency_id = a
       and c.decision_at::date between d1 and d2 and c.status in ('accepte','refuse')
       and pil_in_scope(c.office_id, pick, offs)),
    'accepted', (select count(*) from cases c where c.agency_id = a
       and c.decision_at::date between d1 and d2 and c.status = 'accepte'
       and pil_in_scope(c.office_id, pick, offs)),
    'refused', (select count(*) from cases c where c.agency_id = a
       and c.decision_at::date between d1 and d2 and c.status = 'refuse'
       and pil_in_scope(c.office_id, pick, offs)),
    'success_rate', (select round(100.0 * count(*) filter (where c.status = 'accepte')
                                  / nullif(count(*), 0), 1)
       from cases c where c.agency_id = a and c.decision_at::date between d1 and d2
         and c.status in ('accepte','refuse') and pil_in_scope(c.office_id, pick, offs)),

    -- Les délais moyens RÉELS. Chacun est mesuré entre deux dates
    -- effectivement enregistrées, et rendu NULL quand aucune paire n'existe.
    'delays', jsonb_build_object(
      'to_decision', (select round(avg(c.decision_at::date - c.opened_at::date), 1)
         from cases c where c.agency_id = a and c.decision_at::date between d1 and d2
           and pil_in_scope(c.office_id, pick, offs)),
      'to_deposit', (select round(avg(x.jours), 1) from (
           select (select min(ap.at::date) from appointments ap
                    where ap.case_id = c.id and ap.kind in ('depot','consulat','biometrie'))
                  - c.opened_at::date as jours
             from cases c where c.agency_id = a and c.opened_at::date between d1 and d2
               and pil_in_scope(c.office_id, pick, offs)) x where x.jours is not null),
      'to_close', (select round(avg(c.closed_at::date - c.decision_at::date), 1)
         from cases c where c.agency_id = a and c.closed_at is not null
           and c.decision_at is not null and c.closed_at::date between d1 and d2
           and pil_in_scope(c.office_id, pick, offs)),
      'docs_complete', (select round(avg(x.jours), 1) from (
           select (select max(dd.validated_at::date) from case_documents dd
                    where dd.case_id = c.id and dd.required and dd.validated_at is not null)
                  - c.opened_at::date as jours
             from cases c where c.agency_id = a and c.opened_at::date between d1 and d2
               and pil_in_scope(c.office_id, pick, offs)) x where x.jours is not null)
    ),

    -- Par agent : des chiffres bruts, sans note ni classement. Voir la note de
    -- la section 129 plus bas, elle vaut aussi ici.
    'by_agent', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', p.id, 'name', p.name,
               'opened', (select count(*) from cases c where c.agency_id = a
                            and c.assignee_id = p.id and c.opened_at::date between d1 and d2
                            and pil_in_scope(c.office_id, pick, offs)),
               'open_now', (select count(*) from cases c where c.agency_id = a
                            and c.assignee_id = p.id and c.status = 'ouvert'
                            and pil_in_scope(c.office_id, pick, offs)),
               'decided', (select count(*) from cases c where c.agency_id = a
                            and c.assignee_id = p.id and c.decision_at::date between d1 and d2
                            and c.status in ('accepte','refuse')
                            and pil_in_scope(c.office_id, pick, offs)),
               'accepted', (select count(*) from cases c where c.agency_id = a
                            and c.assignee_id = p.id and c.decision_at::date between d1 and d2
                            and c.status = 'accepte' and pil_in_scope(c.office_id, pick, offs))
             ) order by p.name), '[]'::jsonb)
      from profiles p where p.agency_id = a and p.active),

    -- L'observé de l'agence ET la référence publiée, côte à côte, jamais
    -- confondus. `reference_year` dit de quelle année vient la référence.
    'refusals_by_consulate', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'consulate_id', co.id, 'country', co.country, 'city', co.city,
               'centre', co.centre,
               'observed_decided', t.decided, 'observed_refused', t.refused,
               'observed_rate', round(100.0 * t.refused / nullif(t.decided, 0), 1),
               'reference_rate', co.ref_refusal_rate,
               'reference_year', co.ref_year
             ) order by t.decided desc), '[]'::jsonb)
      from (select c.consulate_id,
                   count(*) filter (where c.status in ('accepte','refuse')) as decided,
                   count(*) filter (where c.status = 'refuse') as refused
              from cases c
             where c.agency_id = a and c.consulate_id is not null
               and c.decision_at::date between d1 and d2
               and pil_in_scope(c.office_id, pick, offs)
             group by c.consulate_id) t
      join consulates co on co.id = t.consulate_id
      where t.decided > 0),

    'refusal_reasons', (
      select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'n', t.n)
                                order by t.n desc), '[]'::jsonb)
      from (select coalesce(c.refusal_code, 'autre') as code, count(*) as n
              from cases c where c.agency_id = a and c.status = 'refuse'
               and c.decision_at::date between d1 and d2
               and pil_in_scope(c.office_id, pick, offs)
             group by 1) t),

    -- Les pièces qui manquent le plus : c'est ce qui nourrit la liste de
    -- contrôle de l'agence, et c'est actionnable.
    'missing_documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'key', t.key, 'label', t.label, 'n', t.n) order by t.n desc), '[]'::jsonb)
      from (select dd.key, (array_agg(dd.label))[1] as label, count(*) as n
              from case_documents dd join cases c on c.id = dd.case_id
             where dd.agency_id = a and dd.required and dd.state in ('manquante','demandee')
               and c.status = 'ouvert' and pil_in_scope(c.office_id, pick, offs)
             group by dd.key order by count(*) desc limit 12) t)
  ) into v;

  if money then
    v := v || jsonb_build_object('revenue', (
      select coalesce(sum(p.amount), 0) from payments p join cases c on c.id = p.case_id
       where p.agency_id = a and p.state = 'regle' and p.at::date between d1 and d2
         and pil_in_scope(c.office_id, pick, offs)));
    v := v || jsonb_build_object('revenue_by_country', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'code', t.code, 'label', t.label, 'amount', t.amount) order by t.amount desc),
             '[]'::jsonb)
      from (select vt.country_code as code, vt.country as label, sum(p.amount) as amount
              from payments p join cases c on c.id = p.case_id
              join visa_types vt on vt.id = c.visa_type_id
             where p.agency_id = a and p.state = 'regle' and p.at::date between d1 and d2
               and pil_in_scope(c.office_id, pick, offs)
             group by vt.country_code, vt.country) t));
  else
    v := v || jsonb_build_object('revenue', null, 'revenue_reason', 'finance:global');
  end if;

  return v;
end $$;

-- ------------------------------------------------------------------
-- 7 · Section 128 · Le rapport fret
-- ------------------------------------------------------------------
--
-- Tout est calculé sur les dates réellement enregistrées, jamais estimé. Un
-- temps de transit moyen déduit d'une règle du pouce ferait prendre une
-- décision commerciale sur un chiffre inventé.
--
-- Le sens import / export / transit vient de la comparaison des pays de départ
-- et d'arrivée avec le pays de l'agence, lu sur ses bureaux. Une cargaison dont
-- ni le départ ni l'arrivée n'est renseigné compte dans « indéterminé » : la
-- ranger d'office en import gonflerait un chiffre sans raison.

create or replace function report_cargo(
  p_office uuid default null, p_from date default null, p_to date default null
) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  a     uuid := auth_agency_id();
  pick  uuid;
  offs  uuid[];
  money boolean := auth_can('finance:global');
  d1    date := coalesce(p_from, (current_date - 180));
  d2    date := coalesce(p_to, current_date);
  home  char(2);
  v     jsonb;
  tmp   jsonb;
  dem   jsonb;
begin
  if a is null then raise exception 'hors agence' using errcode = '42501'; end if;
  if not auth_can('reports:view') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  if d2 < d1 then raise exception 'période à l''envers' using errcode = 'P0001'; end if;
  pick := pil_pick_office(p_office);
  offs := pil_offices_seen();

  select o.country_code into home from offices o
   where o.agency_id = a and o.country_code is not null
   group by o.country_code order by count(*) desc limit 1;

  select jsonb_build_object(
    'from', d1, 'to', d2, 'office', pick, 'money_visible', money, 'home_country', home,

    'shipments', (select count(*) from shipments s where s.agency_id = a
       and s.created_at::date between d1 and d2 and pil_in_scope(s.office_id, pick, offs)),

    'by_direction', (
      select coalesce(jsonb_object_agg(t.sens, t.n), '{}'::jsonb)
      from (select case
                     when home is null then 'indetermine'
                     when s.country_to = home and s.country_from is distinct from home then 'import'
                     when s.country_from = home and s.country_to is distinct from home then 'export'
                     when s.country_from is null and s.country_to is null then 'indetermine'
                     else 'transit' end as sens,
                   count(*) as n
              from shipments s where s.agency_id = a
               and s.created_at::date between d1 and d2
               and pil_in_scope(s.office_id, pick, offs)
             group by 1) t),

    'by_mode', (
      select coalesce(jsonb_object_agg(t.mode, t.n), '{}'::jsonb)
      from (select s.mode, count(*) as n from shipments s
             where s.agency_id = a and s.created_at::date between d1 and d2
               and pil_in_scope(s.office_id, pick, offs)
             group by s.mode) t),

    -- Les volumes. `sum` sur zéro ligne rend NULL : on garde NULL, parce qu'un
    -- tonnage de 0 t voudrait dire « on a transporté du vide ».
    'weight_kg', (select sum(s.weight_kg) from shipments s where s.agency_id = a
       and s.created_at::date between d1 and d2 and pil_in_scope(s.office_id, pick, offs)),
    'volume_cbm', (select sum(s.volume_cbm) from shipments s where s.agency_id = a
       and s.created_at::date between d1 and d2 and pil_in_scope(s.office_id, pick, offs)),
    'packages', (select sum(s.packages) from shipments s where s.agency_id = a
       and s.created_at::date between d1 and d2 and pil_in_scope(s.office_id, pick, offs)),
    'containers', (select sum(s.containers_count) from shipments s where s.agency_id = a
       and s.created_at::date between d1 and d2 and s.mode = 'maritime_fcl'
       and pil_in_scope(s.office_id, pick, offs)),

    'by_country', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'from', t.cf, 'to', t.ct, 'n', t.n) order by t.n desc), '[]'::jsonb)
      from (select s.country_from as cf, s.country_to as ct, count(*) as n
              from shipments s where s.agency_id = a
               and s.created_at::date between d1 and d2
               and pil_in_scope(s.office_id, pick, offs)
             group by 1, 2 order by count(*) desc limit 20) t),

    'by_carrier', (
      select coalesce(jsonb_agg(jsonb_build_object('carrier', t.nom, 'n', t.n)
                                order by t.n desc), '[]'::jsonb)
      from (select coalesce(ca.name, s.carrier) as nom, count(*) as n
              from shipments s left join carriers ca on ca.id = s.carrier_id
             where s.agency_id = a and s.created_at::date between d1 and d2
               and coalesce(ca.name, s.carrier) is not null
               and pil_in_scope(s.office_id, pick, offs)
             group by 1 order by count(*) desc limit 15) t),

    -- Les trois temps du métier, chacun entre deux dates enregistrées.
    'transit_days', (select round(avg(s.arrived_at::date - s.etd), 1) from shipments s
       where s.agency_id = a and s.arrived_at is not null and s.etd is not null
         and s.arrived_at::date between d1 and d2 and pil_in_scope(s.office_id, pick, offs)),
    'customs_days', (select round(avg(s.cleared_at::date - s.arrived_at::date), 1) from shipments s
       where s.agency_id = a and s.cleared_at is not null and s.arrived_at is not null
         and s.cleared_at::date between d1 and d2 and pil_in_scope(s.office_id, pick, offs)),
    'delivery_days', (select round(avg(s.delivered_at::date - s.cleared_at::date), 1) from shipments s
       where s.agency_id = a and s.delivered_at is not null and s.cleared_at is not null
         and s.delivered_at::date between d1 and d2 and pil_in_scope(s.office_id, pick, offs)),

    -- Le retard : l'ETA annoncée contre la livraison réelle, et ce qui traîne
    -- encore aujourd'hui.
    'late_delivered', (select count(*) from shipments s where s.agency_id = a
       and s.delivered_at is not null and s.eta is not null
       and s.delivered_at::date > s.eta and s.delivered_at::date between d1 and d2
       and pil_in_scope(s.office_id, pick, offs)),
    'late_now', (select count(*) from shipments s where s.agency_id = a
       and s.status = 'en_cours' and s.eta is not null and s.eta < current_date
       and pil_in_scope(s.office_id, pick, offs)),
    'blocked', (select count(*) from shipments s where s.agency_id = a
       and s.status = 'bloquee' and pil_in_scope(s.office_id, pick, offs))
  ) into v;

  -- Les surestaries, par `shipment_counters` et par rien d'autre. On borne le
  -- lot aux cargaisons dont le compteur a pu démarrer dans la période.
  select jsonb_build_object(
    'shipments', count(*) filter (where x.overdue > 0),
    'overdue_days', sum(x.overdue),
    'amount', case when money then sum(x.montant) end,
    'currency', max(x.devise),
    'without_tariff', count(*) filter (where x.sans_tarif)
  ) into dem
  from (
    select
      coalesce(max((c ->> 'overdue_days')::int), 0) as overdue,
      coalesce(sum((c ->> 'amount')::numeric), 0) as montant,
      max(c ->> 'currency') as devise,
      bool_or(c ->> 'status' = 'tarif_absent') as sans_tarif
    from (select s.id from shipments s
           where s.agency_id = a and s.discharged_at is not null
             and s.discharged_at::date between d1 and d2
             and pil_in_scope(s.office_id, pick, offs)) cand,
         lateral jsonb_array_elements(shipment_counters(cand.id)) c
    group by cand.id
  ) x;
  v := v || jsonb_build_object('demurrage', coalesce(dem, '{}'::jsonb));

  -- Le produit, les coûts, la marge : réservés à `finance:global`.
  if money then
    v := v || jsonb_build_object('revenue', (
      select coalesce(sum(p.amount), 0) from payments p join shipments s on s.id = p.shipment_id
       where p.agency_id = a and p.state = 'regle' and p.at::date between d1 and d2
         and pil_in_scope(s.office_id, pick, offs)));

    if to_regclass('public.shipment_costs') is not null then
      execute 'select jsonb_build_object(
                 ''total'', (select coalesce(sum(sc.amount_base), 0) from shipment_costs sc
                             where sc.agency_id = $1 and sc.incurred_on between $4 and $5
                               and pil_in_scope(sc.office_id, $2, $3)),
                 ''by_kind'', (select coalesce(jsonb_object_agg(k.kind, k.montant), ''{}''::jsonb)
                             from (select sc.kind, sum(sc.amount_base) as montant
                                     from shipment_costs sc
                                    where sc.agency_id = $1 and sc.incurred_on between $4 and $5
                                      and pil_in_scope(sc.office_id, $2, $3)
                                    group by sc.kind) k))'
        into tmp using a, pick, offs, d1, d2;
      v := v || jsonb_build_object('costs', tmp);
      v := v || jsonb_build_object('margin',
        (v ->> 'revenue')::numeric - coalesce((tmp ->> 'total')::numeric, 0));
    else
      -- Sans le module des coûts, la marge n'est pas calculable. On le dit,
      -- plutôt que de rendre la marge égale au produit.
      v := v || jsonb_build_object('costs', null, 'margin', null,
                                   'margin_reason', 'module_couts_absent');
    end if;
  else
    v := v || jsonb_build_object('revenue', null, 'costs', null, 'margin', null,
                                 'revenue_reason', 'finance:global');
  end if;

  return v;
end $$;

-- ------------------------------------------------------------------
-- 8 · Section 129 · La performance des employés
-- ------------------------------------------------------------------
--
-- LA DÉCISION, ET POURQUOI.
--
-- Le cahier des charges dit que c'est un outil de gestion, pas un score
-- automatique opaque. Cette fonction rend donc des CHIFFRES BRUTS et rien
-- d'autre : aucune note globale, aucun classement, aucun feu tricolore, aucune
-- pondération cachée.
--
-- La raison n'est pas de la timidité. Un score qui range les gens du meilleur
-- au pire finit toujours par servir à autre chose que ce pour quoi il a été
-- écrit : la prime, l'entretien annuel, le licenciement. Personne ne relit
-- jamais la formule, et la formule, elle, ne sait pas qu'Amira a repris les
-- vingt dossiers les plus abîmés du bureau pendant que son collègue prenait les
-- neufs. Les mêmes chiffres bruts, lus par un humain qui connaît son équipe,
-- disent la vérité ; agrégés en une note sur cent, ils la cachent.
--
-- Conséquence dans le rendu : les lignes sortent triées PAR NOM, jamais par un
-- indicateur. Un tri par performance est un classement qui ne dit pas son nom.

create or replace function report_team(
  p_from date default null, p_to date default null
) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  a     uuid := auth_agency_id();
  offs  uuid[];
  money boolean := auth_can('finance:global');
  d1    date := coalesce(p_from, date_trunc('month', current_date)::date);
  d2    date := coalesce(p_to, current_date);
  v     jsonb;
  crm   boolean := to_regclass('public.leads') is not null;
begin
  if a is null then raise exception 'hors agence' using errcode = '42501'; end if;
  if not auth_can('reports:view') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  if d2 < d1 then raise exception 'période à l''envers' using errcode = 'P0001'; end if;
  offs := pil_offices_seen();

  select jsonb_build_object(
    'from', d1, 'to', d2, 'money_visible', money,
    -- Écrit dans le rendu, pour que le front ne soit jamais tenté d'en ajouter un.
    'no_score', true,
    'no_score_reason', 'chiffres bruts seulement : un score global finit toujours par servir à autre chose',
    'rows', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', p.id, 'name', p.name, 'role', p.role, 'office_id', p.office_id,
        'active', p.active,

        'cases_active', (select count(*) from cases c where c.agency_id = a
           and c.assignee_id = p.id and c.status = 'ouvert'
           and pil_in_scope(c.office_id, null, offs)),
        'cases_done', (select count(*) from cases c where c.agency_id = a
           and c.assignee_id = p.id and c.closed_at::date between d1 and d2
           and pil_in_scope(c.office_id, null, offs)),
        'cases_opened', (select count(*) from cases c where c.agency_id = a
           and c.assignee_id = p.id and c.opened_at::date between d1 and d2
           and pil_in_scope(c.office_id, null, offs)),

        'tasks_done', (select count(*) from tasks t
           left join cases c on c.id = t.case_id left join shipments s on s.id = t.shipment_id
           where t.agency_id = a and t.assignee_id = p.id and t.done
             and t.done_at::date between d1 and d2
             and pil_in_scope(coalesce(c.office_id, s.office_id), null, offs)),
        'tasks_overdue', (select count(*) from tasks t
           left join cases c on c.id = t.case_id left join shipments s on s.id = t.shipment_id
           where t.agency_id = a and t.assignee_id = p.id and not t.done and t.due_at < now()
             and pil_in_scope(coalesce(c.office_id, s.office_id), null, offs)),

        -- Clients suivis : les personnes distinctes dont cet agent porte au
        -- moins un dossier ouvert.
        'clients_followed', (select count(distinct c.client_id) from cases c
           where c.agency_id = a and c.assignee_id = p.id and c.status = 'ouvert'
             and pil_in_scope(c.office_id, null, offs)),

        -- Pièces traitées : validées ou refusées par cette personne. C'est le
        -- travail invisible du métier, et il ne se voit nulle part ailleurs.
        'documents_handled', (select count(*) from case_documents dd
           join cases c on c.id = dd.case_id
           where dd.agency_id = a and dd.validated_by = p.id
             and dd.validated_at::date between d1 and d2
             and pil_in_scope(c.office_id, null, offs)),

        'messages_sent', (select count(*) from messages m
           left join cases c on c.id = m.case_id
           where m.agency_id = a and m.author_id = p.id and m.direction = 'sortant'
             and not m.automated and m.at::date between d1 and d2
             and pil_in_scope(c.office_id, null, offs)),

        -- Le chiffre d'affaires généré. NULL sans `finance:global` : la caisse
        -- d'un collègue n'est pas une donnée d'équipe.
        'revenue', case when money then (
           select coalesce(sum(pm.amount), 0) from payments pm
            left join cases c on c.id = pm.case_id
            left join shipments s on s.id = pm.shipment_id
            where pm.agency_id = a and pm.state = 'regle'
              and pm.collected_by = p.id and pm.at::date between d1 and d2
              and pil_in_scope(coalesce(pm.office_id, c.office_id, s.office_id), null, offs)) end,

        -- La conversion des prospects, si le module CRM est installé. Deux
        -- nombres, pas un pourcentage : un taux sur trois prospects ne veut
        -- rien dire et se lit pourtant comme une note.
        'leads_assigned', case when crm then pil_leads_count(a, p.id, offs, d1, d2, false) end,
        'leads_won', case when crm then pil_leads_count(a, p.id, offs, d1, d2, true) end
      ) order by p.name), '[]'::jsonb)
      from profiles p where p.agency_id = a)
  ) into v;

  return v;
end $$;

-- ------------------------------------------------------------------
-- 9 · Section 184 · Ce qui dépasse le délai promis
-- ------------------------------------------------------------------
--
-- Une règle inactive ne produit rien. C'est la contrepartie du semis
-- désactivé : tant que l'agence n'a pas choisi ses délais, cet écran est vide,
-- et c'est le bon comportement.

create or replace function sla_breaches(p_office uuid default null)
returns table (
  rule_id uuid, event text, target_minutes int,
  entity_kind text, entity_id uuid, reference text, label text,
  since timestamptz, minutes_elapsed int, minutes_over int, link text
)
language plpgsql stable security definer set search_path = public, auth as $$
declare
  a    uuid := auth_agency_id();
  pick uuid;
  offs uuid[];
  r    sla_rules;
begin
  if a is null then raise exception 'hors agence' using errcode = '42501'; end if;
  pick := pil_pick_office(p_office);
  offs := pil_offices_seen();

  for r in select * from sla_rules where agency_id = a and active loop

    if r.event = 'document_recu' then
      return query
      select r.id, r.event, r.target_minutes, 'piece'::text, dd.id, c.reference,
             coalesce(dd.label ->> 'fr', dd.key),
             dd.received_at,
             (extract(epoch from (now() - dd.received_at)) / 60)::int,
             (extract(epoch from (now() - dd.received_at)) / 60 - r.target_minutes)::int,
             '/dossiers/' || c.id::text
        from case_documents dd join cases c on c.id = dd.case_id
       where dd.agency_id = a and dd.state = 'recue' and dd.received_at is not null
         and dd.received_at < now() - make_interval(mins => r.target_minutes)
         and pil_in_scope(c.office_id, pick, offs);

    elsif r.event = 'cargaison_arrivee' then
      return query
      select r.id, r.event, r.target_minutes, 'cargaison'::text, s.id, s.reference,
             coalesce(s.origin_port, '') || ' → ' || coalesce(s.dest_port, ''),
             s.arrived_at,
             (extract(epoch from (now() - s.arrived_at)) / 60)::int,
             (extract(epoch from (now() - s.arrived_at)) / 60 - r.target_minutes)::int,
             '/cargaisons/' || s.id::text
        from shipments s
       where s.agency_id = a and s.arrived_at is not null and s.cleared_at is null
         and s.status = 'en_cours'
         and s.arrived_at < now() - make_interval(mins => r.target_minutes)
         and pil_in_scope(s.office_id, pick, offs);

    elsif r.event = 'dossier_bloque' then
      -- « Bloqué » n'est un état enregistré que sur les cargaisons. On ne
      -- déduit pas un blocage de dossier d'une absence de mouvement : ce
      -- serait de l'inactivité, ce qui est autre chose, et cet autre chose est
      -- déjà compté dans `dashboard_today`.
      return query
      select r.id, r.event, r.target_minutes, 'cargaison'::text, s.id, s.reference,
             coalesce(s.blocked_reason, ''), s.blocked_since,
             (extract(epoch from (now() - s.blocked_since)) / 60)::int,
             (extract(epoch from (now() - s.blocked_since)) / 60 - r.target_minutes)::int,
             '/cargaisons/' || s.id::text
        from shipments s
       where s.agency_id = a and s.status = 'bloquee' and s.blocked_since is not null
         and s.blocked_since < now() - make_interval(mins => r.target_minutes)
         and pil_in_scope(s.office_id, pick, offs);

    elsif r.event = 'message_client' then
      return query
      select r.id, r.event, r.target_minutes, 'message'::text, m.id, c.reference,
             left(m.body, 80), m.at,
             (extract(epoch from (now() - m.at)) / 60)::int,
             (extract(epoch from (now() - m.at)) / 60 - r.target_minutes)::int,
             '/dossiers/' || c.id::text
        from messages m join cases c on c.id = m.case_id
       where m.agency_id = a and m.direction = 'entrant'
         and m.at < now() - make_interval(mins => r.target_minutes)
         and not exists (select 1 from messages m2 where m2.case_id = m.case_id
                          and m2.direction = 'sortant' and m2.at > m.at)
         and pil_in_scope(c.office_id, pick, offs);

    elsif r.event = 'paiement_du' then
      return query
      select r.id, r.event, r.target_minutes, 'paiement'::text, pm.id,
             coalesce(c.reference, s.reference),
             coalesce(pm.label ->> 'fr', pm.kind),
             pm.due_at::timestamptz,
             (extract(epoch from (now() - pm.due_at::timestamptz)) / 60)::int,
             (extract(epoch from (now() - pm.due_at::timestamptz)) / 60 - r.target_minutes)::int,
             '/paiements'
        from payments pm
        left join cases c on c.id = pm.case_id
        left join shipments s on s.id = pm.shipment_id
       where pm.agency_id = a and pm.state in ('du','partiel') and pm.due_at is not null
         and pm.due_at::timestamptz < now() - make_interval(mins => r.target_minutes)
         and pil_in_scope(coalesce(pm.office_id, c.office_id, s.office_id), pick, offs);

    elsif r.event = 'lead_nouveau' and to_regclass('public.leads') is not null then
      return query execute
        'select $1::uuid, $2::text, $3::int, ''prospect''::text, l.id,
                null::text,
                coalesce(nullif(trim(coalesce(l.first_name,'''') || '' '' || coalesce(l.last_name,'''')), ''''),
                         l.company_name),
                l.created_at,
                (extract(epoch from (now() - l.created_at)) / 60)::int,
                (extract(epoch from (now() - l.created_at)) / 60 - $3)::int,
                ''/prospects''
           from leads l
          where l.agency_id = $4 and l.deleted_at is null and l.status = ''nouveau''
            and l.created_at < now() - make_interval(mins => $3)
            and pil_in_scope(l.office_id, $5, $6)'
        using r.id, r.event, r.target_minutes, a, pick, offs;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------
-- 10 · Section 185 · Le moteur de retards
-- ------------------------------------------------------------------
--
-- Une seule fonction, un seul format, un seul écran. Six fonctions rendant six
-- formes différentes obligeraient l'écran à six mises en page, et la septième
-- catégorie ajoutée un jour n'y serait jamais branchée.

create or replace function overdue_items(p_office uuid default null)
returns table (
  kind text, id uuid, reference text, label text,
  due timestamptz, days_late int, link text, office_id uuid
)
language plpgsql stable security definer set search_path = public, auth as $$
declare
  a    uuid := auth_agency_id();
  pick uuid;
  offs uuid[];
begin
  if a is null then raise exception 'hors agence' using errcode = '42501'; end if;
  pick := pil_pick_office(p_office);
  offs := pil_offices_seen();

  return query
  -- Dossiers : la date d'échéance promise au client est passée.
  select 'dossier'::text, c.id, c.reference,
         coalesce(cl.first_name || ' ' || cl.last_name, c.reference),
         c.due_at::timestamptz, (current_date - c.due_at)::int,
         '/dossiers/' || c.id::text, c.office_id
    from cases c left join clients cl on cl.id = c.client_id
   where c.agency_id = a and c.status = 'ouvert'
     and c.due_at is not null and c.due_at < current_date
     and pil_in_scope(c.office_id, pick, offs);

  return query
  -- Cargaisons : l'ETA est passée sans livraison.
  select 'cargaison'::text, s.id, s.reference,
         coalesce(s.origin_port, '') || ' → ' || coalesce(s.dest_port, ''),
         s.eta::timestamptz, (current_date - s.eta)::int,
         '/cargaisons/' || s.id::text, s.office_id
    from shipments s
   where s.agency_id = a and s.status in ('en_cours','bloquee')
     and s.eta is not null and s.eta < current_date and s.delivered_at is null
     and pil_in_scope(s.office_id, pick, offs);

  return query
  select 'tache'::text, t.id, coalesce(c.reference, s.reference),
         coalesce(t.title ->> 'fr', ''), t.due_at,
         (current_date - t.due_at::date)::int, '/taches',
         coalesce(c.office_id, s.office_id)
    from tasks t
    left join cases c on c.id = t.case_id
    left join shipments s on s.id = t.shipment_id
   where t.agency_id = a and not t.done and t.due_at is not null and t.due_at < now()
     and pil_in_scope(coalesce(c.office_id, s.office_id), pick, offs);

  return query
  -- Pièces : demandées au client il y a plus de sept jours, toujours absentes.
  -- Sans ce délai, toute pièce d'un dossier ouvert de la veille serait « en
  -- retard », et l'écran perdrait tout son sens.
  select 'piece'::text, dd.id, c.reference, coalesce(dd.label ->> 'fr', dd.key),
         dd.requested_at, (current_date - dd.requested_at::date)::int,
         '/dossiers/' || c.id::text, c.office_id
    from case_documents dd join cases c on c.id = dd.case_id
   where dd.agency_id = a and dd.required and dd.state in ('manquante','demandee')
     and c.status = 'ouvert' and dd.requested_at is not null
     and dd.requested_at < now() - interval '7 days'
     and pil_in_scope(c.office_id, pick, offs);

  return query
  select 'paiement'::text, pm.id, coalesce(c.reference, s.reference),
         coalesce(pm.label ->> 'fr', pm.kind), pm.due_at::timestamptz,
         (current_date - pm.due_at)::int, '/paiements',
         coalesce(pm.office_id, c.office_id, s.office_id)
    from payments pm
    left join cases c on c.id = pm.case_id
    left join shipments s on s.id = pm.shipment_id
   where pm.agency_id = a and pm.state in ('du','partiel')
     and pm.due_at is not null and pm.due_at < current_date
     and pil_in_scope(coalesce(pm.office_id, c.office_id, s.office_id), pick, offs);

  if to_regclass('public.invoices') is not null then
    return query execute
      'select ''facture''::text, i.id, i.number, coalesce(i.note, i.number),
              i.due_date::timestamptz, (current_date - i.due_date)::int,
              ''/factures'', i.office_id
         from invoices i
        where i.agency_id = $1
          and i.status in (''emise'',''partiellement_reglee'',''en_retard'')
          and i.due_date is not null and i.due_date < current_date
          and pil_in_scope(i.office_id, $2, $3)'
      using a, pick, offs;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 11 · Section 189 · L'analyse plateforme
-- ------------------------------------------------------------------
--
-- LE POINT QUI SE TROMPE TOUT SEUL : le revenu récurrent.
--
-- Un abonnement annuel réglé sur facture n'est pas un revenu récurrent au sens
-- habituel du terme. L'argent tombe une fois, en un versement, et si l'agence
-- ne renouvelle pas, il ne tombe plus du tout. Pour le comparer à un
-- abonnement mensuel, on ramène l'annuel au douzième, et on le DIT dans le
-- libellé : `mrr_annual_twelfth` porte cette part, séparée de
-- `mrr_monthly_plans`. Additionner les deux sans le dire donnerait un chiffre
-- juste arithmétiquement et faux dans la tête de celui qui le lit.

create or replace function platform_analytics()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v      jsonb;
  abos   boolean := to_regclass('public.subscriptions') is not null;
  mrr_m  numeric := 0;
  mrr_a  numeric := 0;
  source text := 'platform_invoices';
  n_essai bigint := 0; n_conv bigint := 0; n_churn bigint := 0;
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;

  if abos then
    source := 'subscriptions';
    -- Le prix est déjà exprimé par siège et par MOIS. Un contrat mensuel entre
    -- donc tel quel ; un contrat annuel vaut douze fois ce montant une fois par
    -- an, soit le même douzième une fois ramené au mois. On l'écrit en toutes
    -- lettres pour que personne ne « corrige » un jour une division absente.
    execute 'select
        coalesce(sum(s.price_per_user_month * s.seats)
                 filter (where s.billing_period = ''mensuel''), 0),
        coalesce(sum((s.price_per_user_month * s.seats * 12) / 12.0)
                 filter (where s.billing_period = ''annuel''), 0),
        count(*) filter (where s.status = ''essai'')
      from subscriptions s where s.status in (''active'',''essai'')'
      into mrr_m, mrr_a, n_essai;

    if to_regclass('public.subscription_events') is not null then
      execute 'select
          count(*) filter (where e.kind = ''creee'' and e.at >= now() - interval ''90 days''),
          count(*) filter (where e.kind = ''resiliee'' and e.at >= now() - interval ''90 days'')
        from subscription_events e'
        into n_conv, n_churn;
    end if;
  else
    -- À défaut du module des abonnements, on lit ce que la plateforme a
    -- réellement facturé le mois dernier. Ce n'est pas un revenu récurrent,
    -- c'est un encaissement constaté, et le champ `mrr_source` le dit.
    select coalesce(sum(amount), 0) into mrr_m from platform_invoices
     where period = date_trunc('month', current_date)::date
       and status in ('envoyee','reglee');
    select count(*) into n_essai from agencies
     where plan = 'essai' and deleted_at is null;
  end if;

  select jsonb_build_object(
    'generated_at', now(),

    -- Le revenu, avec sa provenance et son avertissement.
    'mrr_source', source,
    'mrr_monthly_plans', round(mrr_m, 3),
    'mrr_annual_twelfth', round(mrr_a, 3),
    'mrr_total', round(mrr_m + mrr_a, 3),
    'arr', round((mrr_m + mrr_a) * 12, 3),
    'mrr_note', 'Un abonnement annuel réglé sur facture est ramené au douzième pour être comparé à un abonnement mensuel. Ce n''est pas le même revenu : il tombe une fois par an.',

    'agencies_total',     (select count(*) from agencies where deleted_at is null),
    'agencies_active',    (select count(*) from agencies
                            where deleted_at is null and suspended_at is null),
    'agencies_suspended', (select count(*) from agencies
                            where deleted_at is null and suspended_at is not null),
    'trials', n_essai,
    'trials_ending_30d',  (select count(*) from agencies
                            where deleted_at is null and plan = 'essai'
                              and trial_ends_at between now() and now() + interval '30 days'),
    'conversions_90d', n_conv,
    'churn_90d', n_churn,
    -- Le taux d'attrition sur trois mois. NULL quand il n'y a aucune agence
    -- active : une division par zéro rendue en 0 % laisserait croire à une
    -- rétention parfaite sur un parc vide.
    'churn_rate_90d', (select round(100.0 * n_churn / nullif(count(*), 0), 1)
                        from agencies where deleted_at is null and suspended_at is null),

    'accounts',   (select count(*) from profiles where active),
    'offices',    (select count(*) from offices),
    'clients',    (select count(*) from clients where deleted_at is null),
    'cases',      (select count(*) from cases),
    'cases_open', (select count(*) from cases where status = 'ouvert'),
    'shipments',  (select count(*) from shipments),
    'shipments_open', (select count(*) from shipments where status = 'en_cours'),

    -- Le stockage vient du compteur d'usage, pas d'un comptage de fichiers :
    -- c'est lui qui sert déjà aux quotas, et deux comptes différents finiraient
    -- par se contredire devant un client.
    'storage_bytes', (select coalesce(sum(storage_bytes), 0) from usage_counters),

    'by_plan', (
      select coalesce(jsonb_object_agg(t.plan, t.n), '{}'::jsonb)
      from (select plan, count(*) as n from agencies
             where deleted_at is null group by plan) t),

    'signups_by_month', (
      select coalesce(jsonb_agg(jsonb_build_object('month', to_char(t.m, 'YYYY-MM'), 'n', t.n)
                                order by t.m), '[]'::jsonb)
      from (select date_trunc('month', created_at)::date as m, count(*) as n
              from agencies where deleted_at is null
                and created_at >= date_trunc('month', now()) - interval '11 months'
             group by 1) t)
  ) into v;

  return v;
end $$;

-- ------------------------------------------------------------------
-- 12 · Les droits sur les fonctions
-- ------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'dashboard_today(uuid)',
    'dashboard_office(uuid, date, date)',
    'dashboard_agency(date, date)',
    'report_visa(uuid, date, date)',
    'report_cargo(uuid, date, date)',
    'report_team(date, date)',
    'sla_breaches(uuid)',
    'overdue_items(uuid)',
    'platform_analytics()',
    'pil_item(jsonb, text, text, bigint, text, text)',
    'pil_leads_count(uuid, uuid, uuid[], date, date, boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ------------------------------------------------------------------
-- 13 · Le piège des fonctions de déclencheur
-- ------------------------------------------------------------------
--
-- PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction nouvellement créée.
-- Pour une fonction de déclencheur, personne ne le remarque : elle s'appelle
-- toute seule. Mais elle reste appelable directement par un anonyme, et une
-- fonction SECURITY DEFINER appelable par un anonyme est une porte ouverte.
-- Même boucle qu'en fin de 0044 : une par une, l'oubli reviendrait.
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
