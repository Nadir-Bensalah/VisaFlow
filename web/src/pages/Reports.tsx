import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Card } from '@/components/ui'
import { PageHead } from '@/components/bits'
import { kpis } from '@/lib/derive'

export function Reports() {
  const { db } = useStore()
  const { t, tt, formatMoney, formatNumber } = useI18n()
  const k = kpis(db)

  // Volume des six derniers mois, calcule sur les dates d'ouverture reelles.
  const months = Array.from({ length: 6 }, (_, i) => {
    const date = new Date()
    date.setDate(1)
    date.setMonth(date.getMonth() - (5 - i))
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    return {
      key,
      label: date.toLocaleDateString(undefined, { month: 'short' }),
      count: db.cases.filter((c) => c.openedAt.slice(0, 7) === key).length,
    }
  })
  const maxMonth = Math.max(...months.map((m) => m.count), 1)

  const byCountry = db.visaTypes.map((v) => ({
    label: `${tt(v.country)} · ${tt(v.label)}`,
    count: db.cases.filter((c) => c.visaTypeId === v.id).length,
    revenue: db.cases.filter((c) => c.visaTypeId === v.id).reduce((s, c) => s + c.amountPaid, 0),
  })).sort((a, b) => b.count - a.count)

  const byAgent = db.users.map((u) => {
    const cases = db.cases.filter((c) => c.assigneeId === u.id)
    const decided = cases.filter((c) => c.status === 'accepte' || c.status === 'refuse')
    return {
      name: u.name,
      open: cases.filter((c) => c.status === 'ouvert').length,
      total: cases.length,
      rate: decided.length ? Math.round((decided.filter((c) => c.status === 'accepte').length / decided.length) * 100) : 0,
    }
  }).filter((a) => a.total > 0).sort((a, b) => b.total - a.total)

  const revenue = db.payments.filter((p) => p.state === 'regle').reduce((s, p) => s + p.amount, 0)

  return (
    <>
      <PageHead title={t('reports.title')} subtitle={t('reports.subtitle')} />

      <div className="grid grid--4" style={{ marginBottom: 'var(--sp-5)' }}>
        <Card><div className="stat" style={{ padding: 0 }}><div className="stat__label">{t('reports.acceptance')}</div><div className="stat__value">{k.acceptance}%</div></div></Card>
        <Card><div className="stat" style={{ padding: 0 }}><div className="stat__label">{t('reports.delay')}</div><div className="stat__value">{formatNumber(k.avgDays)}</div><div className="stat__hint">{t('reports.days', { n: k.avgDays })}</div></div></Card>
        <Card><div className="stat" style={{ padding: 0 }}><div className="stat__label">{t('reports.revenue')}</div><div className="stat__value">{formatMoney(revenue)}</div></div></Card>
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

        <Card title={t('reports.byCountry')} flush className="grid--2" >
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>{t('cases.visa')}</th><th className="num">{t('cases.title')}</th><th className="num">{t('reports.revenue')}</th></tr></thead>
              <tbody>
                {byCountry.map((c) => (
                  <tr key={c.label}>
                    <td className="t-small">{c.label}</td>
                    <td className="num t-small">{c.count}</td>
                    <td className="num t-small">{formatMoney(c.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  )
}
