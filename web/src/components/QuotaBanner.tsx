import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { useVisible } from '@/data/scope'
import { HAS_BACKEND } from '@/lib/supabase'
import { Icon, type IconName } from './Icon'
import { Button } from './ui'
import { useUsage, type UsageCode, type UsageNiveau, type UsageResource } from '@/data/usage'
import { USAGE_PATH, octetsLisibles } from './UsageGauges'

/**
 * Le bandeau de quota.
 *
 * Il n'apparaît que quand une ressource est à 80 % ou plus, et il ne montre
 * qu'UNE ressource : la plus grave, puis la plus pleine. Trois bandeaux
 * empilés ne se lisent plus, ils se contournent.
 *
 * Il se ferme pour la session, sauf au niveau « bloque » : une création en
 * attente n'est pas une information, c'est un état, et on ne cache pas un
 * état. Un niveau qui change rouvre le bandeau : la clé de fermeture porte
 * la ressource ET le niveau.
 *
 * Le niveau vient de la base ; le bandeau ne calcule rien, pas même le
 * seuil : « ok » se tait, tout le reste parle.
 */

const STYLE: Record<Exclude<UsageNiveau, 'ok'>, { bg: string; fg: string; icon: IconName }> = {
  info: { bg: 'var(--tint-blue, rgba(0,102,204,.10))', fg: 'var(--blue, #0066CC)', icon: 'reports' },
  attention: { bg: 'var(--tint-orange, rgba(255,149,0,.12))', fg: 'var(--orange, #C25E00)', icon: 'alert' },
  bloque: { bg: 'var(--tint-red, rgba(255,59,48,.12))', fg: 'var(--red, #C41E1E)', icon: 'lock' },
}

const cleFermeture = (r: UsageResource) => `visaflow.quota.${r.code}.${r.niveau}`

function estFerme(r: UsageResource): boolean {
  try { return window.sessionStorage.getItem(cleFermeture(r)) === '1' } catch { return false }
}

export function QuotaBanner() {
  const { t, formatNumber } = useI18n()
  const v = useVisible()
  const { alertes } = useUsage()
  // Un compteur local suffit à redessiner après une fermeture : la vérité
  // est dans sessionStorage, pas dans l'état React.
  const [, setFermetures] = useState(0)

  if (!HAS_BACKEND) return null

  // La première ressource qui parle et qu'on n'a pas fermée. Au niveau
  // « bloque », la fermeture ne compte pas.
  const r = alertes.find((x) => x.niveau === 'bloque' || !estFerme(x))
  if (!r || r.niveau === 'ok') return null

  const style = STYLE[r.niveau]
  const valeur = (n: number) => (r.unit === 'octet' ? octetsLisibles(n, formatNumber) : formatNumber(n))
  const texte = t('usage.banner', {
    resource: t(`usage.res.${r.code as UsageCode}`),
    used: valeur(r.used),
    limit: r.limit === null ? t('usage.unlimited') : valeur(r.limit),
    pct: formatNumber(r.pct ?? 0),
  })

  const fermer = () => {
    try { window.sessionStorage.setItem(cleFermeture(r), '1') } catch { /* stockage indisponible */ }
    setFermetures((n) => n + 1)
  }

  return (
    <div
      role="status"
      className="row gap-3 wrap"
      style={{
        background: style.bg,
        color: style.fg,
        padding: 'var(--sp-3) var(--sp-5)',
        alignItems: 'center',
        borderBottom: '1px solid var(--hairline)',
      }}
    >
      <Icon name={style.icon} size={18} />
      <span className="t-small t-medium grow" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{texte}</span>
      <span className="row gap-2" style={{ alignItems: 'center' }}>
        {v.can('settings:view') && (
          <Link to={USAGE_PATH} className="t-small t-medium" style={{ color: 'inherit', whiteSpace: 'nowrap' }}>
            {t('usage.bannerLink')}
          </Link>
        )}
        {r.niveau !== 'bloque' && (
          <Button size="sm" onClick={fermer}>{t('usage.bannerClose')}</Button>
        )}
      </span>
    </div>
  )
}
