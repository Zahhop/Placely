import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESUME_BUCKET = "candidate_resumes";
const SIGNED_URL_SECONDS = 10 * 60;

const allowedOrigins = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://zahhop.github.io"
]);

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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization");

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authHeader) {
      return json({ error: "Resume access is not configured." }, 500, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const candidateId = String(body?.candidate_id || "").trim();

    if (!isUuid(candidateId)) {
      return json({ error: "Candidate id is required." }, 400, corsHeaders);
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
      return json({ error: "Unauthorized." }, 401, corsHeaders);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: employer, error: employerError } = await admin
      .from("employer_profiles")
      .select("id, candidate_access, subscription_status")
      .eq("id", user.id)
      .maybeSingle();

    if (employerError) throw employerError;

    const hasAccess = employer?.candidate_access === true &&
      ["active", "trialing"].includes(String(employer?.subscription_status || "free"));

    if (!hasAccess) {
      return json({ error: "Candidate Network access is required." }, 403, corsHeaders);
    }

    const { data: approvedRequests, error: requestError } = await admin
      .from("candidate_resume_access_requests")
      .select("id")
      .eq("employer_id", user.id)
      .eq("candidate_id", candidateId)
      .eq("status", "approved")
      .limit(1);

    if (requestError) {
      console.error("Resume approval lookup failed:", safeError(requestError));
      return json({ error: "Resume access could not be verified." }, 500, corsHeaders);
    }

    if (!approvedRequests?.length) {
      return json({ error: "Resume access has not been approved." }, 403, corsHeaders);
    }

    const { data: candidate, error: candidateError } = await admin
      .from("candidate_profiles")
      .select("id, resume_path, resume_url")
      .eq("id", candidateId)
      .maybeSingle();

    if (candidateError) throw candidateError;

    const resumePath = getResumePath(candidate || {});

    if (!candidate || !resumePath) {
      return json({ error: "Resume not found." }, 404, corsHeaders);
    }

    if (!resumePathBelongsToCandidate(resumePath, candidateId)) {
      console.warn("Resume path ownership mismatch:", { candidateId, resumePath });
      return json({ error: "Resume not found." }, 404, corsHeaders);
    }

    const { data, error } = await admin.storage
      .from(RESUME_BUCKET)
      .createSignedUrl(resumePath, SIGNED_URL_SECONDS);

    if (error || !data?.signedUrl) {
      console.error("Resume signed URL creation failed:", error);
      return json({ error: "Resume could not be opened." }, 500, corsHeaders);
    }

    return json({
      url: data.signedUrl,
      expires_in: SIGNED_URL_SECONDS
    }, 200, corsHeaders);
  } catch (error) {
    console.error("Candidate resume URL function failed:", error);
    return json({ error: "Resume could not be opened." }, 500, corsHeaders);
  }
});

function getResumePath(profile: { resume_path?: string | null; resume_url?: string | null }) {
  if (profile.resume_path) return String(profile.resume_path);
  return getResumePathFromLegacyUrl(profile.resume_url || "");
}

function getResumePathFromLegacyUrl(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (!/^https?:\/\//i.test(raw)) {
    return raw.replace(/^\/+/, "");
  }

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeError(error: any) {
  return { code: error?.code, message: error?.message, details: error?.details, hint: error?.hint };
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
  return new Response(JSON.stringify(body), {
    status,
    headers
  });
}
