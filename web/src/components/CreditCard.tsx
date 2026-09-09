import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Card, Empty, Field, Input, Modal, Pill, Switch, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { loadClientCredit, loadCreditState, saveClientCredit } from '@/data/cargo2'
import type { ClientCredit, CreditDraft, CreditState } from '@/data/cargo2'

/**
 * Le crédit d'un client professionnel.
 *
 * L'écran ne calcule RIEN. La limite est saisie, l'encours et le disponible
 * descendent du serveur, où ils sont recalculés depuis les factures à chaque
 * lecture. Un encours stocké dérive, et une dérive fait vendre à crédit à un
 * client qui ne paie plus : c'est exactement l'accident que cette carte doit
 * empêcher.
 */

export function CreditCard({ clientId }: { clientId: string }) {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatMoney } = useI18n()
  const toast = useToast()

  const [row, setRow] = useState<ClientCredit | null>(null)
  const [state, setState] = useState<CreditState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<CreditDraft>({
    creditLimit: 0, paymentTermsDays: 0, currency: db.agency.currency,
    onHold: false, holdReason: null,
  })

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try {
      const [c, s] = await Promise.all([loadClientCredit(clientId), loadCreditState(clientId)])
      setRow(c); setState(s); setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [clientId])

  useEffect(() => { void reload() }, [reload])

  const open = () => {
    setDraft(row
      ? { creditLimit: row.creditLimit, paymentTermsDays: row.paymentTermsDays,
          currency: row.currency, onHold: row.onHold, holdReason: row.holdReason }
      : { creditLimit: 0, paymentTermsDays: 0, currency: db.agency.currency,
          onHold: false, holdReason: null })
    setEditing(true)
  }

  const submit = async () => {
    try {
      await saveClientCredit(db.agency.id, clientId, draft)
      setEditing(false); toast(t('cg2.saved')); await reload()
    } catch (e) { setError((e as Error).message) }
  }

  // La ligne de crédit relève de la finance, pas de l'exploitation. Le serveur
  // la cache déjà ; l'écran ne doit pas laisser croire qu'elle n'existe pas.
  if (!v.can('finance:global')) return null

  if (!HAS_BACKEND) {
    return (
      <Card title={t('cg2.credit')}>
        <Empty title={t('cg2.offline')} hint={t('cg2.offlineHint')} scene="alerte" />
      </Card>
    )
  }

  const devise = state?.devise ?? db.agency.currency

  return (
    <Card
      title={t('cg2.credit')}
      action={
        <Button icon="edit" onClick={open}>
          {row ? t('cg2.save') : t('cg2.configure')}
        </Button>
      }
    >
      {error && <p className="t-small t-orange">{t('cg2.loadError', { msg: error })}</p>}

      {!state || !state.configure ? (
        <Empty title={t('cg2.notConfigured')} hint={t('cg2.notConfiguredHint')} scene="vide" />
      ) : (
        <div className="col gap-4">
          <div className="row-between">
            <span className="t-small t-secondary">{t('cg2.creditSub')}</span>
            {state.bloque
              ? <Pill tone="red" dot>{t('cg2.blocked')}</Pill>
              : <Pill tone="green" dot>{t('cg2.notBlocked')}</Pill>}
          </div>

          <div className="col gap-2">
            <Line label={t('cg2.creditLimit')} value={formatMoney(state.limite, devise)} />
            <Line label={t('cg2.outstanding')} value={formatMoney(state.encours, devise)} />
            <Line
              label={t('cg2.available')}
              value={
                <span className={state.disponible === 0 ? 't-red' : ''}>
                  {formatMoney(state.disponible, devise)}
                </span>
              }
            />
            <Line
              label={t('cg2.daysLate')}
              value={state.jours_de_retard > 0
                ? <span className="t-red">{t('cg2.daysLateValue', { n: state.jours_de_retard })}</span>
                : t('cg2.noLate')}
            />
            <Line label={t('cg2.terms')} value={t('cg2.termsDays', { n: state.delai_paiement_jours })} />
          </div>

          {state.motif && (
            <p className="t-small t-orange">
              <Icon name="alert" size={13} /> {t('cg2.holdReason')} · {state.motif}
            </p>
          )}

          {/* D'où vient l'encours : c'est ce qui rend le chiffre discutable, et
              donc utilisable dans une conversation avec le client. */}
          <p className="t-caption t-tertiary">
            {state.source === 'factures' ? t('cg2.sourceInvoices') : t('cg2.sourcePayments')}
            {' · '}
            {t('cg2.computedHint')}
          </p>
        </div>
      )}

      {editing && (
        <Modal
          title={t('cg2.credit')}
          onClose={() => setEditing(false)}
          footer={
            <>
              <Button onClick={() => setEditing(false)}>{t('cg2.cancel')}</Button>
              <Button variant="primary" onClick={() => void submit()}>{t('cg2.save')}</Button>
            </>
          }
        >
          <div className="col gap-3">
            <Field label={t('cg2.creditLimit')}>
              <Input
                type="number"
                value={draft.creditLimit}
                onChange={(e) => setDraft({ ...draft, creditLimit: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('cg2.terms')}>
              <Input
                type="number"
                value={draft.paymentTermsDays}
                onChange={(e) => setDraft({ ...draft, paymentTermsDays: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('cg2.currency')}>
              <Input
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase().slice(0, 3) })}
              />
            </Field>
            <div className="row-between">
              <span className="t-small">{t('cg2.onHold')}</span>
              <Switch
                checked={draft.onHold}
                onChange={(checked) => setDraft({ ...draft, onHold: checked })}
                label={t('cg2.onHold')}
              />
            </div>
            {draft.onHold && (
              <Field label={t('cg2.holdReason')}>
                <Input value={draft.holdReason ?? ''} onChange={(e) => setDraft({ ...draft, holdReason: e.target.value || null })} />
              </Field>
            )}
            <p className="t-caption t-tertiary">{t('cg2.computedHint')}</p>
          </div>
        </Modal>
      )}
    </Card>
  )
}

function Line({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="row-between">
      <span className="t-small t-secondary">{label}</span>
      <span className="t-small" style={{ textAlign: 'end' }}>{value ?? '·'}</span>
    </div>
  )
}
