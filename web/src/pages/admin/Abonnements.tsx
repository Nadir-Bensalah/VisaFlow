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
  loadPlans, loadSubscriptionEvents, loadSubscriptions, refreshUsageAll, setSubscription,
  type Plan, type PlanCode, type SubscriptionEvent, type SubscriptionRow, type SubscriptionStatus,
} from '@/data/abonnements'
import { alerte, depasse, enMo, illimite, joursAvant, pourcentage, taille } from '@/lib/quotas'
import '@/styles/admin-finance.css'

/**
 * LES ABONNEMENTS. La formule, les sièges, l'échéance de chaque agence.
 *
 * Cet écran pose un plan et lit une consommation ; il n'encaisse rien. Le
 * prix vient des formules et des souscriptions, jamais d'un chiffre écrit
 * ici : la seule base tarifaire est « par utilisateur et par mois », et la
 * ligne de facture se lit « N sièges × prix × 12 mois ».
 */

/* ------------------------------ Libellés ----------------------------- */

const STATUTS: SubscriptionStatus[] = ['essai', 'active', 'impayee', 'resiliee', 'suspendue']

const RESSOURCES: Record<string, string> = {
  users: 'utilisateurs', offices: 'bureaux', clients: 'clients',
  cases: 'dossiers', shipments: 'cargaisons', storage: 'stockage',
}

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

  const { data, loading, refreshing, error, reload } = useChargement(async () => {
    const [rows, plans] = await Promise.all([loadSubscriptions(), loadPlans()])
    return { rows, plans }
  })

  const [filtre, setFiltre] = useState<Filtre>('tous')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<SubscriptionRow | null>(null)
  const [journal, setJournal] = useState<SubscriptionRow | null>(null)
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => data?.rows ?? [], [data])
  const plans = useMemo(() => data?.plans ?? [], [data])
  const parCode = useMemo(() => new Map(plans.map((p) => [p.code, p])), [plans])
  const montres = useMemo(() => rows.filter((r) => visible(r, filtre, q)), [rows, filtre, q])

  // Le récurrent : ce qui est signé et actif, sièges × prix par mois. Ni les
  // essais (ils ne doivent rien), ni les impayées (rien n'est sûr), ni ce qui
  // est encaissé : une facture émise n'est pas une facture réglée.
  const kpis = useMemo(() => {
    const actives = rows.filter((r) => r.status === 'active')
    const mrr = actives.reduce((s, r) => s + Number(r.seats) * Number(r.price_per_user_month), 0)
    return {
      mrr, arr: mrr * 12,
      actives: actives.length,
      essais: rows.filter((r) => r.status === 'essai').length,
      impayees: rows.filter((r) => r.status === 'impayee' || r.status === 'suspendue' || r.suspended).length,
      sieges: actives.reduce((s, r) => s + Number(r.seats), 0),
      depassements: rows.filter((r) => r.over.length > 0).length,
      devise: actives[0]?.currency ?? rows[0]?.currency ?? 'TND',
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
    ['Agence', 'Slug', 'Pays', 'Formule', 'État', 'Sièges', 'Utilisateurs réels', 'Prix par utilisateur et par mois', 'Devise', 'Période', 'Mensuel', 'Annuel', 'Échéance', 'Dépassements'],
    ...montres.map((r) => [
      r.name, r.slug, r.country, r.plan_name, r.status, r.seats, r.usage.users, r.price_per_user_month, r.currency,
      parCode.get(r.plan)?.billing_period ?? '', Number(r.seats) * Number(r.price_per_user_month), r.annual_amount, r.renewal_on,
      r.over.map((o) => RESSOURCES[o] ?? o).join(', '),
    ]),
  ])

  const peutModifier = can('abonnements.modifier')

  return (
    <div className="fi-page">
      <PageHeader
        kicker="Argent"
        title="Abonnements"
        subtitle="La formule, les sièges, l’échéance de chaque agence."
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
          <Squelette type="kpis" n={6} />
          <Squelette type="cartes" n={3} />
          <Section flush><Squelette type="table" n={6} /></Section>
        </>
      ) : (
        <>
          <KpiGrid>
            <Kpi label="Revenu mensuel récurrent" value={money(kpis.mrr, kpis.devise)} tone="green" hint="abonnements actifs, sièges × prix" icon="payments" />
            <Kpi label="Annuel" value={money(kpis.arr, kpis.devise)} hint="le récurrent × 12" />
            <Kpi label="Actives" value={nb(kpis.actives)} tone="green" hint={`sur ${nb(rows.length)} agences`} icon="check" />
            <Kpi label="En essai" value={nb(kpis.essais)} tone="blue" icon="sparkle" />
            <Kpi label="Impayées ou suspendues" value={nb(kpis.impayees)} tone={kpis.impayees > 0 ? 'red' : undefined} to="/admin/facturation" hint="voir la facturation" icon="alert" />
            <Kpi label="Sièges vendus" value={nb(kpis.sieges)} hint={kpis.depassements > 0 ? `${nb(kpis.depassements)} en dépassement de quota` : 'aucun dépassement'} icon="grid" />
          </KpiGrid>

          <Section title="Formules">
            {plans.length === 0 ? <Vide title="Aucune formule active." hint="La grille se pose en base, table plans." /> : (
              <div className="fi-plans">
                {plans.map((p) => <Formule key={p.id} plan={p} agences={rows.filter((r) => r.plan === p.code).length} />)}
              </div>
            )}
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
                    <th>Agence</th><th>Formule</th><th>État</th><th>Sièges</th><th>Quotas</th>
                    <th className="num">Prix</th><th>Période</th><th>Échéance</th><th className="actions" />
                  </tr>
                </thead>
                <tbody>
                  {montres.map((r) => {
                    const p = parCode.get(r.plan)
                    const j = joursAvant(r.renewal_on)
                    const mensuel = Number(r.seats) * Number(r.price_per_user_month)
                    return (
                      <tr key={r.agency_id} id={`fi-${r.agency_id}`} className={`${r.suspended ? 'adm-row--off' : ''} ${r.agency_id === cible ? 'fi-row--cible' : ''}`}>
                        <td>
                          <div className="adm-cell-main">
                            <Link to={`/admin/agences/${r.agency_id}`}>{r.name}</Link>
                            <span className="t-caption t-mono">{r.slug}</span>
                          </div>
                        </td>
                        <td className="t-small">{r.plan_name}</td>
                        <td>
                          <span className="row gap-1 wrap">
                            <Etat etat={r.status} dot />
                            {r.suspended && r.status !== 'suspendue' && <Pill tone="red">Accès coupé</Pill>}
                          </span>
                        </td>
                        <td><Sieges row={r} /></td>
                        <td><Conso row={r} /></td>
                        <td className="num t-num">
                          <div className="adm-cell-main" style={{ alignItems: 'flex-end' }}>
                            <span>{money(r.price_per_user_month, r.currency)}</span>
                            <span className="t-caption">par utilisateur et par mois</span>
                          </div>
                        </td>
                        <td className="t-small t-num">
                          <div className="adm-cell-main">
                            <span>{r.status === 'essai' ? <span className="t-tertiary">essai</span> : money(p?.billing_period === 'mensuel' ? mensuel : Number(r.annual_amount), r.currency)}</span>
                            <span className="t-caption">{p?.billing_period === 'mensuel' ? 'par mois' : r.status === 'essai' ? 'rien n’est dû' : `par an · ${money(mensuel, r.currency)} par mois`}</span>
                          </div>
                        </td>
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
              L’abonnement se règle sur facture TTN, par virement. La ligne de facture est « sièges × prix par
              utilisateur × 12 mois », quantifiable comme l’exige l’article 3 de la circulaire BCT 2016-09.
            </p>
          </Section>
        </>
      )}

      {editing && (
        <FormeAbonnement
          row={editing}
          plans={plans}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); void reload(); rafraichirCompteurs() }}
        />
      )}
      {journal && <Journal row={journal} onClose={() => setJournal(null)} />}
    </div>
  )
}

