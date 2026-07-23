const supabaseClient = window.employerSupabase;

const JOBS_TABLE = "jobs";

const jobsGrid = document.getElementById("jobsGrid");
const emptyState = document.getElementById("emptyState");

const activeJobsCount = document.getElementById("activeJobsCount");
const pausedJobsCount = document.getElementById("pausedJobsCount");
const applicationsCount = document.getElementById("applicationsCount");
const reviewCount = document.getElementById("reviewCount");
const interviewsCount = document.getElementById("interviewsCount");

const filterButtons = document.querySelectorAll(".filter-btn");
const jobSearchInput = document.getElementById("jobSearchInput");
const jobSortSelect = document.getElementById("jobSortSelect");
const logoutBtn = document.getElementById("logoutBtn");
const boostModal = document.getElementById("boostModal");
const boostCloseBtn = document.getElementById("boostCloseBtn");
const boostCancelBtn = document.getElementById("boostCancelBtn");
const boostCheckoutBtn = document.getElementById("boostCheckoutBtn");
const boostDurationOptions = document.getElementById("boostDurationOptions");
const boostBudgetOptions = document.getElementById("boostBudgetOptions");
const boostModalMessage = document.getElementById("boostModalMessage");
const boostConfigurePanel = document.getElementById("boostConfigurePanel");
const boostManagePanel = document.getElementById("boostManagePanel");

const BOOST_DURATIONS = [3, 7, 14, 30];
const BOOST_BUDGETS = [2500, 5000, 10000, 20000];
const JOB_BOOSTS_ENABLED = window.PLACELY_FEATURES?.jobBoosts === true;

let allJobs = [];
let applicationCountsByJob = {};
let reviewCountsByJob = {};
let interviewCountsByJob = {};
let activeBoostsByJob = {};
let currentFilter = "all";
let currentUserId = null;
let selectedBoostJob = null;
let selectedDurationDays = null;
let selectedBudgetCents = null;
let isCreatingBoostCheckout = false;

document.addEventListener("DOMContentLoaded", initManageJobs);

async function initManageJobs() {
  setupHeaderButtons();
  setupLogout();
  setupFilters();
  setupSearchAndSort();
  if (JOB_BOOSTS_ENABLED) setupBoostModal();
  setupDashboardShell();

  const user = await requireEmployerLogin();
  if (!user) return;

  currentUserId = user.id;
  if (JOB_BOOSTS_ENABLED) await handleBoostReturnState();
  else cleanBoostQueryParams();
  await loadEmployerJobs(user.id);
}

function setupHeaderButtons() {
  const routes = {
    Jobs: "manage-jobs.html",
    Applicants: "employer-applicants.html",
    Candidates: "find-candidates.html",
    "Saved Talent": "saved-talent.html",
    Messages: "employer-messages.html",
    Company: "employer-profile.html"
  };

  document.querySelectorAll("nav a").forEach((link) => {
    const label = link.textContent.trim();

    if (routes[label]) {
      link.href = routes[label];
    }
  });
}

async function requireEmployerLogin() {
  return verifyEmployerAccess(supabaseClient, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });
}

async function loadEmployerJobs(userId) {
  const { data, error } = await supabaseClient
    .from(JOBS_TABLE)
    .select("*")
    .eq("employer_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    allJobs = [];
    renderJobs();
    updateStats();
    return;
  }

  allJobs = data || [];
  await Promise.all([
    loadApplicationCounts(userId),
    loadActiveBoosts(userId)
  ]);

  renderJobs();
  updateStats();
}

async function loadActiveBoosts(userId) {
  if (!JOB_BOOSTS_ENABLED) {
    activeBoostsByJob = {};
    return;
  }

  const { data, error } = await supabaseClient
    .from("job_boosts")
    .select("id, job_id, employer_id, status, budget_cents, currency, duration_days, starts_at, ends_at, stripe_checkout_session_id")
    .eq("employer_id", userId)
    .eq("status", "active")
    .gt("ends_at", new Date().toISOString());

  if (error) {
    activeBoostsByJob = {};
    return;
  }

  activeBoostsByJob = {};
  (data || []).forEach((boost) => {
    if (boost.job_id) activeBoostsByJob[String(boost.job_id)] = boost;
  });
}

