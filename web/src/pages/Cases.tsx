import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Combobox, Field, IconButton, Input, Modal, Progress, Segmented, Select, useToast } from '@/components/ui'
import { Ago, Countdown, PriorityPill, StagePill, StatusPill } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { Kpi, KpiGrid, PageHeader, Section, Table, Toolbar, Vide } from '@/components/page'
import { ACTIVE_STAGES, STAGES, caseBalance, clientName, daysUntil, isLate, progress, urgency } from '@/lib/derive'
import { exportRows } from '@/lib/export'
import type { Stage, VisaCase } from '@/data/types'
import { signalerUsage, useQuotaBloque } from '@/data/usage'
import { QuotaBlocked } from '@/components/UsageGauges'

/* La liste des dossiers.
   Les chiffres de tête ouvrent la liste déjà filtrée (le filtre vit dans
   l'URL : /dossiers?filtre=retard, que le tableau de bord et l'accueil
   utilisent aussi). Chaque ligne porte son geste principal au survol, sans
   ouvrir la fiche : avancer, relancer, ouvrir. */

type Filter = 'tous' | 'mine' | 'retard' | 'bloques' | 'departs' | 'solde'
const FILTERS: Filter[] = ['tous', 'mine', 'retard', 'bloques', 'departs', 'solde']
type Tri = 'urgence' | 'depart' | 'maj' | 'client'

const leavingSoon = (c: VisaCase) => c.status === 'ouvert' && daysUntil(c.travelDate) >= 0 && daysUntil(c.travelDate) <= 7

