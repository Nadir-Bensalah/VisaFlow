/* Le module de l'équipe parle au serveur en direct.
 *
 * Tout ce que l'écran affiche descend d'UN appel : `team_overview()` rend les
 * membres, leurs bureaux, leurs capacités calculées, leurs écarts au rôle, le
 * catalogue des dix-neuf capacités, ce que chaque rôle donne, et les
 * invitations. Un deuxième appel rend les modèles de poste. Deux allers-retours,
 * pas vingt.
 *
 * UNE RÈGLE, ET ELLE NE SE DISCUTE PAS. Les capacités d'une personne ne se
 * recalculent PAS ici. Elles descendent du serveur, qui les calcule avec
 * `member_capabilities`, la même fonction que celle qui remplit le jeton. Un
 * droit recalculé dans le navigateur finit toujours par diverger de celui de la
 * base, et c'est celui de la base qui décide. Ce fichier calcule seulement deux
 * choses, et jamais pour décider : l'APERÇU d'un changement (« il gagnera
 * ceci ») et le jeu de démonstration hors ligne.
 */

import { supabase, HAS_BACKEND } from '@/lib/supabase'
import { can } from '@/lib/permissions'
import type { Capability } from '@/lib/permissions'
import type { I18nText, Office, Role, User } from '@/data/types'

/* ------------------------------------------------------------------ */
/* Les formes                                                          */
/* ------------------------------------------------------------------ */

/** Les onze domaines de la table `permissions`, dans l'ordre d'affichage. */
export const DOMAINS = [
  'dossiers', 'clients', 'pieces', 'messages', 'finance',
  'fret', 'pilotage', 'reglages', 'equipe', 'securite', 'donnees',
] as const
export type Domain = (typeof DOMAINS)[number]

/** La clé de traduction du domaine. Le nom suit l'i18n du module. */
export const DOMAIN_KEY: Record<Domain, string> = {
  dossiers: 'eq.domDossiers', clients: 'eq.domClients', pieces: 'eq.domPieces',
  messages: 'eq.domMessages', finance: 'eq.domFinance', fret: 'eq.domFret',
  pilotage: 'eq.domPilotage', reglages: 'eq.domReglages', equipe: 'eq.domEquipe',
  securite: 'eq.domSecurite', donnees: 'eq.domDonnees',
}

export interface PermissionMeta {
  code: string
  domain: string
  /** Le libellé dans les quatre langues. */
  label: I18nText
  /** Ce droit engage l'argent, les comptes ou les données de l'agence. */
  sensitive: boolean
}

export interface Override { permission: string; granted: boolean }

export interface TeamMember {
  id: string
  name: string
  email: string
  phone: string | null
  role: Role
  /** Le bureau principal : celui qui s'imprime sur un reçu. */
  officeId: string | null
  active: boolean
  mustResetPassword: boolean
  lastSeenAt: string | null
  /** Les bureaux où la personne travaille, principal compris. */
  offices: string[]
  /** Calculées par le serveur. On ne les recalcule jamais. */
  capabilities: string[]
  /** Les écarts au rôle : accordés en plus, retirés malgré. */
  overrides: Override[]
}

export interface TeamInvitation {
  id: string
  email: string
  name: string | null
  role: Role
  officeId: string | null
  status: 'envoyee' | 'acceptee' | 'revoquee' | 'expiree'
  createdAt: string
  acceptedAt: string | null
}

export interface TeamOverview {
  members: TeamMember[]
  permissions: PermissionMeta[]
  /** Ce que chaque rôle donne par défaut, tel que la base le dit. */
  roles: Record<Role, string[]>
  invitations: TeamInvitation[]
}

export interface JobTemplate {
  id: string
  /** Null : modèle livré avec le produit. Sinon : écrit par l'agence. */
  agencyId: string | null
  code: string
  label: I18nText
  description: I18nText
  baseRole: Role
  grants: string[]
  revokes: string[]
  position: number
}

