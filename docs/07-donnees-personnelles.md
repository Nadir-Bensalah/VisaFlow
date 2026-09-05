# Données personnelles

VisaFlow stocke des passeports, des relevés bancaires, des fiches de paie et des
adresses. En Tunisie, ce n'est pas un détail juridique, c'est une obligation
préalable.

## Ce que dit la loi

La loi organique 2004-63 du 27 juillet 2004 impose une **déclaration préalable à
l'INPDP** pour chaque finalité de traitement (article 7). Le transfert de données
vers l'étranger est encadré par les articles 47 et 50 à 52 : consentement écrit
de la personne, protection adéquate dans le pays d'accueil, et **autorisation de
l'INPDP**.

Les formulaires sont sur inpdp.tn.

## Ce que ça implique pour le projet

**Si l'hébergement est en Tunisie** : une déclaration de traitement suffit.

**Si l'hébergement est à l'étranger** (Supabase à Paris, Vercel, n'importe quel
service cloud) : déclaration **plus** autorisation de transfert, **plus**
consentement écrit recueilli auprès de chaque client. Le consentement doit être
tracé, daté, et récupérable.

C'est faisable, ce n'est pas gratuit en temps. À lancer avant le développement du
serveur, pas après.

## Ce qui est déjà prévu dans le produit

- Une durée de conservation affichée dans les réglages : 24 mois après la clôture
  du dossier, puis effacement.
- L'export complet des données de l'agence, en un fichier.
- L'effacement d'un client sur sa demande.
- Un journal d'audit : qui a fait quoi, quand, sur quel dossier.
- Une mention en clair sur le portail client : les pièces sont conservées le temps
  du dossier, puis effacées.

## Ce qui reste à faire côté serveur

- Chiffrer les fichiers au repos, et ne jamais les servir par une URL devinable.
- Faire expirer les jetons de suivi client après la clôture du dossier.
- Journaliser les accès aux pièces, pas seulement les modifications.
- Recueillir et stocker le consentement au transfert si l'hébergement est hors
  de Tunisie.
