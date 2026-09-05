import { CHECKLISTS } from './checklists'
import type {
  Agency, Appointment, AutomationRule, CaseDocument, CaseSource, ActivityEvent, Client,
  Database, DocState, Incoterm, Locale, Message, MessageTemplate, Payment, Priority, Shipment,
  ShipmentDocument, ShipmentEvent, ShipmentMode, ShipmentStage, Stage, Task, User,
  VisaCase, VisaType,
} from './types'
import { findTenant } from '@/tenant'

/* Jeu de demonstration. Deterministe : le meme tirage a chaque chargement,
   mais les dates sont calees sur aujourd'hui pour que la demo reste vivante. */

function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rnd = mulberry32(20260905)
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]
const between = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1))
const chance = (p: number) => rnd() < p

/** Date ISO decalee de n jours (et h heures) par rapport a maintenant. */
function d(days: number, hour?: number): string {
  const t = new Date()
  t.setDate(t.getDate() + days)
  if (hour !== undefined) t.setHours(hour, [0, 15, 30, 45][between(0, 3)], 0, 0)
  return t.toISOString()
}

const STAGES: Stage[] = ['nouveau', 'pieces', 'verification', 'rendez_vous', 'depot', 'consulat', 'decision', 'retrait', 'clos']

/* ------------------------------------------------------------------ */
/* Agence                                                              */
/* ------------------------------------------------------------------ */

function buildAgency(slug: string): Agency {
  const brand = findTenant(slug)
  return {
    id: `ag_${slug}`,
    slug,
    name: brand.name,
    legalName: `${brand.name} SARL`,
    mark: brand.mark,
    accent: brand.accent,
    email: `contact@${slug}.tn`,
    phone: '+216 58 746 997',
    website: `https://${slug}.visaflow.app`,
    locales: ['fr', 'en', 'ar', 'zh'],
    defaultLocale: 'fr',
    currency: 'TND',
    plan: 'multi_bureaux',
    inpdpRef: 'À déclarer',
    offices: [
      { id: 'of_tunis', name: 'Tunis', city: 'Tunis', country: 'Tunisie', countryCode: 'TN', phone: '+216 58 746 997', address: '85 rue de Palestine, immeuble Jérusalem, 1002 Tunis', timezone: 'Africa/Tunis' },
      { id: 'of_tripoli', name: 'Tripoli', city: 'Tripoli', country: 'Libye', countryCode: 'LY', phone: '+218 91 238 4046', address: 'Tripoli', timezone: 'Africa/Tripoli' },
      { id: 'of_canton', name: 'Guangzhou', city: 'Guangzhou', country: 'Chine', countryCode: 'CN', phone: '+86 158 7654 4291', address: 'Guangzhou, Guangdong', timezone: 'Asia/Shanghai' },
    ],
  }
}

/* ------------------------------------------------------------------ */
/* Equipe                                                              */
/* ------------------------------------------------------------------ */

const USERS: Omit<User, 'agencyId'>[] = [
  { id: 'u_slim', name: 'Slim Ayari', email: 'slim@tca-ltd.com', phone: '+216 58 746 997', role: 'owner', officeId: 'of_tunis', locale: 'fr', active: true },
  { id: 'u_amira', name: 'Amira Belhadj', email: 'amira@tca-ltd.com', phone: '+216 58 746 998', role: 'manager', officeId: 'of_tunis', locale: 'fr', active: true },
  { id: 'u_nizar', name: 'Nizar Ouerghi', email: 'nizar@tca-ltd.com', role: 'agent', officeId: 'of_tunis', locale: 'fr', active: true },
  { id: 'u_rania', name: 'Rania Msakni', email: 'rania@tca-ltd.com', role: 'agent', officeId: 'of_tunis', locale: 'ar', active: true },
  { id: 'u_hatem', name: 'Hatem Zarrouk', email: 'hatem@tca-ltd.com', role: 'agent', officeId: 'of_tripoli', locale: 'ar', active: true },
  { id: 'u_li', name: 'Li Wei', email: 'liwei@tca-ltd.com', role: 'agent', officeId: 'of_canton', locale: 'zh', active: true },
]

/* ------------------------------------------------------------------ */
/* Types de visa                                                       */
/* ------------------------------------------------------------------ */

