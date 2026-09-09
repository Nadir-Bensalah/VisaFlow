-- Banc d'essai de l'ouverture d'une agence (migration 0065).
--
-- Ce banc garde ce qui coûte cher quand ça passe :
--   1. Deux agences au nom identique. Une fois créées, plus personne ne sait
--      laquelle appeler quand un client téléphone.
--   2. Un sous-domaine suggéré puis refusé à la création. L'admin a tout saisi,
--      il valide, et il perd son écran.
--   3. Une adresse e-mail déjà prise, découverte au 409 de la fonction de bord,
--      au dernier écran du parcours.
--   4. Un numéro de téléphone sans indicatif. Le client n'est jamais rappelé.
--   5. Une recherche de ville qui ne trouve pas « Béja » quand on tape
--      « beja ». Personne ne tape les accents dans un champ de recherche.
--   6. Une agence qui écrit dans un référentiel partagé. Un nom de ville
--      corrigé par une agence le serait pour toutes.

\set ON_ERROR_STOP on
set search_path = public;

-- BANC REJOUABLE : on efface d'abord ce qu'un passage précédent aurait laissé.
delete from agencies where slug in ('ouv-alpha', 'ouv-beta') or slug like 'banc-ouv-pu-%';
delete from platform_admins where email = 'admin@banc-ouverture.test';

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then raise notice 'OK    %', label;
  else raise exception 'ÉCHEC %', label; end if;
end $$;

create or replace function _login(p_user uuid, p_agency uuid, p_role text, p_office uuid)
returns void language plpgsql as $$
declare c jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  c := jsonb_build_object('sub', p_user, 'agency_id', coalesce(p_agency::text, ''),
                          'agency_role', p_role, 'office_id', coalesce(p_office::text, ''));
  perform set_config('request.jwt.claims', c::text, true);
end $$;

do $$
declare
  ok boolean;
  a1 uuid; o1 uuid; u_admin uuid; u_agence uuid;
  n int; d jsonb; s text[]; c text; v_id uuid;
