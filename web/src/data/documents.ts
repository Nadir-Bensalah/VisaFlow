/* Tous les appels du module documents, import et export.
 *
 * Le magasin global charge déjà trente-trois tables à l'ouverture de session.
 * Les modèles d'impression, le journal des imports et le registre des documents
 * produits n'ont rien à y faire : on ne les lit que dans les Réglages et au
 * moment d'imprimer. Ils se lisent donc ici, à la demande.
 *
 * Sans backend configuré (la démonstration servie par GitHub Pages), les
 * lectures rendent vide et les écritures refusent proprement. On ne fabrique
 * jamais de faux modèles ni de faux imports : un journal d'imports rempli de
 * démonstration finirait par être pris pour vrai.
 */

import { HAS_BACKEND, supabase } from '@/lib/supabase'
import type { DocumentKind, DocumentPayload, DocLocale } from '@/lib/pdf'

export type { DocumentKind, DocumentPayload, DocLocale }

export const DOCUMENT_KINDS: DocumentKind[] = [
  'devis', 'facture', 'recu', 'checklist', 'bon_livraison',
  'fiche_client', 'fiche_dossier', 'cargaison', 'rapport',
]

export type ImportEntity =
  | 'clients' | 'prospects' | 'dossiers' | 'factures' | 'contacts' | 'cargaisons'

export const IMPORT_ENTITIES: ImportEntity[] = [
  'clients', 'prospects', 'dossiers', 'factures', 'contacts', 'cargaisons',
]

export type ImportStatus = 'analyse' | 'pret' | 'en_cours' | 'termine' | 'echoue'

export interface DocumentTemplate {
  id: string
  agencyId: string
  kind: DocumentKind
  name: string
  locale: DocLocale
  headerHtml: string | null
  footerHtml: string | null
  css: string | null
  logoPosition: 'gauche' | 'centre' | 'droite' | 'aucun'
  showStamp: boolean
  legalMentions: string | null
  active: boolean
  createdAt: string
}

export interface GeneratedDocument {
  id: string
  kind: DocumentKind
  entityKind: string
  entityId: string | null
  number: string | null
  locale: DocLocale
  sha256: string | null
  generatedBy: string | null
  generatedAt: string
}

export interface ImportJob {
  id: string
  entityKind: ImportEntity
  fileName: string
  totalRows: number
  importedRows: number
  skippedRows: number
  errors: { row: number; reason: string }[]
  status: ImportStatus
  createdAt: string
  finishedAt: string | null
}

function sb() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

type Row = Record<string, any>

/* ------------------------------------------------------------------ */
/* Le contenu d'un document                                            */
/* ------------------------------------------------------------------ */

/**
 * UN SEUL aller-retour. La fonction serveur est en SECURITY INVOKER : si la
 * personne ne voit pas le dossier, elle ne l'imprime pas, et l'erreur remonte
 * ici. On ne rattrape pas ce refus, il est le but.
 */
export async function fetchPayload(kind: DocumentKind, entityId: string | null): Promise<DocumentPayload> {
  if (!HAS_BACKEND) throw new Error('offline')
  const { data, error } = await sb().rpc('document_payload', { p_kind: kind, p_entity: entityId })
  if (error) throw new Error(error.message)
  return data as DocumentPayload
}

/** La trace. Elle échoue en silence : une impression réussie ne doit pas
    passer pour un échec parce que la trace n'est pas partie. L'appelant est
    prévenu par le retour null, et l'écran le dit. */
export async function traceDocument(input: {
  kind: DocumentKind
  entityKind: string
  entityId: string | null
  number?: string | null
  locale: DocLocale
  sha256?: string | null
  officeId?: string | null
}): Promise<string | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('document_trace', {
    p_kind: input.kind, p_entity_kind: input.entityKind, p_entity: input.entityId,
    p_number: input.number ?? null, p_locale: input.locale,
    p_sha256: input.sha256 ?? null, p_storage_path: null,
    p_office: input.officeId ?? null,
  })
  if (error) return null
  return data as string
}

export async function listGenerated(limit = 50): Promise<GeneratedDocument[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb()
    .from('generated_documents')
    .select('id, kind, entity_kind, entity_id, number, locale, sha256, generated_by, generated_at')
    .order('generated_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: Row) => ({
    id: r.id, kind: r.kind, entityKind: r.entity_kind, entityId: r.entity_id,
    number: r.number, locale: r.locale, sha256: r.sha256,
    generatedBy: r.generated_by, generatedAt: r.generated_at,
  }))
}

/* ------------------------------------------------------------------ */
/* Les modèles                                                         */
/* ------------------------------------------------------------------ */

const toTemplate = (r: Row): DocumentTemplate => ({
  id: r.id, agencyId: r.agency_id, kind: r.kind, name: r.name, locale: r.locale,
  headerHtml: r.header_html, footerHtml: r.footer_html, css: r.css,
  logoPosition: r.logo_position, showStamp: r.show_stamp,
  legalMentions: r.legal_mentions, active: r.active, createdAt: r.created_at,
})

export async function listTemplates(): Promise<DocumentTemplate[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb()
    .from('document_templates').select('*').order('kind').order('locale')
  if (error) throw new Error(error.message)
  return (data ?? []).map(toTemplate)
}

