-- 0065 · Les référentiels et les gardes de l'ouverture d'une agence.
--
-- L'écran de création d'agence était une modale à cinq champs. Le nom passait
-- sans le moindre contrôle, le sous-domaine se tapait à l'aveugle, le pays se
-- choisissait entre DEUX valeurs en dur, la ville était un champ libre,
-- l'adresse n'était même pas demandée, et le téléphone se saisissait sans
-- indicatif. Ouvrir une agence est pourtant l'acte le plus sérieux du produit :
-- il crée un locataire, un bureau, un catalogue et un compte propriétaire, et
-- rien de tout cela ne se défait d'un clic.
--
-- Cette migration pose ce qui manquait, dans l'ordre :
--   1. Les pays : tous, avec l'indicatif téléphonique et le drapeau.
--   2. Les villes : la Tunisie et la Libye complètes, les capitales ailleurs.
--   3. Les gardes de l'ouverture : nom, sous-domaine, courriel, téléphone.
--   4. L'adresse, qui n'existait nulle part.
--
-- CE QUI N'A PAS ÉTÉ INVENTÉ est relevé en section 7, ligne par ligne. Un
-- indicatif faux, c'est un client qu'on n'appelle jamais. Une ville inventée,
-- c'est un bureau qui n'existe pas. Ce que je ne sais pas reste NULL.

-- ==================================================================
-- 0 · Les outils de comparaison
-- ==================================================================
--
-- pg_trgm est déjà installé par la 0052, mais PAS dans le même schéma partout :
-- `extensions` en local, `public` en production. Une fonction figée sur
-- `set search_path = public` ne trouverait donc pas `similarity()` en local, et
-- l'erreur ne se voit qu'à l'appel. Toutes les fonctions qui comparent portent
-- donc `search_path = public, extensions` : un schéma absent du chemin est
-- ignoré sans erreur, la même définition marche des deux côtés.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    if exists (select 1 from pg_namespace where nspname = 'extensions') then
      execute 'create extension pg_trgm with schema extensions';
    else
      execute 'create extension pg_trgm';
    end if;
  end if;
end $$;

-- Retirer les accents SANS l'extension `unaccent`, et voici pourquoi :
-- `unaccent()` n'est pas IMMUTABLE (elle lit un dictionnaire sur disque), donc
-- elle ne peut pas entrer dans un index. Une recherche de ville qui ne peut pas
-- s'indexer devient un balayage complet à chaque frappe. `translate` est
-- immuable, déterministe, et couvre le latin dont on a besoin : le français,
-- l'italien, l'espagnol, l'allemand et les translittérations d'arabe.
create or replace function text_sans_accents(p_texte text)
returns text
language sql immutable
set search_path = public
as $$
  select translate(
    coalesce(p_texte, ''),
    'àáâãäåāăąÀÁÂÃÄÅĀĂĄèéêëēĕėęěÈÉÊËĒĔĖĘĚìíîïĩīĭįÌÍÎÏĨĪĬĮòóôõöøōŏőÒÓÔÕÖØŌŎŐùúûüũūŭůÙÚÛÜŨŪŬŮçćĉċčÇĆĈĊČñńņňÑŃŅŇýÿŷÝŸŶšśŝşŠŚŜŞžźżŽŹŻğĝĜĞđďĐĎłŁ',
    'aaaaaaaaaAAAAAAAAAeeeeeeeeeEEEEEEEEEiiiiiiiiIIIIIIIIoooooooooOOOOOOOOOuuuuuuuuUUUUUUUUcccccCCCCCnnnnNNNNyyyYYYssssSSSSzzzZZZggGGddDDlL')
$$;

comment on function text_sans_accents(text) is
  'Retire les accents latins, sans l''extension `unaccent`. La raison est technique : `unaccent()` n''est pas IMMUTABLE, elle ne peut donc pas entrer dans un index, et une recherche de ville non indexée balaie la table à chaque frappe.';

