/* Les appels du module logistique aval.
 *
 * Le magasin central (`data/store.tsx`) charge l'agence en un instantané. Ce
 * module-ci est arrivé après, et ses écrans lisent peu de lignes à la fois :
 * une cargaison, une journée de tournée, un entrepôt. Il interroge donc
 * Supabase directement plutôt que de gonfler l'instantané de tables que la
 * plupart des écrans n'ouvriront jamais.
 *
 * Sans backend (la démonstration hors ligne), tout rend vide et rien ne casse.
 * Les écritures, elles, le disent : mieux vaut un message clair qu'un
 * enregistrement qui n'a jamais eu lieu.
 */

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { camelKeys, snakeKeys } from '@/lib/case'
import type {
  CostKind, DeliveryStatus, MovementDirection,
  OriginCertificateKind, OriginCertificateStatus,
} from '@/lib/logistique'

/* ------------------------------------------------------------------ */
/* Les formes                                                          */
/* ------------------------------------------------------------------ */

export interface ArrivalNotice {
  id: string
  agencyId: string
  officeId?: string | null
  shipmentId: string
  carrierName?: string | null
  reference?: string | null
  arrivalLocation?: string | null
  estimatedArrival?: string | null
  actualArrival?: string | null
  storageStartDate?: string | null
  freeDays?: number | null
  /** Calculé par la base, jamais saisi : début de stockage plus jours francs. */
  demurrageStartDate?: string | null
  documentPath?: string | null
  receivedAt?: string | null
  note?: string | null
}

export interface OriginCertificate {
  id: string
  agencyId: string
  shipmentId: string
  lotId?: string | null
  kind: OriginCertificateKind
  originCountry?: string | null
  destinationCountry?: string | null
  reference?: string | null
  issueDate?: string | null
  expiryDate?: string | null
  issuer?: string | null
  status: OriginCertificateStatus
  documentPath?: string | null
  note?: string | null
}

export interface AirWaybill {
  id: string
  agencyId: string
  shipmentId: string
  awbNumber: string
  kind: 'MASTER' | 'HOUSE'
  airline?: string | null
  airportOrigin?: string | null
  airportDestination?: string | null
  flightNumber?: string | null
  departureDate?: string | null
  arrivalDate?: string | null
  pieces?: number | null
  weightKg?: number | null
  chargeableWeightKg?: number | null
  documentPath?: string | null
  note?: string | null
}

export interface RoadShipment {
  id: string
  agencyId: string
  shipmentId: string
  carrierName?: string | null
  truckRegistration?: string | null
  trailerRegistration?: string | null
  driverName?: string | null
  driverPhone?: string | null
  cmrNumber?: string | null
  borderCrossing?: string | null
  departureAt?: string | null
  arrivalAt?: string | null
  note?: string | null
}

export interface Warehouse {
  id: string
  agencyId: string
  officeId?: string | null
  name: string
  address?: string | null
  city?: string | null
  country?: string | null
  capacityCbm?: number | null
  contactName?: string | null
  contactPhone?: string | null
  active: boolean
  note?: string | null
}

export interface WarehouseMovement {
  id: string
  agencyId: string
  warehouseId: string
  shipmentId?: string | null
  lotId?: string | null
  direction: MovementDirection
  quantity?: number | null
  packageCount?: number | null
  weightKg?: number | null
  volumeCbm?: number | null
  at: string
  operatorId?: string | null
  note?: string | null
}

export interface Delivery {
  id: string
  agencyId: string
  officeId?: string | null
  shipmentId?: string | null
  lotId?: string | null
  clientId?: string | null
  address?: string | null
  contactName?: string | null
  contactPhone?: string | null
  plannedAt?: string | null
  deliveredAt?: string | null
  driverName?: string | null
  driverPhone?: string | null
  vehicle?: string | null
  status: DeliveryStatus
  failureReason?: string | null
  note?: string | null
}

