import { useState } from 'react'
import { useAuth } from '@/data/auth'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Field, Input } from '@/components/ui'
import { AdminSkeleton } from '@/components/AppSkeleton'
import { AdminShell } from './AdminShell'

/* La porte de la console plateforme, montée sur /admin/*.
   Un mot de passe, pas un simple clic : c'est l'accès le plus puissant du
   produit. Une fois la session ouverte, AdminShell prend le relais : c'est
   lui qui demande au serveur si le compte est admin, et qui renvoie ailleurs
   sinon. Tant qu'on attend un verdict, on dessine la charpente de la console,
   jamais un écran vide : c'est ce qui donnait l'impression que le site
   « saccadait » à chaque chargement. */
export function AdminGate() {
  const { ready, session, adminChecked, signIn, sendRecovery } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [oublie, setOublie] = useState<'non' | 'envoi' | 'parti'>('non')

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

  if (!ready || (session && !adminChecked)) return <AdminSkeleton />

  if (session) return <AdminShell />

  const motDePasseOublie = async () => {
    if (!email.trim()) { setError('Écrivez d’abord votre adresse.'); return }
    setOublie('envoi'); setError(null)
    const err = await sendRecovery(email.trim(), 'admin')
    // Que l'adresse existe ou non, la réponse est la même : on ne confirme
    // jamais à un inconnu qu'un compte existe.
    setOublie(err ? 'non' : 'parti')
    if (err) setError(err)
  }

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
          {oublie === 'parti' ? (
            <p className="t-caption t-secondary" role="status" style={{ margin: 0 }}>
              Si cette adresse a un compte, un lien vient de partir.
            </p>
          ) : (
            <button type="button" className="linkish t-caption" disabled={oublie === 'envoi'} onClick={() => void motDePasseOublie()}>
              {oublie === 'envoi' ? 'Envoi…' : 'Mot de passe oublié'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
