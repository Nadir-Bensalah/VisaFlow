import { useEffect, useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Card, Empty } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { listHistory, type HistoryKind, type StatusChange } from '@/data/integrite'

/**
 * L'historique d'un dossier ou d'une cargaison.
 *
 * Avant, une étape changeait et personne ne savait qui l'avait fait bouger.
 * Le jour d'un désaccord avec un consulat ou d'un litige avec un client, c'est
 * la seule pièce qui vaille. On l'affiche donc à l'endroit où la question se
 * pose : sur la fiche elle-même.
 *
 * Cette liste ne propose AUCUN geste. Pas de crayon, pas de corbeille. Le
 * serveur n'accepte ni modification ni suppression, et un bouton qui promet
 * l'inverse serait un mensonge.
 */
export function HistoryCard({ entityKind, entityId }: { entityKind: HistoryKind; entityId: string }) {
  const { db } = useStore()
  const { t, formatDate } = useI18n()
  const [rows, setRows] = useState<StatusChange[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    listHistory(entityKind, entityId)
      .then((r) => { if (alive) setRows(r) })
      .catch((e: Error) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [entityKind, entityId])

  const authorOf = (id: string | null) =>
    id ? (db.users.find((u) => u.id === id)?.name ?? t('int.unknownAuthor')) : t('int.unknownAuthor')

  return (
    <Card title={t('int.history')} flush>
      {error && <div className="card__body"><p className="t-small t-tertiary">{t('int.loadError', { msg: error })}</p></div>}
      {!error && rows !== null && rows.length === 0 && (
        <Empty title={t('int.noHistory')} hint={t('int.noHistoryHint')} scene="vide" />
      )}
      {!error && rows !== null && rows.length > 0 && (
        <div className="list">
          {rows.map((r) => (
            <div key={r.id} className="list__row">
              <Icon name={r.field === 'status' ? 'check' : 'arrow'} size={16} className="t-tertiary" />
              <span className="col grow" style={{ minWidth: 0 }}>
                <span className="t-small t-truncate">
                  <span className="t-tertiary">
                    {r.field === 'status' ? t('int.fieldStatus') : t('int.fieldStage')}
                    {' : '}
                  </span>
                  {r.fromValue ?? t('int.none')} {t('int.arrow')} <span className="t-medium">{r.toValue}</span>
                </span>
                <span className="t-caption t-tertiary">
                  {formatDate(r.changedAt, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {' '}{t('int.by')} {authorOf(r.changedBy)}
                  {r.location ? ` · ${r.location}` : ''}
                </span>
                {r.note && <span className="t-caption t-secondary">{r.note}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
