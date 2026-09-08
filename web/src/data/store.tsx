import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { buildSeed } from './seed'
import { HAS_BACKEND, supabase } from '@/lib/supabase'
import { useAuth } from './auth'
import { loadSnapshot, currentAgencyId } from './remote'
import { mirror } from './mirror'
import { samePhone } from './identity'
import { scopeOf } from '@/lib/permissions'
import { AppSkeleton } from '@/components/AppSkeleton'
import type {
  ActivityEvent, Appointment, AttemptResult, CaseDocument, CaseNote, ChecklistItem, Client, ClientRequest,
  Consulate, Database, DocState, EventType, I18nText, Message, MessageTemplate, Payment, Priority, QueueEntry,
  PassportCustody, RefusalCode, Role, Shipment, ShipmentDocument, ShipmentEvent, ShipmentStage, SlotAttempt, Stage, User,
  VisaCase, VisaType, DemurrageTariff,
} from './types'

/* Magasin local. Toute l'application passe par ici, jamais par le stockage
   directement. Le jour ou Supabase arrive, seul ce fichier change. */

const STORAGE_PREFIX = 'visaflow.db.'
const CURRENT_VERSION = 3

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

/** Adresse par defaut d'un rendez-vous consulaire. Il n'y a que deux centres
    TLScontact pour toute la Tunisie, autant les nommer. */
function centreLabel(centre?: Consulate['centre']): string | undefined {
  if (centre === 'tls_tunis') return 'TLScontact, Les Berges du Lac, Tunis'
  if (centre === 'tls_sfax') return 'TLScontact, Sfax'
  if (centre === 'vfs_tunis') return 'VFS Global, Tunis'
  return undefined
}
const rid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

