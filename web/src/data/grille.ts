import type { BillingPeriod, PlanCode, PublicPlan } from './abonnements'

/* LE CALCUL DE LA GRILLE, une fois, pour tous les écrans.
 *
 * La page publique, la console et la carte du plan estiment le même prix
 * avec la même formule (section 5.7 de la décision du 9 septembre 2026) :
 *
 *   bureaux_en_plus = max(0, bureaux − max_offices)
 *   comptes_inclus  = max_users + bureaux_en_plus × office_included_users
 *   comptes_en_plus = max(0, comptes − comptes_inclus)
 *   active          = socle + bureaux_en_plus × bureau + comptes_en_plus × compte
 *
 * Premium est conseillé dès qu'Active coûte au moins autant que lui. Au-delà
 * de l'usage raisonnable de Premium (60 comptes, 15 bureaux), c'est un devis.
 *
 * RIEN ici n'est un prix : tout vient des lignes `public_plans`. Une formule
 * écrite avec des constantes serait fausse au premier changement de grille,
 * et fausse sans prévenir, puisque le typecheck ne lit pas les tarifs.
 */

/** La nature d'une ligne. Le libellé, lui, est une clé de traduction côté écran. */
export type LigneCode = 'socle' | 'bureau' | 'compte' | 'premium'

export interface LigneEstimation {
  label: LigneCode
  quantite: number
  unitaire: number
  total: number
}

export interface FormuleEstimee {
  conseille: 'active' | 'premium'
  mensuel: number
  annuel: number
  lignes: LigneEstimation[]
}

export interface Estimation {
  /** `devis` : au-delà de l'usage raisonnable de Premium. Les montants sont alors ceux de Premium, à titre indicatif. */
  conseille: 'active' | 'premium' | 'devis'
  devise: string
  mensuel: number
  annuel: number
  lignes: LigneEstimation[]
  /** Premium, montré sous Active comme alternative. Absent quand Premium est déjà conseillé. */
  alternative?: FormuleEstimee
  /** Ce qu'Active coûterait quand Premium est conseillé : c'est l'argument de vente. */
  activeMensuel: number | null
  /** Le nombre de comptes à partir duquel Premium devient moins cher, pour ce nombre de bureaux. Null si jamais. */
  bascule: number | null
}

const arrondi = (n: number) => Math.round(n * 1000) / 1000

export const planParCode = (plans: PublicPlan[], code: PlanCode): PublicPlan | undefined =>
  plans.find((p) => p.code === code)

/** Le mensuel d'Active pour tant de comptes et de bureaux, décomposé en lignes. */
export function mensuelActive(active: PublicPlan, comptes: number, bureaux: number): FormuleEstimee & {
  bureauxEnPlus: number; comptesEnPlus: number; comptesInclus: number
} {
  const socle = active.base_price_month
  const prixBureau = active.extra_office_price_month ?? 0
  const prixCompte = active.extra_user_price_month ?? 0
  const bureauxInclus = active.max_offices ?? 1
  const bureauxEnPlus = Math.max(0, bureaux - bureauxInclus)
  const comptesInclus = (active.max_users ?? 0) + bureauxEnPlus * active.office_included_users
  const comptesEnPlus = Math.max(0, comptes - comptesInclus)
  const lignes: LigneEstimation[] = [{ label: 'socle', quantite: 1, unitaire: socle, total: socle }]
  if (bureauxEnPlus > 0) lignes.push({ label: 'bureau', quantite: bureauxEnPlus, unitaire: prixBureau, total: arrondi(bureauxEnPlus * prixBureau) })
  if (comptesEnPlus > 0) lignes.push({ label: 'compte', quantite: comptesEnPlus, unitaire: prixCompte, total: arrondi(comptesEnPlus * prixCompte) })
  const mensuel = arrondi(lignes.reduce((s, l) => s + l.total, 0))
  return { conseille: 'active', mensuel, annuel: arrondi(mensuel * 12), lignes, bureauxEnPlus, comptesEnPlus, comptesInclus }
}

function formulePremium(premium: PublicPlan): FormuleEstimee {
  const m = premium.base_price_month
  return { conseille: 'premium', mensuel: m, annuel: arrondi(m * 12), lignes: [{ label: 'premium', quantite: 1, unitaire: m, total: m }] }
}

/**
 * Le point de bascule : à partir de combien de comptes, pour ce nombre de
 * bureaux, Premium coûte moins cher qu'Active. Null quand Active reste
 * toujours sous Premium (ce qui n'arrive pas avec la grille actuelle, mais
 * la grille peut changer). Zéro veut dire « dès le socle » : trop de bureaux.
 */
export function bascule(plans: PublicPlan[], bureaux: number): number | null {
  const active = planParCode(plans, 'active')
  const premium = planParCode(plans, 'premium')
  if (!active || !premium) return null
  const base = mensuelActive(active, 0, bureaux)
  if (base.mensuel >= premium.base_price_month) return 0
  const prixCompte = active.extra_user_price_month ?? 0
  if (prixCompte <= 0) return null
  // Le premier compte en plus qui fait passer Active au niveau de Premium.
  const enPlus = Math.ceil((premium.base_price_month - base.mensuel) / prixCompte)
  return base.comptesInclus + enPlus
}

