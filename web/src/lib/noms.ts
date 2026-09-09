/**
 * Le nom arabe est la donnée de référence, la version latine une variante.
 *
 * Il n'existe aucun standard de translittération des noms arabes en caractères
 * latins. Le problème est reconnu au niveau des ÉTATS : la « correspondance des
 * noms des citoyens entre les deux pays » figure parmi les six conditions de
 * réouverture de Ras Jedir en juin 2024. Le même client revient donc sous trois
 * orthographes (Mohamed, Mohammed, Muhammad) et rapprocher un dossier d'une
 * pièce sur l'égalité stricte des chaînes ne marche tout simplement pas.
 *
 * Conséquence tenue ici : on ne rapproche JAMAIS sur le nom. Le passeport et la
 * date de naissance sont la clé.
 */

/** D'où vient une orthographe latine. Elles se contredisent, c'est normal. */
export const NAME_SOURCES = [
  'passeport', 'acte_naissance', 'reservation', 'formulaire_consulaire', 'saisie',
] as const
export type NameSource = (typeof NAME_SOURCES)[number]

export type NameVariant = {
  id: string
  agencyId: string
  clientId: string
  firstName?: string
  lastName?: string
  source: NameSource
  note?: string
}

// Diacritiques arabes : fatha, damma, kasra, sukun, shadda, tanwin, tatweel.
// Ils s'écrivent ou ne s'écrivent pas, ils ne doivent donc jamais départager.
const DIACRITICS = /[ً-ْـ]/g

// Formes qui se confondent à la saisie : les quatre alefs, la ta marbouta,
// la ya finale sans points, la hamza portée.
const FOLD: Record<string, string> = {
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا',
  'ة': 'ه', 'ى': 'ي', 'ؤ': 'و', 'ئ': 'ي',
}

/**
 * Normalise un nom arabe pour la comparaison. Sans cela « محمّد » et « محمد »
 * sont deux personnes différentes, et « فاطمة » ne retrouve pas « فاطمه ».
 */
export function arNormalize(name?: string): string {
  if (!name) return ''
  return name
    .replace(DIACRITICS, '')
    .split('')
    .map((c) => FOLD[c] ?? c)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Deux noms arabes désignent-ils la même graphie, aux variantes d'écriture près ? */
export function sameArabicName(a?: string, b?: string): boolean {
  const na = arNormalize(a)
  const nb = arNormalize(b)
  return na !== '' && na === nb
}

const digits = (s?: string) => (s ?? '').replace(/[^0-9]/g, '')
const passportKey = (s?: string) => (s ?? '').replace(/\s/g, '').toUpperCase()

export type DuplicateReason =
  | 'passeport_et_naissance'
  | 'meme_telephone'
  | 'nom_arabe_et_naissance'

export type DuplicateHit<T> = { client: T; reason: DuplicateReason; rank: number }

export type MatchableClient = {
  id: string
  passportNumber?: string
  birthDate?: string
  phone?: string
  whatsapp?: string
  nativeName?: string
}

/**
 * Le rapprochement, qui ne passe jamais par le nom latin.
 *
 * Passeport ET date de naissance : le passeport seul se ressaisit de travers,
 * la date seule est partagée par des milliers de gens.
 */
export function matchClient<T extends MatchableClient>(
  clients: T[], passport?: string, birth?: string,
): T[] {
  if (!passport || !birth) return []
  const key = passportKey(passport)
  return clients.filter((c) => passportKey(c.passportNumber) === key && c.birthDate === birth)
}

/**
 * Les doublons possibles au moment de la saisie, classés par force de preuve.
 * Le nom latin seul ne figure nulle part : il ne prouve rien, c'est tout le sujet.
 */
export function findDuplicates<T extends MatchableClient>(
  clients: T[],
  input: { passport?: string; birth?: string; phone?: string; nativeName?: string; exclude?: string },
): DuplicateHit<T>[] {
  const key = input.passport ? passportKey(input.passport) : ''
  // Le téléphone se compare sur ses huit derniers chiffres : indicatif, espaces
  // et zéro initial varient d'une saisie à l'autre.
  const tel = input.phone ? digits(input.phone).slice(-8) : ''

  const hits: DuplicateHit<T>[] = []
  for (const c of clients) {
    if (input.exclude && c.id === input.exclude) continue

    if (key && input.birth && passportKey(c.passportNumber) === key && c.birthDate === input.birth) {
      hits.push({ client: c, reason: 'passeport_et_naissance', rank: 1 })
      continue
    }
    if (tel.length === 8 && digits(c.whatsapp ?? c.phone).slice(-8) === tel) {
      hits.push({ client: c, reason: 'meme_telephone', rank: 2 })
      continue
    }
    if (input.nativeName && input.birth
        && sameArabicName(c.nativeName, input.nativeName) && c.birthDate === input.birth) {
      hits.push({ client: c, reason: 'nom_arabe_et_naissance', rank: 3 })
    }
  }
  return hits.sort((a, b) => a.rank - b.rank).slice(0, 10)
}
