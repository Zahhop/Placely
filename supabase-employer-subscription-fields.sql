alter table public.employer_profiles
add column if not exists subscription_status text default 'free',
add column if not exists candidate_access boolean default false,
add column if not exists subscription_plan text,
add column if not exists subscription_started_at timestamptz;
