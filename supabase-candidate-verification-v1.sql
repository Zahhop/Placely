-- Placely V1 candidate verification workflow.
-- Non-destructive: adds verification fields and request/audit table.

alter table public.candidate_profiles
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verification_requested_at timestamptz null,
  add column if not exists verified_at timestamptz null,
  add column if not exists verified_by uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'candidate_profiles_verification_status_check'
  ) then
    alter table public.candidate_profiles
      add constraint candidate_profiles_verification_status_check
      check (verification_status in ('unverified', 'pending', 'verified', 'rejected'));
  end if;
end $$;

create table if not exists public.candidate_verification_requests (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  status text not null default 'pending',
  request_message text null,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz null,
  reviewed_by uuid null,
  internal_notes text null,
  constraint candidate_verification_requests_status_check
    check (status in ('pending', 'approved', 'rejected'))
);

create unique index if not exists candidate_verification_requests_one_pending_idx
  on public.candidate_verification_requests(candidate_id)
  where status = 'pending';

alter table public.candidate_verification_requests enable row level security;

drop policy if exists "Candidates can read own candidate profile" on public.candidate_profiles;
create policy "Candidates can read own candidate profile"
on public.candidate_profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "Candidates can view own verification requests" on public.candidate_verification_requests;
create policy "Candidates can view own verification requests"
on public.candidate_verification_requests
for select
to authenticated
using (auth.uid() = candidate_id);

drop policy if exists "Candidates can create own pending verification requests" on public.candidate_verification_requests;
create policy "Candidates can create own pending verification requests"
on public.candidate_verification_requests
for insert
to authenticated
with check (
  auth.uid() = candidate_id
  and status = 'pending'
  and reviewed_at is null
  and reviewed_by is null
  and internal_notes is null
);

create or replace function public.prevent_candidate_verification_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if old.verification_status is distinct from new.verification_status
    or old.verification_requested_at is distinct from new.verification_requested_at
    or old.verified_at is distinct from new.verified_at
    or old.verified_by is distinct from new.verified_by then
    raise exception 'Verification fields can only be changed by Placely review workflow.';
  end if;

  return new;
end;
$$;

drop trigger if exists candidate_profiles_prevent_verification_self_update on public.candidate_profiles;
create trigger candidate_profiles_prevent_verification_self_update
before update on public.candidate_profiles
for each row
execute function public.prevent_candidate_verification_self_update();

comment on column public.candidate_profiles.verification_status is 'Placely manual verification state: unverified, pending, verified, rejected.';
comment on table public.candidate_verification_requests is 'Audit trail for manual Placely candidate verification review requests.';
