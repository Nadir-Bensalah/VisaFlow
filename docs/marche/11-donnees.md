# La liste des données

Ce que le SaaS doit stocker, et pourquoi. Les tables marquées **[F]** existent dans les migrations 0001 à 0012. Les colonnes en gras sont celles que l'étude de marché a révélées et qui manquent aujourd'hui.

---

## 1. Socle

**agencies [F]** · id, slug, raison sociale, matricule fiscal, **numéro de licence ONTT**, adresse, téléphone, langues actives, devise de base, fuseau, logo, statut d'abonnement, **date d'échéance de l'abonnement**, **déclaration INPDP (numéro, date de dépôt, pièce)**, **autorisation de transfert article 52 (numéro, date)**.

**offices [F]** · id, agency_id, nom, pays, ville, adresse, téléphone, fuseau, **jours et heures d'ouverture**, actif.

**profiles [F]** · id, agency_id, office_id, nom, téléphone, rôle, actif, dernière connexion, **langue d'interface**.

**subscriptions [À]** · agency_id, formule, prix annuel, devise, date de début, date d'échéance, **facture TTN émise**, statut, **commission éditeur par dossier**.

---

## 2. Le client

**clients [F]**

| Colonne | Note |
|---|---|
| id, agency_id, office_id | |
| **name_ar** | **Le nom en arabe est la donnée de référence** |
| name_latin_variants (tableau) | Chaque variante avec sa **source** : passeport, acte de naissance, formulaire consulaire, réservation |
| téléphone normalisé, téléphone secondaire | Identité principale |
| e-mail | Optionnel, souvent absent |
| date de naissance, lieu de naissance | **Avec le numéro de passeport, la seule clé de rapprochement fiable** |
| **nationalité** | Tunisienne, libyenne, autre. Change tout le parcours |
| **statut professionnel** | salarié, indépendant, fonctionnaire, étudiant, retraité, sans emploi, mineur. **Détermine la checklist** |
| employeur, fonction, revenu déclaré | Pièces de revenu |
| **résidence : pays, ville, titre de séjour tunisien (optionnel)** | **Jamais obligatoire.** 530 Libyens seulement en avaient un |
| langue préférée | ar, en, fr, zh |
| **canal préféré** | whatsapp, messenger, sms, appel |
| groupe familial, lien de parenté | |
| **consentement** : donné le, révoqué le, portée, preuve | Loi 2004-63 |
| **doublon suspecté de** | Rapprochement automatique |
| créé le, créé par |

**passports [À]** · client_id, numéro, pays d'émission, date de délivrance, **date d'expiration**, **autorité émettrice**, pages restantes, **biométrie prise le, biométrie valide jusqu'au (59 mois)**, scan (référence de stockage).

**travel_history [À]** · client_id, pays, date d'entrée, date de sortie, **jours consommés**, visa utilisé. Alimente le **compteur 90 jours sur 180** rendu nécessaire par l'EES au 10 avril 2026.

**client_devices [F]**, **otp_codes [F]** (haché), **consents [F]**, **rate_limits [F]**.

---

## 3. Le catalogue

**visa_types [F]** · agency_id, libellé i18n, **pays de destination**, **consulat**, catégorie (court séjour, long séjour, transit, affaires), **PRIMO ou VISE**, honoraires agence, frais consulaires, frais de centre, devise, délai annoncé, actif.

**consulates [À]**

| Colonne | Note |
|---|---|
| pays, ville de représentation, adresse | |
| **centre de dépôt** | TLScontact Tunis, TLScontact Sfax, VFS, dépôt direct |
| **compétence territoriale** | Quels résidents il accepte. **La Suisse, l'Autriche et la France traitent les Libyens depuis Tunis** |
| **exige un titre de séjour** | booléen. Faux pour la plupart |
| **délai de recours après refus** | En jours. **Paramètre, avec sa source et sa date de vérification.** Les sources se contredisent, 30 jours contre 2 mois |
| frais consulaires, devise, mode de paiement accepté | |
| **taux de refus officiel de référence** | Données publiques de la Commission européenne, par consulat, par année |
| **part de multi-entrées de référence** | Varie de 12,6 % à 99,1 % |

**checklists [F]** et **checklist_versions [F]** · **clé composite (consulat, type de visa, statut professionnel)**. Une checklist « France » n'existe pas.

**checklist_items [F]** · libellé i18n, obligatoire, **applicable si (statut, âge, nationalité)**, **durée de validité du document**, format accepté, exemple, aide.

**stage_definitions [F]**, **message_templates [F]**, **automation_rules [F]** (+ cooldown_hours), **partners [F]**.

