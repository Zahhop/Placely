-- Employer V1 launch hardening: explicit onboarding completion state.
-- Run this in Supabase SQL editor before launch so auth guards can require
-- completed setup independently from individual profile fields.

alter table public.employer_profiles
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists onboarding_completed_at timestamptz;

update public.employer_profiles
set
  onboarding_completed = true,
  onboarding_completed_at = coalesce(onboarding_completed_at, updated_at, created_at, now())
where
  nullif(trim(coalesce(company_location, '')), '') is not null
  and nullif(trim(coalesce(company_description, '')), '') is not null
  and nullif(trim(coalesce(main_hiring_industry, '')), '') is not null
  and nullif(trim(coalesce(employment_type, '')), '') is not null
  and nullif(trim(coalesce(hiring_needs, '')), '') is not null
  and nullif(trim(coalesce(pay_range, '')), '') is not null
  and nullif(trim(coalesce(hiring_timeline, '')), '') is not null
  and nullif(trim(coalesce(candidate_qualities, '')), '') is not null;

