import { createContext, useContext } from 'react'
import type { PlatformCap, PlatformMe } from '@/data/plateforme'

/**
 * Ce que tout écran de la console sait sans le redemander : qui est connecté,
 * ce qu'il a le droit de faire, et les compteurs de la barre latérale.
 * Fourni par AdminShell, consommé partout avec usePlateforme().
 */
export interface Compteurs {
  demandes_nouvelles: number
  tickets_ouverts: number
  facturation_urgente: number   // grâces + suspendues
  taches_en_echec: number
}

export interface PlateformeValue {
  me: PlatformMe
  can: (cap: PlatformCap) => boolean
  compteurs: Compteurs
  /** Recharge les compteurs de la barre latérale (après un geste qui les change). */
  rafraichirCompteurs: () => void
}

export const PlateformeContext = createContext<PlateformeValue | null>(null)

export function usePlateforme(): PlateformeValue {
  const v = useContext(PlateformeContext)
  if (!v) throw new Error('usePlateforme() s’utilise sous AdminShell')
  return v
}