const VISA_TYPES: Omit<VisaType, 'agencyId'>[] = [
  { id: 'vt_cn_aff', countryCode: 'CN', country: { fr: 'Chine', en: 'China', ar: 'الصين', zh: '中国' }, label: { fr: 'Affaires 48 h', en: 'Business 48h', ar: 'أعمال 48 ساعة', zh: '商务 48 小时' }, category: 'affaires', processingDays: 3, feeAgency: 420, feeConsulate: 260, checklistId: 'cl_chine_affaires', active: true, stages: STAGES },
  { id: 'vt_cn_tour', countryCode: 'CN', country: { fr: 'Chine', en: 'China', ar: 'الصين', zh: '中国' }, label: { fr: 'Tourisme', en: 'Tourism', ar: 'سياحة', zh: '旅游' }, category: 'tourisme', processingDays: 8, feeAgency: 380, feeConsulate: 260, checklistId: 'cl_chine_affaires', active: true, stages: STAGES },
  { id: 'vt_canton', countryCode: 'CN', country: { fr: 'Chine', en: 'China', ar: 'الصين', zh: '中国' }, label: { fr: 'Foire de Canton', en: 'Canton Fair', ar: 'معرض كانتون', zh: '广交会' }, category: 'affaires', processingDays: 6, feeAgency: 1450, feeConsulate: 260, checklistId: 'cl_canton', active: true, stages: STAGES },
  { id: 'vt_fr_tour', countryCode: 'FR', country: { fr: 'France', en: 'France', ar: 'فرنسا', zh: '法国' }, label: { fr: 'Schengen tourisme', en: 'Schengen tourism', ar: 'شنغن سياحة', zh: '申根旅游' }, category: 'tourisme', processingDays: 18, feeAgency: 340, feeConsulate: 300, checklistId: 'cl_schengen_tourisme', active: true, stages: STAGES },
  { id: 'vt_nl_aff', countryCode: 'NL', country: { fr: 'Pays-Bas', en: 'Netherlands', ar: 'هولندا', zh: '荷兰' }, label: { fr: 'Schengen affaires', en: 'Schengen business', ar: 'شنغن أعمال', zh: '申根商务' }, category: 'affaires', processingDays: 15, feeAgency: 390, feeConsulate: 300, checklistId: 'cl_schengen_affaires', active: true, stages: STAGES },
  { id: 'vt_ma', countryCode: 'MA', country: { fr: 'Maroc', en: 'Morocco', ar: 'المغرب', zh: '摩洛哥' }, label: { fr: 'Court séjour', en: 'Short stay', ar: 'إقامة قصيرة', zh: '短期停留' }, category: 'tourisme', processingDays: 10, feeAgency: 220, feeConsulate: 120, checklistId: 'cl_maroc', active: true, stages: STAGES },
  { id: 'vt_th', countryCode: 'TH', country: { fr: 'Thaïlande', en: 'Thailand', ar: 'تايلندا', zh: '泰国' }, label: { fr: 'Tourisme', en: 'Tourism', ar: 'سياحة', zh: '旅游' }, category: 'tourisme', processingDays: 9, feeAgency: 300, feeConsulate: 180, checklistId: 'cl_thailande', active: true, stages: STAGES },
]

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

const PEOPLE: { first: string; last: string; native?: string; locale: Locale; office: string; nat: string }[] = [
  { first: 'Mohamed', last: 'Bouazizi', native: 'محمد البوعزيزي', locale: 'ar', office: 'of_tunis', nat: 'Tunisienne' },
  { first: 'Sonia', last: 'Kefi', locale: 'fr', office: 'of_tunis', nat: 'Tunisienne' },
  { first: 'Karim', last: 'Jelassi', locale: 'fr', office: 'of_tunis', nat: 'Tunisienne' },
  { first: 'Ines', last: 'Hamdi', locale: 'fr', office: 'of_tunis', nat: 'Tunisienne' },
  { first: 'Walid', last: 'Ben Romdhane', native: 'وليد بن رمضان', locale: 'ar', office: 'of_tunis', nat: 'Tunisienne' },
  { first: 'Nour', last: 'Sassi', locale: 'fr', office: 'of_tunis', nat: 'Tunisienne' },
  { first: 'Bilel', last: 'Khalfaoui', locale: 'ar', office: 'of_tunis', nat: 'Tunisienne' },
  { first: 'Salma', last: 'Dridi', locale: 'fr', office: 'of_tunis', nat: 'Tunisienne' },
  { first: 'Anis', last: 'Mabrouk', locale: 'fr', office: 'of_tunis', nat: 'Tunisienne' },
  { first: 'Yasmine', last: 'Chaouch', locale: 'en', office: 'of_tunis', nat: 'Tunisienne' },
  { first: 'Abdelhakim', last: 'Al Mansouri', native: 'عبد الحكيم المنصوري', locale: 'ar', office: 'of_tripoli', nat: 'Libyenne' },
  { first: 'Fatima', last: 'Al Werfalli', native: 'فاطمة الورفلي', locale: 'ar', office: 'of_tripoli', nat: 'Libyenne' },
  { first: 'Omar', last: 'Ben Ghazi', native: 'عمر بن غازي', locale: 'ar', office: 'of_tripoli', nat: 'Libyenne' },
  { first: 'Khaled', last: 'Al Zawi', native: 'خالد الزاوي', locale: 'ar', office: 'of_tripoli', nat: 'Libyenne' },
  { first: 'Chen', last: 'Hao', native: '陈浩', locale: 'zh', office: 'of_canton', nat: 'Chinoise' },
  { first: 'Zhang', last: 'Min', native: '张敏', locale: 'zh', office: 'of_canton', nat: 'Chinoise' },
  { first: 'Hedi', last: 'Trabelsi', locale: 'fr', office: 'of_tunis', nat: 'Tunisienne' },
  { first: 'Leila', last: 'Ferchichi', locale: 'fr', office: 'of_tunis', nat: 'Tunisienne' },
  { first: 'Sofiene', last: 'Gharbi', locale: 'fr', office: 'of_tunis', nat: 'Tunisienne' },
  { first: 'Rym', last: 'Bouchnak', locale: 'ar', office: 'of_tunis', nat: 'Tunisienne' },
]

/* ------------------------------------------------------------------ */
/* Modeles de message                                                  */
/* ------------------------------------------------------------------ */

