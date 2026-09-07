# L'argent, le droit et la conformité

Relevé au 7 septembre 2026. C'est la section qui contient les contraintes non négociables du produit.

## 1. La règle absolue : VisaFlow n'encaisse jamais l'argent des clients de l'agence

Collecter des fonds pour le compte de tiers en Tunisie relève d'un agrément de la Banque Centrale. Le précédent est connu : les fonds de **Paymee ont été gelés en février 2023 par la CTAF** pour exactement cela.

**VisaFlow facture l'agence, et seulement l'agence.** L'agence encaisse ses clients elle-même, par ses propres moyens, et VisaFlow ne fait qu'**enregistrer** cet encaissement. La distinction n'est pas cosmétique : elle est la différence entre un logiciel et un établissement de paiement non agréé.

## 2. Ce qu'on ne peut pas faire en Tunisie, et qui casse les modèles SaaS habituels

| Contrainte | Conséquence produit |
|---|---|
| **Pas de paiement récurrent par carte** en Tunisie | Aucun abonnement mensuel prélevé automatiquement. Facturation annuelle ou trimestrielle, sur facture, comme **Hesabi** qui ne vend qu'à l'année (390 / 790 / 2 490 DT) |
| **Stripe ne couvre pas la Tunisie** | Aucun des tutoriels SaaS standards n'est applicable. Passerelles locales : **Konnect** (1,3 % carte tunisienne, 2,9 % carte internationale, 2 TND le virement), **Paymee**, **Flouci** |
| Le **dinar tunisien n'est pas convertible**, code des changes de **1976** toujours en vigueur | Facturer un client libyen en devises demande une validation par un expert-comptable tunisien, pas par une recherche web |
| **Facturation électronique TTN obligatoire pour tous les prestataires de services au 1er janvier 2026** | Le module de facturation doit produire un format acceptable par TTN. Ce n'est pas une option |
| Une carte émise en Libye passe-t-elle le 3-D Secure d'une passerelle tunisienne ? | **Non trouvé.** À tester en conditions réelles avant de bâtir dessus |

**Réformes en cours, aucune n'est votée.** Proposition de loi n° 115/2025 portant code des changes, déposée le 20 octobre 2025, première lecture en commission des finances, dernière réunion le 1er juin 2026, **plénière non commencée**. Loi de finances 2026 (loi 2025-17 du 12 décembre 2025), **article 98** : ouverture de comptes en devises ou en dinars convertibles par les résidents sans autorisation préalable de la BCT. Le texte littéral de l'article 98 n'a pas pu être vérifié, le JORT étant publié en scan.

## 3. Le dinar libyen, et pourquoi un devis ne tient pas

Taux officiel au 7 septembre 2026 : 1 USD = 6,3405 / 6,3723 LYD ; 1 EUR = 7,3423 / 7,3791 LYD.

Dévaluations publiées par la Banque centrale de Libye elle-même : **70 % en janvier 2021, 13,3 % en avril 2025, 14,7 % le 18 janvier 2026**. Dépréciation de 17,44 % sur douze mois.

**Deux dévaluations en moins d'un an.** Un devis libellé en dinars libyens perd sa valeur pendant sa durée de validité.

**Règle produit :** facturer en euros ou en dollars, et **convertir à la date d'encaissement, pas à la date de devis**. Nuance à connaître : Dar al-Ifta a rendu en septembre 2026 un avis selon lequel fixer un taux de change à l'avance n'est pas licite, le taux devant être convenu au moment de l'exécution. Une partie de la clientèle contestera un taux figé au devis.

## 4. L'espèce est la réalité, pas l'exception

Saisies documentées à Ras Jedir : 500 000 dollars et 234 620 euros dans la carrosserie d'un véhicule entrant en Libye depuis la Tunisie (12 juin 2026) ; 945 700 dollars et 14,6 kg d'or en sortie de Tunisie (5 décembre 2025) ; devises pour 1,5 million de dinars (7 novembre 2025).

