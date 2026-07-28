import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://zahhop.github.io",
  "https://placelytalent.com",
  "https://www.placelytalent.com"
]);

const recipient = "austint@placelytalent.com";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, corsHeaders);
  if (!isAllowedRequestOrigin(req)) return json({ error: "Origin is not allowed." }, 403, corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("PLACELY_FROM_EMAIL") || "Placely Talent <hello@placelytalent.com>";

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !resendApiKey) {
    return json({ error: "Verification request workflow is not configured." }, 500, corsHeaders);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: "Your session has expired. Please log in again." }, 401, corsHeaders);
  if (!user.email_confirmed_at) return json({ error: "Please verify your email before requesting verification." }, 403, corsHeaders);

  const { data: roleRow, error: roleError } = await userClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (roleError) return json({ error: "Could not verify your account type." }, 500, corsHeaders);
  if (roleRow?.role !== "candidate") return json({ error: "Only candidates can request candidate verification." }, 403, corsHeaders);

  const { data: profile, error: profileError } = await userClient
    .from("candidate_profiles")
    .select("id, full_name, email, phone, trade, location, availability, verification_status")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile) return json({ error: "Your candidate profile could not be loaded." }, 409, corsHeaders);
  if (profile.verification_status === "verified") return json({ error: "Your profile is already verified." }, 409, corsHeaders);
  if (profile.verification_status === "pending") return json({ error: "Your verification request is already pending." }, 409, corsHeaders);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const requestMessage = sanitize(body.request_message, 1200);
  const now = new Date().toISOString();

  const { data: requestRow, error: insertError } = await adminClient
    .from("candidate_verification_requests")
    .insert({
      candidate_id: user.id,
      status: "pending",
      request_message: requestMessage || null,
      requested_at: now
    })
    .select("id, requested_at")
    .single();

  if (insertError) {
    if (insertError.code === "23505") return json({ error: "Your verification request is already pending." }, 409, corsHeaders);
    console.error("candidate verification request insert failed", safeError(insertError));
    return json({ error: "Could not create your verification request." }, 500, corsHeaders);
  }

  const { error: updateError } = await adminClient
    .from("candidate_profiles")
    .update({
      verification_status: "pending",
      verification_requested_at: requestRow.requested_at || now,
      verified_at: null,
      verified_by: null
    })
    .eq("id", user.id);

  if (updateError) {
    console.error("candidate verification profile update failed", safeError(updateError));
    return json({ error: "Could not update your verification status." }, 500, corsHeaders);
  }

  const rows = [
    ["Candidate name", sanitize(profile.full_name || "Candidate", 160)],
    ["Account email", user.email || profile.email || ""],
    ["Phone", sanitize(profile.phone || "", 80)],
    ["Trade/current role", sanitize(profile.trade || "", 160)],
    ["Location", sanitize(profile.location || "", 160)],
    ["Availability", sanitize(profile.availability || "", 160)],
    ["Optional message", requestMessage],
    ["Candidate profile ID", user.id],
    ["Request ID", requestRow.id],
    ["Requested timestamp", requestRow.requested_at || now]
  ];

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [recipient],
      subject: `[Placely Verification Request] ${sanitize(profile.full_name || "Candidate", 120)}`,
      text: rows.map(([label, value]) => `${label}: ${value || "Not provided"}`).join("\n"),
      html: `<div>${rows.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value || "Not provided")}</p>`).join("")}</div>`
    })
  });

  if (!emailResponse.ok) {
    console.error("candidate verification email failed", { status: emailResponse.status });
    return json({ error: "Verification request was saved, but email notification could not be sent." }, 500, corsHeaders);
  }

  return json({
    success: true,
    request: {
      id: requestRow.id,
      status: "pending",
      requested_at: requestRow.requested_at
    }
  }, 200, corsHeaders);
});

function sanitize(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLength);
}

function safeError(error: any) {
  return { code: error?.code, message: error?.message, details: error?.details, hint: error?.hint };
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
    headers: { ...headers, "Content-Type": "application/json" }
  });
}
