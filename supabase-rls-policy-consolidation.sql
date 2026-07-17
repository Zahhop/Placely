-- Placely Supabase RLS policy consolidation.
-- Generated from live pg_policies inspection on 2026-07-16.
--
-- BEFORE APPLYING:
-- 1. Run this in staging first.
-- 2. Save current policies:
--    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
--    from pg_policies
--    where schemaname in ('public', 'storage')
--    order by schemaname, tablename, policyname;
-- 3. Frontend public/candidate company reads have been moved to public_employer_profiles.
--
-- Current policy matrix before cleanup:
-- profiles:
--   authenticated owner: SELECT own, INSERT own, UPDATE own, DELETE denied.
-- employer_profiles:
--   employer owner: SELECT own, INSERT own, UPDATE own, DELETE denied.
--   authenticated non-owner: SELECT all rows via "Candidates can read employer profiles" using true.
-- candidate_profiles:
--   candidate owner: SELECT own, INSERT own, UPDATE own, DELETE denied.
--   authenticated employers/users: SELECT all profile_visible rows, regardless candidate_access.
-- jobs:
--   authenticated users: SELECT all rows via "Candidates can view jobs" using true.
--   employer owner: SELECT own, INSERT own, UPDATE own, DELETE own.
-- applications:
--   candidate: three duplicate INSERT policies, three duplicate SELECT policies, no safe candidate UPDATE.
--   employer: duplicate SELECT/UPDATE policies by direct employer_id and by owned job.
-- conversations:
--   candidate/employer: SELECT own side.
--   employer: INSERT where employer_id = auth.uid(); candidate cannot create despite app code doing so.
-- messages:
--   participants: SELECT by denormalized employer_id/candidate_id.
--   candidate/employer: INSERT by denormalized id only, without conversation membership check.
--   participant UPDATE can change any column unless separately constrained.
-- saved_candidates:
--   employer: SELECT own, INSERT own, no DELETE policy.
-- saved_jobs:
--   candidate: SELECT own, INSERT own, DELETE own.
-- hiring_requests:
--   employer: SELECT own, INSERT own.
-- application_status_history:
--   employer: SELECT/INSERT for applications on owned jobs.
-- storage.objects:
--   public candidate_photos/employer-logos SELECT.
--   public candidate_resumes SELECT.
--   authenticated upload to candidate_photos/candidate_resumes/employer-logos without owner path check.
--
-- Final policy matrix after cleanup:
-- profiles:
--   authenticated owner: SELECT own, INSERT own, UPDATE own with owner check, DELETE denied.
-- employer_profiles:
--   employer owner: SELECT own full row, INSERT own, UPDATE own non-billing fields, DELETE denied.
--   public/candidate/company readers: use public.public_employer_profiles view only.
-- candidate_profiles:
--   candidate owner: SELECT own, INSERT own, UPDATE own with owner check, DELETE denied.
--   employer with active/trialing candidate_access: SELECT visible candidates.
--   employer with application/conversation relationship: SELECT related candidate profile.
-- jobs:
--   anon/authenticated: SELECT status in ('active','published','open').
--   employer owner: SELECT own, INSERT own, UPDATE own, DELETE own.
-- applications:
--   candidate: one INSERT own policy; SELECT own; UPDATE own only guarded by trigger.
--   employer: SELECT/UPDATE only for applications attached to jobs they own.
-- conversations:
--   participants: SELECT own conversations.
--   employer/candidate: INSERT only for valid relationships; UPDATE only participants, ownership immutable by trigger.
-- messages:
--   participants: SELECT conversation messages.
--   participants: INSERT only if sender identity and conversation participants match auth.uid().
--   participants: UPDATE read flags only; immutable fields guarded by trigger.
-- saved_candidates:
--   employer: SELECT/INSERT/DELETE own.
-- saved_jobs:
--   candidate: SELECT/INSERT/DELETE own.
-- hiring_requests:
--   employer: SELECT/INSERT own only; dormant V1 infrastructure remains protected.
-- application_status_history:
--   employer: SELECT/INSERT only for applications on owned jobs.
-- storage.objects:
--   public photos/logos SELECT; owner-path writes only.
--   resumes are no longer public; candidate owner SELECT only. Employers use the Edge Function.

