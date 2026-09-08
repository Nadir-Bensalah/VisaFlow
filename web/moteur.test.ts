/**
 * Banc croisé des moteurs fret et douane.
 *
 * Les mêmes calculs existent en SQL (`supabase/tests/fret_douane.sql`) et ici.
 * Ce banc rejoue EXACTEMENT les mêmes vecteurs, avec les mêmes valeurs
 * calculées à la main. Si l'une des deux implémentations dérive, l'un des deux
 * bancs tombe. C'est le prix de pouvoir recalculer la douane à chaque frappe
 * sans aller-retour réseau.
 *
 *   npm run moteur
 */

import {
  customsCompute, originPreferentialAllowed, preferentialCodeAllowed, ndpValid,
  type CustomsArticleCalc,
} from './src/lib/douane'
import {
  tierAmount, shipmentCounters, shipmentRoute, routeWarning,
  chargeableUnits, lotQuote, consolidationAdvice, lotSolidarity,
} from './src/lib/fret'
import type { DemurrageTariff, ShipmentLeg } from './src/data/types'

let passed = 0
const failures: string[] = []

function ok(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`OK    ${label}`) }
  else { failures.push(label); console.log(`ECHEC ${label}`) }
}

function iso(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString()
}

console.log('--- 1 · Le trajet en tronçons ---')
const legs: ShipmentLeg[] = [
  { id: 'l1', agencyId: 'a', shipmentId: 's', seq: 1, mode: 'maritime', fromPlace: 'Shanghai', toPlace: 'Malte (Marsaxlokk)', etd: '2026-06-01', eta: '2026-06-28' },
  { id: 'l2', agencyId: 'a', shipmentId: 's', seq: 2, mode: 'maritime', fromPlace: 'Malte (Marsaxlokk)', toPlace: 'Radès', etd: '2026-07-03', eta: '2026-07-06' },
]
const route = shipmentRoute(legs)
ok(route.legsCount === 2, 'le trajet compte deux tronçons')
ok(route.transshipCount === 1, 'un transbordement est compté')
ok(route.legs[0].hubWaitDays === 5, "l'attente au hub est de 5 jours, mesurée séparément")
ok(route.legs[0].days === 27, 'le long-courrier dure 27 jours, distinct de l\'attente')
ok(route.totalDays === 35, 'le trajet total fait 35 jours, pas 27')

const shipCN = { mode: 'maritime_lcl', countryFrom: 'CN', destPort: 'Radès' }
ok(routeWarning(shipCN, []) === 'aucun_troncon', 'sans tronçon, le trajet est signalé')
ok(routeWarning(shipCN, [legs[0]]) === 'transbordement_manquant',
  'un seul tronçon Chine vers Radès est signalé comme impossible')
ok(routeWarning(shipCN, legs) === null, 'avec le transbordement, plus d\'avis')

console.log('--- 2 · Les trois compteurs ---')
ok(tierAmount([{ fromDay: 1, toDay: 3, rate: 45 }, { fromDay: 4, toDay: null, rate: 90 }], 5) === 315,
  'les paliers sont progressifs : 3x45 + 2x90, pas 5x90')
ok(tierAmount([{ fromDay: 1, toDay: 3, rate: 45 }], 0) === 0, 'zéro jour ne facture rien')
ok(tierAmount([{ fromDay: 1, toDay: 3, rate: 45 }, { fromDay: 4, toDay: null, rate: 90 }], 10) === 765,
  'dix jours font 3x45 + 7x90')

const tariffs: DemurrageTariff[] = [
  { id: 't1', agencyId: 'a', kind: 'surestaries', billedBy: 'CMA CGM', port: 'Radès', containerType: '40', freeDays: 5, currency: 'TND', surchargePct: 0, validFrom: '2020-01-01', tiers: [{ fromDay: 1, toDay: 3, rate: 45 }, { fromDay: 4, toDay: null, rate: 90 }] },
  { id: 't2', agencyId: 'a', kind: 'detention', billedBy: 'CMA CGM', port: 'Radès', containerType: '40', freeDays: 3, currency: 'TND', surchargePct: 0, validFrom: '2020-01-01', tiers: [{ fromDay: 1, toDay: null, rate: 60 }] },
  { id: 't3', agencyId: 'a', kind: 'magasinage', billedBy: 'STAM', port: 'Radès', containerType: '40', freeDays: 7, currency: 'TND', surchargePct: 0, validFrom: '2020-01-01', tiers: [{ fromDay: 1, toDay: null, rate: 20 }] },
]
const ship = {
  destPort: 'Radès', mode: 'maritime_lcl', containerType: '40', containersCount: 2,
  carrier: 'CMA CGM', handler: 'STAM',
  dischargedAt: iso(12), gateOutAt: iso(4),
}
const c = shipmentCounters(ship, tariffs)
ok(c[0].kind === 'surestaries' && c[0].elapsedDays === 8,
  'les surestaries s\'arrêtent à la SORTIE du terminal, pas aujourd\'hui')
