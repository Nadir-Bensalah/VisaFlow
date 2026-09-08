-- 0047 · Les référentiels du fret, et le détail physique d'une cargaison.
--
-- Aujourd'hui, une cargaison écrit ses intervenants en toutes lettres :
-- `shipments.supplier`, `broker_name`, `carrier`, `handler`. Une agence qui
-- travaille avec vingt fournisseurs les retape vingt fois. Au bout d'un an on
-- trouve « Ningbo Sunrise », « NINGBO SUNRISE CO » et « ningbo sunrise ltd »
-- dans la même base : trois fournisseurs pour la douane, un seul dans la vraie
-- vie. Plus aucun total n'est juste, et la recherche ne trouve plus rien.
--
-- Ce que cette migration apporte, dans l'ordre :
--   1. Cinq répertoires par agence : fournisseurs, destinataires, expéditeurs,
--      transporteurs, commissionnaires en douane.
--   2. Quatre référentiels PARTAGÉS, sans agency_id : pays, lieux de
--      transport, chapitres du système harmonisé, Incoterms 2020. Tout le
--      monde les lit, seule la plateforme les écrit. Un code ISO n'appartient
--      à personne.
--   3. Le détail physique : conteneurs, colis, marchandises.
--   4. Le raccordement de l'existant, SANS RIEN CASSER : les colonnes texte
--      restent en place, on ajoute des colonnes d'identifiant à côté. Une
--      reprise se fait quand l'agence le décide, jamais par surprise.
--
-- CE QUI N'A PAS ÉTÉ INVENTÉ. C'est la règle qui a gouverné toute la partie
-- « données de référence », et elle est rappelée à chaque endroit concerné :
-- un code faux coûte plus cher qu'un code absent. Le relevé complet est en
-- bas de fichier, section 9.

-- ==================================================================
-- 1 · Les répertoires de l'agence
-- ==================================================================
--
-- Tous la même forme : agency_id, active, note, created_at, deleted_at.
-- Aucune suppression dure : un fournisseur effacé emporterait la traçabilité
-- des cargaisons passées. On le désactive, ou on l'archive par deleted_at.
--
-- Le pays est un code ISO à deux lettres, mais SANS clé étrangère vers
-- `countries`. La table des pays est un sélecteur, pas un mur : elle porte les
-- 45 pays utiles au métier, alors que le monde en compte près de 250. Une clé
-- étrangère refuserait un vrai fournisseur ouzbek le jour où il se présente.

