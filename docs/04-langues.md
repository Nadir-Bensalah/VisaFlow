# Quatre langues, deux sens de lecture

## Les langues

Français, anglais, arabe, chinois simplifié. L'arabe se lit de droite à gauche.

Le choix se fait dans cet ordre : `?lang=` dans l'adresse, puis le dernier choix
enregistré, puis la langue du navigateur, puis le français.

## Ce qui change quand la langue change

- L'attribut `lang` et l'attribut `dir` de la page. Tout le reste en découle.
- La pile de polices. L'arabe prend SF Arabic ou Noto Sans Arabic, le chinois
  PingFang SC ou Noto Sans SC. Une police latine seule casse le rendu.
- Les graisses. Le chinois demande plus de gras pour tenir le même poids optique,
  et zéro interlettrage négatif. C'est réglé dans `tokens.css`.
- Les dates, les nombres et les montants, par `Intl`.

## Le sens de lecture

Le CSS n'utilise jamais `left` ni `right` sur ce qui doit se retourner. Partout :
`inset-inline-start`, `margin-inline-end`, `padding-inline`. Les rares cas qui
demandent une exception sont écrits en clair avec `[dir='rtl']`, par exemple le
déplacement de l'interrupteur.

## Les textes du métier

Les libellés de pièces, les modèles de message et les noms de règles sont
stockés en base sous forme `{ fr, en, ar, zh }`. L'agence peut donc ajouter une
pièce et la traduire elle-même, sans passer par le code.

Le message part toujours dans la langue du client, pas dans celle de l'agent.
C'est la règle la plus utile de tout le produit pour une agence qui sert des
Tunisiens, des Libyens et des Chinois le même matin.

## Avant la mise en service

Les traductions arabe et chinoise ont été écrites avec soin, mais elles doivent
être relues par une personne dont c'est la langue. Vingt minutes de relecture
valent mieux qu'un client qui perd confiance sur une tournure bancale.
