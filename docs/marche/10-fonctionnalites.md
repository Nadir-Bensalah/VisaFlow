# La liste des fonctionnalités

Tirée de l'étude de marché. Chaque ligne dit pourquoi elle existe et d'où elle vient.

Statut : **[F]** fait · **[P]** partiel, existe mais incomplet · **[À]** à faire.

---

## A. Le socle multi-agences

| # | Fonctionnalité | Statut | Pourquoi |
|---|---|---|---|
| A1 | Sous-domaine par agence, résolution du locataire | **[F]** | Modèle Converty, chaque agence a son adresse |
| A2 | Inscription autonome d'une agence, provisionnement complet | **[F]** | Sans self-service, pas de SaaS |
| A3 | Catalogue de démarrage pré-rempli à la création | **[F]** | Une agence vide décourage |
| A4 | Bureaux multiples par agence (Tunis, Tripoli, Guangzhou) | **[F]** | Le cas réel de TCA |
| A5 | Cloisonnement des données par bureau | **[F]** | Guangzhou n'a rien à voir sur les dossiers de Tunis |
| A6 | Rôles propriétaire, gérant, agent, lecteur | **[F]** | |
| A7 | **Le chiffre d'affaires n'est visible que du propriétaire** | **[F]** | Demande explicite. Protection au niveau colonne, pas seulement écran |
| A8 | Isolation réelle en base (RLS par opération) | **[F]** | Une isolation seulement côté écran n'est pas une isolation |
| A9 | Journal d'activité en ajout seul | **[F]** | Un journal effaçable ne prouve rien |
| A10 | CRUD complet de l'équipe dans les réglages | **[F]** | Manquait au premier tour |
| A11 | Modèle de commission de l'éditeur par dossier | **[À]** | La rémunération du projet |
| A12 | Facturation de l'abonnement **à l'année**, sur facture | **[À]** | Pas de prélèvement récurrent par carte en Tunisie |
| A13 | Émission au format **TTN** (facture électronique) | **[À]** | Obligatoire pour tous les prestataires de services depuis le 1er janvier 2026 |
| A14 | Bandeau d'alerte réglementaire poussé par l'éditeur | **[À]** | Fermeture de poste, changement de règle consulaire, dévaluation. La raison de payer |

## B. Le client, et son identification sans compte

| # | Fonctionnalité | Statut | Pourquoi |
|---|---|---|---|
| B1 | Identité par téléphone, pas par e-mail | **[F]** | Le client type n'a pas d'adresse e-mail active |
| B2 | Code à usage unique, appareil retenu 90 jours | **[F]** | Trois niveaux : lien direct, code, guichet |
| B3 | Lien de suivi opaque, non énumérable | **[F]** | Une référence séquentielle ouvrait n'importe quel dossier. Retiré |
| B4 | Limitation de débit sur l'envoi de codes | **[F]** | |
| B5 | **Nom en arabe comme donnée de référence, versions latines comme variantes** | **[À]** | Problème reconnu au niveau des États dans l'accord frontalier de juin 2024 |
| B6 | Rapprochement par numéro de passeport plus date de naissance, jamais par nom | **[À]** | Le nom n'est pas une clé fiable |
| B7 | Détection de doublon client à la saisie | **[À]** | Le même client revient sous trois orthographes |
| B8 | Groupe familial, dossiers liés | **[F]** | Une famille de cinq est un seul acte commercial |
| B9 | **Le justificatif de résidence est optionnel et dépend du consulat** | **[À]** | 530 Libyens seulement avaient une carte de séjour tunisienne. Le rendre obligatoire élimine tout le marché libyen |
| B10 | Consentement au traitement, horodaté, révocable, exportable | **[F]** | Loi 2004-63, et transfert hors Tunisie |
| B11 | Fiche client éditable par l'employé de guichet | **[F]** | Bloquant relevé au premier tour |

## C. Le dossier de visa

