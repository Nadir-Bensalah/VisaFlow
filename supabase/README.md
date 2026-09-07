# Le backend

Seize migrations, quatre bancs d'essai, soixante-sept assertions, deux fonctions de bord, et rien qui ne soit vérifié.

## La leçon des migrations 0015 et 0016

Le schéma a d'abord été poussé sur la vraie base le 8 septembre 2026. Trois
fautes sont apparues aussitôt, qu'aucun banc ne voyait :

1. **`authenticated` n'avait aucun droit sur les 45 tables.** Les 148
   politiques n'étaient jamais atteintes : PostgreSQL refusait avant. L'espace
   agence n'aurait rien affiché. Le banc local posait un `grant all` que
   Supabase ne pose pas.
2. **`anon` et `authenticated` détenaient TRUNCATE** sur tout le schéma, par
   les droits par défaut de Supabase. La sécurité au niveau des lignes ne
   s'applique pas à TRUNCATE : une politique qui filtre ligne par ligne ne
   sert à rien face à un ordre qui vide la table.
3. **`purge_expired` et `run_automations` étaient appelables par un anonyme**,
   toutes deux SECURITY DEFINER et sans garde interne. PostgreSQL accorde
   EXECUTE à PUBLIC par défaut, sur toute fonction.

Le harness a été rendu aussi strict que la production, et `tests/droits.sql`
vérifie désormais les deux couches : le droit de toucher la table, puis la
politique qui filtre. La première fois qu'il a tourné, il a trouvé une
signature de plus, `release_passport(uuid, boolean)`, restée sans droit.

## Appliquer

```bash
supabase link --project-ref <ref>
supabase db push
```

Ou, à la main, dans l'ordre des numéros :

```bash
for f in supabase/migrations/0*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

## Vérifier, sans toucher à la production

Le banc tourne sur un PostgreSQL local. Il monte deux agences, quatre rôles,
trois bureaux, et vérifie que rien ne traverse.

```bash
# un cluster jetable
initdb -D /tmp/vf && pg_ctl -D /tmp/vf -o "-p 54399 -k /tmp" start
createdb -h /tmp -p 54399 visaflow_test
psql -h /tmp -p 54399 -d visaflow_test -f supabase/tests/harness.sql
for f in supabase/migrations/0*.sql; do
  psql -h /tmp -p 54399 -d visaflow_test -v ON_ERROR_STOP=1 -f "$f"
done
psql -h /tmp -p 54399 -d visaflow_test -f supabase/tests/isolation.sql
```

Vingt-quatre assertions. Elles échouent bruyamment, jamais en silence.

## Ce que le banc prouve

- Une agence ne voit jamais l'autre, ni ses dossiers, ni ses clients, ni sa ligne
  dans `agencies`.
- Un agent ne voit que son bureau. Un responsable voit les deux.
- Un lecteur ne peut rien créer, et ne peut pas se promouvoir propriétaire.
- Le journal d'audit n'est ni modifiable ni effaçable, même par la direction.
- Le portail ne rend ni la référence du consulat, ni les notes internes, ni le
  canal interne, et un jeton inventé ne rend rien.
- Ouvrir un dossier recopie la liste de pièces annoncée et crée les deux lignes
  de règlement, honoraires et débours séparés.
- Le passeport ne sort pas tant que le solde n'est pas réglé.
- Une même règle ne relance pas deux fois le même dossier dans sa fenêtre.
- Chaque agence a sa propre suite de références.

## À configurer dans Supabase, une fois

1. **Le hook de jeton d'accès.** Auth, Hooks, Custom Access Token : pointer sur
   `public.custom_access_token_hook`. Sans lui, chaque politique retombe sur une
   lecture de table, ce qui coûte une requête par ligne.
2. **Les compartiments de stockage.** Ils sont créés par `0009`, mais vérifier
   qu'ils sont bien privés.
3. **La tâche planifiée des relances.** `select run_automations(id, false) from
   agencies where deleted_at is null;` toutes les heures, par pg_cron. Le verrou
   est déjà dans la fonction : deux exécutions simultanées ne relancent pas deux
   fois.
4. **La purge.** `select purge_expired(id) from agencies;` une fois par nuit.

## Ce qui reste au serveur, et n'est pas encore écrit

- L'envoi WhatsApp : une fonction qui vide la file `messages` en état `file`,
  et un point d'entrée qui reçoit les retours et les messages entrants.
- `portal_send_message` et `portal_upload_url`, appelées par l'app et par le
  portail web. Elles doivent limiter le débit et écrire au nom du jeton, jamais
  au nom d'un employé.
- La facturation de l'abonnement.

## Trois bugs que le banc a trouvés en le montant

Ils sont corrigés, mais ils disent à quoi sert ce banc.

1. `portal_case` était déclarée `stable` alors qu'elle journalise la
   consultation. PostgreSQL refuse l'écriture dans une fonction non volatile.
2. La boucle des automatisations itérait sur un `record` là où la fonction
   attendait une ligne de `cases` : rejet de type à l'exécution.
3. Une insertion multiple avec `returning ... into` : elle lève dès qu'il y a
   plus d'une ligne.
