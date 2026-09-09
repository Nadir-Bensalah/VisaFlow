import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import type { Locale } from '@/data/types'
import { Icon, type IconName } from './Icon'
import { Avatar, IconButton, Select } from './ui'
import { CommandPalette } from './CommandPalette'
import { brandTheme, themeVariables } from '@/lib/marque'
import { NotificationBell } from './NotificationBell'
import { AnnouncementBanner } from './AnnouncementBanner'
import { BillingBanner } from './BillingBanner'
import { QuotaBanner } from './QuotaBanner'
import { FeedbackButton } from './FeedbackButton'
import { daysUntil } from '@/lib/derive'
import { roleKey } from '@/lib/permissions'
import type { Capability } from '@/lib/permissions'

type TKeyOf = Parameters<ReturnType<typeof useI18n>['t']>[0]

interface NavEntry {
  to: string
  labelKey: TKeyOf
  icon: IconName
  count?: number
  need?: Capability
}

/* Un groupe de la barre latérale.
   Le cahier des charges demande une navigation par métier (Visa, Fret,
   Finance), et dans la même page qu'on n'ait jamais l'impression d'ouvrir un
   ERP. Les deux tiennent ensemble à une condition : chaque groupe se replie, et
   celui qu'on n'utilise pas ne s'ouvre jamais. Une agence de visas seule ne
   voit aucune ligne de fret, pas même repliée. */
