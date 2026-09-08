/* Les prestations de voyage parlent au serveur en direct.
 *
 * Le magasin global charge déjà trente-trois tables à chaque ouverture de
 * session. Y ajouter les billets, les hôtels et les assurances ferait payer ce
 * chargement à tout le monde, y compris à qui ne vend jamais un billet.
 *
 * DEUX RÈGLES QUI TIENNENT TOUT CE FICHIER.
 *
 * 1. AUCUNE MARGE N'EST CALCULÉE ICI. La marge est une colonne générée par la
 *    base. Un navigateur qui la recalcule finit toujours par afficher un
 *    chiffre que le rapport dément, et c'est le rapport que le patron croit.
 *
 * 2. LE COÛT NE SE LIT PAS DANS LA TABLE. La base a retiré à tout le monde le
 *    droit de lire les colonnes de coût et de marge, y compris à la direction :
 *    un droit de colonne s'accorde à un rôle, et tout le monde partage le rôle
 *    `authenticated`. Le coût sort donc par des fonctions, qui vérifient
 *    `finance:global` à chaque appel. C'est pour ça que `SELECT_COLS` existe :
 *    un `select *` ferait échouer la requête pour tout le monde.
 */

import { supabase, HAS_BACKEND } from '@/lib/supabase'
import type { I18nText } from '@/data/types'

/* ------------------------------------------------------------------ */
/* Les formes                                                          */
/* ------------------------------------------------------------------ */

export type TravelKind =
  | 'BILLET' | 'HEBERGEMENT' | 'ASSURANCE' | 'TRANSFERT' | 'TRANSPORT' | 'AUTRE'

export const TRAVEL_KINDS: TravelKind[] = [
  'BILLET', 'HEBERGEMENT', 'ASSURANCE', 'TRANSFERT', 'TRANSPORT', 'AUTRE',
]

/** Les états d'un carnet de suivi. VisaFlow ne réserve rien et n'émet rien. */
export type TravelStatus = 'a_faire' | 'enregistre' | 'confirme' | 'annule' | 'rembourse'

export const TRAVEL_STATUSES: TravelStatus[] = [
  'a_faire', 'enregistre', 'confirme', 'annule', 'rembourse',
]

export type Board =
  | 'chambre_seule' | 'petit_dejeuner' | 'demi_pension' | 'pension_complete' | 'tout_compris'

export const BOARDS: Board[] = [
  'chambre_seule', 'petit_dejeuner', 'demi_pension', 'pension_complete', 'tout_compris',
]

/** Une prestation, telle que l'écran la voit. Sans coût ni marge : voir l'en-tête. */
export interface TravelService {
  id: string
  agencyId: string
  officeId: string | null
  caseId: string | null
  clientId: string | null
  kind: TravelKind
  supplierName: string | null
  supplierId: string | null
  serviceId: string | null
  reference: string | null
  status: TravelStatus
  bookedAt: string | null
  cancelledAt: string | null
  documentPath: string | null
  documentName: string | null
  note: string | null
  /** Ce qu'on a facturé au client. Le coût, lui, ne descend pas jusqu'ici. */
  soldAmount: number
  currency: string
  fxRate: number
  createdAt: string
  updatedAt: string

  carrier: string | null
  flightNoOut: string | null
  flightNoBack: string | null
  pnr: string | null
  ticketNumber: string | null
  departFrom: string | null
  departTo: string | null
  departAt: string | null
  returnAt: string | null
  passengers: number | null
  cabin: string | null
  baggageKg: number | null

  hotelName: string | null
  hotelCity: string | null
  hotelAddress: string | null
  checkinDate: string | null
  checkoutDate: string | null
  /** Calculé par le serveur à partir des deux dates. Jamais saisi. */
  nights: number | null
  rooms: number | null
  guests: number | null
  board: Board | null