begin;

create schema if not exists private;

create table if not exists private.rls_policy_consolidation_backup (
  backup_id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null default now(),
  schemaname name not null,
  tablename name not null,
  policyname name not null,
  permissive text not null,
  roles name[] not null,
  cmd text not null,
  qual text,
  with_check text
);

insert into private.rls_policy_consolidation_backup (
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
)
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname in ('public', 'storage')
  and (
    (schemaname = 'public' and tablename in (
      'profiles',
      'candidate_profiles',
      'employer_profiles',
      'jobs',
      'applications',
      'application_status_history',
      'conversations',
      'messages',
      'saved_candidates',
      'saved_jobs',
      'hiring_requests'
    ))
    or (schemaname = 'storage' and tablename = 'objects')
  );

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
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      target_schema,
      target_table
    );
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

alter table public.profiles enable row level security;
alter table public.candidate_profiles enable row level security;
alter table public.employer_profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.application_status_history enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.saved_candidates enable row level security;
alter table public.saved_jobs enable row level security;
alter table public.hiring_requests enable row level security;

create or replace function private.is_employer(user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.employer_profiles ep where ep.id = user_id
  );
$$;

create or replace function private.is_candidate(user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.candidate_profiles cp where cp.id = user_id
  );
$$;

create or replace function private.employer_has_candidate_access(user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.employer_profiles ep
    where ep.id = user_id
      and ep.candidate_access is true
      and coalesce(ep.subscription_status, 'free') in ('active', 'trialing')
  );
$$;

create or replace function private.employer_owns_job(job_id uuid, user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.jobs j
    where j.id = job_id
      and j.employer_id = user_id
  );
$$;