async function loadApplicationCounts(userId) {
  const { data, error } = await supabaseClient
    .from("applications")
    .select("job_id, status")
    .eq("employer_id", userId);

  if (error) {
    applicationCountsByJob = {};
    reviewCountsByJob = {};
    interviewCountsByJob = {};
    return;
  }

  applicationCountsByJob = {};
  reviewCountsByJob = {};
  interviewCountsByJob = {};

  (data || []).forEach((application) => {
    const jobId = String(application.job_id || "");
    if (!jobId) return;

    applicationCountsByJob[jobId] = (applicationCountsByJob[jobId] || 0) + 1;

    const status = String(application.status || "submitted").toLowerCase();

    if (["new", "submitted", "applied"].includes(status)) {
      reviewCountsByJob[jobId] = (reviewCountsByJob[jobId] || 0) + 1;
    }

    if (["interview", "interviewing", "scheduled"].includes(status)) {
      interviewCountsByJob[jobId] = (interviewCountsByJob[jobId] || 0) + 1;
    }
  });
}

function renderJobs() {
  if (!jobsGrid) return;

  jobsGrid.innerHTML = "";

  const search = jobSearchInput?.value?.toLowerCase().trim() || "";
  const sort = jobSortSelect?.value || "newest";

  const visibleJobs = allJobs
    .filter((job) => {
      const status = normalizeStatus(job.status);
      const matchesFilter = currentFilter === "all" || status === currentFilter;
      const matchesSearch =
        !search ||
        [
          job.job_title,
          job.company_name,
          job.location,
          job.employment_type,
          window.PlacelyAuth.formatCompensationFromRecord(job, ""),
          job.pay_range,
          job.experience_level,
          job.job_description,
          job.required_skills
        ]
          .join(" ")
          .toLowerCase()
          .includes(search);

      return matchesFilter && matchesSearch;
    })
    .sort((a, b) => {
      if (sort === "oldest") {
        return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      }

      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

  if (!visibleJobs.length) {
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");

  visibleJobs.forEach((job) => {
    jobsGrid.appendChild(createJobCard(job));
  });
}

function createJobCard(job) {
  const card = document.createElement("article");
  card.className = "job-card";

  const title = job.job_title || "Untitled job";
  const company = job.company_name || "Placely Talent";
  const location = job.location || "Location not listed";
  const type = job.employment_type || "Employment type not listed";
  const pay = window.PlacelyAuth.formatCompensationFromRecord(job);
  const experience = job.experience_level || "Experience not listed";
  const description = job.job_description || "No job description added yet.";
  const skills = parseSkills(job.required_skills);
  const status = normalizeStatus(job.status);
  const posted = formatDate(job.created_at);
  const applicationCount = applicationCountsByJob[String(job.id)] || 0;
  const activeBoost = JOB_BOOSTS_ENABLED ? activeBoostsByJob[String(job.id)] || null : null;
  const boostButtonLabel = activeBoost ? "Manage Boost" : "Boost Job";

  card.innerHTML = `
    <div class="job-main">
      <div class="job-title-row">
        <h3>${escapeHTML(title)}</h3>
        <span class="status ${status}">${escapeHTML(capitalize(status))}</span>
        ${activeBoost ? `<span class="status boosted">Boosted</span>` : ""}
      </div>
      <p class="job-company">${escapeHTML(company)}</p>
    </div>

    <div class="job-detail-grid">
      <div class="job-detail">
        <span>Location</span>
        <strong>${escapeHTML(location)}</strong>
      </div>
      <div class="job-detail">
        <span>Employment type</span>
        <strong>${escapeHTML(type)}</strong>
      </div>
      <div class="job-detail">
        <span>Pay</span>
        <strong>${escapeHTML(pay)}</strong>
      </div>
      <div class="job-detail">
        <span>Experience</span>
        <strong>${escapeHTML(experience)}</strong>
      </div>
    </div>

    <div class="job-activity">
      <p class="posted-date">${escapeHTML(posted)}</p>
      <strong class="applicant-count">${applicationCount} applicant${applicationCount === 1 ? "" : "s"}</strong>
      ${activeBoost ? `<span class="boost-remaining">${escapeHTML(formatBoostRemaining(activeBoost.ends_at))}</span>` : ""}
    </div>

    <div class="job-actions">
      ${JOB_BOOSTS_ENABLED ? `<button class="secondary boost-job-btn" type="button" data-job-id="${escapeHTML(job.id)}">${escapeHTML(boostButtonLabel)}</button>` : ""}
      <a class="primary" href="employer-applicants.html?job=${encodeURIComponent(job.id)}">Applicants</a>
      <a class="secondary" href="edit-jobs.html?id=${encodeURIComponent(job.id)}">Edit</a>
    </div>
  `;

  const boostButton = card.querySelector(".boost-job-btn");

  if (boostButton) {
    boostButton.addEventListener("click", () => {
      openBoostModal(job);
    });
  }

  return card;
}

function updateStats() {
  const activeJobs = allJobs.filter((job) => normalizeStatus(job.status) === "active");
  const pausedJobs = allJobs.filter((job) => normalizeStatus(job.status) === "paused");

  if (activeJobsCount) activeJobsCount.textContent = activeJobs.length;
  if (pausedJobsCount) pausedJobsCount.textContent = pausedJobs.length;

  if (applicationsCount) {
    applicationsCount.textContent = Object.values(applicationCountsByJob)
      .reduce((sum, count) => sum + count, 0);
  }

  if (reviewCount) {
    reviewCount.textContent = Object.values(reviewCountsByJob)
      .reduce((sum, count) => sum + count, 0);
  }

  if (interviewsCount) {
    interviewsCount.textContent = Object.values(interviewCountsByJob)
      .reduce((sum, count) => sum + count, 0);
  }
}

function setupFilters() {
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      filterButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");

      currentFilter = button.dataset.filter;
      renderJobs();
    });
  });
}

