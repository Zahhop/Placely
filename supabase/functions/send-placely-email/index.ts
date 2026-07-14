import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://zahhop.github.io"
]);

const supportTypes = new Set(["support", "contact", "candidate_support", "employer_support"]);
const publicTypes = new Set(["support", "contact", "candidate_support", "employer_support"]);
const recentSubmissions = new Map<string, number>();
const publicCooldownMs = 60_000;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405, corsHeaders);
  }

  const hiringEmail = Deno.env.get("PLACELY_HIRING_EMAIL");
  const supportEmail = Deno.env.get("PLACELY_SUPPORT_EMAIL");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("PLACELY_FROM_EMAIL");

  if (!hiringEmail || !supportEmail || !resendApiKey || !fromEmail) {
    return json({ error: "Email delivery is not configured." }, 500, corsHeaders);
  }

  try {
    const body = await req.json();
    const formType = sanitize(body?.form_type, 64);
    const payload = sanitizePayload(body?.payload);
    const submittedAt = new Date().toISOString();
    const authHeader = req.headers.get("Authorization") || "";

    if (formType === "hiring_request") {
      const authResult = await verifyEmployerAuth(authHeader);

      if (authResult.error) {
        return json({ error: authResult.error }, authResult.status || 401, corsHeaders);
      }

      payload.employer_account_id = authResult.userId || payload.employer_account_id;
    } else if (publicTypes.has(formType)) {
      const spamCheck = checkPublicSpam(req, body);
      if (spamCheck) {
        return json({ error: spamCheck }, 429, corsHeaders);
      }
    } else {
      return json({ error: "Unsupported form type." }, 400, corsHeaders);
    }

    const message = buildMessage(formType, payload, submittedAt, authHeader);
    const recipient = formType === "hiring_request" ? hiringEmail : supportEmail;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [recipient],
        subject: message.subject,
        text: message.text,
        html: message.html,
        reply_to: message.replyTo
      })
    });

    if (!resendResponse.ok) {
      const providerError = await resendResponse.text();
      console.error("Resend email failed:", providerError);
      return json({ error: "Email could not be sent." }, 502, corsHeaders);
    }

    return json({ success: true }, 200, corsHeaders);
  } catch (error) {
    console.error("Placely email function failed:", error);

    if (error instanceof Error && error.message.startsWith("Missing required fields:")) {
      return json({ error: error.message }, 400, corsHeaders);
    }

    return json({ error: "Email request failed." }, 500, corsHeaders);
  }
});

async function verifyEmployerAuth(authHeader: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return { error: "Supabase email environment is not configured.", status: 500 };
  }

  if (!authHeader) {
    return { error: "You must be logged in to submit a hiring request.", status: 401 };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });

  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return { error: "You must be logged in to submit a hiring request.", status: 401 };
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: employerProfile, error: profileError } = await admin
    .from("employer_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Employer auth profile check failed:", profileError);
    return { error: "Could not verify employer account.", status: 500 };
  }

  if (!employerProfile) {
    return { error: "Employer account not found.", status: 403 };
  }

  return { userId: user.id, status: 200 };
}

function buildMessage(formType: string, payload: Record<string, string>, submittedAt: string, authHeader: string) {
  if (formType === "hiring_request") {
    requireFields(payload, ["company_name", "contact_name", "contact_email", "role_needed"]);

    const subject = `New Recruiting Consultation Request — ${payload.company_name}`;
    const rows = [
      ["Company name", payload.company_name],
      ["Contact name", payload.contact_name],
      ["Contact email", payload.contact_email],
      ["Phone", payload.phone_number],
      ["Role or worker type needed", payload.role_needed],
      ["Number of workers", payload.number_of_hires],
      ["Location", payload.location],
      ["Employment type", payload.employment_type],
      ["Pay range", payload.pay_range],
      ["Desired timeline", payload.hiring_timeline],
      ["Required experience or certifications", payload.required_experience],
      ["Additional details", payload.additional_details],
      ["Employer account ID", payload.employer_account_id],
      ["Submission date", submittedAt]
    ];

    return {
      subject,
      text: rowsToText(rows),
      html: rowsToHtml(rows),
      replyTo: normalizeReplyTo(payload.contact_email)
    };
  }

  if (supportTypes.has(formType)) {
    requireFields(payload, ["name", "contact_email", "message"]);

    const subjectName = payload.company || payload.name;
    const subject = `Placely Support Request — ${subjectName}`;
    const rows = [
      ["Name", payload.name],
      ["Company", payload.company],
      ["Account type", payload.account_type],
      ["Contact email", payload.contact_email],
      ["Subject/category", payload.subject_category],
      ["Message", payload.message],
      ["Authenticated account ID", payload.authenticated_account_id],
      ["Current page", payload.current_page],
      ["Date submitted", submittedAt],
      ["Form type", formType],
      ["Authenticated", authHeader ? "Yes" : "No"]
    ];

    return {
      subject,
      text: rowsToText(rows),
      html: rowsToHtml(rows),
      replyTo: normalizeReplyTo(payload.contact_email)
    };
  }

  throw new Error("Unsupported form type.");
}

function requireFields(payload: Record<string, string>, fields: string[]) {
  const missing = fields.filter((field) => !payload[field]);

  if (missing.length) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }
}

function sanitizePayload(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const output: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(source)) {
    const safeKey = sanitize(key, 80).replace(/[^a-zA-Z0-9_]/g, "");

    if (!safeKey) continue;

    output[safeKey] = sanitize(rawValue, safeKey === "message" || safeKey === "additional_details" ? 4000 : 500);
  }

  return output;
}

function sanitize(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLength);
}

function normalizeReplyTo(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function checkPublicSpam(req: Request, body: Record<string, unknown>) {
  if (sanitize(body?.company_website, 200)) {
    return "Submission was blocked.";
  }

  const key = `${req.headers.get("x-forwarded-for") || "unknown"}:${sanitize(body?.form_type, 64)}`;
  const now = Date.now();
  const previous = recentSubmissions.get(key) || 0;

  if (now - previous < publicCooldownMs) {
    return "Please wait before submitting again.";
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

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers
  });
}
