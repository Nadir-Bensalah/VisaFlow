import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { HAS_BACKEND } from '@/lib/supabase'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import {
  LEAD_EVENT_KINDS, LEAD_OPEN_STATUSES, LEAD_SERVICES, LEAD_SOURCES, LEAD_STATUSES,
  addLeadEvent, archiveLead, convertLead, createLead, listLeadEvents, listLeads,
  loadPipeline, setLeadStatus, updateLead,
  type Lead, type LeadDraft, type LeadEvent, type LeadEventKind,
  type LeadService, type LeadSource, type LeadStatus, type PipelineReport,
} from '@/data/crm'
import {
  Button, Empty, Field, Input, Modal, Pill, Segmented, Select, Textarea, useToast,
} from '@/components/ui'
import { Ago } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { ExportButton } from '@/components/ExportButton'
import {
  Erreur, Kpi, KpiGrid, PageHeader, Section, Squelette, Table, Toolbar, Vide, useChargement,
} from '@/components/page'
import type { Tone } from '@/lib/derive'
import '@/styles/modules.css'

/* Le pipeline commercial.
 *
 * Une colonne par état, l'affaire se déplace à la souris. Deux boutons comptent
 * plus que tout le reste sur cet écran : appeler et WhatsApp. C'est par là que
 * passe la relance en Tunisie, et un CRM qui oblige à recopier un numéro dans
 * le téléphone ne sert à personne.
 *
 * Le tableau à colonnes reste la vue de travail. La liste est là pour chercher,
 * trier d'un coup d'œil et exporter : les deux lisent les mêmes lignes.
 *
 * L'écran lit le serveur directement. Sans backend, il le dit et n'affiche
 * rien : un tableau de bord commercial peuplé de démonstration finit toujours
 * par être pris pour la réalité.
 */

const STATUS_TONE: Record<LeadStatus, Tone> = {
  nouveau: 'gray',
  contacte: 'blue',
  qualifie: 'violet',
  rendez_vous: 'violet',
  devis_envoye: 'orange',
  relance: 'orange',
  gagne: 'green',
  perdu: 'red',
}

const digits = (s?: string | null) => (s ?? '').replace(/[^0-9]/g, '')

function leadName(l: Lead): string {
  const person = [l.firstName, l.lastName].filter(Boolean).join(' ').trim()
  return person || l.companyName || '?'
}

