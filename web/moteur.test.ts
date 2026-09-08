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
  customsDeadlines, tceNeedsAmendment,
  type CustomsArticleCalc,
} from './src/lib/douane'
import {
  tierAmount, shipmentCounters, shipmentRoute, routeWarning,
  chargeableUnits, lotQuote, consolidationAdvice, lotSolidarity,
} from './src/lib/fret'
import type { DemurrageTariff, ShipmentLeg } from './src/data/types'

import { schengenState, planStay, type Stay } from './src/lib/schengen'
import {
  cashCheck, promiseCheck, agencyMay, complianceGaps, onttDeadlines,
} from './src/lib/conformite'
import { arNormalize, sameArabicName, matchClient, findDuplicates } from './src/lib/noms'

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

console.log('--- 6 · Les délais durs et le titre de commerce extérieur ---')
// Mêmes vecteurs que le banc SQL : arrivée un samedi, l'échéance saute le dimanche.
const dl = customsDeadlines('2026-09-05T08:00:00+01:00')!
ok(dl.summary.due === '2026-09-07', "arrivée le samedi : l'échéance saute le dimanche et tombe au lundi")
ok(new Date(dl.summary.due).getUTCDay() !== 0, "l'échéance ne tombe jamais un dimanche")
ok(dl.storage.due === '2026-09-20', 'le séjour maximum en magasin est de quinze jours')

const tce = { designation: 'Accessoires téléphonie', amount: 10000, quantity: 500 }
ok(!tceNeedsAmendment(tce, { ...tce, amount: 10500 }).needed,
  "une hausse de 5 % ne demande pas de modification du titre")
ok(tceNeedsAmendment(tce, { ...tce, amount: 11500 }).needed,
  "une hausse de 15 % impose de modifier le titre, sinon le virement est bloqué")
ok(!tceNeedsAmendment(tce, { ...tce, amount: 8000 }).needed,
  "une BAISSE de prix n'impose rien : seule la hausse compte")
ok(tceNeedsAmendment(tce, { ...tce, designation: 'Pièces détachées' }).needed,
  'changer la désignation impose de modifier le titre')
ok(tceNeedsAmendment(tce, { ...tce, quantity: 600 }).needed,
  'une hausse de quantité de 20 % impose aussi la modification')

console.log('--- 7 · Le compteur 90 jours sur 180 ---')
// Toutes les valeurs ci-dessous sont calculées à la main dans les commentaires.
const REF = '2026-09-08'

ok(schengenState([], REF).remaining === 90, 'sans aucun séjour, les 90 jours sont entiers')

// 2026-08-01 au 2026-08-10 : dix jours, entrée ET sortie comprises.
ok(schengenState([{ entry: '2026-08-01', exit: '2026-08-10' }], REF).used === 10,
  'le jour d\'entrée et le jour de sortie comptent tous les deux')
ok(schengenState([{ entry: '2026-08-01', exit: '2026-08-01' }], REF).used === 1,
  'un aller-retour dans la journée compte un jour, pas zéro')

// Deux tampons qui se recouvrent : l'union fait 15 jours, pas 10 + 11.
ok(schengenState([
  { entry: '2026-08-01', exit: '2026-08-10' },
  { entry: '2026-08-05', exit: '2026-08-15' },
], REF).used === 15, 'deux séjours qui se chevauchent ne comptent pas deux fois')

// La fenêtre commence le 2026-03-13. Un séjour du 01/03 au 20/03 n'y entre
// qu'à partir du 13 : huit jours, pas vingt.
ok(schengenState([{ entry: '2026-03-01', exit: '2026-03-20' }], REF).used === 8,
  'la fenêtre glissante coupe ce qui est trop vieux')
ok(schengenState([], REF).windowFrom === '2026-03-13', 'la fenêtre couvre bien 180 jours')

// Soixante jours consommés jusqu'à hier : il reste trente jours d'affilée.
const soixante: Stay[] = [{ entry: '2026-07-10', exit: '2026-09-07' }]
ok(schengenState(soixante, REF).used === 60, 'soixante jours consommés')
const plan = planStay(soixante, '2026-09-08')
ok(plan.maxDays === 30, 'entrer aujourd\'hui permet trente jours, pas un de plus')
ok(plan.blockedOn === '2026-10-08', 'le trente-et-unième jour ferait basculer au-dessus de 90')

