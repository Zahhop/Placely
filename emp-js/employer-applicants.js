const applicantsSupabase = window.employerSupabase;

if (!applicantsSupabase) {
  console.error("Employer Supabase client was not initialized.");
}

const STAGES = [
  { id: "new", label: "New", empty: "No applicants" },
  { id: "reviewing", label: "Reviewing", empty: "Drag applicants here" },
  { id: "interview", label: "Interview", empty: "No interviews yet" },
  { id: "offer", label: "Offer", empty: "No offers yet" },
  { id: "hired", label: "Hired", empty: "No hires yet" }
];

const ARCHIVED_STATUSES = ["rejected", "withdrawn", "candidate_deleted"];
const MOVE_OPTIONS = [...STAGES.map((stage) => stage.id), "rejected", "withdrawn"];
const RESTORE_OPTIONS = ["new", "reviewing", "interview", "offer"];

const pipelineBoard = document.getElementById("pipelineBoard");
const archivedApplicants = document.getElementById("archivedApplicants");
const loadingState = document.getElementById("loadingState");
const pipelineSummary = document.getElementById("pipelineSummary");
const selectedJobContext = document.getElementById("selectedJobContext");
const selectedJobManageLink = document.getElementById("selectedJobManageLink");
const jobSelectorBtn = document.getElementById("jobSelectorBtn");
const jobSelectorPopover = document.getElementById("jobSelectorPopover");
const jobList = document.getElementById("jobList");
const jobSearchInput = document.getElementById("jobSearchInput");
const applicantDetail = document.getElementById("applicantDetail");
const searchInput = document.getElementById("searchInput");
const jobFilter = document.getElementById("jobFilter");
const sortFilter = document.getElementById("sortFilter");
const availabilityFilter = document.getElementById("availabilityFilter");
const hasResumeFilter = document.getElementById("hasResumeFilter");
const hasNotesFilter = document.getElementById("hasNotesFilter");
const filtersMenuBtn = document.getElementById("filtersMenuBtn");
const filtersPopover = document.getElementById("filtersPopover");
const refreshBtn = document.getElementById("refreshBtn");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const toast = document.getElementById("toast");
const logoutBtn = document.getElementById("logoutBtn");
const applicantDrawer = document.getElementById("applicantDrawer");
const drawerOverlay = document.getElementById("drawerOverlay");
const closeDrawerBtn = document.getElementById("closeDrawerBtn");
const viewButtons = document.querySelectorAll(".view-btn");

let currentUser = null;
let employerJobs = [];
let allApplications = [];
let selectedJobId = "";
let selectedApplicationId = null;
let activeView = "active";
let activeDrawerTab = "overview";
let draggedApplicationId = null;
let openMenuId = null;
let lastFocusedElement = null;
let suppressNextCardClick = false;
let explicitInitialJob = false;
const updatingApplications = new Set();
const statusHistoryCache = new Map();
const noteDrafts = new Map();

document.addEventListener("DOMContentLoaded", initApplicants);

async function initApplicants() {
  const user = await verifyEmployerAccess(applicantsSupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });

  if (!user) return;
  currentUser = user;

  setupEvents();
  await loadApplicants();
}

function setupEvents() {
  [searchInput, sortFilter, availabilityFilter, hasResumeFilter, hasNotesFilter].forEach((el) => {
    if (!el) return;
    el.addEventListener("input", debounce(renderApplicants, 120));
    el.addEventListener("change", renderApplicants);
  });

  if (jobSearchInput) jobSearchInput.addEventListener("input", debounce(renderJobNavigation, 120));
  if (jobFilter) jobFilter.addEventListener("change", () => selectJob(jobFilter.value));
  if (jobSelectorBtn) {
    jobSelectorBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setJobSelectorOpen(jobSelectorPopover?.classList.contains("hidden"));
    });
  }
  if (refreshBtn) refreshBtn.addEventListener("click", () => loadApplicants({ refreshing: true }));
  if (clearFiltersBtn) clearFiltersBtn.addEventListener("click", clearFilters);
  if (drawerOverlay) drawerOverlay.addEventListener("click", closeApplicantDrawer);
  if (closeDrawerBtn) closeDrawerBtn.addEventListener("click", closeApplicantDrawer);

  if (filtersMenuBtn) {
    filtersMenuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = !filtersPopover?.classList.contains("hidden");
      setFiltersOpen(!isOpen);
    });
  }

  viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeView = button.dataset.view || "active";
      closeMoveMenu();
      renderApplicants();
    });
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".card-menu-wrap") && openMenuId) {
      closeMoveMenu();
      renderApplicants();
    }

    if (!event.target.closest(".filter-menu-wrap")) {
      setFiltersOpen(false);
    }

    if (!event.target.closest(".job-selector-wrap")) {
      setJobSelectorOpen(false);
    }
  });

  document.addEventListener("keydown", handleDocumentKeydown);

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await applicantsSupabase.auth.signOut();
      window.location.href = "employer-login.html";
    });
  }
}

async function loadApplicants(options = {}) {
  setLoading(true, options.refreshing ? "Refreshing applicants" : "Loading applicants");

  const { data: jobs, error: jobsError } = await applicantsSupabase
    .from("jobs")
    .select("id, job_title, employer_id, company_name, location, employment_type, status, created_at")
    .eq("employer_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (jobsError) {
    logSupabaseError("Employer jobs load error:", jobsError);
    renderLoadError("Could not load your jobs", "Applicants can only be shown for jobs owned by your employer account.");
    return;
  }

  employerJobs = jobs || [];
  setInitialSelectedJob();
  populateJobFilter();

  const jobIds = employerJobs.map((job) => job.id).filter(Boolean);
  if (!jobIds.length) {
    allApplications = [];
    renderJobNavigation();
    renderApplicants();
    setLoading(false);
    return;
  }

  const { data, error } = await applicantsSupabase
    .from("applications")
    .select("*")
    .in("job_id", jobIds)
    .order("created_at", { ascending: false });

  if (error) {
    logSupabaseError("Applicants load error:", error);
    renderLoadError("Could not load applicants", "Check the applications table, job ownership, and RLS policies.");
    return;
  }

  allApplications = await hydrateApplications(data || []);
  if (!explicitInitialJob) {
    selectedJobId = getMostRelevantJobId();
    populateJobFilter();
    updateUrlJobParam(selectedJobId);
  }
  renderJobNavigation();
  renderApplicants();
  setLoading(false);

  if (selectedApplicationId && applicantDrawer?.classList.contains("open")) {
    renderDetail();
  }

  if (options.refreshing) showToast("Applicant pipeline refreshed.", "success");
}

