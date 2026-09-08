import { supabase, HAS_BACKEND } from '@/lib/supabase'
import type { I18nText } from '@/data/types'

/* Tous les appels du module « support et démarrage ».
 *
 * Une seule porte vers la base pour ce module : la carte d'accueil, l'écran de
 * support, le bandeau d'annonce, le bouton de retour et les deux écrans de la
 * console passent tous par ici. Le jour où le nom d'une fonction SQL change,
 * il n'y a qu'un fichier à relire.
 *
 * Deux principes, qui viennent de la base et qu'on ne contredit pas ici :
 *
 * 1. LE DÉMARRAGE SE DÉDUIT. On ne demande jamais à l'agence de cocher ce que
 *    les données disent déjà. `onboarding_state` regarde les bureaux, l'équipe,
 *    le catalogue, les clients et les dossiers, et rend l'étape en cours. Le
 *    navigateur ne recalcule rien : il affiche.
 *
 * 2. LE TABLEAU DES IDÉES EST ANONYME PAR CONSTRUCTION. `feedback_board` ne
 *    rend ni l'agence d'origine, ni l'auteur, ni la page. Ce n'est pas un choix
 *    d'affichage qu'on pourrait défaire ici : les champs n'arrivent pas.
 */

/* ------------------------------------------------------------------ */
/* Le démarrage                                                        */
/* ------------------------------------------------------------------ */

export type OnboardingStepKey =
  | 'profil' | 'bureau' | 'equipe' | 'services'
  | 'prix' | 'marque' | 'premier_client' | 'premier_dossier'

export interface OnboardingStep {
  step: OnboardingStepKey
  done: boolean
  /** Vrai quand la coche vient des données, pas d'un clic. */
  auto: boolean
  skipped: boolean
  done_at: string | null
  done_by: string | null
}

export interface OnboardingState {
  agency_id: string
  steps: OnboardingStep[]
  total: number
  done: number
  skipped: number
  percent: number
  /** La première étape ni faite ni passée. `null` quand tout est réglé. */
  current: OnboardingStepKey | null
  remaining: OnboardingStepKey[]
  complete: boolean
  hidden: boolean
}

function client() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

export async function loadOnboarding(): Promise<OnboardingState | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await client().rpc('onboarding_state', { p_agency: null })
  if (error) throw new Error(error.message)
  return data as OnboardingState
}

export async function completeStep(step: OnboardingStepKey): Promise<OnboardingState> {
  const { data, error } = await client().rpc('onboarding_complete', { p_step: step })
  if (error) throw new Error(error.message)
  return data as OnboardingState
}

export async function skipStep(step: OnboardingStepKey): Promise<OnboardingState> {
  const { data, error } = await client().rpc('onboarding_skip', { p_step: step })
  if (error) throw new Error(error.message)
  return data as OnboardingState
}

/** Ranger la carte d'accueil. Écrit dans `agencies.setup_hidden`, la colonne d'origine. */
export async function hideOnboarding(hidden = true): Promise<void> {
  const { error } = await client().rpc('onboarding_hide', { p_hidden: hidden })
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Le choix d'activité                                                 */
/* ------------------------------------------------------------------ */

export type ModuleKey =
  | 'clients' | 'messages' | 'taches' | 'demandes'
  | 'dossiers' | 'pieces' | 'rendez_vous' | 'creneaux'
  | 'cargaisons' | 'douane' | 'entrepots' | 'transporteurs'
  | 'paiements' | 'devis' | 'factures'
  | 'rapports' | 'statistiques' | 'automatisations' | 'reglages'
  | 'portail' | 'whatsapp' | 'crm'
  | 'comptabilite' | 'api' | 'marque_blanche'

export interface AgencyModules {
  agency_id: string
  services: ('visas' | 'fret')[]
  visas: boolean
  fret: boolean
  /** Vrai quand le module d'abonnement est en place et referme des écrans. */
  billing_aware: boolean
  modules: Record<ModuleKey, boolean>
}

/**
 * Ce que la navigation montre. Le calcul vient du serveur et de nulle part
 * ailleurs : écrit dans le navigateur, il se contournerait avec la console du
 * navigateur, et une agence de visas verrait des écrans de fret vides.
 */
export async function loadModules(): Promise<AgencyModules | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await client().rpc('agency_modules', { p_agency: null })
  if (error) throw new Error(error.message)
  return data as AgencyModules
}

/* ------------------------------------------------------------------ */
/* Le support                                                          */
/* ------------------------------------------------------------------ */

