/**
 * Les règles de fichier, côté navigateur.
 *
 * Elles existent deux fois, ici et dans `file_accept()` (migration 0050). Ce
 * n'est pas un oubli : celle du serveur PROTÈGE, celle-ci ÉVITE UN ALLER-RETOUR.
 * Une agente sur une connexion tunisienne moyenne qui téléverse 40 Mo pour
 * s'entendre dire non trois minutes plus tard a perdu trois minutes. Ici, le
 * refus est instantané.
 *
 * Les deux listes doivent rester identiques. Le banc `supabase/tests/securite.sql`
 * vérifie la version SQL, avec les mêmes vecteurs que ceux d'ici.
 *
 * CE QUE CE MODULE NE FAIT PAS : analyser le contenu du fichier. Aucun
 * antivirus, aucune lecture des octets d'en-tête. Un PDF bien nommé et bien
 * typé passe, sain ou vérolé. Dire le contraire dans une plaquette
 * commerciale serait faux, et c'est précisément ce qu'un audit relève.
 */

/** 10 Mo. Au-delà, c'est une photo non recadrée, pas une pièce de dossier. */
export const TAILLE_MAX = 10 * 1024 * 1024

export const MIMES_ACCEPTES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
] as const

export const EXTENSIONS_ACCEPTEES = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf'] as const

/** Ce qu'on met dans l'attribut `accept` d'un champ fichier. */
export const ACCEPT_ATTR = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/*,application/pdf'

export type RefusFichier =
  | 'nom_vide'
  | 'chemin_dans_le_nom'
  | 'extension_refusee'
  | 'double_extension'
  | 'type_refuse'
  | 'type_incoherent'
  | 'fichier_vide'
  | 'trop_gros'

export type Verdict = { ok: true } | { ok: false; raison: RefusFichier }

const FAMILLE: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heic',
}

// Les caractères de contrôle dans un nom de fichier : jamais une saisie
// humaine, souvent une tentative de tromper l'affichage ou le stockage.
const CARACTERES_DE_CONTROLE = /[\u0000-\u001f\u007f]/

/**
 * Le même verdict que `file_accept()` en SQL, avec les mêmes noms de raison.
 * L'ordre des contrôles compte : on refuse d'abord ce qui est malveillant
 * (chemin, double extension), ensuite ce qui est seulement inadapté.
 */
export function accepteFichier(nom: string, mime: string, taille: number): Verdict {
  const n = (nom ?? '').trim()
  if (n === '') return { ok: false, raison: 'nom_vide' }

  // Un nom de fichier n'est jamais un chemin. « ../../etc/passwd » n'est pas
  // assaini, il est refusé : ce n'est jamais un usage légitime.
  if (n.includes('/') || n.includes('\\') || n.includes('..') || CARACTERES_DE_CONTROLE.test(n)) {
    return { ok: false, raison: 'chemin_dans_le_nom' }
  }

  if (!n.includes('.')) return { ok: false, raison: 'extension_refusee' }

  const ext = n.slice(n.lastIndexOf('.') + 1).toLowerCase()
  if (!(EXTENSIONS_ACCEPTEES as readonly string[]).includes(ext)) {
    return { ok: false, raison: 'extension_refusee' }
  }

  // « facture.exe.pdf » porte deux extensions. Refusé, quelles qu'elles
  // soient. Faux positif assumé : « carte.id.pdf » l'est aussi. On préfère
  // faire renommer un fichier que laisser passer un exécutable déguisé.
  const base = n.slice(0, n.length - ext.length - 1)
  if (/\.[A-Za-z0-9]{2,4}$/.test(base)) return { ok: false, raison: 'double_extension' }

  // Certains navigateurs n'annoncent aucun type pour un HEIC : sans type, on
  // s'en remet à l'extension plutôt que de refuser une photo d'iPhone valable.
  const m = (mime ?? '').trim().toLowerCase()
  if (m !== '') {
    if (!(MIMES_ACCEPTES as readonly string[]).includes(m)) {
      return { ok: false, raison: 'type_refuse' }
    }
    const famille = FAMILLE[ext]
    const coherent = famille === 'image/heic'
      ? m === 'image/heic' || m === 'image/heif'
      : m === famille
    if (!coherent) return { ok: false, raison: 'type_incoherent' }
  }

  if (!Number.isFinite(taille) || taille <= 0) return { ok: false, raison: 'fichier_vide' }
  if (taille > TAILLE_MAX) return { ok: false, raison: 'trop_gros' }

  return { ok: true }
}

/** Le raccourci pour un objet File du navigateur. */
export function accepteBlob(file: File): Verdict {
  return accepteFichier(file.name, file.type, file.size)
}

/** Une taille lisible. « 11,5 Mo » vaut mieux que « 12058624 ». */
export function tailleLisible(octets: number): string {
  if (octets < 1024) return `${octets} o`
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`
  return `${Math.round((octets / (1024 * 1024)) * 10) / 10} Mo`
}

/**
 * L'empreinte SHA-256 du contenu, calculée dans le navigateur.
 *
 * C'est elle qu'on range dans `document_versions.sha256`. La base ne voit
 * jamais l'octet : elle ne peut donc ni la recalculer ni la garantir. Elle
 * répond à « est-ce bien le même fichier qu'en mars », pas à « ce fichier
 * est-il authentique ». La nuance est à tenir devant un consulat.
 *
 * `crypto.subtle` n'existe qu'en contexte sécurisé (https ou localhost). Hors
 * de là, on rend `undefined` plutôt qu'une valeur inventée.
 */
export async function empreinte(file: Blob): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return undefined
  try {
    const buf = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return undefined
  }
}
