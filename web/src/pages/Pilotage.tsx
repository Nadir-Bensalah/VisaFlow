import { useMemo, useState } from 'react'
import { HAS_BACKEND } from '@/lib/supabase'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Empty, Segmented, Tabs } from '@/components/ui'
import { ExportButton } from '@/components/ExportButton'
import {
  Erreur, Kpi, KpiGrid, Ligne, PageHeader, Section, Squelette, Table, Vide, useChargement,
} from '@/components/page'
import { ReportVisa } from '@/components/ReportVisa'
import { ReportCargo } from '@/components/ReportCargo'
import { TeamReport } from '@/components/TeamReport'
import { OverdueCard } from '@/components/OverdueCard'
import { BOITE, colonnes, largeurPct, maxDe, moisCourt, plusieursAnnees } from '@/lib/graphes'
import {
  loadAgencyRows, loadOfficeBoard, periodRange,
  type AgencyRow, type OfficeBoard, type PeriodKey,
} from '@/data/pilotage'
import '@/styles/modules.css'

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

  // La direction seule voit la vue consolidée. Le serveur refuserait de toute
  // façon : on n'affiche pas l'onglet pour ne pas promettre ce qui sera refusé.
  const voitToutBureau = v.scope === 'agence'

  const bureau = useChargement(
    () => (HAS_BACKEND ? loadOfficeBoard(v.officeId, from, to) : Promise.resolve(null as OfficeBoard | null)),
    [v.officeId, from, to],
  )
  const agence = useChargement(
    () => (HAS_BACKEND && voitToutBureau ? loadAgencyRows(from, to) : Promise.resolve([] as AgencyRow[])),
    [voitToutBureau, from, to],
  )

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

  const refreshing = (bureau.refreshing && !bureau.loading) || (agence.refreshing && !agence.loading)
  const recharger = () => { void bureau.reload(); void agence.reload() }

  const rows = useMemo(() => agence.data ?? [], [agence.data])
  const colonnesExport = [
    { key: 'office', label: t('pil.tabOffice'), value: (r: AgencyRow) => (r.isTotal ? t('pil.total') : r.officeName) },
    { key: 'casesOpened', label: t('pil.casesOpened'), value: (r: AgencyRow) => r.casesOpened },
    { key: 'casesOpenNow', label: t('pil.casesOpenNow'), value: (r: AgencyRow) => r.casesOpenNow },
    { key: 'decided', label: t('pil.decided'), value: (r: AgencyRow) => r.decided },
    { key: 'acceptance', label: t('pil.acceptance'), value: (r: AgencyRow) => r.acceptance },
    { key: 'avgDecision', label: t('pil.avgDecision'), value: (r: AgencyRow) => r.avgDecisionDays },
    { key: 'shipmentsOpen', label: t('pil.shipmentsOpenNow'), value: (r: AgencyRow) => r.shipmentsOpen },
    { key: 'shipmentsDelivered', label: t('pil.shipmentsDelivered'), value: (r: AgencyRow) => r.shipmentsDelivered },
    { key: 'clientsNew', label: t('pil.clientsNew'), value: (r: AgencyRow) => r.clientsNew },
    { key: 'tasksOverdue', label: t('pil.tasksOverdue'), value: (r: AgencyRow) => r.tasksOverdue },
    { key: 'revenue', label: t('pil.collected'), value: (r: AgencyRow) => r.revenue },
    { key: 'outstanding', label: t('pil.outstanding'), value: (r: AgencyRow) => r.outstanding },
  ]

  const head = (
    <PageHeader
      kicker={t('mq.kickerPilotage')}
      title={t('pil.title')}
      subtitle={bureauRegarde ? `${t('mq.pilotageSub')} · ${bureauRegarde}` : t('mq.pilotageSub')}
      refreshing={refreshing}
      refreshingLabel={t('mq.refreshing')}
      actions={HAS_BACKEND ? <>
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
        {onglet === 'agence' && <ExportButton rows={rows} columns={colonnesExport} base="pilotage-bureaux" scope="pilotage" disabled={rows.length === 0} />}
        <Button icon="refresh" onClick={recharger} disabled={refreshing}>{t('mq.refresh')}</Button>
      </> : undefined}
    />
  )

  if (!HAS_BACKEND) {
    return (
      <>
        {head}
        <Section><Empty title={t('mq.demoTitle')} hint={t('mq.demoHint')} scene="journee" /></Section>
      </>
    )
  }

  return (
    <>
      {head}

      <div className="md-tabs">
        <Tabs value={onglet} onChange={setOnglet} options={onglets} idPrefix="pilotage" />
      </div>

      {onglet === 'bureau' && (
        <>
          {bureau.error && <Erreur message={bureau.error} retryLabel={t('mq.retry')} onRetry={() => void bureau.reload()} />}
          {bureau.loading && !bureau.data
            ? <><Squelette type="kpis" n={4} /><Squelette type="cartes" n={4} /></>
            : bureau.data
              ? <VueBureau board={bureau.data} locale={locale} />
              : <Section><Vide title={t('pil.empty')} icon="reports" /></Section>}
          <div style={{ marginTop: 'var(--sp-5)' }}>
            <OverdueCard officeId={v.officeId} />
          </div>
        </>
      )}

      {onglet === 'agence' && voitToutBureau && (
        <>
          {agence.error && <Erreur message={agence.error} retryLabel={t('mq.retry')} onRetry={() => void agence.reload()} />}
          {agence.loading && !agence.data
            ? <Section flush><Squelette type="table" n={5} /></Section>
            : <VueAgence rows={rows} />}
        </>
      )}

      {onglet === 'visa' && <ReportVisa officeId={v.officeId} from={from} to={to} />}
      {onglet === 'fret' && <ReportCargo officeId={v.officeId} from={from} to={to} />}
      {onglet === 'equipe' && <TeamReport from={from} to={to} />}
    </>
  )

  /* ---------------------------------------------------------------- */

  function VueBureau({ board: b, locale: loc }: { board: OfficeBoard; locale: string }) {
    const points = b.series.map((s) => ({ label: s.month, value: s.cases }))
    const barres = colonnes(points)
    const avecAnnee = plusieursAnnees(points)
    const maxEtape = maxDe(b.casesByStage.map((s) => s.n))
    const serieDossiers = b.series.map((s) => s.cases)
    const serieCargaisons = b.series.map((s) => s.shipments)

    return (
      <div className="stack">
        <KpiGrid>
          <Kpi label={t('pil.casesOpened')} value={formatNumber(b.casesOpened)} icon="cases" tone="blue"
               spark={serieDossiers} hint={`${b.casesOpenNow} ${t('pil.casesOpenNow').toLowerCase()}`} />
          <Kpi label={t('pil.acceptance')} icon="check" tone="green"
               value={b.acceptance === null ? t('pil.notEnough') : `${b.acceptance} %`}
               hint={`${b.accepted} / ${b.decided}`} />
          <Kpi label={t('pil.avgDecision')} icon="clock"
               value={b.avgDecisionDays === null ? t('pil.noValue') : t('pil.days', { n: b.avgDecisionDays })} />
          {b.money ? (
            <Kpi label={t('pil.collected')} value={formatMoney(b.money.collected)} icon="payments" tone="green"
                 hint={`${t('pil.outstanding')} ${formatMoney(b.money.outstanding)}`} />
          ) : (
            <Kpi label={t('pil.tasksOverdue')} value={formatNumber(b.tasksOverdue)} icon="alert"
                 tone={b.tasksOverdue > 0 ? 'red' : undefined} hint={t('pil.hiddenMoney')} />
          )}
          {db.agency.services.includes('fret') && (
            <Kpi label={t('pil.shipmentsOpenNow')} value={formatNumber(b.shipmentsOpenNow)} icon="ship"
                 spark={serieCargaisons} tone={b.shipmentsBlocked > 0 ? 'orange' : undefined}
                 hint={`${formatNumber(b.shipmentsBlocked)} ${t('pil.shipmentsBlocked').toLowerCase()}`} />
          )}
        </KpiGrid>

        <div className="grid grid--2">
          {/* La courbe des volumes, dessinée à la main : le projet n'a pas de
              bibliothèque de graphiques, et quarante lignes suffisent. */}
          <Section title={t('pil.volume')} className="grid__wide">
            {points.length === 0 ? <Vide title={t('pil.empty')} icon="reports" /> : (
              <div className="md-svg">
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
          </Section>

          <Section title={t('pil.byStage')}>
            {b.casesByStage.length === 0 ? <Vide title={t('pil.empty')} icon="pipeline" /> : (
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
          </Section>

          <Section title={t('pil.tabOffice')}>
            <Ligne label={t('pil.casesClosed')}>{formatNumber(b.casesClosed)}</Ligne>
            <Ligne label={t('pil.docsMissing')}>{formatNumber(b.docsMissing)}</Ligne>
            <Ligne label={t('pil.docsToValidate')}>{formatNumber(b.docsToValidate)}</Ligne>
            <Ligne label={t('pil.clientsNew')}>{formatNumber(b.clientsNew)}</Ligne>
            <Ligne label={t('pil.people')}>{formatNumber(b.people)}</Ligne>
          </Section>

          <Section title={t('pil.apptsPlanned')}>
            <Ligne label={t('pil.apptsPlanned')}>{formatNumber(b.apptsPlanned)}</Ligne>
            <Ligne label={t('pil.apptsDone')}>{formatNumber(b.apptsDone)}</Ligne>
            <Ligne label={t('pil.apptsMissed')}>{formatNumber(b.apptsMissed)}</Ligne>
            <Ligne label={t('pil.tasksOpen')}>{formatNumber(b.tasksOpen)}</Ligne>
            <Ligne label={t('pil.tasksOverdue')}>{formatNumber(b.tasksOverdue)}</Ligne>
          </Section>

          <Section title={t('pil.shipmentsOpenNow')}>
            <Ligne label={t('pil.shipmentsOpened')}>{formatNumber(b.shipmentsOpened)}</Ligne>
            <Ligne label={t('pil.shipmentsDelivered')}>{formatNumber(b.shipmentsDelivered)}</Ligne>
            <Ligne label={t('pil.shipmentsOpenNow')}>{formatNumber(b.shipmentsOpenNow)}</Ligne>
            <Ligne label={t('pil.shipmentsBlocked')}>{formatNumber(b.shipmentsBlocked)}</Ligne>
          </Section>

          {b.leads && (
            <Section title={t('pil.leads')}>
              <Ligne label={t('pil.leadsNew')}>{formatNumber(b.leads.new)}</Ligne>
              <Ligne label={t('pil.leadsWon')}>{formatNumber(b.leads.won)}</Ligne>
              <Ligne label={t('pil.leadsLost')}>{formatNumber(b.leads.lost)}</Ligne>
              <Ligne label={t('pil.leadsOpen')}>{formatNumber(b.leads.open)}</Ligne>
            </Section>
          )}

          {b.money && (
            <Section title={t('pil.collected')}>
              <Ligne label={t('pil.collected')}>{formatMoney(b.money.collected)}</Ligne>
              <Ligne label={t('pil.outstanding')}>{formatMoney(b.money.outstanding)}</Ligne>
              <Ligne label={t('pil.caseBalancesAmount')}>{formatMoney(b.money.caseBalances)}</Ligne>
            </Section>
          )}
        </div>
      </div>
    )
  }

  function VueAgence({ rows: rs }: { rows: AgencyRow[] }) {
    if (rs.length === 0) return <Section><Vide title={t('pil.empty')} icon="building" /></Section>
    const argent = rs.some((r) => r.revenue !== null)
    return (
      <Section title={t('pil.tabAgency')} flush action={<span className="t-caption t-tertiary t-num">{rs.filter((r) => !r.isTotal).length}</span>}>
        <Table>
          <thead>
            <tr>
              <th>{t('pil.tabOffice')}</th>
              <th className="num">{t('pil.casesOpened')}</th>
              <th className="num col-optional">{t('pil.casesOpenNow')}</th>
              <th className="num col-optional">{t('pil.decided')}</th>
              <th className="num">{t('pil.acceptance')}</th>
              <th className="num col-optional">{t('pil.avgDecision')}</th>
              <th className="num col-optional">{t('pil.shipmentsOpenNow')}</th>
              <th className="num col-optional">{t('pil.shipmentsDelivered')}</th>
              <th className="num col-optional">{t('pil.clientsNew')}</th>
              <th className="num col-optional">{t('pil.tasksOverdue')}</th>
              {argent && <th className="num">{t('pil.collected')}</th>}
              {argent && <th className="num col-optional">{t('pil.outstanding')}</th>}
            </tr>
          </thead>
          <tbody>
            {rs.map((r) => (
              <tr key={r.officeId ?? 'total'} className={r.isTotal ? 'md-total' : ''}>
                <td className="t-medium">{r.isTotal ? t('pil.total') : r.officeName}</td>
                <td className="num">{r.casesOpened}</td>
                <td className="num col-optional">{r.casesOpenNow}</td>
                <td className="num col-optional">{r.decided}</td>
                <td className="num">{r.acceptance === null ? '·' : `${r.acceptance} %`}</td>
                <td className="num col-optional">
                  {r.avgDecisionDays === null ? '·' : t('pil.days', { n: r.avgDecisionDays })}
                </td>
                <td className="num col-optional">{r.shipmentsOpen}</td>
                <td className="num col-optional">{r.shipmentsDelivered}</td>
                <td className="num col-optional">{r.clientsNew}</td>
                <td className="num col-optional">{r.tasksOverdue}</td>
                {argent && <td className="num">{r.revenue === null ? '·' : formatMoney(r.revenue)}</td>}
                {argent && <td className="num col-optional">{r.outstanding === null ? '·' : formatMoney(r.outstanding)}</td>}
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
    )
  }
}
