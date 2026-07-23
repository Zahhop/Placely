const savedSupabase = window.PlacelyAuth.client();

let currentUser = null;
let savedRows = [];
let activeBoostsByJob = {};
const JOB_BOOSTS_ENABLED = window.PLACELY_FEATURES?.jobBoosts === true;

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

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
    setupPath: "../candidates/candidate-setup.html",
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
        compensation_type,
        compensation_min,
        compensation_max,
        pay_range,
        experience_level,
        job_description,
        status
      )
    `)
    .eq("candidate_id", user.id)
    .order("saved_at", { ascending: false });

  if (error) {
    savedJobsList.innerHTML = `
      <div class="empty-state">
        <strong>Could not load saved jobs</strong>
        <p>Please refresh the page and try again.</p>
      </div>
    `;

    return;
  }

  savedRows = data || [];
  if (JOB_BOOSTS_ENABLED) await loadActiveBoosts(savedRows);
  else activeBoostsByJob = {};

  renderSavedJobs();
}

async function loadActiveBoosts(rows) {
  if (!JOB_BOOSTS_ENABLED) {
    activeBoostsByJob = {};
    return;
  }

  const jobIds = rows.map((row) => row.jobs?.id || row.job_id).filter(Boolean);
  activeBoostsByJob = {};
  if (!jobIds.length) return;

  const { data, error } = await savedSupabase
    .from("job_boosts")
    .select("id, job_id, status, ends_at")
    .in("job_id", jobIds)
    .eq("status", "active")
    .gt("ends_at", new Date().toISOString());

  if (error) {
    activeBoostsByJob = {};
    return;
  }

  (data || []).forEach((boost) => {
    if (boost.job_id) activeBoostsByJob[String(boost.job_id)] = boost;
  });
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
          ${activeBoostsByJob[String(job.id)] ? `<span class="promoted-tag">Promoted</span>` : ""}
          <p>${clean(job.company_name, "Employer")} · ${clean(job.location)} · Saved ${formatDate(row.saved_at)}</p>

          <div class="tags">
            <span>${clean(job.employment_type, "Job Type")}</span>
            <span>${escapeHTML(window.PlacelyAuth.formatCompensationFromRecord(job))}</span>
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
    showToast("Could not remove saved job.");
    return;
  }

  savedRows = savedRows.filter(row => row.id !== savedRowId);
  renderSavedJobs();
  showToast("Saved job removed.");
}

window.removeSavedJob = removeSavedJob;

document.addEventListener("DOMContentLoaded", loadSavedJobs);
