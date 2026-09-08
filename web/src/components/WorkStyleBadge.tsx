import { Pill } from '@/components/ui'
import { useI18n } from '@/i18n'
import { GESTE_KEY, STYLE_HINT, STYLE_KEY } from '@/data/travail'
import type { Geste, WorkStyle } from '@/data/travail'
import type { TKey } from '@/i18n'

/* La pastille du style de travail. Elle se monte partout où l'on doit savoir
 * comment quelqu'un regarde son travail : sur une ligne de l'écran d'équipe, et
 * dans l'en-tête de l'écran d'accueil.
 *
 * DEUX COULEURS, ET ELLES VEULENT DIRE QUELQUE CHOSE. Le portefeuille est bleu,
 * la file est violette. Ce ne sont pas deux états d'une même chose : ce sont
 * deux façons de travailler, et les mettre dans la même couleur laisserait
 * croire à une progression de l'une vers l'autre.
 *
 * ON N'AFFICHE JAMAIS UN STYLE SANS SA SOURCE. « File » tout court ne dit pas
 * d'où ça vient. « File, d'après son poste » se comprend, et surtout se corrige :
 * on sait qu'il faut changer le poste, pas chercher un réglage. */

export function WorkStyleBadge({ style, focus = [], source, compact }: {
  style: WorkStyle
  /** Les gestes du poste. Vide en portefeuille : le conseiller fait tout. */
  focus?: Geste[]
  /** D'où vient le style : du poste de la personne, ou du mode de l'agence. */
  source?: 'poste' | 'agence'
  /** La pastille seule, sans les gestes ni la provenance. Pour les lignes de
      tableau, où la place manque et où le survol complète. */
  compact?: boolean
}) {
  const { t } = useI18n()

  const label = t(STYLE_KEY[style] as TKey)
  const title = `${label} · ${t(STYLE_HINT[style] as TKey)}`

  if (compact) {
    return (
      <span title={title}>
        <Pill tone={style === 'file' ? 'violet' : 'blue'} dot>{label}</Pill>
      </span>
    )
  }

  return (
    <span className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
      <span title={title}>
        <Pill tone={style === 'file' ? 'violet' : 'blue'} dot>{label}</Pill>
      </span>

      {/* Les gestes du poste. En file, ils SONT le poste : « file » sans dire
          quoi ne renseigne sur rien. En portefeuille, la liste est vide et on
          le dit avec des mots plutôt qu'avec du blanc. */}
      {style === 'file' && focus.length > 0 && (
        <span className="t-caption t-tertiary">
          {t('trv.gesteLabel')} {focus.map((g) => t(GESTE_KEY[g] as TKey)).join(' · ')}
        </span>
      )}
      {style === 'file' && focus.length === 0 && (
        <span className="t-caption t-tertiary">{t('trv.allGestures')}</span>
      )}

      {source && (
        <span className="t-caption t-tertiary">
          {source === 'poste' ? t('trv.fromJob') : t('trv.fromAgency')}
        </span>
      )}
    </span>
  )
}