create or replace function private.safe_uuid(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return value::uuid;
exception
  when others then
    return null;
end;
$$;

create or replace function private.is_conversation_participant(conversation_id_text text, user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = private.safe_uuid(conversation_id_text)
      and (c.employer_id = user_id or c.candidate_id = user_id)
  );
$$;

create or replace function private.valid_message_participants(
  p_conversation_id_text text,
  p_employer_id uuid,
  p_candidate_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = private.safe_uuid(p_conversation_id_text)
      and c.employer_id = p_employer_id
      and c.candidate_id = p_candidate_id
  );
$$;

create or replace function private.can_create_conversation(
  p_actor_id uuid,
  p_employer_id uuid,
  p_candidate_id uuid,
  p_job_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    (
      p_actor_id = p_employer_id
      and private.employer_has_candidate_access(p_actor_id)
      and (
        exists (
          select 1
          from public.applications a
          where a.employer_id = p_employer_id
            and a.candidate_id = p_candidate_id
            and (
              p_job_id is null
              or a.job_id = p_job_id
            )
        )
        or exists (
          select 1
          from public.candidate_profiles cp
          where cp.id = p_candidate_id
            and cp.profile_visible is true
        )
      )
    )
    or
    (
      p_actor_id = p_candidate_id
      and exists (
        select 1
        from public.applications a
        where a.candidate_id = p_candidate_id
          and a.employer_id = p_employer_id
          and (
            p_job_id is null
            or a.job_id = p_job_id
          )
      )
    );
$$;

create or replace function private.guard_job_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' then
    if tg_op = 'INSERT' then
      new.employer_id := auth.uid();
    elsif old.employer_id is distinct from new.employer_id then
      raise exception 'employer_id cannot be changed';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_job_owner on public.jobs;
create trigger guard_job_owner
before insert or update on public.jobs
for each row execute function private.guard_job_owner();

create or replace function private.guard_application_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_employer uuid;
  actor uuid := auth.uid();
  actor_is_candidate boolean;
  actor_is_employer boolean;
begin
  if auth.role() <> 'authenticated' then
    return new;
  end if;

  select j.employer_id
  into owning_employer
  from public.jobs j
  where j.id = new.job_id
    and coalesce(j.status, 'active') in ('active', 'published', 'open');

  if owning_employer is null then
    raise exception 'applications must reference a public/open job';
  end if;

  actor_is_candidate := new.candidate_id = actor;
  actor_is_employer := owning_employer = actor;

  if tg_op = 'INSERT' then
    if not actor_is_candidate then
      raise exception 'candidates can only create their own applications';
    end if;

    new.employer_id := owning_employer;
    new.status := coalesce(new.status, 'submitted');
    return new;
  end if;

  if old.candidate_id is distinct from new.candidate_id
    or old.employer_id is distinct from new.employer_id
    or old.job_id is distinct from new.job_id then
    raise exception 'application ownership fields cannot be changed';
  end if;

  if actor_is_candidate and not actor_is_employer then
    if (to_jsonb(old)->'employer_notes') is distinct from (to_jsonb(new)->'employer_notes')
      or (to_jsonb(old)->'reviewed_at') is distinct from (to_jsonb(new)->'reviewed_at')
      or (to_jsonb(old)->'interview_date') is distinct from (to_jsonb(new)->'interview_date')
      or (to_jsonb(old)->'offer_sent_at') is distinct from (to_jsonb(new)->'offer_sent_at')
      or (to_jsonb(old)->'hired_at') is distinct from (to_jsonb(new)->'hired_at')
      or (to_jsonb(old)->'rejected_at') is distinct from (to_jsonb(new)->'rejected_at') then
      raise exception 'candidates cannot update employer-controlled application fields';
    end if;

    if old.status is distinct from new.status
      and new.status not in ('submitted', 'withdrawn') then
      raise exception 'candidates can only submit, reapply, or withdraw applications';
    end if;
  elsif not actor_is_employer then
    raise exception 'only the candidate or job owner can update this application';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_application_write on public.applications;
create trigger guard_application_write
before insert or update on public.applications
for each row execute function private.guard_application_write();

create or replace function private.guard_conversation_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated'
    and (
      old.employer_id is distinct from new.employer_id
      or old.candidate_id is distinct from new.candidate_id
      or old.id is distinct from new.id
    ) then
    raise exception 'conversation ownership fields cannot be changed';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_conversation_update on public.conversations;
create trigger guard_conversation_update
before update on public.conversations
for each row execute function private.guard_conversation_update();

create or replace function private.guard_message_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated'
    and (
      old.conversation_id is distinct from new.conversation_id
      or old.sender_type is distinct from new.sender_type
      or old.message is distinct from new.message
      or old.employer_id is distinct from new.employer_id
      or old.candidate_id is distinct from new.candidate_id
      or old.id is distinct from new.id
    ) then
    raise exception 'message identity and content cannot be changed';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_message_update on public.messages;
create trigger guard_message_update
before update on public.messages
for each row execute function private.guard_message_update();

-- profiles
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- employer_profiles
create policy "employer_profiles_select_own"
  on public.employer_profiles for select to authenticated
  using (id = auth.uid());

create policy "employer_profiles_insert_own"
  on public.employer_profiles for insert to authenticated
  with check (id = auth.uid());

create policy "employer_profiles_update_own"
  on public.employer_profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke update (
  candidate_access,
  subscription_status,
  subscription_plan,
  subscription_started_at,
  stripe_customer_id,
  stripe_subscription_id
) on public.employer_profiles from anon, authenticated;

create or replace view public.public_employer_profiles as
select distinct
  ep.id,
  ep.company_name,
  ep.industry,
  ep.company_website,
  ep.company_location,
  ep.company_description,
  ep.employment_type,
  ep.pay_range,
  ep.hiring_timeline,
  ep.candidate_qualities,
  ep.main_hiring_industry,
  ep.company_logo_url,
  ep.created_at
from public.employer_profiles ep
where exists (
  select 1
  from public.jobs j
  where j.employer_id = ep.id
    and coalesce(j.status, 'active') in ('active', 'published', 'open')
);

revoke all on public.public_employer_profiles from public;
grant select on public.public_employer_profiles to anon, authenticated;

-- candidate_profiles
create policy "candidate_profiles_select_own"
  on public.candidate_profiles for select to authenticated
  using (id = auth.uid());

create policy "candidate_profiles_insert_own"
  on public.candidate_profiles for insert to authenticated
  with check (id = auth.uid());

create policy "candidate_profiles_update_own"
  on public.candidate_profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "candidate_profiles_select_paid_visible"
  on public.candidate_profiles for select to authenticated
  using (
    profile_visible is true
    and private.employer_has_candidate_access(auth.uid())
  );

create policy "candidate_profiles_select_application_related"
  on public.candidate_profiles for select to authenticated
  using (
    exists (
      select 1
      from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.candidate_id = candidate_profiles.id
        and j.employer_id = auth.uid()
    )
  );

create policy "candidate_profiles_select_conversation_related"
  on public.candidate_profiles for select to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.candidate_id = candidate_profiles.id
        and (c.candidate_id = auth.uid() or c.employer_id = auth.uid())
    )
  );

