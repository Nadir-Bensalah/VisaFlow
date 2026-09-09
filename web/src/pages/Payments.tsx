import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Empty, Input, Pill, Segmented, useToast } from '@/components/ui'
import { CashGuard } from '@/components/CashGuard'
import { ExportButton } from '@/components/ExportButton'
import { Kpi, KpiGrid, PageHeader, Section, Table, Toolbar, Vide } from '@/components/page'
import { cashCheck } from '@/lib/conformite'
import { clientName, kpis } from '@/lib/derive'
import type { Payment } from '@/data/types'
import '@/styles/modules.css'

/* Les règlements des dossiers.
 *
 * Cet écran lit le magasin local : les paiements sont déjà chargés avec les
 * dossiers, et le geste « marquer payée » passe par les actions du magasin.
 * L'argent des clients ne transite jamais par VisaFlow : on constate, on ne
 * prélève pas. */

type Vue = 'du' | 'regle' | 'tous'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Les six derniers mois, du plus ancien au courant, en clé AAAA-MM. */
function sixMois(): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export function Payments() {
  const [cashGuard, setCashGuard] = useState<Payment | null>(null)
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt, formatMoney, formatDate } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const [view, setView] = useState<Vue>('du')
  const [q, setQ] = useState('')
  const k = kpis(db, v)

  /* ---------------------------- Compteurs ---------------------------- */

  const compte = useMemo(() => {
    const now = new Date()
    const debut = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const aujourdhui = now.toISOString().slice(0, 10)
    const c = { du: 0, duMontant: 0, mois: 0, moisN: 0, depassees: 0, depasseesMontant: 0 }
    for (const p of v.payments) {
      if (p.state === 'rembourse') continue
      if (p.state !== 'regle') {
        c.du++; c.duMontant += p.amount
        if (p.dueAt && p.dueAt.slice(0, 10) < aujourdhui) { c.depassees++; c.depasseesMontant += p.amount }
      } else if (p.at && new Date(p.at).getTime() >= debut) {
        c.mois += p.amount; c.moisN++
      }
    }
    // La courbe : ce qui a été encaissé chaque mois, sur six mois.
    const mois = sixMois()
    const serie = mois.map((m) => v.payments
      .filter((p) => p.state === 'regle' && p.at && p.at.slice(0, 7) === m)
      .reduce((s, p) => s + p.amount, 0))
    return { ...c, serie }
  }, [v.payments])

  /* ----------------------------- Filtrage ---------------------------- */

  const caseOf = (p: Payment) => v.cases.find((c) => c.id === p.caseId)

  const rows = useMemo(() => {
    const n = norm(q.trim())
    return v.payments
      .filter((p) => (view === 'tous' ? true : view === 'du' ? p.state !== 'regle' : p.state === 'regle'))
      .filter((p) => {
        if (!n) return true
        const kase = caseOf(p)
        return norm(`${tt(p.label)} ${kase ? clientName(db, kase.clientId) : ''} ${kase?.reference ?? ''} ${p.receiptNo ?? ''}`).includes(n)
      })
      .sort((a, b) => (b.at ?? b.dueAt ?? '').localeCompare(a.at ?? a.dueAt ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.payments, v.cases, view, q, db, tt])

  const marquerPayee = (p: Payment) => {
    // Au-delà de 5 000 DT en liquide sur un même dossier, l'amende est de
    // 2 000 DT minimum. On le dit avant le geste, pas au contrôle fiscal.
    const deja = v.payments
      .filter((x) => x.id !== p.id && x.caseId === p.caseId && x.method === 'especes' && x.state !== 'rembourse')
      .reduce((s, x) => s + x.amount, 0)
    const c = cashCheck(deja, p.amount, db.agency.currency)
    if (c.applies && c.over) { setCashGuard(p); return }
    actions.markPaymentPaid(p.id, 'especes')
    toast(t('action.markPaid'))
  }

  const colonnesExport = [
    { key: 'label', label: t('pay.label'), value: (p: Payment) => tt(p.label) },
    { key: 'client', label: t('cases.client'), value: (p: Payment) => { const c = caseOf(p); return c ? clientName(db, c.clientId) : '' } },
    { key: 'reference', label: t('cases.reference'), value: (p: Payment) => caseOf(p)?.reference },
    { key: 'state', label: t('pay.state'), value: (p: Payment) => t(`payment.${p.state}` as 'payment.du') },
    { key: 'method', label: t('pay.method'), value: (p: Payment) => (p.method ? t(`payment.${p.method}` as 'payment.especes') : '') },
    { key: 'date', label: t('pay.date'), value: (p: Payment) => (p.at ?? p.dueAt)?.slice(0, 10) },
    { key: 'amount', label: t('pay.amount'), value: (p: Payment) => p.amount },
    { key: 'receipt', label: t('pay.receipt'), value: (p: Payment) => p.receiptNo },
  ]

  return (
    <>
      <PageHeader
        kicker={t('mq.kickerMoney')}
        title={t('pay.title')}
        subtitle={t('mq.paymentsSub')}
        actions={<ExportButton rows={rows} columns={colonnesExport} base="paiements" scope="paiements" disabled={rows.length === 0} />}
      />

      <KpiGrid>
        <Kpi label={t('mq.payDue')} value={formatMoney(compte.duMontant)} icon="clock"
             tone={compte.du > 0 ? 'orange' : undefined} hint={t('mq.payDueHint', { n: compte.du })} />
        <Kpi label={t('mq.payLate')} value={compte.depassees} icon="alert"
             tone={compte.depassees > 0 ? 'red' : undefined}
             hint={compte.depassees > 0 ? t('mq.forAmount', { amount: formatMoney(compte.depasseesMontant) }) : t('mq.payNoLate')} />
        <Kpi label={t('mq.payMonth')} value={formatMoney(compte.mois)} icon="payments" tone="green"
             spark={compte.serie} hint={t('mq.payMonthHint', { n: compte.moisN })} />
        <Kpi label={t('pay.outstanding')} value={formatMoney(k.outstanding)} icon="cases"
             hint={t('mq.payOutstandingHint')} />
      </KpiGrid>

      {v.payments.length === 0 ? (
        <Section><Empty title={t('pay.none')} hint={t('mq.payNoneHint')} scene="vide" /></Section>
      ) : (
        <Section flush>
          <Toolbar right={<><span className="t-caption t-tertiary t-num">{t('mq.rowsOf', { n: rows.length, total: v.payments.length })}</span><Input className="md-search" value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder={t('mq.paySearch')} aria-label={t('mq.search')} /></>}>
            <Segmented<Vue>
              value={view}
              onChange={setView}
              label={t('pay.state')}
              options={[
                { value: 'du', label: `${t('payment.du')} · ${compte.du}` },
                { value: 'regle', label: t('payment.regle') },
                { value: 'tous', label: `${t('misc.everything')} · ${v.payments.length}` },
              ]}
            />
          </Toolbar>

          {rows.length === 0 ? (
            <Vide title={t('mq.nothingInFilter')} hint={t('mq.nothingInFilterHint')} icon="search" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t('pay.label')}</th>
                  <th>{t('cases.client')}</th>
                  <th>{t('pay.state')}</th>
                  <th className="col-optional">{t('pay.method')}</th>
                  <th className="col-optional">{t('pay.date')}</th>
                  <th className="num">{t('pay.amount')}</th>
                  <th className="actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const kase = caseOf(p)
                  const depasse = p.state !== 'regle' && p.dueAt && new Date(p.dueAt) < new Date()
                  return (
                    <tr key={p.id} className={kase ? 'adm-row--click' : ''} onClick={() => kase && navigate(`/dossiers/${kase.id}`)}>
                      <td>
                        <div className="adm-cell-main">
                          <span>{tt(p.label)}</span>
                          {p.receiptNo && <span className="t-caption t-mono">{p.receiptNo}</span>}
                        </div>
                      </td>
                      <td>
                        <div className="adm-cell-main">
                          <span style={{ fontWeight: 'normal' }}>{kase ? clientName(db, kase.clientId) : <span className="t-tertiary">·</span>}</span>
                          {kase?.reference && <span className="t-caption t-mono">{kase.reference}</span>}
                        </div>
                      </td>
                      <td>
                        <Pill tone={p.state === 'regle' ? 'green' : depasse ? 'red' : 'orange'} dot>
                          {t(`payment.${p.state}` as 'payment.du')}
                        </Pill>
                      </td>
                      <td className="col-optional t-secondary">{p.method ? t(`payment.${p.method}` as 'payment.especes') : <span className="t-tertiary">·</span>}</td>
                      <td className={`col-optional ${depasse ? 't-red' : 't-tertiary'}`}>{formatDate(p.at ?? p.dueAt)}</td>
                      <td className="num t-medium">{formatMoney(p.amount)}</td>
                      <td className="actions" onClick={(e) => e.stopPropagation()}>
                        {p.state !== 'regle' && (
                          <Button size="sm" variant="primary" icon="check" onClick={() => marquerPayee(p)}>{t('action.markPaid')}</Button>
                        )}
                        {kase && <Button size="sm" onClick={() => navigate(`/dossiers/${kase.id}`)}>{t('mq.openCase')}</Button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </Section>
      )}
      {cashGuard && <CashGuard payment={cashGuard} onClose={() => setCashGuard(null)} />}
    </>
  )
}
