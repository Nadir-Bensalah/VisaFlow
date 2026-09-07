# L'application Android

Réplique native Kotlin et Jetpack Compose de l'application iOS. Même modèle,
mêmes jetons de design, mêmes quatre langues, même contrat de serveur.

**Pourquoi elle compte plus que l'iOS ici.** Android représente **84,7 % des
terminaux en Libye et 82,5 % en Tunisie**. L'application iOS, finie la
première, sert la minorité.

## Construire

```bash
cd android
./gradlew :app:assembleDebug        # 18 Mo, avec les outils de mise au point
./gradlew :app:testDebugUnitTest    # 8 tests
./gradlew :app:assembleRelease      # 1,3 Mo après R8
```

Java 17 est nécessaire. Le SDK se déclare dans `local.properties`, qui ne se
commite pas : copiez `local.properties.example`.

## Ce qui est dedans

| Dossier | Contenu |
|---|---|
| `design/` | Les jetons, repris tels quels de `ios/Sources/Design/Tokens.swift`. Une couleur écrite à la main dans un écran est une dette, pas un raccourci. |
| `model/` | Le modèle vu par le client, calqué sur `Models.swift`. Pas de note interne, pas de coût de fret, pas de référence consulat : ce qui n'est pas là ne peut pas fuiter. |
| `data/` | Le contrat `Api` (sept appels), l'implémentation Supabase, le jeu de démonstration, la session, et le magasin chiffré. |
| `feature/` | Accès, accueil, dossier, cargaison, messages, réglages, demande. |

## Les décisions qui ne se devinent pas

**Le jeton d'appareil vit dans `EncryptedSharedPreferences`**, pas dans des
préférences en clair, et il est **exclu des sauvegardes** (`backup_rules.xml`
et `data_extraction_rules.xml`). Il ouvre tous les dossiers du client pendant
quatre-vingt-dix jours : restauré sur un autre téléphone, il les ouvrirait à
quelqu'un d'autre.

**Deux canaux de notification, pas un.** Un client qui coupe les nouvelles
commerciales ne doit pas couper l'alerte « votre passeport est prêt ».

**Le dépôt de pièce passe par `GetContent`**, le sélecteur système. Il ouvre
l'appareil photo et la galerie sans demander la moindre permission. Une
permission refusée bloquerait le geste le plus important de l'application.

**Les icônes directionnelles sont `AutoMirrored`.** En arabe, le chevron de
retour doit pointer à droite. Le RTL n'est pas une traduction : c'est l'ordre
des colonnes, le sens des flèches et la place des chiffres dans la phrase.

**Le français est la langue par défaut** (`values/`), comme `web/src/i18n/fr.ts`
est le dictionnaire de référence. `values-ar`, `values-en` et `values-zh-rCN`
doivent porter exactement les mêmes clés.

**Le décodeur tolère les champs inconnus.** Le serveur peut gagner une colonne
sans casser une application déjà installée sur le téléphone d'un client qui ne
met jamais à jour.

## Ce qui reste

- Les notifications poussées : le canal existe, l'envoi côté serveur non.
- La signature de la version de production, et le compte Google Play.
- Les captures d'écran de la fiche.
