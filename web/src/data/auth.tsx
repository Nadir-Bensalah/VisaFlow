import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { HAS_BACKEND, supabase } from '@/lib/supabase'
import { sessionTouch } from '@/data/securite'

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
  /** Vrai quand on revient d'un lien « mot de passe oublié » : la session est
      ouverte, mais elle ne sert qu'à en choisir un nouveau. */
  recovering: boolean
  /** Envoie le lien de réinitialisation. Rend un message d'erreur, ou null. */
  sendRecovery: (email: string) => Promise<string | null>
  /** Pose le nouveau mot de passe et referme la parenthèse de récupération. */
  finishRecovery: () => void
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
  /* Le retour d'un lien « mot de passe oublié ». Supabase ouvre alors une vraie
     session, ce qui est déroutant : sans ce drapeau, la personne se retrouverait
     dans l'application sans avoir choisi de mot de passe, et le lien resterait
     valable dans sa boîte. */
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    if (!supabase) { setReady(true); return }
    let alive = true

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      setReady(true)
      // Le journal des appareils. Il ne bloque rien et ne lève jamais : une
      // trace manquante ne doit pas empêcher quelqu'un de travailler.
      if (data.session) void sessionTouch()
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') setRecovering(false)
      if (event === 'SIGNED_IN' && next) void sessionTouch()
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
      setRecovering(false)
    },
    recovering,
    async sendRecovery(email) {
      if (!supabase) return 'Aucun backend configuré.'
      /* Le lien doit revenir sur CETTE page, pas sur une adresse devinée : le
         site vit sous un sous-chemin sur les pages GitHub, et une adresse fausse
         mène à une page blanche avec un jeton valable dans l'URL. */
      const retour = `${window.location.origin}${import.meta.env.BASE_URL ?? '/'}connexion`
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: retour.replace(/\/{2,}/g, '/').replace(':/', '://'),
      })
      return error ? error.message : null
    },
    finishRecovery() { setRecovering(false) },
  }), [ready, session, isPlatformAdmin, adminCheckedFor, recovering])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth hors de AuthProvider')
  return ctx
}
