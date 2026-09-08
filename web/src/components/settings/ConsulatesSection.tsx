import { useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Field, IconButton, Input, Modal, Pill, Select, Switch, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import type { Consulate, DepositCentre } from '@/data/types'

/* Le poste, pas le pays. C'est lui qui porte le taux de refus, le centre de
   depot et le delai de recours. Rien de tout cela n'est code en dur : les
   sources publiques se contredisent sur le delai de recours, et le taux
   officiel change chaque annee. */
export function ConsulatesSection() {
  const { db, actions } = useStore()
  const { t, tt, formatMoney } = useI18n()
  const toast = useToast()
  const [editing, setEditing] = useState<Consulate | null>(null)
  const [creating, setCreating] = useState(false)

  return (
    <>
      <Card
        title={t('consulates.title')}
        action={<Button icon="plus" onClick={() => setCreating(true)}>{t('consulates.add')}</Button>}
        flush
      >
        <p className="t-small t-secondary" style={{ padding: '0 var(--sp-5) var(--sp-4)' }}>{t('consulates.subtitle')}</p>
        {db.consulates.length === 0 ? (
          <div style={{ padding: 'var(--sp-5)' }}><Empty title={t('consulates.none')} /></div>
        ) : (
          <div className="list">
            {db.consulates.map((c) => (
              <div key={c.id} className="list__row">
                <Icon name="passport" size={18} className="t-tertiary" />
                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className="t-medium t-small t-truncate">{tt(c.country)} · {c.city}</span>
                  <span className="t-caption t-tertiary t-truncate">
                    {t(`centre.${c.centre}` as 'centre.tls_tunis')}
                    {c.refRefusalRate !== undefined ? ` · ${t('refstats.official')} ${c.refRefusalRate}%` : ''}
                    {c.appealDays ? ` · ${t('consulates.appealDays')} ${c.appealDays}` : ''}
                  </span>
                </span>
                <span className="t-small t-num col-optional">{formatMoney(c.feeConsulate)}</span>
                {!c.active && <Pill tone="gray">{t('misc.inactive')}</Pill>}
                <IconButton icon="edit" label={t('action.edit')} onClick={() => setEditing(c)} />
                <IconButton
                  icon="trash"
                  label={t('action.delete')}
                  onClick={() => { actions.removeConsulate(c.id); toast(t('crud.removed')) }}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      {(editing || creating) && (
        <ConsulateEditor
          consulate={editing}
          onClose={() => { setEditing(null); setCreating(false) }}
        />
      )}
    </>
  )
}

const CENTRES: DepositCentre[] = ['tls_tunis', 'tls_sfax', 'vfs_tunis', 'consulat', 'autre']

function ConsulateEditor({ consulate, onClose }: { consulate: Consulate | null; onClose: () => void }) {
  const { db, actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const [draft, setDraft] = useState({
    countryCode: consulate?.countryCode ?? '',
    country: consulate?.country.fr ?? '',
    city: consulate?.city ?? '',
    centre: (consulate?.centre ?? 'consulat') as DepositCentre,
    requiresResidence: consulate?.requiresResidence ?? false,
    feeConsulate: consulate?.feeConsulate ?? 0,
    currency: consulate?.currency ?? db.agency.currency,
    appealDays: consulate?.appealDays?.toString() ?? '',
    appealSource: consulate?.appealSource ?? '',
    appealCheckedAt: consulate?.appealCheckedAt?.slice(0, 10) ?? '',
    refYear: consulate?.refYear?.toString() ?? '',
    refRefusalRate: consulate?.refRefusalRate?.toString() ?? '',
    refMultiEntryShare: consulate?.refMultiEntryShare?.toString() ?? '',
    announcedDays: consulate?.announcedDays?.toString() ?? '',
    notes: consulate?.notes ?? '',
    active: consulate?.active ?? true,
  })
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft({ ...draft, [key]: value })
  const num = (x: string): number | undefined => (x.trim() === '' ? undefined : Number(x))

  return (
    <Modal
      title={consulate ? t('action.edit') : t('consulates.add')}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!draft.country.trim() || !draft.city.trim()}
            onClick={() => {
              actions.saveConsulate({
                id: consulate?.id,
                countryCode: draft.countryCode.trim().toUpperCase(),
                country: consulate ? { ...consulate.country, fr: draft.country.trim() } : { fr: draft.country.trim() },
                city: draft.city.trim(),
                centre: draft.centre,
                requiresResidence: draft.requiresResidence,
                feeConsulate: Number(draft.feeConsulate) || 0,
                currency: draft.currency,
                appealDays: num(draft.appealDays),
                appealSource: draft.appealSource.trim() || undefined,
                appealCheckedAt: draft.appealCheckedAt || undefined,
                refYear: num(draft.refYear),
                refRefusalRate: num(draft.refRefusalRate),
                refMultiEntryShare: num(draft.refMultiEntryShare),
                announcedDays: num(draft.announcedDays),
                notes: draft.notes.trim() || undefined,
                active: draft.active,
              })
              onClose()
              toast(consulate ? t('crud.updated') : t('crud.created'))
            }}
          >
            {t('action.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label={t('cases.visa')}>
          <Input value={draft.country} onChange={(e) => set('country', e.target.value)} />
        </Field>
        <Field label={t('consulates.city')}>
          <Input value={draft.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label={t('consulates.centre')}>
          <Select value={draft.centre} onChange={(e) => set('centre', e.target.value as DepositCentre)}>
            {CENTRES.map((x) => (
              <option key={x} value={x}>{t(`centre.${x}` as 'centre.tls_tunis')}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('consulates.fee')}>
          <Input type="number" min={0} value={draft.feeConsulate} onChange={(e) => set('feeConsulate', Number(e.target.value))} />
        </Field>
        <Field label={t('consulates.appealDays')} hint={t('consulates.appealSource')}>
          <Input type="number" min={0} value={draft.appealDays} onChange={(e) => set('appealDays', e.target.value)} />
        </Field>
        <Field label={t('consulates.appealSource')}>
          <Input value={draft.appealSource} onChange={(e) => set('appealSource', e.target.value)} />
        </Field>
        <Field label={t('consulates.appealCheckedAt')}>
          <Input type="date" value={draft.appealCheckedAt} onChange={(e) => set('appealCheckedAt', e.target.value)} />
        </Field>
        <Field label={t('consulates.announced')}>
          <Input type="number" min={0} value={draft.announcedDays} onChange={(e) => set('announcedDays', e.target.value)} />
        </Field>
        <Field label={t('consulates.refYear')}>
          <Input type="number" value={draft.refYear} onChange={(e) => set('refYear', e.target.value)} />
        </Field>
        <Field label={t('consulates.refRate')} hint={t('refstats.hint')}>
          <Input type="number" step="0.1" value={draft.refRefusalRate} onChange={(e) => set('refRefusalRate', e.target.value)} />
        </Field>
        <Field label={t('consulates.refMulti')}>
          <Input type="number" step="0.1" value={draft.refMultiEntryShare} onChange={(e) => set('refMultiEntryShare', e.target.value)} />
        </Field>
        <Field label={t('misc.active')}>
          <Switch checked={draft.active} onChange={(x) => set('active', x)} label={t('misc.active')} />
        </Field>
      </div>
      <div style={{ marginTop: 'var(--sp-4)' }}>
        <Field label={t('consulates.requiresResidence')} hint={t('consulates.requiresResidenceHint')}>
          <Switch
            checked={draft.requiresResidence}
            onChange={(x) => set('requiresResidence', x)}
            label={t('consulates.requiresResidence')}
          />
        </Field>
      </div>
      <div style={{ marginTop: 'var(--sp-4)' }}>
        <Field label={t('caseDetail.notes')}>
          <Textarea value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
