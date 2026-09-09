import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Empty, Field, Input, Modal, Pill, Segmented, Select, Textarea, useToast } from '@/components/ui'
import { FileDrop } from '@/components/FileDrop'
import { ExportButton } from '@/components/ExportButton'
import {
  Erreur, Kpi, KpiGrid, PageHeader, Section, Squelette, Table, Toolbar, Vide, useChargement,
} from '@/components/page'
import {
  addProof, deliveryPlan, hasBackend, updateDelivery, uploadLogisticsFile,
  type PlannedDelivery,
} from '@/data/logistique'
import { DELIVERY_TONE } from '@/lib/logistique'
import '@/styles/modules.css'

/**
 * Le plan de livraison du jour.
 *
 * C'est la feuille qu'on donne au chauffeur le matin et qu'on relit le soir :
 * l'adresse, à qui s'annoncer, où en est chaque course. Une livraison ratée
 * sans raison écrite repart le lendemain avec la même adresse fausse, et
 * l'agence paye deux fois la même tournée.
 */

type Vue = 'toutes' | 'a_faire' | 'livrees' | 'echouees'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const isoJour = () => new Date().toISOString().slice(0, 10)

export function Deliveries() {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatDate } = useI18n()
  const toast = useToast()

  const offices = db.agency.offices
  const [officeId, setOfficeId] = useState(v.officeId ?? offices[0]?.id ?? '')
  const [day, setDay] = useState(isoJour())
  const [vue, setVue] = useState<Vue>('toutes')
  const [q, setQ] = useState('')
  const [signing, setSigning] = useState<PlannedDelivery | null>(null)
  const [failing, setFailing] = useState<PlannedDelivery | null>(null)

  // Un agent ne choisit rien : il ne voit que son bureau, et le serveur
  // applique la même règle dans sa politique.
  const canChooseOffice = v.scope === 'agence'
  const canWrite = v.can('shipment:write')

  const { data, loading, refreshing, error, reload } = useChargement(
    () => (hasBackend && officeId ? deliveryPlan(officeId, day) : Promise.resolve([] as PlannedDelivery[])),
    [officeId, day],
  )
  const plan = useMemo(() => data ?? [], [data])

  const compte = useMemo(() => {
    const c = { total: plan.length, livrees: 0, echouees: 0, restantes: 0 }
    for (const d of plan) {
      if (d.status === 'livree') c.livrees++
      else if (d.status === 'echouee') c.echouees++
      else c.restantes++
    }
    return c
  }, [plan])

  const montres = useMemo(() => {
    const n = norm(q.trim())
    return plan.filter((d) => {
      const ok = vue === 'toutes' ? true
        : vue === 'livrees' ? d.status === 'livree'
          : vue === 'echouees' ? d.status === 'echouee'
            : d.status !== 'livree' && d.status !== 'echouee'
      if (!ok) return false
      if (!n) return true
      return norm(`${d.client ?? ''} ${d.reference ?? ''} ${d.address ?? ''} ${d.contactName ?? ''} ${d.driverName ?? ''}`).includes(n)
    })
  }, [plan, vue, q])

  const colonnesExport = [
    { key: 'client', label: t('cases.client'), value: (d: PlannedDelivery) => d.client },
    { key: 'reference', label: t('log.reference'), value: (d: PlannedDelivery) => d.reference },
    { key: 'address', label: t('log.address'), value: (d: PlannedDelivery) => d.address },
    { key: 'contact', label: t('log.contactName'), value: (d: PlannedDelivery) => d.contactName },
    { key: 'phone', label: t('log.contact'), value: (d: PlannedDelivery) => d.contactPhone },
    { key: 'driver', label: t('log.driver'), value: (d: PlannedDelivery) => d.driverName },
    { key: 'vehicle', label: t('log.vehicle'), value: (d: PlannedDelivery) => d.vehicle },
    { key: 'status', label: t('mq.status'), value: (d: PlannedDelivery) => t(`log.s.${d.status}` as 'log.s.livree') },
    { key: 'planned', label: t('log.day'), value: (d: PlannedDelivery) => d.plannedAt?.slice(0, 10) },
    { key: 'delivered', label: t('log.markDelivered'), value: (d: PlannedDelivery) => d.deliveredAt?.slice(0, 16) },
    { key: 'failure', label: t('log.failureReason'), value: (d: PlannedDelivery) => d.failureReason },
  ]

  const head = (
    <PageHeader
      kicker={t('mq.kickerCargo')}
      title={t('log.deliveries')}
      subtitle={t('mq.deliveriesSub')}
      refreshing={refreshing && !loading}
      refreshingLabel={t('mq.refreshing')}
      actions={hasBackend ? <>
        {canChooseOffice && offices.length > 1 && (
          <Select className="md-select" value={officeId} onChange={(e) => setOfficeId(e.target.value)} aria-label={t('misc.office')}>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        )}
        <Input className="md-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label={t('log.day')} />
        <Button icon="today" onClick={() => setDay(isoJour())} disabled={day === isoJour()}>{t('log.today')}</Button>
        <ExportButton rows={montres} columns={colonnesExport} base={`livraisons-${day}`} scope="livraisons" disabled={montres.length === 0} />
        <Button icon="refresh" onClick={() => void reload()} disabled={refreshing}>{t('mq.refresh')}</Button>
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

  if (!officeId) {
    return (
      <>
        {head}
        <Section><Empty title={t('log.noOffice')} scene="cargo" /></Section>
      </>
    )
  }

  return (
    <>
      {head}

      {error && <Erreur message={error} retryLabel={t('mq.retry')} onRetry={() => void reload()} />}

      {loading && !data ? (
        <>
          <Squelette type="kpis" n={4} />
          <Section flush><Squelette type="table" n={5} /></Section>
        </>
      ) : (
        <>
          <KpiGrid>
            <Kpi label={t('mq.delTotal')} value={compte.total} icon="box" tone="blue" hint={formatDate(day)} />
            <Kpi label={t('mq.delLeft')} value={compte.restantes} icon="clock"
                 tone={compte.restantes > 0 ? 'orange' : undefined} hint={t('mq.delLeftHint')} />
            <Kpi label={t('log.s.livree')} value={compte.livrees} icon="check" tone="green"
                 hint={t('mq.delDoneHint', { n: compte.total })} />
            <Kpi label={t('log.s.echouee')} value={compte.echouees} icon="alert"
                 tone={compte.echouees > 0 ? 'red' : undefined} hint={t('mq.delFailedHint')} />
          </KpiGrid>

          {plan.length === 0 ? (
            <Section>
              <Empty title={t('log.planNone')} hint={t('mq.delNoneHint')} scene="cargo"
                     action={<Link className="btn btn--secondary" to="/cargaisons">{t('nav.shipments')}</Link>} />
            </Section>
          ) : (
            <Section flush>
              <Toolbar right={<><span className="t-caption t-tertiary t-num">{t('mq.rowsOf', { n: montres.length, total: plan.length })}</span><Input className="md-search" value={q} onChange={(e) => setQ(e.target.value)}
                       placeholder={t('mq.delSearch')} aria-label={t('mq.search')} /></>}>
                <Segmented<Vue>
                  value={vue}
                  onChange={setVue}
                  label={t('mq.status')}
                  options={[
                    { value: 'toutes', label: `${t('mq.all')} · ${plan.length}` },
                    { value: 'a_faire', label: `${t('mq.delTodo')} · ${compte.restantes}` },
                    { value: 'livrees', label: `${t('log.s.livree')} · ${compte.livrees}` },
                    { value: 'echouees', label: `${t('log.s.echouee')} · ${compte.echouees}` },
                  ]}
                />
              </Toolbar>

              {montres.length === 0 ? (
                <Vide title={t('mq.nothingInFilter')} hint={t('mq.nothingInFilterHint')} icon="search" />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>{t('cases.client')}</th>
                      <th>{t('log.address')}</th>
                      <th className="col-optional">{t('log.contact')}</th>
                      <th className="col-optional">{t('log.driver')}</th>
                      <th>{t('mq.status')}</th>
                      <th className="actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {montres.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <div className="adm-cell-main">
                            <span>{d.client ?? d.reference ?? '·'}</span>
                            {d.shipmentId
                              ? <Link to={`/cargaisons/${d.shipmentId}`} className="t-caption t-mono">{d.reference ?? t('action.open')}</Link>
                              : d.reference && <span className="t-caption t-mono">{d.reference}</span>}
                          </div>
                        </td>
                        <td>
                          <div className="adm-cell-main">
                            <span style={{ fontWeight: 'normal' }}>{d.address ?? <span className="t-tertiary">·</span>}</span>
                            {/* Pourquoi la course a échoué. Sans ça, on recommence. */}
                            {d.failureReason && <span className="t-caption t-red">{d.failureReason}</span>}
                            {d.proof?.signedAt && (
                              <span className="t-caption">
                                {t('log.signedAt')} {formatDate(d.proof.signedAt)}
                                {d.proof.recipientName ? ` · ${d.proof.recipientName}` : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="col-optional">
                          <div className="adm-cell-main">
                            <span style={{ fontWeight: 'normal' }}>{d.contactName ?? <span className="t-tertiary">·</span>}</span>
                            {d.contactPhone && <a className="t-caption t-mono" href={`tel:${d.contactPhone.replace(/\s/g, '')}`}>{d.contactPhone}</a>}
                          </div>
                        </td>
                        <td className="col-optional t-secondary">{[d.driverName, d.vehicle].filter(Boolean).join(' · ') || <span className="t-tertiary">·</span>}</td>
                        <td>
                          <Pill tone={DELIVERY_TONE[d.status]} dot>{t(`log.s.${d.status}` as 'log.s.livree')}</Pill>
                        </td>
                        <td className="actions">
                          {canWrite && d.status !== 'livree' && (
                            <>
                              <Button size="sm" variant="primary" icon="check" onClick={() => setSigning(d)}>{t('log.proofAdd')}</Button>
                              <Button size="sm" icon="close" onClick={() => setFailing(d)}>{t('log.markFailed')}</Button>
                            </>
                          )}
                          {d.shipmentId && <Link className="btn btn--secondary btn--sm" to={`/cargaisons/${d.shipmentId}`}>{t('mq.open')}</Link>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Section>
          )}
        </>
      )}

      {signing && (
        <ProofEditor
          delivery={signing}
          agencyId={db.agency.id}
          onClose={() => setSigning(null)}
          onSaved={() => { setSigning(null); void reload(); toast(t('crud.updated')) }}
        />
      )}

      {failing && (
        <FailureEditor
          delivery={failing}
          onClose={() => setFailing(null)}
          onSaved={() => { setFailing(null); void reload(); toast(t('crud.updated')) }}
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
