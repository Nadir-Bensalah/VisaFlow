/* Les appels du module « référentiels du fret ».
 *
 * Le magasin central (`data/store.tsx`) charge toute l'agence en un
 * instantané. Ces tables-ci n'y entrent pas, et c'est voulu : une agence qui
 * travaille depuis trois ans a des centaines de fiches et des milliers de
 * lignes de colis. Les charger au démarrage ralentirait tous les écrans pour
 * servir deux d'entre eux. On interroge donc Supabase à l'ouverture de
 * l'écran concerné.
 *
 * Sans backend (la démonstration hors ligne), les lectures rendent vide et
 * rien ne casse. Les écritures, elles, le DISENT : un enregistrement qui n'a
 * jamais eu lieu et qui ne prévient pas est pire qu'une erreur.
 */

import { supabase } from '@/lib/supabase'
import { camelKeys, snakeKeys } from '@/lib/case'

/* ------------------------------------------------------------------ */
/* Les formes                                                          */
/* ------------------------------------------------------------------ */

export type DirectoryKind =
  | 'suppliers' | 'consignees' | 'shippers' | 'carriers' | 'customs_brokers'

export const DIRECTORY_KINDS: DirectoryKind[] =
  ['suppliers', 'consignees', 'shippers', 'carriers', 'customs_brokers']

export type CarrierKind =
  | 'compagnie_maritime' | 'compagnie_aerienne'
  | 'transporteur_routier' | 'messagerie' | 'commissionnaire'

export const CARRIER_KINDS: CarrierKind[] = [
  'compagnie_maritime', 'compagnie_aerienne',
  'transporteur_routier', 'messagerie', 'commissionnaire',
]

/* Une seule forme pour les cinq répertoires. Ils ne portent pas les mêmes
   champs, mais l'écran est le même : cinq onglets, un tableau, un
   formulaire. Cinq interfaces feraient cinq formulaires à maintenir. */
export interface DirectoryEntry {
  id?: string
  agencyId?: string
  /** Quatre répertoires sur cinq nomment une société. */
  companyName?: string | null
  /** Les transporteurs, eux, ont un nom simple. */
  name?: string | null
  kind?: CarrierKind | null
  contactName?: string | null
  country?: string | null
  city?: string | null
  address?: string | null
  email?: string | null
  phone?: string | null
  whatsapp?: string | null
  taxId?: string | null
  registrationNumber?: string | null
  customsCode?: string | null
  clientId?: string | null
  scacCode?: string | null
  iataCode?: string | null
  website?: string | null
  active?: boolean
  note?: string | null
  createdAt?: string
  deletedAt?: string | null
}

/** Le nom affichable, quel que soit le répertoire. */
export function entryLabel(e: DirectoryEntry): string {
  return (e.companyName ?? e.name ?? '').trim()
}

export interface Country {
  iso2: string
  iso3: string
  nameFr: string
  nameEn: string
  nameAr: string
  active: boolean
}

export type LocationKind = 'PORT' | 'AEROPORT' | 'ENTREPOT' | 'BUREAU_DOUANE' | 'POSTE_FRONTIERE'

export interface TransportLocation {
  id: string
  kind: LocationKind
  name: string
  /** UN/LOCODE, absent quand il n'est pas sûr. Un code faux route la
      marchandise ailleurs : mieux vaut la case vide. */
  code?: string | null
  countryCode: string
  city?: string | null
  address?: string | null
  active: boolean
}

export interface HsChapter {
  code: string
  descriptionFr: string
  descriptionEn: string
  chapter: string
  active: boolean
}

export interface Incoterm {
  code: string
  nameFr: string
  nameEn: string
  transferPointFr: string
  mode: 'tous' | 'maritime'
  version: number
  active: boolean
}

export type ContainerType =
  | '20GP' | '40GP' | '40HC' | '45HC' | 'REEFER' | 'OPEN_TOP' | 'FLAT_RACK' | 'TANK' | 'AUTRE'

