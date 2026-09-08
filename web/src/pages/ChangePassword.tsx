import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { rpc } from '@/data/remote'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Card, Field, Input } from '@/components/ui'
import { Illustration } from '@/components/Illustration'

/**
 * Le premier écran d'un compte invité : choisir son propre mot de passe.
 *
 * Le compte est né avec un mot de passe provisoire remis par téléphone ou
 * WhatsApp. Tant qu'il n'est pas remplacé, rien d'autre ne s'ouvre : c'est
 * RequireSession qui force le passage ici.
 */
export function ChangePassword() {
  const { t } = useI18n()
  const { retry } = useStore()
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const court = p1.length > 0 && p1.length < 8
  const differents = p2.length > 0 && p1 !== p2
  const valide = p1.length >= 8 && p1 === p2

  const enregistrer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase || !valide) return
    setBusy(true); setError('')
    const { error: err } = await supabase.auth.updateUser({ password: p1 })
    if (err) { setError(err.message); setBusy(false); return }
    try {
      await rpc('password_reset_done', {})
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : t('sync.ecriture')); setBusy(false); return
    }
    // Le profil rechargé n'a plus le drapeau : la porte s'ouvre.
    retry()
  }

  return (
    <div className="portal">
      <main className="portal__main" style={{ maxWidth: 480 }}>
        <div className="portal__hero">
          <Illustration scene="equipe" size={120} />
          <h1>{t('equipe.pwdTitle')}</h1>
          <p>{t('equipe.pwdHint')}</p>
        </div>
        <Card>
          <form className="col gap-4" onSubmit={(e) => void enregistrer(e)}>
            <Field label={t('equipe.pwdNew')} error={court ? t('equipe.pwdShort') : undefined}>
              <Input type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} />
            </Field>
            <Field label={t('equipe.pwdConfirm')} error={differents ? t('equipe.pwdMismatch') : error || undefined}>
              <Input type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" block disabled={!valide || busy}>{t('equipe.pwdSave')}</Button>
          </form>
        </Card>
      </main>
    </div>
  )
}
