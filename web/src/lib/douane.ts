/**
 * La cascade fiscale douanière tunisienne.
 *
 * Elle existe deux fois : ici, et dans `customs_compute()` côté base. Ce n'est
 * pas un oubli. L'interface doit recalculer à chaque frappe pendant que l'agent
 * saisit ses taux, et un aller-retour réseau par touche rendrait l'écran
 * inutilisable. La base, elle, reste l'autorité pour tout ce qui se calcule
 * sans navigateur : rapports, portail, fonctions de bord.
 *
 * Les deux versions sont tenues alignées par les mêmes vecteurs de test, avec
 * les mêmes valeurs calculées à la main. Si l'une dérive, le banc le dit.
 *
 * Base légale : articles 22 à 35 du code des douanes (loi 2008-34).
 */

import type { CustomsArticle, CustomsDeclaration } from '@/data/types'

/** Ce qui S'AJOUTE à la valeur transactionnelle. Liste limitative, article 30. */
export const ADDITIONS_ART30 = [
  'commissions_vente',
  'contenants_emballages',
  'apports_materiels',
  'apports_intellectuels_hors_tn',
  'redevances_licences',
  'produit_revente',
  'transport_assurance_jusqu_introduction',
] as const

/** Ce qui SE RETRANCHE. Liste limitative, article 31. */
export const DEDUCTIONS_ART31 = [
  'transport_assurance_apres_import',
  'montage_assistance',
  'droits_reproduction',
  'commissions_achat',
  'droits_taxes_tn',
  'cout_donnees_logiciel',
] as const

/* Le calcul ne réclame que ce dont il se sert. Une déclaration enregistrée en
   base convient, un brouillon à l'écran aussi : c'est la même fonction. */
export type CustomsDeclarationCalc =
  Pick<CustomsDeclaration, 'fxRate' | 'vatRegistered' | 'airApplicable'>
export type CustomsArticleCalc = Pick<CustomsArticle,
  | 'lineNo' | 'ndp' | 'designation' | 'originCountry' | 'preferentialCode'
  | 'invoiceValue' | 'ccecTitle' | 'additions' | 'deductions'
  | 'ddRate' | 'dcRate' | 'fodecRate' | 'tvaRate' | 'taxes0xx' | 'taxesSector'>

export type CustomsAlert =
  | { line: number; code: 'deduction_non_facturee_distinctement'; refused: number }
  | { line: number; code: 'taux_manquant'; dd: boolean; tva: boolean }
  | { line: number; code: 'autorisation_importation_requise' }
  | { line: number; code: 'preferentiel_interdit'; origin: string }

export type CustomsLine = {
  line: number
  ndp?: string
  designation: string
  origin?: string
  invoiceValue: number
  additions: number
  deductionsKept: number
  deductionsRefused: number
  vdCurrency: number
  vdCaf: number
  dd: number
  dc: number
  fodec: number
  taxes0xx: number
  taxesSector: number
  baseTva: number
  uplifted: boolean
  tva: number
  lineDuties: number
}

export type CustomsResult = {
  articles: number
  lines: CustomsLine[]
  vdCafTotal: number
  dutiesSum: number
  rpd: number
  rpdFloor: number
  rpdAtFloor: boolean
  totalDuties: number
  air: number
  totalPayable: number
  alerts: CustomsAlert[]
}

/** Les constantes officielles, celles-là documentées et stables. */
export const RPD_RATE = 0.03
export const RPD_MIN_PER_ARTICLE = 10
export const AIR_RATE = 0.1
export const NON_ASSUJETTI_UPLIFT = 1.25

/** Arrondi à trois décimales, moitié à l'écart de zéro, comme le numeric SQL. */
function r3(x: number): number {
  const s = x < 0 ? -1 : 1
  return (s * Math.round(Math.abs(x) * 1000)) / 1000
}

const sum = (xs: { amount: number }[]) => xs.reduce((t, x) => t + (Number(x.amount) || 0), 0)

/**
 * Les pays qui ouvrent droit à un régime tarifaire préférentiel.
 * LA CHINE N'Y EST PAS : une marchandise chinoise est au NPF plein. Son
 * certificat d'origine reste exigé au dossier (case 32), mais il ne donne
 * aucun avantage tarifaire. Confondre les deux fait réclamer un taux auquel on
 * n'a pas droit, et le redressement suit.
 */
