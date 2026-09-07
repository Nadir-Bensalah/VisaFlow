import type {
  AttemptResult, Client, Consulate, Database, DocState, Priority, ProfessionalStatus, QueueEntry,
  RefusalCode, Shipment, ShipmentStage, Stage, VisaCase,
} from '@/data/types'

/* Toutes les lectures calculees vivent ici. Les pages ne recalculent rien
   dans leur JSX : elles appellent ces fonctions. */

export const STAGES: Stage[] = [
  'nouveau', 'pieces', 'verification', 'rendez_vous', 'depot', 'consulat', 'decision', 'retrait', 'clos',
]

export const ACTIVE_STAGES: Stage[] = STAGES.filter((s) => s !== 'clos')

export type Tone = 'gray' | 'blue' | 'green' | 'orange' | 'red' | 'violet'

export const STAGE_TONE: Record<Stage, Tone> = {
  nouveau: 'gray',
  pieces: 'orange',
  verification: 'blue',
  rendez_vous: 'violet',
  depot: 'blue',
  consulat: 'violet',
  decision: 'blue',
  retrait: 'green',
  clos: 'gray',
}

export const DOC_TONE: Record<DocState, Tone> = {
  manquante: 'red',
  demandee: 'orange',
  recue: 'blue',
  validee: 'green',
  refusee: 'red',
  expiree: 'orange',
}

export const PRIORITY_TONE: Record<Priority, Tone> = {
  basse: 'gray', normale: 'gray', haute: 'orange', urgente: 'red',
}

export const DAY = 86400000

export function daysUntil(iso?: string): number {
  if (!iso) return Infinity
  return Math.round((new Date(iso).getTime() - Date.now()) / DAY)
}

export function daysSince(iso?: string): number {
  if (!iso) return Infinity
  return Math.round((Date.now() - new Date(iso).getTime()) / DAY)
}

export interface Progress { done: number; total: number; pct: number }

export function progress(db: Database, caseId: string): Progress {
  const docs = db.documents.filter((d) => d.caseId === caseId && d.required)
  const done = docs.filter((d) => d.state === 'validee').length
  const total = docs.length || 1
  return { done, total: docs.length, pct: Math.round((done / total) * 100) }
}

export function blockingDocs(db: Database, caseId: string) {
  return db.documents.filter(
    (d) => d.caseId === caseId && d.required && ['manquante', 'demandee', 'refusee', 'expiree'].includes(d.state),
  )
}

export interface Urgency {
  score: number
  /** Cle de la raison principale, traduite a l'affichage. */
  reason: 'depart' | 'bloque' | 'silence' | 'impaye' | 'passeport' | 'aucune'
  days: number
}

/** Classement par urgence reelle, pas par date de creation.
    C'est ce tri qui remplace le fil WhatsApp. */
export function urgency(db: Database, kase: VisaCase): Urgency {
  if (kase.status !== 'ouvert') return { score: 0, reason: 'aucune', days: 0 }
  const client = db.clients.find((c) => c.id === kase.clientId)
  const toTravel = daysUntil(kase.travelDate)
  const blocked = blockingDocs(db, kase.id).length
  const silence = daysSince(kase.updatedAt)
  const unpaid = kase.amountTotal - kase.amountPaid
  const passportIn = daysUntil(client?.passportExpiry)

  let score = 0
  let reason: Urgency['reason'] = 'aucune'
  let days = 0

  if (toTravel <= 21) { score += (22 - Math.max(toTravel, 0)) * 4; reason = 'depart'; days = toTravel }
  if (blocked > 0 && toTravel <= 45) {
    const add = blocked * 12
    if (add > score / 2) { reason = 'bloque'; days = blocked }
    score += add
  }
  if (silence >= 7) {
    const add = silence * 2
    if (add > score) { reason = 'silence'; days = silence }
    score += add
  }
  if (unpaid > 0 && toTravel <= 14) {
    const add = 18
    if (add > score) { reason = 'impaye'; days = unpaid }
    score += add
  }
  if (passportIn < 180) {
    const add = 25
    if (add > score) { reason = 'passeport'; days = passportIn }
    score += add
  }
  if (kase.priority === 'urgente') score += 30
  if (kase.priority === 'haute') score += 15

  return { score: Math.round(score), reason, days }
}

export function isLate(db: Database, kase: VisaCase): boolean {
  if (kase.status !== 'ouvert') return false
  const visa = db.visaTypes.find((v) => v.id === kase.visaTypeId)
  const need = visa?.processingDays ?? 10
  return daysUntil(kase.travelDate) < need && kase.stage !== 'retrait'
}

export interface Kpis {
  open: number
  missingDocs: number
  late: number
  collected: number
  outstanding: number
  todayAppointments: number
  acceptance: number
  avgDays: number
}

