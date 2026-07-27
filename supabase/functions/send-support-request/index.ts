import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://zahhop.github.io",
  "https://placelytalent.com",
  "https://www.placelytalent.com"
]);

const recipients = {
  candidate: "austint@placelytalent.com",
  employer: "kieranw@placelytalent.com"
};

const employerCategories = new Set([
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

const candidateCategories = new Set([
  "Account or login",
  "Job search",
  "Applications",
  "Saved jobs",
  "Messaging",
  "Profile or resume",
  "Employer contact",
  "Technical issue",
  "Feedback or feature request",
  "Other"
]);

const recentSubmissions = new Map<string, number>();
const cooldownMs = 60_000;

type AccountType = "candidate" | "employer";

type AuthResult = {
  accountType: AccountType;
  userId: string;
  userEmail: string;
  profile: Record<string, unknown>;
  status: number;
  error?: "";
} | {
  accountType?: "";
  userId?: "";
  userEmail?: "";
  profile?: null;
  status: number;
  error: string;
};

type VerifiedAccount = {
  accountType: AccountType;
  userId: string;
  userEmail: string;
  profile: Record<string, unknown>;
  status: number;
};

type SupportRequest = {
  category: string;
  subject: string;
  description: string;
  replyEmail: string;
  sourcePage: string;
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
    const authResult = await verifyAccount(authHeader, supabaseUrl, anonKey);

    if (!isVerifiedAccount(authResult)) {
      return json({ error: authResult.error || "Could not verify account." }, authResult.status || 401, corsHeaders);
    }

    console.info("support request: authentication validated", {
      userId: authResult.userId,
      accountType: authResult.accountType
    });

    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      console.warn("support request: invalid JSON body");
      return json({ error: "Support request form data is invalid." }, 400, corsHeaders);
    }

    const request = validateSupportRequest(body, authResult.accountType);
    const rateLimit = checkRateLimit(`${authResult.accountType}:${authResult.userId}`);
    if (rateLimit) {
      return json({ error: rateLimit }, 429, corsHeaders);
    }

    const submittedAt = new Date().toISOString();
    const recipient = recipients[authResult.accountType];
    const subject = buildEmailSubject(authResult.accountType, request.category, request.subject);
    const rows = buildEmailRows(authResult, request, submittedAt);

    console.info("support request: Resend invocation started", {
      userId: authResult.userId,
      accountType: authResult.accountType
    });

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [recipient],
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

    console.info("support request: success", {
      userId: authResult.userId,
      accountType: authResult.accountType
    });
    return json({ success: true }, 200, corsHeaders);
  } catch (error) {
    console.error("support request: failure", error instanceof Error ? error.message : "Unknown error");

    if (error instanceof Error && error.message.startsWith("VALIDATION:")) {
      return json({ error: error.message.replace("VALIDATION:", "") }, 400, corsHeaders);
    }

    return json({ error: "Support request could not be sent." }, 500, corsHeaders);
  }
});

async function verifyAccount(authHeader: string, supabaseUrl: string, anonKey: string): Promise<AuthResult> {
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

  if (userError || !user) {
    if (userError) logDbError("support request: authenticated user lookup failed", userError);
    return { error: "Your session has expired. Please log in again.", status: 401 };
  }

  if (!(user.email_confirmed_at || user.confirmed_at)) {
    return { error: "Please verify your email before contacting support.", status: 403 };
  }

  console.info("support request: authenticated user resolved", { userId: user.id });

  const { data: accountProfile, error: accountProfileError } = await userClient
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (accountProfileError) {
    logDbError("support request: role lookup query failed", accountProfileError);
    return { error: "Could not verify account type.", status: 500 };
  }

  if (!accountProfile) {
    console.warn("support request: role row missing", { userId: user.id });
    return { error: "Your account setup could not be verified. Please complete account setup or contact Placely.", status: 409 };
  }

  if (accountProfile.role === "candidate") {
    return verifyCandidateProfile(userClient, user.id, user.email || "");
  }

  if (accountProfile.role === "employer") {
    return verifyEmployerProfile(userClient, user.id, user.email || "");
  }

  console.warn("support request: role value unsupported", { userId: user.id, role: accountProfile.role || "" });
  return { error: "This support form is available to candidate and employer accounts.", status: 403 };
}

