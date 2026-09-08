import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { can } from '@/lib/permissions'
import { Button, Card, Empty, Field, IconButton, Input, Modal, Pill, Select, Switch, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import {
  NOTIFS_ONLINE, NOTIF_EVENTS,
  listDeliveries, listWebhooks, removeWebhook, saveWebhook,
  type Webhook, type WebhookDelivery,
} from '@/data/notifs'

/**
 * Les webhooks de l'agence.
 *
 * Deux choses ne se négocient pas ici.
 *
 * 1. LE SECRET NE PASSE PAS PAR CE NAVIGATEUR. On saisit le NOM du secret dans
 *    le coffre Supabase, jamais sa valeur. Une clé de signature affichée dans
 *    un écran de réglages est une clé de signature copiée.
 * 2. L'HISTORIQUE DIT LA VÉRITÉ. Un webhook qui échoue en silence est pire que
 *    pas de webhook : l'agence croit son autre logiciel à jour. On montre donc
 *    le code HTTP, le nombre de tentatives, et la dernière erreur telle quelle.
 */
export function WebhooksSection() {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatDate } = useI18n()
  const toast = useToast()

  const [hooks, setHooks] = useState<Webhook[]>([])
  const [editing, setEditing] = useState<Webhook | 'nouveau' | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])

  const writable = can(v.user, 'automation:manage') && NOTIFS_ONLINE

  const reload = useCallback(async () => {
    if (!NOTIFS_ONLINE) return
    try {
      setHooks(await listWebhooks(db.agency.id))
    } catch {
      setHooks([])
    }
  }, [db.agency.id])

  useEffect(() => { void reload() }, [reload])

  const openHistory = async (id: string) => {
    if (open === id) { setOpen(null); return }
    setOpen(id)
    try {
      setDeliveries(await listDeliveries(id, 20))
    } catch {
      setDeliveries([])
    }
  }

  const drop = async (hook: Webhook) => {
    await removeWebhook(hook.id)
    await reload()
    toast(t('crud.removed'))
  }

  const toggle = async (hook: Webhook) => {
    await saveWebhook({
      id: hook.id,
      agencyId: hook.agencyId,
      event: hook.event,
      endpoint: hook.endpoint,
      secretName: hook.secretName,
      active: !hook.active,
    })
    await reload()
  }

  return (
    <>
      <Card
        title={t('notif.wh.title')}
        action={
          writable
            ? <Button variant="primary" icon="plus" onClick={() => setEditing('nouveau')}>{t('notif.wh.add')}</Button>
            : undefined
        }
      >
        <p className="t-small t-secondary" style={{ marginBottom: 'var(--sp-4)' }}>
          {t('notif.wh.subtitle')}
        </p>

        {hooks.length === 0 ? (
          <Empty
            title={t('notif.wh.none')}
            hint={NOTIFS_ONLINE ? t('notif.wh.noneHint') : t('notif.rules.offline')}
            scene="vide"
            action={
              writable
                ? <Button variant="primary" icon="plus" onClick={() => setEditing('nouveau')}>{t('notif.wh.add')}</Button>
                : undefined
            }
          />
        ) : (
          <div className="col gap-4">
            {hooks.map((h) => (
              <div key={h.id} className="col gap-2">
                <div className="row-between gap-3 wrap">
                  <div className="col gap-1" style={{ minWidth: 220 }}>
                    <span className="row gap-2 t-small t-medium">
                      <Icon name="portal" size={15} className="t-tertiary" />
                      <span className="t-mono t-truncate">{h.endpoint}</span>
                    </span>
                    <span className="t-caption t-tertiary">
                      {h.event === '*'
                        ? t('notif.wh.allEvents')
                        : t(`notif.e.${h.event}` as 'notif.e.dossier.decision')}
                      {h.secretName && <> · <span className="t-mono">{h.secretName}</span></>}
                    </span>
                    {h.lastSuccessAt && (
                      <span className="t-caption t-tertiary">
                        {t('notif.wh.lastSuccess')} {formatDate(h.lastSuccessAt)}
                      </span>
                    )}
                    {h.failureCount > 0 && (
                      <span className="t-caption t-orange">
                        {t('notif.wh.failures', { n: h.failureCount })}
                        {h.lastError && ` · ${h.lastError}`}
                      </span>
                    )}
                  </div>
                  <div className="row gap-2">
                    <Button icon="clock" onClick={() => void openHistory(h.id)}>{t('notif.wh.history')}</Button>
                    {writable && <IconButton icon="edit" label={t('crud.edit')} onClick={() => setEditing(h)} />}
                    {writable && <IconButton icon="trash" label={t('crud.remove')} onClick={() => void drop(h)} />}
                    <Switch checked={h.active} onChange={() => { if (writable) void toggle(h) }} label={h.endpoint} />
                  </div>
                </div>

                {open === h.id && (
                  <div className="tablewrap">
                    {deliveries.length === 0 ? (
                      <p className="t-caption t-tertiary">{t('notif.wh.historyNone')}</p>
                    ) : (
                      <table className="table">
                        <thead>
                          <tr>
                            <th>{t('notif.wh.event')}</th>
                            <th>{t('notif.wh.status')}</th>
                            <th className="num">{t('notif.wh.attempts')}</th>
                            <th className="num">{t('notif.wh.httpStatus')}</th>
                            <th>{t('notif.wh.lastError')}</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {deliveries.map((d) => (
                            <tr key={d.id}>
                              <td className="t-caption">
                                {t(`notif.e.${d.event}` as 'notif.e.dossier.decision')}
                              </td>
                              <td>
                                <Pill tone={d.status === 'envoye' ? 'green' : d.status === 'echoue' ? 'red' : 'gray'}>
                                  {t(`notif.wh.s.${d.status}` as 'notif.wh.s.envoye')}
                                </Pill>
                              </td>
                              <td className="num t-caption">{d.attempts}</td>
                              <td className="num t-caption">{d.httpStatus ?? ''}</td>
                              <td className="t-caption t-tertiary t-truncate">{d.responseExcerpt ?? ''}</td>
                              <td className="t-caption t-tertiary">{formatDate(d.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-2)' }}>
                      {t('notif.wh.retryRule')}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {editing && (
        <WebhookEditor
          agencyId={db.agency.id}
          hook={editing === 'nouveau' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); toast(t('crud.updated')) }}
        />
      )}
    </>
  )
}

function WebhookEditor({ agencyId, hook, onClose, onSaved }: {
  agencyId: string
  hook: Webhook | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [endpoint, setEndpoint] = useState(hook?.endpoint ?? 'https://')
  const [event, setEvent] = useState(hook?.event ?? '*')
  const [secretName, setSecretName] = useState(hook?.secretName ?? '')
  const [active, setActive] = useState(hook?.active ?? true)
  const [saving, setSaving] = useState(false)

  // La base refuse tout ce qui n'est pas https. On le dit ici plutôt que de
  // laisser l'agence buter sur un message d'erreur de PostgreSQL.
  const valid = /^https:\/\/.+/.test(endpoint.trim())

  const submit = async () => {
    setSaving(true)
    try {
      await saveWebhook({
        ...(hook ? { id: hook.id } : {}),
        agencyId,
        event,
        endpoint: endpoint.trim(),
        secretName: secretName.trim() || null,
        active,
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={hook ? t('notif.wh.edit') : t('notif.wh.add')}
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
        <Field label={t('notif.wh.endpoint')} hint={t('notif.wh.endpointHint')}>
          <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://" />
        </Field>

        <Field label={t('notif.wh.event')}>
          <Select value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="*">{t('notif.wh.allEvents')}</option>
            {NOTIF_EVENTS.map((x) => (
              <option key={x} value={x}>{t(`notif.e.${x}` as 'notif.e.dossier.decision')}</option>
            ))}
          </Select>
        </Field>

        {/* Le NOM du secret, jamais sa valeur. */}
        <Field label={t('notif.wh.secret')} hint={t('notif.wh.secretHint')}>
          <Input value={secretName} onChange={(e) => setSecretName(e.target.value)} placeholder="WEBHOOK_COMPTA" />
        </Field>

        <div className="row-between">
          <span className="t-small">{t('notif.wh.active')}</span>
          <Switch checked={active} onChange={setActive} label={t('notif.wh.active')} />
        </div>
      </div>
    </Modal>
  )
}
