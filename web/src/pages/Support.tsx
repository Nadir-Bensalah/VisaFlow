import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import type { TKey } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import type { Tone } from '@/lib/derive'
import { Button, Card, Empty, Field, Input, Modal, Pill, Segmented, Select, Textarea, useToast } from '@/components/ui'
import { PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'
import {
  TICKET_CATEGORIES, TICKET_PRIORITIES, loadMyTickets, openTicket, rateTicket, replyToTicket,
} from '@/data/support'
import type { Ticket, TicketCategory, TicketPriority, TicketStatus } from '@/data/support'

/**
 * L'aide, côté agence.
 *
 * Un FIL, pas un formulaire à sens unique. Une agence qui écrit et n'obtient
 * rien en retour appelle au téléphone, et le téléphone ne laisse aucune trace :
 * ni pour elle, ni pour nous.
 *
 * Ce que l'écran dit clairement, en bas de la discussion : le support lit ce
 * fil, PAS les dossiers. Regarder un dossier passe par l'ouverture de l'espace
 * de l'agence, et chaque ouverture est journalisée. Le dire évite la question
 * qui vient toujours en premier, et qui n'est pas une question de confort.
 */

const CAT_LABEL: Record<TicketCategory, TKey> = {
  question: 'sup.catQuestion',
  anomalie: 'sup.catAnomalie',
  demande: 'sup.catDemande',
  facturation: 'sup.catFacturation',
  urgence: 'sup.catUrgence',
}

const PRIO_LABEL: Record<TicketPriority, TKey> = {
  basse: 'sup.prioBasse',
  normale: 'sup.prioNormale',
  haute: 'sup.prioHaute',
  urgente: 'sup.prioUrgente',
}

const STATUS_LABEL: Record<TicketStatus, TKey> = {
  ouvert: 'sup.tkOuvert',
  pris_en_charge: 'sup.tkPrisEnCharge',
  en_attente_client: 'sup.tkEnAttenteClient',
  resolu: 'sup.tkResolu',
  ferme: 'sup.tkFerme',
}

const STATUS_TONE: Record<TicketStatus, Tone> = {
  ouvert: 'blue',
  pris_en_charge: 'orange',
  en_attente_client: 'orange',
  resolu: 'green',
  ferme: 'gray',
}

const PRIO_TONE: Record<TicketPriority, Tone> = {
  basse: 'gray', normale: 'gray', haute: 'orange', urgente: 'red',
}

const OUVERTS: TicketStatus[] = ['ouvert', 'pris_en_charge', 'en_attente_client']

export function Support() {
  const { t, formatDate } = useI18n()
  const toast = useToast()

  const [rows, setRows] = useState<Ticket[]>([])
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'ouverts' | 'clos' | 'tous'>('ouverts')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try {
      setRows(await loadMyTickets())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  if (!HAS_BACKEND) {
    return (
      <>
        <PageHead title={t('sup.title')} subtitle={t('sup.subtitle')} />
        <Card><Empty title={t('sup.offline')} hint={t('sup.offlineHint')} scene="alerte" /></Card>
      </>
    )
  }

  const shown = rows.filter((r) =>
    view === 'tous' ? true
      : view === 'ouverts' ? OUVERTS.includes(r.status)
        : !OUVERTS.includes(r.status))

  const open = rows.find((r) => r.id === openId) ?? null

  return (
    <>
      <PageHead
        title={t('sup.title')}
        subtitle={t('sup.subtitle')}
        action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('sup.newTicket')}</Button>}
      />

      {error && <Card><p className="t-small t-orange">{t('sup.loadError', { msg: error })}</p></Card>}

      <Card flush>
        <div className="row" style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--hairline)' }}>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'ouverts', label: t('sup.tkOuvert') },
              { value: 'clos', label: t('sup.tkResolu') },
              { value: 'tous', label: t('sup.status') },
            ]}
          />
        </div>

        {shown.length === 0 ? (
          <Empty
            title={t('sup.noTickets')}
            hint={t('sup.noTicketsHint')}
            action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('sup.newTicket')}</Button>}
          />
        ) : (
          <div className="tablewrap">
            <table className="table table--clickable">
              <thead>
                <tr>
                  <th>{t('sup.subject')}</th>
                  <th>{t('sup.category')}</th>
                  <th>{t('sup.priority')}</th>
                  <th>{t('sup.status')}</th>
                  <th>{t('sup.updated')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} onClick={() => setOpenId(r.id)}>
                    <td className="t-small t-medium">{r.subject}</td>
                    <td className="t-small t-secondary">{t(CAT_LABEL[r.category])}</td>
                    <td><Pill tone={PRIO_TONE[r.priority]}>{t(PRIO_LABEL[r.priority])}</Pill></td>
                    <td><Pill tone={STATUS_TONE[r.status]} dot>{t(STATUS_LABEL[r.status])}</Pill></td>
                    <td className="t-caption t-tertiary">{formatDate(r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && (
        <TicketCreator
          onClose={() => setCreating(false)}
          onDone={async (id) => {
            setCreating(false)
            toast(t('sup.sentTicket'))
            await reload()
            setOpenId(id)
          }}
        />
      )}

      {open && (
        <TicketThread
          ticket={open}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      )}
    </>
  )
}

