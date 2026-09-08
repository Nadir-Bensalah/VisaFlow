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

/** Le troisieme axe de la liste de pieces. Une checklist « France » n'existe
    pas : il faut France + salarie, France + etudiant, France + retraite.
    Les pieces de revenu et d'autorisation parentale changent completement. */
export type ProfessionalStatus =
  | 'salarie'
  | 'independant'
  | 'fonctionnaire'
  | 'etudiant'
  | 'retraite'
  | 'sans_emploi'
  | 'mineur'

/** Premiere demande ou deja vise. Ni les memes pieces, ni les memes delais,
    ni le meme taux de refus. */
export type Track = 'primo' | 'vise'

/** Motifs de refus, liste fermee. Un champ libre ne produit aucune
    statistique : c'est le code qui permet de dire « nos refus viennent a 60 %
    de la volonte de sortie non etablie ». Repris des motifs du code des visas. */
export type RefusalCode =
  | 'document_faux'
  | 'objet_non_justifie'
  | 'moyens_insuffisants'
  | 'sejours_epuises'
  | 'signalement'
  | 'ordre_public'
  | 'assurance_absente'
  | 'justificatifs_non_fiables'
  | 'sortie_non_etablie'
  | 'autre'

/** Ou le dossier se depose reellement. Il n'y a que deux centres TLScontact
    pour toute la Tunisie, et c'est la que se joue la rarete. */
export type DepositCentre = 'tls_tunis' | 'tls_sfax' | 'vfs_tunis' | 'consulat' | 'autre'

/** Ce qu'un agent a obtenu en essayant de prendre un creneau. */
export type AttemptResult = 'aucun_creneau' | 'creneau_pris' | 'site_indisponible' | 'compte_bloque' | 'erreur'

export type QueueStatus = 'attente' | 'servi' | 'abandonne'

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

/** Ce que l'agence vend. Une agence de visas seule ne doit pas voir le fret. */
export type Service = 'visas' | 'fret'

/** Le raccordement WhatsApp d'une agence.
    Le jeton d'accès n'est PAS ici, et ne doit jamais y être : il vit dans le
    coffre Supabase, et on n'en garde que le nom. Une table lisible qui
    contiendrait le jeton permettrait d'écrire au nom de l'agence de partout. */
export interface WhatsAppAccount {
  phoneNumberId: string
  wabaId?: string
  displayNumber?: string
  tokenSecret: string
  verifyToken: string
  active: boolean
  linkedAt?: string
  lastError?: string
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
  whatsapp?: WhatsAppAccount
  plan: 'essai' | 'standard' | 'multi_bureaux'
  services: Service[]
  /** Fin de l'essai. Passe ce jour, l'agence doit choisir une formule. */
  trialEndsAt?: string
  createdAt: string
  /** Etapes d'installation deja faites, pour l'ecran du premier jour. */
  setupDone: string[]
  setupHidden?: boolean

