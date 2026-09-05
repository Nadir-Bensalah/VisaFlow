import type { Role, User } from '@/data/types'

/* Les droits vivent ici, et nulle part ailleurs.
   Une page ne décide jamais elle-même si un rôle a le droit de voir : elle
   demande. Le jour où Supabase arrive, cette matrice devient la politique de
   sécurité au niveau des lignes, avec les mêmes noms. */

export type Capability =
  | 'case:read'
  | 'case:write'
  | 'case:create'
  | 'client:write'
  | 'doc:validate'
  | 'message:send'
  | 'payment:write'
  | 'shipment:write'
  /** Le chiffre d'affaires, l'encaissé, la marge. Direction seulement. */
  | 'finance:global'
  | 'reports:view'
  | 'automation:manage'
  | 'settings:view'
  | 'settings:manage'
  | 'team:manage'
  | 'catalog:manage'
  | 'audit:view'
  | 'data:export'
  | 'data:reset'

const AGENT: Capability[] = [
  'case:read', 'case:write', 'case:create', 'client:write', 'doc:validate',
  'message:send', 'payment:write', 'shipment:write', 'settings:view',
]

const MANAGER: Capability[] = [
  ...AGENT, 'reports:view', 'automation:manage', 'settings:manage',
  'catalog:manage', 'audit:view',
]

const OWNER: Capability[] = [
  ...MANAGER, 'finance:global', 'team:manage', 'data:export', 'data:reset',
]

const MATRIX: Record<Role, Capability[]> = {
  owner: OWNER,
  manager: MANAGER,
  agent: AGENT,
  viewer: ['case:read'],
}

export function can(user: User | undefined, capability: Capability): boolean {
  if (!user || !user.active) return false
  return MATRIX[user.role].includes(capability)
}

/** Périmètre de lecture : toute l'agence, ou le seul bureau de la personne. */
export function scopeOf(user: User | undefined): 'agence' | 'bureau' {
  return user && (user.role === 'owner' || user.role === 'manager') ? 'agence' : 'bureau'
}

export function isReadOnly(user: User | undefined): boolean {
  return !can(user, 'case:write')
}

/** Libellé du rôle, pour l'affichage. Le nom de clé suit l'i18n. */
export function roleKey(role: Role): 'misc.owner' | 'misc.manager' | 'misc.agentRole' | 'misc.viewer' {
  if (role === 'agent') return 'misc.agentRole'
  if (role === 'manager') return 'misc.manager'
  if (role === 'viewer') return 'misc.viewer'
  return 'misc.owner'
}
