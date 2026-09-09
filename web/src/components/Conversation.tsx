import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { LOCALE_META, useI18n } from '@/i18n'
import { Button, Pill, Select, useToast } from '@/components/ui'
import { Vide } from '@/components/page'
import { Icon } from '@/components/Icon'
import type { IconName } from '@/components/Icon'
import { waWindowLeft, waWindowOpen } from '@/lib/derive'
import type { Channel, Database, Message, MessageTemplate, VisaCase, Client } from '@/data/types'

/**
 * LE FIL D'UNE CONVERSATION ET SON COMPOSEUR.
 *
 * Réutilisable tel quel : la messagerie (/messages) le pose dans son volet de
 * droite, la fiche du dossier le posera dans son onglet Messages. Il ne porte
 * pas d'en-tête : chaque écran a déjà le sien (nom, référence, étape).
 *
 * L'envoi passe par `actions.sendMessage` du store, et par rien d'autre : un
 * message part avec le statut « file », jamais « envoyé ». Le vocabulaire
 * des statuts est celui de `MessageStatus`.
 */

const CHANNEL_ICON: Record<Channel, IconName> = {
  whatsapp: 'whatsapp', email: 'mail', sms: 'phone', portail: 'portal', interne: 'edit',
}

/** Les variables qu'un modèle peut porter. Une variable qu'on ne sait pas
    remplir reste visible entre accolades : l'agent la complète, on n'invente
    rien à sa place. */
const VARIABLES = ['client', 'reference', 'piece', 'date', 'lieu', 'montant', 'pays', 'bureau'] as const
const UNRESOLVED = new RegExp(`\\{(${VARIABLES.join('|')})\\}`, 'g')

