-- Le jeu de démonstration, en base et non dans le paquet du navigateur.
--
-- Il monte DEUX agences, et c'est volontaire : une seule ne prouve rien.
-- L'étanchéité ne se voit que s'il existe quelque chose de l'autre côté du
-- mur à essayer d'attraper. Tunis Consulting est l'agence riche, Sahara
-- Voyages est celle dont les données ne doivent JAMAIS apparaître ailleurs.
--
-- Les repères en double accolade sont remplacés par le pilote (seed.py) avec les
-- identifiants des vrais comptes d'authentification qu'il vient de créer.
-- Rejouable : il efface ses deux agences avant de les refaire.

do $$
declare
  a_tca uuid; a_sah uuid;
  o_tunis uuid; o_tripoli uuid; o_canton uuid; o_sfax uuid;
  cs_fr uuid; cs_it uuid; cs_cn uuid; cs_be uuid; cs_frsfax uuid;
  vt_fr uuid; vt_cn uuid; vt_canton uuid; vt_it uuid;
  ck uuid; ckv uuid;
  cl uuid; ca uuid; q uuid; sh uuid;
  i int; n int;
  prenoms text[] := array['Amine','Salma','Mohamed','Ines','Youssef','Farah','Karim','Rania','Slim','Nour','Hatem','Dorra','Bilel','Sonia','Wassim','Emna','Ali','Meriem','Sofiene','Hela','Tarek','Nesrine','Anis','Olfa'];
  noms    text[] := array['Ben Salah','Trabelsi','Gharbi','Mansouri','Chaabane','Bouazizi','Jlassi','Hammami','Ferchichi','Nasri','Ayari','Khelifi'];
  ly_prenoms text[] := array['Abdelbasset','Fatima','Mokhtar','Aisha','Khaled','Najat'];
  ly_noms text[] := array['Al Werfalli','Ben Ghazi','Al Misrati','Zintani','Al Fitouri','Sabri'];
  cn_prenoms text[] := array['Wei','Li','Chen','Xiu'];
  cn_noms text[] := array['Zhang','Wang','Liu','Huang'];
  statuts text[] := array['salarie','salarie','salarie','independant','independant','fonctionnaire','etudiant','retraite','sans_emploi'];
  etapes  text[] := array['nouveau','pieces','pieces','pieces','verification','verification','rendez_vous','rendez_vous','rendez_vous','depot','depot','consulat','consulat','decision','retrait','retrait','clos','clos','clos','clos','clos','clos','clos','clos','clos','clos','clos','clos','clos','clos'];
  motifs  text[] := array['sortie_non_etablie','sortie_non_etablie','sortie_non_etablie','sortie_non_etablie','moyens_insuffisants','moyens_insuffisants','moyens_insuffisants','justificatifs_non_fiables','justificatifs_non_fiables','objet_non_justifie','assurance_absente','sejours_epuises'];
  employeurs text[] := array['Poulina Group','Délice Danone','Tunisie Telecom','One Tech','STEG','Sanofi Tunisie','Vermeg'];
