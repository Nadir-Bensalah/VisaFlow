/* Le module de pilotage parle au serveur en direct.
 *
 * PRINCIPE, ET IL VAUT RÈGLE : aucun chiffre n'est calculé ici. Le magasin
 * global charge un instantané des tables ; compter dessus marche à cent
 * dossiers et ment à dix mille, parce que l'instantané n'est plus complet et
 * que rien ne le signale. Un total faux est pire qu'un total absent.
 *
 * Ce fichier ne fait donc que deux choses : appeler les fonctions de la
 * migration 0055, et traduire snake_case en camelCase. Le périmètre par bureau
 * est appliqué EN BASE, pas ici : passer `officeId` sert à regarder un bureau
 * précis, jamais à se protéger.
 */

import { supabase, HAS_BACKEND } from '@/lib/supabase'
import type { I18nText } from '@/data/types'

type Row = Record<string, any>

function sb() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

/** Un nombre du serveur. `null` reste `null` : il veut dire « on ne sait pas ». */
const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

/** Un compteur. Absent vaut zéro, parce qu'un compteur absent est un zéro. */
const cnt = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

/* ------------------------------------------------------------------ */
/* Section 130 · Le tableau « À traiter »                              */
/* ------------------------------------------------------------------ */

export type TodoGroup = 'visa' | 'cargo' | 'finance' | 'tasks'

export interface TodoItem {
  group: TodoGroup
  /** La clé nommée par le serveur, par exemple `docsMissing`. */
  key: string
  /** La clé de traduction complète, par exemple `pil.docsMissing`. */
  label: string
  count: number
  link: string
  tone: string
}

export interface Todo {
  generatedAt: string
  officeId: string | null
  staleDays: number
  heldDays: number
  moneyVisible: boolean
  total: number
  items: TodoItem[]
}

export async function loadTodo(officeId: string | null): Promise<Todo | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('dashboard_today', { p_office: officeId })
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  return {
    generatedAt: r.generated_at,
    officeId: r.office ?? null,
    staleDays: cnt(r.stale_days),
    heldDays: cnt(r.held_days),
    moneyVisible: Boolean(r.money_visible),
    total: cnt(r.total),
    items: ((r.items ?? []) as Row[]).map((i) => ({
      group: i.group as TodoGroup,
      key: i.key,
      label: i.label,
      count: cnt(i.count),
      link: i.link,
      tone: i.tone ?? 'gray',
    })),
  }
}

/* ------------------------------------------------------------------ */
/* Section 85 · Le tableau de bord de bureau                           */
/* ------------------------------------------------------------------ */

export interface OfficeMoney {
  collected: number
  outstanding: number
  caseBalances: number
}

export interface OfficeLeads {
  new: number
  won: number
  lost: number
  open: number
}

export interface OfficeBoard {
  from: string
  to: string
  officeId: string | null
  moneyVisible: boolean
  casesOpened: number
  casesClosed: number
  casesOpenNow: number
  casesByStage: { stage: string; n: number }[]
  decided: number
  accepted: number
  refused: number
  acceptance: number | null
  avgDecisionDays: number | null
  docsMissing: number
  docsToValidate: number
  apptsPlanned: number
  apptsDone: number
  apptsMissed: number
  shipmentsOpened: number
  shipmentsDelivered: number
  shipmentsOpenNow: number
  shipmentsBlocked: number
  clientsNew: number
  tasksOpen: number
  tasksOverdue: number
  people: number
  series: { month: string; cases: number; shipments: number }[]
  money: OfficeMoney | null
  leads: OfficeLeads | null
}

