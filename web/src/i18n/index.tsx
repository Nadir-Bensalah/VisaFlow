import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { fr, type Dict } from './fr'
import { en } from './en'
import { ar } from './ar'
import { zh } from './zh'
import type { I18nText, Locale } from '@/data/types'

export const LOCALES: Locale[] = ['fr', 'en', 'ar', 'zh']

export const LOCALE_META: Record<Locale, { label: string; native: string; dir: 'ltr' | 'rtl'; bcp47: string }> = {
  fr: { label: 'Français', native: 'Français', dir: 'ltr', bcp47: 'fr-FR' },
  en: { label: 'English', native: 'English', dir: 'ltr', bcp47: 'en-GB' },
  ar: { label: 'Arabe', native: 'العربية', dir: 'rtl', bcp47: 'ar-TN' },
  zh: { label: 'Chinois', native: '中文', dir: 'ltr', bcp47: 'zh-CN' },
}

const DICTS: Record<Locale, Dict> = { fr, en, ar, zh }

/** Chemins de cle valides, verifies a la compilation : t('cases.title'). */
type Leaves<T> = T extends string
  ? never
  : { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}` }[keyof T & string]

export type TKey = Leaves<Dict>

type Vars = Record<string, string | number>

function lookup(dict: Dict, key: string): string | undefined {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}

interface I18nValue {
  locale: Locale
  dir: 'ltr' | 'rtl'
  setLocale: (l: Locale) => void
  t: (key: TKey, vars?: Vars) => string
  /** Traduit une chaine stockee en base (I18nText), avec repli sur le francais. */
  tt: (text: I18nText | undefined) => string
  formatDate: (iso?: string, opts?: Intl.DateTimeFormatOptions) => string
  formatMoney: (amount: number, currency?: string) => string
  formatNumber: (n: number) => string
}

const I18nContext = createContext<I18nValue | null>(null)

const STORAGE_KEY = 'visaflow.locale'

function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'fr'
  const fromUrl = new URLSearchParams(window.location.search).get('lang')
  if (fromUrl && LOCALES.includes(fromUrl as Locale)) return fromUrl as Locale
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored && LOCALES.includes(stored as Locale)) return stored as Locale
  const nav = window.navigator.language.slice(0, 2).toLowerCase()
  return (LOCALES.includes(nav as Locale) ? nav : 'fr') as Locale
}

export function I18nProvider({ children, currency = 'TND' }: { children: ReactNode; currency?: string }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)

  const dir = LOCALE_META[locale].dir

  useEffect(() => {
    const root = document.documentElement
    root.lang = locale
    root.dir = dir
    window.localStorage.setItem(STORAGE_KEY, locale)
  }, [locale, dir])

  const setLocale = useCallback((l: Locale) => setLocaleState(l), [])

  const value = useMemo<I18nValue>(() => {
    const dict = DICTS[locale]
    const bcp47 = LOCALE_META[locale].bcp47
    return {
      locale,
      dir,
      setLocale,
      t: (key, vars) => interpolate(lookup(dict, key) ?? lookup(fr, key) ?? key, vars),
      tt: (text) => (text ? (text[locale] ?? text.fr) : ''),
      formatDate: (iso, opts) => {
        if (!iso) return '—'
        const d = new Date(iso)
        if (Number.isNaN(d.getTime())) return '—'
        return new Intl.DateTimeFormat(bcp47, opts ?? { day: '2-digit', month: 'short', year: 'numeric' }).format(d)
      },
      formatMoney: (amount, cur) =>
        new Intl.NumberFormat(bcp47, {
          style: 'currency',
          currency: cur ?? currency,
          maximumFractionDigits: 0,
        }).format(amount),
      formatNumber: (n) => new Intl.NumberFormat(bcp47).format(n),
    }
  }, [locale, dir, setLocale, currency])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n doit être utilisé dans un I18nProvider')
  return ctx
}
