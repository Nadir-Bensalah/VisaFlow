/* Resolution de l'agence a partir de l'adresse, et registre des agences.

   Production : tca.visaflow.app        -> slug "tca"
   GitHub Pages : /VisaFlow/?agency=tca -> slug "tca"
   Local : localhost:5173               -> agence par defaut

   Le registre vit dans le navigateur tant qu'il n'y a pas de serveur. C'est
   lui qui permet a une agence de s'inscrire sans que personne ne touche au
   code : l'inscription ecrit une ligne ici, et l'adresse existe. */

export interface TenantBrand {
  slug: string
  name: string
  mark: string
  accent: string
  createdAt?: string
}

const BUILTIN: TenantBrand[] = [
  { slug: 'tca', name: 'Tunis Consulting', mark: 'TC', accent: '#0066CC' },
  { slug: 'sahara', name: 'Sahara Voyages', mark: 'SV', accent: '#B04503' },
  { slug: 'medina', name: 'Medina Travel', mark: 'MT', accent: '#5E5CE6' },
]

const REGISTRY_KEY = 'visaflow.tenants'

export const DEFAULT_TENANT = 'tca'

/** Adresses interdites : elles servent la plateforme elle-meme. */
export const RESERVED = new Set([
  'www', 'app', 'admin', 'api', 'localhost', 'visaflow', 'github', 'mail',
  'blog', 'aide', 'help', 'support', 'compte', 'inscription', 'status', 'cdn',
])

function stored(): TenantBrand[] {
  try {
    const raw = window.localStorage.getItem(REGISTRY_KEY)
    return raw ? (JSON.parse(raw) as TenantBrand[]) : []
  } catch {
    return []
  }
}

export function allTenants(): TenantBrand[] {
  const custom = stored()
  const known = new Set(custom.map((t) => t.slug))
  return [...custom, ...BUILTIN.filter((t) => !known.has(t.slug))]
}

export function registerTenant(tenant: TenantBrand): void {
  const custom = stored().filter((t) => t.slug !== tenant.slug)
  try {
    window.localStorage.setItem(REGISTRY_KEY, JSON.stringify([...custom, tenant]))
  } catch {
    // Stockage indisponible : l'agence vivra le temps de la session.
  }
}

/** Une adresse est libre si elle n'est ni reservee ni deja prise. */
export function slugAvailable(slug: string): boolean {
  const clean = slug.trim().toLowerCase()
  if (clean.length < 3 || !/^[a-z0-9-]+$/.test(clean)) return false
  if (RESERVED.has(clean)) return false
  return !allTenants().some((t) => t.slug === clean)
}

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
}

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
  return allTenants().find((t) => t.slug === slug) ?? BUILTIN[0]
}

/** Adresse publique de l'agence, telle qu'affichee dans les reglages. */
export function tenantUrl(slug: string): string {
  return `https://${slug}.visaflow.app`
}
