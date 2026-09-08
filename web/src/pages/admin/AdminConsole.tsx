import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/data/auth'
import { Button, Card, Empty, Pill, Segmented, useToast } from '@/components/ui'

/* La console de la plateforme. Le tien, au-dessus de toutes les agences.
   Branchée en réel sur platform_overview et platform_agencies : rien n'est en
   dur ici, tout vient de la base. */

interface Overview {
  agencies_total: number; agencies_active: number; agencies_trial: number
  clients_total: number; cases_total: number; cases_open: number; cases_this_month: number
  shipments_open: number; commission_month: number; commission_pending: number
}
interface AgencyRow {
  id: string; slug: string; name: string; country: string; plan: string
  suspended: boolean; created_at: string; users: number; clients: number; cases_open: number
  last_activity: string | null; commission_kind: string; commission_amount: number
}

export function AdminConsole() {
  const { isPlatformAdmin, adminChecked, user, signOut } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [over, setOver] = useState<Overview | null>(null)
  const [agencies, setAgencies] = useState<AgencyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'toutes' | 'actives' | 'suspendues'>('toutes')
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    if (!supabase) return
    setLoading(true)
    const [o, a] = await Promise.all([
      supabase.rpc('platform_overview'),
      supabase.rpc('platform_agencies'),
    ])
    if (o.data) setOver(o.data as Overview)
    if (a.data) setAgencies(a.data as AgencyRow[])
    setLoading(false)
  }

  useEffect(() => {
    // On ne renvoie ailleurs qu'une fois le serveur formel : sinon un vrai
    // super-admin est éjecté pendant la fraction de seconde d'attente.
    if (adminChecked && !isPlatformAdmin) navigate('/', { replace: true })
    if (isPlatformAdmin) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminChecked, isPlatformAdmin])

  async function setState(id: string, state: string, label: string) {
    if (!supabase) return
    setBusy(id)
    const { error } = await supabase.rpc('platform_set_agency_state', { p_agency: id, p_state: state })
    setBusy(null)
    if (error) { toast(error.message); return }
    toast(label); void load()
  }

  if (!adminChecked || (isPlatformAdmin && loading)) {
    return <div className="admin"><div className="admin__wrap" style={{ paddingTop: 'var(--sp-8)' }}><Card><Empty title="Chargement…" /></Card></div></div>
  }
  if (!isPlatformAdmin) return null

  const shown = agencies.filter((a) =>
    filter === 'toutes' ? true : filter === 'actives' ? !a.suspended : a.suspended)
  const money = (n: number) => new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 }).format(n) + ' DT'

  return (
    <div className="admin">
      <header className="admin__bar">
        <div className="admin__wrap row" style={{ alignItems: 'center', gap: 'var(--sp-3)' }}>
          <span className="admin__mark">VF</span>
          <div className="col" style={{ minWidth: 0 }}>
            <span className="t-medium">Console plateforme</span>
            <span className="t-caption t-tertiary t-truncate">{user?.email}</span>
          </div>
          <span className="grow" />
          <Button icon="refresh" onClick={() => void load()}>Rafraîchir</Button>
          <Button icon="logout" onClick={() => { void signOut(); navigate('/admin') }}>Sortir</Button>
        </div>
      </header>

      <main className="admin__wrap" style={{ paddingBottom: 'var(--sp-10)' }}>
        {over && (
          <div className="admin__grid" style={{ marginBottom: 'var(--sp-6)' }}>
            <Metric label="Agences" value={over.agencies_total} hint={`${over.agencies_active} actives · ${over.agencies_trial} en essai`} />
            <Metric label="Clients" value={over.clients_total} />
            <Metric label="Dossiers ouverts" value={over.cases_open} hint={`${over.cases_this_month} ce mois`} />
            <Metric label="Cargaisons en cours" value={over.shipments_open} />
            <Metric label="Commission du mois" value={money(over.commission_month)} accent />
            <Metric label="Commission en attente" value={money(over.commission_pending)} />
          </div>
        )}

        <Card
          title="Les agences"
          action={
            <Segmented value={filter} onChange={setFilter}
              options={[
                { value: 'toutes', label: 'Toutes' },
                { value: 'actives', label: 'Actives' },
                { value: 'suspendues', label: 'Suspendues' },
              ]}
            />
          }
          flush
        >
          {shown.length === 0 ? (
            <div style={{ padding: 'var(--sp-6)' }}><Empty title="Aucune agence." /></div>
          ) : (
            <div className="admin__scroll">
              <table className="admin__table">
                <thead>
                  <tr>
                    <th>Agence</th><th>Formule</th><th className="num">Comptes</th>
                    <th className="num">Clients</th><th className="num">Dossiers</th>
                    <th>Commission</th><th>Activité</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => (
                    <tr key={a.id} className={a.suspended ? 'admin__row--off' : ''}>
                      <td>
                        <div className="col">
                          <span className="t-medium t-small">{a.name}</span>
                          <span className="t-caption t-tertiary">{a.slug}.visaflow.app</span>
                        </div>
                      </td>
                      <td><Pill tone={a.plan === 'essai' ? 'orange' : 'blue'}>{a.plan.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}</Pill></td>
                      <td className="num">{a.users}</td>
                      <td className="num">{a.clients}</td>
                      <td className="num">{a.cases_open}</td>
                      <td className="t-caption">
                        {a.commission_kind === 'gratuit' ? 'gratuit'
                          : a.commission_kind === 'mensuel' ? `${money(a.commission_amount)}/mois`
                          : a.commission_kind === 'pourcentage' ? `${a.commission_amount} %`
                          : `${money(a.commission_amount)}/dossier`}
                      </td>
                      <td className="t-caption t-tertiary">
                        {a.last_activity ? new Date(a.last_activity).toLocaleDateString('fr-TN') : '—'}
                      </td>
                      <td>
                        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                          {a.suspended
                            ? <Button icon="check" disabled={busy === a.id} onClick={() => setState(a.id, 'active', 'Agence réactivée.')}>Réactiver</Button>
                            : <Button icon="lock" disabled={busy === a.id} onClick={() => setState(a.id, 'suspendue', 'Agence suspendue.')}>Suspendre</Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  )
}

function Metric({ label, value, hint, accent }: { label: string; value: number | string; hint?: string; accent?: boolean }) {
  return (
    <div className={`admin__metric ${accent ? 'admin__metric--accent' : ''}`}>
      <span className="t-caption t-tertiary">{label}</span>
      <span className="admin__metric-value">{value}</span>
      {hint && <span className="t-caption t-tertiary">{hint}</span>}
    </div>
  )
}
