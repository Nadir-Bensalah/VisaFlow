/* Les appels du module « ouverture d'une agence » : les référentiels partagés
 * et les quatre gardes de saisie (migration 0065).
 *
 * Une seule porte vers la base pour tout ce qui concerne l'ouverture. L'écran
 * de l'assistant n'appelle jamais Supabase directement : le jour où une
 * fonction SQL change de nom, il y a un seul fichier à relire.
 *
 * TOUT EST VÉRIFIÉ CÔTÉ SERVEUR, ET C'EST VOULU. La ressemblance de deux noms
 * d'agence, la disponibilité d'un sous-domaine, l'existence d'un compte avec
 * une adresse donnée : rien de tout cela ne peut se décider dans un navigateur
 * qui ne voit qu'une agence. Le front pose la question, il ne tranche pas.
 *
 * Sans backend (la démonstration hors ligne), les listes rendent vide et les
 * vérifications rendent « ok ». Bloquer une démonstration sur une question
 * qu'on ne peut pas poser n'aurait aucun sens.
 */

import { supabase } from '@/lib/supabase'

/* ------------------------------------------------------------------ */
/* Les formes                                                          */
/* ------------------------------------------------------------------ */

/** Une ligne de `countries`, telle que le sélecteur de pays la consomme.
 *  `phoneCode` est NULL pour douze pays : onze des Caraïbes qui partagent
 *  « +1 » avec les États-Unis, et le Vatican. Ce n'est pas un oubli, c'est un
 *  refus d'inventer. L'écran doit donc gérer l'absence d'indicatif. */
export interface CountryOption {
  iso2: string
  iso3: string
  nameFr: string
  nameEn: string
  nameAr: string
  /** Forme « +216 ». Null quand l'indicatif n'est pas certain. */
  phoneCode: string | null
  /** Le drapeau, déjà calculé en base. Le front n'a rien à dériver. */
  emoji: string | null
  /** 1 à 10 pour les dix pays du métier, 100 pour le reste. */
  priority: number
  active: boolean
}

/** Une ligne de `cities`. `lat` et `lng` sont nulles partout aujourd'hui :
 *  aucune source vérifiable, et rien ne les affiche. */
export interface CityOption {
  id: string
  countryCode: string
  name: string
  nameAr: string | null
  /** Le gouvernorat en Tunisie, le district en Libye, null ailleurs. */
  region: string | null
  lat: number | null
  lng: number | null
  priority: number
}

/** Pourquoi un nom d'agence est refusé. Null quand tout va bien. */
export type NameReason = 'vide' | 'trop_court' | 'trop_long' | 'sans_lettre' | 'nom_pris'

/** Une agence dont le nom ressemble à celui qu'on saisit. */
export interface NearAgency {
  slug: string
  name: string
}

/** Ce que rend `agency_name_check`.
 *  ATTENTION AU CAS PRINCIPAL : `ok` peut être VRAI avec des `proches` non
 *  vides. C'est une ressemblance, pas un doublon : « Voyages Ben Ali » et
 *  « Voyage Ben Ali » sont deux agences légitimes. L'écran doit alors laisser
 *  passer ET montrer la liste, jamais bloquer. */
export interface NameCheck {
  ok: boolean
  raison: NameReason | null
  /** Rempli nommément pour un compte de plateforme seulement. Un compte
   *  d'agence obtient une liste vide : la liste des clients de la plateforme
   *  ne se lit pas depuis un compte locataire. */
  proches: NearAgency[]
}

/** Pourquoi un sous-domaine est refusé. */
export type SlugReason = 'vide' | 'forme' | 'reserve' | 'pris' | 'indisponible'

/** Ce que rend `slug_check`. Les suggestions ne sortent que quand ça ne va
 *  pas, et elles sont toutes réellement libres. */
export interface SlugCheck {
  ok: boolean
  raison: SlugReason | null
  suggestions: string[]
}

/** Pourquoi une adresse est refusée. */
export type EmailReason = 'vide' | 'forme' | 'deja_utilise'

/** Ce que rend `email_check`. `dejaUtilise` est la raison d'être de l'appel :
 *  il évite le 409 de la fonction de bord au dernier écran du parcours. */
export interface EmailCheck {
  ok: boolean
  raison: EmailReason | null
  dejaUtilise: boolean
}

/** Pourquoi un téléphone est refusé. */
export type PhoneReason =
  | 'vide' | 'sans_chiffre' | 'indicatif_inconnu' | 'trop_court' | 'trop_long'

