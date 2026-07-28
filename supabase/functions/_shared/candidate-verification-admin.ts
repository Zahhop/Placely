import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const allowedOrigins = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://zahhop.github.io",
  "https://placelytalent.com",
  "https://www.placelytalent.com"
]);

export function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
  if (allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function isAllowedRequestOrigin(req: Request) {
  const origin = req.headers.get("Origin");
  return !origin || allowedOrigins.has(origin);
}

export function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" }
  });
}

export function safeError(error: any) {
  return { code: error?.code, message: error?.message, details: error?.details, hint: error?.hint };
}

export async function requirePlacelyAdmin(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return { error: "Admin verification workflow is not configured.", status: 500 };
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });

  const { data, error } = await userClient.auth.getUser();
  const user = data?.user;
  if (error || !user) return { error: "Your session has expired. Please log in again.", status: 401 };

  const allowedUserIds = splitEnv("PLACELY_ADMIN_USER_IDS");
  const allowedEmails = splitEnv("PLACELY_ADMIN_EMAILS").map((email) => email.toLowerCase());
  const appRole = String(user.app_metadata?.role || "").toLowerCase();
  const appRoles = Array.isArray(user.app_metadata?.roles)
    ? user.app_metadata.roles.map((role: unknown) => String(role).toLowerCase())
    : [];

  const isAdmin =
    allowedUserIds.includes(user.id) ||
    allowedEmails.includes(String(user.email || "").toLowerCase()) ||
    ["admin", "placely_admin"].includes(appRole) ||
    appRoles.some((role) => ["admin", "placely_admin"].includes(role));

  if (!isAdmin) return { error: "You are not authorized to review candidate verification requests.", status: 403 };

  return {
    user,
    adminClient: createClient(supabaseUrl, serviceRoleKey)
  };
}

function splitEnv(name: string) {
  return String(Deno.env.get(name) || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
