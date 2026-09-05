import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { buildSeed } from './seed'
import type {
  ActivityEvent, Appointment, CaseDocument, Database, DocState, EventType, I18nText,
  Message, Payment, ShipmentEvent, ShipmentStage, Stage, VisaCase,
} from './types'

/* Magasin local. Toute l'application passe par ici, jamais par le stockage
   directement. Le jour ou Supabase arrive, seul ce fichier change. */

const STORAGE_PREFIX = 'visaflow.db.'
const CURRENT_VERSION = 1

function load(slug: string): Database {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + slug)
    if (raw) {
      const parsed = JSON.parse(raw) as Database
      if (parsed.version === CURRENT_VERSION) return parsed
    }
  } catch {
    // Stockage illisible ou plein : on repart du jeu de demonstration.
  }
  return buildSeed(slug)
}

function save(slug: string, db: Database) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(db))
  } catch {
    // Quota depasse : la session reste utilisable, seule la persistance saute.
  }
}

const nowIso = () => new Date().toISOString()
const rid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

interface StoreValue {
  db: Database
  slug: string
  /** Utilisateur connecte a l'espace agence. */
  currentUserId: string
  setCurrentUserId: (id: string) => void
  actions: Actions
}

interface Actions {
  setStage: (caseId: string, stage: Stage) => void
  advance: (caseId: string) => void
  setDocState: (docId: string, state: DocState, reason?: string) => void
  requestMissingDocs: (caseId: string) => number
  remindDoc: (docId: string) => void
  sendMessage: (input: { caseId: string; body: string; channel: Message['channel']; templateKey?: string; automated?: boolean }) => void
  addNote: (caseId: string, text: string) => void
  markPaymentPaid: (paymentId: string, method: Payment['method']) => void
  addAppointment: (input: Omit<Appointment, 'id' | 'agencyId'>) => void
  toggleRule: (ruleId: string) => void
  runRules: () => number
  toggleTask: (taskId: string) => void
  createCase: (input: { clientId: string; visaTypeId: string; assigneeId: string; travelDate?: string; source: VisaCase['source'] }) => string
  createClient: (input: { firstName: string; lastName: string; phone: string; email?: string; nationality: string; locale: Database['agency']['defaultLocale']; officeId: string }) => string
  advanceShipment: (shipmentId: string) => void
  setShipmentDocState: (docId: string, state: DocState) => void
  updateAgency: (patch: Partial<Database['agency']>) => void
  reset: () => void
  exportJson: () => string
}

