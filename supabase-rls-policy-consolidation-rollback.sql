-- Rollback for supabase-rls-policy-consolidation.sql.
-- Restores the 46 live policies inspected on 2026-07-16.

begin;

create or replace function private.drop_all_policies(target_schema name, target_table name)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = target_schema
      and tablename = target_table
  loop
    execute format('drop policy if exists %I on %I.%I', policy_row.policyname, target_schema, target_table);
  end loop;
end;
$$;

select private.drop_all_policies('public', 'profiles');
select private.drop_all_policies('public', 'candidate_profiles');
select private.drop_all_policies('public', 'employer_profiles');
select private.drop_all_policies('public', 'jobs');
select private.drop_all_policies('public', 'applications');
select private.drop_all_policies('public', 'application_status_history');
select private.drop_all_policies('public', 'conversations');
select private.drop_all_policies('public', 'messages');
select private.drop_all_policies('public', 'saved_candidates');
select private.drop_all_policies('public', 'saved_jobs');
select private.drop_all_policies('public', 'hiring_requests');
select private.drop_all_policies('storage', 'objects');

drop trigger if exists guard_job_owner on public.jobs;
drop trigger if exists guard_application_write on public.applications;
drop trigger if exists guard_conversation_update on public.conversations;
drop trigger if exists guard_message_update on public.messages;

drop view if exists public.public_employer_profiles;

grant update (
  candidate_access,
  subscription_status,
  subscription_plan,
  subscription_started_at,
  stripe_customer_id,
  stripe_subscription_id
) on public.employer_profiles to anon, authenticated;

-- application_status_history
create policy "Employers can insert own application history"
  on public.application_status_history
  for insert
  to authenticated
  with check (
    employer_id = auth.uid()
    and changed_by = auth.uid()
    and exists (
      select 1
      from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = application_status_history.application_id
        and j.employer_id = auth.uid()
    )
  );

create policy "Employers can select own application history"
  on public.application_status_history
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = application_status_history.application_id
        and j.employer_id = auth.uid()
    )
  );

-- applications
create policy "Candidates can create applications"
  on public.applications for insert to authenticated
  with check (auth.uid() = candidate_id);

create policy "Candidates can create their own applications"
  on public.applications for insert to authenticated
  with check (auth.uid() = candidate_id);

create policy "Candidates can insert own applications"
  on public.applications for insert to authenticated
  with check (candidate_id = auth.uid());

create policy "Candidates can read own applications"
  on public.applications for select to authenticated
  using (auth.uid() = candidate_id);

create policy "Candidates can select own applications"
  on public.applications for select to authenticated
  using (candidate_id = auth.uid());

create policy "Candidates can view their own applications"
  on public.applications for select to authenticated
  using (auth.uid() = candidate_id);

create policy "Employers can read their applications"
  on public.applications for select to authenticated
  using (auth.uid() = employer_id);

create policy "Employers can select own applications"
  on public.applications for select to authenticated
  using (employer_id = auth.uid());

create policy "Employers can select own applications by job"
  on public.applications for select to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = applications.job_id
        and j.employer_id = auth.uid()
    )
  );

create policy "Employers can update own applications"
  on public.applications for update to authenticated
  using (employer_id = auth.uid())
  with check (employer_id = auth.uid());

create policy "Employers can update own applications by job"
  on public.applications for update to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = applications.job_id
        and j.employer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.jobs j
      where j.id = applications.job_id
        and j.employer_id = auth.uid()
    )
  );

create policy "Employers can update their applications"
  on public.applications for update to authenticated
  using (auth.uid() = employer_id)
  with check (auth.uid() = employer_id);

-- candidate_profiles
create policy "Candidates can create their own candidate profile"
  on public.candidate_profiles for insert to authenticated
  with check (auth.uid() = id);

create policy "Candidates can read their own candidate profile"
  on public.candidate_profiles for select to authenticated
  using (auth.uid() = id);

create policy "Candidates can update their own candidate profile"
  on public.candidate_profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "candidate profiles can be viewed"
  on public.candidate_profiles for select to authenticated
  using (profile_visible = true);

