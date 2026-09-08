/**
 * Le fret : le trajet en tronçons, les trois compteurs de stationnement, et la
 * règle W/M du groupage.
 *
 * Comme la douane, ce moteur existe aussi côté base. L'interface en a besoin
 * localement pour afficher des compteurs qui tournent tous les jours sans
 * attendre le réseau, et pour que la démonstration montre les mêmes chiffres
 * que la production.
 */

import type { CounterKind, DemurrageTariff, ShipmentLeg, ShipmentLot } from '@/data/types'

export type CounterLine = {
  kind: CounterKind
  status: 'non_demarre' | 'tarif_absent' | 'dans_les_francs' | 'en_depassement'
  billedBy?: string
  containerType?: string
  start?: string
  stop?: string
  elapsedDays?: number
  freeDays?: number
  overdueDays?: number
  containers?: number
  surchargePct?: number
  amount?: number
  currency?: string
  running?: boolean
  /** Vrai quand le barème utilisé n'était pas en vigueur au démarrage du compteur. */
  outOfPeriod?: boolean
}

const DAY = 86400000

function toDay(iso?: string): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY)
}

function today(): number {
  const d = new Date()
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY)
}

function dayIso(n: number): string {
  return new Date(n * DAY).toISOString().slice(0, 10)
}

/**
 * La somme par paliers. Le tarif journalier n'est pas constant : il monte à
 * partir du 3e ou 4e jour. Un dépassement de 5 jours avec [1-3 à 45, 4+ à 90]
 * fait 3x45 + 2x90 = 315, et non 5x90 = 450.
 */
export function tierAmount(tiers: DemurrageTariff['tiers'], days: number): number {
  let total = 0
  for (const t of tiers ?? []) {
    if (days < t.fromDay) continue
    const upper = t.toDay ?? days
    const inTier = Math.min(days, upper) - t.fromDay + 1
    if (inTier > 0) total += inTier * t.rate
  }
  return total
}

export type CounterShipment = {
  destPort?: string
  mode?: string
  containerType?: string
  containersCount?: number
  carrier?: string
  handler?: string
  arrivedAt?: string
  dischargedAt?: string
  gateOutAt?: string
  containerReturnedAt?: string
  goodsRemovedAt?: string
  deliveredAt?: string
}

/**
 * Les trois compteurs. Chacun a son propre départ, son propre arrêt et son
 * propre débiteur, et c'est tout l'enjeu : les confondre fait réclamer le
 * mauvais jour à la mauvaise personne.
 *
 *   Surestaries · l'armateur · conteneur RESTÉ dans le terminal
 *   Détention   · l'armateur · conteneur SORTI et non restitué
 *   Magasinage  · le manutentionnaire · stationnement de la MARCHANDISE
 */