begin

  -- ------------------------------------------------------------------
  -- Table rase : le jeu se rejoue sans laisser de doublon
  -- ------------------------------------------------------------------
  delete from agencies where slug in ('tca','sahara');

  -- ==================================================================
  -- AGENCE 1 · Tunis Consulting
  -- ==================================================================
  insert into agencies (slug, name, legal_name, tax_id, country, mark, accent, email, phone, website,
                        locales, default_locale, currency, services, plan, inpdp_ref, setup_done, created_at)
  values ('tca', 'Tunis Consulting', 'TCA Ltd', '1234567/A/M/000', 'Tunisie', 'TC', '#0066CC',
          'contact@tunis-consulting.com', '+216 71 962 300', 'https://tunis-consulting.com',
          '{fr,en,ar,zh}', 'fr', 'TND', '{visas,fret}', 'multi_bureaux', 'INPDP-2026-0148',
          '{offices,team,catalog,firstCase,share}', now() - interval '900 days')
  returning id into a_tca;

  insert into offices (agency_id, name, city, country, country_code, phone, address, timezone) values
    (a_tca,'Tunis','Tunis','Tunisie','TN','+216 71 962 300','Immeuble Carthage, Les Berges du Lac 2','Africa/Tunis'),
    (a_tca,'Tripoli','Tripoli','Libye','LY','+218 91 220 4477','Charee Omar Al Mokhtar','Africa/Tripoli'),
    (a_tca,'Guangzhou','Guangzhou','Chine','CN','+86 20 3888 1120','Pazhou, Haizhu District','Asia/Shanghai');
  select id into o_tunis   from offices where agency_id=a_tca and city='Tunis';
  select id into o_tripoli from offices where agency_id=a_tca and city='Tripoli';
  select id into o_canton  from offices where agency_id=a_tca and city='Guangzhou';

  -- Les comptes. Ce sont de VRAIS comptes d'authentification : le pilote
  -- s'y connecte ensuite pour éprouver le mur, avec de vrais jetons.
  insert into profiles (id, agency_id, office_id, name, email, phone, role, locale) values
    ('{{TCA_OWNER}}',   a_tca, o_tunis,   'Slim Ben Amor',   'slim@tunis-consulting.test',   '+216 98 100 001', 'owner',   'fr'),
    ('{{TCA_MANAGER}}', a_tca, o_tunis,   'Amira Kacem',     'amira@tunis-consulting.test',  '+216 98 100 002', 'manager', 'fr'),
    ('{{TCA_AGENT}}',   a_tca, o_tunis,   'Hatem Zouari',    'hatem@tunis-consulting.test',  '+216 98 100 003', 'agent',   'fr'),
    ('{{TCA_TRIPOLI}}', a_tca, o_tripoli, 'Najat Al Fitouri','najat@tunis-consulting.test',  '+218 91 100 004', 'agent',   'ar'),
    ('{{TCA_VIEWER}}',  a_tca, o_tunis,   'Stagiaire',       'stage@tunis-consulting.test',  '+216 98 100 005', 'viewer',  'fr');

  -- Catalogue de base : listes de pièces, types de visa, modèles, règles.
  perform seed_catalogue(a_tca, '{visas,fret}');
  select id into ck from checklists where agency_id=a_tca limit 1;
  select id into ckv from checklist_versions where agency_id=a_tca limit 1;

  -- Les postes consulaires, avec les taux officiels 2025 de la Commission.
  insert into consulates (agency_id, country_code, country, city, centre, requires_residence,
                          fee_consulate, currency, appeal_days, appeal_source, appeal_checked_at,
                          ref_year, ref_refusal_rate, ref_multi_entry, announced_days, notes) values
    (a_tca,'FR','{"fr":"France","en":"France","ar":"فرنسا","zh":"法国"}','Tunis','tls_tunis',false,300,'TND',30,'CRRV, à revérifier : 30 jours ou 2 mois selon les sources','2026-09-07',2025,15.4,61.2,15,'Instruit aussi les dossiers des résidents en Libye.'),
    (a_tca,'IT','{"fr":"Italie","en":"Italy","ar":"إيطاليا","zh":"意大利"}','Tunis','tls_tunis',false,300,'TND',60,'TAR Lazio','2026-09-07',2025,32.0,28.4,21,null),
    (a_tca,'BE','{"fr":"Belgique","en":"Belgium","ar":"بلجيكا","zh":"比利时"}','Tunis','vfs_tunis',false,300,'TND',30,null,'2026-09-07',2025,40.8,12.6,25,null),
    (a_tca,'FR','{"fr":"France","en":"France","ar":"فرنسا","zh":"法国"}','Sfax','tls_sfax',false,300,'TND',30,null,'2026-09-07',2025,18.9,52.6,18,null),
    (a_tca,'CN','{"fr":"Chine","en":"China","ar":"الصين","zh":"中国"}','Tunis','consulat',false,260,'TND',null,null,null,null,null,null,4,'Visa affaires catégorie M obligatoire : ni la Tunisie ni la Libye ne sont exemptées.');
  select id into cs_fr     from consulates where agency_id=a_tca and country_code='FR' and city='Tunis';
  select id into cs_it     from consulates where agency_id=a_tca and country_code='IT';
  select id into cs_be     from consulates where agency_id=a_tca and country_code='BE';
  select id into cs_frsfax from consulates where agency_id=a_tca and country_code='FR' and city='Sfax';
  select id into cs_cn     from consulates where agency_id=a_tca and country_code='CN';

  select id into vt_fr     from visa_types where agency_id=a_tca and country_code='FR' limit 1;
  select id into vt_cn     from visa_types where agency_id=a_tca and country_code='CN' limit 1;
  if vt_fr is null then
    insert into visa_types (agency_id, country_code, country, label, category, processing_days, fee_agency, fee_consulate, checklist_id)
    values (a_tca,'FR','{"fr":"France"}','{"fr":"Schengen tourisme"}','tourisme',18,340,300,ck) returning id into vt_fr;
  end if;
  if vt_cn is null then
    insert into visa_types (agency_id, country_code, country, label, category, processing_days, fee_agency, fee_consulate, checklist_id)
    values (a_tca,'CN','{"fr":"Chine"}','{"fr":"Affaires 48 h"}','affaires',3,420,260,ck) returning id into vt_cn;
  end if;

  -- ------------------------------------------------------------------
  -- Les clients : trois nationalités, tous les statuts professionnels
  -- ------------------------------------------------------------------
  -- Le statut professionnel est le troisième axe de la liste de pièces. Sans
  -- lui, une checklist « France » n'existe pas. Et les clients libyens n'ont
  -- pas de titre de séjour tunisien : c'est la règle, pas l'exception.
  for i in 1..24 loop
    insert into clients (agency_id, office_id, first_name, last_name, native_name, email, phone, whatsapp,
                         nationality, passport_number, passport_expiry, birth_date, address, locale,
                         professional_status, employer, biometrics_at, phone_verified_at, created_at)
    values (
      a_tca,
      case when i % 6 = 0 then o_tripoli when i % 11 = 0 then o_canton else o_tunis end,
      case when i % 6 = 0 then ly_prenoms[1 + (i % 6)] when i % 11 = 0 then cn_prenoms[1 + (i % 4)] else prenoms[1 + (i % 24)] end,
      case when i % 6 = 0 then ly_noms[1 + (i % 6)] when i % 11 = 0 then cn_noms[1 + (i % 4)] else noms[1 + (i % 12)] end,
      case when i % 6 = 0 then 'عبد الباسط' when i % 11 = 0 then '张伟' else null end,
      null,
      case when i % 6 = 0 then '+218 91 ' || lpad((200+i)::text,3,'0') || ' ' || lpad((1000+i*7)::text,4,'0')
           when i % 11 = 0 then '+86 138 ' || lpad((1000+i)::text,4,'0') || ' ' || lpad((2000+i)::text,4,'0')
           else '+216 ' || (20 + (i % 79)) || ' ' || lpad((100+i*3)::text,3,'0') || ' ' || lpad((100+i*5)::text,3,'0') end,
      null,
      case when i % 6 = 0 then 'Libyenne' when i % 11 = 0 then 'Chinoise' else 'Tunisienne' end,
      case when i % 6 = 0 then 'L' else case when i % 11 = 0 then 'E' else 'T' end end || lpad((100000 + i * 4231)::text, 6, '0'),
      (current_date + ((90 + i * 61) || ' days')::interval)::date,
      (current_date - ((7000 + i * 137) || ' days')::interval)::date,
      case when i % 6 = 0 then 'Tripoli, Libye' when i % 11 = 0 then 'Guangzhou, Chine' else 'Tunis, Tunisie' end,
      case when i % 6 = 0 then 'ar' when i % 11 = 0 then 'zh' else 'fr' end,
      statuts[1 + (i % 9)],
      case when statuts[1 + (i % 9)] = 'salarie' then employeurs[1 + (i % 7)] else null end,
      -- Deux clients sur trois ont déjà donné leurs empreintes. Valables 59
      -- mois, elles leur évitent un déplacement et un créneau.
      case when i % 3 <> 0 then (current_date - ((30 + i * 71) || ' days')::interval)::date end,
      now() - ((i * 13) || ' days')::interval,
      now() - ((30 + i * 21) || ' days')::interval
    );
  end loop;
  update clients set whatsapp = phone where agency_id = a_tca;

  raise notice 'TCA : % clients', (select count(*) from clients where agency_id=a_tca);