const TEMPLATES: Omit<MessageTemplate, 'agencyId'>[] = [
  {
    id: 'tpl_piece', key: 'piece_manquante', channel: 'whatsapp',
    name: { fr: 'Pièce manquante', en: 'Missing document', ar: 'وثيقة ناقصة', zh: '缺失材料' },
    variables: ['client', 'reference', 'piece'],
    body: {
      fr: 'Bonjour {client}, pour votre dossier {reference} il nous manque encore : {piece}. Vous pouvez la photographier et nous l’envoyer ici. Merci.',
      en: 'Hello {client}, for your application {reference} we are still missing: {piece}. You can photograph it and send it here. Thank you.',
      ar: 'مرحبا {client}، بخصوص ملفكم {reference} ما زالت تنقصنا: {piece}. يمكنكم تصويرها وإرسالها هنا. شكرا.',
      zh: '{client} 您好，您的申请 {reference} 还缺少：{piece}。请拍照后发到这里，谢谢。',
    },
  },
  {
    id: 'tpl_rdv', key: 'rappel_rdv', channel: 'whatsapp',
    name: { fr: 'Rappel de rendez-vous', en: 'Appointment reminder', ar: 'تذكير بالموعد', zh: '预约提醒' },
    variables: ['client', 'date', 'lieu'],
    body: {
      fr: 'Bonjour {client}, rappel de votre rendez-vous le {date} à {lieu}. Venez avec votre passeport original.',
      en: 'Hello {client}, reminder of your appointment on {date} at {lieu}. Please bring your original passport.',
      ar: 'مرحبا {client}، تذكير بموعدكم يوم {date} في {lieu}. يرجى إحضار جواز السفر الأصلي.',
      zh: '{client} 您好，提醒您 {date} 在 {lieu} 有预约，请携带护照原件。',
    },
  },
  {
    id: 'tpl_depose', key: 'dossier_depose', channel: 'whatsapp',
    name: { fr: 'Dossier déposé', en: 'Application submitted', ar: 'تم إيداع الملف', zh: '已递交' },
    variables: ['client', 'reference', 'pays'],
    body: {
      fr: 'Bonjour {client}, votre dossier {reference} a été déposé au consulat de {pays}. Nous vous prévenons dès la décision.',
      en: 'Hello {client}, your application {reference} has been submitted to the {pays} consulate. We will let you know as soon as there is a decision.',
      ar: 'مرحبا {client}، تم إيداع ملفكم {reference} لدى قنصلية {pays}. سنعلمكم فور صدور القرار.',
      zh: '{client} 您好，您的申请 {reference} 已递交至 {pays} 领事馆，出结果后我们会第一时间通知您。',
    },
  },
  {
    id: 'tpl_pret', key: 'passeport_pret', channel: 'whatsapp',
    name: { fr: 'Passeport à retirer', en: 'Passport ready', ar: 'جواز السفر جاهز', zh: '护照可领取' },
    variables: ['client', 'bureau'],
    body: {
      fr: 'Bonne nouvelle {client}, votre passeport est disponible au bureau de {bureau}. Ouvert du lundi au samedi, de 8 h à 18 h.',
      en: 'Good news {client}, your passport is available at our {bureau} office. Open Monday to Saturday, 8am to 6pm.',
      ar: 'خبر سار {client}، جواز سفركم متوفر بمكتب {bureau}. مفتوح من الاثنين إلى السبت من 8 صباحا إلى 6 مساء.',
      zh: '{client}，好消息，您的护照已到 {bureau} 办公室，可前来领取。周一至周六 8:00 至 18:00。',
    },
  },
  {
    id: 'tpl_solde', key: 'solde_restant', channel: 'whatsapp',
    name: { fr: 'Solde restant', en: 'Outstanding balance', ar: 'الرصيد المتبقي', zh: '尾款提醒' },
    variables: ['client', 'montant'],
    body: {
      fr: 'Bonjour {client}, il reste {montant} à régler sur votre dossier. Le règlement se fait à l’agence.',
      en: 'Hello {client}, {montant} is still due on your application. Payment is made at the agency.',
      ar: 'مرحبا {client}، ما زال {montant} مستحقا على ملفكم. الخلاص يتم بالوكالة.',
      zh: '{client} 您好，您的申请还有 {montant} 尾款，请到公司结清。',
    },
  },
]

/* ------------------------------------------------------------------ */
/* Regles d'automatisation                                             */
/* ------------------------------------------------------------------ */

