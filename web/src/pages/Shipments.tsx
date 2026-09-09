import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Input, Pill, Progress, Segmented, Select, useToast } from '@/components/ui'
import { Countdown } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { Kpi, KpiGrid, PageHeader, Section, Table, Toolbar, Vide } from '@/components/page'
import { ShipmentEditor } from '@/components/ShipmentEditor'
import { SHIPMENT_STAGES, SHIPMENT_TONE, daysUntil, shipmentLate, shipmentProgress, shipmentClientLabel } from '@/lib/derive'
import { exportRows } from '@/lib/export'
import type { Shipment, ShipmentMode } from '@/data/types'

/* Les cargaisons. Quatre chiffres en tête, dont celui qui coûte de l'argent
   chaque jour : le conteneur arrivé au port et pas encore sorti. Le filtre vit
   dans l'URL, comme sur les dossiers. La ligne porte son geste : l'étape
   suivante, sans ouvrir la fiche. */

type Filter = 'en_cours' | 'retard' | 'bloquees' | 'arrivees' | 'stationnement' | 'toutes'
const FILTERS: Filter[] = ['en_cours', 'retard', 'bloquees', 'arrivees', 'stationnement', 'toutes']
type Tri = 'eta' | 'reference' | 'client'

const arrivingSoon = (s: Shipment) => s.status === 'en_cours' && daysUntil(s.eta) >= 0 && daysUntil(s.eta) <= 7
/** Au port et pas sortie : date d'arrivée posée sans sortie, ou position arrivée/douane. */
const demurrage = (s: Shipment) =>
  s.status === 'en_cours' && ((Boolean(s.arrivedAt) && !s.gateOutAt) || s.stage === 'arrivee' || s.stage === 'douane')

