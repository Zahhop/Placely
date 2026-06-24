const jobsSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const JOBS_TABLE = "jobs";

let allJobs = [];
let filteredJobs = [];
let selectedJob = null;
let currentUser = null;
let savedJobIds = [];
let employerLogos = {};

const jobsList = document.getElementById("jobsList");
const jobDetails = document.getElementById("jobDetails");
const jobCount = document.getElementById("jobCount");
const jobDetailsModal = document.getElementById("jobDetailsModal");
const jobModalOverlay = document.getElementById("jobModalOverlay");
const closeJobModalBtn = document.getElementById("closeJobModalBtn");

const keywordInput = document.getElementById("keywordInput");
const locationFilter = document.getElementById("locationFilter");
const typeFilter = document.getElementById("typeFilter");
const searchBtn = document.getElementById("searchBtn");

function showToast(message) {
  const toast = document.getElementById("toast");

  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}

function clean(value, fallback = "Not listed") {
  return value || fallback;
}

function normalizeJob(job) {
  return {
    id: job.id,
    employer_id: job.employer_id,
    title: job.job_title || "Untitled Job",
    company: job.company_name || "Employer",
    location: job.location || "Location not listed",
    type: job.employment_type || "Full-time",
    pay: job.pay_range || "Pay not listed",
    trade: job.experience_level || "Trades",
    description: job.job_description || "No description provided yet.",
    requirements: job.required_skills || "Requirements not listed.",
    benefits: job.benefits || "",
    status: job.status || "active",
    created_at: job.created_at,
    raw: job
  };
}

async function loadCurrentUser() {
  const {
    data: { user },
    error
  } = await jobsSupabase.auth.getUser();

  if (error || !user) {
    window.location.href = "../candidates/candidate-login.html";
    return null;
  }

  currentUser = user;
  return user;
}

async function loadSavedJobIds() {
  if (!currentUser) return;

  const { data, error } = await jobsSupabase
    .from("saved_jobs")
    .select("job_id")
    .eq("candidate_id", currentUser.id);

  if (error) {
    console.error("Error loading saved jobs:", error);
    savedJobIds = [];
    return;
  }

  savedJobIds = (data || []).map((row) => String(row.job_id));
}

async function loadEmployerLogos(jobs) {
  const employerIds = [...new Set(jobs.map((job) => job.employer_id).filter(Boolean))];

  if (!employerIds.length) {
    employerLogos = {};
    return;
  }

  const { data, error } = await jobsSupabase
    .from("employer_profiles")
    .select("*")
    .in("id", employerIds);

  if (error) {
    console.warn("Could not load employer logos:", error);
    employerLogos = {};
    return;
  }

  employerLogos = {};

  (data || []).forEach((profile) => {
    employerLogos[String(profile.id)] =
      profile.company_logo_url ||
      profile.logo_url ||
      profile.company_logo ||
      profile.company_logo_preview ||
      "";
  });
}

async function loadJobs() {
  const user = await loadCurrentUser();
  if (!user) return;

  await loadSavedJobIds();

  const { data, error } = await jobsSupabase
    .from(JOBS_TABLE)
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading jobs:", error);

    jobsList.innerHTML = `
      <div class="empty-state">
        Could not load jobs from Supabase. Check your RLS policy and jobs table.
      </div>
    `;
    return;
  }

  allJobs = (data || []).map(normalizeJob);
  await loadEmployerLogos(allJobs);
  filteredJobs = [...allJobs];

  populateLocations();
  renderJobs();

  const params = new URLSearchParams(window.location.search);
  const jobIdFromUrl = params.get("job");

  if (
    jobIdFromUrl &&
    filteredJobs.some((job) => String(job.id) === String(jobIdFromUrl))
  ) {
    openJobDetails(jobIdFromUrl);
  }
}

function populateLocations() {
  const locations = [
    ...new Set(allJobs.map((job) => job.location).filter(Boolean))
  ];

  locationFilter.innerHTML = `<option value="">All locations</option>`;

  locations.forEach((location) => {
    const option = document.createElement("option");
    option.value = location;
    option.textContent = location;
    locationFilter.appendChild(option);
  });
}

