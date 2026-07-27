const candidateSupabase = window.PlacelyAuth.client();

const ROUTES = {
  login: "candidate-login.html",
  profile: "candidate-profile.html",
  messages: "candidate-messages.html",
  jobs: "../public/find-jobs.html?role=candidate",
  saved: "../public/saved-jobs.html",
  applications: "candidate-applications.html",
  settings: "candidate-settings.html",
  support: "candidate-support.html"
};

let currentUser = null;
let dashboardProfile = {};
let applications = [];
let conversations = [];
let suggestedJobs = [];
let suggestedEmployerProfiles = {};
let savedJobsCount = 0;
let unreadMessagesCount = 0;

document.addEventListener("DOMContentLoaded", initDashboard);

async function initDashboard() {
  bindStaticControls();

  try {
    const user = await verifyCandidateAccess(candidateSupabase, {
      loginPath: ROUTES.login,
      employerDashboardPath: "../employers/employer-dashboard.html"
    });

    if (!user) return;

    currentUser = user;

    await Promise.all([
      loadProfile(user),
      loadApplications(user.id),
      loadSavedCount(user.id),
      loadUnreadMessageCount(user.id),
      loadConversations(user.id),
      loadSuggestedJobs()
    ]);

    renderDashboard();
  } catch (error) {
    console.error("Candidate dashboard failed to load", error);
    showToast("We could not load the dashboard. Please refresh and try again.");
  } finally {
    revealDashboard();
  }
}

function bindStaticControls() {
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
  document.getElementById("accountMenuLogoutBtn")?.addEventListener("click", handleLogout);
  bindAccountMenu();
  bindMobileSidebar();
  bindDashboardSearch();
}

async function loadProfile(user) {
  const { data, error } = await candidateSupabase
    .from("candidate_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    await window.PlacelyAuth.clearAuthState();
    window.location.replace(ROUTES.login);
    return;
  }

  dashboardProfile = {
    ...data,
    email: data.email || user.email || ""
  };
}

async function loadApplications(userId) {
  const { data, error } = await candidateSupabase
    .from("applications")
    .select("*")
    .eq("candidate_id", userId)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: false });

  applications = error ? [] : data || [];
}

async function loadSavedCount(userId) {
  const { count, error } = await candidateSupabase
    .from("saved_jobs")
    .select("*", { count: "exact", head: true })
    .eq("candidate_id", userId);

  savedJobsCount = error ? 0 : count || 0;
}

async function loadUnreadMessageCount(userId) {
  const { count, error } = await candidateSupabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("candidate_id", userId)
    .eq("sender_type", "employer")
    .eq("read_by_candidate", false);

  unreadMessagesCount = error ? 0 : count || 0;
}

async function loadConversations(userId) {
  const { data, error } = await candidateSupabase
    .from("conversations")
    .select("*")
    .eq("candidate_id", userId)
    .order("created_at", { ascending: false })
    .limit(4);

  if (error) {
    conversations = [];
    return;
  }

  conversations = await Promise.all(
    (data || []).map(async (conversation) => {
      const employer = await getEmployerProfile(conversation.employer_id);

      return {
        ...conversation,
        employer_name:
          employer?.company_name ||
          conversation.employer_name ||
          conversation.company_name ||
          "Employer"
      };
    })
  );
}

async function getEmployerProfile(employerId) {
  if (!employerId) return null;

  const { data, error } = await candidateSupabase
    .from("public_employer_profiles")
    .select("id, company_name")
    .eq("id", employerId)
    .maybeSingle();

  return error ? null : data;
}

async function loadSuggestedJobs() {
  const { data, error } = await candidateSupabase
    .from("jobs")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(4);

  const jobsById = new Map();
  (error ? [] : data || []).forEach((job) => {
    if (job?.id && !jobsById.has(String(job.id))) {
      jobsById.set(String(job.id), normalizeJob(job));
    }
  });

  suggestedJobs = [...jobsById.values()];
  await loadSuggestedEmployerProfiles(suggestedJobs);
}

async function loadSuggestedEmployerProfiles(jobs) {
  const employerIds = [...new Set(jobs.map((job) => job.employer_id).filter(Boolean))];
  suggestedEmployerProfiles = {};
  if (!employerIds.length) return;

  const { data, error } = await candidateSupabase
    .from("public_employer_profiles")
    .select("id, company_name, company_logo_url")
    .in("id", employerIds);

  if (error) return;

  (data || []).forEach((profile) => {
    suggestedEmployerProfiles[String(profile.id)] = profile;
  });
}

