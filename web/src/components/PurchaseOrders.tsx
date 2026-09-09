import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Card, Combobox, Field, Input, Modal, Pill, Select, Textarea, useToast } from '@/components/ui'
import { Vide } from '@/components/page'
import { Icon } from '@/components/Icon'
import {
  addPurchaseItem, addSupplierMovement, loadPurchaseItems, loadPurchaseOrders,
  loadSupplierBalance, loadSupplierMovements, loadSuppliers, PURCHASE_STATUSES,
  removePurchaseItem, savePurchaseOrder,
} from '@/data/cargo2'
import type {
  PurchaseDraft, PurchaseOrder, PurchaseOrderItem, PurchaseStatus,
  SupplierMovementKind, SupplierRef, SupplierTransaction,
} from '@/data/cargo2'
import type { Tone } from '@/lib/derive'

/**
 * Les commandes fournisseurs, et le solde du compte.
 *
 * Le total d'un bon de commande ne s'additionne PAS ici : il descend du
 * serveur, recalculé à chaque mouvement de ligne. Le solde fournisseur non
 * plus : il se calcule à chaque lecture. Un solde stocké dérive au premier
 * mouvement oublié, et on paie deux fois la même facture.
 */

const TONE: Record<PurchaseStatus, Tone> = {
  brouillon: 'gray', envoye: 'blue', confirme: 'blue',
  expedie: 'orange', recu: 'green', annule: 'red',
}

const MOVEMENT_KINDS: SupplierMovementKind[] = ['facture', 'paiement', 'avoir']

const today = () => new Date().toISOString().slice(0, 10)

const emptyPurchase = (shipmentId: string | null, officeId: string | null): PurchaseDraft => ({
  officeId, shipmentId, supplierId: null, poNumber: null, currency: 'USD',
  status: 'brouillon', issuedOn: today(), expectedOn: null, note: null,
})

