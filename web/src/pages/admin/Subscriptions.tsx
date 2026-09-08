import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Empty, Field, Input, Modal, Pill, Segmented, Select, useToast } from '@/components/ui'
import {
  loadPlans, loadSubscriptions, loadSubscriptionEvents, setSubscription, refreshUsageAll,
  type Plan, type PlanCode, type SubscriptionEvent, type SubscriptionRow, type SubscriptionStatus,
} from '@/data/abonnements'
import { alerte, depasse, enMo, illimite, joursAvant, taille } from '@/lib/quotas'

/* L'écran plateforme des abonnements.
   En français en dur, comme le reste de la console : elle n'a qu'un
   utilisateur, et l'y traduire coûterait quatre langues pour personne.

   Ce que cet écran fait, et rien d'autre : montrer qui paie quoi, où en est
   chacun de ses quotas, quand tombe l'échéance, et poser un plan. Il
   n'encaisse rien. L'abonnement se facture à l'année, sur facture TTN, et le
   règlement arrive par virement : il n'existe pas de prélèvement récurrent par
   carte en Tunisie. Aucun bouton ici ne doit laisser croire le contraire. */

const STATUT_LABEL: Record<SubscriptionStatus, string> = {
  essai: 'Essai',
  active: 'Actif',
  impayee: 'Impayé',
  resiliee: 'Résilié',
  suspendue: 'Suspendu',
}

const STATUT_TON: Record<SubscriptionStatus, 'gray' | 'blue' | 'green' | 'orange' | 'red'> = {
  essai: 'blue', active: 'green', impayee: 'orange', resiliee: 'gray', suspendue: 'red',
}

const RES_LABEL: Record<string, string> = {
  users: 'utilisateurs', offices: 'bureaux', clients: 'clients',
  cases: 'dossiers', shipments: 'cargaisons', storage: 'stockage',
}

const EVENT_LABEL: Record<SubscriptionEvent['kind'], string> = {
  creee: 'Abonnement ouvert',
  changement_plan: 'Changement de plan',
  renouvelee: 'Renouvellement',
  suspendue: 'Suspension',
  reactivee: 'Réactivation',
  resiliee: 'Résiliation',
  quota_depasse: 'Dépassement de quota',
}

const dt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('fr-TN', { day: '2-digit', month: 'short', year: 'numeric' }) : '·'
const dinars = (n: number) =>
  new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 }).format(n) + ' DT'
const nb = (n: number) => new Intl.NumberFormat('fr-TN').format(n)

