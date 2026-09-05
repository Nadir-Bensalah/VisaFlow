import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Card, Empty, Pill } from '@/components/ui'
import { Ago, CaseRow, Countdown, PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { ACTIVE_STAGES, STAGE_TONE, kpis, urgency } from '@/lib/derive'

export function Dashboard() {
  const { db } = useStore()
  const v = useVisible()
  const { t, tt, formatMoney, formatNumber } = useI18n()
  const k = kpis(db, v)
  const user = v.user

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

  const byStage = ACTIVE_STAGES.map((stage) => ({
    stage,
    count: v.cases.filter((c) => c.status === 'ouvert' && c.stage === stage).length,
  }))
  const maxStage = Math.max(...byStage.map((s) => s.count), 1)

  const stats = [
    { label: t('dash.open'), value: formatNumber(k.open), hint: t('dash.thisWeek'), to: '/dossiers' },
    { label: t('dash.missing'), value: formatNumber(k.missingDocs), hint: t('docs.title'), to: '/pieces', tone: k.missingDocs > 0 ? 'var(--orange)' : undefined },
    { label: t('dash.late'), value: formatNumber(k.late), hint: t('cases.late'), to: '/dossiers?filtre=retard', tone: k.late > 0 ? 'var(--red)' : undefined },
    ...(v.can('finance:global')
      ? [{ label: t('dash.revenue'), value: formatMoney(k.collected), hint: t('pay.collected'), to: '/paiements' }]
      : [{ label: t('today.appointments'), value: formatNumber(k.todayAppointments), hint: t('today.title'), to: '/rendez-vous' }]),
  ]

  return (
    <>
      <PageHead title={t('dash.title', { name: user.name.split(' ')[0] })} subtitle={t('dash.subtitle')} />

      <div className="grid grid--4" style={{ marginBottom: 'var(--sp-5)' }}>
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className="card card--link">
            <div className="stat">
              <div className="stat__label">{s.label}</div>
              <div className="stat__value" style={{ color: s.tone }}>{s.value}</div>
              <div className="stat__hint">{s.hint}</div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid--main">
        <div className="stack">
          <Card
            title={t('dash.needsAttention')}
            action={<Link to="/dossiers" className="t-small">{t('action.seeAll')}</Link>}
            flush
          >
            {attention.length === 0 ? (
              <Empty title={t('dash.noAttention')} />
            ) : (
              <>
                <p className="t-caption t-tertiary" style={{ padding: 'var(--sp-3) var(--sp-6) 0' }}>
                  {t('dash.needsAttentionHint')}
                </p>
                <div className="list">
                  {attention.map(({ kase }) => (
                    <CaseRow key={kase.id} kase={kase} showUrgency />
                  ))}
                </div>
              </>
            )}
          </Card>

          <Card title={t('dash.byStage')}>
            <div className="col gap-3">
              {byStage.map((s) => (
                <Link key={s.stage} to="/pipeline" className="row" style={{ color: 'inherit' }}>
                  <span className="t-small" style={{ width: 140, flex: '0 0 auto' }}>{t(`stage.${s.stage}` as 'stage.nouveau')}</span>
                  <span className="grow" style={{ background: 'var(--bg-hover)', borderRadius: 'var(--radius-pill)', height: 8 }}>
                    <span
                      style={{
                        display: 'block',
                        height: 8,
                        width: `${Math.max((s.count / maxStage) * 100, 3)}%`,
                        borderRadius: 'var(--radius-pill)',
                        background: `var(--${STAGE_TONE[s.stage] === 'gray' ? 'text-tertiary' : STAGE_TONE[s.stage]})`,
                      }}
                    />
                  </span>
                  <span className="t-small t-num t-tertiary" style={{ width: 28, textAlign: 'end' }}>{s.count}</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title={t('dash.todayAppts')} flush>
            {v.appointments.filter((a) => a.status === 'prevu').length === 0 ? (
              <Empty title={t('appts.none')} />
            ) : (
              <div className="list">
                {v.appointments
                  .filter((a) => a.status === 'prevu')
                  .sort((a, b) => a.at.localeCompare(b.at))
                  .slice(0, 5)
                  .map((a) => {
                    const kase = v.cases.find((c) => c.id === a.caseId)
                    const client = db.clients.find((c) => c.id === kase?.clientId)
                    return (
                      <Link key={a.id} to={`/dossiers/${a.caseId}`} className="list__row">
                        <Icon name="appointments" size={18} className="t-tertiary" />
                        <span className="col grow" style={{ minWidth: 0 }}>
                          <span className="t-small t-medium t-truncate">{client?.firstName} {client?.lastName}</span>
                          <span className="t-caption t-tertiary t-truncate">{t(`appt.${a.kind}` as 'appt.agence')}</span>
                        </span>
                        <span className="t-caption t-num t-tertiary">
                          {new Date(a.at).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                          {' · '}
                          {new Date(a.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </Link>
                    )
                  })}
              </div>
            )}
          </Card>

          <Card title={t('ship.title')} action={<Link to="/cargaisons" className="t-small">{t('action.seeAll')}</Link>} flush>
            {watchedShipments.length === 0 ? (
              <Empty title={t('ship.none')} />
            ) : (
              <div className="list">
                {watchedShipments.map((s) => (
                  <Link key={s.id} to={`/cargaisons/${s.id}`} className="list__row">
                    <Icon name="ship" size={18} className="t-tertiary" />
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <span className="t-small t-medium t-truncate">{s.originPort} → {s.destPort}</span>
                      <span className="t-caption t-tertiary t-truncate">{s.reference} · {tt(s.goods)}</span>
                    </span>
                    <span className="t-caption"><Countdown iso={s.eta} /></span>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {v.can('finance:global') && (
            <Card title={t('pay.outstanding')}>
              <div className="stat" style={{ padding: 0 }}>
                <div className="stat__value">{formatMoney(k.outstanding)}</div>
                <div className="stat__hint">{t('pay.subtitle')}</div>
              </div>
            </Card>
          )}

          <Card title={t('dash.recent')} flush>
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
          </Card>
        </div>
      </div>
    </>
  )
}
