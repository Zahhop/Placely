const placelySupabase = window.employerSupabase;
const hiringRequestsEnabled = window.PLACELY_FEATURES?.hiringRequests !== false;

if (!hiringRequestsEnabled) {
  // Hiring Requests is dormant for Placely V1. Keep this page intact, but do not load data.
  window.location.replace("employer-dashboard.html");
}

if (hiringRequestsEnabled && !placelySupabase) {
  console.error("Employer Supabase client was not initialized.");
}

const hiringRequestForm = document.getElementById("hiringRequestForm");
const hiringRequestsPage = document.getElementById("hiringRequestsPage");
const submitHiringRequestBtn = document.getElementById("submitHiringRequestBtn");
const hiringRequestMessage = document.getElementById("hiringRequestMessage");
const pastRequestsList = document.getElementById("pastRequestsList");
const refreshRequestsBtn = document.getElementById("refreshRequestsBtn");

let currentUser = null;
let employerProfile = {};
let hiringRequests = [];
let hiringRequestSubmitting = false;

document.addEventListener("DOMContentLoaded", initHiringRequestsPage);

if (hiringRequestsEnabled) {
  hiringRequestForm?.addEventListener("submit", handleHiringRequestSubmit);
  refreshRequestsBtn?.addEventListener("click", () => loadPastRequests());
}

async function initHiringRequestsPage() {
  if (!hiringRequestsEnabled) return;

  if (hiringRequestsPage) hiringRequestsPage.hidden = false;

  currentUser = await verifyEmployerAccess(placelySupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });

  if (!currentUser) return;

  await loadEmployerProfile();
  prefillEmployerFields();
  await loadPastRequests();
}

async function loadEmployerProfile() {
  const { data, error } = await placelySupabase
    .from("employer_profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error("Employer profile lookup failed:", error);
    showHiringMessage("Could not load employer details. You can still complete the form.", "warning");
    return;
  }

  employerProfile = data || {};
}

function prefillEmployerFields() {
  setValue("companyName", employerProfile.company_name);
  setValue("contactName", employerProfile.contact_name);
  setValue("contactEmail", employerProfile.company_email || currentUser.email);
  setValue("phoneNumber", employerProfile.phone);
  setValue("location", employerProfile.company_location);
  setValue("payRange", employerProfile.pay_range);
}

async function handleHiringRequestSubmit(event) {
  event.preventDefault();

  if (hiringRequestSubmitting || !currentUser) return;

  const formData = getHiringRequestData();
  const validationError = validateHiringRequest(formData);

  if (validationError) {
    showHiringMessage(validationError, "error");
    return;
  }

  setHiringSubmitting(true);
  showHiringMessage("Submitting request...", "");

  const insertPayload = buildInsertPayload(formData);

  try {
    const savedRequest = await insertHiringRequest(insertPayload);

    let emailFailed = false;

    try {
      await sendHiringRequestEmail(savedRequest || insertPayload, formData);
    } catch (emailError) {
      emailFailed = true;
      console.error("Hiring request saved, but notification email failed:", emailError);
    }

    if (emailFailed) {
      showHiringMessage(
        "Request received. Placely's team will review your hiring needs and contact you using the information provided. The notification email could not be sent, but your request was saved.",
        "warning"
      );
    } else {
      showHiringMessage(
        "Request received. Placely's team will review your hiring needs and contact you using the information provided.",
        "success"
      );
    }

    resetRequestFields();
    prefillEmployerFields();
    await loadPastRequests();
  } catch (error) {
    console.error("Hiring request submission failed:", error);
    showHiringMessage(
      error?.message ? `Error submitting hiring request: ${error.message}` : "Error submitting hiring request.",
      "error"
    );
  } finally {
    setHiringSubmitting(false);
  }
}

function buildInsertPayload(data) {
  return {
    employer_id: currentUser.id,
    company_name: data.company_name,
    contact_name: data.contact_name,
    contact_email: data.contact_email,
    phone: data.phone,
    role_needed: data.role_needed,
    workers_needed: data.workers_needed ? Number(data.workers_needed) : null,
    location: data.location,
    employment_type: data.employment_type,
    pay_range: data.pay_range,
    start_timeline: data.hiring_timeline,
    required_skills: data.required_skills,
    additional_notes: buildStoredDetails(data),
    status: "submitted"
  };
}