/* ------------------------------ Une formule --------------------------- */

function Formule({ plan: p, agences }: { plan: Plan; agences: number }) {
  const lim = (n: number | null, unite = '') => (illimite(n) ? '∞' : `${nb(n as number)}${unite}`)
  return (
    <div className="fi-plan">
      <div className="fi-plan__head">
        <span className="fi-plan__nom">{p.name}</span>
        <Pill tone={agences > 0 ? 'blue' : 'gray'}>{nb(agences)} {agences === 1 ? 'agence' : 'agences'}</Pill>
      </div>
      <div>
        <div className="fi-plan__prix t-num">{money(p.price_per_user_month, p.currency)}</div>
        <div className="fi-plan__unite">par utilisateur et par mois · facturé {p.billing_period === 'mensuel' ? 'au mois' : 'à l’année'}</div>
      </div>
      <ul className="fi-plan__limites">
        {p.trial_days > 0 && <li><span>Essai</span><span>{nb(p.trial_days)} j</span></li>}
        {p.grace_days !== undefined && <li><span>Grâce</span><span>{nb(p.grace_days)} j</span></li>}
        <li><span>Utilisateurs</span><span>{lim(p.max_users)}</span></li>
        <li><span>Bureaux</span><span>{lim(p.max_offices)}</span></li>
        <li><span>Dossiers actifs</span><span>{lim(p.max_active_cases)}</span></li>
        <li><span>Cargaisons actives</span><span>{lim(p.max_active_shipments)}</span></li>
        <li><span>Stockage</span><span>{lim(p.max_storage_mb, ' Mo')}</span></li>
      </ul>
      {p.note && <p className="fi-plan__note">{p.note}</p>}
    </div>
  )
}

