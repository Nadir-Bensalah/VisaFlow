import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/* L'horloge est separee du magasin, volontairement.
   Si elle vivait dans le meme contexte, chaque battement ferait re-rendre
   toute l'application, et un champ en cours de saisie perdrait le focus
   toutes les trente secondes. */

const ClockContext = createContext<number>(Date.now())

export function ClockProvider({ children, intervalMs = 30_000 }: { children: ReactNode; intervalMs?: number }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    const onVisible = () => { if (!document.hidden) setNow(Date.now()) }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])

  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>
}

export const useNow = () => useContext(ClockContext)
