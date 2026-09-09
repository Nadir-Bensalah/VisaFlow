import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { HAS_BACKEND } from '@/lib/supabase'
import { loadCaseTranslations } from '@/data/traduction'
import { AuditTrail } from '@/components/AuditTrail'
import { PrintButton } from '@/components/PrintButton'
import { HistoryCard } from '@/components/HistoryCard'
import { CaseJourney } from '@/components/CaseJourney'
import { TranslationCard } from '@/components/TranslationCard'
import { TravelPanel } from '@/components/TravelPanel'
import { CaseMarginCard } from '@/components/CaseMarginCard'
import { CustomFields } from '@/components/CustomFields'
import { TrackingLinks } from '@/components/TrackingLinks'
import { useI18n } from '@/i18n'
import { Avatar, Button, Card, Empty, Field, Input, Modal, Pill, Progress, Select, Tabs, Textarea, useToast } from '@/components/ui'
import { Ligne, PageHeader, Vide } from '@/components/page'
import { Icon } from '@/components/Icon'
import { Ago, Countdown, DocPill, StagePill, StatusPill } from '@/components/bits'
import { CaseEditor } from '@/components/CaseEditor'
import { FileDrop } from '@/components/FileDrop'
import { STAGES, biometricsValid, biometricsValidUntil, blockingDocs, caseBalance, daysSince, progress, queueRank, refusalRisk, waWindowLeft, waWindowOpen } from '@/lib/derive'
import type { AppointmentKind, CaseDocument, Channel, DocState, PaymentMethod, RefusalCode, VisaCase } from '@/data/types'
import '@/styles/fiche-dossier.css'

/**
 * LA FICHE D'UN DOSSIER DE VISA.
 *
 * Deux colonnes tenues. À gauche, la colonne principale à onglets : l'aperçu
 * (le parcours, puis le visa, le créneau, le passeport), les pièces, les
 * messages, les rendez-vous, les paiements, les prestations (traductions,
 * voyage, marge), le suivi (liens, champs de l'agence) et l'historique. À
 * droite, un rail qui reste sous les yeux et ne porte que ce qu'on regarde à
 * chaque instant : l'étape et le geste à faire, le client, les notes.
 *
 * Avant ce découpage, la colonne de droite empilait quatorze cartes et la
 * fiche faisait 5 600 px de haut. Rien n'a disparu : chaque module a changé
 * d'onglet, et l'onglet vit dans l'adresse (`?onglet=`) pour que le lien se
 * partage et que le retour marche.
 */

type Tab = 'apercu' | 'pieces' | 'messages' | 'rdv' | 'paiements' | 'prestations' | 'suivi' | 'historique'
const TABS: Tab[] = ['apercu', 'pieces', 'messages', 'rdv', 'paiements', 'prestations', 'suivi', 'historique']

