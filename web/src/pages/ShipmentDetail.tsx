import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Avatar, Button, Card, Empty, Pill, Progress, Tabs, useToast } from '@/components/ui'
import { Ligne, PageHeader, Vide } from '@/components/page'
import { Icon } from '@/components/Icon'
import { Ago, Countdown, DocPill } from '@/components/bits'
import { FileDrop } from '@/components/FileDrop'
import { PrintButton } from '@/components/PrintButton'
import { ShipmentEditor } from '@/components/ShipmentEditor'
import { CountersTiles, CustomsCard, DouaneDocsCard, LotsCard, RouteCard } from '@/components/FretCards'
import { ArrivalCard } from '@/components/ArrivalCard'
import { TransportDocsCard } from '@/components/TransportDocsCard'
import { CustomsChecklist } from '@/components/CustomsChecklist'
import { InspectionsCard } from '@/components/InspectionsCard'
import { DangerousGoodsCard } from '@/components/DangerousGoodsCard'
import { ContainersCard } from '@/components/ContainersCard'
import { GoodsCard } from '@/components/GoodsCard'
import { PurchaseOrders } from '@/components/PurchaseOrders'
import { CostsCard } from '@/components/CostsCard'
import { InsuranceCard } from '@/components/InsuranceCard'
import { ActorsCard } from '@/components/ActorsCard'
import { TrackingLinks } from '@/components/TrackingLinks'
import { CustomFields } from '@/components/CustomFields'
import { HistoryCard } from '@/components/HistoryCard'
import { AuditTrail } from '@/components/AuditTrail'
import {
  SHIPMENT_STAGES, SHIPMENT_TONE, clientName, shipmentClientIds, shipmentProgress,
} from '@/lib/derive'
import type { Shipment, ShipmentDocument, ShipmentEvent, VisaCase } from '@/data/types'
import '@/styles/fiche-cargo.css'

/**
 * LA FICHE D'UNE CARGAISON.
 *
 * Deux colonnes tenues : à gauche des onglets, à droite un rail collant avec
 * seulement ce qu'on cherche cent fois par jour (où en est la marchandise, ce
 * qu'elle pèse et vaut, qui l'attend). Avant, vingt cartes empilées faisaient
 * 8 000 px de haut : ce n'était plus une fiche, c'était un rouleau.
 *
 * L'onglet vit dans l'adresse (`?onglet=`) : le lien se partage, le retour
 * du navigateur marche. Aucun geste n'a disparu : chaque carte garde ses
 * boutons là où elle est rangée.
 */

type Onglet = 'apercu' | 'trajet' | 'documents' | 'douane' | 'chargement' | 'couts' | 'intervenants' | 'suivi' | 'historique'
const ONGLETS: Onglet[] = ['apercu', 'trajet', 'documents', 'douane', 'chargement', 'couts', 'intervenants', 'suivi', 'historique']

