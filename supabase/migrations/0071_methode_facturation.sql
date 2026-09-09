-- 0071 : la méthode de facturation « par utilisateur » existe vraiment.
--
-- L'assistant d'ouverture (et la conversion d'une demande) posent
-- `commission_kind = 'par_utilisateur'` depuis 0065. La contrainte de 0020
-- n'acceptait que par_dossier, mensuel, pourcentage et gratuit : en
-- production, l'ouverture d'une agence échouait en 23514 au dernier clic,
-- après quatre étapes vérifiées. Le banc d'ouverture ne l'avait pas vu parce
-- qu'il créait ses agences en par_dossier.
--
-- Depuis la grille 0070 (Active, Premium), cette colonne n'est plus qu'une
-- mémoire commerciale : le montant dû vient de la souscription. On élargit la
-- contrainte au lieu de la supprimer, pour garder un vocabulaire fermé.

alter table agencies drop constraint if exists agencies_commission_kind_check;
alter table agencies add constraint agencies_commission_kind_check
  check (commission_kind in ('par_dossier','mensuel','pourcentage','gratuit','par_utilisateur','forfait'));
