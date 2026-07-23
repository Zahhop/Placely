create table if not exists public.transactional_email_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text unique,
  stripe_checkout_session_id text,
  stripe_subscription_id text,
  stripe_invoice_id text,
  employer_user_id uuid references public.employer_profiles(id) on delete set null,
  template_name text not null,
  recipient_email text not null,
  status text not null default 'pending',
  provider_email_id text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.transactional_email_events enable row level security;

create unique index if not exists transactional_email_events_session_template_uidx
  on public.transactional_email_events (stripe_checkout_session_id, template_name)
  where stripe_checkout_session_id is not null;

create unique index if not exists transactional_email_events_invoice_template_uidx
  on public.transactional_email_events (stripe_invoice_id, template_name)
  where stripe_invoice_id is not null;

create unique index if not exists transactional_email_events_subscription_cancelled_uidx
  on public.transactional_email_events (stripe_subscription_id, template_name)
  where stripe_subscription_id is not null
    and template_name = 'candidate-access-cancelled';

create index if not exists transactional_email_events_employer_created_idx
  on public.transactional_email_events (employer_user_id, created_at desc);

create index if not exists transactional_email_events_status_created_idx
  on public.transactional_email_events (status, created_at desc);
