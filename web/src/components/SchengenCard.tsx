import { useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Card, Field, Input, Modal, Pill, Select, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { MAX_DAYS, asStay, planStay, schengenState, todayIso, type Stay } from '@/lib/schengen'
import type { SchengenStay } from '@/data/types'

/**
 * Le compteur 90 jours sur 180.
 *
 * L'étude de marché le classe comme la question client la plus fréquente
 * depuis l'entrée en service de l'EES, et comme une fonctionnalité que
 * personne n'offre en Tunisie. On la sert aux deux bouts : à l'agent, qui
 * répond au comptoir, et au client lui-même dans son portail.
 *
 * Deux choses qu'on prend soin de dire, parce qu'un chiffre nu induit en
 * erreur : la fenêtre est GLISSANTE (des jours se libèrent en vieillissant),
 * et le nombre de jours restants aujourd'hui n'est PAS la durée du prochain
 * séjour possible. On affiche donc les deux.
 */

export function SchengenGauge({ stays, compact }: { stays: Stay[]; compact?: boolean }) {
  const { t, formatDate } = useI18n()
  const state = schengenState(stays)
  const plan = planStay(stays)
  const pct = Math.min(100, (state.used / MAX_DAYS) * 100)
  const tone = state.remaining === 0 ? 'red' : state.remaining <= 15 ? 'orange' : 'green'

  return (
    <div className="col gap-4">
      <div className="row gap-4" style={{ alignItems: 'baseline' }}>
        <span className={`schengen__big schengen__big--${tone}`}>{state.remaining}</span>
        <div className="col gap-1 grow">
          <span className="t-small t-medium">{t('schengen.remaining')}</span>
          <span className="t-caption t-tertiary">
            {t('schengen.usedOf', { used: state.used, max: MAX_DAYS })}
          </span>
        </div>
        {state.inside && <Pill tone="blue">{t('schengen.inside')}</Pill>}
      </div>

      <div className="schengen__bar" role="img" aria-label={t('schengen.usedOf', { used: state.used, max: MAX_DAYS })}>
        <span className={`schengen__fill schengen__fill--${tone}`} style={{ width: `${pct}%` }} />
      </div>

      <p className="t-caption t-tertiary" style={{ margin: 0 }}>
        {/* La fenêtre glisse : le dire évite la question suivante. */}
        {t('schengen.window', { from: formatDate(state.windowFrom), to: formatDate(state.on) })}
      </p>

      {state.inside && state.mustLeaveBy && (
        <p className="schengen__note is-warn">
          <Icon name="alert" size={14} />
          <span>{t('schengen.mustLeave', { date: formatDate(state.mustLeaveBy) })}</span>
        </p>
      )}

      {!compact && (
        <p className="schengen__note">
          <Icon name="sparkle" size={14} />
          <span>
            {plan.maxDays > 0
              // Le nombre de jours restants n'est pas la durée du prochain
              // séjour : la fenêtre bouge pendant qu'on est sur place.
              ? t('schengen.canStay', { n: plan.maxDays })
              : plan.earliestEntry
                ? t('schengen.comeBack', { date: formatDate(plan.earliestEntry) })
                : t('schengen.blocked')}
          </span>
        </p>
      )}
    </div>
  )
}

/** La version de l'espace agence : le compteur, et la saisie des séjours. */
export function SchengenCard({ clientId }: { clientId: string }) {
  const { db } = useStore()
  const { t, formatDate } = useI18n()
  const [editing, setEditing] = useState<SchengenStay | 'nouveau' | null>(null)

  const rows = db.stays
    .filter((s) => s.clientId === clientId)
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate))

  return (
    <>
      <Card
        title={t('schengen.title')}
        action={<Button icon="plus" onClick={() => setEditing('nouveau')}>{t('schengen.addStay')}</Button>}
      >
        {rows.length === 0 ? (
          <p className="t-small t-tertiary">{t('schengen.noStay')}</p>
        ) : (
          <div className="col gap-5">
            <SchengenGauge stays={rows.map(asStay)} />

            <div className="col gap-2">
              <span className="t-caption t-tertiary">{t('schengen.stays')}</span>
              {rows.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="schengen__stay"
                  onClick={() => setEditing(s)}
                >
                  <span className="t-small grow" style={{ textAlign: 'start' }}>
                    {formatDate(s.entryDate)} → {s.exitDate ? formatDate(s.exitDate) : t('schengen.stillIn')}
                  </span>
                  {s.country && <span className="t-caption t-tertiary">{s.country}</span>}
                  {/* D'où vient la date : indispensable le jour où le client conteste. */}
                  <Pill tone={s.source === 'ees' ? 'green' : s.source === 'tampon' ? 'blue' : 'gray'}>
                    {t(`schengen.src_${s.source}` as 'schengen.src_declare')}
                  </Pill>
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {editing && (
        <StayEditor
          clientId={clientId}
          stay={editing === 'nouveau' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function StayEditor({ clientId, stay, onClose }: {
  clientId: string; stay: SchengenStay | null; onClose: () => void
}) {
  const { actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const [entryDate, setEntryDate] = useState(stay?.entryDate ?? todayIso())
  const [exitDate, setExitDate] = useState(stay?.exitDate ?? '')
  const [country, setCountry] = useState(stay?.country ?? '')
  const [source, setSource] = useState<SchengenStay['source']>(stay?.source ?? 'declare')

  const valid = entryDate !== '' && (exitDate === '' || exitDate >= entryDate)

  return (
    <Modal
      title={stay ? t('schengen.editStay') : t('schengen.addStay')}
      onClose={onClose}
      footer={
        <>
          {stay && (
            <Button icon="trash" onClick={() => { actions.removeStay(stay.id); toast(t('crud.removed')); onClose() }}>
              {t('crud.remove')}
            </Button>
          )}
          <span className="grow" />
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              actions.saveStay({
                ...(stay ? { id: stay.id } : {}),
                clientId, entryDate,
                exitDate: exitDate || undefined,
                country: country.toUpperCase().slice(0, 2) || undefined,
                source,
              })
              toast(t('crud.updated'))
              onClose()
            }}
          >
            {t('action.confirm')}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <div className="grid grid--2">
          <Field label={t('schengen.entry')}>
            <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </Field>
          <Field label={t('schengen.exit')} hint={t('schengen.exitHint')}>
            <Input type="date" value={exitDate} min={entryDate} onChange={(e) => setExitDate(e.target.value)} />
          </Field>
          <Field label={t('schengen.country')}>
            <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="FR" />
          </Field>
          <Field label={t('schengen.source')} hint={t('schengen.sourceHint')}>
            <Select value={source} onChange={(e) => setSource(e.target.value as SchengenStay['source'])}>
              {(['declare', 'tampon', 'ees', 'agence'] as const).map((x) => (
                <option key={x} value={x}>{t(`schengen.src_${x}` as 'schengen.src_declare')}</option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="t-caption t-tertiary" style={{ margin: 0 }}>{t('schengen.bothDaysCount')}</p>
      </div>
    </Modal>
  )
}
