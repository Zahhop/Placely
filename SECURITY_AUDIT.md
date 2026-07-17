# Placely Security Audit

Date: 2026-07-16

## Scope

Reviewed the checked-in Placely frontend, Supabase SQL files, Storage usage, and Edge Functions. The Supabase CLI is not installed in this workspace, so live database metadata could not be dumped from project `ornxlspufzmvapdrwexc`. Run the inventory queries in `supabase-security-hardening.sql` review context against the live project before launch.

## Table Inventory

| Table | Purpose | Sensitive Data | Frontend Access | Existing Checked-In Security Notes |
| --- | --- | --- | --- | --- |
| `profiles` | Account role mapping | Email, role | auth routing/signup | Used by auth guards; no checked-in RLS migration found before hardening. |
| `employer_profiles` | Employer account/company/billing state | Contact info, Stripe IDs, subscription/access flags | employer profile, dashboard, candidate job board, messages, checkout | Subscription columns existed without checked-in column update revokes. |
| `candidate_profiles` | Candidate profile/search data | Contact info, resume/photo URLs, bio, skills | candidate profile/setup, employer candidate search, messages, applications | UI gated candidate search by `candidate_access`; direct table RLS must enforce it. |
| `jobs` | Employer job postings | Mostly public posting data plus owner id | post/edit/manage/find/apply jobs | Client supplied `employer_id`; hardening adds ownership policy and trigger. |
| `applications` | Candidate applications and employer pipeline | Candidate snapshot, email, phone, resume URL, notes, statuses | apply, candidate applications, employer applicants/dashboard/messages | Existing insert trusted client `employer_id`; candidate update policy was broad. |
| `application_status_history` | Employer status audit log | Status history | employer applicants | Existing policy was employer-owned by job; preserved and tightened. |
| `saved_talent` | Employer saved candidates | Employer/candidate relationship | find candidates, saved talent, dashboard | Existing table confirmed; no `saved_candidates` table mismatch in current code. |
| `saved_jobs` | Candidate saved jobs | Candidate/job relationship | find jobs, saved jobs, dashboard | No checked-in create/policy file found; hardening adds owner policies if table exists. |
| `conversations` | Employer/candidate threads | Participant relationship and profile snapshots | employer/candidate messages, applications | Hardening restricts reads/writes to participants and valid relationships. |
| `messages` | Chat messages | Message body, read state | employer/candidate messages, dashboard | Hardening enforces participant reads and sender identity. |
| `hiring_requests` | V1-disabled recruiting request infrastructure | Employer contact/hiring needs | disabled route/config, optional page code remains | Existing SQL enabled employer-only insert/select; hardening preserves locked-down access. |

## Storage Inventory

| Bucket | Usage | Desired Access |
| --- | --- | --- |
| `candidate_photos` | Candidate profile photos | Public read, authenticated owner write/delete by `auth.uid()` path prefix. |
| `candidate_resumes` | Candidate resumes | Candidate owner read/write; employer read only when they own an application for that candidate. |
| `employer-logos` | Employer logos | Public read, authenticated owner write/delete by `auth.uid()` path prefix. |

## Edge Function Inventory

| Function | Public/Auth | Service Role | Security Requirements |
| --- | --- | --- | --- |
| `create-candidate-checkout` | Authenticated employer only | Yes | Uses env Stripe secret/Price ID, validates origin/app path, verifies employer profile, returns Checkout URL only. |
| `stripe-webhook` | Public for Stripe only | Yes | Verifies raw body with `Stripe-Signature`, checks configured Price ID, updates billing/access idempotently by subscription/customer. |
| `send-placely-email` | Public support forms; authenticated employer for hiring request | Yes for employer verification | Server-side recipients only, Resend key in env, input sanitization, cooldown/honeypot, request size/origin checks. |
| `delete-candidate-account` | Authenticated candidate only | Yes | Verifies candidate profile before anonymization/deletion, restricted CORS, generic errors. |

## Ranked Findings

### Critical

- Candidate Network search depended on frontend gating. Without strict RLS, an authenticated employer without `candidate_access` could query `candidate_profiles` directly.
- Application RLS trusted client-supplied `employer_id`, allowing forged applications or cross-employer visibility if policies used that field directly.
- Candidates could update employer-controlled application fields through broad application update policy.
- Messages/conversations needed database-level participant and sender enforcement.
- Browser users could potentially update employer billing/access fields unless column privileges block it.

### High

- Stripe past-due state previously left `candidate_access` enabled.
- `invoice.payment_failed` handling was not Price-aware.
- Candidate account deletion used service-role authority without verifying the user had a candidate profile.
- Candidate profile upload accepted files without type/size checks on the edit profile page.

