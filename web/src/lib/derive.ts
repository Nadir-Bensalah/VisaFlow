import type { Database, DocState, Priority, Shipment, ShipmentStage, Stage, VisaCase } from '@/data/types'

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
