const resumeRequestsSupabase = window.PlacelyAuth.client();

let currentUser = null;
let currentProfile = null;
let resumeRequests = [];
let employersById = new Map();
let jobsById = new Map();
let activeFilter = "all";

document.addEventListener("DOMContentLoaded", initResumeRequestsPage);

async function initResumeRequestsPage() {
  setupShellControls();
  bindFilters();
  hydrateFilterFromUrl();

  try {
    currentUser = await verifyCandidateAccess(resumeRequestsSupabase, {
      loginPath: "candidate-login.html",
      employerDashboardPath: "../employers/employer-dashboard.html"
    });
    if (!currentUser) return;

    await Promise.all([
      loadCandidateIdentity(),
      loadHeaderCounts(currentUser.id),
      loadResumeRequests()
    ]);
    renderResumeRequests();
  } catch (error) {
    console.error("Candidate resume requests failed to load", {
      code: error?.code,
      message: error?.message
    });
    setStatus("We could not load resume requests. Please refresh and try again.");
  } finally {
    document.documentElement.classList.remove("resume-requests-booting", "auth-booting");
  }
}

async function loadCandidateIdentity() {
  const identity = await window.PlacelyAuth.loadCandidateIdentity(resumeRequestsSupabase, { user: currentUser });
  currentProfile = {
    ...identity.profile,
    full_name: identity.fullName,
    email: identity.email || currentUser?.email || "",
    profile_photo_url: identity.photoUrl
  };
  window.PlacelyAuth.updateCandidateHeader(identity);
}

async function loadHeaderCounts(userId) {
  const [unreadResult, applicationResult, resumeResult] = await Promise.all([
    resumeRequestsSupabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", userId)
      .eq("sender_type", "employer")
      .eq("read_by_candidate", false),
    resumeRequestsSupabase
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", userId)
      .in("status", ["reviewing", "interview", "offer"]),
    resumeRequestsSupabase
      .from("candidate_resume_requests")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", userId)
      .eq("status", "pending")
  ]);

  updateBadge("topUnreadBadge", unreadResult.count || 0);
  updateBadge("topNotificationBadge", (applicationResult.count || 0) + (resumeResult.count || 0));
  window.PlacelyCandidateSidebar?.updateResumeRequestCount(resumeResult.count || 0);
}

async function loadResumeRequests() {
  const { data, error } = await resumeRequestsSupabase
    .from("candidate_resume_requests")
    .select("id, candidate_id, employer_id, job_id, status, request_message, requested_at, responded_at, expires_at, revoked_at, created_at")
    .eq("candidate_id", currentUser.id)
    .order("requested_at", { ascending: false });

  if (error) throw error;
  resumeRequests = data || [];
  await Promise.all([
    loadEmployers(),
    loadJobs()
  ]);
}

async function loadEmployers() {
  const ids = [...new Set(resumeRequests.map((request) => request.employer_id).filter(Boolean))];
  employersById = new Map();
  if (!ids.length) return;

  const { data, error } = await resumeRequestsSupabase
    .from("employer_profiles")
    .select("id, company_name, company_logo_url, industry, main_hiring_industry, company_location, company_description, company_website, employment_type, pay_range, hiring_timeline")
    .in("id", ids);

  if (error) {
    console.warn("Resume requests employer lookup failed", {
      code: error?.code,
      message: error?.message
    });
    return;
  }

  employersById = new Map((data || []).map((employer) => [String(employer.id), employer]));
}

async function loadJobs() {
  const ids = [...new Set(resumeRequests.map((request) => request.job_id).filter(Boolean))];
  jobsById = new Map();
  if (!ids.length) return;

  const { data, error } = await resumeRequestsSupabase
    .from("jobs")
    .select("id, title, job_title, location")
    .in("id", ids);

  if (error) {
    console.warn("Resume requests job lookup failed", {
      code: error?.code,
      message: error?.message
    });
    return;
  }

  jobsById = new Map((data || []).map((job) => [String(job.id), job]));
}

