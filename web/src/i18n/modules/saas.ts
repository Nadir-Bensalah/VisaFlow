/* Bloc de traduction du module « saas ». Un fichier par module : les modules se
   construisent en parallèle sans se marcher dessus, et `modules.ts` agrège.

   Toutes les clés sont préfixées `plan.`. Elles sont lues par PlanCard, la
   carte que l'AGENCE voit de son propre abonnement. La console plateforme,
   elle, est en français en dur : elle n'a qu'un utilisateur.

   Un mot sur le vocabulaire, il compte : on écrit « facturé à l'année » et
   « virement », jamais « prélèvement » ni « paiement par carte ». Il n'existe
   pas de prélèvement récurrent par carte en Tunisie, et promettre le contraire
   à l'écran ferait attendre une agence pour rien. */
export const saas = {
  fr: {
    plan: {
      title: 'Votre abonnement',
      loading: 'Chargement…',
      error: 'Impossible de lire votre abonnement.',

      status: {
        essai: 'Essai',
        active: 'Actif',
        impayee: 'Facture en attente',
        resiliee: 'Résilié',
        suspendue: 'Suspendu',
      },
      trialEnds: 'Votre essai se termine le {date}.',
      trialEndsSoon: 'Votre essai se termine dans {days} jours.',
      renewal: 'Échéance',
      renewalIn: 'Dans {days} jours',
      renewalPassed: 'Échéance dépassée depuis {days} jours',
      noRenewal: 'Pas d’échéance',

      seats: 'Utilisateurs facturés',
      seatsValue: '{seats} utilisateurs',
      annual: 'Montant annuel',
      formula: '{seats} utilisateurs × {price} par utilisateur et par mois × 12 mois',
      invoiceNote: 'Facturé une fois par an, sur facture. Vous réglez par virement, nous ne prélevons rien.',

      usage: 'Votre consommation',
      refresh: 'Recompter',
      computedAt: 'Recompté le {date}',
      unlimited: 'illimité',
      remaining: '{n} restants',
      full: 'Au complet',
      near: 'Bientôt au complet',
      over: 'Dépassé',

      res: {
        users: 'Utilisateurs',
        offices: 'Bureaux',
        clients: 'Clients',
        cases: 'Dossiers ouverts',
        shipments: 'Cargaisons en cours',
        storage: 'Pièces jointes',
      },

      included: 'Ce que votre plan comprend',
      feature: {
        VISA: 'Visas',
        CARGO: 'Fret',
        CRM: 'Relation client',
        WHATSAPP: 'WhatsApp',
        CLIENT_PORTAL: 'Portail client',
        ADVANCED_REPORTS: 'Rapports avancés',
        API: 'API',
        WHITE_LABEL: 'Marque blanche',
        CUSTOM_ROLES: 'Rôles sur mesure',
        ACCOUNTING: 'Comptabilité',
      },

      contact: 'Pour changer de plan ou ajouter des utilisateurs, appelez votre commercial.',
      suspendedNote: 'Votre accès est suspendu. Contactez-nous pour le rétablir.',
      overNote: 'Vous dépassez ce que couvre votre plan. Ce que vous avez déjà reste là, mais vous ne pourrez plus en ajouter.',
    },
  },

  en: {
    plan: {
      title: 'Your subscription',
      loading: 'Loading…',
      error: 'Your subscription could not be loaded.',

      status: {
        essai: 'Trial',
        active: 'Active',
        impayee: 'Invoice pending',
        resiliee: 'Ended',
        suspendue: 'Suspended',
      },
      trialEnds: 'Your trial ends on {date}.',
      trialEndsSoon: 'Your trial ends in {days} days.',
      renewal: 'Renewal',
      renewalIn: 'In {days} days',
      renewalPassed: 'Overdue by {days} days',
      noRenewal: 'No renewal date',

      seats: 'Billed users',
      seatsValue: '{seats} users',
      annual: 'Yearly amount',
      formula: '{seats} users × {price} per user per month × 12 months',
      invoiceNote: 'Billed once a year, by invoice. You pay by bank transfer, we take nothing from a card.',

      usage: 'Your usage',
      refresh: 'Recount',
      computedAt: 'Counted on {date}',
      unlimited: 'unlimited',
      remaining: '{n} left',
      full: 'Full',
      near: 'Almost full',
      over: 'Over',

      res: {
        users: 'Users',
        offices: 'Offices',
        clients: 'Clients',
        cases: 'Open cases',
        shipments: 'Shipments in transit',
        storage: 'Attachments',
      },

      included: 'What your plan includes',
      feature: {
        VISA: 'Visas',
        CARGO: 'Freight',
        CRM: 'Customer relations',
        WHATSAPP: 'WhatsApp',
        CLIENT_PORTAL: 'Client portal',
        ADVANCED_REPORTS: 'Advanced reports',
        API: 'API',
        WHITE_LABEL: 'White label',
        CUSTOM_ROLES: 'Custom roles',
        ACCOUNTING: 'Accounting',
      },

      contact: 'To change plan or add users, call your account manager.',
      suspendedNote: 'Your access is suspended. Contact us to restore it.',
      overNote: 'You are over what your plan covers. What you already have stays, but you cannot add more.',
    },
  },

  ar: {
    plan: {
      title: 'اشتراكك',
      loading: 'جارٍ التحميل…',
      error: 'تعذّرت قراءة اشتراكك.',

      status: {
        essai: 'تجربة',
        active: 'نشط',
        impayee: 'فاتورة في الانتظار',
        resiliee: 'منتهٍ',
        suspendue: 'موقوف',
      },
      trialEnds: 'تنتهي تجربتك يوم {date}.',
      trialEndsSoon: 'تنتهي تجربتك بعد {days} يومًا.',
      renewal: 'تاريخ التجديد',
      renewalIn: 'بعد {days} يومًا',
      renewalPassed: 'متأخّر بـ {days} يومًا',
      noRenewal: 'لا يوجد تاريخ تجديد',

      seats: 'المستعملون المفوترون',
      seatsValue: '{seats} مستعملين',
      annual: 'المبلغ السنوي',
      formula: '{seats} مستعملين × {price} لكل مستعمل في الشهر × 12 شهرًا',
      invoiceNote: 'الفوترة مرّة في السنة، بفاتورة. تدفع بتحويل بنكي، ولا نخصم شيئًا من بطاقة.',

      usage: 'استهلاكك',
      refresh: 'إعادة الحساب',
      computedAt: 'حُسب يوم {date}',
      unlimited: 'بلا حدّ',
      remaining: 'يبقى {n}',
      full: 'مكتمل',
      near: 'يقارب الاكتمال',
      over: 'تجاوز',

      res: {
        users: 'المستعملون',
        offices: 'المكاتب',
        clients: 'الحرفاء',
        cases: 'الملفات المفتوحة',
        shipments: 'الشحنات الجارية',
        storage: 'المرفقات',
      },

      included: 'ما يشمله اشتراكك',
      feature: {
        VISA: 'التأشيرات',
        CARGO: 'الشحن',
        CRM: 'علاقة الحرفاء',
        WHATSAPP: 'واتساب',
        CLIENT_PORTAL: 'فضاء الحريف',
        ADVANCED_REPORTS: 'تقارير متقدّمة',
        API: 'واجهة برمجية',
        WHITE_LABEL: 'علامة بيضاء',
        CUSTOM_ROLES: 'أدوار على المقاس',
        ACCOUNTING: 'المحاسبة',
      },

      contact: 'لتغيير الاشتراك أو إضافة مستعملين، اتّصل بمسؤول حسابك.',
      suspendedNote: 'دخولك موقوف. اتّصل بنا لإعادته.',
      overNote: 'تجاوزت ما يغطّيه اشتراكك. ما لديك يبقى في مكانه، لكن لا يمكنك الإضافة.',
    },
  },

  zh: {
    plan: {
      title: '您的订阅',
      loading: '加载中…',
      error: '无法读取您的订阅。',

      status: {
        essai: '试用',
        active: '有效',
        impayee: '待付发票',
        resiliee: '已终止',
        suspendue: '已暂停',
      },
      trialEnds: '您的试用将于 {date} 结束。',
      trialEndsSoon: '您的试用将在 {days} 天后结束。',
      renewal: '到期日',
      renewalIn: '还有 {days} 天',
      renewalPassed: '已逾期 {days} 天',
      noRenewal: '无到期日',

      seats: '计费用户数',
      seatsValue: '{seats} 位用户',
      annual: '年度金额',
      formula: '{seats} 位用户 × 每人每月 {price} × 12 个月',
      invoiceNote: '每年开票一次。您以银行转账付款，我们不从银行卡扣款。',

      usage: '您的用量',
      refresh: '重新统计',
      computedAt: '统计于 {date}',
      unlimited: '不限',
      remaining: '剩余 {n}',
      full: '已满',
      near: '接近上限',
      over: '已超出',

      res: {
        users: '用户',
        offices: '办公点',
        clients: '客户',
        cases: '在办案件',
        shipments: '在途货运',
        storage: '附件',
      },

      included: '您的方案包含',
      feature: {
        VISA: '签证',
        CARGO: '货运',
        CRM: '客户关系',
        WHATSAPP: 'WhatsApp',
        CLIENT_PORTAL: '客户门户',
        ADVANCED_REPORTS: '高级报表',
        API: 'API',
        WHITE_LABEL: '白标',
        CUSTOM_ROLES: '自定义角色',
        ACCOUNTING: '会计',
      },

      contact: '如需更换方案或增加用户，请联系您的客户经理。',
      suspendedNote: '您的访问已暂停。请联系我们恢复。',
      overNote: '您已超出方案范围。已有内容不受影响，但无法再新增。',
    },
  },
} as const
