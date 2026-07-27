-- Placely public company profiles view.
-- Non-destructive migration: exposes only intentional public employer fields.
-- Required for logged-out public company profiles and company directory reads when
-- employer_profiles remains protected by RLS.
--
-- TODO: Replace the company_name-only visibility rule with an explicit
-- public_profile_enabled/profile_completed column when the product adds one.

begin;

create or replace view public.public_employer_profiles as
select distinct
  ep.id,
  ep.company_name,
  ep.industry,
  ep.company_website,
  ep.company_location,
  ep.company_description,
  ep.employment_type,
  ep.pay_range,
  ep.hiring_timeline,
  ep.main_hiring_industry,
  ep.company_logo_url,
  ep.created_at
from public.employer_profiles ep
where nullif(trim(ep.company_name), '') is not null;

revoke all on public.public_employer_profiles from public;
grant select on public.public_employer_profiles to anon, authenticated;

commit;
