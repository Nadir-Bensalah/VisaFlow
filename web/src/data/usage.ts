import { useCallback, useEffect, useReducer } from 'react'
import { HAS_BACKEND, supabase } from '@/lib/supabase'

/* LA CONSOMMATION D'UNE AGENCE, EN TEMPS RÉEL.
 *
 * « Temps réel » veut dire trois choses, et rien de plus :
 *   1. le serveur compte en direct à chaque appel (`agency_usage` ne lit pas
 *      un cache, il recompte les dossiers ouverts, les comptes, les octets) ;
 *   2. chaque geste de création (dossier, cargaison, dépôt, compte, bureau)
 *      appelle `signalerUsage()` et tous les écrans abonnés rechargent ;
 *   3. toutes les 60 s, et quand l'onglet redevient visible, on recharge.
 *
 * Aucune limite ni aucun prix n'est écrit ici : tout vient de la base, y
 * compris le niveau (« ok », « info », « attention », « bloque »). Un niveau
 * calculé dans le navigateur serait faux au premier changement de grille, et
 * faux sans prévenir.
 *
 * Une seule lecture partagée par agence : dix zones de dépôt sur un écran ne
 * lancent pas dix appels, elles lisent la même entrée et se réveillent
 * ensemble quand elle change.
 */

export type UsageCode = 'users' | 'offices' | 'cases' | 'shipments' | 'storage' | 'emails'
export type UsageNiveau = 'ok' | 'info' | 'attention' | 'bloque'
export type UsageUnit = 'compte' | 'bureau' | 'dossier' | 'cargaison' | 'octet' | 'courriel'

export interface UsageResource {
  code: UsageCode
  label_fr: string
  /** Compté en direct au moment de l'appel. En octets pour le stockage. */
  used: number
  /** Null = illimité. Pour Premium, c'est l'usage raisonnable. */
  limit: number | null
  pct: number | null
  niveau: UsageNiveau
  /** La date du premier passage à 100 %, ou null sous la limite. */
  depuis: string | null
  unit: UsageUnit
  /** Le prix de l'ajout suivant (compte, bureau) quand la limite est atteinte. */
  addon_price: number | null
  addon_currency: string | null
}

export interface AgencyUsage {
  plan_code: 'essai' | 'active' | 'premium'
  currency: 'TND' | 'EUR'
  premium: boolean
  computed_at: string
  resources: UsageResource[]
}

/* ------------------------------ Lecture ------------------------------ */

const GRAVITE: Record<UsageNiveau, number> = { ok: 0, info: 1, attention: 2, bloque: 3 }

/** Le niveau le plus grave d'une liste. « ok » quand la liste est vide. */
export function pireNiveau(resources: UsageResource[]): UsageNiveau {
  let pire: UsageNiveau = 'ok'
  for (const r of resources) if (GRAVITE[r.niveau] > GRAVITE[pire]) pire = r.niveau
  return pire
}

/** Les ressources qui ont quelque chose à dire, la plus grave en premier. */
export function alertesUsage(resources: UsageResource[]): UsageResource[] {
  return resources
    .filter((r) => r.niveau !== 'ok')
    .sort((a, b) => GRAVITE[b.niveau] - GRAVITE[a.niveau] || (b.pct ?? 0) - (a.pct ?? 0))
}

/** Postgres rend parfois un numeric en chaîne : on ramène tout en nombre, une fois. */
function normaliser(raw: unknown): AgencyUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Partial<AgencyUsage> & { resources?: Partial<UsageResource>[] }
  if (!Array.isArray(u.resources)) return null
  const n = (v: unknown): number => Number(v ?? 0)
  const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
  return {
    plan_code: (u.plan_code ?? 'active') as AgencyUsage['plan_code'],
    currency: (u.currency ?? 'TND') as AgencyUsage['currency'],
    premium: Boolean(u.premium),
    computed_at: u.computed_at ?? new Date().toISOString(),
    resources: u.resources.map((r) => ({
      code: r.code as UsageCode,
      label_fr: r.label_fr ?? String(r.code),
      used: n(r.used),
      limit: nn(r.limit),
      pct: nn(r.pct),
      niveau: (r.niveau ?? 'ok') as UsageNiveau,
      depuis: r.depuis ?? null,
      unit: (r.unit ?? 'dossier') as UsageUnit,
      addon_price: nn(r.addon_price),
      addon_currency: r.addon_currency ?? null,
    })),
  }
}

function client() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

/** rpc agency_usage() : la consommation de l'agence connectée. */
export async function loadMyUsage(): Promise<AgencyUsage | null> {
  const { data, error } = await client().rpc('agency_usage')
  if (error) throw new Error(error.message)
  return normaliser(data)
}

/** rpc platform_agency_usage(p_agency) : la même forme, pour la console. */
export async function loadAgencyUsage(agencyId: string): Promise<AgencyUsage | null> {
  const { data, error } = await client().rpc('platform_agency_usage', { p_agency: agencyId })
  if (error) throw new Error(error.message)
  return normaliser(data)
}

