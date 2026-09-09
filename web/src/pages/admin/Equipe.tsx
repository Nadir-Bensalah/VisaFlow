import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Field, Input, Modal, Pill, Select, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { TempPassword } from '@/components/TempPassword'
import {
  Confirmer, Erreur, Etat, Kpi, KpiGrid, PageHeader, Section, Squelette, Table, Vide,
  depuis, nb, useChargement,
} from './kit'
import { usePlateforme } from './contexte'
import {
  PLATFORM_ROLES, ROLE_CAPS, inviteAdmin, loadAdmins, removeAdmin, setAdminActive, setAdminRole,
} from '@/data/plateforme'
import type { AdminRow, InviteAdminResult, PlatformCap, PlatformRole } from '@/data/plateforme'
import '@/styles/admin-equipe.css'

/**
 * L'ÉQUIPE DE LA PLATEFORME. Qui pilote la console, et avec quels pouvoirs.
 *
 * Le client l'a demandé ainsi : « Je dois pouvoir moi aussi créer des super
 * admins avec rôles (exemple : sans suppression). » Les rôles sont fixes et
 * viennent du contrat (PLATFORM_ROLES, ROLE_CAPS) : l'écran les montre, il ne
 * les invente pas. Les règles de sécurité vivent côté serveur (dernier
 * superuser, soi-même, superuser donné par un superuser seulement) ; ici on
 * cache les gestes impossibles et on affiche tel quel le refus s'il arrive.
 */

/* Les treize capacités, en français lisible. L'ordre est celui du contrat. */
const CAPS: { cap: PlatformCap; label: string }[] = [
  { cap: 'agences.ouvrir', label: 'Ouvrir une agence' },
  { cap: 'agences.modifier', label: 'Modifier une agence' },
  { cap: 'agences.suspendre', label: 'Suspendre / réactiver l’accès' },
  { cap: 'agences.supprimer', label: 'Supprimer une agence' },
  { cap: 'agences.entrer', label: 'Entrer en lecture dans une agence' },
  { cap: 'demandes.traiter', label: 'Traiter les demandes' },
  { cap: 'abonnements.modifier', label: 'Modifier les abonnements' },
  { cap: 'facturation.encaisser', label: 'Constater les règlements' },
  { cap: 'facturation.reactiver', label: 'Rouvrir une grâce' },
  { cap: 'assistance.repondre', label: 'Répondre à l’assistance' },
  { cap: 'annonces.publier', label: 'Publier des annonces' },
  { cap: 'equipe.gerer', label: 'Gérer l’équipe' },
  { cap: 'taches.lancer', label: 'Lancer les tâches' },
]

const SEPT_JOURS_MS = 7 * 86400 * 1000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/* Les refus du serveur arrivent en PostgrestError (pas une Error) ou en Error
   (fonction de bord). Dans les deux cas c'est le message qu'on veut, tel quel. */
function message(e: unknown, repli: string): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message: unknown }).message
    if (typeof m === 'string' && m) return m
  }
  return repli
}

type Geste =
  | { type: 'actif'; admin: AdminRow; actif: boolean }
  | { type: 'retirer'; admin: AdminRow }

