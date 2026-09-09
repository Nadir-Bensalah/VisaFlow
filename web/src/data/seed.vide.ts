import type { Database } from './types'

/**
 * LE PRODUIT LIVRÉ NE CONTIENT AUCUNE DONNÉE FICTIVE.
 *
 * `seed.ts` fabrique un jeu de démonstration : une agence inventée, des
 * clients inventés, des dossiers inventés. Il sert au développement et au banc
 * d'écran, il n'a rien à faire dans le fichier que téléchargent les agences.
 * La configuration de construction remplace donc `@/data/seed` par ce fichier,
 * sauf quand on construit exprès la démonstration (`VITE_DEMO=1`).
 *
 * Ce que rend `buildSeed` ici : une base VIDE mais valide. Aucun nom, aucun
 * chiffre, aucun client. En production elle ne sert qu'une fraction de seconde,
 * le temps que l'agence arrive du serveur.
 */
export function buildSeed(slug: string): Database {
  const now = new Date().toISOString()
  return {
    version: 3,
    agency: {
      id: `ag_${slug}`,
      slug,
      name: '',
      legalName: '',
      mark: 'VF',
      accent: '#0066CC',
      email: '',
      phone: '',
      website: '',
      locales: ['fr', 'en', 'ar', 'zh'],
      defaultLocale: 'fr',
      currency: 'TND',
      offices: [],
      plan: 'essai',
      services: ['visas'],
      createdAt: now,
      setupDone: [],
    },
    users: [],
    clients: [],
    visaTypes: [],
    consulates: [],
    checklists: [],
    cases: [],
    documents: [],
    custody: [],
    messages: [],
    templates: [],
    appointments: [],
    payments: [],
    rules: [],
    events: [],
    tasks: [],
    shipments: [],
    shipmentDocs: [],
    shipmentEvents: [],
    requests: [],
    queue: [],
    attempts: [],
    lots: [],
    legs: [],
    tariffs: [],
    bls: [],
    declarations: [],
    customsArticles: [],
    tce: [],
    stays: [],
    providers: [],
  }
}
