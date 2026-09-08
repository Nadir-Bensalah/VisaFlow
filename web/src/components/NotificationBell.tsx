import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Icon } from '@/components/Icon'
import { clientName, daysUntil, type Tone } from '@/lib/derive'

/**
 * La cloche. Le suivi d'une agence, c'est cent petits événements par jour :
 * une décision tombe, une pièce est refusée, un rendez-vous est aujourd'hui,
 * un prospect arrive, un client répond. Sans un endroit qui les rassemble,
 * l'agent apprend la mauvaise nouvelle trop tard. Ici tout est dérivé des
 * données déjà chargées, donc ça marche même hors ligne ; le compteur de
 * non-lus tient dans le navigateur, par agence et par utilisateur. Le push
 * vers le téléphone est la couche du dessus, elle attend des clés serveur.
 */

type NotifKind = 'decisionOk' | 'decisionKo' | 'piece' | 'rdv' | 'demande' | 'message'

type Notif = {
  id: string
  kind: NotifKind
  tone: Tone
  icon: 'check' | 'close' | 'documents' | 'appointments' | 'portal' | 'messages'
  at: string
  primary: string
  href: string
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

  const items = useMemo<Notif[]>(() => {
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
        kind: ok ? 'decisionOk' : 'decisionKo',
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
        kind: 'piece',
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
        kind: 'rdv',
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
        kind: 'demande',
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
        kind: 'message',
        tone: 'violet',
        icon: 'messages',
        at: m.at,
        primary: c ? clientName(db, c.clientId) : t('notif.message'),
        href: c ? `/cases/${c.id}` : '/messages',
      })
    }

    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40)
  }, [db, v, t])

  const unread = items.filter((n) => n.at > seen).length

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const markAllSeen = () => {
    const now = new Date().toISOString()
    setSeen(now)
    try { window.localStorage.setItem(KEY(db.agency.slug, v.user.id), now) } catch { /* stockage indisponible */ }
  }

  const go = (n: Notif) => {
    setOpen(false)
    if (n.at > seen) markAllSeen()
    navigate(n.href)
  }

  const label: Record<NotifKind, string> = {
    decisionOk: t('notif.decisionOk'),
    decisionKo: t('notif.decisionKo'),
    piece: t('notif.piece'),
    rdv: t('notif.rdv'),
    demande: t('notif.demande'),
    message: t('notif.message'),
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
                  className={`bell__item${n.at > seen ? ' is-unread' : ''}`}
                  onClick={() => go(n)}
                >
                  <span className={`bell__dot bell__dot--${n.tone}`}>
                    <Icon name={n.icon} size={13} />
                  </span>
                  <span className="col gap-1 grow" style={{ textAlign: 'start', minWidth: 0 }}>
                    <span className="t-small t-medium t-truncate">{label[n.kind]}</span>
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
