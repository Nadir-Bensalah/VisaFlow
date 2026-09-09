import { supabase, HAS_BACKEND } from '@/lib/supabase'
import type { AgencyUsage } from './usage'

/**
 * LE CONTRAT DE LA CONSOLE PLATEFORME.
 *
 * Ce fichier est la frontière entre la base et les écrans de la console. Les
 * noms de fonctions SQL, leurs arguments et la forme exacte de ce qu'elles
 * rendent sont écrits ICI, une fois. La migration 0068 les implémente à
 * l'identique ; les écrans les consomment à l'identique. Si une forme doit
 * changer, elle change ici d'abord.
 *
 * Toutes les fonctions `platform_*` refusent (42501) un compte qui n'est pas
 * dans `platform_admins` ou qui y est inactif. Les fonctions qui MODIFIENT
 * exigent en plus une capacité (`platform_can`). Les lectures sont ouvertes à
 * tout admin de plateforme, y compris au rôle `lecture`.
 */

/* ------------------------------------------------------------------ */
/* Qui suis-je, et qu'ai-je le droit de faire                          */
/* ------------------------------------------------------------------ */

export type PlatformRole = 'superuser' | 'admin' | 'operateur' | 'facturation' | 'lecture'

export const PLATFORM_ROLES: { code: PlatformRole; label: string; description: string }[] = [
  { code: 'superuser', label: 'Super-administrateur', description: 'Tout, y compris gérer l’équipe de la plateforme et supprimer une agence.' },
  { code: 'admin', label: 'Administrateur', description: 'Tout, sauf gérer l’équipe et supprimer une agence.' },
  { code: 'operateur', label: 'Opérateur', description: 'Les demandes, l’assistance, les annonces, l’entrée en lecture dans une agence.' },
  { code: 'facturation', label: 'Facturation', description: 'Les règlements, les réactivations, les abonnements. Rien d’autre.' },
  { code: 'lecture', label: 'Lecture seule', description: 'Voit tout, ne touche à rien.' },
]

export type PlatformCap =
  | 'agences.ouvrir'      // créer une agence, convertir une demande
  | 'agences.modifier'    // bureaux, membres, coordonnées
  | 'agences.suspendre'   // suspendre / réactiver l'accès
  | 'agences.supprimer'   // marquage de suppression (jamais un DELETE)
  | 'agences.entrer'      // ouvrir une agence en lecture seule (vue support)
  | 'demandes.traiter'    // avancer une demande de souscription
  | 'abonnements.modifier'// plan, sièges, échéance, commission
  | 'facturation.encaisser'// constater un règlement, générer les factures
  | 'facturation.reactiver'// rouvrir une grâce sans encaisser
  | 'assistance.repondre' // tickets, retours
  | 'annonces.publier'
  | 'equipe.gerer'        // inviter, changer un rôle, désactiver un admin
  | 'taches.lancer'       // lancer une tâche planifiée à la main

/** Le rôle → ses capacités. La base porte la même table ; ceci sert à l'écran d'équipe. */
export const ROLE_CAPS: Record<PlatformRole, PlatformCap[]> = {
  superuser: ['agences.ouvrir', 'agences.modifier', 'agences.suspendre', 'agences.supprimer', 'agences.entrer', 'demandes.traiter', 'abonnements.modifier', 'facturation.encaisser', 'facturation.reactiver', 'assistance.repondre', 'annonces.publier', 'equipe.gerer', 'taches.lancer'],
  admin: ['agences.ouvrir', 'agences.modifier', 'agences.suspendre', 'agences.entrer', 'demandes.traiter', 'abonnements.modifier', 'facturation.encaisser', 'facturation.reactiver', 'assistance.repondre', 'annonces.publier', 'taches.lancer'],
  operateur: ['agences.entrer', 'agences.modifier', 'demandes.traiter', 'assistance.repondre', 'annonces.publier'],
  facturation: ['abonnements.modifier', 'facturation.encaisser', 'facturation.reactiver'],
  lecture: [],
}

export interface PlatformMe {
  id: string
  email: string
  name: string
  role: PlatformRole
  superuser: boolean
  active: boolean
  caps: PlatformCap[]
  must_reset_password: boolean
}