/** Ce que rend `phone_check`. `normalise` est la forme internationale, à
 *  enregistrer telle quelle. Elle peut être remplie même quand `ok` est faux
 *  (trop court, trop long) : c'est ce qui permet d'afficher à l'agent ce que
 *  sa saisie a donné. */
export interface PhoneCheck {
  ok: boolean
  raison: PhoneReason | null
  normalise: string | null
}

/* ------------------------------------------------------------------ */
/* Le plancher                                                         */
/* ------------------------------------------------------------------ */

function client() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

async function read<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  if (!supabase) return fallback
  return run()
}

type Row = Record<string, unknown>

function str(v: unknown): string { return typeof v === 'string' ? v : '' }
function strOrNull(v: unknown): string | null { return typeof v === 'string' ? v : null }
function numOrNull(v: unknown): number | null {
  if (typeof v === 'number') return v
  // PostgREST rend un `numeric` en chaîne pour ne pas perdre de précision.
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  return null
}

/* ------------------------------------------------------------------ */
/* Les pays                                                            */
/* ------------------------------------------------------------------ */

/* 198 pays ne changent pas pendant une session. Les recharger à chaque
   ouverture du sélecteur ferait 198 lignes sur le réseau pour rien. */
let countriesCache: CountryOption[] | null = null

/** Tous les pays actifs, les dix du métier en tête, le reste par ordre
 *  alphabétique du nom français. Le tri vient de la base, pas d'ici. */
export async function loadCountries(): Promise<CountryOption[]> {
  if (countriesCache) return countriesCache
  const list = await read(async () => {
    const { data, error } = await client()
      .from('countries')
      .select('iso2,iso3,name_fr,name_en,name_ar,phone_code,emoji,priority,active')
      .eq('active', true)
      .order('priority')
      .order('name_fr')
    if (error) throw new Error(`countries: ${error.message}`)
    return ((data ?? []) as Row[]).map((r): CountryOption => ({
      iso2: str(r.iso2),
      iso3: str(r.iso3),
      nameFr: str(r.name_fr),
      nameEn: str(r.name_en),
      nameAr: str(r.name_ar),
      phoneCode: strOrNull(r.phone_code),
      emoji: strOrNull(r.emoji),
      priority: typeof r.priority === 'number' ? r.priority : 100,
      active: r.active !== false,
    }))
  }, [])
  if (list.length > 0) countriesCache = list
  return list
}

/** L'indicatif d'un pays, ou null quand il n'est pas connu. Passe par le cache
 *  déjà chargé : aucun aller-retour supplémentaire. */
export function phoneCodeOf(countries: CountryOption[], iso2: string): string | null {
  return countries.find((c) => c.iso2 === iso2)?.phoneCode ?? null
}

/* ------------------------------------------------------------------ */
/* Les villes                                                          */
/* ------------------------------------------------------------------ */

/** Recherche de ville, insensible aux accents et à la casse : « beja » trouve
 *  « Béja », « ariana » trouve « Ariana ». Le terme vide rend le début de la
 *  liste du pays, chefs-lieux en tête, ce qui est exactement ce qu'il faut
 *  afficher avant que l'agent ait tapé quoi que ce soit. */
export async function searchCities(
  countryCode: string, query = '', limit = 20,
): Promise<CityOption[]> {
  return read(async () => {
    const { data, error } = await client().rpc('city_search', {
      p_country_code: countryCode, p_query: query, p_limit: limit,
    })
    if (error) throw new Error(`city_search: ${error.message}`)
    return ((data ?? []) as Row[]).map((r): CityOption => ({
      id: str(r.id),
      countryCode: str(r.country_code),
      name: str(r.name),
      nameAr: strOrNull(r.name_ar),
      region: strOrNull(r.region),
      lat: numOrNull(r.lat),
      lng: numOrNull(r.lng),
      priority: typeof r.priority === 'number' ? r.priority : 100,
    }))
  }, [])
}

/* ------------------------------------------------------------------ */
/* Les quatre gardes                                                   */
/* ------------------------------------------------------------------ */

/** Vérifie un nom d'agence : forme, doublon exact, et surtout ressemblance.
 *
 *  Le cas qui compte : `ok` vrai ET `proches` non vide. Deux agences peuvent
 *  légitimement porter des noms voisins, mais l'admin doit le voir avant de
 *  valider, pas après. L'écran affiche la liste sans bloquer le bouton. */
