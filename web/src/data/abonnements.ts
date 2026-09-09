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

/** Les trois formules de la grille du 9 septembre 2026 : l'essai, le socle
 *  Active avec ses ajouts, Premium. Les anciens codes (starter, pro…) ont été
 *  repliés par la migration 0070 ; l'écran ne les connaît plus. */
export type PlanCode = 'essai' | 'active' | 'premium'
export type SubscriptionStatus = 'essai' | 'active' | 'impayee' | 'resiliee' | 'suspendue'
/** L'annuel est le prix. Le semestre est l'option chère (× 1,10), pas
 *  l'annuel l'option remisée. `mensuel` ne survit que pour d'anciennes lignes. */
export type BillingPeriod = 'annuel' | 'semestriel' | 'mensuel'
/** TND pour la Tunisie et la Libye, EUR pour tout l'export. */
export type Currency = 'TND' | 'EUR'
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

/**
 * Une ligne de `public_plans(p_currency)` : la grille telle qu'une agence, ou
 * un visiteur sans session, a le droit de la lire. C'est la SEULE source des
 * prix côté écran : aucun chiffre de tarif n'est écrit dans le code, ni 179,
 * ni 35, ni 45. Le jour où la grille bouge en base, tous les écrans suivent.
 *
 * `null` sur un plafond veut dire illimité (Premium), jamais zéro.
 */
export interface PublicPlan {
  code: PlanCode
  name: string
  currency: string
  base_price_month: number
  extra_user_price_month: number | null
  extra_office_price_month: number | null
  max_users: number | null
  max_offices: number | null
  max_active_cases: number | null
  max_active_shipments: number | null
  max_storage_mb: number | null
  /** Ce qu'un bureau en plus apporte avec lui. */
  office_included_users: number
  office_included_cases: number
  office_included_shipments: number
  office_included_storage_mb: number
  /** Ce qu'un compte en plus apporte : du stockage, rien d'autre. */
  extra_user_storage_mb: number
  /** L'usage raisonnable de Premium : chiffré, jamais gardé. */
  fair_use_users: number | null
  fair_use_offices: number | null
  fair_use_storage_mb_per_user: number | null
  fair_use_storage_min_mb: number | null
  trial_days: number
  grace_days: number
  support_hours_month: number | null
  office_support_hours_month: number | null
  semester_allowed: boolean
  semester_factor: number
  note: string | null
  position: number
}

/** Une ligne de la facture TTN, en unités, comme la banque du client la lit. */
export interface InvoiceLine {
  label: string
  quantity: number
  unit_price: number
  total: number
  kind: 'socle' | 'bureau' | 'compte' | 'premium' | 'remise' | string
}

/** HT, TVA, TTC, retenue à la source, net à payer. Les taux viennent de
 *  `billing_settings` : l'expert-comptable n'a pas encore tranché 13 ou 19 %. */
export interface InvoiceTotals {
  currency: string
  ht: number
  tva_rate: number
  tva: number
  ttc: number
  withholding_rate: number
  retenue: number
  net_a_payer: number
  period: BillingPeriod
  /** Le mensuel dont la facture découle. */
  monthly: number
}

/** L'usage raisonnable d'une agence Premium, tel que `my_plan` le rend. */
export interface FairUse {
  users: number | null
  offices: number | null
  storage_mb_per_user: number | null
  storage_min_mb: number | null
  support_hours_month: number | null
}

/** Ce que `agency_plan` rend : le plan effectif d'une agence. */
export interface AgencyPlan {
  agency_id: string
  code: PlanCode
  name: string
  status: SubscriptionStatus
  seats: number
  /** L'ancienne unité d'œuvre (45 DT par siège). Encore rendue par la base,
   *  plus jamais lue pour un prix : le prix est `monthly_amount`. */
  price_per_user_month: number
  currency: string
  billing_period: BillingPeriod
  started_on: string | null
  renewal_on: string | null
  ends_on: string | null
  trial_days: number
  limits: PlanLimits
  features: FeatureCode[]
}

/** Ce que `my_plan` ajoute : la consommation et la facture de l'agence connectée. */
export interface MyPlan extends AgencyPlan {
  usage: UsageCounts
  annual_amount: number
  monthly_amount: number
  plan_code: PlanCode
  extra_users: number
  extra_offices: number
  base_price_month: number
  extra_user_price_month: number | null
  extra_office_price_month: number | null
  /** Les comptes que la souscription autorise : socle + bureaux × inclus + achetés. Null = illimité. */
  seats_allowed: number | null
  invoice_lines: InvoiceLine[]
  invoice_totals: InvoiceTotals
  fair_use: FairUse | null
}

/** Une ligne de la console plateforme. */
export interface SubscriptionRow {
  agency_id: string
  slug: string
  name: string
  country: string
  suspended: boolean
  plan: PlanCode
  plan_code: PlanCode
  plan_name: string
  status: SubscriptionStatus
  seats: number
  price_per_user_month: number
  currency: string
  renewal_on: string | null
  ends_on: string | null
  limits: PlanLimits
  usage: UsageCounts
  computed_at: string | null
  /** Les ressources en dépassement, nommées. Vide = tout va bien. */
  over: QuotaResource[]
  /* La grille du 9 septembre : les ajouts, les prix figés, la période, la remise. */
  extra_users: number
  extra_offices: number
  base_price_month: number
  extra_user_price_month: number | null
  extra_office_price_month: number | null
  /** Socle + bureaux × prix bureau + comptes × prix compte, aux prix figés. */
  monthly_amount: number
  /** Ce que la facture porte : mensuel × 12, ou × 6 × 1,10 au semestre, remise déduite. */
  annual_amount: number
  discount_pct: number
  discount_label: string | null
  discount_until: string | null
  billing_period: BillingPeriod
  seats_allowed: number | null
}

