import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Card } from '@/components/ui'
import { Ago } from '@/components/bits'
import { Icon } from '@/components/Icon'

/* Le journal d'audit : qui a fait quoi, et quand. On garde les soixante
   derniers événements. Au-delà, la liste ne se lit plus, et la recherche
   d'un fait précis passe par l'export. */
export function AuditLogSection() {
  const { db } = useStore()
  const { tt } = useI18n()

  return (
    <Card flush>
      <div className="list">
        {db.events.slice(0, 60).map((e) => (
          <div key={e.id} className="list__row">
            <Icon name={e.automated ? 'automations' : 'check'} size={16} className="t-tertiary" />
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className="t-small">{tt(e.detail)}</span>
              <span className="t-caption t-tertiary">
                <Ago iso={e.at} />
                {e.actorId && ` · ${db.users.find((u) => u.id === e.actorId)?.name ?? ''}`}
              </span>
            </span>
            <span className="t-caption t-tertiary t-mono col-optional">{e.type}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}