export function Subscriptions() {
  const toast = useToast()
  const [rows, setRows] = useState<SubscriptionRow[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [filtre, setFiltre] = useState<'tous' | 'payants' | 'essais' | 'attention'>('tous')
  const [editing, setEditing] = useState<SubscriptionRow | null>(null)
  const [journal, setJournal] = useState<SubscriptionRow | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [r, p] = await Promise.all([loadSubscriptions(), loadPlans()])
      setRows(r)
      setPlans(p)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Ce qui mérite qu'on l'ouvre : un dépassement, une échéance à moins de
  // trente jours, un impayé, ou une suspension. Le reste peut attendre.
  const attention = (r: SubscriptionRow) => {
    const j = joursAvant(r.renewal_on)
    return r.over.length > 0
      || r.status === 'impayee' || r.status === 'suspendue' || r.suspended
      || (j !== null && j <= 30)
  }

  const shown = useMemo(() => rows.filter((r) =>
    filtre === 'tous' ? true
      : filtre === 'payants' ? r.status === 'active' || r.status === 'impayee'
      : filtre === 'essais' ? r.status === 'essai'
      : attention(r)), [rows, filtre])

  // Le revenu annuel engagé : la somme de ce qui est signé, pas de ce qui est
  // encaissé. Une facture émise n'est pas une facture réglée, et confondre les
  // deux fait croire à une trésorerie qui n'existe pas.
  const engage = rows
    .filter((r) => r.status === 'active' || r.status === 'impayee')
    .reduce((s, r) => s + Number(r.annual_amount ?? 0), 0)
  const sieges = rows
    .filter((r) => r.status === 'active' || r.status === 'impayee')
    .reduce((s, r) => s + Number(r.seats ?? 0), 0)

  if (loading) return <Card title="Abonnements"><Empty title="Chargement…" scene="aucune" /></Card>

  return (
    <>
      <div className="admin__grid" style={{ marginBottom: 'var(--sp-6)' }}>
        <Chiffre label="Revenu annuel engagé" value={dinars(engage)} hint={`${nb(sieges)} utilisateurs facturés`} accent />
        <Chiffre label="Agences payantes" value={nb(rows.filter((r) => r.status === 'active' || r.status === 'impayee').length)} />
        <Chiffre label="En essai" value={nb(rows.filter((r) => r.status === 'essai').length)} />
        <Chiffre label="En dépassement" value={nb(rows.filter((r) => r.over.length > 0).length)} />
      </div>

      <Card
        title="Abonnements"
        action={
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <Segmented value={filtre} onChange={setFiltre} options={[
              { value: 'tous', label: 'Tous' },
              { value: 'payants', label: 'Payants' },
              { value: 'essais', label: 'Essais' },
              { value: 'attention', label: 'À voir' },
            ]} />
            <Button icon="refresh" size="sm" disabled={busy} onClick={async () => {
              setBusy(true)
              try { await refreshUsageAll(); await load(); toast('Consommation recomptée.') }
              catch (e) { toast(e instanceof Error ? e.message : 'Recompte impossible.') }
              finally { setBusy(false) }
            }}>Recompter</Button>
          </div>
        }
        flush
      >
        {shown.length === 0 ? (
          <div style={{ padding: 'var(--sp-5)' }}>
            <Empty title="Aucune agence dans ce filtre." />
          </div>
        ) : (
          <div className="admin__scroll">
            <table className="admin__table">
              <thead>
                <tr>
                  <th>Agence</th><th>Plan</th><th className="num">Sièges</th>
                  <th className="num">Montant annuel</th><th>Échéance</th>
                  <th>Consommation</th><th>État</th><th />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const j = joursAvant(r.renewal_on)
                  return (
                    <tr key={r.agency_id} className={r.suspended ? 'admin__row--off' : ''}>
                      <td className="t-small t-medium">
                        {r.name}
                        <div className="t-caption t-tertiary t-mono">{r.slug}</div>
                      </td>
                      <td className="t-small">{r.plan_name}</td>
                      {/* Les sièges FACTURÉS, et le réel entre parenthèses quand
                          il diffère : c'est l'écart que le commercial regarde. */}
                      <td className="num">
                        {nb(r.seats)}
                        {r.usage.users !== r.seats && (
                          <span className="t-caption t-tertiary"> ({nb(r.usage.users)} réels)</span>
                        )}
                      </td>
                      <td className="num t-medium">{dinars(Number(r.annual_amount ?? 0))}</td>
                      <td className="t-small">
                        {dt(r.renewal_on)}
                        {j !== null && j <= 30 && (
                          <div className="t-caption" style={j < 0 ? { color: 'var(--red)' } : undefined}>
                            {j < 0 ? `en retard de ${Math.abs(j)} j` : `dans ${j} j`}
                          </div>
                        )}
                      </td>
                      <td><Conso row={r} /></td>
                      <td>
                        <span className="row gap-1 wrap">
                          <Pill tone={STATUT_TON[r.status]} dot>{STATUT_LABEL[r.status]}</Pill>
                          {r.over.length > 0 && (
                            <Pill tone="red">
                              {r.over.map((o) => RES_LABEL[o] ?? o).join(', ')}
                            </Pill>
                          )}
                        </span>
                      </td>
                      <td>
                        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                          <Button icon="clock" onClick={() => setJournal(r)}>Journal</Button>
                          <Button icon="edit" onClick={() => setEditing(r)}>Changer</Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="t-caption t-tertiary" style={{ padding: 'var(--sp-3) var(--sp-5)', margin: 0 }}>
          L'abonnement se facture à l'année, sur facture TTN. Aucun prélèvement par carte :
          la ligne de facture est « sièges × prix par utilisateur × 12 mois », telle que
          l'article 3 de la circulaire BCT 2016-09 l'exige.
        </p>
      </Card>

      {editing && (
        <FormeAbonnement
          row={editing}
          plans={plans}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); void load() }}
          toast={toast}
        />
      )}
      {journal && <Journal row={journal} onClose={() => setJournal(null)} toast={toast} />}
    </>
  )
}

/* La consommation en une cellule : ce qui approche ou dépasse d'abord, le
   reste replié. Six jauges par ligne noieraient la seule qui compte. */
function Conso({ row }: { row: SubscriptionRow }) {
  const items: Array<{ cle: string; utilise: number; limite: number | null }> = [
    { cle: 'users', utilise: row.usage.users, limite: row.limits.users },
    { cle: 'offices', utilise: row.usage.offices, limite: row.limits.offices },
    { cle: 'cases', utilise: row.usage.cases, limite: row.limits.cases },
    { cle: 'shipments', utilise: row.usage.shipments, limite: row.limits.shipments },
    { cle: 'storage', utilise: enMo(row.usage.storage_bytes), limite: row.limits.storage_mb },
  ]
  const chauds = items.filter((i) => depasse(i.utilise, i.limite) || alerte(i.utilise, i.limite))
  const montres = chauds.length > 0 ? chauds : items.slice(0, 2)

  return (
    <div className="col gap-1">
      {montres.map((i) => (
        <span key={i.cle} className="t-caption t-mono">
          <span className="t-tertiary">{RES_LABEL[i.cle]} </span>
          <span style={depasse(i.utilise, i.limite) ? { color: 'var(--red)' } : undefined}>
            {i.cle === 'storage' ? taille(row.usage.storage_bytes, nb) : nb(i.utilise)}
            {illimite(i.limite) ? ' / ∞' : ` / ${nb(i.limite as number)}${i.cle === 'storage' ? ' Mo' : ''}`}
          </span>
        </span>
      ))}
      <span className="t-caption t-tertiary">{nb(row.usage.clients)} clients</span>
    </div>
  )
}

/* Poser un plan. Le montant se recalcule sous les yeux, décomposé : c'est
   exactement la ligne qui partira sur la facture, et la voir avant d'appuyer
   évite de la découvrir après. */
function FormeAbonnement({ row, plans, onClose, onDone, toast }: {
  row: SubscriptionRow
  plans: Plan[]
  onClose: () => void
  onDone: () => void
  toast: (m: string) => void
}) {
  const [plan, setPlan] = useState<PlanCode>(row.plan)
  const [seats, setSeats] = useState(String(row.seats || row.usage.users || 1))
  const [renewal, setRenewal] = useState(row.renewal_on ?? '')
  const [statut, setStatut] = useState<SubscriptionStatus>(row.status)
  const [busy, setBusy] = useState(false)

  const choisi = plans.find((p) => p.code === plan)
  const n = Math.max(1, Number(seats) || 1)
  const prix = choisi?.price_per_user_month ?? row.price_per_user_month
  const annuel = n * prix * 12

  // Le plan choisi couvre-t-il ce que l'agence utilise DÉJÀ ? Le dire avant de
  // valider vaut mieux que de la mettre en dépassement puis de s'en étonner.
  const trop: string[] = []
  if (choisi) {
    if (choisi.max_users !== null && row.usage.users > choisi.max_users) trop.push(`${row.usage.users} utilisateurs pour ${choisi.max_users}`)
    if (choisi.max_offices !== null && row.usage.offices > choisi.max_offices) trop.push(`${row.usage.offices} bureaux pour ${choisi.max_offices}`)
    if (choisi.max_active_cases !== null && row.usage.cases > choisi.max_active_cases) trop.push(`${row.usage.cases} dossiers pour ${choisi.max_active_cases}`)
    if (choisi.max_active_shipments !== null && row.usage.shipments > choisi.max_active_shipments) trop.push(`${row.usage.shipments} cargaisons pour ${choisi.max_active_shipments}`)
  }

  return (
    <Modal
      title={`Abonnement · ${row.name}`}
      onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" disabled={busy} onClick={async () => {
          setBusy(true)
          try {
            await setSubscription({
              agencyId: row.agency_id, plan, seats: n,
              renewalOn: renewal || null, status: statut,
            })
            toast('Abonnement enregistré.')
            onDone()
          } catch (e) {
            toast(e instanceof Error ? e.message : 'Enregistrement impossible.')
          } finally {
            setBusy(false)
          }
        }}>Enregistrer</Button>
      </>}
    >
      <div className="grid grid--2">
        <Field label="Plan">
          <Select value={plan} onChange={(e) => setPlan(e.target.value as PlanCode)}>
            {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Utilisateurs facturés" hint="Ce qui a été signé, pas ce qui est ouvert.">
          <Input type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} />
        </Field>
        <Field label="Échéance">
          <Input type="date" value={renewal} onChange={(e) => setRenewal(e.target.value)} />
        </Field>
        <Field label="État">
          <Select value={statut} onChange={(e) => setStatut(e.target.value as SubscriptionStatus)}>
            {(Object.keys(STATUT_LABEL) as SubscriptionStatus[]).map((s) =>
              <option key={s} value={s}>{STATUT_LABEL[s]}</option>)}
          </Select>
        </Field>
      </div>

      {choisi?.note && <p className="t-caption t-tertiary">{choisi.note}</p>}

      <Card title="La ligne de facture">
        <p className="t-title" style={{ fontSize: 'var(--size-lead)', margin: 0 }}>{dinars(annuel)}</p>
        <p className="t-small t-secondary" style={{ marginTop: 'var(--sp-2)' }}>
          {nb(n)} utilisateurs × {dinars(prix)} par utilisateur et par mois × 12 mois
        </p>
        <p className="t-caption t-tertiary" style={{ marginTop: 'var(--sp-2)', marginBottom: 0 }}>
          Quantifiable, comme l'exige l'article 3 de la circulaire BCT 2016-09.
          Un forfait sans unité d'œuvre se fait refuser au transfert.
        </p>
      </Card>

      {trop.length > 0 && (
        <p className="t-small" style={{ color: 'var(--orange)' }}>
          Ce plan est plus petit que ce que l'agence utilise : {trop.join(', ')}.
          Rien ne sera effacé, mais elle ne pourra plus rien ajouter.
        </p>
      )}
      {statut === 'resiliee' && (
        <p className="t-small" style={{ color: 'var(--red)' }}>
          Résilier coupe l'accès aux fonctionnalités du plan. Les données restent en place.
        </p>
      )}
    </Modal>
  )
}

