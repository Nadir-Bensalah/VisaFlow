import { useMemo, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import {
  Button, Combobox, Empty, Field, Input, Modal, Pill, Segmented, Select, Tabs, useToast,
} from '@/components/ui'
import { Icon } from '@/components/Icon'
import { ExportButton } from '@/components/ExportButton'
import {
  Erreur, Kpi, KpiGrid, PageHeader, Section, Squelette, Table, Toolbar, Vide, useChargement,
} from '@/components/page'
import { HAS_BACKEND } from '@/lib/supabase'
import {
  CARRIER_KINDS, DIRECTORY_KINDS, archiveDirectoryEntry, entryLabel,
  listCountries, listDirectory, saveDirectoryEntry,
} from '@/data/fretref'
import type { CarrierKind, Country, DirectoryEntry, DirectoryKind } from '@/data/fretref'
import '@/styles/modules.css'

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

type Etat = 'actives' | 'inactives' | 'toutes'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const digits = (s?: string | null) => (s ?? '').replace(/[^0-9]/g, '')

export function Directory() {
  const { db } = useStore()
  const v = useVisible()
  const { t } = useI18n()
  const toast = useToast()
  const [kind, setKind] = useState<DirectoryKind>('suppliers')
  const [query, setQuery] = useState('')
  const [etat, setEtat] = useState<Etat>('actives')
  const [editing, setEditing] = useState<DirectoryEntry | null>(null)

  const agencyId = db.agency.id

  const { data, loading, refreshing, error, reload } = useChargement(
    () => listDirectory(kind, agencyId),
    [kind, agencyId],
  )
  const rows = useMemo(() => data ?? [], [data])
  // Les pays ne bloquent jamais l'écran : sans eux, le champ reste une liste vide.
  const pays = useChargement(() => listCountries().catch(() => [] as Country[]))
  const countries = useMemo(() => pays.data ?? [], [pays.data])

  const compte = useMemo(() => {
    const actives = rows.filter((e) => e.active !== false)
    const paysSet = new Set(rows.map((e) => e.country).filter(Boolean))
    const avecContact = rows.filter((e) => e.phone || e.email || e.whatsapp)
    return { actives: actives.length, inactives: rows.length - actives.length, pays: paysSet.size, contact: avecContact.length }
  }, [rows])

  // La recherche se fait sur ce qui est déjà chargé : l'écran est ouvert, les
  // fiches sont là, un aller-retour serveur par lettre tapée n'apporte rien.
  const shown = useMemo(() => {
    const q = norm(query.trim())
    return rows.filter((e) => {
      const ok = etat === 'toutes' ? true : etat === 'actives' ? e.active !== false : e.active === false
      if (!ok) return false
      if (!q) return true
      return norm(`${entryLabel(e)} ${e.contactName ?? ''} ${e.city ?? ''} ${e.country ?? ''} ${e.customsCode ?? ''} ${e.taxId ?? ''} ${e.phone ?? ''} ${e.email ?? ''}`).includes(q)
    })
  }, [rows, query, etat])

  const writable = v.can('shipment:write')

  const colonnesExport = [
    { key: 'name', label: kind === 'carriers' ? t('ref.name') : t('ref.companyName'), value: (e: DirectoryEntry) => entryLabel(e) },
    { key: 'kind', label: t('ref.carrierKind'), value: (e: DirectoryEntry) => (e.kind ? t(`ref.k.${e.kind}` as 'ref.k.compagnie_maritime') : '') },
    { key: 'contact', label: t('ref.contactName'), value: (e: DirectoryEntry) => e.contactName },
    { key: 'country', label: t('ref.country'), value: (e: DirectoryEntry) => e.country },
    { key: 'city', label: t('ref.city'), value: (e: DirectoryEntry) => e.city },
    { key: 'address', label: t('ref.address'), value: (e: DirectoryEntry) => e.address },
    { key: 'phone', label: t('ref.phone'), value: (e: DirectoryEntry) => e.phone },
    { key: 'whatsapp', label: t('ref.whatsapp'), value: (e: DirectoryEntry) => e.whatsapp },
    { key: 'email', label: t('ref.email'), value: (e: DirectoryEntry) => e.email },
    { key: 'taxId', label: t('ref.taxId'), value: (e: DirectoryEntry) => e.taxId },
    { key: 'customs', label: t('ref.customsCode'), value: (e: DirectoryEntry) => e.customsCode },
    { key: 'active', label: t('ref.active'), value: (e: DirectoryEntry) => (e.active !== false ? t('misc.yes') : t('misc.no')) },
  ]

  const libelleOnglet = (k: DirectoryKind) => t(`ref.${k === 'customs_brokers' ? 'brokers' : k}` as 'ref.suppliers')

  const head = (
    <PageHeader
      kicker={t('mq.kickerCargo')}
      title={t('ref.title')}
      subtitle={t('mq.directorySub')}
      refreshing={refreshing && !loading}
      refreshingLabel={t('mq.refreshing')}
      actions={HAS_BACKEND ? <>
        <ExportButton rows={shown} columns={colonnesExport} base={`repertoire-${kind}`} scope="repertoires" disabled={shown.length === 0} />
        <Button icon="refresh" onClick={() => void reload()} disabled={refreshing}>{t('mq.refresh')}</Button>
        {writable && (
          <Button variant="primary" icon="plus" onClick={() => setEditing({ active: true })}>
            {t('ref.newEntry')}
          </Button>
        )}
      </> : undefined}
    />
  )

  if (!HAS_BACKEND) {
    return (
      <>
        {head}
        <Section><Empty title={t('mq.demoTitle')} hint={t('mq.demoHint')} scene="cargo" /></Section>
      </>
    )
  }

  return (
    <>
      {head}

      <div className="md-tabs">
        <Tabs
          value={kind}
          idPrefix="directory"
          onChange={(k) => { setKind(k); setQuery('') }}
          options={DIRECTORY_KINDS.map((k) => ({ value: k, label: libelleOnglet(k) }))}
        />
      </div>

      {error && <Erreur message={error} retryLabel={t('mq.retry')} onRetry={() => void reload()} />}

      {loading && !data ? (
        <>
          <Squelette type="kpis" n={4} />
          <Section flush><Squelette type="table" n={6} /></Section>
        </>
      ) : (
        <>
          <KpiGrid>
            <Kpi label={t('mq.dirActive')} value={compte.actives} icon="clients" tone="blue" hint={libelleOnglet(kind)} />
            <Kpi label={t('mq.dirInactive')} value={compte.inactives} icon="lock" hint={t('mq.dirInactiveHint')} />
            <Kpi label={t('mq.dirCountries')} value={compte.pays} icon="portal" hint={t('mq.dirCountriesHint')} />
            <Kpi label={t('mq.dirWithContact')} value={compte.contact} icon="phone"
                 tone={rows.length > 0 && compte.contact < rows.length ? 'orange' : undefined}
                 hint={t('mq.dirWithContactHint', { n: rows.length })} />
          </KpiGrid>

          {rows.length === 0 ? (
            <Section>
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
            </Section>
          ) : (
            <Section flush>
              <Toolbar right={<><span className="t-caption t-tertiary t-num">{t('mq.rowsOf', { n: shown.length, total: rows.length })}</span><Input
                  className="md-search"
                  aria-label={t('ref.search')}
                  placeholder={t('ref.search')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                /></>}>
                <Segmented<Etat>
                  value={etat}
                  onChange={setEtat}
                  label={t('ref.active')}
                  options={[
                    { value: 'actives', label: `${t('ref.active')} · ${compte.actives}` },
                    { value: 'inactives', label: `${t('ref.inactive')} · ${compte.inactives}` },
                    { value: 'toutes', label: `${t('mq.all')} · ${rows.length}` },
                  ]}
                />
              </Toolbar>

              {shown.length === 0 ? (
                <Vide title={t('mq.nothingInFilter')} hint={t('mq.nothingInFilterHint')} icon="search" />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>{kind === 'carriers' ? t('ref.name') : t('ref.companyName')}</th>
                      <th className="col-optional">{t('ref.contactName')}</th>
                      <th>{t('ref.country')}</th>
                      <th className="col-optional">{t('ref.phone')}</th>
                      <th className="col-optional">{t('ref.email')}</th>
                      <th className="actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => {
                      const wa = digits(e.whatsapp ?? e.phone)
                      return (
                        <tr key={e.id} className={`adm-row--click ${e.active === false ? 'adm-row--off' : ''}`} onClick={() => writable && setEditing(e)}>
                          <td>
                            <div className="adm-cell-main">
                              <span className="row gap-2">
                                {entryLabel(e)}
                                {e.active === false && <Pill tone="gray">{t('ref.inactive')}</Pill>}
                              </span>
                              {kind === 'carriers' && e.kind && (
                                <span className="t-caption">{t(`ref.k.${e.kind}` as 'ref.k.compagnie_maritime')}</span>
                              )}
                              {kind === 'customs_brokers' && e.customsCode && (
                                <span className="t-caption t-mono">{e.customsCode}</span>
                              )}
                              {e.city && kind !== 'carriers' && kind !== 'customs_brokers' && (
                                <span className="t-caption">{e.city}</span>
                              )}
                            </div>
                          </td>
                          <td className="col-optional">{e.contactName ?? <span className="t-tertiary">·</span>}</td>
                          <td className="t-mono">{e.country ?? <span className="t-tertiary">·</span>}</td>
                          <td className="t-mono col-optional">{e.phone ?? <span className="t-tertiary">·</span>}</td>
                          <td className="col-optional">{e.email ?? <span className="t-tertiary">·</span>}</td>
                          <td className="actions" onClick={(ev) => ev.stopPropagation()}>
                            {e.phone && <a className="btn btn--secondary btn--sm" href={`tel:${e.phone.replace(/\s/g, '')}`} title={t('crm.call')} aria-label={t('crm.call')}><Icon name="phone" size={14} /></a>}
                            {wa && <a className="btn btn--secondary btn--sm" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" title={t('crm.whatsappOpen')} aria-label={t('crm.whatsappOpen')}><Icon name="whatsapp" size={14} /></a>}
                            {e.email && <a className="btn btn--secondary btn--sm" href={`mailto:${e.email}`} title={t('ref.email')} aria-label={t('ref.email')}><Icon name="mail" size={14} /></a>}
                            {writable && (
                              <Button size="sm" icon="edit" onClick={() => setEditing(e)}>{t('crud.edit')}</Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              )}
            </Section>
          )}
        </>
      )}

      {editing && (
        <EntryEditor
          kind={kind}
          agencyId={agencyId}
          countries={countries}
          value={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => { setEditing(null); toast(message); void reload() }}
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