/**
 * L'estimation de la section 5.7. Rend null tant que la grille n'est pas
 * chargée : l'écran affiche alors « · », jamais un chiffre inventé.
 */
export function estimer(plans: PublicPlan[], comptes: number, bureaux: number): Estimation | null {
  const active = planParCode(plans, 'active')
  const premium = planParCode(plans, 'premium')
  if (!active || !premium) return null
  const n = Math.max(0, Math.floor(comptes))
  const b = Math.max(1, Math.floor(bureaux))
  const a = mensuelActive(active, n, b)
  const p = formulePremium(premium)
  const devise = active.currency
  const point = bascule(plans, b)

  const horsUsage = (premium.fair_use_users !== null && n > premium.fair_use_users)
    || (premium.fair_use_offices !== null && b > premium.fair_use_offices)
  if (horsUsage) {
    return { conseille: 'devis', devise, mensuel: p.mensuel, annuel: p.annuel, lignes: p.lignes, activeMensuel: a.mensuel, bascule: point }
  }
  if (a.mensuel >= p.mensuel) {
    return { conseille: 'premium', devise, mensuel: p.mensuel, annuel: p.annuel, lignes: p.lignes, activeMensuel: a.mensuel, bascule: point }
  }
  return { conseille: 'active', devise, mensuel: a.mensuel, annuel: a.annuel, lignes: a.lignes, alternative: p, activeMensuel: null, bascule: point }
}

/* ------------------------------------------------------------------ */
/* Le montant d'une souscription (sections 5.3 et 5.4)                  */
/* ------------------------------------------------------------------ */

export interface MontantSouscription {
  /** Socle + ajouts, aux prix figés. Zéro pour l'essai. */
  mensuel: number
  /** Ce que vaut la période avant remise : × 12, ou × 6 × facteur au semestre. */
  brut: number
  /** Après remise, si elle court encore. */
  montant: number
  /** Le facteur appliqué au semestre, pour l'afficher. 1 sinon. */
  facteur: number
  mois: number
  remiseAppliquee: boolean
  lignes: LigneEstimation[]
}

/**
 * Le montant d'une souscription posée à la main : la formule, les ajouts
 * signés, la période et la remise. C'est ce que la modale « Modifier » montre
 * sous les doigts avant d'enregistrer, et ce que la base recalcule ensuite
 * avec les mêmes règles. Si les deux divergent, c'est la base qui a raison.
 */
export function montantSouscription(input: {
  plan: PublicPlan
  extraUsers: number
  extraOffices: number
  periode: BillingPeriod
  remisePct?: number | null
  remiseJusquau?: string | null
  aujourdhui?: string
}): MontantSouscription {
  const { plan } = input
  const extraUsers = Math.max(0, Math.floor(input.extraUsers || 0))
  const extraOffices = Math.max(0, Math.floor(input.extraOffices || 0))
  let lignes: LigneEstimation[] = []
  if (plan.code === 'premium') {
    lignes = formulePremium(plan).lignes
  } else if (plan.code === 'active') {
    lignes = [{ label: 'socle', quantite: 1, unitaire: plan.base_price_month, total: plan.base_price_month }]
    const prixBureau = plan.extra_office_price_month ?? 0
    const prixCompte = plan.extra_user_price_month ?? 0
    if (extraOffices > 0) lignes.push({ label: 'bureau', quantite: extraOffices, unitaire: prixBureau, total: arrondi(extraOffices * prixBureau) })
    if (extraUsers > 0) lignes.push({ label: 'compte', quantite: extraUsers, unitaire: prixCompte, total: arrondi(extraUsers * prixCompte) })
  }
  const mensuel = arrondi(lignes.reduce((s, l) => s + l.total, 0))
  const semestre = input.periode === 'semestriel'
  const facteur = semestre ? plan.semester_factor : 1
  const mois = input.periode === 'annuel' ? 12 : semestre ? 6 : 1
  // Le semestre s'arrondit au dinar : c'est la règle écrite sur le devis.
  const brut = semestre ? Math.round(mensuel * 6 * facteur) : arrondi(mensuel * mois)
  const pct = Math.max(0, Math.min(100, Number(input.remisePct ?? 0)))
  const jour = input.aujourdhui ?? new Date().toISOString().slice(0, 10)
  const remiseAppliquee = pct > 0 && (!input.remiseJusquau || input.remiseJusquau >= jour)
  const montant = remiseAppliquee ? arrondi(brut * (1 - pct / 100)) : brut
  return { mensuel, brut, montant, facteur, mois, remiseAppliquee, lignes }
}

/** Les comptes qu'une souscription autorise : socle + bureaux × inclus + achetés. Null = illimité. */
export function comptesAutorises(plan: PublicPlan, extraUsers: number, extraOffices: number): number | null {
  if (plan.max_users === null) return null
  return plan.max_users + Math.max(0, extraOffices) * plan.office_included_users + Math.max(0, extraUsers)
}

/** Les bureaux qu'une souscription autorise. Null = illimité. */
export function bureauxAutorises(plan: PublicPlan, extraOffices: number): number | null {
  if (plan.max_offices === null) return null
  return plan.max_offices + Math.max(0, extraOffices)
}
