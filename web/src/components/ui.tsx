import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactElement, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Illustration, type Scene } from './Illustration'
import { Icon, type IconName } from './Icon'
import type { Tone } from '@/lib/derive'
import { avatarTone, initials } from '@/lib/derive'

/* ------------------------------- Bouton ------------------------------ */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary', size, block, icon, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'lg'
  block?: boolean
  icon?: IconName
}) {
  const cls = [
    'btn', `btn--${variant}`,
    size ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    rest.className ?? '',
  ].filter(Boolean).join(' ')
  return (
    <button type="button" {...rest} className={cls}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  )
}

export function IconButton({ icon, label, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest} className={`btn btn--icon ${rest.className ?? ''}`}>
      <Icon name={icon} size={18} />
    </button>
  )
}

/* -------------------------------- Carte ------------------------------ */

export function Card({ title, action, children, flush, className }: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  flush?: boolean
  className?: string
}) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || action) && (
        <header className="card__head">
          <h2 className="card__title">{title}</h2>
          {action}
        </header>
      )}
      <div className={flush ? 'card__body card__body--flush' : 'card__body'}>{children}</div>
    </section>
  )
}

/* ------------------------------ Pastille ----------------------------- */

export function Pill({ tone = 'gray', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`pill pill--${tone}`}>
      {dot && <span className="pill__dot" />}
      {children}
    </span>
  )
}

/* ------------------------------- Avatar ------------------------------ */

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const tone = avatarTone(name)
  const cls = size === 'sm' ? 'avatar avatar--sm' : size === 'lg' ? 'avatar avatar--lg' : 'avatar'
  return (
    <span className={cls} style={{ background: `var(--tint-${tone})`, color: `var(--${tone === 'gray' ? 'text-secondary' : tone})` }} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

/* ------------------------------ Progression -------------------------- */

export function Progress({ pct, tone, label, valueText }: {
  pct: number
  tone?: 'green' | 'orange'
  label?: string
  valueText?: string
}) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuetext={valueText}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`progress__bar ${tone ? `progress__bar--${tone}` : ''}`} style={{ width: `${Math.max(pct, 2)}%` }} />
    </div>
  )
}

/* ------------------------------- Vide -------------------------------- */

export function Empty({ title, hint, action, scene = 'vide' }: {
  title: string
  hint?: string
  action?: ReactNode
  scene?: Scene | 'aucune'
}) {
  return (
    <div className="empty">
      {scene !== 'aucune' && (
        <div className="empty__art">
          <Illustration scene={scene} size={116} />
        </div>
      )}
      <p className="t-title" style={{ fontSize: 'var(--size-lead)' }}>{title}</p>
      {hint && <p className="t-small t-tertiary" style={{ marginTop: 'var(--sp-2)' }}>{hint}</p>}
      {action && <div style={{ marginTop: 'var(--sp-5)' }}>{action}</div>}
    </div>
  )
}

/* ------------------------------ Formulaire --------------------------- */

export function Field({ label, hint, error, children }: { label?: string; hint?: string; error?: string; children: ReactNode }) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  // On relie l'aide et l'erreur au champ pour les lecteurs d'écran : sans
  // aria-describedby, ni l'une ni l'autre n'est annoncée (relevé par le panel).
  const described =
    describedBy && isValidElement(children)
      ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string; 'aria-invalid'?: boolean }>,
          { 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })
      : children
  return (
    <label className="field">
      {label && <span className="field__label">{label}</span>}
      {described}
      {hint && !error && <span className="field__hint" id={`${id}-hint`}>{hint}</span>}
      {error && <span className="field__error" id={`${id}-error`} role="alert">{error}</span>}
    </label>
  )
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`input ${p.className ?? ''}`} />
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`textarea ${p.className ?? ''}`} />
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`select ${p.className ?? ''}`} />

export type ComboOption = { value: string; label: string; hint?: string }

