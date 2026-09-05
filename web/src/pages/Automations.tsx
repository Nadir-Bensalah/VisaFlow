import { useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Card, Field, IconButton, Input, Modal, Pill, Select, Switch, useToast } from '@/components/ui'
import { Ago, PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { ACTIVE_STAGES } from '@/lib/derive'
import type { ActionType, AutomationRule, Channel, Stage, TriggerType } from '@/data/types'

const TRIGGERS: TriggerType[] = [
  'piece_manquante_depuis', 'dossier_sans_activite', 'rendez_vous_dans',
  'passeport_expire_dans', 'depart_dans', 'solde_impaye_depuis', 'etape_atteinte',
]
const ACTION_TYPES: ActionType[] = ['message_client', 'tache_agent', 'alerte_interne', 'changer_etape']

export function Automations() {
  const { db, actions } = useStore()
  const { t, tt } = useI18n()
  const toast = useToast()
  const [editing, setEditing] = useState<AutomationRule | 'nouvelle' | null>(null)
  const [removing, setRemoving] = useState<AutomationRule | null>(null)

  const triggerLabel = (rule: (typeof db.rules)[number]) =>
    t(`auto.t.${rule.trigger.type}` as 'auto.t.depart_dans', {
      n: rule.trigger.days ?? 0,
      stage: rule.trigger.stage ? t(`stage.${rule.trigger.stage}` as 'stage.nouveau') : '',
    })

  return (
    <>
      <PageHead
        title={t('auto.title')}
        subtitle={t('auto.subtitle')}
        action={
          <div className="row gap-2">
            <Button icon="plus" onClick={() => setEditing('nouvelle')}>{t('auto.newRule')}</Button>
            <Button
              variant="primary"
              icon="sparkle"
              onClick={() => {
                const n = actions.runRules()
                toast(t('auto.simulated', { n }))
              }}
            >
              {t('auto.simulate')}
            </Button>
          </div>
        }
      />

      <div className="col gap-4">
        {db.rules.map((rule) => (
          <Card key={rule.id}>
            <div className="row-between wrap gap-4">
              <div className="col grow gap-3" style={{ minWidth: 240 }}>
                <div className="row gap-3">
                  <span className="t-medium">{tt(rule.name)}</span>
                  {rule.active ? <Pill tone="green" dot>{t('auto.active')}</Pill> : <Pill tone="gray" dot>{t('auto.paused')}</Pill>}
                </div>
                <div className="row gap-3 wrap t-small t-secondary">
                  <span className="row gap-2">
                    <Icon name="clock" size={15} className="t-tertiary" />
                    {triggerLabel(rule)}
                  </span>
                  <Icon name="arrow" size={14} className="t-tertiary" />
                  <span className="row gap-2">
                    <Icon name={rule.action.type === 'message_client' ? 'messages' : rule.action.type === 'tache_agent' ? 'tasks' : 'alert'} size={15} className="t-tertiary" />
                    {t(`auto.a.${rule.action.type}` as 'auto.a.message_client')}
                    {rule.action.templateKey && ` · ${tt(db.templates.find((x) => x.key === rule.action.templateKey)?.name)}`}
                  </span>
                </div>
                <div className="t-caption t-tertiary">
                  {t('auto.runs', { n: rule.runs })}
                  {rule.lastRunAt && <> · {t('auto.lastRun')} <Ago iso={rule.lastRunAt} /></>}
                </div>
              </div>
              <div className="row gap-2">
                <IconButton icon="edit" label={t('crud.edit')} onClick={() => setEditing(rule)} />
                <IconButton icon="trash" label={t('crud.remove')} onClick={() => setRemoving(rule)} />
                <Switch checked={rule.active} onChange={() => actions.toggleRule(rule.id)} label={tt(rule.name)} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-6)' }}>
        {t('settings.complianceHint')}
      </p>

      {editing && <RuleEditor rule={editing === 'nouvelle' ? null : editing} onClose={() => setEditing(null)} />}

      {removing && (
        <Modal
          title={t('crud.remove')}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button onClick={() => setRemoving(null)}>{t('action.cancel')}</Button>
              <Button variant="danger" onClick={() => { actions.removeRule(removing.id); setRemoving(null); toast(t('crud.removed')) }}>
                {t('crud.remove')}
              </Button>
            </>
          }
        >
          <p className="t-small">{t('crud.confirmRemove', { name: tt(removing.name) })}</p>
        </Modal>
      )}
    </>
  )

  function RuleEditor({ rule, onClose }: { rule: AutomationRule | null; onClose: () => void }) {
    const [draft, setDraft] = useState<AutomationRule>(
      rule ?? {
        id: `r_${Date.now().toString(36)}`,
        agencyId: db.agency.id,
        name: { fr: '' },
        trigger: { type: 'piece_manquante_depuis', days: 3 },
        action: { type: 'message_client', templateKey: db.templates[0]?.key, channel: 'whatsapp' },
        active: true,
        runs: 0,
      },
    )
    const needsDays = draft.trigger.type !== 'etape_atteinte'

    return (
      <Modal
        wide
        title={rule ? t('crud.edit') : t('auto.newRule')}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>{t('action.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!draft.name.fr.trim()}
              onClick={() => { actions.saveRule(draft); onClose(); toast(rule ? t('crud.updated') : t('crud.created')) }}
            >
              {t('action.save')}
            </Button>
          </>
        }
      >
        <div className="col gap-4">
          <Field label={t('clients.name')}>
            <Input value={draft.name.fr} onChange={(e) => setDraft({ ...draft, name: { ...draft.name, fr: e.target.value } })} />
          </Field>

          <div className="grid grid--2">
            <Field label={t('auto.trigger')}>
              <Select
                value={draft.trigger.type}
                onChange={(e) => setDraft({ ...draft, trigger: { ...draft.trigger, type: e.target.value as TriggerType } })}
              >
                {TRIGGERS.map((x) => (
                  <option key={x} value={x}>{t(`auto.t.${x}` as 'auto.t.depart_dans', { n: draft.trigger.days ?? 0, stage: '' })}</option>
                ))}
              </Select>
            </Field>
            {needsDays ? (
              <Field label={t('reports.days', { n: draft.trigger.days ?? 0 })}>
                <Input
                  type="number"
                  min={0}
                  value={draft.trigger.days ?? 0}
                  onChange={(e) => setDraft({ ...draft, trigger: { ...draft.trigger, days: Number(e.target.value) } })}
                />
              </Field>
            ) : (
              <Field label={t('cases.stage')}>
                <Select
                  value={draft.trigger.stage ?? 'consulat'}
                  onChange={(e) => setDraft({ ...draft, trigger: { ...draft.trigger, stage: e.target.value as Stage } })}
                >
                  {ACTIVE_STAGES.map((x) => (
                    <option key={x} value={x}>{t(`stage.${x}` as 'stage.nouveau')}</option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <div className="grid grid--2">
            <Field label={t('auto.action')}>
              <Select
                value={draft.action.type}
                onChange={(e) => setDraft({ ...draft, action: { ...draft.action, type: e.target.value as ActionType } })}
              >
                {ACTION_TYPES.map((x) => (
                  <option key={x} value={x}>{t(`auto.a.${x}` as 'auto.a.message_client')}</option>
                ))}
              </Select>
            </Field>
            {draft.action.type === 'message_client' && (
              <Field label={t('msg.template')}>
                <Select
                  value={draft.action.templateKey ?? ''}
                  onChange={(e) => setDraft({ ...draft, action: { ...draft.action, templateKey: e.target.value } })}
                >
                  {db.templates.map((tpl) => <option key={tpl.id} value={tpl.key}>{tt(tpl.name)}</option>)}
                </Select>
              </Field>
            )}
            {draft.action.type === 'message_client' && (
              <Field label={t('channel.whatsapp')}>
                <Select
                  value={draft.action.channel ?? 'whatsapp'}
                  onChange={(e) => setDraft({ ...draft, action: { ...draft.action, channel: e.target.value as Channel } })}
                >
                  {(['whatsapp', 'email', 'sms', 'portail'] as Channel[]).map((c) => (
                    <option key={c} value={c}>{t(`channel.${c}` as 'channel.whatsapp')}</option>
                  ))}
                </Select>
              </Field>
            )}
            {draft.action.type === 'changer_etape' && (
              <Field label={t('cases.stage')}>
                <Select
                  value={draft.action.stage ?? 'verification'}
                  onChange={(e) => setDraft({ ...draft, action: { ...draft.action, stage: e.target.value as Stage } })}
                >
                  {ACTIVE_STAGES.map((x) => (
                    <option key={x} value={x}>{t(`stage.${x}` as 'stage.nouveau')}</option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <div className="row-between">
            <span className="t-small t-secondary">{t('auto.active')}</span>
            <Switch checked={draft.active} onChange={(value) => setDraft({ ...draft, active: value })} label={tt(draft.name)} />
          </div>
        </div>
      </Modal>
    )
  }
}
