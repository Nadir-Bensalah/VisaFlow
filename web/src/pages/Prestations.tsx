import { useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { clientName } from '@/lib/derive'
import type { Tone } from '@/lib/derive'
import { Button, Empty, Input, Pill, Select } from '@/components/ui'
import { ExportButton } from '@/components/ExportButton'
import {
  Erreur, Kpi, KpiGrid, PageHeader, Section, Squelette, Table, Toolbar, Vide, useChargement,
} from '@/components/page'
import { TravelEditor } from '@/components/TravelPanel'
import {
  loadTravelMoney, loadTravelReport, loadTravelServices, TRAVEL_KINDS, TRAVEL_STATUSES,
} from '@/data/voyage'
import type {
  MarginReport, TravelKind, TravelMoney, TravelService, TravelStatus,
} from '@/data/voyage'
import '@/styles/modules.css'

/**
 * L'écran de celui qui note les billets toute la journée.
 *
 * Il cherche une référence, il change un état, il vérifie une date de départ.
 * Le tri par défaut est donc le plus récent en premier : ce qu'il vient de
 * saisir, il le relit dans la minute.
 *
 * LE TOTAL EN TÊTE VIENT DU SERVEUR, jamais d'une addition faite ici. Il ne
 * s'affiche qu'avec `finance:global` : un agent voit ses prestations et ce
 * qu'on a facturé au client, pas ce que l'agence gagne.
 *
 * Sans backend, cet écran dit qu'il n'est pas branché. Il n'invente aucun
 * chiffre : un tableau de démonstration ferait prendre des décisions sur du
 * vide.
 */

const TONE: Record<TravelStatus, Tone> = {
  a_faire: 'gray', enregistre: 'blue', confirme: 'green', annule: 'red', rembourse: 'orange',
}

const monthsAgo = (n: number): string => {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}
const today = () => new Date().toISOString().slice(0, 10)
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function Prestations() {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatDate, formatMoney } = useI18n()

  const [kind, setKind] = useState<TravelKind | ''>('')
  const [status, setStatus] = useState<TravelStatus | ''>('')
  const [from, setFrom] = useState(monthsAgo(3))
  const [to, setTo] = useState(today())
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<TravelService | null>(null)
  const [creating, setCreating] = useState(false)

  const canMoney = v.can('finance:global')
  const canWrite = v.can('payment:write')

  const { data, loading, refreshing, error, reload } = useChargement(async () => {
    if (!HAS_BACKEND) return { rows: [] as TravelService[], money: [] as TravelMoney[], report: null as MarginReport | null }
    const rows = await loadTravelServices({ kind: kind || undefined, status: status || undefined, from, to })
    // Le coût et la marge ne sortent pas de la table : sans le droit, on ne
    // demande rien, et l'écran ne fait pas semblant de les avoir.
    const money = canMoney ? await loadTravelMoney({ officeId: v.officeId, from, to }) : []
    const report = canMoney ? await loadTravelReport(v.officeId, from, to) : null
    return { rows, money, report }
  }, [kind, status, from, to, canMoney, v.officeId])

  const rows = useMemo(() => data?.rows ?? [], [data])
  const report = data?.report ?? null

  const byId = useMemo(() => {
    const m = new Map<string, TravelMoney>()
    for (const x of data?.money ?? []) m.set(x.id, x)
    return m
  }, [data])

  const clientOptions = useMemo(
    () => v.clients.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}`, hint: c.phone })),
    [v.clients],
  )

  const nom = (id: string | null) => (id ? clientName(db, id) : '')

  const shown = useMemo(() => {
    const n = norm(q.trim())
    if (!n) return rows
    return rows.filter((r) => norm(`${r.reference ?? ''} ${r.supplierName ?? ''} ${nom(r.clientId)}`).includes(n))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, db])

  // Ce que l'agence a facturé au client : une somme de colonnes déjà là.
  // Deux devises dans la période, et le total ne veut plus rien dire.
  const compte = useMemo(() => {
    const devises = new Set(rows.map((r) => r.currency))
    const vendu = rows.reduce((s, r) => s + r.soldAmount, 0)
    return {
      aFaire: rows.filter((r) => r.status === 'a_faire').length,
      confirmees: rows.filter((r) => r.status === 'confirme').length,
      vendu, devise: rows[0]?.currency ?? db.agency.currency, mixte: devises.size > 1,
    }
  }, [rows, db.agency.currency])

  const colonnesExport = [
    { key: 'reference', label: t('voy.reference'), value: (r: TravelService) => r.reference },
    { key: 'kind', label: t('voy.filterKind'), value: (r: TravelService) => t(`voy.kind${r.kind}` as 'voy.kindBILLET') },
    { key: 'client', label: t('voy.client'), value: (r: TravelService) => nom(r.clientId) },
    { key: 'supplier', label: t('voy.supplier'), value: (r: TravelService) => r.supplierName },
    { key: 'status', label: t('voy.status'), value: (r: TravelService) => t(`voy.status_${r.status}` as 'voy.status_a_faire') },
    { key: 'bookedAt', label: t('voy.bookedAt'), value: (r: TravelService) => (r.bookedAt ?? r.createdAt).slice(0, 10) },
    { key: 'sold', label: t('voy.sold'), value: (r: TravelService) => r.soldAmount },
    { key: 'currency', label: t('voy.currency'), value: (r: TravelService) => r.currency },
    ...(canMoney ? [{ key: 'margin', label: t('voy.margin'), value: (r: TravelService) => byId.get(r.id)?.margin }] : []),
  ]

  const head = (
    <PageHeader
      kicker={t('mq.kickerMoney')}
      title={t('voy.pageTitle')}
      subtitle={t('mq.prestSub')}
      refreshing={refreshing && !loading}
      refreshingLabel={t('mq.refreshing')}
      actions={HAS_BACKEND ? <>
        <ExportButton rows={shown} columns={colonnesExport} base="prestations" scope="prestations" disabled={shown.length === 0} />
        <Button icon="refresh" onClick={() => void reload()} disabled={refreshing}>{t('mq.refresh')}</Button>
        {canWrite && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('voy.addAutre')}</Button>}
      </> : undefined}
    />
  )

  if (!HAS_BACKEND) {
    return (
      <>
        {head}
        <Section><Empty title={t('mq.demoTitle')} hint={t('mq.demoHint')} scene="vide" /></Section>
      </>
    )
  }

  return (
    <>
      {head}

      {error && <Erreur message={error} retryLabel={t('mq.retry')} onRetry={() => void reload()} />}

      {loading && !data ? (
        <>
          <Squelette type="kpis" n={4} />
          <Section flush><Squelette type="table" n={6} /></Section>
        </>
      ) : (
        <>
          <KpiGrid>
            <Kpi label={t('mq.prestCount')} value={rows.length} icon="plane" tone="blue"
                 hint={`${formatDate(from)} · ${formatDate(to)}`} />
            <Kpi label={t('voy.status_a_faire')} value={compte.aFaire} icon="clock"
                 tone={compte.aFaire > 0 ? 'orange' : undefined} hint={t('mq.prestTodoHint')} />
            <Kpi label={t('voy.totalSold')} value={compte.mixte ? '·' : formatMoney(compte.vendu, compte.devise)} icon="payments"
                 hint={compte.mixte ? t('mq.mixedCurrencies') : t('mq.prestSoldHint', { n: compte.confirmees })} />
            {canMoney && (
              <Kpi label={t('voy.totalMargin')}
                   value={report ? formatMoney(report.total.margin, report.currency) : '·'}
                   icon="reports" tone={report && report.total.margin < 0 ? 'red' : 'green'}
                   hint={report ? t('voy.totalCount', { n: report.total.count }) : t('mq.notEnough')} />
            )}
          </KpiGrid>

          {/* La marge par nature. C'est le tableau qui répond à
              « qu'est-ce qui me fait vivre ? », et c'est souvent une surprise. */}
          {report && report.kinds.length > 0 && (
            <Section title={t('voy.marginTitle')} flush>
              <Table>
                <thead>
                  <tr>
                    <th>{t('voy.filterKind')}</th>
                    <th className="num">{t('voy.totalCount', { n: '' }).trim()}</th>
                    <th className="num col-optional">{t('voy.sold')}</th>
                    <th className="num col-optional">{t('voy.cost')}</th>
                    <th className="num">{t('voy.margin')}</th>
                    <th className="num col-optional">{t('voy.marginPct')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.kinds.map((k) => (
                    <tr key={k.kind}>
                      <td className="t-medium">{t(`voy.kind${k.kind}` as 'voy.kindBILLET')}</td>
                      <td className="num">{k.count}</td>
                      <td className="num col-optional">{formatMoney(k.sold, report.currency)}</td>
                      <td className="num col-optional">{formatMoney(k.cost, report.currency)}</td>
                      <td className="num t-medium" style={{ color: k.margin < 0 ? 'var(--red)' : 'var(--green)' }}>{formatMoney(k.margin, report.currency)}</td>
                      <td className="num col-optional">{k.marginPct !== null ? `${k.marginPct} %` : '·'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Section>
          )}

          <Section flush>
            <Toolbar right={<><span className="t-caption t-tertiary t-num">{t('mq.rowsOf', { n: shown.length, total: rows.length })}</span><Input className="md-search" value={q} onChange={(e) => setQ(e.target.value)}
                     placeholder={t('mq.prestSearch')} aria-label={t('mq.search')} /></>}>
              <Select className="md-select" value={kind} onChange={(e) => setKind(e.target.value as TravelKind | '')} aria-label={t('voy.filterKind')}>
                <option value="">{t('voy.allKinds')}</option>
                {TRAVEL_KINDS.map((k) => (
                  <option key={k} value={k}>{t(`voy.kind${k}` as 'voy.kindBILLET')}</option>
                ))}
              </Select>
              <Select className="md-select" value={status} onChange={(e) => setStatus(e.target.value as TravelStatus | '')} aria-label={t('voy.filterStatus')}>
                <option value="">{t('voy.allStatuses')}</option>
                {TRAVEL_STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`voy.status_${s}` as 'voy.status_a_faire')}</option>
                ))}
              </Select>
              <Input className="md-date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('voy.filterFrom')} />
              <Input className="md-date" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('voy.filterTo')} />
            </Toolbar>

            {rows.length === 0 ? (
              <Vide
                title={t('voy.noRows')}
                hint={t('voy.noRowsHint')}
                icon="plane"
                action={canWrite ? <Button size="sm" icon="plus" onClick={() => setCreating(true)}>{t('voy.addAutre')}</Button> : undefined}
              />
            ) : shown.length === 0 ? (
              <Vide title={t('mq.nothingInFilter')} hint={t('mq.nothingInFilterHint')} icon="search" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>{t('voy.reference')}</th>
                    <th className="col-optional">{t('voy.filterKind')}</th>
                    <th>{t('voy.client')}</th>
                    <th>{t('voy.status')}</th>
                    <th className="col-optional">{t('voy.bookedAt')}</th>
                    <th className="num">{t('voy.sold')}</th>
                    {canMoney && <th className="num col-optional">{t('voy.margin')}</th>}
                    <th className="actions" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const m = byId.get(r.id) ?? null
                    return (
                      <tr key={r.id} className={canWrite ? 'adm-row--click' : ''} onClick={canWrite ? () => setEditing(r) : undefined}>
                        <td>
                          <div className="adm-cell-main">
                            <span className="t-mono">{r.reference || t('voy.none')}</span>
                            {r.supplierName && <span className="t-caption">{r.supplierName}</span>}
                          </div>
                        </td>
                        <td className="col-optional t-secondary">{t(`voy.kind${r.kind}` as 'voy.kindBILLET')}</td>
                        <td>{r.clientId ? nom(r.clientId) : <span className="t-tertiary">{t('voy.none')}</span>}</td>
                        <td><Pill tone={TONE[r.status]} dot>{t(`voy.status_${r.status}` as 'voy.status_a_faire')}</Pill></td>
                        <td className="col-optional t-tertiary">{formatDate(r.bookedAt ?? r.createdAt)}</td>
                        <td className="num t-medium">{formatMoney(r.soldAmount, r.currency)}</td>
                        {canMoney && (
                          <td className="num col-optional" style={{ color: m && m.margin < 0 ? 'var(--red)' : undefined }}>
                            {m ? formatMoney(m.margin, m.currency) : <span className="t-tertiary">·</span>}
                          </td>
                        )}
                        <td className="actions" onClick={(e) => e.stopPropagation()}>
                          {canWrite && <Button size="sm" icon="edit" onClick={() => setEditing(r)}>{t('crud.edit')}</Button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
          </Section>
        </>
      )}

      {(editing || creating) && (
        <TravelEditor
          agencyId={db.agency.id}
          currency={db.agency.currency}
          // Un billet sec se vend sans dossier de visa : le dossier reste vide,
          // le client, lui, est toujours connu.
          caseId={editing?.caseId ?? null}
          clientId={editing?.clientId ?? null}
          officeId={editing?.officeId ?? v.officeId ?? v.user.officeId ?? null}
          kind={editing?.kind ?? 'BILLET'}
          row={editing}
          money={editing ? byId.get(editing.id) ?? null : null}
          canMoney={canMoney}
          clientOptions={clientOptions}
          onClose={() => { setEditing(null); setCreating(false) }}
          onDone={async () => { setEditing(null); setCreating(false); await reload() }}
        />
      )}
    </>
  )
}
