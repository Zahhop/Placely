create table if not exists public.saved_talent (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employer_profiles(id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists saved_talent_employer_candidate_uidx
  on public.saved_talent (employer_id, candidate_id);

create index if not exists saved_talent_employer_idx
  on public.saved_talent (employer_id, created_at desc);

alter table public.saved_talent enable row level security;

drop policy if exists "Employers can read their saved talent" on public.saved_talent;
create policy "Employers can read their saved talent"
  on public.saved_talent
  for select
  using (employer_id = auth.uid());

drop policy if exists "Employers can save talent" on public.saved_talent;
create policy "Employers can save talent"
  on public.saved_talent
  for insert
  with check (employer_id = auth.uid());

drop policy if exists "Employers can remove saved talent" on public.saved_talent;
create policy "Employers can remove saved talent"
  on public.saved_talent
  for delete
  using (employer_id = auth.uid());
