# Ce qui revient à Nadir

Ce fichier est tenu au fil de l'eau. Il ne contient que ce que je ne peux pas
faire à ta place.

## Faire marcher le courriel : deux gestes chez Brevo

Le compte Brevo de Capmedia est branché, la clé est posée, le code est déployé.
Deux choses bloquent, et elles sont chez Brevo, pas chez nous.

### 1. Désactiver la restriction d'adresse IP (indispensable)

Brevo refuse actuellement la clé avec ce message :

> We have detected you are using an unrecognised IP address 2a05:d019:eed:300b:...

Ce n'est pas un problème d'expéditeur : la clé est bonne, elle est lue, et
l'adresse change à chaque appel. Une fonction de bord tourne sur AWS et n'a pas
d'adresse fixe : il n'y a aucune liste à remplir, il faut lever la restriction.

**Chemin exact** : Brevo, en haut à droite ton nom, **SMTP & API**, onglet
**API Keys**, puis la section **Autorisation IP** (ou « Authorised IPs » dans
les réglages de sécurité du compte). Désactive la restriction, ou choisis
« toutes les adresses ».

Ce que ça change côté sécurité : la clé seule suffira à envoyer. C'est le
fonctionnement normal d'une clé d'API, et elle vit dans le coffre Supabase,
jamais dans le dépôt.

### 2. Le login SMTP (pour le mot de passe oublié)

Les courriels d'authentification (mot de passe oublié, invitation par lien,
vérification d'adresse) ne passent pas par l'API : ils passent par le SMTP, et
la restriction d'adresse IP ne les concerne pas. Ils peuvent donc marcher avant
le point 1.

Il me manque une seule information : **le login SMTP**. Ce n'est ni la clé, ni
forcément ton adresse : c'est souvent un identifiant numérique.

**Chemin exact** : Brevo, **SMTP & API**, onglet **SMTP**, ligne **Login**.
Copie-la et donne-la moi. J'ai déjà essayé les huit adresses plausibles, aucune
ne passe.

Ensuite, une seule commande, et elle vérifie Brevo avant de toucher à quoi que
ce soit :

```bash
python3 brancher_smtp.py "<le login>" "contact@capmedia.tn"
```

### 3. L'expéditeur

`EMAIL_FROM` est posé sur `VisaFlow <contact@capmedia.tn>`. Si ce n'est pas une
adresse vérifiée chez Brevo, dis-le : on la change en une commande. Un expéditeur
non vérifié fait tomber le message en indésirable même quand l'envoi réussit.


## Avant d'écrire une ligne de plus

- [ ] **Une demi-journée à l'agence.** Voir un dossier réel du début à la fin.
      Repartir avec les vraies listes de pièces, par consulat et par type de visa.
      C'est la seule partie que je ne peux pas inventer, et c'est la plus précieuse.
- [ ] **Décider du nom.** « VisaFlow » est générique et sûrement déjà pris.
      Vérifier la disponibilité du nom et du domaine avant de l'imprimer nulle part.
- [ ] **Décider du modèle.** Ma recommandation : licence mensuelle fixe par agence,
      400 à 800 DT, plutôt qu'une commission par dossier chez un membre de la famille.

## Ce que j'attends de toi pour brancher le backend

- [ ] **Supabase.** Créer le projet, choisir la région, et me donner l'URL et la
      clé publique (`anon`). Jamais la clé de service.
- [ ] Une fois le projet créé, appliquer les quatorze migrations (`supabase db push`)
      et déclarer le hook de jeton d'accès. Tout est expliqué dans
      `supabase/README.md`.
- [ ] **Le coffre, pour WhatsApp.** Une fois le jeton Meta obtenu, le poser dans
      le coffre Supabase et non dans une table :
      `select vault.create_secret('EAAG…', 'wa_token_tca');`
      Puis déployer les deux fonctions de bord (`supabase/functions/README.md`).
- [ ] **Le compte Google Play.** L'app Android est prête : identifiant
      `app.capmedia.visaflow`, APK de production à 1,3 Mo. Il faut le compte
      développeur (25 dollars une fois), la clé de signature, et la fiche.
      Android représente 84,7 % des terminaux en Libye et 82,5 % en Tunisie :
      c'est la plateforme qui compte le plus ici.
- [ ] **Le compte développeur Apple.** L'app iOS est prête à être signée :
      identifiant `app.capmedia.visaflow`, équipe `ZJ9M4ZSGKT`. Il faut créer la
      fiche dans App Store Connect et la clé APNs pour les notifications.

## Comptes et accès à ouvrir

