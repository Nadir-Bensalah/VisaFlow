import { useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Card, Field, Input, Modal, Pill, useToast } from '@/components/ui'
import { Vide } from '@/components/page'
import { FileDrop } from '@/components/FileDrop'
import { Icon } from '@/components/Icon'
import {
  addArrivalNotice, hasBackend, listArrivalNotices, updateArrivalNotice,
  uploadLogisticsFile, useRemote, type ArrivalNotice,
} from '@/data/logistique'
import { arrivalUrgency, freeDaysLeft, urgencyTone } from '@/lib/logistique'

/**
 * L'avis d'arrivée et le compte à rebours des jours francs.
 *
 * C'est le seul délai gratuit de toute la chaîne. Passé lui, chaque journée se
 * facture, sur trois compteurs différents. L'agence a donc besoin d'un chiffre
 * qu'elle voit en entrant sur la fiche, pas d'une date à soustraire de tête.
 */
export function ArrivalCard({ shipmentId }: { shipmentId: string }) {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatDate } = useI18n()
  const toast = useToast()
  const [adding, setAdding] = useState(false)

  const notices = useRemote<ArrivalNotice[]>(
    `arrival:${shipmentId}`, () => listArrivalNotices(shipmentId), [],
  )

  const attach = async (notice: ArrivalNotice, file: File) => {
    const path = await uploadLogisticsFile(db.agency.id, 'avis', notice.id, file)
    await updateArrivalNotice(notice.id, { documentPath: path })
    notices.reload()
    toast(t('file.uploaded'))
  }

  return (
    <Card
      title={t('log.arrival')}
      action={v.can('shipment:write') && hasBackend
        ? <Button size="sm" icon="plus" onClick={() => setAdding(true)}>{t('log.arrivalAdd')}</Button>
        : undefined}
    >
      {!hasBackend && <Vide icon="alert" title={t('log.offline')} />}
      {notices.error && <p className="t-small t-red">{notices.error}</p>}

      {hasBackend && notices.data.length === 0 && !notices.busy && (
        <Vide icon="ship" title={t('fcargo.noArrival')} hint={t('fcargo.noArrivalHint')} />
      )}

      <div className="col gap-4">
        {notices.data.map((notice) => {
          const left = freeDaysLeft(notice.demurrageStartDate)
          const urgency = arrivalUrgency(left)
          return (
            <div key={notice.id} className="col gap-3">
              <div className="row-between wrap gap-2">
                <div className="col gap-1" style={{ minWidth: 0 }}>
                  <span className="t-small t-medium">
                    {notice.carrierName ?? t('log.carrier')}
                    {notice.reference ? ` · ${notice.reference}` : ''}
                  </span>
                  <span className="t-caption t-tertiary">
                    {notice.arrivalLocation ?? '·'}
                    {notice.receivedAt ? ` · ${t('log.received')} ${formatDate(notice.receivedAt)}` : ''}
                  </span>
                </div>

                {/* Le chiffre que l'agence vient chercher. Rouge quand la
                    facturation a commencé : elle grandit toute seule. */}
                {left === null ? (
                  <Pill tone="gray">{t('log.noCountdown')}</Pill>
                ) : left >= 0 ? (
                  <Pill tone={urgencyTone(urgency)} dot>{t('log.daysLeft', { n: left })}</Pill>
                ) : (
                  <Pill tone="red" dot>{t('log.daysOver', { n: -left })}</Pill>
                )}
              </div>

              <div className="col gap-2">
                <Line label={t('log.eta')} value={formatDate(notice.estimatedArrival ?? undefined)} />
                <Line label={t('log.actualArrival')} value={formatDate(notice.actualArrival ?? undefined)} />
                <Line label={t('log.storageStart')} value={formatDate(notice.storageStartDate ?? undefined)} />
                <Line
                  label={t('log.freeDays')}
                  value={notice.freeDays != null ? String(notice.freeDays) : '·'}
                />
                <Line
                  label={t('log.demurrageStart')}
                  value={formatDate(notice.demurrageStartDate ?? undefined)}
                />
              </div>

              {/* Le papier lui-même. Un avis d'arrivée qui vit dans une boîte
                  mail est un avis d'arrivée que personne ne retrouve. */}
              {v.can('doc:validate') && hasBackend && (
                <div className="row gap-2">
                  <Icon name="documents" size={16} className="t-tertiary" />
                  {notice.documentPath ? (
                    <span className="t-caption t-tertiary t-mono t-truncate">{notice.documentPath}</span>
                  ) : (
                    <FileDrop
                      scope="avis"
                      id={notice.id}
                      onUpload={(file) => attach(notice, file)}
                      compact
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {adding && (
        <NoticeEditor
          shipmentId={shipmentId}
          agencyId={db.agency.id}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); notices.reload(); toast(t('crud.created')) }}
        />
      )}
    </Card>
  )
}

function Line({ label, value }: { label: string; value?: string }) {
  return (
    <div className="row-between">
      <span className="t-caption t-tertiary">{label}</span>
      <span className="t-small">{value && value !== '·' ? value : '·'}</span>
    </div>
  )
}

function NoticeEditor({ shipmentId, agencyId, onClose, onSaved }: {
  shipmentId: string
  agencyId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [carrier, setCarrier] = useState('')
  const [reference, setReference] = useState('')
  const [place, setPlace] = useState('')
  const [eta, setEta] = useState('')
  const [storageStart, setStorageStart] = useState(new Date().toISOString().slice(0, 10))
  const [freeDays, setFreeDays] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await addArrivalNotice({
        agencyId,
        shipmentId,
        carrierName: carrier || null,
        reference: reference || null,
        arrivalLocation: place || null,
        estimatedArrival: eta ? new Date(eta).toISOString() : null,
        storageStartDate: storageStart || null,
        // Laissés vides, les jours francs viennent du barème de l'agence.
        freeDays: freeDays === '' ? null : Number(freeDays),
        receivedAt: new Date().toISOString(),
      })
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('log.arrivalAdd')}
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
        <Field label={t('log.reference')}>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label={t('log.place')}>
          <Input value={place} onChange={(e) => setPlace(e.target.value)} />
        </Field>
        <Field label={t('log.eta')}>
          <Input type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
        </Field>
        <Field label={t('log.storageStart')}>
          <Input type="date" value={storageStart} onChange={(e) => setStorageStart(e.target.value)} />
        </Field>
        <Field label={t('log.freeDays')} hint={t('log.freeDaysHint')}>
          <Input type="number" min={0} value={freeDays} onChange={(e) => setFreeDays(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
