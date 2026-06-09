const placelySupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const jobsGrid = document.getElementById("jobsGrid");
const jobDetailsPanel = document.getElementById("jobDetailsPanel");
const searchInput = document.getElementById("searchInput");
const locationFilter = document.getElementById("locationFilter");
const jobTypeFilter = document.getElementById("jobTypeFilter");
const searchBtn = document.getElementById("searchBtn");

let allJobs = [];
let selectedJobId = null;

async function loadJobs() {
  const { data: jobs, error } = await placelySupabase
    .from("jobs")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    jobsGrid.innerHTML = `<div class="job-card">Could not load jobs.</div>`;
    return;
  }

  allJobs = jobs || [];
  displayJobs(allJobs);

  if (allJobs.length > 0) {
    showJobDetails(allJobs[0]);
    displayJobs(allJobs);
  }
}

function displayJobs(jobs) {
  if (!jobs || jobs.length === 0) {
    jobsGrid.innerHTML = `<div class="job-card">No jobs found.</div>`;
    return;
  }

  jobsGrid.innerHTML = "";

  jobs.forEach((job) => {
    const isSelected = job.id === selectedJobId ? "selected" : "";

    jobsGrid.innerHTML += `
      <div class="job-card compact-job-card ${isSelected}" data-job-id="${job.id}">
        <div class="job-title">${job.job_title || "Untitled Job"}</div>
        <div class="company">${job.company_name || "Company not listed"}</div>
        <div class="location">${job.location || "Location not listed"}</div>
        <div class="compact-bottom">
          <span class="salary">${job.pay_range || "Pay not listed"}</span>
          <span class="job-tag">${job.employment_type || "Job"}</span>
        </div>
      </div>
    `;
  });

  document.querySelectorAll(".compact-job-card").forEach((card) => {
    card.addEventListener("click", () => {
      const jobId = card.getAttribute("data-job-id");
      const selectedJob = allJobs.find((job) => job.id === jobId);

      if (selectedJob) {
        showJobDetails(selectedJob);
        displayJobs(getFilteredJobs());
      }
    });
  });
}

function showJobDetails(job) {
  selectedJobId = job.id;

  jobDetailsPanel.innerHTML = `
    <div class="details-header">
      <div>
        <h2>${job.job_title || "Untitled Job"}</h2>
        <h3>${job.company_name || "Company not listed"}</h3>
        <p>${job.location || "Location not listed"}</p>
      </div>

      <span class="job-tag">${job.employment_type || "Job"}</span>
    </div>

    <div class="details-section">
      <strong>Pay</strong>
      <p>${job.pay_range || "Pay not listed"}</p>
    </div>

    <div class="details-section">
      <strong>Experience Level</strong>
      <p>${job.experience_level || "Not listed"}</p>
    </div>

    <div class="details-section">
      <strong>Job Description</strong>
      <p>${job.job_description || "No description provided."}</p>
    </div>

    <div class="details-section">
      <strong>Required Skills / Certifications</strong>
      <p>${job.required_skills || "Not listed."}</p>
    </div>

    <div class="details-section">
      <strong>Benefits / Perks</strong>
      <p>${job.benefits || "Not listed."}</p>
    </div>

    <div class="details-buttons">
      <button class="apply-btn">Apply Now</button>
      <button class="save-btn">Save Job</button>
    </div>
  `;
}

function getFilteredJobs() {
  const searchText = searchInput.value.toLowerCase();
  const selectedLocation = locationFilter.value.toLowerCase();
  const selectedJobType = jobTypeFilter.value.toLowerCase();

  return allJobs.filter((job) => {
    const title = (job.job_title || "").toLowerCase();
    const company = (job.company_name || "").toLowerCase();
    const location = (job.location || "").toLowerCase();
    const description = (job.job_description || "").toLowerCase();
    const requiredSkills = (job.required_skills || "").toLowerCase();
    const employmentType = (job.employment_type || "").toLowerCase();

    const matchesSearch =
      title.includes(searchText) ||
      company.includes(searchText) ||
      location.includes(searchText) ||
      description.includes(searchText) ||
      requiredSkills.includes(searchText);

    const matchesLocation =
      selectedLocation === "" || location.includes(selectedLocation);

    const matchesJobType =
      selectedJobType === "" || employmentType === selectedJobType;

    return matchesSearch && matchesLocation && matchesJobType;
  });
}

function filterJobs() {
  const filteredJobs = getFilteredJobs();

  displayJobs(filteredJobs);

  if (filteredJobs.length > 0) {
    showJobDetails(filteredJobs[0]);
    displayJobs(filteredJobs);
  }
}

searchBtn.addEventListener("click", filterJobs);
searchInput.addEventListener("input", filterJobs);
locationFilter.addEventListener("change", filterJobs);
jobTypeFilter.addEventListener("change", filterJobs);

loadJobs();