export const CONTAINER_TYPES: ContainerType[] = [
  '20GP', '40GP', '40HC', '45HC', 'REEFER', 'OPEN_TOP', 'FLAT_RACK', 'TANK', 'AUTRE',
]

export type ContainerStatus =
  | 'vide' | 'charge' | 'parti' | 'en_transit' | 'arrive'
  | 'douane' | 'dedouane' | 'livre' | 'restitue'

export const CONTAINER_STATUSES: ContainerStatus[] = [
  'vide', 'charge', 'parti', 'en_transit', 'arrive', 'douane', 'dedouane', 'livre', 'restitue',
]

export interface CargoContainer {
  id?: string
  agencyId?: string
  shipmentId: string
  containerNumber: string
  containerType: ContainerType
  sealNumber?: string | null
  grossWeightKg?: number | null
  netWeightKg?: number | null
  volumeCbm?: number | null
  tareKg?: number | null
  status: ContainerStatus
  gateOutAt?: string | null
  returnedAt?: string | null
  note?: string | null
  deletedAt?: string | null
}

export type PackageType = 'CARTON' | 'PALETTE' | 'SAC' | 'CAISSE' | 'FUT' | 'ROULEAU' | 'AUTRE'

export const PACKAGE_TYPES: PackageType[] =
  ['CARTON', 'PALETTE', 'SAC', 'CAISSE', 'FUT', 'ROULEAU', 'AUTRE']

export interface CargoPackage {
  id?: string
  agencyId?: string
  shipmentId: string
  lotId?: string | null
  packageNumber?: string | null
  packageType: PackageType
  quantity: number
  grossWeightKg?: number | null
  netWeightKg?: number | null
  lengthCm?: number | null
  widthCm?: number | null
  heightCm?: number | null
  /** Calculé par la base, jamais saisi : trois dimensions et une quantité. */
  volumeCbm?: number | null
  description?: string | null
  deletedAt?: string | null
}

export interface CargoGoods {
  id?: string
  agencyId?: string
  shipmentId: string
  lotId?: string | null
  description: string
  commercialDescription?: string | null
  hsCode?: string | null
  originCountry?: string | null
  quantity?: number | null
  unit?: string | null
  grossWeightKg?: number | null
  netWeightKg?: number | null
  unitValue?: number | null
  /** Calculé par la base : quantité fois valeur unitaire. */
  totalValue?: number | null
  currency: string
  dangerousGoods: boolean
  unNumber?: string | null
  temperatureMin?: number | null
  temperatureMax?: number | null
  note?: string | null
  deletedAt?: string | null
}

/** Un intervenant résolu. `source` dit toujours d'où vient le nom : une fiche
    du répertoire, ou le texte que quelqu'un a tapé un jour. */
export interface ResolvedActor {
  source: 'repertoire' | 'referentiel' | 'texte'
  id?: string
  name?: string
  contact?: string | null
  country?: string | null
  city?: string | null
  phone?: string | null
  email?: string | null
  taxId?: string | null
  customs_code?: string | null
  client_id?: string | null
  scac_code?: string | null
  iata_code?: string | null
  website?: string | null
  kind?: string | null
  code?: string | null
}

export interface ShipmentActors {
  supplier?: ResolvedActor | null
  consignee?: ResolvedActor | null
  shipper?: ResolvedActor | null
  carrier?: ResolvedActor | null
  broker?: ResolvedActor | null
  handler?: ResolvedActor | null
  origin?: ResolvedActor | null
  dest?: ResolvedActor | null
  incoterm?: {
    source: 'referentiel' | 'texte'
    code: string
    name_fr?: string
    name_en?: string
    transfer_point_fr?: string
    mode?: 'tous' | 'maritime'
    coherent: boolean
  } | null
}

export interface ShipmentTotals {
  containers: number
  packages: number
  goods_lines: number
  gross_weight_kg: number | null
  weight_source: 'conteneurs' | 'colis' | 'marchandises' | 'cargaison' | null
  volume_cbm: number | null
  volume_source: 'conteneurs' | 'colis' | 'cargaison' | null
  chargeable_units: number | null
  values: { currency: string; amount: number }[]
  dangerous_goods: boolean
  hs_chapters: string[]
}