export interface TemplateDraft {
  kind: DocumentKind
  name: string
  locale: DocLocale
  headerHtml: string | null
  footerHtml: string | null
  css: string | null
  logoPosition: 'gauche' | 'centre' | 'droite' | 'aucun'
  showStamp: boolean
  legalMentions: string | null
  active: boolean
}

export async function saveTemplate(agencyId: string, draft: TemplateDraft, id?: string): Promise<DocumentTemplate> {
  const row = {
    agency_id: agencyId, kind: draft.kind, name: draft.name, locale: draft.locale,
    header_html: draft.headerHtml, footer_html: draft.footerHtml, css: draft.css,
    logo_position: draft.logoPosition, show_stamp: draft.showStamp,
    legal_mentions: draft.legalMentions, active: draft.active,
  }
  const query = id
    ? sb().from('document_templates').update(row).eq('id', id).select().single()
    : sb().from('document_templates').insert(row).select().single()
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return toTemplate(data)
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await sb().from('document_templates').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* L'import                                                            */
/* ------------------------------------------------------------------ */

export async function createImportJob(input: {
  agencyId: string
  officeId: string | null
  entityKind: ImportEntity
  fileName: string
  totalRows: number
  mapping: Record<string, number>
}): Promise<string | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().from('import_jobs').insert({
    agency_id: input.agencyId, office_id: input.officeId,
    entity_kind: input.entityKind, file_name: input.fileName,
    total_rows: input.totalRows, mapping: input.mapping, status: 'en_cours',
  }).select('id').single()
  if (error) throw new Error(error.message)
  return data.id as string
}

export async function finishImportJob(
  jobId: string, status: ImportStatus, imported: number, skipped: number,
  errors: { row: number; reason: string }[],
): Promise<void> {
  if (!HAS_BACKEND) return
  const { error } = await sb().rpc('import_job_finish', {
    p_job: jobId, p_status: status, p_imported: imported,
    p_skipped: skipped, p_errors: errors,
  })
  if (error) throw new Error(error.message)
}

export async function listImportJobs(limit = 20): Promise<ImportJob[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb()
    .from('import_jobs').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: Row) => ({
    id: r.id, entityKind: r.entity_kind, fileName: r.file_name,
    totalRows: r.total_rows, importedRows: r.imported_rows, skippedRows: r.skipped_rows,
    errors: r.errors ?? [], status: r.status, createdAt: r.created_at,
    finishedAt: r.finished_at,
  }))
}

/** Les doublons possibles d'un client, AVANT d'écrire. La fonction est celle de
    la migration 0039 : téléphone sur ses huit derniers chiffres, passeport plus
    date de naissance, nom arabe normalisé plus date de naissance. */
export interface DuplicateHit {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  motif: string
}

export async function findClientDuplicates(agencyId: string, probe: {
  passport?: string | null
  birth?: string | null
  phone?: string | null
  native?: string | null
}): Promise<DuplicateHit[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().rpc('client_duplicates', {
    p_agency: agencyId,
    p_passport: probe.passport || null,
    p_birth: probe.birth || null,
    p_phone: probe.phone || null,
    p_native: probe.native || null,
    p_exclude: null,
  })
  if (error) return []
  return (data ?? []) as DuplicateHit[]
}

/** L'écriture, par paquets. Un insert de trois cents lignes en un seul appel
    échoue en entier sur une seule ligne fautive : on découpe pour que les
    lignes valables entrent quand même, et on rend le détail des refus. */
export async function insertRows(
  table: string, rows: Record<string, unknown>[], chunk = 50,
): Promise<{ imported: number; errors: { row: number; reason: string }[] }> {
  if (!HAS_BACKEND) throw new Error('offline')
  let imported = 0
  const errors: { row: number; reason: string }[] = []
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk)
    const { error } = await sb().from(table).insert(slice)
    if (!error) { imported += slice.length; continue }
    // Le paquet est refusé : on repasse ligne à ligne pour savoir laquelle.
    for (let j = 0; j < slice.length; j++) {
      const one = await sb().from(table).insert(slice[j])
      if (one.error) errors.push({ row: i + j + 1, reason: one.error.message })
      else imported++
    }
  }
  return { imported, errors }
}

/* ------------------------------------------------------------------ */
/* La trace des exports                                                */
/* ------------------------------------------------------------------ */

/**
 * Un export non tracé est un incident invisible : le jour où une liste de
 * clients circule, personne ne peut dire si elle est sortie d'ici, ni par qui.
 *
 * `data_export_note` vient de la migration 0050, écrite en parallèle. Elle peut
 * donc ne pas être en place : on retombe alors sur une ligne dans
 * `activity_events`, qui existe depuis la 0008. Jamais rien : un export sans
 * aucune trace ne doit pas exister.
 */
export async function noteExport(scope: string, agencyId?: string): Promise<boolean> {
  if (!HAS_BACKEND) return false
  const { error } = await sb().rpc('data_export_note', { p_scope: scope })
  if (!error) return true
  if (!agencyId) return false
  const fallback = await sb().from('activity_events').insert({
    agency_id: agencyId,
    type: 'export_donnees',
    detail: { fr: `Export de ${scope}.`, scope },
    automated: false,
  })
  return !fallback.error
}
