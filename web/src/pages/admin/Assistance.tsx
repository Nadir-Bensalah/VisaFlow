import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Field, Input, Modal, Pill, Segmented, Select, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import {
  Barre, Erreur, Etat, Gravite, Kpi, KpiGrid, PageHeader, Section, Squelette, Table, Vide,
  dateHeure, depuis, nb, useChargement,
} from './kit'
import { usePlateforme } from './contexte'
import {
  FEEDBACK_STATUSES, TICKET_PRIORITIES, TICKET_STATUSES,
  handlePlatformFeedback, loadPlatformFeedback, loadPlatformTickets, platformReply, platformSetTicketStatus,
} from '@/data/support'
import type {
  FeedbackKind, FeedbackStatus, PlatformFeedback, PlatformTicket, TicketPriority, TicketStatus,
} from '@/data/support'
import type { Severite } from '@/data/plateforme'
import type { Tone } from '@/lib/derive'

/**
 * L'ASSISTANCE. Les tickets des agences et leurs retours sur le produit.
 *
 * Ce que cet écran NE MONTRE PAS, et c'est le point : les données de l'agence.
 * Un ticket porte une question et un fil, pas un client, pas un dossier, pas un
 * montant. Pour regarder la donnée, on ouvre la fiche de l'agence, puis
 * l'agence elle-même en vue support : cette entrée-là est journalisée.
 *
 * L'ordre de la file vient du serveur (l'urgent d'abord, puis le plus vieux
 * sans réponse). On filtre ici, on ne re-trie pas : re-trier ferait diverger
 * l'écran de ce que la base considère comme prioritaire.
 */

const RAFRAICHIR_MS = 60_000
const JOUR_MS = 86400 * 1000

const PRIO_LABEL: Record<TicketPriority, string> = { basse: 'Basse', normale: 'Normale', haute: 'Haute', urgente: 'Urgente' }
const PRIO_TONE: Record<TicketPriority, Tone> = { basse: 'gray', normale: 'gray', haute: 'orange', urgente: 'red' }
const PRIO_GRAVITE: Record<TicketPriority, Severite> = { basse: 'info', normale: 'info', haute: 'attention', urgente: 'critique' }
const STATUT_LABEL: Record<TicketStatus, string> = {
  ouvert: 'Ouvert', pris_en_charge: 'Pris en charge', en_attente_client: 'Attente client', resolu: 'Résolu', ferme: 'Fermé',
}
const CAT_LABEL: Record<string, string> = {
  question: 'Question', anomalie: 'Anomalie', demande: 'Demande', facturation: 'Facturation', urgence: 'Urgence',
}
const KIND_LABEL: Record<FeedbackKind, string> = { idee: 'Idée', gene: 'Gêne', compliment: 'Compliment', autre: 'Autre' }
const KIND_TONE: Record<FeedbackKind, Tone> = { idee: 'blue', gene: 'orange', compliment: 'green', autre: 'gray' }
const RETOUR_LABEL: Record<FeedbackStatus, string> = { nouveau: 'Nouveau', lu: 'Lu', planifie: 'Planifié', fait: 'Fait', ecarte: 'Écarté' }
const RETOUR_TONE: Record<FeedbackStatus, Tone> = { nouveau: 'blue', lu: 'gray', planifie: 'violet', fait: 'green', ecarte: 'gray' }

/* Un ticket « ouvert » au sens du KPI : tout ce qui n'est ni résolu ni fermé. */
const ACTIFS: TicketStatus[] = ['ouvert', 'pris_en_charge', 'en_attente_client']

type FiltreStatut = 'actifs' | 'tous' | TicketStatus
type FiltrePrio = 'toutes' | TicketPriority
type FiltreRetour = 'tous' | FeedbackStatus
type Zone = 'tickets' | 'retours'

interface Donnees { tickets: PlatformTicket[]; retours: PlatformFeedback[] }

