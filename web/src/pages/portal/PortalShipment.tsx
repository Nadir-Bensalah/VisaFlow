import { Link, useParams } from 'react-router-dom'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Button, Card, Empty, Pill, Progress, Select } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { Ago, Countdown } from '@/components/bits'
import { SHIPMENT_STAGES, SHIPMENT_TONE } from '@/lib/derive'
import { shipmentRoute } from '@/lib/fret'
import { usePortalShipment } from './usePortalView'
import type { Locale, ShipmentStage } from '@/data/types'

/**
 * Le suivi de cargaison, servi par le serveur quand un backend existe et par la
 * démonstration sinon. Le client y voit enfin son trajet TRONÇON PAR TRONÇON :
 * il n'existe aucune ligne directe Chine vers Radès, et « Shanghai → Malte →
 * Radès » avec l'attente au hub est la seule réponse honnête à sa question,
 * « pourquoi ça met quarante jours ».
 */
export function PortalShipment() {
  const { token = '' } = useParams()
  const { t, tt, locale, setLocale, formatDate, formatNumber } = useI18n()
  const result = usePortalShipment(token)

  if (result.status === 'chargement') {
    return <div className="portal"><main className="portal__main"><div className="portal__hero"><p className="t-secondary">…</p></div></main></div>
  }
  if (result.status === 'erreur') {
    return (
      <div className="portal"><main className="portal__main">
        <Empty title={t('sync.connexion')} hint={result.message}
          action={<Button onClick={() => window.location.reload()}>{t('sync.retry')}</Button>} />
      </main></div>
    )
  }
  if (result.status === 'absent') {
    return (
      <div className="portal"><main className="portal__main">
        <Empty title={t('search.noResult')}
          action={<Link to="/portail" className="btn btn--secondary">{t('action.back')}</Link>} />
      </main></div>
    )
  }

  const v = result.view
  const s = v.shipment
  const currentIndex = SHIPMENT_STAGES.indexOf(s.stage as ShipmentStage)
  const route = shipmentRoute(v.legs.map((l) => ({ ...l, id: String(l.seq) })))
  const pct = Math.round(((currentIndex + 1) / SHIPMENT_STAGES.length) * 100)

  return (
    <div className="portal">
      <header className="portal__bar">
        <span className="sidebar__mark" style={{ background: v.agency.accent }}>{v.agency.mark}</span>
        <span className="t-medium grow t-truncate">{v.agency.name}</span>
        <Select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} style={{ width: 'auto', minHeight: 32 }}>
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_META[l].native}</option>)}
        </Select>
      </header>

      <main className="portal__main">
        <div className="portal__hero">
          <h1>{t('portal.yourShipment')}</h1>
          <p>{s.originPort} → {s.destPort}</p>
          <div className="row gap-3" style={{ justifyContent: 'center', marginTop: 'var(--sp-5)' }}>
            <Pill tone={SHIPMENT_TONE[s.stage as ShipmentStage]} dot>
              {t(`ship.s.${s.stage}` as 'ship.s.transit')}
            </Pill>
            <span className="t-small t-tertiary t-mono">{s.reference}</span>
          </div>
        </div>

        <div className="stack">
          {s.blockedReason && (
            <p className="fret__warn"><Icon name="alert" size={14} /><span>{s.blockedReason}</span></p>
          )}

          <Card title={t('ship.tracking')}>
            <div className="col gap-5">
              <Progress pct={pct} tone={s.stage === 'livre' ? 'green' : undefined} />
              <div className="row-between">
                <span className="t-small t-secondary">{t('ship.eta')}</span>
                <span className="t-medium">
                  {s.status === 'en_cours' ? <Countdown iso={s.eta} /> : formatDate(s.deliveredAt ?? s.eta)}
                </span>
              </div>
              <ul className="timeline">
                {SHIPMENT_STAGES.map((stage, i) => {
                  const event = v.events.find((e) => e.stage === stage)
                  return (
                    <li key={stage} className="timeline__item">
                      <span className={`timeline__dot ${i < currentIndex ? 'timeline__dot--done' : i === currentIndex ? 'timeline__dot--current' : ''}`} />
                      <div className="row-between wrap gap-2">
                        <div className="col">
                          <span className={i === currentIndex ? 't-medium' : 't-secondary'} style={{ fontSize: 14 }}>
                            {t(`ship.s.${stage}` as 'ship.s.transit')}
                          </span>
                          {event?.location && <span className="t-caption t-tertiary">{event.location}</span>}
                        </div>
                        {event && <span className="t-caption t-tertiary"><Ago iso={event.at} /></span>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </Card>

          {/* Le trajet réel. Sans lui, le client croit que son conteneur va de
              Chine à Radès d'un trait, et ne comprend pas le délai. */}
          {route.legsCount > 0 && (
            <Card
              title={t('fret.route')}
              action={<span className="t-caption t-tertiary">{t('fret.legs', { n: route.legsCount })}</span>}
            >
              <ol className="fret__route">
                {route.legs.map((l) => (
                  <li key={l.seq} className="fret__leg">
                    <span className="fret__legDot">
                      <Icon name={l.mode === 'aerien' ? 'plane' : l.mode === 'routier' ? 'box' : 'ship'} size={13} />
                    </span>
                    <div className="col gap-1 grow" style={{ minWidth: 0 }}>
                      <span className="t-small t-medium">{l.fromPlace} → {l.toPlace}</span>
                      <span className="t-caption t-tertiary">
                        {[l.carrier, l.conveyance].filter(Boolean).join(' · ')}
                        {l.days != null ? ` · ${t('fret.days', { n: l.days })}` : ''}
                      </span>
                      <span className="t-caption t-tertiary">
                        {formatDate(l.atd ?? l.etd)} → {formatDate(l.ata ?? l.eta)}
                        {!l.ata && l.eta ? ` · ${t('fret.forecast')}` : ''}
                      </span>
                    </div>
                    {l.hubWaitDays != null && (
                      <span className="fret__hub" title={t('fret.hubWaitHint')}>
                        {t('fret.hubWait')} · {t('fret.days', { n: l.hubWaitDays })}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <Card title={t('ship.goods')}>
            <div className="col gap-3">
              {s.goods && (
                <div className="row-between"><span className="t-small t-secondary">{t('ship.goods')}</span><span className="t-small">{tt(s.goods)}</span></div>
              )}
              <div className="row-between"><span className="t-small t-secondary">{t('ship.mode')}</span><span className="t-small">{t(`ship.m.${s.mode}` as 'ship.m.aerien')}</span></div>
              {s.packages != null && (
                <div className="row-between"><span className="t-small t-secondary">{t('ship.packages')}</span><span className="t-small t-num">{formatNumber(s.packages)}</span></div>
              )}
              {s.weightKg != null && (
                <div className="row-between"><span className="t-small t-secondary">{t('ship.weight')}</span><span className="t-small t-num">{formatNumber(s.weightKg)} kg</span></div>
              )}
              {s.volumeCbm != null && (
                <div className="row-between"><span className="t-small t-secondary">{t('ship.volume')}</span><span className="t-small t-num">{s.volumeCbm} m³</span></div>
              )}
              {/* Absent sur un groupage : la boîte appartient aussi aux autres. */}
              {s.containerNo && (
                <div className="row-between"><span className="t-small t-secondary">{t('ship.container')}</span><span className="t-small t-mono">{s.containerNo}</span></div>
              )}
            </div>
          </Card>

          {v.office && (
            <Card title={t('portal.contactAgency')}>
              <div className="col gap-3">
                <div className="row-between">
                  <span className="t-small t-secondary">{v.office.name}</span>
                  <span className="t-small">{v.office.address}</span>
                </div>
                {v.office.phone && (
                  <div className="row gap-2" style={{ marginTop: 'var(--sp-2)' }}>
                    <a className="btn btn--secondary btn--sm" href={`https://wa.me/${v.office.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">
                      <Icon name="whatsapp" size={16} /> WhatsApp
                    </a>
                    <a className="btn btn--secondary btn--sm" href={`tel:${v.office.phone.replace(/\s/g, '')}`}>
                      <Icon name="phone" size={16} /> {t('action.call')}
                    </a>
                  </div>
                )}
              </div>
            </Card>
          )}

          <p className="t-caption t-tertiary" style={{ textAlign: 'center' }}>{t('portal.poweredBy')}</p>
        </div>
      </main>
    </div>
  )
}
