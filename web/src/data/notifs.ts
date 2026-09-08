import { supabase, HAS_BACKEND } from '@/lib/supabase'
import { camelKeys } from '@/lib/case'

/* Le module des notifications, des règles et des webhooks (migration 0051).
 *
 * Tout ce qui touche au serveur pour ce module passe par ici, et rien d'autre
 * ne connaît les noms des fonctions SQL.
 *
 * Le mode démonstration : sans backend, `supabase` vaut null. Aucune de ces
 * fonctions ne jette dans ce cas, elles rendent du vide. C'est ce qui permet à
 * la cloche de garder sa dérivation locale hors ligne : elle demande au
 * serveur, n'obtient rien, et retombe sur ce qu'elle sait faire seule.
 */

export const NOTIFS_ONLINE = HAS_BACKEND

/* ----------------------------- Vocabulaire ---------------------------- */

/** Les événements, dans le même ordre et avec les mêmes noms qu'en base.
    Toute divergence ici se voit à la première règle enregistrée : la
    contrainte de la colonne `event` refuse ce qu'elle ne connaît pas. */
export const NOTIF_EVENTS = [
  'client.cree', 'dossier.cree', 'dossier.etape', 'dossier.decision',
  'piece.manquante', 'piece.recue', 'piece.expiree',
  'rendez_vous.pris', 'rendez_vous.demain',
  'passeport.recu', 'passeport.disponible', 'passeport.remis',
  'paiement.recu', 'paiement.solde', 'facture.echue',
  'prospect.nouveau', 'prospect.relance',
  'cargaison.creee', 'cargaison.depart', 'cargaison.arrivee',
  'cargaison.douane', 'cargaison.mainlevee', 'cargaison.livraison',
  'surestaries.risque', 'quota.depasse',
] as const
export type NotifEvent = (typeof NOTIF_EVENTS)[number]

/** Les familles, pour grouper l'écran des règles. Une liste de vingt-cinq
    lignes à plat est illisible ; l'agence pense par sujet. */
export const NOTIF_GROUPS: { key: string; events: NotifEvent[] }[] = [
  { key: 'dossier', events: ['client.cree', 'dossier.cree', 'dossier.etape', 'dossier.decision'] },
  { key: 'pieces', events: ['piece.manquante', 'piece.recue', 'piece.expiree'] },
  { key: 'agenda', events: ['rendez_vous.pris', 'rendez_vous.demain'] },
  { key: 'passeport', events: ['passeport.recu', 'passeport.disponible', 'passeport.remis'] },
  { key: 'argent', events: ['paiement.recu', 'paiement.solde', 'facture.echue', 'quota.depasse'] },
  { key: 'prospects', events: ['prospect.nouveau', 'prospect.relance'] },
  {
    key: 'fret',
    events: [
      'cargaison.creee', 'cargaison.depart', 'cargaison.arrivee', 'cargaison.douane',
      'cargaison.mainlevee', 'cargaison.livraison', 'surestaries.risque',
    ],
  },
]

export const NOTIF_CHANNELS = ['in_app', 'email', 'whatsapp', 'sms', 'push'] as const
export type NotifChannel = (typeof NOTIF_CHANNELS)[number]

/** Les canaux réellement branchés. Les autres se règlent, mais rien ne part :
    le serveur les conserve sans les servir, et l'écran doit le dire plutôt que
    de laisser croire le client prévenu. */
export const LIVE_CHANNELS: NotifChannel[] = ['in_app', 'whatsapp']

export const NOTIF_RECIPIENTS = ['client', 'agent', 'manager', 'owner', 'bureau'] as const
export type NotifRecipient = (typeof NOTIF_RECIPIENTS)[number]

export const NOTIF_KINDS = [
  'decision', 'piece', 'rendez_vous', 'prospect', 'message',
  'paiement', 'cargaison', 'douane', 'livraison', 'systeme',
] as const
export type NotifKindServer = (typeof NOTIF_KINDS)[number]

export type NotifSeverity = 'info' | 'attention' | 'urgent'

/* -------------------------------- Types ------------------------------- */

export interface ServerNotification {
  id: string
  kind: NotifKindServer
  severity: NotifSeverity
  /** Un code d'événement, pas une phrase : l'agence travaille en quatre
      langues. L'écran résout `notif.e.<title>` et retombe sur le brut. */
  title: string
  body: string | null
  entityType: string | null
  entityId: string | null
  url: string | null
  readAt: string | null
  createdAt: string
}

export interface NotificationRule {
  id: string
  agencyId: string
  event: NotifEvent
  channel: NotifChannel
  recipient: NotifRecipient
  templateKey: string | null
  enabled: boolean
  delayMinutes: number
  createdAt: string
}

export interface Webhook {
  id: string
  agencyId: string
  event: string
  endpoint: string
  /** Le NOM du secret dans le coffre, jamais sa valeur. Cette valeur ne
      transite nulle part, et surtout pas par le navigateur. */
  secretName: string | null
  active: boolean
  createdAt: string
  lastSuccessAt: string | null
  lastError: string | null
  failureCount: number
}

