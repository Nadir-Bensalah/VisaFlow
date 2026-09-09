import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useNow } from '@/data/clock'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Field, IconButton, Input, Modal, Pill, Segmented, Select, useToast } from '@/components/ui'
import { Countdown } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { Kpi, KpiGrid, PageHeader, Section, Table, Toolbar, Vide } from '@/components/page'
import { clientName } from '@/lib/derive'
import type { Appointment, AppointmentKind } from '@/data/types'

/* Les rendez-vous. Trois chiffres : aujourd'hui, cette semaine, et les
   dossiers qui attendent encore un créneau (ceux-là se règlent sur l'écran
   des créneaux). La ligne porte ses deux gestes : confirmer que c'est fait,
   reporter à une autre date. */

type Filter = 'avenir' | 'aujourdhui' | 'semaine' | 'passes'
const FILTERS: Filter[] = ['avenir', 'aujourdhui', 'semaine', 'passes']

const KIND_TONE: Record<AppointmentKind, 'violet' | 'green' | 'blue' | 'orange'> = {
  consulat: 'violet', retrait: 'green', agence: 'blue', biometrie: 'orange',
}
const STATUS_TONE: Record<Appointment['status'], 'blue' | 'green' | 'red' | 'orange'> = {
  prevu: 'blue', fait: 'green', manque: 'red', reporte: 'orange',
}

/** Du lundi 0 h au dimanche 23 h 59 de la semaine en cours. */
function weekBounds(now: number): [number, number] {
  const d = new Date(now); d.setHours(0, 0, 0, 0)
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  const start = d.getTime()
  return [start, start + 7 * 86400000 - 1]
}

