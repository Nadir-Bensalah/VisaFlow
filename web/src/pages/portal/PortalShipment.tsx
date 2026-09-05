import { Link, useParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Card, Empty, Pill, Progress, Select } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { Ago, Countdown } from '@/components/bits'
import { SHIPMENT_STAGES, SHIPMENT_TONE, shipmentProgress } from '@/lib/derive'
import type { Locale } from '@/data/types'

export function PortalShipment() {
  const { token = '' } = useParams()
  const { db } = useStore()
  const { t, tt, locale, setLocale, formatDate, formatNumber } = useI18n()

  const shipment = db.shipments.find((s) => s.portalToken === token)
  if (!shipment) {
    return (
      <div className="portal">
        <main className="portal__main">
          <Empty title={t('search.noResult')} action={<Link to="/portail" className="btn btn--secondary">{t('action.back')}</Link>} />
        </main>
      </div>
    )
  }

  const events = db.shipmentEvents.filter((e) => e.shipmentId === shipment.id)
  const currentIndex = SHIPMENT_STAGES.indexOf(shipment.stage)
  const office = db.agency.offices.find((o) => o.id === shipment.officeId)!

  return (
    <div className="portal">
      <header className="portal__bar">
        <span className="sidebar__mark" style={{ background: db.agency.accent }}>{db.agency.mark}</span>
        <span className="t-medium grow t-truncate">{db.agency.name}</span>
        <Select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} style={{ width: 'auto', minHeight: 32 }}>
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_META[l].native}</option>)}
        </Select>
      </header>

      <main className="portal__main">
        <div className="portal__hero">
          <h1>{t('portal.yourShipment')}</h1>
          <p>{shipment.originPort} → {shipment.destPort}</p>
          <div className="row gap-3" style={{ justifyContent: 'center', marginTop: 'var(--sp-5)' }}>
            <Pill tone={SHIPMENT_TONE[shipment.stage]} dot>{t(`ship.s.${shipment.stage}` as 'ship.s.transit')}</Pill>
            <span className="t-small t-tertiary t-mono">{shipment.reference}</span>
          </div>
        </div>

        <div className="col gap-5">
          <Card title={t('ship.tracking')}>
            <div className="col gap-5">
              <Progress pct={shipmentProgress(shipment)} tone={shipment.stage === 'livre' ? 'green' : undefined} />
              <div className="row-between">
                <span className="t-small t-secondary">{t('ship.eta')}</span>
                <span className="t-medium">
                  {shipment.status === 'en_cours' ? <Countdown iso={shipment.eta} /> : formatDate(shipment.deliveredAt ?? shipment.eta)}
                </span>
              </div>
              <ul className="timeline">
                {SHIPMENT_STAGES.map((stage, i) => {
                  const event = events.find((e) => e.stage === stage)
                  return (
                    <li key={stage} className="timeline__item">
                      <span className={`timeline__dot ${i < currentIndex ? 'timeline__dot--done' : i === currentIndex ? 'timeline__dot--current' : ''}`} />
                      <div className="row-between wrap gap-2">
                        <div className="col">
                          <span className={i === currentIndex ? 't-medium' : 't-secondary'} style={{ fontSize: 14 }}>
                            {t(`ship.s.${stage}` as 'ship.s.transit')}
                          </span>
                          {event && <span className="t-caption t-tertiary">{event.location}</span>}
                        </div>
                        {event && <span className="t-caption t-tertiary"><Ago iso={event.at} /></span>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </Card>

          <Card title={t('ship.goods')}>
            <div className="col gap-3">
              <div className="row-between"><span className="t-small t-secondary">{t('ship.goods')}</span><span className="t-small">{tt(shipment.goods)}</span></div>
              <div className="row-between"><span className="t-small t-secondary">{t('ship.mode')}</span><span className="t-small">{t(`ship.m.${shipment.mode}` as 'ship.m.aerien')}</span></div>
              <div className="row-between"><span className="t-small t-secondary">{t('ship.packages')}</span><span className="t-small t-num">{formatNumber(shipment.packages)}</span></div>
              <div className="row-between"><span className="t-small t-secondary">{t('ship.weight')}</span><span className="t-small t-num">{formatNumber(shipment.weightKg)} kg</span></div>
              {shipment.containerNo && <div className="row-between"><span className="t-small t-secondary">{t('ship.container')}</span><span className="t-small t-mono">{shipment.containerNo}</span></div>}
            </div>
          </Card>

          <Card title={t('portal.contactAgency')}>
            <div className="col gap-3">
              <div className="row-between"><span className="t-small t-secondary">{office.name}</span><span className="t-small">{office.address}</span></div>
              <div className="row gap-2" style={{ marginTop: 'var(--sp-2)' }}>
                <a className="btn btn--secondary btn--sm" href={`https://wa.me/${office.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">
                  <Icon name="whatsapp" size={16} /> WhatsApp
                </a>
              </div>
            </div>
          </Card>

          <p className="t-caption t-tertiary" style={{ textAlign: 'center' }}>
            {t('portal.poweredBy')}
          </p>
        </div>
      </main>
    </div>
  )
}
