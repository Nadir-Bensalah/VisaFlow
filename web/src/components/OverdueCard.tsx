import { Link } from 'react-router-dom'
import { HAS_BACKEND } from '@/lib/supabase'
import { useI18n } from '@/i18n'
import { Empty, Pill } from '@/components/ui'
import { Icon, type IconName } from '@/components/Icon'
import { Erreur, Section, Squelette, Vide, useChargement } from '@/components/page'
import { loadOverdue, type OverdueItem, type OverdueKind } from '@/data/pilotage'
import '@/styles/modules.css'

/* Tout ce qui a dépassé sa date, au même endroit.
 *
 * Une seule fonction serveur, un seul format de ligne, une seule mise en page.
 * Six listes séparées auraient six présentations, et la septième nature ajoutée
 * un jour n'aurait jamais été branchée nulle part. */

const ICONE: Record<OverdueKind, IconName> = {
  dossier: 'cases',
  cargaison: 'ship',
  tache: 'tasks',
  piece: 'documents',
  paiement: 'payments',
  facture: 'payments',
}

const LIBELLE: Record<OverdueKind, 'pil.kindDossier'> = {
  dossier: 'pil.kindDossier',
  cargaison: 'pil.kindCargaison' as 'pil.kindDossier',
  tache: 'pil.kindTache' as 'pil.kindDossier',
  piece: 'pil.kindPiece' as 'pil.kindDossier',
  paiement: 'pil.kindPaiement' as 'pil.kindDossier',
  facture: 'pil.kindFacture' as 'pil.kindDossier',
}

export function OverdueCard({ officeId, limit = 12 }: { officeId: string | null; limit?: number }) {
  const { t, formatDate } = useI18n()
  const { data, loading, error, reload } = useChargement(
    () => (HAS_BACKEND ? loadOverdue(officeId) : Promise.resolve([] as OverdueItem[])),
    [officeId],
  )
  const items = data ?? []

  if (!HAS_BACKEND) {
    return <Section title={t('pil.overdueTitle')}><Empty title={t('mq.demoTitle')} hint={t('mq.demoHint')} scene="termine" /></Section>
  }
  if (error) {
    return <Section title={t('pil.overdueTitle')}><Erreur message={error} retryLabel={t('mq.retry')} onRetry={() => void reload()} /></Section>
  }
  if (loading && !data) return <Section title={t('pil.overdueTitle')} flush><Squelette type="lignes" n={4} /></Section>
  if (items.length === 0) {
    return (
      <Section title={t('pil.overdueTitle')}>
        <Vide title={t('pil.overdueNone')} hint={t('pil.overdueHint')} icon="check" />
      </Section>
    )
  }

  // Le plus en retard d'abord : c'est celui qui coûte le plus cher.
  const tries = [...items].sort((a, b) => b.daysLate - a.daysLate)

  return (
    <Section
      title={t('pil.overdueTitle')}
      action={<Pill tone="red">{items.length}</Pill>}
      flush
    >
      <p className="t-caption t-tertiary md-note">{t('pil.overdueHint')}</p>
      <div className="list">
        {tries.slice(0, limit).map((it) => (
          <Link key={`${it.kind}-${it.id}`} to={it.link} className="list__row">
            <Icon name={ICONE[it.kind]} size={18} className="t-tertiary" />
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className="t-small t-medium t-truncate">
                {it.label || it.reference || t(LIBELLE[it.kind])}
              </span>
              <span className="t-caption t-tertiary t-truncate">
                {t(LIBELLE[it.kind])}
                {it.reference ? ` · ${it.reference}` : ''}
                {it.due ? ` · ${t('pil.due')} ${formatDate(it.due)}` : ''}
              </span>
            </span>
            <Pill tone={it.daysLate > 7 ? 'red' : 'orange'}>
              {t('pil.daysLate', { n: it.daysLate })}
            </Pill>
          </Link>
        ))}
      </div>
      {items.length > limit && (
        <p className="t-caption t-tertiary md-note">{t('mq.overdueMore', { n: items.length - limit })}</p>
      )}
    </Section>
  )
}