-- La forme comparable d'un nom : minuscules, sans accents, sans ponctuation,
-- espaces réduits. C'est elle qui décide si « Voyages Ben Ali » et
-- « VOYAGES  BEN-ALI » sont le même nom. Le résultat n'est JAMAIS stocké à la
-- place du nom : on garde ce que l'agence a écrit, on compare à côté.
create or replace function nom_comparable(p_nom text)
returns text
language sql immutable
set search_path = public
as $$
  select trim(regexp_replace(
           regexp_replace(lower(text_sans_accents(coalesce(p_nom, ''))), '[^a-z0-9]+', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

comment on function nom_comparable(text) is
  'Forme normalisée d''un nom d''agence, pour la comparaison seulement. Le nom d''origine n''est jamais remplacé : « Sté Ben Ali & Fils » reste tel quel sur les factures.';

-- ==================================================================
-- 1 · Les pays : tous, avec l'indicatif et le drapeau
-- ==================================================================
--
-- La table `countries` EXISTE depuis la 0047 avec 45 pays, ceux du fret. On
-- l'étend, on ne la refait pas : `transport_locations`, les fournisseurs et les
-- destinataires écrivent déjà des codes qui pointent dessus par convention.
--
-- Trois colonnes s'ajoutent :
--   · `phone_code` : l'indicatif, sous la forme « +216 ».
--   · `emoji` : le drapeau.
--   · `priority` : ce qui remonte en tête de la liste déroulante.

alter table countries add column if not exists phone_code text
  check (phone_code is null or phone_code ~ '^\+[0-9]{1,4}$');
alter table countries add column if not exists emoji text;
alter table countries add column if not exists priority int not null default 100;

comment on column countries.phone_code is
  'Indicatif téléphonique international, forme « +216 ». NULL quand je n''en suis pas certain, et c''est volontaire : un indicatif faux, c''est un client qu''on n''appelle jamais. Le relevé des NULL est en section 7.';
comment on column countries.priority is
  'Ce qui remonte en tête de la liste : 1 pour la Tunisie, 10 pour les Émirats, 100 pour le reste. Un agent tunisien ne doit pas faire défiler 190 pays pour trouver son propre pays.';

-- ------------------------------------------------------------------
-- 1.1 · Le drapeau se CALCULE, il ne se saisit pas
-- ------------------------------------------------------------------
--
-- Un drapeau Unicode n'est pas une image : c'est la paire d'indicateurs
-- régionaux du code ISO 3166-1 alpha-2. « TN » donne U+1F1F9 U+1F1F3, et le
-- système d'exploitation dessine le drapeau tunisien. La lettre A vaut
-- U+1F1E6, soit 127462 en décimal, et on avance d'une unité par lettre.
--
-- Le calcul est écrit UNE fois ici, puis le résultat est STOCKÉ dans `emoji` :
-- le front ne recalcule rien, et une liste de 198 pays ne fait pas 396 appels
-- de fonction à chaque ouverture du sélecteur. Saisir 198 drapeaux à la main
-- aurait été 198 occasions de se tromper.
create or replace function flag_emoji(p_iso2 text)
returns text
language sql immutable
set search_path = public
as $$
  select case
    when p_iso2 is null or upper(p_iso2) !~ '^[A-Z]{2}$' then null
    else chr(127462 + ascii(substr(upper(p_iso2), 1, 1)) - 65)
      || chr(127462 + ascii(substr(upper(p_iso2), 2, 1)) - 65)
  end
$$;

comment on function flag_emoji(text) is
  'Le drapeau d''un pays, dérivé de son code ISO 3166-1 alpha-2. Ce n''est pas une image : ce sont les deux indicateurs régionaux Unicode, que le système dessine. Rend NULL sur un code qui n''est pas deux lettres, plutôt qu''une paire de caractères absurde.';

-- ------------------------------------------------------------------
-- 1.2 · Les 198 pays
-- ------------------------------------------------------------------
--
-- Codes ISO 3166-1 alpha-2 et alpha-3, nom français, anglais et arabe. Les
-- noms arabes sont les noms usuels, pas des translittérations.
--
-- LES INDICATIFS : 186 posés, 12 laissés vides. Les douze vides sont les onze
-- pays et territoires du plan de numérotation nord-américain (Antigua-et-
-- Barbuda, Bahamas, Barbade, Dominique, République dominicaine, Grenade,
-- Jamaïque, Saint-Christophe-et-Niévès, Sainte-Lucie, Saint-Vincent-et-les-
-- Grenadines, Trinité-et-Tobago) et le Vatican. Pour les onze premiers,
-- l'indicatif de pays est « +1 », partagé avec les États-Unis et le Canada :
-- « +1 » seul ne les distingue pas, et ce qui les distingue est un préfixe
-- régional à trois chiffres que je n'écrirai pas de mémoire. Le Vatican a
-- « +379 » assigné mais non exploité, ses numéros sont italiens en pratique.
-- Un champ vide se remplit ; un indicatif faux fait composer un numéro qui ne
-- sonne nulle part.
--
-- L'insertion écrase les noms des 45 pays déjà semés par la 0047 : ce sont les
-- mêmes, écrits pareil. Elle ne touche PAS `active`, qui appartient à
-- l'exploitation.

insert into countries (iso2, iso3, name_fr, name_en, name_ar, phone_code) values
  -- Afrique
  ('DZ','DZA','Algérie','Algeria','الجزائر','+213'),
  ('AO','AGO','Angola','Angola','أنغولا','+244'),
  ('BJ','BEN','Bénin','Benin','بنين','+229'),
  ('BW','BWA','Botswana','Botswana','بوتسوانا','+267'),
  ('BF','BFA','Burkina Faso','Burkina Faso','بوركينا فاسو','+226'),
  ('BI','BDI','Burundi','Burundi','بوروندي','+257'),
  ('CM','CMR','Cameroun','Cameroon','الكاميرون','+237'),
  ('CV','CPV','Cap-Vert','Cabo Verde','الرأس الأخضر','+238'),
  ('CF','CAF','République centrafricaine','Central African Republic','جمهورية أفريقيا الوسطى','+236'),
  ('TD','TCD','Tchad','Chad','تشاد','+235'),
  ('KM','COM','Comores','Comoros','جزر القمر','+269'),
  ('CG','COG','Congo','Congo','الكونغو','+242'),
  ('CD','COD','République démocratique du Congo','DR Congo','جمهورية الكونغو الديمقراطية','+243'),
  ('DJ','DJI','Djibouti','Djibouti','جيبوتي','+253'),
  ('EG','EGY','Égypte','Egypt','مصر','+20'),
  ('GQ','GNQ','Guinée équatoriale','Equatorial Guinea','غينيا الاستوائية','+240'),
  ('ER','ERI','Érythrée','Eritrea','إريتريا','+291'),
  ('SZ','SWZ','Eswatini','Eswatini','إسواتيني','+268'),
  ('ET','ETH','Éthiopie','Ethiopia','إثيوبيا','+251'),
  ('GA','GAB','Gabon','Gabon','الغابون','+241'),
  ('GM','GMB','Gambie','Gambia','غامبيا','+220'),
  ('GH','GHA','Ghana','Ghana','غانا','+233'),
  ('GN','GIN','Guinée','Guinea','غينيا','+224'),
  ('GW','GNB','Guinée-Bissau','Guinea-Bissau','غينيا بيساو','+245'),
  ('CI','CIV','Côte d''Ivoire','Côte d''Ivoire','ساحل العاج','+225'),
  ('KE','KEN','Kenya','Kenya','كينيا','+254'),
  ('LS','LSO','Lesotho','Lesotho','ليسوتو','+266'),
  ('LR','LBR','Liberia','Liberia','ليبيريا','+231'),
  ('LY','LBY','Libye','Libya','ليبيا','+218'),
  ('MG','MDG','Madagascar','Madagascar','مدغشقر','+261'),
  ('MW','MWI','Malawi','Malawi','مالاوي','+265'),
  ('ML','MLI','Mali','Mali','مالي','+223'),
  ('MR','MRT','Mauritanie','Mauritania','موريتانيا','+222'),
  ('MU','MUS','Maurice','Mauritius','موريشيوس','+230'),
  ('MA','MAR','Maroc','Morocco','المغرب','+212'),
  ('MZ','MOZ','Mozambique','Mozambique','موزمبيق','+258'),
  ('NA','NAM','Namibie','Namibia','ناميبيا','+264'),
  ('NE','NER','Niger','Niger','النيجر','+227'),
  ('NG','NGA','Nigeria','Nigeria','نيجيريا','+234'),
  ('RW','RWA','Rwanda','Rwanda','رواندا','+250'),
  ('ST','STP','Sao Tomé-et-Principe','São Tomé and Príncipe','ساو تومي وبرينسيبي','+239'),
  ('SN','SEN','Sénégal','Senegal','السنغال','+221'),
  ('SC','SYC','Seychelles','Seychelles','سيشل','+248'),
  ('SL','SLE','Sierra Leone','Sierra Leone','سيراليون','+232'),
  ('SO','SOM','Somalie','Somalia','الصومال','+252'),
  ('ZA','ZAF','Afrique du Sud','South Africa','جنوب أفريقيا','+27'),
  ('SS','SSD','Soudan du Sud','South Sudan','جنوب السودان','+211'),
  ('SD','SDN','Soudan','Sudan','السودان','+249'),
  ('TZ','TZA','Tanzanie','Tanzania','تنزانيا','+255'),
  ('TG','TGO','Togo','Togo','توغو','+228'),
  ('TN','TUN','Tunisie','Tunisia','تونس','+216'),
  ('UG','UGA','Ouganda','Uganda','أوغندا','+256'),
  ('ZM','ZMB','Zambie','Zambia','زامبيا','+260'),
  ('ZW','ZWE','Zimbabwe','Zimbabwe','زيمبابوي','+263'),
  -- Asie
  ('AF','AFG','Afghanistan','Afghanistan','أفغانستان','+93'),
  ('AM','ARM','Arménie','Armenia','أرمينيا','+374'),
  ('AZ','AZE','Azerbaïdjan','Azerbaijan','أذربيجان','+994'),
  ('BH','BHR','Bahreïn','Bahrain','البحرين','+973'),
  ('BD','BGD','Bangladesh','Bangladesh','بنغلاديش','+880'),
  ('BT','BTN','Bhoutan','Bhutan','بوتان','+975'),
  ('BN','BRN','Brunei','Brunei','بروناي','+673'),
  ('KH','KHM','Cambodge','Cambodia','كمبوديا','+855'),
  ('CN','CHN','Chine','China','الصين','+86'),
  ('CY','CYP','Chypre','Cyprus','قبرص','+357'),
  ('GE','GEO','Géorgie','Georgia','جورجيا','+995'),
  ('HK','HKG','Hong Kong','Hong Kong','هونغ كونغ','+852'),
  ('IN','IND','Inde','India','الهند','+91'),
  ('ID','IDN','Indonésie','Indonesia','إندونيسيا','+62'),
  ('IR','IRN','Iran','Iran','إيران','+98'),
  ('IQ','IRQ','Irak','Iraq','العراق','+964'),
  ('IL','ISR','Israël','Israel','إسرائيل','+972'),
  ('JP','JPN','Japon','Japan','اليابان','+81'),
  ('JO','JOR','Jordanie','Jordan','الأردن','+962'),
  ('KZ','KAZ','Kazakhstan','Kazakhstan','كازاخستان','+7'),
  ('KW','KWT','Koweït','Kuwait','الكويت','+965'),
  ('KG','KGZ','Kirghizistan','Kyrgyzstan','قيرغيزستان','+996'),
  ('LA','LAO','Laos','Laos','لاوس','+856'),
  ('LB','LBN','Liban','Lebanon','لبنان','+961'),
  ('MO','MAC','Macao','Macao','ماكاو','+853'),
  ('MY','MYS','Malaisie','Malaysia','ماليزيا','+60'),
  ('MV','MDV','Maldives','Maldives','المالديف','+960'),
  ('MN','MNG','Mongolie','Mongolia','منغوليا','+976'),
  ('MM','MMR','Birmanie','Myanmar','ميانمار','+95'),
  ('NP','NPL','Népal','Nepal','نيبال','+977'),
  ('KP','PRK','Corée du Nord','North Korea','كوريا الشمالية','+850'),
  ('OM','OMN','Oman','Oman','عمان','+968'),
  ('PK','PAK','Pakistan','Pakistan','باكستان','+92'),
  ('PS','PSE','Palestine','Palestine','فلسطين','+970'),
  ('PH','PHL','Philippines','Philippines','الفلبين','+63'),
  ('QA','QAT','Qatar','Qatar','قطر','+974'),
  ('SA','SAU','Arabie saoudite','Saudi Arabia','المملكة العربية السعودية','+966'),
  ('SG','SGP','Singapour','Singapore','سنغافورة','+65'),
  ('KR','KOR','Corée du Sud','South Korea','كوريا الجنوبية','+82'),
  ('LK','LKA','Sri Lanka','Sri Lanka','سريلانكا','+94'),
  ('SY','SYR','Syrie','Syria','سوريا','+963'),
  ('TW','TWN','Taïwan','Taiwan','تايوان','+886'),
  ('TJ','TJK','Tadjikistan','Tajikistan','طاجيكستان','+992'),
  ('TH','THA','Thaïlande','Thailand','تايلاند','+66'),
  ('TL','TLS','Timor oriental','Timor-Leste','تيمور الشرقية','+670'),
  ('TR','TUR','Turquie','Türkiye','تركيا','+90'),
  ('TM','TKM','Turkménistan','Turkmenistan','تركمانستان','+993'),
  ('AE','ARE','Émirats arabes unis','United Arab Emirates','الإمارات العربية المتحدة','+971'),
  ('UZ','UZB','Ouzbékistan','Uzbekistan','أوزبكستان','+998'),
  ('VN','VNM','Viêt Nam','Vietnam','فيتنام','+84'),
  ('YE','YEM','Yémen','Yemen','اليمن','+967'),
  -- Europe
  ('AL','ALB','Albanie','Albania','ألبانيا','+355'),
  ('AD','AND','Andorre','Andorra','أندورا','+376'),
  ('AT','AUT','Autriche','Austria','النمسا','+43'),
  ('BY','BLR','Biélorussie','Belarus','بيلاروسيا','+375'),
  ('BE','BEL','Belgique','Belgium','بلجيكا','+32'),
  ('BA','BIH','Bosnie-Herzégovine','Bosnia and Herzegovina','البوسنة والهرسك','+387'),
  ('BG','BGR','Bulgarie','Bulgaria','بلغاريا','+359'),
  ('HR','HRV','Croatie','Croatia','كرواتيا','+385'),
  ('CZ','CZE','République tchèque','Czechia','التشيك','+420'),
  ('DK','DNK','Danemark','Denmark','الدنمارك','+45'),
  ('EE','EST','Estonie','Estonia','إستونيا','+372'),
  ('FI','FIN','Finlande','Finland','فنلندا','+358'),
  ('FR','FRA','France','France','فرنسا','+33'),
  ('DE','DEU','Allemagne','Germany','ألمانيا','+49'),
  ('GR','GRC','Grèce','Greece','اليونان','+30'),
  ('HU','HUN','Hongrie','Hungary','المجر','+36'),
  ('IS','ISL','Islande','Iceland','آيسلندا','+354'),
  ('IE','IRL','Irlande','Ireland','أيرلندا','+353'),
  ('IT','ITA','Italie','Italy','إيطاليا','+39'),
  ('LV','LVA','Lettonie','Latvia','لاتفيا','+371'),
  ('LI','LIE','Liechtenstein','Liechtenstein','ليختنشتاين','+423'),
  ('LT','LTU','Lituanie','Lithuania','ليتوانيا','+370'),
  ('LU','LUX','Luxembourg','Luxembourg','لوكسمبورغ','+352'),
  ('MT','MLT','Malte','Malta','مالطا','+356'),
  ('MD','MDA','Moldavie','Moldova','مولدوفا','+373'),
  ('MC','MCO','Monaco','Monaco','موناكو','+377'),
  ('ME','MNE','Monténégro','Montenegro','الجبل الأسود','+382'),
  ('NL','NLD','Pays-Bas','Netherlands','هولندا','+31'),
  ('MK','MKD','Macédoine du Nord','North Macedonia','مقدونيا الشمالية','+389'),
  ('NO','NOR','Norvège','Norway','النرويج','+47'),
  ('PL','POL','Pologne','Poland','بولندا','+48'),
  ('PT','PRT','Portugal','Portugal','البرتغال','+351'),
  ('RO','ROU','Roumanie','Romania','رومانيا','+40'),
  ('RU','RUS','Russie','Russia','روسيا','+7'),
  ('SM','SMR','Saint-Marin','San Marino','سان مارينو','+378'),
  ('RS','SRB','Serbie','Serbia','صربيا','+381'),
  ('SK','SVK','Slovaquie','Slovakia','سلوفاكيا','+421'),
  ('SI','SVN','Slovénie','Slovenia','سلوفينيا','+386'),
  ('ES','ESP','Espagne','Spain','إسبانيا','+34'),
  ('SE','SWE','Suède','Sweden','السويد','+46'),
  ('CH','CHE','Suisse','Switzerland','سويسرا','+41'),
  ('UA','UKR','Ukraine','Ukraine','أوكرانيا','+380'),
  ('GB','GBR','Royaume-Uni','United Kingdom','المملكة المتحدة','+44'),
  ('VA','VAT','Vatican','Vatican City','الفاتيكان',null),
  -- Amériques
  ('AG','ATG','Antigua-et-Barbuda','Antigua and Barbuda','أنتيغوا وبربودا',null),
  ('AR','ARG','Argentine','Argentina','الأرجنتين','+54'),
  ('BS','BHS','Bahamas','Bahamas','الباهاما',null),
  ('BB','BRB','Barbade','Barbados','بربادوس',null),
  ('BZ','BLZ','Belize','Belize','بليز','+501'),
  ('BO','BOL','Bolivie','Bolivia','بوليفيا','+591'),
  ('BR','BRA','Brésil','Brazil','البرازيل','+55'),
  ('CA','CAN','Canada','Canada','كندا','+1'),
  ('CL','CHL','Chili','Chile','تشيلي','+56'),
  ('CO','COL','Colombie','Colombia','كولومبيا','+57'),
  ('CR','CRI','Costa Rica','Costa Rica','كوستاريكا','+506'),
  ('CU','CUB','Cuba','Cuba','كوبا','+53'),
  ('DM','DMA','Dominique','Dominica','دومينيكا',null),
  ('DO','DOM','République dominicaine','Dominican Republic','جمهورية الدومينيكان',null),
  ('EC','ECU','Équateur','Ecuador','الإكوادور','+593'),
  ('SV','SLV','Salvador','El Salvador','السلفادور','+503'),
  ('GD','GRD','Grenade','Grenada','غرينادا',null),
  ('GT','GTM','Guatemala','Guatemala','غواتيمالا','+502'),
  ('GY','GUY','Guyana','Guyana','غيانا','+592'),
  ('HT','HTI','Haïti','Haiti','هايتي','+509'),
  ('HN','HND','Honduras','Honduras','هندوراس','+504'),
  ('JM','JAM','Jamaïque','Jamaica','جامايكا',null),
  ('MX','MEX','Mexique','Mexico','المكسيك','+52'),
  ('NI','NIC','Nicaragua','Nicaragua','نيكاراغوا','+505'),
  ('PA','PAN','Panama','Panama','بنما','+507'),
  ('PY','PRY','Paraguay','Paraguay','باراغواي','+595'),
  ('PE','PER','Pérou','Peru','بيرو','+51'),
  ('KN','KNA','Saint-Christophe-et-Niévès','Saint Kitts and Nevis','سانت كيتس ونيفيس',null),
  ('LC','LCA','Sainte-Lucie','Saint Lucia','سانت لوسيا',null),
  ('VC','VCT','Saint-Vincent-et-les-Grenadines','Saint Vincent and the Grenadines','سانت فنسنت والغرينادين',null),
  ('SR','SUR','Suriname','Suriname','سورينام','+597'),
  ('TT','TTO','Trinité-et-Tobago','Trinidad and Tobago','ترينيداد وتوباغو',null),
  ('US','USA','États-Unis','United States','الولايات المتحدة','+1'),
  ('UY','URY','Uruguay','Uruguay','أوروغواي','+598'),
  ('VE','VEN','Venezuela','Venezuela','فنزويلا','+58'),
  -- Océanie
  ('AU','AUS','Australie','Australia','أستراليا','+61'),
  ('FJ','FJI','Fidji','Fiji','فيجي','+679'),
  ('KI','KIR','Kiribati','Kiribati','كيريباتي','+686'),
  ('MH','MHL','Îles Marshall','Marshall Islands','جزر مارشال','+692'),
  ('FM','FSM','Micronésie','Micronesia','ميكرونيزيا','+691'),
  ('NR','NRU','Nauru','Nauru','ناورو','+674'),
  ('NZ','NZL','Nouvelle-Zélande','New Zealand','نيوزيلندا','+64'),
  ('PW','PLW','Palaos','Palau','بالاو','+680'),
  ('PG','PNG','Papouasie-Nouvelle-Guinée','Papua New Guinea','بابوا غينيا الجديدة','+675'),
  ('WS','WSM','Samoa','Samoa','ساموا','+685'),
  ('SB','SLB','Îles Salomon','Solomon Islands','جزر سليمان','+677'),
  ('TO','TON','Tonga','Tonga','تونغا','+676'),
  ('TV','TUV','Tuvalu','Tuvalu','توفالو','+688'),
  ('VU','VUT','Vanuatu','Vanuatu','فانواتو','+678')
on conflict (iso2) do update set
  iso3 = excluded.iso3, name_fr = excluded.name_fr,
  name_en = excluded.name_en, name_ar = excluded.name_ar,
  phone_code = excluded.phone_code;

-- Le drapeau, calculé une fois pour toutes. La colonne est remplie, pas
-- calculée à la lecture : 198 pays feraient 198 appels par ouverture du menu.
update countries set emoji = flag_emoji(iso2) where emoji is distinct from flag_emoji(iso2);

-- Les dix pays du métier remontent en tête. Le reste garde 100 et se range par
-- ordre alphabétique du nom français, ce que fait la vue plus bas.
update countries set priority = 100 where priority <> 100;
update countries set priority = v.p from (values
  ('TN',1),('LY',2),('DZ',3),('MA',4),('FR',5),
  ('IT',6),('DE',7),('TR',8),('CN',9),('AE',10)
) as v(c, p) where countries.iso2 = v.c;

create index if not exists countries_priority on countries (priority, name_fr) where active;

-- ==================================================================
-- 2 · Les villes
-- ==================================================================
--
-- « Ville du premier bureau » était un champ libre. Trois agences de Sfax
-- écrivaient « Sfax », « SFAX » et « sfax » : trois villes pour les
-- statistiques, une seule dans la vraie vie. Et un bureau à « Tunsi » ne se
-- retrouvait plus.
--
-- PAS D'API EXTERNE, ET C'EST UNE DÉCISION, PAS UN RACCOURCI. Le produit tourne
-- derrière une politique de sécurité de contenu stricte : chaque hôte tiers
-- doit y être déclaré, et un service d'autocomplétion d'adresse est une panne
-- de plus, une facture de plus, et une fuite de données de plus vers un tiers
-- que l'INPDP n'a pas vu. Toute la concurrence tunisienne fait exactement ça :
-- une liste de villes, et un champ d'adresse libre à côté. C'est suffisant.

create table if not exists cities (
  id           uuid primary key default gen_random_uuid(),
  -- Deux lettres, et une VRAIE clé étrangère cette fois. La différence avec
  -- `suppliers.country` de la 0047 est le sens : là-bas un fournisseur d'un
  -- 199e pays doit passer, ici une ville sans pays connu n'a pas de sens.
  country_code char(2) not null references countries (iso2) on delete cascade,
  name         text not null,
  name_ar      text,
  -- Le gouvernorat en Tunisie, la province ou le district ailleurs. C'est ce
  -- qui distingue les homonymes : Ezzouhour existe à Tunis ET à Kasserine.
  region       text,
  lat          numeric(9,6),
  lng          numeric(9,6),
  priority     int not null default 100,
  active       boolean not null default true
);

-- L'unicité porte sur le TRIPLET, pas sur le nom : deux Ezzouhour dans deux
-- gouvernorats sont deux villes. `coalesce` parce qu'un NULL n'est jamais égal
-- à un NULL, et deux lignes sans région passeraient donc en double.
create unique index if not exists cities_unique
  on cities (country_code, name, coalesce(region, ''));
create index if not exists cities_pays on cities (country_code, priority, name) where active;

comment on table cities is
  'Les villes proposées à la saisie. La Tunisie et la Libye sont complètes, ce sont les deux marchés ; ailleurs, la capitale et les villes où il y a un consulat ou un port utile. Aucune ville n''est inventée : ce qui manque se complète, ce qui est faux fait ouvrir un bureau qui n''existe pas.';
comment on column cities.lat is
  'Coordonnées. TOUTES NULLES aujourd''hui, volontairement : je n''ai pas de source vérifiable pour 500 localités, et rien dans le produit ne les utilise. Des coordonnées approximatives ne serviraient qu''à placer un point au mauvais endroit sur une carte qu''on ajoutera un jour.';

-- ------------------------------------------------------------------
-- 2.1 · La Tunisie, ses 24 gouvernorats
-- ------------------------------------------------------------------
--
-- Le chef-lieu porte la priorité 1, il sort en tête de la liste de son
-- gouvernorat. Les noms arabes sont posés là où je les connais avec certitude,
-- et laissés vides ailleurs : le nom français suffit à choisir dans une liste,
-- un nom arabe faux se retrouverait imprimé sur un document officiel.

insert into cities (country_code, name, name_ar, region, priority) values
  -- Tunis
  ('TN','Tunis','تونس','Tunis',1),
  ('TN','La Médina','المدينة','Tunis',10),
  ('TN','Bab Souika','باب سويقة','Tunis',10),
  ('TN','Bab El Bhar','باب البحر','Tunis',10),
  ('TN','Sidi El Béchir','سيدي البشير','Tunis',10),
  ('TN','El Omrane','العمران','Tunis',10),
  ('TN','El Omrane Supérieur','العمران الأعلى','Tunis',10),
  ('TN','Ettahrir','التحرير','Tunis',10),
  ('TN','El Menzah','المنزه','Tunis',10),
  ('TN','Cité El Khadra','حي الخضراء','Tunis',10),
  ('TN','El Ouardia','الوردية','Tunis',10),
  ('TN','Sidi Hassine','سيدي حسين','Tunis',10),
  ('TN','Séjoumi','السيجومي','Tunis',10),
  ('TN','Ezzouhour','الزهور','Tunis',10),
  ('TN','Hraïria','الحرايرية','Tunis',10),
  ('TN','El Kabaria','القبارية','Tunis',10),
  ('TN','Jebel Jelloud','جبل جلود','Tunis',10),
  ('TN','Djebel Lahmar','الجبل الأحمر','Tunis',10),
  ('TN','Le Bardo','باردو','Tunis',10),
  ('TN','Le Kram','الكرم','Tunis',10),
  ('TN','La Goulette','حلق الوادي','Tunis',10),
  ('TN','Carthage','قرطاج','Tunis',10),
  ('TN','Sidi Bou Saïd','سيدي بوسعيد','Tunis',10),
  ('TN','La Marsa','المرسى','Tunis',10),
  -- Ariana
  ('TN','Ariana','أريانة','Ariana',1),
  ('TN','Ettadhamen','التضامن','Ariana',10),
  ('TN','Mnihla','المنيهلة','Ariana',10),
  ('TN','Raoued','رواد','Ariana',10),
  ('TN','Kalâat el-Andalous','قلعة الأندلس','Ariana',10),
  ('TN','Sidi Thabet','سيدي ثابت','Ariana',10),
  ('TN','La Soukra','سكرة','Ariana',10),
  -- Ben Arous
  ('TN','Ben Arous','بن عروس','Ben Arous',1),
  ('TN','Bou Mhel el-Bassatine','بومهل البساتين','Ben Arous',10),
  ('TN','El Mourouj','المروج','Ben Arous',10),
  ('TN','Ezzahra','الزهراء','Ben Arous',10),
  ('TN','Fouchana','فوشانة','Ben Arous',10),
  ('TN','Hammam Chott','حمام الشط','Ben Arous',10),
  ('TN','Hammam Lif','حمام الأنف','Ben Arous',10),
  ('TN','Mégrine','مقرين','Ben Arous',10),
  ('TN','Mohamedia','المحمدية','Ben Arous',10),
  ('TN','Mornag','مرناق','Ben Arous',10),
  ('TN','Nouvelle Médina','المدينة الجديدة','Ben Arous',10),
  ('TN','Radès','رادس','Ben Arous',10),
  -- Manouba
  ('TN','Manouba','منوبة','Manouba',1),
  ('TN','Den Den','دندان','Manouba',10),
  ('TN','Douar Hicher','دوار هيشر','Manouba',10),
  ('TN','Oued Ellil','وادي الليل','Manouba',10),
  ('TN','Mornaguia','المرناقية','Manouba',10),
  ('TN','Borj El Amri','برج العامري','Manouba',10),
  ('TN','El Battan','البطان','Manouba',10),
  ('TN','Jedaida','الجديدة','Manouba',10),
  ('TN','Tebourba','طبربة','Manouba',10),
  -- Bizerte
  ('TN','Bizerte','بنزرت','Bizerte',1),
  ('TN','Menzel Bourguiba','منزل بورقيبة','Bizerte',10),
  ('TN','Mateur','ماطر','Bizerte',10),
  ('TN','Ras Jebel','رأس الجبل','Bizerte',10),
  ('TN','Menzel Jemil','منزل جميل','Bizerte',10),
  ('TN','Sejnane','سجنان','Bizerte',10),
  ('TN','Ghar El Melh','غار الملح','Bizerte',10),
  ('TN','Utique','أوتيك','Bizerte',10),
  ('TN','Tinja','تينجة','Bizerte',10),
  ('TN','El Alia','العالية','Bizerte',10),
  ('TN','Joumine','جومين','Bizerte',10),
  ('TN','Ghezala','غزالة','Bizerte',10),
  -- Nabeul
  ('TN','Nabeul','نابل','Nabeul',1),
  ('TN','Hammamet','الحمامات','Nabeul',10),
  ('TN','Kélibia','قليبية','Nabeul',10),
  ('TN','Korba','قربة','Nabeul',10),
  ('TN','Menzel Temime','منزل تميم','Nabeul',10),
  ('TN','Grombalia','قرمبالية','Nabeul',10),
  ('TN','Soliman','سليمان','Nabeul',10),
  ('TN','Béni Khiar','بني خيار','Nabeul',10),
  ('TN','Béni Khalled','بني خلاد','Nabeul',10),
  ('TN','Dar Chaabane El Fehri','دار شعبان الفهري','Nabeul',10),
  ('TN','Bou Argoub','بوعرقوب','Nabeul',10),
  ('TN','El Haouaria','الهوارية','Nabeul',10),
  ('TN','El Mida','الميدة','Nabeul',10),
  ('TN','Hammam Ghezèze','حمام الغزاز','Nabeul',10),
  ('TN','Takelsa','تاكلسة','Nabeul',10),
  ('TN','Menzel Bouzelfa','منزل بوزلفة','Nabeul',10),
  -- Zaghouan
  ('TN','Zaghouan','زغوان','Zaghouan',1),
  ('TN','El Fahs','الفحص','Zaghouan',10),
  ('TN','Nadhour','الناظور','Zaghouan',10),
  ('TN','Bir Mcherga','بئر مشارقة','Zaghouan',10),
  ('TN','Zriba','الزريبة','Zaghouan',10),
  ('TN','Saouaf','صواف','Zaghouan',10),
  -- Sousse
  ('TN','Sousse','سوسة','Sousse',1),
  ('TN','Hammam Sousse','حمام سوسة','Sousse',10),
  ('TN','Akouda','أكودة','Sousse',10),
  ('TN','Kalâa Kebira','القلعة الكبرى','Sousse',10),
  ('TN','Kalâa Seghira','القلعة الصغرى','Sousse',10),
  ('TN','Msaken','مساكن','Sousse',10),
  ('TN','Enfidha','النفيضة','Sousse',10),
  ('TN','Bouficha','بوفيشة','Sousse',10),
  ('TN','Hergla','هرقلة','Sousse',10),
  ('TN','Sidi Bou Ali','سيدي بوعلي','Sousse',10),
  ('TN','Sidi El Hani','سيدي الهاني','Sousse',10),
  ('TN','Kondar','كندار','Sousse',10),
  ('TN','Zaouiet Sousse','زاوية سوسة','Sousse',10),
  -- Monastir
  ('TN','Monastir','المنستير','Monastir',1),
  ('TN','Ksar Hellal','قصر هلال','Monastir',10),
  ('TN','Moknine','المكنين','Monastir',10),
  ('TN','Jemmal','جمال','Monastir',10),
  ('TN','Téboulba','طبلبة','Monastir',10),
  ('TN','Bekalta','البقالطة','Monastir',10),
  ('TN','Sahline','الساحلين','Monastir',10),
  ('TN','Bembla','بنبلة','Monastir',10),
  ('TN','Ouerdanine','الوردانين','Monastir',10),
  ('TN','Zéramdine','زرمدين','Monastir',10),
  ('TN','Béni Hassen','بني حسان','Monastir',10),
  ('TN','Sayada','صيادة','Monastir',10),
  ('TN','Lamta','لمطة','Monastir',10),
  ('TN','Ksibet el-Médiouni','قصيبة المديوني','Monastir',10),
  -- Mahdia
  ('TN','Mahdia','المهدية','Mahdia',1),
  ('TN','Rejiche','رجيش','Mahdia',10),
  ('TN','Ksour Essef','قصور الساف','Mahdia',10),
  ('TN','Chebba','الشابة','Mahdia',10),
  ('TN','El Jem','الجم','Mahdia',10),
  ('TN','Souassi','السواسي','Mahdia',10),
  ('TN','Chorbane','شربان','Mahdia',10),
  ('TN','Melloulèche','ملولش','Mahdia',10),
  ('TN','Ouled Chamekh','أولاد الشامخ','Mahdia',10),
  ('TN','Sidi Alouane','سيدي علوان','Mahdia',10),
  ('TN','Bou Merdès','بومرداس','Mahdia',10),
  ('TN','Hebira','هبيرة','Mahdia',10),
  -- Sfax
  ('TN','Sfax','صفاقس','Sfax',1),
  ('TN','Sakiet Ezzit','ساقية الزيت','Sfax',10),
  ('TN','Sakiet Eddaïer','ساقية الدائر','Sfax',10),
  ('TN','Chihia','شيحية','Sfax',10),
  ('TN','Gremda','قرمدة','Sfax',10),
  ('TN','El Ain','العين','Sfax',10),
  ('TN','Thyna','طينة','Sfax',10),
  ('TN','Agareb','عقارب','Sfax',10),
  ('TN','Jebiniana','جبنيانة','Sfax',10),
  ('TN','El Hencha','الحنشة','Sfax',10),
  ('TN','Menzel Chaker','منزل شاكر','Sfax',10),
  ('TN','Bir Ali Ben Khalifa','بئر علي بن خليفة','Sfax',10),
  ('TN','La Skhira','الصخيرة','Sfax',10),
  ('TN','Mahrès','المحرس','Sfax',10),
  ('TN','Kerkennah','قرقنة','Sfax',10),
  ('TN','Ghraïba','الغريبة','Sfax',10),
  -- Kairouan
  ('TN','Kairouan','القيروان','Kairouan',1),
  ('TN','Sbikha','السبيخة','Kairouan',10),
  ('TN','Haffouz','حفوز','Kairouan',10),
  ('TN','Hajeb El Ayoun','حاجب العيون','Kairouan',10),
  ('TN','Nasrallah','نصر الله','Kairouan',10),
  ('TN','Chebika','الشبيكة','Kairouan',10),
  ('TN','Oueslatia','الوسلاتية','Kairouan',10),
  ('TN','Bou Hajla','بوحجلة','Kairouan',10),
  ('TN','El Alâa','العلا','Kairouan',10),
  ('TN','Menzel Mehiri','منزل المهيري','Kairouan',10),
  ('TN','Echrarda','الشراردة','Kairouan',10),
  -- Kasserine
  ('TN','Kasserine','القصرين','Kasserine',1),
  ('TN','Sbeïtla','سبيطلة','Kasserine',10),
  ('TN','Fériana','فريانة','Kasserine',10),
  ('TN','Thala','تالة','Kasserine',10),
  ('TN','Sbiba','سبيبة','Kasserine',10),
  ('TN','Foussana','فوسانة','Kasserine',10),
  ('TN','Majel Bel Abbès','ماجل بلعباس','Kasserine',10),
  ('TN','Haïdra','حيدرة','Kasserine',10),
  ('TN','Jedelienne','جدليان','Kasserine',10),
  ('TN','El Ayoun','العيون','Kasserine',10),
  ('TN','Hassi El Ferid','حاسي الفريد','Kasserine',10),
  ('TN','Ezzouhour','الزهور','Kasserine',10),
  -- Sidi Bouzid
  ('TN','Sidi Bouzid','سيدي بوزيد','Sidi Bouzid',1),
  ('TN','Regueb','الرقاب','Sidi Bouzid',10),
  ('TN','Meknassy','المكناسي','Sidi Bouzid',10),
  ('TN','Jelma','جلمة','Sidi Bouzid',10),
  ('TN','Bir El Hafey','بئر الحفي','Sidi Bouzid',10),
  ('TN','Menzel Bouzaiane','منزل بوزيان','Sidi Bouzid',10),
  ('TN','Ouled Haffouz','أولاد حفوز','Sidi Bouzid',10),
  ('TN','Mezzouna','المزونة','Sidi Bouzid',10),
  ('TN','Souk Jedid','السوق الجديد','Sidi Bouzid',10),
  ('TN','Sidi Ali Ben Aoun','سيدي علي بن عون','Sidi Bouzid',10),
  ('TN','Cebbala Ouled Asker','سبالة أولاد عسكر','Sidi Bouzid',10),
  -- Gafsa
  ('TN','Gafsa','قفصة','Gafsa',1),
  ('TN','Métlaoui','المتلوي','Gafsa',10),
  ('TN','Redeyef','الرديف','Gafsa',10),
  ('TN','Moularès',null,'Gafsa',10),
  ('TN','El Ksar','القصر','Gafsa',10),
  ('TN','Oum El Araies','أم العرائس','Gafsa',10),
  ('TN','El Guettar','القطار','Gafsa',10),
  ('TN','Sened','سند','Gafsa',10),
  ('TN','Belkhir','بلخير','Gafsa',10),
  ('TN','Sidi Aïch','سيدي عيش','Gafsa',10),
  ('TN','Mdhilla','المظيلة','Gafsa',10),
  -- Tozeur
  ('TN','Tozeur','توزر','Tozeur',1),
  ('TN','Nefta','نفطة','Tozeur',10),
  ('TN','Degache','دقاش','Tozeur',10),
  ('TN','Hazoua','حزوة','Tozeur',10),
  ('TN','Tameghza','تمغزة','Tozeur',10),
  -- Kébili
  ('TN','Kébili','قبلي','Kébili',1),
  ('TN','Douz','دوز','Kébili',10),
  ('TN','Souk Lahad','سوق الأحد','Kébili',10),
  ('TN','Faouar','الفوار','Kébili',10),
  -- Gabès
  ('TN','Gabès','قابس','Gabès',1),
  ('TN','Ghannouch','غنوش','Gabès',10),
  ('TN','Mareth','مارث','Gabès',10),
  ('TN','El Hamma','الحامة','Gabès',10),
  ('TN','Métouia','المطوية','Gabès',10),
  ('TN','Menzel Habib','منزل الحبيب','Gabès',10),
  ('TN','Matmata','مطماطة','Gabès',10),
  ('TN','Nouvelle Matmata','مطماطة الجديدة','Gabès',10),
  ('TN','Chenini Nahal','شنني نحال','Gabès',10),
  ('TN','Oudhref','وذرف','Gabès',10),
  -- Médenine
  ('TN','Médenine','مدنين','Médenine',1),
  ('TN','Zarzis','جرجيس','Médenine',10),
  ('TN','Houmt Souk','حومة السوق','Médenine',10),
  ('TN','Midoun','ميدون','Médenine',10),
  ('TN','Ajim','أجيم','Médenine',10),
  ('TN','Ben Gardane','بن قردان','Médenine',10),
  ('TN','Beni Khedache','بني خداش','Médenine',10),
  ('TN','Sidi Makhlouf','سيدي مخلوف','Médenine',10),
  -- Tataouine
  ('TN','Tataouine','تطاوين','Tataouine',1),
  ('TN','Ghomrassen','غمراسن','Tataouine',10),
  ('TN','Remada','رمادة','Tataouine',10),
  ('TN','Bir Lahmar','بئر الأحمر','Tataouine',10),
  ('TN','Dhehiba','ذهيبة','Tataouine',10),
  ('TN','Smâr','الصمار','Tataouine',10),
  -- Béja
  ('TN','Béja','باجة','Béja',1),
  ('TN','Testour','تستور','Béja',10),
  ('TN','Medjez el-Bab','مجاز الباب','Béja',10),
  ('TN','Téboursouk','تبرسق','Béja',10),
  ('TN','Nefza','نفزة','Béja',10),
  ('TN','Amdoun','عمدون','Béja',10),
  ('TN','Goubellat','قبلاط','Béja',10),
  ('TN','Thibar','تيبار','Béja',10),
  -- Jendouba
  ('TN','Jendouba','جندوبة','Jendouba',1),
  ('TN','Tabarka','طبرقة','Jendouba',10),
  ('TN','Aïn Draham','عين دراهم','Jendouba',10),
  ('TN','Bou Salem','بوسالم','Jendouba',10),
  ('TN','Ghardimaou','غار الدماء','Jendouba',10),
  ('TN','Fernana','فرنانة','Jendouba',10),
  ('TN','Balta-Bou Aouane','بلطة بوعوان','Jendouba',10),
  ('TN','Oued Meliz','وادي مليز','Jendouba',10),
  -- Le Kef
  ('TN','Le Kef','الكاف','Le Kef',1),
  ('TN','Dahmani','الدهماني','Le Kef',10),
  ('TN','Tajerouine','تاجروين','Le Kef',10),
  ('TN','Sakiet Sidi Youssef','ساقية سيدي يوسف','Le Kef',10),
  ('TN','Nebeur','نبر','Le Kef',10),
  ('TN','Jérissa','الجريصة','Le Kef',10),
  ('TN','Kalâat Senan','قلعة سنان','Le Kef',10),
  ('TN','Kalâa Khasba','قلعة الخصبة','Le Kef',10),
  ('TN','Sers','السرس','Le Kef',10),
  ('TN','Touiref','تويرف','Le Kef',10),
  ('TN','Menzel Salem','منزل سالم','Le Kef',10),
  -- Siliana
  ('TN','Siliana','سليانة','Siliana',1),
  ('TN','Bou Arada','بوعرادة','Siliana',10),
  ('TN','Gaâfour','قعفور','Siliana',10),
  ('TN','El Krib','الكريب','Siliana',10),
  ('TN','Makthar','مكثر','Siliana',10),
  ('TN','Rouhia','الروحية','Siliana',10),
  ('TN','Kesra','كسرى','Siliana',10),
  ('TN','Bargou','برقو','Siliana',10),
  ('TN','El Aroussa','العروسة','Siliana',10),
  ('TN','Sidi Bou Rouis','سيدي بورويس','Siliana',10)
on conflict (country_code, name, coalesce(region, '')) do nothing;

-- ------------------------------------------------------------------
-- 2.2 · La Libye
-- ------------------------------------------------------------------
--
-- Le second marché, et le plus difficile à saisir : la translittération des
-- noms libyens n'a aucun standard, et « Al Khums », « Khoms » et « Homs »
-- désignent la même ville. Le nom arabe est donc posé partout ici, il fait
-- foi. Le district (la chaabiya) n'est rempli que là où j'en suis sûr : le
-- découpage administratif libyen a changé plusieurs fois depuis 2007, et
-- rattacher une ville au mauvais district ferait ranger un dossier au mauvais
-- endroit.
--
-- Ras Jedir est un poste frontière, pas une ville. Il est ici parce qu'une
-- agence tunisienne y travaille tous les jours, et que la 0047 l'a déjà semé
-- côté tunisien dans `transport_locations`.

insert into cities (country_code, name, name_ar, region, priority) values
  ('LY','Tripoli','طرابلس','Tripoli',1),
  ('LY','Tajoura','تاجوراء','Tripoli',10),
  ('LY','Janzour','جنزور','Tripoli',10),
  ('LY','Benghazi','بنغازي','Benghazi',1),
  ('LY','Misrata','مصراتة','Misrata',1),
  ('LY','Zliten','زليتن','Misrata',10),
  ('LY','Khoms','الخمس','Al Murqub',10),
  ('LY','Msallata','مسلاتة','Al Murqub',10),
  ('LY','Tarhuna','ترهونة','Al Murqub',10),
  ('LY','Zawiya','الزاوية','Zawiya',10),
  ('LY','Sabratha','صبراتة',null,10),
  ('LY','Sorman','صرمان',null,10),
  ('LY','Zouara','زوارة','Nuqat al Khams',10),
  ('LY','Al Jmail','الجميل','Nuqat al Khams',10),
  ('LY','Ras Jedir','رأس اجدير','Nuqat al Khams',10),
  ('LY','Al Aziziyah','العزيزية',null,10),
  ('LY','Syrte','سرت','Syrte',10),
  ('LY','Sebha','سبها','Sebha',1),
  ('LY','Tobrouk','طبرق','Butnan',10),
  ('LY','Derna','درنة','Derna',10),
  ('LY','Ajdabiya','أجدابيا','Al Wahat',10),
  ('LY','Jalu','جالو','Al Wahat',10),
  ('LY','Awjila','أوجلة','Al Wahat',10),
  ('LY','Gharyan','غريان','Jabal al Gharbi',10),
  ('LY','Yefren','يفرن','Jabal al Gharbi',10),
  ('LY','Zintan','الزنتان','Jabal al Gharbi',10),
  ('LY','Mizda','مزدة','Jabal al Gharbi',10),
  ('LY','Beni Walid','بني وليد','Beni Walid',10),
  ('LY','Ubari','أوباري','Wadi al Hayaa',10),
  ('LY','Murzuq','مرزق','Murzuq',10),
  ('LY','Al Bayda','البيضاء','Jabal al Akhdar',10),
  ('LY','Shahat','شحات','Jabal al Akhdar',10),
  ('LY','Al Marj','المرج','Al Marj',10),
  ('LY','Ghadamès','غدامس','Nalut',10),
  ('LY','Nalut','نالوت','Nalut',10),
  ('LY','Hun','هون','Al Jufra',10),
  ('LY','Waddan','ودان','Al Jufra',10),
  ('LY','Brak','براك','Wadi al Shatii',10),
  ('LY','Ghat','غات','Ghat',10),
  ('LY','Koufra','الكفرة','Kufra',10)
on conflict (country_code, name, coalesce(region, '')) do nothing;

-- ------------------------------------------------------------------
-- 2.3 · Le reste du monde : les capitales, les consulats, les ports
-- ------------------------------------------------------------------
--
-- Pas de liste exhaustive, et c'est délibéré. Une agence tunisienne saisit un
-- bureau à Tunis, un correspondant à Tripoli, et une destination de fret à
-- Marseille ou à Ningbo. Elle ne saisit pas un village du Montana. On sème
-- donc la capitale de chaque pays, plus les villes où il y a un consulat que
-- le métier fréquente ou un port qui compte pour le fret.
--
-- La priorité 1 marque la capitale, la 10 les autres. Le nom arabe n'est posé
-- que pour les pays arabophones : ailleurs, il n'existe pas de forme usuelle.
-- Aucun rattachement administratif : ce ne sont pas mes provinces.

insert into cities (country_code, name, name_ar, priority) values
  -- Maghreb et Machrek
  ('DZ','Alger','الجزائر',1),('DZ','Oran','وهران',10),('DZ','Constantine','قسنطينة',10),
  ('DZ','Annaba','عنابة',10),('DZ','Sétif','سطيف',10),('DZ','Béjaïa','بجاية',10),
  ('DZ','Skikda','سكيكدة',10),('DZ','Tlemcen','تلمسان',10),('DZ','Ghardaïa','غرداية',10),
  ('MA','Rabat','الرباط',1),('MA','Casablanca','الدار البيضاء',10),('MA','Tanger','طنجة',10),
  ('MA','Marrakech','مراكش',10),('MA','Fès','فاس',10),('MA','Agadir','أكادير',10),
  ('MA','Oujda','وجدة',10),('MA','Meknès','مكناس',10),
  ('EG','Le Caire','القاهرة',1),('EG','Alexandrie','الإسكندرية',10),('EG','Port-Saïd','بورسعيد',10),
  ('EG','Suez','السويس',10),('EG','Damiette','دمياط',10),('EG','Gizeh','الجيزة',10),
  ('MR','Nouakchott','نواكشوط',1),('MR','Nouadhibou','نواذيبو',10),
  ('SD','Khartoum','الخرطوم',1),('SD','Port-Soudan','بورتسودان',10),
  ('SS','Djouba',null,1),
  ('LB','Beyrouth','بيروت',1),('LB','Tripoli','طرابلس',10),
  ('SY','Damas','دمشق',1),('SY','Alep','حلب',10),('SY','Lattaquié','اللاذقية',10),
  ('JO','Amman','عمان',1),('JO','Aqaba','العقبة',10),
  ('IQ','Bagdad','بغداد',1),('IQ','Bassorah','البصرة',10),('IQ','Erbil','أربيل',10),
  ('PS','Ramallah','رام الله',1),('PS','Gaza','غزة',10),
  ('SA','Riyad','الرياض',1),('SA','Djeddah','جدة',10),('SA','La Mecque','مكة المكرمة',10),
  ('SA','Médine','المدينة المنورة',10),('SA','Dammam','الدمام',10),
  ('AE','Abou Dabi','أبوظبي',1),('AE','Dubaï','دبي',10),('AE','Charjah','الشارقة',10),
  ('AE','Ajman','عجمان',10),('AE','Ras el Khaïmah','رأس الخيمة',10),('AE','Foudjaïra','الفجيرة',10),
  ('QA','Doha','الدوحة',1),
  ('KW','Koweït','الكويت',1),
  ('BH','Manama','المنامة',1),
  ('OM','Mascate','مسقط',1),('OM','Salalah','صلالة',10),('OM','Sohar','صحار',10),
  ('YE','Sanaa','صنعاء',1),('YE','Aden','عدن',10),
  ('KM','Moroni','موروني',1),
  ('DJ','Djibouti','جيبوتي',1),
  ('SO','Mogadiscio','مقديشو',1),
  -- Europe
  ('FR','Paris',null,1),('FR','Marseille',null,10),('FR','Lyon',null,10),('FR','Toulouse',null,10),
  ('FR','Nice',null,10),('FR','Nantes',null,10),('FR','Strasbourg',null,10),('FR','Montpellier',null,10),
  ('FR','Bordeaux',null,10),('FR','Lille',null,10),('FR','Le Havre',null,10),
  ('IT','Rome',null,1),('IT','Milan',null,10),('IT','Naples',null,10),('IT','Gênes',null,10),
  ('IT','Turin',null,10),('IT','Palerme',null,10),('IT','Venise',null,10),('IT','Trieste',null,10),
  ('IT','Bari',null,10),('IT','Livourne',null,10),('IT','Salerne',null,10),('IT','Gioia Tauro',null,10),
  ('DE','Berlin',null,1),('DE','Hambourg',null,10),('DE','Munich',null,10),('DE','Francfort',null,10),
  ('DE','Cologne',null,10),('DE','Stuttgart',null,10),('DE','Düsseldorf',null,10),('DE','Brême',null,10),
  ('ES','Madrid',null,1),('ES','Barcelone',null,10),('ES','Valence',null,10),('ES','Séville',null,10),
  ('ES','Algésiras',null,10),('ES','Bilbao',null,10),('ES','Malaga',null,10),
  ('GB','Londres',null,1),('GB','Manchester',null,10),('GB','Birmingham',null,10),
  ('GB','Liverpool',null,10),('GB','Felixstowe',null,10),('GB','Southampton',null,10),
  ('BE','Bruxelles',null,1),('BE','Anvers',null,10),
  ('NL','Amsterdam',null,1),('NL','Rotterdam',null,10),('NL','La Haye',null,10),
  ('CH','Berne',null,1),('CH','Genève',null,10),('CH','Zurich',null,10),('CH','Bâle',null,10),
  ('PT','Lisbonne',null,1),('PT','Porto',null,10),('PT','Sines',null,10),
  ('GR','Athènes',null,1),('GR','Le Pirée',null,10),('GR','Thessalonique',null,10),
  ('MT','La Valette',null,1),('MT','Marsaxlokk',null,10),
  ('AT','Vienne',null,1),
  ('SE','Stockholm',null,1),('SE','Göteborg',null,10),
  ('NO','Oslo',null,1),
  ('DK','Copenhague',null,1),('DK','Aarhus',null,10),
  ('FI','Helsinki',null,1),
  ('IS','Reykjavik',null,1),
  ('IE','Dublin',null,1),
  ('PL','Varsovie',null,1),('PL','Gdansk',null,10),
  ('CZ','Prague',null,1),
  ('SK','Bratislava',null,1),
  ('HU','Budapest',null,1),
  ('RO','Bucarest',null,1),('RO','Constanta',null,10),
  ('BG','Sofia',null,1),('BG','Varna',null,10),
  ('HR','Zagreb',null,1),('HR','Rijeka',null,10),
  ('SI','Ljubljana',null,1),('SI','Koper',null,10),
  ('RS','Belgrade',null,1),
  ('BA','Sarajevo',null,1),
  ('ME','Podgorica',null,1),('ME','Bar',null,10),
  ('MK','Skopje',null,1),
  ('AL','Tirana',null,1),('AL','Durrës',null,10),
  ('CY','Nicosie',null,1),('CY','Limassol',null,10),
  ('UA','Kiev',null,1),('UA','Odessa',null,10),
  ('RU','Moscou',null,1),('RU','Saint-Pétersbourg',null,10),('RU','Novorossiisk',null,10),
  ('BY','Minsk',null,1),
  ('MD','Chisinau',null,1),
  ('LT','Vilnius',null,1),('LT','Klaipeda',null,10),
  ('LV','Riga',null,1),
  ('EE','Tallinn',null,1),
  ('LU','Luxembourg',null,1),
  ('MC','Monaco',null,1),
  ('AD','Andorre-la-Vieille',null,1),
  ('SM','Saint-Marin',null,1),
  ('LI','Vaduz',null,1),
  ('VA','Vatican',null,1),
  -- Asie
  ('TR','Ankara',null,1),('TR','Istanbul',null,10),('TR','Izmir',null,10),('TR','Mersin',null,10),
  ('TR','Bursa',null,10),('TR','Antalya',null,10),('TR','Gaziantep',null,10),
  ('CN','Pékin',null,1),('CN','Shanghai',null,10),('CN','Canton',null,10),('CN','Shenzhen',null,10),
  ('CN','Ningbo',null,10),('CN','Yiwu',null,10),('CN','Qingdao',null,10),('CN','Tianjin',null,10),
  ('CN','Xiamen',null,10),
  ('HK','Hong Kong',null,1),
  ('MO','Macao',null,1),
  ('TW','Taipei',null,1),('TW','Kaohsiung',null,10),
  ('JP','Tokyo',null,1),('JP','Osaka',null,10),('JP','Yokohama',null,10),
  ('KR','Séoul',null,1),('KR','Busan',null,10),
  ('KP','Pyongyang',null,1),
  ('IN','New Delhi',null,1),('IN','Bombay',null,10),('IN','Chennai',null,10),('IN','Calcutta',null,10),
  ('PK','Islamabad',null,1),('PK','Karachi',null,10),('PK','Lahore',null,10),
  ('BD','Dacca',null,1),('BD','Chittagong',null,10),
  ('LK','Colombo',null,1),
  ('NP','Katmandou',null,1),
  ('BT','Thimphou',null,1),
  ('MV','Malé',null,1),
  ('AF','Kaboul',null,1),
  ('IR','Téhéran',null,1),('IR','Bandar Abbas',null,10),
  ('IL','Tel Aviv',null,1),('IL','Haïfa',null,10),('IL','Jérusalem',null,10),
  ('TH','Bangkok',null,1),('TH','Laem Chabang',null,10),
  ('VN','Hanoï',null,1),('VN','Hô Chi Minh-Ville',null,10),('VN','Haïphong',null,10),
  ('MY','Kuala Lumpur',null,1),('MY','Port Klang',null,10),
  ('SG','Singapour',null,1),
  ('ID','Jakarta',null,1),('ID','Surabaya',null,10),
  ('PH','Manille',null,1),
  ('KH','Phnom Penh',null,1),('KH','Sihanoukville',null,10),
  ('LA','Vientiane',null,1),
  ('MM','Naypyidaw',null,1),('MM','Rangoun',null,10),
  ('BN','Bandar Seri Begawan',null,1),
  ('TL','Dili',null,1),
  ('MN','Oulan-Bator',null,1),
  ('KZ','Astana',null,1),('KZ','Almaty',null,10),
  ('UZ','Tachkent',null,1),
  ('TM','Achgabat',null,1),
  ('TJ','Douchanbé',null,1),
  ('KG','Bichkek',null,1),
  ('AZ','Bakou',null,1),
  ('AM','Erevan',null,1),
  ('GE','Tbilissi',null,1),('GE','Poti',null,10),
  -- Afrique subsaharienne
  ('SN','Dakar',null,1),
  ('CI','Yamoussoukro',null,1),('CI','Abidjan',null,10),
  ('ML','Bamako',null,1),
  ('NE','Niamey',null,1),
  ('BF','Ouagadougou',null,1),
  ('TD','N''Djaména',null,1),
  ('NG','Abuja',null,1),('NG','Lagos',null,10),
  ('GH','Accra',null,1),('GH','Tema',null,10),
  ('TG','Lomé',null,1),
  ('BJ','Porto-Novo',null,1),('BJ','Cotonou',null,10),
  ('CM','Yaoundé',null,1),('CM','Douala',null,10),
  ('GA','Libreville',null,1),('GA','Port-Gentil',null,10),
  ('CG','Brazzaville',null,1),('CG','Pointe-Noire',null,10),
  ('CD','Kinshasa',null,1),('CD','Matadi',null,10),
  ('CF','Bangui',null,1),
  ('GQ','Malabo',null,1),
  ('ST','São Tomé',null,1),
  ('GN','Conakry',null,1),
  ('GW','Bissau',null,1),
  ('SL','Freetown',null,1),
  ('LR','Monrovia',null,1),
  ('GM','Banjul',null,1),
  ('CV','Praia',null,1),
  ('ET','Addis-Abeba',null,1),
  ('ER','Asmara',null,1),('ER','Massaoua',null,10),
  ('KE','Nairobi',null,1),('KE','Mombasa',null,10),
  ('UG','Kampala',null,1),
  ('TZ','Dodoma',null,1),('TZ','Dar es Salam',null,10),
  ('RW','Kigali',null,1),
  ('BI','Gitega',null,1),('BI','Bujumbura',null,10),
  ('MZ','Maputo',null,1),('MZ','Beira',null,10),
  ('ZW','Harare',null,1),
  ('ZM','Lusaka',null,1),
  ('MW','Lilongwe',null,1),
  ('AO','Luanda',null,1),
  ('NA','Windhoek',null,1),('NA','Walvis Bay',null,10),
  ('BW','Gaborone',null,1),
  ('ZA','Pretoria',null,1),('ZA','Le Cap',null,10),('ZA','Johannesburg',null,10),('ZA','Durban',null,10),
  ('LS','Maseru',null,1),
  ('SZ','Mbabane',null,1),
  ('MG','Antananarivo',null,1),('MG','Toamasina',null,10),
  ('MU','Port-Louis',null,1),
  ('SC','Victoria',null,1),
  -- Amériques
  ('US','Washington',null,1),('US','New York',null,10),('US','Los Angeles',null,10),
  ('US','Chicago',null,10),('US','Houston',null,10),('US','Miami',null,10),
  ('CA','Ottawa',null,1),('CA','Montréal',null,10),('CA','Toronto',null,10),
  ('MX','Mexico',null,1),('MX','Veracruz',null,10),
  ('BR','Brasilia',null,1),('BR','São Paulo',null,10),('BR','Santos',null,10),('BR','Rio de Janeiro',null,10),
  ('AR','Buenos Aires',null,1),
  ('CL','Santiago',null,1),
  ('CO','Bogota',null,1),
  ('PE','Lima',null,1),('PE','Callao',null,10),
  ('VE','Caracas',null,1),
  ('EC','Quito',null,1),('EC','Guayaquil',null,10),
  ('BO','Sucre',null,1),('BO','La Paz',null,10),
  ('PY','Asuncion',null,1),
  ('UY','Montevideo',null,1),
  ('GY','Georgetown',null,1),
  ('SR','Paramaribo',null,1),
  ('PA','Panama',null,1),('PA','Colón',null,10),
  ('CR','San José',null,1),
  ('NI','Managua',null,1),
  ('HN','Tegucigalpa',null,1),
  ('SV','San Salvador',null,1),
  ('GT','Guatemala',null,1),
  ('BZ','Belmopan',null,1),
  ('CU','La Havane',null,1),
  ('DO','Saint-Domingue',null,1),
  ('HT','Port-au-Prince',null,1),
  ('JM','Kingston',null,1),
  ('BS','Nassau',null,1),
  ('BB','Bridgetown',null,1),
  ('TT','Port-d''Espagne',null,1),
  ('AG','Saint John''s',null,1),
  ('DM','Roseau',null,1),
  ('GD','Saint-Georges',null,1),
  ('KN','Basseterre',null,1),
  ('LC','Castries',null,1),
  ('VC','Kingstown',null,1),
  -- Océanie
  ('AU','Canberra',null,1),('AU','Sydney',null,10),('AU','Melbourne',null,10),
  ('NZ','Wellington',null,1),('NZ','Auckland',null,10),
  ('PG','Port Moresby',null,1),
  ('FJ','Suva',null,1),
  ('SB','Honiara',null,1),
  ('VU','Port-Vila',null,1),
  ('WS','Apia',null,1),
  ('TO','Nuku''alofa',null,1),
  ('KI','Tarawa',null,1),
  ('TV','Funafuti',null,1),
  ('NR','Yaren',null,1),
  ('MH','Majuro',null,1),
  ('FM','Palikir',null,1),
  ('PW','Ngerulmud',null,1)
on conflict (country_code, name, coalesce(region, '')) do nothing;

-- ------------------------------------------------------------------
-- 2.4 · La recherche de ville
-- ------------------------------------------------------------------
--
-- L'index trigramme porte sur le nom SANS ACCENTS et en minuscules, parce que
-- c'est exactement ce qu'on compare : sans lui, taper « ariana » balaierait
-- 669 lignes à chaque touche. La classe d'opérateurs est qualifiée par son
-- schéma, pour la raison déjà rencontrée en 0052 : sur Supabase les extensions
-- ne vivent pas dans `public`, et un index non qualifié échoue selon le
-- `search_path` du moment.

do $$
declare v_ns text;
begin
  select n.nspname into v_ns
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  execute format(
    'create index if not exists cities_trgm_nom on cities using gin '
    || '(lower(text_sans_accents(name)) %I.gin_trgm_ops)', v_ns);
  -- Le nom arabe se cherche aussi : un agent tunisien tape « صفاقس » aussi
  -- souvent que « Sfax », et sa recherche doit trouver la même ligne.
  execute format(
    'create index if not exists cities_trgm_ar on cities using gin '
    || '(coalesce(name_ar, '''') %I.gin_trgm_ops)', v_ns);
end $$;

create or replace function city_search(
  p_country_code text, p_query text default null, p_limit int default 20
)
returns table (
  id uuid, country_code char(2), name text, name_ar text,
  region text, lat numeric, lng numeric, priority int
)
language sql stable
set search_path = public, extensions
as $$
  with q as (
    select upper(nullif(trim(coalesce(p_country_code, '')), '')) as pays,
           lower(text_sans_accents(trim(coalesce(p_query, '')))) as terme,
           least(greatest(coalesce(p_limit, 20), 1), 200) as lim
  )
  select c.id, c.country_code, c.name, c.name_ar, c.region, c.lat, c.lng, c.priority
  from cities c, q
  where c.active
    and (q.pays is null or c.country_code = q.pays)
    and (q.terme = ''
         -- La sous-chaîne d'abord : elle attrape « ariana » dans « Ariana »
         -- et « beja » dans « Béja », puisque les deux côtés sont désaccentués.
         or lower(text_sans_accents(c.name)) like '%' || q.terme || '%'
         or coalesce(c.name_ar, '') like '%' || trim(coalesce(p_query, '')) || '%'
         -- Puis le trigramme, qui rattrape la faute de frappe : « kayrouan »
         -- trouve « Kairouan ». Le seuil est bas exprès, la liste est courte.
         or similarity(lower(text_sans_accents(c.name)), q.terme) > 0.3)
  -- Priorité d'abord (le chef-lieu en tête), puis l'ordre alphabétique. Pas de
  -- tri par similarité : un agent qui tape trois lettres veut une liste stable,
  -- pas une liste qui se réordonne à chaque touche.
  order by c.priority, c.name
  limit (select lim from q)
$$;

comment on function city_search(text, text, int) is
  'Recherche de ville, insensible aux accents et à la casse : « beja » trouve « Béja ». Le pays est facultatif, le terme aussi (vide = toute la liste du pays). Tri par priorité puis alphabétique, jamais par score : une liste qui se réordonne à chaque touche est inutilisable.';

-- ==================================================================
-- 3 · Les gardes de l'ouverture
-- ==================================================================
--
-- Quatre vérifications, une par champ qui fait échouer une ouverture. Toutes
-- rendent un jsonb de la même forme : `ok`, `raison`, et ce qu'il faut pour
-- aider. `raison` est un CODE, jamais une phrase : c'est l'écran qui traduit,
-- et les quatre langues du produit ne sortent pas de la base.

-- ------------------------------------------------------------------
-- 3.1 · Le nom de l'agence
-- ------------------------------------------------------------------
--
-- La vraie valeur de cette fonction n'est pas la longueur minimale : c'est la
-- recherche des noms PROCHES. Deux agences peuvent légitimement s'appeler
-- « Voyages Ben Ali » et « Voyage Ben Ali », ce sont deux frères et deux
-- registres de commerce. Mais l'admin doit le voir AVANT de valider, parce
-- qu'une fois les deux créées, plus personne ne sait laquelle appeler quand un
-- client téléphone.
--
-- SECURITY DEFINER parce que `agencies` est cloisonnée : sans cela, l'admin
-- qui crée ne verrait aucune agence et la fonction dirait toujours « libre ».
-- Conséquence : `proches` ne sort NOMMÉMENT que pour la plateforme. Un compte
-- d'agence obtient bien `ok`, mais une liste vide : la liste des clients de la
-- plateforme n'a pas à se lire depuis un compte locataire.
create or replace function agency_name_check(p_nom text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_brut    text := trim(coalesce(p_nom, ''));
  v_norm    text;
  v_exact   boolean := false;
  v_proches jsonb  := '[]'::jsonb;
begin
  if v_brut = '' then
    return jsonb_build_object('ok', false, 'raison', 'vide', 'proches', '[]'::jsonb);
  end if;
  if length(v_brut) < 3 then
    return jsonb_build_object('ok', false, 'raison', 'trop_court', 'proches', '[]'::jsonb);
  end if;
  if length(v_brut) > 80 then
    return jsonb_build_object('ok', false, 'raison', 'trop_long', 'proches', '[]'::jsonb);
  end if;
  -- « 12345 » et « --- » ne sont pas des noms d'agence. Le test porte sur la
  -- chaîne D'ORIGINE et sur la classe Unicode des lettres, pas sur [a-z] :
  -- « شركة النور » est un nom valide, et il ne contient aucune lettre latine.
  if v_brut !~ '[[:alpha:]]' then
    return jsonb_build_object('ok', false, 'raison', 'sans_lettre', 'proches', '[]'::jsonb);
  end if;

  v_norm := nom_comparable(v_brut);

  -- Un nom entièrement non latin se normalise en chaîne vide : le comparer
  -- ferait de tous ces noms des doublons les uns des autres. On ne compare pas.
  if v_norm <> '' then
    select exists (
      select 1 from agencies a
      where a.deleted_at is null and nom_comparable(a.name) = v_norm
    ) into v_exact;

    select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'name', name)
                              order by score desc, name), '[]'::jsonb)
      into v_proches
    from (
      select a.slug, a.name,
             case when nom_comparable(a.name) = v_norm then 1.0
                  else similarity(nom_comparable(a.name), v_norm) end as score
      from agencies a
      where a.deleted_at is null
        and (nom_comparable(a.name) = v_norm
             or similarity(nom_comparable(a.name), v_norm) > 0.6)
      limit 10
    ) t;

    if not is_platform_admin() then v_proches := '[]'::jsonb; end if;
  end if;

  return jsonb_build_object(
    'ok', not v_exact,
    'raison', case when v_exact then 'nom_pris' end,
    'proches', v_proches);
end $$;

comment on function agency_name_check(text) is
  'Vérifie un nom d''agence et rend { ok, raison, proches }. `ok` est faux sur un nom DÉJÀ pris à l''identique (accents, casse et ponctuation ignorés) ; il reste vrai sur une simple ressemblance, avec `proches` rempli pour que l''admin décide en connaissance de cause. `proches` n''est nommément rempli que pour la plateforme.';

-- ------------------------------------------------------------------
-- 3.2 · Le sous-domaine : les suggestions, puis la vérification
-- ------------------------------------------------------------------
--
-- Le sous-domaine est la seule chose de l'ouverture qu'on ne peut PAS changer
-- ensuite sans casser tous les liens déjà envoyés aux clients. Il mérite donc
-- mieux qu'un champ vide : on le propose, dérivé du nom, et on ne propose que
-- ce qui est réellement libre.

create or replace function slugifier(p_nom text)
returns text
language sql immutable
set search_path = public
as $$
  -- Translittération pauvre mais suffisante : minuscules, accents retirés, tout
  -- ce qui n'est ni lettre ni chiffre devient un tiret, les tirets se réduisent,
  -- et on coupe à 30. La coupe peut laisser un tiff en fin de chaîne, d'où le
  -- second `trim` : un slug qui finit par un tiret est refusé par la contrainte
  -- de `agencies.slug` posée au socle.
  select trim(both '-' from left(
    trim(both '-' from regexp_replace(
      regexp_replace(lower(text_sans_accents(coalesce(p_nom, ''))), '[^a-z0-9]+', '-', 'g'),
      '-+', '-', 'g')),
    30))
$$;

comment on function slugifier(text) is
  'Le sous-domaine dérivé d''un nom. Coupé à 30 caractères et retaillé après la coupe : une coupe brute peut finir sur un tiret, et la contrainte de `agencies.slug` refuse ça.';

-- Les mots que personne ne peut prendre. La liste de `slug_available` (0011)
-- est reprise à l'identique et ÉLARGIE : les sous-domaines techniques d'un
-- hébergeur, et ceux qui feraient passer une agence pour la plateforme.
-- Reprise et non référence, parce que `slug_available` ne rend qu'un booléen :
-- elle ne peut pas dire POURQUOI, et l'écran doit distinguer « réservé » de
-- « déjà pris ». La disponibilité finale reste tranchée par `slug_available`.
create or replace function slug_reserves()
returns text[]
language sql immutable
set search_path = public
as $$
  select array[
    -- Les quatorze de la 0011.
    'www','app','admin','api','visaflow','aide','support','compte','status',
    'cdn','mail','blog','ambassade','consulat',
    -- Ce qu'un hébergeur ou un courrielleur utilise.
    'ftp','smtp','imap','pop','ns','ns1','ns2','dns','mx','webmail','autodiscover',
    'static','assets','media','files','img','images','download','downloads',
    'dev','test','staging','preprod','prod','demo','sandbox','beta','alpha',
    'git','ci','build','deploy','monitor','metrics','logs','grafana',
    -- Ce qui ferait passer une agence pour la plateforme ou pour l'État.
    'platform','plateforme','console', 'facture','factures','paiement','paiements',
    'securite','security','login','signin','signup','inscription','auth','sso',
    'help','contact','about','apropos','legal','cgu','cgv','privacy',
    'visa','visas','fret','cargo','douane','portail','portal','suivi','tracking',
    'gouvernement','ministere','tunisie','libye','me','my','moi'
  ]
$$;

create or replace function slug_suggestions(
  p_nom text, p_combien int default 5, p_ville text default null
)
returns text[]
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_base   text := slugifier(p_nom);
  v_ville  text := slugifier(p_ville);
  v_sigle  text;
  v_cand   text[] := '{}';
  v_sortie text[] := '{}';
  v_lim    int := least(greatest(coalesce(p_combien, 5), 1), 20);
  c        text;
  i        int;
begin
  if v_base = '' then return '{}'; end if;

  -- Le sigle : la première lettre de chaque mot. « Société Tunisienne de
  -- Voyages » donne « stv ». C'est ce qu'une agence choisit d'elle-même quand
  -- son nom complet est trop long pour une adresse.
  select string_agg(left(mot, 1), '')
    into v_sigle
  from unnest(string_to_array(v_base, '-')) as mot
  where mot <> '';

  v_cand := array[v_base];
  -- Le nom raccourci à ses deux premiers mots : « voyages-ben-ali-et-fils »
  -- devient « voyages-ben ». Plus court à taper, encore lisible.
  if array_length(string_to_array(v_base, '-'), 1) > 2 then
    v_cand := v_cand || (split_part(v_base, '-', 1) || '-' || split_part(v_base, '-', 2));
  end if;
  if v_ville <> '' then
    v_cand := v_cand || (v_base || '-' || v_ville);
    if v_sigle is not null and length(v_sigle) >= 2 then
      v_cand := v_cand || (v_sigle || '-' || v_ville);
    end if;
  end if;
  -- Les ancrages de marché. Une agence tunisienne accepte « -tn » sans
  -- discuter, et ça libère presque toujours un nom déjà pris.
  v_cand := v_cand || (v_base || '-tn') || (v_base || '-tunis') || (v_base || '-agence');
  if v_sigle is not null and length(v_sigle) >= 3 then
    v_cand := v_cand || v_sigle || (v_sigle || '-tn');
  end if;
  for i in 1..9 loop
    v_cand := v_cand || (left(v_base, 28) || '-' || i);
  end loop;

  foreach c in array v_cand loop
    c := trim(both '-' from left(c, 30));
    -- LA GARANTIE DE CETTE FONCTION : on ne propose QUE ce qui est réellement
    -- libre. Proposer un slug déjà pris ferait échouer la création au dernier
    -- écran, après que l'admin a tout saisi.
    if length(c) >= 3 and not (c = any (v_sortie))
       and not (c = any (slug_reserves())) and slug_available(c) then
      v_sortie := v_sortie || c;
      exit when array_length(v_sortie, 1) >= v_lim;
    end if;
  end loop;

  return v_sortie;
end $$;

comment on function slug_suggestions(text, int, text) is
  'Des sous-domaines libres dérivés d''un nom. Ne rend QUE des slugs vérifiés par `slug_available` : un slug proposé puis refusé à la création serait pire que pas de suggestion du tout. La ville est facultative, elle sert de variante quand le nom seul est pris.';

create or replace function slug_check(p_slug text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  -- On TRIME, on ne met PAS en minuscules. Passer « MonAgence » en silence à
  -- « monagence » ferait dire « libre » ici alors que `slug_available`, appelée
  -- telle quelle par `platform_create_agency`, refuse le slug avec ses
  -- majuscules. Deux réponses contraires sur la même saisie, et la création
  -- échoue au dernier écran. On refuse tout de suite, et la suggestion rend la
  -- version en minuscules.
  v_slug text := trim(coalesce(p_slug, ''));
begin
  if v_slug = '' then
    return jsonb_build_object('ok', false, 'raison', 'vide', 'suggestions', '[]'::jsonb);
  end if;

  -- Trois à trente caractères, minuscules, chiffres et tirets, et ni le
  -- premier ni le dernier n'est un tiret. La contrainte de `agencies.slug`
  -- accepte jusqu'à quarante : on est PLUS strict ici, jamais moins. Trente
  -- caractères tiennent dans un sous-domaine lisible au téléphone.
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' then
    return jsonb_build_object('ok', false, 'raison', 'forme',
      'suggestions', to_jsonb(coalesce(slug_suggestions(p_slug, 4), '{}')));
  end if;

  if v_slug = any (slug_reserves()) then
    return jsonb_build_object('ok', false, 'raison', 'reserve',
      'suggestions', to_jsonb(coalesce(slug_suggestions(v_slug, 4), '{}')));
  end if;

  if exists (select 1 from agencies where slug = v_slug) then
    return jsonb_build_object('ok', false, 'raison', 'pris',
      'suggestions', to_jsonb(coalesce(slug_suggestions(v_slug, 4), '{}')));
  end if;

  -- Ceinture et bretelles : `slug_available` reste l'autorité. Si elle refuse
  -- pour une raison que je n'ai pas reprise ici, on refuse aussi.
  if not slug_available(v_slug) then
    return jsonb_build_object('ok', false, 'raison', 'indisponible',
      'suggestions', to_jsonb(coalesce(slug_suggestions(v_slug, 4), '{}')));
  end if;

  return jsonb_build_object('ok', true, 'raison', null, 'suggestions', '[]'::jsonb);
end $$;

comment on function slug_check(text) is
  'Vérifie un sous-domaine et rend { ok, raison, suggestions }. `raison` vaut vide, forme, reserve, pris ou indisponible. Les suggestions ne sortent que quand ça ne va pas, et elles sont toutes libres.';

-- ------------------------------------------------------------------
-- 3.3 · L'adresse e-mail du propriétaire
-- ------------------------------------------------------------------
--
-- CETTE FONCTION EXISTE POUR UNE SEULE RAISON. La fonction de bord qui crée le
-- compte propriétaire refuse une adresse déjà connue, en 409, À LA FIN du
-- parcours : l'admin a saisi le nom, le sous-domaine, le pays, la ville,
-- l'adresse et le téléphone, il valide, et il apprend là que l'adresse est
-- prise. Il faut le savoir au premier écran, pas au dernier.
--
-- SECURITY DEFINER, et search_path incluant `auth` : les comptes vivent dans
-- `auth.users`, que personne ne lit depuis un jeton d'agence. La fonction ne
-- rend JAMAIS à qui appartient l'adresse, seulement qu'elle est prise : c'est
-- assez pour l'écran, et ça ne transforme pas la fonction en annuaire.
create or replace function email_check(p_email text)
returns jsonb
language plpgsql stable security definer
set search_path = public, auth
as $$
declare
  v_mail text := lower(trim(coalesce(p_email, '')));
  v_pris boolean := false;
begin
  if v_mail = '' then
    return jsonb_build_object('ok', false, 'raison', 'vide', 'deja_utilise', false);
  end if;
  -- Forme volontairement large. Une expression plus fine refuse des adresses
  -- valides (les sous-domaines, les TLD longs, le plus dans la partie locale)
  -- et n'attrape rien de plus : seule une vraie livraison prouve qu'une
  -- adresse existe.
  if v_mail !~ '^[^@[:space:]]+@[^@[:space:].]+(\.[^@[:space:].]+)+$' then
    return jsonb_build_object('ok', false, 'raison', 'forme', 'deja_utilise', false);
  end if;

  select exists (select 1 from auth.users u where lower(u.email) = v_mail)
      or exists (select 1 from profiles p where lower(p.email::text) = v_mail)
    into v_pris;

  return jsonb_build_object(
    'ok', not v_pris,
    'raison', case when v_pris then 'deja_utilise' end,
    'deja_utilise', v_pris);
end $$;

comment on function email_check(text) is
  'Vérifie une adresse e-mail et rend { ok, raison, deja_utilise }. Elle existe pour que « adresse déjà utilisée » se sache au PREMIER écran de l''ouverture, pas au 409 de la fonction de bord au dernier. Elle ne dit jamais à qui appartient l''adresse.';

-- ------------------------------------------------------------------
-- 3.4 · Le téléphone
-- ------------------------------------------------------------------
--
-- CE QUE CETTE FONCTION NE FAIT PAS, ET NE PRÉTEND PAS FAIRE : valider un
-- numéro pays par pays. Je n'ai pas les plans de numérotation. Savoir qu'un
-- mobile tunisien commence par 2, 4, 5 ou 9, qu'un fixe français a dix
-- chiffres, qu'un mobile libyen en a neuf, cela se lit dans une bibliothèque
-- entretenue (libphonenumber), pas dans une migration écrite de mémoire. Une
-- règle inventée refuserait un vrai numéro, et l'agent contournerait le champ.
--
-- CE QU'ELLE FAIT : elle met le numéro sous une forme unique. Même client,
-- même numéro, une seule écriture, donc un doublon de fiche en moins et un
-- envoi WhatsApp qui part. Elle ne garde que les chiffres, préfixe l'indicatif
-- du pays quand le numéro est écrit en local, et refuse ce qui est
-- manifestement hors norme : moins de 7 chiffres ou plus de 15, la borne de
-- l'E.164.
--
-- LE ZÉRO DE TÊTE. Un numéro saisi en local commence souvent par un zéro de
-- préfixe national, qui saute au passage à l'international. On en retire UN,
-- SAUF en Italie, où le zéro fait partie du numéro et doit rester. C'est une
-- convention, pas un plan de numérotation : elle est juste pour la France, la
-- Libye, l'Algérie, le Maroc et le Royaume-Uni, elle est sans effet pour la
-- Tunisie qui n'a pas de préfixe national, et l'exception italienne est la
-- seule que je connaisse avec certitude.
create or replace function phone_check(p_phone text, p_country_code text default 'TN')
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  v_brut    text := trim(coalesce(p_phone, ''));
  v_pays    text := upper(nullif(trim(coalesce(p_country_code, '')), ''));
  v_indic   text;
  v_chiffres text;
  v_norm    text;
begin
  if v_brut = '' then
    return jsonb_build_object('ok', false, 'raison', 'vide', 'normalise', null);
  end if;

  v_chiffres := regexp_replace(v_brut, '[^0-9]', '', 'g');
  if v_chiffres = '' then
    return jsonb_build_object('ok', false, 'raison', 'sans_chiffre', 'normalise', null);
  end if;

  select c.phone_code into v_indic from countries c where c.iso2 = v_pays;

  if left(v_brut, 1) = '+' then
    -- Déjà international : on n'y touche pas, l'indicatif est celui que la
    -- personne a écrit, même s'il ne correspond pas au pays choisi. Un
    -- correspondant libyen d'une agence tunisienne, c'est le cas normal.
    v_norm := '+' || v_chiffres;
  elsif left(v_chiffres, 2) = '00' and length(v_chiffres) > 4 then
    -- La forme « 00 » est l'ancienne écriture internationale.
    v_norm := '+' || substr(v_chiffres, 3);
  elsif v_indic is null then
    return jsonb_build_object('ok', false, 'raison', 'indicatif_inconnu', 'normalise', null);
  else
    if left(v_chiffres, 1) = '0' and v_pays <> 'IT' then
      v_chiffres := substr(v_chiffres, 2);
    end if;
    v_norm := v_indic || v_chiffres;
  end if;

  if length(v_norm) - 1 < 7 then
    return jsonb_build_object('ok', false, 'raison', 'trop_court', 'normalise', v_norm);
  end if;
  if length(v_norm) - 1 > 15 then
    return jsonb_build_object('ok', false, 'raison', 'trop_long', 'normalise', v_norm);
  end if;

  return jsonb_build_object('ok', true, 'raison', null, 'normalise', v_norm);
end $$;

comment on function phone_check(text, text) is
  'Normalise un téléphone en international et rend { ok, raison, normalise }. Elle NE valide PAS le numéro pays par pays : sans plan de numérotation, une règle inventée refuserait de vrais numéros. Elle vérifie la forme, préfixe l''indicatif du pays, et refuse hors de la borne E.164 (7 à 15 chiffres).';

-- ==================================================================
-- 4 · L'adresse, qui n'était demandée nulle part
-- ==================================================================
--
-- « Ville du premier bureau » existait, l'adresse non. Une agence de visas
-- reçoit du public : son adresse est sur son enseigne, sur ses convocations,
-- sur les récépissés que le client rapporte au consulat. Ne pas la stocker
-- obligeait à la retaper dans chaque modèle de document.
--
-- `offices.address` EXISTE déjà (socle 0001) et reste le champ libre : numéro,
-- rue, immeuble, étage. Ce qui manquait autour, c'est le code postal, la ville
-- rattachée au référentiel, et la place pour des coordonnées le jour où une
-- carte arrivera.

alter table offices add column if not exists postal_code text;
alter table offices add column if not exists lat numeric(9,6);
alter table offices add column if not exists lng numeric(9,6);
alter table offices add column if not exists city_id uuid references cities on delete set null;

-- L'agence elle-même n'avait aucune adresse : son siège social vivait dans le
-- premier bureau, ce qui marche tant qu'il n'y en a qu'un. Dès le deuxième, le
-- siège social sur une facture devient une devinette.
alter table agencies add column if not exists address text;
alter table agencies add column if not exists city text;
alter table agencies add column if not exists postal_code text;
alter table agencies add column if not exists country_code char(2)
  check (country_code is null or country_code ~ '^[A-Z]{2}$');

comment on column offices.city_id is
  'Le lien vers le référentiel des villes. `offices.city` reste, en texte : une agence déjà créée garde ce qui a été tapé, et ne se voit pas rattacher d''office à une ville que personne n''a choisie. Même règle qu''en 0047 pour les intervenants du fret.';
comment on column agencies.country_code is
  'Le code ISO du pays du siège. `agencies.country` reste en toutes lettres (« Tunisie »), parce que quatre migrations et `platform_create_agency` s''en servent pour choisir la devise et le fuseau. Les deux cohabitent, le code est l''information juste, le texte est l''historique.';
comment on column offices.lat is
  'Coordonnées du bureau. Vides partout aujourd''hui, comme celles des villes : aucune saisie ne les produit, et le produit n''affiche pas de carte. La place est faite, rien n''est inventé pour la remplir.';

-- PAS D'API D'ADRESSE EXTERNE, ET C'EST UNE DÉCISION ÉCRITE.
-- Trois raisons, dans l'ordre où elles pèsent :
--   1. La politique de sécurité de contenu du produit est stricte : chaque
--      hôte tiers doit y être déclaré. Un service d'autocomplétion d'adresse
--      ajoute un domaine, un script, et une panne de plus le jour où il tombe.
--   2. La déclaration INPDP couvre ce que le produit fait de ses données. Une
--      saisie d'adresse envoyée chez un tiers étranger sort du périmètre
--      déclaré, et c'est exactement ce qu'on a promis de ne pas faire.
--   3. Aucun service d'adressage ne couvre correctement la Tunisie et la
--      Libye. Toute la concurrence tunisienne fait ce qu'on fait ici : une
--      liste de villes, et un champ d'adresse libre à côté. C'est suffisant,
--      et ça marche hors ligne.

-- ==================================================================
-- 5 · Sécurité
-- ==================================================================
--
-- `cities` rejoint le régime des référentiels partagés posé en 0047 : elle
-- n'appartient à aucune agence, tout compte connecté la lit, seule la
-- plateforme l'écrit. RLS activée, PAS forcée, pour la même raison que là-bas :
-- le propriétaire de la table doit pouvoir semer depuis une migration sans se
-- battre contre ses propres politiques.

alter table cities enable row level security;
drop policy if exists cities_read on cities;
drop policy if exists cities_insert on cities;
drop policy if exists cities_update on cities;

-- Le nom d'une ville n'est le secret de personne.
create policy cities_read on cities for select to authenticated using (true);
-- Une agence qui pourrait corriger « Sfax » le corrigerait pour toutes les
-- autres, et personne ne saurait qui a écrit quoi.
create policy cities_insert on cities for insert to authenticated
  with check (is_platform_admin());
create policy cities_update on cities for update to authenticated
  using (is_platform_admin()) with check (is_platform_admin());

-- LE PIÈGE DE LA 0015. Elle a posé un `alter default privileges ... grant
-- select, insert, update, delete on tables to authenticated`. Toute table créée
-- APRÈS en hérite, DELETE compris, sans que personne ne l'écrive. Ne pas
-- accorder ne suffit donc pas : il faut REPRENDRE. Sans cette ligne, n'importe
-- quel compte connecté pourrait effacer une ville pour tout le monde.
grant select, insert, update on cities to authenticated;
revoke delete on cities from authenticated;
grant all on cities to service_role;

-- Même reprise pour `countries`, qui gagne trois colonnes : les droits de
-- table ne changent pas avec les colonnes, mais on réaffirme, parce qu'une
-- ligne de trop ne coûte rien et qu'une ligne manquante a déjà coûté cher.
grant select, insert, update on countries to authenticated;
revoke delete on countries from authenticated;
grant all on countries to service_role;

-- ------------------------------------------------------------------
-- 5.1 · Les fonctions
-- ------------------------------------------------------------------
--
-- PostgreSQL accorde EXECUTE à PUBLIC par défaut : une fonction écrite un mardi
-- est ouverte à l'anonyme le mercredi. Aucune de celles-ci n'a de raison
-- d'être appelée sans compte. C'est l'admin qui ouvre une agence, et il est
-- connecté. En particulier `email_check` dirait à un inconnu si une adresse a
-- un compte chez nous : c'est un annuaire, et ça se ferme.

do $$
declare f text;
begin
  foreach f in array array[
    'text_sans_accents(text)', 'nom_comparable(text)', 'flag_emoji(text)',
    'slugifier(text)', 'slug_reserves()',
    'city_search(text, text, int)',
    'agency_name_check(text)',
    'slug_suggestions(text, int, text)', 'slug_check(text)',
    'email_check(text)', 'phone_check(text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- La boucle de fin, reprise à chaque migration qui touche aux droits : une
-- fonction de gâchette n'a aucun appelant légitime. Le déclencheur la lance
-- sans droit d'exécution, et la laisser ouverte à PUBLIC offre un moyen de
-- fabriquer une ligne à la main hors de tout contrôle.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- ==================================================================
-- 6 · Ce qui n'a PAS été inventé
-- ==================================================================
--
-- Relevé exhaustif, dans la lignée de la section 9 de la 0047. Chaque ligne est
-- un refus documenté, pas un oubli. Ce qui manque se complète en une ligne ;
-- ce qui est faux se découvre le jour où un client n'a pas été rappelé.
--
--   1. DOUZE INDICATIFS TÉLÉPHONIQUES, sur 198 pays. Onze pays des Caraïbes
--      partagent « +1 » avec les États-Unis et le Canada : Antigua-et-Barbuda,
--      Bahamas, Barbade, Dominique, République dominicaine, Grenade, Jamaïque,
--      Saint-Christophe-et-Niévès, Sainte-Lucie, Saint-Vincent-et-les-
--      Grenadines et Trinité-et-Tobago. Ce qui les distingue est un préfixe
--      régional à trois chiffres, et je ne l'écrirai pas de mémoire. Le
--      douzième est le Vatican : « +379 » lui est assigné mais n'est pas
--      exploité, ses numéros sont italiens en pratique. 186 indicatifs sont
--      donc posés, 12 sont NULL, et le champ se remplit à la main.
--   2. TOUTES LES COORDONNÉES, sans exception. 669 villes, zéro latitude, zéro
--      longitude. Je n'ai pas de source vérifiable pour 669 localités, rien
--      dans le produit ne les utilise aujourd'hui, et une coordonnée
--      approximative ne sert qu'à poser un point au mauvais endroit sur une
--      carte future. Les colonnes existent, elles attendent un import.
--   3. LES NOMS ARABES DE LA PLUPART DES VILLES NON ARABOPHONES. « Paris » et
--      « Ningbo » n'ont pas de forme arabe usuelle unique. Poser une
--      translittération inventée la ferait imprimer sur un document officiel.
--   4. LE RATTACHEMENT ADMINISTRATIF DES VILLES HORS TUNISIE ET LIBYE. Aucune
--      province, aucun État, aucun département n'est renseigné : ce ne sont pas
--      mes découpages, ils changent, et personne n'en a besoin pour choisir
--      une ville dans une liste.
--   5. LE DISTRICT DE TROIS VILLES LIBYENNES (Sabratha, Sorman, Al Aziziyah).
--      Le découpage libyen en chaabiyat a changé plusieurs fois depuis 2007, et
--      je ne sais pas avec certitude où ces trois-là sont rattachées
--      aujourd'hui. Le nom et le nom arabe suffisent à les choisir.
--   6. LES PLANS DE NUMÉROTATION NATIONAUX. `phone_check` ne sait pas qu'un
--      mobile tunisien commence par 2, 4, 5 ou 9. Elle normalise et borne à
--      l'E.164, rien de plus. Une règle par pays écrite de mémoire refuserait
--      de vrais numéros, et un agent qui se fait refuser un vrai numéro
--      contourne le champ.
--   7. LA VALIDITÉ RÉELLE D'UNE ADRESSE E-MAIL. `email_check` vérifie une
--      forme et l'existence d'un compte. Elle ne prouve pas que l'adresse
--      reçoit : seule une livraison le prouve, et le projet n'a pas de serveur
--      d'envoi (voir 0043).
--   8. LES VILLES SECONDAIRES DU RESTE DU MONDE. Capitales, consulats
--      fréquentés et ports utiles seulement. Une agence tunisienne ne saisit
--      pas un village d'un pays où elle n'a pas de correspondant, et une liste
--      mondiale exhaustive rendrait la recherche moins bonne, pas meilleure.
