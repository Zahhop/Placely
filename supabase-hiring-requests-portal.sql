-- Placely employer Hiring Requests consultation support.
-- Run this once in the Supabase SQL editor if the existing table is missing
-- the status column or employer-only RLS policies.

alter table public.hiring_requests
  add column if not exists status text default 'submitted';

update public.hiring_requests
set status = 'submitted'
where status is null or btrim(status) = '';

alter table public.hiring_requests
  alter column status set default 'submitted';

alter table public.hiring_requests enable row level security;

drop policy if exists "Employers can insert own hiring requests" on public.hiring_requests;
create policy "Employers can insert own hiring requests"
  on public.hiring_requests
  for insert
  to authenticated
  with check (employer_id = auth.uid());

drop policy if exists "Employers can select own hiring requests" on public.hiring_requests;
create policy "Employers can select own hiring requests"
  on public.hiring_requests
  for select
  to authenticated
  using (employer_id = auth.uid());