export type TicketCategory = 'question' | 'anomalie' | 'demande' | 'facturation' | 'urgence'
export type TicketPriority = 'basse' | 'normale' | 'haute' | 'urgente'
export type TicketStatus = 'ouvert' | 'pris_en_charge' | 'en_attente_client' | 'resolu' | 'ferme'

export const TICKET_CATEGORIES: TicketCategory[] = [
  'question', 'anomalie', 'demande', 'facturation', 'urgence',
]
export const TICKET_PRIORITIES: TicketPriority[] = ['basse', 'normale', 'haute', 'urgente']
export const TICKET_STATUSES: TicketStatus[] = [
  'ouvert', 'pris_en_charge', 'en_attente_client', 'resolu', 'ferme',
]

export interface TicketMessage {
  id: string
  /** De quel côté vient le message. L'identité de la personne ne traverse pas. */
  author_kind: 'agence' | 'plateforme'
  body: string
  attachment_path: string | null
  at: string
}

export interface Ticket {
  id: string
  category: TicketCategory
  priority: TicketPriority
  subject: string
  message: string
  status: TicketStatus
  created_at: string
  updated_at: string
  resolved_at: string | null
  satisfaction: number | null
  created_by: string | null
  thread: TicketMessage[]
}

/** Ce que la console voit en plus : le nom de l'agence, jamais ses données. */
export interface PlatformTicket extends Ticket {
  agency_id: string
  agency_name: string
  agency_slug: string
  agency_plan: string
  assigned_admin: string | null
  messages: number
  last_kind: 'agence' | 'plateforme' | null
}

export async function loadMyTickets(): Promise<Ticket[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await client().rpc('support_my_tickets')
  if (error) throw new Error(error.message)
  return (data ?? []) as Ticket[]
}

export async function openTicket(input: {
  category: TicketCategory
  priority: TicketPriority
  subject: string
  message: string
}): Promise<string> {
  const { data, error } = await client().rpc('support_open', {
    p_category: input.category, p_priority: input.priority,
    p_subject: input.subject, p_message: input.message,
  })
  if (error) throw new Error(error.message)
  return data as string
}

/** La même porte pour les deux côtés : le serveur déduit qui parle. */
export async function replyToTicket(ticketId: string, body: string): Promise<void> {
  const { error } = await client().rpc('support_reply', { p_ticket: ticketId, p_body: body })
  if (error) throw new Error(error.message)
}

export async function rateTicket(ticketId: string, score: number): Promise<void> {
  const { error } = await client().rpc('support_rate', { p_ticket: ticketId, p_score: score })
  if (error) throw new Error(error.message)
}

export async function loadPlatformTickets(status: TicketStatus | null): Promise<PlatformTicket[]> {
  const { data, error } = await client().rpc('platform_tickets', { p_status: status })
  if (error) throw new Error(error.message)
  return (data ?? []) as PlatformTicket[]
}

export async function platformReply(ticketId: string, body: string): Promise<void> {
  const { error } = await client().rpc('platform_ticket_reply', { p_ticket: ticketId, p_body: body })
  if (error) throw new Error(error.message)
}

