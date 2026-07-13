import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe";

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

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const candidatePriceId = Deno.env.get("STRIPE_CANDIDATE_ACCESS_PRICE_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!stripeSecretKey || !candidatePriceId) {
    return json({ error: "Stripe checkout is not configured." }, 500, corsHeaders);
  }

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return json({ error: "Supabase checkout environment is not configured." }, 500, corsHeaders);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized." }, 401, corsHeaders);
    }

    const checkoutLocation = await getCheckoutLocation(req);
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
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
    const { data: employerProfile, error: profileError } = await admin
      .from("employer_profiles")
      .select("id, company_name, company_email, candidate_access, stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!employerProfile) {
      return json({ error: "Employer profile not found." }, 404, corsHeaders);
    }

    if (employerProfile.candidate_access === true) {
      return json({ error: "This employer already has Candidate Network access." }, 409, corsHeaders);
    }

    const stripe = new Stripe(stripeSecretKey);

    let stripeCustomerId = employerProfile.stripe_customer_id || "";

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: employerProfile.company_email || user.email || undefined,
        name: employerProfile.company_name || user.email || "Placely Employer",
        metadata: {
          employer_id: user.id,
          product: "candidate_network"
        }
      });

      stripeCustomerId = customer.id;

      const { error: customerUpdateError } = await admin
        .from("employer_profiles")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", user.id);

      if (customerUpdateError) throw customerUpdateError;
    }

    const successUrl = `${checkoutLocation.origin}${checkoutLocation.appPath}/employers/employer-upgrade-success.html?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${checkoutLocation.origin}${checkoutLocation.appPath}/employers/employer-dashboard.html?checkout=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      client_reference_id: user.id,
      line_items: [
        {
          price: candidatePriceId,
          quantity: 1
        }
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        employer_id: user.id,
        product: "candidate_network"
      },
      subscription_data: {
        metadata: {
          employer_id: user.id,
          product: "candidate_network"
        }
      }
    });

    return json({ url: session.url }, 200, corsHeaders);
  } catch (error) {
    console.error("Stripe checkout creation failed:", error);
    return json(
      {
        error: error instanceof Error ? error.message : "Unable to start checkout."
      },
      500,
      corsHeaders
    );
  }
});

async function getCheckoutLocation(req: Request) {
  const requestOrigin = req.headers.get("Origin") || "";
  let requestedOrigin = requestOrigin;
  let appPath = "";

  try {
    const body = await req.clone().json();
    if (typeof body?.origin === "string") {
      requestedOrigin = body.origin;
    }
    if (typeof body?.appPath === "string") {
      appPath = body.appPath;
    }
  } catch {
    // Body is optional.
  }

  if (!allowedOrigins.has(requestedOrigin)) {
    throw new Error("Checkout origin is not allowed.");
  }

  if (appPath !== "" && appPath !== "/Placely") {
    throw new Error("Checkout app path is not allowed.");
  }

  if (requestedOrigin === "https://zahhop.github.io") {
    appPath = "/Placely";
  }

  return {
    origin: requestedOrigin,
    appPath
  };
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

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers
  });
}