export function Appointments() {
  const { db, actions } = useStore()
  const now = useNow()
  const v = useVisible()
  const { t, formatDate, formatNumber } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [postponing, setPostponing] = useState<Appointment | null>(null)
  const [params, setParams] = useSearchParams()
  const demande = params.get('filtre')
  const filter: Filter = FILTERS.includes(demande as Filter) ? (demande as Filter) : 'avenir'
  const setFilter = (f: Filter) => setParams(f === 'avenir' ? {} : { filtre: f }, { replace: true })

  const canWrite = v.can('case:write')

  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999)
  const [weekStart, weekEnd] = weekBounds(now)
  const at = (a: Appointment) => new Date(a.at).getTime()
  const isToday = (a: Appointment) => at(a) >= startOfDay.getTime() && at(a) <= endOfDay.getTime()
  const isWeek = (a: Appointment) => at(a) >= weekStart && at(a) <= weekEnd
  // Un rendez-vous de l'heure écoulée reste « à venir » : on est peut-être dedans.
  const isUpcoming = (a: Appointment) => at(a) >= now - 3600000

  const planned = v.appointments.filter((a) => a.status === 'prevu')
  const today = planned.filter(isToday)
  const week = planned.filter(isWeek)
  /* Sans créneau : à l'étape rendez-vous, et rien de prévu devant. */
  const withSlot = new Set(planned.filter(isUpcoming).map((a) => a.caseId))
  const noSlot = v.cases.filter((c) => c.status === 'ouvert' && c.stage === 'rendez_vous' && !withSlot.has(c.id))

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = v.appointments
      .filter((a) =>
        filter === 'aujourdhui' ? isToday(a)
        : filter === 'semaine' ? isWeek(a)
        : filter === 'passes' ? !isUpcoming(a)
        : isUpcoming(a),
      )
      .filter((a) => {
        if (!q) return true
        const kase = v.cases.find((c) => c.id === a.caseId)
        const name = kase ? clientName(db, kase.clientId) : ''
        return `${name} ${a.location}`.toLowerCase().includes(q)
      })
    return list.sort((a, b) => (filter === 'passes' ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, v, filter, query, now])

  const confirm = (a: Appointment) => {
    actions.updateAppointment(a.id, { status: 'fait' })
    toast(t('appt.fait'))
  }

  return (
    <>
      <PageHeader
        kicker={t('ls.famSuivi')}
        title={t('appts.title')}
        subtitle={t('appts.subtitle')}
        actions={canWrite ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('appts.newAppt')}</Button> : undefined}
      />

      <KpiGrid>
        <Kpi label={t('ls.kToday')} value={formatNumber(today.length)} tone={today.length ? 'blue' : 'gray'} icon="today" to="/rendez-vous?filtre=aujourdhui" />
        <Kpi label={t('ls.kWeek')} value={formatNumber(week.length)} tone="blue" icon="appointments" to="/rendez-vous?filtre=semaine" />
        <Kpi label={t('ls.kNoSlot')} value={formatNumber(noSlot.length)} tone={noSlot.length ? 'orange' : 'gray'} icon="clock" hint={t('ls.noSlotHint')} to="/creneaux" />
      </KpiGrid>

      <Section flush>
        <Toolbar right={<span className="ls-count" role="status" aria-live="polite">{rows.length === 1 ? t('ls.oneRow') : t('ls.rows', { n: rows.length })}</span>}>
          <Input className="ls-search" aria-label={t('action.search')} placeholder={t('ls.searchAppts')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Segmented value={filter} onChange={setFilter} label={t('action.filter')} options={[
            { value: 'avenir', label: t('appts.upcoming') },
            { value: 'aujourdhui', label: t('ls.fToday') },
            { value: 'semaine', label: t('ls.fWeek') },
            { value: 'passes', label: t('appts.past') },
          ]} />
        </Toolbar>

        {rows.length === 0 ? (
          <Vide icon="appointments" title={t('appts.none')} hint={v.appointments.length ? t('ls.noMatchHint') : undefined} />
        ) : (
          <Table className="ls-table">
            <thead>
              <tr>
                <th>{t('ls.colWhen')}</th>
                <th>{t('cases.client')}</th>
                <th>{t('ls.colKind')}</th>
                <th className="col-optional">{t('ls.colPlace')}</th>
                <th className="col-optional">{t('ls.colCase')}</th>
                <th>{filter === 'passes' ? t('docs.state') : t('ls.colIn')}</th>
                <th className="actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const kase = v.cases.find((c) => c.id === a.caseId)
                const target = kase ? `/dossiers/${kase.id}` : a.shipmentId ? `/cargaisons/${a.shipmentId}` : ''
                const past = at(a) < now
                return (
                  <tr
                    key={a.id}
                    className={`adm-row--click ${a.status === 'fait' || a.status === 'manque' ? 'adm-row--off' : ''}`}
                    tabIndex={0}
                    onClick={() => { if (target) navigate(target) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && target) navigate(target) }}
                  >
                    <td>
                      <div className="adm-cell-main">
                        <span className="t-num">{formatDate(a.at, { weekday: 'short', day: '2-digit', month: 'short' })}</span>
                        <span className="t-caption t-num">{new Date(a.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </td>
                    <td className="t-medium">{kase ? clientName(db, kase.clientId) : '·'}</td>
                    <td><Pill tone={KIND_TONE[a.kind]}>{t(`appt.${a.kind}` as 'appt.agence')}</Pill></td>
                    <td className="t-secondary col-optional">{a.location}</td>
                    <td className="ls-mono col-optional">{kase?.reference ?? '·'}</td>
                    <td>
                      {filter === 'passes' || a.status !== 'prevu'
                        ? <Pill tone={STATUS_TONE[a.status]} dot>{t(`appt.${a.status}` as 'appt.prevu')}</Pill>
                        : <Countdown iso={a.at} />}
                    </td>
                    <td className="actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <span className="ls-actions">
                        {canWrite && a.status === 'prevu' && <Button size="sm" icon="check" onClick={() => confirm(a)}>{t('action.confirm')}</Button>}
                        {canWrite && a.status === 'prevu' && !past && <IconButton icon="clock" label={t('ls.postpone')} onClick={() => setPostponing(a)} />}
                        {target && <Link to={target} className="btn btn--icon" aria-label={t('action.open')} title={t('action.open')}><Icon name="chevron" size={18} /></Link>}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Section>

      {creating && <NewAppointment onClose={() => setCreating(false)} />}
      {postponing && <Postpone appointment={postponing} onClose={() => setPostponing(null)} />}
    </>
  )

  /** Reporter : une nouvelle date, le rendez-vous reste prévu. */
  function Postpone({ appointment, onClose }: { appointment: Appointment; onClose: () => void }) {
    const [when, setWhen] = useState('')
    return (
      <Modal title={t('ls.postponeTitle')} onClose={onClose} footer={<>
        <Button onClick={onClose}>{t('action.cancel')}</Button>
        <Button variant="primary" disabled={!when} onClick={() => {
          actions.updateAppointment(appointment.id, { at: new Date(when).toISOString(), status: 'prevu' })
          onClose(); toast(t('ls.postponed'))
        }}>{t('action.confirm')}</Button>
      </>}>
        <Field label={t('ls.newDate')}>
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} autoFocus />
        </Field>
      </Modal>
    )
  }

  function NewAppointment({ onClose }: { onClose: () => void }) {
    const open = v.cases.filter((c) => c.status === 'ouvert')
    const [caseId, setCaseId] = useState(open[0]?.id ?? '')
    const [kind, setKind] = useState<AppointmentKind>('agence')
    const [when, setWhen] = useState('')
    const [duration, setDuration] = useState(30)
    const [place, setPlace] = useState('')

    return (
      <Modal
        title={t('appts.newAppt')}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>{t('action.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!caseId || !when}
              onClick={() => {
                const kase = v.cases.find((c) => c.id === caseId)
                actions.addAppointment({
                  caseId,
                  kind,
                  at: new Date(when).toISOString(),
                  durationMin: duration,
                  location: place || db.agency.offices.find((o) => o.id === kase?.officeId)?.address || '',
                  status: 'prevu',
                })
                onClose()
                toast(t('crud.created'))
              }}
            >
              {t('action.confirm')}
            </Button>
          </>
        }
      >
        <div className="col gap-4">
          <Field label={t('cases.title')}>
            <Select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              {open.map((c) => (
                <option key={c.id} value={c.id}>{c.reference} · {clientName(db, c.clientId)}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid--2">
            <Field label={t('ls.colKind')}>
              <Select value={kind} onChange={(e) => setKind(e.target.value as AppointmentKind)}>
                {(['agence', 'consulat', 'biometrie', 'retrait'] as AppointmentKind[]).map((x) => (
                  <option key={x} value={x}>{t(`appt.${x}` as 'appt.agence')}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('appts.at')}>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid--2">
            <Field label={t('appts.where')}>
              <Input value={place} onChange={(e) => setPlace(e.target.value)} />
            </Field>
            <Field label={t('reports.days', { n: 0 })}>
              <Input type="number" min={15} step={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </Field>
          </div>
        </div>
      </Modal>
    )
  }
}
