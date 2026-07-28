import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe";

type AdminClient = ReturnType<typeof createClient>;

type EmployerProfile = {
  id: string;
  company_name?: string | null;
  company_email?: string | null;
  candidate_access?: boolean | null;
  subscription_status?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
};

type CandidateAccessEmailTemplate =
  | "candidate-access-activated"
  | "candidate-access-renewed"
  | "candidate-access-payment-failed"
  | "candidate-access-cancelled";

type CandidateAccessEmailRequest = {
  template: CandidateAccessEmailTemplate;
  employer: EmployerProfile;
  billingEmail: string;
  amountLabel?: string;
  eventDate: Date;
  billingPeriod?: string;
  accessStatus: string;
  stripeDocumentUrl?: string;
  stripeCheckoutSessionId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeInvoiceId?: string | null;
};

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
    let emailRequest: CandidateAccessEmailRequest | null = null;

    console.info("stripe webhook: event received", { eventId: event.id, eventType: event.type });

    switch (event.type) {
      case "checkout.session.completed":
        if (event.data.object.metadata?.product_type === "job_boost") {
          await handleJobBoostCheckoutCompleted(admin, event.data.object as Stripe.Checkout.Session);
          break;
        }

        emailRequest = await handleCheckoutCompleted(
          admin,
          stripe,
          event.data.object as Stripe.Checkout.Session,
          candidatePriceId
        );
        break;
      case "invoice.paid":
      case "invoice.payment_succeeded":
        emailRequest = await handleInvoicePaymentSucceeded(
          admin,
          stripe,
          event.data.object as Stripe.Invoice,
          candidatePriceId
        );
        break;
      case "customer.subscription.updated":
        emailRequest = await handleSubscriptionUpdated(
          admin,
          stripe,
          event.data.object as Stripe.Subscription,
          candidatePriceId
        );
        break;
      case "customer.subscription.deleted":
        emailRequest = await handleSubscriptionDeleted(
          admin,
          stripe,
          event.data.object as Stripe.Subscription,
          candidatePriceId
        );
        break;
      case "invoice.payment_failed":
        emailRequest = await handleInvoicePaymentFailed(
          admin,
          stripe,
          event.data.object as Stripe.Invoice,
          candidatePriceId
        );
        break;
      default:
        break;
    }

    if (emailRequest) {
      await sendTransactionalEmail(admin, event.id, emailRequest);
    }

    return json({ received: true });
  } catch (error) {
    console.error("Stripe webhook failed:", safeError(error));
    return json({ error: "Webhook verification or processing failed." }, 400);
  }
});

async function handleCheckoutCompleted(
  admin: AdminClient,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  candidatePriceId: string
): Promise<CandidateAccessEmailRequest | null> {
  if (session.mode !== "subscription") return null;
  if (!(await checkoutSessionUsesCandidatePrice(stripe, session.id, candidatePriceId))) return null;

  const employerId = session.client_reference_id || session.metadata?.employer_id;
  if (!employerId) throw new Error("Checkout session missing employer ID.");

  const stripeCustomerId = normalizeStripeId(session.customer);
  const stripeSubscriptionId = normalizeStripeId(session.subscription);

  const { error } = await admin
    .from("employer_profiles")
    .update({
      candidate_access: true,
      subscription_status: "active",
      subscription_plan: "candidate_access",
      subscription_started_at: new Date().toISOString(),
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId
    })
    .eq("id", employerId);

  if (error) throw error;

  console.info("stripe webhook: candidate access activation completed", { employerId, eventSource: "checkout" });

  const employer = await getEmployerProfile(admin, employerId);
  if (!employer) return null;

  const billingEmail = await resolveBillingEmail(stripe, {
    customerId: stripeCustomerId,
    stripeEmail: session.customer_details?.email || null,
    profileEmail: employer.company_email || null
  });

  if (!billingEmail) {
    console.warn("stripe webhook: missing billing email for activation", { employerId, checkoutSessionId: session.id });
    return null;
  }

  const invoice = await retrieveInvoice(stripe, normalizeStripeId(session.invoice));
  const amount = session.amount_total ?? invoice?.amount_paid ?? null;
  const currency = session.currency || invoice?.currency || "cad";

  return {
    template: "candidate-access-activated",
    employer,
    billingEmail,
    amountLabel: formatMoney(amount, currency),
    eventDate: stripeDate(session.created),
    accessStatus: "Active",
    stripeDocumentUrl: getInvoiceDocumentUrl(invoice),
    stripeCheckoutSessionId: session.id,
    stripeSubscriptionId,
    stripeInvoiceId: invoice?.id || normalizeStripeId(session.invoice)
  };
}

