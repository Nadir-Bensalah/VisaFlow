import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { HAS_BACKEND } from '@/lib/supabase'
import { useI18n } from '@/i18n'
import { Card, Empty, Pill } from '@/components/ui'
import { Icon, type IconName } from '@/components/Icon'
import { loadOverdue, type OverdueItem, type OverdueKind } from '@/data/pilotage'

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
  const [items, setItems] = useState<OverdueItem[]>([])
  const [loading, setLoading] = useState(HAS_BACKEND)
  const [error, setError] = useState<string | null>(null)

  const charger = useCallback(async () => {
    if (!HAS_BACKEND) { setLoading(false); return }
    setLoading(true)
    try {
      setItems(await loadOverdue(officeId))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [officeId])

  useEffect(() => { void charger() }, [charger])

  if (!HAS_BACKEND) {
    return <Card title={t('pil.overdueTitle')}><Empty title={t('pil.offline')} hint={t('pil.offlineHint')} /></Card>
  }
  if (loading) return <Card title={t('pil.overdueTitle')}><Empty title={t('pil.loading')} /></Card>
  if (error) {
    return <Card title={t('pil.overdueTitle')}><Empty title={t('pil.loadError', { msg: error })} /></Card>
  }
  if (items.length === 0) {
    return (
      <Card title={t('pil.overdueTitle')}>
        <Empty title={t('pil.overdueNone')} scene="termine" />
      </Card>
    )
  }

  // Le plus en retard d'abord : c'est celui qui coûte le plus cher.
  const tries = [...items].sort((a, b) => b.daysLate - a.daysLate)

  return (
    <Card
      title={t('pil.overdueTitle')}
      action={<span className="t-caption t-tertiary">{items.length}</span>}
      flush
    >
      <p className="t-caption t-tertiary" style={{ padding: 'var(--sp-3) var(--sp-5) 0' }}>
        {t('pil.overdueHint')}
      </p>
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
    </Card>
  )
}
