/* Le dépôt de pièces.
   Les seaux Supabase et leurs règles existent déjà (migration 0009), mais rien
   ne permettait de déposer un fichier : le logiciel restait un cahier de
   suivi. Ce module est la seule porte d'entrée des fichiers, et il tient les
   deux mondes : IndexedDB tant qu'on travaille en local, le seau distant
   quand la clé arrivera. Le reste de l'application ne connaît qu'une clé. */

const DB_NAME = 'visaflow.files'
const STORE = 'blobs'
const DB_VERSION = 1

/** 12 Mo. Au-delà, c'est une photo non recadrée, pas une pièce de dossier,
    et le quota du navigateur saute avant le dixième document. */
export const MAX_BYTES = 12 * 1024 * 1024

/** Ce qu'un consulat accepte, et rien d'autre. Un .docx envoyé par un client
    est refusé au guichet : autant le refuser ici. */
export const ACCEPTED = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'] as const

export const ACCEPT_ATTR = '.jpg,.jpeg,.png,.heic,.heif,.pdf,image/*,application/pdf'

export type RejectReason = 'trop_gros' | 'type_refuse' | 'vide' | 'stockage'

export interface StoredFile {
  key: string
  name: string
  type: string
  size: number
  at: string
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const request = run(transaction.objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        transaction.oncomplete = () => db.close()
      }),
  )
}

/** Vérifie avant d'écrire. Une pièce refusée par le consulat, c'est un dossier
    perdu et un client furieux : le contrôle se fait au dépôt, pas trois
    semaines plus tard. */
export function check(file: File): RejectReason | null {
  if (file.size === 0) return 'vide'
  if (file.size > MAX_BYTES) return 'trop_gros'
  // Certains navigateurs ne renseignent pas le type pour un HEIC : on retombe
  // alors sur l'extension plutôt que de refuser une photo d'iPhone valable.
  const byType = (ACCEPTED as readonly string[]).includes(file.type)
  const byName = /\.(jpe?g|png|heic|heif|pdf)$/i.test(file.name)
  if (!byType && !byName) return 'type_refuse'
  return null
}

/** Clé opaque, jamais le nom du fichier : deux clients peuvent déposer deux
    « passeport.pdf », et un nom d'origine peut contenir n'importe quoi. */
export function keyFor(scope: string, id: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14)
  return `${scope}/${id}/${rand}`
}

export async function put(key: string, file: File): Promise<StoredFile> {
  const meta: StoredFile = { key, name: file.name, type: file.type || 'application/octet-stream', size: file.size, at: new Date().toISOString() }
  await tx('readwrite', (store) => store.put({ meta, blob: file }, key))
  return meta
}

export async function get(key: string): Promise<{ meta: StoredFile; blob: Blob } | undefined> {
  try {
    return await tx<{ meta: StoredFile; blob: Blob } | undefined>('readonly', (store) => store.get(key))
  } catch {
    // Navigation privée, quota, base illisible : on ne casse pas l'écran pour
    // autant, la pièce est simplement affichée comme absente.
    return undefined
  }
}

export async function remove(key: string): Promise<void> {
  try {
    await tx('readwrite', (store) => store.delete(key))
  } catch {
    // Rien à faire : la ligne du dossier est déjà partie.
  }
}

/** Toutes les pièces d'un dossier, quand on le purge ou qu'on l'exporte. */
export async function removeScope(prefix: string): Promise<void> {
  try {
    const keys = await tx<IDBValidKey[]>('readonly', (store) => store.getAllKeys())
    await Promise.all(keys.filter((k) => String(k).startsWith(prefix)).map((k) => remove(String(k))))
  } catch {
    // idem
  }
}

/** URL temporaire pour l'aperçu et le téléchargement. À révoquer après usage,
    sinon le blob reste en mémoire tant que l'onglet vit. */
export async function url(key: string): Promise<string | undefined> {
  const found = await get(key)
  return found ? URL.createObjectURL(found.blob) : undefined
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} Mo`
}