const RULES: Omit<AutomationRule, 'agencyId'>[] = [
  { id: 'r_1', name: { fr: 'Relancer une pièce oubliée', en: 'Chase a forgotten document', ar: 'تذكير بوثيقة منسية', zh: '催办遗漏材料' }, trigger: { type: 'piece_manquante_depuis', days: 3 }, action: { type: 'message_client', templateKey: 'piece_manquante', channel: 'whatsapp' }, active: true, runs: 148, lastRunAt: d(0, 8) },
  { id: 'r_2', name: { fr: 'Rappeler le rendez-vous la veille', en: 'Remind the appointment the day before', ar: 'تذكير بالموعد قبل يوم', zh: '预约前一天提醒' }, trigger: { type: 'rendez_vous_dans', days: 1 }, action: { type: 'message_client', templateKey: 'rappel_rdv', channel: 'whatsapp' }, active: true, runs: 96, lastRunAt: d(0, 7) },
  { id: 'r_3', name: { fr: 'Alerter sur un passeport trop court', en: 'Flag a passport expiring too soon', ar: 'تنبيه بجواز سفر قارب على الانتهاء', zh: '护照有效期不足预警' }, trigger: { type: 'passeport_expire_dans', days: 180 }, action: { type: 'alerte_interne', text: { fr: 'Passeport valable moins de 6 mois, vérifier avant le dépôt.', en: 'Passport valid less than 6 months, check before submission.', ar: 'جواز سفر صالح لأقل من 6 أشهر، تحقق قبل الإيداع.', zh: '护照有效期不足6个月，递交前需核对。' } }, active: true, runs: 31, lastRunAt: d(-1, 9) },
  { id: 'r_4', name: { fr: 'Réveiller un dossier endormi', en: 'Wake a stalled application', ar: 'إيقاظ ملف راكد', zh: '唤醒停滞申请' }, trigger: { type: 'dossier_sans_activite', days: 7 }, action: { type: 'tache_agent' }, active: true, runs: 62, lastRunAt: d(-2, 10) },
  { id: 'r_5', name: { fr: 'Réclamer le solde avant le départ', en: 'Ask for the balance before departure', ar: 'المطالبة بالرصيد قبل السفر', zh: '出发前催收尾款' }, trigger: { type: 'depart_dans', days: 7 }, action: { type: 'message_client', templateKey: 'solde_restant', channel: 'whatsapp' }, active: true, runs: 44, lastRunAt: d(-1, 16) },
  { id: 'r_6', name: { fr: 'Prévenir dès le dépôt au consulat', en: 'Notify on consulate submission', ar: 'إعلام عند الإيداع بالقنصلية', zh: '递交领事馆即通知' }, trigger: { type: 'etape_atteinte', stage: 'consulat' }, action: { type: 'message_client', templateKey: 'dossier_depose', channel: 'whatsapp' }, active: true, runs: 187, lastRunAt: d(0, 11) },
  { id: 'r_7', name: { fr: 'Annoncer le passeport prêt', en: 'Announce the passport is ready', ar: 'إعلام بجاهزية الجواز', zh: '通知护照可领取' }, trigger: { type: 'etape_atteinte', stage: 'retrait' }, action: { type: 'message_client', templateKey: 'passeport_pret', channel: 'whatsapp' }, active: true, runs: 173, lastRunAt: d(0, 12) },
  { id: 'r_8', name: { fr: 'Signaler un impayé de plus de 15 jours', en: 'Flag an unpaid balance over 15 days', ar: 'الإبلاغ عن دين تجاوز 15 يوما', zh: '欠款超15天预警' }, trigger: { type: 'solde_impaye_depuis', days: 15 }, action: { type: 'alerte_interne', text: { fr: 'Solde impayé depuis plus de deux semaines.', en: 'Balance unpaid for more than two weeks.', ar: 'رصيد غير مدفوع منذ أكثر من أسبوعين.', zh: '尾款已逾期两周以上。' } }, active: false, runs: 12, lastRunAt: d(-9, 15) },
]

/* ------------------------------------------------------------------ */
/* Construction du jeu complet                                         */
/* ------------------------------------------------------------------ */

const DOC_STATES_BY_STAGE: Record<Stage, DocState[]> = {
  nouveau: ['manquante', 'manquante', 'demandee'],
  pieces: ['manquante', 'demandee', 'recue', 'validee'],
  verification: ['recue', 'validee', 'validee', 'refusee'],
  rendez_vous: ['validee'],
  depot: ['validee'],
  consulat: ['validee'],
  decision: ['validee'],
  retrait: ['validee'],
  clos: ['validee'],
}

const NOTES = [
  'Client pressé, départ confirmé. À traiter en priorité.',
  'Passeport en cours de renouvellement, vérifier la date avant le dépôt.',
  'Deuxième demande après un refus en 2024, joindre la lettre d’explication.',
  'Client fidèle, quatrième dossier avec nous.',
  'Attention, le nom sur le billet ne correspond pas au passeport.',
  'Dossier monté avec le partenaire de Sfax.',
]


/* ------------------------------------------------------------------ */
/* Cargaisons                                                          */
/* ------------------------------------------------------------------ */

export const SHIPMENT_STAGES: ShipmentStage[] = [
  'demande', 'ramassage', 'entrepot', 'empotage', 'depart', 'transit', 'arrivee', 'douane', 'livraison', 'livre',
]

const LANES: { mode: ShipmentMode; originCity: string; originPort: string; destCity: string; destPort: string; countryTo: string; days: number }[] = [
  { mode: 'maritime_fcl', originCity: 'Guangzhou', originPort: 'Nansha', destCity: 'Tunis', destPort: 'Radès', countryTo: 'TN', days: 34 },
  { mode: 'maritime_lcl', originCity: 'Shenzhen', originPort: 'Yantian', destCity: 'Tunis', destPort: 'Radès', countryTo: 'TN', days: 38 },
  { mode: 'maritime_fcl', originCity: 'Shanghai', originPort: 'Shanghai', destCity: 'Misrata', destPort: 'Misrata', countryTo: 'LY', days: 32 },
  { mode: 'maritime_lcl', originCity: 'Yiwu', originPort: 'Ningbo', destCity: 'Tripoli', destPort: 'Al Khums', countryTo: 'LY', days: 36 },
  { mode: 'aerien', originCity: 'Guangzhou', originPort: 'CAN', destCity: 'Tunis', destPort: 'TUN', countryTo: 'TN', days: 5 },
  { mode: 'routier', originCity: 'Tunis', originPort: 'Radès', destCity: 'Tripoli', destPort: 'Ras Jedir', countryTo: 'LY', days: 3 },
]

