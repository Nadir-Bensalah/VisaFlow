/* La fabrication des documents imprimables.
 *
 * ==================================================================
 * LA DÉCISION D'ARCHITECTURE, ET SON MOTIF
 * ==================================================================
 *
 * Deux chemins étaient possibles. Une bibliothèque PDF chargée depuis un CDN,
 * qui écrit le fichier dans le navigateur. Ou une fonction de bord, qui rend
 * le même fichier partout. On prend un troisième chemin, et voici pourquoi.
 *
 * CE QUI TRANCHE : L'ARABE.
 * Une facture pour une agence libyenne s'imprime en arabe, de droite à gauche.
 * Or l'arabe ne se pose pas lettre par lettre : chaque lettre change de forme
 * selon ses voisines (« ب » s'écrit ﺏ ﺑ ﺒ ﺐ selon sa place), et l'ordre des
 * mots suit l'algorithme bidirectionnel d'Unicode dès qu'un chiffre ou un mot
 * latin s'y glisse. Aucune bibliothèque PDF en JavaScript ne fait ce travail :
 * ni jsPDF, ni pdfmake, ni pdf-lib. Elles posent les glyphes isolés, dans le
 * mauvais ordre, ou des carrés si la police n'est pas embarquée. Une facture
 * arabe produite comme ça est illisible, et ce n'est pas rattrapable après.
 *
 * Le moteur d'un navigateur, lui, embarque HarfBuzz et l'algorithme bidi. Il
 * fait ce travail depuis vingt ans. Alors on lui donne le travail : on compose
 * une page HTML complète, on la lui remet, et « Enregistrer en PDF » de la
 * boîte d'impression produit un PDF correct, en arabe comme en français.
 *
 * LE SECOND MOTIF : PAS DE SERVEUR.
 * Le site de démonstration est servi par GitHub Pages. Une fonction de bord y
 * serait injoignable. Et Deno n'a de toute façon pas de moteur PDF confortable :
 * la solution habituelle là-bas est de lancer un navigateur sans interface,
 * c'est-à-dire exactement ce qu'on fait ici, mais sur une machine de plus.
 *
 * CE QU'ON PAIE, ET QU'IL FAUT DIRE :
 * · le rendu dépend du poste. Une police absente, un pilote d'impression aux
 *   marges généreuses, et deux agences n'ont pas exactement la même page. On
 *   limite les dégâts : marges fixées en millimètres par `@page`, piles de
 *   polices avec repli explicite, aucune image externe.
 * · le fichier n'est pas produit en silence. L'employé passe par la boîte
 *   d'impression et choisit « Enregistrer en PDF ». On ne peut donc pas
 *   déposer l'octet du PDF dans un seau : la trace garde l'EMPREINTE de ce qui
 *   a été composé (`sha256`), ce qui suffit à répondre à « est-ce le même
 *   document que la semaine dernière ? », la seule question comptable.
 * · le document s'imprime dans la langue du CLIENT, pas dans celle de
 *   l'employé. Les intitulés vivent donc ici, dans les quatre langues, et pas
 *   dans le dictionnaire de l'interface.
 *
 * Ce fichier ne touche ni au DOM de l'application, ni au réseau : `buildHtml`
 * est une fonction pure, ce qui la rend vérifiable hors du navigateur.
 */

export type DocumentKind =
  | 'devis' | 'facture' | 'recu' | 'checklist' | 'bon_livraison'
  | 'fiche_client' | 'fiche_dossier' | 'cargaison' | 'rapport'

export type DocLocale = 'fr' | 'en' | 'ar' | 'zh'

/** Ce que rend `document_payload`. Volontairement souple : les modules 0045 à
    0052 s'écrivent en parallèle et ajouteront des champs. */
