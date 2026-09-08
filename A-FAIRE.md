# Ce qui revient à Nadir

Ce fichier est tenu au fil de l'eau. Il ne contient que ce que je ne peux pas
faire à ta place.

## Faire marcher le courriel (30 minutes, une seule fois)

Tout est écrit et déployé. Il manque un compte chez un expéditeur, un domaine
vérifié, et deux lignes à taper. Tant que ce n'est pas fait, l'application
marche exactement comme aujourd'hui : elle grise ses boutons « envoyer par
courriel » au lieu de proposer une action qui échouerait.

**1. Ouvrir un compte Resend.** Va sur resend.com, crée un compte gratuit.
C'est trois mille courriels par mois sans payer, largement assez pour démarrer.

**2. Vérifier un domaine.** Dans Resend, onglet « Domains », ajoute le domaine
que tu utiliseras pour écrire (par exemple `visaflow.tn`). Resend affiche trois
lignes à copier chez ton hébergeur de nom de domaine (SPF, DKIM, DMARC). Colle
les, attends dix minutes, la pastille passe au vert.

Cette étape n'est pas une formalité. Sans domaine vérifié, tout ce qui part
tombe en indésirable, chez Gmail comme ailleurs.

**3. Créer la clé.** Dans Resend, onglet « API Keys », bouton « Create API Key ».
Copie la clé, elle commence par `re_`. Elle ne se réaffiche jamais.

**4. Poser la clé et l'adresse d'expéditeur.** Deux commandes, dans le dossier
du projet :

```bash
supabase secrets set RESEND_API_KEY=re_la_cle_copiee --project-ref ppzjkvgfgoxmdbbsphbr
supabase secrets set "EMAIL_FROM=VisaFlow <no-reply@visaflow.tn>" --project-ref ppzjkvgfgoxmdbbsphbr
```

Remplace `visaflow.tn` par le domaine que tu viens de vérifier. L'adresse peut
être n'importe quoi devant l'arobase, `no-reply` est l'usage.

**5. Vérifier que c'est parti.** Une commande, qui n'envoie rien :

```bash
curl -s -X POST "https://ppzjkvgfgoxmdbbsphbr.supabase.co/functions/v1/send-email" \
  -H "content-type: application/json" \
  -H "authorization: Bearer LA_CLE_DE_SERVICE" \
  -d '{"probe":true}'
```

Tu dois lire `"ready":true`. Si tu lis `"ready":false`, le message dit ce qui
manque, en français. À partir de là, les boutons de l'application s'allument
tout seuls.

Ce que ça débloque, immédiatement : le mot de passe oublié, la facture envoyée
au client, l'invitation d'un employé par lien au lieu d'un mot de passe dicté
au téléphone, et la vérification d'adresse.

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
