# VisaFlow

La plateforme de suivi pour les agences de visas et de fret. Un dossier, une
demande de pièce, un rendez-vous, une cargaison : tout est au même endroit, et
le client suit son avancement sans appeler.

Construite pour Tunis Consulting (Tunis, Tripoli, Guangzhou), pensée dès le
premier jour pour plusieurs agences.

## Ce qu'elle fait

**Côté agence**
- Tableau de bord classé par urgence réelle : date de départ, pièce bloquante, silence du client.
- Dossiers en liste ou en pipeline glissable, avec toute l'histoire du dossier.
- Moteur de listes de pièces par consulat et par type de visa.
- Boîte unique pour WhatsApp, e-mail et portail, avec modèles en quatre langues.
- Cargaisons de Chine vers la Tunisie et la Libye, du ramassage au dédouanement.
- Automatisations : relances, rappels de rendez-vous, alertes passeport, solde impayé.
- Rendez-vous, paiements, tâches, rapports, journal d'audit.
- Recherche globale au clavier (⌘K).

**Côté client**
- Un lien personnel, sans compte ni mot de passe.
- Où en est son dossier, ce qu'il manque, quand est son rendez-vous, ce qu'il reste à payer.
- Le suivi de sa marchandise, étape par étape.

**Partout**
- Français, anglais, arabe (avec sens de lecture inversé) et chinois.
- Multi-agences : chaque agence a son sous-domaine, sa marque et ses données.

## Démarrer

```bash
cd web
npm install
npm run dev
```

Le site tourne sur http://localhost:5173.

Pour voir une autre agence : `?agency=sahara` ou `?agency=medina`.
En production, l'agence vient du sous-domaine (`tca.visaflow.app`).

## Où sont les choses

```
web/src/
  data/       le modèle, le jeu de démonstration, le magasin local
  i18n/       les quatre dictionnaires et le fournisseur de langue
  tenant/     la résolution de l'agence à partir de l'adresse
  lib/        les calculs dérivés (urgence, avancement, indicateurs)
  components/ la bibliothèque d'interface
  pages/      les écrans, dont le portail client
  styles/     les jetons de design et la feuille de composants
docs/         architecture, modèle de données, WhatsApp, conformité, feuille de route
```

## L'état actuel

Les données vivent dans le navigateur (`localStorage`), alimentées par un jeu de
démonstration déterministe. Le passage à Supabase ne touche qu'un fichier :
`web/src/data/store.tsx`. Le schéma est déjà écrit dans
[docs/08-supabase-schema.sql](docs/08-supabase-schema.sql).

Lire [A-FAIRE.md](A-FAIRE.md) pour ce qui revient à Nadir.
