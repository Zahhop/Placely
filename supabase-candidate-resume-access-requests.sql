-- Candidate resume access requests for employer-visible candidate profiles.
-- Run manually in Supabase SQL Editor before deploying the resume request Edge Functions.

create table if not exists public.candidate_resume_access_requests (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  employer_id uuid not null references public.employer_profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  requested_at timestamptz not null default now(),
  responded_at timestamptz null,
  request_message text null,
  response_message text null,
  conversation_id uuid null,
  message_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists candidate_resume_access_requests_pending_unique
  on public.candidate_resume_access_requests(candidate_id, employer_id)
  where status = 'pending';

create index if not exists candidate_resume_access_requests_candidate_idx
  on public.candidate_resume_access_requests(candidate_id, requested_at desc);

create index if not exists candidate_resume_access_requests_employer_idx
  on public.candidate_resume_access_requests(employer_id, requested_at desc);

alter table public.candidate_resume_access_requests enable row level security;

drop policy if exists "candidate_resume_request_candidate_select" on public.candidate_resume_access_requests;
create policy "candidate_resume_request_candidate_select"
  on public.candidate_resume_access_requests
  for select
  to authenticated
  using (candidate_id = auth.uid());

drop policy if exists "candidate_resume_request_employer_select" on public.candidate_resume_access_requests;
create policy "candidate_resume_request_employer_select"
  on public.candidate_resume_access_requests
  for select
  to authenticated
  using (employer_id = auth.uid());

-- Writes are handled by Edge Functions with the service-role key so candidates
-- cannot self-grant resume access and employers cannot approve their own requests.
