import { useCallback, useEffect, useState } from 'react'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Card, Empty } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { loadMargin } from '@/data/commerce'
import type { Margin } from '@/data/commerce'

/**
 * La marge d'un dossier ou d'une cargaison.
 *
 * Elle se calcule à chaque affichage, elle ne se stocke jamais : une marge
 * figée devient fausse à la première dépense ajoutée après coup, et personne
 * ne s'en aperçoit.
 *
 * Le revenu retenu est le HORS TAXE. La TVA est collectée pour l'État et
 * reversée : la compter dans la marge la gonflerait de 19 %, exactement comme
 * compter les frais de consulat dans le chiffre d'affaires.
 */

export function MarginCard({ caseId, shipmentId }: { caseId?: string; shipmentId?: string }) {
  const v = useVisible()
  const { t, formatMoney } = useI18n()

  const [margin, setMargin] = useState<Margin | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try { setMargin(await loadMargin({ caseId, shipmentId })); setError(null) }
    catch (e) { setError((e as Error).message) }
  }, [caseId, shipmentId])

  useEffect(() => { void reload() }, [reload])

  // Le chiffre d'affaires et la marge restent à la direction.
  if (!v.can('finance:global')) return null

  if (!HAS_BACKEND) {
    return (
      <Card title={t('com.margin')}>
        <Empty title={t('com.offline')} hint={t('com.offlineHint')} scene="alerte" />
      </Card>
    )
  }

  if (error) {
    return <Card title={t('com.margin')}><p className="t-small t-orange">{error}</p></Card>
  }

  if (!margin || margin.billed === 0) {
    return <Card title={t('com.margin')}><p className="t-small t-tertiary">{t('com.noMargin')}</p></Card>
  }

  const positive = margin.margin >= 0

  return (
    <Card title={t('com.margin')}>
      <div className="col gap-3">
        <div className="row-between">
          <span className="t-small t-secondary">{t('com.billed')}</span>
          <span className="t-small t-medium">{formatMoney(margin.billed, margin.currency)}</span>
        </div>
        <div className="row-between">
          <span className="t-small t-secondary">{t('com.collectedLabel')}</span>
          <span className="t-small t-medium">{formatMoney(margin.collected, margin.currency)}</span>
        </div>
        <div className="row-between">
          <span className="t-small t-secondary">{t('com.expenses')}</span>
          <span className="t-small t-medium">{formatMoney(margin.expenses, margin.currency)}</span>
        </div>
        <div className="row-between" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--sp-3)' }}>
          <span className="t-medium">{t('com.marginAmount')}</span>
          <span className="t-medium" style={{ color: positive ? 'var(--green)' : 'var(--red)' }}>
            {formatMoney(margin.margin, margin.currency)}
            {margin.marginPct !== null && (
              <span className="t-small t-tertiary"> · {t('com.marginPct')} {margin.marginPct} %</span>
            )}
          </span>
        </div>
        <p className="tariff__why">
          <Icon name="shield" size={14} />
          <span>{t('com.marginHint')}</span>
        </p>
      </div>
    </Card>
  )
}
