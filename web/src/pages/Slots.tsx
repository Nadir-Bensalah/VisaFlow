import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Field, IconButton, Input, Modal, Pill, Segmented, Select, useToast } from '@/components/ui'
import { Ago, PageHead, PriorityPill } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { SlotAlert } from '@/components/SlotAlert'
import { freedSlots } from '@/lib/creneaux'
import { ATTEMPT_TONE, clientName, daysSince, queueOf, realWaitDays } from '@/lib/derive'
import type { AttemptResult, Consulate, Priority, QueueEntry } from '@/data/types'

/* L'ecran du creneau.
   C'est ici que passe l'essentiel de la marge : sur un ticket d'environ 550
   dinars, 200 a 350 viennent du fait d'avoir decroche le rendez-vous. Le
   travail reel de l'agent, jusqu'ici invisible, tient en deux gestes :
   il essaie, et parfois il obtient. On trace les deux. */

/* « creneau_libre » vient juste après « aucun créneau » : c'est le résultat le
   plus précieux du lot, celui qui déclenche l'alerte et fait gagner la course. */
const RESULTS: AttemptResult[] = [
  'aucun_creneau', 'creneau_libre', 'creneau_pris', 'site_indisponible', 'compte_bloque', 'erreur',
]

export function Slots() {
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt, formatDate } = useI18n()
  const toast = useToast()
  const [view, setView] = useState<'queue' | 'attempts'>('queue')
  const [adding, setAdding] = useState(false)
  const [serving, setServing] = useState<QueueEntry | null>(null)
  const [trying, setTrying] = useState<Consulate | null>(null)

  const consulates = db.consulates.filter((c) => c.active)

  // Une file par poste, deja triee : priorite d'abord, anciennete ensuite.
  const lines = useMemo(
    () =>
      consulates
        .map((consulate) => ({ consulate, entries: queueOf(db, consulate.id, v.queue) }))
        .filter((l) => l.entries.length > 0)
        .sort((a, b) => b.entries.length - a.entries.length),
    [consulates, db, v.queue],
  )

  const waiting = v.queue.filter((q) => q.status === 'attente').length
  const today = v.attempts.filter((a) => a.at.slice(0, 10) === new Date().toISOString().slice(0, 10))
  const won = today.filter((a) => a.result === 'creneau_pris').length

  return (
    <>
      <PageHead
        title={t('slots.title')}
        subtitle={t('slots.subtitle')}
        action={
          v.can('case:write')
            ? <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>{t('slots.join')}</Button>
            : undefined
        }
      />

      <div className="grid grid--3" style={{ marginBottom: 'var(--sp-5)' }}>
        <Card>
          <div className="col gap-1">
            <span className="t-caption t-tertiary">{t('slots.waiting')}</span>
            <span className="t-display t-num">{waiting}</span>
          </div>
        </Card>
        <Card>
          <div className="col gap-1">
            <span className="t-caption t-tertiary">{t('slots.triedToday')}</span>
            <span className="t-display t-num">{today.length}</span>
          </div>
        </Card>
        <Card>
          <div className="col gap-1">
            <span className="t-caption t-tertiary">{t('slots.wonToday')}</span>
            <span className="t-display t-num" style={{ color: won > 0 ? 'var(--green)' : undefined }}>{won}</span>
          </div>
        </Card>
      </div>

      <div style={{ marginBottom: 'var(--sp-5)' }}>
        <Segmented
          value={view}
          onChange={setView}
          options={[{ value: 'queue', label: t('slots.queues') }, { value: 'attempts', label: t('slots.log') }]}
        />
      </div>

      {view === 'queue' ? (
        lines.length === 0 ? (
          <Card><Empty title={t('slots.noQueue')} hint={t('slots.noQueueHint')} /></Card>
        ) : (
          <div className="stack">
            {/* Quand un créneau se libère, la question n'est pas « qui est le
                premier », mais « qui est le premier dont le dossier est prêt ».
                C'est tout le produit d'un concurrent entier. */}
            {lines.filter(({ consulate }) => freedSlots(db).some((f) => f.consulateId === consulate.id))
              .map(({ consulate }) => <SlotAlert key={`alerte-${consulate.id}`} consulateId={consulate.id} />)}

            {lines.map(({ consulate, entries }) => {
              const real = realWaitDays(db, consulate.id)
              return (
                <Card
                  key={consulate.id}
                  title={`${tt(consulate.country)} · ${consulate.city}`}
                  action={
                    v.can('case:write')
                      ? <Button icon="clock" onClick={() => setTrying(consulate)}>{t('slots.iTried')}</Button>
                      : undefined
                  }
                  flush
                >
                  <div className="row gap-4 t-caption t-tertiary" style={{ padding: '0 var(--sp-5) var(--sp-3)', flexWrap: 'wrap' }}>
                    <span>{t(`centre.${consulate.centre}` as 'centre.tls_tunis')}</span>
                    <span>·</span>
                    <span>{t('slots.inLine', { n: entries.length })}</span>
                    {real !== undefined && (
                      <>
                        <span>·</span>
                        <span className="t-medium" style={{ color: 'var(--ink)' }}>{t('slots.realWait', { n: real })}</span>
                      </>
                    )}
                    {consulate.announcedDays !== undefined && (
                      <>
                        <span>·</span>
                        <span>{t('slots.announced', { n: consulate.announcedDays })}</span>
                      </>
                    )}
                  </div>
                  <div className="list">
                    {entries.map((entry, i) => {
                      const kase = v.cases.find((c) => c.id === entry.caseId)
                      if (!kase) return null
                      return (
                        <div key={entry.id} className="list__row">
                          {/* Le rang est ce que le client voit dans son portail. */}
                          <span className="t-num t-medium" style={{ width: 32, textAlign: 'right' }}>{i + 1}</span>
                          <Link to={`/dossiers/${kase.id}`} className="col grow" style={{ minWidth: 0 }}>
                            <span className="t-medium t-small t-truncate">{clientName(db, kase.clientId)}</span>
                            <span className="t-caption t-tertiary t-truncate">
                              {kase.reference} · {t('slots.since', { n: daysSince(entry.joinedAt) })}
                            </span>
                          </Link>
                          <PriorityPill priority={entry.priority} />
                          {v.can('case:write') && (
                            <>
                              <IconButton icon="check" label={t('slots.served')} onClick={() => setServing(entry)} />
                              <IconButton
                                icon="close"
                                label={t('slots.leave')}
                                onClick={() => { if (window.confirm(t('slots.leaveConfirm'))) { actions.leaveQueue(entry.id); toast(t('slots.left')) } }}
                              />
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )
            })}
          </div>
        )
      ) : v.attempts.length === 0 ? (
        <Card><Empty title={t('slots.noAttempt')} /></Card>
      ) : (
        <Card flush>
          <div className="list">
            {v.attempts.slice(0, 80).map((a) => {
              const consulate = db.consulates.find((c) => c.id === a.consulateId)
              const by = db.users.find((u) => u.id === a.byId)
              return (
                <div key={a.id} className="list__row">
                  <span className="t-num t-caption t-tertiary" style={{ width: 44 }}>
                    {new Date(a.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <Icon name="clock" size={16} className="t-tertiary" />
                  <span className="col grow" style={{ minWidth: 0 }}>
                    <span className="t-medium t-small t-truncate">
                      {consulate ? `${tt(consulate.country)} · ${consulate.city}` : '—'}
                    </span>
                    <span className="t-caption t-tertiary t-truncate">
                      {by?.name ?? '—'}
                      {a.slotAt ? ` · ${formatDate(a.slotAt, { day: '2-digit', month: 'short' })}` : ''}
                    </span>
                  </span>
                  <span className="t-caption t-tertiary"><Ago iso={a.at} /></span>
                  <Pill tone={ATTEMPT_TONE[a.result]}>{t(`attempt.${a.result}` as 'attempt.aucun_creneau')}</Pill>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {adding && <JoinQueue onClose={() => setAdding(false)} />}
      {serving && <ServeQueue entry={serving} onClose={() => setServing(null)} />}
      {trying && <LogAttempt consulate={trying} onClose={() => setTrying(null)} />}
    </>
  )

  /** Mettre un dossier dans la file d'un poste. */
  function JoinQueue({ onClose }: { onClose: () => void }) {
    const queued = new Set(v.queue.filter((q) => q.status === 'attente').map((q) => q.caseId))
    const open = v.cases.filter((c) => c.status === 'ouvert' && !queued.has(c.id))
    const [caseId, setCaseId] = useState(open[0]?.id ?? '')
    const chosen = v.cases.find((c) => c.id === caseId)
    const [consulateId, setConsulateId] = useState('')
    const [priority, setPriority] = useState<Priority>('normale')

    // Le poste du dossier est propose d'office, sans etre impose.
    const suggested = chosen?.consulateId ?? consulates[0]?.id ?? ''
    const value = consulateId || suggested

    return (
      <Modal
        title={t('slots.join')}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>{t('action.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!caseId || !value}
              onClick={() => {
                actions.joinQueue({ caseId, consulateId: value, priority })
                onClose()
                toast(t('slots.joined'))
              }}
            >
              {t('action.confirm')}
            </Button>
          </>
        }
      >
        {open.length === 0 ? (
          <Empty title={t('slots.allQueued')} />
        ) : (
          <div className="col gap-4">
            <Field label={t('cases.title')}>
              <Select value={caseId} onChange={(e) => { setCaseId(e.target.value); setConsulateId('') }}>
                {open.map((c) => (
                  <option key={c.id} value={c.id}>{c.reference} · {clientName(db, c.clientId)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('slots.consulate')}>
              <Select value={value} onChange={(e) => setConsulateId(e.target.value)}>
                {consulates.map((c) => (
                  <option key={c.id} value={c.id}>{tt(c.country)} · {c.city}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('slots.priority')} hint={t('slots.priorityHint')}>
              <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {(['basse', 'normale', 'haute', 'urgente'] as Priority[]).map((p) => (
                  <option key={p} value={p}>{t(`priority.${p}` as 'priority.normale')}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </Modal>
    )
  }

  /** Servir la file : le creneau est decroche, le rendez-vous se cree. */
  function ServeQueue({ entry, onClose }: { entry: QueueEntry; onClose: () => void }) {
    const kase = v.cases.find((c) => c.id === entry.caseId)
    const [at, setAt] = useState('')

    return (
      <Modal
        title={t('slots.serveTitle')}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>{t('action.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!at}
              onClick={() => {
                const iso = new Date(at).toISOString()
                actions.serveQueue(entry.id, iso)
                // Le geste est aussi une tentative reussie : le registre doit
                // le savoir, sinon le taux de reussite du jour est faux.
                actions.logAttempt({
                  consulateId: entry.consulateId,
                  centre: db.consulates.find((c) => c.id === entry.consulateId)?.centre ?? 'autre',
                  result: 'creneau_pris',
                  caseId: entry.caseId,
                  slotAt: iso,
                })
                onClose()
                toast(t('slots.servedDone'))
              }}
            >
              {t('action.confirm')}
            </Button>
          </>
        }
      >
        <div className="col gap-4">
          <p className="t-small t-secondary">
            {kase ? `${kase.reference} · ${clientName(db, kase.clientId)}` : ''}
          </p>
          <Field label={t('slots.slotAt')} hint={t('slots.slotAtHint')}>
            <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
        </div>
      </Modal>
    )
  }

  /** Le geste le plus frequent de la journee : « j'ai essaye, il n'y a rien ». */
  function LogAttempt({ consulate, onClose }: { consulate: Consulate; onClose: () => void }) {
    const [result, setResult] = useState<AttemptResult>('aucun_creneau')
    const [note, setNote] = useState('')

    return (
      <Modal
        title={`${t('slots.iTried')} · ${tt(consulate.country)}`}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>{t('action.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                actions.logAttempt({ consulateId: consulate.id, centre: consulate.centre, result, note: note || undefined })
                onClose()
                toast(t('slots.logged'))
              }}
            >
              {t('action.confirm')}
            </Button>
          </>
        }
      >
        <div className="col gap-4">
          <Field label={t('slots.result')}>
            <Select value={result} onChange={(e) => setResult(e.target.value as AttemptResult)}>
              {RESULTS.map((r) => (
                <option key={r} value={r}>{t(`attempt.${r}` as 'attempt.aucun_creneau')}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('slots.note')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('slots.notePlaceholder')} />
          </Field>
        </div>
      </Modal>
    )
  }
}
