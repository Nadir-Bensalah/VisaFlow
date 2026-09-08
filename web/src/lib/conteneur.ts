/* La clé de contrôle ISO 6346, en TypeScript.
 *
 * LE MÊME ALGORITHME EXISTE DEUX FOIS, ICI ET DANS LA MIGRATION 0047,
 * VOLONTAIREMENT. Ce n'est pas un oubli de factorisation, c'est un partage des
 * rôles :
 *
 *   · le serveur FAIT AUTORITÉ. Une contrainte de la base refuse un numéro
 *     faux, même écrit par l'API, même par un script. C'est la seule barrière
 *     qui tienne.
 *   · l'écran RÉPOND TOUT DE SUITE. L'agent tape onze caractères en recopiant
 *     la porte du conteneur ; lui dire à la onzième frappe que la clé ne tombe
 *     pas juste évite un aller-retour réseau et surtout un enregistrement.
 *
 * Les deux implémentations sont tenues par les mêmes vecteurs d'essai :
 * CSQU3054383 (celui de la norme, clé 3) et MSKU0000080 (le cas où le reste
 * vaut 10 et s'écrit 0). Si l'une change, le banc de l'autre le dit.
 *
 * Pourquoi cette vérification est la plus utile du module : un numéro mal
 * saisi ne fait rien planter. Il fait PERDRE le conteneur. La recherche chez
 * l'armateur ne rend rien, le terminal ne trouve pas la boîte, et personne ne
 * relie la panne à la lettre échangée trois semaines plus tôt.
 */

/* Valeur de chaque lettre : A vaut 10, puis on avance d'une unité par lettre
   en SAUTANT tous les multiples de 11 (11, 22, 33). C'est ce saut qu'on
   oublie, et il décale toutes les lettres à partir de L. U vaut 32, V vaut 34. */
const LETTRES = [
  10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
  34, 35, 36, 37, 38,
]

const POIDS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512]

/** La quatrième lettre dit la catégorie : U conteneur, J équipement
    détachable, Z châssis ou remorque. */
export const CATEGORIES = ['U', 'J', 'Z'] as const

/** Enlève tout ce qui n'est ni lettre ni chiffre et met en capitales.
    Le numéro est écrit « CSQU 305438 3 » sur la porte et sur le connaissement :
    rejeter une saisie pour une espace apprend à contourner la vérification. */
export function normaliserConteneur(saisie: string): string {
  return (saisie ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()
}

/**
 * La clé de contrôle, calculée pour de vrai.
 * Accepte le préfixe seul (dix caractères) comme le numéro complet (onze) :
 * l'écran a besoin de la clé AVANT que l'agent l'ait tapée.
 * Rend null si la forme n'est pas celle d'un numéro de conteneur.
 */
export function cleConteneur(saisie: string): number | null {
  const s = normaliserConteneur(saisie)
  if (!/^[A-Z]{4}[0-9]{6}[0-9]?$/.test(s)) return null

  let total = 0
  for (let i = 0; i < 10; i += 1) {
    const c = s[i]
    const v = c >= '0' && c <= '9'
      ? Number(c)
      : LETTRES[c.charCodeAt(0) - 65]
    total += v * POIDS[i]
  }
  // Un reste de 10 s'écrit 0. C'est la seule irrégularité de la norme, et
  // c'est celle que les implémentations maison ratent : elles refusent alors
  // des conteneurs parfaitement valides.
  return (total % 11) % 10
}

export interface AvisConteneur {
  /** Le numéro normalisé, tel qu'il sera rangé en base. */
  numero: string
  /** Vrai seulement si la forme ET la clé sont bonnes. */
  valide: boolean
  /** La clé attendue, dès que le préfixe est complet. Sert à la proposer. */
  cleAttendue: number | null
  /** Pourquoi ce n'est pas encore bon. Null quand tout va bien. */
  probleme: 'vide' | 'forme' | 'incomplet' | 'cle' | null
  /** Signalé sans bloquer : la quatrième lettre n'est ni U, ni J, ni Z. */
  categorieInhabituelle: boolean
}

/**
 * L'avis complet, pour l'afficher pendant la frappe.
 * Il distingue « pas encore fini » de « faux » : dire « numéro invalide » à
 * la troisième lettre est le meilleur moyen de faire ignorer le message.
 */
export function avisConteneur(saisie: string): AvisConteneur {
  const numero = normaliserConteneur(saisie)
  const cleAttendue = cleConteneur(numero)
  const categorieInhabituelle =
    numero.length >= 4 && !(CATEGORIES as readonly string[]).includes(numero[3])

  if (numero.length === 0) {
    return { numero, valide: false, cleAttendue: null, probleme: 'vide', categorieInhabituelle: false }
  }
  // La forme se juge sur ce qui est déjà tapé : quatre lettres puis des
  // chiffres. Tant que c'est cohérent, on dit « incomplet », pas « faux ».
  const enCours = /^[A-Z]{0,4}$/.test(numero) || /^[A-Z]{4}[0-9]{0,7}$/.test(numero)
  if (!enCours) {
    return { numero, valide: false, cleAttendue, probleme: 'forme', categorieInhabituelle }
  }
  if (numero.length < 11) {
    return { numero, valide: false, cleAttendue, probleme: 'incomplet', categorieInhabituelle }
  }
  const valide = cleAttendue !== null && Number(numero[10]) === cleAttendue
  return {
    numero,
    valide,
    cleAttendue,
    probleme: valide ? null : 'cle',
    categorieInhabituelle,
  }
}

/** Vrai si le numéro complet est bon. Le raccourci des listes. */
export function conteneurValide(saisie: string): boolean {
  return avisConteneur(saisie).valide
}
