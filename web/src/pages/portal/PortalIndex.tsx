import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Button, Card, Field, Input, Select } from '@/components/ui'
import { Illustration } from '@/components/Illustration'
import type { Locale } from '@/data/types'

/* Cette page n'existe que pour la demonstration : en vrai, le client arrive
   directement sur son lien personnel, envoye par WhatsApp. */
/* Cette page ne liste rien. Elle demande la reference, comme un guichet.
   Enumerer les dossiers reviendrait a distribuer les liens de suivi de tous
   les clients de l'agence. */
export function PortalIndex() {
  const { db } = useStore()
  const { t, locale, setLocale } = useI18n()
  const navigate = useNavigate()
  const [reference, setReference] = useState('')
  const [error, setError] = useState('')

  const open = () => {
    const cleaned = reference.trim().toUpperCase()
    const kase = db.cases.find((c) => c.reference.toUpperCase() === cleaned)
    if (kase) { navigate(`/portail/${kase.portalToken}`); return }
    const shipment = db.shipments.find((x) => x.reference.toUpperCase() === cleaned)
    if (shipment) { navigate(`/portail/cargaison/${shipment.portalToken}`); return }
    setError(t('search.noResult'))
  }

  return (
    <div className="portal">
      <header className="portal__bar">
        <span className="sidebar__mark" style={{ background: db.agency.accent }}>{db.agency.mark}</span>
        <span className="t-medium grow t-truncate">{db.agency.name}</span>
        <Select
          aria-label={t('misc.language')}
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          style={{ width: 'auto', minHeight: 32 }}
        >
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_META[l].native}</option>)}
        </Select>
      </header>

      <main className="portal__main">
        <div className="portal__hero">
          <Illustration scene="passeport" size={150} />
          <h1>{t('portal.title')}</h1>
          <p>{t('portal.noAccount')}</p>
        </div>

        <Card>
          <div className="col gap-4">
            <Field label={t('portal.reference')} error={error || undefined} hint={t('portal.privacy')}>
              <Input
                value={reference}
                onChange={(e) => { setReference(e.target.value); setError('') }}
                onKeyDown={(e) => e.key === 'Enter' && open()}
                placeholder="VF-2026-0142"
                autoComplete="off"
              />
            </Field>
            <Button variant="primary" block onClick={open} disabled={!reference.trim()}>
              {t('action.open')}
            </Button>
          </div>
        </Card>

        <p className="t-caption t-tertiary" style={{ textAlign: 'center', marginTop: 'var(--sp-6)' }}>
          {t('portal.poweredBy')}
        </p>
      </main>
    </div>
  )
}