async function handleJobBoostCheckoutCompleted(
  admin: AdminClient,
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

async function handleInvoicePaymentSucceeded(
  admin: AdminClient,
  stripe: Stripe,
  invoice: Stripe.Invoice,
  candidatePriceId: string
): Promise<CandidateAccessEmailRequest | null> {
  if (!invoiceUsesCandidatePrice(invoice, candidatePriceId)) return null;
  if (isInitialSubscriptionInvoice(invoice)) return null;

  const { subscriptionId, customerId } = getInvoiceReferences(invoice);
  const employer = await findEmployerByStripeReference(admin, subscriptionId, customerId);
  if (!employer) return null;

  const { error } = await admin
    .from("employer_profiles")
    .update({
      candidate_access: true,
      subscription_status: "active",
      subscription_plan: "candidate_access"
    })
    .eq("id", employer.id);

  if (error) throw error;

  const updatedEmployer = await getEmployerProfile(admin, employer.id) || employer;
  const billingEmail = await resolveBillingEmail(stripe, {
    customerId,
    stripeEmail: getInvoiceCustomerEmail(invoice),
    profileEmail: updatedEmployer.company_email || null
  });

  if (!billingEmail) {
    console.warn("stripe webhook: missing billing email for renewal", { employerId: employer.id, invoiceId: invoice.id });
    return null;
  }

  console.info("stripe webhook: candidate access renewal completed", { employerId: employer.id, invoiceId: invoice.id });

  return {
    template: "candidate-access-renewed",
    employer: updatedEmployer,
    billingEmail,
    amountLabel: formatMoney(invoice.amount_paid ?? null, invoice.currency || "cad"),
    eventDate: stripeDate(invoice.status_transitions?.paid_at || invoice.created),
    billingPeriod: getInvoiceBillingPeriod(invoice),
    accessStatus: getAccessStatusLabel(updatedEmployer),
    stripeDocumentUrl: getInvoiceDocumentUrl(invoice),
    stripeSubscriptionId: subscriptionId,
    stripeInvoiceId: invoice.id
  };
}

async function handleSubscriptionUpdated(
  admin: AdminClient,
  stripe: Stripe,
  subscription: Stripe.Subscription,
  candidatePriceId: string
): Promise<CandidateAccessEmailRequest | null> {
  if (!subscriptionUsesCandidatePrice(subscription, candidatePriceId)) return null;

  const employerId = await findEmployerId(admin, subscription);
  if (!employerId) return null;

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

  console.info("stripe webhook: subscription status synchronized", { employerId, status });

  if (!["canceled", "incomplete_expired"].includes(status)) return null;

  const employer = await getEmployerProfile(admin, employerId);
  if (!employer) return null;

  const billingEmail = await resolveBillingEmail(stripe, {
    customerId: normalizeStripeId(subscription.customer),
    stripeEmail: null,
    profileEmail: employer.company_email || null
  });

  if (!billingEmail) return null;

  return {
    template: "candidate-access-cancelled",
    employer,
    billingEmail,
    eventDate: getSubscriptionEndDate(subscription),
    billingPeriod: getSubscriptionPeriodLabel(subscription),
    accessStatus: getAccessStatusLabel(employer),
    stripeCheckoutSessionId: null,
    stripeSubscriptionId: subscription.id,
    stripeInvoiceId: null
  };
}

async function handleSubscriptionDeleted(
  admin: AdminClient,
  stripe: Stripe,
  subscription: Stripe.Subscription,
  candidatePriceId: string
): Promise<CandidateAccessEmailRequest | null> {
  if (!subscriptionUsesCandidatePrice(subscription, candidatePriceId)) return null;

  const employerId = await findEmployerId(admin, subscription);
  if (!employerId) return null;

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

  console.info("stripe webhook: candidate access cancellation completed", { employerId });

  const employer = await getEmployerProfile(admin, employerId);
  if (!employer) return null;

  const billingEmail = await resolveBillingEmail(stripe, {
    customerId: normalizeStripeId(subscription.customer),
    stripeEmail: null,
    profileEmail: employer.company_email || null
  });

  if (!billingEmail) return null;

  return {
    template: "candidate-access-cancelled",
    employer,
    billingEmail,
    eventDate: getSubscriptionEndDate(subscription),
    billingPeriod: getSubscriptionPeriodLabel(subscription),
    accessStatus: getAccessStatusLabel(employer),
    stripeCheckoutSessionId: null,
    stripeSubscriptionId: subscription.id,
    stripeInvoiceId: null
  };
}

async function handleInvoicePaymentFailed(
  admin: AdminClient,
  stripe: Stripe,
  invoice: Stripe.Invoice,
  candidatePriceId: string
): Promise<CandidateAccessEmailRequest | null> {
  if (!invoiceUsesCandidatePrice(invoice, candidatePriceId)) return null;

  const { subscriptionId, customerId } = getInvoiceReferences(invoice);
  if (!subscriptionId && !customerId) return null;

  let query = admin
    .from("employer_profiles")
    .update({
      candidate_access: false,
      subscription_status: "past_due",
      subscription_plan: "candidate_access"
    })
    .select("id, company_name, company_email, candidate_access, subscription_status, stripe_customer_id, stripe_subscription_id")
    .limit(1);

  if (subscriptionId) {
    query = query.eq("stripe_subscription_id", subscriptionId);
  } else {
    query = query.eq("stripe_customer_id", customerId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const employer = data as EmployerProfile;
  const billingEmail = await resolveBillingEmail(stripe, {
    customerId,
    stripeEmail: getInvoiceCustomerEmail(invoice),
    profileEmail: employer.company_email || null
  });

  if (!billingEmail) {
    console.warn("stripe webhook: missing billing email for failed payment", { employerId: employer.id, invoiceId: invoice.id });
    return null;
  }

  console.info("stripe webhook: candidate access payment failure recorded", { employerId: employer.id, invoiceId: invoice.id });

  return {
    template: "candidate-access-payment-failed",
    employer,
    billingEmail,
    amountLabel: formatMoney(invoice.amount_due ?? null, invoice.currency || "cad"),
    eventDate: stripeDate(invoice.created),
    accessStatus: getAccessStatusLabel(employer),
    stripeDocumentUrl: getInvoiceDocumentUrl(invoice),
    stripeSubscriptionId,
    stripeInvoiceId: invoice.id
  };
}

async function sendTransactionalEmail(
  admin: AdminClient,
  stripeEventId: string,
  request: CandidateAccessEmailRequest
) {
  console.info("stripe webhook: transactional email selected", {
    eventId: stripeEventId,
    employerId: request.employer.id,
    template: request.template
  });

  const inserted = await createEmailEvent(admin, stripeEventId, request);
  if (!inserted) return;

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY is not configured.");

    const message = buildCandidateAccessEmail(request);
    const fromEmail = Deno.env.get("PLACELY_TRANSACTIONAL_FROM_EMAIL") ||
      Deno.env.get("PLACELY_FROM_EMAIL") ||
      "Placely Talent <hello@placelytalent.com>";
    const replyTo = Deno.env.get("PLACELY_SUPPORT_EMAIL") || undefined;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [request.billingEmail],
        subject: message.subject,
        text: message.text,
        html: message.html,
        reply_to: replyTo
      })
    });

    const providerText = await resendResponse.text().catch(() => "");
    let providerBody: Record<string, unknown> = {};

    try {
      providerBody = providerText ? JSON.parse(providerText) as Record<string, unknown> : {};
    } catch {
      providerBody = { message: providerText };
    }

    if (!resendResponse.ok) {
      const message = String(providerBody?.message || "Email provider request failed.").slice(0, 500);
      await markEmailEventFailed(admin, inserted.id, message);
      console.error("stripe webhook: transactional email send failure", {
        eventId: stripeEventId,
        employerId: request.employer.id,
        template: request.template,
        providerStatus: resendResponse.status
      });
      return;
    }

    await markEmailEventSent(admin, inserted.id, String(providerBody?.id || ""));
    console.info("stripe webhook: transactional email send success", {
      eventId: stripeEventId,
      employerId: request.employer.id,
      template: request.template
    });
  } catch (error) {
    await markEmailEventFailed(admin, inserted.id, safeErrorMessage(error));
    console.error("stripe webhook: transactional email send failure", {
      eventId: stripeEventId,
      employerId: request.employer.id,
      template: request.template,
      error: safeErrorMessage(error)
    });
  }
}