function fillTemplate(db: Database, tpl: MessageTemplate, kase: VisaCase, client: Client): string {
  const locale = client.locale
  const bcp47 = LOCALE_META[locale].bcp47
  const body = tpl.body[locale] ?? tpl.body.fr

  // La première pièce qui manque encore : c'est elle que le modèle réclame.
  const missing = db.documents.find((d) => d.caseId === kase.id && (d.state === 'manquante' || d.state === 'demandee'))
  // Le prochain rendez-vous prévu, pas un rendez-vous passé.
  const now = Date.now()
  const nextAppt = db.appointments
    .filter((a) => a.caseId === kase.id && a.status === 'prevu' && new Date(a.at).getTime() >= now)
    .sort((a, b) => a.at.localeCompare(b.at))[0]
  const visa = db.visaTypes.find((v) => v.id === kase.visaTypeId)
  const office = db.agency.offices.find((o) => o.id === kase.officeId)
  const balance = kase.amountTotal - kase.amountPaid

  const values: Partial<Record<(typeof VARIABLES)[number], string>> = {
    client: client.firstName,
    reference: kase.reference,
    piece: missing ? (missing.label[locale] ?? missing.label.fr) : undefined,
    date: nextAppt
      ? new Intl.DateTimeFormat(bcp47, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(nextAppt.at))
      : undefined,
    lieu: nextAppt?.location,
    montant: new Intl.NumberFormat(bcp47, { style: 'currency', currency: db.agency.currency, maximumFractionDigits: 0 }).format(balance),
    pays: visa ? (visa.country[locale] ?? visa.country.fr) : undefined,
    bureau: office?.name,
  }

  return body.replace(UNRESOLVED, (whole, name: (typeof VARIABLES)[number]) => values[name] ?? whole)
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function Conversation({ caseId, compact }: { caseId: string; compact?: boolean }) {
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt, formatDate } = useI18n()
  const toast = useToast()

  const kase = db.cases.find((c) => c.id === caseId)
  const client = db.clients.find((c) => c.id === kase?.clientId)

  const messages = useMemo(
    () => db.messages.filter((m) => m.caseId === caseId).sort((a, b) => a.at.localeCompare(b.at)),
    [db.messages, caseId],
  )

  /* Groupé par jour : « Aujourd'hui », « Hier », puis la date. Un fil de
     trente messages sans repère de jour ne se lit pas. */
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: Message[] }[] = []
    const todayKey = dayKey(new Date().toISOString())
    const yesterdayKey = dayKey(new Date(Date.now() - 86_400_000).toISOString())
    for (const m of messages) {
      const key = dayKey(m.at)
      let g = out[out.length - 1]
      if (!g || g.key !== key) {
        const label = key === todayKey ? t('mgr.today') : key === yesterdayKey ? t('mgr.yesterday') : formatDate(m.at, { weekday: 'long', day: 'numeric', month: 'long' })
        g = { key, label, items: [] }
        out.push(g)
      }
      g.items.push(m)
    }
    return out
  }, [messages, t, formatDate])

  /* Le fil descend en bas à l'ouverture et après chaque envoi : le dernier
     message est celui qu'on veut voir, pas le premier. */
  const threadRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [caseId, messages.length])

  const [body, setBody] = useState('')
  const [channel, setChannel] = useState<Channel>('whatsapp')
  const [templateId, setTemplateId] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Le brouillon ne suit pas d'une conversation à l'autre.
  useEffect(() => { setBody(''); setTemplateId('') }, [caseId])

  /* Le composeur grandit avec le texte, jusqu'à six lignes environ, puis
     défile : un message de trois mots ne réclame pas 90 px, un message de
     dix lignes ne pousse pas le fil hors de l'écran. */
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [body])

  // Les canaux que ce dossier permet vraiment. Sans adresse, pas d'e-mail.
  const channels = useMemo<Channel[]>(() => {
    if (!client) return []
    const list: Channel[] = []
    if (client.whatsapp || client.phone) list.push('whatsapp')
    if (client.email) list.push('email')
    list.push('portail')
    return list
  }, [client])
  useEffect(() => {
    if (channels.length > 0 && !channels.includes(channel)) setChannel(channels[0])
  }, [channels, channel])

  if (!kase || !client) {
    return <Vide title={t('mgr.notFound')} icon="messages" />
  }

  const applyTemplate = (id: string) => {
    setTemplateId(id)
    const tpl = db.templates.find((x) => x.id === id)
    if (!tpl) return
    if (channels.includes(tpl.channel)) setChannel(tpl.channel)
    setBody(fillTemplate(db, tpl, kase, client))
    textareaRef.current?.focus()
  }

  // Les variables encore entre accolades : on ne les envoie pas au client.
  const unresolved = [...new Set([...body.matchAll(UNRESOLVED)].map((m) => `{${m[1]}}`))]
  const canSend = body.trim().length > 0 && unresolved.length === 0

  // La fenêtre WhatsApp de 24 heures : dedans c'est libre, dehors Meta
  // exige un modèle approuvé et le facture.
  const open = waWindowOpen(db, client.id)
  const left = waWindowLeft(db, client.id)
  const usingTemplate = Boolean(templateId)

  const send = () => {
    if (!canSend) return
    actions.sendMessage({ caseId, body: body.trim(), channel, templateKey: db.templates.find((x) => x.id === templateId)?.key })
    setBody('')
    setTemplateId('')
    // « Placé dans la file » : le message n'est pas encore parti.
    toast(t('msg.sent'))
  }

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const waNumber = (client.whatsapp ?? client.phone).replace(/[^0-9]/g, '')
  const canWrite = v.can('message:send')

  return (
    <div className={`mg-conv ${compact ? 'mg-conv--compact' : ''}`}>
      <div className="mg-thread" ref={threadRef} role="log" aria-live="polite">
        {messages.length === 0 ? (
          <Vide title={t('mgr.emptyThread')} hint={canWrite ? t('mgr.emptyThreadHint') : undefined} icon="messages" />
        ) : groups.map((g) => (
          <section key={g.key} className="mg-day">
            <h3 className="mg-day__label"><span>{g.label}</span></h3>
            {g.items.map((m) => {
              const out = m.direction === 'sortant'
              const author = m.automated ? null : out ? db.users.find((u) => u.id === m.authorId)?.name : null
              return (
                <article key={m.id} className={`mg-bubble ${out ? 'mg-bubble--out' : 'mg-bubble--in'}`}>
                  {/* dir=auto : le sens de lecture suit le texte lui-même, pas la
                      langue déclarée du client. Un Libyen qui écrit en français
                      ne doit pas lire de travers. */}
                  <p className="mg-bubble__body" dir="auto" lang={m.locale}>{m.body}</p>
                  <footer className="mg-bubble__meta">
                    <Icon name={CHANNEL_ICON[m.channel]} size={12} />
                    <span>{t(`channel.${m.channel}` as 'channel.whatsapp')}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={m.at}>{formatDate(m.at, { hour: '2-digit', minute: '2-digit' })}</time>
                    {author && <><span aria-hidden="true">·</span><span>{author}</span></>}
                    {out && <><span aria-hidden="true">·</span><span className={m.status === 'echec' ? 'mg-bubble__status mg-bubble__status--echec' : 'mg-bubble__status'}>{t(`mgr.status.${m.status}` as 'mgr.status.file')}</span></>}
                    {m.automated && <Pill tone="violet">{t('mgr.automated')}</Pill>}
                  </footer>
                </article>
              )
            })}
          </section>
        ))}
      </div>

      {canWrite && (
        <form className="mg-composer" onSubmit={(e) => { e.preventDefault(); send() }}>
          <div className="mg-composer__tools">
            <Select
              aria-label={t('mgr.template')}
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className="mg-composer__select"
            >
              <option value="">{t('mgr.insertTemplate')}</option>
              {db.templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>{tt(tpl.name)}</option>
              ))}
            </Select>
            <div className="segmented mg-composer__channels" role="group" aria-label={t('mgr.channel')}>
              {channels.map((c) => (
                <button key={c} type="button" aria-pressed={c === channel} aria-selected={c === channel} onClick={() => setChannel(c)}>
                  <Icon name={CHANNEL_ICON[c]} size={13} /> {t(`channel.${c}` as 'channel.whatsapp')}
                </button>
              ))}
            </div>
            <span className="mg-composer__lang t-caption t-tertiary">
              <Icon name="language" size={13} /> {t('mgr.clientLanguage', { lang: LOCALE_META[client.locale].native })}
            </span>
          </div>

          {channel === 'whatsapp' && (
            <div className={`wawindow ${open ? 'wawindow--open' : ''}`}>
              <Icon name={open ? 'clock' : 'alert'} size={15} />
              <span className="t-caption grow">
                {open ? t('wa.openFor', { n: Math.round(left / 60) }) : usingTemplate ? t('wa.closedTemplate') : t('wa.closedFree')}
              </span>
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="textarea mg-composer__textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('mgr.placeholder')}
            dir="auto"
            lang={client.locale}
            rows={1}
            aria-label={t('mgr.placeholder')}
            onKeyDown={(e) => {
              // ⌘ Entrée (Ctrl sur PC) envoie. Entrée seule saute une ligne :
              // un message d'agence a souvent plusieurs lignes.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
            }}
          />

          {unresolved.length > 0 && (
            <p className="mg-composer__warn t-caption" role="status">
              <Icon name="alert" size={13} /> {t('mgr.fillVariables', { vars: unresolved.join(' ') })}
            </p>
          )}

          <div className="mg-composer__foot">
            <span className="mg-composer__hints t-caption t-tertiary">
              <kbd className="mg-kbd">{isMac ? t('mgr.shortcutMac') : t('mgr.shortcutPc')}</kbd>
              {v.can('settings:view') && (
                <Link to="/reglages?section=modeles" className="mg-composer__manage">{t('mgr.manageTemplates')}</Link>
              )}
            </span>
            <span className="row gap-2">
              {/* Tant que l'API n'est pas branchée, WhatsApp s'ouvre avec le
                  texte déjà écrit. Le message est aussi placé dans la file,
                  pour que le fil garde la trace. */}
              {channel === 'whatsapp' && (
                <a
                  className={`btn btn--secondary btn--sm ${canSend ? '' : 'mg-btn--off'}`}
                  href={`https://wa.me/${waNumber}?text=${encodeURIComponent(body)}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!canSend}
                  onClick={(e) => { if (!canSend) { e.preventDefault(); return } send() }}
                >
                  <Icon name="whatsapp" size={15} /> {t('mgr.openInWhatsApp')}
                </a>
              )}
              <Button type="submit" variant="primary" size="sm" icon="arrow" disabled={!canSend}>{t('mgr.send')}</Button>
            </span>
          </div>
        </form>
      )}
    </div>
  )
}
