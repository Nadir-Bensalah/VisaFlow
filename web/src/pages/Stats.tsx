import { useMemo } from 'react'
import { supabase, HAS_BACKEND } from '@/lib/supabase'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Pill } from '@/components/ui'
import { Barres, Erreur, Kpi, KpiGrid, Ligne, PageHeader, Section, Squelette, Table, Vide, useChargement } from '@/components/page'
import { refusalStats } from '@/lib/derive'
import '@/styles/modules.css'

/* Les statistiques que l'agence ne trouve nulle part ailleurs. En mode réel,
   elles viennent d'agency_stats, calculée sur toute la donnée côté serveur ;
   en démonstration, on calcule l'essentiel sur le jeu local, et on le dit. */

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

async function chargerStats(): Promise<Stats | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('agency_stats')
  if (error) throw new Error(error.message)
  return data as Stats
}

export function Stats() {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatMoney, formatNumber } = useI18n()

  const { data, loading, refreshing, error, reload } = useChargement(chargerStats)

  // Repli démonstration : on calcule l'essentiel depuis le jeu local.
  const local = useMemo<Partial<Stats>>(() => ({
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
  }), [v.cases, v.clients, db.clients, db.consulates])

  const s = (data ?? local) as Stats
  const money = s.money

  const head = (
    <PageHeader
      kicker={t('mq.kickerPilotage')}
      title={t('stats.title')}
      subtitle={HAS_BACKEND ? t('mq.statsSub') : t('mq.statsSubDemo')}
      refreshing={refreshing && !loading}
      refreshingLabel={t('mq.refreshing')}
      actions={HAS_BACKEND ? <Button icon="refresh" onClick={() => void reload()} disabled={refreshing}>{t('mq.refresh')}</Button> : undefined}
    />
  )

  if (HAS_BACKEND && loading && !data) {
    return (
      <>
        {head}
        <Squelette type="kpis" n={4} />
        <Squelette type="cartes" n={4} />
      </>
    )
  }

  return (
    <>
      {head}

      {error && <Erreur message={error} retryLabel={t('mq.retry')} onRetry={() => void reload()} />}

      <KpiGrid>
        <Kpi label={t('stats.acceptance')} value={`${s.acceptance ?? 0} %`} icon="check" tone="green" />
        <Kpi label={t('stats.avgDays')} value={t('pil.days', { n: s.avg_days ?? 0 })} icon="clock" hint={t('stats.measured')} />
        <Kpi label={t('stats.returning')} value={s.returning ?? 0} icon="clients" hint={t('stats.loyalty')} />
        <Kpi label={t('stats.biometrics')} value={s.biometrics_valid ?? 0} icon="passport" hint={t('stats.biometricsHint')} />
      </KpiGrid>

      <div className="grid grid--2">
        {/* LA statistique : le refus par consulat, contre la référence officielle */}
        <Section title={t('stats.refusalByConsulate')} className="grid__wide" flush>
          {(!s.refusal_by_consulate || s.refusal_by_consulate.length === 0) ? (
            <Vide title={t('stats.notEnough')} icon="reports" />
          ) : (
            <Table>
              <thead><tr>
                <th>{t('slots.consulate')}</th><th className="num">{t('refstats.decided')}</th>
                <th className="num col-optional">{t('refstats.refused')}</th><th className="num">{t('refstats.rate')}</th>
                <th className="num col-optional">{t('refstats.official')}</th><th className="num">{t('refstats.gap')}</th>
              </tr></thead>
              <tbody>
                {s.refusal_by_consulate.map((r, i) => {
                  const gap = r.official != null ? Math.round((r.rate - r.official) * 10) / 10 : null
                  return (
                    <tr key={i}>
                      <td className="t-medium">{r.consulate} · {r.city}</td>
                      <td className="num">{r.decided}</td>
                      <td className="num col-optional">{r.refused}</td>
                      <td className="num t-medium">{r.rate ?? 0} %</td>
                      <td className="num col-optional t-tertiary">{r.official != null ? `${r.official} %` : '·'}</td>
                      <td className="num">{gap == null ? <span className="t-tertiary">·</span> : <Pill tone={gap <= 0 ? 'green' : 'red'}>{gap > 0 ? `+${gap}` : gap}</Pill>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
          <p className="t-caption t-tertiary md-note">{t('refstats.hint')}</p>
        </Section>

        {/* Le créneau : délai réel mesuré */}
        {s.wait_by_consulate && s.wait_by_consulate.length > 0 && (
          <Section title={t('stats.waitByConsulate')} flush>
            <Table>
              <thead><tr><th>{t('slots.consulate')}</th><th className="num">{t('stats.avgDays')}</th><th className="num col-optional">{t('stats.waitingNow', { n: '' }).trim()}</th></tr></thead>
              <tbody>
                {s.wait_by_consulate.map((w, i) => (
                  <tr key={i}>
                    <td>
                      <div className="adm-cell-main">
                        <span>{w.consulate} · {w.city}</span>
                        {w.announced != null && <span className="t-caption">{t('stats.vsAnnounced', { n: w.announced })}</span>}
                      </div>
                    </td>
                    <td className="num t-medium">{t('pil.days', { n: w.real_days })}</td>
                    <td className="num col-optional">{w.waiting}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>
        )}

        {/* La conversion des demandes, le succès des tentatives */}
        <Section title={t('stats.funnel')}>
          <Ligne label={t('stats.requestConversion')}>{`${s.request_conversion ?? 0} %`}</Ligne>
          <Ligne label={`${t('stats.attemptSuccess')} · ${t('stats.last30')}`}>{`${s.attempt_success ?? 0} %`}</Ligne>
          <Ligne label={t('dash.open')}>{s.open_cases ?? 0}</Ligne>
        </Section>

        {/* La pièce la plus souvent manquante : nourrit la checklist */}
        {s.top_missing && s.top_missing.length > 0 && (
          <Section title={t('stats.topMissing')}>
            {s.top_missing.map((m, i) => <Ligne key={i} label={m.label}>{m.n}</Ligne>)}
          </Section>
        )}

        {/* La charge à venir : la saisonnalité */}
        {s.upcoming && s.upcoming.length > 0 && (
          <Section title={t('stats.upcoming')} className="grid__wide">
            <Barres points={s.upcoming.map((u) => u.n)} labels={s.upcoming.map((u) => u.month.slice(5))} format={formatNumber} />
          </Section>
        )}

        {/* Par agent */}
        {s.by_agent && s.by_agent.length > 0 && (
          <Section title={t('reports.byAgent')} flush>
            <Table>
              <thead><tr><th>{t('misc.agent')}</th><th className="num">{t('dash.open')}</th><th className="num col-optional">{t('refstats.decided')}</th><th className="num">{t('reports.acceptance')}</th></tr></thead>
              <tbody>{s.by_agent.map((ag, i) => (
                <tr key={i}><td className="t-medium">{ag.name}</td><td className="num">{ag.open}</td><td className="num col-optional">{ag.decided}</td><td className="num">{ag.acceptance} %</td></tr>
              ))}</tbody>
            </Table>
          </Section>
        )}

        {/* L'argent, direction seulement */}
        {money && (
          <Section title={t('stats.money')} className="grid__wide">
            <KpiGrid>
              <Kpi label={t('reports.revenue')} value={formatMoney(money.collected_month)} icon="payments" tone="green"
                   spark={money.by_month?.map((m) => m.amount)} />
              <Kpi label={t('stats.outstanding')} value={formatMoney(money.outstanding)} icon="clock"
                   tone={money.outstanding > 0 ? 'orange' : undefined} />
              <Kpi label={t('stats.shipments')} value={s.shipments_open ?? 0} icon="ship"
                   tone={s.shipments_blocked ? 'red' : undefined}
                   hint={s.shipments_blocked ? `${s.shipments_blocked} ${t('pil.blocked').toLowerCase()}` : undefined} />
            </KpiGrid>
            {money.by_visa && money.by_visa.length > 0 && (
              <div className="col gap-1">
                <span className="t-caption t-tertiary">{t('stats.byVisa')}</span>
                {money.by_visa.slice(0, 6).map((r, i) => <Ligne key={i} label={r.label}>{formatMoney(r.amount)}</Ligne>)}
              </div>
            )}
          </Section>
        )}
      </div>
    </>
  )
}
