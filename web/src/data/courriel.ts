import { supabase, HAS_BACKEND } from '@/lib/supabase'

/* Le courriel, vu du navigateur.
 *
 * Une seule porte : rien d'autre dans l'application ne connaît le nom de la
 * fonction de bord ni celui des fonctions SQL.
 *
 * LA RÈGLE À NE PAS PERDRE DE VUE EN LISANT CE FICHIER : on ne prétend jamais
 * qu'un message est parti s'il n'est pas parti. Concrètement, ici :
 *
 *   · `emailReady()` rend FAUX par défaut. Tant que la fonction de bord n'a pas
 *     constaté une clé de fournisseur, l'écran grise son bouton. Proposer une
 *     action qui échouera est pire que de la montrer indisponible.
 *   · `sendEmail()` distingue trois issues, et l'appelant doit les distinguer
 *     aussi : parti, refusé par le fournisseur, ou pas configuré du tout. Le
 *     dernier cas n'est pas une panne : le produit marche sans courriel, comme
 *     aujourd'hui, il le dit simplement.
 *   · en mode démonstration (sans backend), rien ne part et `emailReady()` rend
 *     faux. Aucune fonction ne jette pour autant.
 */

export const EMAIL_KINDS = [
  'invitation', 'mot_de_passe', 'facture', 'devis', 'rappel',
  'decision', 'document_demande', 'systeme',
] as const
export type EmailKind = (typeof EMAIL_KINDS)[number]

export type EmailStatus = 'prepare' | 'envoye' | 'echoue' | 'non_configure'

export interface EmailLogRow {
  id: string
  agencyId: string | null
  kind: EmailKind
  toAddress: string
  subject: string
  provider: string | null
  providerId: string | null
  status: EmailStatus
  error: string | null
  sentBy: string | null
  createdAt: string
  sentAt: string | null
}

export interface SendEmailInput {
  kind: EmailKind
  to: string
  subject: string
  html?: string
  text?: string
  replyTo?: string
  /** L'agence au nom de laquelle on écrit. Omise, c'est celle du compte. */
  agencyId?: string
  /** Des étiquettes pour retrouver l'envoi chez le fournisseur. */
  tags?: Record<string, string>
}

export type SendEmailResult =
  | { ok: true; providerId: string | null; logId: string | null }
  /** Aucune clé de fournisseur : RIEN n'est parti, et une trace le dit. */
  | { ok: false; configured: false; reason: string; logId: string | null }
  /** Le fournisseur a refusé, ou le droit a manqué. */
  | { ok: false; configured: true; reason: string; logId: string | null }

const url = () => import.meta.env.VITE_SUPABASE_URL as string
const anon = () => import.meta.env.VITE_SUPABASE_ANON_KEY as string

async function jeton(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

/* ------------------------------------------------------------------ */
/* L'état du transport                                                 */
/* ------------------------------------------------------------------ */

/** Vrai seulement si la fonction de bord a constaté une clé de fournisseur.
    À interroger avant d'afficher un bouton « Envoyer par courriel ». */
export async function emailReady(): Promise<boolean> {
  if (!HAS_BACKEND || !supabase) return false
  const { data, error } = await supabase.rpc('email_ready')
  if (error) return false
  return data === true
}

export interface EmailState {
  ready: boolean
  provider: string | null
  from: string | null
  /** La raison, quand ce n'est pas prêt. C'est ce qu'on montre à la plateforme. */
  reason: string | null
}

/** Aller demander à la fonction de bord, qui est la seule à savoir, et
    rafraîchir l'état que `emailReady()` lit. Rien n'est envoyé.
    Sans ce sondage, l'état ne se mettrait à jour qu'au premier envoi, c'est à
    dire au premier échec. */
export async function emailProbe(): Promise<EmailState> {
  if (!HAS_BACKEND || !supabase) {
    return { ready: false, provider: null, from: null, reason: 'mode démonstration' }
  }
  const token = await jeton()
  if (!token) return { ready: false, provider: null, from: null, reason: 'session' }

  const res = await fetch(`${url()}/functions/v1/send-email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: anon(), authorization: `Bearer ${token}` },
    body: JSON.stringify({ probe: true }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    ready?: boolean; provider?: string; from?: string; reason?: string; error?: string
  }
  return {
    ready: body.ready === true,
    provider: body.provider ?? null,
    from: body.from ?? null,
    reason: body.reason ?? body.error ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* L'envoi                                                             */
/* ------------------------------------------------------------------ */

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!HAS_BACKEND || !supabase) {
    return { ok: false, configured: false, reason: 'mode démonstration : rien n\'est envoyé', logId: null }
  }
  const token = await jeton()
  if (!token) return { ok: false, configured: true, reason: 'session expirée', logId: null }

  const res = await fetch(`${url()}/functions/v1/send-email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: anon(), authorization: `Bearer ${token}` },
    body: JSON.stringify({
      kind: input.kind,
      to: input.to,
      subject: input.subject,
      html: input.html ?? null,
      text: input.text ?? null,
      reply_to: input.replyTo ?? null,
      agency_id: input.agencyId ?? null,
      tags: input.tags ?? {},
    }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean; provider_id?: string; log_id?: string
    error?: string; reason?: string; configured?: boolean
  }

  if (res.ok && body.ok) {
    return { ok: true, providerId: body.provider_id ?? null, logId: body.log_id ?? null }
  }
  // 503 : la fonction de bord n'a pas de clé. Ce n'est pas une panne, c'est un
  // réglage manquant, et l'écran doit le dire autrement qu'une erreur rouge.
  if (res.status === 503 || body.configured === false) {
    return {
      ok: false, configured: false,
      reason: body.reason ?? body.error ?? 'l\'envoi de courriels n\'est pas configuré',
      logId: body.log_id ?? null,
    }
  }
  return {
    ok: false, configured: true,
    reason: body.reason ?? body.error ?? `HTTP ${res.status}`,
    logId: body.log_id ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Le journal                                                          */
/* ------------------------------------------------------------------ */

/** Les dernières traces. La sécurité au niveau des lignes fait le tri : une
    agence voit les siennes, la plateforme voit tout, un lecteur ne voit rien. */
export async function emailLog(limit = 50): Promise<EmailLogRow[]> {
  if (!HAS_BACKEND || !supabase) return []
  const { data, error } = await supabase
    .from('email_log')
    .select('id, agency_id, kind, to_address, subject, provider, provider_id, status, error, sent_by, created_at, sent_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    agencyId: (r.agency_id as string | null) ?? null,
    kind: r.kind as EmailKind,
    toAddress: String(r.to_address),
    subject: String(r.subject),
    provider: (r.provider as string | null) ?? null,
    providerId: (r.provider_id as string | null) ?? null,
    status: r.status as EmailStatus,
    error: (r.error as string | null) ?? null,
    sentBy: (r.sent_by as string | null) ?? null,
    createdAt: String(r.created_at),
    sentAt: (r.sent_at as string | null) ?? null,
  }))
}