function isVerifiedAccount(result: AuthResult): result is VerifiedAccount {
  return Boolean(result.accountType && result.userId && result.userEmail !== undefined && !result.error);
}

async function verifyCandidateProfile(userClient: any, userId: string, userEmail: string): Promise<AuthResult> {
  const { data: profile, error: profileError } = await userClient
    .from("candidate_profiles")
    .select("id, full_name, email, trade, location, profile_visible")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    logDbError("support request: candidate profile query failed", profileError);
    return { error: "Could not verify candidate account.", status: 500 };
  }

  if (!profile) {
    console.warn("support request: candidate profile missing", { userId });
    return { error: "Your candidate profile could not be found. Please complete account setup or contact Placely.", status: 409 };
  }

  console.info("support request: candidate profile resolved", { userId, profileId: profile.id });
  return { accountType: "candidate", userId, userEmail, profile: profile as Record<string, unknown>, status: 200 };
}

async function verifyEmployerProfile(userClient: any, userId: string, userEmail: string): Promise<AuthResult> {
  const { data: profile, error: profileError } = await userClient
    .from("employer_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    logDbError("support request: employer profile query failed", profileError);
    return { error: "Could not verify employer account.", status: 500 };
  }

  if (!profile) {
    console.warn("support request: employer profile missing", { userId });
    return { error: "Your employer profile could not be found. Please complete account setup or contact Placely.", status: 409 };
  }

  if (!isEmployerOnboardingComplete(profile as Record<string, unknown>)) {
    console.warn("support request: employer profile incomplete", { userId });
    return { error: "Your employer profile could not be found. Please complete your profile and try again.", status: 409 };
  }

  console.info("support request: employer profile resolved", { userId, profileId: profile.id });
  return { accountType: "employer", userId, userEmail, profile: profile as Record<string, unknown>, status: 200 };
}

function validateSupportRequest(body: Record<string, unknown>, accountType: AccountType): SupportRequest {
  const category = sanitize(body?.category, 80);
  const subject = sanitize(body?.subject, 120);
  const description = sanitize(body?.description, 5000);
  const replyEmail = sanitize(body?.reply_email, 254);
  const sourcePage = sanitizeSourcePage(body?.source_page);
  const categorySet = accountType === "candidate" ? candidateCategories : employerCategories;

  if (!categorySet.has(category)) throw new Error("VALIDATION:Choose a support category.");
  if (subject.length < 5 || subject.length > 120) throw new Error("VALIDATION:Subject must be 5 to 120 characters.");
  if (description.length < 20 || description.length > 5000) throw new Error("VALIDATION:Description must be 20 to 5000 characters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail)) throw new Error("VALIDATION:Enter a valid reply email.");

  return { category, subject, description, replyEmail, sourcePage };
}

function buildEmailSubject(accountType: AccountType, category: string, subject: string) {
  if (accountType === "candidate") {
    return `[Placely Candidate Support] ${category} - ${subject}`;
  }

  return `[Placely Support] ${category} - ${subject}`;
}

function buildEmailRows(
  authResult: VerifiedAccount,
  request: SupportRequest,
  submittedAt: string
) {
  if (authResult.accountType === "candidate") {
    return [
      ["Portal", "candidate"],
      ["Candidate full name", sanitize(authResult.profile.full_name || "Candidate", 160)],
      ["Authenticated account email", authResult.userEmail],
      ["Reply email", request.replyEmail],
      ["Support category", request.category],
      ["Subject", request.subject],
      ["Description", request.description],
      ["Source page", request.sourcePage],
      ["Candidate user ID", authResult.userId],
      ["Submission timestamp", submittedAt]
    ];
  }

  const companyName = sanitize(authResult.profile.company_name || authResult.profile.company_email || "Employer", 160);

  return [
    ["Portal", "employer"],
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

function checkRateLimit(key = "") {
  const now = Date.now();
  const previous = recentSubmissions.get(key || "unknown") || 0;

  if (now - previous < cooldownMs) {
    return "Please wait before sending another support request.";
  }

  recentSubmissions.set(key || "unknown", now);
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
