# Modèle de données

Le contrat vit dans `web/src/data/types.ts`. Ce document explique les choix, pas
les champs un par un.

## Les entités

- **Agency** : l'agence. Porte le sous-domaine, la marque, les langues, les bureaux.
- **Office** : Tunis, Tripoli, Guangzhou. Un client et un dossier appartiennent à un bureau.
- **User** : direction, responsable, agent, lecture seule.
- **Client** : la personne. Passeport, nationalité, langue préférée. C'est elle qui reçoit les messages.
- **VisaType** : Chine affaires 48 h, Schengen tourisme, foire de Canton. Porte les frais, le délai, et surtout la liste de pièces.
- **ChecklistTemplate** : le savoir du métier. Ce que ce consulat exige pour ce visa.
- **VisaCase** : le dossier. Étape, priorité, dates, montants, jeton de suivi client.
- **CaseDocument** : une pièce attendue sur un dossier, avec son état et ses relances.
- **Message**, **MessageTemplate** : le fil client, et les modèles traduits en quatre langues.
- **Appointment**, **Payment**, **Task**, **AutomationRule**, **ActivityEvent**.
- **Shipment**, **ShipmentDocument**, **ShipmentEvent** : la cargaison, ses documents de transport, son fil de suivi.

## Trois décisions qui comptent

**1. `I18nText` plutôt qu'une table de traductions.**
Une étiquette stockée en base est un objet `{ fr, en, ar, zh }`. Le français est
obligatoire, le reste facultatif, avec repli automatique. Ça évite une jointure
sur chaque libellé et ça rend les listes de pièces éditables par l'agence.

**2. Les pièces sont copiées sur le dossier, pas référencées.**
Quand un dossier s'ouvre, la liste de pièces du type de visa est recopiée dans
`CaseDocument`. Si le consulat change ses exigences demain, les dossiers en cours
gardent la liste qui leur a été annoncée. C'est le seul comportement défendable
devant un client.

**3. Le jeton de suivi est porté par le dossier.**
`portalToken` donne accès en lecture au dossier, sans compte. Il est propre au
dossier et pas au client : partager un lien ne donne jamais accès à un autre
dossier. Même logique pour les cargaisons.

## L'étape et le statut sont deux choses

`stage` dit où en est le travail (pièces, dépôt, consulat). `status` dit comment
ça s'est terminé (en cours, accepté, refusé, annulé). Confondre les deux oblige à
inventer des étapes fantômes du genre « refusé au consulat ».

## Le calcul d'urgence

`urgency()` dans `lib/derive.ts` mélange cinq signaux : jours avant le départ,
pièces bloquantes, silence du client, solde impayé, passeport trop court. C'est
ce tri qui remplace le fil WhatsApp. Les poids sont dans le code, en clair, et
demandent à être ajustés avec l'agence après quelques semaines d'usage.
