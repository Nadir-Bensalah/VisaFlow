-- 0042 · Comment une agence souscrit au service.
--
-- Il manquait tout le tunnel. `provision_agency` existe, mais elle exige déjà
-- un compte Supabase ouvert : elle sert à finir une installation, pas à la
-- commencer. Et la page d'inscription ne l'appelait même pas. Une agence qui
-- découvrait VisaFlow n'avait donc aucun moyen de dire « je suis intéressée ».
--
-- POURQUOI CE N'EST PAS UNE INSCRIPTION EN LIBRE-SERVICE, et c'est important :
--
--   · L'abonnement se facture à l'année, au format TTN. On ne prélève pas.
--   · Il n'existe pas de paiement récurrent par carte en Tunisie, et Stripe ne
--     couvre pas le pays. Personne ne peut donc « payer et entrer » tout seul.
--   · La grille doit être par unité d'œuvre (45 DT par utilisateur et par mois),
--     jamais un forfait sec : l'article 3 de la circulaire BCT 2016-09 fait
--     refuser le transfert d'un forfait sans unité quantifiable. Le prix se
--     discute donc, il ne se clique pas.
--
-- Le tunnel juste est donc : l'agence DEMANDE, on qualifie, on crée, on facture.
-- Ce fichier fabrique la demande et sa conversion en agence.

create table if not exists agency_signups (
  id            uuid primary key default gen_random_uuid(),
  -- L'agence telle qu'elle se présente.
  agency_name   text not null,
  country       text not null default 'Tunisie',
  city          text,
  services      text[] not null default '{visas}',
  -- Qui écrit, et comment le rappeler. Le téléphone d'abord : c'est par là
  -- qu'une agence tunisienne se joint, pas par courriel.
  contact_name  text not null,
  phone         text not null,
  email         text,
  -- De quoi chiffrer une proposition sans avoir à rappeler pour ça.
  team_size     int  check (team_size is null or team_size > 0),
  monthly_cases int  check (monthly_cases is null or monthly_cases >= 0),
  current_tool  text,
  note          text,
  locale        text not null default 'fr',
  -- Le parcours commercial, du premier contact à l'agence créée.
  status        text not null default 'nouvelle'
                check (status in ('nouvelle','contactee','devis_envoye','convertie','ecartee')),
  -- Ce qu'on a proposé, pour ne pas le rechercher dans ses messages.
  quoted_users  int,
  quoted_amount numeric(12,2),
  quoted_currency char(3) default 'TND',
  refusal_reason text,
  -- L'agence née de cette demande, une fois convertie.
  agency_id     uuid references agencies on delete set null,
  received_at   timestamptz not null default now(),
  handled_at    timestamptz,
  handled_by    uuid references auth.users on delete set null
);
create index if not exists agency_signups_state on agency_signups (status, received_at desc);

comment on table agency_signups is
  'Les demandes de souscription des agences. Ce n''est pas une inscription en libre-service : l''abonnement se facture à l''année au format TTN, il n''existe pas de prélèvement par carte en Tunisie, et la grille doit être par unité d''œuvre. Le prix se discute, il ne se clique pas.';

alter table agency_signups enable row level security;
alter table agency_signups force row level security;

-- Personne ne LIT ces demandes sauf la plateforme : elles contiennent les
-- coordonnées et le volume d'affaires de concurrents directs.
drop policy if exists agency_signups_select on agency_signups;
create policy agency_signups_select on agency_signups for select to authenticated
  using (is_platform_admin());
drop policy if exists agency_signups_update on agency_signups;
create policy agency_signups_update on agency_signups for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());

revoke all on agency_signups from anon, authenticated;
grant select, update on agency_signups to authenticated;
grant all on agency_signups to service_role;

/*
 * Déposer une demande, sans compte et sans session.
 *
 * L'écriture passe par cette fonction et par elle seule : la table n'est pas
 * ouverte à l'anonyme. Un formulaire public sans limite de débit se fait
 * remplir de faux par un script en une nuit.
 */
create or replace function request_agency_signup(
  p_agency_name text, p_contact_name text, p_phone text,
  p_email text default null, p_country text default 'Tunisie', p_city text default null,
  p_services text[] default '{visas}', p_team_size int default null,
  p_monthly_cases int default null, p_current_tool text default null,
  p_note text default null, p_locale text default 'fr'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not rate_allow('agency_signup', coalesce(p_phone, 'nul'), 5, interval '24 hours') then
    raise exception 'trop de demandes' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_agency_name), '') = '' or coalesce(trim(p_phone), '') = '' then
    raise exception 'nom et téléphone obligatoires' using errcode = 'P0001';
  end if;

  insert into agency_signups (
    agency_name, contact_name, phone, email, country, city, services,
    team_size, monthly_cases, current_tool, note, locale
  ) values (
    trim(p_agency_name), trim(coalesce(p_contact_name, '')), trim(p_phone),
    nullif(trim(coalesce(p_email, '')), ''), p_country, nullif(trim(coalesce(p_city, '')), ''),
    coalesce(p_services, '{visas}'), p_team_size, p_monthly_cases,
    nullif(trim(coalesce(p_current_tool, '')), ''), nullif(trim(coalesce(p_note, '')), ''),
    coalesce(p_locale, 'fr')
  ) returning id into v_id;

  -- On ne rend RIEN de la ligne créée : un formulaire public ne doit pas
  -- servir à deviner combien d'agences ont souscrit.
  return jsonb_build_object('ok', true);
