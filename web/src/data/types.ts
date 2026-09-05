/* Modele de donnees VisaFlow.
   Une seule source de verite : ce fichier est aussi le contrat du futur
   schema Supabase (voir docs/08-supabase-schema.sql). */

export type Locale = 'fr' | 'en' | 'ar' | 'zh'

/** Chaine traduite. Le francais est toujours present, le reste est optionnel. */
export type I18nText = { fr: string } & Partial<Record<Locale, string>>

export type Role = 'owner' | 'manager' | 'agent' | 'viewer'

export type Stage =
  | 'nouveau'
  | 'pieces'
  | 'verification'
  | 'rendez_vous'
  | 'depot'
  | 'consulat'
  | 'decision'
  | 'retrait'
  | 'clos'

export type CaseStatus = 'ouvert' | 'accepte' | 'refuse' | 'annule'
export type Priority = 'basse' | 'normale' | 'haute' | 'urgente'

export type DocState =
  | 'manquante'
  | 'demandee'
  | 'recue'
  | 'validee'
  | 'refusee'
  | 'expiree'

export type Channel = 'whatsapp' | 'email' | 'sms' | 'portail' | 'interne'
export type MessageStatus = 'file' | 'envoye' | 'remis' | 'lu' | 'echec'
export type PaymentState = 'du' | 'partiel' | 'regle' | 'rembourse'
export type PaymentMethod = 'especes' | 'virement' | 'carte' | 'cheque'
export type AppointmentKind = 'agence' | 'consulat' | 'biometrie' | 'retrait'
export type AppointmentStatus = 'prevu' | 'fait' | 'manque' | 'reporte'
export type CaseSource = 'comptoir' | 'whatsapp' | 'site' | 'recommandation' | 'partenaire'

/* ------------------------------------------------------------------ */

export interface Office {
  id: string
  name: string
  city: string
  country: string
  countryCode: string
  phone: string
  address: string
  timezone: string
}

export interface Agency {
  id: string
  /** Sous domaine : tca.visaflow.app */
  slug: string
  name: string
  legalName: string
  mark: string
  accent: string
  email: string
  phone: string
  website: string
  locales: Locale[]
  defaultLocale: Locale
  currency: string
  offices: Office[]
  /** Numero de declaration INPDP, affiche dans le pied du portail client. */
  inpdpRef?: string
  plan: 'essai' | 'standard' | 'multi_bureaux'
}

export interface User {
  id: string
  agencyId: string
  name: string
  email: string
  phone?: string
  role: Role
  officeId: string
  locale: Locale
  active: boolean
}

export interface Client {
  id: string
  agencyId: string
  firstName: string
  lastName: string
  nativeName?: string
  email?: string
  phone: string
  whatsapp?: string
  nationality: string
  passportNumber?: string
  passportExpiry?: string
  birthDate?: string
  address?: string
  locale: Locale
  tags: string[]
  createdAt: string
  officeId: string
}

export interface ChecklistItem {
  key: string
  label: I18nText
  help?: I18nText
  required: boolean
  /** Duree de validite de la piece en jours (releve bancaire de moins de 3 mois). */
  validityDays?: number
}

export interface ChecklistTemplate {
  id: string
  agencyId: string
  name: I18nText
  items: ChecklistItem[]
}

export interface VisaType {
  id: string
  agencyId: string
  countryCode: string
  country: I18nText
  label: I18nText
  category: 'tourisme' | 'affaires' | 'etudes' | 'travail' | 'transit' | 'famille'
  processingDays: number
  feeAgency: number
  feeConsulate: number
  checklistId: string
  active: boolean
  /** Etapes reellement utilisees pour ce visa, dans l'ordre. */
  stages: Stage[]
}

export interface CaseDocument {
  id: string
  caseId: string
  key: string
  label: I18nText
  state: DocState
  required: boolean
  requestedAt?: string
  receivedAt?: string
  validatedAt?: string
  validatedBy?: string
  rejectionReason?: string
  expiresAt?: string
  fileName?: string
  reminders: number
  lastReminderAt?: string
}

export interface VisaCase {
  id: string
  agencyId: string
  reference: string
  clientId: string
  visaTypeId: string
  officeId: string
  assigneeId: string
  stage: Stage
  status: CaseStatus
  priority: Priority
  source: CaseSource
  openedAt: string
  updatedAt: string
  /** Date de depart souhaitee. C'est elle qui fabrique l'urgence. */
  travelDate?: string
  dueAt?: string
  consulateRef?: string
  decisionAt?: string
  refusalReason?: string
  amountTotal: number
  amountPaid: number
  notes?: string
  /** Jeton du lien de suivi client, sans mot de passe. */
  portalToken: string
}