function daysSince(iso?: string | null): number {
  if (!iso) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

type Vue = 'colonnes' | 'liste'

export function Leads() {
  const v = useVisible()
  const { t, formatMoney, formatDate } = useI18n()
  const toast = useToast()

  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<LeadStatus | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Lead | 'nouveau' | null>(null)
  const [vue, setVue] = useState<Vue>('colonnes')
  const [q, setQ] = useState('')
  const [service, setService] = useState<LeadService | ''>('')

  const canWrite = v.can('client:write')

  // Les affaires et le rapport de pipeline ensemble : le rapport porte les
  // montants par étape déjà sommés par le serveur.
  const { data, loading, refreshing, error, reload } = useChargement(async () => {
    if (!HAS_BACKEND) return { leads: [] as Lead[], report: null as PipelineReport | null }
    const [leads, report] = await Promise.all([listLeads(), loadPipeline(null)])
    return { leads, report }
  })
  const leads = useMemo(() => data?.leads ?? [], [data])
  const report = data?.report ?? null

  const move = async (id: string, status: LeadStatus) => {
    const lead = leads.find((l) => l.id === id)
    if (!lead || lead.status === status) return
    // Une affaire perdue sans motif ne dit rien : on passe par la fiche.
    if (status === 'perdu') { setOpenId(id); return }
    try {
      await setLeadStatus(id, status)
      toast(`${leadName(lead)} · ${t(`crm.st_${status}` as 'crm.st_nouveau')}`)
      await reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    }
  }

  /* ---------------------------- Compteurs ---------------------------- */

  const compte = useMemo(() => {
    const now = Date.now()
    const ouvertes = leads.filter((l) => LEAD_OPEN_STATUSES.includes(l.status))
    const enRetard = ouvertes.filter((l) => l.nextActionAt && new Date(l.nextActionAt).getTime() < now)
    const annee = new Date().getFullYear()
    const gagnees = leads.filter((l) => l.status === 'gagne' && new Date(l.convertedAt ?? l.statusSince).getFullYear() === annee)
    const valeur = ouvertes.reduce((s, l) => s + Number(l.estimatedValue ?? 0), 0)
    return { ouvertes: ouvertes.length, enRetard: enRetard.length, gagnees: gagnees.length, valeur }
  }, [leads])

  /* ----------------------------- Filtrage ---------------------------- */

  const montres = useMemo(() => {
    const n = norm(q.trim())
    return leads.filter((l) => {
      if (service && l.serviceInterest !== service) return false
      if (!n) return true
      return norm(`${leadName(l)} ${l.companyName ?? ''} ${l.phone ?? ''} ${l.email ?? ''}`).includes(n)
    })
  }, [leads, q, service])

  const open = leads.find((l) => l.id === openId) ?? null

  const colonnesExport = [
    { key: 'name', label: t('crm.lastName'), value: (l: Lead) => leadName(l) },
    { key: 'company', label: t('crm.company'), value: (l: Lead) => l.companyName },
    { key: 'status', label: t('crm.status'), value: (l: Lead) => t(`crm.st_${l.status}` as 'crm.st_nouveau') },
    { key: 'service', label: t('crm.service'), value: (l: Lead) => t(`crm.sv_${l.serviceInterest}` as 'crm.sv_visa') },
    { key: 'source', label: t('crm.source'), value: (l: Lead) => t(`crm.so_${l.source}` as 'crm.so_autre') },
    { key: 'value', label: t('crm.value'), value: (l: Lead) => l.estimatedValue },
    { key: 'currency', label: t('crm.currency'), value: (l: Lead) => l.currency },
    { key: 'phone', label: t('crm.phone'), value: (l: Lead) => l.phone },
    { key: 'email', label: t('crm.email'), value: (l: Lead) => l.email },
    { key: 'next', label: t('crm.nextAction'), value: (l: Lead) => l.nextActionAt?.slice(0, 10) },
    { key: 'created', label: t('crm.createdOn'), value: (l: Lead) => l.createdAt.slice(0, 10) },
  ]

  const head = (
    <PageHeader
      kicker={t('mq.kickerCommercial')}
      title={t('crm.title')}
      subtitle={t('mq.leadsSub')}
      refreshing={refreshing && !loading}
      refreshingLabel={t('mq.refreshing')}
      actions={HAS_BACKEND ? <>
        <ExportButton rows={montres} columns={colonnesExport} base="prospects" scope="prospects" disabled={montres.length === 0} />
        <Button icon="refresh" onClick={() => void reload()} disabled={refreshing}>{t('mq.refresh')}</Button>
        {canWrite && <Button icon="plus" variant="primary" onClick={() => setEditing('nouveau')}>{t('crm.newLead')}</Button>}
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
          <Squelette type="cartes" n={4} />
        </>
      ) : (
        <>
          <KpiGrid>
            <Kpi label={t('mq.leadsOpen')} value={compte.ouvertes} icon="pipeline" tone="blue"
                 hint={t('mq.leadsOpenHint', { n: leads.length })} />
            <Kpi label={t('mq.leadsValue')} value={formatMoney(report?.total_value ?? compte.valeur)} icon="payments"
                 hint={t('mq.leadsValueHint')} />
            <Kpi label={t('mq.leadsOverdue')} value={compte.enRetard} icon="clock"
                 tone={compte.enRetard > 0 ? 'orange' : undefined} hint={t('mq.leadsOverdueHint')} />
            <Kpi label={t('mq.leadsWon')} value={compte.gagnees} icon="check" tone="green"
                 hint={t('crm.thisYear')} />
          </KpiGrid>

          {leads.length === 0 ? (
            <Section>
              <Empty
                title={t('crm.none')}
                hint={t('crm.noneHint')}
                scene="equipe"
                action={canWrite ? <Button icon="plus" variant="primary" onClick={() => setEditing('nouveau')}>{t('crm.newLead')}</Button> : undefined}
              />
            </Section>
          ) : (
            <Section flush>
              <Toolbar right={<><span className="t-caption t-tertiary t-num">{t('mq.rowsOf', { n: montres.length, total: leads.length })}</span><Segmented<Vue>
                  value={vue}
                  onChange={setVue}
                  label={t('mq.view')}
                  options={[
                    { value: 'colonnes', label: t('mq.viewBoard') },
                    { value: 'liste', label: t('mq.viewList') },
                  ]}
                /></>}>
                <Input
                  className="md-search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('mq.leadsSearch')}
                  aria-label={t('mq.search')}
                />
                <Select className="md-select" value={service} onChange={(e) => setService(e.target.value as LeadService | '')} aria-label={t('crm.service')}>
                  <option value="">{t('mq.allServices')}</option>
                  {LEAD_SERVICES.map((s) => <option key={s} value={s}>{t(`crm.sv_${s}` as 'crm.sv_visa')}</option>)}
                </Select>
              </Toolbar>

              {montres.length === 0 ? (
                <Vide title={t('mq.nothingInFilter')} hint={t('mq.nothingInFilterHint')} icon="search" />
              ) : vue === 'liste' ? (
                <Table>
                  <thead>
                    <tr>
                      <th>{t('crm.lastName')}</th>
                      <th>{t('crm.status')}</th>
                      <th className="col-optional">{t('crm.service')}</th>
                      <th className="num col-optional">{t('crm.value')}</th>
                      <th className="col-optional">{t('crm.nextAction')}</th>
                      <th className="col-optional">{t('crm.here')}</th>
                      <th className="actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {montres.map((l) => {
                      const tel = (l.phone ?? '').replace(/\s/g, '')
                      const wa = digits(l.whatsapp ?? l.phone)
                      const late = l.nextActionAt ? new Date(l.nextActionAt) < new Date() : false
                      return (
                        <tr key={l.id} className="adm-row--click" onClick={() => setOpenId(l.id)}>
                          <td>
                            <div className="adm-cell-main">
                              <span>{leadName(l)}</span>
                              {l.companyName && leadName(l) !== l.companyName && <span className="t-caption">{l.companyName}</span>}
                            </div>
                          </td>
                          <td><Pill tone={STATUS_TONE[l.status]} dot>{t(`crm.st_${l.status}` as 'crm.st_nouveau')}</Pill></td>
                          <td className="col-optional t-secondary">{t(`crm.sv_${l.serviceInterest}` as 'crm.sv_visa')}</td>
                          <td className="num col-optional">{Number(l.estimatedValue) > 0 ? formatMoney(Number(l.estimatedValue), l.currency) : <span className="t-tertiary">·</span>}</td>
                          <td className="col-optional">
                            {l.nextActionAt
                              ? <span className={late ? 't-orange' : undefined}>{formatDate(l.nextActionAt)}</span>
                              : <span className="t-tertiary">·</span>}
                          </td>
                          <td className="col-optional t-tertiary"><Ago iso={l.statusSince} /></td>
                          <td className="actions" onClick={(e) => e.stopPropagation()}>
                            {tel && <a className="btn btn--secondary btn--sm" href={`tel:${tel}`} title={t('crm.call')} aria-label={t('crm.call')}><Icon name="phone" size={14} /></a>}
                            {wa && <a className="btn btn--secondary btn--sm" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" title={t('crm.whatsappOpen')} aria-label={t('crm.whatsappOpen')}><Icon name="whatsapp" size={14} /></a>}
                            <Button size="sm" onClick={() => setOpenId(l.id)}>{t('mq.open')}</Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              ) : (
                <div className="kanban md-kanban">
                  {LEAD_STATUSES.map((status) => {
                    const column = montres.filter((l) => l.status === status)
                    const sum = column.reduce((n, l) => n + Number(l.estimatedValue ?? 0), 0)
                    const dormant = report?.by_status.find((b) => b.status === status)?.oldest_at ?? null
                    return (
                      <div
                        key={status}
                        className={`kanban__col ${over === status ? 'kanban__col--over' : ''}`}
                        onDragOver={(e) => { e.preventDefault(); setOver(status) }}
                        onDragLeave={() => setOver((s) => (s === status ? null : s))}
                        onDrop={() => { if (dragging) void move(dragging, status); setDragging(null); setOver(null) }}
                      >
                        <header className="kanban__col-head">
                          <Pill tone={STATUS_TONE[status]} dot>{t(`crm.st_${status}` as 'crm.st_nouveau')}</Pill>
                          <span className="t-caption t-tertiary t-num">{column.length}</span>
                        </header>
                        {(sum > 0 || dormant) && (
                          <div className="md-kanban__meta t-caption t-tertiary">
                            {sum > 0 && <span className="t-num">{formatMoney(sum)}</span>}
                            {dormant && status !== 'gagne' && status !== 'perdu' && <span>{t('crm.sleeping', { n: daysSince(dormant) })}</span>}
                          </div>
                        )}

                        {column.map((l) => (
                          <div
                            key={l.id}
                            role="button"
                            tabIndex={0}
                            draggable={canWrite}
                            onDragStart={() => setDragging(l.id)}
                            onDragEnd={() => setDragging(null)}
                            onClick={() => setOpenId(l.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(l.id) }
                            }}
                            className={`kanban__card ${dragging === l.id ? 'kanban__card--dragging' : ''}`}
                          >
                            <div className="row gap-2" style={{ marginBottom: 'var(--sp-2)' }}>
                              <span className="t-small t-medium grow t-truncate">{leadName(l)}</span>
                              {l.clientId && <Icon name="check" size={14} className="t-tertiary" />}
                            </div>
                            {l.companyName && leadName(l) !== l.companyName && (
                              <div className="t-caption t-tertiary t-truncate">{l.companyName}</div>
                            )}
                            <div className="row-between" style={{ marginTop: 'var(--sp-2)' }}>
                              <span className="t-caption t-tertiary">
                                {t(`crm.sv_${l.serviceInterest}` as 'crm.sv_visa')}
                              </span>
                              {Number(l.estimatedValue) > 0 && (
                                <span className="t-caption t-num t-medium">{formatMoney(Number(l.estimatedValue), l.currency)}</span>
                              )}
                            </div>
                            {l.nextActionAt && (
                              <div className="t-caption" style={{ marginTop: 'var(--sp-2)' }}>
                                <span className={new Date(l.nextActionAt) < new Date() ? 't-orange' : 't-tertiary'}>
                                  {t('crm.dueOn', { date: formatDate(l.nextActionAt) })}
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                        {column.length === 0 && <div className="md-kanban__empty t-caption t-tertiary">{t('mq.columnEmpty')}</div>}
                      </div>
                    )
                  })}
                </div>
              )}
            </Section>
          )}
        </>
      )}

      {open && (
        <LeadSheet
          lead={open}
          canWrite={canWrite}
          onClose={() => setOpenId(null)}
          onEdit={() => { setEditing(open); setOpenId(null) }}
          onChanged={reload}
        />
      )}

      {editing && (
        <LeadEditor
          lead={editing === 'nouveau' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (id) => { setEditing(null); await reload(); setOpenId(id) }}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* La fiche prospect                                                   */
/* ------------------------------------------------------------------ */

function LeadSheet({ lead, canWrite, onClose, onEdit, onChanged }: {
  lead: Lead
  canWrite: boolean
  onClose: () => void
  onEdit: () => void
  onChanged: () => Promise<void>
}) {
  const { t, formatMoney, formatDate } = useI18n()
  const toast = useToast()
  const [events, setEvents] = useState<LeadEvent[]>([])
  const [kind, setKind] = useState<LeadEventKind>('appel')
  const [body, setBody] = useState('')
  const [lostReason, setLostReason] = useState(lead.lostReason ?? '')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try { setEvents(await listLeadEvents(lead.id)) } catch { /* le journal ne bloque pas la fiche */ }
  }, [lead.id])

  useEffect(() => { void refresh() }, [refresh])

  const wa = digits(lead.whatsapp ?? lead.phone)
  const tel = (lead.phone ?? '').replace(/\s/g, '')

  const guard = async (run: () => Promise<void>) => {
    setBusy(true)
    try { await run() } catch (e) { toast(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <Modal
      title={leadName(lead)}
      wide
      onClose={onClose}
      footer={
        <>
          {canWrite && !lead.clientId && (
            <Button icon="trash" disabled={busy} onClick={() => guard(async () => {
              await archiveLead(lead.id); toast(t('crm.archived')); onClose(); await onChanged()
            })}>{t('crm.archive')}</Button>
          )}
          <span className="grow" />
          {canWrite && <Button icon="edit" onClick={onEdit}>{t('crud.edit')}</Button>}
          <Button onClick={onClose}>{t('action.close')}</Button>
        </>
      }
    >
      <div className="col gap-5">
        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          <Pill tone={STATUS_TONE[lead.status]} dot>{t(`crm.st_${lead.status}` as 'crm.st_nouveau')}</Pill>
          <Pill tone="gray">{t(`crm.sv_${lead.serviceInterest}` as 'crm.sv_visa')}</Pill>
          <Pill tone="gray">{t(`crm.so_${lead.source}` as 'crm.so_autre')}</Pill>
          {Number(lead.estimatedValue) > 0 && (
            <Pill tone="blue">{formatMoney(Number(lead.estimatedValue), lead.currency)}</Pill>
          )}
        </div>

        {lead.companyName && <p className="t-small t-secondary" style={{ margin: 0 }}>{lead.companyName}</p>}
        {lead.note && <p className="t-small t-secondary" style={{ margin: 0 }}>{lead.note}</p>}

        {/* Appeler et WhatsApp : les deux gestes de la relance, à un clic. */}
        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          {tel ? (
            <a className="btn btn--secondary btn--sm" href={`tel:${tel}`}>
              <Icon name="phone" size={16} />{t('crm.call')}
            </a>
          ) : <span className="t-caption t-tertiary">{t('crm.noPhone')}</span>}
          {wa && (
            <a className="btn btn--secondary btn--sm" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">
              <Icon name="whatsapp" size={16} />{t('crm.whatsappOpen')}
            </a>
          )}
          {lead.email && (
            <a className="btn btn--secondary btn--sm" href={`mailto:${lead.email}`}>
              <Icon name="mail" size={16} />{lead.email}
            </a>
          )}
        </div>

        <div className="grid grid--2">
          <span className="col gap-1">
            <span className="t-caption t-tertiary">{t('crm.createdOn')}</span>
            <span className="t-small">{formatDate(lead.createdAt)}</span>
          </span>
          <span className="col gap-1">
            <span className="t-caption t-tertiary">{t('crm.here')}</span>
            <span className="t-small"><Ago iso={lead.statusSince} /></span>
          </span>
          {lead.nextActionAt && (
            <span className="col gap-1">
              <span className="t-caption t-tertiary">{t('crm.nextAction')}</span>
              <span className="t-small">{formatDate(lead.nextActionAt)}</span>
            </span>
          )}
          {lead.phone && (
            <span className="col gap-1">
              <span className="t-caption t-tertiary">{t('crm.phone')}</span>
              <span className="t-small t-num">{lead.phone}</span>
            </span>
          )}
        </div>

        {/* La conversion */}
        {lead.clientId ? (
          <div className="row gap-2">
            <Pill tone="green" dot>{t('crm.alreadyClient')}</Pill>
            <Link className="btn btn--secondary btn--sm" to={`/clients/${lead.clientId}`}>{t('crm.openClient')}</Link>
          </div>
        ) : canWrite && (
          <div className="col gap-2">
            <Button
              variant="primary"
              icon="clients"
              disabled={busy || !lead.phone}
              onClick={() => guard(async () => {
                await convertLead(lead.id, lead.officeId ?? null)
                toast(t('crm.convertDone'))
                await onChanged()
                onClose()
              })}
            >
              {t('crm.convert')}
            </Button>
            <span className="t-caption t-tertiary">{lead.phone ? t('crm.convertHint') : t('crm.needPhone')}</span>
          </div>
        )}

        {/* Perdre une affaire sans dire pourquoi, c'est perdre l'information
            deux fois. Le motif est demandé ici, et il remonte aux statistiques. */}
        {canWrite && lead.status !== 'gagne' && !lead.clientId && (
          <Field label={t('crm.lostReason')} hint={t('crm.lostReasonHint')}>
            <div className="row gap-2">
              <Input value={lostReason} onChange={(e) => setLostReason(e.target.value)} />
              <Button
                variant="danger"
                disabled={busy || lostReason.trim() === ''}
                onClick={() => guard(async () => {
                  await setLeadStatus(lead.id, 'perdu', lostReason.trim())
                  toast(t('crud.updated'))
                  await onChanged()
                  onClose()
                })}
              >
                {t('crm.markLost')}
              </Button>
            </div>
          </Field>
        )}

        {/* Le journal */}
        <div className="col gap-3">
          <span className="t-small t-medium">{t('crm.journal')}</span>

          {canWrite && (
            <div className="row gap-2" style={{ alignItems: 'flex-end' }}>
              <Field label={t('crm.exchangeKind')}>
                <Select value={kind} onChange={(e) => setKind(e.target.value as LeadEventKind)}>
                  {LEAD_EVENT_KINDS.map((k) => (
                    <option key={k} value={k}>{t(`crm.ev_${k}` as 'crm.ev_note')}</option>
                  ))}
                </Select>
              </Field>
              <span className="grow">
                <Field label={t('crm.exchangeBody')}>
                  <Input value={body} onChange={(e) => setBody(e.target.value)} />
                </Field>
              </span>
              <Button
                disabled={busy || body.trim() === ''}
                onClick={() => guard(async () => {
                  await addLeadEvent(lead.id, kind, body.trim())
                  setBody('')
                  await refresh()
                })}
              >
                {t('crm.logExchange')}
              </Button>
            </div>
          )}

          {events.length === 0 ? (
            <p className="t-caption t-tertiary" style={{ margin: 0 }}>{t('crm.noEvents')}</p>
          ) : (
            <div className="col gap-2">
              {events.map((e) => (
                <div key={e.id} className="row gap-3" style={{ alignItems: 'baseline' }}>
                  <Pill tone={e.kind === 'changement_etat' ? 'violet' : 'gray'}>
                    {t(`crm.ev_${e.kind}` as 'crm.ev_note')}
                  </Pill>
                  <span className="t-small grow">{e.body}</span>
                  <span className="t-caption t-tertiary"><Ago iso={e.at} /></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Créer ou modifier                                                   */
/* ------------------------------------------------------------------ */

function LeadEditor({ lead, onClose, onSaved }: {
  lead: Lead | null
  onClose: () => void
  onSaved: (id: string) => Promise<void>
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [firstName, setFirstName] = useState(lead?.firstName ?? '')
  const [lastName, setLastName] = useState(lead?.lastName ?? '')
  const [companyName, setCompanyName] = useState(lead?.companyName ?? '')
  const [email, setEmail] = useState(lead?.email ?? '')
  const [phone, setPhone] = useState(lead?.phone ?? '')
  const [whatsapp, setWhatsapp] = useState(lead?.whatsapp ?? '')
  const [service, setService] = useState<LeadService>(lead?.serviceInterest ?? 'visa')
  const [source, setSource] = useState<LeadSource>(lead?.source ?? 'comptoir')
  const [status, setStatus] = useState<LeadStatus>(lead?.status ?? 'nouveau')
  const [value, setValue] = useState(String(lead?.estimatedValue ?? ''))
  const [nextAction, setNextAction] = useState(lead?.nextActionAt?.slice(0, 10) ?? '')
  const [note, setNote] = useState(lead?.note ?? '')
  const [busy, setBusy] = useState(false)

  // La base refuse une ligne sans nom ni société : on le dit avant l'envoi.
  const valid = lastName.trim() !== '' || companyName.trim() !== ''

  const save = async () => {
    setBusy(true)
    try {
      const draft: LeadDraft = {
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        companyName: companyName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        whatsapp: whatsapp.trim() || null,
        serviceInterest: service,
        source,
        estimatedValue: Number(value) || 0,
        note: note.trim() || null,
        nextActionAt: nextAction ? new Date(nextAction).toISOString() : null,
      }
      if (lead) {
        // L'état passe par sa propre porte : elle nettoie le motif de perte.
        if (status !== lead.status) await setLeadStatus(lead.id, status)
        await updateLead(lead.id, draft)
        toast(t('crud.updated'))
        await onSaved(lead.id)
      } else {
        const created = await createLead({ ...draft, status })
        toast(t('crud.created'))
        await onSaved(created.id)
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={lead ? t('crm.editLead') : t('crm.newLead')}
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={() => void save()}>
            {t('action.confirm')}
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label={t('crm.firstName')}>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label={t('crm.lastName')}>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <span className="grid__wide">
          <Field label={t('crm.company')}>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </Field>
        </span>
        <Field label={t('crm.phone')}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+216 …" />
        </Field>
        <Field label={t('crm.whatsapp')}>
          <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
        </Field>
        <Field label={t('crm.email')}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('crm.service')}>
          <Select value={service} onChange={(e) => setService(e.target.value as LeadService)}>
            {LEAD_SERVICES.map((s) => (
              <option key={s} value={s}>{t(`crm.sv_${s}` as 'crm.sv_visa')}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('crm.source')}>
          <Select value={source} onChange={(e) => setSource(e.target.value as LeadSource)}>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>{t(`crm.so_${s}` as 'crm.so_autre')}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('crm.status')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)}>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>{t(`crm.st_${s}` as 'crm.st_nouveau')}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('crm.value')}>
          <Input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label={t('crm.nextAction')} hint={t('crm.nextActionHint')}>
          <Input type="date" value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
        </Field>
        <span className="grid__wide">
          <Field label={t('crm.note')}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </span>
      </div>
    </Modal>
  )
}
