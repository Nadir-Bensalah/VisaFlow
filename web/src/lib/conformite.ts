/**
 * La conformité tunisienne, celle qui porte des amendes chiffrées.
 *
 * Ces règles doivent être dites AVANT le geste, pas dans un rapport après coup :
 * l'agente qui accepte 6 000 DT en liquide au comptoir doit le savoir pendant
 * qu'elle tend la main, pas au contrôle fiscal. D'où une copie ici, à côté de
 * l'écran, alignée sur le SQL par les mêmes vecteurs de test.
 */

/** Article 83 ter du code des droits et procédures fiscaux. */
export const CASH_THRESHOLD = 5000
export const CASH_PENALTY_PCT = 20
export const CASH_PENALTY_MIN = 2000

export type CashCheck =
  | { applies: false; reason: 'devise_etrangere' }
  | { applies: true; over: false; alreadyCash: number; totalCash: number; headroom: number }
  | {
      applies: true; over: true
      alreadyCash: number; totalCash: number
      /** L'amende encourue : 20 % du total encaissé en liquide, plancher 2 000 DT. */
      penalty: number
      /** Ce qu'on peut encore prendre en liquide sans franchir le seuil. */
      cashMax: number
      /** Ce qui doit passer par virement ou chèque. */
      transferMin: number
    }

/**
 * Ce que coûterait un encaissement en espèces, avant de l'accepter.
 *
 * Le seuil s'apprécie sur l'OPÉRATION, pas sur le versement : trois versements
 * de 2 000 DT sur le même dossier font 6 000 DT en liquide, et l'amende tombe
 * quand même. On cumule donc ce qui a déjà été encaissé en espèces.
 *
 * Note sur le chiffre : l'étude de marché s'illustre de travers en disant qu'un
 * dossier à 6 000 DT « coûte 1 200 DT ». 20 % de 6 000 font bien 1 200, mais
 * cela passe SOUS le plancher de 2 000 DT. On applique la règle, pas l'exemple.
 */
export function cashCheck(alreadyCash: number, amount: number, currency = 'TND'): CashCheck {
  if (currency !== 'TND') return { applies: false, reason: 'devise_etrangere' }

  const totalCash = (alreadyCash || 0) + (amount || 0)
  if (totalCash < CASH_THRESHOLD) {
    return {
      applies: true, over: false,
      alreadyCash, totalCash,
      headroom: CASH_THRESHOLD - totalCash,
    }
  }

  const penalty = Math.max((totalCash * CASH_PENALTY_PCT) / 100, CASH_PENALTY_MIN)
  // Arrondi au dinar inférieur : on ne joue pas au millime près avec une amende
  // de 2 000 DT, et un montant à trois décimales est illisible au comptoir.
  const cashMax = Math.max(0, Math.floor(CASH_THRESHOLD - alreadyCash - 1))
  return {
    applies: true, over: true,
    alreadyCash, totalCash,
    penalty: Math.round(penalty * 1000) / 1000,
    cashMax,
    transferMin: Math.round((totalCash - cashMax) * 1000) / 1000,
  }
}

export type PromiseReason =
  | 'delai_promis'
  | 'resultat_garanti'
  | 'absence_de_refus_promise'
  | 'remboursement_promis_sans_politique'

/**
 * Cherche une promesse de RÉSULTAT dans un texte destiné au client.
 *
 * Article 13 de la loi 92-117 : la publicité trompeuse porte sur les résultats
 * attendus, et vaut 1 000 à 20 000 DT. Le délai et l'accord appartiennent au
 * consulat, jamais à l'agence : les promettre, c'est vendre ce qu'on ne
 * possède pas. Un « visa en 24 heures » a valu une intervention du commissariat
 * à Sousse en octobre 2025.
 */