export interface DocumentPayload {
  kind: DocumentKind
  entity_kind: string
  entity_id: string | null
  number: string | null
  locale: DocLocale
  generated_at: string
  agency: Record<string, unknown> | null
  office: Record<string, unknown> | null
  client: Record<string, unknown> | null
  template: Record<string, unknown> | null
  meta: Record<string, unknown>
  lines: Record<string, unknown>[]
  totals: Record<string, unknown>
  extra: Record<string, unknown>
  legal: Record<string, unknown>
}

/* ------------------------------------------------------------------ */
/* Les intitulés du document, dans les quatre langues                  */
/* ------------------------------------------------------------------ */

type LabelKey =
  | 'devis' | 'facture' | 'recu' | 'checklist' | 'bon_livraison'
  | 'fiche_client' | 'fiche_dossier' | 'cargaison' | 'rapport'
  | 'number' | 'date' | 'client' | 'office' | 'designation' | 'qty'
  | 'unitPrice' | 'tax' | 'lineTotal' | 'subtotal' | 'taxTotal'
  | 'discount' | 'total' | 'paid' | 'balance' | 'piece' | 'state'
  | 'required' | 'optional' | 'signature' | 'stamp' | 'noTaxId'
  | 'page' | 'reference' | 'status' | 'nothing'

const LABELS: Record<DocLocale, Record<LabelKey, string>> = {
  fr: {
    devis: 'Devis', facture: 'Facture', recu: 'Reçu',
    checklist: 'Liste des pièces', bon_livraison: 'Bon de livraison',
    fiche_client: 'Fiche client', fiche_dossier: 'Fiche dossier',
    cargaison: 'Récapitulatif de cargaison', rapport: 'Rapport d’agence',
    number: 'Numéro', date: 'Date', client: 'Client', office: 'Bureau',
    designation: 'Désignation', qty: 'Qté', unitPrice: 'Prix unitaire',
    tax: 'TVA', lineTotal: 'Total', subtotal: 'Total hors taxe',
    taxTotal: 'TVA', discount: 'Remise', total: 'Total à payer',
    paid: 'Déjà réglé', balance: 'Reste dû', piece: 'Pièce', state: 'État',
    required: 'Obligatoire', optional: 'Facultative',
    signature: 'Signature du client', stamp: 'Cachet de l’agence',
    noTaxId: 'Matricule fiscal manquant : cette facture sera refusée.',
    page: 'Page', reference: 'Référence', status: 'Statut',
    nothing: 'Aucune ligne.',
  },
  en: {
    devis: 'Quotation', facture: 'Invoice', recu: 'Receipt',
    checklist: 'Document checklist', bon_livraison: 'Delivery note',
    fiche_client: 'Client record', fiche_dossier: 'Case record',
    cargaison: 'Shipment summary', rapport: 'Agency report',
    number: 'Number', date: 'Date', client: 'Client', office: 'Office',
    designation: 'Description', qty: 'Qty', unitPrice: 'Unit price',
    tax: 'VAT', lineTotal: 'Total', subtotal: 'Subtotal',
    taxTotal: 'VAT', discount: 'Discount', total: 'Total due',
    paid: 'Already paid', balance: 'Balance', piece: 'Document', state: 'State',
    required: 'Required', optional: 'Optional',
    signature: 'Client signature', stamp: 'Agency stamp',
    noTaxId: 'Tax identification number missing: this invoice will be refused.',
    page: 'Page', reference: 'Reference', status: 'Status',
    nothing: 'No lines.',
  },
  ar: {
    devis: 'عرض سعر', facture: 'فاتورة', recu: 'وصل',
    checklist: 'قائمة الوثائق', bon_livraison: 'وصل تسليم',
    fiche_client: 'بطاقة الحريف', fiche_dossier: 'بطاقة الملف',
    cargaison: 'ملخص الشحنة', rapport: 'تقرير الوكالة',
    number: 'الرقم', date: 'التاريخ', client: 'الحريف', office: 'المكتب',
    designation: 'البيان', qty: 'الكمية', unitPrice: 'سعر الوحدة',
    tax: 'الأداء', lineTotal: 'المجموع', subtotal: 'المجموع دون أداء',
    taxTotal: 'الأداء على القيمة المضافة', discount: 'تخفيض',
    total: 'المبلغ الجملي', paid: 'خالص', balance: 'الباقي',
    piece: 'الوثيقة', state: 'الحالة', required: 'إجبارية', optional: 'اختيارية',
    signature: 'إمضاء الحريف', stamp: 'ختم الوكالة',
    noTaxId: 'المعرف الجبائي غير موجود: سترفض هذه الفاتورة.',
    page: 'صفحة', reference: 'المرجع', status: 'الحالة',
    nothing: 'لا توجد أسطر.',
  },
  zh: {
    devis: '报价单', facture: '发票', recu: '收据',
    checklist: '材料清单', bon_livraison: '送货单',
    fiche_client: '客户档案', fiche_dossier: '案卷档案',
    cargaison: '货运摘要', rapport: '机构报告',
    number: '编号', date: '日期', client: '客户', office: '办事处',
    designation: '名称', qty: '数量', unitPrice: '单价',
    tax: '增值税', lineTotal: '合计', subtotal: '不含税合计',
    taxTotal: '增值税', discount: '折扣', total: '应付合计',
    paid: '已付', balance: '余额', piece: '材料', state: '状态',
    required: '必需', optional: '可选',
    signature: '客户签字', stamp: '机构盖章',
    noTaxId: '缺少税务登记号：此发票将被拒收。',
    page: '页', reference: '编号', status: '状态',
    nothing: '无明细。',
  },
}

