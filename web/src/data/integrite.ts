/* Le module « intégrité des données » parle au serveur en direct.
 *
 * Rien de ce que ce module lit n'entre dans l'instantané du magasin. C'est
 * volontaire : l'historique d'un dossier, les doublons d'une agence et les
 * champs personnalisés d'une fiche ne servent que sur l'écran ouvert, et les
 * charger à l'ouverture de session ferait payer trois requêtes de plus à qui
 * ne les regarde jamais.
 *
 * Deuxième principe, qui vaut règle : AUCUNE VALIDATION N'EST DÉCIDÉE ICI. Le
 * type d'un champ personnalisé, le plafond d'un remboursement, le refus d'une
 * fusion entre deux agences : tout est tranché par le serveur. Ce fichier
 * demande, il ne décide pas. Une règle qui ne vit que dans le navigateur se
 * contourne avec deux lignes de console.
 */

import { HAS_BACKEND, supabase } from '@/lib/supabase'
import { camelKeys } from '@/lib/case'
import { rpc } from './remote'
import type { I18nText } from '@/data/types'

/* ------------------------------------------------------------------ */
/* Le vocabulaire, le même qu'en base                                  */
/* ------------------------------------------------------------------ */

export type EntityKind = 'CLIENT' | 'VISA_CASE' | 'SHIPMENT' | 'LEAD'
export const ENTITY_KINDS: EntityKind[] = ['CLIENT', 'VISA_CASE', 'SHIPMENT', 'LEAD']

export type HistoryKind = EntityKind | 'INVOICE'

export interface StatusChange {
  id: string
  entityKind: HistoryKind
  entityId: string
  field: 'stage' | 'status'
  fromValue: string | null
  toValue: string | null
  changedBy: string | null
  changedAt: string
  location: string | null
  note: string | null
}

export type CustomFieldKind = 'texte' | 'nombre' | 'date' | 'liste' | 'booleen'
export const CUSTOM_FIELD_KINDS: CustomFieldKind[] = ['texte', 'nombre', 'date', 'liste', 'booleen']

export interface CustomField {
  id: string
  agencyId: string
  entityKind: EntityKind
  code: string
  label: I18nText
  kind: CustomFieldKind
  options: string[]
  required: boolean
  position: number
  active: boolean
}

/** Un champ ET sa valeur, tels que l'écran les reçoit en une seule requête. */
export interface CustomValue {
  fieldId: string
  code: string
  label: I18nText
  kind: CustomFieldKind
  options: string[]
  required: boolean
  position: number
  value: string | number | boolean | null
  updatedAt: string | null
}

export interface DuplicateMember {
  id: string
  label: string
  sublabel: string | null
}

export interface DuplicateGroup {
  kind: 'CLIENT' | 'SHIPMENT' | 'COMPANY'
  criterion: string
  value: string | null
  members: DuplicateMember[]
}

/** Le compte rendu d'une fusion. Les clés de `moved` sont des NOMS DE TABLES :
    on ne les renomme pas, c'est exactement ce qui rend le compte rendu
    vérifiable ligne par ligne. */
export interface MergeReport {
  kept: string
  absorbed: string
  reason: string | null
  moved: Record<string, number>
  total: number
  at: string
}

export type NumberingKind = 'client' | 'case' | 'shipment' | 'invoice' | 'quote' | 'receipt'
export const NUMBERING_KINDS: NumberingKind[] = ['case', 'shipment', 'invoice', 'quote', 'receipt', 'client']

export type ResetPeriod = 'jamais' | 'annuel' | 'mensuel'
export const RESET_PERIODS: ResetPeriod[] = ['jamais', 'annuel', 'mensuel']

export interface NumberingRule {
  id: string
  agencyId: string
  kind: NumberingKind
  pattern: string
  resetPeriod: ResetPeriod
  active: boolean
}

export interface Pin {
  userId: string
  agencyId: string
  entityKind: EntityKind
  entityId: string
  pinnedAt: string
}

export interface EntityTag {
  agencyId: string
  entityKind: EntityKind
  entityId: string
  tag: string
  addedBy: string | null
  addedAt: string
}

