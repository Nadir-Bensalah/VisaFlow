import { useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n, LOCALES, LOCALE_META } from '@/i18n'
import { Button, Field, Input, Modal, Select, useToast } from './ui'
import type { Client, Locale } from '@/data/types'

/* La fiche client, modifiable. Le passeport et sa date d'expiration sont ici :
   sans eux, l'alerte « passeport trop court » ne se declenche jamais, et c'est
   le refus le plus bete du metier. */
export function ClientEditor({ client, onClose, onSaved }: {
  client: Client | null
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const { db, actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()

  const [draft, setDraft] = useState({
    firstName: client?.firstName ?? '',
    lastName: client?.lastName ?? '',
    nativeName: client?.nativeName ?? '',
    phone: client?.phone ?? '',
    whatsapp: client?.whatsapp ?? '',
    email: client?.email ?? '',
    nationality: client?.nationality ?? 'Tunisienne',
    passportNumber: client?.passportNumber ?? '',
    passportExpiry: client?.passportExpiry?.slice(0, 10) ?? '',
    birthDate: client?.birthDate?.slice(0, 10) ?? '',
    address: client?.address ?? '',
    locale: (client?.locale ?? 'fr') as Locale,
    officeId: client?.officeId ?? db.agency.offices[0].id,
  })
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft({ ...draft, [key]: value })

  const save = () => {
    const patch = {
      ...draft,
      passportExpiry: draft.passportExpiry ? new Date(draft.passportExpiry).toISOString() : undefined,
      birthDate: draft.birthDate ? new Date(draft.birthDate).toISOString() : undefined,
      whatsapp: draft.whatsapp || draft.phone,
    }
    if (client) {
      actions.updateClient(client.id, patch)
      toast(t('crud.updated'))
      onSaved?.(client.id)
    } else {
      const id = actions.createClient({
        firstName: patch.firstName, lastName: patch.lastName, phone: patch.phone,
        email: patch.email, nationality: patch.nationality, locale: patch.locale, officeId: patch.officeId,
      })
      actions.updateClient(id, patch)
      toast(t('crud.created'))
      onSaved?.(id)
    }
    onClose()
  }

  return (
    <Modal
      wide
      title={client ? t('crud.edit') : t('clients.newClient')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={!draft.firstName.trim() || !draft.lastName.trim() || draft.phone.trim().length < 6} onClick={save}>
            {t('action.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label={t('ask.firstName')}><Input value={draft.firstName} onChange={(e) => set('firstName', e.target.value)} /></Field>
        <Field label={t('ask.lastName')}><Input value={draft.lastName} onChange={(e) => set('lastName', e.target.value)} /></Field>
        <Field label={t('clients.name')} hint="محمد / 陈浩">
          <Input value={draft.nativeName} onChange={(e) => set('nativeName', e.target.value)} />
        </Field>
        <Field label={t('clients.nationality')}><Input value={draft.nationality} onChange={(e) => set('nationality', e.target.value)} /></Field>
        <Field label={t('clients.contact')}><Input type="tel" value={draft.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="WhatsApp" hint={t('ask.phoneHint')}>
          <Input type="tel" value={draft.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} />
        </Field>
        <Field label={t('login.email')}><Input type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label={t('clients.passport')}><Input value={draft.passportNumber} onChange={(e) => set('passportNumber', e.target.value)} /></Field>
        <Field label={t('clients.expiry')} hint={t('portal.expiresIn')}>
          <Input type="date" value={draft.passportExpiry} onChange={(e) => set('passportExpiry', e.target.value)} />
        </Field>
        <Field label={t('ask.travelWhen')}><Input type="date" value={draft.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></Field>
        <Field label={t('misc.language')}>
          <Select value={draft.locale} onChange={(e) => set('locale', e.target.value as Locale)}>
            {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_META[l].native}</option>)}
          </Select>
        </Field>
        <Field label={t('misc.office')}>
          <Select value={draft.officeId} onChange={(e) => set('officeId', e.target.value)}>
            {db.agency.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>
      </div>
      <Field label={t('appts.where')}>
        <Input value={draft.address} onChange={(e) => set('address', e.target.value)} />
      </Field>
    </Modal>
  )
}
