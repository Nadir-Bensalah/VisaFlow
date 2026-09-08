/**
 * La version publiée.
 *
 * GitHub Pages garde `index.html` dix minutes en cache : sans repère visible,
 * impossible de savoir si l'écran qu'on regarde est la dernière version ou
 * celle d'il y a une heure. Le numéro de commit et la date du build sont donc
 * gravés dans le fichier au moment de le construire, et affichés dans les
 * réglages. La question « c'est bien la nouvelle version ? » se tranche alors
 * en une seconde, sans avoir à deviner.
 */
export const VERSION: string = typeof __VF_VERSION__ === 'string' ? __VF_VERSION__ : 'local'
export const BUILT_AT: string = typeof __VF_BUILT_AT__ === 'string' ? __VF_BUILT_AT__ : ''

/** « a1b2c3d · 8 sept. 2026 14:12 », pour l'afficher d'un bloc. */
export function versionLabel(locale = 'fr'): string {
  if (!BUILT_AT) return VERSION
  const d = new Date(BUILT_AT)
  const quand = d.toLocaleString(locale, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  return `${VERSION} · ${quand}`
}
