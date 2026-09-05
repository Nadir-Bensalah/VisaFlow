import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Card, Select } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { clientName, progress } from '@/lib/derive'
import type { Locale } from '@/data/types'

/* Cette page n'existe que pour la demonstration : en vrai, le client arrive
   directement sur son lien personnel, envoye par WhatsApp. */
export function PortalIndex() {
  const { db } = useStore()
  const { t, locale, setLocale } = useI18n()
  const open = db.cases.filter((c) => c.status === 'ouvert').slice(0, 8)

  return (
    <div className="portal">
      <header className="portal__bar">
        <span className="sidebar__mark" style={{ background: db.agency.accent }}>{db.agency.mark}</span>
        <span className="t-medium grow">{db.agency.name}</span>
        <Select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} style={{ width: 'auto', minHeight: 32 }}>
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_META[l].native}</option>)}
        </Select>
        <Link to="/" className="btn btn--ghost btn--sm">{t('nav.dashboard')}</Link>
      </header>

      <main className="portal__main">
        <div className="portal__hero">
          <h1>{t('portal.title')}</h1>
          <p>{t('portal.noAccount')}</p>
        </div>

        <Card title={t('misc.demoData')} flush>
          <div className="list">
            {open.map((c) => {
              const p = progress(db, c.id)
              return (
                <Link key={c.id} to={`/portail/${c.portalToken}`} className="list__row">
                  <Icon name="passport" size={18} className="t-tertiary" />
                  <span className="col grow" style={{ minWidth: 0 }}>
                    <span className="t-medium t-small">{clientName(db, c.clientId)}</span>
                    <span className="t-caption t-tertiary">{c.reference} · {p.done}/{p.total}</span>
                  </span>
                  <Icon name="chevron" size={16} className="t-tertiary" />
                </Link>
              )
            })}
          </div>
        </Card>

        <div style={{ height: 'var(--sp-5)' }} />

        <Card title={t('ship.title')} flush>
          <div className="list">
            {db.shipments.filter((x) => x.status === 'en_cours').slice(0, 6).map((x) => (
              <Link key={x.id} to={`/portail/cargaison/${x.portalToken}`} className="list__row">
                <Icon name="ship" size={18} className="t-tertiary" />
                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className="t-medium t-small">{clientName(db, x.clientId)}</span>
                  <span className="t-caption t-tertiary">{x.reference} · {x.originPort} → {x.destPort}</span>
                </span>
                <Icon name="chevron" size={16} className="t-tertiary" />
              </Link>
            ))}
          </div>
        </Card>
      </main>
    </div>
  )
}
