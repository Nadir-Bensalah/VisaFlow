-- 0035 · La vitrine publique de l'agence.
--
-- Trouvé en essayant de déposer une vraie demande depuis le formulaire public :
-- la base a répondu `invalid input syntax for type uuid: "vt_cn_aff"`. Le
-- formulaire envoyait l'identifiant d'un type de visa de DÉMONSTRATION, parce
-- que les pages publiques lisent le magasin local du navigateur, comme le
-- suivi de dossier le faisait.
--
-- Une page publique n'a pas de session : elle ne peut rien lire par RLS. Il lui
-- faut donc une porte, et une seule, qui rende exactement ce qu'une agence
-- accepte de mettre sur sa devanture : son nom, ses couleurs, ses langues, et
-- la liste des visas qu'elle traite. Rien d'autre. Pas ses bureaux, pas son
-- équipe, pas ses tarifs internes.

create or replace function portal_agency(p_slug text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare a agencies; result jsonb;
begin
  if not rate_allow('portal_agency', coalesce(p_slug, 'nul'), 300, interval '1 hour') then
    raise exception 'trop de tentatives' using errcode = 'P0001';
  end if;

  select * into a from agencies where slug = p_slug;
  -- Une agence suspendue n'a plus de devanture : ses clients ne doivent pas
  -- pouvoir déposer une demande qu'elle ne traitera jamais. (auth_agency_active
  -- juge l'agence de la SESSION courante ; ici il n'y en a pas, on lit la
  -- colonne directement.)
  if a.id is null or a.suspended_at is not null then return null; end if;

  select jsonb_build_object(
    'slug', a.slug,
    'name', a.name,
    'mark', a.mark,
    'accent', a.accent,
    'services', to_jsonb(a.services),
    'locales', to_jsonb(a.locales),
    'default_locale', a.default_locale,
    'email', a.email,
    -- Les mentions légales de bas de page. La référence de déclaration INPDP
    -- doit être affichée : ce n'est pas décoratif, c'est une obligation.
    'legal_name', a.legal_name,
    'inpdp_ref', a.inpdp_ref,
    -- Les visas proposés, avec le délai annoncé et le tarif public. Ce sont
    -- les trois choses qu'un client demande avant tout.
    'visa_types', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'country_code', v.country_code, 'country', v.country,
        'label', v.label, 'category', v.category,
        'processing_days', v.processing_days,
        'fee_agency', v.fee_agency, 'fee_consulate', v.fee_consulate,
        'currency', v.currency
      ) order by v.country ->> 'fr', v.label ->> 'fr'), '[]')
      from visa_types v where v.agency_id = a.id and v.active
    ),
    -- Un bureau pour appeler, pas la liste des bureaux : le client n'a pas à
    -- deviner lequel le suit.
    'office', (
      select jsonb_build_object('name', o.name, 'city', o.city, 'address', o.address, 'phone', o.phone)
      from offices o where o.agency_id = a.id and o.active
      order by o.created_at limit 1
    )
  ) into result;

  return result;
end $$;

revoke all on function portal_agency(text) from public;
grant execute on function portal_agency(text) to anon, authenticated;

comment on function portal_agency(text) is
  'La devanture publique d''une agence, pour les pages sans session : nom, couleurs, langues, visas proposés et un bureau à appeler. Une agence suspendue ne rend rien.';