### Medium

- `delete-candidate-account` had wildcard CORS.
- Email function accepted public requests without explicit origin/size checks.
- Storage bucket policies were not represented in checked-in SQL.
- Live Supabase grants/policies were not dumpable from this workspace.

### Low

- Several UI templates use `innerHTML`; most security-sensitive templates escape values, but continued review is recommended.
- CAPTCHA and Supabase Auth rate-limit settings are manual dashboard items.

## Changes Made

- Added `supabase-security-hardening.sql` with RLS policies, ownership helper functions, triggers, billing-column update revokes, and Storage policies.
- Updated candidate application/reapply UI to stop sending `employer_status`.
- Added upload MIME/size validation for candidate photos, resumes, and employer logos.
- Hardened Stripe checkout employer verification and safe error responses.
- Hardened Stripe webhook entitlement handling for active/trialing only, Price-aware failed invoice handling, and generic webhook errors.
- Hardened email function origin and request-size checks.
- Hardened candidate deletion method, CORS, candidate-profile verification, and error handling.

## Manual Supabase Dashboard Settings

- Enable email confirmation before launch.
- Configure Auth rate limits for signup, login, OTP/email resend, and password recovery.
- Add CAPTCHA to signup and password recovery flows.
- Confirm Storage buckets:
  - `candidate_photos` public.
  - `employer-logos` public.
  - `candidate_resumes` private unless signed URL architecture is intentionally chosen.
- Confirm Edge Function secrets:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_CANDIDATE_ACCESS_PRICE_ID`
  - `RESEND_API_KEY`
  - `PLACELY_HIRING_EMAIL`
  - `PLACELY_SUPPORT_EMAIL`
  - `PLACELY_FROM_EMAIL`
- Ensure the Stripe webhook endpoint is deployed with signature verification and not protected by JWT.

## Adversarial Test Matrix

Actors: Employer A, Employer B, Candidate A, Candidate B, signed-out visitor, Employer C without candidate access.

| Attempt | Expected Result |
| --- | --- |
| Employer B reads Employer A private employer profile row | Denied unless only public active-job row visibility is intended. |
| Employer B updates Employer A job | Denied. |
| Employer A inserts job with `employer_id` = Employer B | Insert is rejected or trigger resets to Employer A. |
| Signed-out visitor reads jobs | Only active/published jobs returned. |
| Candidate B reads Candidate A profile directly | Denied unless they are the same user. |
| Employer C queries visible candidates without `candidate_access` | Denied. |
| Employer A with access queries visible candidates | Allowed. |
| Candidate A creates application for Candidate B | Denied. |
| Candidate A creates application with forged `employer_id` | Trigger resets/validates against referenced job. |
| Employer B reads Employer A applications | Denied. |
| Candidate A updates `employer_status` or `employer_notes` | Denied. |
| Employer A updates applicant status for own job | Allowed. |
| Employer B updates applicant status for Employer A job | Denied. |
| Candidate A opens conversation with unrelated Employer B without an application | Denied. |
| Employer C without candidate access starts candidate-search conversation | Denied. |
| Message insert with forged `sender_type` or participant id | Denied. |
| Message update changes body/sender/conversation | Denied. |
| Candidate A reads Candidate B resume object | Denied. |
| Employer A reads Candidate A resume without owning application | Denied. |
| Employer A updates `candidate_access` from browser | Denied by column privileges. |
| Checkout invoked by candidate account | Denied. |
| Email function receives arbitrary `to` address | Ignored; recipient selected server-side by `form_type`. |

## Safe Test Examples

Run as different authenticated users in the browser console after deployment:

```js
await supabase.from("employer_profiles").update({ candidate_access: true }).eq("id", "<own-employer-id>");
```

Expected: permission error.

```js
await supabase.from("messages").insert({
  conversation_id: "<unrelated-conversation-id>",
  sender_type: "employer",
  employer_id: "<other-employer-id>",
  candidate_id: "<candidate-id>",
  message: "forged"
});
```

Expected: permission error.

```js
await supabase.from("candidate_profiles").select("*");
```

Expected: only own candidate row, paid-access visible rows for entitled employers, or no rows depending on actor.

## Launch Blockers

- Dump and review live Supabase RLS policies/grants before launch. The CLI was unavailable locally.
- Run `supabase-security-hardening.sql` in a staging project first and verify policies/triggers against live columns.
- Confirm `candidate_resumes` bucket privacy/public setting matches the intended URL strategy.
- Add CAPTCHA and Auth rate-limit settings in Supabase Dashboard.
- Deploy and test all Edge Functions with real environment secrets in staging.
