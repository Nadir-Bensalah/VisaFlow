import { useEffect, useState } from 'react'
import { useStore } from '@/data/store'
import { HAS_BACKEND } from '@/lib/supabase'
import { rpc } from '@/data/remote'
import { camelKeys } from '@/lib/case'
import type { I18nText, Locale } from '@/data/types'

/**
 * La devanture publique d'une agence.
 *
 * Les pages publiques n'ont pas de session : elles ne peuvent rien lire par les
 * politiques de sécurité. Elles lisaient donc le jeu de DÉMONSTRATION du
 * navigateur, ce qui marchait très bien tant qu'on ne cliquait pas sur
 * « Envoyer ». Au premier vrai dépôt, la base répondait
 * `invalid input syntax for type uuid: "vt_cn_aff"` : le formulaire proposait
 * des types de visa fictifs, avec des identifiants fictifs.
 *
 * Une seule porte publique règle le problème, et elle ne rend que ce qu'une
 * agence accepte de mettre sur sa devanture.
 */

export type PublicAgency = {
  slug: string
  name: string
  mark?: string
  accent?: string
  services: string[]
  locales: Locale[]
  defaultLocale: Locale
  visaTypes: {
    id: string
    countryCode: string
    country: I18nText
    label: I18nText
    category?: string
    processingDays: number
    feeAgency?: number
    feeConsulate?: number
    currency?: string
  }[]
  office: { name: string; city?: string; address?: string; phone?: string } | null
}

export type PublicAgencyResult =
  | { status: 'chargement' }
  | { status: 'absente' }
  | { status: 'ok'; agency: PublicAgency }

export function usePublicAgency(slug: string): PublicAgencyResult {
  const { db } = useStore()
  const [remote, setRemote] = useState<PublicAgencyResult>({ status: 'chargement' })

  useEffect(() => {
    if (!HAS_BACKEND) return
    let alive = true
    setRemote({ status: 'chargement' })
    rpc('portal_agency', { p_slug: slug })
      .then((data) => {
        if (!alive) return
        if (!data) { setRemote({ status: 'absente' }); return }
        setRemote({ status: 'ok', agency: camelKeys<PublicAgency>(data) })
      })
      .catch(() => { if (alive) setRemote({ status: 'absente' }) })
    return () => { alive = false }
  }, [slug])

  if (HAS_BACKEND) return remote

  // La démonstration : la même forme, depuis le magasin local.
  const office = db.agency.offices[0]
  return {
    status: 'ok',
    agency: {
      slug: db.agency.slug,
      name: db.agency.name,
      mark: db.agency.mark,
      accent: db.agency.accent,
      services: db.agency.services,
      locales: db.agency.locales,
      defaultLocale: db.agency.defaultLocale,
      visaTypes: db.visaTypes.filter((v) => v.active).map((v) => ({
        id: v.id, countryCode: v.countryCode, country: v.country, label: v.label,
        category: v.category, processingDays: v.processingDays,
        feeAgency: v.feeAgency, feeConsulate: v.feeConsulate, currency: db.agency.currency,
      })),
      office: office
        ? { name: office.name, city: office.city, address: office.address, phone: office.phone }
        : null,
    },
  }
}
