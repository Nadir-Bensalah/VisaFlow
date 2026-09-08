import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { can } from '@/lib/permissions'
import { Button, Card, Field, IconButton, Input, Modal, Pill, Select, Switch, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import {
  LIVE_CHANNELS, NOTIFS_ONLINE, NOTIF_CHANNELS, NOTIF_GROUPS, NOTIF_RECIPIENTS,
  listRules, removeRule, runSweep, updateRule, upsertRule,
  type NotifChannel, type NotifEvent, type NotifRecipient, type NotificationRule,
} from '@/data/notifs'

/**
 * Qui est prévenu, et comment.
 *
 * L'écran est bâti autour d'une seule idée : une alerte dans l'application ne
 * coûte rien, un message au client coûte de l'argent et engage l'agence. Les
 * deux moitiés sont donc séparées à l'œil, et celle qui écrit au client porte
 * un avertissement en clair. Aucune règle vers le client n'arrive allumée :
 * c'est le serveur qui le garantit (migration 0051), l'écran ne fait que le
 * rendre visible.
 *
 * Ce que l'écran ne fait PAS : inventer un texte de message. Un modèle sans
 * corps bloque l'envoi côté serveur, et l'écran le dit plutôt que de laisser
 * croire que le client a été prévenu.
 */
export function NotificationRules() {
  const { db } = useStore()
  const v = useVisible()
  const { t, tt } = useI18n()
  const toast = useToast()

  const [rules, setRules] = useState<NotificationRule[]>([])
  const [editing, setEditing] = useState<NotificationRule | { event: NotifEvent } | null>(null)
  const [busy, setBusy] = useState(false)

  const writable = can(v.user, 'automation:manage') && NOTIFS_ONLINE

  const reload = useCallback(async () => {
    if (!NOTIFS_ONLINE) return
    try {
      setRules(await listRules(db.agency.id))
    } catch {
      // Un écran de réglages ne doit pas casser la page qui le contient.
      setRules([])
    }
  }, [db.agency.id])

  useEffect(() => { void reload() }, [reload])

  const byEvent = useMemo(() => {
    const map = new Map<string, NotificationRule[]>()
    for (const r of rules) {
      const list = map.get(r.event) ?? []
      list.push(r)
      map.set(r.event, list)
    }
    return map
  }, [rules])

  const toggle = async (rule: NotificationRule) => {
    setBusy(true)
    try {
      await updateRule(rule.id, { enabled: !rule.enabled })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const drop = async (rule: NotificationRule) => {
    setBusy(true)
    try {
      await removeRule(rule.id)
      await reload()
      toast(t('crud.removed'))
    } finally {
      setBusy(false)
    }
  }

  const sweep = async () => {
    setBusy(true)
    try {
      const res = await runSweep()
      toast(t('notif.rules.sweepDone', { n: res?.deposees ?? 0 }))
      await reload()
    } catch {
      toast(t('notif.rules.error'))
    } finally {
      setBusy(false)
    }
  }

  const label = (r: NotificationRule) => {
    const chan = t(`notif.c.${r.channel}` as 'notif.c.in_app')
    const to = t(`notif.r.${r.recipient}` as 'notif.r.client')
    return `${chan} · ${to}`
  }

  return (
    <>
      <Card
        title={t('notif.rules.title')}
        action={
          writable
            ? <Button icon="refresh" disabled={busy} onClick={() => void sweep()}>{t('notif.rules.sweep')}</Button>
            : undefined
        }
      >
        <p className="t-small t-secondary" style={{ marginBottom: 'var(--sp-4)' }}>
          {t('notif.rules.subtitle')}
        </p>

        {!NOTIFS_ONLINE && (
          <p className="t-caption t-tertiary row gap-2" style={{ marginBottom: 'var(--sp-4)' }}>
            <Icon name="shield" size={14} />
            <span>{t('notif.rules.offline')}</span>
          </p>
        )}

        <div className="col gap-6">
          {NOTIF_GROUPS.map((group) => (
            <div key={group.key} className="col gap-3">
              <span className="t-small t-medium">{t(`notif.g.${group.key}` as 'notif.g.dossier')}</span>

              {group.events.map((event) => {
                const list = byEvent.get(event) ?? []
                return (
                  <div key={event} className="col gap-2" style={{ paddingInlineStart: 'var(--sp-2)' }}>
                    <div className="row-between gap-3">
                      <span className="t-small t-secondary">
                        {t(`notif.e.${event}` as 'notif.e.dossier.decision')}
                      </span>
                      {writable && (
                        <Button icon="plus" onClick={() => setEditing({ event })}>{t('notif.rules.add')}</Button>
                      )}
                    </div>

                    {list.length === 0 ? (
                      <span className="t-caption t-tertiary">{t('notif.rules.none')}</span>
                    ) : (
                      list.map((r) => (
                        <div key={r.id} className="row-between gap-3 wrap">
                          <div className="col gap-1" style={{ minWidth: 200 }}>
                            <span className="row gap-2 t-small">
                              <Icon name={r.channel === 'whatsapp' ? 'whatsapp' : 'bell'} size={14} className="t-tertiary" />
                              {label(r)}
                              {r.recipient === 'client'
                                ? <Pill tone="orange">{t('notif.rules.toClient')}</Pill>
                                : <Pill tone="gray">{t('notif.rules.team')}</Pill>}
                            </span>
                            <span className="t-caption t-tertiary">
                              {r.templateKey
                                ? tt(db.templates.find((x) => x.key === r.templateKey)?.name) || r.templateKey
                                : t('notif.rules.noTemplate')}
                              {r.delayMinutes > 0 && ` · ${t('notif.rules.delay')} ${r.delayMinutes}′`}
                            </span>
                            {r.recipient === 'client' && !r.enabled && (
                              <span className="t-caption t-orange">{t('notif.rules.clientWarn')}</span>
                            )}
                            {!LIVE_CHANNELS.includes(r.channel) && (
                              <span className="t-caption t-tertiary">{t('notif.rules.noTransport')}</span>
                            )}
                            {r.channel === 'whatsapp' && !r.templateKey && (
                              <span className="t-caption t-orange">{t('notif.rules.needTemplate')}</span>
                            )}
                          </div>
                          <div className="row gap-2">
                            {writable && <IconButton icon="edit" label={t('crud.edit')} onClick={() => setEditing(r)} />}
                            {writable && <IconButton icon="trash" label={t('crud.remove')} onClick={() => void drop(r)} />}
                            <Switch
                              checked={r.enabled}
                              onChange={() => { if (writable) void toggle(r) }}
                              label={label(r)}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </Card>

      {editing && (
        <RuleEditor
          agencyId={db.agency.id}
          rule={'id' in editing ? editing : null}
          event={'id' in editing ? editing.event : editing.event}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); toast(t('crud.updated')) }}
        />
      )}
    </>
  )
}

function RuleEditor({ agencyId, rule, event, onClose, onSaved }: {
  agencyId: string
  rule: NotificationRule | null
  event: NotifEvent
  onClose: () => void
  onSaved: () => void
}) {
  const { db } = useStore()
  const { t, tt } = useI18n()

  const [channel, setChannel] = useState<NotifChannel>(rule?.channel ?? 'in_app')
  const [recipient, setRecipient] = useState<NotifRecipient>(rule?.recipient ?? 'agent')
  const [templateKey, setTemplateKey] = useState<string>(rule?.templateKey ?? '')
  const [delay, setDelay] = useState<string>(String(rule?.delayMinutes ?? 0))
  const [saving, setSaving] = useState(false)

  // Un message au client sans texte ne part pas : le serveur le refuse, et
  // l'écran doit le refuser avant, sinon l'agence croit avoir réglé quelque
  // chose qui ne s'exécutera jamais.
  const needsTemplate = channel !== 'in_app' && recipient === 'client'
  const valid = !needsTemplate || templateKey !== ''

  const submit = async () => {
    setSaving(true)
    try {
      if (rule) {
        await updateRule(rule.id, {
          templateKey: templateKey || null,
          delayMinutes: Math.max(0, Number(delay) || 0),
        })
      } else {
        await upsertRule({
          agencyId, event, channel, recipient,
          // Une règle naît éteinte. Celle qui écrit au client surtout : elle
          // engage l'agence, et personne d'autre que l'agence ne l'allume.
          enabled: false,
          templateKey: templateKey || null,
          delayMinutes: Math.max(0, Number(delay) || 0),
        })
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={rule ? t('notif.rules.edit') : t('notif.rules.add')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={!valid || saving} onClick={() => void submit()}>
            {t('action.confirm')}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label={t('notif.rules.event')}>
          <Input value={t(`notif.e.${event}` as 'notif.e.dossier.decision')} readOnly />
        </Field>

        <div className="grid grid--2">
          <Field label={t('notif.rules.channel')}
                 hint={LIVE_CHANNELS.includes(channel) ? undefined : t('notif.rules.noTransport')}>
            <Select value={channel} disabled={!!rule}
                    onChange={(e) => setChannel(e.target.value as NotifChannel)}>
              {NOTIF_CHANNELS.map((c) => (
                <option key={c} value={c}>{t(`notif.c.${c}` as 'notif.c.in_app')}</option>
              ))}
            </Select>
          </Field>

          <Field label={t('notif.rules.recipient')}
                 hint={recipient === 'client' ? t('notif.rules.clientWarn') : undefined}>
            <Select value={recipient} disabled={!!rule}
                    onChange={(e) => setRecipient(e.target.value as NotifRecipient)}>
              {NOTIF_RECIPIENTS.map((r) => (
                <option key={r} value={r}>{t(`notif.r.${r}` as 'notif.r.client')}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label={t('notif.rules.template')}
               error={needsTemplate && !templateKey ? t('notif.rules.needTemplate') : undefined}>
          <Select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
            <option value="">{t('notif.rules.noTemplate')}</option>
            {db.templates.map((x) => (
              <option key={x.key} value={x.key}>{tt(x.name)}</option>
            ))}
          </Select>
        </Field>

        <Field label={t('notif.rules.delay')} hint={t('notif.rules.delayHint')}>
          <Input type="number" min={0} value={delay} onChange={(e) => setDelay(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