create table if not exists suppliers (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references agencies on delete cascade,
  company_name        text not null,
  contact_name        text,
  country             char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  city                text,
  address             text,
  email               text,
  phone               text,
  whatsapp            text,
  -- L'identifiant fiscal et le registre du commerce : la douane les demande
  -- sur la facture, et personne ne les retrouve au moment du dépôt.
  tax_id              text,
  registration_number text,
  active              boolean not null default true,
  note                text,
  created_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create index if not exists suppliers_agency on suppliers (agency_id, active, company_name);

create table if not exists consignees (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  company_name text not null,
  contact_name text,
  country      char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  city         text,
  address      text,
  email        text,
  phone        text,
  whatsapp     text,
  tax_id       text,
  -- Le code en douane du destinataire, porté sur la déclaration.
  customs_code text,
  -- Lien FACULTATIF vers un client déjà connu. Facultatif parce qu'un
  -- destinataire n'est pas toujours un client de l'agence : en groupage, le
  -- destinataire d'un lot peut être une société que l'agence ne facture pas.
  client_id    uuid references clients on delete set null,
  active       boolean not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists consignees_agency on consignees (agency_id, active, company_name);
create index if not exists consignees_client on consignees (client_id);

create table if not exists shippers (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  company_name text not null,
  country      char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  address      text,
  contact_name text,
  phone        text,
  email        text,
  active       boolean not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists shippers_agency on shippers (agency_id, active, company_name);

create table if not exists carriers (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  name         text not null,
  -- Le genre change ce qu'on attend de la fiche : un armateur a un code SCAC,
  -- une compagnie aérienne a un préfixe IATA, un routier n'a ni l'un ni l'autre.
  kind         text not null check (kind in (
                 'compagnie_maritime','compagnie_aerienne',
                 'transporteur_routier','messagerie','commissionnaire')),
  country      char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  -- SCAC : quatre lettres, attribué par la NMFTA. IATA transporteur : trois
  -- chiffres, ce sont eux qui ouvrent la lettre de transport aérien.
  scac_code    text check (scac_code is null or scac_code ~ '^[A-Z]{2,4}$'),
  iata_code    text check (iata_code is null or iata_code ~ '^[0-9]{3}$'),
  contact_name text,
  email        text,
  phone        text,
  website      text,
  active       boolean not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists carriers_agency on carriers (agency_id, active, name);

create table if not exists customs_brokers (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies on delete cascade,
  company_name text not null,
  -- Même forme que `customs_declarations.broker_code` posé en 0030 : sept
  -- chiffres et une lettre. La même règle écrite deux fois donnerait deux
  -- vérités le jour où l'une change ; on reprend donc la même expression.
  customs_code text check (customs_code is null or customs_code ~ '^[0-9]{7}[A-Za-z]$'),
  contact_name text,
  phone        text,
  email        text,
  address      text,
  active       boolean not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists customs_brokers_agency on customs_brokers (agency_id, active, company_name);

comment on table suppliers is
  'Répertoire des fournisseurs de l''agence. Il existe pour que « Ningbo Sunrise » ne s''écrive pas de trois façons : trois orthographes font trois fournisseurs pour la douane, et plus aucun total juste.';
comment on column consignees.client_id is
  'Lien facultatif vers un client. En groupage, le destinataire d''un lot peut être une société que l''agence ne facture pas : forcer le lien obligerait à créer de faux clients.';

-- ==================================================================
-- 2 · Les référentiels partagés
-- ==================================================================
--
-- Ni agency_id, ni cloisonnement : un code ISO n'appartient à aucune agence.
-- Tout compte connecté LIT, seule la plateforme ÉCRIT. Recopier ces quatre
-- tables dans chaque agence serait la garantie qu'elles divergent.

create table if not exists countries (
  iso2      char(2) primary key check (iso2 ~ '^[A-Z]{2}$'),
  iso3      char(3) not null check (iso3 ~ '^[A-Z]{3}$'),
  name_fr   text not null,
  name_en   text not null,
  -- L'arabe n'est pas un agrément : l'agence édite des documents pour la
  -- Libye et pour les pays du Golfe, où le nom du pays s'écrit en arabe.
  name_ar   text not null,
  active    boolean not null default true
);

create table if not exists transport_locations (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in (
                 'PORT','AEROPORT','ENTREPOT','BUREAU_DOUANE','POSTE_FRONTIERE')),
  name         text not null,
  -- UN/LOCODE quand il existe, et SEULEMENT quand il est sûr. Un code faux
  -- part dans un message EDI et fait router la marchandise ailleurs.
  code         text check (code is null or code ~ '^[A-Z]{2}[A-Z0-9]{3}$'),
  country_code char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  city         text,
  address      text,
  active       boolean not null default true
);
-- Le code n'est PAS unique tout seul : un UN/LOCODE désigne un LIEU, pas un
-- équipement. TNSFA est Sfax, et Sfax a un port et un aéroport. L'unicité
-- porte donc sur le couple genre + code.
create unique index if not exists transport_locations_kind_code
  on transport_locations (kind, code) where code is not null;
create index if not exists transport_locations_country
  on transport_locations (country_code, kind, name);

create table if not exists hs_codes (
  code           text primary key check (code ~ '^[0-9]{2,10}$'),
  description_fr text not null,
  description_en text not null,
  chapter        char(2) not null check (chapter = left(code, 2)),
  active         boolean not null default true
);
create index if not exists hs_codes_chapter on hs_codes (chapter, code);

create table if not exists incoterms (
  code              text primary key check (code ~ '^[A-Z]{3}$'),
  name_fr           text not null,
  name_en           text not null,
  -- Le point de transfert : c'est LA question que le client pose, et c'est la
  -- réponse qui décide qui paie quand la marchandise est abîmée.
  transfer_point_fr text not null,
  mode              text not null default 'tous' check (mode in ('tous','maritime')),
  version           int  not null default 2020,
  active            boolean not null default true
);

comment on table countries is
  'Les pays utiles au métier, avec leurs codes ISO 3166-1 exacts et leur nom en trois langues. Ce n''est PAS la liste complète des 249 codes : c''est un sélecteur. Aucune table ne pointe dessus par clé étrangère, sinon un vrai fournisseur d''un 250e pays serait refusé.';
comment on table hs_codes is
  'Les 99 CHAPITRES du système harmonisé, à deux chiffres, avec leur intitulé officiel. Les positions à six ou dix chiffres ne sont PAS livrées : la nomenclature tunisienne de dédouanement en compte plusieurs milliers, elle se charge par import, et en inventer une seule ferait déclarer faux. La colonne accepte jusqu''à dix chiffres, l''import s''y coule sans migration.';
comment on table transport_locations is
  'Ports, aéroports, entrepôts, bureaux de douane et postes frontières. Le code UN/LOCODE n''est renseigné que lorsqu''il est sûr : les quatre postes frontières tunisiens n''en ont pas ici, faute de source fiable, et cela vaut mieux qu''un code inventé.';

-- ------------------------------------------------------------------
-- 2.1 · Les pays
-- ------------------------------------------------------------------
-- Codes ISO 3166-1 alpha-2 et alpha-3. Les noms arabes sont les noms usuels,
-- pas des translittérations.

insert into countries (iso2, iso3, name_fr, name_en, name_ar) values
  ('TN','TUN','Tunisie','Tunisia','تونس'),
  ('LY','LBY','Libye','Libya','ليبيا'),
  ('DZ','DZA','Algérie','Algeria','الجزائر'),
  ('MA','MAR','Maroc','Morocco','المغرب'),
  ('EG','EGY','Égypte','Egypt','مصر'),
  ('FR','FRA','France','France','فرنسا'),
  ('IT','ITA','Italie','Italy','إيطاليا'),
  ('ES','ESP','Espagne','Spain','إسبانيا'),
  ('DE','DEU','Allemagne','Germany','ألمانيا'),
  ('BE','BEL','Belgique','Belgium','بلجيكا'),
  ('NL','NLD','Pays-Bas','Netherlands','هولندا'),
  ('GB','GBR','Royaume-Uni','United Kingdom','المملكة المتحدة'),
  ('CH','CHE','Suisse','Switzerland','سويسرا'),
  ('TR','TUR','Turquie','Türkiye','تركيا'),
  ('CN','CHN','Chine','China','الصين'),
  ('AE','ARE','Émirats arabes unis','United Arab Emirates','الإمارات العربية المتحدة'),
  ('SA','SAU','Arabie saoudite','Saudi Arabia','المملكة العربية السعودية'),
  ('QA','QAT','Qatar','Qatar','قطر'),
  ('KW','KWT','Koweït','Kuwait','الكويت'),
  ('US','USA','États-Unis','United States','الولايات المتحدة'),
  ('CA','CAN','Canada','Canada','كندا'),
  ('SN','SEN','Sénégal','Senegal','السنغال'),
  ('CI','CIV','Côte d''Ivoire','Côte d''Ivoire','ساحل العاج'),
  ('ML','MLI','Mali','Mali','مالي'),
  ('NE','NER','Niger','Niger','النيجر'),
  ('TD','TCD','Tchad','Chad','تشاد'),
  ('NG','NGA','Nigeria','Nigeria','نيجيريا'),
  ('GR','GRC','Grèce','Greece','اليونان'),
  ('PT','PRT','Portugal','Portugal','البرتغال'),
  ('AT','AUT','Autriche','Austria','النمسا'),
  ('SE','SWE','Suède','Sweden','السويد'),
  ('DK','DNK','Danemark','Denmark','الدنمارك'),
  ('NO','NOR','Norvège','Norway','النرويج'),
  ('PL','POL','Pologne','Poland','بولندا'),
  ('RO','ROU','Roumanie','Romania','رومانيا'),
  ('CZ','CZE','République tchèque','Czechia','التشيك'),
  ('HU','HUN','Hongrie','Hungary','المجر'),
  ('MT','MLT','Malte','Malta','مالطا'),
  ('CY','CYP','Chypre','Cyprus','قبرص'),
  ('IN','IND','Inde','India','الهند'),
  ('JP','JPN','Japon','Japan','اليابان'),
  ('KR','KOR','Corée du Sud','South Korea','كوريا الجنوبية'),
  ('BR','BRA','Brésil','Brazil','البرازيل'),
  ('RU','RUS','Russie','Russia','روسيا'),
  ('UA','UKR','Ukraine','Ukraine','أوكرانيا')
on conflict (iso2) do update set
  iso3 = excluded.iso3, name_fr = excluded.name_fr,
  name_en = excluded.name_en, name_ar = excluded.name_ar;

-- ------------------------------------------------------------------
-- 2.2 · Les lieux de transport tunisiens
-- ------------------------------------------------------------------
--
-- Les huit ports de commerce et les six aéroports internationaux, avec leur
-- UN/LOCODE. Pour les aéroports, le code de lieu reprend le code IATA de la
-- plateforme, ce qui est la règle des locodes aéroportuaires.
--
-- LES POSTES FRONTIÈRES N'ONT PAS DE CODE ICI, ET C'EST VOULU. Ras Jedir,
-- Dhehiba, Melloula et Bouchebka sont des points de passage routiers bien
-- réels, mais aucune source sûre ne m'a donné leur UN/LOCODE. Un code inventé
-- partirait dans un message de transit et ferait router un camion au mauvais
-- bureau. Le champ reste vide, l'agence le complétera ou l'import le posera.
--
-- LES BUREAUX DE DOUANE NE SONT PAS SEMÉS, pour la même raison : leurs codes
-- officiels ne sont pas publiés dans une source vérifiable.

insert into transport_locations (kind, name, code, country_code, city) values
  -- Ports de commerce. Radès est le port à conteneurs principal ; son tirant
  -- d'eau de -8,8 m est la raison pour laquelle aucune ligne directe d'Asie
  -- n'y touche (voir 0029).
  ('PORT','Port de Radès','TNRDS','TN','Radès'),
  ('PORT','Port de La Goulette','TNLGN','TN','La Goulette'),
  ('PORT','Port de Bizerte','TNBIZ','TN','Bizerte'),
  ('PORT','Port de Sfax','TNSFA','TN','Sfax'),
  ('PORT','Port de Sousse','TNSUS','TN','Sousse'),
  ('PORT','Port de Gabès','TNGAB','TN','Gabès'),
  ('PORT','Port de Zarzis','TNZRZ','TN','Zarzis'),
  ('PORT','Port de La Skhira','TNSKI','TN','La Skhira'),
  -- Aéroports internationaux.
  ('AEROPORT','Aéroport Tunis-Carthage','TNTUN','TN','Tunis'),
  ('AEROPORT','Aéroport Djerba-Zarzis','TNDJE','TN','Djerba'),
  ('AEROPORT','Aéroport Monastir Habib-Bourguiba','TNMIR','TN','Monastir'),
  ('AEROPORT','Aéroport Enfidha-Hammamet','TNNBE','TN','Enfidha'),
  ('AEROPORT','Aéroport Sfax-Thyna','TNSFA','TN','Sfax'),
  ('AEROPORT','Aéroport Tozeur-Nefta','TNTOE','TN','Tozeur'),
  -- Postes frontières. Code volontairement absent : voir le commentaire.
  ('POSTE_FRONTIERE','Ras Jedir (vers la Libye)',null,'TN','Ben Guerdane'),
  ('POSTE_FRONTIERE','Dhehiba (vers la Libye)',null,'TN','Dhehiba'),
  ('POSTE_FRONTIERE','Melloula (vers l''Algérie)',null,'TN','Tabarka'),
  ('POSTE_FRONTIERE','Bouchebka (vers l''Algérie)',null,'TN','Feriana')
on conflict do nothing;

-- Un poste frontière n'a pas de code : `on conflict do nothing` ne le protège
-- donc pas d'un doublon au second passage. On dédoublonne sur le nom.
delete from transport_locations a
 using transport_locations b
 where a.code is null and b.code is null
   and a.name = b.name and a.country_code = b.country_code
   and a.ctid > b.ctid;

-- ------------------------------------------------------------------
-- 2.3 · Les chapitres du système harmonisé
-- ------------------------------------------------------------------
--
-- LES 99 CHAPITRES, ET RIEN D'AUTRE. Les positions à six chiffres et les NDP
-- tunisiennes à dix chiffres ne sont PAS ici : il y en a plusieurs milliers,
-- elles changent, et en écrire une seule de mémoire ferait déclarer faux.
-- La colonne `code` accepte jusqu'à dix chiffres : l'import de la nomenclature
-- complète se coule dedans sans nouvelle migration.
--
-- Les chapitres 77, 98 et 99 sont réservés dans la nomenclature elle-même :
-- 77 pour un usage futur, 98 et 99 aux usages particuliers de chaque pays.
-- Ils sont présents pour que la table couvre bien 01 à 99 sans trou.
insert into hs_codes (code, description_fr, description_en, chapter) values
  ('01', 'Animaux vivants', 'Live animals', '01'),
  ('02', 'Viandes et abats comestibles', 'Meat and edible meat offal', '02'),
  ('03', 'Poissons et crustacés, mollusques et autres invertébrés aquatiques', 'Fish and crustaceans, molluscs and other aquatic invertebrates', '03'),
  ('04', 'Lait et produits de la laiterie; œufs d''oiseaux; miel naturel; produits comestibles d''origine animale, non dénommés ni compris ailleurs', 'Dairy produce; birds'' eggs; natural honey; edible products of animal origin, not elsewhere specified or included', '04'),
  ('05', 'Autres produits d''origine animale, non dénommés ni compris ailleurs', 'Products of animal origin, not elsewhere specified or included', '05'),
  ('06', 'Plantes vivantes et produits de la floriculture', 'Live trees and other plants; bulbs, roots and the like; cut flowers and ornamental foliage', '06'),
  ('07', 'Légumes, plantes, racines et tubercules alimentaires', 'Edible vegetables and certain roots and tubers', '07'),
  ('08', 'Fruits comestibles; écorces d''agrumes ou de melons', 'Edible fruit and nuts; peel of citrus fruit or melons', '08'),
  ('09', 'Café, thé, maté et épices', 'Coffee, tea, maté and spices', '09'),
  ('10', 'Céréales', 'Cereals', '10'),
  ('11', 'Produits de la minoterie; malt; amidons et fécules; inuline; gluten de froment', 'Products of the milling industry; malt; starches; inulin; wheat gluten', '11'),
  ('12', 'Graines et fruits oléagineux; graines, semences et fruits divers; plantes industrielles ou médicinales; pailles et fourrages', 'Oil seeds and oleaginous fruits; miscellaneous grains, seeds and fruit; industrial or medicinal plants; straw and fodder', '12'),
  ('13', 'Gommes, résines et autres sucs et extraits végétaux', 'Lac; gums, resins and other vegetable saps and extracts', '13'),
  ('14', 'Matières à tresser et autres produits d''origine végétale, non dénommés ni compris ailleurs', 'Vegetable plaiting materials; vegetable products not elsewhere specified or included', '14'),
  ('15', 'Graisses et huiles animales, végétales ou d''origine microbienne et produits de leur dissociation; graisses alimentaires élaborées; cires d''origine animale ou végétale', 'Animal, vegetable or microbial fats and oils and their cleavage products; prepared edible fats; animal or vegetable waxes', '15'),
  ('16', 'Préparations de viande, de poissons, de crustacés, de mollusques ou d''autres invertébrés aquatiques, ou d''insectes', 'Preparations of meat, of fish, of crustaceans, molluscs or other aquatic invertebrates, or of insects', '16'),
  ('17', 'Sucres et sucreries', 'Sugars and sugar confectionery', '17'),
  ('18', 'Cacao et ses préparations', 'Cocoa and cocoa preparations', '18'),
  ('19', 'Préparations à base de céréales, de farines, d''amidons, de fécules ou de lait; pâtisseries', 'Preparations of cereals, flour, starch or milk; pastrycooks'' products', '19'),
  ('20', 'Préparations de légumes, de fruits ou d''autres parties de plantes', 'Preparations of vegetables, fruit, nuts or other parts of plants', '20'),
  ('21', 'Préparations alimentaires diverses', 'Miscellaneous edible preparations', '21'),
  ('22', 'Boissons, liquides alcooliques et vinaigres', 'Beverages, spirits and vinegar', '22'),
  ('23', 'Résidus et déchets des industries alimentaires; aliments préparés pour animaux', 'Residues and waste from the food industries; prepared animal fodder', '23'),
  ('24', 'Tabacs et succédanés de tabac fabriqués; produits, contenant ou non de la nicotine, destinés à l''inhalation sans combustion; autres produits contenant de la nicotine destinés à l''absorption de nicotine dans le corps humain', 'Tobacco and manufactured tobacco substitutes; products, whether or not containing nicotine, intended for inhalation without combustion; other nicotine containing products intended for the intake of nicotine into the human body', '24'),
  ('25', 'Sel; soufre; terres et pierres; plâtres, chaux et ciments', 'Salt; sulphur; earths and stone; plastering materials, lime and cement', '25'),
  ('26', 'Minerais, scories et cendres', 'Ores, slag and ash', '26'),
  ('27', 'Combustibles minéraux, huiles minérales et produits de leur distillation; matières bitumineuses; cires minérales', 'Mineral fuels, mineral oils and products of their distillation; bituminous substances; mineral waxes', '27'),
  ('28', 'Produits chimiques inorganiques; composés inorganiques ou organiques de métaux précieux, d''éléments radioactifs, de métaux des terres rares ou d''isotopes', 'Inorganic chemicals; organic or inorganic compounds of precious metals, of rare-earth metals, of radioactive elements or of isotopes', '28'),
  ('29', 'Produits chimiques organiques', 'Organic chemicals', '29'),
  ('30', 'Produits pharmaceutiques', 'Pharmaceutical products', '30'),
  ('31', 'Engrais', 'Fertilisers', '31'),
  ('32', 'Extraits tannants ou tinctoriaux; tanins et leurs dérivés; pigments et autres matières colorantes; peintures et vernis; mastics; encres', 'Tanning or dyeing extracts; tannins and their derivatives; dyes, pigments and other colouring matter; paints and varnishes; putty and other mastics; inks', '32'),
  ('33', 'Huiles essentielles et résinoïdes; produits de parfumerie ou de toilette préparés et préparations cosmétiques', 'Essential oils and resinoids; perfumery, cosmetic or toilet preparations', '33'),
  ('34', 'Savons, agents de surface organiques, préparations pour lessives, préparations lubrifiantes, cires artificielles, cires préparées, produits d''entretien, bougies et articles similaires, pâtes à modeler, cires pour l''art dentaire et compositions pour l''art dentaire à base de plâtre', 'Soap, organic surface-active agents, washing preparations, lubricating preparations, artificial waxes, prepared waxes, polishing or scouring preparations, candles and similar articles, modelling pastes, dental waxes and dental preparations with a basis of plaster', '34'),
  ('35', 'Matières albuminoïdes; produits à base d''amidons ou de fécules modifiés; colles; enzymes', 'Albuminoidal substances; modified starches; glues; enzymes', '35'),
  ('36', 'Poudres et explosifs; articles de pyrotechnie; allumettes; alliages pyrophoriques; matières inflammables', 'Explosives; pyrotechnic products; matches; pyrophoric alloys; certain combustible preparations', '36'),
  ('37', 'Produits photographiques ou cinématographiques', 'Photographic or cinematographic goods', '37'),
  ('38', 'Produits divers des industries chimiques', 'Miscellaneous chemical products', '38'),
  ('39', 'Matières plastiques et ouvrages en ces matières', 'Plastics and articles thereof', '39'),
  ('40', 'Caoutchouc et ouvrages en caoutchouc', 'Rubber and articles thereof', '40'),
  ('41', 'Peaux (autres que les pelleteries) et cuirs', 'Raw hides and skins (other than furskins) and leather', '41'),
  ('42', 'Ouvrages en cuir; articles de bourrellerie ou de sellerie; articles de voyage, sacs à main et contenants similaires; ouvrages en boyaux', 'Articles of leather; saddlery and harness; travel goods, handbags and similar containers; articles of animal gut (other than silk-worm gut)', '42'),
  ('43', 'Pelleteries et fourrures; pelleteries factices', 'Furskins and artificial fur; manufactures thereof', '43'),
  ('44', 'Bois, charbon de bois et ouvrages en bois', 'Wood and articles of wood; wood charcoal', '44'),
  ('45', 'Liège et ouvrages en liège', 'Cork and articles of cork', '45'),
  ('46', 'Ouvrages de sparterie ou de vannerie', 'Manufactures of straw, of esparto or of other plaiting materials; basketware and wickerwork', '46'),
  ('47', 'Pâtes de bois ou d''autres matières fibreuses cellulosiques; papier ou carton à recycler (déchets et rebuts)', 'Pulp of wood or of other fibrous cellulosic material; recovered (waste and scrap) paper or paperboard', '47'),
  ('48', 'Papiers et cartons; ouvrages en pâte de cellulose, en papier ou en carton', 'Paper and paperboard; articles of paper pulp, of paper or of paperboard', '48'),
  ('49', 'Produits de l''édition, de la presse ou des autres industries graphiques; textes manuscrits ou dactylographiés et plans', 'Printed books, newspapers, pictures and other products of the printing industry; manuscripts, typescripts and plans', '49'),
  ('50', 'Soie', 'Silk', '50'),
  ('51', 'Laine, poils fins ou grossiers; fils et tissus de crin', 'Wool, fine or coarse animal hair; horsehair yarn and woven fabric', '51'),
  ('52', 'Coton', 'Cotton', '52'),
  ('53', 'Autres fibres textiles végétales; fils de papier et tissus de fils de papier', 'Other vegetable textile fibres; paper yarn and woven fabrics of paper yarn', '53'),
  ('54', 'Filaments synthétiques ou artificiels; lames et formes similaires en matières textiles synthétiques ou artificielles', 'Man-made filaments; strip and the like of man-made textile materials', '54'),
  ('55', 'Fibres synthétiques ou artificielles discontinues', 'Man-made staple fibres', '55'),
  ('56', 'Ouates, feutres et nontissés; fils spéciaux; ficelles, cordes et cordages; articles de corderie', 'Wadding, felt and nonwovens; special yarns; twine, cordage, ropes and cables and articles thereof', '56'),
  ('57', 'Tapis et autres revêtements de sol en matières textiles', 'Carpets and other textile floor coverings', '57'),
  ('58', 'Tissus spéciaux; surfaces textiles touffetées; dentelles; tapisseries; passementeries; broderies', 'Special woven fabrics; tufted textile fabrics; lace; tapestries; trimmings; embroidery', '58'),
  ('59', 'Tissus imprégnés, enduits, recouverts ou stratifiés; articles techniques en matières textiles', 'Impregnated, coated, covered or laminated textile fabrics; textile articles of a kind suitable for industrial use', '59'),
  ('60', 'Étoffes de bonneterie', 'Knitted or crocheted fabrics', '60'),
  ('61', 'Vêtements et accessoires du vêtement, en bonneterie', 'Articles of apparel and clothing accessories, knitted or crocheted', '61'),
  ('62', 'Vêtements et accessoires du vêtement, autres qu''en bonneterie', 'Articles of apparel and clothing accessories, not knitted or crocheted', '62'),
  ('63', 'Autres articles textiles confectionnés; assortiments; friperie et chiffons', 'Other made up textile articles; sets; worn clothing and worn textile articles; rags', '63'),
  ('64', 'Chaussures, guêtres et articles analogues; parties de ces objets', 'Footwear, gaiters and the like; parts of such articles', '64'),
  ('65', 'Coiffures et parties de coiffures', 'Headgear and parts thereof', '65'),
  ('66', 'Parapluies, ombrelles, parasols, cannes, cannes-sièges, fouets, cravaches et leurs parties', 'Umbrellas, sun umbrellas, walking-sticks, seat-sticks, whips, riding-crops and parts thereof', '66'),
  ('67', 'Plumes et duvet apprêtés et articles en plumes ou en duvet; fleurs artificielles; ouvrages en cheveux', 'Prepared feathers and down and articles made of feathers or of down; artificial flowers; articles of human hair', '67'),
  ('68', 'Ouvrages en pierres, plâtre, ciment, amiante, mica ou matières analogues', 'Articles of stone, plaster, cement, asbestos, mica or similar materials', '68'),
  ('69', 'Produits céramiques', 'Ceramic products', '69'),
  ('70', 'Verre et ouvrages en verre', 'Glass and glassware', '70'),
  ('71', 'Perles fines ou de culture, pierres gemmes ou similaires, métaux précieux, plaqués ou doublés de métaux précieux et ouvrages en ces matières; bijouterie de fantaisie; monnaies', 'Natural or cultured pearls, precious or semi-precious stones, precious metals, metals clad with precious metal, and articles thereof; imitation jewellery; coin', '71'),
  ('72', 'Fonte, fer et acier', 'Iron and steel', '72'),
  ('73', 'Ouvrages en fonte, fer ou acier', 'Articles of iron or steel', '73'),
  ('74', 'Cuivre et ouvrages en cuivre', 'Copper and articles thereof', '74'),
  ('75', 'Nickel et ouvrages en nickel', 'Nickel and articles thereof', '75'),
  ('76', 'Aluminium et ouvrages en aluminium', 'Aluminium and articles thereof', '76'),
  ('77', 'Réservé pour un usage futur éventuel dans le Système harmonisé', 'Reserved for possible future use in the Harmonized System', '77'),
  ('78', 'Plomb et ouvrages en plomb', 'Lead and articles thereof', '78'),
  ('79', 'Zinc et ouvrages en zinc', 'Zinc and articles thereof', '79'),
  ('80', 'Étain et ouvrages en étain', 'Tin and articles thereof', '80'),
  ('81', 'Autres métaux communs; cermets; ouvrages en ces matières', 'Other base metals; cermets; articles thereof', '81'),
  ('82', 'Outils et outillage, articles de coutellerie et couverts de table, en métaux communs; parties de ces articles en métaux communs', 'Tools, implements, cutlery, spoons and forks, of base metal; parts thereof of base metal', '82'),
  ('83', 'Ouvrages divers en métaux communs', 'Miscellaneous articles of base metal', '83'),
  ('84', 'Réacteurs nucléaires, chaudières, machines, appareils et engins mécaniques; parties de ces machines ou appareils', 'Nuclear reactors, boilers, machinery and mechanical appliances; parts thereof', '84'),
  ('85', 'Machines, appareils et matériels électriques et leurs parties; appareils d''enregistrement ou de reproduction du son, appareils d''enregistrement ou de reproduction des images et du son en télévision, et parties et accessoires de ces appareils', 'Electrical machinery and equipment and parts thereof; sound recorders and reproducers; television image and sound recorders and reproducers, and parts and accessories of such articles', '85'),
  ('86', 'Véhicules et matériel pour voies ferrées ou similaires et leurs parties; appareils mécaniques (y compris électromécaniques) de signalisation pour voies de communication', 'Railway or tramway locomotives, rolling-stock and parts thereof; railway or tramway track fixtures and fittings and parts thereof; mechanical (including electro-mechanical) traffic signalling equipment of all kinds', '86'),
  ('87', 'Voitures automobiles, tracteurs, cycles et autres véhicules terrestres, leurs parties et accessoires', 'Vehicles other than railway or tramway rolling-stock, and parts and accessories thereof', '87'),
  ('88', 'Navigation aérienne ou spatiale', 'Aircraft, spacecraft, and parts thereof', '88'),
  ('89', 'Navigation maritime ou fluviale', 'Ships, boats and floating structures', '89'),
  ('90', 'Instruments et appareils d''optique, de photographie ou de cinématographie, de mesure, de contrôle ou de précision; instruments et appareils médico-chirurgicaux; parties et accessoires de ces instruments ou appareils', 'Optical, photographic, cinematographic, measuring, checking, precision, medical or surgical instruments and apparatus; parts and accessories thereof', '90'),
  ('91', 'Horlogerie', 'Clocks and watches and parts thereof', '91'),
  ('92', 'Instruments de musique; parties et accessoires de ces instruments', 'Musical instruments; parts and accessories of such articles', '92'),
  ('93', 'Armes, munitions et leurs parties et accessoires', 'Arms and ammunition; parts and accessories thereof', '93'),
  ('94', 'Meubles; mobilier médico-chirurgical; articles de literie et similaires; luminaires et appareils d''éclairage, non dénommés ni compris ailleurs; lampes-réclames, enseignes lumineuses, plaques indicatrices lumineuses et articles similaires; constructions préfabriquées', 'Furniture; bedding, mattresses, mattress supports, cushions and similar stuffed furnishings; luminaires and lighting fittings, not elsewhere specified or included; illuminated signs, illuminated name-plates and the like; prefabricated buildings', '94'),
  ('95', 'Jouets, jeux, articles pour divertissements ou pour sports; leurs parties et accessoires', 'Toys, games and sports requisites; parts and accessories thereof', '95'),
  ('96', 'Ouvrages divers', 'Miscellaneous manufactured articles', '96'),
  ('97', 'Objets d''art, de collection ou d''antiquité', 'Works of art, collectors'' pieces and antiques', '97'),
  ('98', 'Réservé à des usages particuliers par les parties contractantes', 'Reserved for special uses by the contracting parties', '98'),
  ('99', 'Réservé à des usages particuliers par les parties contractantes', 'Reserved for special uses by the contracting parties', '99')
on conflict (code) do update set
  description_fr = excluded.description_fr, description_en = excluded.description_en;

-- ------------------------------------------------------------------
-- 2.4 · Les onze Incoterms 2020
-- ------------------------------------------------------------------
--
-- Onze, pas six. La migration 0017 avait déjà élargi la contrainte de
-- `shipments.incoterm` pour la même raison : une contrainte qui interdit le
-- bon Incoterm oblige l'agence à en saisir un faux, et toutes les alertes
-- bâties dessus deviennent fausses aussi.
--
-- Quatre sont réservés à la mer et aux voies navigables : FAS, FOB, CFR, CIF.
-- Les proposer sur un vol ou sur un camion n'a aucun sens, il n'y a pas de
-- navire, donc pas de point de transfert. La colonne `mode` sert exactement à
-- ne pas les proposer là, et elle est cohérente avec `incoterm_coherent()`.

insert into incoterms (code, name_fr, name_en, transfer_point_fr, mode) values
  ('EXW','À l''usine','Ex Works',
   'Dans les locaux du vendeur, marchandise mise à disposition NON chargée. L''acheteur supporte même le chargement.','tous'),
  ('FCA','Franco transporteur','Free Carrier',
   'À la remise au transporteur désigné par l''acheteur, au lieu convenu. En groupage, c''est la règle correcte : au terminal de groupage.','tous'),
  ('FAS','Franco le long du navire','Free Alongside Ship',
   'Le long du navire, sur le quai du port d''embarquement convenu.','maritime'),
  ('FOB','Franco à bord','Free On Board',
   'À bord du navire au port d''embarquement. Une faute fréquente en groupage : le vendeur porte le risque pendant l''empotage, sur une marchandise qu''il ne contrôle plus.','maritime'),
  ('CFR','Coût et fret','Cost and Freight',
   'À bord du navire au port d''embarquement. Le vendeur paie le fret jusqu''au port de destination, mais le risque a déjà changé de main.','maritime'),
  ('CIF','Coût, assurance et fret','Cost, Insurance and Freight',
   'À bord du navire au port d''embarquement. Le vendeur assure, au minimum des clauses ICC (C), les plus restrictives.','maritime'),
  ('CPT','Port payé jusqu''à','Carriage Paid To',
   'À la remise au PREMIER transporteur. Le vendeur paie le transport jusqu''à destination, le risque part bien plus tôt.','tous'),
  ('CIP','Port payé, assurance comprise, jusqu''à','Carriage and Insurance Paid To',
   'À la remise au premier transporteur. Le vendeur assure aux clauses ICC (A), les plus larges. C''est CIP, pas CIF, dès que le flux n''est pas strictement port à port.','tous'),
  ('DAP','Rendu au lieu de destination','Delivered at Place',
   'À destination, sur le moyen de transport arrivant, NON déchargé.','tous'),
  ('DPU','Rendu au lieu de destination déchargé','Delivered at Place Unloaded',
   'À destination, une fois DÉCHARGÉ. Le seul Incoterm où le vendeur doit décharger.','tous'),
  ('DDP','Rendu droits acquittés','Delivered Duty Paid',
   'À destination, droits et taxes d''importation acquittés par le vendeur. Le maximum d''obligations pour le vendeur.','tous')
on conflict (code) do update set
  name_fr = excluded.name_fr, name_en = excluded.name_en,
  transfer_point_fr = excluded.transfer_point_fr, mode = excluded.mode;

-- ==================================================================
-- 3 · Le numéro de conteneur, et sa clé de contrôle
-- ==================================================================
--
-- C'est la vérification la plus utile de tout le module. Un numéro mal saisi
-- ne fait pas planter l'application : il fait perdre un conteneur. La
-- recherche chez l'armateur ne rend rien, le terminal ne trouve pas la boîte,
-- et personne ne sait que la faute est une lettre échangée trois semaines
-- plus tôt. La norme ISO 6346 a prévu exactement ce cas.
--
-- La règle, telle que la norme la pose :
--   · quatre lettres (trois pour le propriétaire, une pour la catégorie),
--     six chiffres de série, un septième chiffre qui est la CLÉ ;
--   · chaque lettre vaut un nombre : A vaut 10, puis on avance d'une unité
--     par lettre en SAUTANT tous les multiples de 11 (11, 22, 33). C'est ce
--     saut qu'on oublie, et il décale toutes les lettres à partir de L ;
--   · chaque position est pondérée par 2 puissance son rang, de 1 à 512 ;
--   · la clé est la somme modulo 11, et un reste de 10 s'écrit 0.
--
-- LE MÊME ALGORITHME EXISTE DEUX FOIS, ICI ET DANS web/src/lib/conteneur.ts,
-- VOLONTAIREMENT. Le serveur fait autorité : une contrainte refuse un numéro
-- faux même écrit par l'API. L'écran, lui, doit répondre pendant la frappe,
-- sans aller-retour réseau. Les deux sont tenus par les mêmes vecteurs
-- d'essai, dans supabase/tests/referentiels.sql et dans le banc du front.

create or replace function container_check_digit(p_number text)
returns int
language plpgsql immutable
set search_path = public
as $$
declare
  -- Valeur de A à Z, multiples de 11 sautés. U vaut 32, V vaut 34.
  vals  constant int[] := array[
    10,12,13,14,15,16,17,18,19,20,21,
    23,24,25,26,27,28,29,30,31,32,
    34,35,36,37,38];
  poids constant int[] := array[1,2,4,8,16,32,64,128,256,512];
  s     text;
  i     int;
  c     text;
  total bigint := 0;
begin
  if p_number is null then return null; end if;
  -- Le numéro est écrit « CSQU 305438 3 » sur la boîte et sur le connaissement.
  -- On enlève ce qui n'est ni lettre ni chiffre avant de compter.
  s := upper(regexp_replace(p_number, '[^0-9A-Za-z]', '', 'g'));
  -- On accepte le préfixe seul (dix caractères) comme le numéro complet
  -- (onze) : l'écran a besoin de la clé AVANT que l'agent l'ait tapée.
  if s !~ '^[A-Z]{4}[0-9]{6}[0-9]?$' then return null; end if;

  for i in 1..10 loop
    c := substr(s, i, 1);
    if c >= '0' and c <= '9' then
      total := total + c::int * poids[i];
    else
      total := total + vals[ascii(c) - 64] * poids[i];
    end if;
  end loop;

  -- Un reste de 10 s'écrit 0. C'est la seule irrégularité de la norme, et
  -- c'est celle que les implémentations maison ratent.
  return (total % 11) % 10;
end $$;

comment on function container_check_digit(text) is
  'Clé de contrôle ISO 6346, calculée pour de vrai. Accepte le préfixe seul (10 caractères) ou le numéro complet (11). Rend null si la forme n''est pas celle d''un numéro de conteneur. Vecteur de référence de la norme : CSQU3054383, dont la clé vaut 3.';

create or replace function container_number_valid(p_number text)
returns boolean
language sql immutable
set search_path = public
as $$
  select p_number is null
      or (p_number ~ '^[A-Z]{4}[0-9]{7}$'
          and container_check_digit(p_number) = substr(p_number, 11, 1)::int)
$$;

comment on function container_number_valid(text) is
  'Forme ET clé. La quatrième lettre devrait valoir U, J ou Z (conteneur, équipement détachable, châssis) mais ce n''est PAS une contrainte dure ici : la clé de contrôle attrape déjà la faute de frappe, et refuser une lettre de catégorie inhabituelle bloquerait une saisie légitime pour rien. L''écran le signale en avertissement.';

-- ==================================================================
-- 4 · Le détail physique d'une cargaison
-- ==================================================================

create table if not exists containers (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references agencies on delete cascade,
  shipment_id      uuid not null references shipments on delete cascade,
  container_number text not null,
  container_type   text not null default '40GP' check (container_type in (
                     '20GP','40GP','40HC','45HC','REEFER','OPEN_TOP',
                     'FLAT_RACK','TANK','AUTRE')),
  -- Le plomb. S'il est rompu à l'arrivée, la douane ouvre, et la
  -- responsabilité se joue sur ce numéro.
  seal_number      text,
  gross_weight_kg  numeric(12,2) check (gross_weight_kg is null or gross_weight_kg >= 0),
  net_weight_kg    numeric(12,2) check (net_weight_kg is null or net_weight_kg >= 0),
  volume_cbm       numeric(12,3) check (volume_cbm is null or volume_cbm >= 0),
  -- La tare est gravée sur la porte du conteneur. Brut moins tare donne le
  -- poids de la marchandise, et c'est ce que la douane pèse.
  tare_kg          numeric(12,2) check (tare_kg is null or tare_kg >= 0),
  status           text not null default 'vide' check (status in (
                     'vide','charge','parti','en_transit','arrive',
                     'douane','dedouane','livre','restitue')),
  -- Les deux jalons qui font tourner le compteur de détention (voir 0029).
  gate_out_at      timestamptz,
  returned_at      timestamptz,
  note             text,
  created_at       timestamptz not null default now(),
  -- Une ligne saisie par erreur doit pouvoir sortir de l'écran. Sans ce
  -- champ, et sans droit de suppression, un conteneur tapé deux fois
  -- fausserait les totaux pour toujours. On archive, on n'efface pas.
  deleted_at       timestamptz,
  -- La contrainte qui vaut tout le reste du module.
  constraint containers_number_iso6346 check (container_number_valid(container_number)),
  check (returned_at is null or gate_out_at is null or returned_at >= gate_out_at)
);
-- Deux fois le même conteneur sur une cargaison est une faute de saisie. Mais
-- une ligne archivée ne doit pas empêcher de resaisir le bon numéro.
create unique index if not exists containers_unique_number
  on containers (shipment_id, container_number) where deleted_at is null;
create index if not exists containers_shipment on containers (shipment_id);
create index if not exists containers_agency on containers (agency_id, status);
create index if not exists containers_number on containers (container_number);

comment on constraint containers_number_iso6346 on containers is
  'Un numéro de conteneur faux ne casse rien tout de suite : il fait perdre la boîte. La recherche chez l''armateur ne rend rien, le terminal ne la trouve pas, et personne ne relie la panne à la lettre échangée trois semaines plus tôt.';

-- L'agent recopie ce qu'il lit sur la porte : « CSQU 305438 3 », parfois en
-- minuscules. Le normaliser AVANT de contrôler évite de rejeter une saisie
-- juste pour une espace, ce qui apprend à contourner la vérification.
create or replace function containers_normalize() returns trigger
language plpgsql set search_path = public as $$
begin
  new.container_number := upper(regexp_replace(coalesce(new.container_number, ''), '[^0-9A-Za-z]', '', 'g'));
  if new.seal_number is not null then
    new.seal_number := upper(trim(new.seal_number));
  end if;
  return new;
end $$;

drop trigger if exists containers_normalize_trg on containers;
create trigger containers_normalize_trg before insert or update on containers
  for each row execute function containers_normalize();

create table if not exists packages (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references agencies on delete cascade,
  shipment_id     uuid not null references shipments on delete cascade,
  -- En groupage, un colis appartient au lot d'un client, pas à la cargaison
  -- entière. Sans ce lien, on ne sait pas à qui appartient le carton.
  lot_id          uuid references shipment_lots on delete cascade,
  package_number  text,
  package_type    text not null default 'CARTON' check (package_type in (
                    'CARTON','PALETTE','SAC','CAISSE','FUT','ROULEAU','AUTRE')),
  quantity        int not null default 1 check (quantity > 0),
  gross_weight_kg numeric(12,2) check (gross_weight_kg is null or gross_weight_kg >= 0),
  net_weight_kg   numeric(12,2) check (net_weight_kg is null or net_weight_kg >= 0),
  length_cm       numeric(10,2) check (length_cm is null or length_cm > 0),
  width_cm        numeric(10,2) check (width_cm is null or width_cm > 0),
  height_cm       numeric(10,2) check (height_cm is null or height_cm > 0),
  -- Calculé, jamais saisi. Le volume est ce qui FACTURE en groupage (règle
  -- W/M, voir 0029) : le laisser à la main, c'est laisser deux chiffres qui
  -- se contredisent, et une facture contestée.
  volume_cbm      numeric(14,4) generated always as (
                    (length_cm * width_cm * height_cm) / 1000000.0 * quantity
                  ) stored,
  description     text,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists packages_shipment on packages (shipment_id);
create index if not exists packages_lot on packages (lot_id);

comment on column packages.volume_cbm is
  'Calculé depuis les trois dimensions et la quantité, jamais saisi. En groupage c''est le volume qui facture : deux chiffres qui se contredisent font une facture contestée.';

create table if not exists shipment_goods (
  id                   uuid primary key default gen_random_uuid(),
  agency_id            uuid not null references agencies on delete cascade,
  shipment_id          uuid not null references shipments on delete cascade,
  lot_id               uuid references shipment_lots on delete cascade,
  description          text not null,
  -- La désignation commerciale du fournisseur et la désignation douanière ne
  -- sont pas la même phrase. La douane veut la nature de la marchandise, le
  -- fournisseur écrit une référence catalogue.
  commercial_description text,
  hs_code              text,
  origin_country       char(2) check (origin_country is null or origin_country ~ '^[A-Z]{2}$'),
  quantity             numeric(14,3) check (quantity is null or quantity >= 0),
  unit                 text,
  gross_weight_kg      numeric(12,2) check (gross_weight_kg is null or gross_weight_kg >= 0),
  net_weight_kg        numeric(12,2) check (net_weight_kg is null or net_weight_kg >= 0),
  unit_value           numeric(14,4) check (unit_value is null or unit_value >= 0),
  total_value          numeric(18,4) generated always as (quantity * unit_value) stored,
  currency             char(3) not null default 'USD',
  -- Marchandise dangereuse : le numéro ONU commande l'emballage, l'étiquetage
  -- et parfois le refus de l'armateur. Le savoir au dépôt, pas au quai.
  dangerous_goods      boolean not null default false,
  un_number            text check (un_number is null or un_number ~ '^(UN)?[0-9]{4}$'),
  temperature_min      numeric(6,2),
  temperature_max      numeric(6,2),
  note                 text,
  created_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  check (temperature_min is null or temperature_max is null or temperature_max >= temperature_min)
);
create index if not exists shipment_goods_shipment on shipment_goods (shipment_id);
create index if not exists shipment_goods_lot on shipment_goods (lot_id);
create index if not exists shipment_goods_hs on shipment_goods (hs_code);

comment on column shipment_goods.hs_code is
  'Position tarifaire. Non contrainte par clé étrangère vers hs_codes : la table ne porte que les 99 chapitres, et une position à six ou dix chiffres serait refusée alors qu''elle est juste.';

-- ==================================================================
-- 5 · Le raccordement de l'existant, sans casse
-- ==================================================================
--
-- Les colonnes texte de `shipments` RESTENT. On ajoute des identifiants à
-- côté, et rien de plus. Deux raisons, et la seconde compte plus que la
-- première :
--   1. Des milliers de cargaisons portent déjà « CMA CGM » en toutes lettres.
--      Les convertir maintenant demanderait de deviner à quelle fiche du
--      répertoire chaque texte correspond, et de se tromper en silence.
--   2. Une reprise se décide. Le jour où l'agence range son répertoire, elle
--      rapproche ce qu'elle veut, quand elle veut. Une migration qui écrase
--      « Ningbo Sunrise CO » par une fiche approchante fait perdre la seule
--      trace de ce qui était vraiment écrit sur la facture.

alter table shipments add column if not exists supplier_id        uuid references suppliers on delete set null;
alter table shipments add column if not exists consignee_id       uuid references consignees on delete set null;
alter table shipments add column if not exists shipper_id         uuid references shippers on delete set null;
alter table shipments add column if not exists carrier_id         uuid references carriers on delete set null;
alter table shipments add column if not exists broker_id          uuid references customs_brokers on delete set null;
alter table shipments add column if not exists origin_location_id uuid references transport_locations on delete set null;
alter table shipments add column if not exists dest_location_id   uuid references transport_locations on delete set null;
alter table shipments add column if not exists incoterm_code      text references incoterms on delete restrict;

comment on column shipments.supplier_id is
  'Fiche du répertoire, quand elle existe. La colonne texte `supplier` reste : on ne convertit pas les cargaisons déjà saisies par surprise.';
comment on column shipments.incoterm_code is
  'Incoterm choisi dans le référentiel des onze. La colonne `incoterm` reste, avec sa contrainte de 0017 : les deux disent la même chose, la nouvelle sait en plus si la règle est maritime.';

create index if not exists shipments_supplier on shipments (supplier_id);
create index if not exists shipments_consignee on shipments (consignee_id);

-- ------------------------------------------------------------------
-- 5.1 · L'intervenant résolu : le répertoire d'abord, le texte ensuite
-- ------------------------------------------------------------------
--
-- Prend une LIGNE de shipments, pas un identifiant. PostgREST expose alors la
-- fonction comme une colonne calculée : `select=*,shipment_actors`. L'écran
-- n'a donc rien à recomposer, et le repli sur le texte est fait au même
-- endroit pour tout le monde.
--
-- La règle de repli, tenue partout : si l'identifiant pointe une fiche, c'est
-- elle qui parle, et `source` vaut 'repertoire'. Sinon, s'il reste du texte,
-- on le rend tel quel avec `source` à 'texte'. Sinon null. Jamais de mélange
-- silencieux : l'écran doit pouvoir dire « ceci vient d'une fiche » ou
-- « ceci est ce que quelqu'un a tapé un jour ».

create or replace function shipment_actors(s shipments)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  res jsonb := '{}'::jsonb;
  r   record;
begin
  -- Fournisseur
  select * into r from suppliers where id = s.supplier_id;
  res := res || jsonb_build_object('supplier', case
    when r.id is not null then jsonb_build_object(
      'source','repertoire','id',r.id,'name',r.company_name,'contact',r.contact_name,
      'country',r.country,'city',r.city,'phone',r.phone,'email',r.email,
      'tax_id',r.tax_id)
    when nullif(trim(coalesce(s.supplier, '')), '') is not null then
      jsonb_build_object('source','texte','name',s.supplier)
    end);

  -- Destinataire. Pas de repli : `shipments` n'a jamais eu de colonne texte
  -- pour lui. Le destinataire vivait dans le connaissement, ou nulle part.
  select * into r from consignees where id = s.consignee_id;
  res := res || jsonb_build_object('consignee', case
    when r.id is not null then jsonb_build_object(
      'source','repertoire','id',r.id,'name',r.company_name,'contact',r.contact_name,
      'country',r.country,'city',r.city,'phone',r.phone,'email',r.email,
      'customs_code',r.customs_code,'client_id',r.client_id)
    end);

  -- Expéditeur. Même remarque.
  select * into r from shippers where id = s.shipper_id;
  res := res || jsonb_build_object('shipper', case
    when r.id is not null then jsonb_build_object(
      'source','repertoire','id',r.id,'name',r.company_name,'contact',r.contact_name,
      'country',r.country,'phone',r.phone,'email',r.email)
    end);

  -- Transporteur
  select * into r from carriers where id = s.carrier_id;
  res := res || jsonb_build_object('carrier', case
    when r.id is not null then jsonb_build_object(
      'source','repertoire','id',r.id,'name',r.name,'kind',r.kind,
      'country',r.country,'scac_code',r.scac_code,'iata_code',r.iata_code,
      'phone',r.phone,'email',r.email,'website',r.website)
    when nullif(trim(coalesce(s.carrier, '')), '') is not null then
      jsonb_build_object('source','texte','name',s.carrier)
    end);

  -- Commissionnaire en douane
  select * into r from customs_brokers where id = s.broker_id;
  res := res || jsonb_build_object('broker', case
    when r.id is not null then jsonb_build_object(
      'source','repertoire','id',r.id,'name',r.company_name,'contact',r.contact_name,
      'customs_code',r.customs_code,'phone',r.phone,'email',r.email)
    when nullif(trim(coalesce(s.broker_name, '')), '') is not null then
      jsonb_build_object('source','texte','name',s.broker_name,'phone',s.broker_phone)
    end);

  -- Le manutentionnaire reste en texte : il n'a pas de répertoire, parce que
  -- l'agence en connaît deux ou trois, jamais vingt. On le rend quand même,
  -- pour que l'écran des intervenants soit complet.
  res := res || jsonb_build_object('handler', case
    when nullif(trim(coalesce(s.handler, '')), '') is not null then
      jsonb_build_object('source','texte','name',s.handler)
    end);

  -- Lieux de départ et d'arrivée
  select * into r from transport_locations where id = s.origin_location_id;
  res := res || jsonb_build_object('origin', case
    when r.id is not null then jsonb_build_object(
      'source','referentiel','id',r.id,'name',r.name,'code',r.code,
      'kind',r.kind,'country',r.country_code,'city',r.city)
    when nullif(trim(coalesce(s.origin_port, s.origin_city, '')), '') is not null then
      jsonb_build_object('source','texte','name',coalesce(s.origin_port, s.origin_city),
                         'country',s.country_from)
    end);

  select * into r from transport_locations where id = s.dest_location_id;
  res := res || jsonb_build_object('dest', case
    when r.id is not null then jsonb_build_object(
      'source','referentiel','id',r.id,'name',r.name,'code',r.code,
      'kind',r.kind,'country',r.country_code,'city',r.city)
    when nullif(trim(coalesce(s.dest_port, s.dest_city, '')), '') is not null then
      jsonb_build_object('source','texte','name',coalesce(s.dest_port, s.dest_city),
                         'country',s.country_to)
    end);

  -- Incoterm : le référentiel d'abord, la vieille colonne ensuite. Une règle
  -- maritime sur un vol ou un camion n'a pas de sens : il n'y a pas de navire,
  -- donc pas de point de transfert. Même garde qu'en 0017.
  select * into r from incoterms where code = s.incoterm_code;
  res := res || jsonb_build_object('incoterm', case
    when r.code is not null then jsonb_build_object(
      'source','referentiel','code',r.code,'name_fr',r.name_fr,'name_en',r.name_en,
      'transfer_point_fr',r.transfer_point_fr,'mode',r.mode,
      'coherent', incoterm_coherent(s.mode, r.code))
    when nullif(s.incoterm, '') is not null then
      jsonb_build_object('source','texte','code',s.incoterm,
                         'coherent', incoterm_coherent(s.mode, s.incoterm))
    end);

  return res;
end $$;

comment on function shipment_actors(shipments) is
  'Les intervenants d''une cargaison, résolus. Le répertoire d''abord, le texte en repli, et `source` dit toujours d''où vient le nom. Prend une ligne de shipments : PostgREST l''expose alors comme colonne calculée.';

-- ------------------------------------------------------------------
-- 5.2 · Les totaux, calculés depuis les lignes
-- ------------------------------------------------------------------
--
-- Trois tables portent un poids : conteneurs, colis, marchandises. Les
-- additionner toutes les trois compterait la même caisse trois fois. On
-- prend donc la source la plus proche du physique qui soit renseignée, et
-- ON DIT LAQUELLE. Un total sans sa provenance est un total qu'on ne peut
-- pas contester, donc un total qu'on ne peut pas corriger.
--
-- La valeur déclarée n'est pas additionnée entre devises. Sommer des dollars
-- et des euros parce que les deux sont des nombres est la faute qui fait
-- déclarer faux. On rend un montant PAR devise.

create or replace function shipment_totals(s shipments)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  n_cont   int;
  n_pack   int;
  w_cont   numeric; v_cont numeric;
  w_pack   numeric; v_pack numeric;
  w_goods  numeric;
  n_goods  numeric;
  poids    numeric; volume numeric;
  src_w    text;    src_v  text;
  valeurs  jsonb;
  danger   boolean;
  chapitres jsonb;
begin
  select count(*), sum(gross_weight_kg), sum(volume_cbm)
    into n_cont, w_cont, v_cont
  from containers where shipment_id = s.id and deleted_at is null;

  select coalesce(sum(quantity), 0), sum(gross_weight_kg), sum(volume_cbm)
    into n_pack, w_pack, v_pack
  from packages where shipment_id = s.id and deleted_at is null;

  select sum(gross_weight_kg), count(*)
    into w_goods, n_goods
  from shipment_goods where shipment_id = s.id and deleted_at is null;

  -- Cascade du poids : le conteneur pèse ce que le pont-bascule a dit, le
  -- colis ce que le fournisseur a écrit, la cargaison ce qu'on a supposé.
  if w_cont is not null then poids := w_cont; src_w := 'conteneurs';
  elsif w_pack is not null then poids := w_pack; src_w := 'colis';
  elsif w_goods is not null then poids := w_goods; src_w := 'marchandises';
  elsif s.weight_kg is not null then poids := s.weight_kg; src_w := 'cargaison';
  end if;

  if v_cont is not null then volume := v_cont; src_v := 'conteneurs';
  elsif v_pack is not null then volume := v_pack; src_v := 'colis';
  elsif s.volume_cbm is not null then volume := s.volume_cbm; src_v := 'cargaison';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', round(montant, 2))
                            order by currency), '[]'::jsonb)
    into valeurs
  from (select currency, sum(total_value) as montant
        from shipment_goods
        where shipment_id = s.id and deleted_at is null and total_value is not null
        group by currency) t;

  select bool_or(dangerous_goods) into danger
  from shipment_goods where shipment_id = s.id and deleted_at is null;

  select coalesce(jsonb_agg(distinct left(hs_code, 2)), '[]'::jsonb) into chapitres
  from shipment_goods
  where shipment_id = s.id and deleted_at is null and hs_code is not null;

  return jsonb_build_object(
    'containers', n_cont,
    'packages', n_pack,
    'goods_lines', coalesce(n_goods, 0),
    'gross_weight_kg', poids,
    'weight_source', src_w,
    'volume_cbm', volume,
    'volume_source', src_v,
    -- La règle W/M de 0029, appliquée au total : c'est elle qui facture.
    'chargeable_units', case when poids is not null or volume is not null
                             then round(chargeable_units(poids, volume), 3) end,
    'values', valeurs,
    'dangerous_goods', coalesce(danger, false),
    'hs_chapters', chapitres);
end $$;

comment on function shipment_totals(shipments) is
  'Nombres, poids, volume et valeur déclarée, calculés depuis les lignes. Le poids et le volume ne s''additionnent PAS entre conteneurs, colis et marchandises : ce serait compter la même caisse trois fois. On prend la source la plus physique renseignée, et on la nomme. La valeur reste séparée par devise.';

-- ------------------------------------------------------------------
-- 5.3 · La recherche dans les répertoires
-- ------------------------------------------------------------------
--
-- SECURITY INVOKER, volontairement : les politiques de lignes s'appliquent
-- donc telles quelles, et une agence ne peut pas atteindre le répertoire
-- d'une autre, même en passant par ici. Une fonction DEFINER aurait ouvert
-- une porte dérobée pour gagner une jointure.

create or replace function directory_search(p_kind text, p_query text, p_limit int default 20)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  q   text := '%' || lower(trim(coalesce(p_query, ''))) || '%';
  lim int  := least(greatest(coalesce(p_limit, 20), 1), 100);
  res jsonb;
begin
  if p_kind = 'suppliers' then
    select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into res from (
      select jsonb_build_object('kind','suppliers','id',id,'name',company_name,
             'subtitle',contact_name,'country',country,'city',city,
             'phone',phone,'email',email,'active',active) as x
      from suppliers
      where deleted_at is null
        and (lower(company_name) like q or lower(coalesce(contact_name,'')) like q
             or lower(coalesce(city,'')) like q or coalesce(tax_id,'') like q)
      limit lim) t;
  elsif p_kind = 'consignees' then
    select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into res from (
      select jsonb_build_object('kind','consignees','id',id,'name',company_name,
             'subtitle',contact_name,'country',country,'city',city,
             'phone',phone,'email',email,'active',active) as x
      from consignees
      where deleted_at is null
        and (lower(company_name) like q or lower(coalesce(contact_name,'')) like q
             or lower(coalesce(city,'')) like q or coalesce(customs_code,'') like q)
      limit lim) t;
  elsif p_kind = 'shippers' then
    select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into res from (
      select jsonb_build_object('kind','shippers','id',id,'name',company_name,
             'subtitle',contact_name,'country',country,'city',null,
             'phone',phone,'email',email,'active',active) as x
      from shippers
      where deleted_at is null
        and (lower(company_name) like q or lower(coalesce(contact_name,'')) like q)
      limit lim) t;
  elsif p_kind = 'carriers' then
    select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into res from (
      select jsonb_build_object('kind','carriers','id',id,'name',name,
             'subtitle',kind,'country',country,'city',null,
             'phone',phone,'email',email,'active',active) as x
      from carriers
      where deleted_at is null
        and (lower(name) like q or lower(coalesce(scac_code,'')) like q
             or coalesce(iata_code,'') like q)
      limit lim) t;
  elsif p_kind = 'customs_brokers' then
    select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into res from (
      select jsonb_build_object('kind','customs_brokers','id',id,'name',company_name,
             'subtitle',contact_name,'country',null,'city',null,
             'phone',phone,'email',email,'active',active) as x
      from customs_brokers
      where deleted_at is null
        and (lower(company_name) like q or lower(coalesce(contact_name,'')) like q
             or coalesce(customs_code,'') like q)
      limit lim) t;
  else
    -- Un genre inconnu ne rend pas une liste vide muette : il le dit. Une
    -- faute de frappe dans un appel doit se voir, pas se taire.
    raise exception 'répertoire inconnu : %', p_kind using errcode = '22023';
  end if;
  return res;
end $$;

comment on function directory_search(text, text, int) is
  'Recherche dans un répertoire de l''agence. SECURITY INVOKER : les politiques de lignes s''appliquent, une agence n''atteint jamais le répertoire d''une autre par ici.';

-- ------------------------------------------------------------------
-- 5.4 · Les mêmes, appelables par identifiant
-- ------------------------------------------------------------------
--
-- Les deux fonctions ci-dessus prennent une LIGNE de shipments : PostgREST les
-- expose alors comme colonnes calculées, ce qui évite un aller-retour quand
-- l'écran charge déjà la cargaison. Mais une carte isolée n'a souvent que
-- l'identifiant sous la main. On ajoute donc la même chose en surcharge, sans
-- dupliquer une ligne de logique : elles appellent les premières.
--
-- La lecture de `shipments` reste soumise aux politiques : une agence ne peut
-- pas demander les intervenants de la cargaison d'une autre par ce chemin.

create or replace function shipment_actors(p_shipment uuid)
returns jsonb
language sql stable
set search_path = public
as $$
  select shipment_actors(s) from shipments s where s.id = p_shipment
$$;

create or replace function shipment_totals(p_shipment uuid)
returns jsonb
language sql stable
set search_path = public
as $$
  select shipment_totals(s) from shipments s where s.id = p_shipment
$$;

-- ==================================================================
-- 6 · Sécurité
-- ==================================================================
--
-- Deux régimes, parce qu'il y a deux natures de données.
--
--   · Les répertoires et le détail physique appartiennent à UNE agence. Ils
--     entrent dans le régime commun : RLS activée ET forcée, une politique
--     par opération, lecture par `case:read`, écriture par `shipment:write`.
--     Pas de politique de suppression, pas de droit de suppression : on
--     désactive ou on archive, on n'efface jamais.
--   · Les quatre référentiels partagés n'appartiennent à personne. Tout compte
--     connecté les lit, seule la plateforme les écrit. RLS activée pour que la
--     règle soit portée par la base, pas par la politesse des appelants.

-- ------------------------------------------------------------------
-- 6.1 · Les tables d'agence
-- ------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'suppliers','consignees','shippers','carriers','customs_brokers',
    'containers','packages','shipment_goods'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      -- Un agent ajoute un fournisseur pendant qu'il saisit la cargaison : si
      -- créer une fiche demandait un droit de réglage, il retaperait le nom en
      -- texte libre, et le répertoire ne servirait à rien.
      ('suppliers',       'shipment:write'),
      ('consignees',      'shipment:write'),
      ('shippers',        'shipment:write'),
      ('carriers',        'shipment:write'),
      ('customs_brokers', 'shipment:write'),
      ('containers',      'shipment:write'),
      ('packages',        'shipment:write'),
      ('shipment_goods',  'shipment:write')
    ) as v(tbl, cap)
  loop
    execute format('drop policy if exists %1$s_select on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_insert on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_update on %1$I', spec.tbl);
    execute format('drop policy if exists %1$s_platform_read on %1$I', spec.tbl);
    execute format($f$
      create policy %1$s_select on %1$I for select to authenticated
        using (agency_id = auth_agency_id() and auth_can('case:read'))
    $f$, spec.tbl);
    execute format($f$
      create policy %1$s_insert on %1$I for insert to authenticated
        with check (agency_id = auth_agency_id() and auth_can(%2$L))
    $f$, spec.tbl, spec.cap);
    execute format($f$
      create policy %1$s_update on %1$I for update to authenticated
        using (agency_id = auth_agency_id() and auth_can(%2$L))
        with check (agency_id = auth_agency_id())
    $f$, spec.tbl, spec.cap);
    -- La vue support de la plateforme lit, et ne fait que lire.
    execute format($f$
      create policy %1$s_platform_read on %1$I for select to authenticated
        using (is_platform_admin())
    $f$, spec.tbl);
  end loop;
end $$;

-- Aucune suppression dure. Attention au piège : la migration 0015 a posé un
-- `alter default privileges ... grant select, insert, update, delete on tables
-- to authenticated`. Toute table créée après en hérite, y compris DELETE. Ne
-- pas l'accorder ne suffit donc pas, il faut le REPRENDRE. Le banc le vérifie.
grant select, insert, update on
  suppliers, consignees, shippers, carriers, customs_brokers,
  containers, packages, shipment_goods
  to authenticated;
revoke delete on
  suppliers, consignees, shippers, carriers, customs_brokers,
  containers, packages, shipment_goods
  from authenticated;
grant all on
  suppliers, consignees, shippers, carriers, customs_brokers,
  containers, packages, shipment_goods
  to service_role;

-- ------------------------------------------------------------------
-- 6.2 · Les référentiels partagés
-- ------------------------------------------------------------------
--
-- RLS activée, PAS forcée. La différence compte ici : le propriétaire de la
-- table doit pouvoir semer et corriger la nomenclature depuis une migration,
-- sans se battre contre ses propres politiques.

do $$
declare t text;
begin
  foreach t in array array['countries','transport_locations','hs_codes','incoterms'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %1$s_read on %1$I', t);
    execute format('drop policy if exists %1$s_insert on %1$I', t);
    execute format('drop policy if exists %1$s_update on %1$I', t);
    -- Un code ISO n'est le secret de personne. Toute agence connectée lit.
    execute format($f$
      create policy %1$s_read on %1$I for select to authenticated using (true)
    $f$, t);
    -- Écriture réservée à la plateforme. Une agence qui pourrait corriger un
    -- code ISO le corrigerait pour toutes les autres.
    execute format($f$
      create policy %1$s_insert on %1$I for insert to authenticated
        with check (is_platform_admin())
    $f$, t);
    execute format($f$
      create policy %1$s_update on %1$I for update to authenticated
        using (is_platform_admin()) with check (is_platform_admin())
    $f$, t);
  end loop;
end $$;

grant select, insert, update on countries, transport_locations, hs_codes, incoterms to authenticated;
-- Même reprise que plus haut : le DELETE hérité de 0015 n'a rien à faire sur
-- une nomenclature partagée. Effacer un chapitre du système harmonisé le
-- ferait disparaître pour toutes les agences.
revoke delete on countries, transport_locations, hs_codes, incoterms from authenticated;
grant all on countries, transport_locations, hs_codes, incoterms to service_role;

-- ------------------------------------------------------------------
-- 6.3 · Les fonctions
-- ------------------------------------------------------------------
--
-- PostgreSQL accorde EXECUTE à PUBLIC par défaut. Sans reprise explicite,
-- une fonction écrite un mardi est ouverte à l'anonyme le mercredi. Le banc
-- des droits le vérifie, table par table et fonction par fonction.

do $$
declare f text;
begin
  foreach f in array array[
    'container_check_digit(text)', 'container_number_valid(text)',
    'shipment_actors(shipments)', 'shipment_totals(shipments)',
    'shipment_actors(uuid)', 'shipment_totals(uuid)',
    'directory_search(text, text, int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- La fonction de gâchette n'a aucun appelant légitime : le déclencheur la
-- lance tout seul, sans droit d'exécution. On la ferme à tout le monde.
revoke all on function public.containers_normalize() from public, anon, authenticated;

-- ==================================================================
-- 9 · Ce qui n'a PAS été inventé
-- ==================================================================
--
-- Relevé exhaustif, pour que personne ne cherche demain ce qui manque en
-- croyant à un oubli. Chaque ligne est un refus, pas une lacune.
--
--   1. LES UN/LOCODE DES QUATRE POSTES FRONTIÈRES. Ras Jedir, Dhehiba,
--      Melloula et Bouchebka sont semés avec un code VIDE. Ces points de
--      passage existent, mais aucune source sûre ne m'a donné leur code de
--      lieu. Un code inventé partirait dans un message de transit.
--   2. LES CODES DES BUREAUX DE DOUANE. Le genre BUREAU_DOUANE existe dans la
--      table, aucun bureau n'est semé : leurs codes officiels ne sont pas
--      publiés dans une source vérifiable.
--   3. LES POSITIONS TARIFAIRES À SIX ET DIX CHIFFRES. Seuls les 99 chapitres
--      sont livrés. La nomenclature tunisienne de dédouanement en compte
--      plusieurs milliers ; en écrire une de mémoire ferait déclarer faux, et
--      le redressement suit. Elle se charge par import.
--   4. LES TAUX DE DROITS PAR POSITION. Rien ici, comme en 0030 : ils
--      dépendent de la position tarifaire, et le FODEC n'a pas de barème
--      public par position.
--   5. LES CODES SCAC ET LES PRÉFIXES IATA DES TRANSPORTEURS. Les colonnes
--      existent avec leur forme contrôlée, aucun transporteur n'est semé :
--      attribuer « CMDU » au mauvais armateur ferait suivre le mauvais
--      conteneur.
--   6. LES PRÉFIXES DE PROPRIÉTAIRE DE CONTENEUR (les trois premières lettres,
--      attribuées par le BIC). La clé de contrôle suffit à attraper la faute
--      de frappe ; une liste de préfixes incomplète refuserait des conteneurs
--      qui existent.
--   7. LES 249 CODES PAYS. Quarante-cinq pays semés, ceux du métier. Aucune
--      clé étrangère ne pointe dessus, précisément pour que le 46e passe.
