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
    return json({ error: "Resume request workflow is not configured.", code: "CONFIGURATION_ERROR" }, 500, corsHeaders);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: "Your session has expired. Please log in again.", code: "AUTHENTICATION_REQUIRED" }, 401, corsHeaders);

  const body = await req.json().catch(() => ({}));
  const candidateId = sanitizeUuid(body.candidateId || body.candidate_id);
  if (!candidateId) return json({ error: "Candidate ID is required.", code: "INVALID_CANDIDATE" }, 400, corsHeaders);

  const { data: roleRow, error: roleError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (roleError) return json({ error: "Could not verify your account type.", code: "ROLE_LOOKUP_FAILED" }, 500, corsHeaders);
  if (String(roleRow?.role || "").toLowerCase() !== "employer") {
    return json({ error: "Only employers can request candidate resumes.", code: "NOT_EMPLOYER" }, 403, corsHeaders);
  }

  const { data: employer, error: employerError } = await admin
    .from("employer_profiles")
    .select("id, company_name, candidate_access, subscription_status")
    .eq("id", user.id)
    .maybeSingle();
  if (employerError) return json({ error: "We could not load your employer account.", code: "EMPLOYER_PROFILE_LOOKUP_FAILED" }, 500, corsHeaders);
  if (!employer) return json({ error: "We could not load your employer account.", code: "EMPLOYER_PROFILE_NOT_FOUND" }, 403, corsHeaders);
  if (!isCandidateAccessActive(employer)) return json({ error: "Candidate Access is required.", code: "CANDIDATE_ACCESS_REQUIRED" }, 403, corsHeaders);

  const { data: candidate, error: candidateError } = await admin
    .from("candidate_profiles")
    .select("id, full_name, resume_path, resume_url, profile_visible")
    .eq("id", candidateId)
    .maybeSingle();
  if (candidateError) return json({ error: "We could not load this candidate profile.", code: "CANDIDATE_PROFILE_LOOKUP_FAILED" }, 500, corsHeaders);
  if (!candidate) return json({ error: "Candidate profile unavailable.", code: "INVALID_CANDIDATE" }, 404, corsHeaders);
  if (candidate.profile_visible === false) return json({ error: "This candidate is no longer visible to employers.", code: "CANDIDATE_NOT_VISIBLE" }, 403, corsHeaders);
  if (!text(candidate.resume_path || candidate.resume_url)) return json({ error: "This candidate has not uploaded a resume.", code: "RESUME_NOT_AVAILABLE" }, 404, corsHeaders);

  const existing = await loadLatestRequest(admin, user.id, candidateId);
  if (existing && ["pending", "approved"].includes(existing.status)) {
    return json({ success: true, request: publicRequest(existing) }, 200, corsHeaders);
  }

  const conversation = await findOrCreateConversation(admin, {
    employerId: user.id,
    employerName: text(employer.company_name) || "Employer",
    candidateId,
    candidateName: text(candidate.full_name) || "Candidate"
  });

  const { data: requestRow, error: insertError } = await admin
    .from("candidate_resume_access_requests")
    .insert({
      employer_id: user.id,
      candidate_id: candidateId,
      status: "pending",
      conversation_id: conversation?.id || null,
      request_message: `${text(employer.company_name) || "An employer"} requested access to this candidate's resume.`
    })
    .select("id, status, requested_at, responded_at, conversation_id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const pending = await loadLatestRequest(admin, user.id, candidateId);
      if (pending) return json({ success: true, request: publicRequest(pending) }, 200, corsHeaders);
    }
    console.error("resume access request insert failed", safeError(insertError));
    return json({ error: "We could not request resume access.", code: "REQUEST_CREATE_FAILED" }, 500, corsHeaders);
  }

  const message = await insertMessage(admin, {
    conversationId: conversation?.id || requestRow.conversation_id || null,
    employerId: user.id,
    candidateId,
    candidateName: text(candidate.full_name) || "Candidate",
    message: `${text(employer.company_name) || "An employer"} requested access to review your resume. Open Messages to approve or decline this request.`
  });

  if (message?.id) {
    await admin.from("candidate_resume_access_requests").update({ message_id: message.id }).eq("id", requestRow.id);
  }

  return json({ success: true, request: publicRequest(requestRow) }, 200, corsHeaders);
});

async function loadLatestRequest(admin: any, employerId: string, candidateId: string) {
  const { data, error } = await admin
    .from("candidate_resume_access_requests")
    .select("id, status, requested_at, responded_at, conversation_id")
    .eq("employer_id", employerId)
    .eq("candidate_id", candidateId)
    .order("requested_at", { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0] || null;
}

async function findOrCreateConversation(admin: any, details: Record<string, string>) {
  const { data: existing } = await admin
    .from("conversations")
    .select("*")
    .eq("employer_id", details.employerId)
    .eq("candidate_id", details.candidateId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (existing?.[0]) return existing[0];

  const payload = {
    employer_id: details.employerId,
    employer_name: details.employerName,
    candidate_id: details.candidateId,
    candidate_name: details.candidateName,
    candidate_initials: getInitials(details.candidateName),
    source: "Resume Request",
    status: "Active",
    response: "New"
  };
  const result = await insertWithSchemaFallback(admin, "conversations", payload);
  return result.data || null;
}

async function insertMessage(admin: any, details: Record<string, string | null>) {
  if (!details.conversationId) return null;
  const payload = {
    conversation_id: details.conversationId,
    sender_type: "employer",
    message: details.message,
    employer_id: details.employerId,
    candidate_id: details.candidateId,
    candidate_name: details.candidateName,
    read_by_employer: true,
    read_by_candidate: false
  };
  const result = await insertWithSchemaFallback(admin, "messages", payload);
  return result.data || null;
}

async function insertWithSchemaFallback(admin: any, table: string, payload: Record<string, unknown>) {
  let candidatePayload = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await admin.from(table).insert([candidatePayload]).select().single();
    if (!error) return { data, error: null };
    const missingColumn = getMissingColumn(error);
    if (!missingColumn || !(missingColumn in candidatePayload)) return { data: null, error };
    delete candidatePayload[missingColumn];
  }
  return { data: null, error: new Error(`Could not insert ${table}.`) };
}

function getMissingColumn(error: any) {
  const message = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
  const match = message.match(/'([^']+)' column|column '([^']+)'|Could not find the '([^']+)'/i);
  return match?.[1] || match?.[2] || match?.[3] || "";
}

function isCandidateAccessActive(profile: Record<string, unknown>) {
  const status = String(profile.subscription_status || "").toLowerCase().trim();
  return profile.candidate_access === true && (!status || ["active", "trialing"].includes(status));
}

function publicRequest(request: any) {
  return {
    id: request.id,
    status: request.status,
    requested_at: request.requested_at || null,
    responded_at: request.responded_at || null
  };
}

function getInitials(name: string) {
  return String(name || "PT").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "PT";
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function sanitizeUuid(value: unknown) {
  const id = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(id) ? id : "";
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
