# Les acteurs et le terrain

Relevé au 7 septembre 2026. Chaque chiffre porte sa source. Ce qui n'a pas été trouvé est écrit « non trouvé », jamais comblé par déduction.

## 1. La taille du marché

| Indicateur | Valeur | Année |
|---|---|---|
| Demandes Schengen déposées depuis la Tunisie | **188 579** | 2025 |
| Visas délivrés | 149 805 | 2025 |
| Refus | **36 673, soit 19,6 %** | 2025 |
| Rang mondial de la Tunisie comme pays de dépôt | **15e** | 2025 |
| Part de multi-entrées délivrées | 52,6 % | 2025 |
| France seule, décisions | 115 968, refus 15,4 % | 2025 |
| Agences de voyages licenciées ONTT | **1 672**, dont **706 dans le Grand Tunis** | 2023 |
| Demandes libyennes vers UE et Royaume-Uni | 38 725, refus 16 % | 2025 |
| Frais perdus par les Libyens sur les refus | plus de 568 700 euros | 2025 |

Ordre de grandeur du marché adressable : environ **190 000 dossiers Schengen par an** depuis la Tunisie, plus une partie des **38 725 dossiers libyens** déposés à Tunis, plus les visas non Schengen (Canada, Royaume-Uni, Turquie, Chine, Golfe) qui ne figurent dans aucune statistique agrégée.

## 2. Les taux de refus par consulat, données officielles de la Commission européenne

Le refus n'est pas une moyenne nationale, c'est une propriété du consulat. Écarts relevés sur 2025 :

| Consulat à Tunis | Taux de refus | Part de multi-entrées |
|---|---|---|
| Tchéquie | **46,3 %** | faible |
| Belgique | 40,8 % | faible |
| Italie | 32,0 % | moyenne |
| France | 15,4 % | élevée |
| Écart observé sur la part de multi-entrées, tous consulats | | **de 12,6 % à 99,1 %** |

**Conséquence produit.** Un logiciel qui affiche un taux de refus global ment à l'agence. Le taux utile est par couple (consulat, type de visa, profil du demandeur). C'est une donnée que l'agence peut produire elle-même à partir de son propre historique, et c'est ce qui rend le logiciel irremplaçable au bout de six mois.

## 3. Le vrai goulot : le créneau, pas le dossier

C'est le fait le plus important de toute l'étude.

- Deux centres TLScontact seulement pour toute la Tunisie : **Tunis (Les Berges du Lac) et Sfax**.
- La rareté du créneau a créé un marché parallèle des rendez-vous.
- Un concurrent, **tls-visa.com**, ne vend pas de gestion de dossier : il vend des **alertes de créneau**.
- Sur un ticket client d'environ **550 TND**, la part attribuable à l'obtention du rendez-vous est estimée entre **200 et 350 TND**. Le reste (montage du dossier, traduction, assurance) est peu margé.

**Conséquence produit.** Le module qui compte le plus n'est pas le suivi de dossier, c'est la **file d'attente de rendez-vous** : qui attend quoi, depuis quand, pour quel consulat, avec quelle priorité, et qui a été servi. Une agence qui ne sait pas dire à un client « vous êtes 4e sur la liste Italie » perd le client.

## 4. Les concurrents et ce qu'ils ne font pas

| Acteur | Ce qu'il fait | Ce qu'il ne fait pas |
|---|---|---|
| **Traveltodo** | Le plus gros acteur tunisien du voyage en ligne | Admet publiquement **ne pas offrir de suivi de dossier en ligne** |
| **tls-visa.com** | Alertes de créneaux TLScontact | Aucune gestion de dossier, aucun portail client |
| **Amadeus / BSP** | Déjà installé dans les agences pour la billetterie | Ne touche pas au visa |
| **Hesabi** (comparable SaaS tunisien) | Comptabilité, **390 / 790 / 2 490 DT par an**, facturation annuelle uniquement | Sert de repère de prix, pas de concurrent |
| **WhatsApp** | Le vrai concurrent. C'est là que tout se passe aujourd'hui | Aucune trace, aucune recherche, aucun rôle, aucune reprise après le départ d'un employé |

Le concurrent à battre n'est pas un logiciel, c'est **le fil WhatsApp d'un employé sur son téléphone personnel**.

## 5. Les processus consulaires, ce qui change tout

