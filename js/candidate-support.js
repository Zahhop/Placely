const supportSupabase = window.PlacelyAuth.client();

let currentUser = null;
let currentProfile = null;
let isSubmittingSupport = false;

const supportCategories = new Set([
  "Account or login",
  "Job search",
  "Applications",
  "Saved jobs",
  "Messaging",
  "Profile or resume",
  "Employer contact",
  "Technical issue",
  "Feedback or feature request",
  "Other"
]);

const supportSearchForm = getEl("supportSearchForm");
const supportSearchInput = getEl("supportSearchInput");

function getEl(id) {
  return document.getElementById(id);
}

async function initSupportPage() {
  setupShellControls();

  try {
    currentUser = await verifyCandidateAccess(supportSupabase, {
      loginPath: "candidate-login.html",
      employerDashboardPath: "../employers/employer-dashboard.html"
    });

    if (!currentUser) return;

    setupSupportForm();
    await Promise.all([
      loadCandidateProfile(),
      loadHeaderCounts(currentUser.id)
    ]);
    prefillSupportFields();
  } catch (error) {
    console.error("Candidate support failed to load", {
      code: error?.code,
      message: error?.message
    });
    showSupportMessage("We could not load support right now. Please refresh and try again.", "error");
  } finally {
    revealSupport();
  }
}

async function loadCandidateProfile() {
  const identity = await window.PlacelyAuth.loadCandidateIdentity(supportSupabase, { user: currentUser });
  currentProfile = {
    ...identity.profile,
    full_name: identity.fullName,
    email: identity.email || currentUser?.email || "",
    profile_photo_url: identity.photoUrl
  };
  window.PlacelyAuth.updateCandidateHeader(identity);
}

async function loadHeaderCounts(userId) {
  const [{ count: unreadCount }, { count: notificationCount }] = await Promise.all([
    supportSupabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", userId)
      .eq("sender_type", "employer")
      .eq("read_by_candidate", false),
    supportSupabase
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", userId)
      .in("status", ["reviewing", "interview", "offer"])
  ]);

  updateBadge("topUnreadBadge", unreadCount || 0);
  updateBadge("topNotificationBadge", notificationCount || 0);
}

function setupSupportForm() {
  getEl("supportForm")?.addEventListener("submit", handleSupportSubmit);
}

function prefillSupportFields() {
  const replyEmail = getEl("replyEmail");
  const sourcePage = getEl("sourcePage");

  if (replyEmail && !replyEmail.value.trim()) {
    replyEmail.value = currentProfile?.email || currentUser?.email || "";
  }

  if (sourcePage) {
    sourcePage.value = getSourcePage();
  }
}

async function handleSupportSubmit(event) {
  event.preventDefault();

  if (isSubmittingSupport) return;

  const payload = getSupportPayload();
  const validationError = validateSupportPayload(payload);
  if (validationError) {
    showSupportMessage(validationError, "error");
    return;
  }

  setSupportSubmitting(true);
  showSupportMessage("Sending your support request...", "");

  try {
    const { error } = await supportSupabase.functions.invoke("send-support-request", {
      body: {
        category: payload.category,
        subject: payload.subject,
        description: payload.description,
        reply_email: payload.replyEmail,
        source_page: payload.sourcePage
      }
    });

    if (error) throw error;

    const subjectInput = getEl("supportSubject");
    const descriptionInput = getEl("supportDescription");
    const categoryInput = getEl("supportCategory");

    if (subjectInput) subjectInput.value = "";
    if (descriptionInput) descriptionInput.value = "";
    if (categoryInput) categoryInput.value = "";
    getEl("returnDashboardBtn")?.removeAttribute("hidden");
    showSupportMessage(`Your support request has been sent. We'll get back to you at ${payload.replyEmail}.`, "success");
  } catch (error) {
    console.error("Candidate support request failed", {
      status: error?.status,
      message: error?.message
    });
    showSupportMessage(getFriendlySupportError(error), "error");
  } finally {
    setSupportSubmitting(false);
  }
}

function getSupportPayload() {
  return {
    category: getEl("supportCategory")?.value.trim() || "",
    subject: getEl("supportSubject")?.value.trim() || "",
    description: getEl("supportDescription")?.value.trim() || "",
    replyEmail: getEl("replyEmail")?.value.trim() || "",
    sourcePage: getEl("sourcePage")?.value.trim() || getSourcePage()
  };
}

