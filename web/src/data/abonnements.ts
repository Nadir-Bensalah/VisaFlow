import { supabase } from '@/lib/supabase'
import type { Quota, QuotaResource } from '@/lib/quotas'

/* Tous les appels du module « abonnements et quotas ».
 *
 * Aucun autre fichier ne parle à la base pour ce module : ni la console, ni la
 * carte du plan. Une seule porte, donc un seul endroit à relire le jour où le
 * nom d'une fonction SQL change.
 *
 * Rien ici ne PREND d'argent. L'abonnement se facture à l'année sur facture
 * TTN : il n'existe pas de prélèvement récurrent par carte en Tunisie, et
 * Stripe ne couvre pas le pays. Ces fonctions posent un plan et lisent une
 * consommation, elles n'encaissent jamais.
 */

export type PlanCode = 'essai' | 'starter' | 'pro' | 'business' | 'enterprise'
export type SubscriptionStatus = 'essai' | 'active' | 'impayee' | 'resiliee' | 'suspendue'
export type FeatureCode =
  | 'VISA' | 'CARGO' | 'CRM' | 'WHATSAPP' | 'CLIENT_PORTAL'
  | 'ADVANCED_REPORTS' | 'API' | 'WHITE_LABEL' | 'CUSTOM_ROLES' | 'ACCOUNTING'

/** Les limites d'un plan. `null` veut dire illimité, jamais zéro. */
export interface PlanLimits {
  offices: number | null
  users: number | null
  cases: number | null
  shipments: number | null
  storage_mb: number | null
}

export interface UsageCounts {
  users: number
  offices: number
  clients: number
  cases: number
  shipments: number
  storage_bytes: number
}

/** Ce que `agency_plan` rend : le plan effectif d'une agence. */
export interface AgencyPlan {
  agency_id: string
  code: PlanCode
  name: string
  status: SubscriptionStatus
  seats: number
  price_per_user_month: number
  currency: string
  billing_period: 'annuel' | 'mensuel'
  started_on: string | null
  renewal_on: string | null
  ends_on: string | null
  trial_days: number
  limits: PlanLimits
  features: FeatureCode[]
}

/** Ce que `my_plan` ajoute : la consommation de l'agence connectée. */
export interface MyPlan extends AgencyPlan {
  usage: UsageCounts
  annual_amount: number
}

/** Une ligne de la console plateforme. */
export interface SubscriptionRow {
  agency_id: string
  slug: string
  name: string
  country: string
  suspended: boolean
  plan: PlanCode
  plan_name: string
  status: SubscriptionStatus
  seats: number
  price_per_user_month: number
  currency: string
  renewal_on: string | null
  ends_on: string | null
  limits: PlanLimits
  annual_amount: number
  usage: UsageCounts
  computed_at: string | null
  /** Les ressources en dépassement, nommées. Vide = tout va bien. */
  over: QuotaResource[]
}

export interface Plan {
  id: string
  code: PlanCode
  name: string
  price_per_user_month: number
  currency: string
  billing_period: 'annuel' | 'mensuel'
  max_offices: number | null
  max_users: number | null
  max_active_cases: number | null
  max_active_shipments: number | null
  max_storage_mb: number | null
  trial_days: number
  active: boolean
  position: number
  note: string | null
}

export interface SubscriptionEvent {
  id: string
  kind: 'creee' | 'changement_plan' | 'renouvelee' | 'suspendue' | 'reactivee' | 'resiliee' | 'quota_depasse'
  detail: Record<string, unknown>
  at: string
  by: string | null
}

function client() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

/** La grille tarifaire. Une agence a le droit de voir ce qu'elle pourrait acheter. */
export async function loadPlans(): Promise<Plan[]> {
  const { data, error } = await client()
    .from('plans').select('*').eq('active', true).order('position')
  if (error) throw new Error(error.message)
  return (data ?? []) as Plan[]
}

/** Le plan et la consommation de l'agence connectée. C'est ce que PlanCard lit. */
export async function loadMyPlan(): Promise<MyPlan> {
  const { data, error } = await client().rpc('my_plan')
  if (error) throw new Error(error.message)
  return data as MyPlan
}

/** Le plan d'une agence donnée, pour la console. */
export async function loadAgencyPlan(agencyId: string): Promise<AgencyPlan> {
  const { data, error } = await client().rpc('agency_plan', { p_agency: agencyId })
  if (error) throw new Error(error.message)
  return data as AgencyPlan
}

/** Un quota précis, recompté en base. C'est la valeur qui fait foi. */
export async function loadQuota(agencyId: string, resource: QuotaResource): Promise<Quota> {
  const { data, error } = await client().rpc('quota_check', { p_agency: agencyId, p_resource: resource })
  if (error) throw new Error(error.message)
  return data as Quota
}

/**
 * Le portillon du produit : cette agence a-t-elle cette fonctionnalité ?
 * La réponse vient de la base, jamais d'une liste écrite dans le navigateur :
 * une liste côté écran se contourne avec la console du navigateur.
 */
export async function hasFeature(agencyId: string, feature: FeatureCode): Promise<boolean> {
  const { data, error } = await client().rpc('agency_has_feature', {
    p_agency: agencyId, p_feature: feature,
  })
  if (error) throw new Error(error.message)
  return Boolean(data)
}

/** La liste des abonnements, pour la console plateforme. */
export async function loadSubscriptions(): Promise<SubscriptionRow[]> {
  const { data, error } = await client().rpc('platform_subscriptions')
  if (error) throw new Error(error.message)
  return (data ?? []) as SubscriptionRow[]
}

/** L'histoire d'un abonnement. C'est ce qu'on relit quand un client conteste une facture. */
export async function loadSubscriptionEvents(agencyId: string, limit = 50): Promise<SubscriptionEvent[]> {
  const { data, error } = await client().rpc('platform_subscription_events', {
    p_agency: agencyId, p_limit: limit,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as SubscriptionEvent[]
}

/**
 * Poser ou changer l'abonnement d'une agence. Réservé à la plateforme : une
 * agence ne change pas son propre plan, elle appelle son commercial. La base
 * refuse de toute façon, ce n'est pas l'écran qui protège.
 */
export async function setSubscription(input: {
  agencyId: string
  plan: PlanCode
  seats: number
  renewalOn: string | null
  status: SubscriptionStatus
}): Promise<AgencyPlan> {
  const { data, error } = await client().rpc('platform_set_subscription', {
    p_agency: input.agencyId,
    p_plan_code: input.plan,
    p_seats: input.seats,
    p_renewal_on: input.renewalOn,
    p_status: input.status,
  })
  if (error) throw new Error(error.message)
  return data as AgencyPlan
}

/** Recompter la consommation d'une agence, à la demande. */
export async function refreshUsage(agencyId: string): Promise<void> {
  const { error } = await client().rpc('refresh_usage', { p_agency: agencyId })
  if (error) throw new Error(error.message)
}

/** Recompter tout le monde. C'est aussi ce que la tâche planifiée appelle. */
export async function refreshUsageAll(): Promise<number> {
  const { data, error } = await client().rpc('refresh_usage_all')
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}
