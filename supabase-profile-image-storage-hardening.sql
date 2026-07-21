-- Placely V1 profile image Storage hardening.
-- Non-destructive: preserves existing buckets, objects, and profile records.
-- Apply in Supabase SQL editor after reviewing existing storage policies.

begin;

-- Enforce bucket-level upload limits where supported by Supabase Storage.
-- Candidate photos: JPG/PNG/WebP up to 5 MB.
update storage.buckets
set
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'candidate_photos';

-- Employer logos: JPG/PNG/WebP up to 2 MB.
update storage.buckets
set
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id in ('employer-logos', 'employer_logos');

-- Remove broad policies that let clients enumerate every image object.
drop policy if exists "storage_public_select_profile_images" on storage.objects;
drop policy if exists "Allow public viewing of candidate photos" on storage.objects;
drop policy if exists "Employers can view photos" on storage.objects;
drop policy if exists "Public can view employer logos" on storage.objects;
drop policy if exists "Public can view profile images" on storage.objects;
drop policy if exists "Allow authenticated users to upload photos 1gz2qsq_0" on storage.objects;
drop policy if exists "Allow authenticated users to upload photos 1v956t9_0" on storage.objects;
drop policy if exists "Employers can upload photos" on storage.objects;

drop policy if exists "storage_candidate_photo_owner_select" on storage.objects;
drop policy if exists "storage_candidate_photo_authorized_employer_select" on storage.objects;
drop policy if exists "storage_candidate_photo_owner_insert" on storage.objects;
drop policy if exists "storage_candidate_photo_owner_update" on storage.objects;
drop policy if exists "storage_candidate_photo_owner_delete" on storage.objects;

drop policy if exists "storage_employer_logo_owner_select" on storage.objects;
drop policy if exists "storage_employer_logo_owner_insert" on storage.objects;
drop policy if exists "storage_employer_logo_owner_update" on storage.objects;
drop policy if exists "storage_employer_logo_owner_delete" on storage.objects;
drop policy if exists "storage_candidate_photo_owner_write" on storage.objects;
drop policy if exists "storage_employer_logo_owner_write" on storage.objects;

-- Candidate photos.
-- Read is intentionally scoped for authenticated app flows. V1 frontend still
-- resolves legacy/public exact URLs where buckets remain public, but no policy
-- below permits bucket-wide client listing.
create policy "storage_candidate_photo_owner_select"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'candidate_photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "storage_candidate_photo_authorized_employer_select"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'candidate_photos'
    and exists (
      select 1
      from public.employer_profiles ep
      where ep.id = auth.uid()
        and ep.candidate_access = true
    )
    and exists (
      select 1
      from public.candidate_profiles cp
      where cp.id::text = (storage.foldername(name))[1]
        and coalesce(cp.profile_visible, true) = true
    )
  );

create policy "storage_candidate_photo_owner_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'candidate_photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.candidate_profiles cp where cp.id = auth.uid())
    and lower(coalesce(metadata->>'mimetype', '')) in ('image/jpeg', 'image/png', 'image/webp')
    and lower(name) ~ '\.(jpe?g|png|webp)$'
  );

create policy "storage_candidate_photo_owner_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'candidate_photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'candidate_photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and lower(coalesce(metadata->>'mimetype', '')) in ('image/jpeg', 'image/png', 'image/webp')
    and lower(name) ~ '\.(jpe?g|png|webp)$'
  );

create policy "storage_candidate_photo_owner_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'candidate_photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Employer logos.
-- Public exact-path serving can remain enabled at the bucket/CDN layer for V1
-- job cards. These policies do not grant bucket-wide object listing.
create policy "storage_employer_logo_owner_select"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id in ('employer-logos', 'employer_logos')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "storage_employer_logo_owner_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id in ('employer-logos', 'employer_logos')
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.employer_profiles ep where ep.id = auth.uid())
    and lower(coalesce(metadata->>'mimetype', '')) in ('image/jpeg', 'image/png', 'image/webp')
    and lower(name) ~ '\.(jpe?g|png|webp)$'
  );

create policy "storage_employer_logo_owner_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id in ('employer-logos', 'employer_logos')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('employer-logos', 'employer_logos')
    and (storage.foldername(name))[1] = auth.uid()::text
    and lower(coalesce(metadata->>'mimetype', '')) in ('image/jpeg', 'image/png', 'image/webp')
    and lower(name) ~ '\.(jpe?g|png|webp)$'
  );

create policy "storage_employer_logo_owner_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id in ('employer-logos', 'employer_logos')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