### Les pièces dépendent du statut, pas seulement du pays
Une checklist « France » n'existe pas. Il existe une checklist **France + salarié**, une **France + indépendant**, une **France + étudiant**, une **France + retraité**, une **France + sans emploi**, une **France + mineur**. Les pièces de revenu, d'attestation d'employeur et d'autorisation parentale changent complètement. Un logiciel qui n'a qu'un axe « pays » est inutilisable dès le premier dossier.

### La biométrie a une durée de vie
Les empreintes sont réutilisables **59 mois**. Un client dont la biométrie est encore valide n'a pas besoin de se déplacer, ce qui change le prix, le délai et le créneau nécessaire. C'est une donnée à stocker avec sa date d'expiration et à faire remonter en alerte.

### Deux catégories de traitement
**PRIMO** (première demande) et **VISE** (déjà visé) n'ont ni les mêmes pièces, ni les mêmes délais, ni le même taux de refus.

### Le recours après refus
Contradiction relevée dans les sources sur le délai de recours devant la **CRRV** : **30 jours** selon certaines, **2 mois** selon d'autres. Le logiciel doit donc stocker le délai comme **paramètre par consulat**, avec sa source et sa date de vérification, jamais comme une constante codée en dur.

### Le calendrier réglementaire européen
| Échéance | Fait |
|---|---|
| **10 avril 2026** | **EES** pleinement opérationnel (enregistrement des entrées et sorties, fin du tampon) |
| ~2027 | **ETIAS** reporté |

L'EES change la donnée à collecter (biométrie faciale, comptage des jours de séjour) et crée une question client récurrente : « combien de jours me reste-t-il sur mes 90 jours ? ». Un compteur 90/180 dans le portail client est une fonctionnalité que personne n'offre en Tunisie.

## 6. Le marché libyen, second pilier

Les Libyens déposent leurs dossiers **à Tunis**, et ce n'est pas un choix : leurs ambassades à Tripoli sont évacuées.

| Pays | Où un Libyen dépose |
|---|---|
| **Autriche** | Tunis ou Le Caire, formulation officielle explicite |
| **France** | Consulat général de France à Tunis ou au Caire, dépôt chez TLScontact Tunis |
| **Suisse** | Ambassade à Tunis, avec des mémentos distincts « résidents en Libye », **en anglais uniquement** |
| **Royaume-Uni** | Aucun service consulaire en Libye, assistance depuis Tunis |
| **États-Unis** | **Interdiction totale** depuis le 9 juin 2025, marché à zéro |

Trois faits qui commandent la conception :

1. **Le titre de séjour tunisien ne peut pas être obligatoire.** En 2015, seuls **530 Libyens** résidant en Tunisie avaient une carte de séjour. Si la checklist exige un justificatif de résidence, tous les clients libyens tombent.
2. **Toutes les compagnies aériennes libyennes sont interdites dans l'Union européenne.** Un Libyen qui part en Europe transite donc par Tunis. Entre 10 et 23 vols quotidiens relient les deux pays.
3. **La correspondance des noms est un problème d'État.** Elle figure comme condition à part entière dans l'accord frontalier tuniso-libyen de juin 2024. Le même individu n'est pas orthographié pareil des deux côtés. Le rapprochement d'un dossier avec une pièce **ne peut pas reposer sur l'égalité stricte des chaînes de caractères**.

Langue : arabe d'abord, **anglais ensuite, français seulement pour le bureau de Tunis**. Des étudiants libyens abandonnent leur cursus en Tunisie parce que les cours sont en français. Une interface qui met le français en avant côté client libyen est morte.

Terminaux : **Android 84,7 %** en Libye, Chrome mobile 71,9 %, débit mobile médian 25 Mbps contre 67 Mbps en Tunisie. Facebook et Messenger touchent 6,7 et 4,9 millions de personnes sur 7,5 millions d'habitants. LinkedIn et X sont négligeables.

## 7. Sources

Commission européenne, statistiques de visas court séjour par consulat, 2022 à 2025 · ONTT, liste des agences licenciées 2023 · Lago Collective, coût des refus 2025, via Tunisie Numérique · BMEIA ambassade d'Autriche à Tunis · Chambre de commerce franco-libyenne · Ambassade de Suisse en Tunisie · gov.uk Libya · DataReportal Digital 2026 Libya et Tunisia · Statcounter août 2026 · L'Économiste Maghrébin, accord frontalier du 13 juin 2024.