function setupSearchAndSort() {
  if (jobSearchInput) {
    jobSearchInput.addEventListener("input", renderJobs);
  }

  if (jobSortSelect) {
    jobSortSelect.addEventListener("change", renderJobs);
  }
}

function setupLogout() {
  if (!logoutBtn) return;

  logoutBtn.addEventListener("click", async () => {
    try {
      await window.PlacelyAuth.clearAuthState();
    } catch {}

    window.location.replace("employer-login.html");
  });
}

function setupBoostModal() {
  if (!JOB_BOOSTS_ENABLED) return;

  renderBoostOptionButtons();
  boostCloseBtn?.addEventListener("click", closeBoostModal);
  boostCancelBtn?.addEventListener("click", closeBoostModal);
  boostCheckoutBtn?.addEventListener("click", startBoostCheckout);

  boostModal?.addEventListener("click", (event) => {
    if (event.target === boostModal) closeBoostModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && boostModal && !boostModal.hidden) closeBoostModal();
  });
}

function renderBoostOptionButtons() {
  if (boostDurationOptions) {
    boostDurationOptions.innerHTML = BOOST_DURATIONS.map((days) => `
      <button type="button" class="boost-option" data-duration="${days}">${days} days</button>
    `).join("");

    boostDurationOptions.querySelectorAll("[data-duration]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedDurationDays = Number(button.dataset.duration);
        updateBoostSelectionUI();
      });
    });
  }

  if (boostBudgetOptions) {
    boostBudgetOptions.innerHTML = BOOST_BUDGETS.map((cents) => `
      <button type="button" class="boost-option" data-budget="${cents}">${formatBudget(cents)}</button>
    `).join("");

    boostBudgetOptions.querySelectorAll("[data-budget]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedBudgetCents = Number(button.dataset.budget);
        updateBoostSelectionUI();
      });
    });
  }
}

function openBoostModal(job) {
  if (!JOB_BOOSTS_ENABLED) return;

  selectedBoostJob = job;
  selectedDurationDays = null;
  selectedBudgetCents = null;
  isCreatingBoostCheckout = false;
  setBoostMessage("");

  const activeBoost = activeBoostsByJob[String(job.id)] || null;
  const title = job.job_title || "Untitled job";
  const company = job.company_name || "Placely Talent";
  const location = job.location || "Location not listed";

  setText("boostModalTitle", activeBoost ? "Manage boost" : "Boost this job");
  setText(
    "boostModalDescription",
    activeBoost
      ? "This boost is active. Changes to budget or duration are not available in V1."
      : "Increase the visibility of this role and reach more relevant candidates."
  );
  setText("boostJobTitle", title);
  setText("boostJobMeta", `${company} - ${location}`);

  if (activeBoost) {
    showBoostManagement(activeBoost);
  } else {
    showBoostConfiguration(job);
  }

  if (boostModal) boostModal.hidden = false;
}

