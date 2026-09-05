import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Card, Empty, Pill, Segmented } from '@/components/ui'
import { Countdown, PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { clientName } from '@/lib/derive'

export function Appointments() {
  const { db } = useStore()
  const { t, formatDate } = useI18n()
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming')

  const now = Date.now()
  const list = db.appointments
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
      <PageHead title={t('appts.title')} subtitle={t('appts.subtitle')} />

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
                  const kase = db.cases.find((c) => c.id === a.caseId)
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
                    </Link>
                  )
                })}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