/* ------------------------------- Le bus ------------------------------ */

/* Une entrée par agence regardée : « moi » pour l'agence connectée, l'id
   pour une fiche de la console. Les abonnés d'une entrée se réveillent
   ensemble ; l'appel en cours est partagé, jamais doublé. */
interface Entree {
  usage: AgencyUsage | null
  /** Vrai tant qu'aucune réponse n'est arrivée, même en erreur. */
  attente: boolean
  enCours: Promise<void> | null
  abonnes: Set<() => void>
  /** Un seul minuteur par agence regardée, posé par le premier abonné, retiré par le dernier. */
  minuteur: number | null
}

const MOI = 'moi'
const entrees = new Map<string, Entree>()

function entree(cle: string): Entree {
  let e = entrees.get(cle)
  if (!e) {
    e = { usage: null, attente: true, enCours: null, abonnes: new Set(), minuteur: null }
    entrees.set(cle, e)
  }
  return e
}

async function charger(cle: string): Promise<void> {
  if (!HAS_BACKEND) return
  const e = entree(cle)
  if (e.enCours) return e.enCours
  e.enCours = (async () => {
    try {
      if (cle === MOI) {
        // Le portail client n'a pas de session : on ne demande rien, et on ne
        // bloque rien. Un doute n'est jamais une raison de fermer une porte.
        const { data } = await client().auth.getSession()
        if (!data.session) { e.usage = null; return }
        e.usage = await loadMyUsage()
      } else {
        e.usage = await loadAgencyUsage(cle)
      }
    } catch {
      // Une erreur de réseau n'est pas un dépassement : on garde la dernière
      // valeur connue, ou rien, et l'écran ne bloque personne.
    } finally {
      e.attente = false
      e.enCours = null
      e.abonnes.forEach((fn) => fn())
    }
  })()
  return e.enCours
}

/**
 * À appeler après une création réussie (dossier, cargaison, dépôt, compte,
 * bureau). Tous les écrans abonnés rechargent tout de suite, puis une seconde
 * fois trois secondes plus tard : le magasin écrit d'abord en local et le
 * miroir pousse vers la base juste après, le premier appel peut le devancer.
 */
export function signalerUsage(): void {
  const vivants = [...entrees.entries()].filter(([, e]) => e.abonnes.size > 0).map(([cle]) => cle)
  vivants.forEach((cle) => void charger(cle))
  window.setTimeout(() => vivants.forEach((cle) => void charger(cle)), 3000)
}

/* ------------------------------- Le hook ----------------------------- */

export interface UsageState {
  usage: AgencyUsage | null
  /** Vrai avant la première réponse seulement : ensuite on garde l'ancienne valeur. */
  loading: boolean
  reload: () => Promise<void>
  pire: UsageNiveau
  alertes: UsageResource[]
}

/**
 * La consommation, vivante. Sans `agencyId`, c'est celle de l'agence
 * connectée ; avec, celle d'une agence vue depuis la console. `every` est le
 * rafraîchissement en millisecondes (60 s par défaut), jamais en arrière-plan.
 */
export function useUsage(options: { agencyId?: string; every?: number } = {}): UsageState {
  const cle = options.agencyId ?? MOI
  const every = options.every ?? 60_000
  const [, reveiller] = useReducer((x: number) => x + 1, 0)

  useEffect(() => {
    if (!HAS_BACKEND) return
    const e = entree(cle)
    e.abonnes.add(reveiller)
    void charger(cle)
    const visible = () => document.visibilityState === 'visible'
    // Jamais en arrière-plan : on n'interroge pas la base pour un onglet que
    // personne ne regarde. Le retour sur l'onglet recharge tout de suite.
    if (e.minuteur === null) e.minuteur = window.setInterval(() => { if (visible()) void charger(cle) }, every)
    const onVis = () => { if (visible()) void charger(cle) }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      e.abonnes.delete(reveiller)
      if (e.abonnes.size === 0 && e.minuteur !== null) { window.clearInterval(e.minuteur); e.minuteur = null }
    }
  }, [cle, every])

  const reload = useCallback(() => charger(cle), [cle])
  const e = entrees.get(cle)
  const usage = HAS_BACKEND ? (e?.usage ?? null) : null
  const resources = usage?.resources ?? []
  return {
    usage,
    loading: HAS_BACKEND && (e?.attente ?? true),
    reload,
    pire: pireNiveau(resources),
    alertes: alertesUsage(resources),
  }
}

/**
 * Le garde de création : vrai SEULEMENT quand la base dit « bloque » pour
 * cette ressource. Sans backend, sans session, avant la première réponse ou
 * après une erreur : faux. On ne ferme jamais une porte sur un doute.
 */
export function useQuotaBloque(code: 'cases' | 'shipments' | 'storage'): boolean {
  const { usage } = useUsage()
  return usage?.resources.find((r) => r.code === code)?.niveau === 'bloque'
}
