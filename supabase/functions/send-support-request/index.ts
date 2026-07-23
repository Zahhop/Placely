import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://zahhop.github.io"
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
    return new Response("ok", { headers: corsHeaders });
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
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!resendApiKey || !fromEmail || !supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Support email is not configured." }, 500, corsHeaders);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const authResult = await verifyEmployer(authHeader, supabaseUrl, anonKey, serviceRoleKey);

    if (authResult.error) {
      return json({ error: authResult.error }, authResult.status || 401, corsHeaders);
    }

    console.info("support request: authentication validated");

    const rateLimit = checkRateLimit(authResult.userId);
    if (rateLimit) {
      return json({ error: rateLimit }, 429, corsHeaders);
    }

    const body = await req.json() as Record<string, unknown>;
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
      return json({ error: "Support request could not be sent." }, 502, corsHeaders);
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

async function verifyEmployer(authHeader: string, supabaseUrl: string, anonKey: string, serviceRoleKey: string): Promise<EmployerAuthResult> {
  if (!authHeader) {
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
    return { error: "We could not verify your employer account.", status: 401 };
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile, error: profileError } = await admin
    .from("employer_profiles")
    .select("id, company_name, company_email, onboarding_completed")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("support request: employer profile check failed");
    return { error: "Could not verify employer account.", status: 500 };
  }

  if (!profile) {
    return { error: "Employer account not found.", status: 403 };
  }

  return { userId: user.id, userEmail: user.email || "", profile, status: 200 };
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
  const allowedOrigin = allowedOrigins.has(origin) ? origin : "https://zahhop.github.io";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
}

function isAllowedRequestOrigin(req: Request) {
  const origin = req.headers.get("Origin");
  return !origin || allowedOrigins.has(origin);
}

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}