  /* ---- Ce que le droit tunisien impose de déclarer ---- */
  /** Matricule fiscal, mention obligatoire de toute facture. */
  taxId?: string
  /** Registre de commerce et tribunal, article 25 de la loi 91-64. */
  rcNumber?: string
  rcCourt?: string
  legalForm?: string
  capital?: number
  /**
   * A ou B. Une agence B ne peut ni organiser de circuit, ni faire de la
   * réception, NI DE L'OMRA. La catégorie C n'existe pas.
   */
  licenseCategory?: 'A' | 'B'
  licenseNumber?: string
  /**
   * Adhésion EFFECTIVE au réseau TTN. Tant qu'elle est fausse, la facture
   * papier reste régulière : l'obligation du 1er janvier 2026 ne vise que les
   * adhérents, pas ceux qui ont seulement déposé leur demande.
   */
  ttnMember?: boolean
  ttnRef?: string
  /**
   * Politique de remboursement en cas de refus de visa, DÉCLARÉE PAR L'AGENCE.
   * Aucune valeur par défaut : aucun texte tunisien ne la fixe, et en inventer
   * une la rendrait opposable à l'agence à sa place.
   */
  refundPolicy?: I18nText
  /** Dernier changement de siège ou de représentant : à déclarer sous 30 jours. */
  onttChangeAt?: string
  /** Dernier dépôt d'états financiers : à refaire sous 3 mois. */
  onttFinancialsAt?: string
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

/** Une demande arrivee de la page publique de l'agence.
    Elle n'est pas encore un dossier : personne n'a decide de la prendre. */
export type RequestStatus = 'nouvelle' | 'qualifiee' | 'convertie' | 'ecartee'

export interface ClientRequest {
  id: string
  agencyId: string
  reference: string
  kind: 'visa' | 'fret'
  /** Ce que le demandeur a choisi dans le catalogue de l'agence. */
  visaTypeId?: string
  destination?: string
  travelDate?: string
  goods?: string
  originCity?: string
  firstName: string
  lastName: string
  phone: string
  email?: string
  locale: Locale
  note?: string
  /** Le numero a ete confirme par un code a usage unique. */
  phoneVerified: boolean
  status: RequestStatus
  receivedAt: string
  handledBy?: string
  handledAt?: string
  refusalReason?: string
  clientId?: string
  caseId?: string
  portalToken: string
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
  /** Le troisieme axe de la liste de pieces. Sans lui, la checklist est fausse
      des le premier dossier reel. */
  professionalStatus?: ProfessionalStatus
  employer?: string
  /** Date de prise des empreintes. Elles restent valables 59 mois : un client
      encore couvert n'a pas a se deplacer, ce qui change le prix, le delai et
      le besoin de creneau. */
  biometricsAt?: string
  /** Le numero est l'identite du client dans cette agence, et nulle part
      ailleurs. Verifie une fois, il ouvre le suivi sur n'importe quel appareil. */
  phoneVerifiedAt?: string
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

/** Le poste ou le dossier part vraiment.
    Le taux de refus est une propriete du consulat, pas du pays : 15,4 % chez
    la France et 46,3 % chez la Tchequie sur le meme terrain la meme annee.
    Une moyenne nationale affichee dans un logiciel ment a l'agence. */
export interface Consulate {
  id: string
  agencyId: string
  countryCode: string
  country: I18nText
  /** Ville de representation : Tunis, Le Caire. */
  city: string
  centre: DepositCentre
  /** Presque toujours faux. Le rendre obligatoire eliminerait la clientele
      libyenne : en 2015, 530 Libyens seulement avaient une carte de sejour
      tunisienne, alors que la France, l'Autriche et la Suisse instruisent
      officiellement leurs dossiers depuis Tunis. */
  requiresResidence: boolean
  feeConsulate: number
  currency: string
  /** Delai de recours apres refus, en jours. Les sources se contredisent
      (30 jours contre 2 mois) : c'est un parametre, jamais une constante. */
  appealDays?: number
  appealSource?: string
  appealCheckedAt?: string
  /** Reference officielle publiee par la Commission europeenne, par consulat.
      Sert a comparer le resultat de l'agence a celui du poste. */
  refYear?: number
  refRefusalRate?: number
  refMultiEntryShare?: number
  /** Delai annonce par le poste, en jours. Le delai reel se mesure. */
  announcedDays?: number
  notes?: string
  active: boolean
}

/** La file d'attente de creneau.
    C'est le vrai produit. Sur un ticket d'environ 550 dinars, 200 a 350
    viennent de l'obtention du rendez-vous, et aucun logiciel tunisien ne sait
    dire a un client « vous etes 4e sur la liste Italie ». */
export interface QueueEntry {
  id: string
  agencyId: string
  caseId: string
  consulateId: string
  joinedAt: string
  /** Remonte l'entree dans la file a rang egal d'anciennete. */
  priority: Priority
  status: QueueStatus
  servedAt?: string
  servedBy?: string
  /** Le rendez-vous cree quand la file a ete servie. */
  appointmentId?: string
  leftAt?: string
  note?: string
}

/** Chaque essai de prise de creneau, reussi ou non.
    C'est le travail reel de l'agent, aujourd'hui totalement invisible : il
    ouvre le site, il n'y a rien, il recommence une heure plus tard. */
export interface SlotAttempt {
  id: string
  agencyId: string
  consulateId: string
  /** Une tentative peut viser un dossier precis, ou balayer la file entiere. */
  caseId?: string
  at: string
  byId: string
  centre: DepositCentre
  result: AttemptResult
  /** Date du creneau decroche, quand il y en a un. */
  slotAt?: string
  note?: string
}

/** La garde d'un passeport original. C'est le bien le plus précieux du client
    et le risque juridique numéro un de l'agence : le remplacer coûte vingt
    fois sa délivrance. Le registre dit qui a déposé, quand, où il est, et
    bloque la restitution tant que le solde n'est pas réglé. */
export interface PassportCustody {
  id: string
  agencyId: string
  clientId: string
  caseId?: string
  passportNumber: string
  receivedAt: string
  receivedBy?: string
  location?: string
  locationNote?: string
  returnedAt?: string
  returnedBy?: string
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
  /** Clé opaque du fichier déposé. Jamais le nom d'origine : deux clients
      déposent deux « passeport.pdf », et un nom d'origine contient parfois
      n'importe quoi. */
  fileKey?: string
  fileSize?: number
  fileType?: string
  uploadedAt?: string
  /** Qui a déposé : un employé, ou le client depuis son portail. */
  uploadedBy?: string
  reminders: number
  lastReminderAt?: string
}

/** Une note interne, datee et signee. Elle ne remplace jamais la precedente. */
export interface CaseNote {
  id: string
  at: string
  authorId?: string
  text: string
  /** Une note posee en un clic quand le client appelle. */
  kind: 'note' | 'appel' | 'comptoir'
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
  /** Le poste, pas seulement le pays. C'est lui qui porte le taux de refus. */
  consulateId?: string
  track?: Track
  decisionAt?: string
  /** Code ferme. Le texte libre ne produit aucune statistique exploitable. */
  refusalCode?: RefusalCode
  refusalReason?: string
  /** Echeance calculee depuis le delai de recours du consulat. */
  appealDueAt?: string
  appealFiledAt?: string
  amountTotal: number
  amountPaid: number
  notes: CaseNote[]
  /** Jeton du lien de suivi client, sans mot de passe. */
  portalToken: string
}

export interface Message {
  id: string
  agencyId: string
  caseId?: string
  shipmentId?: string
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
  caseId?: string
  shipmentId?: string
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
  caseId?: string
  shipmentId?: string
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
  | 'creneau_attente'
  | 'creneau_obtenu'
  | 'creneau_tentative'
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
/** Les onze règles Incoterms 2020. Les quatre dernières sont réservées à la
    mer et aux voies navigables : un « FOB Shanghai » sur un vol n'a aucun
    sens, il n'y a pas de navire, donc pas de point de transfert.
    En groupage, la règle correcte est FCA au CFS, jamais FOB. */
export type Incoterm =
  | 'EXW' | 'FCA' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP'
  | 'FAS' | 'FOB' | 'CFR' | 'CIF'

/** Celles qui n'ont de sens que sur l'eau. */
export const SEA_ONLY_INCOTERMS: Incoterm[] = ['FAS', 'FOB', 'CFR', 'CIF']

export interface ShipmentDocument {
  id: string
  shipmentId: string
  key: string
  label: I18nText
  state: DocState
  required: boolean
  fileName?: string
  fileKey?: string
  fileSize?: number
  fileType?: string
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
  /**
   * Commodité d'affichage pour une cargaison à un seul client. En base ce champ
   * N'EXISTE PAS : une cargaison porte plusieurs clients, chacun par son lot.
   * Un modèle à un client par cargaison rate la moitié du métier, et le croire
   * faisait planter la fiche dès qu'on la branchait sur de vraies données.
   */
  clientId?: string
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
  /** Le transporteur et le manutentionnaire : deux facturiers différents. */
  carrier?: string
  handler?: string
  containersCount?: number
  containerType?: ContainerType
  /* Les jalons qui font partir les trois compteurs. Ils ne se valent pas :
     un seul « arrivé » ne permet de calculer aucun des trois correctement. */
  arrivedAt?: string
  /** Déchargement du navire : départ des jours francs de surestaries. */
  dischargedAt?: string
  /** Sortie du conteneur du terminal : arrête les surestaries, lance la détention. */
  gateOutAt?: string
  /** Restitution du conteneur vide : arrête la détention. */
  containerReturnedAt?: string
  /** Enlèvement de la marchandise : arrête le magasinage. */
  goodsRemovedAt?: string
  /** Dépotage du conteneur : éteint la solidarité entre lots. */
  strippedAt?: string
}


// ------------------------------------------------------------------
// Le fret réel : tronçons, compteurs, connaissements, douane
// ------------------------------------------------------------------

/**
 * Un lot par client dans une cargaison groupée. Le vrai LCL, ce n'est pas une
 * cargaison pour un client : c'est un conteneur avec quinze clients dedans,
 * chacun ses cartons, sa facture et son dédouanement.
 */
export interface ShipmentLot {
  id: string
  agencyId: string
  shipmentId: string
  clientId: string
  marks?: string
  goods?: I18nText
  packages?: number
  weightKg?: number
  volumeCbm?: number
  declaredValue?: number
  declaredCurrency?: string
  clearedAt?: string
  deliveredAt?: string
  /** Libération du lot à son client. Distinct du dépotage du conteneur. */
  releasedAt?: string
  blockedReason?: string
  blockedSince?: string
  portalToken?: string
  note?: string
}

export type LegMode = 'maritime' | 'aerien' | 'routier' | 'ferroviaire'

/**
 * Un tronçon de transport. Une expédition Chine vers Radès en compte au moins
 * deux : le tirant d'eau de Radès (-8,8 m) interdit toute ligne directe depuis
 * l'Asie. L'attente au hub se déduit de l'écart entre deux tronçons, et c'est
 * là que se produit le retard le plus fréquent.
 */
export interface ShipmentLeg {
  id: string
  agencyId: string
  shipmentId: string
  seq: number
  mode: LegMode
  fromPlace: string
  fromCode?: string
  toPlace: string
  toCode?: string
  carrier?: string
  /** Le navire, le numéro de vol, l'immatriculation : le mode dit ce que c'est. */
  conveyance?: string
  voyage?: string
  etd?: string
  eta?: string
  atd?: string
  ata?: string
  note?: string
}

export type CounterKind = 'surestaries' | 'detention' | 'magasinage'
export type ContainerType = '20' | '40' | '40HC' | '45HC' | 'LCL'

/** Un palier de tarif journalier. Le tarif monte à partir du 3e ou 4e jour. */
export interface DemurrageTier {
  fromDay: number
  toDay: number | null
  rate: number
}

/**
 * Un barème de stationnement, SAISI par l'agence. Aucune valeur par défaut
 * n'est livrée : les barèmes tunisiens ne sont pas publics.
 */
export interface DemurrageTariff {
  id: string
  agencyId: string
  kind: CounterKind
  /** L'armateur pour surestaries et détention, le manutentionnaire pour le magasinage. */
  billedBy: string
  port: string
  containerType: ContainerType
  freeDays: number
  currency: string
  tiers: DemurrageTier[]
  surchargePct: number
  validFrom: string
  validTo?: string
  note?: string
}

export type BlKind = 'master' | 'house'
export type BlRelease = 'original_endosse' | 'telex_release' | 'express_release'

/**
 * Deux connaissements, jamais un. Le Master est émis par l'armateur au nom du
 * groupeur, le House par le groupeur au client final. L'importateur n'a JAMAIS
 * le Master : le lui promettre est une faute.
 */
export interface BillOfLading {
  id: string
  agencyId: string
  shipmentId: string
  kind: BlKind
  /** Un House descend d'un Master. Un Master ne descend de rien. */
  parentId?: string
  lotId?: string
  number: string
  issuer?: string
  shipper?: string
  consignee?: string
  notify?: string
  issuedAt?: string
  releaseType?: BlRelease
  releasedAt?: string
  freightTerms?: 'prepaid' | 'collect'
  note?: string
}

/** Ce qui s'ajoute à la valeur transactionnelle. Liste limitative, article 30. */
export type AdditionCode =
  | 'commissions_vente'
  | 'contenants_emballages'
  | 'apports_materiels'
  | 'apports_intellectuels_hors_tn'
  | 'redevances_licences'
  | 'produit_revente'
  | 'transport_assurance_jusqu_introduction'

/** Ce qui se retranche. Liste limitative, article 31. */
export type DeductionCode =
  | 'transport_assurance_apres_import'
  | 'montage_assistance'
  | 'droits_reproduction'
  | 'commissions_achat'
  | 'droits_taxes_tn'
  | 'cout_donnees_logiciel'

export interface CustomsValueElement {
  code: AdditionCode | DeductionCode
  amount: number
  /**
   * Article 31, la règle absolue : un élément retranchable qui n'est pas
   * facturé distinctement n'est PAS retranché.
   */
  invoicedSeparately?: boolean
}

export interface CustomsOtherTax {
  code: string
  label?: string
  amount: number
}

export type CustomsStatus =
  | 'brouillon' | 'deposee' | 'enregistree' | 'liquidee' | 'payee' | 'annulee'

export interface CustomsDeclaration {
  id: string
  agencyId: string
  shipmentId: string
  lotId?: string
  number?: string
  regime?: string
  brokerName?: string
  /** Sept chiffres plus une lettre de contrôle. */
  brokerCode?: string
  office?: string
  registeredOn?: string
  /** Article 33 : le taux du jour d'ENREGISTREMENT, pas celui de la facture. */
  fxRate: number
  currency: string
  /** Faux = lettre M : l'assiette TVA est majorée de 25 %. */
  vatRegistered: boolean
  /** Code 480 : avance sur impôt de 10 %. */
  airApplicable: boolean
  circuit?: 'vert' | 'orange' | 'rouge'
  status: CustomsStatus
  note?: string
}

export interface CustomsArticle {
  id: string
  agencyId: string
  declarationId: string
  lineNo: number
  /** Case 39 : 6 SH + 2 NC + 1 national + 1 NGP, plus une clé. */
  ndp?: string
  designation: string
  /** Case 32. C'est elle qui commande le régime tarifaire. */
  originCountry?: string
  /** Case 42/2. Les codes 404 et 971 sont interdits hors origine préférentielle. */
  preferentialCode?: string
  quantity?: number
  invoiceValue: number
  /** L = libre, P = exclu du régime de liberté, autorisation d'importation obligatoire. */
  ccecTitle?: 'L' | 'P'
  mp5?: boolean
  additions: CustomsValueElement[]
  deductions: CustomsValueElement[]
  /** En pourcentage : 19 pour 19 %. Dépendent de la position, jamais livrés. */
  ddRate?: number
  dcRate?: number
  fodecRate?: number
  tvaRate?: number
  /** Série 0xx : elles entrent dans l'assiette de la TVA. */
  taxes0xx: CustomsOtherTax[]
  /** Sectorielles : dans la somme des droits, PAS dans l'assiette TVA. */
  taxesSector: CustomsOtherTax[]
}

export type TceForm =
  | 'autorisation_importation' | 'facture_commerciale' | 'admission_temporaire'
  | 'facture_definitive_export' | 'autorisation_exportation'

/**
 * Le titre de commerce extérieur. Sans lui domicilié : pas de dédouanement, et
 * surtout pas de transfert de devises au fournisseur.
 */
export interface TceTitle {
  id: string
  agencyId: string
  shipmentId?: string
  lotId?: string
  form: TceForm
  number?: string
  bank?: string
  domiciledOn?: string
  designation?: string
  amount?: number
  currency?: string
  quantity?: number
  divisible?: boolean
  status: 'a_domicilier' | 'domicilie' | 'impute' | 'annule'
  note?: string
}

/**
 * Un séjour dans l'espace Schengen. Le jour d'entrée ET le jour de sortie
 * comptent tous les deux dans le quota de 90 jours.
 */
export interface SchengenStay {
  id: string
  agencyId: string
  clientId: string
  entryDate: string
  /** Absente = le client est encore à l'intérieur. */
  exitDate?: string
  country?: string
  /** D'où vient la date : un compteur qui ne le dit pas ne tient pas devant une contestation. */
  source: 'declare' | 'tampon' | 'ees' | 'agence'
  note?: string
}

/** Etat complet du magasin, un seul objet serialisable. */
export interface Database {
  version: number
  agency: Agency
  users: User[]
  clients: Client[]
  visaTypes: VisaType[]
  consulates: Consulate[]
  checklists: ChecklistTemplate[]
  cases: VisaCase[]
  documents: CaseDocument[]
  custody: PassportCustody[]
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
  requests: ClientRequest[]
  queue: QueueEntry[]
  attempts: SlotAttempt[]
  /** Le fret réel : un conteneur porte plusieurs clients, et plusieurs tronçons. */
  lots: ShipmentLot[]
  legs: ShipmentLeg[]
  tariffs: DemurrageTariff[]
  bls: BillOfLading[]
  declarations: CustomsDeclaration[]
  customsArticles: CustomsArticle[]
  tce: TceTitle[]
  /** Les séjours, pour le compteur 90 jours sur 180. */
  stays: SchengenStay[]
}
