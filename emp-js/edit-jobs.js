const editJobSupabase = window.employerSupabase;

const params = new URLSearchParams(window.location.search);
const jobId = params.get("id");

const form = document.getElementById("editJobForm");
const statusBtn = document.getElementById("statusBtn");
const statusBadge = document.getElementById("statusBadge");
const compensationType = document.getElementById("jobCompensationType");
const compensationMin = document.getElementById("jobCompensationMin");
const compensationMax = document.getElementById("jobCompensationMax");
const compensationUnit = document.getElementById("jobCompensationUnit");
const compensationError = document.getElementById("jobCompensationError");
const compensationPreview = document.getElementById("jobCompensationPreview");

let currentJob = null;
let currentUser = null;
let isSavingJob = false;
let isUpdatingStatus = false;
let isDeletingJob = false;

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

function setupCompensationInputs() {
  compensationType?.addEventListener("change", updateCompensationUI);

  [compensationMin, compensationMax].forEach((input) => {
    input?.addEventListener("input", () => {
      input.value = input.value.replace(/[^\d.]/g, "");
      updateCompensationUI();
    });
  });

  updateCompensationUI();
}

function updateCompensationUI() {
  const type = window.PlacelyAuth.normalizeCompensationType(compensationType?.value) || "hourly";
  const isAnnual = type === "annual";

  if (compensationType && compensationType.value !== type) compensationType.value = type;
  if (compensationMin) compensationMin.placeholder = isAnnual ? "50000" : "25";
  if (compensationMax) compensationMax.placeholder = isAnnual ? "80000" : "40";
  if (compensationUnit) compensationUnit.textContent = isAnnual ? "per year" : "per hour";

  const result = window.PlacelyAuth.validateCompensationValues(
    type,
    compensationMin?.value,
    compensationMax?.value
  );
  const hasAnyAmount = Boolean(compensationMin?.value || compensationMax?.value);

  if (compensationError) compensationError.textContent = hasAnyAmount && !result.valid ? result.message : "";
  if (compensationPreview) {
    compensationPreview.textContent = result.valid
      ? window.PlacelyAuth.formatCompensation(result.type, result.minimum, result.maximum)
      : (currentJob?.pay_range ? `Legacy pay: ${currentJob.pay_range}` : "");
  }
}

async function loadJob() {
  if (!jobId) {
    alert("No job selected.");
    window.location.href = "manage-jobs.html";
    return;
  }

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
  compensationType.value = window.PlacelyAuth.normalizeCompensationType(job.compensation_type) || "hourly";
  compensationMin.value = job.compensation_min ?? "";
  compensationMax.value = job.compensation_max ?? "";
  document.getElementById("jobType").value = job.employment_type || "Full-time";
  document.getElementById("jobDescription").value = job.job_description || "";
  document.getElementById("jobRequirements").value = job.required_skills || "";

  updateCompensationUI();
  updateStatusUI(job.status || "active");
}

statusBtn.addEventListener("click", async () => {
  if (!currentJob || !currentUser || isUpdatingStatus) return;

  const newStatus = currentJob.status === "active" ? "paused" : "active";
  isUpdatingStatus = true;
  statusBtn.disabled = true;

  const { error } = await editJobSupabase
    .from("jobs")
    .update({ status: newStatus })
    .eq("id", jobId)
    .eq("employer_id", currentUser.id);

  if (error) {
    alert("Could not update job status.");
    isUpdatingStatus = false;
    statusBtn.disabled = false;
    return;
  }

  currentJob.status = newStatus;
  updateStatusUI(newStatus);
  isUpdatingStatus = false;
  statusBtn.disabled = false;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currentUser || isSavingJob) return;

  const jobTitle = document.getElementById("jobTitle").value.trim();
  const location = document.getElementById("jobLocation").value.trim();
  const description = document.getElementById("jobDescription").value.trim();

  if (!jobTitle || !location || !description) {
    alert("Please fill out the job title, location, and job description.");
    return;
  }

  const compensation = window.PlacelyAuth.buildCompensationPayload(
    compensationType?.value,
    compensationMin?.value,
    compensationMax?.value
  );

  if (!compensation.valid) {
    alert(compensation.message || "Enter valid compensation details.");
    updateCompensationUI();
    return;
  }

  isSavingJob = true;
  const submitBtn = form.querySelector("[type='submit']");
  const originalText = submitBtn?.textContent || "Save Job";
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";
  }

  const { error } = await editJobSupabase
    .from("jobs")
    .update({
      job_title: jobTitle,
      location,
      ...compensation.payload,
      employment_type: document.getElementById("jobType").value,
      job_description: description,
      required_skills: document.getElementById("jobRequirements").value.trim()
    })
    .eq("id", jobId)
    .eq("employer_id", currentUser.id);

  if (error) {
    alert("Could not save job.");
    isSavingJob = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
    return;
  }

  alert("Job updated.");
  currentJob = {
    ...currentJob,
    job_title: jobTitle,
    location,
    ...compensation.payload,
    employment_type: document.getElementById("jobType").value,
    job_description: description,
    required_skills: document.getElementById("jobRequirements").value.trim()
  };
  updateCompensationUI();
  isSavingJob = false;
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
});

document.getElementById("removeBtn").addEventListener("click", async () => {
  if (!currentUser || isDeletingJob) return;

  const confirmDelete = confirm("Remove this job permanently?");
  if (!confirmDelete) return;

  isDeletingJob = true;
  const removeBtn = document.getElementById("removeBtn");
  if (removeBtn) removeBtn.disabled = true;

  const { error } = await editJobSupabase
    .from("jobs")
    .delete()
    .eq("id", jobId)
    .eq("employer_id", currentUser.id);

  if (error) {
    alert("Could not remove this job.");
    isDeletingJob = false;
    if (removeBtn) removeBtn.disabled = false;
    return;
  }

  window.location.href = "manage-jobs.html";
});

document.getElementById("applicantsBtn").addEventListener("click", () => {
  window.location.href = `employer-applicants.html?job=${encodeURIComponent(jobId)}`;
});

setupCompensationInputs();
loadJob();
