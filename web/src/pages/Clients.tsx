import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Avatar, Button, Empty, Input, Segmented, Select, useToast } from '@/components/ui'
import { ClientEditor } from '@/components/ClientEditor'
import { ClientImport } from '@/components/ClientImport'
import { Kpi, KpiGrid, PageHeader, Section, Table, Toolbar, Vide } from '@/components/page'
import { Icon } from '@/components/Icon'
import { NewCase } from '@/pages/Cases'
import { daysSince, daysUntil } from '@/lib/derive'
import { exportRows } from '@/lib/export'
import type { Client } from '@/data/types'

/* Le carnet d'adresses. Trois chiffres en tête, dont le seul qui fait perdre
   un dossier : le passeport qui expire. La ligne porte ses gestes : ouvrir un
   dossier pour ce client, lui écrire sur WhatsApp, ouvrir sa fiche. */

type Filter = 'tous' | 'passeport' | 'nouveaux'
const FILTERS: Filter[] = ['tous', 'passeport', 'nouveaux']
type Tri = 'nom' | 'recent' | 'expiration'

/** Sous six mois : la plupart des consulats exigent trois mois après le retour. */
const passportSoon = (c: Client) => daysUntil(c.passportExpiry) < 180
const isNew = (c: Client) => daysSince(c.createdAt) <= 30

/** Le numéro pour wa.me : chiffres seulement. Vide si le client n'a pas de numéro. */
export const waLink = (phone?: string) => {
  const digits = (phone ?? '').replace(/[^0-9]/g, '')
  return digits ? `https://wa.me/${digits}` : ''
}

export function PassportCell({ client }: { client: Client }) {
  const { t, formatDate } = useI18n()
  if (!client.passportExpiry) return <span className="t-tertiary">{t('ls.noPassport')}</span>
  const days = daysUntil(client.passportExpiry)
  const cls = days < 0 ? 'ls-passport--expired' : days < 180 ? 'ls-passport--soon' : 'ls-passport--ok'
  return (
    <span className="adm-cell-main">
      <span className="ls-mono">{client.passportNumber}</span>
      <span className={`t-caption ls-nowrap ${cls}`}>
        {days < 0 ? t('ls.passportExpired') : formatDate(client.passportExpiry)}
      </span>
    </span>
  )
}

