import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button, Field, Input, Modal, Pill, Textarea, useToast } from '@/components/ui'
import { usePlateforme } from './contexte'
import {
  Erreur, Etat, Kpi, KpiGrid, Ligne, PageHeader, Section, Squelette, Table, Vide,
  dateHeure, depuis, money, nb, useChargement,
} from './kit'
import '@/styles/admin-agences.css'

/**
 * Les demandes de souscription : la porte d'entrée.
 *
 * Une agence ne s'inscrit pas toute seule : elle demande, on qualifie, on
 * crée, on facture (voir 0042). Cet écran est le premier d'une journée. Une
 * demande qui dort est un client perdu, d'où le pipeline en tête : on voit
 * d'un coup d'œil où ça bloque.
 */

export type StatutDemande = 'nouvelle' | 'contactee' | 'devis_envoye' | 'convertie' | 'ecartee'
const STATUTS: StatutDemande[] = ['nouvelle', 'contactee', 'devis_envoye', 'convertie', 'ecartee']
const LIBELLE_STATUT: Record<StatutDemande, string> = {
  nouvelle: 'Nouvelle', contactee: 'Contactée', devis_envoye: 'Devis envoyé', convertie: 'Convertie', ecartee: 'Écartée',
}

/** Une ligne de `platform_signups`, telle que 0042 la rend. */
export interface Signup {
  id: string
  agency_name: string; country: string; city: string | null; services: string[]
  contact_name: string; phone: string; email: string | null
  team_size: number | null; monthly_cases: number | null; current_tool: string | null; note: string | null; locale: string
  status: StatutDemande; received_at: string
  quoted_users: number | null; quoted_amount: number | null; quoted_currency: string | null; refusal_reason: string | null
  agency_id: string | null; agency_slug: string | null
  /** L'estimation calculée en base sur la grille : socle Active + ajouts pour
   *  `team_size` comptes et un bureau, en TND, hors taxes. Jamais recalculée ici. */
  suggested_year: number | null
  suggested_month: number | null
  suggested_plan: string | null
}

const TRENTE_JOURS = 30 * 86400 * 1000

/** Le nom d'une formule dans la console. Le code seul se lit mal dans un tableau. */
const FORMULE: Record<string, string> = { essai: 'Essai', active: 'Active', premium: 'Premium' }
const formule = (code: string | null) => (code ? (FORMULE[code] ?? code) : '·')

export async function chargerDemandes(): Promise<Signup[]> {
  if (!supabase) throw new Error('La console n’existe qu’avec un backend.')
  const { data, error } = await supabase.rpc('platform_signups', {})
  if (error) throw new Error(error.message)
  return (data as Signup[] | null) ?? []
}

async function avancer(id: string, status: StatutDemande, extra: { users?: number | null; amount?: number | null; motif?: string | null } = {}) {
  if (!supabase) throw new Error('backend absent')
  const { error } = await supabase.rpc('platform_signup_update', {
    p_signup: id, p_status: status,
    p_quoted_users: extra.users ?? null, p_quoted_amount: extra.amount ?? null, p_refusal_reason: extra.motif ?? null,
  })
  if (error) throw new Error(error.message)
}