/**
 * Un sélecteur qui se cherche au clavier. Une agence a des centaines de clients ;
 * une liste déroulante brute où il faut faire défiler à la main est l'un des gestes
 * que l'employée du comptoir refait cent fois par jour. Ici on tape trois lettres du
 * nom, la liste se réduit, les flèches et Entrée choisissent. Repli propre : si aucune
 * option ne correspond, on le dit, on n'affiche pas une liste vide muette.
 */
export function Combobox({
  value, onChange, options, placeholder, emptyLabel, id, autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  options: ComboOption[]
  placeholder?: string
  emptyLabel?: string
  id?: string
  autoFocus?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const selected = options.find((o) => o.value === value)
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const q = norm(query.trim())
  const shown = !open || q === ''
    ? options
    : options.filter((o) => norm(o.label).includes(q) || (o.hint ? norm(o.hint).includes(q) : false))

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const choose = (o: ComboOption) => {
    onChange(o.value)
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  const onKey = (e: { key: string; preventDefault: () => void }) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      setActive((i) => Math.min(i + 1, shown.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && shown[active]) { e.preventDefault(); choose(shown[active]) }
    } else if (e.key === 'Escape') {
      setOpen(false); setQuery('')
    }
  }

  return (
    <div className="combo" ref={rootRef}>
      <input
        id={id}
        ref={inputRef}
        className="input combo__input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? '')}
        onChange={(e) => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true) }}
        onFocus={() => { setOpen(true); setActive(0) }}
        onKeyDown={onKey}
      />
      {open && (
        <ul className="combo__list" id={listId} role="listbox">
          {shown.length === 0 ? (
            <li className="combo__empty">{emptyLabel ?? '—'}</li>
          ) : shown.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`combo__opt${i === active ? ' is-active' : ''}${o.value === value ? ' is-selected' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(o) }}
            >
              <span className="combo__optLabel">{o.label}</span>
              {o.hint && <span className="combo__optHint">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label?: string
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({ value, options, onChange, idPrefix = 'tab' }: {
  value: T
  options: { value: T; label: string; count?: number }[]
  onChange: (v: T) => void
  idPrefix?: string
}) {
  const move = (delta: number) => {
    const index = options.findIndex((o) => o.value === value)
    const next = options[(index + delta + options.length) % options.length]
    if (next) onChange(next.value)
  }
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          id={`${idPrefix}-${o.value}`}
          aria-controls={`${idPrefix}-panel-${o.value}`}
          className="tab"
          aria-selected={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); move(1) }
            if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1) }
            if (e.key === 'Home') { e.preventDefault(); onChange(options[0].value) }
            if (e.key === 'End') { e.preventDefault(); onChange(options[options.length - 1].value) }
          }}
        >
          {o.label}
          {o.count !== undefined && <span className="t-tertiary t-num"> {o.count}</span>}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------- Modale ------------------------------ */

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function Modal({ title, onClose, footer, wide, children }: {
  title: string
  onClose: () => void
  footer?: ReactNode
  wide?: boolean
  children: ReactNode
}) {
  const id = useId()
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = boxRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab' || !boxRef.current) return
      // Le focus tourne en rond dans la modale, il ne part jamais derriere.
      const items = [...boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return
      const start = items[0]
      const end = items[items.length - 1]
      if (e.shiftKey && document.activeElement === start) { e.preventDefault(); end.focus() }
      else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); start.focus() }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [onClose])

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby={id} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={boxRef} className={wide ? 'modal modal--wide' : 'modal'}>
        <header className="modal__head">
          <h3 id={id} style={{ fontSize: 'var(--size-h4)' }}>{title}</h3>
          <IconButton icon="close" label="Fermer" onClick={onClose} />
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  )
}

/* ------------------------- Notifications breves ---------------------- */

interface Toast { id: number; text: string }
const ToastContext = createContext<(text: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000)
  }, [])

  const value = useMemo(() => push, [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <Icon name="check" size={16} />
            <span className="grow">{t.text}</span>
            <button
              type="button"
              aria-label="Fermer"
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
              style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0, opacity: 0.7 }}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
