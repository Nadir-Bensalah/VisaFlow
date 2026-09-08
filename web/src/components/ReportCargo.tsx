import { useCallback, useEffect, useState } from 'react'
import { HAS_BACKEND } from '@/lib/supabase'
import { useI18n } from '@/i18n'
import { Card, Empty, Pill } from '@/components/ui'
import { largeurPct, maxDe } from '@/lib/graphes'
import { loadCargoReport, type CargoReport } from '@/data/pilotage'

/* Le rapport fret de la section 128.
 *
 * Tous les temps affichés ici sont MESURÉS entre deux dates enregistrées. Aucun
 * n'est estimé, et celui qu'on ne peut pas mesurer s'affiche vide. Un transit
 * moyen déduit d'une règle du pouce ferait signer un contrat sur un chiffre
 * inventé, et l'agence ne saurait jamais d'où il venait. */

const MODE_LABEL: Record<string, 'pil.modeFcl'> = {
  maritime_fcl: 'pil.modeFcl',
  maritime_lcl: 'pil.modeLcl' as 'pil.modeFcl',
  aerien: 'pil.modeAir' as 'pil.modeFcl',
  routier: 'pil.modeRoad' as 'pil.modeFcl',
}

const SENS_LABEL: Record<string, 'pil.import'> = {
  import: 'pil.import',
  export: 'pil.export' as 'pil.import',
  transit: 'pil.transit' as 'pil.import',
  indetermine: 'pil.undetermined' as 'pil.import',
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <div className="stat" style={{ padding: 0 }}>
        <div className="stat__label">{label}</div>
        <div className="stat__value">{value}</div>
        {hint && <div className="stat__hint">{hint}</div>}
      </div>
    </Card>
  )
}

