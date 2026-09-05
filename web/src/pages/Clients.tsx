import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Avatar, Button, Card, Empty, Field, Input, Modal, Pill, Select } from '@/components/ui'
import { PageHead } from '@/components/bits'
import { daysUntil } from '@/lib/derive'
import type { Locale } from '@/data/types'

export function Clients() {
  const { db, actions } = useStore()
  const { t, formatDate } = useI18n()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return db.clients.filter((c) =>
      !q || `${c.firstName} ${c.lastName} ${c.phone} ${c.passportNumber ?? ''}`.toLowerCase().includes(q),
    )
  }, [db.clients, query])

  return (
    <>
      <PageHead
        title={t('clients.title')}
        subtitle={t('clients.subtitle')}
        action={<Button variant="primary" icon="plus" onClick={() => setOpen(true)}>{t('clients.newClient')}</Button>}
      />

      <Card flush>
        <div className="row" style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--hairline)' }}>
          <Input placeholder={t('action.search')} value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 280 }} />
        </div>

        {rows.length === 0 ? (
          <Empty title={t('clients.none')} />
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('clients.name')}</th>
                  <th>{t('clients.contact')}</th>
                  <th>{t('clients.nationality')}</th>
                  <th>{t('clients.passport')}</th>
                  <th>{t('clients.expiry')}</th>
                  <th className="num">{t('clients.casesCount')}</th>
                  <th>{t('clients.since')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const count = db.cases.filter((k) => k.clientId === c.id).length
                  const soon = daysUntil(c.passportExpiry) < 180
                  return (
                    <tr key={c.id} onClick={() => navigate(`/clients/${c.id}`)}>
                      <td>
                        <span className="row gap-3">
                          <Avatar name={`${c.firstName} ${c.lastName}`} size="sm" />
                          <span className="col">
                            <span className="t-medium">{c.firstName} {c.lastName}</span>
                            {c.nativeName && <span className="t-caption t-tertiary">{c.nativeName}</span>}
                          </span>
                        </span>
                      </td>
                      <td className="t-small t-mono">{c.phone}</td>
                      <td className="t-small t-secondary">{c.nationality}</td>
                      <td className="t-small t-mono">{c.passportNumber}</td>
                      <td className="t-small">
                        {soon ? <Pill tone="orange" dot>{formatDate(c.passportExpiry)}</Pill> : formatDate(c.passportExpiry)}
                      </td>
                      <td className="num t-small">{count}</td>
                      <td className="t-small t-tertiary">{formatDate(c.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && <NewClient onClose={() => setOpen(false)} onCreated={(id) => { setOpen(false); navigate(`/clients/${id}`) }} />}
    </>
  )

  function NewClient({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [phone, setPhone] = useState('')
    const [email, setEmail] = useState('')
    const [nationality, setNationality] = useState('Tunisienne')
    const [locale, setLocale] = useState<Locale>('fr')
    const [officeId, setOfficeId] = useState(db.agency.offices[0].id)

    return (
      <Modal
        title={t('clients.newClient')}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>{t('action.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!firstName || !lastName || !phone}
              onClick={() => onCreated(actions.createClient({ firstName, lastName, phone, email, nationality, locale, officeId }))}
            >
              {t('action.confirm')}
            </Button>
          </>
        }
      >
        <div className="grid grid--2 gap-4">
          <Field label={t('clients.name')}><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" /></Field>
          <Field label=" "><Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom" /></Field>
          <Field label={t('clients.contact')}><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+216 ..." /></Field>
          <Field label={t('login.email')}><Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" /></Field>
          <Field label={t('clients.nationality')}><Input value={nationality} onChange={(e) => setNationality(e.target.value)} /></Field>
          <Field label={t('misc.language')}>
            <Select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
              <option value="fr">Français</option><option value="en">English</option>
              <option value="ar">العربية</option><option value="zh">中文</option>
            </Select>
          </Field>
          <Field label={t('misc.office')}>
            <Select value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
              {db.agency.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
        </div>
      </Modal>
    )
  }
}
