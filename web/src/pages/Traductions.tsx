import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Card, Empty, Field, Input, Pill, Segmented, Select, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { PageHead } from '@/components/bits'
import {
  handOverTranslation, loadLate, loadMarginReport, loadOrders, loadTranslators,
} from '@/data/traduction'
import type {
  LateTranslation, MarginRow, TranslationOrder, TranslationStatus, Translator,
} from '@/data/traduction'
import type { Tone } from '@/lib/derive'

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

export function Traductions() {
  const v = useVisible()
  const { t, formatDate, formatMoney } = useI18n()
  const toast = useToast()

  const [view, setView] = useState<View>('ouvertes')
  const [translatorId, setTranslatorId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [orders, setOrders] = useState<TranslationOrder[]>([])
  const [late, setLate] = useState<LateTranslation[]>([])
  const [translators, setTranslators] = useState<Translator[]>([])
  const [margins, setMargins] = useState<MarginRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const canFinance = v.can('finance:global')
  const canWrite = v.can('case:write')

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try {
      const [o, l, tr] = await Promise.all([
        loadOrders({
          status: view === 'toutes' ? 'toutes' : view,
          translatorId: translatorId || null,
          from: from || null,
          to: to || null,
        }),
        loadLate(v.officeId),
        loadTranslators(),
      ])
      setOrders(o)
      setLate(l)
      setTranslators(tr)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [view, translatorId, from, to, v.officeId])

  useEffect(() => { void reload() }, [reload])

  // Le rapport de marge est une porte à part : le serveur la refuse à qui n'a
  // pas finance:global, on ne la pousse donc pas.
  useEffect(() => {
    if (!HAS_BACKEND || !canFinance) { setMargins([]); return }
    loadMarginReport(v.officeId, from || null, to || null)
      .then(setMargins)
      .catch((e: Error) => setError(e.message))
  }, [canFinance, v.officeId, from, to])

  const lateById = useMemo(() => {
    const map = new Map<string, number>()
    late.forEach((l) => map.set(l.orderId, l.daysLate))
    return map
  }, [late])

  // Les retards d'abord, puis les plus récentes. Un écran de suivi qui range
  // par date de création enterre exactement ce qu'on vient y chercher.
  const rows = useMemo(() => [...orders].sort((a, b) => {
    const la = lateById.get(a.id) ?? -1
    const lb = lateById.get(b.id) ?? -1
    if (la !== lb) return lb - la
    return (b.orderedAt ?? b.createdAt).localeCompare(a.orderedAt ?? a.createdAt)
  }), [orders, lateById])

  const totalMargin = useMemo(
    () => margins.reduce((sum, m) => sum + m.margin, 0),
    [margins],
  )
  const marginCurrency = margins[0]?.currency ?? 'TND'
  // Additionner deux devises donnerait un total qui ne veut rien dire.
  const mixedCurrencies = new Set(margins.map((m) => m.currency)).size > 1

  const translatorName = (id: string | null) =>
    translators.find((x) => x.id === id)?.name ?? t('trad.none')

  const hand = async (orderId: string) => {
    try { await handOverTranslation(orderId); toast(t('trad.handedOver')); await reload() }
    catch (e) { toast((e as Error).message) }
  }

  if (!HAS_BACKEND) {
    return (
      <>
        <PageHead title={t('trad.title')} subtitle={t('trad.subtitle')} />
        <Card>
          <Empty title={t('trad.offline')} hint={t('trad.offlineHint')} scene="alerte" />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHead title={t('trad.title')} subtitle={t('trad.subtitle')} />

      <Card>
        <p className="tariff__why">
          <Icon name="shield" size={14} />
          <span>{t('trad.notebook')}</span>
        </p>
      </Card>

      {error && <Card><p className="t-small t-orange">{t('trad.loadError', { msg: error })}</p></Card>}

      {late.length > 0 && (
        <Card title={t('trad.lateFirst')} flush>
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('trad.orderNumber')}</th>
                  <th>{t('trad.translator')}</th>
                  <th>{t('trad.promised')}</th>
                  <th className="num">{t('trad.late')}</th>
                </tr>
              </thead>
              <tbody>
                {late.map((l) => (
                  <tr key={l.orderId}>
                    <td className="t-num">
                      {l.caseId
                        ? <Link to={`/dossiers/${l.caseId}`}>{l.orderNumber}</Link>
                        : l.orderNumber}
                    </td>
                    <td className="t-small">{l.translatorName ?? t('trad.none')}</td>
                    <td className="t-small">{formatDate(l.promisedAt)}</td>
                    <td className="num">
                      <Pill tone="red" dot>{t('trad.lateBy', { n: l.daysLate })}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card flush>
        <div className="row" style={{ padding: 'var(--sp-4) var(--sp-6)', gap: 'var(--sp-4)', flexWrap: 'wrap', borderBottom: '1px solid var(--hairline)' }}>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'ouvertes', label: t('trad.open') },
              { value: 'livree', label: t('trad.done') },
              { value: 'toutes', label: t('trad.all') },
            ]}
          />
          <Field label={t('trad.filterTranslator')}>
            <Select value={translatorId} onChange={(e) => setTranslatorId(e.target.value)}>
              <option value="">{t('trad.anyTranslator')}</option>
              {translators.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label={t('trad.from')}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('trad.to')}>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <span className="grow" />
          <span className="t-small t-tertiary t-num">{t('trad.results', { n: rows.length })}</span>
        </div>

        {rows.length === 0 ? (
          <Empty title={t('trad.noPieces')} hint={t('trad.noPiecesHint')} scene="vide" />
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('trad.orderNumber')}</th>
                  <th>{t('trad.translator')}</th>
                  <th>{t('trad.langPair')}</th>
                  <th className="num">{t('trad.pages')}</th>
                  <th>{t('trad.status')}</th>
                  <th>{t('trad.promised')}</th>
                  <th className="num">{t('trad.soldAmount')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const days = lateById.get(o.id)
                  return (
                    <tr key={o.id}>
                      <td className="t-num">
                        {o.caseId
                          ? <Link to={`/dossiers/${o.caseId}`}>{o.orderNumber}</Link>
                          : o.orderNumber}
                      </td>
                      <td className="t-small">{translatorName(o.translatorId)}</td>
                      <td className="t-small">
                        {o.sourceLang ? `${o.sourceLang} → ${o.targetLang ?? ''}` : ''}
                        {o.swornRequired && <span className="t-caption t-tertiary"> · {t('trad.sworn')}</span>}
                      </td>
                      <td className="num t-num">{o.pages ?? ''}</td>
                      <td>
                        <Pill tone={days !== undefined ? 'red' : STATUS_TONE[o.status]} dot>
                          {t(STATUS_KEY[o.status] as 'trad.statusCommandee')}
                        </Pill>
                      </td>
                      <td className="t-small">
                        {o.promisedAt ? formatDate(o.promisedAt) : <span className="t-tertiary">{t('trad.none')}</span>}
                        {days !== undefined && (
                          <span className="t-caption" style={{ color: 'var(--red)' }}> · {t('trad.lateBy', { n: days })}</span>
                        )}
                      </td>
                      <td className="num t-num">
                        {o.soldAmount !== null ? formatMoney(o.soldAmount, o.currency) : ''}
                      </td>
                      <td className="num">
                        {canWrite && o.status === 'livree' && (
                          <Button size="sm" variant="primary" onClick={() => void hand(o.id)}>
                            {t('trad.handOver')}
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

      {canFinance && margins.length > 0 && (
        <Card
          title={t('trad.totalMargin')}
          action={!mixedCurrencies
            ? <span className="t-medium t-num">{formatMoney(totalMargin, marginCurrency)}</span>
            : undefined}
          flush
        >
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('trad.translator')}</th>
                  <th>{t('trad.langPair')}</th>
                  <th className="num">{t('trad.count')}</th>
                  <th className="num">{t('trad.pages')}</th>
                  <th className="num">{t('trad.soldAmount')}</th>
                  <th className="num">{t('trad.costAmount')}</th>
                  <th className="num">{t('trad.margin')}</th>
                </tr>
              </thead>
              <tbody>
                {margins.map((m, i) => (
                  <tr key={`${m.translatorId}-${m.sourceLang}-${m.targetLang}-${m.currency}-${i}`}>
                    <td className="t-small">{m.translatorName ?? t('trad.none')}</td>
                    <td className="t-small">{m.sourceLang} → {m.targetLang}</td>
                    <td className="num t-num">{m.orders}</td>
                    <td className="num t-num">{m.pages}</td>
                    <td className="num t-num">{formatMoney(m.sold, m.currency)}</td>
                    <td className="num t-num">{formatMoney(m.cost, m.currency)}</td>
                    <td className="num t-num" style={{ color: m.margin >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {formatMoney(m.margin, m.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}