ok(c[0].overdueDays === 3, 'huit jours moins cinq francs font trois')
ok(c[0].amount === 270, 'surestaries : 3 jours à 45 font 135, x2 conteneurs')
ok(c[0].billedBy === 'CMA CGM', 'les surestaries sont facturées par l\'armateur')
ok(c[1].kind === 'detention' && c[1].elapsedDays === 4, 'la détention part de la sortie du terminal')
ok(c[1].amount === 120, 'détention : 1 jour à 60, pour 2 conteneurs')
ok(c[1].running === true, 'la détention tourne : le conteneur n\'est pas rendu')
ok(c[2].kind === 'magasinage' && c[2].billedBy === 'STAM',
  'le magasinage est facturé par le manutentionnaire, pas par l\'armateur')
ok(c[2].containers === 1,
  'le magasinage porte sur la marchandise : il ne se multiplie pas par les conteneurs')
ok(c[2].amount === 100, 'magasinage : 5 jours à 20')

const cNoTariff = shipmentCounters(ship, [])
ok(cNoTariff[0].status === 'tarif_absent' && cNoTariff[0].amount === undefined,
  'sans barème, on montre l\'horloge mais on ne chiffre pas')

const cLate = shipmentCounters(ship, [{ ...tariffs[0], validFrom: new Date().toISOString().slice(0, 10) }])
ok(cLate[0].outOfPeriod === true && cLate[0].amount === 270,
  'un barème saisi après le départ du compteur chiffre quand même, et le signale')

console.log('--- 3 · La solidarité et la règle W/M ---')
const lots = [
  { id: 'A', clientId: 'c1', blockedReason: 'fret impayé', blockedSince: iso(2) },
  { id: 'B', clientId: 'c2' },
]
const sol = lotSolidarity(undefined, lots)
ok(sol.active && sol.hostages === 1, 'avant dépotage, le lot innocent est otage')
ok(!lotSolidarity(iso(1), lots).active, 'le dépotage éteint la solidarité')
ok(lotSolidarity(iso(1), lots).hostages === 0, 'après dépotage, plus personne n\'est otage')

ok(chargeableUnits(40, 0.2) === 1, 'un carton de 40 kg pour 0,2 CBM se facture 1 unité')
ok(chargeableUnits(3000, 2) === 3, 'le poids l\'emporte quand la marchandise est lourde')
ok(chargeableUnits(500, 4.5) === 4.5, 'le volume l\'emporte quand elle est encombrante')

const big = lotQuote({ weightKg: 1000, volumeCbm: 6 }, 8, { freightRate: 100, strippingTotal: 400, docFee: 80 })
const small = lotQuote({ weightKg: 500, volumeCbm: 2 }, 8, { freightRate: 100, strippingTotal: 400, docFee: 80 })
ok(big.total === 980, 'gros lot : 600 + 300 + 80')
ok(big.lines[1].amount === 300, 'le dépotage se répartit au prorata du CBM')
ok(small.total === 380, 'petit lot : 200 + 100 + 80')
ok(small.costPerUnit > big.costPerUnit,
  'le forfait de documentation rend le petit lot plus cher à l\'unité')
ok(consolidationAdvice(8).advice === 'groupage_pertinent', 'à 8 CBM le groupage a du sens')
ok(consolidationAdvice(16).advice === 'passer_en_fcl', 'au-delà de 15 CBM, comparer un conteneur complet')