export function PurchaseOrders({ shipmentId }: { shipmentId?: string }) {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatMoney, formatDate, formatNumber } = useI18n()
  const toast = useToast()

  const [rows, setRows] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRef[]>([])
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [items, setItems] = useState<PurchaseOrderItem[]>([])
  const [editing, setEditing] = useState<PurchaseOrder | 'new' | null>(null)
  const [draft, setDraft] = useState<PurchaseDraft>(emptyPurchase(shipmentId ?? null, v.officeId))

  const [balanceOf, setBalanceOf] = useState<string | null>(null)
  const [balance, setBalance] = useState<number>(0)
  const [movements, setMovements] = useState<SupplierTransaction[]>([])
  const [movementOpen, setMovementOpen] = useState(false)
  const [movement, setMovement] = useState({
    kind: 'facture' as SupplierMovementKind, reference: '', amount: 0,
    currency: 'USD', fxRate: 1, occurredOn: today(), note: '',
  })

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try {
      const [p, s] = await Promise.all([loadPurchaseOrders({ shipmentId }), loadSuppliers()])
      setRows(p); setSuppliers(s); setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [shipmentId])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    if (!openId) { setItems([]); return }
    void loadPurchaseItems(openId).then(setItems).catch((e) => setError((e as Error).message))
  }, [openId])

  const openBalance = useCallback(async (supplierId: string) => {
    setBalanceOf(supplierId)
    try {
      const [b, m] = await Promise.all([
        loadSupplierBalance(supplierId), loadSupplierMovements(supplierId),
      ])
      setBalance(b); setMovements(m)
    } catch (e) { setError((e as Error).message) }
  }, [])

  const supplierName = useMemo(() => {
    const map = new Map(suppliers.map((s) => [s.id, s.companyName]))
    // Le répertoire est tenu par un autre module. S'il manque, on montre
    // l'identifiant plutôt qu'une case vide : au moins on peut rapprocher.
    return (id: string | null) => (id ? map.get(id) ?? id.slice(0, 8) : t('cg2.none'))
  }, [suppliers, t])

  const submit = async () => {
    try {
      const id = await savePurchaseOrder(db.agency.id, editing === 'new' ? null : editing?.id ?? null, draft)
      setEditing(null); setOpenId(id); toast(t('cg2.saved')); await reload()
    } catch (e) { setError((e as Error).message) }
  }

  const submitMovement = async () => {
    if (!balanceOf) return
    try {
      await addSupplierMovement(db.agency.id, balanceOf, {
        shipmentId: shipmentId ?? null, kind: movement.kind,
        reference: movement.reference || null, amount: movement.amount,
        currency: movement.currency, fxRate: movement.fxRate,
        occurredOn: movement.occurredOn, note: movement.note || null,
      })
      setMovementOpen(false); toast(t('cg2.saved')); await openBalance(balanceOf)
    } catch (e) { setError((e as Error).message) }
  }

  if (!HAS_BACKEND) {
    return (
      <Card title={t('cg2.purchases')}>
        <Vide icon="alert" title={t('cg2.offline')} />
      </Card>
    )
  }

  return (
    <Card
      title={t('cg2.purchases')}
      action={v.can('shipment:write')
        ? <Button icon="plus" onClick={() => { setEditing('new'); setDraft(emptyPurchase(shipmentId ?? null, v.officeId)) }}>
            {t('cg2.newPurchase')}
          </Button>
        : undefined}
    >
      {error && <p className="t-small t-orange">{t('cg2.loadError', { msg: error })}</p>}

      {rows.length === 0 ? (
        <Vide icon="box" title={t('cg2.noPurchases')} hint={t('cg2.noPurchasesHint')} />
      ) : (
        <div className="col gap-3">
          {rows.map((r) => (
            <div key={r.id} className="col gap-1">
              <div className="row-between">
                <button
                  type="button"
                  className="t-small t-medium"
                  style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', textAlign: 'start' }}
                  onClick={() => setOpenId(openId === r.id ? null : r.id)}
                >
                  <span className="t-mono">{r.poNumber ?? '·'}</span> · {supplierName(r.supplierId)}
                </button>
                <div className="row gap-2">
                  <Pill tone={TONE[r.status]}>{t(`cg2.poStatus_${r.status}` as 'cg2.poStatus_envoye')}</Pill>
                  {/* Le total vient du serveur. On ne l'additionne pas ici. */}
                  <span className="t-small t-medium">{formatMoney(r.total, r.currency)}</span>
                </div>
              </div>
              <span className="t-caption t-tertiary">
                {r.issuedOn ? `${t('cg2.issuedOn')} ${formatDate(r.issuedOn)}` : ''}
                {r.expectedOn ? ` · ${t('cg2.expectedOn')} ${formatDate(r.expectedOn)}` : ''}
              </span>

              {openId === r.id && (
                <div className="col gap-2" style={{ paddingInlineStart: 'var(--sp-4)' }}>
                  {items.length === 0 ? (
                    <span className="t-caption t-tertiary">{t('cg2.items')} · 0</span>
                  ) : (
                    <div className="tablewrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>{t('cg2.description')}</th>
                            <th>{t('cg2.hsCode')}</th>
                            <th className="num">{t('cg2.quantity')}</th>
                            <th className="num">{t('cg2.unitPrice')}</th>
                            <th className="num">{t('cg2.lineTotal')}</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it) => (
                            <tr key={it.id}>
                              <td className="t-small">{it.description ?? '·'}</td>
                              <td className="t-caption t-mono t-tertiary">{it.hsCode ?? '·'}</td>
                              <td className="num t-small">{formatNumber(it.quantity)} {it.unit ?? ''}</td>
                              <td className="num t-small">{formatNumber(it.unitPrice)}</td>
                              <td className="num t-small">{formatNumber(it.total)}</td>
                              <td>
                                {v.can('shipment:write') && (
                                  <Button size="sm" icon="trash" onClick={() => void removePurchaseItem(it.id).then(async () => {
                                    setItems(await loadPurchaseItems(r.id)); await reload()
                                  })}>{t('cg2.remove')}</Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <span className="t-caption t-tertiary">{t('cg2.serverComputes')}</span>
                  <div className="row gap-2">
                    {v.can('shipment:write') && (
                      <Button size="sm" icon="plus" onClick={() => void addPurchaseItem(db.agency.id, r.id, {
                        description: t('cg2.description'), hsCode: null, quantity: 1,
                        unit: null, unitPrice: 0, lineNo: items.length + 1,
                      }).then(async () => { setItems(await loadPurchaseItems(r.id)); await reload() })}>
                        {t('cg2.addItem')}
                      </Button>
                    )}
                    {r.supplierId && (
                      <Button size="sm" icon="payments" onClick={() => void openBalance(r.supplierId!)}>
                        {t('cg2.supplierBalance')}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Le solde du compte fournisseur, calculé par le serveur. */}
      {balanceOf && (
        <>
          <hr className="divider" style={{ margin: 'var(--sp-5) 0' }} />
          <div className="row-between">
            <span className="t-small t-medium">{supplierName(balanceOf)}</span>
            <span className={`t-medium ${balance > 0 ? 't-red' : ''}`} style={{ fontSize: 18 }}>
              {formatMoney(balance)}
            </span>
          </div>
          <p className="t-caption t-tertiary">{t('cg2.balanceOwed')} · {t('cg2.balanceHint')}</p>

          <div className="col gap-2" style={{ marginTop: 'var(--sp-3)' }}>
            {movements.map((m) => (
              <div key={m.id} className="row-between">
                <span className="t-small">
                  {t(`cg2.mv_${m.kind}` as 'cg2.mv_facture')}
                  {m.reference ? ` · ${m.reference}` : ''}
                </span>
                <span className="t-caption t-tertiary">
                  {formatDate(m.occurredOn)} · {formatNumber(m.amount)} {m.currency}
                  {m.fxRate !== 1 ? ` · ${t('cg2.fxRate')} ${m.fxRate}` : ''}
                </span>
              </div>
            ))}
            {v.can('shipment:write') && (
              <Button size="sm" icon="plus" onClick={() => setMovementOpen(true)}>{t('cg2.addMovement')}</Button>
            )}
          </div>
        </>
      )}

      {editing && (
        <Modal
          title={t('cg2.purchases')}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>{t('cg2.cancel')}</Button>
              <Button variant="primary" onClick={() => void submit()}>{t('cg2.save')}</Button>
            </>
          }
        >
          <div className="col gap-3">
            <Field label={t('cg2.supplier')} hint={suppliers.length === 0 ? t('cg2.noSuppliers') : undefined}>
              <Combobox
                value={draft.supplierId ?? ''}
                onChange={(val) => setDraft({ ...draft, supplierId: val || null })}
                options={suppliers.map((s) => ({ value: s.id, label: s.companyName, hint: s.country ?? undefined }))}
                placeholder={t('cg2.pickSupplier')}
                emptyLabel={t('cg2.noSuppliers')}
              />
            </Field>
            <Field label={t('cg2.poNumber')}>
              <Input value={draft.poNumber ?? ''} onChange={(e) => setDraft({ ...draft, poNumber: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.currency')}>
              <Input value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase().slice(0, 3) })} />
            </Field>
            <Field label={t('cg2.status')}>
              <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as PurchaseStatus })}>
                {PURCHASE_STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`cg2.poStatus_${s}` as 'cg2.poStatus_envoye')}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('cg2.issuedOn')}>
              <Input type="date" value={draft.issuedOn ?? ''} onChange={(e) => setDraft({ ...draft, issuedOn: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.expectedOn')}>
              <Input type="date" value={draft.expectedOn ?? ''} onChange={(e) => setDraft({ ...draft, expectedOn: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.note')}>
              <Textarea rows={2} value={draft.note ?? ''} onChange={(e) => setDraft({ ...draft, note: e.target.value || null })} />
            </Field>
          </div>
        </Modal>
      )}

      {movementOpen && (
        <Modal
          title={t('cg2.addMovement')}
          onClose={() => setMovementOpen(false)}
          footer={
            <>
              <Button onClick={() => setMovementOpen(false)}>{t('cg2.cancel')}</Button>
              <Button variant="primary" onClick={() => void submitMovement()}>{t('cg2.save')}</Button>
            </>
          }
        >
          <div className="col gap-3">
            <Field label={t('cg2.kind')}>
              <Select value={movement.kind} onChange={(e) => setMovement({ ...movement, kind: e.target.value as SupplierMovementKind })}>
                {MOVEMENT_KINDS.map((k) => (
                  <option key={k} value={k}>{t(`cg2.mv_${k}` as 'cg2.mv_facture')}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('cg2.reference')}>
              <Input value={movement.reference} onChange={(e) => setMovement({ ...movement, reference: e.target.value })} />
            </Field>
            <Field label={t('cg2.amount')}>
              <Input type="number" value={movement.amount} onChange={(e) => setMovement({ ...movement, amount: Number(e.target.value) })} />
            </Field>
            <Field label={t('cg2.currency')}>
              <Input value={movement.currency} onChange={(e) => setMovement({ ...movement, currency: e.target.value.toUpperCase().slice(0, 3) })} />
            </Field>
            <Field label={t('cg2.fxRate')} hint={t('cg2.amountBase')}>
              <Input type="number" step="0.000001" value={movement.fxRate} onChange={(e) => setMovement({ ...movement, fxRate: Number(e.target.value) })} />
            </Field>
            <Field label={t('cg2.occurredOn')}>
              <Input type="date" value={movement.occurredOn} onChange={(e) => setMovement({ ...movement, occurredOn: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}

      <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-4)' }}>
        <Icon name="alert" size={12} /> {t('cg2.balanceHint')}
      </p>
    </Card>
  )
}
