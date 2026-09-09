import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { ClientEditor } from '@/components/ClientEditor'
import { SchengenCard } from '@/components/SchengenCard'
import { TagsPicker } from '@/components/TagsPicker'
import { ContactsCard } from '@/components/ContactsCard'
import { CompanySection } from '@/components/CompanySection'
import { AuditTrail } from '@/components/AuditTrail'
import { CustomFields } from '@/components/CustomFields'
import { PinButton } from '@/components/PinButton'
import { PrintButton } from '@/components/PrintButton'
import { CreditCard } from '@/components/CreditCard'
import { TravelPanel } from '@/components/TravelPanel'
import { Ago, CaseRow, DocPill } from '@/components/bits'
import { Kpi, KpiGrid, Ligne, PageHeader, Section, Vide } from '@/components/page'
import { Avatar, Button, Empty, Field, Modal, Pill, Select, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { NewCase } from '@/pages/Cases'
import { waLink } from '@/pages/Clients'
import { daysUntil, shipmentsOfClient } from '@/lib/derive'
import type { VisaCase } from '@/data/types'

/* La fiche client, sur le même dessin que la console : une colonne principale
   (dossiers, séjours Schengen, pièces, messages, notes, puis le reste) et un
   rail qui reste sous les yeux : identité, contact, passeport, les gestes. */

export function ClientDetail() {
  const { id = '' } = useParams()
  const { db } = useStore()
  const v = useVisible()
  const { t, tt, formatDate, formatNumber } = useI18n()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const client = v.clients.find((c) => c.id === id)
  if (!client) return <Empty title={t('clients.none')} action={<Link to="/clients" className="btn btn--secondary">{t('action.back')}</Link>} />

  const name = `${client.firstName} ${client.lastName}`.trim()
  const cases = v.cases.filter((c) => c.clientId === client.id).sort((a, b) => b.openedAt.localeCompare(a.openedAt))
  const caseIds = new Set(cases.map((c) => c.id))
  const open = cases.filter((c) => c.status === 'ouvert')
  const events = v.events.filter((e) => e.caseId ? caseIds.has(e.caseId) : e.clientId === client.id).slice(0, 12)
  // Le client est rattaché par ses LOTS, pas par un champ sur la cargaison.
  const shipments = shipmentsOfClient(db, client.id).filter((x) => v.shipments.some((y) => y.id === x.id))

  /* Les pièces des dossiers ouverts, celles qui bloquent en premier. */
  const RANK: Record<string, number> = { manquante: 0, refusee: 1, expiree: 2, demandee: 3, recue: 4, validee: 5 }
  const docs = v.documents
    .filter((d) => open.some((c) => c.id === d.caseId))
    .sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9))
  const blocking = docs.filter((d) => d.required && ['manquante', 'refusee', 'expiree'].includes(d.state)).length

  const messages = v.messages.filter((m) => m.caseId && caseIds.has(m.caseId)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8)
  const notes = cases
    .flatMap((c) => c.notes.map((n) => ({ ...n, reference: c.reference, caseId: c.id })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10)

  const days = daysUntil(client.passportExpiry)
  const passportCls = !client.passportExpiry ? 't-tertiary' : days < 0 ? 'ls-passport--expired' : days < 180 ? 'ls-passport--soon' : 'ls-passport--ok'
  const passportText = !client.passportExpiry ? t('ls.noPassport') : days < 0 ? t('ls.passportExpired') : days < 180 ? t('clients.passportSoon') : t('ls.passportOk')
  const wa = waLink(client.whatsapp ?? client.phone)
  const canCase = v.can('case:create')

  return (
    <>
      <PageHeader
        kicker={t('ls.famClients')}
        title={name}
        subtitle={[client.nativeName, client.nationality, `${t('clients.since')} ${formatDate(client.createdAt)}`].filter(Boolean).join(' · ')}
        actions={(
          <>
            <PinButton entityKind="CLIENT" entityId={client.id} />
            <PrintButton kind="fiche_client" entityId={client.id} />
            {v.can('case:write') && <Button icon="phone" onClick={() => setCallOpen(true)}>{t('notes.logCall')}</Button>}
            {canCase && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('cases.newCase')}</Button>}
          </>
        )}
      />

      {editing && <ClientEditor client={client} onClose={() => setEditing(false)} />}
      {callOpen && <CallNote cases={cases} onClose={() => setCallOpen(false)} />}
      {creating && <NewCase clientId={client.id} onClose={() => setCreating(false)} onCreated={(cid) => { setCreating(false); navigate(`/dossiers/${cid}`) }} />}

      <KpiGrid>
        <Kpi label={t('clients.casesCount')} value={formatNumber(cases.length)} tone="blue" icon="cases" hint={open.length ? t('ls.openCases', { n: open.length }) : undefined} />
        <Kpi label={t('cases.blocked')} value={formatNumber(blocking)} tone={blocking ? 'orange' : 'gray'} icon="documents" hint={t('docs.title')} />
        <Kpi label={t('clients.expiry')} value={client.passportExpiry ? formatDate(client.passportExpiry) : '·'} tone={!client.passportExpiry ? 'gray' : days < 0 ? 'red' : days < 180 ? 'orange' : 'green'} icon="passport" hint={passportText} />
        {shipments.length > 0 && <Kpi label={t('ship.title')} value={formatNumber(shipments.length)} tone="blue" icon="ship" />}
      </KpiGrid>

      <div className="pg-fiche ls-fiche">
        <div className="ls-fiche__main">
          <Section title={t('cases.title')} action={canCase ? <Button size="sm" icon="plus" onClick={() => setCreating(true)}>{t('cases.newCase')}</Button> : undefined} flush>
            {cases.length === 0 ? <Vide icon="cases" title={t('cases.none')} /> : (
              <div className="list">{cases.map((c) => <CaseRow key={c.id} kase={c} />)}</div>
            )}
          </Section>

          {shipments.length > 0 && (
            <Section title={t('ship.title')} flush>
              <div className="list">
                {shipments.map((x) => (
                  <Link key={x.id} to={`/cargaisons/${x.id}`} className="list__row">
                    <Icon name="ship" size={18} className="t-tertiary" />
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <span className="t-small t-medium t-truncate">{tt(x.goods)}</span>
                      <span className="t-caption t-tertiary">{x.reference} · {x.originPort} → {x.destPort}</span>
                    </span>
                    <Pill tone="blue" dot>{t(`ship.s.${x.stage}` as 'ship.s.transit')}</Pill>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {/* « Combien de jours me reste-t-il ? » : la question la plus fréquente
              au comptoir depuis l'EES, et que personne d'autre ne sait traiter. */}
          <SchengenCard clientId={client.id} />

          <Section title={t('docs.title')} action={open.length ? <Link to={`/dossiers/${open[0].id}`} className="t-small">{t('action.seeAll')}</Link> : undefined} flush>
            {docs.length === 0 ? <Vide icon="documents" title={t('ls.noDocs')} /> : (
              <div className="list">
                {docs.slice(0, 10).map((d) => {
                  const kase = cases.find((c) => c.id === d.caseId)
                  return (
                    <Link key={d.id} to={`/dossiers/${d.caseId}`} className="list__row">
                      <Icon name="documents" size={18} className="t-tertiary" />
                      <span className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-small t-medium t-truncate">{tt(d.label)}</span>
                        <span className="t-caption t-tertiary">{kase?.reference}{d.required ? '' : ` · ${t('misc.optional')}`}</span>
                      </span>
                      <DocPill state={d.state} />
                    </Link>
                  )
                })}
              </div>
            )}
          </Section>

          <Section title={t('msg.title')} action={<Link to="/messages" className="t-small">{t('action.seeAll')}</Link>} flush>
            {messages.length === 0 ? <Vide icon="messages" title={t('ls.noMessages')} /> : (
              <div>
                {messages.map((m) => (
                  <div key={m.id} className={`ls-note ${m.direction === 'entrant' ? 'ls-msg--in' : 'ls-msg--out'}`}>
                    <span className="ls-note__text">{m.body}</span>
                    <span className="ls-note__meta">
                      <span>{m.direction === 'entrant' ? name : (db.users.find((u) => u.id === m.authorId)?.name ?? db.agency.name)}</span>
                      <span>{t(`channel.${m.channel}` as 'channel.whatsapp')}</span>
                      <Ago iso={m.at} />
                      {m.automated && <Pill tone="violet">{t('msg.automated')}</Pill>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title={t('ls.notes')} action={v.can('case:write') && cases.length > 0 ? <Button size="sm" icon="phone" onClick={() => setCallOpen(true)}>{t('notes.logCall')}</Button> : undefined} flush>
            {notes.length === 0 ? <Vide icon="edit" title={t('ls.noNotes')} /> : (
              <div>
                {notes.map((n) => (
                  <div key={n.id} className="ls-note">
                    <span className="ls-note__text">{n.text}</span>
                    <span className="ls-note__meta">
                      <span>{db.users.find((u) => u.id === n.authorId)?.name ?? '·'}</span>
                      <Link to={`/dossiers/${n.caseId}`} className="ls-mono">{n.reference}</Link>
                      <Ago iso={n.at} />
                      {n.kind === 'appel' && <Pill tone="blue">{t('notes.logCall')}</Pill>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <TravelPanel caseId={null} clientId={client.id} officeId={client.officeId} />
          <ContactsCard clientId={client.id} />
          <CompanySection clientId={client.id} />
          <CustomFields entityKind="CLIENT" entityId={client.id} />

          <Section title={t('caseDetail.history')} flush>
            {events.length === 0 ? <Vide icon="clock" title={t('dash.noAttention')} /> : (
              <div className="list">
                {events.map((e) => (
                  <div key={e.id} className="list__row">
                    <Icon name={e.automated ? 'automations' : 'check'} size={16} className="t-tertiary" />
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <span className="t-small t-truncate">{tt(e.detail)}</span>
                      <span className="t-caption t-tertiary"><Ago iso={e.at} /></span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <AuditTrail entityType="clients" entityId={client.id} />
        </div>

        <aside className="pg-fiche__rail">
          <Section>
            <div className="ls-id">
              <Avatar name={name} size="lg" />
              <div className="col" style={{ minWidth: 0 }}>
                <span className="ls-id__name">{name}</span>
                <span className="ls-id__sub">{client.nativeName ? `${client.nativeName} · ` : ''}{client.nationality}</span>
              </div>
            </div>
            <Ligne label={t('clients.contact')} mono>{client.phone}</Ligne>
            {client.whatsapp && client.whatsapp !== client.phone && <Ligne label="WhatsApp" mono>{client.whatsapp}</Ligne>}
            {client.email && <Ligne label={t('login.email')}><span className="t-truncate" style={{ display: 'inline-block', maxWidth: 200 }}>{client.email}</span></Ligne>}
            {client.birthDate && <Ligne label={t('ls.birth')}>{formatDate(client.birthDate)}</Ligne>}
            {client.address && <Ligne label={t('ls.address')}>{client.address}</Ligne>}
            <Ligne label={t('clients.passport')} mono>{client.passportNumber ?? '·'}</Ligne>
            <Ligne label={t('clients.expiry')}>
              <span className={passportCls}>{client.passportExpiry ? formatDate(client.passportExpiry) : '·'}</span>
              {client.passportExpiry && <span className={`t-caption ${passportCls}`} style={{ display: 'block' }}>{passportText}</span>}
            </Ligne>
            <Ligne label={t('misc.language')}>{client.locale.toUpperCase()}</Ligne>
            <Ligne label={t('misc.office')}>{db.agency.offices.find((o) => o.id === client.officeId)?.name ?? '·'}</Ligne>
            <Ligne label={t('clients.since')}>{formatDate(client.createdAt)}</Ligne>

            <div className="ls-gestes">
              {canCase && <Button size="sm" icon="plus" variant="primary" onClick={() => setCreating(true)}>{t('cases.newCase')}</Button>}
              {wa && <a className="btn btn--secondary btn--sm" href={wa} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={16} /> WhatsApp</a>}
              <a className="btn btn--secondary btn--sm" href={`tel:${client.phone.replace(/\s/g, '')}`}><Icon name="phone" size={16} /> {t('action.call')}</a>
              {v.can('client:write') && <Button size="sm" icon="edit" onClick={() => setEditing(true)}>{t('crud.edit')}</Button>}
            </div>
          </Section>

          <TagsPicker clientId={client.id} />
          <CreditCard clientId={client.id} />
        </aside>
      </div>
    </>
  )
}

/* Noter un appel, en un geste. C'est le besoin le plus fréquent de l'employée
   de comptoir, et il n'existait nulle part : le téléphone sonne cent fois par
   jour. La note se range sur le dossier ouvert le plus récent du client. */
function CallNote({ cases, onClose }: { cases: VisaCase[]; onClose: () => void }) {
  const { actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const [text, setText] = useState('')
  const open = cases.filter((c) => c.status === 'ouvert')
  const [caseId, setCaseId] = useState(open[0]?.id ?? cases[0]?.id ?? '')
  return (
    <Modal title={t('notes.logCall')} onClose={onClose} footer={<>
      <Button onClick={onClose}>{t('action.cancel')}</Button>
      <Button variant="primary" disabled={!text.trim() || !caseId} onClick={() => {
        actions.addNote(caseId, text.trim(), 'appel')
        onClose(); toast(t('notes.callLogged'))
      }}>{t('action.confirm')}</Button>
    </>}>
      <div className="col gap-4">
        {cases.length > 1 && (
          <Field label={t('cases.title')}>
            <Select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              {cases.map((c) => <option key={c.id} value={c.id}>{c.reference}</option>)}
            </Select>
          </Field>
        )}
        <Field label={t('notes.whatSaid')}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t('notes.callPlaceholder')} autoFocus />
        </Field>
      </div>
    </Modal>
  )
}
