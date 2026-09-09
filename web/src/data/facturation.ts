import { supabase } from '@/lib/supabase'

/* Tous les appels du module « cycle de facturation ».
 *
 * Une seule porte vers la base, comme pour les abonnements : le jour où le nom
 * d'une fonction SQL change, il y a un seul fichier à relire.
 *
 * Rien ici ne PREND d'argent, et ce n'est pas un oubli. L'abonnement se règle
 * par virement, sur facture TTN : il n'existe pas de prélèvement récurrent par
 * carte en Tunisie. Le seul geste de paiement du produit est celui du
 * super-admin qui constate un virement reçu.
 */

/** Les quatre états que l'écran connaît. La base en tient six, elle replie
 *  `impayee` sur `grace` et `resiliee` sur `suspendue` : dans les deux cas
 *  l'écran a le même mot à dire. */
export type BillingState = 'essai' | 'grace' | 'a_jour' | 'suspendue'

export type BillingSeverity = 'info' | 'attention' | 'critique'

/** L'état du cycle d'une agence, tel que `agency_access_state` le rend.
 *
 *  `message_cle` est une CLÉ DE TRADUCTION, jamais une phrase : le bandeau se
 *  lit en arabe si l'agence travaille en arabe. Nulle veut dire « rien à
 *  dire », et c'est ce qui éteint le bandeau. */
export interface AccessState {
  etat: BillingState
  /** Jours avant la prochaine échéance. Négatif quand elle est dépassée. */
  jours_restants: number | null
  echeance: string | null
  message_cle: string | null
  severite: BillingSeverity
  bloquant: boolean
}

/** Ce que `agency_gate` rend au chargement de l'application. Le message change
 *  selon le rôle : un employé n'a rien à faire du service facturation. */
export interface AccessGate {
  bloquant: boolean
  role: string | null
  message_cle: string | null
  /** L'adresse du service facturation. Elle ne part qu'au propriétaire. */
  contact: string | null
}

/** Une ligne du tableau de la console, déjà triée par urgence côté serveur. */
export interface BillingRow {
  agency_id: string
  slug: string
  name: string
  country: string
  etat: BillingState
  severite: BillingSeverity
  bloquant: boolean
  jours_restants: number | null
  echeance: string | null
  billing_state: 'essai' | 'grace' | 'a_jour' | 'impayee' | 'suspendue' | 'resiliee' | null
  statut: string | null
  plan: string | null
  sieges: number
  /** Sièges signés × 45 DT × 12 mois. La ligne de facture, pas un encaissement. */
  montant_attendu: number
  devise: string
  dernier_paiement: string | null
  dernier_montant: number | null
  suspendue_le: string | null
  motif: string | null
  suspendue: boolean
}

export type PaymentMethod = 'virement' | 'cheque' | 'especes' | 'carte' | 'autre'

export interface RecordedPayment {
  ok: boolean
  agency_id: string
  paiement_id: string
  etat: 'a_jour'
  renewal_on: string
  grace_ends_on: string
  reactivee: boolean
}

export interface AgencyPayment {
  id: string
  amount: number
  currency: string
  period_start: string
  period_end: string
  method: PaymentMethod
  reference: string | null
  note: string | null
  recorded_at: string
  recorded_by: string | null
}

function client() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

/**
 * L'état du cycle d'une agence. Appelable par N'IMPORTE QUEL compte de
 * l'agence, pas seulement le propriétaire : le compte à rebours de l'essai se
 * voit par tous, c'est un bandeau, pas un écran de réglages.
 */
export async function loadAccessState(agencyId: string): Promise<AccessState> {
  const { data, error } = await client().rpc('agency_access_state', { p_agency: agencyId })
  if (error) throw new Error(error.message)
  return data as AccessState
}

