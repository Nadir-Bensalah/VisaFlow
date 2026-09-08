import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { clientName } from '@/lib/derive'
import type { Tone } from '@/lib/derive'
import { Button, Card, Combobox, Empty, Field, Input, Modal, Pill, Segmented, Select, Textarea, useToast } from '@/components/ui'
import { PageHead } from '@/components/bits'
import { LineForm } from '@/pages/Quotes'
import {
  addInvoiceLine, archiveInvoiceLine, collectOnInvoice, createInvoice,
  loadInvoiceLines, loadInvoices, loadServices, setInvoiceStatus,
} from '@/data/commerce'
import type { DocLine, Invoice, InvoiceStatus, Service } from '@/data/commerce'

/**
 * Les factures.
 *
 * Le solde n'est pas une saisie, c'est un résultat : `paid_amount` et
 * `balance_due` descendent des règlements par déclencheur, et l'écran se
 * contente de les relire. Encaisser, ici, veut dire poser un règlement ; la
 * facture suit d'elle-même, et passe en « réglée » quand il ne reste rien.
 *
 * Le formulaire de ligne est celui des devis, importé tel quel : deux copies
 * du même formulaire finiraient par calculer deux TVA différentes.
 */

const TONE: Record<InvoiceStatus, Tone> = {
  brouillon: 'gray', emise: 'blue', partiellement_reglee: 'violet',
  reglee: 'green', en_retard: 'red', annulee: 'gray',
}

