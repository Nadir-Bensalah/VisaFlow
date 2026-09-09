import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/data/auth'
import { loadCockpit, loadMe } from '@/data/plateforme'
import type { PlatformCap, PlatformMe } from '@/data/plateforme'
import { Button, IconButton } from '@/components/ui'
import { Icon } from '@/components/Icon'
import type { IconName } from '@/components/Icon'
import { AdminSkeleton } from '@/components/AppSkeleton'
import { PlateformeContext } from './contexte'
import type { Compteurs, PlateformeValue } from './contexte'
import { Erreur, Etat } from './kit'
import { AdminPassword } from './AdminPassword'
import '@/styles/admin-cadre.css'

/**
 * LE CADRE DE LA CONSOLE.
 *
 * Une vraie application : barre latérale fixe, pages routées, compteurs
 * vivants. Le squelette ne remplace que le contenu ; le cadre, lui, reste.
 * C'est ce que le client reprochait à l'ancienne page à onglets : « tout le
 * site se saccade à chaque chargement ».
 *
 * Ce composant fournit PlateformeContext (qui est connecté, ce qu'il peut,
 * les compteurs de la barre). Les écrans le lisent avec usePlateforme().
 */

interface Entree {
  to: string
  label: string
  icon: IconName
  end?: boolean
  /** La clé du compteur à afficher, résolue contre `compteurs`. */
  compteur?: keyof Compteurs
  /** Rouge quand le compteur est positif : c'est une alarme, pas une file. */
  alarme?: boolean
  /** Faux quand le rôle n'y a pas droit : l'entrée reste visible, grisée. */
  ouvert?: boolean
}

interface Groupe { label: string; entrees: Entree[] }

const RAFRAICHIR_MS = 60_000

const COMPTEURS_VIDES: Compteurs = { demandes_nouvelles: 0, tickets_ouverts: 0, facturation_urgente: 0, taches_en_echec: 0 }

/** Une pastille qui bat une fois quand le nombre change. */
function Badge({ value, alarme }: { value: number; alarme?: boolean }) {
  const precedent = useRef(value)
  const [pulse, setPulse] = useState(false)
  useEffect(() => {
    if (precedent.current !== value) {
      precedent.current = value
      setPulse(true)
      const id = window.setTimeout(() => setPulse(false), 400)
      return () => window.clearTimeout(id)
    }
  }, [value])
  if (!value) return null
  const cls = ['adm__badge', alarme ? 'adm__badge--red' : '', pulse ? 'adm__badge--pulse' : ''].filter(Boolean).join(' ')
  return <span className={cls}>{value}</span>
}

