/* Le module « cargo avancé » parle au serveur en direct.
 *
 * Le magasin global charge déjà des dizaines de tables à l'ouverture de
 * session. Y ajouter les fiches de danger, les relevés de température, les
 * commandes fournisseurs et les checklists ferait payer ce chargement à tout
 * le monde, y compris à qui n'ouvre jamais ces écrans. Les cartes de ce module
 * lisent donc ici, à la demande, et pour une seule cargaison à la fois.
 *
 * DEUX PRINCIPES, ET LE SECOND VAUT RÈGLE :
 *
 * 1. Aucun calcul d'argent ici. Le solde fournisseur, l'encours du client et
 *    les totaux d'un bon de commande descendent du serveur, où ils sont
 *    recalculés à chaque lecture. Un chiffre recalculé dans le navigateur finit
 *    toujours par diverger de celui de la base.
 *
 * 2. Aucune prévision douanière ici. Le statut destiné au client vient de
 *    `customs_public_status`, qui rend un libellé sans date et sans promesse.
 *    On l'affiche tel quel, on ne l'habille jamais.
 */

import { supabase, HAS_BACKEND } from '@/lib/supabase'
import type { I18nText } from '@/data/types'

function sb() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

type Row = Record<string, any>

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const opt = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/* ------------------------------------------------------------------ */
/* Marchandises dangereuses                                            */
/* ------------------------------------------------------------------ */

/** Les neuf classes principales ADR et IMDG. La sous-division exacte vient de
 *  la fiche de données de sécurité du fournisseur, jamais d'ici. */
export interface DangerousClass {
  code: string
  label: I18nText
  position: number
}

export interface DangerousDetail {
  id: string
  agencyId: string
  shipmentId: string
  goodsId: string | null
  unNumber: string | null
  hazardClass: string | null
  packingGroup: 'I' | 'II' | 'III' | null
  properShippingName: string | null
  flashPoint: number | null
  msdsPath: string | null
  emergencyContact: string | null
  note: string | null
}

const toDangerousClass = (r: Row): DangerousClass => ({
  code: r.code, label: r.label, position: num(r.position),
})

const toDangerous = (r: Row): DangerousDetail => ({
  id: r.id, agencyId: r.agency_id, shipmentId: r.shipment_id, goodsId: r.goods_id,
  unNumber: r.un_number, hazardClass: r.hazard_class, packingGroup: r.packing_group,
  properShippingName: r.proper_shipping_name, flashPoint: opt(r.flash_point),
  msdsPath: r.msds_path, emergencyContact: r.emergency_contact, note: r.note,
})

export async function loadDangerousClasses(): Promise<DangerousClass[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('dangerous_goods_classes').select('*').order('position')
  if (error) throw new Error(error.message)
  return (data ?? []).map(toDangerousClass)
}

export async function loadDangerousDetails(shipmentId: string): Promise<DangerousDetail[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('dangerous_goods_details').select('*')
    .eq('shipment_id', shipmentId).order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []).map(toDangerous)
}

export interface DangerousDraft {
  unNumber: string | null
  hazardClass: string | null
  packingGroup: 'I' | 'II' | 'III' | null
  properShippingName: string | null
  flashPoint: number | null
  emergencyContact: string | null
  note: string | null
}

export async function saveDangerous(
  agencyId: string, shipmentId: string, id: string | null, draft: DangerousDraft,
): Promise<void> {
  const row = {
    un_number: draft.unNumber, hazard_class: draft.hazardClass,
    packing_group: draft.packingGroup, proper_shipping_name: draft.properShippingName,
    flash_point: draft.flashPoint, emergency_contact: draft.emergencyContact, note: draft.note,
  }
  const { error } = id
    ? await sb().from('dangerous_goods_details').update(row).eq('id', id)
    : await sb().from('dangerous_goods_details').insert({ ...row, agency_id: agencyId, shipment_id: shipmentId })
  if (error) throw new Error(error.message)
}

