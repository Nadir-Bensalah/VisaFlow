import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import {
  Button, Card, Combobox, Empty, Field, Input, Modal, Pill, Select, Tabs, useToast,
} from '@/components/ui'
import { PageHead } from '@/components/bits'
import {
  CARRIER_KINDS, DIRECTORY_KINDS, archiveDirectoryEntry, entryLabel,
  listCountries, listDirectory, saveDirectoryEntry,
} from '@/data/fretref'
import type { CarrierKind, Country, DirectoryEntry, DirectoryKind } from '@/data/fretref'

/**
 * Les répertoires de l'agence.
 *
 * Ils existent pour une raison simple, et chère : aujourd'hui une agence qui
 * travaille avec vingt fournisseurs les retape vingt fois. Au bout d'un an on
 * trouve « Ningbo Sunrise », « NINGBO SUNRISE CO » et « ningbo sunrise ltd »
 * dans la même base. Ce sont trois fournisseurs pour la douane, un seul dans
 * la vraie vie. Plus aucun total n'est juste, et la recherche ne trouve rien.
 *
 * Cinq onglets, un tableau, un formulaire. Les cinq répertoires ne portent pas
 * les mêmes champs : le formulaire montre ceux du répertoire ouvert, et rien
 * d'autre. Un formulaire commun avec des cases grisées apprend à les ignorer.
 */

/* Les champs de chaque répertoire, dans l'ordre où on les remplit. */
const CHAMPS: Record<DirectoryKind, (keyof DirectoryEntry)[]> = {
  suppliers: ['companyName', 'contactName', 'country', 'city', 'address',
              'email', 'phone', 'whatsapp', 'taxId', 'registrationNumber'],
  consignees: ['companyName', 'contactName', 'country', 'city', 'address',
               'email', 'phone', 'whatsapp', 'taxId', 'customsCode', 'clientId'],
  shippers: ['companyName', 'contactName', 'country', 'address', 'phone', 'email'],
  carriers: ['name', 'kind', 'country', 'scacCode', 'iataCode',
             'contactName', 'email', 'phone', 'website'],
  customs_brokers: ['companyName', 'customsCode', 'contactName', 'phone', 'email', 'address'],
}

