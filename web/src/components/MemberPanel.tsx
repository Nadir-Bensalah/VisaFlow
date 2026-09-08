import { useMemo, useState } from 'react'
import { useI18n } from '@/i18n'
import { Avatar, Button, Modal, Pill, Select, Switch } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { Ago } from '@/components/bits'
import {
  CAP_LABELS, DOMAINS, DOMAIN_KEY, capState, previewJob, scopeOfRole,
} from '@/data/equipe'
import type { CapState, Domain, JobTemplate, PermissionMeta, TeamMember } from '@/data/equipe'
import type { Office, Role } from '@/data/types'

/**
 * Le panneau d'une personne : son poste, ses bureaux, ses dix-neuf droits.
 *
 * Deux choix de fond.
 *
 * 1. Changer de poste montre CE QUE ÇA CHANGE avant de valider. Sans aperçu, on
 *    clique sur « Caissier » en croyant ajouter la caisse, et on retire au
 *    passage le droit de valider une pièce sans jamais l'avoir vu passer. La
 *    liste « il gagnera / il perdra » est la seule chose qui empêche ça.
 *
 * 2. Les dix-neuf droits restent visibles, groupés par domaine, avec leur
 *    origine en toutes lettres : du poste, ajouté, retiré. Cacher les droits
 *    derrière le poste ferait gagner de la place et perdre la seule vue qui
 *    explique pourquoi quelqu'un ne voit pas un écran.
 */
