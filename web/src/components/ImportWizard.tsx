import { useMemo, useRef, useState } from 'react'
import { useStore } from '@/data/store'
import { useVisible } from '@/data/scope'
import { useI18n } from '@/i18n'
import { Button, Field, Modal, Select, useToast } from '@/components/ui'
import { HAS_BACKEND } from '@/lib/supabase'
import { XLSX_SUPPORTED, guessMapping, readTable } from '@/lib/csv'
import type { Row } from '@/lib/csv'
import {
  createImportJob, finishImportJob, findClientDuplicates, insertRows,
} from '@/data/documents'
import type { DuplicateHit, ImportEntity } from '@/data/documents'

/* L'assistant d'import, générique.
 *
 * LA RÈGLE : rien ne s'écrit avant que l'utilisateur ait vu ce qui va s'écrire.
 * Un import qui crée trois cents doublons se répare en trois jours, à la main,
 * fiche par fiche. Les quatre étapes servent toutes cette règle :
 *   fichier → correspondance des colonnes → aperçu et doublons → écriture.
 *
 * Le lecteur CSV vient de l'import de clients, qui a déjà tourné sur de vrais
 * exports Excel tunisiens. Le lecteur .xlsx s'y ajoute, quand le navigateur
 * sait décompresser. Quand il ne sait pas, l'écran le DIT et donne la marche à
 * suivre. Il ne fait jamais semblant de lire un classeur.
 *
 * Les doublons de clients passent par `client_duplicates` (migration 0039) :
 * même téléphone sur les huit derniers chiffres, même passeport et date de
 * naissance, même nom arabe normalisé et date de naissance. On ne réinvente
 * pas cette comparaison dans le navigateur, elle serait plus faible.
 */

type FieldKey = string

interface FieldDef {
  key: FieldKey
  label: string
  hints: string[]
  required?: boolean
  /** La colonne de la table. Absente : le champ sert seulement à rattacher. */
  column?: string
  kind?: 'texte' | 'nombre' | 'date'
}

interface EntityDef {
  table: string
  fields: FieldDef[]
  /** Vrai quand chaque ligne doit être rattachée à un client existant. */
  needsClient?: boolean
  /** Vrai quand l'écran demande un type de visa avant d'écrire. */
  needsVisaType?: boolean
  /** Vrai quand l'écran demande un mode de transport avant d'écrire. */
  needsMode?: boolean
}

const MODES = ['maritime_fcl', 'maritime_lcl', 'aerien', 'routier'] as const

