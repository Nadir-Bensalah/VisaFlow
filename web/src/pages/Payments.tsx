import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Segmented, useToast } from '@/components/ui'
import { PageHead } from '@/components/bits'
import { Pill } from '@/components/ui'
import { clientName, kpis } from '@/lib/derive'

export function Payments() {
  const { db, actions } = useStore()
  const { t, tt, formatMoney, formatDate } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const [view, setView] = useState<'du' | 'regle' | 'tous'>('du')
  const k = kpis(db)

  const rows = useMemo(
    () => db.payments
      .filter((p) => (view === 'tous' ? true : view === 'du' ? p.state !== 'regle' : p.state === 'regle'))
      .sort((a, b) => (b.at ?? b.dueAt ?? '').localeCompare(a.at ?? a.dueAt ?? '')),
    [db.payments, view],
  )

  return (
    <>
      <PageHead title={t('pay.title')} subtitle={t('pay.subtitle')} />

      <div className="grid grid--3" style={{ marginBottom: 'var(--sp-5)' }}>
        <Card><div className="stat" style={{ padding: 0 }}><div className="stat__label">{t('pay.collected')}</div><div className="stat__value">{formatMoney(k.collected)}</div><div className="stat__hint">{t('dash.thisWeek')}</div></div></Card>
        <Card><div className="stat" style={{ padding: 0 }}><div className="stat__label">{t('pay.outstanding')}</div><div className="stat__value" style={{ color: k.outstanding > 0 ? 'var(--orange)' : undefined }}>{formatMoney(k.outstanding)}</div></div></Card>
        <Card><div className="stat" style={{ padding: 0 }}><div className="stat__label">{t('reports.acceptance')}</div><div className="stat__value">{k.acceptance}%</div></div></Card>
      </div>

      <Card flush>
        <div className="row" style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--hairline)' }}>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'du', label: t('payment.du') },
              { value: 'regle', label: t('payment.regle') },
              { value: 'tous', label: t('misc.everything') },
            ]}
          />
        </div>

        {rows.length === 0 ? (
          <Empty title={t('pay.none')} />
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('pay.label')}</th>
                  <th>{t('cases.client')}</th>
                  <th>{t('cases.reference')}</th>
                  <th>{t('pay.state')}</th>
                  <th>{t('pay.method')}</th>
                  <th>{t('pay.date')}</th>
                  <th className="num">{t('pay.amount')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const kase = db.cases.find((c) => c.id === p.caseId)
                  return (
                    <tr key={p.id} onClick={() => kase && navigate(`/dossiers/${kase.id}`)}>
                      <td className="t-small t-medium">{tt(p.label)}</td>
                      <td className="t-small">{kase ? clientName(db, kase.clientId) : '—'}</td>
                      <td className="t-mono t-small t-tertiary">{kase?.reference}</td>
                      <td>
                        <Pill tone={p.state === 'regle' ? 'green' : 'orange'} dot>
                          {t(`payment.${p.state}` as 'payment.du')}
                        </Pill>
                      </td>
                      <td className="t-small t-secondary">{p.method ? t(`payment.${p.method}` as 'payment.especes') : '—'}</td>
                      <td className="t-small t-tertiary">{formatDate(p.at ?? p.dueAt)}</td>
                      <td className="num t-medium">{formatMoney(p.amount)}</td>
                      <td style={{ textAlign: 'end' }}>
                        {p.state !== 'regle' && (
                          <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); actions.markPaymentPaid(p.id, 'especes'); toast(t('action.markPaid')) }}>
                            {t('action.markPaid')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
