import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { I18nManager } from 'react-native'
import * as Localization from 'expo-localization'

export type Locale = 'fr' | 'en' | 'ar' | 'zh'
export const LOCALES: Locale[] = ['fr', 'en', 'ar', 'zh']
export const NATIVE: Record<Locale, string> = { fr: 'Français', en: 'English', ar: 'العربية', zh: '中文' }

const D = {
  fr: {
    myFiles: 'Mes demandes', shipments: 'Mes marchandises', missing: 'Ce qu’il nous manque',
    allGood: 'Nous avons tout. Vous n’avez rien à faire.', step: 'Étape {n} sur {total}',
    upload: 'Envoyer la pièce', appointment: 'Votre rendez-vous', balance: 'Reste à régler',
    messages: 'Messages', ask: 'Poser une question', send: 'Envoyer', settings: 'Réglages',
    language: 'Langue', notifications: 'Notifications', notificationsHint:
      'Recevoir un signal quand une pièce est validée, un rendez-vous approche ou la marchandise arrive.',
    signIn: 'Entrer', phone: 'Numéro de téléphone', code: 'Code reçu par WhatsApp',
    welcome: 'Suivez votre dossier', welcomeHint: 'Sans compte à créer. Le code arrive sur WhatsApp.',
    eta: 'Arrivée prévue', tracking: 'Suivi', reference: 'Référence', empty: 'Rien pour l’instant.',
    agency: 'Contacter l’agence', privacy: 'Vos pièces sont conservées le temps du dossier, puis effacées.',
  },
  en: {
    myFiles: 'My applications', shipments: 'My goods', missing: 'What we still need',
    allGood: 'We have everything. Nothing to do on your side.', step: 'Step {n} of {total}',
    upload: 'Send the document', appointment: 'Your appointment', balance: 'Still to pay',
    messages: 'Messages', ask: 'Ask a question', send: 'Send', settings: 'Settings',
    language: 'Language', notifications: 'Notifications', notificationsHint:
      'Get a ping when a document is approved, an appointment is close or the goods arrive.',
    signIn: 'Enter', phone: 'Phone number', code: 'Code received on WhatsApp',
    welcome: 'Track your application', welcomeHint: 'No account to create. The code arrives on WhatsApp.',
    eta: 'Estimated arrival', tracking: 'Tracking', reference: 'Reference', empty: 'Nothing yet.',
    agency: 'Contact the agency', privacy: 'Your documents are kept for the duration of the application, then erased.',
  },
  ar: {
    myFiles: 'مطالبي', shipments: 'بضائعي', missing: 'ما ينقصنا',
    allGood: 'لدينا كل شيء. لا يلزمك أي إجراء.', step: 'المرحلة {n} من {total}',
    upload: 'إرسال الوثيقة', appointment: 'موعدك', balance: 'المتبقي للخلاص',
    messages: 'الرسائل', ask: 'طرح سؤال', send: 'إرسال', settings: 'الإعدادات',
    language: 'اللغة', notifications: 'الإشعارات', notificationsHint:
      'تلقي تنبيه عند قبول وثيقة أو اقتراب موعد أو وصول البضاعة.',
    signIn: 'دخول', phone: 'رقم الهاتف', code: 'الرمز الواصل عبر واتساب',
    welcome: 'تابع ملفك', welcomeHint: 'دون إنشاء حساب. يصلك الرمز عبر واتساب.',
    eta: 'موعد الوصول', tracking: 'التتبع', reference: 'المرجع', empty: 'لا شيء بعد.',
    agency: 'الاتصال بالوكالة', privacy: 'تحفظ وثائقك طيلة مدة الملف ثم تمحى.',
  },
  zh: {
    myFiles: '我的申请', shipments: '我的货物', missing: '还缺这些材料',
    allGood: '材料已齐全，您无需再做任何事。', step: '第 {n} 步，共 {total} 步',
    upload: '发送材料', appointment: '您的预约', balance: '待付金额',
    messages: '消息', ask: '提问', send: '发送', settings: '设置',
    language: '语言', notifications: '通知', notificationsHint:
      '材料通过、预约临近或货物到达时收到提醒。',
    signIn: '进入', phone: '手机号', code: 'WhatsApp 收到的验证码',
    welcome: '跟踪您的申请', welcomeHint: '无需注册，验证码通过 WhatsApp 发送。',
    eta: '预计到达', tracking: '跟踪', reference: '单号', empty: '暂时没有内容。',
    agency: '联系公司', privacy: '您的材料仅在申请期间保存，之后会被删除。',
  },
} as const

type Key = keyof typeof D.fr

function detect(): Locale {
  const tag = Localization.getLocales()[0]?.languageCode ?? 'fr'
  return (LOCALES as string[]).includes(tag) ? (tag as Locale) : 'fr'
}

interface Value {
  locale: Locale
  rtl: boolean
  setLocale: (l: Locale) => void
  t: (key: Key, vars?: Record<string, string | number>) => string
}

const Ctx = createContext<Value | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(detect)
  const rtl = locale === 'ar'

  const value = useMemo<Value>(() => {
    // Le retournement complet demande un redemarrage : on garde la mise en page
    // logique et on aligne le texte, ce qui suffit pour un ecran de suivi.
    I18nManager.allowRTL(true)
    return {
      locale,
      rtl,
      setLocale,
      t: (key, vars) => {
        const raw = (D[locale][key] ?? D.fr[key]) as string
        return vars ? raw.replace(/\{(\w+)\}/g, (w, n) => (n in vars ? String(vars[n]) : w)) : raw
      },
    }
  }, [locale, rtl])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): Value {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useI18n hors du I18nProvider')
  return ctx
}
