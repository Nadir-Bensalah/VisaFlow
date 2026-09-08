/* Lire un tableau, quel que soit le fichier qu'on nous tend.
 *
 * Le lecteur CSV vient de `ClientImport.tsx`, où il servait aux seuls clients.
 * Il est repris tel quel, sans rien changer à son comportement : il a déjà
 * tourné sur de vrais exports Excel tunisiens, point-virgule et guillemets
 * compris. On ne réécrit pas un analyseur qui marche, on le sort de son écran.
 *
 * S'y ajoute la lecture du .xlsx, et il faut dire comment. Un .xlsx est une
 * archive ZIP de fichiers XML. Le décompresser demande l'algorithme « deflate »,
 * qu'aucun navigateur n'expose... sauf par `DecompressionStream`, arrivé dans
 * Chrome 103, Safari 16.4 et Firefox 113. On s'en sert. Aucune bibliothèque,
 * aucun CDN, et le fichier est vraiment lu, pas deviné.
 *
 * CE QUI NE MARCHE PAS, ET QU'IL FAUT DIRE :
 * · sur un navigateur plus ancien, `XLSX_SUPPORTED` est faux et l'écran demande
 *   un CSV. Il ne fait pas semblant.
 * · le .xls d'avant 2007 (binaire, pas ZIP) n'est pas lu. Il n'a pas de rapport
 *   avec le .xlsx malgré le nom.
 * · seule la PREMIÈRE feuille du classeur est lue. Un fichier à plusieurs
 *   onglets n'importe que le premier, et l'écran l'annonce.
 * · les formules ne sont pas calculées : on lit la valeur mise en cache par
 *   Excel, qui est là dans un fichier enregistré normalement.
 */

export type Row = string[]

/** Enlève accents et casse. Sert à comparer des en-têtes écrits à la main. */
export function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

/* ------------------------------------------------------------------ */
/* Le CSV                                                              */
/* ------------------------------------------------------------------ */

/**
 * Un lecteur CSV minimal mais correct : séparateur deviné (';' ou ','), champs
 * entre guillemets, guillemets doublés à l'intérieur, fins de ligne mêlées.
 * Repris mot pour mot de l'import de clients.
 */
