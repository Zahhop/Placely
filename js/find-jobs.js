const jobsSupabase = window.PlacelyAuth.client();

const JOBS_TABLE = "jobs";
const PUBLIC_JOB_COLUMNS = [
  "id",
  "employer_id",
  "job_title",
  "company_name",
  "location",
  "employment_type",
  "pay_range",
  "experience_level",
  "job_description",
  "required_skills",
  "benefits",
  "status",
  "created_at"
].join(", ");

let allJobs = [];
let filteredJobs = [];
let selectedJob = null;
let currentUser = null;
let candidateProfile = {};
let savedJobIds = [];
let appliedJobIds = [];
let employerLogos = {};
let employerProfiles = {};
let activeBoostsByJob = {};
let suppressHistoryUpdate = false;
let structuredCompensationSupported = false;

const JOB_BOOSTS_ENABLED = window.PLACELY_FEATURES?.jobBoosts === true;

const jobsList = document.getElementById("jobsList");
const jobDetails = document.getElementById("jobDetails");
const jobCount = document.getElementById("jobCount");
const keywordInput = document.getElementById("keywordInput");
const locationInput = document.getElementById("locationInput");
const typeFilter = document.getElementById("typeFilter");
const experienceFilter = document.getElementById("experienceFilter");
const compensationTypeFilter = document.getElementById("compensationTypeFilter");
const minimumCompensationInput = document.getElementById("minimumCompensationInput");
const datePostedFilter = document.getElementById("datePostedFilter");
const searchBtn = document.getElementById("searchBtn");
const backToResultsBtn = document.getElementById("backToResultsBtn");

document.addEventListener("DOMContentLoaded", initFindJobs);

async function initFindJobs() {
  bindStaticControls();
  renderLoadingState();

  try {
    const user = await verifyCandidateAccess(jobsSupabase, {
      loginPath: "../candidates/candidate-login.html",
      setupPath: "../candidates/candidate-setup.html",
      employerDashboardPath: "../employers/employer-dashboard.html"
    });

    if (!user) return;
    currentUser = user;

    await Promise.all([
      loadCandidateProfile(user),
      loadSavedJobIds(user.id),
      loadAppliedJobIds(user.id),
      loadJobs()
    ]);

    applyFilters({ preserveSelection: true });
    selectInitialJob();
  } catch (error) {
    console.error("Find Jobs failed to load", error);
    renderSearchError();
  } finally {
    document.documentElement.classList.remove("jobs-booting");
  }
}

function bindStaticControls() {
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
  document.getElementById("accountMenuLogoutBtn")?.addEventListener("click", handleLogout);
  bindAccountMenu();
  bindMobileSidebar();
  bindSearchControls();
  bindGlobalSearch();
  hydrateSearchFromUrl();

  backToResultsBtn?.addEventListener("click", () => {
    document.body.classList.remove("show-job-detail");
  });

  window.addEventListener("popstate", () => {
    const jobId = window.PlacelyJobUrls.getJobIdFromLocation();
    suppressHistoryUpdate = true;
    if (jobId) selectJob(jobId, { revealOnMobile: false });
    else if (filteredJobs.length) selectJob(filteredJobs[0].id, { revealOnMobile: false });
    suppressHistoryUpdate = false;
  });
}

function loadCandidateProfile(user) {
  const identity = window.PlacelyAuth.getCachedCandidateIdentity?.() || {
    fullName: user?.email?.split("@")[0] || "Candidate",
    firstName: user?.email?.split("@")[0] || "Candidate",
    email: user?.email || "",
    initials: "PT",
    photoUrl: ""
  };

  candidateProfile = {
    full_name: identity.fullName,
    email: identity.email || user.email || "",
    profile_photo_url: identity.photoUrl || ""
  };
  window.PlacelyAuth.updateCandidateHeader?.(identity);
}

