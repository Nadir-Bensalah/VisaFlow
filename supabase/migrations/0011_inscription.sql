-- 0011 · L'inscription d'une agence, et le jeton qui porte ses droits.

-- ------------------------------------------------------------------
-- Le hook de jeton d'accès
-- ------------------------------------------------------------------
-- À déclarer dans Supabase : Auth > Hooks > Custom Access Token.
-- Il pose l'agence, le rôle et le bureau dans le jeton. Toutes les politiques
-- deviennent alors des comparaisons constantes, sans lecture de table.

create or replace function custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare claims jsonb; p profiles;
begin
  claims := coalesce(event -> 'claims', '{}'::jsonb);
  select * into p from profiles where id = (event ->> 'user_id')::uuid;
  if p.id is not null then
    claims := claims
      || jsonb_build_object('agency_id', p.agency_id)
      || jsonb_build_object('agency_role', p.role)
      || jsonb_build_object('office_id', coalesce(p.office_id::text, ''));
  end if;
  return jsonb_set(event, '{claims}', claims);
end $$;

grant execute on function custom_access_token_hook to supabase_auth_admin;

-- ------------------------------------------------------------------
-- Le catalogue de départ
-- ------------------------------------------------------------------
-- Une agence qui s'inscrit ne doit pas trouver un outil vide. C'est la
-- différence entre un logiciel qu'on essaie et un logiciel qu'on abandonne le
-- premier soir.