/* L'histoire de l'abonnement. C'est ce qu'on relit quand une agence conteste
   une facture : qui a changé quoi, quand, et pour quel montant. */
function Journal({ row, onClose, toast }: {
  row: SubscriptionRow; onClose: () => void; toast: (m: string) => void
}) {
  const [events, setEvents] = useState<SubscriptionEvent[] | null>(null)

  useEffect(() => {
    loadSubscriptionEvents(row.agency_id)
      .then(setEvents)
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'Journal illisible.'))
  }, [row.agency_id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal title={`Journal · ${row.name}`} onClose={onClose} wide
      footer={<Button variant="primary" onClick={onClose}>Fermer</Button>}>
      {!events ? <Empty title="Chargement…" scene="aucune" />
        : events.length === 0 ? <Empty title="Rien encore." hint="Le journal se remplit au premier changement." />
        : (
          <div className="admin__scroll">
            <table className="admin__table">
              <thead><tr><th>Quand</th><th>Quoi</th><th>Détail</th><th>Par</th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="t-caption t-tertiary">{dt(e.at)}</td>
                    <td className="t-small t-medium">{EVENT_LABEL[e.kind] ?? e.kind}</td>
                    <td className="t-caption t-mono">{resume(e)}</td>
                    <td className="t-caption t-tertiary">{e.by ?? 'plateforme'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Modal>
  )
}

/* Le détail d'un événement, en une phrase lisible. Le jsonb brut est juste
   sous la main en base ; ici on veut la version qu'on lit au téléphone avec
   un client qui conteste. */
function resume(e: SubscriptionEvent): string {
  const d = e.detail as Record<string, unknown>
  const s = (k: string) => (d[k] === null || d[k] === undefined ? null : String(d[k]))
  if (e.kind === 'quota_depasse') {
    const r = Array.isArray(d.ressources) ? (d.ressources as string[]) : []
    return r.map((x) => RES_LABEL[x] ?? x).join(', ')
  }
  const bouts: string[] = []
  if (s('plan_avant') && s('plan_avant') !== s('plan')) bouts.push(`${s('plan_avant')} → ${s('plan')}`)
  else if (s('plan')) bouts.push(String(s('plan')))
  if (s('sieges')) bouts.push(`${s('sieges')} sièges`)
  if (s('montant_annuel')) bouts.push(dinars(Number(s('montant_annuel'))))
  return bouts.join(' · ')
}

function Chiffre({ label, value, hint, accent }: {
  label: string; value: string | number; hint?: string; accent?: boolean
}) {
  return (
    <div className={`admin__metric ${accent ? 'admin__metric--accent' : ''}`}>
      <span className="t-caption t-tertiary">{label}</span>
      <span className="admin__metric-value">{value}</span>
      {hint && <span className="t-caption t-tertiary">{hint}</span>}
    </div>
  )
}
