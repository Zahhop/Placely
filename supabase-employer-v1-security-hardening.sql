-- Employer V1 security hardening.
-- Run after the subscription fields and saved_talent table exist.
-- This keeps Candidate Access and logo storage enforced server-side.

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

revoke update (
  candidate_access,
  subscription_status,
  subscription_plan,
  subscription_started_at,
  stripe_customer_id,
  stripe_subscription_id
) on public.employer_profiles from anon, authenticated;

alter table public.saved_talent enable row level security;

drop policy if exists "Employers can read their saved talent" on public.saved_talent;
create policy "Employers can read their saved talent"
  on public.saved_talent
  for select
  to authenticated
  using (
    employer_id = auth.uid()
    and private.employer_has_candidate_access(auth.uid())
  );

drop policy if exists "Employers can save talent" on public.saved_talent;
create policy "Employers can save talent"
  on public.saved_talent
  for insert
  to authenticated
  with check (
    employer_id = auth.uid()
    and private.employer_has_candidate_access(auth.uid())
  );

drop policy if exists "Employers can remove saved talent" on public.saved_talent;
create policy "Employers can remove saved talent"
  on public.saved_talent
  for delete
  to authenticated
  using (
    employer_id = auth.uid()
    and private.employer_has_candidate_access(auth.uid())
  );

drop policy if exists "storage_employer_logo_owner_update" on storage.objects;
create policy "storage_employer_logo_owner_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'employer-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'employer-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "storage_employer_logo_owner_delete" on storage.objects;
create policy "storage_employer_logo_owner_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'employer-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

