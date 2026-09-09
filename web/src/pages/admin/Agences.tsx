import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/data/store'
import { Button, Input, Pill, Segmented, Select, useToast } from '@/components/ui'
import type { UsageNiveau } from '@/data/usage'
import { usePlateforme } from './contexte'
import {
  Barre, Confirmer, Erreur, Etat, Kpi, KpiGrid, PageHeader, Section, Squelette, Table, Vide,
  dateFr, depuis, nb, telechargerCsv, useChargement,
} from './kit'
import '@/styles/admin-agences.css'

/**
 * Le parc : toutes les agences, et les gestes sur chacune.
 *
 * La liste vient de `platform_agencies`. Les gestes (entrer, suspendre,
 * réactiver) rechargent la liste sans la vider : pendant le rafraîchissement,
 * les lignes restent, seule l'indication « Actualisation » apparaît.
 */

export interface AgencyRow {
  id: string; slug: string; name: string; country: string; plan: string
  suspended: boolean; created_at: string; users: number; offices: number; clients: number; cases_open: number
  last_activity: string | null; commission_kind: string; commission_amount: number
  /* La consommation, comptée par la base. Absente sur une base antérieure. */
  usage_max_pct?: number | null
  usage_niveau?: UsageNiveau
}

type Filtre = 'toutes' | 'actives' | 'essais' | 'suspendues' | 'depassement'
const FILTRES: Filtre[] = ['toutes', 'actives', 'essais', 'suspendues', 'depassement']

const NIVEAU: Record<UsageNiveau, { label: string; tone: 'gray' | 'blue' | 'orange' | 'red' }> = {
  ok: { label: 'ok', tone: 'gray' }, info: { label: '80 %', tone: 'blue' },
  attention: { label: 'au complet', tone: 'orange' }, bloque: { label: 'bloquée', tone: 'red' },
}

/** Au moins une ressource à 100 % : la ligne dans la console que la grille promet. */
export const enDepassement = (a: AgencyRow): boolean => a.usage_niveau === 'attention' || a.usage_niveau === 'bloque'
type Tri = 'activite' | 'creation' | 'nom' | 'dossiers'

const QUATORZE_JOURS = 14 * 86400 * 1000

async function chargerAgences(): Promise<AgencyRow[]> {
  if (!supabase) throw new Error('La console n’existe qu’avec un backend.')
  const { data, error } = await supabase.rpc('platform_agencies')
  if (error) throw new Error(error.message)
  return (data as AgencyRow[] | null) ?? []
}

/** Le pourcentage le plus haut et son niveau. Premium sans repère chiffré : « illimité ». */
function CelluleUsage({ a }: { a: AgencyRow }) {
  if (a.usage_niveau === undefined) return <span className="t-tertiary">·</span>
  const n = NIVEAU[a.usage_niveau] ?? NIVEAU.ok
  return (
    <span className="row gap-2" style={{ justifyContent: 'flex-end', alignItems: 'center' }}>
      <span className="t-num">{a.usage_max_pct === null || a.usage_max_pct === undefined ? (a.plan === 'premium' ? 'illimité' : '·') : `${nb(Math.round(a.usage_max_pct))} %`}</span>
      {a.usage_niveau !== 'ok' && <Pill tone={n.tone} dot>{n.label}</Pill>}
    </span>
  )
}

/** Sans activité depuis quatorze jours : une agence qui s'éteint sans le dire. */
export function sansActivite(a: AgencyRow): boolean {
  if (a.suspended) return false
  if (!a.last_activity) return Date.now() - new Date(a.created_at).getTime() > QUATORZE_JOURS
  return Date.now() - new Date(a.last_activity).getTime() > QUATORZE_JOURS
}