/* ------------------------------ Ouvrir ------------------------------- */

function TicketCreator({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const { t } = useI18n()
  const [category, setCategory] = useState<TicketCategory>('question')
  const [priority, setPriority] = useState<TicketPriority>('normale')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!subject.trim() || !message.trim()) { setError(t('sup.required')); return }
    setBusy(true)
    try {
      onDone(await openTicket({ category, priority, subject: subject.trim(), message: message.trim() }))
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('sup.newTicket')}
      onClose={onClose}
      footer={
        <>
          <span className="grow" />
          <Button onClick={onClose}>{t('sup.cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>{t('sup.send')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        <div className="grid grid--2">
          <Field label={t('sup.category')}>
            <Select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>
              {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{t(CAT_LABEL[c])}</option>)}
            </Select>
          </Field>
          <Field label={t('sup.priority')}>
            <Select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
              {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{t(PRIO_LABEL[p])}</option>)}
            </Select>
          </Field>
        </div>
        <Field label={t('sup.subject')}>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus />
        </Field>
        <Field label={t('sup.message')} hint={t('sup.replyHint')}>
          <Textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <p className="t-caption t-tertiary">{t('sup.privacy')}</p>
        {error && <p className="t-small t-orange">{error}</p>}
      </div>
    </Modal>
  )
}

/* ------------------------------- Le fil ------------------------------ */

function TicketThread({ ticket, onClose, onChanged }: {
  ticket: Ticket
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const { t, formatDate } = useI18n()
  const toast = useToast()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const guard = async (job: () => Promise<void>) => {
    setBusy(true)
    try { await job(); setError(null) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const closed = ticket.status === 'ferme'

  return (
    <Modal
      title={ticket.subject}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="grow" />
          <Button onClick={onClose}>{t('sup.cancel')}</Button>
          {!closed && (
            <Button
              variant="primary"
              icon="mail"
              disabled={busy || !body.trim()}
              onClick={() => void guard(async () => {
                await replyToTicket(ticket.id, body.trim())
                setBody('')
                toast(t('sup.sentReply'))
                await onChanged()
              })}
            >
              {t('sup.send')}
            </Button>
          )}
        </>
      }
    >
      <div className="col gap-4">
        <div className="row gap-3 wrap">
          <Pill tone={STATUS_TONE[ticket.status]} dot>{t(STATUS_LABEL[ticket.status])}</Pill>
          <Pill tone={PRIO_TONE[ticket.priority]}>{t(PRIO_LABEL[ticket.priority])}</Pill>
          <span className="t-caption t-tertiary">
            {t('sup.opened')} {formatDate(ticket.created_at)}
          </span>
        </div>

        <div className="col gap-3">
          <span className="t-small t-medium">{t('sup.thread')}</span>
          {ticket.thread.map((m) => {
            const nous = m.author_kind === 'agence'
            return (
              <div
                key={m.id}
                className="col gap-1"
                style={{
                  padding: 'var(--sp-3) var(--sp-4)',
                  borderRadius: 'var(--radius-md, 10px)',
                  // Le camp se lit à la couleur : dans un fil de dix messages,
                  // relire l'étiquette à chaque ligne fatigue.
                  background: nous ? 'var(--surface-sunken, rgba(0,0,0,.04))' : 'var(--tint-blue, rgba(0,102,204,.08))',
                }}
              >
                <span className="row gap-2">
                  <Icon name={nous ? 'clients' : 'shield'} size={14} />
                  <span className="t-caption t-medium">{nous ? t('sup.fromAgency') : t('sup.fromPlatform')}</span>
                  <span className="grow" />
                  <span className="t-caption t-tertiary">{formatDate(m.at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </span>
                <span className="t-small" style={{ whiteSpace: 'pre-wrap' }}>{m.body}</span>
              </div>
            )
          })}
        </div>

        {!closed && (
          <Field label={t('sup.reply')} hint={t('sup.replyHint')}>
            <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
        )}

        {/* La note se demande une fois, quand la demande est réglée. */}
        {(ticket.status === 'resolu' || ticket.status === 'ferme') && (
          <div className="col gap-2" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--sp-4)' }}>
            <span className="t-small t-medium">{t('sup.rate')}</span>
            {ticket.satisfaction ? (
              <span className="t-small t-tertiary">{t('sup.rated')} · {ticket.satisfaction}/5</span>
            ) : (
              <div className="row gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    disabled={busy}
                    onClick={() => void guard(async () => {
                      await rateTicket(ticket.id, n)
                      toast(t('sup.rated'))
                      await onChanged()
                    })}
                  >
                    {n}
                  </Button>
                ))}
                <span className="t-caption t-tertiary">{t('sup.rateHint')}</span>
              </div>
            )}
          </div>
        )}

        <p className="t-caption t-tertiary">{t('sup.privacy')}</p>
        {error && <p className="t-small t-orange">{error}</p>}
      </div>
    </Modal>
  )
}