const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`

export function Demandes() {
  const { can, rafraichirCompteurs } = usePlateforme()
  const toast = useToast()
  const [params] = useSearchParams()
  const cible = params.get('id')
  const { data, loading, refreshing, error, reload } = useChargement(chargerDemandes)
  const demandes = data ?? []

  const [filtre, setFiltre] = useState<StatutDemande | null>(null)
  const [devis, setDevis] = useState<Signup | null>(null)
  const [ecart, setEcart] = useState<Signup | null>(null)
  const [detail, setDetail] = useState<Signup | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const traiter = can('demandes.traiter')
  const comptes = useMemo(() => {
    const c: Record<StatutDemande, number> = { nouvelle: 0, contactee: 0, devis_envoye: 0, convertie: 0, ecartee: 0 }
    for (const d of demandes) c[d.status] += 1
    return c
  }, [demandes])
  // Faute d'une date de traitement dans la liste, « sur 30 jours » se lit sur
  // la date de réception : une demande convertie reçue il y a moins d'un mois.
  const converties30j = demandes.filter((d) => d.status === 'convertie' && Date.now() - new Date(d.received_at).getTime() < TRENTE_JOURS).length
  const visibles = filtre ? demandes.filter((d) => d.status === filtre) : demandes

  // Venant du cockpit : on surligne la ligne visée et on y descend.
  useEffect(() => {
    if (!cible || loading) return
    const el = document.getElementById(`demande-${cible}`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [cible, loading])

  const apresGeste = (message: string) => { toast(message); void reload(); rafraichirCompteurs() }

  const marquerContactee = async (d: Signup) => {
    setBusy(d.id)
    try { await avancer(d.id, 'contactee'); apresGeste(`${d.agency_name} marquée contactée.`) }
    catch (e) { toast(e instanceof Error ? e.message : 'Mise à jour impossible.') }
    finally { setBusy(null) }
  }

  const copierLien = async () => {
    const lien = `${window.location.origin}${import.meta.env.BASE_URL}souscrire`
    try { await navigator.clipboard.writeText(lien); toast('Lien public copié.') }
    catch { toast(`Presse-papiers indisponible : ${lien}`) }
  }

  return (
    <>
      <PageHeader
        kicker="Parc"
        title="Demandes de souscription"
        subtitle="La porte d’entrée : une demande qui dort est un client perdu."
        refreshing={refreshing}
        actions={<Button icon="copy" onClick={() => void copierLien()}>Copier le lien public</Button>}
      />

      {error && !data && <Erreur message={error} onRetry={() => void reload()} />}

      {loading ? <Squelette type="kpis" n={4} /> : (
        <KpiGrid>
          <Kpi label="Nouvelles" value={nb(comptes.nouvelle)} tone={comptes.nouvelle > 0 ? 'blue' : 'gray'} icon="bell" hint="À rappeler" />
          <Kpi label="Contactées" value={nb(comptes.contactee)} icon="phone" />
          <Kpi label="Devis envoyés" value={nb(comptes.devis_envoye)} tone={comptes.devis_envoye > 0 ? 'orange' : 'gray'} icon="mail" />
          <Kpi label="Converties" value={nb(converties30j)} tone="green" hint="Sur 30 jours" icon="check" />
        </KpiGrid>
      )}

      <div className="ag-pipeline" role="group" aria-label="Filtrer par étape">
        {STATUTS.map((s) => (
          <button key={s} type="button" className={`ag-etape ag-etape--${s}`} aria-pressed={filtre === s} onClick={() => setFiltre(filtre === s ? null : s)}>
            <span className="ag-etape__label">{LIBELLE_STATUT[s]}</span>
            <span className="ag-etape__n t-num">{loading ? '…' : nb(comptes[s])}</span>
          </button>
        ))}
      </div>

      <Section flush title={filtre ? `${LIBELLE_STATUT[filtre]} · ${nb(visibles.length)}` : `Toutes · ${nb(demandes.length)}`}
        action={filtre && <Button size="sm" icon="close" onClick={() => setFiltre(null)}>Toutes</Button>}>
        {loading ? <Squelette type="table" n={5} /> : visibles.length === 0 ? (
          <Vide title="Aucune demande." hint="Partagez le lien public : c’est la porte d’entrée des agences."
            action={<Button icon="copy" onClick={() => void copierLien()}>Copier le lien public</Button>} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Agence</th><th>Contact</th><th className="num">Équipe</th><th className="num">Dossiers / mois</th>
                <th className="num">Estimation par an</th><th>Reçue</th><th>État</th><th className="actions" />
              </tr>
            </thead>
            <tbody>
              {visibles.map((d) => {
                const finie = d.status === 'convertie' || d.status === 'ecartee'
                return (
                  <tr key={d.id} id={`demande-${d.id}`} className={`${d.id === cible ? 'ag-row--cible' : ''} ${d.status === 'ecartee' ? 'adm-row--off' : ''}`}>
                    <td>
                      <div className="adm-cell-main">
                        <button type="button" className="linkish" style={{ textAlign: 'start' }} onClick={() => setDetail(d)}>{d.agency_name}</button>
                        <span className="t-caption">{[d.city, d.country].filter(Boolean).join(', ')}</span>
                        {d.current_tool && <span className="t-caption">Aujourd’hui : {d.current_tool}</span>}
                      </div>
                    </td>
                    <td>
                      <div className="adm-cell-main">
                        <span>{d.contact_name}</span>
                        <span className="t-caption t-mono">{d.phone}</span>
                        {d.email && <span className="t-caption t-mono">{d.email}</span>}
                      </div>
                    </td>
                    <td className="num">{nb(d.team_size)}</td>
                    <td className="num">{nb(d.monthly_cases)}</td>
                    <td className="num">
                      <div className="adm-cell-main" style={{ alignItems: 'flex-end' }}>
                        <span>{money(d.suggested_year)}</span>
                        <span className="t-caption">{d.suggested_month !== null ? `${formule(d.suggested_plan)} · ${money(d.suggested_month)} par mois` : 'socle Active + ajouts, HT'}</span>
                      </div>
                    </td>
                    <td className="t-tertiary" title={dateHeure(d.received_at)}>{depuis(d.received_at)}</td>
                    <td>
                      <div className="adm-cell-main">
                        <Etat etat={d.status} dot />
                        {d.status === 'convertie' && d.agency_id && <Link to={`/admin/agences/${d.agency_id}`} className="t-caption t-mono">{d.agency_slug ?? 'fiche'}</Link>}
                      </div>
                    </td>
                    <td className="actions">
                      <span className="row gap-2" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <a className="btn btn--secondary btn--sm" href={tel(d.phone)}>Appeler</a>
                        {d.email && <a className="btn btn--secondary btn--sm" href={`mailto:${d.email}`}>Écrire</a>}
                        {traiter && d.status === 'nouvelle' && <Button size="sm" icon="phone" disabled={busy === d.id} onClick={() => void marquerContactee(d)}>Marquer contactée</Button>}
                        {traiter && (d.status === 'nouvelle' || d.status === 'contactee') && <Button size="sm" icon="mail" onClick={() => setDevis(d)}>Devis envoyé</Button>}
                        {traiter && !finie && <Button size="sm" icon="close" onClick={() => setEcart(d)}>Écarter</Button>}
                        {traiter && d.status !== 'convertie' && can('agences.ouvrir') && (
                          <Link to={`/admin/agences/nouvelle?demande=${d.id}`} className="btn btn--primary btn--sm">Créer l’agence</Link>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Section>

      {devis && <FormeDevis demande={devis} onClose={() => setDevis(null)} onDone={(m) => { setDevis(null); apresGeste(m) }} />}
      {ecart && <FormeEcart demande={ecart} onClose={() => setEcart(null)} onDone={(m) => { setEcart(null); apresGeste(m) }} />}
      {detail && <Details demande={detail} onClose={() => setDetail(null)} />}
    </>
  )
}

/* ------------------------------ Le devis ------------------------------ */

function FormeDevis({ demande, onClose, onDone }: { demande: Signup; onClose: () => void; onDone: (m: string) => void }) {
  const [users, setUsers] = useState(String(demande.quoted_users ?? demande.team_size ?? ''))
  const nUsers = Number(users)
  // Le montant proposé est l'estimation de la base (socle Active + ajouts
  // pour l'équipe déclarée, un bureau, HT). On ne la recalcule pas ici : si le
  // nombre de comptes change, le devis se corrige à la main, et la vraie
  // ligne de facture naîtra de l'abonnement posé sur l'agence.
  const [montant, setMontant] = useState(demande.quoted_amount !== null ? String(demande.quoted_amount) : '')
  const [montantTouche, setMontantTouche] = useState(demande.quoted_amount !== null)
  const propose = demande.suggested_year !== null && demande.suggested_year > 0 ? demande.suggested_year : null
  const montantEffectif = montantTouche ? Number(montant) : (propose ?? NaN)
  const valide = Number.isFinite(nUsers) && nUsers > 0 && Number.isFinite(montantEffectif) && montantEffectif > 0
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  return (
    <Modal title={`Devis envoyé · ${demande.agency_name}`} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant="primary" disabled={busy || !valide} onClick={async () => {
        setBusy(true); setErreur(null)
        try { await avancer(demande.id, 'devis_envoye', { users: nUsers, amount: montantEffectif }); onDone('Devis consigné.') }
        catch (e) { setBusy(false); setErreur(e instanceof Error ? e.message : 'Mise à jour impossible.') }
      }}>Consigner le devis</Button>
    </>}>
      <div className="col gap-4">
        <p className="t-caption t-tertiary" style={{ margin: 0 }}>
          Ce qu’on a proposé, pour ne pas le rechercher dans ses messages. La facture porte des unités (licence, bureaux, comptes × 12 mois) : c’est ce que la circulaire BCT 2016-09 exige.
        </p>
        <div className="grid grid--2" style={{ gap: 'var(--sp-3)' }}>
          <Field label="Utilisateurs" hint={demande.team_size ? `L’agence a déclaré ${nb(demande.team_size)} personnes.` : undefined}>
            <Input type="number" min="1" step="1" value={users} autoFocus onChange={(e) => setUsers(e.target.value)} />
          </Field>
          <Field label="Montant par an (TND, HT)" hint={propose !== null ? `Estimation : ${formule(demande.suggested_plan)}, ${money(demande.suggested_month)} par mois, soit ${money(propose)} par an pour ${nb(demande.team_size)} comptes et un bureau.` : undefined}>
            <Input type="number" min="0" step="0.001" value={montantTouche ? montant : (propose !== null ? String(propose) : '')}
              onChange={(e) => { setMontant(e.target.value); setMontantTouche(true) }} />
          </Field>
        </div>
        {erreur && <p className="t-small" style={{ color: 'var(--red)', margin: 0 }}>{erreur}</p>}
      </div>
    </Modal>
  )
}

/* ------------------------------ L'écart ------------------------------ */

function FormeEcart({ demande, onClose, onDone }: { demande: Signup; onClose: () => void; onDone: (m: string) => void }) {
  const [motif, setMotif] = useState(demande.refusal_reason ?? '')
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  return (
    <Modal title={`Écarter · ${demande.agency_name}`} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant="danger" disabled={busy || motif.trim().length < 3} onClick={async () => {
        setBusy(true); setErreur(null)
        try { await avancer(demande.id, 'ecartee', { motif: motif.trim() }); onDone('Demande écartée.') }
        catch (e) { setBusy(false); setErreur(e instanceof Error ? e.message : 'Mise à jour impossible.') }
      }}>Écarter</Button>
    </>}>
      <div className="col gap-4">
        <Field label="Motif" hint="Pour la personne qui relira ce dossier dans six mois. Une demande écartée reste consultable.">
          <Textarea rows={3} value={motif} autoFocus onChange={(e) => setMotif(e.target.value)} placeholder="Hors zone, déjà équipée, pas de budget…" />
        </Field>
        {erreur && <p className="t-small" style={{ color: 'var(--red)', margin: 0 }}>{erreur}</p>}
      </div>
    </Modal>
  )
}

/* ------------------------------ Les détails ------------------------------ */

const LANGUES: Record<string, string> = { fr: 'Français', en: 'Anglais', ar: 'Arabe', zh: 'Chinois' }

function Details({ demande: d, onClose }: { demande: Signup; onClose: () => void }) {
  return (
    <Modal title={d.agency_name} onClose={onClose} wide footer={<>
      <a className="btn btn--secondary" href={tel(d.phone)}>Appeler</a>
      {d.email && <a className="btn btn--secondary" href={`mailto:${d.email}`}>Écrire</a>}
      <Button variant="primary" onClick={onClose}>Fermer</Button>
    </>}>
      <div className="col gap-5">
        <div className="row gap-2 wrap">
          <Etat etat={d.status} dot />
          {d.services.map((s) => <Pill key={s} tone="blue">{s}</Pill>)}
          <Pill tone="gray">{LANGUES[d.locale] ?? d.locale}</Pill>
        </div>

        <div className="ag-detail">
          <div className="ag-detail__bloc">
            <span className="t-caption">Contact</span>
            <span className="t-medium">{d.contact_name}</span>
            <span className="t-mono t-small">{d.phone}</span>
            {d.email && <span className="t-mono t-small">{d.email}</span>}
          </div>
          <div className="ag-detail__bloc">
            <span className="t-caption">Agence</span>
            <span>{[d.city, d.country].filter(Boolean).join(', ') || '·'}</span>
            <span className="t-small">Équipe : {nb(d.team_size)} · Dossiers / mois : {nb(d.monthly_cases)}</span>
            {d.current_tool && <span className="t-small">Outil actuel : {d.current_tool}</span>}
          </div>
        </div>

        {d.note && (
          <div className="col gap-2">
            <span className="t-caption t-tertiary">Note laissée par l’agence</span>
            <p className="ag-note">{d.note}</p>
          </div>
        )}

        <div>
          <span className="t-caption t-tertiary">Historique</span>
          <Ligne label="Reçue le">{dateHeure(d.received_at)}</Ligne>
          <Ligne label="Estimation">{formule(d.suggested_plan)} · {money(d.suggested_month)} par mois · {money(d.suggested_year)} par an, socle Active + ajouts, HT</Ligne>
          {(d.quoted_users !== null || d.quoted_amount !== null) && (
            <Ligne label="Devis">{nb(d.quoted_users)} utilisateurs · {money(d.quoted_amount, d.quoted_currency ?? 'TND')} par an</Ligne>
          )}
          {d.refusal_reason && <Ligne label="Motif d’écart">{d.refusal_reason}</Ligne>}
          {d.agency_id && (
            <Ligne label="Agence née de la demande">
              <Link to={`/admin/agences/${d.agency_id}`} className="t-mono">{d.agency_slug ?? 'fiche'}</Link>
            </Ligne>
          )}
        </div>
      </div>
    </Modal>
  )
}