begin
  -- ---------------------------------------------------------------
  -- Le décor : une agence existante, un admin de plateforme, un agent
  -- ---------------------------------------------------------------
  insert into agencies (slug, name) values ('ouv-alpha', 'Voyages Ben Ali') returning id into a1;
  insert into offices (agency_id, name, country, country_code)
    values (a1, 'Tunis', 'Tunisie', 'TN') returning id into o1;

  insert into auth.users (id, email) values (gen_random_uuid(), 'admin@banc-ouverture.test')
    returning id into u_admin;
  insert into platform_admins (id, name, email)
    values (u_admin, 'Banc Ouverture', 'admin@banc-ouverture.test');

  insert into auth.users (id, email) values (gen_random_uuid(), 'agent@ouv-alpha.test')
    returning id into u_agence;
  insert into profiles (id, agency_id, office_id, name, email, role)
    values (u_agence, a1, o1, 'Hatem', 'agent@ouv-alpha.test', 'agent');

  perform _login(u_admin, null, null, null);

  -- ===============================================================
  -- 1. Les pays
  -- ===============================================================
  select count(*) into n from countries;
  perform assert(n >= 195, 'la table des pays en porte au moins 195 (' || n || ')');

  select count(*) into n from countries where emoji is null;
  perform assert(n = 0, 'chaque pays porte son drapeau');

  perform assert(flag_emoji('TN') = '🇹🇳', 'le drapeau se calcule depuis le code ISO');
  perform assert(flag_emoji('XX1') is null, 'un code qui n''est pas deux lettres ne rend pas un drapeau absurde');

  select count(*) into n from countries where phone_code is not null;
  perform assert(n >= 180, 'au moins 180 indicatifs sont posés (' || n || ')');

  select phone_code into c from countries where iso2 = 'TN';
  perform assert(c = '+216', 'l''indicatif tunisien est le bon');
  select phone_code into c from countries where iso2 = 'LY';
  perform assert(c = '+218', 'l''indicatif libyen est le bon');

  -- Les pays du métier remontent, le reste suit par ordre alphabétique.
  select array_agg(iso2 order by priority, name_fr) into s
  from (select iso2, priority, name_fr from countries order by priority, name_fr limit 4) t;
  perform assert(s = array['TN','LY','DZ','MA'], 'les pays du métier remontent en tête de liste');

  -- Aucun indicatif inventé : ceux du plan nord-américain restent vides.
  select count(*) into n from countries
   where iso2 in ('JM','BB','TT','VA') and phone_code is not null;
  perform assert(n = 0, 'aucun indicatif n''est inventé là où « +1 » ne suffit pas à distinguer le pays');

  -- ===============================================================
  -- 2. Les villes
  -- ===============================================================
  select count(*) into n from cities where country_code = 'TN';
  perform assert(n >= 150, 'la Tunisie est semée complètement (' || n || ' villes)');

  select count(distinct region) into n from cities where country_code = 'TN';
  perform assert(n = 24, 'les 24 gouvernorats tunisiens sont représentés');

  select count(*) into n from cities where country_code = 'LY';
  perform assert(n >= 30, 'la Libye porte ses villes principales (' || n || ')');

  select count(distinct country_code) into n from cities;
  perform assert(n >= 190, 'chaque pays a au moins sa capitale (' || n || ')');

  -- LA RECHERCHE SANS ACCENTS. Personne ne tape « Béja » avec son accent.
  select count(*) into n from city_search('TN', 'beja', 20) where name = 'Béja';
  perform assert(n = 1, '« beja » trouve « Béja »');

  select count(*) into n from city_search('TN', 'ariana', 20) where name = 'Ariana';
  perform assert(n = 1, '« ariana » trouve « Ariana »');

  select count(*) into n from city_search('TN', 'MEDENINE', 20) where name = 'Médenine';
  perform assert(n = 1, 'la casse ne change rien : « MEDENINE » trouve « Médenine »');

  select count(*) into n from city_search('TN', 'kebili', 20) where name = 'Kébili';
  perform assert(n = 1, '« kebili » trouve « Kébili »');

  -- Le nom arabe se cherche aussi.
  select count(*) into n from city_search('TN', 'صفاقس', 20) where name = 'Sfax';
  perform assert(n = 1, 'la recherche en arabe trouve la même ligne');

  -- Le pays cloisonne la recherche : Tripoli existe en Libye ET au Liban.
  select count(*) into n from city_search('LY', 'tripoli', 20);
  perform assert(n = 1, 'la recherche de ville reste dans le pays demandé');

  -- Le chef-lieu sort en tête de son gouvernorat, pas en ordre alphabétique.
  select name into c from city_search('TN', 'sfax', 20) limit 1;
  perform assert(c = 'Sfax', 'le chef-lieu sort en tête, pas au milieu de ses délégations');

  -- ===============================================================
  -- 3. Le nom de l'agence
  -- ===============================================================
  d := agency_name_check('Voyages Ben Ali');
  perform assert((d->>'ok')::boolean = false, 'un nom identique est refusé');
  perform assert(d->>'raison' = 'nom_pris', 'et la raison le dit');

  -- Même nom, autre casse, autres accents, autre ponctuation : c'est le même.
  d := agency_name_check('  VOYAGES  BEN-ALI  ');
  perform assert((d->>'ok')::boolean = false, 'la casse, les tirets et les espaces ne créent pas un nom neuf');

  -- LE CAS QUI COMPTE : deux frères, deux registres, deux noms presque égaux.
  -- On accepte, mais on montre.
  d := agency_name_check('Voyage Ben Ali');
  perform assert((d->>'ok')::boolean = true, 'un nom très proche reste acceptable');
  perform assert(jsonb_array_length(d->'proches') >= 1, 'mais il est signalé : l''admin voit le voisin avant de valider');
  perform assert(d->'proches'->0->>'slug' = 'ouv-alpha', 'et il voit lequel');

  d := agency_name_check('Transit Sahara Fret');
  perform assert((d->>'ok')::boolean = true, 'un nom sans voisin passe');
  perform assert(jsonb_array_length(d->'proches') = 0, 'et ne signale personne');

  d := agency_name_check('ab');
  perform assert((d->>'ok')::boolean = false and d->>'raison' = 'trop_court', 'deux caractères ne font pas un nom');
  d := agency_name_check(repeat('a', 81));
  perform assert((d->>'ok')::boolean = false and d->>'raison' = 'trop_long', 'quatre-vingt-un caractères non plus');
  d := agency_name_check('12345');
  perform assert((d->>'ok')::boolean = false and d->>'raison' = 'sans_lettre', 'un nom sans aucune lettre est refusé');
  d := agency_name_check('---...---');
  perform assert((d->>'ok')::boolean = false and d->>'raison' = 'sans_lettre', 'de la ponctuation seule non plus');
  d := agency_name_check('شركة النور للسفريات');
  perform assert((d->>'ok')::boolean = true, 'un nom entièrement en arabe est un vrai nom');

  -- ===============================================================
  -- 4. Le sous-domaine
  -- ===============================================================
  -- LA GARANTIE : tout ce qui est proposé est réellement libre.
  s := slug_suggestions('Voyages Ben Ali', 6);
  perform assert(array_length(s, 1) >= 3, 'le nom produit plusieurs suggestions (' || coalesce(array_length(s,1),0) || ')');
  n := 0;
  foreach c in array s loop
    if not slug_available(c) then n := n + 1; end if;
  end loop;
  perform assert(n = 0, 'toutes les suggestions de sous-domaine sont réellement disponibles');

  -- Le slug de l'agence existante ne doit JAMAIS être proposé.
  perform assert(not ('ouv-alpha' = any (slug_suggestions('Ouv Alpha', 10))), 'un slug déjà pris n''est jamais proposé');

  -- Ni un mot réservé.
  perform assert(not ('admin' = any (slug_suggestions('Admin', 10))), 'un mot réservé n''est jamais proposé');

  perform assert(slugifier('Société Tunisienne de Voyages & Fret') = 'societe-tunisienne-de-voyages',
                 'le slug se dérive du nom, coupé à trente caractères et retaillé');
  perform assert(right(slugifier(repeat('ab-', 20)), 1) <> '-', 'un slug ne finit jamais par un tiret');

  d := slug_check('www');
  perform assert((d->>'ok')::boolean = false and d->>'raison' = 'reserve', 'un mot réservé est refusé');
  d := slug_check('visaflow');
  perform assert((d->>'ok')::boolean = false and d->>'raison' = 'reserve', 'le nom de la plateforme est réservé');
  d := slug_check('ouv-alpha');
  perform assert((d->>'ok')::boolean = false and d->>'raison' = 'pris', 'un sous-domaine déjà pris est refusé');
  perform assert(jsonb_array_length(d->'suggestions') >= 1, 'et une solution de repli est proposée');
  d := slug_check('-mauvais-');
  perform assert((d->>'ok')::boolean = false and d->>'raison' = 'forme', 'un sous-domaine qui commence par un tiret est refusé');
  d := slug_check('Majuscules');
  perform assert((d->>'ok')::boolean = false and d->>'raison' = 'forme', 'les majuscules ne passent pas dans un sous-domaine');
  d := slug_check('sahara-transit');
  perform assert((d->>'ok')::boolean = true, 'un sous-domaine libre et bien formé passe');

  -- ===============================================================
  -- 5. L'adresse e-mail
  -- ===============================================================
  -- LE POINT DE CE BANC : on l'apprend AVANT la création, pas au 409 final.
  d := email_check('agent@ouv-alpha.test');
  perform assert((d->>'ok')::boolean = false, 'une adresse déjà utilisée est refusée');
  perform assert((d->>'deja_utilise')::boolean = true, 'et signalée AVANT la création, pas au 409 de la fonction de bord');

  d := email_check('AGENT@OUV-ALPHA.TEST');
  perform assert((d->>'deja_utilise')::boolean = true, 'la casse ne fait pas passer une adresse déjà prise');

  d := email_check('nouveau@sahara.tn');
  perform assert((d->>'ok')::boolean = true and (d->>'deja_utilise')::boolean = false, 'une adresse neuve passe');

  d := email_check('pas-une-adresse');
  perform assert((d->>'ok')::boolean = false and d->>'raison' = 'forme', 'une adresse sans arobase est refusée');
  d := email_check('a@b');
  perform assert((d->>'ok')::boolean = false and d->>'raison' = 'forme', 'une adresse sans domaine complet est refusée');

  -- ===============================================================
  -- 6. Le téléphone
  -- ===============================================================
  d := phone_check('20 123 456', 'TN');
  perform assert((d->>'ok')::boolean = true, 'un numéro tunisien local passe');
  perform assert(d->>'normalise' = '+21620123456', 'et il ressort avec le bon indicatif');

  d := phone_check('91 234 5678', 'LY');
  perform assert(d->>'normalise' = '+218912345678', 'un numéro libyen prend l''indicatif libyen');

  d := phone_check('06 12 34 56 78', 'FR');
  perform assert(d->>'normalise' = '+33612345678', 'le zéro de préfixe national saute au passage à l''international');

  d := phone_check('+216 20 123 456', 'FR');
  perform assert(d->>'normalise' = '+21620123456', 'un numéro déjà international garde son indicatif, même si le pays choisi diffère');

  d := phone_check('0021620123456', 'TN');
  perform assert(d->>'normalise' = '+21620123456', 'la vieille écriture « 00 » est reconnue');

  d := phone_check('123', 'TN');
  perform assert((d->>'ok')::boolean = false and d->>'raison' = 'trop_court', 'un numéro trop court est refusé');
  d := phone_check('1234567890123456789', 'TN');
  perform assert((d->>'ok')::boolean = false and d->>'raison' = 'trop_long', 'un numéro hors borne E.164 est refusé');
  d := phone_check('20123456', 'JM');
  perform assert((d->>'ok')::boolean = false and d->>'raison' = 'indicatif_inconnu',
                 'un pays sans indicatif connu le dit, il n''en invente pas un');

  -- ===============================================================
  -- 7. L'adresse manquante existe maintenant
  -- ===============================================================
  select id into v_id from cities where country_code = 'TN' and name = 'Sfax';
  update offices set city_id = v_id, postal_code = '3000' where id = o1;
  select count(*) into n from offices where id = o1 and city_id = v_id and postal_code = '3000';
  perform assert(n = 1, 'un bureau porte enfin son code postal et sa ville du référentiel');

  update agencies set address = '12 rue de Marseille', city = 'Tunis',
                      postal_code = '1000', country_code = 'TN' where id = a1;
  select count(*) into n from agencies where id = a1 and country_code = 'TN' and postal_code = '1000';
  perform assert(n = 1, 'une agence porte enfin l''adresse de son siège');

  -- ===============================================================
  -- 8. Les référentiels ne s'écrivent pas depuis une agence
  -- ===============================================================
  perform _login(u_agence, a1, 'agent', o1);
  set local role authenticated;
  begin
    insert into cities (country_code, name) values ('TN', 'Ville Inventée Par Une Agence');
    reset role;
    perform assert(false, 'un compte d''agence n''écrit pas dans le référentiel des villes');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'un compte d''agence n''écrit pas dans le référentiel des villes');
  end;

  set local role authenticated;
  begin
    update cities set name = 'Sfaxe' where country_code = 'TN' and name = 'Sfax';
    if found then
      reset role;
      perform assert(false, 'un compte d''agence ne renomme pas une ville pour tout le monde');
    end if;
    reset role;
    perform assert(true, 'un compte d''agence ne renomme pas une ville pour tout le monde');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'un compte d''agence ne renomme pas une ville pour tout le monde');
  end;

  set local role authenticated;
  begin
    update countries set phone_code = '+999' where iso2 = 'TN';
    if found then
      reset role;
      perform assert(false, 'un compte d''agence ne corrige pas un indicatif pour tout le monde');
    end if;
    reset role;
    perform assert(true, 'un compte d''agence ne corrige pas un indicatif pour tout le monde');
  exception when insufficient_privilege then
    reset role;
    perform assert(true, 'un compte d''agence ne corrige pas un indicatif pour tout le monde');
  end;

  -- Le piège de la 0015 : DELETE arrive tout seul sur une table neuve.
  perform assert(not has_table_privilege('authenticated', 'cities', 'delete'),
                 'le DELETE hérité de la 0015 a bien été repris sur les villes');
  perform assert(has_table_privilege('authenticated', 'cities', 'select'),
                 'mais toute agence lit le référentiel des villes');

  -- Une agence LIT bien, elle ne fait que lire.
  select count(*) into n from cities where country_code = 'TN';
  perform assert(n >= 150, 'et elle le lit vraiment, sous ses propres politiques');

  -- ===============================================================
  -- 9. Rien de tout cela n'est ouvert à l'anonyme
  -- ===============================================================
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into n
  from (values ('agency_name_check(text)'), ('slug_check(text)'),
               ('email_check(text)'), ('phone_check(text, text)'),
               ('slug_suggestions(text, int, text)'),
               ('city_search(text, text, int)')) as v(f)
  where has_function_privilege('anon', v.f, 'execute');
  perform assert(n = 0, 'aucune garde de l''ouverture n''est appelable sans compte (' || n || ' de trop)');

  select count(*) into n
  from (values ('agency_name_check(text)'), ('slug_check(text)'),
               ('email_check(text)'), ('phone_check(text, text)'),
               ('slug_suggestions(text, int, text)'),
               ('city_search(text, text, int)')) as v(f)
  where has_function_privilege('authenticated', v.f, 'execute');
  perform assert(n = 6, 'mais toutes le sont par un compte connecté');

  -- Le search_path figé sur ce qui est SECURITY DEFINER, comme l'exige droits.sql.
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.prosecdef
    and p.proname in ('agency_name_check','slug_check','slug_suggestions','email_check')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c2 where c2 like 'search_path=%');
  perform assert(n = 0, 'les fonctions SECURITY DEFINER de l''ouverture ont leur search_path figé');


  -- 0071 : la méthode de l'assistant d'ouverture est acceptée par la contrainte.
  -- On teste la contrainte elle-même, en superutilisateur : c'est elle qui
  -- refusait en production, pas la fonction.
  begin
    insert into agencies (slug, name, country, commission_kind, commission_amount)
    values ('banc-ouv-pu-' || substr(md5(random()::text), 1, 6), 'Banc Ouverture PU', 'Tunisie', 'par_utilisateur', 45);
    ok := true;
  exception when others then ok := false; raise notice 'ouverture par_utilisateur refusée : %', sqlerrm;
  end;
  perform assert(ok, 'une agence s''ouvre en méthode « par utilisateur » (0071)');
  delete from agencies where slug like 'banc-ouv-pu-%';
  -- Ménage.
  delete from agencies where id = a1;
  delete from platform_admins where id = u_admin;
  delete from auth.users where id in (u_admin, u_agence);
  raise notice '--- banc de l''ouverture : tout est vert ---';
end $$;

drop function _login(uuid, uuid, text, uuid);
