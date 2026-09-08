import { useEffect, useState } from 'react'
import { supabase, HAS_BACKEND } from '@/lib/supabase'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Card, Empty, Pill } from '@/components/ui'
import { PageHead } from '@/components/bits'
import { refusalStats } from '@/lib/derive'

/* Les statistiques que l'agence ne trouve nulle part ailleurs. En mode réel,
   elles viennent d'agency_stats, calculée sur toute la donnée côté serveur ;
   en démonstration, on les calcule sur le jeu local. */

interface Stats {
  open_cases: number; decided_total: number; acceptance: number; clients: number
  returning: number; avg_days: number; attempt_success: number; request_conversion: number
  biometrics_valid: number; shipments_open: number; shipments_blocked: number
  refusal_by_consulate: { consulate: string; city: string; decided: number; refused: number; rate: number; official: number | null }[]
  refusal_reasons: { code: string; n: number }[]
  wait_by_consulate: { consulate: string; city: string; real_days: number; announced: number | null; waiting: number }[]
  top_missing: { label: string; n: number }[]
  upcoming: { month: string; n: number }[]
  by_agent: { name: string; open: number; decided: number; acceptance: number }[]
  money: { collected_month: number; outstanding: number; by_month: { month: string; amount: number }[]; by_visa: { label: string; amount: number }[] } | null
}

