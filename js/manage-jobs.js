const supabaseClient = window.employerSupabase;

if (!supabaseClient) {
  console.error("Employer Supabase client was not initialized.");
}

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

let allJobs = [];
let applicationCountsByJob = {};
let reviewCountsByJob = {};
let interviewCountsByJob = {};
let currentFilter = "all";
let currentUserId = null;

document.addEventListener("DOMContentLoaded", initManageJobs);

async function initManageJobs() {
  setupHeaderButtons();
  setupLogout();
  setupFilters();
  setupSearchAndSort();
  setupDashboardShell();

  const user = await requireEmployerLogin();
  if (!user) return;

  currentUserId = user.id;
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
    console.error("Error loading employer jobs:", error);
    allJobs = [];
    renderJobs();
    updateStats();
    return;
  }

  allJobs = data || [];
  await loadApplicationCounts(userId);

  renderJobs();
  updateStats();
}

async function loadApplicationCounts(userId) {
  const { data, error } = await supabaseClient
    .from("applications")
    .select("job_id, status")
    .eq("employer_id", userId);

  if (error) {
    console.warn("Could not load job application counts:", error);
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
  const pay = job.pay_range || "Pay not listed";
  const experience = job.experience_level || "Experience not listed";
  const description = job.job_description || "No job description added yet.";
  const skills = parseSkills(job.required_skills);
  const status = normalizeStatus(job.status);
  const posted = formatDate(job.created_at);
  const applicationCount = applicationCountsByJob[String(job.id)] || 0;

  card.innerHTML = `
    <div class="job-main">
      <div class="job-title-row">
        <h3>${escapeHTML(title)}</h3>
        <span class="status ${status}">${escapeHTML(capitalize(status))}</span>
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
    </div>

    <div class="job-actions">
      <a class="primary" href="employer-applicants.html?job=${encodeURIComponent(job.id)}">Applicants</a>
      <a class="secondary" href="edit-jobs.html?id=${encodeURIComponent(job.id)}">Edit</a>
      ${
        status === "paused"
          ? `<button class="more-action" type="button" aria-label="Activate ${escapeHTML(title)}" title="Activate" data-id="${escapeHTML(job.id)}" data-status="active">...</button>`
          : `<button class="more-action" type="button" aria-label="Pause ${escapeHTML(title)}" title="Pause" data-id="${escapeHTML(job.id)}" data-status="paused">...</button>`
      }
    </div>
  `;

  const statusButton = card.querySelector("button[data-status]");

  if (statusButton) {
    statusButton.addEventListener("click", () => {
      updateJobStatus(job.id, statusButton.dataset.status);
    });
  }

  return card;
}

async function updateJobStatus(jobId, newStatus) {
  const { error } = await supabaseClient
    .from(JOBS_TABLE)
    .update({ status: newStatus })
    .eq("id", jobId)
    .eq("employer_id", currentUserId);

  if (error) {
    console.error("Error updating job status:", error);
    alert("Could not update this job. Check your Supabase RLS update policy.");
    return;
  }

  allJobs = allJobs.map((job) => {
    if (String(job.id) === String(jobId)) {
      return { ...job, status: newStatus };
    }

    return job;
  });

  renderJobs();
  updateStats();
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
    } catch (error) {
      console.error("Logout error:", error);
      alert("Logout failed. Try again.");
      return;
    }

    window.location.href = "employer-login.html";
  });
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

  if (["paused", "inactive", "closed"].includes(clean)) {
    return "paused";
  }

  return "active";
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
