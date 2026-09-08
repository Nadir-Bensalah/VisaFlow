import { createClient } from '@supabase/supabase-js'

/* Le client Supabase, seul point de contact avec le vrai backend.
   Les deux valeurs sont publiques : la clé anon est faite pour vivre dans un
   navigateur, et elle n'ouvre rien par elle-même. Ce sont les politiques au
   niveau des lignes qui protègent, jamais le secret de cette clé. */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Vrai quand le projet est configuré. Faux en mode démonstration hors ligne,
    où le magasin retombe sur le jeu local. Aucune page n'a à le savoir : elles
    lisent toujours `useStore()`. */
export const HAS_BACKEND = Boolean(url && anon)

export const supabase = HAS_BACKEND
  ? createClient(url!, anon!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Une seule agence par onglet : la clé de session porte le slug, pour
        // qu'un poste ouvert sur deux agences ne les mélange pas.
        storageKey: 'visaflow.auth',
        detectSessionInUrl: false,
      },
    })
  : null
