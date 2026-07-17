import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  try {
    if (!isAllowedRequestOrigin(req)) {
      return json({ error: "Origin is not allowed." }, 403, corsHeaders);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization");

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authHeader) {
      return json({ error: "Missing Supabase environment or auth header." }, 500, corsHeaders);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const {
      data: { user },
      error: userError
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return json({ error: "Unauthorized." }, 401, corsHeaders);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const userId = user.id;
    const now = new Date().toISOString();

    const { data: candidateProfile, error: candidateProfileError } = await admin
      .from("candidate_profiles")
      .select("id, resume_path, resume_url")
      .eq("id", userId)
      .maybeSingle();

    if (candidateProfileError) {
      console.error("Candidate delete profile check failed:", candidateProfileError);
      return json({ error: "Could not verify candidate account." }, 500, corsHeaders);
    }

    if (!candidateProfile) {
      return json({ error: "Candidate account required." }, 403, corsHeaders);
    }

    const resumePath = getResumePath(candidateProfile);

    if (resumePath) {
      const { error: removeResumeError } = await admin.storage
        .from("candidate_resumes")
        .remove([resumePath]);

      if (removeResumeError) {
        console.warn("Could not remove candidate resume object:", removeResumeError);
      }
    }

    await admin.from("saved_jobs").delete().eq("candidate_id", userId);

    await admin
      .from("messages")
      .delete()
      .eq("candidate_id", userId);

    await admin
      .from("conversations")
      .update({
        candidate_name: "Candidate profile deleted",
        candidate_role: "Candidate profile deleted",
        candidate_location: "",
        candidate_initials: "CD"
      })
      .eq("candidate_id", userId);

    await admin
      .from("applications")
      .update({
        status: "candidate_deleted",
        candidate_status: "candidate_deleted",
        employer_status: "candidate_profile_deleted",
        candidate_name: "Candidate profile deleted",
        candidate_email: null,
        candidate_phone: null,
        candidate_deleted_at: now,
        updated_at: now
      })
      .eq("candidate_id", userId);

    await admin
      .from("candidate_profiles")
      .update({
        full_name: "Deleted Candidate",
        trade: "",
        location: "",
        bio: "",
        experience: "",
        skills: "",
        certifications: "",
        availability: "",
        email: null,
        phone: "",
        contact_method: "",
        profile_visible: false,
        profile_photo_url: null,
        resume_path: null,
        resume_url: null,
        is_deleted: true,
        deleted_at: now
      })
      .eq("id", userId);

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);

    if (deleteUserError) {
      console.error("Candidate auth user delete failed:", deleteUserError);
      return json({ error: "Could not delete candidate account." }, 500, corsHeaders);
    }

    return json({ success: true }, 200, corsHeaders);
  } catch (error) {
    console.error("Candidate account deletion failed:", error);
    return json({ error: "Candidate account deletion failed." }, 500, corsHeaders);
  }
});

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

function getResumePath(profile: { resume_path?: string | null; resume_url?: string | null }) {
  if (profile.resume_path) return profile.resume_path;
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

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers
  });
}