| # | Fonctionnalité | Statut | Pourquoi |
|---|---|---|---|
| C1 | Étapes configurables par agence | **[F]** | |
| C2 | **Checklist par couple (consulat, statut professionnel)** | **[P]** | Une checklist « France » n'existe pas. Il faut France+salarié, France+indépendant, France+étudiant, France+retraité, France+sans emploi, France+mineur |
| C3 | Versionnage des checklists | **[F]** | Un dossier ouvert avant un changement de règle garde son ancienne liste |
| C4 | Reprise après refus, rattachée au dossier d'origine | **[F]** | Le retry est un acte commercial distinct |
| C5 | **Catégorie PRIMO ou VISE** | **[À]** | Pièces, délais et taux de refus différents |
| C6 | **Biométrie : date de prise, validité 59 mois, alerte d'expiration** | **[À]** | Une biométrie valide dispense du déplacement. Change le prix, le délai et le créneau |
| C7 | **Compteur 90 jours sur 180** par client | **[À]** | Avec l'EES au 10 avril 2026, c'est la question client la plus fréquente. Personne ne l'offre en Tunisie |
| C8 | Motif de refus codé, pas en texte libre | **[À]** | Sans code, aucune statistique de refus exploitable |
| C9 | **Recours CRRV : délai en paramètre par consulat, avec source et date de vérification** | **[À]** | Les sources se contredisent, 30 jours contre 2 mois. Ne pas coder en dur |
| C10 | Journal de notes horodaté et attribué | **[F]** | Un champ notes unique s'écrasait |
| C11 | Registre de garde des passeports, avec blocage de restitution sur solde impayé | **[F]** | Remplacer un passeport libyen coûte vingt fois sa délivrance |
| C12 | Journal d'accès aux pièces : qui a ouvert quoi, quand | **[F]** | Conformité, et seul moyen de tracer une fuite |
| C13 | Purge automatique par politique de rétention et par type de pièce | **[F]** | Un passeport scanné n'a pas la durée de vie d'une facture |
| C14 | **Téléversement réel des pièces** | **[À]** | Les seaux et les règles existent, l'interface de dépôt non |
| C15 | **Contrôle automatique de la pièce déposée** (lisibilité, format, taille, expiration du document) | **[À]** | Une pièce refusée par le consulat est un dossier perdu et un client furieux |

## D. Le rendez-vous, le vrai produit

C'est le module qui porte l'essentiel de la marge. Il est aujourd'hui le plus faible.

| # | Fonctionnalité | Statut | Pourquoi |
|---|---|---|---|
| D1 | Rendez-vous rattaché à un dossier | **[F]** | |
| D2 | **File d'attente de créneaux par consulat** | **[À]** | Sur un ticket de 550 TND, 200 à 350 TND viennent de l'obtention du rendez-vous |
| D3 | **Rang du client dans la file, visible du client** | **[À]** | « Vous êtes 4e sur la liste Italie ». Une agence qui ne sait pas le dire perd le client |
| D4 | Priorité de file paramétrable (ancienneté, urgence, prix payé) | **[À]** | |
| D5 | **Registre des tentatives de prise de créneau** : qui a essayé, quand, sur quel centre, résultat | **[À]** | C'est le travail réel de l'agent, aujourd'hui invisible |
| D6 | Capacité et fenêtre d'ouverture par centre (Tunis, Sfax) | **[À]** | Deux centres seulement pour tout le pays |
| D7 | Alerte de créneau libéré | **[À]** | C'est le produit entier de tls-visa.com |
| D8 | Délai moyen d'obtention par consulat, calculé sur l'historique de l'agence | **[À]** | Permet enfin de répondre honnêtement « combien de temps » |
| D9 | Rappel automatique au client avant le rendez-vous | **[P]** | Existe via les automatisations, pas spécialisé |
| D10 | Absence au rendez-vous tracée, avec conséquence commerciale | **[À]** | Un créneau perdu coûte à l'agence |

