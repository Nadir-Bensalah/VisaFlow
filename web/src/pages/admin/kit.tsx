import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Empty, Input, Modal, Pill } from '@/components/ui'
import { Icon } from '@/components/Icon'
import type { IconName } from '@/components/Icon'
import type { Tone } from '@/lib/derive'
import type { Severite } from '@/data/plateforme'

/**
 * LA BOÎTE À OUTILS DE LA CONSOLE.
 *
 * Tout écran de la console se construit avec ces pièces, et seulement
 * celles-ci pour ce qu'elles couvrent : l'en-tête de page, les chiffres de
 * tête, les tableaux, les squelettes, la confirmation d'un geste grave.
 * Douze écrans qui dessinent chacun leur propre tableau finissent par douze
 * tableaux différents ; c'est exactement ce qu'on refuse.
 *
 * Les styles vivent dans styles/admin.css, préfixe `adm-`.
 */

/* ------------------------------ Formats ------------------------------ */

export const money = (n: number | null | undefined, cur = 'TND') =>
  n === null || n === undefined ? '·'
    : new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 }).format(n) + ' ' + cur

export const nb = (n: number | null | undefined) =>
  n === null || n === undefined ? '·' : new Intl.NumberFormat('fr-TN').format(n)

export const dateFr = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('fr-TN', { day: 'numeric', month: 'short', year: 'numeric' }) : '·'

export const dateHeure = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('fr-TN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '·'

/** « il y a 3 h », « il y a 2 j », « à l'instant ». */
export function depuis(iso: string | null | undefined): string {
  if (!iso) return '·'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'à l’instant'
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  if (s < 86400 * 30) return `il y a ${Math.floor(s / 86400)} j`
  return dateFr(iso)
}

/** « dans 3 j », « aujourd'hui », « depuis 2 j » pour un compte à rebours. */
export function delai(jours: number | null | undefined): string {
  if (jours === null || jours === undefined) return '·'
  if (jours === 0) return 'aujourd’hui'
  if (jours > 0) return `dans ${jours} j`
  return `depuis ${-jours} j`
}

export const octets = (n: number) =>
  n < 1024 ? `${n} o` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} Ko`
    : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} Mo` : `${(n / 1024 ** 3).toFixed(2)} Go`

/* --------------------------- Chargement ------------------------------ */

/**
 * Charger, et recharger sans jamais vider l'écran.
 *
 * `loading` n'est vrai qu'au premier chargement : c'est le seul moment où le
 * squelette a sa place. Ensuite `refreshing` signale une actualisation, et
 * les données précédentes restent affichées jusqu'à l'arrivée des nouvelles.
 * Un écran qui se vide à chaque rafraîchissement donne l'impression de
 * planter ; c'est ce que l'on corrige ici, une fois pour tous les écrans.
 */
export function useChargement<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vivant = useRef(true)
  const ref = useRef(loader)
  ref.current = loader

  const reload = useCallback(async () => {
    setRefreshing(true)
    try {
      const r = await ref.current()
      if (vivant.current) { setData(r); setError(null) }
    } catch (e) {
      if (vivant.current) setError(e instanceof Error ? e.message : 'Chargement impossible.')
    } finally {
      if (vivant.current) { setLoading(false); setRefreshing(false) }
    }
  }, [])

  useEffect(() => {
    vivant.current = true
    void reload()
    return () => { vivant.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, refreshing, error, reload, setData }
}

/* ----------------------------- En-tête ------------------------------- */

export function PageHeader({ kicker, title, subtitle, actions, refreshing }: {
  kicker?: string; title: string; subtitle?: ReactNode; actions?: ReactNode; refreshing?: boolean
}) {
  return (
    <header className="adm-page__head">
      <div className="adm-page__titles">
        {kicker && <span className="adm-kicker">{kicker}</span>}
        <h1 className="adm-page__title">{title}</h1>
        {subtitle && <p className="adm-page__sub">{subtitle}</p>}
      </div>
      <div className="adm-page__actions">
        {refreshing && <span className="adm-refresh" aria-live="polite"><Icon name="refresh" size={14} /> Actualisation</span>}
        {actions}
      </div>
    </header>
  )
}

/** Une barre d'outils au-dessus d'un tableau : filtres à gauche, gestes à droite. */
export function Barre({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="adm-barre">
      <div className="adm-barre__left">{children}</div>
      <div className="adm-barre__right">{right}</div>
    </div>
  )
}

/* ------------------------------ Chiffres ----------------------------- */

export function Kpi({ label, value, hint, delta, spark, tone, to, icon }: {
  label: string
  value: string | number
  hint?: string
  /** Variation signée, ex. +12 %, affichée en vert ou rouge. */
  delta?: { value: number; suffix?: string; inverse?: boolean }
  spark?: number[]
  tone?: 'blue' | 'green' | 'orange' | 'red' | 'gray'
  to?: string
  icon?: IconName
}) {
  const inner = (
    <>
      <div className="adm-kpi__top">
        <span className="adm-kpi__label">{label}</span>
        {icon && <Icon name={icon} size={15} className="adm-kpi__icon" />}
      </div>
      <div className="adm-kpi__row">
        <span className="adm-kpi__value t-num">{value}</span>
        {delta && (
          <span className={`adm-kpi__delta adm-kpi__delta--${(delta.inverse ? -delta.value : delta.value) > 0 ? 'up' : (delta.inverse ? -delta.value : delta.value) < 0 ? 'down' : 'flat'}`}>
            {delta.value > 0 ? '+' : ''}{nb(delta.value)}{delta.suffix ?? ''}
          </span>
        )}
      </div>
      {spark && spark.length > 1 && <Sparkline points={spark} tone={tone ?? 'blue'} />}
      {hint && <span className="adm-kpi__hint">{hint}</span>}
    </>
  )
  const cls = `adm-kpi ${tone ? `adm-kpi--${tone}` : ''} ${to ? 'adm-kpi--link' : ''}`
  return to ? <Link to={to} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>
}

export function KpiGrid({ children, cols }: { children: ReactNode; cols?: number }) {
  return <div className="adm-kpis" style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}>{children}</div>
}

