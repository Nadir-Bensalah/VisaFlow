-- 0063 · Le mode d'organisation du travail : portefeuille, file, ou les deux.
--
-- LE BESOIN, DIT PAR LE TERRAIN.
--
-- Il y a deux façons de tenir une agence, et elles ne se ressemblent pas.
--
-- En PORTEFEUILLE, chaque conseiller a ses clients. Ahmed suit madame Ben Ali
-- du premier appel au passeport rendu : il monte le dossier, réclame les
-- pièces, encaisse, prend le rendez-vous, rend le passeport. Sa question du
-- matin est « où en sont MES dossiers ».
--
-- En FILE, le dossier passe de main en main. Une personne vérifie TOUTES les
-- pièces de TOUS les dossiers, une autre encaisse TOUT, une troisième travaille
-- la file de rendez-vous. Sa question du matin est « qu'est-ce qui attend MON
-- geste aujourd'hui », sur tous les dossiers de son bureau.
--
-- Le cas réel le plus fréquent est le mélange : trois conseillers en
-- portefeuille, plus un vérificateur de documents et un caissier en file.
--
-- L'IDÉE DIRECTRICE : LE MODE NE SE RÈGLE PAS DEUX FOIS.
--
-- L'agence choisit sa façon de travailler par défaut, et CHAQUE POSTE PORTE SON
-- STYLE : un conseiller est en portefeuille, un vérificateur est en file. Le
-- mélange en découle tout seul, sans un seul réglage de plus par personne. Le
-- patron ne coche jamais deux cases pour dire une seule chose.
--
-- CE QUE LE MODE NE FAIT PAS, ET IL FAUT L'ÉCRIRE.
--
-- Le mode d'agence ne restreint RIEN. Il ne donne aucun droit, il n'en retire
-- aucun, aucune politique de sécurité ne le lit. Il fait deux choses, deux
-- seulement :
--   · il décide des POSTES PROPOSÉS EN PREMIER dans l'écran d'équipe ;
--   · il décide de la DISPOSITION PAR DÉFAUT de l'écran d'accueil et des
--     listes.
-- Un réglage d'affichage qui se mettrait à filtrer des lignes serait un droit
-- déguisé : le jour où quelqu'un le bascule pour changer une mise en page, il
-- ouvrirait ou fermerait des portes sans le savoir. Le banc le vérifie.
--
-- CE QU'ON NE STOCKE PAS, ET POURQUOI.
--
-- Une personne n'a PAS de colonne `work_style`. Son style se déduit de son
-- poste. Deux sources pour la même information finissent toujours par diverger :
-- on changerait le poste d'Amira de conseillère à vérificatrice, sa colonne
-- resterait à « portefeuille », et son écran d'accueil mentirait sans que rien
-- ne le signale. Le poste est déjà la bonne source, et il est déjà celui qu'on
-- change quand le travail de quelqu'un change.

-- ------------------------------------------------------------------
-- 1 · Le mode de l'agence
-- ------------------------------------------------------------------
--
-- `add column if not exists` porte sa contrainte : quand la colonne est déjà
-- là, PostgreSQL saute la clause entière, contrainte comprise. Le fichier se
-- rejoue donc sans jamais tenter d'ajouter deux fois la même vérification.

alter table agencies add column if not exists work_mode text not null
  default 'portefeuille'
  check (work_mode in ('portefeuille','file','mixte'));

comment on column agencies.work_mode is
  'La façon de travailler par défaut de l''agence. Elle ne restreint rien : elle décide des postes proposés en premier et de la disposition par défaut des écrans. Aucune politique de sécurité ne la lit.';

-- ------------------------------------------------------------------
-- 2 · Le style d'un poste
-- ------------------------------------------------------------------
--
-- `work_style` dit comment ce poste regarde le travail. `focus` dit de quels
-- gestes il s'occupe quand il est en file : le vérificateur de documents ne
-- veut pas voir les encaissements, et le caissier ne veut pas voir les pièces.
--
-- Le vocabulaire des gestes est CLOS. Dix valeurs, pas une de plus, et la base
-- refuse le reste. Un geste inventé par une agence ne serait compté nulle part :
-- il s'afficherait comme une ligne vide, et personne ne saurait pourquoi.

alter table job_templates add column if not exists work_style text not null
  default 'portefeuille'
  check (work_style in ('portefeuille','file'));

