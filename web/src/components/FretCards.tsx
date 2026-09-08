import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Card, Pill } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { clientName } from '@/lib/derive'
import {
  chargeableUnits, consolidationAdvice, lotSolidarity, routeWarning,
  shipmentCounters, shipmentRoute,
} from '@/lib/fret'
import { customsCompute } from '@/lib/douane'
import type { Shipment } from '@/data/types'

/**
 * Les écrans du fret réel. Ce que l'agence regarde tous les matins, c'est le
 * stationnement au port : c'est là que l'argent se perd, un jour à la fois, sur
 * trois factures différentes qu'on confond tout le temps.
 */

// ------------------------------------------------------------------
// Le trajet en tronçons
// ------------------------------------------------------------------

export function RouteCard({ shipment }: { shipment: Shipment }) {
  const { db } = useStore()
  const { t, formatDate } = useI18n()
  const legs = db.legs.filter((l) => l.shipmentId === shipment.id)
  const route = shipmentRoute(legs)
  const warn = routeWarning(shipment, legs)

  return (
    <Card
      title={t('fret.route')}
      action={
        route.legsCount > 0 ? (
          <span className="t-caption t-tertiary">
            {t('fret.legs', { n: route.legsCount })}
            {route.totalDays != null ? ` · ${t('fret.daysTotal', { n: route.totalDays })}` : ''}
          </span>
        ) : undefined
      }
    >
      {warn && (
        <p className="fret__warn">
          <Icon name="alert" size={14} />
          <span>{t(warn === 'aucun_troncon' ? 'fret.warnNoLeg' : 'fret.warnTransship')}</span>
        </p>
      )}

      {route.legsCount === 0 ? (
        <p className="t-small t-tertiary">{t('fret.noLeg')}</p>
      ) : (
        <ol className="fret__route">
          {route.legs.map((l) => (
            <li key={l.id} className="fret__leg">
              <span className="fret__legDot"><Icon name={l.mode === 'aerien' ? 'plane' : l.mode === 'routier' ? 'box' : 'ship'} size={13} /></span>
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
              {/* L'attente au hub : le retard le plus fréquent de toute la chaîne. */}
              {l.hubWaitDays != null && (
                <span className="fret__hub" title={t('fret.hubWaitHint')}>
                  {t('fret.hubWait')} · {t('fret.days', { n: l.hubWaitDays })}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

// ------------------------------------------------------------------
// Les trois compteurs
// ------------------------------------------------------------------

export function CountersCard({ shipment }: { shipment: Shipment }) {
  const { db } = useStore()
  const { t, formatMoney } = useI18n()
  const lines = shipmentCounters(shipment, db.tariffs)
  const started = lines.filter((l) => l.status !== 'non_demarre')
  const total = lines.reduce((sum, l) => sum + (l.amount ?? 0), 0)
  const anyOverdue = lines.some((l) => l.status === 'en_depassement')

  if (started.length === 0) {
    return (
      <Card title={t('fret.counters')}>
        <p className="t-small t-tertiary">{t('fret.countersNotStarted')}</p>
      </Card>
    )
  }

  return (
    <Card
      title={t('fret.counters')}
      action={
        total > 0 ? (
          <span className={`t-medium ${anyOverdue ? 't-red' : ''}`}>{formatMoney(total)}</span>
        ) : undefined
      }
    >
      <div className="col gap-3">
        {lines.map((l) => (
          <div key={l.kind} className={`fret__counter${l.status === 'en_depassement' ? ' is-over' : ''}`}>
            <div className="col gap-1 grow" style={{ minWidth: 0 }}>
              <span className="t-small t-medium">{t(`fret.${l.kind}` as 'fret.surestaries')}</span>
              {/* Qui facture quoi : c'est exactement ce qu'on confond. */}
              <span className="t-caption t-tertiary">
                {t(`fret.${l.kind}Hint` as 'fret.surestariesHint')}
                {l.billedBy ? ` · ${l.billedBy}` : ''}
              </span>
              {l.status === 'tarif_absent' && (
                <span className="t-caption t-orange">{t('fret.noTariffHint')}</span>
              )}
              {l.outOfPeriod && (
                <span className="t-caption t-orange">{t('fret.outOfPeriod')}</span>
              )}
            </div>

            <div className="col gap-1" style={{ textAlign: 'end', flex: 'none' }}>
              {l.status === 'non_demarre' ? (
                <span className="t-small t-tertiary">{t('fret.notStarted')}</span>
              ) : (
                <>
                  <span className="t-small">
                    {t('fret.elapsed', { n: l.elapsedDays ?? 0 })}
                    {l.running ? ` · ${t('fret.running')}` : ''}
                  </span>
                  {l.freeDays != null && (
                    <span className="t-caption t-tertiary">
                      {t('fret.freeDays', { n: l.freeDays })}
                      {l.containers && l.containers > 1 ? ` · ${t('fret.containers', { n: l.containers })}` : ''}
                    </span>
                  )}
                  {l.status === 'en_depassement' ? (
                    <span className="t-small t-medium t-red">
                      {t('fret.overdue', { n: l.overdueDays ?? 0 })} · {formatMoney(l.amount ?? 0)}
                    </span>
                  ) : l.status === 'dans_les_francs' ? (
                    <Pill tone="green">{t('fret.withinFree')}</Pill>
                  ) : (
                    <Pill tone="orange">{t('fret.noTariff')}</Pill>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------
// Les lots du groupage, et la solidarité de fait
// ------------------------------------------------------------------

export function LotsCard({ shipment }: { shipment: Shipment }) {
  const { db } = useStore()
  const { t, formatNumber } = useI18n()
  const lots = db.lots.filter((l) => l.shipmentId === shipment.id)
  if (lots.length === 0) return null

  const sol = lotSolidarity(shipment.strippedAt, lots)
  const totalCbm = lots.reduce((s, l) => s + (l.volumeCbm ?? 0), 0)
  const advice = consolidationAdvice(totalCbm)

  return (
    <Card
      title={t('fret.lots')}
      action={<span className="t-caption t-tertiary">{t('fret.lotsCount', { n: lots.length, cbm: totalCbm.toFixed(1) })}</span>}
      flush
    >
      {/* La solidarité de fait : un lot bloqué retient les quatorze autres, mais
          seulement tant que le conteneur n'est pas dépoté. */}
      <p className={`fret__solidarity${sol.active && sol.blocking.length > 0 ? ' is-on' : ''}`}>
        <Icon name={sol.active ? 'lock' : 'check'} size={14} />
        <span>
          {sol.active ? t('fret.solidarityOn') : t('fret.solidarityOff')}
          {sol.hostages > 0 ? ` · ${t('fret.hostages', { n: sol.hostages })}` : ''}
        </span>
      </p>

      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('cases.client')}</th>
              <th>{t('fret.marks')}</th>
              <th className="num">{t('ship.volume')}</th>
              <th className="num">{t('fret.chargeable')}</th>
              <th>{t('cases.stage')}</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => (
              <tr key={l.id}>
                <td className="t-small">
                  <Link to={`/clients/${l.clientId}`}>{clientName(db, l.clientId)}</Link>
                </td>
                <td className="t-caption t-mono t-tertiary">{l.marks ?? '—'}</td>
                <td className="num t-small">{formatNumber(l.volumeCbm ?? 0)} m³</td>
                {/* La règle W/M : minimum une unité payante, même pour un carton. */}
                <td className="num t-small">{chargeableUnits(l.weightKg, l.volumeCbm).toFixed(2)}</td>
                <td>
                  {l.blockedReason
                    ? <Pill tone="red">{l.blockedReason}</Pill>
                    : l.releasedAt
                      ? <Pill tone="green">{t('fret.released')}</Pill>
                      : sol.active && sol.blocking.length > 0
                        ? <Pill tone="orange">{t('fret.hostage')}</Pill>
                        : <Pill tone="gray">{t('fret.waiting')}</Pill>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {advice.advice !== 'groupage_pertinent' && (
        <p className="fret__advice">
          <Icon name="sparkle" size={14} />
          <span>
            {t(advice.advice === 'passer_en_fcl' ? 'fret.adviceFcl' : 'fret.adviceCompare')}
            {advice.containerHint ? ` · ${advice.containerHint}` : ''}
          </span>
        </p>
      )}
    </Card>
  )
}

// ------------------------------------------------------------------
// La douane : la cascade, et ce qu'elle refuse
// ------------------------------------------------------------------

export function CustomsCard({ shipment }: { shipment: Shipment }) {
  const { db } = useStore()
  const { t, formatMoney, formatDate } = useI18n()
  const decl = db.declarations.find((d) => d.shipmentId === shipment.id)
  if (!decl) return null

  const articles = db.customsArticles
    .filter((a) => a.declarationId === decl.id)
    .sort((a, b) => a.lineNo - b.lineNo)
  const r = customsCompute(decl, articles)

  return (
    <Card
      title={t('fret.customs')}
      action={<span className="t-caption t-tertiary">{decl.number} · {t('fret.articles', { n: r.articles })}</span>}
    >
      <div className="col gap-4">
        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          {decl.circuit && (
            <Pill tone={decl.circuit === 'vert' ? 'green' : decl.circuit === 'orange' ? 'orange' : 'red'}>
              {t(`fret.circuit_${decl.circuit}` as 'fret.circuit_vert')}
            </Pill>
          )}
          {/* La lettre M : le non-assujetti paie la TVA sur une base majorée d'un quart. */}
          {!decl.vatRegistered && <Pill tone="orange">{t('fret.nonAssujetti')}</Pill>}
          {decl.airApplicable && <Pill tone="blue">{t('fret.airCode')}</Pill>}
        </div>

        <div className="col gap-2">
          <Line label={t('fret.broker')} value={decl.brokerName} />
          {/* Article 33 : le taux du jour d'ENREGISTREMENT, pas celui de la facture. */}
          <Line label={t('fret.fxRate')} value={`${decl.fxRate} ${decl.currency}/TND · ${formatDate(decl.registeredOn)}`} />
        </div>

        <hr className="divider" style={{ margin: 0 }} />

        <div className="col gap-2">
          <Line label={t('fret.vdCaf')} value={formatMoney(r.vdCafTotal)} />
          <Line label={t('fret.dutiesSum')} value={formatMoney(r.dutiesSum)} />
          <Line
            label={t('fret.rpd')}
            value={
              <>
                {formatMoney(r.rpd)}
                {/* Le plancher de 10 DT est PAR ARTICLE, et il mord souvent. */}
                {r.rpdAtFloor && <span className="t-caption t-tertiary"> · {t('fret.atFloor')}</span>}
              </>
            }
          />
          {r.air > 0 && <Line label={t('fret.air')} value={formatMoney(r.air)} />}
          <div className="row-between" style={{ paddingTop: 4 }}>
            <span className="t-small t-medium">{t('fret.totalPayable')}</span>
            <span className="t-medium" style={{ fontSize: 18 }}>{formatMoney(r.totalPayable)}</span>
          </div>
        </div>

        {r.alerts.length > 0 && (
          <div className="col gap-2">
            {r.alerts.map((a, i) => (
              <p key={i} className="fret__warn">
                <Icon name="alert" size={14} />
                <span>
                  {a.code === 'deduction_non_facturee_distinctement'
                    ? t('fret.alertDeduction', { n: a.line, amount: formatMoney(a.refused) })
                    : a.code === 'taux_manquant'
                      ? t('fret.alertRates', { n: a.line })
                      : a.code === 'autorisation_importation_requise'
                        ? t('fret.alertCcec', { n: a.line })
                        : t('fret.alertPref', { n: a.line, origin: a.origin })}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function Line({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="row-between">
      <span className="t-small t-secondary">{label}</span>
      <span className="t-small" style={{ textAlign: 'end' }}>{value ?? '—'}</span>
    </div>
  )
}