  insurer: string | null
  policyNumber: string | null
  coverageAmount: number | null
  coverageCurrency: string | null
  coverFrom: string | null
  coverTo: string | null
  coverArea: string | null
  assistancePhone: string | null

  pickupPlace: string | null
  dropoffPlace: string | null
  pickupAt: string | null
  vehicle: string | null
  driverPhone: string | null
}

/** L'argent d'une ligne, rendu par le serveur une fois le droit vérifié. */
export interface TravelMoney {
  id: string
  kind: TravelKind
  sold: number
  cost: number
  margin: number
  marginPct: number | null
  currency: string
  sourceCurrency: string
  fxRate: number
}

/** Une ligne du tableau de marge du dossier, assistance visa comprise. */
export interface MarginLine {
  id: string | null
  kind: TravelKind | 'ASSISTANCE'
  label: string | null
  reference: string | null
  sold: number
  cost: number
  margin: number
  marginPct: number | null
  currency: string
}

export interface MarginBlock {
  sold: number
  cost: number
  margin: number
  marginPct: number | null
}

export interface CaseTravelMargin {
  caseId: string
  currency: string
  lines: MarginLine[]
  travel: MarginBlock
  assistance: MarginBlock
  total: MarginBlock
}

export interface MarginReportLine extends MarginBlock {
  kind: TravelKind
  count: number
}

export interface MarginReport {
  from: string
  to: string
  currency: string
  officeId: string | null
  kinds: MarginReportLine[]
  total: MarginBlock & { count: number }
}

/** Ce que la garde de licence rappelle. Elle ne refuse jamais : voir 0060. */
export interface TravelAllowance {
  autorise: boolean
  categorie: string | null
  /** Codes, traduits par l'écran. Le texte réglementaire ne vit pas en base. */
  avertissements: string[]
}

export interface TravelReadinessItem {
  note: boolean
  reference: string | null
  date: string | null
  status: TravelStatus | null
}

export interface TravelReadiness {
  billet: TravelReadinessItem
  hebergement: TravelReadinessItem
  assurance: TravelReadinessItem
}

/* ------------------------------------------------------------------ */
/* Le pont snake_case / camelCase, limité à ce module                  */
/* ------------------------------------------------------------------ */

function sb() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const opt = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

type Row = Record<string, any>

/* Les colonnes lisibles, nommées une par une.
 *
 * `cost_amount`, `cost_base`, `margin` et `margin_base` n'y sont PAS, et c'est
 * volontaire : la base a retiré le droit de les lire à tout le monde. Un
 * `select *` échouerait ici pour le patron comme pour l'agent. */
const SELECT_COLS = [
  'id', 'agency_id', 'office_id', 'case_id', 'client_id', 'kind',
  'supplier_name', 'supplier_id', 'service_id', 'reference', 'status',
  'booked_at', 'cancelled_at', 'document_path', 'document_name', 'note',
  'sold_amount', 'currency', 'fx_rate', 'created_at', 'updated_at',
  'carrier', 'flight_no_out', 'flight_no_back', 'pnr', 'ticket_number',
  'depart_from', 'depart_to', 'depart_at', 'return_at', 'passengers',
  'cabin', 'baggage_kg',
  'hotel_name', 'hotel_city', 'hotel_address', 'checkin_date', 'checkout_date',
  'nights', 'rooms', 'guests', 'board',
  'insurer', 'policy_number', 'coverage_amount', 'coverage_currency',
  'cover_from', 'cover_to', 'cover_area', 'assistance_phone',
  'pickup_place', 'dropoff_place', 'pickup_at', 'vehicle', 'driver_phone',
].join(', ')

