import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://zahhop.github.io",
  "https://placelytalent.com",
  "https://www.placelytalent.com"
]);

const supportRecipient = "kieranw@placelytalent.com";
const categories = new Set([
  "Account or login",
  "Billing or Candidate Access",
  "Job posting",
  "Candidates or saved talent",
  "Applications",
  "Messaging",
  "Company profile",
  "Technical issue",
  "Feedback or feature request",
  "Other"
]);

const recentSubmissions = new Map<string, number>();
const cooldownMs = 60_000;

type EmployerAuthResult = {
  userId: string;
  userEmail: string;
  profile: {
    id: string;
    company_name?: string | null;
    company_email?: string | null;
    onboarding_completed?: boolean | null;
    onboarding_complete?: boolean | null;
    company_location?: string | null;
    company_description?: string | null;
    main_hiring_industry?: string | null;
    employment_type?: string | null;
    hiring_needs?: string | null;
    hiring_roles?: unknown;
    hiring_role_other?: string | null;
    pay_range?: string | null;
    compensation_type?: string | null;
    compensation_min?: number | string | null;
    compensation_max?: number | string | null;
    hiring_timeline?: string | null;
    candidate_qualities?: string | null;
  };
  status: number;
  error?: "";
} | {
  userId?: "";
  userEmail?: "";
  profile?: null;
  status: number;
  error: string;
};

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405, corsHeaders);
  }

  if (!isAllowedRequestOrigin(req)) {
    return json({ error: "Origin is not allowed." }, 403, corsHeaders);
  }

  if (Number(req.headers.get("content-length") || 0) > 20_000) {
    return json({ error: "Support request is too large." }, 413, corsHeaders);
  }

  console.info("support request: invocation started");

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("PLACELY_FROM_EMAIL") || "Placely Support <hello@placelytalent.com>";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!resendApiKey || !fromEmail || !supabaseUrl || !anonKey) {
    return json({ error: "Support email is not configured." }, 500, corsHeaders);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const authResult = await verifyEmployer(authHeader, supabaseUrl, anonKey);

    if (authResult.error) {
      return json({ error: authResult.error }, authResult.status || 401, corsHeaders);
    }

    console.info("support request: authentication validated");

    const rateLimit = checkRateLimit(authResult.userId);
    if (rateLimit) {
      return json({ error: rateLimit }, 429, corsHeaders);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      console.warn("support request: invalid JSON body");
      return json({ error: "Support request form data is invalid." }, 400, corsHeaders);
    }

    const request = validateSupportRequest(body);
    const submittedAt = new Date().toISOString();
    const companyName = sanitize(authResult.profile?.company_name || authResult.profile?.company_email || "Employer", 160);
    const subject = `[Placely Support] ${request.category} — ${request.subject}`;
    const rows = [
      ["Employer company name", companyName],
      ["Authenticated user email", authResult.userEmail],
      ["Reply email", request.replyEmail],
      ["Support category", request.category],
      ["Subject", request.subject],
      ["Description", request.description],
      ["Current/source page", request.sourcePage],
      ["Employer user ID", authResult.userId],
      ["Submission timestamp", submittedAt]
    ];

    console.info("support request: Resend invocation started");

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [supportRecipient],
        subject,
        text: rowsToText(rows),
        html: rowsToHtml(rows),
        reply_to: request.replyEmail
      })
    });

    console.info("support request: email provider response status", resendResponse.status);

    if (!resendResponse.ok) {
      console.error("support request: email provider failed");
      return json({ error: "Support request could not be sent." }, 500, corsHeaders);
    }

    console.info("support request: success");
    return json({ success: true }, 200, corsHeaders);
  } catch (error) {
    console.error("support request: failure", error instanceof Error ? error.message : "Unknown error");

    if (error instanceof Error && error.message.startsWith("VALIDATION:")) {
      return json({ error: error.message.replace("VALIDATION:", "") }, 400, corsHeaders);
    }

    return json({ error: "Support request could not be sent." }, 500, corsHeaders);
  }
});