console.log('--- 4 · L\'origine ---')
ok(!originPreferentialAllowed('CN'), 'la Chine ne figure dans aucun accord préférentiel')
ok(originPreferentialAllowed('LY'), 'la Libye ouvre droit au préférentiel')
ok(originPreferentialAllowed('MA'), 'le Maroc ouvre droit au préférentiel')
ok(!originPreferentialAllowed('US'), 'les États-Unis, non')
ok(!preferentialCodeAllowed('CN', '404'), 'le code 404 est refusé sur une origine chinoise')
ok(preferentialCodeAllowed('CN', undefined), 'sans code préférentiel, une origine chinoise passe')
ok(ndpValid('8517120010'), 'une NDP de dix chiffres est valable')
ok(!ndpValid('851712'), 'six chiffres ne font pas une NDP')

console.log('--- 5 · La cascade fiscale, et ses trois pièges ---')
// Mêmes vecteurs que le banc SQL, mêmes valeurs calculées à la main.
const art1: CustomsArticleCalc = {
  lineNo: 1, designation: 'Accessoires téléphonie', originCountry: 'CN',
  invoiceValue: 10000,
  additions: [{ code: 'transport_assurance_jusqu_introduction', amount: 1000 }],
  deductions: [{ code: 'commissions_achat', amount: 500, invoicedSeparately: false }],
  ddRate: 20, dcRate: 10, fodecRate: 1, tvaRate: 19,
  taxes0xx: [], taxesSector: [],
}
const r1 = customsCompute({ fxRate: 3.1, vatRegistered: true, airApplicable: false }, [art1])
ok(r1.lines[0].vdCaf === 34100, 'la valeur en douane est convertie au taux du jour d\'enregistrement')
ok(r1.lines[0].deductionsRefused === 500,
  'une déduction non facturée distinctement n\'est PAS retranchée')
ok(r1.lines[0].baseTva === 44671, 'PIÈGE 1 : le droit de consommation entre dans l\'assiette TVA')
ok(r1.lines[0].tva === 8487.49, 'la TVA vaut 8 487,49')
ok(r1.dutiesSum === 19058.49, 'la somme des droits et taxes est juste')
ok(r1.rpd === 571.755, 'la RPD vaut 3 % de la somme')
ok(r1.totalDuties === 19630.245, 'le total liquidé est juste')
ok(r1.alerts.some((a) => a.code === 'deduction_non_facturee_distinctement'),
  'l\'agent est prévenu de la déduction refusée')

const r2 = customsCompute({ fxRate: 3.1, vatRegistered: false, airApplicable: false }, [
  { ...art1, deductions: [] },
])
ok(r2.lines[0].baseTva === 55838.75, 'PIÈGE 2 : le non-assujetti voit son assiette majorée de 25 %')
ok(r2.lines[0].tva === 10609.363, 'sa TVA vaut 10 609,363')
ok(r2.totalDuties === 21815.774, 'son total liquidé est plus lourd de 2 185')

const douze: CustomsArticleCalc[] = Array.from({ length: 12 }, (_, i) => ({
  lineNo: i + 1, designation: `Article ${i + 1}`, invoiceValue: 0,
  additions: [], deductions: [], ddRate: 0, tvaRate: 0, taxes0xx: [], taxesSector: [],
}))
const r3 = customsCompute({ fxRate: 1, vatRegistered: true, airApplicable: false }, douze)
ok(r3.articles === 12, 'la déclaration compte douze articles')
ok(r3.rpd === 120, 'PIÈGE 3 : le plancher de RPD est de 10 DT PAR ARTICLE, soit 120, pas 10')
ok(r3.rpdAtFloor, 'et l\'interface peut dire qu\'on est au plancher')

const r4 = customsCompute({ fxRate: 1, vatRegistered: true, airApplicable: true }, [{
  lineNo: 1, designation: 'Avec commission facturée à part', invoiceValue: 1200,
  additions: [], deductions: [{ code: 'commissions_achat', amount: 200, invoicedSeparately: true }],
  ddRate: 0, tvaRate: 0, taxes0xx: [], taxesSector: [],
}])
ok(r4.lines[0].vdCaf === 1000, 'une déduction facturée distinctement se retranche bien')
ok(r4.rpd === 10, 'un seul article : plancher de 10 DT')
ok(r4.air === 101, 'le code 480 déclenche l\'avance de 10 % sur valeur plus droits')
ok(r4.totalPayable === 111, 'le total à payer inclut l\'avance')

console.log('')
if (failures.length > 0) {
  console.log(`--- ${failures.length} ÉCHEC(S) : ${failures.join(' · ')}`)
  process.exit(1)
}
console.log(`--- banc croisé des moteurs : ${passed} assertions, tout est vert ---`)