async function insertHiringRequest(insertPayload) {
  const { data, error } = await placelySupabase
    .from("hiring_requests")
    .insert([insertPayload])
    .select("*")
    .single();

  if (!error) return data || insertPayload;

  if (!isMissingOptionalColumnError(error)) {
    throw error;
  }

  console.warn("Retrying hiring request insert with legacy hiring_requests columns:", error);

  const legacyPayload = {
    employer_id: insertPayload.employer_id,
    company_name: insertPayload.company_name,
    contact_name: insertPayload.contact_name,
    role_needed: insertPayload.role_needed,
    workers_needed: insertPayload.workers_needed,
    location: insertPayload.location,
    start_timeline: insertPayload.start_timeline,
    employment_type: insertPayload.employment_type,
    required_skills: insertPayload.required_skills,
    additional_notes: insertPayload.additional_notes,
    status: insertPayload.status
  };

  const { data: legacyData, error: legacyError } = await placelySupabase
    .from("hiring_requests")
    .insert([legacyPayload])
    .select("*")
    .single();

  if (!legacyError) {
    return {
      ...legacyPayload,
      ...legacyData,
      contact_email: insertPayload.contact_email,
      phone: insertPayload.phone,
      pay_range: insertPayload.pay_range
    };
  }

  if (!isMissingStatusColumnError(legacyError)) {
    throw legacyError;
  }

  const { status, ...minimalPayload } = legacyPayload;
  const { data: minimalData, error: minimalError } = await placelySupabase
    .from("hiring_requests")
    .insert([minimalPayload])
    .select("*")
    .single();

  if (minimalError) throw minimalError;

  return {
    ...minimalPayload,
    ...minimalData,
    status: "submitted",
    contact_email: insertPayload.contact_email,
    phone: insertPayload.phone,
    pay_range: insertPayload.pay_range
  };
}

async function sendHiringRequestEmail(savedRequest, formData) {
  await window.PlacelyEmail.send({
    supabaseClient: placelySupabase,
    formType: "hiring_request",
    payload: {
      company_name: savedRequest.company_name || formData.company_name,
      contact_name: savedRequest.contact_name || formData.contact_name,
      contact_email: savedRequest.contact_email || formData.contact_email,
      phone_number: savedRequest.phone || formData.phone,
      role_needed: savedRequest.role_needed || formData.role_needed,
      industry_trade:
        employerProfile.main_hiring_industry ||
        employerProfile.industry ||
        "",
      location: savedRequest.location || formData.location,
      number_of_hires: savedRequest.workers_needed || formData.workers_needed,
      hiring_timeline: savedRequest.start_timeline || formData.hiring_timeline,
      employment_type: savedRequest.employment_type || formData.employment_type,
      pay_range: savedRequest.pay_range || formData.pay_range,
      required_experience: savedRequest.required_skills || formData.required_skills,
      additional_details: buildEmailDetails(savedRequest, formData),
      employer_account_id: currentUser.id
    },
    cooldownKey: `hiring_request:${currentUser.id}:${savedRequest.id || Date.now()}`,
    cooldownMs: 0
  });
}

function buildEmailDetails(savedRequest, formData) {
  return [
    savedRequest.additional_notes || formData.additional_details
      ? `Additional details: ${savedRequest.additional_notes || formData.additional_details}`
      : "",
    savedRequest.id ? `Request ID: ${savedRequest.id}` : ""
  ].filter(Boolean).join("\n\n");
}

async function loadPastRequests() {
  if (!currentUser || !pastRequestsList) return;

  pastRequestsList.innerHTML = `
      <div class="empty-state">
        <strong>Loading previous requests...</strong>
        <p>Your saved consultation requests will appear here in a moment.</p>
    </div>
  `;

  let { data, error } = await placelySupabase
    .from("hiring_requests")
    .select("*")
    .eq("employer_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error && String(error.message || "").toLowerCase().includes("created_at")) {
    console.warn("hiring_requests.created_at is not available; loading previous requests without date ordering.", error);

    const fallback = await placelySupabase
      .from("hiring_requests")
      .select("*")
      .eq("employer_id", currentUser.id);

    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error("Could not load hiring requests:", error);
    pastRequestsList.innerHTML = `
      <div class="empty-state">
        <strong>Could not load requests</strong>
        <p>Refresh the page or try again in a moment.</p>
      </div>
    `;
    return;
  }

  hiringRequests = data || [];
  renderPastRequests();
}

