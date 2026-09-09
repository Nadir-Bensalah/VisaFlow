import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Card, Field, Input, Modal, Pill, Progress, Segmented, Select, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import {
  Barre, Erreur, Etat, Kpi, KpiGrid, PageHeader, Section, Squelette, Table, Vide,
  dateFr, dateHeure, delai, money, nb, telechargerCsv, useChargement,
} from './kit'
import { usePlateforme } from './contexte'
import {
  loadPublicPlans, loadSubscriptionEvents, loadSubscriptions, refreshUsageAll, setSubscription,
  type BillingPeriod, type Currency, type PlanCode, type PublicPlan, type SubscriptionEvent, type SubscriptionRow, type SubscriptionStatus,
} from '@/data/abonnements'
import { bascule, bureauxAutorises, comptesAutorises, estimer, montantSouscription, planParCode, type LigneCode } from '@/data/grille'
import { alerte, depasse, enMo, illimite, joursAvant, pourcentage, taille } from '@/lib/quotas'
import '@/styles/admin-finance.css'

/**
 * LES ABONNEMENTS. La formule, les ajouts, l'échéance de chaque agence.
 *
 * Cet écran pose un plan et lit une consommation ; il n'encaisse rien. Le
 * prix vient de la grille (`public_plans`) et des souscriptions (prix figés à
 * la signature), jamais d'un chiffre écrit ici. La ligne de facture se lit
 * « socle + bureaux en plus + comptes en plus, × 12 mois » : des unités,
 * comme l'exige la circulaire BCT 2016-09.
 */

/* ------------------------------ Libellés ----------------------------- */

const STATUTS: SubscriptionStatus[] = ['essai', 'active', 'impayee', 'resiliee', 'suspendue']
const DEVISES: Currency[] = ['TND', 'EUR']
const FORMULES: PlanCode[] = ['essai', 'active', 'premium']

const RESSOURCES: Record<string, string> = {
  users: 'comptes', offices: 'bureaux', clients: 'clients',
  cases: 'dossiers', shipments: 'cargaisons', storage: 'stockage',
}

const LIGNES: Record<LigneCode, string> = {
  socle: 'Socle Active', bureau: 'Bureau en plus', compte: 'Compte en plus', premium: 'Premium',
}

const PERIODES: Record<BillingPeriod, string> = { annuel: 'Annuel', semestriel: 'Semestriel', mensuel: 'Mensuel' }

const EVENEMENTS: Record<SubscriptionEvent['kind'], string> = {
  creee: 'Abonnement ouvert',
  changement_plan: 'Changement de formule',
  renouvelee: 'Renouvellement',
  suspendue: 'Suspension',
  reactivee: 'Réactivation',
  resiliee: 'Résiliation',
  quota_depasse: 'Dépassement de quota',
}

type Filtre = 'tous' | 'actives' | 'essais' | 'attention'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Le nom d'une formule, lu dans la grille ; le code si la grille n'est pas là. */
function nomFormule(plans: PublicPlan[], code: string | null | undefined): string {
  if (!code) return '·'
  return plans.find((p) => p.code === code)?.name ?? code
}

/** « +1 bureau, +2 comptes », ou « socle seul ». */
function ajouts(r: { extra_users: number; extra_offices: number }): string {
  const parts: string[] = []
  const b = Number(r.extra_offices ?? 0)
  const u = Number(r.extra_users ?? 0)
  if (b > 0) parts.push(`+${nb(b)} ${b === 1 ? 'bureau' : 'bureaux'}`)
  if (u > 0) parts.push(`+${nb(u)} ${u === 1 ? 'compte' : 'comptes'}`)
  return parts.join(', ')
}

const go = (mb: number | null) => (illimite(mb) ? '∞' : (mb as number) >= 1000 ? `${nb(Math.round((mb as number) / 1024))} Go` : `${nb(mb as number)} Mo`)
const lim = (n: number | null, unite = '') => (illimite(n) ? '∞' : `${nb(n as number)}${unite}`)

/** Ce qui mérite qu'on l'ouvre : un dépassement, un impayé, une suspension, une échéance sous 30 jours. */
function aVoir(r: SubscriptionRow): boolean {
  const j = joursAvant(r.renewal_on)
  return r.over.length > 0 || r.status === 'impayee' || r.status === 'suspendue' || r.suspended || (j !== null && j <= 30)
}

function visible(r: SubscriptionRow, filtre: Filtre, q: string): boolean {
  const ok = filtre === 'tous' ? true
    : filtre === 'actives' ? r.status === 'active'
    : filtre === 'essais' ? r.status === 'essai'
    : aVoir(r)
  if (!ok) return false
  if (!q) return true
  const n = norm(q)
  return norm(r.name).includes(n) || norm(r.slug).includes(n) || norm(r.plan_name ?? '').includes(n)
}

/* -------------------------------- Écran ------------------------------ */

