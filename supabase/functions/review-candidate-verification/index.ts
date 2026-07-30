import { requirePlacelyAdmin, getCorsHeaders, isAllowedRequestOrigin, json, safeError } from "../_shared/candidate-verification-admin.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, corsHeaders);
  if (!isAllowedRequestOrigin(req)) return json({ error: "Origin is not allowed.", code: "ORIGIN_NOT_ALLOWED" }, 403, corsHeaders);

  const auth = await requirePlacelyAdmin(req);
  if ("error" in auth) return json({ error: auth.error, code: auth.code }, auth.status, corsHeaders);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400, corsHeaders);
  }

  const requestId = String(body.request_id || "").trim();
  const action = String(body.action || "").trim().toLowerCase();
  const internalNotes = sanitize(body.internal_notes, 2000) || null;

  if (!requestId) return json({ error: "Verification request ID is required." }, 400, corsHeaders);
  if (!["approve", "reject"].includes(action)) return json({ error: "Action must be approve or reject." }, 400, corsHeaders);

  const { data: requestRow, error: requestError } = await auth.adminClient
    .from("candidate_verification_requests")
    .select("id, candidate_id, status")
    .eq("id", requestId)
    .maybeSingle();

  if (requestError) {
    console.error("verification request lookup failed", safeError(requestError));
    return json({ error: "Could not load verification request." }, 500, corsHeaders);
  }

  if (!requestRow) return json({ error: "Verification request was not found." }, 404, corsHeaders);
  if (requestRow.status !== "pending") return json({ error: "Verification request has already been reviewed." }, 409, corsHeaders);

  const now = new Date().toISOString();
  const requestStatus = action === "approve" ? "approved" : "rejected";
  const profileUpdates = action === "approve"
    ? { verification_status: "verified", verified_at: now, verified_by: auth.user.id }
    : { verification_status: "rejected", verified_at: null, verified_by: null };

  const { error: requestUpdateError } = await auth.adminClient
    .from("candidate_verification_requests")
    .update({
      status: requestStatus,
      reviewed_at: now,
      reviewed_by: auth.user.id,
      internal_notes: internalNotes
    })
    .eq("id", requestRow.id);

  if (requestUpdateError) {
    console.error("verification request update failed", safeError(requestUpdateError));
    return json({ error: "Could not update verification request." }, 500, corsHeaders);
  }

  const { error: profileUpdateError } = await auth.adminClient
    .from("candidate_profiles")
    .update(profileUpdates)
    .eq("id", requestRow.candidate_id);

  if (profileUpdateError) {
    console.error("verification profile update failed", safeError(profileUpdateError));
    return json({ error: "Request was reviewed, but candidate status could not be updated." }, 500, corsHeaders);
  }

  return json({
    success: true,
    request: {
      id: requestRow.id,
      status: requestStatus,
      reviewed_at: now
    },
    candidate: {
      id: requestRow.candidate_id,
      verification_status: profileUpdates.verification_status
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