export interface Plan {
  id: string
  code: PlanCode
  name: string
  price_per_user_month: number
  currency: string
  billing_period: BillingPeriod
  /** Les colonnes posées par 0070. Absentes sur une base antérieure. */
  base_price_month?: number
  extra_user_price_month?: number | null
  extra_office_price_month?: number | null
  office_included_users?: number
  semester_allowed?: boolean
  semester_factor?: number
  max_offices: number | null
  max_users: number | null
  max_active_cases: number | null
  max_active_shipments: number | null
  max_storage_mb: number | null
  trial_days: number
  /** Le délai de grâce après l'échéance, posé par 0066. Absent sur une base antérieure. */
  grace_days?: number
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

/**
 * La grille publique dans une devise. Appelable SANS session : c'est ce que
 * la page Souscrire lit pour estimer un prix, et ce que la console lit pour
 * dessiner ses cartes. Les montants arrivent parfois en chaîne (numeric) :
 * on les ramène en nombre ici, une fois, pour que le calcul ne s'y trompe pas.
 */
export async function loadPublicPlans(currency: Currency): Promise<PublicPlan[]> {
  const { data, error } = await client().rpc('public_plans', { p_currency: currency })
  if (error) throw new Error(error.message)
  const n = (v: unknown): number => Number(v ?? 0)
  const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
  return ((data ?? []) as PublicPlan[]).map((p) => ({
    ...p,
    base_price_month: n(p.base_price_month),
    extra_user_price_month: nn(p.extra_user_price_month),
    extra_office_price_month: nn(p.extra_office_price_month),
    max_users: nn(p.max_users),
    max_offices: nn(p.max_offices),
    max_active_cases: nn(p.max_active_cases),
    max_active_shipments: nn(p.max_active_shipments),
    max_storage_mb: nn(p.max_storage_mb),
    office_included_users: n(p.office_included_users),
    office_included_cases: n(p.office_included_cases),
    office_included_shipments: n(p.office_included_shipments),
    office_included_storage_mb: n(p.office_included_storage_mb),
    extra_user_storage_mb: n(p.extra_user_storage_mb),
    fair_use_users: nn(p.fair_use_users),
    fair_use_offices: nn(p.fair_use_offices),
    fair_use_storage_mb_per_user: nn(p.fair_use_storage_mb_per_user),
    fair_use_storage_min_mb: nn(p.fair_use_storage_min_mb),
    trial_days: n(p.trial_days),
    grace_days: n(p.grace_days),
    support_hours_month: nn(p.support_hours_month),
    office_support_hours_month: nn(p.office_support_hours_month),
    semester_factor: Number(p.semester_factor ?? 1),
    semester_allowed: Boolean(p.semester_allowed),
    position: n(p.position),
  })).sort((a, b) => a.position - b.position)
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
 * L'état souple d'un quota (dossiers, cargaisons, stockage) : `info` à 80 %,
 * `attention` à 100 %, `bloque` à 120 % ou à 100 % depuis plus de 30 jours.
 * Premium n'atteint jamais `bloque`. Le branchement dans les écrans de
 * dossiers n'est pas fait ici : ceci n'est que la porte vers la base.
 */
export interface QuotaSoftState {
  niveau: 'ok' | 'info' | 'attention' | 'bloque'
  /** La date du premier passage à 100 %, ou null sous la limite. */
  depuis: string | null
  used: number
  limit: number | null
  pct: number | null
}

export async function loadQuotaSoftState(agencyId: string, resource: QuotaResource): Promise<QuotaSoftState> {
  const { data, error } = await client().rpc('quota_soft_state', { p_agency: agencyId, p_resource: resource })
  if (error) throw new Error(error.message)
  return data as QuotaSoftState
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

/** Ce que `platform_set_subscription` rend : le plan posé, et le prorata
 *  d'un ajout en cours d'année (prix de l'ajout × mois restants, arrondi au
 *  mois entier supérieur). La facture complémentaire s'émet à la main. */
export interface SetSubscriptionResult extends AgencyPlan {
  monthly_amount: number
  annual_amount: number
  prorata: number | null
}

/**
 * Poser ou changer l'abonnement d'une agence. Réservé à la plateforme : une
 * agence ne change pas son propre plan, elle appelle son commercial. La base
 * refuse de toute façon, ce n'est pas l'écran qui protège.
 *
 * Tout ce qui n'est pas donné reste tel quel en base (`null` = inchangé) :
 * c'est ce qui permet d'ajouter un bureau sans retaper la remise.
 */
export async function setSubscription(input: {
  agencyId: string
  plan: PlanCode
  seats?: number | null
  renewalOn: string | null
  status: SubscriptionStatus
  extraUsers?: number | null
  extraOffices?: number | null
  billingPeriod?: BillingPeriod | null
  discountPct?: number | null
  discountLabel?: string | null
  discountUntil?: string | null
  currency?: Currency | null
}): Promise<SetSubscriptionResult> {
  const { data, error } = await client().rpc('platform_set_subscription', {
    p_agency: input.agencyId,
    p_plan_code: input.plan,
    p_seats: input.seats ?? null,
    p_renewal_on: input.renewalOn,
    p_status: input.status,
    p_extra_users: input.extraUsers ?? null,
    p_extra_offices: input.extraOffices ?? null,
    p_billing_period: input.billingPeriod ?? null,
    p_discount_pct: input.discountPct ?? null,
    p_discount_label: input.discountLabel ?? null,
    p_discount_until: input.discountUntil ?? null,
    p_currency: input.currency ?? null,
  })
  if (error) throw new Error(error.message)
  return data as SetSubscriptionResult
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
