import { Link } from 'react-router-dom'
import { useI18n } from '@/i18n'

export function NotFound() {
  const { t } = useI18n()
  return (
    <div className="auth">
      <div className="auth__card" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--size-h2)' }}>404</h1>
        <p className="t-secondary" style={{ margin: 'var(--sp-3) 0 var(--sp-6)' }}>{t('search.noResult')}</p>
        <Link to="/" className="btn btn--primary">{t('action.back')}</Link>
      </div>
    </div>
  )
}