/** Jeton de suivi client : imprevisible, pas seulement unique. */
function token(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`
  }
  return rid(prefix)
}

interface StoreValue {
  db: Database
  slug: string
  /** Utilisateur connecte a l'espace agence. */
  currentUserId: string
  /** Faux tant que personne ne s'est connecte : les routes internes sont fermees. */
  signedIn: boolean
  signIn: (userId: string) => void
  signOut: () => void
  actions: Actions
  /** Décrit un problème de chargement ou d'écriture, pour la bannière. */
  syncError: string | null
  /** Recharge l'agence, et efface l'erreur si ça repasse. */
  retry: () => void
  live: boolean
  setLive: (v: boolean) => void
  /** Vue support active (super-admin dans une agence, en lecture seule), ou null. */
  support: { agencyId: string; agencyName: string } | null
  /** Vrai en vue support : aucune écriture n'est possible. */
  readOnly: boolean
  /** Ouvre une agence en vue support (lecture seule). */
  enterSupport: (agencyId: string) => void
  /** Quitte la vue support et revient à la console plateforme. */
  exitSupport: () => void
}

interface Actions {
  setStage: (caseId: string, stage: Stage) => void
  advance: (caseId: string) => void
  setDocState: (docId: string, state: DocState, reason?: string) => void
  requestMissingDocs: (caseId: string) => number
  remindDoc: (docId: string) => void
  sendMessage: (input: { caseId: string; body: string; channel: Message['channel']; templateKey?: string; automated?: boolean; fromClient?: boolean }) => void
  addNote: (caseId: string, text: string, kind?: CaseNote['kind']) => void
  updateClient: (clientId: string, patch: Partial<Client>) => void
  clearAll: () => void
  stepBackShipment: (shipmentId: string) => void
  markPaymentPaid: (paymentId: string, method: Payment['method']) => void
  addAppointment: (input: Omit<Appointment, 'id' | 'agencyId'>) => void
  toggleRule: (ruleId: string) => void
  runRules: () => number
  toggleTask: (taskId: string) => void
  createCase: (input: { clientId: string; visaTypeId: string; assigneeId: string; travelDate?: string; source: VisaCase['source'] }) => string
  createClient: (input: { firstName: string; lastName: string; phone: string; email?: string; nationality: string; locale: Database['agency']['defaultLocale']; officeId: string }) => string
  decideCase: (caseId: string, status: 'accepte' | 'refuse' | 'annule', reason?: string) => void
  updateCase: (caseId: string, patch: Partial<VisaCase>) => void
  createTask: (input: { caseId?: string; assigneeId: string; title: I18nText; dueAt: string }) => void
  submitRequest: (input: Omit<ClientRequest, 'id' | 'agencyId' | 'reference' | 'status' | 'receivedAt' | 'portalToken'>) => ClientRequest
  convertRequest: (requestId: string, assigneeId: string) => string | null
  refuseRequest: (requestId: string, reason: string) => void
  markSetup: (step: string) => void
  hideSetup: () => void
  updateAppointment: (id: string, patch: Partial<Appointment>) => void
  saveShipment: (shipment: Omit<Shipment, 'agencyId' | 'id'> & { id?: string }) => void
  advanceShipment: (shipmentId: string) => void
  setShipmentDocState: (docId: string, state: DocState) => void
  saveUser: (user: Omit<User, 'agencyId' | 'id'> & { id?: string }) => void
  removeUser: (userId: string) => void
  saveTemplate: (template: Omit<MessageTemplate, 'agencyId' | 'id'> & { id?: string }) => void
  removeTemplate: (templateId: string) => void
  saveVisaType: (visa: Omit<VisaType, 'agencyId' | 'id'> & { id?: string }) => void
  removeVisaType: (visaTypeId: string) => void
  saveChecklistItem: (checklistId: string, item: ChecklistItem, previousKey?: string) => void
  removeChecklistItem: (checklistId: string, key: string) => void
  saveRule: (rule: Database['rules'][number]) => void
  removeRule: (ruleId: string) => void
  updateAgency: (patch: Partial<Database['agency']>) => void
  /** Rattache un fichier déposé à une pièce. La pièce passe reçue d'office :
      déposer, c'est remettre. */
  attachFile: (docId: string, file: { key: string; name: string; size: number; type: string }, byClient?: boolean) => void
  detachFile: (docId: string) => void
  attachShipmentFile: (docId: string, file: { key: string; name: string; size: number; type: string }) => void
  /* Creneaux */
  joinQueue: (input: { caseId: string; consulateId: string; priority?: Priority; note?: string }) => void
  leaveQueue: (entryId: string) => void
  setQueuePriority: (entryId: string, priority: Priority) => void
  /** Sert la file : cree le rendez-vous, sort le dossier de la file, avance l'etape. */
  serveQueue: (entryId: string, slotAt: string, location?: string) => void
  logAttempt: (input: { consulateId: string; centre: Consulate['centre']; result: AttemptResult; caseId?: string; slotAt?: string; note?: string }) => void
  saveConsulate: (consulate: Omit<Consulate, 'agencyId' | 'id'> & { id?: string }) => void
  removeConsulate: (consulateId: string) => void
  /** Crée ou met à jour un barème de stationnement. */
  saveTariff: (tariff: Omit<DemurrageTariff, 'id' | 'agencyId'> & { id?: string }) => void
  /** Clôt un barème à aujourd'hui. On ne le supprime jamais : un compteur
      passé doit rester calculable avec le tarif qui était en vigueur. */
  closeTariff: (tariffId: string) => void
  /** Enregistre la decision avec un code ferme, et arme l'echeance de recours. */
  recordDecision: (caseId: string, status: 'accepte' | 'refuse' | 'annule', input?: { code?: RefusalCode; reason?: string }) => void
  /** Enregistre un passeport reçu en caution. */
  receivePassport: (input: { caseId: string; clientId: string; passportNumber: string; location?: string }) => void
  /** Rend un passeport. Bloqué si le solde n'est pas réglé, sauf forçage direction. */
  releasePassport: (custodyId: string, force?: boolean) => boolean
  reset: () => void
  exportJson: () => string
}

const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const auth = useAuth()
  // La vue support : un super-admin ouvre une agence EN LECTURE SEULE, pour le
  // SAV. La cible tient dans le sessionStorage, elle survit à la navigation
  // interne et au rechargement, mais pas à un nouvel onglet ni à la fermeture.
  const [supportAgency, setSupportAgency] = useState<string | null>(() => {
    try { return window.sessionStorage.getItem('visaflow.support') } catch { return null }
  })
  const support = HAS_BACKEND && !!auth.session && !!auth.isPlatformAdmin && !!supportAgency
  const enterSupport = (agencyId: string) => {
    try { window.sessionStorage.setItem('visaflow.support', agencyId) } catch { /* stockage indisponible */ }
    setSupportAgency(agencyId)
  }
  const exitSupport = () => {
    try { window.sessionStorage.removeItem('visaflow.support') } catch { /* stockage indisponible */ }
    setSupportAgency(null)
  }
  // Mode réel : un backend est là ET une session Supabase est ouverte. Un
  // super-admin n'y entre QUE via la vue support, sur une agence précise.
  const remote = HAS_BACKEND && !!auth.session && (!auth.isPlatformAdmin || support)
  // Lecture seule : en vue support, l'admin regarde, il ne touche à rien.
  const readOnly = support
  const [db, setDb] = useState<Database>(() => load(slug))
  const [ready, setReady] = useState(!remote)
  const [remoteAgencyId, setRemoteAgencyId] = useState<string | null>(null)
  const remoteRef = useRef(remote)
  remoteRef.current = remote

  // La session survit au rechargement, jamais au changement d'agence.
  const [session, setSession] = useState<string | null>(() => {
    try { return window.localStorage.getItem(`visaflow.session.${slug}`) } catch { return null }
  })
  // En mode réel, l'utilisateur courant est le compte connecté. En démo, c'est
  // le compte choisi sur l'écran de connexion.
  const currentUserId = support
    // L'admin n'est pas un employé de l'agence : pour la vue, on l'adosse à un
    // profil à portée agence (la direction), afin qu'il voie tout, en lecture.
    ? (db.users.find((u) => scopeOf(u) === 'agence')?.id ?? db.users[0]?.id ?? '')
    : remote
      ? (auth.user?.id ?? session ?? db.users[0]?.id ?? '')
      : (session ?? db.users[0].id)
  const [live, setLive] = useState(true)
  // La robustesse du chemin de données : un chargement qui échoue ne doit pas
  // laisser un rond qui tourne à l'infini, et une écriture qui rate ne doit
  // pas faire croire à l'utilisateur qu'elle a réussi.
  const [syncError, setSyncError] = useState<string | null>(null)

  // Le rechargement de l'instantané, débrayé et réutilisable.
  const reloadRef = useRef<() => void>(() => {})
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    async function hydrate() {
      try {
        // En vue support, on charge l'agence ciblée ; sinon la sienne.
        const agencyId = support ? supportAgency : await currentAgencyId()
        if (!alive) return
        if (!agencyId) { setReady(true); return }
        setRemoteAgencyId(agencyId)
        const snap = await loadSnapshot(agencyId)
        if (!alive) return
        setDb(snap)
        setSyncError(null)
        setReady(true)
      } catch (e) {
        if (!alive) return
        // On sort de l'attente et on montre l'erreur avec un bouton réessayer,
        // au lieu de bloquer l'agence sur un chargement sans fin.
        console.error('[hydrate]', e)
        setSyncError('connexion')
        setReady(true)
      }
    }
    reloadRef.current = () => {
      // Coalescé : plusieurs écritures rapprochées ne déclenchent qu'un rechargement.
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void hydrate() }, 250)
    }
    if (!remote) { setReady(true); return }
    setReady(false)
    void hydrate()

    // Temps réel : toute écriture dans l'agence, d'où qu'elle vienne, rafraîchit.
    let sub: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
    if (supabase) {
      sub = supabase.channel('agence')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cases' }, () => reloadRef.current())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'case_documents' }, () => reloadRef.current())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => reloadRef.current())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'appointment_queue' }, () => reloadRef.current())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => reloadRef.current())
        .subscribe()
    }
    return () => { alive = false; if (timer) clearTimeout(timer); if (sub && supabase) supabase.removeChannel(sub) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, auth.user?.id, supportAgency])

  // Diffusion entre onglets. Deux fenetres ouvertes sur la meme agence voient
  // la meme chose, sans rechargement : c'est le comportement d'un poste
  // partage au comptoir.
  const channelRef = useRef<BroadcastChannel | null>(null)
  const fromRemote = useRef(false)

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(`visaflow.${slug}`)
    channelRef.current = channel
    channel.onmessage = (event: MessageEvent<{ db: Database }>) => {
      if (!event.data?.db) return
      fromRemote.current = true
      setDb(event.data.db)
    }
    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [slug])

  useEffect(() => {
    save(slug, db)
    // On ne renvoie pas ce qu'on vient de recevoir, sinon les onglets se
    // repondent en boucle.
    if (fromRemote.current) {
      fromRemote.current = false
      return
    }
    channelRef.current?.postMessage({ db })
  }, [slug, db])



  const signIn = useCallback((userId: string) => {
    setSession(userId)
    try { window.localStorage.setItem(`visaflow.session.${slug}`, userId) } catch { /* stockage indisponible */ }
  }, [slug])

  const signOut = useCallback(() => {
    setSession(null)
    try { window.localStorage.removeItem(`visaflow.session.${slug}`) } catch { /* stockage indisponible */ }
    // En mode réel, se déconnecter coupe aussi la session Supabase, sinon le
    // rechargement rouvrirait l'agence sans mot de passe.
    if (remoteRef.current) void auth.signOut()
  }, [slug, auth])

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

    /* Une decision de consulat n'est pas une etape : c'est une issue.
       Sans elle, le taux d'acceptation des rapports est faux. */
    const decideCase: Actions['decideCase'] = (caseId, status, reason) =>
      setDb((prev) => {
        const target = prev.cases.find((c) => c.id === caseId)
        if (!target) return prev
        let next: Database = {
          ...prev,
          cases: prev.cases.map((c) =>
            c.id === caseId
              ? {
                  ...c,
                  status,
                  stage: status === 'accepte' ? 'retrait' : 'clos',
                  decisionAt: nowIso(),
                  refusalReason: status === 'refuse' ? reason : undefined,
                  updatedAt: nowIso(),
                }
              : c,
          ),
        }
        next = log(next, 'decision_recue', {
          fr: `${target.reference} : ${status}.`,
          en: `${target.reference}: ${status}.`,
          ar: `${target.reference}: ${status}.`,
          zh: `${target.reference}：${status}。`,
        }, caseId)
        return next
      })

    const updateCase: Actions['updateCase'] = (caseId, patch) =>
      setDb((prev) => ({
        ...prev,
        cases: prev.cases.map((c) => (c.id === caseId ? { ...c, ...patch, updatedAt: nowIso() } : c)),
      }))

    const createTask: Actions['createTask'] = ({ caseId, assigneeId, title, dueAt }) =>
      setDb((prev) => ({
        ...prev,
        tasks: [
          { id: rid('tk'), agencyId: prev.agency.id, caseId, assigneeId, title, dueAt, done: false, createdAt: nowIso(), automated: false },
          ...prev.tasks,
        ],
      }))

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

    const sendMessage: Actions['sendMessage'] = ({ caseId, body, channel, templateKey, automated, fromClient }) =>
      setDb((prev) => {
        const kase = prev.cases.find((c) => c.id === caseId)
        const client = prev.clients.find((c) => c.id === kase?.clientId)
        const message: Message = {
          id: rid('ms'), agencyId: prev.agency.id, caseId, channel,
          // Un message ecrit depuis le portail vient du client : il ne doit ni
          // etre range du cote de l'agence, ni etre signe d'un employe.
          direction: fromClient ? 'entrant' : 'sortant',
          body, locale: client?.locale ?? prev.agency.defaultLocale,
          authorId: automated || fromClient ? undefined : currentUserId, templateKey,
          at: nowIso(), status: 'file', automated: Boolean(automated),
        }
        let next: Database = { ...prev, messages: [...prev.messages, message] }
        next = touch(next, caseId)
        next = log(next, fromClient ? 'message_recu' : 'message_envoye', {
          fr: fromClient ? 'Message reçu du client depuis le portail.' : `Message ${channel} envoyé au client.`,
          en: `${channel} message sent to the client.`,
          ar: `أُرسلت رسالة ${channel} إلى العميل.`,
          zh: `已通过 ${channel} 向客户发送消息。`,
        }, caseId, automated || Boolean(fromClient))
        return next
      })

    /* Une note s'ajoute, elle n'ecrase pas. Un agent qui perd sa note du
       deuxieme appel n'en ecrit plus jamais. */
    const addNote: Actions['addNote'] = (caseId, text, kind = 'note') =>
      setDb((prev) => {
        const note: CaseNote = { id: rid('note'), at: nowIso(), authorId: currentUserId, text, kind }
        let next: Database = {
          ...prev,
          cases: prev.cases.map((c) => (c.id === caseId ? { ...c, notes: [note, ...c.notes], updatedAt: nowIso() } : c)),
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
        if (input.caseId) next = touch(next, input.caseId)
        next = log(next, 'rendez_vous_cree', {
          fr: 'Rendez-vous ajouté au dossier.', en: 'Appointment added to the application.',
          ar: 'أُضيف موعد إلى الملف.', zh: '已为申请添加预约。',
        }, input.caseId)
        return next
      })

    /* Une demande n'est pas un dossier : c'est quelqu'un qui frappe a la
       porte. On la garde telle quelle jusqu'a ce qu'un agent decide. */
    const submitRequest: Actions['submitRequest'] = (input) => {
      const request: ClientRequest = {
        ...input,
        id: rid('rq'),
        agencyId: db.agency.id,
        reference: `DEM-2026-${String(80 + db.requests.length + 1).padStart(4, '0')}`,
        status: 'nouvelle',
        receivedAt: nowIso(),
        portalToken: token('dem'),
      }
      setDb((prev) => {
        let next: Database = { ...prev, requests: [request, ...prev.requests] }
        next = log(next, 'dossier_cree', {
          fr: `Nouvelle demande ${request.reference} de ${request.firstName} ${request.lastName}.`,
          en: `New request ${request.reference} from ${request.firstName} ${request.lastName}.`,
          ar: `مطلب جديد ${request.reference} من ${request.firstName} ${request.lastName}.`,
          zh: `${request.firstName} ${request.lastName} 的新请求 ${request.reference}。`,
        }, undefined, true)
        return next
      })
      return request
    }

    const convertRequest: Actions['convertRequest'] = (requestId, assigneeId) => {
      const request = db.requests.find((r) => r.id === requestId)
      if (!request || !request.visaTypeId) return null
      // Un client existant est reconnu a son numero, pas a son nom.
      const existing = db.clients.find((c) => samePhone(c.phone, request.phone))
      const clientId = existing?.id ?? createClient({
        firstName: request.firstName,
        lastName: request.lastName,
        phone: request.phone,
        email: request.email,
        nationality: '',
        locale: request.locale,
        officeId: db.users.find((u) => u.id === assigneeId)?.officeId ?? db.agency.offices[0].id,
      })
      const caseId = createCase({
        clientId,
        visaTypeId: request.visaTypeId,
        assigneeId,
        travelDate: request.travelDate,
        source: 'site',
      })
      setDb((prev) => ({
        ...prev,
        clients: prev.clients.map((c) =>
          c.id === clientId && request.phoneVerified ? { ...c, phoneVerifiedAt: nowIso() } : c,
        ),
        requests: prev.requests.map((r) =>
          r.id === requestId
            ? { ...r, status: 'convertie', handledBy: currentUserId, handledAt: nowIso(), clientId, caseId }
            : r,
        ),
      }))
      return caseId
    }

    const refuseRequest: Actions['refuseRequest'] = (requestId, reason) =>
      setDb((prev) => ({
        ...prev,
        requests: prev.requests.map((r) =>
          r.id === requestId
            ? { ...r, status: 'ecartee', refusalReason: reason, handledBy: currentUserId, handledAt: nowIso() }
            : r,
        ),
      }))

    const markSetup: Actions['markSetup'] = (step) =>
      setDb((prev) =>
        prev.agency.setupDone.includes(step)
          ? prev
          : { ...prev, agency: { ...prev.agency, setupDone: [...prev.agency.setupDone, step] } },
      )

    const hideSetup: Actions['hideSetup'] = () =>
      setDb((prev) => ({ ...prev, agency: { ...prev.agency, setupHidden: true } }))

    const updateAppointment: Actions['updateAppointment'] = (id, patch) =>
      setDb((prev) => ({
        ...prev,
        appointments: prev.appointments.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }))

    const saveShipment: Actions['saveShipment'] = (input) =>
      setDb((prev) => {
        const id = input.id ?? rid('sh')
        const exists = prev.shipments.some((x) => x.id === id)
        const shipment: Shipment = { ...input, id, agencyId: prev.agency.id }
        let next: Database = {
          ...prev,
          shipments: exists ? prev.shipments.map((x) => (x.id === id ? shipment : x)) : [shipment, ...prev.shipments],
        }
        if (!exists) {
          // Les documents de transport naissent avec la cargaison, sinon
          // personne ne se souvient du certificat d'origine avant la douane.
          const docs: ShipmentDocument[] = [
            { key: 'facture', label: { fr: 'Facture commerciale', en: 'Commercial invoice', ar: 'الفاتورة التجارية', zh: '商业发票' } },
            { key: 'packing', label: { fr: 'Liste de colisage', en: 'Packing list', ar: 'قائمة التعبئة', zh: '装箱单' } },
            { key: 'bl', label: { fr: 'Connaissement', en: 'Bill of lading', ar: 'سند الشحن', zh: '提单' } },
            { key: 'origine', label: { fr: 'Certificat d’origine', en: 'Certificate of origin', ar: 'شهادة المنشأ', zh: '原产地证' } },
            { key: 'titre', label: { fr: 'Titre de commerce extérieur', en: 'Import licence', ar: 'رخصة التوريد', zh: '进口许可' } },
          ].map((d) => ({ id: `${id}_${d.key}`, shipmentId: id, key: d.key, label: d.label, state: 'manquante' as DocState, required: true, reminders: 0 }))
          next = { ...next, shipmentDocs: [...next.shipmentDocs, ...docs] }
          next = log(next, 'dossier_cree', {
            fr: `Cargaison ${shipment.reference} ouverte.`,
            en: `Shipment ${shipment.reference} opened.`,
            ar: `فتح الشحنة ${shipment.reference}.`,
            zh: `已建立货运 ${shipment.reference}。`,
          })
        }
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
          amountPaid: 0, notes: [], portalToken: token('tok'),
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

    /* ---------------------------------------------------------------- */
    /* Equipe, modeles, catalogue : tout ce qui se configure sans code     */
    /* ---------------------------------------------------------------- */

    const saveUser: Actions['saveUser'] = (input) =>
      setDb((prev) => {
        const id = input.id ?? rid('u')
        const user: User = { ...input, id, agencyId: prev.agency.id, role: input.role as Role }
        const exists = prev.users.some((u) => u.id === id)
        return {
          ...prev,
          users: exists ? prev.users.map((u) => (u.id === id ? user : u)) : [...prev.users, user],
        }
      })

    const removeUser: Actions['removeUser'] = (userId) =>
      setDb((prev) => {
        // On ne supprime jamais quelqu'un qui porte des dossiers : on le
        // desactive. Sinon l'historique perd son auteur.
        const holdsCases = prev.cases.some((c) => c.assigneeId === userId)
        if (holdsCases) {
          return { ...prev, users: prev.users.map((u) => (u.id === userId ? { ...u, active: false } : u)) }
        }
        return { ...prev, users: prev.users.filter((u) => u.id !== userId) }
      })

    const saveTemplate: Actions['saveTemplate'] = (input) =>
      setDb((prev) => {
        const id = input.id ?? rid('tpl')
        const template: MessageTemplate = { ...input, id, agencyId: prev.agency.id }
        const exists = prev.templates.some((t) => t.id === id)
        return {
          ...prev,
          templates: exists ? prev.templates.map((t) => (t.id === id ? template : t)) : [...prev.templates, template],
        }
      })

    const removeTemplate: Actions['removeTemplate'] = (templateId) =>
      setDb((prev) => ({ ...prev, templates: prev.templates.filter((t) => t.id !== templateId) }))

    const saveVisaType: Actions['saveVisaType'] = (input) =>
      setDb((prev) => {
        const id = input.id ?? rid('vt')
        const visa: VisaType = { ...input, id, agencyId: prev.agency.id }
        const exists = prev.visaTypes.some((v) => v.id === id)
        return {
          ...prev,
          visaTypes: exists ? prev.visaTypes.map((v) => (v.id === id ? visa : v)) : [...prev.visaTypes, visa],
        }
      })

    const removeVisaType: Actions['removeVisaType'] = (visaTypeId) =>
      setDb((prev) => {
        const used = prev.cases.some((c) => c.visaTypeId === visaTypeId)
        if (used) {
          return { ...prev, visaTypes: prev.visaTypes.map((v) => (v.id === visaTypeId ? { ...v, active: false } : v)) }
        }
        return { ...prev, visaTypes: prev.visaTypes.filter((v) => v.id !== visaTypeId) }
      })

    const saveChecklistItem: Actions['saveChecklistItem'] = (checklistId, item, previousKey) =>
      setDb((prev) => ({
        ...prev,
        checklists: prev.checklists.map((list) => {
          if (list.id !== checklistId) return list
          const key = previousKey ?? item.key
          const exists = list.items.some((i) => i.key === key)
          return {
            ...list,
            items: exists ? list.items.map((i) => (i.key === key ? item : i)) : [...list.items, item],
          }
        }),
      }))

    const removeChecklistItem: Actions['removeChecklistItem'] = (checklistId, key) =>
      setDb((prev) => ({
        ...prev,
        checklists: prev.checklists.map((list) =>
          list.id === checklistId ? { ...list, items: list.items.filter((i) => i.key !== key) } : list,
        ),
      }))

    const saveRule: Actions['saveRule'] = (rule) =>
      setDb((prev) => {
        const exists = prev.rules.some((r) => r.id === rule.id)
        return {
          ...prev,
          rules: exists ? prev.rules.map((r) => (r.id === rule.id ? rule : r)) : [...prev.rules, rule],
        }
      })

    const removeRule: Actions['removeRule'] = (ruleId) =>
      setDb((prev) => ({ ...prev, rules: prev.rules.filter((r) => r.id !== ruleId) }))

    const updateClient: Actions['updateClient'] = (clientId, patch) =>
      setDb((prev) => ({
        ...prev,
        clients: prev.clients.map((c) => (c.id === clientId ? { ...c, ...patch } : c)),
      }))

    /* Le symetrique de reset : une base vraiment vide, pour une agence qui a
       fini de regarder la demonstration. */
    const clearAll: Actions['clearAll'] = () =>
      setDb((prev) => ({
        ...prev,
        clients: [], cases: [], documents: [], messages: [], appointments: [],
        payments: [], events: [], tasks: [], shipments: [], shipmentDocs: [],
        shipmentEvents: [], requests: [],
      }))

    const stepBackShipment: Actions['stepBackShipment'] = (shipmentId) =>
      setDb((prev) => {
        const shipment = prev.shipments.find((x) => x.id === shipmentId)
        if (!shipment) return prev
        const idx = SHIPMENT_STAGES.indexOf(shipment.stage)
        if (idx <= 0) return prev
        const stage = SHIPMENT_STAGES[idx - 1]
        return {
          ...prev,
          shipments: prev.shipments.map((x) => (x.id === shipmentId ? { ...x, stage, status: 'en_cours' } : x)),
          shipmentEvents: prev.shipmentEvents.filter((e) => !(e.shipmentId === shipmentId && e.stage === shipment.stage)),
        }
      })

    /* ---------------------------------------------------------------- */
    /* Creneaux                                                          */
    /* ---------------------------------------------------------------- */

    const joinQueue: Actions['joinQueue'] = ({ caseId, consulateId, priority, note }) =>
      setDb((prev) => {
        // Un dossier n'attend qu'une fois. Reprendre une place perdue ne doit
        // pas doubler la ligne.
        if (prev.queue.some((q) => q.caseId === caseId && q.status === 'attente')) return prev
        const target = prev.cases.find((c) => c.id === caseId)
        const consulate = prev.consulates.find((c) => c.id === consulateId)
        const entry: QueueEntry = {
          id: rid('q'), agencyId: prev.agency.id, caseId, consulateId,
          joinedAt: nowIso(), priority: priority ?? target?.priority ?? 'normale',
          status: 'attente', note,
        }
        let next: Database = {
          ...prev,
          queue: [entry, ...prev.queue],
          cases: prev.cases.map((c) => (c.id === caseId ? { ...c, consulateId, updatedAt: nowIso() } : c)),
        }
        next = log(next, 'creneau_attente', {
          fr: `${target?.reference ?? ''} entre dans la file ${consulate?.city ?? ''}.`,
          en: `${target?.reference ?? ''} joined the ${consulate?.city ?? ''} queue.`,
          ar: `${target?.reference ?? ''} انضم إلى قائمة انتظار ${consulate?.city ?? ''}.`,
          zh: `${target?.reference ?? ''} 加入 ${consulate?.city ?? ''} 队列。`,
        }, caseId)
        return next
      })

    const leaveQueue: Actions['leaveQueue'] = (entryId) =>
      setDb((prev) => ({
        ...prev,
        queue: prev.queue.map((q) => (q.id === entryId ? { ...q, status: 'abandonne', leftAt: nowIso() } : q)),
      }))

    const setQueuePriority: Actions['setQueuePriority'] = (entryId, priority) =>
      setDb((prev) => ({ ...prev, queue: prev.queue.map((q) => (q.id === entryId ? { ...q, priority } : q)) }))

    const serveQueue: Actions['serveQueue'] = (entryId, slotAt, location) =>
      setDb((prev) => {
        const entry = prev.queue.find((q) => q.id === entryId)
        if (!entry || entry.status !== 'attente') return prev
        const target = prev.cases.find((c) => c.id === entry.caseId)
        const consulate = prev.consulates.find((c) => c.id === entry.consulateId)
        const appointment: Appointment = {
          id: rid('ap'), agencyId: prev.agency.id, caseId: entry.caseId, kind: 'consulat',
          at: slotAt, durationMin: 30,
          location: location ?? centreLabel(consulate?.centre) ?? consulate?.city ?? '',
          status: 'prevu',
        }
        let next: Database = {
          ...prev,
          appointments: [appointment, ...prev.appointments],
          queue: prev.queue.map((q) =>
            q.id === entryId
              ? { ...q, status: 'servi', servedAt: nowIso(), servedBy: currentUserId, appointmentId: appointment.id }
              : q,
          ),
          // La file servie fait avancer le dossier : c'etait l'etape bloquante.
          cases: prev.cases.map((c) =>
            c.id === entry.caseId && c.stage === 'rendez_vous' ? { ...c, stage: 'depot', updatedAt: nowIso() } : c,
          ),
        }
        next = log(next, 'creneau_obtenu', {
          fr: `Créneau obtenu pour ${target?.reference ?? ''}.`,
          en: `Slot secured for ${target?.reference ?? ''}.`,
          ar: `تم الحصول على موعد لـ ${target?.reference ?? ''}.`,
          zh: `已为 ${target?.reference ?? ''} 取得名额。`,
        }, entry.caseId)
        return next
      })

    const logAttempt: Actions['logAttempt'] = ({ consulateId, centre, result, caseId, slotAt, note }) =>
      setDb((prev) => {
        const attempt: SlotAttempt = {
          id: rid('at'), agencyId: prev.agency.id, consulateId, caseId,
          at: nowIso(), byId: currentUserId, centre, result, slotAt, note,
        }
        // On garde un an de tentatives : au dela, la statistique ne sert plus
        // et le stockage local sature.
        const cutoff = Date.now() - 365 * 86400000
        return {
          ...prev,
          attempts: [attempt, ...prev.attempts.filter((a) => new Date(a.at).getTime() > cutoff)],
        }
      })

    const saveConsulate: Actions['saveConsulate'] = (consulate) =>
      setDb((prev) => {
        if (consulate.id) {
          return { ...prev, consulates: prev.consulates.map((c) => (c.id === consulate.id ? { ...c, ...consulate, id: c.id } : c)) }
        }
        const created: Consulate = { ...consulate, id: rid('cs'), agencyId: prev.agency.id }
        return { ...prev, consulates: [...prev.consulates, created] }
      })

    const removeConsulate: Actions['removeConsulate'] = (consulateId) =>
      setDb((prev) => {
        // On ne supprime jamais un poste encore attache a un dossier : on le
        // desactive, sinon l'historique de refus perd sa reference.
        const used = prev.cases.some((c) => c.consulateId === consulateId)
        if (used) return { ...prev, consulates: prev.consulates.map((c) => (c.id === consulateId ? { ...c, active: false } : c)) }
        return { ...prev, consulates: prev.consulates.filter((c) => c.id !== consulateId) }
      })

    const saveTariff: Actions['saveTariff'] = (tariff) =>
      setDb((prev) => {
        if (tariff.id) {
          return { ...prev, tariffs: prev.tariffs.map((t) => (t.id === tariff.id ? { ...t, ...tariff, id: t.id } : t)) }
        }
        const created: DemurrageTariff = { ...tariff, id: rid('tar'), agencyId: prev.agency.id }
        return { ...prev, tariffs: [...prev.tariffs, created] }
      })

    const closeTariff: Actions['closeTariff'] = (tariffId) =>
      setDb((prev) => ({
        ...prev,
        // Fin de validité à aujourd'hui, jamais une suppression : les
        // dépassements déjà courus ont été chiffrés avec ce barème.
        tariffs: prev.tariffs.map((t) => (t.id === tariffId ? { ...t, validTo: nowIso().slice(0, 10) } : t)),
      }))

    const recordDecision: Actions['recordDecision'] = (caseId, status, input) =>
      setDb((prev) => {
        const target = prev.cases.find((c) => c.id === caseId)
        if (!target) return prev
        const consulate = prev.consulates.find((c) => c.id === target.consulateId)
        const decisionAt = nowIso()
        let appealDueAt: string | undefined
        if (status === 'refuse' && consulate?.appealDays) {
          const t = new Date(decisionAt)
          t.setDate(t.getDate() + consulate.appealDays)
          appealDueAt = t.toISOString()
        }
        let next: Database = {
          ...prev,
          cases: prev.cases.map((c) =>
            c.id === caseId
              ? {
                  ...c, status, stage: status === 'accepte' ? 'retrait' : 'clos', decisionAt,
                  refusalCode: status === 'refuse' ? (input?.code ?? 'autre') : undefined,
                  refusalReason: status === 'refuse' ? input?.reason : undefined,
                  appealDueAt, updatedAt: decisionAt,
                }
              : c,
          ),
          // Une decision sort le dossier de toute file encore ouverte.
          queue: prev.queue.map((q) =>
            q.caseId === caseId && q.status === 'attente' ? { ...q, status: 'abandonne', leftAt: decisionAt } : q,
          ),
        }
        next = log(next, 'decision_recue', {
          fr: `${target.reference} : ${status}.`,
          en: `${target.reference}: ${status}.`,
          ar: `${target.reference}: ${status}.`,
          zh: `${target.reference}：${status}。`,
        }, caseId)
        return next
      })

    const attachFile: Actions['attachFile'] = (docId, file, byClient) =>
      setDb((prev) => {
        const doc = prev.documents.find((d) => d.id === docId)
        if (!doc) return prev
        let next: Database = {
          ...prev,
          documents: prev.documents.map((d) =>
            d.id === docId
              ? {
                  ...d,
                  fileKey: file.key, fileName: file.name, fileSize: file.size, fileType: file.type,
                  uploadedAt: nowIso(), uploadedBy: byClient ? undefined : currentUserId,
                  // Déposer, c'est remettre. Une pièce refusée qu'on redépose
                  // repart de « reçue », pas de « refusée ».
                  state: 'recue', receivedAt: nowIso(), rejectionReason: undefined,
                }
              : d,
          ),
        }
        next = log(next, 'piece_recue', {
          fr: `${doc.label.fr} déposée.`,
          en: `${doc.label.en ?? doc.label.fr} uploaded.`,
          ar: `${doc.label.ar ?? doc.label.fr} تم إيداعها.`,
          zh: `${doc.label.zh ?? doc.label.fr} 已上传。`,
        }, doc.caseId, byClient)
        return next
      })

    const detachFile: Actions['detachFile'] = (docId) =>
      setDb((prev) => ({
        ...prev,
        documents: prev.documents.map((d) =>
          d.id === docId
            ? { ...d, fileKey: undefined, fileName: undefined, fileSize: undefined, fileType: undefined, uploadedAt: undefined, uploadedBy: undefined, state: 'demandee' }
            : d,
        ),
      }))

    const attachShipmentFile: Actions['attachShipmentFile'] = (docId, file) =>
      setDb((prev) => ({
        ...prev,
        shipmentDocs: prev.shipmentDocs.map((d) =>
          d.id === docId
            ? { ...d, fileKey: file.key, fileName: file.name, fileSize: file.size, fileType: file.type, state: 'recue', receivedAt: nowIso() }
            : d,
        ),
      }))

    const receivePassport: Actions['receivePassport'] = ({ caseId, clientId, passportNumber, location }) =>
      setDb((prev) => {
        const entry: PassportCustody = {
          id: rid('pc'), agencyId: prev.agency.id, caseId, clientId, passportNumber,
          receivedAt: nowIso(), receivedBy: currentUserId, location: location ?? 'coffre',
        }
        let next: Database = { ...prev, custody: [entry, ...prev.custody] }
        next = log(next, 'note_ajoutee', {
          fr: `Passeport ${passportNumber} reçu en caution.`,
          en: `Passport ${passportNumber} received in custody.`,
          ar: `تم استلام جواز السفر ${passportNumber} كضمان.`,
          zh: `护照 ${passportNumber} 已作为押金收存。`,
        }, caseId)
        return next
      })

    const releasePassport: Actions['releasePassport'] = (custodyId, force = false) => {
      const cu = db.custody.find((c) => c.id === custodyId)
      if (!cu) return false
      // Le garde-fou du comptoir : le passeport ne sort pas si le solde n'est
      // pas réglé. C'est le geste qui, tous les mois, sauve l'argent.
      const due = db.payments
        .filter((p) => p.caseId === cu.caseId && p.state !== 'regle')
        .reduce((sum, p) => sum + p.amount, 0)
      if (due > 0 && !force) return false
      setDb((prev) => {
        let next: Database = {
          ...prev,
          custody: prev.custody.map((c) => (c.id === custodyId ? { ...c, returnedAt: nowIso(), returnedBy: currentUserId } : c)),
        }
        next = log(next, 'note_ajoutee', {
          fr: due > 0 ? `Passeport rendu malgré un solde de ${due}.` : 'Passeport rendu, solde réglé.',
          en: 'Passport returned.', ar: 'أُعيد جواز السفر.', zh: '护照已归还。',
        }, cu.caseId)
        return next
      })
      return true
    }

    const reset: Actions['reset'] = () => setDb(buildSeed(slug))

    const exportJson: Actions['exportJson'] = () => JSON.stringify(db, null, 2)

    return {
      setStage, advance, setDocState, requestMissingDocs, remindDoc, sendMessage, addNote,
      markPaymentPaid, addAppointment, toggleRule, runRules, toggleTask, createCase,
      createClient, decideCase, updateCase, createTask, submitRequest, convertRequest,
      refuseRequest, markSetup, hideSetup, updateClient, clearAll, stepBackShipment, updateAppointment, saveShipment, advanceShipment, setShipmentDocState, saveUser, removeUser,
      saveTemplate, removeTemplate, saveVisaType, removeVisaType, saveChecklistItem,
      removeChecklistItem, saveRule, removeRule, updateAgency, reset, exportJson,
      attachFile, detachFile, attachShipmentFile,
      joinQueue, leaveQueue, setQueuePriority, serveQueue, logAttempt, saveConsulate,
      removeConsulate, saveTariff, closeTariff, recordDecision, receivePassport, releasePassport,
    }
    // db n'entre pas dans les dependances : toutes les mutations passent par
    // setDb(prev => ...) et lisent donc toujours l'etat le plus recent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, log, slug, db])

  // En mode réel, chaque action garde son effet local optimiste (l'écran
  // répond tout de suite) puis se reflète vers Supabase en tâche de fond. Un
  // seul proxy, pas quarante-cinq réécritures. Une écriture qui échoue
  // recharge l'instantané, ce qui remet l'écran d'accord avec la vérité.
  const wrapped = useMemo<Actions>(() => {
    // Vue support : aucune action n'écrit. On rend chaque action inerte plutôt
    // que de laisser une écriture mentir localement puis être refusée par la
    // base (aucune politique d'écriture n'existe pour la plateforme).
    if (readOnly) return new Proxy({} as Actions, { get: () => () => undefined as unknown })
    if (!remote) return actions
    const dbRef = { get db() { return db } }
    return new Proxy(actions, {
      get(target, prop: string) {
        const fn = (target as any)[prop]
        if (typeof fn !== 'function') return fn
        return (...args: any[]) => {
          const result = fn(...args) // optimiste, synchrone : la valeur de retour est préservée
          const agencyId = remoteAgencyId
          if (agencyId) {
            void mirror(prop, args, { db: dbRef.db, agencyId, reload: () => reloadRef.current() })
              .then((ok) => { if (!ok) { console.warn('[mirror] non persistée :', prop); setSyncError('non_persiste') } })
              .catch((e) => { console.error('[mirror]', prop, e); setSyncError('ecriture'); reloadRef.current() })
          }
          return result
        }
      },
    })
  }, [remote, readOnly, actions, remoteAgencyId, db])

  // Les regles tournent toutes les minutes tant que le temps reel est actif.
  // C'est exactement ce que fera la tache planifiee cote serveur.
  useEffect(() => {
    // En mode réel, les automatisations tournent côté serveur (tâche planifiée).
    // Les faire tourner ici, dans chaque onglet ouvert, doublerait les relances.
    if (!live || remote) return
    const id = window.setInterval(() => actions.runRules(), 60_000)
    return () => window.clearInterval(id)
  }, [live, actions, remote])

  const value = useMemo<StoreValue>(
    () => ({
      db, slug, currentUserId,
      // En mode réel, être connecté à Supabase suffit ; en démo, avoir choisi
      // un compte sur l'écran de connexion.
      signedIn: remote ? Boolean(auth.session) : Boolean(session),
      support: support ? { agencyId: supportAgency as string, agencyName: db.agency.name } : null,
      readOnly,
      enterSupport,
      exitSupport,
      signIn, signOut, actions: wrapped, live, setLive,
      syncError,
      retry: () => { setSyncError(null); if (remote) { setReady(false); reloadRef.current() } },
    }),
    [db, slug, currentUserId, session, signIn, signOut, wrapped, live, remote, auth.session, syncError, support, supportAgency, readOnly],
  )

  // Le temps que l'agence se charge depuis la base, on n'affiche pas un jeu de
  // démonstration qui clignoterait avant d'être remplacé.
  if (remote && !ready) {
    return <AppSkeleton />
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore doit être utilisé dans un StoreProvider')
  return ctx
}
