# Le fret Chine vers Tunisie et Libye, et la douane

Relevé au 7 septembre 2026. Niveaux de fiabilité : **[OFF]** source officielle, **[IND]** indice de marché ou cabinet de référence, **[COM]** site commercial, ordre de grandeur seulement. Ne jamais coder en dur ce qui vient de [COM].

## 1. Le fait qui commande toute la modélisation

**Il n'existe aucune ligne directe Chine vers Radès.** [OFF] Les onze lignes conteneurs régulières desservant Radès viennent toutes de Méditerranée : Malte, Gioia Tauro, Valence, Algésiras, Le Pirée, Marseille, Gênes, Barcelone.

La cause est physique, pas commerciale : le tirant d'eau des postes porte-conteneurs de Radès est de **-8,8 m**. Aucun grand porte-conteneurs asiatique ne peut y toucher.

**Conséquence.** Toute expédition Chine vers Radès comporte au moins un transbordement. Le champ **port de transbordement** et le champ **date de connexion feeder** sont obligatoires, pas optionnels. Le retard le plus fréquent n'est pas sur le long-courrier, il est sur le raccordement au feeder.

Ne jamais stocker un « transit time » unique. Trois champs : **leg long-courrier**, **attente au hub**, **leg feeder**. C'est ce qui explique l'écart des durées annoncées, de 21 à 54 jours selon les sources.

| Origine | Destination | Durée | Source |
|---|---|---|---|
| Hong Kong | Radès | 23 j | [COM] |
| Shanghai | Radès | 27 à 40 j | [COM] |
| Qingdao | Radès | 32 à 45 j | [COM] |
| Shanghai (Taicang) | Tunis, 2 transbordements, CMA CGM | **48 j 16 h** | [IND] |
| Shanghai Pudong | Tunis Carthage, aérien, 1 correspondance | **20 h 39** | [IND] |

Congestion relevée à Radès : **6 jours d'attente navire**, 63 % des expéditions n'arrivent pas à l'heure. [COM]

Radès concentre **79 % du tonnage conteneurisé national et 76 % du trafic en EVP**. [OFF] Le pays entier ne voit qu'environ **28 escales conteneurs par mois**, tous ports confondus.

Sfax est desservi par 6 lignes, dont une qui touche **El Khoms et Misrata** en Libye. Deux manutentionnaires apparaissent, **STAM** et **GMS** : c'est le manutentionnaire qui facture le magasinage, pas l'armateur.

## 2. Aucun accord préférentiel avec la Chine

[OFF] La liste officielle des partenaires ouvrant droit à un certificat d'origine préférentiel est : Maroc, Jordanie, Égypte, Libye, Koweït, Algérie, Mauritanie, Palestine, Syrie, Soudan, Iran, plus la zone Pan-Euro-Med et la Grande Zone Arabe de Libre Échange. **La Chine n'y est pas.**

| Point | Règle à coder |
|---|---|
| Régime tarifaire d'une marchandise chinoise | **NPF plein**, aucun taux préférentiel |
| Certificat d'origine chinois | **Exigé au dossier**, mais origine **non préférentielle**, aucun avantage tarifaire |
| Case de la déclaration | **Case 32** (origine) |
| Codes 404 et 971 en case 42/2 | **Doivent être bloqués** par le logiciel si origine = CN |

Règle d'origine non préférentielle tunisienne : pays de la **dernière transformation**, article 21 du code des douanes, critère de **40 % de valeur ajoutée locale** du prix départ usine.

## 3. La cascade fiscale, entièrement documentée

C'est la partie officielle et stable. Elle est codable telle quelle.

```
VD_CAF   = prix facture + ajustements art.30 - déductions art.31
           converti au TAUX DU JOUR D'ENREGISTREMENT DE LA DÉCLARATION (art. 33)
DD       = VD_CAF x taux droit de douane            [assiette A]
DC       = VD_CAF x taux droit de consommation      [assiette A]
FODEC    = VD_CAF x taux FODEC                      [assiette A]
base_TVA = VD_CAF + DD + DC + FODEC + taxes 0xx     [assiette B]
           si NON assujetti  ->  base_TVA x 1,25    (lettre M)
TVA      = base_TVA x taux
somme_dt = DD + DC + FODEC + TVA + taxes sectorielles
RPD      = max(somme_dt x 3% ; 10 DT x NOMBRE D'ARTICLES)   [assiette Y]
total_dt = somme_dt + RPD
si code 480 présent :
AIR      = (VD_CAF + total_dt) x 10%                [assiette O]
```

**Les trois pièges.** Le droit de consommation entre dans l'assiette de la TVA. La majoration de 25 % frappe le non-assujetti. Le minimum de RPD de 10 DT est **par article de déclaration**, pas par déclaration.