/** Les indicateurs se calculent sur ce que la personne a le droit de voir.
    Passer `db` en entier ferait fuiter les totaux des autres bureaux. */
export function kpis(db: Database, scope?: Pick<Database, 'cases' | 'documents' | 'payments' | 'appointments'>): Kpis {
  const source = scope ?? db
  const open = source.cases.filter((c) => c.status === 'ouvert')
  const missingDocs = source.documents.filter(
    (d) => d.required && ['manquante', 'demandee'].includes(d.state) && open.some((c) => c.id === d.caseId),
  ).length
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const collected = source.payments
    .filter((p) => p.state === 'regle' && p.at && new Date(p.at) >= monthStart)
    .reduce((sum, p) => sum + p.amount, 0)
  const outstanding = open.reduce((sum, c) => sum + (c.amountTotal - c.amountPaid), 0)
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999)
  const todayAppointments = source.appointments.filter(
    (a) => a.status === 'prevu' && new Date(a.at) >= startOfDay && new Date(a.at) <= endOfDay,
  ).length
  const decided = source.cases.filter((c) => c.status === 'accepte' || c.status === 'refuse')
  const acceptance = decided.length
    ? Math.round((decided.filter((c) => c.status === 'accepte').length / decided.length) * 100)
    : 0
  const closed = source.cases.filter((c) => c.decisionAt)
  const avgDays = closed.length
    ? Math.round(
        closed.reduce((sum, c) => sum + (new Date(c.decisionAt!).getTime() - new Date(c.openedAt).getTime()) / DAY, 0) /
          closed.length,
      )
    : 0

  return { open: open.length, missingDocs, late: open.filter((c) => isLate(db, c)).length, collected, outstanding, todayAppointments, acceptance, avgDays }
}

export function clientName(db: Database, clientId: string): string {
  const c = db.clients.find((x) => x.id === clientId)
  return c ? `${c.firstName} ${c.lastName}` : '—'
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

/** Couleur d'avatar stable, tiree du nom. Pas de aleatoire a l'affichage. */
export function avatarTone(name: string): Tone {
  const tones: Tone[] = ['blue', 'green', 'orange', 'violet', 'gray']
  let sum = 0
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i)
  return tones[sum % tones.length]
}

export function caseBalance(kase: VisaCase): number {
  return kase.amountTotal - kase.amountPaid
}

/* ------------------------------------------------------------------ */
/* Cargaisons                                                          */
/* ------------------------------------------------------------------ */

export const SHIPMENT_STAGES: ShipmentStage[] = [
  'demande', 'ramassage', 'entrepot', 'empotage', 'depart', 'transit', 'arrivee', 'douane', 'livraison', 'livre',
]

export const SHIPMENT_TONE: Record<ShipmentStage, Tone> = {
  demande: 'gray', ramassage: 'orange', entrepot: 'orange', empotage: 'blue', depart: 'blue',
  transit: 'violet', arrivee: 'blue', douane: 'orange', livraison: 'blue', livre: 'green',
}

export function shipmentProgress(shipment: Shipment): number {
  const idx = SHIPMENT_STAGES.indexOf(shipment.stage)
  return Math.round(((idx + 1) / SHIPMENT_STAGES.length) * 100)
}

/** Une cargaison est en retard si l'ETA est passee sans livraison. */
export function shipmentLate(shipment: Shipment): boolean {
  return shipment.status === 'en_cours' && daysUntil(shipment.eta) < 0
}

export function shipmentDocsPending(db: Database, shipmentId: string) {
  return db.shipmentDocs.filter(
    (d) => d.shipmentId === shipmentId && d.required && ['manquante', 'demandee', 'refusee', 'expiree'].includes(d.state),
  )
}

/* ------------------------------------------------------------------ */
/* Creneaux, biometrie, refus                                          */
/* ------------------------------------------------------------------ */

/** Les empreintes restent valables 59 mois. Un client encore couvert n'a pas
    a se deplacer : cela change le prix, le delai et le besoin de creneau. */
export const BIOMETRICS_MONTHS = 59

export function biometricsValidUntil(iso?: string): string | undefined {
  if (!iso) return undefined
  const t = new Date(iso)
  t.setMonth(t.getMonth() + BIOMETRICS_MONTHS)
  return t.toISOString()
}

export function biometricsValid(iso?: string): boolean {
  const until = biometricsValidUntil(iso)
  return until ? new Date(until).getTime() > Date.now() : false
}

const PRIORITY_WEIGHT: Record<Priority, number> = { urgente: 3, haute: 2, normale: 1, basse: 0 }

