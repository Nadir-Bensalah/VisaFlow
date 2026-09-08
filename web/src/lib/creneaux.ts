import type { Database, Priority } from '@/data/types'

/**
 * L'alerte de créneau libéré.
 *
 * L'étude de marché est brutale sur ce point : « c'est le produit entier de
 * tls-visa.com ». Une société vit de cette seule fonction, parce que le goulot
 * du métier n'est pas le dossier mais le CRÉNEAU : 200 à 350 TND sur un ticket
 * de 550.
 *
 * Ce qu'on ne fait pas : aspirer le site du prestataire. C'est fragile, contraire
 * à ses conditions, et ça casse au premier changement de page. Ce qu'on fait à la
 * place vaut mieux : au moment où un créneau apparaît, l'agent sait en une
 * seconde POUR QUI le prendre.
 *
 * Car la vraie question n'est pas « qui est le premier de la file », mais « qui
 * est le premier DONT LE DOSSIER EST PRÊT ». Réserver pour quelqu'un à qui il
 * manque deux pièces, c'est brûler le créneau : il ne passera pas l'accueil.
 */

/** Les empreintes valent 59 mois. Encore valables, elles évitent le déplacement. */
export const BIOMETRICS_MONTHS = 59

export type SlotCandidate = {
  entryId: string
  caseId: string
  reference: string
  clientId: string
  clientName: string
  phone?: string
  priority: Priority
  joinedAt: string
  travelDate?: string
  /** Toutes les pièces obligatoires sont reçues ou validées. */
  ready: boolean
  docsReady: number
  docsRequired: number
  docsMissing: number
  biometricsValid: boolean
}

const PRIORITY_ORDER: Record<string, number> = { urgente: 0, haute: 1, normale: 2, basse: 3 }

/**
 * La file d'un poste, dans l'ordre où il faut appeler quand un créneau se libère.
 * Les dossiers prêts d'abord, puis l'urgence, puis la date de voyage, puis
 * l'ancienneté dans la file. On ne double personne sans raison.
 */
export function slotCandidates(db: Database, consulateId: string, limit = 20): SlotCandidate[] {
  const out: SlotCandidate[] = []

  for (const q of db.queue) {
    if (q.consulateId !== consulateId || q.status !== 'attente') continue
    const kase = db.cases.find((c) => c.id === q.caseId)
    if (!kase || kase.status !== 'ouvert') continue
    const client = db.clients.find((c) => c.id === kase.clientId)
    if (!client) continue

    const required = db.documents.filter((d) => d.caseId === kase.id && d.required)
    const ready = required.filter((d) => d.state === 'recue' || d.state === 'validee')
    const bio = client.biometricsAt
      ? new Date(client.biometricsAt).getTime() >
        Date.now() - BIOMETRICS_MONTHS * 30.4 * 86400000
      : false

    out.push({
      entryId: q.id,
      caseId: kase.id,
      reference: kase.reference,
      clientId: client.id,
      clientName: `${client.firstName} ${client.lastName}`.trim(),
      phone: client.whatsapp ?? client.phone,
      priority: q.priority,
      joinedAt: q.joinedAt,
      travelDate: kase.travelDate,
      ready: required.length > 0 && required.length === ready.length,
      docsReady: ready.length,
      docsRequired: required.length,
      docsMissing: Math.max(0, required.length - ready.length),
      biometricsValid: bio,
    })
  }

  return out
    .sort((a, b) => {
      // Un dossier prêt d'abord : réserver pour un dossier incomplet brûle le
      // créneau, le client ne passera pas l'accueil.
      if (a.ready !== b.ready) return a.ready ? -1 : 1
      const pa = PRIORITY_ORDER[a.priority] ?? 9
      const pb = PRIORITY_ORDER[b.priority] ?? 9
      if (pa !== pb) return pa - pb
      if (a.travelDate && b.travelDate && a.travelDate !== b.travelDate) {
        return a.travelDate.localeCompare(b.travelDate)
      }
      if (a.travelDate && !b.travelDate) return -1
      if (!a.travelDate && b.travelDate) return 1
      return a.joinedAt.localeCompare(b.joinedAt)
    })
    .slice(0, limit)
}

export type FreedSlot = {
  source: 'rendez_vous_annule' | 'creneau_vu'
  at: string
  consulateId?: string
  location?: string
  freedCase?: string
}

/**
 * Les créneaux qui viennent de se libérer. Deux sources : un rendez-vous annulé
 * ou reporté dont l'heure est encore devant nous, et un créneau vu sans être
 * pris. Dans les deux cas, quelqu'un doit être appelé maintenant.
 */
export function freedSlots(db: Database, sinceHours = 48): FreedSlot[] {
  const now = Date.now()
  const out: FreedSlot[] = []

  for (const a of db.appointments) {
    if (a.status !== 'manque' && a.status !== 'reporte') continue
    if (new Date(a.at).getTime() <= now) continue
    const kase = a.caseId ? db.cases.find((c) => c.id === a.caseId) : undefined
    if (!kase?.consulateId) continue
    out.push({
      source: 'rendez_vous_annule',
      at: a.at,
      consulateId: kase.consulateId,
      location: a.location,
      freedCase: kase.reference,
    })
  }

  for (const s of db.attempts) {
    if (s.result !== 'creneau_libre' || !s.slotAt) continue
    if (new Date(s.at).getTime() < now - sinceHours * 3600000) continue
    if (new Date(s.slotAt).getTime() <= now) continue
    out.push({ source: 'creneau_vu', at: s.slotAt, consulateId: s.consulateId })
  }

  return out.sort((a, b) => a.at.localeCompare(b.at))
}
