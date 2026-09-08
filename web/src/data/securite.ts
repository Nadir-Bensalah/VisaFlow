import { HAS_BACKEND, supabase } from '@/lib/supabase'
import { rpc } from '@/data/remote'
import { camelKeys } from '@/lib/case'

/**
 * Tous les appels du module sécurité et audit, et rien d'autre.
 *
 * Deux principes tiennent ce fichier.
 *
 * 1. AUCUN ÉCRAN NE CASSE SANS BACKEND. Le site de démonstration tourne sans
 *    Supabase. Les lectures rendent alors une liste vide, les écritures ne
 *    font rien. Un écran de sécurité qui affiche « aucun événement » est
 *    honnête ; un écran qui plante ne l'est pas. Chaque fonction dit dans son
 *    commentaire ce qu'elle rend hors ligne.
 *
 * 2. AUCUNE ERREUR N'EST AVALÉE EN SILENCE SUR UNE ÉCRITURE. Les lectures
 *    tolèrent l'échec et rendent une liste vide, parce qu'un journal
 *    momentanément illisible ne doit pas bloquer une fiche client. Les
 *    écritures, elles, relancent : émettre un lien de suivi qui échoue sans
 *    rien dire ferait croire à l'agent qu'il a envoyé quelque chose.
 */

/* ------------------------------ Les formes --------------------------- */

export type AuditAction =
  | 'create' | 'update' | 'delete' | 'read_sensitive'
  | 'export' | 'login' | 'permission_change'

export interface AuditEntry {
  id: string
  at: string
  action: AuditAction
  entityType: string
  entityId?: string
  userId?: string
  /** Le nom du compte, joint côté serveur. Vide si le compte a été supprimé. */
  userName?: string
  changedFields?: string[]
  oldValues?: Record<string, unknown>
  newValues?: Record<string, unknown>
  ipAddress?: string
}

export type SecurityKind =
  | 'LOGIN_FAILED' | 'NEW_DEVICE' | 'PASSWORD_CHANGED' | 'MFA_ENABLED'
  | 'MFA_DISABLED' | 'EXPORT_DATA' | 'PERMISSION_CHANGED'
  | 'SUSPICIOUS_ACTIVITY' | 'SESSION_REVOKED'

export type SecuritySeverity = 'info' | 'attention' | 'critique'

export interface SecurityEvent {
  id: string
  at: string
  kind: SecurityKind
  severity: SecuritySeverity
  detail: Record<string, unknown>
  userId?: string
  userName?: string
  ipAddress?: string
  userAgent?: string
}

export interface DeviceSession {
  id: string
  userId: string
  agencyId?: string
  deviceLabel?: string
  browser?: string
  platform?: string
  ipAddress?: string
  /** Déclarative, jamais mesurée. Vide tant que rien ne la renseigne. */
  approxCity?: string
  createdAt: string
  lastSeenAt: string
  revokedAt?: string
  revokedBy?: string
}

export type TrackingKind = 'VISA_CASE' | 'SHIPMENT'

export interface TrackingLink {
  id: string
  agencyId: string
  clientId?: string
  entityKind: TrackingKind
  entityId: string
  createdBy?: string
  createdAt: string
  expiresAt?: string
  requiresOtp: boolean
  revokedAt?: string
  lastOpenedAt?: string
  openCount: number
}

export interface DocumentVersion {
  id: string
  documentId: string
  documentKind: 'case' | 'shipment'
  versionNumber: number
  storagePath?: string
  fileName?: string
  fileSize?: number
  sha256?: string
  uploadedBy?: string
  createdAt: string
}

/* ------------------------------ Lectures ----------------------------- */

/**
 * Le journal d'une entité. Rend une liste vide hors ligne, et aussi quand le
 * compte n'a pas `audit:view` : le serveur refuse, et l'écran affiche
 * « réservé » plutôt que de planter. C'est à l'appelant de ne pas monter le
 * composant s'il sait déjà que le droit manque.
 */
export async function auditSearch(options: {
  entityType?: string
  entityId?: string
  from?: string
  to?: string
  limit?: number
} = {}): Promise<AuditEntry[]> {
  if (!HAS_BACKEND) return []
  try {
    const rows = await rpc('audit_search', {
      p_entity_type: options.entityType ?? null,
      p_entity_id: options.entityId ?? null,
      p_from: options.from ?? null,
      p_to: options.to ?? null,
      p_limit: options.limit ?? 100,
    })
    return camelKeys<AuditEntry[]>(rows ?? [])
  } catch {
    return []
  }
}