export interface Message {
  id: string
  agencyId: string
  caseId: string
  channel: Channel
  direction: 'entrant' | 'sortant'
  body: string
  locale: Locale
  authorId?: string
  templateKey?: string
  at: string
  status: MessageStatus
  automated: boolean
}

export interface MessageTemplate {
  id: string
  agencyId: string
  key: string
  name: I18nText
  channel: Channel
  body: Record<Locale, string>
  variables: string[]
}

export interface Appointment {
  id: string
  agencyId: string
  caseId: string
  kind: AppointmentKind
  at: string
  durationMin: number
  location: string
  status: AppointmentStatus
  notes?: string
}

export interface Payment {
  id: string
  agencyId: string
  caseId: string
  label: I18nText
  amount: number
  state: PaymentState
  method?: PaymentMethod
  at?: string
  dueAt?: string
  receiptNo?: string
}

export type TriggerType =
  | 'piece_manquante_depuis'
  | 'dossier_sans_activite'
  | 'rendez_vous_dans'
  | 'passeport_expire_dans'
  | 'depart_dans'
  | 'solde_impaye_depuis'
  | 'etape_atteinte'

export type ActionType = 'message_client' | 'tache_agent' | 'alerte_interne' | 'changer_etape'

export interface AutomationRule {
  id: string
  agencyId: string
  name: I18nText
  trigger: { type: TriggerType; days?: number; stage?: Stage }
  action: { type: ActionType; templateKey?: string; channel?: Channel; stage?: Stage; text?: I18nText }
  active: boolean
  runs: number
  lastRunAt?: string
}

export type EventType =
  | 'dossier_cree'
  | 'etape_changee'
  | 'piece_demandee'
  | 'piece_recue'
  | 'piece_validee'
  | 'piece_refusee'
  | 'message_envoye'
  | 'message_recu'
  | 'rendez_vous_cree'
  | 'paiement_encaisse'
  | 'decision_recue'
  | 'note_ajoutee'
  | 'automatisation'
  | 'connexion_portail'

export interface ActivityEvent {
  id: string
  agencyId: string
  caseId?: string
  clientId?: string
  actorId?: string
  type: EventType
  at: string
  detail: I18nText
  automated: boolean
}

export interface Task {
  id: string
  agencyId: string
  caseId?: string
  assigneeId: string
  title: I18nText
  dueAt: string
  done: boolean
  createdAt: string
  automated: boolean
}


/* ------------------------------------------------------------------ */
/* Cargaisons : Chine vers Tunisie et Libye                            */
/* ------------------------------------------------------------------ */

export type ShipmentMode = 'maritime_fcl' | 'maritime_lcl' | 'aerien' | 'routier'

export type ShipmentStage =
  | 'demande'
  | 'ramassage'
  | 'entrepot'
  | 'empotage'
  | 'depart'
  | 'transit'
  | 'arrivee'
  | 'douane'
  | 'livraison'
  | 'livre'

export type ShipmentStatus = 'en_cours' | 'livree' | 'bloquee' | 'annulee'
export type Incoterm = 'EXW' | 'FOB' | 'CFR' | 'CIF' | 'DAP' | 'DDP'

export interface ShipmentDocument {
  id: string
  shipmentId: string
  key: string
  label: I18nText
  state: DocState
  required: boolean
  fileName?: string
  receivedAt?: string
  reminders: number
}

export interface ShipmentEvent {
  id: string
  shipmentId: string
  stage: ShipmentStage
  at: string
  location: string
  note?: I18nText
}

export interface Shipment {
  id: string
  agencyId: string
  reference: string
  clientId: string
  /** Dossier de visa du meme client, quand il y en a un. */
  caseId?: string
  mode: ShipmentMode
  supplier: string
  goods: I18nText
  originCity: string
  originPort: string
  destCity: string
  destPort: string
  countryFrom: string
  countryTo: string
  incoterm: Incoterm
  containerNo?: string
  blNumber?: string
  packages: number
  weightKg: number
  volumeCbm: number
  declaredValue: number
  freightCost: number
  customsDuty?: number
  amountPaid: number
  stage: ShipmentStage
  status: ShipmentStatus
  etd?: string
  eta?: string
  deliveredAt?: string
  assigneeId: string
  officeId: string
  portalToken: string
  notes?: string
}

/** Etat complet du magasin, un seul objet serialisable. */
export interface Database {
  version: number
  agency: Agency
  users: User[]
  clients: Client[]
  visaTypes: VisaType[]
  checklists: ChecklistTemplate[]
  cases: VisaCase[]
  documents: CaseDocument[]
  messages: Message[]
  templates: MessageTemplate[]
  appointments: Appointment[]
  payments: Payment[]
  rules: AutomationRule[]
  events: ActivityEvent[]
  tasks: Task[]
  shipments: Shipment[]
  shipmentDocs: ShipmentDocument[]
  shipmentEvents: ShipmentEvent[]
}