/** rpc platform_me() → PlatformMe. Rend null si le compte n'est pas admin de plateforme. */
export async function loadMe(): Promise<PlatformMe | null> {
  const { data, error } = await sb().rpc('platform_me')
  if (error) throw error
  return (data as PlatformMe | null) ?? null
}

/** rpc platform_admin_password_reset_done() : lève le drapeau du mot de passe provisoire. */
export async function passwordResetDone(): Promise<void> {
  const { error } = await sb().rpc('platform_admin_password_reset_done')
  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* Le poste de pilotage                                                */
/* ------------------------------------------------------------------ */

export type Severite = 'critique' | 'attention' | 'info'

export type UrgentKind =
  | 'demande'        // demande de souscription à traiter
  | 'ticket'         // ticket ouvert, urgent ou sans réponse
  | 'suspendue'      // agence suspendue pour impayé
  | 'grace'          // agence en délai de grâce
  | 'essai_fin'      // essai qui finit sous 3 jours
  | 'tache_echouee'  // tâche planifiée en échec
  | 'agence_inactive'// agence active sans aucune activité depuis 14 jours
  | 'quota'          // ressource à 80 % (info) ou à 100 % (attention) ; url /admin/agences/<id>

export interface Urgent {
  kind: UrgentKind
  severity: Severite
  id: string
  agency_id: string | null
  agency_name: string | null
  agency_slug: string | null
  title: string
  detail: string | null
  since: string        // ISO
  days: number | null  // jours restants (grâce, essai) ou jours écoulés (demande, ticket)
  url: string          // chemin de la console, ex. /admin/facturation?agence=<uuid>
}

export interface Point { day: string; n: number }
export interface PointMois { month: string; amount: number }
export interface PointMoisN { month: string; n: number }

export interface Cockpit {
  generated_at: string
  kpis: {
    mrr: number                 // abonnements actifs, sièges × prix mensuel
    arr: number
    mrr_il_y_a_30j: number
    mrr_potentiel: number       // ce que rapporteraient les essais en cours s'ils signaient
    agences_total: number
    agences_actives: number
    agences_suspendues: number
    essais_en_cours: number
    essais_finissant_7j: number
    graces: number
    encaisse_mois: number       // subscription_payments du mois civil
    encaisse_30j: number
    demandes_nouvelles: number
    tickets_ouverts: number
    tickets_urgents: number
    comptes_actifs: number      // profiles.active
    dossiers_ouverts: number
    dossiers_30j: number
    connexions_24h: number      // user_sessions.last_seen_at
    agences_en_depassement: number // au moins une ressource à 100 % (usage_niveau attention ou bloque)
  }
  urgents: Urgent[]
  series: {
    signups_30j: Point[]
    connexions_14j: Point[]
    dossiers_30j: Point[]
    encaisse_12m: PointMois[]
    mrr_12m: PointMois[]
    agences_12m: PointMoisN[]
  }
  activite: AuditRow[]        // les 20 derniers gestes de la plateforme
  taches: TacheRow[]
  sante: {
    taches_en_echec: number
    courriels_echoues_24h: number
    webhooks_echoues_24h: number
    whatsapp_en_attente: number
  }
}

/** rpc platform_cockpit() → Cockpit. Une seule requête pour tout l'écran d'accueil. */
export async function loadCockpit(): Promise<Cockpit> {
  const { data, error } = await sb().rpc('platform_cockpit')
  if (error) throw error
  return data as Cockpit
}

/* ------------------------------------------------------------------ */
/* Le journal de la plateforme                                          */
/* ------------------------------------------------------------------ */

export interface AuditRow {
  id: string
  at: string
  admin_id: string | null
  admin_email: string | null
  admin_name: string | null
  action: AuditAction
  target_kind: 'agence' | 'demande' | 'abonnement' | 'reglement' | 'ticket' | 'annonce' | 'admin' | 'tache' | 'bureau' | 'membre' | 'plateforme'
  target_id: string | null
  target_label: string | null
  detail: Record<string, unknown> | null
}

export type AuditAction =
  | 'agence.ouverte' | 'agence.suspendue' | 'agence.reactivee' | 'agence.supprimee'
  | 'agence.entree_support' | 'agence.modifiee' | 'bureau.enregistre' | 'membre.modifie'
  | 'demande.mise_a_jour' | 'demande.convertie'
  | 'abonnement.modifie' | 'commission.modifiee'
  | 'reglement.enregistre' | 'factures.generees' | 'grace.rouverte'
  | 'ticket.repondu' | 'ticket.statut' | 'retour.traite'
  | 'annonce.enregistree' | 'annonce.publiee'
  | 'admin.invite' | 'admin.role' | 'admin.actif' | 'admin.retire'
  | 'tache.lancee'

/** rpc platform_audit_list(p_limit, p_action, p_agency, p_admin) → AuditRow[] (les plus récents d'abord). */
export async function loadAudit(input: { limit?: number; action?: AuditAction | null; agency?: string | null; admin?: string | null } = {}): Promise<AuditRow[]> {
  const { data, error } = await sb().rpc('platform_audit_list', {
    p_limit: input.limit ?? 100, p_action: input.action ?? null, p_agency: input.agency ?? null, p_admin: input.admin ?? null,
  })
  if (error) throw error
  return (data as AuditRow[] | null) ?? []
}

/* ------------------------------------------------------------------ */
/* Les tâches planifiées                                                */
/* ------------------------------------------------------------------ */

export interface TacheRow {
  job: string            // ex. visaflow_alertes
  schedule: string       // expression cron
  active: boolean
  last_run: string | null
  last_ok: boolean | null
  last_affected: number | null
  last_detail: string | null
}

/** rpc platform_jobs() → TacheRow[] (existe déjà, 0058). */
export async function loadTaches(): Promise<TacheRow[]> {
  const { data, error } = await sb().rpc('platform_jobs')
  if (error) throw error
  return (data as TacheRow[] | null) ?? []
}

/** rpc platform_run_job(p_job) → { ok, affected, detail, ms }. Capacité taches.lancer. */
export async function runTache(job: string): Promise<{ ok: boolean; affected: number | null; detail: string | null; ms: number }> {
  const { data, error } = await sb().rpc('platform_run_job', { p_job: job })
  if (error) throw error
  return data as { ok: boolean; affected: number | null; detail: string | null; ms: number }
}

/* ------------------------------------------------------------------ */
/* L'équipe de la plateforme                                            */
/* ------------------------------------------------------------------ */

export interface AdminRow {
  id: string
  name: string
  email: string
  role: PlatformRole
  active: boolean
  created_at: string
  last_seen_at: string | null
  invited_by_email: string | null
  actions_30j: number
  must_reset_password: boolean
}

/** rpc platform_admins_list() → AdminRow[]. */
export async function loadAdmins(): Promise<AdminRow[]> {
  const { data, error } = await sb().rpc('platform_admins_list')
  if (error) throw error
  return (data as AdminRow[] | null) ?? []
}

/** rpc platform_admin_set_role(p_admin, p_role). Capacité equipe.gerer ; le rôle superuser ne se donne que par un superuser ; on ne se rétrograde pas soi-même ; le dernier superuser reste. */
export async function setAdminRole(adminId: string, role: PlatformRole): Promise<void> {
  const { error } = await sb().rpc('platform_admin_set_role', { p_admin: adminId, p_role: role })
  if (error) throw error
}

/** rpc platform_admin_set_active(p_admin, p_active). Capacité equipe.gerer ; jamais soi-même ; jamais le dernier superuser actif. */
export async function setAdminActive(adminId: string, active: boolean): Promise<void> {
  const { error } = await sb().rpc('platform_admin_set_active', { p_admin: adminId, p_active: active })
  if (error) throw error
}

/** rpc platform_admin_remove(p_admin). Superuser seulement ; jamais soi-même. Retire la ligne, le compte de connexion reste (il ne donne plus accès à rien). */
export async function removeAdmin(adminId: string): Promise<void> {
  const { error } = await sb().rpc('platform_admin_remove', { p_admin: adminId })
  if (error) throw error
}

export interface InviteAdminResult { userId: string; email: string; tempPassword: string }

/**
 * Fonction de bord invite-user, corps { platform: true, name, email, role }.
 * Le compte naît avec un mot de passe provisoire rendu UNE fois. Capacité
 * equipe.gerer ; le rôle superuser exige d'être superuser.
 */
export async function inviteAdmin(input: { name: string; email: string; role: PlatformRole }): Promise<InviteAdminResult> {
  if (!HAS_BACKEND || !supabase) throw new Error('demo')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('session')
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ platform: true, name: input.name, email: input.email.toLowerCase(), role: input.role }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`))
  return { userId: String(body.user_id), email: String(body.email), tempPassword: String(body.temp_password) }
}

/* ------------------------------------------------------------------ */
/* Une agence, à 360 degrés                                             */
/* ------------------------------------------------------------------ */

export interface Agence360 {
  agence: {
    id: string; slug: string; name: string; country: string; city: string | null; phone: string | null
    email: string | null; plan: string; created_at: string; suspended_at: string | null; deleted_at: string | null
    commission_kind: string; commission_amount: number; work_mode: string | null
  }
  acces: {
    etat: 'essai' | 'grace' | 'a_jour' | 'suspendue'
    jours_restants: number | null
    trial_ends_on: string | null
    grace_ends_on: string | null
    renewal_on: string | null
    coupee: boolean
    bloquant: boolean
  }
  abonnement: {
    id: string | null
    plan_code: string | null; plan_name: string | null
    status: string | null; billing_state: string | null
    seats: number | null; price_per_user_month: number | null; billing_period: string | null; currency: string | null
    started_on: string | null; renewal_on: string | null
    trial_ends_on: string | null; grace_ends_on: string | null; last_payment_on: string | null
    mensuel: number | null   // ce que vaut l'abonnement par mois, tel que la base le calcule
    /* La grille du 9 septembre 2026 (0070) : les ajouts, les montants, la facture. Additif. */
    extra_users: number | null
    extra_offices: number | null
    monthly_amount: number | null
    annual_amount: number | null
    invoice_totals: {
      currency: string; ht: number; tva_rate: number; tva: number; ttc: number
      withholding_rate: number; retenue: number; net_a_payer: number; period: string; monthly: number
    } | null
    seats_allowed: number | null
  }
  bureaux: { id: string; name: string; city: string | null; active: boolean; members: number }[]
  membres: { id: string; name: string; email: string; role: string; active: boolean; office_name: string | null; last_sign_in_at: string | null }[]
  compteurs: { clients: number; cases_open: number; cases_total: number; shipments_open: number; documents: number; storage_bytes: number; connexions_7j: number }
  reglements: { id: string; paid_on: string; amount: number; currency: string; method: string; reference: string | null; period_start: string | null; period_end: string | null; recorded_by_email: string | null }[]
  tickets: { id: string; subject: string; priority: string; status: string; created_at: string }[]
  journal: AuditRow[]
  activite_30j: Point[]
  /** La même forme que `agency_usage`, comptée en direct. Absente sur une base antérieure. */
  usage?: AgencyUsage | null
}

/** rpc platform_agency_360(p_agency) → Agence360. */
export async function loadAgence360(agencyId: string): Promise<Agence360> {
  const { data, error } = await sb().rpc('platform_agency_360', { p_agency: agencyId })
  if (error) throw error
  return data as Agence360
}

/** rpc platform_delete_agency(p_agency, p_confirm) : p_confirm doit être le nom exact de l'agence. Capacité agences.supprimer. Marquage, jamais un DELETE. */
export async function deleteAgence(agencyId: string, confirmName: string): Promise<void> {
  const { error } = await sb().rpc('platform_delete_agency', { p_agency: agencyId, p_confirm: confirmName })
  if (error) throw error
}

/** rpc platform_signup_link(p_signup, p_agency) : rattache une demande à l'agence née d'elle et la passe en « convertie ». Capacité demandes.traiter. */
export async function linkSignup(signupId: string, agencyId: string): Promise<void> {
  const { error } = await sb().rpc('platform_signup_link', { p_signup: signupId, p_agency: agencyId })
  if (error) throw error
}

/* ------------------------------------------------------------------ */

function sb() {
  if (!HAS_BACKEND || !supabase) throw new Error('La console n’existe qu’avec un backend.')
  return supabase
}
