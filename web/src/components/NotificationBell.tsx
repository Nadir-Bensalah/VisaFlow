import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n, type TKey } from '@/i18n'
import { Icon, type IconName } from '@/components/Icon'
import { clientName, daysUntil, type Tone } from '@/lib/derive'
import {
  NOTIFS_ONLINE, markAllRead, markRead, myNotifications, severityTone, unreadCount,
  type ServerNotification,
} from '@/data/notifs'

/**
 * La cloche. Le suivi d'une agence, c'est cent petits événements par jour :
 * une décision tombe, une pièce est refusée, un rendez-vous est aujourd'hui,
 * un prospect arrive, un client répond. Sans un endroit qui les rassemble,
 * l'agent apprend la mauvaise nouvelle trop tard.
 *
 * Deux sources, dans cet ordre. Branchée au serveur, la cloche lit la table
 * `notifications` (migration 0051) : ce qui est lu reste lu d'un poste à
 * l'autre, et une alerte que personne n'a ouverte ne disparaît pas au
 * rechargement. Hors ligne, ou si le serveur ne répond pas, elle retombe sur
 * la dérivation locale des données déjà chargées : la démonstration continue
 * de marcher, et une coupure ne vide pas la cloche.
 */

type NotifKind = 'decisionOk' | 'decisionKo' | 'piece' | 'rdv' | 'demande' | 'message'

type Notif = {
  id: string
  /** Déjà traduit : le serveur rend un code d'événement, le mode local une clé. */
  label: string
  tone: Tone
  icon: IconName
  at: string
  primary: string
  href: string
  /** Renseigné par le serveur. Nul en mode local, où c'est le repère qui décide. */
  readAt?: string | null
}

/** Le genre rendu par le serveur, traduit en icône. */
const SERVER_ICON: Record<string, IconName> = {
  decision: 'check',
  piece: 'documents',
  rendez_vous: 'appointments',
  prospect: 'portal',
  message: 'messages',
  paiement: 'payments',
  cargaison: 'ship',
  douane: 'shield',
  livraison: 'box',
  systeme: 'bell',
}

const KEY = (agency: string, user: string) => `visaflow.notifseen.${agency}.${user}`

