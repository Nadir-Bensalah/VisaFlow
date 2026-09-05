import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Input, Select, Field, Modal, useToast } from '@/components/ui'
import { Ago, Countdown, PageHead, StagePill, StatusPill } from '@/components/bits'
import { ACTIVE_STAGES, caseBalance, clientName, isLate, progress, urgency } from '@/lib/derive'
import type { Stage } from '@/data/types'

type Filter = 'tous' | 'mine' | 'retard' | 'bloques'

export function Cases() {
  const { db } = useStore()
  const v = useVisible()
  const { t, tt, formatMoney, formatDate } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<Stage | 'tous'>('tous')
  // Le tableau de bord ouvre la liste deja filtree : /dossiers?filtre=retard
  const [params, setParams] = useSearchParams()
  const filter = (params.get('filtre') as Filter | null) ?? 'tous'
  const setFilter = (value: Filter) => setParams(value === 'tous' ? {} : { filtre: value }, { replace: true })
  const [creating, setCreating] = useState(false)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return v.cases
      .filter((c) => (stage === 'tous' ? true : c.stage === stage))
      .filter((c) => {
        if (filter === 'mine') return c.assigneeId === v.user.id
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
  }, [db, v, query, stage, filter])

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
            {v.can('data:export') && <Button icon="download" onClick={exportCsv}>{t('action.export')}</Button>}
            {v.can('case:create') && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('cases.newCase')}</Button>}
          </div>
        }
      />

      <Card flush>
        <div className="row wrap gap-3" style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--hairline)' }}>
          <Input
            aria-label={t('action.search')}
            placeholder={t('action.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ maxWidth: 260 }}
          />
          <Select aria-label={t('cases.stage')} value={stage} onChange={(e) => setStage(e.target.value as Stage | 'tous')} style={{ width: 'auto' }}>
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
          <span className="t-small t-tertiary t-num" role="status" aria-live="polite">{t('cases.count', { n: rows.length })}</span>
        </div>

        {rows.length === 0 ? (
          <Empty title={t('cases.none')} />
        ) : (
          <div className="tablewrap">
            <table className="table table--clickable">
              <thead>
                <tr>
                  <th>{t('cases.reference')}</th>
                  <th>{t('cases.client')}</th>
                  <th className="col-optional">{t('cases.visa')}</th>
                  <th>{t('cases.stage')}</th>
                  <th>{t('cases.progress')}</th>
                  <th className="col-optional">{t('cases.assignee')}</th>
                  <th>{t('cases.travel')}</th>
                  {v.can('finance:global') && <th className="num">{t('cases.balance')}</th>}
                  <th className="col-optional">{t('cases.updated')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const visa = db.visaTypes.find((v) => v.id === c.visaTypeId)
                  const p = progress(db, c.id)
                  return (
                    <tr
                      key={c.id}
                      tabIndex={0}
                      role="link"
                      aria-label={`${c.reference} ${clientName(db, c.clientId)}`}
                      onClick={() => navigate(`/dossiers/${c.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/dossiers/${c.id}`) }
                      }}
                    >
                      <td className="t-mono t-small">{c.reference}</td>
                      <td className="t-medium">{clientName(db, c.clientId)}</td>
                      <td className="t-small t-secondary col-optional">{tt(visa?.country)} · {tt(visa?.label)}</td>
                      <td>{c.status === 'ouvert' ? <StagePill stage={c.stage} /> : <StatusPill status={c.status} />}</td>
                      <td className="t-small t-num t-secondary">{p.done}/{p.total}</td>
                      <td className="t-small t-secondary col-optional">{db.users.find((u) => u.id === c.assigneeId)?.name}</td>
                      <td className="t-small">{c.status === 'ouvert' ? <Countdown iso={c.travelDate} /> : formatDate(c.travelDate)}</td>
                      {v.can('finance:global') && (
                        <td className="num t-small">{caseBalance(c) > 0 ? formatMoney(caseBalance(c)) : <span className="t-tertiary">—</span>}</td>
                      )}
                      <td className="t-small t-tertiary col-optional"><Ago iso={c.updatedAt} /></td>
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
  const v = useVisible()
  const { t, tt, formatMoney } = useI18n()
  const [clientId, setClientId] = useState(db.clients[0]?.id ?? '')
  const [visaTypeId, setVisaTypeId] = useState(db.visaTypes[0]?.id ?? '')
  const [assigneeId, setAssigneeId] = useState(currentUserId)
  const [travelDate, setTravelDate] = useState('')

  const selected = db.visaTypes.find((x) => x.id === visaTypeId)
  const pieces = db.checklists.find((c) => c.id === selected?.checklistId)?.items.filter((i) => i.required).length ?? 0
  const daysToTravel = travelDate ? Math.round((new Date(travelDate).getTime() - Date.now()) / 86400000) : Infinity
  const tooShort = Boolean(selected) && daysToTravel < (selected?.processingDays ?? 0)

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
          <Button variant="primary" disabled={!clientId || !visaTypeId} onClick={submit}>{t('action.confirm')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label={t('cases.client')}>
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {v.clients.map((c) => (
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
        {/* Ce que l'agent doit annoncer au comptoir, sans ouvrir les réglages. */}
        {selected && (
          <div style={{ background: 'var(--bg-sunken)', borderRadius: 'var(--radius-card-sm)', padding: 'var(--sp-4)' }}>
            <div className="col gap-2">
              <div className="row-between">
                <span className="t-small t-secondary">{t('pay.amount')}</span>
                <span className="t-medium">{formatMoney(selected.feeAgency + selected.feeConsulate)}</span>
              </div>
              <div className="row-between">
                <span className="t-small t-secondary">{t('reports.delay')}</span>
                <span className="t-small">{t('reports.days', { n: selected.processingDays })}</span>
              </div>
              <div className="row-between">
                <span className="t-small t-secondary">{t('cases.progress')}</span>
                <span className="t-small">{pieces}</span>
              </div>
              {tooShort && (
                <span className="t-small" style={{ color: 'var(--red)' }}>{t('cases.late')}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
