-- Placely Talent application and hiring pipeline support.
-- Run this in Supabase SQL editor if your applications table does not already
-- include these columns and constraints.

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  candidate_id uuid not null,
  employer_id uuid not null,
  status text not null default 'submitted',
  candidate_status text,
  employer_status text,
  cover_letter text,
  additional_notes text,
  candidate_snapshot jsonb,
  resume_url text,
  job_title text,
  company_name text,
  location text,
  employment_type text,
  pay_range text,
  candidate_name text,
  candidate_email text,
  candidate_phone text,
  candidate_role text,
  conversation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  interview_date timestamptz,
  offer_sent_at timestamptz,
  hired_at timestamptz,
  rejected_at timestamptz,
  withdrawn_at timestamptz,
  reapplied_at timestamptz,
  candidate_deleted_at timestamptz
);

alter table public.applications
  add column if not exists status text not null default 'submitted';

alter table public.applications
  alter column status set default 'submitted';

alter table public.applications
  add column if not exists candidate_status text,
  add column if not exists employer_status text,
  add column if not exists cover_letter text,
  add column if not exists additional_notes text,
  add column if not exists candidate_snapshot jsonb,
  add column if not exists resume_url text,
  add column if not exists job_title text,
  add column if not exists company_name text,
  add column if not exists location text,
  add column if not exists employment_type text,
  add column if not exists pay_range text,
  add column if not exists candidate_name text,
  add column if not exists candidate_email text,
  add column if not exists candidate_phone text,
  add column if not exists candidate_role text,
  add column if not exists conversation_id uuid,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists reviewed_at timestamptz,
  add column if not exists interview_date timestamptz,
  add column if not exists offer_sent_at timestamptz,
  add column if not exists hired_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists withdrawn_at timestamptz,
  add column if not exists reapplied_at timestamptz,
  add column if not exists candidate_deleted_at timestamptz;

alter table public.candidate_profiles
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz;

create unique index if not exists applications_candidate_job_unique
  on public.applications (candidate_id, job_id);

create index if not exists applications_employer_status_idx
  on public.applications (employer_id, status, created_at desc);

alter table public.applications
  drop constraint if exists applications_status_check;

alter table public.applications
  add constraint applications_status_check
  check (status in ('new', 'submitted', 'reviewing', 'interview', 'offer', 'hired', 'rejected', 'withdrawn', 'candidate_deleted'));

alter table public.applications enable row level security;

drop policy if exists "Candidates can insert own applications" on public.applications;
create policy "Candidates can insert own applications"
  on public.applications
  for insert
  to authenticated
  with check (candidate_id = auth.uid());

drop policy if exists "Candidates can select own applications" on public.applications;
create policy "Candidates can select own applications"
  on public.applications
  for select
  to authenticated
  using (candidate_id = auth.uid());

drop policy if exists "Employers can select own applications" on public.applications;
create policy "Employers can select own applications"
  on public.applications
  for select
  to authenticated
  using (employer_id = auth.uid());

drop policy if exists "Employers can update own applications" on public.applications;
create policy "Employers can update own applications"
  on public.applications
  for update
  to authenticated
  using (employer_id = auth.uid())
  with check (employer_id = auth.uid());

drop policy if exists "Candidates can update own applications" on public.applications;
create policy "Candidates can update own applications"
  on public.applications
  for update
  to authenticated
  using (candidate_id = auth.uid())
  with check (candidate_id = auth.uid());

-- The application insert must copy employer_id from jobs.employer_id in client code.
