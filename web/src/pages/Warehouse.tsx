import { useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Field, Input, Modal, Pill, Progress, Select, useToast } from '@/components/ui'
import { PageHead } from '@/components/bits'
import {
  addMovement, addWarehouse, hasBackend, listMovements, listWarehouses, useRemote,
  type Warehouse as WarehouseRow, type WarehouseMovement,
} from '@/data/logistique'
import { occupancyPct, stockFromMovements, type MovementDirection } from '@/lib/logistique'

/**
 * L'entrepôt et ses mouvements.
 *
 * Le stock n'est écrit nulle part : il se recompte à partir des entrées et des
 * sorties. Garder un total à part, c'est se retrouver avec deux chiffres et
 * personne pour dire lequel croire le jour de l'inventaire.
 */
export function Warehouse() {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatDate, formatNumber } = useI18n()
  const toast = useToast()

  const [selected, setSelected] = useState<string>('')
  const [addingWarehouse, setAddingWarehouse] = useState(false)
  const [addingMovement, setAddingMovement] = useState(false)

  const warehouses = useRemote<WarehouseRow[]>('warehouses', () => listWarehouses(), [])
  const current = warehouses.data.find((w) => w.id === selected) ?? warehouses.data[0]

  const movements = useRemote<WarehouseMovement[]>(
    `movements:${current?.id ?? 'aucun'}`,
    () => (current ? listMovements(current.id) : Promise.resolve([])),
    [],
  )

  const stock = stockFromMovements(movements.data)
  const occupancy = occupancyPct(stock.volumeCbm, current?.capacityCbm)

  return (
    <>
      <PageHead
        title={t('log.warehouse')}
        subtitle={t('log.warehouseHint')}
        action={
          <div className="row gap-2">
            {warehouses.data.length > 1 && (
              <Select
                value={current?.id ?? ''}
                onChange={(e) => setSelected(e.target.value)}
                aria-label={t('log.warehouse')}
              >
                {warehouses.data.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}{w.active ? '' : ` · ${t('log.closed')}`}</option>
                ))}
              </Select>
            )}
            {v.can('shipment:write') && hasBackend && (
              <Button icon="plus" onClick={() => setAddingWarehouse(true)}>{t('log.warehouseAdd')}</Button>
            )}
          </div>
        }
      />

      {!hasBackend && (
        <Card title={t('log.warehouse')}><p className="t-small t-tertiary">{t('log.offline')}</p></Card>
      )}

      {hasBackend && warehouses.data.length === 0 && !warehouses.busy && (
        <Empty title={t('log.warehouseNone')} scene="vide" />
      )}

      {current && (
        <div className="grid grid--main">
          <div className="stack">
            <Card
              title={t('log.movements')}
              action={
                v.can('shipment:write')
                  ? <Button size="sm" icon="plus" onClick={() => setAddingMovement(true)}>{t('log.movementAdd')}</Button>
                  : undefined
              }
              flush
            >
              {movements.error && <p className="t-small t-red" style={{ padding: 'var(--sp-4)' }}>{movements.error}</p>}

              {movements.data.length === 0 && !movements.busy ? (
                <div style={{ padding: 'var(--sp-5)' }}>
                  <Empty title={t('log.movementsNone')} scene="vide" />
                </div>
              ) : (
                <div className="tablewrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('log.direction')}</th>
                        <th>{t('log.reference')}</th>
                        <th className="num">{t('log.packages')}</th>
                        <th className="num">{t('log.weight')}</th>
                        <th className="num">{t('log.volume')}</th>
                        <th>{t('log.incurredOn')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.data.map((m) => {
                        const shipment = db.shipments.find((s) => s.id === m.shipmentId)
                        return (
                          <tr key={m.id}>
                            <td>
                              <Pill tone={m.direction === 'ENTREE' ? 'green' : m.direction === 'SORTIE' ? 'orange' : 'blue'}>
                                {t(`log.d.${m.direction}` as 'log.d.ENTREE')}
                              </Pill>
                            </td>
                            <td className="t-small">{shipment?.reference ?? '—'}</td>
                            <td className="num t-small t-num">{m.packageCount ?? '—'}</td>
                            <td className="num t-small t-num">{m.weightKg != null ? `${formatNumber(m.weightKg)} kg` : '—'}</td>
                            <td className="num t-small t-num">{m.volumeCbm != null ? `${m.volumeCbm} m³` : '—'}</td>
                            <td className="t-small t-tertiary">{formatDate(m.at)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <div className="stack">
            <Card title={current.name}>
              <div className="col gap-4">
                <Row label={t('log.address')} value={[current.address, current.city, current.country].filter(Boolean).join(', ') || '—'} />
                <Row label={t('log.contactName')} value={[current.contactName, current.contactPhone].filter(Boolean).join(' · ') || '—'} />
                <Row label={t('log.capacity')} value={current.capacityCbm != null ? `${current.capacityCbm} m³` : '—'} />
                {!current.active && <Pill tone="gray">{t('log.closed')}</Pill>}
              </div>
            </Card>

            <Card title={t('log.stock')}>
              <div className="col gap-4">
                <p className="t-caption t-tertiary">{t('log.stockHint')}</p>
                <Row label={t('log.packages')} value={formatNumber(stock.packages)} />
                <Row label={t('log.weight')} value={`${formatNumber(Math.round(stock.weightKg))} kg`} />
                <Row label={t('log.volume')} value={`${Math.round(stock.volumeCbm * 1000) / 1000} m³`} />
                {occupancy != null && (
                  <div className="col gap-2">
                    <div className="row-between">
                      <span className="t-small t-secondary">{t('log.occupancy')}</span>
                      <span className="t-small t-num">{occupancy} %</span>
                    </div>
                    <Progress
                      pct={occupancy}
                      tone={occupancy > 90 ? 'orange' : 'green'}
                      label={t('log.occupancy')}
                      valueText={`${occupancy} %`}
                    />
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {addingWarehouse && (
        <WarehouseEditor
          agencyId={db.agency.id}
          officeId={v.officeId ?? db.agency.offices[0]?.id ?? null}
          onClose={() => setAddingWarehouse(false)}
          onSaved={() => { setAddingWarehouse(false); warehouses.reload(); toast(t('crud.created')) }}
        />
      )}

      {addingMovement && current && (
        <MovementEditor
          agencyId={db.agency.id}
          warehouseId={current.id}
          operatorId={v.user.id}
          onClose={() => setAddingMovement(false)}
          onSaved={() => { setAddingMovement(false); movements.reload(); toast(t('crud.created')) }}
        />
      )}
    </>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="row-between">
      <span className="t-small t-secondary">{label}</span>
      <span className="t-small" style={{ textAlign: 'end' }}>{value}</span>
    </div>
  )
}

function WarehouseEditor({ agencyId, officeId, onClose, onSaved }: {
  agencyId: string
  officeId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [capacity, setCapacity] = useState('')
  const [contact, setContact] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await addWarehouse({
        agencyId,
        officeId,
        name,
        address: address || null,
        city: city || null,
        capacityCbm: capacity === '' ? null : Number(capacity),
        contactName: contact || null,
        contactPhone: phone || null,
        active: true,
      })
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <Modal
      title={t('log.warehouseAdd')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={busy || !name} onClick={() => void save()}>{t('action.save')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label={t('log.warehouse')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t('log.address')}>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label={t('log.place')}>
          <Input value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field label={t('log.capacity')}>
          <Input type="number" step="0.001" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </Field>
        <Field label={t('log.contactName')}>
          <Input value={contact} onChange={(e) => setContact(e.target.value)} />
        </Field>
        <Field label={t('log.contact')}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function MovementEditor({ agencyId, warehouseId, operatorId, onClose, onSaved }: {
  agencyId: string
  warehouseId: string
  operatorId: string
  onClose: () => void
  onSaved: () => void
}) {
  const v = useVisible()
  const { t } = useI18n()
  const toast = useToast()
  const [direction, setDirection] = useState<MovementDirection>('ENTREE')
  const [shipmentId, setShipmentId] = useState('')
  const [packages, setPackages] = useState('')
  const [weight, setWeight] = useState('')
  const [volume, setVolume] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await addMovement({
        agencyId,
        warehouseId,
        shipmentId: shipmentId || null,
        direction,
        packageCount: packages === '' ? null : Number(packages),
        weightKg: weight === '' ? null : Number(weight),
        volumeCbm: volume === '' ? null : Number(volume),
        at: new Date().toISOString(),
        operatorId,
      })
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <Modal
      title={t('log.movementAdd')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>{t('action.save')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label={t('log.direction')}>
          <Select value={direction} onChange={(e) => setDirection(e.target.value as MovementDirection)}>
            <option value="ENTREE">{t('log.d.ENTREE')}</option>
            <option value="SORTIE">{t('log.d.SORTIE')}</option>
            <option value="TRANSFERT">{t('log.d.TRANSFERT')}</option>
          </Select>
        </Field>
        <Field label={t('log.reference')}>
          <Select value={shipmentId} onChange={(e) => setShipmentId(e.target.value)}>
            <option value="">—</option>
            {v.shipments.map((s) => (
              <option key={s.id} value={s.id}>{s.reference}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('log.packages')}>
          <Input type="number" min={0} value={packages} onChange={(e) => setPackages(e.target.value)} />
        </Field>
        <Field label={t('log.weight')}>
          <Input type="number" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
        <Field label={t('log.volume')}>
          <Input type="number" step="0.001" value={volume} onChange={(e) => setVolume(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