async function hydrateApplications(applications) {
  const candidateIds = [...new Set(applications.map((app) => app.candidate_id).filter(Boolean))];
  const candidatesById = await loadCandidateProfiles(candidateIds);
  const jobsById = new Map(employerJobs.map((job) => [String(job.id), job]));

  return applications.map((app) => {
    const snapshot = parseSnapshot(app.candidate_snapshot);
    const candidate = candidatesById[String(app.candidate_id || "")] || {};
    const job = jobsById.get(String(app.job_id || "")) || {};

    return {
      ...app,
      normalized_status: normalizeStatus(app.status || app.employer_status),
      job_title: app.job_title || job.job_title || "Untitled Job",
      company_name: app.company_name || job.company_name || "Company",
      job_location: job.location || app.location || "",
      employment_type: job.employment_type || app.employment_type || "",
      candidate_name: snapshot.full_name || app.candidate_name || candidate.full_name || "Candidate",
      candidate_trade: snapshot.trade || app.candidate_role || candidate.trade || "Trade not listed",
      candidate_location: snapshot.location || app.location || candidate.location || "Location not listed",
      candidate_email: snapshot.email || app.candidate_email || candidate.email || "",
      candidate_phone: snapshot.phone || app.candidate_phone || candidate.phone || "",
      candidate_experience: snapshot.experience || candidate.experience || "Experience not listed",
      candidate_availability: snapshot.availability || candidate.availability || "Availability not listed",
      candidate_contact_method: snapshot.contact_method || candidate.contact_method || "",
      candidate_skills: snapshot.skills || candidate.skills || "",
      candidate_certifications: snapshot.certifications || candidate.certifications || "",
      candidate_bio: snapshot.bio || snapshot.biography || candidate.bio || candidate.biography || "",
      candidate_photo: snapshot.profile_photo_url || candidate.profile_photo_url || "",
      resume_url: snapshot.resume_url || app.resume_url || candidate.resume_url || "",
      employer_notes: app.employer_notes || "",
      additional_notes: app.additional_notes || ""
    };
  });
}

async function loadCandidateProfiles(candidateIds) {
  if (!candidateIds.length) return {};

  const { data, error } = await applicantsSupabase
    .from("candidate_profiles")
    .select("*")
    .in("id", candidateIds);

  if (error) {
    logSupabaseError("Candidate profiles load error:", error);
    return {};
  }

  return Object.fromEntries((data || []).map((candidate) => [String(candidate.id), candidate]));
}

function setInitialSelectedJob() {
  if (!employerJobs.length) {
    selectedJobId = "";
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const urlJob = params.get("job");
  const storedJob = localStorage.getItem("placelyApplicantsSelectedJob");
  const validJob = [urlJob, storedJob, selectedJobId].find((id) =>
    id && employerJobs.some((job) => String(job.id) === String(id))
  );

  explicitInitialJob = Boolean(validJob);
  selectedJobId = String(validJob || employerJobs[0].id);
}

function getMostRelevantJobId() {
  if (!employerJobs.length) return "";

  const jobsWithRecentApplications = employerJobs
    .map((job) => {
      const latestApplication = allApplications
        .filter((app) => String(app.job_id) === String(job.id))
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];

      return {
        job,
        latestTime: latestApplication ? new Date(latestApplication.created_at || 0).getTime() : 0
      };
    })
    .sort((a, b) => b.latestTime - a.latestTime);

  if (jobsWithRecentApplications[0]?.latestTime) return String(jobsWithRecentApplications[0].job.id);

  const activeJob = employerJobs.find((job) => normalizeJobStatus(job.status) === "active");
  return String((activeJob || employerJobs[0]).id);
}

function populateJobFilter() {
  if (!jobFilter) return;

  jobFilter.innerHTML = `<option value="">Select job</option>`;
  employerJobs.forEach((job) => {
    const option = document.createElement("option");
    option.value = job.id;
    option.textContent = job.job_title || "Untitled Job";
    jobFilter.appendChild(option);
  });
  jobFilter.value = selectedJobId;
}

function selectJob(jobId) {
  if (!employerJobs.some((job) => String(job.id) === String(jobId))) return;
  selectedJobId = String(jobId);
  selectedApplicationId = null;
  activeDrawerTab = "overview";
  closeMoveMenu();
  closeApplicantDrawer();
  if (jobFilter) jobFilter.value = selectedJobId;
  localStorage.setItem("placelyApplicantsSelectedJob", selectedJobId);
  updateUrlJobParam(selectedJobId);
  setJobSelectorOpen(false);
  renderJobNavigation();
  renderApplicants();
}

function updateUrlJobParam(jobId) {
  const url = new URL(window.location.href);
  url.searchParams.set("job", jobId);
  window.history.replaceState({}, "", url);
}

function renderJobNavigation() {
  if (!jobList) return;

  const query = clean(jobSearchInput?.value || "");
  const jobs = employerJobs.filter((job) => {
    const searchable = clean([job.job_title, job.company_name, job.location, job.status].join(" "));
    return !query || searchable.includes(query);
  });

  if (!employerJobs.length) {
    jobList.innerHTML = `
      <div class="job-empty">
        <strong>No jobs posted</strong>
        <p>Create a job to start receiving applicants.</p>
      </div>
    `;
    return;
  }

  if (!jobs.length) {
    jobList.innerHTML = `
      <div class="job-empty">
        <strong>No jobs match</strong>
        <p>Try a broader job search.</p>
      </div>
    `;
    return;
  }

  jobList.innerHTML = jobs.map((job) => renderJobNavButton(job)).join("");
  jobList.querySelectorAll("[data-job-id]").forEach((button) => {
    button.addEventListener("click", () => selectJob(button.dataset.jobId));
  });
}