/** Les identifiants qu'on pose sur la cargaison. Les colonnes texte
    d'origine ne sont JAMAIS touchées : la reprise se décide, elle ne se
    subit pas. */
export interface ActorLinks {
  supplierId?: string | null
  consigneeId?: string | null
  shipperId?: string | null
  carrierId?: string | null
  brokerId?: string | null
  originLocationId?: string | null
  destLocationId?: string | null
  incotermCode?: string | null
}

/* ------------------------------------------------------------------ */
/* Le socle                                                            */
/* ------------------------------------------------------------------ */

function client() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

/** Hors ligne, une lecture rend vide plutôt que de faire tomber l'écran. */
async function read<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  if (!supabase) return fallback
  return run()
}

async function rows<T>(table: string, apply: (q: any) => any): Promise<T[]> {
  const { data, error } = await apply(client().from(table).select('*'))
  if (error) throw new Error(`${table}: ${error.message}`)
  return (data ?? []).map((r: unknown) => camelKeys<T>(r))
}

/* ------------------------------------------------------------------ */
/* 1 · Les répertoires de l'agence                                     */
/* ------------------------------------------------------------------ */

export async function listDirectory(kind: DirectoryKind, agencyId: string): Promise<DirectoryEntry[]> {
  return read(() => rows<DirectoryEntry>(kind, (q) =>
    q.eq('agency_id', agencyId).is('deleted_at', null)), [])
}

/** Crée ou met à jour une fiche. Rend l'identifiant, pour rattacher tout de
    suite la cargaison qu'on était en train de saisir. */
