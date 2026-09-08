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
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!HAS_BACKEND)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)

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
    supabase.rpc('is_platform_admin').then(({ data }) => {
      if (alive) setIsPlatformAdmin(data === true)
    })
    return () => { alive = false }
  }, [session])

  const value = useMemo<AuthValue>(() => ({
    ready,
    session,
    user: session?.user ?? null,
    isPlatformAdmin,
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
  }), [ready, session, isPlatformAdmin])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth hors de AuthProvider')
  return ctx
}
