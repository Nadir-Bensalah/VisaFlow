import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { clientName } from '@/lib/derive'
import type { Tone } from '@/lib/derive'
import { Button, Card, Combobox, Empty, Field, Input, Modal, Pill, Segmented, Select, Textarea, useToast } from '@/components/ui'
import { PageHead } from '@/components/bits'
import {
  addQuoteLine, archiveQuoteLine, createQuote, loadQuoteLines, loadQuotes, loadServices,
  quoteToInvoice, setQuoteDiscount, setQuoteStatus,
} from '@/data/commerce'
import type { DocLine, Quote, QuoteKind, QuoteStatus, Service } from '@/data/commerce'

/**
 * Les devis.
 *
 * Ce que l'écran ne fait JAMAIS : additionner. Le sous-total, la TVA et le
 * total viennent du serveur à chaque relecture. Un navigateur qui recalcule
 * finit toujours par afficher un chiffre que la facture imprimée dément.
 *
 * Cet écran lit le serveur en direct, pas le magasin global : celui-ci charge
 * déjà trente-trois tables à l'ouverture de session, et tout le monde les
 * paierait, y compris qui ne fait jamais de devis.
 */

const TONE: Record<QuoteStatus, Tone> = {
  brouillon: 'gray', envoye: 'blue', accepte: 'green', refuse: 'red', expire: 'orange',
}

const today = () => new Date().toISOString().slice(0, 10)

