import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Field, Input, Modal, Pill, Select, Textarea, useToast } from '@/components/ui'
import { FileDrop } from '@/components/FileDrop'
import { PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'
import {
  addProof, deliveryPlan, hasBackend, updateDelivery, uploadLogisticsFile, useRemote,
  type PlannedDelivery,
} from '@/data/logistique'
import { DELIVERY_TONE } from '@/lib/logistique'

/**
 * Le plan de livraison du jour.
 *
 * C'est la feuille qu'on donne au chauffeur le matin et qu'on relit le soir :
 * l'adresse, à qui s'annoncer, où en est chaque course. Une livraison ratée
 * sans raison écrite repart le lendemain avec la même adresse fausse, et
 * l'agence paye deux fois la même tournée.
 */
export function Deliveries() {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatDate } = useI18n()
  const toast = useToast()

  const offices = db.agency.offices
  const [officeId, setOfficeId] = useState(v.officeId ?? offices[0]?.id ?? '')
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10))
  const [signing, setSigning] = useState<PlannedDelivery | null>(null)
  const [failing, setFailing] = useState<PlannedDelivery | null>(null)

  // Un agent ne choisit rien : il ne voit que son bureau, et le serveur
  // applique la même règle dans sa politique.
  const canChooseOffice = v.scope === 'agence'

  const plan = useRemote<PlannedDelivery[]>(
    `plan:${officeId}:${day}`,
    () => (officeId ? deliveryPlan(officeId, day) : Promise.resolve([])),
    [],
  )

  const done = plan.data.filter((d) => d.status === 'livree').length

  return (
    <>
      <PageHead
        title={t('log.deliveries')}
        subtitle={t('log.deliveriesHint')}
        action={
          <div className="row gap-2">
            {canChooseOffice && offices.length > 1 && (
              <Select value={officeId} onChange={(e) => setOfficeId(e.target.value)} aria-label={t('misc.office')}>
                {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            )}
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label={t('log.day')} />
            <Button icon="today" onClick={() => setDay(new Date().toISOString().slice(0, 10))}>
              {t('log.today')}
            </Button>
          </div>
        }
      />

      {!hasBackend && (
        <Card title={t('log.plan')}><p className="t-small t-tertiary">{t('log.offline')}</p></Card>
      )}

      {hasBackend && !officeId && (
        <Empty title={t('log.noOffice')} />
      )}

      {hasBackend && officeId && (
        <Card
          title={t('log.plan')}
          action={
            <span className="t-caption t-tertiary">
              {formatDate(day)} · {done}/{plan.data.length}
            </span>
          }
          flush
        >
          {plan.error && <p className="t-small t-red" style={{ padding: 'var(--sp-4)' }}>{plan.error}</p>}

          {plan.data.length === 0 && !plan.busy ? (
            <div style={{ padding: 'var(--sp-5)' }}>
              <Empty title={t('log.planNone')} scene="vide" />
            </div>
          ) : (
            <div className="list">
              {plan.data.map((d) => (
                <div key={d.id} className="list__row">
                  <Icon name="box" size={18} className="t-tertiary" />

                  <span className="col grow gap-1" style={{ minWidth: 0 }}>
                    <span className="t-small t-medium">{d.client ?? d.reference ?? '—'}</span>
                    <span className="t-caption t-tertiary">{d.address ?? '—'}</span>
                    <span className="t-caption t-tertiary">
                      {[d.contactName, d.contactPhone, d.vehicle, d.driverName].filter(Boolean).join(' · ')}
                    </span>
                    {/* Pourquoi la course a échoué. Sans ça, on recommence. */}
                    {d.failureReason && (
                      <span className="t-caption t-red">{d.failureReason}</span>
                    )}
                    {d.proof?.signedAt && (
                      <span className="t-caption t-tertiary">
                        {t('log.signedAt')} {formatDate(d.proof.signedAt)}
                        {d.proof.recipientName ? ` · ${d.proof.recipientName}` : ''}
                      </span>
                    )}
                    {d.shipmentId && (
                      <Link to={`/cargaisons/${d.shipmentId}`} className="t-caption">
                        {d.reference ?? t('action.open')}
                      </Link>
                    )}
                  </span>

                  <Pill tone={DELIVERY_TONE[d.status]} dot>
                    {t(`log.s.${d.status}` as 'log.s.livree')}
                  </Pill>

                  {v.can('shipment:write') && d.status !== 'livree' && (
                    <div className="row gap-2">
                      <Button size="sm" variant="primary" onClick={() => setSigning(d)}>
                        {t('log.proofAdd')}
                      </Button>
                      <Button size="sm" onClick={() => setFailing(d)}>{t('log.markFailed')}</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {signing && (
        <ProofEditor
          delivery={signing}
          agencyId={db.agency.id}
          onClose={() => setSigning(null)}
          onSaved={() => { setSigning(null); plan.reload(); toast(t('crud.updated')) }}
        />
      )}

      {failing && (
        <FailureEditor
          delivery={failing}
          onClose={() => setFailing(null)}
          onSaved={() => { setFailing(null); plan.reload(); toast(t('crud.updated')) }}
        />
      )}
    </>
  )
}

/**
 * La signature de la livraison.
 *
 * Une preuve s'ajoute, elle ne se modifie jamais : la base refuse toute mise à
 * jour. Corriger, c'est ajouter une seconde preuve. L'écran le dit, pour que
 * personne ne cherche un bouton « modifier » qui n'existera pas.
 */
function ProofEditor({ delivery, agencyId, onClose, onSaved }: {
  delivery: PlannedDelivery
  agencyId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [recipient, setRecipient] = useState(delivery.contactName ?? '')
  const [idNumber, setIdNumber] = useState('')
  const [signaturePath, setSignaturePath] = useState<string | null>(null)
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await addProof({
        agencyId,
        deliveryId: delivery.id,
        recipientName: recipient || null,
        recipientIdNumber: idNumber || null,
        signaturePath,
        photoPath,
        signedAt: new Date().toISOString(),
      })
      // La preuve d'abord, l'état ensuite : si l'enregistrement de la preuve
      // échoue, la livraison ne doit pas être marquée livrée pour autant.
      await updateDelivery(delivery.id, { status: 'livree', deliveredAt: new Date().toISOString() })
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('log.proof')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={busy || !recipient} onClick={() => void save()}>
            {t('log.markDelivered')}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <p className="t-caption t-tertiary">{t('log.proofImmutable')}</p>

        <Field label={t('log.recipient')}>
          <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} />
        </Field>
        <Field label={t('log.recipientId')}>
          <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
        </Field>

        <Field label={t('log.signature')}>
          {signaturePath
            ? <span className="t-caption t-tertiary t-mono t-truncate">{signaturePath}</span>
            : (
              <FileDrop
                scope="preuve"
                id={delivery.id}
                onUpload={async (file) => {
                  setSignaturePath(await uploadLogisticsFile(agencyId, 'preuve', delivery.id, file))
                }}
                compact
              />
            )}
        </Field>

        <Field label={t('log.photo')}>
          {photoPath
            ? <span className="t-caption t-tertiary t-mono t-truncate">{photoPath}</span>
            : (
              <FileDrop
                scope="preuve"
                id={`${delivery.id}-photo`}
                onUpload={async (file) => {
                  setPhotoPath(await uploadLogisticsFile(agencyId, 'preuve', delivery.id, file))
                }}
                compact
              />
            )}
        </Field>
      </div>
    </Modal>
  )
}

function FailureEditor({ delivery, onClose, onSaved }: {
  delivery: PlannedDelivery
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await updateDelivery(delivery.id, { status: 'echouee', failureReason: reason })
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('log.markFailed')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="danger" disabled={busy || !reason} onClick={() => void save()}>
            {t('action.confirm')}
          </Button>
        </>
      }
    >
      <Field label={t('log.failureReason')} hint={t('log.failureHint')}>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  )
}