create or replace function seed_catalogue(p_agency uuid, p_services text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  cl_chine uuid; cl_schengen uuid; cl_maroc uuid;
begin
  -- Les étapes du métier
  insert into stage_definitions (agency_id, domain, key, label, position, terminal)
  select p_agency, 'visa', k, l::jsonb, p, term from (values
    ('nouveau',     '{"fr":"Nouveau","en":"New","ar":"جديد","zh":"新建"}', 1, false),
    ('pieces',      '{"fr":"Pièces à réunir","en":"Collecting documents","ar":"جمع الوثائق","zh":"收集材料"}', 2, false),
    ('verification','{"fr":"Vérification","en":"Review","ar":"المراجعة","zh":"审核"}', 3, false),
    ('rendez_vous', '{"fr":"Rendez-vous","en":"Appointment","ar":"الموعد","zh":"预约"}', 4, false),
    ('depot',       '{"fr":"Dépôt","en":"Submission","ar":"الإيداع","zh":"递交"}', 5, false),
    ('consulat',    '{"fr":"Au consulat","en":"At the consulate","ar":"لدى القنصلية","zh":"领事馆处理"}', 6, false),
    ('decision',    '{"fr":"Décision","en":"Decision","ar":"القرار","zh":"出结果"}', 7, false),
    ('retrait',     '{"fr":"À retirer","en":"Ready for pickup","ar":"جاهز للاستلام","zh":"待领取"}', 8, false),
    ('clos',        '{"fr":"Clos","en":"Closed","ar":"مغلق","zh":"已结案"}', 9, true)
  ) as s(k, l, p, term)
  where 'visas' = any (p_services)
  on conflict do nothing;

  insert into stage_definitions (agency_id, domain, key, label, position, terminal)
  select p_agency, 'fret', k, l::jsonb, p, term from (values
    ('demande',   '{"fr":"Demande reçue","en":"Request received","ar":"استلام الطلب","zh":"收到委托"}', 1, false),
    ('ramassage', '{"fr":"Ramassage","en":"Pickup","ar":"السحب","zh":"提货"}', 2, false),
    ('entrepot',  '{"fr":"Entrepôt","en":"Warehouse","ar":"المستودع","zh":"仓库"}', 3, false),
    ('empotage',  '{"fr":"Empotage","en":"Loading","ar":"التحميل","zh":"装柜"}', 4, false),
    ('depart',    '{"fr":"Départ du port","en":"Departed port","ar":"مغادرة الميناء","zh":"已开船"}', 5, false),
    ('transit',   '{"fr":"En transit","en":"In transit","ar":"في الطريق","zh":"在途"}', 6, false),
    ('arrivee',   '{"fr":"Arrivé au port","en":"Arrived","ar":"الوصول","zh":"已到港"}', 7, false),
    ('douane',    '{"fr":"Dédouanement","en":"Customs","ar":"التخليص","zh":"清关"}', 8, false),
    ('livraison', '{"fr":"En livraison","en":"Out for delivery","ar":"قيد التسليم","zh":"派送中"}', 9, false),
    ('livre',     '{"fr":"Livré","en":"Delivered","ar":"تم التسليم","zh":"已签收"}', 10, true)
  ) as s(k, l, p, term)
  where 'fret' = any (p_services)
  on conflict do nothing;

  if 'visas' = any (p_services) then
    -- Chine, visa affaires
    insert into checklists (agency_id, name)
    values (p_agency, '{"fr":"Chine, visa affaires","en":"China, business visa","ar":"الصين، تأشيرة أعمال","zh":"中国商务签证"}')
    returning id into cl_chine;
    insert into checklist_versions (checklist_id, agency_id, version, items) values (cl_chine, p_agency, 1, '[
      {"key":"passeport","required":true,"label":{"fr":"Passeport valable 6 mois","en":"Passport valid 6 months","ar":"جواز سفر صالح 6 أشهر","zh":"护照（有效期6个月以上）"},"help":{"fr":"Deux pages vierges face à face."}},
      {"key":"photo","required":true,"label":{"fr":"Photo 33 x 48 mm, fond blanc","en":"Photo 33 x 48 mm","ar":"صورة 33×48 مم","zh":"白底照片"}},
      {"key":"formulaire","required":true,"label":{"fr":"Formulaire COVA signé","en":"Signed COVA form","ar":"استمارة COVA","zh":"COVA 表格"}},
      {"key":"invitation","required":true,"label":{"fr":"Lettre d’invitation chinoise","en":"Chinese invitation letter","ar":"رسالة دعوة","zh":"中方邀请函"},"help":{"fr":"Cachet de l’entreprise chinoise obligatoire."}},
      {"key":"registre","required":true,"validity_days":90,"label":{"fr":"Registre de commerce","en":"Trade register","ar":"السجل التجاري","zh":"营业执照"}},
      {"key":"billet","required":true,"label":{"fr":"Réservation de vol","en":"Flight booking","ar":"حجز الطيران","zh":"机票预订单"}},
      {"key":"hotel","required":true,"label":{"fr":"Réservation d’hôtel","en":"Hotel booking","ar":"حجز الفندق","zh":"酒店预订单"}},
      {"key":"banque","required":true,"validity_days":90,"label":{"fr":"Relevé bancaire, 3 derniers mois","en":"Bank statement","ar":"كشف حساب بنكي","zh":"近三个月银行流水"}}
    ]');

    insert into checklists (agency_id, name)
    values (p_agency, '{"fr":"Schengen, tourisme","en":"Schengen, tourism","ar":"شنغن، سياحة","zh":"申根旅游签证"}')
    returning id into cl_schengen;
    insert into checklist_versions (checklist_id, agency_id, version, items) values (cl_schengen, p_agency, 1, '[
      {"key":"passeport","required":true,"label":{"fr":"Passeport valable 3 mois après le retour","en":"Passport valid 3 months after return","ar":"جواز سفر صالح","zh":"护照"}},
      {"key":"photo","required":true,"label":{"fr":"Photo 35 x 45 mm","en":"Photo 35 x 45 mm","ar":"صورة 35×45 مم","zh":"照片"}},
      {"key":"formulaire","required":true,"label":{"fr":"Formulaire Schengen signé","en":"Signed Schengen form","ar":"استمارة شنغن","zh":"申根表格"}},
      {"key":"assurance","required":true,"label":{"fr":"Assurance 30 000 €","en":"Insurance 30,000 EUR","ar":"تأمين 30 ألف أورو","zh":"3万欧元保险"}},
      {"key":"hebergement","required":true,"label":{"fr":"Hébergement ou attestation d’accueil","en":"Accommodation","ar":"الإقامة","zh":"住宿证明"}},
      {"key":"billet","required":true,"label":{"fr":"Réservation aller-retour","en":"Return flight","ar":"حجز ذهاب وإياب","zh":"往返机票"}},
      {"key":"banque","required":true,"validity_days":90,"label":{"fr":"Relevé bancaire, 3 derniers mois","en":"Bank statement","ar":"كشف حساب","zh":"银行流水"}},
      {"key":"travail","required":true,"validity_days":90,"label":{"fr":"Attestation de travail","en":"Employment certificate","ar":"شهادة عمل","zh":"在职证明"}}
    ]');

    insert into checklists (agency_id, name)
    values (p_agency, '{"fr":"Maroc","en":"Morocco","ar":"المغرب","zh":"摩洛哥"}')
    returning id into cl_maroc;
    insert into checklist_versions (checklist_id, agency_id, version, items) values (cl_maroc, p_agency, 1, '[
      {"key":"passeport","required":true,"label":{"fr":"Passeport valable 6 mois","en":"Passport valid 6 months","ar":"جواز سفر","zh":"护照"}},
      {"key":"photo","required":true,"label":{"fr":"Deux photos d’identité","en":"Two ID photos","ar":"صورتان","zh":"两张证件照"}},
      {"key":"formulaire","required":true,"label":{"fr":"Formulaire de demande","en":"Application form","ar":"استمارة الطلب","zh":"申请表"}},
      {"key":"billet","required":true,"label":{"fr":"Réservation de vol","en":"Flight booking","ar":"حجز الطيران","zh":"机票"}},
      {"key":"hotel","required":true,"label":{"fr":"Réservation d’hôtel","en":"Hotel booking","ar":"حجز الفندق","zh":"酒店"}}
    ]');

    insert into visa_types (agency_id, country_code, country, label, category, processing_days, fee_agency, fee_consulate, checklist_id)
    values
      (p_agency, 'CN', '{"fr":"Chine","en":"China","ar":"الصين","zh":"中国"}', '{"fr":"Affaires 48 h","en":"Business 48h","ar":"أعمال 48 ساعة","zh":"商务48小时"}', 'affaires', 3, 420, 260, cl_chine),
      (p_agency, 'CN', '{"fr":"Chine","en":"China","ar":"الصين","zh":"中国"}', '{"fr":"Foire de Canton","en":"Canton Fair","ar":"معرض كانتون","zh":"广交会"}', 'affaires', 6, 1450, 260, cl_chine),
      (p_agency, 'FR', '{"fr":"France","en":"France","ar":"فرنسا","zh":"法国"}', '{"fr":"Schengen tourisme","en":"Schengen tourism","ar":"شنغن سياحة","zh":"申根旅游"}', 'tourisme', 18, 340, 300, cl_schengen),
      (p_agency, 'MA', '{"fr":"Maroc","en":"Morocco","ar":"المغرب","zh":"摩洛哥"}', '{"fr":"Court séjour","en":"Short stay","ar":"إقامة قصيرة","zh":"短期停留"}', 'tourisme', 10, 220, 120, cl_maroc);
  end if;

  -- Les modèles de message, dans les quatre langues
  insert into message_templates (agency_id, key, name, channel, body, variables, category) values
    (p_agency, 'piece_manquante', '{"fr":"Pièce manquante"}', 'whatsapp',
     '{"fr":"Bonjour {client}, pour votre dossier {reference} il nous manque encore : {piece}. Vous pouvez la photographier et nous l’envoyer ici. Merci.",
       "en":"Hello {client}, for your application {reference} we are still missing: {piece}.",
       "ar":"مرحبا {client}، بخصوص ملفكم {reference} ما زالت تنقصنا: {piece}.",
       "zh":"{client} 您好，您的申请 {reference} 还缺少：{piece}。"}',
     '{client,reference,piece}', 'utility'),
    (p_agency, 'rappel_rdv', '{"fr":"Rappel de rendez-vous"}', 'whatsapp',
     '{"fr":"Bonjour {client}, rappel de votre rendez-vous le {date} à {lieu}. Venez avec votre passeport original.",
       "en":"Hello {client}, reminder of your appointment on {date} at {lieu}.",
       "ar":"مرحبا {client}، تذكير بموعدكم يوم {date} في {lieu}.",
       "zh":"{client} 您好，提醒您 {date} 在 {lieu} 有预约。"}',
     '{client,date,lieu}', 'utility'),
    (p_agency, 'dossier_depose', '{"fr":"Dossier déposé"}', 'whatsapp',
     '{"fr":"Bonjour {client}, votre dossier {reference} a été déposé au consulat de {pays}.",
       "en":"Hello {client}, your application {reference} has been submitted.",
       "ar":"مرحبا {client}، تم إيداع ملفكم {reference}.",
       "zh":"{client} 您好，您的申请 {reference} 已递交。"}',
     '{client,reference,pays}', 'utility'),
    (p_agency, 'passeport_pret', '{"fr":"Passeport à retirer"}', 'whatsapp',
     '{"fr":"Bonne nouvelle {client}, votre passeport est disponible au bureau de {bureau}.",
       "en":"Good news {client}, your passport is available at our {bureau} office.",
       "ar":"خبر سار {client}، جواز سفركم متوفر بمكتب {bureau}.",
       "zh":"{client}，好消息，您的护照已到 {bureau}。"}',
     '{client,bureau}', 'utility'),
    (p_agency, 'code_suivi', '{"fr":"Code de suivi"}', 'whatsapp',
     '{"fr":"Votre code est {code}. Il expire dans dix minutes.",
       "en":"Your code is {code}. It expires in ten minutes.",
       "ar":"رمزك هو {code}. ينتهي بعد عشر دقائق.",
       "zh":"你的验证码是 {code}，十分钟内有效。"}',
     '{code}', 'authentication')
  on conflict do nothing;

  -- Les relances, prêtes à activer
  insert into automation_rules (agency_id, name, trigger, action, active, cooldown_hours) values
    (p_agency, '{"fr":"Relancer une pièce oubliée"}', '{"type":"piece_manquante_depuis","days":3}', '{"type":"message_client","templateKey":"piece_manquante","channel":"whatsapp"}', true, 48),
    (p_agency, '{"fr":"Rappeler le rendez-vous la veille"}', '{"type":"rendez_vous_dans","days":1}', '{"type":"message_client","templateKey":"rappel_rdv","channel":"whatsapp"}', true, 24),
    (p_agency, '{"fr":"Alerter sur un passeport trop court"}', '{"type":"passeport_expire_dans","days":180}', '{"type":"alerte_interne"}', true, 168),
    (p_agency, '{"fr":"Réveiller un dossier endormi"}', '{"type":"dossier_sans_activite","days":7}', '{"type":"tache_agent"}', true, 72),
    (p_agency, '{"fr":"Prévenir dès le dépôt au consulat"}', '{"type":"etape_atteinte","stage":"consulat"}', '{"type":"message_client","templateKey":"dossier_depose","channel":"whatsapp"}', true, 0),
    (p_agency, '{"fr":"Annoncer le passeport prêt"}', '{"type":"etape_atteinte","stage":"retrait"}', '{"type":"message_client","templateKey":"passeport_pret","channel":"whatsapp"}', true, 0)
  on conflict do nothing;

  insert into retention_policies (agency_id) values (p_agency) on conflict do nothing;
