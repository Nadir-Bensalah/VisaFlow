import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { Card, Empty, Field, Input, Select, Switch, useToast } from '@/components/ui'
import {
  loadCustomValues, setCustomValue, type CustomValue, type EntityKind,
} from '@/data/integrite'

/**
 * Les champs que l'agence s'est ajoutés, sur la fiche où ils comptent.
 *
 * Le point délicat est la validation. Elle n'est PAS faite ici : le serveur
 * vérifie le type et le caractère obligatoire, et c'est son refus qu'on
 * affiche. Une validation écrite deux fois diverge, et c'est toujours celle du
 * navigateur qui reste en arrière.
 *
 * La saisie part au serveur quand le champ perd le focus, pas à chaque frappe :
 * une requête par lettre saturerait la connexion d'une agence de Sfax.
 */
export function CustomFields({ entityKind, entityId }: { entityKind: EntityKind; entityId: string }) {
  const { t, tt } = useI18n()
  const toast = useToast()
  const [rows, setRows] = useState<CustomValue[] | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    loadCustomValues(entityKind, entityId)
      .then((r) => {
        if (!alive) return
        setRows(r)
        setDraft(Object.fromEntries(r.map((f) => [f.fieldId, f.value === null ? '' : String(f.value)])))
      })
      .catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [entityKind, entityId])

  const commit = async (f: CustomValue, value: string) => {
    const before = rows?.find((r) => r.fieldId === f.fieldId)
    const previous = before && before.value !== null ? String(before.value) : ''
    if (value === previous) return
    try {
      const next = await setCustomValue(f.fieldId, entityId, value)
      setRows(next)
      toast(t('int.valueSaved'))
    } catch (e) {
      // Le serveur a refusé : on remet ce qu'il avait, sinon l'écran affiche
      // une valeur que la base ne contient pas.
      setDraft((d) => ({ ...d, [f.fieldId]: previous }))
      toast((e as Error).message)
    }
  }

  if (rows === null) return null
  if (rows.length === 0) {
    return (
      <Card title={t('int.custom')}>
        <Empty title={t('int.noCustom')} hint={t('int.noCustomHint')} scene="vide" />
      </Card>
    )
  }

  return (
    <Card title={t('int.custom')}>
      <div className="col gap-4">
        {rows.map((f) => {
          const value = draft[f.fieldId] ?? ''
          const set = (v: string) => setDraft((d) => ({ ...d, [f.fieldId]: v }))
          const label = `${tt(f.label)}${f.required ? ' *' : ''}`

          if (f.kind === 'booleen') {
            return (
              <Switch
                key={f.fieldId}
                label={label}
                checked={value === 'true'}
                onChange={(v) => { set(String(v)); void commit(f, String(v)) }}
              />
            )
          }

          if (f.kind === 'liste') {
            return (
              <Field key={f.fieldId} label={label}>
                <Select value={value} onChange={(e) => { set(e.target.value); void commit(f, e.target.value) }}>
                  <option value="">{t('int.choose')}</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              </Field>
            )
          }

          return (
            <Field key={f.fieldId} label={label}>
              <Input
                type={f.kind === 'date' ? 'date' : f.kind === 'nombre' ? 'number' : 'text'}
                value={value}
                onChange={(e) => set(e.target.value)}
                onBlur={() => void commit(f, value)}
              />
            </Field>
          )
        })}
      </div>
    </Card>
  )
}
