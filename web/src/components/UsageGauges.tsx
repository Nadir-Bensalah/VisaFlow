import { Link } from 'react-router-dom'
import { Empty, Pill, Progress } from './ui'
import { useI18n } from '@/i18n'
import type { TKey } from '@/i18n'
import type { Tone } from '@/lib/derive'
import type { AgencyUsage, UsageCode, UsageNiveau, UsageResource } from '@/data/usage'

/* LES JAUGES DE CONSOMMATION, une fois, pour l'agence et pour la console.
 *
 * Une jauge par ressource : le libellé, « utilisé sur limite », la barre,
 * la pastille du niveau, et sous la jauge la phrase qui dit quoi faire. La
 * phrase dépend du niveau ET de la ressource : un compte de plus s'achète,
 * un dossier de plus se libère en clôturant, Premium n'a que des repères.
 *
 * RIEN n'est calculé ici. Le pourcentage, le niveau, le prix de l'ajout, la
 * date du premier dépassement viennent de la base. Ce fichier ne fait que
 * choisir une couleur et une phrase.
 *
 * `compact` : une ligne par ressource, sans phrase, pour la console et les
 * endroits étroits. Rien ne déborde à 360 px : tout est en flex qui replie.
 */

/** L'adresse de la consommation dans les réglages. `?section=plan`, pas « abonnement » : c'est l'id de l'entrée. */
export const USAGE_PATH = '/reglages?section=plan'

const PILL: Record<UsageNiveau, Tone> = { ok: 'gray', info: 'blue', attention: 'orange', bloque: 'red' }
const BAR: Record<UsageNiveau, 'blue' | 'orange' | 'red'> = { ok: 'blue', info: 'blue', attention: 'orange', bloque: 'red' }

/** Une taille lisible. On s'arrête au Go : personne ne stocke un To de passeports. */
export function octetsLisibles(n: number, format: (x: number) => string): string {
  if (n < 1024) return `${format(n)} o`
  if (n < 1024 ** 2) return `${format(Math.round(n / 1024))} Ko`
  if (n < 1024 ** 3) return `${format(Math.round(n / 1024 ** 2))} Mo`
  return `${format(Math.round((n / 1024 ** 3) * 10) / 10)} Go`
}

type ResKey = `usage.res.${UsageCode}`
type NiveauKey = `usage.niveau.${UsageNiveau}`

export function UsageGauges({ usage, compact, console: enConsole }: {
  usage: AgencyUsage
  compact?: boolean
  /** En console, le libellé est celui de la base (`label_fr`) : elle n'a qu'une langue. */
  console?: boolean
}) {
  const { t, formatNumber, formatMoney, formatDate } = useI18n()

  const valeur = (r: UsageResource, n: number) =>
    r.unit === 'octet' ? octetsLisibles(n, formatNumber) : formatNumber(n)
  const limite = (r: UsageResource) => (r.limit === null ? t('usage.unlimited') : valeur(r, r.limit))
  const libelle = (r: UsageResource) => (enConsole ? r.label_fr : t(`usage.res.${r.code}` as ResKey))

  /* La phrase d'action. Une seule, la plus utile ; jamais deux. */
  const phrase = (r: UsageResource): string | null => {
    if (usage.premium) {
      return r.limit !== null ? t('usage.fairUse', { limit: limite(r) }) : null
    }
    if (r.code === 'users' || r.code === 'offices') {
      // Comptes et bureaux pleins : jamais une alerte, mais le prix de la suite.
      if (r.pct !== null && r.pct >= 100 && r.addon_price !== null) {
        const price = formatMoney(r.addon_price, r.addon_currency ?? usage.currency)
        return t(r.code === 'users' ? 'usage.addonUser' : 'usage.addonOffice', { price })
      }
      return null
    }
    if (r.code === 'emails') return r.niveau === 'ok' ? null : t('usage.emailsNote')
    if (r.niveau === 'bloque') return t('usage.blocked')
    if (r.niveau === 'attention') return r.depuis ? t('usage.softAttention', { date: formatDate(r.depuis) }) : t('usage.softInfo')
    if (r.niveau === 'info') return t('usage.softInfo')
    return null
  }

  if (compact) {
    return (
      <div className="col gap-2">
        {usage.resources.map((r) => (
          <div key={r.code} className="row gap-2 wrap" style={{ alignItems: 'center' }}>
            <span className="t-small t-medium" style={{ flex: '1 1 120px', minWidth: 0 }}>{libelle(r)}</span>
            <span className="t-caption t-tertiary t-num" style={{ whiteSpace: 'nowrap' }}>
              {t('usage.of', { used: valeur(r, r.used), limit: limite(r) })}
            </span>
            {r.pct !== null && (
              <span style={{ flex: '0 0 72px' }}>
                <Progress pct={Math.min(100, r.pct)} tone={BAR[r.niveau]} label={libelle(r)} valueText={`${formatNumber(r.pct)} %`} />
              </span>
            )}
            <Pill tone={PILL[r.niveau]} dot={r.niveau !== 'ok'}>{t(`usage.niveau.${r.niveau}` as NiveauKey)}</Pill>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="col gap-4">
      {usage.resources.map((r) => {
        const action = phrase(r)
        return (
          <div key={r.code} className="col gap-2">
            <div className="row gap-2 wrap" style={{ alignItems: 'baseline' }}>
              <span className="t-small t-medium">{libelle(r)}</span>
              <span className="grow" />
              <span className="t-caption t-tertiary t-num">
                {t('usage.of', { used: valeur(r, r.used), limit: limite(r) })}
                {r.pct !== null && ` · ${formatNumber(r.pct)} %`}
              </span>
              <Pill tone={PILL[r.niveau]} dot={r.niveau !== 'ok'}>{t(`usage.niveau.${r.niveau}` as NiveauKey)}</Pill>
            </div>
            {/* Illimité sans repère n'a pas de barre : une barre pleine dirait
                « bloqué » là où l'agence a payé pour ne plus l'être. */}
            {r.pct !== null && (
              <Progress pct={Math.min(100, r.pct)} tone={BAR[r.niveau]} label={libelle(r)} valueText={`${formatNumber(r.pct)} %`} />
            )}
            {action && (
              <p className="t-caption" style={{ margin: 0, color: r.niveau === 'bloque' ? 'var(--red)' : r.niveau === 'attention' ? 'var(--orange)' : 'var(--text-tertiary)' }}>
                {action}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Ce qui remplace un formulaire de création quand la base dit « bloque ».
 * Le message dit trois choses : quoi, pourquoi, et que tout le reste marche.
 */
export function QuotaBlocked({ code, compact }: { code: 'cases' | 'shipments' | 'storage'; compact?: boolean }) {
  const { t } = useI18n()
  const title = t(`usage.blockedTitle.${code}` as TKey)
  if (compact) {
    return (
      <p className="t-caption" style={{ margin: 0, color: 'var(--red)' }}>
        {title} · <Link to={USAGE_PATH}>{t('usage.bannerLink')}</Link>
      </p>
    )
  }
  return (
    <Empty
      scene="alerte"
      title={title}
      hint={t(`usage.blockedHint.${code}` as TKey)}
      action={<Link to={USAGE_PATH} className="btn btn--primary">{t('usage.bannerLink')}</Link>}
    />
  )
}