export interface ProofOfDelivery {
  id: string
  agencyId: string
  deliveryId: string
  recipientName?: string | null
  recipientIdNumber?: string | null
  signaturePath?: string | null
  photoPath?: string | null
  signedAt?: string | null
  gpsLat?: number | null
  gpsLng?: number | null
  note?: string | null
}

export interface ShipmentCost {
  id: string
  agencyId: string
  shipmentId: string
  lotId?: string | null
  kind: CostKind
  supplierName?: string | null
  supplierId?: string | null
  amount: number
  currency: string
  fxRate: number
  /** Calculé par la base : le montant dans la devise de l'agence. */
  amountBase?: number | null
  billableToClient: boolean
  invoiceReference?: string | null
  incurredOn?: string | null
  note?: string | null
  createdBy?: string | null
  createdAt?: string | null
}

/** Ce que rend `shipment_cost_summary`. */
export interface CostSummary {
  shipment: string
  currency: string
  lignes: number
  parNature: Record<string, number>
  totalBase: number
  totalRefacturable: number
  totalNonRefacturable: number
}

/** Ce que rend `shipment_pnl`. */
export interface ShipmentPnl {
  shipment: string
  currency: string
  facture: number
  encaisse: number
  resteAEncaisser: number
  couts: number
  marge: number
  margePct: number | null
  sourceFactures: boolean
}

/** Une ligne de la tournée du jour, telle que `delivery_plan` la rend. */
export interface PlannedDelivery {
  id: string
  status: DeliveryStatus
  plannedAt?: string | null
  deliveredAt?: string | null
  address?: string | null
  contactName?: string | null
  contactPhone?: string | null
  driverName?: string | null
  driverPhone?: string | null
  vehicle?: string | null
  failureReason?: string | null
  client?: string | null
  clientId?: string | null
  shipmentId?: string | null
  reference?: string | null
  proof?: { signedAt?: string | null; recipientName?: string | null } | null
}

/** Ce que rend `arrival_watch`. */
export interface ArrivalWatch {
  agency: string
  days: number
  arrivees: {
    shipmentId: string
    reference?: string | null
    destPort?: string | null
    carrier?: string | null
    eta?: string | null
    noticeId?: string | null
    arrivalLocation?: string | null
  }[]
  francsQuiFinissent: {
    noticeId: string
    shipmentId: string
    reference?: string | null
    storageStartDate?: string | null
    freeDays?: number | null
    demurrageStartDate?: string | null
    joursRestants?: number | null
  }[]
  enSurestaries: {
    shipmentId: string
    reference?: string | null
    destPort?: string | null
    compteurs: { kind: string; status: string; amount?: number; currency?: string; overdueDays?: number }[]
  }[]
}

/* ------------------------------------------------------------------ */
/* Le socle                                                            */
/* ------------------------------------------------------------------ */

export const hasBackend = Boolean(supabase)

function client() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

/** Une lecture qui ne casse jamais un écran : sans backend, la liste est vide. */
async function read<T>(table: string, build: (q: any) => any): Promise<T[]> {
  if (!supabase) return []
  const { data, error } = await build(supabase.from(table).select('*'))
  if (error) throw new Error(`${table}: ${error.message}`)
  return (data ?? []).map((row: unknown) => camelKeys<T>(row))
}

async function write<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().from(table).insert(snakeKeys(row)).select().single()
  if (error) throw new Error(error.message)
  return camelKeys<T>(data)
}

async function change<T>(table: string, id: string, changes: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().from(table).update(snakeKeys(changes)).eq('id', id).select().single()
  if (error) throw new Error(error.message)
  return camelKeys<T>(data)
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return (data ?? null) as T | null
}

/* ------------------------------------------------------------------ */
/* Le chargement d'un écran                                            */
/* ------------------------------------------------------------------ */

