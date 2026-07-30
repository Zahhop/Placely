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
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED", message: "Method not allowed." }, 405, corsHeaders);
  if (!isAllowedRequestOrigin(req)) return json({ code: "ORIGIN_NOT_ALLOWED", message: "Origin is not allowed." }, 403, corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ code: "CONFIGURATION_ERROR", message: "Resume request workflow is not configured." }, 500, corsHeaders);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userError || !user) {
    return json({ code: "AUTHENTICATION_REQUIRED", message: "Your session has expired. Please log in again." }, 401, corsHeaders);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ code: "INVALID_JSON", message: "Invalid request body." }, 400, corsHeaders);
  }

  const candidateId = typeof body.candidate_id === "string" ? body.candidate_id.trim() : "";
  console.log("Resume request candidate input", {
    candidateId,
    length: candidateId.length,
    validUuid: isValidUuid(candidateId),
    bodyKeys: Object.keys(body)
  });

  if (!candidateId) {
    console.error("Resume request missing candidate_id", {
      bodyKeys: body && typeof body === "object" ? Object.keys(body) : []
    });
    return json({ code: "CANDIDATE_ID_REQUIRED", message: "Candidate ID is required." }, 400, corsHeaders);
  }

  if (!isValidUuid(candidateId)) {
    console.error("Candidate UUID validation failed", {
      candidateId,
      length: candidateId.length,
      type: typeof candidateId
    });
    return json({ code: "CANDIDATE_ID_INVALID", message: "Candidate ID is invalid." }, 400, corsHeaders);
  }

  const jobId = typeof body?.job_id === "string" && isValidUuid(body.job_id.trim()) ? body.job_id.trim() : null;
  const requestMessage = sanitizeText(body?.request_message, 1000);

  const { data: roleRow, error: roleError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (roleError) return json({ code: "ROLE_LOOKUP_FAILED", message: "Could not verify your account type." }, 500, corsHeaders);
  if (String(roleRow?.role || "").toLowerCase() !== "employer") {
    return json({ code: "NOT_EMPLOYER", message: "Only employers can request candidate resumes." }, 403, corsHeaders);
  }

  const { data: employer, error: employerError } = await admin
    .from("employer_profiles")
    .select("id, company_name, candidate_access, subscription_status")
    .eq("id", user.id)
    .maybeSingle();
  if (employerError) return json({ code: "EMPLOYER_PROFILE_LOOKUP_FAILED", message: "We could not load your employer account." }, 500, corsHeaders);
  if (!employer) return json({ code: "EMPLOYER_PROFILE_NOT_FOUND", message: "We could not load your employer account." }, 403, corsHeaders);
  if (!isCandidateAccessActive(employer)) return json({ code: "CANDIDATE_ACCESS_REQUIRED", message: "Candidate Access is required." }, 403, corsHeaders);

  const { data: candidate, error: candidateError } = await admin
    .from("candidate_profiles")
    .select("id, full_name, resume_path, resume_url, profile_visible")
    .eq("id", candidateId)
    .maybeSingle();
  if (candidateError) {
    console.error("Candidate lookup failed", {
      code: candidateError.code,
      message: candidateError.message
    });
    return json({ code: "CANDIDATE_LOOKUP_FAILED", message: "We could not load this candidate." }, 500, corsHeaders);
  }
  if (!candidate) return json({ code: "CANDIDATE_NOT_FOUND", message: "Candidate profile was not found." }, 404, corsHeaders);
  if (candidate.profile_visible === false) return json({ code: "CANDIDATE_NOT_VISIBLE", message: "This candidate is no longer visible to employers." }, 403, corsHeaders);
  if (!text(candidate.resume_path || candidate.resume_url)) return json({ code: "RESUME_NOT_AVAILABLE", message: "This candidate has not uploaded a resume." }, 404, corsHeaders);

  const existing = await loadLatestRequest(admin, user.id, candidateId);
  if (existing && isActiveResumeRequest(existing)) {
    return json({ success: true, request: publicRequest(existing) }, 200, corsHeaders);
  }

  const { data: requestRow, error: insertError } = await admin
    .from("candidate_resume_requests")
    .insert({
      employer_id: user.id,
      candidate_id: candidateId,
      job_id: jobId,
      status: "pending",
      request_message: requestMessage || `${text(employer.company_name) || "An employer"} requested access to this candidate's resume.`
    })
    .select("id, status, requested_at, responded_at, expires_at, revoked_at")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const pending = await loadLatestRequest(admin, user.id, candidateId);
      if (pending) return json({ success: true, request: publicRequest(pending) }, 200, corsHeaders);
    }
    console.error("resume request insert failed", safeError(insertError));
    return json({ code: "REQUEST_CREATE_FAILED", message: "We could not request resume access." }, 500, corsHeaders);
  }

  return json({ success: true, request: publicRequest(requestRow) }, 200, corsHeaders);
});

async function loadLatestRequest(admin: any, employerId: string, candidateId: string) {
  const { data, error } = await admin
    .from("candidate_resume_requests")
    .select("id, status, requested_at, responded_at, expires_at, revoked_at")
    .eq("employer_id", employerId)
    .eq("candidate_id", candidateId)
    .order("requested_at", { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0] || null;
}

function isCandidateAccessActive(profile: Record<string, unknown>) {
  const status = String(profile.subscription_status || "").toLowerCase().trim();
  return profile.candidate_access === true && (!status || ["active", "trialing"].includes(status));
}

function publicRequest(request: any) {
  return {
    id: request.id,
    status: normalizeRequestStatus(request),
    requested_at: request.requested_at || null,
    responded_at: request.responded_at || null,
    expires_at: request.expires_at || null,
    revoked_at: request.revoked_at || null
  };
}

function isActiveResumeRequest(request: any) {
  const status = normalizeRequestStatus(request);
  return status === "pending" || status === "approved";
}

function normalizeRequestStatus(request: any) {
  const status = String(request?.status || "").toLowerCase().trim();
  if (status === "approved") {
    if (request?.revoked_at) return "revoked";
    if (request?.expires_at && new Date(request.expires_at).getTime() <= Date.now()) return "expired";
  }
  return ["pending", "approved", "declined", "revoked", "expired"].includes(status) ? status : "";
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function sanitizeText(value: unknown, maxLength: number) {
  return text(value)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[<>]/g, "")
    .slice(0, maxLength);
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
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
  const normalizedBody = {
    ...body,
    error: body.error || body.message || ""
  };
  return new Response(JSON.stringify(normalizedBody), {
    status,
    headers: { ...headers, "Content-Type": "application/json" }
  });
}
