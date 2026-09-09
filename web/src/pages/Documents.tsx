import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Input, Segmented, Select, useToast } from '@/components/ui'
import { DocPill } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { Kpi, KpiGrid, PageHeader, Section, Table, Toolbar, Vide } from '@/components/page'
import { clientName, daysSince } from '@/lib/derive'
import { exportRows } from '@/lib/export'
import type { CaseDocument, DocState, VisaCase } from '@/data/types'

/* Les pièces, dans l'ordre où elles bloquent les dossiers. Trois chiffres :
   ce qui manque, ce qui attend un regard, ce qui est réglé. La ligne porte le
   geste qui débloque : valider ce qui est reçu, relancer ce qui traîne. */

type Filter = 'bloquantes' | 'attente' | 'manquantes' | 'valider' | 'validees' | 'toutes'
const FILTERS: Filter[] = ['bloquantes', 'attente', 'manquantes', 'valider', 'validees', 'toutes']
type Tri = 'attente' | 'client'

const STATES: Record<Filter, DocState[]> = {
  bloquantes: ['manquante', 'refusee', 'expiree'],
  attente: ['manquante', 'demandee', 'recue', 'refusee', 'expiree'],
  manquantes: ['manquante', 'demandee'],
  valider: ['recue'],
  validees: ['validee'],
  toutes: ['manquante', 'demandee', 'recue', 'refusee', 'expiree', 'validee'],
}

type Row = { doc: CaseDocument; kase: VisaCase; waiting: number }

