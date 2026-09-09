import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useNow } from '@/data/clock'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Pill, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { OnboardingCard } from '@/components/OnboardingCard'
import { WorklistCard } from '@/components/WorklistCard'
import { Ago, Countdown } from '@/components/bits'
import { Kpi, KpiGrid, PageHeader, Section, Vide } from '@/components/page'
import { NewCase } from '@/pages/Cases'
import { STAGES, blockingDocs, clientName, daysSince, daysUntil, urgency } from '@/lib/derive'
import type { VisaCase } from '@/data/types'

/* L'ecran du matin. Il repond a deux questions, et a rien d'autre :
   qu'est-ce que je dois faire, et qu'est-ce qui va se passer.

   La colonne de droite ne reste jamais vide : sans rendez-vous aujourd'hui,
   elle montre les prochains sur sept jours, puis les départs sous sept jours,
   puis les passeports qui expirent. */

export function Today() {
  const { db, actions } = useStore()
  const now = useNow()
  const v = useVisible()
  const { t, tt, formatDate, formatMoney, formatNumber } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  const hour = new Date(now).getHours()
  const greeting = hour < 12 ? 'today.morning' : hour < 18 ? 'today.afternoon' : 'today.evening'
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999)
  const inDay = (iso?: string) => {
    if (!iso) return false
    const d = new Date(iso).getTime()
    return d >= startOfDay.getTime() && d <= endOfDay.getTime()
  }
  const canWrite = v.can('case:write')

  const mine = v.cases.filter((c) => c.status === 'ouvert' && c.assigneeId === v.user.id)
  const pool = mine.length > 0 ? mine : v.cases.filter((c) => c.status === 'ouvert')

  /* --------------------------- Ce qu'il y a a faire --------------------- */

  const tasks = v.tasks.filter((task) => !task.done && daysUntil(task.dueAt) <= 0)

  const toChase = v.documents
    .filter((d) => d.state === 'demandee' && d.required && daysSince(d.lastReminderAt ?? d.requestedAt) >= 3)
    .map((d) => ({ doc: d, kase: v.cases.find((c) => c.id === d.caseId) }))
    .filter((x) => x.kase?.status === 'ouvert')
    .slice(0, 6)

  const toAdvance = pool
    .map((c) => ({ kase: c, u: urgency(db, c) }))
    .filter((x) => x.u.score >= 40 && blockingDocs(db, x.kase.id).length === 0)
    .sort((a, b) => b.u.score - a.u.score)
    .slice(0, 5)

  const toAnswer = v.messages
    .filter((m) => m.direction === 'entrant' && daysSince(m.at) <= 3)
    .filter((m) => {
      const later = v.messages.filter((x) => x.caseId === m.caseId && x.at > m.at && x.direction === 'sortant')
      return later.length === 0
    })
    .slice(0, 5)

  /* --------------------------- Ce qui va se passer ---------------------- */

  const planned = v.appointments.filter((a) => a.status === 'prevu').sort((a, b) => a.at.localeCompare(b.at))
  const appointments = planned.filter((a) => inDay(a.at))
  // Sans rendez-vous aujourd'hui, la colonne montre les sept prochains jours.
  const upcoming = appointments.length === 0
    ? planned.filter((a) => new Date(a.at).getTime() > endOfDay.getTime() && daysUntil(a.at) <= 7).slice(0, 6)
    : []
  const horizon = appointments.length === 0 ? 7 : 2
  const departures = v.cases.filter((c) => c.status === 'ouvert' && daysUntil(c.travelDate) >= 0 && daysUntil(c.travelDate) <= horizon)
  const arrivals = v.shipments.filter((s) => s.status === 'en_cours' && daysUntil(s.eta) >= 0 && daysUntil(s.eta) <= 7)

  const passports = v.clients
    .filter((c) => daysUntil(c.passportExpiry) < 180)
    .filter((c) => v.cases.some((k) => k.clientId === c.id && k.status === 'ouvert'))
    .slice(0, 4)

  const doneToday = v.events.filter((e) => inDay(e.at))

  // La caisse du jour : ce que la personne a encaissé depuis ce matin.
  // Le total de l'agence reste à la direction, celui-ci appartient au comptoir.
  const cashed = v.payments.filter((p) => p.state === 'regle' && inDay(p.at))
  const cashedTotal = cashed.reduce((sum, p) => sum + p.amount, 0)
  const byMethod = cashed.reduce<Record<string, number>>((acc, p) => {
    const key = p.method ?? 'especes'
    acc[key] = (acc[key] ?? 0) + p.amount
    return acc
  }, {})

  const nothing =
    tasks.length === 0 && toChase.length === 0 && toAdvance.length === 0 && toAnswer.length === 0 &&
    appointments.length === 0 && upcoming.length === 0 && departures.length === 0 && arrivals.length === 0 &&
    passports.length === 0 && cashed.length === 0

  const avancer = (kase: VisaCase) => {
    const next = STAGES[STAGES.indexOf(kase.stage) + 1]
    if (!next) return
    actions.advance(kase.id)
    toast(t('ls.advanced', { ref: kase.reference, stage: t(`stage.${next}` as 'stage.nouveau') }))
  }

  const dateLabel = formatDate(new Date(now).toISOString(), { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="ls-today">
      <PageHeader
        kicker={dateLabel}
        title={t(greeting as 'today.morning', { name: v.user.name.split(' ')[0] })}
        subtitle={t('today.subtitle')}
        actions={v.can('case:create') ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('cases.newCase')}</Button> : undefined}
      />

      {db.agency.setupDone.length < 5 && !db.agency.setupHidden && (
        <div style={{ marginBottom: 'var(--sp-6)' }}>
          <OnboardingCard />
        </div>
      )}

      <KpiGrid>
        <Kpi label={t('today.appointments')} value={formatNumber(appointments.length)} tone={appointments.length ? 'blue' : 'gray'} icon="appointments" to="/rendez-vous?filtre=aujourdhui" />
        <Kpi label={t('today.remind')} value={formatNumber(toChase.length)} tone={toChase.length ? 'orange' : 'gray'} icon="bell" to="/pieces?filtre=manquantes" />
        <Kpi label={t('today.answer')} value={formatNumber(toAnswer.length)} tone={toAnswer.length ? 'blue' : 'gray'} icon="messages" to="/messages" />
        <Kpi label={t('today.arriving')} value={formatNumber(arrivals.length)} tone={arrivals.length ? 'orange' : 'gray'} icon="ship" hint={t('ls.hint7')} to="/cargaisons?filtre=arrivees" />
      </KpiGrid>

      {/* Ce qui attend mon geste, calculé par le serveur et adapté au poste :
          « mes dossiers » pour un conseiller, « ce qui attend mon geste » pour
          un vérificateur ou un caissier. Absent sans backend. */}
      <WorklistCard />

      {nothing ? (
        <Section><Vide icon="sun" title={t('today.nothing')} hint={t('today.nothingHint')} /></Section>
      ) : (
        <div className="ls-today__grid">
          {/* ------------------------- A faire ------------------------- */}
          <div className="ls-today__col">
            <h2 className="ls-today__section">{t('today.toDo')}</h2>

            {tasks.length > 0 && (
              <Section title={t('today.tasks')} action={<Link to="/taches" className="t-small">{t('action.seeAll')}</Link>} flush>
                <div className="list">
                  {tasks.map((task) => {
                    const kase = v.cases.find((c) => c.id === task.caseId)
                    return (
                      <div key={task.id} className="list__row">
                        <button
                          type="button"
                          className="today__check"
                          aria-label={t('ls.doTask')}
                          onClick={() => { actions.toggleTask(task.id); toast(t('ls.taskDone')) }}
                        >
                          <Icon name="check" size={12} />
                        </button>
                        <span className="col grow" style={{ minWidth: 0 }}>
                          <span className="t-small t-medium">{tt(task.title)}</span>
                          {kase && <Link to={`/dossiers/${kase.id}`} className="t-caption t-tertiary">{kase.reference} · {clientName(db, kase.clientId)}</Link>}
                        </span>
                        {daysUntil(task.dueAt) < 0 && <Pill tone="red">{t('today.late')}</Pill>}
                        <span className="ls-actions">
                          <Button size="sm" icon="check" onClick={() => { actions.toggleTask(task.id); toast(t('ls.taskDone')) }}>{t('ls.doTask')}</Button>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </Section>
            )}

            {toChase.length > 0 && (
              <Section
                title={t('today.remind')}
                action={canWrite
                  ? <Button size="sm" icon="bell" onClick={() => { if (window.confirm(t('today.remindConfirm', { n: toChase.length }))) { toChase.forEach((x) => actions.remindDoc(x.doc.id)); toast(t('ls.remindedN', { n: toChase.length })) } }}>{t('docs.remindAll')}</Button>
                  : <Link to="/pieces" className="t-small">{t('action.seeAll')}</Link>}
                flush
              >
                <div className="list">
                  {toChase.map(({ doc, kase }) => (
                    <div key={doc.id} className="list__row">
                      <Icon name="documents" size={18} className="t-tertiary" />
                      <Link to={`/dossiers/${doc.caseId}`} className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-small t-medium t-truncate">{tt(doc.label)}</span>
                        <span className="t-caption t-tertiary t-truncate">
                          {kase ? clientName(db, kase.clientId) : ''} · <Ago iso={doc.lastReminderAt ?? doc.requestedAt} />
                        </span>
                      </Link>
                      <Pill tone="orange">{doc.reminders || 0}</Pill>
                      {canWrite && (
                        <span className="ls-actions">
                          <Button size="sm" icon="bell" onClick={() => { actions.remindDoc(doc.id); toast(t('msg.sent')) }}>{t('action.remind')}</Button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {toAnswer.length > 0 && (
              <Section title={t('today.answer')} action={<Link to="/messages" className="t-small">{t('action.seeAll')}</Link>} flush>
                <div className="list">
                  {toAnswer.map((m) => {
                    const kase = v.cases.find((c) => c.id === m.caseId)
                    return (
                      <Link key={m.id} to={`/dossiers/${m.caseId}`} className="list__row">
                        <Icon name={m.channel === 'whatsapp' ? 'whatsapp' : 'messages'} size={18} className="t-tertiary" />
                        <span className="col grow" style={{ minWidth: 0 }}>
                          <span className="t-small t-medium t-truncate">{kase ? clientName(db, kase.clientId) : ''}</span>
                          <span className="t-caption t-tertiary t-truncate">{m.body}</span>
                        </span>
                        <span className="t-caption t-tertiary"><Ago iso={m.at} /></span>
                      </Link>
                    )
                  })}
                </div>
              </Section>
            )}

            {toAdvance.length > 0 && (
              <Section title={t('today.advance')} action={<Link to="/pipeline" className="t-small">{t('action.seeAll')}</Link>} flush>
                <div className="list">
                  {toAdvance.map(({ kase }) => (
                    <div key={kase.id} className="list__row">
                      <Icon name="cases" size={18} className="t-tertiary" />
                      <Link to={`/dossiers/${kase.id}`} className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-small t-medium t-truncate">{clientName(db, kase.clientId)}</span>
                        <span className="t-caption t-tertiary">{kase.reference} · {t(`stage.${kase.stage}` as 'stage.nouveau')}</span>
                      </Link>
                      {canWrite && kase.stage !== 'clos' && (
                        <span className="ls-actions">
                          <Button size="sm" icon="arrow" onClick={() => avancer(kase)}>{t('caseDetail.advance')}</Button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>

          {/* --------------------- Ce qui se passe --------------------- */}
          <div className="ls-today__col">
            <h2 className="ls-today__section">{t('today.willHappen')}</h2>

            <Section title={appointments.length > 0 ? t('today.agenda') : t('ls.next7')} action={<Link to="/rendez-vous" className="t-small">{t('action.seeAll')}</Link>} flush>
              {appointments.length === 0 && upcoming.length === 0 ? (
                <Vide icon="appointments" title={t('ls.none7')} />
              ) : (
                <div className="list">
                  {(appointments.length > 0 ? appointments : upcoming).map((a) => {
                    const kase = v.cases.find((c) => c.id === a.caseId)
                    const past = new Date(a.at).getTime() < now
                    const target = kase ? `/dossiers/${kase.id}` : a.shipmentId ? `/cargaisons/${a.shipmentId}` : '/rendez-vous'
                    return (
                      <div key={a.id} className="list__row" style={{ opacity: past ? 0.55 : 1 }}>
                        {appointments.length > 0
                          ? <span className="ls-today__hour">{new Date(a.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                          : <span className="ls-today__day">{formatDate(a.at, { weekday: 'short', day: '2-digit' })}</span>}
                        <Link to={target} className="col grow" style={{ minWidth: 0 }}>
                          <span className="t-small t-medium t-truncate">{kase ? clientName(db, kase.clientId) : t(`appt.${a.kind}` as 'appt.agence')}</span>
                          <span className="t-caption t-tertiary t-truncate">
                            {t(`appt.${a.kind}` as 'appt.agence')} · {a.location}
                            {appointments.length === 0 ? ` · ${new Date(a.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
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

            {departures.length > 0 && (
              <Section title={horizon === 7 ? t('ls.leaving7') : t('today.leaving')} action={<Link to="/dossiers?filtre=departs" className="t-small">{t('action.seeAll')}</Link>} flush>
                <div className="list">
                  {departures.map((c) => (
                    <Link key={c.id} to={`/dossiers/${c.id}`} className="list__row">
                      <Icon name="plane" size={18} className="t-tertiary" />
                      <span className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-small t-medium t-truncate">{clientName(db, c.clientId)}</span>
                        <span className="t-caption t-tertiary">{c.reference} · {t(`stage.${c.stage}` as 'stage.nouveau')}</span>
                      </span>
                      <span className="t-caption"><Countdown iso={c.travelDate} /></span>
                    </Link>
                  ))}
                </div>
              </Section>
            )}

            {arrivals.length > 0 && (
              <Section title={t('today.arriving')} action={<Link to="/cargaisons?filtre=arrivees" className="t-small">{t('action.seeAll')}</Link>} flush>
                <div className="list">
                  {arrivals.map((s) => (
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
              </Section>
            )}

            {v.can('payment:write') && cashed.length > 0 && (
              <Section title={t('pay.myDay')}>
                <div className="col gap-3">
                  <div className="row-between">
                    <span className="t-small t-secondary">{t('pay.collected')}</span>
                    <span className="t-medium t-num">{formatMoney(cashedTotal)}</span>
                  </div>
                  {Object.entries(byMethod).map(([method, amount]) => (
                    <div key={method} className="row-between">
                      <span className="t-small t-secondary">{t(`payment.${method}` as 'payment.especes')}</span>
                      <span className="t-small t-num">{formatMoney(amount)}</span>
                    </div>
                  ))}
                  <span className="t-caption t-tertiary">{t('pay.myDayHint')}</span>
                </div>
              </Section>
            )}

            {passports.length > 0 && (
              <Section title={t('today.passports')} action={<Link to="/clients?filtre=passeport" className="t-small">{t('action.seeAll')}</Link>} flush>
                <div className="list">
                  {passports.map((c) => (
                    <Link key={c.id} to={`/clients/${c.id}`} className="list__row">
                      <Icon name="passport" size={18} className="t-tertiary" />
                      <span className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-small t-medium t-truncate">{c.firstName} {c.lastName}</span>
                        <span className="t-caption t-tertiary">{formatDate(c.passportExpiry)}</span>
                      </span>
                      <Pill tone={daysUntil(c.passportExpiry) < 0 ? 'red' : 'orange'} dot>
                        {daysUntil(c.passportExpiry) < 0 ? t('ls.passportExpired') : t('clients.passportSoon')}
                      </Pill>
                    </Link>
                  ))}
                </div>
              </Section>
            )}
          </div>
        </div>
      )}

      {doneToday.length > 0 && (
        <Section title={t('today.done')} action={<span className="t-caption t-tertiary">{t('today.doneCount', { n: doneToday.length })}</span>} flush className="today__done">
          <div className="list">
            {doneToday.slice(0, 6).map((e) => (
              <div key={e.id} className="list__row">
                <Icon name={e.automated ? 'automations' : 'check'} size={16} className="t-tertiary" />
                <span className="t-small grow t-truncate">{tt(e.detail)}</span>
                <span className="t-caption t-tertiary"><Ago iso={e.at} /></span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {creating && <NewCase onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); navigate(`/dossiers/${id}`) }} />}
    </div>
  )
}
