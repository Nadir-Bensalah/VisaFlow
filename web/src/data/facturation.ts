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
