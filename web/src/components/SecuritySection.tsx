import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { useVisible } from '@/data/scope'
import { Button, Card, Empty, Pill, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { Ago } from '@/components/bits'
import { SessionsCard } from '@/components/SessionsCard'
import {
  agencySessions, securityFeed, sessionRevoke,
  type DeviceSession, type SecurityEvent, type SecuritySeverity,
} from '@/data/securite'
import type { Tone } from '@/lib/derive'

/**
 * L'écran de sécurité de l'agence, à monter dans les Réglages.
 *
 * Il montre trois choses et pas une de plus :
 *   · les événements récents (connexions refusées, nouveaux appareils,
 *     changements de droits, exports) ;
 *   · les appareils de toute l'équipe, avec leur dernière activité ;
 *   · mes propres appareils, où la déconnexion a un vrai effet.
 *
 * Ce qu'il ne fait pas, et qu'aucune formulation n'essaie de masquer : il ne
 * détecte rien tout seul. Il n'y a pas de moteur d'anomalies, pas de score de
 * risque, pas d'alerte automatique. Il montre ce que le serveur a écrit. Un
 * tableau qui prétendrait « aucune menace détectée » mentirait deux fois : sur
 * ce qu'il regarde, et sur ce qu'il sait.
 */

const TON_GRAVITE: Record<SecuritySeverity, Tone> = {
  info: 'gray',
  attention: 'orange',
  critique: 'red',
}

export function SecuritySection() {
  const { t, formatDate } = useI18n()
  const v = useVisible()
  const toast = useToast()

  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [devices, setDevices] = useState<DeviceSession[]>([])
  const [chargement, setChargement] = useState(true)
  const [occupe, setOccupe] = useState<string | null>(null)

  const autorise = v.can('audit:view')

  const recharger = useCallback(async () => {
    if (!autorise) { setChargement(false); return }
    const [e, d] = await Promise.all([securityFeed(60), agencySessions(60)])
    setEvents(e)
    setDevices(d)
    setChargement(false)
  }, [autorise])

  useEffect(() => { void recharger() }, [recharger])

  const revoquer = async (s: DeviceSession) => {
    setOccupe(s.id)
    try {
      await sessionRevoke(s.id)
      toast(t('sec.revokeDone'))
      await recharger()
    } catch {
      // Le serveur refuse la révocation d'un appareil qui n'est pas le sien
      // quand on n'administre pas l'équipe. On le dit, sans deviner pourquoi.
      toast(t('sec.auditDenied'))
    } finally {
      setOccupe(null)
    }
  }

  return (
    <div className="stack">
      {/* Mes appareils d'abord : c'est la seule partie où la personne peut
          agir avec un effet immédiat sur elle-même. */}
      <SessionsCard />

      {!autorise ? (
        <Card title={t('sec.title')}>
          <p className="t-small t-secondary">{t('sec.auditDenied')}</p>
        </Card>
      ) : (
        <>
          <Card title={t('sec.events')}>
            <p className="t-caption t-tertiary" style={{ marginBottom: 'var(--sp-4)' }}>{t('sec.eventsHint')}</p>
            {chargement ? (
              <p className="t-small t-tertiary">…</p>
            ) : events.length === 0 ? (
              <Empty title={t('sec.noEvents')} scene="aucune" />
            ) : (
              <div className="list">
                {events.map((e) => (
                  <div key={e.id} className="list__row">
                    <Icon
                      name={e.severity === 'critique' ? 'alert' : e.severity === 'attention' ? 'eye' : 'shield'}
                      size={16}
                      className="t-tertiary"
                    />
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <span className="t-small">{t(`sec.kind_${e.kind}` as 'sec.kind_NEW_DEVICE')}</span>
                      <span className="t-caption t-tertiary">
                        <Ago iso={e.at} />
                        {e.userName && ` · ${e.userName}`}
                        {e.ipAddress && ` · ${e.ipAddress}`}
                      </span>
                    </span>
                    <Pill tone={TON_GRAVITE[e.severity]} dot>
                      {t(`sec.severity_${e.severity}` as 'sec.severity_info')}
                    </Pill>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title={t('sec.devices')}>
            <p className="t-caption t-tertiary" style={{ marginBottom: 'var(--sp-4)' }}>{t('sec.devicesHint')}</p>
            {chargement ? (
              <p className="t-small t-tertiary">…</p>
            ) : devices.length === 0 ? (
              <Empty title={t('sec.noDevices')} scene="aucune" />
            ) : (
              <div className="list">
                {devices.map((s) => (
                  <div key={s.id} className="list__row">
                    <Icon name={s.revokedAt ? 'logout' : 'lock'} size={16} className="t-tertiary" />
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <span className="t-small">
                        {s.deviceLabel || `${s.browser ?? ''} ${s.platform ?? ''}`.trim() || t('sec.empty')}
                      </span>
                      <span className="t-caption t-tertiary">
                        {s.revokedAt
                          ? t('sec.revokedOn', { date: formatDate(s.revokedAt) })
                          : <Ago iso={s.lastSeenAt} />}
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
                ))}
              </div>
            )}
            <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-4)' }}>{t('sec.revokeLimit')}</p>
          </Card>
        </>
      )}
    </div>
  )
}
