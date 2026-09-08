import { useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Button, Field, Input, Modal, Select } from '@/components/ui'
import { roleKey } from '@/lib/permissions'
import { inviteUser } from '@/lib/invite'
import type { InviteResult } from '@/lib/invite'
import { tenantUrl } from '@/tenant'
import { TempPassword } from './TempPassword'
import type { Locale, Office, Role } from '@/data/types'

/**
 * Le formulaire d'invitation, indépendant du magasin : la console plateforme
 * s'en sert pour n'importe quelle agence, l'agence pour elle-même.
 */
export function InviteForm({ agencyId, offices, roles, defaultOffice, onClose, onDone }: {
  agencyId: string
  offices: Pick<Office, 'id' | 'name'>[]
  roles: Role[]
  defaultOffice?: string
  onClose: () => void
  onDone: (result: InviteResult & { name: string; phone: string; locale: Locale }) => void
}) {
  const { t, locale: uiLocale } = useI18n()
  const [f, setF] = useState({
    name: '', email: '', phone: '', role: roles[0] ?? 'agent', officeId: defaultOffice ?? offices[0]?.id ?? '', locale: uiLocale as Locale,
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())

  const envoyer = async () => {
    setBusy(true); setError('')
    try {
      const r = await inviteUser({
        agencyId, officeId: f.officeId, role: f.role, name: f.name.trim(),
        email: f.email.trim().toLowerCase(), phone: f.phone.trim() || undefined, locale: f.locale,
      })
      onDone({ ...r, name: f.name.trim(), phone: f.phone.trim(), locale: f.locale })
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(/déjà un compte|already/i.test(msg) ? t('equipe.exists') : msg || t('sync.ecriture'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('equipe.inviteTitle')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={busy || !f.name.trim() || !emailOk || !f.officeId} onClick={() => void envoyer()}>
            {busy ? t('equipe.creating') : t('equipe.send')}
          </Button>
        </>
      }
    >
      <p className="t-small t-secondary" style={{ marginTop: 0 }}>{t('equipe.inviteHint')}</p>
      <div className="grid grid--2">
        <Field label={t('clients.name')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label={t('login.email')}><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label={t('clients.contact')}><Input type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label={t('misc.role')} hint={roles.includes('manager') ? undefined : t('equipe.managerLimit')}>
          <Select value={f.role} onChange={(e) => set('role', e.target.value as Role)}>
            {roles.map((r) => <option key={r} value={r}>{t(roleKey(r))}</option>)}
          </Select>
        </Field>
        <Field label={t('misc.office')}>
          <Select value={f.officeId} onChange={(e) => set('officeId', e.target.value)}>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>
        <Field label={t('misc.language')}>
          <Select value={f.locale} onChange={(e) => set('locale', e.target.value as Locale)}>
            {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_META[l].native}</option>)}
          </Select>
        </Field>
      </div>
      {error && <p className="t-small" style={{ color: 'var(--red)', marginBottom: 0 }}>{error}</p>}
    </Modal>
  )
}

/** L'invitation depuis les réglages de l'agence, sur son propre périmètre. */
export function InviteMember({ onClose }: { onClose: () => void }) {
  const { db, retry } = useStore()
  const v = useVisible()
  const [done, setDone] = useState<(InviteResult & { name: string; phone: string; locale: Locale }) | null>(null)

  // Le propriétaire invite tout rôle ; un manager, seulement des agents et
  // des lecteurs. La fonction de bord vérifie la même chose : ici on évite
  // juste de proposer ce qui sera refusé.
  const roles: Role[] = v.can('team:manage') ? ['agent', 'viewer', 'manager', 'owner'] : ['agent', 'viewer']
  const offices = db.agency.offices.filter((o) => o.active !== false)

  if (done) {
    return (
      <TempPassword
        name={done.name} email={done.email} phone={done.phone} tempPassword={done.tempPassword}
        url={tenantUrl(db.agency.slug)} locale={done.locale}
        onClose={() => { retry(); onClose() }}
      />
    )
  }
  return (
    <InviteForm
      agencyId={db.agency.id}
      offices={offices}
      roles={roles}
      defaultOffice={v.officeId ?? undefined}
      onClose={onClose}
      onDone={setDone}
    />
  )
}