/**
 * Les blocs annexes et leurs colonnes. Sans cette table, une facture imprimait
 * « payments / AT / AMOUNT / RECEIPT NO » en anglais au milieu d'un document
 * français. Ce qui n'est pas traduit garde son nom brut : c'est moins joli,
 * mais ça ne raconte pas d'histoire.
 */
const EXTRA: Record<string, Record<DocLocale, string>> = {
  payments: { fr: 'Règlements', en: 'Payments', ar: 'الخلاصات', zh: '付款记录' },
  containers: { fr: 'Conteneurs', en: 'Containers', ar: 'الحاويات', zh: '集装箱' },
  contacts: { fr: 'Contacts', en: 'Contacts', ar: 'جهات الاتصال', zh: '联系人' },
  stays: { fr: 'Séjours Schengen', en: 'Schengen stays', ar: 'الإقامات', zh: '申根停留' },
  notes: { fr: 'Notes', en: 'Notes', ar: 'ملاحظات', zh: '备注' },
  appointment: { fr: 'Rendez-vous', en: 'Appointment', ar: 'الموعد', zh: '预约' },
}

const COLUMNS: Record<string, Record<DocLocale, string>> = {
  at: { fr: 'Date', en: 'Date', ar: 'التاريخ', zh: '日期' },
  amount: { fr: 'Montant', en: 'Amount', ar: 'المبلغ', zh: '金额' },
  method: { fr: 'Mode', en: 'Method', ar: 'طريقة الخلاص', zh: '方式' },
  receipt_no: { fr: 'Reçu', en: 'Receipt', ar: 'الوصل', zh: '收据' },
  kind: { fr: 'Nature', en: 'Kind', ar: 'النوع', zh: '类别' },
  state: { fr: 'État', en: 'State', ar: 'الحالة', zh: '状态' },
  status: { fr: 'Statut', en: 'Status', ar: 'الحالة', zh: '状态' },
  reference: { fr: 'Référence', en: 'Reference', ar: 'المرجع', zh: '编号' },
  description: { fr: 'Désignation', en: 'Description', ar: 'البيان', zh: '名称' },
  quantity: { fr: 'Quantité', en: 'Quantity', ar: 'الكمية', zh: '数量' },
  unit: { fr: 'Unité', en: 'Unit', ar: 'الوحدة', zh: '单位' },
  currency: { fr: 'Devise', en: 'Currency', ar: 'العملة', zh: '币种' },
  name: { fr: 'Nom', en: 'Name', ar: 'الاسم', zh: '姓名' },
  phone: { fr: 'Téléphone', en: 'Phone', ar: 'الهاتف', zh: '电话' },
  email: { fr: 'Courriel', en: 'Email', ar: 'البريد', zh: '邮箱' },
  relationship: { fr: 'Lien', en: 'Relationship', ar: 'الصلة', zh: '关系' },
  container_number: { fr: 'Conteneur', en: 'Container', ar: 'الحاوية', zh: '箱号' },
  container_type: { fr: 'Type', en: 'Type', ar: 'النوع', zh: '类型' },
  seal_number: { fr: 'Plomb', en: 'Seal', ar: 'الرصاصة', zh: '铅封' },
  gross_weight_kg: { fr: 'Poids brut (kg)', en: 'Gross weight (kg)', ar: 'الوزن الخام (كغ)', zh: '毛重（公斤）' },
  net_weight_kg: { fr: 'Poids net (kg)', en: 'Net weight (kg)', ar: 'الوزن الصافي (كغ)', zh: '净重（公斤）' },
  volume_cbm: { fr: 'Volume (m3)', en: 'Volume (cbm)', ar: 'الحجم (م3)', zh: '体积（立方米）' },
  hs_code: { fr: 'Position tarifaire', en: 'HS code', ar: 'البند التعريفي', zh: '海关编码' },
  origin_country: { fr: 'Origine', en: 'Origin', ar: 'المنشأ', zh: '原产地' },
  total_value: { fr: 'Valeur', en: 'Value', ar: 'القيمة', zh: '价值' },
  entry: { fr: 'Entrée', en: 'Entry', ar: 'الدخول', zh: '入境' },
  exit: { fr: 'Sortie', en: 'Exit', ar: 'الخروج', zh: '出境' },
  country: { fr: 'Pays', en: 'Country', ar: 'البلد', zh: '国家' },
  text: { fr: 'Note', en: 'Note', ar: 'ملاحظة', zh: '备注' },
  location: { fr: 'Lieu', en: 'Place', ar: 'المكان', zh: '地点' },
}