export function AdminShell() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [me, setMe] = useState<PlatformMe | null>(null)
  const [erreurMe, setErreurMe] = useState<string | null>(null)
  const [compteurs, setCompteurs] = useState<Compteurs>(COMPTEURS_VIDES)
  const [menuOuvert, setMenuOuvert] = useState(false)
  const [paletteOuverte, setPaletteOuverte] = useState(false)

  /* Qui suis-je. Le serveur tranche : null (ou 42501) veut dire « pas admin »,
     et on renvoie vers l'espace agence sans discuter. */
  const chargerMe = useCallback(async () => {
    setErreurMe(null)
    try {
      const m = await loadMe()
      if (!m) { navigate('/', { replace: true }); return }
      setMe(m)
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === '42501') { navigate('/', { replace: true }); return }
      setErreurMe(e instanceof Error ? e.message : 'La console ne répond pas.')
    }
  }, [navigate])

  useEffect(() => {
    // On ne demande rien tant que le serveur n'a pas dit si le compte est
    // admin : sinon un vrai admin serait éjecté pendant la fraction de seconde
    // d'attente, et un intrus verrait un appel partir pour rien.
    if (!auth.adminChecked) return
    if (!auth.isPlatformAdmin) { navigate('/', { replace: true }); return }
    void chargerMe()
  }, [auth.adminChecked, auth.isPlatformAdmin, chargerMe, navigate])

  /* Les compteurs de la barre. Ils viennent du poste de pilotage : une seule
     requête, et les mêmes chiffres que l'écran d'accueil. */
  const rafraichirCompteurs = useCallback(() => {
    loadCockpit().then((c) => {
      setCompteurs({
        demandes_nouvelles: c.kpis.demandes_nouvelles,
        tickets_ouverts: c.kpis.tickets_ouverts,
        facturation_urgente: c.kpis.graces + c.kpis.agences_suspendues,
        taches_en_echec: c.sante.taches_en_echec,
      })
    }).catch(() => {
      // Un compteur qui ne se met pas à jour n'est pas une raison de vider
      // la barre : on garde les derniers chiffres connus.
    })
  }, [])

  useEffect(() => {
    if (!me || me.must_reset_password) return
    rafraichirCompteurs()
    const id = window.setInterval(rafraichirCompteurs, RAFRAICHIR_MS)
    return () => window.clearInterval(id)
  }, [me, rafraichirCompteurs])

  /* Le menu mobile se referme à chaque navigation, et bloque le défilement
     de la page derrière lui tant qu'il est ouvert. */
  useEffect(() => { setMenuOuvert(false) }, [location.pathname])
  useEffect(() => {
    document.body.style.overflow = menuOuvert ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOuvert])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOuverte((v) => !v)
      }
      if (e.key === 'Escape') setMenuOuvert(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const can = useCallback(
    (cap: PlatformCap) => !!me && (me.role === 'superuser' || me.caps.includes(cap)),
    [me],
  )

  const valeur = useMemo<PlateformeValue | null>(
    () => (me ? { me, can, compteurs, rafraichirCompteurs } : null),
    [me, can, compteurs, rafraichirCompteurs],
  )

  const sortir = async () => {
    await auth.signOut()
    navigate('/admin')
  }

  if (erreurMe) {
    return (
      <div className="adm__plein">
        <div className="adm__plein-carte">
          <span className="adm__mark" aria-hidden="true">VF</span>
          <h1>Console plateforme</h1>
          <Erreur message={erreurMe} onRetry={() => void chargerMe()} />
          <Button icon="logout" onClick={() => void sortir()}>Sortir</Button>
        </div>
      </div>
    )
  }

  // Jamais un texte « Chargement… » : la charpente de la console, qui
  // tombera au pixel près sur la vraie barre.
  if (!me || !valeur) return <AdminSkeleton />

  // Deux chemins mènent au même écran : le mot de passe provisoire d'une
  // invitation, et le retour d'un lien « mot de passe oublié » (la session
  // existe alors, mais elle ne doit servir qu'à ça).
  // Un compte désactivé garde sa session mais plus aucun pouvoir : on le dit,
  // au lieu de laisser chaque écran échouer en 42501.
  if (!me.active) {
    return (
      <div className="adm__plein">
        <div className="admin__signin">
          <span className="admin__mark admin__mark--lg">VF</span>
          <h1>Compte désactivé</h1>
          <p className="t-small t-secondary">Votre accès à la console a été désactivé par un administrateur. Contactez la direction de la plateforme.</p>
          <Button icon="logout" onClick={() => { void auth.signOut(); navigate('/admin') }}>Sortir</Button>
        </div>
      </div>
    )
  }
  if (me.must_reset_password || auth.recovering) {
    return <AdminPassword onDone={() => { auth.finishRecovery(); void chargerMe() }} />
  }

  const equipeOuverte = can('equipe.gerer') || me.role === 'superuser' || me.role === 'admin'
  const groupes: Groupe[] = [
    { label: 'Pilotage', entrees: [
      { to: '/admin', label: 'Poste de pilotage', icon: 'dashboard', end: true },
    ] },
    { label: 'Parc', entrees: [
      { to: '/admin/agences', label: 'Agences', icon: 'building' },
      { to: '/admin/demandes', label: 'Demandes', icon: 'sparkle', compteur: 'demandes_nouvelles' },
    ] },
    { label: 'Argent', entrees: [
      { to: '/admin/abonnements', label: 'Abonnements', icon: 'payments' },
      { to: '/admin/facturation', label: 'Facturation', icon: 'reports', compteur: 'facturation_urgente', alarme: true },
    ] },
    { label: 'Relation', entrees: [
      { to: '/admin/assistance', label: 'Assistance', icon: 'messages', compteur: 'tickets_ouverts' },
      { to: '/admin/annonces', label: 'Annonces', icon: 'bell' },
    ] },
    { label: 'Plateforme', entrees: [
      { to: '/admin/equipe', label: 'Équipe', icon: 'shield', ouvert: equipeOuverte },
      { to: '/admin/journal', label: 'Journal', icon: 'clock' },
      { to: '/admin/taches', label: 'Tâches', icon: 'tasks', compteur: 'taches_en_echec', alarme: true },
    ] },
  ]

  const rendreEntree = (e: Entree): ReactNode => {
    const badge = e.compteur !== undefined ? <Badge value={compteurs[e.compteur]} alarme={e.alarme} /> : null
    if (e.ouvert === false) {
      return (
        <span key={e.to} className="adm__navitem adm__navitem--off" title="Réservé : votre rôle n’y donne pas accès" aria-disabled="true">
          <Icon name={e.icon} className="adm__navitem__icon" />
          <span className="adm__navitem__label">{e.label}</span>
          <Icon name="lock" size={13} />
        </span>
      )
    }
    return (
      <NavLink key={e.to} to={e.to} end={e.end} className={({ isActive }) => `adm__navitem ${isActive ? 'adm__navitem--active' : ''}`}>
        <Icon name={e.icon} className="adm__navitem__icon" />
        <span className="adm__navitem__label">{e.label}</span>
        {badge}
      </NavLink>
    )
  }

  return (
    <PlateformeContext.Provider value={valeur}>
      <div className="adm">
        <aside className={`adm__side ${menuOuvert ? 'adm__side--open' : ''}`} aria-label="Console plateforme">
          <div className="adm__brand">
            <span className="adm__mark" aria-hidden="true">VF</span>
            <div className="adm__brand-text">
              <span className="adm__brand-title t-truncate">Console plateforme</span>
              <span className="adm__brand-mail t-truncate" title={me.email}>{me.email}</span>
              <span className="adm__brand-role"><Etat etat={me.role} /></span>
            </div>
          </div>

          <nav className="adm__nav" aria-label="Sections de la console">
            {groupes.map((g) => (
              <div className="adm__group" key={g.label}>
                <div className="adm__group-label">{g.label}</div>
                {g.entrees.map(rendreEntree)}
              </div>
            ))}
          </nav>

          <div className="adm__foot">
            <button type="button" className="adm__navitem" onClick={() => setPaletteOuverte(true)}>
              <Icon name="search" className="adm__navitem__icon" />
              <span className="adm__navitem__label">Trouver une agence</span>
              <span className="adm__badge">⌘K</span>
            </button>
            {can('agences.ouvrir') && (
              <Button variant="primary" icon="plus" onClick={() => navigate('/admin/agences/nouvelle')}>Nouvelle agence</Button>
            )}
            <Button icon="logout" onClick={() => void sortir()}>Sortir</Button>
          </div>
        </aside>

        {menuOuvert && <div className="adm__scrim" aria-hidden="true" onClick={() => setMenuOuvert(false)} />}

        <div className="adm__main">
          <header className="adm__topbar">
            <IconButton icon="menu" label="Menu" onClick={() => setMenuOuvert((v) => !v)} />
            <span className="adm__mark" aria-hidden="true">VF</span>
            <span className="t-medium t-truncate">Console plateforme</span>
            <span className="grow" />
            <IconButton icon="search" label="Trouver une agence" onClick={() => setPaletteOuverte(true)} />
          </header>
          <main className="adm__page" id="contenu">
            <Outlet />
          </main>
        </div>

        {paletteOuverte && <Palette onClose={() => setPaletteOuverte(false)} />}
      </div>
    </PlateformeContext.Provider>
  )
}

