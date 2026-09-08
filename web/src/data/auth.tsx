import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { HAS_BACKEND, supabase } from '@/lib/supabase'

/* L'authentification réelle, quand un backend est configuré.
   Elle vit à côté du magasin d'agence, pas dedans : le super-admin de la
   plateforme n'appartient à aucune agence, et le portail client n'a pas de
   compte du tout. Un seul endroit sait qui est connecté. */

interface AuthValue {
  ready: boolean
  session: Session | null
  user: User | null
  /** Vrai quand le compte connecté est un super-admin de la plateforme. */
  isPlatformAdmin: boolean
  /** Vrai une fois la question tranchée par le serveur, pas avant. */
  adminChecked: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!HAS_BACKEND)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  // L'identité pour laquelle le statut super-admin est connu. Le lier à la
  // session, plutôt qu'un booléen à part, supprime la course où la console
  // montait avec un statut périmé de la session précédente.
  const [adminCheckedFor, setAdminCheckedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) { setReady(true); return }
    let alive = true

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      setReady(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  // Le statut de super-admin se demande au serveur, jamais déduit du jeton :
  // un jeton dit l'agence, pas ce pouvoir-là, qui vit dans une table à part.
  useEffect(() => {
    if (!supabase || !session) { setIsPlatformAdmin(false); return }
    let alive = true
    const uid = session.user.id
    supabase.rpc('is_platform_admin').then(({ data }) => {
      if (!alive) return
      setIsPlatformAdmin(data === true)
      setAdminCheckedFor(uid)
    })
    return () => { alive = false }
  }, [session])

  const value = useMemo<AuthValue>(() => ({
    ready,
    session,
    user: session?.user ?? null,
    isPlatformAdmin,
    // Vrai quand la question est tranchée pour CETTE session, pas une autre.
    adminChecked: session ? adminCheckedFor === session.user.id : true,
    async signIn(email, password) {
      if (!supabase) return 'Aucun backend configuré.'
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      // On rend le message tel quel : « Invalid login credentials » devient
      // une phrase utile côté écran, pas un code.
      return error ? error.message : null
    },
    async signOut() {
      await supabase?.auth.signOut()
    },
  }), [ready, session, isPlatformAdmin, adminCheckedFor])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth hors de AuthProvider')
  return ctx
}
