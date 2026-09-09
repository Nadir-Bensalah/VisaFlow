import { HAS_BACKEND } from '@/lib/supabase'
import { useI18n } from '@/i18n'
import { Empty, Pill } from '@/components/ui'
import { Erreur, Kpi, KpiGrid, Ligne, Section, Squelette, Table, Vide, useChargement } from '@/components/page'
import { largeurPct, maxDe } from '@/lib/graphes'
import { loadCargoReport, type CargoReport } from '@/data/pilotage'
import '@/styles/modules.css'

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

export function ReportCargo({ officeId, from, to }: { officeId: string | null; from: string; to: string }) {
  const { t, formatMoney, formatNumber } = useI18n()
  const { data: rep, loading, error, reload } = useChargement(
    () => (HAS_BACKEND ? loadCargoReport(officeId, from, to) : Promise.resolve(null as CargoReport | null)),
    [officeId, from, to],
  )

  if (!HAS_BACKEND) return <Section><Empty title={t('mq.demoTitle')} hint={t('mq.demoHint')} scene="cargo" /></Section>
  if (error) return <Erreur message={error} retryLabel={t('mq.retry')} onRetry={() => void reload()} />
  if (loading && !rep) return <><Squelette type="kpis" n={4} /><Squelette type="cartes" n={4} /></>
  if (!rep) return <Section><Vide title={t('pil.empty')} icon="ship" /></Section>

  const jours = (n: number | null) => (n === null ? t('pil.noValue') : t('pil.days', { n }))
  const nb = (n: number | null) => (n === null ? '·' : formatNumber(Math.round(n)))

  const sens = Object.entries(rep.byDirection)
  const modes = Object.entries(rep.byMode)
  const maxSens = maxDe(sens.map(([, n]) => n))
  const maxTransporteur = maxDe(rep.byCarrier.map((c) => c.n))
  const couts = rep.costs ? Object.entries(rep.costs.byKind).sort((a, b) => b[1] - a[1]) : []

  return (
    <div className="stack">
      <KpiGrid>
        <Kpi label={t('pil.shipments')} value={formatNumber(rep.shipments)} icon="ship" tone="blue" />
        <Kpi label={t('pil.transitDays')} value={jours(rep.transitDays)} icon="plane" />
        <Kpi label={t('pil.customsDays')} value={jours(rep.customsDays)} icon="shield" />
        <Kpi label={t('pil.lateNow')} value={formatNumber(rep.lateNow)} icon="alert"
             tone={rep.lateNow > 0 ? 'red' : undefined}
             hint={rep.blocked > 0 ? `${rep.blocked} ${t('pil.blocked').toLowerCase()}` : undefined} />
      </KpiGrid>

      <div className="grid grid--2">
        <Section title={t('pil.direction')}>
          {sens.length === 0 ? <Vide title={t('pil.empty')} icon="arrow" /> : (
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
        </Section>

        <Section title={t('pil.mode')}>
          {modes.length === 0 ? <Vide title={t('pil.empty')} icon="box" /> : (
            <>{modes.map(([k, n]) => <Ligne key={k} label={MODE_LABEL[k] ? t(MODE_LABEL[k]) : k}>{n}</Ligne>)}</>
          )}
        </Section>

        {/* Les volumes. Une case vide veut dire « non renseigné dans les
            cargaisons de la période », pas « zéro tonne transportée ». */}
        <Section title={t('pil.volumeCbm')}>
          <Ligne label={t('pil.tonnage')}>{nb(rep.weightKg)} kg</Ligne>
          <Ligne label={t('pil.volumeCbm')}>{nb(rep.volumeCbm)} m³</Ligne>
          <Ligne label={t('pil.packages')}>{nb(rep.packages)}</Ligne>
          <Ligne label={t('pil.containers')}>{nb(rep.containers)}</Ligne>
        </Section>

        <Section title={t('pil.delays')}>
          <Ligne label={t('pil.transitDays')}>{jours(rep.transitDays)}</Ligne>
          <Ligne label={t('pil.customsDays')}>{jours(rep.customsDays)}</Ligne>
          <Ligne label={t('pil.deliveryDays')}>{jours(rep.deliveryDays)}</Ligne>
          <Ligne label={t('pil.lateDelivered')}>{rep.lateDelivered}</Ligne>
        </Section>

        {rep.byCarrier.length > 0 && (
          <Section title={t('pil.byCarrier')}>
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
          </Section>
        )}

        {rep.byCountry.length > 0 && (
          <Section title={t('pil.byRoute')} flush>
            <Table>
              <thead>
                <tr><th>{t('pil.from')}</th><th>{t('pil.to')}</th><th className="num">{t('pil.count')}</th></tr>
              </thead>
              <tbody>
                {rep.byCountry.slice(0, 10).map((c, i) => (
                  <tr key={i}>
                    <td>{c.from ?? '·'}</td>
                    <td>{c.to ?? '·'}</td>
                    <td className="num t-medium">{c.n}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>
        )}

        {/* Les surestaries viennent de shipment_counters, pas d'un calcul
            refait ici : un compteur écrit deux fois donne deux résultats. */}
        <Section title={t('pil.demurrage')}>
          <Ligne label={t('pil.demurrageShipments')}>{rep.demurrage.shipments}</Ligne>
          <Ligne label={t('pil.demurrageDays')}>{nb(rep.demurrage.overdueDays)}</Ligne>
          <Ligne label={t('pil.demurrageAmount')}>
            {rep.demurrage.amount === null
              ? t('pil.hiddenMoney')
              : formatMoney(rep.demurrage.amount, rep.demurrage.currency ?? undefined)}
          </Ligne>
          {rep.demurrage.withoutTariff > 0 && (
            <Ligne label={t('pil.demurrageNoTariff')}><Pill tone="orange">{rep.demurrage.withoutTariff}</Pill></Ligne>
          )}
        </Section>

        <Section title={t('pil.margin')} className="grid__wide">
          {rep.revenue === null ? (
            <Vide title={t('pil.hiddenMoney')} icon="lock" />
          ) : (
            <>
              <KpiGrid>
                <Kpi label={t('pil.revenue')} value={formatMoney(rep.revenue)} icon="payments" tone="green" />
                <Kpi label={t('pil.costs')} value={rep.costs === null ? '·' : formatMoney(rep.costs.total)} icon="download" />
                <Kpi label={t('pil.margin')} value={rep.margin === null ? '·' : formatMoney(rep.margin)} icon="reports"
                     tone={rep.margin !== null && rep.margin < 0 ? 'red' : undefined}
                     hint={rep.marginReason ? t('pil.noMargin') : undefined} />
              </KpiGrid>
              {couts.length > 0 && (
                <>{couts.map(([k, v]) => <Ligne key={k} label={k}>{formatMoney(v)}</Ligne>)}</>
              )}
            </>
          )}
        </Section>
      </div>
    </div>
  )
}
