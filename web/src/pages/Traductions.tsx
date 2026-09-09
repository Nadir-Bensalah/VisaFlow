import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Empty, Input, Pill, Segmented, Select, useToast } from '@/components/ui'
import { ExportButton } from '@/components/ExportButton'
import {
  Erreur, Kpi, KpiGrid, PageHeader, Section, Squelette, Table, Toolbar, Vide, useChargement,
} from '@/components/page'
import {
  handOverTranslation, loadLate, loadMarginReport, loadOrders, loadTranslators,
} from '@/data/traduction'
import type {
  LateTranslation, MarginRow, TranslationOrder, TranslationStatus, Translator,
} from '@/data/traduction'
import type { Tone } from '@/lib/derive'
import '@/styles/modules.css'

/**
 * L'écran de celui qui suit les traducteurs.
 *
 * Les retards sont en tête, et c'est tout le sujet : une traduction qui dort
 * trois semaines chez un traducteur est la première cause de dossier en
 * souffrance, et personne ne s'en aperçoit tant que le client n'appelle pas.
 *
 * La marge n'apparaît que pour qui a le droit de la voir. Elle vient du
 * serveur, qui la calcule : rien n'est additionné ici.
 */

const STATUS_TONE: Record<TranslationStatus, Tone> = {
  a_commander: 'gray',
  commandee: 'blue',
  en_cours: 'blue',
  livree: 'green',
  remise_client: 'green',
  annulee: 'gray',
}

const STATUS_KEY: Record<TranslationStatus, string> = {
  a_commander: 'trad.statusA_commander',
  commandee: 'trad.statusCommandee',
  en_cours: 'trad.statusEn_cours',
  livree: 'trad.statusLivree',
  remise_client: 'trad.statusRemise_client',
  annulee: 'trad.statusAnnulee',
}

