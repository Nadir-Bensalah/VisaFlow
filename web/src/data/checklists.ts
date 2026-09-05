import type { ChecklistTemplate } from './types'

/* Les listes de pieces sont le vrai savoir du metier : ce que chaque
   consulat exige, dans son ordre a lui. Elles se modifient dans les reglages,
   sans toucher au code. */

export const CHECKLISTS: Omit<ChecklistTemplate, 'agencyId'>[] = [
  {
    id: 'cl_chine_affaires',
    name: { fr: 'Chine, visa affaires', en: 'China, business visa', ar: 'الصين، تأشيرة أعمال', zh: '中国商务签证' },
    items: [
      { key: 'passeport', required: true, label: { fr: 'Passeport valable 6 mois', en: 'Passport valid 6 months', ar: 'جواز سفر صالح 6 أشهر', zh: '护照（有效期6个月以上）' }, help: { fr: 'Deux pages vierges face à face.', en: 'Two blank facing pages.', ar: 'صفحتان فارغتان متقابلتان.', zh: '需两页连续空白页。' } },
      { key: 'photo', required: true, label: { fr: 'Photo 33 x 48 mm, fond blanc', en: 'Photo 33 x 48 mm, white background', ar: 'صورة 33×48 مم بخلفية بيضاء', zh: '白底照片 33×48 毫米' } },
      { key: 'formulaire', required: true, label: { fr: 'Formulaire COVA signé', en: 'Signed COVA form', ar: 'استمارة COVA ممضاة', zh: 'COVA 表格（签字）' } },
      { key: 'invitation', required: true, label: { fr: 'Lettre d’invitation chinoise', en: 'Chinese invitation letter', ar: 'رسالة دعوة صينية', zh: '中方邀请函' }, help: { fr: 'Cachet de l’entreprise chinoise obligatoire.', en: 'Chinese company stamp required.', ar: 'ختم الشركة الصينية إجباري.', zh: '必须加盖中方公司公章。' } },
      { key: 'registre', required: true, label: { fr: 'Registre de commerce tunisien', en: 'Tunisian trade register', ar: 'السجل التجاري التونسي', zh: '突尼斯营业执照' }, validityDays: 90 },
      { key: 'billet', required: true, label: { fr: 'Réservation de vol', en: 'Flight booking', ar: 'حجز الطيران', zh: '机票预订单' } },
      { key: 'hotel', required: true, label: { fr: 'Réservation d’hôtel', en: 'Hotel booking', ar: 'حجز الفندق', zh: '酒店预订单' } },
      { key: 'banque', required: true, label: { fr: 'Relevé bancaire, 3 derniers mois', en: 'Bank statement, last 3 months', ar: 'كشف حساب بنكي لآخر 3 أشهر', zh: '近三个月银行流水' }, validityDays: 90 },
      { key: 'assurance', required: false, label: { fr: 'Assurance voyage', en: 'Travel insurance', ar: 'تأمين السفر', zh: '旅行保险' } },
    ],
  },
  {
    id: 'cl_schengen_tourisme',
    name: { fr: 'Schengen, tourisme', en: 'Schengen, tourism', ar: 'شنغن، سياحة', zh: '申根旅游签证' },
    items: [
      { key: 'passeport', required: true, label: { fr: 'Passeport valable 3 mois après le retour', en: 'Passport valid 3 months after return', ar: 'جواز سفر صالح 3 أشهر بعد العودة', zh: '护照（回程后至少3个月有效）' } },
      { key: 'photo', required: true, label: { fr: 'Photo 35 x 45 mm', en: 'Photo 35 x 45 mm', ar: 'صورة 35×45 مم', zh: '照片 35×45 毫米' } },
      { key: 'formulaire', required: true, label: { fr: 'Formulaire Schengen signé', en: 'Signed Schengen form', ar: 'استمارة شنغن ممضاة', zh: '申根表格（签字）' } },
      { key: 'assurance', required: true, label: { fr: 'Assurance 30 000 €', en: 'Insurance 30,000 EUR', ar: 'تأمين بـ 30 ألف أورو', zh: '3万欧元医疗保险' } },
      { key: 'hebergement', required: true, label: { fr: 'Hébergement ou attestation d’accueil', en: 'Accommodation or host certificate', ar: 'الإقامة أو شهادة استضافة', zh: '住宿证明或邀请函' } },
      { key: 'billet', required: true, label: { fr: 'Réservation aller-retour', en: 'Return flight booking', ar: 'حجز ذهاب وإياب', zh: '往返机票预订单' } },
      { key: 'banque', required: true, label: { fr: 'Relevé bancaire, 3 derniers mois', en: 'Bank statement, last 3 months', ar: 'كشف حساب بنكي لآخر 3 أشهر', zh: '近三个月银行流水' }, validityDays: 90 },
      { key: 'travail', required: true, label: { fr: 'Attestation de travail', en: 'Employment certificate', ar: 'شهادة عمل', zh: '在职证明' }, validityDays: 90 },
      { key: 'conge', required: false, label: { fr: 'Autorisation de congé', en: 'Leave authorisation', ar: 'رخصة عطلة', zh: '准假证明' } },
      { key: 'cnss', required: false, label: { fr: 'Affiliation CNSS', en: 'Social security record', ar: 'انخراط الضمان الاجتماعي', zh: '社保记录' } },
    ],
  },
  {
    id: 'cl_schengen_affaires',
    name: { fr: 'Schengen, affaires', en: 'Schengen, business', ar: 'شنغن، أعمال', zh: '申根商务签证' },
    items: [
      { key: 'passeport', required: true, label: { fr: 'Passeport valable 3 mois après le retour', en: 'Passport valid 3 months after return', ar: 'جواز سفر صالح 3 أشهر بعد العودة', zh: '护照（回程后至少3个月有效）' } },
      { key: 'photo', required: true, label: { fr: 'Photo 35 x 45 mm', en: 'Photo 35 x 45 mm', ar: 'صورة 35×45 مم', zh: '照片 35×45 毫米' } },
      { key: 'formulaire', required: true, label: { fr: 'Formulaire Schengen signé', en: 'Signed Schengen form', ar: 'استمارة شنغن ممضاة', zh: '申根表格（签字）' } },
      { key: 'invitation', required: true, label: { fr: 'Invitation de l’entreprise européenne', en: 'European company invitation', ar: 'دعوة من الشركة الأوروبية', zh: '欧洲公司邀请函' } },
      { key: 'registre', required: true, label: { fr: 'Registre de commerce', en: 'Trade register', ar: 'السجل التجاري', zh: '营业执照' }, validityDays: 90 },
      { key: 'assurance', required: true, label: { fr: 'Assurance 30 000 €', en: 'Insurance 30,000 EUR', ar: 'تأمين بـ 30 ألف أورو', zh: '3万欧元医疗保险' } },
      { key: 'billet', required: true, label: { fr: 'Réservation aller-retour', en: 'Return flight booking', ar: 'حجز ذهاب وإياب', zh: '往返机票预订单' } },
      { key: 'banque', required: true, label: { fr: 'Relevé bancaire société', en: 'Company bank statement', ar: 'كشف حساب الشركة', zh: '公司银行流水' }, validityDays: 90 },
    ],
  },
  {
    id: 'cl_maroc',
    name: { fr: 'Maroc', en: 'Morocco', ar: 'المغرب', zh: '摩洛哥' },
    items: [
      { key: 'passeport', required: true, label: { fr: 'Passeport valable 6 mois', en: 'Passport valid 6 months', ar: 'جواز سفر صالح 6 أشهر', zh: '护照（有效期6个月以上）' } },
      { key: 'photo', required: true, label: { fr: 'Deux photos d’identité', en: 'Two ID photos', ar: 'صورتان شمسيتان', zh: '两张证件照' } },
      { key: 'formulaire', required: true, label: { fr: 'Formulaire de demande', en: 'Application form', ar: 'استمارة الطلب', zh: '申请表' } },
      { key: 'billet', required: true, label: { fr: 'Réservation de vol', en: 'Flight booking', ar: 'حجز الطيران', zh: '机票预订单' } },
      { key: 'hotel', required: true, label: { fr: 'Réservation d’hôtel', en: 'Hotel booking', ar: 'حجز الفندق', zh: '酒店预订单' } },
      { key: 'travail', required: false, label: { fr: 'Attestation de travail', en: 'Employment certificate', ar: 'شهادة عمل', zh: '在职证明' } },
    ],
  },
  {
    id: 'cl_thailande',
    name: { fr: 'Thaïlande', en: 'Thailand', ar: 'تايلندا', zh: '泰国' },
    items: [
      { key: 'passeport', required: true, label: { fr: 'Passeport valable 6 mois', en: 'Passport valid 6 months', ar: 'جواز سفر صالح 6 أشهر', zh: '护照（有效期6个月以上）' } },
      { key: 'photo', required: true, label: { fr: 'Photo 40 x 60 mm', en: 'Photo 40 x 60 mm', ar: 'صورة 40×60 مم', zh: '照片 40×60 毫米' } },
      { key: 'formulaire', required: true, label: { fr: 'Formulaire thaïlandais', en: 'Thai application form', ar: 'الاستمارة التايلندية', zh: '泰国申请表' } },
      { key: 'billet', required: true, label: { fr: 'Billet aller-retour confirmé', en: 'Confirmed return ticket', ar: 'تذكرة ذهاب وإياب مؤكدة', zh: '已出票往返机票' } },
      { key: 'hotel', required: true, label: { fr: 'Réservation d’hôtel', en: 'Hotel booking', ar: 'حجز الفندق', zh: '酒店预订单' } },
      { key: 'banque', required: true, label: { fr: 'Relevé bancaire, solde suffisant', en: 'Bank statement with sufficient balance', ar: 'كشف حساب برصيد كاف', zh: '银行流水（余额充足）' }, validityDays: 90 },
    ],
  },
  {
    id: 'cl_canton',
    name: { fr: 'Foire de Canton, forfait', en: 'Canton Fair package', ar: 'معرض كانتون، صيغة كاملة', zh: '广交会套餐' },
    items: [
      { key: 'passeport', required: true, label: { fr: 'Passeport valable 6 mois', en: 'Passport valid 6 months', ar: 'جواز سفر صالح 6 أشهر', zh: '护照（有效期6个月以上）' } },
      { key: 'photo', required: true, label: { fr: 'Photo 33 x 48 mm', en: 'Photo 33 x 48 mm', ar: 'صورة 33×48 مم', zh: '照片 33×48 毫米' } },
      { key: 'formulaire', required: true, label: { fr: 'Formulaire COVA signé', en: 'Signed COVA form', ar: 'استمارة COVA ممضاة', zh: 'COVA 表格（签字）' } },
      { key: 'badge', required: true, label: { fr: 'Badge acheteur de la foire', en: 'Fair buyer badge', ar: 'شارة المشتري بالمعرض', zh: '广交会采购商证' } },
      { key: 'registre', required: true, label: { fr: 'Registre de commerce', en: 'Trade register', ar: 'السجل التجاري', zh: '营业执照' }, validityDays: 90 },
      { key: 'banque', required: true, label: { fr: 'Relevé bancaire, 3 derniers mois', en: 'Bank statement, last 3 months', ar: 'كشف حساب بنكي لآخر 3 أشهر', zh: '近三个月银行流水' }, validityDays: 90 },
      { key: 'hotel', required: false, label: { fr: 'Hébergement à Guangzhou', en: 'Accommodation in Guangzhou', ar: 'الإقامة في قوانغتشو', zh: '广州住宿' }, help: { fr: 'Inclus dans le forfait agence.', en: 'Included in the agency package.', ar: 'مضمن في صيغة الوكالة.', zh: '已含在公司套餐内。' } },
    ],
  },
]
