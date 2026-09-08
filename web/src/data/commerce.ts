/* Le module commercial parle au serveur en direct.
 *
 * Le magasin global charge déjà trente-trois tables à chaque ouverture de
 * session. Y ajouter les devis, les factures, leurs lignes et les dépenses
 * ferait payer ce chargement à tout le monde, y compris à qui n'ouvre jamais
 * ces écrans. Les pages du commerce lisent donc ici, à la demande.
 *
 * Deuxième principe, qui vaut règle : AUCUN TOTAL N'EST CALCULÉ ICI. Le
 * sous-total, la TVA, le solde et la marge descendent du serveur, où ils sont
 * recalculés par déclencheur. Un chiffre d'argent recalculé dans le navigateur
 * finit toujours par diverger de celui de la base, et c'est celui de la base
 * que le client verra sur sa facture.
 */

import { supabase, HAS_BACKEND } from '@/lib/supabase'
import type { I18nText } from '@/data/types'

/* ------------------------------------------------------------------ */
/* Les formes                                                          */
/* ------------------------------------------------------------------ */

export type ServiceCategory =
  | 'VISA' | 'CARGO' | 'CUSTOMS' | 'TRANSPORT' | 'DOCUMENT' | 'INSURANCE' | 'OTHER'

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  'VISA', 'CARGO', 'CUSTOMS', 'TRANSPORT', 'DOCUMENT', 'INSURANCE', 'OTHER',
]

export interface Service {
  id: string
  agencyId: string
  category: ServiceCategory
  name: I18nText
  description: string | null
  defaultPrice: number
  currency: string
  taxRate: number
  active: boolean
  createdAt: string
}

export type QuoteKind = 'visa' | 'cargo' | 'autre'
export type QuoteStatus = 'brouillon' | 'envoye' | 'accepte' | 'refuse' | 'expire'

export interface Quote {
  id: string
  agencyId: string
  officeId: string | null
  clientId: string | null
  kind: QuoteKind
  number: string
  caseId: string | null
  shipmentId: string | null
  currency: string
  subtotal: number
  taxTotal: number
  discount: number
  total: number
  status: QuoteStatus
  validUntil: string | null
  note: string | null
  createdAt: string
  sentAt: string | null
  decidedAt: string | null
}

export type InvoiceStatus =
  | 'brouillon' | 'emise' | 'partiellement_reglee' | 'reglee' | 'en_retard' | 'annulee'

export interface Invoice {
  id: string
  agencyId: string
  officeId: string | null
  clientId: string | null
  number: string
  quoteId: string | null
  caseId: string | null
  shipmentId: string | null
  issueDate: string
  dueDate: string | null
  currency: string
  subtotal: number
  taxTotal: number
  discount: number
  total: number
  paidAmount: number
  balanceDue: number
  status: InvoiceStatus
  note: string | null
  createdAt: string
}

/** Une ligne de devis ou de facture : les deux tables ont les mêmes colonnes. */
export interface DocLine {
  id: string
  agencyId: string
  serviceId: string | null
  description: string | null
  quantity: number
  unitPrice: number
  taxRate: number
  discount: number
  /** Calculé par le serveur. Jamais écrit d'ici. */
  lineTotal: number
  lineNo: number
}

export interface Expense {
  id: string
  agencyId: string
  officeId: string | null
  caseId: string | null
  shipmentId: string | null
  category: ExpenseCategory
  supplierName: string | null
  amount: number
  currency: string
  fxRate: number
  amountBase: number
  paymentMethod: string | null
  spentOn: string
  note: string | null
}

export type ExpenseCategory =
  | 'consulat' | 'transport' | 'douane' | 'sous_traitance'
  | 'fourniture' | 'commission' | 'loyer' | 'salaire' | 'autre'

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'consulat', 'transport', 'douane', 'sous_traitance',
  'fourniture', 'commission', 'loyer', 'salaire', 'autre',
]

export interface Margin {
  /** Facturé hors taxe : la TVA n'est pas du revenu, elle est reversée. */
  billed: number
  collected: number
  expenses: number
  margin: number
  marginPct: number | null
  currency: string
}

export interface FinanceSummary extends Margin {
  unpaid: number
  from: string
  to: string
}

