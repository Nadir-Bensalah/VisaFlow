import { useEffect, useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Card, Field, Input, Pill, Select, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import {
  NUMBERING_KINDS, RESET_PERIODS, listNumberingRules, previewPattern,
  removeNumberingRule, saveNumberingRule,
  type NumberingKind, type NumberingRule, type ResetPeriod,
} from '@/data/integrite'

/**
 * Le réglage de la numérotation, pour l'écran des Réglages.
 *
 * Une seule chose compte ici, et elle est écrite à l'écran : tant qu'aucun
 * format n'est posé, RIEN NE CHANGE. Une agence installée depuis deux ans garde
 * exactement les références qu'elle avait hier. Changer la numérotation d'une
 * agence en production casse le lien entre ses dossiers et ses classeurs, et ça
 * ne se répare pas.
 *
 * L'aperçu est calculé à l'écran, jamais en tirant un vrai numéro : un aperçu
 * qui consomme un numéro laisse des trous dans la suite, et une suite à trous
 * n'est plus une suite.
 */
export function NumberingSection() {
  const { db } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const [rules, setRules] = useState<NumberingRule[]>([])
  const [kind, setKind] = useState<NumberingKind>('case')
  const [pattern, setPattern] = useState('')
  const [reset, setReset] = useState<ResetPeriod>('annuel')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = () => {
    listNumberingRules().then(setRules).catch((e: Error) => setError(e.message))
  }
  useEffect(reload, [])

  // Changer de document recharge le format posé pour lui, s'il y en a un.
  useEffect(() => {
    const r = rules.find((x) => x.kind === kind)
    setPattern(r?.pattern ?? '')
    setReset(r?.resetPeriod ?? 'annuel')
  }, [kind, rules])

  const current = rules.find((r) => r.kind === kind)
  const officeName = db.agency.offices[0]?.name ?? null
  const hasCounter = /\{SEQ(:\d+)?\}/.test(pattern)

  const submit = async () => {
    setBusy(true)
    try {
      await saveNumberingRule(kind, pattern.trim(), reset, true, current?.id)
      toast(t('int.ruleSaved'))
      reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const drop = async () => {
    if (!current) return
    setBusy(true)
    try {
      await removeNumberingRule(current.id)
      toast(t('int.ruleRemoved'))
      reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t('int.numbering')}>
      <p className="t-small t-secondary" style={{ marginTop: 0 }}>{t('int.numberingSub')}</p>
      {error && <p className="t-small t-tertiary">{t('int.loadError', { msg: error })}</p>}

      <div className="col gap-4">
        <div className="grid grid--2">
          <Field label={t('int.docKind')}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as NumberingKind)}>
              {NUMBERING_KINDS.map((k) => (
                <option key={k} value={k}>{t(`int.n${k.charAt(0).toUpperCase()}${k.slice(1)}` as 'int.nCase')}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('int.reset')}>
            <Select value={reset} onChange={(e) => setReset(e.target.value as ResetPeriod)}>
              {RESET_PERIODS.map((p) => (
                <option key={p} value={p}>{t(`int.r${p.charAt(0).toUpperCase()}${p.slice(1)}` as 'int.rAnnuel')}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label={t('int.pattern')}
          hint={t('int.patternHint')}
          error={pattern !== '' && !hasCounter ? t('int.patternInvalid') : undefined}
        >
          <Input
            value={pattern}
            placeholder="VIS-{OFFICE}-{YYYY}-{SEQ:6}"
            onChange={(e) => setPattern(e.target.value)}
          />
        </Field>

        <div className="row-between">
          <span className="t-small t-secondary">{t('int.preview')}</span>
          {pattern.trim() === ''
            ? <Pill tone="gray">{t('int.defaultRule')}</Pill>
            : <span className="t-small t-mono t-medium">{previewPattern(pattern, officeName)}</span>}
        </div>
        <p className="t-caption t-tertiary" style={{ margin: 0 }}>{t('int.previewHint')}</p>

        {!current && (
          <p className="t-caption t-tertiary" style={{ margin: 0 }}>
            <Icon name="shield" size={14} /> {t('int.defaultRuleHint')}
          </p>
        )}
        <p className="t-caption t-tertiary" style={{ margin: 0 }}>
          <Icon name="alert" size={14} /> {t('int.dangerRenumber')}
        </p>

        <div className="row gap-2">
          <Button variant="primary" disabled={!hasCounter || busy} onClick={submit}>
            {current ? t('int.save') : t('int.setRule')}
          </Button>
          {current && <Button icon="trash" disabled={busy} onClick={drop}>{t('int.ruleRemoved')}</Button>}
        </div>
      </div>
    </Card>
  )
}
