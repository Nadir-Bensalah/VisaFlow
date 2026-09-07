-- 0016 · Reprendre TRUNCATE, et les trois signatures manquées.
--
-- Trouvé en auditant la vraie base après 0015 : `anon` et `authenticated`
-- détenaient TRUNCATE, REFERENCES et TRIGGER sur les 48 objets du schéma
-- public. Ce sont les droits par défaut que Supabase pose sur `public`.
--
-- TRUNCATE est le dangereux, et la raison est simple : **la sécurité au
-- niveau des lignes ne s'applique pas à TRUNCATE**. Une politique qui filtre
-- ligne par ligne ne sert à rien face à un ordre qui vide la table entière.
-- Un agent d'une agence pouvait effacer les dossiers de toutes les autres.
--
-- Aucun rôle client n'a jamais besoin de ces trois droits :
--   TRUNCATE   : on efface par la purge de rétention, jamais en masse.
--   REFERENCES : poser une clé étrangère est un acte de schéma.
--   TRIGGER    : poser un déclencheur aussi.

do $$
declare r record;
begin
  for r in
    select tablename as name from pg_tables where schemaname = 'public'
    union all
    select viewname as name from pg_views where schemaname = 'public'
  loop
    execute format(
      'revoke truncate, references, trigger on public.%I from anon, authenticated',
      r.name
    );
  end loop;
end $$;

-- Et pour tout ce qui sera créé ensuite. La ligne de 0015 accordait les
-- quatre droits utiles ; celle-ci empêche les trois autres de revenir.
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- ------------------------------------------------------------------
-- Les trois signatures que 0015 a manquées
-- ------------------------------------------------------------------
-- Elles portent plus d'arguments que je ne l'avais supposé, la migration a
-- donc noté « signature absente » et continué. Sans elles, l'inscription
-- d'une agence, la vérification du code et l'envoi d'une demande depuis la
-- page publique renvoient tous « permission denied ».

grant execute on function public.verify_otp(text, text, text, text) to anon, authenticated;
grant execute on function public.provision_agency(text, text, text, text[], text, text, text, text) to anon, authenticated;
grant execute on function public.portal_submit_request(text, text, uuid, date, text, text, text, text, text, text, text, boolean) to anon, authenticated;

-- Et la signature devinée faux dans 0015 : le second argument est un booléen
-- de forçage, pas un motif en texte. 0015 avait donc noté « signature
-- absente » et continué, laissant `authenticated` sans droit dessus. Un agent
-- rendant un passeport au comptoir aurait vu « permission denied ».
--
-- C'est le banc des droits qui l'a trouvé, une fois cessé le `grant all`
-- complaisant du harness. Sur vingt-six signatures, c'était la seule fausse.
grant execute on function public.release_passport(uuid, boolean) to authenticated;
