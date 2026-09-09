import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Card, Field, Input, Modal, Pill, Select, Textarea, useToast } from '@/components/ui'
import { Vide } from '@/components/page'
import { Icon } from '@/components/Icon'
import {
  INSPECTION_KINDS, loadInspections, loadInspectionsState, loadTechnicalDocuments,
  saveInspection, saveTechnicalDocument,
} from '@/data/cargo2'
import type {
  InspectionDraft, InspectionKind, InspectionResult, InspectionsState,
  ShipmentInspection, TechnicalControlDocument, TechnicalDraft, TechnicalStatus,
} from '@/data/cargo2'
import type { Tone } from '@/lib/derive'

/**
 * Les inspections, et le contrôle technique.
 *
 * Le contrôle technique et le contrôle phytosanitaire sont les deux qui
 * retiennent le plus souvent une marchandise au port. La carte doit donc dire
 * lequel manque, d'un coup d'oeil.
 *
 * Et elle doit le dire SANS mentir : « aucun contrôle enregistré » ne veut pas
 * dire « aucun contrôle requis ». La liste des produits soumis est
 * réglementaire, elle bouge, et VisaFlow ne l'affirme jamais à la place de
 * l'agence.
 */

const RESULT_TONE: Record<InspectionResult | 'absente', Tone> = {
  en_attente: 'orange', conforme: 'green', non_conforme: 'red',
  reserve: 'orange', absente: 'gray',
}

const RESULTS: InspectionResult[] = ['en_attente', 'conforme', 'non_conforme', 'reserve']
const TECH_STATUSES: TechnicalStatus[] = ['a_deposer', 'depose', 'approuve', 'rejete']

/** Les deux genres qui bloquent le plus souvent. On les met devant. */
const BLOQUANTS: InspectionKind[] = ['TECHNIQUE', 'PHYTOSANITAIRE']

const emptyInspection = (currency: string): InspectionDraft => ({
  kind: 'DOUANE', scheduledAt: null, performedAt: null, authority: null,
  result: 'en_attente', findings: null, cost: null, currency, note: null,
})

const emptyTechnical = (): TechnicalDraft => ({
  reference: null, authority: null, submittedOn: null, status: 'a_deposer',
  decisionOn: null, note: null,
})

