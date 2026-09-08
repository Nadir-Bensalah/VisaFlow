-- 0018 · La clé de service, qui n'avait rien non plus.
--
-- Même cause que 0015 : les tables ont été créées par `postgres` via l'API de
-- gestion, et les droits par défaut de Supabase ne se sont pas appliqués. On
-- l'a vu en écrivant le banc d'étanchéité, dont l'outillage administratif
-- recevait « permission denied for table agencies ».
--
-- La conséquence était plus grave que gênante : **les deux fonctions de bord
-- WhatsApp auraient échoué en silence.** `whatsapp-send` met à jour l'état
-- des messages par l'API REST avec cette clé, et `wa_receive` range les
-- entrants. Rien n'aurait fonctionné, et rien ne l'aurait dit.
--
-- La clé de service contourne la sécurité au niveau des lignes : c'est sa
-- raison d'être, et c'est pourquoi elle ne quitte jamais un serveur. Elle a
-- donc besoin de tout, y compris des trois tables verrouillées, qu'elle est
-- justement seule à devoir toucher.

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- Et pour tout ce qui viendra après.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
