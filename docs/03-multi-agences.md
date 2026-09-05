# Plusieurs agences, un seul logiciel

## Comment l'agence est reconnue

`resolveTenantSlug()` lit l'adresse dans cet ordre :

1. `?agency=tca` s'il est présent. C'est le mode démonstration et le mode GitHub Pages.
2. Le premier morceau du domaine s'il y en a au moins trois : `tca.visaflow.app` donne `tca`.
   Les mots réservés (`www`, `app`, `admin`, `api`) ne comptent pas.
3. Sinon, l'agence par défaut.

## Ce que GitHub Pages ne sait pas faire

Pages ne sert qu'un domaine par dépôt et ne gère pas les sous-domaines
génériques. La démonstration y vit donc en `?agency=`. Pour la vraie mise en
service, il faut un hébergeur qui accepte un domaine générique :

- **Vercel** ou **Netlify** : ajouter `*.visaflow.app` comme domaine générique, un certificat, rien de plus.
- **Cloudflare Pages** : même chose, avec l'enregistrement DNS `*` vers la cible.

Aucune ligne de code ne change : la résolution par sous-domaine est déjà écrite.

## Le cloisonnement des données

Chaque enregistrement porte `agencyId`. Dans la démonstration, chaque agence a sa
propre clé de stockage (`visaflow.db.tca`). Avec Supabase, ce sera une politique
de sécurité au niveau des lignes :

```sql
create policy "agence_cloisonnee" on cases
  for all using (agency_id = auth.jwt() ->> 'agency_id');
```

Le cloisonnement doit vivre dans la base, jamais dans le code de l'écran. Une
requête oubliée dans un composant ne doit pas pouvoir montrer le dossier d'une
autre agence.

## Ce qui est propre à chaque agence

Nom, marque et couleur, bureaux, langues actives, types de visa, listes de
pièces, modèles de message, règles d'automatisation, équipe. Autrement dit : tout
le métier. Le code, lui, est commun.