export interface SearchHit {
  kind: 'client' | 'case' | 'shipment' | 'lead' | 'invoice' | 'quote'
  id: string
  label: string
  sublabel: string | null
  url: string
}

export type RefundStatus = 'demande' | 'approuve' | 'verse' | 'refuse'

export interface Refund {
  id: string
  agencyId: string
  officeId: string | null
  paymentId: string
  amount: number
  currency: string
  reason: string | null
  status: RefundStatus
  createdAt: string
  processedAt: string | null
}

export interface SavedView {
  id: string
  agencyId: string
  userId: string | null
  officeId: string | null
  name: string
  entityKind: string
  filters: Record<string, unknown>
  columns: string[]
  sort: string | null
  shared: boolean
  createdAt: string
}

/* ------------------------------------------------------------------ */
/* Le contexte : l'agence et la personne, lus une seule fois           */
/* ------------------------------------------------------------------ */

let context: { agencyId: string; officeId: string | null; userId: string } | null = null

export async function integriteContext() {
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

/* ------------------------------------------------------------------ */
/* L'historique des statuts                                            */
/* ------------------------------------------------------------------ */

/** Ce que le serveur a écrit tout seul au fil des changements d'étape. Rien
    ne s'ajoute ni ne se corrige d'ici : la table n'accepte que ses propres
    déclencheurs. */
export async function listHistory(entityKind: HistoryKind, entityId: string): Promise<StatusChange[]> {
  if (!HAS_BACKEND || !supabase) return []
  const { data, error } = await supabase
    .from('status_history').select('*')
    .eq('entity_kind', entityKind).eq('entity_id', entityId)
    .order('changed_at', { ascending: false }).limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => camelKeys<StatusChange>(r))
}

/* ------------------------------------------------------------------ */
/* Les champs personnalisés                                            */
/* ------------------------------------------------------------------ */

export async function listCustomFields(entityKind: EntityKind): Promise<CustomField[]> {
  if (!HAS_BACKEND || !supabase) return []
  const { data, error } = await supabase
    .from('custom_fields').select('*')
    .eq('entity_kind', entityKind).order('position')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => camelKeys<CustomField>(r))
}

export type CustomFieldDraft = {
  entityKind: EntityKind
  code: string
  label: I18nText
  kind: CustomFieldKind
  options: string[]
  required: boolean
  position: number
  active: boolean
}

export async function saveCustomField(draft: CustomFieldDraft, id?: string): Promise<void> {
  if (!supabase) throw new Error('backend absent')
  const ctx = await integriteContext()
  const row = {
    agency_id: ctx.agencyId,
    entity_kind: draft.entityKind,
    code: draft.code,
    label: draft.label,
    kind: draft.kind,
    options: draft.options,
    required: draft.required,
    position: draft.position,
    active: draft.active,
  }
  const { error } = id
    ? await supabase.from('custom_fields').update(row).eq('id', id)
    : await supabase.from('custom_fields').insert(row)
  if (error) throw new Error(error.message)
}