/** Une courbe minuscule, sans axe : la tendance, pas la mesure. */
export function Sparkline({ points, tone = 'blue', width = 120, height = 32, fill = true }: {
  points: number[]; tone?: 'blue' | 'green' | 'orange' | 'red' | 'gray'; width?: number; height?: number; fill?: boolean
}) {
  const max = Math.max(...points, 1)
  const min = Math.min(...points, 0)
  const span = max - min || 1
  const step = width / Math.max(points.length - 1, 1)
  const coords = points.map((p, i) => [i * step, height - 3 - ((p - min) / span) * (height - 6)] as const)
  const d = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const last = coords[coords.length - 1]
  return (
    <svg className={`adm-spark adm-spark--${tone}`} viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
      {fill && <path d={`${d} L${width},${height} L0,${height} Z`} className="adm-spark__fill" />}
      <path d={d} className="adm-spark__line" />
      {last && <circle cx={last[0]} cy={last[1]} r={2.5} className="adm-spark__dot" />}
    </svg>
  )
}

/** Des barres pour douze mois : quand la valeur compte autant que la tendance. */
export function Barres({ points, labels, tone = 'blue', height = 120, format = nb }: {
  points: number[]; labels: string[]; tone?: 'blue' | 'green' | 'orange' | 'gray'; height?: number; format?: (n: number) => string
}) {
  const max = Math.max(...points, 1)
  return (
    <div className={`adm-barres adm-barres--${tone}`} style={{ height }}>
      {points.map((p, i) => (
        <div key={i} className="adm-barres__col" title={`${labels[i]} · ${format(p)}`}>
          <span className="adm-barres__val t-num">{p > 0 ? format(p) : ''}</span>
          <span className="adm-barres__bar" style={{ height: `${Math.max(2, (p / max) * 100)}%` }} />
          <span className="adm-barres__lab">{labels[i]}</span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------ Tableaux ----------------------------- */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <div className="adm-scroll"><table className={`adm-table ${className ?? ''}`}>{children}</table></div>
}

/** Une ligne d'un tableau qui n'est qu'un libellé et sa valeur. */
export function Ligne({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="adm-ligne">
      <span className="adm-ligne__label">{label}</span>
      <span className={`adm-ligne__value ${mono ? 't-mono' : ''}`}>{children}</span>
    </div>
  )
}

export function Section({ title, action, children, flush, className }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean; className?: string
}) {
  return <Card title={title} action={action} flush={flush} className={`adm-section ${className ?? ''}`}>{children}</Card>
}

export function Vide({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return <div className="adm-vide"><Empty title={title} hint={hint} action={action} scene="aucune" /></div>
}

/* ------------------------------- États ------------------------------- */

const ETATS: Record<string, { label: string; tone: Tone }> = {
  essai: { label: 'Essai', tone: 'blue' },
  grace: { label: 'Délai de grâce', tone: 'orange' },
  a_jour: { label: 'À jour', tone: 'green' },
  suspendue: { label: 'Suspendue', tone: 'red' },
  active: { label: 'Active', tone: 'green' },
  impayee: { label: 'Impayée', tone: 'orange' },
  resiliee: { label: 'Résiliée', tone: 'gray' },
  supprimee: { label: 'Supprimée', tone: 'gray' },
  nouvelle: { label: 'Nouvelle', tone: 'blue' },
  contactee: { label: 'Contactée', tone: 'violet' },
  devis_envoye: { label: 'Devis envoyé', tone: 'orange' },
  convertie: { label: 'Convertie', tone: 'green' },
  ecartee: { label: 'Écartée', tone: 'gray' },
  ouvert: { label: 'Ouvert', tone: 'blue' },
  pris_en_charge: { label: 'Pris en charge', tone: 'violet' },
  en_attente_client: { label: 'Attente client', tone: 'orange' },
  resolu: { label: 'Résolu', tone: 'green' },
  ferme: { label: 'Fermé', tone: 'gray' },
  brouillon: { label: 'Brouillon', tone: 'gray' },
  envoyee: { label: 'Envoyée', tone: 'blue' },
  reglee: { label: 'Réglée', tone: 'green' },
  superuser: { label: 'Super-admin', tone: 'violet' },
  admin: { label: 'Administrateur', tone: 'blue' },
  operateur: { label: 'Opérateur', tone: 'green' },
  facturation: { label: 'Facturation', tone: 'orange' },
  lecture: { label: 'Lecture', tone: 'gray' },
}

export function Etat({ etat, dot }: { etat: string | null | undefined; dot?: boolean }) {
  const e = etat ? ETATS[etat] : undefined
  return <Pill tone={e?.tone ?? 'gray'} dot={dot}>{e?.label ?? (etat ?? '·')}</Pill>
}

export function Gravite({ niveau }: { niveau: Severite }) {
  return <span className={`adm-gravite adm-gravite--${niveau}`} aria-label={niveau} />
}

/* ------------------------------ Squelette ---------------------------- */

/** Le squelette du CONTENU seulement. Le cadre reste ; c'est lui qui rassure. */
export function Squelette({ type = 'lignes', n = 5 }: { type?: 'lignes' | 'cartes' | 'table' | 'kpis'; n?: number }) {
  if (type === 'kpis') return (
    <div className="adm-kpis" aria-busy="true">
      {Array.from({ length: n }).map((_, i) => <span key={i} className="adm-skel adm-skel--kpi" />)}
    </div>
  )
  if (type === 'cartes') return (
    <div className="adm-skel-cartes" aria-busy="true">
      {Array.from({ length: n }).map((_, i) => <span key={i} className="adm-skel adm-skel--carte" />)}
    </div>
  )
  if (type === 'table') return (
    <div className="adm-skel-table" aria-busy="true">
      <span className="adm-skel adm-skel--th" />
      {Array.from({ length: n }).map((_, i) => <span key={i} className="adm-skel adm-skel--tr" style={{ opacity: 1 - i * 0.12 }} />)}
    </div>
  )
  return (
    <div className="adm-skel-lignes" aria-busy="true">
      {Array.from({ length: n }).map((_, i) => <span key={i} className="adm-skel adm-skel--ligne" style={{ width: `${58 + ((i * 23) % 40)}%` }} />)}
    </div>
  )
}

/* ---------------------------- Confirmation --------------------------- */

/**
 * Confirmer un geste grave. Si `motCle` est donné, il faut le recopier :
 * suspendre ou supprimer une agence ne se fait pas d'un clic distrait.
 */
export function Confirmer({ title, children, motCle, danger, label, busy, onConfirm, onClose }: {
  title: string; children: ReactNode; motCle?: string; danger?: boolean; label?: string; busy?: boolean
  onConfirm: () => void; onClose: () => void
}) {
  const [saisie, setSaisie] = useState('')
  const ok = !motCle || saisie.trim() === motCle
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant={danger ? 'danger' : 'primary'} disabled={!ok || busy} onClick={onConfirm}>{busy ? 'En cours…' : (label ?? 'Confirmer')}</Button>
    </>}>
      <div className="col gap-4">
        <div className="t-small">{children}</div>
        {motCle && (
          <label className="col gap-2">
            <span className="t-caption t-tertiary">Recopiez <strong className="t-mono">{motCle}</strong> pour confirmer</span>
            <Input value={saisie} onChange={(e) => setSaisie(e.target.value)} autoFocus placeholder={motCle} />
          </label>
        )}
      </div>
    </Modal>
  )
}

/* -------------------------------- Divers ----------------------------- */

/** Un message d'erreur de chargement, avec le geste pour réessayer. */
export function Erreur({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="adm-erreur" role="alert">
      <Icon name="alert" size={16} />
      <span className="t-small">{message}</span>
      {onRetry && <Button size="sm" icon="refresh" onClick={onRetry}>Réessayer</Button>}
    </div>
  )
}

/** Télécharger un CSV construit côté écran. Séparateur point-virgule : Excel en français. */
export function telechargerCsv(nom: string, lignes: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const contenu = '﻿' + lignes.map((l) => l.map(esc).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob([contenu], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = nom; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