export function Abonnements() {
  const toast = useToast()
  const { can, rafraichirCompteurs } = usePlateforme()
  const [params, setParams] = useSearchParams()

  // La grille dans les deux devises, d'un coup : les cartes, le simulateur et
  // la modale en ont besoin selon la devise choisie, et la relire à chaque
  // bascule ferait clignoter l'écran.
  const { data, loading, refreshing, error, reload } = useChargement(async () => {
    const [rows, tnd, eur] = await Promise.all([
      loadSubscriptions(),
      loadPublicPlans('TND'),
      loadPublicPlans('EUR').catch(() => [] as PublicPlan[]),
    ])
    return { rows, grilles: { TND: tnd, EUR: eur } as Record<Currency, PublicPlan[]> }
  })

  const [devise, setDevise] = useState<Currency>('TND')
  const [filtre, setFiltre] = useState<Filtre>('tous')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<SubscriptionRow | null>(null)
  const [journal, setJournal] = useState<SubscriptionRow | null>(null)
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => data?.rows ?? [], [data])
  const grilles = useMemo(() => data?.grilles ?? { TND: [], EUR: [] }, [data])
  const grille = grilles[devise]
  const montres = useMemo(() => rows.filter((r) => visible(r, filtre, q)), [rows, filtre, q])

  // Le récurrent : ce qui est signé et actif, `monthly_amount` tel que la base
  // le calcule aux prix figés. Ni les essais (ils ne doivent rien), ni les
  // impayées (rien n'est sûr). Les deux devises ne s'additionnent jamais :
  // un dinar et un euro dans la même case, c'est un chiffre faux.
  const kpis = useMemo(() => {
    const actives = rows.filter((r) => r.status === 'active')
    const somme = (cur: Currency, champ: 'monthly_amount' | 'annual_amount') =>
      actives.filter((r) => (r.currency ?? 'TND') === cur).reduce((s, r) => s + Number(r[champ] ?? 0), 0)
    return {
      mrrTnd: somme('TND', 'monthly_amount'), mrrEur: somme('EUR', 'monthly_amount'),
      arrTnd: somme('TND', 'annual_amount'), arrEur: somme('EUR', 'annual_amount'),
      actives: actives.length,
      essais: rows.filter((r) => r.status === 'essai').length,
      impayees: rows.filter((r) => r.status === 'impayee' || r.status === 'suspendue' || r.suspended).length,
      comptes: actives.reduce((s, r) => s + Number(r.seats_allowed ?? 0), 0),
      comptesIllimites: actives.some((r) => r.seats_allowed === null),
      depassements: rows.filter((r) => r.over.length > 0).length,
    }
  }, [rows])

  // ?agence=<uuid> ouvre directement « Modifier » pour cette agence, une fois.
  const cible = params.get('agence')
  const traite = useRef<string | null>(null)
  useEffect(() => {
    if (!data || !cible || traite.current === cible) return
    traite.current = cible
    const row = rows.find((r) => r.agency_id === cible)
    if (!row) { toast('Cette agence n’a pas d’abonnement.'); return }
    if (!visible(row, filtre, q)) { setFiltre('tous'); setQ('') }
    window.setTimeout(() => {
      document.getElementById(`fi-${cible}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 60)
    if (can('abonnements.modifier')) setEditing(row)
    else setJournal(row)
    const next = new URLSearchParams(params)
    next.delete('agence')
    setParams(next, { replace: true })
  }, [data, rows, cible, filtre, q, params, setParams, toast, can])

  const recompter = async () => {
    setBusy(true)
    try {
      const n = await refreshUsageAll()
      toast(`Consommation recomptée pour ${nb(n)} ${n === 1 ? 'agence' : 'agences'}.`)
      void reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Recompte impossible.')
    } finally { setBusy(false) }
  }

  const exporter = () => telechargerCsv(`abonnements-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Agence', 'Slug', 'Pays', 'Formule', 'État', 'Devise', 'Comptes autorisés', 'Comptes réels', 'Bureaux en plus', 'Comptes en plus', 'Mensuel', 'Annuel', 'Remise %', 'Remise', 'Remise jusqu’au', 'Période', 'Échéance', 'Dépassements'],
    ...montres.map((r) => [
      r.name, r.slug, r.country, r.plan_name, r.status, r.currency, r.seats_allowed, r.usage.users,
      r.extra_offices, r.extra_users, r.monthly_amount, r.annual_amount, r.discount_pct, r.discount_label, r.discount_until,
      r.billing_period, r.renewal_on, r.over.map((o) => RESSOURCES[o] ?? o).join(', '),
    ]),
  ])

  const peutModifier = can('abonnements.modifier')

  return (
    <div className="fi-page">
      <PageHeader
        kicker="Argent"
        title="Abonnements"
        subtitle="La formule, les ajouts, l’échéance de chaque agence."
        refreshing={refreshing}
        actions={<>
          <Button icon="download" onClick={exporter} disabled={montres.length === 0}>Exporter CSV</Button>
          {peutModifier && <Button icon="refresh" onClick={() => void recompter()} disabled={busy}>{busy ? 'Recompte…' : 'Recalculer la consommation'}</Button>}
          <Button icon="refresh" onClick={() => void reload()} disabled={refreshing}>Actualiser</Button>
        </>}
      />

      {error && <Erreur message={error} onRetry={() => void reload()} />}

      {loading && !data ? (
        <>
          <Squelette type="kpis" n={7} />
          <Squelette type="cartes" n={3} />
          <Section flush><Squelette type="table" n={6} /></Section>
        </>
      ) : (
        <>
          <KpiGrid>
            <Kpi label="Récurrent mensuel TND" value={money(kpis.mrrTnd, 'TND')} tone="green" hint="abonnements actifs, prix figés" icon="payments" />
            <Kpi label="Récurrent mensuel EUR" value={money(kpis.mrrEur, 'EUR')} tone={kpis.mrrEur > 0 ? 'green' : undefined} hint="l’export, jamais additionné au dinar" icon="payments" />
            <Kpi label="Annuel" value={money(kpis.arrTnd, 'TND')} hint={kpis.arrEur > 0 ? `et ${money(kpis.arrEur, 'EUR')}` : 'ce que valent les périodes signées'} />
            <Kpi label="Actives" value={nb(kpis.actives)} tone="green" hint={`sur ${nb(rows.length)} agences`} icon="check" />
            <Kpi label="En essai" value={nb(kpis.essais)} tone="blue" icon="sparkle" />
            <Kpi label="Impayées ou suspendues" value={nb(kpis.impayees)} tone={kpis.impayees > 0 ? 'red' : undefined} to="/admin/facturation" hint="voir la facturation" icon="alert" />
            <Kpi label="Comptes autorisés" value={`${nb(kpis.comptes)}${kpis.comptesIllimites ? ' +∞' : ''}`} hint={kpis.depassements > 0 ? `${nb(kpis.depassements)} en dépassement de quota` : 'aucun dépassement'} icon="grid" />
          </KpiGrid>

          <Section
            title="La grille"
            action={<Segmented<Currency> value={devise} onChange={setDevise} label="Devise" options={DEVISES.map((d) => ({ value: d, label: d }))} />}
          >
            {grille.length === 0 ? <Vide title={`Aucune formule en ${devise}.`} hint="La grille se pose en base, table plans, une ligne par devise." /> : (
              <div className="fi-plans">
                {FORMULES.map((code) => {
                  const p = planParCode(grille, code)
                  return p ? <Formule key={code} plan={p} agences={rows.filter((r) => (r.plan_code ?? r.plan) === code && (r.currency ?? 'TND') === devise).length} /> : null
                })}
              </div>
            )}
            {grille.length > 0 && <Simulateur plans={grille} />}
          </Section>

          <Section
            title="Les souscriptions"
            flush
            action={<span className="t-caption t-tertiary t-num">{nb(montres.length)} / {nb(rows.length)}</span>}
          >
            <Barre right={
              <Input className="fi-recherche" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, slug ou formule" aria-label="Rechercher" />
            }>
              <Segmented<Filtre>
                value={filtre}
                onChange={setFiltre}
                label="Filtre"
                options={[
                  { value: 'tous', label: `Toutes · ${rows.length}` },
                  { value: 'actives', label: `Actives · ${kpis.actives}` },
                  { value: 'essais', label: `Essais · ${kpis.essais}` },
                  { value: 'attention', label: `À voir · ${rows.filter(aVoir).length}` },
                ]}
              />
            </Barre>

            {montres.length === 0 ? (
              <Vide title={rows.length === 0 ? 'Aucune souscription.' : 'Rien dans ce filtre.'} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Agence</th><th>Formule</th><th>État</th><th>Comptes</th><th>Ajouts</th><th>Quotas</th>
                    <th className="num">Mensuel</th><th className="num">Annuel</th><th>Période</th><th>Échéance</th><th className="actions" />
                  </tr>
                </thead>
                <tbody>
                  {montres.map((r) => {
                    const j = joursAvant(r.renewal_on)
                    const cur = r.currency ?? 'TND'
                    const remise = Number(r.discount_pct ?? 0)
                    return (
                      <tr key={r.agency_id} id={`fi-${r.agency_id}`} className={`${r.suspended ? 'adm-row--off' : ''} ${r.agency_id === cible ? 'fi-row--cible' : ''}`}>
                        <td>
                          <div className="adm-cell-main">
                            <Link to={`/admin/agences/${r.agency_id}`}>{r.name}</Link>
                            <span className="t-caption t-mono">{r.slug}</span>
                          </div>
                        </td>
                        <td className="t-small">
                          <div className="adm-cell-main">
                            <span>{r.plan_name ?? nomFormule(grilles[cur as Currency] ?? [], r.plan_code ?? r.plan)}</span>
                            <span className="t-caption t-mono">{cur}</span>
                          </div>
                        </td>
                        <td>
                          <span className="row gap-1 wrap">
                            <Etat etat={r.status} dot />
                            {r.suspended && r.status !== 'suspendue' && <Pill tone="red">Accès coupé</Pill>}
                          </span>
                        </td>
                        <td><Comptes row={r} /></td>
                        <td className="t-small">{ajouts(r) || <span className="t-tertiary">socle seul</span>}</td>
                        <td><Conso row={r} /></td>
                        <td className="num t-num">{r.status === 'essai' ? <span className="t-tertiary">essai</span> : money(Number(r.monthly_amount ?? 0), cur)}</td>
                        <td className="num t-num">
                          <div className="adm-cell-main" style={{ alignItems: 'flex-end' }}>
                            <span>{r.status === 'essai' ? <span className="t-tertiary">rien n’est dû</span> : money(Number(r.annual_amount ?? 0), cur)}</span>
                            {remise > 0 && <span className="t-caption" style={{ color: 'var(--green)' }}>−{nb(remise)} %{r.discount_label ? ` · ${r.discount_label}` : ''}{r.discount_until ? ` · jusqu’au ${dateFr(r.discount_until)}` : ''}</span>}
                          </div>
                        </td>
                        <td className="t-small">{r.billing_period ? PERIODES[r.billing_period] ?? r.billing_period : '·'}</td>
                        <td>
                          <div className={`fi-echeance ${j !== null && j <= 3 ? 'fi-echeance--urgent' : ''}`}>
                            <span className="fi-echeance__mot t-small">{r.renewal_on ? delai(j) : '·'}</span>
                            {r.renewal_on && <span className="fi-echeance__date">{dateFr(r.renewal_on)}</span>}
                          </div>
                        </td>
                        <td className="actions">
                          <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                            {peutModifier && <Button size="sm" variant="primary" icon="edit" onClick={() => setEditing(r)}>Modifier</Button>}
                            <Button size="sm" icon="clock" onClick={() => setJournal(r)}>Journal</Button>
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
              L’abonnement se règle sur facture TTN, par virement, hors taxes. La facture porte des unités : « 1 licence
              Active, 12 mois », « 2 comptes × 12 mois », quantifiables comme l’exige l’article 3 de la circulaire BCT 2016-09.
              Les prix d’une souscription sont figés à sa signature.
            </p>
          </Section>
        </>
      )}

      {editing && (
        <FormeAbonnement
          row={editing}
          grilles={grilles}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); void reload(); rafraichirCompteurs() }}
        />
      )}
      {journal && <Journal row={journal} onClose={() => setJournal(null)} />}
    </div>
  )
}

/* ------------------------------ Une formule --------------------------- */

/** Une carte par formule. Tout ce qu'elle affiche vient de la ligne `public_plans`. */
function Formule({ plan: p, agences }: { plan: PublicPlan; agences: number }) {
  const cur = p.currency
  return (
    <div className={`fi-plan ${agences > 0 ? 'fi-plan--vivant' : ''}`}>
      <div className="fi-plan__head">
        <span className="fi-plan__nom">{p.name}</span>
        <Pill tone={agences > 0 ? 'blue' : 'gray'}>{nb(agences)} {agences === 1 ? 'agence' : 'agences'}</Pill>
      </div>
      <div>
        <div className="fi-plan__prix t-num">{p.code === 'essai' ? `${nb(p.trial_days)} jours` : money(p.base_price_month, cur)}</div>
        <div className="fi-plan__unite">
          {p.code === 'essai' ? 'tout ouvert, sans carte, sans engagement'
            : `par mois, HT · ${money(p.base_price_month * 12, cur)} par an${p.semester_allowed ? ` · semestre × ${nb(p.semester_factor)}` : ''}`}
        </div>
      </div>

      {p.code === 'active' && (
        <>
          <ul className="fi-plan__limites">
            <li><span>Le socle</span><span>{money(p.base_price_month, cur)}</span></li>
            <li><span>Comptes</span><span>{lim(p.max_users)}</span></li>
            <li><span>Bureaux</span><span>{lim(p.max_offices)}</span></li>
            <li><span>Dossiers actifs</span><span>{lim(p.max_active_cases)}</span></li>
            <li><span>Cargaisons actives</span><span>{lim(p.max_active_shipments)}</span></li>
            <li><span>Stockage</span><span>{go(p.max_storage_mb)}</span></li>
            {p.support_hours_month !== null && <li><span>Assistance</span><span>{nb(p.support_hours_month)} h par mois</span></li>}
          </ul>
          <ul className="fi-plan__limites fi-plan__limites--ajouts">
            <li className="fi-plan__ajout">
              <span>Compte en plus</span>
              <span>{p.extra_user_price_month !== null ? `+${money(p.extra_user_price_month, cur)}` : '·'}</span>
            </li>
            <li className="fi-plan__detail">tout rôle, +{go(p.extra_user_storage_mb)} de stockage</li>
            <li className="fi-plan__ajout">
              <span>Bureau en plus</span>
              <span>{p.extra_office_price_month !== null ? `+${money(p.extra_office_price_month, cur)}` : '·'}</span>
            </li>
            <li className="fi-plan__detail">
              cloisonné, avec {nb(p.office_included_users)} comptes, {nb(p.office_included_cases)} dossiers, {nb(p.office_included_shipments)} cargaisons,
              {' '}{go(p.office_included_storage_mb)}{p.office_support_hours_month !== null ? `, ${nb(p.office_support_hours_month)} h d’assistance` : ''}
            </li>
          </ul>
        </>
      )}

      {p.code === 'premium' && (
        <ul className="fi-plan__limites">
          <li><span>Comptes, bureaux, dossiers</span><span>∞</span></li>
          {p.fair_use_users !== null && <li><span>Usage raisonnable, comptes</span><span>{nb(p.fair_use_users)}</span></li>}
          {p.fair_use_offices !== null && <li><span>Usage raisonnable, bureaux</span><span>{nb(p.fair_use_offices)}</span></li>}
          {p.fair_use_storage_mb_per_user !== null && <li><span>Stockage par compte</span><span>{go(p.fair_use_storage_mb_per_user)}{p.fair_use_storage_min_mb !== null ? `, min. ${go(p.fair_use_storage_min_mb)}` : ''}</span></li>}
          {p.support_hours_month !== null && <li><span>Assistance prioritaire</span><span>{nb(p.support_hours_month)} h par mois</span></li>}
          <li><span>En plus d’Active</span><span>rapports, API, marque blanche, rôles</span></li>
        </ul>
      )}

      {p.code === 'essai' && (
        <ul className="fi-plan__limites">
          <li><span>Durée</span><span>{nb(p.trial_days)} j, puis {nb(p.grace_days)} j de grâce</span></li>
          <li><span>Comptes</span><span>{lim(p.max_users)}</span></li>
          <li><span>Bureaux</span><span>{lim(p.max_offices)}</span></li>
          <li><span>Dossiers actifs</span><span>{lim(p.max_active_cases)}</span></li>
          <li><span>Cargaisons actives</span><span>{lim(p.max_active_shipments)}</span></li>
          <li><span>Stockage</span><span>{go(p.max_storage_mb)}</span></li>
          <li><span>Fonctions</span><span>toutes celles de Premium</span></li>
        </ul>
      )}

      {p.note && <p className="fi-plan__note">{p.note}</p>}
    </div>
  )
}

/* ------------------------------ Le simulateur -------------------------- */

/** Deux champs, une réponse : la formule conseillée, le mensuel, l'annuel,
 *  les lignes, et le point où Premium devient moins cher. Le calcul est celui
 *  de data/grille.ts, le même que la page publique. */
function Simulateur({ plans }: { plans: PublicPlan[] }) {
  const [comptes, setComptes] = useState('4')
  const [bureaux, setBureaux] = useState('1')
  const n = Math.max(1, Math.floor(Number(comptes) || 1))
  const b = Math.max(1, Math.floor(Number(bureaux) || 1))
  const e = estimer(plans, n, b)
  const cur = plans[0]?.currency ?? 'TND'
  const point = bascule(plans, b)
  const premium = planParCode(plans, 'premium')
  return (
    <div className="fi-simu">
      <div className="fi-simu__champs">
        <Field label="Comptes"><Input type="number" min={1} step={1} inputMode="numeric" value={comptes} onChange={(ev) => setComptes(ev.target.value)} /></Field>
        <Field label="Bureaux"><Input type="number" min={1} step={1} inputMode="numeric" value={bureaux} onChange={(ev) => setBureaux(ev.target.value)} /></Field>
      </div>
      {!e ? <p className="t-small t-tertiary" style={{ margin: 0 }}>La grille est incomplète : il manque Active ou Premium.</p> : (
        <div className="fi-simu__resultat">
          <div className="row gap-3 wrap" style={{ alignItems: 'baseline' }}>
            <span className="t-caption t-tertiary">Conseillé</span>
            <Pill tone={e.conseille === 'devis' ? 'orange' : e.conseille === 'premium' ? 'violet' : 'green'}>
              {e.conseille === 'devis' ? 'Sur devis' : nomFormule(plans, e.conseille)}
            </Pill>
            <span className="grow" />
            <span className="t-title t-num" style={{ fontSize: 'var(--size-lead)' }}>{money(e.mensuel, cur)} <span className="t-caption t-tertiary">par mois</span></span>
            <span className="t-num t-secondary">{money(e.annuel, cur)} <span className="t-caption t-tertiary">par an</span></span>
          </div>
          <ul className="fi-simu__lignes">
            {e.lignes.map((l) => (
              <li key={l.label}>
                <span>{LIGNES[l.label]}</span>
                <span className="t-caption t-tertiary">{nb(l.quantite)} × {money(l.unitaire, cur)}</span>
                <span className="t-num">{money(l.total, cur)}</span>
              </li>
            ))}
          </ul>
          <p className="t-caption t-tertiary" style={{ margin: 0 }}>
            {e.conseille === 'devis' && premium
              ? `Au-delà de l’usage raisonnable de Premium (${nb(premium.fair_use_users ?? 0)} comptes, ${nb(premium.fair_use_offices ?? 0)} bureaux) : devis « Premium Réseau ».`
              : e.conseille === 'premium' && e.activeMensuel !== null
                ? `Active coûterait ${money(e.activeMensuel, cur)} par mois : Premium fait gagner ${nb(Math.round((1 - e.mensuel / e.activeMensuel) * 100))} %.`
                : e.alternative
                  ? `Premium en alternative : ${money(e.alternative.mensuel, cur)} par mois, ${money(e.alternative.annuel, cur)} par an.`
                  : ''}
            {point !== null && point > 0 && ` Avec ${nb(b)} ${b === 1 ? 'bureau' : 'bureaux'}, Premium devient moins cher à partir de ${nb(point)} comptes.`}
            {point === 0 && ' À ce nombre de bureaux, Premium est moins cher dès le socle.'}
          </p>
        </div>
      )}
    </div>
  )
}

/* ------------------------------- Comptes ------------------------------ */

/** Les comptes réels sur les comptes autorisés : c'est l'écart que le commercial regarde. */
function Comptes({ row }: { row: SubscriptionRow }) {
  const utilises = row.usage.users
  const autorises = row.seats_allowed
  if (autorises === null) return <span className="t-small t-num">{nb(utilises)} <span className="t-tertiary">/ ∞</span></span>
  const pct = autorises > 0 ? pourcentage(utilises, autorises) : null
  const trop = autorises > 0 && utilises > autorises
  return (
    <div className={`fi-sieges ${trop ? 'fi-sieges--depasse' : ''}`}>
      <span className="fi-sieges__txt t-small">
        {nb(utilises)} / {autorises > 0 ? nb(autorises) : <span className="t-tertiary">aucun</span>}
      </span>
      {pct !== null && <Progress pct={pct} tone={trop || alerte(utilises, autorises) ? 'orange' : 'green'} label="Comptes" valueText={`${nb(utilises)} sur ${nb(autorises)}`} />}
    </div>
  )
}

/* La consommation en une cellule : ce qui approche ou dépasse d'abord, le
   reste replié. Six jauges par ligne noieraient la seule qui compte. */
function Conso({ row }: { row: SubscriptionRow }) {
  const items: { cle: string; utilise: number; limite: number | null }[] = [
    { cle: 'offices', utilise: row.usage.offices, limite: row.limits.offices },
    { cle: 'cases', utilise: row.usage.cases, limite: row.limits.cases },
    { cle: 'shipments', utilise: row.usage.shipments, limite: row.limits.shipments },
    { cle: 'storage', utilise: enMo(row.usage.storage_bytes), limite: row.limits.storage_mb },
  ]
  const chauds = items.filter((i) => depasse(i.utilise, i.limite) || alerte(i.utilise, i.limite))
  const montres = chauds.length > 0 ? chauds : items.slice(0, 2)
  return (
    <div className="fi-conso">
      {montres.map((i) => (
        <span key={i.cle}>
          <span className="t-tertiary">{RESSOURCES[i.cle]} </span>
          <span className={`fi-conso__val ${depasse(i.utilise, i.limite) ? 'fi-conso__val--depasse' : ''}`}>
            {i.cle === 'storage' ? taille(row.usage.storage_bytes, nb) : nb(i.utilise)}
            {illimite(i.limite) ? ' / ∞' : ` / ${nb(i.limite as number)}${i.cle === 'storage' ? ' Mo' : ''}`}
          </span>
        </span>
      ))}
      <span className="t-tertiary">{nb(row.usage.clients)} clients{row.computed_at ? ` · ${dateFr(row.computed_at)}` : ''}</span>
    </div>
  )
}

/* --------------------------- Poser une formule ------------------------ */

/** La remise ne dépasse jamais 15 % : lancement ou FTAV, la meilleure des deux, jamais le cumul. */
const REMISE_MAX = 15

/** Le montant se recalcule sous les yeux, décomposé : c'est exactement la ligne
 *  qui partira sur la facture, et la voir avant d'appuyer évite de la découvrir après. */
function FormeAbonnement({ row, grilles, onClose, onDone }: {
  row: SubscriptionRow
  grilles: Record<Currency, PublicPlan[]>
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [plan, setPlan] = useState<PlanCode>(row.plan_code ?? row.plan)
  const [devise, setDevise] = useState<Currency>((row.currency === 'EUR' ? 'EUR' : 'TND'))
  const [periode, setPeriode] = useState<BillingPeriod>(row.billing_period === 'semestriel' ? 'semestriel' : 'annuel')
  const [bureaux, setBureaux] = useState(String(row.extra_offices ?? 0))
  const [comptes, setComptes] = useState(String(row.extra_users ?? 0))
  const [remise, setRemise] = useState(String(row.discount_pct ?? 0))
  const [remiseLibelle, setRemiseLibelle] = useState(row.discount_label ?? '')
  const [remiseJusquau, setRemiseJusquau] = useState(row.discount_until ?? '')
  const [renewal, setRenewal] = useState(row.renewal_on ?? '')
  const [statut, setStatut] = useState<SubscriptionStatus>(row.status)
  const [busy, setBusy] = useState(false)

  const grille = grilles[devise]
  const choisi = planParCode(grille, plan)
  const extraOffices = Math.max(0, Math.floor(Number(bureaux) || 0))
  const extraUsers = Math.max(0, Math.floor(Number(comptes) || 0))
  const pct = Math.max(0, Math.floor(Number(remise) || 0))
  const semestrePermis = choisi?.semester_allowed ?? false
  const periodeEffective: BillingPeriod = periode === 'semestriel' && !semestrePermis ? 'annuel' : periode

  // Le montant, avec les prix de la grille choisie. Si la formule ET la devise
  // ne changent pas, ce sont les prix figés de la souscription qui comptent :
  // on les glisse à la place de ceux de la grille pour que l'aperçu soit vrai.
  const memeGrille = choisi && choisi.code === (row.plan_code ?? row.plan) && devise === (row.currency ?? 'TND')
  const base: PublicPlan | undefined = choisi && memeGrille ? {
    ...choisi,
    base_price_month: Number(row.base_price_month ?? choisi.base_price_month),
    extra_user_price_month: row.extra_user_price_month ?? choisi.extra_user_price_month,
    extra_office_price_month: row.extra_office_price_month ?? choisi.extra_office_price_month,
  } : choisi
  const montant = base ? montantSouscription({
    plan: base, extraUsers, extraOffices, periode: periodeEffective,
    remisePct: Math.min(pct, REMISE_MAX), remiseJusquau: remiseJusquau || null,
  }) : null
  const autorises = base ? comptesAutorises(base, extraUsers, extraOffices) : null
  const bureauxOk = base ? bureauxAutorises(base, extraOffices) : null

  // La formule choisie couvre-t-elle ce que l'agence utilise DÉJÀ ? Le dire
  // avant de valider vaut mieux que de la mettre en dépassement puis de s'en étonner.
  const trop: string[] = []
  if (base) {
    if (autorises !== null && row.usage.users > autorises) trop.push(`${nb(row.usage.users)} comptes pour ${nb(autorises)}`)
    if (bureauxOk !== null && row.usage.offices > bureauxOk) trop.push(`${nb(row.usage.offices)} bureaux pour ${nb(bureauxOk)}`)
    const dossiers = base.max_active_cases === null ? null : base.max_active_cases + extraOffices * base.office_included_cases
    if (dossiers !== null && row.usage.cases > dossiers) trop.push(`${nb(row.usage.cases)} dossiers pour ${nb(dossiers)}`)
    const cargaisons = base.max_active_shipments === null ? null : base.max_active_shipments + extraOffices * base.office_included_shipments
    if (cargaisons !== null && row.usage.shipments > cargaisons) trop.push(`${nb(row.usage.shipments)} cargaisons pour ${nb(cargaisons)}`)
  }

  const erreurRemise = pct > REMISE_MAX ? `Plafond de toute remise : ${REMISE_MAX} %. Lancement ou FTAV, la meilleure des deux, jamais le cumul.` : undefined

  const enregistrer = async () => {
    setBusy(true)
    try {
      const out = await setSubscription({
        agencyId: row.agency_id, plan, renewalOn: renewal || null, status: statut,
        extraUsers: plan === 'active' ? extraUsers : 0,
        extraOffices: plan === 'active' ? extraOffices : 0,
        billingPeriod: periodeEffective,
        discountPct: Math.min(pct, REMISE_MAX),
        discountLabel: remiseLibelle.trim() || null,
        discountUntil: remiseJusquau || null,
        currency: devise,
      })
      const prorata = out.prorata !== null && out.prorata !== undefined ? Number(out.prorata) : 0
      toast(prorata > 0
        ? `Abonnement de ${row.name} enregistré. Ajout en cours de période : ${money(prorata, devise)} au prorata, à facturer à la main.`
        : `Abonnement de ${row.name} enregistré : ${money(Number(out.monthly_amount ?? 0), devise)} par mois.`)
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Enregistrement impossible.')
    } finally { setBusy(false) }
  }

  return (
    <Modal
      title={`Abonnement · ${row.name}`}
      onClose={onClose}
      wide
      footer={<>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" icon="save" disabled={busy || Boolean(erreurRemise) || !choisi} onClick={() => void enregistrer()}>{busy ? 'En cours…' : 'Enregistrer'}</Button>
      </>}
    >
      <div className="col gap-4">
        <div className="fi-deux">
          <Field label="Formule">
            <Select value={plan} onChange={(e) => setPlan(e.target.value as PlanCode)}>
              {FORMULES.map((code) => {
                const p = planParCode(grille, code)
                return <option key={code} value={code} disabled={!p}>{p ? `${p.name} · ${code === 'essai' ? `${nb(p.trial_days)} j` : `${money(p.base_price_month, devise)} par mois`}` : code}</option>
              })}
            </Select>
          </Field>
          <Field label="Devise" hint="TND pour la Tunisie et la Libye, EUR pour l’export.">
            <Select value={devise} onChange={(e) => setDevise(e.target.value as Currency)}>
              {DEVISES.map((d) => <option key={d} value={d} disabled={grilles[d].length === 0}>{d}</option>)}
            </Select>
          </Field>
          <Field label="Période" hint={semestrePermis && choisi ? `Semestre : mensuel × 6 × ${nb(choisi.semester_factor)}, deux factures par an. Tunisie, Maroc, UEMOA.` : 'L’annuel est le prix. Le semestre n’est pas permis sur cette formule.'}>
            <Select value={periodeEffective} onChange={(e) => setPeriode(e.target.value as BillingPeriod)}>
              <option value="annuel">Annuel</option>
              {semestrePermis && <option value="semestriel">Semestriel (× {nb(choisi?.semester_factor ?? 1)})</option>}
            </Select>
          </Field>
          <Field label="État">
            <Select value={statut} onChange={(e) => setStatut(e.target.value as SubscriptionStatus)}>
              {STATUTS.map((s) => <option key={s} value={s}>{libelleStatut(s)}</option>)}
            </Select>
          </Field>
        </div>

        {plan === 'active' && (
          <div className="fi-deux">
            <Field label="Bureaux en plus" hint={choisi?.extra_office_price_month !== null && choisi ? `${money(choisi.extra_office_price_month, devise)} par mois chacun, avec ${nb(choisi.office_included_users)} comptes.` : undefined}>
              <Input type="number" min={0} step={1} inputMode="numeric" value={bureaux} onChange={(e) => setBureaux(e.target.value)} />
            </Field>
            <Field label="Comptes en plus" hint={`${nb(row.usage.users)} comptes réels aujourd’hui${autorises !== null ? `, ${nb(autorises)} autorisés avec ce réglage` : ''}.`} error={autorises !== null && row.usage.users > autorises ? 'Moins de comptes autorisés que de comptes réels : elle ne pourra plus en ajouter.' : undefined}>
              <Input type="number" min={0} step={1} inputMode="numeric" value={comptes} onChange={(e) => setComptes(e.target.value)} />
            </Field>
          </div>
        )}

        <div className="fi-trois">
          <Field label="Remise (%)" hint={`Au plus ${REMISE_MAX} %.`} error={erreurRemise}>
            <Input type="number" min={0} max={REMISE_MAX} step={1} inputMode="numeric" value={remise} onChange={(e) => setRemise(e.target.value)} />
          </Field>
          <Field label="Libellé de la remise">
            <Input value={remiseLibelle} onChange={(e) => setRemiseLibelle(e.target.value)} placeholder="Lancement 2027, FTAV…" />
          </Field>
          <Field label="Jusqu’au" hint="Vide : sans fin.">
            <Input type="date" value={remiseJusquau} onChange={(e) => setRemiseJusquau(e.target.value)} />
          </Field>
        </div>

        <Field label="Échéance" hint="La date du prochain renouvellement.">
          <Input type="date" value={renewal} onChange={(e) => setRenewal(e.target.value)} />
        </Field>

        {choisi?.note && <p className="t-caption t-tertiary" style={{ margin: 0 }}>{choisi.note}</p>}

        <Card title="La ligne de facture">
          {!montant ? <p className="t-small t-tertiary" style={{ margin: 0 }}>Cette formule n’existe pas en {devise}.</p> : plan === 'essai' ? (
            <p className="t-small t-secondary" style={{ margin: 0 }}>Rien n’est dû pendant l’essai.</p>
          ) : (
            <>
              <p className="t-title t-num" style={{ fontSize: 'var(--size-h4)', margin: 0 }}>
                {money(montant.montant, devise)} <span className="t-caption t-tertiary">HT {periodeEffective === 'semestriel' ? 'par semestre' : 'par an'}</span>
              </p>
              <ul className="fi-simu__lignes" style={{ marginTop: 'var(--sp-2)' }}>
                {montant.lignes.map((l) => (
                  <li key={l.label}>
                    <span>{LIGNES[l.label]}</span>
                    <span className="t-caption t-tertiary">{nb(l.quantite)} × {money(l.unitaire, devise)}</span>
                    <span className="t-num">{money(l.total, devise)}</span>
                  </li>
                ))}
                <li>
                  <span>Mensuel</span>
                  <span className="t-caption t-tertiary">× {nb(montant.mois)} mois{montant.facteur !== 1 ? ` × ${nb(montant.facteur)}` : ''}</span>
                  <span className="t-num">{money(montant.brut, devise)}</span>
                </li>
                {montant.remiseAppliquee && (
                  <li>
                    <span>Remise{remiseLibelle.trim() ? ` · ${remiseLibelle.trim()}` : ''}</span>
                    <span className="t-caption t-tertiary">−{nb(Math.min(pct, REMISE_MAX))} %</span>
                    <span className="t-num" style={{ color: 'var(--green)' }}>−{money(montant.brut - montant.montant, devise)}</span>
                  </li>
                )}
              </ul>
              <p className="t-caption t-tertiary" style={{ margin: 'var(--sp-2) 0 0' }}>
                {money(montant.mensuel, devise)} par mois · {autorises === null ? 'comptes sans limite' : `${nb(autorises)} comptes autorisés`}
                {bureauxOk === null ? ', bureaux sans limite' : `, ${nb(bureauxOk)} ${bureauxOk === 1 ? 'bureau' : 'bureaux'}`}.
                {memeGrille ? ' Prix figés de la souscription.' : ' Prix de la grille en vigueur : ils seront figés à l’enregistrement.'}
                {' '}Un ajout en cours de période se facture au prorata des mois restants ; le montant vous sera rendu après enregistrement.
              </p>
            </>
          )}
        </Card>

        {trop.length > 0 && (
          <p className="t-small" style={{ color: 'var(--orange)', margin: 0 }}>
            Ce réglage est plus petit que ce que l’agence utilise : {trop.join(', ')}.
            Rien ne sera effacé, mais elle ne pourra plus rien ajouter.
          </p>
        )}
        {statut === 'resiliee' && (
          <p className="t-small" style={{ color: 'var(--red)', margin: 0 }}>
            Résilier coupe l’accès aux fonctionnalités de la formule. Les données restent en place.
          </p>
        )}
        {statut === 'suspendue' && (
          <p className="t-small" style={{ color: 'var(--red)', margin: 0 }}>
            Suspendre coupe l’accès de l’agence. Pour la rouvrir, passez par la facturation.
          </p>
        )}
      </div>
    </Modal>
  )
}

function libelleStatut(s: SubscriptionStatus): string {
  return s === 'essai' ? 'Essai' : s === 'active' ? 'Active' : s === 'impayee' ? 'Impayée' : s === 'resiliee' ? 'Résiliée' : 'Suspendue'
}

/* ------------------------------ Le journal ---------------------------- */

/** L'histoire de l'abonnement : qui a changé quoi, quand, pour quel montant.
 *  C'est ce qu'on relit quand une agence conteste une facture. */
function Journal({ row, onClose }: { row: SubscriptionRow; onClose: () => void }) {
  const { data, loading, error, reload } = useChargement(() => loadSubscriptionEvents(row.agency_id), [row.agency_id])
  return (
    <Modal title={`Journal · ${row.name}`} onClose={onClose} wide footer={<Button onClick={onClose}>Fermer</Button>}>
      {loading && !data ? <Squelette type="table" n={4} />
        : error ? <Erreur message={error} onRetry={() => void reload()} />
        : !data || data.length === 0 ? <Vide title="Rien encore." hint="Le journal se remplit au premier changement." />
        : (
          <Table>
            <thead><tr><th>Quand</th><th>Quoi</th><th>Détail</th><th>Par</th></tr></thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id}>
                  <td className="t-small">{dateHeure(e.at)}</td>
                  <td className="t-small t-medium">{EVENEMENTS[e.kind] ?? e.kind}</td>
                  <td className="t-caption t-mono">{resume(e, row.currency ?? 'TND')}</td>
                  <td className="t-caption t-tertiary">{e.by ?? 'plateforme'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
    </Modal>
  )
}

/** Le détail d'un événement, en une phrase lisible. Le jsonb brut est juste
 *  sous la main en base ; ici on veut la version qu'on lit au téléphone. */
function resume(e: SubscriptionEvent, devise: string): string {
  const d = e.detail
  const s = (k: string) => (d[k] === null || d[k] === undefined ? null : String(d[k]))
  if (e.kind === 'quota_depasse') {
    const r = Array.isArray(d.ressources) ? (d.ressources as string[]) : []
    return r.map((x) => RESSOURCES[x] ?? x).join(', ')
  }
  const bouts: string[] = []
  if (s('plan_avant') && s('plan_avant') !== s('plan')) bouts.push(`${s('plan_avant')} → ${s('plan')}`)
  else if (s('plan')) bouts.push(String(s('plan')))
  if (s('extra_offices') && Number(s('extra_offices')) > 0) bouts.push(`+${s('extra_offices')} bureaux`)
  if (s('extra_users') && Number(s('extra_users')) > 0) bouts.push(`+${s('extra_users')} comptes`)
  if (s('sieges') && !s('extra_users')) bouts.push(`${s('sieges')} sièges`)
  if (s('montant_mensuel')) bouts.push(`${money(Number(s('montant_mensuel')), devise)} par mois`)
  if (s('montant_annuel')) bouts.push(money(Number(s('montant_annuel')), devise))
  if (s('prorata') && Number(s('prorata')) > 0) bouts.push(`prorata ${money(Number(s('prorata')), devise)}`)
  if (s('partiel') === 'true') bouts.push('règlement partiel')
  if (s('solde_du') && Number(s('solde_du')) > 0) bouts.push(`solde dû ${money(Number(s('solde_du')), devise)}`)
  if (s('grace_jusqu_au')) bouts.push(`grâce jusqu’au ${dateFr(s('grace_jusqu_au'))}`)
  if (s('motif')) bouts.push(String(s('motif')).replace(/_/g, ' '))
  if (s('note')) bouts.push(String(s('note')))
  return bouts.join(' · ')
}
