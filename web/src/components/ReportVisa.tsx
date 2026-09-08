import { useCallback, useEffect, useState } from 'react'
import { HAS_BACKEND } from '@/lib/supabase'
import { useI18n } from '@/i18n'
import { Card, Empty, Pill } from '@/components/ui'
import { largeurPct, maxDe } from '@/lib/graphes'
import { loadVisaReport, type VisaReport } from '@/data/pilotage'

/* Le rapport visa de la section 127.
 *
 * Tout descend du serveur déjà compté. Cet écran ne fait aucune addition : la
 * seule arithmétique qu'il s'autorise est l'ÉCART entre le taux observé et le
 * taux publié, parce que c'est une soustraction de deux chiffres affichés côte
 * à côte, et que le lecteur la ferait de tête sinon.
 *
 * Le point délicat de cet écran tient en une phrase : le taux de refus observé
 * chez l'agence et le taux publié par le poste ne sont pas la même chose. Deux
 * colonnes, deux libellés, et une note qui le dit. */

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

export function ReportVisa({ officeId, from, to }: { officeId: string | null; from: string; to: string }) {
  const { t, tt, formatMoney, formatNumber } = useI18n()
  const [rep, setRep] = useState<VisaReport | null>(null)
  const [loading, setLoading] = useState(HAS_BACKEND)
  const [error, setError] = useState<string | null>(null)

  const charger = useCallback(async () => {
    if (!HAS_BACKEND) { setLoading(false); return }
    setLoading(true)
    try {
      setRep(await loadVisaReport(officeId, from, to))
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

  // Un délai qu'on ne sait pas mesurer s'affiche vide, jamais à zéro : zéro
  // jour voudrait dire « instantané », et ce n'est pas ce qu'on sait.
  const jours = (n: number | null) => (n === null ? t('pil.noValue') : t('pil.days', { n }))
  const pct = (n: number | null) => (n === null ? t('pil.notEnough') : `${n} %`)

  const maxPays = maxDe(rep.byCountry.map((c) => c.n))
  const maxType = maxDe(rep.byType.map((c) => c.n))
  const maxMotif = maxDe(rep.refusalReasons.map((c) => c.n))

  return (
    <div className="stack">
      <div className="grid grid--4">
        <Stat label={t('pil.cases')} value={formatNumber(rep.cases)} />
        <Stat label={t('pil.successRate')} value={pct(rep.successRate)}
              hint={`${rep.accepted} / ${rep.decided}`} />
        <Stat label={t('pil.delayDecision')} value={jours(rep.delays.toDecision)}
              hint={t('pil.delays')} />
        {rep.revenue === null ? (
          <Stat label={t('pil.revenue')} value="·" hint={t('pil.hiddenMoney')} />
        ) : (
          <Stat label={t('pil.revenue')} value={formatMoney(rep.revenue)} />
        )}
      </div>

      <div className="grid grid--2">
        {/* LE tableau de l'écran : l'observé contre la référence, jamais fondus */}
        <Card title={t('pil.refusalsTitle')} className="grid__wide" flush>
          {rep.refusalsByConsulate.length === 0 ? (
            <div style={{ padding: 'var(--sp-5)' }}><Empty title={t('pil.notEnough')} /></div>
          ) : (
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('pil.refusalsTitle')}</th>
                    <th className="num">{t('pil.decided')}</th>
                    <th className="num">{t('pil.refused')}</th>
                    <th className="num">{t('pil.observed')}</th>
                    <th className="num">{t('pil.reference')}</th>
                    <th className="num">{t('pil.referenceYear')}</th>
                    <th className="num">{t('pil.gap')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rep.refusalsByConsulate.map((r) => {
                    const ecart = r.observedRate !== null && r.referenceRate !== null
                      ? Math.round((r.observedRate - r.referenceRate) * 10) / 10
                      : null
                    return (
                      <tr key={r.consulateId}>
                        <td className="t-small t-medium">{tt(r.country)} · {r.city}</td>
                        <td className="num t-small">{r.observedDecided}</td>
                        <td className="num t-small">{r.observedRefused}</td>
                        <td className="num t-small t-medium">
                          {r.observedRate === null ? '·' : `${r.observedRate} %`}
                        </td>
                        <td className="num t-small t-tertiary">
                          {r.referenceRate === null ? '·' : `${r.referenceRate} %`}
                        </td>
                        <td className="num t-caption t-tertiary">{r.referenceYear ?? '·'}</td>
                        <td className="num t-small">
                          {ecart === null ? '·' : (
                            <Pill tone={ecart <= 0 ? 'green' : 'red'}>{ecart > 0 ? `+${ecart}` : ecart}</Pill>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="t-caption t-tertiary" style={{ padding: 'var(--sp-3) var(--sp-5)' }}>
            {t('pil.refusalsHint')}
          </p>
        </Card>

        <Card title={t('pil.delays')}>
          <div className="col gap-4">
            <Ligne label={t('pil.delayDecision')} value={jours(rep.delays.toDecision)} />
            <Ligne label={t('pil.delayDeposit')} value={jours(rep.delays.toDeposit)} />
            <Ligne label={t('pil.delayDocs')} value={jours(rep.delays.docsComplete)} />
            <Ligne label={t('pil.delayClose')} value={jours(rep.delays.toClose)} />
          </div>
        </Card>

        <Card title={t('pil.byCountry')}>
          {rep.byCountry.length === 0 ? <Empty title={t('pil.empty')} /> : (
            <div className="col gap-3">
              {rep.byCountry.slice(0, 8).map((c) => (
                <div key={c.code} className="col gap-2">
                  <div className="row-between">
                    <span className="t-small">{tt(c.label)}</span>
                    <span className="t-small t-num t-medium">{c.n}</span>
                  </div>
                  <div className="progress">
                    <div className="progress__bar" style={{ width: `${largeurPct(c.n, maxPays)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={t('pil.byType')}>
          {rep.byType.length === 0 ? <Empty title={t('pil.empty')} /> : (
            <div className="col gap-3">
              {rep.byType.slice(0, 8).map((c) => (
                <div key={c.id} className="col gap-2">
                  <div className="row-between">
                    <span className="t-small">{tt(c.label)}</span>
                    <span className="t-small t-num t-medium">{c.n}</span>
                  </div>
                  <div className="progress">
                    <div className="progress__bar" style={{ width: `${largeurPct(c.n, maxType)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Par agent : des chiffres bruts, dans l'ordre rendu par le serveur,
            c'est-à-dire par nom. Aucun tri par performance ici. */}
        <Card title={t('pil.byAgent')} flush>
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('pil.person')}</th>
                  <th className="num">{t('pil.opened')}</th>
                  <th className="num">{t('pil.openNow')}</th>
                  <th className="num">{t('pil.decided')}</th>
                  <th className="num">{t('pil.accepted')}</th>
                </tr>
              </thead>
              <tbody>
                {rep.byAgent.map((a) => (
                  <tr key={a.userId}>
                    <td className="t-small t-medium">{a.name}</td>
                    <td className="num t-small">{a.opened}</td>
                    <td className="num t-small">{a.openNow}</td>
                    <td className="num t-small">{a.decided}</td>
                    <td className="num t-small">{a.accepted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={t('pil.missingDocs')}>
          {rep.missingDocuments.length === 0 ? <Empty title={t('pil.empty')} /> : (
            <div className="col gap-3">
              {rep.missingDocuments.map((m) => (
                <div key={m.key} className="row-between">
                  <span className="t-small">{tt(m.label) || m.key}</span>
                  <span className="t-small t-num t-medium">{m.n}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {rep.refusalReasons.length > 0 && (
          <Card title={t('pil.refusalReasons')}>
            <div className="col gap-3">
              {rep.refusalReasons.map((r) => (
                <div key={r.code} className="col gap-2">
                  <div className="row-between">
                    <span className="t-small">{t(`refusal.${r.code}` as 'refusal.autre')}</span>
                    <span className="t-small t-num t-medium">{r.n}</span>
                  </div>
                  <div className="progress">
                    <div className="progress__bar" style={{ width: `${largeurPct(r.n, maxMotif)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {rep.revenueByCountry.length > 0 && (
          <Card title={t('pil.revenueByCountry')}>
            <div className="col gap-3">
              {rep.revenueByCountry.slice(0, 8).map((r) => (
                <div key={r.code} className="row-between">
                  <span className="t-small">{tt(r.label)}</span>
                  <span className="t-small t-num t-medium">{formatMoney(r.amount)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function Ligne({ label, value }: { label: string; value: string }) {
  return (
    <div className="row-between">
      <span className="t-small">{label}</span>
      <span className="t-num t-medium" style={{ fontSize: 'var(--size-h4)' }}>{value}</span>
    </div>
  )
}
