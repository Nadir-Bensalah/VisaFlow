import { useCallback, useEffect, useState } from 'react'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Card } from '@/components/ui'
import { Vide } from '@/components/page'
import { Icon } from '@/components/Icon'
import { loadCaseTravelMargin } from '@/data/voyage'
import type { CaseTravelMargin } from '@/data/voyage'

/**
 * Le tableau de marge d'un dossier, celui que le client a dessiné.
 *
 *   Billet vendu       1 420    Coût 1 350    Marge   70
 *   Assurance             85    Coût    55    Marge   30
 *   Assistance visa      250    Coût    40    Marge  210
 *   MARGE DOSSIER                                    310
 *
 * L'ASSISTANCE VISA EST LA LIGNE QUI COMPTE. Elle n'est pas une prestation de
 * voyage, et pourtant c'est elle qui fait vivre l'agence : un tableau qui
 * l'oublierait dirait exactement le contraire de la vérité, à savoir que la
 * billetterie rapporte.
 *
 * Aucun chiffre n'est calculé ici, pas même le total. Tout descend du serveur,
 * où la marge est une colonne générée. Un navigateur qui additionne finit
 * toujours par afficher autre chose que le rapport, et c'est le rapport que le
 * patron croit.
 */

export function CaseMarginCard({ caseId }: { caseId: string }) {
  const v = useVisible()
  const { t, formatMoney } = useI18n()

  const [data, setData] = useState<CaseTravelMargin | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try { setData(await loadCaseTravelMargin(caseId)); setError(null) }
    catch (e) { setError((e as Error).message) }
  }, [caseId])

  useEffect(() => { void reload() }, [reload])

  // Le coût de revient et la marge restent à la direction. Le serveur dit la
  // même chose, on ne montre pas une carte vide à qui n'y a pas droit.
  if (!v.can('finance:global')) return null

  if (!HAS_BACKEND) {
    return (
      // Dans une fiche, l'état « non branché » tient en une ligne : le grand
      // dessin d'alerte est pour une page entière.
      <Card title={t('voy.marginTitle')}>
        <Vide icon="payments" title={t('voy.offline')} />
      </Card>
    )
  }

  if (error) {
    return <Card title={t('voy.marginTitle')}><p className="t-small t-orange">{error}</p></Card>
  }

  if (!data || data.lines.length === 0) {
    return <Card title={t('voy.marginTitle')}><Vide icon="payments" title={t('voy.noLines')} /></Card>
  }

  const positive = data.total.margin >= 0

  return (
    <Card title={t('voy.marginTitle')}>
      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('voy.filterKind')}</th>
              <th className="num">{t('voy.sold')}</th>
              <th className="num">{t('voy.cost')}</th>
              <th className="num">{t('voy.margin')}</th>
              <th className="num">{t('voy.marginPct')}</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l, i) => (
              <tr key={l.id ?? `assistance-${i}`}>
                <td className="t-small">
                  <span className="t-medium">{t(`voy.kind${l.kind}` as 'voy.kindBILLET')}</span>
                  {(l.label || l.reference) && (
                    <span className="t-caption t-tertiary"> · {l.reference || l.label}</span>
                  )}
                </td>
                <td className="num t-small">{formatMoney(l.sold, l.currency)}</td>
                <td className="num t-small t-tertiary">{formatMoney(l.cost, l.currency)}</td>
                <td className="num t-small t-medium" style={{ color: l.margin < 0 ? 'var(--red)' : undefined }}>
                  {formatMoney(l.margin, l.currency)}
                </td>
                <td className="num t-caption t-tertiary">
                  {l.marginPct === null ? t('voy.none') : `${l.marginPct} %`}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1px solid var(--hairline)' }}>
              <td className="t-medium">{t('voy.marginTotal')}</td>
              <td className="num t-small t-tertiary">{formatMoney(data.total.sold, data.currency)}</td>
              <td className="num t-small t-tertiary">{formatMoney(data.total.cost, data.currency)}</td>
              <td className="num t-medium" style={{ color: positive ? 'var(--green)' : 'var(--red)' }}>
                {formatMoney(data.total.margin, data.currency)}
              </td>
              <td className="num t-caption t-tertiary">
                {data.total.marginPct === null ? t('voy.none') : `${data.total.marginPct} %`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="tariff__why" style={{ marginTop: 'var(--sp-4)' }}>
        <Icon name="shield" size={14} />
        <span>{t('voy.marginAssistanceHint')}</span>
      </p>
      <p className="tariff__why">
        <Icon name="alert" size={14} />
        <span>{t('voy.costHint')}</span>
      </p>
    </Card>
  )
}