/**
 * Charge une lecture distante, et la recharge quand la clé change ou qu'on le
 * demande. Une erreur de réseau ne vide pas l'écran : elle s'affiche à côté
 * des dernières données connues, parce qu'un tableau vide se lit comme
 * « il n'y a rien », ce qui est faux et coûte cher.
 */
export function useRemote<T>(key: string, load: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [tick, setTick] = useState(0)
  const latest = useRef(load)
  latest.current = load

  useEffect(() => {
    let alive = true
    setBusy(true)
    latest.current()
      .then((result) => { if (alive) { setData(result); setError(undefined) } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [key, tick])

  return { data, busy, error, reload: () => setTick((t) => t + 1) }
}

/* ------------------------------------------------------------------ */
/* Les pièces jointes                                                  */
/* ------------------------------------------------------------------ */

/**
 * Le chemin commence TOUJOURS par l'identifiant de l'agence : c'est la règle
 * du seau depuis 0009, et c'est elle qui empêche une agence de lire les
 * fichiers d'une autre. Le nom d'origine n'est jamais repris tel quel.
 */
export function logisticsPath(agencyId: string, scope: string, id: string, file: File): string {
  const dot = file.name.lastIndexOf('.')
  const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : ''
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14)
  return `${agencyId}/${scope}/${id}/${rand}${ext}`
}

/** Dépose un fichier dans le seau « transport » et rend son chemin. */
export async function uploadLogisticsFile(
  agencyId: string, scope: string, id: string, file: File,
): Promise<string> {
  const path = logisticsPath(agencyId, scope, id, file)
  const { error } = await client().storage.from('transport').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw new Error(error.message)
  return path
}

/** Un lien de consultation, valable une heure. Le seau est privé. */
export async function logisticsFileUrl(path?: string | null): Promise<string | undefined> {
  if (!path || !supabase) return undefined
  const { data } = await supabase.storage.from('transport').createSignedUrl(path, 3600)
  return data?.signedUrl
}

/* ------------------------------------------------------------------ */
/* Les avis d'arrivée                                                  */
/* ------------------------------------------------------------------ */

export const listArrivalNotices = (shipmentId: string) =>
  read<ArrivalNotice>('arrival_notices', (q) => q.eq('shipment_id', shipmentId).order('received_at', { ascending: false }))

export const addArrivalNotice = (row: Partial<ArrivalNotice>) =>
  write<ArrivalNotice>('arrival_notices', row as Record<string, unknown>)

export const updateArrivalNotice = (id: string, changes: Partial<ArrivalNotice>) =>
  change<ArrivalNotice>('arrival_notices', id, changes as Record<string, unknown>)

/* ------------------------------------------------------------------ */
/* Les documents de transport                                          */
/* ------------------------------------------------------------------ */

export const listAirWaybills = (shipmentId: string) =>
  read<AirWaybill>('air_waybills', (q) => q.eq('shipment_id', shipmentId).order('created_at'))

export const addAirWaybill = (row: Partial<AirWaybill>) =>
  write<AirWaybill>('air_waybills', row as Record<string, unknown>)

export const listRoadShipments = (shipmentId: string) =>
  read<RoadShipment>('road_shipments', (q) => q.eq('shipment_id', shipmentId).order('created_at'))

export const addRoadShipment = (row: Partial<RoadShipment>) =>
  write<RoadShipment>('road_shipments', row as Record<string, unknown>)

export const listOriginCertificates = (shipmentId: string) =>
  read<OriginCertificate>('origin_certificates', (q) => q.eq('shipment_id', shipmentId).order('created_at'))

export const addOriginCertificate = (row: Partial<OriginCertificate>) =>
  write<OriginCertificate>('origin_certificates', row as Record<string, unknown>)

export const updateOriginCertificate = (id: string, changes: Partial<OriginCertificate>) =>
  change<OriginCertificate>('origin_certificates', id, changes as Record<string, unknown>)

/* ------------------------------------------------------------------ */
/* L'entrepôt                                                          */
/* ------------------------------------------------------------------ */

export const listWarehouses = () =>
  read<Warehouse>('warehouses', (q) => q.order('name'))

export const addWarehouse = (row: Partial<Warehouse>) =>
  write<Warehouse>('warehouses', row as Record<string, unknown>)

export const updateWarehouse = (id: string, changes: Partial<Warehouse>) =>
  change<Warehouse>('warehouses', id, changes as Record<string, unknown>)

export const listMovements = (warehouseId: string, limit = 200) =>
  read<WarehouseMovement>('warehouse_movements', (q) =>
    q.eq('warehouse_id', warehouseId).order('at', { ascending: false }).limit(limit))

export const addMovement = (row: Partial<WarehouseMovement>) =>
  write<WarehouseMovement>('warehouse_movements', row as Record<string, unknown>)

/* ------------------------------------------------------------------ */
/* Les livraisons                                                      */
/* ------------------------------------------------------------------ */

export const listDeliveries = (shipmentId: string) =>
  read<Delivery>('deliveries', (q) => q.eq('shipment_id', shipmentId).order('planned_at'))

export const addDelivery = (row: Partial<Delivery>) =>
  write<Delivery>('deliveries', row as Record<string, unknown>)

export const updateDelivery = (id: string, changes: Partial<Delivery>) =>
  change<Delivery>('deliveries', id, changes as Record<string, unknown>)

export const listProofs = (deliveryId: string) =>
  read<ProofOfDelivery>('proof_of_delivery', (q) => q.eq('delivery_id', deliveryId).order('signed_at', { ascending: false }))

/**
 * Une preuve s'ajoute, elle ne se modifie jamais : la base refuse la mise à
 * jour, par absence de droit et par déclencheur. Corriger une preuve, c'est en
 * ajouter une seconde. Il n'y a donc volontairement pas d'`updateProof` ici.
 */
export const addProof = (row: Partial<ProofOfDelivery>) =>
  write<ProofOfDelivery>('proof_of_delivery', row as Record<string, unknown>)

/** La tournée d'un bureau pour une journée. */
export async function deliveryPlan(officeId: string, day: string): Promise<PlannedDelivery[]> {
  const data = await call<unknown[]>('delivery_plan', { p_office: officeId, p_day: day })
  return (data ?? []).map((row) => camelKeys<PlannedDelivery>(row))
}

/* ------------------------------------------------------------------ */
/* Les coûts, la marge, la veille                                      */
/* ------------------------------------------------------------------ */

export const listCosts = (shipmentId: string) =>
  read<ShipmentCost>('shipment_costs', (q) => q.eq('shipment_id', shipmentId).order('incurred_on', { ascending: false }))

export const addCost = (row: Partial<ShipmentCost>) =>
  write<ShipmentCost>('shipment_costs', row as Record<string, unknown>)

export const updateCost = (id: string, changes: Partial<ShipmentCost>) =>
  change<ShipmentCost>('shipment_costs', id, changes as Record<string, unknown>)

export async function costSummary(shipmentId: string): Promise<CostSummary | null> {
  const data = await call<unknown>('shipment_cost_summary', { p_shipment: shipmentId })
  return data ? camelKeys<CostSummary>(data) : null
}

export async function shipmentPnl(shipmentId: string): Promise<ShipmentPnl | null> {
  const data = await call<unknown>('shipment_pnl', { p_shipment: shipmentId })
  return data ? camelKeys<ShipmentPnl>(data) : null
}

/**
 * La veille des arrivées. C'est l'écran qui fait gagner de l'argent : ce qui
 * arrive, ce dont les jours francs se terminent, et ce qui coûte déjà.
 */
export async function arrivalWatch(agencyId: string, days = 7): Promise<ArrivalWatch | null> {
  const data = await call<unknown>('arrival_watch', { p_agency: agencyId, p_days: days })
  return data ? camelKeys<ArrivalWatch>(data) : null
}
