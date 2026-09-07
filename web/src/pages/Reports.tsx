import { useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Card, Empty, Pill, Segmented } from '@/components/ui'
import { PageHead } from '@/components/bits'
import { kpis, refusalReasons, refusalStats } from '@/lib/derive'

export function Reports() {
  const { db } = useStore()
  const v = useVisible()
  const { t, tt, formatMoney, formatNumber } = useI18n()
  const k = kpis(db, v)
  const [axis, setAxis] = useState<'consulate' | 'visaType' | 'status'>('consulate')

  // Volume des six derniers mois, calcule sur les dates d'ouverture reelles.
  const months = Array.from({ length: 6 }, (_, i) => {
    const date = new Date()
    date.setDate(1)
    date.setMonth(date.getMonth() - (5 - i))
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    return {
      key,
      label: date.toLocaleDateString(undefined, { month: 'short' }),
      count: v.cases.filter((c) => c.openedAt.slice(0, 7) === key).length,
    }
  })
  const maxMonth = Math.max(...months.map((m) => m.count), 1)

  const byCountry = db.visaTypes.map((type) => ({
    label: `${tt(type.country)} · ${tt(type.label)}`,
    count: v.cases.filter((c) => c.visaTypeId === type.id).length,
    revenue: v.cases.filter((c) => c.visaTypeId === type.id).reduce((sum, c) => sum + c.amountPaid, 0),
  })).sort((a, b) => b.count - a.count)

  const byAgent = db.users.map((u) => {
    const cases = v.cases.filter((c) => c.assigneeId === u.id)
    const decided = cases.filter((c) => c.status === 'accepte' || c.status === 'refuse')
    return {
      name: u.name,
      open: cases.filter((c) => c.status === 'ouvert').length,
      total: cases.length,
      rate: decided.length ? Math.round((decided.filter((c) => c.status === 'accepte').length / decided.length) * 100) : 0,
    }
  }).filter((a) => a.total > 0).sort((a, b) => b.total - a.total)

  const revenue = v.payments.filter((p) => p.state === 'regle').reduce((sum, p) => sum + p.amount, 0)

  /* Le taux de refus est une propriété du poste, pas du pays : 15,4 % chez la
     France et 46,3 % chez la Tchéquie sur le même terrain la même année. Une
     moyenne nationale affichée ici mentirait à l'agence. Ce tableau est la
     seule statistique qu'elle ne trouvera nulle part ailleurs. */
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

  return (
    <>
      <PageHead title={t('reports.title')} subtitle={t('reports.subtitle')} />

      <div className="grid grid--4" style={{ marginBottom: 'var(--sp-5)' }}>
        <Card><div className="stat" style={{ padding: 0 }}><div className="stat__label">{t('reports.acceptance')}</div><div className="stat__value">{k.acceptance}%</div></div></Card>
        <Card><div className="stat" style={{ padding: 0 }}><div className="stat__label">{t('reports.delay')}</div><div className="stat__value">{formatNumber(k.avgDays)}</div><div className="stat__hint">{t('reports.days', { n: k.avgDays })}</div></div></Card>
        {v.can('finance:global') && (
          <Card><div className="stat" style={{ padding: 0 }}><div className="stat__label">{t('reports.revenue')}</div><div className="stat__value">{formatMoney(revenue)}</div></div></Card>
        )}
        <Card><div className="stat" style={{ padding: 0 }}><div className="stat__label">{t('dash.open')}</div><div className="stat__value">{formatNumber(k.open)}</div></div></Card>
      </div>

      <div className="grid grid--2">
        <Card title={t('reports.volume')}>
          <div className="bar">
            {months.map((m) => (
              <div key={m.key} className="col grow gap-2" style={{ alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <span className="t-caption t-tertiary t-num">{m.count}</span>
                <div className="bar__col" style={{ height: `${(m.count / maxMonth) * 100}%`, width: '100%' }} />
                <span className="t-caption t-tertiary">{m.label}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title={t('reports.byAgent')} flush>
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>{t('misc.agent')}</th><th className="num">{t('dash.open')}</th><th className="num">{t('cases.title')}</th><th className="num">{t('reports.acceptance')}</th></tr></thead>
              <tbody>
                {byAgent.map((a) => (
                  <tr key={a.name}>
                    <td className="t-small t-medium">{a.name}</td>
                    <td className="num t-small">{a.open}</td>
                    <td className="num t-small">{a.total}</td>
                    <td className="num t-small">{a.rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={t('reports.byCountry')} flush className="grid__wide">
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>{t('cases.visa')}</th><th className="num">{t('cases.title')}</th>{v.can('finance:global') && <th className="num">{t('reports.revenue')}</th>}</tr></thead>
              <tbody>
                {byCountry.map((c) => (
                  <tr key={c.label}>
                    <td className="t-small">{c.label}</td>
                    <td className="num t-small">{c.count}</td>
                    {v.can('finance:global') && <td className="num t-small">{formatMoney(c.revenue)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title={t('refstats.title')}
          action={
            <Segmented
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
            <div style={{ padding: 'var(--sp-5)' }}><Empty title={t('refstats.none')} /></div>
          ) : (
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('refstats.subtitle')}</th>
                    <th className="num">{t('refstats.decided')}</th>
                    <th className="num">{t('refstats.refused')}</th>
                    <th className="num">{t('refstats.rate')}</th>
                    {axis === 'consulate' && <th className="num">{t('refstats.official')}</th>}
                    {axis === 'consulate' && <th className="num">{t('refstats.gap')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const consulate = row.consulateId ? db.consulates.find((c) => c.id === row.consulateId) : undefined
                    const official = consulate?.refRefusalRate
                    // L'écart est le vrai signal : faire mieux que le poste,
                    // c'est ce que l'agence vend.
                    const gap = official !== undefined ? Math.round((row.rate - official) * 10) / 10 : undefined
                    return (
                      <tr key={row.key}>
                        <td className="t-small t-medium">{rowLabel(row)}</td>
                        <td className="num t-small">{row.decided}</td>
                        <td className="num t-small">{row.refused}</td>
                        <td className="num t-small t-medium">{row.rate}%</td>
                        {axis === 'consulate' && (
                          <td className="num t-small t-tertiary">
                            {official !== undefined ? `${official}%` : '—'}
                          </td>
                        )}
                        {axis === 'consulate' && (
                          <td className="num t-small">
                            {gap === undefined ? '—' : (
                              <Pill tone={gap <= 0 ? 'green' : 'red'}>{gap > 0 ? `+${gap}` : gap}</Pill>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {axis === 'consulate' && rows.length > 0 && (
            <p className="t-caption t-tertiary" style={{ padding: 'var(--sp-4) var(--sp-5)' }}>{t('refstats.hint')}</p>
          )}
        </Card>

        {reasons.length > 0 && (
          <Card title={t('refstats.reasons')} className="grid__wide">
            <div className="col gap-3">
              {reasons.map((r) => (
                <div key={r.code} className="col gap-2">
                  <div className="row-between">
                    <span className="t-small">{t(`refusal.${r.code}` as 'refusal.autre')}</span>
                    <span className="t-small t-num t-medium">{r.n} · {r.pct}%</span>
                  </div>
                  <div className="progress">
                    <div className="progress__bar" style={{ width: `${Math.max(r.pct, 2)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  )
}