export function Stats() {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatMoney } = useI18n()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(HAS_BACKEND)

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    supabase.rpc('agency_stats').then(({ data }) => { setStats(data as Stats); setLoading(false) })
  }, [])

  // Repli démonstration : on calcule l'essentiel depuis le jeu local.
  const local: Partial<Stats> = {
    open_cases: v.cases.filter((c) => c.status === 'ouvert').length,
    acceptance: (() => {
      const d = v.cases.filter((c) => c.status === 'accepte' || c.status === 'refuse')
      return d.length ? Math.round((d.filter((c) => c.status === 'accepte').length / d.length) * 100) : 0
    })(),
    clients: v.clients.length,
    refusal_by_consulate: refusalStats(v.cases, 'consulate', db.clients).map((r) => {
      const co = db.consulates.find((x) => x.id === r.consulateId)
      return { consulate: co ? (co.country.fr) : r.key, city: co?.city ?? '', decided: r.decided, refused: r.refused, rate: r.rate, official: co?.refRefusalRate ?? null }
    }),
  }
  const s = (stats ?? local) as Stats
  const money = s.money

  if (loading) return <><PageHead title={t('stats.title')} subtitle={t('stats.subtitle')} /><Card><Empty title="…" /></Card></>

  const maxUp = Math.max(...(s.upcoming ?? []).map((u) => u.n), 1)

  return (
    <>
      <PageHead title={t('stats.title')} subtitle={t('stats.subtitle')} />

      <div className="grid grid--4" style={{ marginBottom: 'var(--sp-5)' }}>
        <Stat label={t('stats.acceptance')} value={`${s.acceptance ?? 0}%`} />
        <Stat label={t('stats.avgDays')} value={`${s.avg_days ?? 0} j`} hint={t('stats.measured')} />
        <Stat label={t('stats.returning')} value={s.returning ?? 0} hint={t('stats.loyalty')} />
        <Stat label={t('stats.biometrics')} value={s.biometrics_valid ?? 0} hint={t('stats.biometricsHint')} />
      </div>

      <div className="grid grid--2">
        {/* LA statistique : le refus par consulat, contre la référence officielle */}
        <Card title={t('stats.refusalByConsulate')} className="grid__wide" flush>
          {(!s.refusal_by_consulate || s.refusal_by_consulate.length === 0) ? (
            <div style={{ padding: 'var(--sp-5)' }}><Empty title={t('stats.notEnough')} /></div>
          ) : (
            <div className="tablewrap">
              <table className="table">
                <thead><tr>
                  <th>{t('slots.consulate')}</th><th className="num">{t('refstats.decided')}</th>
                  <th className="num">{t('refstats.refused')}</th><th className="num">{t('refstats.rate')}</th>
                  <th className="num">{t('refstats.official')}</th><th className="num">{t('refstats.gap')}</th>
                </tr></thead>
                <tbody>
                  {s.refusal_by_consulate.map((r, i) => {
                    const gap = r.official != null ? Math.round((r.rate - r.official) * 10) / 10 : null
                    return (
                      <tr key={i}>
                        <td className="t-small t-medium">{r.consulate} · {r.city}</td>
                        <td className="num t-small">{r.decided}</td>
                        <td className="num t-small">{r.refused}</td>
                        <td className="num t-small t-medium">{r.rate ?? 0}%</td>
                        <td className="num t-small t-tertiary">{r.official != null ? `${r.official}%` : '—'}</td>
                        <td className="num t-small">{gap == null ? '—' : <Pill tone={gap <= 0 ? 'green' : 'red'}>{gap > 0 ? `+${gap}` : gap}</Pill>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="t-caption t-tertiary" style={{ padding: 'var(--sp-3) var(--sp-5)' }}>{t('refstats.hint')}</p>
        </Card>

        {/* Le créneau : délai réel mesuré */}
        {s.wait_by_consulate && s.wait_by_consulate.length > 0 && (
          <Card title={t('stats.waitByConsulate')} flush>
            <div className="list">
              {s.wait_by_consulate.map((w, i) => (
                <div key={i} className="list__row">
                  <span className="col grow"><span className="t-small t-medium">{w.consulate} · {w.city}</span>
                    <span className="t-caption t-tertiary">{t('stats.waitingNow', { n: w.waiting })}</span></span>
                  <span className="col" style={{ textAlign: 'end' }}>
                    <span className="t-medium t-num">{w.real_days} j</span>
                    <span className="t-caption t-tertiary">{w.announced != null ? t('stats.vsAnnounced', { n: w.announced }) : ''}</span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* La conversion des demandes, le succès des tentatives */}
        <Card title={t('stats.funnel')}>
          <div className="col gap-4">
            <Line label={t('stats.requestConversion')} value={`${s.request_conversion ?? 0}%`} />
            <Line label={t('stats.attemptSuccess')} value={`${s.attempt_success ?? 0}%`} hint={t('stats.last30')} />
            <Line label={t('dash.open')} value={s.open_cases ?? 0} />
          </div>
        </Card>

        {/* La pièce la plus souvent manquante : nourrit la checklist */}
        {s.top_missing && s.top_missing.length > 0 && (
          <Card title={t('stats.topMissing')}>
            <div className="col gap-3">
              {s.top_missing.map((m, i) => (
                <div key={i} className="row-between"><span className="t-small">{m.label}</span><span className="t-num t-medium">{m.n}</span></div>
              ))}
            </div>
          </Card>
        )}

        {/* La charge à venir : la saisonnalité */}
        {s.upcoming && s.upcoming.length > 0 && (
          <Card title={t('stats.upcoming')} className="grid__wide">
            <div className="bar">
              {s.upcoming.map((u) => (
                <div key={u.month} className="col grow gap-2" style={{ alignItems: 'center', justifyContent: 'flex-end', height: 120 }}>
                  <span className="t-caption t-tertiary t-num">{u.n}</span>
                  <div className="bar__col" style={{ height: `${(u.n / maxUp) * 100}%`, width: '100%' }} />
                  <span className="t-caption t-tertiary">{u.month.slice(5)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Par agent */}
        {s.by_agent && s.by_agent.length > 0 && (
          <Card title={t('reports.byAgent')} flush>
            <div className="tablewrap"><table className="table">
              <thead><tr><th>{t('misc.agent')}</th><th className="num">{t('dash.open')}</th><th className="num">{t('refstats.decided')}</th><th className="num">{t('reports.acceptance')}</th></tr></thead>
              <tbody>{s.by_agent.map((ag, i) => (
                <tr key={i}><td className="t-small t-medium">{ag.name}</td><td className="num t-small">{ag.open}</td><td className="num t-small">{ag.decided}</td><td className="num t-small">{ag.acceptance}%</td></tr>
              ))}</tbody>
            </table></div>
          </Card>
        )}

        {/* L'argent, direction seulement */}
        {money && (
          <Card title={t('stats.money')} className="grid__wide">
            <div className="grid grid--3" style={{ marginBottom: 'var(--sp-4)' }}>
              <Stat label={t('reports.revenue')} value={formatMoney(money.collected_month)} />
              <Stat label={t('stats.outstanding')} value={formatMoney(money.outstanding)} />
              <Stat label={t('stats.shipments')} value={`${s.shipments_open ?? 0}${s.shipments_blocked ? ` · ${s.shipments_blocked} ⚠` : ''}`} />
            </div>
            {money.by_visa && money.by_visa.length > 0 && (
              <div className="col gap-2">
                <span className="t-caption t-tertiary">{t('stats.byVisa')}</span>
                {money.by_visa.slice(0, 6).map((r, i) => (
                  <div key={i} className="row-between"><span className="t-small">{r.label}</span><span className="t-num t-medium">{formatMoney(r.amount)}</span></div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  )
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card><div className="stat" style={{ padding: 0 }}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {hint && <div className="stat__hint">{hint}</div>}
    </div></Card>
  )
}
function Line({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="row-between">
      <span className="col"><span className="t-small">{label}</span>{hint && <span className="t-caption t-tertiary">{hint}</span>}</span>
      <span className="t-num t-medium" style={{ fontSize: 'var(--size-h4)' }}>{value}</span>
    </div>
  )
}
