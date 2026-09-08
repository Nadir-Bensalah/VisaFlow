import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button, Card, Empty, Field, Input, Modal, Pill, Select } from '@/components/ui'
import { InviteForm } from '@/components/InviteMember'
import { TempPassword } from '@/components/TempPassword'
import { tenantUrl } from '@/tenant'
import type { InviteResult } from '@/lib/invite'
import type { Locale, Role } from '@/data/types'

/* Une agence vue de la plateforme : ses bureaux et son équipe.
   C'est ici que tu crées les bureaux d'une agence, que tu ouvres un compte à
   son propriétaire, et que tu déplaces quelqu'un d'un bureau à l'autre. Tout
   passe par des fonctions platform_* côté base, et par la fonction de bord
   invite-user pour les comptes. Rien n'est en dur. */

interface Office {
  id: string; name: string; city: string | null; country: string; phone: string | null
  address: string | null; active: boolean; team: number; clients: number; cases_open: number
}
interface Member {
  id: string; name: string; email: string; phone: string | null; role: Role; office_id: string
  active: boolean; must_reset_password: boolean; last_seen_at: string | null; last_sign_in_at: string | null
}
interface Detail {
  agency: { id: string; slug: string; name: string; country: string; email: string | null; phone: string | null; services: string[] }
  offices: Office[]
  team: Member[]
}

const ROLE_LABEL: Record<Role, string> = { owner: 'Propriétaire', manager: 'Manager', agent: 'Agent', viewer: 'Lecteur' }