function renderJobNavButton(job) {
  const counts = getJobCounts(job.id);
  const isActive = String(job.id) === String(selectedJobId);
  const status = normalizeJobStatus(job.status);

  return `
    <button type="button" class="job-nav-item ${isActive ? "active" : ""}" data-job-id="${escapeHTML(job.id)}" role="option" aria-selected="${isActive}">
      <span class="job-nav-title">${escapeHTML(job.job_title || "Untitled Job")}</span>
      <span class="job-nav-meta">${escapeHTML(job.location || "Location not listed")} &middot; ${escapeHTML(capitalize(status))}</span>
      <span class="job-nav-counts">
        <span>${counts.active} active</span>
        <span>${counts.newCount} new</span>
        <span>${counts.archived} archived</span>
      </span>
    </button>
  `;
}

function renderApplicants() {
  updateViewButtons();
  updateClearFilters();
  renderSelectedJobContext();

  const selectedApps = getSelectedJobApplications();
  const filtered = getFilteredApplications(selectedApps);
  renderJobNavigation();

  const activeApplications = filtered.filter((app) => !ARCHIVED_STATUSES.includes(app.normalized_status));
  const archived = filtered.filter((app) => ARCHIVED_STATUSES.includes(app.normalized_status));

  if (activeView === "archived") {
    pipelineBoard.classList.add("hidden");
    archivedApplicants.classList.remove("hidden");
    renderArchivedApplicants(archived, selectedApps);
    return;
  }

  archivedApplicants.classList.add("hidden");
  pipelineBoard.classList.remove("hidden");
  renderPipeline(activeApplications, selectedApps);
}

function renderSelectedJobContext() {
  if (!selectedJobContext) return;

  const job = getSelectedJob();
  if (!job) {
    selectedJobContext.innerHTML = `
      <span class="selected-job-title">No job selected</span>
      <span class="selected-job-subtitle">Post or select a job to open its applicant pipeline.</span>
    `;
    if (selectedJobManageLink) selectedJobManageLink.href = "post-job.html";
    if (selectedJobManageLink) selectedJobManageLink.textContent = "Post Job";
    return;
  }

  const counts = getJobCounts(job.id);
  selectedJobContext.innerHTML = `
    <span class="selected-job-title">${escapeHTML(job.job_title || "Untitled Job")}</span>
    <span class="selected-job-subtitle">${escapeHTML(job.location || "Location not listed")} &middot; ${escapeHTML(job.employment_type || "Type not listed")} &middot; ${escapeHTML(capitalize(normalizeJobStatus(job.status)))}</span>
    <span class="selected-job-counts">${counts.active} active &middot; ${counts.newCount} new</span>
  `;
  if (selectedJobManageLink) selectedJobManageLink.href = `edit-jobs.html?id=${encodeURIComponent(job.id)}`;
  if (selectedJobManageLink) selectedJobManageLink.textContent = "Manage Job";
}

function renderPipeline(activeApplications, selectedApps) {
  if (!pipelineBoard) return;

  if (!employerJobs.length) {
    pipelineBoard.innerHTML = `
      <div class="empty-state board-empty">
        <div class="empty-icon">PT</div>
        <h3>No jobs posted yet</h3>
        <p>Create a job post before managing applicants in a pipeline.</p>
        <a href="post-job.html" class="primary-link">Post Job</a>
      </div>
    `;
    return;
  }

  if (!selectedApps.length) {
    pipelineBoard.innerHTML = `
      <div class="empty-state board-empty">
        <div class="empty-icon">PT</div>
        <h3>No applicants for this job yet</h3>
        <p>Applicants for the selected job will appear here as candidates apply.</p>
      </div>
    `;
    return;
  }

  if (!activeApplications.length) {
    pipelineBoard.innerHTML = `
      <div class="empty-state board-empty">
        <div class="empty-icon">PT</div>
        <h3>No active applicants match your filters</h3>
        <p>Try clearing search, secondary filters, or checking Archived.</p>
      </div>
    `;
    return;
  }

  pipelineBoard.innerHTML = STAGES.map((stage) => {
    const stageApps = activeApplications.filter((app) => getPipelineStage(app.normalized_status) === stage.id);
    return `
      <section class="pipeline-column" data-stage="${escapeHTML(stage.id)}" aria-label="${escapeHTML(stage.label)} stage">
        <div class="column-head">
          <div class="column-title">
            <span class="stage-dot ${escapeHTML(stage.id)}"></span>
            <h2>${escapeHTML(stage.label)}</h2>
          </div>
          <span class="count-badge">${stageApps.length}</span>
        </div>
        <div class="column-body">
          ${
            stageApps.length
              ? stageApps.map(renderApplicantCard).join("")
              : `<div class="column-empty">${escapeHTML(stage.empty)}</div>`
          }
        </div>
      </section>
    `;
  }).join("");

  bindPipelineEvents();
}

function renderApplicantCard(app) {
  const status = getPipelineStage(app.normalized_status);
  const compactMeta = getCompactMeta(app)[0] || "";
  const isUpdating = updatingApplications.has(String(app.id));

  return `
    <article class="applicant-card compact ${isUpdating ? "updating" : ""}" data-id="${escapeHTML(app.id)}" draggable="${isUpdating ? "false" : "true"}" tabindex="0" aria-label="Open details for ${escapeHTML(app.candidate_name)}">
      <div class="avatar">
        ${
          app.candidate_photo
            ? `<img src="${escapeHTML(app.candidate_photo)}" alt="">`
            : escapeHTML(getInitials(app.candidate_name))
        }
      </div>
      <div class="card-name">
        <h3>${escapeHTML(app.candidate_name)}</h3>
        <p>${escapeHTML(app.candidate_trade)} &middot; ${escapeHTML(shortLocation(app.candidate_location))}</p>
        ${compactMeta ? `<span class="card-signal">${escapeHTML(compactMeta)}</span>` : ""}
      </div>
      <div class="card-menu-wrap">
        <button type="button" class="card-menu-btn" data-menu-id="${escapeHTML(app.id)}" aria-haspopup="menu" aria-expanded="${openMenuId === String(app.id)}" aria-label="Move ${escapeHTML(app.candidate_name)}">...</button>
        ${openMenuId === String(app.id) ? renderMoveMenu(app, status) : ""}
      </div>
    </article>
  `;
}

function getCompactMeta(app) {
  const meta = [formatRelativeDate(app.created_at)];
  if (app.candidate_availability && app.candidate_availability !== "Availability not listed") meta.push(app.candidate_availability);
  if (app.resume_url) meta.push("Resume");
  if (getNoteValue(app)) meta.push("Note");
  return meta.slice(0, 3);
}

