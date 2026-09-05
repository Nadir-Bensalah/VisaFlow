import type { CSSProperties } from 'react'

/* Icones dessinees a la main, trait 1.6, grille 24.
   Aucune bibliotheque : le poids de la page reste celui du contenu. */

const P: Record<string, string> = {
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
  pipeline: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v11h-4z',
  cases: 'M3 7a2 2 0 0 1 2-2h3.6l1.6 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  clients: 'M16 19v-1.5A3.5 3.5 0 0 0 12.5 14h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm10 8v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  documents: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h4',
  appointments: 'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Zm0 3h16M8 3v4m8-4v4',
  messages: 'M20 12a7 7 0 0 1-7 7H8l-4 3v-4.6A7 7 0 0 1 4 12v-.5A6.5 6.5 0 0 1 10.5 5h3A6.5 6.5 0 0 1 20 11.5v.5Z',
  payments: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm0 3h18M7 15h3',
  automations: 'M13 3 5 14h5l-1 7 8-11h-5l1-7Z',
  reports: 'M5 20V10m7 10V4m7 16v-7',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5a8 8 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2-1.2L15 3H9l-.5 2.6a8 8 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a8 8 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2 1.2L9 21h6l.5-2.6a8 8 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2Z',
  portal: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.5-2.4 3.8-5.4 3.8-9S14.5 5.4 12 3C9.5 5.4 8.2 8.4 8.2 12s1.3 6.6 3.8 9ZM3.5 9h17M3.5 15h17',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4.5 4.5',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 13 4.5 4.5L19 7',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'm9 5 7 7-7 7',
  arrow: 'M5 12h13m-5-6 6 6-6 6',
  bell: 'M18 16v-5a6 6 0 1 0-12 0v5l-2 3h16l-2-3ZM10 21a2.4 2.4 0 0 0 4 0',
  menu: 'M4 7h16M4 12h16M4 17h16',
  logout: 'M15 12H4m0 0 4-4m-4 4 4 4m4-9V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-1',
  whatsapp: 'M20 11.7A8 8 0 0 1 8.6 19L4 20.5l1.6-4.4A8 8 0 1 1 20 11.7Zm-11.4-3c-.3 0-.6.1-.9.5-.3.4-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.2 5 4.3 2.4.9 2.9.7 3.4.7.5-.1 1.6-.7 1.9-1.3.2-.7.2-1.2.1-1.3l-.8-.4-1.6-.8c-.3-.1-.5-.1-.7.2l-.7.9c-.2.2-.3.2-.6.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4 0-.6.1-.7l.5-.6.3-.6v-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5Z',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  phone: 'M6 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L15 12l5 2v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4 5.2 2 2 0 0 1 6 3Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3.5 2',
  alert: 'M12 3 2 20h20L12 3Zm0 6v5m0 3h.01',
  download: 'M12 4v11m0 0 4-4m-4 4-4-4M4 19h16',
  upload: 'M12 20V9m0 0 4 4m-4-4-4 4M4 5h16',
  copy: 'M9 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Zm-2 8H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2',
  filter: 'M4 6h16l-6 7v6l-4-2v-4L4 6Z',
  trash: 'M5 7h14M9 7V5h6v2m-8 0 1 13h8l1-13',
  edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z',
  dots: 'M6 12h.01M12 12h.01M18 12h.01',
  sparkle: 'm12 4 1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8L12 4Z',
  shield: 'M12 3 5 6v6c0 4.2 2.8 7.7 7 9 4.2-1.3 7-4.8 7-9V6l-7-3Z',
  language: 'M4 6h10M9 4v2c0 4-2.2 7.5-5 9m3-4c1.4 2 3.4 3.5 5 4m2 5 4-10 4 10m-6.6-3h5.2',
  building: 'M4 21V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v15M12 21V11a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v10M3 21h18M7 9h2M7 13h2M7 17h2M16 14h1M16 18h1',
  passport: 'M6 4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4Zm6.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM10 16h5',
  plane: 'M10 21h2l3-8 5.5-1.6a1.4 1.4 0 0 0 0-2.7L15 7l-3-4h-2l1.6 4.6L7 8.6 5.5 6.4h-2L5 11l-1.5 4.6h2L7 13.4l4.6 1.2L10 21Z',
  ship: 'M3 17c1.5 0 1.5 1.2 3 1.2s1.5-1.2 3-1.2 1.5 1.2 3 1.2 1.5-1.2 3-1.2 1.5 1.2 3 1.2 1.5-1.2 3-1.2M5 17l-1-5h16l-1.6 5M8 12V7h8v5M11 7V4h2v3',
  box: 'M3 8.5 12 4l9 4.5v7L12 20l-9-4.5v-7Zm0 0 9 4.5m0 0 9-4.5m-9 4.5V20',
  tasks: 'M4 7h2l1 1.5L9.5 5M4 14h2l1 1.5L9.5 12M13 7h7M13 15h7',
}

export type IconName = keyof typeof P

export function Icon({ name, size = 18, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={P[name]} />
    </svg>
  )
}