Structure du code tarifaire : 6 caractères SH, 2 caractères NC européenne, 1 caractère tarif national, 1 caractère NGP, plus une clé de contrôle. L'ensemble forme la **NDP**, portée en **case 39**.

Deux champs du tarif à récupérer impérativement : le **titre CCEC** (L = libre, P = exclu du régime de liberté, donc autorisation d'importation obligatoire) et **MP5** (règlement possible par obligation cautionnée).

## 4. Valeur en douane, ce qui s'ajoute et ce qui se retranche

[OFF] Articles 22 à 35 du code des douanes, loi 2008-34.

**S'ajoutent (art. 30), liste limitative** : commissions à la vente et courtage, contenants et emballages (**conteneurs exclus**), apports matériels gratuits, apports intellectuels **exécutés hors de Tunisie**, redevances et licences conditionnant la vente, produit de la revente, et **transport, assurance, manutention, chargement et déchargement jusqu'au lieu d'introduction en Tunisie**.

**Se retranchent (art. 31), liste limitative** : transport et assurance **après** importation, montage et assistance technique, droits de reproduction, **commissions à l'achat**, droits et taxes payés en Tunisie (cas du DDP), coût des données d'un logiciel.

**Règle absolue à coder comme validation de saisie :** un élément retranchable qui n'est pas **facturé distinctement** n'est pas retranché.

## 5. Les trois compteurs qu'il ne faut jamais confondre

C'est là que les importateurs perdent le plus d'argent.

| Notion | Qui facture | Sur quoi | Départ du compteur |
|---|---|---|---|
| **Surestaries (demurrage)** | La compagnie maritime | Conteneur **resté dans le terminal** | Fin des jours francs après déchargement |
| **Détention (detention)** | La compagnie maritime | Conteneur **sorti et non restitué** | Sortie du terminal |
| **Magasinage (storage)** | Le manutentionnaire (STAM, GMS) | **Stationnement de la marchandise** | Fin du délai franc portuaire |

Trois factures, trois compteurs, trois débiteurs. Formule constante : `jours de dépassement x tarif journalier x nombre de conteneurs`. Jours francs typiques 3 à 7. Tarifs progressifs par paliers à partir du 3e ou 4e jour, majoration de 30 à 50 % en période de congestion. [COM]

**Les tarifs tunisiens ne sont pas publics.** Le site de la STAM renvoie une erreur de base de données, le barème portuaire officiel (arrêté du 18 juillet 2017) est un PDF scanné. Les pages tarifaires de CMA CGM, Maersk et Hapag-Lloyd Tunisie renvoient 403 ou 404.

**Donc :** tarifs et jours francs sont des **paramètres saisis par l'utilisateur**, par armateur, par port et par type de conteneur, avec historique de validité. Aucune valeur par défaut ne doit être livrée. Les **règles de calcul**, elles, sont stables et codables.

## 6. Le groupage, et la solidarité de fait entre clients

Le conteneur est une unité douanière et physique indivisible. Il ne se dépote qu'une fois, pour tout le monde en même temps.

| Cause de blocage chez un client | Effet sur les autres lots |
|---|---|
| Fret impayé, document manquant | Le conteneur reste plein, tout le monde attend |
| Marchandise prohibée ou dangereuse non déclarée | **Contrôle renforcé sur tout le conteneur**, refus de dépotage possible |
| Contrôle douanier physique sur un lot | **Conteneur entier immobilisé** jusqu'à la fin de la visite |

**Règle métier à implémenter :** un lot ne bloque les autres que **tant que le conteneur n'est pas dépoté**. Il faut donc deux jalons distincts, `date_depotage_conteneur` et `date_liberation_lot`. C'est entre ces deux dates que la solidarité existe.

**Deux connaissements, jamais un.** Le **Master B/L** est émis par l'armateur au nom du groupeur ; le **House B/L** est émis par le groupeur au client final. L'importateur n'a **jamais** le Master B/L. Deux entités en base, relation un à plusieurs, statut de libération propre à chacune (original endossé, telex release, express release).

**Facturation.** Règle **W/M** : on facture le plus élevé du poids en tonnes et du volume en CBM, minimum **1 CBM**. Le dépotage se répartit au prorata du CBM, mais les **frais de documentation sont un forfait par House B/L**. C'est ce qui rend les très petits lots non rentables, et cela doit apparaître explicitement dans le devis. Bascule LCL vers FCL autour de **10 à 15 CBM**. Volume chargeable réel, pas géométrique : 20' 25 à 28 CBM, 40' 55 à 60, 40'HC 60 à 68.

## 7. Les documents et les délais durs

| Document | Émetteur | Si absent |
|---|---|---|
| **TCE domicilié** | L'importateur via sa banque, sur TTN | Pas de dédouanement, **pas de transfert de devises** |
| **DCT** (contrôle technique) | Ministère du Commerce ou organisme technique | Pas de mise à la consommation |
| **DDM** | Commissionnaire en douane agréé, dans SINDA | Rien ne sort du port |
| Certificat d'origine | CCPIT ou douane chinoise | Case 32 non justifiable |

| Délai | Valeur | Base |
|---|---|---|
| Dépôt de la déclaration sommaire en MAD | **1 jour franc** après arrivée, dimanches et fériés non comptés | [OFF] |
| Séjour maximum en magasin ou aire de dédouanement | **15 jours** | [OFF] |
| Entrepôt public | 5 ans | [OFF] |
| Entrepôt privé | 2 ans, prorogeable | [OFF] |

Le **TCE** existe en cinq formes (autorisation d'importation, facture commerciale, admission temporaire, facture définitive à l'export, autorisation d'exportation). Il est fractionnable. Il faut le **modifier** si la désignation change, ou si le prix ou la quantité **augmente de plus de 10 %**. Au-delà, nouveau titre et annulation de l'ancien.

Le **contrôle technique** se dépose **avant l'arrivée de la marchandise**, avec sept pièces dont un dossier technique et le certificat d'origine. Quatre décisions possibles : enlèvement provisoire, inspection sur place avant paiement des droits, mise à la consommation directe, ou réexportation et destruction. La décision part automatiquement à la douane.

Le **commissionnaire en douane** exerce à titre **personnel**, sur des bureaux nommément désignés, avec un **code en douane de 7 chiffres plus une lettre de contrôle** et une obligation de conservation de **3 ans**. 220 fiches sur l'annuaire officiel. Le barème d'honoraires n'est pas public : **non trouvé**.

## 8. La règle de fer du change

> La loi tunisienne **interdit la sortie de devises en paiement d'importations avant présentation à la banque des documents confirmant l'expédition**. [OFF]

**Conséquence directe :** c'est le transitaire qui produit les pièces qui débloquent le paiement du fournisseur. Un retard de transitaire est un retard de paiement fournisseur. Le connaissement et la déclaration imputée ne sont pas des documents logistiques, ce sont les **clés du transfert bancaire**.

Autres bornes [OFF] : déclaration obligatoire des devises au-delà de **20 000 DT** ; allocation touristique **6 000 DT par année civile** pour un résident, ce qui ne finance pas des acomptes fournisseurs ; carte technologique internationale plafonnée à **1 000 DT** pour une personne physique et **10 000 DT** pour une personne morale (circulaire BCT 2016-9). Les acomptes passent obligatoirement par le circuit bancaire domicilié.

## 9. Les Incoterms, et le piège du FOB en groupage

FOB domine pour une raison documentaire : les crédits documentaires exigeaient un connaissement portant « mis à bord », que FCA ne permettait pas d'obtenir avant la révision 2020. La révision a corrigé le problème, l'habitude non.

**Le piège en LCL.** Sous FOB, le risque passe à la mise à bord. Or le vendeur livre au CFS, la marchandise est empotée avec celle d'autres chargeurs, et le conteneur ne part que quand il est plein. Il peut s'écouler une semaine. Pendant tout ce temps le vendeur porte le risque sur une marchandise qu'il ne contrôle plus, confiée à un groupeur qu'il n'a pas choisi. Avec un conteneur scellé, il est en outre **impossible de dire quand le dommage est survenu**. **FCA au CFS est la règle correcte.**

**CIF impose l'assurance la plus faible.** CIF exige les **Institute Cargo Clauses (C)**, les plus restrictives ; **CIP exige les clauses (A)**, les plus larges. Acheter CIF Radès, c'est accepter une couverture minimale sur 25 000 km avec transbordement. Montant imposé : **110 % de la valeur du contrat**. Guerres et grèves ne sont jamais dans le socle.

**Recommandation par situation :**

| Situation | Incoterm correct |
|---|---|
| FCL avec transitaire | **FCA** port ou terminal chinois |
| **Groupage LCL** | **FCA au CFS** |
| Vrac non conteneurisé | FOB, son seul domaine légitime |
| Port à port sans transitaire | **CIP** plutôt que CIF |
| Aérien, ou tronçon terrestre vers la Libye | FCA, CPT, CIP, DAP. Les règles maritimes sont inapplicables |
| Prix rendu magasin demandé au fournisseur chinois | **Éviter le DDP** : le vendeur ne peut pas être importateur légal en Tunisie, et l'acheteur perd la déclaration à son nom, donc la **récupération de TVA** |

## 10. La Foire de Canton et le sourcing

[OFF] Trois phases de 5 jours, calendrier très stable : phase 1 à partir du 15 avril et du 15 octobre, phase 2 à partir du 23, phase 3 à partir du 1er mai et du 31 octobre. 139e session en avril et mai 2026, 140e en octobre et novembre 2026, 70e anniversaire. Environ **32 000 exposants** et **314 000 acheteurs étrangers** de 220 pays.

**Le visa d'affaires catégorie M est obligatoire pour un Tunisien comme pour un Libyen.** Ni l'un ni l'autre ne figure dans les 55 pays exemptés unilatéralement par la Chine. L'accord bilatéral tunisien ne couvre que les passeports **diplomatiques et de service**, entrée n° 57 de la liste officielle. La Libye ne figure dans aucun accord d'exemption. À ne pas confondre : la Tunisie exempte les touristes chinois, **l'exemption n'est pas réciproque**.

Le badge acheteur est **gratuit** en pré-enregistrement en ligne, approbation en 3 à 7 jours ouvrés, retrait sur place contre passeport, photo 5x4 cm, carte de visite et reçu imprimé. La carte est **valable pour plusieurs sessions**. Budget séjour de 5 jours : 2 000 à 3 000 USD. [COM]

**Alternative permanente : Yiwu.** 5 500 000 m², plus de 75 000 boutiques, ouvert toute l'année, forte présence de commerçants du Moyen-Orient et d'Afrique. Canton est un rendez-vous à date fixe orienté fabricants et grosses quantités ; Yiwu est un marché permanent orienté petites quantités. **Pour un importateur qui rachète en groupage, Yiwu correspond souvent mieux.**

## 11. La Libye, ce qui change le 30 septembre 2026

**Décision 449/2026 du ministre libyen de l'Économie, datée du 6 septembre 2026 :** à compter du **30 septembre 2026**, toute importation de marchandises destinées au commerce **hors des circuits bancaires officiels est interdite**, quel que soit le mode de transport ou le point d'entrée. Les expéditions ne pourront être dédouanées qu'après satisfaction complète des obligations bancaires, commerciales et douanières, **et production de la preuve documentaire de la valeur réelle**. Exception étroite pour les petits commerçants sous licence, dans une limite annuelle.

Contexte : 11 sociétés détectées en janvier 2026 pour 54 millions USD transférés sans importation réelle, 85 suspendues en février pour 130 millions, **500 sociétés sur liste noire en septembre 2026** pour fraude aux crédits documentaires. Le mécanisme : obtenir un crédit documentaire au taux officiel favorable, puis sous-importer ou ne rien importer, et empocher l'écart de change.

**Conséquence :** après le 30 septembre 2026, espèces, hawala, paiement par un tiers et sous-facturation ne permettent plus de sortir la marchandise du port. Toute facture émise par une agence tunisienne à un client libyen sera regardée comme une pièce potentielle de justification d'achat de devises.

**Le port qui compte est Misrata**, seul à avoir le tirant d'eau (16,2 m), la zone franche de 3 539 hectares, le terminal et, depuis janvier 2026, un partenariat de 2,7 milliards USD avec MSC. Une **ligne directe Chine vers Libye existe depuis mai 2026**. Depuis juillet 2026, les banques libyennes sont connectées au système de paiement chinois **CIPS** et règlent directement en yuan.

**Le tronçon terrestre Tunisie vers Libye est le maillon le moins fiable de toute la chaîne.** Ras Jedir porte **71,5 % du trafic terrestre transfrontalier** et a été **fermé trois mois pleins** en 2024, sur décision politique et sans préavis, pour un coût mesuré de **249,3 millions de dinars** d'exportations perdues au seul premier semestre. Autres arrêts documentés : panne du système informatique douanier tunisien (17 juin 2026), coupure d'électricité au poste (18 septembre 2025), blocage après arrestation de commerçants (15 mars 2026). Aucun Incoterm ne protège de cela : il faut une clause de force majeure nommant explicitement la fermeture du poste, ou un routage maritime direct sur Misrata.

## 12. Ce qui n'a pas été trouvé, et qu'il ne faut pas inventer

Tarifs de magasinage STAM et GMS · jours francs et tarifs de surestaries des armateurs sur Radès · barème d'honoraires de commissionnaire en douane · nomenclature officielle des circuits vert, orange, rouge et leurs délais · délais réglementaires du contrôle technique · durée de validité du TCE domicilié et commissions bancaires · liste des produits soumis à l'AIR de 10 % · taux exact du FODEC par position · délai légal de dépôt de la déclaration en détail · transit times Chine vers Misrata · fiscalité libyenne à l'import · statut de la Libye au Joint War Committee · régime de transit douanier tunisien vers la Libye · ratio W/M officiel pour la lane Tunisie · tarifs d'abonnement TTN.

Tous ces points sont des **paramètres à saisir**, pas des constantes à livrer.