export interface WebhookDelivery {
  id: string
  webhookId: string
  event: string
  status: 'en_attente' | 'envoye' | 'echoue'
  httpStatus: number | null
  responseExcerpt: string | null
  attempts: number
  nextAttemptAt: string
  createdAt: string
  deliveredAt: string | null
}

/* ------------------------------- La cloche ---------------------------- */

/** Ce que la cloche lit. Rend un tableau vide en démonstration : c'est le
    signal que l'appelant doit garder sa dérivation locale. */
export async function myNotifications(limit = 40, onlyUnread = false): Promise<ServerNotification[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('my_notifications', {
    p_limit: limit,
    p_only_unread: onlyUnread,
  })
  if (error) throw new Error(error.message)
  return camelKeys<ServerNotification[]>(data ?? [])
}

/** Le compteur de la pastille. Un entier, une requête. */
export async function unreadCount(): Promise<number> {
  if (!supabase) return 0
  const { data, error } = await supabase.rpc('unread_count')
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

export async function markRead(ids: string[]): Promise<number> {
  if (!supabase || ids.length === 0) return 0
  const { data, error } = await supabase.rpc('notifications_read', { p_ids: ids })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

export async function markAllRead(): Promise<number> {
  if (!supabase) return 0
  const { data, error } = await supabase.rpc('notifications_read_all')
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

/* ------------------------------ Les règles ---------------------------- */

export async function listRules(agencyId: string): Promise<NotificationRule[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('notification_rules').select('*').eq('agency_id', agencyId)
  if (error) throw new Error(error.message)
  return camelKeys<NotificationRule[]>(data ?? [])
}

/** Pose ou remplace une règle. La contrainte d'unicité en base porte sur
    (agence, événement, canal, destinataire) : c'est elle qui empêche deux
    règles contradictoires sur la même case. */
export async function upsertRule(rule: {
  agencyId: string
  event: NotifEvent
  channel: NotifChannel
  recipient: NotifRecipient
  enabled: boolean
  templateKey?: string | null
  delayMinutes?: number
}): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('notification_rules').upsert({
    agency_id: rule.agencyId,
    event: rule.event,
    channel: rule.channel,
    recipient: rule.recipient,
    enabled: rule.enabled,
    template_key: rule.templateKey ?? null,
    delay_minutes: rule.delayMinutes ?? 0,
  }, { onConflict: 'agency_id,event,channel,recipient' })
  if (error) throw new Error(error.message)
}

export async function updateRule(id: string, patch: Partial<{
  enabled: boolean
  templateKey: string | null
  delayMinutes: number
}>): Promise<void> {
  if (!supabase) return
  const row: Record<string, unknown> = {}
  if (patch.enabled !== undefined) row.enabled = patch.enabled
  if (patch.templateKey !== undefined) row.template_key = patch.templateKey
  if (patch.delayMinutes !== undefined) row.delay_minutes = patch.delayMinutes
  const { error } = await supabase.from('notification_rules').update(row).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function removeRule(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('notification_rules').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/* ----------------------------- Les webhooks --------------------------- */

export async function listWebhooks(agencyId: string): Promise<Webhook[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('webhooks').select('*').eq('agency_id', agencyId).order('created_at')
  if (error) throw new Error(error.message)
  return camelKeys<Webhook[]>(data ?? [])
}

export async function saveWebhook(hook: {
  id?: string
  agencyId: string
  event: string
  endpoint: string
  secretName: string | null
  active: boolean
}): Promise<void> {
  if (!supabase) return
  const row = {
    agency_id: hook.agencyId,
    event: hook.event,
    endpoint: hook.endpoint,
    // Le nom du secret, jamais sa valeur : la clé de signature vit dans le
    // coffre Supabase, et seule la fonction de bord la lit.
    secret_name: hook.secretName,
    active: hook.active,
  }
  const { error } = hook.id
    ? await supabase.from('webhooks').update(row).eq('id', hook.id)
    : await supabase.from('webhooks').insert(row)
  if (error) throw new Error(error.message)
}

export async function removeWebhook(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('webhooks').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listDeliveries(webhookId: string, limit = 20): Promise<WebhookDelivery[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('webhook_deliveries').select('*')
    .eq('webhook_id', webhookId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return camelKeys<WebhookDelivery[]>(data ?? [])
}

/* ------------------------------ Divers -------------------------------- */

/** Déclenche la balayeuse quotidienne à la main. Réservée à qui gère les
    automatisations : le serveur le vérifie, l'écran ne fait que le montrer. */
export async function runSweep(): Promise<{ deposees: number; purgees: number } | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('notification_sweep')
  if (error) throw new Error(error.message)
  return (data ?? null) as { deposees: number; purgees: number } | null
}

/** La couleur d'une gravité, avec les tons déjà utilisés partout ailleurs. */
export function severityTone(s: NotifSeverity): 'gray' | 'blue' | 'orange' | 'red' {
  return s === 'urgent' ? 'red' : s === 'attention' ? 'orange' : 'blue'
}
