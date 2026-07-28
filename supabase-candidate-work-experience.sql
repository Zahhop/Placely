-- Placely V1 candidate work-experience records.
-- Non-destructive: adds a structured owned table for candidate profile work history.

create table if not exists public.candidate_work_experience (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  job_title text not null,
  company_name text not null,
  location text null,
  employment_type text null,
  start_month smallint not null,
  start_year smallint not null,
  end_month smallint null,
  end_year smallint null,
  is_current boolean not null default false,
  description text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_work_experience_employment_type_check
    check (
      employment_type is null
      or employment_type = ''
      or employment_type in (
        'Full-time',
        'Part-time',
        'Contract',
        'Temporary',
        'Casual',
        'Apprenticeship',
        'Internship',
        'Self-employed',
        'Other'
      )
    ),
  constraint candidate_work_experience_start_month_check
    check (start_month between 1 and 12),
  constraint candidate_work_experience_start_year_check
    check (start_year between 1950 and 2100),
  constraint candidate_work_experience_end_month_check
    check (end_month is null or end_month between 1 and 12),
  constraint candidate_work_experience_end_year_check
    check (end_year is null or end_year between 1950 and 2100),
  constraint candidate_work_experience_current_end_date_check
    check (
      (is_current = true and end_month is null and end_year is null)
      or (is_current = false and end_month is not null and end_year is not null)
    ),
  constraint candidate_work_experience_date_order_check
    check (
      is_current = true
      or ((end_year * 100 + end_month) >= (start_year * 100 + start_month))
    )
);

create index if not exists candidate_work_experience_candidate_idx
  on public.candidate_work_experience(candidate_id);

alter table public.candidate_work_experience enable row level security;

drop policy if exists "Candidates can view own work experience" on public.candidate_work_experience;
create policy "Candidates can view own work experience"
on public.candidate_work_experience
for select
to authenticated
using (auth.uid() = candidate_id);

drop policy if exists "Candidates can create own work experience" on public.candidate_work_experience;
create policy "Candidates can create own work experience"
on public.candidate_work_experience
for insert
to authenticated
with check (auth.uid() = candidate_id);

drop policy if exists "Candidates can update own work experience" on public.candidate_work_experience;
create policy "Candidates can update own work experience"
on public.candidate_work_experience
for update
to authenticated
using (auth.uid() = candidate_id)
with check (auth.uid() = candidate_id);

drop policy if exists "Candidates can delete own work experience" on public.candidate_work_experience;
create policy "Candidates can delete own work experience"
on public.candidate_work_experience
for delete
to authenticated
using (auth.uid() = candidate_id);

create or replace function public.touch_candidate_work_experience_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists candidate_work_experience_touch_updated_at on public.candidate_work_experience;
create trigger candidate_work_experience_touch_updated_at
before update on public.candidate_work_experience
for each row
execute function public.touch_candidate_work_experience_updated_at();

comment on table public.candidate_work_experience is 'Owned structured work-history records shown on candidate profile previews.';
