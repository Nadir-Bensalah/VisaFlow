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
import {
  addQuoteLine, archiveQuoteLine, createQuote, loadQuoteLines, loadQuotes, loadServices,
  quoteToInvoice, setQuoteDiscount, setQuoteStatus,
} from '@/data/commerce'
import type { DocLine, Quote, QuoteKind, QuoteStatus, Service } from '@/data/commerce'
import '@/styles/modules.css'

/**
 * Les devis.
 *
 * Ce que l'écran ne fait JAMAIS : additionner. Le sous-total, la TVA et le
 * total viennent du serveur à chaque relecture. Un navigateur qui recalcule
 * finit toujours par afficher un chiffre que la facture imprimée dément.
 * Les chiffres de tête sont des sommes de colonnes déjà arrêtées par le
 * serveur, jamais un recalcul de ligne.
 *
 * Cet écran lit le serveur en direct, pas le magasin global : celui-ci charge
 * déjà trente-trois tables à l'ouverture de session, et tout le monde les
 * paierait, y compris qui ne fait jamais de devis.
 */

const TONE: Record<QuoteStatus, Tone> = {
  brouillon: 'gray', envoye: 'blue', accepte: 'green', refuse: 'red', expire: 'orange',
}

const today = () => new Date().toISOString().slice(0, 10)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

type Vue = 'ouverts' | 'clos' | 'tous'

