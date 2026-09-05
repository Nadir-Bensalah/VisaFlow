import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Card, Empty, Input, Pill, Progress, Segmented, Select } from '@/components/ui'
import { PageHead } from '@/components/bits'
import { ShipmentEditor } from '@/components/ShipmentEditor'
import { SHIPMENT_TONE, clientName, daysUntil, shipmentLate, shipmentProgress } from '@/lib/derive'
import type { ShipmentMode } from '@/data/types'

type View = 'en_cours' | 'retard' | 'bloquees' | 'toutes'

export function Shipments() {
  const { db } = useStore()
  const v = useVisible()
  const { t, tt, formatDate, formatMoney } = useI18n()
  const navigate = useNavigate()
  const [view, setView] = useState<View>('en_cours')
  const [mode, setMode] = useState<ShipmentMode | 'tous'>('tous')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return v.shipments
      .filter((s) =>
        view === 'en_cours' ? s.status === 'en_cours'
        : view === 'retard' ? shipmentLate(s)
        : view === 'bloquees' ? s.status === 'bloquee'
        : true,
      )
      .filter((s) => (mode === 'tous' ? true : s.mode === mode))
      .filter((s) => !q || `${s.reference} ${s.supplier} ${clientName(db, s.clientId)} ${s.containerNo ?? ''} ${s.blNumber ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => (a.eta ?? '').localeCompare(b.eta ?? ''))
  }, [db, v, view, mode, query])

  const inTransit = v.shipments.filter((s) => s.stage === 'transit').length
  const arriving = v.shipments.filter((s) => s.status === 'en_cours' && daysUntil(s.eta) >= 0 && daysUntil(s.eta) <= 7).length
  const customs = v.shipments.filter((s) => s.stage === 'douane').length

  return (
    <>
      <PageHead
        title={t('ship.title')}
        subtitle={t('ship.subtitle')}
        action={
          v.can('shipment:write')
            ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('ship.newShipment')}</Button>
            : undefined
        }
      />

      <div className="grid grid--3" style={{ marginBottom: 'var(--sp-5)' }}>
        <Card><div className="stat" style={{ padding: 0 }}><div className="stat__label">{t('ship.inTransit')}</div><div className="stat__value">{inTransit}</div></div></Card>
        <Card><div className="stat" style={{ padding: 0 }}><div className="stat__label">{t('ship.arriving')}</div><div className="stat__value" style={{ color: arriving ? 'var(--orange)' : undefined }}>{arriving}</div></div></Card>
        <Card><div className="stat" style={{ padding: 0 }}><div className="stat__label">{t('ship.customs')}</div><div className="stat__value">{customs}</div></div></Card>
      </div>

      <Card flush>
        <div className="row wrap gap-3" style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--hairline)' }}>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'en_cours', label: t('ship.st.en_cours') },
              { value: 'retard', label: t('ship.late') },
              { value: 'bloquees', label: t('ship.st.bloquee') },
              { value: 'toutes', label: t('misc.everything') },
            ]}
          />
          <Select aria-label={t('ship.mode')} value={mode} onChange={(e) => setMode(e.target.value as ShipmentMode | 'tous')} style={{ width: 'auto' }}>
            <option value="tous">{t('ship.mode')}</option>
            {(['maritime_fcl', 'maritime_lcl', 'aerien', 'routier'] as ShipmentMode[]).map((m) => (
              <option key={m} value={m}>{t(`ship.m.${m}` as 'ship.m.aerien')}</option>
            ))}
          </Select>
          <Input aria-label={t('action.search')} placeholder={t('action.search')} value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 220 }} />
          <span className="grow" />
          <span className="t-small t-tertiary t-num">{t('ship.count', { n: rows.length })}</span>
        </div>

        {rows.length === 0 ? (
          <Empty title={t('ship.none')} />
        ) : (
          <div className="tablewrap">
            <table className="table table--clickable">
              <thead>
                <tr>
                  <th>{t('ship.reference')}</th>
                  <th>{t('cases.client')}</th>
                  <th>{t('ship.goods')}</th>
                  <th>{t('ship.route')}</th>
                  <th className="col-optional">{t('ship.mode')}</th>
                  <th>{t('ship.stage')}</th>
                  <th>{t('ship.eta')}</th>
                  {v.can('finance:global') && <th className="num">{t('ship.freight')}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`${s.reference} ${s.originPort} ${s.destPort}`}
                    onClick={() => navigate(`/cargaisons/${s.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/cargaisons/${s.id}`) }
                    }}
                  >
                    <td className="t-mono t-small">{s.reference}</td>
                    <td className="t-medium t-small">{clientName(db, s.clientId)}</td>
                    <td className="t-small t-secondary">{tt(s.goods)}</td>
                    <td className="t-small t-secondary">{s.originPort} → {s.destPort}</td>
                    <td className="t-small t-secondary col-optional">{t(`ship.m.${s.mode}` as 'ship.m.aerien')}</td>
                    <td>
                      <span className="col gap-1" style={{ minWidth: 130 }}>
                        <Pill tone={SHIPMENT_TONE[s.stage]} dot>{t(`ship.s.${s.stage}` as 'ship.s.transit')}</Pill>
                        <Progress pct={shipmentProgress(s)} tone={s.stage === 'livre' ? 'green' : undefined} />
                      </span>
                    </td>
                    <td className="t-small" style={{ color: shipmentLate(s) ? 'var(--red)' : undefined }}>{formatDate(s.eta)}</td>
                    {v.can('finance:global') && <td className="num t-small">{formatMoney(s.freightCost)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && <ShipmentEditor shipment={null} onClose={() => setCreating(false)} />}
    </>
  )
}
