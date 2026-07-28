alter table public.candidate_profiles
  add column if not exists willing_to_travel text,
  add column if not exists employment_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'candidate_profiles_willing_to_travel_check'
  ) then
    alter table public.candidate_profiles
      add constraint candidate_profiles_willing_to_travel_check
      check (
        willing_to_travel is null
        or willing_to_travel = ''
        or willing_to_travel in (
          'Not willing',
          'Within city',
          'Within region',
          'Within province',
          'Canada-wide',
          'International'
        )
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'candidate_profiles_employment_type_check'
  ) then
    alter table public.candidate_profiles
      add constraint candidate_profiles_employment_type_check
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
          'Open to all'
        )
      ) not valid;
  end if;
end $$;
