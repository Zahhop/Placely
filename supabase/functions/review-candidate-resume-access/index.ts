import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://zahhop.github.io",
  "https://placelytalent.com",
  "https://www.placelytalent.com"
]);

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, corsHeaders);
  if (!isAllowedRequestOrigin(req)) return json({ error: "Origin is not allowed.", code: "ORIGIN_NOT_ALLOWED" }, 403, corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Resume review workflow is not configured.", code: "CONFIGURATION_ERROR" }, 500, corsHeaders);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: "Your session has expired. Please log in again.", code: "AUTHENTICATION_REQUIRED" }, 401, corsHeaders);

  const body = await req.json().catch(() => ({}));
  const requestId = sanitizeUuid(body.requestId || body.request_id);
  const action = String(body.action || "").toLowerCase().trim();
  if (!requestId || !["approve", "decline", "revoke"].includes(action)) {
    return json({ error: "A valid request and action are required.", code: "INVALID_REQUEST" }, 400, corsHeaders);
  }

  const { data: roleRow, error: roleError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (roleError) return json({ error: "Could not verify your account type.", code: "ROLE_LOOKUP_FAILED" }, 500, corsHeaders);
  if (String(roleRow?.role || "").toLowerCase() !== "candidate") {
    return json({ error: "Only the candidate can review this resume request.", code: "NOT_CANDIDATE" }, 403, corsHeaders);
  }

  const { data: requestRow, error: requestError } = await admin
    .from("candidate_resume_requests")
    .select("id, candidate_id, employer_id, status, responded_at")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError) return json({ error: "Could not load this resume request.", code: "REQUEST_LOOKUP_FAILED" }, 500, corsHeaders);
  if (!requestRow) return json({ error: "Resume request unavailable.", code: "REQUEST_NOT_FOUND" }, 404, corsHeaders);
  if (String(requestRow.candidate_id) !== String(user.id)) {
    return json({ error: "You cannot review this resume request.", code: "REQUEST_ACCESS_DENIED" }, 403, corsHeaders);
  }

  if (action === "revoke" && requestRow.status !== "approved") {
    return json({ error: "Only approved resume access can be revoked.", code: "INVALID_REQUEST_STATUS" }, 409, corsHeaders);
  }

  if (["approve", "decline"].includes(action) && requestRow.status !== "pending") {
    return json({ error: "This resume request has already been reviewed.", code: "INVALID_REQUEST_STATUS" }, 409, corsHeaders);
  }

  const nextStatus = action === "approve" ? "approved" : action === "revoke" ? "revoked" : "declined";
  const now = new Date().toISOString();
  const expiresAt = action === "approve" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null;
  const { data: updated, error: updateError } = await admin
    .from("candidate_resume_requests")
    .update({
      status: nextStatus,
      responded_at: action === "revoke" ? requestRow.responded_at || now : now,
      revoked_at: action === "revoke" ? now : null,
      expires_at: expiresAt,
      response_message: getResponseMessage(nextStatus),
      updated_at: now
    })
    .eq("id", requestId)
    .eq("candidate_id", user.id)
    .select("id, status, requested_at, responded_at, expires_at, revoked_at")
    .single();

  if (updateError) {
    console.error("resume request review failed", safeError(updateError));
    return json({ error: "Could not update this resume request.", code: "REQUEST_UPDATE_FAILED" }, 500, corsHeaders);
  }

  return json({
    success: true,
    request: {
      id: updated.id,
      status: updated.status,
      requested_at: updated.requested_at || null,
      responded_at: updated.responded_at || null,
      expires_at: updated.expires_at || null,
      revoked_at: updated.revoked_at || null
    }
  }, 200, corsHeaders);
});

function getResponseMessage(status: string) {
  if (status === "approved") return "Resume access approved by candidate.";
  if (status === "revoked") return "Resume access revoked by candidate.";
  return "Resume access declined by candidate.";
}

function sanitizeUuid(value: unknown) {
  const id = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : "";
}

function safeError(error: any) {
  return { code: error?.code, message: error?.message, details: error?.details, hint: error?.hint };
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
