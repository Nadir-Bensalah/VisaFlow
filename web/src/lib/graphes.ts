/* Les graphiques du pilotage, en géométrie pure.
 *
 * POURQUOI PAS DE BIBLIOTHÈQUE. Le projet n'en a aucune : `Stats.tsx` et
 * `Reports.tsx` dessinent leurs barres à la main, avec deux div et un
 * pourcentage de hauteur. Ajouter Recharts ou Chart.js ferait entrer trois cent
 * kilo-octets et un thème à réconcilier avec les variables CSS de l'app, pour
 * des courbes qui tiennent en quarante lignes. On garde la maison.
 *
 * Ce fichier ne contient aucun composant : il rend des CHAÎNES de chemin SVG et
 * des positions. Les écrans écrivent leur `<svg>` eux-mêmes, avec leurs propres
 * couleurs. C'est ce qui permet à ce fichier de rester un `.ts` et d'être
 * testable sans rendu.
 *
 * Une règle traverse tout le fichier : une série vide ne rend pas un graphique
 * plat à zéro, elle rend une chaîne vide. Un trait à zéro se lit comme « rien
 * ne s'est passé », alors que la vérité est « on n'a pas de mesure ».
 */

export interface Point {
  /** L'étiquette de l'abscisse, par exemple « 2026-08 ». */
  label: string
  value: number
}

export interface Boite {
  width: number
  height: number
  /** Marge intérieure, pour que le trait ne colle pas au bord. */
  pad: number
}

export const BOITE: Boite = { width: 640, height: 160, pad: 8 }

/** Le maximum de la série, jamais zéro : on divise par lui. */
function haut(points: Point[]): number {
  return Math.max(...points.map((p) => p.value), 1)
}

function xDe(i: number, n: number, b: Boite): number {
  if (n <= 1) return b.width / 2
  return b.pad + (i * (b.width - 2 * b.pad)) / (n - 1)
}

function yDe(v: number, max: number, b: Boite): number {
  return b.height - b.pad - (v / max) * (b.height - 2 * b.pad)
}

/**
 * La ligne d'une série. Rend '' quand la série est vide : l'écran affiche alors
 * son message « pas assez de donnée » plutôt qu'un trait plat mensonger.
 */
export function ligne(points: Point[], b: Boite = BOITE): string {
  if (points.length === 0) return ''
  const max = haut(points)
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xDe(i, points.length, b).toFixed(1)},${yDe(p.value, max, b).toFixed(1)}`)
    .join(' ')
}

/** La même ligne, refermée en bas, pour un remplissage discret sous la courbe. */
export function aire(points: Point[], b: Boite = BOITE): string {
  if (points.length === 0) return ''
  const base = b.height - b.pad
  const debut = xDe(0, points.length, b).toFixed(1)
  const fin = xDe(points.length - 1, points.length, b).toFixed(1)
  return `${ligne(points, b)} L${fin},${base} L${debut},${base} Z`
}

/** Les points de la ligne, pour poser une pastille sur chaque mesure. */
export function pastilles(points: Point[], b: Boite = BOITE): { x: number; y: number; p: Point }[] {
  if (points.length === 0) return []
  const max = haut(points)
  return points.map((p, i) => ({
    x: xDe(i, points.length, b),
    y: yDe(p.value, max, b),
    p,
  }))
}

/**
 * Des colonnes. On rend x, y, largeur et hauteur : l'écran choisit la couleur
 * de chacune, ce qui permet de teinter la colonne du mois en cours.
 */
export function colonnes(
  points: Point[], b: Boite = BOITE,
): { x: number; y: number; w: number; h: number; p: Point }[] {
  if (points.length === 0) return []
  const max = haut(points)
  const espace = (b.width - 2 * b.pad) / points.length
  const w = Math.max(2, espace * 0.62)
  return points.map((p, i) => {
    const y = yDe(p.value, max, b)
    return {
      x: b.pad + i * espace + (espace - w) / 2,
      y,
      w,
      h: Math.max(0, b.height - b.pad - y),
      p,
    }
  })
}

/**
 * Une barre horizontale, en pourcentage du plus grand. Utilisée pour les
 * classements simples (par pays, par transporteur), où une largeur se compare
 * mieux qu'une hauteur.
 *
 * Le plancher de 2 % est délibéré : une valeur non nulle doit rester visible,
 * sinon on la lit comme un zéro.
 */
export function largeurPct(valeur: number, max: number): number {
  if (max <= 0) return 0
  if (valeur <= 0) return 0
  return Math.max(2, Math.round((valeur / max) * 100))
}

/** Le plus grand d'une liste de valeurs, ou 1 pour ne jamais diviser par zéro. */
export function maxDe(valeurs: number[]): number {
  return Math.max(...valeurs, 1)
}

/**
 * Un mois « 2026-08 » écrit court dans la langue de la personne. On garde
 * l'année quand la série traverse deux années, sinon le mois seul suffit et
 * l'axe reste lisible.
 */
export function moisCourt(mois: string, locale: string, avecAnnee = false): string {
  const [a, m] = mois.split('-')
  const d = new Date(Number(a), Number(m) - 1, 1)
  return d.toLocaleDateString(locale, avecAnnee ? { month: 'short', year: '2-digit' } : { month: 'short' })
}

/** La série traverse-t-elle deux années ? Décide de l'étiquette ci-dessus. */
export function plusieursAnnees(points: Point[]): boolean {
  const annees = new Set(points.map((p) => p.label.slice(0, 4)))
  return annees.size > 1
}

/**
 * Des minutes en durée lisible. Sert aux délais de service, où « 1 440 minutes »
 * ne dit rien à personne alors que « 24 h » se comprend d'un coup d'œil.
 */
export function duree(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  if (m < 60 * 48) {
    const h = Math.floor(m / 60)
    const reste = m % 60
    return reste === 0 ? `${h} h` : `${h} h ${String(reste).padStart(2, '0')}`
  }
  return `${Math.floor(m / 1440)} j`
}

/** Des octets en unité lisible. La plateforme compte en octets, pas les yeux. */
export function poids(octets: number): string {
  if (octets < 1024) return `${octets} o`
  const unites = ['Ko', 'Mo', 'Go', 'To']
  let v = octets / 1024
  let i = 0
  while (v >= 1024 && i < unites.length - 1) { v /= 1024; i += 1 }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${unites[i]}`
}
