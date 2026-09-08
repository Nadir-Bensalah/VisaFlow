# Les fonctions de bord

Tout le métier vit en base. Ces fonctions ne font que porter les octets : ce
qui doit SORTIR par le réseau ne peut pas se faire en SQL, et rien de plus.

| Fonction | Ce qu'elle fait | Qui l'appelle |
|---|---|---|
| `whatsapp-webhook` | les entrants et les retours d'état de Meta | Meta |
| `whatsapp-send` | vide la file d'envoi WhatsApp | une tâche planifiée |
| `portal-upload` | le dépôt de pièces par le client | le portail |
| `invite-user` | ouvre un compte | l'application |
| `send-email` | l'envoi de courriel | l'application et le serveur |
| `webhook-dispatch` | poste les remises de `webhook_deliveries` | `visaflow_webhooks`, toutes les 5 min |

## `whatsapp-webhook`

L'adresse que Meta appelle. Deux verbes.

**GET** : l'abonnement. Meta envoie `hub.verify_token`, on le cherche dans
`whatsapp_accounts`, et on renvoie le défi. Une seule fois, à la configuration.

**POST** : les messages entrants et les retours d'état. La signature
`X-Hub-Signature-256` est vérifiée avant toute chose : sans elle, n'importe qui
poste de faux messages dans les dossiers de l'agence. La comparaison est à temps
constant, parce qu'une comparaison naïve laisse deviner la signature octet par
octet.

La fonction répond **toujours 200**. Un code d'erreur fait rejouer l'appel en
boucle par Meta, et le même message arrive dix fois.

## `whatsapp-send`

Vide la file des messages `status = 'file'`. À appeler par un cron, toutes les
minutes.

Deux façons d'envoyer, et le choix ne nous appartient pas :

| Situation | Envoi | Coût |
|---|---|---|
| Le client a écrit dans les 24 dernières heures | texte libre | gratuit |
| Hors fenêtre | modèle approuvé par Meta, dans la langue du client | facturé au message |

`wa_outbox` ne rend que ce qui est réellement envoyable : hors fenêtre sans
modèle approuvé, le message reste dans la file au lieu de brûler un appel et de
revenir en échec.

## Le jeton

Il ne vit **jamais** dans une table. `whatsapp_accounts.token_secret` ne garde
que le nom du secret dans le coffre Supabase. Sans cette indirection, quiconque
peut lire la table peut écrire au nom de l'agence depuis n'importe où.

```sql
select vault.create_secret('EAAG...', 'wa_token_tca', 'Jeton WhatsApp de TCA');
update whatsapp_accounts set token_secret = 'wa_token_tca' where agency_id = '…';
```

## Déployer

```bash
supabase functions deploy whatsapp-webhook --no-verify-jwt
supabase functions deploy whatsapp-send
supabase secrets set WHATSAPP_APP_SECRET=…
```

`--no-verify-jwt` sur le webhook : Meta n'a pas de jeton Supabase à présenter.
C'est la signature qui protège, pas le JWT.

## Ce qui reste à faire côté Meta

1. Un numéro professionnel vérifié et un compte Meta Business.
2. Les modèles déposés et approuvés, **dans chaque langue**. Compter quelques
   jours. Un modèle peut être approuvé en français et refusé en arabe.
3. L'abonnement du webhook aux champs `messages`.


## `send-email`

L'envoi de courriel, avec Resend. Elle accepte la clé de service (le serveur)
et le jeton d'un compte connecté (l'application), avec les mêmes vérifications
d'agence que `invite-user`.

```json
{ "kind": "facture", "to": "…", "subject": "…", "html": "…", "text": "…",
  "reply_to": "…", "agency_id": "…", "tags": { "dossier": "TC-2026-0001" } }
```

`kind` parmi : `invitation`, `mot_de_passe`, `facture`, `devis`, `rappel`,
`decision`, `document_demande`, `systeme`.

**Sans clé de fournisseur, elle rend 503 et écrit quand même une trace** en
statut `non_configure`, avec le destinataire et l'objet. Le produit continue de
marcher sans courriel, comme aujourd'hui, mais on sait ce qui aurait dû partir.
On ne prétend jamais qu'un message est parti s'il n'est pas parti.

`{ "probe": true }` ne poste rien : elle rafraîchit `email_config`, que
`email_ready()` rend à l'application pour griser ses boutons proprement.

L'expéditeur est TOUJOURS `EMAIL_FROM`, sur un domaine à nous. L'adresse de
l'agence (`agencies.email`) part en réponse. Envoyer depuis l'adresse du client
sans authentifier son domaine fait tomber le message en indésirable.

Changer de fournisseur : ajouter un objet `Fournisseur` à côté de `RESEND` dans
le fichier, et poser `EMAIL_PROVIDER`. Trois champs à écrire, rien d'autre.

### Ce qu'il faut poser

```bash
supabase secrets set RESEND_API_KEY=re_…
supabase secrets set "EMAIL_FROM=VisaFlow <no-reply@votre-domaine.tn>"
```

## `webhook-dispatch`

Vide `webhook_deliveries`. Prend `webhook_pending(50)`, poste chaque charge,
rappelle `webhook_mark`.

- **Signature** : `X-VisaFlow-Signature: sha256=<HMAC du corps>`, clé lue dans le
  coffre par `webhooks.secret_name`. Un webhook qui déclare un secret absent du
  coffre n'est PAS envoyé : envoyer non signé serait dégrader la sécurité en
  silence.
- **Idempotence** : `X-VisaFlow-Delivery` et `Idempotency-Key` portent
  l'identifiant de la remise, qui NE CHANGE PAS entre les huit tentatives.
  `X-VisaFlow-Attempt` change, lui, pour distinguer un rejeu.
- **Dix secondes** par point de réception, six en parallèle. Un serveur lent ne
  bloque pas les quarante-neuf autres.

### Comment la tâche l'appelle, et pourquoi pas avec un jeton

`pg_cron` appelle `run_job('webhooks', 'select dispatch_webhooks()')`, qui sort
par `pg_net`. Or pg_net range chaque appel en attente dans
`net.http_request_queue`, EN-TÊTES COMPRIS, et Supabase ouvre ce schéma à
`anon` et `authenticated` sans que `postgres` puisse le refermer. Une clé de
service posée là serait à ramasser par n'importe quel compte connecté.

La tâche **signe** donc son appel au lieu de le porter : un horodatage et son
empreinte HMAC, calculée avec un secret partagé lu dans le coffre. Volée, elle
ne vaut que cinq minutes et pour ce seul appel. C'est la même idée que
`whatsapp-webhook` : la signature protège, pas le JWT.

### Ce qu'il faut poser

```bash
supabase secrets set WEBHOOK_DISPATCH_SECRET=<une longue chaîne au hasard>
```

```sql
select vault.create_secret('<la MÊME chaîne>', 'webhook_dispatch_secret');
update edge_settings set functions_url = 'https://<projet>.supabase.co/functions/v1';
```

Le journal des passages est dans `job_runs` (`job = 'webhooks'`). Une tâche mal
réglée y échoue BRUYAMMENT, avec sa raison. Elle ne se tait jamais.
