/* Sortir un tableau de l'application, sans jamais sortir du périmètre.
 *
 * LA RÈGLE DE CE FICHIER, ET C'EST LA SEULE QUI COMPTE : il ne fait AUCUNE
 * requête. Il reçoit les lignes que l'écran affiche déjà, donc des lignes qui
 * sont passées par `useVisible()` côté navigateur et par les politiques de
 * sécurité côté serveur. Un agent de Sfax exporte ce qu'un agent de Sfax voit,
 * parce que c'est littéralement le tableau qu'il a sous les yeux.
 *
 * Construire l'export depuis une requête à part serait le trou classique : la
 * liste filtre, l'export ne filtre pas, et personne ne s'en aperçoit avant que
 * le fichier circule. D'où l'absence volontaire d'import de `supabase` ici.
 *
 * Deux formats sortent d'ici :
 * · le CSV, point-virgule, avec la marque d'ordre d'octets. Sans elle, Excel
 *   sur Windows lit « Ben Salah » mais écrit « Ben SalÃ¢h » dès qu'il y a un
 *   accent, et l'arabe devient illisible.
 * · le .xlsx, écrit à la main. Un .xlsx est une archive ZIP de fichiers XML :
 *   on écrit le ZIP en mode « rangé » (sans compression), ce qui est un ZIP
 *   parfaitement valable. Le fichier pèse plus lourd qu'un vrai classeur
 *   compressé, et c'est le prix de zéro dépendance. Excel, Numbers et
 *   LibreOffice l'ouvrent.
 */

import { toCsv } from './csv'

export interface Column<T> {
  /** La clé, pour se souvenir de quoi il s'agit. */
  key: string
  /** L'intitulé imprimé en première ligne, déjà traduit par l'écran. */
  label: string
  /** Ce qu'on écrit dans la case. Par défaut, la propriété qui porte la clé. */
  value?: (row: T) => string | number | null | undefined
}

export type ExportFormat = 'csv' | 'xlsx'

function matrix<T>(rows: T[], columns: Column<T>[]): (string | number | null)[][] {
  const head = columns.map((c) => c.label)
  const body = rows.map((row) =>
    columns.map((c) => {
      const raw = c.value ? c.value(row) : (row as Record<string, unknown>)[c.key]
      if (raw === null || raw === undefined) return ''
      if (typeof raw === 'number' || typeof raw === 'string') return raw
      if (raw instanceof Date) return raw.toISOString().slice(0, 10)
      if (typeof raw === 'boolean') return raw ? 'oui' : 'non'
      return String(raw)
    }),
  )
  return [head, ...body]
}

/** Le nom du fichier : le sujet, la date, jamais d'espace ni d'accent. */
export function fileName(base: string, format: ExportFormat): string {
  const day = new Date().toISOString().slice(0, 10)
  const clean = base
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${(clean || 'export').toLowerCase()}-${day}.${format}`
}

/** Le geste du téléchargement, isolé pour n'exister qu'une fois. */
export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Sans révocation, le blob reste en mémoire tant que l'onglet vit.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function csvBlob<T>(rows: T[], columns: Column<T>[]): Blob {
  // '﻿' : la marque d'ordre d'octets. C'est elle qui dit à Excel « ce
  // fichier est en UTF-8 ». Sans elle, tout accent et tout mot arabe casse.
  return new Blob(['﻿' + toCsv(matrix(rows, columns))], {
    type: 'text/csv;charset=utf-8',
  })
}

/* ------------------------------------------------------------------ */
/* Le .xlsx écrit à la main                                            */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Les caractères de contrôle sont interdits en XML 1.0. Une cellule qui en
    // contient rendrait le classeur illisible, et Excel ne dirait pas pourquoi.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function colName(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rest = (n - 1) % 26
    out = String.fromCharCode(65 + rest) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function sheetXml(data: (string | number | null)[][]): string {
  const rows = data.map((row, r) => {
    const cells = row.map((value, c) => {
      const ref = `${colName(c)}${r + 1}`
      if (typeof value === 'number' && Number.isFinite(value)) {
        return `<c r="${ref}"><v>${value}</v></c>`
      }
      const text = value === null || value === undefined ? '' : String(value)
      if (text === '') return `<c r="${ref}"/>`
      // Chaîne « en ligne » plutôt qu'une table partagée : un fichier de plus
      // à tenir cohérent, c'est un fichier de plus à se tromper.
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`
    }).join('')
    return `<row r="${r + 1}">${cells}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetData>${rows}</sheetData></worksheet>`
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
  + `<Default Extension="xml" ContentType="application/xml"/>`
  + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
  + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  + `</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
  + `</Relationships>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
  + `</Relationships>`

