# Les automatisations

Huit règles sont livrées. Elles couvrent ce qu'une agence fait à la main
aujourd'hui, et mal, parce que personne n'a le temps.

| Déclencheur | Action |
|---|---|
| Une pièce manque depuis 3 jours | Message WhatsApp au client, dans sa langue |
| Un rendez-vous a lieu demain | Rappel avec le lieu et le passeport à apporter |
| Le passeport expire dans moins de 6 mois | Alerte interne avant le dépôt |
| Aucune activité depuis 7 jours | Tâche pour l'agent en charge |
| Le départ est dans 7 jours et le solde n'est pas réglé | Message de relance |
| Le dossier arrive au consulat | Message « dossier déposé » |
| Le dossier passe à « à retirer » | Message « passeport prêt » |
| Solde impayé depuis 15 jours | Alerte interne (désactivée par défaut) |

## Comment ça marche

`runRules()` dans `store.tsx` relit l'état courant et applique les règles actives
à chaque dossier ouvert. Aucune mémoire cachée, aucun état intermédiaire : le
moteur peut être relancé cent fois, il produit le même résultat.

Dans la démonstration, le bouton « Simuler maintenant » déclenche le passage. En
production, ce sera une tâche planifiée côté serveur, toutes les heures, avec la
même fonction.

## Le garde-fou qui manque

Il faut une limite par dossier et par jour, sinon un dossier bloqué depuis trois
semaines reçoit une relance quotidienne et le client bloque le numéro WhatsApp de
l'agence. À implémenter avant la mise en service : une relance automatique par
dossier et par période de 48 heures, toutes règles confondues.