export function Quotes() {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatMoney, formatDate } = useI18n()
  const toast = useToast()

  const [rows, setRows] = useState<Quote[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'ouverts' | 'clos' | 'tous'>('ouverts')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try {
      const [q, s] = await Promise.all([loadQuotes(), loadServices()])
      setRows(q)
      setServices(s.filter((x) => x.active))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const shown = useMemo(() => rows.filter((q) =>
    view === 'tous' ? true
      : view === 'ouverts' ? q.status === 'brouillon' || q.status === 'envoye'
        : q.status !== 'brouillon' && q.status !== 'envoye',
  ), [rows, view])

  const open = rows.find((q) => q.id === openId) ?? null

  if (!HAS_BACKEND) {
    return (
      <>
        <PageHead title={t('com.quotes')} subtitle={t('com.quotesSub')} />
        <Card><Empty title={t('com.offline')} hint={t('com.offlineHint')} scene="alerte" /></Card>
      </>
    )
  }

  return (
    <>
      <PageHead
        title={t('com.quotes')}
        subtitle={t('com.quotesSub')}
        action={v.can('payment:write')
          ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('com.newQuote')}</Button>
          : undefined}
      />

      {error && <Card><p className="t-small t-orange">{t('com.loadError', { msg: error })}</p></Card>}

      <Card flush>
        <div className="row" style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--hairline)' }}>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'ouverts', label: t('com.inProgress') },
              { value: 'clos', label: t('com.decided') },
              { value: 'tous', label: t('com.all') },
            ]}
          />
        </div>

        {shown.length === 0 ? (
          <Empty
            title={t('com.noQuotes')}
            hint={t('com.noQuotesHint')}
            action={v.can('payment:write')
              ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('com.newQuote')}</Button>
              : undefined}
          />
        ) : (
          <div className="tablewrap">
            <table className="table table--clickable">
              <thead>
                <tr>
                  <th>{t('com.quoteNumber')}</th>
                  <th>{t('com.client')}</th>
                  <th>{t('com.kind')}</th>
                  <th>{t('com.status')}</th>
                  <th>{t('com.validUntil')}</th>
                  <th className="num">{t('com.total')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((q) => (
                  <tr key={q.id} onClick={() => setOpenId(q.id)}>
                    <td className="t-mono t-small t-medium">{q.number}</td>
                    <td className="t-small">{q.clientId ? clientName(db, q.clientId) : '...'}</td>
                    <td className="t-small t-secondary">{t(`com.kind${cap(q.kind)}` as 'com.kindVisa')}</td>
                    <td><Pill tone={TONE[q.status]} dot>{t(`com.status${cap(q.status)}` as 'com.statusBrouillon')}</Pill></td>
                    <td className="t-caption t-tertiary">{q.validUntil ? formatDate(q.validUntil) : '...'}</td>
                    <td className="num t-medium">{formatMoney(q.total, q.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && (
        <QuoteCreator
          onClose={() => setCreating(false)}
          onDone={async (id) => { setCreating(false); await reload(); setOpenId(id) }}
        />
      )}

      {open && (
        <QuoteDetail
          quote={open}
          services={services}
          onClose={() => setOpenId(null)}
          onChanged={reload}
          onConverted={() => { toast(t('com.converted')); setOpenId(null); void reload() }}
        />
      )}
    </>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/* ------------------------------ Création ----------------------------- */

function QuoteCreator({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const { db } = useStore()
  const v = useVisible()
  const { t } = useI18n()
  const [clientId, setClientId] = useState('')
  const [kind, setKind] = useState<QuoteKind>('visa')
  const [validUntil, setValidUntil] = useState('')
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
      const q = await createQuote(db.agency.id, {
        officeId: v.officeId ?? v.user.officeId ?? null,
        clientId: clientId || null,
        kind,
        caseId: null,
        shipmentId: null,
        currency: db.agency.currency,
        validUntil: validUntil || null,
        note: note.trim() || null,
      })
      onDone(q.id)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('com.newQuote')}
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
        <div className="grid grid--2">
          <Field label={t('com.kind')}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as QuoteKind)}>
              <option value="visa">{t('com.kindVisa')}</option>
              <option value="cargo">{t('com.kindCargo')}</option>
              <option value="autre">{t('com.kindAutre')}</option>
            </Select>
          </Field>
          <Field label={t('com.validUntil')}>
            <Input type="date" min={today()} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
        </div>
        <Field label={t('com.note')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <p className="t-small t-orange">{error}</p>}
      </div>
    </Modal>
  )
}

/* ------------------------------- Détail ------------------------------ */

function QuoteDetail({ quote, services, onClose, onChanged, onConverted }: {
  quote: Quote
  services: Service[]
  onClose: () => void
  onChanged: () => Promise<void>
  onConverted: () => void
}) {
  const { db } = useStore()
  const v = useVisible()
  const { t, tt, formatMoney } = useI18n()
  const toast = useToast()

  const [lines, setLines] = useState<DocLine[]>([])
  const [discount, setDiscount] = useState(String(quote.discount))
  const [dueDays, setDueDays] = useState('30')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const editable = quote.status === 'brouillon' && v.can('payment:write')

  const refresh = useCallback(async () => {
    try {
      setLines(await loadQuoteLines(quote.id))
      await onChanged()
    } catch (e) { setError((e as Error).message) }
  }, [quote.id, onChanged])

  useEffect(() => { void loadQuoteLines(quote.id).then(setLines).catch((e) => setError((e as Error).message)) }, [quote.id])

  const guard = async (job: () => Promise<void>) => {
    setBusy(true)
    try { await job(); setError(null) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Modal
      title={`${t('com.quotes')} ${quote.number}`}
      onClose={onClose}
      wide
      footer={
        <>
          {quote.status === 'brouillon' && v.can('payment:write') && (
            <Button icon="mail" disabled={busy || lines.length === 0}
              onClick={() => void guard(async () => { await setQuoteStatus(quote.id, 'envoye'); await refresh() })}>
              {t('com.send')}
            </Button>
          )}
          {quote.status === 'envoye' && v.can('payment:write') && (
            <>
              <Button icon="close" disabled={busy}
                onClick={() => void guard(async () => { await setQuoteStatus(quote.id, 'refuse'); await refresh() })}>
                {t('com.refuse')}
              </Button>
              <Button icon="check" disabled={busy}
                onClick={() => void guard(async () => { await setQuoteStatus(quote.id, 'accepte'); await refresh() })}>
                {t('com.accept')}
              </Button>
            </>
          )}
          {quote.status === 'accepte' && v.can('payment:write') && (
            <Button variant="primary" icon="payments" disabled={busy}
              onClick={() => void guard(async () => {
                await quoteToInvoice(quote.id, Math.max(0, Number(dueDays) || 30))
                onConverted()
              })}>
              {t('com.convert')}
            </Button>
          )}
          <span className="grow" />
          <Button onClick={onClose}>{t('com.cancel')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        <div className="row gap-3 wrap">
          <Pill tone={TONE[quote.status]} dot>{t(`com.status${cap(quote.status)}` as 'com.statusBrouillon')}</Pill>
          <span className="t-small t-secondary">
            {quote.clientId ? clientName(db, quote.clientId) : t('com.none')}
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
                  <th className="num">{t('com.lineDiscount')}</th>
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
                    <td className="num t-small">{formatMoney(l.unitPrice, quote.currency)}</td>
                    <td className="num t-small t-tertiary">{l.taxRate}</td>
                    <td className="num t-small t-tertiary">{l.discount ? formatMoney(l.discount, quote.currency) : '...'}</td>
                    <td className="num t-medium">{formatMoney(l.lineTotal, quote.currency)}</td>
                    {editable && (
                      <td style={{ textAlign: 'end' }}>
                        <Button size="sm" icon="trash" disabled={busy}
                          onClick={() => void guard(async () => { await archiveQuoteLine(l.id); await refresh() })}>
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
            currency={quote.currency}
            nextNo={lines.length + 1}
            onAdd={(draft) => guard(async () => {
              await addQuoteLine(db.agency.id, quote.id, draft)
              await refresh()
            })}
          />
        )}

        <div className="col gap-2" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--sp-4)' }}>
          {editable && (
            <div className="row gap-2" style={{ alignItems: 'flex-end' }}>
              <Field label={t('com.globalDiscount')}>
                <Input type="number" min={0} step="0.01" value={discount}
                  onChange={(e) => setDiscount(e.target.value)} />
              </Field>
              <Button icon="save" disabled={busy}
                onClick={() => void guard(async () => {
                  await setQuoteDiscount(quote.id, Math.max(0, Number(discount) || 0))
                  await refresh()
                  toast(t('com.saved'))
                })}>
                {t('com.save')}
              </Button>
            </div>
          )}
          <div className="row-between"><span className="t-small t-secondary">{t('com.subtotal')}</span>
            <span className="t-small t-medium">{formatMoney(quote.subtotal, quote.currency)}</span></div>
          <div className="row-between"><span className="t-small t-secondary">{t('com.taxTotal')}</span>
            <span className="t-small t-medium">{formatMoney(quote.taxTotal, quote.currency)}</span></div>
          <div className="row-between"><span className="t-medium">{t('com.total')}</span>
            <span className="t-medium">{formatMoney(quote.total, quote.currency)}</span></div>
          <p className="t-caption t-tertiary">{t('com.serverComputes')}</p>
        </div>

        {quote.status === 'accepte' && (
          <Field label={t('com.dueDays')}>
            <Input type="number" min={0} value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
          </Field>
        )}

        {error && <p className="t-small t-orange">{error}</p>}
      </div>
    </Modal>
  )
}

/* --------------------------- Ajouter une ligne ------------------------ */

export interface LineFormDraft {
  serviceId: string | null
  description: string | null
  quantity: number
  unitPrice: number
  taxRate: number
  discount: number
  lineNo: number
}

export function LineForm({ services, currency, nextNo, onAdd }: {
  services: Service[]
  currency: string
  nextNo: number
  onAdd: (draft: LineFormDraft) => Promise<void>
}) {
  const { t, tt } = useI18n()
  const [serviceId, setServiceId] = useState('')
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unitPrice, setUnitPrice] = useState('0')
  const [taxRate, setTaxRate] = useState('19')
  const [discount, setDiscount] = useState('0')

  // Choisir un service recopie SON prix et SA TVA, ceux que l'agence a saisis.
  // Rien n'est deviné : un service laissé à zéro reste à zéro.
  const pick = (id: string) => {
    setServiceId(id)
    const s = services.find((x) => x.id === id)
    if (s) {
      setUnitPrice(String(s.defaultPrice))
      setTaxRate(String(s.taxRate))
      if (!description.trim()) setDescription(tt(s.name))
    }
  }

  const submit = async () => {
    await onAdd({
      serviceId: serviceId || null,
      description: description.trim() || null,
      quantity: Math.max(0.001, Number(quantity) || 1),
      unitPrice: Number(unitPrice) || 0,
      taxRate: Math.min(100, Math.max(0, Number(taxRate) || 0)),
      discount: Math.max(0, Number(discount) || 0),
      lineNo: nextNo,
    })
    setServiceId(''); setDescription(''); setQuantity('1'); setUnitPrice('0'); setDiscount('0')
  }

  return (
    <div className="col gap-3">
      <span className="t-small t-medium">{t('com.addLine')}</span>
      <div className="grid grid--2">
        <Field label={t('com.service')}>
          <Select value={serviceId} onChange={(e) => pick(e.target.value)}>
            <option value="">{t('com.freeLine')}</option>
            {services.map((s) => <option key={s.id} value={s.id}>{tt(s.name)}</option>)}
          </Select>
        </Field>
        <Field label={t('com.description')}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <div className="row gap-2 wrap" style={{ alignItems: 'flex-end' }}>
        <Field label={t('com.quantity')}>
          <Input type="number" min={0} step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field label={`${t('com.unitPrice')} (${currency})`}>
          <Input type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
        </Field>
        <Field label={t('com.taxRate')}>
          <Input type="number" min={0} max={100} step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
        </Field>
        <Field label={t('com.lineDiscount')}>
          <Input type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </Field>
        <Button icon="plus" onClick={() => void submit()}>{t('com.addLine')}</Button>
      </div>
    </div>
  )
}
