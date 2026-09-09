import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useNow } from '@/data/clock'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Avatar, Button, Pill, useToast } from '@/components/ui'
import { Ago, Countdown, PriorityPill, StagePill, UrgencyReason } from '@/components/bits'
import { Kpi, KpiGrid, PageHeader, Section, Vide } from '@/components/page'
import { Icon } from '@/components/Icon'
import { ACTIVE_STAGES, SHIPMENT_STAGES, STAGES, STAGE_TONE, kpis, urgency } from '@/lib/derive'
import { clientName } from '@/lib/derive'

/* Le tableau de bord : l'état de l'agence, ses quatre chiffres et ce qui
   demande un regard. Les courbes viennent des données de l'agence (dossiers
   ouverts et encaissements par semaine), jamais d'une série inventée. */

const WEEK = 7 * 86400000

/** Huit semaines, la plus ancienne en premier : combien d'éléments datés tombent dans chacune. */
function weekly(now: number, dates: (string | undefined)[], weight: (i: number) => number = () => 1): number[] | undefined {
  const end = new Date(now); end.setHours(23, 59, 59, 999)
  const last = end.getTime()
  const out = Array.from({ length: 8 }, () => 0)
  dates.forEach((iso, i) => {
    if (!iso) return
    const at = new Date(iso).getTime()
    const back = Math.floor((last - at) / WEEK)
    if (back < 0 || back > 7) return
    out[7 - back] += weight(i)
  })
  return out.some((n) => n > 0) ? out : undefined
}