end $$;

-- ==================================================================
-- Les dossiers de Tunis Consulting, et tout ce qui pend à un dossier
-- ==================================================================
do $$
declare
  a_tca uuid; ca uuid; cl uuid; q uuid;
  o_tunis uuid; ck uuid;
  cs_fr uuid; cs_it uuid; cs_be uuid; cs_frsfax uuid; cs_cn uuid;
  vts uuid[]; css uuid[]; agents uuid[];
  i int; etape text; statut text; cid uuid; vt uuid; consul uuid;
  total numeric; paye numeric; refus text;
  etapes text[] := array['nouveau','pieces','pieces','pieces','verification','verification','rendez_vous','rendez_vous','rendez_vous','depot','depot','consulat','consulat','decision','retrait','retrait','clos','clos','clos','clos','clos','clos','clos','clos','clos','clos','clos','clos','clos','clos'];
  motifs text[] := array['sortie_non_etablie','sortie_non_etablie','sortie_non_etablie','sortie_non_etablie','moyens_insuffisants','moyens_insuffisants','moyens_insuffisants','justificatifs_non_fiables','justificatifs_non_fiables','objet_non_justifie','assurance_absente','sejours_epuises'];
  notes text[] := array['Le client passe demain déposer son relevé.','Appelé, ne répond pas. Relancé sur WhatsApp.','Attention, départ avancé d''une semaine.','Employeur confirme l''attestation par courriel.','Le passeport expire dans 5 mois, à surveiller.'];
