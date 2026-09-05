import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useNow } from '@/data/clock'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Card, Empty, Pill, useToast } from '@/components/ui'
import { Icon, type IconName } from '@/components/Icon'
import { Illustration } from '@/components/Illustration'
import { Ago, Countdown } from '@/components/bits'
import { blockingDocs, clientName, daysSince, daysUntil, urgency } from '@/lib/derive'

/* L'ecran du matin. Il repond a deux questions, et a rien d'autre :
   qu'est-ce que je dois faire, et qu'est-ce qui va se passer. */

export function Today() {
  const { db, actions } = useStore()
  const now = useNow()
  const v = useVisible()
  const { t, tt, formatDate } = useI18n()
  const toast = useToast()

  const hour = new Date(now).getHours()
  const greeting = hour < 12 ? 'today.morning' : hour < 18 ? 'today.afternoon' : 'today.evening'
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999)
  const inDay = (iso?: string) => {
    if (!iso) return false
    const d = new Date(iso).getTime()
    return d >= startOfDay.getTime() && d <= endOfDay.getTime()
  }

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

  const appointments = v.appointments
    .filter((a) => a.status === 'prevu' && inDay(a.at))
    .sort((a, b) => a.at.localeCompare(b.at))

  const departures = v.cases.filter((c) => c.status === 'ouvert' && daysUntil(c.travelDate) >= 0 && daysUntil(c.travelDate) <= 2)

  const arrivals = v.shipments.filter((s) => s.status === 'en_cours' && daysUntil(s.eta) >= 0 && daysUntil(s.eta) <= 3)

  const passports = v.clients
    .filter((c) => daysUntil(c.passportExpiry) < 180)
    .filter((c) => v.cases.some((k) => k.clientId === c.id && k.status === 'ouvert'))
    .slice(0, 4)

  const doneToday = v.events.filter((e) => inDay(e.at))

  const nothing =
    tasks.length === 0 && toChase.length === 0 && toAdvance.length === 0 &&
    toAnswer.length === 0 && appointments.length === 0 && departures.length === 0 && arrivals.length === 0

  const counters: { label: string; value: number; icon: IconName; tone?: string }[] = [
    { label: t('today.appointments'), value: appointments.length, icon: 'appointments' },
    { label: t('today.remind'), value: toChase.length, icon: 'bell', tone: toChase.length ? 'var(--orange)' : undefined },
    { label: t('today.answer'), value: toAnswer.length, icon: 'messages', tone: toAnswer.length ? 'var(--blue)' : undefined },
    { label: t('today.arriving'), value: arrivals.length, icon: 'ship' },
  ]

  return (
    <>
      <header className="today__hero">
        <div className="col gap-2 grow">
          <span className="t-caption t-tertiary">{formatDate(new Date(now).toISOString(), { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h1>{t(greeting as 'today.morning', { name: v.user.name.split(' ')[0] })}</h1>
          <p className="t-secondary">{t('today.subtitle')}</p>
        </div>
        <Illustration scene={nothing ? 'termine' : 'journee'} />
      </header>

      <div className="today__counters">
        {counters.map((c) => (
          <div key={c.label} className="today__counter">
            <Icon name={c.icon} size={17} className="t-tertiary" />
            <span className="today__counter-value t-num" style={{ color: c.tone }}>{c.value}</span>
            <span className="t-caption t-tertiary">{c.label}</span>
          </div>
        ))}
      </div>

      {nothing ? (
        <Card>
          <Empty title={t('today.nothing')} hint={t('today.nothingHint')} />
        </Card>
      ) : (
        <div className="grid grid--2">
          {/* ------------------------- A faire ------------------------- */}
          <div className="col gap-5">
            <h2 className="today__section">{t('today.toDo')}</h2>

            {tasks.length > 0 && (
              <Card title={t('today.tasks')} flush>
                <div className="list">
                  {tasks.map((task) => {
                    const kase = v.cases.find((c) => c.id === task.caseId)
                    return (
                      <div key={task.id} className="list__row">
                        <button
                          type="button"
                          className="today__check"
                          aria-label={t('action.confirm')}
                          onClick={() => { actions.toggleTask(task.id); toast(t('crud.updated')) }}
                        >
                          <Icon name="check" size={12} />
                        </button>
                        <span className="col grow" style={{ minWidth: 0 }}>
                          <span className="t-small t-medium">{tt(task.title)}</span>
                          {kase && <Link to={`/dossiers/${kase.id}`} className="t-caption t-tertiary">{kase.reference} · {clientName(db, kase.clientId)}</Link>}
                        </span>
                        {daysUntil(task.dueAt) < 0 && <Pill tone="red">{t('today.late')}</Pill>}
                      </div>
                    )
                  })}
                </div>
              </Card>
            )}

            {toChase.length > 0 && (
              <Card
                title={t('today.remind')}
                action={
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => { toChase.forEach((x) => actions.remindDoc(x.doc.id)); toast(t('msg.sent')) }}
                  >
                    {t('docs.remindAll')}
                  </button>
                }
                flush
              >
                <div className="list">
                  {toChase.map(({ doc, kase }) => (
                    <Link key={doc.id} to={`/dossiers/${doc.caseId}`} className="list__row">
                      <Icon name="documents" size={18} className="t-tertiary" />
                      <span className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-small t-medium t-truncate">{tt(doc.label)}</span>
                        <span className="t-caption t-tertiary t-truncate">
                          {kase ? clientName(db, kase.clientId) : ''} · <Ago iso={doc.lastReminderAt ?? doc.requestedAt} />
                        </span>
                      </span>
                      <Pill tone="orange">{doc.reminders || 0}</Pill>
                    </Link>
                  ))}
                </div>
              </Card>
            )}

            {toAnswer.length > 0 && (
              <Card title={t('today.answer')} flush>
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
              </Card>
            )}

            {toAdvance.length > 0 && (
              <Card title={t('today.advance')} flush>
                <div className="list">
                  {toAdvance.map(({ kase }) => (
                    <Link key={kase.id} to={`/dossiers/${kase.id}`} className="list__row">
                      <Icon name="cases" size={18} className="t-tertiary" />
                      <span className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-small t-medium t-truncate">{clientName(db, kase.clientId)}</span>
                        <span className="t-caption t-tertiary">{kase.reference} · {t(`stage.${kase.stage}` as 'stage.nouveau')}</span>
                      </span>
                      <Icon name="arrow" size={16} className="t-tertiary" />
                    </Link>
                  ))}
                </div>
              </Card>
            )}
          </div>

          {/* --------------------- Ce qui se passe --------------------- */}
          <div className="col gap-5">
            <h2 className="today__section">{t('today.willHappen')}</h2>

            <Card title={t('today.agenda')} flush>
              {appointments.length === 0 ? (
                <div className="empty t-small">{t('today.freeSlot')}</div>
              ) : (
                <div className="list">
                  {appointments.map((a) => {
                    const kase = v.cases.find((c) => c.id === a.caseId)
                    const past = new Date(a.at).getTime() < now
                    return (
                      <Link key={a.id} to={`/dossiers/${a.caseId}`} className="list__row" style={{ opacity: past ? 0.55 : 1 }}>
                        <span className="today__hour t-num">
                          {new Date(a.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="col grow" style={{ minWidth: 0 }}>
                          <span className="t-small t-medium t-truncate">{kase ? clientName(db, kase.clientId) : ''}</span>
                          <span className="t-caption t-tertiary t-truncate">{t(`appt.${a.kind}` as 'appt.agence')} · {a.location}</span>
                        </span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </Card>

            {departures.length > 0 && (
              <Card title={t('today.leaving')} flush>
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
              </Card>
            )}

            {arrivals.length > 0 && (
              <Card title={t('today.arriving')} flush>
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
              </Card>
            )}

            {passports.length > 0 && (
              <Card title={t('today.passports')} flush>
                <div className="list">
                  {passports.map((c) => (
                    <Link key={c.id} to={`/clients/${c.id}`} className="list__row">
                      <Icon name="passport" size={18} className="t-tertiary" />
                      <span className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-small t-medium t-truncate">{c.firstName} {c.lastName}</span>
                        <span className="t-caption t-tertiary">{formatDate(c.passportExpiry)}</span>
                      </span>
                      <Pill tone="orange" dot>{t('clients.passportSoon')}</Pill>
                    </Link>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {doneToday.length > 0 && (
        <Card title={t('today.done')} action={<span className="t-caption t-tertiary">{t('today.doneCount', { n: doneToday.length })}</span>} flush className="today__done">
          <div className="list">
            {doneToday.slice(0, 6).map((e) => (
              <div key={e.id} className="list__row">
                <Icon name={e.automated ? 'automations' : 'check'} size={16} className="t-tertiary" />
                <span className="t-small grow t-truncate">{tt(e.detail)}</span>
                <span className="t-caption t-tertiary"><Ago iso={e.at} /></span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}
