-- 0058 · Les tâches planifiées.
--
-- Jusqu'ici, tout ce qui devait tourner la nuit ne tournait que si quelqu'un
-- ouvrait un navigateur. Les relances partaient depuis l'onglet d'un agent, ce
-- qui les doublait quand deux agents travaillaient en même temps, et les
-- supprimait quand personne ne travaillait. La purge des données arrivées à
-- échéance, elle, ne tournait jamais.
--
-- POURQUOI `pg_cron` ET PAS UNE FONCTION DE BORD PLANIFIÉE.
--
-- Ces travaux ne font que lire et écrire dans la base. Les faire sortir par le
-- réseau pour rentrer aussitôt ajouterait un jeton à gérer, un réseau qui peut
-- tomber, et un journal de plus à surveiller. Ce qui doit sortir (envoyer un
-- message WhatsApp, appeler un webhook) reste en fonction de bord : c'est ce
-- que fait `wa_outbox`, la file, que ces travaux se contentent de remplir.
--
-- L'HEURE COMPTE. Tout est en UTC dans pg_cron. La Tunisie est à UTC+1 toute
-- l'année (pas de changement d'heure depuis 2009). Une tâche à 5 h UTC tourne
-- donc à 6 h du matin à Tunis : avant l'ouverture des agences, après le creux
-- de la nuit. Une tâche à 22 h UTC tourne à 23 h, quand plus personne ne saisit.

create extension if not exists pg_cron;

-- ------------------------------------------------------------------
-- Le journal des passages
-- ------------------------------------------------------------------
--
-- pg_cron garde son propre journal, mais il est technique : il dit si l'ordre a
-- réussi, pas ce qu'il a fait. Celui-ci dit combien de lignes ont bougé. Le jour
-- où une agence demande pourquoi elle n'a pas eu son alerte, c'est ici qu'on
-- regarde en premier.

create table if not exists job_runs (
  id         bigserial primary key,
  job        text not null,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  ok         boolean,
  affected   int,
  detail     text
);
create index if not exists job_runs_recent on job_runs (job, started_at desc);

alter table job_runs enable row level security;
alter table job_runs force row level security;

-- Seule la plateforme lit ce journal : il porte des volumes agrégés sur toutes
-- les agences, et une agence n'a pas à savoir combien de dossiers ont les autres.
drop policy if exists job_runs_platform on job_runs;
create policy job_runs_platform on job_runs for select to authenticated
  using (is_platform_admin());

revoke all on job_runs from anon, authenticated;
grant select on job_runs to authenticated;
grant all on job_runs to service_role;
grant usage, select on sequence job_runs_id_seq to service_role;

