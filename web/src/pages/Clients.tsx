import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Avatar, Button, Card, Empty, Input, Pill } from '@/components/ui'
import { ClientEditor } from '@/components/ClientEditor'
import { PageHead } from '@/components/bits'
import { daysUntil } from '@/lib/derive'

export function Clients() {
  const v = useVisible()
  const { t, formatDate } = useI18n()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return v.clients.filter((c) =>
      !q || `${c.firstName} ${c.lastName} ${c.phone} ${c.passportNumber ?? ''}`.toLowerCase().includes(q),
    )
  }, [v.clients, query])

  return (
    <>
      <PageHead
        title={t('clients.title')}
        subtitle={t('clients.subtitle')}
        action={<Button variant="primary" icon="plus" onClick={() => setOpen(true)}>{t('clients.newClient')}</Button>}
      />

      <Card flush>
        <div className="row" style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--hairline)' }}>
          <Input aria-label={t('action.search')} placeholder={t('action.search')} value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 280 }} />
        </div>

        {rows.length === 0 ? (
          <Empty
            title={t('clients.none')}
            hint={t('setup.shareHint')}
            scene="equipe"
            action={<Button variant="primary" icon="plus" onClick={() => setOpen(true)}>{t('clients.newClient')}</Button>}
          />
        ) : (
          <div className="tablewrap">
            <table className="table table--clickable">
              <thead>
                <tr>
                  <th>{t('clients.name')}</th>
                  <th>{t('clients.contact')}</th>
                  <th className="col-optional">{t('clients.nationality')}</th>
                  <th>{t('clients.passport')}</th>
                  <th>{t('clients.expiry')}</th>
                  <th className="num">{t('clients.casesCount')}</th>
                  <th className="col-optional">{t('clients.since')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const count = v.cases.filter((k) => k.clientId === c.id).length
                  const soon = daysUntil(c.passportExpiry) < 180
                  return (
                    <tr
                      key={c.id}
                      tabIndex={0}
                      role="link"
                      aria-label={`${c.firstName} ${c.lastName}`}
                      onClick={() => navigate(`/clients/${c.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/clients/${c.id}`) }
                      }}
                    >
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
                      <td className="t-small t-secondary col-optional">{c.nationality}</td>
                      <td className="t-small t-mono">{c.passportNumber}</td>
                      <td className="t-small">
                        {soon ? <Pill tone="orange" dot>{formatDate(c.passportExpiry)}</Pill> : formatDate(c.passportExpiry)}
                      </td>
                      <td className="num t-small">{count}</td>
                      <td className="t-small t-tertiary col-optional">{formatDate(c.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && <ClientEditor client={null} onClose={() => setOpen(false)} onSaved={(id) => navigate(`/clients/${id}`)} />}
    </>
  )
}