interface NavGroup {
  key: string
  labelKey?: TKeyOf
  entries: NavEntry[]
  /** Faux quand l'agence n'a pas ce métier : le groupe n'existe pas du tout. */
  visible?: boolean
  /** Un groupe sans titre ne se replie pas : c'est le haut de la barre. */
  collapsible?: boolean
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


/* LES ONGLETS D'UN GROUPE.
   Ce qui est sorti de la barre latérale se retrouve ici. On les dessine dans la
   coquille plutôt que dans chaque page : quinze écrans à modifier auraient donné
   quinze occasions d'oublier une entrée, et deux barres d'onglets qui ne se
   ressemblent pas. */
interface Onglet { to: string; labelKey: TKeyOf; need?: Capability; si?: 'visas' | 'fret'
  /** La clé du compteur à afficher, résolue plus bas contre les données visibles. */
  compteur?: 'pieces' | 'rdv' | 'creneaux' | 'taches' | 'dossiers' | 'cargaisons' }

const ONGLETS: { racine: string; membres: Onglet[] }[] = [
  {
    racine: '/dossiers',
    membres: [
      { to: '/dossiers', labelKey: 'nav.cases' },
      { to: '/pipeline', labelKey: 'nav.pipeline' },
      { to: '/pieces', labelKey: 'nav.documents', compteur: 'pieces' },
      { to: '/traductions', labelKey: 'trad.title' },
      { to: '/rendez-vous', labelKey: 'nav.appointments', compteur: 'rdv' },
      { to: '/creneaux', labelKey: 'nav.slots', compteur: 'creneaux' },
    ],
  },
  {
    racine: '/cargaisons',
    membres: [
      { to: '/cargaisons', labelKey: 'nav.shipments' },
      { to: '/livraisons', labelKey: 'nav.deliveries', need: 'shipment:write' },
      { to: '/entrepot', labelKey: 'nav.warehouse', need: 'shipment:write' },
      { to: '/repertoires', labelKey: 'nav.directory', need: 'shipment:write' },
    ],
  },
  {
    racine: '/commercial',
    membres: [
      { to: '/commercial', labelKey: 'nav.leads' },
      { to: '/devis', labelKey: 'nav.quotes', need: 'payment:write' },
    ],
  },
  {
    racine: '/factures',
    membres: [
      { to: '/factures', labelKey: 'nav.invoices', need: 'payment:write' },
      { to: '/paiements', labelKey: 'nav.payments', need: 'finance:global' },
      { to: '/prestations', labelKey: 'voy.pageTitle' },
    ],
  },
  {
    racine: '/pilotage',
    membres: [
      { to: '/pilotage', labelKey: 'pil.title', need: 'reports:view' },
      { to: '/tableau-de-bord', labelKey: 'nav.dashboard' },
      { to: '/rapports', labelKey: 'nav.reports', need: 'reports:view' },
      { to: '/statistiques', labelKey: 'nav.stats', need: 'reports:view' },
      { to: '/automatisations', labelKey: 'nav.automations', need: 'automation:manage' },
    ],
  },
  {
    racine: '/',
    membres: [
      { to: '/', labelKey: 'nav.today' },
      { to: '/taches', labelKey: 'nav.myTasks', compteur: 'taches' },
    ],
  },
]

export function Shell() {
  const { db, live, setLive, signOut, syncError, retry, support, exitSupport, officeFilter, setOfficeFilter } = useStore()
  const v = useVisible()
  const { t, locale, setLocale } = useI18n()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  /* Quels groupes sont ouverts. On mémorise le choix : une barre qui se
     replie à chaque navigation est plus fatigante qu'une barre trop longue.
     Absent du dictionnaire veut dire ouvert, pour qu'une agence qui découvre
     l'outil voie tout la première fois. */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(window.localStorage.getItem('visaflow.nav') ?? '{}') as Record<string, boolean> } catch { return {} }
  })
  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [key]: prev[key] === false }
      try { window.localStorage.setItem('visaflow.nav', JSON.stringify(next)) } catch { /* stockage indisponible */ }
      return next
    })
  }
  const [paletteOpen, setPaletteOpen] = useState(false)
  const location = useLocation()

  /* La marque de l'agence. Elle choisit une couleur ; le texte, les
     séparateurs et l'état actif se calculent, sinon un bleu marine laisserait
     du texte noir illisible. Tant qu'aucune couleur n'est choisie, les
     variables valent le thème du produit et rien ne bouge. */
  const marque = !!(db.agency.sidebarColor || db.agency.accentColor)
  const theme = brandTheme(db.agency.sidebarColor, db.agency.accentColor)
  const themeVars = marque ? themeVariables(theme) : {}

  const openCases = v.cases.filter((c) => c.status === 'ouvert')
  // Le meme nombre que l'ecran Pieces : des pieces, pas des dossiers.
  const openIds = new Set(openCases.map((c) => c.id))
  const blocked = v.documents.filter(
    (d) => d.required && openIds.has(d.caseId) && ['manquante', 'refusee', 'expiree'].includes(d.state),
  ).length
  const todayAppointments = v.appointments.filter((a) => a.status === 'prevu' && daysUntil(a.at) === 0).length
  // Le badge le plus utile de la barre : combien de clients attendent encore
  // un créneau, tous postes confondus.
  const waitingSlots = v.queue.filter((q) => q.status === 'attente').length
  const pendingTasks = v.tasks.filter((x) => !x.done && x.assigneeId === v.user.id).length
  const unanswered = v.messages.filter((m) => m.direction === 'entrant' && daysUntil(m.at) >= -2).length

  /* Le groupe auquel appartient la page ouverte. On prend le groupe qui
     contient la route exacte, et à défaut celui dont la racine préfixe la
     route : la fiche d'un dossier reste dans le groupe Visa. */
  const groupeCourant = ONGLETS.find((g) => g.membres.some((m) => m.to === location.pathname))
    ?? ONGLETS.find((g) => g.racine !== '/' && location.pathname.startsWith(g.racine))
  const compteurs: Record<string, number> = {
    pieces: blocked, rdv: todayAppointments, creneaux: waitingSlots, taches: pendingTasks,
    dossiers: openCases.length, cargaisons: v.shipments.filter((x) => x.status === 'en_cours').length,
  }
  const onglets = (groupeCourant?.membres ?? []).filter((o) => {
    if (o.need && !v.can(o.need)) return false
    if (o.si === 'visas' && !db.agency.services.includes('visas')) return false
    if (o.si === 'fret' && !db.agency.services.includes('fret')) return false
    return true
  })

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

  const fait = db.agency.services
  const aVisas = fait.includes('visas')
  const aFret = fait.includes('fret')

  /* DOUZE ENTRÉES, PAS VINGT-HUIT.
     Chaque module livré avait ajouté sa ligne, et personne n'avait jamais
     soustrait. Le résultat était une barre de vingt-huit entrées où un
     conseiller ne retrouvait pas les quatre qu'il utilise vraiment.
     Ce qui sort d'ici ne disparaît pas : chaque entrée est la racine d'un
     groupe, et les écrans du groupe s'ouvrent en onglets sous la barre du
     haut (voir ONGLETS plus bas). Une agence de visas seule ne voit aucune
     ligne de fret, pas même repliée. */
  const groups: NavGroup[] = [
    {
      key: 'tete',
      entries: [
        { to: '/', labelKey: 'nav.today', icon: 'sun' },
        { to: '/demandes', labelKey: 'inbox.title', icon: 'mail', count: newRequests },
        { to: '/clients', labelKey: 'nav.clients', icon: 'clients' },
      ],
    },
    {
      key: 'metier',
      labelKey: 'nav.workspace',
      collapsible: true,
      entries: [
        ...(aVisas ? [{ to: '/dossiers', labelKey: 'nav.visa' as const, icon: 'cases' as const, count: openCases.length }] : []),
        ...(aFret ? [{ to: '/cargaisons', labelKey: 'nav.fret' as const, icon: 'ship' as const, count: v.shipments.filter((x) => x.status === 'en_cours').length }] : []),
        { to: '/commercial', labelKey: 'nav.commercial', icon: 'sparkle' },
        { to: '/messages', labelKey: 'nav.messages', icon: 'messages', count: unanswered },
      ],
    },
    {
      key: 'gestion',
      labelKey: 'nav.pilotage',
      collapsible: true,
      entries: [
        { to: '/factures', labelKey: 'nav.money', icon: 'payments', need: 'payment:write' },
        { to: '/pilotage', labelKey: 'nav.pilotage', icon: 'reports', need: 'reports:view' },
        { to: '/equipe', labelKey: 'eq.title', icon: 'clients', need: 'settings:view' },
      ],
    },
    {
      key: 'pied',
      entries: [
        { to: '/reglages', labelKey: 'nav.settings', icon: 'settings', need: 'settings:view' },
        { to: '/aide', labelKey: 'nav.support', icon: 'shield' },
      ],
    },
  ]

  // Un groupe vide ne s'affiche pas : filtrer les droits AVANT de dessiner
  // évite un titre de section suivi de rien.
  const shown = groups
    .filter((g) => g.visible !== false)
    .map((g) => ({ ...g, entries: g.entries.filter((e) => !e.need || v.can(e.need)) }))
    .filter((g) => g.entries.length > 0)

  const renderEntries = (entries: NavEntry[]) =>
    entries.map((e) => (
      <NavLink key={e.to} to={e.to} end={e.to === '/'} className={({ isActive }) => `navitem ${isActive ? 'navitem--active' : ''}`}>
        <Icon name={e.icon} className="navitem__icon" />
        <span className="grow t-truncate">{t(e.labelKey)}</span>
        {e.count !== undefined && <Count value={e.count} />}
      </NavLink>
    ))

  return (
    <div className="shell">
      <a className="skip" href="#contenu">{t('nav.workspace')}</a>

      <aside
        className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}
        aria-label={db.agency.name}
        data-marque={marque ? 'oui' : undefined}
        style={themeVars as React.CSSProperties}
      >
        <div className="sidebar__brand">
          {/* Le logo remplace le carré d'initiales dès qu'il existe. */}
          {db.agency.logoUrl ? (
            <img className="sidebar__logo" src={db.agency.logoUrl} alt={db.agency.displayName ?? db.agency.name} />
          ) : (
            <span className="sidebar__mark" style={{ background: theme.accent, color: theme.accentText }}>
              {db.agency.mark}
            </span>
          )}
          <span className="col" style={{ minWidth: 0 }}>
            <span className="t-title t-truncate t-medium" style={{ fontSize: 'var(--size-control)' }}>
              {db.agency.displayName ?? db.agency.name}
            </span>
            <span className="t-caption t-tertiary t-truncate">{db.agency.slug}.visaflow.app</span>
          </span>
        </div>

        <nav className="sidebar__nav">
          {shown.map((g) =>
            g.labelKey && g.collapsible ? (
              <div className="sidebar__group" key={g.key}>
                <button
                  type="button"
                  className="sidebar__group-label sidebar__group-toggle"
                  aria-expanded={openGroups[g.key] !== false}
                  onClick={() => toggleGroup(g.key)}
                >
                  <span className="grow">{t(g.labelKey)}</span>
                  <Icon name="chevron" size={12} className={openGroups[g.key] === false ? '' : 'sidebar__chev--open'} />
                </button>
                {openGroups[g.key] !== false && renderEntries(g.entries)}
              </div>
            ) : (
              <div className={g.key === 'tete' ? '' : 'sidebar__group'} key={g.key}>
                {renderEntries(g.entries)}
              </div>
            ),
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
        {/* Les bandeaux vivent dans la colonne principale, au-dessus de la barre
            du haut. Posés à côté de la barre latérale, ils devenaient des
            colonnes de la coque (display: flex) et poussaient tout le contenu. */}
        <AnnouncementBanner />
        <BillingBanner agencyId={db.agency.id} />
        <QuotaBanner />
        {syncError && (
          <div className="syncbar" role="alert">
            <Icon name="alert" size={16} />
            <span className="grow t-small">{t(`sync.${syncError}` as 'sync.connexion')}</span>
            <button type="button" className="syncbar__btn" onClick={retry}>{t('sync.retry')}</button>
          </div>
        )}
        <header className="topbar">
          <IconButton icon="menu" label="Menu" className="sidebar__toggle" onClick={() => setMenuOpen((value) => !value)} />

          <button type="button" className="search grow" style={{ maxWidth: 420 }} onClick={() => setPaletteOpen(true)}>
            <Icon name="search" size={16} />
            <span className="grow t-truncate t-small" style={{ textAlign: 'start' }}>{t('search.placeholder')}</span>
            <kbd>⌘K</kbd>
          </button>

          <div className="row gap-2 row-nowrap" style={{ marginInlineStart: 'auto' }}>
            {/* La direction choisit le bureau qu'elle regarde. Un agent n'a
                pas ce choix : il ne voit que le sien, et le sélecteur n'existe
                pas pour lui. */}
            {v.scope === 'agence' && db.agency.offices.filter((o) => o.active !== false).length > 1 && (
              <Select
                aria-label={t('settings.offices')}
                value={officeFilter ?? ''}
                onChange={(e) => setOfficeFilter(e.target.value || null)}
                style={{ width: 'auto', minHeight: 32, maxWidth: 180 }}
              >
                <option value="">{t('equipe.allOffices')}</option>
                {db.agency.offices.filter((o) => o.active !== false).map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            )}
            <FeedbackButton />
            <NotificationBell />
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

        {onglets.length > 1 && (
          <nav className="sectiontabs" aria-label={t('nav.workspace')}>
            {onglets.map((o) => (
              <NavLink
                key={o.to}
                to={o.to}
                end={o.to === '/' || o.to === '/dossiers' || o.to === '/cargaisons'}
                className={({ isActive }) => `sectiontab ${isActive ? 'sectiontab--active' : ''}`}
              >
                <span>{t(o.labelKey)}</span>
                {o.compteur !== undefined && compteurs[o.compteur] > 0 && (
                  <span className="sectiontab__count t-num">{compteurs[o.compteur]}</span>
                )}
              </NavLink>
            ))}
          </nav>
        )}

        {support && (
          <div className="supportbar" role="status">
            <Icon name="eye" size={14} />
            <span className="grow t-small">
              {t('support.banner', { agency: support.agencyName })}
            </span>
            <button
              type="button"
              className="supportbar__btn"
              onClick={() => { exitSupport(); navigate('/admin') }}
            >
              {t('support.exit')}
            </button>
          </div>
        )}
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