export async function checkAgencyName(nom: string): Promise<NameCheck> {
  return read(async () => {
    const { data, error } = await client().rpc('agency_name_check', { p_nom: nom })
    if (error) throw new Error(`agency_name_check: ${error.message}`)
    const d = (data ?? {}) as Row
    return {
      ok: d.ok === true,
      raison: (strOrNull(d.raison) as NameReason | null),
      proches: (Array.isArray(d.proches) ? d.proches : []).map((p): NearAgency => {
        const row = (p ?? {}) as Row
        return { slug: str(row.slug), name: str(row.name) }
      }),
    }
  }, { ok: true, raison: null, proches: [] })
}

/** Des sous-domaines libres dérivés du nom. TOUS sont vérifiés disponibles
 *  côté serveur : aucun de ceux-là ne peut faire échouer la création. La ville
 *  est facultative et sert de variante quand le nom seul est déjà pris. */
export async function suggestSlugs(
  nom: string, combien = 5, ville?: string | null,
): Promise<string[]> {
  return read(async () => {
    const { data, error } = await client().rpc('slug_suggestions', {
      p_nom: nom, p_combien: combien, p_ville: ville ?? null,
    })
    if (error) throw new Error(`slug_suggestions: ${error.message}`)
    return (Array.isArray(data) ? data : []).filter((s): s is string => typeof s === 'string')
  }, [])
}

/** Vérifie un sous-domaine : forme, mot réservé, disponibilité.
 *
 *  La forme est vérifiée SUR LA SAISIE TELLE QUELLE. « MonAgence » est refusé
 *  avec la raison `forme`, il n'est pas mis en minuscules en silence : la
 *  fonction de création, elle, refuserait le slug avec ses majuscules, et deux
 *  réponses contraires sur la même saisie feraient échouer le dernier écran.
 *  Les suggestions rendent la version en minuscules. */
export async function checkSlug(s: string): Promise<SlugCheck> {
  return read(async () => {
    const { data, error } = await client().rpc('slug_check', { p_slug: s })
    if (error) throw new Error(`slug_check: ${error.message}`)
    const d = (data ?? {}) as Row
    return {
      ok: d.ok === true,
      raison: (strOrNull(d.raison) as SlugReason | null),
      suggestions: (Array.isArray(d.suggestions) ? d.suggestions : [])
        .filter((x): x is string => typeof x === 'string'),
    }
  }, { ok: true, raison: null, suggestions: [] })
}

/** Vérifie une adresse e-mail, et surtout si un compte existe déjà avec elle.
 *
 *  C'est le seul moyen d'éviter le 409 de la fonction de bord d'invitation au
 *  DERNIER écran de l'ouverture, une fois tout saisi. La fonction ne dit
 *  jamais à qui appartient l'adresse. */
export async function checkEmail(m: string): Promise<EmailCheck> {
  return read(async () => {
    const { data, error } = await client().rpc('email_check', { p_email: m })
    if (error) throw new Error(`email_check: ${error.message}`)
    const d = (data ?? {}) as Row
    return {
      ok: d.ok === true,
      raison: (strOrNull(d.raison) as EmailReason | null),
      dejaUtilise: d.deja_utilise === true,
    }
  }, { ok: true, raison: null, dejaUtilise: false })
}

/** Normalise un téléphone en international avec l'indicatif du pays.
 *
 *  Elle NE valide PAS le numéro pays par pays : sans plan de numérotation, une
 *  règle inventée refuserait de vrais numéros et l'agent contournerait le
 *  champ. Elle vérifie la forme, préfixe l'indicatif, et refuse hors de la
 *  borne E.164 (7 à 15 chiffres). Un numéro déjà écrit en « + » garde son
 *  indicatif, même s'il ne correspond pas au pays choisi : le correspondant
 *  libyen d'une agence tunisienne est le cas normal, pas l'exception. */
export async function checkPhone(p: string, pays: string): Promise<PhoneCheck> {
  return read(async () => {
    const { data, error } = await client().rpc('phone_check', {
      p_phone: p, p_country_code: pays,
    })
    if (error) throw new Error(`phone_check: ${error.message}`)
    const d = (data ?? {}) as Row
    return {
      ok: d.ok === true,
      raison: (strOrNull(d.raison) as PhoneReason | null),
      normalise: strOrNull(d.normalise),
    }
  }, { ok: true, raison: null, normalise: p })
}