## E. Les statistiques qui n'existent nulle part ailleurs

| # | Fonctionnalité | Statut | Pourquoi |
|---|---|---|---|
| E1 | **Taux de refus par couple (consulat, type de visa, profil)** | **[À]** | La moyenne nationale ment. Tchéquie 46,3 %, France 15,4 % |
| E2 | Part de multi-entrées obtenues par consulat | **[À]** | Varie de 12,6 % à 99,1 % selon le poste |
| E3 | Délai réel de traitement par consulat, mesuré | **[À]** | |
| E4 | Comparaison de l'agence à la moyenne nationale officielle | **[À]** | Données publiques de la Commission européenne, par consulat, depuis 2009 |
| E5 | Taux de succès par agent | **[P]** | Existe partiellement dans les rapports |
| E6 | Motifs de refus les plus fréquents, classés | **[À]** | Nourrit directement la checklist |
| E7 | Prévision de charge par mois et par consulat | **[À]** | La saisonnalité est forte |

**Pourquoi c'est stratégique.** Au bout de six mois d'usage, l'agence possède une statistique que personne d'autre n'a : son propre taux de refus par profil. C'est ce qui rend le changement de logiciel douloureux, donc c'est ce qui retient l'abonnement.

## F. Le fret et le transit

| # | Fonctionnalité | Statut | Pourquoi |
|---|---|---|---|
| F1 | Expédition, modes, étapes | **[F]** | |
| F2 | Groupage, lots par client | **[F]** | |
| F3 | **Trois tronçons distincts : long-courrier, attente au hub, feeder** | **[À]** | Il n'existe aucune ligne directe Chine vers Radès. Le retard vient du raccordement, pas du long-courrier |
| F4 | **Port de transbordement et date de connexion feeder, obligatoires** | **[À]** | Conséquence directe du tirant d'eau de 8,8 m à Radès |
| F5 | Master B/L et House B/L comme deux entités liées, statut de libération propre à chacune | **[À]** | L'importateur n'a jamais le Master B/L |
| F6 | **Deux jalons distincts : dépotage du conteneur, libération du lot** | **[À]** | Un lot ne bloque les autres que tant que le conteneur n'est pas dépoté |
| F7 | **Trois compteurs séparés : surestaries, détention, magasinage** | **[P]** | Un seul compteur aujourd'hui. Trois factures, trois débiteurs, trois créanciers |
| F8 | Jours francs et tarifs journaliers en paramètres par armateur, port et type de conteneur, avec historique | **[À]** | Aucun tarif tunisien n'est public. Ne rien livrer par défaut |
| F9 | **Compte à rebours par conteneur avec alerte à J-2** | **[À]** | C'est la fonction qui rembourse le logiciel le plus vite |
| F10 | Facturation W/M, minimum 1 CBM, forfait par House B/L non réparti | **[À]** | Un client à 0,5 CBM paie le même doc fee qu'un client à 12 CBM. Doit apparaître au devis |
| F11 | Alerte de bascule LCL vers FCL au-delà de 10 à 15 CBM | **[À]** | Seuil paramétrable par lane |
| F12 | Incoterm au dossier, avec **avertissement FOB en groupage** | **[À]** | FCA au CFS est la règle correcte. FOB laisse le risque au vendeur pendant l'empotage |
| F13 | Avertissement CIF, clauses (C), contre CIP, clauses (A) | **[À]** | CIF impose la couverture la plus faible sur 25 000 km |
| F14 | Blocage du DDP avec explication | **[À]** | Le vendeur chinois ne peut pas être importateur légal en Tunisie, et l'acheteur perd la récupération de TVA |
| F15 | Manutentionnaire au dossier (STAM ou GMS) | **[À]** | C'est lui qui facture le magasinage |

## G. La douane

