import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Button, Card, Field, IconButton, Input, Modal, Pill, Segmented, Select, Switch, Textarea, useToast } from '@/components/ui'
import { Ago, PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { tenantUrl } from '@/tenant'
import { roleKey } from '@/lib/permissions'
import type { ChecklistItem, Channel, I18nText, Locale, MessageTemplate, Role, User, VisaType } from '@/data/types'

type Section = 'agence' | 'equipe' | 'visas' | 'modeles' | 'donnees' | 'journal'

const EMPTY_I18N: I18nText = { fr: '' }

export function Settings() {
  const { db, actions, slug } = useStore()
  const v = useVisible()
  const { t, tt, locale, setLocale, formatMoney } = useI18n()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const section = (params.get('section') as Section | null) ?? 'agence'
  const setSection = (value: Section) => setParams({ section: value }, { replace: true })
  const [confirming, setConfirming] = useState<null | 'reset'>(null)

  const sections: { value: Section; label: string; visible: boolean }[] = [
    { value: 'agence', label: t('settings.agency'), visible: true },
    { value: 'equipe', label: t('settings.team'), visible: v.can('team:manage') || v.can('audit:view') },
    { value: 'visas', label: t('settings.visaTypes'), visible: v.can('catalog:manage') },
    { value: 'modeles', label: t('settings.templates'), visible: v.can('catalog:manage') },
    { value: 'donnees', label: t('settings.compliance'), visible: v.can('data:export') },
    { value: 'journal', label: t('settings.audit'), visible: v.can('audit:view') },
  ]
  const allowed = sections.filter((s) => s.visible)
  const current = allowed.some((s) => s.value === section) ? section : 'agence'

  const exportAll = () => {
    const url = URL.createObjectURL(new Blob([actions.exportJson()], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}-visaflow-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast(t('settings.exportAll'))
  }

  return (
    <>
      <PageHead title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <div style={{ marginBottom: 'var(--sp-6)' }}>
        <Segmented
          label={t('settings.title')}
          value={current}
          onChange={setSection}
          options={allowed.map((s) => ({ value: s.value, label: s.label }))}
        />
      </div>

      {current === 'agence' && <AgencySection />}
      {current === 'equipe' && <TeamSection />}
      {current === 'visas' && <CatalogSection />}
      {current === 'modeles' && <TemplatesSection />}

      {current === 'donnees' && (
        <div className="grid grid--2">
          <Card title={t('settings.compliance')}>
            <p className="t-small t-secondary" style={{ marginBottom: 'var(--sp-5)' }}>{t('settings.complianceHint')}</p>
            <div className="col gap-4">
              <div className="row-between"><span className="t-small t-secondary">{t('settings.inpdp')}</span><Pill tone="orange" dot>{db.agency.inpdpRef}</Pill></div>
              <div className="row-between"><span className="t-small t-secondary">{t('settings.retention')}</span><span className="t-small">{t('settings.retentionValue', { n: 24 })}</span></div>
            </div>
          </Card>
          <Card title={t('misc.demoData')}>
            <div className="col gap-3">
              <Button icon="download" onClick={exportAll}>{t('settings.exportAll')}</Button>
              <Button variant="danger" icon="trash" onClick={() => setConfirming('reset')}>{t('misc.resetDemo')}</Button>
              <p className="t-caption t-tertiary">{t('login.demoHint')}</p>
            </div>
          </Card>
        </div>
      )}

      {current === 'journal' && (
        <Card flush>
          <div className="list">
            {db.events.slice(0, 60).map((e) => (
              <div key={e.id} className="list__row">
                <Icon name={e.automated ? 'automations' : 'check'} size={16} className="t-tertiary" />
                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className="t-small">{tt(e.detail)}</span>
                  <span className="t-caption t-tertiary">
                    <Ago iso={e.at} />
                    {e.actorId && ` · ${db.users.find((u) => u.id === e.actorId)?.name ?? ''}`}
                  </span>
                </span>
                <span className="t-caption t-tertiary t-mono col-optional">{e.type}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {confirming === 'reset' && (
        <Modal
          title={t('misc.resetDemo')}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <Button onClick={() => setConfirming(null)}>{t('action.cancel')}</Button>
              <Button variant="danger" onClick={() => { actions.reset(); setConfirming(null); toast(t('misc.resetDone')) }}>
                {t('action.confirm')}
              </Button>
            </>
          }
        >
          <p className="t-small">{t('crud.confirmRemove', { name: db.agency.name })}</p>
          <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-2)' }}>{t('crud.confirmHint')}</p>
        </Modal>
      )}
    </>
  )

  /* ---------------------------------------------------------------- */

  function AgencySection() {
    const [name, setName] = useState(db.agency.name)
    const editable = v.can('settings:manage')
    return (
      <div className="grid grid--2">
        <Card title={t('settings.agency')}>
          <div className="col gap-4">
            <Field label={t('settings.agency')}>
              <Input
                value={name}
                readOnly={!editable}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => { if (editable && name !== db.agency.name) { actions.updateAgency({ name }); toast(t('crud.updated')) } }}
              />
            </Field>
            <Field label={t('settings.domain')} hint={t('settings.domainHint')}>
              <Input value={tenantUrl(db.agency.slug)} readOnly />
            </Field>
            <Field label={t('settings.plan')}><Input value={db.agency.plan} readOnly /></Field>
            <div className="row-between">
              <span className="t-small t-secondary">{t('settings.brand')}</span>
              <span className="row gap-2">
                <span className="sidebar__mark" style={{ background: db.agency.accent }}>{db.agency.mark}</span>
                <Input
                  type="color"
                  value={db.agency.accent}
                  disabled={!editable}
                  onChange={(e) => actions.updateAgency({ accent: e.target.value })}
                  style={{ width: 52, padding: 2 }}
                  aria-label={t('settings.brand')}
                />
              </span>
            </div>
          </div>
        </Card>

        <Card title={t('settings.offices')} flush>
          <div className="list">
            {db.agency.offices.map((o) => (
              <div key={o.id} className="list__row">
                <Icon name="building" size={18} className="t-tertiary" />
                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className="t-small t-medium">{o.name}, {o.country}</span>
                  <span className="t-caption t-tertiary t-truncate">{o.address}</span>
                </span>
                <span className="t-caption t-mono t-tertiary">{o.phone}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title={t('settings.languages')}>
          <p className="t-small t-secondary" style={{ marginBottom: 'var(--sp-4)' }}>{t('msg.languageAuto')}</p>
          <div className="row gap-2 wrap">
            {LOCALES.map((l) => (
              <button key={l} type="button" className="chip" aria-pressed={locale === l} onClick={() => setLocale(l)}>
                {LOCALE_META[l].native}
              </button>
            ))}
          </div>
        </Card>
      </div>
    )
  }

  /* ---------------------------------------------------------------- */

  function TeamSection() {
    const [editing, setEditing] = useState<User | 'nouveau' | null>(null)
    const [removing, setRemoving] = useState<User | null>(null)
    const canManage = v.can('team:manage')

    return (
      <>
        <Card
          title={t('settings.team')}
          action={canManage ? <Button icon="plus" size="sm" onClick={() => setEditing('nouveau')}>{t('crud.newMember')}</Button> : undefined}
          flush
        >
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('clients.name')}</th>
                  <th className="col-optional">{t('login.email')}</th>
                  <th>{t('misc.role')}</th>
                  <th className="col-optional">{t('misc.office')}</th>
                  <th className="col-optional">{t('misc.language')}</th>
                  <th>{t('misc.active')}</th>
                  {canManage && <th />}
                </tr>
              </thead>
              <tbody>
                {db.users.map((u) => (
                  <tr key={u.id}>
                    <td className="t-medium t-small">{u.name}</td>
                    <td className="t-small t-secondary col-optional">{u.email}</td>
                    <td className="t-small">{t(roleKey(u.role))}</td>
                    <td className="t-small t-secondary col-optional">{db.agency.offices.find((o) => o.id === u.officeId)?.name}</td>
                    <td className="t-small t-tertiary col-optional">{u.locale.toUpperCase()}</td>
                    <td>{u.active ? <Pill tone="green" dot>{t('misc.active')}</Pill> : <Pill tone="gray">{t('misc.inactive')}</Pill>}</td>
                    {canManage && (
                      <td style={{ textAlign: 'end' }}>
                        <span className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                          <IconButton icon="edit" label={t('crud.edit')} onClick={() => setEditing(u)} />
                          <IconButton icon="trash" label={t('crud.remove')} onClick={() => setRemoving(u)} />
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {editing && <MemberEditor member={editing === 'nouveau' ? null : editing} onClose={() => setEditing(null)} />}

        {removing && (
          <Modal
            title={t('crud.remove')}
            onClose={() => setRemoving(null)}
            footer={
              <>
                <Button onClick={() => setRemoving(null)}>{t('action.cancel')}</Button>
                <Button variant="danger" onClick={() => { actions.removeUser(removing.id); setRemoving(null); toast(t('crud.removed')) }}>
                  {t('crud.remove')}
                </Button>
              </>
            }
          >
            <p className="t-small">{t('crud.confirmRemove', { name: removing.name })}</p>
            <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-2)' }}>{t('crud.confirmHint')}</p>
          </Modal>
        )}
      </>
    )
  }

  function MemberEditor({ member, onClose }: { member: User | null; onClose: () => void }) {
    const [draft, setDraft] = useState<Omit<User, 'agencyId'>>(
      member ?? {
        id: '', name: '', email: '', phone: '', role: 'agent',
        officeId: db.agency.offices[0].id, locale: 'fr', active: true,
      },
    )
    const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft({ ...draft, [key]: value })

    return (
      <Modal
        title={member ? t('crud.edit') : t('crud.newMember')}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>{t('action.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!draft.name.trim() || !draft.email.trim()}
              onClick={() => {
                actions.saveUser(member ? draft : { ...draft, id: undefined })
                onClose()
                toast(member ? t('crud.updated') : t('crud.created'))
              }}
            >
              {t('action.save')}
            </Button>
          </>
        }
      >
        <div className="grid grid--2">
          <Field label={t('clients.name')}><Input value={draft.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label={t('login.email')}><Input type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label={t('clients.contact')}><Input value={draft.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label={t('misc.role')}>
            <Select value={draft.role} onChange={(e) => set('role', e.target.value as Role)}>
              {(['owner', 'manager', 'agent', 'viewer'] as Role[]).map((r) => (
                <option key={r} value={r}>{t(roleKey(r))}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('misc.office')}>
            <Select value={draft.officeId} onChange={(e) => set('officeId', e.target.value)}>
              {db.agency.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
          <Field label={t('misc.language')}>
            <Select value={draft.locale} onChange={(e) => set('locale', e.target.value as Locale)}>
              {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_META[l].native}</option>)}
            </Select>
          </Field>
        </div>
        <div className="row-between" style={{ marginTop: 'var(--sp-5)' }}>
          <span className="t-small t-secondary">{t('misc.active')}</span>
          <Switch checked={draft.active} onChange={(value) => set('active', value)} label={t('misc.active')} />
        </div>
      </Modal>
    )
  }

  /* ---------------------------------------------------------------- */

  function TemplatesSection() {
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

  /* ---------------------------------------------------------------- */

  function CatalogSection() {
    const [editing, setEditing] = useState<VisaType | 'nouveau' | null>(null)
    const [itemFor, setItemFor] = useState<{ checklistId: string; item: ChecklistItem | null } | null>(null)

    return (
      <>
        <div className="row-between" style={{ marginBottom: 'var(--sp-5)' }}>
          <p className="t-small t-secondary">{t('settings.checklists')}</p>
          <Button icon="plus" onClick={() => setEditing('nouveau')}>{t('crud.newVisaType')}</Button>
        </div>

        <div className="stack">
          {db.visaTypes.map((visa) => {
            const checklist = db.checklists.find((c) => c.id === visa.checklistId)
            return (
              <Card
                key={visa.id}
                title={`${tt(visa.country)} · ${tt(visa.label)}`}
                action={
                  <span className="row gap-2">
                    <Pill tone="blue">{t('reports.days', { n: visa.processingDays })}</Pill>
                    <Pill tone="gray">{formatMoney(visa.feeAgency + visa.feeConsulate)}</Pill>
                    <IconButton icon="edit" label={t('crud.edit')} onClick={() => setEditing(visa)} />
                    <Switch
                      checked={visa.active}
                      onChange={(value) => { actions.saveVisaType({ ...visa, active: value }); toast(t('crud.updated')) }}
                      label={tt(visa.label)}
                    />
                  </span>
                }
              >
                <div className="col gap-2">
                  {checklist?.items.map((item) => (
                    <div key={item.key} className="row-between" style={{ paddingBottom: 'var(--sp-2)', borderBottom: '1px solid var(--hairline)' }}>
                      <span className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-small">{tt(item.label)}</span>
                        <span className="t-caption t-tertiary">
                          {item.required ? t('misc.required') : t('misc.optional')}
                          {item.validityDays ? ` · ${item.validityDays} j` : ''}
                        </span>
                      </span>
                      <span className="row gap-1">
                        <IconButton icon="edit" label={t('crud.edit')} onClick={() => setItemFor({ checklistId: checklist.id, item })} />
                        <IconButton
                          icon="trash"
                          label={t('crud.remove')}
                          onClick={() => { actions.removeChecklistItem(checklist.id, item.key); toast(t('crud.removed')) }}
                        />
                      </span>
                    </div>
                  ))}
                  {checklist && (
                    <Button size="sm" icon="plus" onClick={() => setItemFor({ checklistId: checklist.id, item: null })}>
                      {t('crud.newItem')}
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>

        {editing && <VisaEditor visa={editing === 'nouveau' ? null : editing} onClose={() => setEditing(null)} />}
        {itemFor && <ItemEditor checklistId={itemFor.checklistId} item={itemFor.item} onClose={() => setItemFor(null)} />}
      </>
    )
  }

  function VisaEditor({ visa, onClose }: { visa: VisaType | null; onClose: () => void }) {
    const [draft, setDraft] = useState<Omit<VisaType, 'agencyId'>>(
      visa ?? {
        id: '', countryCode: 'CN', country: { ...EMPTY_I18N }, label: { ...EMPTY_I18N },
        category: 'affaires', processingDays: 10, feeAgency: 300, feeConsulate: 200,
        checklistId: db.checklists[0]?.id ?? '', active: true,
        stages: ['nouveau', 'pieces', 'verification', 'rendez_vous', 'depot', 'consulat', 'decision', 'retrait', 'clos'],
      },
    )

    return (
      <Modal
        wide
        title={visa ? t('crud.edit') : t('crud.newVisaType')}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>{t('action.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!draft.country.fr.trim() || !draft.label.fr.trim()}
              onClick={() => {
                actions.saveVisaType(visa ? draft : { ...draft, id: undefined })
                onClose()
                toast(visa ? t('crud.updated') : t('crud.created'))
              }}
            >
              {t('action.save')}
            </Button>
          </>
        }
      >
        <div className="grid grid--2">
          <Field label={t('reports.byCountry')}>
            <Input value={draft.country.fr} onChange={(e) => setDraft({ ...draft, country: { ...draft.country, fr: e.target.value } })} />
          </Field>
          <Field label={t('cases.visa')}>
            <Input value={draft.label.fr} onChange={(e) => setDraft({ ...draft, label: { ...draft.label, fr: e.target.value } })} />
          </Field>
          <Field label={t('reports.delay')}>
            <Input type="number" min={1} value={draft.processingDays} onChange={(e) => setDraft({ ...draft, processingDays: Number(e.target.value) })} />
          </Field>
          <Field label={t('settings.checklists')}>
            <Select value={draft.checklistId} onChange={(e) => setDraft({ ...draft, checklistId: e.target.value })}>
              {db.checklists.map((c) => <option key={c.id} value={c.id}>{tt(c.name)}</option>)}
            </Select>
          </Field>
          <Field label={t('pay.collected')}>
            <Input type="number" min={0} value={draft.feeAgency} onChange={(e) => setDraft({ ...draft, feeAgency: Number(e.target.value) })} />
          </Field>
          <Field label={t('pay.amount')}>
            <Input type="number" min={0} value={draft.feeConsulate} onChange={(e) => setDraft({ ...draft, feeConsulate: Number(e.target.value) })} />
          </Field>
        </div>
      </Modal>
    )
  }

  function ItemEditor({ checklistId, item, onClose }: { checklistId: string; item: ChecklistItem | null; onClose: () => void }) {
    const [draft, setDraft] = useState<ChecklistItem>(
      item ?? { key: '', label: { ...EMPTY_I18N }, required: true },
    )

    return (
      <Modal
        wide
        title={item ? t('crud.edit') : t('crud.newItem')}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>{t('action.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!draft.label.fr.trim()}
              onClick={() => {
                const key = draft.key || draft.label.fr.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)
                actions.saveChecklistItem(checklistId, { ...draft, key }, item?.key)
                onClose()
                toast(item ? t('crud.updated') : t('crud.created'))
              }}
            >
              {t('action.save')}
            </Button>
          </>
        }
      >
        <div className="col gap-4">
          <p className="t-caption t-tertiary">{t('crud.fillFrench')}</p>
          {LOCALES.map((l) => (
            <Field key={l} label={`${t('crud.itemLabel')} · ${LOCALE_META[l].native}`}>
              <Input
                dir={LOCALE_META[l].dir}
                lang={l}
                value={draft.label[l] ?? ''}
                onChange={(e) => setDraft({ ...draft, label: { ...draft.label, [l]: e.target.value } })}
              />
            </Field>
          ))}
          <div className="grid grid--2">
            <Field label={t('crud.itemValidity')}>
              <Input
                type="number"
                min={0}
                value={draft.validityDays ?? ''}
                onChange={(e) => setDraft({ ...draft, validityDays: e.target.value ? Number(e.target.value) : undefined })}
              />
            </Field>
            <div className="row-between" style={{ alignSelf: 'end', paddingBottom: 8 }}>
              <span className="t-small t-secondary">{t('crud.itemRequired')}</span>
              <Switch checked={draft.required} onChange={(value) => setDraft({ ...draft, required: value })} label={t('crud.itemRequired')} />
            </div>
          </div>
        </div>
      </Modal>
    )
  }
}