const toService = (r: Row): TravelService => ({
  id: r.id, agencyId: r.agency_id, officeId: r.office_id, caseId: r.case_id,
  clientId: r.client_id, kind: r.kind, supplierName: r.supplier_name,
  supplierId: r.supplier_id, serviceId: r.service_id, reference: r.reference,
  status: r.status, bookedAt: r.booked_at, cancelledAt: r.cancelled_at,
  documentPath: r.document_path, documentName: r.document_name, note: r.note,
  soldAmount: num(r.sold_amount), currency: r.currency, fxRate: num(r.fx_rate),
  createdAt: r.created_at, updatedAt: r.updated_at,

  carrier: r.carrier, flightNoOut: r.flight_no_out, flightNoBack: r.flight_no_back,
  pnr: r.pnr, ticketNumber: r.ticket_number, departFrom: r.depart_from,
  departTo: r.depart_to, departAt: r.depart_at, returnAt: r.return_at,
  passengers: opt(r.passengers), cabin: r.cabin, baggageKg: opt(r.baggage_kg),

  hotelName: r.hotel_name, hotelCity: r.hotel_city, hotelAddress: r.hotel_address,
  checkinDate: r.checkin_date, checkoutDate: r.checkout_date, nights: opt(r.nights),
  rooms: opt(r.rooms), guests: opt(r.guests), board: r.board,

  insurer: r.insurer, policyNumber: r.policy_number,
  coverageAmount: opt(r.coverage_amount), coverageCurrency: r.coverage_currency,
  coverFrom: r.cover_from, coverTo: r.cover_to, coverArea: r.cover_area,
  assistancePhone: r.assistance_phone,

  pickupPlace: r.pickup_place, dropoffPlace: r.dropoff_place, pickupAt: r.pickup_at,
  vehicle: r.vehicle, driverPhone: r.driver_phone,
})

/* Un pourcentage sur zéro vendu n'existe pas : le serveur rend null, on ne le
   remplace pas par 0 %, qui laisserait croire à une vente sans marge. */
const pct = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

const toBlock = (r: Row): MarginBlock => ({
  sold: num(r?.sold), cost: num(r?.cost), margin: num(r?.margin), marginPct: pct(r?.margin_pct),
})

const toMoney = (r: Row): TravelMoney => ({
  id: r.id, kind: r.kind, sold: num(r.sold), cost: num(r.cost), margin: num(r.margin),
  marginPct: pct(r.margin_pct), currency: r.currency ?? 'TND',
  sourceCurrency: r.source_currency ?? r.currency ?? 'TND', fxRate: num(r.fx_rate),
})

const toReadinessItem = (r: Row | null | undefined): TravelReadinessItem => ({
  note: Boolean(r?.note), reference: r?.reference ?? null,
  date: r?.date ?? null, status: r?.status ?? null,
})

/* ------------------------------------------------------------------ */
/* Les lectures                                                        */
/* ------------------------------------------------------------------ */

export interface TravelFilter {
  caseId?: string
  clientId?: string
  kind?: TravelKind
  status?: TravelStatus
  from?: string
  to?: string
}

export async function loadTravelServices(f: TravelFilter = {}): Promise<TravelService[]> {
  if (!HAS_BACKEND) return []
  let q = sb().from('travel_services').select(SELECT_COLS).is('deleted_at', null)
  if (f.caseId) q = q.eq('case_id', f.caseId)
  if (f.clientId) q = q.eq('client_id', f.clientId)
  if (f.kind) q = q.eq('kind', f.kind)
  if (f.status) q = q.eq('status', f.status)
  // La période porte sur la date de saisie, celle où l'agence a noté la
  // prestation. C'est la même que celle du rapport de marge.
  if (f.from) q = q.gte('created_at', f.from)
  if (f.to) q = q.lte('created_at', `${f.to}T23:59:59`)
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as Row[]).map(toService)
}

