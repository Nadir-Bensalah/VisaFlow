import { useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Button, Card, Field, IconButton, Input, Modal, Pill, Select, Switch, useToast } from '@/components/ui'
import type { ChecklistItem, I18nText, VisaType } from '@/data/types'

const EMPTY_I18N: I18nText = { fr: '' }

/* Les types de visa et, accrochée à chacun, sa liste de pièces. Les deux ne se
   séparent pas : une liste de pièces sans le visa qu'elle sert ne veut rien
   dire pour l'agent du comptoir. */
export function VisaCatalogSection() {
  const { db, actions } = useStore()
  const { t, tt, formatMoney } = useI18n()
  const toast = useToast()
  const [editing, setEditing] = useState<VisaType | 'nouveau' | null>(null)
  const [itemFor, setItemFor] = useState<{ checklistId: string; item: ChecklistItem | null } | null>(null)

  return (
    <>
      <div className="row-between" style={{ marginBottom: 'var(--sp-5)' }}>
        <p className="t-small t-secondary">{t('settings.checklists')}</p>
        <Button icon="plus" onClick={() => setEditing('nouveau')}>{t('crud.newVisaType')}</Button>
      </div>

      <div className="stack">
        {db.visaTypes.map((visa) => {
          const checklist = db.checklists.find((c) => c.id === visa.checklistId)
          return (
            <Card
              key={visa.id}
              title={`${tt(visa.country)} · ${tt(visa.label)}`}
              action={
                <span className="row gap-2">
                  <Pill tone="blue">{t('reports.days', { n: visa.processingDays })}</Pill>
                  <Pill tone="gray">{formatMoney(visa.feeAgency + visa.feeConsulate)}</Pill>
                  <IconButton icon="edit" label={t('crud.edit')} onClick={() => setEditing(visa)} />
                  <Switch
                    checked={visa.active}
                    onChange={(value) => { actions.saveVisaType({ ...visa, active: value }); toast(t('crud.updated')) }}
                    label={tt(visa.label)}
                  />
                </span>
              }
            >
              <div className="col gap-2">
                {checklist?.items.map((item) => (
                  <div key={item.key} className="row-between" style={{ paddingBottom: 'var(--sp-2)', borderBottom: '1px solid var(--hairline)' }}>
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <span className="t-small">{tt(item.label)}</span>
                      <span className="t-caption t-tertiary">
                        {item.required ? t('misc.required') : t('misc.optional')}
                        {item.validityDays ? ` · ${item.validityDays} j` : ''}
                      </span>
                    </span>
                    <span className="row gap-1">
                      <IconButton icon="edit" label={t('crud.edit')} onClick={() => setItemFor({ checklistId: checklist.id, item })} />
                      <IconButton
                        icon="trash"
                        label={t('crud.remove')}
                        onClick={() => { actions.removeChecklistItem(checklist.id, item.key); toast(t('crud.removed')) }}
                      />
                    </span>
                  </div>
                ))}
                {checklist && (
                  <Button size="sm" icon="plus" onClick={() => setItemFor({ checklistId: checklist.id, item: null })}>
                    {t('crud.newItem')}
                  </Button>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      {editing && <VisaEditor visa={editing === 'nouveau' ? null : editing} onClose={() => setEditing(null)} />}
      {itemFor && <ItemEditor checklistId={itemFor.checklistId} item={itemFor.item} onClose={() => setItemFor(null)} />}
    </>
  )
}

function VisaEditor({ visa, onClose }: { visa: VisaType | null; onClose: () => void }) {
  const { db, actions } = useStore()
  const { t, tt } = useI18n()
  const toast = useToast()
  const [draft, setDraft] = useState<Omit<VisaType, 'agencyId'>>(
    visa ?? {
      id: '', countryCode: 'CN', country: { ...EMPTY_I18N }, label: { ...EMPTY_I18N },
      category: 'affaires', processingDays: 10, feeAgency: 300, feeConsulate: 200,
      checklistId: db.checklists[0]?.id ?? '', active: true,
      stages: ['nouveau', 'pieces', 'verification', 'rendez_vous', 'depot', 'consulat', 'decision', 'retrait', 'clos'],
    },
  )

  return (
    <Modal
      wide
      title={visa ? t('crud.edit') : t('crud.newVisaType')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!draft.country.fr.trim() || !draft.label.fr.trim()}
            onClick={() => {
              actions.saveVisaType(visa ? draft : { ...draft, id: undefined })
              onClose()
              toast(visa ? t('crud.updated') : t('crud.created'))
            }}
          >
            {t('action.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label={t('reports.byCountry')}>
          <Input value={draft.country.fr} onChange={(e) => setDraft({ ...draft, country: { ...draft.country, fr: e.target.value } })} />
        </Field>
        <Field label={t('cases.visa')}>
          <Input value={draft.label.fr} onChange={(e) => setDraft({ ...draft, label: { ...draft.label, fr: e.target.value } })} />
        </Field>
        <Field label={t('reports.delay')}>
          <Input type="number" min={1} value={draft.processingDays} onChange={(e) => setDraft({ ...draft, processingDays: Number(e.target.value) })} />
        </Field>
        <Field label={t('settings.checklists')}>
          <Select value={draft.checklistId} onChange={(e) => setDraft({ ...draft, checklistId: e.target.value })}>
            {db.checklists.map((c) => <option key={c.id} value={c.id}>{tt(c.name)}</option>)}
          </Select>
        </Field>
        <Field label={t('pay.collected')}>
          <Input type="number" min={0} value={draft.feeAgency} onChange={(e) => setDraft({ ...draft, feeAgency: Number(e.target.value) })} />
        </Field>
        <Field label={t('pay.amount')}>
          <Input type="number" min={0} value={draft.feeConsulate} onChange={(e) => setDraft({ ...draft, feeConsulate: Number(e.target.value) })} />
        </Field>
      </div>
    </Modal>
  )
}

function ItemEditor({ checklistId, item, onClose }: { checklistId: string; item: ChecklistItem | null; onClose: () => void }) {
  const { actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const [draft, setDraft] = useState<ChecklistItem>(
    item ?? { key: '', label: { ...EMPTY_I18N }, required: true },
  )

  return (
    <Modal
      wide
      title={item ? t('crud.edit') : t('crud.newItem')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!draft.label.fr.trim()}
            onClick={() => {
              const key = draft.key || draft.label.fr.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)
              actions.saveChecklistItem(checklistId, { ...draft, key }, item?.key)
              onClose()
              toast(item ? t('crud.updated') : t('crud.created'))
            }}
          >
            {t('action.save')}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <p className="t-caption t-tertiary">{t('crud.fillFrench')}</p>
        {LOCALES.map((l) => (
          <Field key={l} label={`${t('crud.itemLabel')} · ${LOCALE_META[l].native}`}>
            <Input
              dir={LOCALE_META[l].dir}
              lang={l}
              value={draft.label[l] ?? ''}
              onChange={(e) => setDraft({ ...draft, label: { ...draft.label, [l]: e.target.value } })}
            />
          </Field>
        ))}
        <div className="grid grid--2">
          <Field label={t('crud.itemValidity')}>
            <Input
              type="number"
              min={0}
              value={draft.validityDays ?? ''}
              onChange={(e) => setDraft({ ...draft, validityDays: e.target.value ? Number(e.target.value) : undefined })}
            />
          </Field>
          <div className="row-between" style={{ alignSelf: 'end', paddingBottom: 8 }}>
            <span className="t-small t-secondary">{t('crud.itemRequired')}</span>
            <Switch checked={draft.required} onChange={(value) => setDraft({ ...draft, required: value })} label={t('crud.itemRequired')} />
          </div>
        </div>
      </div>
    </Modal>
  )
}
