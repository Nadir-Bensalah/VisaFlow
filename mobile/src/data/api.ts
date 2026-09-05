import Constants from 'expo-constants'

/* La couche reseau. Tant que le serveur n'existe pas, elle rend le jeu de
   demonstration. Le jour ou Supabase est en place, seules ces fonctions
   changent : les ecrans ne bougent pas. */

const BASE = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? ''

export type Stage =
  | 'nouveau' | 'pieces' | 'verification' | 'rendez_vous' | 'depot'
  | 'consulat' | 'decision' | 'retrait' | 'clos'

export type ShipmentStage =
  | 'demande' | 'ramassage' | 'entrepot' | 'empotage' | 'depart'
  | 'transit' | 'arrivee' | 'douane' | 'livraison' | 'livre'

export interface DocItem { id: string; label: string; state: 'manquante' | 'demandee' | 'recue' | 'validee' | 'refusee' | 'expiree' }

export interface CaseSummary {
  id: string
  reference: string
  visa: string
  stage: Stage
  stages: Stage[]
  travelDate?: string
  documents: DocItem[]
  appointment?: { kind: string; at: string; location: string }
  balance: number
  currency: string
}

export interface ShipmentSummary {
  id: string
  reference: string
  goods: string
  from: string
  to: string
  stage: ShipmentStage
  stages: ShipmentStage[]
  eta?: string
}

const STAGES: Stage[] = ['nouveau', 'pieces', 'verification', 'rendez_vous', 'depot', 'consulat', 'decision', 'retrait', 'clos']
const SHIPMENT_STAGES: ShipmentStage[] = ['demande', 'ramassage', 'entrepot', 'empotage', 'depart', 'transit', 'arrivee', 'douane', 'livraison', 'livre']

const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString()

export async function fetchCases(): Promise<CaseSummary[]> {
  if (!BASE) return demoCases()
  const res = await fetch(`${BASE}/api/portal/cases`)
  if (!res.ok) throw new Error(`Réponse ${res.status}`)
  return res.json()
}

export async function fetchShipments(): Promise<ShipmentSummary[]> {
  if (!BASE) return demoShipments()
  const res = await fetch(`${BASE}/api/portal/shipments`)
  if (!res.ok) throw new Error(`Réponse ${res.status}`)
  return res.json()
}

function demoCases(): CaseSummary[] {
  return [
    {
      id: 'ca_1', reference: 'VF-2026-0142', visa: 'Chine · Affaires 48 h',
      stage: 'pieces', stages: STAGES, travelDate: inDays(21),
      documents: [
        { id: 'd1', label: 'Passeport valable 6 mois', state: 'validee' },
        { id: 'd2', label: 'Photo 33 x 48 mm, fond blanc', state: 'validee' },
        { id: 'd3', label: 'Lettre d’invitation chinoise', state: 'demandee' },
        { id: 'd4', label: 'Relevé bancaire, 3 derniers mois', state: 'manquante' },
      ],
      appointment: { kind: 'agence', at: inDays(3), location: '85 rue de Palestine, Tunis' },
      balance: 260, currency: 'TND',
    },
  ]
}

function demoShipments(): ShipmentSummary[] {
  return [
    {
      id: 'sh_1', reference: 'EXP-2026-0031', goods: 'Pièces détachées automobiles',
      from: 'Nansha', to: 'Radès', stage: 'transit', stages: SHIPMENT_STAGES, eta: inDays(11),
    },
  ]
}
