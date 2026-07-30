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

function adminError(error: string, code: string, status: number) {
  return { error, code, status };
}

export async function requirePlacelyAdmin(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return adminError("Admin verification workflow is not configured.", "ADMIN_CONFIG_MISSING", 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });

  const { data, error } = await userClient.auth.getUser();
  const user = data?.user;
  if (error || !user) {
    console.warn("Placely admin auth required", {
      hasAuthorizationHeader: Boolean(authHeader),
      code: error?.code,
      message: error?.message
    });
    return adminError("Your session has expired. Please log in again.", "ADMIN_AUTH_REQUIRED", 401);
  }

  const allowedUserIds = splitEnv("PLACELY_ADMIN_USER_IDS");
  const allowedEmails = splitEnv("PLACELY_ADMIN_EMAILS").map((email) => email.trim().toLowerCase());
  const appRole = String(user.app_metadata?.role || "").toLowerCase();
  const appRoles = Array.isArray(user.app_metadata?.roles)
    ? user.app_metadata.roles.map((role: unknown) => String(role).trim().toLowerCase())
    : [];
  const userEmail = String(user.email || "").trim().toLowerCase();

  const isAdmin =
    allowedUserIds.includes(user.id) ||
    allowedEmails.includes(userEmail) ||
    ["admin", "placely_admin"].includes(appRole) ||
    appRoles.some((role) => ["admin", "placely_admin"].includes(role));

  if (!isAdmin) {
    console.warn("Placely admin access denied", {
      userId: user.id,
      emailAllowed: allowedEmails.includes(userEmail),
      userIdAllowed: allowedUserIds.includes(user.id),
      appRole,
      appRoles
    });
    return adminError("You are not authorized to review candidate verification requests.", "ADMIN_ACCESS_DENIED", 403);
  }

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
