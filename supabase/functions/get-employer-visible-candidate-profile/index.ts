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
  if (!isAllowedRequestOrigin(req)) {
    logAuthFailure("origin", "ORIGIN_NOT_ALLOWED", { origin: req.headers.get("Origin") || "" });
    return json({ error: "Origin is not allowed.", code: "ORIGIN_NOT_ALLOWED" }, 403, corsHeaders);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Candidate profile access is not configured." }, 500, corsHeaders);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: "Your session has expired. Please log in again." }, 401, corsHeaders);

  const { data: roleRow, error: roleError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (roleError) return json({ error: "Could not verify your account type." }, 500, corsHeaders);
  if (normalizeRole(roleRow?.role) !== "employer") {
    logAuthFailure("role", "NOT_EMPLOYER", { employerUserId: user.id, role: roleRow?.role || "" });
    return json({ error: "Only employers can view candidate profiles.", code: "NOT_EMPLOYER" }, 403, corsHeaders);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400, corsHeaders);
  }

  const candidateId = sanitizeUuid(body.candidateId || body.candidate_id);
  const applicationId = sanitizeUuid(body.applicationId || body.application_id);
  const jobId = sanitizeUuid(body.jobId || body.job_id);
  if (!candidateId) {
    return json({ error: "Candidate ID is required.", code: "INVALID_CANDIDATE" }, 400, corsHeaders);
  }

  const employerResolution = await resolveEmployerProfile(adminClient, user.id);
  const employerProfile = employerResolution.profile;

  console.log("Employer profile resolution", {
    authenticatedUserFound: Boolean(user?.id),
    lookupStrategy: employerResolution.strategy,
    employerProfileFound: Boolean(employerProfile),
    candidateAccess: employerProfile?.candidate_access ?? null,
    subscriptionStatus: employerProfile?.subscription_status ?? null
  });

  if (employerResolution.error) {
    console.error("employer profile lookup failed", {
      lookupStrategy: employerResolution.strategy,
      ...safeError(employerResolution.error)
    });
    return json({ error: "We could not load your employer account.", code: "EMPLOYER_PROFILE_LOOKUP_FAILED" }, 500, corsHeaders);
  }

  if (!employerProfile) {
    logAuthFailure("employer-profile", "EMPLOYER_PROFILE_NOT_FOUND", { employerUserId: user.id });
    return json({ error: "We could not load your employer account.", code: "EMPLOYER_PROFILE_NOT_FOUND" }, 403, corsHeaders);
  }

  const hasCandidateAccess = isCandidateAccessActive(employerProfile || {});
  const applicantAccess = await employerOwnsCandidateApplication(adminClient, user.id, candidateId, applicationId, jobId);

  if (!hasCandidateAccess && !applicantAccess.allowed) {
    const code = applicationId || jobId ? "APPLICANT_ACCESS_DENIED" : "CANDIDATE_ACCESS_REQUIRED";
    logAuthFailure("candidate-access", code, {
      employerUserId: user.id,
      candidateId,
      candidateAccess: employerProfile.candidate_access === true,
      subscriptionStatus: employerProfile.subscription_status || "",
      hasApplicationContext: Boolean(applicationId || jobId)
    });
    return json({
      error: code === "APPLICANT_ACCESS_DENIED"
        ? "We could not confirm access to this applicant's profile."
        : "Candidate Access is required.",
      code
    }, 403, corsHeaders);
  }

  const { data: profile, error: profileError } = await adminClient
    .from("candidate_profiles")
    .select([
      "id",
      "full_name",
      "email",
      "phone",
      "trade",
      "location",
      "bio",
      "experience",
      "availability",
      "willing_to_travel",
      "employment_type",
      "skills",
      "certifications",
      "contact_method",
      "shown_contact_method",
      "profile_photo_url",
      "profile_visible",
      "verification_status",
      "verified_at",
      "resume_path",
      "resume_url"
    ].join(", "))
    .eq("id", candidateId)
    .maybeSingle();

  if (profileError) {
    console.error("candidate profile lookup failed", safeError(profileError));
    return json({ error: "We could not load this candidate profile.", code: "CANDIDATE_PROFILE_LOOKUP_FAILED" }, 500, corsHeaders);
  }

  if (!profile) return json({ error: "Candidate profile unavailable." }, 404, corsHeaders);
  if (profile.profile_visible === false) {
    logAuthFailure("candidate-visibility", "CANDIDATE_NOT_VISIBLE", { employerUserId: user.id, candidateId });
    return json({ error: "This candidate's profile is no longer visible to employers.", code: "CANDIDATE_NOT_VISIBLE" }, 403, corsHeaders);
  }

  const workHistory = await loadWorkHistory(adminClient, candidateId);
  const saved = await isSavedByEmployer(adminClient, user.id, candidateId);
  const resumeRequest = await loadResumeRequest(adminClient, user.id, candidateId);

  return json({
    candidate: mapCandidateProfile(profile, {
      workHistory,
      saved,
      resumeRequest,
      source: applicantAccess.allowed ? "applicant" : "candidate-access"
    })
  }, 200, corsHeaders);
});

async function resolveEmployerProfile(adminClient: any, userId: string) {
  const { data, error } = await adminClient
    .from("employer_profiles")
    .select([
      "id",
      "company_name",
      "candidate_access",
      "subscription_status",
      "subscription_plan",
      "stripe_customer_id",
      "stripe_subscription_id"
    ].join(", "))
    .eq("id", userId)
    .maybeSingle();

  if (error) return { profile: null, strategy: "id", error };
  return { profile: data || null, strategy: "id", error: null };
}

