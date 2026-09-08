-- 0062 · Les modèles de poste : nommer un compte par ce qu'il fait.
--
-- LE MANQUE.
--
-- La 0044 a rendu chaque capacité réglable personne par personne. C'est juste,
-- mais ça se paye à la saisie : ouvrir un compte de vérificateur de documents
-- demande de choisir un rôle, puis de décocher deux capacités, de mémoire, sans
-- se tromper. Le patron d'une agence de cinq personnes ne fera pas ça. Il dira
-- « ce compte, c'est le vérificateur », et il attend que le reste suive.
--
-- POURQUOI UN MODÈLE N'EST PAS UN RÔLE. C'est le point à retenir.
--
-- Un rôle est une ligne de sécurité. Il vit dans le jeton, il est vérifié par la
-- base, et cent quarante-huit politiques de sécurité s'appuient dessus. Ajouter
-- un cinquième rôle voudrait dire relire ces cent quarante-huit politiques, une
-- par une, et se tromper une seule fois suffit à ouvrir une porte.
--
-- Un modèle est un raccourci de saisie. Il ne touche à rien : il pose un rôle
-- existant et un paquet d'écarts que la 0044 sait déjà appliquer. Le jour où on
-- en ajoute un dixième, aucune politique ne change, aucune fonction de sécurité
-- ne change, et le pire qui puisse arriver est une case cochée de travers, qui
-- se voit et se décoche.
--
-- Dit autrement : le rôle décide de ce qui est POSSIBLE, le modèle décide de ce
-- qui est PROPOSÉ. On ne mélange jamais les deux.
--
-- CE QU'ON NE FAIT PAS.
--
-- Un modèle ne se « rattache » pas à une personne. Rien ne relie un compte à son
-- modèle : appliquer un modèle recopie son contenu, puis le lien est oublié. Si
-- on gardait le lien, modifier un modèle changerait silencieusement les droits
-- de dix personnes déjà en poste, et personne ne le verrait passer. L'écran
-- retrouve le poste d'une personne en comparant ses écarts à ceux des modèles :
-- quand plus rien ne correspond, il affiche « personnalisé », ce qui est la
-- vérité.

-- ------------------------------------------------------------------
-- 1 · La table
-- ------------------------------------------------------------------

