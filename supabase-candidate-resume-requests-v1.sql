-- V1 candidate resume request workflow.
-- Run manually in Supabase SQL Editor before deploying the resume request Edge Functions.
-- This is non-destructive: the legacy candidate_resume_access_requests table is left in place.

create table if not exists public.candidate_resume_requests (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  employer_id uuid not null references public.employer_profiles(id) on delete cascade,
  job_id uuid null references public.jobs(id) on delete set null,
  status text not null default 'pending',
  request_message text null,
  response_message text null,
  conversation_id uuid null,
  message_id uuid null,
  requested_at timestamptz not null default now(),
  responded_at timestamptz null,
  expires_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_resume_requests_status_check
    check (status in ('pending', 'approved', 'declined', 'revoked', 'expired'))
);

do $$
begin
  if to_regclass('public.candidate_resume_access_requests') is not null then
    insert into public.candidate_resume_requests (
      id,
      candidate_id,
      employer_id,
      status,
      request_message,
      response_message,
      conversation_id,
      message_id,
      requested_at,
      responded_at,
      expires_at,
      revoked_at,
      created_at,
      updated_at
    )
    select
      id,
      candidate_id,
      employer_id,
      case
        when status in ('pending', 'approved', 'declined', 'revoked', 'expired') then status
        else 'pending'
      end,
      request_message,
      response_message,
      conversation_id,
      message_id,
      requested_at,
      responded_at,
      case
        when status = 'approved' then coalesce(responded_at, requested_at, now()) + interval '30 days'
        else null
      end,
      case
        when status = 'revoked' then coalesce(responded_at, updated_at, now())
        else null
      end,
      created_at,
      updated_at
    from public.candidate_resume_access_requests
    on conflict (id) do nothing;
  end if;
end $$;

create unique index if not exists candidate_resume_requests_pending_unique
  on public.candidate_resume_requests(candidate_id, employer_id)
  where status = 'pending';

create index if not exists candidate_resume_requests_candidate_idx
  on public.candidate_resume_requests(candidate_id, requested_at desc);

create index if not exists candidate_resume_requests_employer_idx
  on public.candidate_resume_requests(employer_id, requested_at desc);

create index if not exists candidate_resume_requests_job_idx
  on public.candidate_resume_requests(job_id);

alter table public.candidate_resume_requests enable row level security;

drop policy if exists "candidate_resume_requests_candidate_select" on public.candidate_resume_requests;
create policy "candidate_resume_requests_candidate_select"
  on public.candidate_resume_requests
  for select
  to authenticated
  using (candidate_id = auth.uid());

drop policy if exists "candidate_resume_requests_employer_select" on public.candidate_resume_requests;
create policy "candidate_resume_requests_employer_select"
  on public.candidate_resume_requests
  for select
  to authenticated
  using (employer_id = auth.uid());

-- Writes are handled by Edge Functions with the service-role key so candidates
-- cannot self-grant resume access and employers cannot approve their own requests.