/** Le nom brut si on ne sait pas traduire : on ne cache pas la colonne. */
function columnLabel(key: string, locale: DocLocale): string {
  return COLUMNS[key]?.[locale] ?? key.replace(/_/g, ' ')
}

/* ------------------------------------------------------------------ */
/* Les outils de mise en forme                                         */
/* ------------------------------------------------------------------ */

function esc(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const BCP47: Record<DocLocale, string> = {
  fr: 'fr-FR', en: 'en-GB', ar: 'ar-TN', zh: 'zh-CN',
}

function money(value: unknown, currency: string, locale: DocLocale): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  try {
    return new Intl.NumberFormat(BCP47[locale], {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 3,
    }).format(n)
  } catch {
    // Une devise inconnue d'Intl (le dinar libyen sur un poste ancien) ne doit
    // pas faire sauter l'impression : on écrit le nombre et le code.
    return `${n.toFixed(2)} ${currency}`
  }
}

function day(value: unknown, locale: DocLocale): string {
  if (!value) return ''
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return String(value)
  return new Intl.DateTimeFormat(BCP47[locale], {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d)
}

/** Un champ i18n stocké en base ({fr,en,ar,zh}) ou une chaîne simple. */
function text(value: unknown, locale: DocLocale): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    const bag = value as Record<string, unknown>
    const found = bag[locale] ?? bag.fr ?? Object.values(bag)[0]
    return found === undefined ? '' : String(found)
  }
  return String(value)
}

