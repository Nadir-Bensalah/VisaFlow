import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Card, Field, Input, Modal, Pill, Select, Textarea, useToast } from '@/components/ui'
import { Vide } from '@/components/page'
import { Icon } from '@/components/Icon'
import {
  addReeferReading, loadDangerousClasses, loadDangerousDetails, loadReeferReadings,
  loadReeferRequirements, loadReeferStatus, removeDangerous, saveDangerous, saveReeferRequirement,
} from '@/data/cargo2'
import type {
  DangerousClass, DangerousDetail, DangerousDraft, ProductKind, ReadingSource,
  ReeferDraft, ReeferReading, ReeferRequirement, ReeferStatusLine,
} from '@/data/cargo2'

/**
 * Marchandises dangereuses et température contrôlée.
 *
 * Deux sujets, une seule carte, parce que ce sont les deux contraintes qui se
 * découvrent au quai quand elles n'ont pas été saisies au dépôt.
 *
 * DEUX RÈGLES QUI NE BOUGENT PAS :
 *
 * 1. VisaFlow ne classe aucune marchandise. Les neuf classes principales sont
 *    proposées ; la sous-division exacte (4.1, 5.2, 6.1) se lit sur la fiche de
 *    données de sécurité du fournisseur, et sur elle seule.
 *
 * 2. Une rupture de chaîne du froid se prouve par un relevé horodaté. La carte
 *    montre les relevés hors consigne, elle ne déclare pas le sinistre.
 */

const PRODUCT_KINDS: ProductKind[] = ['alimentaire', 'pharmaceutique', 'autre']
const SOURCES: ReadingSource[] = ['manuel', 'sonde', 'transporteur']
const GROUPS: ('I' | 'II' | 'III')[] = ['I', 'II', 'III']

const emptyDangerous = (): DangerousDraft => ({
  unNumber: null, hazardClass: null, packingGroup: null, properShippingName: null,
  flashPoint: null, emergencyContact: null, note: null,
})

const emptyReefer = (): ReeferDraft => ({
  temperatureMin: null, temperatureMax: null, unit: 'C', humidityPct: null,
  ventilation: null, productKind: 'autre', note: null,
})