- [ ] **Supabase.** Créer le projet, choisir la région, me donner l'URL et la clé
      publique. Ne jamais me donner la clé de service.
- [ ] **Meta Business et WhatsApp.** Un numéro professionnel dédié, vérifié. Puis
      déposer les cinq modèles de message dans les quatre langues, et attendre
      l'approbation. Compter quelques jours.
- [ ] **Hébergement.** GitHub Pages sert la démonstration. Pour les vrais
      sous-domaines par agence, il faut Vercel, Netlify ou Cloudflare Pages avec un
      domaine générique `*.visaflow.app`.
- [ ] **Le domaine.** Acheter le nom retenu, et prévoir le certificat générique.

## Juridique, à ne pas laisser traîner

- [ ] **Déclaration INPDP.** Obligatoire avant tout traitement, loi 2004-63.
      Formulaires sur inpdp.tn.
- [ ] **Autorisation de transfert** si l'hébergement est à l'étranger, plus le
      consentement écrit des clients. Voir `docs/07-donnees-personnelles.md`.
- [ ] **Contrat de service** avec l'agence : ce que tu héberges, ce que tu
      garantis, ce qui se passe si tu arrêtes. Une page suffit, mais elle doit exister.

## Relectures

- [ ] **L'arabe et le chinois.** Les traductions sont écrites avec soin mais
      doivent être relues par une personne dont c'est la langue. Les fichiers sont
      `web/src/i18n/ar.ts` et `web/src/i18n/zh.ts`.
- [ ] **Les frais et délais** de chaque type de visa dans le jeu de démonstration
      sont plausibles, pas réels. À remplacer par les vrais.

## Ce que les audits ont laissé ouvert

Le détail est dans `docs/11-ce-qui-reste.md`. Les trois qui comptent :

- [ ] **Le téléversement des fichiers.** Aucune pièce ne circule aujourd'hui.
      Premier chantier après Supabase.
- [ ] **L'envoi et la réception WhatsApp.** Sans ça, l'outil impose une double
      saisie et se fait abandonner.
- [ ] **Le cloisonnement côté serveur.** Les rôles sont étanches à l'écran, pas
      dans le navigateur. Tant que la base entière y est chargée, la protection
      est une convention, pas une garantie.

## Décisions en attente

- [ ] Les **poids du calcul d'urgence** (`web/src/lib/derive.ts`). À ajuster avec
      l'agence après quelques semaines : est-ce la date de départ ou la pièce
      bloquante qui doit remonter en premier ?
- [ ] La **limite de relance automatique**. Je propose une par dossier toutes les
      48 heures, toutes règles confondues, pour éviter que le client bloque le
      numéro de l'agence.
- [ ] Le **portail client** doit-il montrer le solde restant à payer ? C'est utile
      pour encaisser, gênant si le client est mal à l'aise. À trancher avec l'agence.

## Ce que l'étude de marché a fait remonter, et qui te revient

- [ ] **Les vraies listes de pièces par statut professionnel.** L'étude a établi
      qu'une checklist « France » n'existe pas : il faut France plus salarié,
      France plus indépendant, France plus étudiant, France plus retraité, France
      plus mineur. Le champ existe dans le logiciel, les listes sont à rapporter
      de l'agence.
- [ ] **Vérifier le délai de recours devant la CRRV.** Les sources publiques se
      contredisent, 30 jours contre 2 mois. Le logiciel le stocke comme un
      paramètre par consulat, avec sa source et sa date de vérification : il faut
      la bonne valeur, poste par poste.
- [ ] **Confirmer que ta société tunisienne porte bien le projet.** L'article 22
      de la loi 2004-63 exige que le sous-traitant soit tunisien et résident. Tu
      remplis la condition, mais fais-le confirmer par un avocat avant de signer
      avec une agence qui n'est pas de la famille.
- [ ] **L'audit de sécurité annuel.** Le décret-loi 2023-17 l'impose tous les
      12 mois à qui traite des données personnelles via les réseaux de télécoms,
      sous peine de 50 000 à 100 000 DT. À budgéter, et l'INPDP en réclame une
      copie au dossier de déclaration.
- [ ] **La grille tarifaire par unité d'œuvre.** L'article 3 de la circulaire BCT
      2016-09 fait refuser par la banque le transfert d'un forfait annuel sec.
      « 45 DT par utilisateur et par mois, pour 6 utilisateurs » passe ;
      « 2 490 DT par an » est refusable. À décider avant la première facture.
- [ ] **L'adhésion TTN.** La facture électronique est obligatoire pour les
      prestataires de services depuis le 1er janvier 2026, mais l'obligation ne
      mord qu'à l'adhésion effective au réseau. Déposer la demande.