end $$;

-- ------------------------------------------------------------------
-- Inscrire une agence
-- ------------------------------------------------------------------

create or replace function provision_agency(
  p_name text, p_slug text, p_country text, p_services text[],
  p_owner_name text, p_owner_email text, p_owner_phone text, p_locale text
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare a agencies; o offices; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'compte requis'; end if;
  if exists (select 1 from profiles where id = uid) then
    raise exception 'ce compte appartient déjà à une agence';
  end if;
  if p_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    raise exception 'adresse invalide';
  end if;
  if p_slug in ('www','app','admin','api','visaflow','aide','support','compte','status','cdn','mail','blog','ambassade','consulat') then
    raise exception 'adresse réservée';
  end if;

  insert into agencies (slug, name, legal_name, country, services, default_locale, currency, trial_ends_at, email, phone)
  values (p_slug, p_name, p_name, p_country, p_services, coalesce(p_locale, 'fr'),
          case p_country when 'Libye' then 'LYD' else 'TND' end,
          now() + interval '15 days', p_owner_email, p_owner_phone)
  returning * into a;

  insert into offices (agency_id, name, country, country_code, phone)
  values (a.id, split_part(p_name, ' ', 1), p_country,
          case p_country when 'Libye' then 'LY' when 'Chine' then 'CN' else 'TN' end,
          p_owner_phone)
  returning * into o;

  insert into profiles (id, agency_id, office_id, name, email, phone, role, locale)
  values (uid, a.id, o.id, p_owner_name, p_owner_email, p_owner_phone, 'owner', coalesce(p_locale, 'fr'));

  perform seed_catalogue(a.id, p_services);

  insert into activity_events (agency_id, actor_id, type, detail)
  values (a.id, uid, 'agence_creee', jsonb_build_object('fr', 'Agence ouverte : ' || p_name));

  return jsonb_build_object('agency_id', a.id, 'slug', a.slug, 'office_id', o.id);
end $$;

-- Une adresse libre, sans révéler la liste des agences.
create or replace function slug_available(p_slug text) returns boolean
language sql security definer stable set search_path = public as $$
  select p_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
     and p_slug not in ('www','app','admin','api','visaflow','aide','support','compte','status','cdn','mail','blog','ambassade','consulat')
     and not exists (select 1 from agencies where slug = p_slug)
$$;

grant execute on function provision_agency to authenticated;
grant execute on function slug_available to anon, authenticated;
grant execute on function portal_case, portal_shipment, portal_submit_request to anon;