export async function removeDangerous(id: string): Promise<void> {
  const { error } = await sb().from('dangerous_goods_details').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Température contrôlée                                               */
/* ------------------------------------------------------------------ */

export type ProductKind = 'alimentaire' | 'pharmaceutique' | 'autre'
export type ReadingSource = 'manuel' | 'sonde' | 'transporteur'

export interface ReeferRequirement {
  id: string
  agencyId: string
  shipmentId: string
  containerId: string | null
  temperatureMin: number | null
  temperatureMax: number | null
  unit: 'C' | 'F'
  humidityPct: number | null
  ventilation: string | null
  productKind: ProductKind
  note: string | null
}

export interface ReeferReading {
  id: string
  shipmentId: string
  containerId: string | null
  readingAt: string
  temperature: number
  source: ReadingSource
  note: string | null
}

/** Ce que le serveur rend : la consigne, le dernier relevé, et les relevés hors
 *  plage. La fonction ne conclut pas à la rupture, elle montre les preuves. */
export interface ReeferStatusLine {
  requirement_id: string
  container_id: string | null
  temperature_min: number | null
  temperature_max: number | null
  unit: 'C' | 'F'
  humidity_pct: number | null
  product_kind: ProductKind
  readings: number
  last_reading: { at: string; temperature: number; source: ReadingSource } | null
  out_of_range: { at: string; temperature: number; source: ReadingSource }[]
}

const toReefer = (r: Row): ReeferRequirement => ({
  id: r.id, agencyId: r.agency_id, shipmentId: r.shipment_id, containerId: r.container_id,
  temperatureMin: opt(r.temperature_min), temperatureMax: opt(r.temperature_max),
  unit: r.unit, humidityPct: opt(r.humidity_pct), ventilation: r.ventilation,
  productKind: r.product_kind, note: r.note,
})

const toReading = (r: Row): ReeferReading => ({
  id: r.id, shipmentId: r.shipment_id, containerId: r.container_id,
  readingAt: r.reading_at, temperature: num(r.temperature), source: r.source, note: r.note,
})

export async function loadReeferRequirements(shipmentId: string): Promise<ReeferRequirement[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('reefer_requirements').select('*')
    .eq('shipment_id', shipmentId).order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []).map(toReefer)
}