async function loadSavedJobIds(userId) {
  const { data, error } = await jobsSupabase
    .from("saved_jobs")
    .select("job_id")
    .eq("candidate_id", userId);

  savedJobIds = error ? [] : (data || []).map((row) => String(row.job_id));
}

async function loadAppliedJobIds(userId) {
  const { data, error } = await jobsSupabase
    .from("applications")
    .select("job_id, status")
    .eq("candidate_id", userId)
    .neq("status", "withdrawn");

  appliedJobIds = error ? [] : (data || []).map((row) => String(row.job_id));
}

async function loadJobs() {
  const { data, error } = await jobsSupabase
    .from(JOBS_TABLE)
    .select(PUBLIC_JOB_COLUMNS)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Find Jobs Supabase query failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      table: JOBS_TABLE,
      columns: PUBLIC_JOB_COLUMNS,
      filter: "status=eq.active"
    });
    throw error;
  }

  if (JOB_BOOSTS_ENABLED) await loadActiveBoosts(data || []);
  else activeBoostsByJob = {};

  const jobsById = new Map();
  (data || []).forEach((job) => {
    if (job?.id && isActiveJob(job) && !jobsById.has(String(job.id))) {
      jobsById.set(String(job.id), normalizeJob(job));
    }
  });

  allJobs = [...jobsById.values()];
  structuredCompensationSupported = allJobs.some((job) => job.hasStructuredCompensation);
  updateStructuredCompensationFilters();
  await loadEmployerProfiles(allJobs);
}

async function loadActiveBoosts(jobs) {
  const jobIds = jobs.map((job) => job.id).filter(Boolean);
  activeBoostsByJob = {};
  if (!jobIds.length) return;

  const { data, error } = await jobsSupabase
    .from("job_boosts")
    .select("id, job_id, status, ends_at")
    .in("job_id", jobIds)
    .eq("status", "active")
    .gt("ends_at", new Date().toISOString());

  if (error) return;

  (data || []).forEach((boost) => {
    if (boost.job_id) activeBoostsByJob[String(boost.job_id)] = boost;
  });
}

async function loadEmployerProfiles(jobs) {
  const employerIds = [...new Set(jobs.map((job) => job.employer_id).filter(Boolean))];
  employerLogos = {};
  employerProfiles = {};
  if (!employerIds.length) return;

  const { data, error } = window.PlacelyCompanies?.runPublicCompanyQuery
    ? await window.PlacelyCompanies.runPublicCompanyQuery(
        jobsSupabase,
        (query) => query.in("id", employerIds),
        { columns: "id, company_name, company_description, company_location, company_logo_url" }
      )
    : { data: [], error: null };

  if (error) {
    console.warn("Find Jobs employer profile lookup failed", {
      code: error.code,
      message: error.message
    });
    return;
  }

  (data || []).forEach((profile) => {
    employerLogos[String(profile.id)] = getEmployerLogoUrl(window.PlacelyAuth.getPublicEmployerLogoValue(profile));
    employerProfiles[String(profile.id)] = profile;
  });
}

function populateFilters() {
  populateSelect(typeFilter, allJobs.map((job) => job.type), "All types");
  populateSelect(experienceFilter, allJobs.map((job) => job.experience), "All levels");
  if (structuredCompensationSupported) {
    populateSelect(compensationTypeFilter, allJobs.map((job) => job.compensationTypeLabel), "All pay types");
  }
}

function updateStructuredCompensationFilters() {
  [compensationTypeFilter, minimumCompensationInput].forEach((control) => {
    if (!control) return;
    control.disabled = !structuredCompensationSupported;
    const label = control.closest("label");
    if (label) label.hidden = !structuredCompensationSupported;
  });
}

