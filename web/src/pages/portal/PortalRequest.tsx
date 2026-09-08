import { Link, useParams } from 'react-router-dom'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Card, Empty, Pill, Select } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { Illustration } from '@/components/Illustration'
import { Ago } from '@/components/bits'
import { usePublicRequest } from '@/pages/public/usePublicAgency'
import type { Locale } from '@/data/types'

/** Le suivi d'une demande, avant qu'elle ne devienne un dossier. */
export function PortalRequest() {
  const { token = '' } = useParams()
  const { t, locale, setLocale, formatDate } = useI18n()
  const result = usePublicRequest(token)

  if (result.status === 'chargement') {
    return <div className="portal"><main className="portal__main"><div className="portal__hero"><p className="t-secondary">…</p></div></main></div>
  }
  if (result.status === 'absente') {
    return (
      <div className="portal">
        <main className="portal__main">
          <Empty title={t('search.noResult')} scene="vide" action={<Link to="/agence" className="btn btn--secondary">{t('action.back')}</Link>} />
        </main>
      </div>
    )
  }

  const { request, agency, office, caseToken, caseReference } = result.data

  return (
    <div className="portal">
      <header className="portal__bar">
        <Link to="/agence" className="row gap-2" style={{ color: 'inherit' }}>
          <span className="sidebar__mark" style={{ background: agency.accent }}>{agency.mark}</span>
          <span className="t-medium t-truncate">{agency.name}</span>
        </Link>
        <span className="grow" />
        <Select
          aria-label={t('misc.language')}
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          style={{ width: 'auto', minHeight: 32 }}
        >
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_META[l].native}</option>)}
        </Select>
      </header>

      <main className="portal__main">
        <div className="portal__hero">
          <Illustration scene={request.status === 'ecartee' ? 'alerte' : 'termine'} size={140} />
          <h1>{t('portal.hello', { name: request.firstName ?? '' })}</h1>
          <p>{request.destination ?? request.goods}</p>
          <div className="row gap-3" style={{ justifyContent: 'center', marginTop: 'var(--sp-4)' }}>
            <Pill tone={request.status === 'nouvelle' ? 'blue' : request.status === 'convertie' ? 'green' : request.status === 'ecartee' ? 'red' : 'orange'} dot>
              {t(`inbox.${request.status === 'nouvelle' ? 'new' : request.status === 'qualifiee' ? 'qualified' : request.status === 'convertie' ? 'converted' : 'refused'}` as 'inbox.new')}
            </Pill>
            <span className="t-small t-tertiary t-mono">{request.reference}</span>
          </div>
        </div>

        <div className="stack">
          <Card>
            <div className="col gap-3">
              <div className="row-between">
                <span className="t-small t-secondary">{t('inbox.receivedAt')}</span>
                <span className="t-small">{formatDate(request.receivedAt)} · <Ago iso={request.receivedAt} /></span>
              </div>
              {request.travelDate && (
                <div className="row-between">
                  <span className="t-small t-secondary">{t('caseDetail.travelOn')}</span>
                  <span className="t-small">{formatDate(request.travelDate)}</span>
                </div>
              )}
              {request.note && <p className="t-small t-secondary">{request.note}</p>}
              {request.refusalReason && (
                <p className="t-small" style={{ color: 'var(--red)' }}>{request.refusalReason}</p>
              )}
              <p className="t-caption t-tertiary">{t('ask.sentHint')}</p>
            </div>
          </Card>

          {/* La demande est devenue un dossier : on passe le relais, plutôt
              que de laisser le client sur une page qui ne bougera plus. */}
          {caseToken && (
            <Card title={t('portal.yourCase')}>
              <Link to={`/portail/${caseToken}`} className="row gap-2">
                <Icon name="passport" size={16} />
                {caseReference} · {t('portal.timeline')}
              </Link>
            </Card>
          )}

          {office?.phone && (
            <Card title={t('portal.contactAgency')}>
              <div className="row gap-2 wrap">
                <a className="btn btn--secondary btn--sm" href={`https://wa.me/${office.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">
                  <Icon name="whatsapp" size={16} /> WhatsApp
                </a>
                <a className="btn btn--secondary btn--sm" href={`tel:${office.phone.replace(/\s/g, '')}`}>
                  <Icon name="phone" size={16} /> {office.phone}
                </a>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
