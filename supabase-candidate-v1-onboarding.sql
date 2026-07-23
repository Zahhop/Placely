-- Candidate V1 launch hardening: explicit onboarding completion state.
-- Run this in Supabase SQL editor before launch so the frontend can store
-- completion separately from the individual profile fields.

alter table public.candidate_profiles
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists onboarding_completed_at timestamptz;

update public.candidate_profiles
set
  onboarding_completed = true,
  onboarding_completed_at = coalesce(onboarding_completed_at, updated_at, created_at, now())
where
  nullif(trim(coalesce(trade, '')), '') is not null
  and nullif(trim(coalesce(experience, '')), '') is not null
  and nullif(trim(coalesce(bio, '')), '') is not null
  and nullif(trim(coalesce(availability, '')), '') is not null
  and nullif(trim(coalesce(contact_method, '')), '') is not null
  and lower(
    regexp_replace(
      replace(coalesce(shown_contact_method, ''), '&', 'and'),
      '[_-]+',
      ' ',
      'g'
    )
  ) in ('email', 'email only', 'phone', 'phone only', 'both', 'email and phone', 'phone and email', 'email phone');