export async function loadOfficeBoard(
  officeId: string | null, from: string, to: string,
): Promise<OfficeBoard | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('dashboard_office', {
    p_office: officeId, p_from: from, p_to: to,
  })
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  return {
    from: r.from, to: r.to, officeId: r.office ?? null,
    moneyVisible: Boolean(r.money_visible),
    casesOpened: cnt(r.cases_opened),
    casesClosed: cnt(r.cases_closed),
    casesOpenNow: cnt(r.cases_open_now),
    casesByStage: ((r.cases_by_stage ?? []) as Row[]).map((s) => ({ stage: s.stage, n: cnt(s.n) })),
    decided: cnt(r.decided),
    accepted: cnt(r.accepted),
    refused: cnt(r.refused),
    acceptance: num(r.acceptance),
    avgDecisionDays: num(r.avg_decision_days),
    docsMissing: cnt(r.docs_missing),
    docsToValidate: cnt(r.docs_to_validate),
    apptsPlanned: cnt(r.appts_planned),
    apptsDone: cnt(r.appts_done),
    apptsMissed: cnt(r.appts_missed),
    shipmentsOpened: cnt(r.shipments_opened),
    shipmentsDelivered: cnt(r.shipments_delivered),
    shipmentsOpenNow: cnt(r.shipments_open_now),
    shipmentsBlocked: cnt(r.shipments_blocked),
    clientsNew: cnt(r.clients_new),
    tasksOpen: cnt(r.tasks_open),
    tasksOverdue: cnt(r.tasks_overdue),
    people: cnt(r.people),
    series: ((r.series ?? []) as Row[]).map((s) => ({
      month: s.month, cases: cnt(s.cases), shipments: cnt(s.shipments),
    })),
    money: r.money
      ? {
          collected: cnt(r.money.collected),
          outstanding: cnt(r.money.outstanding),
          caseBalances: cnt(r.money.case_balances),
        }
      : null,
    leads: r.leads
      ? { new: cnt(r.leads.new), won: cnt(r.leads.won), lost: cnt(r.leads.lost), open: cnt(r.leads.open) }
      : null,
  }
}

/* ------------------------------------------------------------------ */
/* Section 86 · La vue consolidée, une ligne par bureau                */
/* ------------------------------------------------------------------ */

export interface AgencyRow {
  officeId: string | null
  officeName: string | null
  isTotal: boolean
  casesOpened: number
  casesOpenNow: number
  decided: number
  accepted: number
  refused: number
  acceptance: number | null
  avgDecisionDays: number | null
  shipmentsOpen: number
  shipmentsDelivered: number
  clientsNew: number
  tasksOverdue: number
  revenue: number | null
  outstanding: number | null
}

