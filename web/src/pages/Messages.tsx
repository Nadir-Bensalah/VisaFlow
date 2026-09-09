import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Avatar, Button, Card, Pill, Segmented } from '@/components/ui'
import { PageHeader, Vide } from '@/components/page'
import { Ago, StagePill } from '@/components/bits'
import { Icon } from '@/components/Icon'
import type { IconName } from '@/components/Icon'
import { Conversation } from '@/components/Conversation'
import { clientName } from '@/lib/derive'
import type { Channel, Message } from '@/data/types'
import '@/styles/messagerie.css'

/**
 * LA MESSAGERIE À DEUX VOLETS.
 *
 * À gauche, les conversations (une par dossier), avec recherche et filtres.
 * À droite, le fil choisi et son composeur. La conversation ouverte vit dans
 * l'URL (`?dossier=<id>`) : un lien se partage, le bouton Retour du
 * navigateur fonctionne, et sur téléphone la liste et le fil s'alternent.
 */

type View = 'tous' | 'repondre' | 'auto' | 'whatsapp' | 'email' | 'portail'

const CHANNEL_ICON: Record<Channel, IconName> = {
  whatsapp: 'whatsapp', email: 'mail', sms: 'phone', portail: 'portal', interne: 'edit',
}

interface Thread {
  caseId: string
  last: Message
  count: number
  /** Le dernier mot est au client : l'agence lui doit une réponse. */
  due: boolean
  /** Tout le texte de la conversation, pour la recherche. */
  haystack: string
}