function renderResumeRequests() {
  const list = document.getElementById("resumeRequestsList");
  if (!list) return;

  const filtered = resumeRequests.filter((request) => {
    const status = normalizeStatus(request.status, request);
    if (activeFilter === "pending") return status === "pending";
    if (activeFilter === "approved") return status === "approved";
    if (activeFilter === "history") return ["declined", "revoked", "expired"].includes(status);
    return true;
  });

  setStatus(filtered.length ? `${filtered.length} resume request${filtered.length === 1 ? "" : "s"}.` : "");
  if (!filtered.length) {
    list.innerHTML = `
      <div class="resume-request-empty">
        <h2>No resume requests</h2>
        <p>Employer resume requests will appear here. Your resume itself is managed from your Profile.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = filtered.map(renderRequestRow).join("");
  list.querySelectorAll("[data-resume-action]").forEach((button) => {
    button.addEventListener("click", () => reviewResumeRequest(button));
  });
}

function renderRequestRow(request) {
  const status = normalizeStatus(request.status, request);
  const employer = employersById.get(String(request.employer_id)) || {};
  const job = jobsById.get(String(request.job_id)) || {};
  const publicCompany = employer.id && window.PlacelyCompanies?.mapPublicCompany
    ? window.PlacelyCompanies.mapPublicCompany(employer, { supabase: resumeRequestsSupabase })
    : {};
  const companyName = publicCompany.company_name || employer.company_name || "Employer";
  const jobTitle = job.title || job.job_title || "";
  const companyUrl = getCompanyProfileUrl(employer);
  const companyMeta = [publicCompany.industry, publicCompany.company_location].filter(Boolean).join(" - ") || "Company profile";
  const requestMessage = request.request_message || `${companyName} requested access to your resume.`;
  const respondedLabel = request.responded_at ? formatDate(request.responded_at) : "";

  return `
    <article class="resume-request-row" data-request-id="${escapeAttribute(request.id)}">
      <div class="resume-request-company">
        ${renderEmployerLogo(publicCompany, companyName, companyUrl)}
        <div class="resume-request-company-copy">
          <a class="resume-request-company-link" href="${escapeAttribute(companyUrl)}" aria-label="View ${escapeAttribute(companyName)} company profile">${escapeHTML(companyName)}</a>
          <span>${escapeHTML(companyMeta)}</span>
          <small>Requested ${escapeHTML(formatDate(request.requested_at))}</small>
        </div>
      </div>

      <div class="resume-request-main">
        <div class="resume-request-heading">
          <h2>Resume access requested</h2>
          <span class="resume-request-status-pill ${escapeAttribute(status)}">${escapeHTML(getStatusLabel(status))}</span>
        </div>
        <p class="resume-request-message">${escapeHTML(requestMessage)}</p>
        <div class="resume-request-meta">
          ${jobTitle ? `<strong>${escapeHTML(jobTitle)}</strong>${job.location ? ` &middot; ${escapeHTML(job.location)}` : ""}` : "No related job selected"}
          ${request.expires_at && status === "approved" ? ` &middot; Access expires ${escapeHTML(formatDate(request.expires_at))}` : ""}
        </div>
      </div>

      <div class="resume-request-actions">
        ${renderActions(request, status, respondedLabel)}
      </div>
    </article>
  `;
}

function getCompanyProfileUrl(employer) {
  if (!employer?.id || !window.PlacelyCompanies?.buildCompanyProfileUrl) return "#";
  return window.PlacelyCompanies.buildCompanyProfileUrl(employer, {
    source: "resume-requests",
    returnTo: getResumeRequestsReturnPath()
  });
}

function getResumeRequestsReturnPath() {
  const url = new URL("candidates/candidate-resume-requests.html", window.location.origin);
  if (["all", "pending", "approved", "history"].includes(activeFilter)) {
    url.searchParams.set("resume_filter", activeFilter);
  }
  return `${url.pathname}${url.search}`;
}

function renderEmployerLogo(employer, companyName, companyUrl) {
  const initials = getInitials(companyName || "Employer");
  if (window.PlacelyCompanies?.renderCompanyAvatar && employer?.id) {
    return `
      <a class="resume-request-logo-link" href="${escapeAttribute(companyUrl)}" aria-label="View ${escapeAttribute(companyName)} company profile">
        ${window.PlacelyCompanies.renderCompanyAvatar(employer)}
      </a>
    `;
  }
  return `<a class="resume-request-logo" href="${escapeAttribute(companyUrl)}" aria-label="View ${escapeAttribute(companyName)} company profile">${escapeHTML(initials)}</a>`;
}

function renderActions(request, status, respondedLabel = "") {
  if (status === "pending") {
    return `
      <button type="button" class="secondary-btn" data-resume-action="decline" data-request-id="${escapeAttribute(request.id)}">Decline</button>
      <button type="button" class="primary-btn" data-resume-action="approve" data-request-id="${escapeAttribute(request.id)}">Approve Request</button>
    `;
  }

  if (status === "approved") {
    return `
      <span class="resume-request-action-note approved">Approved${respondedLabel ? ` ${escapeHTML(respondedLabel)}` : ""}</span>
      <button type="button" class="secondary-btn" data-resume-action="revoke" data-request-id="${escapeAttribute(request.id)}">Revoke Access</button>
    `;
  }

  if (status === "declined") {
    return `<span class="resume-request-action-note declined">Declined${respondedLabel ? ` ${escapeHTML(respondedLabel)}` : ""}</span>`;
  }

  return `<span class="resume-request-meta">No action available</span>`;
}

async function reviewResumeRequest(button) {
  const requestId = button.dataset.requestId;
  const action = button.dataset.resumeAction;
  if (!requestId || !["approve", "decline", "revoke"].includes(action)) return;

  if (action === "revoke" && !window.confirm("Revoke this employer's access to your resume?")) return;

  const row = button.closest("[data-request-id]");
  row?.querySelectorAll("button").forEach((item) => {
    item.disabled = true;
  });

  try {
    const { data, error } = await resumeRequestsSupabase.functions.invoke("review-candidate-resume-access", {
      body: { requestId, action }
    });

    if (error || !data?.request) {
      const message = await readFunctionError(error);
      throw new Error(message || data?.error || "Could not update the resume request.");
    }

    await Promise.all([
      loadResumeRequests(),
      loadHeaderCounts(currentUser.id)
    ]);
    renderResumeRequests();
    showToast(getActionSuccess(action));
  } catch (error) {
    console.error("Candidate resume request review failed", {
      message: error?.message
    });
    showToast(error?.message || "Could not update the resume request.");
    row?.querySelectorAll("button").forEach((item) => {
      item.disabled = false;
    });
  }
}

function bindFilters() {
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter || "all";
      document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
      updateResumeFilterUrl();
      renderResumeRequests();
    });
  });
}

function hydrateFilterFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const filter = params.get("resume_filter");
  if (!["all", "pending", "approved", "history"].includes(filter)) return;

  activeFilter = filter;
  document.querySelectorAll("[data-filter]").forEach((item) => {
    item.classList.toggle("active", item.dataset.filter === activeFilter);
  });
}

function updateResumeFilterUrl() {
  const url = new URL(window.location.href);
  if (["all", "pending", "approved", "history"].includes(activeFilter) && activeFilter !== "all") {
    url.searchParams.set("resume_filter", activeFilter);
  } else {
    url.searchParams.delete("resume_filter");
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function setupShellControls() {
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
  document.getElementById("accountMenuLogoutBtn")?.addEventListener("click", handleLogout);
  bindAccountMenu();
  bindMobileSidebar();
  document.getElementById("resumeRequestsSearchForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = document.getElementById("resumeRequestsSearchInput")?.value?.trim();
    const url = new URL("../public/find-jobs.html?role=candidate", window.location.href);
    if (query) url.searchParams.set("keyword", query);
    window.location.href = url.toString();
  });
}

async function handleLogout() {
  await window.PlacelyAuth.clearAuthState();
  window.location.replace("candidate-login.html");
}

function bindAccountMenu() {
  const button = document.getElementById("candidateAccountButton");
  const menu = document.getElementById("candidateAccountMenu");
  if (!button || !menu) return;

  const closeMenu = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
    button.setAttribute("aria-expanded", String(!menu.hidden));
  });
  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest("a")) closeMenu();
  });
  document.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
}

function bindMobileSidebar() {
  const toggle = document.getElementById("sidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");
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

function normalizeStatus(status, request = {}) {
  const value = String(status || "").toLowerCase().trim();
  if (value === "approved") {
    if (request.revoked_at) return "revoked";
    if (request.expires_at && new Date(request.expires_at).getTime() <= Date.now()) return "expired";
  }
  return ["pending", "approved", "declined", "revoked", "expired"].includes(value) ? value : "pending";
}

function getInitials(value) {
  return String(value || "Employer")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "E";
}

function getStatusLabel(status) {
  return {
    pending: "Pending",
    approved: "Approved",
    declined: "Declined",
    revoked: "Revoked",
    expired: "Expired"
  }[status] || "Pending";
}

function getActionSuccess(action) {
  if (action === "approve") return "Resume access approved.";
  if (action === "decline") return "Resume access declined.";
  if (action === "revoke") return "Resume access revoked.";
  return "Resume request updated.";
}

function updateBadge(id, count) {
  const badge = document.getElementById(id);
  if (!badge) return;
  const value = Number(count || 0);
  badge.hidden = value <= 0;
  badge.textContent = value > 9 ? "9+" : String(value);
}

function setStatus(message) {
  const status = document.getElementById("resumeRequestsStatus");
  if (status) status.textContent = message || "";
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

async function readFunctionError(error) {
  const response = error?.context;
  if (!response) return error?.message || "";
  try {
    const payload = await response.clone().json();
    return payload?.error || error?.message || "";
  } catch {
    return error?.message || "";
  }
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) {
    alert(message);
    return;
  }
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHTML(value).replaceAll("`", "&#096;");
}
