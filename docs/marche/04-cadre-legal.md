# Le cadre légal, côté agence et côté éditeur

Relevé au 7 septembre 2026, par lecture directe des textes (JORT scannés de l'ONTT, BCT, douane.gov.tn, jibaya.tn, legislation-securite.tn, EUR-Lex). Plusieurs résumés automatiques ont produit des références inventées et vérifiées fausses : rien de ce qui suit n'en provient.

---

## 1. Deux découvertes qui changent la structure du projet

### 1.1 L'article 22 de la loi 2004-63

> « La personne physique ou le représentant légal de la personne morale désirant effectuer le traitement des données à caractère personnel et leurs agents doivent remplir les conditions suivantes : **être de nationalité tunisienne** ; **être résident en Tunisie** ; être sans antécédents judiciaires. **Ces conditions s'appliquent également au sous-traitant et à ses agents.** »

La condition est reprise dans l'engagement sur l'honneur imprimé sur les formulaires de l'INPDP et au dernier tiret de l'article 8 du décret 2007-3004.

**Lue à la lettre, elle interdit à une société étrangère non résidente d'être sous-traitant d'un responsable de traitement tunisien.** Or l'agence est le responsable, et l'éditeur du logiciel est le sous-traitant, ne serait-ce que par le fait d'héberger.

**Ce que cela impose.** VisaFlow doit être porté par une entité tunisienne, pas par une entité française. Capmedia Tunisie existe déjà (MF 1955131B) : c'est la structure d'accueil naturelle. Le point doit être tranché par un avocat tunisien avant toute signature avec une agence, mais il n'y a pas de lecture confortable de l'article 22.

### 1.2 L'audit de sécurité annuel obligatoire

**Décret-loi n° 2023-17 du 11 mars 2023 relatif à la cybersécurité**, JORT n° 26, en vigueur le 11 septembre 2023, qui abroge la loi 2004-5.

| Article | Contenu |
|---|---|
| 6 | Sont soumis à audit obligatoire et périodique « les fournisseurs des services d'hébergement et d'informatique en nuage » et « les entreprises qui procèdent au traitement automatisé des données personnelles de leurs usagers dans le cadre de la fourniture de leurs services à travers les réseaux de télécommunications » |
| 7 | **Au moins une fois tous les 12 mois**, par des experts inscrits sur la liste de l'Agence nationale de la cybersécurité |
| 8 | Rapport remis à l'Agence **sous 10 jours**, recommandations à mettre en œuvre |
| 25 | **Amende de 50 000 à 100 000 DT** pour les organismes du troisième niveau |
| 14 | L'obligation d'hébergement labellisé (G-cloud, N-cloud) **ne vise que les services gouvernementaux**. Il n'y a **pas** d'obligation générale de localisation des données privées en Tunisie |

VisaFlow est dans le champ. L'audit annuel est un coût récurrent à budgéter, et l'INPDP en réclame d'ailleurs une copie au dossier de déclaration.

---

## 2. Le transfert de données à l'étranger

**Article 51** : le pays destinataire doit assurer un niveau de protection adéquat.
**Article 52** : « Dans tous les cas, l'obtention de l'autorisation de l'Instance pour effectuer le transfert des données à caractère personnel vers l'étranger est **obligatoire**. »

**Une liste de pays adéquats existe** : décision de l'INPDP **n° 3 du 5 septembre 2018**, qui abroge la décision n° 1 de 2016. Elle liste 49 pays, dont la **France**, toute l'Union, le Royaume-Uni, la Suisse, la Turquie, l'Algérie, le Maroc, le Canada, l'Australie. **Les États-Unis n'y figurent pas.**

**Le piège est à l'article 3 de cette décision** : le transfert vers un pays de la liste « ne soulève en principe aucune difficulté juridique, **mais cela ne dispense pas de l'obligation d'obtenir l'autorisation préalable de l'Instance prévue à l'article 52** ». Même vers la France, l'autorisation reste obligatoire.

**Le délai annoncé est un mois. Le délai réel est de 2 à 6 mois.** C'est l'INPDP elle-même qui le reconnaît dans son rapport d'activité 2018-2021 : **279 dossiers ont dépassé 90 jours**, les dossiers ajournés vont jusqu'à **537 jours**, et le délai moyen dépend de la fréquence des séances du Conseil (15 jours si le Conseil siège tous les mois, 71 jours s'il siège tous les cinq mois). Le rapport propose lui-même de porter le délai légal à deux mois.

**Pratique décisionnelle documentée :**

| Décision | Sens |
|---|---|
| 958-01/20, 5147-02/20, 5288-02/20 | **Refus de transfert vers les États-Unis**, faute de niveau adéquat |
| 5357-02/20 | Refus vers l'Algérie, avant sa loi de protection |
| 4167-02/19 | Refus si le pays de destination n'est pas indiqué |
| 4053-02/19 | Refus pour défaut de mandat du signataire |
| 4067-02/19 | Une demande d'autorisation non accompagnée d'une déclaration n'est pas examinée. **Il faut déclarer ET demander** |
| 700-01/19 | Ajournement pour **absence de copie du contrat de sous-traitance** |
| **4569-02/19** | **La décision la plus utile.** Dossier classé, le demandeur étant **dispensé d'autorisation** : les données étaient à l'origine stockées à l'étranger chez la société mère, le responsable tunisien se bornant à les consulter **sans les héberger sur le territoire tunisien** |

La décision 4569-02/19 ouvre une piste architecturale réelle : **il n'y a « transfert » que si les données quittent la Tunisie**. Une architecture où la saisie va directement vers le serveur étranger, sans étape locale, change la qualification. Ce n'est pas une doctrine publiée : à faire valider par un avocat tunisien.

**Pièces exigées au dossier** (communiqué INPDP de juillet 2022) : document d'information et de recueil du consentement, captures des écrans de collecte, CGU, **copie du contrat liant le sous-traitant au responsable**, accord relatif au transfert, mesures de sécurité dont **une copie de l'audit périodique légal**, et une présentation du traitement en deux pages maximum.

**Coût** : ni la loi ni le décret ne prévoient de redevance ou de timbre. Aucun tarif officiel publié ni confirmation explicite de gratuité : non trouvé.

**Sanctions utiles à connaître** : article 90, traitement sans déclaration ou sans autorisation, et **transfert à l'étranger sans autorisation**, un an et 5 000 DT. Article 91, sous-traitant poursuivant malgré opposition, un an et 5 000 DT. Article 97, divulgation du contenu par le sous-traitant, article 254 du code pénal. **Article 101 : pour une personne morale, les peines s'appliquent personnellement au dirigeant légal ou de fait.**

**Autres obligations qui pèsent directement sur l'éditeur** : correction et mise à jour avec notification **sous deux mois** (art. 21) ; confidentialité **même après la fin du traitement** (art. 23) ; information de l'Instance **trois mois avant** toute cessation d'activité (art. 24).

**Réforme** : aucun projet identifié par numéro ni date à l'ARP dans ce relevé. Le rapport 2018-2021 de l'INPDP recommande de « réduire les cas d'autorisation préalable et de faire de la déclaration le principe ».

**Convention 108** : la Tunisie y a adhéré le 18 juillet 2017, en vigueur le 1er novembre 2017, avec le protocole 181. **Le protocole 108+ a été signé le 24 mai 2019 mais n'est pas ratifié.** L'Union, de son côté, n'a **pas** adopté de décision d'adéquation en faveur de la Tunisie : un flux Union vers Tunisie doit reposer sur les clauses contractuelles types de la décision (UE) 2021/914.

---

## 3. La licence d'agence de voyages

**Attention à une confusion qui circule** : la loi n° 73-21 du 14 avril 1973 concerne les **agences foncières**, pas les agences de voyages. Le texte fondateur est le **décret-loi n° 73-13 du 17 octobre 1973**, ratifié par la loi n° 73-68.

**Il n'y a que deux catégories, A et B. La « catégorie C » n'existe pas.**

| | Catégorie A | Catégorie B |
|---|---|---|
| Capital entièrement libéré | **100 000 DT** | **30 000 DT** |
| Caution bancaire permanente | **50 000 DT** | **25 000 DT** |
| Activités | 7 activités, dont organisation de circuits, transport touristique, réception, formalités d'assurances, représentation | **3 seulement** : réservation et vente de séjours, vente de titres de transport, représentation d'une agence A |
| Omra et Hajj | **réservé à la catégorie A** | interdit |
| Assurance RC professionnelle | obligatoire, **aucun montant fixé par aucun texte** | idem |

Depuis la **loi n° 2006-33**, ce n'est plus un agrément discrétionnaire : on retire deux exemplaires du cahier des charges à l'ONTT, on les signe, on en dépose un et on repart **le jour même** avec l'exemplaire visé. Les « 3 à 6 mois » annoncés par des sites commerciaux ne correspondent à aucun texte.

**Obligations de suivi à porter dans le logiciel** : notification à l'ONTT **sous 30 jours** de tout changement de siège, de succursale ou de représentant légal ; dépôt des états financiers **dans les 3 mois** de la clôture ; **visa préalable de l'ONTT sur tous les programmes** de voyages ; **numéro et catégorie de licence sur tous les imprimés, la correspondance et toute publicité** (art. 19).

**Omra, note d'orientation 1448 / 2026-2027 signée le 13 juillet 2026** : **interdiction de commercialiser le visa seul** (visa seul, ou visa avec billet d'avion), garantie de **3 000 DT par pèlerin pour le Ramadan**, **1 500 DT** le reste de la saison, ou garantie globale de **300 000 DT**. Délai de réclamation de **sept jours ouvrables** après le retour.

**Registre public officiel en ligne : non trouvé.** Ce qui existe est l'**annuaire de la FTAV** (annuaire.ftav.org), filtrable par catégorie et région. Source professionnelle, pas registre d'État.

**Peut-on faire du visa sans licence ?** Ni le décret-loi 73-13 ni les cahiers des charges de 2006 ne mentionnent jamais le visa ou le passeport. Le **décret gouvernemental n° 2018-417 du 11 mai 2018** pose que l'annexe n° 1 fixe **à titre exclusif** les activités soumises à autorisation, et que les activités non inscrites n'y sont pas soumises. **Conclusion : l'assistance administrative à la constitution de dossiers de visa, prise isolément, n'est pas une activité d'agence de voyages.** Trois réserves : l'annexe n° 1 complète n'a pas pu être lue ; dès que le prestataire vend **aussi** un billet ou un hébergement, il exerce une activité d'agence ; et aucun statut de « bureau de services » n'existe en droit tunisien.

**Sanctions de l'exercice illégal** : exploiter sans engagement sur le cahier des charges, **amende de 5 000 à 10 000 DT et fermeture immédiate** prononcée par le tribunal, doublée en récidive. Exploitation sans licence, fermeture immédiate et 500 à 2 000 DT. Retrait ou suspension jusqu'à 6 mois par le ministre, **notamment « en cas d'inexécution des obligations souscrites envers les clients »**.

---

## 4. La facturation, ce qui doit être dans le module

### Mentions obligatoires
Article 18 II du code de la TVA, plus l'article 25 de la loi 91-64, l'article 67 de la loi 95-44 et le code des sociétés : date de l'opération, identité et adresse du client, **matricule fiscal des deux parties**, désignation et prix hors taxe, taux et montants de TVA, **numéro en série ininterrompue**, nom du tribunal et numéro au registre de commerce, forme sociale et capital.

### Timbre fiscal
**1,000 dinar par facture** depuis le 1er janvier 2023 (article 65 du décret-loi 2022-79). Le tarif progressif introduit par l'article 20 de la LF 2026 est **réservé aux grandes surfaces commerciales** et ne concerne pas une agence. Paiement **sur déclaration mensuelle obligatoire pour les personnes morales soumises à l'IS**, avec la mention **« droit de timbre payé sur déclaration »** portée sur la facture. Factures d'exportation exonérées.

### TVA
Taux normal **19 %** depuis le 1er janvier 2018. La page finances.gov.tn affiche encore 18 / 12 / 6 % : elle est périmée.

**Il n'existe aucun régime de TVA sur la marge propre aux agences de voyages en droit tunisien.** Ce qui existe au tableau A : exonération des affaires effectuées avec les hôteliers pour les séjours en Tunisie de **non-résidents**, et exonération du transport aérien international **à l'exclusion des services rendus en contrepartie de la vente des billets**. La billetterie et les commissions d'agence restent taxables au taux normal.

### Facturation électronique : le calendrier réel
L'**article 53 de la loi 2025-17** (LF 2026), commenté par la **note commune n° 2/2026**, étend l'obligation aux **prestations de services** au 1er janvier 2026. **Aucun seuil de chiffre d'affaires** : les paliers à 500 000 dinars que l'on trouve en ligne ne figurent pas dans la note commune.

**Mais l'entrée en vigueur est aménagée, et c'est décisif.** Section III de la note commune : au 1er janvier 2026, l'obligation ne s'applique qu'aux prestataires **qui ont déjà adhéré au réseau TTN**. Ceux qui ont **déposé une demande d'adhésion** sans avoir achevé les formalités **continuent d'émettre des factures papier régulièrement**.

Format : mêmes mentions que la facture papier, plus la **signature électronique** et une **référence unique attribuée par TTN**. Copie papier sur demande, avec la mention « copie de la facture électronique enregistrée auprès de [structure] sous la référence unique n° … ». Les détails techniques (TEIF XML, certificat ANCE) ne figurent pas dans la note commune : à confirmer auprès de TTN.

**Sanction** : **100 à 500 DT par facture** papier émise alors qu'elle devait être électronique, plafonnée à 50 000 DT. Un site spécialisé annonce un report voté en avril 2026 : **aucun texte confirmant ce report n'a été trouvé**, à traiter comme non vérifié.

### Le plafond des paiements en espèces
**Article 83 ter du CDPF**, créé par l'article 60 du décret-loi 2022-79 : le paiement en espèces d'un montant **supérieur ou égal à 5 000 dinars TTC** au titre d'acquisitions d'actifs, services ou produits entraîne une **amende égale à 20 % des montants payés, avec un minimum de 2 000 dinars**. Applicable depuis le 1er janvier 2023, non modifié par les LF 2024, 2025 et 2026.

**C'est une fonctionnalité produit directe** : le logiciel doit avertir dès qu'un encaissement en espèces atteint 5 000 DT, et proposer le fractionnement ou un autre moyen. Un dossier Omra à 6 000 DT payé en liquide coûte 1 200 DT d'amende à l'agence.

Ne pas confondre avec le droit de 5 % sur tout montant dépassant **3 000 dinars** payé en espèces **auprès d'un comptable public** (article 76 bis du code de la comptabilité publique). Ce n'est ni une interdiction ni un plafond général.

---

## 5. Blanchiment : les agences ne sont pas assujetties

**Article 107 (nouveau) de la loi organique n° 2015-26**, modifié par la loi organique 2019-9. La liste est exhaustive : banques et établissements financiers, microfinance, Office national de la poste, intermédiaires en bourse, bureaux de change, assurances, avocats et notaires dans certaines opérations, experts-comptables, agents immobiliers lors de ventes d'immeubles, commerçants de bijoux et métaux précieux, casinos.

**Les agences de voyages n'y figurent pas.** Lecture intégrale de la liste, pas une déduction.

**Conséquence** : une agence tunisienne n'est ni tenue à la déclaration de soupçon de l'article 125, ni aux mesures de vigilance des articles 108 à 113, ni à la conservation LBC de dix ans. Elle reste soumise au droit pénal commun et au plafond de 5 000 DT ci-dessus, et le cahier des charges prévoit une suspension définitive en cas de fraude douanière, fiscale ou de change.

**Ce que cela veut dire pour le produit** : ne pas construire de module KYC lourd, de scoring PPE ou de déclaration de soupçon. Ce serait du travail inutile qui alourdirait l'usage quotidien sans obligation légale.

**Statut international** : la Tunisie est sortie de la liste grise du GAFI à la plénière de Paris du **18 octobre 2019**, et de la liste UE par le règlement délégué (UE) 2020/855, en vigueur le **9 juillet 2020**. **En 2026 elle ne figure sur aucune des deux listes.**

---

## 6. Le droit du voyageur, et ce que le contrat ne peut pas contenir

### Les clauses frappées de nullité
**Article 28 du décret-loi 73-13** : « Est réputée nulle et de nul effet toute stipulation ayant pour objet de **décharger totalement ou partiellement de leur responsabilité les agences de voyages**, ou de **modifier les modes de preuve légaux** au profit desdites agences, ou de **renvoyer le règlement de certains litiges à des tribunaux étrangers**. »

**Article 10 de la loi 92-117** : « Dans tous les cas, la responsabilité du fournisseur ne peut être écartée ou limitée par une clause contractuelle. » **Article 17** : « Est nul tout accord ou contrat portant sur l'absence de garantie. »

Le module de contrat client doit donc refuser ces trois clauses. Une clause attributive de juridiction étrangère dans les CGU de VisaFlow, vis-à-vis d'une agence tunisienne, est également à revoir.

### Le seul texte qui fixe des délais chiffrés
**Arrêté du ministre du Tourisme du 9 août 2007**, vente par internet, JORT n° 67. **Article 8** : le client peut se rétracter **dans un délai maximum de dix jours ouvrables avant le début de la prestation**, et **l'agence doit rembourser dans les dix jours** à compter de la rétractation. Deux exceptions : réservation demandée à moins de dix jours du départ et fournie, et réservation personnalisée.

**Article 6, mentions obligatoires du site** : identité complète, **catégorie et numéro de la déclaration déposée auprès du ministère du tourisme**, adresse, contacts, étapes de l'opération, prix et période de validité, modes de paiement, **délais d'exécution et conséquences de l'inexécution**, **possibilité de se rétracter et ses délais**, **modes et délais de restitution de l'avance**, langues du contrat. Informations imprimables et téléchargeables à toutes les étapes.

**Limite à ne pas franchir** : cet arrêté ne vise que la vente **par internet**. Pour une vente au comptoir, aucun texte tunisien ne fixe de délai de rétractation ni de remboursement.

### Publicité trompeuse
**Article 13 de la loi 92-117** : interdiction de toute publicité comportant des allégations fausses ou de nature à induire en erreur, notamment sur le prix, les conditions de vente et **les résultats attendus**. C'est le siège d'une promesse du type « visa en 24 heures ». Amende de **1 000 à 20 000 DT**, doublée en récidive dans les cinq ans.

**Article 18, remboursement** : en cas de non-conformité, le fournisseur doit, **au choix du consommateur**, remplacer, réparer à ses frais, **ou rembourser le prix, indépendamment de la réparation du préjudice**.

### Refus de visa
**Non trouvé.** Aucune source tunisienne ne dit ce qui est remboursé en cas de refus de visa, et **aucune source ne dit que les frais consulaires sont non remboursables**. Aucune jurisprudence sur l'obligation de moyens ou de résultat. Le seul appui est le contrat type officiel de Omra, qui met à la charge de l'agence de « veiller à accomplir toutes les démarches relatives au visa », formule d'une obligation de moyens sans conséquence financière attachée à l'échec.

**Pour le produit** : la politique de remboursement en cas de refus est un **paramètre de l'agence**, à porter au contrat client généré, jamais une valeur par défaut de l'éditeur.

### Litiges réels
22 mai 2026, Tunis : arrestation du propriétaire d'une agence Hajj et Omra, **plus de 50 clients** encaissés sans prestation. 5 juin 2020, Béja : **deux ans de prison ferme** après l'accident du bus d'Amdoun. 22 octobre 2025, Sousse : visa promis en 24 heures livré en près d'un mois, remboursements partiels tardifs. Mises en garde officielles de l'ONTT (14 février 2025) et du ministère du Tourisme (13 novembre 2025), qui recommandent la **catégorie A uniquement** et un contrat écrit.

---

## 7. La conservation

| Document | Durée | Base |
|---|---|---|
| Livres de commerce et pièces justificatives | **10 ans** | Code de commerce, art. 8 et 10 |
| États financiers et pièces | **10 ans au moins** | Art. 25 de la loi 96-112 |
| Documents fiscaux | **10 ans** | Art. 62 du code IRPP/IS |
| Répertoires du commissionnaire en douane | **3 ans** | Art. 107 du code des douanes |
| **Copies de pièces d'identité et de passeports** | **aucune durée chiffrée** | Loi 2004-63, art. 45 et 64 |
| Documents sociaux | **non trouvé** | Le code du travail ne fixe aucune durée |

Le droit de reprise fiscal est **plus court** que l'obligation de conservation : quatre ans pour les impôts déclarés, dix ans pour les impôts non déclarés.

**Le point le plus contraignant pour le module de purge, article 45 :**

> « Les données à caractère personnel doivent être détruites dès l'expiration du délai fixé à sa conservation dans la déclaration ou l'autorisation ou les lois spécifiques, ou en cas de réalisation des finalités, ou lorsqu'elles deviennent inutiles pour l'activité du responsable du traitement. **Il est établi un procès-verbal par huissier de justice et en présence d'un expert désigné par l'Instance.** »

C'est vous qui fixez la durée de conservation des passeports dans la déclaration, et vous êtes tenu par elle. Mais la destruction suppose un **procès-verbal d'huissier**. La conséquence produit est nette : la purge automatique doit **produire un rapport de destruction horodaté et exportable**, prêt à être annexé au procès-verbal, et ne jamais se contenter d'effacer en silence.

---

## 8. Facturer VisaFlow à une agence tunisienne

### Le transfert est libre
**Article 12 bis du décret 77-608**, rubrique « opérations liées à la production », vise expressément la « **location de logiciels et systèmes informatiques ainsi que l'affiliation à des banques de données** ». C'est une **opération courante**, donc librement transférable, sans autorisation préalable de la BCT.

Voie bancaire : circulaire **2016-09**, annexe 1, rubrique **B-5 « Achat ou location de logiciels »**. Pièces exigées : contrat ou facture, extrait du registre de commerce de l'agence, carte d'identification fiscale. **Pas de plafond.** Codes de transfert : **0872** licences, **0873** logiciels sans support physique, **0891** hébergement et abonnements à des sites web étrangers, **0871** installation et maintenance.

### Le seul vrai point de friction, et il commande la grille tarifaire
**Article 3 de la circulaire 2016-09** : la prestation doit être **non forfaitaire et mesurable par des unités quantifiables indiquées dans le contrat**, avec la dénomination et le lieu de résidence des parties, la date, la durée, la nature détaillée des prestations, **la rémunération convenue avec l'unité d'œuvre, le coût unitaire et les modalités de règlement**.

**Traduction : « 2 490 DT par an » est refusable par la banque. « 45 DT par utilisateur et par mois, pour 6 utilisateurs, du 1er janvier au 31 décembre » passe.** La grille tarifaire de VisaFlow doit donc être construite par unité d'œuvre dès le départ : par utilisateur, par dossier, ou par gigaoctet.

**Article 6, piège à éviter absolument** : aucune rubrique ne peut couvrir des **frais de siège**, définis comme les charges générales d'une société mère réparties sur ses filiales. La banque doit surseoir et informer la BCT en cas de soupçon de transfert déguisé. À proscrire si l'éditeur a une entité liée en Tunisie, ce qui sera le cas.

### La fiscalité à anticiper au contrat
| Prélèvement | Taux | Base |
|---|---|---|
| Retenue à la source sur un non-résident | **15 %**, libératoire | Art. 52 du code IRPP/IS |
| Si le bénéficiaire est dans un État à régime fiscal privilégié | 25 % | idem |
| **Retenue de TVA sur un prestataire étranger sans représentant** | **100 % de la TVA due**, soit 19 %, déductible chez le client | Art. 19 du code de la TVA |
| Retenue sur acquisitions de services entre résidents à partir de 1 000 DT TTC | 1,5 % | Art. 52 |

**Piège du brutage** : si la retenue libératoire n'a pas été opérée, elle est réputée à la charge du débiteur, et 15 % devient **17,647 %**. Le contrat doit dire qui la supporte.

La convention fiscale France-Tunisie du 28 mai 1973 plafonne les redevances à 5 % (droits d'auteur), 15 % (licences de brevets et procédés) ou 20 % (marques). **Le logiciel n'y est pas nommé** : ne promettez pas 5 % sans analyse, et le bénéfice du taux conventionnel suppose un certificat de résidence fiscale.

### La carte technologique, complément commode
Circulaire **2019-02 du 30 janvier 2019** : **10 000 DT par an pour toute société résidente**, sans condition de secteur depuis 2019 ; **100 000 DT** pour une société labellisée Startup ; 1 000 DT pour une personne physique diplômée. Utilisable seulement « lorsque le paiement est exigé via internet ». **Pièce exigée : la facture, c'est tout.** Pratique pour un petit abonnement, mais le plafond sature vite.

**Sanctions de change, pour mémoire** : article 35 de la loi 76-18, **un mois à cinq ans d'emprisonnement et 150 à 300 000 dinars**, l'amende ne pouvant être inférieure à **cinq fois le montant** sur lequel a porté l'infraction.

---

## 9. Les onze contraintes qui descendent dans le produit

1. **Entité tunisienne obligatoire** pour l'éditeur, article 22 de la loi 2004-63.
2. **Audit de sécurité tous les 12 mois**, décret-loi 2023-17, 50 000 à 100 000 DT d'amende.
3. **Autorisation de transfert INPDP même vers la France**, à budgéter 2 à 6 mois, jamais un mois.
4. **Jamais d'hébergement aux États-Unis.** Refus documentés.
5. **Contrat de sous-traitance écrit**, réclamé au dossier INPDP, ajournement documenté en son absence.
6. **Grille tarifaire par unité d'œuvre**, jamais un forfait annuel sec, article 3 de la circulaire 2016-09.
7. **Alerte à 5 000 DT sur tout encaissement en espèces**, amende de 20 % avec minimum de 2 000 DT.
8. **Timbre de 1,000 DT par facture**, avec la mention « droit de timbre payé sur déclaration ».
9. **Adhésion TTN à déposer**, l'obligation ne mordant qu'à l'adhésion effective.
10. **Purge produisant un rapport de destruction exportable**, l'article 45 exigeant un procès-verbal d'huissier.
11. **Contrat client refusant** les clauses exonératoires, les clauses modifiant les modes de preuve et les clauses attributives de juridiction étrangère.

Et une bonne nouvelle : **pas de module KYC ni de déclaration de soupçon**. Les agences de voyages ne sont pas assujetties à la loi 2015-26.

---

## 10. Ce qui reste ouvert

Référence JORT de la loi 2006-33 · texte de l'arrêté du 14 mai 1975 sur le cautionnement · annexe n° 1 complète du décret 2018-417 (l'absence d'une rubrique « visa » n'est pas formellement vérifiée) · régime du « bureau de services » · format officiel du matricule fiscal · réalité du report des sanctions e-facturation annoncé en avril 2026 · coût officiel de la déclaration INPDP · raison de la coupure du site inpdp.tn · projet de réforme de la loi 2004-63 · adoption du nouveau code des changes · refus de visa et remboursement, en droit comme en pratique · obligation de moyens ou de résultat pour le visa · mentions obligatoires d'un contrat vendu au comptoir · durée de conservation des documents sociaux.
