import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Avatar, Button, Card, Empty, Field, Input, Modal, Pill, Progress, Select, Tabs, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { Ago, Countdown, DocPill, PageHead, StagePill, StatusPill } from '@/components/bits'
import { CaseEditor } from '@/components/CaseEditor'
import { blockingDocs, caseBalance, daysSince, progress } from '@/lib/derive'
import type { AppointmentKind, Channel, DocState, PaymentMethod } from '@/data/types'

type Tab = 'apercu' | 'pieces' | 'messages' | 'rdv' | 'paiements' | 'historique'

export function CaseDetail() {
  const { id = '' } = useParams()
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt, formatDate, formatMoney } = useI18n()
  const toast = useToast()
  // L'onglet vit dans l'adresse : le lien se partage et le retour marche.
  const [params, setParams] = useSearchParams()
  const tab = (params.get('onglet') as Tab | null) ?? 'apercu'
  const setTab = (value: Tab) => setParams(value === 'apercu' ? {} : { onglet: value }, { replace: true })
  const [deciding, setDeciding] = useState(false)
  const [editing, setEditing] = useState(false)

  // Hors perimetre, le dossier n'existe pas. On ne confirme meme pas sa reference.
  const kase = v.cases.find((c) => c.id === id)
  if (!kase) return <Empty title={t('cases.none')} action={<Link to="/dossiers" className="btn btn--secondary">{t('action.back')}</Link>} />

  const client = db.clients.find((c) => c.id === kase.clientId)!
  const visa = db.visaTypes.find((v) => v.id === kase.visaTypeId)!
  const agent = db.users.find((u) => u.id === kase.assigneeId)
  const office = db.agency.offices.find((o) => o.id === kase.officeId)
  const docs = db.documents.filter((d) => d.caseId === kase.id)
  const messages = db.messages.filter((m) => m.caseId === kase.id)
  const appts = db.appointments.filter((a) => a.caseId === kase.id)
  const payments = db.payments.filter((p) => p.caseId === kase.id)
  const events = db.events.filter((e) => e.caseId === kase.id)
  const p = progress(db, kase.id)
  const blocking = blockingDocs(db, kase.id)

  // Le lien porte l'agence et la langue du client : sans elles, il ouvre la
  // mauvaise agence et s'affiche dans la mauvaise langue.
  const portalUrl = `${window.location.origin}${import.meta.env.BASE_URL}portail/${kase.portalToken}?agency=${db.agency.slug}&lang=${client.locale}`

  const copyPortal = async () => {
    try {
      await navigator.clipboard.writeText(portalUrl)
      toast(t('action.copied'))
    } catch {
      toast(portalUrl)
    }
  }

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'apercu', label: t('caseDetail.overview') },
    { value: 'pieces', label: t('caseDetail.documents'), count: docs.length },
    { value: 'messages', label: t('caseDetail.messages'), count: messages.length },
    { value: 'rdv', label: t('caseDetail.appointments'), count: appts.length },
    { value: 'paiements', label: t('caseDetail.payments'), count: payments.length },
    { value: 'historique', label: t('caseDetail.history') },
  ]

  return (
    <>
      <Link to="/dossiers" className="row gap-2 t-small" style={{ marginBottom: 'var(--sp-4)' }}>
        <Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} />
        {t('cases.title')}
      </Link>

      <PageHead
        title={`${client.firstName} ${client.lastName}`}
        subtitle={`${kase.reference} · ${tt(visa.country)} ${tt(visa.label)}`}
        action={
          <div className="row gap-2">
            {v.can('case:write') && <Button icon="edit" onClick={() => setEditing(true)}>{t('crud.edit')}</Button>}
            <Button icon="copy" onClick={copyPortal}>{t('caseDetail.portalLink')}</Button>
            {kase.status === 'ouvert' && ['decision', 'consulat', 'depot'].includes(kase.stage) && (
              <Button icon="check" onClick={() => setDeciding(true)}>{t('status.accepte')} / {t('status.refuse')}</Button>
            )}
            {kase.status === 'ouvert' && kase.stage !== 'clos' && v.can('case:write') && (
              <Button variant="primary" icon="arrow" onClick={() => { actions.advance(kase.id); toast(t('caseDetail.advance')) }}>
                {t('caseDetail.advance')}
              </Button>
            )}
          </div>
        }
      />

      {deciding && <Decision caseId={kase.id} onClose={() => setDeciding(false)} />}
      {editing && <CaseEditor kase={kase} onClose={() => setEditing(false)} />}

      <div className="grid grid--main">
        <div className="stack">
          <Card flush>
            <Tabs value={tab} options={tabs} onChange={setTab} />
            <div style={{ padding: 'var(--sp-6)' }}>
              {tab === 'apercu' && <Overview kase={kase} />}
              {tab === 'pieces' && <DocsTab caseId={kase.id} />}
              {tab === 'messages' && <MessagesTab caseId={kase.id} />}
              {tab === 'rdv' && <ApptsTab caseId={kase.id} />}
              {tab === 'paiements' && <PaymentsTab caseId={kase.id} />}
              {tab === 'historique' && (
                events.length === 0 ? <Empty title={t('msg.none')} /> : (
                  <ul className="timeline">
                    {events.map((e) => (
                      <li key={e.id} className="timeline__item">
                        <span className={`timeline__dot ${e.automated ? '' : 'timeline__dot--done'}`} />
                        <div className="col gap-1">
                          <span className="t-small">{tt(e.detail)}</span>
                          <span className="t-caption t-tertiary">
                            <Ago iso={e.at} />
                            {e.actorId && ` · ${db.users.find((u) => u.id === e.actorId)?.name ?? ''}`}
                            {e.automated && ` · ${t('msg.automated')}`}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title={t('caseDetail.overview')}>
            <div className="col gap-4">
              <div className="row-between">
                <span className="t-small t-secondary">{t('cases.stage')}</span>
                {kase.status === 'ouvert' ? <StagePill stage={kase.stage} /> : <StatusPill status={kase.status} />}
              </div>
              <div className="col gap-2">
                <div className="row-between">
                  <span className="t-small t-secondary">{t('cases.progress')}</span>
                  <span className="t-small t-num">{t('caseDetail.completion', { done: p.done, total: p.total })}</span>
                </div>
                <Progress pct={p.pct} tone={p.pct === 100 ? 'green' : p.pct < 40 ? 'orange' : undefined} />
              </div>
              <hr className="divider" style={{ margin: 0 }} />
              <Row label={t('caseDetail.assignedTo')} value={agent?.name} />
              <Row label={t('caseDetail.office')} value={office?.name} />
              <Row label={t('caseDetail.openedOn')} value={formatDate(kase.openedAt)} />
              <Row label={t('caseDetail.travelOn')} value={<Countdown iso={kase.travelDate} />} />
              <Row label={t('caseDetail.source')} value={t(`source.${kase.source}` as 'source.comptoir')} />
              {kase.consulateRef && <Row label={t('caseDetail.consulateRef')} value={<span className="t-mono">{kase.consulateRef}</span>} />}
              {v.can('payment:write') && (
                <Row label={t('cases.balance')} value={caseBalance(kase) > 0 ? formatMoney(caseBalance(kase)) : t('payment.regle')} />
              )}
            </div>
          </Card>

          <Card title={t('cases.client')} action={<Link to={`/clients/${client.id}`} className="t-small">{t('action.open')}</Link>}>
            <div className="row gap-3" style={{ marginBottom: 'var(--sp-4)' }}>
              <Avatar name={`${client.firstName} ${client.lastName}`} size="lg" />
              <div className="col">
                <span className="t-medium">{client.firstName} {client.lastName}</span>
                {client.nativeName && <span className="t-small t-tertiary">{client.nativeName}</span>}
                <span className="t-caption t-tertiary">{client.nationality}</span>
              </div>
            </div>
            <div className="col gap-3">
              <Row label={t('clients.contact')} value={<span className="t-mono t-small">{client.phone}</span>} />
              <Row label={t('clients.passport')} value={<span className="t-mono t-small">{client.passportNumber}</span>} />
              <Row label={t('clients.expiry')} value={formatDate(client.passportExpiry)} />
              <Row label={t('misc.language')} value={client.locale.toUpperCase()} />
            </div>
            <div className="row gap-2" style={{ marginTop: 'var(--sp-5)' }}>
              <a className="btn btn--secondary btn--sm" href={`https://wa.me/${client.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">
                <Icon name="whatsapp" size={16} /> WhatsApp
              </a>
              <a className="btn btn--secondary btn--sm" href={`tel:${client.phone.replace(/\s/g, '')}`}>
                <Icon name="phone" size={16} /> {t('action.call')}
              </a>
            </div>
          </Card>

          {blocking.length > 0 && (
            <Card title={t('caseDetail.nextStep')}>
              <div className="col gap-3">
                {blocking.slice(0, 4).map((d) => (
                  <div key={d.id} className="row-between">
                    <span className="t-small t-truncate">{tt(d.label)}</span>
                    <DocPill state={d.state} />
                  </div>
                ))}
                <Button
                  variant="primary"
                  block
                  icon="messages"
                  onClick={() => { const n = actions.requestMissingDocs(kase.id); toast(n ? t('msg.sent') : t('docs.none')) }}
                >
                  {t('docs.requestAll')}
                </Button>
              </div>
            </Card>
          )}

          <Card title={t('caseDetail.notes')}>
            <NoteBox caseId={kase.id} />
          </Card>
        </div>
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="row-between">
      <span className="t-small t-secondary">{label}</span>
      <span className="t-small" style={{ textAlign: 'end' }}>{value ?? '—'}</span>
    </div>
  )
}

/* ------------------------------ Apercu ------------------------------- */

function Overview({ kase }: { kase: import('@/data/types').VisaCase }) {
  const { db } = useStore()
  const { t, tt, formatDate } = useI18n()
  const visa = db.visaTypes.find((v) => v.id === kase.visaTypeId)!
  const stages = visa.stages
  const currentIndex = stages.indexOf(kase.stage)

  return (
    <div className="stack">
      <ul className="timeline">
        {stages.map((s, i) => (
          <li key={s} className="timeline__item">
            <span className={`timeline__dot ${i < currentIndex ? 'timeline__dot--done' : i === currentIndex ? 'timeline__dot--current' : ''}`}>
              {i < currentIndex && <Icon name="check" size={10} className="t-white" />}
            </span>
            <div className="col gap-1">
              <span className={i === currentIndex ? 't-medium' : 't-secondary'} style={{ fontSize: 14 }}>
                {t(`stage.${s}` as 'stage.nouveau')}
              </span>
              {i === currentIndex && (
                <span className="t-caption t-tertiary">
                  {t('caseDetail.daysOpen', { n: daysSince(kase.openedAt) })}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="grid grid--2">
        <div className="col gap-2">
          <span className="t-caption t-tertiary">{t('cases.visa')}</span>
          <span className="t-medium">{tt(visa.country)} · {tt(visa.label)}</span>
          <span className="t-small t-secondary">{t('reports.days', { n: visa.processingDays })}</span>
        </div>
        <div className="col gap-2">
          <span className="t-caption t-tertiary">{t('caseDetail.dueOn')}</span>
          <span className="t-medium">{formatDate(kase.dueAt)}</span>
        </div>
      </div>

      {kase.refusalReason && (
        <div className="card" style={{ boxShadow: 'none', background: 'var(--tint-red)', padding: 'var(--sp-4)' }}>
          <span className="t-small" style={{ color: 'var(--red)' }}>{kase.refusalReason}</span>
        </div>
      )}
    </div>
  )
}

/* ------------------------------ Pieces ------------------------------- */

function DocsTab({ caseId }: { caseId: string }) {
  const { db, actions } = useStore()
  const { t, tt, formatDate } = useI18n()
  const toast = useToast()
  const docs = db.documents.filter((d) => d.caseId === caseId)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const set = (docId: string, state: DocState) => {
    actions.setDocState(docId, state)
    toast(state === 'validee' ? t('docs.validated') : t('action.save'))
  }

  return (
    <div className="col gap-3">
      {docs.map((d) => (
        <div key={d.id} className="row-between wrap gap-3" style={{ padding: 'var(--sp-3) 0', borderBottom: '1px solid var(--hairline)' }}>
          <div className="col grow" style={{ minWidth: 0 }}>
            <span className="row gap-2">
              <span className="t-medium t-small">{tt(d.label)}</span>
              {!d.required && <span className="t-caption t-tertiary">{t('misc.optional')}</span>}
            </span>
            <span className="t-caption t-tertiary">
              {d.fileName ?? t('portal.uploadHint')}
              {d.expiresAt && ` · ${t('docs.expiresOn')} ${formatDate(d.expiresAt)}`}
              {d.reminders > 0 && ` · ${t('docs.reminders')} ${d.reminders}`}
              {d.validatedAt && ` · ${t('docs.validated')} ${formatDate(d.validatedAt)}`}
              {d.validatedBy && ` · ${db.users.find((u) => u.id === d.validatedBy)?.name ?? ''}`}
            </span>
            {d.rejectionReason && d.state === 'refusee' && (
              <span className="t-caption" style={{ color: 'var(--red)' }}>{d.rejectionReason}</span>
            )}
          </div>
          <DocPill state={d.state} />
          <div className="row gap-1">
            {['manquante', 'demandee'].includes(d.state) && (
              <>
                {d.state === 'manquante' && (
                  <Button size="sm" icon="messages" onClick={() => { actions.setDocState(d.id, 'demandee'); toast(t('msg.sent')) }}>{t('action.request')}</Button>
                )}
                {d.state === 'demandee' && (
                  <Button size="sm" icon="bell" onClick={() => { actions.remindDoc(d.id); toast(t('action.remind')) }}>{t('action.remind')}</Button>
                )}
                {/* Le papier posé sur le comptoir : le geste le plus fréquent
                    de la journée, il lui fallait un bouton. */}
                <Button size="sm" icon="building" onClick={() => set(d.id, 'recue')}>{t('notes.counter')}</Button>
              </>
            )}
            {['recue', 'expiree', 'refusee'].includes(d.state) && (
              <>
                <Button size="sm" variant="primary" icon="check" onClick={() => set(d.id, 'validee')}>{t('action.validate')}</Button>
                <Button size="sm" variant="danger" icon="close" onClick={() => { setRejecting(d.id); setReason('') }}>{t('action.reject')}</Button>
              </>
            )}
            {d.state === 'validee' && (
              <Button size="sm" icon="edit" onClick={() => actions.setDocState(d.id, 'recue')}>{t('crud.edit')}</Button>
            )}
          </div>
        </div>
      ))}

      {rejecting && (
        <Modal
          title={t('docs.rejected')}
          onClose={() => setRejecting(null)}
          footer={
            <>
              <Button onClick={() => setRejecting(null)}>{t('action.cancel')}</Button>
              <Button variant="danger" onClick={() => { actions.setDocState(rejecting, 'refusee', reason); setRejecting(null); toast(t('docs.rejected')) }}>
                {t('action.reject')}
              </Button>
            </>
          }
        >
          <Field label={t('docs.reason')}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Document illisible, merci de reprendre la photo à plat." />
          </Field>
        </Modal>
      )}
    </div>
  )
}

/* ----------------------------- Messages ------------------------------ */

function MessagesTab({ caseId }: { caseId: string }) {
  const { db, actions } = useStore()
  const { t, tt } = useI18n()
  const toast = useToast()
  const messages = db.messages.filter((m) => m.caseId === caseId)
  const kase = db.cases.find((c) => c.id === caseId)!
  const client = db.clients.find((c) => c.id === kase.clientId)!
  const [body, setBody] = useState('')
  const [channel, setChannel] = useState<Channel>('whatsapp')
  const [templateId, setTemplateId] = useState('')

  const applyTemplate = (id: string) => {
    setTemplateId(id)
    const tpl = db.templates.find((x) => x.id === id)
    if (!tpl) return
    setChannel(tpl.channel)
    setBody(
      (tpl.body[client.locale] ?? tpl.body.fr)
        .replace('{client}', client.firstName)
        .replace('{reference}', kase.reference)
        .replace('{montant}', String(kase.amountTotal - kase.amountPaid))
        .replace('{bureau}', db.agency.offices.find((o) => o.id === kase.officeId)?.name ?? '')
        .replace('{pays}', db.visaTypes.find((v) => v.id === kase.visaTypeId)?.country[client.locale] ?? ''),
    )
  }

  const send = () => {
    if (!body.trim()) return
    actions.sendMessage({ caseId, body: body.trim(), channel, templateKey: db.templates.find((x) => x.id === templateId)?.key })
    setBody('')
    setTemplateId('')
    toast(t('msg.sent'))
  }

  return (
    <div className="col gap-5">
      {messages.length === 0 ? (
        <Empty title={t('msg.none')} />
      ) : (
        <div className="col gap-3">
          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                alignSelf: m.direction === 'sortant' ? 'flex-end' : 'flex-start',
                maxWidth: '78%',
                background: m.direction === 'sortant' ? 'var(--tint-blue)' : 'var(--bg-hover)',
                borderRadius: 'var(--radius-card-sm)',
                padding: 'var(--sp-3) var(--sp-4)',
              }}
            >
              <p className="t-small" style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
              <span className="t-caption t-tertiary row gap-2" style={{ marginTop: 4 }}>
                <Icon name={m.channel === 'whatsapp' ? 'whatsapp' : m.channel === 'email' ? 'mail' : 'portal'} size={12} />
                <Ago iso={m.at} />
                {m.automated && <Pill tone="violet">{t('msg.automated')}</Pill>}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="col gap-3" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--sp-5)' }}>
        <div className="row gap-3 wrap">
          <Select value={templateId} onChange={(e) => applyTemplate(e.target.value)} style={{ width: 'auto' }}>
            <option value="">{t('msg.noTemplate')}</option>
            {db.templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>{tt(tpl.name)}</option>
            ))}
          </Select>
          <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} style={{ width: 'auto' }}>
            {(['whatsapp', 'email', 'sms', 'portail'] as Channel[]).map((c) => (
              <option key={c} value={c}>{t(`channel.${c}` as 'channel.whatsapp')}</option>
            ))}
          </Select>
          <span className="t-caption t-tertiary row gap-1">
            <Icon name="language" size={14} /> {t('msg.languageAuto')} ({client.locale.toUpperCase()})
          </span>
        </div>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('msg.placeholder')} />
        <div className="row-between">
          <span className="t-caption t-tertiary">{t('portal.privacy')}</span>
          <span className="row gap-2">
            {/* Tant que l'API n'est pas branchée, on ouvre WhatsApp avec le
                texte déjà écrit : six manipulations en moins sur sept. */}
            <a
              className={`btn btn--secondary btn--sm ${body.trim() ? '' : 'btn--disabled'}`}
              href={`https://wa.me/${(client.whatsapp ?? client.phone).replace(/[^0-9]/g, '')}?text=${encodeURIComponent(body)}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => { if (body.trim()) send() }}
            >
              <Icon name="whatsapp" size={16} /> WhatsApp
            </a>
            <Button variant="primary" icon="messages" onClick={send} disabled={!body.trim()}>{t('action.send')}</Button>
          </span>
        </div>
      </div>
    </div>
  )
}

/* --------------------------- Rendez vous ----------------------------- */

function ApptsTab({ caseId }: { caseId: string }) {
  const { db, actions } = useStore()
  const { t, formatDate } = useI18n()
  const toast = useToast()
  const appts = db.appointments.filter((a) => a.caseId === caseId).sort((a, b) => a.at.localeCompare(b.at))
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<AppointmentKind>('agence')
  const [at, setAt] = useState('')
  const kase = db.cases.find((c) => c.id === caseId)!

  return (
    <div className="col gap-4">
      {appts.length === 0 && <Empty title={t('appts.none')} />}
      {appts.map((a) => (
        <div key={a.id} className="row-between" style={{ paddingBottom: 'var(--sp-3)', borderBottom: '1px solid var(--hairline)' }}>
          <div className="col">
            <span className="t-medium t-small">{t(`appt.${a.kind}` as 'appt.agence')}</span>
            <span className="t-caption t-tertiary">{a.location}</span>
          </div>
          <div className="col" style={{ textAlign: 'end' }}>
            <span className="t-small t-num">
              {formatDate(a.at, { weekday: 'short', day: '2-digit', month: 'short' })}
              {' · '}
              {new Date(a.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="t-caption t-tertiary">{t(`appt.${a.status}` as 'appt.prevu')}</span>
          </div>
        </div>
      ))}

      <Button icon="plus" onClick={() => setOpen(true)}>{t('appts.newAppt')}</Button>

      {open && (
        <Modal
          title={t('appts.newAppt')}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button onClick={() => setOpen(false)}>{t('action.cancel')}</Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (!at) return
                  actions.addAppointment({
                    caseId, kind, at: new Date(at).toISOString(), durationMin: 30,
                    location: db.agency.offices.find((o) => o.id === kase.officeId)?.address ?? '',
                    status: 'prevu',
                  })
                  setOpen(false)
                  toast(t('appts.newAppt'))
                }}
              >
                {t('action.confirm')}
              </Button>
            </>
          }
        >
          <div className="col gap-4">
            <Field label={t('appts.title')}>
              <Select value={kind} onChange={(e) => setKind(e.target.value as AppointmentKind)}>
                {(['agence', 'consulat', 'biometrie', 'retrait'] as AppointmentKind[]).map((x) => (
                  <option key={x} value={x}>{t(`appt.${x}` as 'appt.agence')}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('appts.at')}>
              <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ---------------------------- Paiements ------------------------------ */

function PaymentsTab({ caseId }: { caseId: string }) {
  const { db, actions } = useStore()
  const { t, tt, formatMoney, formatDate } = useI18n()
  const toast = useToast()
  const payments = db.payments.filter((p) => p.caseId === caseId)
  const [cashing, setCashing] = useState<string | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('especes')

  return (
    <div className="col gap-3">
      {payments.map((p) => (
        <div key={p.id} className="row-between" style={{ paddingBottom: 'var(--sp-3)', borderBottom: '1px solid var(--hairline)' }}>
          <div className="col">
            <span className="t-small t-medium">{tt(p.label)}</span>
            <span className="t-caption t-tertiary">
              {p.state === 'regle'
                ? `${t(`payment.${p.method ?? 'especes'}` as 'payment.especes')} · ${formatDate(p.at)} · ${p.receiptNo ?? ''}`
                : `${t('caseDetail.dueOn')} ${formatDate(p.dueAt)}`}
            </span>
          </div>
          <div className="row gap-3">
            <span className="t-medium t-num">{formatMoney(p.amount)}</span>
            {p.state === 'regle' ? (
              <Pill tone="green" dot>{t('payment.regle')}</Pill>
            ) : (
              <Button size="sm" variant="primary" onClick={() => { setCashing(p.id); setMethod('especes') }}>
                {t('action.markPaid')}
              </Button>
            )}
          </div>
        </div>
      ))}
      <p className="t-caption t-tertiary">{t('pay.subtitle')}</p>

      {cashing && (
        <Modal
          title={t('action.markPaid')}
          onClose={() => setCashing(null)}
          footer={
            <>
              <Button onClick={() => setCashing(null)}>{t('action.cancel')}</Button>
              <Button
                variant="primary"
                onClick={() => { actions.markPaymentPaid(cashing, method); setCashing(null); toast(t('action.markPaid')) }}
              >
                {t('action.confirm')}
              </Button>
            </>
          }
        >
          <Field label={t('pay.method')}>
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {(['especes', 'virement', 'carte', 'cheque'] as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>{t(`payment.${m}` as 'payment.especes')}</option>
              ))}
            </Select>
          </Field>
        </Modal>
      )}
    </div>
  )
}

/* ----------------------------- Decision ------------------------------ */

function Decision({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const { actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const [status, setStatus] = useState<'accepte' | 'refuse' | 'annule'>('accepte')
  const [reason, setReason] = useState('')

  return (
    <Modal
      title={t('caseDetail.overview')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              actions.decideCase(caseId, status, reason || undefined)
              onClose()
              toast(t('crud.updated'))
            }}
          >
            {t('action.confirm')}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label={t('cases.stage')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as 'accepte' | 'refuse' | 'annule')}>
            <option value="accepte">{t('status.accepte')}</option>
            <option value="refuse">{t('status.refuse')}</option>
            <option value="annule">{t('status.annule')}</option>
          </Select>
        </Field>
        {status === 'refuse' && (
          <Field label={t('docs.reason')}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------ Notes -------------------------------- */

/* Les notes s'empilent, datees et signees. Un bouton pose l'appel en un geste,
   parce qu'on ne tape pas cinq champs avec un client au telephone. */
function NoteBox({ caseId }: { caseId: string }) {
  const { db, actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const [text, setText] = useState('')
  const notes = db.cases.find((c) => c.id === caseId)?.notes ?? []

  const add = (kind: 'note' | 'appel' | 'comptoir', body?: string) => {
    const content = body ?? text.trim()
    if (!content) return
    actions.addNote(caseId, content, kind)
    setText('')
    toast(t('crud.created'))
  }

  return (
    <div className="col gap-4">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t('caseDetail.addNote')} />
      <div className="row gap-2 wrap">
        <Button variant="primary" size="sm" disabled={!text.trim()} onClick={() => add('note')}>
          {t('action.save')}
        </Button>
        <Button size="sm" icon="phone" onClick={() => add('appel', text.trim() || t('notes.called'))}>
          {t('notes.called')}
        </Button>
        <Button size="sm" icon="building" onClick={() => add('comptoir', text.trim() || t('notes.counter'))}>
          {t('notes.counter')}
        </Button>
      </div>
      {notes.length > 0 && (
        <ul className="timeline" style={{ marginTop: 'var(--sp-2)' }}>
          {notes.map((note) => (
            <li key={note.id} className="timeline__item">
              <span className="timeline__dot" />
              <div className="col gap-1">
                <span className="t-small">{note.text}</span>
                <span className="t-caption t-tertiary">
                  <Ago iso={note.at} />
                  {note.authorId && ` · ${db.users.find((u) => u.id === note.authorId)?.name ?? ''}`}
                  {note.kind !== 'note' && ` · ${note.kind === 'appel' ? t('notes.called') : t('notes.counter')}`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
