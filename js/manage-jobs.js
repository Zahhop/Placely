const supabaseClient = window.employerSupabase;

const JOBS_TABLE = "jobs";
const EMPLOYER_PROFILE_FIELDS = "id, company_name, company_location, employment_type, pay_range, company_logo_url, company_email";

const jobsManageView = document.getElementById("jobsManageView");
const jobCreateView = document.getElementById("jobCreateView");
const jobEditView = document.getElementById("jobEditView");
const jobsGrid = document.getElementById("jobsGrid");
const emptyState = document.getElementById("emptyState");
const manageJobsNotice = document.getElementById("manageJobsNotice");

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
const jobForm = document.getElementById("jobForm");
const formMessage = document.getElementById("formMessage");
const compensationType = document.getElementById("compensationType");
const compensationMin = document.getElementById("compensationMin");
const compensationMax = document.getElementById("compensationMax");
const compensationUnit = document.getElementById("compensationUnit");
const compensationError = document.getElementById("compensationError");
const compensationPreview = document.getElementById("compensationPreview");
const editJobForm = document.getElementById("editJobForm");
const editFormMessage = document.getElementById("editFormMessage");
const editCompensationType = document.getElementById("editCompensationType");
const editCompensationMin = document.getElementById("editCompensationMin");
const editCompensationMax = document.getElementById("editCompensationMax");
const editCompensationUnit = document.getElementById("editCompensationUnit");
const editCompensationError = document.getElementById("editCompensationError");
const editCompensationPreview = document.getElementById("editCompensationPreview");
const editApplicantsBtn = document.getElementById("editApplicantsBtn");
const editStatusBtn = document.getElementById("editStatusBtn");
const editRemoveBtn = document.getElementById("editRemoveBtn");
const editStatusBadge = document.getElementById("editStatusBadge");

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
let currentEmployerProfile = null;
let isPostingJob = false;
let hasUnsavedJobDraft = false;
let currentView = "manage";
let hasEmployerProfileForPosting = false;
let jobsSupportsStructuredCompensation = false;
let currentEmployerUser = null;
let employerProfileLookupError = null;
let currentEditJob = null;
let currentEditJobId = null;
let hasUnsavedEditDraft = false;
let isSavingEditedJob = false;
let isUpdatingEditedJobStatus = false;
let isDeletingEditedJob = false;

document.addEventListener("DOMContentLoaded", initManageJobs);

