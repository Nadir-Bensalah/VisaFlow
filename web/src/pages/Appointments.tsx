import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Field, IconButton, Input, Modal, Pill, Segmented, Select, useToast } from '@/components/ui'
import { Countdown, PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { clientName } from '@/lib/derive'
import type { AppointmentKind } from '@/data/types'

export function Appointments() {
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, formatDate } = useI18n()
  const toast = useToast()
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming')
  const [creating, setCreating] = useState(false)

  const now = Date.now()
  const list = v.appointments
    .filter((a) => (view === 'upcoming' ? new Date(a.at).getTime() >= now - 3600000 : new Date(a.at).getTime() < now))
    .sort((a, b) => (view === 'upcoming' ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)))

  // Regroupement par jour, pour que la lecture suive la journee de travail.
  const groups = list.reduce<Record<string, typeof list>>((acc, a) => {
    const key = a.at.slice(0, 10)
    ;(acc[key] ??= []).push(a)
    return acc
  }, {})

  return (
    <>
      <PageHead
        title={t('appts.title')}
        subtitle={t('appts.subtitle')}
        action={
          v.can('case:write')
            ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('appts.newAppt')}</Button>
            : undefined
        }
      />

      <div style={{ marginBottom: 'var(--sp-5)' }}>
        <Segmented
          value={view}
          onChange={setView}
          options={[{ value: 'upcoming', label: t('appts.upcoming') }, { value: 'past', label: t('appts.past') }]}
        />
      </div>

      {list.length === 0 ? (
        <Card><Empty title={t('appts.none')} /></Card>
      ) : (
        <div className="col gap-5">
          {Object.entries(groups).map(([day, items]) => (
            <Card key={day} title={formatDate(day, { weekday: 'long', day: '2-digit', month: 'long' })} flush>
              <div className="list">
                {items.map((a) => {
                  const kase = v.cases.find((c) => c.id === a.caseId)
                  return (
                    <Link key={a.id} to={`/dossiers/${a.caseId}`} className="list__row">
                      <span className="t-num t-medium" style={{ width: 56 }}>
                        {new Date(a.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <Icon name="appointments" size={18} className="t-tertiary" />
                      <span className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-medium t-small t-truncate">{kase ? clientName(db, kase.clientId) : '—'}</span>
                        <span className="t-caption t-tertiary t-truncate">{a.location}</span>
                      </span>
                      <Pill tone={a.kind === 'consulat' ? 'violet' : a.kind === 'retrait' ? 'green' : 'blue'}>
                        {t(`appt.${a.kind}` as 'appt.agence')}
                      </Pill>
                      {view === 'upcoming' && <span className="t-caption"><Countdown iso={a.at} /></span>}
                      {view === 'upcoming' && v.can('case:write') && (
                        <IconButton
                          icon="check"
                          label={t('appt.fait')}
                          onClick={(e) => {
                            e.preventDefault()
                            actions.updateAppointment(a.id, { status: 'fait' })
                            toast(t('appt.fait'))
                          }}
                        />
                      )}
                    </Link>
                  )
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating && <NewAppointment onClose={() => setCreating(false)} />}
    </>
  )

  function NewAppointment({ onClose }: { onClose: () => void }) {
    const open = v.cases.filter((c) => c.status === 'ouvert')
    const [caseId, setCaseId] = useState(open[0]?.id ?? '')
    const [kind, setKind] = useState<AppointmentKind>('agence')
    const [at, setAt] = useState('')
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
              disabled={!caseId || !at}
              onClick={() => {
                const kase = v.cases.find((c) => c.id === caseId)
                actions.addAppointment({
                  caseId,
                  kind,
                  at: new Date(at).toISOString(),
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
            <Field label={t('appts.title')}>
              <Select value={kind} onChange={(e) => setKind(e.target.value as AppointmentKind)}>
                {(['agence', 'consulat', 'biometrie', 'retrait'] as AppointmentKind[]).map((x) => (
                  <option key={x} value={x}>{t(`appt.${x}` as 'appt.agence')}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('appts.at')}>
              <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
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