alter table job_templates add column if not exists focus text[] not null
  default '{}'::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'job_templates'::regclass and conname = 'job_templates_focus_clos'
  ) then
    alter table job_templates add constraint job_templates_focus_clos
      check (focus <@ array[
        'pieces','encaissement','creneaux','passeports','messages',
        'douane','livraisons','traductions','prospects','factures'
      ]::text[]);
  end if;
end $$;

comment on column job_templates.work_style is
  'Portefeuille : ce poste suit ses propres dossiers. File : ce poste travaille un geste sur tous les dossiers de son bureau.';
comment on column job_templates.focus is
  'Les gestes dont ce poste s''occupe quand il est en file. Vocabulaire clos de dix valeurs. Vide en portefeuille : un conseiller fait tout sur ses dossiers.';

-- Le style des neuf postes livrés avec le produit. On MET À JOUR, on ne
-- réinsère pas : la 0062 les a posés, et un deuxième insert casserait les
-- postes qu'une agence a déjà appliqués.

update job_templates set work_style = 'portefeuille', focus = '{}'
 where agency_id is null and code in ('proprietaire','gestionnaire','conseiller','lecture');

update job_templates set work_style = 'file', focus = '{pieces}'
 where agency_id is null and code = 'verification_pieces';

update job_templates set work_style = 'file', focus = '{encaissement,factures}'
 where agency_id is null and code = 'caisse';

update job_templates set work_style = 'file', focus = '{creneaux,passeports}'
 where agency_id is null and code = 'creneaux';

update job_templates set work_style = 'file', focus = '{factures,encaissement}'
 where agency_id is null and code = 'comptabilite';

update job_templates set work_style = 'file', focus = '{passeports}'
 where agency_id is null and code = 'coursier';

-- ------------------------------------------------------------------
-- 3 · Le vocabulaire, en une seule table de vérité
-- ------------------------------------------------------------------
--
-- Trois petites fonctions pures. Elles ne lisent rien, donc le planificateur
-- les aplatit, et surtout elles écrivent UNE fois ce qui devrait sinon se
-- recopier dans chaque branche : la liste des gestes, leur clé de traduction,
-- et la correspondance avec les compteurs du tableau de bord.

-- L'ordre d'affichage. Il est fixe : un écran dont les lignes changent de place
-- d'un jour à l'autre se relit à chaque fois au lieu de se survoler.
create or replace function trv_gestes() returns text[]
language sql immutable parallel safe as $$
  select array[
    'pieces','encaissement','factures','creneaux','passeports',
    'messages','traductions','douane','livraisons','prospects','taches'
  ]::text[]
$$;

comment on function trv_gestes() is
  'Les gestes dans leur ordre d''affichage. Onze : les dix du focus, plus « taches » qui n''appartient à aucun poste parce qu''une tâche est nominative.';

create or replace function trv_label_key(p_geste text) returns text
language sql immutable parallel safe as $$
  select case p_geste
    when 'pieces'       then 'trv.gestePieces'
    when 'encaissement' then 'trv.gesteEncaissement'
    when 'factures'     then 'trv.gesteFactures'
    when 'creneaux'     then 'trv.gesteCreneaux'
    when 'passeports'   then 'trv.gestePasseports'
    when 'messages'     then 'trv.gesteMessages'
    when 'traductions'  then 'trv.gesteTraductions'
    when 'douane'       then 'trv.gesteDouane'
    when 'livraisons'   then 'trv.gesteLivraisons'
    when 'prospects'    then 'trv.gesteProspects'
    when 'taches'       then 'trv.gesteTaches'
    else 'trv.gesteAutre'
  end
$$;

-- Les compteurs de `dashboard_today` qui portent chaque geste. C'est la pièce
-- qui évite le deuxième comptage : en file, on ne recompte rien, on regroupe ce
-- que la 0055 a déjà compté.
--
-- Deux compteurs de `dashboard_today` n'apparaissent dans aucun geste, et c'est
-- voulu : `staleCases` et `decisionsUntreated` sont le travail du responsable du
-- dossier, pas le geste d'un poste en file. Ils restent sur l'écran d'accueil
-- de qui suit le dossier.
create or replace function trv_dashboard_keys(p_geste text) returns text[]
language sql immutable parallel safe as $$
  select case p_geste
    when 'pieces'       then array['docsMissing']
    when 'encaissement' then array['paymentsDue','caseBalances','passportsUnpaid']
    when 'factures'     then array['invoicesOverdue']
    when 'creneaux'     then array['apptsToday','apptsTomorrow']
    when 'passeports'   then array['passportsReady','passportsHeld']
    when 'messages'     then array['clientsToCall']
    when 'douane'       then array['inCustoms','containersOut','demurrageRisk']
    when 'livraisons'   then array['deliveriesToday','arrivalsToday','arrivalsWeek']
    when 'taches'       then array['tasksOverdue','tasksToday']
    -- Traductions et prospects : `dashboard_today` ne les compte pas. On les
    -- ajoute plus bas, on ne les duplique pas.
    else '{}'::text[]
  end
