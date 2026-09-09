import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Field, Input, Modal, Pill, Segmented, Select, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import {
  Barre, Confirmer, Erreur, Etat, Gravite, Kpi, KpiGrid, PageHeader, Section, Squelette, Table, Vide,
  dateFr, dateHeure, delai, money, nb, telechargerCsv, useChargement,
} from './kit'
import { usePlateforme } from './contexte'
import {
  generatePlatformInvoices, loadAgencyPayments, loadBillingBoard, loadPlatformInvoices, loadRecentPayments,
  reactivateAgency, recordPayment,
  type AgencyPayment, type BillingRow, type PaymentMethod, type PlatformInvoice, type RecentPayment,
} from '@/data/facturation'
import { loadPlans, type BillingPeriod, type InvoiceTotals, type Plan } from '@/data/abonnements'
import '@/styles/admin-finance.css'

/**
 * LA FACTURATION. Qui doit quoi, jusqu'à quand, et ce qui a été reçu.
 *
 * Cet écran n'encaisse rien, et ce n'est pas un oubli : l'abonnement se règle
 * par virement, sur facture TTN, et c'est l'admin de plateforme qui CONSTATE
 * le virement reçu. Le cycle est celui de la base (0066) : essai, puis grâce,
 * puis suspension sans règlement constaté ; jamais une suppression. Les durées
 * viennent des plans, jamais d'un chiffre écrit ici.
 *
 * Le tableau arrive trié par urgence depuis platform_billing_board() ; on le
 * filtre, on ne le re-trie pas, sinon la règle diverge le jour où elle change
 * côté base.
 */

/* ------------------------------ Libellés ----------------------------- */

const METHODES: { value: PaymentMethod; label: string }[] = [
  { value: 'virement', label: 'Virement' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'especes', label: 'Espèces' },
  { value: 'carte', label: 'Carte' },
  { value: 'autre', label: 'Autre' },
]
const methode = (m: string) => METHODES.find((x) => x.value === m)?.label ?? m

const MOTIFS: Record<string, string> = {
  grace_depassee: 'Grâce dépassée',
  reprise_0066: 'Suspension antérieure au cycle',
}

type Filtre = 'traiter' | 'suspendues' | 'graces' | 'essais' | 'a_jour' | 'toutes'

/* -------------------------------- Dates ------------------------------ */

/** Une date ISO du jour LOCAL. toISOString() rend la veille passé minuit à Tunis. */
const isoJour = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const aujourdhui = () => isoJour(new Date())
const enDate = (iso: string) => new Date(`${iso}T00:00:00`)
const plusJours = (iso: string, n: number) => { const d = enDate(iso); d.setDate(d.getDate() + n); return isoJour(d) }
const plusMois = (iso: string, n: number) => { const d = enDate(iso); d.setMonth(d.getMonth() + n); return isoJour(d) }
const plusAns = (iso: string, n: number) => { const d = enDate(iso); d.setFullYear(d.getFullYear() + n); return isoJour(d) }

/** Les douze derniers mois, le courant d'abord, en premier jour du mois. */
function douzeMois(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const label = d.toLocaleDateString('fr-TN', { month: 'long', year: 'numeric' })
    out.push({ value: isoJour(d), label: label.charAt(0).toUpperCase() + label.slice(1) })
  }
  return out
}

/* -------------------------------- Tarif ------------------------------ */

interface Tarif {
  /** Socle + ajouts, aux prix figés : ce que vaut l'abonnement par mois. Null quand rien n'est signé. */
  mensuel: number | null
  periode: BillingPeriod
  /** Ce que la facture de la période porte, HT, remise déduite. */
  periodeMontant: number | null
  /** HT, TVA, retenue, net à payer. Null sans souscription payante. */
  totaux: InvoiceTotals | null
  /** Ce qui reste dû après les règlements partiels. */
  solde: number
}

/**
 * Le tarif d'une ligne. Tout vient de la base : `monthly_amount` est calculé
 * aux prix figés de la souscription, `invoice_totals` porte le net à payer.
 * Rien n'est reconstruit ici : pas de souscription payante, c'est « · ».
 */
function tarif(row: BillingRow): Tarif {
  const mensuel = Number(row.monthly_amount ?? 0)
  const totaux = row.invoice_totals ?? null
  const periode: BillingPeriod = totaux?.period ?? 'annuel'
  const annuel = Number(row.annual_amount ?? row.montant_attendu ?? 0)
  return {
    mensuel: mensuel > 0 ? mensuel : null,
    periode,
    periodeMontant: annuel > 0 ? annuel : null,
    totaux,
    solde: Number(row.solde_du ?? 0),
  }
}

/** Ce qu'un règlement doit atteindre pour être complet : le net à payer, sinon le montant de la période. */
const du = (t: Tarif) => (t.totaux ? Number(t.totaux.net_a_payer) : t.periodeMontant)

/** « par an », « par semestre », « par mois ». */
const parPeriode = (p: BillingPeriod) => (p === 'annuel' ? 'par an' : p === 'semestriel' ? 'par semestre' : 'par mois')

/* ------------------------------ Filtrage ----------------------------- */

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