function populateSelect(select, values, placeholder) {
  if (!select) return;

  const current = select.value;
  const uniqueValues = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="">${escapeHTML(placeholder)}</option>`;

  uniqueValues.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });

  if (uniqueValues.includes(current)) select.value = current;
}

function renderLoadingState() {
  if (jobsList) {
    jobsList.innerHTML = `
      <div class="empty-state">
        <strong>Loading jobs</strong>
        <p>Finding active roles for you.</p>
      </div>
    `;
  }
}

function renderSearchError() {
  if (jobsList) {
    jobsList.innerHTML = `
      <div class="empty-state">
        <strong>Could not load jobs</strong>
        <p>Please refresh the page and try again.</p>
      </div>
    `;
  }

  renderEmptyDetails("Jobs unavailable", "We could not load active jobs right now. Please try again shortly.");
}

function applyFilters({ preserveSelection = false } = {}) {
  populateFilters();

  const keyword = cleanText(keywordInput?.value);
  const location = cleanText(locationInput?.value);
  const type = typeFilter?.value || "";
  const experience = experienceFilter?.value || "";
  const compensationType = compensationTypeFilter?.value || "";
  const minCompensation = Number(minimumCompensationInput?.value || 0);
  const datePostedDays = Number(datePostedFilter?.value || 0);
  const cutoff = datePostedDays ? Date.now() - datePostedDays * 24 * 60 * 60 * 1000 : 0;
  const previousSelectedId = selectedJob?.id;

  filteredJobs = sortJobsByBoost(allJobs.filter((job) => {
    const matchesKeyword =
      !keyword ||
      cleanText([job.title, job.company, job.location, job.description, job.requirements, job.experience].join(" ")).includes(keyword);
    const matchesLocation = !location || cleanText(job.location).includes(location);
    const matchesType = !type || job.type === type;
    const matchesExperience = !experience || job.experience === experience;
    const matchesCompensationType = !structuredCompensationSupported || !compensationType || job.compensationTypeLabel === compensationType;
    const matchesMinimum = !structuredCompensationSupported || !minCompensation || Number(job.compensationMin || 0) >= minCompensation || Number(job.compensationMax || 0) >= minCompensation;
    const matchesDate = !cutoff || new Date(job.created_at || 0).getTime() >= cutoff;

    return matchesKeyword && matchesLocation && matchesType && matchesExperience && matchesCompensationType && matchesMinimum && matchesDate;
  }));

  renderJobs();

  if (!filteredJobs.length) {
    selectedJob = null;
    renderEmptyDetails("No jobs found", "Try changing your search filters to see more open roles.");
    return;
  }

  const retainedSelection = preserveSelection
    ? filteredJobs.find((job) => String(job.id) === String(previousSelectedId))
    : null;

  selectedJob = retainedSelection || filteredJobs[0];
  selectJob(selectedJob.id, { pushHistory: false, revealOnMobile: false });
}

function renderJobs() {
  if (!jobsList || !jobCount) return;

  jobCount.textContent = filteredJobs.length;

  if (!filteredJobs.length) {
    jobsList.innerHTML = `
      <div class="empty-state">
        <strong>No jobs found</strong>
        <p>Try a different keyword, location, or filter combination.</p>
      </div>
    `;
    return;
  }

  const scrollTop = jobsList.scrollTop;
  jobsList.innerHTML = filteredJobs.map(renderJobCard).join("");
  jobsList.scrollTop = scrollTop;
}

function renderJobCard(job) {
  const alreadySaved = isSaved(job.id);
  const alreadyApplied = isApplied(job.id);
  const isSelected = selectedJob && String(selectedJob.id) === String(job.id);

  return `
    <button class="job-card ${isSelected ? "selected" : ""}" type="button" data-job-id="${escapeHTML(job.id)}" role="option" aria-selected="${isSelected}">
      <div class="job-card-top">
        ${renderCompanyAvatar(job)}
        <div>
          <h3>${escapeHTML(job.title)}</h3>
          <p>${renderCompanyProfileTarget(job)} - ${escapeHTML(job.location)}</p>
        </div>
      </div>

      <div class="job-tags">
        ${job.boosted ? `<span class="promoted-tag">Promoted</span>` : ""}
        <span>${escapeHTML(job.pay)}</span>
        <span>${escapeHTML(job.type)}</span>
        <span>${escapeHTML(job.experience)}</span>
        <span>${escapeHTML(formatDate(job.created_at))}</span>
      </div>

      <p class="job-preview">${escapeHTML(truncateText(job.description, 132))}</p>

      <div class="job-card-state">
        <span>${alreadySaved ? "Saved" : "Not saved"}</span>
        ${alreadyApplied ? `<span class="applied-tag">Applied</span>` : ""}
      </div>
    </button>
  `;
}

function selectInitialJob() {
  const jobIdFromUrl = window.PlacelyJobUrls.getJobIdFromLocation();
  const matchingJob = jobIdFromUrl
    ? allJobs.find((job) => String(job.id) === String(jobIdFromUrl))
    : null;

  if (jobIdFromUrl && !matchingJob) {
    renderJobs();
    renderEmptyDetails("Job unavailable", "This job may be closed, paused, deleted, or no longer accepting applications.");
    return;
  }

  if (matchingJob && !filteredJobs.some((job) => String(job.id) === String(matchingJob.id))) {
    filteredJobs = sortJobsByBoost([matchingJob, ...filteredJobs]);
    renderJobs();
  }

  const firstJob = matchingJob || filteredJobs[0];
  if (firstJob) selectJob(firstJob.id, { pushHistory: false, revealOnMobile: false });
  else renderEmptyDetails("No active jobs", "There are no open jobs to show right now.");
}

function selectJob(jobId, options = {}) {
  const job = filteredJobs.find((item) => String(item.id) === String(jobId)) ||
    allJobs.find((item) => String(item.id) === String(jobId));

  if (!job || !isActiveJob(job)) {
    selectedJob = null;
    renderEmptyDetails("Job unavailable", "This job may be closed, paused, deleted, or no longer accepting applications.");
    return;
  }

  selectedJob = job;
  updateSelectedCard();
  renderJobDetails();

  if (options.revealOnMobile !== false && window.innerWidth <= 900) {
    document.body.classList.add("show-job-detail");
  }

  if (options.pushHistory !== false && !suppressHistoryUpdate) {
    window.history.pushState({ jobId: job.id }, "", window.PlacelyJobUrls.buildFindJobsUrl(job));
  }
}

function updateSelectedCard() {
  document.querySelectorAll(".job-card").forEach((card) => {
    const isSelected = String(card.dataset.jobId) === String(selectedJob?.id);
    card.classList.toggle("selected", isSelected);
    card.setAttribute("aria-selected", String(isSelected));
  });
}

function renderJobDetails() {
  if (!jobDetails || !selectedJob) {
    renderEmptyDetails();
    return;
  }

  const alreadySaved = isSaved(selectedJob.id);
  const alreadyApplied = isApplied(selectedJob.id);
  const employerProfile = employerProfiles[String(selectedJob.employer_id)] || {};
  const companyInfo = employerProfile.company_description || "Company information has not been added yet.";
  const publicUrl = window.PlacelyJobUrls.buildJobDetailUrl(selectedJob);

  jobDetails.className = "";
  jobDetails.innerHTML = `
    <div class="job-detail-content">
      <div class="job-detail-top">
        <div class="job-title-row">
          ${renderCompanyAvatar(selectedJob, true)}
          <div>
            <span class="eyebrow">Selected Role</span>
            <h2>${escapeHTML(selectedJob.title)}</h2>
            <p>${renderCompanyProfileAnchor(selectedJob)} - ${escapeHTML(selectedJob.location)}</p>
            <div class="job-tags">
              ${selectedJob.boosted ? `<span class="promoted-tag">Promoted</span>` : ""}
              ${alreadyApplied ? `<span class="applied-tag">Applied</span>` : ""}
            </div>
          </div>
        </div>

        <div class="job-detail-actions">
          <button class="secondary-btn" type="button" id="saveJobBtn">${alreadySaved ? "Unsave Job" : "Save Job"}</button>
          <button class="primary-btn" type="button" id="applyBtn" ${alreadyApplied ? "disabled" : ""}>${alreadyApplied ? "Applied" : "Apply"}</button>
        </div>
      </div>

      <div class="detail-grid">
        ${renderDetailItem("Company", selectedJob.company)}
        ${renderDetailItem("Location", selectedJob.location)}
        ${renderDetailItem("Compensation", selectedJob.pay)}
        ${renderDetailItem("Employment type", selectedJob.type)}
        ${renderDetailItem("Experience", selectedJob.experience)}
        ${renderDetailItem("Posted", formatDate(selectedJob.created_at))}
      </div>

      ${renderDetailSection("Job Description", selectedJob.description)}
      ${renderDetailSection("Required Skills and Certifications", selectedJob.requirements)}
      ${selectedJob.benefits ? renderDetailSection("Benefits or Perks", selectedJob.benefits) : ""}
      ${selectedJob.raw?.schedule ? renderDetailSection("Schedule", selectedJob.raw.schedule) : ""}
      ${selectedJob.raw?.application_deadline ? renderDetailSection("Application Deadline", formatDate(selectedJob.raw.application_deadline)) : ""}
      ${renderDetailSection("Company Summary", companyInfo)}

      <div class="detail-section">
        <span>Shareable job URL</span>
        <p>${escapeHTML(publicUrl)}</p>
      </div>
    </div>
  `;

  document.getElementById("saveJobBtn")?.addEventListener("click", () => saveJob(selectedJob.id));
  document.getElementById("applyBtn")?.addEventListener("click", applyToSelectedJob);
}

function renderEmptyDetails(title = "No job selected", message = "Choose a role from the list to view company details, requirements, pay, and apply.") {
  if (!jobDetails) return;
  jobDetails.className = "job-details-empty";
  jobDetails.innerHTML = `
    <span class="eyebrow">Job Details</span>
    <h2>${escapeHTML(title)}</h2>
    <p>${escapeHTML(message)}</p>
  `;
}

function renderDetailItem(label, value) {
  return `
    <div>
      <span>${escapeHTML(label)}</span>
      <strong>${escapeHTML(value || "Not listed")}</strong>
    </div>
  `;
}

function renderDetailSection(label, value) {
  return `
    <section class="detail-section">
      <span>${escapeHTML(label)}</span>
      <p>${escapeHTML(value || "Not listed")}</p>
    </section>
  `;
}

async function saveJob(jobId) {
  const job = allJobs.find((item) => String(item.id) === String(jobId));
  if (!job || !currentUser) return;

  const alreadySaved = isSaved(job.id);

  if (alreadySaved) {
    const { error } = await jobsSupabase
      .from("saved_jobs")
      .delete()
      .eq("candidate_id", currentUser.id)
      .eq("job_id", job.id);

    if (error) {
      showToast("Could not remove saved job.");
      return;
    }

    savedJobIds = savedJobIds.filter((id) => id !== String(job.id));
    updateAfterSave(job.id);
    showToast("Job removed from saved jobs.");
    return;
  }

  const { error } = await jobsSupabase
    .from("saved_jobs")
    .insert({ candidate_id: currentUser.id, job_id: job.id });

  if (error) {
    if (error.code === "23505") {
      if (!savedJobIds.includes(String(job.id))) savedJobIds.push(String(job.id));
      updateAfterSave(job.id);
      showToast("Job already saved.");
      return;
    }

    showToast("Could not save job.");
    return;
  }

  savedJobIds.push(String(job.id));
  updateAfterSave(job.id);
  showToast("Job saved.");
}

function updateAfterSave(jobId) {
  renderJobs();
  selectJob(jobId, { pushHistory: false, revealOnMobile: false });
}

function applyToSelectedJob() {
  if (!selectedJob || !currentUser) return;

  if (isApplied(selectedJob.id)) {
    showToast("You already applied to this job.");
    return;
  }

  if (!selectedJob.employer_id) {
    showToast("This job is missing employer information.");
    return;
  }

  window.location.href = `../candidates/apply-job.html?job_id=${encodeURIComponent(selectedJob.id)}`;
}

function bindSearchControls() {
  const debouncedFilter = debounce(() => applyFilters({ preserveSelection: true }), 220);

  searchBtn?.addEventListener("click", () => applyFilters({ preserveSelection: true }));
  keywordInput?.addEventListener("input", debouncedFilter);
  locationInput?.addEventListener("input", debouncedFilter);
  keywordInput?.addEventListener("keydown", handleSearchEnter);
  locationInput?.addEventListener("keydown", handleSearchEnter);
  [typeFilter, experienceFilter, compensationTypeFilter, minimumCompensationInput, datePostedFilter].forEach((control) => {
    control?.addEventListener("change", () => applyFilters({ preserveSelection: true }));
  });

  jobsList?.addEventListener("click", (event) => {
    const companyTarget = event.target.closest("[data-company-profile-link]");
    if (companyTarget) {
      event.stopPropagation();
      window.location.href = companyTarget.dataset.companyProfileLink;
      return;
    }

    const card = event.target.closest(".job-card");
    if (card) selectJob(card.dataset.jobId);
  });

  jobsList?.addEventListener("keydown", (event) => {
    const companyTarget = event.target.closest("[data-company-profile-link]");
    if (companyTarget && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      event.stopPropagation();
      window.location.href = companyTarget.dataset.companyProfileLink;
      return;
    }

    const card = event.target.closest(".job-card");
    if (!card) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectJob(card.dataset.jobId);
    }
  });
}

function handleSearchEnter(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    applyFilters({ preserveSelection: true });
  }
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

  toggle.addEventListener("click", () => setSidebarOpen(!document.body.classList.contains("sidebar-open")));
  backdrop.addEventListener("click", () => setSidebarOpen(false));

  document.querySelectorAll(".candidate-nav-link").forEach((link) => {
    link.addEventListener("click", () => setSidebarOpen(false));
  });
}

function bindGlobalSearch() {
  const form = document.getElementById("globalSearchForm");
  const input = document.getElementById("globalSearchInput");
  if (!form || !input || !keywordInput) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    keywordInput.value = input.value.trim();
    applyFilters({ preserveSelection: true });
    keywordInput.focus();
  });
}

function hydrateSearchFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const keyword = params.get("keyword") || "";
  if (keywordInput && keyword) keywordInput.value = keyword;
  const globalInput = document.getElementById("globalSearchInput");
  if (globalInput && keyword) globalInput.value = keyword;
}

function normalizeJob(job) {
  return {
    id: job.id,
    employer_id: job.employer_id,
    title: job.job_title || "Untitled Job",
    company: job.company_name || "Employer",
    location: job.location || "Location not listed",
    type: job.employment_type || "Employment type not listed",
    compensationTypeLabel: formatCompensationType(job.compensation_type),
    compensationMin: job.compensation_min,
    compensationMax: job.compensation_max,
    hasStructuredCompensation: Boolean(job.compensation_type || job.compensation_min || job.compensation_max),
    pay: window.PlacelyAuth.formatCompensationFromRecord(job),
    experience: job.experience_level || "Experience not listed",
    description: job.job_description || "No description provided yet.",
    requirements: job.required_skills || "Requirements not listed.",
    benefits: job.benefits || "",
    status: job.status || "active",
    boosted: JOB_BOOSTS_ENABLED && Boolean(activeBoostsByJob[String(job.id)]),
    created_at: job.created_at,
    raw: job
  };
}

function renderCompanyAvatar(job, large = false) {
  const logoUrl = employerLogos[String(job.employer_id)] || "";
  const classes = `company-avatar${large ? " large" : ""}`;
  const profileUrl = getCompanyProfileUrl(job);

  if (logoUrl) {
    const initials = getInitials(job.company);
    return `
      <span class="${classes}" role="link" tabindex="0" data-company-profile-link="${escapeAttribute(profileUrl)}" aria-label="View ${escapeAttribute(job.company)} company profile">
        <img src="${escapeAttribute(logoUrl)}" alt="${escapeAttribute(job.company)} logo" loading="lazy" onerror="this.parentElement.textContent='${escapeAttribute(initials)}'">
      </span>
    `;
  }

  return `<span class="${classes}" role="link" tabindex="0" data-company-profile-link="${escapeAttribute(profileUrl)}" aria-label="View ${escapeAttribute(job.company)} company profile">${escapeHTML(getInitials(job.company))}</span>`;
}

function getEmployerLogoUrl(value) {
  return window.PlacelyAuth?.resolveEmployerLogoUrl?.(value, { supabase: jobsSupabase }) || "";
}

function renderCompanyProfileTarget(job) {
  return `<span class="company-profile-inline-link" role="link" tabindex="0" data-company-profile-link="${escapeAttribute(getCompanyProfileUrl(job))}">${escapeHTML(job.company)}</span>`;
}

function renderCompanyProfileAnchor(job) {
  return `<a class="company-profile-inline-link" href="${escapeAttribute(getCompanyProfileUrl(job))}">${escapeHTML(job.company)}</a>`;
}

function getCompanyProfileUrl(job) {
  const profile = employerProfiles[String(job.employer_id || "")] || {
    id: job.employer_id,
    company_name: job.company
  };
  return window.PlacelyCompanies?.buildCompanyProfileUrl?.(profile, {
    basePath: "company.html",
    source: "find-jobs",
    selectedJobId: job.id,
    returnTo: getFindJobsReturnPath(job)
  }) || `company.html?id=${encodeURIComponent(job.employer_id || "")}`;
}

function getFindJobsReturnPath(job) {
  const url = new URL("public/find-jobs.html", window.location.origin);
  if (job?.id) {
    url.searchParams.set("job", job.id);
    url.searchParams.set("id", job.id);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function isActiveJob(job) {
  return window.PlacelyCompanies?.isPublicActiveJob?.(job) || String(job?.status || "").toLowerCase() === "active";
}

function resolveCandidatePhotoUrl(profile) {
  const rawUrl = profile.profile_photo_url || profile.profile_photo || profile.avatar_url || profile.photo_url || "";
  if (!rawUrl) return "";
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  return window.PlacelyAuth.getPublicImageUrl(jobsSupabase, "candidate-photos", rawUrl);
}

function formatCompensationType(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return normalized.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value) {
  if (!value) return "Date not listed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not listed";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function truncateText(value, limit) {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, limit).trim()}...`;
}

function cleanText(value) {
  return String(value || "").toLowerCase().trim();
}

function isSaved(jobId) {
  return savedJobIds.includes(String(jobId));
}

function isApplied(jobId) {
  return appliedJobIds.includes(String(jobId));
}

function sortJobsByBoost(jobs) {
  return jobs.sort((a, b) => {
    if (JOB_BOOSTS_ENABLED && a.boosted !== b.boosted) return a.boosted ? -1 : 1;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
}

function getInitials(name) {
  return String(name || "PT")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
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
  window.setTimeout(() => toast.classList.remove("show"), 2500);
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

async function handleLogout() {
  try {
    await window.PlacelyAuth.clearAuthState();
  } catch {
    sessionStorage.removeItem("placelyAuthGuardRedirecting");
  }

  window.location.replace("../candidates/candidate-login.html");
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
