import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useI18n } from '@/i18n'
import type { TKey } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Field, Modal, Pill, Select, Tabs, Textarea, useToast } from './ui'
import { Icon } from './Icon'
import { loadBoard, sendFeedback, unvoteFeedback, voteFeedback, FEEDBACK_KINDS } from '@/data/support'
import type { BoardItem, FeedbackKind, FeedbackStatus } from '@/data/support'

/**
 * Le bouton de retour.
 *
 * Il porte la PAGE COURANTE, préremplie. C'est tout ce qui sépare un retour
 * exploitable d'un « ça ne marche pas » auquel il faut répondre pour demander
 * où. La page part avec le retour, elle ne s'affiche à personne d'autre.
 *
 * Le deuxième onglet montre les idées des autres agences, et permet de voter.
 * Il ne montre JAMAIS de qui vient l'idée : les agences de visas d'une même
 * ville sont concurrentes, et savoir ce que la concurrence demande est une
 * information commerciale. Le serveur n'envoie pas l'origine ; il n'y a donc
 * rien à cacher ici, et rien à découvrir en ouvrant la console du navigateur.
 */

const KIND_LABEL: Record<FeedbackKind, TKey> = {
  idee: 'sup.fbKindIdee',
  gene: 'sup.fbKindGene',
  compliment: 'sup.fbKindCompliment',
  autre: 'sup.fbKindAutre',
}

const STATUS_LABEL: Record<FeedbackStatus, TKey> = {
  nouveau: 'sup.fbStNouveau',
  lu: 'sup.fbStLu',
  planifie: 'sup.fbStPlanifie',
  fait: 'sup.fbStFait',
  ecarte: 'sup.fbStEcarte',
}

const STATUS_TONE: Record<FeedbackStatus, 'gray' | 'blue' | 'green' | 'orange'> = {
  nouveau: 'gray', lu: 'gray', planifie: 'blue', fait: 'green', ecarte: 'orange',
}

export function FeedbackButton() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  if (!HAS_BACKEND) return null
  return (
    <>
      <Button size="sm" icon="sparkle" onClick={() => setOpen(true)}>{t('sup.fbOpen')}</Button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  )
}

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const { t, formatDate } = useI18n()
  const toast = useToast()
  const location = useLocation()

  const [tab, setTab] = useState<'ecrire' | 'idees'>('ecrire')
  const [kind, setKind] = useState<FeedbackKind>('idee')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [board, setBoard] = useState<BoardItem[]>([])

  // La page courante, telle quelle. Pas le titre, pas un libellé traduit : le
  // chemin, qui se retrouve du premier coup dans le code.
  const page = location.pathname + location.search

  const reloadBoard = useCallback(async () => {
    try { setBoard(await loadBoard()) } catch (e) { setError((e as Error).message) }
  }, [])

  useEffect(() => { if (tab === 'idees') void reloadBoard() }, [tab, reloadBoard])

  const submit = async () => {
    if (!message.trim()) return
    setBusy(true)
    try {
      await sendFeedback({ kind, message: message.trim(), page })
      toast(t('sup.fbSent'))
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const toggleVote = async (item: BoardItem) => {
    setBusy(true)
    try {
      const votes = item.voted ? await unvoteFeedback(item.id) : await voteFeedback(item.id)
      setBoard((list) => list.map((x) => (x.id === item.id ? { ...x, votes, voted: !item.voted } : x)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('sup.fbTitle')}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="grow" />
          <Button onClick={onClose}>{t('sup.cancel')}</Button>
          {tab === 'ecrire' && (
            <Button variant="primary" disabled={busy || !message.trim()} onClick={() => void submit()}>
              {t('sup.fbSend')}
            </Button>
          )}
        </>
      }
    >
      <div className="col gap-4">
        <Tabs
          value={tab}
          onChange={setTab}
          idPrefix="feedback"
          options={[
            { value: 'ecrire', label: t('sup.fbTitle') },
            { value: 'idees', label: t('sup.fbBoard') },
          ]}
        />

        {tab === 'ecrire' ? (
          <div className="col gap-4">
            <p className="t-small t-secondary">{t('sup.fbSub')}</p>
            <Field label={t('sup.fbKind')}>
              <Select value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind)}>
                {FEEDBACK_KINDS.map((k) => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}
              </Select>
            </Field>
            <Field label={t('sup.fbMessage')}>
              <Textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} autoFocus />
            </Field>
            <p className="t-caption t-tertiary">
              <Icon name="pin" size={12} /> {t('sup.fbPage')} : <span className="t-mono">{page}</span>
            </p>
          </div>
        ) : (
          <div className="col gap-3">
            <p className="t-caption t-tertiary">{t('sup.fbBoardHint')}</p>
            {board.length === 0 ? (
              <p className="t-small t-tertiary">{t('sup.fbNoIdeas')}</p>
            ) : board.map((item) => (
              <div
                key={item.id}
                className="row gap-3"
                style={{ padding: 'var(--sp-3) 0', borderTop: '1px solid var(--hairline)', alignItems: 'flex-start' }}
              >
                <span className="col grow gap-1" style={{ minWidth: 0 }}>
                  <span className="t-small" style={{ whiteSpace: 'pre-wrap' }}>{item.message}</span>
                  <span className="row gap-2 wrap">
                    <Pill tone={STATUS_TONE[item.status]}>{t(STATUS_LABEL[item.status])}</Pill>
                    {item.mine && <Pill tone="blue">{t('sup.fbMine')}</Pill>}
                    <span className="t-caption t-tertiary">{formatDate(item.created_at)}</span>
                  </span>
                  {item.response && (
                    <span className="t-caption t-secondary">
                      {t('sup.fbAnswer')} : {item.response}
                    </span>
                  )}
                </span>
                <span className="col gap-1" style={{ alignItems: 'flex-end' }}>
                  <Button
                    size="sm"
                    icon={item.voted ? 'check' : 'plus'}
                    disabled={busy}
                    onClick={() => void toggleVote(item)}
                  >
                    {item.voted ? t('sup.fbVoted') : t('sup.fbVote')}
                  </Button>
                  <span className="t-caption t-tertiary t-num">{t('sup.fbVotes', { n: item.votes })}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {error && <p className="t-small t-orange">{error}</p>}
      </div>
    </Modal>
  )
}
