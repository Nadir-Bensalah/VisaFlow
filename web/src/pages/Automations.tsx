import { useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Empty, Field, Input, Modal, Pill, Segmented, Select, Switch, useToast } from '@/components/ui'
import { Ago } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { Kpi, KpiGrid, PageHeader, Section, Table, Toolbar, Vide } from '@/components/page'
import { ACTIVE_STAGES } from '@/lib/derive'
import type { ActionType, AutomationRule, Channel, Stage, TriggerType } from '@/data/types'
import '@/styles/modules.css'

/* Les règles qui relancent à la place de l'équipe.
 *
 * Chaque règle dit ce qu'elle a fait et quand : une automatisation muette
 * finit par être coupée « au cas où », et plus personne n'ose la rallumer. */

const TRIGGERS: TriggerType[] = [
  'piece_manquante_depuis', 'dossier_sans_activite', 'rendez_vous_dans',
  'passeport_expire_dans', 'depart_dans', 'solde_impaye_depuis', 'etape_atteinte',
]
const ACTION_TYPES: ActionType[] = ['message_client', 'tache_agent', 'alerte_interne', 'changer_etape']

type Vue = 'actives' | 'pause' | 'toutes'

export function Automations() {
  const { db, actions } = useStore()
  const { t, tt, formatDate } = useI18n()
  const toast = useToast()
  const [editing, setEditing] = useState<AutomationRule | 'nouvelle' | null>(null)
  const [removing, setRemoving] = useState<AutomationRule | null>(null)
  const [vue, setVue] = useState<Vue>('toutes')

  const triggerLabel = (rule: AutomationRule) =>
    t(`auto.t.${rule.trigger.type}` as 'auto.t.depart_dans', {
      n: rule.trigger.days ?? 0,
      stage: rule.trigger.stage ? t(`stage.${rule.trigger.stage}` as 'stage.nouveau') : '',
    })

  const compte = useMemo(() => {
    const actives = db.rules.filter((r) => r.active).length
    const runs = db.rules.reduce((s, r) => s + r.runs, 0)
    const derniere = db.rules.map((r) => r.lastRunAt).filter((x): x is string => Boolean(x)).sort().pop() ?? null
    return { actives, pause: db.rules.length - actives, runs, derniere }
  }, [db.rules])

  const montres = useMemo(() => db.rules.filter((r) =>
    vue === 'toutes' ? true : vue === 'actives' ? r.active : !r.active,
  ), [db.rules, vue])

  return (
    <>
      <PageHeader
        kicker={t('mq.kickerPilotage')}
        title={t('auto.title')}
        subtitle={t('mq.autoSub')}
        actions={<>
          <Button icon="plus" onClick={() => setEditing('nouvelle')}>{t('auto.newRule')}</Button>
          <Button
            variant="primary"
            icon="sparkle"
            disabled={compte.actives === 0}
            onClick={() => {
              const n = actions.runRules()
              toast(t('auto.simulated', { n }))
            }}
          >
            {t('auto.simulate')}
          </Button>
        </>}
      />

      <KpiGrid>
        <Kpi label={t('mq.autoActive')} value={compte.actives} icon="automations" tone="green"
             hint={t('mq.autoActiveHint', { n: db.rules.length })} />
        <Kpi label={t('auto.paused')} value={compte.pause} icon="lock"
             tone={compte.pause > 0 ? 'orange' : undefined} hint={t('mq.autoPausedHint')} />
        <Kpi label={t('mq.autoRuns')} value={compte.runs} icon="sparkle" hint={t('mq.autoRunsHint')} />
        <Kpi label={t('auto.lastRun')} icon="clock"
             value={compte.derniere ? formatDate(compte.derniere, { day: '2-digit', month: 'short' }) : '·'}
             hint={compte.derniere ? formatDate(compte.derniere, { hour: '2-digit', minute: '2-digit' }) : t('mq.autoNeverRan')} />
      </KpiGrid>

      {db.rules.length === 0 ? (
        <Section>
          <Empty
            title={t('mq.autoNone')}
            hint={t('mq.autoNoneHint')}
            scene="termine"
            action={<Button variant="primary" icon="plus" onClick={() => setEditing('nouvelle')}>{t('auto.newRule')}</Button>}
          />
        </Section>
      ) : (
        <Section flush>
          <Toolbar right={<span className="t-caption t-tertiary t-num">{t('mq.rowsOf', { n: montres.length, total: db.rules.length })}</span>}>
            <Segmented<Vue>
              value={vue}
              onChange={setVue}
              label={t('auto.active')}
              options={[
                { value: 'toutes', label: `${t('mq.all')} · ${db.rules.length}` },
                { value: 'actives', label: `${t('auto.active')} · ${compte.actives}` },
                { value: 'pause', label: `${t('auto.paused')} · ${compte.pause}` },
              ]}
            />
          </Toolbar>

          {montres.length === 0 ? (
            <Vide title={t('mq.nothingInFilter')} hint={t('mq.nothingInFilterHint')} icon="filter" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t('clients.name')}</th>
                  <th className="col-optional">{t('auto.trigger')}</th>
                  <th className="col-optional">{t('auto.action')}</th>
                  <th className="num col-optional">{t('mq.autoRuns')}</th>
                  <th>{t('auto.active')}</th>
                  <th className="actions" />
                </tr>
              </thead>
              <tbody>
                {montres.map((rule) => (
                  <tr key={rule.id} className={`adm-row--click ${rule.active ? '' : 'adm-row--off'}`} onClick={() => setEditing(rule)}>
                    <td>
                      <div className="adm-cell-main">
                        <span>{tt(rule.name)}</span>
                        <span className="t-caption">
                          {rule.lastRunAt ? <>{t('auto.lastRun')} <Ago iso={rule.lastRunAt} /></> : t('mq.autoNeverRan')}
                        </span>
                      </div>
                    </td>
                    <td className="col-optional t-secondary">
                      <span className="row gap-2"><Icon name="clock" size={14} className="t-tertiary" />{triggerLabel(rule)}</span>
                    </td>
                    <td className="col-optional t-secondary">
                      <span className="row gap-2">
                        <Icon name={rule.action.type === 'message_client' ? 'messages' : rule.action.type === 'tache_agent' ? 'tasks' : 'alert'} size={14} className="t-tertiary" />
                        <span>
                          {t(`auto.a.${rule.action.type}` as 'auto.a.message_client')}
                          {rule.action.templateKey && ` · ${tt(db.templates.find((x) => x.key === rule.action.templateKey)?.name)}`}
                        </span>
                      </span>
                    </td>
                    <td className="num col-optional">{rule.runs}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <span className="row gap-2">
                        <Switch checked={rule.active} onChange={() => actions.toggleRule(rule.id)} label={tt(rule.name)} />
                        {rule.active ? <Pill tone="green" dot>{t('auto.active')}</Pill> : <Pill tone="gray" dot>{t('auto.paused')}</Pill>}
                      </span>
                    </td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" icon="edit" onClick={() => setEditing(rule)}>{t('crud.edit')}</Button>
                      <Button size="sm" icon="trash" onClick={() => setRemoving(rule)}>{t('crud.remove')}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      )}

      <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-2)' }}>
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
