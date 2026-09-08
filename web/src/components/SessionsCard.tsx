import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { supabase } from '@/lib/supabase'
import { Button, Card, Empty, Pill, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { Ago } from '@/components/bits'
import { estCetAppareil, mySessions, sessionRevoke, type DeviceSession } from '@/data/securite'

/**
 * Mes appareils.
 *
 * L'écran répond à une question simple qu'un employé se pose après avoir prêté
 * son poste ou perdu son téléphone : « d'où mon compte est-il connecté ? ».
 *
 * CE QU'IL FAUT LIRE AVANT DE LE MONTER : le bouton n'est pas une déconnexion
 * à distance. La base écrit la TRACE de la révocation ; elle n'a pas le droit
 * de toucher aux sessions de Supabase, et une fonction qui s'arrogerait ce
 * droit serait le maillon le plus dangereux du produit. Pour l'appareil
 * courant, on enchaîne donc avec une vraie déconnexion locale. Pour un autre
 * poste, la session peut rester ouverte jusqu'à l'expiration de son jeton, et
 * l'écran le dit noir sur blanc au lieu de laisser croire à une coupure
 * immédiate. La vraie réponse, dans ce cas, est le changement de mot de passe.
 */
export function SessionsCard({ onSignOut }: {
  /** Appelé après la déconnexion de l'appareil courant, pour ramener à l'écran de connexion. */
  onSignOut?: () => void
}) {
  const { t, formatDate } = useI18n()
  const toast = useToast()
  const [sessions, setSessions] = useState<DeviceSession[]>([])
  const [chargement, setChargement] = useState(true)
  const [occupe, setOccupe] = useState<string | null>(null)

  const recharger = useCallback(async () => {
    setSessions(await mySessions())
    setChargement(false)
  }, [])

  useEffect(() => { void recharger() }, [recharger])

  const revoquer = async (s: DeviceSession) => {
    setOccupe(s.id)
    try {
      await sessionRevoke(s.id)
      toast(t('sec.revokeDone'))
      // L'appareil courant : là, on peut vraiment couper, et tout de suite.
      if (estCetAppareil(s)) {
        if (supabase) await supabase.auth.signOut()
        onSignOut?.()
        return
      }
      await recharger()
    } finally {
      setOccupe(null)
    }
  }

  return (
    <Card title={t('sec.myDevices')}>
      <p className="t-caption t-tertiary" style={{ marginBottom: 'var(--sp-4)' }}>{t('sec.devicesHint')}</p>

      {chargement ? (
        <p className="t-small t-tertiary">…</p>
      ) : sessions.length === 0 ? (
        <Empty title={t('sec.noDevices')} scene="aucune" />
      ) : (
        <div className="list">
          {sessions.map((s) => {
            const ici = estCetAppareil(s)
            return (
              <div key={s.id} className="list__row">
                <Icon name={s.revokedAt ? 'logout' : 'lock'} size={16} className="t-tertiary" />
                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className="t-small">
                    {s.deviceLabel || `${s.browser ?? ''} ${s.platform ?? ''}`.trim() || t('sec.empty')}
                    {ici && <> <Pill tone="green">{t('sec.thisDevice')}</Pill></>}
                  </span>
                  <span className="t-caption t-tertiary">
                    {s.revokedAt
                      ? t('sec.revokedOn', { date: formatDate(s.revokedAt) })
                      : <>{t('sec.lastSeen', { when: '' })}<Ago iso={s.lastSeenAt} /></>}
                    {s.ipAddress && ` · ${s.ipAddress}`}
                  </span>
                </span>
                {s.revokedAt ? (
                  <Pill tone="gray">{t('sec.revoked')}</Pill>
                ) : (
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={occupe === s.id}
                    onClick={() => void revoquer(s)}
                  >
                    {t('sec.revoke')}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* La limite, dite à l'endroit où la personne s'apprête à cliquer, pas
          dans une aide en ligne que personne n'ouvre. */}
      <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-4)' }}>
        {t('sec.revokeLimit')}
      </p>
    </Card>
  )
}
