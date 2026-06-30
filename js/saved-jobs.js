const savedSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

let currentUser = null;
let savedRows = [];

const savedJobsList = document.getElementById("savedJobsList");
const savedCount = document.getElementById("savedCount");
const readyCount = document.getElementById("readyCount");
const newestSave = document.getElementById("newestSave");

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

function formatDate(value) {
  if (!value) return "—";

  return new Date(value).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric"
  });
}

async function loadSavedJobs() {
  const user = await verifyCandidateAccess(savedSupabase, {
    loginPath: "../candidates/candidate-login.html",
    employerDashboardPath: "../employers/employer-dashboard.html"
  });

  if (!user) return;
  currentUser = user;

  const { data, error } = await savedSupabase
    .from("saved_jobs")
    .select(`
      id,
      saved_at,
      job_id,
      jobs (
        id,
        job_title,
        company_name,
        location,
        employment_type,
        pay_range,
        experience_level,
        job_description,
        status
      )
    `)
    .eq("candidate_id", user.id)
    .order("saved_at", { ascending: false });

  if (error) {
    console.error("Error loading saved jobs:", error);

    savedJobsList.innerHTML = `
      <div class="empty-state">
        <strong>Could not load saved jobs</strong>
        <p>${error.message}</p>
      </div>
    `;

    return;
  }

  savedRows = data || [];

  renderSavedJobs();
}

function renderSavedJobs() {
  savedCount.textContent = savedRows.length;
  readyCount.textContent = savedRows.filter(row => row.jobs?.status !== "closed").length;
  newestSave.textContent = savedRows.length ? formatDate(savedRows[0].saved_at) : "—";

  if (!savedRows.length) {
    savedJobsList.innerHTML = `
      <div class="empty-state">
        <strong>No saved jobs yet</strong>
        <p>Save jobs from the job board and they’ll appear here.</p>
        <a href="find-jobs.html?role=candidate" class="primary-btn">Browse Jobs</a>
      </div>
    `;
    return;
  }

  savedJobsList.innerHTML = savedRows.map(row => {
    const job = row.jobs;

    if (!job) {
      return `
        <article class="saved-card">
          <div>
            <h3>Job no longer available</h3>
            <p>This job post may have been removed by the employer.</p>
          </div>

          <div class="saved-actions">
            <button class="danger-btn" type="button" onclick="removeSavedJob('${row.id}')">Remove</button>
          </div>
        </article>
      `;
    }

    return `
      <article class="saved-card">
        <div>
          <h3>${clean(job.job_title, "Untitled Job")}</h3>
          <p>${clean(job.company_name, "Employer")} · ${clean(job.location)} · Saved ${formatDate(row.saved_at)}</p>

          <div class="tags">
            <span>${clean(job.employment_type, "Job Type")}</span>
            <span>${clean(job.pay_range, "Pay not listed")}</span>
            <span>${clean(job.experience_level, "Experience not listed")}</span>
          </div>
        </div>

        <div class="saved-actions">
          <a class="secondary-btn" href="find-jobs.html?role=candidate&job=${job.id}">View Job</a>
          <button class="danger-btn" type="button" onclick="removeSavedJob('${row.id}')">Remove</button>
        </div>
      </article>
    `;
  }).join("");
}

async function removeSavedJob(savedRowId) {
  const { error } = await savedSupabase
    .from("saved_jobs")
    .delete()
    .eq("id", savedRowId)
    .eq("candidate_id", currentUser.id);

  if (error) {
    console.error("Remove saved job error:", error);
    showToast("Could not remove saved job.");
    return;
  }

  savedRows = savedRows.filter(row => row.id !== savedRowId);
  renderSavedJobs();
  showToast("Saved job removed.");
}

window.removeSavedJob = removeSavedJob;

document.addEventListener("DOMContentLoaded", loadSavedJobs);