create table if not exists job_templates (
  id          uuid primary key default gen_random_uuid(),
  -- Null : modèle livré avec le produit, commun à toutes les agences. Sinon,
  -- modèle écrit par une agence, invisible aux autres.
  agency_id   uuid references agencies on delete cascade,
  code        text not null,
  -- Le libellé et l'explication, dans les quatre langues du produit. Le
  -- français fait foi, les autres le traduisent.
  label       jsonb not null,
  description jsonb not null default '{}'::jsonb,
  base_role   text not null check (base_role in ('owner','manager','agent','viewer')),
  -- Les capacités accordées EN PLUS du rôle, et celles retirées MALGRÉ lui.
  -- Exactement les deux sens de member_permissions.granted.
  grants      text[] not null default '{}',
  revokes     text[] not null default '{}',
  position    int not null default 100,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table job_templates is
  'Des raccourcis de saisie, pas des rôles. Un modèle pose un rôle existant et un paquet d''écarts ; il ne crée aucun droit nouveau et aucune politique de sécurité ne le connaît.';

-- Deux index uniques partiels plutôt qu'un seul : le code d'un modèle commun est
-- unique pour tout le produit, celui d'une agence n'est unique que chez elle.
-- Un unique (agency_id, code) laisserait passer deux modèles communs de même
-- code, parce que null n'est jamais égal à null.
create unique index if not exists job_templates_common_code
  on job_templates (code) where agency_id is null;
create unique index if not exists job_templates_agency_code
  on job_templates (agency_id, code) where agency_id is not null;
create index if not exists job_templates_agency
  on job_templates (agency_id, position) where active;

-- Un modèle qui cite une capacité inexistante ne se verrait qu'au moment de
-- l'appliquer, sur un compte réel, en production. On refuse à l'écriture.
-- Et un code présent dans les deux listes est une contradiction : accorder et
-- retirer le même droit ne veut rien dire.
create or replace function job_template_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  new.grants  := coalesce(new.grants, '{}');
  new.revokes := coalesce(new.revokes, '{}');
  foreach c in array (new.grants || new.revokes) loop
    if not exists (select 1 from permissions where code = c) then
      raise exception 'capacité inconnue : %', c using errcode = 'P0001';
    end if;
  end loop;
  if exists (select 1 from unnest(new.grants) g where g = any (new.revokes)) then
    raise exception 'une capacité ne peut pas être accordée et retirée' using errcode = 'P0001';
  end if;
  if new.label is null or jsonb_typeof(new.label) <> 'object' or (new.label ->> 'fr') is null then
    raise exception 'le libellé français est obligatoire' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists job_templates_check on job_templates;
create trigger job_templates_check
  before insert or update on job_templates
  for each row execute function job_template_check();

-- ------------------------------------------------------------------
-- 2 · Les postes réels d'une agence tunisienne
-- ------------------------------------------------------------------
--
-- Neuf modèles, écrits avec les DIX-NEUF capacités qui existent, pas une de
-- plus. Ils viennent du terrain : au comptoir, la personne qui vérifie les
-- pièces n'est presque jamais celle qui tient la caisse, et c'est voulu. Une
-- agence qui fait autrement change son modèle ou écrit le sien.
--
-- Rappel de ce que chaque rôle donne déjà (voir role_permissions en 0044) :
--   owner   : les dix-neuf.
--   manager : tout sauf finance:global, team:manage, data:export, data:reset.
--   agent   : dossiers, clients, pièces, messages, encaissement, fret, et voir
--             les réglages. Neuf capacités.
--   viewer  : voir les dossiers. Une seule.
--
-- Un modèle ne répète donc JAMAIS ce que le rôle donne déjà : `grants` et
-- `revokes` ne contiennent que l'écart, sinon la liste des écarts d'une
-- personne deviendrait illisible.

insert into job_templates (agency_id, code, label, description, base_role, grants, revokes, position) values
  (null, 'proprietaire',
   '{"fr":"Propriétaire","en":"Owner","ar":"المالك","zh":"东主"}',
   '{"fr":"Tout voir, tout faire, y compris la caisse globale et l''équipe.","en":"Sees and does everything, including all finances and the team.","ar":"يرى كل شيء ويفعل كل شيء، بما في ذلك كامل المالية والفريق.","zh":"查看和处理一切，包括全部财务与团队。"}',
   'owner', '{}', '{}', 10),

  -- Le poste que le patron décrit mot pour mot : il organise l'agence, il ne
  -- voit ni la caisse globale ni l'équipe. Le rôle manager lui refuse déjà la
  -- caisse globale ; on lui retire en plus le droit d'ouvrir des comptes, qui
  -- est le seul bout d'équipe que le rôle lui laissait.
  (null, 'gestionnaire',
   '{"fr":"Gestionnaire d''agence","en":"Agency manager","ar":"مدير الوكالة","zh":"分社经理"}',
   '{"fr":"Organise l''agence : réglages, catalogue, automatisations, rapports. Il ne voit pas la caisse globale et ne touche pas aux comptes.","en":"Runs the agency: settings, catalogue, automations, reports. No global cash view, no account management.","ar":"ينظم الوكالة: الإعدادات والكتالوج والأتمتة والتقارير. لا يرى كامل المالية ولا يدير الحسابات.","zh":"负责分社运作：设置、目录、自动化、报表。不查看整体资金，也不管理账号。"}',
   'manager', '{}', '{team:invite}', 20),

  (null, 'conseiller',
   '{"fr":"Conseiller","en":"Adviser","ar":"مستشار","zh":"顾问"}',
   '{"fr":"Suit ses clients de bout en bout : il ouvre le dossier, réunit les pièces, écrit au client et encaisse.","en":"Follows their own clients end to end: opens the case, gathers documents, writes to the client and takes payment.","ar":"يتابع حرفاءه من البداية إلى النهاية: يفتح الملف، يجمع الوثائق، يراسل الحريف ويقبض.","zh":"全程跟进自己的客户：建档、收集材料、联系客户并收款。"}',
   'agent', '{}', '{}', 30),

  (null, 'verification_pieces',
   '{"fr":"Vérificateur de documents","en":"Document checker","ar":"مدقق الوثائق","zh":"材料审核员"}',
   '{"fr":"Valide les pièces des dossiers ouverts par les autres. Il n''encaisse pas et n''ouvre pas de dossier.","en":"Validates documents on cases opened by others. Takes no payment and opens no case.","ar":"يصادق على وثائق الملفات التي فتحها غيره. لا يقبض ولا يفتح ملفات.","zh":"审核他人建立的案卷材料。不收款，不建档。"}',
   'agent', '{}', '{payment:write,case:create}', 40),

  (null, 'caisse',
   '{"fr":"Caissier","en":"Cashier","ar":"أمين الصندوق","zh":"收银员"}',
   '{"fr":"Encaisse et remet les reçus. Il ne valide pas les pièces et n''ouvre pas de dossier : c''est la séparation qui protège la caisse.","en":"Takes payments and issues receipts. Does not validate documents and does not open cases: that separation is what protects the till.","ar":"يقبض ويسلم الوصولات. لا يصادق على الوثائق ولا يفتح ملفات: هذا الفصل هو ما يحمي الصندوق.","zh":"负责收款与开具收据。不审核材料、不建档：这一分工正是资金的保护。"}',
   'agent', '{}', '{doc:validate,case:create}', 50),

  (null, 'creneaux',
   '{"fr":"Chargé de créneaux","en":"Appointment officer","ar":"مكلف بالمواعيد","zh":"预约专员"}',
   '{"fr":"Travaille la file de rendez-vous et relance les consulats. Il n''encaisse pas.","en":"Works the appointment queue and chases consulates. Takes no payment.","ar":"يشتغل على طابور المواعيد ويتابع القنصليات. لا يقبض.","zh":"负责预约队列并跟进领事馆。不收款。"}',
   'agent', '{}', '{payment:write}', 60),

  (null, 'comptabilite',
   '{"fr":"Comptable","en":"Accountant","ar":"محاسب","zh":"会计"}',
   '{"fr":"Voit l''argent, la marge et les rapports, et enregistre les encaissements. Il ne fait pas avancer les dossiers.","en":"Sees the money, the margin and the reports, and records payments. Does not move cases forward.","ar":"يرى المال والهامش والتقارير ويسجل المقبوضات. لا يحرّك الملفات.","zh":"查看资金、毛利与报表并登记收款。不推进案卷。"}',
   'viewer', '{payment:write,finance:global,reports:view}', '{}', 70),

  (null, 'coursier',
   '{"fr":"Coursier","en":"Courier","ar":"ساعي","zh":"跑腿员"}',
   '{"fr":"Dépose et récupère les dossiers au consulat, et constate ce qu''il rapporte. Il ne touche à rien d''autre.","en":"Drops off and collects files at the consulate, and records what comes back. Touches nothing else.","ar":"يودع الملفات ويسترجعها من القنصلية ويثبت ما يرجع به. لا يمس بغير ذلك.","zh":"往返领事馆递交与领取材料，并登记带回的结果。不涉及其他。"}',
   'viewer', '{doc:validate}', '{}', 80),

  (null, 'lecture',
   '{"fr":"Lecture seule","en":"Read only","ar":"اطلاع فقط","zh":"只读"}',
   '{"fr":"Regarde les dossiers, sans rien pouvoir changer. Le compte qu''on donne à un stagiaire ou à un associé de passage.","en":"Looks at cases without changing anything. The account for a trainee or a visiting partner.","ar":"يطّلع على الملفات دون تغيير أي شيء. الحساب الذي يُمنح لمتربص أو لشريك عابر.","zh":"仅查看案卷，无法更改。适合实习生或临时合伙人的账号。"}',
   'viewer', '{}', '{}', 90)
on conflict (code) where agency_id is null do update set
  label = excluded.label, description = excluded.description,
  base_role = excluded.base_role, grants = excluded.grants,
  revokes = excluded.revokes, position = excluded.position, active = true;

-- ------------------------------------------------------------------
-- 3 · Lire les modèles
-- ------------------------------------------------------------------
--
-- Les communs plus les siens, dans l'ordre d'affichage. Une agence qui écrit un
-- modèle portant le code d'un commun garde les deux : le sien est plus bas dans
-- la liste, et l'écran montre l'origine.

create or replace function job_templates_for_agency()
returns setof job_templates
language sql stable security definer set search_path = public, auth as $$
  select * from job_templates
  where active and (agency_id is null or agency_id = auth_agency_id())
  order by position, code
$$;
revoke all on function job_templates_for_agency() from public, anon;
grant execute on function job_templates_for_agency() to authenticated;

-- ------------------------------------------------------------------
-- 4 · Appliquer un modèle
-- ------------------------------------------------------------------
--
-- Une seule transaction : le rôle et les écarts changent ensemble, ou rien ne
-- change. Un compte qui aurait le rôle du nouveau poste et les écarts de
-- l'ancien serait un compte que personne ne sait relire.
--
-- On efface TOUS les écarts existants avant de poser ceux du modèle. C'est
-- voulu : appliquer un poste veut dire « ce compte, c'est ça, et rien d'autre ».
-- Garder un vieil écart ferait survivre en silence un droit qu'on croit retiré.

create or replace function apply_job_template(p_user uuid, p_template uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  v_agency uuid; v_role text; tpl job_templates; v_me uuid;
begin
  if not auth_can('team:manage') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;

  select agency_id, role into v_agency, v_role from profiles where id = p_user;
  if v_agency is null or v_agency <> auth_agency_id() then
    raise exception 'hors de votre agence' using errcode = '42501';
  end if;
  -- Même garde qu'en 0044 : on ne touche pas au propriétaire. Lui retirer un
  -- droit par mégarde ferme la porte à tout le monde, et à lui d'abord.
  if v_role = 'owner' then
    raise exception 'le poste du propriétaire ne se change pas' using errcode = 'P0001';
  end if;

  select * into tpl from job_templates
   where id = p_template and active and (agency_id is null or agency_id = auth_agency_id());
  if tpl.id is null then
    raise exception 'modèle inconnu' using errcode = 'P0001';
  end if;

  v_me := auth.uid();

  update profiles set role = tpl.base_role where id = p_user;
  delete from member_permissions where user_id = p_user;

  -- On ne garde que les VRAIS écarts. Un droit accordé que le rôle donne déjà,
  -- ou retiré qu'il ne donnait pas, n'écrit rien : sans ce filtre, la liste des
  -- écarts d'une personne se remplirait de lignes qui ne changent rien, et
  -- l'écran ne saurait plus dire ce qui a vraiment été modifié à la main.
  insert into member_permissions (agency_id, user_id, permission, granted, set_by)
  select v_agency, p_user, g, true, v_me
  from unnest(tpl.grants) g
  where not exists (
    select 1 from role_permissions rp where rp.role = tpl.base_role and rp.permission = g);

  insert into member_permissions (agency_id, user_id, permission, granted, set_by)
  select v_agency, p_user, r, false, v_me
  from unnest(tpl.revokes) r
  where exists (
    select 1 from role_permissions rp where rp.role = tpl.base_role and rp.permission = r);
end $$;
revoke all on function apply_job_template(uuid, uuid) from public, anon;
grant execute on function apply_job_template(uuid, uuid) to authenticated;

-- ------------------------------------------------------------------
-- 5 · Écrire son propre modèle
-- ------------------------------------------------------------------
--
-- Une agence qui a un poste que le produit ne connaît pas l'écrit ici. Elle
-- n'écrit jamais dans les communs : ceux-là appartiennent au produit, et une
-- agence qui les modifierait les modifierait pour tout le monde.

create or replace function save_job_template(
  p_code text,
  p_label jsonb,
  p_base_role text,
  p_grants text[] default '{}',
  p_revokes text[] default '{}',
  p_description jsonb default '{}'::jsonb,
  p_position int default 100,
  p_active boolean default true
) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_agency uuid; v_id uuid; v_code text;
begin
  if not auth_can('team:manage') then
    raise exception 'droit insuffisant' using errcode = '42501';
  end if;
  v_agency := auth_agency_id();
  if v_agency is null then
    raise exception 'hors agence' using errcode = '42501';
  end if;
  v_code := lower(trim(coalesce(p_code, '')));
  if v_code = '' then
    raise exception 'le code est obligatoire' using errcode = 'P0001';
  end if;
  if p_base_role not in ('owner','manager','agent','viewer') then
    raise exception 'rôle de base inconnu' using errcode = 'P0001';
  end if;

  insert into job_templates (agency_id, code, label, description, base_role, grants, revokes, position, active)
  values (v_agency, v_code, p_label, coalesce(p_description, '{}'::jsonb),
          p_base_role, coalesce(p_grants, '{}'), coalesce(p_revokes, '{}'),
          coalesce(p_position, 100), coalesce(p_active, true))
  on conflict (agency_id, code) where agency_id is not null do update set
    label = excluded.label, description = excluded.description,
    base_role = excluded.base_role, grants = excluded.grants,
    revokes = excluded.revokes, position = excluded.position, active = excluded.active
  returning id into v_id;

  return v_id;
end $$;
revoke all on function save_job_template(text, jsonb, text, text[], text[], jsonb, int, boolean) from public, anon;
grant execute on function save_job_template(text, jsonb, text, text[], text[], jsonb, int, boolean) to authenticated;

-- ------------------------------------------------------------------
-- 6 · Qui lit quoi
-- ------------------------------------------------------------------

alter table job_templates enable row level security;
alter table job_templates force row level security;

-- Les modèles communs se lisent par tous : un écran doit pouvoir expliquer ce
-- qu'un poste donne, même à qui ne gère pas l'équipe.
drop policy if exists job_templates_select on job_templates;
create policy job_templates_select on job_templates for select to authenticated
  using (agency_id is null or agency_id = auth_agency_id());

-- Les communs appartiennent au produit : seule la plateforme les écrit.
drop policy if exists job_templates_platform_write on job_templates;
create policy job_templates_platform_write on job_templates for all to authenticated
  using (agency_id is null and is_platform_admin())
  with check (agency_id is null and is_platform_admin());

drop policy if exists job_templates_agency_write on job_templates;
create policy job_templates_agency_write on job_templates for all to authenticated
  using (agency_id = auth_agency_id() and auth_can('team:manage'))
  with check (agency_id = auth_agency_id() and auth_can('team:manage'));

-- LE PIÈGE DE LA 0015. Elle pose un `alter default privileges ... grant select,
-- insert, update, delete to authenticated` : toute table créée après elle reçoit
-- ces quatre droits sans que personne ne les écrive, DELETE compris. On révoque
-- tout et on redonne à la main, pour que le fichier dise la vérité sur ce qui
-- est ouvert.
revoke all on job_templates from anon, authenticated;
grant select, insert, update, delete on job_templates to authenticated;
grant all on job_templates to service_role;

-- ------------------------------------------------------------------
-- 7 · Le piège des fonctions de déclencheur
-- ------------------------------------------------------------------
--
-- PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction nouvellement créée.
-- Pour une fonction de déclencheur, personne ne le remarque : elle s'appelle
-- toute seule. Mais elle reste appelable par un anonyme, et une fonction
-- SECURITY DEFINER appelable par un anonyme est une porte ouverte. Même boucle
-- qu'en fin de 0044 : on ferme pour tout le schéma, une par une l'oubli
-- reviendrait.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
  end loop;
end $$;
