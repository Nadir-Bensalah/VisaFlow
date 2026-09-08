/**
 * La logistique aval : ce qui se passe entre le navire et le client.
 *
 * Comme le fret et la douane, ce moteur existe aussi côté base (migration
 * 0048). L'interface en a besoin localement pour afficher un compte à rebours
 * qui bouge tous les jours sans attendre le réseau, et pour que la
 * démonstration montre exactement les mêmes chiffres que la production.
 *
 * Le vecteur d'essai est le même des deux côtés : 100 kg pour 1 m³ donnent
 * 166,67 kg taxables, 300 kg pour 1 m³ en donnent 300.
 */

import { originPreferentialAllowed } from '@/lib/douane'
import type { Tone } from '@/lib/derive'

/* ------------------------------------------------------------------ */
/* Le poids taxable aérien                                             */
/* ------------------------------------------------------------------ */

/**
 * Le diviseur IATA. Un mètre cube vaut 1 000 000 cm³ ; divisé par 6 000, il
 * pèse 166,67 kg pour la facturation.
 */
export const IATA_DIVISOR = 6000

/** 166,666... kg par mètre cube. Affiché arrondi, jamais utilisé arrondi. */
export const KG_PER_CBM = 1000000 / IATA_DIVISOR

/**
 * Le poids taxable aérien : le plus élevé du poids réel et du poids
 * volumétrique.
 *
 * À NE PAS CONFONDRE avec la règle maritime W/M (`chargeableUnits` dans
 * `lib/fret.ts`), qui compare des TONNES à des mètres cubes et rend une unité
 * payante. En aérien on compare des KILOS à des kilos, et on rend des kilos.
 * Un envoi de 100 kg pour 1 m³ vaut 1 unité payante en maritime, et 166,67 kg
 * taxables en aérien : les confondre facture l'aérien au sixième de son prix.
 */
export function airChargeableWeight(weightKg?: number | null, volumeCbm?: number | null): number {
  const volumetric = (volumeCbm ?? 0) * 1000000 / IATA_DIVISOR
  // Deux décimales, comme la compagnie les facture et comme le SQL les rend.
  return Math.round(Math.max(weightKg ?? 0, volumetric) * 100) / 100
}

/** Vrai quand c'est le volume qui décide, et non la balance. */
export function airVolumeDecides(weightKg?: number | null, volumeCbm?: number | null): boolean {
  return (volumeCbm ?? 0) * 1000000 / IATA_DIVISOR > (weightKg ?? 0)
}

/* ------------------------------------------------------------------ */
/* Les certificats d'origine                                           */
/* ------------------------------------------------------------------ */

export type OriginCertificateKind =
  | 'EUR1' | 'EURMED' | 'ORIGINE_ARABE' | 'CERTIFICAT_ORIGINE'
  | 'DECLARATION_FACTURE' | 'AUTRE'

export type OriginCertificateStatus = 'a_demander' | 'demande' | 'obtenu' | 'refuse' | 'expire'

/** Les quatre formulaires qui ne servent qu'à revendiquer un préférentiel. */
const PREFERENTIAL_FORMS: OriginCertificateKind[] = [
  'EUR1', 'EURMED', 'ORIGINE_ARABE', 'DECLARATION_FACTURE',
]

/**
 * Un EUR.1 sur une origine chinoise est presque toujours une erreur : la Chine
 * n'entre dans aucun accord préférentiel tunisien. Presque toujours, pas
 * toujours. On avertit donc, on ne refuse pas : une saisie bloquée se recopie
 * ailleurs, hors de vue, et on perd la trace.
 */
export function originCertificateWarning(
  kind?: OriginCertificateKind,
  origin?: string,
): 'origine_sans_preferentiel' | null {
  if (!kind || !origin) return null
  if (!PREFERENTIAL_FORMS.includes(kind)) return null
  return originPreferentialAllowed(origin) ? null : 'origine_sans_preferentiel'
}

/* ------------------------------------------------------------------ */
/* Le compte à rebours des jours francs                                */
/* ------------------------------------------------------------------ */

const DAY = 86400000

function dayNumber(value: Date): number {
  return Math.floor(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / DAY)
}

/**
 * Combien de jours il reste avant la première journée facturable. Négatif
 * quand elle est passée : c'est exactement ce que l'agence veut voir, un
 * nombre rouge qui grandit.
 */
export function freeDaysLeft(demurrageStartDate?: string | null, today = new Date()): number | null {
  if (!demurrageStartDate) return null
  const start = new Date(demurrageStartDate)
  if (Number.isNaN(start.getTime())) return null
  return dayNumber(start) - dayNumber(today)
}

export type ArrivalUrgency = 'inconnue' | 'large' | 'proche' | 'demain' | 'depassee'