async function initManageJobs() {
  setupHeaderButtons();
  setupLogout();
  setupFilters();
  setupSearchAndSort();
  setupPostJobRouting();
  setupPostJobForm();
  if (JOB_BOOSTS_ENABLED) setupBoostModal();
  setupDashboardShell();

  const user = await requireEmployerLogin();
  if (!user) return;

  currentUserId = user.id;
  currentEmployerUser = user;
  await loadEmployerProfileForPosting(user.id);
  prefillPostJobDefaults();
  if (JOB_BOOSTS_ENABLED) await handleBoostReturnState();
  else cleanBoostQueryParams();
  await loadEmployerJobs(user.id);
  initializeJobsView();
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

async function loadEmployerProfileForPosting(userId) {
  const { data, error } = await supabaseClient
    .from("employer_profiles")
    .select(EMPLOYER_PROFILE_FIELDS)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Employer profile lookup failed", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint
    });
  }

  employerProfileLookupError = error || null;
  currentEmployerProfile = error ? null : data || null;
  hasEmployerProfileForPosting = Boolean(currentEmployerProfile);
  safelyUpdateEmployerHeaderIdentity(currentEmployerProfile, currentEmployerUser);
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
  const editUrl = getEditJobUrl(job.id);

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
      <a class="secondary" href="${escapeHTML(editUrl)}" data-open-edit-job="${escapeHTML(job.id)}">Edit</a>
    </div>
  `;

  const boostButton = card.querySelector(".boost-job-btn");
  const editLink = card.querySelector("[data-open-edit-job]");

  if (boostButton) {
    boostButton.addEventListener("click", () => {
      openBoostModal(job);
    });
  }

  if (editLink) {
    editLink.addEventListener("click", (event) => {
      event.preventDefault();
      openEditView(job.id, { push: true });
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

function setupPostJobRouting() {
  document.querySelectorAll("[data-open-post-job]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openCreateView({ push: true });
    });
  });

  document.querySelectorAll("[data-back-to-jobs]").forEach((button) => {
    button.addEventListener("click", handleBackToJobs);
  });

  window.addEventListener("popstate", () => {
    syncViewFromUrl({ replace: false });
  });
}

function syncViewFromUrl({ replace = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get("view");
  const view = viewParam === "create" || viewParam === "edit" ? viewParam : "manage";

  if (view === "create") {
    openCreateView({ push: false, replace });
  } else if (view === "edit") {
    openEditView(params.get("job"), { push: false, replace });
  } else {
    openManageView({ push: false, replace });
  }
}

function initializeJobsView() {
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get("view");
  const view = viewParam === "create" || viewParam === "edit" ? viewParam : "manage";

  if (view === "create") {
    openCreateView({ push: false, replace: false });
    seedManageBackStateForCreateView();
  } else if (view === "edit") {
    openEditView(params.get("job"), { push: false, replace: false });
    seedManageBackStateForEditView(params.get("job"));
  } else {
    openManageView({ push: false, replace: true });
  }
}

function seedManageBackStateForCreateView() {
  const createUrl = new URL(window.location.href);
  createUrl.searchParams.set("view", "create");

  const manageUrl = new URL(window.location.href);
  manageUrl.searchParams.delete("view");

  const managePath = `${manageUrl.pathname}${manageUrl.search}${manageUrl.hash}`;
  const createPath = `${createUrl.pathname}${createUrl.search}${createUrl.hash}`;

  window.history.replaceState({ jobsView: "manage" }, "Manage Jobs | Placely Talent", managePath);
  window.history.pushState({ jobsView: "create" }, "Post a Job | Placely Talent", createPath);
}

function seedManageBackStateForEditView(jobId) {
  if (!jobId) return;

  const editUrl = new URL(window.location.href);
  editUrl.searchParams.set("view", "edit");
  editUrl.searchParams.set("job", jobId);

  const manageUrl = new URL(window.location.href);
  manageUrl.searchParams.delete("view");
  manageUrl.searchParams.delete("job");

  const managePath = `${manageUrl.pathname}${manageUrl.search}${manageUrl.hash}`;
  const editPath = `${editUrl.pathname}${editUrl.search}${editUrl.hash}`;

  window.history.replaceState({ jobsView: "manage" }, "Manage Jobs | Placely Talent", managePath);
  window.history.pushState({ jobsView: "edit", jobId }, "Edit Job | Placely Talent", editPath);
}

function openCreateView({ push = false, replace = false } = {}) {
  currentView = "create";
  if (jobsManageView) jobsManageView.hidden = true;
  if (jobCreateView) jobCreateView.hidden = false;
  if (jobEditView) jobEditView.hidden = true;
  document.title = "Post a Job | Placely Talent";
  clearManageNotice();
  prefillPostJobDefaults();
  showProfileStateMessageIfNeeded();
  updateRouteForView("create", { push, replace });
  document.getElementById("postJobTitle")?.focus?.();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function openManageView({ push = false, replace = false } = {}) {
  currentView = "manage";
  if (jobsManageView) jobsManageView.hidden = false;
  if (jobCreateView) jobCreateView.hidden = true;
  if (jobEditView) jobEditView.hidden = true;
  currentEditJobId = null;
  currentEditJob = null;
  document.title = "Manage Jobs | Placely Talent";
  updateRouteForView("manage", { push, replace });
  window.scrollTo({ top: 0, behavior: "auto" });
}

async function openEditView(jobId, { push = false, replace = false } = {}) {
  const cleanJobId = String(jobId || "").trim();

  currentView = "edit";
  currentEditJobId = cleanJobId || null;
  if (jobsManageView) jobsManageView.hidden = true;
  if (jobCreateView) jobCreateView.hidden = true;
  if (jobEditView) jobEditView.hidden = false;
  document.title = "Edit Job | Placely Talent";
  clearManageNotice();
  setEditFormMessage("");
  updateRouteForView("edit", { push, replace, jobId: cleanJobId });
  window.scrollTo({ top: 0, behavior: "auto" });

  if (!cleanJobId) {
    currentEditJob = null;
    setEditFormMessage("Choose a job to edit.");
    return;
  }

  await loadJobForEditing(cleanJobId);
  document.getElementById("editJobTitleInput")?.focus?.();
}

function updateRouteForView(view, { push = false, replace = false, jobId = "" } = {}) {
  const url = new URL(window.location.href);
  if (view === "create") {
    url.searchParams.set("view", "create");
    url.searchParams.delete("job");
  } else if (view === "edit") {
    url.searchParams.set("view", "edit");
    if (jobId) url.searchParams.set("job", jobId);
    else url.searchParams.delete("job");
  } else {
    url.searchParams.delete("view");
    url.searchParams.delete("job");
  }

  const nextPath = `${url.pathname}${url.search}${url.hash}`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextPath === currentPath) return;

  const state = view === "edit" ? { jobsView: view, jobId } : { jobsView: view };
  if (replace) {
    window.history.replaceState(state, document.title, nextPath);
  } else if (push) {
    window.history.pushState(state, document.title, nextPath);
  }
}

function handleBackToJobs() {
  if (currentView === "edit") {
    handleEditViewCancel();
    return;
  }

  handleCreateViewCancel();
}

function handleCreateViewCancel() {
  if (hasUnsavedJobDraft && !window.confirm("Discard this job draft and return to Jobs?")) {
    return;
  }

  resetJobForm({ preserveDefaults: true });
  openManageView({ replace: true });
}

function handleEditViewCancel() {
  if (hasUnsavedEditDraft && !window.confirm("Discard your job edits and return to Jobs?")) {
    return;
  }

  resetEditForm();
  openManageView({ replace: true });
}

function setupPostJobForm() {
  setupCompensationInputs();
  setupEditJobForm();

  jobForm?.addEventListener("input", () => {
    hasUnsavedJobDraft = true;
  });

  jobForm?.addEventListener("change", () => {
    hasUnsavedJobDraft = true;
  });

  jobForm?.addEventListener("submit", submitJob);
}

function setupEditJobForm() {
  setupEditCompensationInputs();

  editJobForm?.addEventListener("input", () => {
    hasUnsavedEditDraft = true;
  });

  editJobForm?.addEventListener("change", () => {
    hasUnsavedEditDraft = true;
  });

  editJobForm?.addEventListener("submit", submitEditedJob);
  document.getElementById("editJobStatus")?.addEventListener("change", (event) => {
    updateEditStatusUI(event.target.value, { syncButton: false });
  });
  editApplicantsBtn?.addEventListener("click", openApplicantsForEditedJob);
  editStatusBtn?.addEventListener("click", toggleEditedJobStatus);
  editRemoveBtn?.addEventListener("click", removeEditedJob);
}

function setupCompensationInputs() {
  compensationType?.addEventListener("change", updateCompensationUI);

  [compensationMin, compensationMax].forEach((input) => {
    input?.addEventListener("input", () => {
      input.value = input.value.replace(/[^\d.]/g, "");
      updateCompensationUI();
    });
  });

  updateCompensationUI();
}

function setupEditCompensationInputs() {
  editCompensationType?.addEventListener("change", updateEditCompensationUI);

  [editCompensationMin, editCompensationMax].forEach((input) => {
    input?.addEventListener("input", () => {
      input.value = input.value.replace(/[^\d.]/g, "");
      updateEditCompensationUI();
    });
  });

  updateEditCompensationUI();
}

function prefillPostJobDefaults() {
  const companyName = document.getElementById("companyName");
  if (companyName && !companyName.value && currentEmployerProfile?.company_name) {
    companyName.value = currentEmployerProfile.company_name;
  }

  const location = document.getElementById("location");
  if (location && !location.value && currentEmployerProfile?.company_location) {
    location.value = currentEmployerProfile.company_location;
  }

  const employmentType = document.getElementById("employmentType");
  if (employmentType && currentEmployerProfile?.employment_type) {
    setSelectValueIfOptionExists(employmentType, currentEmployerProfile.employment_type);
  }

  updateCompensationUI();
}

function setSelectValueIfOptionExists(select, value) {
  const target = String(value || "").trim();
  if (!select || !target) return;

  const option = Array.from(select.options || []).find((item) => {
    return item.value.toLowerCase() === target.toLowerCase() ||
      item.textContent.trim().toLowerCase() === target.toLowerCase();
  });

  if (option) select.value = option.value;
}

function safelyUpdateEmployerHeaderIdentity(profile, user) {
  try {
    updateEmployerHeaderIdentity(profile, user);
  } catch (error) {
    console.warn("Employer header identity could not be rendered", {
      message: error?.message || String(error || "")
    });
  }
}

function updateEmployerHeaderIdentity(profile, user) {
  const companyName = getEmployerDisplayName(profile, user);
  const initials = getInitials(companyName || user?.email || "Employer");
  const logoUrl = window.PlacelyAuth.resolveEmployerLogoUrl?.(profile?.company_logo_url) || "";
  const topAccount = document.querySelector(".utility-actions .top-account, .utility-actions #topAccountButton");
  const accountAvatar = topAccount?.querySelector(".account-avatar");
  const accountName = topAccount?.querySelector("span:last-child");

  if (accountName) accountName.textContent = companyName;

  if (accountAvatar) {
    accountAvatar.textContent = "";
    accountAvatar.innerHTML = logoUrl
      ? `<img src="${escapeHTML(logoUrl)}" alt="" loading="lazy" onerror="this.hidden=true" /><span class="avatar-fallback">${escapeHTML(initials)}</span>`
      : escapeHTML(initials);
  }

  window.updateEmployerAccountMenu?.({
    companyName,
    email: user?.email || "",
    companyEmail: profile?.company_email || ""
  });
}

function getEmployerDisplayName(profile, user) {
  const profileName = String(profile?.company_name || "").trim();
  if (profileName) return profileName;

  const metadataName = String(user?.user_metadata?.company_name || "").trim();
  if (metadataName) return metadataName;

  const emailPrefix = String(user?.email || "").split("@")[0].trim();
  if (emailPrefix) return emailPrefix;

  return "Employer";
}

function getInitials(value) {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return "E";

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

function updateCompensationUI() {
  const type = window.PlacelyAuth.normalizeCompensationType(compensationType?.value) || "hourly";
  const isAnnual = type === "annual";

  if (compensationType && compensationType.value !== type) compensationType.value = type;
  if (compensationMin) compensationMin.placeholder = isAnnual ? "50000" : "25";
  if (compensationMax) compensationMax.placeholder = isAnnual ? "80000" : "40";
  if (compensationUnit) compensationUnit.textContent = isAnnual ? "per year" : "per hour";

  const result = window.PlacelyAuth.validateCompensationValues(
    type,
    compensationMin?.value,
    compensationMax?.value
  );
  const hasAnyAmount = Boolean(compensationMin?.value || compensationMax?.value);

  if (compensationError) compensationError.textContent = hasAnyAmount && !result.valid ? result.message : "";
  if (compensationPreview) {
    compensationPreview.textContent = result.valid
      ? window.PlacelyAuth.formatCompensation(result.type, result.minimum, result.maximum)
      : "";
  }
}

function updateEditCompensationUI() {
  const type = window.PlacelyAuth.normalizeCompensationType(editCompensationType?.value) || "hourly";
  const isAnnual = type === "annual";

  if (editCompensationType && editCompensationType.value !== type) editCompensationType.value = type;
  if (editCompensationMin) editCompensationMin.placeholder = isAnnual ? "50000" : "25";
  if (editCompensationMax) editCompensationMax.placeholder = isAnnual ? "80000" : "40";
  if (editCompensationUnit) editCompensationUnit.textContent = isAnnual ? "per year" : "per hour";

  const result = window.PlacelyAuth.validateCompensationValues(
    type,
    editCompensationMin?.value,
    editCompensationMax?.value
  );
  const hasAnyAmount = Boolean(editCompensationMin?.value || editCompensationMax?.value);

  if (editCompensationError) editCompensationError.textContent = hasAnyAmount && !result.valid ? result.message : "";
  if (editCompensationPreview) {
    if (result.valid) {
      editCompensationPreview.textContent = window.PlacelyAuth.formatCompensation(result.type, result.minimum, result.maximum);
    } else if (!hasAnyAmount && currentEditJob?.pay_range) {
      editCompensationPreview.textContent = `Current pay: ${currentEditJob.pay_range}`;
    } else {
      editCompensationPreview.textContent = "";
    }
  }
}

function getJobFormValue(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function getJobFormFields() {
  const compensation = window.PlacelyAuth.buildCompensationPayload(
    getJobFormValue("compensationType"),
    compensationMin?.value,
    compensationMax?.value
  );

  const companyName = getJobFormValue("companyName") || String(currentEmployerProfile?.company_name || "").trim();

  return {
    job_title: getJobFormValue("jobTitle"),
    company_name: companyName,
    location: getJobFormValue("location"),
    employment_type: getJobFormValue("employmentType"),
    experience_level: getJobFormValue("experienceLevel"),
    job_description: getJobFormValue("jobDescription"),
    required_skills: getJobFormValue("requiredSkills"),
    benefits: getJobFormValue("benefits"),
    status: normalizePostJobStatus(getJobFormValue("jobStatus")),
    compensation
  };
}

function buildJobInsertPayload(fields) {
  const compensationPayload = fields.compensation?.payload || {};
  const payload = {
    employer_id: currentUserId,
    company_name: fields.company_name || null,
    job_title: fields.job_title,
    location: fields.location,
    employment_type: fields.employment_type || null,
    pay_range: compensationPayload.pay_range || null,
    experience_level: fields.experience_level || null,
    job_description: fields.job_description,
    required_skills: fields.required_skills || null,
    benefits: fields.benefits || null,
    status: fields.status
  };

  if (jobsSupportsStructuredCompensation) {
    payload.compensation_type = compensationPayload.compensation_type;
    payload.compensation_min = compensationPayload.compensation_min;
    payload.compensation_max = compensationPayload.compensation_max ?? null;
  }

  return removeUndefinedValues(payload);
}

async function loadJobForEditing(jobId) {
  if (!currentUserId) {
    setEditFormMessage("Your session has expired. Please log in again.");
    return;
  }

  setEditFormMessage("Loading job...", "success");

  const { data, error } = await supabaseClient
    .from(JOBS_TABLE)
    .select("*")
    .eq("id", jobId)
    .eq("employer_id", currentUserId)
    .maybeSingle();

  if (error) {
    console.error("Job edit lookup failed", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      job_id: "[job-id]"
    });
    currentEditJob = null;
    setEditFormMessage("We could not load this job. Please return to Jobs and try again.");
    return;
  }

  if (!data) {
    currentEditJob = null;
    setEditFormMessage("We could not find this job for your employer account.");
    return;
  }

  currentEditJob = data;
  fillEditJobForm(data);
  setEditFormMessage("");
}

function fillEditJobForm(job) {
  setInputValue("editJobTitleInput", job?.job_title || "");
  setInputValue(
    "editCompanyName",
    currentEmployerProfile?.company_name || job?.company_name || ""
  );
  setInputValue("editJobLocation", job?.location || "");
  setInputValue("editJobDescription", job?.job_description || "");
  setInputValue("editRequiredSkills", job?.required_skills || "");
  setInputValue("editBenefits", job?.benefits || "");

  setSelectValueIfOptionExists(document.getElementById("editEmploymentType"), job?.employment_type || currentEmployerProfile?.employment_type || "Full-time");
  setSelectValueIfOptionExists(document.getElementById("editExperienceLevel"), job?.experience_level || "Entry Level");

  if (editCompensationType) {
    editCompensationType.value = window.PlacelyAuth.normalizeCompensationType(job?.compensation_type) || "hourly";
  }
  if (editCompensationMin) editCompensationMin.value = job?.compensation_min ?? "";
  if (editCompensationMax) editCompensationMax.value = job?.compensation_max ?? "";

  const status = normalizePostJobStatus(job?.status);
  setSelectValueIfOptionExists(document.getElementById("editJobStatus"), status);
  updateEditStatusUI(status);
  updateEditCompensationUI();
  hasUnsavedEditDraft = false;
}

function getEditJobFormFields() {
  const compensation = getEditCompensationPayload();

  const companyName = getEditFormValue("editCompanyName") ||
    String(currentEmployerProfile?.company_name || currentEditJob?.company_name || "").trim();

  return {
    job_title: getEditFormValue("editJobTitleInput"),
    company_name: companyName,
    location: getEditFormValue("editJobLocation"),
    employment_type: getEditFormValue("editEmploymentType"),
    experience_level: getEditFormValue("editExperienceLevel"),
    job_description: getEditFormValue("editJobDescription"),
    required_skills: getEditFormValue("editRequiredSkills"),
    benefits: getEditFormValue("editBenefits"),
    status: normalizePostJobStatus(getEditFormValue("editJobStatus")),
    compensation
  };
}

function getEditCompensationPayload() {
  const minimumValue = editCompensationMin?.value?.trim() || "";
  const maximumValue = editCompensationMax?.value?.trim() || "";
  const hasAmountInput = Boolean(minimumValue || maximumValue);
  const hasStructuredCompensation = typeof window.PlacelyAuth.hasStructuredCompensation === "function" &&
    window.PlacelyAuth.hasStructuredCompensation(currentEditJob);
  const canPreserveLegacyPayRange = !hasAmountInput &&
    Boolean(currentEditJob?.pay_range) &&
    !hasStructuredCompensation;

  if (canPreserveLegacyPayRange) {
    return {
      valid: true,
      message: "",
      payload: {
        pay_range: currentEditJob.pay_range
      }
    };
  }

  return window.PlacelyAuth.buildCompensationPayload(
    getEditFormValue("editCompensationType"),
    minimumValue,
    maximumValue
  );
}

function buildJobUpdatePayload(fields) {
  const compensationPayload = fields.compensation?.payload || {};
  const payload = {
    company_name: fields.company_name || null,
    job_title: fields.job_title,
    location: fields.location,
    employment_type: fields.employment_type || null,
    pay_range: compensationPayload.pay_range || null,
    experience_level: fields.experience_level || null,
    job_description: fields.job_description,
    required_skills: fields.required_skills || null,
    benefits: fields.benefits || null,
    status: fields.status
  };

  if (jobsSupportsStructuredCompensation) {
    payload.compensation_type = compensationPayload.compensation_type;
    payload.compensation_min = compensationPayload.compensation_min;
    payload.compensation_max = compensationPayload.compensation_max ?? null;
  }

  return removeUndefinedValues(payload);
}

async function submitEditedJob(event) {
  event.preventDefault();
  setEditFormMessage("");

  if (isSavingEditedJob) return;

  if (!currentUserId) {
    setEditFormMessage("Your session has expired. Please log in again.");
    return;
  }

  if (!currentEditJob?.id) {
    setEditFormMessage("We could not identify this job. Please return to Jobs and try again.");
    return;
  }

  const fields = getEditJobFormFields();

  if (!fields.job_title || !fields.location || !fields.job_description) {
    setEditFormMessage("Please correct the highlighted fields.");
    return;
  }

  if (!fields.compensation?.valid) {
    setEditFormMessage(fields.compensation?.message || "Please correct the highlighted fields.");
    updateEditCompensationUI();
    return;
  }

  const payload = buildJobUpdatePayload(fields);
  const submitBtn = editJobForm.querySelector(".submit-btn");

  isSavingEditedJob = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";
  }

  const { data, error } = await supabaseClient
    .from(JOBS_TABLE)
    .update(payload)
    .eq("id", currentEditJob.id)
    .eq("employer_id", currentUserId)
    .select("id")
    .single();

  if (error) {
    console.error("Job update failed", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      payload: sanitizeJobPayloadForLog(payload)
    });
    setEditFormMessage("We could not save this job. Please try again.");
    isSavingEditedJob = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Save Changes";
    }
    return;
  }

  if (!data?.id) {
    setEditFormMessage("We could not confirm this job was updated. Please try again.");
    isSavingEditedJob = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Save Changes";
    }
    return;
  }

  hasUnsavedEditDraft = false;
  await loadEmployerJobs(currentUserId);
  showManageNotice("Job updated successfully.");
  openManageView({ replace: true });

  isSavingEditedJob = false;
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save Changes";
  }
}

async function toggleEditedJobStatus() {
  if (isUpdatingEditedJobStatus || !currentEditJob?.id || !currentUserId) return;

  const currentStatus = normalizePostJobStatus(currentEditJob.status);
  const nextStatus = currentStatus === "paused" ? "active" : "paused";

  isUpdatingEditedJobStatus = true;
  if (editStatusBtn) {
    editStatusBtn.disabled = true;
    editStatusBtn.textContent = nextStatus === "paused" ? "Pausing..." : "Resuming...";
  }

  const { error } = await supabaseClient
    .from(JOBS_TABLE)
    .update({ status: nextStatus })
    .eq("id", currentEditJob.id)
    .eq("employer_id", currentUserId);

  if (error) {
    console.error("Job status update failed", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint
    });
    setEditFormMessage("Could not update job status.");
  } else {
    currentEditJob.status = nextStatus;
    setSelectValueIfOptionExists(document.getElementById("editJobStatus"), nextStatus);
    updateEditStatusUI(nextStatus);
    hasUnsavedEditDraft = false;
    await loadEmployerJobs(currentUserId);
    setEditFormMessage(nextStatus === "paused" ? "Job paused." : "Job resumed.", "success");
  }

  isUpdatingEditedJobStatus = false;
  if (editStatusBtn) editStatusBtn.disabled = false;
  updateEditStatusUI(currentEditJob?.status);
}

async function removeEditedJob() {
  if (isDeletingEditedJob || !currentEditJob?.id || !currentUserId) return;

  const confirmed = window.confirm("Remove this job permanently?");
  if (!confirmed) return;

  isDeletingEditedJob = true;
  if (editRemoveBtn) {
    editRemoveBtn.disabled = true;
    editRemoveBtn.textContent = "Removing...";
  }

  const { error } = await supabaseClient
    .from(JOBS_TABLE)
    .delete()
    .eq("id", currentEditJob.id)
    .eq("employer_id", currentUserId);

  if (error) {
    console.error("Job removal failed", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint
    });
    setEditFormMessage("Could not remove this job.");
    isDeletingEditedJob = false;
    if (editRemoveBtn) {
      editRemoveBtn.disabled = false;
      editRemoveBtn.textContent = "Remove Job";
    }
    return;
  }

  hasUnsavedEditDraft = false;
  await loadEmployerJobs(currentUserId);
  showManageNotice("Job removed.");
  resetEditForm();
  openManageView({ replace: true });

  isDeletingEditedJob = false;
  if (editRemoveBtn) {
    editRemoveBtn.disabled = false;
    editRemoveBtn.textContent = "Remove Job";
  }
}

function openApplicantsForEditedJob() {
  if (!currentEditJob?.id) return;
  window.location.href = `employer-applicants.html?job=${encodeURIComponent(currentEditJob.id)}`;
}

function removeUndefinedValues(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

function normalizePostJobStatus(status) {
  const clean = String(status || "").toLowerCase().trim();
  return clean === "paused" ? "paused" : "active";
}

async function submitJob(event) {
  event.preventDefault();
  setFormMessage("");

  if (isPostingJob) return;

  if (!currentUserId) {
    setFormMessage("Your session has expired. Please log in again.");
    return;
  }

  if (!hasEmployerProfileForPosting) {
    setFormMessage(getProfileUnavailableMessage());
    return;
  }

  const fields = getJobFormFields();

  if (!fields.job_title || !fields.location || !fields.job_description) {
    setFormMessage("Please correct the highlighted fields.");
    return;
  }

  if (!fields.compensation?.valid) {
    setFormMessage(fields.compensation?.message || "Please correct the highlighted fields.");
    updateCompensationUI();
    return;
  }

  const payload = buildJobInsertPayload(fields);

  const submitBtn = jobForm.querySelector(".submit-btn");
  isPostingJob = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Posting...";
  }

  const { data, error } = await supabaseClient
    .from(JOBS_TABLE)
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    console.error("Job insert failed", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      payload: sanitizeJobPayloadForLog(payload)
    });

    if (error?.code === "42501" || error?.status === 401) {
      setFormMessage("Your session has expired. Please log in again.");
    } else {
      setFormMessage("We could not post this job. Please try again.");
    }

    isPostingJob = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Post Job";
    }
    return;
  }

  if (!data?.id) {
    setFormMessage("We could not confirm this job was posted. Please try again.");
    isPostingJob = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Post Job";
    }
    return;
  }

  setFormMessage("Job posted successfully.", "success");
  resetJobForm({ preserveDefaults: true });
  await loadEmployerJobs(currentUserId);
  showManageNotice("Job posted successfully.");
  openManageView({ replace: true });

  isPostingJob = false;
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Post Job";
  }
}

function showProfileStateMessageIfNeeded() {
  if (hasEmployerProfileForPosting) return;
  setFormMessage(getProfileUnavailableMessage());
}

function getProfileUnavailableMessage() {
  return employerProfileLookupError
    ? "We could not load your company profile."
    : "No employer profile was found for this account.";
}

function sanitizeJobPayloadForLog(payload) {
  return {
    keys: Object.keys(payload || {}),
    employer_id: payload?.employer_id ? "[auth-user-id]" : null,
    has_company_name: Boolean(payload?.company_name),
    has_job_title: Boolean(payload?.job_title),
    has_location: Boolean(payload?.location),
    employment_type: payload?.employment_type || null,
    pay_range: payload?.pay_range || null,
    compensation_type: payload?.compensation_type || null,
    compensation_min: payload?.compensation_min ?? null,
    compensation_max: payload?.compensation_max ?? null,
    experience_level: payload?.experience_level || null,
    has_job_description: Boolean(payload?.job_description),
    has_required_skills: Boolean(payload?.required_skills),
    has_benefits: Boolean(payload?.benefits),
    status: payload?.status || null
  };
}

function resetJobForm({ preserveDefaults = false } = {}) {
  jobForm?.reset();
  hasUnsavedJobDraft = false;
  setFormMessage("");
  if (preserveDefaults) prefillPostJobDefaults();
  else updateCompensationUI();
}

function resetEditForm() {
  editJobForm?.reset();
  currentEditJob = null;
  currentEditJobId = null;
  hasUnsavedEditDraft = false;
  setEditFormMessage("");
  updateEditStatusUI("active");
  updateEditCompensationUI();
}

function setFormMessage(message, type = "error") {
  if (!formMessage) return;
  formMessage.textContent = message || "";
  formMessage.classList.toggle("success", type === "success");
}

function setEditFormMessage(message, type = "error") {
  if (!editFormMessage) return;
  editFormMessage.textContent = message || "";
  editFormMessage.classList.toggle("success", type === "success");
}

function getEditFormValue(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function setInputValue(id, value) {
  const input = document.getElementById(id);
  if (input) input.value = value ?? "";
}

function updateEditStatusUI(status, { syncButton = true } = {}) {
  const normalized = normalizePostJobStatus(status);
  const label = normalized === "paused" ? "Paused" : "Active";

  if (editStatusBadge) {
    editStatusBadge.textContent = label;
    editStatusBadge.className = `status ${normalized}`;
  }

  if (editStatusBtn && syncButton) {
    editStatusBtn.textContent = normalized === "paused" ? "Resume Job" : "Pause Job";
  }
}

function getEditJobUrl(jobId) {
  return `manage-jobs.html?view=edit&job=${encodeURIComponent(jobId || "")}`;
}

function showManageNotice(message) {
  if (!manageJobsNotice) return;
  manageJobsNotice.textContent = message || "";
  manageJobsNotice.hidden = !message;
}

function clearManageNotice() {
  showManageNotice("");
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