export function shipmentCounters(s: CounterShipment, tariffs: DemurrageTariff[]): CounterLine[] {
  const ct = s.containerType ?? (s.mode === 'maritime_lcl' ? 'LCL' : '40')
  const port = s.destPort ?? ''
  const now = today()
  const kinds: CounterKind[] = ['surestaries', 'detention', 'magasinage']

  return kinds.map((kind): CounterLine => {
    let start: number | null
    let stop: number
    if (kind === 'surestaries') {
      start = toDay(s.dischargedAt)
      stop = toDay(s.gateOutAt) ?? now
    } else if (kind === 'detention') {
      start = toDay(s.gateOutAt)
      stop = toDay(s.containerReturnedAt) ?? now
    } else {
      start = toDay(s.dischargedAt) ?? toDay(s.arrivedAt)
      stop = toDay(s.goodsRemovedAt) ?? toDay(s.deliveredAt) ?? now
    }
    if (start == null) return { kind, status: 'non_demarre' }

    const billedByFallback = kind === 'magasinage' ? s.handler : s.carrier
    const matching = tariffs.filter(
      (t) => t.kind === kind && t.port === port && t.containerType === ct,
    )
    const startIso = dayIso(start)
    let tariff = matching
      .filter((t) => t.validFrom <= startIso && (!t.validTo || t.validTo >= startIso))
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]
    let outOfPeriod = false
    if (!tariff) {
      // Le compteur a démarré avant que l'agence n'ait saisi son barème : c'est
      // le cas de tout conteneur déjà au port le jour de la mise en service. On
      // chiffre avec le plus ancien barème connu, et on le dit.
      tariff = [...matching].sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0]
      outOfPeriod = !!tariff
    }

    const elapsed = Math.max(0, stop - start)
    if (!tariff) {
      // Sans barème, on montre l'horloge mais on ne chiffre pas : un zéro
      // afficherait une facture nulle là où il y a peut-être des milliers de
      // dinars.
      return {
        kind, status: 'tarif_absent', containerType: ct, billedBy: billedByFallback,
        start: startIso, stop: dayIso(stop), elapsedDays: elapsed,
      }
    }

    const overdue = Math.max(0, elapsed - tariff.freeDays)
    // Le magasinage porte sur la marchandise : il ne se multiplie pas par le
    // nombre de conteneurs, contrairement aux deux compteurs de l'armateur.
    const containers = kind === 'magasinage' ? 1 : (s.containersCount ?? 1)
    const raw = tierAmount(tariff.tiers, overdue) * containers * (1 + tariff.surchargePct / 100)

    return {
      kind,
      status: overdue > 0 ? 'en_depassement' : 'dans_les_francs',
      billedBy: tariff.billedBy || billedByFallback,
      containerType: ct,
      start: startIso,
      stop: dayIso(stop),
      elapsedDays: elapsed,
      freeDays: tariff.freeDays,
      overdueDays: overdue,
      containers,
      surchargePct: tariff.surchargePct,
      amount: Math.round(raw * 100) / 100,
      currency: tariff.currency,
      running: stop === now,
      outOfPeriod,
    }
  })
}

// ------------------------------------------------------------------
// Le trajet en tronçons
// ------------------------------------------------------------------

/* Le calcul du trajet n'a besoin que des dates et de l'ordre. On reste générique
   pour que l'appelant garde le typage complet de ses tronçons. */
type LegTiming = Pick<ShipmentLeg, 'seq' | 'etd' | 'eta' | 'atd' | 'ata'>
export type RouteLeg = ShipmentLeg & { days?: number; hubWaitDays?: number }

/**
 * Le trajet, avec ce qui compte vraiment : l'attente au hub. C'est elle qui
 * explique l'écart des durées annoncées, de 21 à 54 jours selon les sources,
 * et c'est là que se produit le retard le plus fréquent.
 */
export function shipmentRoute<T extends LegTiming>(legs: T[]): {
  legs: (T & { days?: number; hubWaitDays?: number })[]
  legsCount: number
  transshipCount: number
  totalDays?: number
} {
  const ordered = [...legs].sort((a, b) => a.seq - b.seq)
  const out = ordered.map((l, i) => {
    const dep = toDay(l.atd) ?? toDay(l.etd)
    const arr = toDay(l.ata) ?? toDay(l.eta)
    const next = ordered[i + 1]
    const nextDep = next ? (toDay(next.atd) ?? toDay(next.etd)) : null
    return {
      ...l,
      days: dep != null && arr != null ? arr - dep : undefined,
      hubWaitDays: arr != null && nextDep != null ? Math.max(0, nextDep - arr) : undefined,
    }
  })
  const first = out[0]
  const last = out[out.length - 1]
  const start = first ? (toDay(first.atd) ?? toDay(first.etd)) : null
  const end = last ? (toDay(last.ata) ?? toDay(last.eta)) : null
  return {
    legs: out,
    legsCount: out.length,
    transshipCount: Math.max(0, out.length - 1),
    totalDays: start != null && end != null ? end - start : undefined,
  }
}

/**
 * Il n'existe AUCUNE ligne directe Chine vers Radès : le tirant d'eau des
 * postes porte-conteneurs y est de -8,8 m, aucun grand porte-conteneurs
 * asiatique ne peut toucher. Les onze lignes régulières viennent toutes de
 * Méditerranée. Un trajet d'un seul tenant est donc faux, et l'agence promet
 * alors un délai qu'elle ne tiendra pas.
 */
