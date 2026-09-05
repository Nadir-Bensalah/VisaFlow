import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Card, Empty, Pill } from '@/components/ui'
import { Countdown, PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { clientName } from '@/lib/derive'

export function Tasks() {
  const { db, actions, currentUserId } = useStore()
  const { t, tt } = useI18n()

  const mine = db.tasks.filter((x) => x.assigneeId === currentUserId)
  const others = db.tasks.filter((x) => x.assigneeId !== currentUserId)

  const render = (list: typeof db.tasks) => (
    <div className="list">
      {list.map((task) => {
        const kase = db.cases.find((c) => c.id === task.caseId)
        return (
          <div key={task.id} className="list__row">
            <button
              type="button"
              aria-label={t('action.confirm')}
              onClick={() => actions.toggleTask(task.id)}
              className="btn btn--icon"
              style={{ border: `1.5px solid ${task.done ? 'var(--green)' : 'var(--hairline-strong)'}`, background: task.done ? 'var(--green)' : 'transparent', color: task.done ? 'var(--text-white)' : 'transparent', width: 22, height: 22 }}
            >
              <Icon name="check" size={12} />
            </button>
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className={`t-small ${task.done ? 't-tertiary' : 't-medium'}`} style={{ textDecoration: task.done ? 'line-through' : undefined }}>
                {tt(task.title)}
              </span>
              {kase && (
                <Link to={`/dossiers/${kase.id}`} className="t-caption t-tertiary">
                  {kase.reference} · {clientName(db, kase.clientId)}
                </Link>
              )}
            </span>
            {task.automated && <Pill tone="violet">{t('msg.automated')}</Pill>}
            <span className="t-caption"><Countdown iso={task.dueAt} /></span>
          </div>
        )
      })}
    </div>
  )

  return (
    <>
      <PageHead title={t('nav.workspace')} subtitle={t('auto.subtitle')} />
      <div className="col gap-6">
        <Card title={t('cases.mine')} flush>
          {mine.length === 0 ? <Empty title={t('dash.noAttention')} /> : render(mine)}
        </Card>
        {others.length > 0 && (
          <Card title={t('misc.agent')} flush>{render(others)}</Card>
        )}
      </div>
    </>
  )
}
