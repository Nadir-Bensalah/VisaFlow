import { useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Avatar, Button, Field, Input, Select } from '@/components/ui'
import type { Locale } from '@/data/types'

export function Login() {
  const { db, signIn } = useStore()
  const { t, locale, setLocale } = useI18n()
  const navigate = useNavigate()

  const enter = (userId: string) => {
    signIn(userId)
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
        <p className="t-small t-secondary" style={{ marginTop: 'var(--sp-2)', marginBottom: 'var(--sp-6)' }}>{t('login.subtitle')}</p>

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

        <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-6)' }}>{t('login.clientAccess')}</p>
      </div>
    </div>
  )
}