export function Clients() {
  const v = useVisible()
  const { t, formatDate, formatNumber } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [tri, setTri] = useState<Tri>('nom')
  const [open, setOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [caseFor, setCaseFor] = useState<Client | null>(null)
  const [params, setParams] = useSearchParams()
  const demande = params.get('filtre')
  const filter: Filter = FILTERS.includes(demande as Filter) ? (demande as Filter) : 'tous'
  const setFilter = (f: Filter) => setParams(f === 'tous' ? {} : { filtre: f }, { replace: true })

  const soon = v.clients.filter(passportSoon)
  const recents = v.clients.filter(isNew)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = v.clients
      .filter((c) => (filter === 'passeport' ? passportSoon(c) : filter === 'nouveaux' ? isNew(c) : true))
      .filter((c) => !q || `${c.firstName} ${c.lastName} ${c.nativeName ?? ''} ${c.phone} ${c.passportNumber ?? ''}`.toLowerCase().includes(q))
    const far = (iso?: string) => (iso ? new Date(iso).getTime() : Number.MAX_SAFE_INTEGER)
    return [...list].sort((a, b) => {
      if (tri === 'recent') return b.createdAt.localeCompare(a.createdAt)
      if (tri === 'expiration') return far(a.passportExpiry) - far(b.passportExpiry)
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
    })
  }, [v.clients, query, filter, tri])

  const exporter = () => {
    const { name } = exportRows(rows, [
      { key: 'lastName', label: t('clients.name'), value: (c) => `${c.firstName} ${c.lastName}`.trim() },
      { key: 'nativeName', label: t('clients.name') + ' 2', value: (c) => c.nativeName ?? '' },
      { key: 'phone', label: t('clients.contact') },
      { key: 'email', label: t('login.email'), value: (c) => c.email ?? '' },
      { key: 'nationality', label: t('clients.nationality') },
      { key: 'passportNumber', label: t('clients.passport'), value: (c) => c.passportNumber ?? '' },
      { key: 'passportExpiry', label: t('clients.expiry'), value: (c) => c.passportExpiry?.slice(0, 10) ?? '' },
      { key: 'cases', label: t('clients.casesCount'), value: (c) => v.cases.filter((k) => k.clientId === c.id).length },
      { key: 'createdAt', label: t('clients.since'), value: (c) => c.createdAt.slice(0, 10) },
    ], { format: 'csv', base: 'clients' })
    toast(t('ls.exported', { name }))
  }

  const creation = (
    <>
      <Button icon="upload" onClick={() => setImporting(true)}>{t('import.action')}</Button>
      <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>{t('clients.newClient')}</Button>
    </>
  )

  return (
    <>
      <PageHeader
        kicker={t('ls.famClients')}
        title={t('clients.title')}
        subtitle={t('clients.subtitle')}
        actions={<>
          {v.can('data:export') && <Button icon="download" onClick={exporter} disabled={rows.length === 0}>{t('ls.exportCsv')}</Button>}
          {v.can('client:write') && creation}
        </>}
      />

      <KpiGrid>
        <Kpi label={t('ls.kClients')} value={formatNumber(v.clients.length)} tone="blue" icon="clients" to="/clients" />
        <Kpi label={t('ls.kPassport6')} value={formatNumber(soon.length)} tone={soon.length ? 'orange' : 'gray'} icon="passport" hint={t('ls.hint6m')} to="/clients?filtre=passeport" />
        <Kpi label={t('ls.kNew30')} value={formatNumber(recents.length)} tone={recents.length ? 'green' : 'gray'} icon="sparkle" hint={t('ls.hint30')} to="/clients?filtre=nouveaux" />
      </KpiGrid>

      <Section flush>
        <Toolbar right={<>
          <Select value={tri} onChange={(e) => setTri(e.target.value as Tri)} aria-label={t('ls.sort')}>
            <option value="nom">{t('ls.sName')}</option>
            <option value="recent">{t('ls.sRecent')}</option>
            <option value="expiration">{t('ls.sExpiry')}</option>
          </Select>
          <span className="ls-count" role="status" aria-live="polite">{rows.length === 1 ? t('ls.oneRow') : t('ls.rows', { n: rows.length })}</span>
        </>}>
          <Input className="ls-search" aria-label={t('action.search')} placeholder={t('ls.searchClients')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Segmented value={filter} onChange={setFilter} label={t('action.filter')} options={[
            { value: 'tous', label: t('misc.everything') },
            { value: 'passeport', label: t('ls.fPassport') },
            { value: 'nouveaux', label: t('ls.fNew') },
          ]} />
        </Toolbar>

        {v.clients.length === 0 ? (
          <Empty title={t('clients.none')} hint={t('setup.shareHint')} scene="equipe" action={v.can('client:write') ? <div className="row gap-2">{creation}</div> : undefined} />
        ) : rows.length === 0 ? (
          <Vide icon="clients" title={t('ls.noMatch')} hint={t('ls.noMatchHint')} />
        ) : (
          <Table className="ls-table">
            <thead>
              <tr>
                <th>{t('clients.name')}</th>
                <th>{t('clients.contact')}</th>
                <th className="col-optional">{t('clients.nationality')}</th>
                <th>{t('clients.passport')}</th>
                <th className="num">{t('clients.casesCount')}</th>
                <th className="col-optional">{t('clients.since')}</th>
                <th className="actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const name = `${c.firstName} ${c.lastName}`.trim()
                const all = v.cases.filter((k) => k.clientId === c.id)
                const ouverts = all.filter((k) => k.status === 'ouvert').length
                const wa = waLink(c.whatsapp ?? c.phone)
                return (
                  <tr
                    key={c.id}
                    className="adm-row--click"
                    tabIndex={0}
                    aria-label={name}
                    onClick={() => navigate(`/clients/${c.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/clients/${c.id}`) }}
                  >
                    <td>
                      <span className="row gap-3">
                        <Avatar name={name} size="sm" />
                        <span className="adm-cell-main">
                          <span className="ls-nowrap">{name}</span>
                          {c.nativeName && <span className="t-caption">{c.nativeName}</span>}
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="adm-cell-main">
                        <span className="ls-mono" style={{ fontWeight: 400 }}>{c.phone}</span>
                        {c.email && <span className="t-caption t-truncate" style={{ maxWidth: 220 }}>{c.email}</span>}
                      </span>
                    </td>
                    <td className="t-secondary col-optional">{c.nationality}</td>
                    <td><PassportCell client={c} /></td>
                    <td className="num">
                      <span className="adm-cell-main" style={{ alignItems: 'flex-end' }}>
                        <span>{all.length}</span>
                        {ouverts > 0 && <span className="t-caption">{t('ls.openCases', { n: ouverts })}</span>}
                      </span>
                    </td>
                    <td className="t-tertiary col-optional">{formatDate(c.createdAt)}</td>
                    <td className="actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <span className="ls-actions">
                        {v.can('case:create') && <Button size="sm" icon="plus" onClick={() => setCaseFor(c)}>{t('cases.newCase')}</Button>}
                        {wa && <a className="btn btn--icon" href={wa} target="_blank" rel="noreferrer" aria-label="WhatsApp" title="WhatsApp"><Icon name="whatsapp" size={18} /></a>}
                        <Link to={`/clients/${c.id}`} className="btn btn--icon" aria-label={t('action.open')} title={t('action.open')}><Icon name="chevron" size={18} /></Link>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Section>

      {open && <ClientEditor client={null} onClose={() => setOpen(false)} onSaved={(id) => navigate(`/clients/${id}`)} />}
      {importing && <ClientImport onClose={() => setImporting(false)} />}
      {caseFor && <NewCase clientId={caseFor.id} onClose={() => setCaseFor(null)} onCreated={(id) => { setCaseFor(null); navigate(`/dossiers/${id}`) }} />}
    </>
  )
}
