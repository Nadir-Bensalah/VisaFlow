import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import type { TKey } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button } from './ui'
import { Icon, type IconName } from './Icon'
import { loadAccessState } from '@/data/facturation'
import type { AccessState, BillingSeverity } from '@/data/facturation'

/**
 * Le bandeau du cycle de facturation.
 *
 * Il dit une seule chose : combien de jours il reste avant la prochaine
 * échéance. C'est le « 15, 14, 13… » que le patron veut voir descendre dans
 * l'espace de l'agence, et il se voit par TOUS les comptes, pas seulement par
 * le propriétaire : un agent qui découvre l'outil coupé un matin sans
 * explication appelle le support, pas la comptabilité.
 *
 * IL NE S'AFFICHE QUE QUAND IL Y A QUELQUE CHOSE À DIRE. C'est le serveur qui
 * en décide : `message_cle` nulle veut dire « rien à dire », et une agence à
 * jour depuis onze mois n'en reçoit aucune. Un bandeau permanent devient un
 * décor, et on ne lit plus les décors.
 *
 * La phrase n'est jamais écrite ici : le serveur rend une CLÉ de traduction,
 * l'écran la traduit. C'est ce qui permet à une agence de Sfax de lire son
 * compte à rebours en arabe.
 */

/* Trois niveaux, trois couleurs, les mêmes que le bandeau d'annonce : deux
   grammaires de couleur dans la même barre supérieure ne se comparent plus. */
const SEVERITY_STYLE: Record<BillingSeverity, { bg: string; fg: string; icon: IconName }> = {
  info: { bg: 'var(--tint-blue, rgba(0,102,204,.10))', fg: 'var(--blue, #0066CC)', icon: 'clock' },
  attention: { bg: 'var(--tint-orange, rgba(255,149,0,.12))', fg: 'var(--orange, #C25E00)', icon: 'clock' },
  critique: { bg: 'var(--tint-red, rgba(255,59,48,.12))', fg: 'var(--red, #C41E1E)', icon: 'alert' },
}

export function BillingBanner({ agencyId }: { agencyId: string | null | undefined }) {
  const { t, formatDate } = useI18n()
  const [state, setState] = useState<AccessState | null>(null)

  const reload = useCallback(async () => {
    if (!HAS_BACKEND || !agencyId) { setState(null); return }
    // Un bandeau qui ne charge pas ne doit rien afficher. Une erreur de réseau
    // n'est pas une échéance, et l'annoncer comme telle affolerait le client.
    try { setState(await loadAccessState(agencyId)) } catch { setState(null) }
  }, [agencyId])

  useEffect(() => { void reload() }, [reload])

  if (!state || !state.message_cle) return null

  // Le mur, lui, est un écran entier : ce n'est pas au bandeau de porter une
  // suspension. Il se tait quand la porte est fermée.
  if (state.bloquant) return null

  const style = SEVERITY_STYLE[state.severite] ?? SEVERITY_STYLE.info
  const n = state.jours_restants ?? 0

  return (
    <div
      role="status"
      className="row gap-3"
      style={{
        background: style.bg,
        color: style.fg,
        padding: 'var(--sp-3) var(--sp-5)',
        alignItems: 'center',
        borderBottom: '1px solid var(--hairline)',
      }}
    >
      <Icon name={style.icon} size={18} />
      <span className="col grow" style={{ minWidth: 0 }}>
        <span className="t-small t-medium">
          {t(state.message_cle as TKey, { n: Math.max(n, 0) })}
        </span>
        {state.echeance && (
          <span className="t-caption" style={{ opacity: 0.85 }}>
            {t('bill.dueOn', { date: formatDate(state.echeance) })}
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * Le mur de connexion.
 *
 * Le blocage est côté application et non côté politiques, volontairement :
 * couper les politiques d'une agence suspendue l'empêcherait de lire sa propre
 * facture, donc de comprendre pourquoi elle est coupée. Cet écran est le
 * message ; la serrure, elle, est déjà en base (une agence suspendue n'a plus
 * aucune fonctionnalité et son portail public ne répond plus).
 *
 * Deux messages, jamais le même : l'employé est renvoyé vers sa direction, le
 * propriétaire reçoit l'adresse du service facturation. Les deux sont des clés
 * de traduction.
 */
export function BillingWall({ messageKey, contact, onSignOut }: {
  messageKey: string
  contact: string | null
  onSignOut?: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="col gap-4" style={{
      maxWidth: 520, margin: '0 auto', padding: 'var(--sp-8) var(--sp-5)', textAlign: 'center',
    }}>
      <Icon name="lock" size={40} style={{ color: 'var(--red, #C41E1E)', margin: '0 auto' }} />
      <h1 style={{ fontSize: 24, margin: 0 }}>{t('bill.wallTitle')}</h1>
      <p className="t-small" style={{ margin: 0 }}>{t(messageKey as TKey)}</p>
      {/* Ce que le client a besoin d'entendre avant tout : rien n'est perdu.
          La suspension est réversible, c'est tout son intérêt. */}
      <p className="t-caption t-tertiary" style={{ margin: 0 }}>{t('bill.wallKept')}</p>
      {contact && (
        <p className="t-small" style={{ margin: 0 }}>
          <span className="t-tertiary">{t('bill.wallContact')} · </span>
          <a href={`mailto:${contact}`}>{contact}</a>
        </p>
      )}
      {onSignOut && (
        <Button onClick={onSignOut}>{t('bill.wallSignOut')}</Button>
      )}
    </div>
  )
}
