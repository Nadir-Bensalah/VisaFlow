-- 0040 · L'alerte de créneau libéré.
--
-- L'étude de marché est brutale sur ce point : « c'est le produit entier de
-- tls-visa.com ». Une société vit de cette seule fonction. Le goulot du métier
-- n'est pas le dossier, c'est le CRÉNEAU : 200 à 350 TND sur un ticket de 550.
--
-- Ce qu'on ne fera pas : aspirer le site du prestataire. C'est fragile, c'est
-- contraire à ses conditions, et ça casse au premier changement de page. Ce
-- qu'on fait à la place vaut mieux : quand un créneau apparaît, l'agent sait en
-- une seconde POUR QUI le prendre.
--
-- Parce que la vraie question n'est pas « qui est le premier de la file », mais
-- « qui est le premier de la file DONT LE DOSSIER EST PRÊT ». Réserver pour
-- quelqu'un à qui il manque deux pièces, c'est brûler le créneau : il ne se
-- présentera pas, ou il sera refusé à l'accueil. Le classement tient donc
-- compte de l'état réel du dossier, et le dit.

-- Un créneau vu et non encore pris est un état à part entière : c'est
-- exactement le moment où l'alerte doit partir.
alter table slot_attempts drop constraint if exists slot_attempts_result_check;
alter table slot_attempts add constraint slot_attempts_result_check
  check (result in ('aucun_creneau','creneau_libre','creneau_pris','site_indisponible','compte_bloque','erreur'));

comment on column slot_attempts.result is
  'creneau_libre : un créneau est visible mais pas encore réservé. C''est l''instant où il faut savoir pour qui le prendre.';

/*
 * Pour qui prendre ce créneau ?
 *
 * On rend la file d'attente du poste, dans l'ordre où il faut appeler : les
 * dossiers PRÊTS d'abord, puis les autres, chacun avec ce qui lui manque. Un
 * dossier est prêt quand toutes ses pièces obligatoires sont reçues ou validées
 * et que sa biométrie, si elle existe, tient encore.
 */
create or replace function slot_candidates(p_consulate uuid, p_limit int default 20)
returns jsonb
language sql stable
set search_path = public
as $$
  with file as (
    select
      q.id as entry_id, q.case_id, q.priority, q.joined_at,
      c.reference, c.travel_date, c.stage,
      cl.id as client_id, cl.first_name, cl.last_name, cl.native_name,
      cl.phone, cl.whatsapp, cl.biometrics_at,
      -- Les pièces obligatoires du dossier, et celles qui manquent encore.
      (select count(*) from case_documents d
        where d.case_id = c.id and d.required) as docs_required,
      (select count(*) from case_documents d
        where d.case_id = c.id and d.required and d.state in ('recue','validee')) as docs_ready
    from appointment_queue q
    join cases c on c.id = q.case_id
    join clients cl on cl.id = c.client_id
    where q.consulate_id = p_consulate
      and q.status = 'attente'
      and c.status = 'ouvert'
  ), juge as (
    select
      f.*,
      (f.docs_required = f.docs_ready) as docs_ok,
      -- Les empreintes valent 59 mois. Encore valables, elles dispensent du
      -- déplacement et changent donc ce qu'on peut réserver.
      (f.biometrics_at is not null and f.biometrics_at > now() - interval '59 months') as bio_ok
    from file f
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'entry_id', entry_id,
    'case_id', case_id,
    'reference', reference,
    'client', jsonb_build_object(
      'id', client_id, 'first_name', first_name, 'last_name', last_name,
      'native_name', native_name, 'phone', coalesce(whatsapp, phone)),
    'priority', priority,
    'joined_at', joined_at,
    'travel_date', travel_date,
    'ready', docs_ok,
    'docs_ready', docs_ready,
    'docs_required', docs_required,
    'docs_missing', greatest(0, docs_required - docs_ready),
    'biometrics_valid', bio_ok
  ) order by
      -- Un dossier prêt d'abord : réserver pour un dossier incomplet brûle le
      -- créneau, le client ne passera pas l'accueil.
      docs_ok desc,
      -- Puis l'urgence déclarée, puis la date de voyage, puis l'ancienneté
      -- dans la file. On ne double personne sans raison.
      case priority when 'urgente' then 0 when 'haute' then 1 when 'normale' then 2 else 3 end,
      travel_date nulls last,
      joined_at
  ), '[]'::jsonb)
  from (select * from juge order by docs_ok desc, joined_at limit greatest(1, least(p_limit, 100))) x
$$;

comment on function slot_candidates(uuid, int) is
  'La file d''un poste, dans l''ordre où il faut appeler quand un créneau se libère. Les dossiers PRÊTS d''abord : réserver pour un dossier incomplet brûle le créneau.';

/*
 * Les créneaux qui viennent de se libérer.
 *
 * Deux sources : un rendez-vous annulé ou reporté dont l'heure est encore
 * devant nous, et une tentative où l'agent a vu un créneau sans le prendre.
 * Dans les deux cas, quelqu'un doit être appelé maintenant.
 */
create or replace function freed_slots(p_agency uuid, p_since interval default interval '48 hours')
returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by (x->>'at')::timestamptz), '[]'::jsonb)
  from (
    -- Un rendez-vous tombé : sa place est vacante.
    select jsonb_build_object(
      'source', 'rendez_vous_annule',
      'at', a.at,
      'consulate_id', c.consulate_id,
      'location', a.location,
      'freed_case', c.reference
    ) as x
    from appointments a
    join cases c on c.id = a.case_id
    where a.agency_id = p_agency
      and a.status in ('manque', 'reporte')
      and a.at > now()
      and c.consulate_id is not null

    union all

    -- Un créneau vu et non pris : il ne le restera pas longtemps.
    select jsonb_build_object(
      'source', 'creneau_vu',
      'at', s.slot_at,
      'consulate_id', s.consulate_id,
      'location', null,
      'freed_case', null
    ) as x
    from slot_attempts s
    where s.agency_id = p_agency
      and s.result = 'creneau_libre'
      and s.at > now() - p_since
      and s.slot_at is not null
      and s.slot_at > now()
  ) t
$$;

do $$
declare f text;
begin
  foreach f in array array['slot_candidates(uuid, int)', 'freed_slots(uuid, interval)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