export function Directory() {
  const { db } = useStore()
  const v = useVisible()
  const { t } = useI18n()
  const toast = useToast()
  const [kind, setKind] = useState<DirectoryKind>('suppliers')
  const [rows, setRows] = useState<DirectoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<DirectoryEntry | null>(null)
  const [countries, setCountries] = useState<Country[]>([])

  const agencyId = db.agency.id

  const reload = useCallback(() => {
    listDirectory(kind, agencyId).then(setRows).catch(() => setRows([]))
  }, [kind, agencyId])

  useEffect(() => { reload() }, [reload])
  useEffect(() => { listCountries().then(setCountries).catch(() => setCountries([])) }, [])

  // La recherche se fait sur ce qui est déjà chargé : l'écran est ouvert, les
  // fiches sont là, un aller-retour serveur par lettre tapée n'apporte rien.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((e) =>
      `${entryLabel(e)} ${e.contactName ?? ''} ${e.city ?? ''} ${e.country ?? ''} ${e.customsCode ?? ''} ${e.taxId ?? ''}`
        .toLowerCase().includes(q))
  }, [rows, query])

  const writable = v.can('shipment:write')

  return (
    <>
      <PageHead
        title={t('ref.title')}
        subtitle={t('ref.subtitle')}
        action={writable ? (
          <Button variant="primary" icon="plus" onClick={() => setEditing({ active: true })}>
            {t('ref.newEntry')}
          </Button>
        ) : undefined}
      />

      <Tabs
        value={kind}
        idPrefix="directory"
        onChange={(k) => { setKind(k); setQuery('') }}
        options={DIRECTORY_KINDS.map((k) => ({
          value: k,
          label: t(`ref.${k === 'customs_brokers' ? 'brokers' : k}` as 'ref.suppliers'),
        }))}
      />

      <Card flush>
        <div className="row" style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--hairline)' }}>
          <Input
            aria-label={t('ref.search')}
            placeholder={t('ref.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ maxWidth: 280 }}
          />
        </div>

        {shown.length === 0 ? (
          <Empty
            title={t('ref.none')}
            hint={t('ref.noneHint')}
            scene="equipe"
            action={writable ? (
              <Button variant="primary" icon="plus" onClick={() => setEditing({ active: true })}>
                {t('ref.newEntry')}
              </Button>
            ) : undefined}
          />
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{kind === 'carriers' ? t('ref.name') : t('ref.companyName')}</th>
                  <th className="col-optional">{t('ref.contactName')}</th>
                  <th>{t('ref.country')}</th>
                  <th className="col-optional">{t('ref.phone')}</th>
                  <th className="col-optional">{t('ref.email')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span className="col">
                        <span className="t-medium">{entryLabel(e)}</span>
                        {kind === 'carriers' && e.kind && (
                          <span className="t-caption t-tertiary">
                            {t(`ref.k.${e.kind}` as 'ref.k.compagnie_maritime')}
                          </span>
                        )}
                        {kind === 'customs_brokers' && e.customsCode && (
                          <span className="t-caption t-tertiary t-mono">{e.customsCode}</span>
                        )}
                      </span>
                    </td>
                    <td className="t-small col-optional">{e.contactName ?? '·'}</td>
                    <td className="t-small t-mono">{e.country ?? '·'}</td>
                    <td className="t-small t-mono col-optional">{e.phone ?? '·'}</td>
                    <td className="t-small col-optional">{e.email ?? '·'}</td>
                    <td className="num">
                      <span className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                        {e.active === false && <Pill tone="gray">{t('ref.inactive')}</Pill>}
                        {writable && (
                          <Button size="sm" icon="edit" onClick={() => setEditing(e)}>{t('crud.edit')}</Button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <EntryEditor
          kind={kind}
          agencyId={agencyId}
          countries={countries}
          value={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => { setEditing(null); toast(message); reload() }}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

function EntryEditor({ kind, agencyId, countries, value, onClose, onSaved }: {
  kind: DirectoryKind
  agencyId: string
  countries: Country[]
  value: DirectoryEntry
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { db } = useStore()
  const { t, locale } = useI18n()
  const [form, setForm] = useState<DirectoryEntry>(
    kind === 'carriers' && !value.kind ? { ...value, kind: 'compagnie_maritime' } : value,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof DirectoryEntry, val: unknown) => setForm((f) => ({ ...f, [k]: val }))

  const countryOpts = useMemo(() => countries.map((c) => ({
    value: c.iso2,
    label: locale === 'ar' ? c.nameAr : locale === 'en' ? c.nameEn : c.nameFr,
    hint: c.iso2,
  })), [countries, locale])

  // Le lien vers un client est FACULTATIF, et il doit le rester : en groupage,
  // le destinataire d'un lot peut être une société que l'agence ne facture pas.
  const clientOpts = useMemo(() => db.clients.map((c) => ({
    value: c.id,
    label: `${c.firstName} ${c.lastName}`,
    hint: c.phone,
  })), [db.clients])

  const nom = entryLabel(form)

  const save = async () => {
    if (!nom) { setError(t('ref.required')); return }
    setBusy(true); setError(null)
    try {
      await saveDirectoryEntry(kind, agencyId, form)
      onSaved(t('ref.saved'))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }

  // On archive, on n'efface jamais. Une fiche effacée emporterait la
  // traçabilité de toutes les cargaisons qui la citent : le droit de
  // suppression n'est d'ailleurs pas accordé côté base.
  const archive = async () => {
    if (!form.id) return
    setBusy(true)
    try { await archiveDirectoryEntry(kind, form.id); onSaved(t('ref.archived')) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }

  const champ = (name: keyof DirectoryEntry) => {
    const texte = (label: string, mono = false, upper = false) => (
      <Field key={name} label={label}>
        <Input
          className={mono ? 't-mono' : undefined}
          value={(form[name] as string | null | undefined) ?? ''}
          onChange={(e) => set(name, upper ? e.target.value.toUpperCase() : e.target.value)}
        />
      </Field>
    )
    switch (name) {
      case 'companyName': return texte(t('ref.companyName'))
      case 'name': return texte(t('ref.name'))
      case 'contactName': return texte(t('ref.contactName'))
      case 'city': return texte(t('ref.city'))
      case 'address': return texte(t('ref.address'))
      case 'email': return texte(t('ref.email'))
      case 'phone': return texte(t('ref.phone'), true)
      case 'whatsapp': return texte(t('ref.whatsapp'), true)
      case 'taxId': return texte(t('ref.taxId'), true)
      case 'registrationNumber': return texte(t('ref.registrationNumber'), true)
      case 'website': return texte(t('ref.website'))
      case 'customsCode': return texte(t('ref.customsCode'), true, true)
      case 'scacCode': return texte(t('ref.scacCode'), true, true)
      case 'iataCode': return texte(t('ref.iataCode'), true)
      case 'country':
        return (
          <Field key={name} label={t('ref.country')}>
            <Combobox
              value={form.country ?? ''}
              options={countryOpts}
              emptyLabel={t('ref.none')}
              onChange={(x) => set('country', x || null)}
            />
          </Field>
        )
      case 'clientId':
        return (
          <Field key={name} label={t('ref.clientLink')}>
            <Combobox
              value={form.clientId ?? ''}
              options={clientOpts}
              emptyLabel={t('ref.none')}
              onChange={(x) => set('clientId', x || null)}
            />
          </Field>
        )
      case 'kind':
        return (
          <Field key={name} label={t('ref.carrierKind')}>
            <Select
              value={form.kind ?? 'compagnie_maritime'}
              onChange={(e) => set('kind', e.target.value as CarrierKind)}
            >
              {CARRIER_KINDS.map((k) => (
                <option key={k} value={k}>{t(`ref.k.${k}` as 'ref.k.compagnie_maritime')}</option>
              ))}
            </Select>
          </Field>
        )
      default: return null
    }
  }

  return (
    <Modal
      title={form.id ? t('ref.editEntry') : t('ref.newEntry')}
      onClose={onClose}
      wide
      footer={
        <div className="row-between grow">
          {form.id
            ? <Button variant="danger" icon="trash" disabled={busy} onClick={archive}>{t('ref.archive')}</Button>
            : <span />}
          <div className="row gap-2">
            <Button onClick={onClose}>{t('action.cancel')}</Button>
            <Button variant="primary" icon="save" disabled={busy || !nom} onClick={save}>
              {t('action.save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="col gap-4">
        {CHAMPS[kind].map((name) => champ(name))}

        <Field label={t('ref.note')}>
          <Input value={form.note ?? ''} onChange={(e) => set('note', e.target.value)} />
        </Field>

        <label className="row gap-2">
          <input
            type="checkbox"
            checked={form.active !== false}
            onChange={(e) => set('active', e.target.checked)}
          />
          <span className="t-small">{t('ref.active')}</span>
        </label>

        {error && <p className="t-small t-red" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