function renderPastRequests() {
  if (!pastRequestsList) return;

  if (!hiringRequests.length) {
    pastRequestsList.innerHTML = `
      <div class="empty-state">
        <strong>No previous requests</strong>
        <p>Tell us what kind of people you need, and Placely will follow up to discuss how we may be able to help.</p>
      </div>
    `;
    return;
  }

  pastRequestsList.innerHTML = hiringRequests.map((request, index) => {
    const status = normalizeRequestStatus(request.status);

    return `
      <article class="request-card">
        <div class="request-card-top">
          <div>
            <h3>${escapeHTML(request.role_needed || "Hiring request")}</h3>
            <p class="request-meta">${escapeHTML(formatDate(request.created_at))}</p>
          </div>
          <span class="status-pill ${escapeHTML(status)}">${escapeHTML(getStatusLabel(status))}</span>
        </div>

        <div class="request-facts">
          <span>${escapeHTML(formatWorkers(request.workers_needed))}</span>
          <span>${escapeHTML(request.location || "Location not listed")}</span>
          <span>${escapeHTML(request.start_timeline || "Timeline not listed")}</span>
        </div>

      </article>
    `;
  }).join("");
}

function getHiringRequestData() {
  return {
    company_name: value("companyName"),
    contact_name: value("contactName"),
    contact_email: value("contactEmail"),
    phone: value("phoneNumber"),
    role_needed: value("roleNeeded"),
    workers_needed: value("workersNeeded"),
    location: value("location"),
    employment_type: value("employmentType"),
    pay_range: value("payRange"),
    hiring_timeline: value("startTimeline"),
    required_skills: value("requiredSkills"),
    additional_details: value("additionalDetails")
  };
}

function validateHiringRequest(data) {
  if (!data.company_name) return "Company name is required.";
  if (!data.contact_name) return "Contact name is required.";
  if (!isValidEmail(data.contact_email)) return "A valid contact email is required.";
  if (!data.role_needed) return "Role needed is required.";
  if (data.workers_needed && Number(data.workers_needed) < 1) {
    return "Number of workers must be at least 1.";
  }

  return "";
}

function resetRequestFields() {
  [
    "roleNeeded",
    "workersNeeded",
    "location",
    "employmentType",
    "payRange",
    "startTimeline",
    "requiredSkills",
    "additionalDetails"
  ].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.value = "";
  });

  const timeline = document.getElementById("startTimeline");
  if (timeline) timeline.value = "Immediately";
}

function buildStoredDetails(data) {
  return [
    data.contact_email ? `Contact email: ${data.contact_email}` : "",
    data.phone ? `Phone: ${data.phone}` : "",
    data.pay_range ? `Expected pay range: ${data.pay_range}` : "",
    data.required_skills ? `Required experience, tickets, certifications, or qualifications: ${data.required_skills}` : "",
    data.additional_details ? `Additional details: ${data.additional_details}` : ""
  ].filter(Boolean).join("\n\n");
}

function value(id) {
  return sanitizeForSubmission(document.getElementById(id)?.value || "");
}

function setValue(id, value) {
  const element = document.getElementById(id);

  if (element && !element.value) {
    element.value = value || "";
  }
}

function sanitizeForSubmission(value) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 4000);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function setHiringSubmitting(isSubmitting) {
  hiringRequestSubmitting = isSubmitting;

  if (submitHiringRequestBtn) {
    submitHiringRequestBtn.disabled = isSubmitting;
    submitHiringRequestBtn.textContent = isSubmitting ? "Submitting request..." : "Request a Consultation";
  }
}

function showHiringMessage(message, type) {
  if (!hiringRequestMessage) {
    alert(message);
    return;
  }

  hiringRequestMessage.textContent = message;
  hiringRequestMessage.className = `form-message ${type || ""}`.trim();
}

function normalizeRequestStatus(status) {
  const value = String(status || "submitted").toLowerCase().trim().replace(/\s+/g, "_");

  if (["new", "submitted", "review", "reviewing", "in_progress", "in-progress", "progress"].includes(value)) return "submitted";
  if (["contacted"].includes(value)) return "contacted";
  if (["closed", "complete", "completed"].includes(value)) return "closed";

  return "submitted";
}

function getStatusLabel(status) {
  const labels = {
    submitted: "Submitted",
    contacted: "Contacted",
    closed: "Closed"
  };

  return labels[status] || "Submitted";
}

function isMissingOptionalColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("contact_email") ||
    message.includes("phone") ||
    message.includes("pay_range") ||
    message.includes("column");
}

function isMissingStatusColumnError(error) {
  return String(error?.message || "").toLowerCase().includes("status");
}

function formatWorkers(value) {
  if (!value) return "Workers not listed";
  const count = Number(value);
  if (Number.isNaN(count)) return String(value);
  return `${count} worker${count === 1 ? "" : "s"}`;
}

function formatDate(value, includeTime = false) {
  if (!value) return "Date not listed";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not listed";

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {})
  });
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