export function Messages() {
  const { db } = useStore()
  const v = useVisible()
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<View>('tous')
  const [query, setQuery] = useState('')

  const selectedId = params.get('dossier')

  /* Une conversation par dossier, la plus récente en tête. */
  const threads = useMemo<Thread[]>(() => {
    const byCase = new Map<string, Message[]>()
    v.messages.forEach((m) => {
      if (!m.caseId) return
      const list = byCase.get(m.caseId) ?? []
      list.push(m)
      byCase.set(m.caseId, list)
    })
    return [...byCase.entries()]
      .map(([caseId, list]) => {
        const sorted = [...list].sort((a, b) => b.at.localeCompare(a.at))
        const kase = v.cases.find((c) => c.id === caseId)
        const name = kase ? clientName(db, kase.clientId) : ''
        return {
          caseId,
          last: sorted[0],
          count: list.length,
          due: sorted[0].direction === 'entrant',
          haystack: `${name} ${kase?.reference ?? ''} ${list.map((m) => m.body).join(' ')}`.toLowerCase(),
        }
      })
      .sort((a, b) => b.last.at.localeCompare(a.last.at))
  }, [db, v.messages, v.cases])

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const q = norm(query.trim())

  const shown = useMemo(() => threads.filter((x) => {
    if (view === 'repondre' && !x.due) return false
    if (view === 'auto' && !x.last.automated) return false
    if ((view === 'whatsapp' || view === 'email' || view === 'portail') && x.last.channel !== view) return false
    return q === '' || norm(x.haystack).includes(q)
  }), [threads, view, q])

  const dueCount = threads.filter((x) => x.due).length

  const selectedCase = selectedId ? v.cases.find((c) => c.id === selectedId) : undefined
  const selectedClient = selectedCase ? db.clients.find((c) => c.id === selectedCase.clientId) : undefined

  const open = (caseId: string) => setParams({ dossier: caseId })
  const close = () => setParams({})

  /* Sur téléphone, ouvrir une conversation fait défiler jusqu'au fil : sans
     cela, l'en-tête de page reste à l'écran et le fil commence hors champ. */
  const paneRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (selectedId && window.matchMedia('(max-width: 900px)').matches) paneRef.current?.scrollIntoView({ block: 'start' })
  }, [selectedId])

  return (
    <>
      <PageHeader
        kicker={t('mgr.kicker')}
        title={t('mgr.title')}
        subtitle={t('mgr.subtitle')}
        actions={dueCount > 0 ? <Pill tone="blue" dot>{t('mgr.toAnswer')} · {dueCount}</Pill> : undefined}
      />

      <Card flush className="mg-card">
        <div className={`pg-split mg-split ${selectedId ? 'pg-split--open' : ''}`}>
          {/* ------------------------------ La liste ------------------------------ */}
          <aside className="pg-split__list mg-list" aria-label={t('mgr.backToList')}>
            <div className="mg-list__tools">
              <label className="search mg-search">
                <Icon name="search" size={15} />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('mgr.search')}
                  aria-label={t('action.search')}
                />
              </label>
              <Segmented
                label={t('action.filter')}
                value={view}
                onChange={setView}
                options={[
                  { value: 'tous', label: t('mgr.all') },
                  { value: 'repondre', label: dueCount > 0 ? `${t('mgr.toAnswer')} ${dueCount}` : t('mgr.toAnswer') },
                  { value: 'auto', label: t('mgr.automatic') },
                  { value: 'whatsapp', label: t('mgr.whatsapp') },
                  { value: 'email', label: t('mgr.email') },
                  { value: 'portail', label: t('mgr.portal') },
                ]}
              />
            </div>

            <div className="mg-list__rows" role="list">
              {threads.length === 0 ? (
                <Vide title={t('mgr.noThreads')} hint={t('mgr.noThreadsHint')} icon="messages" />
              ) : shown.length === 0 ? (
                <Vide
                  title={t('mgr.noMatch')}
                  hint={t('mgr.noMatchHint')}
                  icon="search"
                  action={<Button size="sm" onClick={() => { setQuery(''); setView('tous') }}>{t('action.reset')}</Button>}
                />
              ) : shown.map((x) => {
                const kase = v.cases.find((c) => c.id === x.caseId)
                if (!kase) return null
                const name = clientName(db, kase.clientId)
                const active = x.caseId === selectedId
                return (
                  <button
                    key={x.caseId}
                    type="button"
                    role="listitem"
                    className={`mg-row ${active ? 'mg-row--active' : ''} ${x.due ? 'mg-row--due' : ''}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => open(x.caseId)}
                  >
                    <Avatar name={name} />
                    <span className="mg-row__main">
                      <span className="mg-row__top">
                        <span className="mg-row__name t-truncate">{name}</span>
                        <span className="mg-row__when t-caption t-tertiary"><Ago iso={x.last.at} /></span>
                      </span>
                      <span className="mg-row__ref t-caption t-tertiary">
                        <span className="t-mono">{kase.reference}</span>
                        <span aria-hidden="true">·</span>
                        <Icon name={CHANNEL_ICON[x.last.channel]} size={12} />
                        <span>{t(`channel.${x.last.channel}` as 'channel.whatsapp')}</span>
                      </span>
                      <span className="mg-row__bottom">
                        {/* dir=auto : un client arabe qui écrit en français se lit
                            de gauche à droite, et l'inverse. */}
                        <span className="mg-row__preview t-truncate" dir="auto">
                          {x.last.direction === 'sortant' && <span className="mg-row__you">{t('mgr.you')} : </span>}
                          {x.last.body}
                        </span>
                        {x.due
                          ? <Pill tone="blue" dot>{t('mgr.replyDue')}</Pill>
                          : x.last.automated
                            ? <Pill tone="violet">{t('mgr.automated')}</Pill>
                            : null}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mg-list__foot t-caption t-tertiary" role="status" aria-live="polite">
              {shown.length === 1 ? t('mgr.conversation') : t('mgr.conversations', { n: shown.length })}
            </div>
          </aside>

          {/* -------------------------------- Le fil ------------------------------- */}
          <section className="pg-split__pane mg-pane" aria-label={t('mgr.title')} ref={paneRef}>
            {selectedCase && selectedClient ? (
              <>
                <header className="mg-pane__head">
                  <button type="button" className="btn btn--icon mg-back" onClick={close} aria-label={t('mgr.backToList')}>
                    <Icon name="arrow" size={18} className="mg-back__icon" />
                  </button>
                  <Avatar name={clientName(db, selectedCase.clientId)} />
                  <div className="mg-pane__who">
                    <div className="mg-pane__name">
                      <Link to={`/clients/${selectedClient.id}`} className="t-medium">{clientName(db, selectedCase.clientId)}</Link>
                      <StagePill stage={selectedCase.stage} />
                    </div>
                    <div className="t-caption t-tertiary mg-pane__sub">
                      <span className="t-mono">{selectedCase.reference}</span>
                      <span aria-hidden="true">·</span>
                      <span dir="ltr">{selectedClient.phone}</span>
                    </div>
                  </div>
                  <div className="mg-pane__actions">
                    <a
                      className="btn btn--icon"
                      href={`https://wa.me/${(selectedClient.whatsapp ?? selectedClient.phone).replace(/[^0-9]/g, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t('channel.whatsapp')}
                      title={t('channel.whatsapp')}
                    >
                      <Icon name="whatsapp" size={17} />
                    </a>
                    <a className="btn btn--icon mg-pane__call" href={`tel:${selectedClient.phone}`} aria-label={t('action.call')} title={t('action.call')}>
                      <Icon name="phone" size={17} />
                    </a>
                    <Link to={`/dossiers/${selectedCase.id}`} className="btn btn--secondary btn--sm mg-pane__open">
                      <Icon name="cases" size={15} /><span>{t('mgr.openCase')}</span>
                    </Link>
                  </div>
                </header>
                <Conversation caseId={selectedCase.id} />
              </>
            ) : selectedId ? (
              <div className="mg-pane__empty">
                <Vide
                  title={t('mgr.notFound')}
                  icon="lock"
                  action={<Button size="sm" onClick={close}>{t('mgr.backToList')}</Button>}
                />
              </div>
            ) : (
              <div className="mg-pane__empty">
                <Vide title={t('mgr.pick')} hint={t('mgr.pickHint')} icon="messages" />
              </div>
            )}
          </section>
        </div>
      </Card>
    </>
  )
}
