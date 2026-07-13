const editJobSupabase = window.employerSupabase;

if (!editJobSupabase) {
  console.error("Employer Supabase client was not initialized.");
}

const params = new URLSearchParams(window.location.search);
const jobId = params.get("id");

const form = document.getElementById("editJobForm");
const statusBtn = document.getElementById("statusBtn");
const statusBadge = document.getElementById("statusBadge");

let currentJob = null;
let currentUser = null;

function updateStatusUI(status) {
  if (status === "paused") {
    statusBtn.textContent = "Reactivate";
    statusBtn.className = "reactivate-btn";

    statusBadge.textContent = "Paused";
    statusBadge.className = "status paused";
  } else {
    statusBtn.textContent = "Pause";
    statusBtn.className = "pause-btn";

    statusBadge.textContent = "Active";
    statusBadge.className = "status active";
  }
}

async function loadJob() {
  const user = await verifyEmployerAccess(editJobSupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });

  if (!user) return;
  currentUser = user;

  const { data: job, error } = await editJobSupabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .eq("employer_id", user.id)
    .single();

  if (error || !job) {
    alert("Could not load this job.");
    window.location.href = "manage-jobs.html";
    return;
  }

  currentJob = job;

  document.getElementById("jobTitle").value = job.job_title || "";
  document.getElementById("jobLocation").value = job.location || "";
  document.getElementById("jobPay").value = job.pay_range || "";
  document.getElementById("jobType").value = job.employment_type || "Full-time";
  document.getElementById("jobDescription").value = job.job_description || "";
  document.getElementById("jobRequirements").value = job.required_skills || "";

  updateStatusUI(job.status || "active");
}

statusBtn.addEventListener("click", async () => {
  if (!currentJob || !currentUser) return;

  const newStatus = currentJob.status === "active" ? "paused" : "active";

  const { error } = await editJobSupabase
    .from("jobs")
    .update({ status: newStatus })
    .eq("id", jobId)
    .eq("employer_id", currentUser.id);

  if (error) {
    alert("Could not update job status.");
    console.error(error);
    return;
  }

  currentJob.status = newStatus;
  updateStatusUI(newStatus);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currentUser) return;

  const { error } = await editJobSupabase
    .from("jobs")
    .update({
      job_title: document.getElementById("jobTitle").value.trim(),
      location: document.getElementById("jobLocation").value.trim(),
      pay_range: document.getElementById("jobPay").value.trim(),
      employment_type: document.getElementById("jobType").value,
      job_description: document.getElementById("jobDescription").value.trim(),
      required_skills: document.getElementById("jobRequirements").value.trim()
    })
    .eq("id", jobId)
    .eq("employer_id", currentUser.id);

  if (error) {
    alert("Could not save job.");
    console.error(error);
    return;
  }

  alert("Job updated.");
});

document.getElementById("removeBtn").addEventListener("click", async () => {
  if (!currentUser) return;

  const confirmDelete = confirm("Remove this job permanently?");
  if (!confirmDelete) return;

  await editJobSupabase
    .from("jobs")
    .delete()
    .eq("id", jobId)
    .eq("employer_id", currentUser.id);

  window.location.href = "manage-jobs.html";
});

document.getElementById("applicantsBtn").addEventListener("click", () => {
  window.location.href = `job-applicants.html?job=${jobId}`;
});

loadJob();
