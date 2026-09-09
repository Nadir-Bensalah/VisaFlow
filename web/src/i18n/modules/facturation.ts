/* Bloc de traduction du module « cycle de facturation ». Un fichier par module :
   les modules se construisent en parallèle sans se marcher dessus, et
   `modules.ts` agrège.

   Le français fait foi. Les trois autres langues le traduisent, elles ne le
   réécrivent pas.

   Ces clés sont CHOISIES PAR LA BASE : `agency_access_state` et `agency_gate`
   rendent un `message_cle` que l'écran se contente de traduire. C'est pour ça
   qu'il y a deux clés par situation, une au pluriel et une au singulier : ni le
   français ni l'arabe n'acceptent « 1 jours », et le dictionnaire n'a pas de
   règle de pluriel. La base choisit la bonne. */
export const facturation = {
  fr: {
    bill: {
      /* Le bandeau de compte à rebours. Clés rendues par agency_access_state. */
      trialLeft: 'Essai gratuit : il vous reste {n} jours.',
      trialLast: 'Essai gratuit : c’est le dernier jour.',
      graceLeft: 'Votre abonnement est arrivé à échéance. Il vous reste {n} jours pour régler.',
      graceLast: 'Votre abonnement est arrivé à échéance. C’est le dernier jour pour régler.',
      renewalSoon: 'Votre abonnement se renouvelle dans {n} jours.',
      suspended: 'Votre abonnement est suspendu.',
      terminated: 'Votre abonnement a pris fin.',

      /* Le mur de connexion. Clés rendues par agency_gate. */
      wallStaff: 'Votre agence n’a plus accès à l’outil. Voyez avec votre direction.',
      wallOwner: 'Votre abonnement est suspendu. Contactez le service facturation pour rouvrir votre accès.',
      wallTitle: 'Accès suspendu',
      wallKept: 'Rien n’a été supprimé. Vos dossiers, vos clients et vos documents vous attendent : l’accès rouvre dès le règlement enregistré.',
      wallContact: 'Service facturation',
      wallSignOut: 'Se déconnecter',

      /* Ce que le bandeau propose de faire. */
      seePlan: 'Voir mon abonnement',
      dueOn: 'Échéance le {date}',
    },
  },

  en: {
    bill: {
      trialLeft: 'Free trial: {n} days left.',
      trialLast: 'Free trial: this is the last day.',
      graceLeft: 'Your subscription is due. You have {n} days left to pay.',
      graceLast: 'Your subscription is due. Today is the last day to pay.',
      renewalSoon: 'Your subscription renews in {n} days.',
      suspended: 'Your subscription is suspended.',
      terminated: 'Your subscription has ended.',

      wallStaff: 'Your agency no longer has access. Please speak to your management.',
      wallOwner: 'Your subscription is suspended. Contact the billing department to restore your access.',
      wallTitle: 'Access suspended',
      wallKept: 'Nothing has been deleted. Your cases, clients and documents are waiting: access reopens as soon as a payment is recorded.',
      wallContact: 'Billing department',
      wallSignOut: 'Sign out',

      seePlan: 'View my subscription',
      dueOn: 'Due on {date}',
    },
  },

  ar: {
    bill: {
      trialLeft: 'الفترة التجريبية: بقيت {n} أيام.',
      trialLast: 'الفترة التجريبية: هذا آخر يوم.',
      graceLeft: 'حان موعد تجديد اشتراكك. بقيت {n} أيام للدفع.',
      graceLast: 'حان موعد تجديد اشتراكك. اليوم آخر يوم للدفع.',
      renewalSoon: 'يتجدد اشتراكك بعد {n} أيام.',
      suspended: 'اشتراكك موقوف.',
      terminated: 'انتهى اشتراكك.',

      wallStaff: 'لم يعد لوكالتك حق الدخول. يرجى مراجعة إدارتك.',
      wallOwner: 'اشتراكك موقوف. اتصل بمصلحة الفوترة لإعادة فتح الدخول.',
      wallTitle: 'الدخول موقوف',
      wallKept: 'لم يُحذف أي شيء. ملفاتك وحرفاؤك ووثائقك في انتظارك: يُفتح الدخول فور تسجيل الدفع.',
      wallContact: 'مصلحة الفوترة',
      wallSignOut: 'تسجيل الخروج',

      seePlan: 'عرض اشتراكي',
      dueOn: 'الاستحقاق في {date}',
    },
  },

  zh: {
    bill: {
      trialLeft: '免费试用：还剩 {n} 天。',
      trialLast: '免费试用：今天是最后一天。',
      graceLeft: '订阅已到期。还有 {n} 天时间付款。',
      graceLast: '订阅已到期。今天是最后的付款日。',
      renewalSoon: '订阅将在 {n} 天后续期。',
      suspended: '你的订阅已暂停。',
      terminated: '你的订阅已结束。',

      wallStaff: '贵机构已无法使用本系统，请与管理层联系。',
      wallOwner: '你的订阅已暂停。请联系账务部门恢复访问。',
      wallTitle: '访问已暂停',
      wallKept: '没有任何数据被删除。案卷、客户和文件都还在：付款登记后立即恢复访问。',
      wallContact: '账务部门',
      wallSignOut: '退出登录',

      seePlan: '查看我的订阅',
      dueOn: '到期日 {date}',
    },
  },
} as const
