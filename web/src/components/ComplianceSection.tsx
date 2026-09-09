import { useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Card, Field, Input, Pill, Select, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import {
  CASH_PENALTY_MIN, CASH_PENALTY_PCT, CASH_THRESHOLD,
  complianceGaps, onttDeadlines, promiseCheck,
} from '@/lib/conformite'

/**
 * La conformité, celle qui porte des amendes chiffrées.
 *
 * Cet écran ne moralise pas : il nomme précisément ce qui manque, avec le texte
 * et le montant en face. Une agence qui ne remplit pas son matricule fiscal
 * n'est pas « incomplète », elle émet des factures irrégulières.
 *
 * Ce que l'écran ne fait PAS : proposer une politique de remboursement par
 * défaut. Aucun texte tunisien ne la fixe, et aucune source ne dit que les
 * frais consulaires sont non remboursables. Une valeur livrée par l'éditeur
 * deviendrait opposable à l'agence à sa place.
 */
export function ComplianceSection() {
  const { db, actions } = useStore()
  const { t, tt, locale } = useI18n()
  const toast = useToast()
  const a = db.agency

  const [draft, setDraft] = useState({
    taxId: a.taxId ?? '',
    rcNumber: a.rcNumber ?? '',
    rcCourt: a.rcCourt ?? '',
    legalForm: a.legalForm ?? '',
    capital: a.capital != null ? String(a.capital) : '',
    licenseCategory: a.licenseCategory ?? '',
    licenseNumber: a.licenseNumber ?? '',
    inpdpRef: a.inpdpRef ?? '',
    ttnMember: a.ttnMember ?? false,
    ttnRef: a.ttnRef ?? '',
    refundPolicy: a.refundPolicy?.fr ?? '',
    onttChangeAt: a.onttChangeAt ?? '',
    onttFinancialsAt: a.onttFinancialsAt ?? '',
  })
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const gaps = complianceGaps({
    taxId: draft.taxId || undefined,
    rcNumber: draft.rcNumber || undefined,
    rcCourt: draft.rcCourt || undefined,
    legalForm: draft.legalForm || undefined,
    capital: draft.capital ? Number(draft.capital) : undefined,
    licenseCategory: (draft.licenseCategory || undefined) as 'A' | 'B' | undefined,
    licenseNumber: draft.licenseNumber || undefined,
    inpdpRef: draft.inpdpRef || undefined,
    refundPolicy: draft.refundPolicy || undefined,
  })
  const ontt = onttDeadlines({
    onttChangeAt: draft.onttChangeAt || undefined,
    onttFinancialsAt: draft.onttFinancialsAt || undefined,
  })

  // Les modèles de messages qui promettent un résultat. Article 13 de la loi
  // 92-117 : 1 000 à 20 000 DT. Le délai appartient au consulat, pas à l'agence.
  const risky = db.templates
    .map((tpl) => ({ tpl, check: promiseCheck(tpl.body[locale] ?? tpl.body.fr) }))
    .filter((x) => !x.check.clean)

  const save = () => {
    actions.updateAgency({
      taxId: draft.taxId || undefined,
      rcNumber: draft.rcNumber || undefined,
      rcCourt: draft.rcCourt || undefined,
      legalForm: draft.legalForm || undefined,
      capital: draft.capital ? Number(draft.capital) : undefined,
      licenseCategory: (draft.licenseCategory || undefined) as 'A' | 'B' | undefined,
      licenseNumber: draft.licenseNumber || undefined,
      inpdpRef: draft.inpdpRef || undefined,
      ttnMember: draft.ttnMember,
      ttnRef: draft.ttnRef || undefined,
      refundPolicy: draft.refundPolicy ? { fr: draft.refundPolicy } : undefined,
      onttChangeAt: draft.onttChangeAt || undefined,
      onttFinancialsAt: draft.onttFinancialsAt || undefined,
    })
    toast(t('crud.updated'))
  }

  return (
    <div className="stack">
      <Card
        title={t('conf.title')}
        action={<Button variant="primary" onClick={save}>{t('action.save')}</Button>}
      >
        <div className="col gap-5">
          {gaps.length === 0 ? (
            <p className="schengen__note" style={{ margin: 0 }}>
              <Icon name="check" size={14} />
              <span>{t('conf.allSet')}</span>
            </p>
          ) : (
            <p className="fret__warn" style={{ margin: 0 }}>
              <Icon name="alert" size={16} />
              <span>
                {t('conf.missing', { n: gaps.length })}
                {' '}
                {gaps.map((g) => t(`conf.gap_${g}` as 'conf.gap_matricule_fiscal')).join(' · ')}
              </span>
            </p>
          )}

          {/* Les mentions sans lesquelles une facture n'est pas régulière. */}
          <div className="col gap-3">
            <span className="t-caption t-tertiary">{t('conf.invoiceMentions')}</span>
            <div className="grid grid--2">
              <Field label={t('conf.taxId')}>
                <Input value={draft.taxId} onChange={(e) => set('taxId', e.target.value)} />
              </Field>
              <Field label={t('conf.rcNumber')}>
                <Input value={draft.rcNumber} onChange={(e) => set('rcNumber', e.target.value)} />
              </Field>
              <Field label={t('conf.rcCourt')}>
                <Input value={draft.rcCourt} onChange={(e) => set('rcCourt', e.target.value)} placeholder="Tunis" />
              </Field>
              <Field label={t('conf.legalForm')}>
                <Input value={draft.legalForm} onChange={(e) => set('legalForm', e.target.value)} placeholder="SARL" />
              </Field>
              <Field label={t('conf.capital')}>
                <Input type="number" value={draft.capital} onChange={(e) => set('capital', e.target.value)} />
              </Field>
              <Field label={t('conf.inpdp')} hint={t('conf.inpdpHint')}>
                <Input value={draft.inpdpRef} onChange={(e) => set('inpdpRef', e.target.value)} />
              </Field>
            </div>
          </div>

          {/* La licence, et ce qu'elle interdit. */}
          <div className="col gap-3">
            <span className="t-caption t-tertiary">{t('conf.license')}</span>
            <div className="grid grid--2">
              <Field label={t('conf.category')} hint={t('conf.categoryHint')}>
                <Select value={draft.licenseCategory} onChange={(e) => set('licenseCategory', e.target.value as 'A' | 'B' | '')}>
                  <option value="">·</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                </Select>
              </Field>
              <Field label={t('conf.licenseNumber')}>
                <Input value={draft.licenseNumber} onChange={(e) => set('licenseNumber', e.target.value)} />
              </Field>
            </div>
            {draft.licenseCategory === 'B' && (
              <p className="fret__warn" style={{ margin: 0 }}>
                <Icon name="alert" size={14} />
                <span>{t('conf.categoryB')}</span>
              </p>
            )}
          </div>

          {/* TTN : l'obligation ne mord qu'à l'adhésion effective. */}
          <div className="col gap-3">
            <span className="t-caption t-tertiary">{t('conf.ttn')}</span>
            <label className="row gap-2" style={{ alignItems: 'center' }}>
              <input type="checkbox" checked={draft.ttnMember} onChange={(e) => set('ttnMember', e.target.checked)} />
              <span className="t-small">{t('conf.ttnMember')}</span>
            </label>
            {draft.ttnMember ? (
              <Field label={t('conf.ttnRef')}>
                <Input value={draft.ttnRef} onChange={(e) => set('ttnRef', e.target.value)} />
              </Field>
            ) : (
              <p className="schengen__note" style={{ margin: 0 }}>
                <Icon name="check" size={14} />
                <span>{t('conf.ttnPaperOk')}</span>
              </p>
            )}
          </div>

          {/* Le remboursement : déclaré par l'agence, jamais par nous. */}
          <div className="col gap-3">
            <span className="t-caption t-tertiary">{t('conf.refund')}</span>
            <Field label={t('conf.refundPolicy')} hint={t('conf.refundHint')}>
              <Textarea
                value={draft.refundPolicy}
                onChange={(e) => set('refundPolicy', e.target.value)}
                placeholder={t('conf.refundPlaceholder')}
              />
            </Field>
          </div>

          {/* Les échéances ONTT. */}
          <div className="col gap-3">
            <span className="t-caption t-tertiary">{t('conf.ontt')}</span>
            <div className="grid grid--2">
              <Field label={t('conf.onttChange')} hint={ontt.changeDue ? t('conf.dueOn', { date: ontt.changeDue }) : t('conf.onttChangeHint')}>
                <Input type="date" value={draft.onttChangeAt} onChange={(e) => set('onttChangeAt', e.target.value)} />
              </Field>
              <Field label={t('conf.onttFinancials')} hint={ontt.financialsDue ? t('conf.dueOn', { date: ontt.financialsDue }) : t('conf.onttFinancialsHint')}>
                <Input type="date" value={draft.onttFinancialsAt} onChange={(e) => set('onttFinancialsAt', e.target.value)} />
              </Field>
            </div>
            {(ontt.changeLate || ontt.financialsLate) && (
              <p className="fret__warn" style={{ margin: 0 }}>
                <Icon name="alert" size={14} />
                <span>{t('conf.onttLate')}</span>
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* La règle de l'espèces, rappelée là où l'agence la cherche. */}
      <Card title={t('conf.cashRule')}>
        <p className="t-small t-secondary" style={{ margin: 0 }}>
          {t('conf.cashExplain', {
            threshold: CASH_THRESHOLD, pct: CASH_PENALTY_PCT, min: CASH_PENALTY_MIN,
          })}
        </p>
      </Card>

      {/* Les modèles qui promettent un résultat. */}
      <Card title={t('conf.promises')}>
        {risky.length === 0 ? (
          <p className="t-small t-secondary" style={{ margin: 0 }}>{t('conf.promisesClean')}</p>
        ) : (
          <div className="col gap-3">
            <p className="fret__warn" style={{ margin: 0 }}>
              <Icon name="alert" size={16} />
              <span>{t('conf.promisesFound', { n: risky.length })}</span>
            </p>
            {risky.map(({ tpl, check }) => (
              <div key={tpl.id} className="col gap-1" style={{ paddingBottom: 8, borderBottom: '1px solid var(--hairline)' }}>
                <span className="t-small t-medium">{tt(tpl.name)}</span>
                <span className="t-caption t-secondary">{(tpl.body[locale] ?? tpl.body.fr ?? '').slice(0, 120)}</span>
                <span className="row gap-2" style={{ flexWrap: 'wrap' }}>
                  {check.reasons.map((r) => (
                    <Pill key={r} tone="red">{t(`conf.promise_${r}` as 'conf.promise_delai_promis')}</Pill>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