export async function saveDirectoryEntry(
  kind: DirectoryKind, agencyId: string, entry: DirectoryEntry,
): Promise<string> {
  const { id, createdAt, agencyId: _ignored, ...rest } = entry
  void createdAt; void _ignored
  const payload = snakeKeys(rest as Record<string, unknown>)
  if (id) {
    const { error } = await client().from(kind).update(payload).eq('id', id)
    if (error) throw new Error(error.message)
    return id
  }
  const { data, error } = await client().from(kind)
    .insert({ ...payload, agency_id: agencyId }).select('id').single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

/** On archive, on n'efface jamais : une fiche effacée emporterait la
    traçabilité des cargaisons passées. Le droit de suppression n'est
    d'ailleurs pas accordé côté base. */
export async function archiveDirectoryEntry(kind: DirectoryKind, id: string): Promise<void> {
  const { error } = await client().from(kind)
    .update({ deleted_at: new Date().toISOString(), active: false }).eq('id', id)
  if (error) throw new Error(error.message)
}

export interface DirectoryHit {
  kind: DirectoryKind
  id: string
  name: string
  subtitle?: string | null
  country?: string | null
  city?: string | null
  phone?: string | null
  email?: string | null
  active: boolean
}

/** La recherche vit côté base, en droits de l'appelant : une agence
    n'atteint jamais le répertoire d'une autre par ce chemin. */
export async function searchDirectory(
  kind: DirectoryKind, query: string, limit = 20,
): Promise<DirectoryHit[]> {
  return read(async () => {
    const { data, error } = await client().rpc('directory_search', {
      p_kind: kind, p_query: query, p_limit: limit,
    })
    if (error) throw new Error(error.message)
    return (data ?? []) as DirectoryHit[]
  }, [])
}

/* ------------------------------------------------------------------ */
/* 2 · Les référentiels partagés                                       */
/* ------------------------------------------------------------------ */

export async function listCountries(): Promise<Country[]> {
  return read(() => rows<Country>('countries', (q) => q.eq('active', true).order('name_fr')), [])
}

export async function listLocations(kind?: LocationKind): Promise<TransportLocation[]> {
  return read(() => rows<TransportLocation>('transport_locations', (q) => {
    const base = q.eq('active', true).order('name')
    return kind ? base.eq('kind', kind) : base
  }), [])
}

export async function listHsChapters(): Promise<HsChapter[]> {
  return read(() => rows<HsChapter>('hs_codes', (q) => q.eq('active', true).order('code')), [])
}

export async function listIncoterms(): Promise<Incoterm[]> {
  return read(() => rows<Incoterm>('incoterms', (q) => q.eq('active', true).order('code')), [])
}

/* ------------------------------------------------------------------ */
/* 3 · Le détail physique d'une cargaison                              */
/* ------------------------------------------------------------------ */

export async function listContainers(shipmentId: string): Promise<CargoContainer[]> {
  return read(() => rows<CargoContainer>('containers', (q) =>
    q.eq('shipment_id', shipmentId).is('deleted_at', null).order('container_number')), [])
}

export async function saveContainer(agencyId: string, c: CargoContainer): Promise<string> {
  const { id, agencyId: _a, ...rest } = c
  void _a
  const payload = snakeKeys(rest as Record<string, unknown>)
  if (id) {
    const { error } = await client().from('containers').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
    return id
  }
  const { data, error } = await client().from('containers')
    .insert({ ...payload, agency_id: agencyId }).select('id').single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

export async function listPackages(shipmentId: string): Promise<CargoPackage[]> {
  return read(() => rows<CargoPackage>('packages', (q) =>
    q.eq('shipment_id', shipmentId).is('deleted_at', null).order('created_at')), [])
}

export async function savePackage(agencyId: string, p: CargoPackage): Promise<string> {
  // `volume_cbm` est calculé par la base : l'envoyer ferait échouer l'écriture.
  const { id, agencyId: _a, volumeCbm: _v, ...rest } = p
  void _a; void _v
  const payload = snakeKeys(rest as Record<string, unknown>)
  if (id) {
    const { error } = await client().from('packages').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
    return id
  }
  const { data, error } = await client().from('packages')
    .insert({ ...payload, agency_id: agencyId }).select('id').single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

export async function listGoods(shipmentId: string): Promise<CargoGoods[]> {
  return read(() => rows<CargoGoods>('shipment_goods', (q) =>
    q.eq('shipment_id', shipmentId).is('deleted_at', null).order('created_at')), [])
}

export async function saveGoods(agencyId: string, g: CargoGoods): Promise<string> {
  // `total_value` est calculé par la base.
  const { id, agencyId: _a, totalValue: _t, ...rest } = g
  void _a; void _t
  const payload = snakeKeys(rest as Record<string, unknown>)
  if (id) {
    const { error } = await client().from('shipment_goods').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
    return id
  }
  const { data, error } = await client().from('shipment_goods')
    .insert({ ...payload, agency_id: agencyId }).select('id').single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

/** Même règle que pour les répertoires : on archive. Une ligne saisie deux
    fois doit pouvoir sortir des totaux, pas disparaître de l'histoire. */
export async function archiveCargoLine(
  table: 'containers' | 'packages' | 'shipment_goods', id: string,
): Promise<void> {
  const { error } = await client().from(table)
    .update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* 4 · Les intervenants et les totaux, calculés par la base            */
/* ------------------------------------------------------------------ */

export async function shipmentActors(shipmentId: string): Promise<ShipmentActors | null> {
  return read(async () => {
    const { data, error } = await client().rpc('shipment_actors', { p_shipment: shipmentId })
    if (error) throw new Error(error.message)
    return (data ?? null) as ShipmentActors | null
  }, null)
}

export async function shipmentTotals(shipmentId: string): Promise<ShipmentTotals | null> {
  return read(async () => {
    const { data, error } = await client().rpc('shipment_totals', { p_shipment: shipmentId })
    if (error) throw new Error(error.message)
    return (data ?? null) as ShipmentTotals | null
  }, null)
}

/** Rattache une cargaison aux fiches choisies. Les colonnes texte d'origine
    ne bougent pas : c'est la seule trace de ce qui était vraiment écrit sur
    la facture le jour de la saisie. */
export async function linkShipmentActors(shipmentId: string, links: ActorLinks): Promise<void> {
  const { error } = await client().from('shipments')
    .update(snakeKeys(links as Record<string, unknown>)).eq('id', shipmentId)
  if (error) throw new Error(error.message)
}