/* ------------------------------------------------------------------ */
/* Le pont snake_case / camelCase, limité à ce module                  */
/* ------------------------------------------------------------------ */

function sb() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

type Row = Record<string, any>

const toService = (r: Row): Service => ({
  id: r.id, agencyId: r.agency_id, category: r.category, name: r.name,
  description: r.description, defaultPrice: num(r.default_price), currency: r.currency,
  taxRate: num(r.tax_rate), active: r.active, createdAt: r.created_at,
})

const toQuote = (r: Row): Quote => ({
  id: r.id, agencyId: r.agency_id, officeId: r.office_id, clientId: r.client_id,
  kind: r.kind, number: r.number, caseId: r.case_id, shipmentId: r.shipment_id,
  currency: r.currency, subtotal: num(r.subtotal), taxTotal: num(r.tax_total),
  discount: num(r.discount), total: num(r.total), status: r.status,
  validUntil: r.valid_until, note: r.note, createdAt: r.created_at,
  sentAt: r.sent_at, decidedAt: r.decided_at,
})

const toInvoice = (r: Row): Invoice => ({
  id: r.id, agencyId: r.agency_id, officeId: r.office_id, clientId: r.client_id,
  number: r.number, quoteId: r.quote_id, caseId: r.case_id, shipmentId: r.shipment_id,
  issueDate: r.issue_date, dueDate: r.due_date, currency: r.currency,
  subtotal: num(r.subtotal), taxTotal: num(r.tax_total), discount: num(r.discount),
  total: num(r.total), paidAmount: num(r.paid_amount), balanceDue: num(r.balance_due),
  status: r.status, note: r.note, createdAt: r.created_at,
})

const toLine = (r: Row): DocLine => ({
  id: r.id, agencyId: r.agency_id, serviceId: r.service_id, description: r.description,
  quantity: num(r.quantity), unitPrice: num(r.unit_price), taxRate: num(r.tax_rate),
  discount: num(r.discount), lineTotal: num(r.line_total), lineNo: num(r.line_no),
})

const toExpense = (r: Row): Expense => ({
  id: r.id, agencyId: r.agency_id, officeId: r.office_id, caseId: r.case_id,
  shipmentId: r.shipment_id, category: r.category, supplierName: r.supplier_name,
  amount: num(r.amount), currency: r.currency, fxRate: num(r.fx_rate),
  amountBase: num(r.amount_base), paymentMethod: r.payment_method,
  spentOn: r.spent_on, note: r.note,
})

const toMargin = (r: Row): Margin => ({
  billed: num(r.billed), collected: num(r.collected), expenses: num(r.expenses),
  margin: num(r.margin),
  // Une marge sur zéro facturé n'existe pas : le serveur renvoie null, on ne
  // la remplace pas par 0 %, qui laisserait croire à une vente sans marge.
  marginPct: r.margin_pct === null || r.margin_pct === undefined ? null : Number(r.margin_pct),
  currency: r.currency ?? 'TND',
})

/* ------------------------------------------------------------------ */
/* Les lectures                                                        */
/* ------------------------------------------------------------------ */

export async function loadServices(): Promise<Service[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('services').select('*').order('category')
  if (error) throw new Error(error.message)
  return (data ?? []).map(toService)
}

export async function loadQuotes(): Promise<Quote[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('quotes').select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(toQuote)
}

export async function loadQuoteLines(quoteId: string): Promise<DocLine[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('quote_items').select('*')
    .eq('quote_id', quoteId).is('deleted_at', null).order('line_no')
  if (error) throw new Error(error.message)
  return (data ?? []).map(toLine)
}

