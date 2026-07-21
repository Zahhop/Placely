const placelySupabase = window.employerSupabase;

const jobForm = document.getElementById("jobForm");
const formMessage = document.getElementById("formMessage");
const logoutBtn = document.getElementById("logoutBtn");
const compensationType = document.getElementById("compensationType");
const compensationMin = document.getElementById("compensationMin");
const compensationMax = document.getElementById("compensationMax");
const compensationUnit = document.getElementById("compensationUnit");
const compensationError = document.getElementById("compensationError");
const compensationPreview = document.getElementById("compensationPreview");
let currentUser = null;
let isPostingJob = false;

function value(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function setMessage(message, type = "error") {
  if (!formMessage) {
    if (message) alert(message);
    return;
  }

  formMessage.textContent = message;
  formMessage.classList.toggle("success", type === "success");
}

function getFormFields() {
  const compensation = window.PlacelyAuth.buildCompensationPayload(
    value("compensationType"),
    compensationMin?.value,
    compensationMax?.value
  );

  return {
    job_title: value("jobTitle"),
    company_name: value("companyName"),
    location: value("location"),
    employment_type: value("employmentType"),
    ...compensation.payload,
    experience_level: value("experienceLevel"),
    job_description: value("jobDescription"),
    required_skills: value("requiredSkills"),
    benefits: value("benefits"),
    status: value("jobStatus") || "active",
    compensation
  };
}

document.addEventListener("DOMContentLoaded", initPostJob);

async function initPostJob() {
  currentUser = await verifyEmployerAccess(placelySupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });

  if (!currentUser) return;

  setupCompensationInputs();
  await prefillEmployerCompensation();
  jobForm?.addEventListener("submit", submitJob);
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

async function prefillEmployerCompensation() {
  const { data, error } = await placelySupabase
    .from("employer_profiles")
    .select("compensation_type, compensation_min, compensation_max")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error || !window.PlacelyAuth.hasStructuredCompensation(data)) return;

  compensationType.value = window.PlacelyAuth.normalizeCompensationType(data.compensation_type);
  compensationMin.value = data.compensation_min;
  compensationMax.value = data.compensation_max;
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
      : "";
  }
}

async function submitJob(event) {
  event.preventDefault();
  setMessage("");

  if (isPostingJob) return;

  if (!currentUser) {
    setMessage("Please log in before posting a job.");
    return;
  }

  const payload = getFormFields();

  if (!payload.job_title || !payload.location || !payload.job_description) {
    setMessage("Please fill out the job title, location, and job description.");
    return;
  }

  if (!payload.compensation?.valid) {
    setMessage(payload.compensation?.message || "Enter valid compensation details.");
    updateCompensationUI();
    return;
  }

  delete payload.compensation;

  const submitBtn = jobForm.querySelector(".submit-btn");
  isPostingJob = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Posting...";
  }

  const { error } = await placelySupabase
    .from("jobs")
    .insert({
      employer_id: currentUser.id,
      ...payload
    });

  if (error) {
    setMessage("Could not post job. Please check the required fields and try again.");

    isPostingJob = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Post Job";
    }

    return;
  }

  setMessage("Job posted successfully. Opening Manage Jobs...", "success");
  jobForm.reset();
  updateCompensationUI();

  setTimeout(() => {
    window.location.href = "manage-jobs.html";
  }, 700);
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await window.PlacelyAuth.clearAuthState();
    } catch {}
    window.location.replace("employer-login.html");
  });
}
