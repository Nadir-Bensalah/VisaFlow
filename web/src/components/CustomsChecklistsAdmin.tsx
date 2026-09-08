import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Card, Empty, Field, Input, Modal, Pill, Select, Switch, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import {
  CHECKLIST_DIRECTIONS, CHECKLIST_MODES, loadChecklistItems, loadChecklists,
  removeChecklist, removeChecklistItem, saveChecklist, saveChecklistItem, seedChecklists,
} from '@/data/cargo2'
import type {
  ChecklistDirection, ChecklistDraft, ChecklistItemDraft, ChecklistMode,
  CustomsChecklist, CustomsChecklistItem,
} from '@/data/cargo2'

/**
 * Le réglage des checklists douanières.
 *
 * Une liste dont aucun critère n'est rempli s'applique à tout, et perd contre
 * n'importe quelle autre. C'est ce qui permet de partir du socle et de le
 * préciser dossier par dossier, sans jamais tout réécrire.
 *
 * Le champ « exigée » est faux par défaut, et c'est délibéré. Une pièce marquée
 * obligatoire alors qu'elle ne l'est pas fait courir l'agent après un papier
 * inutile. En cas de doute, on laisse facultatif et on écrit pourquoi dans
 * l'aide.
 */

const emptyChecklist = (): ChecklistDraft => ({
  name: '', direction: null, originCountry: null, destinationCountry: null,
  hsChapter: null, transportMode: null, active: true,
})

const emptyItem = (position: number): ChecklistItemDraft => ({
  code: '', label: { fr: '' }, required: false, position, help: null,
})

