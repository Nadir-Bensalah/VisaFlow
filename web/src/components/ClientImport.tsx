import { useMemo, useRef, useState } from 'react'
import { useStore } from '@/data/store'
import { useI18n } from '@/i18n'
import { Button, Field, Modal, Select, useToast } from '@/components/ui'

/**
 * Une agence n'arrive jamais les mains vides : elle a sa liste de clients dans
 * un tableur. Lui faire ressaisir trois cents lignes à la main, c'est la perdre
 * avant d'avoir commencé. Ici elle dépose son export CSV (le « Enregistrer sous
 * CSV » d'Excel), on devine les colonnes, elle vérifie la correspondance, elle
 * voit un aperçu, et tout entre d'un coup. Aucune dépendance : le CSV se lit à
 * la main, point-virgule ou virgule, guillemets compris, comme Excel l'exporte
 * sous nos latitudes.
 */

type Row = string[]
type FieldKey = 'firstName' | 'lastName' | 'phone' | 'email' | 'nationality' | 'passportNumber'

const FIELDS: FieldKey[] = ['firstName', 'lastName', 'phone', 'email', 'nationality', 'passportNumber']

// Devine à quoi correspond une colonne d'après son en-tête, en français, anglais,
// arabe translittéré ou non. On enlève accents et casse avant de comparer.
const HEADER_HINTS: Record<FieldKey, string[]> = {
  firstName: ['prenom', 'first', 'firstname', 'given', 'الاسم', 'ism'],
  lastName: ['nom', 'last', 'lastname', 'surname', 'family', 'اللقب', 'laqab'],
  phone: ['tel', 'phone', 'mobile', 'gsm', 'portable', 'numero', 'هاتف', 'jawal', 'contact'],
  email: ['mail', 'email', 'courriel', 'بريد'],
  nationality: ['nationalite', 'nationality', 'pays', 'country', 'جنسية'],
  passportNumber: ['passeport', 'passport', 'جواز'],
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

// Un lecteur CSV minimal mais correct : séparateur deviné (';' ou ','), champs
// entre guillemets, guillemets doublés à l'intérieur, fins de ligne mêlées.
function parseCsv(text: string): Row[] {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const firstLine = clean.split('\n')[0] ?? ''
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: Row[] = []
  let field = ''
  let row: Row = []
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === delim) {
      row.push(field); field = ''
    } else if (ch === '\n') {
      row.push(field); rows.push(row); field = ''; row = []
    } else field += ch
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export function ClientImport({ onClose }: { onClose: () => void }) {
  const { db, actions } = useStore()
  const { t } = useI18n()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [hasHeader, setHasHeader] = useState(true)
  const [map, setMap] = useState<Record<FieldKey, number>>({
    firstName: -1, lastName: -1, phone: -1, email: -1, nationality: -1, passportNumber: -1,
  })

  const onFile = async (file: File) => {
    const text = await file.text()
    const parsed = parseCsv(text)
    if (parsed.length === 0) { toast(t('import.empty')); return }
    const header = parsed[0].map(norm)
    // Devine la correspondance des colonnes depuis l'en-tête.
    const guess: Record<FieldKey, number> = { ...map }
    FIELDS.forEach((f: FieldKey) => {
      guess[f] = header.findIndex((h) => HEADER_HINTS[f].some((hint) => h.includes(hint)))
    })
    const looksHeader = FIELDS.some((f) => guess[f] >= 0)
    setHasHeader(looksHeader)
    setMap(guess)
    setRows(parsed)
  }

  const cols = rows?.[0]?.length ?? 0
  const body = useMemo(() => (rows ? (hasHeader ? rows.slice(1) : rows) : []), [rows, hasHeader])
  const headerRow = rows && hasHeader ? rows[0] : null

  // Une ligne est valable si elle porte au moins un nom et un téléphone.
  const valid = body.filter((r) => {
    const fn = map.firstName >= 0 ? (r[map.firstName] ?? '').trim() : ''
    const ln = map.lastName >= 0 ? (r[map.lastName] ?? '').trim() : ''
    const ph = map.phone >= 0 ? (r[map.phone] ?? '').trim() : ''
    return (fn || ln) && ph
  })

  const run = () => {
    const officeId = db.agency.offices[0].id
    const locale = db.agency.defaultLocale
    let n = 0
    valid.forEach((r) => {
      const get = (f: FieldKey) => (map[f] >= 0 ? (r[map[f]] ?? '').trim() : '')
      const first = get('firstName')
      const last = get('lastName')
      actions.createClient({
        firstName: first || last,
        lastName: first ? last : '',
        phone: get('phone'),
        email: get('email') || undefined,
        nationality: get('nationality') || 'Tunisienne',
        locale,
        officeId,
      })
      n++
    })
    toast(t('import.done', { n }))
    onClose()
  }

  const colOptions = Array.from({ length: cols }, (_, i) => i)

  return (
    <Modal
      title={t('import.title')}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={valid.length === 0} onClick={run}>
            {t('import.confirm', { n: valid.length })}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        {!rows ? (
          <div className="import__drop">
            <p className="t-secondary">{t('import.hint')}</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
            />
            <Button icon="plus" onClick={() => fileRef.current?.click()}>{t('import.pick')}</Button>
          </div>
        ) : (
          <>
            <div className="grid grid--2">
              {FIELDS.map((f) => (
                <Field key={f} label={t(`import.field.${f}` as 'import.field.firstName')}>
                  <Select
                    value={String(map[f])}
                    onChange={(e) => setMap((m) => ({ ...m, [f]: Number(e.target.value) }))}
                  >
                    <option value="-1">{t('import.ignore')}</option>
                    {colOptions.map((i) => (
                      <option key={i} value={i}>
                        {headerRow?.[i]?.trim() || t('import.col', { n: i + 1 })}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>

            <label className="row gap-2" style={{ alignItems: 'center' }}>
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              <span className="t-small t-secondary">{t('import.hasHeader')}</span>
            </label>

            <div>
              <p className="t-caption t-tertiary" style={{ marginBottom: 6 }}>
                {t('import.preview', { valid: valid.length, total: body.length })}
              </p>
              <div className="tablewrap" style={{ maxHeight: 220, overflow: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      {FIELDS.filter((f) => map[f] >= 0).map((f) => (
                        <th key={f}>{t(`import.field.${f}` as 'import.field.firstName')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {body.slice(0, 12).map((r, ri) => (
                      <tr key={ri}>
                        {FIELDS.filter((f) => map[f] >= 0).map((f) => (
                          <td key={f}>{(r[map[f]] ?? '').trim() || '·'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
