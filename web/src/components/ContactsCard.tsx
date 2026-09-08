import { useCallback, useEffect, useState } from 'react'
import { HAS_BACKEND } from '@/lib/supabase'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import {
  CONTACT_KINDS, archiveContact, listContacts, makePrimary, saveContact,
  type ClientContact, type ContactDraft, type ContactKind,
} from '@/data/crm'
import { Button, Card, Empty, Field, Input, Modal, Pill, Select, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'

/* Les contacts d'un client.
 *
 * Une société n'a pas un interlocuteur, elle en a quatre : celui qui décide,
 * celui qui paie, celui qui reçoit la marchandise, et celui qu'on appelle un
 * dimanche. Un seul est le principal, et la base le garantit.
 */

export function ContactsCard({ clientId }: { clientId: string }) {
  const v = useVisible()
  const { t } = useI18n()
  const toast = useToast()
  const [rows, setRows] = useState<ClientContact[]>([])
  const [loading, setLoading] = useState(HAS_BACKEND)
  const [editing, setEditing] = useState<ClientContact | 'nouveau' | null>(null)

  const canWrite = v.can('client:write')

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) { setLoading(false); return }
    try { setRows(await listContacts(clientId)) } catch { setRows([]) } finally { setLoading(false) }
  }, [clientId])

  useEffect(() => { void reload() }, [reload])

  if (!HAS_BACKEND) return null
  if (loading) return <Card title={t('crm.contactsTitle')}><Empty title="…" scene="aucune" /></Card>

  const promote = async (id: string) => {
    try { await makePrimary(clientId, id); await reload() }
    catch (e) { toast(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <>
      <Card
        title={t('crm.contactsTitle')}
        action={canWrite ? <Button icon="plus" onClick={() => setEditing('nouveau')}>{t('crm.contactAdd')}</Button> : undefined}
        flush
      >
        {rows.length === 0 ? (
          <div style={{ padding: 'var(--sp-5) var(--sp-6)' }}>
            <p className="t-small t-tertiary" style={{ margin: 0 }}>{t('crm.contactsNone')}</p>
          </div>
        ) : (
          <div className="list">
            {rows.map((c) => (
              <div key={c.id} className="list__row">
                <Icon name="clients" size={18} className="t-tertiary" />
                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className="row gap-2">
                    <span className="t-medium t-small">{c.name}</span>
                    {c.isPrimary && <Pill tone="green" dot>{t('crm.primary')}</Pill>}
                    <Pill tone="gray">{t(`crm.kd_${c.kind}` as 'crm.kd_autre')}</Pill>
                  </span>
                  <span className="t-caption t-tertiary t-truncate">
                    {[c.relationship, c.phone, c.email].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {c.phone && (
                  <a className="btn btn--secondary btn--sm" href={`tel:${c.phone.replace(/\s/g, '')}`}>
                    <Icon name="phone" size={16} />
                  </a>
                )}
                {(c.whatsapp ?? c.phone) && (
                  <a
                    className="btn btn--secondary btn--sm"
                    href={`https://wa.me/${(c.whatsapp ?? c.phone ?? '').replace(/[^0-9]/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon name="whatsapp" size={16} />
                  </a>
                )}
                {canWrite && !c.isPrimary && (
                  <Button size="sm" onClick={() => void promote(c.id)}>{t('crm.makePrimary')}</Button>
                )}
                {canWrite && <Button size="sm" icon="edit" onClick={() => setEditing(c)}>{t('crud.edit')}</Button>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {editing && (
        <ContactEditor
          clientId={clientId}
          contact={editing === 'nouveau' ? null : editing}
          hasPrimary={rows.some((c) => c.isPrimary)}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload() }}
        />
      )}
    </>
  )
}

function ContactEditor({ clientId, contact, hasPrimary, onClose, onSaved }: {
  clientId: string
  contact: ClientContact | null
  hasPrimary: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [name, setName] = useState(contact?.name ?? '')
  const [kind, setKind] = useState<ContactKind>(contact?.kind ?? 'autre')
  const [relationship, setRelationship] = useState(contact?.relationship ?? '')
  const [email, setEmail] = useState(contact?.email ?? '')
  const [phone, setPhone] = useState(contact?.phone ?? '')
  const [whatsapp, setWhatsapp] = useState(contact?.whatsapp ?? '')
  const [note, setNote] = useState(contact?.note ?? '')
  const [busy, setBusy] = useState(false)

  // Le premier contact d'un client devient le principal : sinon personne ne
  // pense à le désigner, et les automatisations n'ont plus d'interlocuteur.
  const primaryByDefault = contact ? contact.isPrimary : !hasPrimary

  const save = async () => {
    setBusy(true)
    try {
      const draft: ContactDraft = {
        name: name.trim(),
        kind,
        relationship: relationship.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        whatsapp: whatsapp.trim() || null,
        note: note.trim() || null,
        isPrimary: primaryByDefault,
      }
      await saveContact(clientId, contact?.id ?? null, draft)
      toast(t('crud.updated'))
      await onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={contact ? t('crm.contactEdit') : t('crm.contactAdd')}
      onClose={onClose}
      footer={
        <>
          {contact && (
            <Button icon="trash" disabled={busy} onClick={async () => {
              try { await archiveContact(contact.id); toast(t('crud.removed')); await onSaved() }
              catch (e) { toast(e instanceof Error ? e.message : String(e)) }
            }}>{t('crm.contactRemove')}</Button>
          )}
          <span className="grow" />
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={busy || name.trim() === ''} onClick={() => void save()}>
            {t('action.save')}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <div className="grid grid--2">
          <Field label={t('crm.contactName2')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('crm.exchangeKind')}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as ContactKind)}>
              {CONTACT_KINDS.map((k) => (
                <option key={k} value={k}>{t(`crm.kd_${k}` as 'crm.kd_autre')}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('crm.relationship')}>
            <Input value={relationship} onChange={(e) => setRelationship(e.target.value)} />
          </Field>
          <Field label={t('crm.phone')}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+216 …" />
          </Field>
          <Field label={t('crm.whatsapp')}>
            <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          </Field>
          <Field label={t('crm.email')}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Field label={t('crm.note')}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="t-caption t-tertiary" style={{ margin: 0 }}>{t('crm.primaryOne')}</p>
      </div>
    </Modal>
  )
}