async function createEmailEvent(admin: AdminClient, stripeEventId: string, request: CandidateAccessEmailRequest) {
  const { data, error } = await admin
    .from("transactional_email_events")
    .insert({
      stripe_event_id: stripeEventId,
      stripe_checkout_session_id: request.stripeCheckoutSessionId || null,
      stripe_subscription_id: request.stripeSubscriptionId || null,
      stripe_invoice_id: request.stripeInvoiceId || null,
      employer_user_id: request.employer.id,
      template_name: request.template,
      recipient_email: request.billingEmail,
      status: "pending"
    })
    .select("id")
    .maybeSingle();

  if (!error) return data as { id: string } | null;

  if (isUniqueViolation(error)) {
    console.info("stripe webhook: duplicate transactional email skipped", {
      eventId: stripeEventId,
      employerId: request.employer.id,
      template: request.template
    });
    return null;
  }

  console.error("stripe webhook: could not record transactional email event", safeError(error));
  return null;
}

async function markEmailEventSent(admin: AdminClient, id: string, providerEmailId: string) {
  const { error } = await admin
    .from("transactional_email_events")
    .update({
      status: "sent",
      provider_email_id: providerEmailId || null,
      error_message: null,
      sent_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) console.error("stripe webhook: could not mark email sent", safeError(error));
}

async function markEmailEventFailed(admin: AdminClient, id: string, errorMessage: string) {
  const { error } = await admin
    .from("transactional_email_events")
    .update({
      status: "failed",
      error_message: errorMessage.slice(0, 1000)
    })
    .eq("id", id);

  if (error) console.error("stripe webhook: could not mark email failed", safeError(error));
}

function buildCandidateAccessEmail(request: CandidateAccessEmailRequest) {
  const companyName = request.employer.company_name || "your company";
  const greetingName = request.employer.company_name || "there";
  const candidateSearchUrl = buildAppUrl("/employers/find-candidates.html");
  const billingUrl = buildAppUrl("/employers/employer-dashboard.html");
  const supportUrl = buildAppUrl("/employers/employer-support.html");

  if (request.template === "candidate-access-activated") {
    const details = [
      ["Product", "Placely Candidate Access"],
      ["Status", "Active"],
      ["Amount", request.amountLabel || "Not available"],
      ["Purchase date", formatDate(request.eventDate)],
      ["Billing email", request.billingEmail]
    ];
    if (request.stripeDocumentUrl) details.push(["Stripe receipt or invoice", request.stripeDocumentUrl]);

    return renderEmail({
      subject: "Your Placely Candidate Access is active",
      title: "Candidate Access is active",
      intro: `Hi ${greetingName}, your Candidate Access purchase was successful, and access is now active for ${companyName}.`,
      details,
      buttonText: "Open Candidate Network",
      buttonUrl: candidateSearchUrl,
      supportUrl
    });
  }

  if (request.template === "candidate-access-renewed") {
    const details = [
      ["Product", "Placely Candidate Access"],
      ["Amount paid", request.amountLabel || "Not available"],
      ["Renewal date", formatDate(request.eventDate)],
      ["New billing period", request.billingPeriod || "Current subscription period"],
      ["Current access status", request.accessStatus],
      ["Billing email", request.billingEmail]
    ];
    if (request.stripeDocumentUrl) details.push(["Stripe receipt or invoice", request.stripeDocumentUrl]);

    return renderEmail({
      subject: "Your Placely Candidate Access renewal was successful",
      title: "Candidate Access renewed",
      intro: `Hi ${greetingName}, your Candidate Access renewal was successful for ${companyName}.`,
      details,
      buttonText: "Open Candidate Network",
      buttonUrl: candidateSearchUrl,
      supportUrl
    });
  }

  if (request.template === "candidate-access-payment-failed") {
    const details = [
      ["Company", companyName],
      ["Failed payment date", formatDate(request.eventDate)],
      ["Current access status", request.accessStatus],
      ["Amount due", request.amountLabel || "Not available"],
      ["Billing email", request.billingEmail]
    ];

    return renderEmail({
      subject: "Action needed: Candidate Access payment failed",
      title: "Candidate Access payment failed",
      intro: `Hi ${greetingName}, the latest Candidate Access payment for ${companyName} did not go through. Access is not shown as cancelled unless your subscription has ended.`,
      details,
      buttonText: "Update Billing",
      buttonUrl: billingUrl,
      supportUrl
    });
  }

  const details = [
    ["Company", companyName],
    ["Effective end date", formatDate(request.eventDate)],
    ["Access no longer available", "Candidate search, saved talent, and Candidate Network messaging"],
    ["Billing period", request.billingPeriod || "Ended"],
    ["Billing email", request.billingEmail]
  ];

  return renderEmail({
    subject: "Your Placely Candidate Access has ended",
    title: "Candidate Access has ended",
    intro: `Hi ${greetingName}, Candidate Access has ended for ${companyName}.`,
    details,
    buttonText: "Reactivate Access",
    buttonUrl: billingUrl,
    supportUrl
  });
}

function renderEmail({
  subject,
  title,
  intro,
  details,
  buttonText,
  buttonUrl,
  supportUrl,
  extraText
}: {
  subject: string;
  title: string;
  intro: string;
  details: string[][];
  buttonText: string;
  buttonUrl: string;
  supportUrl: string;
  extraText?: string;
}) {
  const textLines = [
    "Placely Talent",
    "",
    title,
    "",
    intro,
    "",
    "Details:",
    ...details.map(([label, value]) => `- ${label}: ${value || "Not available"}`),
    "",
    `${buttonText}: ${buttonUrl}`,
    "",
    extraText || "",
    "Need help? Visit Placely Support from your employer dashboard.",
    supportUrl,
    "",
    "Placely Talent"
  ].filter((line, index, lines) => line || lines[index - 1] !== "");

  const detailRows = details
    .map(([label, value]) => `
      <tr>
        <td style="padding:10px 0;color:#5f675f;font-size:14px;">${escapeHtml(label)}</td>
        <td style="padding:10px 0;color:#151915;font-size:14px;text-align:right;font-weight:600;">${formatDetailValue(label, value)}</td>
      </tr>
    `)
    .join("");

  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;background:#f4f5f1;font-family:Arial,Helvetica,sans-serif;color:#151915;">
        <div style="padding:28px 14px;">
          <div style="max-width:560px;margin:0 auto;">
            <div style="padding:0 0 14px 0;font-size:18px;font-weight:700;color:#151915;">Placely Talent</div>
            <div style="background:#ffffff;border:1px solid #dde2d8;border-radius:8px;padding:28px;">
              <h1 style="margin:0 0 14px 0;font-size:24px;line-height:1.25;color:#151915;">${escapeHtml(title)}</h1>
              <p style="margin:0 0 22px 0;font-size:16px;line-height:1.6;color:#333b33;">${escapeHtml(intro)}</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border-top:1px solid #e5e8e1;border-bottom:1px solid #e5e8e1;margin:0 0 24px 0;">
                ${detailRows}
              </table>
              <a href="${escapeAttribute(buttonUrl)}" style="display:inline-block;background:#1f6f4a;color:#ffffff;text-decoration:none;font-weight:700;border-radius:6px;padding:13px 18px;font-size:15px;">${escapeHtml(buttonText)}</a>
              ${extraText ? `<p style="margin:22px 0 0 0;font-size:14px;line-height:1.6;color:#4f594f;">${escapeHtml(extraText)}</p>` : ""}
              <p style="margin:16px 0 0 0;font-size:14px;line-height:1.6;color:#4f594f;">Need help? Visit <a href="${escapeAttribute(supportUrl)}" style="color:#1f6f4a;">Placely Support</a> from your employer dashboard.</p>
            </div>
            <p style="margin:18px 0 0 0;font-size:12px;line-height:1.5;color:#697169;">Placely Talent</p>
          </div>
        </div>
      </body>
    </html>
  `;

  return { subject, text: textLines.join("\n"), html };
}

async function getEmployerProfile(admin: AdminClient, employerId: string) {
  const { data, error } = await admin
    .from("employer_profiles")
    .select("id, company_name, company_email, candidate_access, subscription_status, stripe_customer_id, stripe_subscription_id")
    .eq("id", employerId)
    .maybeSingle();

  if (error) throw error;
  return data as EmployerProfile | null;
}

async function findEmployerId(admin: AdminClient, stripeObject: Stripe.Subscription) {
  const metadataEmployerId = stripeObject.metadata?.employer_id;
  if (metadataEmployerId) return metadataEmployerId;

  const subscriptionId = normalizeStripeId(stripeObject.id);
  const customerId = normalizeStripeId(stripeObject.customer);
  const employer = await findEmployerByStripeReference(admin, subscriptionId, customerId);
  return employer?.id || null;
}

async function findEmployerByStripeReference(admin: AdminClient, subscriptionId: string | null, customerId: string | null) {
  let query = admin
    .from("employer_profiles")
    .select("id, company_name, company_email, candidate_access, subscription_status, stripe_customer_id, stripe_subscription_id")
    .limit(1);

  if (subscriptionId) {
    query = query.eq("stripe_subscription_id", subscriptionId);
  } else if (customerId) {
    query = query.eq("stripe_customer_id", customerId);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as EmployerProfile | null;
}

async function resolveBillingEmail(
  stripe: Stripe,
  {
    customerId,
    stripeEmail,
    profileEmail
  }: {
    customerId?: string | null;
    stripeEmail?: string | null;
    profileEmail?: string | null;
  }
) {
  const cleanStripeEmail = normalizeEmail(stripeEmail);
  if (cleanStripeEmail) return cleanStripeEmail;

  if (customerId) {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted) {
      const customerEmail = normalizeEmail(customer.email);
      if (customerEmail) return customerEmail;
    }
  }

  return normalizeEmail(profileEmail);
}

async function retrieveInvoice(stripe: Stripe, invoiceId: string | null) {
  if (!invoiceId) return null;

  try {
    return await stripe.invoices.retrieve(invoiceId);
  } catch (error) {
    console.warn("stripe webhook: could not retrieve invoice", { invoiceId, error: safeErrorMessage(error) });
    return null;
  }
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

function isInitialSubscriptionInvoice(invoice: Stripe.Invoice) {
  const billingReason = String((invoice as Stripe.Invoice & { billing_reason?: string | null }).billing_reason || "");
  return billingReason === "subscription_create";
}

function getInvoiceReferences(invoice: Stripe.Invoice) {
  const invoiceWithReferences = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
    customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
  };

  return {
    subscriptionId: normalizeStripeId(invoiceWithReferences.subscription),
    customerId: normalizeStripeId(invoiceWithReferences.customer)
  };
}

function getInvoiceCustomerEmail(invoice: Stripe.Invoice) {
  const invoiceWithEmail = invoice as Stripe.Invoice & {
    customer_email?: string | null;
  };
  return invoiceWithEmail.customer_email || null;
}

function getInvoiceDocumentUrl(invoice?: Stripe.Invoice | null) {
  if (!invoice) return undefined;
  return invoice.hosted_invoice_url || invoice.invoice_pdf || undefined;
}

function getInvoiceBillingPeriod(invoice: Stripe.Invoice) {
  const line = invoice.lines.data.find((item) => item.price?.id) || invoice.lines.data[0];
  const period = line?.period;
  if (!period?.start || !period?.end) return "";
  return `${formatDate(stripeDate(period.start))} - ${formatDate(stripeDate(period.end))}`;
}

function getSubscriptionPeriodLabel(subscription: Stripe.Subscription) {
  const subscriptionWithPeriod = subscription as Stripe.Subscription & {
    current_period_start?: number | null;
    current_period_end?: number | null;
    ended_at?: number | null;
  };

  if (subscriptionWithPeriod.current_period_start && subscriptionWithPeriod.current_period_end) {
    return `${formatDate(stripeDate(subscriptionWithPeriod.current_period_start))} - ${formatDate(stripeDate(subscriptionWithPeriod.current_period_end))}`;
  }

  if (subscriptionWithPeriod.ended_at) return formatDate(stripeDate(subscriptionWithPeriod.ended_at));
  return "";
}

function getSubscriptionEndDate(subscription: Stripe.Subscription) {
  const subscriptionWithPeriod = subscription as Stripe.Subscription & {
    current_period_end?: number | null;
    ended_at?: number | null;
  };

  if (subscriptionWithPeriod.ended_at) return stripeDate(subscriptionWithPeriod.ended_at);
  if (subscriptionWithPeriod.current_period_end) return stripeDate(subscriptionWithPeriod.current_period_end);
  return new Date();
}

function getAccessStatusLabel(employer: EmployerProfile) {
  if (employer.candidate_access === true) return "Active";
  const status = String(employer.subscription_status || "").trim();
  if (status === "past_due") return "Payment past due";
  if (status === "canceled") return "Ended";
  return status ? status.replaceAll("_", " ") : "Inactive";
}

function formatMoney(amountInMinorUnits: number | null | undefined, currency: string | null | undefined) {
  if (!Number.isFinite(Number(amountInMinorUnits))) return "";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "CAD").toUpperCase()
  }).format(Number(amountInMinorUnits) / 100);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
}

function stripeDate(seconds: number | null | undefined) {
  return new Date(Number(seconds || Math.floor(Date.now() / 1000)) * 1000);
}

function buildAppUrl(path: string) {
  const base = (Deno.env.get("PLACELY_APP_URL") || "https://placelytalent.com").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function formatDetailValue(label: string, value: string) {
  const safeValue = escapeHtml(value || "Not available");
  if (/receipt|invoice/i.test(label) && /^https:\/\//i.test(value || "")) {
    return `<a href="${escapeAttribute(value)}" style="color:#1f6f4a;">Open in Stripe</a>`;
  }

  return safeValue;
}

function normalizeEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
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

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && String(error.code) === "23505");
}

function safeError(error: unknown) {
  if (error && typeof error === "object") {
    return {
      code: "code" in error ? String(error.code || "") : "",
      message: "message" in error ? String(error.message || "") : "",
      details: "details" in error ? String(error.details || "") : ""
    };
  }

  return { code: "", message: String(error || ""), details: "" };
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  if (typeof error === "string") return error.slice(0, 500);
  return "Unknown error";
}

function escapeHtml(value: string) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