async function verifyEmployer(authHeader: string, supabaseUrl: string, anonKey: string): Promise<EmployerAuthResult> {
  console.info("support request: authorization header present", Boolean(authHeader));

  if (!authHeader || !/^Bearer\s+\S+$/i.test(authHeader)) {
    return { error: "You must be logged in to submit support requests.", status: 401 };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });

  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser();

  if (userError || !user || !(user.email_confirmed_at || user.confirmed_at)) {
    if (userError) logDbError("support request: authenticated user lookup failed", userError);
    return { error: "We could not verify your employer account.", status: 401 };
  }

  console.info("support request: authenticated user resolved", { userId: user.id });

  const { data: accountProfile, error: accountProfileError } = await userClient
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (accountProfileError) {
    logDbError("support request: role lookup query failed", accountProfileError);
    return { error: "Could not verify employer account.", status: 500 };
  }

  if (!accountProfile) {
    console.warn("support request: role row missing", { userId: user.id });
    return { error: "Your account setup could not be verified. Please complete account setup or contact Placely.", status: 409 };
  }

  if (accountProfile.role !== "employer") {
    console.warn("support request: role value mismatch", { userId: user.id, role: accountProfile.role || "" });
    return { error: "This support form is available to employer accounts.", status: 403 };
  }

  const { data: profile, error: profileError } = await userClient
    .from("employer_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    logDbError("support request: employer profile query failed", profileError);
    return { error: "Could not verify employer account.", status: 500 };
  }

  if (!profile) {
    console.warn("support request: employer profile missing", { userId: user.id });
    return { error: "Your employer profile could not be found. Please complete account setup or contact Placely.", status: 409 };
  }

  if (!isEmployerOnboardingComplete(profile as Record<string, unknown>)) {
    console.warn("support request: employer profile incomplete", { userId: user.id });
    return { error: "Your employer profile could not be found. Please complete your profile and try again.", status: 409 };
  }

  console.info("support request: employer profile resolved", { userId: user.id, profileId: profile.id });

  return { userId: user.id, userEmail: user.email || "", profile, status: 200 };
}

function logDbError(message: string, error: unknown) {
  const safeError = error && typeof error === "object"
    ? {
      code: "code" in error ? String(error.code || "") : "",
      message: "message" in error ? String(error.message || "") : "",
      details: "details" in error ? String(error.details || "") : ""
    }
    : { code: "", message: String(error || ""), details: "" };

  console.error(message, safeError);
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

  return ["hourly", "annual"].includes(type) &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    min > 0 &&
    max >= min;
}

function parseHiringRoles(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((role) => String(role || "").trim()).filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.values(value).map((role) => String(role || "").trim()).filter(Boolean);
  }

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

function validateSupportRequest(body: Record<string, unknown>) {
  const category = sanitize(body?.category, 80);
  const subject = sanitize(body?.subject, 120);
  const description = sanitize(body?.description, 5000);
  const replyEmail = sanitize(body?.reply_email, 254);
  const sourcePage = sanitizeSourcePage(body?.source_page);

  if (!categories.has(category)) throw new Error("VALIDATION:Choose a support category.");
  if (subject.length < 5 || subject.length > 120) throw new Error("VALIDATION:Subject must be 5 to 120 characters.");
  if (description.length < 20 || description.length > 5000) throw new Error("VALIDATION:Description must be 20 to 5000 characters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail)) throw new Error("VALIDATION:Enter a valid reply email.");

  return { category, subject, description, replyEmail, sourcePage };
}

function sanitize(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLength);
}

function sanitizeSourcePage(value: unknown) {
  const raw = sanitize(value, 500);
  if (!raw) return "";

  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return raw.split("?")[0].split("#")[0].slice(0, 500);
  }
}

function checkRateLimit(userId = "") {
  const now = Date.now();
  const key = userId || "unknown";
  const previous = recentSubmissions.get(key) || 0;

  if (now - previous < cooldownMs) {
    return "Please wait before sending another support request.";
  }

  recentSubmissions.set(key, now);
  return "";
}

function rowsToText(rows: string[][]) {
  return rows.map(([label, value]) => `${label}: ${value || "Not provided"}`).join("\n");
}

function rowsToHtml(rows: string[][]) {
  const items = rows
    .map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value || "Not provided")}</p>`)
    .join("");

  return `<div>${items}</div>`;
}

function escapeHtml(value: string) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };

  if (allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

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
