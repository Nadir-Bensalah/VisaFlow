import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { useVisible } from '@/data/scope'
import { Card, Empty, Pill } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { Ago } from '@/components/bits'
import { auditSearch, type AuditAction, type AuditEntry } from '@/data/securite'
import type { Tone } from '@/lib/derive'

/**
 * Le journal des modifications d'une entité : un client, un dossier, un
 * paiement, une pièce.
 *
 * Il montre le CHAMP, sa valeur AVANT et sa valeur APRÈS. C'est la différence
 * avec le fil d'activité, qui raconte le métier en français (« dossier passé
 * en dépôt »). Ici on répond à « qui a changé ce numéro de passeport, et
 * quand », qui est la seule question qui compte le jour d'un litige avec un
 * consulat ou d'un contrôle de l'INPDP.
 *
 * Ce composant se monte sur n'importe quelle fiche. Il ne s'affiche pas du
 * tout quand le compte n'a pas `audit:view` : montrer un cadre « réservé » sur
 * chaque fiche d'un agent serait du bruit permanent pour une information qu'il
 * n'obtiendra jamais.
 *
 * Il ne montre volontairement AUCUN bouton d'action. Un journal ne se corrige
 * pas, ne s'annule pas et ne se rejoue pas : la base refuse déjà toute
 * modification, l'écran ne doit pas suggérer le contraire.
 */

const TON: Record<AuditAction, Tone> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  read_sensitive: 'gray',
  export: 'orange',
  login: 'gray',
  permission_change: 'violet',
}

export function AuditTrail({ entityType, entityId, limit = 50, title }: {
  /** Le nom de la table, tel qu'il est écrit dans le journal : `clients`, `cases`, `payments`. */
  entityType: string
  entityId: string
  limit?: number
  title?: string
}) {
  const { t, locale } = useI18n()
  const v = useVisible()
  const autorise = v.can('audit:view')

  const [lignes, setLignes] = useState<AuditEntry[]>([])
  const [chargement, setChargement] = useState(true)
  const [ouvert, setOuvert] = useState<string | null>(null)

  useEffect(() => {
    if (!autorise) return
    let vivant = true
    setChargement(true)
    void auditSearch({ entityType, entityId, limit }).then((r) => {
      if (!vivant) return
      setLignes(r)
      setChargement(false)
    })
    return () => { vivant = false }
  }, [autorise, entityType, entityId, limit])

  if (!autorise) return null

  return (
    <Card title={title ?? t('sec.audit')}>
      <p className="t-caption t-tertiary" style={{ marginBottom: 'var(--sp-4)' }}>{t('sec.auditHint')}</p>

      {chargement ? (
        <p className="t-small t-tertiary">…</p>
      ) : lignes.length === 0 ? (
        <Empty title={t('sec.noAudit')} scene="aucune" />
      ) : (
        <div className="list">
          {lignes.map((l) => {
            const champs = l.changedFields ?? []
            const deplie = ouvert === l.id
            return (
              <div key={l.id} className="col" style={{ padding: 'var(--sp-3) 0' }}>
                <div className="row-between wrap" style={{ gap: 'var(--sp-2)' }}>
                  <span className="row" style={{ gap: 'var(--sp-2)', minWidth: 0 }}>
                    <Pill tone={TON[l.action] ?? 'gray'}>
                      {t(`sec.action_${l.action}` as 'sec.action_create')}
                    </Pill>
                    <span className="t-small t-secondary">
                      {l.userName
                        ? t('sec.byWhom', { name: l.userName })
                        : t('sec.bySystem')}
                    </span>
                  </span>
                  <span className="t-caption t-tertiary"><Ago iso={l.at} /></span>
                </div>

                {champs.length > 0 && (
                  <button
                    type="button"
                    className="t-caption t-tertiary"
                    style={{
                      background: 'transparent', border: 0, padding: 0, marginTop: 'var(--sp-1)',
                      cursor: 'pointer', color: 'inherit', textAlign: locale === 'ar' ? 'right' : 'left',
                    }}
                    aria-expanded={deplie}
                    onClick={() => setOuvert(deplie ? null : l.id)}
                  >
                    {champs.length === 1
                      ? t('sec.fields', { n: champs.length })
                      : t('sec.fieldsMany', { n: champs.length })}
                    {' · '}
                    {deplie ? t('sec.hideValues') : t('sec.showValues')}
                  </button>
                )}

                {deplie && (
                  <div className="col gap-2" style={{ marginTop: 'var(--sp-3)' }}>
                    {champs.map((c) => (
                      <div key={c} className="col" style={{ gap: 'var(--sp-1)' }}>
                        <span className="t-caption t-mono t-tertiary">{c}</span>
                        <span className="row wrap t-small" style={{ gap: 'var(--sp-2)' }}>
                          <span className="t-tertiary">{t('sec.before')}</span>
                          <span className="t-mono">{lisible(l.oldValues?.[c], t('sec.empty'))}</span>
                          <Icon name="arrow" size={14} className="t-tertiary" />
                          <span className="t-tertiary">{t('sec.after')}</span>
                          <span className="t-mono">{lisible(l.newValues?.[c], t('sec.empty'))}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

/**
 * Une valeur du journal, telle qu'on la montre.
 *
 * On n'invente rien et on ne traduit rien : ce qui est écrit dans le journal
 * est ce qui était dans la colonne. Un objet est affiché en JSON compact, une
 * valeur absente est nommée « vide » plutôt que laissée blanche, sans quoi on
 * ne distingue pas « champ effacé » de « affichage cassé ».
 */
function lisible(valeur: unknown, motPourVide: string): string {
  if (valeur === null || valeur === undefined || valeur === '') return motPourVide
  if (typeof valeur === 'string') return valeur
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur)
  try {
    return JSON.stringify(valeur)
  } catch {
    return motPourVide
  }
}
