import { useCallback, useEffect, useMemo, useState } from 'react'
import { HAS_BACKEND } from '@/lib/supabase'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Card, Empty, Segmented, Tabs } from '@/components/ui'
import { PageHead } from '@/components/bits'
import { ReportVisa } from '@/components/ReportVisa'
import { ReportCargo } from '@/components/ReportCargo'
import { TeamReport } from '@/components/TeamReport'
import { OverdueCard } from '@/components/OverdueCard'
import { BOITE, colonnes, largeurPct, maxDe, moisCourt, plusieursAnnees } from '@/lib/graphes'
import {
  loadAgencyRows, loadOfficeBoard, periodRange,
  type AgencyRow, type OfficeBoard, type PeriodKey,
} from '@/data/pilotage'

/* Le pilotage, sections 85 et 86.
 *
 * Deux vues, une seule barre de période :
 *   · « Mon bureau » : ce que voit l'équipe du bureau regardé ;
 *   · « Tous les bureaux » : une ligne par bureau, plus le total, réservée à
 *     qui voit toute l'agence.
 *
 * La ligne du total ne se déduit PAS de la somme des lignes : une donnée sans
 * bureau entre dans le total et dans aucune ligne. C'est le serveur qui la
 * calcule, et c'est une des raisons pour lesquelles ce module existe. */

type Onglet = 'bureau' | 'agence' | 'visa' | 'fret' | 'equipe'

