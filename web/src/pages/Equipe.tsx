import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Avatar, Button, Card, Empty, IconButton, Pill, useToast } from '@/components/ui'
import { Ago, PageHead } from '@/components/bits'
import { Icon } from '@/components/Icon'
import { InviteMember } from '@/components/InviteMember'
import { MemberPanel } from '@/components/MemberPanel'
import { AccessMatrix } from '@/components/AccessMatrix'
import {
  applyJobTemplate, demoCapabilities, demoOverview, demoTemplates, jobOf, loadJobTemplates,
  loadTeam, scopeOfRole, setMemberActive, setMemberOffice, setMemberPermission, templateOverrides,
} from '@/data/equipe'
import type { JobTemplate, TeamMember, TeamOverview } from '@/data/equipe'

/**
 * L'écran d'équipe. Une page à part entière, pas un onglet perdu dans seize.
 *
 * LA QUESTION À LAQUELLE CET ÉCRAN RÉPOND : « qui peut quoi chez moi ». Le
 * patron ne demande pas la liste de ses employés, il l'a en tête. Il demande où
 * s'arrête chacun, et c'est ça qu'aucun écran ne montrait.
 *
 * Trois blocs, dans cet ordre, et l'ordre compte.
 *
 * 1. LE PÉRIMÈTRE, en premier. Trois cartes : toute l'agence, un bureau,
 *    l'argent. C'est la frontière la plus large du produit, celle qu'aucun
 *    réglage ne montre, et celle que le patron n'arrivait pas à visualiser. Un
 *    agent ne voit pas les dossiers des autres bureaux ; ils ne sont pas cachés
 *    à l'affichage, ils ne sont jamais chargés.
 *
 * 2. LES PERSONNES, avec leur poste et leur périmètre sur la même ligne.
 *
 * 3. LE TABLEAU COMPARATIF, qui répond d'un regard. C'est la vue qui vaut
 *    l'écran : une fiche par personne oblige à ouvrir six fiches et à tenir le
 *    compte de tête.
 *
 * Sans serveur, on montre le jeu de démonstration plutôt qu'une page vide :
 * c'est la vitrine publique du produit, et l'équipe est ce qu'un prospect
 * regarde en premier.
 */

/* La mise en garde du compte partagé ne se répète pas à chaque visite : une
   alerte qu'on voit dix fois cesse d'être lue. Le navigateur se souvient
   qu'elle a été comprise. */
const PARTAGE_VU = 'visaflow.equipe.partage'