const PREFERENTIAL = new Set([
  // Accords bilatéraux nommément listés par la douane tunisienne.
  'MA', 'JO', 'EG', 'LY', 'KW', 'DZ', 'MR', 'PS', 'SY', 'SD', 'IR',
  // Zone Pan-Euro-Méditerranéenne : Union européenne, AELE, Turquie.
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO',
  'SE', 'SI', 'SK', 'CH', 'NO', 'IS', 'LI', 'TR',
  // Grande Zone Arabe de Libre Échange, membres non déjà cités.
  'SA', 'AE', 'QA', 'BH', 'OM', 'IQ', 'YE', 'LB',
])

export function originPreferentialAllowed(country?: string): boolean {
  return !!country && PREFERENTIAL.has(country.toUpperCase())
}

/** Les codes 404 et 971 de la case 42/2 n'ont de sens que sur une origine préférentielle. */
export function preferentialCodeAllowed(country?: string, code?: string): boolean {
  if (!code) return true
  if (code !== '404' && code !== '971') return true
  return originPreferentialAllowed(country)
}

/** La NDP de la case 39 : 6 SH + 2 NC + 1 national + 1 NGP, plus une clé. */
export function ndpValid(ndp?: string): boolean {
  return !ndp || /^[0-9]{10}[0-9A-Za-z]?$/.test(ndp)
}

/**
 * La cascade complète. Trois pièges, marqués dans le code parce que ce sont
 * exactement les trois endroits où un calcul « de bon sens » se trompe.
 */
export function customsCompute(
  decl: CustomsDeclarationCalc,
  articles: CustomsArticleCalc[],
): CustomsResult {
  const alerts: CustomsAlert[] = []
  const lines: CustomsLine[] = []
  let vdCafTotal = 0
  let dutiesSum = 0

  for (const a of articles) {
    const add = sum(a.additions ?? [])
    // Article 31 : ne se retranche QUE ce qui est facturé distinctement.
    const kept = sum((a.deductions ?? []).filter((d) => d.invoicedSeparately))
    const refused = sum((a.deductions ?? []).filter((d) => !d.invoicedSeparately))
    if (refused > 0) {
      alerts.push({ line: a.lineNo, code: 'deduction_non_facturee_distinctement', refused })
    }
    if (a.ddRate == null || a.tvaRate == null) {
      alerts.push({ line: a.lineNo, code: 'taux_manquant', dd: a.ddRate == null, tva: a.tvaRate == null })
    }
    if (a.ccecTitle === 'P') {
      alerts.push({ line: a.lineNo, code: 'autorisation_importation_requise' })
    }
    if (!preferentialCodeAllowed(a.originCountry, a.preferentialCode)) {
      alerts.push({ line: a.lineNo, code: 'preferentiel_interdit', origin: a.originCountry ?? '' })
    }

    const vdCurrency = a.invoiceValue + add - kept
    // Article 33 : conversion au taux du jour d'enregistrement de la déclaration.
    const vdCaf = r3(vdCurrency * decl.fxRate)

    const dd = r3((vdCaf * (a.ddRate ?? 0)) / 100)
    const dc = r3((vdCaf * (a.dcRate ?? 0)) / 100)
    const fodec = r3((vdCaf * (a.fodecRate ?? 0)) / 100)
    const t0 = sum(a.taxes0xx ?? [])
    const ts = sum(a.taxesSector ?? [])

    // PIÈGE 1 · le droit de consommation entre dans l'assiette de la TVA.
    let baseTva = vdCaf + dd + dc + fodec + t0
    // PIÈGE 2 · le non-assujetti subit la majoration de 25 % (lettre M).
    if (!decl.vatRegistered) baseTva = baseTva * NON_ASSUJETTI_UPLIFT
    const tva = r3((baseTva * (a.tvaRate ?? 0)) / 100)

    const lineDuties = dd + dc + fodec + tva + ts
    vdCafTotal += vdCaf
    dutiesSum += lineDuties

    lines.push({
      line: a.lineNo, ndp: a.ndp, designation: a.designation, origin: a.originCountry,
      invoiceValue: a.invoiceValue, additions: add,
      deductionsKept: kept, deductionsRefused: refused,
      vdCurrency: r3(vdCurrency), vdCaf,
      dd, dc, fodec, taxes0xx: t0, taxesSector: ts,
      baseTva: r3(baseTva), uplifted: !decl.vatRegistered, tva,
      lineDuties: r3(lineDuties),
    })
  }

  if (articles.length === 0) {
    return {
      articles: 0, lines: [], vdCafTotal: 0, dutiesSum: 0,
      rpd: 0, rpdFloor: 0, rpdAtFloor: false,
      totalDuties: 0, air: 0, totalPayable: 0, alerts,
    }
  }

  // PIÈGE 3 · le plancher de RPD est de 10 DT PAR ARTICLE, pas par déclaration.
  const rpdFloor = RPD_MIN_PER_ARTICLE * articles.length
  const rpdPct = r3(dutiesSum * RPD_RATE)
  const rpd = Math.max(rpdPct, rpdFloor)
  const totalDuties = dutiesSum + rpd
  const air = decl.airApplicable ? r3((vdCafTotal + totalDuties) * AIR_RATE) : 0

  return {
    articles: articles.length,
    lines,
    vdCafTotal: r3(vdCafTotal),
    dutiesSum: r3(dutiesSum),
    rpd,
    rpdFloor,
    rpdAtFloor: rpd === rpdFloor && rpdFloor > rpdPct,
    totalDuties: r3(totalDuties),
    air,
    totalPayable: r3(totalDuties + air),
    alerts,
  }
}

