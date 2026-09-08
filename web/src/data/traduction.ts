/* Le module de traduction parle au serveur en direct.
 *
 * Le magasin global charge déjà toutes les tables du métier à l'ouverture de
 * session. Y ajouter les traducteurs, les traductions confiées et leurs dates
 * ferait payer ce chargement à tout le monde, y compris à qui n'ouvre jamais
 * ces écrans. Les pages du module lisent donc ici, à la demande.
 *
 * DEUX RÈGLES, ET ELLES NE SE DISCUTENT PAS.
 *
 * 1. AUCUNE MARGE N'EST CALCULÉE ICI. La marge descend du serveur, où elle est
 *    une colonne calculée par la base. Un chiffre d'argent recalculé dans le
 *    navigateur finit toujours par diverger de celui de la base, et c'est
 *    celui de la base que le patron regardera.
 *
 * 2. ON NE DEMANDE JAMAIS `select *` SUR LES TRADUCTIONS. Le coût, le taux de
 *    change et la marge sont fermés au niveau de la COLONNE, pour tout le
 *    monde : une étoile ferait échouer la requête entière, et l'écran se
 *    viderait sans qu'on comprenne pourquoi. On nomme donc les colonnes, et
 *    les chiffres réservés passent par les fonctions qui vérifient le droit.
 */

import { supabase, HAS_BACKEND } from '@/lib/supabase'
import type { I18nText } from '@/data/types'

/* ------------------------------------------------------------------ */
/* Les formes                                                          */
/* ------------------------------------------------------------------ */

export type TranslatorKind = 'interne' | 'externe' | 'bureau'

export const TRANSLATOR_KINDS: TranslatorKind[] = ['interne', 'externe', 'bureau']

export interface Translator {
  id: string
  agencyId: string
  officeId: string | null
  name: string
  kind: TranslatorKind
  sworn: boolean
  swornCourt: string | null
  /** Les couples traités, forme « fr>ar ». */
  languages: string[]
  phone: string | null
  email: string | null
  address: string | null
  /** Saisi par l'agence. Aucun tarif n'est livré avec le produit. */
  ratePerPage: number | null
  rateCurrency: string | null
  /** Ce que le traducteur ANNONCE. Le délai constaté vient de TranslatorStats. */
  leadTimeDays: number | null
  active: boolean
  note: string | null
  createdAt: string
}

export type TranslationStatus =
  | 'a_commander' | 'commandee' | 'en_cours' | 'livree' | 'remise_client' | 'annulee'

export const TRANSLATION_STATUSES: TranslationStatus[] = [
  'a_commander', 'commandee', 'en_cours', 'livree', 'remise_client', 'annulee',
]

/** Une traduction confiée. Ni coût ni marge : ils ne sortent pas de la table. */
export interface TranslationOrder {
  id: string
  agencyId: string
  officeId: string | null
  caseId: string | null
  clientId: string | null
  documentId: string | null
  documentKind: string
  orderNumber: string
  translatorId: string | null
  sourceLang: string | null
  targetLang: string | null
  swornRequired: boolean
  pages: number | null
  words: number | null
  status: TranslationStatus
  orderedAt: string | null
  promisedAt: string | null
  deliveredAt: string | null
  handedAt: string | null
  soldAmount: number | null
  currency: string
  sourcePath: string | null
  translatedPath: string | null
  note: string | null
  createdAt: string
}

/** Le coût et la marge d'une traduction. Réservés à finance:global. */
export interface TranslationCosts {
  soldAmount: number | null
  costAmount: number | null
  margin: number | null
  currency: string
  fxRate: number
}

export interface LateTranslation {
  orderId: string
  orderNumber: string
  caseId: string | null
  documentId: string | null
  translatorId: string | null
  translatorName: string | null
  sourceLang: string | null
  targetLang: string | null
  promisedAt: string
  daysLate: number
  status: TranslationStatus
}

export interface MarginRow {
  translatorId: string | null
  translatorName: string | null
  sourceLang: string | null
  targetLang: string | null
  currency: string
  orders: number
  pages: number
  sold: number
  cost: number
  margin: number
}

/**
 * Les chiffres bruts d'un traducteur. Pas de score, pas de note : chaque
 * chiffre porte sa taille d'échantillon, et rien n'est estimé.
 */
export interface TranslatorStats {
  translatorId: string
  name: string
  orders: number
  delivered: number
  /** Vide tant que rien n'est livré : une moyenne sur zéro n'existe pas. */
  avgDays: number | null
  avgDaysOn: number
  late: number
  lateOn: number
  lateRate: number | null
  /** Absente sans finance:global. */
  avgMargin: number | null
  avgMarginOn: number
  currency: string | null
}

