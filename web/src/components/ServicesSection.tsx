import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { HAS_BACKEND } from '@/lib/supabase'
import { Button, Card, Empty, Field, Input, Modal, Pill, Select, Switch, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { loadServices, saveService, seedServices, SERVICE_CATEGORIES } from '@/data/commerce'
import type { Service, ServiceCategory } from '@/data/commerce'
import type { I18nText } from '@/data/types'

/**
 * Le catalogue de services, saisi par l'agence.
 *
 * Aucun tarif n'est livré avec le produit, et c'est délibéré : aucun barème
 * tunisien n'est public. Les honoraires d'agence ne sont publiés nulle part,
 * les frais consulaires bougent par note de service, et un prix de transit se
 * négocie au dossier. La liste de départ arrive donc avec treize services et
 * treize prix à zéro. Ce que le produit apporte, c'est la LISTE et la TVA par
 * défaut, jamais le chiffre.
 */

export function ServicesSection() {
  const { db } = useStore()
  const v = useVisible()
  const { t, tt, formatMoney } = useI18n()
  const toast = useToast()

  const [rows, setRows] = useState<Service[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Service | 'nouveau' | null>(null)

  const reload = useCallback(async () => {
    if (!HAS_BACKEND) return
    try { setRows(await loadServices()); setError(null) } catch (e) { setError((e as Error).message) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.category.localeCompare(b.category) || tt(a.name).localeCompare(tt(b.name))),
    [rows, tt],
  )

  const canManage = v.can('settings:manage')

  if (!HAS_BACKEND) {
    return (
      <Card title={t('com.services')}>
        <Empty title={t('com.offline')} hint={t('com.offlineHint')} scene="alerte" />
      </Card>
    )
  }

  return (
    <>
      <Card
        title={t('com.services')}
        action={canManage
          ? <Button variant="primary" icon="plus" onClick={() => setEditing('nouveau')}>{t('com.newService')}</Button>
          : undefined}
        flush
      >
        <p className="tariff__why">
          <Icon name="shield" size={14} />
          <span>{t('com.noPriceInvented')}</span>
        </p>

        {error && <p className="t-small t-orange" style={{ padding: '0 var(--sp-6)' }}>{error}</p>}

        {sorted.length === 0 ? (
          <Empty
            title={t('com.noServices')}
            hint={t('com.noServicesHint')}
            scene="alerte"
            action={canManage
              ? (
                <Button
                  variant="primary"
                  icon="download"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    void seedServices(db.agency.id)
                      .then(async () => { await reload(); toast(t('com.seeded')) })
                      .catch((e) => setError((e as Error).message))
                      .finally(() => setBusy(false))
                  }}
                >
                  {t('com.seed')}
                </Button>
              )
              : undefined}
          />
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('com.category')}</th>
                  <th>{t('com.service')}</th>
                  <th className="num">{t('com.defaultPrice')}</th>
                  <th className="num">{t('com.taxRate')}</th>
                  <th>{t('com.status')}</th>
                  {canManage && <th />}
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.id} style={s.active ? undefined : { opacity: 0.55 }}>
                    <td className="t-caption t-tertiary">{t(`com.cat${s.category}` as 'com.catVISA')}</td>
                    <td className="t-small t-medium">
                      {tt(s.name)}
                      {s.description && <div className="t-caption t-tertiary">{s.description}</div>}
                    </td>
                    <td className="num t-small">
                      {s.defaultPrice > 0
                        ? formatMoney(s.defaultPrice, s.currency)
                        : <span className="t-tertiary">{formatMoney(0, s.currency)}</span>}
                    </td>
                    <td className="num t-small t-tertiary">{s.taxRate}</td>
                    <td>
                      <Pill tone={s.active ? 'green' : 'gray'} dot>
                        {s.active ? t('com.active') : t('com.inactive')}
                      </Pill>
                    </td>
                    {canManage && (
                      <td style={{ textAlign: 'end' }}>
                        <Button size="sm" icon="edit" onClick={() => setEditing(s)}>{t('com.save')}</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <ServiceEditor
          service={editing === 'nouveau' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(); toast(t('com.saved')) }}
        />
      )}
    </>
  )
}

/* ------------------------------- Éditeur ----------------------------- */

function ServiceEditor({ service, onClose, onSaved }: {
  service: Service | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { db } = useStore()
  const { t } = useI18n()

  const [category, setCategory] = useState<ServiceCategory>(service?.category ?? 'OTHER')
  const [nameFr, setNameFr] = useState(service?.name.fr ?? '')
  const [nameEn, setNameEn] = useState(service?.name.en ?? '')
  const [nameAr, setNameAr] = useState(service?.name.ar ?? '')
  const [nameZh, setNameZh] = useState(service?.name.zh ?? '')
  const [description, setDescription] = useState(service?.description ?? '')
  const [price, setPrice] = useState(String(service?.defaultPrice ?? 0))
  const [taxRate, setTaxRate] = useState(String(service?.taxRate ?? 19))
  const [active, setActive] = useState(service?.active ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    try {
      // Seul le français est exigé : `tt()` retombe dessus pour les autres.
      const name: I18nText = { fr: nameFr.trim() }
      if (nameEn.trim()) name.en = nameEn.trim()
      if (nameAr.trim()) name.ar = nameAr.trim()
      if (nameZh.trim()) name.zh = nameZh.trim()

      await saveService(db.agency.id, service?.id ?? null, {
        category,
        name,
        description: description.trim() || null,
        defaultPrice: Math.max(0, Number(price) || 0),
        currency: service?.currency ?? db.agency.currency,
        taxRate: Math.min(100, Math.max(0, Number(taxRate) || 0)),
        active,
      })
      await onSaved()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={service ? t('com.services') : t('com.newService')}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="grow" />
          <Button onClick={onClose}>{t('com.cancel')}</Button>
          <Button variant="primary" disabled={busy || nameFr.trim() === ''} onClick={() => void submit()}>
            {t('com.save')}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <div className="grid grid--2">
          <Field label={t('com.category')}>
            <Select value={category} onChange={(e) => setCategory(e.target.value as ServiceCategory)}>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(`com.cat${c}` as 'com.catVISA')}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('com.nameFr')}>
            <Input value={nameFr} onChange={(e) => setNameFr(e.target.value)} />
          </Field>
          <Field label={t('com.nameEn')} hint={t('com.optional')}>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </Field>
          <Field label={t('com.nameAr')} hint={t('com.optional')}>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
          </Field>
          <Field label={t('com.nameZh')} hint={t('com.optional')}>
            <Input value={nameZh} onChange={(e) => setNameZh(e.target.value)} />
          </Field>
          <Field label={`${t('com.defaultPrice')} (${service?.currency ?? db.agency.currency})`}
            hint={t('com.noPriceInvented')}>
            <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label={t('com.taxRate')}>
            <Input type="number" min={0} max={100} step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
          </Field>
        </div>

        <Field label={t('com.description')}>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div className="row gap-3">
          <Switch checked={active} onChange={setActive} label={t('com.active')} />
          <span className="t-small">{active ? t('com.active') : t('com.inactive')}</span>
        </div>

        {error && <p className="t-small t-orange">{error}</p>}
      </div>
    </Modal>
  )
}