async function employerOwnsCandidateApplication(adminClient: any, employerId: string, candidateId: string, applicationId = "", jobId = "") {
  let query = adminClient
    .from("applications")
    .select("id, job_id")
    .eq("employer_id", employerId)
    .eq("candidate_id", candidateId);

  if (applicationId) query = query.eq("id", applicationId);
  if (jobId) query = query.eq("job_id", jobId);

  const { data, error } = await query.limit(1);
  if (error) return { allowed: false };
  return { allowed: Boolean(data?.length), application: data?.[0] || null };
}

async function loadWorkHistory(adminClient: any, candidateId: string) {
  const { data, error } = await adminClient
    .from("candidate_work_experience")
    .select("id, job_title, company_name, location, employment_type, start_month, start_year, end_month, end_year, is_current, description, created_at, updated_at")
    .eq("candidate_id", candidateId);

  if (error) return [];
  return (data || [])
    .sort((a: any, b: any) => {
      if (Boolean(a.is_current) !== Boolean(b.is_current)) return a.is_current ? -1 : 1;
      const aValue = (Number(a.start_year) || 0) * 100 + (Number(a.start_month) || 0);
      const bValue = (Number(b.start_year) || 0) * 100 + (Number(b.start_month) || 0);
      return bValue - aValue;
    })
    .map((entry: any) => ({
      id: entry.id,
      position: entry.job_title || "",
      employer: entry.company_name || "",
      location: entry.location || "",
      employment_type: entry.employment_type || "",
      start_date: formatMonthYear(entry.start_month, entry.start_year),
      end_date: entry.is_current ? "Present" : formatMonthYear(entry.end_month, entry.end_year),
      current: Boolean(entry.is_current),
      description: entry.description || ""
    }));
}

async function isSavedByEmployer(adminClient: any, employerId: string, candidateId: string) {
  const { data, error } = await adminClient
    .from("saved_talent")
    .select("id")
    .eq("employer_id", employerId)
    .eq("candidate_id", candidateId)
    .limit(1);

  if (error) {
    console.warn("saved talent lookup failed", safeError(error));
    return false;
  }

  return Boolean(data?.length);
}

async function loadResumeRequest(adminClient: any, employerId: string, candidateId: string) {
  const { data, error } = await adminClient
    .from("candidate_resume_access_requests")
    .select("id, status, requested_at, responded_at")
    .eq("employer_id", employerId)
    .eq("candidate_id", candidateId)
    .order("requested_at", { ascending: false })
    .limit(1);

  if (error) {
    console.warn("resume access request lookup failed", safeError(error));
    return null;
  }

  return data?.[0] || null;
}

function mapCandidateProfile(profile: Record<string, any>, options: { workHistory: any[]; saved: boolean; resumeRequest: any; source: string }) {
  const visibleContact = getVisibleContact(profile);
  const response: Record<string, unknown> = {
    id: profile.id,
    full_name: text(profile.full_name) || "Candidate",
    trade: text(profile.trade),
    location: text(profile.location),
    bio: text(profile.bio),
    experience: text(profile.experience),
    availability: text(profile.availability),
    willing_to_travel: text(profile.willing_to_travel),
    employment_type: text(profile.employment_type),
    skills: text(profile.skills),
    certifications: text(profile.certifications),
    contact_method: text(profile.contact_method),
    shown_contact_method: visibleContact.preference,
    profile_photo_url: text(profile.profile_photo_url),
    profile_visible: profile.profile_visible !== false,
    verification_status: normalizeVerificationStatus(profile.verification_status),
    verified_at: normalizeVerificationStatus(profile.verification_status) === "verified" ? profile.verified_at || null : null,
    work_history: options.workHistory,
    resume_available: Boolean(text(profile.resume_path || profile.resume_url)),
    resume_request: normalizeResumeRequest(options.resumeRequest),
    saved_by_employer: options.saved,
    access_source: options.source
  };

  if (visibleContact.showEmail) response.email = text(profile.email);
  if (visibleContact.showPhone) response.phone = text(profile.phone);

  return response;
}

function normalizeResumeRequest(request: any) {
  if (!request) return null;
  const status = String(request.status || "").toLowerCase().trim();
  if (!["pending", "approved", "declined"].includes(status)) return null;
  return {
    id: request.id,
    status,
    requested_at: request.requested_at || null,
    responded_at: request.responded_at || null
  };
}

function getVisibleContact(profile: Record<string, any>) {
  const preference = String(profile.shown_contact_method || "").toLowerCase().trim();
  const normalized = preference === "both" || preference === "email" || preference === "phone" ? preference : "";

  return {
    preference: normalized || "none",
    showEmail: normalized === "email" || normalized === "both",
    showPhone: normalized === "phone" || normalized === "both"
  };
}

function isCandidateAccessActive(profile: Record<string, any>) {
  const status = normalizeCandidateAccessStatus(profile.subscription_status || profile.access_status || profile.status);
  return profile.candidate_access === true && (!status || ["active", "trialing"].includes(status));
}

function normalizeCandidateAccessStatus(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[_\s-]+/g, "_");
}

function normalizeVerificationStatus(status: unknown) {
  const value = String(status || "unverified").toLowerCase().trim();
  return ["pending", "verified"].includes(value) ? value : "unverified";
}

function formatMonthYear(month: unknown, year: unknown) {
  const yearNumber = Number(year);
  if (!yearNumber) return "";
  const monthNumber = Number(month);
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return monthNumber >= 1 && monthNumber <= 12 ? `${labels[monthNumber - 1]} ${yearNumber}` : String(yearNumber);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function sanitizeUuid(value: unknown) {
  const id = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : "";
}

function normalizeRole(role: unknown) {
  return String(role || "").toLowerCase().trim();
}

function logAuthFailure(stage: string, code: string, context: Record<string, unknown> = {}) {
  console.warn("candidate profile authorization failed", { stage, code, ...context });
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