/* ------------------------------------------------------------------ */
/* Le catalogue, pour l'affichage                                      */
/* ------------------------------------------------------------------ */

/* La base porte les libellés en français, anglais et arabe. Le produit parle
   quatre langues : le chinois manque, et le bureau de Canton est un vrai
   bureau. On complète donc ici, côté écran, sans toucher au catalogue de la
   base qui est le socle de la sécurité. Si un jour la base ajoute une capacité
   que ce tableau ne connaît pas, l'écran retombe sur ses libellés à elle. */
export const CAP_LABELS: Record<string, I18nText> = {
  'case:read': { fr: 'Voir les dossiers', en: 'View cases', ar: 'الاطلاع على الملفات', zh: '查看案卷' },
  'case:create': { fr: 'Ouvrir un dossier', en: 'Open a case', ar: 'فتح ملف', zh: '建立案卷' },
  'case:write': { fr: 'Faire avancer un dossier', en: 'Advance a case', ar: 'تقديم الملف', zh: '推进案卷' },
  'client:write': { fr: 'Créer et modifier des clients', en: 'Create and edit clients', ar: 'إنشاء وتعديل الحرفاء', zh: '新建与修改客户' },
  'doc:validate': { fr: 'Valider une pièce', en: 'Validate a document', ar: 'المصادقة على وثيقة', zh: '审核材料' },
  'message:send': { fr: 'Écrire au client', en: 'Message the client', ar: 'مراسلة الحريف', zh: '联系客户' },
  'payment:write': { fr: 'Encaisser', en: 'Take payments', ar: 'قبض الأموال', zh: '收款' },
  'finance:global': { fr: 'Voir toute la caisse et la marge', en: 'See all finances', ar: 'الاطلاع على كل المالية', zh: '查看全部资金与毛利' },
  'shipment:write': { fr: 'Gérer les cargaisons', en: 'Manage shipments', ar: 'إدارة الشحنات', zh: '管理货运' },
  'reports:view': { fr: 'Voir les rapports', en: 'View reports', ar: 'الاطلاع على التقارير', zh: '查看报表' },
  'automation:manage': { fr: 'Régler les automatisations', en: 'Manage automations', ar: 'ضبط الأتمتة', zh: '设置自动化' },
  'settings:view': { fr: 'Voir les réglages', en: 'View settings', ar: 'الاطلاع على الإعدادات', zh: '查看设置' },
  'settings:manage': { fr: 'Modifier les réglages', en: 'Change settings', ar: 'تعديل الإعدادات', zh: '修改设置' },
  'catalog:manage': { fr: 'Gérer le catalogue', en: 'Manage the catalogue', ar: 'إدارة الكتالوج', zh: '管理目录' },
  'team:invite': { fr: 'Inviter un agent ou un lecteur', en: 'Invite agents and viewers', ar: 'دعوة وكيل أو قارئ', zh: '邀请业务员或只读用户' },
  'team:manage': { fr: 'Gérer toute l’équipe', en: 'Manage the whole team', ar: 'إدارة كامل الفريق', zh: '管理整个团队' },
  'audit:view': { fr: 'Lire le journal d’audit', en: 'Read the audit trail', ar: 'قراءة سجل التدقيق', zh: '查阅审计日志' },
  'data:export': { fr: 'Exporter les données', en: 'Export data', ar: 'تصدير البيانات', zh: '导出数据' },
  'data:reset': { fr: 'Réinitialiser les données', en: 'Reset data', ar: 'إعادة تهيئة البيانات', zh: '重置数据' },
}

/* Le domaine et le caractère sensible de chaque capacité, recopiés de la
   migration 0044. Ils ne servent qu'au repli hors ligne : quand le serveur
   répond, c'est lui qui fait foi. */