export function Equipe() {
  const { db, retry } = useStore()
  const v = useVisible()
  const { t, tt } = useI18n()
  const toast = useToast()

  const [data, setData] = useState<TeamOverview | null>(null)
  const [templates, setTemplates] = useState<JobTemplate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [partageVu, setPartageVu] = useState(() => {
    try { return localStorage.getItem(PARTAGE_VU) === '1' } catch { return false }
  })

  const canManage = v.can('team:manage')
  const canInvite = v.can('team:invite') || canManage
  const canSee = canManage || canInvite || v.can('settings:view')

  const offices = db.agency.offices

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) {
      setData(demoOverview(db.users, offices))
      setTemplates(demoTemplates)
      return
    }
    try {
      const [team, tpl] = await Promise.all([loadTeam(), loadJobTemplates()])
      setData(team)
      setTemplates(tpl)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [db.users, offices])

  useEffect(() => { void reload() }, [reload])

  /* --------------------------------------------------------------- */
  /* Les écritures                                                    */
  /* --------------------------------------------------------------- */

  /* Hors ligne, le changement s'applique dans l'état local, avec la formule de
     la base. En ligne, on écrit puis on recharge : c'est le serveur qui dit ce
     que la personne peut, jamais l'écran. */
  const patchLocal = (id: string, fn: (m: TeamMember, roles: TeamOverview['roles']) => TeamMember) => {
    setData((prev) => (prev
      ? { ...prev, members: prev.members.map((m) => (m.id === id ? fn(m, prev.roles) : m)) }
      : prev))
  }

  const run = async (write: () => Promise<void>, local: () => void) => {
    setBusy(true)
    try {
      if (HAS_BACKEND) { await write(); await reload() } else local()
      toast(t('eq.saved'))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onApplyJob = (userId: string, templateId: string) => {
    const tpl = templates.find((x) => x.id === templateId)
    void run(
      () => applyJobTemplate(userId, templateId),
      () => {
        if (!tpl) return
        patchLocal(userId, (m, roles) => {
          const overrides = templateOverrides(tpl, roles)
          return {
            ...m, role: tpl.baseRole, overrides,
            capabilities: demoCapabilities(tpl.baseRole, m.active, overrides, roles),
          }
        })
      },
    )
  }

  const onSetPermission = (userId: string, code: string, granted: boolean | null) => {
    void run(
      () => setMemberPermission(userId, code, granted),
      () => patchLocal(userId, (m, roles) => {
        const overrides = m.overrides.filter((o) => o.permission !== code)
        if (granted !== null) overrides.push({ permission: code, granted })
        return { ...m, overrides, capabilities: demoCapabilities(m.role, m.active, overrides, roles) }
      }),
    )
  }

  const onSetOffice = (userId: string, officeId: string, active: boolean) => {
    void run(
      () => setMemberOffice(userId, officeId, active),
      () => patchLocal(userId, (m) => ({
        ...m,
        offices: active ? [...new Set([...m.offices, officeId])] : m.offices.filter((o) => o !== officeId),
      })),
    )
  }

  const onSetActive = (userId: string, active: boolean) => {
    void run(
      () => setMemberActive(userId, active),
      () => patchLocal(userId, (m, roles) => ({
        ...m, active, capabilities: demoCapabilities(m.role, active, m.overrides, roles),
      })),
    )
  }

  /* --------------------------------------------------------------- */
  /* Ce que l'écran calcule                                           */
  /* --------------------------------------------------------------- */

  const members = data?.members ?? []
  const roles = data?.roles ?? { owner: [], manager: [], agent: [], viewer: [] }

  const jobs = useMemo(() => {
    const map = new Map<string, JobTemplate | null>()
    for (const m of members) map.set(m.id, jobOf(m, templates, roles))
    return map
  }, [members, templates, roles])

  const jobName = useCallback((m: TeamMember) => {
    const j = jobs.get(m.id)
    return j ? tt(j.label) : t('eq.custom')
  }, [jobs, t, tt])

  /* « Combien par poste » se lit sur la carte elle-même : le nombre de postes
     différents ne dit rien tant qu'on ne voit pas que quatre personnes sur six
     sont conseillères. */
  const counts = useMemo(() => {
    const parPoste = new Map<string, number>()
    for (const m of members) {
      const nom = jobName(m)
      parPoste.set(nom, (parPoste.get(nom) ?? 0) + 1)
    }
    return {
      total: members.length,
      active: members.filter((m) => m.active).length,
      jobs: parPoste.size,
      repartition: [...parPoste.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([nom, n]) => `${nom} ${n}`)
        .join(' · '),
      never: members.filter((m) => m.active && !m.lastSeenAt).length,
      temp: members.filter((m) => m.mustResetPassword).length,
    }
  }, [members, jobName])

  /* Seules les invitations qui attendent encore. Une invitation acceptée n'a
     plus rien à dire : la personne est dans la liste au-dessus. */
  const pending = (data?.invitations ?? []).filter((i) => i.status === 'envoyee')

  const open = members.find((m) => m.id === openId) ?? null
  const officeName = (id: string | null) => offices.find((o) => o.id === id)?.name ?? ''

  if (!canSee) {
    return (
      <>
        <PageHead title={t('eq.title')} subtitle={t('eq.subtitle')} />
        <Empty title={t('access.denied')} hint={t('access.deniedHint')} scene="vide" />
      </>
    )
  }

  return (
    <>
      <PageHead
        title={t('eq.title')}
        subtitle={t('eq.subtitle')}
        action={
          <span className="row gap-2">
            {HAS_BACKEND && <IconButton icon="refresh" label={t('eq.reload')} onClick={() => { retry(); void reload() }} />}
            {canInvite && <Button icon="plus" variant="primary" onClick={() => setInviting(true)}>{t('eq.invite')}</Button>}
          </span>
        }
      />

      {error && (
        <Card>
          <p className="t-small" style={{ color: 'var(--red)', margin: 0 }}>{t('eq.loadError', { msg: error })}</p>
        </Card>
      )}

      {!HAS_BACKEND && (
        <p className="t-caption t-tertiary" style={{ marginTop: 0, marginBottom: 'var(--sp-5)' }}>
          <Pill tone="violet">{t('eq.demo')}</Pill> {t('eq.demoHint')}
        </p>
      )}

      {/* --------------------- Le bandeau de tête ---------------------- */}
      <div className="grid grid--4" style={{ marginBottom: 'var(--sp-5)' }}>
        <Card><div className="stat" style={{ padding: 0 }}>
          <div className="stat__label">{t('eq.people')}</div>
          <div className="stat__value">{counts.total}</div>
          <div className="stat__hint">{t('eq.peopleActive', { n: counts.active })}</div>
        </div></Card>
        <Card><div className="stat" style={{ padding: 0 }}>
          <div className="stat__label">{t('eq.jobs')}</div>
          <div className="stat__value">{counts.jobs}</div>
          <div className="stat__hint">{counts.repartition}</div>
        </div></Card>
        <Card><div className="stat" style={{ padding: 0 }}>
          <div className="stat__label">{t('eq.neverUsed')}</div>
          <div className="stat__value" style={{ color: counts.never > 0 ? 'var(--orange)' : undefined }}>{counts.never}</div>
          <div className="stat__hint">{t('eq.neverUsedHint')}</div>
        </div></Card>
        <Card><div className="stat" style={{ padding: 0 }}>
          <div className="stat__label">{t('eq.provisional')}</div>
          <div className="stat__value" style={{ color: counts.temp > 0 ? 'var(--orange)' : undefined }}>{counts.temp}</div>
          <div className="stat__hint">{t('eq.provisionalHint')}</div>
        </div></Card>
      </div>

      {/* ------------------------- Le périmètre ------------------------ */}
      {/* Le point le plus important de l'écran : montrer où s'arrête chacun,
          sans une ligne d'explication à lire. Trois cartes, trois frontières. */}
      <Card title={t('eq.scopeTitle')}>
        <div className="grid grid--3">
          <ScopeCard
            icon="building" tone="blue"
            title={t('eq.scopeAgency')}
            who={t('eq.scopeAgencyWho')}
            hint={t('eq.scopeAgencyHint')}
            people={members.filter((m) => m.active && scopeOfRole(m.role) === 'agence')}
          />
          <ScopeCard
            icon="pin" tone="gray"
            title={t('eq.scopeOffice')}
            who={t('eq.scopeOfficeWho')}
            hint={t('eq.scopeOfficeHint')}
            people={members.filter((m) => m.active && scopeOfRole(m.role) === 'bureau')}
          />
          <ScopeCard
            icon="lock" tone="orange"
            title={t('eq.scopeMoney')}
            who={t('eq.scopeMoneyWho')}
            hint={t('eq.scopeMoneyHint')}
            people={members.filter((m) => m.active && m.capabilities.includes('finance:global'))}
          />
        </div>
        <p className="t-caption t-tertiary" style={{ marginBottom: 0, marginTop: 'var(--sp-4)' }}>{t('eq.scopeLegend')}</p>
      </Card>

      {/* ------------------- Le compte partagé, une fois ---------------- */}
      {canInvite && !partageVu && (
        <Card className="grid__wide">
          <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
            <Icon name="alert" size={18} style={{ color: 'var(--orange)', flex: '0 0 auto', marginTop: 2 }} />
            <div className="col gap-2 grow">
              <span className="t-medium t-small">{t('eq.sharedTitle')}</span>
              <span className="t-small t-secondary">{t('eq.sharedBody')}</span>
              <span>
                <Button size="sm" onClick={() => {
                  setPartageVu(true)
                  try { localStorage.setItem(PARTAGE_VU, '1') } catch { /* navigateur sans stockage */ }
                }}>{t('eq.sharedOk')}</Button>
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* -------------------------- Les personnes ---------------------- */}
      <div style={{ marginTop: 'var(--sp-5)' }}>
        <Card title={t('eq.title')} flush>
          {members.length === 0 ? (
            <Empty
              title={t('eq.noOne')}
              hint={t('eq.noOneHint')}
              action={canInvite ? <Button icon="plus" variant="primary" onClick={() => setInviting(true)}>{t('eq.invite')}</Button> : undefined}
            />
          ) : (
            <div className="tablewrap">
              <table className="table table--clickable">
                <thead>
                  <tr>
                    <th>{t('eq.name')}</th>
                    <th className="col-optional">{t('eq.email')}</th>
                    <th>{t('eq.job')}</th>
                    <th>{t('eq.scope')}</th>
                    <th className="col-optional">{t('eq.offices')}</th>
                    <th className="col-optional">{t('eq.lastSeen')}</th>
                    <th>{t('eq.state')}</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const job = jobs.get(m.id) ?? null
                    const scope = scopeOfRole(m.role)
                    const others = m.offices.filter((o) => o !== m.officeId)
                    return (
                      <tr
                        key={m.id}
                        onClick={() => setOpenId(m.id)}
                        style={m.active ? undefined : { opacity: 0.55 }}
                      >
                        <td>
                          <span className="row gap-3">
                            <Avatar name={m.name} size="sm" />
                            <span className="t-medium t-small">{m.name}</span>
                          </span>
                        </td>
                        <td className="t-small t-secondary col-optional">{m.email}</td>
                        <td>
                          {job
                            ? <span className="t-small">{tt(job.label)}</span>
                            : <Pill tone="orange">{t('eq.custom')}</Pill>}
                        </td>
                        <td>
                          {scope === 'agence'
                            ? <Pill tone="blue" dot>{t('eq.scopeAgency')}</Pill>
                            : <Pill tone="gray" dot>{officeName(m.officeId) || t('eq.scopeOffice')}</Pill>}
                        </td>
                        <td className="t-small col-optional">
                          {scope === 'agence' ? (
                            <span className="t-tertiary">{t('eq.allOffices')}</span>
                          ) : (
                            <span className="row gap-2 wrap">
                              <span className="t-medium">{officeName(m.officeId)}</span>
                              {others.length > 0 && (
                                <span className="t-tertiary">{others.map(officeName).filter(Boolean).join(', ')}</span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="t-small t-secondary col-optional">
                          {m.lastSeenAt ? <Ago iso={m.lastSeenAt} /> : <span className="t-tertiary">{t('eq.never')}</span>}
                        </td>
                        <td>
                          <span className="row gap-1 wrap">
                            {m.active ? <Pill tone="green" dot>{t('misc.active')}</Pill> : <Pill tone="gray">{t('eq.inactive')}</Pill>}
                            {m.mustResetPassword && <Pill tone="orange">{t('eq.provisional')}</Pill>}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* ------------------------ Les invitations ---------------------- */}
      {/* Une invitation envoyée et jamais acceptée est un compte ouvert que
          personne n'a pris : c'est ce qui traîne le plus longtemps sans que
          personne s'en aperçoive. On ne montre que celles qui attendent. */}
      {pending.length > 0 && (
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <Card title={t('eq.invitations')} flush>
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('eq.name')}</th>
                    <th className="col-optional">{t('eq.email')}</th>
                    <th className="col-optional">{t('eq.offices')}</th>
                    <th>{t('eq.state')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((i) => (
                    <tr key={i.id}>
                      <td className="t-small t-medium">{i.name ?? i.email}</td>
                      <td className="t-small t-secondary col-optional">{i.email}</td>
                      <td className="t-small t-secondary col-optional">{officeName(i.officeId)}</td>
                      <td>
                        <span className="row gap-2">
                          <Pill tone="orange">{t('eq.invStatusEnvoyee')}</Pill>
                          <span className="t-caption t-tertiary"><Ago iso={i.createdAt} /></span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ---------------------- Le tableau comparatif ------------------- */}
      <div style={{ marginTop: 'var(--sp-5)' }}>
        {data && (
          <AccessMatrix
            members={members}
            permissions={data.permissions}
            offices={offices}
            jobName={jobName}
          />
        )}
      </div>

      {open && data && (
        <MemberPanel
          member={open}
          templates={templates}
          roles={data.roles}
          permissions={data.permissions}
          offices={offices}
          job={jobs.get(open.id) ?? null}
          editable={canManage}
          busy={busy}
          onApplyJob={(tid) => onApplyJob(open.id, tid)}
          onSetPermission={(code, granted) => onSetPermission(open.id, code, granted)}
          onSetOffice={(officeId, active) => onSetOffice(open.id, officeId, active)}
          onSetActive={(active) => onSetActive(open.id, active)}
          onClose={() => setOpenId(null)}
        />
      )}

      {inviting && <InviteMember onClose={() => { setInviting(false); void reload() }} />}
    </>
  )
}

/* Une frontière, et les visages qui sont derrière. Les noms comptent autant que
   la règle : « toute l'agence » ne veut rien dire tant qu'on n'a pas vu que
   c'est Slim et Amira, et personne d'autre. */
function ScopeCard({ icon, tone, title, who, hint, people }: {
  icon: 'building' | 'pin' | 'lock'
  tone: 'blue' | 'gray' | 'orange'
  title: string
  who: string
  hint: string
  people: TeamMember[]
}) {
  return (
    <div className="col gap-3" style={{ padding: 'var(--sp-4)', background: `var(--tint-${tone})`, borderRadius: 'var(--r-md)' }}>
      <span className="row gap-2">
        <Icon name={icon} size={16} style={{ color: `var(--${tone === 'gray' ? 'text-secondary' : tone})` }} />
        <span className="t-medium t-small">{title}</span>
        <span className="grow" />
        <span className="t-small t-num t-medium">{people.length}</span>
      </span>
      <span className="t-caption t-tertiary">{who}</span>
      <span className="row gap-1 wrap">
        {people.map((p) => <Pill key={p.id} tone={tone}>{p.name}</Pill>)}
      </span>
      <span className="t-caption t-secondary">{hint}</span>
    </div>
  )
}
