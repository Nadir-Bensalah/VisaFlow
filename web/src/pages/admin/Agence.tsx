import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/data/store'
import { deleteAgence, loadAgence360 } from '@/data/plateforme'
import type { Agence360, AuditAction, AuditRow } from '@/data/plateforme'
import { reactivateAgency, recordPayment } from '@/data/facturation'
import type { PaymentMethod } from '@/data/facturation'
import { Button, Field, Input, Modal, Pill, Select, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import type { Role } from '@/data/types'
import { usePlateforme } from './contexte'
import {
  Confirmer, Erreur, Etat, Kpi, KpiGrid, Ligne, PageHeader, Section, Sparkline, Squelette, Table, Vide,
  dateFr, delai, depuis, money, nb, octets, useChargement,
} from './kit'
import '@/styles/admin-agences.css'

/**
 * LA FICHE 360 D'UNE AGENCE.
 *
 * Une seule requête, `platform_agency_360`, rend tout : l'accès, l'abonnement,
 * les bureaux, les comptes, les compteurs, les règlements, les tickets et le
 * journal. Chaque geste de la page recharge cette requête sans vider l'écran.
 *
 * Les gestes qui touchent un bureau ou un compte passent par les fonctions
 * qui existaient déjà (`platform_save_office`, `platform_set_member`). Elles
 * demandent des champs que la vue 360 ne porte pas (l'adresse d'un bureau,
 * le bureau d'un compte) : on les relit alors dans `platform_agency_detail`,
 * au moment du geste seulement.
 */

const ROLE_LABEL: Record<Role, string> = { owner: 'Propriétaire', manager: 'Manager', agent: 'Agent', viewer: 'Lecteur' }
const ROLES = Object.keys(ROLE_LABEL) as Role[]

const METHODES: { value: PaymentMethod; label: string }[] = [
  { value: 'virement', label: 'Virement' }, { value: 'cheque', label: 'Chèque' },
  { value: 'especes', label: 'Espèces' }, { value: 'carte', label: 'Carte' }, { value: 'autre', label: 'Autre' },
]

/** Le geste du journal, dit en français. Chaque action du contrat a sa phrase. */
export const LIBELLES: Record<AuditAction, string> = {
  'agence.ouverte': 'Agence ouverte',
  'agence.suspendue': 'Accès suspendu',
  'agence.reactivee': 'Accès réactivé',
  'agence.supprimee': 'Agence supprimée',
  'agence.entree_support': 'Entrée en vue support',
  'agence.modifiee': 'Coordonnées modifiées',
  'bureau.enregistre': 'Bureau enregistré',
  'membre.modifie': 'Compte modifié',
  'demande.mise_a_jour': 'Demande mise à jour',
  'demande.convertie': 'Demande convertie en agence',
  'abonnement.modifie': 'Abonnement modifié',
  'commission.modifiee': 'Commission modifiée',
  'reglement.enregistre': 'Règlement constaté',
  'factures.generees': 'Factures générées',
  'grace.rouverte': 'Rouverte sans encaisser',
  'ticket.repondu': 'Ticket répondu',
  'ticket.statut': 'Statut du ticket changé',
  'retour.traite': 'Retour traité',
  'annonce.enregistree': 'Annonce enregistrée',
  'annonce.publiee': 'Annonce publiée',
  'admin.invite': 'Admin invité',
  'admin.role': 'Rôle d’admin changé',
  'admin.actif': 'Admin activé ou désactivé',
  'admin.retire': 'Admin retiré',
  'tache.lancee': 'Tâche lancée à la main',
}

const ETAT_ACCES: Record<Agence360['acces']['etat'], { label: string; tone: 'blue' | 'orange' | 'green' | 'red' }> = {
  essai: { label: 'Essai', tone: 'blue' }, grace: { label: 'Délai de grâce', tone: 'orange' },
  a_jour: { label: 'À jour', tone: 'green' }, suspendue: { label: 'Suspendue', tone: 'red' },
}

/** La commission, lisible. Les types viennent de la base : on ne les invente pas. */
export function commissionLisible(kind: string, amount: number): string {
  switch (kind) {
    case 'gratuit': return 'Gratuit'
    case 'mensuel': return `${money(amount)} par mois`
    case 'pourcentage': return `${nb(amount)} %`
    case 'par_utilisateur': return `${money(amount)} par utilisateur et par mois`
    case 'forfait': return `${money(amount)} forfait`
    case 'par_dossier': return `${money(amount)} par dossier`
    default: return `${money(amount)} · ${kind}`
  }
}

const PERIODE: Record<string, string> = { mensuel: 'Mensuel', annuel: 'Annuel', monthly: 'Mensuel', yearly: 'Annuel' }

/* Ce que `platform_agency_detail` rend, pour les gestes qui ont besoin de
   plus que la vue 360. */
interface DetailBureau { id: string; name: string; city: string | null; country: string; phone: string | null; address: string | null; active: boolean }
interface DetailMembre { id: string; office_id: string; role: string; active: boolean }
interface Detail { offices: DetailBureau[]; team: DetailMembre[] }

async function chargerDetail(agencyId: string): Promise<Detail> {
  if (!supabase) throw new Error('backend absent')
  const { data, error } = await supabase.rpc('platform_agency_detail', { p_agency: agencyId })
  if (error) throw new Error(error.message)
  const d = data as Partial<Detail> | null
  return { offices: d?.offices ?? [], team: d?.team ?? [] }
}

export function Agence() {
  const { id = '' } = useParams()
  const { can, rafraichirCompteurs } = usePlateforme()
  const navigate = useNavigate()
  const toast = useToast()
  const { enterSupport } = useStore()
  const { data, loading, refreshing, error, reload } = useChargement(() => loadAgence360(id), [id])

  // Le détail (adresses des bureaux, bureau de chaque compte) ne se relit
  // qu'au moment d'un geste, et s'oublie à chaque rechargement de la fiche.
  const detailRef = useRef<Detail | null>(null)
  useEffect(() => { detailRef.current = null }, [data])
  const detail = async () => {
    if (!detailRef.current) detailRef.current = await chargerDetail(id)
    return detailRef.current
  }

  const [confirmation, setConfirmation] = useState<'suspendre' | 'reactiver' | 'supprimer' | 'rouvrir' | null>(null)
  const [busy, setBusy] = useState(false)
  const [reglement, setReglement] = useState(false)
  const [commission, setCommission] = useState(false)
  const [bureau, setBureau] = useState<DetailBureau | 'nouveau' | null>(null)
  const [membreBusy, setMembreBusy] = useState<string | null>(null)

  const apresGeste = (message: string) => { toast(message); void reload(); rafraichirCompteurs() }

  const entrer = async () => {
    if (!supabase) return
    const { error: e } = await supabase.rpc('platform_open_agency', { p_agency: id })
    if (e) { toast('Accès refusé : ' + e.message); return }
    enterSupport(id)
    navigate('/')
  }

  const changerEtat = async (etat: 'suspendue' | 'active') => {
    if (!supabase) return
    setBusy(true)
    const { error: e } = await supabase.rpc('platform_set_agency_state', { p_agency: id, p_state: etat })
    setBusy(false)
    if (e) { toast(e.message); return }
    setConfirmation(null)
    apresGeste(etat === 'suspendue' ? 'Accès suspendu.' : 'Accès réactivé.')
  }

  const supprimer = async () => {
    if (!data) return
    setBusy(true)
    try {
      await deleteAgence(id, data.agence.name)
      toast(`${data.agence.name} est supprimée.`)
      rafraichirCompteurs()
      navigate('/admin/agences')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Suppression impossible.')
    } finally { setBusy(false) }
  }

  const rouvrir = async () => {
    setBusy(true)
    try {
      const r = await reactivateAgency(id)
      setConfirmation(null)
      apresGeste(`Rouverte en délai de grâce jusqu’au ${dateFr(r.grace_ends_on)}.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Réouverture impossible.')
    } finally { setBusy(false) }
  }

  const setMembre = async (m: Agence360['membres'][number], patch: { role?: string; active?: boolean }) => {
    if (!supabase) return
    setMembreBusy(m.id)
    try {
      const d = await detail()
      const courant = d.team.find((x) => x.id === m.id)
      if (!courant) throw new Error('Compte introuvable.')
      const { error: e } = await supabase.rpc('platform_set_member', {
        p_profile: m.id, p_office: courant.office_id, p_role: patch.role ?? m.role, p_active: patch.active ?? m.active,
      })
      if (e) throw new Error(e.message)
      apresGeste(patch.active === false ? 'Compte désactivé.' : patch.active === true ? 'Compte réactivé.' : 'Rôle modifié.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Modification impossible.')
    } finally { setMembreBusy(null) }
  }

  const ouvrirBureau = async (b: Agence360['bureaux'][number] | 'nouveau') => {
    if (b === 'nouveau') { setBureau('nouveau'); return }
    try {
      const d = await detail()
      const complet = d.offices.find((o) => o.id === b.id)
      setBureau(complet ?? { id: b.id, name: b.name, city: b.city, country: data?.agence.country ?? 'Tunisie', phone: null, address: null, active: b.active })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Bureau introuvable.')
    }
  }

  /* ------------------------------ Rendu ------------------------------ */

  if (loading) {
    return (
      <>
        {/* Le titre arrive avec la fiche : un squelette à sa place, pas un mot d'attente. */}
        <div className="adm-page__head"><div className="adm-page__titles"><span className="adm-kicker">Agence</span><span className="adm-skel" style={{ height: 30, width: 260 }} /></div></div>
        <Squelette type="kpis" n={6} />
        <Squelette type="cartes" n={4} />
      </>
    )
  }
  if (error || !data) {
    return (
      <>
        <PageHeader kicker="Agence" title="Agence introuvable" />
        <Erreur message={error ?? 'Cette agence n’existe pas, ou n’est plus accessible.'} onRetry={() => void reload()} />
        <p style={{ marginTop: 'var(--sp-4)' }}><Link to="/admin/agences" className="btn btn--secondary">Retour aux agences</Link></p>
      </>
    )
  }

  const { agence, acces, abonnement, bureaux, membres, compteurs, reglements, tickets, journal, activite_30j } = data
  const suspendue = agence.suspended_at !== null
  const impaye = ['suspendue', 'resiliee', 'impayee'].includes(abonnement.billing_state ?? '')
  const etatAcces = ETAT_ACCES[acces.etat]
  const points = activite_30j.map((p) => p.n)
  const totalActivite = points.reduce((s, n) => s + n, 0)
  const lieu = [agence.city, agence.country].filter(Boolean).join(', ')

  return (
    <>
      <PageHeader
        kicker="Agence"
        title={agence.name}
        subtitle={<><span className="t-mono">{agence.slug}.visaflow.app</span> · {lieu} · ouverte le {dateFr(agence.created_at)}</>}
        refreshing={refreshing}
        actions={<>
          {can('agences.entrer') && !suspendue && <Button icon="eye" onClick={() => void entrer()}>Entrer dans l’agence</Button>}
          {can('agences.suspendre') && (suspendue
            ? <Button icon="check" onClick={() => setConfirmation('reactiver')}>Réactiver l’accès</Button>
            : <Button icon="lock" onClick={() => setConfirmation('suspendre')}>Suspendre</Button>)}
          {can('agences.supprimer') && <MenuPlus items={[{ label: 'Supprimer l’agence', icon: 'trash', danger: true, onClick: () => setConfirmation('supprimer') }]} />}
        </>}
      />

      {(acces.etat === 'grace' || acces.etat === 'suspendue') && (
        <div className={`ag-bandeau ${acces.etat === 'grace' ? 'ag-bandeau--orange' : 'ag-bandeau--rouge'}`} role="status">
          <Icon name="alert" size={16} />
          <span className="ag-bandeau__texte">
            {acces.etat === 'grace'
              ? (acces.jours_restants !== null ? `Délai de grâce, coupure ${delai(acces.jours_restants)}` : `Délai de grâce jusqu’au ${dateFr(acces.grace_ends_on)}`)
              : impaye
                ? `Suspendue pour impayé depuis le ${dateFr(agence.suspended_at ?? acces.grace_ends_on)}`
                : `Accès suspendu depuis le ${dateFr(agence.suspended_at)}`}
          </span>
          <span className="ag-bandeau__gestes">
            {can('facturation.encaisser') && <Button size="sm" icon="payments" onClick={() => setReglement(true)}>Constater un règlement</Button>}
            {can('facturation.reactiver') && <Button size="sm" icon="refresh" onClick={() => setConfirmation('rouvrir')}>Rouvrir sans encaisser</Button>}
          </span>
        </div>
      )}

      <KpiGrid>
        <Kpi label="Abonnement" value={abonnement.mensuel !== null ? `${money(abonnement.mensuel)} / mois` : '·'} tone={etatAcces.tone}
          hint={`${etatAcces.label} · ${delai(acces.jours_restants)}`} to={`/admin/abonnements?agence=${id}`} icon="payments" />
        <Kpi label="Clients" value={nb(compteurs.clients)} icon="clients" />
        <Kpi label="Dossiers ouverts" value={nb(compteurs.cases_open)} hint={`${nb(compteurs.cases_total)} au total`} icon="cases" />
        <Kpi label="Cargaisons en cours" value={nb(compteurs.shipments_open)} icon="ship" />
        <Kpi label="Comptes" value={nb(membres.filter((m) => m.active).length)} hint={`${nb(compteurs.connexions_7j)} connexions sur 7 j`} icon="clients" />
        <Kpi label="Stockage" value={octets(compteurs.storage_bytes)} hint={`${nb(compteurs.documents)} documents`} icon="documents" />
      </KpiGrid>

      <div className="ag-grille">
        <div>
          <Section title="Activité sur 30 jours" action={<span className="t-caption t-tertiary">{nb(totalActivite)} gestes</span>}>
            {points.length < 2 ? <Vide title="Pas encore d’activité." /> : (
              <div className="ag-courbe">
                <Sparkline points={points} height={80} width={300} fill tone={totalActivite === 0 ? 'gray' : 'blue'} />
                <div className="ag-courbe__legende">
                  <span>{dateFr(activite_30j[0].day)}</span><span>{dateFr(activite_30j[activite_30j.length - 1].day)}</span>
                </div>
              </div>
            )}
          </Section>

          <Section title="Bureaux" flush action={can('agences.modifier') && <Button size="sm" icon="plus" onClick={() => void ouvrirBureau('nouveau')}>Ajouter un bureau</Button>}>
            {bureaux.length === 0 ? <Vide title="Aucun bureau." hint="Une agence sans bureau ne peut ouvrir aucun compte." /> : (
              <Table>
                <thead><tr><th>Bureau</th><th>Ville</th><th className="num">Membres</th><th>État</th><th className="actions" /></tr></thead>
                <tbody>
                  {bureaux.map((b) => (
                    <tr key={b.id} className={b.active ? '' : 'adm-row--off'}>
                      <td className="t-medium">{b.name}</td>
                      <td>{b.city ?? '·'}</td>
                      <td className="num">{nb(b.members)}</td>
                      <td>{b.active ? <Pill tone="green" dot>Actif</Pill> : <Pill tone="gray">Fermé</Pill>}</td>
                      <td className="actions">{can('agences.modifier') && <Button size="sm" icon="edit" onClick={() => void ouvrirBureau(b)}>Modifier</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Section>

          <Section title="Comptes" flush>
            {membres.length === 0 ? <Vide title="Personne n’a encore de compte." hint="Le propriétaire invite ensuite son équipe lui-même." /> : (
              <Table>
                <thead><tr><th>Compte</th><th>Rôle</th><th>Bureau</th><th>Dernière connexion</th><th>État</th><th className="actions" /></tr></thead>
                <tbody>
                  {membres.map((m) => (
                    <tr key={m.id} className={m.active ? '' : 'adm-row--off'}>
                      <td><div className="adm-cell-main"><span>{m.name}</span><span className="t-caption t-mono">{m.email}</span></div></td>
                      <td>
                        {can('agences.modifier')
                          ? <Select value={m.role} disabled={membreBusy === m.id} aria-label="Rôle" style={{ minHeight: 30 }} onChange={(e) => void setMembre(m, { role: e.target.value })}>
                              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                              {!ROLES.includes(m.role as Role) && <option value={m.role}>{m.role}</option>}
                            </Select>
                          : <Pill tone="blue">{ROLE_LABEL[m.role as Role] ?? m.role}</Pill>}
                      </td>
                      <td>{m.office_name ?? '·'}</td>
                      <td className="t-tertiary" title={m.last_sign_in_at ? dateFr(m.last_sign_in_at) : 'Jamais'}>{m.last_sign_in_at ? depuis(m.last_sign_in_at) : 'jamais'}</td>
                      <td>{m.active ? <Pill tone="green" dot>Actif</Pill> : <Pill tone="gray">Inactif</Pill>}</td>
                      <td className="actions">
                        {can('agences.modifier') && (m.active
                          ? <Button size="sm" icon="lock" disabled={membreBusy === m.id} onClick={() => void setMembre(m, { active: false })}>Désactiver</Button>
                          : <Button size="sm" icon="check" disabled={membreBusy === m.id} onClick={() => void setMembre(m, { active: true })}>Réactiver</Button>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {can('agences.modifier') && membres.length > 0 && (
              <p className="t-caption t-tertiary" style={{ padding: 'var(--sp-3) var(--sp-4)', margin: 0 }}>
                Un rôle changé s’applique au prochain rafraîchissement du jeton de la personne, au plus tard dans l’heure.
              </p>
            )}
          </Section>

          <Section title="Règlements" flush action={can('facturation.encaisser') && <Button size="sm" icon="payments" onClick={() => setReglement(true)}>Constater un règlement</Button>}>
            {reglements.length === 0 ? <Vide title="Aucun règlement constaté." /> : (
              <Table>
                <thead><tr><th>Date</th><th className="num">Montant</th><th>Moyen</th><th>Référence</th><th>Période</th><th>Par</th></tr></thead>
                <tbody>
                  {reglements.slice(0, 10).map((r) => (
                    <tr key={r.id}>
                      <td>{dateFr(r.paid_on)}</td>
                      <td className="num t-medium">{money(r.amount, r.currency)}</td>
                      <td>{METHODES.find((m) => m.value === r.method)?.label ?? r.method}</td>
                      <td className="t-mono t-caption">{r.reference ?? '·'}</td>
                      <td className="t-caption">{r.period_start || r.period_end ? `${dateFr(r.period_start)} → ${dateFr(r.period_end)}` : '·'}</td>
                      <td className="t-caption t-tertiary">{r.recorded_by_email ?? '·'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Section>
        </div>

        <div>
          <Section title="Abonnement" action={<Link to={`/admin/abonnements?agence=${id}`} className="btn btn--secondary btn--sm">Modifier l’abonnement</Link>}>
            <Ligne label="Formule">{abonnement.plan_name ?? agence.plan}</Ligne>
            <Ligne label="État"><Etat etat={abonnement.billing_state ?? acces.etat} dot /></Ligne>
            <Ligne label="Sièges">{nb(abonnement.seats)}</Ligne>
            <Ligne label="Prix par siège et par mois">{money(abonnement.price_per_user_month, abonnement.currency ?? 'TND')}</Ligne>
            <Ligne label="Période">{abonnement.billing_period ? (PERIODE[abonnement.billing_period] ?? abonnement.billing_period) : '·'}</Ligne>
            <Ligne label="Début">{dateFr(abonnement.started_on)}</Ligne>
            <Ligne label="Fin d’essai">{dateFr(abonnement.trial_ends_on ?? acces.trial_ends_on)}</Ligne>
            <Ligne label="Fin de grâce">{dateFr(abonnement.grace_ends_on ?? acces.grace_ends_on)}</Ligne>
            <Ligne label="Prochaine échéance">{dateFr(abonnement.renewal_on ?? acces.renewal_on)}</Ligne>
            <Ligne label="Dernier règlement">{dateFr(abonnement.last_payment_on)}</Ligne>
          </Section>

          <Section title="Facturation">
            <Ligne label="Commission">
              <span className="row gap-2" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <span>{commissionLisible(agence.commission_kind, agence.commission_amount)}</span>
                {can('abonnements.modifier') && <Button size="sm" icon="edit" onClick={() => setCommission(true)}>Modifier</Button>}
              </span>
            </Ligne>
            {agence.work_mode && <Ligne label="Mode de travail">{agence.work_mode}</Ligne>}
            {agence.email && <Ligne label="E-mail" mono>{agence.email}</Ligne>}
            {agence.phone && <Ligne label="Téléphone" mono>{agence.phone}</Ligne>}
          </Section>

          <Section title="Assistance" action={<Link to={`/admin/assistance?agence=${id}`} className="t-caption">Tout voir</Link>}>
            {tickets.length === 0 ? <p className="t-small t-tertiary" style={{ margin: 0 }}>Aucun ticket ouvert.</p> : (
              <div className="ag-tickets">
                {tickets.map((t) => (
                  <Link key={t.id} to={`/admin/assistance?ticket=${t.id}`} className="ag-ticket">
                    <Pill tone={t.priority === 'urgente' ? 'red' : t.priority === 'haute' ? 'orange' : 'gray'}>{t.priority}</Pill>
                    <span className="ag-ticket__sujet">{t.subject}</span>
                    <span className="ag-ticket__quand">{depuis(t.created_at)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Section>

          <Section title="Journal de l’agence" action={<Link to={`/admin/journal?agence=${id}`} className="t-caption">Tout voir</Link>}>
            {journal.length === 0 ? <p className="t-small t-tertiary" style={{ margin: 0 }}>Aucun geste consigné.</p> : (
              <div className="ag-journal">
                {journal.slice(0, 15).map((j) => <JournalItem key={j.id} row={j} />)}
              </div>
            )}
          </Section>
        </div>
      </div>

      {confirmation === 'suspendre' && (
        <Confirmer title={`Suspendre ${agence.name}`} motCle={agence.name} danger label="Suspendre" busy={busy}
          onConfirm={() => void changerEtat('suspendue')} onClose={() => setConfirmation(null)}>
          Plus personne ne pourra entrer dans l’agence, ni lire ni écrire. Rien n’est effacé : la réactivation rend tout tel quel.
        </Confirmer>
      )}
      {confirmation === 'reactiver' && (
        <Confirmer title={`Réactiver ${agence.name}`} label="Réactiver" busy={busy}
          onConfirm={() => void changerEtat('active')} onClose={() => setConfirmation(null)}>
          L’agence retrouve son accès immédiatement, avec tous ses dossiers.
        </Confirmer>
      )}
      {confirmation === 'supprimer' && (
        <Confirmer title={`Supprimer ${agence.name}`} motCle={agence.name} danger label="Supprimer l’agence" busy={busy}
          onConfirm={() => void supprimer()} onClose={() => setConfirmation(null)}>
          L’agence disparaît de la console et son accès est coupé. C’est un marquage : rien n’est effacé de la base, un dossier de visa ne se perd pas par accident.
        </Confirmer>
      )}
      {confirmation === 'rouvrir' && (
        <Confirmer title="Rouvrir sans encaisser" label="Rouvrir" busy={busy}
          onConfirm={() => void rouvrir()} onClose={() => setConfirmation(null)}>
          L’agence repart en délai de grâce, pas à jour : rien n’a été encaissé. Si le virement n’arrive pas, elle sera suspendue de nouveau dans sept jours.
        </Confirmer>
      )}

      {reglement && (
        <FormeReglement agencyId={id} nom={agence.name} devise={abonnement.currency ?? 'TND'}
          annuel={abonnement.billing_period === 'annuel' || abonnement.billing_period === 'yearly'}
          attendu={abonnement.mensuel !== null ? (abonnement.billing_period === 'annuel' || abonnement.billing_period === 'yearly' ? abonnement.mensuel * 12 : abonnement.mensuel) : null}
          onClose={() => setReglement(false)}
          onDone={(m) => { setReglement(false); apresGeste(m) }} />
      )}
      {commission && (
        <FormeCommission agencyId={id} nom={agence.name} kind={agence.commission_kind} amount={agence.commission_amount}
          onClose={() => setCommission(false)} onDone={() => { setCommission(false); apresGeste('Commission mise à jour.') }} />
      )}
      {bureau && (
        <OfficeForm agencyId={id} office={bureau === 'nouveau' ? null : bureau} country={agence.country}
          onClose={() => setBureau(null)} onDone={(m) => { setBureau(null); apresGeste(m) }} />
      )}
    </>
  )
}

/* ------------------------------ Le journal ------------------------------ */

function JournalItem({ row }: { row: AuditRow }) {
  const qui = row.admin_name ?? row.admin_email ?? 'Système'
  return (
    <div className="ag-journal__item">
      <span className="ag-journal__geste">
        <span>{LIBELLES[row.action] ?? row.action}{row.target_label ? ` · ${row.target_label}` : ''}</span>
        <span className="t-caption">{qui}</span>
      </span>
      <span className="ag-journal__quand" title={dateFr(row.at)}>{depuis(row.at)}</span>
    </div>
  )
}

/* ------------------------------ Le menu « … » ------------------------------ */

function MenuPlus({ items }: { items: { label: string; icon?: 'trash' | 'edit' | 'lock'; danger?: boolean; onClick: () => void }[] }) {
  const [ouvert, setOuvert] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ouvert) return
    const ferme = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOuvert(false) }
    const touche = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(false) }
    document.addEventListener('mousedown', ferme); window.addEventListener('keydown', touche)
    return () => { document.removeEventListener('mousedown', ferme); window.removeEventListener('keydown', touche) }
  }, [ouvert])
  return (
    <div className="ag-menu" ref={ref}>
      <Button icon="dots" aria-label="Autres gestes" aria-haspopup="menu" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)} />
      {ouvert && (
        <ul className="ag-menu__liste" role="menu">
          {items.map((it) => (
            <li key={it.label} role="none">
              <button type="button" role="menuitem" className={it.danger ? 'ag-menu__danger' : ''} onClick={() => { setOuvert(false); it.onClick() }}>
                {it.icon && <Icon name={it.icon} size={15} />}{it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* --------------------------- Constater un règlement --------------------------- */

const jourIso = (d: Date) => d.toISOString().slice(0, 10)

/** Le même formulaire que l'écran Facturation, posé sur la fiche : un
    virement constaté, jamais un prélèvement. Le montant est saisi, pas calculé. */
export function FormeReglement({ agencyId, nom, devise, annuel, attendu, onClose, onDone }: {
  agencyId: string; nom: string; devise: string; annuel: boolean; attendu: number | null
  onClose: () => void; onDone: (message: string) => void
}) {
  const [montant, setMontant] = useState(attendu !== null ? String(attendu) : '')
  const [methode, setMethode] = useState<PaymentMethod>('virement')
  const [reference, setReference] = useState('')
  const [debut, setDebut] = useState(jourIso(new Date()))
  const [fin, setFin] = useState(() => {
    const d = new Date()
    if (annuel) d.setFullYear(d.getFullYear() + 1); else d.setMonth(d.getMonth() + 1)
    d.setDate(d.getDate() - 1)
    return jourIso(d)
  })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const n = Number(montant)
  const valide = Number.isFinite(n) && n > 0 && fin >= debut

  return (
    <Modal title={`Règlement · ${nom}`} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant="primary" disabled={busy || !valide} onClick={async () => {
        setBusy(true); setErreur(null)
        try {
          const out = await recordPayment({
            agencyId, amount: n, currency: devise || 'TND', periodStart: debut, periodEnd: fin,
            method: methode, reference: reference.trim() || null, note: note.trim() || null,
          })
          onDone(out.reactivee ? 'Règlement enregistré. L’agence est rouverte.' : 'Règlement enregistré.')
        } catch (e) {
          setBusy(false)
          setErreur(e instanceof Error ? e.message : 'Enregistrement impossible.')
        }
      }}>Enregistrer le règlement</Button>
    </>}>
      <div className="col gap-4">
        <p className="t-caption t-tertiary" style={{ margin: 0 }}>
          Ce geste constate un virement déjà reçu. Il ne prélève rien : il remet l’agence à jour, repousse son échéance et rouvre son accès si elle était suspendue.
        </p>
        <Field label={`Montant (${devise || 'TND'})`} hint={attendu !== null ? `Attendu : ${money(attendu, devise || 'TND')} ${annuel ? 'pour l’année' : 'pour le mois'}` : undefined}>
          <Input type="number" min="0" step="0.001" value={montant} onChange={(e) => setMontant(e.target.value)} autoFocus />
        </Field>
        <Field label="Moyen">
          <Select value={methode} onChange={(e) => setMethode(e.target.value as PaymentMethod)}>
            {METHODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Référence" hint="La référence du virement. Elle ne s’enregistre qu’une fois : c’est ce qui empêche de saisir deux fois le même règlement.">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="VIR-2026-0142" />
        </Field>
        <div className="grid grid--2" style={{ gap: 'var(--sp-3)' }}>
          <Field label="Période du"><Input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} /></Field>
          <Field label="au" error={fin < debut ? 'La période finit avant de commencer.' : undefined}><Input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></Field>
        </div>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reçu sur le compte le 12 septembre." /></Field>
        {erreur && <p className="t-small" style={{ color: 'var(--red)', margin: 0 }}>{erreur}</p>}
      </div>
    </Modal>
  )
}

/* ------------------------------ La commission ------------------------------ */

const TYPES_COMMISSION: { value: string; label: string }[] = [
  { value: 'par_utilisateur', label: 'Par utilisateur et par mois' },
  { value: 'par_dossier', label: 'Par dossier' },
  { value: 'mensuel', label: 'Mensuelle' },
  { value: 'pourcentage', label: 'Pourcentage' },
  { value: 'gratuit', label: 'Gratuit' },
]

function FormeCommission({ agencyId, nom, kind, amount, onClose, onDone }: {
  agencyId: string; nom: string; kind: string; amount: number; onClose: () => void; onDone: () => void
}) {
  const [type, setType] = useState(kind)
  const [montant, setMontant] = useState(String(amount))
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const n = type === 'gratuit' ? 0 : Number(montant)
  const valide = type === 'gratuit' || (Number.isFinite(n) && n >= 0)
  return (
    <Modal title={`Commission · ${nom}`} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant="primary" disabled={busy || !valide} onClick={async () => {
        if (!supabase) return
        setBusy(true); setErreur(null)
        const { error } = await supabase.rpc('platform_set_commission', { p_agency: agencyId, p_kind: type, p_amount: n })
        setBusy(false)
        if (error) { setErreur(error.message); return }
        onDone()
      }}>Enregistrer</Button>
    </>}>
      <div className="col gap-4">
        <div className="grid grid--2" style={{ gap: 'var(--sp-3)' }}>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES_COMMISSION.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              {!TYPES_COMMISSION.some((t) => t.value === kind) && <option value={kind}>{kind}</option>}
            </Select>
          </Field>
          <Field label={type === 'pourcentage' ? 'Taux (%)' : 'Montant (TND)'}>
            <Input type="number" min="0" step="0.01" value={type === 'gratuit' ? '0' : montant} disabled={type === 'gratuit'} onChange={(e) => setMontant(e.target.value)} />
          </Field>
        </div>
        <p className="t-caption t-tertiary" style={{ margin: 0 }}>
          La grille doit être par unité d’œuvre, jamais un forfait sec : l’article 3 de la circulaire BCT 2016-09 fait refuser le transfert d’un forfait sans unité quantifiable.
        </p>
        {erreur && <p className="t-small" style={{ color: 'var(--red)', margin: 0 }}>{erreur}</p>}
      </div>
    </Modal>
  )
}

/* ------------------------------ Un bureau ------------------------------ */

const PAYS_BUREAU = ['Tunisie', 'Libye', 'Chine']

/** Créer ou modifier un bureau. Repris tel quel de l'ancienne fiche : la
    fonction `platform_save_office` décide du fuseau et du code pays. */
function OfficeForm({ agencyId, office, country, onClose, onDone }: {
  agencyId: string; office: DetailBureau | null; country: string; onClose: () => void; onDone: (message: string) => void
}) {
  const [f, setF] = useState({
    name: office?.name ?? '', city: office?.city ?? '', country: office?.country ?? country,
    phone: office?.phone ?? '', address: office?.address ?? '', active: office?.active ?? true,
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  return (
    <Modal title={office ? `Bureau · ${office.name}` : 'Nouveau bureau'} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant="primary" disabled={busy || !f.name.trim()} onClick={async () => {
        if (!supabase) return
        setBusy(true); setErreur(null)
        const { error } = await supabase.rpc('platform_save_office', {
          p_agency: agencyId, p_office: office?.id ?? null, p_name: f.name.trim(), p_city: f.city.trim() || null,
          p_country: f.country, p_phone: f.phone.trim() || null, p_address: f.address.trim() || null, p_active: f.active,
        })
        setBusy(false)
        if (error) { setErreur(error.message); return }
        onDone(office ? 'Bureau enregistré.' : 'Bureau créé.')
      }}>Enregistrer</Button>
    </>}>
      <div className="col gap-4">
        <div className="grid grid--2" style={{ gap: 'var(--sp-3)' }}>
          <Field label="Nom du bureau"><Input value={f.name} autoFocus onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Ville"><Input value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
          <Field label="Pays">
            <Select value={f.country} onChange={(e) => set('country', e.target.value)}>
              {PAYS_BUREAU.map((p) => <option key={p} value={p}>{p}</option>)}
              {!PAYS_BUREAU.includes(f.country) && <option value={f.country}>{f.country}</option>}
            </Select>
          </Field>
          <Field label="Téléphone"><Input type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        </div>
        <Field label="Adresse"><Input value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
        {office && (
          <Field label="État">
            <Select value={f.active ? 'actif' : 'ferme'} onChange={(e) => set('active', e.target.value === 'actif')}>
              <option value="actif">Actif</option><option value="ferme">Fermé</option>
            </Select>
          </Field>
        )}
        {erreur && <p className="t-small" style={{ color: 'var(--red)', margin: 0 }}>{erreur}</p>}
      </div>
    </Modal>
  )
}
