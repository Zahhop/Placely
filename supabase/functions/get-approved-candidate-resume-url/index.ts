import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESUME_BUCKET = "candidate_resumes";
const SIGNED_URL_SECONDS = 10 * 60;
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
    return json({ error: "Resume access is not configured.", code: "CONFIGURATION_ERROR" }, 500, corsHeaders);
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

  const { data: requestRows, error: requestError } = await admin
    .from("candidate_resume_access_requests")
    .select("id")
    .eq("employer_id", user.id)
    .eq("candidate_id", candidateId)
    .eq("status", "approved")
    .limit(1);
  if (requestError) return json({ error: "Could not verify resume access.", code: "REQUEST_LOOKUP_FAILED" }, 500, corsHeaders);
  if (!requestRows?.length) return json({ error: "Resume access has not been approved.", code: "RESUME_ACCESS_NOT_APPROVED" }, 403, corsHeaders);

  const { data: candidate, error: candidateError } = await admin
    .from("candidate_profiles")
    .select("id, resume_path, resume_url")
    .eq("id", candidateId)
    .maybeSingle();
  if (candidateError) return json({ error: "Could not load this resume.", code: "CANDIDATE_PROFILE_LOOKUP_FAILED" }, 500, corsHeaders);

  const resumePath = getResumePath(candidate || {});
  if (!candidate || !resumePath || !resumePathBelongsToCandidate(resumePath, candidateId)) {
    return json({ error: "Resume not found.", code: "RESUME_NOT_FOUND" }, 404, corsHeaders);
  }

  const { data, error } = await admin.storage.from(RESUME_BUCKET).createSignedUrl(resumePath, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    console.error("approved resume signed URL failed", safeError(error));
    return json({ error: "Resume could not be opened.", code: "SIGNED_URL_FAILED" }, 500, corsHeaders);
  }

  return json({ url: data.signedUrl, expires_in: SIGNED_URL_SECONDS }, 200, corsHeaders);
});

function getResumePath(profile: { resume_path?: string | null; resume_url?: string | null }) {
  if (profile.resume_path) return String(profile.resume_path);
  return getResumePathFromLegacyUrl(profile.resume_url || "");
}

function getResumePathFromLegacyUrl(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+/, "");
  try {
    const url = new URL(raw);
    const marker = "/candidate_resumes/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex === -1) return "";
    return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
  } catch {
    return "";
  }
}

function resumePathBelongsToCandidate(path: string, candidateId: string) {
  return path.split("/")[0] === candidateId;
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