export function Documents() {
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt, formatNumber } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [tri, setTri] = useState<Tri>('attente')
  const [params, setParams] = useSearchParams()
  const demande = params.get('filtre')
  const filter: Filter = FILTERS.includes(demande as Filter) ? (demande as Filter) : 'bloquantes'
  const setFilter = (f: Filter) => setParams(f === 'bloquantes' ? {} : { filtre: f }, { replace: true })

  const canWrite = v.can('case:write')

  /* Le périmètre : les pièces obligatoires des dossiers ouverts. */
  const openCases = useMemo(() => new Map(v.cases.filter((c) => c.status === 'ouvert').map((c) => [c.id, c])), [v.cases])
  const scoped = useMemo(() => v.documents.filter((d) => d.required && openCases.has(d.caseId)), [v.documents, openCases])
  const missing = scoped.filter((d) => d.state === 'manquante' || d.state === 'demandee')
  const toValidate = scoped.filter((d) => d.state === 'recue')
  const validated = scoped.filter((d) => d.state === 'validee')

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase()
    const list = v.documents
      .filter((d) => openCases.has(d.caseId) && STATES[filter].includes(d.state) && (filter === 'toutes' || d.required))
      .map((d) => {
        const kase = openCases.get(d.caseId)!
        // On compte depuis la dernière relance, sinon l'écran propose
        // éternellement les mêmes personnes.
        return { doc: d, kase, waiting: daysSince(d.lastReminderAt ?? d.requestedAt ?? kase.openedAt) }
      })
      .filter((r) => !q || `${tt(r.doc.label)} ${clientName(db, r.kase.clientId)} ${r.kase.reference}`.toLowerCase().includes(q))
    return list.sort((a, b) => (tri === 'client'
      ? clientName(db, a.kase.clientId).localeCompare(clientName(db, b.kase.clientId))
      : b.waiting - a.waiting))
  }, [db, v.documents, openCases, filter, query, tri, tt])

  const remindAll = () => {
    const late = rows.filter((r) => r.doc.state === 'demandee' && r.waiting >= 3)
    late.forEach((r) => actions.remindDoc(r.doc.id))
    toast(late.length ? t('ls.remindedN', { n: late.length }) : t('docs.none'))
  }

  const exporter = () => {
    const { name } = exportRows(rows, [
      { key: 'label', label: t('docs.item'), value: (r) => tt(r.doc.label) },
      { key: 'client', label: t('cases.client'), value: (r) => clientName(db, r.kase.clientId) },
      { key: 'reference', label: t('cases.reference'), value: (r) => r.kase.reference },
      { key: 'state', label: t('docs.state'), value: (r) => t(`doc.${r.doc.state}` as 'doc.manquante') },
      { key: 'waiting', label: t('docs.since'), value: (r) => (Number.isFinite(r.waiting) ? r.waiting : '') },
      { key: 'reminders', label: t('docs.reminders'), value: (r) => r.doc.reminders },
    ], { format: 'csv', base: 'pieces' })
    toast(t('ls.exported', { name }))
  }

  /* Le geste d'une ligne selon l'état : reçue, on valide ; demandée, on
     rappelle ; manquante, on demande. Les autres états se règlent sur la fiche. */
  const gesture = (doc: CaseDocument) => {
    if (doc.state === 'recue') { actions.setDocState(doc.id, 'validee'); toast(t('docs.validated')); return }
    if (doc.state === 'demandee') { actions.remindDoc(doc.id); toast(t('msg.sent')); return }
    if (doc.state === 'manquante') { actions.setDocState(doc.id, 'demandee'); toast(t('msg.sent')) }
  }

  return (
    <>
      <PageHeader
        kicker={t('ls.famSuivi')}
        title={t('docs.title')}
        subtitle={t('docs.subtitle')}
        actions={<>
          {v.can('data:export') && <Button icon="download" onClick={exporter} disabled={rows.length === 0}>{t('ls.exportCsv')}</Button>}
          {canWrite && <Button variant="primary" icon="bell" onClick={remindAll}>{t('docs.remindAll')}</Button>}
        </>}
      />

      <KpiGrid>
        <Kpi label={t('ls.kMissing')} value={formatNumber(missing.length)} tone={missing.length ? 'orange' : 'gray'} icon="documents" hint={t('ls.hintOpen')} to="/pieces?filtre=manquantes" />
        <Kpi label={t('ls.kToValidate')} value={formatNumber(toValidate.length)} tone={toValidate.length ? 'blue' : 'gray'} icon="eye" to="/pieces?filtre=valider" />
        <Kpi label={t('ls.kValidated')} value={formatNumber(validated.length)} tone="green" icon="check" to="/pieces?filtre=validees" />
      </KpiGrid>

      <Section flush>
        <Toolbar right={<>
          <Select value={tri} onChange={(e) => setTri(e.target.value as Tri)} aria-label={t('ls.sort')}>
            <option value="attente">{t('ls.sWaiting')}</option>
            <option value="client">{t('cases.client')}</option>
          </Select>
          <span className="ls-count" role="status" aria-live="polite">{rows.length === 1 ? t('ls.oneRow') : t('ls.rows', { n: rows.length })}</span>
        </>}>
          <Input className="ls-search" aria-label={t('action.search')} placeholder={t('ls.searchDocs')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Segmented value={filter} onChange={setFilter} label={t('action.filter')} options={[
            { value: 'bloquantes', label: t('ls.fBlocking') },
            { value: 'attente', label: t('ls.fWaiting') },
            { value: 'manquantes', label: t('ls.fMissing') },
            { value: 'valider', label: t('ls.fToValidate') },
            { value: 'validees', label: t('ls.fValidated') },
            { value: 'toutes', label: t('misc.everything') },
          ]} />
        </Toolbar>

        {rows.length === 0 ? (
          <Vide icon="documents" title={t('docs.none')} hint={scoped.length ? t('ls.noMatchHint') : undefined} />
        ) : (
          <Table className="ls-table">
            <thead>
              <tr>
                <th>{t('docs.item')}</th>
                <th>{t('cases.client')}</th>
                <th>{t('docs.state')}</th>
                <th className="num">{t('docs.since')}</th>
                <th className="num col-optional">{t('docs.reminders')}</th>
                <th className="actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ doc, kase, waiting }) => (
                <tr
                  key={doc.id}
                  className="adm-row--click"
                  tabIndex={0}
                  aria-label={`${tt(doc.label)} ${kase.reference}`}
                  onClick={() => navigate(`/dossiers/${kase.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/dossiers/${kase.id}`) }}
                >
                  <td>
                    <div className="adm-cell-main">
                      <span>{tt(doc.label)}</span>
                      <span className="t-caption ls-mono" style={{ fontWeight: 400 }}>{kase.reference}</span>
                    </div>
                  </td>
                  <td>{clientName(db, kase.clientId)}</td>
                  <td><DocPill state={doc.state} /></td>
                  <td className="num" style={{ color: waiting > 7 ? 'var(--red)' : waiting > 3 ? 'var(--orange)' : undefined }}>
                    {Number.isFinite(waiting) ? t('time.daysAgo', { n: waiting }) : '·'}
                  </td>
                  <td className="num t-tertiary col-optional">{doc.reminders || '·'}</td>
                  <td className="actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <span className="ls-actions">
                      {canWrite && doc.state === 'recue' && <Button size="sm" icon="check" onClick={() => gesture(doc)}>{t('action.validate')}</Button>}
                      {canWrite && doc.state === 'demandee' && <Button size="sm" icon="bell" onClick={() => gesture(doc)}>{t('action.remind')}</Button>}
                      {canWrite && doc.state === 'manquante' && <Button size="sm" icon="messages" onClick={() => gesture(doc)}>{t('action.request')}</Button>}
                      <Link to={`/dossiers/${kase.id}`} className="btn btn--icon" aria-label={t('action.open')} title={t('action.open')}><Icon name="chevron" size={18} /></Link>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  )
}