function fullName(client: Record<string, unknown> | null, locale: DocLocale): string {
  if (!client) return ''
  // En arabe, le nom tel qu'il est écrit sur le passeport prime : c'est celui
  // que le consulat compare.
  if (locale === 'ar' && client.native_name) return String(client.native_name)
  return [client.first_name, client.last_name].filter(Boolean).join(' ')
}

/* ------------------------------------------------------------------ */
/* Le squelette du document                                            */
/* ------------------------------------------------------------------ */

/**
 * La feuille de style d'impression. Elle est volontairement courte et sans
 * astuce : chaque règle exotique est une occasion pour un navigateur de rendre
 * autre chose que les autres.
 */
function baseCss(rtl: boolean): string {
  return `
@page { size: A4; margin: 14mm 12mm 16mm 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: ${rtl
    ? `"Noto Naskh Arabic", "Geeza Pro", "Amiri", "Segoe UI", system-ui, sans-serif`
    : `"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif`};
  font-size: 11pt; line-height: 1.45; color: #111;
  direction: ${rtl ? 'rtl' : 'ltr'};
}
h1 { font-size: 18pt; margin: 0 0 2mm; }
h2 { font-size: 12pt; margin: 6mm 0 2mm; }
.doc__head { display: flex; justify-content: space-between; gap: 8mm; align-items: flex-start; border-bottom: 1.5pt solid #111; padding-bottom: 4mm; }
.doc__brand { font-size: 16pt; font-weight: 700; }
.doc__mark { display: inline-block; border: 1.5pt solid #111; padding: 1mm 2.5mm; font-weight: 700; letter-spacing: .5pt; }
.doc__meta { text-align: ${rtl ? 'left' : 'right'}; font-size: 10pt; }
.doc__parties { display: flex; gap: 8mm; margin: 6mm 0; }
.doc__party { flex: 1; }
.doc__party b { display: block; font-size: 9pt; text-transform: uppercase; letter-spacing: .4pt; color: #555; margin-bottom: 1mm; }
table { width: 100%; border-collapse: collapse; margin-top: 3mm; }
th, td { padding: 2mm 2.5mm; border-bottom: .5pt solid #ccc; text-align: ${rtl ? 'right' : 'left'}; vertical-align: top; }
th { background: #f2f2f2; font-size: 9.5pt; text-transform: uppercase; letter-spacing: .3pt; }
td.num, th.num { text-align: ${rtl ? 'left' : 'right'}; font-variant-numeric: tabular-nums; white-space: nowrap; }
.doc__totals { margin-top: 5mm; margin-${rtl ? 'right' : 'left'}: auto; width: 78mm; }
.doc__totals td { border: 0; padding: 1mm 0; }
.doc__totals tr.is-total td { border-top: 1pt solid #111; font-weight: 700; font-size: 12pt; padding-top: 2mm; }
.doc__sign { display: flex; gap: 10mm; margin-top: 14mm; }
.doc__sign div { flex: 1; border-top: .5pt solid #999; padding-top: 2mm; font-size: 9pt; color: #555; min-height: 22mm; }
.doc__legal { margin-top: 8mm; padding-top: 3mm; border-top: .5pt solid #ccc; font-size: 8.5pt; color: #444; }
.doc__alert { margin: 4mm 0; padding: 2.5mm 3mm; border: 1pt solid #b00; color: #b00; font-weight: 600; font-size: 9.5pt; }
.doc__note { font-size: 9.5pt; color: #444; margin-top: 4mm; white-space: pre-wrap; }
tr { break-inside: avoid; }
@media print { .doc__alert { border-color: #000; color: #000; } }
`.trim()
}

function headerBlock(p: DocumentPayload, L: Record<LabelKey, string>, locale: DocLocale): string {
  const a = p.agency ?? {}
  const tpl = p.template ?? {}
  // L'en-tête du modèle remplace le bloc de série quand l'agence en a posé un.
  if (tpl.header_html) return `<div class="doc__customhead">${String(tpl.header_html)}</div>`
  const contact = [a.phone, a.email, a.website].filter(Boolean).map(esc).join(' · ')
  return `
<div class="doc__head">
  <div>
    <div class="doc__brand"><span class="doc__mark">${esc(a.mark ?? 'VF')}</span> ${esc(a.name)}</div>
    ${a.legal_name ? `<div>${esc(a.legal_name)}</div>` : ''}
    ${contact ? `<div>${contact}</div>` : ''}
  </div>
  <div class="doc__meta">
    <h1>${esc(L[p.kind])}</h1>
    ${p.number ? `<div>${esc(L.number)} : <b>${esc(p.number)}</b></div>` : ''}
    <div>${esc(L.date)} : ${esc(day(p.generated_at, locale))}</div>
    ${p.office ? `<div>${esc(L.office)} : ${esc((p.office as Record<string, unknown>).name)}</div>` : ''}
  </div>
</div>`.trim()
}

function partiesBlock(p: DocumentPayload, L: Record<LabelKey, string>, locale: DocLocale): string {
  if (!p.client) return ''
  const c = p.client
  const lines = [
    fullName(c, locale),
    c.address, c.phone, c.email,
    c.passport_number ? `${esc(c.passport_number)}` : '',
  ].filter(Boolean).map(esc).join('<br>')
  return `<div class="doc__parties"><div class="doc__party" dir="auto"><b>${esc(L.client)}</b>${lines}</div></div>`
}

/** Le tableau des lignes d'argent : devis, facture, reçu. */
function moneyTable(p: DocumentPayload, L: Record<LabelKey, string>, locale: DocLocale, currency: string): string {
  if (p.lines.length === 0) return `<p class="doc__note">${esc(L.nothing)}</p>`
  const rows = p.lines.map((l) => `
<tr>
  <td dir="auto">${esc(text(l.description ?? l.service, locale))}</td>
  <td class="num">${esc(l.quantity ?? '')}</td>
  <td class="num">${esc(money(l.unit_price, currency, locale))}</td>
  <td class="num">${l.tax_rate ? `${esc(l.tax_rate)} %` : ''}</td>
  <td class="num">${esc(money(l.line_total, currency, locale))}</td>
</tr>`).join('')
  return `
<table>
  <thead><tr>
    <th>${esc(L.designation)}</th><th class="num">${esc(L.qty)}</th>
    <th class="num">${esc(L.unitPrice)}</th><th class="num">${esc(L.tax)}</th>
    <th class="num">${esc(L.lineTotal)}</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`.trim()
}

function totalsBlock(p: DocumentPayload, L: Record<LabelKey, string>, locale: DocLocale, currency: string): string {
  const t = p.totals
  const line = (label: string, value: unknown, cls = '') =>
    value === undefined || value === null ? ''
      : `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${esc(money(value, currency, locale))}</td></tr>`
  const body = [
    line(L.subtotal, t.subtotal),
    Number(t.discount) > 0 ? line(L.discount, t.discount) : '',
    Number(t.tax_total) > 0 ? line(L.taxTotal, t.tax_total) : '',
    line(L.total, t.total, 'is-total'),
    Number(t.paid) > 0 ? line(L.paid, t.paid) : '',
    t.balance !== undefined && Number(t.balance) !== Number(t.total) ? line(L.balance, t.balance) : '',
  ].filter(Boolean).join('')
  if (!body) return ''
  return `<table class="doc__totals"><tbody>${body}</tbody></table>`
}

/** Le tableau des pièces : checklist et fiche dossier. */
function piecesTable(p: DocumentPayload, L: Record<LabelKey, string>, locale: DocLocale): string {
  if (p.lines.length === 0) return `<p class="doc__note">${esc(L.nothing)}</p>`
  const rows = p.lines.map((l) => `
<tr>
  <td>${esc(text(l.label ?? l.key, locale))}${l.help ? `<br><span style="color:#666;font-size:9pt">${esc(text(l.help, locale))}</span>` : ''}</td>
  <td>${l.required ? esc(L.required) : esc(L.optional)}</td>
  <td>${esc(String(l.state ?? '').replace(/_/g, ' '))}</td>
</tr>`).join('')
  return `
<table>
  <thead><tr><th>${esc(L.piece)}</th><th></th><th>${esc(L.state)}</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`.trim()
}

/** Le tableau générique : une ligne par objet, les clés en colonnes. */
function plainTable(lines: Record<string, unknown>[], locale: DocLocale, empty: string): string {
  if (lines.length === 0) return `<p class="doc__note">${esc(empty)}</p>`
  // Les clés vides pour toutes les lignes ne font pas une colonne : une facture
  // avec six colonnes blanches est plus difficile à lire qu'une avec trois.
  const keys = Object.keys(lines[0]).filter(
    (k) => lines.some((l) => l[k] !== null && l[k] !== undefined && l[k] !== ''),
  )
  const head = keys.map((k) => `<th>${esc(columnLabel(k, locale))}</th>`).join('')
  const rows = lines.map((l) =>
    // dir="auto" : une adresse en latin dans un document arabe se lit dans son
    // propre sens, sans que la ponctuation saute à l'autre bout de la ligne.
    `<tr>${keys.map((k) => `<td dir="auto">${esc(text(l[k], locale))}</td>`).join('')}</tr>`).join('')
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
}

function metaList(meta: Record<string, unknown>, locale: DocLocale): string {
  const rows = Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object')
    .map(([k, v]) => `<tr><td style="width:45mm;color:#555">${esc(columnLabel(k, locale))}</td><td dir="auto">${esc(text(v, locale))}</td></tr>`)
    .join('')
  return rows ? `<table><tbody>${rows}</tbody></table>` : ''
}

/**
 * Compose le document. Fonction PURE : mêmes entrées, même sortie, aucun accès
 * au DOM ni au réseau. C'est ce qui permet de la vérifier hors navigateur.
 */
export function buildHtml(p: DocumentPayload, opts?: { locale?: DocLocale }): string {
  const locale: DocLocale = opts?.locale ?? p.locale ?? 'fr'
  const rtl = locale === 'ar'
  const L = LABELS[locale] ?? LABELS.fr
  const tpl = p.template ?? {}
  const currency = String(
    p.meta.currency ?? (p.agency as Record<string, unknown> | null)?.currency ?? 'TND',
  ).trim()

  let body = ''
  if (p.kind === 'devis' || p.kind === 'facture' || p.kind === 'recu') {
    body = partiesBlock(p, L, locale)
      + moneyTable(p, L, locale, currency)
      + totalsBlock(p, L, locale, currency)
      + (p.meta.note ? `<p class="doc__note" dir="auto">${esc(p.meta.note)}</p>` : '')
  } else if (p.kind === 'checklist' || p.kind === 'fiche_dossier') {
    body = partiesBlock(p, L, locale)
      + `<h2>${esc(L.reference)} ${esc(p.number ?? '')}</h2>`
      + metaList(p.meta, locale)
      + `<h2>${esc(L.piece)}</h2>`
      + piecesTable(p, L, locale)
      + (p.kind === 'fiche_dossier' ? totalsBlock(p, L, locale, currency) : '')
  } else if (p.kind === 'fiche_client') {
    body = partiesBlock(p, L, locale)
      + metaList(p.meta, locale)
      + `<h2>${esc(L.fiche_dossier)}</h2>`
      + plainTable(p.lines, locale, L.nothing)
  } else {
    // Cargaison, bon de livraison, rapport : un bloc de propriétés, puis les
    // lignes telles qu'elles viennent. On n'invente pas de colonnes.
    body = partiesBlock(p, L, locale)
      + metaList(p.meta, locale)
      + plainTable(p.lines, locale, L.nothing)
  }

  // Les conteneurs, les règlements, les contacts : ce que le serveur a mis en
  // « extra » et qui mérite un tableau.
  for (const [key, value] of Object.entries(p.extra ?? {})) {
    if (Array.isArray(value) && value.length > 0) {
      const title = EXTRA[key]?.[locale] ?? key.replace(/_/g, ' ')
      body += `<h2>${esc(title)}</h2>` + plainTable(value as Record<string, unknown>[], locale, L.nothing)
    }
  }

  const legal = p.legal ?? {}
  const alert = p.kind === 'facture' && legal.missing_tax_id === true
    ? `<div class="doc__alert">${esc(L.noTaxId)}</div>` : ''

  // Les mentions de l'agence font foi quand elle en a écrit. On n'ajoute le
  // matricule et le RC que si elle n'a rien saisi : sinon la facture les
  // imprimait deux fois, ce qui donne l'air d'un document bricolé.
  const mentions = legal.mentions ? String(legal.mentions).trim() : ''
  const legalLines = mentions
    ? esc(mentions)
    : [
        legal.tax_id ? `MF : ${legal.tax_id}` : '',
        legal.rc_number ? `RC : ${legal.rc_number}` : '',
      ].filter(Boolean).map((x) => esc(x)).join(' · ')

  const signatures = p.kind === 'bon_livraison' || p.kind === 'recu' || tpl.show_stamp
    ? `<div class="doc__sign"><div>${esc(L.signature)}</div><div>${esc(L.stamp)}</div></div>` : ''

  const footer = tpl.footer_html ? String(tpl.footer_html) : ''

  return `<!doctype html>
<html lang="${locale}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<title>${esc(L[p.kind])}${p.number ? ` ${esc(p.number)}` : ''}</title>
<style>${baseCss(rtl)}
${tpl.css ? String(tpl.css) : ''}</style>
</head>
<body>
${headerBlock(p, L, locale)}
${alert}
${body}
${signatures}
<div class="doc__legal">${legalLines}${footer}</div>
</body>
</html>`
}

/* ------------------------------------------------------------------ */
/* L'empreinte et l'impression                                         */
/* ------------------------------------------------------------------ */

/**
 * L'empreinte du document composé. C'est elle qui répond à « la facture
 * réimprimée le mois suivant portait-elle le même montant ? ».
 * Rend null si le navigateur n'expose pas la cryptographie (page servie en
 * http simple) : on préfère une trace sans empreinte à pas de trace du tout.
 */
export async function sha256Hex(input: string): Promise<string | null> {
  try {
    const bytes = new TextEncoder().encode(input)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

/**
 * Remet la page au moteur d'impression du navigateur.
 *
 * On passe par un cadre isolé plutôt qu'une fenêtre : une fenêtre ouverte par
 * un script est bloquée par défaut sur beaucoup de postes, et l'employé ne voit
 * alors rien du tout. Le cadre, lui, s'ouvre toujours.
 */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    // Le document imprimé est composé ici, mais il vit dans son propre cadre :
    // le HTML du modèle d'une agence n'entre jamais dans le DOM de l'application.
    frame.srcdoc = html
    frame.onload = () => {
      const win = frame.contentWindow
      if (!win) { frame.remove(); resolve(); return }
      // Sur Safari, imprimer dans la foulée du chargement rend une page vide :
      // un tour de boucle laisse le temps à la mise en page de se poser.
      window.setTimeout(() => {
        try { win.focus(); win.print() } catch { /* la boîte a été refusée */ }
        // Le cadre reste le temps de la boîte d'impression, sinon Chrome
        // annule l'aperçu au moment où on l'enlève.
        window.setTimeout(() => { frame.remove(); resolve() }, 1500)
      }, 60)
    }
    document.body.appendChild(frame)
  })
}