const GOODS: { fr: string; en: string; ar: string; zh: string }[] = [
  { fr: 'Pièces détachées automobiles', en: 'Car spare parts', ar: 'قطع غيار سيارات', zh: '汽车配件' },
  { fr: 'Textile et prêt-à-porter', en: 'Textile and ready-to-wear', ar: 'نسيج وملابس جاهزة', zh: '纺织与成衣' },
  { fr: 'Électroménager', en: 'Home appliances', ar: 'أجهزة كهرومنزلية', zh: '家用电器' },
  { fr: 'Quincaillerie et outillage', en: 'Hardware and tools', ar: 'خردوات وأدوات', zh: '五金与工具' },
  { fr: 'Accessoires téléphonie', en: 'Phone accessories', ar: 'ملحقات الهواتف', zh: '手机配件' },
  { fr: 'Mobilier de bureau', en: 'Office furniture', ar: 'أثاث مكتبي', zh: '办公家具' },
  { fr: 'Matériel médical', en: 'Medical equipment', ar: 'معدات طبية', zh: '医疗器械' },
]

const SUPPLIERS = [
  'Guangzhou Hengtai Trading Co.',
  'Shenzhen Bright Star Ltd.',
  'Yiwu Sunrise Import & Export',
  'Ningbo Fortune Industrial',
  'Shanghai Golden Bridge Co.',
]

const SHIPMENT_DOCS: { key: string; label: { fr: string; en: string; ar: string; zh: string }; required: boolean }[] = [
  { key: 'facture', required: true, label: { fr: 'Facture commerciale', en: 'Commercial invoice', ar: 'الفاتورة التجارية', zh: '商业发票' } },
  { key: 'packing', required: true, label: { fr: 'Liste de colisage', en: 'Packing list', ar: 'قائمة التعبئة', zh: '装箱单' } },
  { key: 'bl', required: true, label: { fr: 'Connaissement', en: 'Bill of lading', ar: 'سند الشحن', zh: '提单' } },
  { key: 'origine', required: true, label: { fr: 'Certificat d’origine', en: 'Certificate of origin', ar: 'شهادة المنشأ', zh: '原产地证' } },
  { key: 'titre', required: true, label: { fr: 'Titre de commerce extérieur', en: 'Import licence', ar: 'رخصة التوريد', zh: '进口许可' } },
  { key: 'douane', required: false, label: { fr: 'Déclaration en douane', en: 'Customs declaration', ar: 'التصريح الديواني', zh: '报关单' } },
]

function buildShipments(agencyId: string, clients: Client[], users: User[], cases: VisaCase[]) {
  const shipments: Shipment[] = []
  const shipmentDocs: ShipmentDocument[] = []
  const shipmentEvents: ShipmentEvent[] = []

  const plan: ShipmentStage[] = [
    'demande', 'ramassage', 'entrepot', 'empotage', 'depart',
    'transit', 'transit', 'transit', 'arrivee', 'douane',
    'douane', 'livraison', 'livre', 'livre',
  ]

  plan.forEach((stage, i) => {
    const lane = LANES[i % LANES.length]
    const client = clients[(i * 3) % clients.length]
    const agent = users.find((u) => u.officeId === 'of_canton') ?? users[2]
    const goods = GOODS[i % GOODS.length]
    const stageIndex = SHIPMENT_STAGES.indexOf(stage)
    const delivered = stage === 'livre'
    const etdOffset = delivered ? -lane.days - between(3, 20) : -between(0, Math.max(1, Math.round(lane.days * 0.7)))
    const etaOffset = etdOffset + lane.days
    const id = `sh_${i + 1}`
    const fcl = lane.mode === 'maritime_fcl'
    const volume = lane.mode === 'aerien' ? Number((rnd() * 3 + 0.4).toFixed(1)) : fcl ? 58 : Number((rnd() * 12 + 1.2).toFixed(1))
    const weight = Math.round(volume * (lane.mode === 'aerien' ? 180 : 320))
    const freight = lane.mode === 'aerien' ? Math.round(weight * 12) : fcl ? between(9000, 13500) : Math.round(volume * between(620, 780))
    const value = between(12000, 90000)

    shipments.push({
      id, agencyId, reference: `EXP-2026-${String(30 + i).padStart(4, '0')}`,
      clientId: client.id,
      caseId: cases.find((c) => c.clientId === client.id)?.id,
      mode: lane.mode,
      supplier: SUPPLIERS[i % SUPPLIERS.length],
      goods,
      originCity: lane.originCity, originPort: lane.originPort,
      destCity: lane.destCity, destPort: lane.destPort,
      countryFrom: lane.mode === 'routier' ? 'TN' : 'CN', countryTo: lane.countryTo,
      incoterm: (['FOB', 'CFR', 'CIF', 'EXW', 'DAP'] as Incoterm[])[i % 5],
      containerNo: stageIndex >= 3 && lane.mode !== 'aerien' ? `TCLU${between(1000000, 9999999)}` : undefined,
      blNumber: stageIndex >= 4 ? `${lane.mode === 'aerien' ? '157-' : 'COSU'}${between(10000000, 99999999)}` : undefined,
      packages: lane.mode === 'aerien' ? between(3, 24) : between(40, 620),
      weightKg: weight, volumeCbm: volume,
      declaredValue: value, freightCost: freight,
      customsDuty: stageIndex >= 7 ? Math.round(value * 0.18) : undefined,
      amountPaid: delivered ? freight : stageIndex >= 4 ? Math.round(freight * 0.5) : 0,
      stage, status: delivered ? 'livree' : stage === 'douane' && chance(0.3) ? 'bloquee' : 'en_cours',
      etd: d(etdOffset), eta: d(etaOffset),
      deliveredAt: delivered ? d(etaOffset + between(1, 5)) : undefined,
      assigneeId: agent.id, officeId: client.officeId,
      portalToken: `shp_${id}_${Math.floor(rnd() * 1e9).toString(36)}`,
      notes: chance(0.3) ? 'Marchandise fragile, prévoir palettisation au départ de l’entrepôt.' : undefined,
    })

    SHIPMENT_DOCS.forEach((doc, k) => {
      const state: DocState = stageIndex >= 6 ? 'validee' : stageIndex >= 3 ? (k < 3 ? 'validee' : 'demandee') : k === 0 ? 'recue' : 'manquante'
      shipmentDocs.push({
        id: `${id}_${doc.key}`, shipmentId: id, key: doc.key, label: doc.label,
        state: doc.required ? state : stageIndex >= 7 ? 'validee' : 'manquante',
        required: doc.required,
        fileName: ['recue', 'validee'].includes(state) ? `${doc.key}_${id}.pdf` : undefined,
        receivedAt: ['recue', 'validee'].includes(state) ? d(-between(1, 25)) : undefined,
        reminders: state === 'demandee' ? between(0, 2) : 0,
      })
    })

    // Le fil de suivi : une ligne par etape franchie, jamais inventee au-dela.
    SHIPMENT_STAGES.slice(0, stageIndex + 1).forEach((st, k) => {
      shipmentEvents.push({
        id: `${id}_ev_${k}`, shipmentId: id, stage: st,
        at: d(etdOffset - (stageIndex - k) * between(1, 4)),
        location:
          st === 'ramassage' || st === 'entrepot' || st === 'empotage' ? lane.originCity
          : st === 'depart' ? lane.originPort
          : st === 'transit' ? 'En mer'
          : st === 'arrivee' || st === 'douane' ? lane.destPort
          : lane.destCity,
      })
    })
  })

  return { shipments, shipmentDocs, shipmentEvents }
}

