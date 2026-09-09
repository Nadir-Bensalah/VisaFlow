import { useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Card, Field, Input, Modal, Pill, Select, useToast } from '@/components/ui'
import { Vide } from '@/components/page'
import { Icon } from '@/components/Icon'
import {
  addAirWaybill, addOriginCertificate, addRoadShipment, hasBackend,
  listAirWaybills, listOriginCertificates, listRoadShipments, useRemote,
  type AirWaybill, type OriginCertificate, type RoadShipment,
} from '@/data/logistique'
import {
  airChargeableWeight, airVolumeDecides, originCertificateWarning,
  type OriginCertificateKind,
} from '@/lib/logistique'

/**
 * Les trois papiers qui manquent toujours quand la douane appelle : la lettre
 * de transport aérien, la CMR du camion, et le certificat d'origine.
 *
 * Le poids taxable aérien est affiché à côté du poids réel. Ils diffèrent dès
 * qu'un envoi est encombrant, et c'est le taxable qui est facturé.
 */
export function TransportDocsCard({ shipmentId }: { shipmentId: string }) {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatDate, formatNumber } = useI18n()
  const toast = useToast()
  const [adding, setAdding] = useState<'awb' | 'road' | 'origin' | null>(null)

  const awbs = useRemote<AirWaybill[]>(`awb:${shipmentId}`, () => listAirWaybills(shipmentId), [])
  const roads = useRemote<RoadShipment[]>(`road:${shipmentId}`, () => listRoadShipments(shipmentId), [])
  const certs = useRemote<OriginCertificate[]>(`origin:${shipmentId}`, () => listOriginCertificates(shipmentId), [])

  const shipment = db.shipments.find((s) => s.id === shipmentId)
  const volumeCbm = shipment?.volumeCbm

  return (
    <Card title={t('log.transportDocs')}>
      {!hasBackend && <Vide icon="alert" title={t('log.offline')} />}

      {/* Sans serveur, une seule ligne : trois sections vides feraient une colonne de « aucun ». */}
      {hasBackend && (
      <>

      {/* ---------------- Lettre de transport aérien ---------------- */}
      <div className="row-between" style={{ marginBottom: 'var(--sp-2)' }}>
        <span className="t-small t-medium">{t('log.awb')}</span>
        {v.can('shipment:write') && hasBackend && (
          <Button size="sm" icon="plus" onClick={() => setAdding('awb')}>{t('crud.add')}</Button>
        )}
      </div>
      {awbs.data.length === 0 ? (
        <p className="t-caption t-tertiary">{t('log.awbNone')}</p>
      ) : (
        <div className="list">
          {awbs.data.map((a) => {
            const chargeable = a.chargeableWeightKg ?? airChargeableWeight(a.weightKg, volumeCbm)
            const byVolume = airVolumeDecides(a.weightKg, volumeCbm)
            return (
              <div key={a.id} className="list__row">
                <Icon name="plane" size={18} className="t-tertiary" />
                <span className="col grow gap-1" style={{ minWidth: 0 }}>
                  <span className="t-small t-medium t-mono">{a.awbNumber}</span>
                  <span className="t-caption t-tertiary">
                    {[a.airline, a.flightNumber,
                      a.airportOrigin && a.airportDestination ? `${a.airportOrigin} → ${a.airportDestination}` : null,
                      formatDate(a.departureDate ?? undefined)].filter(Boolean).join(' · ')}
                  </span>
                  {/* Le taxable, à côté du réel : c'est le taxable qu'on paye. */}
                  <span className="t-caption t-tertiary" title={t('log.chargeableHint')}>
                    {t('log.weight')} {formatNumber(a.weightKg ?? 0)} kg · {t('log.chargeable')}{' '}
                    <span className="t-medium">{formatNumber(chargeable)} kg</span>
                    {a.chargeableWeightKg == null ? ` · ${byVolume ? t('log.byVolume') : t('log.byWeight')}` : ''}
                  </span>
                </span>
                <Pill tone={a.kind === 'MASTER' ? 'violet' : 'blue'}>
                  {a.kind === 'MASTER' ? t('log.master') : t('log.house')}
                </Pill>
              </div>
            )
          })}
        </div>
      )}

      <hr className="divider" style={{ margin: 'var(--sp-4) 0' }} />

      {/* ---------------- Routier ---------------- */}
      <div className="row-between" style={{ marginBottom: 'var(--sp-2)' }}>
        <span className="t-small t-medium">{t('log.road')}</span>
        {v.can('shipment:write') && hasBackend && (
          <Button size="sm" icon="plus" onClick={() => setAdding('road')}>{t('crud.add')}</Button>
        )}
      </div>
      {roads.data.length === 0 ? (
        <p className="t-caption t-tertiary">{t('log.roadNone')}</p>
      ) : (
        <div className="list">
          {roads.data.map((r) => (
            <div key={r.id} className="list__row">
              <Icon name="box" size={18} className="t-tertiary" />
              <span className="col grow gap-1" style={{ minWidth: 0 }}>
                <span className="t-small t-medium">
                  {r.carrierName ?? '·'}
                  {r.cmrNumber ? <span className="t-mono t-tertiary"> · {t('log.cmr')} {r.cmrNumber}</span> : null}
                </span>
                <span className="t-caption t-tertiary t-mono">
                  {[r.truckRegistration, r.trailerRegistration].filter(Boolean).join(' + ') || '·'}
                </span>
                {/* Le chauffeur et son numéro : c'est ce qu'on cherche quand la
                    douane appelle, et qu'on ne trouve jamais. */}
                <span className="t-caption t-tertiary">
                  {[r.driverName, r.driverPhone, r.borderCrossing].filter(Boolean).join(' · ') || '·'}
                </span>
              </span>
              <span className="t-caption t-tertiary">{formatDate(r.departureAt ?? undefined)}</span>
            </div>
          ))}
        </div>
      )}

      <hr className="divider" style={{ margin: 'var(--sp-4) 0' }} />

      {/* ---------------- Certificats d'origine ---------------- */}
      <div className="row-between" style={{ marginBottom: 'var(--sp-2)' }}>
        <span className="t-small t-medium">{t('log.origin')}</span>
        {v.can('shipment:write') && hasBackend && (
          <Button size="sm" icon="plus" onClick={() => setAdding('origin')}>{t('crud.add')}</Button>
        )}
      </div>
      {certs.data.length === 0 ? (
        <p className="t-caption t-tertiary">{t('log.originNone')}</p>
      ) : (
        <div className="list">
          {certs.data.map((c) => {
            const warn = originCertificateWarning(c.kind, c.originCountry ?? undefined)
            return (
              <div key={c.id} className="list__row">
                <Icon name="documents" size={18} className="t-tertiary" />
                <span className="col grow gap-1" style={{ minWidth: 0 }}>
                  <span className="t-small t-medium">
                    {t(`log.o.${c.kind}` as 'log.o.EUR1')}
                    {c.reference ? <span className="t-mono t-tertiary"> · {c.reference}</span> : null}
                  </span>
                  <span className="t-caption t-tertiary">
                    {[c.originCountry, c.issuer, formatDate(c.issueDate ?? undefined)].filter(Boolean).join(' · ')}
                  </span>
                  {/* Avertir, jamais bloquer : la base a enregistré la saisie,
                      c'est ici qu'on dit qu'elle mérite un second regard. */}
                  {warn && (
                    <span className="fret__warn">
                      <Icon name="alert" size={14} />
                      <span>{t('log.originWarning')}</span>
                    </span>
                  )}
                </span>
                <Pill tone={c.status === 'obtenu' ? 'green' : c.status === 'refuse' ? 'red' : 'gray'}>
                  {t(`log.os.${c.status}` as 'log.os.obtenu')}
                </Pill>
              </div>
            )
          })}
        </div>
      )}
      </>
      )}


      {adding === 'awb' && (
        <AwbEditor
          shipmentId={shipmentId}
          agencyId={db.agency.id}
          onClose={() => setAdding(null)}
          onSaved={() => { setAdding(null); awbs.reload(); toast(t('crud.created')) }}
        />
      )}
      {adding === 'road' && (
        <RoadEditor
          shipmentId={shipmentId}
          agencyId={db.agency.id}
          onClose={() => setAdding(null)}
          onSaved={() => { setAdding(null); roads.reload(); toast(t('crud.created')) }}
        />
      )}
      {adding === 'origin' && (
        <OriginEditor
          shipmentId={shipmentId}
          agencyId={db.agency.id}
          onClose={() => setAdding(null)}
          onSaved={() => { setAdding(null); certs.reload(); toast(t('crud.created')) }}
        />
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */

function AwbEditor({ shipmentId, agencyId, onClose, onSaved }: {
  shipmentId: string; agencyId: string; onClose: () => void; onSaved: () => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [number, setNumber] = useState('')
  const [kind, setKind] = useState<'MASTER' | 'HOUSE'>('HOUSE')
  const [airline, setAirline] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [flight, setFlight] = useState('')
  const [pieces, setPieces] = useState('')
  const [weight, setWeight] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await addAirWaybill({
        agencyId, shipmentId,
        awbNumber: number, kind,
        airline: airline || null,
        airportOrigin: from || null,
        airportDestination: to || null,
        flightNumber: flight || null,
        pieces: pieces === '' ? null : Number(pieces),
        weightKg: weight === '' ? null : Number(weight),
        // Le poids taxable est laissé vide : la base le calcule avec le volume
        // de la cargaison, par la règle IATA. Une seule formule, un seul endroit.
      })
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <Modal
      title={t('log.awb')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={busy || !number} onClick={() => void save()}>{t('action.save')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label={t('log.awbNumber')}>
          <Input value={number} onChange={(e) => setNumber(e.target.value)} />
        </Field>
        <Field label={t('log.awb')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as 'MASTER' | 'HOUSE')}>
            <option value="MASTER">{t('log.master')}</option>
            <option value="HOUSE">{t('log.house')}</option>
          </Select>
        </Field>
        <Field label={t('log.airline')}>
          <Input value={airline} onChange={(e) => setAirline(e.target.value)} />
        </Field>
        <Field label={t('log.departure')}>
          <Input value={from} onChange={(e) => setFrom(e.target.value.toUpperCase())} maxLength={3} />
        </Field>
        <Field label={t('log.arrival2')}>
          <Input value={to} onChange={(e) => setTo(e.target.value.toUpperCase())} maxLength={3} />
        </Field>
        <Field label={t('log.flight')}>
          <Input value={flight} onChange={(e) => setFlight(e.target.value)} />
        </Field>
        <Field label={t('log.pieces')}>
          <Input type="number" min={0} value={pieces} onChange={(e) => setPieces(e.target.value)} />
        </Field>
        <Field label={t('log.weight')} hint={t('log.chargeableHint')}>
          <Input type="number" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function RoadEditor({ shipmentId, agencyId, onClose, onSaved }: {
  shipmentId: string; agencyId: string; onClose: () => void; onSaved: () => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [carrier, setCarrier] = useState('')
  const [truck, setTruck] = useState('')
  const [trailer, setTrailer] = useState('')
  const [driver, setDriver] = useState('')
  const [phone, setPhone] = useState('')
  const [cmr, setCmr] = useState('')
  const [border, setBorder] = useState('')
  const [departure, setDeparture] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await addRoadShipment({
        agencyId, shipmentId,
        carrierName: carrier || null,
        truckRegistration: truck || null,
        trailerRegistration: trailer || null,
        driverName: driver || null,
        driverPhone: phone || null,
        cmrNumber: cmr || null,
        borderCrossing: border || null,
        departureAt: departure ? new Date(departure).toISOString() : null,
      })
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <Modal
      title={t('log.road')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>{t('action.save')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label={t('log.carrier')}>
          <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
        </Field>
        <Field label={t('log.truck')}>
          <Input value={truck} onChange={(e) => setTruck(e.target.value)} />
        </Field>
        <Field label={t('log.trailer')}>
          <Input value={trailer} onChange={(e) => setTrailer(e.target.value)} />
        </Field>
        <Field label={t('log.driver')}>
          <Input value={driver} onChange={(e) => setDriver(e.target.value)} />
        </Field>
        <Field label={t('equipe.phone')}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={t('log.cmr')}>
          <Input value={cmr} onChange={(e) => setCmr(e.target.value)} />
        </Field>
        <Field label={t('log.border')}>
          <Input value={border} onChange={(e) => setBorder(e.target.value)} />
        </Field>
        <Field label={t('log.departure')}>
          <Input type="date" value={departure} onChange={(e) => setDeparture(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function OriginEditor({ shipmentId, agencyId, onClose, onSaved }: {
  shipmentId: string; agencyId: string; onClose: () => void; onSaved: () => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [kind, setKind] = useState<OriginCertificateKind>('CERTIFICAT_ORIGINE')
  const [origin, setOrigin] = useState('')
  const [reference, setReference] = useState('')
  const [issuer, setIssuer] = useState('')
  const [issueDate, setIssueDate] = useState('')
  const [busy, setBusy] = useState(false)

  // On avertit AVANT d'enregistrer, et on enregistre quand même : l'agence
  // peut avoir une raison, et une saisie bloquée se recopie hors de vue.
  const warn = originCertificateWarning(kind, origin)

  const save = async () => {
    setBusy(true)
    try {
      await addOriginCertificate({
        agencyId, shipmentId, kind,
        originCountry: origin ? origin.toUpperCase().slice(0, 2) : null,
        reference: reference || null,
        issuer: issuer || null,
        issueDate: issueDate || null,
        status: 'demande',
      })
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <Modal
      title={t('log.origin')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>{t('action.save')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label={t('log.origin')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as OriginCertificateKind)}>
            {(['EUR1', 'EURMED', 'ORIGINE_ARABE', 'CERTIFICAT_ORIGINE', 'DECLARATION_FACTURE', 'AUTRE'] as const).map((k) => (
              <option key={k} value={k}>{t(`log.o.${k}` as 'log.o.EUR1')}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('log.originCountry')} error={warn ? t('log.originWarning') : undefined}>
          <Input value={origin} maxLength={2} onChange={(e) => setOrigin(e.target.value.toUpperCase())} />
        </Field>
        <Field label={t('log.reference')}>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label={t('log.issuer')}>
          <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} />
        </Field>
        <Field label={t('log.issued')}>
          <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
