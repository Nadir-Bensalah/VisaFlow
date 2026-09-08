import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useAuth } from '@/data/auth'
import { HAS_BACKEND } from '@/lib/supabase'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Avatar, Button, Field, Input, Select } from '@/components/ui'
import type { Locale } from '@/data/types'

export function Login() {
  const { db, signIn } = useStore()
  const auth = useAuth()
  const { t, locale, setLocale } = useI18n()
  const navigate = useNavigate()

  // Mode réel : un vrai compte, un vrai mot de passe. Mode démonstration : on
  // choisit un profil d'un clic, sans backend.
  const real = HAS_BACKEND

  const enter = (userId: string) => { signIn(userId); navigate('/') }

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  /* L'écran de récupération vit ici plutôt que sur une adresse à part : une page
     de plus, c'est une page à traduire, à protéger et à tenir à jour, pour un
     formulaire d'un seul champ. */
  const [oubli, setOubli] = useState(false)
  const [envoye, setEnvoye] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function signInReal(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const err = await auth.signIn(email.trim(), password)
    setBusy(false)
    if (err) { setError(err === 'Invalid login credentials' ? t('login.wrong') : err); return }
    navigate('/')
  }

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="row gap-3" style={{ marginBottom: 'var(--sp-8)' }}>
          <span className="sidebar__mark" style={{ background: db.agency.accent, width: 36, height: 36, borderRadius: 10 }}>{db.agency.mark}</span>
          <div className="col" style={{ minWidth: 0 }}>
            <span className="t-title t-truncate">{db.agency.name}</span>
            <span className="t-caption t-tertiary t-truncate">{db.agency.slug}.visaflow.app</span>
          </div>
          <span className="grow" />
          <Select aria-label={t('misc.language')} value={locale} onChange={(e) => setLocale(e.target.value as Locale)} style={{ width: 'auto', minHeight: 32 }}>
            {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_META[l].native}</option>)}
          </Select>
        </div>

        <h1 style={{ fontSize: 'var(--size-h3)' }}>{t('login.title')}</h1>
        <p className="t-small t-secondary" style={{ marginTop: 'var(--sp-2)', marginBottom: 'var(--sp-6)' }}>
          {real ? t('login.subtitleReal') : t('login.subtitle')}
        </p>

        {real && oubli ? (
          <form
            className="col gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true); setError(null)
              const err = await auth.sendRecovery(email)
              setBusy(false)
              if (err) setError(err); else setEnvoye(true)
            }}
          >
            <p className="t-small t-secondary" style={{ margin: 0 }}>{t('login.forgotHint')}</p>
            <Field label={t('login.email')} error={error ?? undefined}>
              <Input type="email" autoComplete="username" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="vous@agence.tn" />
            </Field>
            {envoye ? (
              <p className="t-small" style={{ color: 'var(--green)', margin: 0 }}>{t('login.forgotSent')}</p>
            ) : (
              <Button type="submit" variant="primary" block disabled={busy || !email}>
                {busy ? t('login.signingIn') : t('login.forgotSend')}
              </Button>
            )}
            <button type="button" className="linkish t-small"
              onClick={() => { setOubli(false); setEnvoye(false); setError(null) }}>
              {t('login.forgotBack')}
            </button>
          </form>
        ) : real ? (
          <form className="col gap-4" onSubmit={signInReal}>
            <Field label={t('login.email')}>
              <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@agence.tn" />
            </Field>
            <Field label={t('login.password')} error={error ?? undefined}>
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" block disabled={busy || !email || !password}>
              {busy ? t('login.signingIn') : t('action.signIn')}
            </Button>
            <button type="button" className="linkish t-small" onClick={() => { setOubli(true); setError(null) }}>
              {t('login.forgot')}
            </button>
          </form>
        ) : (
          <>
            <div className="col gap-4" style={{ marginBottom: 'var(--sp-6)' }}>
              <Field label={t('login.email')}><Input type="email" placeholder="amira@tca-ltd.com" defaultValue="amira@tca-ltd.com" /></Field>
              <Field label={t('login.password')}><Input type="password" defaultValue="demo" /></Field>
              <Button variant="primary" block onClick={() => enter(db.users[1].id)}>{t('action.signIn')}</Button>
            </div>
            <div className="col gap-2">
              <span className="t-caption t-tertiary">{t('login.demo')}</span>
              {db.users.slice(0, 4).map((u) => (
                <button key={u.id} type="button" className="list__row" style={{ borderRadius: 'var(--radius-field)', padding: 'var(--sp-2) var(--sp-3)' }} onClick={() => enter(u.id)}>
                  <Avatar name={u.name} size="sm" />
                  <span className="col grow" style={{ minWidth: 0 }}>
                    <span className="t-small t-medium">{u.name}</span>
                    <span className="t-caption t-tertiary">{t(`misc.${u.role === 'agent' ? 'agentRole' : u.role}` as 'misc.owner')}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-6)' }}>
          {t('login.clientAccess')}
          <br />
          <Link to="/inscription" style={{ fontSize: 'var(--size-caption)' }}>{t('signup.title')}</Link>
        </p>
      </div>
    </div>
  )
}
