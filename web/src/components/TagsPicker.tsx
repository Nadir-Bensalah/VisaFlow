import { useCallback, useEffect, useState } from 'react'
import { HAS_BACKEND } from '@/lib/supabase'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import {
  createTagDef, listTagDefs, loadClientTags, setClientTags,
  type TagDef,
} from '@/data/crm'
import { Button, Card, Empty, Field, Input, Modal, Select, useToast } from '@/components/ui'
import type { Tone } from '@/lib/derive'

/* Les étiquettes d'un client.
 *
 * La colonne `clients.tags` existait déjà et ne bouge pas : elle garde les
 * libellés. Ce qui manquait, c'était le vocabulaire. Sans liste fermée, chacun
 * tape « VIP », « vip » et « V.I.P », et le filtre ne trouve plus rien.
 */

const COLORS: Tone[] = ['gray', 'blue', 'green', 'orange', 'red', 'violet']

export function TagsPicker({ clientId }: { clientId: string }) {
  const v = useVisible()
  const { t } = useI18n()
  const toast = useToast()
  const [defs, setDefs] = useState<TagDef[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [loading, setLoading] = useState(HAS_BACKEND)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  const canWrite = v.can('client:write')

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) { setLoading(false); return }
    try {
      const [d, mine] = await Promise.all([listTagDefs(), loadClientTags(clientId)])
      setDefs(d)
      setTags(mine)
    } catch { /* l'écran client ne tombe pas pour une étiquette */ }
    finally { setLoading(false) }
  }, [clientId])

  useEffect(() => { void reload() }, [reload])

  if (!HAS_BACKEND) return null
  if (loading) return <Card title={t('crm.tagsTitle')}><Empty title="…" scene="aucune" /></Card>

  const toggle = async (label: string) => {
    if (!canWrite || busy) return
    const next = tags.includes(label) ? tags.filter((x) => x !== label) : [...tags, label]
    // On peint tout de suite, puis on écrit : le clic sur une étiquette doit
    // répondre à l'instant, c'est un geste qu'on répète toute la journée.
    setTags(next)
    setBusy(true)
    try {
      await setClientTags(clientId, next)
    } catch (e) {
      setTags(tags)
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Une étiquette posée jadis puis retirée du vocabulaire reste visible : on
  // ne l'efface pas en douce du dos de l'agent.
  const orphans = tags.filter((x) => !defs.some((d) => d.label === x))

  return (
    <>
      <Card
        title={t('crm.tagsTitle')}
        action={canWrite ? <Button icon="plus" onClick={() => setAdding(true)}>{t('crm.tagAdd')}</Button> : undefined}
      >
        {defs.length === 0 && orphans.length === 0 ? (
          <p className="t-small t-tertiary" style={{ margin: 0 }}>{t('crm.tagsNone')}</p>
        ) : (
          <div className="col gap-3">
            <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
              {defs.map((d) => {
                const on = tags.includes(d.label)
                return (
                  <button
                    key={d.id}
                    type="button"
                    className="chip"
                    aria-pressed={on}
                    disabled={!canWrite}
                    onClick={() => void toggle(d.label)}
                    style={on ? undefined : { color: `var(--${d.color === 'gray' ? 'text-secondary' : d.color})` }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8, height: 8, borderRadius: 999,
                        background: `var(--${d.color === 'gray' ? 'text-tertiary' : d.color})`,
                      }}
                    />
                    {d.label}
                  </button>
                )
              })}
              {orphans.map((label) => (
                <button
                  key={label}
                  type="button"
                  className="chip"
                  aria-pressed
                  disabled={!canWrite}
                  onClick={() => void toggle(label)}
                >
                  {label}
                </button>
              ))}
            </div>
            {canWrite && <p className="t-caption t-tertiary" style={{ margin: 0 }}>{t('crm.tagsHint')}</p>}
          </div>
        )}
      </Card>

      {adding && (
        <TagCreator onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await reload() }} />
      )}
    </>
  )
}

function TagCreator({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useI18n()
  const toast = useToast()
  const [label, setLabel] = useState('')
  const [color, setColor] = useState<Tone>('blue')
  const [busy, setBusy] = useState(false)

  return (
    <Modal
      title={t('crm.tagAdd')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button
            variant="primary"
            disabled={busy || label.trim() === ''}
            onClick={async () => {
              setBusy(true)
              try {
                await createTagDef(label.trim(), color)
                toast(t('crud.created'))
                await onSaved()
              } catch (e) {
                toast(e instanceof Error ? e.message : String(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('action.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label={t('crm.tagLabel')}>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </Field>
        <Field label={t('crm.tagColor')}>
          <Select value={color} onChange={(e) => setColor(e.target.value as Tone)}>
            {COLORS.map((c) => (
              <option key={c} value={c}>{t(`crm.co_${c}` as 'crm.co_gray')}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  )
}