const CAP_DOMAIN: Record<string, { domain: Domain; sensitive: boolean }> = {
  'case:read': { domain: 'dossiers', sensitive: false },
  'case:create': { domain: 'dossiers', sensitive: false },
  'case:write': { domain: 'dossiers', sensitive: false },
  'client:write': { domain: 'clients', sensitive: false },
  'doc:validate': { domain: 'pieces', sensitive: false },
  'message:send': { domain: 'messages', sensitive: false },
  'payment:write': { domain: 'finance', sensitive: true },
  'finance:global': { domain: 'finance', sensitive: true },
  'shipment:write': { domain: 'fret', sensitive: false },
  'reports:view': { domain: 'pilotage', sensitive: false },
  'automation:manage': { domain: 'pilotage', sensitive: false },
  'settings:view': { domain: 'reglages', sensitive: false },
  'settings:manage': { domain: 'reglages', sensitive: true },
  'catalog:manage': { domain: 'reglages', sensitive: false },
  'team:invite': { domain: 'equipe', sensitive: true },
  'team:manage': { domain: 'equipe', sensitive: true },
  'audit:view': { domain: 'securite', sensitive: true },
  'data:export': { domain: 'donnees', sensitive: true },
  'data:reset': { domain: 'donnees', sensitive: true },
}

/** Les dix-neuf capacités, dans l'ordre de la base. */
export const ALL_CAPS: Capability[] = [
  'case:read', 'case:create', 'case:write', 'client:write', 'doc:validate',
  'message:send', 'payment:write', 'finance:global', 'shipment:write',
  'reports:view', 'automation:manage', 'settings:view', 'settings:manage',
  'catalog:manage', 'team:invite', 'team:manage', 'audit:view',
  'data:export', 'data:reset',
]

/**
 * Les lignes du tableau comparatif, dans l'ordre où le patron se pose la
 * question : peut-il ouvrir un dossier, le faire avancer, valider une pièce,
 * encaisser, voir tout l'argent, régler l'agence, toucher aux comptes.
 * Le reste des dix-neuf reste consultable dans le panneau d'une personne.
 */
export const MATRIX_ROWS: Capability[] = [
  'case:read', 'case:create', 'case:write', 'doc:validate', 'message:send',
  'payment:write', 'finance:global', 'reports:view', 'settings:manage',
  'team:manage', 'audit:view', 'data:export',
]

/* ------------------------------------------------------------------ */
/* Les périmètres : ce que l'écran doit rendre évident                 */
/* ------------------------------------------------------------------ */

export type Scope = 'agence' | 'bureau'

/** La direction voit toute l'agence, le reste ne voit que ses bureaux.
    C'est la règle de `auth_sees_office`, recopiée pour l'affichage seul. */
export function scopeOfRole(role: Role): Scope {
  return role === 'owner' || role === 'manager' ? 'agence' : 'bureau'
}

/* ------------------------------------------------------------------ */
/* Lire                                                                */
/* ------------------------------------------------------------------ */

type Row = Record<string, any>

function sb() {
  if (!supabase) throw new Error('backend absent')
  return supabase
}

function labelOf(code: string, row: Row): I18nText {
  const known = CAP_LABELS[code]
  if (known) return known
  // Une capacité que l'écran ne connaît pas encore : on montre ce que la base
  // en dit plutôt que son code brut.
  return { fr: row.label_fr ?? code, en: row.label_en ?? code, ar: row.label_ar ?? code }
}

function member(row: Row): TeamMember {
  return {
    id: row.id, name: row.name ?? '', email: row.email ?? '', phone: row.phone ?? null,
    role: row.role as Role, officeId: row.office_id ?? null,
    active: row.active !== false, mustResetPassword: row.must_reset_password === true,
    lastSeenAt: row.last_seen_at ?? null,
    offices: Array.isArray(row.offices) ? row.offices : [],
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    overrides: Array.isArray(row.overrides) ? row.overrides : [],
  }
}

