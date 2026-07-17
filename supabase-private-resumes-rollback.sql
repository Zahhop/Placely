-- Rollback for supabase-private-resumes.sql.
-- Run manually only if you intentionally return candidate_resumes to public.

begin;

-- Rehydrate legacy resume_url values from stored private paths.
-- Replace <PROJECT_REF> if this project ref changes.
update public.candidate_profiles
set resume_url = 'https://ornxlspufzmvapdrwexc.supabase.co/storage/v1/object/public/candidate_resumes/' || resume_path
where resume_path is not null
  and (resume_url is null or btrim(resume_url) = '');

update public.applications
set resume_url = 'https://ornxlspufzmvapdrwexc.supabase.co/storage/v1/object/public/candidate_resumes/' || resume_path
where resume_path is not null
  and (resume_url is null or btrim(resume_url) = '');

drop policy if exists "candidate_resume_owner_select" on storage.objects;
drop policy if exists "candidate_resume_owner_insert" on storage.objects;
drop policy if exists "candidate_resume_owner_update" on storage.objects;
drop policy if exists "candidate_resume_owner_delete" on storage.objects;

-- Legacy public behavior. Only use this rollback if the bucket is manually made public again.
create policy "Allow authenticated users to upload photos 1gz2qsq_0"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'candidate_resumes'::text
    and auth.role() = 'authenticated'::text
  );

create policy "Allow public viewing of candidate resumes 1gz2qsq_0"
  on storage.objects
  for select
  to public
  using (bucket_id = 'candidate_resumes'::text);

commit;
