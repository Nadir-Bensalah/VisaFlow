import { HAS_BACKEND } from '@/lib/supabase'
import { useI18n } from '@/i18n'
import { Empty, Pill } from '@/components/ui'
import { Erreur, Kpi, KpiGrid, Ligne, Section, Squelette, Table, Vide, useChargement } from '@/components/page'
import { largeurPct, maxDe } from '@/lib/graphes'
import { loadVisaReport, type VisaReport } from '@/data/pilotage'
import '@/styles/modules.css'

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

export function ReportVisa({ officeId, from, to }: { officeId: string | null; from: string; to: string }) {
  const { t, tt, formatMoney, formatNumber } = useI18n()
  const { data: rep, loading, error, reload } = useChargement(
    () => (HAS_BACKEND ? loadVisaReport(officeId, from, to) : Promise.resolve(null as VisaReport | null)),
    [officeId, from, to],
  )

  if (!HAS_BACKEND) return <Section><Empty title={t('mq.demoTitle')} hint={t('mq.demoHint')} scene="passeport" /></Section>
  if (error) return <Erreur message={error} retryLabel={t('mq.retry')} onRetry={() => void reload()} />
  if (loading && !rep) return <><Squelette type="kpis" n={4} /><Squelette type="cartes" n={4} /></>
  if (!rep) return <Section><Vide title={t('pil.empty')} icon="passport" /></Section>

  // Un délai qu'on ne sait pas mesurer s'affiche vide, jamais à zéro : zéro
  // jour voudrait dire « instantané », et ce n'est pas ce qu'on sait.
  const jours = (n: number | null) => (n === null ? t('pil.noValue') : t('pil.days', { n }))
  const pct = (n: number | null) => (n === null ? t('pil.notEnough') : `${n} %`)

  const maxPays = maxDe(rep.byCountry.map((c) => c.n))
  const maxType = maxDe(rep.byType.map((c) => c.n))
  const maxMotif = maxDe(rep.refusalReasons.map((c) => c.n))

  return (
    <div className="stack">
      <KpiGrid>
        <Kpi label={t('pil.cases')} value={formatNumber(rep.cases)} icon="cases" tone="blue" />
        <Kpi label={t('pil.successRate')} value={pct(rep.successRate)} icon="check" tone="green"
             hint={`${rep.accepted} / ${rep.decided}`} />
        <Kpi label={t('pil.delayDecision')} value={jours(rep.delays.toDecision)} icon="clock" hint={t('pil.delays')} />
        {rep.revenue === null
          ? <Kpi label={t('pil.revenue')} value="·" icon="payments" hint={t('pil.hiddenMoney')} />
          : <Kpi label={t('pil.revenue')} value={formatMoney(rep.revenue)} icon="payments" tone="green" />}
      </KpiGrid>

      <div className="grid grid--2">
        {/* LE tableau de l'écran : l'observé contre la référence, jamais fondus */}
        <Section title={t('pil.refusalsTitle')} className="grid__wide" flush>
          {rep.refusalsByConsulate.length === 0 ? (
            <Vide title={t('pil.notEnough')} icon="reports" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t('pil.refusalsTitle')}</th>
                  <th className="num">{t('pil.decided')}</th>
                  <th className="num col-optional">{t('pil.refused')}</th>
                  <th className="num">{t('pil.observed')}</th>
                  <th className="num col-optional">{t('pil.reference')}</th>
                  <th className="num col-optional">{t('pil.referenceYear')}</th>
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
                      <td className="t-medium">{tt(r.country)} · {r.city}</td>
                      <td className="num">{r.observedDecided}</td>
                      <td className="num col-optional">{r.observedRefused}</td>
                      <td className="num t-medium">{r.observedRate === null ? '·' : `${r.observedRate} %`}</td>
                      <td className="num col-optional t-tertiary">{r.referenceRate === null ? '·' : `${r.referenceRate} %`}</td>
                      <td className="num col-optional t-caption t-tertiary">{r.referenceYear ?? '·'}</td>
                      <td className="num">
                        {ecart === null ? <span className="t-tertiary">·</span> : (
                          <Pill tone={ecart <= 0 ? 'green' : 'red'}>{ecart > 0 ? `+${ecart}` : ecart}</Pill>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
          <p className="t-caption t-tertiary md-note">{t('pil.refusalsHint')}</p>
        </Section>

        <Section title={t('pil.delays')}>
          <Ligne label={t('pil.delayDecision')}>{jours(rep.delays.toDecision)}</Ligne>
          <Ligne label={t('pil.delayDeposit')}>{jours(rep.delays.toDeposit)}</Ligne>
          <Ligne label={t('pil.delayDocs')}>{jours(rep.delays.docsComplete)}</Ligne>
          <Ligne label={t('pil.delayClose')}>{jours(rep.delays.toClose)}</Ligne>
        </Section>

        <Section title={t('pil.byCountry')}>
          {rep.byCountry.length === 0 ? <Vide title={t('pil.empty')} icon="portal" /> : (
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
        </Section>

        <Section title={t('pil.byType')}>
          {rep.byType.length === 0 ? <Vide title={t('pil.empty')} icon="passport" /> : (
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
        </Section>

        {/* Par agent : des chiffres bruts, dans l'ordre rendu par le serveur,
            c'est-à-dire par nom. Aucun tri par performance ici. */}
        <Section title={t('pil.byAgent')} flush>
          {rep.byAgent.length === 0 ? <Vide title={t('pil.empty')} icon="clients" /> : (
            <Table>
              <thead>
                <tr>
                  <th>{t('pil.person')}</th>
                  <th className="num">{t('pil.opened')}</th>
                  <th className="num col-optional">{t('pil.openNow')}</th>
                  <th className="num col-optional">{t('pil.decided')}</th>
                  <th className="num">{t('pil.accepted')}</th>
                </tr>
              </thead>
              <tbody>
                {rep.byAgent.map((a) => (
                  <tr key={a.userId}>
                    <td className="t-medium">{a.name}</td>
                    <td className="num">{a.opened}</td>
                    <td className="num col-optional">{a.openNow}</td>
                    <td className="num col-optional">{a.decided}</td>
                    <td className="num">{a.accepted}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>

        <Section title={t('pil.missingDocs')}>
          {rep.missingDocuments.length === 0 ? <Vide title={t('pil.empty')} icon="documents" /> : (
            <>
              {rep.missingDocuments.map((m) => <Ligne key={m.key} label={tt(m.label) || m.key}>{m.n}</Ligne>)}
            </>
          )}
        </Section>

        {rep.refusalReasons.length > 0 && (
          <Section title={t('pil.refusalReasons')}>
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
          </Section>
        )}

        {rep.revenueByCountry.length > 0 && (
          <Section title={t('pil.revenueByCountry')}>
            {rep.revenueByCountry.slice(0, 8).map((r) => <Ligne key={r.code} label={tt(r.label)}>{formatMoney(r.amount)}</Ligne>)}
          </Section>
        )}
      </div>
    </div>
  )
}
