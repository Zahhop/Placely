import { requirePlacelyAdmin, getCorsHeaders, isAllowedRequestOrigin, json, safeError } from "../_shared/candidate-verification-admin.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, corsHeaders);
  if (!isAllowedRequestOrigin(req)) return json({ error: "Origin is not allowed." }, 403, corsHeaders);

  const auth = await requirePlacelyAdmin(req);
  if ("error" in auth) return json({ error: auth.error }, auth.status, corsHeaders);

  const { data: requests, error: requestsError } = await auth.adminClient
    .from("candidate_verification_requests")
    .select("id, candidate_id, status, request_message, requested_at, reviewed_at, internal_notes")
    .eq("status", "pending")
    .order("requested_at", { ascending: true });

  if (requestsError) {
    console.error("verification requests list failed", safeError(requestsError));
    return json({ error: "Could not load verification requests." }, 500, corsHeaders);
  }

  const candidateIds = [...new Set((requests || []).map((request) => request.candidate_id).filter(Boolean))];
  const candidatesById: Record<string, any> = {};

  if (candidateIds.length) {
    const { data: candidates, error: candidatesError } = await auth.adminClient
      .from("candidate_profiles")
      .select("id, full_name, email, phone, trade, location, availability, verification_status")
      .in("id", candidateIds);

    if (candidatesError) {
      console.error("verification candidates list failed", safeError(candidatesError));
      return json({ error: "Could not load request candidates." }, 500, corsHeaders);
    }

    (candidates || []).forEach((candidate) => {
      candidatesById[String(candidate.id)] = candidate;
    });
  }

  return json({
    requests: (requests || []).map((request) => ({
      id: request.id,
      status: request.status,
      request_message: request.request_message || "",
      requested_at: request.requested_at,
      internal_notes: request.internal_notes || "",
      candidate: candidatesById[String(request.candidate_id)] || { id: request.candidate_id }
    }))
  }, 200, corsHeaders);
});
