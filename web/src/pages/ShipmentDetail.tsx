import { Link, useParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { useState } from 'react'
import { Avatar, Button, Card, Empty, Pill, Progress, useToast } from '@/components/ui'
import { ShipmentEditor } from '@/components/ShipmentEditor'
import { Icon } from '@/components/Icon'
import { Ago, Countdown, DocPill, PageHead } from '@/components/bits'
import { SHIPMENT_STAGES, SHIPMENT_TONE, clientName, shipmentLate, shipmentProgress } from '@/lib/derive'

export function ShipmentDetail() {
  const { id = '' } = useParams()
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt, formatDate, formatMoney, formatNumber } = useI18n()
  const toast = useToast()
  const [editing, setEditing] = useState(false)

  const shipment = v.shipments.find((s) => s.id === id)
  if (!shipment) return <Empty title={t('ship.none')} action={<Link to="/cargaisons" className="btn btn--secondary">{t('action.back')}</Link>} />

  const client = db.clients.find((c) => c.id === shipment.clientId)!
  const docs = db.shipmentDocs.filter((d) => d.shipmentId === shipment.id)
  const events = db.shipmentEvents.filter((e) => e.shipmentId === shipment.id).sort((a, b) => b.at.localeCompare(a.at))
  const currentIndex = SHIPMENT_STAGES.indexOf(shipment.stage)
  const linkedCase = shipment.caseId ? db.cases.find((c) => c.id === shipment.caseId) : undefined
  const portalUrl = `${window.location.origin}${import.meta.env.BASE_URL}portail/cargaison/${shipment.portalToken}`

  return (
    <>
      <PageHead
        title={`${shipment.originPort} → ${shipment.destPort}`}
        subtitle={`${shipment.reference} · ${tt(shipment.goods)} · ${shipment.supplier}`}
        action={
          <div className="row gap-2">
            {v.can('shipment:write') && <Button icon="edit" onClick={() => setEditing(true)}>{t('crud.edit')}</Button>}
            <Button
              icon="copy"
              onClick={async () => {
                try { await navigator.clipboard.writeText(portalUrl); toast(t('action.copied')) } catch { toast(portalUrl) }
              }}
            >
              {t('caseDetail.portalLink')}
            </Button>
            {shipment.status === 'en_cours' && v.can('shipment:write') && (
              <Button variant="primary" icon="arrow" onClick={() => { actions.advanceShipment(shipment.id); toast(t('ship.advance')) }}>
                {t('ship.advance')}
              </Button>
            )}
          </div>
        }
      />

      {editing && <ShipmentEditor shipment={shipment} onClose={() => setEditing(false)} />}

      <div className="grid grid--main">
        <div className="stack">
          <Card title={t('ship.milestones')}>
            <div className="col gap-5">
              <Progress pct={shipmentProgress(shipment)} tone={shipment.stage === 'livre' ? 'green' : undefined} />
              <ul className="timeline">
                {SHIPMENT_STAGES.map((stage, i) => {
                  const event = events.find((e) => e.stage === stage)
                  return (
                    <li key={stage} className="timeline__item">
                      <span className={`timeline__dot ${i < currentIndex ? 'timeline__dot--done' : i === currentIndex ? 'timeline__dot--current' : ''}`} />
                      <div className="row-between wrap gap-2">
                        <div className="col">
                          <span className={i === currentIndex ? 't-medium' : 't-secondary'} style={{ fontSize: 14 }}>
                            {t(`ship.s.${stage}` as 'ship.s.transit')}
                          </span>
                          {event && <span className="t-caption t-tertiary">{event.location}</span>}
                        </div>
                        {event && <span className="t-caption t-tertiary"><Ago iso={event.at} /></span>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </Card>

          <Card title={t('ship.docs')} flush>
            <div className="list">
              {docs.map((d) => (
                <div key={d.id} className="list__row">
                  <Icon name="documents" size={18} className="t-tertiary" />
                  <span className="col grow" style={{ minWidth: 0 }}>
                    <span className="t-small t-medium">{tt(d.label)}</span>
                    <span className="t-caption t-tertiary">{d.fileName ?? t('portal.uploadHint')}</span>
                  </span>
                  <DocPill state={d.state} />
                  {d.state !== 'validee' && (
                    <Button
                      size="sm"
                      onClick={() => { actions.setShipmentDocState(d.id, d.state === 'manquante' ? 'demandee' : 'validee'); toast(t('action.save')) }}
                    >
                      {d.state === 'manquante' ? t('action.request') : t('action.validate')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title={t('ship.tracking')}>
            <div className="col gap-4">
              <div className="row-between">
                <span className="t-small t-secondary">{t('ship.stage')}</span>
                <Pill tone={SHIPMENT_TONE[shipment.stage]} dot>{t(`ship.s.${shipment.stage}` as 'ship.s.transit')}</Pill>
              </div>
              <Row label={t('ship.mode')} value={t(`ship.m.${shipment.mode}` as 'ship.m.aerien')} />
              <Row label={t('ship.from')} value={`${shipment.originCity} · ${shipment.originPort}`} />
              <Row label={t('ship.to')} value={`${shipment.destCity} · ${shipment.destPort}`} />
              <Row label={t('ship.etd')} value={formatDate(shipment.etd)} />
              <Row
                label={t('ship.eta')}
                value={shipment.status === 'en_cours'
                  ? <span style={{ color: shipmentLate(shipment) ? 'var(--red)' : undefined }}><Countdown iso={shipment.eta} /></span>
                  : formatDate(shipment.deliveredAt ?? shipment.eta)}
              />
              {shipment.containerNo && <Row label={t('ship.container')} value={<span className="t-mono">{shipment.containerNo}</span>} />}
              {shipment.blNumber && <Row label={t('ship.bl')} value={<span className="t-mono">{shipment.blNumber}</span>} />}
              <Row label={t('ship.incoterm')} value={shipment.incoterm} />
            </div>
          </Card>

          <Card title={t('ship.goods')}>
            <div className="col gap-4">
              <Row label={t('ship.supplier')} value={shipment.supplier} />
              <Row label={t('ship.packages')} value={formatNumber(shipment.packages)} />
              <Row label={t('ship.weight')} value={`${formatNumber(shipment.weightKg)} kg`} />
              <Row label={t('ship.volume')} value={`${shipment.volumeCbm} m³`} />
              <hr className="divider" style={{ margin: 0 }} />
              {v.can('finance:global') && <Row label={t('ship.freight')} value={formatMoney(shipment.freightCost)} />}
              {v.can('finance:global') && shipment.customsDuty !== undefined && <Row label={t('ship.duty')} value={formatMoney(shipment.customsDuty)} />}
              {v.can('finance:global') && <Row label={t('ship.value')} value={formatMoney(shipment.declaredValue)} />}
              <Row
                label={t('cases.balance')}
                value={shipment.freightCost - shipment.amountPaid > 0 ? formatMoney(shipment.freightCost - shipment.amountPaid) : t('payment.regle')}
              />
            </div>
          </Card>

          <Card title={t('cases.client')} action={<Link to={`/clients/${client.id}`} className="t-small">{t('action.open')}</Link>}>
            <div className="row gap-3">
              <Avatar name={clientName(db, client.id)} />
              <div className="col grow">
                <span className="t-medium t-small">{client.firstName} {client.lastName}</span>
                <span className="t-caption t-tertiary t-mono">{client.phone}</span>
              </div>
            </div>
            {linkedCase && (
              <Link to={`/dossiers/${linkedCase.id}`} className="row gap-2 t-small" style={{ marginTop: 'var(--sp-4)' }}>
                <Icon name="passport" size={16} />
                {t('ship.linkedCase')} · {linkedCase.reference}
              </Link>
            )}
          </Card>

          {shipment.notes && (
            <Card title={t('caseDetail.notes')}>
              <p className="t-small t-secondary">{shipment.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="row-between">
      <span className="t-small t-secondary">{label}</span>
      <span className="t-small" style={{ textAlign: 'end' }}>{value ?? '—'}</span>
    </div>
  )
}