$$;

-- La couleur d'un groupe est la plus forte de ses compteurs. Un groupe qui
-- contient un retard rouge et trois lignes grises est rouge : c'est le rouge
-- qu'on doit voir.
create or replace function trv_tone_rank(p_tone text) returns int
language sql immutable parallel safe as $$
  select case p_tone
    when 'red' then 4 when 'orange' then 3 when 'blue' then 2
    when 'green' then 1 else 0 end
$$;

create or replace function trv_tone_of(p_rank int) returns text
language sql immutable parallel safe as $$
  select case p_rank
    when 4 then 'red' when 3 then 'orange' when 2 then 'blue'
    when 1 then 'green' else 'gray' end
$$;

-- Une entrée à zéro n'entre pas dans la liste. Même règle que `pil_item` en
-- 0055, et pour la même raison : onze lignes dont neuf à zéro font un écran
-- qu'on cesse de lire.
create or replace function trv_group(
  p_groupes jsonb, p_geste text, p_count bigint, p_tone text, p_url text
) returns jsonb
language sql immutable parallel safe as $$
  select case when coalesce(p_count, 0) = 0 then p_groupes
    else p_groupes || jsonb_build_object(
      'geste', p_geste,
      'cle_libelle', trv_label_key(p_geste),
      'compte', p_count,
      'url', p_url,
      'urgence', coalesce(p_tone, 'gray'))
  end
$$;

revoke all on function trv_gestes() from public, anon;
revoke all on function trv_label_key(text) from public, anon;
revoke all on function trv_dashboard_keys(text) from public, anon;
revoke all on function trv_tone_rank(text) from public, anon;
revoke all on function trv_tone_of(int) from public, anon;
revoke all on function trv_group(jsonb, text, bigint, text, text) from public, anon;
grant execute on function trv_gestes() to authenticated;
grant execute on function trv_label_key(text) to authenticated;
grant execute on function trv_dashboard_keys(text) to authenticated;
grant execute on function trv_tone_rank(text) to authenticated;
grant execute on function trv_tone_of(int) to authenticated;
grant execute on function trv_group(jsonb, text, bigint, text, text) to authenticated;

-- ------------------------------------------------------------------
-- 4 · Le style déduit d'une personne
-- ------------------------------------------------------------------
--
-- POURQUOI LE STYLE NE SE STOCKE PAS SUR LA PERSONNE. C'est le point à retenir
-- de tout ce fichier.
--
-- Une colonne `profiles.work_style` serait plus rapide à lire, et elle mentirait
-- au premier changement de poste. Le jour où Amira passe de conseillère à
-- vérificatrice, `apply_job_template` change son rôle et ses écarts ; personne
-- ne penserait à changer aussi sa colonne, et son écran d'accueil continuerait
-- à lui montrer « mes dossiers » alors qu'elle ne suit plus aucun dossier.
-- Deux sources pour la même information divergent toujours, et c'est celle qu'on
-- n'a pas mise à jour qui s'affiche. Le poste est déjà la bonne source : il est
-- déjà ce qu'on change quand le travail de quelqu'un change.
--
-- COMMENT ON RETROUVE LE POSTE. Exactement comme l'écran d'équipe le fait déjà
-- (voir `jobOf` dans web/src/data/equipe.ts) : la 0062 a décidé qu'appliquer un
-- modèle recopie son contenu sans garder de lien. On compare donc les écarts
-- au rôle de la personne à ceux de chaque modèle. Quand plus rien ne
-- correspond, la personne n'a pas de poste, et son style retombe sur le mode de
-- l'agence.

-- Le style que donne un mode d'agence à quelqu'un qui n'a pas de poste. Le
-- mélange n'est pas un style : c'est le fait que des postes différents
-- cohabitent. Quelqu'un sans poste, dans une agence mixte, tombe donc sur le
-- portefeuille, qui est le comportement d'origine du produit.
create or replace function trv_style_from_mode(p_mode text) returns text
language sql immutable parallel safe as $$
  select case p_mode when 'file' then 'file' else 'portefeuille' end
