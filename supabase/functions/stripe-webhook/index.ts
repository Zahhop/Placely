import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const candidatePriceId = Deno.env.get("STRIPE_CANDIDATE_ACCESS_PRICE_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!stripeSecretKey || !webhookSecret || !candidatePriceId || !supabaseUrl || !serviceRoleKey) {
    return json({ error: "Webhook environment is not configured." }, 500);
  }

  try {
    const stripe = new Stripe(stripeSecretKey);
    const payload = await req.text();
    const signature = req.headers.get("Stripe-Signature");

    if (!signature) {
      return json({ error: "Missing Stripe signature." }, 400);
    }

    const event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
    const admin = createClient(supabaseUrl, serviceRoleKey);

    switch (event.type) {
      case "checkout.session.completed":
        if (event.data.object.metadata?.product_type === "job_boost") {
          await handleJobBoostCheckoutCompleted(admin, event.data.object as Stripe.Checkout.Session);
          break;
        }

        await handleCheckoutCompleted(admin, stripe, event.data.object as Stripe.Checkout.Session, candidatePriceId);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(admin, event.data.object as Stripe.Subscription, candidatePriceId);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(admin, event.data.object as Stripe.Subscription, candidatePriceId);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(admin, event.data.object as Stripe.Invoice, candidatePriceId);
        break;
      default:
        break;
    }

    return json({ received: true });
  } catch (error) {
    console.error("Stripe webhook failed:", error);
    return json({ error: "Webhook verification or processing failed." }, 400);
  }
});

async function handleCheckoutCompleted(
  admin: ReturnType<typeof createClient>,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  candidatePriceId: string
) {
  if (session.mode !== "subscription") return;
  if (!(await checkoutSessionUsesCandidatePrice(stripe, session.id, candidatePriceId))) return;

  const employerId = session.client_reference_id || session.metadata?.employer_id;
  if (!employerId) throw new Error("Checkout session missing employer ID.");

  const { error } = await admin
    .from("employer_profiles")
    .update({
      candidate_access: true,
      subscription_status: "active",
      subscription_plan: "candidate_access",
      subscription_started_at: new Date().toISOString(),
      stripe_customer_id: normalizeStripeId(session.customer),
      stripe_subscription_id: normalizeStripeId(session.subscription)
    })
    .eq("id", employerId);

  if (error) throw error;
}

async function handleJobBoostCheckoutCompleted(
  admin: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session
) {
  if (session.mode !== "payment" || session.payment_status !== "paid") return;

  const metadata = session.metadata || {};
  const employerId = metadata.employer_user_id || metadata.employer_id;
  const employerProfileId = metadata.employer_profile_id || employerId;
  const jobId = metadata.job_id;
  const durationDays = Number(metadata.boost_duration_days);
  const budgetCents = Number(metadata.boost_budget_cents);
  const currency = String(metadata.boost_currency || session.currency || "cad").toLowerCase();

  if (!employerId || !employerProfileId || !jobId || ![3, 7, 14, 30].includes(durationDays)) {
    throw new Error("Job boost checkout metadata is incomplete.");
  }

  if (![2500, 5000, 10000, 20000].includes(budgetCents) || currency !== "cad") {
    throw new Error("Job boost checkout amount is invalid.");
  }

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .select("id, employer_id, status")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError) throw jobError;
  if (!job || job.employer_id !== employerId || !isActiveJob(job.status)) return;

  const sessionId = String(session.id || "");
  const paymentIntentId = normalizeStripeId(session.payment_intent);

  const { data: existingBoost, error: existingError } = await admin
    .from("job_boosts")
    .select("id, status")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existingBoost?.status === "active") return;

  const { data: activeBoost, error: activeBoostError } = await admin
    .from("job_boosts")
    .select("id")
    .eq("job_id", jobId)
    .eq("status", "active")
    .gt("ends_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (activeBoostError) throw activeBoostError;
  if (activeBoost && activeBoost.id !== existingBoost?.id) return;

  const now = new Date();
  const endsAt = new Date(now.getTime() + durationDays * 86_400_000);

  if (existingBoost) {
    const { error } = await admin
      .from("job_boosts")
      .update({
        status: "active",
        budget_cents: budgetCents,
        currency: "cad",
        duration_days: durationDays,
        starts_at: now.toISOString(),
        ends_at: endsAt.toISOString(),
        stripe_payment_intent_id: paymentIntentId,
        updated_at: now.toISOString()
      })
      .eq("id", existingBoost.id);

    if (error) throw error;
    return;
  }

  const { error } = await admin
    .from("job_boosts")
    .insert({
      job_id: jobId,
      employer_id: employerProfileId,
      status: "active",
      budget_cents: budgetCents,
      currency: "cad",
      duration_days: durationDays,
      starts_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
      stripe_checkout_session_id: sessionId,
      stripe_payment_intent_id: paymentIntentId
    });

  if (error) throw error;
}