export function DangerousGoodsCard({ shipmentId }: { shipmentId: string }) {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatDate, formatNumber, tt } = useI18n()
  const toast = useToast()

  const [classes, setClasses] = useState<DangerousClass[]>([])
  const [details, setDetails] = useState<DangerousDetail[]>([])
  const [reqs, setReqs] = useState<ReeferRequirement[]>([])
  const [readings, setReadings] = useState<ReeferReading[]>([])
  const [status, setStatus] = useState<ReeferStatusLine[]>([])
  const [error, setError] = useState<string | null>(null)

  const [dgEditing, setDgEditing] = useState<DangerousDetail | 'new' | null>(null)
  const [dgDraft, setDgDraft] = useState<DangerousDraft>(emptyDangerous())
  const [rfEditing, setRfEditing] = useState<ReeferRequirement | 'new' | null>(null)
  const [rfDraft, setRfDraft] = useState<ReeferDraft>(emptyReefer())
  const [readingOpen, setReadingOpen] = useState(false)
  const [reading, setReading] = useState({ temperature: 0, source: 'manuel' as ReadingSource, note: '' })

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try {
      const [c, d, r, rd, st] = await Promise.all([
        loadDangerousClasses(), loadDangerousDetails(shipmentId),
        loadReeferRequirements(shipmentId), loadReeferReadings(shipmentId),
        loadReeferStatus(shipmentId),
      ])
      setClasses(c); setDetails(d); setReqs(r); setReadings(rd); setStatus(st); setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [shipmentId])

  useEffect(() => { void reload() }, [reload])

  const submitDangerous = async () => {
    try {
      await saveDangerous(db.agency.id, shipmentId, dgEditing === 'new' ? null : dgEditing?.id ?? null, dgDraft)
      setDgEditing(null); toast(t('cg2.saved')); await reload()
    } catch (e) { setError((e as Error).message) }
  }

  const submitReefer = async () => {
    try {
      await saveReeferRequirement(db.agency.id, shipmentId, rfEditing === 'new' ? null : rfEditing?.id ?? null, rfDraft)
      setRfEditing(null); toast(t('cg2.saved')); await reload()
    } catch (e) { setError((e as Error).message) }
  }

  const submitReading = async () => {
    try {
      await addReeferReading(db.agency.id, shipmentId, {
        readingAt: new Date().toISOString(), temperature: reading.temperature,
        source: reading.source, note: reading.note || null,
      })
      setReadingOpen(false); toast(t('cg2.saved')); await reload()
    } catch (e) { setError((e as Error).message) }
  }

  if (!HAS_BACKEND) {
    return (
      <Card title={t('cg2.dangerous')}>
        <Vide icon="alert" title={t('cg2.offline')} />
      </Card>
    )
  }

  const outOfRange = status.reduce((n, s) => n + s.out_of_range.length, 0)

  return (
    <Card
      title={t('cg2.dangerous')}
      action={v.can('shipment:write')
        ? <Button icon="plus" onClick={() => { setDgEditing('new'); setDgDraft(emptyDangerous()) }}>
            {t('cg2.addDangerous')}
          </Button>
        : undefined}
    >
      {error && <p className="t-small t-orange">{t('cg2.loadError', { msg: error })}</p>}

      {details.length === 0 ? (
        <Vide icon="alert" title={t('cg2.noDangerous')} hint={t('cg2.noDangerousHint')} />
      ) : (
        <div className="col gap-3">
          {details.map((d) => (
            <div key={d.id} className="row-between" style={{ alignItems: 'flex-start', gap: 'var(--sp-4)' }}>
              <div className="col gap-1 grow" style={{ minWidth: 0 }}>
                <span className="t-small t-medium">{d.properShippingName ?? t('cg2.none')}</span>
                <span className="t-caption t-tertiary">
                  {[d.unNumber, d.hazardClass ? `${t('cg2.hazardClass')} ${d.hazardClass}` : null,
                    d.packingGroup ? `${t('cg2.packingGroup')} ${d.packingGroup}` : null]
                    .filter(Boolean).join(' · ')}
                </span>
                {/* Le numéro joignable jour et nuit. Sans lui, le dossier est
                    incomplet et personne ne s'en aperçoit avant le quai. */}
                {d.emergencyContact && (
                  <span className="t-caption t-tertiary">
                    <Icon name="phone" size={11} /> {d.emergencyContact}
                  </span>
                )}
              </div>
              <div className="col gap-1" style={{ textAlign: 'end', flex: 'none' }}>
                {d.hazardClass && (
                  <Pill tone="orange">
                    {tt(classes.find((c) => c.code === d.hazardClass?.split('.')[0])?.label)}
                  </Pill>
                )}
                {v.can('shipment:write') && (
                  <div className="row gap-1">
                    <Button size="sm" icon="edit" onClick={() => {
                      setDgEditing(d)
                      setDgDraft({
                        unNumber: d.unNumber, hazardClass: d.hazardClass, packingGroup: d.packingGroup,
                        properShippingName: d.properShippingName, flashPoint: d.flashPoint,
                        emergencyContact: d.emergencyContact, note: d.note,
                      })
                    }}>{t('cg2.save')}</Button>
                    <Button size="sm" icon="trash" onClick={() => void removeDangerous(d.id).then(reload)}>
                      {t('cg2.remove')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-4)' }}>
        <Icon name="alert" size={12} /> {t('cg2.classHint')}
      </p>

      {/* ---------------- Température contrôlée ---------------- */}
      <hr className="divider" style={{ margin: 'var(--sp-5) 0' }} />

      <div className="row-between" style={{ marginBottom: 'var(--sp-3)' }}>
        <span className="t-small t-medium">{t('cg2.reefer')}</span>
        {v.can('shipment:write') && (
          <div className="row gap-2">
            <Button size="sm" icon="plus" onClick={() => { setRfEditing('new'); setRfDraft(emptyReefer()) }}>
              {t('cg2.addReefer')}
            </Button>
            {reqs.length > 0 && (
              <Button size="sm" icon="upload" onClick={() => setReadingOpen(true)}>{t('cg2.addReading')}</Button>
            )}
          </div>
        )}
      </div>

      {reqs.length === 0 ? (
        <p className="t-small t-tertiary">{t('cg2.noReeferHint')}</p>
      ) : (
        <div className="col gap-3">
          {status.map((s) => (
            <div key={s.requirement_id} className="col gap-1">
              <div className="row-between">
                <span className="t-small">
                  {t('cg2.tempMin')} {formatNumber(s.temperature_min ?? 0)}°{s.unit}
                  {' · '}
                  {t('cg2.tempMax')} {formatNumber(s.temperature_max ?? 0)}°{s.unit}
                </span>
                {/* Les preuves, pas la conclusion : on montre les relevés hors
                    consigne, l'agence décide s'il y a sinistre. */}
                {s.out_of_range.length > 0
                  ? <Pill tone="red">{t('cg2.outOfRangeCount', { n: s.out_of_range.length })}</Pill>
                  : <Pill tone="green">{t('cg2.inRange')}</Pill>}
              </div>
              <span className="t-caption t-tertiary">
                {t(`cg2.pk_${s.product_kind}` as 'cg2.pk_autre')}
                {s.last_reading
                  ? ` · ${t('cg2.lastReading')} ${formatNumber(s.last_reading.temperature)}°${s.unit} · ${formatDate(s.last_reading.at)}`
                  : ''}
              </span>
              {s.out_of_range.map((o, i) => (
                <span key={i} className="t-caption t-red">
                  {formatDate(o.at)} · {formatNumber(o.temperature)}°{s.unit} · {t(`cg2.src_${o.source}` as 'cg2.src_sonde')}
                </span>
              ))}
            </div>
          ))}

          <p className="t-caption t-tertiary">
            {t('cg2.readings')} · {readings.length} · {t('cg2.proofHint')}
          </p>
          {outOfRange > 0 && (
            <p className="t-caption t-tertiary">{t('cg2.readingUnitHint')}</p>
          )}
        </div>
      )}

      {dgEditing && (
        <Modal
          title={t('cg2.dangerous')}
          onClose={() => setDgEditing(null)}
          footer={
            <>
              <Button onClick={() => setDgEditing(null)}>{t('cg2.cancel')}</Button>
              <Button variant="primary" onClick={() => void submitDangerous()}>{t('cg2.save')}</Button>
            </>
          }
        >
          <div className="col gap-3">
            <Field label={t('cg2.unNumber')}>
              <Input
                value={dgDraft.unNumber ?? ''}
                placeholder="UN1263"
                onChange={(e) => setDgDraft({ ...dgDraft, unNumber: e.target.value || null })}
              />
            </Field>
            <Field label={t('cg2.hazardClass')} hint={t('cg2.classHint')}>
              <Select
                value={dgDraft.hazardClass ?? ''}
                onChange={(e) => setDgDraft({ ...dgDraft, hazardClass: e.target.value || null })}
              >
                <option value="">{t('cg2.pickClass')}</option>
                {classes.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} · {tt(c.label)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('cg2.packingGroup')}>
              <Select
                value={dgDraft.packingGroup ?? ''}
                onChange={(e) => setDgDraft({ ...dgDraft, packingGroup: (e.target.value || null) as 'I' | 'II' | 'III' | null })}
              >
                <option value="">{t('cg2.none')}</option>
                {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </Select>
            </Field>
            <Field label={t('cg2.shippingName')}>
              <Input value={dgDraft.properShippingName ?? ''} onChange={(e) => setDgDraft({ ...dgDraft, properShippingName: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.flashPoint')}>
              <Input
                type="number"
                value={dgDraft.flashPoint ?? ''}
                onChange={(e) => setDgDraft({ ...dgDraft, flashPoint: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
            <Field label={t('cg2.emergency')}>
              <Input value={dgDraft.emergencyContact ?? ''} onChange={(e) => setDgDraft({ ...dgDraft, emergencyContact: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.note')}>
              <Textarea rows={2} value={dgDraft.note ?? ''} onChange={(e) => setDgDraft({ ...dgDraft, note: e.target.value || null })} />
            </Field>
          </div>
        </Modal>
      )}

      {rfEditing && (
        <Modal
          title={t('cg2.reefer')}
          onClose={() => setRfEditing(null)}
          footer={
            <>
              <Button onClick={() => setRfEditing(null)}>{t('cg2.cancel')}</Button>
              <Button variant="primary" onClick={() => void submitReefer()}>{t('cg2.save')}</Button>
            </>
          }
        >
          <div className="col gap-3">
            <Field label={t('cg2.tempMin')}>
              <Input
                type="number"
                value={rfDraft.temperatureMin ?? ''}
                onChange={(e) => setRfDraft({ ...rfDraft, temperatureMin: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
            <Field label={t('cg2.tempMax')}>
              <Input
                type="number"
                value={rfDraft.temperatureMax ?? ''}
                onChange={(e) => setRfDraft({ ...rfDraft, temperatureMax: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
            <Field label={t('cg2.unit')} hint={t('cg2.readingUnitHint')}>
              <Select value={rfDraft.unit} onChange={(e) => setRfDraft({ ...rfDraft, unit: e.target.value as 'C' | 'F' })}>
                <option value="C">C</option>
                <option value="F">F</option>
              </Select>
            </Field>
            <Field label={t('cg2.humidity')}>
              <Input
                type="number"
                value={rfDraft.humidityPct ?? ''}
                onChange={(e) => setRfDraft({ ...rfDraft, humidityPct: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
            <Field label={t('cg2.ventilation')}>
              <Input value={rfDraft.ventilation ?? ''} onChange={(e) => setRfDraft({ ...rfDraft, ventilation: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.productKind')}>
              <Select value={rfDraft.productKind} onChange={(e) => setRfDraft({ ...rfDraft, productKind: e.target.value as ProductKind })}>
                {PRODUCT_KINDS.map((p) => (
                  <option key={p} value={p}>{t(`cg2.pk_${p}` as 'cg2.pk_autre')}</option>
                ))}
              </Select>
            </Field>
          </div>
        </Modal>
      )}

      {readingOpen && (
        <Modal
          title={t('cg2.addReading')}
          onClose={() => setReadingOpen(false)}
          footer={
            <>
              <Button onClick={() => setReadingOpen(false)}>{t('cg2.cancel')}</Button>
              <Button variant="primary" onClick={() => void submitReading()}>{t('cg2.save')}</Button>
            </>
          }
        >
          <div className="col gap-3">
            <Field label={t('cg2.temperature')} hint={t('cg2.readingUnitHint')}>
              <Input
                type="number"
                value={reading.temperature}
                onChange={(e) => setReading({ ...reading, temperature: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('cg2.source')}>
              <Select value={reading.source} onChange={(e) => setReading({ ...reading, source: e.target.value as ReadingSource })}>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>{t(`cg2.src_${s}` as 'cg2.src_sonde')}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('cg2.note')}>
              <Input value={reading.note} onChange={(e) => setReading({ ...reading, note: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  )
}