export async function loadTeam(): Promise<TeamOverview> {
  const { data, error } = await sb().rpc('team_overview')
  if (error) throw new Error(error.message)
  const d = (data ?? {}) as Row
  return {
    members: ((d.members ?? []) as Row[]).map(member),
    permissions: ((d.permissions ?? []) as Row[]).map((p) => ({
      code: p.code, domain: p.domain, label: labelOf(p.code, p), sensitive: p.sensitive === true,
    })),
    roles: (d.roles ?? {}) as Record<Role, string[]>,
    invitations: ((d.invitations ?? []) as Row[]).map((i) => ({
      id: i.id, email: i.email, name: i.name ?? null, role: i.role as Role,
      officeId: i.office_id ?? null, status: i.status, createdAt: i.created_at,
      acceptedAt: i.accepted_at ?? null,
    })),
  }
}

export async function loadJobTemplates(): Promise<JobTemplate[]> {
  const { data, error } = await sb().rpc('job_templates_for_agency')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id, agencyId: r.agency_id ?? null, code: r.code,
    label: r.label ?? { fr: r.code }, description: r.description ?? { fr: '' },
    baseRole: r.base_role as Role,
    grants: r.grants ?? [], revokes: r.revokes ?? [],
    position: r.position ?? 100,
  }))
}

/* ------------------------------------------------------------------ */
/* Écrire                                                              */
/* ------------------------------------------------------------------ */

export async function applyJobTemplate(userId: string, templateId: string): Promise<void> {
  const { error } = await sb().rpc('apply_job_template', { p_user: userId, p_template: templateId })
  if (error) throw new Error(error.message)
}

/** `granted` à null efface l'écart : la personne revient à ce que son rôle donne. */
export async function setMemberPermission(userId: string, permission: string, granted: boolean | null): Promise<void> {
  const { error } = await sb().rpc('set_member_permission', {
    p_user: userId, p_permission: permission, p_granted: granted,
  })
  if (error) throw new Error(error.message)
}

export async function setMemberOffice(userId: string, officeId: string, active: boolean): Promise<void> {
  const { error } = await sb().rpc('set_member_office', {
    p_user: userId, p_office: officeId, p_active: active,
  })
  if (error) throw new Error(error.message)
}

