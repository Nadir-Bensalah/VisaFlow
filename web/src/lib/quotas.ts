/* Lire un quota côté écran.
 *
 * Une seule règle tient tout ce fichier : `null` veut dire ILLIMITÉ, jamais
 * zéro. Un pourcentage calculé sur une limite nulle rend Infinity ou NaN, la
 * barre part à 100 %, et l'agence croit qu'elle est bloquée alors qu'elle a
 * justement payé pour ne plus l'être. Chaque fonction d'ici traite donc le cas
 * `null` avant tout le reste.
 *
 * Le seuil d'alerte est à 80 % : c'est le moment où l'on prévient, pas celui
 * où l'on bloque. Le blocage, lui, vit en base, dans quota_guard, et nulle
 * part ailleurs. Un garde-fou écrit dans le navigateur n'est pas un garde-fou.
 */

/** Le quota d'une ressource, tel que `quota_check` le rend en base. */
export interface Quota {
  limite: number | null
  utilise: number
  reste: number | null
  depasse: boolean
}

export type QuotaResource = 'users' | 'offices' | 'clients' | 'cases' | 'shipments' | 'storage'

/** Le seuil à partir duquel on prévient l'agence. */
export const ALERTE = 0.8

export const illimite = (limite: number | null | undefined): boolean =>
  limite === null || limite === undefined

/**
 * Le pourcentage de consommation, borné à 100. Rend `null` quand la ressource
 * est illimitée : à l'écran, cela veut dire « pas de barre », pas « zéro ».
 */
export function pourcentage(utilise: number, limite: number | null | undefined): number | null {
  if (illimite(limite)) return null
  if (!limite || limite <= 0) return utilise > 0 ? 100 : 0
  return Math.min(100, Math.round((utilise / limite) * 100))
}

/** Vrai dès que la consommation approche la limite, sans l'avoir dépassée. */
export function alerte(utilise: number, limite: number | null | undefined): boolean {
  const pct = pourcentage(utilise, limite)
  return pct !== null && pct >= ALERTE * 100 && !depasse(utilise, limite)
}

/** Vrai quand la consommation dépasse VRAIMENT la limite. Plein n'est pas dépassé. */
export function depasse(utilise: number, limite: number | null | undefined): boolean {
  if (illimite(limite)) return false
  return utilise > (limite as number)
}

/** La teinte d'une jauge : vert tant qu'on respire, orange au seuil, rouge au-delà. */
export function ton(utilise: number, limite: number | null | undefined): 'green' | 'orange' | 'red' {
  if (depasse(utilise, limite)) return 'red'
  if (alerte(utilise, limite)) return 'orange'
  return 'green'
}

/**
 * Le libellé d'une limite. `illimiteLabel` vient du dictionnaire : ce fichier
 * ne connaît aucune langue, il est appelé depuis quatre.
 */
export function libelle(
  utilise: number,
  limite: number | null | undefined,
  illimiteLabel: string,
  format: (n: number) => string = (n) => String(n),
): string {
  if (illimite(limite)) return `${format(utilise)} · ${illimiteLabel}`
  return `${format(utilise)} / ${format(limite as number)}`
}

/** Ce qu'il reste, ou `null` si la question n'a pas de sens. */
export function reste(utilise: number, limite: number | null | undefined): number | null {
  if (illimite(limite)) return null
  return Math.max((limite as number) - utilise, 0)
}

/**
 * Les octets en mégaoctets, pour comparer le stockage à sa limite qui, elle,
 * est en Mo dans la grille.
 */
export const enMo = (octets: number): number => Math.round(octets / (1024 * 1024))

/** Une taille lisible. On s'arrête au Go : personne ne stocke un To de passeports. */
export function taille(octets: number, format: (n: number) => string = (n) => String(n)): string {
  if (octets < 1024) return `${octets} o`
  if (octets < 1024 * 1024) return `${format(Math.round(octets / 1024))} Ko`
  if (octets < 1024 * 1024 * 1024) return `${format(Math.round(octets / (1024 * 1024)))} Mo`
  return `${format(Math.round((octets / (1024 * 1024 * 1024)) * 10) / 10)} Go`
}

/**
 * Le montant annuel dû, recalculé côté écran pour l'AFFICHER décomposé.
 *
 * La base fait foi (subscription_invoice_amount) : ce calcul-ci ne sert qu'à
 * montrer les trois facteurs. C'est exactement ce que la circulaire BCT
 * 2016-09 exige de lire sur la facture : un nombre d'unités, un prix unitaire,
 * une durée. Jamais un forfait.
 */
export function montantAnnuel(sieges: number, prixParUtilisateur: number): number {
  return sieges * prixParUtilisateur * 12
}

/** Combien de jours avant l'échéance. Négatif = déjà passée. */
export function joursAvant(dateIso: string | null | undefined, aujourdhui = new Date()): number | null {
  if (!dateIso) return null
  const d = new Date(dateIso)
  if (Number.isNaN(d.getTime())) return null
  const jour = 24 * 60 * 60 * 1000
  return Math.ceil((d.setHours(0, 0, 0, 0) - new Date(aujourdhui).setHours(0, 0, 0, 0)) / jour)
}