export function Dashboard() {
  const { db, actions } = useStore()
  const now = useNow()
  const v = useVisible()
  const { t, tt, formatMoney, formatNumber } = useI18n()
  const toast = useToast()
  const k = kpis(db, v)
  const user = v.user
  const canWrite = v.can('case:write')

  const attention = v.cases
    .filter((c) => c.status === 'ouvert')
    .map((c) => ({ kase: c, u: urgency(db, c) }))
    .filter((x) => x.u.score > 0)
    .sort((a, b) => b.u.score - a.u.score)
    .slice(0, 6)

  // Les cargaisons a surveiller : celles qui arrivent, celles qui traînent.
  const watchedShipments = v.shipments
    .filter((s) => s.status === 'en_cours')
    .sort((a, b) => (a.eta ?? '').localeCompare(b.eta ?? ''))
    .slice(0, 5)

  const appointments = v.appointments
    .filter((a) => a.status === 'prevu')
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 5)

  const byStage = ACTIVE_STAGES.map((stage) => ({
    stage,
    count: v.cases.filter((c) => c.status === 'ouvert' && c.stage === stage).length,
  }))
  const maxStage = Math.max(...byStage.map((s) => s.count), 1)

  const openedSpark = weekly(now, v.cases.map((c) => c.openedAt))
  const settled = v.payments.filter((p) => p.state === 'regle')
  const cashedSpark = weekly(now, settled.map((p) => p.at), (i) => settled[i].amount)

  const avancer = (id: string, reference: string, stage: typeof STAGES[number]) => {
    const next = STAGES[STAGES.indexOf(stage) + 1]
    if (!next) return
    actions.advance(id)
    toast(t('ls.advanced', { ref: reference, stage: t(`stage.${next}` as 'stage.nouveau') }))
  }

  return (
    <>
      <PageHeader
        kicker={t('ls.famPilotage')}
        title={t('dash.title', { name: user.name.split(' ')[0] })}
        subtitle={t('dash.subtitle')}
        actions={v.can('reports:view') ? <Link to="/pilotage" className="btn btn--secondary">{t('nav.pilotage')}</Link> : undefined}
      />

      <KpiGrid>
        <Kpi label={t('dash.open')} value={formatNumber(k.open)} tone="blue" icon="cases" spark={openedSpark} hint={openedSpark ? t('ls.sparkOpened') : undefined} to="/dossiers" />
        <Kpi label={t('dash.missing')} value={formatNumber(k.missingDocs)} tone={k.missingDocs > 0 ? 'orange' : 'gray'} icon="documents" hint={t('ls.hintOpen')} to="/pieces?filtre=manquantes" />
        <Kpi label={t('dash.late')} value={formatNumber(k.late)} tone={k.late > 0 ? 'red' : 'gray'} icon="alert" hint={t('cases.late')} to="/dossiers?filtre=retard" />
        {v.can('finance:global')
          ? <Kpi label={t('dash.revenue')} value={formatMoney(k.collected)} tone="green" icon="payments" spark={cashedSpark} hint={cashedSpark ? t('ls.sparkCashed') : t('pay.collected')} to="/paiements" />
          : <Kpi label={t('today.appointments')} value={formatNumber(k.todayAppointments)} tone="blue" icon="appointments" hint={t('today.title')} to="/rendez-vous?filtre=aujourdhui" />}
      </KpiGrid>

      <div className="grid grid--main">
        <div className="stack">
          <Section
            title={t('dash.needsAttention')}
            action={<Link to="/dossiers" className="t-small">{t('action.seeAll')}</Link>}
            flush
          >
            {attention.length === 0 ? (
              <Vide icon="check" title={t('dash.noAttention')} />
            ) : (
              <>
                <p className="t-caption t-tertiary" style={{ padding: 'var(--sp-3) var(--sp-5) 0', margin: 0 }}>
                  {t('dash.needsAttentionHint')}
                </p>
                <div className="list">
                  {attention.map(({ kase }) => {
                    const name = clientName(db, kase.clientId)
                    const visa = db.visaTypes.find((x) => x.id === kase.visaTypeId)
                    return (
                      <div key={kase.id} className="list__row">
                        <Avatar name={name} />
                        <Link to={`/dossiers/${kase.id}`} className="col grow" style={{ minWidth: 0 }}>
                          <span className="row gap-2">
                            <span className="t-small t-medium t-truncate">{name}</span>
                            <PriorityPill priority={kase.priority} />
                          </span>
                          <span className="t-caption t-tertiary t-truncate">{kase.reference} · {tt(visa?.country)} {tt(visa?.label)}</span>
                        </Link>
                        <UrgencyReason kase={kase} />
                        <StagePill stage={kase.stage} />
                        <span className="ls-actions">
                          {canWrite && kase.stage !== 'clos' && <Button size="sm" icon="arrow" onClick={() => avancer(kase.id, kase.reference, kase.stage)}>{t('caseDetail.advance')}</Button>}
                          <Link to={`/dossiers/${kase.id}`} className="btn btn--secondary btn--sm">{t('action.open')}</Link>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </Section>

          <Section title={t('dash.byStage')}>
            <div className="col gap-3">
              {byStage.map((s) => (
                <Link key={s.stage} to="/pipeline" className="ls-stage">
                  <span className="ls-stage__label t-truncate">{t(`stage.${s.stage}` as 'stage.nouveau')}</span>
                  <span className="ls-stage__bar">
                    <span
                      className="ls-stage__fill"
                      style={{
                        width: `${Math.max((s.count / maxStage) * 100, 3)}%`,
                        background: `var(--${STAGE_TONE[s.stage] === 'gray' ? 'text-tertiary' : STAGE_TONE[s.stage]})`,
                      }}
                    />
                  </span>
                  <span className="ls-stage__n">{s.count}</span>
                </Link>
              ))}
            </div>
          </Section>
        </div>

        <div className="stack">
          <Section title={t('dash.todayAppts')} action={<Link to="/rendez-vous" className="t-small">{t('action.seeAll')}</Link>} flush>
            {appointments.length === 0 ? (
              <Vide icon="appointments" title={t('appts.none')} />
            ) : (
              <div className="list">
                {appointments.map((a) => {
                  const kase = v.cases.find((c) => c.id === a.caseId)
                  const client = db.clients.find((c) => c.id === kase?.clientId)
                  return (
                    <div key={a.id} className="list__row">
                      <Icon name="appointments" size={18} className="t-tertiary" />
                      <Link to={`/dossiers/${a.caseId}`} className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-small t-medium t-truncate">{client?.firstName} {client?.lastName}</span>
                        <span className="t-caption t-tertiary t-truncate">
                          {t(`appt.${a.kind}` as 'appt.agence')}
                          {' · '}
                          {new Date(a.at).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                          {' · '}
                          {new Date(a.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </Link>
                      {canWrite && (
                        <span className="ls-actions">
                          <Button size="sm" icon="check" onClick={() => { actions.updateAppointment(a.id, { status: 'fait' }); toast(t('appt.fait')) }}>{t('action.confirm')}</Button>
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Section>

          <Section title={t('ship.title')} action={<Link to="/cargaisons" className="t-small">{t('action.seeAll')}</Link>} flush>
            {watchedShipments.length === 0 ? (
              <Vide icon="ship" title={t('ship.none')} />
            ) : (
              <div className="list">
                {watchedShipments.map((s) => {
                  const next = SHIPMENT_STAGES[SHIPMENT_STAGES.indexOf(s.stage) + 1]
                  return (
                    <div key={s.id} className="list__row">
                      <Icon name="ship" size={18} className="t-tertiary" />
                      <Link to={`/cargaisons/${s.id}`} className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-small t-medium t-truncate">{s.originPort} → {s.destPort}</span>
                        <span className="t-caption t-tertiary t-truncate">{s.reference} · {tt(s.goods)}</span>
                      </Link>
                      <span className="t-caption"><Countdown iso={s.eta} /></span>
                      {v.can('shipment:write') && next && (
                        <span className="ls-actions">
                          <Button size="sm" icon="arrow" onClick={() => { actions.advanceShipment(s.id); toast(t('ls.advanced', { ref: s.reference, stage: t(`ship.s.${next}` as 'ship.s.transit') })) }}>{t('ship.advance')}</Button>
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Section>

          {v.can('finance:global') && (
            <Section title={t('pay.outstanding')}>
              <div className="adm-kpi__row">
                <span className="adm-kpi__value t-num" style={{ color: k.outstanding > 0 ? 'var(--orange)' : undefined }}>{formatMoney(k.outstanding)}</span>
              </div>
              <span className="adm-kpi__hint">{t('pay.subtitle')}</span>
            </Section>
          )}

          <Section title={t('dash.recent')} flush>
            {v.events.length === 0 ? <Vide icon="clock" title={t('dash.noAttention')} /> : (
              <div className="list">
                {v.events.slice(0, 8).map((e) => (
                  <div key={e.id} className="list__row">
                    <Icon name={e.automated ? 'automations' : 'check'} size={16} className="t-tertiary" />
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <span className="t-small t-truncate">{tt(e.detail)}</span>
                      <span className="t-caption t-tertiary"><Ago iso={e.at} /></span>
                    </span>
                    {e.automated && <Pill tone="violet">{t('msg.automated')}</Pill>}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </>
  )
}
