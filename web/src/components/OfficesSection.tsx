import { useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Card, Field, IconButton, Input, Modal, Pill, Select, Switch, useToast } from '@/components/ui'
import type { Office } from '@/data/types'
import { signalerUsage } from '@/data/usage'

/**
 * Les bureaux de l'agence.
 *
 * Un bureau est le périmètre d'un agent : il ne voit que les clients et les
 * dossiers de son bureau. La direction voit tout. On ne supprime jamais un
 * bureau : on le ferme, et son histoire reste.
 */
export function OfficesSection() {
  const { db, actions } = useStore()
  const v = useVisible()
  const { t } = useI18n()
  const toast = useToast()
  const [editing, setEditing] = useState<Office | 'nouveau' | null>(null)
  const editable = v.can('settings:manage')

  const compte = (officeId: string) => ({
    people: db.users.filter((u) => u.active && u.officeId === officeId).length,
    clients: db.clients.filter((c) => c.officeId === officeId).length,
    cases: db.cases.filter((c) => c.officeId === officeId && c.status === 'ouvert').length,
  })

  return (
    <>
      <Card
        title={t('equipe.offices')}
        action={editable ? <Button icon="plus" size="sm" onClick={() => setEditing('nouveau')}>{t('equipe.newOffice')}</Button> : undefined}
        flush
      >
        <p className="t-small t-secondary" style={{ padding: 'var(--sp-4) var(--sp-5) 0', margin: 0 }}>{t('equipe.officesHint')}</p>
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('equipe.officeName')}</th>
                <th className="col-optional">{t('equipe.city')}</th>
                <th className="col-optional">{t('equipe.phone')}</th>
                <th>{t('settings.team')}</th>
                <th>{t('clients.title')}</th>
                <th>{t('cases.title')}</th>
                <th>{t('misc.active')}</th>
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {db.agency.offices.map((o) => {
                const n = compte(o.id)
                return (
                  <tr key={o.id} style={o.active === false ? { opacity: 0.55 } : undefined}>
                    <td className="t-medium t-small">{o.name}</td>
                    <td className="t-small t-secondary col-optional">{o.city}{o.country ? ` · ${o.country}` : ''}</td>
                    <td className="t-small t-tertiary col-optional t-mono">{o.phone}</td>
                    <td className="t-small t-num">{n.people}</td>
                    <td className="t-small t-num">{n.clients}</td>
                    <td className="t-small t-num">{n.cases}</td>
                    <td>{o.active === false ? <Pill tone="gray">{t('equipe.closed')}</Pill> : <Pill tone="green" dot>{t('misc.active')}</Pill>}</td>
                    {editable && (
                      <td style={{ textAlign: 'end' }}>
                        <IconButton icon="edit" label={t('crud.edit')} onClick={() => setEditing(o)} />
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <OfficeEditor
          office={editing === 'nouveau' ? null : editing}
          base={db.agency.offices[0]}
          onClose={() => setEditing(null)}
          onSave={(o) => { actions.saveOffice(o); signalerUsage(); setEditing(null); toast(editing === 'nouveau' ? t('crud.created') : t('crud.updated')) }}
        />
      )}
    </>
  )
}

function OfficeEditor({ office, base, onClose, onSave }: {
  office: Office | null
  base: Office | undefined
  onClose: () => void
  onSave: (o: Omit<Office, 'agencyId' | 'id'> & { id?: string }) => void
}) {
  const { t } = useI18n()
  const [d, setD] = useState<Omit<Office, 'agencyId' | 'id'> & { id?: string }>(
    office ?? {
      name: '', city: '', country: base?.country ?? 'Tunisie', countryCode: base?.countryCode ?? 'TN',
      phone: '', address: '', timezone: base?.timezone ?? 'Africa/Tunis', active: true,
    },
  )
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD({ ...d, [k]: v })
  const setCountry = (country: string) => {
    const code = country === 'Libye' ? 'LY' : country === 'Chine' ? 'CN' : 'TN'
    const tz = country === 'Libye' ? 'Africa/Tripoli' : country === 'Chine' ? 'Asia/Shanghai' : 'Africa/Tunis'
    setD({ ...d, country, countryCode: code, timezone: tz })
  }

  return (
    <Modal
      title={office ? t('crud.edit') : t('equipe.newOffice')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={!d.name.trim()} onClick={() => onSave({ ...d, name: d.name.trim() })}>{t('action.save')}</Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label={t('equipe.officeName')}><Input value={d.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label={t('equipe.city')}><Input value={d.city} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label={t('equipe.country')}>
          <Select value={d.country} onChange={(e) => setCountry(e.target.value)}>
            <option>Tunisie</option><option>Libye</option><option>Chine</option>
          </Select>
        </Field>
        <Field label={t('equipe.phone')}><Input type="tel" value={d.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
      </div>
      <Field label={t('equipe.address')}><Input value={d.address} onChange={(e) => set('address', e.target.value)} /></Field>
      {office && (
        <div className="row-between" style={{ marginTop: 'var(--sp-5)' }}>
          <span className="t-small t-secondary">{t('misc.active')}</span>
          <Switch checked={d.active !== false} onChange={(value) => set('active', value)} label={t('misc.active')} />
        </div>
      )}
    </Modal>
  )
}
