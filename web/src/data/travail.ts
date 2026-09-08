/* Le module de l'organisation du travail parle au serveur en direct.
 *
 * PRINCIPE, ET IL VAUT RÈGLE : aucun chiffre n'est compté ici, et aucun style
 * n'est deviné ici. Le style d'une personne se déduit de son poste, EN BASE,
 * par `member_work_style`. Le recalculer dans le navigateur ferait une deuxième
 * source pour la même information, et c'est toujours celle qu'on a oublié de
 * mettre à jour qui s'affiche.
 *
 * Ce fichier ne fait que deux choses : appeler les fonctions de la migration
 * 0063, et traduire snake_case en camelCase.
 */

import { supabase, HAS_BACKEND } from '@/lib/supabase'
import type { I18nText } from '@/data/types'

type Row = Record<string, any>

function sb() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

const cnt = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

/* ------------------------------------------------------------------ */
/* Le vocabulaire, tel que la base le fixe                             */
/* ------------------------------------------------------------------ */

/** Les deux façons de regarder son travail. Un poste porte l'une des deux. */
export type WorkStyle = 'portefeuille' | 'file'

/** La façon de travailler d'une agence. `mixte` n'est pas un style : c'est le
    fait que des postes des deux styles cohabitent. */
export type WorkMode = 'portefeuille' | 'file' | 'mixte'

/** Le vocabulaire clos des gestes, dans l'ordre où la base les rend. Les dix
    premiers peuvent composer le `focus` d'un poste ; `taches` n'appartient à
    aucun poste, parce qu'une tâche est nominative. */
export const GESTES = [
  'pieces', 'encaissement', 'factures', 'creneaux', 'passeports',
  'messages', 'traductions', 'douane', 'livraisons', 'prospects', 'taches',
] as const
export type Geste = (typeof GESTES)[number]

/** Les dix gestes qu'un poste peut prendre en charge. `taches` en est exclu. */
export const GESTES_FOCUS: Geste[] = GESTES.filter((g) => g !== 'taches')

/** La clé de traduction d'un geste. Le serveur la rend aussi dans chaque
    groupe (`cleLibelle`) : ce tableau sert aux écrans qui listent un focus. */
export const GESTE_KEY: Record<Geste, string> = {
  pieces: 'trv.gestePieces',
  encaissement: 'trv.gesteEncaissement',
  factures: 'trv.gesteFactures',
  creneaux: 'trv.gesteCreneaux',
  passeports: 'trv.gestePasseports',
  messages: 'trv.gesteMessages',
  traductions: 'trv.gesteTraductions',
  douane: 'trv.gesteDouane',
  livraisons: 'trv.gesteLivraisons',
  prospects: 'trv.gesteProspects',
  taches: 'trv.gesteTaches',
}

export const MODE_KEY: Record<WorkMode, string> = {
  portefeuille: 'trv.modePortefeuille',
  file: 'trv.modeFile',
  mixte: 'trv.modeMixte',
}

export const MODE_ONELINER: Record<WorkMode, string> = {
  portefeuille: 'trv.modePortefeuilleOne',
  file: 'trv.modeFileOne',
  mixte: 'trv.modeMixteOne',
}

export const MODE_EFFECT: Record<WorkMode, string> = {
  portefeuille: 'trv.effectPortefeuille',
  file: 'trv.effectFile',
  mixte: 'trv.effectMixte',
}

export const STYLE_KEY: Record<WorkStyle, string> = {
  portefeuille: 'trv.stylePortefeuille',
  file: 'trv.styleFile',
}

export const STYLE_HINT: Record<WorkStyle, string> = {
  portefeuille: 'trv.stylePortefeuilleHint',
  file: 'trv.styleFileHint',
}

/** Le titre de l'écran d'accueil, dans le bloc de ce module. Le serveur rend
    aussi `titreCle` sous le préfixe `pil.` : les deux disent le même texte, on
    prend celui dont la clé existe dans le dictionnaire qu'on charge. */
export const TITRE_KEY: Record<WorkStyle, string> = {
  portefeuille: 'trv.myCases',
  file: 'trv.myQueue',
}

/* ------------------------------------------------------------------ */
/* Les formes                                                          */
/* ------------------------------------------------------------------ */

export interface MyWorkStyle {
  style: WorkStyle
  /** Les gestes du poste. Vide en portefeuille : un conseiller fait tout. */
  focus: Geste[]
  /** Le code du poste, ou null quand aucun poste ne correspond. */
  poste: string | null
  posteLabel: I18nText | null
  /** `poste` : le style vient du poste. `agence` : il retombe sur le mode. */
  source: 'poste' | 'agence'
  agencyMode: WorkMode
}

export interface WorkGroup {
  geste: Geste
  /** La clé de traduction complète, par exemple `trv.gestePieces`. */
  cleLibelle: string
  compte: number
  url: string
  /** La couleur de la ligne : red, orange, blue, green, gray. */
  urgence: string
}

export interface Worklist {
  style: WorkStyle
  focus: Geste[]
  /** La clé du titre telle que le serveur la nomme (`pil.myCases`). */
  titreCle: string
  /** Le même titre dans le bloc de ce module (`trv.myCases`). */
  titreCleTrv: string
  poste: string | null
  posteLabel: I18nText | null
  source: 'poste' | 'agence'
  groupes: WorkGroup[]
  total: number
  generatedAt: string
}

export interface WorkModeMember {
  id: string
  name: string
  role: string
  style: WorkStyle
  poste: string | null
  posteLabel: I18nText | null
  source: 'poste' | 'agence'
}