export async function platformSetTicketStatus(ticketId: string, status: TicketStatus): Promise<void> {
  const { error } = await client().rpc('platform_ticket_status', { p_ticket: ticketId, p_status: status })
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Les annonces                                                        */
/* ------------------------------------------------------------------ */

export type AnnouncementKind = 'maintenance' | 'nouveaute' | 'incident' | 'pays'
export type AnnouncementSeverity = 'info' | 'attention' | 'critique'
export type AnnouncementTarget = 'toutes' | 'essai' | 'payantes' | 'une_agence'

export const ANNOUNCEMENT_KINDS: AnnouncementKind[] = ['maintenance', 'nouveaute', 'incident', 'pays']
export const ANNOUNCEMENT_SEVERITIES: AnnouncementSeverity[] = ['info', 'attention', 'critique']
export const ANNOUNCEMENT_TARGETS: AnnouncementTarget[] = ['toutes', 'essai', 'payantes', 'une_agence']

export interface Announcement {
  id: string
  kind: AnnouncementKind
  title: I18nText
  body: Partial<I18nText>
  severity: AnnouncementSeverity
  starts_at: string
  ends_at: string | null
  published_at: string | null
  read: boolean
  read_at: string | null
}

export interface PlatformAnnouncement {
  id: string
  kind: AnnouncementKind
  title: I18nText
  body: Partial<I18nText>
  severity: AnnouncementSeverity
  starts_at: string
  ends_at: string | null
  target: AnnouncementTarget
  target_agency_id: string | null
  target_agency_name: string | null
  published_at: string | null
  created_at: string
  reads: number
}

/** Ce qu'un compte connecté doit voir maintenant. Non lu en premier. */
export async function loadAnnouncements(): Promise<Announcement[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await client().rpc('active_announcements')
  if (error) throw new Error(error.message)
  return (data ?? []) as Announcement[]
}

export async function markAnnouncementRead(id: string): Promise<void> {
  const { error } = await client().rpc('announcement_read', { p_announcement: id })
  if (error) throw new Error(error.message)
}

export async function loadPlatformAnnouncements(): Promise<PlatformAnnouncement[]> {
  const { data, error } = await client().rpc('platform_announcements')
  if (error) throw new Error(error.message)
  return (data ?? []) as PlatformAnnouncement[]
}

export interface AnnouncementDraft {
  id: string | null
  kind: AnnouncementKind
  title: I18nText
  body: Partial<I18nText>
  severity: AnnouncementSeverity
  startsAt: string | null
  endsAt: string | null
  target: AnnouncementTarget
  targetAgencyId: string | null
}

export async function savePlatformAnnouncement(draft: AnnouncementDraft): Promise<string> {
  const { data, error } = await client().rpc('platform_save_announcement', {
    p_id: draft.id, p_kind: draft.kind, p_title: draft.title, p_body: draft.body,
    p_severity: draft.severity, p_starts_at: draft.startsAt, p_ends_at: draft.endsAt,
    p_target: draft.target, p_target_agency: draft.targetAgencyId,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function publishAnnouncement(id: string, published: boolean): Promise<void> {
  const { error } = await client().rpc('platform_publish_announcement', {
    p_id: id, p_published: published,
  })
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Les retours                                                         */
/* ------------------------------------------------------------------ */

export type FeedbackKind = 'idee' | 'gene' | 'compliment' | 'autre'
export type FeedbackStatus = 'nouveau' | 'lu' | 'planifie' | 'fait' | 'ecarte'

export const FEEDBACK_KINDS: FeedbackKind[] = ['idee', 'gene', 'compliment', 'autre']
export const FEEDBACK_STATUSES: FeedbackStatus[] = ['nouveau', 'lu', 'planifie', 'fait', 'ecarte']

/**
 * Une idée telle que l'agence la voit. Remarquez ce qui MANQUE : ni agency_id,
 * ni user_id, ni page. Le serveur ne les envoie pas, et c'est délibéré : les
 * agences sont concurrentes entre elles, et savoir ce que la concurrence
 * demande est une information commerciale.
 */
export interface BoardItem {
  id: string
  kind: FeedbackKind
  message: string
  status: FeedbackStatus
  votes: number
  created_at: string
  response: string | null
  /** Est-ce mon propre retour. */
  mine: boolean
  /** Mon agence a-t-elle déjà voté. */
  voted: boolean
}

/** Ce que la plateforme voit : l'origine comprise. Elle n'est pas concurrente. */
export interface PlatformFeedback {
  id: string
  agency_id: string
  agency_name: string
  kind: FeedbackKind
  message: string
  page: string | null
  status: FeedbackStatus
  votes: number
  created_at: string
  handled_at: string | null
  response: string | null
}

export async function sendFeedback(input: {
  kind: FeedbackKind
  message: string
  page: string | null
}): Promise<string> {
  const { data, error } = await client().rpc('feedback_send', {
    p_kind: input.kind, p_message: input.message, p_page: input.page,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function loadBoard(status: FeedbackStatus | null = null): Promise<BoardItem[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await client().rpc('feedback_board', { p_status: status })
  if (error) throw new Error(error.message)
  return (data ?? []) as BoardItem[]
}

/** Voter. Idempotent côté serveur : un vote ne compte qu'une fois par agence. */
export async function voteFeedback(id: string): Promise<number> {
  const { data, error } = await client().rpc('feedback_vote', { p_feedback: id })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

export async function unvoteFeedback(id: string): Promise<number> {
  const { data, error } = await client().rpc('feedback_unvote', { p_feedback: id })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

export async function loadPlatformFeedback(status: FeedbackStatus | null = null): Promise<PlatformFeedback[]> {
  const { data, error } = await client().rpc('platform_feedback', { p_status: status })
  if (error) throw new Error(error.message)
  return (data ?? []) as PlatformFeedback[]
}

export async function handlePlatformFeedback(
  id: string, status: FeedbackStatus, response: string | null,
): Promise<void> {
  const { error } = await client().rpc('platform_feedback_handle', {
    p_feedback: id, p_status: status, p_response: response,
  })
  if (error) throw new Error(error.message)
}
