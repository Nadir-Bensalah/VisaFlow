import { useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Field, Input, Modal, Select, Switch, Textarea, useToast } from './ui'
import { clientName } from '@/lib/derive'
import type { Incoterm, Shipment, ShipmentMode, ShipmentStatus } from '@/data/types'

/* Le meme formulaire sert a creer et a corriger. Une cargaison se corrige
   souvent : le conteneur change, l'ETA glisse, la douane bloque. */
export function ShipmentEditor({ shipment, onClose }: { shipment: Shipment | null; onClose: () => void }) {
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt } = useI18n()
  const toast = useToast()

  const [draft, setDraft] = useState<Omit<Shipment, 'agencyId' | 'id'> & { id?: string }>(
    shipment ?? {
      reference: `EXP-2026-${String(db.shipments.length + 44).padStart(4, '0')}`,
      clientId: v.clients[0]?.id ?? '',
      mode: 'maritime_lcl',
      supplier: '',
      goods: { fr: '' },
      originCity: 'Guangzhou', originPort: 'Nansha',
      destCity: 'Tunis', destPort: 'Radès',
      countryFrom: 'CN', countryTo: 'TN',
      incoterm: 'FOB',
      packages: 0, weightKg: 0, volumeCbm: 0,
      declaredValue: 0, freightCost: 0, amountPaid: 0,
      stage: 'demande', status: 'en_cours',
      assigneeId: v.user.id,
      officeId: v.user.officeId,
      portalToken: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `shp_${crypto.randomUUID().replace(/-/g, '')}`
        : `shp_${Math.random().toString(36).slice(2, 12)}`,
    },
  )
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft({ ...draft, [key]: value })

  return (
    <Modal
      wide
      title={shipment ? t('crud.edit') : t('ship.newShipment')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!draft.clientId || !draft.goods.fr.trim()}
            onClick={() => {
              actions.saveShipment(draft)
              onClose()
              toast(shipment ? t('crud.updated') : t('crud.created'))
            }}
          >
            {t('action.save')}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <div className="grid grid--2">
          <Field label={t('cases.client')}>
            <Select value={draft.clientId} onChange={(e) => set('clientId', e.target.value)}>
              {v.clients.map((c) => <option key={c.id} value={c.id}>{clientName(db, c.id)}</option>)}
            </Select>
          </Field>
          <Field label={t('ship.reference')}>
            <Input value={draft.reference} onChange={(e) => set('reference', e.target.value)} />
          </Field>
          <Field label={t('ship.goods')}>
            <Input value={draft.goods.fr} onChange={(e) => set('goods', { ...draft.goods, fr: e.target.value })} />
          </Field>
          <Field label={t('ship.supplier')}>
            <Input value={draft.supplier} onChange={(e) => set('supplier', e.target.value)} />
          </Field>
          <Field label={t('ship.mode')}>
            <Select value={draft.mode} onChange={(e) => set('mode', e.target.value as ShipmentMode)}>
              {(['maritime_fcl', 'maritime_lcl', 'aerien', 'routier'] as ShipmentMode[]).map((m) => (
                <option key={m} value={m}>{t(`ship.m.${m}` as 'ship.m.aerien')}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('ship.incoterm')}>
            <Select value={draft.incoterm} onChange={(e) => set('incoterm', e.target.value as Incoterm)}>
              {(['EXW', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'] as Incoterm[]).map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
          </Field>
          <Field label={t('ship.from')}>
            <Input value={draft.originPort} onChange={(e) => set('originPort', e.target.value)} />
          </Field>
          <Field label={t('ship.to')}>
            <Input value={draft.destPort} onChange={(e) => set('destPort', e.target.value)} />
          </Field>
          <Field label={t('ship.container')}>
            <Input value={draft.containerNo ?? ''} onChange={(e) => set('containerNo', e.target.value)} />
          </Field>
          <Field label={t('ship.bl')}>
            <Input value={draft.blNumber ?? ''} onChange={(e) => set('blNumber', e.target.value)} />
          </Field>
          <Field label={t('ship.etd')}>
            <Input type="date" value={draft.etd?.slice(0, 10) ?? ''} onChange={(e) => set('etd', e.target.value ? new Date(e.target.value).toISOString() : undefined)} />
          </Field>
          <Field label={t('ship.eta')}>
            <Input type="date" value={draft.eta?.slice(0, 10) ?? ''} onChange={(e) => set('eta', e.target.value ? new Date(e.target.value).toISOString() : undefined)} />
          </Field>
          <Field label={t('ship.packages')}>
            <Input type="number" min={0} value={draft.packages} onChange={(e) => set('packages', Number(e.target.value))} />
          </Field>
          <Field label={t('ship.weight')}>
            <Input type="number" min={0} value={draft.weightKg} onChange={(e) => set('weightKg', Number(e.target.value))} />
          </Field>
          <Field label={t('ship.volume')}>
            <Input type="number" min={0} step={0.1} value={draft.volumeCbm} onChange={(e) => set('volumeCbm', Number(e.target.value))} />
          </Field>
          {v.can('finance:global') && (
            <Field label={t('ship.freight')}>
              <Input type="number" min={0} value={draft.freightCost} onChange={(e) => set('freightCost', Number(e.target.value))} />
            </Field>
          )}
        </div>

        <div className="grid grid--2">
          <Field label={t('ship.stage')}>
            <Select value={draft.status} onChange={(e) => set('status', e.target.value as ShipmentStatus)}>
              {(['en_cours', 'bloquee', 'livree', 'annulee'] as ShipmentStatus[]).map((x) => (
                <option key={x} value={x}>{t(`ship.st.${x}` as 'ship.st.en_cours')}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('misc.office')}>
            <Select value={draft.officeId} onChange={(e) => set('officeId', e.target.value)}>
              {db.agency.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
        </div>

        <Field label={t('caseDetail.notes')}>
          <Textarea value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        <div className="row-between">
          <span className="t-small t-secondary">{tt(draft.goods)}</span>
          <Switch
            checked={draft.status === 'bloquee'}
            onChange={(value) => set('status', value ? 'bloquee' : 'en_cours')}
            label={t('ship.st.bloquee')}
          />
        </div>
      </div>
    </Modal>
  )
}