export function InspectionsCard({ shipmentId }: { shipmentId: string }) {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatDate, formatMoney } = useI18n()
  const toast = useToast()

  const [rows, setRows] = useState<ShipmentInspection[]>([])
  const [docs, setDocs] = useState<TechnicalControlDocument[]>([])
  const [state, setState] = useState<InspectionsState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ShipmentInspection | 'new' | null>(null)
  const [draft, setDraft] = useState<InspectionDraft>(emptyInspection(db.agency.currency))
  const [techEditing, setTechEditing] = useState<TechnicalControlDocument | 'new' | null>(null)
  const [techDraft, setTechDraft] = useState<TechnicalDraft>(emptyTechnical())

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try {
      const [i, d, s] = await Promise.all([
        loadInspections(shipmentId), loadTechnicalDocuments(shipmentId),
        loadInspectionsState(shipmentId),
      ])
      setRows(i); setDocs(d); setState(s); setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [shipmentId])

  useEffect(() => { void reload() }, [reload])

  const submit = async () => {
    try {
      await saveInspection(db.agency.id, shipmentId, editing === 'new' ? null : editing?.id ?? null, draft)
      setEditing(null); toast(t('cg2.saved')); await reload()
    } catch (e) { setError((e as Error).message) }
  }

  const submitTech = async () => {
    try {
      await saveTechnicalDocument(db.agency.id, shipmentId, techEditing === 'new' ? null : techEditing?.id ?? null, techDraft)
      setTechEditing(null); toast(t('cg2.saved')); await reload()
    } catch (e) { setError((e as Error).message) }
  }

  if (!HAS_BACKEND) {
    return (
      <Card title={t('cg2.inspections')}>
        <Vide icon="alert" title={t('cg2.offline')} />
      </Card>
    )
  }

  const tech = state?.controle_technique
  const lastTech = docs[0]

  return (
    <Card
      title={t('cg2.inspections')}
      action={v.can('shipment:write')
        ? <Button icon="plus" onClick={() => { setEditing('new'); setDraft(emptyInspection(db.agency.currency)) }}>
            {t('cg2.newInspection')}
          </Button>
        : undefined}
    >
      {error && <p className="t-small t-orange">{t('cg2.loadError', { msg: error })}</p>}

      {/* Les deux qui bloquent, mis devant : on veut savoir lequel manque sans
          lire toute la liste. */}
      {state && (
        <div className="row gap-2" style={{ flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
          {BLOQUANTS.map((k) => {
            const line = state.par_genre[k]
            const result = (line?.result ?? 'absente') as InspectionResult | 'absente'
            return (
              <Pill key={k} tone={RESULT_TONE[result]} dot>
                {t(`cg2.kind_${k}` as 'cg2.kind_TECHNIQUE')}
                {' · '}
                {t(`cg2.res_${result}` as 'cg2.res_conforme')}
              </Pill>
            )
          })}
        </div>
      )}

      {rows.length === 0 ? (
        <Vide icon="shield" title={t('cg2.noInspections')} hint={t('cg2.noInspectionsHint')} />
      ) : (
        <div className="col gap-3">
          {rows.map((r) => (
            <div key={r.id} className="row-between" style={{ alignItems: 'flex-start', gap: 'var(--sp-4)' }}>
              <div className="col gap-1 grow" style={{ minWidth: 0 }}>
                <span className="t-small t-medium">{t(`cg2.kind_${r.kind}` as 'cg2.kind_DOUANE')}</span>
                <span className="t-caption t-tertiary">
                  {[r.authority, r.performedAt ? formatDate(r.performedAt) : r.scheduledAt ? formatDate(r.scheduledAt) : null]
                    .filter(Boolean).join(' · ')}
                </span>
                {r.findings && <span className="t-caption t-tertiary">{r.findings}</span>}
              </div>
              <div className="col gap-1" style={{ textAlign: 'end', flex: 'none' }}>
                <Pill tone={RESULT_TONE[r.result]}>{t(`cg2.res_${r.result}` as 'cg2.res_conforme')}</Pill>
                {r.cost != null && <span className="t-caption t-tertiary">{formatMoney(r.cost, r.currency)}</span>}
                {v.can('shipment:write') && (
                  <Button size="sm" icon="edit" onClick={() => {
                    setEditing(r)
                    setDraft({
                      kind: r.kind, scheduledAt: r.scheduledAt, performedAt: r.performedAt,
                      authority: r.authority, result: r.result, findings: r.findings,
                      cost: r.cost, currency: r.currency, note: r.note,
                    })
                  }}>{t('cg2.save')}</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-4)' }}>
        <Icon name="alert" size={12} /> {t('cg2.missingHint')}
      </p>

      {/* Le contrôle technique a sa propre pièce et son propre circuit. */}
      <hr className="divider" style={{ margin: 'var(--sp-5) 0' }} />

      <div className="row-between" style={{ marginBottom: 'var(--sp-3)' }}>
        <span className="t-small t-medium">{t('cg2.technicalControl')}</span>
        {v.can('shipment:write') && (
          <Button size="sm" icon="plus" onClick={() => { setTechEditing('new'); setTechDraft(emptyTechnical()) }}>
            {t('cg2.newTechnical')}
          </Button>
        )}
      </div>

      {lastTech ? (
        <div className="col gap-1">
          <div className="row-between">
            <span className="t-small t-mono">{lastTech.reference ?? '·'}</span>
            <Pill tone={lastTech.status === 'approuve' ? 'green' : lastTech.status === 'rejete' ? 'red' : 'orange'}>
              {t(`cg2.tcStatus_${lastTech.status}` as 'cg2.tcStatus_depose')}
            </Pill>
          </div>
          <span className="t-caption t-tertiary">
            {t('cg2.tcSubmitted')} {formatDate(lastTech.submittedOn ?? undefined)}
            {lastTech.decisionOn ? ` · ${t('cg2.tcDecision')} ${formatDate(lastTech.decisionOn)}` : ''}
          </span>
        </div>
      ) : (
        <p className="t-small t-tertiary">
          {t(`cg2.tcStatus_${(tech?.status ?? 'absent')}` as 'cg2.tcStatus_absent')}
        </p>
      )}

      <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-3)' }}>{t('cg2.tcHint')}</p>

      {editing && (
        <Modal
          title={t('cg2.inspections')}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>{t('cg2.cancel')}</Button>
              <Button variant="primary" onClick={() => void submit()}>{t('cg2.save')}</Button>
            </>
          }
        >
          <div className="col gap-3">
            <Field label={t('cg2.kind')}>
              <Select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as InspectionKind })}>
                {INSPECTION_KINDS.map((k) => (
                  <option key={k} value={k}>{t(`cg2.kind_${k}` as 'cg2.kind_DOUANE')}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('cg2.authority')}>
              <Input value={draft.authority ?? ''} onChange={(e) => setDraft({ ...draft, authority: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.scheduledAt')}>
              <Input
                type="datetime-local"
                value={draft.scheduledAt ? draft.scheduledAt.slice(0, 16) : ''}
                onChange={(e) => setDraft({ ...draft, scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
              />
            </Field>
            <Field label={t('cg2.performedAt')}>
              <Input
                type="datetime-local"
                value={draft.performedAt ? draft.performedAt.slice(0, 16) : ''}
                onChange={(e) => setDraft({ ...draft, performedAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
              />
            </Field>
            <Field label={t('cg2.result')}>
              <Select value={draft.result} onChange={(e) => setDraft({ ...draft, result: e.target.value as InspectionResult })}>
                {RESULTS.map((r) => (
                  <option key={r} value={r}>{t(`cg2.res_${r}` as 'cg2.res_conforme')}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('cg2.findings')}>
              <Textarea rows={2} value={draft.findings ?? ''} onChange={(e) => setDraft({ ...draft, findings: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.cost')}>
              <Input
                type="number"
                value={draft.cost ?? ''}
                onChange={(e) => setDraft({ ...draft, cost: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
          </div>
        </Modal>
      )}

      {techEditing && (
        <Modal
          title={t('cg2.technicalControl')}
          onClose={() => setTechEditing(null)}
          footer={
            <>
              <Button onClick={() => setTechEditing(null)}>{t('cg2.cancel')}</Button>
              <Button variant="primary" onClick={() => void submitTech()}>{t('cg2.save')}</Button>
            </>
          }
        >
          <div className="col gap-3">
            <Field label={t('cg2.reference')}>
              <Input value={techDraft.reference ?? ''} onChange={(e) => setTechDraft({ ...techDraft, reference: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.authority')}>
              <Input value={techDraft.authority ?? ''} onChange={(e) => setTechDraft({ ...techDraft, authority: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.tcSubmitted')}>
              <Input type="date" value={techDraft.submittedOn ?? ''} onChange={(e) => setTechDraft({ ...techDraft, submittedOn: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.status')}>
              <Select value={techDraft.status} onChange={(e) => setTechDraft({ ...techDraft, status: e.target.value as TechnicalStatus })}>
                {TECH_STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`cg2.tcStatus_${s}` as 'cg2.tcStatus_depose')}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('cg2.tcDecision')}>
              <Input type="date" value={techDraft.decisionOn ?? ''} onChange={(e) => setTechDraft({ ...techDraft, decisionOn: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.note')} hint={t('cg2.tcHint')}>
              <Textarea rows={2} value={techDraft.note ?? ''} onChange={(e) => setTechDraft({ ...techDraft, note: e.target.value || null })} />
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  )
}
