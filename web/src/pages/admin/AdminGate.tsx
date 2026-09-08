import { useState } from 'react'
import { useAuth } from '@/data/auth'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Field, Input } from '@/components/ui'
import { AdminConsole } from './AdminConsole'

/* La porte de l'espace plateforme. Un mot de passe, pas un simple clic : c'est
   l'accès le plus puissant du produit. Si le compte connecté n'est pas
   super-admin, la console elle-même renvoie ailleurs. */
export function AdminGate() {
  const { ready, session, adminChecked, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!HAS_BACKEND) {
    return (
      <div className="admin admin--gate">
        <div className="admin__signin">
          <span className="admin__mark admin__mark--lg">VF</span>
          <h1>Console plateforme</h1>
          <p className="t-small t-secondary">Cet espace n'existe qu'avec un backend configuré. Il pilote toutes les agences.</p>
        </div>
      </div>
    )
  }

  if (!ready || (session && !adminChecked)) return <div className="admin admin--gate" />

  if (session) return <AdminConsole />

  return (
    <div className="admin admin--gate">
      <form
        className="admin__signin"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true); setError(null)
          const err = await signIn(email.trim(), password)
          setBusy(false)
          if (err) setError(err === 'Invalid login credentials' ? 'Identifiants incorrects.' : err)
        }}
      >
        <span className="admin__mark admin__mark--lg">VF</span>
        <h1>Console plateforme</h1>
        <p className="t-small t-secondary" style={{ marginBottom: 'var(--sp-6)' }}>
          L'espace d'où toute la plateforme se pilote. Réservé à la direction.
        </p>
        <div className="col gap-4" style={{ width: '100%' }}>
          <Field label="Adresse">
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.tn" />
          </Field>
          <Field label="Mot de passe" error={error ?? undefined}>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" block disabled={busy || !email || !password}>
            {busy ? 'Connexion…' : 'Entrer'}
          </Button>
        </div>
      </form>
    </div>
  )
}
