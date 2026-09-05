# Architecture

## Le principe

Une seule application web, servie à toutes les agences. L'agence est déduite de
l'adresse, jamais choisie dans un menu. Tout le reste en découle : les données,
la marque, les langues, les listes de pièces.

```
tca.visaflow.app     -> agence "tca"
sahara.visaflow.app  -> agence "sahara"
```

## Les couches

| Couche | Fichier | Rôle |
|---|---|---|
| Résolution d'agence | `src/tenant/index.ts` | lit le sous-domaine, retombe sur `?agency=` puis sur l'agence par défaut |
| Modèle | `src/data/types.ts` | le contrat unique, repris tel quel par le schéma SQL |
| Magasin | `src/data/store.tsx` | toutes les lectures et toutes les écritures passent ici |
| Calculs | `src/lib/derive.ts` | urgence, avancement, indicateurs. Les écrans ne calculent rien |
| Langue | `src/i18n/` | quatre dictionnaires, une clé typée, le sens de lecture |
| Écrans | `src/pages/` | espace agence et portail client |

## Pourquoi le magasin est isolé

Aujourd'hui les données vivent dans `localStorage`, remplies par un jeu de
démonstration déterministe. Demain elles viendront de Supabase. Le jour du
basculement, un seul fichier change : `store.tsx`. Les écrans ne savent pas d'où
viennent les données, et c'est volontaire.

## Ce qui n'est pas fait côté navigateur

- L'envoi réel des messages WhatsApp. Le navigateur met le message en file, un
  serveur l'enverra. Voir [06-whatsapp.md](06-whatsapp.md).
- Les automatisations en continu. Le bouton « Simuler » applique les règles à la
  demande, exactement comme le fera la tâche planifiée côté serveur.
- Le stockage des fichiers. Les pièces sont marquées reçues, rien n'est envoyé.

Ces trois manques sont assumés et documentés : ils demandent un serveur, pas une
réécriture.

## Pourquoi pas de bibliothèque d'interface

Le style est écrit à la main, à partir des jetons de `styles/tokens.css`. Deux
raisons : le rendu Apple ne se sous-traite pas à un thème générique, et la page
reste légère (moins de 140 ko compressés, polices comprises).
