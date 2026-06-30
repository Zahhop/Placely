import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization");

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authHeader) {
      return json({ error: "Missing Supabase environment or auth header." }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const {
      data: { user },
      error: userError
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return json({ error: "Unauthorized." }, 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const userId = user.id;
    const now = new Date().toISOString();

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
        resume_url: null,
        is_deleted: true,
        deleted_at: now
      })
      .eq("id", userId);

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);

    if (deleteUserError) {
      return json({ error: deleteUserError.message }, 500);
    }

    return json({ success: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error." }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