async function charger(): Promise<Donnees> {
  const [tickets, retours] = await Promise.all([loadPlatformTickets(null), loadPlatformFeedback(null)])
  return { tickets, retours }
}

/* Le refus du serveur, tel quel : les fonctions de data/support.ts lèvent des Error. */
const message = (e: unknown, repli: string) => (e instanceof Error && e.message ? e.message : repli)

/* Sans réponse : la dernière parole est celle de l'agence (ou il n'y a que
   l'ouverture, qui vient d'elle), et cela dure depuis plus d'un jour. */
const sansReponse24h = (t: PlatformTicket, maintenant: number) =>
  ACTIFS.includes(t.status) && t.last_kind !== 'plateforme' && maintenant - new Date(t.updated_at).getTime() > JOUR_MS

export function Assistance() {
  const toast = useToast()
  const { can, rafraichirCompteurs } = usePlateforme()
  const [params, setParams] = useSearchParams()
  const { data, loading, refreshing, error, reload } = useChargement(charger)

  const repondre = can('assistance.repondre')
  const [zone, setZone] = useState<Zone>('tickets')
  const [statut, setStatut] = useState<FiltreStatut>('actifs')
  const [prio, setPrio] = useState<FiltrePrio>('toutes')
  const [recherche, setRecherche] = useState('')
  const [filtreRetour, setFiltreRetour] = useState<FiltreRetour>('tous')
  const [retourOuvert, setRetourOuvert] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /* Le ticket ouvert vit dans l'URL : le cockpit envoie /admin/assistance?ticket=<uuid>,
     et un rechargement de page rouvre le même fil. */
  const ticketId = params.get('ticket')
  const ouvrirTicket = (id: string | null) => {
    const p = new URLSearchParams(params)
    if (id) p.set('ticket', id); else p.delete('ticket')
    setParams(p, { replace: true })
  }

  /* Toutes les 60 s, sans vider l'écran : useChargement garde les données. */
  useEffect(() => {
    const id = window.setInterval(() => void reload(), RAFRAICHIR_MS)
    return () => window.clearInterval(id)
  }, [reload])

  const tickets = data?.tickets ?? []
  const retours = data?.retours ?? []

  /* Un lien vers un ticket qui n'existe pas (ou plus) : on le dit, on ne laisse pas une URL muette. */
  useEffect(() => {
    if (!data || !ticketId) return
    if (!tickets.some((t) => t.id === ticketId)) { toast('Ce ticket n’existe pas ou plus.'); ouvrirTicket(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ticketId])

  const kpis = useMemo(() => {
    const maintenant = Date.now()
    const actifs = tickets.filter((t) => ACTIFS.includes(t.status))
    const notes = tickets.filter((t) => t.satisfaction !== null)
    return {
      ouverts: actifs.length,
      urgents: actifs.filter((t) => t.priority === 'urgente').length,
      sansReponse: tickets.filter((t) => sansReponse24h(t, maintenant)).length,
      resolus30j: tickets.filter((t) => t.resolved_at && maintenant - new Date(t.resolved_at).getTime() < 30 * JOUR_MS).length,
      satisfaction: notes.length ? notes.reduce((s, t) => s + (t.satisfaction ?? 0), 0) / notes.length : null,
      avis: notes.length,
    }
  }, [tickets])

  const q = recherche.trim().toLowerCase()
  const ticketsVus = tickets.filter((t) =>
    (statut === 'tous' ? true : statut === 'actifs' ? ACTIFS.includes(t.status) : t.status === statut)
    && (prio === 'toutes' || t.priority === prio)
    && (!q || t.subject.toLowerCase().includes(q) || t.agency_name.toLowerCase().includes(q) || t.agency_slug.toLowerCase().includes(q)))

  const retoursVus = retours.filter((r) => filtreRetour === 'tous' || r.status === filtreRetour)

  const ticket = ticketId ? tickets.find((t) => t.id === ticketId) ?? null : null
  const retour = retourOuvert ? retours.find((r) => r.id === retourOuvert) ?? null : null

  /* Un geste qui aboutit : le toast, puis les données et la barre latérale. */
  const apres = async (texte: string) => {
    toast(texte)
    await reload()
    rafraichirCompteurs()
  }

  const envoyerReponse = async (id: string, corps: string) => {
    setBusy(true)
    try { await platformReply(id, corps); await apres('Réponse envoyée.') }
    catch (e) { toast(message(e, 'Envoi impossible.')) } finally { setBusy(false) }
  }

  const changerStatut = async (id: string, s: TicketStatus) => {
    setBusy(true)
    try { await platformSetTicketStatus(id, s); await apres(`Ticket ${STATUT_LABEL[s].toLowerCase()}.`) }
    catch (e) { toast(message(e, 'Changement d’état impossible.')) } finally { setBusy(false) }
  }

  const traiterRetour = async (id: string, s: FeedbackStatus, reponse: string) => {
    setBusy(true)
    try {
      await handlePlatformFeedback(id, s, reponse.trim() || null)
      await apres(`Retour marqué « ${RETOUR_LABEL[s].toLowerCase()} ».`)
      setRetourOuvert(null)
    } catch (e) { toast(message(e, 'Traitement impossible.')) } finally { setBusy(false) }
  }

  const nouveauxRetours = retours.filter((r) => r.status === 'nouveau').length

  return (
    <>
      <PageHeader
        kicker="Relation"
        title="Assistance"
        subtitle="Les tickets des agences et leurs retours sur le produit."
        refreshing={refreshing}
        actions={<Button icon="refresh" disabled={refreshing} onClick={() => void reload()}>Actualiser</Button>}
      />

      {error && !data && <Erreur message={error} onRetry={() => void reload()} />}

      {loading ? <Squelette type="kpis" n={5} /> : (
        <KpiGrid>
          <Kpi label="Ouverts" value={nb(kpis.ouverts)} icon="messages" tone="blue" hint="ni résolus ni fermés" />
          <Kpi label="Urgents" value={nb(kpis.urgents)} icon="alert" tone={kpis.urgents ? 'red' : 'gray'} />
          <Kpi label="Sans réponse depuis 24 h" value={nb(kpis.sansReponse)} icon="clock" tone={kpis.sansReponse ? 'orange' : 'gray'} hint="l’agence a parlé en dernier" />
          <Kpi label="Résolus sur 30 j" value={nb(kpis.resolus30j)} icon="check" tone="green" />
          {kpis.satisfaction !== null && (
            <Kpi label="Satisfaction" value={`${kpis.satisfaction.toFixed(1).replace('.', ',')} / 5`} icon="star" hint={`${nb(kpis.avis)} avis`} />
          )}
        </KpiGrid>
      )}

      <div style={{ marginBottom: 'var(--sp-4)' }}>
        <Segmented<Zone>
          value={zone}
          onChange={setZone}
          label="Zone"
          options={[
            { value: 'tickets', label: `Tickets${kpis.ouverts ? ` · ${kpis.ouverts}` : ''}` },
            { value: 'retours', label: `Retours produit${nouveauxRetours ? ` · ${nouveauxRetours}` : ''}` },
          ]}
        />
      </div>

      {zone === 'tickets' && (
        <Section flush>
          <Barre right={<Input type="search" placeholder="Sujet ou agence" aria-label="Rechercher" value={recherche} onChange={(e) => setRecherche(e.target.value)} />}>
            <Select value={statut} aria-label="État" onChange={(e) => setStatut(e.target.value as FiltreStatut)}>
              <option value="actifs">À traiter</option>
              {TICKET_STATUSES.map((s) => <option key={s} value={s}>{STATUT_LABEL[s]}</option>)}
              <option value="tous">Tous</option>
            </Select>
            <Select value={prio} aria-label="Priorité" onChange={(e) => setPrio(e.target.value as FiltrePrio)}>
              <option value="toutes">Toute priorité</option>
              {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{PRIO_LABEL[p]}</option>)}
            </Select>
          </Barre>
          {loading ? <Squelette type="table" n={6} /> : ticketsVus.length === 0 ? (
            <Vide title={tickets.length === 0 ? 'Aucun ticket.' : 'Rien ne correspond à ce filtre.'} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th aria-label="Gravité" /><th>Sujet</th><th>Catégorie</th><th>État</th>
                  <th className="num">Messages</th><th>Dernier</th><th className="actions" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {ticketsVus.map((t) => (
                  <tr key={t.id} className="adm-row--click" onClick={() => ouvrirTicket(t.id)}>
                    <td style={{ width: 24 }}><Gravite niveau={PRIO_GRAVITE[t.priority]} /></td>
                    <td>
                      <div className="adm-cell-main">
                        <span>{t.subject}</span>
                        <span className="t-caption">
                          <Link to={`/admin/agences/${t.agency_id}`} onClick={(e) => e.stopPropagation()}>{t.agency_name}</Link>
                          {' · '}{PRIO_LABEL[t.priority].toLowerCase()}
                        </span>
                      </div>
                    </td>
                    <td className="t-caption t-secondary">{CAT_LABEL[t.category] ?? t.category}</td>
                    <td><Etat etat={t.status} dot /></td>
                    <td className="num">{nb(t.messages)}</td>
                    <td className="t-caption t-tertiary" style={{ whiteSpace: 'nowrap' }}>
                      {t.last_kind === 'agence' && <span title="L’agence a parlé en dernier">↩ </span>}{depuis(t.updated_at)}
                    </td>
                    <td className="actions">
                      <Button size="sm" icon="messages" onClick={(e) => { e.stopPropagation(); ouvrirTicket(t.id) }}>Ouvrir</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      )}

      {zone === 'retours' && (
        <Section flush>
          <Barre>
            <Select value={filtreRetour} aria-label="État" onChange={(e) => setFiltreRetour(e.target.value as FiltreRetour)}>
              <option value="tous">Tous les retours</option>
              {FEEDBACK_STATUSES.map((s) => <option key={s} value={s}>{RETOUR_LABEL[s]}</option>)}
            </Select>
          </Barre>
          {loading ? <Squelette type="table" n={5} /> : retoursVus.length === 0 ? (
            <Vide title={retours.length === 0 ? 'Aucun retour.' : 'Rien ne correspond à ce filtre.'} hint="Les agences envoient leurs idées et leurs gênes depuis le bouton « Un retour » de leur espace." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Nature</th><th>Message</th><th>Agence</th><th className="num">Votes</th><th>État</th><th>Reçu</th>
                  <th className="actions" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {retoursVus.map((r) => (
                  <tr key={r.id} className="adm-row--click" onClick={() => setRetourOuvert(r.id)}>
                    <td><Pill tone={KIND_TONE[r.kind]}>{KIND_LABEL[r.kind]}</Pill></td>
                    <td>
                      <div className="adm-cell-main" style={{ maxWidth: 420 }}>
                        <span style={{ fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.message}</span>
                        {r.page && <span className="t-caption t-mono">{r.page}</span>}
                      </div>
                    </td>
                    <td className="t-small">
                      <Link to={`/admin/agences/${r.agency_id}`} onClick={(e) => e.stopPropagation()}>{r.agency_name}</Link>
                    </td>
                    <td className="num">{nb(r.votes)}</td>
                    <td><Pill tone={RETOUR_TONE[r.status]} dot>{RETOUR_LABEL[r.status]}</Pill></td>
                    <td className="t-caption t-tertiary" style={{ whiteSpace: 'nowrap' }}>{depuis(r.created_at)}</td>
                    <td className="actions">
                      <Button size="sm" icon="edit" onClick={(e) => { e.stopPropagation(); setRetourOuvert(r.id) }}>{repondre ? 'Traiter' : 'Voir'}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      )}

      {ticket && (
        <FilTicket
          ticket={ticket}
          peutRepondre={repondre}
          busy={busy}
          onRepondre={(corps) => void envoyerReponse(ticket.id, corps)}
          onStatut={(s) => void changerStatut(ticket.id, s)}
          onClose={() => ouvrirTicket(null)}
        />
      )}

      {retour && (
        <PanneauRetour
          retour={retour}
          peutTraiter={repondre}
          busy={busy}
          onTraiter={(s, reponse) => void traiterRetour(retour.id, s, reponse)}
          onClose={() => setRetourOuvert(null)}
        />
      )}
    </>
  )
}

/* ------------------------------ Le fil ------------------------------- */

function FilTicket({ ticket, peutRepondre, busy, onRepondre, onStatut, onClose }: {
  ticket: PlatformTicket; peutRepondre: boolean; busy: boolean
  onRepondre: (corps: string) => void; onStatut: (s: TicketStatus) => void; onClose: () => void
}) {
  const [brouillon, setBrouillon] = useState('')
  /* Le brouillon repart à zéro quand la réponse est partie : le fil s'allonge, on le voit. */
  useEffect(() => { setBrouillon('') }, [ticket.messages])

  const envoyer = () => { if (brouillon.trim()) onRepondre(brouillon.trim()) }

  return (
    <Modal
      title={ticket.subject}
      onClose={onClose}
      wide
      footer={<>
        <Link to={`/admin/agences/${ticket.agency_id}`} className="btn btn--ghost"><Icon name="building" size={16} />Fiche de l’agence</Link>
        <span className="grow" />
        <Button onClick={onClose}>Fermer</Button>
        {peutRepondre && ticket.status !== 'ferme' && (
          <Button variant="primary" icon="mail" disabled={busy || !brouillon.trim()} onClick={envoyer}>{busy ? 'Envoi…' : 'Répondre'}</Button>
        )}
      </>}
    >
      <div className="col gap-4">
        <div className="row gap-2 wrap">
          <Pill tone={PRIO_TONE[ticket.priority]}>{PRIO_LABEL[ticket.priority]}</Pill>
          <Etat etat={ticket.status} dot />
          <span className="t-caption t-tertiary">{CAT_LABEL[ticket.category] ?? ticket.category} · {ticket.agency_name} · ouvert le {dateHeure(ticket.created_at)}</span>
          <span className="grow" />
          {peutRepondre && (
            <Select value={ticket.status} disabled={busy} aria-label="État du ticket" onChange={(e) => onStatut(e.target.value as TicketStatus)}>
              {TICKET_STATUSES.map((s) => <option key={s} value={s}>{STATUT_LABEL[s]}</option>)}
            </Select>
          )}
        </div>

        <div className="col gap-3">
          {ticket.thread.map((m) => {
            const nous = m.author_kind === 'plateforme'
            return (
              <div
                key={m.id}
                className="col gap-1"
                style={{
                  padding: 'var(--sp-3) var(--sp-4)',
                  borderRadius: 'var(--radius-card-sm)',
                  background: nous ? 'var(--tint-blue)' : 'var(--bg-sunken)',
                  marginInlineStart: nous ? 'var(--sp-8)' : 0,
                  marginInlineEnd: nous ? 0 : 'var(--sp-8)',
                  minWidth: 0,
                }}
              >
                <span className="row gap-2">
                  <Icon name={nous ? 'shield' : 'building'} size={14} />
                  <span className="t-caption t-medium">{nous ? 'Nous' : ticket.agency_name}</span>
                  <span className="grow" />
                  <span className="t-caption t-tertiary" style={{ whiteSpace: 'nowrap' }}>{dateHeure(m.at)}</span>
                </span>
                <span className="t-small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</span>
              </div>
            )
          })}
        </div>

        {ticket.satisfaction !== null && (
          <p className="t-caption t-tertiary" style={{ margin: 0 }}>L’agence a noté cette assistance {ticket.satisfaction} / 5.</p>
        )}

        {peutRepondre && ticket.status !== 'ferme' && (
          <Field label="Votre réponse" hint="L’agence la lit dans son espace. Votre nom n’y apparaît pas : elle voit « la plateforme ».">
            <Textarea rows={4} value={brouillon} disabled={busy} onChange={(e) => setBrouillon(e.target.value)} />
          </Field>
        )}

        <p className="t-caption t-tertiary" style={{ margin: 0 }}>
          Ce fil ne donne accès à aucune donnée de l’agence. Pour regarder un dossier, ouvrez l’agence en vue support depuis sa fiche : l’accès y est journalisé.
        </p>
      </div>
    </Modal>
  )
}

/* ---------------------------- Un retour ------------------------------ */

function PanneauRetour({ retour, peutTraiter, busy, onTraiter, onClose }: {
  retour: PlatformFeedback; peutTraiter: boolean; busy: boolean
  onTraiter: (s: FeedbackStatus, reponse: string) => void; onClose: () => void
}) {
  const [reponse, setReponse] = useState(retour.response ?? '')
  const etats: { s: FeedbackStatus; icon: 'eye' | 'today' | 'check' | 'close' }[] = [
    { s: 'lu', icon: 'eye' }, { s: 'planifie', icon: 'today' }, { s: 'fait', icon: 'check' }, { s: 'ecarte', icon: 'close' },
  ]

  return (
    <Modal
      title={`${KIND_LABEL[retour.kind]} de ${retour.agency_name}`}
      onClose={onClose}
      footer={<>
        <Link to={`/admin/agences/${retour.agency_id}`} className="btn btn--ghost"><Icon name="building" size={16} />Fiche de l’agence</Link>
        <span className="grow" />
        <Button onClick={onClose}>Fermer</Button>
      </>}
    >
      <div className="col gap-4">
        <div className="row gap-2 wrap">
          <Pill tone={KIND_TONE[retour.kind]}>{KIND_LABEL[retour.kind]}</Pill>
          <Pill tone={RETOUR_TONE[retour.status]} dot>{RETOUR_LABEL[retour.status]}</Pill>
          <span className="t-caption t-tertiary">{nb(retour.votes)} vote(s) · reçu le {dateHeure(retour.created_at)}{retour.page ? ` · page ${retour.page}` : ''}</span>
        </div>
        <p className="t-small" style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: 'var(--sp-3) var(--sp-4)', background: 'var(--bg-sunken)', borderRadius: 'var(--radius-card-sm)' }}>
          {retour.message}
        </p>
        {peutTraiter ? (
          <>
            <Field label="Réponse" hint="Facultative. Toutes les agences la lisent sur le tableau des idées, sans savoir qui a écrit le retour.">
              <Textarea rows={3} value={reponse} disabled={busy} onChange={(e) => setReponse(e.target.value)} />
            </Field>
            <div className="row gap-2 wrap">
              <span className="t-caption t-tertiary">Marquer</span>
              {etats.map(({ s, icon }) => (
                <Button key={s} size="sm" icon={icon} disabled={busy || (retour.status === s && (retour.response ?? '') === reponse.trim())} onClick={() => onTraiter(s, reponse)}>
                  {RETOUR_LABEL[s]}
                </Button>
              ))}
            </div>
          </>
        ) : retour.response ? (
          <Field label="Réponse de la plateforme"><p className="t-small" style={{ margin: 0 }}>{retour.response}</p></Field>
        ) : null}
        {retour.handled_at && <p className="t-caption t-tertiary" style={{ margin: 0 }}>Traité le {dateHeure(retour.handled_at)}.</p>}
      </div>
    </Modal>
  )
}
