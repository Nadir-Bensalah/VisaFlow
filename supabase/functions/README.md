# Les fonctions de bord

Deux fonctions, un seul sujet : WhatsApp. Tout le métier vit en base, dans les
fonctions SQL de la migration 0014. Ces deux-là ne font que porter les octets.

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