Le précédent du tourisme médical dit la même chose autrement : les cliniques tunisiennes adressaient la facture aux consulats libyens **après le départ du patient**, l'État libyen n'a pas payé, la dette a atteint **218 à 270 millions de dinars**, et les cliniques ont cessé d'accepter les patients libyens.

**Ce que le logiciel doit savoir faire, sans quoi il ne sert à rien sur ce marché :**

- Enregistrer un encaissement **en espèces**, **en devise étrangère**, **partiel**, **en plusieurs fois**.
- Rattacher une facture à un **payeur qui n'est pas le bénéficiaire du service** (un oncle paie pour son neveu, une entreprise pour son salarié).
- Ne jamais proposer par défaut le paiement différé contre facture adressée à une institution. Ce modèle a déjà échoué une fois, à grande échelle.

## 5. Les données personnelles : le point juridique le plus inconfortable

**Le droit applicable est la loi 2004-63** et le décret n° 2007-3004 du 27 novembre 2007.

| Point | Règle |
|---|---|
| Déclaration préalable | **1 mois**, le défaut d'opposition **vaut acceptation** (art. 9) |
| Autorisation (dont transfert à l'étranger, art. 52) | **1 mois**, l'absence de réponse **vaut refus implicite** (art. 12) |
| Dépôt | Papier ou électronique, contre récépissé, ou lettre recommandée, ou tout moyen laissant trace écrite |
| Frais | Aucun frais ni timbre prévu par le décret. Mention officielle du mot « gratuit » : non trouvé |
| Portail de télédéclaration en service | **Non trouvé** |

**Et voici le problème.** Au 7 septembre 2026, **inpdp.tn, inpdp.nat.tn et inpdp.gov.tn ne résolvent plus en DNS**. Le site de l'autorité n'existe plus. Nawaat décrit le 1er septembre 2026 une instance **gelée depuis 2023**. Le portail de la présidence du gouvernement pointe toujours vers l'ancienne adresse.

Le délai légal d'un mois existe donc sur le papier, mais l'autorité censée le tenir est décrite comme gelée et son site a disparu. **Aucun délai réel ne peut être promis à une agence.** Et ce n'est pas nouveau : dans son propre rapport d'activité 2018-2021, l'INPDP reconnaît que **279 dossiers ont dépassé 90 jours**, certains ajournements atteignant **537 jours**. Le relevé complet du cadre légal est dans [04-cadre-legal.md](04-cadre-legal.md), avec deux découvertes majeures : l'**article 22** impose que le sous-traitant soit de **nationalité tunisienne et résident en Tunisie**, et le décret-loi 2023-17 impose un **audit de sécurité tous les 12 mois**.

Une réforme est déposée : **proposition de loi organique n° 095/2025**, déposée le 14 juillet 2025, commission des droits et libertés, auditions jusqu'au 3 juin 2026, **plénière non commencée**. Point à surveiller : son **article 51 dispenserait le responsable de traitement d'obtenir l'autorisation de l'instance pour transférer des données vers l'étranger**. Si ce texte passe, la contrainte d'hébergement s'allège considérablement. Tant qu'il n'est pas voté, elle reste entière.

**Ce que cela impose au produit, aujourd'hui :**

1. Déclaration préalable à l'INPDP avant tout traitement de passeports réels, avec la preuve de dépôt archivée.
2. Hébergement à l'étranger (Supabase, région Paris) : **autorisation de transfert au titre de l'article 52, plus consentement écrit du client**. Le consentement doit être une donnée du dossier, horodatée, révocable, exportable.
3. Purge automatique à échéance, avec une politique de rétention par type de pièce. Un passeport scanné n'a pas la même durée de vie qu'une facture.
4. Journal d'accès aux pièces : **qui a ouvert quel document, quand**. C'est à la fois une exigence de conformité et le seul moyen de savoir qui a fait fuiter un passeport.

## 6. Le passeport physique, et la responsabilité qui va avec

L'agence détient des passeports originaux. C'est le bien le plus précieux du client, et le coût d'une perte est disproportionné : un passeport libyen coûte **50,5 dinars libyens** à délivrer et **1 000 dinars** à remplacer en cas de perte, soit vingt fois plus.

**Le registre de garde de passeports n'est pas un confort, c'est la couverture juridique de l'agence.** Il lui faut : qui a déposé, quand, quel numéro, quelle date d'expiration, dans quel coffre, qui l'a sorti et pour quoi, qui l'a rendu, contre quelle signature, et un blocage de la restitution tant que le solde n'est pas soldé.

## 7. Le nom, donnée non fiable par nature

Il n'existe pas de standard de translittération des noms arabes en caractères latins. Le problème est **officiellement reconnu au niveau des États** : la « correspondance des noms des citoyens entre les deux pays » figure comme l'une des six conditions de réouverture de Ras Jedir en juin 2024.

**Règle de modélisation :** stocker le nom **en arabe comme donnée de référence**, et traiter chaque version latine comme une **variante parmi d'autres**, avec sa source (passeport, acte de naissance, réservation d'hôtel, formulaire consulaire). Le rapprochement d'un dossier avec une pièce ne peut jamais reposer sur l'égalité stricte des chaînes.