// ------------------------------------------------------------------
// Les délais durs, et le titre de commerce extérieur
// ------------------------------------------------------------------

const DAY_MS = 86400000
const asDay = (iso: string) => {
  const d = new Date(iso)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)
}
const dayIso = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10)

export type CustomsDeadline = { due: string; daysLeft: number; overdue: boolean }

/**
 * Les deux délais qui coûtent cher.
 *
 * La déclaration sommaire est due à UN JOUR FRANC après l'arrivée, dimanches et
 * jours fériés non comptés. Les fériés tunisiens ne sont pas en base : on écarte
 * les dimanches et on le dit, plutôt que de promettre une exactitude qu'on n'a
 * pas. Le séjour en magasin ou aire de dédouanement est plafonné à quinze jours.
 */
export function customsDeadlines(
  arrivedAt?: string,
  goodsRemovedAt?: string,
): { arrival: string; summary: CustomsDeadline; storage: CustomsDeadline } | null {
  if (!arrivedAt) return null
  const arrival = asDay(arrivedAt)
  const now = asDay(new Date().toISOString())

  let summaryDue = arrival + 1
  // Dimanche = 0. Un jour franc ne se compte pas un dimanche.
  while (new Date(summaryDue * DAY_MS).getUTCDay() === 0) summaryDue += 1

  const storageDue = arrival + 15
  return {
    arrival: dayIso(arrival),
    summary: { due: dayIso(summaryDue), daysLeft: summaryDue - now, overdue: now > summaryDue },
    storage: {
      due: dayIso(storageDue),
      daysLeft: storageDue - now,
      overdue: now > storageDue && !goodsRemovedAt,
    },
  }
}

export type TceCheck = {
  needed: boolean
  reasons: ('designation_modifiee' | 'prix_en_hausse' | 'quantite_en_hausse')[]
  amountPct: number
  quantityPct: number
}

/**
 * Le titre de commerce extérieur doit être MODIFIÉ si la désignation change, ou
 * si le prix ou la quantité augmente de plus de 10 %. Seule la hausse compte :
 * une baisse n'appelle rien. Se tromper ici bloque le virement au fournisseur,
 * car la loi interdit la sortie de devises sans documents conformes.
 */
export function tceNeedsAmendment(
  title: { designation?: string; amount?: number; quantity?: number },
  next: { designation?: string; amount?: number; quantity?: number },
): TceCheck {
  const reasons: TceCheck['reasons'] = []
  if (next.designation && title.designation && next.designation !== title.designation) {
    reasons.push('designation_modifiee')
  }
  const pct = (before?: number, after?: number) =>
    before && before > 0 && after != null ? ((after - before) / before) * 100 : 0
  const amountPct = pct(title.amount, next.amount)
  const quantityPct = pct(title.quantity, next.quantity)
  if (amountPct > 10) reasons.push('prix_en_hausse')
  if (quantityPct > 10) reasons.push('quantite_en_hausse')
  return {
    needed: reasons.length > 0,
    reasons,
    amountPct: Math.round(amountPct * 100) / 100,
    quantityPct: Math.round(quantityPct * 100) / 100,
  }
}