| # | Fonctionnalité | Statut | Pourquoi |
|---|---|---|---|
| G1 | **Moteur de calcul des droits et taxes** (DD, DC, FODEC, TVA, RPD, AIR) | **[À]** | Cascade entièrement documentée officiellement, donc codable |
| G2 | **Taux de change à la date d'enregistrement de la déclaration**, pas de la facture | **[À]** | Article 33. Erreur classique |
| G3 | RPD : minimum de 10 DT **par article**, pas par déclaration | **[À]** | |
| G4 | Majoration de 25 % de l'assiette TVA pour un non-assujetti (lettre M) | **[À]** | |
| G5 | **Blocage des codes 404 et 971 si origine = CN** | **[À]** | Aucun accord préférentiel Tunisie-Chine |
| G6 | Contrôle « déduction article 31 refusée si non facturée distinctement » | **[À]** | Validation à la saisie de facture |
| G7 | Suivi du TCE domicilié : forme, validité, imputation, apurement | **[À]** | Sans lui, pas de transfert de devises |
| G8 | **Alerte de re-domiciliation si le prix ou la quantité augmente de plus de 10 %** | **[À]** | Sinon nouveau titre et annulation de l'ancien |
| G9 | Suivi du DCT : dépôt avant arrivée, quatre décisions possibles, D41 | **[À]** | Se dépose avant l'arrivée de la marchandise |
| G10 | Compte à rebours du délai franc en MAD : 1 jour franc, puis 15 jours maximum | **[À]** | Délais durs, officiels |
| G11 | Fiche du commissionnaire en douane : code 7 chiffres plus lettre, bureaux d'exercice | **[À]** | |
| G12 | **Blocage explicite du transfert fournisseur tant que la preuve d'expédition n'est pas produite** | **[À]** | Règle de fer tunisienne. Le transitaire détient les clés du paiement |
| G13 | Honoraires paramétrables en trois modes cumulables : forfait, par article, pourcentage de la valeur en douane | **[À]** | L'unité naturelle est l'article de déclaration |
| G14 | Débours refacturés à l'identique et tracés **séparément** des honoraires | **[F]** | La RPD est une taxe, pas une prestation |

## H. L'argent

| # | Fonctionnalité | Statut | Pourquoi |
|---|---|---|---|
| H1 | Honoraires et débours séparés | **[F]** | |
| H2 | Multi-devises avec taux au dossier | **[F]** | |
| H3 | **Taux converti à la date d'encaissement, pas à la date de devis** | **[À]** | Le dinar libyen a été dévalué deux fois en un an |
| H4 | Encaissement en espèces, partiel, en plusieurs fois | **[F]** | La réalité du terrain |
| H5 | **Payeur distinct du bénéficiaire** | **[À]** | Un oncle paie pour son neveu, une entreprise pour son salarié |
| H6 | Caisse du jour, ouverture et clôture, écarts | **[F]** | |
| H7 | Reçus numérotés | **[F]** | |
| H8 | Commissions d'apporteur | **[F]** | |
| H9 | **Jamais d'encaissement du client final par la plateforme** | **[F]** | Agrément BCT requis. Précédent Paymee, fonds gelés par la CTAF en février 2023 |
| H10 | Relance d'impayé, avec blocage de restitution du passeport | **[P]** | Le blocage existe, la relance non |
| H11 | Devis avec durée de validité et **taux de change non figé** | **[À]** | Avis de Dar al-Ifta de septembre 2026 sur le taux différé |

## I. La communication

