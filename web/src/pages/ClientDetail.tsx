import { Link, useParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Avatar, Card, Empty, Pill } from '@/components/ui'
import { Ago, CaseRow, PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { daysUntil } from '@/lib/derive'

export function ClientDetail() {
  const { id = '' } = useParams()
  const { db } = useStore()
  const v = useVisible()
  const { t, tt, formatDate } = useI18n()

  const client = v.clients.find((c) => c.id === id)
  if (!client) return <Empty title={t('clients.none')} action={<Link to="/clients" className="btn btn--secondary">{t('action.back')}</Link>} />

  const cases = v.cases.filter((c) => c.clientId === client.id)
  const events = v.events.filter((e) => cases.some((c) => c.id === e.caseId)).slice(0, 12)
  const shipments = v.shipments.filter((x) => x.clientId === client.id)
  const passportSoon = daysUntil(client.passportExpiry) < 180

  return (
    <>
      <PageHead title={`${client.firstName} ${client.lastName}`} subtitle={client.nativeName ?? client.nationality} />

      <div className="grid grid--main">
        <div className="stack">
          <Card title={t('clients.casesCount')} flush>
            {cases.length === 0 ? <Empty title={t('cases.none')} /> : (
              <div className="list">{cases.map((c) => <CaseRow key={c.id} kase={c} />)}</div>
            )}
          </Card>

          {shipments.length > 0 && (
            <Card title={t('ship.title')} flush>
              <div className="list">
                {shipments.map((x) => (
                  <Link key={x.id} to={`/cargaisons/${x.id}`} className="list__row">
                    <Icon name="ship" size={18} className="t-tertiary" />
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <span className="t-small t-medium t-truncate">{tt(x.goods)}</span>
                      <span className="t-caption t-tertiary">{x.reference} · {x.originPort} → {x.destPort}</span>
                    </span>
                    <Pill tone="blue" dot>{t(`ship.s.${x.stage}` as 'ship.s.transit')}</Pill>
                  </Link>
                ))}
              </div>
            </Card>
          )}

          <Card title={t('caseDetail.history')} flush>
            <div className="list">
              {events.map((e) => (
                <div key={e.id} className="list__row">
                  <Icon name={e.automated ? 'automations' : 'check'} size={16} className="t-tertiary" />
                  <span className="col grow" style={{ minWidth: 0 }}>
                    <span className="t-small t-truncate">{tt(e.detail)}</span>
                    <span className="t-caption t-tertiary"><Ago iso={e.at} /></span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card>
            <div className="row gap-4" style={{ marginBottom: 'var(--sp-5)' }}>
              <Avatar name={`${client.firstName} ${client.lastName}`} size="lg" />
              <div className="col">
                <span className="t-medium">{client.firstName} {client.lastName}</span>
                <span className="t-caption t-tertiary">{t('clients.since')} {formatDate(client.createdAt)}</span>
              </div>
            </div>
            <div className="col gap-3">
              <div className="row-between"><span className="t-small t-secondary">{t('clients.contact')}</span><span className="t-small t-mono">{client.phone}</span></div>
              <div className="row-between"><span className="t-small t-secondary">{t('login.email')}</span><span className="t-small t-truncate">{client.email}</span></div>
              <div className="row-between"><span className="t-small t-secondary">{t('clients.nationality')}</span><span className="t-small">{client.nationality}</span></div>
              <div className="row-between"><span className="t-small t-secondary">{t('clients.passport')}</span><span className="t-small t-mono">{client.passportNumber}</span></div>
              <div className="row-between">
                <span className="t-small t-secondary">{t('clients.expiry')}</span>
                {passportSoon
                  ? <Pill tone="orange" dot>{formatDate(client.passportExpiry)}</Pill>
                  : <span className="t-small">{formatDate(client.passportExpiry)}</span>}
              </div>
              <div className="row-between"><span className="t-small t-secondary">{t('misc.language')}</span><span className="t-small">{client.locale.toUpperCase()}</span></div>
              <div className="row-between"><span className="t-small t-secondary">{t('misc.office')}</span><span className="t-small">{db.agency.offices.find((o) => o.id === client.officeId)?.name}</span></div>
            </div>
            <div className="row gap-2" style={{ marginTop: 'var(--sp-5)' }}>
              <a className="btn btn--secondary btn--sm" href={`https://wa.me/${client.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">
                <Icon name="whatsapp" size={16} /> WhatsApp
              </a>
              <a className="btn btn--secondary btn--sm" href={`tel:${client.phone.replace(/\s/g, '')}`}>
                <Icon name="phone" size={16} /> {t('action.call')}
              </a>
            </div>
          </Card>

          {passportSoon && (
            <Card title={t('clients.passportSoon')}>
              <p className="t-small t-secondary">{t('portal.expiresIn')}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