export function Shipments() {
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt, formatDate, formatMoney, formatNumber } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const [mode, setMode] = useState<ShipmentMode | 'tous'>('tous')
  const [query, setQuery] = useState('')
  const [tri, setTri] = useState<Tri>('eta')
  const [creating, setCreating] = useState(false)
  const [params, setParams] = useSearchParams()
  const demande = params.get('filtre')
  const filter: Filter = FILTERS.includes(demande as Filter) ? (demande as Filter) : 'en_cours'
  const setFilter = (f: Filter) => setParams(f === 'en_cours' ? {} : { filtre: f }, { replace: true })

  const canWrite = v.can('shipment:write')
  const finance = v.can('finance:global')

  const ongoing = v.shipments.filter((s) => s.status === 'en_cours')
  const late = v.shipments.filter(shipmentLate)
  const arriving = v.shipments.filter(arrivingSoon)
  const parked = v.shipments.filter(demurrage)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = v.shipments
      .filter((s) =>
        filter === 'en_cours' ? s.status === 'en_cours'
        : filter === 'retard' ? shipmentLate(s)
        : filter === 'bloquees' ? s.status === 'bloquee'
        : filter === 'arrivees' ? arrivingSoon(s)
        : filter === 'stationnement' ? demurrage(s)
        : true,
      )
      .filter((s) => (mode === 'tous' ? true : s.mode === mode))
      .filter((s) => !q || `${s.reference} ${s.supplier} ${shipmentClientLabel(db, s)} ${s.containerNo ?? ''} ${s.blNumber ?? ''}`.toLowerCase().includes(q))
    return [...list].sort((a, b) => {
      if (tri === 'reference') return a.reference.localeCompare(b.reference)
      if (tri === 'client') return shipmentClientLabel(db, a).localeCompare(shipmentClientLabel(db, b))
      return (a.eta ?? '9').localeCompare(b.eta ?? '9')
    })
  }, [db, v, filter, mode, query, tri])

  const exporter = () => {
    const { name } = exportRows(rows, [
      { key: 'reference', label: t('ship.reference') },
      { key: 'client', label: t('cases.client'), value: (s) => shipmentClientLabel(db, s) },
      { key: 'supplier', label: t('ship.supplier') },
      { key: 'goods', label: t('ship.goods'), value: (s) => tt(s.goods) },
      { key: 'route', label: t('ship.route'), value: (s) => `${s.originPort} > ${s.destPort}` },
      { key: 'mode', label: t('ship.mode'), value: (s) => t(`ship.m.${s.mode}` as 'ship.m.aerien') },
      { key: 'stage', label: t('ship.stage'), value: (s) => t(`ship.s.${s.stage}` as 'ship.s.transit') },
      { key: 'status', label: t('docs.state'), value: (s) => t(`ship.st.${s.status}` as 'ship.st.en_cours') },
      { key: 'container', label: t('ship.container'), value: (s) => s.containerNo ?? '' },
      { key: 'etd', label: t('ship.etd'), value: (s) => s.etd?.slice(0, 10) ?? '' },
      { key: 'eta', label: t('ship.eta'), value: (s) => s.eta?.slice(0, 10) ?? '' },
      ...(finance ? [{ key: 'freight', label: t('ship.freight'), value: (s: Shipment) => s.freightCost }] : []),
    ], { format: 'csv', base: 'cargaisons' })
    toast(t('ls.exported', { name }))
  }

  const avancer = (s: Shipment) => {
    const next = SHIPMENT_STAGES[SHIPMENT_STAGES.indexOf(s.stage) + 1]
    if (!next) return
    actions.advanceShipment(s.id)
    toast(t('ls.advanced', { ref: s.reference, stage: t(`ship.s.${next}` as 'ship.s.transit') }))
  }

  return (
    <>
      <PageHeader
        kicker={t('ls.famFret')}
        title={t('ship.title')}
        subtitle={t('ship.subtitle')}
        actions={<>
          {v.can('data:export') && <Button icon="download" onClick={exporter} disabled={rows.length === 0}>{t('ls.exportCsv')}</Button>}
          {canWrite && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('ship.newShipment')}</Button>}
        </>}
      />

      <KpiGrid>
        <Kpi label={t('ls.kOngoing')} value={formatNumber(ongoing.length)} tone="blue" icon="ship" to="/cargaisons" />
        <Kpi label={t('ls.kShipLate')} value={formatNumber(late.length)} tone={late.length ? 'red' : 'gray'} icon="alert" hint={t('ship.late')} to="/cargaisons?filtre=retard" />
        <Kpi label={t('ls.kArriving7')} value={formatNumber(arriving.length)} tone={arriving.length ? 'orange' : 'gray'} icon="pin" hint={t('ls.hint7')} to="/cargaisons?filtre=arrivees" />
        <Kpi label={t('ls.kDemurrage')} value={formatNumber(parked.length)} tone={parked.length ? 'orange' : 'gray'} icon="box" hint={t('ls.demurrageHint')} to="/cargaisons?filtre=stationnement" />
      </KpiGrid>

      <Section flush>
        <Toolbar right={<>
          <Select value={tri} onChange={(e) => setTri(e.target.value as Tri)} aria-label={t('ls.sort')}>
            <option value="eta">{t('ls.sEta')}</option>
            <option value="reference">{t('ls.sReference')}</option>
            <option value="client">{t('cases.client')}</option>
          </Select>
          <span className="ls-count" role="status" aria-live="polite">{t('ship.count', { n: rows.length })}</span>
        </>}>
          <Input className="ls-search" aria-label={t('action.search')} placeholder={t('ls.searchShipments')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select aria-label={t('ship.mode')} value={mode} onChange={(e) => setMode(e.target.value as ShipmentMode | 'tous')} style={{ width: 'auto' }}>
            <option value="tous">{t('ship.mode')}</option>
            {(['maritime_fcl', 'maritime_lcl', 'aerien', 'routier'] as ShipmentMode[]).map((m) => (
              <option key={m} value={m}>{t(`ship.m.${m}` as 'ship.m.aerien')}</option>
            ))}
          </Select>
          <Segmented value={filter} onChange={setFilter} label={t('action.filter')} options={[
            { value: 'en_cours', label: t('ship.st.en_cours') },
            { value: 'retard', label: t('ship.late') },
            { value: 'arrivees', label: t('ls.fArriving') },
            { value: 'stationnement', label: t('ls.fDemurrage') },
            { value: 'bloquees', label: t('ship.st.bloquee') },
            { value: 'toutes', label: t('misc.everything') },
          ]} />
        </Toolbar>

        {rows.length === 0 ? (
          <Vide icon="ship" title={t('ship.none')} hint={v.shipments.length ? t('ls.noMatchHint') : undefined} />
        ) : (
          <Table className="ls-table">
            <thead>
              <tr>
                <th>{t('ship.reference')}</th>
                <th>{t('cases.client')}</th>
                <th className="col-optional">{t('ship.route')}</th>
                <th className="col-optional">{t('ship.mode')}</th>
                <th>{t('ship.stage')}</th>
                <th>{t('ship.eta')}</th>
                {finance && <th className="num col-optional">{t('ship.freight')}</th>}
                <th className="actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const enCours = s.status === 'en_cours'
                const retard = shipmentLate(s)
                return (
                  <tr
                    key={s.id}
                    className={`adm-row--click ${enCours ? '' : 'adm-row--off'}`}
                    tabIndex={0}
                    aria-label={`${s.reference} ${s.originPort} ${s.destPort}`}
                    onClick={() => navigate(`/cargaisons/${s.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/cargaisons/${s.id}`) }}
                  >
                    <td>
                      <div className="adm-cell-main">
                        <span className="ls-mono">{s.reference}</span>
                        <span className="t-caption t-truncate" style={{ maxWidth: 240 }}>{tt(s.goods)}</span>
                      </div>
                    </td>
                    <td className="t-medium">{shipmentClientLabel(db, s)}</td>
                    <td className="t-secondary col-optional ls-nowrap">{s.originPort} → {s.destPort}</td>
                    <td className="t-secondary col-optional">{t(`ship.m.${s.mode}` as 'ship.m.aerien')}</td>
                    <td>
                      <span className="col gap-1" style={{ minWidth: 130 }}>
                        <Pill tone={enCours ? SHIPMENT_TONE[s.stage] : s.status === 'livree' ? 'green' : s.status === 'bloquee' ? 'red' : 'gray'} dot>
                          {enCours ? t(`ship.s.${s.stage}` as 'ship.s.transit') : t(`ship.st.${s.status}` as 'ship.st.en_cours')}
                        </Pill>
                        <Progress pct={shipmentProgress(s)} tone={s.stage === 'livre' ? 'green' : undefined} />
                      </span>
                    </td>
                    <td className="ls-nowrap" style={{ color: retard ? 'var(--red)' : undefined }}>
                      {enCours ? <Countdown iso={s.eta} /> : formatDate(s.deliveredAt ?? s.eta)}
                    </td>
                    {finance && <td className="num col-optional">{formatMoney(s.freightCost)}</td>}
                    <td className="actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <span className="ls-actions">
                        {canWrite && enCours && s.stage !== 'livre' && <Button size="sm" icon="arrow" onClick={() => avancer(s)}>{t('ship.advance')}</Button>}
                        <Link to={`/cargaisons/${s.id}`} className="btn btn--icon" aria-label={t('action.open')} title={t('action.open')}><Icon name="chevron" size={18} /></Link>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Section>

      {creating && <ShipmentEditor shipment={null} onClose={() => setCreating(false)} />}
    </>
  )
}