$$;
revoke all on function trv_style_from_mode(text) from public, anon;
grant execute on function trv_style_from_mode(text) to authenticated;

create or replace function member_work_style(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_agency uuid; v_role text; v_mode text; v_mine text[]; tpl job_templates;
begin
  select agency_id, role into v_agency, v_role from profiles where id = p_user;
  if v_agency is null then return null; end if;
  if v_agency is distinct from auth_agency_id() and not is_platform_admin() then
    raise exception 'hors de votre agence' using errcode = '42501';
  end if;

  select work_mode into v_mode from agencies where id = v_agency;
  v_mode := coalesce(v_mode, 'portefeuille');

  -- Les écarts de la personne, mis sous la même forme que ceux d'un modèle :
  -- « capacité:+ » accordée en plus, « capacité:- » retirée malgré le rôle.
  select coalesce(
           array_agg(mp.permission || case when mp.granted then ':+' else ':-' end
                     order by mp.permission || case when mp.granted then ':+' else ':-' end),
           '{}'::text[])
    into v_mine
    from member_permissions mp where mp.user_id = p_user;

  select t.* into tpl
    from job_templates t
   where t.active
     and (t.agency_id is null or t.agency_id = v_agency)
     and t.base_role = v_role
     -- Les VRAIS écarts du modèle, filtre compris : `apply_job_template`
     -- n'écrit pas un droit que le rôle donne déjà, donc la comparaison doit
     -- appliquer le même filtre, sinon aucun modèle ne correspondrait jamais.
     and (select coalesce(array_agg(s.x order by s.x), '{}'::text[]) from (
            select g || ':+' as x from unnest(t.grants) g
             where not exists (select 1 from role_permissions rp
                                where rp.role = t.base_role and rp.permission = g)
            union all
            select r || ':-' from unnest(t.revokes) r
             where exists (select 1 from role_permissions rp
                            where rp.role = t.base_role and rp.permission = r)
          ) s) = v_mine
   order by t.position, t.code
   limit 1;

  if tpl.id is null then
    return jsonb_build_object(
      'style', trv_style_from_mode(v_mode),
      'focus', '[]'::jsonb,
      'poste', null,
      'poste_label', null,
      'source', 'agence',
      'agency_mode', v_mode);
  end if;

  return jsonb_build_object(
    'style', tpl.work_style,
    'focus', to_jsonb(tpl.focus),
    'poste', tpl.code,
    'poste_label', tpl.label,
    'source', 'poste',
    'agency_mode', v_mode);
end $$;

comment on function member_work_style(uuid) is
  'Le style de travail d''une personne, DÉDUIT de son poste. Aucune colonne ne le stocke : deux sources pour la même information divergent, et le poste est déjà la bonne.';

revoke all on function member_work_style(uuid) from public, anon;
grant execute on function member_work_style(uuid) to authenticated;

-- Ce que l'écran d'accueil lit pour choisir sa disposition, sans charger toute
-- la file. Deux champs et un code de poste : c'est assez pour dessiner.
create or replace function my_work_style()
returns jsonb
language sql stable security definer set search_path = public, auth as $$
  select member_work_style(auth.uid())
$$;
revoke all on function my_work_style() from public, anon;
grant execute on function my_work_style() to authenticated;

-- ------------------------------------------------------------------
-- 5 · La file de travail de la personne connectée
-- ------------------------------------------------------------------
--
-- LA RÈGLE DE PÉRIMÈTRE, qui prime sur tout le reste. Cette fonction est
-- SECURITY DEFINER : elle traverse les politiques de sécurité. Un vérificateur
-- de Sfax ne doit jamais compter les pièces de Tunis, et l'erreur ne se verrait
-- pas, parce que le résultat est un nombre et non une liste de lignes. Toute
-- lecture passe donc par `agency_id = auth_agency_id()` et par
-- `pil_in_scope(office_id, null, pil_offices_seen())`, comme toute la 0055.
--
-- EN FILE, ON NE RECOMPTE RIEN. `dashboard_today` compte déjà, sur tous les
-- dossiers du périmètre, avec les mêmes seuils et les mêmes définitions. On
-- l'appelle une fois et on regroupe ses compteurs par geste. Deux comptages du
-- même chiffre finissent toujours par se contredire, et le jour où ils se
-- contredisent, personne ne sait lequel croire.
--
-- EN PORTEFEUILLE, ON RECOMPTE, ET VOICI POURQUOI. `dashboard_today` ne connaît
-- pas la notion de responsable : elle compte le bureau entier, et aucun
-- paramètre ne la restreint à une personne. Lui en ajouter un changerait la
-- signature d'une fonction que quatre écrans consomment déjà. On recompte donc
-- ici, avec exactement les mêmes définitions, les mêmes états et les mêmes
-- seuils, et le banc vérifie que les deux se rejoignent quand une personne est
-- responsable de tous les dossiers de son bureau.

create or replace function my_worklist()
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  a       uuid := auth_agency_id();
  me      uuid := auth.uid();
  ws      jsonb;
  style   text;
  focus   text[];
  offs    uuid[];
  today   jsonb;
  g       text;
  n       bigint;
  rank    int;
  keys    text[];
  groupes jsonb := '[]'::jsonb;
  -- Les deux seuils de la 0055, repris à l'identique. Les changer ici et pas
  -- là-bas ferait deux vérités sur le même écran.
  held    int := 60;
  -- L'adresse où mène le geste d'argent. Un lien qui ouvre une porte fermée ne
  -- sert à rien : la page des paiements demande `finance:global`, celle des
  -- factures `payment:write`. On envoie chacun là où il peut entrer.
  url_arg text;
begin
  if a is null then raise exception 'hors agence' using errcode = '42501'; end if;

  ws := member_work_style(me);
  if ws is null then
    return jsonb_build_object(
      'style', 'portefeuille', 'focus', '[]'::jsonb,
      'titre_cle', 'pil.myCases', 'titre_cle_trv', 'trv.myCases',
      'groupes', '[]'::jsonb, 'total', 0, 'generated_at', now());
  end if;

  style := ws ->> 'style';
  select coalesce(array_agg(value #>> '{}'), '{}'::text[]) into focus
    from jsonb_array_elements(ws -> 'focus');

  offs := pil_offices_seen();

  url_arg := case
    when auth_can('finance:global') then '/paiements'
    when auth_can('payment:write')  then '/factures'
    else '/dossiers' end;

  -- ----------------------------------------------------------------
  -- En file : on regroupe ce que dashboard_today a déjà compté
  -- ----------------------------------------------------------------
  if style = 'file' then
    today := dashboard_today(null);

    foreach g in array trv_gestes() loop
      -- Un focus vide veut dire « tous les gestes ». C'est le comportement
      -- juste pour un poste en file dont l'agence n'a pas précisé le geste :
      -- mieux vaut une file trop large qu'un écran vide sans explication.
      if array_length(focus, 1) is not null and not (g = any (focus)) then
        continue;
      end if;
      -- « taches » n'est le geste de personne en file : une tâche est
      -- nominative, elle attend celui à qui on l'a donnée, pas le poste.
      if g = 'taches' then continue; end if;

      keys := trv_dashboard_keys(g);
      if array_length(keys, 1) is null then continue; end if;

      select coalesce(sum((i ->> 'count')::bigint), 0),
             coalesce(max(trv_tone_rank(i ->> 'tone')), 0)
        into n, rank
        from jsonb_array_elements(today -> 'items') i
       where i ->> 'key' = any (keys);

      groupes := trv_group(groupes, g, n, trv_tone_of(rank),
        case g
          when 'pieces' then '/pieces'
          when 'encaissement' then url_arg
          when 'factures' then '/factures'
          when 'creneaux' then '/rendez-vous'
          when 'passeports' then '/dossiers'
          when 'messages' then '/messages'
          when 'douane' then '/cargaisons'
          when 'livraisons' then '/livraisons'
          else '/dossiers' end);
    end loop;

    -- Les deux gestes que dashboard_today ne compte pas. On les AJOUTE, on ne
    -- les recompte pas : aucun compteur de la 0055 ne les porte.
    if (array_length(focus, 1) is null or 'traductions' = any (focus))
       and to_regclass('public.translation_orders') is not null then
      execute 'select count(*) from translation_orders t
                left join cases c on c.id = t.case_id
               where t.agency_id = $1 and t.deleted_at is null
                 and t.status in (''a_commander'',''commandee'',''en_cours'')
                 and pil_in_scope(coalesce(t.office_id, c.office_id), null, $2)'
        into n using a, offs;
      groupes := trv_group(groupes, 'traductions', n, 'orange', '/traductions');
    end if;

    if (array_length(focus, 1) is null or 'prospects' = any (focus))
       and to_regclass('public.leads') is not null then
      execute 'select count(*) from leads l
               where l.agency_id = $1 and l.deleted_at is null
                 and l.status not in (''gagne'',''perdu'')
                 and (l.next_action_at is null or l.next_action_at <= now())
                 and pil_in_scope(l.office_id, null, $2)'
        into n using a, offs;
      groupes := trv_group(groupes, 'prospects', n, 'orange', '/commercial');
    end if;

  -- ----------------------------------------------------------------
  -- En portefeuille : ses dossiers, et rien que ses dossiers
  -- ----------------------------------------------------------------
  else
    -- Pièces manquantes ou demandées sur SES dossiers ouverts.
    if array_length(focus, 1) is null or 'pieces' = any (focus) then
      select count(*) into n
        from case_documents d join cases c on c.id = d.case_id
       where d.agency_id = a and c.assignee_id = me and c.status = 'ouvert'
         and d.required and d.state in ('manquante','demandee')
         and pil_in_scope(c.office_id, null, offs);
      groupes := trv_group(groupes, 'pieces', n, 'orange', '/pieces');
    end if;

    -- SES soldes impayés : dossier ouvert, il reste quelque chose à encaisser.
    if array_length(focus, 1) is null or 'encaissement' = any (focus) then
      select count(*) into n
        from cases c
       where c.agency_id = a and c.assignee_id = me and c.status = 'ouvert'
         and c.amount_total - c.amount_paid > 0
         and pil_in_scope(c.office_id, null, offs);
      groupes := trv_group(groupes, 'encaissement', n, 'orange', url_arg);
    end if;

    -- SES rendez-vous, aujourd'hui et demain. Même fenêtre que la 0055, qui
    -- sépare les deux jours ; ici on les réunit, parce qu'un conseiller prépare
    -- sa journée et sa veille du lendemain d'un seul regard.
    if array_length(focus, 1) is null or 'creneaux' = any (focus) then
      select count(*) into n
        from appointments ap join cases c on c.id = ap.case_id
       where ap.agency_id = a and c.assignee_id = me and ap.status = 'prevu'
         and ap.at::date between current_date and current_date + 1
         and pil_in_scope(coalesce(ap.office_id, c.office_id), null, offs);
      groupes := trv_group(groupes, 'creneaux', n, 'blue', '/rendez-vous');
    end if;

    -- SES passeports détenus. Rouge dès qu'un seul dort chez nous depuis plus
    -- de soixante jours : pendant ce temps le client ne peut ni voyager ni
    -- faire une autre démarche.
    if array_length(focus, 1) is null or 'passeports' = any (focus) then
      select count(*),
             max(case when pc.received_at < now() - make_interval(days => held)
                      then 4 else 1 end)
        into n, rank
        from passport_custody pc join cases c on c.id = pc.case_id
       where pc.agency_id = a and c.assignee_id = me and pc.returned_at is null
         and pil_in_scope(c.office_id, null, offs);
      groupes := trv_group(groupes, 'passeports', n, trv_tone_of(coalesce(rank, 1)), '/dossiers');
    end if;

    -- SES clients à rappeler : un message entrant plus récent que notre
    -- dernière réponse. Définition mot pour mot celle de la 0055.
    if array_length(focus, 1) is null or 'messages' = any (focus) then
      select count(*) into n
        from cases c
       where c.agency_id = a and c.assignee_id = me and c.status = 'ouvert'
         and pil_in_scope(c.office_id, null, offs)
         and exists (
           select 1 from messages m
            where m.case_id = c.id and m.direction = 'entrant'
              and m.at > coalesce((select max(m2.at) from messages m2
                                    where m2.case_id = c.id and m2.direction = 'sortant'),
                                  '-infinity'::timestamptz));
      groupes := trv_group(groupes, 'messages', n, 'blue', '/messages');
    end if;

    if (array_length(focus, 1) is null or 'traductions' = any (focus))
       and to_regclass('public.translation_orders') is not null then
      execute 'select count(*) from translation_orders t
                join cases c on c.id = t.case_id
               where t.agency_id = $1 and t.deleted_at is null and c.assignee_id = $2
                 and t.status in (''a_commander'',''commandee'',''en_cours'')
                 and pil_in_scope(coalesce(t.office_id, c.office_id), null, $3)'
        into n using a, me, offs;
      groupes := trv_group(groupes, 'traductions', n, 'orange', '/traductions');
    end if;

    -- Le fret porte lui aussi un responsable : un transitaire suit ses
    -- cargaisons comme un conseiller suit ses dossiers.
    if array_length(focus, 1) is null or 'douane' = any (focus) then
      select count(*) into n
        from shipments s
       where s.agency_id = a and s.assignee_id = me and s.status = 'en_cours'
         and s.arrived_at is not null and s.cleared_at is null
         and pil_in_scope(s.office_id, null, offs);
      groupes := trv_group(groupes, 'douane', n, 'orange', '/cargaisons');
    end if;

    if (array_length(focus, 1) is null or 'livraisons' = any (focus))
       and to_regclass('public.deliveries') is not null then
      execute 'select count(*) from deliveries d
                join shipments s on s.id = d.shipment_id
               where d.agency_id = $1 and s.assignee_id = $2
                 and d.planned_at::date = current_date
                 and d.status not in (''livree'',''echouee'')
                 and pil_in_scope(coalesce(d.office_id, s.office_id), null, $3)'
        into n using a, me, offs;
      groupes := trv_group(groupes, 'livraisons', n, 'blue', '/livraisons');
    end if;

    if (array_length(focus, 1) is null or 'prospects' = any (focus))
       and to_regclass('public.leads') is not null then
      execute 'select count(*) from leads l
               where l.agency_id = $1 and l.deleted_at is null
                 and l.assigned_user_id = $2
                 and l.status not in (''gagne'',''perdu'')
                 and (l.next_action_at is null or l.next_action_at <= now())
                 and pil_in_scope(l.office_id, null, $3)'
        into n using a, me, offs;
      groupes := trv_group(groupes, 'prospects', n, 'orange', '/commercial');
    end if;

    -- SES tâches. Elles ne dépendent d'aucun geste : une tâche est nominative,
    -- elle attend celui à qui on l'a donnée.
    select count(*),
           max(case when t.due_at < now() then 4 else 2 end)
      into n, rank
      from tasks t
      left join cases c on c.id = t.case_id
      left join shipments s on s.id = t.shipment_id
     where t.agency_id = a and t.assignee_id = me and not t.done
       and t.due_at is not null and t.due_at::date <= current_date
       and pil_in_scope(coalesce(c.office_id, s.office_id), null, offs);
    groupes := trv_group(groupes, 'taches', n, trv_tone_of(coalesce(rank, 2)), '/taches');
  end if;

  return jsonb_build_object(
    'style', style,
    'focus', to_jsonb(focus),
    -- La clé du titre. `pil.myCases` et `pil.myQueue` sont celles que demande
    -- l'écran d'accueil ; les mêmes textes vivent aussi sous `trv.`, dans le
    -- bloc de traduction de ce module, pour qui préfère les lire là.
    'titre_cle', case when style = 'file' then 'pil.myQueue' else 'pil.myCases' end,
    'titre_cle_trv', case when style = 'file' then 'trv.myQueue' else 'trv.myCases' end,
    'poste', ws -> 'poste',
    'poste_label', ws -> 'poste_label',
    'source', ws ->> 'source',
    'groupes', groupes,
    'total', (select coalesce(sum((x ->> 'compte')::bigint), 0)
                from jsonb_array_elements(groupes) x),
    'generated_at', now());
end $$;

comment on function my_worklist() is
  'Ce qui attend la personne connectée, présenté selon le style de son poste. En file, elle regroupe les compteurs de dashboard_today sans en recompter un seul.';

revoke all on function my_worklist() from public, anon;
grant execute on function my_worklist() to authenticated;

-- ------------------------------------------------------------------
-- 6 · Le réglage du mode, et ce qu'il donne à voir
-- ------------------------------------------------------------------
--
-- Un réglage dont on ne voit pas l'effet ne se règle jamais. L'écran doit donc
-- pouvoir montrer la réalité d'aujourd'hui : « 3 en portefeuille, 2 en file ».
-- Le décompte se fait par poste, pas par mode : c'est le poste qui décide, et
-- c'est ce que le patron doit lire avant de basculer quoi que ce soit.

create or replace function agency_work_mode()
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  a uuid := auth_agency_id();
  v_mode text; membres jsonb; n_p int; n_f int; n_sans int;
begin
  if a is null then raise exception 'hors agence' using errcode = '42501'; end if;
  if not (auth_can('settings:view') or auth_can('settings:manage') or auth_can('team:manage')) then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;

  select coalesce(work_mode, 'portefeuille') into v_mode from agencies where id = a;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'name', m.name, 'role', m.role,
           'style', m.ws ->> 'style',
           'poste', m.ws -> 'poste',
           'poste_label', m.ws -> 'poste_label',
           'source', m.ws ->> 'source'
         ) order by m.name), '[]'::jsonb),
         count(*) filter (where m.ws ->> 'style' = 'portefeuille'),
         count(*) filter (where m.ws ->> 'style' = 'file'),
         count(*) filter (where m.ws ->> 'source' = 'agence')
    into membres, n_p, n_f, n_sans
    from (select p.id, p.name, p.role, member_work_style(p.id) as ws
            from profiles p where p.agency_id = a and p.active) m;

  return jsonb_build_object(
    'mode', v_mode,
    'can_change', auth_can('settings:manage'),
    'portefeuille', coalesce(n_p, 0),
    'file', coalesce(n_f, 0),
    'sans_poste', coalesce(n_sans, 0),
    'total', coalesce(n_p, 0) + coalesce(n_f, 0),
    'membres', membres);
