-- 0034 · Le code de vérification n'arrivait jamais à un nouveau prospect.
--
-- Trouvé en branchant le formulaire public de demande sur le serveur.
-- `issue_otp` mettait le code en file WhatsApp par une jointure sur `clients` :
--
--     from clients c ... where c.agency_id = a.id and c.phone = p_phone
--
-- Un prospect qui n'a jamais rien demandé n'est pas encore client. La jointure
-- ne rendait donc aucune ligne, AUCUN message n'était mis en file, et la
-- fonction répondait quand même `{"sent": true}`. Le visiteur voyait « code
-- envoyé », attendait, et n'avait plus qu'à fermer l'onglet. C'est exactement
-- la porte d'entrée du produit, et elle était condamnée.
--
-- Deux autres défauts sortaient du même endroit :
--
--   · Sans modèle `code_suivi` enregistré, le corps du message valait NULL, et
--     l'insertion tombait sur la contrainte NOT NULL de `messages.body`. Une
--     agence qui n'a pas encore écrit ses modèles ne pouvait envoyer aucun code.
--   · La fonction annonçait `sent` sans savoir si quoi que ce soit était parti.
--     Une fonction qui ment est pire qu'une fonction qui échoue.
--
-- Le correctif ne crée PAS de client fantôme au premier code demandé : ce
-- serait ouvrir une porte à qui veut remplir la base de numéros inventés. On
-- donne au message un destinataire propre à lui.

-- Un message peut viser un numéro sans client connu. C'est le cas du tout
-- premier code envoyé à un inconnu.
alter table messages add column if not exists to_phone text;

comment on column messages.to_phone is
  'Destinataire quand aucun client n''est encore rattaché : le tout premier code de vérification d''un prospect. Le reste du temps, le numéro vient de la fiche client.';

-- La règle « un message est rattaché à quelque chose » est bonne, et on la
-- garde. On l'élargit simplement : un numéro EST un rattachement suffisant.
-- Sans elle, un message flottant deviendrait invisible dans l'interface.
alter table messages drop constraint if exists messages_rattachement;
alter table messages add constraint messages_rattachement
  check (case_id is not null or shipment_id is not null or client_id is not null or to_phone is not null);

-- La file d'envoi accepte désormais un message sans client, à condition qu'il
-- porte son numéro.
create or replace function wa_outbox(p_agency uuid, p_limit integer default 50)
returns table (
  id uuid, client_id uuid, to_number text, body text, locale text,
  template_name text, category text, in_window boolean
)
language sql stable
set search_path = public
as $$
  select
    m.id,
    m.client_id,
    coalesce(c.whatsapp, c.phone, m.to_phone) as to_number,
    m.body,
    m.locale,
    wt.meta_name,
    coalesce(wt.category, 'utility'),
    wa_window_open(m.client_id)
  from messages m
  -- Jointure GAUCHE : un prospect inconnu n'a pas de fiche, son code doit
  -- partir quand même.
  left join clients c on c.id = m.client_id
  left join message_templates mt on mt.key = m.template_key and mt.agency_id = m.agency_id
  left join whatsapp_templates wt
    on wt.template_id = mt.id and wt.language = m.locale and wt.status = 'approved'
  where m.agency_id = p_agency
    and m.channel = 'whatsapp'
    and m.direction = 'sortant'
    and m.status = 'file'
    and coalesce(c.whatsapp, c.phone, m.to_phone) is not null
    -- Hors fenêtre sans modèle approuvé, l'envoi échouerait chez Meta : on
    -- ne le sort pas de la file, on le laisse visible comme bloqué.
    and (wa_window_open(m.client_id) or wt.meta_name is not null)
  order by m.at
  limit greatest(1, least(p_limit, 200))
$$;

revoke all on function wa_outbox(uuid, integer) from public, anon;
grant execute on function wa_outbox(uuid, integer) to authenticated, service_role;

-- Le code, pour un client connu comme pour un inconnu, et une réponse qui dit
-- la vérité sur ce qui est parti.
--
-- La signature d'origine portait une valeur par défaut sur le but ; PostgreSQL
-- refuse de la retirer par un simple remplacement, on supprime donc d'abord.
drop function if exists issue_otp(text, text, text);

create or replace function issue_otp(p_agency_slug text, p_phone text, p_purpose text default 'suivi')
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a        agencies;
  cl       clients;
  code     text;
  corps    text;
  loc      text;
  en_file  boolean := false;
begin
  if not rate_allow('issue_otp', coalesce(p_agency_slug, '') || ':' || coalesce(p_phone, ''), 5, interval '1 hour') then
    raise exception 'trop de demandes de code' using errcode = 'P0001';
  end if;

  select * into a from agencies where slug = p_agency_slug;
  if a.id is null then raise exception 'agence inconnue' using errcode = 'P0002'; end if;

  code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into otp_codes (agency_id, phone, code_hash, purpose)
  values (a.id, p_phone, extensions.crypt(code, extensions.gen_salt('bf', 8)), p_purpose);

  -- Le client s'il existe déjà ; sinon on garde son numéro et rien d'autre.
  select * into cl from clients where agency_id = a.id and phone = p_phone limit 1;
  loc := coalesce(cl.locale, a.default_locale, 'fr');

  -- Le modèle de l'agence s'il existe, sinon une phrase par défaut. Sans ce
  -- repli, une agence qui n'a pas encore écrit ses modèles n'envoyait rien.
  select replace(coalesce(t.body ->> loc, t.body ->> 'fr'), '{code}', code)
    into corps
  from message_templates t
  where t.agency_id = a.id and t.key = 'code_suivi';

  if corps is null then
    corps := case loc
      when 'ar' then 'رمز التحقق الخاص بك: ' || code || '. صالح لمدة 10 دقائق.'
      when 'en' then 'Your verification code: ' || code || '. Valid for 10 minutes.'
      when 'zh' then '您的验证码：' || code || '，10 分钟内有效。'
      else 'Votre code de vérification : ' || code || '. Valable 10 minutes.'
    end;
  end if;

  insert into messages (agency_id, client_id, to_phone, channel, direction, body, locale,
                        template_key, automated, status)
  values (a.id, cl.id, p_phone, 'whatsapp', 'sortant', corps, loc, 'code_suivi', true, 'file');
  en_file := true;

  -- On dit ce qui s'est passé, ET si ça peut réellement partir.
  --
  -- Un prospect n'a jamais de fenêtre de service de 24 heures : il ne vous a
  -- jamais écrit. Meta n'accepte donc qu'un MODÈLE APPROUVÉ. Si l'agence n'en a
  -- pas fait approuver un, le code restera bloqué dans la file, et personne ne
  -- le saura. Mieux vaut le dire tout de suite à l'écran que laisser le visiteur
  -- attendre un message qui ne viendra jamais.
  return jsonb_build_object(
    'queued', en_file,
    'known_client', cl.id is not null,
    'whatsapp_ready', exists (select 1 from whatsapp_accounts w where w.agency_id = a.id),
    'deliverable', (
      exists (select 1 from whatsapp_accounts w where w.agency_id = a.id)
      and (
        wa_window_open(cl.id)
        or exists (
          select 1 from message_templates mt
          join whatsapp_templates wt
            on wt.template_id = mt.id and wt.language = loc and wt.status = 'approved'
          where mt.agency_id = a.id and mt.key = 'code_suivi'
        )
      )
    ),
    'expires_in', 600
  );
end $$;

revoke all on function issue_otp(text, text, text) from public;
grant execute on function issue_otp(text, text, text) to anon, authenticated;