begin
  select id into a_tca from agencies where slug='tca';
  select id into o_tunis from offices where agency_id=a_tca and city='Tunis';
  select id into ck from checklists where agency_id=a_tca limit 1;
  select array_agg(id) into vts from visa_types where agency_id=a_tca and active;
  select array_agg(id) into css from consulates where agency_id=a_tca and active;
  select array_agg(id) into agents from profiles where agency_id=a_tca and role in ('agent','manager');
  select id into cs_fr from consulates where agency_id=a_tca and country_code='FR' and city='Tunis';

  for i in 1..30 loop
    etape := etapes[i];
    select id into cid from clients where agency_id=a_tca order by created_at offset ((i - 1) % 24) limit 1;
    vt := vts[1 + (i % array_length(vts,1))];
    consul := css[1 + (i % array_length(css,1))];

    -- Un dossier clos sur huit est un refus. C'est le taux réel du terrain
    -- pour une agence qui travaille bien : la moyenne nationale est à 19,6 %.
    statut := case when etape = 'clos' then (case when i % 8 = 0 then 'refuse' else 'accepte' end) else 'ouvert' end;
    refus := case when statut = 'refuse' then motifs[1 + (i % 12)] end;
    total := 300 + (i % 7) * 120;
    paye := case when etape = 'clos' then total
                 when etape in ('depot','consulat','decision','retrait') then total
                 when i % 2 = 0 then round(total / 2) else 0 end;

    insert into cases (agency_id, reference, client_id, visa_type_id, office_id, assignee_id,
                       checklist_version_id, stage, status, priority, source, opened_at, updated_at,
                       travel_date, due_at, consulate_id, track, decision_at, refusal_code,
                       refusal_reason, amount_total, amount_paid, currency)
    values (
      a_tca, 'VF-2026-' || lpad((140 + i)::text, 4, '0'), cid, vt, o_tunis,
      agents[1 + (i % array_length(agents,1))],
      (select id from checklist_versions where agency_id=a_tca limit 1),
      etape, statut,
      case when etape = 'clos' then 'normale' when i % 9 = 0 then 'urgente' when i % 5 = 0 then 'haute' else 'normale' end,
      (array['comptoir','whatsapp','site','recommandation','partenaire'])[1 + (i % 5)],
      now() - ((case when etape='clos' then 40 + i * 3 else 2 + i end) || ' days')::interval,
      now() - ((i % 9) || ' days')::interval,
      (current_date + ((case when etape='clos' then -(5 + i) else 8 + i * 2 end) || ' days')::interval)::date,
      (current_date + ((case when etape='clos' then -(12 + i) else 1 + i * 2 end) || ' days')::interval)::date,
      consul,
      case when i % 5 = 0 then 'vise' else 'primo' end,
      case when etape = 'clos' then now() - ((3 + i) || ' days')::interval end,
      refus,
      case when refus is not null then 'Le consulat estime les attaches en Tunisie insuffisamment démontrées.' end,
      total, paye, 'TND'
    ) returning id into ca;

    -- Les pièces, recopiées de la liste au moment de l'ouverture.
    insert into case_documents (agency_id, case_id, key, label, state, required, received_channel, received_at)
    select a_tca, ca, x.key, x.label,
           case
             when etape in ('clos','retrait','decision','consulat','depot') then 'validee'
             when etape = 'verification' then (case when x.ord = 1 then 'recue' else 'validee' end)
             when etape = 'pieces' then (case when x.ord <= 2 then 'validee' when x.ord = 3 then 'demandee' else 'manquante' end)
             else 'manquante'
           end,
           true,
           case when etape not in ('nouveau') then (array['comptoir','portail','whatsapp'])[1 + (x.ord % 3)] end,
           case when etape not in ('nouveau') then now() - ((x.ord * 2) || ' days')::interval end
    from (
      select row_number() over () as ord, k as key,
             jsonb_build_object('fr', l) as label
      from unnest(
        array['passeport','photo','releves','assurance','justif_emploi','reservation'],
        array['Passeport','Photo d''identité','Relevés bancaires, 3 derniers mois','Assurance voyage','Justificatif d''emploi','Réservation d''hôtel']
      ) as t(k, l)
    ) x;

    -- L'argent : honoraires et débours séparés. Le frais de consulat n'est
    -- pas du revenu de l'agence, c'est une avance qu'elle refacture.
    insert into payments (agency_id, case_id, client_id, label, kind, amount, currency, state, method, at, office_id)
    values
      (a_tca, ca, cid, '{"fr":"Honoraires"}', 'honoraires', total - 300, 'TND',
       case when paye >= total then 'regle' when paye > 0 then 'partiel' else 'du' end,
       case when paye > 0 then (array['especes','virement','carte'])[1 + (i % 3)] end,
       case when paye > 0 then now() - ((i % 20) || ' days')::interval end, o_tunis),
      (a_tca, ca, cid, '{"fr":"Frais de consulat"}', 'debours', 300, 'TND',
       case when paye >= total then 'regle' else 'du' end,
       case when paye >= total then 'especes' end,
       case when paye >= total then now() - ((i % 20) || ' days')::interval end, o_tunis);

    -- La conversation. Une agence qui ne parle pas à ses clients n'existe pas.
    if i % 2 = 0 then
      insert into messages (agency_id, case_id, client_id, channel, direction, body, locale, status, at, wa_category)
      values
        (a_tca, ca, cid, 'whatsapp', 'sortant',
         'Bonjour, il nous manque vos trois derniers relevés bancaires pour compléter votre dossier.',
         'fr', 'lu', now() - ((i % 10 + 2) || ' days')::interval, 'utility'),
        (a_tca, ca, cid, 'whatsapp', 'entrant',
         'Bonjour, je les envoie ce soir. Merci.', 'fr', 'remis',
         now() - ((i % 10 + 2) || ' days')::interval + interval '3 hours', 'service');
    end if;

    if i % 3 = 0 then
      insert into case_notes (agency_id, case_id, author_id, kind, text, at)
      values (a_tca, ca, agents[1 + (i % array_length(agents,1))],
              (array['note','appel','comptoir'])[1 + (i % 3)],
              notes[1 + (i % 5)], now() - ((i % 12) || ' days')::interval);
    end if;

    -- Le rendez-vous n'existe qu'une fois le créneau décroché.
    if etape in ('depot','consulat','decision','retrait') then
      insert into appointments (agency_id, case_id, office_id, kind, at, duration_min, location, status)
      values (a_tca, ca, o_tunis, 'consulat',
              now() + ((case when etape='depot' then 3 + i else -(2 + i) end) || ' days')::interval,
              30, 'TLScontact, Les Berges du Lac, Tunis',
              case when etape = 'depot' then 'prevu' else 'fait' end);
    end if;

    -- La file d'attente : ceux dont les pièces sont prêtes et qui attendent.
    if etape in ('verification','rendez_vous') then
      insert into appointment_queue (agency_id, case_id, consulate_id, joined_at, priority, status)
      values (a_tca, ca, consul, now() - ((2 + i * 2) || ' days')::interval,
              case when i % 9 = 0 then 'urgente' when i % 5 = 0 then 'haute' else 'normale' end, 'attente');
    elsif etape in ('depot','consulat','decision','retrait','clos') then
      insert into appointment_queue (agency_id, case_id, consulate_id, joined_at, priority, status, served_at, served_by)
      values (a_tca, ca, consul, now() - ((25 + i) || ' days')::interval, 'normale', 'servi',
              now() - ((5 + i) || ' days')::interval, (select id from profiles where agency_id=a_tca and role='agent' limit 1));
    end if;
  end loop;

  -- Le registre des tentatives. C'est le travail réel de l'agent, et le
  -- résultat dominant est « aucun créneau » : c'est exactement le problème.
  insert into slot_attempts (agency_id, consulate_id, at, by_id, centre, result, slot_at)
  select a_tca,
         (select id from consulates where agency_id=a_tca and centre <> 'consulat' order by random() limit 1),
         now() - ((d.day) || ' days')::interval - ((k.n * 97) || ' minutes')::interval,
         (select id from profiles where agency_id=a_tca and role in ('agent','manager') order by random() limit 1),
         (array['tls_tunis','tls_sfax','vfs_tunis'])[1 + ((d.day + k.n) % 3)],
         (array['aucun_creneau','aucun_creneau','aucun_creneau','aucun_creneau','aucun_creneau','aucun_creneau','aucun_creneau','site_indisponible','site_indisponible','creneau_pris'])[1 + ((d.day * 3 + k.n * 7) % 10)],
         null
  from generate_series(0, 9) as d(day), generate_series(1, 3) as k(n);

  raise notice 'TCA : % dossiers, % en file, % tentatives',
    (select count(*) from cases where agency_id=a_tca),
    (select count(*) from appointment_queue where agency_id=a_tca and status='attente'),
    (select count(*) from slot_attempts where agency_id=a_tca);