export function CaseDetail() {
  const { id = '' } = useParams()
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt, formatDate, formatMoney } = useI18n()
  const toast = useToast()
  // L'onglet vit dans l'adresse : le lien se partage et le retour marche.
  // Un onglet inconnu dans l'adresse retombe sur l'aperçu, sans erreur.
  const [params, setParams] = useSearchParams()
  const brut = params.get('onglet')
  const tab: Tab = TABS.includes(brut as Tab) ? (brut as Tab) : 'apercu'
  const setTab = (value: Tab) => setParams(value === 'apercu' ? {} : { onglet: value }, { replace: true })
  const [deciding, setDeciding] = useState(false)
  const [editing, setEditing] = useState(false)

  // Le compteur de l'onglet Prestations : le nombre de traductions du dossier,
  // que seul le serveur connaît. Sans serveur, ou sans traduction, pas de chiffre.
  const [tradCount, setTradCount] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (!HAS_BACKEND) return
    let vivant = true
    loadCaseTranslations(id)
      .then((s) => { if (vivant && s && s.total > 0) setTradCount(s.total) })
      .catch(() => { /* module absent : l'onglet reste sans compteur */ })
    return () => { vivant = false }
  }, [id])

  // Hors perimetre, le dossier n'existe pas. On ne confirme meme pas sa reference.
  const kase = v.cases.find((c) => c.id === id)
  if (!kase) return <Empty title={t('cases.none')} action={<Link to="/dossiers" className="btn btn--secondary">{t('action.back')}</Link>} />

  const client = db.clients.find((c) => c.id === kase.clientId)!
  const visa = db.visaTypes.find((v) => v.id === kase.visaTypeId)!
  const agent = db.users.find((u) => u.id === kase.assigneeId)
  const office = db.agency.offices.find((o) => o.id === kase.officeId)
  const docs = db.documents.filter((d) => d.caseId === kase.id)
  const messages = db.messages.filter((m) => m.caseId === kase.id)
  const appts = db.appointments.filter((a) => a.caseId === kase.id)
  const payments = db.payments.filter((p) => p.caseId === kase.id)
  const events = db.events.filter((e) => e.caseId === kase.id)
  const p = progress(db, kase.id)
  const blocking = blockingDocs(db, kase.id)
  const notes = kase.notes ?? []
  const canWrite = v.can('case:write')
  const canDecide = kase.status === 'ouvert' && ['decision', 'consulat', 'depot'].includes(kase.stage)
  const canAdvance = kase.status === 'ouvert' && kase.stage !== 'clos' && canWrite

  // Le lien porte l'agence et la langue du client : sans elles, il ouvre la
  // mauvaise agence et s'affiche dans la mauvaise langue.
  const portalUrl = `${window.location.origin}${import.meta.env.BASE_URL}portail/${kase.portalToken}?agency=${db.agency.slug}&lang=${client.locale}`

  const copyPortal = async () => {
    try {
      await navigator.clipboard.writeText(portalUrl)
      toast(t('action.copied'))
    } catch {
      toast(portalUrl)
    }
  }

  const advance = () => { actions.advance(kase.id); toast(t('caseDetail.advance')) }
  const requestDocs = () => { const n = actions.requestMissingDocs(kase.id); toast(n ? t('msg.sent') : t('docs.none')) }

  // Un compteur ne s'affiche que s'il a quelque chose à compter : « Rendez-vous 0 »
  // est un reproche, pas une information.
  const nb = (n: number) => (n > 0 ? n : undefined)
  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'apercu', label: t('caseDetail.overview') },
    { value: 'pieces', label: t('caseDetail.documents'), count: nb(docs.length) },
    { value: 'messages', label: t('caseDetail.messages'), count: nb(messages.length) },
    { value: 'rdv', label: t('caseDetail.appointments'), count: nb(appts.length) },
    { value: 'paiements', label: t('caseDetail.payments'), count: nb(payments.length) },
    { value: 'prestations', label: t('fiche.tabServices'), count: tradCount },
    { value: 'suivi', label: t('fiche.tabTracking') },
    { value: 'historique', label: t('caseDetail.history') },
  ]

  const stageLabel = kase.status === 'ouvert' ? t(`stage.${kase.stage}` as 'stage.nouveau') : t(`status.${kase.status}` as 'status.ouvert')
  const phone = client.phone.replace(/[^0-9]/g, '')

  return (
    <>
      <Link to="/dossiers" className="fd-crumb">
        <Icon name="chevron" size={14} />
        {t('cases.title')}
      </Link>

      <PageHeader
        kicker={`${kase.reference} · ${tt(visa.label)}`}
        title={`${client.firstName} ${client.lastName}`}
        subtitle={
          <>
            {tt(visa.country)} · {stageLabel}
            {kase.travelDate && <> · {t('fiche.departure')} <Countdown iso={kase.travelDate} /></>}
          </>
        }
        actions={
          <>
            <PrintButton kind="fiche_dossier" entityId={kase.id} />
            {canWrite && <Button icon="edit" onClick={() => setEditing(true)}>{t('crud.edit')}</Button>}
            <Button icon="copy" onClick={copyPortal}>{t('caseDetail.portalLink')}</Button>
            {canDecide && <Button icon="check" onClick={() => setDeciding(true)}>{t('fiche.decide')}</Button>}
            {canAdvance && <Button variant="primary" icon="arrow" onClick={advance}>{t('caseDetail.advance')}</Button>}
          </>
        }
      />

      {deciding && <Decision caseId={kase.id} onClose={() => setDeciding(false)} />}
      {editing && <CaseEditor kase={kase} onClose={() => setEditing(false)} />}

      <div className="pg-fiche">
        <div className="fd-main">
          <Card flush>
            <Tabs value={tab} options={tabs} onChange={setTab} idPrefix="fd" />
            {tab === 'apercu' && <div className="fd-panel"><Overview kase={kase} /></div>}
            {tab === 'pieces' && <div className="fd-panel"><DocsTab caseId={kase.id} /></div>}
            {tab === 'messages' && <div className="fd-panel"><MessagesTab caseId={kase.id} /></div>}
            {tab === 'rdv' && <div className="fd-panel"><ApptsTab caseId={kase.id} /></div>}
            {tab === 'paiements' && <div className="fd-panel"><PaymentsTab caseId={kase.id} /></div>}
            {tab === 'prestations' && (
              <div className="fd-modules">
                <TranslationCard caseId={kase.id} />
                <TravelPanel caseId={kase.id} clientId={kase.clientId} officeId={kase.officeId} />
                <CaseMarginCard caseId={kase.id} />
              </div>
            )}
            {tab === 'suivi' && (
              <div className="fd-modules">
                <TrackingLinks kind="VISA_CASE" entityId={kase.id} />
                <CustomFields entityKind="VISA_CASE" entityId={kase.id} />
              </div>
            )}
            {tab === 'historique' && (
              <div className="fd-modules">
                <Card title={t('fiche.feed')}>
                  {events.length === 0 ? <Vide icon="clock" title={t('fiche.noEvents')} /> : (
                    <ul className="timeline">
                      {events.map((e) => (
                        <li key={e.id} className="timeline__item">
                          <span className={`timeline__dot ${e.automated ? '' : 'timeline__dot--done'}`} />
                          <div className="col gap-1">
                            <span className="t-small">{tt(e.detail)}</span>
                            <span className="t-caption t-tertiary">
                              <Ago iso={e.at} />
                              {e.actorId && ` · ${db.users.find((u) => u.id === e.actorId)?.name ?? ''}`}
                              {e.automated && ` · ${t('msg.automated')}`}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <HistoryCard entityKind="VISA_CASE" entityId={kase.id} />
                <AuditTrail entityType="cases" entityId={kase.id} />
              </div>
            )}
          </Card>
        </div>

        <aside className="pg-fiche__rail">
          {/* L'aperçu et la prochaine action ne font qu'une carte : l'étape,
              l'avancement, les faits du dossier, puis le geste à faire. */}
          <Card title={t('caseDetail.overview')}>
            <div className="fd-rail__stage">
              <span className="t-small t-secondary">{t('cases.stage')}</span>
              {kase.status === 'ouvert' ? <StagePill stage={kase.stage} /> : <StatusPill status={kase.status} />}
            </div>
            <div className="fd-rail__progress">
              <div className="fd-rail__progress-row">
                <span className="t-secondary">{t('cases.progress')}</span>
                <span className="t-num">{t('caseDetail.completion', { done: p.done, total: p.total })}</span>
              </div>
              <Progress pct={p.pct} label={t('cases.progress')} tone={p.pct === 100 ? 'green' : p.pct < 40 ? 'orange' : undefined} />
            </div>
            <Ligne label={t('caseDetail.assignedTo')}>{agent?.name ?? '·'}</Ligne>
            <Ligne label={t('caseDetail.office')}>{office?.name ?? '·'}</Ligne>
            <Ligne label={t('caseDetail.openedOn')}>{formatDate(kase.openedAt)}</Ligne>
            <Ligne label={t('caseDetail.travelOn')}><Countdown iso={kase.travelDate} /></Ligne>
            <Ligne label={t('caseDetail.source')}>{t(`source.${kase.source}` as 'source.comptoir')}</Ligne>
            {kase.consulateRef && <Ligne label={t('caseDetail.consulateRef')} mono>{kase.consulateRef}</Ligne>}
            {v.can('payment:write') && (
              <Ligne label={t('cases.balance')}>{caseBalance(kase) > 0 ? formatMoney(caseBalance(kase)) : t('payment.regle')}</Ligne>
            )}
            <NextAction
              kase={kase}
              blocking={blocking}
              canWrite={canWrite}
              canDecide={canDecide}
              canAdvance={canAdvance}
              onRequestDocs={requestDocs}
              onDecide={() => setDeciding(true)}
              onAdvance={advance}
            />
          </Card>

          <Card title={t('cases.client')} action={<Link to={`/clients/${client.id}`} className="t-small">{t('action.open')}</Link>}>
            <div className="fd-client">
              <Avatar name={`${client.firstName} ${client.lastName}`} size="lg" />
              <div className="fd-client__id">
                <span className="fd-client__name">{client.firstName} {client.lastName}</span>
                {client.nativeName && <span className="t-small t-tertiary">{client.nativeName}</span>}
                <span className="t-caption t-tertiary">{client.nationality}</span>
              </div>
            </div>
            <Ligne label={t('clients.contact')} mono>{client.phone}</Ligne>
            <Ligne label={t('clients.passport')} mono>{client.passportNumber ?? '·'}</Ligne>
            <Ligne label={t('clients.expiry')}>{formatDate(client.passportExpiry)}</Ligne>
            <Ligne label={t('misc.language')}>{client.locale.toUpperCase()}</Ligne>
            <div className="fd-client__actions">
              <a className="btn btn--secondary btn--sm" href={`https://wa.me/${(client.whatsapp ?? client.phone).replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">
                <Icon name="whatsapp" size={16} /> WhatsApp
              </a>
              <a className="btn btn--secondary btn--sm" href={`tel:${phone}`}>
                <Icon name="phone" size={16} /> {t('action.call')}
              </a>
            </div>
          </Card>

          {/* Les notes se replient : on les ouvre pour écrire, elles ne
              poussent pas le reste du rail hors de l'écran. */}
          <details className="fd-notes">
            <summary className="fd-notes__sum">
              <span>{t('caseDetail.notes')}{notes.length > 0 && <Pill tone="gray">{notes.length}</Pill>}</span>
              <Icon name="chevron" size={16} />
            </summary>
            <div className="fd-notes__body">
              <NoteBox caseId={kase.id} />
            </div>
          </details>
        </aside>
      </div>
    </>
  )
}

/* -------------------------- Prochaine action -------------------------- */

/* Le geste à faire, un seul, en bouton primaire. Dans l'ordre : les pièces qui
   bloquent, la décision à noter, l'étape à passer. Un dossier fermé n'a rien
   à faire, et le dit. */
function NextAction({ kase, blocking, canWrite, canDecide, canAdvance, onRequestDocs, onDecide, onAdvance }: {
  kase: VisaCase
  blocking: CaseDocument[]
  canWrite: boolean
  canDecide: boolean
  canAdvance: boolean
  onRequestDocs: () => void
  onDecide: () => void
  onAdvance: () => void
}) {
  const { db } = useStore()
  const { t, tt } = useI18n()
  if (kase.status !== 'ouvert') return null

  let corps: ReactNode
  if (blocking.length > 0) {
    corps = (
      <>
        <span className="t-small t-secondary">
          {blocking.length === 1 ? t('fiche.blockingOne') : t('fiche.blockingMany', { n: blocking.length })}
        </span>
        <ul className="fd-next__docs">
          {blocking.slice(0, 3).map((d) => (
            <li key={d.id} className="fd-next__doc">
              <span>{tt(d.label)}</span>
              <DocPill state={d.state} />
            </li>
          ))}
          {blocking.length > 3 && <li className="t-caption t-tertiary">{t('fiche.moreDocs', { n: blocking.length - 3 })}</li>}
        </ul>
        {canWrite && <Button variant="primary" block icon="messages" onClick={onRequestDocs}>{t('docs.requestAll')}</Button>}
      </>
    )
  } else if (canDecide) {
    corps = (
      <>
        <span className="t-small t-secondary">{t('fiche.decideHint')}</span>
        <Button variant="primary" block icon="check" onClick={onDecide}>{t('fiche.decide')}</Button>
      </>
    )
  } else if (canAdvance) {
    const stages = db.visaTypes.find((x) => x.id === kase.visaTypeId)?.stages ?? STAGES
    const suivante = stages[stages.indexOf(kase.stage) + 1]
    corps = (
      <>
        {suivante && <span className="t-small t-secondary">{t('fiche.nextStage', { stage: t(`stage.${suivante}` as 'stage.nouveau') })}</span>}
        <Button variant="primary" block icon="arrow" onClick={onAdvance}>{t('caseDetail.advance')}</Button>
      </>
    )
  } else {
    corps = <span className="t-small t-tertiary">{t('fiche.nothingToDo')}</span>
  }

  return (
    <div className="fd-next">
      <span className="fd-next__title">{t('caseDetail.nextStep')}</span>
      {corps}
    </div>
  )
}

/* ------------------------------ Apercu ------------------------------- */

function Overview({ kase }: { kase: VisaCase }) {
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt, formatDate, formatMoney } = useI18n()
  const toast = useToast()
  const visa = db.visaTypes.find((v) => v.id === kase.visaTypeId)!
  const stages = visa?.stages ?? STAGES
  const consulate = db.consulates.find((c) => c.id === kase.consulateId)
  const client = db.clients.find((c) => c.id === kase.clientId)
  // Le rang dans la file, c'est ce que le client verra dans son portail.
  const place = queueRank(db, kase.id)
  const bioUntil = biometricsValidUntil(client?.biometricsAt)
  const bioOk = biometricsValid(client?.biometricsAt)
  const [receiving, setReceiving] = useState(false)
  const [passportNo, setPassportNo] = useState(client?.passportNumber ?? '')
  const currentIndex = stages.indexOf(kase.stage)

  return (
    <>
    <div className="col gap-6">
      <CaseJourney kase={kase} />

      {/* Les étapes du métier, en une ligne : c'est le fil du pipeline, pas
          le récit du parcours. Neuf mots suffisent. */}
      <ol className="fd-etapes" aria-label={t('fiche.stages')}>
        {stages.map((s, i) => (
          <li
            key={s}
            className={`fd-etape ${i < currentIndex ? 'fd-etape--fait' : i === currentIndex ? 'fd-etape--encours' : ''}`}
            aria-current={i === currentIndex ? 'step' : undefined}
            title={i === currentIndex ? t('caseDetail.daysOpen', { n: daysSince(kase.openedAt) }) : undefined}
          >
            <span className="fd-etape__dot" />
            {t(`stage.${s}` as 'stage.nouveau')}
          </li>
        ))}
      </ol>

      <div className="fd-facts">
        <div className="fd-fact">
          <span className="fd-fact__label">{t('cases.visa')}</span>
          <span className="fd-fact__value">{tt(visa.country)} · {tt(visa.label)}</span>
          <span className="fd-fact__hint">{visa.processingDays > 0 ? t('reports.days', { n: visa.processingDays }) : t('ls.toSet')}</span>
        </div>
        <div className="fd-fact">
          <span className="fd-fact__label">{t('caseDetail.dueOn')}</span>
          <span className="fd-fact__value">{formatDate(kase.dueAt)}</span>
          <span className="fd-fact__hint">{t('caseDetail.daysOpen', { n: daysSince(kase.openedAt) })}</span>
        </div>
        {kase.status === 'ouvert' && consulate && (
          <div className="fd-fact">
            <span className="fd-fact__label">{t('slots.consulate')}</span>
            <span className="fd-fact__value">{tt(consulate.country)} · {consulate.city}</span>
            <span className="fd-fact__hint">{t(`centre.${consulate.centre}` as 'centre.tls_tunis')}</span>
          </div>
        )}
        {/* Le créneau : le rang dans la file, et la biométrie qui dispense ou
            non du déplacement. C'est ce qui manque partout ailleurs. */}
        {kase.status === 'ouvert' && (consulate || place.rank > 0) && (
          <div className="fd-fact">
            <span className="fd-fact__label">{t('slots.inQueue')}</span>
            {place.rank > 0 ? (
              <>
                <span className="fd-fact__value">{t('slots.rank', { rank: place.rank, total: place.total })}</span>
                <span className="fd-fact__hint">{t('slots.since', { n: daysSince(place.entry!.joinedAt) })}</span>
              </>
            ) : (
              <>
                <span className="fd-fact__value t-tertiary">{t('fiche.notQueued')}</span>
                {consulate && (
                  <button
                    type="button"
                    className="linkish t-small"
                    style={{ alignSelf: 'start' }}
                    onClick={() => { actions.joinQueue({ caseId: kase.id, consulateId: consulate.id }); toast(t('slots.joined')) }}
                  >
                    {t('slots.join')}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {kase.status === 'ouvert' && client?.biometricsAt && (
          <div className={`fd-fact ${bioOk ? 'fd-fact--ok' : 'fd-fact--ko'}`}>
            <span className="fd-fact__label">{t('bio.label')}</span>
            <span className="fd-fact__value">{bioOk ? t('bio.valid', { date: formatDate(bioUntil) }) : t('bio.expired')}</span>
            <span className="fd-fact__hint">{t('bio.hint')}</span>
          </div>
        )}
        {kase.status === 'ouvert' && kase.track && (
          <div className="fd-fact">
            <span className="fd-fact__label">{t('track.label')}</span>
            <span className="fd-fact__value">{t(`track.${kase.track}` as 'track.primo')}</span>
          </div>
        )}
      </div>

      {/* Le risque de refus, estimé sur les dossiers déjà décidés de l'agence,
          au même consulat et si possible pour le même statut professionnel.
          Aucun modèle importé : le chiffre porte sa propre taille d'échantillon,
          et sous le seuil on ne prétend rien. */}
      {kase.status === 'ouvert' && (() => {
        const risk = refusalRisk(db, kase)
        if (risk.basis === 'insuffisant') return null
        const tone = risk.band === 'eleve' ? 'red' : risk.band === 'modere' ? 'orange' : 'green'
        return (
          <div className="riskband">
            <div className="col gap-1">
              <span className="t-caption t-tertiary">{t('caseDetail.refusalRisk')}</span>
              <div className="row gap-2" style={{ alignItems: 'baseline' }}>
                <span className="t-medium" style={{ fontSize: 'var(--size-h4)' }}>{Math.round(risk.rate * 100)}%</span>
                <Pill tone={tone}>{t(`risk.${risk.band}` as 'risk.faible')}</Pill>
              </div>
              <span className="t-caption t-tertiary">
                {t(risk.basis === 'consulat_statut' ? 'caseDetail.riskBasisFine' : 'caseDetail.riskBasisConsulat')}
                {' · '}
                {t('caseDetail.riskSample', { n: risk.sample })}
              </span>
            </div>
          </div>
        )
      })()}

      {/* Le registre du passeport. C'est le risque juridique numéro un de
          l'agence : un passeport perdu coûte vingt fois sa délivrance. La
          restitution est bloquée tant que le solde n'est pas réglé. */}
      {(() => {
        const held = db.custody.find((c) => c.caseId === kase.id && !c.returnedAt)
        const past = db.custody.filter((c) => c.caseId === kase.id && c.returnedAt)
        const due = caseBalance(kase)
        const canForce = v.can('finance:global')
        return (
          <div className="fd-bloc">
            <div className="fd-bloc__head" style={{ marginBottom: held ? 'var(--sp-3)' : 0 }}>
              <span className="fd-bloc__title"><Icon name="passport" size={15} /> {t('custody.title')}</span>
              {!held && v.can('case:write') && (
                <button type="button" className="linkish t-small" onClick={() => setReceiving(true)}>{t('custody.receive')}</button>
              )}
            </div>
            {held ? (
              <div className="col gap-2">
                <div className="row-between">
                  <span className="t-medium">{held.passportNumber}</span>
                  <Pill tone="orange">{t('custody.held')}</Pill>
                </div>
                <span className="t-caption t-tertiary">{held.location} · {t('custody.since', { date: formatDate(held.receivedAt) })}</span>
                {v.can('case:write') && (
                  due > 0 ? (
                    <div className="col gap-2" style={{ marginTop: 'var(--sp-2)' }}>
                      <span className="t-caption fd-rouge">{t('custody.blocked', { amount: formatMoney(due) })}</span>
                      {canForce && (
                        <button type="button" className="linkish t-small fd-rouge"
                          onClick={() => { if (window.confirm(t('custody.forceConfirm', { amount: formatMoney(due) }))) { actions.releasePassport(held.id, true); toast(t('custody.returned')) } }}>
                          {t('custody.force')}
                        </button>
                      )}
                    </div>
                  ) : (
                    <Button size="sm" style={{ marginTop: 'var(--sp-2)', alignSelf: 'start' }}
                      onClick={() => { actions.releasePassport(held.id); toast(t('custody.returned')) }}>
                      {t('custody.return')}
                    </Button>
                  )
                )}
              </div>
            ) : (
              <span className="t-small t-tertiary">{past.length > 0 ? t('custody.returnedPast') : t('custody.none')}</span>
            )}
          </div>
        )
      })()}

      {(kase.refusalCode || kase.refusalReason) && (
        <div className="fd-bloc fd-bloc--rouge">
          <div className="col gap-1">
            {kase.refusalCode && (
              <span className="t-medium t-small">{t(`refusal.${kase.refusalCode}` as 'refusal.autre')}</span>
            )}
            {kase.refusalReason && <span className="t-small">{kase.refusalReason}</span>}
            {kase.appealDueAt && (
              <span className="t-caption">{t('refusal.appealDue', { date: formatDate(kase.appealDueAt) })}</span>
            )}
          </div>
        </div>
      )}
    </div>
    {receiving && (
      <Modal
        title={t('custody.receive')}
        onClose={() => setReceiving(false)}
        footer={<>
          <Button onClick={() => setReceiving(false)}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={!passportNo.trim()} onClick={() => {
            actions.receivePassport({ caseId: kase.id, clientId: kase.clientId, passportNumber: passportNo.trim() })
            setReceiving(false); toast(t('custody.receivedDone'))
          }}>{t('action.confirm')}</Button>
        </>}
      >
        <div className="col gap-4">
          <p className="t-small t-secondary">{t('custody.receiveHint')}</p>
          <Field label={t('clients.passport')}>
            <Input value={passportNo} onChange={(e) => setPassportNo(e.target.value)} placeholder="L123456" />
          </Field>
        </div>
      </Modal>
    )}
    </>
  )
}

/* ------------------------------ Pieces ------------------------------- */

function DocsTab({ caseId }: { caseId: string }) {
  const { db, actions } = useStore()
  const { t, tt, formatDate } = useI18n()
  const toast = useToast()
  const docs = db.documents.filter((d) => d.caseId === caseId)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const set = (docId: string, state: DocState) => {
    actions.setDocState(docId, state)
    toast(state === 'validee' ? t('docs.validated') : t('action.save'))
  }

  if (docs.length === 0) return <Vide icon="documents" title={t('fiche.noDocs')} />

  return (
    <div className="fd-liste">
      {docs.map((d) => (
        <div key={d.id} className="fd-ligne">
          <div className="fd-ligne__main">
            <span className="row gap-2">
              <span className="t-medium t-small">{tt(d.label)}</span>
              {!d.required && <span className="t-caption t-tertiary">{t('misc.optional')}</span>}
            </span>
            <span className="t-caption t-tertiary">
              {d.fileName ?? t('portal.uploadHint')}
              {d.expiresAt && ` · ${t('docs.expiresOn')} ${formatDate(d.expiresAt)}`}
              {d.reminders > 0 && ` · ${t('docs.reminders')} ${d.reminders}`}
              {d.validatedAt && ` · ${t('docs.validated')} ${formatDate(d.validatedAt)}`}
              {d.validatedBy && ` · ${db.users.find((u) => u.id === d.validatedBy)?.name ?? ''}`}
              {d.uploadedAt && !d.uploadedBy && ` · ${t('file.byClient')}`}
            </span>
            {d.rejectionReason && d.state === 'refusee' && (
              <span className="t-caption fd-rouge">{d.rejectionReason}</span>
            )}
            {/* Le dépôt réel. Sans lui, le logiciel restait un cahier de suivi
                et la pièce vivait dans un fil WhatsApp. */}
            <div style={{ marginTop: 'var(--sp-2)', maxWidth: 360 }}>
              <FileDrop
                scope="dossier"
                id={d.id}
                current={d.fileKey ? { key: d.fileKey, name: d.fileName, size: d.fileSize, type: d.fileType } : undefined}
                onAttach={(f) => { actions.attachFile(d.id, f); toast(t('file.uploaded')) }}
                onDetach={() => { actions.detachFile(d.id); toast(t('file.removed')) }}
                compact
              />
            </div>
          </div>
          <div className="fd-ligne__side">
            <DocPill state={d.state} />
            {['manquante', 'demandee'].includes(d.state) && (
              <>
                {d.state === 'manquante' && (
                  <Button size="sm" icon="messages" onClick={() => { actions.setDocState(d.id, 'demandee'); toast(t('msg.sent')) }}>{t('action.request')}</Button>
                )}
                {d.state === 'demandee' && (
                  <Button size="sm" icon="bell" onClick={() => { actions.remindDoc(d.id); toast(t('action.remind')) }}>{t('action.remind')}</Button>
                )}
                {/* Le papier posé sur le comptoir : le geste le plus fréquent
                    de la journée, il lui fallait un bouton. */}
                <Button size="sm" icon="building" onClick={() => set(d.id, 'recue')}>{t('notes.counter')}</Button>
              </>
            )}
            {['recue', 'expiree', 'refusee'].includes(d.state) && (
              <>
                <Button size="sm" variant="primary" icon="check" onClick={() => set(d.id, 'validee')}>{t('action.validate')}</Button>
                <Button size="sm" variant="danger" icon="close" onClick={() => { setRejecting(d.id); setReason('') }}>{t('action.reject')}</Button>
              </>
            )}
            {d.state === 'validee' && (
              <Button size="sm" icon="edit" onClick={() => actions.setDocState(d.id, 'recue')}>{t('crud.edit')}</Button>
            )}
          </div>
        </div>
      ))}

      {rejecting && (
        <Modal
          title={t('docs.rejected')}
          onClose={() => setRejecting(null)}
          footer={
            <>
              <Button onClick={() => setRejecting(null)}>{t('action.cancel')}</Button>
              <Button variant="danger" onClick={() => { actions.setDocState(rejecting, 'refusee', reason); setRejecting(null); toast(t('docs.rejected')) }}>
                {t('action.reject')}
              </Button>
            </>
          }
        >
          <Field label={t('docs.reason')}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Document illisible, merci de reprendre la photo à plat." />
          </Field>
        </Modal>
      )}
    </div>
  )
}

/* ----------------------------- Messages ------------------------------ */

function MessagesTab({ caseId }: { caseId: string }) {
  const { db, actions } = useStore()
  const { t, tt } = useI18n()
  const toast = useToast()
  const messages = db.messages.filter((m) => m.caseId === caseId)
  const kase = db.cases.find((c) => c.id === caseId)!
  const client = db.clients.find((c) => c.id === kase.clientId)!
  const [body, setBody] = useState('')
  const [channel, setChannel] = useState<Channel>('whatsapp')
  const [templateId, setTemplateId] = useState('')

  const applyTemplate = (id: string) => {
    setTemplateId(id)
    const tpl = db.templates.find((x) => x.id === id)
    if (!tpl) return
    setChannel(tpl.channel)
    setBody(
      (tpl.body[client.locale] ?? tpl.body.fr)
        .replace('{client}', client.firstName)
        .replace('{reference}', kase.reference)
        .replace('{montant}', String(kase.amountTotal - kase.amountPaid))
        .replace('{bureau}', db.agency.offices.find((o) => o.id === kase.officeId)?.name ?? '')
        .replace('{pays}', db.visaTypes.find((v) => v.id === kase.visaTypeId)?.country[client.locale] ?? ''),
    )
  }

  // La fenêtre de 24 heures : dans la fenêtre, le message est libre et
  // gratuit ; hors fenêtre, il faut un modèle approuvé et Meta facture.
  const open = waWindowOpen(db, client.id)
  const left = waWindowLeft(db, client.id)
  const usingTemplate = Boolean(templateId)

  const send = () => {
    if (!body.trim()) return
    actions.sendMessage({ caseId, body: body.trim(), channel, templateKey: db.templates.find((x) => x.id === templateId)?.key })
    setBody('')
    setTemplateId('')
    toast(t('msg.sent'))
  }

  return (
    <div className="col gap-5">
      {messages.length === 0 ? (
        <Vide icon="messages" title={t('msg.none')} />
      ) : (
        <div className="col gap-3">
          {messages.map((m) => {
            // Un message arabe se lit de droite à gauche : la bulle et sa
            // ponctuation doivent suivre, sinon le client libyen lit de travers.
            const rtl = m.locale === 'ar'
            return (
            <div
              key={m.id}
              dir={rtl ? 'rtl' : 'ltr'}
              lang={m.locale}
              className={`fd-bulle ${m.direction === 'sortant' ? 'fd-bulle--sortant' : ''}`}
              style={{ textAlign: rtl ? 'right' : 'left' } as CSSProperties}
            >
              <p className="t-small" style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
              <span className="t-caption t-tertiary fd-bulle__meta">
                <Icon name={m.channel === 'whatsapp' ? 'whatsapp' : m.channel === 'email' ? 'mail' : 'portal'} size={12} />
                <Ago iso={m.at} />
                {m.automated && <Pill tone="violet">{t('msg.automated')}</Pill>}
              </span>
            </div>
          )})}
        </div>
      )}

      <div className="fd-composer">
        <div className="row gap-3 wrap">
          <Select value={templateId} onChange={(e) => applyTemplate(e.target.value)} style={{ width: 'auto' }}>
            <option value="">{t('msg.noTemplate')}</option>
            {db.templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>{tt(tpl.name)}</option>
            ))}
          </Select>
          <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} style={{ width: 'auto' }}>
            {(['whatsapp', 'email', 'sms', 'portail'] as Channel[]).map((c) => (
              <option key={c} value={c}>{t(`channel.${c}` as 'channel.whatsapp')}</option>
            ))}
          </Select>
          <span className="t-caption t-tertiary row gap-1">
            <Icon name="language" size={14} /> {t('msg.languageAuto')} ({client.locale.toUpperCase()})
          </span>
        </div>
        {/* Ce que l'envoi va coûter, dit avant l'envoi. Une agence qui relance
            cinq fois à froid paie cinq messages modèles ; répondre dans la
            fenêtre est gratuit. */}
        {channel === 'whatsapp' && (
          <div className={`wawindow ${open ? 'wawindow--open' : ''}`}>
            <Icon name={open ? 'clock' : 'alert'} size={15} />
            <span className="t-caption grow">
              {open ? t('wa.openFor', { n: Math.round(left / 60) }) : usingTemplate ? t('wa.closedTemplate') : t('wa.closedFree')}
            </span>
          </div>
        )}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('msg.placeholder')}
          dir={client.locale === 'ar' ? 'rtl' : 'ltr'}
          onKeyDown={(e) => {
            // Entrée envoie, comme dans une messagerie. Maj+Entrée saute une
            // ligne. C'est le tac-au-tac que réclame le comptoir.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          }}
        />
        <div className="row-between">
          <span className="t-caption t-tertiary">{t('portal.privacy')}</span>
          <span className="row gap-2">
            {/* Tant que l'API n'est pas branchée, on ouvre WhatsApp avec le
                texte déjà écrit : six manipulations en moins sur sept. */}
            <a
              className={`btn btn--secondary btn--sm ${body.trim() ? '' : 'btn--disabled'}`}
              href={`https://wa.me/${(client.whatsapp ?? client.phone).replace(/[^0-9]/g, '')}?text=${encodeURIComponent(body)}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => { if (body.trim()) send() }}
            >
              <Icon name="whatsapp" size={16} /> WhatsApp
            </a>
            <Button variant="primary" icon="messages" onClick={send} disabled={!body.trim()}>{t('action.send')}</Button>
          </span>
        </div>
      </div>
    </div>
  )
}

/* --------------------------- Rendez vous ----------------------------- */

function ApptsTab({ caseId }: { caseId: string }) {
  const { db, actions } = useStore()
  const { t, formatDate } = useI18n()
  const toast = useToast()
  const appts = db.appointments.filter((a) => a.caseId === caseId).sort((a, b) => a.at.localeCompare(b.at))
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<AppointmentKind>('agence')
  const [at, setAt] = useState('')
  const kase = db.cases.find((c) => c.id === caseId)!

  const nouveau = <Button icon="plus" onClick={() => setOpen(true)}>{t('appts.newAppt')}</Button>

  return (
    <div className="fd-liste">
      {appts.length === 0 && <Vide icon="appointments" title={t('appts.none')} action={nouveau} />}
      {appts.map((a) => (
        <div key={a.id} className="fd-ligne">
          <div className="fd-ligne__main">
            <span className="t-medium t-small">{t(`appt.${a.kind}` as 'appt.agence')}</span>
            <span className="t-caption t-tertiary">{a.location}</span>
          </div>
          <div className="col" style={{ textAlign: 'end' }}>
            <span className="t-small t-num">
              {formatDate(a.at, { weekday: 'short', day: '2-digit', month: 'short' })}
              {' · '}
              {new Date(a.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="t-caption t-tertiary">{t(`appt.${a.status}` as 'appt.prevu')}</span>
          </div>
        </div>
      ))}

      {appts.length > 0 && <div className="fd-liste__foot">{nouveau}</div>}

      {open && (
        <Modal
          title={t('appts.newAppt')}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button onClick={() => setOpen(false)}>{t('action.cancel')}</Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (!at) return
                  actions.addAppointment({
                    caseId, kind, at: new Date(at).toISOString(), durationMin: 30,
                    location: db.agency.offices.find((o) => o.id === kase.officeId)?.address ?? '',
                    status: 'prevu',
                  })
                  setOpen(false)
                  toast(t('appts.newAppt'))
                }}
              >
                {t('action.confirm')}
              </Button>
            </>
          }
        >
          <div className="col gap-4">
            <Field label={t('appts.title')}>
              <Select value={kind} onChange={(e) => setKind(e.target.value as AppointmentKind)}>
                {(['agence', 'consulat', 'biometrie', 'retrait'] as AppointmentKind[]).map((x) => (
                  <option key={x} value={x}>{t(`appt.${x}` as 'appt.agence')}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('appts.at')}>
              <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ---------------------------- Paiements ------------------------------ */

function PaymentsTab({ caseId }: { caseId: string }) {
  const { db, actions } = useStore()
  const { t, tt, formatMoney, formatDate } = useI18n()
  const toast = useToast()
  const payments = db.payments.filter((p) => p.caseId === caseId)
  const [cashing, setCashing] = useState<string | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('especes')
  const paymentAmount = db.payments.find((p) => p.id === cashing)?.amount

  return (
    <div className="fd-liste">
      {payments.length === 0 && <Vide icon="payments" title={t('fiche.noPayments')} />}
      {payments.map((p) => (
        <div key={p.id} className="fd-ligne">
          <div className="fd-ligne__main">
            <span className="t-small t-medium">{tt(p.label)}</span>
            <span className="t-caption t-tertiary">
              {p.state === 'regle'
                ? `${t(`payment.${p.method ?? 'especes'}` as 'payment.especes')} · ${formatDate(p.at)} · ${p.receiptNo ?? ''}`
                : `${t('caseDetail.dueOn')} ${formatDate(p.dueAt)}`}
            </span>
          </div>
          <div className="fd-ligne__side">
            <span className="t-medium t-num">{formatMoney(p.amount)}</span>
            {p.state === 'regle' ? (
              <Pill tone="green" dot>{t('payment.regle')}</Pill>
            ) : (
              <Button size="sm" variant="primary" onClick={() => { setCashing(p.id); setMethod('especes') }}>
                {t('action.markPaid')}
              </Button>
            )}
          </div>
        </div>
      ))}
      <p className="t-caption t-tertiary fd-liste__foot">{t('pay.subtitle')}</p>

      {cashing && (
        <Modal
          title={t('action.markPaid')}
          onClose={() => setCashing(null)}
          footer={
            <>
              <Button onClick={() => setCashing(null)}>{t('action.cancel')}</Button>
              <Button
                variant="primary"
                onClick={() => { actions.markPaymentPaid(cashing, method); setCashing(null); toast(t('action.markPaid')) }}
              >
                {t('action.confirm')}
              </Button>
            </>
          }
        >
          <div className="col gap-4">
            <Field label={t('pay.method')}>
              <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {(['especes', 'virement', 'carte', 'cheque'] as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>{t(`payment.${m}` as 'payment.especes')}</option>
                ))}
              </Select>
            </Field>
            {/* L'alerte anti-amende : un encaissement espèces à partir de 5000
                dinars coûte 20 % d'amende, minimum 2000 dinars (art. 83 ter du
                CDPF). Mieux vaut fractionner ou passer par un autre moyen. */}
            {method === 'especes' && (paymentAmount ?? 0) >= 5000 && (
              <div className="wawindow fd-bloc--rouge">
                <Icon name="alert" size={15} />
                <span className="t-caption grow">{t('pay.cashWarning')}</span>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ----------------------------- Decision ------------------------------ */

const REFUSAL_CODES: RefusalCode[] = [
  'sortie_non_etablie', 'moyens_insuffisants', 'justificatifs_non_fiables', 'objet_non_justifie',
  'assurance_absente', 'sejours_epuises', 'document_faux', 'signalement', 'ordre_public', 'autre',
]

function Decision({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const { actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const [status, setStatus] = useState<'accepte' | 'refuse' | 'annule'>('accepte')
  const [code, setCode] = useState<RefusalCode>('sortie_non_etablie')
  const [reason, setReason] = useState('')

  return (
    <Modal
      title={t('fiche.decide')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              actions.recordDecision(caseId, status, { code, reason: reason || undefined })
              onClose()
              toast(t('crud.updated'))
            }}
          >
            {t('action.confirm')}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label={t('cases.stage')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as 'accepte' | 'refuse' | 'annule')}>
            <option value="accepte">{t('status.accepte')}</option>
            <option value="refuse">{t('status.refuse')}</option>
            <option value="annule">{t('status.annule')}</option>
          </Select>
        </Field>
        {status === 'refuse' && (
          <>
            {/* Le code ferme, pas le texte libre : c'est lui qui produit la
                statistique « nos refus viennent a 60 % de la sortie non
                etablie », et donc la liste de pieces a renforcer. */}
            <Field label={t('refusal.label')}>
              <Select value={code} onChange={(e) => setCode(e.target.value as RefusalCode)}>
                {REFUSAL_CODES.map((x) => (
                  <option key={x} value={x}>{t(`refusal.${x}` as 'refusal.autre')}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('docs.reason')}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------ Notes -------------------------------- */

/* Les notes s'empilent, datees et signees. Un bouton pose l'appel en un geste,
   parce qu'on ne tape pas cinq champs avec un client au telephone. */
function NoteBox({ caseId }: { caseId: string }) {
  const { db, actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const [text, setText] = useState('')
  const notes = db.cases.find((c) => c.id === caseId)?.notes ?? []

  const add = (kind: 'note' | 'appel' | 'comptoir', body?: string) => {
    const content = body ?? text.trim()
    if (!content) return
    actions.addNote(caseId, content, kind)
    setText('')
    toast(t('crud.created'))
  }

  return (
    <div className="col gap-4">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t('caseDetail.addNote')} />
      <div className="row gap-2 wrap">
        <Button variant="primary" size="sm" disabled={!text.trim()} onClick={() => add('note')}>
          {t('action.save')}
        </Button>
        <Button size="sm" icon="phone" onClick={() => add('appel', text.trim() || t('notes.called'))}>
          {t('notes.called')}
        </Button>
        <Button size="sm" icon="building" onClick={() => add('comptoir', text.trim() || t('notes.counter'))}>
          {t('notes.counter')}
        </Button>
      </div>
      {notes.length > 0 && (
        <ul className="timeline" style={{ marginTop: 'var(--sp-2)' }}>
          {notes.map((note) => (
            <li key={note.id} className="timeline__item">
              <span className="timeline__dot" />
              <div className="col gap-1">
                <span className="t-small">{note.text}</span>
                <span className="t-caption t-tertiary">
                  <Ago iso={note.at} />
                  {note.authorId && ` · ${db.users.find((u) => u.id === note.authorId)?.name ?? ''}`}
                  {note.kind !== 'note' && ` · ${note.kind === 'appel' ? t('notes.called') : t('notes.counter')}`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
