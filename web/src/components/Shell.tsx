import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import type { Locale } from '@/data/types'
import { Icon, type IconName } from './Icon'
import { Avatar, IconButton, Select } from './ui'
import { CommandPalette } from './CommandPalette'
import { blockingDocs, kpis } from '@/lib/derive'

interface NavEntry { to: string; labelKey: Parameters<ReturnType<typeof useI18n>['t']>[0]; icon: IconName; count?: number }

export function Shell() {
  const { db, currentUserId, setCurrentUserId } = useStore()
  const { t, locale, setLocale } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const location = useLocation()

  const k = kpis(db)
  const openCases = db.cases.filter((c) => c.status === 'ouvert')
  const blocked = openCases.filter((c) => blockingDocs(db, c.id).length > 0).length
  const pendingTasks = db.tasks.filter((x) => !x.done).length
  const user = db.users.find((u) => u.id === currentUserId) ?? db.users[0]

  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const work: NavEntry[] = [
    { to: '/', labelKey: 'nav.dashboard', icon: 'dashboard' },
    { to: '/pipeline', labelKey: 'nav.pipeline', icon: 'pipeline' },
    { to: '/dossiers', labelKey: 'nav.cases', icon: 'cases', count: openCases.length },
    { to: '/pieces', labelKey: 'nav.documents', icon: 'documents', count: blocked },
    { to: '/cargaisons', labelKey: 'nav.shipments', icon: 'ship', count: db.shipments.filter((x) => x.status === 'en_cours').length },
    { to: '/clients', labelKey: 'nav.clients', icon: 'clients' },
  ]
  const flow: NavEntry[] = [
    { to: '/messages', labelKey: 'nav.messages', icon: 'messages' },
    { to: '/rendez-vous', labelKey: 'nav.appointments', icon: 'appointments', count: k.todayAppointments },
    { to: '/paiements', labelKey: 'nav.payments', icon: 'payments' },
    { to: '/taches', labelKey: 'nav.workspace', icon: 'tasks', count: pendingTasks },
  ]
  const admin: NavEntry[] = [
    { to: '/automatisations', labelKey: 'nav.automations', icon: 'automations' },
    { to: '/rapports', labelKey: 'nav.reports', icon: 'reports' },
    { to: '/reglages', labelKey: 'nav.settings', icon: 'settings' },
  ]

  const renderNav = (entries: NavEntry[]) =>
    entries.map((e) => (
      <NavLink key={e.to} to={e.to} end={e.to === '/'} className={({ isActive }) => `navitem ${isActive ? 'navitem--active' : ''}`}>
        <Icon name={e.icon} className="navitem__icon" />
        <span className="grow t-truncate">{t(e.labelKey)}</span>
        {e.count ? <span className="navitem__count t-num">{e.count}</span> : null}
      </NavLink>
    ))

  return (
    <div className="shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__brand">
          <span className="sidebar__mark" style={{ background: db.agency.accent }}>{db.agency.mark}</span>
          <span className="col" style={{ minWidth: 0 }}>
            <span className="t-title t-truncate" style={{ fontSize: 14 }}>{db.agency.name}</span>
            <span className="t-caption t-tertiary t-truncate">{db.agency.slug}.visaflow.app</span>
          </span>
        </div>

        <nav className="sidebar__nav">
          {renderNav(work)}
          <div className="sidebar__group">
            <div className="sidebar__group-label">{t('nav.workspace')}</div>
            {renderNav(flow)}
          </div>
          <div className="sidebar__group">
            <div className="sidebar__group-label">{t('nav.admin')}</div>
            {renderNav(admin)}
          </div>
          <div className="sidebar__group">
            <div className="sidebar__group-label">{t('nav.portal')}</div>
            <NavLink to="/portail" className="navitem">
              <Icon name="portal" className="navitem__icon" />
              <span className="grow t-truncate">{t('nav.portal')}</span>
              <Icon name="arrow" size={14} />
            </NavLink>
          </div>
        </nav>

        <div className="sidebar__foot">
          <div className="row">
            <Avatar name={user.name} size="sm" />
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className="t-small t-medium t-truncate">{user.name}</span>
              <span className="t-caption t-tertiary t-truncate">{t(`misc.${user.role === 'agent' ? 'agentRole' : user.role}` as 'misc.owner')}</span>
            </span>
            <NavLink to="/connexion" className="btn btn--icon" aria-label={t('action.signOut')} title={t('action.signOut')}>
              <Icon name="logout" size={16} />
            </NavLink>
          </div>
        </div>
      </aside>

      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <IconButton icon="menu" label="Menu" className="sidebar__toggle" onClick={() => setMenuOpen((v) => !v)} />

          <button type="button" className="search grow" style={{ maxWidth: 420 }} onClick={() => setPaletteOpen(true)}>
            <Icon name="search" size={16} />
            <span className="grow t-truncate t-small" style={{ textAlign: 'start' }}>{t('search.placeholder')}</span>
            <kbd>⌘K</kbd>
          </button>

          <div className="row gap-2" style={{ marginInlineStart: 'auto' }}>
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
            <Select
              aria-label={t('misc.agent')}
              value={currentUserId}
              onChange={(e) => setCurrentUserId(e.target.value)}
              style={{ width: 'auto', minHeight: 32 }}
            >
              {db.users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}
