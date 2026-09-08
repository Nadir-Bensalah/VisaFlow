import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Field, Input, Modal, Pill, Select, Switch, Tabs, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import {
  CUSTOM_FIELD_KINDS, ENTITY_KINDS, deactivateCustomField, listCustomFields, saveCustomField,
  type CustomField, type CustomFieldKind, type EntityKind,
} from '@/data/integrite'
import type { I18nText } from '@/data/types'

/**
 * Le réglage des champs personnalisés, pour l'écran des Réglages.
 *
 * Deux décisions se voient à l'écran.
 *
 * Le CODE ne se change plus une fois le champ créé : c'est lui qui relie la
 * définition aux valeurs déjà saisies, et le renommer les orphelinerait toutes
 * en silence.
 *
 * On ne SUPPRIME pas un champ, on le désactive. Il disparaît des fiches, et les
 * valeurs restent en base : une agence qui range un champ par erreur ne perd
 * pas deux ans de saisie.
 */
export function CustomFieldsAdmin() {
  const { t, tt } = useI18n()
  const [kind, setKind] = useState<EntityKind>('CLIENT')
  const [rows, setRows] = useState<CustomField[]>([])
  const [editing, setEditing] = useState<CustomField | 'nouveau' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = (k: EntityKind) => {
    listCustomFields(k).then(setRows).catch((e: Error) => setError(e.message))
  }

  useEffect(() => { reload(kind) }, [kind])

  return (
    <>
      <Card
        title={t('int.customAdmin')}
        action={<Button icon="plus" onClick={() => setEditing('nouveau')}>{t('int.newField')}</Button>}
      >
        <p className="t-small t-secondary" style={{ marginTop: 0 }}>{t('int.customAdminSub')}</p>

        <Tabs
          idPrefix="cf"
          value={kind}
          onChange={setKind}
          options={ENTITY_KINDS.map((k) => ({ value: k, label: t(`int.e${k}` as 'int.eCLIENT') }))}
        />

        {error && <p className="t-small t-tertiary">{t('int.loadError', { msg: error })}</p>}

        {rows.length === 0 ? (
          <Empty title={t('int.noCustom')} hint={t('int.customAdminSub')} scene="vide" />
        ) : (
          <div className="list" style={{ marginTop: 'var(--sp-4)' }}>
            {rows.map((f) => (
              <button key={f.id} type="button" className="list__row" onClick={() => setEditing(f)}>
                <Icon name="settings" size={16} className="t-tertiary" />
                <span className="col grow" style={{ minWidth: 0, textAlign: 'start' }}>
                  <span className="t-small t-medium t-truncate">{tt(f.label)}</span>
                  <span className="t-caption t-tertiary t-mono">{f.code}</span>
                </span>
                {f.required && <Pill tone="orange">{t('int.required')}</Pill>}
                <Pill tone={f.active ? 'green' : 'gray'}>{t(`int.k${cap(f.kind)}` as 'int.kTexte')}</Pill>
              </button>
            ))}
          </div>
        )}
      </Card>

      {editing && (
        <FieldEditor
          field={editing === 'nouveau' ? null : editing}
          entityKind={kind}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(kind) }}
        />
      )}
    </>
  )
}

function cap(k: CustomFieldKind): string {
  return k.charAt(0).toUpperCase() + k.slice(1)
}

function FieldEditor({ field, entityKind, onClose, onSaved }: {
  field: CustomField | null
  entityKind: EntityKind
  onClose: () => void
  onSaved: () => void
}) {
  const { t, locale } = useI18n()
  const toast = useToast()
  const [code, setCode] = useState(field?.code ?? '')
  const [label, setLabel] = useState<I18nText>(field?.label ?? { fr: '' })
  const [kind, setKind] = useState<CustomFieldKind>(field?.kind ?? 'texte')
  const [options, setOptions] = useState((field?.options ?? []).join('\n'))
  const [required, setRequired] = useState(field?.required ?? false)
  const [position, setPosition] = useState(String(field?.position ?? 100))
  const [active, setActive] = useState(field?.active ?? true)
  const [busy, setBusy] = useState(false)

  const list = options.split('\n').map((s) => s.trim()).filter(Boolean)
  const codeOk = /^[a-z][a-z0-9_]{0,38}$/.test(code)
  const valid = codeOk && (label.fr ?? '').trim() !== '' && (kind !== 'liste' || list.length > 0)

  const submit = async () => {
    setBusy(true)
    try {
      await saveCustomField({
        entityKind, code, label, kind, options: list, required,
        position: Number(position) || 100, active,
      }, field?.id)
      toast(t('int.saved'))
      onSaved()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={field ? t('int.editField') : t('int.newField')}
      onClose={onClose}
      footer={
        <>
          {field && (
            <Button
              icon="trash"
              onClick={async () => {
                await deactivateCustomField(field.id)
                toast(t('int.removed'))
                onSaved()
              }}
            >
              {t('int.deactivate')}
            </Button>
          )}
          <span className="grow" />
          <Button onClick={onClose}>{t('int.cancel')}</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={submit}>{t('int.save')}</Button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label={t('int.label')}>
          <Input
            value={label[locale] ?? label.fr ?? ''}
            onChange={(e) => setLabel({ ...label, fr: label.fr ?? '', [locale]: e.target.value })}
            autoFocus
          />
        </Field>

        <Field label={t('int.code')} hint={t('int.codeHint')}>
          <Input
            value={code}
            disabled={Boolean(field)}
            onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
          />
        </Field>

        <div className="grid grid--2">
          <Field label={t('int.fieldKind')}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as CustomFieldKind)}>
              {CUSTOM_FIELD_KINDS.map((k) => (
                <option key={k} value={k}>{t(`int.k${cap(k)}` as 'int.kTexte')}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('int.position')}>
            <Input type="number" value={position} onChange={(e) => setPosition(e.target.value)} />
          </Field>
        </div>

        {kind === 'liste' && (
          <Field label={t('int.options')} hint={t('int.optionsHint')}>
            <Textarea value={options} onChange={(e) => setOptions(e.target.value)} rows={4} />
          </Field>
        )}

        <Switch checked={required} onChange={setRequired} label={t('int.required')} />
        <Switch checked={active} onChange={setActive} label={t('int.active')} />
        <p className="t-caption t-tertiary" style={{ margin: 0 }}>{t('int.deactivateHint')}</p>
      </div>
    </Modal>
  )
}