const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [db, setDb] = useState<Database>(() => load(slug))
  const [currentUserId, setCurrentUserId] = useState<string>(() => db.users[1]?.id ?? db.users[0].id)

  useEffect(() => { save(slug, db) }, [slug, db])

  const log = useCallback(
    (draft: Database, type: EventType, detail: I18nText, caseId?: string, automated = false): Database => {
      const event: ActivityEvent = {
        id: rid('ev'), agencyId: draft.agency.id, caseId, actorId: automated ? undefined : currentUserId,
        type, at: nowIso(), detail, automated,
      }
      return { ...draft, events: [event, ...draft.events] }
    },
    [currentUserId],
  )

  const touch = (draft: Database, caseId: string): Database => ({
    ...draft,
    cases: draft.cases.map((c) => (c.id === caseId ? { ...c, updatedAt: nowIso() } : c)),
  })

  const actions = useMemo<Actions>(() => {
    const STAGES: Stage[] = ['nouveau', 'pieces', 'verification', 'rendez_vous', 'depot', 'consulat', 'decision', 'retrait', 'clos']

    const setStage: Actions['setStage'] = (caseId, stage) =>
      setDb((prev) => {
        const target = prev.cases.find((c) => c.id === caseId)
        if (!target || target.stage === stage) return prev
        let next: Database = {
          ...prev,
          cases: prev.cases.map((c) =>
            c.id === caseId
              ? { ...c, stage, updatedAt: nowIso(), status: stage === 'clos' && c.status === 'ouvert' ? 'accepte' : c.status }
              : c,
          ),
        }
        next = log(next, 'etape_changee', {
          fr: `${target.reference} passe à l’étape « ${stage} ».`,
          en: `${target.reference} moved to stage "${stage}".`,
          ar: `${target.reference} انتقل إلى مرحلة «${stage}».`,
          zh: `${target.reference} 进入“${stage}”阶段。`,
        }, caseId)
        return next
      })

    const advance: Actions['advance'] = (caseId) =>
      setDb((prev) => {
        const target = prev.cases.find((c) => c.id === caseId)
        if (!target) return prev
        const idx = STAGES.indexOf(target.stage)
        if (idx < 0 || idx >= STAGES.length - 1) return prev
        const stage = STAGES[idx + 1]
        let next: Database = {
          ...prev,
          cases: prev.cases.map((c) =>
            c.id === caseId
              ? { ...c, stage, updatedAt: nowIso(), status: stage === 'clos' ? 'accepte' : c.status }
              : c,
          ),
        }
        next = log(next, 'etape_changee', {
          fr: `${target.reference} avance à « ${stage} ».`,
          en: `${target.reference} advanced to "${stage}".`,
          ar: `${target.reference} تقدم إلى «${stage}».`,
          zh: `${target.reference} 推进到“${stage}”。`,
        }, caseId)
        return next
      })

    const setDocState: Actions['setDocState'] = (docId, state, reason) =>
      setDb((prev) => {
        const doc = prev.documents.find((d) => d.id === docId)
        if (!doc) return prev
        const patch: Partial<CaseDocument> = { state }
        if (state === 'demandee') patch.requestedAt = nowIso()
        if (state === 'recue') patch.receivedAt = nowIso()
        if (state === 'validee') { patch.validatedAt = nowIso(); patch.validatedBy = currentUserId }
        if (state === 'refusee') patch.rejectionReason = reason ?? 'Document illisible.'
        let next: Database = {
          ...prev,
          documents: prev.documents.map((d) => (d.id === docId ? { ...d, ...patch } : d)),
        }
        next = touch(next, doc.caseId)
        const type: EventType = state === 'validee' ? 'piece_validee' : state === 'refusee' ? 'piece_refusee' : state === 'recue' ? 'piece_recue' : 'piece_demandee'
        next = log(next, type, {
          fr: `Pièce « ${doc.label.fr} » : ${state}.`,
          en: `Document "${doc.label.en ?? doc.label.fr}": ${state}.`,
          ar: `وثيقة «${doc.label.ar ?? doc.label.fr}»: ${state}.`,
          zh: `材料“${doc.label.zh ?? doc.label.fr}”：${state}。`,
        }, doc.caseId)
        return next
      })

    const requestMissingDocs: Actions['requestMissingDocs'] = (caseId) => {
      let count = 0
      setDb((prev) => {
        const missing = prev.documents.filter((d) => d.caseId === caseId && d.state === 'manquante')
        count = missing.length
        if (!count) return prev
        let next: Database = {
          ...prev,
          documents: prev.documents.map((d) =>
            d.caseId === caseId && d.state === 'manquante'
              ? { ...d, state: 'demandee', requestedAt: nowIso(), lastReminderAt: nowIso() }
              : d,
          ),
        }
        next = touch(next, caseId)
        next = log(next, 'piece_demandee', {
          fr: `${count} pièces demandées au client en une fois.`,
          en: `${count} documents requested from the client at once.`,
          ar: `طُلبت ${count} وثائق من العميل دفعة واحدة.`,
          zh: `一次性向客户索取 ${count} 项材料。`,
        }, caseId)
        return next
      })
      return count
    }

    const remindDoc: Actions['remindDoc'] = (docId) =>
      setDb((prev) => {
        const doc = prev.documents.find((d) => d.id === docId)
        if (!doc) return prev
        let next: Database = {
          ...prev,
          documents: prev.documents.map((d) =>
            d.id === docId ? { ...d, reminders: d.reminders + 1, lastReminderAt: nowIso(), state: d.state === 'manquante' ? 'demandee' : d.state } : d,
          ),
        }
        next = log(next, 'message_envoye', {
          fr: `Relance envoyée pour « ${doc.label.fr} ».`,
          en: `Reminder sent for "${doc.label.en ?? doc.label.fr}".`,
          ar: `أُرسل تذكير بخصوص «${doc.label.ar ?? doc.label.fr}».`,
          zh: `已就“${doc.label.zh ?? doc.label.fr}”发送催办。`,
        }, doc.caseId)
        return next
      })

    const sendMessage: Actions['sendMessage'] = ({ caseId, body, channel, templateKey, automated }) =>
      setDb((prev) => {
        const kase = prev.cases.find((c) => c.id === caseId)
        const client = prev.clients.find((c) => c.id === kase?.clientId)
        const message: Message = {
          id: rid('ms'), agencyId: prev.agency.id, caseId, channel, direction: 'sortant',
          body, locale: client?.locale ?? prev.agency.defaultLocale,
          authorId: automated ? undefined : currentUserId, templateKey,
          at: nowIso(), status: 'file', automated: Boolean(automated),
        }
        let next: Database = { ...prev, messages: [...prev.messages, message] }
        next = touch(next, caseId)
        next = log(next, 'message_envoye', {
          fr: `Message ${channel} envoyé au client.`,
          en: `${channel} message sent to the client.`,
          ar: `أُرسلت رسالة ${channel} إلى العميل.`,
          zh: `已通过 ${channel} 向客户发送消息。`,
        }, caseId, automated)
        return next
      })

    const addNote: Actions['addNote'] = (caseId, text) =>
      setDb((prev) => {
        let next: Database = {
          ...prev,
          cases: prev.cases.map((c) => (c.id === caseId ? { ...c, notes: text, updatedAt: nowIso() } : c)),
        }
        next = log(next, 'note_ajoutee', {
          fr: 'Note interne mise à jour.', en: 'Internal note updated.',
          ar: 'تحيين ملاحظة داخلية.', zh: '内部备注已更新。',
        }, caseId)
        return next
      })

    const markPaymentPaid: Actions['markPaymentPaid'] = (paymentId, method) =>
      setDb((prev) => {
        const pay = prev.payments.find((p) => p.id === paymentId)
        if (!pay) return prev
        let next: Database = {
          ...prev,
          payments: prev.payments.map((p) =>
            p.id === paymentId ? { ...p, state: 'regle', method, at: nowIso(), receiptNo: p.receiptNo ?? `R-${Math.floor(Math.random() * 9000 + 1000)}` } : p,
          ),
          cases: prev.cases.map((c) =>
            c.id === pay.caseId ? { ...c, amountPaid: Math.min(c.amountTotal, c.amountPaid + pay.amount), updatedAt: nowIso() } : c,
          ),
        }
        next = log(next, 'paiement_encaisse', {
          fr: `Encaissement de ${pay.amount} enregistré.`,
          en: `Payment of ${pay.amount} recorded.`,
          ar: `تسجيل خلاص بقيمة ${pay.amount}.`,
          zh: `已记录 ${pay.amount} 收款。`,
        }, pay.caseId)
        return next
      })

    const addAppointment: Actions['addAppointment'] = (input) =>
      setDb((prev) => {
        const appointment: Appointment = { ...input, id: rid('ap'), agencyId: prev.agency.id }
        let next: Database = { ...prev, appointments: [...prev.appointments, appointment] }
        next = touch(next, input.caseId)
        next = log(next, 'rendez_vous_cree', {
          fr: 'Rendez-vous ajouté au dossier.', en: 'Appointment added to the application.',
          ar: 'أُضيف موعد إلى الملف.', zh: '已为申请添加预约。',
        }, input.caseId)
        return next
      })

    const toggleRule: Actions['toggleRule'] = (ruleId) =>
      setDb((prev) => ({
        ...prev,
        rules: prev.rules.map((r) => (r.id === ruleId ? { ...r, active: !r.active } : r)),
      }))

    /* Moteur d'automatisation. Il ne devine rien : il relit l'etat courant et
       applique les regles actives, exactement comme le fera le serveur. */
    const runRules: Actions['runRules'] = () => {
      let fired = 0
      setDb((prev) => {
        const today = Date.now()
        const days = (iso?: string) => (iso ? Math.round((today - new Date(iso).getTime()) / 86400000) : Infinity)
        const until = (iso?: string) => (iso ? Math.round((new Date(iso).getTime() - today) / 86400000) : Infinity)
        let next = prev
        const newMessages: Message[] = []
        const newEvents: ActivityEvent[] = []

        for (const rule of prev.rules.filter((r) => r.active)) {
          for (const kase of prev.cases.filter((c) => c.status === 'ouvert')) {
            const client = prev.clients.find((c) => c.id === kase.clientId)
            if (!client) continue
            const docs = prev.documents.filter((d) => d.caseId === kase.id)
            let matches = false

            switch (rule.trigger.type) {
              case 'piece_manquante_depuis':
                matches = docs.some((d) => (d.state === 'manquante' || d.state === 'demandee') && d.required && days(d.requestedAt ?? kase.openedAt) >= (rule.trigger.days ?? 3))
                break
              case 'dossier_sans_activite':
                matches = days(kase.updatedAt) >= (rule.trigger.days ?? 7)
                break
              case 'rendez_vous_dans':
                matches = prev.appointments.some((a) => a.caseId === kase.id && a.status === 'prevu' && until(a.at) <= (rule.trigger.days ?? 1) && until(a.at) >= 0)
                break
              case 'passeport_expire_dans':
                matches = until(client.passportExpiry) <= (rule.trigger.days ?? 180)
                break
              case 'depart_dans':
                matches = until(kase.travelDate) <= (rule.trigger.days ?? 7) && until(kase.travelDate) >= 0 && kase.amountPaid < kase.amountTotal
                break
              case 'solde_impaye_depuis':
                matches = kase.amountPaid < kase.amountTotal && days(kase.openedAt) >= (rule.trigger.days ?? 15)
                break
              case 'etape_atteinte':
                matches = kase.stage === rule.trigger.stage
                break
            }
            if (!matches) continue
            fired++

            if (rule.action.type === 'message_client') {
              const template = prev.templates.find((t) => t.key === rule.action.templateKey)
              const body = (template?.body[client.locale] ?? template?.body.fr ?? '')
                .replace('{client}', client.firstName)
                .replace('{reference}', kase.reference)
                .replace('{piece}', docs.find((d) => d.state !== 'validee')?.label[client.locale] ?? '')
                .replace('{montant}', String(kase.amountTotal - kase.amountPaid))
                .replace('{bureau}', prev.agency.offices.find((o) => o.id === kase.officeId)?.name ?? '')
                .replace('{pays}', prev.visaTypes.find((v) => v.id === kase.visaTypeId)?.country[client.locale] ?? '')
                .replace('{date}', '')
                .replace('{lieu}', '')
              if (body) {
                newMessages.push({
                  id: rid('ms'), agencyId: prev.agency.id, caseId: kase.id,
                  channel: rule.action.channel ?? 'whatsapp', direction: 'sortant',
                  body, locale: client.locale, templateKey: rule.action.templateKey,
                  at: nowIso(), status: 'file', automated: true,
                })
              }
            }
            newEvents.push({
              id: rid('ev'), agencyId: prev.agency.id, caseId: kase.id, type: 'automatisation',
              at: nowIso(), automated: true,
              detail: {
                fr: `Règle « ${rule.name.fr} » déclenchée sur ${kase.reference}.`,
                en: `Rule "${rule.name.en ?? rule.name.fr}" fired on ${kase.reference}.`,
                ar: `تفعيل قاعدة «${rule.name.ar ?? rule.name.fr}» على ${kase.reference}.`,
                zh: `规则“${rule.name.zh ?? rule.name.fr}”在 ${kase.reference} 上触发。`,
              },
            })
          }
        }

        if (!fired) return prev
        next = {
          ...prev,
          messages: [...prev.messages, ...newMessages],
          events: [...newEvents, ...prev.events],
          rules: prev.rules.map((r) => (r.active ? { ...r, runs: r.runs + 1, lastRunAt: nowIso() } : r)),
        }
        return next
      })
      return fired
    }

    const toggleTask: Actions['toggleTask'] = (taskId) =>
      setDb((prev) => ({ ...prev, tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) }))

    const createCase: Actions['createCase'] = ({ clientId, visaTypeId, assigneeId, travelDate, source }) => {
      const id = rid('ca')
      setDb((prev) => {
        const visa = prev.visaTypes.find((v) => v.id === visaTypeId)
        const client = prev.clients.find((c) => c.id === clientId)
        if (!visa || !client) return prev
        const checklist = prev.checklists.find((c) => c.id === visa.checklistId)
        const reference = `VF-2026-${String(140 + prev.cases.length + 1).padStart(4, '0')}`
        const kase: VisaCase = {
          id, agencyId: prev.agency.id, reference, clientId, visaTypeId,
          officeId: client.officeId, assigneeId, stage: 'nouveau', status: 'ouvert',
          priority: 'normale', source, openedAt: nowIso(), updatedAt: nowIso(),
          travelDate, dueAt: travelDate, amountTotal: visa.feeAgency + visa.feeConsulate,
          amountPaid: 0, portalToken: rid('tok'),
        }
        const docs: CaseDocument[] = (checklist?.items ?? []).map((item) => ({
          id: `${id}_${item.key}`, caseId: id, key: item.key, label: item.label,
          state: 'manquante', required: item.required, reminders: 0,
        }))
        let next: Database = { ...prev, cases: [kase, ...prev.cases], documents: [...prev.documents, ...docs] }
        next = log(next, 'dossier_cree', {
          fr: `Dossier ${reference} ouvert pour ${client.firstName} ${client.lastName}.`,
          en: `Application ${reference} opened for ${client.firstName} ${client.lastName}.`,
          ar: `فتح الملف ${reference} لفائدة ${client.firstName} ${client.lastName}.`,
          zh: `已为 ${client.firstName} ${client.lastName} 建立申请 ${reference}。`,
        }, id)
        return next
      })
      return id
    }

    const createClient: Actions['createClient'] = (input) => {
      const id = rid('cl')
      setDb((prev) => ({
        ...prev,
        clients: [
          { ...input, id, agencyId: prev.agency.id, tags: [], createdAt: nowIso(), whatsapp: input.phone },
          ...prev.clients,
        ],
      }))
      return id
    }

    const updateAgency: Actions['updateAgency'] = (patch) =>
      setDb((prev) => ({ ...prev, agency: { ...prev.agency, ...patch } }))

    const SHIPMENT_STAGES: ShipmentStage[] = [
      'demande', 'ramassage', 'entrepot', 'empotage', 'depart', 'transit', 'arrivee', 'douane', 'livraison', 'livre',
    ]

    const advanceShipment: Actions['advanceShipment'] = (shipmentId) =>
      setDb((prev) => {
        const shipment = prev.shipments.find((x) => x.id === shipmentId)
        if (!shipment) return prev
        const idx = SHIPMENT_STAGES.indexOf(shipment.stage)
        if (idx < 0 || idx >= SHIPMENT_STAGES.length - 1) return prev
        const stage = SHIPMENT_STAGES[idx + 1]
        const event: ShipmentEvent = {
          id: rid('sev'), shipmentId, stage, at: nowIso(),
          location: stage === 'livre' || stage === 'livraison' ? shipment.destCity : shipment.destPort,
        }
        let next: Database = {
          ...prev,
          shipments: prev.shipments.map((x) =>
            x.id === shipmentId
              ? { ...x, stage, status: stage === 'livre' ? 'livree' : x.status, deliveredAt: stage === 'livre' ? nowIso() : x.deliveredAt }
              : x,
          ),
          shipmentEvents: [...prev.shipmentEvents, event],
        }
        next = log(next, 'etape_changee', {
          fr: `Cargaison ${shipment.reference} : ${stage}.`,
          en: `Shipment ${shipment.reference}: ${stage}.`,
          ar: `الشحنة ${shipment.reference}: ${stage}.`,
          zh: `货运 ${shipment.reference}：${stage}。`,
        })
        return next
      })

    const setShipmentDocState: Actions['setShipmentDocState'] = (docId, state) =>
      setDb((prev) => {
        const doc = prev.shipmentDocs.find((x) => x.id === docId)
        if (!doc) return prev
        let next: Database = {
          ...prev,
          shipmentDocs: prev.shipmentDocs.map((x) =>
            x.id === docId
              ? { ...x, state, receivedAt: state === 'recue' ? nowIso() : x.receivedAt, reminders: state === 'demandee' ? x.reminders + 1 : x.reminders }
              : x,
          ),
        }
        next = log(next, state === 'validee' ? 'piece_validee' : 'piece_demandee', {
          fr: `Document de transport « ${doc.label.fr} » : ${state}.`,
          en: `Transport document "${doc.label.en ?? doc.label.fr}": ${state}.`,
          ar: `وثيقة نقل «${doc.label.ar ?? doc.label.fr}»: ${state}.`,
          zh: `运输单证“${doc.label.zh ?? doc.label.fr}”：${state}。`,
        })
        return next
      })

    const reset: Actions['reset'] = () => setDb(buildSeed(slug))

    const exportJson: Actions['exportJson'] = () => JSON.stringify(db, null, 2)

    return {
      setStage, advance, setDocState, requestMissingDocs, remindDoc, sendMessage, addNote,
      markPaymentPaid, addAppointment, toggleRule, runRules, toggleTask, createCase,
      createClient, advanceShipment, setShipmentDocState, updateAgency, reset, exportJson,
    }
    // db n'entre pas dans les dependances : toutes les mutations passent par
    // setDb(prev => ...) et lisent donc toujours l'etat le plus recent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, log, slug, db])

  const value = useMemo<StoreValue>(
    () => ({ db, slug, currentUserId, setCurrentUserId, actions }),
    [db, slug, currentUserId, actions],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore doit être utilisé dans un StoreProvider')
  return ctx
}