end $$;
revoke all on function agency_work_mode() from public, anon;
grant execute on function agency_work_mode() to authenticated;

-- Changer le mode. Réservé à qui modifie les réglages, et tracé : un réglage
-- qui change la tête de l'écran de tout le monde sans laisser de nom est un
-- réglage dont personne ne saura jamais qui l'a touché.
create or replace function set_agency_work_mode(p_mode text)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare a uuid := auth_agency_id(); v_avant text;
begin
  if a is null then raise exception 'hors agence' using errcode = '42501'; end if;
  if not auth_can('settings:manage') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('portefeuille','file','mixte') then
    raise exception 'mode inconnu' using errcode = 'P0001';
  end if;

  select coalesce(work_mode, 'portefeuille') into v_avant from agencies where id = a;
  update agencies set work_mode = p_mode where id = a;

  if v_avant is distinct from p_mode then
    insert into activity_events (agency_id, actor_id, type, detail)
    values (a, auth.uid(), 'mode_travail_change',
            jsonb_build_object(
              'fr', 'Mode de travail : ' || v_avant || ' vers ' || p_mode,
              'avant', v_avant, 'apres', p_mode));
  end if;

  return agency_work_mode();
end $$;
revoke all on function set_agency_work_mode(text) from public, anon;
grant execute on function set_agency_work_mode(text) to authenticated;