-- L'enveloppe qui exécute et journalise. Elle avale l'erreur volontairement :
-- une tâche qui échoue ne doit pas empêcher les suivantes de tourner, et
-- surtout pas rester invisible.
create or replace function run_job(p_job text, p_sql text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_n int := 0;
begin
  insert into job_runs (job) values (p_job) returning id into v_id;
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    update job_runs set ended_at = now(), ok = true, affected = v_n where id = v_id;
  exception when others then
    update job_runs set ended_at = now(), ok = false, detail = left(sqlerrm, 500) where id = v_id;
  end;
end $$;
revoke all on function run_job(text, text) from public, anon, authenticated;

-- ------------------------------------------------------------------
-- Les travaux
-- ------------------------------------------------------------------
--
-- On ne planifie que ce qui existe : une tâche qui appelle une fonction absente
-- échoue toutes les nuits et remplit le journal de bruit. Le bloc teste donc la
-- présence de chaque fonction avant de la planifier.

-- PostgreSQL n'accepte pas de procédure imbriquée : on planifie à plat, chaque
-- tâche gardée par son propre test d'existence.

-- Deux travaux du métier s'appliquent à UNE agence : `run_automations` et
-- `purge_expired`. Les planifier tels quels n'aurait rien fait, faute de savoir
-- sur quelle agence. On les enveloppe, et l'enveloppe saute une agence en
-- erreur au lieu d'arrêter la tournée : le parc entier ne doit pas s'arrêter
-- parce qu'une seule agence a une donnée abîmée.

create or replace function run_automations_all()
returns int
language plpgsql security definer set search_path = public as $$
declare a record; n int := 0;
begin
  for a in select id from agencies where deleted_at is null and suspended_at is null loop
    begin
      perform run_automations(a.id, false);
      n := n + 1;
    exception when others then
      insert into job_runs (job, started_at, ended_at, ok, detail)
      values ('automatisations:' || a.id, now(), now(), false, left(sqlerrm, 300));
    end;
  end loop;
  return n;
end $$;
revoke all on function run_automations_all() from public, anon, authenticated;

create or replace function purge_expired_all()
returns int
language plpgsql security definer set search_path = public as $$
declare a record; n int := 0;
begin
  -- Une agence suspendue garde ses données : la purge est une obligation de
  -- conservation maximale, pas une punition.
  for a in select id from agencies where deleted_at is null loop
    begin
      perform purge_expired(a.id);
      n := n + 1;
    exception when others then
      insert into job_runs (job, started_at, ended_at, ok, detail)
      values ('purge:' || a.id, now(), now(), false, left(sqlerrm, 300));
    end;
  end loop;
  return n;
end $$;
revoke all on function purge_expired_all() from public, anon, authenticated;

do $$
begin
  -- Les relances du métier : ce sont elles qui faisaient double emploi quand
  -- deux agents avaient l'application ouverte. Toutes les heures, en journée.
  perform cron.unschedule('visaflow_automatisations') where exists (
    select 1 from cron.job where jobname = 'visaflow_automatisations');
  perform cron.schedule('visaflow_automatisations', '0 6-19 * * *',
    $sql$select run_job('automatisations', 'select run_automations_all()')$sql$);

  -- La balayeuse des alertes : passeports qui expirent, pièces périmées,
  -- rendez-vous de demain, factures échues, jours francs qui se terminent.
  -- Une fois par jour, à 5 h UTC, soit 6 h à Tunis : l'agent trouve sa liste
  -- en arrivant, et pas une notification en pleine nuit.
  if to_regprocedure('public.notification_sweep()') is not null then
    perform cron.unschedule('visaflow_alertes') where exists (
      select 1 from cron.job where jobname = 'visaflow_alertes');
    perform cron.schedule('visaflow_alertes', '0 5 * * *',
      $sql$select run_job('alertes', 'select notification_sweep()')$sql$);
  end if;

  -- La consommation des agences, pour la console et les quotas d'affichage.
  -- Les quotas qui BLOQUENT, eux, comptent en direct : ils ne dépendent pas
  -- de cette tâche, et c'est voulu.
  if to_regprocedure('public.refresh_usage_all()') is not null then
    perform cron.unschedule('visaflow_consommation') where exists (
      select 1 from cron.job where jobname = 'visaflow_consommation');
    perform cron.schedule('visaflow_consommation', '30 4 * * *',
      $sql$select run_job('consommation', 'select refresh_usage_all()')$sql$);
  end if;

  -- La purge des données arrivées au terme de leur conservation. C'est une
  -- obligation de la loi 2004-63, et jusqu'ici elle ne tournait jamais.
  -- À 23 h à Tunis, quand plus personne ne saisit.
  perform cron.unschedule('visaflow_purge') where exists (
    select 1 from cron.job where jobname = 'visaflow_purge');
  perform cron.schedule('visaflow_purge', '0 22 * * *',
    $sql$select run_job('purge', 'select purge_expired_all()')$sql$);

  -- Les codes à usage unique périmés et les jetons d'appareil expirés. Toutes
  -- les heures : un code de vérification qui traîne est un code qu'on peut
  -- rejouer.
  perform cron.unschedule('visaflow_menage_jetons') where exists (
    select 1 from cron.job where jobname = 'visaflow_menage_jetons');
  perform cron.schedule('visaflow_menage_jetons', '17 * * * *',
    $sql$select run_job('menage_jetons',
      'delete from otp_codes where expires_at < now() - interval ''1 day''')$sql$);

  -- Le journal des passages lui-même : on garde soixante jours. Au-delà, il ne
  -- sert plus à comprendre, seulement à occuper de la place.
  perform cron.unschedule('visaflow_menage_journal') where exists (
    select 1 from cron.job where jobname = 'visaflow_menage_journal');
  perform cron.schedule('visaflow_menage_journal', '45 3 * * 0',
    $sql$select run_job('menage_journal',
      'delete from job_runs where started_at < now() - interval ''60 days''')$sql$);
end $$;

-- Ce que la console plateforme affiche du dernier passage de chaque travail.
create or replace function platform_jobs()
returns jsonb
language plpgsql stable security definer set search_path = public, cron as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'job', j.jobname, 'schedule', j.schedule, 'active', j.active,
      'last_run', r.started_at, 'last_ok', r.ok, 'last_affected', r.affected,
      'last_detail', r.detail
    ) order by j.jobname), '[]'::jsonb)
    from cron.job j
    left join lateral (
      select * from job_runs x
      where x.job = replace(j.jobname, 'visaflow_', '')
      order by x.started_at desc limit 1
    ) r on true
    where j.jobname like 'visaflow_%'
  );
end $$;
revoke all on function platform_jobs() from public, anon;
grant execute on function platform_jobs() to authenticated;