/** Une date écrite à la main : 12/03/1990, 1990-03-12, 12-03-1990. */
function toIsoDate(raw: string): string | null {
  const s = raw.trim()
  if (s === '') return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

function toNumber(raw: string): number | null {
  // Une virgule décimale, des espaces de milliers : le tableur français écrit
  // « 1 250,50 » et le nôtre doit le lire.
  const s = raw.replace(/\s/g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Le téléphone se compare sur ses huit derniers chiffres, comme en base. */
function phoneKey(raw: string): string {
  return raw.replace(/[^0-9]/g, '').slice(-8)
}

export function ImportWizard({ entityKind, onClose, onDone }: {
  entityKind: ImportEntity
  onClose: () => void
  onDone?: (imported: number) => void
}) {
  const { db } = useStore()
  const v = useVisible()
  const { t } = useI18n()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const DEFS: Record<ImportEntity, EntityDef> = useMemo(() => ({
    clients: {
      table: 'clients',
      fields: [
        { key: 'firstName', label: t('doc2.fFirstName'), hints: ['prenom', 'first', 'given', 'الاسم'], required: true, column: 'first_name' },
        { key: 'lastName', label: t('doc2.fLastName'), hints: ['nom', 'last', 'surname', 'family', 'اللقب'], column: 'last_name' },
        { key: 'phone', label: t('doc2.fPhone'), hints: ['tel', 'phone', 'mobile', 'gsm', 'portable', 'هاتف'], required: true, column: 'phone' },
        { key: 'nativeName', label: t('doc2.fNativeName'), hints: ['arabe', 'arabic', 'nom ar'], column: 'native_name' },
        { key: 'email', label: t('doc2.fEmail'), hints: ['mail', 'courriel', 'بريد'], column: 'email' },
        { key: 'nationality', label: t('doc2.fNationality'), hints: ['nationalite', 'nationality', 'جنسية'], column: 'nationality' },
        { key: 'passportNumber', label: t('doc2.fPassport'), hints: ['passeport', 'passport', 'جواز'], column: 'passport_number' },
        { key: 'birthDate', label: t('doc2.fBirthDate'), hints: ['naissance', 'birth', 'ولادة'], column: 'birth_date', kind: 'date' },
        { key: 'address', label: t('doc2.fAddress'), hints: ['adresse', 'address', 'عنوان'], column: 'address' },
      ],
    },
    prospects: {
      table: 'leads',
      fields: [
        { key: 'firstName', label: t('doc2.fFirstName'), hints: ['prenom', 'first', 'given'], column: 'first_name' },
        { key: 'lastName', label: t('doc2.fLastName'), hints: ['nom', 'last', 'surname'], column: 'last_name' },
        { key: 'phone', label: t('doc2.fPhone'), hints: ['tel', 'phone', 'mobile', 'gsm'], required: true, column: 'phone' },
        { key: 'email', label: t('doc2.fEmail'), hints: ['mail', 'courriel'], column: 'email' },
        { key: 'companyName', label: t('doc2.fCompany'), hints: ['societe', 'company', 'entreprise'], column: 'company_name' },
        { key: 'note', label: t('doc2.fNote'), hints: ['note', 'remarque', 'comment'], column: 'note' },
      ],
    },
    dossiers: {
      table: 'cases',
      needsClient: true,
      needsVisaType: true,
      fields: [
        { key: 'clientPhone', label: t('doc2.fPhone'), hints: ['tel', 'phone', 'mobile', 'gsm'], required: true },
        { key: 'reference', label: t('doc2.fReference'), hints: ['reference', 'ref', 'dossier'], column: 'reference', required: true },
        { key: 'amountTotal', label: t('doc2.fAmount'), hints: ['montant', 'amount', 'total', 'prix'], column: 'amount_total', kind: 'nombre' },
      ],
    },
    factures: {
      table: 'invoices',
      needsClient: true,
      fields: [
        { key: 'clientPhone', label: t('doc2.fPhone'), hints: ['tel', 'phone', 'mobile', 'gsm'], required: true },
        { key: 'number', label: t('doc2.fNumber'), hints: ['numero', 'number', 'facture', 'invoice'], column: 'number' },
        { key: 'issueDate', label: t('doc2.fIssueDate'), hints: ['date', 'emission', 'issue'], column: 'issue_date', kind: 'date' },
        { key: 'dueDate', label: t('doc2.fDueDate'), hints: ['echeance', 'due'], column: 'due_date', kind: 'date' },
        { key: 'total', label: t('doc2.fAmount'), hints: ['montant', 'amount', 'total', 'ttc'], column: 'total', kind: 'nombre', required: true },
        { key: 'currency', label: t('doc2.fCurrency'), hints: ['devise', 'currency', 'monnaie'], column: 'currency' },
      ],
    },
    contacts: {
      table: 'client_contacts',
      needsClient: true,
      fields: [
        { key: 'clientPhone', label: t('doc2.fPhone'), hints: ['tel client', 'phone', 'mobile', 'gsm'], required: true },
        { key: 'name', label: t('doc2.fLastName'), hints: ['nom', 'name', 'contact'], column: 'name', required: true },
        { key: 'relationship', label: t('doc2.fRelationship'), hints: ['lien', 'relation'], column: 'relationship' },
        { key: 'email', label: t('doc2.fEmail'), hints: ['mail', 'courriel'], column: 'email' },
        { key: 'contactPhone', label: t('doc2.fPhone'), hints: ['tel contact', 'telephone 2'], column: 'phone' },
      ],
    },
    cargaisons: {
      table: 'shipments',
      needsMode: true,
      fields: [
        { key: 'reference', label: t('doc2.fReference'), hints: ['reference', 'ref', 'dossier'], column: 'reference', required: true },
        { key: 'goods', label: t('doc2.fGoods'), hints: ['marchandise', 'goods', 'produit'], column: 'goods' },
        { key: 'originCity', label: t('doc2.fOriginCity'), hints: ['depart', 'origine', 'origin', 'from'], column: 'origin_city' },
        { key: 'destCity', label: t('doc2.fDestCity'), hints: ['arrivee', 'destination', 'dest', 'to'], column: 'dest_city' },
      ],
    },
  }), [t])

  const def = DEFS[entityKind]

  const [rows, setRows] = useState<Row[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [source, setSource] = useState<'csv' | 'xlsx'>('csv')
  const [hasHeader, setHasHeader] = useState(true)
  const [map, setMap] = useState<Record<string, number>>({})
  const [step, setStep] = useState<'fichier' | 'colonnes' | 'apercu' | 'compte'>('fichier')
  const [dups, setDups] = useState<Record<number, DuplicateHit> | null>(null)
  const [skip, setSkip] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [visaTypeId, setVisaTypeId] = useState(db.visaTypes[0]?.id ?? '')
  const [mode, setMode] = useState<(typeof MODES)[number]>('maritime_fcl')
  const [report, setReport] = useState<{ imported: number; skipped: number; errors: { row: number; reason: string }[] } | null>(null)

  const onFile = async (file: File) => {
    try {
      const read = await readTable(file)
      if (read.rows.length === 0) { toast(t('doc2.importEmpty')); return }
      const header = read.rows[0]
      const hints = Object.fromEntries(def.fields.map((f) => [f.key, f.hints]))
      const guess = guessMapping(header, hints)
      // Une première ligne qui ressemble à des intitulés en est une.
      setHasHeader(def.fields.some((f) => guess[f.key] >= 0))
      setMap(guess)
      setRows(read.rows)
      setFileName(file.name)
      setSource(read.source)
      setStep('colonnes')
    } catch (error) {
      const msg = (error as Error).message
      if (msg === 'xls_ancien') { toast(t('doc2.importXlsOld')); return }
      if (msg === 'xlsx_non_supporte') { toast(t('doc2.importCsvOnly')); return }
      toast(t('doc2.importUnreadable', { msg }))
    }
  }

  const cols = rows?.[0]?.length ?? 0
  const headerRow = rows && hasHeader ? rows[0] : null
  const body = useMemo(() => (rows ? (hasHeader ? rows.slice(1) : rows) : []), [rows, hasHeader])

  const cell = (row: Row, key: string): string => {
    const at = map[key]
    return at >= 0 ? (row[at] ?? '').trim() : ''
  }

  const missingRequired = def.fields.filter((f) => f.required && (map[f.key] ?? -1) < 0)

  /** Les lignes retenues : celles qui portent tous les champs obligatoires. */
  const valid = useMemo(
    () => body
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => def.fields.every((f) => !f.required || cell(row, f.key) !== '')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [body, map, def],
  )

  /** Rattache une ligne à un client déjà là, par le téléphone. */
  const clientFor = (row: Row): string | null => {
    const key = phoneKey(cell(row, 'clientPhone'))
    if (key.length < 6) return null
    // On cherche dans `v.clients`, donc dans le périmètre de la personne. Un
    // agent ne rattache pas un dossier à un client d'un bureau qu'il ne voit pas.
    const found = v.clients.find((c) => phoneKey(c.phone) === key)
    return found?.id ?? null
  }

  /** L'étape des doublons. Elle interroge le serveur ligne à ligne, ce qui est
      lent, mais elle ne tourne qu'une fois et sur les seuls clients. */
  const checkDuplicates = async () => {
    setStep('apercu')
    if (entityKind !== 'clients' || !HAS_BACKEND) { setDups({}); return }
    setBusy(true)
    const found: Record<number, DuplicateHit> = {}
    const chosen = new Set<number>()
    // Au-delà de deux cents lignes, l'attente devient insupportable : on
    // contrôle les deux cents premières et on le laisse voir dans le compte.
    for (const { row, index } of valid.slice(0, 200)) {
      const hits = await findClientDuplicates(db.agency.id, {
        phone: cell(row, 'phone'),
        passport: cell(row, 'passportNumber'),
        birth: toIsoDate(cell(row, 'birthDate')),
        native: cell(row, 'nativeName'),
      })
      if (hits.length > 0) { found[index] = hits[0]; chosen.add(index) }
    }
    setDups(found)
    // Par défaut, un doublon repéré n'est PAS créé. L'utilisateur peut lever
    // la coche, mais le geste par défaut est celui qui ne casse rien.
    setSkip(chosen)
    setBusy(false)
  }

  const buildRow = (row: Row): Record<string, unknown> | { error: string } => {
    const out: Record<string, unknown> = {
      agency_id: db.agency.id,
      office_id: v.officeId ?? db.agency.offices[0]?.id ?? null,
    }
    for (const f of def.fields) {
      if (!f.column) continue
      const raw = cell(row, f.key)
      if (raw === '') continue
      if (f.kind === 'date') {
        const iso = toIsoDate(raw)
        if (iso === null) return { error: `${f.label} : « ${raw} »` }
        out[f.column] = iso
      } else if (f.kind === 'nombre') {
        const n = toNumber(raw)
        if (n === null) return { error: `${f.label} : « ${raw} »` }
        out[f.column] = n
      } else {
        out[f.column] = raw
      }
    }
    if (def.needsClient) {
      const clientId = clientFor(row)
      if (!clientId) return { error: t('doc2.fPhone') }
      out.client_id = clientId
    }
    if (def.needsVisaType) {
      if (!visaTypeId) return { error: t('doc2.fReference') }
      out.visa_type_id = visaTypeId
    }
    if (def.needsMode) out.mode = mode
    if (entityKind === 'clients') {
      // Le magasin impose une langue et une nationalité : on prend celles de
      // l'agence plutôt que de laisser un champ vide qui ressortira au guichet.
      out.locale = out.locale ?? db.agency.defaultLocale
      out.nationality = out.nationality ?? 'Tunisienne'
      if (!out.last_name) out.last_name = ''
    }
    if (entityKind === 'factures') {
      // Une facture importée porte son total tel quel : elle vient d'un autre
      // logiciel, ses lignes n'existent pas ici, et le solde en découle.
      const total = Number(out.total ?? 0)
      out.subtotal = out.subtotal ?? total
      out.balance_due = total
      out.status = 'emise'
    }
    return out
  }

  const write = async () => {
    if (!HAS_BACKEND) { toast(t('doc2.importNoBackend')); return }
    setBusy(true)
    const payload: Record<string, unknown>[] = []
    const errors: { row: number; reason: string }[] = []
    let skipped = 0
    for (const { row, index } of valid) {
      if (skip.has(index)) { skipped++; continue }
      const built = buildRow(row)
      if ('error' in built) { errors.push({ row: index + 1, reason: String(built.error) }); skipped++; continue }
      payload.push(built)
    }
    let jobId: string | null = null
    try {
      jobId = await createImportJob({
        agencyId: db.agency.id,
        officeId: v.officeId ?? db.agency.offices[0]?.id ?? null,
        entityKind, fileName, totalRows: body.length, mapping: map,
      })
      const result = await insertRows(def.table, payload)
      const allErrors = [...errors, ...result.errors]
      if (jobId) {
        await finishImportJob(jobId, result.imported > 0 ? 'termine' : 'echoue',
          result.imported, body.length - result.imported, allErrors)
      }
      setReport({ imported: result.imported, skipped: body.length - result.imported, errors: allErrors })
      onDone?.(result.imported)
    } catch (error) {
      const reason = (error as Error).message
      if (jobId) await finishImportJob(jobId, 'echoue', 0, body.length, [{ row: 0, reason }]).catch(() => {})
      setReport({ imported: 0, skipped: body.length, errors: [{ row: 0, reason }] })
    } finally {
      setBusy(false)
      setStep('compte')
    }
  }

  const shown = def.fields.filter((f) => (map[f.key] ?? -1) >= 0)
  const colOptions = Array.from({ length: cols }, (_, i) => i)
  const willWrite = valid.filter(({ index }) => !skip.has(index)).length

  const footer = (() => {
    if (step === 'colonnes') return (
      <>
        <Button onClick={() => { setRows(null); setStep('fichier') }}>{t('doc2.importBack')}</Button>
        <Button variant="primary" disabled={missingRequired.length > 0 || valid.length === 0}
          onClick={() => void checkDuplicates()}>{t('doc2.next')}</Button>
      </>
    )
    if (step === 'apercu') return (
      <>
        <Button onClick={() => setStep('colonnes')}>{t('doc2.importBack')}</Button>
        <Button variant="primary" disabled={busy || willWrite === 0} onClick={() => void write()}>
          {busy ? t('doc2.importWriting') : t('doc2.importWrite', { n: willWrite })}
        </Button>
      </>
    )
    if (step === 'compte') return <Button variant="primary" onClick={onClose}>{t('doc2.close')}</Button>
    return <Button onClick={onClose}>{t('doc2.cancel')}</Button>
  })()

  return (
    <Modal title={t('doc2.importOf', { what: t(`doc2.ent${entityKind[0].toUpperCase()}${entityKind.slice(1)}` as 'doc2.entClients') })}
      onClose={onClose} wide footer={footer}>
      <div className="col gap-4">
        {!HAS_BACKEND && <p className="t-small" style={{ color: 'var(--orange)' }}>{t('doc2.importNoBackend')}</p>}

        {step === 'fichier' && (
          <div className="import__drop">
            <p className="t-secondary">{t('doc2.importHint')}</p>
            {/* On ne prétend pas lire ce qu'on ne lit pas. */}
            {!XLSX_SUPPORTED && <p className="t-caption" style={{ color: 'var(--orange)' }}>{t('doc2.importCsvOnly')}</p>}
            {XLSX_SUPPORTED && <p className="t-caption t-tertiary">{t('doc2.importFirstSheet')} {t('doc2.importDatesRead')}</p>}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }}
            />
            <Button icon="upload" onClick={() => fileRef.current?.click()}>{t('doc2.importPick')}</Button>
          </div>
        )}

        {step === 'colonnes' && rows && (
          <>
            <p className="t-caption t-tertiary">{fileName} · {source.toUpperCase()} · {t('doc2.importMappingHint')}</p>
            <div className="grid grid--2">
              {def.fields.map((f) => (
                <Field key={f.key} label={f.required ? `${f.label} *` : f.label}>
                  <Select value={String(map[f.key] ?? -1)}
                    onChange={(e) => setMap((m) => ({ ...m, [f.key]: Number(e.target.value) }))}>
                    <option value="-1">{t('doc2.importIgnore')}</option>
                    {colOptions.map((i) => (
                      <option key={i} value={i}>{headerRow?.[i]?.trim() || t('doc2.importCol', { n: i + 1 })}</option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>

            {def.needsVisaType && (
              <Field label={t('doc2.fReference')}>
                <Select value={visaTypeId} onChange={(e) => setVisaTypeId(e.target.value)}>
                  {db.visaTypes.map((vt) => (
                    <option key={vt.id} value={vt.id}>{vt.label.fr} · {vt.country.fr}</option>
                  ))}
                </Select>
              </Field>
            )}
            {def.needsMode && (
              <Field label={t('doc2.fMode')}>
                <Select value={mode} onChange={(e) => setMode(e.target.value as (typeof MODES)[number])}>
                  {MODES.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
                </Select>
              </Field>
            )}

            <label className="row gap-2" style={{ alignItems: 'center' }}>
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              <span className="t-small t-secondary">{t('doc2.importHasHeader')}</span>
            </label>

            {missingRequired.length > 0 && (
              <p className="t-small" style={{ color: 'var(--red)' }}>
                {t('doc2.importRequired', { fields: missingRequired.map((f) => f.label).join(', ') })}
              </p>
            )}
          </>
        )}

        {step === 'apercu' && (
          <>
            <p className="t-caption t-tertiary">{t('doc2.importPreview', { valid: valid.length, total: body.length })}</p>
            {valid.length === 0 && <p className="t-small" style={{ color: 'var(--red)' }}>{t('doc2.importNothing')}</p>}

            <div className="tablewrap" style={{ maxHeight: 260, overflow: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 34 }} />
                    {shown.map((f) => <th key={f.key}>{f.label}</th>)}
                    {entityKind === 'clients' && <th>{t('doc2.importDuplicates')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {valid.slice(0, 60).map(({ row, index }) => {
                    const hit = dups?.[index]
                    return (
                      <tr key={index} style={hit ? { background: 'var(--tint-orange)' } : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={t('doc2.importSkipDup')}
                            checked={!skip.has(index)}
                            onChange={(e) => setSkip((s) => {
                              const next = new Set(s)
                              if (e.target.checked) next.delete(index); else next.add(index)
                              return next
                            })}
                          />
                        </td>
                        {shown.map((f) => <td key={f.key}>{cell(row, f.key) || '·'}</td>)}
                        {entityKind === 'clients' && (
                          <td className="t-caption">
                            {hit ? t('doc2.importDupReason', {
                              name: `${hit.first_name} ${hit.last_name}`.trim(),
                              motif: hit.motif.replace(/_/g, ' '),
                            }) : ''}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {entityKind === 'clients' && (
              <p className="t-caption t-tertiary">
                {busy ? t('doc2.importDupChecking')
                  : dups && Object.keys(dups).length > 0 ? t('doc2.importDuplicatesHint')
                    : t('doc2.importDupNone')}
              </p>
            )}
          </>
        )}

        {step === 'compte' && report && (
          <>
            <p className="t-title">{t('doc2.importDone', { imported: report.imported, skipped: report.skipped })}</p>
            {report.errors.length > 0 && (
              <>
                <p className="t-caption t-tertiary">{t('doc2.importErrors')}</p>
                <div className="tablewrap" style={{ maxHeight: 200, overflow: 'auto' }}>
                  <table className="table">
                    <tbody>
                      {report.errors.slice(0, 100).map((e, i) => (
                        <tr key={i}><td className="t-caption">{t('doc2.importErrorRow', { row: e.row, reason: e.reason })}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