function validateSupportPayload(payload) {
  if (!currentUser) return "Please log in before sending a support request.";
  if (!supportCategories.has(payload.category)) return "Choose a support category.";
  if (payload.subject.length < 5 || payload.subject.length > 120) return "Subject must be 5 to 120 characters.";
  if (payload.description.length < 20 || payload.description.length > 5000) return "Description must be 20 to 5000 characters.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.replyEmail)) return "Enter a valid reply email.";
  return "";
}

function getFriendlySupportError(error) {
  const status = Number(error?.status || error?.context?.status || 0);

  if (status === 401) return "Your session expired. Please log in and try again.";
  if (status === 403) return "This support form is only available to verified candidate accounts.";
  if (status === 409) return "We could not verify your candidate profile. Please refresh and try again.";
  if (status === 429) return "Please wait a moment before sending another support request.";
  if (status === 400) return "Please check the form and try again.";

  return "We could not send your request right now. Please try again.";
}

function setSupportSubmitting(isSubmitting) {
  isSubmittingSupport = isSubmitting;
  const button = getEl("sendSupportBtn");

  if (!button) return;
  button.disabled = isSubmitting;
  button.textContent = isSubmitting ? "Sending..." : "Send Support Request";
}

function showSupportMessage(message, tone) {
  const messageEl = getEl("supportMessage");
  if (!messageEl) return;

  messageEl.textContent = message || "";
  messageEl.classList.toggle("error", tone === "error");
  messageEl.classList.toggle("success", tone === "success");
}

function getSourcePage() {
  const params = new URLSearchParams(window.location.search);
  const fromParam = sanitizeSourcePage(params.get("from"));
  if (fromParam) return fromParam;

  const referrer = sanitizeSourcePage(document.referrer);
  if (referrer) return referrer;

  return sanitizeSourcePage(window.location.href);
}

function sanitizeSourcePage(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw, window.location.origin);
    url.search = "";
    url.hash = "";
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return raw.split("?")[0].split("#")[0].slice(0, 500);
  }
}

function setupShellControls() {
  getEl("logoutBtn")?.addEventListener("click", handleLogout);
  getEl("accountMenuLogoutBtn")?.addEventListener("click", handleLogout);
  bindAccountMenu();
  bindMobileSidebar();
  bindHeaderSearch();
}

function bindAccountMenu() {
  const button = getEl("candidateAccountButton");
  const menu = getEl("candidateAccountMenu");
  if (!button || !menu) return;

  const closeMenu = ({ restoreFocus = false } = {}) => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus) button.focus();
  };

  const openMenu = () => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    menu.querySelector("[role='menuitem']")?.focus();
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("click", (event) => {
    if (!menu.hidden && !event.target.closest(".top-account-menu-wrap")) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) closeMenu({ restoreFocus: true });
  });
}

function bindMobileSidebar() {
  const toggle = getEl("sidebarToggle");
  const backdrop = getEl("sidebarBackdrop");
  if (!toggle || !backdrop) return;

  const setSidebarOpen = (isOpen) => {
    document.body.classList.toggle("sidebar-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    backdrop.hidden = !isOpen;
  };

  toggle.addEventListener("click", () => setSidebarOpen(!document.body.classList.contains("sidebar-open")));
  backdrop.addEventListener("click", () => setSidebarOpen(false));

  document.querySelectorAll(".candidate-nav-link").forEach((link) => {
    link.addEventListener("click", () => setSidebarOpen(false));
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) setSidebarOpen(false);
  });
}

function bindHeaderSearch() {
  if (!supportSearchForm || !supportSearchInput) return;

  supportSearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = supportSearchInput.value.trim();
    const url = new URL("../public/find-jobs.html?role=candidate", window.location.href);
    if (query) url.searchParams.set("keyword", query);
    window.location.href = url.toString();
  });
}

function updateBadge(id, value) {
  const badge = getEl(id);
  if (!badge) return;

  const count = Number(value) || 0;
  badge.hidden = count <= 0;
  badge.textContent = count > 9 ? "9+" : String(count);
}

async function handleLogout() {
  try {
    await window.PlacelyAuth.clearAuthState();
  } catch {
    sessionStorage.removeItem("placelyAuthGuardRedirecting");
  }

  window.location.replace("candidate-login.html");
}

function revealSupport() {
  document.documentElement.classList.remove("support-booting");
}

document.addEventListener("DOMContentLoaded", initSupportPage);
