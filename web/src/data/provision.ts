import { CHECKLISTS } from './checklists'
import { buildSeed } from './seed'
import { registerTenant, slugify } from '@/tenant'
import type { Agency, Database, Locale, Service, User } from './types'

/* L'inscription d'une agence, sans que personne ne touche au code.

   Une agence qui s'inscrit ne doit pas trouver un outil vide : elle repart avec
   le catalogue de son metier, les modeles de message traduits et les relances
   pretes a activer. C'est la difference entre un logiciel qu'on essaie et un
   logiciel qu'on abandonne le premier soir. */

export interface SignupInput {
  agencyName: string
  country: string
  services: Service[]
  ownerName: string
  ownerEmail: string
  ownerPhone: string
  slug: string
  locale: Locale
  withDemoData: boolean
}

const TRIAL_DAYS = 15

const ACCENTS = ['#0066CC', '#B04503', '#5E5CE6', '#1F7A2E', '#8E5BC7']

function mark(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.slice(0, 2).map((w) => w[0]).join('')
  return (letters || 'VF').toUpperCase()
}

/** Le catalogue de depart, pris dans le modele du metier choisi. */
function starterCatalogue(agencyId: string, services: Service[]) {
  const demo = buildSeed('modele')
  const checklists = CHECKLISTS.map((c) => ({ ...c, agencyId }))
  const visaTypes = services.includes('visas')
    ? demo.visaTypes.map((v) => ({ ...v, agencyId }))
    : []
  return { checklists, visaTypes, templates: demo.templates.map((t) => ({ ...t, agencyId })), rules: demo.rules.map((r) => ({ ...r, agencyId, runs: 0, lastRunAt: undefined })) }
}

export function provisionAgency(input: SignupInput): { slug: string; ownerId: string } {
  const slug = slugify(input.slug || input.agencyName)
  const agencyId = `ag_${slug}`
  const accent = ACCENTS[slug.length % ACCENTS.length]
  const trialEnds = new Date()
  trialEnds.setDate(trialEnds.getDate() + TRIAL_DAYS)

  const agency: Agency = {
    id: agencyId,
    slug,
    name: input.agencyName,
    legalName: input.agencyName,
    mark: mark(input.agencyName),
    accent,
    email: input.ownerEmail,
    phone: input.ownerPhone,
    website: `https://${slug}.visaflow.app`,
    locales: ['fr', 'en', 'ar', 'zh'],
    defaultLocale: input.locale,
    currency: input.country === 'Libye' ? 'LYD' : 'TND',
    plan: 'essai',
    services: input.services,
    trialEndsAt: trialEnds.toISOString(),
    createdAt: new Date().toISOString(),
    setupDone: [],
    inpdpRef: 'À déclarer',
    offices: [
      {
        id: 'of_principal',
        name: input.agencyName.split(/\s+/)[0],
        city: '',
        country: input.country,
        countryCode: input.country === 'Libye' ? 'LY' : input.country === 'Chine' ? 'CN' : 'TN',
        phone: input.ownerPhone,
        address: '',
        timezone: input.country === 'Libye' ? 'Africa/Tripoli' : input.country === 'Chine' ? 'Asia/Shanghai' : 'Africa/Tunis',
      },
    ],
  }

  const owner: User = {
    id: 'u_owner',
    agencyId,
    name: input.ownerName,
    email: input.ownerEmail,
    phone: input.ownerPhone,
    role: 'owner',
    officeId: 'of_principal',
    locale: input.locale,
    active: true,
  }

  const { checklists, visaTypes, templates, rules } = starterCatalogue(agencyId, input.services)

  let db: Database = {
    version: 1,
    agency,
    users: [owner],
    clients: [],
    visaTypes,
    checklists,
    cases: [],
    documents: [],
    messages: [],
    templates,
    appointments: [],
    payments: [],
    rules,
    events: [],
    tasks: [],
    shipments: [],
    shipmentDocs: [],
    shipmentEvents: [],
    requests: [],
  }

  if (input.withDemoData) {
    // Les dossiers d'exemple, mais sous l'identite de la nouvelle agence.
    const demo = buildSeed(slug)
    db = {
      ...demo,
      agency,
      users: [owner, ...demo.users.filter((u) => u.id !== 'u_owner').map((u) => ({ ...u, agencyId, officeId: 'of_principal' }))],
      clients: demo.clients.map((c) => ({ ...c, agencyId, officeId: 'of_principal' })),
      cases: demo.cases.map((c) => ({ ...c, agencyId, officeId: 'of_principal' })),
      shipments: demo.shipments.map((s) => ({ ...s, agencyId, officeId: 'of_principal' })),
      requests: demo.requests.map((r) => ({ ...r, agencyId })),
      visaTypes,
      checklists,
      templates,
      rules,
    }
  }

  try {
    window.localStorage.setItem(`visaflow.db.${slug}`, JSON.stringify(db))
    window.localStorage.setItem(`visaflow.session.${slug}`, owner.id)
  } catch {
    // Sans stockage, l'agence ne survivra pas au rechargement.
  }
  registerTenant({ slug, name: agency.name, mark: agency.mark, accent, createdAt: agency.createdAt })

  return { slug, ownerId: owner.id }
}
