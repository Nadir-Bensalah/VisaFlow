import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Card, Field, Input, Modal, Pill, Select, Textarea, useToast } from '@/components/ui'
import { Vide } from '@/components/page'
import { Icon } from '@/components/Icon'
import { loadInsurance, saveInsurance } from '@/data/cargo2'
import type { CargoInsurance, InsuranceDraft, InsuranceStatus } from '@/data/cargo2'
import type { Tone } from '@/lib/derive'

/**
 * L'assurance de la cargaison.
 *
 * Le jour du sinistre, personne ne retrouve la police : elle est dans un
 * courriel, chez le courtier, ou nulle part. Elle vit ici, avec son numéro, sa
 * couverture et sa franchise.
 *
 * Ce que cette carte ne fait PAS : dire que l'assurance est obligatoire. Elle
 * dépend de l'incoterm, pas de la loi, et l'affirmer serait faux.
 */

const TONE: Record<InsuranceStatus, Tone> = {
  a_souscrire: 'orange', active: 'green', expiree: 'red', resiliee: 'gray',
}

const STATUSES: InsuranceStatus[] = ['a_souscrire', 'active', 'expiree', 'resiliee']

const emptyDraft = (currency: string): InsuranceDraft => ({
  insurer: null, policyNumber: null, coverageAmount: null, currency,
  deductible: null, startDate: null, endDate: null, status: 'a_souscrire', note: null,
})

export function InsuranceCard({ shipmentId }: { shipmentId: string }) {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatMoney, formatDate } = useI18n()
  const toast = useToast()

  const [rows, setRows] = useState<CargoInsurance[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<CargoInsurance | 'new' | null>(null)
  const [draft, setDraft] = useState<InsuranceDraft>(emptyDraft(db.agency.currency ?? 'TND'))

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try {
      setRows(await loadInsurance(shipmentId))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [shipmentId])

  useEffect(() => { void reload() }, [reload])

  const open = (row: CargoInsurance | 'new') => {
    setEditing(row)
    setDraft(row === 'new' ? emptyDraft(db.agency.currency ?? 'TND') : {
      insurer: row.insurer, policyNumber: row.policyNumber,
      coverageAmount: row.coverageAmount, currency: row.currency,
      deductible: row.deductible, startDate: row.startDate, endDate: row.endDate,
      status: row.status, note: row.note,
    })
  }

  const submit = async () => {
    try {
      await saveInsurance(db.agency.id, shipmentId, editing === 'new' ? null : editing?.id ?? null, draft)
      setEditing(null)
      toast(t('cg2.saved'))
      await reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!HAS_BACKEND) {
    return (
      <Card title={t('cg2.insurance')}>
        <Vide icon="alert" title={t('cg2.offline')} />
      </Card>
    )
  }

  return (
    <Card
      title={t('cg2.insurance')}
      action={v.can('shipment:write')
        ? <Button icon="plus" onClick={() => open('new')}>{t('cg2.newInsurance')}</Button>
        : undefined}
    >
      {error && <p className="t-small t-orange">{t('cg2.loadError', { msg: error })}</p>}

      {rows.length === 0 ? (
        <Vide icon="shield" title={t('cg2.noInsurance')} hint={t('cg2.noInsuranceHint')} />
      ) : (
        <div className="col gap-3">
          {rows.map((r) => (
            <div key={r.id} className="row-between" style={{ alignItems: 'flex-start', gap: 'var(--sp-4)' }}>
              <div className="col gap-1 grow" style={{ minWidth: 0 }}>
                <span className="t-small t-medium">{r.insurer ?? t('cg2.none')}</span>
                <span className="t-caption t-tertiary t-mono">{r.policyNumber ?? '·'}</span>
                <span className="t-caption t-tertiary">
                  {formatDate(r.startDate ?? undefined)} → {formatDate(r.endDate ?? undefined)}
                </span>
                {/* La franchise reste à la charge de l'assuré : elle se lit ici,
                    pas au moment du chèque. */}
                {r.deductible != null && (
                  <span className="t-caption t-tertiary">
                    {t('cg2.deductible')} · {formatMoney(r.deductible, r.currency)}
                  </span>
                )}
              </div>
              <div className="col gap-1" style={{ textAlign: 'end', flex: 'none' }}>
                <Pill tone={TONE[r.status]}>{t(`cg2.insStatus_${r.status}` as 'cg2.insStatus_active')}</Pill>
                {r.coverageAmount != null && (
                  <span className="t-small t-medium">{formatMoney(r.coverageAmount, r.currency)}</span>
                )}
                {v.can('shipment:write') && (
                  <Button size="sm" icon="edit" onClick={() => open(r)}>{t('cg2.save')}</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-4)' }}>
        <Icon name="alert" size={12} /> {t('cg2.insuranceHint')}
      </p>

      {editing && (
        <Modal
          title={t('cg2.insurance')}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>{t('cg2.cancel')}</Button>
              <Button variant="primary" onClick={() => void submit()}>{t('cg2.save')}</Button>
            </>
          }
        >
          <div className="col gap-3">
            <Field label={t('cg2.insurer')}>
              <Input value={draft.insurer ?? ''} onChange={(e) => setDraft({ ...draft, insurer: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.policyNumber')}>
              <Input value={draft.policyNumber ?? ''} onChange={(e) => setDraft({ ...draft, policyNumber: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.coverage')}>
              <Input
                type="number"
                value={draft.coverageAmount ?? ''}
                onChange={(e) => setDraft({ ...draft, coverageAmount: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
            <Field label={t('cg2.deductible')}>
              <Input
                type="number"
                value={draft.deductible ?? ''}
                onChange={(e) => setDraft({ ...draft, deductible: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
            <Field label={t('cg2.currency')}>
              <Input value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase().slice(0, 3) })} />
            </Field>
            <Field label={t('cg2.startDate')}>
              <Input type="date" value={draft.startDate ?? ''} onChange={(e) => setDraft({ ...draft, startDate: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.endDate')}>
              <Input type="date" value={draft.endDate ?? ''} onChange={(e) => setDraft({ ...draft, endDate: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.status')}>
              <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as InsuranceStatus })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`cg2.insStatus_${s}` as 'cg2.insStatus_active')}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('cg2.note')}>
              <Textarea rows={2} value={draft.note ?? ''} onChange={(e) => setDraft({ ...draft, note: e.target.value || null })} />
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  )
}