export function ReportCargo({ officeId, from, to }: { officeId: string | null; from: string; to: string }) {
  const { t, formatMoney, formatNumber } = useI18n()
  const [rep, setRep] = useState<CargoReport | null>(null)
  const [loading, setLoading] = useState(HAS_BACKEND)
  const [error, setError] = useState<string | null>(null)

  const charger = useCallback(async () => {
    if (!HAS_BACKEND) { setLoading(false); return }
    setLoading(true)
    try {
      setRep(await loadCargoReport(officeId, from, to))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [officeId, from, to])

  useEffect(() => { void charger() }, [charger])

  if (!HAS_BACKEND) return <Card><Empty title={t('pil.offline')} hint={t('pil.offlineHint')} /></Card>
  if (loading) return <Card><Empty title={t('pil.loading')} /></Card>
  if (error) return <Card><Empty title={t('pil.loadError', { msg: error })} /></Card>
  if (!rep) return <Card><Empty title={t('pil.empty')} /></Card>

  const jours = (n: number | null) => (n === null ? t('pil.noValue') : t('pil.days', { n }))
  const nb = (n: number | null) => (n === null ? '·' : formatNumber(Math.round(n)))

  const sens = Object.entries(rep.byDirection)
  const modes = Object.entries(rep.byMode)
  const maxSens = maxDe(sens.map(([, n]) => n))
  const maxTransporteur = maxDe(rep.byCarrier.map((c) => c.n))
  const couts = rep.costs ? Object.entries(rep.costs.byKind).sort((a, b) => b[1] - a[1]) : []

  return (
    <div className="stack">
      <div className="grid grid--4">
        <Stat label={t('pil.shipments')} value={formatNumber(rep.shipments)} />
        <Stat label={t('pil.transitDays')} value={jours(rep.transitDays)} />
        <Stat label={t('pil.customsDays')} value={jours(rep.customsDays)} />
        <Stat label={t('pil.lateNow')} value={formatNumber(rep.lateNow)}
              hint={rep.blocked > 0 ? `${rep.blocked} ${t('pil.blocked').toLowerCase()}` : undefined} />
      </div>

      <div className="grid grid--2">
        <Card title={t('pil.direction')}>
          {sens.length === 0 ? <Empty title={t('pil.empty')} /> : (
            <div className="col gap-3">
              {sens.map(([k, n]) => (
                <div key={k} className="col gap-2">
                  <div className="row-between">
                    <span className="t-small">{SENS_LABEL[k] ? t(SENS_LABEL[k]) : k}</span>
                    <span className="t-small t-num t-medium">{n}</span>
                  </div>
                  <div className="progress">
                    <div className="progress__bar" style={{ width: `${largeurPct(n, maxSens)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={t('pil.mode')}>
          {modes.length === 0 ? <Empty title={t('pil.empty')} /> : (
            <div className="col gap-3">
              {modes.map(([k, n]) => (
                <div key={k} className="row-between">
                  <span className="t-small">{MODE_LABEL[k] ? t(MODE_LABEL[k]) : k}</span>
                  <span className="t-small t-num t-medium">{n}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Les volumes. Une case vide veut dire « non renseigné dans les
            cargaisons de la période », pas « zéro tonne transportée ». */}
        <Card title={t('pil.volumeCbm')}>
          <div className="col gap-3">
            <div className="row-between">
              <span className="t-small">{t('pil.tonnage')}</span>
              <span className="t-small t-num t-medium">{nb(rep.weightKg)} kg</span>
            </div>
            <div className="row-between">
              <span className="t-small">{t('pil.volumeCbm')}</span>
              <span className="t-small t-num t-medium">{nb(rep.volumeCbm)} m³</span>
            </div>
            <div className="row-between">
              <span className="t-small">{t('pil.packages')}</span>
              <span className="t-small t-num t-medium">{nb(rep.packages)}</span>
            </div>
            <div className="row-between">
              <span className="t-small">{t('pil.containers')}</span>
              <span className="t-small t-num t-medium">{nb(rep.containers)}</span>
            </div>
          </div>
        </Card>

        <Card title={t('pil.delays')}>
          <div className="col gap-3">
            <div className="row-between">
              <span className="t-small">{t('pil.transitDays')}</span>
              <span className="t-small t-num t-medium">{jours(rep.transitDays)}</span>
            </div>
            <div className="row-between">
              <span className="t-small">{t('pil.customsDays')}</span>
              <span className="t-small t-num t-medium">{jours(rep.customsDays)}</span>
            </div>
            <div className="row-between">
              <span className="t-small">{t('pil.deliveryDays')}</span>
              <span className="t-small t-num t-medium">{jours(rep.deliveryDays)}</span>
            </div>
            <div className="row-between">
              <span className="t-small">{t('pil.lateDelivered')}</span>
              <span className="t-small t-num t-medium">{rep.lateDelivered}</span>
            </div>
          </div>
        </Card>

        {rep.byCarrier.length > 0 && (
          <Card title={t('pil.byCarrier')}>
            <div className="col gap-3">
              {rep.byCarrier.slice(0, 8).map((c) => (
                <div key={c.carrier} className="col gap-2">
                  <div className="row-between">
                    <span className="t-small t-truncate">{c.carrier}</span>
                    <span className="t-small t-num t-medium">{c.n}</span>
                  </div>
                  <div className="progress">
                    <div className="progress__bar" style={{ width: `${largeurPct(c.n, maxTransporteur)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {rep.byCountry.length > 0 && (
          <Card title={t('pil.byRoute')} flush>
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr><th>{t('pil.from')}</th><th>{t('pil.to')}</th><th className="num">{t('pil.count')}</th></tr>
                </thead>
                <tbody>
                  {rep.byCountry.slice(0, 10).map((c, i) => (
                    <tr key={i}>
                      <td className="t-small">{c.from ?? '·'}</td>
                      <td className="t-small">{c.to ?? '·'}</td>
                      <td className="num t-small t-medium">{c.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Les surestaries viennent de shipment_counters, pas d'un calcul
            refait ici : un compteur écrit deux fois donne deux résultats. */}
        <Card title={t('pil.demurrage')}>
          <div className="col gap-3">
            <div className="row-between">
              <span className="t-small">{t('pil.demurrageShipments')}</span>
              <span className="t-small t-num t-medium">{rep.demurrage.shipments}</span>
            </div>
            <div className="row-between">
              <span className="t-small">{t('pil.demurrageDays')}</span>
              <span className="t-small t-num t-medium">{nb(rep.demurrage.overdueDays)}</span>
            </div>
            <div className="row-between">
              <span className="t-small">{t('pil.demurrageAmount')}</span>
              <span className="t-small t-num t-medium">
                {rep.demurrage.amount === null
                  ? t('pil.hiddenMoney')
                  : formatMoney(rep.demurrage.amount, rep.demurrage.currency ?? undefined)}
              </span>
            </div>
            {rep.demurrage.withoutTariff > 0 && (
              <div className="row-between">
                <span className="t-small t-tertiary">{t('pil.demurrageNoTariff')}</span>
                <Pill tone="orange">{rep.demurrage.withoutTariff}</Pill>
              </div>
            )}
          </div>
        </Card>

        <Card title={t('pil.margin')} className="grid__wide">
          {rep.revenue === null ? (
            <Empty title={t('pil.hiddenMoney')} />
          ) : (
            <>
              <div className="grid grid--3" style={{ marginBottom: 'var(--sp-4)' }}>
                <Stat label={t('pil.revenue')} value={formatMoney(rep.revenue)} />
                <Stat label={t('pil.costs')}
                      value={rep.costs === null ? '·' : formatMoney(rep.costs.total)} />
                <Stat label={t('pil.margin')}
                      value={rep.margin === null ? '·' : formatMoney(rep.margin)}
                      hint={rep.marginReason ? t('pil.noMargin') : undefined} />
              </div>
              {couts.length > 0 && (
                <div className="col gap-2">
                  {couts.map(([k, v]) => (
                    <div key={k} className="row-between">
                      <span className="t-small t-secondary">{k}</span>
                      <span className="t-small t-num">{formatMoney(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