export function MemberPanel({
  member, templates, roles, permissions, offices, job, editable, busy,
  onApplyJob, onSetPermission, onSetOffice, onSetActive, onClose,
}: {
  member: TeamMember
  templates: JobTemplate[]
  roles: Record<Role, string[]>
  permissions: PermissionMeta[]
  offices: Pick<Office, 'id' | 'name' | 'active'>[]
  /** Le poste retrouvé par comparaison, ou null quand rien ne correspond. */
  job: JobTemplate | null
  editable: boolean
  busy: boolean
  onApplyJob: (templateId: string) => void
  onSetPermission: (code: string, granted: boolean | null) => void
  onSetOffice: (officeId: string, active: boolean) => void
  onSetActive: (active: boolean) => void
  onClose: () => void
}) {
  const { t, tt } = useI18n()
  const [choice, setChoice] = useState<string>(job?.id ?? '')

  // Le propriétaire ne se règle pas : la base refuse, et lui fermer une porte
  // fermerait la porte à tout le monde. On le dit plutôt que de laisser des
  // boutons qui échouent.
  const locked = member.role === 'owner'
  const canEdit = editable && !locked

  const chosen = templates.find((tp) => tp.id === choice) ?? null
  const preview = useMemo(
    () => (chosen && chosen.id !== job?.id ? previewJob(member, chosen, roles) : null),
    [chosen, job, member, roles],
  )

  const byDomain = useMemo(() => {
    const map = new Map<string, PermissionMeta[]>()
    for (const p of permissions) {
      const list = map.get(p.domain) ?? []
      list.push(p)
      map.set(p.domain, list)
    }
    return map
  }, [permissions])

  const capLabel = (code: string) => {
    const meta = permissions.find((p) => p.code === code)
    return tt(meta?.label ?? CAP_LABELS[code]) || code
  }

  const scope = scopeOfRole(member.role)

  return (
    <Modal title={t('eq.panelTitle', { name: member.name })} onClose={onClose} wide
      footer={<Button variant="primary" onClick={onClose}>{t('action.close')}</Button>}
    >
      <div className="col gap-5">
        {/* L'identité, et le périmètre juste à côté : c'est la première chose
            qu'on veut savoir en ouvrant une fiche. */}
        <div className="row gap-4" style={{ alignItems: 'center' }}>
          <Avatar name={member.name} size="lg" />
          <span className="col gap-1 grow" style={{ minWidth: 0 }}>
            <span className="t-title t-truncate" style={{ fontSize: 'var(--size-lead)' }}>{member.name}</span>
            <span className="t-small t-secondary t-truncate">{member.email}</span>
            <span className="t-caption t-tertiary">
              {t('eq.lastSeen')} : {member.lastSeenAt ? <Ago iso={member.lastSeenAt} /> : t('eq.never')}
            </span>
          </span>
          <span className="col gap-1" style={{ alignItems: 'flex-end' }}>
            {scope === 'agence'
              ? <Pill tone="blue" dot>{t('eq.scopeAgency')}</Pill>
              : <Pill tone="gray" dot>{t('eq.scopeOffice')}</Pill>}
            {member.capabilities.includes('finance:global') && <Pill tone="orange">{t('eq.scopeMoney')}</Pill>}
            {!member.active && <Pill tone="gray">{t('eq.inactive')}</Pill>}
            {member.mustResetPassword && <Pill tone="orange">{t('eq.provisional')}</Pill>}
          </span>
        </div>

        {locked && (
          <p className="t-small t-secondary" style={{ margin: 0, padding: 'var(--sp-3) var(--sp-4)', background: 'var(--tint-orange)', borderRadius: 'var(--r-sm)' }}>
            {t('eq.ownerLocked')}
          </p>
        )}

        {/* ------------------------------ Le poste ------------------------ */}
        <section className="col gap-3">
          <span className="row-between">
            <span className="t-medium t-small">{t('eq.jobOf')}</span>
            {job
              ? <Pill tone={job.agencyId ? 'violet' : 'blue'}>{job.agencyId ? t('eq.tplOwn') : t('eq.tplCommon')}</Pill>
              : <Pill tone="orange">{t('eq.custom')}</Pill>}
          </span>
          <p className="t-caption t-tertiary" style={{ margin: 0 }}>
            {job ? tt(job.description) : t('eq.customHint')}
          </p>

          {canEdit && (
            <>
              <Select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={t('eq.chooseJob')}>
                <option value="">{t('eq.chooseJob')}</option>
                {templates.map((tp) => (
                  <option key={tp.id} value={tp.id}>{tt(tp.label)}</option>
                ))}
              </Select>
              <p className="t-caption t-tertiary" style={{ margin: 0 }}>{t('eq.jobHint')}</p>

              {chosen && chosen.id !== job?.id && (
                <div className="col gap-2" style={{ padding: 'var(--sp-4)', background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)' }}>
                  <span className="t-caption t-tertiary">{t('eq.preview')}</span>
                  {preview && preview.gains.length === 0 && preview.losses.length === 0 && (
                    <span className="t-small t-secondary">{t('eq.changeNothing')}</span>
                  )}
                  {preview && preview.gains.length > 0 && (
                    <span className="row gap-2 wrap" style={{ alignItems: 'baseline' }}>
                      <span className="t-small t-medium" style={{ color: 'var(--green)' }}>{t('eq.willGain')}</span>
                      <span className="t-small t-secondary">{preview.gains.map(capLabel).join(', ')}</span>
                    </span>
                  )}
                  {preview && preview.losses.length > 0 && (
                    <span className="row gap-2 wrap" style={{ alignItems: 'baseline' }}>
                      <span className="t-small t-medium" style={{ color: 'var(--red)' }}>{t('eq.willLose')}</span>
                      <span className="t-small t-secondary">{preview.losses.map(capLabel).join(', ')}</span>
                    </span>
                  )}
                  <span>
                    <Button variant="primary" size="sm" disabled={busy} onClick={() => onApplyJob(chosen.id)}>
                      {t('eq.applyJob')}
                    </Button>
                  </span>
                </div>
              )}
            </>
          )}
        </section>

        <div className="divider" />

        {/* ----------------------------- Les bureaux ---------------------- */}
        <section className="col gap-3">
          <span className="t-medium t-small">{t('eq.officesOf')}</span>
          {scope === 'agence' ? (
            <p className="t-small t-secondary" style={{ margin: 0 }}>{t('eq.scopeAgencyHint')}</p>
          ) : (
            <>
              <div className="col gap-2">
                {offices.filter((o) => o.active !== false || member.offices.includes(o.id)).map((o) => {
                  const home = o.id === member.officeId
                  const on = member.offices.includes(o.id)
                  return (
                    <span key={o.id} className="row-between">
                      <span className="row gap-2">
                        <span className={home ? 't-small t-medium' : 't-small'}>{o.name}</span>
                        {home && <Pill tone="blue">{t('eq.mainOffice')}</Pill>}
                      </span>
                      <Switch
                        checked={on}
                        // Le bureau principal ne se décoche pas : la personne
                        // se retrouverait sans point d'attache, et la base
                        // refuse de toute façon.
                        onChange={(v) => { if (!home && canEdit) onSetOffice(o.id, v) }}
                        label={o.name}
                      />
                    </span>
                  )
                })}
              </div>
              <p className="t-caption t-tertiary" style={{ margin: 0 }}>{t('eq.officesHint')}</p>
            </>
          )}
        </section>

        <div className="divider" />

        {/* ---------------------------- Les dix-neuf ---------------------- */}
        <section className="col gap-3">
          <span className="t-medium t-small">{t('eq.capsOf')}</span>
          <p className="t-caption t-tertiary" style={{ margin: 0 }}>{t('eq.capsHint')}</p>

          {DOMAINS.filter((d) => (byDomain.get(d) ?? []).length > 0).map((d: Domain) => (
            <div key={d} className="col gap-2">
              <span className="t-caption t-tertiary" style={{ textTransform: 'uppercase', letterSpacing: 'var(--track-caption)' }}>
                {t(DOMAIN_KEY[d] as 'eq.domDossiers')}
              </span>
              {(byDomain.get(d) ?? []).map((p) => {
                const state = capState(member, p.code, roles)
                return (
                  <CapRow
                    key={p.code}
                    perm={p}
                    state={state}
                    editable={canEdit}
                    busy={busy}
                    onSet={(g) => onSetPermission(p.code, g)}
                  />
                )
              })}
            </div>
          ))}

          <p className="t-caption t-tertiary" style={{ margin: 0 }}>{t('eq.delay')}</p>
        </section>

        <div className="divider" />

        {/* ----------------------------- Le compte ------------------------ */}
        <section className="col gap-2">
          <span className="row-between">
            <span className="t-medium t-small">{t('eq.accountState')}</span>
            <Switch
              checked={member.active}
              onChange={(v) => { if (editable && !locked) onSetActive(v) }}
              label={member.active ? t('eq.deactivate') : t('eq.activate')}
            />
          </span>
          <p className="t-caption t-tertiary" style={{ margin: 0 }}>{t('eq.deactivateHint')}</p>
        </section>
      </div>
    </Modal>
  )
}

/* Une ligne de droit. Trois états visibles, et pas deux : « il l'a » ne suffit
   pas, il faut savoir si ça vient du poste ou d'une main. Un droit ajouté à la
   main survit à tous les changements de poste jusqu'à ce que quelqu'un le voie. */
function CapRow({ perm, state, editable, busy, onSet }: {
  perm: PermissionMeta
  state: CapState
  editable: boolean
  busy: boolean
  onSet: (granted: boolean | null) => void
}) {
  const { t, tt } = useI18n()
  const has = state === 'heritee' || state === 'ajoutee'

  const tag = state === 'ajoutee'
    ? <Pill tone="green">{t('eq.added')}</Pill>
    : state === 'retiree'
      ? <Pill tone="red">{t('eq.removed')}</Pill>
      : has
        ? <span className="t-caption t-tertiary">{t('eq.inherited')}</span>
        : null

  return (
    <span className="row-between" style={{ gap: 'var(--sp-3)' }}>
      <span className="row gap-2 grow" style={{ minWidth: 0 }}>
        <Icon
          name={has ? 'check' : 'close'}
          size={15}
          style={{ color: has ? (perm.sensitive ? 'var(--orange)' : 'var(--green)') : 'var(--text-tertiary)', flex: '0 0 auto' }}
        />
        <span className={has ? 't-small t-truncate' : 't-small t-tertiary t-truncate'}>{tt(perm.label)}</span>
        {perm.sensitive && <Icon name="lock" size={12} className="t-tertiary" />}
      </span>
      <span className="row gap-2" style={{ flex: '0 0 auto' }}>
        {tag}
        {editable && (
          <>
            {(state === 'ajoutee' || state === 'retiree') && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSet(null)}>{t('eq.backToJob')}</Button>
            )}
            <Switch
              checked={has}
              onChange={(v) => onSet(v)}
              label={tt(perm.label)}
            />
          </>
        )}
      </span>
    </span>
  )
}
