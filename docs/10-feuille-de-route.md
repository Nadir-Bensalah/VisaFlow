# Feuille de route

## Fait

- L'espace agence complet : tableau de bord, pipeline, dossiers, pièces, clients,
  messages, rendez-vous, paiements, tâches, automatisations, rapports, réglages,
  journal d'audit, recherche au clavier.
- Les cargaisons de Chine vers la Tunisie et la Libye, avec documents de transport
  et suivi étape par étape.
- Le portail client, sans compte, pour le dossier et pour la marchandise.
- Quatre langues, dont l'arabe de droite à gauche.
- Le multi-agences par sous-domaine.
- Un jeu de démonstration crédible et réinitialisable.

## Ensuite, dans l'ordre

**1. La demi-journée chez l'oncle.** Voir un dossier réel du début à la fin,
récupérer les vraies listes de pièces par consulat, noter ce que l'outil rate.
Rien d'autre ne doit passer avant.

**2. Supabase.** Le schéma est écrit. Base, authentification, politiques de
cloisonnement par agence, stockage des fichiers. Un seul fichier de code change.

**3. Le téléversement réel des pièces.** Avec vignette, poids maximum, et
détection des doublons. C'est ce que le client fera le plus souvent.

**4. WhatsApp.** Numéro professionnel, modèles approuvés, file d'envoi côté
serveur, retours entrants. Voir [06-whatsapp.md](06-whatsapp.md).

**5. Les automatisations côté serveur.** Une tâche planifiée toutes les heures,
avec la limite d'une relance par dossier et par 48 heures.

**6. L'application mobile client.** Voir [09-app-mobile.md](09-app-mobile.md).

## Parqué, volontairement

- La facturation et les reçus imprimables. À faire quand l'agence l'aura demandé
  deux fois, pas avant.
- La lecture automatique du passeport par la photo. Impressionnant en
  démonstration, décevant en usage réel sur des photos prises de travers.
- Le paiement en ligne des frais. À ne pas faire du tout : encaisser pour le
  compte d'un tiers en Tunisie demande un agrément, et c'est exactement ce qui a
  valu à une fintech tunisienne le gel de ses fonds.
