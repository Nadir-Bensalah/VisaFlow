import { useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Card, Field, Input, Modal, Pill, Select, Switch, useToast } from '@/components/ui'
import { Vide } from '@/components/page'
import {
  addCost, costSummary, hasBackend, listCosts, shipmentPnl, useRemote,
  type CostSummary, type ShipmentCost, type ShipmentPnl,
} from '@/data/logistique'
import { COST_KINDS, costBase, type CostKind } from '@/lib/logistique'

/**
 * Les coûts d'une cargaison, et sa marge.
 *
 * Deux idées tiennent cet écran. La première : tout est ramené à la devise de
 * l'agence, parce qu'additionner des dinars et des dollars donne un total qui
 * ne veut rien dire. La seconde : ce qui est refacturable au client est séparé
 * de ce qui reste à la charge de l'agence. C'est cette colonne, et elle seule,
 * qui explique où passe la marge.
 */
export function CostsCard({ shipmentId }: { shipmentId: string }) {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatMoney, formatDate } = useI18n()
  const toast = useToast()
  const [adding, setAdding] = useState(false)

  const costs = useRemote<ShipmentCost[]>(
    `costs:${shipmentId}`, () => listCosts(shipmentId), [],
  )
  const summary = useRemote<CostSummary | null>(
    `costsum:${shipmentId}`, () => costSummary(shipmentId), null,
  )
  const pnl = useRemote<ShipmentPnl | null>(
    `pnl:${shipmentId}`, () => (v.can('finance:global') ? shipmentPnl(shipmentId) : Promise.resolve(null)), null,
  )

  const reloadAll = () => { costs.reload(); summary.reload(); pnl.reload() }
  const currency = summary.data?.currency ?? db.agency.currency

  return (
    <Card
      title={t('log.costs')}
      action={v.can('shipment:write') && hasBackend
        ? <Button size="sm" icon="plus" onClick={() => setAdding(true)}>{t('log.costAdd')}</Button>
        : undefined}
    >
      {!hasBackend && <Vide icon="alert" title={t('log.offline')} />}
      {costs.error && <p className="t-small t-red">{costs.error}</p>}

      {hasBackend && costs.data.length === 0 && !costs.busy && (
        <Vide icon="payments" title={t('fcargo.noCosts')} hint={t('fcargo.noCostsHint')} />
      )}

      {costs.data.length > 0 && (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('log.total')}</th>
                <th>{t('log.supplier')}</th>
                <th>{t('log.incurredOn')}</th>
                <th className="num">{t('log.amount')}</th>
                <th className="num">{currency}</th>
              </tr>
            </thead>
            <tbody>
              {costs.data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="col gap-1">
                      <span className="t-small t-medium">{t(`log.k.${c.kind}` as 'log.k.FRET')}</span>
                      {/* Refacturable ou non : c'est la seule colonne qui
                          sépare la marge du chiffre d'affaires. */}
                      <Pill tone={c.billableToClient ? 'green' : 'gray'}>
                        {c.billableToClient ? t('log.billable') : t('log.notBillable')}
                      </Pill>
                    </span>
                  </td>
                  <td className="t-small">{c.supplierName ?? '·'}</td>
                  <td className="t-small t-tertiary">{formatDate(c.incurredOn ?? undefined)}</td>
                  <td className="num t-small">
                    {c.amount} {c.currency}
                    {c.currency !== currency ? <span className="t-caption t-tertiary"> × {c.fxRate}</span> : null}
                  </td>
                  <td className="num t-small t-num">
                    {formatMoney(c.amountBase ?? costBase(c.amount, c.fxRate), currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary.data && (
        <div className="col gap-2" style={{ marginTop: 'var(--sp-4)' }}>
          <Row label={t('log.total')} value={formatMoney(summary.data.totalBase, currency)} strong />
          <Row label={t('log.totalBillable')} value={formatMoney(summary.data.totalRefacturable, currency)} />
          <Row label={t('log.totalOwn')} value={formatMoney(summary.data.totalNonRefacturable, currency)} />
        </div>
      )}

      {/* La marge ne sort pas du cercle de la direction : une politique filtre
          des lignes, jamais des colonnes, donc c'est ici qu'on la cache. */}
      {v.can('finance:global') ? (
        pnl.data && (
          <>
            <hr className="divider" style={{ margin: 'var(--sp-4) 0' }} />
            <div className="col gap-2">
              <Row label={t('log.invoiced')} value={formatMoney(pnl.data.facture, currency)} />
              <Row label={t('log.collected')} value={formatMoney(pnl.data.encaisse, currency)} />
              {pnl.data.resteAEncaisser > 0 && (
                <Row label={t('log.leftToCollect')} value={formatMoney(pnl.data.resteAEncaisser, currency)} />
              )}
              <Row
                label={t('log.margin')}
                value={
                  <span className={pnl.data.marge < 0 ? 't-red t-medium' : 't-medium'}>
                    {formatMoney(pnl.data.marge, currency)}
                    {pnl.data.margePct != null ? ` · ${pnl.data.margePct} %` : ''}
                  </span>
                }
              />
            </div>
          </>
        )
      ) : (
        <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-4)' }}>{t('log.marginHidden')}</p>
      )}

      {adding && (
        <CostEditor
          shipmentId={shipmentId}
          agencyId={db.agency.id}
          currency={currency}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); reloadAll(); toast(t('crud.created')) }}
        />
      )}
    </Card>
  )
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="row-between">
      <span className="t-small t-secondary">{label}</span>
      <span className={strong ? 't-small t-medium t-num' : 't-small t-num'}>{value}</span>
    </div>
  )
}

function CostEditor({ shipmentId, agencyId, currency, onClose, onSaved }: {
  shipmentId: string
  agencyId: string
  currency: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [kind, setKind] = useState<CostKind>('FRET')
  const [supplier, setSupplier] = useState('')
  const [amount, setAmount] = useState('')
  const [cur, setCur] = useState(currency)
  const [fxRate, setFxRate] = useState('1')
  const [billable, setBillable] = useState(true)
  const [invoiceRef, setInvoiceRef] = useState('')
  const [incurredOn, setIncurredOn] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await addCost({
        agencyId,
        shipmentId,
        kind,
        supplierName: supplier || null,
        amount: Number(amount || 0),
        currency: cur,
        fxRate: Number(fxRate || 1),
        billableToClient: billable,
        invoiceReference: invoiceRef || null,
        incurredOn: incurredOn || null,
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
      title={t('log.costAdd')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={busy || amount === ''} onClick={() => void save()}>
            {t('action.save')}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label={t('log.costs')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as CostKind)}>
            {COST_KINDS.map((k) => (
              <option key={k} value={k}>{t(`log.k.${k}` as 'log.k.FRET')}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('log.supplier')}>
          <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </Field>
        <Field label={t('log.amount')}>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t('log.currency')}>
          <Input maxLength={3} value={cur} onChange={(e) => setCur(e.target.value.toUpperCase())} />
        </Field>
        {/* Le taux du jour de la dépense. Relu plus tard, il n'est plus le bon. */}
        <Field label={t('log.fxRate')}>
          <Input type="number" step="0.000001" value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
        </Field>
        <Field label={t('log.invoiceRef')}>
          <Input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
        </Field>
        <Field label={t('log.incurredOn')}>
          <Input type="date" value={incurredOn} onChange={(e) => setIncurredOn(e.target.value)} />
        </Field>
        <div className="row-between">
          <span className="t-small">{t('log.billable')}</span>
          <Switch checked={billable} onChange={setBillable} label={t('log.billable')} />
        </div>
      </div>
    </Modal>
  )
}
