import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Icon, type IconName } from './Icon'
import { clientName } from '@/lib/derive'

interface Entry {
  id: string
  group: string
  label: string
  hint?: string
  icon: IconName
  to: string
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { db } = useStore()
  const { t, tt } = useI18n()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const entries = useMemo<Entry[]>(() => {
    const pages: Entry[] = [
      { id: 'p1', group: t('search.pages'), label: t('nav.dashboard'), icon: 'dashboard', to: '/' },
      { id: 'p2', group: t('search.pages'), label: t('nav.pipeline'), icon: 'pipeline', to: '/pipeline' },
      { id: 'p3', group: t('search.pages'), label: t('nav.cases'), icon: 'cases', to: '/dossiers' },
      { id: 'p4', group: t('search.pages'), label: t('nav.clients'), icon: 'clients', to: '/clients' },
      { id: 'p12', group: t('search.pages'), label: t('nav.shipments'), icon: 'ship', to: '/cargaisons' },
      { id: 'p5', group: t('search.pages'), label: t('nav.documents'), icon: 'documents', to: '/pieces' },
      { id: 'p6', group: t('search.pages'), label: t('nav.appointments'), icon: 'appointments', to: '/rendez-vous' },
      { id: 'p7', group: t('search.pages'), label: t('nav.messages'), icon: 'messages', to: '/messages' },
      { id: 'p8', group: t('search.pages'), label: t('nav.payments'), icon: 'payments', to: '/paiements' },
      { id: 'p9', group: t('search.pages'), label: t('nav.automations'), icon: 'automations', to: '/automatisations' },
      { id: 'p10', group: t('search.pages'), label: t('nav.reports'), icon: 'reports', to: '/rapports' },
      { id: 'p11', group: t('search.pages'), label: t('nav.settings'), icon: 'settings', to: '/reglages' },
    ]
    const cases: Entry[] = db.cases.map((c) => ({
      id: c.id,
      group: t('search.cases'),
      label: `${c.reference} · ${clientName(db, c.clientId)}`,
      hint: tt(db.visaTypes.find((v) => v.id === c.visaTypeId)?.label),
      icon: 'cases',
      to: `/dossiers/${c.id}`,
    }))
    const clients: Entry[] = db.clients.map((c) => ({
      id: c.id,
      group: t('search.clients'),
      label: `${c.firstName} ${c.lastName}`,
      hint: c.phone,
      icon: 'clients',
      to: `/clients/${c.id}`,
    }))
    const shipments: Entry[] = db.shipments.map((x) => ({
      id: x.id,
      group: t('ship.title'),
      label: `${x.reference} · ${clientName(db, x.clientId)}`,
      hint: `${x.originPort} → ${x.destPort}`,
      icon: 'ship',
      to: `/cargaisons/${x.id}`,
    }))
    return [...pages, ...cases, ...shipments, ...clients]
  }, [db, t, tt])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries.slice(0, 9)
    return entries
      .filter((e) => e.label.toLowerCase().includes(q) || (e.hint ?? '').toLowerCase().includes(q))
      .slice(0, 24)
  }, [entries, query])

  useEffect(() => { setActive(0) }, [query])

  const go = (entry?: Entry) => {
    if (!entry) return
    navigate(entry.to)
    onClose()
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t('search.placeholder')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette">
        <input
          ref={inputRef}
          className="palette__input"
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            if (e.key === 'Enter') { e.preventDefault(); go(results[active]) }
          }}
        />
        <div className="palette__results">
          {results.length === 0 && <p className="empty t-secondary">{t('search.noResult')}</p>}
          {results.map((entry, i) => {
            const first = i === 0 || results[i - 1].group !== entry.group
            return (
              <div key={entry.id}>
                {first && <div className="palette__group">{entry.group}</div>}
                <button
                  type="button"
                  className="palette__item"
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(entry)}
                >
                  <Icon name={entry.icon} size={16} />
                  <span className="grow t-truncate">{entry.label}</span>
                  {entry.hint && <span className="t-caption t-tertiary t-truncate">{entry.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