export function NotificationBell() {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatDate } = useI18n()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const [seen, setSeen] = useState<string>(() => {
    try { return window.localStorage.getItem(KEY(db.agency.slug, v.user.id)) ?? '' } catch { return '' }
  })

  // Ce que le serveur rend. Nul tant qu'il n'a rien rendu : c'est ce nul qui
  // fait retomber la cloche sur sa dérivation locale.
  const [server, setServer] = useState<ServerNotification[] | null>(null)
  const [serverUnread, setServerUnread] = useState(0)

  const refresh = useCallback(async () => {
    if (!NOTIFS_ONLINE) return
    try {
      const [rows, count] = await Promise.all([myNotifications(40, false), unreadCount()])
      setServer(rows)
      setServerUnread(count)
    } catch {
      // Le serveur ne répond pas : on ne vide pas la cloche, on revient à ce
      // que le navigateur sait déduire tout seul.
      setServer(null)
    }
  }, [])

  // Toutes les minutes. C'est la requête pour laquelle l'index
  // notifications_inbox (user_id, read_at) existe.
  useEffect(() => {
    if (!NOTIFS_ONLINE) return
    void refresh()
    const id = window.setInterval(() => { void refresh() }, 60_000)
    return () => window.clearInterval(id)
  }, [refresh])

  const label: Record<NotifKind, string> = useMemo(() => ({
    decisionOk: t('notif.decisionOk'),
    decisionKo: t('notif.decisionKo'),
    piece: t('notif.piece'),
    rdv: t('notif.rdv'),
    demande: t('notif.demande'),
    message: t('notif.message'),
  }), [t])

  const local = useMemo<Notif[]>(() => {
    const out: Notif[] = []
    const openIds = new Set(v.cases.filter((c) => c.status === 'ouvert').map((c) => c.id))

    // Décisions récentes (21 jours), la nouvelle que l'agent attend le plus.
    for (const c of v.cases) {
      if (!c.decisionAt) continue
      if (c.status !== 'accepte' && c.status !== 'refuse') continue
      if (daysUntil(c.decisionAt) < -21) continue
      const ok = c.status === 'accepte'
      out.push({
        id: `dec-${c.id}`,
        label: ok ? label.decisionOk : label.decisionKo,
        tone: ok ? 'green' : 'red',
        icon: ok ? 'check' : 'close',
        at: c.decisionAt,
        primary: `${clientName(db, c.clientId)} · ${c.reference}`,
        href: `/cases/${c.id}`,
      })
    }

    // Pièces à refaire sur les dossiers ouverts.
    for (const d of v.documents) {
      if (!openIds.has(d.caseId)) continue
      if (d.state !== 'refusee' && d.state !== 'expiree') continue
      const c = v.cases.find((x) => x.id === d.caseId)
      out.push({
        id: `doc-${d.id}`,
        label: label.piece,
        tone: 'orange',
        icon: 'documents',
        at: d.lastReminderAt ?? d.uploadedAt ?? c?.updatedAt ?? new Date().toISOString(),
        primary: c ? `${clientName(db, c.clientId)} · ${c.reference}` : '',
        href: c ? `/cases/${c.id}` : '/documents',
      })
    }

    // Rendez-vous d'aujourd'hui.
    for (const a of v.appointments) {
      if (a.status !== 'prevu' || daysUntil(a.at) !== 0) continue
      const c = a.caseId ? v.cases.find((x) => x.id === a.caseId) : undefined
      out.push({
        id: `rdv-${a.id}`,
        label: label.rdv,
        tone: 'blue',
        icon: 'appointments',
        at: a.at,
        primary: c ? clientName(db, c.clientId) : a.location,
        href: c ? `/cases/${c.id}` : '/appointments',
      })
    }

    // Nouveaux prospects non traités.
    for (const r of db.requests) {
      if (r.status !== 'nouvelle') continue
      out.push({
        id: `req-${r.id}`,
        label: label.demande,
        tone: 'blue',
        icon: 'portal',
        at: r.receivedAt,
        primary: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || r.phone,
        href: '/inbox',
      })
    }

    // Messages entrants récents (7 jours).
    for (const m of v.messages) {
      if (m.direction !== 'entrant' || daysUntil(m.at) < -7) continue
      const c = m.caseId ? v.cases.find((x) => x.id === m.caseId) : undefined
      out.push({
        id: `msg-${m.id}`,
        label: label.message,
        tone: 'violet',
        icon: 'messages',
        at: m.at,
        primary: c ? clientName(db, c.clientId) : label.message,
        href: c ? `/cases/${c.id}` : '/messages',
      })
    }

    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40)
  }, [db, v, label])

  const online = NOTIFS_ONLINE && server !== null

  const items = useMemo<Notif[]>(() => {
    if (!online || server === null) return local
    return server.map((n) => ({
      id: n.id,
      // Le serveur écrit un CODE d'événement, pas une phrase : la ligne est
      // déposée une fois et lue en quatre langues.
      label: t(`notif.e.${n.title}` as TKey),
      tone: severityTone(n.severity) as Tone,
      icon: SERVER_ICON[n.kind] ?? 'bell',
      at: n.createdAt,
      primary: n.body ?? '',
      href: n.url ?? '/',
      readAt: n.readAt,
    }))
  }, [online, server, local, t])

  const isUnread = (n: Notif) => (online ? !n.readAt : n.at > seen)
  const unread = online ? serverUnread : local.filter((n) => n.at > seen).length

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const markAllSeen = () => {
    if (online) {
      void markAllRead().then(() => refresh())
      return
    }
    const now = new Date().toISOString()
    setSeen(now)
    try { window.localStorage.setItem(KEY(db.agency.slug, v.user.id), now) } catch { /* stockage indisponible */ }
  }

  const go = (n: Notif) => {
    setOpen(false)
    if (online) {
      if (!n.readAt) void markRead([n.id]).then(() => refresh())
    } else if (n.at > seen) {
      markAllSeen()
    }
    navigate(n.href)
  }

  return (
    <div className="bell" ref={rootRef}>
      <button
        type="button"
        className="bell__btn"
        aria-label={t('notif.title')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" size={18} />
        {unread > 0 && <span className="bell__badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="bell__panel" role="dialog" aria-label={t('notif.title')}>
          <div className="bell__head">
            <span className="t-medium">{t('notif.title')}</span>
            {unread > 0 && (
              <button type="button" className="linkish t-small" onClick={markAllSeen}>{t('notif.markAll')}</button>
            )}
          </div>
          <div className="bell__list">
            {items.length === 0 ? (
              <p className="bell__empty t-small t-tertiary">{t('notif.none')}</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`bell__item${isUnread(n) ? ' is-unread' : ''}`}
                  onClick={() => go(n)}
                >
                  <span className={`bell__dot bell__dot--${n.tone}`}>
                    <Icon name={n.icon} size={13} />
                  </span>
                  <span className="col gap-1 grow" style={{ textAlign: 'start', minWidth: 0 }}>
                    <span className="t-small t-medium t-truncate">{n.label}</span>
                    <span className="t-caption t-secondary t-truncate">{n.primary}</span>
                  </span>
                  <span className="t-caption t-tertiary" style={{ whiteSpace: 'nowrap' }}>{formatDate(n.at)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
