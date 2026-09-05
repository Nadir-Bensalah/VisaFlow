import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Avatar, Pill, Progress, useToast } from '@/components/ui'
import { Countdown, PageHead, PriorityPill } from '@/components/bits'
import { ACTIVE_STAGES, STAGE_TONE, clientName, progress } from '@/lib/derive'
import type { Stage } from '@/data/types'

export function Pipeline() {
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<Stage | null>(null)

  const drop = (stage: Stage) => {
    if (!dragging) return
    const kase = v.cases.find((c) => c.id === dragging)
    actions.setStage(dragging, stage)
    setDragging(null)
    setOver(null)
    if (kase) toast(`${kase.reference} · ${t(`stage.${stage}` as 'stage.nouveau')}`)
  }

  return (
    <>
      <PageHead title={t('nav.pipeline')} subtitle={t('cases.subtitle')} />

      <div className="kanban">
        {ACTIVE_STAGES.map((stage) => {
          const cases = v.cases.filter((c) => c.status === 'ouvert' && c.stage === stage)
          return (
            <div
              key={stage}
              className={`kanban__col ${over === stage ? 'kanban__col--over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(stage) }}
              onDragLeave={() => setOver((s) => (s === stage ? null : s))}
              onDrop={() => drop(stage)}
            >
              <header className="kanban__col-head">
                <Pill tone={STAGE_TONE[stage]} dot>{t(`stage.${stage}` as 'stage.nouveau')}</Pill>
                <span className="t-caption t-tertiary t-num">{cases.length}</span>
              </header>

              {cases.map((c) => {
                const visa = db.visaTypes.find((v) => v.id === c.visaTypeId)
                const p = progress(db, c.id)
                const name = clientName(db, c.clientId)
                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={() => setDragging(c.id)}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => navigate(`/dossiers/${c.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/dossiers/${c.id}`) }
                    }}
                    className={`kanban__card ${dragging === c.id ? 'kanban__card--dragging' : ''}`}
                  >
                    <div className="row gap-2" style={{ marginBottom: 'var(--sp-2)' }}>
                      <Avatar name={name} size="sm" />
                      <span className="t-small t-medium grow t-truncate">{name}</span>
                      <PriorityPill priority={c.priority} />
                    </div>
                    <div className="t-caption t-tertiary t-truncate" style={{ marginBottom: 'var(--sp-3)' }}>
                      {c.reference} · {tt(visa?.country)} {tt(visa?.label)}
                    </div>
                    <Progress pct={p.pct} tone={p.pct === 100 ? 'green' : p.pct < 40 ? 'orange' : undefined} />
                    <div className="row-between" style={{ marginTop: 'var(--sp-2)' }}>
                      <span className="t-caption t-tertiary t-num">{p.done}/{p.total}</span>
                      <span className="t-caption"><Countdown iso={c.travelDate} /></span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </>
  )
}