/** L'argent des lignes. Réservé à `finance:global` : le serveur le vérifie. */
export async function loadTravelMoney(scope: {
  caseId?: string; officeId?: string | null; from?: string | null; to?: string | null
}): Promise<TravelMoney[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().rpc('travel_service_money', {
    p_case: scope.caseId ?? null, p_office: scope.officeId ?? null,
    p_from: scope.from ?? null, p_to: scope.to ?? null,
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map(toMoney)
}

/** Le tableau de marge du dossier, assistance visa comprise. */
export async function loadCaseTravelMargin(caseId: string): Promise<CaseTravelMargin | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('case_travel_margin', { p_case: caseId })
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  return {
    caseId: r.case_id,
    currency: r.currency ?? 'TND',
    lines: ((r.lines ?? []) as Row[]).map((x) => ({
      id: x.id ?? null, kind: x.kind, label: x.label ?? null, reference: x.reference ?? null,
      sold: num(x.sold), cost: num(x.cost), margin: num(x.margin),
      marginPct: pct(x.margin_pct), currency: x.currency ?? r.currency ?? 'TND',
    })),
    travel: toBlock(r.travel), assistance: toBlock(r.assistance), total: toBlock(r.total),
  }
}

export async function loadTravelReport(
  officeId: string | null, from: string | null, to: string | null,
): Promise<MarginReport | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('travel_margin_report', {
    p_office: officeId, p_from: from, p_to: to,
  })
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  return {
    from: r.from, to: r.to, currency: r.currency ?? 'TND', officeId: r.office_id ?? null,
    kinds: ((r.kinds ?? []) as Row[]).map((x) => ({
      kind: x.kind, count: Number(x.count ?? 0), ...toBlock(x),
    })),
    total: { ...toBlock(r.total), count: Number(r.total?.count ?? 0) },
  }
}

/** Le rappel de licence. Il n'interdit rien : il dit ce qu'il y a à vérifier. */
export async function loadTravelAllowance(agencyId: string, kind: TravelKind): Promise<TravelAllowance | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('travel_service_allowed', {
    p_agency: agencyId, p_kind: kind,
  })
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  return {
    autorise: Boolean(r.autorise),
    categorie: r.categorie ?? null,
    avertissements: (r.avertissements ?? []) as string[],
  }
}

/** Assurance, hôtel, billet : notés ou non. Ce que lit la barre du dossier. */
export async function loadTravelReadiness(caseId: string): Promise<TravelReadiness | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('travel_readiness', { p_case: caseId })
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  return {
    billet: toReadinessItem(r.billet),
    hebergement: toReadinessItem(r.hebergement),
    assurance: toReadinessItem(r.assurance),
  }
}

/** Le prix par défaut d'une ligne du catalogue de l'agence. Rien n'est deviné. */
export async function loadCatalogPrefill(serviceId: string): Promise<{
  serviceId: string; name: I18nText; category: string; defaultPrice: number; currency: string
} | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('travel_service_from_catalog', { p_service: serviceId })
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  return {
    serviceId: r.service_id, name: r.name, category: r.category,
    defaultPrice: num(r.default_price), currency: r.currency,
  }
}

/* ------------------------------------------------------------------ */
/* Les écritures                                                       */
/* ------------------------------------------------------------------ */

/** Ce que l'écran envoie. La marge n'y est pas : elle est générée par la base. */
export interface TravelDraft {
  officeId: string | null
  caseId: string | null
  clientId: string | null
  kind: TravelKind
  status: TravelStatus
  supplierName: string | null
  supplierId: string | null
  serviceId: string | null
  reference: string | null
  bookedAt: string | null
  note: string | null
  soldAmount: number
  /** Saisi par qui note la prestation, relu par la seule direction. */
  costAmount: number | null
  currency: string
  fxRate: number

  carrier?: string | null
  flightNoOut?: string | null
  flightNoBack?: string | null
  pnr?: string | null
  ticketNumber?: string | null
  departFrom?: string | null
  departTo?: string | null
  departAt?: string | null
  returnAt?: string | null
  passengers?: number | null
  cabin?: string | null
  baggageKg?: number | null

