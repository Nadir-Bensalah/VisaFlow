import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { usePublicAgency } from './usePublicAgency'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Card, Select } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { knownDevice } from '@/data/identity'
import type { Locale } from '@/data/types'

/* La porte publique de l'agence. Deux portes seulement : déposer une demande,
   ou retrouver la sienne. Le reste est du bruit pour quelqu'un qui arrive d'un
   lien WhatsApp. */
export function AgencyHome() {
  const { slug } = useStore()
  const { t, locale, setLocale } = useI18n()
  // La devanture vient du serveur : sans elle, la page publique d'une agence
  // affichait le nom et les visas d'une agence de démonstration.
  const vitrine = usePublicAgency(slug)
  const ag = vitrine.status === 'ok' ? vitrine.agency : null
  const office = ag?.office ?? null
  const device = knownDevice(slug)

  return (
    <div className="portal">
      <header className="portal__bar">
        <span className="sidebar__mark" style={{ background: ag?.accent }}>{ag?.mark}</span>
        <span className="t-medium grow t-truncate">{ag?.name ?? ''}</span>
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
          <h1>{ag?.name ?? ''}</h1>
          <p>{t('home.hours')}</p>
        </div>

        <div className="grid grid--2">
          <Link to="/demande" className="card card--link">
            <div className="card__body col gap-3">
              <Icon name="passport" size={26} style={{ color: 'var(--blue)' }} />
              <span className="t-title" style={{ fontSize: 'var(--size-h4)' }}>{t('home.ask')}</span>
              <span className="t-small t-secondary">{t('home.askHint')}</span>
            </div>
          </Link>

          <Link to="/suivi" className="card card--link">
            <div className="card__body col gap-3">
              <Icon name="search" size={26} style={{ color: 'var(--blue)' }} />
              <span className="t-title" style={{ fontSize: 'var(--size-h4)' }}>{t('home.track')}</span>
              <span className="t-small t-secondary">
                {device ? t('find.remembered') : t('home.trackHint')}
              </span>
            </div>
          </Link>
        </div>

        <Card className="grid__wide" >
          <div className="col gap-3">
            <span className="t-small t-medium">{office?.name}</span>
            {office?.address && <span className="t-small t-secondary">{office.address}</span>}
            <div className="row gap-2 wrap">
              {office?.phone && (
                <>
                  <a className="btn btn--secondary btn--sm" href={`https://wa.me/${office.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">
                    <Icon name="whatsapp" size={16} /> WhatsApp
                  </a>
                  <a className="btn btn--secondary btn--sm" href={`tel:${office.phone.replace(/\s/g, '')}`}>
                    <Icon name="phone" size={16} /> {office.phone}
                  </a>
                </>
              )}
              {ag?.email && (
                <a className="btn btn--secondary btn--sm" href={`mailto:${ag.email}`}>
                  <Icon name="mail" size={16} /> {t('login.email')}
                </a>
              )}
            </div>
          </div>
        </Card>

        <p className="t-caption t-tertiary" style={{ textAlign: 'center', marginTop: 'var(--sp-8)' }}>
          {ag?.legalName} · {t('settings.inpdp')} : {ag?.inpdpRef} · {t('portal.privacy')}
          <br />
          <Link to="/connexion" className="t-caption">{t('home.staff')}</Link>
        </p>
      </main>
    </div>
  )
}