function showBoostConfiguration(job) {
  if (boostConfigurePanel) boostConfigurePanel.hidden = false;
  if (boostManagePanel) boostManagePanel.hidden = true;
  if (boostCheckoutBtn) {
    boostCheckoutBtn.hidden = false;
    boostCheckoutBtn.disabled = true;
    boostCheckoutBtn.textContent = "Continue to Payment";
  }
  if (boostCancelBtn) boostCancelBtn.textContent = "Cancel";

  setText("boostSummaryJob", job.job_title || "Untitled job");
  updateBoostSelectionUI();
}

function showBoostManagement(boost) {
  if (boostConfigurePanel) boostConfigurePanel.hidden = true;
  if (boostManagePanel) boostManagePanel.hidden = false;
  if (boostCheckoutBtn) boostCheckoutBtn.hidden = true;
  if (boostCancelBtn) boostCancelBtn.textContent = "Close";

  setText("boostManageStatus", capitalize(boost.status || "active"));
  setText("boostManageBudget", formatBudget(boost.budget_cents));
  setText("boostManageStart", formatCalendarDate(boost.starts_at));
  setText("boostManageEnd", formatCalendarDate(boost.ends_at));
  setText("boostManageRemaining", formatBoostRemaining(boost.ends_at));
}

function updateBoostSelectionUI() {
  boostDurationOptions?.querySelectorAll("[data-duration]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.duration) === selectedDurationDays);
  });

  boostBudgetOptions?.querySelectorAll("[data-budget]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.budget) === selectedBudgetCents);
  });

  setText("boostSummaryDuration", selectedDurationDays ? `${selectedDurationDays} days` : "-");
  setText("boostSummaryBudget", selectedBudgetCents ? formatBudget(selectedBudgetCents) : "-");
  setText("boostSummaryEndDate", selectedDurationDays ? formatCalendarDate(getEstimatedEndDate(selectedDurationDays)) : "-");

  const eligibilityError = getBoostEligibilityError(selectedBoostJob);
  if (eligibilityError) setBoostMessage(eligibilityError);
  else setBoostMessage("");

  if (boostCheckoutBtn) {
    boostCheckoutBtn.disabled = Boolean(eligibilityError) || !selectedDurationDays || !selectedBudgetCents || isCreatingBoostCheckout;
  }
}

function getBoostEligibilityError(job) {
  if (!job) return "Choose a job to boost.";
  if (String(job.employer_id || "") !== String(currentUserId || "")) return "You can only boost jobs owned by your employer account.";
  if (normalizeStatus(job.status) !== "active") return "Only active jobs can be boosted.";
  if (activeBoostsByJob[String(job.id)]) return "This job already has an active boost.";
  return "";
}

async function startBoostCheckout() {
  if (!JOB_BOOSTS_ENABLED) return;
  if (!selectedBoostJob || isCreatingBoostCheckout) return;

  const eligibilityError = getBoostEligibilityError(selectedBoostJob);
  if (eligibilityError) {
    setBoostMessage(eligibilityError);
    updateBoostSelectionUI();
    return;
  }

  if (!selectedDurationDays || !selectedBudgetCents) {
    setBoostMessage("Choose a boost duration and budget.");
    updateBoostSelectionUI();
    return;
  }

  isCreatingBoostCheckout = true;
  setBoostMessage("Creating secure checkout...");
  if (boostCheckoutBtn) {
    boostCheckoutBtn.disabled = true;
    boostCheckoutBtn.textContent = "Opening...";
  }

  try {
    const { data, error } = await supabaseClient.functions.invoke("create-job-boost-checkout", {
      body: {
        job_id: selectedBoostJob.id,
        duration_days: selectedDurationDays,
        budget_cents: selectedBudgetCents,
        origin: window.location.origin,
        appPath: getAppPath()
      }
    });

    if (error) throw error;
    if (!data?.url) throw new Error("Missing checkout URL.");

    window.location.href = data.url;
  } catch (error) {
    setBoostMessage(getBoostCheckoutErrorMessage(error));
    isCreatingBoostCheckout = false;
    if (boostCheckoutBtn) {
      boostCheckoutBtn.textContent = "Continue to Payment";
    }
    updateBoostSelectionUI();
  }
}

