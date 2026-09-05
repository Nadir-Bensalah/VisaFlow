import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Input, Select, Field, Modal, useToast } from '@/components/ui'
import { Ago, Countdown, PageHead, StagePill, StatusPill } from '@/components/bits'
import { ACTIVE_STAGES, caseBalance, clientName, isLate, progress, urgency } from '@/lib/derive'
import type { Stage } from '@/data/types'

type Filter = 'tous' | 'mine' | 'retard' | 'bloques'

export function Cases() {
  const { db, currentUserId } = useStore()
  const { t, tt, formatMoney, formatDate } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<Stage | 'tous'>('tous')
  const [filter, setFilter] = useState<Filter>('tous')
  const [creating, setCreating] = useState(false)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return db.cases
      .filter((c) => (stage === 'tous' ? true : c.stage === stage))
      .filter((c) => {
        if (filter === 'mine') return c.assigneeId === currentUserId
        if (filter === 'retard') return isLate(db, c)
        if (filter === 'bloques') return urgency(db, c).reason === 'bloque'
        return true
      })
      .filter((c) => {
        if (!q) return true
        const name = clientName(db, c.clientId).toLowerCase()
        return name.includes(q) || c.reference.toLowerCase().includes(q)
      })
      .sort((a, b) => urgency(db, b).score - urgency(db, a).score)
  }, [db, query, stage, filter, currentUserId])

  const exportCsv = () => {
    const head = ['reference', 'client', 'visa', 'etape', 'agent', 'depart', 'total', 'paye']
    const lines = rows.map((c) => [
      c.reference,
      clientName(db, c.clientId),
      tt(db.visaTypes.find((v) => v.id === c.visaTypeId)?.label),
      c.stage,
      db.users.find((u) => u.id === c.assigneeId)?.name ?? '',
      c.travelDate?.slice(0, 10) ?? '',
      String(c.amountTotal),
      String(c.amountPaid),
    ])
    const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `dossiers-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast(t('reports.exportCsv'))
  }

  return (
    <>
      <PageHead
        title={t('cases.title')}
        subtitle={t('cases.subtitle')}
        action={
          <div className="row gap-2">
            <Button icon="download" onClick={exportCsv}>{t('action.export')}</Button>
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('cases.newCase')}</Button>
          </div>
        }
      />

      <Card flush>
        <div className="row wrap gap-3" style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--hairline)' }}>
          <Input
            placeholder={t('action.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ maxWidth: 260 }}
          />
          <Select value={stage} onChange={(e) => setStage(e.target.value as Stage | 'tous')} style={{ width: 'auto' }}>
            <option value="tous">{t('misc.everything')}</option>
            {ACTIVE_STAGES.map((s) => (
              <option key={s} value={s}>{t(`stage.${s}` as 'stage.nouveau')}</option>
            ))}
            <option value="clos">{t('stage.clos')}</option>
          </Select>
          <div className="row gap-2">
            {([
              ['tous', t('misc.everything')],
              ['mine', t('cases.mine')],
              ['retard', t('cases.late')],
              ['bloques', t('cases.blocked')],
            ] as [Filter, string][]).map(([value, label]) => (
              <button key={value} type="button" className="chip" aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
          <span className="grow" />
          <span className="t-small t-tertiary t-num">{t('cases.count', { n: rows.length })}</span>
        </div>

        {rows.length === 0 ? (
          <Empty title={t('cases.none')} />
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('cases.reference')}</th>
                  <th>{t('cases.client')}</th>
                  <th>{t('cases.visa')}</th>
                  <th>{t('cases.stage')}</th>
                  <th>{t('cases.progress')}</th>
                  <th>{t('cases.assignee')}</th>
                  <th>{t('cases.travel')}</th>
                  <th className="num">{t('cases.balance')}</th>
                  <th>{t('cases.updated')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const visa = db.visaTypes.find((v) => v.id === c.visaTypeId)
                  const p = progress(db, c.id)
                  return (
                    <tr key={c.id} onClick={() => navigate(`/dossiers/${c.id}`)}>
                      <td className="t-mono t-small">{c.reference}</td>
                      <td className="t-medium">{clientName(db, c.clientId)}</td>
                      <td className="t-small t-secondary">{tt(visa?.country)} · {tt(visa?.label)}</td>
                      <td>{c.status === 'ouvert' ? <StagePill stage={c.stage} /> : <StatusPill status={c.status} />}</td>
                      <td className="t-small t-num t-secondary">{p.done}/{p.total}</td>
                      <td className="t-small t-secondary">{db.users.find((u) => u.id === c.assigneeId)?.name}</td>
                      <td className="t-small">{c.status === 'ouvert' ? <Countdown iso={c.travelDate} /> : formatDate(c.travelDate)}</td>
                      <td className="num t-small">{caseBalance(c) > 0 ? formatMoney(caseBalance(c)) : <span className="t-tertiary">—</span>}</td>
                      <td className="t-small t-tertiary"><Ago iso={c.updatedAt} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && <NewCase onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); navigate(`/dossiers/${id}`) }} />}
    </>
  )
}

function NewCase({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { db, currentUserId, actions } = useStore()
  const { t, tt } = useI18n()
  const [clientId, setClientId] = useState(db.clients[0]?.id ?? '')
  const [visaTypeId, setVisaTypeId] = useState(db.visaTypes[0]?.id ?? '')
  const [assigneeId, setAssigneeId] = useState(currentUserId)
  const [travelDate, setTravelDate] = useState('')

  const submit = () => {
    const id = actions.createCase({
      clientId, visaTypeId, assigneeId,
      travelDate: travelDate ? new Date(travelDate).toISOString() : undefined,
      source: 'comptoir',
    })
    onCreated(id)
  }

  return (
    <Modal
      title={t('cases.newCase')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" onClick={submit}>{t('action.confirm')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label={t('cases.client')}>
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {db.clients.map((c) => (
              <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('cases.visa')} hint={t('settings.checklists')}>
          <Select value={visaTypeId} onChange={(e) => setVisaTypeId(e.target.value)}>
            {db.visaTypes.filter((v) => v.active).map((v) => (
              <option key={v.id} value={v.id}>{tt(v.country)} · {tt(v.label)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('cases.assignee')}>
          <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            {db.users.filter((u) => u.active).map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('caseDetail.travelOn')}>
          <Input type="date" value={travelDate} onChange={(e) => setTravelDate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
