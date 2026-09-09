import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useNow } from '@/data/clock'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Field, Input, Modal, Pill, Segmented, Select, useToast } from '@/components/ui'
import { Countdown } from '@/components/bits'
import { Kpi, KpiGrid, PageHeader, Section, Table, Toolbar, Vide } from '@/components/page'
import { Icon } from '@/components/Icon'
import { clientName, daysUntil } from '@/lib/derive'
import type { Task } from '@/data/types'

/* Les tâches de l'équipe. Trois chiffres : ce qui reste, ce qui est en
   retard, ce qui a été fait. Un seul geste par ligne, celui qui compte :
   faire (et rouvrir, si on s'est trompé). Le store ne sait pas déplacer une
   échéance : on ne propose donc pas de « reporter » qui mentirait. */

type Filter = 'afaire' | 'retard' | 'faites' | 'toutes'
const FILTERS: Filter[] = ['afaire', 'retard', 'faites', 'toutes']
type Who = 'moi' | 'tous'

const isLate = (x: Task) => !x.done && daysUntil(x.dueAt) < 0

function weekBounds(now: number): [number, number] {
  const d = new Date(now); d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const start = d.getTime()
  return [start, start + 7 * 86400000 - 1]
}

export function Tasks() {
  const { db, actions } = useStore()
  const now = useNow()
  const v = useVisible()
  const { t, tt, formatDate, formatNumber } = useI18n()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [who, setWho] = useState<Who>('tous')
  const [creating, setCreating] = useState(false)
  const [params, setParams] = useSearchParams()
  const demande = params.get('filtre')
  const filter: Filter = FILTERS.includes(demande as Filter) ? (demande as Filter) : 'afaire'
  const setFilter = (f: Filter) => setParams(f === 'afaire' ? {} : { filtre: f }, { replace: true })

  const [weekStart, weekEnd] = weekBounds(now)
  const inWeek = (x: Task) => { const d = new Date(x.dueAt).getTime(); return d >= weekStart && d <= weekEnd }

  const todo = v.tasks.filter((x) => !x.done)
  const late = v.tasks.filter(isLate)
  const doneWeek = v.tasks.filter((x) => x.done && inWeek(x))

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = v.tasks
      .filter((x) => (who === 'moi' ? x.assigneeId === v.user.id : true))
      .filter((x) => (filter === 'afaire' ? !x.done : filter === 'retard' ? isLate(x) : filter === 'faites' ? x.done : true))
      .filter((x) => {
        if (!q) return true
        const kase = v.cases.find((c) => c.id === x.caseId)
        return `${tt(x.title)} ${kase ? clientName(db, kase.clientId) : ''} ${kase?.reference ?? ''}`.toLowerCase().includes(q)
      })
    // Les faites en bas, puis l'échéance la plus proche en premier.
    return list.sort((a, b) => (a.done === b.done ? a.dueAt.localeCompare(b.dueAt) : a.done ? 1 : -1))
  }, [db, v, who, filter, query, tt])

  const toggle = (x: Task) => {
    actions.toggleTask(x.id)
    toast(x.done ? t('ls.taskReopened') : t('ls.taskDone'))
  }

  return (
    <>
      <PageHeader
        kicker={t('ls.famSuivi')}
        title={t('ls.tasksTitle')}
        subtitle={t('ls.tasksSub')}
        actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('ls.newTask')}</Button>}
      />

      <KpiGrid>
        <Kpi label={t('ls.kTodo')} value={formatNumber(todo.length)} tone="blue" icon="tasks" to="/taches" />
        <Kpi label={t('ls.kTaskLate')} value={formatNumber(late.length)} tone={late.length ? 'red' : 'gray'} icon="alert" to="/taches?filtre=retard" />
        <Kpi label={t('ls.kDoneWeek')} value={formatNumber(doneWeek.length)} tone="green" icon="check" hint={t('ls.doneWeekHint')} to="/taches?filtre=faites" />
      </KpiGrid>

      <Section flush>
        <Toolbar right={<>
          <Segmented value={who} onChange={setWho} label={t('cases.assignee')} options={[
            { value: 'tous', label: t('misc.everything') },
            { value: 'moi', label: t('cases.mine') },
          ]} />
          <span className="ls-count" role="status" aria-live="polite">{rows.length === 1 ? t('ls.oneRow') : t('ls.rows', { n: rows.length })}</span>
        </>}>
          <Input className="ls-search" aria-label={t('action.search')} placeholder={t('ls.searchTasks')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Segmented value={filter} onChange={setFilter} label={t('action.filter')} options={[
            { value: 'afaire', label: t('ls.fTodo') },
            { value: 'retard', label: t('ls.fLate') },
            { value: 'faites', label: t('ls.fDone') },
            { value: 'toutes', label: t('misc.everything') },
          ]} />
        </Toolbar>

        {rows.length === 0 ? (
          <Vide icon="tasks" title={t('dash.noAttention')} hint={v.tasks.length ? t('ls.noMatchHint') : undefined} />
        ) : (
          <Table className="ls-table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>{t('ls.colTask')}</th>
                <th className="col-optional">{t('ls.colCase')}</th>
                <th className="col-optional">{t('cases.assignee')}</th>
                <th>{t('ls.colDue')}</th>
                <th className="actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const kase = v.cases.find((c) => c.id === x.caseId)
                return (
                  <tr key={x.id} className={x.done ? 'ls-row--done' : ''}>
                    <td>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={x.done}
                        aria-label={tt(x.title)}
                        onClick={() => toggle(x)}
                        className="today__check"
                        style={{ borderColor: x.done ? 'var(--green)' : undefined, background: x.done ? 'var(--green)' : 'transparent', color: x.done ? 'var(--text-white)' : 'transparent' }}
                      >
                        <Icon name="check" size={12} />
                      </button>
                    </td>
                    <td>
                      <div className="adm-cell-main">
                        <span className="row gap-2" style={{ textDecoration: x.done ? 'line-through' : undefined }}>
                          {tt(x.title)}
                          {x.automated && <Pill tone="violet">{t('msg.automated')}</Pill>}
                        </span>
                        {kase && <span className="t-caption">{clientName(db, kase.clientId)}</span>}
                      </div>
                    </td>
                    <td className="col-optional">
                      {kase ? <Link to={`/dossiers/${kase.id}`} className="ls-mono">{kase.reference}</Link> : <span className="t-tertiary">·</span>}
                    </td>
                    <td className="t-secondary col-optional">{db.users.find((u) => u.id === x.assigneeId)?.name}</td>
                    <td className="ls-nowrap">{x.done ? <span className="t-tertiary">{formatDate(x.dueAt)}</span> : <Countdown iso={x.dueAt} />}</td>
                    <td className="actions">
                      <span className="ls-actions">
                        <Button size="sm" icon={x.done ? 'refresh' : 'check'} onClick={() => toggle(x)}>{x.done ? t('ls.undoTask') : t('ls.doTask')}</Button>
                        {kase && <Link to={`/dossiers/${kase.id}`} className="btn btn--icon" aria-label={t('action.open')} title={t('action.open')}><Icon name="chevron" size={18} /></Link>}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Section>

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
        title={t('ls.newTask')}
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
          <Field label={t('ls.colTask')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
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
              <option value="">·</option>
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