export function Pilotage() {
  const { db, officeFilter } = useStore()
  const v = useVisible()
  const { t, locale, formatMoney, formatNumber } = useI18n()

  const [onglet, setOnglet] = useState<Onglet>('bureau')
  const [periode, setPeriode] = useState<PeriodKey>('j30')
  const { from, to } = useMemo(() => periodRange(periode), [periode])

  const [board, setBoard] = useState<OfficeBoard | null>(null)
  const [rows, setRows] = useState<AgencyRow[]>([])
  const [loading, setLoading] = useState(HAS_BACKEND)
  const [error, setError] = useState<string | null>(null)

  // La direction seule voit la vue consolidée. Le serveur refuserait de toute
  // façon : on n'affiche pas l'onglet pour ne pas promettre ce qui sera refusé.
  const voitToutBureau = v.scope === 'agence'

  const charger = useCallback(async () => {
    if (!HAS_BACKEND) { setLoading(false); return }
    setLoading(true)
    try {
      if (onglet === 'agence' && voitToutBureau) {
        setRows(await loadAgencyRows(from, to))
      } else if (onglet === 'bureau') {
        setBoard(await loadOfficeBoard(v.officeId, from, to))
      }
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [onglet, voitToutBureau, v.officeId, from, to])

  useEffect(() => { void charger() }, [charger])

  const bureauRegarde = officeFilter
    ? db.agency.offices.find((o) => o.id === officeFilter)?.name ?? null
    : null

  const onglets: { value: Onglet; label: string }[] = [
    { value: 'bureau', label: t('pil.tabOffice') },
    ...(voitToutBureau ? [{ value: 'agence' as Onglet, label: t('pil.tabAgency') }] : []),
    { value: 'visa', label: t('pil.tabVisa') },
    { value: 'fret', label: t('pil.tabCargo') },
    { value: 'equipe', label: t('pil.tabTeam') },
  ]

  if (!HAS_BACKEND) {
    return (
      <>
        <PageHead title={t('pil.title')} subtitle={t('pil.subtitle')} />
        <Card><Empty title={t('pil.offline')} hint={t('pil.offlineHint')} /></Card>
      </>
    )
  }

  return (
    <>
      <PageHead
        title={t('pil.title')}
        subtitle={bureauRegarde ? `${t('pil.subtitle')} · ${bureauRegarde}` : t('pil.subtitle')}
        action={
          <Segmented
            value={periode}
            onChange={setPeriode}
            label={t('pil.period')}
            options={[
              { value: 'mois', label: t('pil.thisMonth') },
              { value: 'j30', label: t('pil.last30') },
              { value: 'j90', label: t('pil.last90') },
              { value: 'annee', label: t('pil.thisYear') },
            ]}
          />
        }
      />

      <div style={{ marginBottom: 'var(--sp-5)' }}>
        <Tabs value={onglet} onChange={setOnglet} options={onglets} idPrefix="pilotage" />
      </div>

      {error && <Card><Empty title={t('pil.loadError', { msg: error })} /></Card>}

      {onglet === 'bureau' && (
        loading ? <Card><Empty title={t('pil.loading')} /></Card>
        : board ? <VueBureau board={board} locale={locale} />
        : <Card><Empty title={t('pil.empty')} /></Card>
      )}

      {onglet === 'agence' && voitToutBureau && (
        loading ? <Card><Empty title={t('pil.loading')} /></Card>
        : <VueAgence rows={rows} />
      )}

      {onglet === 'visa' && <ReportVisa officeId={v.officeId} from={from} to={to} />}
      {onglet === 'fret' && <ReportCargo officeId={v.officeId} from={from} to={to} />}
      {onglet === 'equipe' && <TeamReport from={from} to={to} />}

      {onglet === 'bureau' && (
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <OverdueCard officeId={v.officeId} />
        </div>
      )}
    </>
  )

  /* ---------------------------------------------------------------- */

  function VueBureau({ board: b, locale: loc }: { board: OfficeBoard; locale: string }) {
    const points = b.series.map((s) => ({ label: s.month, value: s.cases }))
    const barres = colonnes(points)
    const avecAnnee = plusieursAnnees(points)
    const maxEtape = maxDe(b.casesByStage.map((s) => s.n))

    return (
      <div className="stack">
        <div className="grid grid--4">
          <Stat label={t('pil.casesOpened')} value={formatNumber(b.casesOpened)}
                hint={`${b.casesOpenNow} ${t('pil.casesOpenNow').toLowerCase()}`} />
          <Stat label={t('pil.acceptance')}
                value={b.acceptance === null ? t('pil.notEnough') : `${b.acceptance} %`}
                hint={`${b.accepted} / ${b.decided}`} />
          <Stat label={t('pil.avgDecision')}
                value={b.avgDecisionDays === null ? t('pil.noValue') : t('pil.days', { n: b.avgDecisionDays })} />
          {b.money ? (
            <Stat label={t('pil.collected')} value={formatMoney(b.money.collected)}
                  hint={`${t('pil.outstanding')} ${formatMoney(b.money.outstanding)}`} />
          ) : (
            <Stat label={t('pil.tasksOverdue')} value={formatNumber(b.tasksOverdue)}
                  hint={t('pil.hiddenMoney')} />
          )}
        </div>

        <div className="grid grid--2">
          {/* La courbe des volumes, dessinée à la main : le projet n'a pas de
              bibliothèque de graphiques, et quarante lignes suffisent. */}
          <Card title={t('pil.volume')} className="grid__wide">
            {points.length === 0 ? <Empty title={t('pil.empty')} /> : (
              <div style={{ overflowX: 'auto' }}>
                <svg
                  viewBox={`0 0 ${BOITE.width} ${BOITE.height + 20}`}
                  width="100%"
                  height={BOITE.height + 20}
                  role="img"
                  aria-label={t('pil.volume')}
                >
                  {barres.map((c) => (
                    <rect key={c.p.label} x={c.x} y={c.y} width={c.w} height={c.h}
                          rx={3} fill="var(--blue)" opacity={0.85} />
                  ))}
                  {barres.map((c) => (
                    <text key={`v-${c.p.label}`} x={c.x + c.w / 2} y={Math.max(10, c.y - 4)}
                          textAnchor="middle" fontSize="10" fill="var(--text-tertiary)">
                      {c.p.value}
                    </text>
                  ))}
                  {barres.map((c) => (
                    <text key={`m-${c.p.label}`} x={c.x + c.w / 2} y={BOITE.height + 14}
                          textAnchor="middle" fontSize="10" fill="var(--text-tertiary)">
                      {moisCourt(c.p.label, loc, avecAnnee)}
                    </text>
                  ))}
                </svg>
              </div>
            )}
          </Card>

          <Card title={t('pil.byStage')}>
            {b.casesByStage.length === 0 ? <Empty title={t('pil.empty')} /> : (
              <div className="col gap-3">
                {b.casesByStage.map((s) => (
                  <div key={s.stage} className="col gap-2">
                    <div className="row-between">
                      <span className="t-small">{t(`stage.${s.stage}` as 'stage.nouveau')}</span>
                      <span className="t-small t-num t-medium">{s.n}</span>
                    </div>
                    <div className="progress">
                      <div className="progress__bar" style={{ width: `${largeurPct(s.n, maxEtape)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title={t('pil.tabOffice')}>
            <div className="col gap-3">
              <Ligne label={t('pil.casesClosed')} value={formatNumber(b.casesClosed)} />
              <Ligne label={t('pil.docsMissing')} value={formatNumber(b.docsMissing)} />
              <Ligne label={t('pil.docsToValidate')} value={formatNumber(b.docsToValidate)} />
              <Ligne label={t('pil.clientsNew')} value={formatNumber(b.clientsNew)} />
              <Ligne label={t('pil.people')} value={formatNumber(b.people)} />
            </div>
          </Card>

          <Card title={t('pil.apptsPlanned')}>
            <div className="col gap-3">
              <Ligne label={t('pil.apptsPlanned')} value={formatNumber(b.apptsPlanned)} />
              <Ligne label={t('pil.apptsDone')} value={formatNumber(b.apptsDone)} />
              <Ligne label={t('pil.apptsMissed')} value={formatNumber(b.apptsMissed)} />
              <Ligne label={t('pil.tasksOpen')} value={formatNumber(b.tasksOpen)} />
              <Ligne label={t('pil.tasksOverdue')} value={formatNumber(b.tasksOverdue)} />
            </div>
          </Card>

          <Card title={t('pil.shipmentsOpenNow')}>
            <div className="col gap-3">
              <Ligne label={t('pil.shipmentsOpened')} value={formatNumber(b.shipmentsOpened)} />
              <Ligne label={t('pil.shipmentsDelivered')} value={formatNumber(b.shipmentsDelivered)} />
              <Ligne label={t('pil.shipmentsOpenNow')} value={formatNumber(b.shipmentsOpenNow)} />
              <Ligne label={t('pil.shipmentsBlocked')} value={formatNumber(b.shipmentsBlocked)} />
            </div>
          </Card>

          {b.leads && (
            <Card title={t('pil.leads')}>
              <div className="col gap-3">
                <Ligne label={t('pil.leadsNew')} value={formatNumber(b.leads.new)} />
                <Ligne label={t('pil.leadsWon')} value={formatNumber(b.leads.won)} />
                <Ligne label={t('pil.leadsLost')} value={formatNumber(b.leads.lost)} />
                <Ligne label={t('pil.leadsOpen')} value={formatNumber(b.leads.open)} />
              </div>
            </Card>
          )}

          {b.money && (
            <Card title={t('pil.collected')}>
              <div className="col gap-3">
                <Ligne label={t('pil.collected')} value={formatMoney(b.money.collected)} />
                <Ligne label={t('pil.outstanding')} value={formatMoney(b.money.outstanding)} />
                <Ligne label={t('pil.caseBalancesAmount')} value={formatMoney(b.money.caseBalances)} />
              </div>
            </Card>
          )}
        </div>
      </div>
    )
  }

  function VueAgence({ rows: rs }: { rows: AgencyRow[] }) {
    if (rs.length === 0) return <Card><Empty title={t('pil.empty')} /></Card>
    const argent = rs.some((r) => r.revenue !== null)
    return (
      <Card title={t('pil.tabAgency')} flush>
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('pil.tabOffice')}</th>
                <th className="num">{t('pil.casesOpened')}</th>
                <th className="num">{t('pil.casesOpenNow')}</th>
                <th className="num">{t('pil.decided')}</th>
                <th className="num">{t('pil.acceptance')}</th>
                <th className="num">{t('pil.avgDecision')}</th>
                <th className="num">{t('pil.shipmentsOpenNow')}</th>
                <th className="num">{t('pil.shipmentsDelivered')}</th>
                <th className="num">{t('pil.clientsNew')}</th>
                <th className="num">{t('pil.tasksOverdue')}</th>
                {argent && <th className="num">{t('pil.collected')}</th>}
                {argent && <th className="num">{t('pil.outstanding')}</th>}
              </tr>
            </thead>
            <tbody>
              {rs.map((r) => (
                <tr key={r.officeId ?? 'total'} style={{ fontWeight: r.isTotal ? 600 : undefined }}>
                  <td className="t-small t-medium">{r.isTotal ? t('pil.total') : r.officeName}</td>
                  <td className="num t-small">{r.casesOpened}</td>
                  <td className="num t-small">{r.casesOpenNow}</td>
                  <td className="num t-small">{r.decided}</td>
                  <td className="num t-small">{r.acceptance === null ? '·' : `${r.acceptance} %`}</td>
                  <td className="num t-small">
                    {r.avgDecisionDays === null ? '·' : t('pil.days', { n: r.avgDecisionDays })}
                  </td>
                  <td className="num t-small">{r.shipmentsOpen}</td>
                  <td className="num t-small">{r.shipmentsDelivered}</td>
                  <td className="num t-small">{r.clientsNew}</td>
                  <td className="num t-small">{r.tasksOverdue}</td>
                  {argent && <td className="num t-small">{r.revenue === null ? '·' : formatMoney(r.revenue)}</td>}
                  {argent && <td className="num t-small">{r.outstanding === null ? '·' : formatMoney(r.outstanding)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    )
  }
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

function Ligne({ label, value }: { label: string; value: string }) {
  return (
    <div className="row-between">
      <span className="t-small t-secondary">{label}</span>
      <span className="t-small t-num t-medium">{value}</span>
    </div>
  )
}
