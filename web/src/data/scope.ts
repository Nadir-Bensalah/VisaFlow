import { useMemo } from 'react'
import { useStore } from './store'
import { can, scopeOf } from '@/lib/permissions'
import type { Capability } from '@/lib/permissions'
import type {
  ActivityEvent, Appointment, CaseDocument, Client, Message, Payment,
  Shipment, ShipmentDocument, Task, User, VisaCase,
} from './types'

/* Le filtre étanche.
   Les pages ne lisent plus db.cases mais v.cases : ce qui n'entre pas dans le
   périmètre de la personne connectée n'existe pas pour l'écran. Filtrer à
   l'affichage seulement laisserait fuir les totaux, les compteurs et la
   recherche. */

export interface Visible {
  user: User
  scope: 'agence' | 'bureau'
  can: (capability: Capability) => boolean
  cases: VisaCase[]
  shipments: Shipment[]
  clients: Client[]
  documents: CaseDocument[]
  shipmentDocs: ShipmentDocument[]
  messages: Message[]
  payments: Payment[]
  appointments: Appointment[]
  tasks: Task[]
  events: ActivityEvent[]
}

export function useVisible(): Visible {
  const { db, currentUserId } = useStore()

  return useMemo(() => {
    const user = db.users.find((u) => u.id === currentUserId) ?? db.users[0]
    const scope = scopeOf(user)
    const wholeAgency = scope === 'agence'

    const cases = wholeAgency ? db.cases : db.cases.filter((c) => c.officeId === user.officeId)
    const shipments = wholeAgency ? db.shipments : db.shipments.filter((s) => s.officeId === user.officeId)
    const clients = wholeAgency ? db.clients : db.clients.filter((c) => c.officeId === user.officeId)

    const caseIds = new Set(cases.map((c) => c.id))
    const shipmentIds = new Set(shipments.map((s) => s.id))

    return {
      user,
      scope,
      can: (capability: Capability) => can(user, capability),
      cases,
      shipments,
      clients,
      documents: db.documents.filter((d) => caseIds.has(d.caseId)),
      shipmentDocs: db.shipmentDocs.filter((d) => shipmentIds.has(d.shipmentId)),
      messages: db.messages.filter((m) => caseIds.has(m.caseId)),
      payments: db.payments.filter((p) => (p.caseId ? caseIds.has(p.caseId) : true)),
      appointments: db.appointments.filter((a) => caseIds.has(a.caseId)),
      tasks: wholeAgency ? db.tasks : db.tasks.filter((t) => t.assigneeId === user.id || (t.caseId ? caseIds.has(t.caseId) : false)),
      // Le journal d'agence, sans dossier rattaché, ne sort pas du cercle des responsables.
      events: db.events.filter((e) => (e.caseId ? caseIds.has(e.caseId) : wholeAgency)),
    }
  }, [db, currentUserId])
}
