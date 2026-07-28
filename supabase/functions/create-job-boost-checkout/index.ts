import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe";

const allowedOrigins = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://zahhop.github.io",
  "https://placelytalent.com",
  "https://www.placelytalent.com"
]);

const allowedDurations = new Set([3, 7, 14, 30]);
const allowedBudgets = new Set([2500, 5000, 10000, 20000]);

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405, corsHeaders);
  }

  if (!isAllowedRequestOrigin(req)) {
    return json({ error: "Origin is not allowed." }, 403, corsHeaders);
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!stripeSecretKey || !supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Boost checkout is not configured." }, 500, corsHeaders);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader || !/^Bearer\s+\S+$/i.test(authHeader)) {
      return json({ error: "Unauthorized." }, 401, corsHeaders);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      return json({ error: "Boost request is invalid." }, 400, corsHeaders);
    }

    const jobId = String(body.job_id || "").trim();
    const durationDays = Number(body.duration_days);
    const budgetCents = Number(body.budget_cents);

    if (!isUuid(jobId) || !allowedDurations.has(durationDays) || !allowedBudgets.has(budgetCents)) {
      return json({ error: "Choose a valid boost duration and budget." }, 400, corsHeaders);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const {
      data: { user },
      error: userError
    } = await userClient.auth.getUser();

    if (userError || !user || !(user.email_confirmed_at || user.confirmed_at)) {
      return json({ error: "Unauthorized." }, 401, corsHeaders);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: accountProfile, error: accountError } = await admin
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle();

    if (accountError) throw accountError;

    if (!accountProfile || accountProfile.role !== "employer") {
      return json({ error: "Employer account required." }, 403, corsHeaders);
    }

    const { data: employerProfile, error: employerError } = await admin
      .from("employer_profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (employerError) throw employerError;

    if (!employerProfile || !isEmployerOnboardingComplete(employerProfile)) {
      return json({ error: "Complete your employer profile before boosting a job." }, 409, corsHeaders);
    }

    const { data: job, error: jobError } = await admin
      .from("jobs")
      .select("id, employer_id, job_title, company_name, location, status")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) throw jobError;

    if (!job || job.employer_id !== user.id) {
      return json({ error: "Job not found." }, 403, corsHeaders);
    }

    if (!isActiveJob(job.status)) {
      return json({ error: "Only active jobs can be boosted." }, 409, corsHeaders);
    }

    const { data: activeBoost, error: boostError } = await admin
      .from("job_boosts")
      .select("id")
      .eq("job_id", job.id)
      .eq("status", "active")
      .gt("ends_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();

    if (boostError) throw boostError;

    if (activeBoost) {
      return json({ error: "This job already has an active boost." }, 409, corsHeaders);
    }

    const checkoutLocation = getCheckoutLocation(req, body);
    const stripe = new Stripe(stripeSecretKey);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      client_reference_id: job.id,
      success_url: `${checkoutLocation.origin}${checkoutLocation.appPath}/employers/manage-jobs.html?boost=processing&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${checkoutLocation.origin}${checkoutLocation.appPath}/employers/manage-jobs.html?boost=cancelled`,
      line_items: [
        {
          price_data: {
            currency: "cad",
            product_data: {
              name: `Placely Job Boost: ${job.job_title || "Job posting"}`,
              description: `${durationDays} day job boost`
            },
            unit_amount: budgetCents
          },
          quantity: 1
        }
      ],
      metadata: {
        product_type: "job_boost",
        employer_user_id: user.id,
        employer_profile_id: employerProfile.id,
        job_id: job.id,
        boost_duration_days: String(durationDays),
        boost_budget_cents: String(budgetCents),
        boost_currency: "cad"
      },
      payment_intent_data: {
        metadata: {
          product_type: "job_boost",
          employer_user_id: user.id,
          employer_profile_id: employerProfile.id,
          job_id: job.id,
          boost_duration_days: String(durationDays),
          boost_budget_cents: String(budgetCents),
          boost_currency: "cad"
        }
      }
    });

    const { error: insertError } = await admin
      .from("job_boosts")
      .insert({
        job_id: job.id,
        employer_id: user.id,
        status: "pending",
        budget_cents: budgetCents,
        currency: "cad",
        duration_days: durationDays,
        stripe_checkout_session_id: session.id
      });

    if (insertError) throw insertError;

    return json({ url: session.url }, 200, corsHeaders);
  } catch (error) {
    console.error("Job boost checkout creation failed:", getSafeError(error));
    return json({ error: "Unable to start boost checkout." }, 500, corsHeaders);
  }
});

function getCheckoutLocation(req: Request, body: Record<string, unknown>) {
  const requestOrigin = req.headers.get("Origin") || "";
  let requestedOrigin = requestOrigin;
  let appPath = "";

  if (typeof body?.origin === "string") requestedOrigin = body.origin;
  if (typeof body?.appPath === "string") appPath = body.appPath;

  if (!allowedOrigins.has(requestedOrigin)) {
    throw new Error("Checkout origin is not allowed.");
  }

  if (appPath !== "" && appPath !== "/Placely") {
    throw new Error("Checkout app path is not allowed.");
  }

  if (requestedOrigin === "https://zahhop.github.io") {
    appPath = "/Placely";
  }

  return { origin: requestedOrigin, appPath };
}

function isEmployerOnboardingComplete(profile: Record<string, unknown>) {
  const hasHiringNeeds = hasValue(profile.hiring_needs) || parseHiringRoles(profile.hiring_roles).length > 0 || hasValue(profile.hiring_role_other);
  const hasPayRange = hasValue(profile.pay_range) || hasStructuredCompensation(profile);
  const requiredFieldsComplete = [
    profile.company_location,
    profile.company_description,
    profile.main_hiring_industry,
    profile.employment_type,
    profile.hiring_timeline,
    profile.candidate_qualities
  ].every(hasValue) && hasHiringNeeds && hasPayRange;
  const hasExplicitCompletionFlag = Object.prototype.hasOwnProperty.call(profile, "onboarding_completed") ||
    Object.prototype.hasOwnProperty.call(profile, "onboarding_complete");

  if (!hasExplicitCompletionFlag) return requiredFieldsComplete;
  return requiredFieldsComplete && (profile.onboarding_completed === true || profile.onboarding_complete === true);
}

function hasStructuredCompensation(profile: Record<string, unknown>) {
  const type = String(profile.compensation_type || "").toLowerCase().trim();
  const min = Number(profile.compensation_min);
  const max = Number(profile.compensation_max);
  return ["hourly", "annual"].includes(type) && Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min;
}

function parseHiringRoles(value: unknown) {
  if (Array.isArray(value)) return value.map((role) => String(role || "").trim()).filter(Boolean);
  if (value && typeof value === "object") return Object.values(value).map((role) => String(role || "").trim()).filter(Boolean);
  const raw = String(value || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parseHiringRoles(parsed);
  } catch {}
  return raw.split(/[,;\n]/).map((role) => role.trim()).filter(Boolean);
}

function hasValue(value: unknown) {
  return String(value || "").trim().length > 0;
}

function isActiveJob(status: unknown) {
  return ["active", "published", "open"].includes(String(status || "active").toLowerCase().trim());
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };

  if (allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function isAllowedRequestOrigin(req: Request) {
  const origin = req.headers.get("Origin");
  return !origin || allowedOrigins.has(origin);
}

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json"
    }
  });
}

function getSafeError(error: unknown) {
  if (error && typeof error === "object") {
    return {
      message: "message" in error ? String(error.message || "") : "",
      code: "code" in error ? String(error.code || "") : ""
    };
  }

  return { message: String(error || ""), code: "" };
}
