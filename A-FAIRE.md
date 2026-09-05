# Ce qui revient à Nadir

Ce fichier est tenu au fil de l'eau. Il ne contient que ce que je ne peux pas
faire à ta place.

## Avant d'écrire une ligne de plus

- [ ] **Une demi-journée à l'agence.** Voir un dossier réel du début à la fin.
      Repartir avec les vraies listes de pièces, par consulat et par type de visa.
      C'est la seule partie que je ne peux pas inventer, et c'est la plus précieuse.
- [ ] **Décider du nom.** « VisaFlow » est générique et sûrement déjà pris.
      Vérifier la disponibilité du nom et du domaine avant de l'imprimer nulle part.
- [ ] **Décider du modèle.** Ma recommandation : licence mensuelle fixe par agence,
      400 à 800 DT, plutôt qu'une commission par dossier chez un membre de la famille.

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

## Décisions en attente

- [ ] Les **poids du calcul d'urgence** (`web/src/lib/derive.ts`). À ajuster avec
      l'agence après quelques semaines : est-ce la date de départ ou la pièce
      bloquante qui doit remonter en premier ?
- [ ] La **limite de relance automatique**. Je propose une par dossier toutes les
      48 heures, toutes règles confondues, pour éviter que le client bloque le
      numéro de l'agence.
- [ ] Le **portail client** doit-il montrer le solde restant à payer ? C'est utile
      pour encaisser, gênant si le client est mal à l'aise. À trancher avec l'agence.
