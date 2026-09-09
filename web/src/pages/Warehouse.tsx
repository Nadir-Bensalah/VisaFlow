import { useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Empty, Field, Input, Modal, Pill, Progress, Segmented, Select, useToast } from '@/components/ui'
import { ExportButton } from '@/components/ExportButton'
import {
  Erreur, Kpi, KpiGrid, Ligne, PageHeader, Section, Squelette, Table, Toolbar, Vide, useChargement,
} from '@/components/page'
import {
  addMovement, addWarehouse, hasBackend, listMovements, listWarehouses,
  type Warehouse as WarehouseRow, type WarehouseMovement,
} from '@/data/logistique'
import { occupancyPct, stockFromMovements, type MovementDirection } from '@/lib/logistique'
import '@/styles/modules.css'

/**
 * L'entrepôt et ses mouvements.
 *
 * Le stock n'est écrit nulle part : il se recompte à partir des entrées et des
 * sorties. Garder un total à part, c'est se retrouver avec deux chiffres et
 * personne pour dire lequel croire le jour de l'inventaire.
 */

type Sens = 'tous' | MovementDirection

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function Warehouse() {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatDate, formatNumber } = useI18n()
  const toast = useToast()

  const [selected, setSelected] = useState<string>('')
  const [addingWarehouse, setAddingWarehouse] = useState(false)
  const [addingMovement, setAddingMovement] = useState(false)
  const [sens, setSens] = useState<Sens>('tous')
  const [q, setQ] = useState('')

  const canWrite = v.can('shipment:write')

  const entrepots = useChargement(() => (hasBackend ? listWarehouses() : Promise.resolve([] as WarehouseRow[])))
  const liste = useMemo(() => entrepots.data ?? [], [entrepots.data])
  const current = liste.find((w) => w.id === selected) ?? liste[0]
  const currentId = current?.id ?? null

  const mouvements = useChargement(
    () => (hasBackend && currentId ? listMovements(currentId) : Promise.resolve([] as WarehouseMovement[])),
    [currentId],
  )
  const rows = useMemo(() => mouvements.data ?? [], [mouvements.data])

  const stock = useMemo(() => stockFromMovements(rows), [rows])
  const occupancy = occupancyPct(stock.volumeCbm, current?.capacityCbm)

  const reference = (m: WarehouseMovement) => db.shipments.find((s) => s.id === m.shipmentId)?.reference ?? ''

  const montres = useMemo(() => {
    const n = norm(q.trim())
    return rows.filter((m) => {
      if (sens !== 'tous' && m.direction !== sens) return false
      if (!n) return true
      return norm(`${reference(m)} ${m.note ?? ''}`).includes(n)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sens, q, db.shipments])

  const compteSens = useMemo(() => ({
    ENTREE: rows.filter((m) => m.direction === 'ENTREE').length,
    SORTIE: rows.filter((m) => m.direction === 'SORTIE').length,
    TRANSFERT: rows.filter((m) => m.direction === 'TRANSFERT').length,
  }), [rows])

  const toutRecharger = () => { void entrepots.reload(); void mouvements.reload() }
  const refreshing = entrepots.refreshing || mouvements.refreshing
  const premierChargement = (entrepots.loading && !entrepots.data) || (mouvements.loading && !mouvements.data && Boolean(currentId))

  const colonnesExport = [
    { key: 'at', label: t('log.incurredOn'), value: (m: WarehouseMovement) => m.at.slice(0, 16) },
    { key: 'direction', label: t('log.direction'), value: (m: WarehouseMovement) => t(`log.d.${m.direction}` as 'log.d.ENTREE') },
    { key: 'reference', label: t('log.reference'), value: (m: WarehouseMovement) => reference(m) },
    { key: 'packages', label: t('log.packages'), value: (m: WarehouseMovement) => m.packageCount },
    { key: 'weight', label: t('log.weight'), value: (m: WarehouseMovement) => m.weightKg },
    { key: 'volume', label: t('log.volume'), value: (m: WarehouseMovement) => m.volumeCbm },
    { key: 'note', label: t('mq.note'), value: (m: WarehouseMovement) => m.note },
  ]

  const head = (
    <PageHeader
      kicker={t('mq.kickerCargo')}
      title={t('log.warehouse')}
      subtitle={t('mq.warehouseSub')}
      refreshing={refreshing && !premierChargement}
      refreshingLabel={t('mq.refreshing')}
      actions={hasBackend ? <>
        {liste.length > 1 && (
          <Select className="md-select" value={current?.id ?? ''} onChange={(e) => setSelected(e.target.value)} aria-label={t('log.warehouse')}>
            {liste.map((w) => (
              <option key={w.id} value={w.id}>{w.name}{w.active ? '' : ` · ${t('log.closed')}`}</option>
            ))}
          </Select>
        )}
        <ExportButton rows={montres} columns={colonnesExport} base="mouvements" scope="entrepot" disabled={montres.length === 0} />
        <Button icon="refresh" onClick={toutRecharger} disabled={refreshing}>{t('mq.refresh')}</Button>
        {canWrite && <Button icon="plus" onClick={() => setAddingWarehouse(true)}>{t('log.warehouseAdd')}</Button>}
        {canWrite && current && <Button variant="primary" icon="plus" onClick={() => setAddingMovement(true)}>{t('log.movementAdd')}</Button>}
      </> : undefined}
    />
  )

  if (!hasBackend) {
    return (
      <>
        {head}
        <Section><Empty title={t('mq.demoTitle')} hint={t('mq.demoHint')} scene="cargo" /></Section>
      </>
    )
  }

  return (
    <>
      {head}

      {entrepots.error && <Erreur message={entrepots.error} retryLabel={t('mq.retry')} onRetry={toutRecharger} />}
      {mouvements.error && <Erreur message={mouvements.error} retryLabel={t('mq.retry')} onRetry={toutRecharger} />}

      {premierChargement ? (
        <>
          <Squelette type="kpis" n={4} />
          <Section flush><Squelette type="table" n={6} /></Section>
        </>
      ) : !current ? (
        <Section>
          <Empty
            title={t('log.warehouseNone')}
            hint={t('mq.warehouseNoneHint')}
            scene="cargo"
            action={canWrite ? <Button variant="primary" icon="plus" onClick={() => setAddingWarehouse(true)}>{t('log.warehouseAdd')}</Button> : undefined}
          />
        </Section>
      ) : (
        <>
          <KpiGrid>
            <Kpi label={t('log.packages')} value={formatNumber(stock.packages)} icon="box" tone="blue" hint={t('log.stockHint')} />
            <Kpi label={t('log.weight')} value={`${formatNumber(Math.round(stock.weightKg))} kg`} icon="grid" />
            <Kpi label={t('log.volume')} value={`${Math.round(stock.volumeCbm * 1000) / 1000} m³`} icon="ship"
                 hint={current.capacityCbm != null ? t('mq.whCapacityHint', { n: current.capacityCbm }) : undefined} />
            <Kpi label={t('log.occupancy')} value={occupancy != null ? `${occupancy} %` : '·'} icon="building"
                 tone={occupancy != null && occupancy > 90 ? 'orange' : occupancy != null ? 'green' : undefined}
                 hint={occupancy == null ? t('mq.whNoCapacity') : undefined} />
          </KpiGrid>

          <div className="grid grid--main">
            <div className="stack">
              <Section flush>
                <Toolbar right={<><span className="t-caption t-tertiary t-num">{t('mq.rowsOf', { n: montres.length, total: rows.length })}</span><Input className="md-search" value={q} onChange={(e) => setQ(e.target.value)}
                         placeholder={t('mq.whSearch')} aria-label={t('mq.search')} /></>}>
                  <Segmented<Sens>
                    value={sens}
                    onChange={setSens}
                    label={t('log.direction')}
                    options={[
                      { value: 'tous', label: `${t('mq.all')} · ${rows.length}` },
                      { value: 'ENTREE', label: `${t('log.d.ENTREE')} · ${compteSens.ENTREE}` },
                      { value: 'SORTIE', label: `${t('log.d.SORTIE')} · ${compteSens.SORTIE}` },
                      { value: 'TRANSFERT', label: `${t('log.d.TRANSFERT')} · ${compteSens.TRANSFERT}` },
                    ]}
                  />
                </Toolbar>

                {rows.length === 0 ? (
                  <Vide
                    title={t('log.movementsNone')}
                    hint={t('mq.whMovementsNoneHint')}
                    icon="box"
                    action={canWrite ? <Button size="sm" icon="plus" onClick={() => setAddingMovement(true)}>{t('log.movementAdd')}</Button> : undefined}
                  />
                ) : montres.length === 0 ? (
                  <Vide title={t('mq.nothingInFilter')} hint={t('mq.nothingInFilterHint')} icon="search" />
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <th>{t('log.direction')}</th>
                        <th>{t('log.reference')}</th>
                        <th className="num">{t('log.packages')}</th>
                        <th className="num col-optional">{t('log.weight')}</th>
                        <th className="num col-optional">{t('log.volume')}</th>
                        <th className="col-optional">{t('log.incurredOn')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {montres.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <Pill tone={m.direction === 'ENTREE' ? 'green' : m.direction === 'SORTIE' ? 'orange' : 'blue'}>
                              {t(`log.d.${m.direction}` as 'log.d.ENTREE')}
                            </Pill>
                          </td>
                          <td>
                            <div className="adm-cell-main">
                              <span className="t-mono">{reference(m) || <span className="t-tertiary">·</span>}</span>
                              {m.note && <span className="t-caption">{m.note}</span>}
                            </div>
                          </td>
                          <td className="num">{m.packageCount ?? <span className="t-tertiary">·</span>}</td>
                          <td className="num col-optional">{m.weightKg != null ? `${formatNumber(m.weightKg)} kg` : <span className="t-tertiary">·</span>}</td>
                          <td className="num col-optional">{m.volumeCbm != null ? `${m.volumeCbm} m³` : <span className="t-tertiary">·</span>}</td>
                          <td className="col-optional t-tertiary">{formatDate(m.at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Section>
            </div>

            <div className="stack">
              <Section title={current.name} action={!current.active ? <Pill tone="gray">{t('log.closed')}</Pill> : undefined}>
                <Ligne label={t('log.address')}>{[current.address, current.city, current.country].filter(Boolean).join(', ') || '·'}</Ligne>
                <Ligne label={t('log.contactName')}>{[current.contactName, current.contactPhone].filter(Boolean).join(' · ') || '·'}</Ligne>
                <Ligne label={t('log.capacity')}>{current.capacityCbm != null ? `${current.capacityCbm} m³` : '·'}</Ligne>
                {occupancy != null && (
                  <div className="col gap-2" style={{ paddingTop: 'var(--sp-3)' }}>
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
              </Section>
            </div>
          </div>
        </>
      )}

      {addingWarehouse && (
        <WarehouseEditor
          agencyId={db.agency.id}
          officeId={v.officeId ?? db.agency.offices[0]?.id ?? null}
          onClose={() => setAddingWarehouse(false)}
          onSaved={() => { setAddingWarehouse(false); void entrepots.reload(); toast(t('crud.created')) }}
        />
      )}

      {addingMovement && current && (
        <MovementEditor
          agencyId={db.agency.id}
          warehouseId={current.id}
          operatorId={v.user.id}
          onClose={() => setAddingMovement(false)}
          onSaved={() => { setAddingMovement(false); void mouvements.reload(); toast(t('crud.created')) }}
        />
      )}
    </>
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
            <option value="">·</option>
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
