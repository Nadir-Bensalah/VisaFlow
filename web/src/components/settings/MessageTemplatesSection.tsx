import { useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Button, Card, Field, IconButton, Input, Modal, Select, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import type { Channel, I18nText, MessageTemplate } from '@/data/types'

const EMPTY_I18N: I18nText = { fr: '' }

/* Les modèles de message : ce que l'agence écrit une fois et renvoie cent
   fois. Ils sont écrits dans les quatre langues, parce que le client reçoit
   dans la sienne, jamais dans celle de l'agent. */
export function MessageTemplatesSection() {
  const { db, actions } = useStore()
  const { t, tt } = useI18n()
  const toast = useToast()
  const [editing, setEditing] = useState<MessageTemplate | 'nouveau' | null>(null)
  const [removing, setRemoving] = useState<MessageTemplate | null>(null)

  return (
    <>
      <div className="row-between" style={{ marginBottom: 'var(--sp-5)' }}>
        <p className="t-small t-secondary">{t('msg.languageAuto')}</p>
        <Button icon="plus" onClick={() => setEditing('nouveau')}>{t('crud.newTemplate')}</Button>
      </div>

      <div className="grid grid--2">
        {db.templates.map((tpl) => (
          <Card
            key={tpl.id}
            title={tt(tpl.name)}
            action={
              <span className="row gap-1">
                <IconButton icon="edit" label={t('crud.edit')} onClick={() => setEditing(tpl)} />
                <IconButton icon="trash" label={t('crud.remove')} onClick={() => setRemoving(tpl)} />
              </span>
            }
          >
            <div className="col gap-3">
              <span className="row gap-2 t-caption t-tertiary">
                <Icon name={tpl.channel === 'whatsapp' ? 'whatsapp' : 'mail'} size={14} />
                {t(`channel.${tpl.channel}` as 'channel.whatsapp')} · {tpl.key}
              </span>
              {LOCALES.filter((l) => tpl.body[l]).map((l) => (
                <div key={l} className="row gap-3" style={{ alignItems: 'flex-start' }}>
                  <span className="chip" style={{ cursor: 'default', flex: '0 0 auto' }}>{LOCALE_META[l].native}</span>
                  <span className="t-small t-secondary" dir={LOCALE_META[l].dir} lang={l}>{tpl.body[l]}</span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {editing && <TemplateEditor template={editing === 'nouveau' ? null : editing} onClose={() => setEditing(null)} />}

      {removing && (
        <Modal
          title={t('crud.remove')}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button onClick={() => setRemoving(null)}>{t('action.cancel')}</Button>
              <Button variant="danger" onClick={() => { actions.removeTemplate(removing.id); setRemoving(null); toast(t('crud.removed')) }}>
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
}

function TemplateEditor({ template, onClose }: { template: MessageTemplate | null; onClose: () => void }) {
  const { actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const [draft, setDraft] = useState<Omit<MessageTemplate, 'agencyId'>>(
    template ?? {
      id: '', key: '', name: { ...EMPTY_I18N }, channel: 'whatsapp',
      body: { fr: '', en: '', ar: '', zh: '' }, variables: ['client', 'reference'],
    },
  )
  const variables = '{client}, {reference}, {piece}, {montant}, {bureau}, {pays}, {date}, {lieu}'

  return (
    <Modal
      wide
      title={template ? t('crud.edit') : t('crud.newTemplate')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!draft.name.fr.trim() || !draft.body.fr.trim()}
            onClick={() => {
              const key = draft.key.trim() || draft.name.fr.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30)
              actions.saveTemplate(template ? { ...draft, key } : { ...draft, key, id: undefined })
              onClose()
              toast(template ? t('crud.updated') : t('crud.created'))
            }}
          >
            {t('action.save')}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <div className="grid grid--2">
          <Field label={t('clients.name')}>
            <Input value={draft.name.fr} onChange={(e) => setDraft({ ...draft, name: { ...draft.name, fr: e.target.value } })} />
          </Field>
          <Field label={t('crud.templateKey')} hint={t('crud.fillFrench')}>
            <Input value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} placeholder="piece_manquante" />
          </Field>
        </div>
        <Field label={t('msg.template')}>
          <Select value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value as Channel })}>
            {(['whatsapp', 'email', 'sms', 'portail'] as Channel[]).map((c) => (
              <option key={c} value={c}>{t(`channel.${c}` as 'channel.whatsapp')}</option>
            ))}
          </Select>
        </Field>
        <p className="t-caption t-tertiary">{t('crud.variablesHint', { vars: variables })}</p>
        {LOCALES.map((l) => (
          <Field key={l} label={`${t('crud.templateBody')} · ${LOCALE_META[l].native}`}>
            <Textarea
              dir={LOCALE_META[l].dir}
              lang={l}
              value={draft.body[l] ?? ''}
              onChange={(e) => setDraft({ ...draft, body: { ...draft.body, [l]: e.target.value } })}
            />
          </Field>
        ))}
      </div>
    </Modal>
  )
}