function renderJobs() {
  jobCount.textContent = filteredJobs.length;

  if (!filteredJobs.length) {
    jobsList.innerHTML = `
      <div class="empty-state">
        No jobs found. Try changing your search filters.
      </div>
    `;
    renderEmptyDetails();
    return;
  }

  jobsList.innerHTML = filteredJobs.map(renderJobCard).join("");

  document.querySelectorAll(".job-card").forEach((card) => {
    card.addEventListener("click", () => openJobDetails(card.dataset.jobId));
  });

  document.querySelectorAll(".save-job-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      saveJob(button.dataset.jobId);
    });
  });

  document.querySelectorAll(".view-job-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openJobDetails(button.dataset.jobId);
    });
  });

  document.querySelectorAll(".apply-job-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      applyToJob(button.dataset.jobId);
    });
  });
}

function renderJobCard(job) {
  const alreadySaved = savedJobIds.includes(String(job.id));

  return `
    <article class="job-card" data-job-id="${escapeHTML(job.id)}">
      <div class="job-card-top">
        ${renderCompanyAvatar(job)}

        <div>
          <h3>${escapeHTML(job.title)}</h3>
          <p>${escapeHTML(job.company)} &middot; ${escapeHTML(job.location)}</p>
        </div>
      </div>

      <div class="job-tags">
        <span>${escapeHTML(job.pay)}</span>
        <span>${escapeHTML(job.type)}</span>
        <span>${escapeHTML(job.trade)}</span>
      </div>

      <p class="job-preview">${escapeHTML(truncateText(job.description, 120))}</p>

      <div class="job-card-actions">
        <button class="save-btn save-job-btn" type="button" data-job-id="${escapeHTML(job.id)}">
          ${alreadySaved ? "Saved" : "Save"}
        </button>
        <button class="view-btn view-job-btn" type="button" data-job-id="${escapeHTML(job.id)}">
          View Details
        </button>
        <button class="view-btn apply-job-btn" type="button" data-job-id="${escapeHTML(job.id)}">
          Apply
        </button>
      </div>
    </article>
  `;
}

function openJobDetails(jobId) {
  selectedJob = filteredJobs.find((job) => String(job.id) === String(jobId)) ||
    allJobs.find((job) => String(job.id) === String(jobId));

  if (!selectedJob) return;

  renderJobDetails();
  openModal();
}

function renderJobDetails() {
  if (!selectedJob) {
    renderEmptyDetails();
    return;
  }

  const alreadySaved = savedJobIds.includes(String(selectedJob.id));

  jobDetails.innerHTML = `
    <div class="job-detail-content">
      <div class="job-detail-top">
        <div class="job-title-row">
          ${renderCompanyAvatar(selectedJob, true)}

          <div>
            <span class="small-label">Selected Role</span>
            <h2>${escapeHTML(selectedJob.title)}</h2>
            <p>${escapeHTML(selectedJob.company)} &middot; ${escapeHTML(selectedJob.location)}</p>
          </div>
        </div>

        <div class="job-detail-actions">
          <button class="secondary-btn" type="button" id="saveJobBtn">
            ${alreadySaved ? "Saved" : "Save Job"}
          </button>

          <button class="primary-btn" type="button" id="applyBtn">
            Apply Now
          </button>
        </div>
      </div>

      <div class="detail-grid">
        <div>
          <span>Company</span>
          <strong>${escapeHTML(clean(selectedJob.company))}</strong>
        </div>

        <div>
          <span>Location</span>
          <strong>${escapeHTML(clean(selectedJob.location))}</strong>
        </div>

        <div>
          <span>Job Type</span>
          <strong>${escapeHTML(clean(selectedJob.type))}</strong>
        </div>

        <div>
          <span>Pay</span>
          <strong>${escapeHTML(clean(selectedJob.pay))}</strong>
        </div>

        <div>
          <span>Experience</span>
          <strong>${escapeHTML(clean(selectedJob.trade))}</strong>
        </div>

        <div>
          <span>Status</span>
          <strong>${escapeHTML(selectedJob.status === "active" ? "Open" : selectedJob.status)}</strong>
        </div>
      </div>

      <div class="description-box">
        <span class="small-label">Description</span>
        <p>${escapeHTML(selectedJob.description)}</p>
      </div>

      <div class="description-box">
        <span class="small-label">Requirements</span>
        <p>${escapeHTML(selectedJob.requirements)}</p>
      </div>

      ${
        selectedJob.benefits
          ? `
            <div class="description-box">
              <span class="small-label">Benefits</span>
              <p>${escapeHTML(selectedJob.benefits)}</p>
            </div>
          `
          : ""
      }
    </div>
  `;

  document.getElementById("saveJobBtn").addEventListener("click", () => saveJob(selectedJob.id));
  document.getElementById("applyBtn").addEventListener("click", applyToSelectedJob);
}

