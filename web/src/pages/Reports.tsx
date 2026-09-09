import { useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Pill, Segmented } from '@/components/ui'
import { ExportButton } from '@/components/ExportButton'
import { Barres, Kpi, KpiGrid, PageHeader, Section, Table, Vide } from '@/components/page'
import { kpis, refusalReasons, refusalStats } from '@/lib/derive'
import '@/styles/modules.css'

/* Les rapports de l'agence, calculés sur les données déjà chargées.
 *
 * Tout ce qui est ici se lit dans le magasin local : aucun aller-retour, aucun
 * chiffre inventé. Le taux de refus est une propriété du poste, pas du pays :
 * 15,4 % chez la France et 46,3 % chez la Tchéquie sur le même terrain la
 * même année. Une moyenne nationale affichée ici mentirait à l'agence. Ce
 * tableau est la seule statistique qu'elle ne trouvera nulle part ailleurs. */

type Axe = 'consulate' | 'visaType' | 'status'

export function Reports() {
  const { db } = useStore()
  const v = useVisible()
  const { t, tt, formatMoney, formatNumber } = useI18n()
  const k = kpis(db, v)
  const [axis, setAxis] = useState<Axe>('consulate')

  // Volume des six derniers mois, calculé sur les dates d'ouverture réelles.
  const months = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const date = new Date()
    date.setDate(1)
    date.setMonth(date.getMonth() - (5 - i))
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    return {
      key,
      label: date.toLocaleDateString(undefined, { month: 'short' }),
      count: v.cases.filter((c) => c.openedAt.slice(0, 7) === key).length,
    }
  }), [v.cases])

  const byCountry = useMemo(() => db.visaTypes.map((type) => ({
    label: `${tt(type.country)} · ${tt(type.label)}`,
    count: v.cases.filter((c) => c.visaTypeId === type.id).length,
    revenue: v.cases.filter((c) => c.visaTypeId === type.id).reduce((sum, c) => sum + c.amountPaid, 0),
  })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count), [db.visaTypes, v.cases, tt])

  const byAgent = useMemo(() => db.users.map((u) => {
    const cases = v.cases.filter((c) => c.assigneeId === u.id)
    const decided = cases.filter((c) => c.status === 'accepte' || c.status === 'refuse')
    return {
      name: u.name,
      open: cases.filter((c) => c.status === 'ouvert').length,
      total: cases.length,
      rate: decided.length ? Math.round((decided.filter((c) => c.status === 'accepte').length / decided.length) * 100) : null,
    }
  }).filter((a) => a.total > 0).sort((a, b) => b.total - a.total), [db.users, v.cases])

  const revenue = v.payments.filter((p) => p.state === 'regle').reduce((sum, p) => sum + p.amount, 0)
  const canMoney = v.can('finance:global')

  const rows = refusalStats(v.cases, axis, db.clients)
  const reasons = refusalReasons(v.cases)

  const rowLabel = (row: (typeof rows)[number]): string => {
    if (row.consulateId) {
      const c = db.consulates.find((x) => x.id === row.consulateId)
      return c ? `${tt(c.country)} · ${c.city}` : row.key
    }
    if (row.visaTypeId) {
      const x = db.visaTypes.find((y) => y.id === row.visaTypeId)
      return x ? `${tt(x.country)} · ${tt(x.label)}` : row.key
    }
    return t(`pro.${row.key}` as 'pro.salarie')
  }

  type Ligne = (typeof rows)[number]
  const officiel = (row: Ligne) => (row.consulateId ? db.consulates.find((c) => c.id === row.consulateId)?.refRefusalRate : undefined)
  const colonnesExport = [
    { key: 'label', label: t('refstats.subtitle'), value: (r: Ligne) => rowLabel(r) },
    { key: 'decided', label: t('refstats.decided'), value: (r: Ligne) => r.decided },
    { key: 'refused', label: t('refstats.refused'), value: (r: Ligne) => r.refused },
    { key: 'rate', label: t('refstats.rate'), value: (r: Ligne) => r.rate },
    { key: 'official', label: t('refstats.official'), value: (r: Ligne) => officiel(r) },
  ]

  return (
    <>
      <PageHeader
        kicker={t('mq.kickerPilotage')}
        title={t('reports.title')}
        subtitle={t('mq.reportsSub')}
        actions={<ExportButton rows={rows} columns={colonnesExport} base="refus" scope="rapports" disabled={rows.length === 0} />}
      />

      <KpiGrid>
        <Kpi label={t('reports.acceptance')} value={`${k.acceptance} %`} icon="check" tone="green" hint={t('mq.reportsAcceptanceHint')} />
        <Kpi label={t('reports.delay')} value={t('reports.days', { n: k.avgDays })} icon="clock" hint={t('stats.measured')} />
        {canMoney && <Kpi label={t('reports.revenue')} value={formatMoney(revenue)} icon="payments" hint={t('mq.reportsRevenueHint')} />}
        <Kpi label={t('dash.open')} value={formatNumber(k.open)} icon="cases" tone="blue"
             spark={months.map((m) => m.count)} hint={t('mq.reportsOpenHint', { n: months[months.length - 1]?.count ?? 0 })} />
      </KpiGrid>

      <div className="grid grid--2">
        <Section title={t('reports.volume')}>
          {months.every((m) => m.count === 0)
            ? <Vide title={t('refstats.none')} icon="reports" />
            : <Barres points={months.map((m) => m.count)} labels={months.map((m) => m.label)} format={formatNumber} />}
        </Section>

        <Section title={t('reports.byAgent')} flush>
          {byAgent.length === 0 ? <Vide title={t('refstats.none')} icon="clients" /> : (
            <Table>
              <thead><tr><th>{t('misc.agent')}</th><th className="num col-optional">{t('dash.open')}</th><th className="num">{t('cases.title')}</th><th className="num">{t('reports.acceptance')}</th></tr></thead>
              <tbody>
                {byAgent.map((a) => (
                  <tr key={a.name}>
                    <td className="t-medium">{a.name}</td>
                    <td className="num col-optional">{a.open}</td>
                    <td className="num">{a.total}</td>
                    <td className="num">{a.rate === null ? <span className="t-tertiary">·</span> : `${a.rate} %`}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>

        <Section title={t('reports.byCountry')} flush className="grid__wide">
          {byCountry.length === 0 ? <Vide title={t('refstats.none')} icon="passport" /> : (
            <Table>
              <thead><tr><th>{t('cases.visa')}</th><th className="num">{t('cases.title')}</th>{canMoney && <th className="num col-optional">{t('reports.revenue')}</th>}</tr></thead>
              <tbody>
                {byCountry.map((c) => (
                  <tr key={c.label}>
                    <td>{c.label}</td>
                    <td className="num">{c.count}</td>
                    {canMoney && <td className="num col-optional">{formatMoney(c.revenue)}</td>}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>

        <Section
          title={t('refstats.title')}
          action={
            <Segmented<Axe>
              value={axis}
              onChange={setAxis}
              label={t('refstats.title')}
              options={[
                { value: 'consulate', label: t('refstats.byConsulate') },
                { value: 'visaType', label: t('refstats.byVisa') },
                { value: 'status', label: t('refstats.byStatus') },
              ]}
            />
          }
          flush
          className="grid__wide"
        >
          {rows.length === 0 ? (
            <Vide title={t('refstats.none')} hint={t('mq.reportsRefusalNoneHint')} icon="reports" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t('refstats.subtitle')}</th>
                  <th className="num">{t('refstats.decided')}</th>
                  <th className="num col-optional">{t('refstats.refused')}</th>
                  <th className="num">{t('refstats.rate')}</th>
                  {axis === 'consulate' && <th className="num col-optional">{t('refstats.official')}</th>}
                  {axis === 'consulate' && <th className="num">{t('refstats.gap')}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const official = officiel(row)
                  // L'écart est le vrai signal : faire mieux que le poste,
                  // c'est ce que l'agence vend.
                  const gap = official !== undefined ? Math.round((row.rate - official) * 10) / 10 : undefined
                  return (
                    <tr key={row.key}>
                      <td className="t-medium">{rowLabel(row)}</td>
                      <td className="num">{row.decided}</td>
                      <td className="num col-optional">{row.refused}</td>
                      <td className="num t-medium">{row.rate} %</td>
                      {axis === 'consulate' && (
                        <td className="num col-optional t-tertiary">
                          {official !== undefined ? `${official} %` : '·'}
                        </td>
                      )}
                      {axis === 'consulate' && (
                        <td className="num">
                          {gap === undefined ? <span className="t-tertiary">·</span> : (
                            <Pill tone={gap <= 0 ? 'green' : 'red'}>{gap > 0 ? `+${gap}` : gap}</Pill>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
          {axis === 'consulate' && rows.length > 0 && (
            <p className="t-caption t-tertiary md-note">{t('refstats.hint')}</p>
          )}
        </Section>

        {reasons.length > 0 && (
          <Section title={t('refstats.reasons')} className="grid__wide">
            <div className="col gap-3">
              {reasons.map((r) => (
                <div key={r.code} className="col gap-2">
                  <div className="row-between">
                    <span className="t-small">{t(`refusal.${r.code}` as 'refusal.autre')}</span>
                    <span className="t-small t-num t-medium">{r.n} · {r.pct} %</span>
                  </div>
                  <div className="progress">
                    <div className="progress__bar" style={{ width: `${Math.max(r.pct, 2)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </>
  )
}