/** La file d'un consulat, triee. La priorite passe devant l'anciennete, et
    l'anciennete departage a priorite egale. C'est ce classement que le client
    voit dans son portail : « vous etes 4e sur la liste Italie ». */
export function queueOf(db: Database, consulateId: string, entries?: QueueEntry[]): QueueEntry[] {
  return (entries ?? db.queue)
    .filter((q) => q.consulateId === consulateId && q.status === 'attente')
    .sort((a, b) => {
      const p = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]
      return p !== 0 ? p : a.joinedAt.localeCompare(b.joinedAt)
    })
}

/** Rang d'un dossier dans sa file, a partir de 1. Zero s'il n'y est pas. */
export function queueRank(db: Database, caseId: string, entries?: QueueEntry[]): { rank: number; total: number; entry?: QueueEntry } {
  const mine = (entries ?? db.queue).find((q) => q.caseId === caseId && q.status === 'attente')
  if (!mine) return { rank: 0, total: 0 }
  const line = queueOf(db, mine.consulateId, entries)
  return { rank: line.findIndex((q) => q.id === mine.id) + 1, total: line.length, entry: mine }
}

/** Delai reel d'obtention d'un creneau, mesure sur les files deja servies.
    C'est ce chiffre qui permet enfin de repondre honnetement « combien de
    temps », au lieu du delai annonce par le poste. */
export function realWaitDays(db: Database, consulateId: string): number | undefined {
  const served = db.queue.filter((q) => q.consulateId === consulateId && q.status === 'servi' && q.servedAt)
  if (served.length === 0) return undefined
  const total = served.reduce((sum, q) => sum + (new Date(q.servedAt!).getTime() - new Date(q.joinedAt).getTime()) / DAY, 0)
  return Math.round(total / served.length)
}

export const ATTEMPT_TONE: Record<AttemptResult, Tone> = {
  creneau_pris: 'green',
  aucun_creneau: 'gray',
  site_indisponible: 'orange',
  compte_bloque: 'red',
  erreur: 'red',
}

export interface RefusalRow {
  key: string
  consulateId?: string
  visaTypeId?: string
  status?: ProfessionalStatus
  decided: number
  refused: number
  rate: number
}

/** Taux de refus par croisement. C'est la statistique que l'agence ne trouve
    nulle part ailleurs, et la raison pour laquelle elle ne change plus de
    logiciel au bout de six mois. Le taux national ne sert qu'a se comparer. */
export function refusalStats(
  cases: VisaCase[],
  by: 'consulate' | 'visaType' | 'status',
  clients?: Client[],
): RefusalRow[] {
  const decided = cases.filter((c) => c.status === 'accepte' || c.status === 'refuse')
  const rows = new Map<string, RefusalRow>()
  for (const c of decided) {
    let key: string | undefined
    if (by === 'consulate') key = c.consulateId
    else if (by === 'visaType') key = c.visaTypeId
    else key = clients?.find((x) => x.id === c.clientId)?.professionalStatus
    if (!key) continue
    const row = rows.get(key) ?? {
      key,
      consulateId: by === 'consulate' ? key : undefined,
      visaTypeId: by === 'visaType' ? key : undefined,
      status: by === 'status' ? (key as ProfessionalStatus) : undefined,
      decided: 0, refused: 0, rate: 0,
    }
    row.decided += 1
    if (c.status === 'refuse') row.refused += 1
    rows.set(key, row)
  }
  return [...rows.values()]
    .map((r) => ({ ...r, rate: r.decided ? Math.round((r.refused / r.decided) * 1000) / 10 : 0 }))
    .sort((a, b) => b.decided - a.decided)
}

/** Repartition des motifs de refus, du plus frequent au moins frequent.
    C'est ce qui nourrit la liste de pieces : si la sortie non etablie domine,
    ce sont les justificatifs d'attache qu'il faut renforcer. */
export function refusalReasons(cases: VisaCase[]): { code: RefusalCode; n: number; pct: number }[] {
  const refused = cases.filter((c) => c.status === 'refuse')
  const counts = new Map<RefusalCode, number>()
  for (const c of refused) {
    const code = c.refusalCode ?? 'autre'
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  const total = refused.length || 1
  return [...counts.entries()]
    .map(([code, n]) => ({ code, n, pct: Math.round((n / total) * 100) }))
    .sort((a, b) => b.n - a.n)
}

/** Echeance de recours, calculee depuis le delai du consulat. Jamais une
    constante : les sources donnent 30 jours ici et 2 mois la. */
export function appealDue(consulate: Consulate | undefined, decisionAt?: string): string | undefined {
  if (!consulate?.appealDays || !decisionAt) return undefined
  const t = new Date(decisionAt)
  t.setDate(t.getDate() + consulate.appealDays)
  return t.toISOString()
}