function renderEmptyDetails() {
  jobDetails.innerHTML = `
    <div class="job-details-empty">
      <span class="small-label">Job Details</span>
      <h2>Select a job</h2>
      <p>Choose a role to view company details, requirements, pay, and apply.</p>
    </div>
  `;
}

function openModal() {
  if (!jobDetailsModal) return;

  jobDetailsModal.classList.add("open");
  jobDetailsModal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  if (!jobDetailsModal) return;

  jobDetailsModal.classList.remove("open");
  jobDetailsModal.setAttribute("aria-hidden", "true");
}

function filterJobs() {
  const keyword = keywordInput.value.toLowerCase().trim();
  const location = locationFilter.value;
  const type = typeFilter.value;

  filteredJobs = allJobs.filter((job) => {
    const matchesKeyword =
      !keyword ||
      job.title.toLowerCase().includes(keyword) ||
      job.company.toLowerCase().includes(keyword) ||
      job.trade.toLowerCase().includes(keyword) ||
      job.description.toLowerCase().includes(keyword);

    const matchesLocation = !location || job.location === location;
    const matchesType = !type || job.type === type;

    return matchesKeyword && matchesLocation && matchesType;
  });

  selectedJob = null;
  renderJobs();
}

async function saveJob(jobId) {
  const job = allJobs.find((item) => String(item.id) === String(jobId));
  if (!job || !currentUser) return;

  const alreadySaved = savedJobIds.includes(String(job.id));

  if (alreadySaved) {
    showToast("Job already saved.");
    return;
  }

  const { error } = await jobsSupabase
    .from("saved_jobs")
    .insert({
      candidate_id: currentUser.id,
      job_id: job.id
    });

  if (error) {
    if (error.code === "23505") {
      savedJobIds.push(String(job.id));
      renderJobs();
      if (selectedJob && String(selectedJob.id) === String(job.id)) renderJobDetails();
      showToast("Job already saved.");
      return;
    }

    console.error("Save job error:", error);
    showToast("Could not save job.");
    return;
  }

  savedJobIds.push(String(job.id));
  renderJobs();
  if (selectedJob && String(selectedJob.id) === String(job.id)) renderJobDetails();
  showToast("Job saved.");
}

function applyToSelectedJob() {
  if (!selectedJob || !currentUser) return;

  if (!selectedJob.employer_id) {
    console.error("Selected job is missing employer_id:", selectedJob);
    showToast("This job is missing employer information.");
    return;
  }

  window.location.href = `../candidates/apply-job.html?job_id=${encodeURIComponent(selectedJob.id)}`;
}

function applyToJob(jobId) {
  const job = allJobs.find((item) => String(item.id) === String(jobId));
  if (!job || !currentUser) return;

  if (!job.employer_id) {
    console.error("Selected job is missing employer_id:", job);
    showToast("This job is missing employer information.");
    return;
  }

  window.location.href = `../candidates/apply-job.html?job_id=${encodeURIComponent(job.id)}`;
}

function renderCompanyAvatar(job, large = false) {
  const logoUrl = employerLogos[String(job.employer_id)] || "";
  const classes = `company-avatar${large ? " large" : ""}`;

  if (logoUrl) {
    return `
      <div class="${classes}">
        <img src="${escapeHTML(logoUrl)}" alt="${escapeHTML(job.company)} logo">
      </div>
    `;
  }

  return `<div class="${classes}">${escapeHTML(getInitials(job.company))}</div>`;
}

function getInitials(name) {
  return String(name || "PT")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function truncateText(value, limit) {
  const text = String(value || "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
}

searchBtn.addEventListener("click", filterJobs);

keywordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") filterJobs();
});

if (jobModalOverlay) jobModalOverlay.addEventListener("click", closeModal);
if (closeJobModalBtn) closeJobModalBtn.addEventListener("click", closeModal);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener("DOMContentLoaded", loadJobs);