export function routeWarning(
  s: { mode?: string; countryFrom?: string; destPort?: string },
  legs: readonly unknown[],
): 'aucun_troncon' | 'transbordement_manquant' | null {
  if (s.mode !== 'maritime_fcl' && s.mode !== 'maritime_lcl') return null
  if (legs.length === 0) return 'aucun_troncon'
  const towardsRades = /rad[eè]s/i.test(s.destPort ?? '')
  if (legs.length === 1 && towardsRades && s.countryFrom && s.countryFrom !== 'TN') {
    return 'transbordement_manquant'
  }
  return null
}

// ------------------------------------------------------------------
// Le groupage : W/M, solidarité, bascule FCL
// ------------------------------------------------------------------

/**
 * Règle W/M : on facture le plus élevé du poids en tonnes et du volume en CBM,
 * avec un minimum de 1. Un carton de 40 kg pour 0,2 CBM se facture 1 unité.
 */
export function chargeableUnits(weightKg?: number, volumeCbm?: number): number {
  return Math.max((weightKg ?? 0) / 1000, volumeCbm ?? 0, 1)
}

export type QuoteLine = { label: string; basis: string; qty?: number; rate?: number; amount: number }

/**
 * Le devis d'un lot, ligne par ligne. Le forfait de documentation est isolé
 * exprès : c'est lui qui rend un lot de 0,3 CBM non rentable, et le client doit
 * le voir plutôt que de découvrir un prix au mètre cube qui n'a pas de sens.
 */
export function lotQuote(
  lot: { weightKg?: number; volumeCbm?: number },
  totalCbm: number,
  rates: { freightRate: number; strippingTotal: number; docFee: number },
): { chargeableUnits: number; lines: QuoteLine[]; total: number; costPerUnit: number } {
  const units = chargeableUnits(lot.weightKg, lot.volumeCbm)
  const freight = units * rates.freightRate
  const stripping = totalCbm > 0 ? (rates.strippingTotal * (lot.volumeCbm ?? 0)) / totalCbm : 0
  const total = freight + stripping + rates.docFee
  return {
    chargeableUnits: Math.round(units * 1000) / 1000,
    lines: [
      { label: 'fret', basis: 'W/M', qty: Math.round(units * 1000) / 1000, rate: rates.freightRate, amount: Math.round(freight * 100) / 100 },
      { label: 'depotage', basis: 'prorata CBM', amount: Math.round(stripping * 100) / 100 },
      { label: 'documentation', basis: 'forfait par House B/L', amount: rates.docFee },
    ],
    total: Math.round(total * 100) / 100,
    costPerUnit: units > 0 ? Math.round((total / units) * 100) / 100 : 0,
  }
}

/** La bascule LCL vers FCL se joue autour de 10 à 15 CBM cumulés. */
export function consolidationAdvice(totalCbm: number): {
  advice: 'groupage_pertinent' | 'comparer_fcl' | 'passer_en_fcl'
  containerHint?: '20' | '40' | '40HC'
} {
  const advice = totalCbm >= 15 ? 'passer_en_fcl' : totalCbm >= 10 ? 'comparer_fcl' : 'groupage_pertinent'
  // Volume chargeable RÉEL, pas géométrique : un 20' porte 25 à 28 CBM.
  const containerHint = totalCbm >= 55 ? '40HC' : totalCbm >= 25 ? '40' : totalCbm >= 15 ? '20' : undefined
  return { advice, containerHint }
}

/**
 * Le conteneur est une unité physique et douanière indivisible : il ne se
 * dépote qu'une fois, pour tout le monde en même temps. Un fret impayé chez un
 * client immobilise les quatorze autres. Mais SEULEMENT tant que le conteneur
 * n'est pas dépoté : après, chacun son sort.
 */
export function lotSolidarity<T extends Pick<ShipmentLot, 'blockedReason' | 'releasedAt'>>(
  strippedAt: string | undefined,
  lots: T[],
): { active: boolean; blocking: T[]; total: number; hostages: number } {
  const active = !strippedAt
  const blocking = lots.filter((l) => !!l.blockedReason)
  const hostages = active && blocking.length > 0
    ? lots.filter((l) => !l.blockedReason && !l.releasedAt).length
    : 0
  return { active, blocking, total: lots.length, hostages }
}