/** La pièce d'un dossier, telle que le bloc « Traductions » l'affiche. */
export interface CaseTranslationPiece {
  documentId: string
  key: string
  label: I18nText
  state: string
  needsTranslation: boolean
  order: {
    id: string
    orderNumber: string
    status: TranslationStatus
    translatorId: string | null
    translatorName: string | null
    sourceLang: string | null
    targetLang: string | null
    swornRequired: boolean
    pages: number | null
    orderedAt: string | null
    promisedAt: string | null
    deliveredAt: string | null
    handedAt: string | null
    soldAmount: number | null
    currency: string
    translatedPath: string | null
    late: boolean
  } | null
}

export interface CaseTranslations {
  total: number
  livrees: number
  enRetard: number
  toutesLivrees: boolean
  pieces: CaseTranslationPiece[]
}

/** Une pièce du dossier, dans sa forme la plus courte : pour la cocher. */
export interface CasePiece {
  id: string
  key: string
  label: I18nText
  state: string
  needsTranslation: boolean
  translationOrderId: string | null
}

export interface Language {
  code: string
  nameFr: string
  nameEn: string
  nameAr: string
  rtl: boolean
  active: boolean
}

/* ------------------------------------------------------------------ */
/* Le pont snake_case / camelCase, limité à ce module                  */
/* ------------------------------------------------------------------ */

function sb() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

type Row = Record<string, any>

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const maybe = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/* Les colonnes lisibles d'une traduction. Le coût, le taux et la marge n'y
   sont pas : ils sont fermés au niveau de la colonne, et une étoile ferait
   échouer toute la requête. */
const ORDER_COLUMNS = [
  'id', 'agency_id', 'office_id', 'case_id', 'client_id', 'document_id', 'document_kind',
  'order_number', 'translator_id', 'source_lang', 'target_lang', 'sworn_required',
  'pages', 'words', 'status', 'ordered_at', 'promised_at', 'delivered_at', 'handed_at',
  'sold_amount', 'currency', 'source_path', 'translated_path', 'note', 'created_at',
].join(', ')

const toTranslator = (r: Row): Translator => ({
  id: r.id, agencyId: r.agency_id, officeId: r.office_id, name: r.name, kind: r.kind,
  sworn: !!r.sworn, swornCourt: r.sworn_court, languages: r.languages ?? [],
  phone: r.phone, email: r.email, address: r.address,
  ratePerPage: maybe(r.rate_per_page), rateCurrency: r.rate_currency,
  leadTimeDays: r.lead_time_days === null || r.lead_time_days === undefined ? null : Number(r.lead_time_days),
  active: !!r.active, note: r.note, createdAt: r.created_at,
})

const toOrder = (r: Row): TranslationOrder => ({
  id: r.id, agencyId: r.agency_id, officeId: r.office_id, caseId: r.case_id,
  clientId: r.client_id, documentId: r.document_id, documentKind: r.document_kind,
  orderNumber: r.order_number, translatorId: r.translator_id,
  sourceLang: r.source_lang, targetLang: r.target_lang, swornRequired: !!r.sworn_required,
  pages: maybe(r.pages), words: maybe(r.words), status: r.status,
  orderedAt: r.ordered_at, promisedAt: r.promised_at, deliveredAt: r.delivered_at,
  handedAt: r.handed_at, soldAmount: maybe(r.sold_amount), currency: r.currency ?? 'TND',
  sourcePath: r.source_path, translatedPath: r.translated_path, note: r.note,
  createdAt: r.created_at,
})

const toPiece = (r: Row): CaseTranslationPiece => ({
  documentId: r.document_id, key: r.key, label: r.label, state: r.state,
  needsTranslation: !!r.needs_translation,
  order: r.order
    ? {
      id: r.order.id, orderNumber: r.order.order_number, status: r.order.status,
      translatorId: r.order.translator_id, translatorName: r.order.translator_name,
      sourceLang: r.order.source_lang, targetLang: r.order.target_lang,
      swornRequired: !!r.order.sworn_required, pages: maybe(r.order.pages),
      orderedAt: r.order.ordered_at, promisedAt: r.order.promised_at,
      deliveredAt: r.order.delivered_at, handedAt: r.order.handed_at,
      soldAmount: maybe(r.order.sold_amount), currency: r.order.currency ?? 'TND',
      translatedPath: r.order.translated_path, late: !!r.order.late,
    }
    : null,
})

/* ------------------------------------------------------------------ */
/* Les lectures                                                        */
/* ------------------------------------------------------------------ */

export async function loadTranslators(): Promise<Translator[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('translators').select('*')
    .is('deleted_at', null).order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map(toTranslator)
}

export async function loadLanguages(): Promise<Language[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('translation_languages').select('*')
    .eq('active', true).order('code')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: Row) => ({
    code: r.code, nameFr: r.name_fr, nameEn: r.name_en, nameAr: r.name_ar,
    rtl: !!r.rtl, active: !!r.active,
  }))
}