/**
 * Le mur de connexion, appelé au chargement de la coquille.
 *
 * Le blocage est côté application et non côté politiques : couper les
 * politiques d'une agence suspendue l'empêcherait de lire sa propre facture,
 * donc de comprendre pourquoi elle est coupée et de payer.
 */
export async function loadGate(): Promise<AccessGate> {
  const { data, error } = await client().rpc('agency_gate')
  if (error) throw new Error(error.message)
  return data as AccessGate
}

/** Le tableau de la console, déjà trié par urgence : ne pas le re-trier ici. */
export async function loadBillingBoard(): Promise<BillingRow[]> {
  const { data, error } = await client().rpc('platform_billing_board')
  if (error) throw new Error(error.message)
  return (data ?? []) as BillingRow[]
}

/**
 * Constater un règlement reçu. Réservé au super-admin, et la base le vérifie :
 * ce n'est pas l'écran qui protège.
 *
 * Le montant est celui qu'on saisit. Rien ne le calcule à la place de
 * l'utilisateur : un montant deviné sur une facture est un montant que la
 * banque refuse.
 */
export async function recordPayment(input: {
  agencyId: string
  amount: number
  currency?: string
  periodStart?: string | null
  periodEnd?: string | null
  method?: PaymentMethod
  reference?: string | null
  note?: string | null
}): Promise<RecordedPayment> {
  const { data, error } = await client().rpc('platform_record_payment', {
    p_agency: input.agencyId,
    p_amount: input.amount,
    p_currency: input.currency ?? 'TND',
    p_period_start: input.periodStart ?? null,
    p_period_end: input.periodEnd ?? null,
    p_method: input.method ?? 'virement',
    p_reference: input.reference ?? null,
    p_note: input.note ?? null,
  })
  if (error) throw new Error(error.message)
  return data as RecordedPayment
}

/** Les règlements d'une agence. C'est ce qu'on relit quand un client dit
 *  « mais j'ai payé ». */