export async function setMemberActive(userId: string, active: boolean): Promise<void> {
  const { error } = await sb().from('profiles').update({ active }).eq('id', userId)
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Comparer une personne à un poste                                    */
/* ------------------------------------------------------------------ */

/**
 * Les écarts qu'un modèle pose vraiment.
 *
 * Un modèle peut citer un droit que le rôle donne déjà, ou en retirer un que le
 * rôle ne donnait pas : ces lignes-là n'écrivent rien en base (la fonction
 * `apply_job_template` les filtre). On applique ici le MÊME filtre, sinon la
 * comparaison « ce compte correspond-il à ce poste » répondrait non alors que
 * le serveur a écrit exactement ce qu'on attendait.
 */
export function templateOverrides(tpl: JobTemplate, roles: Record<Role, string[]>): Override[] {
  const base = roles[tpl.baseRole] ?? []
  const out: Override[] = []
  for (const g of tpl.grants) if (!base.includes(g)) out.push({ permission: g, granted: true })
  for (const r of tpl.revokes) if (base.includes(r)) out.push({ permission: r, granted: false })
  return out
}

/** Les capacités qu'une personne AURAIT avec ce poste. Pour l'aperçu seulement. */
export function capsWithTemplate(tpl: JobTemplate, roles: Record<Role, string[]>): string[] {
  const base = new Set(roles[tpl.baseRole] ?? [])
  for (const g of tpl.grants) base.add(g)
  for (const r of tpl.revokes) base.delete(r)
  return [...base]
}

const key = (o: Override) => `${o.permission}:${o.granted ? '+' : '-'}`

/**
 * Le poste d'une personne, ou null si ses droits ne correspondent à aucun.
 *
 * Rien ne relie un compte à son modèle en base, et c'est voulu (voir la
 * migration 0062). On retrouve donc le poste en comparant : même rôle, mêmes
 * écarts, au signe près. Quand plus rien ne correspond, l'écran dit
 * « personnalisé », ce qui est la vérité.
 */
export function jobOf(m: TeamMember, templates: JobTemplate[], roles: Record<Role, string[]>): JobTemplate | null {
  const mine = new Set(m.overrides.map(key))
  for (const tpl of templates) {
    if (tpl.baseRole !== m.role) continue
    const his = templateOverrides(tpl, roles).map(key)
    if (his.length !== mine.size) continue
    if (his.every((k) => mine.has(k))) return tpl
  }
  return null
}

/** Ce qu'un changement de poste ferait gagner et perdre. Pour l'aperçu, avant de valider. */
export function previewJob(m: TeamMember, tpl: JobTemplate, roles: Record<Role, string[]>): { gains: string[]; losses: string[] } {
  const now = new Set(m.capabilities)
  const next = new Set(capsWithTemplate(tpl, roles))
  return {
    gains: [...next].filter((c) => !now.has(c)),
    losses: [...now].filter((c) => !next.has(c)),
  }
}

/** L'état d'une capacité pour une personne : héritée du rôle, ajoutée, retirée. */
export type CapState = 'heritee' | 'ajoutee' | 'retiree' | 'absente'

export function capState(m: TeamMember, code: string, roles: Record<Role, string[]>): CapState {
  const over = m.overrides.find((o) => o.permission === code)
  if (over) return over.granted ? 'ajoutee' : 'retiree'
  return (roles[m.role] ?? []).includes(code) ? 'heritee' : 'absente'
}

/* ------------------------------------------------------------------ */
/* Le jeu de démonstration                                             */
/* ------------------------------------------------------------------ */

/* Sans backend, l'écran ne montre pas une page vide : l'équipe est ce qu'un
   prospect regarde en premier, et une page vide dit « ce produit ne fait rien ».
   On reconstruit donc un aperçu complet à partir du jeu local du magasin, avec
   les vrais postes de la migration 0062 et les vrais droits de
   `lib/permissions.ts`. Rien n'est inventé : ce sont les mêmes règles, jouées
   dans le navigateur. */

const DEMO_TEMPLATES: Omit<JobTemplate, 'id'>[] = [
  { agencyId: null, code: 'proprietaire', position: 10, baseRole: 'owner', grants: [], revokes: [],
    label: { fr: 'Propriétaire', en: 'Owner', ar: 'المالك', zh: '东主' },
    description: { fr: 'Tout voir, tout faire, y compris la caisse globale et l’équipe.', en: 'Sees and does everything, including all finances and the team.', ar: 'يرى كل شيء ويفعل كل شيء.', zh: '查看和处理一切。' } },
  { agencyId: null, code: 'gestionnaire', position: 20, baseRole: 'manager', grants: [], revokes: ['team:invite'],
    label: { fr: 'Gestionnaire d’agence', en: 'Agency manager', ar: 'مدير الوكالة', zh: '分社经理' },
    description: { fr: 'Organise l’agence : réglages, catalogue, automatisations, rapports. Il ne voit pas la caisse globale et ne touche pas aux comptes.', en: 'Runs the agency: settings, catalogue, automations, reports. No global cash view, no account management.', ar: 'ينظم الوكالة دون أن يرى كامل المالية أو يدير الحسابات.', zh: '负责分社运作，但不查看整体资金，也不管理账号。' } },
  { agencyId: null, code: 'conseiller', position: 30, baseRole: 'agent', grants: [], revokes: [],
    label: { fr: 'Conseiller', en: 'Adviser', ar: 'مستشار', zh: '顾问' },
    description: { fr: 'Suit ses clients de bout en bout.', en: 'Follows their own clients end to end.', ar: 'يتابع حرفاءه من البداية إلى النهاية.', zh: '全程跟进自己的客户。' } },
  { agencyId: null, code: 'verification_pieces', position: 40, baseRole: 'agent', grants: [], revokes: ['payment:write', 'case:create'],
    label: { fr: 'Vérificateur de documents', en: 'Document checker', ar: 'مدقق الوثائق', zh: '材料审核员' },
    description: { fr: 'Valide les pièces. Il n’encaisse pas et n’ouvre pas de dossier.', en: 'Validates documents. Takes no payment and opens no case.', ar: 'يصادق على الوثائق دون أن يقبض أو يفتح ملفات.', zh: '审核材料，不收款、不建档。' } },
  { agencyId: null, code: 'caisse', position: 50, baseRole: 'agent', grants: [], revokes: ['doc:validate', 'case:create'],
    label: { fr: 'Caissier', en: 'Cashier', ar: 'أمين الصندوق', zh: '收银员' },
    description: { fr: 'Encaisse et remet les reçus. Il ne valide pas les pièces.', en: 'Takes payments and issues receipts. Does not validate documents.', ar: 'يقبض ويسلم الوصولات دون المصادقة على الوثائق.', zh: '收款并开具收据，不审核材料。' } },
  { agencyId: null, code: 'creneaux', position: 60, baseRole: 'agent', grants: [], revokes: ['payment:write'],
    label: { fr: 'Chargé de créneaux', en: 'Appointment officer', ar: 'مكلف بالمواعيد', zh: '预约专员' },
    description: { fr: 'Travaille la file de rendez-vous. Il n’encaisse pas.', en: 'Works the appointment queue. Takes no payment.', ar: 'يشتغل على طابور المواعيد ولا يقبض.', zh: '负责预约队列，不收款。' } },
  { agencyId: null, code: 'comptabilite', position: 70, baseRole: 'viewer', grants: ['payment:write', 'finance:global', 'reports:view'], revokes: [],
    label: { fr: 'Comptable', en: 'Accountant', ar: 'محاسب', zh: '会计' },
    description: { fr: 'Voit l’argent et les rapports. Il ne fait pas avancer les dossiers.', en: 'Sees the money and the reports. Does not move cases forward.', ar: 'يرى المال والتقارير دون أن يحرّك الملفات.', zh: '查看资金与报表，不推进案卷。' } },
  { agencyId: null, code: 'coursier', position: 80, baseRole: 'viewer', grants: ['doc:validate'], revokes: [],
    label: { fr: 'Coursier', en: 'Courier', ar: 'ساعي', zh: '跑腿员' },
    description: { fr: 'Dépose et récupère les dossiers, et constate ce qu’il rapporte.', en: 'Drops off and collects files, and records what comes back.', ar: 'يودع الملفات ويسترجعها ويثبت ما يرجع به.', zh: '递交与领取材料，并登记结果。' } },
  { agencyId: null, code: 'lecture', position: 90, baseRole: 'viewer', grants: [], revokes: [],
    label: { fr: 'Lecture seule', en: 'Read only', ar: 'اطلاع فقط', zh: '只读' },
    description: { fr: 'Regarde les dossiers, sans rien pouvoir changer.', en: 'Looks at cases without changing anything.', ar: 'يطّلع على الملفات دون تغيير.', zh: '仅查看案卷，无法更改。' } },
]

export const demoTemplates: JobTemplate[] = DEMO_TEMPLATES.map((t) => ({ ...t, id: `jt_${t.code}` }))

/** Ce que chaque rôle donne, lu dans l'unique matrice du front. On ne recopie
    pas la liste : on la demande à `lib/permissions.ts`, qui fait foi hors ligne. */
export function demoRoles(): Record<Role, string[]> {
  const fake = (role: Role): User => ({
    id: 'x', agencyId: 'x', name: '', email: '', role, officeId: '', locale: 'fr', active: true,
  })
  const of = (role: Role) => ALL_CAPS.filter((c) => can(fake(role), c))
  return { owner: of('owner'), manager: of('manager'), agent: of('agent'), viewer: of('viewer') }
}

export function demoPermissions(): PermissionMeta[] {
  return ALL_CAPS.map((code) => ({
    code,
    domain: CAP_DOMAIN[code].domain,
    label: CAP_LABELS[code],
    sensitive: CAP_DOMAIN[code].sensitive,
  }))
}

/* Les écarts et les dates de la démonstration. Ils sont posés à la main pour
   que la vitrine montre les trois états d'un droit (hérité, ajouté, retiré),
   un compte jamais utilisé et un mot de passe encore provisoire : sans ça, le
   bandeau de tête afficherait des zéros et n'expliquerait rien. */
const DEMO_TWEAKS: Record<string, { overrides?: Override[]; hours?: number | null; temp?: boolean; extra?: number }> = {
  u_slim: { hours: 2 },
  u_amira: { overrides: [{ permission: 'team:invite', granted: false }], hours: 5 },
  u_nizar: { overrides: [{ permission: 'payment:write', granted: false }, { permission: 'case:create', granted: false }], hours: 26 },
  u_rania: { overrides: [{ permission: 'doc:validate', granted: false }, { permission: 'case:create', granted: false }], hours: 3, extra: 1 },
  u_hatem: { hours: 51 },
  u_li: { hours: null, temp: true },
}

function isoHoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString()
}