export function Quotes() {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatMoney, formatDate } = useI18n()
  const toast = useToast()

  const [view, setView] = useState<Vue>('ouverts')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const canWrite = v.can('payment:write')

  const { data, loading, refreshing, error, reload } = useChargement(async () => {
    if (!HAS_BACKEND) return { rows: [] as Quote[], services: [] as Service[] }
    const [rows, s] = await Promise.all([loadQuotes(), loadServices()])
    return { rows, services: s.filter((x) => x.active) }
  })
  const rows = useMemo(() => data?.rows ?? [], [data])
  const services = useMemo(() => data?.services ?? [], [data])

  /* ---------------------------- Compteurs ---------------------------- */

  const compte = useMemo(() => {
    const c = { attente: 0, attenteMontant: 0, brouillons: 0, acceptes: 0, acceptesMontant: 0, decides: 0 }
    for (const x of rows) {
      if (x.status === 'envoye') { c.attente++; c.attenteMontant += x.total }
      if (x.status === 'brouillon') c.brouillons++
      if (x.status === 'accepte') { c.acceptes++; c.acceptesMontant += x.total }
      if (x.status === 'accepte' || x.status === 'refuse') c.decides++
    }
    return c
  }, [rows])
  const taux = compte.decides > 0 ? Math.round((compte.acceptes / compte.decides) * 100) : null

  /* ----------------------------- Filtrage ---------------------------- */

  const nom = useCallback((id: string | null) => (id ? clientName(db, id) : ''), [db])

  const shown = useMemo(() => {
    const n = norm(q.trim())
    return rows.filter((x) => {
      const ok = view === 'tous' ? true
        : view === 'ouverts' ? x.status === 'brouillon' || x.status === 'envoye'
          : x.status !== 'brouillon' && x.status !== 'envoye'
      if (!ok) return false
      if (!n) return true
      return norm(`${x.number} ${nom(x.clientId)}`).includes(n)
    })
  }, [rows, view, q, nom])

  const open = rows.find((x) => x.id === openId) ?? null

  const guardRow = async (job: () => Promise<void>) => {
    try { await job(); await reload() } catch (e) { toast((e as Error).message) }
  }

  const colonnesExport = [
    { key: 'number', label: t('com.quoteNumber'), value: (x: Quote) => x.number },
    { key: 'client', label: t('com.client'), value: (x: Quote) => nom(x.clientId) },
    { key: 'kind', label: t('com.kind'), value: (x: Quote) => t(`com.kind${cap(x.kind)}` as 'com.kindVisa') },
    { key: 'status', label: t('com.status'), value: (x: Quote) => t(`com.status${cap(x.status)}` as 'com.statusBrouillon') },
    { key: 'validUntil', label: t('com.validUntil'), value: (x: Quote) => x.validUntil },
    { key: 'subtotal', label: t('com.subtotal'), value: (x: Quote) => x.subtotal },
    { key: 'tax', label: t('com.taxTotal'), value: (x: Quote) => x.taxTotal },
    { key: 'total', label: t('com.total'), value: (x: Quote) => x.total },
    { key: 'currency', label: t('com.currency'), value: (x: Quote) => x.currency },
    { key: 'created', label: t('crm.createdOn'), value: (x: Quote) => x.createdAt.slice(0, 10) },
  ]

  const head = (
    <PageHeader
      kicker={t('mq.kickerCommercial')}
      title={t('com.quotes')}
      subtitle={t('mq.quotesSub')}
      refreshing={refreshing && !loading}
      refreshingLabel={t('mq.refreshing')}
      actions={HAS_BACKEND ? <>
        <ExportButton rows={shown} columns={colonnesExport} base="devis" scope="devis" disabled={shown.length === 0} />
        <Button icon="refresh" onClick={() => void reload()} disabled={refreshing}>{t('mq.refresh')}</Button>
        {canWrite && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('com.newQuote')}</Button>}
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
            <Kpi label={t('mq.quotesPending')} value={compte.attente} icon="mail" tone="blue"
                 hint={t('mq.forAmount', { amount: formatMoney(compte.attenteMontant) })} />
            <Kpi label={t('com.statusBrouillon')} value={compte.brouillons} icon="edit"
                 hint={t('mq.quotesDraftHint')} />
            <Kpi label={t('mq.quotesAccepted')} value={compte.acceptes} icon="check" tone="green"
                 hint={t('mq.forAmount', { amount: formatMoney(compte.acceptesMontant) })} />
            <Kpi label={t('mq.quotesRate')} value={taux === null ? '·' : `${taux} %`} icon="reports"
                 hint={taux === null ? t('mq.notEnough') : t('mq.quotesRateHint', { n: compte.decides })} />
          </KpiGrid>

          {rows.length === 0 ? (
            <Section>
              <Empty
                title={t('com.noQuotes')}
                hint={t('com.noQuotesHint')}
                scene="vide"
                action={canWrite ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('com.newQuote')}</Button> : undefined}
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
                    { value: 'ouverts', label: `${t('com.inProgress')} · ${compte.attente + compte.brouillons}` },
                    { value: 'clos', label: `${t('com.decided')} · ${rows.length - compte.attente - compte.brouillons}` },
                    { value: 'tous', label: `${t('com.all')} · ${rows.length}` },
                  ]}
                />
              </Toolbar>

              {shown.length === 0 ? (
                <Vide title={t('mq.nothingInFilter')} hint={t('mq.nothingInFilterHint')} icon="search" />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>{t('com.quoteNumber')}</th>
                      <th>{t('com.client')}</th>
                      <th className="col-optional">{t('com.kind')}</th>
                      <th>{t('com.status')}</th>
                      <th className="col-optional">{t('com.validUntil')}</th>
                      <th className="num">{t('com.total')}</th>
                      <th className="actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((x) => {
                      const expire = x.validUntil && x.status === 'envoye' && new Date(x.validUntil) < new Date()
                      return (
                        <tr key={x.id} className="adm-row--click" onClick={() => setOpenId(x.id)}>
                          <td className="t-mono t-medium">{x.number}</td>
                          <td>{x.clientId ? nom(x.clientId) : <span className="t-tertiary">{t('com.none')}</span>}</td>
                          <td className="col-optional t-secondary">{t(`com.kind${cap(x.kind)}` as 'com.kindVisa')}</td>
                          <td><Pill tone={TONE[x.status]} dot>{t(`com.status${cap(x.status)}` as 'com.statusBrouillon')}</Pill></td>
                          <td className="col-optional">
                            {x.validUntil
                              ? <span className={expire ? 't-orange' : 't-tertiary'}>{formatDate(x.validUntil)}</span>
                              : <span className="t-tertiary">·</span>}
                          </td>
                          <td className="num t-medium">{formatMoney(x.total, x.currency)}</td>
                          <td className="actions" onClick={(e) => e.stopPropagation()}>
                            {canWrite && x.status === 'brouillon' && (
                              <Button size="sm" onClick={() => setOpenId(x.id)}>{t('crud.edit')}</Button>
                            )}
                            {canWrite && x.status === 'envoye' && (
                              <Button size="sm" icon="check" onClick={() => void guardRow(async () => { await setQuoteStatus(x.id, 'accepte') })}>{t('com.accept')}</Button>
                            )}
                            {canWrite && x.status === 'accepte' && (
                              <Button size="sm" icon="payments" onClick={() => setOpenId(x.id)}>{t('com.convert')}</Button>
                            )}
                            <Button size="sm" onClick={() => setOpenId(x.id)}>{t('mq.open')}</Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              )}
            </Section>
          )}
        </>
      )}

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
                  <th className="num col-optional">{t('com.taxRate')}</th>
                  <th className="num col-optional">{t('com.lineDiscount')}</th>
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
                    <td className="num t-small t-tertiary col-optional">{l.taxRate}</td>
                    <td className="num t-small t-tertiary col-optional">{l.discount ? formatMoney(l.discount, quote.currency) : '·'}</td>
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