export function Cases() {
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt, formatMoney, formatDate, formatNumber } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<Stage | 'tous'>('tous')
  const [tri, setTri] = useState<Tri>('urgence')
  const [params, setParams] = useSearchParams()
  const demande = params.get('filtre')
  const filter: Filter = FILTERS.includes(demande as Filter) ? (demande as Filter) : 'tous'
  const setFilter = (value: Filter) => setParams(value === 'tous' ? {} : { filtre: value }, { replace: true })
  const [creating, setCreating] = useState(false)

  const canWrite = v.can('case:write')
  const finance = v.can('finance:global')

  /* Les chiffres de tête, sur ce que la personne a le droit de voir. */
  const open = v.cases.filter((c) => c.status === 'ouvert')
  const late = open.filter((c) => isLate(db, c))
  const blocked = open.filter((c) => urgency(db, c).reason === 'bloque')
  const leaving = open.filter(leavingSoon)
  const balance = open.reduce((sum, c) => sum + Math.max(caseBalance(c), 0), 0)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = v.cases
      .filter((c) => (stage === 'tous' ? true : c.stage === stage))
      .filter((c) => {
        if (filter === 'mine') return c.assigneeId === v.user.id
        if (filter === 'retard') return isLate(db, c)
        if (filter === 'bloques') return urgency(db, c).reason === 'bloque'
        if (filter === 'departs') return leavingSoon(c)
        if (filter === 'solde') return c.status === 'ouvert' && caseBalance(c) > 0
        return true
      })
      .filter((c) => {
        if (!q) return true
        return clientName(db, c.clientId).toLowerCase().includes(q) || c.reference.toLowerCase().includes(q)
      })
    const far = (iso?: string) => (iso ? new Date(iso).getTime() : Number.MAX_SAFE_INTEGER)
    return [...list].sort((a, b) => {
      if (tri === 'depart') return far(a.travelDate) - far(b.travelDate)
      if (tri === 'maj') return b.updatedAt.localeCompare(a.updatedAt)
      if (tri === 'client') return clientName(db, a.clientId).localeCompare(clientName(db, b.clientId))
      return urgency(db, b).score - urgency(db, a).score
    })
  }, [db, v, query, stage, filter, tri])

  const exporter = () => {
    const { name } = exportRows(rows, [
      { key: 'reference', label: t('cases.reference') },
      { key: 'client', label: t('cases.client'), value: (c) => clientName(db, c.clientId) },
      { key: 'visa', label: t('cases.visa'), value: (c) => tt(db.visaTypes.find((x) => x.id === c.visaTypeId)?.label) },
      { key: 'stage', label: t('cases.stage'), value: (c) => t(`stage.${c.stage}` as 'stage.nouveau') },
      { key: 'status', label: t('docs.state'), value: (c) => t(`status.${c.status}` as 'status.ouvert') },
      { key: 'assignee', label: t('cases.assignee'), value: (c) => db.users.find((u) => u.id === c.assigneeId)?.name ?? '' },
      { key: 'travel', label: t('cases.travel'), value: (c) => c.travelDate?.slice(0, 10) ?? '' },
      { key: 'total', label: t('pay.amount'), value: (c) => c.amountTotal },
      { key: 'paid', label: t('pay.collected'), value: (c) => c.amountPaid },
      { key: 'updated', label: t('cases.updated'), value: (c) => c.updatedAt.slice(0, 10) },
    ], { format: 'csv', base: 'dossiers' })
    toast(t('ls.exported', { name }))
  }

  /* Faire avancer : l'étape suivante, la même que sur la fiche. */
  const avancer = (c: VisaCase) => {
    const next = STAGES[STAGES.indexOf(c.stage) + 1]
    if (!next) return
    actions.advance(c.id)
    toast(t('ls.advanced', { ref: c.reference, stage: t(`stage.${next}` as 'stage.nouveau') }))
  }

  /* Relancer : les pièces déjà demandées reçoivent un rappel ; s'il n'y en a
     pas, les pièces manquantes sont demandées d'un coup. */
  const relancer = (c: VisaCase) => {
    const docs = v.documents.filter((d) => d.caseId === c.id && d.required)
    const asked = docs.filter((d) => d.state === 'demandee')
    if (asked.length > 0) {
      asked.forEach((d) => actions.remindDoc(d.id))
      toast(t('ls.remindedN', { n: asked.length }))
      return
    }
    const missing = docs.filter((d) => d.state === 'manquante').length
    if (missing > 0) {
      actions.requestMissingDocs(c.id)
      toast(t('ls.requestedN', { n: missing }))
      return
    }
    toast(t('ls.nothingToRemind'))
  }

  const segments: { value: Filter; label: string }[] = [
    { value: 'tous', label: t('misc.everything') },
    { value: 'mine', label: t('cases.mine') },
    { value: 'retard', label: t('cases.late') },
    { value: 'bloques', label: t('cases.blocked') },
    { value: 'departs', label: t('ls.fLeaving') },
    ...(finance ? [{ value: 'solde' as Filter, label: t('ls.fBalance') }] : []),
  ]

  return (
    <>
      <PageHeader
        kicker={t('ls.famSuivi')}
        title={t('cases.title')}
        subtitle={t('cases.subtitle')}
        actions={<>
          {v.can('data:export') && <Button icon="download" onClick={exporter} disabled={rows.length === 0}>{t('ls.exportCsv')}</Button>}
          {v.can('case:create') && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('cases.newCase')}</Button>}
        </>}
      />

      <KpiGrid>
        <Kpi label={t('ls.kOpen')} value={formatNumber(open.length)} tone="blue" icon="cases" to="/dossiers" />
        <Kpi label={t('ls.kLate')} value={formatNumber(late.length)} tone={late.length ? 'red' : 'gray'} icon="alert" to="/dossiers?filtre=retard" />
        <Kpi label={t('ls.kBlocked')} value={formatNumber(blocked.length)} tone={blocked.length ? 'orange' : 'gray'} icon="lock" to="/dossiers?filtre=bloques" />
        <Kpi label={t('ls.kLeaving7')} value={formatNumber(leaving.length)} tone={leaving.length ? 'orange' : 'gray'} icon="plane" hint={t('ls.hint7')} to="/dossiers?filtre=departs" />
        {finance && <Kpi label={t('ls.kBalance')} value={formatMoney(balance)} tone={balance > 0 ? 'orange' : 'gray'} icon="payments" hint={t('ls.hintOpen')} to="/dossiers?filtre=solde" />}
      </KpiGrid>

      <Section flush>
        <Toolbar right={<>
          <Select value={tri} onChange={(e) => setTri(e.target.value as Tri)} aria-label={t('ls.sort')}>
            <option value="urgence">{t('ls.sUrgency')}</option>
            <option value="depart">{t('ls.sTravel')}</option>
            <option value="maj">{t('ls.sUpdated')}</option>
            <option value="client">{t('cases.client')}</option>
          </Select>
          <span className="ls-count" role="status" aria-live="polite">{t('cases.count', { n: rows.length })}</span>
        </>}>
          <Input className="ls-search" aria-label={t('action.search')} placeholder={t('ls.searchCases')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select aria-label={t('cases.stage')} value={stage} onChange={(e) => setStage(e.target.value as Stage | 'tous')} style={{ width: 'auto' }}>
            <option value="tous">{t('cases.stage')}</option>
            {ACTIVE_STAGES.map((s) => <option key={s} value={s}>{t(`stage.${s}` as 'stage.nouveau')}</option>)}
            <option value="clos">{t('stage.clos')}</option>
          </Select>
          <Segmented value={filter} onChange={setFilter} label={t('action.filter')} options={segments} />
        </Toolbar>

        {rows.length === 0 ? (
          <Vide icon="cases" title={v.cases.length === 0 ? t('cases.none') : t('ls.noMatch')} hint={v.cases.length === 0 ? undefined : t('ls.noMatchHint')} />
        ) : (
          <Table className="ls-table">
            <thead>
              <tr>
                <th>{t('cases.reference')}</th>
                <th>{t('cases.client')}</th>
                <th>{t('cases.stage')}</th>
                <th className="col-optional">{t('cases.progress')}</th>
                <th className="col-optional">{t('cases.assignee')}</th>
                <th>{t('cases.travel')}</th>
                {finance && <th className="num col-optional">{t('cases.balance')}</th>}
                <th className="col-optional">{t('cases.updated')}</th>
                <th className="actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const visa = db.visaTypes.find((x) => x.id === c.visaTypeId)
                const p = progress(db, c.id)
                const name = clientName(db, c.clientId)
                const solde = caseBalance(c)
                const ouvert = c.status === 'ouvert'
                return (
                  <tr
                    key={c.id}
                    className={`adm-row--click ${ouvert ? '' : 'adm-row--off'}`}
                    tabIndex={0}
                    aria-label={`${c.reference} ${name}`}
                    onClick={() => navigate(`/dossiers/${c.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/dossiers/${c.id}`) }}
                  >
                    <td>
                      <div className="adm-cell-main">
                        <span className="ls-mono">{c.reference}</span>
                        <span className="t-caption">{tt(visa?.country)} · {tt(visa?.label)}</span>
                      </div>
                    </td>
                    <td><span className="row gap-2 ls-nowrap"><span className="t-medium">{name}</span><PriorityPill priority={c.priority} /></span></td>
                    <td>{ouvert ? <StagePill stage={c.stage} /> : <StatusPill status={c.status} />}</td>
                    <td className="col-optional">
                      <span className="col gap-1 ls-progress">
                        <Progress pct={p.pct} label={t('cases.progress')} valueText={`${p.done}/${p.total}`} tone={p.pct === 100 ? 'green' : p.pct < 40 ? 'orange' : undefined} />
                        <span className="t-caption t-tertiary t-num">{p.done}/{p.total}</span>
                      </span>
                    </td>
                    <td className="t-secondary col-optional">{db.users.find((u) => u.id === c.assigneeId)?.name}</td>
                    <td className="ls-nowrap">{ouvert ? <Countdown iso={c.travelDate} /> : formatDate(c.travelDate)}</td>
                    {finance && <td className="num col-optional">{solde > 0 ? formatMoney(solde) : <span className="t-tertiary">·</span>}</td>}
                    <td className="t-tertiary col-optional ls-nowrap"><Ago iso={c.updatedAt} /></td>
                    <td className="actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <span className="ls-actions">
                        {canWrite && ouvert && c.stage !== 'clos' && <Button size="sm" icon="arrow" onClick={() => avancer(c)}>{t('caseDetail.advance')}</Button>}
                        {canWrite && ouvert && <IconButton icon="bell" label={t('action.remind')} onClick={() => relancer(c)} />}
                        <Link to={`/dossiers/${c.id}`} className="btn btn--icon" aria-label={t('action.open')} title={t('action.open')}><Icon name="chevron" size={18} /></Link>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Section>

      {creating && <NewCase onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); navigate(`/dossiers/${id}`) }} />}
    </>
  )
}