-- jobs
create policy "jobs_select_public_open"
  on public.jobs for select to anon, authenticated
  using (coalesce(status, 'active') in ('active', 'published', 'open'));

create policy "jobs_select_own_employer"
  on public.jobs for select to authenticated
  using (employer_id = auth.uid());

create policy "jobs_insert_own_employer"
  on public.jobs for insert to authenticated
  with check (employer_id = auth.uid() and private.is_employer(auth.uid()));

create policy "jobs_update_own_employer"
  on public.jobs for update to authenticated
  using (employer_id = auth.uid())
  with check (employer_id = auth.uid());

create policy "jobs_delete_own_employer"
  on public.jobs for delete to authenticated
  using (employer_id = auth.uid());

-- applications
create policy "applications_insert_candidate_own"
  on public.applications for insert to authenticated
  with check (candidate_id = auth.uid());

create policy "applications_select_candidate_own"
  on public.applications for select to authenticated
  using (candidate_id = auth.uid());

create policy "applications_select_employer_owned_job"
  on public.applications for select to authenticated
  using (private.employer_owns_job(job_id, auth.uid()));

create policy "applications_update_candidate_own"
  on public.applications for update to authenticated
  using (candidate_id = auth.uid())
  with check (candidate_id = auth.uid());

create policy "applications_update_employer_owned_job"
  on public.applications for update to authenticated
  using (private.employer_owns_job(job_id, auth.uid()))
  with check (private.employer_owns_job(job_id, auth.uid()));

-- application_status_history
create policy "application_status_history_select_employer_owned_job"
  on public.application_status_history for select to authenticated
  using (
    exists (
      select 1
      from public.applications a
      where a.id = application_status_history.application_id
        and private.employer_owns_job(a.job_id, auth.uid())
    )
  );

create policy "application_status_history_insert_employer_owned_job"
  on public.application_status_history for insert to authenticated
  with check (
    employer_id = auth.uid()
    and changed_by = auth.uid()
    and exists (
      select 1
      from public.applications a
      where a.id = application_status_history.application_id
        and private.employer_owns_job(a.job_id, auth.uid())
    )
  );

-- conversations
create policy "conversations_select_participant"
  on public.conversations for select to authenticated
  using (employer_id = auth.uid() or candidate_id = auth.uid());

create policy "conversations_insert_valid_relationship"
  on public.conversations for insert to authenticated
  with check (
    private.can_create_conversation(auth.uid(), employer_id, candidate_id, null)
  );

create policy "conversations_update_participant"
  on public.conversations for update to authenticated
  using (employer_id = auth.uid() or candidate_id = auth.uid())
  with check (employer_id = auth.uid() or candidate_id = auth.uid());

-- messages
create policy "messages_select_conversation_participant"
  on public.messages for select to authenticated
  using (private.is_conversation_participant(conversation_id, auth.uid()));

create policy "messages_insert_conversation_participant_sender"
  on public.messages for insert to authenticated
  with check (
    private.is_conversation_participant(conversation_id, auth.uid())
    and private.valid_message_participants(conversation_id, employer_id, candidate_id)
    and (
      (sender_type = 'employer' and employer_id = auth.uid())
      or (sender_type = 'candidate' and candidate_id = auth.uid())
    )
  );

create policy "messages_update_read_status_participant"
  on public.messages for update to authenticated
  using (private.is_conversation_participant(conversation_id, auth.uid()))
  with check (private.is_conversation_participant(conversation_id, auth.uid()));