function getBoostCheckoutErrorMessage(error) {
  const status = error?.context?.status || error?.status || 0;
  if (status === 401) return "Your session has expired. Please log in again.";
  if (status === 403) return "This job cannot be boosted by your employer account.";
  if (status === 409) return "This job is not eligible for a boost right now.";
  if (status === 400) return "Choose a valid boost duration and budget.";
  return "We could not start checkout. Please try again.";
}

async function handleBoostReturnState() {
  const params = new URLSearchParams(window.location.search);
  const boostState = params.get("boost");
  const sessionId = params.get("session_id");

  if (boostState === "cancelled") {
    alert("Boost checkout was cancelled. No boost was activated.");
    cleanBoostQueryParams();
    return;
  }

  if (boostState !== "processing" || !sessionId) return;

  alert("Confirming your boost. This may take a moment after payment.");
  await pollBoostActivation(sessionId);
  cleanBoostQueryParams();
}

async function pollBoostActivation(sessionId) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await supabaseClient
      .from("job_boosts")
      .select("id, job_id, status, ends_at")
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle();

    if (!error && data?.status === "active") {
      alert("Your job boost is active.");
      return;
    }

    await delay(1500);
  }

  alert("Payment was received and your boost is still being confirmed. Refresh this page in a moment.");
}

function cleanBoostQueryParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete("boost");
  url.searchParams.delete("session_id");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function closeBoostModal() {
  if (boostModal) boostModal.hidden = true;
}

function setBoostMessage(message, type = "error") {
  if (!boostModalMessage) return;
  boostModalMessage.textContent = message || "";
  boostModalMessage.classList.toggle("success", type === "success");
}

function setupDashboardShell() {
  const body = document.body;
  const sidebar = document.getElementById("dashboardSidebar");
  const toggle = document.getElementById("sidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");
  const globalSearch = document.querySelector(".utility-search");

  const closeSidebar = () => {
    body.classList.remove("sidebar-open");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    if (backdrop) backdrop.hidden = true;
  };

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

  globalSearch?.addEventListener("submit", (event) => {
    event.preventDefault();
  });
}

function parseSkills(skills) {
  if (!skills) return ["Trades"];

  if (Array.isArray(skills)) {
    return skills.slice(0, 4);
  }

  return String(skills)
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeStatus(status) {
  const clean = String(status || "active").toLowerCase().trim();

  if (["draft", "drafts"].includes(clean)) {
    return "draft";
  }

  if (["paused", "inactive", "closed", "archived", "deleted", "removed"].includes(clean)) {
    return "paused";
  }

  return "active";
}

function formatBudget(cents) {
  return `$${Math.round(Number(cents || 0) / 100)} CAD`;
}

function getEstimatedEndDate(days) {
  return new Date(Date.now() + Number(days || 0) * 86400000);
}

function formatCalendarDate(value) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatBoostRemaining(value) {
  const end = new Date(value);
  if (Number.isNaN(end.getTime())) return "Boost active";
  const remainingMs = end.getTime() - Date.now();
  if (remainingMs <= 0) return "Boost ending";
  const days = Math.ceil(remainingMs / 86400000);
  return `${days} day${days === 1 ? "" : "s"} remaining`;
}

function getAppPath() {
  const path = window.location.pathname;
  return path.includes("/Placely/") || path.endsWith("/Placely") ? "/Placely" : "";
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatDate(dateString) {
  if (!dateString) return "Recently posted";

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return "Recently posted";
  }

  const days = Math.floor((Date.now() - date.getTime()) / 86400000);

  if (days <= 0) return "Posted today";
  if (days === 1) return "Posted yesterday";
  if (days < 7) return `Posted ${days} days ago`;
  if (days < 14) return "Posted 1 week ago";

  return `Posted ${Math.floor(days / 7)} weeks ago`;
}

function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

function truncateText(value, limit) {
  const text = String(value || "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value || "";
}
