-- Placely V1 job boosts.
-- Non-destructive migration for paid job promotion records.

create table if not exists public.job_boosts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  employer_id uuid not null references public.employer_profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'expired', 'cancelled', 'failed')),
  budget_cents integer not null check (budget_cents in (2500, 5000, 10000, 20000)),
  currency text not null default 'cad' check (currency = 'cad'),
  duration_days integer not null check (duration_days in (3, 7, 14, 30)),
  starts_at timestamptz,
  ends_at timestamptz,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_boosts_job_status_idx
  on public.job_boosts (job_id, status, ends_at);

create index if not exists job_boosts_employer_status_idx
  on public.job_boosts (employer_id, status, ends_at);

create unique index if not exists job_boosts_stripe_checkout_session_uidx
  on public.job_boosts (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

alter table public.job_boosts enable row level security;

drop policy if exists "job_boosts_select_own_employer" on public.job_boosts;
create policy "job_boosts_select_own_employer"
  on public.job_boosts
  for select
  to authenticated
  using (
    employer_id = auth.uid()
    or exists (
      select 1
      from public.jobs j
      where j.id = job_boosts.job_id
        and j.employer_id = auth.uid()
    )
  );

drop policy if exists "job_boosts_select_active_public" on public.job_boosts;
create policy "job_boosts_select_active_public"
  on public.job_boosts
  for select
  to anon, authenticated
  using (
    status = 'active'
    and starts_at <= now()
    and ends_at > now()
    and exists (
      select 1
      from public.jobs j
      where j.id = job_boosts.job_id
        and coalesce(j.status, 'active') in ('active', 'published', 'open')
    )
  );