export interface AgencyWorkMode {
  mode: WorkMode
  canChange: boolean
  portefeuille: number
  file: number
  sansPoste: number
  total: number
  membres: WorkModeMember[]
}

/* ------------------------------------------------------------------ */
/* Lire                                                                */
/* ------------------------------------------------------------------ */

function asStyle(v: unknown): WorkStyle {
  return v === 'file' ? 'file' : 'portefeuille'
}

function asMode(v: unknown): WorkMode {
  return v === 'file' || v === 'mixte' ? v : 'portefeuille'
}

function asFocus(v: unknown): Geste[] {
  if (!Array.isArray(v)) return []
  return (v as string[]).filter((g): g is Geste => (GESTES as readonly string[]).includes(g))
}

function readStyle(r: Row): MyWorkStyle {
  return {
    style: asStyle(r.style),
    focus: asFocus(r.focus),
    poste: r.poste ?? null,
    posteLabel: (r.poste_label as I18nText) ?? null,
    source: r.source === 'agence' ? 'agence' : 'poste',
    agencyMode: asMode(r.agency_mode),
  }
}

/** Le style de la personne connectée, sans charger toute sa file. L'écran
    d'accueil s'en sert pour choisir sa disposition avant de savoir quoi
    afficher. */
export async function loadMyWorkStyle(): Promise<MyWorkStyle | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('my_work_style')
  if (error) throw new Error(error.message)
  if (!data) return null
  return readStyle(data as Row)
}

/** Ce qui attend la personne connectée, présenté selon le style de son poste.
    En file, les chiffres sont ceux de `dashboard_today`, regroupés par geste :
    aucun compteur n'est recalculé, ni ici ni en base. */
export async function loadMyWorklist(): Promise<Worklist | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('my_worklist')
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Row
  const style = asStyle(r.style)
  return {
    style,
    focus: asFocus(r.focus),
    titreCle: r.titre_cle ?? TITRE_KEY[style],
    titreCleTrv: r.titre_cle_trv ?? TITRE_KEY[style],
    poste: r.poste ?? null,
    posteLabel: (r.poste_label as I18nText) ?? null,
    source: r.source === 'agence' ? 'agence' : 'poste',
    groupes: ((r.groupes ?? []) as Row[])
      .filter((g) => (GESTES as readonly string[]).includes(g.geste))
      .map((g) => ({
        geste: g.geste as Geste,
        cleLibelle: g.cle_libelle,
        compte: cnt(g.compte),
        url: g.url,
        urgence: g.urgence ?? 'gray',
      })),
    total: cnt(r.total),
    generatedAt: r.generated_at,
  }
}

/** Le mode de l'agence, plus la réalité d'aujourd'hui : combien de personnes
    travaillent dans chaque style. Un réglage dont on ne voit pas l'effet ne se
    règle jamais. */
export async function loadAgencyWorkMode(): Promise<AgencyWorkMode | null> {
  if (!HAS_BACKEND) return null
  const { data, error } = await sb().rpc('agency_work_mode')
  if (error) throw new Error(error.message)
  if (!data) return null
  return readAgencyMode(data as Row)
}

function readAgencyMode(r: Row): AgencyWorkMode {
  return {
    mode: asMode(r.mode),
    canChange: Boolean(r.can_change),
    portefeuille: cnt(r.portefeuille),
    file: cnt(r.file),
    sansPoste: cnt(r.sans_poste),
    total: cnt(r.total),
    membres: ((r.membres ?? []) as Row[]).map((m) => ({
      id: m.id,
      name: m.name ?? '',
      role: m.role ?? 'agent',
      style: asStyle(m.style),
      poste: m.poste ?? null,
      posteLabel: (m.poste_label as I18nText) ?? null,
      source: m.source === 'agence' ? 'agence' : 'poste',
    })),
  }
}

/* ------------------------------------------------------------------ */
/* Écrire                                                              */
/* ------------------------------------------------------------------ */

/** Réservée à qui modifie les réglages. La base refuse les autres, et elle
    écrit une ligne au journal : un réglage qui change la tête de l'écran de
    tout le monde sans laisser de nom est un réglage sans auteur. */
export async function setAgencyWorkMode(mode: WorkMode): Promise<AgencyWorkMode | null> {
  const { data, error } = await sb().rpc('set_agency_work_mode', { p_mode: mode })
  if (error) throw new Error(error.message)
  if (!data) return null
  return readAgencyMode(data as Row)
}

/* ------------------------------------------------------------------ */
/* Les postes, classés par le mode                                     */
/* ------------------------------------------------------------------ */

export interface RankedJob {
  id: string
  agencyId: string | null
  code: string
  label: I18nText
  description: I18nText
  baseRole: string
  grants: string[]
  revokes: string[]
  position: number
  workStyle: WorkStyle
  focus: Geste[]
  /** Vrai quand ce poste va avec la façon de travailler de l'agence. Les autres
      restent proposés : un mélange se fait en descendant d'une ligne. */
  suggested: boolean
}

export async function loadRankedJobs(): Promise<RankedJob[]> {
  if (!HAS_BACKEND) return []
  const { data, error } = await sb().rpc('job_templates_ranked')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    agencyId: r.agency_id ?? null,
    code: r.code,
    label: (r.label as I18nText) ?? { fr: r.code },
    description: (r.description as I18nText) ?? { fr: '' },
    baseRole: r.base_role,
    grants: r.grants ?? [],
    revokes: r.revokes ?? [],
    position: cnt(r.position),
    workStyle: asStyle(r.work_style),
    focus: asFocus(r.focus),
    suggested: Boolean(r.suggested),
  }))
}

export { HAS_BACKEND }
