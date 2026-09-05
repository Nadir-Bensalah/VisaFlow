# L'inscription des agences et l'identité des clients

C'est la question qui décide de tout le reste : comment une entreprise entre sur
la plateforme, et comment ses clients y déposent une demande sans compte.

## Trois portes, jamais une seule

| Porte | Adresse | Pour qui |
|---|---|---|
| La plateforme | `visaflow.app/inscription` | une agence qui s'inscrit |
| L'agence, côté public | `tca.visaflow.app/agence` | ses clients |
| L'agence, côté métier | `tca.visaflow.app/connexion` | ses employés |

Confondre les deux dernières est l'erreur classique : le client final n'a rien à
faire dans un écran de connexion, et l'employé n'a rien à faire dans un
formulaire de demande.

## L'inscription d'une agence

Une page, sept champs, quinze jours d'essai sans carte. Ce que l'agence donne :
son nom, son pays, son métier (visas, fret, ou les deux), le nom, l'e-mail et le
numéro WhatsApp du gérant, et l'adresse souhaitée. L'adresse est vérifiée en
direct : les mots réservés et les adresses déjà prises sont refusés.

**Ce qu'elle trouve en entrant, et c'est le point qui décide.** Pas un outil
vide. Le catalogue de son métier est déjà là : six listes de pièces de consulats,
les étapes du transport, cinq modèles de message traduits en quatre langues,
huit règles de relance prêtes à activer. Plus une carte « Votre installation »
en tête de l'écran Aujourd'hui : cinq gestes faits une fois, qui la mènent de
l'inscription au premier dossier suivi par son client.

Le jeu de dossiers d'exemple est proposé à l'inscription, et il s'efface d'un
bouton. Une agence doit pouvoir voir l'outil rempli, puis le vider.

**Ce qui n'est pas dans l'inscription, volontairement.** Le registre de commerce,
la pièce d'identité du gérant, le numéro de déclaration INPDP et le contrat
signé. Ils ne conditionnent pas l'essai, ils conditionnent le premier vrai
passeport. Une inscription entièrement libre-service sur un outil de collecte de
pièces d'identité serait une faute : à trois agences, la validation à la main ne
coûte rien, et à trente, le produit fait vivre son auteur.

## L'identité du client final

Le constat de départ : ces clients n'ont pas d'adresse e-mail active. Ils ont
WhatsApp. Un mot de passe est donc exclu, sa récupération retomberait de toute
façon sur WhatsApp.

**Le numéro de téléphone est l'identité.** Pas un compte. Et il l'est dans une
agence, pas sur la plateforme : la même personne cliente de deux agences est deux
fiches distinctes, chaque agence étant responsable de ses propres données.

Trois niveaux, du moins coûteux au plus sûr.

**Niveau 0, le lien personnel.** L'agence envoie un lien de suivi par WhatsApp.
Un seul message facturé, zéro friction, un tap. Mais quiconque a le lien voit la
page : on n'y met donc que l'avancement, jamais un document, jamais un montant,
jamais un numéro de connaissement.

**Niveau 1, le code à usage unique.** Pour déposer une pièce, retrouver ses
dossiers ou voir sa situation, le client saisit son numéro et reçoit un code.
**L'appareil est ensuite reconnu 90 jours.** C'est la décision qui rend le modèle
tenable : le code est demandé une fois par appareil, pas à chaque visite. Un
client inquiet qui consulte son dossier dix fois ne coûte pas dix messages.

**Niveau 2, le comptoir.** L'agent identifie la personne physiquement. C'est le
seul niveau qui autorise un changement de numéro, et il est tracé.

Ce que ça donne concrètement : le client dépose sa demande sur la page publique
de l'agence, confirme son numéro par un code dès la première seconde, et repart
avec une référence et un lien. La demande atterrit dans la boîte de l'agence,
qui la convertit en dossier en un clic. Le client qui perd son lien tape son
numéro sur « Suivre mon dossier », et retrouve tout.

## Ce qui a été retiré, et pourquoi

La recherche par référence sur le portail est supprimée. Les références se
suivent, `VF-2026-0141`, `0142`, `0143` : n'importe qui pouvait compter jusqu'à
cent et ouvrir les dossiers des autres clients de l'agence. C'était la faille la
plus grave du produit, et elle annulait toutes les autres protections.

## Ce qui reste au serveur, et qui ne se règle pas ici

Le navigateur est un affichage, jamais une autorité. Quatre choses doivent être
rejouées côté serveur, avec les mêmes noms que `lib/permissions.ts` :

- La décision d'authentification, avec un jeton signé, pas un identifiant écrit
  en clair dans le stockage local.
- Le filtrage : une donnée qui ne doit pas être vue n'est jamais envoyée.
- La limitation du débit : compter les essais de code se fait là où le compteur
  ne se remet pas à zéro en rechargeant la page.
- La fabrication des secrets : jetons et codes, générés et vérifiés côté serveur,
  stockés hachés.

Tant que ce n'est pas fait, l'identité décrite ici est une maquette juste, pas
une protection. Voir `docs/11-ce-qui-reste.md`.
