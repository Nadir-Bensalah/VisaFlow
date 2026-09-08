/**
 * La marque de l'agence : son logo, son titre, ses couleurs.
 *
 * Une agence choisit une couleur, pas un système de couleurs. Elle ne doit pas
 * avoir à décider en plus si son texte sera blanc ou noir, ni quelle nuance
 * prendra une ligne de séparation. Tout cela se calcule à partir de la couleur
 * choisie, et se calcule bien : c'est la différence entre un thème qui a l'air
 * fait exprès et un thème qui a l'air cassé.
 */

/** Les valeurs par défaut, celles de VisaFlow tant que l'agence n'a rien choisi. */
export const DEFAULT_SIDEBAR = '#FFFFFF'
export const DEFAULT_ACCENT = '#0A84FF'

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Luminance relative, formule WCAG. C'est elle qui décide de la couleur du texte. */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 1
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Le rapport de contraste entre deux couleurs, de 1 à 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Le texte à poser sur un fond donné : noir ou blanc, celui qui contraste le
 * mieux. On ne demande jamais ce choix à l'agence, on le calcule.
 */
export function readableOn(background: string): '#FFFFFF' | '#1D1D1F' {
  return contrastRatio(background, '#FFFFFF') >= contrastRatio(background, '#1D1D1F')
    ? '#FFFFFF'
    : '#1D1D1F'
}

/** Une couleur est-elle sombre ? Sert à choisir des séparateurs clairs ou foncés. */
export function isDark(hex: string): boolean {
  return luminance(hex) < 0.4
}

/** Mélange une couleur avec du blanc ou du noir, pour dériver les nuances. */
function mix(hex: string, towards: 'white' | 'black', amount: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const target = towards === 'white' ? 255 : 0
  const out = rgb.map((v) => Math.round(v + (target - v) * amount))
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export type BrandTheme = {
  sidebar: string
  sidebarText: string
  /** Le texte secondaire de la barre : lisible, mais en retrait. */
  sidebarMuted: string
  /** Le séparateur, dérivé du fond pour ne jamais trancher. */
  sidebarLine: string
  /** Le fond de l'élément actif, dérivé lui aussi. */
  sidebarActive: string
  accent: string
  accentText: string
}

/**
 * Le thème complet d'une agence, dérivé de deux couleurs choisies.
 *
 * Le piège classique : une agence choisit un bleu marine pour sa barre, le
 * texte reste noir par défaut, et l'écran devient illisible. Ici le texte, les
 * séparateurs et l'état actif se recalculent tous à partir du fond.
 */
export function brandTheme(sidebar?: string, accent?: string): BrandTheme {
  const bg = /^#[0-9a-fA-F]{6}$/.test(sidebar ?? '') ? (sidebar as string) : DEFAULT_SIDEBAR
  const ac = /^#[0-9a-fA-F]{6}$/.test(accent ?? '') ? (accent as string) : DEFAULT_ACCENT
  const dark = isDark(bg)
  const text = readableOn(bg)

  return {
    sidebar: bg,
    sidebarText: text,
    // Sur fond sombre on éclaircit, sur fond clair on assombrit : dans les deux
    // cas le texte secondaire reste lisible sans crier.
    sidebarMuted: dark ? mix(bg, 'white', 0.55) : mix(bg, 'black', 0.45),
    sidebarLine: dark ? mix(bg, 'white', 0.14) : mix(bg, 'black', 0.1),
    sidebarActive: dark ? mix(bg, 'white', 0.12) : mix(bg, 'black', 0.06),
    accent: ac,
    accentText: readableOn(ac),
  }
}

/** Les variables CSS à poser sur la racine pour habiller l'application. */
export function themeVariables(theme: BrandTheme): Record<string, string> {
  return {
    '--marque-sidebar': theme.sidebar,
    '--marque-sidebar-text': theme.sidebarText,
    '--marque-sidebar-muted': theme.sidebarMuted,
    '--marque-sidebar-line': theme.sidebarLine,
    '--marque-sidebar-active': theme.sidebarActive,
    '--marque-accent': theme.accent,
    '--marque-accent-text': theme.accentText,
  }
}