| # | Fonctionnalité | Statut | Pourquoi |
|---|---|---|---|
| I1 | Modèles de messages cliquables et configurables | **[F]** | Demande explicite |
| I2 | Pré-remplissage WhatsApp | **[F]** | |
| I3 | **Envoi et réception WhatsApp réels (Cloud API)** | **[À]** | Facturation par message modèle depuis juillet 2025, fenêtre de service de 24 h gratuite |
| I4 | Fenêtre de 24 h calculée et affichée | **[F]** | Évite de payer un message modèle pour rien |
| I5 | **Messenger comme second canal** | **[À]** | En Libye, Messenger touche 4,9 millions de personnes sur 7,5 millions d'habitants. Facebook 50 % du trafic social |
| I6 | Modèles en quatre langues | **[F]** | |
| I7 | **Arabe d'abord côté client libyen, anglais ensuite, français seulement pour Tunis** | **[À]** | Des étudiants libyens abandonnent des cursus francophones. Le français en avant tue le marché libyen |
| I8 | Notifications poussées mobiles | **[P]** | L'enregistrement existe, l'envoi côté serveur non |
| I9 | Automatisations avec délai de garde | **[F]** | Évite le harcèlement |

## J. L'exploitation quotidienne

| # | Fonctionnalité | Statut | Pourquoi |
|---|---|---|---|
| J1 | Onglet Aujourd'hui | **[F]** | Demande explicite |
| J2 | Badges en temps réel, synchronisation entre onglets | **[F]** | |
| J3 | Demandes entrantes, conversion en dossier | **[F]** | |
| J4 | Reçu au guichet en un bouton | **[F]** | Bloquant relevé par l'employé |
| J5 | Retour d'une étape sur une expédition | **[F]** | |
| J6 | Tâches assignables | **[F]** | |
| J7 | **Mode dégradé hors ligne** | **[À]** | Débit mobile médian 25 Mbps en Libye contre 67 en Tunisie. Une interface lourde qui passe à Tunis ne passe pas à Tripoli |
| J8 | **Recherche globale** (client, dossier, passeport, expédition, conteneur) | **[À]** | Le concurrent réel est un fil WhatsApp, où l'on ne trouve rien |
| J9 | Export complet des données de l'agence | **[À]** | Sans réversibilité, pas de vente à une agence sérieuse |
| J10 | Import de l'existant depuis un tableur | **[À]** | Toutes les agences arrivent avec un Excel |

## K. Le mobile

| # | Fonctionnalité | Statut | Pourquoi |
|---|---|---|---|
| K1 | Application iOS native | **[F]** | Swift 6, zéro dépendance externe |
| K2 | **Application Android native** | **[À]** | **Android représente 84,7 % en Libye et 82,5 % en Tunisie.** C'est la plateforme majoritaire, de loin |
| K3 | Quatre langues, RTL natif | **[F]** | Pas seulement traduit : ordre des colonnes, sens des flèches, alignement des montants |
| K4 | Dépôt de pièce depuis l'appareil photo | **[À]** | Le geste naturel du client |
| K5 | Notification à chaque changement d'étape | **[P]** | |
| K6 | Test prioritaire sur Chrome mobile Android | **[À]** | 71,9 % des navigateurs mobiles en Libye |

---

## Les dix chantiers, par ordre de valeur

1. **La file de rendez-vous** (D2 à D8). C'est là qu'est la marge, et personne ne le fait.
2. **Les statistiques de refus par profil** (E1 à E6). C'est ce qui retient l'abonnement au bout de six mois.
3. **Le téléversement réel des pièces et leur contrôle** (C14, C15). Sans cela, le logiciel reste un cahier.
4. **WhatsApp en émission et réception** (I3). C'est le canal, pas une option.
5. **L'application Android** (K2). Huit clients sur dix.
6. **Le compte à rebours conteneur** (F9) et les trois compteurs (F7). La fonction qui se rembourse le plus vite.
7. **Le moteur de droits et taxes** (G1 à G6). Entièrement documenté, donc codable sans risque.
8. **La checklist par statut professionnel** (C2). Sans cela le module dossier est faux dès le premier cas.
9. **Le nom arabe comme référence** (B5, B6, B7). Une dette de modèle qui coûte cher si on la paie tard.
10. **La facture au format TTN** (A13). Obligatoire depuis le 1er janvier 2026.