export async function loadInvoices(): Promise<Invoice[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('invoices').select('*')
    .order('issue_date', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(toInvoice)
}

export async function loadInvoiceLines(invoiceId: string): Promise<DocLine[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('invoice_items').select('*')
    .eq('invoice_id', invoiceId).is('deleted_at', null).order('line_no')
  if (error) throw new Error(error.message)
  return (data ?? []).map(toLine)
}

export async function loadExpenses(scope: { caseId?: string; shipmentId?: string }): Promise<Expense[]> {
  if (!HAS_BACKEND) return []
  let q = sb().from('expenses').select('*').is('deleted_at', null)
  if (scope.caseId) q = q.eq('case_id', scope.caseId)
  if (scope.shipmentId) q = q.eq('shipment_id', scope.shipmentId)
  const { data, error } = await q.order('spent_on', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(toExpense)
}

export async function loadMargin(scope: { caseId?: string; shipmentId?: string }): Promise<Margin | null> {
  if (!HAS_BACKEND) return null
  const fn = scope.caseId ? 'case_margin' : 'shipment_margin'
  const args = scope.caseId ? { p_case: scope.caseId } : { p_shipment: scope.shipmentId }
  const { data, error } = await sb().rpc(fn, args)
  if (error) throw new Error(error.message)
  return data ? toMargin(data as Row) : null
}

export async function loadFinanceSummary(
  officeId: string | null, from: string | null, to: string | null,
): Promise<FinanceSummary | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('agency_finance_summary', {
    p_office: officeId, p_from: from, p_to: to,
  })
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  return { ...toMargin(r), unpaid: num(r.unpaid), from: r.from, to: r.to }
}

/* ------------------------------------------------------------------ */
/* Les écritures                                                       */
/* ------------------------------------------------------------------ */

export async function seedServices(agencyId: string): Promise<number> {
  const { data, error } = await sb().rpc('seed_services', { p_agency: agencyId })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

export interface ServiceDraft {
  category: ServiceCategory
  name: I18nText
  description: string | null
  defaultPrice: number
  currency: string
  taxRate: number
  active: boolean
}

export async function saveService(agencyId: string, id: string | null, draft: ServiceDraft): Promise<void> {
  const row = {
    category: draft.category, name: draft.name, description: draft.description,
    default_price: draft.defaultPrice, currency: draft.currency,
    tax_rate: draft.taxRate, active: draft.active,
  }
  const { error } = id
    ? await sb().from('services').update(row).eq('id', id)
    : await sb().from('services').insert({ ...row, agency_id: agencyId })
  if (error) throw new Error(error.message)
}

export interface QuoteDraft {
  officeId: string | null
  clientId: string | null
  kind: QuoteKind
  caseId: string | null
  shipmentId: string | null
  currency: string
  validUntil: string | null
  note: string | null
}

/** Le numéro est posé par le serveur : on ne l'envoie pas, on le relit. */
export async function createQuote(agencyId: string, draft: QuoteDraft): Promise<Quote> {
  const { data, error } = await sb().from('quotes').insert({
    agency_id: agencyId, office_id: draft.officeId, client_id: draft.clientId,
    kind: draft.kind, case_id: draft.caseId, shipment_id: draft.shipmentId,
    currency: draft.currency, valid_until: draft.validUntil, note: draft.note,
  }).select().single()
  if (error) throw new Error(error.message)
  return toQuote(data as Row)
}

export async function setQuoteDiscount(quoteId: string, discount: number): Promise<void> {
  const { error } = await sb().from('quotes').update({ discount }).eq('id', quoteId)
  if (error) throw new Error(error.message)
}

export async function setQuoteStatus(quoteId: string, status: QuoteStatus): Promise<void> {
  const stamp: Row = { status }
  if (status === 'envoye') stamp.sent_at = new Date().toISOString()
  if (status === 'accepte' || status === 'refuse') stamp.decided_at = new Date().toISOString()
  const { error } = await sb().from('quotes').update(stamp).eq('id', quoteId)
  if (error) throw new Error(error.message)
}

export interface LineDraft {
  serviceId: string | null
  description: string | null
  quantity: number
  unitPrice: number
  taxRate: number
  discount: number
  lineNo: number
}

export async function addQuoteLine(agencyId: string, quoteId: string, draft: LineDraft): Promise<void> {
  const { error } = await sb().from('quote_items').insert({
    agency_id: agencyId, quote_id: quoteId, service_id: draft.serviceId,
    description: draft.description, quantity: draft.quantity, unit_price: draft.unitPrice,
    tax_rate: draft.taxRate, discount: draft.discount, line_no: draft.lineNo,
  })
  if (error) throw new Error(error.message)
}

/** On range la ligne, on ne l'efface pas : le devis envoyé garde sa trace. */
export async function archiveQuoteLine(lineId: string): Promise<void> {
  const { error } = await sb().from('quote_items')
    .update({ deleted_at: new Date().toISOString() }).eq('id', lineId)
  if (error) throw new Error(error.message)
}

export async function addInvoiceLine(agencyId: string, invoiceId: string, draft: LineDraft): Promise<void> {
  const { error } = await sb().from('invoice_items').insert({
    agency_id: agencyId, invoice_id: invoiceId, service_id: draft.serviceId,
    description: draft.description, quantity: draft.quantity, unit_price: draft.unitPrice,
    tax_rate: draft.taxRate, discount: draft.discount, line_no: draft.lineNo,
  })
  if (error) throw new Error(error.message)
}

export async function archiveInvoiceLine(lineId: string): Promise<void> {
  const { error } = await sb().from('invoice_items')
    .update({ deleted_at: new Date().toISOString() }).eq('id', lineId)
  if (error) throw new Error(error.message)
}

export async function quoteToInvoice(quoteId: string, dueDays: number): Promise<string> {
  const { data, error } = await sb().rpc('quote_to_invoice', {
    p_quote: quoteId, p_due_days: dueDays,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export interface InvoiceDraft {
  officeId: string | null
  clientId: string | null
  caseId: string | null
  shipmentId: string | null
  currency: string
  dueDate: string | null
  note: string | null
}

export async function createInvoice(agencyId: string, draft: InvoiceDraft): Promise<Invoice> {
  const { data, error } = await sb().from('invoices').insert({
    agency_id: agencyId, office_id: draft.officeId, client_id: draft.clientId,
    case_id: draft.caseId, shipment_id: draft.shipmentId, currency: draft.currency,
    due_date: draft.dueDate, note: draft.note, status: 'brouillon',
  }).select().single()
  if (error) throw new Error(error.message)
  return toInvoice(data as Row)
}

export async function setInvoiceStatus(invoiceId: string, status: InvoiceStatus): Promise<void> {
  const { error } = await sb().from('invoices').update({ status }).eq('id', invoiceId)
  if (error) throw new Error(error.message)
  // Émettre une facture peut la rendre immédiatement en retard : c'est le
  // serveur qui tranche, on lui redemande.
  await refreshInvoice(invoiceId)
}

export async function refreshInvoice(invoiceId: string): Promise<void> {
  const { error } = await sb().rpc('invoice_totals', { p_invoice: invoiceId })
  if (error) throw new Error(error.message)
}

/** Encaisser : on pose le règlement, le solde de la facture suit tout seul. */
export async function collectOnInvoice(
  agencyId: string, invoice: Invoice, amount: number, method: string,
): Promise<void> {
  const { error } = await sb().from('payments').insert({
    agency_id: agencyId, invoice_id: invoice.id, case_id: invoice.caseId,
    shipment_id: invoice.shipmentId, client_id: invoice.clientId,
    label: { fr: `Règlement ${invoice.number}` },
    kind: 'honoraires', amount, currency: invoice.currency,
    state: 'regle', method, at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

export interface ExpenseDraft {
  officeId: string | null
  caseId: string | null
  shipmentId: string | null
  category: ExpenseCategory
  supplierName: string | null
  amount: number
  currency: string
  fxRate: number
  paymentMethod: string | null
  spentOn: string
  note: string | null
}

export async function addExpense(agencyId: string, draft: ExpenseDraft): Promise<void> {
  const { error } = await sb().from('expenses').insert({
    agency_id: agencyId, office_id: draft.officeId, case_id: draft.caseId,
    shipment_id: draft.shipmentId, category: draft.category,
    supplier_name: draft.supplierName, amount: draft.amount, currency: draft.currency,
    fx_rate: draft.fxRate, payment_method: draft.paymentMethod,
    spent_on: draft.spentOn, note: draft.note,
  })
  if (error) throw new Error(error.message)
}

export async function archiveExpense(expenseId: string): Promise<void> {
  const { error } = await sb().from('expenses')
    .update({ deleted_at: new Date().toISOString() }).eq('id', expenseId)
  if (error) throw new Error(error.message)
}
