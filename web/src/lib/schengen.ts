/**
 * Le compteur 90 jours sur 180.
 *
 * C'est la question que le client pose le plus souvent, et depuis l'entrée en
 * service de l'EES le 10 avril 2026 elle est devenue quotidienne : « combien de
 * jours me reste-t-il ? ». Aucune agence tunisienne ne sait y répondre
 * autrement qu'en comptant sur les doigts, tampon par tampon.
 *
 * La règle exacte, et les deux erreurs qu'on fait toujours :
 *
 *   · La fenêtre est GLISSANTE, pas fixe. Elle ne se remet pas à zéro le
 *     1er janvier ni à la date du visa : à chaque jour on regarde les 180 jours
 *     qui précèdent, ce jour compris.
 *   · Le jour d'entrée ET le jour de sortie comptent tous les deux. Un
 *     aller-retour dans la journée compte pour un jour, pas zéro.
 *
 * Conséquence utile : des jours se libèrent tout seuls en vieillissant. Un
 * client à 90 jours pleins n'est pas bloqué pour toujours, il doit attendre que
 * ses vieux séjours sortent de la fenêtre. On sait donc lui donner une date.
 */

export const WINDOW_DAYS = 180
export const MAX_DAYS = 90

const DAY_MS = 86400000

/** Un séjour dans l'espace, tel qu'il figure sur les tampons ou dans l'EES. */
export type Stay = {
  id?: string
  /** Date d'entrée, au format AAAA-MM-JJ. */
  entry: string
  /** Date de sortie. Absente = le client est encore à l'intérieur. */
  exit?: string
  country?: string
  note?: string
}

/** Adapte un séjour enregistré à la forme minimale que le calcul demande. */
export const asStay = (s: { entryDate: string; exitDate?: string }): Stay =>
  ({ entry: s.entryDate, exit: s.exitDate })

type Span = { from: number; to: number }

const toDay = (iso: string): number => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Math.floor(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / DAY_MS)
}
const toIso = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10)
export const todayIso = (): string => {
  const d = new Date()
  return toIso(Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS))
}

/**
 * Fusionne les séjours qui se chevauchent ou se touchent. Sans ça, deux
 * tampons qui se recouvrent feraient compter deux fois les mêmes jours, et on
 * annoncerait au client moins de jours qu'il n'en a réellement.
 */
function normalise(stays: Stay[], reference: number): Span[] {
  const spans = stays
    .filter((s) => s.entry)
    .map((s) => ({
      from: toDay(s.entry),
      // Pas de sortie = encore à l'intérieur : on compte jusqu'au jour de référence.
      to: s.exit ? toDay(s.exit) : reference,
    }))
    .filter((s) => s.to >= s.from)
    .sort((a, b) => a.from - b.from)

  const merged: Span[] = []
  for (const s of spans) {
    const last = merged[merged.length - 1]
    if (last && s.from <= last.to + 1) last.to = Math.max(last.to, s.to)
    else merged.push({ ...s })
  }
  return merged
}

function usedOn(spans: Span[], day: number): number {
  const windowStart = day - (WINDOW_DAYS - 1)
  let total = 0
  for (const s of spans) {
    const from = Math.max(s.from, windowStart)
    const to = Math.min(s.to, day)
    if (to >= from) total += to - from + 1
  }
  return total
}

export type SchengenState = {
  /** Le jour pour lequel le calcul est fait. */
  on: string
  /** Premier jour de la fenêtre glissante de 180 jours. */
  windowFrom: string
  used: number
  remaining: number
  /** Vrai si le client est actuellement à l'intérieur de l'espace. */
  inside: boolean
  /**
   * Le jour où le client doit être sorti s'il est à l'intérieur : au-delà, il
   * est en séjour irrégulier, et c'est un refus quasi certain à la demande
   * suivante.
   */
  mustLeaveBy?: string
}

/** L'état du compteur à une date donnée. */
export function schengenState(stays: Stay[], on: string = todayIso()): SchengenState {
  const day = toDay(on)
  const spans = normalise(stays, day)
  const used = usedOn(spans, day)
  const inside = stays.some((s) => !s.exit && toDay(s.entry) <= day)

  let mustLeaveBy: string | undefined
  if (inside) {
    // On avance jour par jour tant que le quota tient : le dernier jour tenable
    // est la date limite de sortie.
    let d = day
    for (let k = 0; k < MAX_DAYS + 1; k++) {
      const test = spans.map((s) => ({ ...s, to: s.to === day ? d + 1 : s.to }))
      if (usedOn(test, d + 1) > MAX_DAYS) break
      d += 1
    }
    mustLeaveBy = toIso(d)
  }

  return {
    on,
    windowFrom: toIso(day - (WINDOW_DAYS - 1)),
    used,
    remaining: Math.max(0, MAX_DAYS - used),
    inside,
    mustLeaveBy,
  }
}

export type StayPlan = {
  /** Nombre de jours consécutifs possibles à partir de la date d'entrée visée. */
  maxDays: number
  /** Le jour qui ferait basculer au-dessus de 90, s'il existe. */
  blockedOn?: string
  /**
   * La première date à laquelle le client peut de nouveau entrer au moins un
   * jour. Utile quand maxDays vaut zéro : on lui donne une date au lieu d'un
   * refus sec.
   */
  earliestEntry?: string
}

/**
 * Combien de jours d'affilée le client peut-il rester s'il entre à cette date ?
 *
 * On ne peut pas se contenter de « jours restants aujourd'hui » : la contrainte
 * doit tenir CHAQUE jour du séjour, et la fenêtre bouge pendant qu'il est sur
 * place. On avance donc jour par jour.
 */
export function planStay(stays: Stay[], entry: string = todayIso()): StayPlan {
  const start = toDay(entry)
  const base = normalise(stays, start)

  let maxDays = 0
  let blockedOn: string | undefined
  for (let k = 0; k < MAX_DAYS; k++) {
    const day = start + k
    // Le séjour envisagé, tel qu'il serait ce jour-là.
    const withPlan = normalise(
      [...base.map((s) => ({ entry: toIso(s.from), exit: toIso(s.to) })),
       { entry: toIso(start), exit: toIso(day) }],
      day,
    )
    if (usedOn(withPlan, day) > MAX_DAYS) {
      blockedOn = toIso(day)
      break
    }
    maxDays = k + 1
  }

  let earliestEntry: string | undefined
  if (maxDays === 0) {
    // Des jours se libèrent en vieillissant : on cherche le premier jour où au
    // moins un jour redevient disponible, dans la limite d'une fenêtre.
    for (let k = 1; k <= WINDOW_DAYS; k++) {
      const day = start + k
      const spans = normalise(stays, day)
      if (usedOn(spans, day) < MAX_DAYS) { earliestEntry = toIso(day); break }
    }
  }

  return { maxDays, blockedOn, earliestEntry }
}
