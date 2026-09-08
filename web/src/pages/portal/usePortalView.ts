import { useEffect, useState } from 'react'
import { useStore } from '@/data/store'
import { HAS_BACKEND } from '@/lib/supabase'
import { rpc } from '@/data/remote'
import { camelKeys } from '@/lib/case'
import { progress, realWaitDays } from '@/lib/derive'
import type { DocState, I18nText, Locale, PaymentState, Stage } from '@/data/types'

/**
 * Le suivi client, d'où qu'il vienne.
 *
 * La page de suivi lisait le magasin LOCAL du navigateur. Sur le site de
 * démonstration c'est voulu : il n'y a pas de backend et les données sont
 * fictives. Mais chez une agence branchée sur sa base, le client qui ouvre son
 * lien cherchait son dossier dans un jeu fictif, et ne trouvait rien. Les
 * applications mobiles, elles, appelaient bien `portal_case` : le trou ne
 * concernait que le web, c'est-à-dire la voie que prend la majorité des clients.
 *
 * On sert donc UNE seule forme de données, remplie par la fonction serveur
 * quand un backend existe, et par la démonstration sinon. La page ne sait pas
 * d'où ça vient, et il n'y a qu'un seul rendu à maintenir.
 */

export type PortalView = {
  case: {
    reference: string
    stage: Stage
    status: string
    travelDate?: string
    decisionAt?: string
    refusalReason?: string
    balance: number
    currency: string
  }
  agency: { name: string; mark?: string; accent?: string; inpdpRef?: string }
  visa: { country: I18nText; label: I18nText; processingDays: number; stages: Stage[] }
  client: { firstName: string; locale: Locale }
  office: { name: string; address?: string; phone?: string } | null
  queue: { rank: number; total: number; country: I18nText; city: string; waitDays: number } | null
  stays: { entry: string; exit?: string; country?: string }[]
  documents: {
    key: string; label: I18nText; help?: I18nText; state: DocState
    required: boolean; receivedAt?: string; rejectionReason?: string
    /** Seulement en démonstration : le fichier vit dans le navigateur. */
    id?: string
    file?: { key?: string; name?: string; size?: number; type?: string }
  }[]
  payments: { label: I18nText; amount: number; state: PaymentState }[]
  appointment: { kind: string; at: string; location: string } | null
  messages: { direction: 'entrant' | 'sortant'; body: string; at: string }[]
  /** Avancement des pièces, en pourcentage. */
  docsPct: number
}

type PortalState =
  | { status: 'chargement' }
  | { status: 'absent' }
  | { status: 'erreur'; message: string }
  | { status: 'ok'; view: PortalView; caseId?: string }

/** L'état, plus de quoi relire : sans ça une pièce déposée resterait « manquante ». */
export type PortalResult = PortalState & { reload: () => void }