// Quatre-vingt-dix jours pleins : bloqué, mais pas pour toujours.
const plein: Stay[] = [{ entry: '2026-06-11', exit: '2026-09-08' }]
ok(schengenState(plein, REF).used === 90, 'quatre-vingt-dix jours pleins')
ok(schengenState(plein, REF).remaining === 0, 'il ne reste rien')
const bloque = planStay(plein, '2026-09-09')
ok(bloque.maxDays === 0, 'il ne peut pas repartir demain')
// Les vieux jours sortent de la fenêtre : le 2026-12-08, un jour se libère.
ok(bloque.earliestEntry === '2026-12-08',
  'on lui donne une date de retour au lieu d\'un refus sec')

// Un client encore à l'intérieur : jusqu'à quand peut-il rester ?
const dedans = schengenState([{ entry: '2026-09-01' }], REF)
ok(dedans.inside, 'un séjour sans date de sortie signifie que le client est dedans')
ok(dedans.used === 8, 'huit jours déjà passés sur place')
ok(dedans.mustLeaveBy === '2026-11-29',
  'la date limite de sortie est calculée : au-delà, séjour irrégulier')

console.log('--- 8 · La conformité, celle qui coûte de l\'argent ---')
// Article 83 ter : 20 % du montant, PLANCHER 2 000 DT. L'étude s'illustre de
// travers en annonçant 1 200 DT sur 6 000 : c'est sous le plancher.
const sous = cashCheck(0, 1000)
ok(sous.applies && !sous.over, 'mille dinars en liquide ne déclenchent rien')
ok(sous.applies && !sous.over && sous.headroom === 4000, 'il reste quatre mille dinars de marge')

const gros = cashCheck(0, 6000)
ok(gros.applies && gros.over, 'six mille dinars en liquide franchissent le seuil')
ok(gros.applies && gros.over && gros.penalty === 2000,
  'l\'amende est de 2 000 DT, le plancher, et non 1 200 comme l\'étude l\'illustre')
ok(gros.applies && gros.over && gros.cashMax === 4999 && gros.transferMin === 1001,
  'on propose 4 999 en liquide et 1 001 par virement')

const tresGros = cashCheck(0, 15000)
ok(tresGros.applies && tresGros.over && tresGros.penalty === 3000,
  'au-delà de dix mille dinars, c\'est le pourcentage qui l\'emporte sur le plancher')

// Le seuil s'apprécie sur l'opération : trois versements comptent ensemble.
const cumul = cashCheck(4000, 2000)
ok(cumul.applies && cumul.over,
  'quatre mille déjà encaissés plus deux mille franchissent le seuil')
ok(cumul.applies && cumul.over && cumul.cashMax === 999,
  'il ne reste que 999 dinars encaissables en liquide')

ok(cashCheck(0, 9000, 'EUR').applies === false,
  'un encaissement en devise ne relève pas de cette règle')

ok(!promiseCheck('Votre visa en 48 heures, accord garanti !').clean,
  'promettre un visa en 48 heures est une publicité trompeuse')
ok(promiseCheck('Votre visa en 48 heures').reasons.includes('delai_promis'),
  'le délai promis est nommé')
ok(promiseCheck('Accord garanti').reasons.includes('resultat_garanti'),
  'le résultat garanti est nommé')
ok(promiseCheck('Nous transmettons votre dossier au consulat dès réception des pièces.').clean,
  'une phrase honnête passe')
ok(promiseCheck('Le délai de traitement annoncé par le consulat est de 15 jours.').clean,
  'citer le délai DU CONSULAT n\'est pas promettre un résultat')

ok(agencyMay('A', 'omra'), 'une agence A peut faire de l\'Omra')
ok(!agencyMay('B', 'omra'), 'une agence B ne peut pas faire d\'Omra')
ok(!agencyMay('B', 'circuit'), 'ni organiser de circuit')
ok(agencyMay('B', 'visa'), 'mais elle peut traiter des visas')
ok(agencyMay(undefined, 'omra'),
  'sans catégorie déclarée on ne bloque rien : l\'écran le dit, il n\'interdit pas')

