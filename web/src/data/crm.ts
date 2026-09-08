import { HAS_BACKEND, supabase } from '@/lib/supabase'
import { camelKeys } from '@/lib/case'
import { insert, patch, rpc } from './remote'

/* Le module commercial parle au serveur directement, sans passer par le
   magasin global. Deux raisons : l'instantané de l'agence est déjà lourd, et
   le pipeline change plusieurs fois par heure alors que le reste ne bouge pas
   de la journée.

   Sans backend configuré, chaque lecture rend vide. On ne fabrique jamais de
   faux prospects : un tableau de bord commercial rempli de démonstration est
   pire qu'un tableau vide, on finit par le croire. */

/* ------------------------------------------------------------------ */
/* Le vocabulaire, le même qu'en base                                  */
/* ------------------------------------------------------------------ */

export type LeadStatus =
  | 'nouveau' | 'contacte' | 'qualifie' | 'rendez_vous'
  | 'devis_envoye' | 'relance' | 'gagne' | 'perdu'

export const LEAD_STATUSES: LeadStatus[] = [
  'nouveau', 'contacte', 'qualifie', 'rendez_vous',
  'devis_envoye', 'relance', 'gagne', 'perdu',
]

/** Les colonnes du tableau : gagné et perdu sont des issues, pas des étapes. */
export const LEAD_OPEN_STATUSES: LeadStatus[] = LEAD_STATUSES.filter(
  (s) => s !== 'gagne' && s !== 'perdu',
)

export type LeadService = 'visa' | 'import' | 'export' | 'transit' | 'shipping' | 'autre'
export const LEAD_SERVICES: LeadService[] = ['visa', 'import', 'export', 'transit', 'shipping', 'autre']

export type LeadSource =
  | 'facebook' | 'instagram' | 'tiktok' | 'site' | 'whatsapp'
  | 'comptoir' | 'recommandation' | 'google' | 'telephone' | 'autre'
export const LEAD_SOURCES: LeadSource[] = [
  'facebook', 'instagram', 'tiktok', 'site', 'whatsapp',
  'comptoir', 'recommandation', 'google', 'telephone', 'autre',
]

export type LeadEventKind = 'appel' | 'whatsapp' | 'email' | 'visite' | 'note' | 'changement_etat'
export const LEAD_EVENT_KINDS: LeadEventKind[] = ['appel', 'whatsapp', 'email', 'visite', 'note']

export type ContactKind = 'principal' | 'comptable' | 'logistique' | 'urgence' | 'autre'
export const CONTACT_KINDS: ContactKind[] = ['principal', 'comptable', 'logistique', 'urgence', 'autre']