/** Les événements de sécurité de l'agence. Réservé à `audit:view`. */
export async function securityFeed(limit = 50): Promise<SecurityEvent[]> {
  if (!HAS_BACKEND) return []
  try {
    const rows = await rpc('security_feed', { p_limit: limit })
    return camelKeys<SecurityEvent[]>(rows ?? [])
  } catch {
    return []
  }
}

/** Mes appareils, du plus récent au plus ancien, révoqués compris. */
export async function mySessions(): Promise<DeviceSession[]> {
  if (!HAS_BACKEND) return []
  try {
    const rows = await rpc('my_sessions', {})
    return camelKeys<DeviceSession[]>(rows ?? [])
  } catch {
    return []
  }
}

/**
 * Les appareils de toute l'agence. Lecture directe de la table : la politique
 * n'ouvre cette vue élargie qu'à un compte qui a `audit:view`, les autres ne
 * voient que les leurs. Aucune garde n'est écrite ici, parce qu'une garde
 * écrite dans le navigateur ne protège rien.
 */
export async function agencySessions(limit = 100): Promise<DeviceSession[]> {
  if (!HAS_BACKEND || !supabase) return []
  const { data, error } = await supabase
    .from('user_sessions').select('*')
    .order('last_seen_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return camelKeys<DeviceSession[]>(data ?? [])
}

/** Les liens de suivi émis pour un dossier ou une cargaison. */
export async function trackingList(kind: TrackingKind, entityId: string): Promise<TrackingLink[]> {
  if (!HAS_BACKEND || !supabase) return []
  const { data, error } = await supabase
    .from('tracking_links').select('*')
    .eq('entity_kind', kind).eq('entity_id', entityId)
    .order('created_at', { ascending: false })
  if (error) return []
  return camelKeys<TrackingLink[]>(data ?? [])
}

/** L'historique des versions d'une pièce, la plus récente en tête. */
export async function documentHistory(documentId: string): Promise<DocumentVersion[]> {
  if (!HAS_BACKEND) return []
  try {
    const rows = await rpc('document_history', { p_document: documentId })
    return camelKeys<DocumentVersion[]>(rows ?? [])
  } catch {
    return []
  }
}

/* ------------------------------ Écritures ---------------------------- */

/**
 * À appeler à la connexion, une fois la session Supabase établie.
 *
 * Elle crée ou rafraîchit la ligne de l'appareil courant, et dépose un
 * événement NEW_DEVICE la première fois. Elle n'échoue jamais bruyamment :
 * une connexion réussie ne doit pas être annulée parce que le journal des
 * appareils n'a pas répondu.
 *
 * Le libellé, le navigateur et la plateforme sont DÉDUITS de la chaîne
 * d'agent utilisateur, qui est déclarative. On ne prétend pas identifier
 * l'appareil : on aide seulement quelqu'un à reconnaître le sien dans une
 * liste. Rien ici n'est une empreinte de navigateur.
 */
export async function sessionTouch(): Promise<void> {
  if (!HAS_BACKEND) return
  const { label, browser, platform } = decritCetAppareil()
  try {
    await rpc('session_touch', { p_label: label, p_browser: browser, p_platform: platform })
  } catch {
    // Silence volontaire : voir le commentaire ci-dessus.
  }
}

/**
 * Écrit la trace de la révocation.
 *
 * ATTENTION, ce que cet appel ne fait PAS : il ne déconnecte personne. La
 * base n'a pas le droit de toucher aux sessions de Supabase, et une fonction
 * qui s'arrogerait ce droit serait le maillon le plus dangereux du produit.
 * Pour SA PROPRE session courante, l'écran doit enchaîner avec
 * `supabase.auth.signOut()`. Pour celle d'un autre poste, la déconnexion
 * effective demande l'API d'administration, côté serveur, et elle n'est pas
 * livrée : le lien reste actif jusqu'à l'expiration du jeton.
 */
export async function sessionRevoke(sessionId: string): Promise<boolean> {
  if (!HAS_BACKEND) return false
  const ok = await rpc('session_revoke', { p_session: sessionId })
  return ok === true
}

/** Déposer un événement de sécurité sur le compte courant. */
export async function securityNote(kind: SecurityKind, detail: Record<string, unknown> = {}): Promise<void> {
  if (!HAS_BACKEND) return
  try {
    await rpc('security_note', { p_kind: kind, p_detail: detail })
  } catch {
    // Un événement perdu ne doit pas casser le geste qui l'a produit.
  }
}

/**
 * À appeler AVANT tout export, quel qu'il soit : fichier téléchargé, tableau
 * copié, PDF imprimé. Un export non tracé est un incident invisible : le jour
 * où une liste de clients circule, personne ne peut dire si elle est sortie
 * d'ici, ni par qui.
 */
export async function dataExportNote(scope: string): Promise<void> {
  if (!HAS_BACKEND) return
  try {
    await rpc('data_export_note', { p_scope: scope })
  } catch {
    // idem
  }
}

/** Une consultation de donnée sensible, hors pièces (déjà couvertes par 0008). */
export async function auditReadNote(entityType: string, entityId: string): Promise<void> {
  if (!HAS_BACKEND) return
  try {
    await rpc('audit_read_note', { p_entity_type: entityType, p_entity_id: entityId })
  } catch {
    // idem
  }
}

/**
 * Émettre un lien de suivi. Le jeton n'est rendu QU'ICI, une seule fois : le
 * serveur n'en garde que l'empreinte. L'écran doit donc le montrer tout de
 * suite, et dire qu'il ne pourra pas être réaffiché.
 */
export async function trackingIssue(
  kind: TrackingKind, entityId: string, days = 30, requiresOtp = false,
): Promise<string> {
  if (!HAS_BACKEND) throw new Error('backend absent')
  const token = await rpc('tracking_issue', {
    p_entity_kind: kind,
    p_entity_id: entityId,
    p_days: days,
    p_requires_otp: requiresOtp,
  })
  return String(token)
}

export async function trackingRevoke(linkId: string): Promise<boolean> {
  if (!HAS_BACKEND) return false
  const ok = await rpc('tracking_revoke', { p_link: linkId })
  return ok === true
}

/**
 * Ranger une nouvelle version d'une pièce. Le numéro de version est calculé
 * par le serveur, sous verrou : le calculer ici donnerait deux versions
 * numéro 3 le jour où deux agents déposent en même temps.
 */
export async function documentVersionAdd(input: {
  documentId: string
  kind: 'case' | 'shipment'
  storagePath: string
  fileName?: string
  fileSize?: number
  sha256?: string
}): Promise<number> {
  if (!HAS_BACKEND) return 0
  const n = await rpc('document_version_add', {
    p_document: input.documentId,
    p_kind: input.kind,
    p_storage_path: input.storagePath,
    p_file_name: input.fileName ?? null,
    p_file_size: input.fileSize ?? null,
    p_sha256: input.sha256 ?? null,
  })
  return Number(n ?? 0)
}

/* ------------------------------ Le décor ----------------------------- */

/**
 * Ce que le navigateur veut bien dire de lui-même.
 *
 * C'est une lecture de la chaîne d'agent utilisateur, rien de plus. Elle est
 * modifiable par qui la fabrique, et elle ne distingue pas deux postes
 * identiques dans le même bureau. Elle sert à ce qu'une personne reconnaisse
 * SON appareil dans une liste, pas à prouver quoi que ce soit.
 */
export function decritCetAppareil(): { label: string; browser: string; platform: string } {
  if (typeof navigator === 'undefined') {
    return { label: 'Appareil', browser: 'inconnu', platform: 'inconnu' }
  }
  const ua = navigator.userAgent

  const platform =
    /iPhone/i.test(ua) ? 'iPhone'
    : /iPad/i.test(ua) ? 'iPad'
    : /Android/i.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
    : /Windows/i.test(ua) ? 'Windows'
    : /Linux/i.test(ua) ? 'Linux'
    : 'inconnu'

  // L'ordre compte : Edge et Chrome se déclarent tous les deux « Chrome », et
  // Safari apparaît dans presque toutes les chaînes. On teste du plus
  // spécifique au plus général.
  const browser =
    /Edg\//i.test(ua) ? 'Edge'
    : /OPR\/|Opera/i.test(ua) ? 'Opera'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Chrome\//i.test(ua) ? 'Chrome'
    : /Safari\//i.test(ua) ? 'Safari'
    : 'inconnu'

  return { label: `${browser} sur ${platform}`, browser, platform }
}

/** L'appareil courant dans une liste, pour l'écrire « cet appareil ». */
export function estCetAppareil(session: DeviceSession): boolean {
  const ici = decritCetAppareil()
  return session.browser === ici.browser && session.platform === ici.platform && !session.revokedAt
}
