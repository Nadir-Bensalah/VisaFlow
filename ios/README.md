# VisaFlow, application client iOS

Native, SwiftUI, sans aucune dépendance externe. Quatre appels réseau suffisent,
et une bibliothèque de plus serait une bibliothèque à maintenir.

## Démarrer

```bash
cd ios
xcodegen generate
open VisaFlow.xcodeproj
```

Sans adresse de serveur configurée, l'app tourne sur son jeu de démonstration :
le code de connexion est `000000`. C'est ce qui permet de la montrer au comptoir
sans réseau.

## Brancher le serveur

Deux clés dans `Info.plist`, via `project.yml` :

```yaml
SupabaseURL: https://xxxx.supabase.co
SupabaseAnonKey: eyJ...
```

Dès qu'elles sont là, `AppEnvironment` bascule sur `LiveAPI` et appelle les
fonctions du schéma : `issue_otp`, `verify_otp`, `portal_mine`, `portal_case`,
`portal_shipment`. L'app ne parle jamais aux tables.

## Ce qu'elle fait

- Entrée par numéro et code à usage unique, puis l'appareil est reconnu
  quatre-vingt-dix jours. Le jeton vit dans le trousseau, pas dans les réglages.
- Mes dossiers, mes marchandises, mes demandes, en une liste.
- Détail d'un dossier : étapes, pièces manquantes avec envoi par l'appareil
  photo, rendez-vous, solde, contact.
- Détail d'une cargaison : étapes du transport, arrivée prévue, blocage en
  douane.
- Conversation avec l'agence.
- Nouvelle demande depuis l'app.
- Notifications poussées : c'est la seule vraie raison de faire une application
  plutôt qu'une page web, un message WhatsApp étant facturé à chaque envoi.
- Français, anglais, arabe et chinois, avec le sens de lecture inversé pour
  l'arabe.

## Tests

```bash
xcodebuild -project VisaFlow.xcodeproj -scheme VisaFlow \
  -destination 'platform=iOS Simulator,name=iPhone 17' test
```

Douze tests en trois suites : le modèle, l'accès, et la complétude des quatre
traductions. Ce dernier compare les fichiers clé par clé : une traduction
manquante ne se voit pas au compilateur, elle se voit chez un client libyen qui
reçoit la moitié de son écran en français.

## Identifiants

Bundle `app.capmedia.visaflow`, équipe `ZJ9M4ZSGKT`, iOS 18 minimum.