export interface Lead {
  id: string
  agencyId: string
  officeId?: string | null
  assignedUserId?: string | null
  firstName?: string | null
  lastName?: string | null
  companyName?: string | null
  email?: string | null
  phone?: string | null
  whatsapp?: string | null
  serviceInterest: LeadService
  source: LeadSource
  status: LeadStatus
  estimatedValue: number
  currency: string
  lostReason?: string | null
  note?: string | null
  clientId?: string | null
  requestId?: string | null
  nextActionAt?: string | null
  statusSince: string
  convertedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface LeadEvent {
  id: string
  agencyId: string
  leadId: string
  kind: LeadEventKind
  body?: string | null
  at: string
  authorId?: string | null
}

export interface ClientCompany {
  id: string
  agencyId: string
  officeId?: string | null
  clientId: string
  companyName: string
  legalName?: string | null
  taxId?: string | null
  customsIdentifier?: string | null
  commercialRegister?: string | null
  activitySector?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
  whatsapp?: string | null
  billingAddress?: string | null
  shippingAddress?: string | null
  country?: string | null
  note?: string | null
}

export interface ClientContact {
  id: string
  agencyId: string
  clientId: string
  kind: ContactKind
  name: string
  relationship?: string | null
  email?: string | null
  phone?: string | null
  whatsapp?: string | null
  isPrimary: boolean
  note?: string | null
}

export interface TagDef {
  id: string
  agencyId: string
  label: string
  color: string
}

export interface PipelineBucket {
  status: LeadStatus
  count: number
  value: number
  oldest_at: string | null
}

export interface PipelineReport {
  office: string | null
  total: number
  total_value: number
  by_status: PipelineBucket[]
}

export interface CrmStats {
  from: string
  to: string
  office: string | null
  entries: number
  conversions: number
  conversion_rate: number
  won_value: number
  lost_value: number
  lost_reasons: { reason: string; count: number }[]
  /** Nul tant qu'aucune conversion n'a eu lieu : on ne rend pas zéro jour. */
  avg_days_to_convert: number | null
}

export interface FollowLead {
  id: string
  first_name: string | null
  last_name: string | null
  company_name: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  status: LeadStatus
  service_interest: LeadService
  source: LeadSource
  estimated_value: number
  currency: string
  next_action_at: string | null
  last_event_at: string
  silent_days: number
  assigned_user_id: string | null
  office_id: string | null
}

/* ------------------------------------------------------------------ */
/* Qui écrit, et pour quelle agence                                    */
/* ------------------------------------------------------------------ */

/* Une insertion a besoin de l'agence : c'est la colonne que la politique
   compare. On la lit une fois par session, pas à chaque ligne. */
let context: { agencyId: string; officeId: string | null; userId: string } | null = null

export async function crmContext() {
  if (context) return context
  if (!supabase) throw new Error('backend absent')
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('sans session')
  const { data: prof, error } = await supabase
    .from('profiles').select('agency_id, office_id').eq('id', data.user.id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!prof) throw new Error('sans profil')
  context = { agencyId: prof.agency_id, officeId: prof.office_id, userId: data.user.id }
  return context
}

async function select<T>(table: string, build: (q: any) => any): Promise<T[]> {
  if (!HAS_BACKEND || !supabase) return []
  const { data, error } = await build(supabase.from(table).select('*'))
  if (error) throw new Error(`${table}: ${error.message}`)
  return (data ?? []).map((r: unknown) => camelKeys<T>(r))
}

/* ------------------------------------------------------------------ */
/* Les prospects                                                       */
/* ------------------------------------------------------------------ */

export function listLeads(): Promise<Lead[]> {
  return select<Lead>('leads', (q) => q.is('deleted_at', null).order('created_at', { ascending: false }))
}

export function listLeadEvents(leadId: string): Promise<LeadEvent[]> {
  return select<LeadEvent>('lead_events', (q) => q.eq('lead_id', leadId).order('at', { ascending: false }))
}

export type LeadDraft = Partial<Omit<Lead, 'id' | 'agencyId' | 'createdAt' | 'updatedAt' | 'statusSince'>>

export async function createLead(draft: LeadDraft): Promise<Lead> {
  const ctx = await crmContext()
  return insert('leads', {
    agencyId: ctx.agencyId,
    officeId: draft.officeId ?? ctx.officeId,
    assignedUserId: draft.assignedUserId ?? ctx.userId,
    ...draft,
  }) as Promise<Lead>
}

export async function updateLead(id: string, changes: LeadDraft): Promise<void> {
  await patch('leads', id, changes as Record<string, unknown>)
}

/** Le changement d'état écrit son événement côté serveur : rien à faire ici. */
export async function setLeadStatus(id: string, status: LeadStatus, lostReason?: string): Promise<void> {
  await patch('leads', id, {
    status,
    lostReason: status === 'perdu' ? (lostReason ?? null) : null,
  })
}

/** Ranger une affaire sans l'effacer : la base ne connaît pas la suppression. */
export async function archiveLead(id: string): Promise<void> {
  await patch('leads', id, { deleted_at: new Date().toISOString() })
}

export async function addLeadEvent(leadId: string, kind: LeadEventKind, body: string): Promise<LeadEvent> {
  const ctx = await crmContext()
  return insert('lead_events', {
    agencyId: ctx.agencyId, leadId, kind, body, authorId: ctx.userId,
  }) as Promise<LeadEvent>
}

/** Rend l'identifiant du client créé, ou retrouvé par son numéro. */
export function convertLead(leadId: string, officeId?: string | null): Promise<string> {
  return rpc('lead_convert', { p_lead: leadId, p_office: officeId ?? null }) as Promise<string>
}

/** Une demande du formulaire public devient un prospect qualifiable. */
export function leadFromRequest(requestId: string): Promise<string> {
  return rpc('lead_from_request', { p_request: requestId }) as Promise<string>
}

/* ------------------------------------------------------------------ */
/* Les chiffres                                                        */
/* ------------------------------------------------------------------ */

export async function loadPipeline(officeId?: string | null): Promise<PipelineReport | null> {
  if (!HAS_BACKEND) return null
  return await rpc('crm_pipeline', { p_office: officeId ?? null }) as PipelineReport
}

export async function loadStats(
  officeId?: string | null, from?: string, to?: string,
): Promise<CrmStats | null> {
  if (!HAS_BACKEND) return null
  return await rpc('crm_stats', {
    p_office: officeId ?? null, p_from: from ?? null, p_to: to ?? null,
  }) as CrmStats
}

export async function loadToFollow(officeId?: string | null, limit = 20): Promise<FollowLead[]> {
  if (!HAS_BACKEND) return []
  return await rpc('leads_to_follow', { p_office: officeId ?? null, p_limit: limit }) as FollowLead[]
}

/* ------------------------------------------------------------------ */
/* La fiche société                                                    */
/* ------------------------------------------------------------------ */

export async function loadCompany(clientId: string): Promise<ClientCompany | null> {
  const rows = await select<ClientCompany>('client_companies', (q) =>
    q.eq('client_id', clientId).is('deleted_at', null).limit(1))
  return rows[0] ?? null
}

export type CompanyDraft = Partial<Omit<ClientCompany, 'id' | 'agencyId' | 'clientId'>>

export async function saveCompany(
  clientId: string, existingId: string | null, draft: CompanyDraft,
): Promise<void> {
  if (existingId) {
    await patch('client_companies', existingId, draft as Record<string, unknown>)
    return
  }
  const ctx = await crmContext()
  await insert('client_companies', {
    agencyId: ctx.agencyId, officeId: ctx.officeId, clientId, ...draft,
  })
}

/* ------------------------------------------------------------------ */
/* Les contacts                                                        */
/* ------------------------------------------------------------------ */

export function listContacts(clientId: string): Promise<ClientContact[]> {
  return select<ClientContact>('client_contacts', (q) =>
    q.eq('client_id', clientId).is('deleted_at', null)
      .order('is_primary', { ascending: false }).order('name'))
}

export type ContactDraft = Partial<Omit<ClientContact, 'id' | 'agencyId' | 'clientId'>>

export async function saveContact(
  clientId: string, existingId: string | null, draft: ContactDraft,
): Promise<void> {
  if (existingId) {
    await patch('client_contacts', existingId, draft as Record<string, unknown>)
    return
  }
  const ctx = await crmContext()
  await insert('client_contacts', { agencyId: ctx.agencyId, clientId, ...draft })
}

export async function archiveContact(id: string): Promise<void> {
  await patch('client_contacts', id, { deleted_at: new Date().toISOString(), is_primary: false })
}

/* Un seul contact principal par client : la base le garantit par un index.
   On retire donc l'ancien AVANT de poser le nouveau, sinon l'écriture est
   refusée et l'agent ne comprend pas pourquoi. */
export async function makePrimary(clientId: string, contactId: string): Promise<void> {
  const current = await listContacts(clientId)
  for (const c of current) {
    if (c.isPrimary && c.id !== contactId) await patch('client_contacts', c.id, { is_primary: false })
  }
  await patch('client_contacts', contactId, { is_primary: true })
}

/* ------------------------------------------------------------------ */
/* Les étiquettes                                                      */
/* ------------------------------------------------------------------ */

export function listTagDefs(): Promise<TagDef[]> {
  return select<TagDef>('client_tag_defs', (q) => q.is('deleted_at', null).order('label'))
}

export async function createTagDef(label: string, color: string): Promise<TagDef> {
  const ctx = await crmContext()
  return insert('client_tag_defs', { agencyId: ctx.agencyId, label, color }) as Promise<TagDef>
}

export async function archiveTagDef(id: string): Promise<void> {
  await patch('client_tag_defs', id, { deleted_at: new Date().toISOString() })
}

/** Les étiquettes posées sur un client, lues à la source. */
export async function loadClientTags(clientId: string): Promise<string[]> {
  if (!HAS_BACKEND || !supabase) return []
  const { data, error } = await supabase
    .from('clients').select('tags').eq('id', clientId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.tags as string[] | null) ?? []
}

/** La colonne `clients.tags` existe déjà : on l'écrit, on ne la remplace pas. */
export async function setClientTags(clientId: string, tags: string[]): Promise<void> {
  await patch('clients', clientId, { tags })
}