function renderDashboard() {
  const profile = {
    ...dashboardProfile,
    email: dashboardProfile.email || currentUser?.email || ""
  };
  const fullName = profile.full_name || "Candidate";
  const firstName = fullName.split(" ")[0] || "Candidate";
  const interviewCount = applications.filter((app) => normalizeApplicationStatus(app.status) === "interview").length;
  const activeNotificationCount = applications.filter((app) =>
    ["reviewing", "interview", "offer"].includes(normalizeApplicationStatus(app.status))
  ).length;

  setText("dashboardGreeting", getGreeting());
  setText("dashboard_first_name", firstName);
  setText("topCandidateName", firstName);
  setText("accountMenuCandidateName", fullName);
  setText("accountMenuEmail", profile.email || "No email on file");
  setText("applications_count", applications.length);
  setText("interviews_count", interviewCount);
  setText("saved_jobs_count", savedJobsCount);
  setText("candidateMessagesCount", unreadMessagesCount);
  setText(
    "messages_subtext",
    unreadMessagesCount === 0
      ? "No unread messages"
      : unreadMessagesCount === 1
        ? "1 unread message"
        : `${unreadMessagesCount} unread messages`
  );

  renderAvatar(profile);
  renderUtilityBadges(unreadMessagesCount, activeNotificationCount);
  renderApplicationsTable();
  renderSuggestedJobs();
  renderActivity();
}

function renderAvatar(profile) {
  const avatar = document.getElementById("topCandidateAvatar");
  if (!avatar) return;

  const initials = getInitials(profile.full_name || profile.email || "Placely Talent");
  const photoUrl = resolveCandidatePhotoUrl(profile);

  avatar.textContent = initials;
  avatar.innerHTML = photoUrl
    ? `<img src="${escapeHTML(photoUrl)}" alt="" /><span class="avatar-fallback">${escapeHTML(initials)}</span>`
    : escapeHTML(initials);
}

function renderUtilityBadges(messageCount, notificationCount) {
  updateBadge("topUnreadBadge", messageCount);
  updateBadge("topNotificationBadge", notificationCount);
}

function renderActivity() {
  const container = document.getElementById("activityList");
  if (!container) return;

  const activity = [
    ...applications.slice(0, 3).map((app) => ({
      type: "Application",
      title: app.job_title || "Untitled Job",
      meta: `${app.company_name || "Company"} - ${getApplicationStatusLabel(normalizeApplicationStatus(app.status))}`,
      date: app.created_at,
      href: ROUTES.applications
    })),
    ...conversations.slice(0, 2).map((conversation) => ({
      type: "Message",
      title: conversation.employer_name || "Employer",
      meta: conversation.job_title || conversation.candidate_role || "Application conversation",
      date: conversation.updated_at || conversation.created_at,
      href: `${ROUTES.messages}?conversation=${encodeURIComponent(conversation.id)}`
    }))
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 5);

  if (!activity.length) {
    container.innerHTML = renderEmptyBlock("No recent activity", "Applications, messages, and interview updates will appear here.");
    return;
  }

  container.innerHTML = activity.map((item) => `
    <a class="activity-item" href="${escapeHTML(item.href)}">
      <span class="activity-dot" aria-hidden="true"></span>
      <span>
        <strong>${escapeHTML(item.title)}</strong>
        <small>${escapeHTML(item.type)} - ${escapeHTML(item.meta)} - ${escapeHTML(formatDate(item.date))}</small>
      </span>
    </a>
  `).join("");
}

function renderApplicationsTable() {
  const tbody = document.getElementById("applicationsTableBody");
  if (!tbody) return;

  if (!applications.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5">${renderEmptyBlock("No applications yet", "Find a role you like and your application will show here.")}</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = applications.slice(0, 5).map((app) => {
    const status = normalizeApplicationStatus(app.status);

    return `
      <tr>
        <td><strong>${escapeHTML(app.job_title || "Untitled Job")}</strong></td>
        <td>${escapeHTML(app.company_name || "Company")}</td>
        <td>${escapeHTML(formatDate(app.created_at))}</td>
        <td><span class="status-pill ${escapeHTML(status)}">${escapeHTML(getApplicationStatusLabel(status))}</span></td>
        <td><a class="table-action" href="${ROUTES.applications}">View</a></td>
      </tr>
    `;
  }).join("");
}

function renderSuggestedJobs() {
  const container = document.getElementById("suggestedJobs");
  if (!container) return;

  if (!suggestedJobs.length) {
    container.innerHTML = renderEmptyBlock("No suggested jobs yet", "Check back soon or browse all available roles.");
    return;
  }

  container.innerHTML = suggestedJobs.map((job) => {
    const jobUrl = `${ROUTES.jobs}&job=${encodeURIComponent(job.id)}`;
    const applyUrl = `../public/apply-job.html?job_id=${encodeURIComponent(job.id)}`;
    const employerProfile = suggestedEmployerProfiles[String(job.employer_id || "")] || {};
    const company = employerProfile.company_name || job.company;

    return `
      <article class="suggested-job-card">
        <div class="suggested-job-main">
          ${renderCompanyAvatar(getCompanyLogoUrl(employerProfile), company)}
          <div>
          <h3>${escapeHTML(job.title)}</h3>
          <p>${escapeHTML(company)} - ${escapeHTML(job.location)} - ${escapeHTML(job.type)}</p>
          <strong>${escapeHTML(job.pay)}</strong>
          </div>
        </div>
        <div class="suggested-job-actions">
          <a class="primary-btn compact" href="${applyUrl}">Quick Apply</a>
          <a class="secondary-btn compact" href="${jobUrl}">Save</a>
        </div>
      </article>
    `;
  }).join("");
}