/**
 * Les capacités d'une personne, recalculées dans le navigateur.
 *
 * CETTE FONCTION NE SERT QU'HORS LIGNE. Quand le serveur répond, c'est lui qui
 * calcule, avec `member_capabilities`, la même fonction que celle qui remplit le
 * jeton. La recopier ici pour « aller plus vite » serait le jour où l'écran
 * afficherait un droit que la base refuse.
 *
 * La formule est celle de la base, mot pour mot : le rôle, plus les ajouts,
 * moins les retraits, et rien du tout pour un compte désactivé.
 */
export function demoCapabilities(role: Role, active: boolean, overrides: Override[], roles: Record<Role, string[]>): string[] {
  if (!active) return []
  const set = new Set(roles[role] ?? [])
  for (const o of overrides) if (o.granted) set.add(o.permission)
  for (const o of overrides) if (!o.granted) set.delete(o.permission)
  return [...set].sort()
}

/**
 * L'équipe du jeu local, présentée comme le serveur la présenterait.
 *
 * Les capacités sont calculées ici, et c'est la SEULE fois : hors ligne, il n'y
 * a pas de serveur pour les donner. La formule est celle de la base, mot pour
 * mot : le rôle, plus les ajouts, moins les retraits, et rien du tout pour un
 * compte désactivé.
 */
export function demoOverview(users: User[], offices: Pick<Office, 'id'>[]): TeamOverview {
  const roles = demoRoles()
  const members: TeamMember[] = users.map((u) => {
    const tweak = DEMO_TWEAKS[u.id] ?? {}
    const overrides = tweak.overrides ?? []
    // Un deuxième bureau pour une personne, pour que la colonne « bureaux » ne
    // soit pas une colonne d'une seule valeur partout.
    const others = tweak.extra ? offices.map((o) => o.id).filter((id) => id !== u.officeId).slice(0, tweak.extra) : []
    return {
      id: u.id, name: u.name, email: u.email, phone: u.phone ?? null, role: u.role,
      officeId: u.officeId, active: u.active,
      mustResetPassword: tweak.temp === true,
      lastSeenAt: tweak.hours == null ? null : isoHoursAgo(tweak.hours),
      offices: [u.officeId, ...others],
      capabilities: demoCapabilities(u.role, u.active, overrides, roles),
      overrides,
    }
  })
  return { members, permissions: demoPermissions(), roles, invitations: [] }
}

export { HAS_BACKEND }
