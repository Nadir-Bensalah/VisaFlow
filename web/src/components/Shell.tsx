import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import type { Locale } from '@/data/types'
import { Icon, type IconName } from './Icon'
import { Avatar, IconButton, Select } from './ui'
import { CommandPalette } from './CommandPalette'
import { daysUntil } from '@/lib/derive'
import { roleKey } from '@/lib/permissions'
import type { Capability } from '@/lib/permissions'

interface NavEntry {
  to: string
  labelKey: Parameters<ReturnType<typeof useI18n>['t']>[0]
  icon: IconName
  count?: number
  need?: Capability
}

/** Pastille de compteur qui bat une fois quand le nombre change. */
function Count({ value }: { value: number }) {
  const previous = useRef(value)
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    if (previous.current !== value) {
      previous.current = value
      setPulse(true)
      const id = window.setTimeout(() => setPulse(false), 500)
      return () => window.clearTimeout(id)
    }
  }, [value])

  if (!value) return null
  return <span className={`navitem__count t-num ${pulse ? 'navitem__count--pulse' : ''}`}>{value}</span>
}

export function Shell() {
  const { db, live, setLive, signOut } = useStore()
  const v = useVisible()
  const { t, locale, setLocale } = useI18n()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const location = useLocation()

  const openCases = v.cases.filter((c) => c.status === 'ouvert')
  // Le meme nombre que l'ecran Pieces : des pieces, pas des dossiers.
  const openIds = new Set(openCases.map((c) => c.id))
  const blocked = v.documents.filter(
    (d) => d.required && openIds.has(d.caseId) && ['manquante', 'refusee', 'expiree'].includes(d.state),
  ).length
  const todayAppointments = v.appointments.filter((a) => a.status === 'prevu' && daysUntil(a.at) === 0).length
  const pendingTasks = v.tasks.filter((x) => !x.done && x.assigneeId === v.user.id).length
  const unanswered = v.messages.filter((m) => m.direction === 'entrant' && daysUntil(m.at) >= -2).length

  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((value) => !value)
      }
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const newRequests = db.requests.filter((r) => r.status === 'nouvelle').length

  const work: NavEntry[] = [
    { to: '/', labelKey: 'today.title', icon: 'sun' },
    { to: '/demandes', labelKey: 'inbox.title', icon: 'mail', count: newRequests },
    { to: '/tableau-de-bord', labelKey: 'nav.dashboard', icon: 'dashboard' },
    { to: '/pipeline', labelKey: 'nav.pipeline', icon: 'pipeline' },
    { to: '/dossiers', labelKey: 'nav.cases', icon: 'cases', count: openCases.length },
    { to: '/pieces', labelKey: 'nav.documents', icon: 'documents', count: blocked },
    ...(db.agency.services.includes('fret')
      ? [{ to: '/cargaisons', labelKey: 'nav.shipments' as const, icon: 'ship' as const, count: v.shipments.filter((x) => x.status === 'en_cours').length }]
      : []),
    { to: '/clients', labelKey: 'nav.clients', icon: 'clients' },
  ]
  const flow: NavEntry[] = [
    { to: '/messages', labelKey: 'nav.messages', icon: 'messages', count: unanswered },
    { to: '/rendez-vous', labelKey: 'nav.appointments', icon: 'appointments', count: todayAppointments },
    { to: '/paiements', labelKey: 'nav.payments', icon: 'payments', need: 'finance:global' },
    { to: '/taches', labelKey: 'nav.myTasks', icon: 'tasks', count: pendingTasks },
  ]
  const admin: NavEntry[] = [
    { to: '/automatisations', labelKey: 'nav.automations', icon: 'automations', need: 'automation:manage' },
    { to: '/rapports', labelKey: 'nav.reports', icon: 'reports', need: 'reports:view' },
    { to: '/reglages', labelKey: 'nav.settings', icon: 'settings', need: 'settings:view' },
  ]

  const renderNav = (entries: NavEntry[]) =>
    entries
      .filter((e) => !e.need || v.can(e.need))
      .map((e) => (
        <NavLink key={e.to} to={e.to} end={e.to === '/'} className={({ isActive }) => `navitem ${isActive ? 'navitem--active' : ''}`}>
          <Icon name={e.icon} className="navitem__icon" />
          <span className="grow t-truncate">{t(e.labelKey)}</span>
          {e.count !== undefined && <Count value={e.count} />}
        </NavLink>
      ))

  const adminEntries = admin.filter((e) => !e.need || v.can(e.need))

  return (
    <div className="shell">
      <a className="skip" href="#contenu">{t('nav.workspace')}</a>

      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`} aria-label={db.agency.name}>
        <div className="sidebar__brand">
          <span className="sidebar__mark" style={{ background: db.agency.accent }}>{db.agency.mark}</span>
          <span className="col" style={{ minWidth: 0 }}>
            <span className="t-title t-truncate" style={{ fontSize: 'var(--size-control)' }}>{db.agency.name}</span>
            <span className="t-caption t-tertiary t-truncate">{db.agency.slug}.visaflow.app</span>
          </span>
        </div>

        <nav className="sidebar__nav">
          {renderNav(work)}
          <div className="sidebar__group">
            <div className="sidebar__group-label">{t('nav.workspace')}</div>
            {renderNav(flow)}
          </div>
          {adminEntries.length > 0 && (
            <div className="sidebar__group">
              <div className="sidebar__group-label">{t('nav.admin')}</div>
              {renderNav(admin)}
            </div>
          )}
          <div className="sidebar__group">
            <div className="sidebar__group-label">{t('nav.portal')}</div>
            <NavLink to="/agence" className="navitem">
              <Icon name="portal" className="navitem__icon" />
              <span className="grow t-truncate">{t('nav.portal')}</span>
              <Icon name="arrow" size={14} />
            </NavLink>
          </div>
        </nav>

        <div className="sidebar__foot">
          <div className="row row-nowrap">
            <Avatar name={v.user.name} size="sm" />
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className="t-small t-medium t-truncate">{v.user.name}</span>
              <span className="t-caption t-tertiary t-truncate">{t(roleKey(v.user.role))}</span>
            </span>
            <IconButton
              icon="logout"
              label={t('action.signOut')}
              onClick={() => { signOut(); navigate('/connexion') }}
            />
          </div>
        </div>
      </aside>

      {menuOpen && <div className="scrim" aria-hidden="true" onClick={() => setMenuOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <IconButton icon="menu" label="Menu" className="sidebar__toggle" onClick={() => setMenuOpen((value) => !value)} />

          <button type="button" className="search grow" style={{ maxWidth: 420 }} onClick={() => setPaletteOpen(true)}>
            <Icon name="search" size={16} />
            <span className="grow t-truncate t-small" style={{ textAlign: 'start' }}>{t('search.placeholder')}</span>
            <kbd>⌘K</kbd>
          </button>

          <div className="row gap-2 row-nowrap" style={{ marginInlineStart: 'auto' }}>
            <button
              type="button"
              className="live"
              onClick={() => setLive(!live)}
              title={t('live.hint')}
              style={{ border: 0, background: 'transparent', cursor: 'pointer' }}
            >
              <span className={`live__dot ${live ? '' : 'live__dot--off'}`} />
              <span className="topbar__user">{live ? t('live.on') : t('live.off')}</span>
            </button>
            <Select
              aria-label={t('misc.language')}
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              style={{ width: 'auto', minHeight: 32 }}
            >
              {LOCALES.map((l) => (
                <option key={l} value={l}>{LOCALE_META[l].native}</option>
              ))}
            </Select>
          </div>
        </header>

        <main className="content" id="contenu">
          {v.scope === 'bureau' && (
            <p className="scopebar">
              <Icon name="building" size={13} />
              {t('access.scopeOffice', { office: db.agency.offices.find((o) => o.id === v.user.officeId)?.name ?? '' })}
            </p>
          )}
          <Outlet />
        </main>
      </div>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}
