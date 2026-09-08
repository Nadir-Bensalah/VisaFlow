import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/data/auth'
import { useStore } from '@/data/store'
import { Button, Card, Empty, Field, Input, Modal, Pill, Segmented, Select, useToast } from '@/components/ui'
import { AgencyDetail } from './AgencyDetail'
import type { Locale } from '@/data/types'
import { TempPassword } from '@/components/TempPassword'
import { inviteUser } from '@/lib/invite'
import type { InviteResult } from '@/lib/invite'
import { tenantUrl } from '@/tenant'

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
  suspended: boolean; created_at: string; users: number; offices: number; clients: number; cases_open: number
  last_activity: string | null; commission_kind: string; commission_amount: number
}

export function AdminConsole() {
  const { isPlatformAdmin, adminChecked, user, signOut } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const { enterSupport } = useStore()

  // Ouvre une agence en vue support (lecture seule). L'accès est journalisé
  // côté serveur avant même le chargement ; si le rôle n'y donne pas droit,
  // la base refuse et on n'entre pas.
  const openSupport = async (id: string) => {
    if (!supabase) return
    const { error } = await supabase.rpc('platform_open_agency', { p_agency: id })
    if (error) { toast('Accès refusé : ' + error.message); return }
    enterSupport(id)
    navigate('/')
  }
  const [over, setOver] = useState<Overview | null>(null)
  const [agencies, setAgencies] = useState<AgencyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'toutes' | 'actives' | 'suspendues'>('toutes')
  const [busy, setBusy] = useState<string | null>(null)
  const [invoices, setInvoices] = useState<any[]>([])
  const [supportLog, setSupportLog] = useState<any[]>([])
  const [signups, setSignups] = useState<any[]>([])
  const [converting, setConverting] = useState<any | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<AgencyRow | null>(null)
  const [detail, setDetail] = useState<AgencyRow | null>(null)

  async function load() {
    if (!supabase) return
    setLoading(true)
    const [o, a, inv, log, sg] = await Promise.all([
      supabase.rpc('platform_overview'),
      supabase.rpc('platform_agencies'),
      supabase.rpc('platform_invoices_list', {}),
      supabase.rpc('platform_support_history', { p_limit: 20 }),
      supabase.rpc('platform_signups', {}),
    ])
    if (o.data) setOver(o.data as Overview)
    if (a.data) setAgencies(a.data as AgencyRow[])
    if (inv.data) setInvoices(inv.data as any[])
    if (log.data) setSupportLog(log.data as any[])
    if (sg.data) setSignups(sg.data as any[])
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
          <Button icon="plus" onClick={() => setCreating(true)}>Nouvelle agence</Button>
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
                    <th>Agence</th><th>Formule</th><th className="num">Bureaux</th><th className="num">Comptes</th>
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
                      <td className="num">{a.offices}</td>
                      <td className="num">{a.users}</td>
                      <td className="num">{a.clients}</td>
                      <td className="num">{a.cases_open}</td>
                      <td className="t-caption">
                        <button type="button" className="linkish t-small" onClick={() => setEditing(a)}>
                          {a.commission_kind === 'gratuit' ? 'gratuit'
                            : a.commission_kind === 'mensuel' ? `${money(a.commission_amount)}/mois`
                            : a.commission_kind === 'pourcentage' ? `${a.commission_amount} %`
                            : `${money(a.commission_amount)}/dossier`}
                        </button>
                      </td>
                      <td className="t-caption t-tertiary">
                        {a.last_activity ? new Date(a.last_activity).toLocaleDateString('fr-TN') : '—'}
                      </td>
                      <td>
                        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                          <Button icon="edit" onClick={() => setDetail(a)}>Gérer</Button>
                          <Button icon="eye" disabled={a.suspended} onClick={() => void openSupport(a.id)}>Ouvrir</Button>
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

        {/* Les demandes de souscription passent AVANT la facturation : c'est
            le premier écran d'une journée, et une demande qui dort est un
            client perdu. */}
        <Card
          title="Demandes de souscription"
          action={<span className="t-caption t-tertiary">
            {signups.filter((x) => x.status === 'nouvelle').length} nouvelles sur {signups.length}
          </span>}
          flush
        >
          {signups.length === 0 ? (
            <div style={{ padding: 'var(--sp-5)' }}>
              <Empty title="Aucune demande pour l'instant."
                hint="Partagez le lien /souscrire : c'est la porte d'entrée des agences." />
            </div>
          ) : (
            <div className="admin__scroll">
              <table className="admin__table">
                <thead><tr>
                  <th>Agence</th><th>Contact</th><th className="num">Équipe</th>
                  <th className="num">Dossiers/mois</th><th className="num">Estimation an</th>
                  <th>État</th><th />
                </tr></thead>
                <tbody>
                  {signups.map((sg) => (
                    <tr key={sg.id}>
                      <td className="t-small t-medium">
                        {sg.agency_name}
                        <span className="t-caption t-tertiary"> · {sg.city ?? sg.country}</span>
                        {sg.current_tool && <div className="t-caption t-tertiary">aujourd'hui : {sg.current_tool}</div>}
                      </td>
                      <td className="t-small">
                        {sg.contact_name}
                        <div className="t-caption t-tertiary t-mono">{sg.phone}</div>
                      </td>
                      <td className="num t-small">{sg.team_size ?? '—'}</td>
                      <td className="num t-small">{sg.monthly_cases ?? '—'}</td>
                      {/* 45 DT par utilisateur et par mois : l'unité d'œuvre
                          exigée par la circulaire BCT, jamais un forfait sec. */}
                      <td className="num t-small">{sg.suggested_year ? money(sg.suggested_year) : '—'}</td>
                      <td>
                        <Pill tone={sg.status === 'nouvelle' ? 'blue'
                          : sg.status === 'convertie' ? 'green'
                          : sg.status === 'ecartee' ? 'gray' : 'orange'}>{sg.status}</Pill>
                      </td>
                      <td>
                        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                          <a className="btn btn--secondary btn--sm" href={`tel:${String(sg.phone).replace(/\s/g,'')}`}>Appeler</a>
                          {sg.status !== 'convertie' && (
                            <Button variant="primary" onClick={() => setConverting(sg)}>Créer l'agence</Button>
                          )}
                          {sg.agency_slug && <span className="t-caption t-tertiary">{sg.agency_slug}</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Facturation de la plateforme"
          action={<Button icon="refresh" onClick={async () => {
            if (!supabase) return
            const { data, error } = await supabase.rpc('platform_generate_invoices', {})
            if (error) { toast(error.message); return }
            toast(`${data} factures générées.`); void load()
          }}>Générer le mois</Button>}
          flush
        >
          {invoices.length === 0 ? (
            <div style={{ padding: 'var(--sp-5)' }}><Empty title="Aucune facture." /></div>
          ) : (
            <div className="admin__scroll">
              <table className="admin__table">
                <thead><tr><th>Agence</th><th>Période</th><th className="num">Dossiers</th><th className="num">Montant</th><th>État</th></tr></thead>
                <tbody>
                  {invoices.map((i, k) => (
                    <tr key={k}>
                      <td className="t-small t-medium">{i.agency}</td>
                      <td className="t-caption t-tertiary">{i.period?.slice(0, 7)}</td>
                      <td className="num">{i.cases_billed}</td>
                      <td className="num t-medium">{money(i.amount)}</td>
                      <td><Pill tone={i.status === 'reglee' ? 'green' : i.status === 'envoyee' ? 'blue' : 'orange'}>{i.status}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Accès support" flush>
          {supportLog.length === 0 ? (
            <div style={{ padding: 'var(--sp-5)' }}><Empty title="Aucun accès support pour l'instant." hint="Chaque ouverture d'une agence en lecture seule est tracée ici." /></div>
          ) : (
            <div className="admin__scroll">
              <table className="admin__table">
                <thead><tr><th>Admin</th><th>Agence</th><th>Ouverte le</th></tr></thead>
                <tbody>
                  {supportLog.map((l, k) => (
                    <tr key={k}>
                      <td className="t-small t-medium">{l.admin_email ?? '—'}</td>
                      <td className="t-small">{l.agency_name}</td>
                      <td className="t-caption t-tertiary">{l.opened_at ? new Date(l.opened_at).toLocaleString('fr-TN') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>

      {creating && <CreateAgency onClose={() => setCreating(false)} onDone={() => { setCreating(false); void load() }} toast={toast} />}
      {converting && <ConvertSignup signup={converting} onClose={() => setConverting(null)} onDone={() => { setConverting(null); void load() }} toast={toast} />}
      {detail && <AgencyDetail agencyId={detail.id} onClose={() => { setDetail(null); void load() }} toast={toast} />}
      {editing && <EditCommission agency={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void load() }} toast={toast} />}
    </div>
  )
}

/**
 * Créer une agence à la main, sans passer par une demande.
 *
 * L'agence naît avec son premier bureau (la ville donnée) et, si on renseigne
 * le propriétaire, son premier compte : la fonction de bord ouvre le compte et
 * rend un mot de passe provisoire, montré une fois. Sans propriétaire, l'agence
 * existe mais personne ne peut y entrer : on le dit.
 */
function CreateAgency({ onClose, onDone, toast }: { onClose: () => void; onDone: () => void; toast: (m: string) => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [country, setCountry] = useState('Tunisie')
  const [city, setCity] = useState('')
  const [phone, setPhone] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [kind, setKind] = useState('par_dossier')
  const [amount, setAmount] = useState(8)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<(InviteResult & { name: string; phone: string; locale: Locale }) | null>(null)
  const emailOk = ownerEmail.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim())

  if (created) {
    return <TempPassword name={created.name} email={created.email} phone={created.phone} tempPassword={created.tempPassword}
      url={tenantUrl(slug.trim().toLowerCase())} locale={created.locale} onClose={onDone} />
  }

  return (
    <Modal title="Nouvelle agence" onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant="primary" disabled={busy || !name.trim() || !slug.trim() || !emailOk || (ownerEmail.trim() !== '' && !ownerName.trim())} onClick={async () => {
        if (!supabase) return
        setBusy(true)
        const { data: agencyId, error } = await supabase.rpc('platform_create_agency', {
          p_name: name.trim(), p_slug: slug.trim().toLowerCase(), p_country: country,
          p_commission_kind: kind, p_commission_amount: amount,
          p_city: city.trim() || null, p_phone: phone.trim() || null,
        })
        if (error) { setBusy(false); toast(error.message); return }
        if (!ownerEmail.trim()) { setBusy(false); toast('Agence créée, sans compte : ouvrez un accès depuis « Gérer ».'); onDone(); return }
        const owner = await inviteOwner(String(agencyId), ownerName.trim(), ownerEmail.trim(), phone.trim(), toast)
        setBusy(false)
        if (!owner) { onDone(); return }
        toast('Agence et compte propriétaire créés.')
        setCreated(owner)
      }}>Créer</Button>
    </>}>
      <div className="col gap-4">
        <Field label="Nom de l'agence"><Input value={name} onChange={(e) => { setName(e.target.value); if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) }} /></Field>
        <Field label="Sous-domaine" hint={`${slug || 'agence'}.visaflow.app`}><Input value={slug} onChange={(e) => setSlug(e.target.value)} /></Field>
        <div className="grid grid--2">
          <Field label="Pays"><Select value={country} onChange={(e) => setCountry(e.target.value)}><option>Tunisie</option><option>Libye</option></Select></Field>
          <Field label="Ville du premier bureau"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
          <Field label="Téléphone"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        </div>
        <div className="grid grid--2">
          <Field label="Propriétaire" hint="La personne qui recevra le premier accès."><Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} /></Field>
          <Field label="E-mail du propriétaire" hint="Son identifiant de connexion."><Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} /></Field>
        </div>
        <div className="grid grid--2">
          <Field label="Commission"><Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="par_dossier">Par dossier</option><option value="mensuel">Mensuelle</option><option value="gratuit">Gratuit</option>
          </Select></Field>
          <Field label="Montant (DT)"><Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
        </div>
      </div>
    </Modal>
  )
}

/** Ouvre le compte du propriétaire dans le premier bureau de l'agence. */
async function inviteOwner(agencyId: string, name: string, email: string, phone: string, toast: (m: string) => void) {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('platform_agency_detail', { p_agency: agencyId })
  const office = (data as { offices?: { id: string; active: boolean }[] } | null)?.offices?.find((o) => o.active)
  if (error || !office) { toast('Agence créée, mais pas de bureau : ouvrez un accès depuis « Gérer ».'); return null }
  try {
    const r = await inviteUser({ agencyId, officeId: office.id, role: 'owner', name, email: email.toLowerCase(), phone: phone || undefined, locale: 'fr' })
    return { ...r, name, phone, locale: 'fr' as Locale }
  } catch (e) {
    toast(`Agence créée, mais le compte a échoué : ${e instanceof Error ? e.message : ''}. Ouvrez un accès depuis « Gérer ».`)
    return null
  }
}

function EditCommission({ agency, onClose, onDone, toast }: { agency: AgencyRow; onClose: () => void; onDone: () => void; toast: (m: string) => void }) {
  const [kind, setKind] = useState(agency.commission_kind)
  const [amount, setAmount] = useState(agency.commission_amount)
  return (
    <Modal title={`Commission · ${agency.name}`} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant="primary" onClick={async () => {
        if (!supabase) return
        const { error } = await supabase.rpc('platform_set_commission', { p_agency: agency.id, p_kind: kind, p_amount: amount })
        if (error) { toast(error.message); return }
        toast('Commission mise à jour.'); onDone()
      }}>Enregistrer</Button>
    </>}>
      <div className="grid grid--2">
        <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="par_dossier">Par dossier</option><option value="mensuel">Mensuelle</option>
          <option value="pourcentage">Pourcentage</option><option value="gratuit">Gratuit</option>
        </Select></Field>
        <Field label="Montant"><Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
      </div>
    </Modal>
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

/**
 * Convertir une demande en agence.
 *
 * On ne redemande que ce que la demande ne portait pas : le sous-domaine et les
 * termes de commission. Le reste (nom, pays, services) vient de ce que l'agence
 * a déjà écrit, et la demande garde le lien vers l'agence née d'elle : six mois
 * plus tard, on sait d'où vient chaque client.
 */
function ConvertSignup({ signup, onClose, onDone, toast }: {
  signup: any; onClose: () => void; onDone: () => void; toast: (m: string) => void
}) {
  const [slug, setSlug] = useState(
    String(signup.agency_name).toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24),
  )
  const [kind, setKind] = useState('par_dossier')
  const [amount, setAmount] = useState('8')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<(InviteResult & { name: string; phone: string; locale: Locale }) | null>(null)

  if (created) {
    return <TempPassword name={created.name} email={created.email} phone={created.phone} tempPassword={created.tempPassword}
      url={tenantUrl(slug.trim().toLowerCase())} locale={created.locale} onClose={onDone} />
  }

  return (
    <Modal
      title={`Créer l'agence · ${signup.agency_name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            variant="primary"
            disabled={busy || !slug.trim()}
            onClick={async () => {
              if (!supabase) return
              setBusy(true)
              const { data: agencyId, error } = await supabase.rpc('platform_convert_signup', {
                p_signup: signup.id, p_slug: slug.trim().toLowerCase(),
                p_commission_kind: kind, p_commission_amount: Number(amount) || 0,
              })
              if (error) { setBusy(false); toast(error.message); return }
              // Le contact de la demande devient le propriétaire : son compte
              // s'ouvre dans la foulée, avec un mot de passe provisoire.
              const owner = await inviteOwner(String(agencyId), String(signup.contact_name), String(signup.email), String(signup.phone ?? ''), toast)
              setBusy(false)
              if (!owner) { onDone(); return }
              toast(`Agence créée · ${slug}.visaflow.app`)
              setCreated({ ...owner, locale: (signup.locale as Locale) ?? 'fr' })
            }}
          >
            Créer l'agence
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label="Sous-domaine" hint={`${slug || '…'}.visaflow.app`}>
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <div className="grid grid--2">
          <Field label="Commission">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="par_dossier">Par dossier</option>
              <option value="par_utilisateur">Par utilisateur et par mois</option>
              <option value="forfait">Forfait</option>
            </Select>
          </Field>
          <Field label="Montant">
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <p className="t-small t-secondary" style={{ margin: 0 }}>
          Le compte du propriétaire s'ouvre pour <strong>{signup.contact_name}</strong> ({signup.email}), dans le bureau de {signup.city ?? signup.country}.
        </p>
        <p className="t-caption t-tertiary" style={{ margin: 0 }}>
          La grille doit être par unité d'œuvre, jamais un forfait sec : l'article 3 de la
          circulaire BCT 2016-09 fait refuser le transfert d'un forfait sans unité quantifiable.
        </p>
      </div>
    </Modal>
  )
}
