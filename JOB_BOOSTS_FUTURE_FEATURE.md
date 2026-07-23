# JOB BOOSTS - FUTURE FEATURE

Job Boosts are disabled for Placely V1 so the current employer and candidate experience stays focused on core job posting, applicants, and editing workflows.

## Feature Flag

Frontend visibility is controlled by:

`window.PLACELY_FEATURES.jobBoosts` in `js/config.js`

The V1 value is `false`.

## Preserved Frontend

The implementation remains in:

- `employers/manage-jobs.html`
- `js/manage-jobs.js`
- `css/manage-jobs.css`
- `js/find-jobs.js`
- `css/find-jobs.css`
- `js/saved-jobs.js`
- `css/saved-jobs.css`

While disabled, the frontend does not render boost buttons, open boost modals, call checkout, show promoted labels, query boost records, or apply boosted ranking.

## Preserved Backend

The secure checkout function remains in:

- `supabase/functions/create-job-boost-checkout/index.ts`

The Stripe webhook branch remains in:

- `supabase/functions/stripe-webhook/index.ts`

Both should continue to enforce authentication, employer ownership, job eligibility, and Stripe webhook verification if called directly.

## Preserved Schema

The future migration is:

- `supabase-job-boosts.sql`

Do not apply this migration solely for V1 while Job Boosts are hidden.

## Stripe Status

No dedicated Job Boost Stripe product or price is required by the current implementation. Checkout uses backend-created one-time CAD price data when the feature is enabled.

## Re-Enable Checklist

1. Apply `supabase-job-boosts.sql` in Supabase.
2. Confirm `create-job-boost-checkout` and `stripe-webhook` are deployed.
3. Confirm Stripe webhook delivery for `checkout.session.completed`.
4. Set `window.PLACELY_FEATURES.jobBoosts = true`.
5. Test checkout, webhook activation, active boost display, and promoted ordering with Stripe test payments.
