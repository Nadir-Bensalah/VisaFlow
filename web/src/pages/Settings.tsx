import { useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Button, Card, Field, Input, Pill, Segmented, Switch, useToast } from '@/components/ui'
import { Ago, PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { tenantUrl } from '@/tenant'

type Section = 'agence' | 'equipe' | 'visas' | 'modeles' | 'donnees' | 'journal'

export function Settings() {
  const { db, actions, slug } = useStore()
  const { t, tt, locale, setLocale, formatMoney } = useI18n()
  const toast = useToast()
  const [section, setSection] = useState<Section>('agence')
  const [name, setName] = useState(db.agency.name)

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

      <div style={{ marginBottom: 'var(--sp-5)', overflowX: 'auto' }}>
        <Segmented
          value={section}
          onChange={setSection}
          options={[
            { value: 'agence', label: t('settings.agency') },
            { value: 'equipe', label: t('settings.team') },
            { value: 'visas', label: t('settings.visaTypes') },
            { value: 'modeles', label: t('settings.templates') },
            { value: 'donnees', label: t('settings.compliance') },
            { value: 'journal', label: t('settings.audit') },
          ]}
        />
      </div>

      {section === 'agence' && (
        <div className="grid grid--2">
          <Card title={t('settings.agency')}>
            <div className="col gap-4">
              <Field label={t('settings.agency')}>
                <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { actions.updateAgency({ name }); toast(t('action.save')) }} />
              </Field>
              <Field label={t('settings.domain')} hint={t('settings.domainHint')}>
                <Input value={tenantUrl(db.agency.slug)} readOnly />
              </Field>
              <Field label={t('settings.plan')}>
                <Input value={db.agency.plan} readOnly />
              </Field>
              <div className="row-between">
                <span className="t-small t-secondary">{t('settings.brand')}</span>
                <span className="row gap-2">
                  <span className="sidebar__mark" style={{ background: db.agency.accent }}>{db.agency.mark}</span>
                  <span className="t-mono t-small">{db.agency.accent}</span>
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
            <p className="t-small t-secondary" style={{ marginBottom: 'var(--sp-4)' }}>
              {t('msg.languageAuto')}
            </p>
            <div className="row gap-2 wrap">
              {LOCALES.map((l) => (
                <button key={l} type="button" className="chip" aria-pressed={locale === l} onClick={() => setLocale(l)}>
                  {LOCALE_META[l].native}
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {section === 'equipe' && (
        <Card flush>
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>{t('clients.name')}</th><th>{t('login.email')}</th><th>{t('misc.role')}</th><th>{t('misc.office')}</th><th>{t('misc.language')}</th><th>{t('misc.active')}</th></tr></thead>
              <tbody>
                {db.users.map((u) => (
                  <tr key={u.id}>
                    <td className="t-medium t-small">{u.name}</td>
                    <td className="t-small t-secondary">{u.email}</td>
                    <td className="t-small">{t(`misc.${u.role === 'agent' ? 'agentRole' : u.role}` as 'misc.owner')}</td>
                    <td className="t-small t-secondary">{db.agency.offices.find((o) => o.id === u.officeId)?.name}</td>
                    <td className="t-small t-tertiary">{u.locale.toUpperCase()}</td>
                    <td>{u.active ? <Pill tone="green" dot>{t('misc.active')}</Pill> : <Pill tone="gray">{t('misc.inactive')}</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {section === 'visas' && (
        <div className="col gap-4">
          {db.visaTypes.map((v) => {
            const checklist = db.checklists.find((c) => c.id === v.checklistId)
            return (
              <Card key={v.id}>
                <div className="row-between wrap gap-4">
                  <div className="col gap-2 grow">
                    <span className="row gap-3">
                      <span className="t-medium">{tt(v.country)} · {tt(v.label)}</span>
                      <Pill tone="blue">{t('reports.days', { n: v.processingDays })}</Pill>
                    </span>
                    <span className="t-small t-secondary">
                      {checklist ? `${checklist.items.length} ${t('docs.title').toLowerCase()}` : ''} · {t('pay.amount')} {formatMoney(v.feeAgency + v.feeConsulate)}
                    </span>
                    <div className="row gap-2 wrap" style={{ marginTop: 'var(--sp-2)' }}>
                      {checklist?.items.map((i) => (
                        <span key={i.key} className="chip" style={{ cursor: 'default' }}>
                          {tt(i.label)}{!i.required && ' ·'}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Switch checked={v.active} onChange={() => toast(t('settings.visaTypes'))} label={tt(v.label)} />
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {section === 'modeles' && (
        <div className="col gap-4">
          {db.templates.map((tpl) => (
            <Card key={tpl.id} title={tt(tpl.name)}>
              <div className="col gap-3">
                {LOCALES.map((l) => (
                  <div key={l} className="row gap-3" style={{ alignItems: 'flex-start' }}>
                    <span className="chip" style={{ cursor: 'default', flex: '0 0 auto' }}>{LOCALE_META[l].native}</span>
                    <span className="t-small t-secondary" dir={LOCALE_META[l].dir}>{tpl.body[l]}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {section === 'donnees' && (
        <div className="grid grid--2">
          <Card title={t('settings.compliance')}>
            <p className="t-small t-secondary" style={{ marginBottom: 'var(--sp-5)' }}>{t('settings.complianceHint')}</p>
            <div className="col gap-4">
              <div className="row-between"><span className="t-small t-secondary">{t('settings.inpdp')}</span><Pill tone="orange" dot>{db.agency.inpdpRef}</Pill></div>
              <div className="row-between"><span className="t-small t-secondary">{t('settings.retention')}</span><span className="t-small">{t('settings.retentionValue', { n: 24 })}</span></div>
              <div className="row-between"><span className="t-small t-secondary">{t('settings.deleteClient')}</span><Icon name="shield" size={18} className="t-tertiary" /></div>
            </div>
          </Card>
          <Card title={t('misc.demoData')}>
            <div className="col gap-3">
              <Button icon="download" onClick={exportAll}>{t('settings.exportAll')}</Button>
              <Button variant="danger" icon="trash" onClick={() => { actions.reset(); toast(t('misc.resetDone')) }}>{t('misc.resetDemo')}</Button>
              <p className="t-caption t-tertiary">{t('login.demoHint')}</p>
            </div>
          </Card>
        </div>
      )}

      {section === 'journal' && (
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
                <span className="t-caption t-tertiary t-mono">{e.type}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}