function workbookXml(sheetName: string): string {
  // Excel refuse un nom de feuille de plus de 31 signes, ou qui porte : \ / ? * [ ]
  const safe = xmlEscape(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Feuille1')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`
    + ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheets><sheet name="${safe}" sheetId="1" r:id="rId1"/></sheets></workbook>`
}

/** Un ZIP « rangé » : pas de compression, mais un ZIP valable. */
function zip(files: { name: string; text: string }[]): Blob {
  const encoder = new TextEncoder()
  // Typage explicite sur ArrayBuffer : sans lui, TypeScript 5.7 refuse un
  // Uint8Array<ArrayBufferLike> là où Blob attend un tampon non partagé.
  const parts: Uint8Array<ArrayBuffer>[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0

  const put = (view: DataView, at: number, value: number) => view.setUint32(at, value >>> 0, true)

  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const body = encoder.encode(file.text)
    const crc = crc32(body)

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    put(lv, 0, 0x04034b50)
    lv.setUint16(4, 20, true)          // version minimale
    lv.setUint16(6, 0x0800, true)      // drapeau : les noms sont en UTF-8
    lv.setUint16(8, 0, true)           // méthode 0 : rangé, non compressé
    put(lv, 14, crc)
    put(lv, 18, body.length)
    put(lv, 22, body.length)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    parts.push(local, body)

    const entry = new Uint8Array(46 + nameBytes.length)
    const ev = new DataView(entry.buffer)
    put(ev, 0, 0x02014b50)
    ev.setUint16(4, 20, true)
    ev.setUint16(6, 20, true)
    ev.setUint16(8, 0x0800, true)
    ev.setUint16(10, 0, true)
    put(ev, 16, crc)
    put(ev, 20, body.length)
    put(ev, 24, body.length)
    ev.setUint16(28, nameBytes.length, true)
    put(ev, 42, offset)
    entry.set(nameBytes, 46)
    central.push(entry)

    offset += local.length + body.length
  }

  const centralSize = central.reduce((n, e) => n + e.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  put(endView, 0, 0x06054b50)
  endView.setUint16(8, files.length, true)
  endView.setUint16(10, files.length, true)
  put(endView, 12, centralSize)
  put(endView, 16, offset)

  return new Blob([...parts, ...central, end], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function xlsxBlob<T>(rows: T[], columns: Column<T>[], sheetName = 'Export'): Blob {
  return zip([
    { name: '[Content_Types].xml', text: CONTENT_TYPES },
    { name: '_rels/.rels', text: ROOT_RELS },
    { name: 'xl/workbook.xml', text: workbookXml(sheetName) },
    { name: 'xl/_rels/workbook.xml.rels', text: WORKBOOK_RELS },
    { name: 'xl/worksheets/sheet1.xml', text: sheetXml(matrix(rows, columns)) },
  ])
}

/**
 * Le seul point de sortie. `scope` décrit ce qui sort (« clients », « dossiers »)
 * et sert à la trace : un export non tracé est un incident invisible.
 */
export function exportRows<T>(
  rows: T[],
  columns: Column<T>[],
  options: { format: ExportFormat; base: string; sheetName?: string },
): { name: string; bytes: number } {
  const blob = options.format === 'xlsx'
    ? xlsxBlob(rows, columns, options.sheetName ?? options.base)
    : csvBlob(rows, columns)
  const name = fileName(options.base, options.format)
  downloadBlob(name, blob)
  return { name, bytes: blob.size }
}