function bindAccountMenu() {
  const button = document.getElementById("candidateAccountButton");
  const menu = document.getElementById("candidateAccountMenu");
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
  const toggle = document.getElementById("sidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");
  if (!toggle || !backdrop) return;

  const setSidebarOpen = (isOpen) => {
    document.body.classList.toggle("sidebar-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    backdrop.hidden = !isOpen;
  };

  toggle.addEventListener("click", () => {
    setSidebarOpen(!document.body.classList.contains("sidebar-open"));
  });

  backdrop.addEventListener("click", () => setSidebarOpen(false));

  document.querySelectorAll(".candidate-nav-link").forEach((link) => {
    link.addEventListener("click", () => setSidebarOpen(false));
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) setSidebarOpen(false);
  });
}

function bindDashboardSearch() {
  const form = document.getElementById("dashboardSearchForm");
  const input = document.getElementById("dashboardSearchInput");
  if (!form || !input) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    const url = new URL(ROUTES.jobs, window.location.href);
    if (query) url.searchParams.set("keyword", query);
    window.location.href = url.toString();
  });
}

function normalizeJob(job) {
  return {
    id: job.id,
    employer_id: job.employer_id,
    title: job.job_title || "Untitled Job",
    company: job.company_name || "Employer",
    location: job.location || "Location not listed",
    type: job.employment_type || "Employment type not listed",
    pay: window.PlacelyAuth.formatCompensationFromRecord(job) || "Pay not listed"
  };
}

function renderCompanyAvatar(logoUrl, companyName) {
  const initials = getInitials(companyName);

  if (logoUrl) {
    return `
      <div class="company-avatar">
        <img src="${escapeAttribute(logoUrl)}" alt="${escapeAttribute(companyName)} logo" loading="lazy" onerror="this.parentElement.textContent='${escapeAttribute(initials)}'">
      </div>
    `;
  }

  return `<div class="company-avatar">${escapeHTML(initials)}</div>`;
}

function getCompanyLogoUrl(source) {
  return window.PlacelyAuth?.resolveEmployerLogoUrl?.(
    window.PlacelyAuth.getPublicEmployerLogoValue(source),
    { supabase: candidateSupabase }
  ) || "";
}

function normalizeApplicationStatus(status) {
  const value = String(status || "submitted").toLowerCase().trim();

  if (["applied", "submitted", "new"].includes(value)) return "submitted";
  if (["review", "reviewing", "viewed", "in review"].includes(value)) return "reviewing";
  if (["interview", "interviewing", "interview requested"].includes(value)) return "interview";
  if (["offer", "offered"].includes(value)) return "offer";
  if (value === "hired") return "hired";
  if (["rejected", "declined"].includes(value)) return "rejected";

  return "submitted";
}

function getApplicationStatusLabel(status) {
  const labels = {
    submitted: "Applied",
    reviewing: "Reviewing",
    interview: "Interview",
    offer: "Offer",
    hired: "Hired",
    rejected: "Not selected"
  };

  return labels[status] || "Applied";
}

function resolveCandidatePhotoUrl(profile) {
  const rawUrl =
    profile.profile_photo_url ||
    profile.profile_photo ||
    profile.avatar_url ||
    profile.photo_url ||
    "";

  if (!rawUrl) return "";
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;

  return window.PlacelyAuth.getPublicImageUrl(candidateSupabase, "candidate-photos", rawUrl);
}

function getInitials(value) {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return "PT";
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatDate(value) {
  if (!value) return "Recently";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function renderEmptyBlock(title, text) {
  return `
    <div class="empty-state compact-empty">
      <strong>${escapeHTML(title)}</strong>
      <p>${escapeHTML(text)}</p>
    </div>
  `;
}

function updateBadge(id, value) {
  const badge = document.getElementById(id);
  if (!badge) return;

  const count = Number(value) || 0;
  badge.hidden = count <= 0;
  badge.textContent = count > 9 ? "9+" : String(count);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "";
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function revealDashboard() {
  document.documentElement.classList.remove("dashboard-booting");
}

async function handleLogout() {
  try {
    await window.PlacelyAuth.clearAuthState();
  } catch {
    sessionStorage.removeItem("placelyAuthGuardRedirecting");
  }

  window.location.replace(ROUTES.login);
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