---

## 4. Le dossier

**cases [F]**

| Colonne | Note |
|---|---|
| référence, agency_id, office_id, client_id, group_id | |
| visa_type_id, **consulate_id**, checklist_version_id | |
| **primo_ou_vise** | Pièces, délais et taux de refus différents |
| étape, statut, assigné à | |
| date d'ouverture, date cible, date de décision | |
| **décision** : délivré, refusé, retiré, sans suite | |
| **si délivré** : type (simple, multiple), validité du, au, durée de séjour autorisée | |
| **si refusé** : **code de motif** (liste fermée), motif détaillé | **Sans code, aucune statistique exploitable** |
| **recours** : déposé le, échéance calculée, décision | |
| retry_of | Reprise après refus |
| portal_token | Opaque, non énumérable |
| **biométrie requise** | Calculé depuis passports.biometrie_valide_jusquau |

**case_documents [F]** · case_id, checklist_item_id, état, fichier, déposé le, déposé par, **vérifié par**, **motif de rejet**, **date d'expiration du document**.

**case_notes [F]** · journal horodaté et attribué, jamais un champ unique écrasé.

**passport_custody [F]** · client_id, case_id, numéro, reçu le, reçu par, **emplacement de coffre**, sorti le, sorti par, motif de sortie, rendu le, **signature de restitution**, **restitution bloquée par solde**.

**document_access_log [F]** · qui a ouvert quel document, quand, depuis quelle adresse.

---

## 5. Le rendez-vous, la donnée qui porte la marge

**appointment_slots [À]** · consulate_id, centre, date, heure, capacité, **fenêtre d'ouverture des réservations**, source (portail officiel, alerte, revendeur).

**appointment_queue [À]**

| Colonne | Note |
|---|---|
| case_id, consulate_id | |
| **inscrit le, rang, priorité** | « Vous êtes 4e sur la liste Italie » |
| règle de priorité appliquée | ancienneté, urgence, montant payé |
| **statut** : en attente, servi, abandonné | |
| servi le, délai réel d'obtention | Alimente le délai moyen par consulat |

**appointment_attempts [À]** · case_id, tenté le, tenté par, centre, résultat (aucun créneau, créneau pris, erreur), créneau obtenu. **C'est le travail réel de l'agent, aujourd'hui totalement invisible.**

**appointments [F]** · + **absence du client**, + conséquence commerciale.

---

## 6. Le fret

**shipments [F]** · + **manutentionnaire** (STAM, GMS), + **port de transbordement**, + **date de connexion feeder**, + **incoterm**, + **avertissements incoterm déclenchés**.

**shipment_legs [À]** · shipment_id, ordre, type (**long-courrier, attente au hub, feeder**), origine, destination, départ prévu, départ réel, arrivée prévue, arrivée réelle, armateur, navire. **Trois tronçons, jamais un « transit time » unique.**

**bills_of_lading [À]** · type (**master** ou **house**), numéro, parent (le master pour un house), armateur ou groupeur, shipper, consignee, **statut de libération** (original endossé, telex release, express release), libéré le.

**containers [À]**

| Colonne | Note |
|---|---|
| numéro, type (20, 40, 40HC), scellé | |
| date de déchargement | Départ du compteur de surestaries |
| **jours francs surestaries, jours francs détention, jours francs magasinage** | Trois valeurs distinctes, paramétrées |
| date de sortie du terminal | Départ du compteur de détention |
| date de restitution à vide | Arrêt du compteur de détention |
| **date de dépotage** | Fin de la solidarité entre lots |

**shipment_lots [F]** · + **volume payant W/M**, + **date de libération du lot** (distincte du dépotage), + **forfait documentaire non réparti**.

**free_time_counters [À]** · container_id, **type (surestaries, détention, magasinage)**, débiteur, créancier, date de début, jours francs, tarif journalier, paliers, majoration de congestion, jours écoulés, montant couru. **Trois compteurs, trois factures, trois débiteurs. Jamais un seul.**

**carrier_tariffs [À]** · armateur, port, type de conteneur, type de frais, jours francs, tarif journalier, paliers, **valide du, au**. Aucune valeur par défaut livrée : rien n'est public en Tunisie.

---

## 7. La douane

**customs_declarations [À]** · numéro d'enregistrement, bureau, **modèle** (CF, SA, EA, SE, SC, SS, SN, VE), code régime, **commissionnaire (code 7 chiffres plus lettre)**, nombre d'articles, **date d'enregistrement** (fixe le taux de change, article 33), circuit, date du bon à enlever, date du bon de sortie.