/* ------------------------------- Sièges ------------------------------- */

/** Les utilisateurs réels sur les sièges signés : c'est l'écart que le commercial regarde. */
function Sieges({ row }: { row: SubscriptionRow }) {
  const utilises = row.usage.users
  const sieges = Number(row.seats)
  const pct = sieges > 0 ? pourcentage(utilises, sieges) : null
  const trop = sieges > 0 && utilises > sieges
  return (
    <div className={`fi-sieges ${trop ? 'fi-sieges--depasse' : ''}`}>
      <span className="fi-sieges__txt t-small">
        {nb(utilises)} / {sieges > 0 ? nb(sieges) : <span className="t-tertiary">aucun signé</span>}
      </span>
      {pct !== null && <Progress pct={pct} tone={trop || alerte(utilises, sieges) ? 'orange' : 'green'} label="Sièges" valueText={`${nb(utilises)} sur ${nb(sieges)}`} />}
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

/** Le montant se recalcule sous les yeux, décomposé : c'est exactement la ligne
 *  qui partira sur la facture, et la voir avant d'appuyer évite de la découvrir après. */
function FormeAbonnement({ row, plans, onClose, onDone }: {
  row: SubscriptionRow
  plans: Plan[]
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [plan, setPlan] = useState<PlanCode>(row.plan)
  const [seats, setSeats] = useState(String(row.seats || row.usage.users || 1))
  const [renewal, setRenewal] = useState(row.renewal_on ?? '')
  const [statut, setStatut] = useState<SubscriptionStatus>(row.status)
  const [busy, setBusy] = useState(false)

  const choisi = plans.find((p) => p.code === plan)
  const n = Math.max(1, Math.floor(Number(seats) || 1))
  // Le prix de la formule choisie ; celui de la souscription si on ne change pas de formule.
  const prix = choisi && choisi.code !== row.plan ? Number(choisi.price_per_user_month) : Number(row.price_per_user_month)
  const devise = choisi?.currency ?? row.currency
  const mois = choisi?.billing_period === 'mensuel' ? 1 : 12
  const montant = n * prix * mois

  // La formule choisie couvre-t-elle ce que l'agence utilise DÉJÀ ? Le dire
  // avant de valider vaut mieux que de la mettre en dépassement puis de s'en étonner.
  const trop: string[] = []
  if (choisi) {
    if (choisi.max_users !== null && row.usage.users > choisi.max_users) trop.push(`${nb(row.usage.users)} utilisateurs pour ${nb(choisi.max_users)}`)
    if (choisi.max_offices !== null && row.usage.offices > choisi.max_offices) trop.push(`${nb(row.usage.offices)} bureaux pour ${nb(choisi.max_offices)}`)
    if (choisi.max_active_cases !== null && row.usage.cases > choisi.max_active_cases) trop.push(`${nb(row.usage.cases)} dossiers pour ${nb(choisi.max_active_cases)}`)
    if (choisi.max_active_shipments !== null && row.usage.shipments > choisi.max_active_shipments) trop.push(`${nb(row.usage.shipments)} cargaisons pour ${nb(choisi.max_active_shipments)}`)
  }
  const peuDeSieges = row.usage.users > n

  const enregistrer = async () => {
    setBusy(true)
    try {
      await setSubscription({ agencyId: row.agency_id, plan, seats: n, renewalOn: renewal || null, status: statut })
      toast(`Abonnement de ${row.name} enregistré.`)
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Enregistrement impossible.')
    } finally { setBusy(false) }
  }

  return (
    <Modal
      title={`Abonnement · ${row.name}`}
      onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" icon="save" disabled={busy} onClick={() => void enregistrer()}>{busy ? 'En cours…' : 'Enregistrer'}</Button>
      </>}
    >
      <div className="col gap-4">
        <div className="fi-deux">
          <Field label="Formule">
            <Select value={plan} onChange={(e) => setPlan(e.target.value as PlanCode)}>
              {plans.map((p) => <option key={p.code} value={p.code}>{p.name} · {money(p.price_per_user_month, p.currency)}</option>)}
            </Select>
          </Field>
          <Field label="Sièges signés" hint={`${nb(row.usage.users)} utilisateurs réels aujourd’hui.`} error={peuDeSieges ? 'Moins de sièges que d’utilisateurs : elle ne pourra plus en ajouter.' : undefined}>
            <Input type="number" min={1} step={1} inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} />
          </Field>
          <Field label="Échéance" hint="La date du prochain renouvellement.">
            <Input type="date" value={renewal} onChange={(e) => setRenewal(e.target.value)} />
          </Field>
          <Field label="État">
            <Select value={statut} onChange={(e) => setStatut(e.target.value as SubscriptionStatus)}>
              {STATUTS.map((s) => <option key={s} value={s}>{libelleStatut(s)}</option>)}
            </Select>
          </Field>
        </div>

        {choisi?.note && <p className="t-caption t-tertiary" style={{ margin: 0 }}>{choisi.note}</p>}

        <Card title="La ligne de facture">
          <p className="t-title t-num" style={{ fontSize: 'var(--size-h4)', margin: 0 }}>{money(montant, devise)}</p>
          <p className="t-small t-secondary" style={{ margin: 'var(--sp-2) 0 0' }}>
            {nb(n)} {n === 1 ? 'siège' : 'sièges'} × {money(prix, devise)} par utilisateur et par mois × {mois} mois
          </p>
        </Card>

        {trop.length > 0 && (
          <p className="t-small" style={{ color: 'var(--orange)', margin: 0 }}>
            Cette formule est plus petite que ce que l’agence utilise : {trop.join(', ')}.
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
                  <td className="t-caption t-mono">{resume(e, row.currency)}</td>
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
  if (s('sieges')) bouts.push(`${s('sieges')} sièges`)
  if (s('montant_annuel')) bouts.push(money(Number(s('montant_annuel')), devise))
  if (s('grace_jusqu_au')) bouts.push(`grâce jusqu’au ${dateFr(s('grace_jusqu_au'))}`)
  if (s('motif')) bouts.push(String(s('motif')).replace(/_/g, ' '))
  if (s('note')) bouts.push(String(s('note')))
  return bouts.join(' · ')
}
