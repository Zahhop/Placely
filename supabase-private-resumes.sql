-- Placely private candidate resume Storage policies.
-- Run manually in Supabase SQL Editor after the candidate_resumes bucket is private.
-- This file intentionally does not ALTER storage.objects. Supabase owns that table.
-- Employers should not receive direct Storage SELECT access; they use the
-- get-candidate-resume-url Edge Function after server-side authorization.

drop policy if exists "Allow public viewing of candidate resumes 1gz2qsq_0" on storage.objects;
drop policy if exists "Allow authenticated users to upload photos 1gz2qsq_0" on storage.objects;
drop policy if exists "storage_candidate_resume_owner_select" on storage.objects;
drop policy if exists "storage_candidate_resume_owner_write" on storage.objects;
drop policy if exists "candidate_resume_owner_select" on storage.objects;
drop policy if exists "candidate_resume_owner_insert" on storage.objects;
drop policy if exists "candidate_resume_owner_update" on storage.objects;
drop policy if exists "candidate_resume_owner_delete" on storage.objects;

create policy "candidate_resume_owner_select"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'candidate_resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "candidate_resume_owner_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'candidate_resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "candidate_resume_owner_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'candidate_resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'candidate_resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "candidate_resume_owner_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'candidate_resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