export function parseCsv(text: string): Row[] {
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

/**
 * L'écriture. Le point-virgule est le séparateur par défaut : c'est celui
 * qu'Excel attend sur un poste français ou tunisien. Avec la virgule, un
 * fichier ouvert d'un double-clic arrive tout entier dans la colonne A.
 */
export function toCsv(rows: (string | number | null | undefined)[][], delim = ';'): string {
  const cell = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    // Un champ qui contient le séparateur, un guillemet ou un saut de ligne se
    // met entre guillemets, et ses guillemets se doublent.
    return /["\n\r]|[;,\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(cell).join(delim)).join('\r\n')
}

/**
 * Devine à quelle colonne du fichier correspond chaque champ, d'après
 * l'en-tête. Rend -1 quand rien ne correspond : l'utilisateur choisira.
 */
export function guessMapping<K extends string>(
  header: string[],
  hints: Record<K, string[]>,
): Record<K, number> {
  const cleaned = header.map(norm)
  const out = {} as Record<K, number>
  const taken = new Set<number>()
  for (const key of Object.keys(hints) as K[]) {
    const found = cleaned.findIndex(
      (h, i) => !taken.has(i) && h !== '' && hints[key].some((hint) => h.includes(norm(hint))),
    )
    out[key] = found
    if (found >= 0) taken.add(found)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Le .xlsx : un ZIP de XML                                            */
/* ------------------------------------------------------------------ */

/** Vrai quand le navigateur sait décompresser. Faux : l'écran demande un CSV. */
export const XLSX_SUPPORTED =
  typeof globalThis !== 'undefined' && typeof (globalThis as { DecompressionStream?: unknown }).DecompressionStream === 'function'

interface ZipEntry { name: string; method: number; offset: number; size: number }

function u16(v: DataView, at: number) { return v.getUint16(at, true) }
function u32(v: DataView, at: number) { return v.getUint32(at, true) }

/** Le catalogue central du ZIP, lu depuis la fin comme le veut le format. */
function zipEntries(buf: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buf)
  // La fin de catalogue porte un commentaire de longueur libre : on remonte.
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= 0 && i > buf.byteLength - 66000; i--) {
    if (u32(view, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('archive illisible')
  const count = u16(view, eocd + 10)
  let at = u32(view, eocd + 16)
  const out: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (u32(view, at) !== 0x02014b50) break
    const nameLen = u16(view, at + 28)
    const extraLen = u16(view, at + 30)
    const commentLen = u16(view, at + 32)
    out.push({
      name: new TextDecoder().decode(new Uint8Array(buf, at + 46, nameLen)),
      method: u16(view, at + 10),
      size: u32(view, at + 24),
      offset: u32(view, at + 42),
    })
    at += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function zipRead(buf: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buf)
  // L'en-tête local redonne les longueurs de nom et d'extra, qui diffèrent
  // souvent de celles du catalogue. Les confondre décale tout le fichier.
  const local = entry.offset
  const start = local + 30 + u16(view, local + 26) + u16(view, local + 28)
  const raw = new Uint8Array(buf, start, buf.byteLength - start)
  if (entry.method === 0) {
    return new TextDecoder().decode(raw.subarray(0, entry.size))
  }
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const out = new Uint8Array(await new Response(stream).arrayBuffer())
  return new TextDecoder().decode(out.subarray(0, entry.size))
}

/** « BC » vaut 55 : la colonne se lit en base 26 sur les lettres. */
function colIndex(ref: string): number {
  let n = 0
  for (const ch of ref) {
    const c = ch.charCodeAt(0)
    if (c < 65 || c > 90) break
    n = n * 26 + (c - 64)
  }
  return n - 1
}

/** Le jour zéro d'Excel est le 30 décembre 1899 : le tableur croit 1900 bissextile. */
function serialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return String(serial)
  return d.toISOString().slice(0, 10)
}

function tagAll(xml: string, tag: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<${tag}\\b[^>]*(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(m[1] ?? '')
  return out
}

function unescapeXml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

/**
 * Les formats de date, pour ne pas rendre « 45678 » là où le fichier dit
 * « 12/03/2025 ». Sans ça, une date de naissance importée est un nombre, et
 * personne ne s'en aperçoit avant le guichet du consulat.
 */
function dateStyles(stylesXml: string): Set<number> {
  const builtinDates = new Set([14, 15, 16, 17, 22, 45, 46, 47])
  const custom = new Set<number>()
  const reFmt = /<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = reFmt.exec(stylesXml)) !== null) {
    const code = unescapeXml(m[2])
    // Un format qui parle de jours, de mois ou d'années est une date. Le « m »
    // seul peut être des minutes : on l'accepte quand même s'il y a un j ou un a.
    if (/[dy]/i.test(code) && !/^[#0.,%\s]*$/.test(code)) custom.add(Number(m[1]))
  }
  const out = new Set<number>()
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? ''
  const reXf = /<xf\b[^>]*>/g
  let index = 0
  let x: RegExpExecArray | null
  while ((x = reXf.exec(cellXfs)) !== null) {
    const id = Number(/numFmtId="(\d+)"/.exec(x[0])?.[1] ?? '0')
    if (builtinDates.has(id) || custom.has(id)) out.add(index)
    index++
  }
  return out
}

/** Rend la première feuille du classeur, en lignes de chaînes. */
export async function readXlsx(buf: ArrayBuffer): Promise<Row[]> {
  if (!XLSX_SUPPORTED) throw new Error('xlsx_non_supporte')
  const entries = zipEntries(buf)
  const sheetEntry = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))[0]
  if (!sheetEntry) throw new Error('aucune feuille')

  const sharedEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml')
  const shared = sharedEntry
    ? tagAll(await zipRead(buf, sharedEntry), 'si').map(unescapeXml)
    : []

  const stylesEntry = entries.find((e) => e.name === 'xl/styles.xml')
  const dates = stylesEntry ? dateStyles(await zipRead(buf, stylesEntry)) : new Set<number>()

  const sheet = await zipRead(buf, sheetEntry)
  const rows: Row[] = []
  const reRow = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let r: RegExpExecArray | null
  while ((r = reRow.exec(sheet)) !== null) {
    const cells: Row = []
    const reCell = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g
    let c: RegExpExecArray | null
    while ((c = reCell.exec(r[1])) !== null) {
      const attrs = c[1]
      const body = c[2] ?? ''
      const ref = /r="([A-Z]+)/.exec(attrs)?.[1]
      const index = ref ? colIndex(ref) : cells.length
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n'
      const style = Number(/s="(\d+)"/.exec(attrs)?.[1] ?? '-1')
      let value = ''
      if (type === 's') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''
        value = shared[Number(v)] ?? ''
      } else if (type === 'inlineStr') {
        value = unescapeXml(body)
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''
        value = unescapeXml(v)
        if (value !== '' && dates.has(style) && Number.isFinite(Number(value))) {
          value = serialToIso(Number(value))
        }
      }
      while (cells.length < index) cells.push('')
      cells[index] = value
    }
    rows.push(cells)
  }
  return rows.filter((row) => row.some((cell) => cell.trim() !== ''))
}

export type TableSource = 'csv' | 'xlsx'

/** Le point d'entrée de l'import : on prend le fichier, on rend des lignes. */
export async function readTable(file: File): Promise<{ rows: Row[]; source: TableSource }> {
  const isXlsx = /\.xlsx$/i.test(file.name)
    || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (isXlsx) return { rows: await readXlsx(await file.arrayBuffer()), source: 'xlsx' }
  if (/\.xls$/i.test(file.name)) throw new Error('xls_ancien')
  return { rows: parseCsv(await file.text()), source: 'csv' }
}
