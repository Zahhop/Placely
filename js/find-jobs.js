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

const jobsList = document.getElementById("jobsList");
const jobDetails = document.getElementById("jobDetails");
const jobCount = document.getElementById("jobCount");

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
  const { data: { user }, error } = await jobsSupabase.auth.getUser();

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

  savedJobIds = (data || []).map(row => String(row.job_id));
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
  filteredJobs = [...allJobs];

  populateLocations();
  renderJobs();

  const params = new URLSearchParams(window.location.search);
  const jobIdFromUrl = params.get("job");

  if (jobIdFromUrl && filteredJobs.some(job => String(job.id) === String(jobIdFromUrl))) {
    selectJob(jobIdFromUrl);
  } else if (filteredJobs.length) {
    selectJob(filteredJobs[0].id);
  }
}

function populateLocations() {
  const locations = [...new Set(allJobs.map(job => job.location).filter(Boolean))];

  locationFilter.innerHTML = `<option value="">All locations</option>`;

  locations.forEach(location => {
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

    jobDetails.innerHTML = `
      <div class="job-details-empty">
        <span class="small-label">Job Details</span>
        <h2>No job selected</h2>
        <p>Once jobs match your search, select one to view details.</p>
      </div>
    `;
    return;
  }

  jobsList.innerHTML = filteredJobs.map(job => `
    <article class="job-card ${selectedJob && String(selectedJob.id) === String(job.id) ? "active" : ""}" data-job-id="${job.id}">
      <h3>${job.title}</h3>
      <p>${job.company} · ${job.location}</p>

      <div class="job-tags">
        <span>${job.type}</span>
        <span>${job.pay}</span>
      </div>
    </article>
  `).join("");
}

function selectJob(jobId) {
  selectedJob = filteredJobs.find(job => String(job.id) === String(jobId));
  if (!selectedJob) return;

  renderJobs();

  const alreadySaved = savedJobIds.includes(String(selectedJob.id));

  jobDetails.innerHTML = `
    <div class="job-detail-content">
      <div class="job-detail-top">
        <div>
          <span class="small-label">Selected Role</span>
          <h2>${selectedJob.title}</h2>
          <p>${selectedJob.company} · ${selectedJob.location}</p>
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
          <strong>${clean(selectedJob.company)}</strong>
        </div>

        <div>
          <span>Location</span>
          <strong>${clean(selectedJob.location)}</strong>
        </div>

        <div>
          <span>Job Type</span>
          <strong>${clean(selectedJob.type)}</strong>
        </div>

        <div>
          <span>Pay</span>
          <strong>${clean(selectedJob.pay)}</strong>
        </div>

        <div>
          <span>Trade</span>
          <strong>${clean(selectedJob.trade)}</strong>
        </div>

        <div>
          <span>Status</span>
          <strong>${selectedJob.status === "active" ? "Open" : selectedJob.status}</strong>
        </div>
      </div>

      <div class="description-box">
        <span class="small-label">Description</span>
        <p>${selectedJob.description}</p>
      </div>

      <div class="description-box">
        <span class="small-label">Requirements</span>
        <p>${selectedJob.requirements}</p>
      </div>

      ${
        selectedJob.benefits
          ? `
            <div class="description-box">
              <span class="small-label">Benefits</span>
              <p>${selectedJob.benefits}</p>
            </div>
          `
          : ""
      }
    </div>
  `;

  document.getElementById("saveJobBtn").addEventListener("click", saveSelectedJob);
  document.getElementById("applyBtn").addEventListener("click", applyToSelectedJob);
}

function filterJobs() {
  const keyword = keywordInput.value.toLowerCase().trim();
  const location = locationFilter.value;
  const type = typeFilter.value;

  filteredJobs = allJobs.filter(job => {
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

  if (filteredJobs.length) {
    selectJob(filteredJobs[0].id);
  }
}

async function saveSelectedJob() {
  if (!selectedJob || !currentUser) return;

  const alreadySaved = savedJobIds.includes(String(selectedJob.id));

  if (alreadySaved) {
    showToast("Job already saved.");
    return;
  }

  const { error } = await jobsSupabase
    .from("saved_jobs")
    .insert({
      candidate_id: currentUser.id,
      job_id: selectedJob.id
    });

  if (error) {
    if (error.code === "23505") {
      savedJobIds.push(String(selectedJob.id));
      selectJob(selectedJob.id);
      showToast("Job already saved.");
      return;
    }

    console.error("Save job error:", error);
    showToast("Could not save job.");
    return;
  }

  savedJobIds.push(String(selectedJob.id));
  selectJob(selectedJob.id);
  showToast("Job saved.");
}

function applyToSelectedJob() {
  if (!selectedJob) return;

  const applications = JSON.parse(localStorage.getItem("placely_applications")) || [];
  const alreadyApplied = applications.some(job => String(job.id) === String(selectedJob.id));

  if (alreadyApplied) {
    showToast("You already applied to this job.");
    return;
  }

  applications.push(selectedJob);
  localStorage.setItem("placely_applications", JSON.stringify(applications));

  showToast("Application submitted.");
}

jobsList.addEventListener("click", (e) => {
  const card = e.target.closest(".job-card");
  if (!card) return;

  selectJob(card.dataset.jobId);
});

searchBtn.addEventListener("click", filterJobs);

keywordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") filterJobs();
});

document.addEventListener("DOMContentLoaded", loadJobs);