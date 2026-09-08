/* Bloc de traduction du module « réglages ».

   Il ne porte QUE ce que la réorganisation a créé : les noms des cinq
   familles, leurs aides, la recherche, et quelques mots-clés qui aident à
   trouver un réglage dont le libellé ne dit pas tout. Tout le reste réutilise
   les clés qui existaient déjà (`settings.*`, `brand.title`, `conf.title`,
   `wa.title`, `notif.*`, `pay2.*`, `int.*`…) : retraduire un libellé déjà
   traduit, c'est fabriquer deux vérités pour la même chose.

   Les mots-clés (`kw*`) ne s'affichent jamais. Ils servent uniquement à la
   recherche : le patron tape « devise », le réglage s'appelle « Moyens
   d'encaissement », et sans ces mots il ne le trouverait pas. */
export const reglages = {
  fr: {
    rg: {
      /* Les cinq familles */
      famAgence: 'Mon agence',
      famAgenceHint: 'Votre fiche, vos bureaux, votre marque, votre formule.',
      famMetier: 'Mon métier',
      famMetierHint: 'Ce que vous vendez, et comment vous le traitez.',
      famMessages: 'Mes messages',
      famMessagesHint: 'Ce qui part chez le client, et à quel moment.',
      famArgent: 'L’argent',
      famArgentHint: 'Comment vous encaissez, et dans quelles devises.',
      famSecurite: 'Sécurité et données',
      famSecuriteHint: 'La loi, les accès, les traces, vos données.',

      /* La recherche */
      search: 'Chercher un réglage',
      searchClear: 'Effacer la recherche',
      searchCount: '{n} résultat(s)',
      searchNone: 'Aucun réglage ne correspond à « {q} »',
      searchNoneHint: 'Essayez un autre mot : « devise », « facture », « WhatsApp ».',
      searchIn: 'dans {family}',

      /* Les cas vides */
      none: 'Aucun réglage ne vous est ouvert',
      noneHint: 'Vos droits ne couvrent aucune de ces familles. Demandez au responsable de l’agence.',

      /* L'emplacement réservé à l'organisation du travail */
      workMode: 'Organisation du travail',

      /* Mots-clés de recherche, jamais affichés */
      kwAgence: 'adresse sous-domaine formule version langue nom',
      kwVisas: 'listes de pièces checklist justificatifs dossier',
      kwBaremes: 'surestaries détention stationnement pénalités',
      kwPapiers: 'facture devis reçu bon de livraison impression entête',
      kwModeles: 'message relance rappel courrier e-mail',
      kwEncaissement: 'devises monnaie prestataire paiement lien banque',
      kwConformite: 'licence INPDP TTN ONTT patente matricule fiscal',
      kwSecurite: 'appareils sessions mot de passe connexion',
      kwJournal: 'audit historique traces qui a fait quoi',
      kwDonnees: 'export purge effacement conservation sauvegarde',
    },
  },

  en: {
    rg: {
      famAgence: 'My agency',
      famAgenceHint: 'Your record, your offices, your brand, your plan.',
      famMetier: 'My trade',
      famMetierHint: 'What you sell, and how you process it.',
      famMessages: 'My messages',
      famMessagesHint: 'What goes out to the client, and when.',
      famArgent: 'Money',
      famArgentHint: 'How you collect, and in which currencies.',
      famSecurite: 'Security and data',
      famSecuriteHint: 'The law, the access, the trail, your data.',

      search: 'Search a setting',
      searchClear: 'Clear the search',
      searchCount: '{n} result(s)',
      searchNone: 'No setting matches “{q}”',
      searchNoneHint: 'Try another word: “currency”, “invoice”, “WhatsApp”.',
      searchIn: 'in {family}',

      none: 'No setting is open to you',
      noneHint: 'Your rights cover none of these families. Ask the agency manager.',

      workMode: 'How work is organised',

      kwAgence: 'address subdomain plan version language name',
      kwVisas: 'document lists checklist supporting documents case',
      kwBaremes: 'demurrage detention storage penalties',
      kwPapiers: 'invoice quote receipt delivery note printing letterhead',
      kwModeles: 'message follow-up reminder letter email',
      kwEncaissement: 'currencies money provider payment link bank',
      kwConformite: 'licence INPDP TTN ONTT tax number',
      kwSecurite: 'devices sessions password sign-in',
      kwJournal: 'audit history trail who did what',
      kwDonnees: 'export purge deletion retention backup',
    },
  },

  ar: {
    rg: {
      famAgence: 'وكالتي',
      famAgenceHint: 'بطاقتك، مكاتبك، علامتك، صيغتك.',
      famMetier: 'مهنتي',
      famMetierHint: 'ما تبيعه، وكيف تعالجه.',
      famMessages: 'رسائلي',
      famMessagesHint: 'ما يصل إلى الحريف، ومتى يصل.',
      famArgent: 'المال',
      famArgentHint: 'كيف تقبض، وبأي عملات.',
      famSecurite: 'الأمن والمعطيات',
      famSecuriteHint: 'القانون، النفاذ، الآثار، معطياتك.',

      search: 'ابحث عن إعداد',
      searchClear: 'محو البحث',
      searchCount: '{n} نتيجة',
      searchNone: 'لا يوجد إعداد يطابق « {q} »',
      searchNoneHint: 'جرّب كلمة أخرى: « عملة »، « فاتورة »، « واتساب ».',
      searchIn: 'في {family}',

      none: 'لا يوجد إعداد متاح لك',
      noneHint: 'صلاحياتك لا تشمل أيًّا من هذه العائلات. اطلب ذلك من مسؤول الوكالة.',

      workMode: 'تنظيم العمل',

      kwAgence: 'العنوان النطاق الصيغة الإصدار اللغة الاسم',
      kwVisas: 'قوائم الوثائق المؤيدات الملف',
      kwBaremes: 'غرامات التأخير التخزين الحاويات',
      kwPapiers: 'فاتورة عرض سعر وصل إذن تسليم طباعة',
      kwModeles: 'رسالة تذكير بريد إلكتروني',
      kwEncaissement: 'عملات نقود مزود دفع رابط بنك',
      kwConformite: 'رخصة INPDP TTN ONTT المعرف الجبائي',
      kwSecurite: 'أجهزة جلسات كلمة السر دخول',
      kwJournal: 'تدقيق سجل آثار من فعل ماذا',
      kwDonnees: 'تصدير حذف مسح مدة الحفظ نسخة',
    },
  },

  zh: {
    rg: {
      famAgence: '我的机构',
      famAgenceHint: '机构资料、办事处、品牌、套餐。',
      famMetier: '我的业务',
      famMetierHint: '你卖什么，以及怎么办理。',
      famMessages: '我的消息',
      famMessagesHint: '发给客户的内容，以及发送时机。',
      famArgent: '资金',
      famArgentHint: '怎么收款，收哪些货币。',
      famSecurite: '安全与数据',
      famSecuriteHint: '法规、权限、留痕、你的数据。',

      search: '搜索设置',
      searchClear: '清除搜索',
      searchCount: '{n} 项结果',
      searchNone: '没有设置匹配“{q}”',
      searchNoneHint: '换个词试试：“货币”“发票”“WhatsApp”。',
      searchIn: '位于{family}',

      none: '你没有可用的设置',
      noneHint: '你的权限不覆盖这些板块。请联系机构负责人。',

      workMode: '工作组织方式',

      kwAgence: '地址 子域名 套餐 版本 语言 名称',
      kwVisas: '材料清单 证明文件 案卷',
      kwBaremes: '滞期费 滞箱费 堆存费 罚金',
      kwPapiers: '发票 报价单 收据 送货单 打印 抬头',
      kwModeles: '消息 催办 提醒 邮件',
      kwEncaissement: '货币 币种 服务商 支付 链接 银行',
      kwConformite: '执照 INPDP TTN ONTT 税号',
      kwSecurite: '设备 会话 密码 登录',
      kwJournal: '审计 历史 留痕 谁做了什么',
      kwDonnees: '导出 清除 删除 保存期限 备份',
    },
  },
} as const
