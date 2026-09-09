import { useMemo, useState } from 'react'
import { useI18n } from '@/i18n'
import type { TKey } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import type { Tone } from '@/lib/derive'
import { Button, Empty, Field, Input, Modal, Pill, Segmented, Select, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import {
  Erreur, Kpi, KpiGrid, PageHeader, Section, Squelette, Table, Toolbar, Vide, useChargement,
} from '@/components/page'
import {
  TICKET_CATEGORIES, TICKET_PRIORITIES, loadMyTickets, openTicket, rateTicket, replyToTicket,
} from '@/data/support'
import type { Ticket, TicketCategory, TicketPriority, TicketStatus } from '@/data/support'
import '@/styles/modules.css'

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

type Vue = 'ouverts' | 'clos' | 'tous'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function Support() {
  const { t, formatDate } = useI18n()
  const toast = useToast()

  const [view, setView] = useState<Vue>('ouverts')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, loading, refreshing, error, reload } = useChargement(
    () => (HAS_BACKEND ? loadMyTickets() : Promise.resolve([] as Ticket[])),
  )
  const rows = useMemo(() => data ?? [], [data])

  const compte = useMemo(() => {
    const ouverts = rows.filter((r) => OUVERTS.includes(r.status))
    const attente = rows.filter((r) => r.status === 'en_attente_client')
    const regles = rows.filter((r) => r.status === 'resolu' || r.status === 'ferme')
    const notes = rows.map((r) => r.satisfaction).filter((n): n is number => n !== null)
    const moyenne = notes.length ? Math.round((notes.reduce((s, n) => s + n, 0) / notes.length) * 10) / 10 : null
    return { ouverts: ouverts.length, attente: attente.length, regles: regles.length, moyenne, notes: notes.length }
  }, [rows])

  const shown = useMemo(() => {
    const n = norm(q.trim())
    return rows.filter((r) => {
      const ok = view === 'tous' ? true : view === 'ouverts' ? OUVERTS.includes(r.status) : !OUVERTS.includes(r.status)
      if (!ok) return false
      if (!n) return true
      return norm(`${r.subject} ${r.message}`).includes(n)
    })
  }, [rows, view, q])

  const open = rows.find((r) => r.id === openId) ?? null

  const head = (
    <PageHeader
      kicker={t('mq.kickerHelp')}
      title={t('sup.title')}
      subtitle={t('mq.supportSub')}
      refreshing={refreshing && !loading}
      refreshingLabel={t('mq.refreshing')}
      actions={HAS_BACKEND ? <>
        <Button icon="refresh" onClick={() => void reload()} disabled={refreshing}>{t('mq.refresh')}</Button>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('sup.newTicket')}</Button>
      </> : undefined}
    />
  )

  if (!HAS_BACKEND) {
    return (
      <>
        {head}
        <Section><Empty title={t('mq.demoTitle')} hint={t('mq.demoHint')} scene="message" /></Section>
      </>
    )
  }

  return (
    <>
      {head}

      {error && <Erreur message={error} retryLabel={t('mq.retry')} onRetry={() => void reload()} />}

      {loading && !data ? (
        <>
          <Squelette type="kpis" n={4} />
          <Section flush><Squelette type="table" n={5} /></Section>
        </>
      ) : (
        <>
          <KpiGrid>
            <Kpi label={t('mq.supOpen')} value={compte.ouverts} icon="messages" tone="blue" hint={t('mq.supOpenHint')} />
            <Kpi label={t('mq.supWaiting')} value={compte.attente} icon="bell"
                 tone={compte.attente > 0 ? 'orange' : undefined} hint={t('mq.supWaitingHint')} />
            <Kpi label={t('mq.supResolved')} value={compte.regles} icon="check" tone="green"
                 hint={t('mq.supResolvedHint', { n: rows.length })} />
            <Kpi label={t('mq.supRating')} value={compte.moyenne === null ? '·' : `${compte.moyenne} / 5`} icon="star"
                 hint={compte.moyenne === null ? t('mq.supRatingNone') : t('mq.supRatingHint', { n: compte.notes })} />
          </KpiGrid>

          {rows.length === 0 ? (
            <Section>
              <Empty
                title={t('sup.noTickets')}
                hint={t('sup.noTicketsHint')}
                scene="message"
                action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('sup.newTicket')}</Button>}
              />
            </Section>
          ) : (
            <Section flush>
              <Toolbar right={<><span className="t-caption t-tertiary t-num">{t('mq.rowsOf', { n: shown.length, total: rows.length })}</span><Input className="md-search" value={q} onChange={(e) => setQ(e.target.value)}
                       placeholder={t('mq.supSearch')} aria-label={t('mq.search')} /></>}>
                <Segmented<Vue>
                  value={view}
                  onChange={setView}
                  label={t('sup.status')}
                  options={[
                    { value: 'ouverts', label: `${t('mq.supOpenShort')} · ${compte.ouverts}` },
                    { value: 'clos', label: `${t('mq.supClosed')} · ${compte.regles}` },
                    { value: 'tous', label: `${t('mq.all')} · ${rows.length}` },
                  ]}
                />
              </Toolbar>

              {shown.length === 0 ? (
                <Vide title={t('mq.nothingInFilter')} hint={t('mq.nothingInFilterHint')} icon="search" />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>{t('sup.subject')}</th>
                      <th className="col-optional">{t('sup.category')}</th>
                      <th className="col-optional">{t('sup.priority')}</th>
                      <th>{t('sup.status')}</th>
                      <th className="col-optional">{t('sup.updated')}</th>
                      <th className="actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id} className="adm-row--click" onClick={() => setOpenId(r.id)}>
                        <td>
                          <div className="adm-cell-main">
                            <span>{r.subject}</span>
                            <span className="t-caption">{t('mq.supMessages', { n: r.thread.length })} · {t('sup.opened')} {formatDate(r.created_at)}</span>
                          </div>
                        </td>
                        <td className="col-optional t-secondary">{t(CAT_LABEL[r.category])}</td>
                        <td className="col-optional"><Pill tone={PRIO_TONE[r.priority]}>{t(PRIO_LABEL[r.priority])}</Pill></td>
                        <td><Pill tone={STATUS_TONE[r.status]} dot>{t(STATUS_LABEL[r.status])}</Pill></td>
                        <td className="col-optional t-tertiary">{formatDate(r.updated_at)}</td>
                        <td className="actions" onClick={(e) => e.stopPropagation()}>
                          {r.status !== 'ferme' && <Button size="sm" icon="mail" onClick={() => setOpenId(r.id)}>{t('sup.reply')}</Button>}
                          <Button size="sm" onClick={() => setOpenId(r.id)}>{t('mq.open')}</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Section>
          )}
        </>
      )}

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
              // Le camp se lit à la couleur : dans un fil de dix messages,
              // relire l'étiquette à chaque ligne fatigue.
              <div key={m.id} className={`md-bulle ${nous ? 'md-bulle--nous' : 'md-bulle--eux'}`}>
                <span className="row gap-2">
                  <Icon name={nous ? 'clients' : 'shield'} size={14} />
                  <span className="t-caption t-medium">{nous ? t('sup.fromAgency') : t('sup.fromPlatform')}</span>
                  <span className="grow" />
                  <span className="t-caption t-tertiary">{formatDate(m.at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </span>
                <span className="t-small md-bulle__texte">{m.body}</span>
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
              <div className="row gap-2 wrap">
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
