/* Les memes jetons que la version web. Une seule identite visuelle,
   deux plateformes. */

export const color = {
  bg: '#F5F5F7',
  card: '#FFFFFF',
  elevated: '#FBFBFD',
  text: '#1D1D1F',
  secondary: '#6E6E73',
  tertiary: '#86868B',
  blue: '#0066CC',
  green: '#2D8C3C',
  orange: '#E85D04',
  red: '#E30000',
  violet: '#5E5CE6',
  hairline: 'rgba(0,0,0,0.08)',
  tintBlue: 'rgba(0,102,204,0.10)',
  tintGreen: 'rgba(45,140,60,0.12)',
  tintOrange: 'rgba(232,93,4,0.12)',
  tintRed: 'rgba(227,0,0,0.10)',
  tintGray: 'rgba(110,110,115,0.12)',
} as const

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const

export const radius = { card: 18, small: 12, field: 10, pill: 980 } as const

export const font = {
  h1: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.6 },
  h2: { fontSize: 22, fontWeight: '600' as const, letterSpacing: -0.4 },
  body: { fontSize: 16, fontWeight: '400' as const },
  small: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
}

/* Ombre douce, deux couches, comme sur le web. */
export const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
}
