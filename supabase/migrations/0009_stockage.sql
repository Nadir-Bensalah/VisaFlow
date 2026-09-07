-- 0009 · Le stockage des pièces.
--
-- Un lien de stockage public « avec un nom compliqué » est un lien public.
-- Les compartiments sont privés, les chemins portent l'agence, et l'accès est
-- rejoué à chaque téléchargement.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('pieces', 'pieces', false, 15728640,
   array['image/jpeg','image/png','image/heic','image/webp','application/pdf']),
  ('transport', 'transport', false, 15728640,
   array['image/jpeg','image/png','image/heic','image/webp','application/pdf']),
  ('recus', 'recus', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

-- Le premier segment du chemin est l'identifiant de l'agence : agency/case/fichier
create or replace function storage_agency(name text) returns uuid
language sql immutable as $$
  select nullif(split_part(name, '/', 1), '')::uuid
$$;

do $$
begin
  -- Lecture : seulement dans son agence, et seulement pour un rôle qui a le
  -- droit de lire les dossiers.
  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'pieces_lecture') then
    create policy pieces_lecture on storage.objects for select to authenticated
      using (bucket_id in ('pieces','transport','recus')
             and storage_agency(name) = auth_agency_id()
             and auth_can('case:read'));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'pieces_depot') then
    create policy pieces_depot on storage.objects for insert to authenticated
      with check (bucket_id in ('pieces','transport','recus')
                  and storage_agency(name) = auth_agency_id()
                  and auth_can('doc:validate'));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'pieces_suppression') then
    create policy pieces_suppression on storage.objects for delete to authenticated
      using (bucket_id in ('pieces','transport','recus')
             and storage_agency(name) = auth_agency_id()
             and auth_role() in ('owner','manager'));
  end if;
end $$;

comment on function storage_agency is
  'Le chemin d''un fichier commence toujours par l''identifiant de son agence.';
