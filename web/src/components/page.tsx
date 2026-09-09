import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Input, Modal } from '@/components/ui'
import { Icon } from '@/components/Icon'
import type { IconName } from '@/components/Icon'

/**
 * LA BOÎTE À OUTILS DES ÉCRANS DE L'AGENCE.
 *
 * Les mêmes pièces que la console (pages/admin/kit.tsx), sans un mot de
 * français en dur : l'espace agence parle quatre langues, chaque libellé
 * arrive par une prop. Les styles sont ceux de styles/admin.css (préfixe
 * `adm-`) plus styles/page.css (préfixe `pg-`) : un seul dessin de tuile, de
 * tableau, de squelette et d'état vide pour tout le produit.
 *
 * Règle d'usage : un écran charge avec `useChargement`, montre `Squelette`
 * au premier chargement seulement, garde ses données pendant un
 * rafraîchissement, et ne dit jamais « Chargement… » en toutes lettres.
 */

/* --------------------------- Chargement ------------------------------ */

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
      if (vivant.current) setError(e instanceof Error ? e.message : String(e))
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

export function PageHeader({ kicker, title, subtitle, actions, refreshing, refreshingLabel }: {
  kicker?: string; title: string; subtitle?: ReactNode; actions?: ReactNode; refreshing?: boolean; refreshingLabel?: string
}) {
  return (
    <header className="adm-page__head pg-head">
      <div className="adm-page__titles">
        {kicker && <span className="adm-kicker">{kicker}</span>}
        <h1 className="adm-page__title">{title}</h1>
        {subtitle && <p className="adm-page__sub">{subtitle}</p>}
      </div>
      <div className="adm-page__actions">
        {refreshing && <span className="adm-refresh" aria-live="polite"><Icon name="refresh" size={14} /> {refreshingLabel ?? ''}</span>}
        {actions}
      </div>
    </header>
  )
}

/** Une barre d'outils au-dessus d'un tableau : filtres à gauche, gestes à droite. */
export function Toolbar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="adm-barre">
      <div className="adm-barre__left">{children}</div>
      <div className="adm-barre__right">{right}</div>
    </div>
  )
}

/* ------------------------------ Chiffres ----------------------------- */

export function Kpi({ label, value, hint, delta, spark, tone, to, icon, deltaText }: {
  label: string
  value: string | number
  hint?: string
  /** Variation signée ; `deltaText` est le texte déjà formaté dans la langue de l'écran. */
  delta?: number
  deltaText?: string
  spark?: number[]
  tone?: 'blue' | 'green' | 'orange' | 'red' | 'gray'
  to?: string
  icon?: IconName
}) {
  const sens = delta === undefined ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const inner = (
    <>
      <div className="adm-kpi__top">
        <span className="adm-kpi__label">{label}</span>
        {icon && <Icon name={icon} size={15} className="adm-kpi__icon" />}
      </div>
      <div className="adm-kpi__row">
        <span className="adm-kpi__value t-num">{value}</span>
        {sens && <span className={`adm-kpi__delta adm-kpi__delta--${sens}`}>{deltaText ?? (delta! > 0 ? `+${delta}` : String(delta))}</span>}
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

export function Barres({ points, labels, tone = 'blue', height = 120, format }: {
  points: number[]; labels: string[]; tone?: 'blue' | 'green' | 'orange' | 'gray'; height?: number; format: (n: number) => string
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

/**
 * L'état vide COMPACT d'un module de fiche : une icône, une phrase, un geste.
 * Le grand état vide illustré (`Empty` de ui.tsx) est pour une page entière ;
 * douze d'entre eux empilés dans une fiche font une colonne de dessins.
 */
export function Vide({ title, hint, action, icon = 'dots' }: { title: string; hint?: string; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="pg-vide">
      <span className="pg-vide__icon"><Icon name={icon} size={18} /></span>
      <p className="pg-vide__title">{title}</p>
      {hint && <p className="pg-vide__hint">{hint}</p>}
      {action && <div className="pg-vide__action">{action}</div>}
    </div>
  )
}

/* ------------------------------ Squelette ---------------------------- */

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

export function Confirmer({ title, children, motCle, motCleHint, danger, label, cancelLabel, busy, busyLabel, onConfirm, onClose }: {
  title: string; children: ReactNode; motCle?: string; motCleHint?: ReactNode; danger?: boolean
  label: string; cancelLabel: string; busy?: boolean; busyLabel?: string
  onConfirm: () => void; onClose: () => void
}) {
  const [saisie, setSaisie] = useState('')
  const ok = !motCle || saisie.trim() === motCle
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <Button onClick={onClose}>{cancelLabel}</Button>
      <Button variant={danger ? 'danger' : 'primary'} disabled={!ok || busy} onClick={onConfirm}>{busy ? (busyLabel ?? label) : label}</Button>
    </>}>
      <div className="col gap-4">
        <div className="t-small">{children}</div>
        {motCle && (
          <label className="col gap-2">
            <span className="t-caption t-tertiary">{motCleHint}<strong className="t-mono"> {motCle}</strong></span>
            <Input value={saisie} onChange={(e) => setSaisie(e.target.value)} autoFocus placeholder={motCle} />
          </label>
        )}
      </div>
    </Modal>
  )
}

export function Erreur({ message, retryLabel, onRetry }: { message: string; retryLabel?: string; onRetry?: () => void }) {
  return (
    <div className="adm-erreur" role="alert">
      <Icon name="alert" size={16} />
      <span className="t-small">{message}</span>
      {onRetry && retryLabel && <Button size="sm" icon="refresh" onClick={onRetry}>{retryLabel}</Button>}
    </div>
  )
}
