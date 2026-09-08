import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { clientName } from '@/lib/derive'
import type { Tone } from '@/lib/derive'
import { Button, Card, Empty, Field, Input, Pill, Select } from '@/components/ui'
import { PageHead } from '@/components/bits'
import { TravelEditor } from '@/components/TravelPanel'
import {
  loadTravelMoney, loadTravelReport, loadTravelServices, TRAVEL_KINDS, TRAVEL_STATUSES,
} from '@/data/voyage'
import type {
  MarginReport, TravelKind, TravelMoney, TravelService, TravelStatus,
} from '@/data/voyage'

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

export function Prestations() {
  const { db } = useStore()
  const v = useVisible()
  const { t, formatDate, formatMoney } = useI18n()

  const [rows, setRows] = useState<TravelService[]>([])
  const [money, setMoney] = useState<TravelMoney[]>([])
  const [report, setReport] = useState<MarginReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [kind, setKind] = useState<TravelKind | ''>('')
  const [status, setStatus] = useState<TravelStatus | ''>('')
  const [from, setFrom] = useState(monthsAgo(3))
  const [to, setTo] = useState(today())
  const [editing, setEditing] = useState<TravelService | null>(null)
  const [creating, setCreating] = useState(false)

  const canMoney = v.can('finance:global')
  const canWrite = v.can('payment:write')

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try {
      const list = await loadTravelServices({
        kind: kind || undefined, status: status || undefined, from, to,
      })
      setRows(list)
      // Le coût et la marge ne sortent pas de la table : sans le droit, on ne
      // demande rien, et l'écran ne fait pas semblant de les avoir.
      setMoney(canMoney ? await loadTravelMoney({ officeId: v.officeId, from, to }) : [])
      setReport(canMoney ? await loadTravelReport(v.officeId, from, to) : null)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [kind, status, from, to, canMoney, v.officeId])

  useEffect(() => { void reload() }, [reload])

  const byId = useMemo(() => {
    const m = new Map<string, TravelMoney>()
    for (const x of money) m.set(x.id, x)
    return m
  }, [money])

  const clientOptions = useMemo(
    () => v.clients.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}`, hint: c.phone })),
    [v.clients],
  )

  if (!HAS_BACKEND) {
    return (
      <>
        <PageHead title={t('voy.pageTitle')} subtitle={t('voy.pageSub')} />
        <Card><Empty title={t('voy.offline')} hint={t('voy.offlineHint')} scene="alerte" /></Card>
      </>
    )
  }

  return (
    <>
      <PageHead title={t('voy.pageTitle')} subtitle={t('voy.pageSub')} />

      {error && <Card><p className="t-small t-orange">{t('voy.loadError', { msg: error })}</p></Card>}

      {/* La marge de la période, par nature. C'est le tableau qui répond à
          « qu'est-ce qui me fait vivre ? », et c'est souvent une surprise. */}
      {report && (
        <Card title={t('voy.totalMargin')}>
          <div className="row-between wrap gap-3">
            <span className="t-title" style={{ fontSize: 'var(--size-lead)' }}>
              {formatMoney(report.total.margin, report.currency)}
            </span>
            <span className="t-caption t-tertiary">
              {t('voy.totalSold')} {formatMoney(report.total.sold, report.currency)}
              {' · '}{t('voy.totalCount', { n: report.total.count })}
            </span>
          </div>
          {report.kinds.length > 0 && (
            <div className="row wrap gap-3" style={{ marginTop: 'var(--sp-3)' }}>
              {report.kinds.map((k) => (
                <span key={k.kind} className="t-caption t-secondary">
                  {t(`voy.kind${k.kind}` as 'voy.kindBILLET')} · {formatMoney(k.margin, report.currency)}
                  {k.marginPct !== null && ` (${k.marginPct} %)`}
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card flush>
        <div className="row wrap gap-3" style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--hairline)', alignItems: 'flex-end' }}>
          <Field label={t('voy.filterKind')}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as TravelKind | '')}>
              <option value="">{t('voy.allKinds')}</option>
              {TRAVEL_KINDS.map((k) => (
                <option key={k} value={k}>{t(`voy.kind${k}` as 'voy.kindBILLET')}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('voy.filterStatus')}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as TravelStatus | '')}>
              <option value="">{t('voy.allStatuses')}</option>
              {TRAVEL_STATUSES.map((s) => (
                <option key={s} value={s}>{t(`voy.status_${s}` as 'voy.status_a_faire')}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('voy.filterFrom')}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('voy.filterTo')}>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>

        {rows.length === 0 ? (
          <Empty title={t('voy.noRows')} hint={t('voy.noRowsHint')} />
        ) : (
          <div className="tablewrap">
            <table className={canWrite ? 'table table--clickable' : 'table'}>
              <thead>
                <tr>
                  <th>{t('voy.reference')}</th>
                  <th>{t('voy.filterKind')}</th>
                  <th>{t('voy.client')}</th>
                  <th>{t('voy.status')}</th>
                  <th>{t('voy.bookedAt')}</th>
                  <th className="num">{t('voy.sold')}</th>
                  {canMoney && <th className="num">{t('voy.margin')}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const m = byId.get(r.id) ?? null
                  return (
                    <tr key={r.id} onClick={canWrite ? () => setEditing(r) : undefined}>
                      <td className="t-mono t-small t-medium">
                        {r.reference || r.pnr || r.policyNumber || t('voy.none')}
                      </td>
                      <td className="t-small t-secondary">{t(`voy.kind${r.kind}` as 'voy.kindBILLET')}</td>
                      <td className="t-small">{r.clientId ? clientName(db, r.clientId) : t('voy.none')}</td>
                      <td><Pill tone={TONE[r.status]} dot>{t(`voy.status_${r.status}` as 'voy.status_a_faire')}</Pill></td>
                      <td className="t-caption t-tertiary">{formatDate(r.bookedAt ?? r.createdAt)}</td>
                      <td className="num t-medium">{formatMoney(r.soldAmount, r.currency)}</td>
                      {canMoney && (
                        <td className="num t-small" style={{ color: m && m.margin < 0 ? 'var(--red)' : undefined }}>
                          {m ? formatMoney(m.margin, m.currency) : t('voy.none')}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canWrite && (
        <div className="row" style={{ marginTop: 'var(--sp-4)' }}>
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            {t('voy.addAutre')}
          </Button>
        </div>
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