async function handleSubscriptionUpdated(
  admin: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription,
  candidatePriceId: string
) {
  if (!subscriptionUsesCandidatePrice(subscription, candidatePriceId)) return;

  const employerId = await findEmployerId(admin, subscription);
  if (!employerId) return;

  const status = String(subscription.status || "unknown");
  const accessAllowed = ["active", "trialing"].includes(status);

  const { error } = await admin
    .from("employer_profiles")
    .update({
      candidate_access: accessAllowed,
      subscription_status: status,
      subscription_plan: "candidate_access",
      stripe_customer_id: normalizeStripeId(subscription.customer),
      stripe_subscription_id: normalizeStripeId(subscription.id)
    })
    .eq("id", employerId);

  if (error) throw error;
}

async function handleSubscriptionDeleted(
  admin: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription,
  candidatePriceId: string
) {
  if (!subscriptionUsesCandidatePrice(subscription, candidatePriceId)) return;

  const employerId = await findEmployerId(admin, subscription);
  if (!employerId) return;

  const { error } = await admin
    .from("employer_profiles")
    .update({
      candidate_access: false,
      subscription_status: "canceled",
      subscription_plan: "candidate_access",
      stripe_customer_id: normalizeStripeId(subscription.customer),
      stripe_subscription_id: normalizeStripeId(subscription.id)
    })
    .eq("id", employerId);

  if (error) throw error;
}

async function handleInvoicePaymentFailed(
  admin: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice,
  candidatePriceId: string
) {
  if (!invoiceUsesCandidatePrice(invoice, candidatePriceId)) return;

  const invoiceWithReferences = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
    customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
  };
  const subscriptionId = normalizeStripeId(invoiceWithReferences.subscription);
  const customerId = normalizeStripeId(invoiceWithReferences.customer);

  let query = admin
    .from("employer_profiles")
    .update({
      candidate_access: false,
      subscription_status: "past_due",
      subscription_plan: "candidate_access"
    });

  if (subscriptionId) {
    query = query.eq("stripe_subscription_id", subscriptionId);
  } else if (customerId) {
    query = query.eq("stripe_customer_id", customerId);
  } else {
    return;
  }

  const { error } = await query;
  if (error) throw error;
}

async function findEmployerId(admin: ReturnType<typeof createClient>, stripeObject: Stripe.Subscription) {
  const metadataEmployerId = stripeObject.metadata?.employer_id;
  if (metadataEmployerId) return metadataEmployerId;

  const subscriptionId = normalizeStripeId(stripeObject.id);
  const customerId = normalizeStripeId(stripeObject.customer);

  let query = admin.from("employer_profiles").select("id").limit(1);

  if (subscriptionId) {
    query = query.eq("stripe_subscription_id", subscriptionId);
  } else if (customerId) {
    query = query.eq("stripe_customer_id", customerId);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

async function checkoutSessionUsesCandidatePrice(stripe: Stripe, sessionId: string, candidatePriceId: string) {
  const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 10 });
  return lineItems.data.some((item) => item.price?.id === candidatePriceId);
}

function subscriptionUsesCandidatePrice(subscription: Stripe.Subscription, candidatePriceId: string) {
  return subscription.items.data.some((item) => item.price.id === candidatePriceId);
}

function invoiceUsesCandidatePrice(invoice: Stripe.Invoice, candidatePriceId: string) {
  return invoice.lines.data.some((line) => line.price?.id === candidatePriceId);
}

function normalizeStripeId(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "id" in value) return String((value as { id: string }).id);
  return String(value);
}

function isActiveJob(status: unknown) {
  return ["active", "published", "open"].includes(String(status || "active").toLowerCase().trim());
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