/* ------------------------------------------------------------------ */
/* La palette : trouver une agence, ou une page, au clavier             */
/* ------------------------------------------------------------------ */

/** Ce qu'on lit de platform_agencies. Le reste de la ligne ne sert pas ici. */
interface AgenceMini { id: string; slug: string; name: string; suspended?: boolean }

interface Resultat { id: string; groupe: string; label: string; hint?: string; icon: IconName; to: string }

const PAGES: Resultat[] = [
  { id: 'p-cockpit', groupe: 'Pages', label: 'Poste de pilotage', icon: 'dashboard', to: '/admin' },
  { id: 'p-agences', groupe: 'Pages', label: 'Agences', icon: 'building', to: '/admin/agences' },
  { id: 'p-nouvelle', groupe: 'Pages', label: 'Nouvelle agence', icon: 'plus', to: '/admin/agences/nouvelle' },
  { id: 'p-demandes', groupe: 'Pages', label: 'Demandes', icon: 'sparkle', to: '/admin/demandes' },
  { id: 'p-abos', groupe: 'Pages', label: 'Abonnements', icon: 'payments', to: '/admin/abonnements' },
  { id: 'p-factu', groupe: 'Pages', label: 'Facturation', icon: 'reports', to: '/admin/facturation' },
  { id: 'p-assist', groupe: 'Pages', label: 'Assistance', icon: 'messages', to: '/admin/assistance' },
  { id: 'p-annonces', groupe: 'Pages', label: 'Annonces', icon: 'bell', to: '/admin/annonces' },
  { id: 'p-equipe', groupe: 'Pages', label: 'Équipe', icon: 'shield', to: '/admin/equipe' },
  { id: 'p-journal', groupe: 'Pages', label: 'Journal', icon: 'clock', to: '/admin/journal' },
  { id: 'p-taches', groupe: 'Pages', label: 'Tâches', icon: 'tasks', to: '/admin/taches' },
]

