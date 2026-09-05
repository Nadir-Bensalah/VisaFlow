/* Resolution de l'agence a partir de l'adresse.
   Production : tca.visaflow.app        -> slug "tca"
   GitHub Pages : /VisaFlow/?agency=tca -> slug "tca"
   Local : localhost:5173               -> agence par defaut */

export interface TenantBrand {
  slug: string
  name: string
  mark: string
  accent: string
}

/** Registre des agences connues. En production il vient de la base. */
export const TENANTS: TenantBrand[] = [
  { slug: 'tca', name: 'Tunis Consulting', mark: 'TC', accent: '#0066CC' },
  { slug: 'sahara', name: 'Sahara Voyages', mark: 'SV', accent: '#E85D04' },
  { slug: 'medina', name: 'Medina Travel', mark: 'MT', accent: '#5E5CE6' },
]

export const DEFAULT_TENANT = 'tca'

const RESERVED = new Set(['www', 'app', 'admin', 'api', 'localhost', 'visaflow', 'github'])

export function resolveTenantSlug(host = window.location.hostname, search = window.location.search): string {
  const forced = new URLSearchParams(search).get('agency')
  if (forced) return forced.toLowerCase()

  const labels = host.split('.')
  // Un sous domaine n'existe qu'a partir de trois etiquettes : tca.visaflow.app
  if (labels.length >= 3) {
    const first = labels[0].toLowerCase()
    if (!RESERVED.has(first)) return first
  }
  return DEFAULT_TENANT
}

export function findTenant(slug: string): TenantBrand {
  return TENANTS.find((t) => t.slug === slug) ?? TENANTS[0]
}

/** Adresse publique de l'agence, telle qu'affichee dans les reglages. */
export function tenantUrl(slug: string): string {
  return `https://${slug}.visaflow.app`
}