Un rapprochement fondé sur le **numéro de passeport plus la date de naissance** est fiable. Un rapprochement fondé sur le nom ne l'est pas.

## 8. Les dix événements qui peuvent arrêter l'activité du jour au lendemain

Classés par probabilité observée sur 2024 à 2026, chacun appuyé sur un fait réel.

1. **Fermeture de Ras Jedir sur affrontement armé.** 19 mars 2024, plus de trois mois, 249,3 MDT perdus au premier semestre.
2. **Panne du système douanier informatique.** 17 juin 2026, arrêt total du trafic, côté tunisien.
3. **Coupure d'électricité au poste frontière.** 18 septembre 2025.
4. **Blocage de protestation après arrestation de commerçants.** 15 mars 2026.
5. **Changement réglementaire libyen sans préavis.** Interdiction des imports hors circuits bancaires annoncée le 6 septembre 2026 pour le 30 septembre : **24 jours de préavis**.
6. **Dévaluation du dinar libyen.** Deux en moins d'un an.
7. **Fermeture de l'aéroport de Mitiga sur combats à Tripoli.** Mai 2025.
8. **Blocage des installations pétrolières libyennes**, donc des recettes en devises de l'État. Août et septembre 2024.
9. **Fermeture d'un guichet consulaire à Tunis.** Toute la chaîne libyenne repose sur des postes qui traitent les Libyens par dérogation, parce que leurs ambassades à Tripoli sont évacuées. Rien ne garantit la permanence de cet arrangement.
10. **Changement de politique de visa d'un pays de destination.** Précédent le plus brutal : les États-Unis, interdiction totale pour les Libyens, du jour au lendemain, le 9 juin 2025.

**Conséquence produit.** Un bandeau d'alerte réglementaire, alimenté à la main par l'éditeur et diffusé à toutes les agences, a une valeur réelle. Une agence qui apprend par son logiciel qu'un poste est fermé avant de l'apprendre par un client a une raison de payer l'abonnement.

## 9. Sources

Décret n° 2007-3004 du 27 novembre 2007 · Proposition de loi organique 095/2025, arp.tn/loi/project/4237 · Nawaat, 1er septembre 2026 · Proposition de loi 115/2025, arp.tn/ar_SY/loi/project/4259 · Loi de finances 2026, loi 2025-17 du 12 décembre 2025 · Circulaire BCT 2016-9 du 30 décembre 2016 · Banque centrale de Libye, politique de taux de change · Libya Herald, 6 et septembre 2026 · Konnect, Paymee, Flouci · Wikipedia, Libyan passport · L'Économiste Maghrébin, 13 juin 2024 et 29 août 2024.
