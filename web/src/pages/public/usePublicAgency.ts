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
  email?: string
  /** Mentions légales de bas de page : la référence INPDP doit être affichée. */
  legalName?: string
  inpdpRef?: string
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
      email: db.agency.email,
      legalName: db.agency.legalName,
      inpdpRef: db.agency.inpdpRef,
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

// ------------------------------------------------------------------
// Le suivi d'une demande, avant qu'elle ne devienne un dossier
// ------------------------------------------------------------------

export type PublicRequest = {
  request: {
    reference: string
    kind: 'visa' | 'fret'
    status: string
    receivedAt: string
    firstName?: string
    destination?: string
    travelDate?: string
    goods?: string
    note?: string
    refusalReason?: string
  }
  agency: { name: string; mark?: string; accent?: string }
  office: { name: string; address?: string; phone?: string } | null
  /** Rempli dès que la demande devient un dossier : le suivi continue là-bas. */
  caseToken?: string
  caseReference?: string
}

export type PublicRequestResult =
  | { status: 'chargement' }
  | { status: 'absente' }
  | { status: 'ok'; data: PublicRequest }

export function usePublicRequest(token: string): PublicRequestResult {
  const { db } = useStore()
  const [remote, setRemote] = useState<PublicRequestResult>({ status: 'chargement' })

  useEffect(() => {
    if (!HAS_BACKEND) return
    let alive = true
    setRemote({ status: 'chargement' })
    rpc('portal_request', { p_token: token })
      .then((data) => {
        if (!alive) return
        if (!data) { setRemote({ status: 'absente' }); return }
        setRemote({ status: 'ok', data: camelKeys<PublicRequest>(data) })
      })
      .catch(() => { if (alive) setRemote({ status: 'absente' }) })
    return () => { alive = false }
  }, [token])

  if (HAS_BACKEND) return remote

  const r = db.requests.find((x) => x.portalToken === token)
  if (!r) return { status: 'absente' }
  const kase = r.caseId ? db.cases.find((c) => c.id === r.caseId) : undefined
  const office = db.agency.offices[0]
  return {
    status: 'ok',
    data: {
      request: {
        reference: r.reference, kind: r.kind, status: r.status, receivedAt: r.receivedAt,
        firstName: r.firstName, destination: r.destination, travelDate: r.travelDate,
        goods: r.goods, note: r.note,
        refusalReason: r.status === 'ecartee' ? r.refusalReason : undefined,
      },
      agency: { name: db.agency.name, mark: db.agency.mark, accent: db.agency.accent },
      office: office ? { name: office.name, address: office.address, phone: office.phone } : null,
      caseToken: kase?.portalToken,
      caseReference: kase?.reference,
    },
  }
}

// ------------------------------------------------------------------
// « Retrouver mes suivis », après vérification du numéro
// ------------------------------------------------------------------

export type MyTracking = {
  cases: { reference: string; stage: string; status: string; token: string; country?: I18nText; label?: I18nText }[]
  shipments: { reference: string; stage: string; token: string; originPort?: string; destPort?: string; goods?: I18nText }[]
  requests: { reference: string; status: string; kind: string; token: string; destination?: string; goods?: string }[]
}

/**
 * Ce que le porteur d'un appareil vérifié peut voir. Le serveur ne rend rien
 * sans un jeton d'appareil valide : c'est le numéro de téléphone confirmé par
 * un code qui ouvre la porte, jamais une référence devinée.
 */
export async function fetchMyTracking(slug: string, deviceToken: string): Promise<MyTracking | null> {
  const data = await rpc('portal_mine', { p_agency_slug: slug, p_device_token: deviceToken }) as
    ({ ok?: boolean } & Record<string, unknown>) | null
  if (!data || data.ok !== true) return null
  const v = camelKeys<MyTracking>(data)
  return { cases: v.cases ?? [], shipments: v.shipments ?? [], requests: v.requests ?? [] }
}
