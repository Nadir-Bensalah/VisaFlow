import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Card, Empty, Field, Input, Modal, Select, Textarea, useToast } from '@/components/ui'
import { addExpense, archiveExpense, EXPENSE_CATEGORIES, loadExpenses } from '@/data/commerce'
import type { Expense, ExpenseCategory } from '@/data/commerce'

/**
 * Les dépenses d'un dossier ou d'une cargaison.
 *
 * Sans elles, la marge affichée serait le chiffre d'affaires. Un patron qui
 * découvre une fois qu'on lui a compté du brut pour du net ne rouvre plus
 * jamais l'écran.
 *
 * La contre-valeur en dinars est calculée par le serveur, à partir du taux
 * saisi le jour de la dépense. Recalculer plus tard au cours du jour
 * réécrirait l'histoire d'un dossier déjà clos.
 */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const today = () => new Date().toISOString().slice(0, 10)

export function ExpensesCard({ caseId, shipmentId }: { caseId?: string; shipmentId?: string }) {
  const v = useVisible()
  const { t, formatMoney, formatDate } = useI18n()
  const toast = useToast()

  const [rows, setRows] = useState<Expense[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try { setRows(await loadExpenses({ caseId, shipmentId })); setError(null) }
    catch (e) { setError((e as Error).message) }
  }, [caseId, shipmentId])

  useEffect(() => { void reload() }, [reload])

  // Le coût de revient reste à la direction : la politique du serveur dit la
  // même chose, on ne montre pas une carte vide à qui n'a pas le droit.
  if (!v.can('finance:global')) return null

  if (!HAS_BACKEND) {
    return (
      <Card title={t('com.expenses')}>
        <Empty title={t('com.offline')} hint={t('com.offlineHint')} scene="alerte" />
      </Card>
    )
  }

  const total = rows.reduce((s, e) => s + e.amountBase, 0)

  return (
    <>
      <Card
        title={t('com.expenses')}
        action={v.can('payment:write')
          ? <Button icon="plus" onClick={() => setAdding(true)}>{t('com.newExpense')}</Button>
          : undefined}
        flush
      >
        {error && <p className="t-small t-orange" style={{ padding: '0 var(--sp-6)' }}>{error}</p>}

        {rows.length === 0 ? (
          <Empty title={t('com.noExpenses')} hint={t('com.noExpensesHint')} />
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('com.spentOn')}</th>
                  <th>{t('com.category')}</th>
                  <th>{t('com.supplier')}</th>
                  <th className="num">{t('com.amount')}</th>
                  <th className="num">{t('com.amountBase')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="t-caption t-tertiary">{formatDate(e.spentOn)}</td>
                    <td className="t-small">{t(`com.expCat${cap(e.category)}` as 'com.expCatAutre')}</td>
                    <td className="t-small t-secondary">{e.supplierName ?? '...'}</td>
                    <td className="num t-small">{formatMoney(e.amount, e.currency)}</td>
                    <td className="num t-medium">{formatMoney(e.amountBase)}</td>
                    <td style={{ textAlign: 'end' }}>
                      {v.can('finance:global') && (
                        <Button size="sm" icon="trash"
                          onClick={() => void archiveExpense(e.id).then(reload).catch((x) => setError((x as Error).message))}>
                          {t('com.removeLine')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4} className="t-small t-medium">{t('com.expenses')}</td>
                  <td className="num t-medium">{formatMoney(total)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding && (
        <ExpenseEditor
          caseId={caseId}
          shipmentId={shipmentId}
          onClose={() => setAdding(false)}
          onSaved={async () => { setAdding(false); await reload(); toast(t('com.saved')) }}
        />
      )}
    </>
  )
}

function ExpenseEditor({ caseId, shipmentId, onClose, onSaved }: {
  caseId?: string
  shipmentId?: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { db } = useStore()
  const v = useVisible()
  const { t } = useI18n()

  const [category, setCategory] = useState<ExpenseCategory>('autre')
  const [supplier, setSupplier] = useState('')
  const [amount, setAmount] = useState('0')
  const [currency, setCurrency] = useState(db.agency.currency)
  const [fxRate, setFxRate] = useState('1')
  const [method, setMethod] = useState('')
  const [spentOn, setSpentOn] = useState(today())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sameCurrency = currency === db.agency.currency

  const submit = async () => {
    setBusy(true)
    try {
      await addExpense(db.agency.id, {
        officeId: v.officeId ?? v.user.officeId ?? null,
        caseId: caseId ?? null,
        shipmentId: shipmentId ?? null,
        category,
        supplierName: supplier.trim() || null,
        amount: Math.max(0, Number(amount) || 0),
        currency,
        // Une dépense dans la devise de l'agence n'a pas de taux : forcer 1
        // évite une contre-valeur fausse si le champ a été touché par erreur.
        fxRate: sameCurrency ? 1 : Math.max(0.000001, Number(fxRate) || 1),
        paymentMethod: method || null,
        spentOn,
        note: note.trim() || null,
      })
      await onSaved()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('com.newExpense')}
      onClose={onClose}
      footer={
        <>
          <span className="grow" />
          <Button onClick={onClose}>{t('com.cancel')}</Button>
          <Button variant="primary" disabled={busy || Number(amount) <= 0} onClick={() => void submit()}>
            {t('com.save')}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <div className="grid grid--2">
          <Field label={t('com.category')}>
            <Select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(`com.expCat${cap(c)}` as 'com.expCatAutre')}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('com.supplier')}>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Field label={t('com.amount')}>
            <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t('com.currency')}>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} />
          </Field>
          {!sameCurrency && (
            <Field label={t('com.fxRate')} hint={t('com.fxHint')}>
              <Input type="number" min={0} step="0.000001" value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
            </Field>
          )}
          <Field label={t('com.spentOn')}>
            <Input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
          </Field>
          <Field label={t('com.method')}>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">{t('com.none')}</option>
              <option value="especes">{t('com.methodEspeces')}</option>
              <option value="virement">{t('com.methodVirement')}</option>
              <option value="carte">{t('com.methodCarte')}</option>
              <option value="cheque">{t('com.methodCheque')}</option>
            </Select>
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
