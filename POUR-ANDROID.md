# Pour Android : le carnet de portage

**À quoi sert ce fichier.** Tout ce qu'on change dans l'iOS s'écrit ici, le jour
même, avec assez de détail pour que la même chose se refasse dans l'Android sans
rouvrir l'iOS. Pas un journal de commits : une recette. Quoi, où, pourquoi, avec
quoi, et l'équivalent Compose.

**La règle** : une entrée par chantier, ajoutée au fil de l'eau, jamais après
coup. Une entrée écrite trois semaines plus tard a perdu les valeurs exactes, et
ce sont les valeurs exactes qui font qu'une animation se ressemble sur les deux
téléphones.

---

## 7 septembre 2026 · L'application client, première version

**Ce qui a été fait.** L'app cliente iOS complète : accès par numéro et code,
liste des dossiers et des cargaisons, détail d'un dossier avec envoi de pièce
par l'appareil photo, détail d'une cargaison, conversation, réglages,
notifications, quatre langues.

**Où.** `ios/Sources/`, découpé en `App`, `Design`, `Model`, `Data`, `Features`,
`Notifications`.

**Pourquoi.** Le client n'ouvre pas un navigateur, il ouvre une application. Et
la notification poussée ne coûte rien là où un message WhatsApp est facturé à
chaque envoi.

### Les jetons de design, à recopier tels quels

`ios/Sources/Design/Tokens.swift`. Valeurs exactes, identiques au web :

| Rôle | Valeur |
|---|---|
| Fond | `#F5F5F7` |
| Carte | `#FFFFFF` |
| Texte | `#1D1D1F` |
| Secondaire | `#4B4B50` |
| Tertiaire | `#6E6E73` |
| Bleu | `#0066CC` |
| Vert | `#1F7A2E` |
| Orange | `#B04503` |
| Rouge | `#D10000` |
| Violet | `#5E5CE6` |
| Filet | noir à 8 % |
| Rayon de carte | 18 dp |
| Rayon de champ | 10 dp |
| Espacements | 4, 8, 12, 16, 24, 32 |

**Équivalent Compose** : un `MaterialTheme` avec ces couleurs, mais **sans**
Material You et sans couleurs dynamiques. Le produit garde la même identité sur
les deux téléphones, il ne prend pas celle du fond d'écran.

**La courbe d'animation** : `cubic-bezier(0.28, 0.11, 0.32, 1)`, 300 ms. En
Compose, `CubicBezierEasing(0.28f, 0.11f, 0.32f, 1f)` avec `tween(300)`.

### La carte

iOS : fond blanc, filet de 1 px à 8 % de noir, rayon 18, **pas d'ombre**.
L'ombre est réservée à ce qui est réellement au-dessus, une feuille ou une
alerte.

Compose : `Card(elevation = 0.dp, border = BorderStroke(1.dp, hairline), shape =
RoundedCornerShape(18.dp))`. Ne pas prendre l'élévation par défaut de Material,
elle met une ombre partout.

### Le fil des étapes

`StepTimeline` dans `Components.swift`. Vertical, pastille de 14 dp, trait de
2 dp entre les pastilles, anneau de 4 dp autour de l'étape en cours. Vert quand
c'est fait, bleu quand c'est en cours, filet gris sinon.

Compose : une `Column` avec un `Canvas` pour le trait, ou une `Row` par étape
avec un `Divider` vertical. Piège : la hauteur du trait doit suivre la hauteur du
texte, pas être fixe, sinon les étapes à deux lignes se décalent.

### L'identité du client

`ios/Sources/Data/Session.swift` et `Keychain.swift`.

Le numéro est l'identité, pas un compte. Un code à six chiffres une fois par
appareil, puis l'appareil est reconnu quatre-vingt-dix jours. Le jeton vit dans
le trousseau avec `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` : il ne part
pas dans la sauvegarde iCloud.

**Équivalent Android** : `EncryptedSharedPreferences` avec une clé du
`AndroidKeyStore`, et `android:allowBackup="false"` sur l'application. Le jeton
ne doit pas voyager dans une sauvegarde Google.

**Piège** : sur iOS le champ du code porte `textContentType(.oneTimeCode)`, ce
qui fait apparaître le code au-dessus du clavier. L'équivalent Android est
l'API SMS Retriever, et elle impose un format de message précis. À traiter
côté serveur au moment de rédiger le modèle de message.

### Le réseau

`ios/Sources/Data/API.swift`. Cinq appels, tous des fonctions RPC de Supabase :
`issue_otp`, `verify_otp`, `portal_mine`, `portal_case`, `portal_shipment`.
L'app ne parle jamais aux tables.

Compose : Ktor ou Retrofit, même protocole `API` avec deux implémentations, la
vraie et celle de démonstration. Garder la démonstration : elle sert aux tests
et à montrer l'app sans réseau.

### Les langues

Quatre fichiers `Localizable.strings`, 110 clés, générés depuis un seul tableau
pour qu'aucune ne manque. Un test compare les quatre fichiers clé par clé.

Android : `values/`, `values-en/`, `values-ar/`, `values-zh-rCN/`, et le même
test en JUnit. L'arabe impose `android:supportsRtl="true"` et des marges en
`Start`/`End`, jamais en `Left`/`Right`.

### L'affordance de test

L'app accepte l'argument de lancement `-connecte`, qui entre directement sans
passer par le code. Elle sert aux captures et aux tests d'interface. Prévoir la
même chose côté Android, avec un `Intent` extra.

---

## Ce qui n'est pas encore porté

Rien : le dépôt Android n'existe pas encore. Quand il naîtra, il reprendra ce
carnet depuis cette entrée.
