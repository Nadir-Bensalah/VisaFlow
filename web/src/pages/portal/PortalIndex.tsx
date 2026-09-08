import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Card, Select } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { Illustration } from '@/components/Illustration'
import { usePublicAgency } from '@/pages/public/usePublicAgency'
import type { Locale } from '@/data/types'

/**
 * L'entrée du suivi client.
 *
 * Cette page demandait une RÉFÉRENCE, « comme un guichet », en se croyant
 * prudente parce qu'elle ne listait rien. Elle ne l'était pas : les références
 * sont séquentielles (VF-2026-0141), et il suffisait d'en essayer une pour
 * ouvrir le suivi du voisin, pièces et messages compris. Le trou ne se voyait
 * pas parce que la page cherchait dans le jeu de démonstration du navigateur et
 * ne trouvait donc jamais rien de réel.
 *
 * On ne cherche plus par référence. Le suivi s'ouvre par le lien personnel reçu
 * en message, ou par le numéro de téléphone confirmé par un code. C'est moins
 * direct, et c'est la seule façon honnête : une référence n'est pas un secret.
 */
export function PortalIndex() {
  const { slug } = useStore()
  const { t, locale, setLocale } = useI18n()
  const vitrine = usePublicAgency(slug)
  const ag = vitrine.status === 'ok' ? vitrine.agency : null

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
          <Illustration scene="passeport" size={150} />
          <h1>{t('portal.title')}</h1>
          <p>{t('portal.noAccount')}</p>
        </div>

        <Card>
          <div className="col gap-4">
            {/* La voie sûre : le numéro, confirmé par un code envoyé dessus. */}
            <Link to="/suivi" className="btn btn--primary" style={{ width: '100%' }}>
              <Icon name="phone" size={18} /> {t('find.title')}
            </Link>
            <p className="t-small t-secondary" style={{ margin: 0 }}>{t('portal.byPhoneHint')}</p>
            <hr className="divider" style={{ margin: 0 }} />
            <Link to="/agence" className="btn btn--secondary" style={{ width: '100%' }}>
              <Icon name="building" size={16} /> {t('portal.contactAgency')}
            </Link>
          </div>
        </Card>

        <p className="t-caption t-tertiary" style={{ textAlign: 'center', marginTop: 'var(--sp-6)' }}>
          {t('portal.poweredBy')}
        </p>
      </main>
    </div>
  )
}
