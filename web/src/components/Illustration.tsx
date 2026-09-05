/* Illustrations au trait, dessinees ici, sans bibliotheque et sans emoji.
   Deux traits d'epaisseur : la structure en gris, l'accent en bleu.
   Elles servent les etats vides et les en-tetes, jamais la decoration. */

export type Scene = 'journee' | 'vide' | 'passeport' | 'cargo' | 'message' | 'termine' | 'equipe' | 'alerte'

const S = {
  stroke: 'var(--text-tertiary)',
  accent: 'var(--blue)',
}

export function Illustration({ scene, size = 132 }: { scene: Scene; size?: number }) {
  const common = {
    width: size,
    height: (size * 3) / 4,
    viewBox: '0 0 160 120',
    fill: 'none' as const,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: 'false' as const,
  }

  switch (scene) {
    case 'journee':
      return (
        <svg {...common}>
          <path d="M20 84h120" stroke={S.stroke} strokeWidth="1.5" />
          <circle cx="80" cy="54" r="18" stroke={S.accent} strokeWidth="1.75" />
          <path d="M80 24v-9M80 93v-9M110 54h9M41 54h-9M101 33l6-6M53 75l-6 6M101 75l6 6M53 33l-6-6" stroke={S.accent} strokeWidth="1.5" />
          <path d="M28 84c8-14 18-20 30-18" stroke={S.stroke} strokeWidth="1.5" />
          <path d="M110 84c6-9 13-13 22-12" stroke={S.stroke} strokeWidth="1.5" />
        </svg>
      )
    case 'vide':
      return (
        <svg {...common}>
          <path d="M34 44a6 6 0 0 1 6-6h22l7 9h50a6 6 0 0 1 6 6v39a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6V44Z" stroke={S.stroke} strokeWidth="1.5" />
          <path d="M50 62h60M50 74h38" stroke={S.stroke} strokeWidth="1.5" strokeDasharray="4 6" />
          <circle cx="118" cy="36" r="12" stroke={S.accent} strokeWidth="1.75" />
          <path d="M118 31v6M118 42h.01" stroke={S.accent} strokeWidth="1.75" />
        </svg>
      )
    case 'passeport':
      return (
        <svg {...common}>
          <rect x="46" y="20" width="62" height="82" rx="8" stroke={S.stroke} strokeWidth="1.5" />
          <circle cx="77" cy="52" r="14" stroke={S.accent} strokeWidth="1.75" />
          <path d="M63 52h28M77 38c5 5 5 23 0 28M77 38c-5 5-5 23 0 28" stroke={S.accent} strokeWidth="1.25" />
          <path d="M62 80h30M68 90h18" stroke={S.stroke} strokeWidth="1.5" />
        </svg>
      )
    case 'cargo':
      return (
        <svg {...common}>
          <path d="M18 88c6 0 6 5 12 5s6-5 12-5 6 5 12 5 6-5 12-5 6 5 12 5 6-5 12-5 6 5 12 5 6-5 12-5" stroke={S.accent} strokeWidth="1.75" />
          <path d="M30 78 26 58h108l-6 20" stroke={S.stroke} strokeWidth="1.5" />
          <rect x="54" y="34" width="26" height="24" rx="3" stroke={S.stroke} strokeWidth="1.5" />
          <rect x="82" y="24" width="26" height="34" rx="3" stroke={S.accent} strokeWidth="1.5" />
          <path d="M60 34v24M74 34v24M88 24v34M102 24v34" stroke={S.stroke} strokeWidth="1" opacity="0.5" />
        </svg>
      )
    case 'message':
      return (
        <svg {...common}>
          <path d="M28 46a10 10 0 0 1 10-10h56a10 10 0 0 1 10 10v26a10 10 0 0 1-10 10H58l-18 14V82h-2a10 10 0 0 1-10-10V46Z" stroke={S.stroke} strokeWidth="1.5" />
          <path d="M46 54h40M46 66h26" stroke={S.accent} strokeWidth="1.75" />
          <circle cx="122" cy="38" r="12" stroke={S.accent} strokeWidth="1.5" />
          <path d="M117 38l4 4 7-8" stroke={S.accent} strokeWidth="1.75" />
        </svg>
      )
    case 'termine':
      return (
        <svg {...common}>
          <circle cx="80" cy="60" r="30" stroke={S.accent} strokeWidth="1.75" />
          <path d="M67 60l9 9 18-19" stroke={S.accent} strokeWidth="2" />
          <path d="M34 40c-4 6-6 13-6 20M126 40c4 6 6 13 6 20" stroke={S.stroke} strokeWidth="1.5" strokeDasharray="3 7" />
        </svg>
      )
    case 'equipe':
      return (
        <svg {...common}>
          <circle cx="64" cy="46" r="14" stroke={S.accent} strokeWidth="1.75" />
          <path d="M38 92v-6a18 18 0 0 1 18-18h16a18 18 0 0 1 18 18v6" stroke={S.accent} strokeWidth="1.5" />
          <circle cx="106" cy="52" r="10" stroke={S.stroke} strokeWidth="1.5" />
          <path d="M96 92v-4a14 14 0 0 1 14-14h4a14 14 0 0 1 14 14v4" stroke={S.stroke} strokeWidth="1.5" />
        </svg>
      )
    case 'alerte':
      return (
        <svg {...common}>
          <path d="M80 26 34 96h92L80 26Z" stroke={S.accent} strokeWidth="1.75" />
          <path d="M80 54v20M80 84h.01" stroke={S.accent} strokeWidth="2" />
        </svg>
      )
  }
}
