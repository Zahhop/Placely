-- Employer onboarding/profile matching fields.
-- Non-destructive: keeps legacy hiring_needs and pay_range for fallback display.

alter table public.employer_profiles
  add column if not exists hiring_roles text[] not null default '{}',
  add column if not exists hiring_role_other text,
  add column if not exists compensation_type text,
  add column if not exists compensation_min numeric,
  add column if not exists compensation_max numeric;

alter table public.employer_profiles
  drop constraint if exists employer_profiles_compensation_type_check,
  add constraint employer_profiles_compensation_type_check
    check (
      compensation_type is null
      or compensation_type in ('hourly', 'annual')
    );

alter table public.employer_profiles
  drop constraint if exists employer_profiles_compensation_range_check,
  add constraint employer_profiles_compensation_range_check
    check (
      compensation_min is null
      or compensation_max is null
      or (
        compensation_min > 0
        and compensation_max > 0
        and compensation_max >= compensation_min
      )
    );

-- Safe backfill path for existing free-text hiring_needs.
-- This preserves the original hiring_needs column and only populates hiring_roles
-- for exact known role names. Review "Other" values manually before adding them
-- to hiring_role_other.
update public.employer_profiles
set hiring_roles = array(
  select distinct role
  from unnest(array[
    'Electrician',
    'Electrical Apprentice',
    'HVAC Technician',
    'HVAC Apprentice',
    'Plumber',
    'Plumbing Apprentice',
    'Carpenter',
    'Welder',
    'Millwright',
    'Heavy Equipment Operator',
    'General Labourer',
    'Construction Labourer',
    'Project Manager',
    'Site Supervisor',
    'Estimator'
  ]) as role
  where hiring_needs ilike '%' || role || '%'
)
where coalesce(array_length(hiring_roles, 1), 0) = 0
  and nullif(trim(coalesce(hiring_needs, '')), '') is not null;

