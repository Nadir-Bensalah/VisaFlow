/* L'agrégateur des blocs de traduction par module.
 *
 * Le dictionnaire principal (`fr.ts` et ses trois traductions) est un seul gros
 * objet : deux personnes qui y écrivent en même temps se marchent dessus. Les
 * modules ajoutés après coup posent donc leur bloc dans `modules/<nom>.ts`, et
 * ce fichier les réunit. Le français reste la référence : c'est lui qui donne
 * le type, et une langue qui ne traduit pas une clé retombe dessus.
 */
import { commerce } from './modules/commerce'
import { crm } from './modules/crm'
import { cargoref } from './modules/cargoref'
import { logistique } from './modules/logistique'
import { saas } from './modules/saas'
import { securite } from './modules/securite'
import { notifs } from './modules/notifs'
import { cargo2 } from './modules/cargo2'
import { integrite } from './modules/integrite'
import { documents } from './modules/documents'
import { support } from './modules/support'

const BLOCKS = [commerce, crm, cargoref, logistique, saas, securite, notifs, support, documents, integrite, cargo2]

type Lang = 'fr' | 'en' | 'ar' | 'zh'

function merge(lang: Lang): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const block of BLOCKS) Object.assign(out, block[lang])
  return out
}

/** Le français donne le type : toute clé traduite ailleurs existe d'abord ici. */
export type ModuleDict =
  & typeof commerce.fr & typeof crm.fr & typeof cargoref.fr
  & typeof logistique.fr & typeof saas.fr & typeof securite.fr & typeof notifs.fr
  & typeof cargo2.fr
  & typeof integrite.fr
  & typeof documents.fr
  & typeof support.fr

export const MODULES: Record<Lang, Record<string, unknown>> = {
  fr: merge('fr'), en: merge('en'), ar: merge('ar'), zh: merge('zh'),
}
