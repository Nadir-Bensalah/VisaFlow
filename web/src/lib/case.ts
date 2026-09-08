/* Conversion des noms de colonnes. Le backend parle snake_case, le modèle du
   front parle camelCase. Un seul endroit fait le pont, pour qu'aucune page ne
   connaisse les deux mondes. */

export function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

export function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
}

/** Récursif sur les objets et les tableaux, mais pas sur les valeurs jsonb
    déjà typées (I18nText, tableaux de chaînes) : on ne renomme que les clés
    de colonnes, jamais le contenu d'un champ traduit. */
export function camelKeys<T = unknown>(input: unknown): T {
  if (Array.isArray(input)) return input.map((x) => camelKeys(x)) as T
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      // Un champ i18n ({fr,en,ar,zh}) ou un tableau de chaînes reste tel quel :
      // ses clés sont des données, pas des noms de colonnes.
      out[toCamel(k)] = isLeaf(k, v) ? v : camelKeys(v)
    }
    return out as T
  }
  return input as T
}

const LEAF_KEYS = new Set([
  'label', 'name', 'country', 'help', 'title', 'detail', 'body', 'note', 'notes',
  'goods', 'items', 'tags', 'locales', 'services', 'variables', 'stages', 'setupDone', 'setup_done',
])

function isLeaf(key: string, value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true
  return LEAF_KEYS.has(key)
}

export function snakeKeys(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) out[toSnake(k)] = v
  return out
}