type View = 'ouvertes' | 'livree' | 'toutes'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function Traductions() {
  const v = useVisible()
  const { t, formatDate, formatMoney } = useI18n()
  const toast = useToast()

  const [view, setView] = useState<View>('ouvertes')
  const [translatorId, setTranslatorId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')

  const canFinance = v.can('finance:global')
  const canWrite = v.can('case:write')

  const { data, loading, refreshing, error, reload } = useChargement(async () => {
    if (!HAS_BACKEND) return { orders: [] as TranslationOrder[], late: [] as LateTranslation[], translators: [] as Translator[] }
    const [orders, late, translators] = await Promise.all([
      loadOrders({
        status: view === 'toutes' ? 'toutes' : view,
        translatorId: translatorId || null,
        from: from || null,
        to: to || null,
      }),
      loadLate(v.officeId),
      loadTranslators(),
    ])
    return { orders, late, translators }
  }, [view, translatorId, from, to, v.officeId])

  // Le rapport de marge est une porte à part : le serveur la refuse à qui n'a
  // pas finance:global, on ne la pousse donc pas.
  const marge = useChargement(
    () => (HAS_BACKEND && canFinance ? loadMarginReport(v.officeId, from || null, to || null) : Promise.resolve([] as MarginRow[])),
    [canFinance, v.officeId, from, to],
  )
  const margins = useMemo(() => marge.data ?? [], [marge.data])

  const orders = useMemo(() => data?.orders ?? [], [data])
  const late = useMemo(() => data?.late ?? [], [data])
  const translators = useMemo(() => data?.translators ?? [], [data])

  const lateById = useMemo(() => {
    const map = new Map<string, number>()
    late.forEach((l) => map.set(l.orderId, l.daysLate))
    return map
  }, [late])

  const translatorName = (id: string | null) =>
    translators.find((x) => x.id === id)?.name ?? t('trad.none')

  // Les retards d'abord, puis les plus récentes. Un écran de suivi qui range
  // par date de création enterre exactement ce qu'on vient y chercher.
  const rows = useMemo(() => {
    const n = norm(q.trim())
    return [...orders]
      .filter((o) => !n || norm(`${o.orderNumber} ${translatorName(o.translatorId)} ${o.sourceLang ?? ''} ${o.targetLang ?? ''} ${o.documentKind}`).includes(n))
      .sort((a, b) => {
        const la = lateById.get(a.id) ?? -1
        const lb = lateById.get(b.id) ?? -1
        if (la !== lb) return lb - la
        return (b.orderedAt ?? b.createdAt).localeCompare(a.orderedAt ?? a.createdAt)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, lateById, q, translators])

  const compte = useMemo(() => ({
    aRemettre: orders.filter((o) => o.status === 'livree').length,
    enCours: orders.filter((o) => o.status === 'commandee' || o.status === 'en_cours').length,
  }), [orders])

  const totalMargin = useMemo(() => margins.reduce((sum, m) => sum + m.margin, 0), [margins])
  const marginCurrency = margins[0]?.currency ?? 'TND'
  // Additionner deux devises donnerait un total qui ne veut rien dire.
  const mixedCurrencies = new Set(margins.map((m) => m.currency)).size > 1

  const hand = async (orderId: string) => {
    try { await handOverTranslation(orderId); toast(t('trad.handedOver')); await reload() }
    catch (e) { toast((e as Error).message) }
  }

  const colonnesExport = [
    { key: 'number', label: t('trad.orderNumber'), value: (o: TranslationOrder) => o.orderNumber },
    { key: 'translator', label: t('trad.translator'), value: (o: TranslationOrder) => translatorName(o.translatorId) },
    { key: 'langs', label: t('trad.langPair'), value: (o: TranslationOrder) => (o.sourceLang ? `${o.sourceLang} > ${o.targetLang ?? ''}` : '') },
    { key: 'sworn', label: t('trad.sworn'), value: (o: TranslationOrder) => (o.swornRequired ? t('misc.yes') : t('misc.no')) },
    { key: 'pages', label: t('trad.pages'), value: (o: TranslationOrder) => o.pages },
    { key: 'status', label: t('trad.status'), value: (o: TranslationOrder) => t(STATUS_KEY[o.status] as 'trad.statusCommandee') },
    { key: 'ordered', label: t('trad.ordered'), value: (o: TranslationOrder) => o.orderedAt?.slice(0, 10) },
    { key: 'promised', label: t('trad.promised'), value: (o: TranslationOrder) => o.promisedAt?.slice(0, 10) },
    { key: 'delivered', label: t('trad.delivered'), value: (o: TranslationOrder) => o.deliveredAt?.slice(0, 10) },
    { key: 'late', label: t('trad.late'), value: (o: TranslationOrder) => lateById.get(o.id) ?? '' },
    { key: 'sold', label: t('trad.soldAmount'), value: (o: TranslationOrder) => o.soldAmount },
    { key: 'currency', label: t('trad.currency'), value: (o: TranslationOrder) => o.currency },
  ]

  const head = (
    <PageHeader
      kicker={t('mq.kickerCases')}
      title={t('trad.title')}
      subtitle={t('mq.tradSub')}
      refreshing={refreshing && !loading}
      refreshingLabel={t('mq.refreshing')}
      actions={HAS_BACKEND ? <>
        <ExportButton rows={rows} columns={colonnesExport} base="traductions" scope="traductions" disabled={rows.length === 0} />
        <Button icon="refresh" onClick={() => { void reload(); void marge.reload() }} disabled={refreshing}>{t('mq.refresh')}</Button>
      </> : undefined}
    />
  )

  if (!HAS_BACKEND) {
    return (
      <>
        {head}
        <Section><Empty title={t('mq.demoTitle')} hint={t('mq.demoHint')} scene="passeport" /></Section>
      </>
    )
  }

  return (
    <>
      {head}

      {error && <Erreur message={error} retryLabel={t('mq.retry')} onRetry={() => void reload()} />}
      {marge.error && <Erreur message={marge.error} retryLabel={t('mq.retry')} onRetry={() => void marge.reload()} />}

      {loading && !data ? (
        <>
          <Squelette type="kpis" n={4} />
          <Section flush><Squelette type="table" n={6} /></Section>
        </>
      ) : (
        <>
          <KpiGrid>
            <Kpi label={t('trad.late')} value={late.length} icon="alert"
                 tone={late.length > 0 ? 'red' : 'green'}
                 hint={late.length === 0 ? t('trad.noLate') : t('mq.tradLateHint')} />
            <Kpi label={t('mq.tradToHand')} value={compte.aRemettre} icon="check"
                 tone={compte.aRemettre > 0 ? 'orange' : undefined} hint={t('mq.tradToHandHint')} />
            <Kpi label={t('mq.tradInProgress')} value={compte.enCours} icon="language" tone="blue"
                 hint={t('mq.tradInProgressHint', { n: orders.length })} />
            {canFinance && (
              <Kpi label={t('trad.totalMargin')}
                   value={margins.length === 0 ? '·' : mixedCurrencies ? '·' : formatMoney(totalMargin, marginCurrency)}
                   icon="payments" tone={totalMargin < 0 ? 'red' : 'green'}
                   hint={mixedCurrencies ? t('mq.mixedCurrencies') : margins.length === 0 ? t('mq.tradNoMargin') : t('mq.tradMarginHint')} />
            )}
          </KpiGrid>

          {late.length > 0 && (
            <Section title={t('trad.lateFirst')} flush action={<Pill tone="red">{late.length}</Pill>}>
              <Table>
                <thead>
                  <tr>
                    <th>{t('trad.orderNumber')}</th>
                    <th>{t('trad.translator')}</th>
                    <th className="col-optional">{t('trad.langPair')}</th>
                    <th className="col-optional">{t('trad.promised')}</th>
                    <th className="num">{t('trad.late')}</th>
                    <th className="actions" />
                  </tr>
                </thead>
                <tbody>
                  {late.map((l) => (
                    <tr key={l.orderId}>
                      <td className="t-mono t-medium">
                        {l.caseId ? <Link to={`/dossiers/${l.caseId}`}>{l.orderNumber}</Link> : l.orderNumber}
                      </td>
                      <td>{l.translatorName ?? <span className="t-tertiary">{t('trad.none')}</span>}</td>
                      <td className="col-optional t-secondary">{l.sourceLang ? `${l.sourceLang} → ${l.targetLang ?? ''}` : '·'}</td>
                      <td className="col-optional">{formatDate(l.promisedAt)}</td>
                      <td className="num"><Pill tone="red" dot>{t('trad.lateBy', { n: l.daysLate })}</Pill></td>
                      <td className="actions">
                        {l.caseId && <Link className="btn btn--secondary btn--sm" to={`/dossiers/${l.caseId}`}>{t('mq.openCase')}</Link>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Section>
          )}

          <Section flush>
            <Toolbar right={<><span className="t-caption t-tertiary t-num">{t('trad.results', { n: rows.length })}</span><Input className="md-search" value={q} onChange={(e) => setQ(e.target.value)}
                     placeholder={t('mq.tradSearch')} aria-label={t('mq.search')} /></>}>
              <Segmented<View>
                value={view}
                onChange={setView}
                label={t('trad.status')}
                options={[
                  { value: 'ouvertes', label: t('trad.open') },
                  { value: 'livree', label: t('trad.done') },
                  { value: 'toutes', label: t('trad.all') },
                ]}
              />
              <Select className="md-select" value={translatorId} onChange={(e) => setTranslatorId(e.target.value)} aria-label={t('trad.filterTranslator')}>
                <option value="">{t('trad.anyTranslator')}</option>
                {translators.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
              <Input className="md-date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('trad.from')} />
              <Input className="md-date" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('trad.to')} />
            </Toolbar>

            {orders.length === 0 ? (
              <Vide title={t('trad.noPieces')} hint={t('trad.noPiecesHint')} icon="language" />
            ) : rows.length === 0 ? (
              <Vide title={t('mq.nothingInFilter')} hint={t('mq.nothingInFilterHint')} icon="search" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>{t('trad.orderNumber')}</th>
                    <th>{t('trad.translator')}</th>
                    <th className="col-optional">{t('trad.langPair')}</th>
                    <th className="num col-optional">{t('trad.pages')}</th>
                    <th>{t('trad.status')}</th>
                    <th className="col-optional">{t('trad.promised')}</th>
                    <th className="num col-optional">{t('trad.soldAmount')}</th>
                    <th className="actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => {
                    const days = lateById.get(o.id)
                    return (
                      <tr key={o.id}>
                        <td>
                          <div className="adm-cell-main">
                            <span className="t-mono">
                              {o.caseId ? <Link to={`/dossiers/${o.caseId}`}>{o.orderNumber}</Link> : o.orderNumber}
                            </span>
                            <span className="t-caption">{o.documentKind}</span>
                          </div>
                        </td>
                        <td>{translatorName(o.translatorId)}</td>
                        <td className="col-optional t-secondary">
                          {o.sourceLang ? `${o.sourceLang} → ${o.targetLang ?? ''}` : '·'}
                          {o.swornRequired && <span className="t-caption t-tertiary"> · {t('trad.sworn')}</span>}
                        </td>
                        <td className="num col-optional">{o.pages ?? <span className="t-tertiary">·</span>}</td>
                        <td>
                          <Pill tone={days !== undefined ? 'red' : STATUS_TONE[o.status]} dot>
                            {t(STATUS_KEY[o.status] as 'trad.statusCommandee')}
                          </Pill>
                        </td>
                        <td className="col-optional">
                          <div className="adm-cell-main">
                            <span style={{ fontWeight: 'normal' }}>{o.promisedAt ? formatDate(o.promisedAt) : <span className="t-tertiary">{t('trad.none')}</span>}</span>
                            {days !== undefined && <span className="t-caption t-red">{t('trad.lateBy', { n: days })}</span>}
                          </div>
                        </td>
                        <td className="num col-optional">
                          {o.soldAmount !== null ? formatMoney(o.soldAmount, o.currency) : <span className="t-tertiary">·</span>}
                        </td>
                        <td className="actions">
                          {canWrite && o.status === 'livree' && (
                            <Button size="sm" variant="primary" icon="check" onClick={() => void hand(o.id)}>{t('trad.handOver')}</Button>
                          )}
                          {o.caseId && <Link className="btn btn--secondary btn--sm" to={`/dossiers/${o.caseId}`}>{t('mq.openCase')}</Link>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
          </Section>

          {canFinance && margins.length > 0 && (
            <Section
              title={t('trad.totalMargin')}
              action={!mixedCurrencies
                ? <span className="t-medium t-num">{formatMoney(totalMargin, marginCurrency)}</span>
                : <span className="t-caption t-tertiary">{t('mq.mixedCurrencies')}</span>}
              flush
            >
              <Table>
                <thead>
                  <tr>
                    <th>{t('trad.translator')}</th>
                    <th className="col-optional">{t('trad.langPair')}</th>
                    <th className="num">{t('trad.count')}</th>
                    <th className="num col-optional">{t('trad.pages')}</th>
                    <th className="num col-optional">{t('trad.soldAmount')}</th>
                    <th className="num col-optional">{t('trad.costAmount')}</th>
                    <th className="num">{t('trad.margin')}</th>
                  </tr>
                </thead>
                <tbody>
                  {margins.map((m, i) => (
                    <tr key={`${m.translatorId}-${m.sourceLang}-${m.targetLang}-${m.currency}-${i}`}>
                      <td>{m.translatorName ?? <span className="t-tertiary">{t('trad.none')}</span>}</td>
                      <td className="col-optional t-secondary">{m.sourceLang} → {m.targetLang}</td>
                      <td className="num">{m.orders}</td>
                      <td className="num col-optional">{m.pages}</td>
                      <td className="num col-optional">{formatMoney(m.sold, m.currency)}</td>
                      <td className="num col-optional">{formatMoney(m.cost, m.currency)}</td>
                      <td className="num t-medium" style={{ color: m.margin >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {formatMoney(m.margin, m.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Section>
          )}
        </>
      )}
    </>
  )
}