export function AgencyDetail({ agencyId, onClose, toast }: { agencyId: string; onClose: () => void; toast: (m: string) => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [officeEdit, setOfficeEdit] = useState<Office | 'nouveau' | null>(null)
  const [inviting, setInviting] = useState(false)
  const [created, setCreated] = useState<(InviteResult & { name: string; phone: string; locale: Locale }) | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    if (!supabase) return
    const { data, error } = await supabase.rpc('platform_agency_detail', { p_agency: agencyId })
    if (error) { toast(error.message); return }
    setD(data as Detail)
  }
  useEffect(() => { void load() }, [agencyId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function setMember(m: Member, patch: Partial<Pick<Member, 'office_id' | 'role' | 'active'>>) {
    if (!supabase) return
    setBusy(m.id)
    const { error } = await supabase.rpc('platform_set_member', {
      p_profile: m.id, p_office: patch.office_id ?? m.office_id, p_role: patch.role ?? m.role, p_active: patch.active ?? m.active,
    })
    setBusy(null)
    if (error) { toast(error.message); return }
    void load()
  }

  const quand = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-TN') : 'jamais')

  return (
    <Modal title={d ? `${d.agency.name} · ${d.agency.slug}.visaflow.app` : 'Agence'} onClose={onClose} wide
      footer={<Button variant="primary" onClick={onClose}>Fermer</Button>}>
      {!d ? <Empty title="Chargement…" /> : (
        <div className="col gap-5">
          <Card title="Bureaux" action={<Button icon="plus" size="sm" onClick={() => setOfficeEdit('nouveau')}>Nouveau bureau</Button>} flush>
            <div className="admin__scroll">
              <table className="admin__table">
                <thead><tr><th>Bureau</th><th>Ville</th><th className="num">Équipe</th><th className="num">Clients</th><th className="num">Dossiers</th><th>État</th><th /></tr></thead>
                <tbody>
                  {d.offices.map((o) => (
                    <tr key={o.id} className={o.active ? '' : 'admin__row--off'}>
                      <td className="t-small t-medium">{o.name}</td>
                      <td className="t-small t-secondary">{o.city ?? '—'} · {o.country}</td>
                      <td className="num">{o.team}</td>
                      <td className="num">{o.clients}</td>
                      <td className="num">{o.cases_open}</td>
                      <td>{o.active ? <Pill tone="green" dot>Actif</Pill> : <Pill tone="gray">Fermé</Pill>}</td>
                      <td><div className="row gap-2" style={{ justifyContent: 'flex-end' }}><Button icon="edit" onClick={() => setOfficeEdit(o)}>Modifier</Button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Équipe"
            action={<Button icon="plus" size="sm" disabled={d.offices.filter((o) => o.active).length === 0} onClick={() => setInviting(true)}>Ouvrir un accès</Button>} flush>
            {d.team.length === 0 ? (
              <div style={{ padding: 'var(--sp-5)' }}>
                <Empty title="Personne n'a encore de compte." hint="Ouvrez un accès au propriétaire : il invitera ensuite son équipe lui-même." />
              </div>
            ) : (
              <div className="admin__scroll">
                <table className="admin__table">
                  <thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Bureau</th><th>Dernière connexion</th><th>État</th><th /></tr></thead>
                  <tbody>
                    {d.team.map((m) => (
                      <tr key={m.id} className={m.active ? '' : 'admin__row--off'}>
                        <td className="t-small t-medium">{m.name}<div className="t-caption t-tertiary t-mono">{m.phone ?? ''}</div></td>
                        <td className="t-small t-mono">{m.email}</td>
                        <td>
                          <Select value={m.role} disabled={busy === m.id} onChange={(e) => void setMember(m, { role: e.target.value as Role })} style={{ minHeight: 30 }}>
                            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </Select>
                        </td>
                        <td>
                          <Select value={m.office_id} disabled={busy === m.id} onChange={(e) => void setMember(m, { office_id: e.target.value })} style={{ minHeight: 30 }}>
                            {d.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </Select>
                        </td>
                        <td className="t-caption t-tertiary">{quand(m.last_sign_in_at)}</td>
                        <td>
                          <span className="row gap-1 wrap">
                            {m.active ? <Pill tone="green" dot>Actif</Pill> : <Pill tone="gray">Inactif</Pill>}
                            {m.must_reset_password && <Pill tone="orange">Mot de passe provisoire</Pill>}
                          </span>
                        </td>
                        <td>
                          <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                            {m.active
                              ? <Button icon="lock" disabled={busy === m.id} onClick={() => void setMember(m, { active: false })}>Désactiver</Button>
                              : <Button icon="check" disabled={busy === m.id} onClick={() => void setMember(m, { active: true })}>Réactiver</Button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="t-caption t-tertiary" style={{ padding: 'var(--sp-3) var(--sp-5)', margin: 0 }}>
              Un rôle ou un bureau changé s'applique au prochain rafraîchissement du jeton de la personne, au plus tard dans l'heure.
            </p>
          </Card>
        </div>
      )}

      {officeEdit && d && (
        <OfficeForm agencyId={agencyId} office={officeEdit === 'nouveau' ? null : officeEdit} country={d.agency.country}
          onClose={() => setOfficeEdit(null)} onDone={() => { setOfficeEdit(null); void load() }} toast={toast} />
      )}
      {inviting && d && (
        <InviteForm
          agencyId={agencyId}
          offices={d.offices.filter((o) => o.active)}
          roles={['owner', 'manager', 'agent', 'viewer']}
          onClose={() => setInviting(false)}
          onDone={(r) => { setInviting(false); setCreated(r); void load() }}
        />
      )}
      {created && d && (
        <TempPassword name={created.name} email={created.email} phone={created.phone} tempPassword={created.tempPassword}
          url={tenantUrl(d.agency.slug)} locale={created.locale} onClose={() => setCreated(null)} />
      )}
    </Modal>
  )
}

function OfficeForm({ agencyId, office, country, onClose, onDone, toast }: {
  agencyId: string; office: Office | null; country: string; onClose: () => void; onDone: () => void; toast: (m: string) => void
}) {
  const [f, setF] = useState({
    name: office?.name ?? '', city: office?.city ?? '', country: office?.country ?? country,
    phone: office?.phone ?? '', address: office?.address ?? '', active: office?.active ?? true,
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={office ? `Bureau · ${office.name}` : 'Nouveau bureau'} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant="primary" disabled={busy || !f.name.trim()} onClick={async () => {
        if (!supabase) return
        setBusy(true)
        const { error } = await supabase.rpc('platform_save_office', {
          p_agency: agencyId, p_office: office?.id ?? null, p_name: f.name.trim(), p_city: f.city.trim() || null,
          p_country: f.country, p_phone: f.phone.trim() || null, p_address: f.address.trim() || null, p_active: f.active,
        })
        setBusy(false)
        if (error) { toast(error.message); return }
        toast(office ? 'Bureau enregistré.' : 'Bureau créé.'); onDone()
      }}>Enregistrer</Button>
    </>}>
      <div className="grid grid--2">
        <Field label="Nom du bureau"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Ville"><Input value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="Pays"><Select value={f.country} onChange={(e) => set('country', e.target.value)}><option>Tunisie</option><option>Libye</option><option>Chine</option></Select></Field>
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
    </Modal>
  )
}
