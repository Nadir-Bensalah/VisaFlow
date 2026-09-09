import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { clientName } from '@/lib/derive'
import type { Tone } from '@/lib/derive'
import { Button, Combobox, Empty, Field, Input, Modal, Pill, Segmented, Select, Textarea, useToast } from '@/components/ui'
import { ExportButton } from '@/components/ExportButton'
import {
  Erreur, Kpi, KpiGrid, PageHeader, Section, Squelette, Table, Toolbar, Vide, useChargement,
} from '@/components/page'
import { LineForm } from '@/pages/Quotes'
import {
  addInvoiceLine, archiveInvoiceLine, collectOnInvoice, createInvoice,
  loadInvoiceLines, loadInvoices, loadServices, setInvoiceStatus,
} from '@/data/commerce'
import type { DocLine, Invoice, InvoiceStatus, Service } from '@/data/commerce'
import '@/styles/modules.css'

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
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const daysLate = (due: string | null): number => {
  if (!due) return 0
  const ms = Date.now() - new Date(due).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

type Vue = 'du' | 'retard' | 'reglees' | 'tous'

export function Invoices() {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatMoney, formatDate } = useI18n()
  const toast = useToast()

  const [view, setView] = useState<Vue>('du')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const canWrite = v.can('payment:write')

  const { data, loading, refreshing, error, reload } = useChargement(async () => {
    if (!HAS_BACKEND) return { rows: [] as Invoice[], services: [] as Service[] }
    const [rows, s] = await Promise.all([loadInvoices(), loadServices()])
    return { rows, services: s.filter((x) => x.active) }
  })
  const rows = useMemo(() => data?.rows ?? [], [data])
  const services = useMemo(() => data?.services ?? [], [data])

  // Les compteurs se lisent sur ce que l'écran a chargé, sans recalcul métier :
  // ce sont des sommes de colonnes déjà arrêtées par le serveur.
  const compte = useMemo(() => {
    const c = { du: 0, duN: 0, encaisse: 0, retard: 0, retardMontant: 0, brouillons: 0, reglees: 0 }
    for (const f of rows) {
      if (f.status === 'annulee') continue
      if (f.balanceDue > 0) { c.du += f.balanceDue; c.duN++ }
      c.encaisse += f.paidAmount
      if (f.status === 'en_retard') { c.retard++; c.retardMontant += f.balanceDue }
      if (f.status === 'brouillon') c.brouillons++
      if (f.status === 'reglee') c.reglees++
    }
    return c
  }, [rows])

  const nom = useCallback((id: string | null) => (id ? clientName(db, id) : ''), [db])

  const shown = useMemo(() => {
    const n = norm(q.trim())
    return rows.filter((f) => {
      const ok = view === 'tous' ? true
        : view === 'du' ? f.balanceDue > 0 && f.status !== 'annulee'
          : view === 'retard' ? f.status === 'en_retard'
            : f.status === 'reglee'
      if (!ok) return false
      if (!n) return true
      return norm(`${f.number} ${nom(f.clientId)}`).includes(n)
    })
  }, [rows, view, q, nom])

  const open = rows.find((f) => f.id === openId) ?? null

  const guardRow = async (job: () => Promise<void>) => {
    try { await job(); await reload() } catch (e) { toast((e as Error).message) }
  }

  const colonnesExport = [
    { key: 'number', label: t('com.quoteNumber'), value: (f: Invoice) => f.number },
    { key: 'client', label: t('com.client'), value: (f: Invoice) => nom(f.clientId) },
    { key: 'status', label: t('com.status'), value: (f: Invoice) => t(`com.invStatus${cap(f.status)}` as 'com.invStatusEmise') },
    { key: 'issue', label: t('com.issueDate'), value: (f: Invoice) => f.issueDate },
    { key: 'due', label: t('com.dueDate'), value: (f: Invoice) => f.dueDate },
    { key: 'total', label: t('com.total'), value: (f: Invoice) => f.total },
    { key: 'paid', label: t('com.paidAmount'), value: (f: Invoice) => f.paidAmount },
    { key: 'balance', label: t('com.balanceDue'), value: (f: Invoice) => f.balanceDue },
    { key: 'currency', label: t('com.currency'), value: (f: Invoice) => f.currency },
  ]

  const head = (
    <PageHeader
      kicker={t('mq.kickerMoney')}
      title={t('com.invoices')}
      subtitle={t('mq.invoicesSub')}
      refreshing={refreshing && !loading}
      refreshingLabel={t('mq.refreshing')}
      actions={HAS_BACKEND ? <>
        <ExportButton rows={shown} columns={colonnesExport} base="factures" scope="factures" disabled={shown.length === 0} />
        <Button icon="refresh" onClick={() => void reload()} disabled={refreshing}>{t('mq.refresh')}</Button>
        {canWrite && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('com.newInvoice')}</Button>}
      </> : undefined}
    />
  )

  if (!HAS_BACKEND) {
    return (
      <>
        {head}
        <Section><Empty title={t('mq.demoTitle')} hint={t('mq.demoHint')} scene="vide" /></Section>
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
          <Section flush><Squelette type="table" n={6} /></Section>
        </>
      ) : (
        <>
          <KpiGrid>
            <Kpi label={t('mq.invUnpaid')} value={formatMoney(compte.du)} icon="payments"
                 tone={compte.du > 0 ? 'orange' : undefined}
                 hint={t('mq.invUnpaidHint', { n: compte.duN })} />
            <Kpi label={t('com.invStatusEn_retard')} value={compte.retard} icon="alert"
                 tone={compte.retard > 0 ? 'red' : undefined}
                 hint={compte.retard > 0 ? t('mq.forAmount', { amount: formatMoney(compte.retardMontant) }) : t('mq.invNoLate')} />
            <Kpi label={t('mq.invCollected')} value={formatMoney(compte.encaisse)} icon="check" tone="green"
                 hint={t('mq.invCollectedHint', { n: compte.reglees })} />
            <Kpi label={t('com.invStatusBrouillon')} value={compte.brouillons} icon="edit"
                 hint={t('mq.invDraftHint')} />
          </KpiGrid>

          {rows.length === 0 ? (
            <Section>
              <Empty
                title={t('com.noInvoices')}
                hint={t('com.noInvoicesHint')}
                scene="vide"
                action={canWrite ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('com.newInvoice')}</Button> : undefined}
              />
            </Section>
          ) : (
            <Section flush>
              <Toolbar right={<><span className="t-caption t-tertiary t-num">{t('mq.rowsOf', { n: shown.length, total: rows.length })}</span><Input className="md-search" value={q} onChange={(e) => setQ(e.target.value)}
                       placeholder={t('mq.quotesSearch')} aria-label={t('mq.search')} /></>}>
                <Segmented<Vue>
                  value={view}
                  onChange={setView}
                  label={t('com.status')}
                  options={[
                    { value: 'du', label: `${t('com.balanceDue')} · ${compte.duN}` },
                    { value: 'retard', label: `${t('com.invStatusEn_retard')} · ${compte.retard}` },
                    { value: 'reglees', label: `${t('com.invStatusReglee')} · ${compte.reglees}` },
                    { value: 'tous', label: `${t('com.all')} · ${rows.length}` },
                  ]}
                />
              </Toolbar>

              {shown.length === 0 ? (
                <Vide
                  title={view === 'retard' && compte.retard === 0 ? t('mq.invNoLate') : t('mq.nothingInFilter')}
                  hint={t('mq.nothingInFilterHint')}
                  icon={view === 'retard' ? 'check' : 'search'}
                />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>{t('com.quoteNumber')}</th>
                      <th>{t('com.client')}</th>
                      <th>{t('com.status')}</th>
                      <th className="col-optional">{t('com.dueDate')}</th>
                      <th className="num col-optional">{t('com.total')}</th>
                      <th className="num col-optional">{t('com.paidAmount')}</th>
                      <th className="num">{t('com.balanceDue')}</th>
                      <th className="actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((f) => (
                      <tr key={f.id} className="adm-row--click" onClick={() => setOpenId(f.id)}>
                        <td className="t-mono t-medium">{f.number}</td>
                        <td>{f.clientId ? nom(f.clientId) : <span className="t-tertiary">{t('com.none')}</span>}</td>
                        <td>
                          <Pill tone={TONE[f.status]} dot>
                            {t(`com.invStatus${cap(f.status)}` as 'com.invStatusEmise')}
                          </Pill>
                        </td>
                        <td className="col-optional">
                          <div className="adm-cell-main">
                            <span className="t-tertiary" style={{ fontWeight: 'normal' }}>{f.dueDate ? formatDate(f.dueDate) : '·'}</span>
                            {f.status === 'en_retard' && <span className="t-caption t-red">{t('com.overdueBy', { n: daysLate(f.dueDate) })}</span>}
                          </div>
                        </td>
                        <td className="num col-optional">{formatMoney(f.total, f.currency)}</td>
                        <td className="num col-optional t-tertiary">{formatMoney(f.paidAmount, f.currency)}</td>
                        <td className="num t-medium" style={{ color: f.balanceDue > 0 ? 'var(--orange)' : undefined }}>
                          {formatMoney(f.balanceDue, f.currency)}
                        </td>
                        <td className="actions" onClick={(e) => e.stopPropagation()}>
                          {canWrite && f.status === 'brouillon' && (
                            <Button size="sm" icon="check" onClick={() => void guardRow(async () => { await setInvoiceStatus(f.id, 'emise') })}>{t('com.issue')}</Button>
                          )}
                          {canWrite && f.balanceDue > 0 && f.status !== 'brouillon' && f.status !== 'annulee' && (
                            <Button size="sm" icon="payments" onClick={() => setOpenId(f.id)}>{t('com.collect')}</Button>
                          )}
                          <Button size="sm" onClick={() => setOpenId(f.id)}>{t('mq.open')}</Button>
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
                  <th className="num col-optional">{t('com.taxRate')}</th>
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
                    <td className="num t-small t-tertiary col-optional">{l.taxRate}</td>
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
