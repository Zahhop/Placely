const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const JOBS_TABLE = "jobs";

const jobsGrid = document.getElementById("jobsGrid");
const emptyState = document.getElementById("emptyState");

const activeJobsCount = document.getElementById("activeJobsCount");
const pausedJobsCount = document.getElementById("pausedJobsCount");
const applicationsCount = document.getElementById("applicationsCount");
const reviewCount = document.getElementById("reviewCount");

const filterButtons = document.querySelectorAll(".filter-btn");
const logoutBtn = document.getElementById("logoutBtn");

let allJobs = [];
let currentFilter = "all";

document.addEventListener("DOMContentLoaded", initManageJobs);

async function initManageJobs() {
  setupHeaderButtons();
  setupLogout();
  setupFilters();

  const user = await requireEmployerLogin();
  if (!user) return;

  await loadEmployerJobs(user.id);
}

function setupHeaderButtons() {
  const routes = {
    Jobs: "manage-jobs.html",
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

    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.href = link.href;
    });
  });

  document.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href");

    if (!href || href === "#") return;

    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.href = href;
    });
  });
}

async function requireEmployerLogin() {
  const {
    data: { user },
    error
  } = await supabaseClient.auth.getUser();

  if (error || !user) {
    window.location.href = "employer-login.html";
    return null;
  }

  const { data: profile, error: profileError } = await supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.warn("Profile role check failed:", profileError);
    return user;
  }

  if (profile?.role && profile.role !== "employer") {
    window.location.href = "../candidate/candidate-dashboard.html";
    return null;
  }

  return user;
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

  renderJobs();
  updateStats();
}

function renderJobs() {
  jobsGrid.innerHTML = "";

  const visibleJobs = allJobs.filter((job) => {
    const status = normalizeStatus(job.status);

    if (currentFilter === "all") return true;
    return status === currentFilter;
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
  const card = document.createElement("div");
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

  card.innerHTML = `
    <div class="job-top">
      <div>
        <h3>${escapeHTML(title)}</h3>
        <p>${escapeHTML(company)} • ${escapeHTML(location)}</p>
      </div>

      <span class="status ${status}">${capitalize(status)}</span>
    </div>

    <div class="job-meta">
      <span>${escapeHTML(pay)}</span>
      <span>${escapeHTML(type)}</span>
      <span>${escapeHTML(experience)}</span>
      <span>${escapeHTML(posted)}</span>
    </div>

    <p class="job-description">${escapeHTML(description)}</p>

    <div class="tag-row">
      ${skills.map((skill) => `<span>${escapeHTML(skill)}</span>`).join("")}
    </div>

    <div class="job-actions">
      <a class="primary" href="edit-jobs.html?id=${job.id}">Edit Job</a>
      <a class="secondary" href="job-applicants.html?id=${job.id}">Applicants</a>
      ${
        status === "paused"
          ? `<button class="success" data-id="${job.id}" data-status="active">Reactivate</button>`
          : `<button class="danger" data-id="${job.id}" data-status="paused">Pause</button>`
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
    .eq("id", jobId);

  if (error) {
    console.error("Error updating job status:", error);
    alert("Could not update this job. Check your Supabase RLS update policy.");
    return;
  }

  allJobs = allJobs.map((job) => {
    if (job.id === jobId) {
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

  activeJobsCount.textContent = activeJobs.length;
  pausedJobsCount.textContent = pausedJobs.length;

  /*
    You do not currently have an applications table connected here,
    so these stay at 0 until we build that table/page.
  */
  applicationsCount.textContent = "0";
  reviewCount.textContent = "0";
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

function setupLogout() {
  if (!logoutBtn) return;

  logoutBtn.addEventListener("click", async () => {
    const { error } = await supabaseClient.auth.signOut();

    if (error) {
      console.error("Logout error:", error);
      alert("Logout failed. Try again.");
      return;
    }

    window.location.href = "employer-login.html";
  });
}

function parseSkills(skills) {
  if (!skills) return ["Trades", "Hiring"];

  if (Array.isArray(skills)) {
    return skills.slice(0, 5);
  }

  return String(skills)
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeStatus(status) {
  if (!status) return "active";

  const clean = String(status).toLowerCase().trim();

  if (clean === "paused" || clean === "inactive" || clean === "closed") {
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

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}