import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { passwordResetDone } from '@/data/plateforme'
import { Button, Field, Input } from '@/components/ui'

/**
 * Le premier écran d'un admin invité : choisir son propre mot de passe.
 *
 * Copie de pages/ChangePassword.tsx, mais sans le magasin d'agence ni la
 * traduction : un admin de plateforme n'appartient à aucune agence, et la
 * console parle français. Tant que le drapeau `must_reset_password` est levé,
 * AdminShell affiche cet écran à la place des pages.
 */
export function AdminPassword({ onDone }: { onDone: () => void }) {
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const court = p1.length > 0 && p1.length < 8
  const differents = p2.length > 0 && p1 !== p2
  const valide = p1.length >= 8 && p1 === p2

  const enregistrer = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase || !valide) return
    setBusy(true); setError('')
    const { error: err } = await supabase.auth.updateUser({ password: p1 })
    if (err) { setError(err.message); setBusy(false); return }
    try {
      await passwordResetDone()
    } catch (e2) {
      // Le mot de passe est déjà changé : on le dit, mais on ne bloque pas
      // la personne devant un drapeau qui n'a pas voulu se baisser.
      setError(e2 instanceof Error ? e2.message : 'Le drapeau n’a pas pu être levé.')
      setBusy(false)
      return
    }
    setBusy(false)
    // Le profil rechargé n'a plus le drapeau : la console s'ouvre.
    onDone()
  }

  return (
    <div className="adm__plein">
      <form className="adm__plein-carte" onSubmit={(e) => void enregistrer(e)}>
        <span className="adm__mark" aria-hidden="true">VF</span>
        <h1>Choisissez votre mot de passe</h1>
        <p className="t-small t-secondary">
          Votre compte est né avec un mot de passe provisoire. Remplacez-le avant d’entrer dans la console.
        </p>
        <Field label="Nouveau mot de passe" hint="8 caractères au minimum" error={court ? 'Trop court : 8 caractères au minimum.' : undefined}>
          <Input type="password" autoComplete="new-password" autoFocus value={p1} onChange={(e) => setP1(e.target.value)} />
        </Field>
        <Field label="Confirmez-le" error={differents ? 'Les deux saisies ne correspondent pas.' : error || undefined}>
          <Input type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" block disabled={!valide || busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer et entrer'}
        </Button>
      </form>
    </div>
  )
}