-- conversations
create policy "Candidates can read conversations"
  on public.conversations for select to authenticated
  using (auth.uid() = candidate_id);

create policy "Employers can create conversations"
  on public.conversations for insert to authenticated
  with check (auth.uid() = employer_id);

create policy "Employers can read conversations"
  on public.conversations for select to authenticated
  using (auth.uid() = employer_id);

-- employer_profiles
create policy "Candidates can read employer profiles"
  on public.employer_profiles for select to authenticated
  using (true);

create policy "Employers can create their own employer profile"
  on public.employer_profiles for insert to authenticated
  with check (auth.uid() = id);

create policy "Employers can read their own employer profile"
  on public.employer_profiles for select to authenticated
  using (auth.uid() = id);

create policy "Employers can update their own employer profile"
  on public.employer_profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- hiring_requests
create policy "Employers can insert their own hiring requests"
  on public.hiring_requests for insert to authenticated
  with check (auth.uid() = employer_id);

create policy "Employers can view their own hiring requests"
  on public.hiring_requests for select to authenticated
  using (auth.uid() = employer_id);

-- jobs
create policy "Candidates can view jobs"
  on public.jobs for select to authenticated
  using (true);

create policy "Employers can delete their own jobs"
  on public.jobs for delete to authenticated
  using (auth.uid() = employer_id);

create policy "Employers can insert their own jobs"
  on public.jobs for insert to authenticated
  with check (auth.uid() = employer_id);

create policy "Employers can update their own jobs"
  on public.jobs for update to authenticated
  using (auth.uid() = employer_id)
  with check (auth.uid() = employer_id);

create policy "Employers can view their own jobs"
  on public.jobs for select to authenticated
  using (auth.uid() = employer_id);

-- messages
create policy "Candidates can read messages"
  on public.messages for select to authenticated
  using ((auth.uid() = candidate_id) or (auth.uid() = employer_id));

create policy "Candidates can send messages"
  on public.messages for insert to authenticated
  with check (auth.uid() = candidate_id);

create policy "Employers can insert messages"
  on public.messages for insert to authenticated
  with check (auth.uid() = employer_id);

create policy "Employers can mark their messages as read"
  on public.messages for update to authenticated
  using (auth.uid() = employer_id)
  with check (auth.uid() = employer_id);

create policy "Employers can read their messages"
  on public.messages for select to authenticated
  using (auth.uid() = employer_id);

create policy "candidates can mark messages as read"
  on public.messages for update to authenticated
  using (auth.uid() = candidate_id)
  with check (auth.uid() = candidate_id);

-- profiles
create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- saved_candidates
create policy "Allow employers to save candidates"
  on public.saved_candidates for insert to authenticated
  with check (auth.uid() = employer_id);

create policy "Employers see their saved candidates"
  on public.saved_candidates for select to authenticated
  using (auth.uid() = employer_id);

-- saved_jobs
create policy "Candidates can remove their own saved jobs"
  on public.saved_jobs for delete to authenticated
  using (candidate_id = auth.uid());

create policy "Candidates can save jobs"
  on public.saved_jobs for insert to authenticated
  with check (candidate_id = auth.uid());

create policy "Candidates can view their own saved jobs"
  on public.saved_jobs for select to authenticated
  using (candidate_id = auth.uid());

-- storage.objects
create policy "Allow authenticated users to upload photos 1gz2qsq_0"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'candidate_resumes'::text and auth.role() = 'authenticated'::text);

create policy "Allow authenticated users to upload photos 1v956t9_0"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'candidate_photos'::text and auth.role() = 'authenticated'::text);

create policy "Allow public viewing of candidate photos"
  on storage.objects for select to public
  using (bucket_id = 'candidate_photos'::text);

create policy "Allow public viewing of candidate resumes 1gz2qsq_0"
  on storage.objects for select to public
  using (bucket_id = 'candidate_resumes'::text);

create policy "Employers can upload photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'employer-logos'::text);

create policy "Employers can view photos"
  on storage.objects for select to public
  using (bucket_id = 'employer-logos'::text);

commit;
