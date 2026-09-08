import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { HAS_BACKEND } from '@/lib/supabase'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Card, Empty, Field, Input, Pill, Select, Switch, useToast } from '@/components/ui'
import { duree } from '@/lib/graphes'
import {
  loadSlaBreaches, loadSlaRules, saveSlaRule,
  type SlaBreach, type SlaEvent, type SlaRule,
} from '@/data/pilotage'

/* Les délais de service, section 184. Se monte dans les Réglages.
 *
 * TOUT EST DÉSACTIVÉ AU DÉPART, et c'est le point le plus important de cet
 * écran. Un délai qu'une agence n'a pas choisi produit dès le premier jour des
 * alertes qu'elle n'a pas demandées ; dès le deuxième, elle apprend à les
 * ignorer ; et cette habitude déteint ensuite sur les alertes qui comptent. La
 * bascule est donc à elle, et le texte le dit. */

const EVENT_LABEL: Record<SlaEvent, 'pil.eventLead_nouveau'> = {
  lead_nouveau: 'pil.eventLead_nouveau',
  document_recu: 'pil.eventDocument_recu' as 'pil.eventLead_nouveau',
  cargaison_arrivee: 'pil.eventCargaison_arrivee' as 'pil.eventLead_nouveau',
  dossier_bloque: 'pil.eventDossier_bloque' as 'pil.eventLead_nouveau',
  message_client: 'pil.eventMessage_client' as 'pil.eventLead_nouveau',
  paiement_du: 'pil.eventPaiement_du' as 'pil.eventLead_nouveau',
}

export function SlaSection() {
  const v = useVisible()
  const { t, formatDate } = useI18n()
  const toast = useToast()
  const [rules, setRules] = useState<SlaRule[]>([])
  const [breaches, setBreaches] = useState<SlaBreach[]>([])
  const [loading, setLoading] = useState(HAS_BACKEND)
  const [error, setError] = useState<string | null>(null)

  const canWrite = v.can('settings:manage')

  const charger = useCallback(async () => {
    if (!HAS_BACKEND) { setLoading(false); return }
    setLoading(true)
    try {
      const [r, b] = await Promise.all([loadSlaRules(), loadSlaBreaches(v.officeId)])
      setRules(r)
      setBreaches(b)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [v.officeId])

  useEffect(() => { void charger() }, [charger])

  async function patch(rule: SlaRule, p: Partial<{ targetMinutes: number; active: boolean; appliesToRole: string | null }>) {
    const avant = rules
    setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, ...p } : r)))
    try {
      await saveSlaRule(rule.id, p)
      toast(t('pil.saved'))
      await charger()
    } catch (e) {
      setRules(avant)
      toast(t('pil.loadError', { msg: (e as Error).message }))
    }
  }

  if (!HAS_BACKEND) {
    return <Card title={t('pil.slaTitle')}><Empty title={t('pil.offline')} hint={t('pil.offlineHint')} /></Card>
  }
  if (loading) return <Card title={t('pil.slaTitle')}><Empty title={t('pil.loading')} /></Card>
  if (error) return <Card title={t('pil.slaTitle')}><Empty title={t('pil.loadError', { msg: error })} /></Card>

  return (
    <div className="stack">
      <Card title={t('pil.slaTitle')}>
        <p className="t-small t-secondary" style={{ marginBottom: 'var(--sp-3)' }}>{t('pil.slaSub')}</p>
        <p className="t-caption t-tertiary" style={{ marginBottom: 'var(--sp-4)' }}>{t('pil.slaHint')}</p>

        {rules.length === 0 ? (
          <Empty title={t('pil.empty')} />
        ) : (
          <div className="col gap-4">
            {rules.map((r) => (
              <div key={r.id} className="row" style={{ gap: 'var(--sp-4)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <span className="col grow" style={{ minWidth: 160 }}>
                  <span className="t-small t-medium">{t(EVENT_LABEL[r.event])}</span>
                  {r.note && <span className="t-caption t-tertiary">{r.note}</span>}
                </span>

                <Field label={t('pil.slaTarget')}>
                  <Input
                    type="number"
                    min={1}
                    style={{ width: 110 }}
                    value={r.targetMinutes}
                    disabled={!canWrite}
                    onChange={(e) => {
                      const n = Number(e.currentTarget.value)
                      setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, targetMinutes: n } : x)))
                    }}
                    onBlur={(e) => {
                      const n = Number(e.currentTarget.value)
                      if (n >= 1 && n !== r.targetMinutes) void patch(r, { targetMinutes: n })
                      else if (n >= 1) void patch(r, { targetMinutes: n })
                    }}
                  />
                </Field>
                <span className="t-caption t-tertiary" style={{ paddingBottom: 10 }}>
                  {t('pil.slaMinutes')} · {duree(r.targetMinutes)}
                </span>

                <Field label={t('pil.slaRole')}>
                  <Select
                    value={r.appliesToRole ?? ''}
                    disabled={!canWrite}
                    onChange={(e) => void patch(r, { appliesToRole: e.currentTarget.value || null })}
                  >
                    <option value="">{t('pil.slaEveryone')}</option>
                    <option value="owner">{t('pil.roleOwner')}</option>
                    <option value="manager">{t('pil.roleManager')}</option>
                    <option value="agent">{t('pil.roleAgent')}</option>
                    <option value="viewer">{t('pil.roleViewer')}</option>
                  </Select>
                </Field>

                <div style={{ paddingBottom: 6 }}>
                  <Switch
                    checked={r.active}
                    label={t('pil.slaActive')}
                    onChange={(next) => { if (canWrite) void patch(r, { active: next }) }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title={t('pil.slaBreaches')}
        action={<span className="t-caption t-tertiary">{breaches.length}</span>}
        flush
      >
        {breaches.length === 0 ? (
          <Empty title={t('pil.slaNoBreach')} scene="termine" />
        ) : (
          <div className="list">
            {breaches.map((b) => (
              <Link key={`${b.ruleId}-${b.entityId}`} to={b.link} className="list__row">
                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className="t-small t-medium t-truncate">
                    {b.label || b.reference || t(EVENT_LABEL[b.event])}
                  </span>
                  <span className="t-caption t-tertiary t-truncate">
                    {t(EVENT_LABEL[b.event])}
                    {b.reference ? ` · ${b.reference}` : ''}
                    {` · ${formatDate(b.since)}`}
                  </span>
                </span>
                <Pill tone="red">{t('pil.slaOverBy', { n: duree(b.minutesOver) })}</Pill>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