/** Le ton du compte à rebours. Trois jours, c'est déjà tard : un dossier de
    dédouanement ne se monte pas en une matinée. */
export function arrivalUrgency(daysLeft: number | null): ArrivalUrgency {
  if (daysLeft === null) return 'inconnue'
  if (daysLeft < 0) return 'depassee'
  if (daysLeft <= 1) return 'demain'
  if (daysLeft <= 3) return 'proche'
  return 'large'
}

export function urgencyTone(urgency: ArrivalUrgency): Tone {
  if (urgency === 'depassee') return 'red'
  if (urgency === 'demain') return 'red'
  if (urgency === 'proche') return 'orange'
  if (urgency === 'large') return 'green'
  return 'gray'
}

/* ------------------------------------------------------------------ */
/* Les livraisons                                                      */
/* ------------------------------------------------------------------ */

export type DeliveryStatus =
  | 'a_programmer' | 'programmee' | 'en_route' | 'livree' | 'echouee' | 'reportee'

export const DELIVERY_STATUSES: DeliveryStatus[] = [
  'a_programmer', 'programmee', 'en_route', 'livree', 'echouee', 'reportee',
]

export const DELIVERY_TONE: Record<DeliveryStatus, Tone> = {
  a_programmer: 'gray',
  programmee: 'blue',
  en_route: 'violet',
  livree: 'green',
  echouee: 'red',
  reportee: 'orange',
}

/* ------------------------------------------------------------------ */
/* L'entrepôt                                                          */
/* ------------------------------------------------------------------ */

export type MovementDirection = 'ENTREE' | 'SORTIE' | 'TRANSFERT'

export interface StockLine {
  packages: number
  weightKg: number
  volumeCbm: number
}

/**
 * Le stock ne se stocke pas : il se recompte à partir des mouvements. Garder
 * un total à part, c'est se retrouver avec deux chiffres et personne pour
 * dire lequel croire. Un transfert sort d'ici, il ne disparaît pas du monde.
 */
export function stockFromMovements(
  movements: { direction: MovementDirection; packageCount?: number | null; weightKg?: number | null; volumeCbm?: number | null }[],
): StockLine {
  return movements.reduce<StockLine>((total, m) => {
    const sign = m.direction === 'ENTREE' ? 1 : -1
    return {
      packages: total.packages + sign * (m.packageCount ?? 0),
      weightKg: total.weightKg + sign * (m.weightKg ?? 0),
      volumeCbm: total.volumeCbm + sign * (m.volumeCbm ?? 0),
    }
  }, { packages: 0, weightKg: 0, volumeCbm: 0 })
}

/** Le taux d'occupation, quand la capacité est connue. */
export function occupancyPct(volumeCbm: number, capacityCbm?: number | null): number | null {
  if (!capacityCbm || capacityCbm <= 0) return null
  return Math.max(0, Math.min(100, Math.round((volumeCbm / capacityCbm) * 100)))
}

/* ------------------------------------------------------------------ */
/* Les coûts                                                           */
/* ------------------------------------------------------------------ */

export type CostKind =
  | 'FRET' | 'DOUANE' | 'PORT' | 'MANUTENTION' | 'STOCKAGE' | 'SURESTARIES'
  | 'TRANSPORT' | 'ASSURANCE' | 'COMMISSIONNAIRE' | 'DOCUMENT' | 'LIVRAISON' | 'AUTRE'

export const COST_KINDS: CostKind[] = [
  'FRET', 'DOUANE', 'PORT', 'MANUTENTION', 'STOCKAGE', 'SURESTARIES',
  'TRANSPORT', 'ASSURANCE', 'COMMISSIONNAIRE', 'DOCUMENT', 'LIVRAISON', 'AUTRE',
]

/** Le coût ramené à la devise de l'agence. Additionner des dinars et des
    dollars donne un total qui ne veut rien dire. */
export function costBase(amount?: number | null, fxRate?: number | null): number {
  return Math.round((amount ?? 0) * (fxRate ?? 1) * 100) / 100
}

/** La marge en pourcentage. Sur un facturé nul elle n'existe pas : on rend
    null, jamais zéro, qui se lirait « on ne gagne rien ». */
export function marginPct(invoiced: number, costs: number): number | null {
  if (invoiced <= 0) return null
  return Math.round(((invoiced - costs) / invoiced) * 10000) / 100
}

export const TRACKING_EVENTS = [
  'PRIS_EN_CHARGE', 'RECU_ENTREPOT', 'DOUANE_EXPORT', 'PARTI', 'EN_TRANSIT',
  'TRANSBORDEMENT', 'ARRIVE', 'DOUANE_IMPORT', 'INSPECTION', 'DEDOUANE',
  'EN_LIVRAISON', 'LIVRE',
] as const

export type TrackingEvent = typeof TRACKING_EVENTS[number]