-- saved_candidates
create policy "saved_candidates_select_own_employer"
  on public.saved_candidates for select to authenticated
  using (employer_id = auth.uid());

create policy "saved_candidates_insert_own_employer"
  on public.saved_candidates for insert to authenticated
  with check (employer_id = auth.uid() and private.employer_has_candidate_access(auth.uid()));

create policy "saved_candidates_delete_own_employer"
  on public.saved_candidates for delete to authenticated
  using (employer_id = auth.uid());

-- saved_jobs
create policy "saved_jobs_select_own_candidate"
  on public.saved_jobs for select to authenticated
  using (candidate_id = auth.uid());

create policy "saved_jobs_insert_own_candidate"
  on public.saved_jobs for insert to authenticated
  with check (
    candidate_id = auth.uid()
    and exists (
      select 1
      from public.jobs j
      where j.id = saved_jobs.job_id
        and coalesce(j.status, 'active') in ('active', 'published', 'open')
    )
  );

create policy "saved_jobs_delete_own_candidate"
  on public.saved_jobs for delete to authenticated
  using (candidate_id = auth.uid());

-- hiring_requests
create policy "hiring_requests_select_own_employer"
  on public.hiring_requests for select to authenticated
  using (employer_id = auth.uid());

create policy "hiring_requests_insert_own_employer"
  on public.hiring_requests for insert to authenticated
  with check (employer_id = auth.uid() and private.is_employer(auth.uid()));

-- storage.objects
create policy "storage_public_select_profile_images"
  on storage.objects for select to anon, authenticated
  using (bucket_id in ('candidate_photos', 'employer-logos'));

create policy "storage_candidate_photo_owner_write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'candidate_photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "storage_candidate_resume_owner_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'candidate_resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "storage_candidate_resume_owner_write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'candidate_resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "storage_employer_logo_owner_write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'employer-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;

-- Rollback notes:
-- This migration stores a copy of the pre-cleanup policies in private.rls_policy_consolidation_backup.
-- For a full rollback, drop all policies created above and recreate the policy definitions from the
-- saved pg_policies output in version control or from the backup table. The exact pre-cleanup live
-- policies removed by this migration were:
-- application_status_history:
--   Employers can insert own application history
--   Employers can select own application history
-- applications:
--   Candidates can create applications
--   Candidates can create their own applications
--   Candidates can insert own applications
--   Candidates can read own applications
--   Candidates can select own applications
--   Candidates can view their own applications
--   Employers can read their applications
--   Employers can select own applications
--   Employers can select own applications by job
--   Employers can update own applications
--   Employers can update own applications by job
--   Employers can update their applications
-- candidate_profiles:
--   Candidates can create their own candidate profile
--   Candidates can read their own candidate profile
--   Candidates can update their own candidate profile
--   candidate profiles can be viewed
-- conversations:
--   Candidates can read conversations
--   Employers can create conversations
--   Employers can read conversations
-- employer_profiles:
--   Candidates can read employer profiles
--   Employers can create their own employer profile
--   Employers can read their own employer profile
--   Employers can update their own employer profile
-- hiring_requests:
--   Employers can insert their own hiring requests
--   Employers can view their own hiring requests
-- jobs:
--   Candidates can view jobs
--   Employers can delete their own jobs
--   Employers can insert their own jobs
--   Employers can update their own jobs
--   Employers can view their own jobs
-- messages:
--   Candidates can read messages
--   Candidates can send messages
--   Employers can insert messages
--   Employers can mark their messages as read
--   Employers can read their messages
--   candidates can mark messages as read
-- profiles:
--   Users can create their own profile
--   Users can read their own profile
--   Users can update their own profile
-- saved_candidates:
--   Allow employers to save candidates
--   Employers see their saved candidates
-- saved_jobs:
--   Candidates can remove their own saved jobs
--   Candidates can save jobs
--   Candidates can view their own saved jobs
-- storage.objects:
--   Allow authenticated users to upload photos 1gz2qsq_0
--   Allow authenticated users to upload photos 1v956t9_0
--   Allow public viewing of candidate photos
--   Allow public viewing of candidate resumes 1gz2qsq_0
--   Employers can upload photos
--   Employers can view photos
