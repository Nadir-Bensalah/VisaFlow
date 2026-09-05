# Ce qui reste, après les audits

Quatre agents ont relu le code : responsive, fidélité Apple, ergonomie et
complétude, rôles et accessibilité. Ce document liste ce qui a été corrigé et,
surtout, ce qui ne l'est pas encore. Aucun point n'est passé sous silence.

## Corrigé

**Rôles.** Une matrice de capacités unique (`lib/permissions.ts`) et un filtre de
périmètre (`data/scope.ts`) qui retire les données hors bureau avant l'affichage.
Les écrans ne lisent plus la base, ils lisent leur périmètre. Le chiffre
d'affaires sort du calcul pour qui n'y a pas droit, il n'est pas seulement
masqué. Session obligatoire, gardes de route, sélecteur d'identité supprimé de
la barre du haut.

**Configuration.** Équipe, modèles de message en quatre langues, types de visa,
listes de pièces et règles d'automatisation se créent, se modifient et se
suppriment. Décision de consulat, choix du moyen de paiement, rendez-vous depuis
l'agenda, tâches, cargaisons en création et en correction.

**Responsive.** Grilles en largeur disponible plutôt qu'en nombre de colonnes,
tableaux à première colonne figée et colonnes secondaires masquées, modales en
feuille montante, barre latérale en icônes entre 735 et 1068 px, cibles tactiles
de 44 px, zones sûres des encoches. Vérifié au navigateur : zéro débordement
horizontal sur quinze écrans à trois largeurs.

**Apple.** Courbe d'animation d'apple.com, cartes au filet plutôt qu'à l'ombre,
chevrons rendus aux menus déroulants, échelle d'espacement contrastée,
interlettrage par taille optique, trait d'icône constant à toutes les tailles,
illustrations au trait dans les états vides, entrée en scène échelonnée des
listes.

**Accessibilité.** Contrastes corrigés, focus piégé et rendu dans les modales,
lignes de tableau atteignables au clavier, lien d'évitement, étiquettes reliées,
onglets pilotables aux flèches, notifications qui durent et se ferment.

**Portail.** La page publique n'énumère plus les liens de suivi de tous les
clients : elle demande une référence. Les notes internes et le numéro de
connaissement n'en sortent plus.

## Pas encore fait, et pourquoi

**Le téléversement réel des fichiers.** Aucun `input type=file` dans le projet.
Côté client comme côté agent, une pièce se marque reçue sans qu'un fichier
circule. C'est le premier manque à combler, et il demande le stockage Supabase.

**L'envoi réel des messages.** Un message rédigé part dans une file qui
n'avance jamais. Tant que l'API WhatsApp n'est pas branchée, l'outil impose une
double saisie, et une double saisie se fait abandonner. Repli immédiat possible :
un lien `wa.me` avec le texte prérempli.

**La réception des messages entrants.** Rien ne crée un message entrant hors du
portail. Un client qui répond sur WhatsApp reste invisible, et la règle
« dossier sans activité » relance quelqu'un qui vient d'écrire.

**Trois actions d'automatisation sur quatre.** Seul l'envoi de message est
exécuté. Créer une tâche, alerter l'équipe et déplacer le dossier ne produisent
qu'une ligne de journal.

**L'argent des cargaisons.** `Payment` exige un dossier de visa : le modèle
interdit encore de facturer un transport. Il faut rendre `caseId` optionnel et
ajouter `shipmentId` sur les paiements, les messages, les tâches et les
rendez-vous.

**Le kanban au doigt.** Le glisser-déposer HTML5 ne marche pas sur téléphone. Il
faut un sélecteur d'étape sur la fiche, ou un appui long.

**Le tri et la pagination des tableaux.** Aucun en-tête n'est cliquable, aucune
liste n'est paginée. Au-delà de deux cents dossiers, ça se verra.

**Le thème sombre.** Aucune règle `prefers-color-scheme`. Les jetons sont déjà
structurés pour l'accueillir : c'est un bloc de vingt-cinq variables.

**Les fuseaux horaires.** `Office.timezone` existe et n'est jamais lu. Un
rendez-vous posé à Guangzhou s'affiche à l'heure de Tunis.

## Ce qui ne se réglera jamais côté navigateur

Toute la base vit dans le navigateur. Masquer une colonne ne protège rien : la
donnée est là, lisible en trois secondes dans les outils de développement. Le
cloisonnement par rôle et par bureau doit être rejoué côté serveur, en politique
de sécurité au niveau des lignes, avec les mêmes noms que
`lib/permissions.ts`. Le portail client, en particulier, doit appeler une
projection serveur qui ne renvoie que son propre dossier.

C'est écrit dans `08-supabase-schema.sql`. Ce n'est pas un détail à faire après :
c'est la condition pour que l'outil sorte de la démonstration.
