import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { LOCALE_META, useI18n } from '@/i18n'
import { Avatar, Button, Empty, Field, Modal, Pill, Segmented, Select, Textarea, useToast } from '@/components/ui'
import { Kpi, KpiGrid, Ligne, PageHeader, Section, Table, Toolbar, Vide } from '@/components/page'
import { Ago } from '@/components/bits'
import { Icon } from '@/components/Icon'
import type { ClientRequest, RequestStatus } from '@/data/types'
import '@/styles/messagerie.css'

type View = 'traiter' | 'nouvelles' | 'qualifiees' | 'converties' | 'ecartees' | 'toutes'

const THIRTY_DAYS = 30 * 86_400_000

/* La boîte des demandes. C'est la porte d'entrée du métier : ce qui arrive de
   la page publique de l'agence, avant que quiconque décide d'en faire un
   dossier. Chaque ligne attend un geste : ouvrir un dossier, ou écarter. */
export function Inbox() {
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt, formatDate } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const [view, setView] = useState<View>('traiter')
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<ClientRequest | null>(null)
  const [converting, setConverting] = useState<ClientRequest | null>(null)
  const [refusing, setRefusing] = useState<ClientRequest | null>(null)
  const [reason, setReason] = useState('')
  const [assigneeId, setAssigneeId] = useState(v.user.id)

  const pending = (r: ClientRequest) => r.status === 'nouvelle' || r.status === 'qualifiee'

  /* Les chiffres de tête, calculés depuis le store : rien n'est estimé. */
  const kpis = useMemo(() => {
    const since = Date.now() - THIRTY_DAYS
    const recent = (iso?: string) => Boolean(iso) && new Date(iso as string).getTime() >= since
    const fresh = db.requests.filter((r) => r.status === 'nouvelle').length
    const qualified = db.requests.filter((r) => r.status === 'qualifiee').length
    const converted = db.requests.filter((r) => r.status === 'convertie' && recent(r.handledAt)).length
    // Le délai de traitement : de la réception à la décision, sur ce qui a
    // été décidé ces trente derniers jours. Sans décision datée, on ne dit rien.
    const handled = db.requests.filter((r) => (r.status === 'convertie' || r.status === 'ecartee') && recent(r.handledAt))
    const delays = handled.map((r) => new Date(r.handledAt as string).getTime() - new Date(r.receivedAt).getTime()).filter((ms) => ms >= 0)
    const avgMs = delays.length > 0 ? delays.reduce((a, b) => a + b, 0) / delays.length : null
    const spark = Array.from({ length: 8 }, (_, i) => {
      const from = since + (i * THIRTY_DAYS) / 8
      const to = since + ((i + 1) * THIRTY_DAYS) / 8
      return db.requests.filter((r) => { const at = new Date(r.receivedAt).getTime(); return at >= from && at < to }).length
    })
    return { fresh, qualified, converted, avgMs, spark }
  }, [db.requests])

  const delayText = kpis.avgMs === null
    ? t('mgr.notMeasurable')
    : kpis.avgMs < 48 * 3_600_000
      ? t('mgr.hours', { n: Math.max(1, Math.round(kpis.avgMs / 3_600_000)) })
      : t('mgr.days', { n: Math.round(kpis.avgMs / 86_400_000) })

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const q = norm(query.trim())

  const rows = useMemo(() => db.requests
    .filter((r) => {
      if (view === 'traiter') return pending(r)
      if (view === 'nouvelles') return r.status === 'nouvelle'
      if (view === 'qualifiees') return r.status === 'qualifiee'
      if (view === 'converties') return r.status === 'convertie'
      if (view === 'ecartees') return r.status === 'ecartee'
      return true
    })
    .filter((r) => q === '' || norm(`${r.firstName} ${r.lastName} ${r.reference} ${r.phone} ${r.email ?? ''} ${r.destination ?? ''} ${r.goods ?? ''}`).includes(q))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)), [db.requests, view, q])

  const tone: Record<RequestStatus, 'blue' | 'orange' | 'green' | 'gray'> = {
    nouvelle: 'blue', qualifiee: 'orange', convertie: 'green', ecartee: 'gray',
  }
  const label: Record<RequestStatus, string> = {
    nouvelle: t('inbox.new'), qualifiee: t('inbox.qualified'),
    convertie: t('inbox.converted'), ecartee: t('inbox.refused'),
  }

  const publicUrl = `${window.location.origin}${import.meta.env.BASE_URL}agence?agency=${db.agency.slug}`
  const copyLink = () => { navigator.clipboard?.writeText(publicUrl); toast(t('action.copied')) }

  const canDecide = v.can('case:create')
  const startConvert = (r: ClientRequest) => { setDetail(null); setConverting(r); setAssigneeId(v.user.id) }
  const startRefuse = (r: ClientRequest) => { setDetail(null); setRefusing(r); setReason('') }

  const summary = (r: ClientRequest) => r.kind === 'fret'
    ? [r.goods, r.originCity].filter(Boolean).join(' · ')
    : [tt(db.visaTypes.find((x) => x.id === r.visaTypeId)?.label), r.destination].filter(Boolean).join(' · ')

  const segCount = (n: number) => (n > 0 ? ` ${n}` : '')

  return (
    <>
      <PageHeader
        kicker={t('mgr.inboxKicker')}
        title={t('mgr.inboxTitle')}
        subtitle={t('mgr.inboxSubtitle')}
        actions={<Button icon="copy" onClick={copyLink}>{t('mgr.copyLink')}</Button>}
      />

      <KpiGrid>
        <Kpi label={t('mgr.kpiNew')} value={kpis.fresh} hint={t('mgr.kpiNewHint')} tone={kpis.fresh > 0 ? 'blue' : undefined} icon="bell" />
        <Kpi label={t('mgr.kpiQualified')} value={kpis.qualified} hint={t('mgr.kpiQualifiedHint')} tone={kpis.qualified > 0 ? 'orange' : undefined} icon="clock" />
        <Kpi label={t('mgr.kpiConverted')} value={kpis.converted} hint={t('mgr.kpiConvertedHint')} tone="green" icon="check" spark={kpis.spark} />
        <div className={kpis.avgMs === null ? 'mg-kpi--text' : undefined}>
          <Kpi label={t('mgr.kpiDelay')} value={delayText} hint={t('mgr.kpiDelayHint')} icon="today" />
        </div>
      </KpiGrid>

      <Section flush className="mg-inbox">
        <Toolbar
          right={
            <span className="t-small t-tertiary t-num" role="status" aria-live="polite">
              {rows.length === 1 ? t('mgr.request') : t('mgr.requestsCount', { n: rows.length })}
            </span>
          }
        >
          <Segmented
            label={t('action.filter')}
            value={view}
            onChange={setView}
            options={[
              { value: 'traiter', label: `${t('mgr.segToHandle')}${segCount(kpis.fresh + kpis.qualified)}` },
              { value: 'nouvelles', label: t('mgr.segNew') },
              { value: 'qualifiees', label: t('mgr.segQualified') },
              { value: 'converties', label: t('mgr.segConverted') },
              { value: 'ecartees', label: t('mgr.segRefused') },
              { value: 'toutes', label: t('misc.everything') },
            ]}
          />
          <label className="search mg-search mg-search--toolbar">
            <Icon name="search" size={15} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('mgr.searchRequests')} aria-label={t('action.search')} />
          </label>
        </Toolbar>

        {db.requests.length === 0 ? (
          <Empty
            title={t('inbox.none')}
            hint={t('inbox.noneHint')}
            scene="message"
            action={<Button icon="copy" onClick={copyLink}>{t('setup.share')}</Button>}
          />
        ) : rows.length === 0 ? (
          view === 'traiter' && q === '' ? (
            <Vide
              title={t('mgr.allHandled')}
              hint={t('mgr.allHandledHint')}
              icon="check"
              action={<Button size="sm" onClick={() => setView('toutes')}>{t('misc.everything')}</Button>}
            />
          ) : (
            <Vide
              title={t('mgr.noRequestMatch')}
              hint={t('mgr.noRequestMatchHint')}
              icon="search"
              action={<Button size="sm" onClick={() => { setQuery(''); setView('traiter') }}>{t('action.reset')}</Button>}
            />
          )
        ) : (
          <Table className="mg-table">
            <thead>
              <tr>
                <th>{t('mgr.colWho')}</th>
                <th>{t('mgr.colWhat')}</th>
                <th className="col-optional">{t('mgr.colReceived')}</th>
                <th>{t('mgr.colStatus')}</th>
                <th className="actions"><span className="sr-only">{t('mgr.colActions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`adm-row--click ${r.status === 'ecartee' ? 'adm-row--off' : ''}`}
                  onClick={() => setDetail(r)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setDetail(r) }}
                  tabIndex={0}
                >
                  <td>
                    <span className="mg-who">
                      <Avatar name={`${r.firstName} ${r.lastName}`} size="sm" />
                      <span className="adm-cell-main">
                        <span className="mg-who__name">
                          {r.firstName} {r.lastName}
                          {!r.phoneVerified && <Icon name="alert" size={13} className="mg-who__unverified" />}
                        </span>
                        <span className="t-caption"><span className="t-mono">{r.reference}</span> · <span dir="ltr">{r.phone}</span></span>
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className="adm-cell-main">
                      <span className="mg-what">
                        <Icon name={r.kind === 'fret' ? 'ship' : 'passport'} size={14} className="t-tertiary" />
                        {r.kind === 'fret' ? t('mgr.freight') : t('mgr.visa')}
                        {r.travelDate && <span className="t-caption t-tertiary"> · {formatDate(r.travelDate)}</span>}
                      </span>
                      <span className="t-caption t-truncate mg-what__sub">{summary(r) || (r.note ?? '')}</span>
                    </span>
                  </td>
                  <td className="col-optional t-tertiary mg-when"><Ago iso={r.receivedAt} /></td>
                  <td>
                    <span className="mg-status">
                      <Pill tone={tone[r.status]} dot>{label[r.status]}</Pill>
                      {pending(r) && (r.phoneVerified
                        ? <Pill tone="green">{t('inbox.verified')}</Pill>
                        : <Pill tone="orange">{t('inbox.unverified')}</Pill>)}
                    </span>
                  </td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    <span className="mg-actions">
                      {r.caseId ? (
                        <Button size="sm" icon="cases" onClick={() => navigate(`/dossiers/${r.caseId}`)}>{t('action.open')}</Button>
                      ) : (
                        <Button size="sm" onClick={() => setDetail(r)}>{t('mgr.details')}</Button>
                      )}
                      {pending(r) && canDecide && (
                        <>
                          {r.kind === 'visa' && (
                            <Button size="sm" variant="primary" onClick={() => startConvert(r)}>{t('inbox.convert')}</Button>
                          )}
                          <Button size="sm" onClick={() => startRefuse(r)}>{t('inbox.refuse')}</Button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      {detail && (
        <Modal
          title={t('mgr.detailTitle', { ref: detail.reference })}
          onClose={() => setDetail(null)}
          footer={
            <>
              {detail.caseId && (
                <Link to={`/dossiers/${detail.caseId}`} className="btn btn--secondary"><Icon name="cases" size={15} /> {t('mgr.linkedCase')}</Link>
              )}
              {pending(detail) && canDecide && (
                <>
                  <Button onClick={() => startRefuse(detail)}>{t('inbox.refuse')}</Button>
                  {detail.kind === 'visa' && (
                    <Button variant="primary" onClick={() => startConvert(detail)}>{t('inbox.convert')}</Button>
                  )}
                </>
              )}
              {!pending(detail) && !detail.caseId && <Button onClick={() => setDetail(null)}>{t('action.close')}</Button>}
            </>
          }
        >
          <div className="mg-detail">
            <div className="mg-detail__head">
              <Avatar name={`${detail.firstName} ${detail.lastName}`} size="lg" />
              <div className="col gap-1" style={{ minWidth: 0 }}>
                <span className="t-medium">{detail.firstName} {detail.lastName}</span>
                <span className="row gap-2 wrap">
                  <Pill tone={tone[detail.status]} dot>{label[detail.status]}</Pill>
                  {detail.phoneVerified
                    ? <Pill tone="green">{t('inbox.verified')}</Pill>
                    : <Pill tone="orange">{t('inbox.unverified')}</Pill>}
                  <Pill tone="gray">{detail.kind === 'fret' ? t('mgr.freight') : t('mgr.visa')}</Pill>
                </span>
              </div>
            </div>

            <div className="mg-detail__lines">
              <Ligne label={t('mgr.phone')}><a href={`tel:${detail.phone}`} dir="ltr">{detail.phone}</a></Ligne>
              {detail.email && <Ligne label={t('mgr.emailField')}><a href={`mailto:${detail.email}`}>{detail.email}</a></Ligne>}
              <Ligne label={t('mgr.language')}>{LOCALE_META[detail.locale].native}</Ligne>
              {detail.kind === 'visa' ? (
                <>
                  {detail.visaTypeId && <Ligne label={t('mgr.visaType')}>{tt(db.visaTypes.find((x) => x.id === detail.visaTypeId)?.label)}</Ligne>}
                  {detail.destination && <Ligne label={t('mgr.destination')}>{detail.destination}</Ligne>}
                  {detail.travelDate && <Ligne label={t('mgr.travelDate')}>{formatDate(detail.travelDate)}</Ligne>}
                </>
              ) : (
                <>
                  {detail.goods && <Ligne label={t('mgr.goods')}>{detail.goods}</Ligne>}
                  {detail.originCity && <Ligne label={t('mgr.origin')}>{detail.originCity}</Ligne>}
                </>
              )}
              <Ligne label={t('mgr.receivedOn')}>{formatDate(detail.receivedAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</Ligne>
              {detail.handledAt && (
                <Ligne label={t('mgr.handledOn')}>{formatDate(detail.handledAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</Ligne>
              )}
              {detail.handledBy && (
                <Ligne label={t('mgr.handledBy')}>{db.users.find((u) => u.id === detail.handledBy)?.name ?? detail.handledBy}</Ligne>
              )}
              {detail.refusalReason && <Ligne label={t('mgr.refusalReason')}>{detail.refusalReason}</Ligne>}
            </div>

            {detail.note && (
              <blockquote className="mg-detail__note" dir={detail.locale === 'ar' ? 'rtl' : 'ltr'} lang={detail.locale}>
                <span className="t-caption t-tertiary">{t('mgr.note')}</span>
                <p>{detail.note}</p>
              </blockquote>
            )}

            {pending(detail) && detail.kind === 'fret' && (
              <p className="t-caption t-tertiary">{t('mgr.freightOnly')}</p>
            )}
          </div>
        </Modal>
      )}

      {converting && (
        <Modal
          title={t('inbox.convert')}
          onClose={() => setConverting(null)}
          footer={
            <>
              <Button onClick={() => setConverting(null)}>{t('action.cancel')}</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const caseId = actions.convertRequest(converting.id, assigneeId)
                  setConverting(null)
                  toast(t('crud.created'))
                  if (caseId) navigate(`/dossiers/${caseId}`)
                }}
              >
                {t('action.confirm')}
              </Button>
            </>
          }
        >
          <div className="col gap-4">
            <p className="t-small t-secondary">
              {converting.firstName} {converting.lastName} · <span dir="ltr">{converting.phone}</span>
              {' · '}
              {tt(db.visaTypes.find((x) => x.id === converting.visaTypeId)?.label)}
            </p>
            <Field label={t('cases.assignee')} hint={t('mgr.convertHint')}>
              <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                {db.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
          </div>
        </Modal>
      )}

      {refusing && (
        <Modal
          title={t('inbox.refuse')}
          onClose={() => setRefusing(null)}
          footer={
            <>
              <Button onClick={() => setRefusing(null)}>{t('action.cancel')}</Button>
              <Button variant="danger" onClick={() => { actions.refuseRequest(refusing.id, reason); setRefusing(null); toast(t('crud.updated')) }}>
                {t('inbox.refuse')}
              </Button>
            </>
          }
        >
          <div className="col gap-4">
            <p className="t-small t-secondary">{refusing.firstName} {refusing.lastName} · <span className="t-mono">{refusing.reference}</span></p>
            <Field label={t('inbox.refuseReason')} hint={t('mgr.refuseHint')}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}