export function promiseCheck(text?: string): { clean: boolean; reasons: PromiseReason[] } {
  const t = (text ?? '').toLowerCase()
  const reasons: PromiseReason[] = []

  if (/(visa|accord|réponse|reponse)[^.!?]{0,40}(en|sous|d'ici)\s*[0-9]+\s*(h|heure|jour|semaine)/.test(t)) {
    reasons.push('delai_promis')
  }
  if (/(garanti|garantie|assuré|assure|certain|sûr d'obtenir|100\s*%)/.test(t)) {
    reasons.push('resultat_garanti')
  }
  if (/(sans\s+refus|aucun\s+refus|jamais\s+de\s+refus)/.test(t)) {
    reasons.push('absence_de_refus_promise')
  }
  if (/rembours[eé]\s+si\s+refus/.test(t) && !/selon/.test(t)) {
    reasons.push('remboursement_promis_sans_politique')
  }

  return { clean: reasons.length === 0, reasons }
}

/**
 * Ce que la catégorie de licence autorise. Une agence B ne peut ni organiser de
 * circuit, ni faire de la réception, NI DE L'OMRA. La catégorie C n'existe pas.
 * Sans catégorie déclarée on n'interdit rien : on ne bloque pas une agence
 * parce qu'elle n'a pas fini de remplir son profil, l'écran le lui dit.
 */
export function agencyMay(category: 'A' | 'B' | undefined, activity: string): boolean {
  if (!category || category === 'A') return true
  return !['circuit', 'reception', 'omra'].includes(activity)
}

/** Les mentions sans lesquelles une facture tunisienne n'est pas régulière. */
export const INVOICE_REQUIRED = [
  'taxId', 'rcNumber', 'rcCourt', 'legalForm', 'capital',
] as const

export type ComplianceGap =
  | 'matricule_fiscal' | 'registre_commerce' | 'tribunal' | 'forme_sociale'
  | 'capital' | 'categorie_licence' | 'numero_licence'
  | 'declaration_inpdp' | 'politique_remboursement'

export type AgencyLegal = {
  taxId?: string
  rcNumber?: string
  rcCourt?: string
  legalForm?: string
  capital?: number
  licenseCategory?: 'A' | 'B'
  licenseNumber?: string
  inpdpRef?: string
  refundPolicy?: unknown
  ttnMember?: boolean
  onttChangeAt?: string
  onttFinancialsAt?: string
}

/** Ce qui manque à l'agence pour être en règle, nommé précisément. */
export function complianceGaps(a: AgencyLegal): ComplianceGap[] {
  const gaps: ComplianceGap[] = []
  if (!a.taxId) gaps.push('matricule_fiscal')
  if (!a.rcNumber) gaps.push('registre_commerce')
  if (!a.rcCourt) gaps.push('tribunal')
  if (!a.legalForm) gaps.push('forme_sociale')
  if (a.capital == null) gaps.push('capital')
  if (!a.licenseCategory) gaps.push('categorie_licence')
  if (!a.licenseNumber) gaps.push('numero_licence')
  if (!a.inpdpRef) gaps.push('declaration_inpdp')
  // La politique de remboursement doit être DÉCLARÉE par l'agence. L'éditeur
  // qui en inventerait une par défaut la rendrait opposable à sa place.
  if (a.refundPolicy == null) gaps.push('politique_remboursement')
  return gaps
}

const DAY = 86400000
const addDays = (iso: string, n: number) =>
  new Date(new Date(iso).getTime() + n * DAY).toISOString().slice(0, 10)

/**
 * Les échéances ONTT, article 19 du décret-loi 73-13 : un changement de siège
 * ou de représentant se déclare sous 30 jours, les états financiers sous 3 mois.
 */
export function onttDeadlines(a: AgencyLegal): {
  changeDue?: string; changeLate: boolean
  financialsDue?: string; financialsLate: boolean
} {
  const today = new Date().toISOString().slice(0, 10)
  const changeDue = a.onttChangeAt ? addDays(a.onttChangeAt, 30) : undefined
  const financialsDue = a.onttFinancialsAt ? addDays(a.onttFinancialsAt, 90) : undefined
  return {
    changeDue,
    changeLate: !!changeDue && today > changeDue,
    financialsDue,
    financialsLate: !!financialsDue && today > financialsDue,
  }
}
