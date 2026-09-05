/* L'identite du client final.

   Principe : le numero de telephone est l'identite, pas un compte avec un mot
   de passe. Presque aucun de ces clients n'a d'adresse e-mail active, tous ont
   WhatsApp.

   Trois niveaux, du moins couteux au plus sur :

   Niveau 0, le lien personnel. L'agence envoie un lien de suivi. Zero friction,
   mais quiconque a le lien voit la page : on n'y met donc que l'avancement,
   jamais un document ni un montant sensible.

   Niveau 1, le code a usage unique. Pour deposer une piece, voir ses documents
   ou retrouver ses dossiers, le client saisit son numero et recoit un code.
   L'appareil est ensuite reconnu 90 jours : le code n'est demande qu'une fois
   par appareil, pas a chaque visite. C'est ce qui rend le cout tenable, un
   message WhatsApp etant facture a l'envoi.

   Niveau 2, le comptoir. L'agent identifie la personne physiquement. C'est le
   seul niveau qui autorise un changement de numero. */

const DEVICE_KEY = 'visaflow.client.'
const CODE_KEY = 'visaflow.code.'
const DEVICE_DAYS = 90

export interface ClientDevice {
  phone: string
  until: string
}

/** Normalise un numero pour la comparaison : seuls les chiffres comptent. */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^00/, '')
}

export function samePhone(a?: string, b?: string): boolean {
  if (!a || !b) return false
  const x = normalizePhone(a)
  const y = normalizePhone(b)
  if (!x || !y) return false
  // Les huit derniers chiffres suffisent : indicatif ecrit ou non, meme personne.
  return x.slice(-8) === y.slice(-8)
}

/** Emet un code a six chiffres. En production, il part par WhatsApp et n'est
    jamais renvoye au navigateur. Ici, la demonstration l'affiche. */
export function issueCode(slug: string, phone: string): string {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  try {
    window.sessionStorage.setItem(CODE_KEY + slug + '.' + normalizePhone(phone), code)
  } catch {
    // Sans stockage, le code reste celui affiche a l'ecran.
  }
  return code
}

export function checkCode(slug: string, phone: string, code: string): boolean {
  try {
    const expected = window.sessionStorage.getItem(CODE_KEY + slug + '.' + normalizePhone(phone))
    return Boolean(expected) && expected === code.trim()
  } catch {
    return false
  }
}

export function rememberDevice(slug: string, phone: string): void {
  const until = new Date()
  until.setDate(until.getDate() + DEVICE_DAYS)
  try {
    window.localStorage.setItem(DEVICE_KEY + slug, JSON.stringify({ phone, until: until.toISOString() }))
  } catch {
    // L'appareil ne sera pas reconnu au prochain passage, rien de plus.
  }
}

export function knownDevice(slug: string): ClientDevice | null {
  try {
    const raw = window.localStorage.getItem(DEVICE_KEY + slug)
    if (!raw) return null
    const device = JSON.parse(raw) as ClientDevice
    if (new Date(device.until).getTime() < Date.now()) {
      window.localStorage.removeItem(DEVICE_KEY + slug)
      return null
    }
    return device
  } catch {
    return null
  }
}

export function forgetDevice(slug: string): void {
  try {
    window.localStorage.removeItem(DEVICE_KEY + slug)
  } catch {
    // Rien a faire.
  }
}