function visible(r: BillingRow, filtre: Filtre, q: string): boolean {
  const ok = filtre === 'toutes' ? true
    : filtre === 'traiter' ? r.etat !== 'a_jour'
    : filtre === 'suspendues' ? r.etat === 'suspendue'
    : filtre === 'graces' ? r.etat === 'grace'
    : filtre === 'essais' ? r.etat === 'essai'
    : r.etat === 'a_jour'
  if (!ok) return false
  if (!q) return true
  const n = norm(q)
  return norm(r.name).includes(n) || norm(r.slug).includes(n) || norm(r.country ?? '').includes(n)
}

/* -------------------------------- Écran ------------------------------ */

export function Facturation() {
  const toast = useToast()
  const { can, rafraichirCompteurs } = usePlateforme()
  const [params, setParams] = useSearchParams()

  // Le parc et les formules ensemble : les durées du cycle (essai, grâce)
  // viennent de la formule d'essai. Le tarif, lui, est déjà sur chaque ligne.
  const { data, loading, refreshing, error, reload } = useChargement(async () => {
    const [rows, plans] = await Promise.all([
      loadBillingBoard(),
      // Les formules ne bloquent jamais l'écran : sans elles, 15 et 7 jours restent le repli.
      loadPlans().catch(() => [] as Plan[]),
    ])
    return { rows, plans }
  })
  // Les règlements récents nourrissent « Encaissé ce mois » et la section du
  // bas. On en lit assez pour couvrir un mois entier ; le tableau n'en montre
  // que vingt. Un échec ici n'abîme rien d'autre : la tuile affiche « · ».
  const recents = useChargement(() => loadRecentPayments(200))
  const reloadRecents = recents.reload

  const [mois, setMois] = useState(() => douzeMois()[0].value)
  const factures = useChargement(() => loadPlatformInvoices(mois), [mois])

  const [filtre, setFiltre] = useState<Filtre>('traiter')
  const [q, setQ] = useState('')
  const [paying, setPaying] = useState<BillingRow | null>(null)
  const [historique, setHistorique] = useState<BillingRow | null>(null)
  const [rouvrir, setRouvrir] = useState<BillingRow | null>(null)
  const [generer, setGenerer] = useState(false)
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => data?.rows ?? [], [data])
  const plans = useMemo(() => new Map<string, Plan>((data?.plans ?? []).map((p) => [p.code, p])), [data])
  const planEssai = plans.get('essai')
  // Les durées du cycle viennent de la formule d'essai. 15 et 7 ne sont que
  // le repli d'affichage tant qu'elle n'est pas chargée : la base tient les mêmes.
  const joursEssai = planEssai?.trial_days ?? 15
  const joursGrace = planEssai?.grace_days ?? 7

  const toutRecharger = useCallback(() => { void reload(); void reloadRecents() }, [reload, reloadRecents])

  // Rafraîchissement automatique : l'écran reste ouvert toute la journée sur
  // le poste de la plateforme, et les données précédentes restent affichées.
  useEffect(() => {
    const id = window.setInterval(toutRecharger, 60_000)
    return () => window.clearInterval(id)
  }, [toutRecharger])

  /* ---------------------------- Compteurs ---------------------------- */

  const compte = useMemo(() => {
    const c = { suspendues: 0, graces: 0, gracesSous7: 0, essais: 0, essaisSous7: 0, aJour: 0, attendu30: 0, attenduInconnu: false, soldes: 0, soldesN: 0 }
    for (const r of rows) {
      const t = tarif(r)
      if (t.solde > 0) { c.soldes += t.solde; c.soldesN++ }
      if (r.etat === 'suspendue') c.suspendues++
      if (r.etat === 'grace') { c.graces++; if (r.jours_restants !== null && r.jours_restants <= 7) c.gracesSous7++ }
      if (r.etat === 'essai') { c.essais++; if (r.jours_restants !== null && r.jours_restants <= 7) c.essaisSous7++ }
      if (r.etat === 'a_jour') c.aJour++
      // Attendu sous 30 jours : ce que valent les grâces et les renouvellements
      // qui tombent dans le mois. Un essai ne doit rien ; une suspendue non plus
      // tant qu'elle ne revient pas.
      const dans30 = r.etat === 'grace' || (r.etat === 'a_jour' && r.jours_restants !== null && r.jours_restants <= 30)
      if (dans30) {
        const d = du(t)
        if (d === null) c.attenduInconnu = true
        else c.attendu30 += d
      }
    }
    return c
  }, [rows])

  const encaisseMois = useMemo(() => {
    if (!recents.data) return null
    const now = new Date()
    const debut = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const duMois = recents.data.filter((p) => new Date(p.recorded_at).getTime() >= debut)
    return { total: duMois.reduce((s, p) => s + p.amount, 0), n: duMois.length }
  }, [recents.data])

  const montres = useMemo(() => rows.filter((r) => visible(r, filtre, q)), [rows, filtre, q])

  /* -------------------------- Ciblage par l'URL --------------------------- */

  // Le cockpit envoie /admin/facturation?agence=<uuid>&geste=regler|rouvrir :
  // on fait défiler jusqu'à la ligne, on la surligne, et on ouvre le geste.
  // Une seule fois par couple (agence, geste), sinon chaque rafraîchissement
  // rouvrirait la modale sous les doigts de l'utilisateur.
  const cible = params.get('agence')
  const geste = params.get('geste')
  const traite = useRef<string | null>(null)
  useEffect(() => {
    if (!data || !cible) return
    const cle = `${cible}:${geste ?? ''}`
    if (traite.current === cle) return
    traite.current = cle
    const row = rows.find((r) => r.agency_id === cible)
    if (!row) { toast('Cette agence n’est pas dans le parc.'); return }
    if (!visible(row, filtre, q)) { setFiltre('toutes'); setQ('') }
    window.setTimeout(() => {
      document.getElementById(`fi-${cible}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 60)
    if (geste === 'regler') setPaying(row)
    else if (geste === 'rouvrir') {
      if (row.etat === 'suspendue') setRouvrir(row)
      else toast('Cette agence n’est pas suspendue : rien à rouvrir.')
    }
    if (geste) {
      const next = new URLSearchParams(params)
      next.delete('geste')
      setParams(next, { replace: true })
    }
  }, [data, rows, cible, geste, filtre, q, params, setParams, toast])

  /* ------------------------------ Gestes ------------------------------ */

  const faitRouvrir = async () => {
    if (!rouvrir) return
    setBusy(true)
    try {
      const out = await reactivateAgency(rouvrir.agency_id, 'Réouverture depuis la console.')
      toast(`Accès rouvert. Nouvelle grâce jusqu’au ${dateFr(out.grace_ends_on)}.`)
      setRouvrir(null)
      toutRecharger(); rafraichirCompteurs()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Réouverture impossible.')
    } finally { setBusy(false) }
  }

  const faitGenerer = async () => {
    setBusy(true)
    try {
      const n = await generatePlatformInvoices(null)
      toast(`${nb(n)} factures générées.`)
      setGenerer(false)
      const courant = douzeMois()[0].value
      if (mois === courant) void factures.reload()
      else setMois(courant)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Génération impossible.')
    } finally { setBusy(false) }
  }

  const exporterParc = () => telechargerCsv(`facturation-${aujourdhui()}.csv`, [
    ['Agence', 'Slug', 'Pays', 'État', 'Jours restants', 'Échéance', 'Formule', 'Devise', 'Bureaux en plus', 'Comptes en plus', 'Mensuel', 'Période', 'Montant période HT', 'TVA', 'TTC', 'Retenue', 'Net à payer', 'Solde dû', 'Dernier règlement', 'Dernier montant'],
    ...montres.map((r) => {
      const t = tarif(r)
      return [r.name, r.slug, r.country, r.etat, r.jours_restants, r.echeance, r.plan_code ?? r.plan, r.currency ?? r.devise,
        r.extra_offices, r.extra_users, t.mensuel, t.periode, t.periodeMontant,
        t.totaux?.tva ?? '', t.totaux?.ttc ?? '', t.totaux?.retenue ?? '', t.totaux?.net_a_payer ?? '', t.solde,
        r.dernier_reglement_le ?? r.dernier_paiement, r.dernier_montant]
    }),
  ])

  const exporterReglements = () => telechargerCsv(`reglements-${aujourdhui()}.csv`, [
    ['Enregistré le', 'Agence', 'Montant', 'Devise', 'Moyen', 'Référence', 'Période du', 'au', 'Par', 'Note'],
    ...(recents.data ?? []).map((p) => [p.recorded_at, p.agency_name, p.amount, p.currency, methode(p.method), p.reference, p.period_start, p.period_end, p.recorded_by_name ?? p.recorded_by, p.note]),
  ])

  /* -------------------------------- Rendu ------------------------------- */

  const peutEncaisser = can('facturation.encaisser')
  const peutRouvrir = can('facturation.reactiver')

  return (
    <div className="fi-page">
      <PageHeader
        kicker="Argent"
        title="Facturation"
        subtitle="Qui doit quoi, jusqu’à quand, et ce qui a été reçu."
        refreshing={refreshing || recents.refreshing}
        actions={<>
          <Button icon="download" onClick={exporterParc} disabled={montres.length === 0}>Exporter CSV</Button>
          {peutEncaisser && <Button icon="reports" onClick={() => setGenerer(true)}>Générer les factures du mois</Button>}
          <Button icon="refresh" onClick={toutRecharger} disabled={refreshing}>Actualiser</Button>
        </>}
      />

      {error && <Erreur message={error} onRetry={toutRecharger} />}

      {loading && !data ? (
        <>
          <Squelette type="kpis" n={6} />
          <Section flush><Squelette type="table" n={6} /></Section>
        </>
      ) : (
        <>
          <KpiGrid>
            <Kpi label="Suspendues" value={nb(compte.suspendues)} tone={compte.suspendues > 0 ? 'red' : undefined} hint="accès coupé, données intactes" icon="lock" />
            <Kpi label="En délai de grâce" value={nb(compte.graces)} tone={compte.graces > 0 ? 'orange' : undefined} hint={`${nb(compte.gracesSous7)} ${compte.gracesSous7 === 1 ? 'coupée' : 'coupées'} sous 7 jours`} icon="clock" />
            <Kpi label="Essais" value={nb(compte.essais)} tone="blue" hint={`${nb(compte.essaisSous7)} ${compte.essaisSous7 === 1 ? 'finit' : 'finissent'} sous 7 jours`} icon="sparkle" />
            <Kpi label="À jour" value={nb(compte.aJour)} tone="green" hint={`sur ${nb(rows.length)} agences`} icon="check" />
            <Kpi
              label="Encaissé ce mois"
              value={encaisseMois ? money(encaisseMois.total) : '·'}
              tone="green"
              hint={encaisseMois ? `${nb(encaisseMois.n)} ${encaisseMois.n === 1 ? 'règlement constaté' : 'règlements constatés'}` : (recents.error ? 'règlements illisibles' : 'lecture en cours')}
              icon="payments"
            />
            <Kpi
              label="Attendu sur 30 jours"
              value={money(compte.attendu30)}
              hint={compte.attenduInconnu ? 'grâces et renouvellements, net à payer, formule inconnue pour certaines' : compte.soldesN > 0 ? `dont ${money(compte.soldes)} de soldes dus sur ${nb(compte.soldesN)} ${compte.soldesN === 1 ? 'agence' : 'agences'}` : 'grâces et renouvellements du mois, net à payer'}
              tone={compte.soldesN > 0 ? 'orange' : undefined}
              icon="today"
            />
          </KpiGrid>

          <Cycle
            joursEssai={joursEssai}
            joursGrace={joursGrace}
            compte={compte}
            reglements={encaisseMois?.n ?? null}
            filtre={filtre}
            onFiltre={(f) => { setFiltre(f); setQ('') }}
          />

          <Section
            title="Le parc, trié par urgence"
            flush
            action={<span className="t-caption t-tertiary t-num">{nb(montres.length)} / {nb(rows.length)}</span>}
          >
            <Barre right={
              <Input
                className="fi-recherche"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Nom, slug ou pays"
                aria-label="Rechercher une agence"
              />
            }>
              <Segmented<Filtre>
                value={filtre}
                onChange={setFiltre}
                label="État"
                options={[
                  { value: 'traiter', label: `À traiter · ${compte.suspendues + compte.graces + compte.essais}` },
                  { value: 'suspendues', label: `Suspendues · ${compte.suspendues}` },
                  { value: 'graces', label: `Grâces · ${compte.graces}` },
                  { value: 'essais', label: `Essais · ${compte.essais}` },
                  { value: 'a_jour', label: `À jour · ${compte.aJour}` },
                  { value: 'toutes', label: `Toutes · ${rows.length}` },
                ]}
              />
            </Barre>

            {montres.length === 0 ? (
              <Vide
                title={rows.length === 0 ? 'Aucune agence dans le parc.' : 'Rien dans ce filtre.'}
                hint={rows.length === 0 ? 'Le parc se remplit à la première ouverture d’agence.' : filtre === 'traiter' ? 'Tout le monde est à jour.' : undefined}
              />
            ) : (
              <Table className="fi-table">
                <thead>
                  <tr>
                    <th>Agence</th><th>État</th><th>Échéance</th><th>Formule</th>
                    <th className="num">Mensuel</th><th className="num">Net à payer</th><th className="num">Solde dû</th>
                    <th>Dernier règlement</th><th className="actions" />
                  </tr>
                </thead>
                <tbody>
                  {montres.map((r) => {
                    const t = tarif(r)
                    return (
                      <tr key={r.agency_id} id={`fi-${r.agency_id}`} className={r.agency_id === cible ? 'fi-row--cible' : ''}>
                        <td>
                          <div className="adm-cell-main">
                            <Link to={`/admin/agences/${r.agency_id}`}>{r.name}</Link>
                            <span className="t-caption t-mono">{r.slug}</span>
                          </div>
                        </td>
                        <td>
                          <span className="row gap-2 wrap">
                            <Gravite niveau={r.severite} />
                            <Etat etat={r.etat} dot />
                            {/* La base replie « impayée » sur la grâce pour le client ;
                                la console a le droit de savoir que c'est un renouvellement. */}
                            {r.billing_state === 'impayee' && <Pill tone="orange">Renouvellement</Pill>}
                            {r.motif && <Pill tone="gray">{MOTIFS[r.motif] ?? r.motif}</Pill>}
                          </span>
                        </td>
                        <td><Echeance r={r} /></td>
                        <td className="t-small">
                          <div className="adm-cell-main">
                            <span>{r.plan ? (plans.get(r.plan)?.name ?? r.plan) : <span className="t-tertiary">·</span>}</span>
                            {(Number(r.extra_offices) > 0 || Number(r.extra_users) > 0) && (
                              <span className="t-caption">{[Number(r.extra_offices) > 0 ? `+${nb(r.extra_offices)} bureau${Number(r.extra_offices) > 1 ? 'x' : ''}` : null, Number(r.extra_users) > 0 ? `+${nb(r.extra_users)} compte${Number(r.extra_users) > 1 ? 's' : ''}` : null].filter(Boolean).join(', ')}</span>
                            )}
                          </div>
                        </td>
                        <td className="num t-num t-medium">
                          {t.mensuel === null ? <span className="t-tertiary">·</span> : money(t.mensuel, r.currency ?? r.devise)}
                          {t.periodeMontant !== null && <div className="t-caption t-tertiary">{money(t.periodeMontant, r.currency ?? r.devise)} HT {parPeriode(t.periode)}</div>}
                        </td>
                        <td className="num t-num">
                          {t.totaux ? money(Number(t.totaux.net_a_payer), t.totaux.currency) : <span className="t-tertiary">·</span>}
                        </td>
                        <td className="num t-num">
                          {t.solde > 0 ? <span className="fi-solde">{money(t.solde, r.currency ?? r.devise)}</span> : t.totaux ? <span className="t-tertiary">réglé</span> : <span className="t-tertiary">·</span>}
                        </td>
                        <td className="t-small">
                          {(r.dernier_reglement_le ?? r.dernier_paiement) ? (
                            <div className="adm-cell-main">
                              <span>{dateFr(r.dernier_reglement_le ?? r.dernier_paiement)}</span>
                              {r.dernier_montant !== null && <span className="t-caption t-num">{money(Number(r.dernier_montant), r.devise)}</span>}
                            </div>
                          ) : <span className="t-tertiary">jamais</span>}
                        </td>
                        <td className="actions">
                          <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                            {peutEncaisser && <Button size="sm" variant="primary" icon="payments" onClick={() => setPaying(r)}>Constater un règlement</Button>}
                            {peutRouvrir && r.etat === 'suspendue' && <Button size="sm" icon="lock" onClick={() => setRouvrir(r)}>Rouvrir</Button>}
                            <Button size="sm" icon="clock" onClick={() => setHistorique(r)}>Règlements</Button>
                            <Link to={`/admin/agences/${r.agency_id}`} className="btn btn--secondary btn--sm"><Icon name="building" size={16} />Fiche</Link>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
            <p className="t-caption t-tertiary" style={{ padding: 'var(--sp-3) var(--sp-4)', margin: 0 }}>
              Une agence naît en essai de {joursEssai} jours, puis dispose de {joursGrace} jours de grâce. Passé ce délai
              sans règlement constaté, elle est suspendue, jamais supprimée : ses dossiers, ses clients et ses documents
              restent intacts et reviennent au premier règlement.
            </p>
          </Section>

          <Section
            title="Règlements récents"
            flush
            className="fi-reglements"
            action={<Button size="sm" icon="download" onClick={exporterReglements} disabled={!recents.data || recents.data.length === 0}>Exporter CSV</Button>}
          >
            <div id="fi-reglements" />
            {recents.loading && !recents.data ? <Squelette type="table" n={4} />
              : recents.error && !recents.data ? <Vide title="Les règlements ne se lisent pas." hint={recents.error} action={<Button size="sm" icon="refresh" onClick={() => void reloadRecents()}>Réessayer</Button>} />
              : !recents.data || recents.data.length === 0 ? <Vide title="Aucun règlement constaté." hint="Le premier virement reçu s’enregistre depuis le parc, ligne par ligne." />
              : <ReglementsRecents items={recents.data.slice(0, 20)} />}
          </Section>

          <Section
            title="Factures de plateforme"
            flush
            action={
              <Select className="fi-mois" value={mois} onChange={(e) => setMois(e.target.value)} aria-label="Mois">
                {douzeMois().map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Select>
            }
          >
            {factures.loading && !factures.data ? <Squelette type="table" n={3} />
              : factures.error && !factures.data ? <Erreur message={factures.error} onRetry={() => void factures.reload()} />
              : !factures.data || factures.data.length === 0 ? <Vide title="Aucune facture pour ce mois." hint={peutEncaisser ? '« Générer les factures du mois » les pose en brouillon pour le mois courant.' : undefined} />
              : <Factures items={factures.data} />}
            <p className="t-caption t-tertiary" style={{ padding: 'var(--sp-3) var(--sp-4)', margin: 0 }}>
              Les factures de plateforme suivent la commission historique de chaque agence. Le cycle d’abonnement,
              au-dessus, est la vraie facturation.
            </p>
          </Section>
        </>
      )}

      {paying && (
        <FormeReglement
          row={paying}
          tarif={tarif(paying)}
          onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); toutRecharger(); rafraichirCompteurs() }}
        />
      )}
      {historique && <Reglements row={historique} onClose={() => setHistorique(null)} />}
      {rouvrir && (
        <Confirmer
          title={`Rouvrir ${rouvrir.name}`}
          label="Rouvrir l’accès"
          busy={busy}
          onConfirm={() => void faitRouvrir()}
          onClose={() => setRouvrir(null)}
        >
          L’agence repart en délai de grâce de {joursGrace} jours à partir d’aujourd’hui, sans règlement constaté.
          Si le virement n’arrive pas d’ici là, elle sera suspendue de nouveau, en étant prévenue.
          Pour la remettre à jour, constatez plutôt le règlement.
        </Confirmer>
      )}
      {generer && (
        <Confirmer
          title="Générer les factures du mois"
          label="Générer"
          busy={busy}
          onConfirm={() => void faitGenerer()}
          onClose={() => setGenerer(false)}
        >
          Une facture de plateforme par agence, pour le mois courant, en brouillon. Une facture déjà envoyée
          ou réglée n’est pas réécrite.
        </Confirmer>
      )}
    </div>
  )
}

/* ------------------------------ La frise ------------------------------ */

function Cycle({ joursEssai, joursGrace, compte, reglements, filtre, onFiltre }: {
  joursEssai: number
  joursGrace: number
  compte: { essais: number; graces: number; suspendues: number; aJour: number; essaisSous7: number; gracesSous7: number }
  reglements: number | null
  filtre: Filtre
  onFiltre: (f: Filtre) => void
}) {
  const etapes: { label: string; n: string; hint: string; tone: 'blue' | 'orange' | 'red' | 'green' | 'gray'; filtre?: Filtre; ancre?: string }[] = [
    { label: `Essai ${joursEssai} j`, n: nb(compte.essais), hint: `${nb(compte.essaisSous7)} sous 7 j`, tone: 'blue', filtre: 'essais' },
    { label: `Grâce ${joursGrace} j`, n: nb(compte.graces), hint: `${nb(compte.gracesSous7)} sous 7 j`, tone: 'orange', filtre: 'graces' },
    { label: 'Suspension', n: nb(compte.suspendues), hint: 'données intactes', tone: 'red', filtre: 'suspendues' },
    { label: 'Règlement constaté', n: reglements === null ? '·' : nb(reglements), hint: 'ce mois', tone: 'gray', ancre: 'fi-reglements' },
    { label: 'À jour', n: nb(compte.aJour), hint: 'jusqu’au renouvellement', tone: 'green', filtre: 'a_jour' },
  ]
  return (
    <div className="fi-cycle" role="group" aria-label="Le cycle de facturation">
      {etapes.map((e, i) => (
        <span key={e.label} style={{ display: 'contents' }}>
          {i > 0 && <span className="fi-cycle__fleche" aria-hidden="true"><Icon name="arrow" size={14} /></span>}
          <button
            type="button"
            className={`fi-cycle__etape fi-cycle__etape--${e.tone}`}
            aria-pressed={e.filtre ? e.filtre === filtre : undefined}
            onClick={() => {
              if (e.filtre) onFiltre(e.filtre)
              else if (e.ancre) document.getElementById(e.ancre)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            }}
          >
            <span className="fi-cycle__label">{e.label}</span>
            <span className="fi-cycle__n t-num">{e.n}</span>
            <span className="fi-cycle__hint">{e.hint}</span>
          </button>
        </span>
      ))}
    </div>
  )
}

/* ----------------------------- L'échéance ----------------------------- */

/**
 * Le mot qui va avec l'état : « coupure dans 3 j », « essai finit dans 12 j »,
 * « à renouveler le … ». Le chiffre seul ne se lit pas, un « -5 » encore moins.
 */
function Echeance({ r }: { r: BillingRow }) {
  const j = r.jours_restants
  const urgent = r.etat === 'suspendue' || (j !== null && j <= 3)
  let mot: string
  let date: string
  if (r.etat === 'suspendue') {
    mot = r.suspendue_le ? `coupée le ${dateFr(r.suspendue_le)}` : 'coupée'
    date = r.echeance ? `échéance ${dateFr(r.echeance)}` : ''
  } else if (r.etat === 'grace') {
    mot = `coupure ${delai(j)}`
    date = dateFr(r.echeance)
  } else if (r.etat === 'essai') {
    mot = `essai finit ${delai(j)}`
    date = dateFr(r.echeance)
  } else {
    mot = `à renouveler le ${dateFr(r.echeance)}`
    date = delai(j)
  }
  return (
    <div className={`fi-echeance ${urgent ? 'fi-echeance--urgent' : ''}`}>
      <span className="fi-echeance__mot t-small">{mot}</span>
      {date && <span className="fi-echeance__date">{date}</span>}
    </div>
  )
}

/* ------------------------- Constater un règlement --------------------- */

/**
 * Le montant proposé est le NET À PAYER de la facture : HT, plus TVA, moins la
 * retenue à la source que le client déduit lui-même. C'est ce que la banque
 * vire, et c'est ce qui fait un règlement complet. Il reste modifiable : un
 * client règle parfois une partie, et la base le sait (elle enregistre sans
 * repousser l'échéance). La période, elle, s'enchaîne sur la dernière : c'est
 * ce qui évite un trou ou un chevauchement dans les factures.
 */
function FormeReglement({ row, tarif: t, onClose, onDone }: {
  row: BillingRow
  tarif: Tarif
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const attendu = du(t)
  const [montant, setMontant] = useState(attendu === null ? '' : String(Math.round(attendu * 1000) / 1000))
  const [devise, setDevise] = useState(row.currency || row.devise || 'TND')
  const [methode, setMethode] = useState<PaymentMethod>('virement')
  const [reference, setReference] = useState('')
  const [debut, setDebut] = useState(aujourdhui())
  const [fin, setFin] = useState(() => finAuto(aujourdhui(), t.periode))
  const [finTouchee, setFinTouchee] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [derniere, setDerniere] = useState<AgencyPayment | null | undefined>(undefined)

  // Le début s'enchaîne sur la dernière période payée. Sauf pour une agence
  // suspendue dont cette période est finie depuis longtemps : la nouvelle
  // commence au règlement, on ne lui fait pas payer les semaines coupées.
  useEffect(() => {
    let vivant = true
    loadAgencyPayments(row.agency_id, 1)
      .then((l) => {
        if (!vivant) return
        const d = l[0] ?? null
        setDerniere(d)
        if (!d) return
        const lendemain = plusJours(d.period_end, 1)
        const suite = row.etat === 'suspendue' && lendemain < aujourdhui() ? aujourdhui() : lendemain
        setDebut(suite)
        setFin(finAuto(suite, t.periode))
      })
      .catch(() => { if (vivant) setDerniere(null) })
    return () => { vivant = false }
  }, [row.agency_id, row.etat, t.periode])

  const changerDebut = (v: string) => {
    setDebut(v)
    if (!finTouchee && v) setFin(finAuto(v, t.periode))
  }

  const n = Number(montant)
  const erreurs = {
    montant: montant !== '' && !(Number.isFinite(n) && n > 0) ? 'Un montant reçu est un nombre positif.' : undefined,
    fin: fin && debut && fin < debut ? 'La période finit avant de commencer.' : undefined,
  }
  const valide = Number.isFinite(n) && n > 0 && Boolean(debut) && Boolean(fin) && !erreurs.fin

  const enregistrer = async () => {
    setBusy(true)
    try {
      const out = await recordPayment({
        agencyId: row.agency_id, amount: n, currency: devise.trim().toUpperCase() || 'TND',
        periodStart: debut, periodEnd: fin, method: methode,
        reference: reference.trim() || null, note: note.trim() || null,
      })
      // Le serveur dit si le règlement est complet. Partiel : l'échéance ne bouge
      // pas, et c'est le solde qu'on annonce, pas une fausse mise à jour.
      const cur = devise.trim().toUpperCase() || 'TND'
      if (out.complet === false) {
        toast(`Règlement partiel enregistré pour ${row.name}. Il reste ${money(Number(out.solde_du), cur)} sur ${money(Number(out.net_a_payer), cur)} ; l’échéance ne bouge pas.`)
      } else {
        toast(out.reactivee ? `Règlement complet. ${row.name} est rouverte et à jour jusqu’au ${dateFr(out.renewal_on)}.`
          : `Règlement complet. ${row.name} est à jour jusqu’au ${dateFr(out.renewal_on)}.`)
      }
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Enregistrement impossible.')
    } finally { setBusy(false) }
  }

  const tot = t.totaux
  const cur = row.currency ?? row.devise
  const pct = (r: number) => nb(Math.round(r * 10000) / 100)
  const partiel = Number.isFinite(n) && n > 0 && attendu !== null && n < attendu - 1

  return (
    <Modal
      title={`Constater un règlement · ${row.name}`}
      onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" icon="check" disabled={busy || !valide} onClick={() => void enregistrer()}>{busy ? 'En cours…' : 'Enregistrer le règlement'}</Button>
      </>}
    >
      <div className="col gap-4">
        <p className="t-caption t-tertiary" style={{ margin: 0 }}>
          Ce geste constate un virement DÉJÀ reçu. Il ne prélève rien.
          {derniere ? ` Dernier règlement : ${money(derniere.amount, derniere.currency)} le ${dateFr(derniere.recorded_at)}, période jusqu’au ${dateFr(derniere.period_end)}.`
            : derniere === null ? ' Aucun règlement enregistré jusqu’ici.' : ''}
        </p>

        <div className="fi-deux">
          <Field label="Montant reçu" hint={attendu !== null ? `Net à payer : ${money(attendu, cur)}${t.solde > 0 ? ` · solde dû ${money(t.solde, cur)}` : ''}` : 'Aucune formule payante signée : saisissez le montant du virement.'} error={erreurs.montant}>
            <Input type="number" min="0" step="0.001" inputMode="decimal" value={montant} onChange={(e) => setMontant(e.target.value)} autoFocus />
          </Field>
          <Field label="Devise">
            <Input value={devise} onChange={(e) => setDevise(e.target.value)} maxLength={3} placeholder="TND" />
          </Field>
        </div>

        {tot && (
          <div className="fi-totaux" aria-label="Le détail de la facture">
            <span>Hors taxes, {parPeriode(t.periode)}</span><span>{money(Number(tot.ht), cur)}</span>
            {Number(tot.tva) > 0 && <><span>TVA {pct(Number(tot.tva_rate))} %</span><span>{money(Number(tot.tva), cur)}</span></>}
            {Number(tot.tva) > 0 && <><span>Toutes taxes</span><span>{money(Number(tot.ttc), cur)}</span></>}
            {Number(tot.retenue) > 0 && <><span>Retenue à la source {pct(Number(tot.withholding_rate))} %, déduite par le client</span><span>−{money(Number(tot.retenue), cur)}</span></>}
            <span className="fi-totaux--net" style={{ display: 'contents' }}><span>Net à payer</span><span>{money(Number(tot.net_a_payer), cur)}</span></span>
          </div>
        )}

        <div className="fi-deux">
          <Field label="Période du">
            <Input type="date" value={debut} onChange={(e) => changerDebut(e.target.value)} />
          </Field>
          <Field label="au" hint={finTouchee ? undefined : `${t.periode === 'annuel' ? 'Un an' : t.periode === 'semestriel' ? 'Six mois' : 'Un mois'}, modifiable.`} error={erreurs.fin}>
            <Input type="date" value={fin} onChange={(e) => { setFinTouchee(true); setFin(e.target.value) }} />
          </Field>
        </div>

        <div className="fi-deux">
          <Field label="Moyen">
            <Select value={methode} onChange={(e) => setMethode(e.target.value as PaymentMethod)}>
              {METHODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </Field>
          <Field label="Référence" hint="Celle du relevé. Elle ne s’enregistre qu’une fois par agence : c’est ce qui empêche de saisir deux fois le même virement.">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="VIR-2026-0142" />
          </Field>
        </div>

        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reçu sur le compte le 12 septembre." />
        </Field>

        <div className={`fi-recap ${valide && !partiel ? '' : 'fi-recap--neutre'}`}>
          <Icon name={partiel ? 'alert' : 'check'} size={16} />
          <span>
            {partiel && attendu !== null ? (
              <>Règlement partiel : il restera <strong>{money(attendu - n, cur)}</strong>. L’échéance ne bouge pas tant que le net à payer n’est pas atteint, à un dinar près.</>
            ) : (
              <>Après enregistrement, l’agence passe à jour jusqu’au <strong>{fin ? dateFr(fin) : '…'}</strong>
                {row.etat === 'suspendue' ? ' et rouvre, puisqu’elle est suspendue.' : ' et rouvre si elle était suspendue.'}</>
            )}
          </span>
        </div>
      </div>
    </Modal>
  )
}

/** La fin d'une période qui commence à `debut` : un an, six mois ou un mois, moins un jour. */
function finAuto(debut: string, periode: BillingPeriod): string {
  if (!debut) return ''
  return plusJours(periode === 'annuel' ? plusAns(debut, 1) : periode === 'semestriel' ? plusMois(debut, 6) : plusMois(debut, 1), -1)
}

/* --------------------------- L'historique d'une agence ---------------- */

/** C'est ce qu'on ouvre quand un client dit « mais j'ai payé ». */
function Reglements({ row, onClose }: { row: BillingRow; onClose: () => void }) {
  const { data, loading, error, reload } = useChargement(() => loadAgencyPayments(row.agency_id, 50), [row.agency_id])
  const total = (data ?? []).reduce((s, p) => s + Number(p.amount), 0)
  return (
    <Modal title={`Règlements · ${row.name}`} onClose={onClose} wide footer={<Button onClick={onClose}>Fermer</Button>}>
      {loading && !data ? <Squelette type="table" n={4} />
        : error ? <Erreur message={error} onRetry={() => void reload()} />
        : !data || data.length === 0 ? <Vide title="Aucun règlement enregistré." hint="Cette agence n’a jamais réglé." />
        : (
          <>
            <p className="t-caption t-tertiary" style={{ margin: '0 0 var(--sp-3)' }}>
              {nb(data.length)} {data.length === 1 ? 'règlement' : 'règlements'} · {money(total, data[0].currency)} au total
            </p>
            <Table>
              <thead>
                <tr><th>Enregistré le</th><th className="num">Montant</th><th>Période</th><th>Moyen</th><th>Référence</th><th>Par</th></tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id}>
                    <td className="t-small">{dateHeure(p.recorded_at)}</td>
                    <td className="num t-num t-medium">{money(Number(p.amount), p.currency)}</td>
                    <td className="t-small">{dateFr(p.period_start)} → {dateFr(p.period_end)}</td>
                    <td className="t-small">{methode(p.method)}</td>
                    <td className="t-caption t-mono">{p.reference ?? '·'}</td>
                    <td className="t-small">{p.recorded_by ?? '·'}{p.note && <div className="t-caption t-tertiary">{p.note}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
    </Modal>
  )
}

/* -------------------------- Les règlements récents -------------------- */

function ReglementsRecents({ items }: { items: RecentPayment[] }) {
  return (
    <Table>
      <thead>
        <tr><th>Quand</th><th>Agence</th><th className="num">Montant</th><th>Moyen</th><th>Référence</th><th>Période</th><th>Par</th></tr>
      </thead>
      <tbody>
        {items.map((p) => (
          <tr key={p.id}>
            <td className="t-small">{dateHeure(p.recorded_at)}</td>
            <td>
              <div className="adm-cell-main">
                <Link to={`/admin/agences/${p.agency_id}`}>{p.agency_name ?? '·'}</Link>
                {p.note && <span className="t-caption">{p.note}</span>}
              </div>
            </td>
            <td className="num t-num t-medium">{money(p.amount, p.currency)}</td>
            <td className="t-small">{methode(p.method)}</td>
            <td className="t-caption t-mono">{p.reference ?? '·'}</td>
            <td className="t-small">{dateFr(p.period_start)} → {dateFr(p.period_end)}</td>
            <td className="t-small">{p.recorded_by_name ?? (p.recorded_by ? <span className="t-caption t-mono">{p.recorded_by.slice(0, 8)}</span> : '·')}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

/* ------------------------- Les factures de plateforme ----------------- */

function Factures({ items }: { items: PlatformInvoice[] }) {
  const total = items.reduce((s, i) => s + i.amount, 0)
  return (
    <>
      <Table>
        <thead>
          <tr><th>Agence</th><th>Période</th><th className="num">Dossiers</th><th className="num">Montant</th><th>État</th></tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={`${i.slug}-${i.period}`}>
              <td>
                <div className="adm-cell-main">
                  <span>{i.agency}</span>
                  <span className="t-caption t-mono">{i.slug}</span>
                </div>
              </td>
              <td className="t-small">{new Date(i.period).toLocaleDateString('fr-TN', { month: 'long', year: 'numeric' })}</td>
              <td className="num t-num">{nb(i.cases_billed)}</td>
              <td className="num t-num t-medium">{money(i.amount, i.currency)}</td>
              <td><Etat etat={i.status} /></td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="t-caption t-tertiary t-num" style={{ padding: 'var(--sp-2) var(--sp-4) 0', margin: 0 }}>
        {nb(items.length)} {items.length === 1 ? 'facture' : 'factures'} · {money(total, items[0]?.currency)} au total
      </p>
    </>
  )
}
