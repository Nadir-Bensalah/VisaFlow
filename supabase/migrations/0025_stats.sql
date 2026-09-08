-- 0025 · Les statistiques d'agence, calculées côté serveur.
--
-- L'étude l'a établi : la statistique que l'agence ne trouve nulle part
-- ailleurs, c'est son propre taux de refus par profil, et le délai réel qu'elle
-- met à obtenir un créneau. Au bout de six mois, ces chiffres rendent le
-- changement de logiciel douloureux. On les calcule ici, en une fonction, sur
-- TOUTE la donnée de l'agence, pas seulement ce que le navigateur a en mémoire.
--
-- L'argent (revenu, impayés) n'apparaît que pour qui a finance:global : un
-- agent voit les volumes, jamais les montants.

create or replace function agency_stats()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a uuid := auth_agency_id();
  money boolean := auth_can('finance:global');
  v jsonb;
begin
  if a is null or not auth_can('reports:view') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;

  select jsonb_build_object(
    -- Le pouls
    'open_cases',    (select count(*) from cases where agency_id = a and status = 'ouvert'),
    'decided_total', (select count(*) from cases where agency_id = a and status in ('accepte','refuse')),
    'acceptance',    (select coalesce(round(100.0 * count(*) filter (where status='accepte')
                       / nullif(count(*) filter (where status in ('accepte','refuse')), 0)), 0)
                       from cases where agency_id = a),
    'clients',       (select count(*) from clients where agency_id = a and deleted_at is null),
    'returning',     (select count(*) from (
                        select client_id from cases where agency_id = a group by client_id having count(*) > 1
                      ) t),

    -- Le délai réel de traitement, mesuré, contre l'annoncé
    'avg_days',      (select coalesce(round(avg(extract(epoch from (decision_at - opened_at))/86400)), 0)
                       from cases where agency_id = a and decision_at is not null),

    -- Le refus, par consulat : LA statistique, avec l'écart à la référence
    'refusal_by_consulate', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'consulate', co.country ->> 'fr', 'city', co.city,
        'decided', s.decided, 'refused', s.refused,
        'rate', round(100.0 * s.refused / nullif(s.decided,0), 1),
        'official', co.ref_refusal_rate
      ) order by s.decided desc), '[]')
      from (
        select consulate_id, count(*) filter (where status in ('accepte','refuse')) as decided,
               count(*) filter (where status = 'refuse') as refused
        from cases where agency_id = a and consulate_id is not null
        group by consulate_id
      ) s join consulates co on co.id = s.consulate_id where s.decided > 0
    ),

    -- Le refus par statut professionnel : le troisième axe
    'refusal_by_status', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'status', t.status, 'decided', t.decided, 'refused', t.refused)), '[]')
      from (
        select cl.professional_status as status,
               count(*) filter (where c.status in ('accepte','refuse')) as decided,
               count(*) filter (where c.status = 'refuse') as refused
        from cases c join clients cl on cl.id = c.client_id
        where c.agency_id = a and cl.professional_status is not null
        group by cl.professional_status
      ) t
    ),

    -- Les motifs de refus, du plus fréquent au moins : nourrit la liste de pièces
    'refusal_reasons', (
      select coalesce(jsonb_agg(jsonb_build_object('code', refusal_code, 'n', n) order by n desc), '[]')
      from (select refusal_code, count(*) n from cases
            where agency_id = a and status = 'refuse' and refusal_code is not null
            group by refusal_code) t
    ),

    -- Le créneau : délai réel d'obtention par consulat, et taux de succès des tentatives
    'wait_by_consulate', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'consulate', t.country ->> 'fr', 'city', t.city, 'real_days', t.real_days,
        'announced', t.announced, 'waiting', t.waiting)), '[]')
      from (
        select co.id, co.country, co.city, co.announced_days as announced,
               round(avg(extract(epoch from (q.served_at - q.joined_at))/86400)) as real_days,
               (select count(*) from appointment_queue w where w.consulate_id = co.id and w.status='attente') as waiting
        from appointment_queue q join consulates co on co.id = q.consulate_id
        where q.agency_id = a and q.status = 'servi' and q.served_at is not null
        group by co.id, co.country, co.city, co.announced_days
      ) t
    ),
    'attempt_success', (
      select coalesce(round(100.0 * count(*) filter (where result='creneau_pris') / nullif(count(*),0)), 0)
      from slot_attempts where agency_id = a and at > now() - interval '30 days'
    ),

    -- La conversion des demandes entrantes
    'request_conversion', (
      select coalesce(round(100.0 * count(*) filter (where status='convertie') / nullif(count(*),0)), 0)
      from client_requests where agency_id = a
    ),

    -- La biométrie encore valide : autant de déplacements évités
    'biometrics_valid', (
      select count(*) from clients
      where agency_id = a and deleted_at is null
        and biometrics_at is not null and biometrics_at + interval '59 months' > now()
    ),

    -- La pièce la plus souvent manquante
    'top_missing', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label ->> 'fr', 'n', n) order by n desc), '[]')
      from (
        select d.label, count(*) n from case_documents d
        join cases c on c.id = d.case_id
        where c.agency_id = a and c.status = 'ouvert' and d.state in ('manquante','demandee')
        group by d.label order by n desc limit 5
      ) t
    ),

    -- La charge à venir : dossiers par mois de départ
    'upcoming', (
      select coalesce(jsonb_agg(jsonb_build_object('month', m, 'n', n) order by m), '[]')
      from (
        select to_char(date_trunc('month', travel_date), 'YYYY-MM') m, count(*) n
        from cases where agency_id = a and status = 'ouvert' and travel_date >= current_date
        group by 1
      ) t
    ),

    -- Le fret
    'shipments_open',   (select count(*) from shipments where agency_id = a and status = 'en_cours'),
    'shipments_blocked',(select count(*) from shipments where agency_id = a and status = 'bloquee'),

    -- Par agent : volume et réussite
    'by_agent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', t.name, 'open', t.open, 'decided', t.decided, 'acceptance', t.acceptance
      ) order by t.total desc), '[]')
      from (
        select p.name,
               count(*) as total,
               count(*) filter (where c.status='ouvert') as open,
               count(*) filter (where c.status in ('accepte','refuse')) as decided,
               coalesce(round(100.0 * count(*) filter (where c.status='accepte')
                 / nullif(count(*) filter (where c.status in ('accepte','refuse')),0)), 0) as acceptance
        from cases c join profiles p on p.id = c.assignee_id
        where c.agency_id = a group by p.name
      ) t
    ),

    -- L'argent, direction seulement
    'money', case when money then jsonb_build_object(
      'collected_month', (select coalesce(sum(amount),0) from payments
                          where agency_id = a and state='regle' and at >= date_trunc('month', now())),
      'outstanding',     (select coalesce(sum(amount_total - amount_paid),0) from cases
                          where agency_id = a and status='ouvert'),
      'by_month', (
        select coalesce(jsonb_agg(jsonb_build_object('month', m, 'amount', amt) order by m), '[]')
        from (
          select to_char(date_trunc('month', at), 'YYYY-MM') m, sum(amount) amt
          from payments where agency_id = a and state='regle' and at > now() - interval '6 months'
          group by 1
        ) t
      ),
      'by_visa', (
        select coalesce(jsonb_agg(jsonb_build_object('label', vt.country ->> 'fr', 'amount', s.amt) order by s.amt desc), '[]')
        from (select c.visa_type_id, sum(p.amount) amt from payments p join cases c on c.id = p.case_id
              where p.agency_id = a and p.state='regle' group by c.visa_type_id) s
        join visa_types vt on vt.id = s.visa_type_id
      )
    ) else null end
  ) into v;
  return v;
end $$;

revoke all on function agency_stats() from public, anon;
grant execute on function agency_stats() to authenticated;