export async function loadAgencyRows(from: string, to: string): Promise<AgencyRow[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().rpc('dashboard_agency', { p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map((r) => ({
    officeId: r.office_id, officeName: r.office_name, isTotal: Boolean(r.is_total),
    casesOpened: cnt(r.cases_opened),
    casesOpenNow: cnt(r.cases_open_now),
    decided: cnt(r.decided),
    accepted: cnt(r.accepted),
    refused: cnt(r.refused),
    acceptance: num(r.acceptance),
    avgDecisionDays: num(r.avg_decision_days),
    shipmentsOpen: cnt(r.shipments_open),
    shipmentsDelivered: cnt(r.shipments_delivered),
    clientsNew: cnt(r.clients_new),
    tasksOverdue: cnt(r.tasks_overdue),
    revenue: num(r.revenue),
    outstanding: num(r.outstanding),
  }))
}

/* ------------------------------------------------------------------ */
/* Section 127 · Le rapport visa                                       */
/* ------------------------------------------------------------------ */

/** L'observé de l'agence ET la référence publiée. Deux champs, jamais un seul. */
export interface RefusalRow {
  consulateId: string
  country: I18nText
  city: string
  centre: string | null
  observedDecided: number
  observedRefused: number
  observedRate: number | null
  referenceRate: number | null
  referenceYear: number | null
}

export interface VisaAgentRow {
  userId: string
  name: string
  opened: number
  openNow: number
  decided: number
  accepted: number
}

export interface VisaReport {
  from: string
  to: string
  officeId: string | null
  moneyVisible: boolean
  cases: number
  byCountry: { code: string; label: I18nText; n: number }[]
  byType: { id: string; label: I18nText; category: string; n: number }[]
  byStatus: { status: string; n: number }[]
  byStage: { stage: string; n: number }[]
  decided: number
  accepted: number
  refused: number
  successRate: number | null
  delays: {
    toDecision: number | null
    toDeposit: number | null
    toClose: number | null
    docsComplete: number | null
  }
  byAgent: VisaAgentRow[]
  refusalsByConsulate: RefusalRow[]
  refusalReasons: { code: string; n: number }[]
  missingDocuments: { key: string; label: I18nText; n: number }[]
  revenue: number | null
  revenueReason: string | null
  revenueByCountry: { code: string; label: I18nText; amount: number }[]
}

export async function loadVisaReport(
  officeId: string | null, from: string, to: string,
): Promise<VisaReport | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('report_visa', {
    p_office: officeId, p_from: from, p_to: to,
  })
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  return {
    from: r.from, to: r.to, officeId: r.office ?? null,
    moneyVisible: Boolean(r.money_visible),
    cases: cnt(r.cases),
    byCountry: ((r.by_country ?? []) as Row[]).map((x) => ({ code: x.code, label: x.label, n: cnt(x.n) })),
    byType: ((r.by_type ?? []) as Row[]).map((x) => ({ id: x.id, label: x.label, category: x.category, n: cnt(x.n) })),
    byStatus: ((r.by_status ?? []) as Row[]).map((x) => ({ status: x.status, n: cnt(x.n) })),
    byStage: ((r.by_stage ?? []) as Row[]).map((x) => ({ stage: x.stage, n: cnt(x.n) })),
    decided: cnt(r.decided),
    accepted: cnt(r.accepted),
    refused: cnt(r.refused),
    successRate: num(r.success_rate),
    delays: {
      toDecision: num(r.delays?.to_decision),
      toDeposit: num(r.delays?.to_deposit),
      toClose: num(r.delays?.to_close),
      docsComplete: num(r.delays?.docs_complete),
    },
    byAgent: ((r.by_agent ?? []) as Row[]).map((x) => ({
      userId: x.user_id, name: x.name, opened: cnt(x.opened),
      openNow: cnt(x.open_now), decided: cnt(x.decided), accepted: cnt(x.accepted),
    })),
    refusalsByConsulate: ((r.refusals_by_consulate ?? []) as Row[]).map((x) => ({
      consulateId: x.consulate_id, country: x.country, city: x.city, centre: x.centre,
      observedDecided: cnt(x.observed_decided),
      observedRefused: cnt(x.observed_refused),
      observedRate: num(x.observed_rate),
      referenceRate: num(x.reference_rate),
      referenceYear: x.reference_year === null || x.reference_year === undefined
        ? null : Number(x.reference_year),
    })),
    refusalReasons: ((r.refusal_reasons ?? []) as Row[]).map((x) => ({ code: x.code, n: cnt(x.n) })),
    missingDocuments: ((r.missing_documents ?? []) as Row[]).map((x) => ({
      key: x.key, label: x.label, n: cnt(x.n),
    })),
    revenue: num(r.revenue),
    revenueReason: r.revenue_reason ?? null,
    revenueByCountry: ((r.revenue_by_country ?? []) as Row[]).map((x) => ({
      code: x.code, label: x.label, amount: cnt(x.amount),
    })),
  }
}

/* ------------------------------------------------------------------ */
/* Section 128 · Le rapport fret                                       */
/* ------------------------------------------------------------------ */

export interface CargoReport {
  from: string
  to: string
  officeId: string | null
  moneyVisible: boolean
  homeCountry: string | null
  shipments: number
  byDirection: Record<string, number>
  byMode: Record<string, number>
  weightKg: number | null
  volumeCbm: number | null
  packages: number | null
  containers: number | null
  byCountry: { from: string | null; to: string | null; n: number }[]
  byCarrier: { carrier: string; n: number }[]
  transitDays: number | null
  customsDays: number | null
  deliveryDays: number | null
  lateDelivered: number
  lateNow: number
  blocked: number
  demurrage: {
    shipments: number
    overdueDays: number | null
    amount: number | null
    currency: string | null
    withoutTariff: number
  }
  revenue: number | null
  revenueReason: string | null
  costs: { total: number; byKind: Record<string, number> } | null
  margin: number | null
  marginReason: string | null
}

export async function loadCargoReport(
  officeId: string | null, from: string, to: string,
): Promise<CargoReport | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('report_cargo', {
    p_office: officeId, p_from: from, p_to: to,
  })
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  const d = (r.demurrage ?? {}) as Row
  const toNums = (o: Row | null | undefined): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(o ?? {})) out[k] = cnt(v)
    return out
  }
  return {
    from: r.from, to: r.to, officeId: r.office ?? null,
    moneyVisible: Boolean(r.money_visible),
    homeCountry: r.home_country ?? null,
    shipments: cnt(r.shipments),
    byDirection: toNums(r.by_direction),
    byMode: toNums(r.by_mode),
    weightKg: num(r.weight_kg),
    volumeCbm: num(r.volume_cbm),
    packages: num(r.packages),
    containers: num(r.containers),
    byCountry: ((r.by_country ?? []) as Row[]).map((x) => ({ from: x.from, to: x.to, n: cnt(x.n) })),
    byCarrier: ((r.by_carrier ?? []) as Row[]).map((x) => ({ carrier: x.carrier, n: cnt(x.n) })),
    transitDays: num(r.transit_days),
    customsDays: num(r.customs_days),
    deliveryDays: num(r.delivery_days),
    lateDelivered: cnt(r.late_delivered),
    lateNow: cnt(r.late_now),
    blocked: cnt(r.blocked),
    demurrage: {
      shipments: cnt(d.shipments),
      overdueDays: num(d.overdue_days),
      amount: num(d.amount),
      currency: d.currency ?? null,
      withoutTariff: cnt(d.without_tariff),
    },
    revenue: num(r.revenue),
    revenueReason: r.revenue_reason ?? null,
    costs: r.costs ? { total: cnt(r.costs.total), byKind: toNums(r.costs.by_kind) } : null,
    margin: num(r.margin),
    marginReason: r.margin_reason ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Section 129 · L'équipe. Des chiffres bruts, aucune note.            */
/* ------------------------------------------------------------------ */

export interface TeamRow {
  userId: string
  name: string
  role: string
  officeId: string | null
  active: boolean
  casesActive: number
  casesDone: number
  casesOpened: number
  tasksDone: number
  tasksOverdue: number
  clientsFollowed: number
  documentsHandled: number
  messagesSent: number
  /** `null` sans `finance:global`. On ne remplace pas par 0 : ce n'est pas zéro. */
  revenue: number | null
  leadsAssigned: number | null
  leadsWon: number | null
}

export interface TeamReport {
  from: string
  to: string
  moneyVisible: boolean
  /** Le serveur affirme lui-même qu'il ne rend aucune note. */
  noScore: boolean
  rows: TeamRow[]
}

export async function loadTeamReport(from: string, to: string): Promise<TeamReport | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('report_team', { p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  return {
    from: r.from, to: r.to,
    moneyVisible: Boolean(r.money_visible),
    noScore: Boolean(r.no_score),
    rows: ((r.rows ?? []) as Row[]).map((x) => ({
      userId: x.user_id, name: x.name, role: x.role, officeId: x.office_id,
      active: Boolean(x.active),
      casesActive: cnt(x.cases_active),
      casesDone: cnt(x.cases_done),
      casesOpened: cnt(x.cases_opened),
      tasksDone: cnt(x.tasks_done),
      tasksOverdue: cnt(x.tasks_overdue),
      clientsFollowed: cnt(x.clients_followed),
      documentsHandled: cnt(x.documents_handled),
      messagesSent: cnt(x.messages_sent),
      revenue: num(x.revenue),
      leadsAssigned: num(x.leads_assigned),
      leadsWon: num(x.leads_won),
    })),
  }
}

/* ------------------------------------------------------------------ */
/* Section 185 · Les retards, un seul format                           */
/* ------------------------------------------------------------------ */

export type OverdueKind =
  | 'dossier' | 'cargaison' | 'tache' | 'piece' | 'paiement' | 'facture'

export interface OverdueItem {
  kind: OverdueKind
  id: string
  reference: string | null
  label: string | null
  due: string | null
  daysLate: number
  link: string
  officeId: string | null
}

export async function loadOverdue(officeId: string | null): Promise<OverdueItem[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().rpc('overdue_items', { p_office: officeId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map((r) => ({
    kind: r.kind as OverdueKind,
    id: r.id, reference: r.reference, label: r.label, due: r.due,
    daysLate: cnt(r.days_late), link: r.link, officeId: r.office_id,
  }))
}

/* ------------------------------------------------------------------ */
/* Section 184 · Les délais de service                                 */
/* ------------------------------------------------------------------ */

export type SlaEvent =
  | 'lead_nouveau' | 'document_recu' | 'cargaison_arrivee'
  | 'dossier_bloque' | 'message_client' | 'paiement_du'

export const SLA_EVENTS: SlaEvent[] = [
  'lead_nouveau', 'document_recu', 'cargaison_arrivee',
  'dossier_bloque', 'message_client', 'paiement_du',
]

export interface SlaRule {
  id: string
  agencyId: string
  event: SlaEvent
  targetMinutes: number
  appliesToRole: string | null
  active: boolean
  note: string | null
}

export interface SlaBreach {
  ruleId: string
  event: SlaEvent
  targetMinutes: number
  entityKind: string
  entityId: string
  reference: string | null
  label: string | null
  since: string
  minutesElapsed: number
  minutesOver: number
  link: string
}

export async function loadSlaRules(): Promise<SlaRule[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('sla_rules').select('*').order('event')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id, agencyId: r.agency_id, event: r.event as SlaEvent,
    targetMinutes: cnt(r.target_minutes), appliesToRole: r.applies_to_role,
    active: Boolean(r.active), note: r.note,
  }))
}

export async function saveSlaRule(
  id: string, patch: { targetMinutes?: number; active?: boolean; appliesToRole?: string | null },
): Promise<void> {
  const row: Row = {}
  if (patch.targetMinutes !== undefined) row.target_minutes = patch.targetMinutes
  if (patch.active !== undefined) row.active = patch.active
  if (patch.appliesToRole !== undefined) row.applies_to_role = patch.appliesToRole
  const { error } = await sb().from('sla_rules').update(row).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function loadSlaBreaches(officeId: string | null): Promise<SlaBreach[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().rpc('sla_breaches', { p_office: officeId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map((r) => ({
    ruleId: r.rule_id, event: r.event as SlaEvent, targetMinutes: cnt(r.target_minutes),
    entityKind: r.entity_kind, entityId: r.entity_id, reference: r.reference,
    label: r.label, since: r.since,
    minutesElapsed: cnt(r.minutes_elapsed), minutesOver: cnt(r.minutes_over),
    link: r.link,
  }))
}

/* ------------------------------------------------------------------ */
/* Section 189 · L'analyse plateforme                                  */
/* ------------------------------------------------------------------ */

export interface PlatformAnalytics {
  generatedAt: string
  mrrSource: string
  mrrMonthlyPlans: number
  mrrAnnualTwelfth: number
  mrrTotal: number
  arr: number
  mrrNote: string
  agenciesTotal: number
  agenciesActive: number
  agenciesSuspended: number
  trials: number
  trialsEnding30d: number
  conversions90d: number
  churn90d: number
  churnRate90d: number | null
  accounts: number
  offices: number
  clients: number
  cases: number
  casesOpen: number
  shipments: number
  shipmentsOpen: number
  storageBytes: number
  byPlan: Record<string, number>
  signupsByMonth: { month: string; n: number }[]
}

export async function loadPlatformAnalytics(): Promise<PlatformAnalytics | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('platform_analytics')
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  const plans: Record<string, number> = {}
  for (const [k, v] of Object.entries(r.by_plan ?? {})) plans[k] = cnt(v)
  return {
    generatedAt: r.generated_at,
    mrrSource: r.mrr_source,
    mrrMonthlyPlans: cnt(r.mrr_monthly_plans),
    mrrAnnualTwelfth: cnt(r.mrr_annual_twelfth),
    mrrTotal: cnt(r.mrr_total),
    arr: cnt(r.arr),
    mrrNote: r.mrr_note,
    agenciesTotal: cnt(r.agencies_total),
    agenciesActive: cnt(r.agencies_active),
    agenciesSuspended: cnt(r.agencies_suspended),
    trials: cnt(r.trials),
    trialsEnding30d: cnt(r.trials_ending_30d),
    conversions90d: cnt(r.conversions_90d),
    churn90d: cnt(r.churn_90d),
    churnRate90d: num(r.churn_rate_90d),
    accounts: cnt(r.accounts),
    offices: cnt(r.offices),
    clients: cnt(r.clients),
    cases: cnt(r.cases),
    casesOpen: cnt(r.cases_open),
    shipments: cnt(r.shipments),
    shipmentsOpen: cnt(r.shipments_open),
    storageBytes: cnt(r.storage_bytes),
    byPlan: plans,
    signupsByMonth: ((r.signups_by_month ?? []) as Row[]).map((x) => ({
      month: x.month, n: cnt(x.n),
    })),
  }
}

/* ------------------------------------------------------------------ */
/* Les bornes de période, au même endroit pour tous les écrans         */
/* ------------------------------------------------------------------ */

export type PeriodKey = 'mois' | 'j30' | 'j90' | 'annee'

const iso = (d: Date): string => d.toISOString().slice(0, 10)

export function periodRange(key: PeriodKey): { from: string; to: string } {
  const today = new Date()
  const to = iso(today)
  if (key === 'mois') {
    return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to }
  }
  if (key === 'annee') {
    return { from: iso(new Date(today.getFullYear(), 0, 1)), to }
  }
  const days = key === 'j30' ? 30 : 90
  const from = new Date(today)
  from.setDate(from.getDate() - days)
  return { from: iso(from), to }
}
