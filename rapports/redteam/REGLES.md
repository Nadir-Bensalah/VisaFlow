# Règles d'engagement des red teams

Cible : le projet VisaFlow, en production sur Supabase.

- URL : https://ppzjkvgfgoxmdbbsphbr.supabase.co
- Clé publique (anon), la seule qu'un attaquant possède :
  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwemprdmdmZ294bWRiYnNwaGJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4MTU4MTEsImV4cCI6MjEwNDM5MTgxMX0.rQSTYZsPOdTPTccl6I8ehfW5otPCh0On05aR5auRM4Y

## Interdits absolus
- Ne jamais chercher, lire ni utiliser une clé `service_role`, un jeton `sbp_`,
  un fichier `.sbenv` ou `.env`. Ce sont les secrets du serveur : un attaquant
  ne les a pas. Les utiliser fausserait le test.
- Ne rien détruire de façon irréversible. Le but est de PROUVER un trou, pas
  de vider la base. Une preuve de lecture non autorisée suffit ; pour l'écriture,
  écrire une ligne marquée `REDTEAM` puis la relever, sans toucher aux données
  existantes.
- Comptes de démonstration utilisables (agents réels, pour tester les rôles) :
  mot de passe `le mot de passe de démonstration (hors dépôt, variable VISAFLOW_DEMO_PASSWORD)`, adresses en @tunis-consulting.test et
  @sahara-voyages.test (voir supabase/seed/demo.sql).

## Ce qu'on attend
Un rapport court et net : chaque trou avec la requête exacte qui le prouve, son
impact, et la correction proposée. Si rien ne cède sur ton axe, dis-le, avec la
liste de ce que tu as essayé. Pas de blabla.
