const supportSupabase = window.employerSupabase;

const supportForm = document.getElementById("supportForm");
const categoryInput = document.getElementById("supportCategory");
const subjectInput = document.getElementById("supportSubject");
const descriptionInput = document.getElementById("supportDescription");
const replyEmailInput = document.getElementById("replyEmail");
const sourcePageInput = document.getElementById("sourcePage");
const supportMessage = document.getElementById("supportMessage");
const sendSupportBtn = document.getElementById("sendSupportBtn");

const categories = new Set([
  "Account or login",
  "Billing or Candidate Access",
  "Job posting",
  "Candidates or saved talent",
  "Applications",
  "Messaging",
  "Company profile",
  "Technical issue",
  "Feedback or feature request",
  "Other"
]);

let currentUser = null;
let currentProfile = {};
let isSubmittingSupport = false;

document.addEventListener("DOMContentLoaded", initSupportPage);

async function initSupportPage() {
  currentUser = await verifyEmployerAccess(supportSupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });

  if (!currentUser) return;

  await loadEmployerProfile();
  setupSidebar();
  setupForm();
}

async function loadEmployerProfile() {
  const { data, error } = await supportSupabase
    .from("employer_profiles")
    .select("id, company_name, company_email")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error || !data) {
    currentProfile = {};
  } else {
    currentProfile = data;
  }

  const replyEmail = currentProfile.company_email || currentUser.email || "";
  if (replyEmailInput) replyEmailInput.value = replyEmail;
  setText("sidebarCompanyName", currentProfile.company_name || "Employer");
}

function setupForm() {
  if (sourcePageInput) sourcePageInput.value = getSourcePage();
  supportForm?.addEventListener("submit", submitSupportRequest);

  [categoryInput, subjectInput, descriptionInput, replyEmailInput].forEach((field) => {
    field?.addEventListener("input", () => setMessage(""));
    field?.addEventListener("change", () => setMessage(""));
  });
}

async function submitSupportRequest(event) {
  event.preventDefault();
  setMessage("");

  if (isSubmittingSupport) return;

  const payload = getSupportPayload();
  const validation = validateSupportPayload(payload);

  if (validation) {
    setMessage(validation);
    return;
  }

  isSubmittingSupport = true;
  const originalText = sendSupportBtn?.textContent || "Send Support Request";
  if (sendSupportBtn) {
    sendSupportBtn.disabled = true;
    sendSupportBtn.textContent = "Sending...";
  }

  try {
    const { error } = await supportSupabase.functions.invoke("send-support-request", {
      body: payload
    });

    if (error) throw error;

    setMessage(`Your support request has been sent. We'll get back to you at ${payload.reply_email}.`, "success");
    supportForm.reset();
    replyEmailInput.value = payload.reply_email;
    sourcePageInput.value = payload.source_page;
  } catch {
    setMessage("We could not send your support request. Please try again.");
  } finally {
    isSubmittingSupport = false;
    if (sendSupportBtn) {
      sendSupportBtn.disabled = false;
      sendSupportBtn.textContent = originalText;
    }
  }
}

function getSupportPayload() {
  return {
    category: clean(categoryInput?.value),
    subject: clean(subjectInput?.value),
    description: clean(descriptionInput?.value),
    reply_email: clean(replyEmailInput?.value),
    source_page: clean(sourcePageInput?.value)
  };
}

function validateSupportPayload(payload) {
  if (!categories.has(payload.category)) return "Choose a support category.";
  if (payload.subject.length < 5 || payload.subject.length > 120) return "Subject must be 5 to 120 characters.";
  if (payload.description.length < 20 || payload.description.length > 5000) return "Description must be 20 to 5000 characters.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.reply_email)) return "Enter a valid reply email.";
  return "";
}

function getSourcePage() {
  const params = new URLSearchParams(window.location.search);
  const source = params.get("from") || document.referrer || "";

  if (!source) return "";

  try {
    const url = new URL(source, window.location.origin);
    url.search = "";
    url.hash = "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return clean(source).split("?")[0].split("#")[0];
  }
}

function setupSidebar() {
  const body = document.body;
  const toggle = document.getElementById("sidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");
  const sidebar = document.getElementById("dashboardSidebar");

  function closeSidebar() {
    body.classList.remove("sidebar-open");
    toggle?.setAttribute("aria-expanded", "false");
    if (backdrop) backdrop.hidden = true;
  }

  toggle?.addEventListener("click", () => {
    const opening = !body.classList.contains("sidebar-open");
    body.classList.toggle("sidebar-open", opening);
    toggle.setAttribute("aria-expanded", String(opening));
    if (backdrop) backdrop.hidden = !opening;
  });

  backdrop?.addEventListener("click", closeSidebar);
  sidebar?.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeSidebar();
  });
}

function setMessage(message, type = "error") {
  if (!supportMessage) return;

  supportMessage.textContent = message;
  supportMessage.classList.toggle("success", type === "success");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value || "";
}

function clean(value) {
  return String(value || "").trim();
}
