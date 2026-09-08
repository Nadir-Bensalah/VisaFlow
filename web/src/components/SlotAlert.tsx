import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Card, Pill } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { freedSlots, slotCandidates } from '@/lib/creneaux'

/**
 * L'alerte de créneau libéré.
 *
 * Le goulot du métier n'est pas le dossier, c'est le créneau : 200 à 350 TND
 * sur un ticket de 550, et une société entière vit de cette seule fonction.
 *
 * Ce que l'écran répond, et que personne ne répond aujourd'hui : pas « qui est
 * le premier de la file », mais « qui est le premier DONT LE DOSSIER EST PRÊT ».
 * Réserver pour quelqu'un à qui il manque deux pièces, c'est brûler le créneau.
 */
export function SlotAlert({ consulateId }: { consulateId: string }) {
  const { db } = useStore()
  const { t, tt, formatDate } = useI18n()

  const consulate = db.consulates.find((c) => c.id === consulateId)
  const libres = freedSlots(db).filter((s) => s.consulateId === consulateId)
  const candidats = slotCandidates(db, consulateId, 8)

  if (candidats.length === 0) return null

  const prets = candidats.filter((c) => c.ready).length

  return (
    <Card
      title={t('slot.whoToCall')}
      action={
        consulate ? (
          <span className="t-caption t-tertiary">{tt(consulate.country)} · {consulate.city}</span>
        ) : undefined
      }
      flush
    >
      {libres.length > 0 && (
        <p className="slot__freed">
          <Icon name="clock" size={14} />
          <span>
            {t('slot.freed', { n: libres.length })}
            {' · '}
            {libres.slice(0, 3).map((s) => formatDate(s.at)).join(' · ')}
          </span>
        </p>
      )}

      <p className="fret__solidarity">
        <Icon name="sparkle" size={14} />
        <span>{t('slot.readyCount', { ready: prets, total: candidats.length })}</span>
      </p>

      <div className="list">
        {candidats.map((c, i) => (
          <div key={c.entryId} className={`list__row${c.ready ? '' : ' slot__notReady'}`}>
            <span className={`slot__rank${c.ready ? ' is-ready' : ''}`}>{i + 1}</span>
            <span className="col grow gap-1" style={{ minWidth: 0 }}>
              <span className="t-small t-medium">
                <Link to={`/dossiers/${c.caseId}`}>{c.clientName}</Link>
                <span className="t-caption t-tertiary"> · {c.reference}</span>
              </span>
              <span className="t-caption t-tertiary">
                {/* Ce qui décide vraiment : les pièces, puis la biométrie. */}
                {c.ready
                  ? t('slot.filesReady', { n: c.docsRequired })
                  : t('slot.filesMissing', { n: c.docsMissing })}
                {c.biometricsValid ? ` · ${t('slot.bioOk')}` : ''}
                {c.travelDate ? ` · ${t('caseDetail.travelOn')} ${formatDate(c.travelDate)}` : ''}
              </span>
            </span>
            {c.phone && (
              <a className="btn btn--secondary btn--sm" href={`tel:${c.phone.replace(/\s/g, '')}`}>
                <Icon name="phone" size={14} /> {t('action.call')}
              </a>
            )}
            {c.priority !== 'normale' && (
              <Pill tone={c.priority === 'urgente' ? 'red' : 'orange'}>
                {t(`priority.${c.priority}` as 'priority.urgente')}
              </Pill>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