export async function loadAgencyPayments(agencyId: string, limit = 50): Promise<AgencyPayment[]> {
  const { data, error } = await client().rpc('platform_agency_payments', {
    p_agency: agencyId, p_limit: limit,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as AgencyPayment[]
}

/**
 * Rouvrir une agence suspendue sans enregistrer de règlement : le geste de
 * dépannage, quand le virement est parti mais que la référence manque encore.
 *
 * Elle repart en GRÂCE, pas à jour : rien n'a été encaissé. Si le virement
 * n'arrive pas, la balayeuse la suspendra de nouveau dans sept jours, en la
 * prévenant, exactement comme la première fois.
 */
export async function reactivateAgency(agencyId: string, note?: string): Promise<{
  ok: boolean; agency_id: string; etat: 'grace'; grace_ends_on: string
}> {
  const { data, error } = await client().rpc('platform_reactivate_agency', {
    p_agency: agencyId, p_note: note ?? null,
  })
  if (error) throw new Error(error.message)
  return data as { ok: boolean; agency_id: string; etat: 'grace'; grace_ends_on: string }
}

/* ------------------------------------------------------------------ */
/* Les règlements récents, toutes agences confondues                    */
/* ------------------------------------------------------------------ */

/** Une ligne de `subscription_payments` avec le nom de l'agence. */
export interface RecentPayment {
  id: string
  agency_id: string
  agency_name: string | null
  amount: number
  currency: string
  period_start: string
  period_end: string
  method: PaymentMethod
  reference: string | null
  note: string | null
  recorded_at: string
  recorded_by: string | null
  /** Le nom de qui a constaté, quand on a pu le retrouver. */
  recorded_by_name: string | null
}

/** La forme brute que PostgREST rend avec `agencies(name)` : un objet ou un
 *  tableau selon la cardinalité qu'il devine. On accepte les deux. */
interface RecentPaymentRaw {
  id: string
  agency_id: string
  amount: number | string
  currency: string
  period_start: string
  period_end: string
  method: PaymentMethod
  reference: string | null
  note: string | null
  recorded_at: string
  recorded_by: string | null
  agencies: { name: string } | { name: string }[] | null
}

/**
 * Les derniers règlements de toute la plateforme, les plus récents d'abord.
 *
 * Lecture directe de la table : la politique de sélection l'ouvre à l'admin de
 * plateforme. Il n'existe pas de RPC pour cette liste, et en créer une pour
 * un simple `order by recorded_at desc limit n` serait une porte de plus à
 * entretenir. L'écran qui l'appelle doit survivre à un échec : il affiche
 * « · » à la place du chiffre, jamais un écran cassé.
 */
export async function loadRecentPayments(limit = 20): Promise<RecentPayment[]> {
  const { data, error } = await client()
    .from('subscription_payments')
    .select('*, agencies(name)')
    .order('recorded_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  const lignes = (data ?? []) as RecentPaymentRaw[]
  const noms = await nomsDesAuteurs(lignes.map((l) => l.recorded_by).filter((x): x is string => Boolean(x)))
  return lignes.map((l) => ({
    id: l.id,
    agency_id: l.agency_id,
    agency_name: Array.isArray(l.agencies) ? (l.agencies[0]?.name ?? null) : (l.agencies?.name ?? null),
    amount: Number(l.amount),
    currency: l.currency,
    period_start: l.period_start,
    period_end: l.period_end,
    method: l.method,
    reference: l.reference,
    note: l.note,
    recorded_at: l.recorded_at,
    recorded_by: l.recorded_by,
    recorded_by_name: l.recorded_by ? (noms.get(l.recorded_by) ?? null) : null,
  }))
}

/**
 * Qui a constaté un règlement. `recorded_by` pointe vers auth.users, que
 * PostgREST ne sait pas joindre : on relit les noms à part, d'abord dans
 * l'équipe de la plateforme, puis dans les profils. Un échec ici n'est jamais
 * bloquant : on rend ce qu'on a trouvé.
 */
async function nomsDesAuteurs(ids: string[]): Promise<Map<string, string>> {
  const noms = new Map<string, string>()
  const uniques = [...new Set(ids)]
  if (uniques.length === 0) return noms
  for (const table of ['platform_admins', 'profiles'] as const) {
    const manquants = uniques.filter((id) => !noms.has(id))
    if (manquants.length === 0) break
    try {
      const { data } = await client().from(table).select('id, name').in('id', manquants)
      for (const p of (data ?? []) as { id: string; name: string | null }[]) {
        if (p.name) noms.set(p.id, p.name)
      }
    } catch {
      // La table peut ne pas exister encore, ou être fermée : on passe.
    }
  }
  return noms
}

/* ------------------------------------------------------------------ */
/* Les factures de plateforme (0020 / 0027)                             */
/* ------------------------------------------------------------------ */

/** Une ligne de `platform_invoices_list` : la facture d'un mois pour une agence. */
export interface PlatformInvoice {
  agency: string
  slug: string
  /** Le premier jour du mois facturé, en date ISO. */
  period: string
  cases_billed: number
  amount: number
  currency: string
  status: 'brouillon' | 'envoyee' | 'reglee' | 'annulee'
}

/** rpc platform_invoices_list(p_period) : les factures d'un mois, ou toutes si null. */
export async function loadPlatformInvoices(period: string | null): Promise<PlatformInvoice[]> {
  const { data, error } = await client().rpc('platform_invoices_list', { p_period: period })
  if (error) throw new Error(error.message)
  return ((data ?? []) as PlatformInvoice[]).map((i) => ({ ...i, amount: Number(i.amount), cases_billed: Number(i.cases_billed) }))
}

/** rpc platform_generate_invoices(p_period) → le nombre de factures posées ou remises à jour. Null = le mois courant. */
export async function generatePlatformInvoices(period: string | null = null): Promise<number> {
  const { data, error } = await client().rpc('platform_generate_invoices', { p_period: period })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}
