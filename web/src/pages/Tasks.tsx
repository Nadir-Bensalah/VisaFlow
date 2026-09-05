import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Field, Input, Modal, Pill, Select, useToast } from '@/components/ui'
import { Countdown, PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { clientName } from '@/lib/derive'

export function Tasks() {
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt } = useI18n()
  const toast = useToast()
  const [creating, setCreating] = useState(false)

  const mine = v.tasks.filter((x) => x.assigneeId === v.user.id)
  const others = v.tasks.filter((x) => x.assigneeId !== v.user.id)

  const render = (list: typeof db.tasks) => (
    <div className="list">
      {list.map((task) => {
        const kase = v.cases.find((c) => c.id === task.caseId)
        return (
          <div key={task.id} className="list__row">
            <button
              type="button"
              role="checkbox"
              aria-checked={task.done}
              aria-label={tt(task.title)}
              onClick={() => actions.toggleTask(task.id)}
              className="today__check"
              style={{ borderColor: task.done ? 'var(--green)' : undefined, background: task.done ? 'var(--green)' : 'transparent', color: task.done ? 'var(--text-white)' : 'transparent' }}
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
      <PageHead
        title={t('today.tasks')}
        subtitle={t('today.toDo')}
        action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('crud.add')}</Button>}
      />
      <div className="stack">
        <Card title={t('cases.mine')} flush>
          {mine.length === 0 ? <Empty title={t('dash.noAttention')} /> : render(mine)}
        </Card>
        {others.length > 0 && (
          <Card title={t('misc.agent')} flush>{render(others)}</Card>
        )}
      </div>

      {creating && <NewTask onClose={() => setCreating(false)} />}
    </>
  )

  function NewTask({ onClose }: { onClose: () => void }) {
    const [title, setTitle] = useState('')
    const [caseId, setCaseId] = useState('')
    const [assigneeId, setAssigneeId] = useState(v.user.id)
    const [dueAt, setDueAt] = useState(new Date().toISOString().slice(0, 10))

    return (
      <Modal
        title={t('crud.add')}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>{t('action.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!title.trim()}
              onClick={() => {
                actions.createTask({
                  caseId: caseId || undefined,
                  assigneeId,
                  title: { fr: title.trim() },
                  dueAt: new Date(dueAt).toISOString(),
                })
                onClose()
                toast(t('crud.created'))
              }}
            >
              {t('action.save')}
            </Button>
          </>
        }
      >
        <div className="col gap-4">
          <Field label={t('today.tasks')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="grid grid--2">
            <Field label={t('cases.assignee')}>
              <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                {db.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <Field label={t('caseDetail.dueOn')}>
              <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </Field>
          </div>
          <Field label={t('cases.title')}>
            <Select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">—</option>
              {v.cases.filter((c) => c.status === 'ouvert').map((c) => (
                <option key={c.id} value={c.id}>{c.reference} · {clientName(db, c.clientId)}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    )
  }
}
