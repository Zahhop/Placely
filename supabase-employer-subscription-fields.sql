alter table public.employer_profiles
add column if not exists subscription_status text default 'free',
add column if not exists candidate_access boolean default false,
add column if not exists subscription_plan text,
add column if not exists subscription_started_at timestamptz,
add column if not exists stripe_customer_id text,
add column if not exists stripe_subscription_id text;

create unique index if not exists employer_profiles_stripe_customer_id_uidx
  on public.employer_profiles (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists employer_profiles_stripe_subscription_id_uidx
  on public.employer_profiles (stripe_subscription_id)
  where stripe_subscription_id is not null;