export function ShipmentDetail() {
  const { id = '' } = useParams()
  const { db, actions } = useStore()
  const v = useVisible()
  const { t, tt, formatDate, formatMoney, formatNumber } = useI18n()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [params, setParams] = useSearchParams()
  const brut = params.get('onglet')
  const tab: Onglet = ONGLETS.includes(brut as Onglet) ? (brut as Onglet) : 'apercu'
  const setTab = (value: Onglet) => setParams(value === 'apercu' ? {} : { onglet: value }, { replace: true })

  const shipment = v.shipments.find((s) => s.id === id)
  if (!shipment) return <Empty title={t('ship.none')} action={<Link to="/cargaisons" className="btn btn--secondary">{t('action.back')}</Link>} />

  // Les clients viennent des LOTS. Le champ `clientId` de la cargaison n'existe
  // pas en base : s'y fier faisait planter la fiche sur des données réelles.
  const clientIds = shipmentClientIds(db, shipment)
  const docs = db.shipmentDocs.filter((d) => d.shipmentId === shipment.id)
  const events = db.shipmentEvents.filter((e) => e.shipmentId === shipment.id).sort((a, b) => b.at.localeCompare(a.at))
  const legs = db.legs.filter((l) => l.shipmentId === shipment.id)
  const lots = db.lots.filter((l) => l.shipmentId === shipment.id)
  const linkedCase = shipment.caseId ? db.cases.find((c) => c.id === shipment.caseId) : undefined
  const portalUrl = `${window.location.origin}${import.meta.env.BASE_URL}portail/cargaison/${shipment.portalToken}`
  const canWrite = v.can('shipment:write')
  const canAdvance = canWrite && shipment.status === 'en_cours'
  const finance = v.can('finance:global')
  const balance = shipment.freightCost - shipment.amountPaid
  // « Shanghai · Shanghai » n'apprend rien : quand la ville et le port portent
  // le même nom, on ne l'écrit qu'une fois.
  const lieu = (ville: string, port: string) => (ville === port ? port : `${ville} · ${port}`)

  const copyPortal = async () => {
    try { await navigator.clipboard.writeText(portalUrl); toast(t('action.copied')) } catch { toast(portalUrl) }
  }
  const advance = () => { actions.advanceShipment(shipment.id); toast(t('ship.advance')) }

  const stagePill = (
    <Pill tone={SHIPMENT_TONE[shipment.stage]} dot>{t(`ship.s.${shipment.stage}` as 'ship.s.transit')}</Pill>
  )
  // L'arrivée : un compte à rebours tant que ça roule (rouge en retard), la
  // date constatée une fois livré.
  const etaNode = shipment.status === 'en_cours'
    ? <Countdown iso={shipment.eta} />
    : <span>{formatDate(shipment.deliveredAt ?? shipment.eta)}</span>

  const onglets: { value: Onglet; label: string; count?: number }[] = [
    { value: 'apercu', label: t('fcargo.tabApercu') },
    { value: 'trajet', label: t('fcargo.tabTrajet'), count: legs.length || undefined },
    { value: 'documents', label: t('fcargo.tabDocuments'), count: docs.length || undefined },
    { value: 'douane', label: t('fcargo.tabDouane') },
    { value: 'chargement', label: t('fcargo.tabChargement'), count: lots.length || undefined },
    { value: 'couts', label: t('fcargo.tabCouts') },
    { value: 'intervenants', label: t('fcargo.tabIntervenants') },
    { value: 'suivi', label: t('fcargo.tabSuivi') },
    { value: 'historique', label: t('fcargo.tabHistorique'), count: events.length || undefined },
  ]

  return (
    <>
      <Link to="/cargaisons" className="fc-crumb">
        <Icon name="chevron" size={14} />
        {t('ship.title')}
      </Link>

      <div className="fc-head">
        <PageHeader
          kicker={`${shipment.reference} · ${t(`ship.m.${shipment.mode}` as 'ship.m.aerien')}`}
          title={`${shipment.originPort} → ${shipment.destPort}`}
          subtitle={
            <span className="fc-sub">
              <span>{tt(shipment.goods)}</span>
              <span aria-hidden="true">·</span>
              {stagePill}
              <span aria-hidden="true">·</span>
              <span>{t('ship.eta')} {etaNode}</span>
            </span>
          }
          actions={
            <>
              <PrintButton kind="cargaison" entityId={shipment.id} />
              {canWrite && <Button icon="edit" onClick={() => setEditing(true)}>{t('crud.edit')}</Button>}
              <Button icon="copy" onClick={() => void copyPortal()}>{t('caseDetail.portalLink')}</Button>
              {canAdvance && (
                <Button variant="primary" icon="arrow" onClick={advance}>{t('ship.advance')}</Button>
              )}
            </>
          }
        />
      </div>

      {editing && <ShipmentEditor shipment={shipment} onClose={() => setEditing(false)} />}

      <div className="pg-fiche">
        <div style={{ minWidth: 0 }}>
          <div className="fc-tabs">
            <Tabs value={tab} options={onglets} onChange={setTab} idPrefix="fc" />
          </div>

          <div className="fc-panel" role="tabpanel" id={`fc-panel-${tab}`} aria-labelledby={`fc-${tab}`}>
            {tab === 'apercu' && (
              <>
                <StepsCard
                  shipment={shipment}
                  events={events}
                  onBack={canWrite && shipment.stage !== 'demande'
                    ? () => { actions.stepBackShipment(shipment.id); toast(t('crud.updated')) }
                    : undefined}
                />
                {/* Ce que l'agence regarde tous les matins : c'est là que
                    l'argent se perd, un jour à la fois, sur trois factures. */}
                <CountersTiles shipment={shipment} />
                <ArrivalCard shipmentId={shipment.id} />
                {shipment.notes && (
                  <Card title={t('caseDetail.notes')}>
                    <p className="t-small t-secondary">{shipment.notes}</p>
                  </Card>
                )}
              </>
            )}

            {tab === 'trajet' && <RouteCard shipment={shipment} />}

            {tab === 'documents' && (
              <>
                <ExpectedDocsCard docs={docs} />
                <TransportDocsCard shipmentId={shipment.id} />
                <DouaneDocsCard shipment={shipment} />
              </>
            )}

            {tab === 'douane' && (
              <>
                <CustomsCard shipment={shipment} />
                <CustomsChecklist shipmentId={shipment.id} />
                <InspectionsCard shipmentId={shipment.id} />
                <DangerousGoodsCard shipmentId={shipment.id} />
              </>
            )}

            {tab === 'chargement' && (
              <>
                <ContainersCard shipmentId={shipment.id} />
                <GoodsCard shipmentId={shipment.id} />
                <LotsCard shipment={shipment} />
                <PurchaseOrders shipmentId={shipment.id} />
              </>
            )}

            {tab === 'couts' && (
              <>
                <CostsCard shipmentId={shipment.id} />
                <InsuranceCard shipmentId={shipment.id} />
              </>
            )}

            {tab === 'intervenants' && <ActorsCard shipmentId={shipment.id} />}

            {tab === 'suivi' && (
              <>
                <TrackingLinks kind="SHIPMENT" entityId={shipment.id} />
                <CustomFields entityKind="SHIPMENT" entityId={shipment.id} />
              </>
            )}

            {tab === 'historique' && (
              <>
                <MilestonesCard events={events} />
                <HistoryCard entityKind="SHIPMENT" entityId={shipment.id} />
                <AuditTrail entityType="shipments" entityId={shipment.id} />
              </>
            )}
          </div>
        </div>

        {/* Le rail : trois cartes, rien d'autre. Ce qu'on vérifie au téléphone
            avec le client, sans changer d'onglet. */}
        <aside className="pg-fiche__rail fc-rail">
          <Card title={t('ship.tracking')} action={stagePill}>
            <Ligne label={t('ship.mode')}>{t(`ship.m.${shipment.mode}` as 'ship.m.aerien')}</Ligne>
            <Ligne label={t('ship.from')}>{lieu(shipment.originCity, shipment.originPort)}</Ligne>
            <Ligne label={t('ship.to')}>{lieu(shipment.destCity, shipment.destPort)}</Ligne>
            <Ligne label={t('ship.etd')}>{formatDate(shipment.etd)}</Ligne>
            <Ligne label={t('ship.eta')}>{etaNode}</Ligne>
            {shipment.containerNo && <Ligne label={t('ship.container')} mono>{shipment.containerNo}</Ligne>}
            {shipment.blNumber && <Ligne label={t('ship.bl')} mono>{shipment.blNumber}</Ligne>}
            <Ligne label={t('ship.incoterm')}>{shipment.incoterm}</Ligne>
            {canAdvance && (
              <Button variant="primary" block icon="arrow" className="fc-rail__cta" onClick={advance}>
                {t('ship.advance')}
              </Button>
            )}
          </Card>

          <Card title={t('ship.goods')}>
            <Ligne label={t('ship.supplier')}>{shipment.supplier}</Ligne>
            <Ligne label={t('ship.packages')}>{formatNumber(shipment.packages)}</Ligne>
            <Ligne label={t('ship.weight')}>{formatNumber(shipment.weightKg)} kg</Ligne>
            <Ligne label={t('ship.volume')}>{shipment.volumeCbm} m³</Ligne>
            {/* Les montants ne sortent pas du cercle de la direction. */}
            {finance && <Ligne label={t('ship.freight')}>{formatMoney(shipment.freightCost)}</Ligne>}
            {finance && shipment.customsDuty !== undefined && <Ligne label={t('ship.duty')}>{formatMoney(shipment.customsDuty)}</Ligne>}
            {finance && <Ligne label={t('ship.value')}>{formatMoney(shipment.declaredValue)}</Ligne>}
            <Ligne label={t('cases.balance')}>
              {balance > 0 ? <span className="t-red t-medium">{formatMoney(balance)}</span> : t('payment.regle')}
            </Ligne>
          </Card>

          <ClientCard clientIds={clientIds} linkedCase={linkedCase} />
        </aside>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* La frise des étapes                                                 */
/* ------------------------------------------------------------------ */

function StepsCard({ shipment, events, onBack }: {
  shipment: Shipment; events: ShipmentEvent[]; onBack?: () => void
}) {
  const { t } = useI18n()
  const currentIndex = SHIPMENT_STAGES.indexOf(shipment.stage)
  const pct = shipmentProgress(shipment)

  return (
    <Card
      title={t('fcargo.steps')}
      action={<span className="t-caption t-tertiary">{t('fcargo.stepOf', { i: currentIndex + 1, n: SHIPMENT_STAGES.length })}</span>}
    >
      <div className="col gap-4">
        <Progress
          pct={pct}
          tone={shipment.stage === 'livre' ? 'green' : undefined}
          label={t('fcargo.progress', { pct })}
          valueText={t('fcargo.progress', { pct })}
        />
        {/* Dix segments qui se remplissent : vert derrière, bleu sous les
            pieds, gris devant. Le lieu et la date sous l'étape franchie. */}
        <ol className="fc-steps">
          {SHIPMENT_STAGES.map((stage, i) => {
            const event = events.find((e) => e.stage === stage)
            const etat = i < currentIndex ? 'fc-step--done' : i === currentIndex ? 'fc-step--current' : ''
            return (
              <li key={stage} className={`fc-step ${etat}`} aria-current={i === currentIndex ? 'step' : undefined}>
                <span className="fc-step__bar" />
                <span className="fc-step__label">{t(`ship.s.${stage}` as 'ship.s.transit')}</span>
                {event && (
                  <span className="fc-step__meta">{event.location} · <Ago iso={event.at} /></span>
                )}
              </li>
            )
          })}
        </ol>
        {onBack && (
          <div>
            <Button size="sm" icon="refresh" onClick={onBack}>{t('fcargo.stepBack')}</Button>
          </div>
        )}
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Les pièces attendues, et leur dépôt                                 */
/* ------------------------------------------------------------------ */

function ExpectedDocsCard({ docs }: { docs: ShipmentDocument[] }) {
  const { actions } = useStore()
  const { t, tt } = useI18n()
  const toast = useToast()
  const done = docs.filter((d) => d.state === 'validee').length

  return (
    <Card
      title={t('fcargo.expectedDocs')}
      action={docs.length > 0 ? <span className="t-caption t-tertiary">{t('fcargo.docsValidated', { done, total: docs.length })}</span> : undefined}
      flush={docs.length > 0}
      className="fc-docs"
    >
      {docs.length === 0 ? (
        <Vide icon="documents" title={t('fcargo.noDocs')} hint={t('fcargo.noDocsHint')} />
      ) : (
        <div className="list">
          {docs.map((d) => (
            <div key={d.id} className="list__row">
              <Icon name="documents" size={18} className="t-tertiary" />
              <span className="col grow gap-2" style={{ minWidth: 0 }}>
                <span className="t-small t-medium">{tt(d.label)}</span>
                {/* Le connaissement et la facture arrivent en PDF : ils
                    doivent vivre dans le dossier, pas dans une boîte mail. */}
                <FileDrop
                  scope="cargaison"
                  id={d.id}
                  current={d.fileKey ? { key: d.fileKey, name: d.fileName, size: d.fileSize, type: d.fileType } : undefined}
                  onAttach={(f) => { actions.attachShipmentFile(d.id, f); toast(t('file.uploaded')) }}
                  compact
                />
              </span>
              <DocPill state={d.state} />
              {d.state !== 'validee' && (
                <Button
                  size="sm"
                  onClick={() => { actions.setShipmentDocState(d.id, d.state === 'manquante' ? 'demandee' : 'validee'); toast(t('action.save')) }}
                >
                  {d.state === 'manquante' ? t('action.request') : t('action.validate')}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Les jalons franchis                                                 */
/* ------------------------------------------------------------------ */

function MilestonesCard({ events }: { events: ShipmentEvent[] }) {
  const { t, tt } = useI18n()
  return (
    <Card title={t('fcargo.milestonesLog')}>
      {events.length === 0 ? (
        <Vide icon="clock" title={t('fcargo.noEvents')} hint={t('fcargo.noEventsHint')} />
      ) : (
        <ul className="timeline">
          {events.map((e) => (
            <li key={e.id} className="timeline__item">
              <span className="timeline__dot timeline__dot--done" />
              <div className="col gap-1">
                <span className="t-small t-medium">{t(`ship.s.${e.stage}` as 'ship.s.transit')}</span>
                <span className="t-caption t-tertiary">
                  {e.location} · <Ago iso={e.at} />
                  {e.note ? ` · ${tt(e.note)}` : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Le client, dans le rail                                             */
/* ------------------------------------------------------------------ */

function ClientCard({ clientIds, linkedCase }: { clientIds: string[]; linkedCase?: VisaCase }) {
  const { db } = useStore()
  const { t } = useI18n()

  if (clientIds.length === 0) {
    return (
      <Card title={t('cases.client')}>
        <Vide icon="clients" title={t('fcargo.noClient')} hint={t('fcargo.noClientHint')} />
      </Card>
    )
  }

  // Un groupage porte plusieurs clients : on les liste, chacun vers sa fiche.
  if (clientIds.length > 1) {
    return (
      <Card title={t('cases.client')} action={<Pill tone="gray">{clientIds.length}</Pill>}>
        <p className="t-caption t-tertiary" style={{ paddingTop: 'var(--sp-2)' }}>{t('fcargo.clientsMany', { n: clientIds.length })}</p>
        {clientIds.map((cid) => (
          <Link key={cid} to={`/clients/${cid}`} className="fc-rail__client">
            <Avatar name={clientName(db, cid)} size="sm" />
            <span className="t-small t-medium t-truncate">{clientName(db, cid)}</span>
          </Link>
        ))}
      </Card>
    )
  }

  const client = db.clients.find((c) => c.id === clientIds[0])
  if (!client) {
    return (
      <Card title={t('cases.client')}>
        <Vide icon="clients" title={t('fcargo.noClient')} hint={t('fcargo.noClientHint')} />
      </Card>
    )
  }
  const digits = client.phone.replace(/[^0-9]/g, '')

  return (
    <Card title={t('cases.client')}>
      <div className="fc-rail__client">
        <Avatar name={clientName(db, client.id)} />
        <div className="col grow" style={{ minWidth: 0 }}>
          <span className="t-medium t-small t-truncate">{client.firstName} {client.lastName}</span>
          <span className="t-caption t-tertiary t-mono">{client.phone}</span>
        </div>
      </div>
      {linkedCase && (
        <Link to={`/dossiers/${linkedCase.id}`} className="fc-rail__link">
          <Icon name="passport" size={16} />
          {t('ship.linkedCase')} · {linkedCase.reference}
        </Link>
      )}
      <div className="fc-rail__actions">
        {digits && (
          <a className="btn btn--secondary btn--sm" href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer">
            <Icon name="whatsapp" size={16} /> {t('fcargo.whatsapp')}
          </a>
        )}
        {digits && (
          <a className="btn btn--secondary btn--sm" href={`tel:${client.phone.replace(/\s+/g, '')}`}>
            <Icon name="phone" size={16} /> {t('fcargo.call')}
          </a>
        )}
        <Link className="btn btn--secondary btn--sm" to={`/clients/${client.id}`}>
          <Icon name="arrow" size={16} /> {t('action.open')}
        </Link>
      </div>
    </Card>
  )
}