export function buildSeed(slug: string): Database {
  const agency = buildAgency(slug)
  const agencyId = agency.id
  const users: User[] = USERS.map((u) => ({ ...u, agencyId }))
  const visaTypes: VisaType[] = VISA_TYPES.map((v) => ({ ...v, agencyId }))
  const checklists = CHECKLISTS.map((c) => ({ ...c, agencyId }))
  const templates: MessageTemplate[] = TEMPLATES.map((t) => ({ ...t, agencyId }))
  const rules: AutomationRule[] = RULES.map((r) => ({ ...r, agencyId }))

  const clients: Client[] = PEOPLE.map((p, i) => ({
    id: `cl_${i + 1}`,
    agencyId,
    firstName: p.first,
    lastName: p.last,
    nativeName: p.native,
    email: `${p.first.toLowerCase()}.${p.last.toLowerCase().replace(/\s/g, '')}@example.tn`,
    phone: p.office === 'of_tripoli' ? `+218 91 ${between(200, 999)} ${between(1000, 9999)}` : p.office === 'of_canton' ? `+86 13${between(100000000, 999999999)}` : `+216 ${between(20, 99)} ${between(100, 999)} ${between(100, 999)}`,
    whatsapp: undefined,
    nationality: p.nat,
    passportNumber: `${p.nat === 'Libyenne' ? 'L' : p.nat === 'Chinoise' ? 'E' : 'T'}${between(100000, 999999)}`,
    passportExpiry: d(between(60, 1800)),
    birthDate: d(-between(7000, 20000)),
    address: p.office === 'of_tripoli' ? 'Tripoli, Libye' : p.office === 'of_canton' ? 'Guangzhou, Chine' : 'Tunis, Tunisie',
    locale: p.locale,
    tags: chance(0.25) ? ['fidèle'] : [],
    createdAt: d(-between(20, 900)),
    officeId: p.office,
  }))
  clients.forEach((c) => { c.whatsapp = c.phone })

  const cases: VisaCase[] = []
  const documents: CaseDocument[] = []
  const messages: Message[] = []
  const appointments: Appointment[] = []
  const payments: Payment[] = []
  const events: ActivityEvent[] = []
  const tasks: Task[] = []

  const stagePlan: Stage[] = [
    'nouveau', 'nouveau', 'pieces', 'pieces', 'pieces', 'pieces', 'pieces',
    'verification', 'verification', 'verification', 'rendez_vous', 'rendez_vous',
    'depot', 'depot', 'consulat', 'consulat', 'consulat', 'decision',
    'retrait', 'retrait', 'clos', 'clos', 'clos', 'clos', 'clos', 'clos', 'clos', 'clos',
  ]

  stagePlan.forEach((stage, i) => {
    const client = clients[i % clients.length]
    const visa = visaTypes[between(0, visaTypes.length - 1)]
    const checklist = checklists.find((c) => c.id === visa.checklistId)!
    const agent = pick(users.filter((u) => u.officeId === client.officeId && u.role !== 'owner')) ?? users[2]
    const ageDays = stage === 'clos' ? between(30, 160) : between(1, 45)
    const openedAt = d(-ageDays)
    const closed = stage === 'clos'
    const status = closed ? (chance(0.88) ? 'accepte' : 'refuse') : 'ouvert'
    const travelIn = closed ? -between(1, 40) : between(4, 90)
    const ref = `VF-2026-${String(140 + i).padStart(4, '0')}`
    const total = visa.feeAgency + visa.feeConsulate
    const paidRatio = closed ? 1 : STAGES.indexOf(stage) >= 4 ? (chance(0.75) ? 1 : 0.5) : chance(0.5) ? 0.5 : 0
    const caseId = `ca_${i + 1}`
    const priority: Priority = travelIn <= 10 && !closed ? 'urgente' : travelIn <= 21 && !closed ? 'haute' : chance(0.2) ? 'basse' : 'normale'

    cases.push({
      id: caseId, agencyId, reference: ref, clientId: client.id, visaTypeId: visa.id,
      officeId: client.officeId, assigneeId: agent.id, stage, status, priority,
      source: pick<CaseSource>(['comptoir', 'whatsapp', 'site', 'recommandation', 'partenaire']),
      openedAt, updatedAt: d(-between(0, Math.min(ageDays, 12))),
      travelDate: d(travelIn), dueAt: d(travelIn - 7),
      consulateRef: STAGES.indexOf(stage) >= 5 ? `${visa.countryCode}${between(100000, 999999)}` : undefined,
      decisionAt: closed ? d(-between(1, 20)) : undefined,
      refusalReason: status === 'refuse' ? 'Justificatifs financiers jugés insuffisants par le consulat.' : undefined,
      amountTotal: total, amountPaid: Math.round(total * paidRatio),
      notes: chance(0.35) ? pick(NOTES) : undefined,
      portalToken: `tok_${caseId}_${Math.floor(rnd() * 1e9).toString(36)}`,
    })

    // Pieces du dossier
    checklist.items.forEach((item, k) => {
      const pool = DOC_STATES_BY_STAGE[stage]
      let state: DocState = pool[Math.min(k, pool.length - 1)]
      if (!item.required && stage !== 'clos' && chance(0.4)) state = 'manquante'
      if (state === 'refusee' && !chance(0.35)) state = 'validee'
      const requestedAt = state === 'manquante' ? undefined : d(-between(1, Math.max(2, ageDays)))
      documents.push({
        id: `doc_${caseId}_${item.key}`, caseId, key: item.key, label: item.label,
        state, required: item.required, requestedAt,
        receivedAt: ['recue', 'validee', 'refusee'].includes(state) ? d(-between(0, 8)) : undefined,
        validatedAt: state === 'validee' ? d(-between(0, 6)) : undefined,
        validatedBy: state === 'validee' ? agent.id : undefined,
        rejectionReason: state === 'refusee' ? 'Document illisible, merci de reprendre la photo à plat.' : undefined,
        expiresAt: item.validityDays ? d(between(-10, 80)) : undefined,
        fileName: ['recue', 'validee', 'refusee'].includes(state) ? `${item.key}_${client.lastName.toLowerCase()}.jpg` : undefined,
        reminders: state === 'demandee' ? between(0, 3) : 0,
        lastReminderAt: state === 'demandee' ? d(-between(1, 9)) : undefined,
      })
    })

    // Reglements
    payments.push({
      id: `pay_${caseId}_1`, agencyId, caseId,
      label: { fr: 'Honoraires agence', en: 'Agency fee', ar: 'أتعاب الوكالة', zh: '公司服务费' },
      amount: visa.feeAgency, state: paidRatio >= 0.5 ? 'regle' : 'du',
      method: paidRatio >= 0.5 ? pick(['especes', 'virement', 'carte'] as const) : undefined,
      at: paidRatio >= 0.5 ? d(-between(1, ageDays)) : undefined,
      dueAt: d(travelIn - 14),
      receiptNo: paidRatio >= 0.5 ? `R-${between(1000, 9999)}` : undefined,
    })
    payments.push({
      id: `pay_${caseId}_2`, agencyId, caseId,
      label: { fr: 'Frais de consulat', en: 'Consulate fee', ar: 'معلوم القنصلية', zh: '领事馆费用' },
      amount: visa.feeConsulate, state: paidRatio >= 1 ? 'regle' : 'du',
      method: paidRatio >= 1 ? 'especes' : undefined,
      at: paidRatio >= 1 ? d(-between(1, ageDays)) : undefined,
      dueAt: d(travelIn - 10),
      receiptNo: paidRatio >= 1 ? `R-${between(1000, 9999)}` : undefined,
    })

    // Rendez vous
    if (['rendez_vous', 'depot', 'consulat', 'decision', 'retrait'].includes(stage)) {
      appointments.push({
        id: `ap_${caseId}`, agencyId, caseId,
        kind: stage === 'retrait' ? 'retrait' : stage === 'rendez_vous' ? 'agence' : 'consulat',
        at: stage === 'rendez_vous' ? d(between(0, 9), between(9, 16)) : d(-between(1, 15), between(9, 16)),
        durationMin: 30,
        location: stage === 'consulat' || stage === 'depot' ? `Consulat de ${visa.country.fr}, Tunis` : agency.offices.find((o) => o.id === client.officeId)!.address,
        status: stage === 'rendez_vous' ? 'prevu' : 'fait',
      })
    }

    // Fil de messages
    const msgCount = between(2, 6)
    for (let m = 0; m < msgCount; m++) {
      const outgoing = m % 2 === 0
      const auto = outgoing && chance(0.45)
      messages.push({
        id: `ms_${caseId}_${m}`, agencyId, caseId,
        channel: chance(0.8) ? 'whatsapp' : chance(0.5) ? 'email' : 'portail',
        direction: outgoing ? 'sortant' : 'entrant',
        body: outgoing
          ? auto
            ? `Bonjour ${client.firstName}, pour votre dossier ${ref} il nous manque encore une pièce. Vous pouvez la photographier et nous l’envoyer ici. Merci.`
            : pick([
                `Bonjour ${client.firstName}, votre dossier avance bien, je vous tiens au courant demain.`,
                `Nous avons bien reçu vos documents, je vérifie et je reviens vers vous.`,
                `Le rendez-vous est confirmé, pensez au passeport original.`,
              ])
          : pick([
              'Bonjour, voici le document demandé.',
              'D’accord, merci beaucoup.',
              'Est-ce que j’aurai le visa avant mon départ ?',
              'Je passe demain matin à l’agence.',
            ]),
        locale: client.locale,
        authorId: outgoing ? agent.id : undefined,
        templateKey: auto ? 'piece_manquante' : undefined,
        at: d(-between(0, Math.min(ageDays, 20)), between(8, 18)),
        status: outgoing ? pick(['envoye', 'remis', 'lu'] as const) : 'lu',
        automated: auto,
      })
    }

    // Journal
    events.push({
      id: `ev_${caseId}_open`, agencyId, caseId, clientId: client.id, actorId: agent.id,
      type: 'dossier_cree', at: openedAt, automated: false,
      detail: { fr: `Dossier ${ref} ouvert pour ${client.firstName} ${client.lastName}.`, en: `Application ${ref} opened for ${client.firstName} ${client.lastName}.`, ar: `فتح الملف ${ref} لفائدة ${client.firstName} ${client.lastName}.`, zh: `已为 ${client.firstName} ${client.lastName} 建立申请 ${ref}。` },
    })
    if (STAGES.indexOf(stage) >= 5) {
      events.push({
        id: `ev_${caseId}_depot`, agencyId, caseId, actorId: agent.id, type: 'etape_changee',
        at: d(-between(1, 14)), automated: false,
        detail: { fr: `Dossier déposé au consulat de ${visa.country.fr}.`, en: `Application submitted to the ${visa.country.en ?? visa.country.fr} consulate.`, ar: `تم إيداع الملف لدى قنصلية ${visa.country.ar ?? visa.country.fr}.`, zh: `申请已递交至${visa.country.zh ?? visa.country.fr}领事馆。` },
      })
    }
    if (closed) {
      events.push({
        id: `ev_${caseId}_dec`, agencyId, caseId, actorId: agent.id, type: 'decision_recue',
        at: d(-between(1, 12)), automated: false,
        detail: status === 'accepte'
          ? { fr: 'Visa accordé, passeport récupéré au consulat.', en: 'Visa granted, passport collected from the consulate.', ar: 'تم منح التأشيرة واسترجاع الجواز من القنصلية.', zh: '签证已获批，护照已从领事馆取回。' }
          : { fr: 'Visa refusé, motif transmis au client.', en: 'Visa refused, reason shared with the client.', ar: 'رفضت التأشيرة، وأُعلم العميل بالسبب.', zh: '签证被拒，已告知客户原因。' },
      })
    }
  })

  // Taches ouvertes, dont celles creees par les regles
  const openCases = cases.filter((c) => c.status === 'ouvert')
  openCases.slice(0, 7).forEach((c, i) => {
    tasks.push({
      id: `tk_${i}`, agencyId, caseId: c.id, assigneeId: c.assigneeId,
      title: pick([
        { fr: 'Rappeler le client, sans réponse depuis une semaine', en: 'Call the client, silent for a week', ar: 'الاتصال بالعميل، لا رد منذ أسبوع', zh: '致电客户，已一周无回复' },
        { fr: 'Vérifier la validité du passeport avant le dépôt', en: 'Check passport validity before submission', ar: 'التثبت من صلوحية الجواز قبل الإيداع', zh: '递交前核对护照有效期' },
        { fr: 'Réserver le créneau au consulat', en: 'Book the consulate slot', ar: 'حجز موعد بالقنصلية', zh: '预约领事馆时段' },
        { fr: 'Encaisser le solde avant le départ', en: 'Collect the balance before departure', ar: 'تحصيل الرصيد قبل السفر', zh: '出发前收取尾款' },
      ]),
      dueAt: d(between(-2, 6), 12), done: false, createdAt: d(-between(1, 8)), automated: chance(0.5),
    })
  })

  events.sort((a, b) => b.at.localeCompare(a.at))
  messages.sort((a, b) => a.at.localeCompare(b.at))

  const { shipments, shipmentDocs, shipmentEvents } = buildShipments(agencyId, clients, users, cases)

  return {
    version: 1, agency, users, clients, visaTypes, checklists, cases, documents,
    messages, templates, appointments, payments, rules, events, tasks,
    shipments, shipmentDocs, shipmentEvents,
  }
}
