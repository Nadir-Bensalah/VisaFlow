-- 0017 · Les onze Incoterms, pas six.
--
-- Trouvé en montant le jeu de démonstration : la contrainte n'acceptait que
-- EXW, FOB, CFR, CIF, DAP et DDP. Or l'étude de marché a établi précisément
-- l'inverse de ce que ce choix suppose.
--
--   · En groupage LCL, **FCA au CFS est la règle correcte**, et FOB est une
--     faute : sous FOB le vendeur porte le risque pendant l'empotage, sur une
--     marchandise qu'il ne contrôle plus, confiée à un groupeur qu'il n'a pas
--     choisi. Avec un conteneur scellé, il devient en outre impossible de
--     dire quand le dommage est survenu.
--   · **CIP remplace CIF** dès que le flux n'est pas strictement port à port.
--     CIF impose les Institute Cargo Clauses (C), les plus restrictives ;
--     CIP impose les clauses (A), les plus larges. Acheter CIF Radès, c'est
--     accepter la couverture minimale sur 25 000 km avec transbordement.
--   · FOB, FAS, CFR et CIF sont **réservés à la mer**. Sur l'aérien vers
--     Tunis-Carthage ou le tronçon terrestre vers la Libye, il faut FCA, CPT,
--     CIP ou DAP.
--
-- Une contrainte qui interdit le bon Incoterm oblige l'agence à en saisir un
-- faux. Le champ devient alors un mensonge, et les alertes qu'on bâtira
-- dessus seront fausses aussi.

alter table shipments drop constraint if exists shipments_incoterm_check;

alter table shipments add constraint shipments_incoterm_check
  check (incoterm is null or incoterm in (
    -- Tous modes de transport
    'EXW','FCA','CPT','CIP','DAP','DPU','DDP',
    -- Mer et voies navigables uniquement
    'FAS','FOB','CFR','CIF'
  ));

-- Le mode de transport dit si l'Incoterm choisi a un sens. « FOB Shanghai »
-- sur une expédition aérienne n'en a aucun : il n'y a pas de navire, donc pas
-- de point de transfert.
create or replace function incoterm_coherent(p_mode text, p_incoterm text)
returns boolean
language sql immutable
set search_path = public
as $$
  select case
    when p_incoterm is null then true
    when p_mode in ('aerien', 'routier') then p_incoterm not in ('FAS','FOB','CFR','CIF')
    else true
  end;
$$;

alter table shipments add constraint shipments_incoterm_mode
  check (incoterm_coherent(mode, incoterm)) not valid;

comment on constraint shipments_incoterm_mode on shipments is
  'Les règles maritimes n''ont pas de sens sur un vol ou un camion. Posée en not valid : les lignes déjà saisies ne sont pas rejetées, seules les nouvelles sont contrôlées.';

revoke all on function incoterm_coherent(text, text) from public, anon;
grant execute on function incoterm_coherent(text, text) to authenticated;
