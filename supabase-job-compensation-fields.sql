-- Placely V1 job compensation structure.
-- Run this after reviewing current jobs. This migration is non-destructive:
-- it preserves jobs.pay_range for legacy display and adds structured fields
-- used by post-job/edit-job flows going forward.

alter table public.jobs
  add column if not exists compensation_type text,
  add column if not exists compensation_min numeric,
  add column if not exists compensation_max numeric;

alter table public.jobs
  drop constraint if exists jobs_compensation_type_check;

alter table public.jobs
  add constraint jobs_compensation_type_check
  check (
    compensation_type is null
    or compensation_type in ('hourly', 'annual')
  );

alter table public.jobs
  drop constraint if exists jobs_compensation_range_check;

alter table public.jobs
  add constraint jobs_compensation_range_check
  check (
    (
      compensation_type is null
      and compensation_min is null
      and compensation_max is null
    )
    or (
      compensation_type in ('hourly', 'annual')
      and compensation_min is not null
      and compensation_max is not null
      and compensation_min > 0
      and compensation_max >= compensation_min
    )
  );

comment on column public.jobs.compensation_type is
  'Structured job compensation type: hourly or annual. Legacy jobs may have null and use pay_range.';

comment on column public.jobs.compensation_min is
  'Structured minimum compensation for this specific job.';

comment on column public.jobs.compensation_max is
  'Structured maximum compensation for this specific job.';

-- Legacy data migration plan:
-- Keep public.jobs.pay_range as-is. Because historical values may include
-- inconsistent text such as "competitive" or "depends", do not backfill these
-- fields automatically. Employers can populate structured compensation when
-- editing old jobs; new job posts require these columns.