const METHODS = ['especes', 'virement', 'carte', 'cheque'] as const

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const daysLate = (due: string | null): number => {
  if (!due) return 0
  const ms = Date.now() - new Date(due).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

export function Invoices() {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatMoney, formatDate } = useI18n()

  const [rows, setRows] = useState<Invoice[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'du' | 'reglees' | 'tous'>('du')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try {
      const [f, s] = await Promise.all([loadInvoices(), loadServices()])
      setRows(f)
      setServices(s.filter((x) => x.active))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const shown = useMemo(() => rows.filter((f) =>
    view === 'tous' ? true
      : view === 'du' ? f.balanceDue > 0 && f.status !== 'annulee'
        : f.status === 'reglee',
  ), [rows, view])

  // Les compteurs se lisent sur ce que l'écran a chargé, sans recalcul métier :
  // ce sont des sommes de colonnes déjà arrêtées par le serveur.
  const totals = useMemo(() => {
    const live = rows.filter((f) => f.status !== 'annulee')
    return {
      due: live.reduce((s, f) => s + f.balanceDue, 0),
      collected: live.reduce((s, f) => s + f.paidAmount, 0),
      late: live.filter((f) => f.status === 'en_retard').length,
    }
  }, [rows])

  const open = rows.find((f) => f.id === openId) ?? null

  if (!HAS_BACKEND) {
    return (
      <>
        <PageHead title={t('com.invoices')} subtitle={t('com.invoicesSub')} />
        <Card><Empty title={t('com.offline')} hint={t('com.offlineHint')} scene="alerte" /></Card>
      </>
    )
  }

  return (
    <>
      <PageHead
        title={t('com.invoices')}
        subtitle={t('com.invoicesSub')}
        action={v.can('payment:write')
          ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('com.newInvoice')}</Button>
          : undefined}
      />

      {error && <Card><p className="t-small t-orange">{t('com.loadError', { msg: error })}</p></Card>}

      <div className="grid grid--3" style={{ marginBottom: 'var(--sp-5)' }}>
        <Card><div className="stat" style={{ padding: 0 }}>
          <div className="stat__label">{t('com.balanceDue')}</div>
          <div className="stat__value" style={{ color: totals.due > 0 ? 'var(--orange)' : undefined }}>
            {formatMoney(totals.due)}
          </div>
        </div></Card>
        <Card><div className="stat" style={{ padding: 0 }}>
          <div className="stat__label">{t('com.paidAmount')}</div>
          <div className="stat__value">{formatMoney(totals.collected)}</div>
        </div></Card>
        <Card><div className="stat" style={{ padding: 0 }}>
          <div className="stat__label">{t('com.invStatusEn_retard')}</div>
          <div className="stat__value" style={{ color: totals.late > 0 ? 'var(--red)' : undefined }}>{totals.late}</div>
        </div></Card>
      </div>

      <Card flush>
        <div className="row" style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--hairline)' }}>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'du', label: t('com.balanceDue') },
              { value: 'reglees', label: t('com.invStatusReglee') },
              { value: 'tous', label: t('com.all') },
            ]}
          />
        </div>

        {shown.length === 0 ? (
          <Empty
            title={t('com.noInvoices')}
            hint={t('com.noInvoicesHint')}
            action={v.can('payment:write')
              ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('com.newInvoice')}</Button>
              : undefined}
          />
        ) : (
          <div className="tablewrap">
            <table className="table table--clickable">
              <thead>
                <tr>
                  <th>{t('com.quoteNumber')}</th>
                  <th>{t('com.client')}</th>
                  <th>{t('com.status')}</th>
                  <th>{t('com.dueDate')}</th>
                  <th className="num">{t('com.total')}</th>
                  <th className="num">{t('com.paidAmount')}</th>
                  <th className="num">{t('com.balanceDue')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((f) => (
                  <tr key={f.id} onClick={() => setOpenId(f.id)}>
                    <td className="t-mono t-small t-medium">{f.number}</td>
                    <td className="t-small">{f.clientId ? clientName(db, f.clientId) : '...'}</td>
                    <td>
                      <Pill tone={TONE[f.status]} dot>
                        {t(`com.invStatus${cap(f.status)}` as 'com.invStatusEmise')}
                      </Pill>
                    </td>
                    <td className="t-caption t-tertiary">
                      {f.dueDate ? formatDate(f.dueDate) : '...'}
                      {f.status === 'en_retard' && (
                        <> <span className="t-red">{t('com.overdueBy', { n: daysLate(f.dueDate) })}</span></>
                      )}
                    </td>
                    <td className="num t-small">{formatMoney(f.total, f.currency)}</td>
                    <td className="num t-small t-tertiary">{formatMoney(f.paidAmount, f.currency)}</td>
                    <td className="num t-medium" style={{ color: f.balanceDue > 0 ? 'var(--orange)' : undefined }}>
                      {formatMoney(f.balanceDue, f.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && (
        <InvoiceCreator
          onClose={() => setCreating(false)}
          onDone={async (id) => { setCreating(false); await reload(); setOpenId(id) }}
        />
      )}

      {open && (
        <InvoiceDetail
          invoice={open}
          services={services}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      )}
    </>
  )
}

/* ------------------------------ Création ----------------------------- */

function InvoiceCreator({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const { db } = useStore()
  const v = useVisible()
  const { t } = useI18n()
  const [clientId, setClientId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = useMemo(
    () => v.clients.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}`, hint: c.phone })),
    [v.clients],
  )

  const submit = async () => {
    setBusy(true)
    try {
      const f = await createInvoice(db.agency.id, {
        officeId: v.officeId ?? v.user.officeId ?? null,
        clientId: clientId || null,
        caseId: null,
        shipmentId: null,
        currency: db.agency.currency,
        dueDate: dueDate || null,
        note: note.trim() || null,
      })
      onDone(f.id)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('com.newInvoice')}
      onClose={onClose}
      footer={
        <>
          <span className="grow" />
          <Button onClick={onClose}>{t('com.cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>{t('com.save')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label={t('com.client')}>
          <Combobox value={clientId} onChange={setClientId} options={options} emptyLabel={t('com.none')} />
        </Field>
        <Field label={t('com.dueDate')}>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label={t('com.note')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <p className="t-small t-orange">{error}</p>}
      </div>
    </Modal>
  )
}

/* ------------------------------- Détail ------------------------------ */

function InvoiceDetail({ invoice, services, onClose, onChanged }: {
  invoice: Invoice
  services: Service[]
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const { db } = useStore()
  const v = useVisible()
  const { t, tt, formatMoney, formatDate } = useI18n()
  const toast = useToast()

  const [lines, setLines] = useState<DocLine[]>([])
  const [amount, setAmount] = useState(String(invoice.balanceDue))
  const [method, setMethod] = useState<string>('especes')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const editable = invoice.status === 'brouillon' && v.can('payment:write')
  const collectable = v.can('payment:write')
    && invoice.balanceDue > 0
    && invoice.status !== 'brouillon' && invoice.status !== 'annulee'

  const refresh = useCallback(async () => {
    setLines(await loadInvoiceLines(invoice.id))
    await onChanged()
  }, [invoice.id, onChanged])

  useEffect(() => {
    void loadInvoiceLines(invoice.id).then(setLines).catch((e) => setError((e as Error).message))
  }, [invoice.id])

  useEffect(() => { setAmount(String(invoice.balanceDue)) }, [invoice.balanceDue])

  const guard = async (job: () => Promise<void>) => {
    setBusy(true)
    try { await job(); setError(null) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Modal
      title={`${t('com.invoices')} ${invoice.number}`}
      onClose={onClose}
      wide
      footer={
        <>
          {invoice.status === 'brouillon' && v.can('payment:write') && (
            <Button variant="primary" icon="check" disabled={busy || lines.length === 0}
              onClick={() => void guard(async () => { await setInvoiceStatus(invoice.id, 'emise'); await refresh() })}>
              {t('com.issue')}
            </Button>
          )}
          {invoice.status !== 'annulee' && invoice.paidAmount === 0 && v.can('payment:write') && (
            <Button icon="close" disabled={busy}
              onClick={() => void guard(async () => { await setInvoiceStatus(invoice.id, 'annulee'); await refresh() })}>
              {t('com.cancelInvoice')}
            </Button>
          )}
          <span className="grow" />
          <Button onClick={onClose}>{t('com.cancel')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        <div className="row gap-3 wrap">
          <Pill tone={TONE[invoice.status]} dot>
            {t(`com.invStatus${cap(invoice.status)}` as 'com.invStatusEmise')}
          </Pill>
          <span className="t-small t-secondary">
            {invoice.clientId ? clientName(db, invoice.clientId) : t('com.none')}
          </span>
          <span className="t-caption t-tertiary">
            {t('com.issueDate')} {formatDate(invoice.issueDate)}
            {invoice.dueDate ? ` · ${t('com.dueDate')} ${formatDate(invoice.dueDate)}` : ''}
          </span>
        </div>

        {lines.length === 0 ? (
          <p className="t-small t-tertiary">{t('com.noLines')}</p>
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('com.description')}</th>
                  <th className="num">{t('com.quantity')}</th>
                  <th className="num">{t('com.unitPrice')}</th>
                  <th className="num">{t('com.taxRate')}</th>
                  <th className="num">{t('com.lineTotal')}</th>
                  {editable && <th />}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="t-small">
                      {l.description || tt(services.find((s) => s.id === l.serviceId)?.name)}
                    </td>
                    <td className="num t-small">{l.quantity}</td>
                    <td className="num t-small">{formatMoney(l.unitPrice, invoice.currency)}</td>
                    <td className="num t-small t-tertiary">{l.taxRate}</td>
                    <td className="num t-medium">{formatMoney(l.lineTotal, invoice.currency)}</td>
                    {editable && (
                      <td style={{ textAlign: 'end' }}>
                        <Button size="sm" icon="trash" disabled={busy}
                          onClick={() => void guard(async () => { await archiveInvoiceLine(l.id); await refresh() })}>
                          {t('com.removeLine')}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {editable && (
          <LineForm
            services={services}
            currency={invoice.currency}
            nextNo={lines.length + 1}
            onAdd={(draft) => guard(async () => {
              await addInvoiceLine(db.agency.id, invoice.id, draft)
              await refresh()
            })}
          />
        )}

        <div className="col gap-2" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--sp-4)' }}>
          <div className="row-between"><span className="t-small t-secondary">{t('com.subtotal')}</span>
            <span className="t-small t-medium">{formatMoney(invoice.subtotal, invoice.currency)}</span></div>
          <div className="row-between"><span className="t-small t-secondary">{t('com.taxTotal')}</span>
            <span className="t-small t-medium">{formatMoney(invoice.taxTotal, invoice.currency)}</span></div>
          <div className="row-between"><span className="t-medium">{t('com.total')}</span>
            <span className="t-medium">{formatMoney(invoice.total, invoice.currency)}</span></div>
          <div className="row-between"><span className="t-small t-secondary">{t('com.paidAmount')}</span>
            <span className="t-small t-medium">{formatMoney(invoice.paidAmount, invoice.currency)}</span></div>
          <div className="row-between">
            <span className="t-medium">{t('com.balanceDue')}</span>
            <span className="t-medium" style={{ color: invoice.balanceDue > 0 ? 'var(--orange)' : 'var(--green)' }}>
              {formatMoney(invoice.balanceDue, invoice.currency)}
            </span>
          </div>
          <p className="t-caption t-tertiary">{t('com.serverComputes')}</p>
        </div>

        {collectable && (
          <div className="row gap-2 wrap" style={{ alignItems: 'flex-end' }}>
            <Field label={`${t('com.collectAmount')} (${invoice.currency})`} hint={t('com.fullBalance')}>
              <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label={t('com.method')}>
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>{t(`com.method${cap(m)}` as 'com.methodEspeces')}</option>
                ))}
              </Select>
            </Field>
            <Button variant="primary" icon="payments" disabled={busy || Number(amount) <= 0}
              onClick={() => void guard(async () => {
                await collectOnInvoice(db.agency.id, invoice, Number(amount), method)
                await refresh()
                toast(t('com.collectedDone'))
              })}>
              {t('com.collect')}
            </Button>
          </div>
        )}

        {error && <p className="t-small t-orange">{error}</p>}
      </div>
    </Modal>
  )
}