ok(complianceGaps({}).includes('politique_remboursement'),
  'la politique de remboursement manque tant que l\'agence ne l\'a pas déclarée')
ok(complianceGaps({
  taxId: '1', rcNumber: '2', rcCourt: 'Tunis', legalForm: 'SARL', capital: 10000,
  licenseCategory: 'A', licenseNumber: 'L1', inpdpRef: 'I1', refundPolicy: { fr: 'x' },
}).length === 0, 'une agence complète n\'a plus de manque')

const ontt = onttDeadlines({ onttChangeAt: '2020-01-01', onttFinancialsAt: '2020-01-01' })
ok(ontt.changeDue === '2020-01-31', 'le changement se déclare sous trente jours')
ok(ontt.changeLate && ontt.financialsLate, 'et un retard de six ans est signalé comme tel')

console.log('--- 9 · Le nom arabe comme donnée de référence ---')
ok(arNormalize('مُحَمَّد') === 'محمد', 'les voyelles ne départagent pas deux graphies')
ok(sameArabicName('إبراهيم', 'ابراهيم'), 'les quatre formes de l\'alef sont unifiées')
ok(sameArabicName('فاطمة', 'فاطمه'), 'la ta marbouta et le ha sont unifiés')
ok(sameArabicName('يحيى', 'يحيي'), 'la ya finale est unifiée')
ok(!sameArabicName('محمد', 'أحمد'), 'mais Mohamed et Ahmed restent deux personnes')
ok(!sameArabicName('', ''), 'deux vides ne se ressemblent pas, ils sont vides')

const gens = [
  { id: 'c1', passportNumber: 'K 1234567', birthDate: '1990-05-12', phone: '+216 20 111 222', nativeName: 'محمد بن علي' },
  { id: 'c2', passportNumber: 'X9999999', birthDate: '1985-01-01', phone: '+216 20 333 444', nativeName: 'فاطمة الزهراء' },
]
// B6 : le rapprochement se fait sur passeport ET date de naissance.
ok(matchClient(gens, 'K1234567', '1990-05-12').length === 1,
  'le passeport se retrouve malgré les espaces de saisie')
ok(matchClient(gens, 'K1234567', '1991-05-12').length === 0,
  'un passeport juste avec une mauvaise date ne rapproche rien')
ok(matchClient(gens, 'K1234567', undefined).length === 0,
  'le passeport SEUL ne suffit pas : il se ressaisit de travers')

// B7 : le doublon se détecte à la saisie, classé par force de preuve.
const d1 = findDuplicates(gens, { passport: 'k 1234567', birth: '1990-05-12' })
ok(d1.length === 1 && d1[0].reason === 'passeport_et_naissance',
  'même passeport et même naissance : quasi-certitude')
const d2 = findDuplicates(gens, { phone: '20 333 444' })
ok(d2.length === 1 && d2[0].client.id === 'c2' && d2[0].reason === 'meme_telephone',
  'le téléphone se compare sur ses huit derniers chiffres')
const d3 = findDuplicates(gens, { nativeName: 'فاطمه الزهراء', birth: '1985-01-01' })
ok(d3.length === 1 && d3[0].reason === 'nom_arabe_et_naissance',
  'le nom arabe normalisé plus la naissance méritent un coup d\'œil')
ok(findDuplicates(gens, { nativeName: 'فاطمه الزهراء' }).length === 0,
  'le nom SEUL ne signale rien : il ne prouve rien, c\'est tout le sujet')
ok(findDuplicates(gens, { passport: 'K1234567', birth: '1990-05-12', exclude: 'c1' }).length === 0,
  'on ne se signale pas soi-même comme son propre doublon')

console.log('')
if (failures.length > 0) {
  console.log(`--- ${failures.length} ÉCHEC(S) : ${failures.join(' · ')}`)
  process.exit(1)
}
console.log(`--- banc croisé des moteurs : ${passed} assertions, tout est vert ---`)
