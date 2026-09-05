# L'application mobile

## Pour qui

Pour le client, pas pour l'agence. L'agence travaille sur ordinateur, au bureau.
Le client, lui, a le téléphone à la main et veut trois choses : où en est mon
dossier, qu'est-ce qu'il vous manque, où est ma marchandise.

## Ce qu'elle apporte de plus que le portail web

**Les notifications poussées.** C'est la seule vraie raison de faire une
application. Un message WhatsApp coûte de l'argent à chaque envoi, une
notification poussée ne coûte rien. Pour les rappels non urgents (pièce reçue,
dossier déposé, passeport prêt), l'application remplace le message payant.

Le reste, l'appareil photo pour envoyer une pièce, le suivi hors ligne, le
portefeuille de documents, vient en second.

## La pile

Expo et React Native, dépôt `mobile/` dans ce même dépôt. Les jetons de couleur
et de typographie sont repris de la version web, mais les composants sont ceux du
système : pas de clone en JavaScript d'un composant iOS natif.

Les notifications passent par Expo Notifications, adossé à APNs et FCM.

## Les écrans

1. Entrée par le lien reçu, ou par numéro de téléphone et code à quatre chiffres.
2. Mes dossiers, mes cargaisons.
3. Le détail d'un dossier : avancement, pièces à fournir avec l'appareil photo,
   rendez-vous, solde.
4. Le suivi d'une cargaison, étape par étape.
5. Les messages avec l'agence.
6. Les réglages : langue, notifications.

## L'ordre de construction

Le portail web d'abord, en service, utilisé, critiqué par de vrais clients.
L'application ensuite, une fois que les écrans ont cessé de bouger. Construire
l'application en premier, c'est payer deux fois chaque changement d'avis.
