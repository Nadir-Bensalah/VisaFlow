import { useCallback, useEffect, useState } from 'react'
import { HAS_BACKEND } from '@/lib/supabase'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { loadCompany, saveCompany, type ClientCompany, type CompanyDraft } from '@/data/crm'
import { Button, Card, Empty, Field, Input, Modal, Textarea, useToast } from '@/components/ui'

/* La fiche société d'un client.
 *
 * Un dédouanement se fait au nom d'une société, avec un matricule fiscal et un
 * code en douane. Tant qu'ils vivaient dans la tête de l'agent, il les retapait
 * à chaque expédition, et se trompait une fois sur dix. Ils sont ici, une fois.
 */

export function CompanySection({ clientId }: { clientId: string }) {
  const v = useVisible()
  const { t } = useI18n()
  const [company, setCompany] = useState<ClientCompany | null>(null)
  const [loading, setLoading] = useState(HAS_BACKEND)
  const [editing, setEditing] = useState(false)

  const canWrite = v.can('client:write')

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) { setLoading(false); return }
    try { setCompany(await loadCompany(clientId)) } catch { setCompany(null) } finally { setLoading(false) }
  }, [clientId])

  useEffect(() => { void reload() }, [reload])

  if (!HAS_BACKEND) return null
  if (loading) return <Card title={t('crm.companyTitle')}><Empty title="…" scene="aucune" /></Card>

  return (
    <>
      <Card
        title={t('crm.companyTitle')}
        action={canWrite ? (
          <Button icon={company ? 'edit' : 'plus'} onClick={() => setEditing(true)}>
            {company ? t('crm.companyEdit') : t('crm.companyAdd')}
          </Button>
        ) : undefined}
      >
        {!company ? (
          <p className="t-small t-tertiary" style={{ margin: 0 }}>
            {t('crm.companyNone')} · {t('crm.companyNoneHint')}
          </p>
        ) : (
          <div className="col gap-4">
            <div className="col gap-1">
              <span className="t-title" style={{ fontSize: 'var(--size-lead)' }}>{company.companyName}</span>
              {company.legalName && <span className="t-caption t-tertiary">{company.legalName}</span>}
            </div>
            <div className="grid grid--2">
              <Line label={t('crm.taxId')} value={company.taxId} mono />
              <Line label={t('crm.customs')} value={company.customsIdentifier} mono />
              <Line label={t('crm.register')} value={company.commercialRegister} mono />
              <Line label={t('crm.sector')} value={company.activitySector} />
              <Line label={t('crm.contactName')} value={company.contactName} />
              <Line label={t('crm.phone')} value={company.phone} />
              <Line label={t('crm.email')} value={company.email} />
              <Line label={t('crm.country')} value={company.country} />
              <Line label={t('crm.billing')} value={company.billingAddress} wide />
              <Line label={t('crm.shipping')} value={company.shippingAddress} wide />
            </div>
            {company.note && <p className="t-small t-secondary" style={{ margin: 0 }}>{company.note}</p>}
          </div>
        )}
      </Card>

      {editing && (
        <CompanyEditor
          clientId={clientId}
          company={company}
          onClose={() => setEditing(false)}
          onSaved={async () => { setEditing(false); await reload() }}
        />
      )}
    </>
  )
}

function Line({ label, value, mono, wide }: { label: string; value?: string | null; mono?: boolean; wide?: boolean }) {
  if (!value) return null
  return (
    <span className={`col gap-1 ${wide ? 'grid__wide' : ''}`}>
      <span className="t-caption t-tertiary">{label}</span>
      <span className={`t-small ${mono ? 't-mono' : ''}`}>{value}</span>
    </span>
  )
}

function CompanyEditor({ clientId, company, onClose, onSaved }: {
  clientId: string
  company: ClientCompany | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [form, setForm] = useState({
    companyName: company?.companyName ?? '',
    legalName: company?.legalName ?? '',
    taxId: company?.taxId ?? '',
    customsIdentifier: company?.customsIdentifier ?? '',
    commercialRegister: company?.commercialRegister ?? '',
    activitySector: company?.activitySector ?? '',
    contactName: company?.contactName ?? '',
    email: company?.email ?? '',
    phone: company?.phone ?? '',
    whatsapp: company?.whatsapp ?? '',
    billingAddress: company?.billingAddress ?? '',
    shippingAddress: company?.shippingAddress ?? '',
    country: company?.country ?? '',
    note: company?.note ?? '',
  })
  const [busy, setBusy] = useState(false)

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    setBusy(true)
    try {
      const draft: CompanyDraft = Object.fromEntries(
        Object.entries(form).map(([k, val]) => [k, val.trim() || null]),
      ) as CompanyDraft
      draft.companyName = form.companyName.trim()
      await saveCompany(clientId, company?.id ?? null, draft)
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
      title={company ? t('crm.companyEdit') : t('crm.companyAdd')}
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={busy || form.companyName.trim() === ''} onClick={() => void save()}>
            {t('action.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label={t('crm.companyName')}>
          <Input value={form.companyName} onChange={set('companyName')} />
        </Field>
        <Field label={t('crm.legalName')}>
          <Input value={form.legalName} onChange={set('legalName')} />
        </Field>
        {/* Le matricule fiscal identifie la société : la base refuse le même
            deux fois dans l'agence, et c'est voulu. */}
        <Field label={t('crm.taxId')}>
          <Input value={form.taxId} onChange={set('taxId')} />
        </Field>
        <Field label={t('crm.customs')}>
          <Input value={form.customsIdentifier} onChange={set('customsIdentifier')} />
        </Field>
        <Field label={t('crm.register')}>
          <Input value={form.commercialRegister} onChange={set('commercialRegister')} />
        </Field>
        <Field label={t('crm.sector')}>
          <Input value={form.activitySector} onChange={set('activitySector')} />
        </Field>
        <Field label={t('crm.contactName')}>
          <Input value={form.contactName} onChange={set('contactName')} />
        </Field>
        <Field label={t('crm.country')}>
          <Input value={form.country} onChange={set('country')} />
        </Field>
        <Field label={t('crm.phone')}>
          <Input value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label={t('crm.whatsapp')}>
          <Input value={form.whatsapp} onChange={set('whatsapp')} />
        </Field>
        <Field label={t('crm.email')}>
          <Input type="email" value={form.email} onChange={set('email')} />
        </Field>
        <span className="grid__wide">
          <Field label={t('crm.billing')}>
            <Textarea value={form.billingAddress} onChange={set('billingAddress')} />
          </Field>
        </span>
        <span className="grid__wide">
          <Field label={t('crm.shipping')}>
            <Textarea value={form.shippingAddress} onChange={set('shippingAddress')} />
          </Field>
        </span>
        <span className="grid__wide">
          <Field label={t('crm.note')}>
            <Textarea value={form.note} onChange={set('note')} />
          </Field>
        </span>
      </div>
    </Modal>
  )
}