end $$;

-- ==================================================================
-- Le fret, les demandes entrantes, et la seconde agence
-- ==================================================================
do $$
declare
  a_tca uuid; a_sah uuid; o_tunis uuid; o_canton uuid; o_sfax uuid;
  sh uuid; cid uuid; cs_fr2 uuid; vt2 uuid; ck2 uuid; ag2 uuid;
  i int;
begin
  select id into a_tca from agencies where slug='tca';
  select id into o_tunis  from offices where agency_id=a_tca and city='Tunis';
  select id into o_canton from offices where agency_id=a_tca and city='Guangzhou';

  -- ------------------------------------------------------------------
  -- Les cargaisons. Il n'existe AUCUNE ligne directe Chine vers Radès :
  -- toutes passent par un hub méditerranéen, et c'est là que le retard naît.
  -- ------------------------------------------------------------------
  for i in 1..6 loop
    select id into cid from clients where agency_id=a_tca order by created_at offset (i * 3) limit 1;
    insert into shipments (agency_id, reference, office_id, assignee_id, mode, consolidated, supplier, goods,
                           origin_city, origin_port, dest_city, dest_port, country_from, country_to, incoterm,
                           container_no, bl_number, vessel, packages, weight_kg, volume_cbm, stage, status,
                           etd, eta, free_days, demurrage_rate, demurrage_currency, broker_name)
    values (
      a_tca, 'CG-2026-' || lpad((40 + i)::text, 4, '0'), o_canton,
      (select id from profiles where agency_id=a_tca and role='agent' limit 1),
      (array['maritime_lcl','maritime_lcl','maritime_fcl','aerien'])[1 + (i % 4)],
      i % 2 = 0,
      (array['Ningbo Sunrise Trading','Guangzhou Haoyu Import','Yiwu Bright Star','Shenzhen Kaida'])[1 + (i % 4)],
      jsonb_build_object('fr', (array['Pièces détachées auto','Articles ménagers','Textile','Luminaires LED'])[1 + (i % 4)]),
      (array['Ningbo','Guangzhou','Yiwu','Shenzhen'])[1 + (i % 4)],
      (array['Ningbo','Nansha','Ningbo','Yantian'])[1 + (i % 4)],
      case when i % 5 = 0 then 'Tripoli' else 'Tunis' end,
      case when i % 5 = 0 then 'Misrata' else 'Radès' end,
      'CN', case when i % 5 = 0 then 'LY' else 'TN' end,
      -- L'Incoterm suit le mode, sinon il ne veut rien dire. Le groupage
      -- montre les deux cas : FCA au CFS, qui est la règle correcte, et FOB,
      -- qui domine par habitude et laisse le risque au vendeur pendant
      -- l'empotage. C'est cette ligne-là que le produit devra signaler.
      case (array['maritime_lcl','maritime_lcl','maritime_fcl','aerien'])[1 + (i % 4)]
        when 'maritime_lcl' then (case when i % 2 = 0 then 'FCA' else 'FOB' end)
        when 'maritime_fcl' then 'FOB'
        when 'aerien' then 'CIP'
        else 'DAP'
      end,
      case when i % 4 <> 3 then 'MSCU' || lpad((1000000 + i * 74531)::text, 7, '0') end,
      'HBL-' || lpad((20260000 + i * 17)::text, 8, '0'),
      (array['MSC Kalina','CMA CGM Rossini','Seago Piraeus','Maersk Batur'])[1 + (i % 4)],
      20 + i * 14, 320 + i * 190, 2.4 + i * 1.7,
      (array['empotage','depart','transit','transit','arrivee','douane'])[1 + (i % 6)],
      case when i = 4 then 'bloquee' else 'en_cours' end,
      (current_date - ((14 + i * 4) || ' days')::interval)::date,
      (current_date + ((10 + i * 3) || ' days')::interval)::date,
      7, 95, 'EUR',
      'Nssiri, code 000005F'
    ) returning id into sh;

    if i = 4 then
      update shipments set blocked_reason = 'Certificat d''origine illisible, le contrôle technique le réclame en original.',
                           blocked_since = now() - interval '4 days'
      where id = sh;
    end if;

    -- Le trajet, transbordement compris. C'est lui qui explique les retards.
    insert into shipment_events (agency_id, shipment_id, stage, at, location, note)
    values
      (a_tca, sh, 'empotage', now() - ((20 + i * 4) || ' days')::interval,
       (array['Ningbo','Nansha','Ningbo','Yantian'])[1 + (i % 4)], null),
      (a_tca, sh, 'depart',   now() - ((14 + i * 4) || ' days')::interval,
       (array['Ningbo','Nansha','Ningbo','Yantian'])[1 + (i % 4)], null),
      (a_tca, sh, 'transit',  now() - ((3 + i) || ' days')::interval,
       (array['Malte','Gioia Tauro','Valence','Algésiras'])[1 + (i % 4)],
       jsonb_build_object('fr','Transbordement. Aucune ligne directe ne relie la Chine à Radès.'));

    insert into payments (agency_id, shipment_id, client_id, label, kind, amount, currency, state, method, at, office_id)
    values (a_tca, sh, cid, '{"fr":"Fret et débours"}', 'fret', 1400 + i * 320, 'TND',
            case when i % 3 = 0 then 'regle' else 'du' end,
            case when i % 3 = 0 then 'virement' end,
            case when i % 3 = 0 then now() - ((i * 2) || ' days')::interval end, o_tunis);
  end loop;

  -- ------------------------------------------------------------------
  -- Les demandes entrantes : elles n'ouvrent pas un dossier, quelqu'un doit
  -- d'abord décider de les prendre.
  -- ------------------------------------------------------------------
  insert into client_requests (agency_id, reference, kind, visa_type_id, destination, travel_date,
                               first_name, last_name, phone, locale, note, phone_verified, status, received_at)
  values
    (a_tca,'DEM-2026-0061','visa',(select id from visa_types where agency_id=a_tca limit 1),'France',(current_date+62),'Meriem','Ayari','+216 24 551 908','fr','Voyage de noces, deux personnes.',true,'nouvelle',now()-interval '4 hours'),
    (a_tca,'DEM-2026-0062','visa',(select id from visa_types where agency_id=a_tca limit 1),'Italie',(current_date+41),'Bilel','Khelifi','+216 55 210 447','fr','Salon professionnel à Milan.',true,'nouvelle',now()-interval '1 day'),
    (a_tca,'DEM-2026-0063','visa',null,'France',(current_date+95),'Abdelbasset','Al Werfalli','+218 91 447 2210','ar','مقيم في طرابلس، أرغب في تقديم الملف من تونس.',false,'qualifiee',now()-interval '2 days'),
    (a_tca,'DEM-2026-0064','fret',null,null,null,'Sofiene','Nasri','+216 98 774 120','fr',null,true,'nouvelle',now()-interval '3 days');
  update client_requests set goods='Deux palettes de luminaires depuis Yiwu.', origin_city='Yiwu'
   where agency_id=a_tca and kind='fret';

  -- ==================================================================
  -- AGENCE 2 · Sahara Voyages. Elle n'existe que pour être invisible.
  -- ==================================================================
  -- Une seule agence ne prouve rien : l'étanchéité ne se démontre que s'il
  -- y a quelque chose de l'autre côté du mur à tenter d'attraper.
  insert into agencies (slug, name, legal_name, country, mark, accent, email, phone,
                        locales, default_locale, currency, services, plan, setup_done, created_at)
  values ('sahara','Sahara Voyages','Sahara Voyages SARL','Tunisie','SV','#B04503',
          'contact@sahara-voyages.test','+216 74 220 110','{fr,ar}','fr','TND','{visas}','standard','{offices,team}', now() - interval '200 days')
  returning id into a_sah;

  insert into offices (agency_id, name, city, country, country_code, phone, address, timezone)
  values (a_sah,'Sfax','Sfax','Tunisie','TN','+216 74 220 110','Avenue Habib Bourguiba','Africa/Tunis')
  returning id into o_sfax;

  insert into profiles (id, agency_id, office_id, name, email, phone, role, locale) values
    ('{{SAH_OWNER}}', a_sah, o_sfax, 'Rania Jlassi', 'rania@sahara-voyages.test', '+216 98 200 001', 'owner', 'fr'),
    ('{{SAH_AGENT}}', a_sah, o_sfax, 'Anis Gharbi',  'anis@sahara-voyages.test',  '+216 98 200 002', 'agent', 'fr');

  perform seed_catalogue(a_sah, '{visas}');
  select id into ck2 from checklists where agency_id=a_sah limit 1;
  select id into vt2 from visa_types where agency_id=a_sah limit 1;
  select id into ag2 from profiles where agency_id=a_sah and role='agent';

  insert into consulates (agency_id, country_code, country, city, centre, fee_consulate, ref_year, ref_refusal_rate)
  values (a_sah,'FR','{"fr":"France"}','Sfax','tls_sfax',300,2025,18.9)
  returning id into cs_fr2;

  for i in 1..8 loop
    insert into clients (agency_id, office_id, first_name, last_name, phone, nationality,
                         passport_number, professional_status, created_at)
    values (a_sah, o_sfax,
            (array['Tarek','Nesrine','Anis','Olfa','Wassim','Emna','Ali','Hela'])[i],
            (array['Chaabane','Hammami','Ferchichi','Nasri','Ayari','Khelifi','Gharbi','Jlassi'])[i],
            '+216 ' || (70 + i) || ' ' || lpad((300 + i * 11)::text,3,'0') || ' ' || lpad((400 + i * 13)::text,3,'0'),
            'Tunisienne', 'S' || lpad((700000 + i * 911)::text, 6, '0'),
            (array['salarie','independant','etudiant','retraite'])[1 + (i % 4)],
            now() - ((20 + i * 9) || ' days')::interval)
    returning id into cid;

    insert into cases (agency_id, reference, client_id, visa_type_id, office_id, assignee_id,
                       stage, status, priority, source, opened_at, updated_at, travel_date,
                       consulate_id, track, amount_total, amount_paid, currency)
    values (a_sah, 'SV-2026-' || lpad((10 + i)::text,4,'0'), cid, vt2, o_sfax, ag2,
            (array['pieces','verification','rendez_vous','depot','consulat','retrait','clos','clos'])[i],
            case when i >= 7 then 'accepte' else 'ouvert' end,
            'normale', 'comptoir',
            now() - ((10 + i * 5) || ' days')::interval, now() - ((i) || ' days')::interval,
            (current_date + ((20 + i * 4) || ' days')::interval)::date,
            cs_fr2, 'primo', 640, case when i >= 5 then 640 else 320 end, 'TND');
  end loop;

  raise notice 'TCA : % cargaisons, % demandes · Sahara : % clients, % dossiers',
    (select count(*) from shipments where agency_id=a_tca),
    (select count(*) from client_requests where agency_id=a_tca),
    (select count(*) from clients where agency_id=a_sah),
    (select count(*) from cases where agency_id=a_sah);
end $$;