export async function loadReeferReadings(shipmentId: string): Promise<ReeferReading[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('reefer_readings').select('*')
    .eq('shipment_id', shipmentId).order('reading_at', { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toReading)
}

export async function loadReeferStatus(shipmentId: string): Promise<ReeferStatusLine[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().rpc('reefer_status', { p_shipment: shipmentId })
  if (error) throw new Error(error.message)
  return (data ?? []) as ReeferStatusLine[]
}

export interface ReeferDraft {
  temperatureMin: number | null
  temperatureMax: number | null
  unit: 'C' | 'F'
  humidityPct: number | null
  ventilation: string | null
  productKind: ProductKind
  note: string | null
}

export async function saveReeferRequirement(
  agencyId: string, shipmentId: string, id: string | null, draft: ReeferDraft,
): Promise<void> {
  const row = {
    temperature_min: draft.temperatureMin, temperature_max: draft.temperatureMax,
    unit: draft.unit, humidity_pct: draft.humidityPct, ventilation: draft.ventilation,
    product_kind: draft.productKind, note: draft.note,
  }
  const { error } = id
    ? await sb().from('reefer_requirements').update(row).eq('id', id)
    : await sb().from('reefer_requirements').insert({ ...row, agency_id: agencyId, shipment_id: shipmentId })
  if (error) throw new Error(error.message)
}

export async function addReeferReading(
  agencyId: string, shipmentId: string,
  draft: { readingAt: string; temperature: number; source: ReadingSource; note: string | null },
): Promise<void> {
  const { error } = await sb().from('reefer_readings').insert({
    agency_id: agencyId, shipment_id: shipmentId, reading_at: draft.readingAt,
    temperature: draft.temperature, source: draft.source, note: draft.note,
  })
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Assurance                                                           */
/* ------------------------------------------------------------------ */

export type InsuranceStatus = 'a_souscrire' | 'active' | 'expiree' | 'resiliee'

export interface CargoInsurance {
  id: string
  agencyId: string
  shipmentId: string
  insurer: string | null
  policyNumber: string | null
  coverageAmount: number | null
  currency: string
  deductible: number | null
  startDate: string | null
  endDate: string | null
  documentPath: string | null
  status: InsuranceStatus
  note: string | null
}

const toInsurance = (r: Row): CargoInsurance => ({
  id: r.id, agencyId: r.agency_id, shipmentId: r.shipment_id, insurer: r.insurer,
  policyNumber: r.policy_number, coverageAmount: opt(r.coverage_amount),
  currency: r.currency, deductible: opt(r.deductible), startDate: r.start_date,
  endDate: r.end_date, documentPath: r.document_path, status: r.status, note: r.note,
})

export async function loadInsurance(shipmentId: string): Promise<CargoInsurance[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('cargo_insurance').select('*')
    .eq('shipment_id', shipmentId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(toInsurance)
}

export interface InsuranceDraft {
  insurer: string | null
  policyNumber: string | null
  coverageAmount: number | null
  currency: string
  deductible: number | null
  startDate: string | null
  endDate: string | null
  status: InsuranceStatus
  note: string | null
}

export async function saveInsurance(
  agencyId: string, shipmentId: string, id: string | null, draft: InsuranceDraft,
): Promise<void> {
  const row = {
    insurer: draft.insurer, policy_number: draft.policyNumber,
    coverage_amount: draft.coverageAmount, currency: draft.currency,
    deductible: draft.deductible, start_date: draft.startDate, end_date: draft.endDate,
    status: draft.status, note: draft.note,
  }
  const { error } = id
    ? await sb().from('cargo_insurance').update(row).eq('id', id)
    : await sb().from('cargo_insurance').insert({ ...row, agency_id: agencyId, shipment_id: shipmentId })
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Inspections et contrôle technique                                   */
/* ------------------------------------------------------------------ */

export type InspectionKind =
  'DOUANE' | 'TECHNIQUE' | 'PHYTOSANITAIRE' | 'SANITAIRE' | 'SCANNER' | 'AUTRE'
export type InspectionResult = 'en_attente' | 'conforme' | 'non_conforme' | 'reserve'

export const INSPECTION_KINDS: InspectionKind[] = [
  'DOUANE', 'TECHNIQUE', 'PHYTOSANITAIRE', 'SANITAIRE', 'SCANNER', 'AUTRE',
]

export interface ShipmentInspection {
  id: string
  agencyId: string
  shipmentId: string
  kind: InspectionKind
  scheduledAt: string | null
  performedAt: string | null
  authority: string | null
  result: InspectionResult
  findings: string | null
  documentPath: string | null
  cost: number | null
  currency: string
  note: string | null
}

export type TechnicalStatus = 'a_deposer' | 'depose' | 'approuve' | 'rejete'

export interface TechnicalControlDocument {
  id: string
  agencyId: string
  shipmentId: string
  reference: string | null
  authority: string | null
  submittedOn: string | null
  status: TechnicalStatus
  decisionOn: string | null
  documentPath: string | null
  note: string | null
}

/** Ce que le serveur rend. « absente » veut dire « aucun contrôle enregistré »,
 *  jamais « aucun contrôle requis » : VisaFlow n'affirme aucune obligation. */
export interface InspectionsState {
  par_genre: Record<string, {
    result: InspectionResult | 'absente'
    scheduled_at?: string | null
    performed_at?: string | null
    authority?: string | null
    findings?: string | null
  }>
  controle_technique: {
    status: TechnicalStatus | 'absent'
    reference?: string | null
    submitted_on?: string | null
    decision_on?: string | null
  }
  non_conformes: number
  en_attente: number
}

const toInspection = (r: Row): ShipmentInspection => ({
  id: r.id, agencyId: r.agency_id, shipmentId: r.shipment_id, kind: r.kind,
  scheduledAt: r.scheduled_at, performedAt: r.performed_at, authority: r.authority,
  result: r.result, findings: r.findings, documentPath: r.document_path,
  cost: opt(r.cost), currency: r.currency, note: r.note,
})

const toTechnical = (r: Row): TechnicalControlDocument => ({
  id: r.id, agencyId: r.agency_id, shipmentId: r.shipment_id, reference: r.reference,
  authority: r.authority, submittedOn: r.submitted_on, status: r.status,
  decisionOn: r.decision_on, documentPath: r.document_path, note: r.note,
})

export async function loadInspections(shipmentId: string): Promise<ShipmentInspection[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('shipment_inspections').select('*')
    .eq('shipment_id', shipmentId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(toInspection)
}

export async function loadTechnicalDocuments(shipmentId: string): Promise<TechnicalControlDocument[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('technical_control_documents').select('*')
    .eq('shipment_id', shipmentId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(toTechnical)
}

export async function loadInspectionsState(shipmentId: string): Promise<InspectionsState | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('shipment_inspections_state', { p_shipment: shipmentId })
  if (error) throw new Error(error.message)
  return (data ?? null) as InspectionsState | null
}

export interface InspectionDraft {
  kind: InspectionKind
  scheduledAt: string | null
  performedAt: string | null
  authority: string | null
  result: InspectionResult
  findings: string | null
  cost: number | null
  currency: string
  note: string | null
}

export async function saveInspection(
  agencyId: string, shipmentId: string, id: string | null, draft: InspectionDraft,
): Promise<void> {
  const row = {
    kind: draft.kind, scheduled_at: draft.scheduledAt, performed_at: draft.performedAt,
    authority: draft.authority, result: draft.result, findings: draft.findings,
    cost: draft.cost, currency: draft.currency, note: draft.note,
  }
  const { error } = id
    ? await sb().from('shipment_inspections').update(row).eq('id', id)
    : await sb().from('shipment_inspections').insert({ ...row, agency_id: agencyId, shipment_id: shipmentId })
  if (error) throw new Error(error.message)
}

export interface TechnicalDraft {
  reference: string | null
  authority: string | null
  submittedOn: string | null
  status: TechnicalStatus
  decisionOn: string | null
  note: string | null
}

export async function saveTechnicalDocument(
  agencyId: string, shipmentId: string, id: string | null, draft: TechnicalDraft,
): Promise<void> {
  const row = {
    reference: draft.reference, authority: draft.authority, submitted_on: draft.submittedOn,
    status: draft.status, decision_on: draft.decisionOn, note: draft.note,
  }
  const { error } = id
    ? await sb().from('technical_control_documents').update(row).eq('id', id)
    : await sb().from('technical_control_documents').insert({ ...row, agency_id: agencyId, shipment_id: shipmentId })
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Achats et fournisseurs                                              */
/* ------------------------------------------------------------------ */

export type PurchaseStatus =
  'brouillon' | 'envoye' | 'confirme' | 'expedie' | 'recu' | 'annule'

export const PURCHASE_STATUSES: PurchaseStatus[] = [
  'brouillon', 'envoye', 'confirme', 'expedie', 'recu', 'annule',
]

export interface PurchaseOrder {
  id: string
  agencyId: string
  officeId: string | null
  shipmentId: string | null
  supplierId: string | null
  poNumber: string | null
  currency: string
  /** Calculés par le serveur à chaque mouvement de ligne. Jamais écrits d'ici. */
  subtotal: number
  total: number
  status: PurchaseStatus
  issuedOn: string | null
  expectedOn: string | null
  documentPath: string | null
  note: string | null
}

export interface PurchaseOrderItem {
  id: string
  poId: string
  description: string | null
  hsCode: string | null
  quantity: number
  unit: string | null
  unitPrice: number
  /** Calculé par la base. */
  total: number
  lineNo: number
}

export type SupplierMovementKind = 'facture' | 'paiement' | 'avoir'

export interface SupplierTransaction {
  id: string
  agencyId: string
  supplierId: string
  shipmentId: string | null
  kind: SupplierMovementKind
  reference: string | null
  amount: number
  currency: string
  fxRate: number
  /** Contre-valeur figée au taux du mouvement, calculée par la base. */
  amountBase: number
  occurredOn: string
  note: string | null
}

/** Une fiche du répertoire fournisseurs, tenue par un autre module. On n'en lit
 *  que le strict nécessaire, et l'absence de la table n'est pas une panne. */
export interface SupplierRef {
  id: string
  companyName: string
  country: string | null
}

const toPurchase = (r: Row): PurchaseOrder => ({
  id: r.id, agencyId: r.agency_id, officeId: r.office_id, shipmentId: r.shipment_id,
  supplierId: r.supplier_id, poNumber: r.po_number, currency: r.currency,
  subtotal: num(r.subtotal), total: num(r.total), status: r.status,
  issuedOn: r.issued_on, expectedOn: r.expected_on, documentPath: r.document_path, note: r.note,
})

const toPurchaseItem = (r: Row): PurchaseOrderItem => ({
  id: r.id, poId: r.po_id, description: r.description, hsCode: r.hs_code,
  quantity: num(r.quantity), unit: r.unit, unitPrice: num(r.unit_price),
  total: num(r.total), lineNo: num(r.line_no),
})

const toMovement = (r: Row): SupplierTransaction => ({
  id: r.id, agencyId: r.agency_id, supplierId: r.supplier_id, shipmentId: r.shipment_id,
  kind: r.kind, reference: r.reference, amount: num(r.amount), currency: r.currency,
  fxRate: num(r.fx_rate), amountBase: num(r.amount_base), occurredOn: r.occurred_on, note: r.note,
})

export async function loadPurchaseOrders(scope: { shipmentId?: string }): Promise<PurchaseOrder[]> {
  if (!HAS_BACKEND) return []
  let q = sb().from('purchase_orders').select('*')
  if (scope.shipmentId) q = q.eq('shipment_id', scope.shipmentId)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toPurchase)
}

export async function loadPurchaseItems(poId: string): Promise<PurchaseOrderItem[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('purchase_order_items').select('*')
    .eq('po_id', poId).order('line_no')
  if (error) throw new Error(error.message)
  return (data ?? []).map(toPurchaseItem)
}

/** Le répertoire fournisseurs vit dans un autre module. S'il n'est pas encore
 *  installé, on rend une liste vide plutôt qu'une erreur : la carte fonctionne
 *  sans lui, elle affiche juste l'identifiant à la place du nom. */
export async function loadSuppliers(): Promise<SupplierRef[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('suppliers')
    .select('id, company_name, country').order('company_name').limit(500)
  if (error) return []
  return (data ?? []).map((r: Row) => ({
    id: r.id, companyName: r.company_name, country: r.country,
  }))
}

export interface PurchaseDraft {
  officeId: string | null
  shipmentId: string | null
  supplierId: string | null
  poNumber: string | null
  currency: string
  status: PurchaseStatus
  issuedOn: string | null
  expectedOn: string | null
  note: string | null
}

export async function savePurchaseOrder(
  agencyId: string, id: string | null, draft: PurchaseDraft,
): Promise<string> {
  const row = {
    office_id: draft.officeId, shipment_id: draft.shipmentId, supplier_id: draft.supplierId,
    po_number: draft.poNumber, currency: draft.currency, status: draft.status,
    issued_on: draft.issuedOn, expected_on: draft.expectedOn, note: draft.note,
  }
  const { data, error } = id
    ? await sb().from('purchase_orders').update(row).eq('id', id).select('id').single()
    : await sb().from('purchase_orders').insert({ ...row, agency_id: agencyId }).select('id').single()
  if (error) throw new Error(error.message)
  return (data as Row).id
}

export async function addPurchaseItem(
  agencyId: string, poId: string,
  draft: { description: string | null; hsCode: string | null; quantity: number; unit: string | null; unitPrice: number; lineNo: number },
): Promise<void> {
  const { error } = await sb().from('purchase_order_items').insert({
    agency_id: agencyId, po_id: poId, description: draft.description, hs_code: draft.hsCode,
    quantity: draft.quantity, unit: draft.unit, unit_price: draft.unitPrice, line_no: draft.lineNo,
  })
  if (error) throw new Error(error.message)
}

export async function removePurchaseItem(id: string): Promise<void> {
  const { error } = await sb().from('purchase_order_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function loadSupplierMovements(supplierId: string): Promise<SupplierTransaction[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('supplier_transactions').select('*')
    .eq('supplier_id', supplierId).order('occurred_on', { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toMovement)
}

/** Le solde vient du serveur, toujours. Il ne se stocke pas et ne s'additionne
 *  pas ici : un solde recalculé dans le navigateur diverge au premier arrondi. */
export async function loadSupplierBalance(supplierId: string): Promise<number> {
  if (!HAS_BACKEND) return 0
  const { data, error } = await sb().rpc('supplier_balance', { p_supplier: supplierId })
  if (error) throw new Error(error.message)
  return num(data)
}

export async function addSupplierMovement(
  agencyId: string, supplierId: string,
  draft: { shipmentId: string | null; kind: SupplierMovementKind; reference: string | null; amount: number; currency: string; fxRate: number; occurredOn: string; note: string | null },
): Promise<void> {
  const { error } = await sb().from('supplier_transactions').insert({
    agency_id: agencyId, supplier_id: supplierId, shipment_id: draft.shipmentId,
    kind: draft.kind, reference: draft.reference, amount: draft.amount,
    currency: draft.currency, fx_rate: draft.fxRate, occurred_on: draft.occurredOn, note: draft.note,
  })
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Crédit client                                                       */
/* ------------------------------------------------------------------ */

export interface ClientCredit {
  clientId: string
  agencyId: string
  creditLimit: number
  paymentTermsDays: number
  currency: string
  onHold: boolean
  holdReason: string | null
  updatedAt: string
}

/** Rendu par le serveur. L'encours est CALCULÉ depuis les factures, ou à défaut
 *  depuis les règlements dus. Il n'est jamais stocké. */
export interface CreditState {
  limite: number
  encours: number
  disponible: number
  jours_de_retard: number
  bloque: boolean
  devise: string
  delai_paiement_jours: number
  motif: string | null
  configure: boolean
  source: 'factures' | 'reglements'
}

const toCredit = (r: Row): ClientCredit => ({
  clientId: r.client_id, agencyId: r.agency_id, creditLimit: num(r.credit_limit),
  paymentTermsDays: num(r.payment_terms_days), currency: r.currency,
  onHold: Boolean(r.on_hold), holdReason: r.hold_reason, updatedAt: r.updated_at,
})

export async function loadClientCredit(clientId: string): Promise<ClientCredit | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().from('client_credit').select('*')
    .eq('client_id', clientId).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toCredit(data as Row) : null
}

export async function loadCreditState(clientId: string): Promise<CreditState | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('client_credit_state', { p_client: clientId })
  if (error) throw new Error(error.message)
  return (data ?? null) as CreditState | null
}

export interface CreditDraft {
  creditLimit: number
  paymentTermsDays: number
  currency: string
  onHold: boolean
  holdReason: string | null
}

export async function saveClientCredit(
  agencyId: string, clientId: string, draft: CreditDraft,
): Promise<void> {
  const { error } = await sb().from('client_credit').upsert({
    client_id: clientId, agency_id: agencyId, credit_limit: draft.creditLimit,
    payment_terms_days: draft.paymentTermsDays, currency: draft.currency,
    on_hold: draft.onHold, hold_reason: draft.holdReason,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id' })
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Checklist douanière                                                 */
/* ------------------------------------------------------------------ */

export type ChecklistDirection = 'IMPORT' | 'EXPORT' | 'TRANSIT'
export type ChecklistMode = 'maritime' | 'aerien' | 'routier' | 'ferroviaire'

export const CHECKLIST_DIRECTIONS: ChecklistDirection[] = ['IMPORT', 'EXPORT', 'TRANSIT']
export const CHECKLIST_MODES: ChecklistMode[] = ['maritime', 'aerien', 'routier', 'ferroviaire']

export interface CustomsChecklist {
  id: string
  agencyId: string
  name: string
  direction: ChecklistDirection | null
  originCountry: string | null
  destinationCountry: string | null
  hsChapter: string | null
  transportMode: ChecklistMode | null
  active: boolean
}

export interface CustomsChecklistItem {
  id: string
  checklistId: string
  code: string
  label: I18nText
  required: boolean
  position: number
  help: string | null
}

/** Ce que le serveur rend pour une cargaison : la liste retenue, et l'état de
 *  chaque pièce croisé avec les documents réellement reçus. */
export interface ChecklistPiece {
  code: string
  label: I18nText
  required: boolean
  position: number
  help: string | null
  document_state: string | null
  etat: 'presente' | 'manquante'
  received_at: string | null
}

export interface ChecklistResult {
  checklist: {
    id: string
    name: string
    direction: ChecklistDirection | null
    origin_country: string | null
    destination_country: string | null
    hs_chapter: string | null
    transport_mode: ChecklistMode | null
    specificite: number
  } | null
  direction: ChecklistDirection | null
  transport_mode: ChecklistMode | null
  hs_chapter: string | null
  pieces: ChecklistPiece[]
  manquantes: number
  manquantes_requises: number
}

const toChecklist = (r: Row): CustomsChecklist => ({
  id: r.id, agencyId: r.agency_id, name: r.name, direction: r.direction,
  originCountry: r.origin_country, destinationCountry: r.destination_country,
  hsChapter: r.hs_chapter, transportMode: r.transport_mode, active: Boolean(r.active),
})

const toChecklistItem = (r: Row): CustomsChecklistItem => ({
  id: r.id, checklistId: r.checklist_id, code: r.code, label: r.label,
  required: Boolean(r.required), position: num(r.position), help: r.help,
})

export async function loadChecklistFor(shipmentId: string): Promise<ChecklistResult | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('customs_checklist_for', { p_shipment: shipmentId })
  if (error) throw new Error(error.message)
  return (data ?? null) as ChecklistResult | null
}

export async function loadChecklists(): Promise<CustomsChecklist[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('customs_checklists').select('*').order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map(toChecklist)
}

export async function loadChecklistItems(checklistId: string): Promise<CustomsChecklistItem[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('customs_checklist_items').select('*')
    .eq('checklist_id', checklistId).order('position')
  if (error) throw new Error(error.message)
  return (data ?? []).map(toChecklistItem)
}

export interface ChecklistDraft {
  name: string
  direction: ChecklistDirection | null
  originCountry: string | null
  destinationCountry: string | null
  hsChapter: string | null
  transportMode: ChecklistMode | null
  active: boolean
}

export async function saveChecklist(
  agencyId: string, id: string | null, draft: ChecklistDraft,
): Promise<string> {
  const row = {
    name: draft.name, direction: draft.direction, origin_country: draft.originCountry,
    destination_country: draft.destinationCountry, hs_chapter: draft.hsChapter,
    transport_mode: draft.transportMode, active: draft.active,
  }
  const { data, error } = id
    ? await sb().from('customs_checklists').update(row).eq('id', id).select('id').single()
    : await sb().from('customs_checklists').insert({ ...row, agency_id: agencyId }).select('id').single()
  if (error) throw new Error(error.message)
  return (data as Row).id
}

export async function removeChecklist(id: string): Promise<void> {
  const { error } = await sb().from('customs_checklists').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export interface ChecklistItemDraft {
  code: string
  label: I18nText
  required: boolean
  position: number
  help: string | null
}

export async function saveChecklistItem(
  agencyId: string, checklistId: string, id: string | null, draft: ChecklistItemDraft,
): Promise<void> {
  const row = {
    code: draft.code, label: draft.label, required: draft.required,
    position: draft.position, help: draft.help,
  }
  const { error } = id
    ? await sb().from('customs_checklist_items').update(row).eq('id', id)
    : await sb().from('customs_checklist_items').insert({ ...row, agency_id: agencyId, checklist_id: checklistId })
  if (error) throw new Error(error.message)
}

export async function removeChecklistItem(id: string): Promise<void> {
  const { error } = await sb().from('customs_checklist_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Installe le socle import et export d'une agence. Le serveur ne le pose
 *  qu'une fois : rappeler la fonction ne double aucune ligne. */
export async function seedChecklists(agencyId: string): Promise<number> {
  const { data, error } = await sb().rpc('seed_customs_checklists', { p_agency: agencyId })
  if (error) throw new Error(error.message)
  return num(data)
}

/* ------------------------------------------------------------------ */
/* Le statut public douanier                                           */
/* ------------------------------------------------------------------ */

/** Le libellé destiné au client. Il ne contient AUCUNE prévision et AUCUN
 *  engagement : on l'affiche tel quel, on ne lui ajoute jamais de date. */
export interface PublicStatus {
  code: string
  label: I18nText
  previsionnel: false
  as_of: string
}

export interface PublicStatusOption {
  code: string
  label: I18nText
  position: number
}

export async function loadPublicStatus(shipmentId: string): Promise<PublicStatus | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('customs_public_status', { p_shipment: shipmentId })
  if (error) throw new Error(error.message)
  return (data ?? null) as PublicStatus | null
}

export async function loadPublicStatusOptions(): Promise<PublicStatusOption[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('customs_public_statuses')
    .select('code, label, position').eq('active', true).order('position')
  if (error) throw new Error(error.message)
  return (data ?? []) as PublicStatusOption[]
}

/** On ne publie qu'un code du vocabulaire clos. Le serveur refuse le reste. */
export async function publishStatus(
  agencyId: string, shipmentId: string, code: string,
): Promise<void> {
  const { error } = await sb().from('customs_public_notices').insert({
    agency_id: agencyId, shipment_id: shipmentId, code,
  })
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Intégrations transporteurs                                          */
/* ------------------------------------------------------------------ */

export type CarrierApiKind = 'rest' | 'edi' | 'webhook' | 'aucune'

export interface CarrierIntegration {
  id: string
  agencyId: string
  carrierId: string | null
  provider: string
  apiKind: CarrierApiKind
  /** Le NOM du secret dans le coffre, jamais sa valeur. */
  secretName: string | null
  baseUrl: string | null
  active: boolean
  lastSyncAt: string | null
  lastError: string | null
}

export async function loadCarrierIntegrations(): Promise<CarrierIntegration[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().from('carrier_integrations').select('*').order('provider')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: Row) => ({
    id: r.id, agencyId: r.agency_id, carrierId: r.carrier_id, provider: r.provider,
    apiKind: r.api_kind, secretName: r.secret_name, baseUrl: r.base_url,
    active: Boolean(r.active), lastSyncAt: r.last_sync_at, lastError: r.last_error,
  }))
}