/** On désactive au lieu de supprimer : les valeurs déjà saisies restent. */
export async function deactivateCustomField(id: string): Promise<void> {
  if (!supabase) throw new Error('backend absent')
  const { error } = await supabase.from('custom_fields').update({ active: false }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function loadCustomValues(entityKind: EntityKind, entityId: string): Promise<CustomValue[]> {
  if (!HAS_BACKEND) return []
  const raw = await rpc('custom_values', { p_entity_kind: entityKind, p_entity_id: entityId })
  return ((raw ?? []) as unknown[]).map((r) => camelKeys<CustomValue>(r))
}

/** La valeur part en texte : c'est le serveur qui vérifie le type et le
    caractère obligatoire, et qui range la donnée dans la bonne colonne. */
export async function setCustomValue(
  fieldId: string, entityId: string, value: string,
): Promise<CustomValue[]> {
  const raw = await rpc('set_custom_value', {
    p_field: fieldId, p_entity: entityId, p_value: value,
  })
  return ((raw ?? []) as unknown[]).map((r) => camelKeys<CustomValue>(r))
}

/* ------------------------------------------------------------------ */
/* Les doublons et la fusion                                           */
/* ------------------------------------------------------------------ */

export async function scanDuplicates(entityKind: 'CLIENT' | 'SHIPMENT' | 'COMPANY' = 'CLIENT'): Promise<DuplicateGroup[]> {
  if (!HAS_BACKEND) return []
  const ctx = await integriteContext()
  const raw = await rpc('duplicate_scan', { p_agency: ctx.agencyId, p_entity_kind: entityKind })
  return (raw ?? []) as DuplicateGroup[]
}

/** La fusion rend le détail de ce qui a bougé. On ne convertit pas ses clés :
    ce sont des noms de tables, et c'est ce qui la rend vérifiable. */
export async function mergeClients(keep: string, absorb: string, reason: string): Promise<MergeReport> {
  const raw = await rpc('client_merge', { p_keep: keep, p_absorb: absorb, p_reason: reason })
  return raw as MergeReport
}

/* ------------------------------------------------------------------ */
/* Les épingles                                                        */
/* ------------------------------------------------------------------ */

export async function listPins(): Promise<Pin[]> {
  if (!HAS_BACKEND || !supabase) return []
  const { data, error } = await supabase
    .from('pinned_items').select('*').order('pinned_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => camelKeys<Pin>(r))
}

export async function pin(entityKind: EntityKind, entityId: string): Promise<void> {
  if (!supabase) throw new Error('backend absent')
  const ctx = await integriteContext()
  const { error } = await supabase.from('pinned_items').insert({
    user_id: ctx.userId, agency_id: ctx.agencyId, entity_kind: entityKind, entity_id: entityId,
  })
  if (error) throw new Error(error.message)
}

export async function unpin(entityKind: EntityKind, entityId: string): Promise<void> {
  if (!supabase) throw new Error('backend absent')
  const ctx = await integriteContext()
  const { error } = await supabase.from('pinned_items').delete()
    .eq('user_id', ctx.userId).eq('entity_kind', entityKind).eq('entity_id', entityId)
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Les étiquettes des dossiers, cargaisons et prospects                */
/* ------------------------------------------------------------------ */

export async function listTags(entityKind: EntityKind, entityId: string): Promise<EntityTag[]> {
  if (!HAS_BACKEND || !supabase) return []
  const { data, error } = await supabase
    .from('entity_tags').select('*')
    .eq('entity_kind', entityKind).eq('entity_id', entityId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => camelKeys<EntityTag>(r))
}

export async function addTag(entityKind: EntityKind, entityId: string, tag: string): Promise<void> {
  if (!supabase) throw new Error('backend absent')
  const ctx = await integriteContext()
  const { error } = await supabase.from('entity_tags').insert({
    agency_id: ctx.agencyId, entity_kind: entityKind, entity_id: entityId,
    tag: tag.trim(), added_by: ctx.userId,
  })
  if (error) throw new Error(error.message)
}

export async function removeTag(entityKind: EntityKind, entityId: string, tag: string): Promise<void> {
  if (!supabase) throw new Error('backend absent')
  const { error } = await supabase.from('entity_tags').delete()
    .eq('entity_kind', entityKind).eq('entity_id', entityId).eq('tag', tag)
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* La numérotation                                                     */
/* ------------------------------------------------------------------ */

export async function listNumberingRules(): Promise<NumberingRule[]> {
  if (!HAS_BACKEND || !supabase) return []
  const { data, error } = await supabase.from('numbering_rules').select('*').order('kind')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => camelKeys<NumberingRule>(r))
}

export async function saveNumberingRule(
  kind: NumberingKind, pattern: string, resetPeriod: ResetPeriod, active: boolean, id?: string,
): Promise<void> {
  if (!supabase) throw new Error('backend absent')
  const ctx = await integriteContext()
  const row = {
    agency_id: ctx.agencyId, kind, pattern, reset_period: resetPeriod, active,
  }
  const { error } = id
    ? await supabase.from('numbering_rules').update(row).eq('id', id)
    : await supabase.from('numbering_rules').insert(row)
  if (error) throw new Error(error.message)
}

export async function removeNumberingRule(id: string): Promise<void> {
  if (!supabase) throw new Error('backend absent')
  const { error } = await supabase.from('numbering_rules').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** L'aperçu du motif, calculé à l'écran. Il ne consomme AUCUN numéro : tirer
    un vrai numéro pour montrer un exemple laisserait des trous dans la suite,
    et une suite à trous n'est plus une suite. */
export function previewPattern(pattern: string, officeName?: string | null): string {
  const now = new Date()
  const code = (officeName ?? '')
    .replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'AG'
  const yyyy = String(now.getFullYear())
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  let out = pattern
    .replace(/\{OFFICE\}/g, code)
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yyyy.slice(2))
    .replace(/\{MM\}/g, mm)
  const seq = out.match(/\{SEQ:(\d+)\}/)
  if (seq) out = out.replace(/\{SEQ:\d+\}/g, '1'.padStart(Math.min(Number(seq[1]), 12), '0'))
  return out.replace(/\{SEQ\}/g, '0001')
}

/* ------------------------------------------------------------------ */
/* Les remboursements                                                  */
/* ------------------------------------------------------------------ */

export async function listRefunds(paymentId?: string): Promise<Refund[]> {
  if (!HAS_BACKEND || !supabase) return []
  let q = supabase.from('refunds').select('*').order('created_at', { ascending: false })
  if (paymentId) q = q.eq('payment_id', paymentId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => camelKeys<Refund>(r))
}

/** Demander, pas verser. Le serveur refuse tout ce qui dépasse l'encaissé, et
    ne touche jamais au règlement d'origine. */
export function requestRefund(paymentId: string, amount: number, reason: string): Promise<string> {
  return rpc('refund_request', {
    p_payment: paymentId, p_amount: amount, p_reason: reason,
  }) as Promise<string>
}

export async function decideRefund(id: string, status: RefundStatus): Promise<void> {
  if (!supabase) throw new Error('backend absent')
  const ctx = await integriteContext()
  const { error } = await supabase.from('refunds').update({
    status,
    approved_by: status === 'approuve' || status === 'verse' ? ctx.userId : null,
    processed_by: status === 'verse' ? ctx.userId : null,
    processed_at: status === 'verse' ? new Date().toISOString() : null,
  }).eq('id', id)
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Les filtres enregistrés et la recherche                             */
/* ------------------------------------------------------------------ */

export async function listSavedViews(entityKind?: string): Promise<SavedView[]> {
  if (!HAS_BACKEND || !supabase) return []
  let q = supabase.from('saved_views').select('*').order('created_at', { ascending: false })
  if (entityKind) q = q.eq('entity_kind', entityKind)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => camelKeys<SavedView>(r))
}

export async function saveView(
  name: string, entityKind: string, filters: Record<string, unknown>,
  columns: string[], sort: string | null, shared: boolean,
): Promise<void> {
  if (!supabase) throw new Error('backend absent')
  const ctx = await integriteContext()
  const { error } = await supabase.from('saved_views').insert({
    agency_id: ctx.agencyId, user_id: shared ? null : ctx.userId, office_id: ctx.officeId,
    name, entity_kind: entityKind, filters, columns, sort, shared,
  })
  if (error) throw new Error(error.message)
}

export async function removeSavedView(id: string): Promise<void> {
  if (!supabase) throw new Error('backend absent')
  const { error } = await supabase.from('saved_views').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** La recherche unique. Elle est filtrée par le serveur, agence ET bureau :
    l'écran ne refiltre rien, sinon on aurait deux règles à tenir. */
export async function searchEverything(query: string, limit = 20): Promise<SearchHit[]> {
  if (!HAS_BACKEND || query.trim().length < 2) return []
  const raw = await rpc('search_everything', { p_query: query.trim(), p_limit: limit })
  return (raw ?? []) as SearchHit[]
}