/** Ouvrir un dossier. `clientId` pré-remplit le client quand on vient de sa fiche. */
export function NewCase({ clientId: preset, onClose, onCreated }: { clientId?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { db, currentUserId, actions } = useStore()
  const v = useVisible()
  const { t, tt, formatMoney } = useI18n()
  const [clientId, setClientId] = useState(preset ?? db.clients[0]?.id ?? '')
  const [visaTypeId, setVisaTypeId] = useState(db.visaTypes[0]?.id ?? '')
  const [assigneeId, setAssigneeId] = useState(currentUserId)
  const [travelDate, setTravelDate] = useState('')
  // La base dit « bloque » quand les dossiers actifs dépassent la formule
  // depuis plus de 30 jours. Avant la première réponse, on laisse passer.
  const bloque = useQuotaBloque('cases')

  const selected = db.visaTypes.find((x) => x.id === visaTypeId)
  const pieces = db.checklists.find((c) => c.id === selected?.checklistId)?.items.filter((i) => i.required).length ?? 0
  const daysToTravel = travelDate ? Math.round((new Date(travelDate).getTime() - Date.now()) / 86400000) : Infinity
  // Un délai à zéro veut dire « pas encore renseigné » : on n'alerte pas sur un
  // départ trop proche à partir d'un chiffre que personne n'a saisi.
  const tooShort = Boolean(selected) && (selected?.processingDays ?? 0) > 0 && daysToTravel < (selected?.processingDays ?? 0)

  const submit = () => {
    const id = actions.createCase({
      clientId, visaTypeId, assigneeId,
      travelDate: travelDate ? new Date(travelDate).toISOString() : undefined,
      source: 'comptoir',
    })
    signalerUsage()
    onCreated(id)
  }

  if (bloque) {
    return (
      <Modal title={t('cases.newCase')} onClose={onClose} footer={<Button onClick={onClose}>{t('action.cancel')}</Button>}>
        <QuotaBlocked code="cases" />
      </Modal>
    )
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
          <Combobox
            value={clientId}
            onChange={setClientId}
            placeholder={t('cases.searchClient')}
            emptyLabel={t('cases.noClientMatch')}
            options={v.clients.map((c) => ({
              value: c.id,
              label: `${c.firstName} ${c.lastName}`.trim(),
              hint: c.phone,
            }))}
          />
        </Field>
        <Field label={t('cases.visa')} hint={t('settings.checklists')}>
          <Select value={visaTypeId} onChange={(e) => setVisaTypeId(e.target.value)}>
            {db.visaTypes.filter((x) => x.active).map((x) => (
              <option key={x.id} value={x.id}>{tt(x.country)} · {tt(x.label)}</option>
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
                <span className="t-small">{selected.processingDays > 0 ? t('reports.days', { n: selected.processingDays }) : t('ls.toSet')}</span>
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