**declaration_articles [À]** · **NDP (10 caractères plus clé)**, **case 32 origine**, case 39 espèce, cases 40, 42/1, 42/2, valeur, quantité QCS et QCI, **titre CCEC (L ou P)**, **MP5**.

**tax_lines [À]** · code de taxe (001, 014, 093, 105, 473, 480), **assiette (A, B, O, Y, F)**, taux, montant, **lettre M** (majoration de 25 % pour non-assujetti).

**customs_values [À]** · prix facturé, devise, **ajustements article 30** (détail par nature), **déductions article 31** (détail, avec **le drapeau « facturé distinctement »** sans lequel la déduction est refusée), taux de change appliqué, date du taux, **VD_CAF calculée**.

**trade_titles (TCE) [À]** · forme (5 valeurs), banque domiciliataire, date de domiciliation, montant, devise, validité, **imputations successives** (fractionnement autorisé), **écart de prix ou de quantité en pourcentage** (alerte au-delà de 10 %), statut d'apurement.

**technical_control (DCT) [À]** · organisme, lieu de dépôt, date de dépôt, **décision** (enlèvement provisoire, inspection sur place, mise à la consommation, réexportation ou destruction), D41, date d'inspection, résultat d'analyse, date de transmission à la douane.

**customs_brokers [À]** · nom, **code en douane**, numéro d'agrément, bureaux d'exercice, téléphone.

**tariff_lines [À]** · NDP, libellé, taux DD, taux DC, taux TVA, taux FODEC, présence du code 480 (AIR 10 %), titre CCEC, MP5, **valide du, au**.

---

## 8. L'argent

**payments [F]** · + **payeur distinct du bénéficiaire** (nom, lien, téléphone), + **date d'encaissement effective** (c'est elle qui fixe le taux, pas la date de devis), + preuve.

**quotes [À]** · client, lignes, devise, **taux non figé**, valide jusqu'au, accepté le, **mention explicite des forfaits non répartis** (le doc fee par House B/L).

**invoices [À]** · numéro, agence, client, lignes, TVA, timbre, **format TTN**, transmise le, référence TTN. Obligatoire pour les prestataires de services depuis le 1er janvier 2026.

**revenue_lines [F]** (vue, propriétaire uniquement), **cash_sessions [F]**, **cash_movements [F]**, **receipts [F]**, **shipment_finance [F]**, **partner_commissions [F]**.

**fx_rates [À]** · devise, taux, source (BCT), **date**. La page de la BCT charge ses valeurs en JavaScript : prévoir une saisie ou un récupérateur dédié.

---

## 9. La communication

**messages [F]** · + **canal** (whatsapp, messenger, sms), + **coût du message modèle**, + statut de livraison, + **fenêtre de 24 h ouverte ou non**.

**message_templates [F]** · + **langue par défaut selon la nationalité du client** : arabe pour un Libyen, français possible pour un Tunisien.

**push_tokens [P]**, **notifications [À]** · destinataire, événement, canal, envoyée le, lue le.

---

## 10. Le pilotage

**activity_events [F]** · en ajout seul.

**refusal_stats [À]** (vue matérialisée) · agence, consulat, type de visa, statut professionnel, période, dossiers, refus, taux, **écart à la moyenne officielle**.

**regulatory_alerts [À]** · portée (pays, poste frontière, consulat), titre, corps, gravité, publiée le, expire le, source. Alimentée à la main par l'éditeur. **C'est la raison de payer l'abonnement.**

**retention_policies [F]**, **purge_log [F]**.

---

## Les six décisions de modélisation à ne pas rater

1. **Le nom arabe est la référence, la version latine est une variante.** Le rapprochement se fait sur passeport plus date de naissance. Le problème est reconnu au niveau des États dans l'accord frontalier tuniso-libyen de juin 2024.
2. **La checklist a trois axes, pas un** : consulat, type de visa, **statut professionnel**. Sans le troisième, le module est faux dès le premier dossier.
3. **Trois compteurs de frais, pas un** : surestaries, détention, magasinage. Trois débiteurs, trois créanciers, trois factures.
4. **Trois tronçons de transport, pas un** : il n'y a aucune ligne directe Chine vers Radès, et le retard vient du raccordement au feeder.
5. **Le taux de change se fige à la date d'enregistrement de la déclaration** (article 33) et **à la date d'encaissement** pour une facture. Jamais à la date de facture ni de devis.
6. **Rien de ce qui n'est pas public n'est livré par défaut.** Tarifs de surestaries, de magasinage, honoraires de commissionnaire, délais de recours : ce sont des paramètres, avec une source et une date de vérification.