export interface OrderFilter {
  status?: TranslationStatus | 'toutes' | 'ouvertes'
  translatorId?: string | null
  from?: string | null
  to?: string | null
  caseId?: string | null
}

export async function loadOrders(filter: OrderFilter = {}): Promise<TranslationOrder[]> {
  if (!HAS_BACKEND) return []
  let q = sb().from('translation_orders').select(ORDER_COLUMNS).is('deleted_at', null)
  if (filter.caseId) q = q.eq('case_id', filter.caseId)
  if (filter.translatorId) q = q.eq('translator_id', filter.translatorId)
  if (filter.status === 'ouvertes') {
    q = q.in('status', ['a_commander', 'commandee', 'en_cours'])
  } else if (filter.status && filter.status !== 'toutes') {
    q = q.eq('status', filter.status)
  }
  // La période porte sur le jour où la traduction a été confiée : c'est la
  // date que l'agence a en tête quand elle regarde un mois.
  if (filter.from) q = q.gte('ordered_at', `${filter.from}T00:00:00`)
  if (filter.to) q = q.lte('ordered_at', `${filter.to}T23:59:59`)
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map(toOrder)
}

/** Les pièces d'un dossier, lues au serveur : le bloc se suffit à lui-même. */
export async function loadCasePieces(caseId: string): Promise<CasePiece[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('case_documents')
    .select('id, key, label, state, needs_translation, translation_order_id')
    .eq('case_id', caseId).order('key')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id, key: r.key, label: r.label, state: r.state,
    needsTranslation: !!r.needs_translation, translationOrderId: r.translation_order_id,
  }))
}

export async function loadCaseTranslations(caseId: string): Promise<CaseTranslations | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('case_translations', { p_case: caseId })
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  return {
    total: num(r.total), livrees: num(r.livrees), enRetard: num(r.en_retard),
    toutesLivrees: !!r.toutes_livrees,
    pieces: ((r.pieces ?? []) as Row[]).map(toPiece),
  }
}