-- ------------------------------------------------------------------
-- 7 · Les postes proposés en premier
-- ------------------------------------------------------------------
--
-- La seule autre conséquence du mode. L'écran d'équipe montre d'abord les
-- postes qui vont avec la façon de travailler de l'agence. Il montre TOUS les
-- postes quand même : un mélange se fait en descendant d'une ligne, pas en
-- changeant un réglage d'agence.

create or replace function job_templates_ranked()
returns table (
  id uuid, agency_id uuid, code text, label jsonb, description jsonb,
  base_role text, grants text[], revokes text[], "position" int,
  work_style text, focus text[], suggested boolean
)
language plpgsql stable security definer set search_path = public, auth as $$
declare v_mode text;
begin
  select coalesce(a.work_mode, 'portefeuille') into v_mode
    from agencies a where a.id = auth_agency_id();

  return query
    select t.id, t.agency_id, t.code, t.label, t.description,
           t.base_role, t.grants, t.revokes, t.position,
           t.work_style, t.focus,
           -- En mixte, tout est suggéré : c'est précisément ce que veut dire
           -- « je fais les deux ».
           (v_mode = 'mixte' or t.work_style = trv_style_from_mode(v_mode)) as suggested
      from job_templates t
     where t.active and (t.agency_id is null or t.agency_id = auth_agency_id())
     order by (v_mode = 'mixte' or t.work_style = trv_style_from_mode(v_mode)) desc,
              t.position, t.code;
end $$;
revoke all on function job_templates_ranked() from public, anon;
grant execute on function job_templates_ranked() to authenticated;

-- ------------------------------------------------------------------
-- 8 · Le piège des fonctions de déclencheur
-- ------------------------------------------------------------------
--
-- PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction nouvellement créée.
-- Pour une fonction de déclencheur, personne ne le remarque : elle s'appelle
-- toute seule. Mais elle reste appelable par un anonyme, et une fonction
-- SECURITY DEFINER appelable par un anonyme est une porte ouverte. Même boucle
-- qu'en fin de 0044 et de 0062 : on ferme pour tout le schéma, une par une
-- l'oubli reviendrait.
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
