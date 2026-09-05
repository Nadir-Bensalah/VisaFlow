# WhatsApp

C'est la décision technique qui décide du sort du produit. L'agence vit sur
WhatsApp. Un outil qui ne parle pas WhatsApp est abandonné en trois semaines.

## Le choix

L'API Cloud de Meta, en direct, sans revendeur. L'accès à la plateforme est
gratuit. Depuis juillet 2025, Meta facture au message modèle envoyé, selon la
catégorie (utilitaire, authentification, marketing) et le pays du destinataire.
Les messages de service envoyés dans la fenêtre de 24 heures qui suit un message
du client sont gratuits, et cela change au 1er octobre 2026.

Conséquence de conception : **répondre dans la fenêtre coûte moins cher que
relancer à froid**. Les règles doivent donc préférer répondre à un client qui
vient d'écrire, et grouper les relances plutôt que les éparpiller.

## Les modèles

Un message hors fenêtre doit passer par un modèle approuvé par Meta. Les cinq
modèles livrés existent déjà en quatre langues dans `data/seed.ts` :

- pièce manquante
- rappel de rendez-vous
- dossier déposé au consulat
- passeport prêt à retirer
- solde restant

Chaque modèle doit être déposé et approuvé côté Meta, dans chaque langue, avant
le premier envoi. Compter quelques jours.

## Ce qu'il faut côté serveur

1. Un numéro professionnel vérifié et un compte Meta Business.
2. Une fonction qui vide la file des messages en attente (`status: 'file'`).
3. Un point d'entrée pour les retours : remis, lu, échec, et surtout les réponses
   entrantes, qui doivent atterrir dans le bon dossier.
4. La correspondance entre un numéro et un client. C'est le point délicat : un
   même numéro peut porter plusieurs dossiers, et un client peut écrire depuis le
   téléphone de son cousin.

## Le repli honnête

Tant que l'API n'est pas en place, chaque message peut s'ouvrir dans WhatsApp Web
avec un lien `wa.me`. C'est déjà branché sur les fiches client et dossier. Ce
n'est pas automatique, mais ça évite de retaper le numéro et le texte.