export function CustomsChecklistsAdmin() {
  const { db } = useStore()
  const v = useVisible()
  const { t, tt } = useI18n()
  const toast = useToast()

  const [rows, setRows] = useState<CustomsChecklist[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [items, setItems] = useState<CustomsChecklistItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<CustomsChecklist | 'new' | null>(null)
  const [draft, setDraft] = useState<ChecklistDraft>(emptyChecklist())
  const [itemEditing, setItemEditing] = useState<CustomsChecklistItem | 'new' | null>(null)
  const [itemDraft, setItemDraft] = useState<ChecklistItemDraft>(emptyItem(100))

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try {
      setRows(await loadChecklists())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    if (!openId) { setItems([]); return }
    void loadChecklistItems(openId).then(setItems).catch((e) => setError((e as Error).message))
  }, [openId])

  const submit = async () => {
    try {
      const id = await saveChecklist(db.agency.id, editing === 'new' ? null : editing?.id ?? null, draft)
      setEditing(null); setOpenId(id); toast(t('cg2.saved')); await reload()
    } catch (e) { setError((e as Error).message) }
  }

  const submitItem = async () => {
    if (!openId) return
    try {
      await saveChecklistItem(db.agency.id, openId, itemEditing === 'new' ? null : itemEditing?.id ?? null, itemDraft)
      setItemEditing(null); toast(t('cg2.saved'))
      setItems(await loadChecklistItems(openId))
    } catch (e) { setError((e as Error).message) }
  }

  const seed = async () => {
    try {
      const n = await seedChecklists(db.agency.id)
      toast(t('cg2.seeded', { n })); await reload()
    } catch (e) { setError((e as Error).message) }
  }

  if (!HAS_BACKEND) {
    return (
      <Card title={t('cg2.checklists')}>
        <Empty title={t('cg2.offline')} hint={t('cg2.offlineHint')} scene="alerte" />
      </Card>
    )
  }

  const canWrite = v.can('shipment:write')

  return (
    <Card
      title={t('cg2.checklists')}
      action={canWrite
        ? <div className="row gap-2">
            <Button icon="download" onClick={() => void seed()}>{t('cg2.seed')}</Button>
            <Button icon="plus" onClick={() => { setEditing('new'); setDraft(emptyChecklist()) }}>
              {t('cg2.newChecklist')}
            </Button>
          </div>
        : undefined}
    >
      <p className="t-small t-secondary">{t('cg2.checklistsSub')}</p>
      {error && <p className="t-small t-orange">{t('cg2.loadError', { msg: error })}</p>}

      {rows.length === 0 ? (
        <Empty
          title={t('cg2.noChecklists')}
          hint={t('cg2.noChecklistsHint')}
          action={canWrite ? <Button variant="primary" onClick={() => void seed()}>{t('cg2.seed')}</Button> : undefined}
          scene="vide"
        />
      ) : (
        <div className="col gap-3" style={{ marginTop: 'var(--sp-4)' }}>
          {rows.map((r) => (
            <div key={r.id} className="col gap-1">
              <div className="row-between">
                <button
                  type="button"
                  className="t-small t-medium"
                  style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', textAlign: 'start' }}
                  onClick={() => setOpenId(openId === r.id ? null : r.id)}
                >
                  {r.name}
                </button>
                <div className="row gap-2">
                  {!r.active && <Pill tone="gray">{t('cg2.inactive')}</Pill>}
                  {canWrite && (
                    <>
                      <Button size="sm" icon="edit" onClick={() => {
                        setEditing(r)
                        setDraft({
                          name: r.name, direction: r.direction, originCountry: r.originCountry,
                          destinationCountry: r.destinationCountry, hsChapter: r.hsChapter,
                          transportMode: r.transportMode, active: r.active,
                        })
                      }}>{t('cg2.save')}</Button>
                      <Button size="sm" icon="trash" onClick={() => void removeChecklist(r.id).then(reload)}>
                        {t('cg2.remove')}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <span className="t-caption t-tertiary">
                {[
                  r.direction ? t(`cg2.dir_${r.direction}` as 'cg2.dir_IMPORT') : t('cg2.anyValue'),
                  r.originCountry, r.destinationCountry,
                  r.hsChapter ? `${t('cg2.hsChapter')} ${r.hsChapter}` : null,
                  r.transportMode ? t(`cg2.mode_${r.transportMode}` as 'cg2.mode_maritime') : null,
                ].filter(Boolean).join(' · ')}
              </span>

              {openId === r.id && (
                <div className="col gap-2" style={{ paddingInlineStart: 'var(--sp-4)' }}>
                  {items.map((it) => (
                    <div key={it.id} className="row-between">
                      <span className="t-small">
                        <span className="t-mono t-tertiary">{it.code}</span> · {tt(it.label)}
                      </span>
                      <div className="row gap-2">
                        <Pill tone={it.required ? 'blue' : 'gray'}>
                          {it.required ? t('cg2.required') : t('cg2.optional')}
                        </Pill>
                        {canWrite && (
                          <>
                            <Button size="sm" icon="edit" onClick={() => {
                              setItemEditing(it)
                              setItemDraft({
                                code: it.code, label: it.label, required: it.required,
                                position: it.position, help: it.help,
                              })
                            }}>{t('cg2.save')}</Button>
                            <Button size="sm" icon="trash" onClick={() => void removeChecklistItem(it.id).then(async () => {
                              setItems(await loadChecklistItems(r.id))
                            })}>{t('cg2.remove')}</Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {canWrite && (
                    <Button size="sm" icon="plus" onClick={() => {
                      setItemEditing('new'); setItemDraft(emptyItem((items.length + 1) * 10))
                    }}>{t('cg2.addPiece')}</Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-4)' }}>
        <Icon name="alert" size={12} /> {t('cg2.moreSpecificWins')}
      </p>
      <p className="t-caption t-tertiary">{t('cg2.requiredHint')}</p>

      {editing && (
        <Modal
          title={t('cg2.checklists')}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>{t('cg2.cancel')}</Button>
              <Button variant="primary" onClick={() => void submit()}>{t('cg2.save')}</Button>
            </>
          }
        >
          <div className="col gap-3">
            <Field label={t('cg2.name')}>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label={t('cg2.direction')} hint={t('cg2.moreSpecificWins')}>
              <Select
                value={draft.direction ?? ''}
                onChange={(e) => setDraft({ ...draft, direction: (e.target.value || null) as ChecklistDirection | null })}
              >
                <option value="">{t('cg2.anyValue')}</option>
                {CHECKLIST_DIRECTIONS.map((d) => (
                  <option key={d} value={d}>{t(`cg2.dir_${d}` as 'cg2.dir_IMPORT')}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('cg2.originCountry')}>
              <Input
                value={draft.originCountry ?? ''}
                placeholder="CN"
                onChange={(e) => setDraft({ ...draft, originCountry: e.target.value.toUpperCase().slice(0, 2) || null })}
              />
            </Field>
            <Field label={t('cg2.destCountry')}>
              <Input
                value={draft.destinationCountry ?? ''}
                placeholder="TN"
                onChange={(e) => setDraft({ ...draft, destinationCountry: e.target.value.toUpperCase().slice(0, 2) || null })}
              />
            </Field>
            <Field label={t('cg2.hsChapter')}>
              <Input
                value={draft.hsChapter ?? ''}
                placeholder="85"
                onChange={(e) => setDraft({ ...draft, hsChapter: e.target.value.replace(/\D/g, '').slice(0, 2) || null })}
              />
            </Field>
            <Field label={t('cg2.transportMode')}>
              <Select
                value={draft.transportMode ?? ''}
                onChange={(e) => setDraft({ ...draft, transportMode: (e.target.value || null) as ChecklistMode | null })}
              >
                <option value="">{t('cg2.anyValue')}</option>
                {CHECKLIST_MODES.map((m) => (
                  <option key={m} value={m}>{t(`cg2.mode_${m}` as 'cg2.mode_maritime')}</option>
                ))}
              </Select>
            </Field>
            <div className="row-between">
              <span className="t-small">{t('cg2.active')}</span>
              <Switch checked={draft.active} onChange={(c) => setDraft({ ...draft, active: c })} label={t('cg2.active')} />
            </div>
          </div>
        </Modal>
      )}

      {itemEditing && (
        <Modal
          title={t('cg2.addPiece')}
          onClose={() => setItemEditing(null)}
          footer={
            <>
              <Button onClick={() => setItemEditing(null)}>{t('cg2.cancel')}</Button>
              <Button variant="primary" onClick={() => void submitItem()}>{t('cg2.save')}</Button>
            </>
          }
        >
          <div className="col gap-3">
            <Field label={t('cg2.code')}>
              <Input
                value={itemDraft.code}
                placeholder="facture"
                onChange={(e) => setItemDraft({ ...itemDraft, code: e.target.value })}
              />
            </Field>
            <Field label={t('cg2.label')}>
              <Input
                value={itemDraft.label.fr}
                onChange={(e) => setItemDraft({ ...itemDraft, label: { ...itemDraft.label, fr: e.target.value } })}
              />
            </Field>
            <div className="row-between">
              <span className="t-small">{t('cg2.required')}</span>
              <Switch
                checked={itemDraft.required}
                onChange={(c) => setItemDraft({ ...itemDraft, required: c })}
                label={t('cg2.required')}
              />
            </div>
            <Field label={t('cg2.help')} hint={t('cg2.requiredHint')}>
              <Textarea rows={2} value={itemDraft.help ?? ''} onChange={(e) => setItemDraft({ ...itemDraft, help: e.target.value || null })} />
            </Field>
            <Field label={t('cg2.position')}>
              <Input
                type="number"
                value={itemDraft.position}
                onChange={(e) => setItemDraft({ ...itemDraft, position: Number(e.target.value) })}
              />
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  )
}
