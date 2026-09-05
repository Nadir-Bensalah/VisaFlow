# VisaFlow, application client

Pour le client, pas pour l'agence. Trois questions, trois réponses : où en est
mon dossier, qu'est-ce qu'il vous manque, où est ma marchandise.

## Démarrer

```bash
cd mobile
npm install
npx expo start
```

Les dépendances ne sont pas installées dans le dépôt. La première commande les
récupère.

## Ce qui est écrit

- Entrée par numéro de téléphone et code reçu sur WhatsApp, sans compte à créer.
- Liste des dossiers et des cargaisons, avec l'avancement.
- Détail d'un dossier : étapes, pièces à fournir avec l'appareil photo, rendez-vous, solde.
- Suivi d'une cargaison, étape par étape.
- Quatre langues, avec alignement du texte pour l'arabe.
- Enregistrement du jeton de notification poussée.

## Ce qui manque, et pourquoi

`src/data/api.ts` rend aujourd'hui un jeu de démonstration. Il appellera le vrai
serveur dès que Supabase sera en place : seule cette couche change, les écrans
ne bougent pas.

L'envoi réel des photos et l'envoi des notifications demandent le serveur. Voir
`../docs/09-app-mobile.md`.

## Identifiant

`app.capmedia.visaflow`, sur iOS comme sur Android.