function Palette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [actif, setActif] = useState(0)
  const [agences, setAgences] = useState<AgenceMini[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // La liste des agences se charge à l'ouverture, une fois : elle change
  // rarement, et la palette doit répondre au clavier sans attendre le réseau.
  useEffect(() => {
    if (!supabase) return
    let vivant = true
    supabase.rpc('platform_agencies').then(({ data }) => {
      if (!vivant) return
      const lignes = (data as AgenceMini[] | null) ?? []
      setAgences(lignes.map((a) => ({ id: a.id, slug: a.slug, name: a.name, suspended: a.suspended })))
    })
    return () => { vivant = false }
  }, [])

  const resultats = useMemo<Resultat[]>(() => {
    const q = query.trim().toLowerCase()
    const agencesR: Resultat[] = agences.map((a) => ({
      id: a.id, groupe: 'Agences', label: a.name, hint: `${a.slug}.visaflow.app${a.suspended ? ' · suspendue' : ''}`,
      icon: 'building', to: `/admin/agences/${a.id}`,
    }))
    if (!q) return [...agencesR.slice(0, 8), ...PAGES.slice(0, 4)]
    const garde = (r: Resultat) => r.label.toLowerCase().includes(q) || (r.hint ?? '').toLowerCase().includes(q)
    return [...agencesR.filter(garde).slice(0, 12), ...PAGES.filter(garde)]
  }, [agences, query])

  useEffect(() => { setActif(0) }, [query])

  const aller = (r?: Resultat) => {
    if (!r) return
    navigate(r.to)
    onClose()
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Trouver une agence" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="adm-palette">
        <label className="adm-palette__input">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            placeholder="Nom ou sous-domaine d’une agence…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'ArrowDown') { e.preventDefault(); setActif((a) => Math.min(a + 1, resultats.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActif((a) => Math.max(a - 1, 0)) }
              if (e.key === 'Enter') { e.preventDefault(); aller(resultats[actif]) }
            }}
          />
          <kbd>Échap</kbd>
        </label>
        <div className="adm-palette__results">
          {resultats.length === 0 && <p className="adm-palette__vide">Aucune agence ne porte ce nom.</p>}
          {resultats.map((r, i) => {
            const premier = i === 0 || resultats[i - 1].groupe !== r.groupe
            return (
              <div key={r.id}>
                {premier && <div className="adm-palette__group">{r.groupe}</div>}
                <button type="button" className="adm-palette__item" data-active={i === actif} onMouseEnter={() => setActif(i)} onClick={() => aller(r)}>
                  <Icon name={r.icon} size={16} />
                  <span className="grow t-truncate">{r.label}</span>
                  {r.hint && <span className="t-caption t-truncate">{r.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