function renderMoveMenu(app, currentStatus) {
  const options = MOVE_OPTIONS.filter((status) => status !== currentStatus);

  return `
    <div class="move-menu" role="menu" aria-label="Move applicant">
      ${options.map((status) => `
        <button type="button" class="move-option ${ARCHIVED_STATUSES.includes(status) ? "danger" : ""}" role="menuitem" data-move-id="${escapeHTML(app.id)}" data-status="${escapeHTML(status)}">
          Move to ${escapeHTML(getStatusLabel(status))}
        </button>
      `).join("")}
    </div>
  `;
}

function renderArchivedApplicants(archived, selectedApps) {
  if (!archivedApplicants) return;

  if (!employerJobs.length) {
    archivedApplicants.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">PT</div>
        <h3>No jobs posted yet</h3>
        <p>Archived applicants will appear after jobs receive applications.</p>
      </div>
    `;
    return;
  }

  if (!selectedApps.length) {
    archivedApplicants.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">PT</div>
        <h3>No applicants for this job yet</h3>
        <p>Archived applicants for this selected job will appear here.</p>
      </div>
    `;
    return;
  }

  if (!archived.length) {
    archivedApplicants.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">PT</div>
        <h3>No archived applicants match your filters</h3>
        <p>Rejected and withdrawn applicants for this job will appear here.</p>
      </div>
    `;
    return;
  }

  const singleJob = Boolean(selectedJobId);
  archivedApplicants.innerHTML = archived.map((app) => {
    const status = app.normalized_status;

    return `
      <article class="archive-card" data-id="${escapeHTML(app.id)}">
        <div>
          <h3>${escapeHTML(app.candidate_name)}</h3>
          <p class="archive-meta">${escapeHTML(app.candidate_trade)} &middot; ${escapeHTML(app.candidate_location)}</p>
          ${singleJob ? "" : `<p class="archive-meta">Applied for ${escapeHTML(app.job_title || "Untitled Job")}</p>`}
        </div>
        <div>
          <span class="status-pill ${escapeHTML(status)}">${escapeHTML(getStatusLabel(status))}</span>
          <p class="archive-meta">${escapeHTML(formatDate(app.updated_at || app.created_at))}</p>
        </div>
        <div class="archive-actions">
          <button type="button" class="quiet-btn" data-open-id="${escapeHTML(app.id)}">Details</button>
          ${
            status === "candidate_deleted"
              ? ""
              : `<select class="archive-restore-select" data-restore-id="${escapeHTML(app.id)}" aria-label="Restore applicant stage">
                  <option value="">Restore to...</option>
                  ${RESTORE_OPTIONS.map((option) => `<option value="${escapeHTML(option)}">${escapeHTML(getStatusLabel(option))}</option>`).join("")}
                </select>`
          }
        </div>
      </article>
    `;
  }).join("");

  archivedApplicants.querySelectorAll("[data-open-id]").forEach((button) => {
    button.addEventListener("click", () => openApplicantDrawer(button.dataset.openId));
  });

  archivedApplicants.querySelectorAll("[data-restore-id]").forEach((select) => {
    select.addEventListener("change", () => {
      if (select.value) moveApplication(select.dataset.restoreId, select.value);
    });
  });
}

function bindPipelineEvents() {
  pipelineBoard.querySelectorAll(".applicant-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.target.closest(".card-menu-wrap")) return;
      if (card.classList.contains("dragging") || suppressNextCardClick) {
        suppressNextCardClick = false;
        return;
      }
      openApplicantDrawer(card.dataset.id);
    });

    card.addEventListener("keydown", (event) => {
      if (event.target.closest(".card-menu-wrap")) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openApplicantDrawer(card.dataset.id);
      }
    });

    card.addEventListener("dragstart", (event) => {
      draggedApplicationId = card.dataset.id;
      suppressNextCardClick = true;
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedApplicationId);
    });

    card.addEventListener("dragend", () => {
      draggedApplicationId = null;
      card.classList.remove("dragging");
      setTimeout(() => {
        suppressNextCardClick = false;
      }, 80);
      pipelineBoard.querySelectorAll(".pipeline-column").forEach((column) => {
        column.classList.remove("drag-over");
      });
    });
  });

  pipelineBoard.querySelectorAll(".pipeline-column").forEach((column) => {
    column.addEventListener("dragover", (event) => {
      event.preventDefault();
      column.classList.add("drag-over");
      event.dataTransfer.dropEffect = "move";
    });

    column.addEventListener("dragleave", (event) => {
      if (!column.contains(event.relatedTarget)) column.classList.remove("drag-over");
    });

    column.addEventListener("drop", (event) => {
      event.preventDefault();
      column.classList.remove("drag-over");
      const applicationId = event.dataTransfer.getData("text/plain") || draggedApplicationId;
      const stage = column.dataset.stage;
      if (applicationId && stage) moveApplication(applicationId, stage);
    });
  });

  pipelineBoard.querySelectorAll(".card-menu-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openMenuId = openMenuId === String(button.dataset.menuId) ? null : String(button.dataset.menuId);
      renderApplicants();
    });
  });

  pipelineBoard.querySelectorAll(".move-option").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      moveApplication(button.dataset.moveId, button.dataset.status);
    });
  });
}

function getSelectedJobApplications() {
  if (!selectedJobId) return [];
  return allApplications.filter((app) => String(app.job_id) === String(selectedJobId));
}

function getFilteredApplications(sourceApplications) {
  let list = [...sourceApplications];
  const search = searchInput?.value?.toLowerCase().trim() || "";
  const sortValue = sortFilter?.value || "newest";
  const availabilityValue = clean(availabilityFilter?.value || "");
  const requireResume = Boolean(hasResumeFilter?.checked);
  const requireNotes = Boolean(hasNotesFilter?.checked);

  if (search) {
    list = list.filter((app) =>
      [
        app.candidate_name,
        app.candidate_trade,
        app.candidate_location,
        app.job_title,
        app.company_name,
        app.normalized_status,
        app.candidate_skills,
        app.candidate_certifications,
        app.cover_letter,
        app.additional_notes,
        getNoteValue(app)
      ]
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }

  if (availabilityValue) {
    list = list.filter((app) => clean(app.candidate_availability).includes(availabilityValue));
  }

  if (requireResume) {
    list = list.filter((app) => Boolean(app.resume_url));
  }

  if (requireNotes) {
    list = list.filter((app) => Boolean(getNoteValue(app)));
  }

  if (sortValue === "newest") {
    list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }

  if (sortValue === "oldest") {
    list.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  }

  if (sortValue === "candidate") {
    list.sort((a, b) => String(a.candidate_name || "").localeCompare(String(b.candidate_name || "")));
  }

  return list;
}

async function moveApplication(applicationId, nextStatus) {
  const app = allApplications.find((item) => String(item.id) === String(applicationId));
  if (!app || updatingApplications.has(String(applicationId))) return;

  const previousStatus = app.normalized_status;
  const normalizedNext = normalizeStatus(nextStatus);
  if (previousStatus === normalizedNext) return;

  if (["rejected", "withdrawn"].includes(normalizedNext)) {
    const confirmed = await confirmArchiveMove(app, normalizedNext);
    if (!confirmed) return;
  }

  if (!employerJobs.some((job) => String(job.id) === String(app.job_id))) {
    showToast("This applicant is not attached to one of your jobs.", "error");
    return;
  }

  closeMoveMenu();
  updatingApplications.add(String(applicationId));

  const previousSnapshot = { ...app };
  const updatePayload = buildStatusPayload(normalizedNext);
  Object.assign(app, updatePayload, { normalized_status: normalizedNext });
  renderApplicants();
  renderDetail();

  const { error } = await updateApplicationWithSchemaFallback(applicationId, updatePayload);

  if (error) {
    Object.assign(app, previousSnapshot);
    updatingApplications.delete(String(applicationId));
    renderApplicants();
    renderDetail();
    logSupabaseError("Status update error:", error);
    showToast("Could not update applicant stage. The card was restored.", "error");
    return;
  }

  await recordStatusHistory(applicationId, previousStatus, normalizedNext);
  statusHistoryCache.delete(String(applicationId));
  updatingApplications.delete(String(applicationId));
  renderApplicants();
  renderDetail();
  loadStatusHistory(applicationId);
  showToast(`Applicant moved to ${getStatusLabel(normalizedNext)}.`, "success");
}

function confirmArchiveMove(app, status) {
  return new Promise((resolve) => {
    const existingDialog = document.querySelector(".confirm-layer");
    if (existingDialog) existingDialog.remove();

    const layer = document.createElement("div");
    layer.className = "confirm-layer";
    layer.innerHTML = `
      <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
        <span class="eyebrow">Confirm Move</span>
        <h2 id="confirmTitle">Move to ${escapeHTML(getStatusLabel(status))}?</h2>
        <p>${escapeHTML(app.candidate_name)} will leave this active job pipeline and appear in Archived.</p>
        <div class="confirm-actions">
          <button type="button" class="quiet-btn" data-confirm="cancel">Cancel</button>
          <button type="button" class="drawer-action danger" data-confirm="move">Move Applicant</button>
        </div>
      </div>
    `;

    const finish = (value) => {
      document.removeEventListener("keydown", handleKeydown);
      layer.remove();
      resolve(value);
    };

    const handleKeydown = (event) => {
      if (event.key === "Escape") finish(false);
    };

    layer.addEventListener("click", (event) => {
      if (event.target === layer) finish(false);
      const action = event.target.dataset.confirm;
      if (action === "cancel") finish(false);
      if (action === "move") finish(true);
    });

    document.addEventListener("keydown", handleKeydown);
    document.body.appendChild(layer);
    layer.querySelector("[data-confirm='cancel']")?.focus();
  });
}

function buildStatusPayload(status) {
  const now = new Date().toISOString();
  const payload = {
    status,
    employer_status: status,
    updated_at: now
  };

  if (["reviewing", "interview", "offer", "hired", "rejected"].includes(status)) {
    payload.reviewed_at = now;
  }

  if (status === "interview") payload.interview_date = now;
  if (status === "offer") payload.offer_sent_at = now;
  if (status === "hired") payload.hired_at = now;
  if (status === "rejected") payload.rejected_at = now;
  if (status === "withdrawn") payload.withdrawn_at = now;

  return payload;
}

async function updateApplicationWithSchemaFallback(applicationId, payload) {
  let safePayload = { ...payload };
  const removedColumns = [];

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { error } = await applicantsSupabase
      .from("applications")
      .update(safePayload)
      .eq("id", applicationId)
      .eq("employer_id", currentUser.id);

    if (!error) return { error: null, removedColumns };

    const missingColumn = getMissingColumnName(error);
    if (!missingColumn || !(missingColumn in safePayload)) return { error };

    removedColumns.push(missingColumn);
    delete safePayload[missingColumn];
  }

  return {
    error: {
      message: "Application update failed after removing missing columns.",
      details: removedColumns.join(", "),
      hint: "Run the applicant pipeline SQL migration so all timeline columns can be stored.",
      code: "SCHEMA_FALLBACK_LIMIT"
    }
  };
}

async function recordStatusHistory(applicationId, previousStatus, newStatus) {
  if (previousStatus === newStatus) return;

  const { error } = await applicantsSupabase
    .from("application_status_history")
    .insert([{
      application_id: applicationId,
      employer_id: currentUser.id,
      previous_status: previousStatus,
      new_status: newStatus,
      changed_by: currentUser.id
    }]);

  if (error) {
    console.warn("Status history was not recorded. Run the applicant pipeline SQL migration to enable it.", error);
  }
}

async function loadStatusHistory(applicationId) {
  if (!applicationId || statusHistoryCache.has(String(applicationId))) return;

  const { data, error } = await applicantsSupabase
    .from("application_status_history")
    .select("*")
    .eq("application_id", applicationId)
    .order("changed_at", { ascending: false });

  statusHistoryCache.set(String(applicationId), error ? [] : data || []);

  if (error) {
    console.warn("Status history unavailable. Run the applicant pipeline SQL migration to enable it.", error);
  }

  if (String(selectedApplicationId) === String(applicationId) && activeDrawerTab === "activity") {
    renderDetail();
  }
}

function openApplicantDrawer(applicationId) {
  selectedApplicationId = applicationId;
  activeDrawerTab = "overview";
  lastFocusedElement = document.activeElement;
  renderDetail();

  if (applicantDrawer) {
    applicantDrawer.classList.add("open");
    applicantDrawer.setAttribute("aria-hidden", "false");
    closeDrawerBtn?.focus();
  }

  loadStatusHistory(applicationId);
}

function closeApplicantDrawer() {
  if (!applicantDrawer) return;
  applicantDrawer.classList.remove("open");
  applicantDrawer.setAttribute("aria-hidden", "true");
  selectedApplicationId = null;
  if (lastFocusedElement?.focus) lastFocusedElement.focus();
}

function renderDetail() {
  if (!applicantDetail || !selectedApplicationId) return;

  const app = allApplications.find((item) => String(item.id) === String(selectedApplicationId));

  if (!app) {
    applicantDetail.innerHTML = `
      <div class="empty-state compact-empty">
        <strong>Select an applicant</strong>
        <p>Choose a candidate from the pipeline to review details and update status.</p>
      </div>
    `;
    return;
  }

  const status = app.normalized_status;
  const canAct = status !== "candidate_deleted";

  applicantDetail.innerHTML = `
    <div class="detail-head applicant-detail-head">
      <div class="avatar large">
        ${
          app.candidate_photo
            ? `<img src="${escapeHTML(app.candidate_photo)}" alt="">`
            : escapeHTML(getInitials(app.candidate_name))
        }
      </div>

      <div>
        <h2>${escapeHTML(app.candidate_name)}</h2>
        <p class="detail-text">${escapeHTML(app.candidate_trade)} &middot; ${escapeHTML(app.candidate_location)}</p>
        <div class="drawer-stage-row">
          <span class="status-pill ${escapeHTML(status)}">${escapeHTML(getStatusLabel(status))}</span>
          <span>${escapeHTML(formatRelativeDate(app.created_at))}</span>
        </div>
      </div>
    </div>

    <div class="drawer-primary-actions">
      ${
        canAct
          ? `<button type="button" class="drawer-action primary" data-message-id="${escapeHTML(app.id)}">Message</button>
             <select id="drawerStageSelect" aria-label="Move applicant stage">
               ${MOVE_OPTIONS.map((option) => `<option value="${escapeHTML(option)}" ${option === status ? "selected" : ""}>${escapeHTML(getStatusLabel(option))}</option>`).join("")}
             </select>`
          : `<p class="detail-text detail-message">Candidate profile deleted. Submitted details remain available for record keeping.</p>`
      }
    </div>

    <div class="drawer-summary-grid">
      <div class="summary-item"><span>Experience</span><strong>${escapeHTML(app.candidate_experience)}</strong></div>
      <div class="summary-item"><span>Availability</span><strong>${escapeHTML(app.candidate_availability)}</strong></div>
      <div class="summary-item"><span>Resume</span><strong>${escapeHTML(app.resume_url ? "Uploaded" : "Not uploaded")}</strong></div>
      <div class="summary-item"><span>Contact</span><strong>${escapeHTML(app.candidate_contact_method || "Not listed")}</strong></div>
    </div>

    <div class="drawer-tabs" role="tablist" aria-label="Applicant details">
      ${["overview", "application", "activity", "notes"].map((tab) => `
        <button type="button" role="tab" class="${activeDrawerTab === tab ? "active" : ""}" data-tab="${escapeHTML(tab)}" aria-selected="${activeDrawerTab === tab}">
          ${escapeHTML(capitalize(tab))}
        </button>
      `).join("")}
    </div>

    <div class="drawer-tab-panel">
      ${renderDrawerTab(app)}
    </div>

    <div class="drawer-sticky-actions">
      <button type="button" class="drawer-action primary" data-message-id="${escapeHTML(app.id)}" ${canAct ? "" : "disabled"}>Message</button>
      ${
        app.resume_url
          ? `<a class="drawer-action" href="${escapeHTML(app.resume_url)}" target="_blank" rel="noopener">Resume</a>`
          : `<span class="drawer-action disabled">No Resume</span>`
      }
    </div>
  `;

  bindDrawerActions(app);
}

function renderDrawerTab(app) {
  if (activeDrawerTab === "application") return renderApplicationTab(app);
  if (activeDrawerTab === "activity") return renderActivityTab(app);
  if (activeDrawerTab === "notes") return renderNotesTab(app);
  return renderOverviewTab(app);
}

function renderOverviewTab(app) {
  const tags = getTags(app);

  return `
    <div class="detail-section">
      <h3>Biography</h3>
      <p class="detail-text detail-message">${escapeHTML(app.candidate_bio || "No biography listed.")}</p>
    </div>

    <div class="detail-section">
      <h3>Profile details</h3>
      <div class="detail-grid">
        <div class="detail-row"><span>Email</span><strong>${escapeHTML(app.candidate_email || "Not listed")}</strong></div>
        <div class="detail-row"><span>Phone</span><strong>${escapeHTML(app.candidate_phone || "Not listed")}</strong></div>
        <div class="detail-row"><span>Location</span><strong>${escapeHTML(app.candidate_location || "Not listed")}</strong></div>
        <div class="detail-row"><span>Trade</span><strong>${escapeHTML(app.candidate_trade || "Not listed")}</strong></div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Skills and certifications</h3>
      <div class="tag-row">
        ${tags.length ? tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("") : "<span>No skills or certifications listed</span>"}
      </div>
    </div>
  `;
}

function renderApplicationTab(app) {
  return `
    <div class="detail-section">
      <h3>Application</h3>
      <div class="detail-grid">
        <div class="detail-row"><span>Job</span><strong>${escapeHTML(app.job_title || "Untitled Job")}</strong></div>
        <div class="detail-row"><span>Company</span><strong>${escapeHTML(app.company_name || "Company")}</strong></div>
        <div class="detail-row"><span>Applied</span><strong>${escapeHTML(formatDate(app.created_at))}</strong></div>
        <div class="detail-row"><span>Current stage</span><strong>${escapeHTML(getStatusLabel(app.normalized_status))}</strong></div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Cover letter</h3>
      <p class="detail-text detail-message">${escapeHTML(app.cover_letter || "No cover letter included.")}</p>
      ${app.additional_notes ? `<p class="detail-text detail-message">${escapeHTML(app.additional_notes)}</p>` : ""}
    </div>
  `;
}

function renderActivityTab(app) {
  const history = statusHistoryCache.get(String(app.id)) || [];

  if (history.length) {
    return `
      <div class="detail-section">
        <h3>Stage history</h3>
        <div class="activity-timeline">
          ${history.map((entry) => `
            <div class="activity-row">
              <span>${escapeHTML(formatDateTime(entry.changed_at))}</span>
              <strong>${escapeHTML(getStatusLabel(normalizeStatus(entry.previous_status)))} to ${escapeHTML(getStatusLabel(normalizeStatus(entry.new_status)))}</strong>
              <p>${entry.changed_by ? "Changed by employer" : "Changed"}</p>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  return `
    <div class="detail-section">
      <h3>Activity</h3>
      <div class="timeline-grid">
        <div class="timeline-row"><span>Updated</span><strong>${escapeHTML(formatDate(app.updated_at))}</strong></div>
        <div class="timeline-row"><span>Reviewed</span><strong>${escapeHTML(formatDate(app.reviewed_at))}</strong></div>
        <div class="timeline-row"><span>Interview</span><strong>${escapeHTML(formatDate(app.interview_date))}</strong></div>
        <div class="timeline-row"><span>Offer</span><strong>${escapeHTML(formatDate(app.offer_sent_at))}</strong></div>
        <div class="timeline-row"><span>Hired</span><strong>${escapeHTML(formatDate(app.hired_at))}</strong></div>
        <div class="timeline-row"><span>Archived</span><strong>${escapeHTML(formatDate(app.rejected_at || app.withdrawn_at || app.candidate_deleted_at))}</strong></div>
      </div>
      <p class="detail-text activity-empty">Run the applicant pipeline SQL migration to enable detailed stage movement history.</p>
    </div>
  `;
}

function renderNotesTab(app) {
  const noteValue = noteDrafts.has(String(app.id)) ? noteDrafts.get(String(app.id)) : app.employer_notes || "";

  return `
    <div class="detail-section">
      <h3>Employer notes</h3>
      <div class="note-box">
        <textarea id="employerNotes" placeholder="Add internal notes for this application...">${escapeHTML(noteValue)}</textarea>
        <div class="note-actions">
          <span id="noteState" class="note-state">${noteDrafts.has(String(app.id)) ? "Unsaved changes" : ""}</span>
          <button type="button" id="saveNoteBtn" class="save-note-btn" ${noteValue === (app.employer_notes || "") ? "disabled" : ""}>Save Note</button>
        </div>
      </div>
    </div>
  `;
}

function bindDrawerActions(app) {
  const stageSelect = document.getElementById("drawerStageSelect");
  const saveNoteBtn = document.getElementById("saveNoteBtn");
  const noteInput = document.getElementById("employerNotes");

  applicantDetail.querySelectorAll("[data-message-id]").forEach((button) => {
    button.addEventListener("click", () => messageCandidate(app.id));
  });

  applicantDetail.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      preserveOpenNoteDraft(app.id);
      activeDrawerTab = button.dataset.tab || "overview";
      renderDetail();
      if (activeDrawerTab === "activity") loadStatusHistory(app.id);
    });
  });

  if (stageSelect) {
    stageSelect.addEventListener("change", () => moveApplication(app.id, stageSelect.value));
  }

  if (noteInput) {
    noteInput.addEventListener("input", () => {
      noteDrafts.set(String(app.id), noteInput.value);
      const noteState = document.getElementById("noteState");
      if (noteState) noteState.textContent = "Unsaved changes";
      if (saveNoteBtn) saveNoteBtn.disabled = noteInput.value === (app.employer_notes || "");
    });
  }

  if (saveNoteBtn) {
    saveNoteBtn.addEventListener("click", () => saveEmployerNote(app.id));
  }
}

function preserveOpenNoteDraft(applicationId) {
  const noteInput = document.getElementById("employerNotes");
  if (noteInput) noteDrafts.set(String(applicationId), noteInput.value);
}

async function saveEmployerNote(applicationId) {
  const app = allApplications.find((item) => String(item.id) === String(applicationId));
  const noteInput = document.getElementById("employerNotes");
  const noteState = document.getElementById("noteState");
  if (!app || !noteInput) return;

  const employer_notes = noteInput.value.trim();
  if (noteState) noteState.textContent = "Saving...";

  const { error } = await applicantsSupabase
    .from("applications")
    .update({ employer_notes, updated_at: new Date().toISOString() })
    .eq("id", applicationId)
    .eq("employer_id", currentUser.id);

  if (error) {
    logSupabaseError("Employer note save error:", error);
    if (noteState) noteState.textContent = "Could not save. Run the SQL migration if the notes field is missing.";
    showToast("Could not save employer note.", "error");
    return;
  }

  app.employer_notes = employer_notes;
  noteDrafts.delete(String(applicationId));
  if (noteState) noteState.textContent = "Saved.";
  if (document.getElementById("saveNoteBtn")) document.getElementById("saveNoteBtn").disabled = true;
  renderJobNavigation();
  renderApplicants();
  activeDrawerTab = "notes";
  renderDetail();
  showToast("Employer note saved.", "success");
}

async function messageCandidate(applicationId) {
  const app = allApplications.find((item) => String(item.id) === String(applicationId));
  if (!app || app.normalized_status === "candidate_deleted") return;

  window.location.href = buildMessageFallbackUrl(app);
}

function buildMessageFallbackUrl(app) {
  const params = new URLSearchParams({
    candidate_id: app.candidate_id || "",
    application_id: app.id || "",
    job_id: app.job_id || ""
  });

  return `employer-messages.html?${params.toString()}`;
}

function renderSummary(filtered) {
  if (!pipelineSummary) return;

  const active = filtered.filter((app) => !ARCHIVED_STATUSES.includes(app.normalized_status));
  const countFor = (status) => active.filter((app) => getPipelineStage(app.normalized_status) === status).length;
  const summaryItems = [
    { label: "Active", count: active.length },
    ...STAGES.map((stage) => ({ label: stage.label, count: countFor(stage.id) }))
  ];

  pipelineSummary.innerHTML = summaryItems.map((item) => `
    <div class="summary-pill">
      <span>${escapeHTML(item.label)}</span>
      <strong>${item.count}</strong>
    </div>
  `).join("");
}

function getJobCounts(jobId) {
  const apps = allApplications.filter((app) => String(app.job_id) === String(jobId));
  const active = apps.filter((app) => !ARCHIVED_STATUSES.includes(app.normalized_status));

  return {
    total: apps.length,
    active: active.length,
    newCount: active.filter((app) => getPipelineStage(app.normalized_status) === "new").length,
    interview: active.filter((app) => getPipelineStage(app.normalized_status) === "interview").length,
    archived: apps.filter((app) => ARCHIVED_STATUSES.includes(app.normalized_status)).length
  };
}

function updateViewButtons() {
  viewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === activeView);
  });
}

function updateClearFilters() {
  if (!clearFiltersBtn) return;

  const hasFilters =
    Boolean(searchInput?.value?.trim()) ||
    (sortFilter?.value && sortFilter.value !== "newest") ||
    Boolean(availabilityFilter?.value) ||
    Boolean(hasResumeFilter?.checked) ||
    Boolean(hasNotesFilter?.checked);

  clearFiltersBtn.classList.toggle("hidden", !hasFilters);
}

function clearFilters() {
  if (searchInput) searchInput.value = "";
  if (sortFilter) sortFilter.value = "newest";
  if (availabilityFilter) availabilityFilter.value = "";
  if (hasResumeFilter) hasResumeFilter.checked = false;
  if (hasNotesFilter) hasNotesFilter.checked = false;
  setFiltersOpen(false);
  renderApplicants();
}

function setFiltersOpen(isOpen) {
  if (!filtersPopover || !filtersMenuBtn) return;
  filtersPopover.classList.toggle("hidden", !isOpen);
  filtersMenuBtn.setAttribute("aria-expanded", String(isOpen));
}

function setJobSelectorOpen(isOpen) {
  if (!jobSelectorPopover || !jobSelectorBtn) return;
  jobSelectorPopover.classList.toggle("hidden", !isOpen);
  jobSelectorBtn.setAttribute("aria-expanded", String(isOpen));

  if (isOpen) {
    renderJobNavigation();
    setTimeout(() => jobSearchInput?.focus(), 0);
  }
}

function setLoading(isLoading, message = "Loading applicants") {
  if (!loadingState) return;
  loadingState.classList.toggle("hidden", !isLoading);
  if (isLoading) {
    loadingState.innerHTML = `
      <div class="empty-icon">PT</div>
      <h3>${escapeHTML(message)}</h3>
      <p>Building your hiring pipeline.</p>
    `;
  }
}

function renderLoadError(title, message) {
  setLoading(false);
  if (!pipelineBoard) return;
  pipelineBoard.classList.remove("hidden");
  archivedApplicants.classList.add("hidden");
  pipelineBoard.innerHTML = `
    <div class="empty-state board-empty">
      <div class="empty-icon">!</div>
      <h3>${escapeHTML(title)}</h3>
      <p>${escapeHTML(message)}</p>
    </div>
  `;
}

function closeMoveMenu() {
  openMenuId = null;
}

function handleDocumentKeydown(event) {
  if (event.key === "Escape") {
    closeMoveMenu();
    setFiltersOpen(false);
    setJobSelectorOpen(false);
    closeApplicantDrawer();
    return;
  }

  if (event.key === "Tab" && applicantDrawer?.classList.contains("open")) {
    trapDrawerFocus(event);
  }
}

function trapDrawerFocus(event) {
  const focusable = applicantDrawer.querySelectorAll(
    "a[href], button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"
  );

  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function getSelectedJob() {
  return employerJobs.find((job) => String(job.id) === String(selectedJobId)) || null;
}

function getPipelineStage(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "submitted") return "new";
  return STAGES.some((stage) => stage.id === normalized) ? normalized : "new";
}

function normalizeStatus(status) {
  const value = String(status || "submitted").toLowerCase().trim();

  if (value === "new") return "new";
  if (["applied", "submitted"].includes(value)) return "submitted";
  if (["review", "reviewing", "viewed", "in review", "under_review"].includes(value)) return "reviewing";
  if (["interview", "interviewing", "interview requested"].includes(value)) return "interview";
  if (["offer", "offered"].includes(value)) return "offer";
  if (["hired", "accepted"].includes(value)) return "hired";
  if (["rejected", "declined"].includes(value)) return "rejected";
  if (["withdrawn", "withdraw", "candidate_withdrew"].includes(value)) return "withdrawn";
  if (["candidate_deleted", "candidate_profile_deleted", "deleted"].includes(value)) return "candidate_deleted";

  return "submitted";
}

function normalizeJobStatus(status) {
  const value = String(status || "active").toLowerCase().trim();
  if (["paused", "inactive", "closed"].includes(value)) return "paused";
  return "active";
}

function getStatusLabel(status) {
  const labels = {
    new: "New",
    submitted: "New",
    reviewing: "Reviewing",
    interview: "Interview",
    offer: "Offer",
    hired: "Hired",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
    candidate_deleted: "Candidate Profile Deleted"
  };

  return labels[status] || "New";
}

function shortLocation(value) {
  const text = String(value || "Location not listed").trim();
  return text.split(",")[0].trim() || text;
}

function parseSnapshot(snapshot) {
  if (!snapshot) return {};
  if (typeof snapshot === "object") return snapshot;

  try {
    return JSON.parse(snapshot);
  } catch {
    return {};
  }
}

function getTags(app) {
  const tags = [];
  if (app.candidate_skills) tags.push(...String(app.candidate_skills).split(","));
  if (app.candidate_certifications) tags.push(...String(app.candidate_certifications).split(","));
  return tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 12);
}

function getNoteValue(app) {
  return noteDrafts.get(String(app.id)) || app.employer_notes || "";
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatDateTime(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatRelativeDate(value) {
  if (!value) return "Date not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not set";

  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 0) return "Applied today";
  if (days === 1) return "Applied 1d ago";
  if (days < 30) return `Applied ${days}d ago`;
  return `Applied ${formatDate(value)}`;
}

function getInitials(name) {
  return String(name || "PT")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function capitalize(value) {
  return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
}

function clean(value) {
  return String(value || "").toLowerCase().trim();
}

function debounce(callback, delay) {
  let timeout;

  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback.apply(this, args), delay);
  };
}

function showToast(message, type = "") {
  if (!toast) return;

  toast.textContent = message;
  toast.className = `toast show ${type}`.trim();

  setTimeout(() => {
    toast.className = "toast";
  }, 3000);
}

function getMissingColumnName(error) {
  const text = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  const match =
    text.match(/'([^']+)' column/i) ||
    text.match(/column "([^"]+)"/i) ||
    text.match(/Could not find the '([^']+)'/i);

  return match?.[1] || "";
}

function logSupabaseError(label, error) {
  console.error(label, {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code
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