end $$;

revoke all on function request_agency_signup(text, text, text, text, text, text, text[], int, int, text, text, text) from public;
grant execute on function request_agency_signup(text, text, text, text, text, text, text[], int, int, text, text, text) to anon, authenticated;

/*
 * La liste des demandes, pour la console plateforme.
 * Le tarif indicatif est calculé, pas inventé : 45 DT par utilisateur et par
 * mois, l'unité d'œuvre exigée par la circulaire BCT 2016-09.
 */
create or replace function platform_signups(p_status text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'agency_name', s.agency_name, 'country', s.country, 'city', s.city,
      'services', to_jsonb(s.services),
      'contact_name', s.contact_name, 'phone', s.phone, 'email', s.email,
      'team_size', s.team_size, 'monthly_cases', s.monthly_cases,
      'current_tool', s.current_tool, 'note', s.note, 'locale', s.locale,
      'status', s.status, 'received_at', s.received_at,
      'quoted_users', s.quoted_users, 'quoted_amount', s.quoted_amount,
      'quoted_currency', s.quoted_currency,
      'refusal_reason', s.refusal_reason,
      'agency_id', s.agency_id,
      'agency_slug', (select a.slug from agencies a where a.id = s.agency_id),
      -- 45 DT par utilisateur et par mois, sur douze mois.
      'suggested_year', case when s.team_size is not null then s.team_size * 45 * 12 end
    ) order by s.received_at desc), '[]'::jsonb)
    from agency_signups s
    where p_status is null or s.status = p_status
  );
end $$;

revoke all on function platform_signups(text) from public, anon;
grant execute on function platform_signups(text) to authenticated;

/* Avancer une demande dans le parcours, et garder ce qu'on a proposé. */
create or replace function platform_signup_update(
  p_signup uuid, p_status text,
  p_quoted_users int default null, p_quoted_amount numeric default null,
  p_refusal_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;
  update agency_signups
     set status = p_status,
         quoted_users = coalesce(p_quoted_users, quoted_users),
         quoted_amount = coalesce(p_quoted_amount, quoted_amount),
         refusal_reason = case when p_status = 'ecartee' then p_refusal_reason else refusal_reason end,
         handled_at = now(),
         handled_by = auth.uid()
   where id = p_signup;
end $$;

revoke all on function platform_signup_update(uuid, text, int, numeric, text) from public, anon;
grant execute on function platform_signup_update(uuid, text, int, numeric, text) to authenticated;

/*
 * Convertir une demande en agence, d'un geste.
 *
 * On réutilise `platform_create_agency` plutôt que de dupliquer sa logique :
 * elle vérifie le rôle, le slug, et sème le catalogue de démarrage. La demande
 * garde le lien vers l'agence née d'elle, pour qu'on sache d'où vient chaque
 * client six mois plus tard.
 */
create or replace function platform_convert_signup(
  p_signup uuid, p_slug text,
  p_commission_kind text default 'par_dossier',
  p_commission_amount numeric default 8
) returns uuid
language plpgsql security definer set search_path = public as $$
declare s agency_signups; v_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'réservé à la plateforme' using errcode = '42501';
  end if;

  select * into s from agency_signups where id = p_signup;
  if s.id is null then raise exception 'demande introuvable' using errcode = 'P0002'; end if;
  if s.agency_id is not null then
    raise exception 'demande déjà convertie' using errcode = 'P0001';
  end if;

  v_id := platform_create_agency(s.agency_name, p_slug, s.country, p_commission_kind, p_commission_amount);

  -- Les services demandés, s'ils diffèrent du démarrage par défaut.
  update agencies set services = s.services where id = v_id and s.services is not null;

  update agency_signups
     set status = 'convertie', agency_id = v_id, handled_at = now(), handled_by = auth.uid()
   where id = p_signup;

  return v_id;
end $$;

revoke all on function platform_convert_signup(uuid, text, text, numeric) from public, anon;
grant execute on function platform_convert_signup(uuid, text, text, numeric) to authenticated;