export function Agences() {
  const { can, rafraichirCompteurs } = usePlateforme()
  const navigate = useNavigate()
  const toast = useToast()
  const { enterSupport } = useStore()
  const { data, loading, refreshing, error, reload } = useChargement(chargerAgences)
  const agences = data ?? []

  const [q, setQ] = useState('')
  // Le poste de pilotage ouvre la liste déjà filtrée : /admin/agences?filtre=depassement
  const [params, setParams] = useSearchParams()
  const demande = params.get('filtre')
  const filtre: Filtre = FILTRES.includes(demande as Filtre) ? (demande as Filtre) : 'toutes'
  const setFiltre = (f: Filtre) => setParams(f === 'toutes' ? {} : { filtre: f }, { replace: true })
  const [tri, setTri] = useState<Tri>('activite')
  const [confirmation, setConfirmation] = useState<{ agence: AgencyRow; etat: 'suspendue' | 'active' } | null>(null)
  const [busy, setBusy] = useState(false)

  const actives = agences.filter((a) => !a.suspended).length
  const suspendues = agences.filter((a) => a.suspended).length
  const essais = agences.filter((a) => a.plan === 'essai' && !a.suspended).length
  const dormantes = agences.filter(sansActivite).length
  const depassements = agences.filter(enDepassement).length

  const visibles = useMemo(() => {
    const texte = q.trim().toLowerCase()
    const liste = agences.filter((a) => {
      if (filtre === 'actives' && a.suspended) return false
      if (filtre === 'suspendues' && !a.suspended) return false
      if (filtre === 'essais' && a.plan !== 'essai') return false
      if (filtre === 'depassement' && !enDepassement(a)) return false
      if (!texte) return true
      return [a.name, a.slug, a.country].some((v) => v.toLowerCase().includes(texte))
    })
    const t = (iso: string | null) => (iso ? new Date(iso).getTime() : 0)
    return [...liste].sort((x, y) => {
      if (tri === 'nom') return x.name.localeCompare(y.name, 'fr')
      if (tri === 'creation') return t(y.created_at) - t(x.created_at)
      if (tri === 'dossiers') return y.cases_open - x.cases_open
      return t(y.last_activity) - t(x.last_activity)
    })
  }, [agences, q, filtre, tri])

  // Ouvre une agence en vue support (lecture seule). L'accès est journalisé
  // côté serveur AVANT le chargement ; si le rôle n'y donne pas droit, la base
  // refuse et on n'entre pas.
  const entrer = async (a: AgencyRow) => {
    if (!supabase) return
    const { error: e } = await supabase.rpc('platform_open_agency', { p_agency: a.id })
    if (e) { toast('Accès refusé : ' + e.message); return }
    enterSupport(a.id)
    navigate('/')
  }

  const changerEtat = async () => {
    if (!supabase || !confirmation) return
    setBusy(true)
    const { error: e } = await supabase.rpc('platform_set_agency_state', { p_agency: confirmation.agence.id, p_state: confirmation.etat })
    setBusy(false)
    if (e) { toast(e.message); return }
    toast(confirmation.etat === 'suspendue' ? `${confirmation.agence.name} est suspendue.` : `${confirmation.agence.name} est réactivée.`)
    setConfirmation(null)
    void reload(); rafraichirCompteurs()
  }

  const exporter = () => {
    telechargerCsv(`agences-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Agence', 'Sous-domaine', 'Pays', 'Formule', 'État', 'Bureaux', 'Comptes', 'Clients', 'Dossiers ouverts', 'Usage max (%)', 'Niveau', 'Dernière activité', 'Ouverte le', 'Commission', 'Montant'],
      ...visibles.map((a) => [
        a.name, `${a.slug}.visaflow.app`, a.country, a.plan, a.suspended ? 'suspendue' : 'active',
        a.offices, a.users, a.clients, a.cases_open, a.usage_max_pct ?? '', a.usage_niveau ?? '', a.last_activity ?? '', a.created_at.slice(0, 10), a.commission_kind, a.commission_amount,
      ]),
    ])
  }

  return (
    <>
      <PageHeader
        kicker="Parc"
        title="Agences"
        subtitle={loading ? undefined : `${nb(agences.length)} agences · ${nb(actives)} actives · ${nb(suspendues)} suspendues`}
        refreshing={refreshing}
        actions={<>
          <Button icon="download" onClick={exporter} disabled={visibles.length === 0}>Exporter CSV</Button>
          {can('agences.ouvrir') && <Link to="/admin/agences/nouvelle" className="btn btn--primary">Nouvelle agence</Link>}
        </>}
      />

      {error && !data && <Erreur message={error} onRetry={() => void reload()} />}

      {loading ? <Squelette type="kpis" n={4} /> : (
        <KpiGrid>
          <Kpi label="Actives" value={nb(actives)} tone="green" icon="building" />
          <Kpi label="En essai" value={nb(essais)} tone="blue" hint="Formule essai" icon="clock" />
          <Kpi label="Suspendues" value={nb(suspendues)} tone={suspendues > 0 ? 'red' : 'gray'} icon="lock" />
          <Kpi label="Sans activité" value={nb(dormantes)} tone={dormantes > 0 ? 'orange' : 'gray'} hint="Depuis 14 jours" icon="alert" />
        </KpiGrid>
      )}

      <Section flush>
        <Barre right={
          <Select value={tri} onChange={(e) => setTri(e.target.value as Tri)} aria-label="Trier">
            <option value="activite">Activité récente</option>
            <option value="creation">Création</option>
            <option value="nom">Nom</option>
            <option value="dossiers">Dossiers ouverts</option>
          </Select>
        }>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, sous-domaine, pays" aria-label="Rechercher" style={{ minWidth: 200 }} />
          <Segmented value={filtre} onChange={setFiltre} label="Filtrer" options={[
            { value: 'toutes', label: 'Toutes' }, { value: 'actives', label: 'Actives' },
            { value: 'essais', label: 'Essais' }, { value: 'suspendues', label: 'Suspendues' },
            { value: 'depassement', label: `En dépassement · ${depassements}` },
          ]} />
        </Barre>

        {loading ? <Squelette type="table" n={6} /> : visibles.length === 0 ? (
          <Vide title={agences.length === 0 ? 'Aucune agence.' : 'Aucune agence ne correspond.'}
            hint={agences.length === 0 ? 'Ouvrez la première depuis « Nouvelle agence ».' : 'Élargissez la recherche ou changez le filtre.'} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Agence</th><th>Pays</th><th>Formule</th>
                <th className="num">Bureaux</th><th className="num">Comptes</th><th className="num">Clients</th><th className="num">Dossiers</th>
                <th className="num">Usage</th>
                <th>Activité</th><th>État</th><th className="actions" />
              </tr>
            </thead>
            <tbody>
              {visibles.map((a) => (
                <tr key={a.id} className={`adm-row--click ${a.suspended ? 'adm-row--off' : ''}`} onClick={() => navigate(`/admin/agences/${a.id}`)}>
                  <td>
                    <div className="adm-cell-main">
                      <Link to={`/admin/agences/${a.id}`} className="ag-lien" onClick={(e) => e.stopPropagation()}>{a.name}</Link>
                      <span className="t-caption t-mono">{a.slug}.visaflow.app</span>
                    </div>
                  </td>
                  <td>{a.country}</td>
                  <td><Etat etat={a.plan} /></td>
                  <td className="num">{nb(a.offices)}</td>
                  <td className="num">{nb(a.users)}</td>
                  <td className="num">{nb(a.clients)}</td>
                  <td className="num">{nb(a.cases_open)}</td>
                  <td className="num"><CelluleUsage a={a} /></td>
                  <td className="t-tertiary" title={a.last_activity ? dateFr(a.last_activity) : 'Aucune activité'}>{depuis(a.last_activity)}</td>
                  <td><Etat etat={a.suspended ? 'suspendue' : 'active'} dot /></td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    <span className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                      <Link to={`/admin/agences/${a.id}`} className="btn btn--secondary btn--sm">Fiche</Link>
                      {can('agences.entrer') && !a.suspended && <Button size="sm" icon="eye" onClick={() => void entrer(a)}>Entrer</Button>}
                      {can('agences.suspendre') && (a.suspended
                        ? <Button size="sm" icon="check" onClick={() => setConfirmation({ agence: a, etat: 'active' })}>Réactiver</Button>
                        : <Button size="sm" icon="lock" onClick={() => setConfirmation({ agence: a, etat: 'suspendue' })}>Suspendre</Button>)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      {confirmation && (confirmation.etat === 'suspendue' ? (
        <Confirmer title={`Suspendre ${confirmation.agence.name}`} motCle={confirmation.agence.name} danger label="Suspendre" busy={busy}
          onConfirm={() => void changerEtat()} onClose={() => setConfirmation(null)}>
          Plus personne ne pourra entrer dans l’agence, ni lire ni écrire. Rien n’est effacé : la réactivation rend tout tel quel.
        </Confirmer>
      ) : (
        <Confirmer title={`Réactiver ${confirmation.agence.name}`} label="Réactiver" busy={busy}
          onConfirm={() => void changerEtat()} onClose={() => setConfirmation(null)}>
          L’agence retrouve son accès immédiatement, avec tous ses dossiers.
        </Confirmer>
      ))}
    </>
  )
}
