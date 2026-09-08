import { useMemo } from 'react'
import { useStore } from './store'
import { can, scopeOf } from '@/lib/permissions'
import type { Capability } from '@/lib/permissions'
import type {
  ActivityEvent, Appointment, CaseDocument, Client, Message, Payment, QueueEntry,
  PassportCustody, Shipment, ShipmentDocument, SlotAttempt, Task, User, VisaCase,
} from './types'

/* Le filtre étanche.
   Les pages ne lisent plus db.cases mais v.cases : ce qui n'entre pas dans le
   périmètre de la personne connectée n'existe pas pour l'écran. Filtrer à
   l'affichage seulement laisserait fuir les totaux, les compteurs et la
   recherche.

   Deux périmètres, et un choix :
   · un agent ou un lecteur ne voit que SON bureau, sans option ;
   · la direction voit toute l'agence, et peut choisir de ne regarder qu'un
     bureau (officeFilter) : mêmes chiffres, même écran, que verrait l'équipe
     de ce bureau. Le serveur applique la même règle dans ses politiques. */

export interface Visible {
  user: User
  scope: 'agence' | 'bureau'
  /** Le bureau regardé : celui de la personne, ou celui choisi par la direction, ou null pour tout. */
  officeId: string | null
  can: (capability: Capability) => boolean
  cases: VisaCase[]
  shipments: Shipment[]
  clients: Client[]
  documents: CaseDocument[]
  custody: PassportCustody[]
  shipmentDocs: ShipmentDocument[]
  messages: Message[]
  payments: Payment[]
  appointments: Appointment[]
  tasks: Task[]
  events: ActivityEvent[]
  queue: QueueEntry[]
  attempts: SlotAttempt[]
}

export function useVisible(): Visible {
  const { db, currentUserId, officeFilter } = useStore()

  return useMemo(() => {
    const user = db.users.find((u) => u.id === currentUserId) ?? db.users[0]
    const scope = scopeOf(user)
    const wholeAgency = scope === 'agence'
    // Un filtre qui pointe un bureau disparu ne doit pas vider l'écran.
    const chosen = wholeAgency && officeFilter && db.agency.offices.some((o) => o.id === officeFilter) ? officeFilter : null
    const officeId = wholeAgency ? chosen : user.officeId
    const restrict = officeId !== null

    const cases = restrict ? db.cases.filter((c) => c.officeId === officeId) : db.cases
    const shipments = restrict ? db.shipments.filter((s) => s.officeId === officeId) : db.shipments
    const clients = restrict ? db.clients.filter((c) => c.officeId === officeId) : db.clients

    const caseIds = new Set(cases.map((c) => c.id))
    const shipmentIds = new Set(shipments.map((s) => s.id))

    return {
      user,
      scope,
      officeId,
      can: (capability: Capability) => can(user, capability),
      cases,
      shipments,
      clients,
      documents: db.documents.filter((d) => caseIds.has(d.caseId)),
      custody: db.custody.filter((c) => c.caseId != null && caseIds.has(c.caseId)),
      shipmentDocs: db.shipmentDocs.filter((d) => shipmentIds.has(d.shipmentId)),
      // Rien qui n'appartienne ni a un dossier ni a une cargaison du perimetre.
      messages: db.messages.filter((m) => (m.caseId ? caseIds.has(m.caseId) : m.shipmentId ? shipmentIds.has(m.shipmentId) : false)),
      payments: db.payments.filter((p) => (p.caseId ? caseIds.has(p.caseId) : p.shipmentId ? shipmentIds.has(p.shipmentId) : false)),
      appointments: db.appointments.filter((a) => (a.caseId ? caseIds.has(a.caseId) : a.shipmentId ? shipmentIds.has(a.shipmentId) : false)),
      tasks: wholeAgency && !restrict
        ? db.tasks
        : db.tasks.filter((t) => (t.caseId ? caseIds.has(t.caseId) : wholeAgency || t.assigneeId === user.id)),
      // Le journal d'agence, sans dossier rattaché, ne sort pas du cercle des responsables.
      events: db.events.filter((e) => (e.caseId ? caseIds.has(e.caseId) : wholeAgency)),
      queue: db.queue.filter((q) => caseIds.has(q.caseId)),
      // Une tentative sans dossier vise la file entière : elle reste visible,
      // sinon le registre du jour serait vide pour un agent de bureau.
      attempts: db.attempts.filter((a) => (a.caseId ? caseIds.has(a.caseId) : true)),
    }
  }, [db, currentUserId, officeFilter])
}