  hotelName?: string | null
  hotelCity?: string | null
  hotelAddress?: string | null
  checkinDate?: string | null
  checkoutDate?: string | null
  rooms?: number | null
  guests?: number | null
  board?: Board | null

  insurer?: string | null
  policyNumber?: string | null
  coverageAmount?: number | null
  coverageCurrency?: string | null
  coverFrom?: string | null
  coverTo?: string | null
  coverArea?: string | null
  assistancePhone?: string | null

  pickupPlace?: string | null
  dropoffPlace?: string | null
  pickupAt?: string | null
  vehicle?: string | null
  driverPhone?: string | null
}

const nz = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s === '' ? null : s
}

function toRow(d: TravelDraft): Row {
  const r: Row = {
    office_id: d.officeId, case_id: d.caseId, client_id: d.clientId,
    kind: d.kind, status: d.status,
    supplier_name: nz(d.supplierName), supplier_id: d.supplierId,
    service_id: d.serviceId, reference: nz(d.reference),
    booked_at: d.bookedAt, note: nz(d.note),
    sold_amount: d.soldAmount, currency: d.currency, fx_rate: d.fxRate,

    carrier: nz(d.carrier), flight_no_out: nz(d.flightNoOut), flight_no_back: nz(d.flightNoBack),
    pnr: nz(d.pnr), ticket_number: nz(d.ticketNumber),
    depart_from: nz(d.departFrom), depart_to: nz(d.departTo),
    depart_at: d.departAt || null, return_at: d.returnAt || null,
    passengers: d.passengers ?? null, cabin: nz(d.cabin), baggage_kg: d.baggageKg ?? null,

    hotel_name: nz(d.hotelName), hotel_city: nz(d.hotelCity), hotel_address: nz(d.hotelAddress),
    checkin_date: d.checkinDate || null, checkout_date: d.checkoutDate || null,
    rooms: d.rooms ?? null, guests: d.guests ?? null, board: d.board ?? null,

    insurer: nz(d.insurer), policy_number: nz(d.policyNumber),
    coverage_amount: d.coverageAmount ?? null, coverage_currency: nz(d.coverageCurrency),
    cover_from: d.coverFrom || null, cover_to: d.coverTo || null,
    cover_area: nz(d.coverArea), assistance_phone: nz(d.assistancePhone),

    pickup_place: nz(d.pickupPlace), dropoff_place: nz(d.dropoffPlace),
    pickup_at: d.pickupAt || null, vehicle: nz(d.vehicle), driver_phone: nz(d.driverPhone),
  }
  // Le coût n'est envoyé que s'il a été saisi. Sans ce garde, un formulaire
  // ouvert par un agent qui ne voit pas le coût le remettrait à zéro en
  // enregistrant, et la marge du dossier gonflerait toute seule.
  if (d.costAmount !== null && d.costAmount !== undefined) r.cost_amount = d.costAmount
  return r
}

export async function createTravelService(agencyId: string, draft: TravelDraft): Promise<string> {
  const { data, error } = await sb().from('travel_services')
    .insert({ ...toRow(draft), agency_id: agencyId })
    .select('id').single()
  if (error) throw new Error(error.message)
  return (data as Row).id
}

export async function updateTravelService(id: string, draft: TravelDraft): Promise<void> {
  const { error } = await sb().from('travel_services').update(toRow(draft)).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function setTravelStatus(id: string, status: TravelStatus): Promise<void> {
  const { error } = await sb().from('travel_services').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Le document déposé : billet, voucher, attestation. */
export async function attachTravelDocument(
  id: string, path: string | null, name: string | null,
): Promise<void> {
  const { error } = await sb().from('travel_services')
    .update({ document_path: path, document_name: name }).eq('id', id)
  if (error) throw new Error(error.message)
}

/** On range la prestation, on ne l'efface pas : le litige arrive six mois après. */
export async function archiveTravelService(id: string): Promise<void> {
  const { error } = await sb().from('travel_services')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}