export function usePortalView(token: string): PortalResult {
  const { db } = useStore()
  const [remote, setRemote] = useState<PortalState>({ status: 'chargement' })
  const [tick, setTick] = useState(0)
  const reload = () => setTick((n) => n + 1)

  useEffect(() => {
    if (!HAS_BACKEND) return
    let alive = true
    setRemote({ status: 'chargement' })
    rpc('portal_case', { p_token: token })
      .then((data) => {
        if (!alive) return
        if (!data) { setRemote({ status: 'absent' }); return }
        const v = camelKeys<Omit<PortalView, 'docsPct'>>(data)
        const req = v.documents.filter((d) => d.required)
        const done = req.filter((d) => d.state === 'validee' || d.state === 'recue')
        setRemote({
          status: 'ok',
          view: { ...v, docsPct: req.length ? Math.round((done.length / req.length) * 100) : 100 },
        })
      })
      .catch((e) => {
        if (!alive) return
        // Un lien de suivi qui échoue doit dire pourquoi. Le client n'a pas de
        // support technique : s'il voit une page vide, il appelle l'agence.
        setRemote({ status: 'erreur', message: e instanceof Error ? e.message : String(e) })
      })
    return () => { alive = false }
  }, [token, tick])

  if (HAS_BACKEND) return { ...remote, reload }

  // La démonstration : on fabrique exactement la même forme depuis le magasin
  // local, pour qu'il n'y ait qu'un seul rendu à tenir.
  const kase = db.cases.find((c) => c.portalToken === token)
  if (!kase) return { status: 'absent', reload }
  const client = db.clients.find((c) => c.id === kase.clientId)
  const visa = db.visaTypes.find((v) => v.id === kase.visaTypeId)
  if (!client || !visa) return { status: 'absent', reload }

  const docs = db.documents.filter((d) => d.caseId === kase.id)
  const entry = db.queue.find((q) => q.caseId === kase.id && q.status === 'attente')
  const consulate = entry ? db.consulates.find((c) => c.id === entry.consulateId) : undefined
  const line = entry
    ? db.queue.filter((q) => q.consulateId === entry.consulateId && q.status === 'attente')
        .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
    : []

  return {
    status: 'ok',
    reload,
    caseId: kase.id,
    view: {
      case: {
        reference: kase.reference, stage: kase.stage, status: kase.status,
        travelDate: kase.travelDate, decisionAt: kase.decisionAt,
        refusalReason: kase.refusalReason,
        balance: db.payments.filter((p) => p.caseId === kase.id && p.state !== 'regle')
          .reduce((s, p) => s + p.amount, 0),
        currency: db.agency.currency,
      },
      agency: { name: db.agency.name, mark: db.agency.mark, accent: db.agency.accent },
      visa: {
        country: visa.country, label: visa.label,
        processingDays: visa.processingDays, stages: visa.stages,
      },
      client: { firstName: client.firstName, locale: client.locale },
      office: (() => {
        const o = db.agency.offices.find((x) => x.id === kase.officeId)
        return o ? { name: o.name, address: o.address, phone: o.phone } : null
      })(),
      queue: entry && consulate
        ? {
            rank: line.findIndex((q) => q.id === entry.id) + 1,
            total: line.length,
            country: consulate.country,
            city: consulate.city,
            waitDays: realWaitDays(db, consulate.id) ?? 0,
          }
        : null,
      stays: db.stays.filter((s) => s.clientId === client.id)
        .map((s) => ({ entry: s.entryDate, exit: s.exitDate, country: s.country })),
      documents: docs.map((d) => ({
        key: d.key, id: d.id, label: d.label, state: d.state,
        required: d.required, receivedAt: d.receivedAt, rejectionReason: d.rejectionReason,
        file: d.fileKey ? { key: d.fileKey, name: d.fileName, size: d.fileSize, type: d.fileType } : undefined,
      })),
      payments: db.payments.filter((p) => p.caseId === kase.id)
        .map((p) => ({ label: p.label, amount: p.amount, state: p.state })),
      appointment: (() => {
        const a = db.appointments
          .filter((x) => x.caseId === kase.id && x.status === 'prevu')
          .sort((x, y) => x.at.localeCompare(y.at))[0]
        return a ? { kind: a.kind, at: a.at, location: a.location } : null
      })(),
      messages: db.messages
        .filter((m) => m.caseId === kase.id && m.channel !== 'interne')
        .slice(-10)
        .map((m) => ({ direction: m.direction, body: m.body, at: m.at })),
      docsPct: progress(db, kase.id).pct,
    },
  }
}

// ------------------------------------------------------------------
// Ce que le client peut ÉCRIRE depuis son lien de suivi
// ------------------------------------------------------------------
//
// Le client n'a pas de compte, seulement un jeton. Il ne touche donc jamais une
// table : sa question passe par `portal_send`, son fichier par la fonction de
// bord `portal-upload`, toutes deux gardées côté serveur.

/** Le client pose une question. Aucune écriture directe, jamais. */
export async function portalSendQuestion(token: string, body: string): Promise<void> {
  await rpc('portal_send', { p_token: token, p_body: body })
}

/**
 * Le client dépose une pièce, en général une photo prise avec son téléphone.
 * Le fichier part en octets bruts vers la fonction de bord, qui vérifie le
 * jeton, impose le chemin de rangement et marque la pièce reçue. Le navigateur
 * ne choisit ni le seau, ni le nom de rangement.
 */
export async function portalUploadDoc(token: string, docKey: string, file: File): Promise<void> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!url || !key) throw new Error('portail non configuré')
  const res = await fetch(`${url}/functions/v1/portal-upload`, {
    method: 'POST',
    headers: {
      'x-portal-token': token,
      'x-document-key': docKey,
      // Un en-tête HTTP ne transporte que de l'ASCII : un nom de fichier arabe
      // ou chinois casserait la requête si on ne l'encodait pas.
      'x-file-name': encodeURIComponent(file.name),
      'content-type': file.type || 'application/octet-stream',
      apikey: key,
      authorization: `Bearer ${key}`,
    },
    body: file,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error((detail as { error?: string }).error ?? `dépôt refusé (${res.status})`)
  }
}
