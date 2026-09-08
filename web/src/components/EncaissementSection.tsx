import { useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Field, Input, Modal, Pill, Select, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import type { PaymentProvider, ProviderKind } from '@/data/types'

/**
 * Les devises acceptées et les moyens d'encaissement de l'agence.
 *
 * ============================================================================
 * LA RÈGLE QUI COMMANDE TOUT CET ÉCRAN
 * ============================================================================
 *
 * VisaFlow n'encaisse JAMAIS l'argent des clients d'une agence. Encaisser pour
 * le compte d'autrui puis reverser, c'est fournir un service de paiement, et
 * cela suppose un agrément de la Banque centrale. Les fonds de Paymee ont été
 * gelés par la CTAF en février 2023 pour exactement cela.
 *
 * Donc : chaque agence branche SON compte chez SON prestataire. L'outil
 * fabrique le lien de paiement avec les identifiants de l'agence et enregistre
 * la réponse. L'argent va de la banque à l'agence, sans jamais passer par nous.
 * L'écran le dit, parce qu'une agence a le droit de savoir où va son argent.
 */

const KINDS: { kind: ProviderKind; zone: 'tn' | 'ly' | 'intl' | 'manuel' }[] = [
  { kind: 'clictopay', zone: 'tn' },
  { kind: 'paymee', zone: 'tn' },
  { kind: 'konnect', zone: 'tn' },
  { kind: 'flouci', zone: 'tn' },
  { kind: 'sadad', zone: 'ly' },
  { kind: 'moamalat', zone: 'ly' },
  { kind: 'stripe', zone: 'intl' },
  { kind: 'adyen', zone: 'intl' },
  { kind: 'paypal', zone: 'intl' },
  { kind: 'virement', zone: 'manuel' },
  { kind: 'cheque', zone: 'manuel' },
  { kind: 'especes', zone: 'manuel' },
  { kind: 'autre', zone: 'manuel' },
]

const DEVISES = ['TND', 'LYD', 'USD', 'EUR', 'CNY', 'GBP', 'AED', 'SAR']

export function EncaissementSection() {
  const { db, actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const [editing, setEditing] = useState<PaymentProvider | 'nouveau' | null>(null)

  const a = db.agency
  const acceptees = a.currencies?.length ? a.currencies : [a.currency]

  const basculer = (code: string) => {
    const next = acceptees.includes(code)
      ? acceptees.filter((c) => c !== code)
      : [...acceptees, code]
    // La devise de référence ne se retire pas : c'est celle des totaux.
    if (!next.includes(a.currency)) next.push(a.currency)
    actions.updateAgency({ currencies: next })
  }

  return (
    <div className="stack">
      <Card title={t('pay2.currencies')}>
        <div className="col gap-4">
          <p className="t-small t-secondary" style={{ margin: 0 }}>
            {t('pay2.currenciesHint', { base: a.currency })}
          </p>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            {DEVISES.map((code) => {
              const on = acceptees.includes(code)
              const base = code === a.currency
              return (
                <button
                  key={code}
                  type="button"
                  className={`btn ${on ? 'btn--primary' : 'btn--secondary'} btn--sm`}
                  disabled={base}
                  onClick={() => basculer(code)}
                  title={base ? t('pay2.baseLocked') : undefined}
                >
                  {code}{base ? ' ★' : ''}
                </button>
              )
            })}
          </div>
          <p className="t-caption t-tertiary" style={{ margin: 0 }}>{t('pay2.fxHint')}</p>
        </div>
      </Card>

      <Card
        title={t('pay2.providers')}
        action={<Button variant="primary" icon="plus" onClick={() => setEditing('nouveau')}>{t('pay2.addProvider')}</Button>}
        flush
      >
        {/* On dit où va l'argent. Une agence a le droit de le savoir. */}
        <p className="tariff__why">
          <Icon name="shield" size={14} />
          <span>{t('pay2.neverHold')}</span>
        </p>

        {db.providers.length === 0 ? (
          <Empty
            title={t('pay2.none')}
            hint={t('pay2.noneHint')}
            scene="vide"
            action={<Button variant="primary" icon="plus" onClick={() => setEditing('nouveau')}>{t('pay2.addProvider')}</Button>}
          />
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('pay2.provider')}</th>
                  <th>{t('pay2.label')}</th>
                  <th>{t('pay2.currenciesShort')}</th>
                  <th>{t('pay2.merchantRef')}</th>
                  <th>{t('pay2.mode')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {db.providers.map((p) => (
                  <tr key={p.id} style={p.active ? undefined : { opacity: 0.55 }}>
                    <td className="t-small t-medium">{t(`pay2.k_${p.kind}` as 'pay2.k_stripe')}</td>
                    <td className="t-small">{p.label}</td>
                    <td className="t-caption t-mono">{p.currencies.join(' · ') || '—'}</td>
                    <td className="t-caption t-tertiary">{p.merchantRef ?? '—'}</td>
                    <td>
                      <Pill tone={p.mode === 'live' ? 'green' : 'gray'}>
                        {t(`pay2.mode_${p.mode}` as 'pay2.mode_test')}
                      </Pill>
                    </td>
                    <td><Button icon="edit" onClick={() => setEditing(p)}>{t('crud.edit')}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <ProviderEditor
          provider={editing === 'nouveau' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { toast(t('crud.updated')); setEditing(null) }}
        />
      )}
    </div>
  )
}

function ProviderEditor({ provider, onClose, onSaved }: {
  provider: PaymentProvider | null; onClose: () => void; onSaved: () => void
}) {
  const { db, actions } = useStore()
  const { t } = useI18n()

  const [kind, setKind] = useState<ProviderKind>(provider?.kind ?? 'clictopay')
  const [label, setLabel] = useState(provider?.label ?? '')
  const [currencies, setCurrencies] = useState<string[]>(provider?.currencies ?? [db.agency.currency])
  const [merchantRef, setMerchantRef] = useState(provider?.merchantRef ?? '')
  const [secretName, setSecretName] = useState(provider?.secretName ?? '')
  const [mode, setMode] = useState<'test' | 'live'>(provider?.mode ?? 'test')
  const [active, setActive] = useState(provider?.active ?? true)

  const zone = KINDS.find((k) => k.kind === kind)?.zone ?? 'manuel'
  const carte = zone !== 'manuel'
  const acceptees = db.agency.currencies?.length ? db.agency.currencies : [db.agency.currency]

  return (
    <Modal
      title={provider ? t('pay2.editProvider') : t('pay2.addProvider')}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!label.trim()}
            onClick={() => {
              actions.saveProvider({
                ...(provider ? { id: provider.id } : {}),
                kind, label: label.trim(), currencies,
                merchantRef: merchantRef.trim() || undefined,
                secretName: secretName.trim() || undefined,
                mode, active,
              })
              onSaved()
            }}
          >
            {t('action.save')}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <div className="grid grid--2">
          <Field label={t('pay2.provider')}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as ProviderKind)}>
              {KINDS.map(({ kind: k }) => (
                <option key={k} value={k}>{t(`pay2.k_${k}` as 'pay2.k_stripe')}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('pay2.label')} hint={t('pay2.labelHint')}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t(`pay2.k_${kind}` as 'pay2.k_stripe')} />
          </Field>
        </div>

        {/* Stripe est le cas où il faut être précis, parce que la question
            revient toujours et que la réponse n'est pas « oui ». */}
        {kind === 'stripe' && (
          <p className="fret__warn" style={{ margin: 0 }}>
            <Icon name="alert" size={16} />
            <span>{t('pay2.stripeWarn')}</span>
          </p>
        )}

        {carte && (
          <>
            <div className="grid grid--2">
              <Field label={t('pay2.merchantRef')} hint={t('pay2.merchantRefHint')}>
                <Input value={merchantRef} onChange={(e) => setMerchantRef(e.target.value)} />
              </Field>
              <Field label={t('pay2.secretName')} hint={t('pay2.secretNameHint')}>
                <Input value={secretName} onChange={(e) => setSecretName(e.target.value)} placeholder="cle_clictopay_tca" />
              </Field>
            </div>
            <p className="schengen__note" style={{ margin: 0 }}>
              <Icon name="lock" size={14} />
              <span>{t('pay2.secretExplain')}</span>
            </p>
          </>
        )}

        <div className="col gap-2">
          <span className="t-caption t-tertiary">{t('pay2.currenciesShort')}</span>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            {acceptees.map((c) => (
              <button
                key={c}
                type="button"
                className={`btn ${currencies.includes(c) ? 'btn--primary' : 'btn--secondary'} btn--sm`}
                onClick={() => setCurrencies((prev) =>
                  prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c])}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid--2">
          <Field label={t('pay2.mode')} hint={t('pay2.modeHint')}>
            <Select value={mode} onChange={(e) => setMode(e.target.value as 'test' | 'live')}>
              <option value="test">{t('pay2.mode_test')}</option>
              <option value="live">{t('pay2.mode_live')}</option>
            </Select>
          </Field>
          <Field label={t('misc.active')}>
            <Select value={active ? 'oui' : 'non'} onChange={(e) => setActive(e.target.value === 'oui')}>
              <option value="oui">{t('misc.active')}</option>
              <option value="non">{t('misc.inactive')}</option>
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  )
}