export async function loadLate(officeId: string | null = null): Promise<LateTranslation[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().rpc('translation_late', { p_office: officeId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map((r) => ({
    orderId: r.order_id, orderNumber: r.order_number, caseId: r.case_id,
    documentId: r.document_id, translatorId: r.translator_id, translatorName: r.translator_name,
    sourceLang: r.source_lang, targetLang: r.target_lang,
    promisedAt: r.promised_at, daysLate: num(r.days_late), status: r.status,
  }))
}

/** Réservé à finance:global : le serveur refuse aux autres. */
export async function loadMarginReport(
  officeId: string | null, from: string | null, to: string | null,
): Promise<MarginRow[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().rpc('translation_margin_report', {
    p_office: officeId, p_from: from, p_to: to,
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map((r) => ({
    translatorId: r.translator_id, translatorName: r.translator_name,
    sourceLang: r.source_lang, targetLang: r.target_lang, currency: r.currency ?? 'TND',
    orders: num(r.orders), pages: num(r.pages),
    sold: num(r.sold), cost: num(r.cost), margin: num(r.margin),
  }))
}

/** Réservé à finance:global. */
export async function loadOrderCosts(orderId: string): Promise<TranslationCosts | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('translation_costs', { p_order: orderId })
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  return {
    soldAmount: maybe(r.sold_amount), costAmount: maybe(r.cost_amount),
    margin: maybe(r.margin), currency: r.currency ?? 'TND', fxRate: num(r.fx_rate),
  }
}

export async function loadTranslatorStats(translatorId: string): Promise<TranslatorStats | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('translator_stats', { p_translator: translatorId })
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  return {
    translatorId: r.translator_id, name: r.name,
    orders: num(r.orders), delivered: num(r.delivered),
    // Vide veut dire « pas encore mesuré ». On ne le remplace pas par zéro,
    // qui laisserait croire à une livraison le jour même.
    avgDays: maybe(r.avg_days), avgDaysOn: num(r.avg_days_on),
    late: num(r.late), lateOn: num(r.late_on), lateRate: maybe(r.late_rate),
    avgMargin: maybe(r.avg_margin), avgMarginOn: num(r.avg_margin_on),
    currency: r.currency ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Les écritures                                                       */
/* ------------------------------------------------------------------ */

export interface TranslatorDraft {
  name: string
  kind: TranslatorKind
  sworn: boolean
  swornCourt: string | null
  languages: string[]
  phone: string | null
  email: string | null
  address: string | null
  ratePerPage: number | null
  rateCurrency: string | null
  leadTimeDays: number | null
  active: boolean
  note: string | null
}

export async function saveTranslator(
  agencyId: string, id: string | null, draft: TranslatorDraft,
): Promise<void> {
  const row = {
    name: draft.name, kind: draft.kind, sworn: draft.sworn, sworn_court: draft.swornCourt,
    languages: draft.languages, phone: draft.phone, email: draft.email, address: draft.address,
    rate_per_page: draft.ratePerPage, rate_currency: draft.rateCurrency,
    lead_time_days: draft.leadTimeDays, active: draft.active, note: draft.note,
  }
  const { error } = id
    ? await sb().from('translators').update(row).eq('id', id)
    : await sb().from('translators').insert({ ...row, agency_id: agencyId })
  if (error) throw new Error(error.message)
}

/** On range le traducteur, on ne l'efface pas : son historique reste lisible. */
export async function archiveTranslator(id: string): Promise<void> {
  const { error } = await sb().from('translators')
    .update({ active: false, deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

export interface EntrustDraft {
  translatorId: string
  sourceLang: string | null
  targetLang: string | null
  caseId: string | null
  documentId: string | null
  clientId: string | null
  swornRequired: boolean
  pages: number | null
  words: number | null
  soldAmount: number | null
  currency: string | null
  promisedAt: string | null
  sourcePath: string | null
  note: string | null
}

/**
 * Confier une traduction, c'est NOTER ce qu'on vient de confier de vive voix.
 * Aucun message ne part d'ici. Le coût est calculé par le serveur depuis le
 * tarif du traducteur ; le prix client reste à la saisie.
 */
export async function entrustTranslation(draft: EntrustDraft): Promise<string> {
  const { data, error } = await sb().rpc('translation_order_place', {
    p_translator: draft.translatorId,
    p_source_lang: draft.sourceLang,
    p_target_lang: draft.targetLang,
    p_case: draft.caseId,
    p_document: draft.documentId,
    p_client: draft.clientId,
    p_sworn_required: draft.swornRequired,
    p_pages: draft.pages,
    p_words: draft.words,
    p_sold_amount: draft.soldAmount,
    p_currency: draft.currency,
    p_promised_at: draft.promisedAt,
    p_source_path: draft.sourcePath,
    p_note: draft.note,
  })
  if (error) throw new Error(error.message)
  return data as string
}

/**
 * Enregistrer la traduction reçue. Le serveur la rattache à la pièce d'origine
 * du dossier : rangée à part, elle deviendrait un fichier dont on ne sait plus
 * de quoi il est la traduction.
 */
export async function receiveTranslation(orderId: string, path: string): Promise<number | null> {
  const { data, error } = await sb().rpc('translation_deliver', {
    p_order: orderId, p_path: path,
  })
  if (error) throw new Error(error.message)
  return data === null || data === undefined ? null : Number(data)
}

export async function handOverTranslation(orderId: string): Promise<void> {
  const { error } = await sb().from('translation_orders')
    .update({ status: 'remise_client', handed_at: new Date().toISOString() })
    .eq('id', orderId)
  if (error) throw new Error(error.message)
}

export async function cancelTranslation(orderId: string): Promise<void> {
  const { error } = await sb().from('translation_orders')
    .update({ status: 'annulee' }).eq('id', orderId)
  if (error) throw new Error(error.message)
}

export async function updateTranslationNote(orderId: string, note: string | null): Promise<void> {
  const { error } = await sb().from('translation_orders').update({ note }).eq('id', orderId)
  if (error) throw new Error(error.message)
}

/** Cocher une pièce du dossier comme étant à traduire, ou la décocher. */
export async function setNeedsTranslation(documentId: string, needs: boolean): Promise<void> {
  const { error } = await sb().from('case_documents')
    .update({ needs_translation: needs }).eq('id', documentId)
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Les fichiers                                                        */
/* ------------------------------------------------------------------ */

/* Le seau « pieces » existe depuis la migration 0009, et son chemin commence
   par l'identifiant de l'agence : c'est lui que la politique de stockage
   contrôle. On ne change pas cette règle pour les traductions. */

export function translationPath(agencyId: string, caseId: string | null, file: File): string {
  const dot = file.name.lastIndexOf('.')
  const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : ''
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14)
  return `${agencyId}/${caseId ?? 'hors-dossier'}/traductions/${rand}${ext}`
}

export async function uploadTranslationFile(
  agencyId: string, caseId: string | null, file: File,
): Promise<string> {
  const path = translationPath(agencyId, caseId, file)
  const { error } = await sb().storage.from('pieces').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw new Error(error.message)
  return path
}

/** Un lien de consultation, valable une heure. Le seau est privé. */
export async function translationFileUrl(path?: string | null): Promise<string | undefined> {
  if (!path || !supabase) return undefined
  const { data } = await supabase.storage.from('pieces').createSignedUrl(path, 3600)
  return data?.signedUrl
}
