-- Placely Talent applicant pipeline enhancements.
-- Run this manually in the Supabase SQL editor after reviewing the policies.
-- This migration is additive and does not delete existing application data.

alter table public.applications
  add column if not exists employer_notes text;

alter table public.applications
  drop constraint if exists applications_status_check;

alter table public.applications
  add constraint applications_status_check
  check (status in (
    'new',
    'submitted',
    'reviewing',
    'interview',
    'offer',
    'hired',
    'rejected',
    'withdrawn',
    'candidate_deleted'
  ));

create table if not exists public.application_status_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  employer_id uuid not null,
  previous_status text,
  new_status text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid
);

create index if not exists application_status_history_application_idx
  on public.application_status_history (application_id, changed_at desc);

create index if not exists application_status_history_employer_idx
  on public.application_status_history (employer_id, changed_at desc);

create index if not exists applications_job_status_idx
  on public.applications (job_id, status, created_at desc);

create index if not exists applications_employer_job_status_idx
  on public.applications (employer_id, job_id, status, created_at desc);

alter table public.application_status_history enable row level security;

drop policy if exists "Employers can select own application history" on public.application_status_history;
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

drop policy if exists "Employers can insert own application history" on public.application_status_history;
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

drop policy if exists "Employers can select own applications by job" on public.applications;
create policy "Employers can select own applications by job"
  on public.applications
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.jobs j
      where j.id = applications.job_id
        and j.employer_id = auth.uid()
    )
  );

drop policy if exists "Employers can update own applications by job" on public.applications;
create policy "Employers can update own applications by job"
  on public.applications
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.jobs j
      where j.id = applications.job_id
        and j.employer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.jobs j
      where j.id = applications.job_id
        and j.employer_id = auth.uid()
    )
  );

-- Optional cleanup after confirming these stricter job-ownership policies work:
-- drop policy if exists "Employers can select own applications" on public.applications;
-- drop policy if exists "Employers can update own applications" on public.applications;