export function Equipe() {
  const toast = useToast()
  const { me, can, rafraichirCompteurs } = usePlateforme()
  const { data, loading, refreshing, error, reload } = useChargement(loadAdmins)

  const [geste, setGeste] = useState<Geste | null>(null)
  const [busy, setBusy] = useState(false)
  const [inviter, setInviter] = useState(false)
  const [provisoire, setProvisoire] = useState<InviteAdminResult & { name: string } | null>(null)

  const gerer = can('equipe.gerer')
  const superuser = me.role === 'superuser'

  /* Les rôles qu'on a le droit de donner : superuser ne se donne que par un superuser. */
  const rolesPermis = useMemo(
    () => PLATFORM_ROLES.filter((r) => r.code !== 'superuser' || superuser),
    [superuser],
  )

  const admins = data ?? []
  const kpis = useMemo(() => {
    const maintenant = Date.now()
    return {
      actifs: admins.filter((a) => a.active).length,
      supers: admins.filter((a) => a.role === 'superuser' && a.active).length,
      connectes7j: admins.filter((a) => a.last_seen_at && maintenant - new Date(a.last_seen_at).getTime() < SEPT_JOURS_MS).length,
      attente: admins.filter((a) => a.must_reset_password).length,
    }
  }, [admins])

  /* Un geste qui aboutit : le toast, puis le tableau et la barre latérale. */
  const apres = async (texte: string) => {
    toast(texte)
    await reload()
    rafraichirCompteurs()
  }

  const changerRole = async (a: AdminRow, role: PlatformRole) => {
    if (role === a.role) return
    setBusy(true)
    try {
      await setAdminRole(a.id, role)
      await apres(`${a.name} est maintenant ${PLATFORM_ROLES.find((r) => r.code === role)?.label.toLowerCase() ?? role}.`)
    } catch (e) { toast(message(e, 'Changement de rôle impossible.')) } finally { setBusy(false) }
  }

  const confirmer = async () => {
    if (!geste) return
    setBusy(true)
    try {
      if (geste.type === 'actif') {
        await setAdminActive(geste.admin.id, geste.actif)
        await apres(geste.actif ? `${geste.admin.name} a de nouveau accès à la console.` : `${geste.admin.name} n’a plus accès à la console.`)
      } else {
        await removeAdmin(geste.admin.id)
        await apres(`${geste.admin.name} a été retiré de l’équipe.`)
      }
      setGeste(null)
    } catch (e) { toast(message(e, 'Geste impossible.')) } finally { setBusy(false) }
  }

  return (
    <>
      <PageHeader
        kicker="Plateforme"
        title="Équipe de la plateforme"
        subtitle="Qui pilote la console, et avec quels pouvoirs."
        refreshing={refreshing}
        actions={gerer && <Button variant="primary" icon="plus" onClick={() => setInviter(true)}>Inviter</Button>}
      />

      {error && !data && <Erreur message={error} onRetry={() => void reload()} />}

      {loading ? <Squelette type="kpis" n={4} /> : (
        <KpiGrid>
          <Kpi label="Membres actifs" value={nb(kpis.actifs)} icon="clients" hint={admins.length > kpis.actifs ? `${nb(admins.length - kpis.actifs)} désactivé(s)` : undefined} />
          <Kpi label="Super-admins" value={nb(kpis.supers)} icon="shield" hint="actifs" />
          <Kpi label="Connectés sur 7 j" value={nb(kpis.connectes7j)} icon="today" tone="blue" />
          <Kpi label="Invitations en attente" value={nb(kpis.attente)} icon="lock" tone={kpis.attente ? 'orange' : 'gray'} hint="mot de passe provisoire jamais changé" />
        </KpiGrid>
      )}

      <Section title="Les membres" flush>
        {loading ? <Squelette type="table" n={4} /> : admins.length === 0 ? (
          <Vide title="Personne dans l’équipe." hint="Le compte qui a ouvert la console devrait au moins apparaître ici." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Personne</th><th>Rôle</th><th>État</th><th>Dernière connexion</th>
                <th className="num">Gestes sur 30 j</th><th>Invité par</th>
                {gerer && <th className="actions" aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => {
                const moi = a.id === me.id
                /* Le sélecteur ne s'affiche que si l'on peut donner le rôle courant :
                   un admin qui verrait « superuser » sans pouvoir le rendre casserait la liste. */
                const peutChanger = gerer && !moi && rolesPermis.some((r) => r.code === a.role)
                return (
                  <tr key={a.id} className={a.active ? '' : 'adm-row--off'}>
                    <td>
                      <div className="eq-personne">
                        <span className="eq-personne__nom">{a.name}{moi && <Pill tone="blue">vous</Pill>}</span>
                        <span className="eq-personne__mail">{a.email}</span>
                      </div>
                    </td>
                    <td>
                      <div className="eq-role">
                        <Etat etat={a.role} />
                        {peutChanger && (
                          <Select value={a.role} disabled={busy} aria-label={`Rôle de ${a.name}`} onChange={(e) => void changerRole(a, e.target.value as PlatformRole)}>
                            {rolesPermis.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                          </Select>
                        )}
                      </div>
                    </td>
                    <td>
                      {!a.active ? <Pill tone="gray" dot>Désactivé</Pill>
                        : a.must_reset_password ? <Pill tone="orange" dot>Mot de passe provisoire</Pill>
                          : <Pill tone="green" dot>Actif</Pill>}
                    </td>
                    <td className="t-caption t-tertiary">{depuis(a.last_seen_at)}</td>
                    <td className="num">
                      {a.actions_30j > 0 ? <Link to="/admin/journal" title="Voir le journal">{nb(a.actions_30j)}</Link> : '0'}
                    </td>
                    <td className="t-caption t-tertiary">{a.invited_by_email ?? '·'}</td>
                    {gerer && (
                      <td className="actions">
                        {!moi && (
                          <span className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                            <Button size="sm" icon={a.active ? 'lock' : 'check'} disabled={busy} onClick={() => setGeste({ type: 'actif', admin: a, actif: !a.active })}>
                              {a.active ? 'Désactiver' : 'Réactiver'}
                            </Button>
                            {superuser && (
                              <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={() => setGeste({ type: 'retirer', admin: a })}>Retirer</Button>
                            )}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Section>

      <Section title="Ce que chaque rôle peut faire" flush>
        <div className="eq-matrice-scroll">
          <table className="eq-matrice">
            <thead>
              <tr>
                <th>Capacité</th>
                {PLATFORM_ROLES.map((r) => (
                  <th key={r.code} className={r.code === me.role ? 'eq-matrice__moi' : undefined}>{r.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPS.map((c) => (
                <tr key={c.cap}>
                  <td>
                    <span className="eq-matrice__cap">
                      <span>{c.label}</span>
                      <span className="eq-matrice__code">{c.cap}</span>
                    </span>
                  </td>
                  {PLATFORM_ROLES.map((r) => {
                    const oui = ROLE_CAPS[r.code].includes(c.cap)
                    return (
                      <td key={r.code} aria-label={oui ? 'oui' : 'non'}>
                        {oui ? <span className="eq-coche"><Icon name="check" size={16} /></span> : <span className="eq-non" />}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="eq-roles">
          {PLATFORM_ROLES.map((r) => (
            <div key={r.code} className="eq-role-carte">
              <span><Etat etat={r.code} /></span>
              <span className="eq-role-carte__desc">{r.description}</span>
            </div>
          ))}
        </div>
      </Section>

      {geste?.type === 'actif' && (
        <Confirmer
          title={geste.actif ? 'Réactiver l’accès' : 'Désactiver l’accès'}
          label={geste.actif ? 'Réactiver' : 'Désactiver'}
          danger={!geste.actif}
          busy={busy}
          onConfirm={() => void confirmer()}
          onClose={() => setGeste(null)}
        >
          {geste.actif
            ? <>{geste.admin.name} ({geste.admin.email}) retrouvera la console avec son rôle « {PLATFORM_ROLES.find((r) => r.code === geste.admin.role)?.label} ».</>
            : <>{geste.admin.name} ({geste.admin.email}) ne pourra plus ouvrir la console. Son compte reste : vous pourrez le réactiver.</>}
        </Confirmer>
      )}

      {geste?.type === 'retirer' && (
        <Confirmer
          title="Retirer de l’équipe"
          label="Retirer"
          danger
          motCle={geste.admin.email}
          busy={busy}
          onConfirm={() => void confirmer()}
          onClose={() => setGeste(null)}
        >
          {geste.admin.name} sort de l’équipe de la plateforme. Son compte de connexion reste, mais il ne donne plus accès à rien. Ses gestes restent dans le journal.
        </Confirmer>
      )}

      {inviter && (
        <Invitation
          roles={rolesPermis}
          onClose={() => setInviter(false)}
          onDone={(r, name) => {
            setInviter(false)
            setProvisoire({ ...r, name })
            void apres('Compte ouvert. Le mot de passe provisoire ne sera plus jamais visible : transmettez-le maintenant.')
          }}
        />
      )}

      {provisoire && (
        <TempPassword
          name={provisoire.name}
          email={provisoire.email}
          phone=""
          tempPassword={provisoire.tempPassword}
          url={`${window.location.origin}${import.meta.env.BASE_URL}admin`}
          locale="fr"
          onClose={() => setProvisoire(null)}
        />
      )}
    </>
  )
}

/* ---------------------------- L'invitation --------------------------- */

function Invitation({ roles, onClose, onDone }: {
  roles: typeof PLATFORM_ROLES
  onClose: () => void
  onDone: (r: InviteAdminResult, name: string) => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  /* Le rôle proposé par défaut est le moins puissant qu'on puisse donner :
     on monte un pouvoir en connaissance de cause, on ne le baisse pas après coup. */
  const [role, setRole] = useState<PlatformRole>(roles[roles.length - 1]?.code ?? 'lecture')
  const [busy, setBusy] = useState(false)
  const [touche, setTouche] = useState(false)

  const nomOk = name.trim().length >= 2
  const emailOk = EMAIL.test(email.trim())
  const choisi = roles.find((r) => r.code === role)

  const envoyer = async () => {
    setTouche(true)
    if (!nomOk || !emailOk) return
    setBusy(true)
    try {
      const r = await inviteAdmin({ name: name.trim(), email: email.trim(), role })
      onDone(r, name.trim())
    } catch (e) {
      toast(message(e, 'Ouverture du compte impossible.'))
    } finally { setBusy(false) }
  }

  return (
    <Modal
      title="Inviter dans l’équipe"
      onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" icon="shield" disabled={busy} onClick={() => void envoyer()}>{busy ? 'Ouverture…' : 'Ouvrir le compte'}</Button>
      </>}
    >
      <div className="col gap-4">
        <Field label="Nom" error={touche && !nomOk ? 'Le nom est trop court.' : undefined}>
          <Input value={name} autoFocus autoComplete="off" onChange={(e) => setName(e.target.value)} placeholder="Prénom et nom" />
        </Field>
        <Field label="Adresse e-mail" hint="C’est son identifiant de connexion." error={touche && !emailOk ? 'L’adresse n’est pas valide.' : undefined}>
          <Input type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} placeholder="prenom@exemple.tn" />
        </Field>
        <Field label="Rôle">
          <Select value={role} onChange={(e) => setRole(e.target.value as PlatformRole)}>
            {roles.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </Select>
        </Field>
        {choisi && <div className="eq-invite__desc">{choisi.description}</div>}
        <p className="eq-invite__avert">
          <Icon name="alert" size={14} />
          <span>Le compte naît avec un mot de passe provisoire, montré une seule fois à l’écran suivant. Il devra le changer à sa première connexion.</span>
        </p>
      </div>
    </Modal>
  )
}
