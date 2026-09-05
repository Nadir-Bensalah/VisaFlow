import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Card, Pill, Switch, useToast } from '@/components/ui'
import { Ago, PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'

export function Automations() {
  const { db, actions } = useStore()
  const { t, tt } = useI18n()
  const toast = useToast()

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
              <Switch checked={rule.active} onChange={() => actions.toggleRule(rule.id)} label={tt(rule.name)} />
            </div>
          </Card>
        ))}
      </div>

      <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-6)' }}>
        {t('settings.complianceHint')}
      </p>
    </>
  )
}
