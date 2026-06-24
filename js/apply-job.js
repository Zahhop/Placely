const applySupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const jobSummary = document.getElementById("jobSummary");
const candidateSummary = document.getElementById("candidateSummary");
const applicationForm = document.getElementById("applicationForm");
const coverLetter = document.getElementById("coverLetter");
const additionalNotes = document.getElementById("additionalNotes");
const confirmInfo = document.getElementById("confirmInfo");
const formMessage = document.getElementById("formMessage");
const submitApplicationBtn = document.getElementById("submitApplicationBtn");
const duplicateNotice = document.getElementById("duplicateNotice");

let currentUser = null;
let selectedJob = null;
let candidateProfile = null;
let existingApplication = null;

document.addEventListener("DOMContentLoaded", initApplyPage);

async function initApplyPage() {
  const jobId = new URLSearchParams(window.location.search).get("job_id");

  if (!jobId) {
    showFatalState("No job selected", "Return to Find Jobs and choose a role to apply for.");
    return;
  }

  const {
    data: { user },
    error
  } = await applySupabase.auth.getUser();

  if (error || !user) {
    window.location.href = "candidate-login.html";
    return;
  }

  currentUser = user;

  const isCandidate = await verifyCandidateRole(user.id);
  if (!isCandidate) return;

  await Promise.all([
    loadJob(jobId),
    loadCandidateProfile(user.id),
    checkDuplicateApplication(jobId, user.id)
  ]);

  if (!selectedJob) return;

  renderJobSummary();
  renderCandidateSummary();
  updateDuplicateState();
  setupEvents();
}

async function verifyCandidateRole(userId) {
  const { data, error } = await applySupabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Candidate role check error:", error);
    return true;
  }

  if (data?.role && data.role !== "candidate") {
    window.location.href = "../employers/employer-dashboard.html";
    return false;
  }

  return true;
}

function setupEvents() {
  if (applicationForm) {
    applicationForm.addEventListener("submit", submitApplication);
  }
}

async function loadJob(jobId) {
  const { data, error } = await applySupabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !data) {
    console.error("Apply job load error:", error);
    showFatalState("Job could not be loaded", "This posting may have been removed or is no longer available.");
    return;
  }

  if (!data.employer_id) {
    showFatalState("This job is missing employer information", "The employer needs to update this posting before candidates can apply.");
    return;
  }

  selectedJob = data;
}

async function loadCandidateProfile(userId) {
  const { data, error } = await applySupabase
    .from("candidate_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Candidate profile load error:", error);
  }

  candidateProfile = data || {
    id: userId,
    full_name: currentUser.email?.split("@")[0] || "Candidate",
    email: currentUser.email || "",
    phone: "",
    location: "",
    trade: "",
    experience: "",
    availability: "",
    skills: "",
    certifications: "",
    resume_url: "",
    profile_photo_url: ""
  };
}

async function checkDuplicateApplication(jobId, candidateId) {
  const { data, error } = await applySupabase
    .from("applications")
    .select("id, status, created_at")
    .eq("candidate_id", candidateId)
    .eq("job_id", jobId)
    .maybeSingle();

  if (error) {
    console.error("Duplicate application check error:", error);
    return;
  }

  existingApplication = data || null;
}

function updateDuplicateState() {
  if (!existingApplication) return;

  if (duplicateNotice) duplicateNotice.classList.remove("hidden");
  if (submitApplicationBtn) submitApplicationBtn.disabled = true;
  if (applicationForm) applicationForm.classList.add("hidden");
}

function renderJobSummary() {
  if (!jobSummary || !selectedJob) return;

  const title = selectedJob.job_title || "Untitled Job";
  const company = selectedJob.company_name || "Employer";
  const location = selectedJob.location || "Location not listed";
  const type = selectedJob.employment_type || "Job type not listed";
  const pay = selectedJob.pay_range || "Pay not listed";
  const experience = selectedJob.experience_level || "Experience not listed";
  const description = selectedJob.job_description || "No description provided yet.";
  const requirements = selectedJob.required_skills || "Requirements not listed.";

  jobSummary.innerHTML = `
    <div>
      <h2>${escapeHTML(title)}</h2>
      <p>${escapeHTML(company)} &middot; ${escapeHTML(location)}</p>
    </div>

    <div class="job-facts">
      <div class="job-fact"><span>Company</span><strong>${escapeHTML(company)}</strong></div>
      <div class="job-fact"><span>Location</span><strong>${escapeHTML(location)}</strong></div>
      <div class="job-fact"><span>Job Type</span><strong>${escapeHTML(type)}</strong></div>
      <div class="job-fact"><span>Pay</span><strong>${escapeHTML(pay)}</strong></div>
      <div class="job-fact"><span>Experience</span><strong>${escapeHTML(experience)}</strong></div>
      <div class="job-fact"><span>Status</span><strong>${escapeHTML(selectedJob.status || "active")}</strong></div>
    </div>

    <div class="description-box">
      <strong>Description</strong>
      <p>${escapeHTML(description)}</p>
    </div>

    <div class="description-box">
      <strong>Requirements</strong>
      <p>${escapeHTML(requirements)}</p>
    </div>
  `;
}

function renderCandidateSummary() {
  if (!candidateSummary) return;

  const name = candidateProfile.full_name || "Candidate";
  const initials = getInitials(name);
  const tags = getTags(candidateProfile);

  candidateSummary.innerHTML = `
    <div class="candidate-photo">
      ${
        candidateProfile.profile_photo_url
          ? `<img src="${escapeHTML(candidateProfile.profile_photo_url)}" alt="${escapeHTML(name)}">`
          : escapeHTML(initials)
      }
    </div>

    <div>
      <h2>${escapeHTML(name)}</h2>
      <p>${escapeHTML(candidateProfile.trade || "Trade not listed")} &middot; ${escapeHTML(candidateProfile.location || "Location not listed")}</p>

      <div class="summary-grid">
        <div class="summary-item"><span>Email</span><strong>${escapeHTML(candidateProfile.email || currentUser.email || "Not listed")}</strong></div>
        <div class="summary-item"><span>Phone</span><strong>${escapeHTML(candidateProfile.phone || "Not listed")}</strong></div>
        <div class="summary-item"><span>Experience</span><strong>${escapeHTML(candidateProfile.experience || "Not listed")}</strong></div>
        <div class="summary-item"><span>Availability</span><strong>${escapeHTML(candidateProfile.availability || "Not listed")}</strong></div>
        <div class="summary-item"><span>Resume</span><strong>${escapeHTML(candidateProfile.resume_url ? "Attached" : "Not uploaded")}</strong></div>
        <div class="summary-item"><span>Location</span><strong>${escapeHTML(candidateProfile.location || "Not listed")}</strong></div>
      </div>

      <div class="tag-row">
        ${tags.length ? tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("") : "<span>No skills or certifications added</span>"}
      </div>
    </div>
  `;
}

async function submitApplication(event) {
  event.preventDefault();
  clearMessage();

  if (!selectedJob || !candidateProfile || !currentUser) return;

  if (existingApplication) {
    setMessage("You already applied to this job.");
    updateDuplicateState();
    return;
  }

  if (!confirmInfo.checked) {
    setMessage("Please confirm your profile and resume details before submitting.");
    return;
  }

  submitApplicationBtn.disabled = true;
  submitApplicationBtn.textContent = "Submitting...";

  await checkDuplicateApplication(selectedJob.id, currentUser.id);

  if (existingApplication) {
    showToast("You already applied to this job.");
    updateDuplicateState();
    return;
  }

  const now = new Date().toISOString();
  const snapshot = buildCandidateSnapshot();
  const applicationPayload = {
    candidate_id: currentUser.id,
    employer_id: selectedJob.employer_id,
    job_id: selectedJob.id,
    job_title: selectedJob.job_title || "Untitled Job",
    company_name: selectedJob.company_name || "Employer",
    location: selectedJob.location || "",
    employment_type: selectedJob.employment_type || "",
    pay_range: selectedJob.pay_range || "",
    status: "submitted",
    cover_letter: coverLetter.value.trim(),
    additional_notes: additionalNotes.value.trim(),
    candidate_snapshot: snapshot,
    candidate_name: snapshot.full_name,
    candidate_email: snapshot.email,
    candidate_phone: snapshot.phone,
    candidate_role: snapshot.trade,
    resume_url: snapshot.resume_url,
    updated_at: now
  };

  const { error } = await insertApplicationWithSchemaFallback(applicationPayload);

  if (error) {
    submitApplicationBtn.disabled = false;
    submitApplicationBtn.textContent = "Submit Application";

    if (error.code === "23505") {
      showToast("You already applied to this job.");
      await checkDuplicateApplication(selectedJob.id, currentUser.id);
      updateDuplicateState();
      return;
    }

    logSupabaseError("Application submit error:", error);
    setMessage("Could not submit application. Check the required Supabase columns and RLS policy.");
    return;
  }

  showToast("Application submitted.");
  window.location.href = "candidate-applications.html";
}

async function insertApplicationWithSchemaFallback(payload) {
  let safePayload = { ...payload };
  const removedColumns = [];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await applySupabase
      .from("applications")
      .insert(safePayload);

    if (!error) {
      if (removedColumns.length) {
        console.warn("Application submitted after removing missing columns:", removedColumns);
      }

      return { error: null };
    }

    logSupabaseError("Application submit error:", error);

    const missingColumn = getMissingColumnName(error);

    if (!missingColumn || !(missingColumn in safePayload)) {
      return { error };
    }

    removedColumns.push(missingColumn);
    delete safePayload[missingColumn];
  }

  return {
    error: {
      message: "Application insert failed after removing missing columns.",
      details: removedColumns.join(", "),
      hint: "Run the Supabase applications hiring flow SQL file so the full application payload can be stored.",
      code: "SCHEMA_FALLBACK_LIMIT"
    }
  };
}

function getMissingColumnName(error) {
  const text = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" ");

  const match =
    text.match(/'([^']+)' column/i) ||
    text.match(/column "([^"]+)"/i) ||
    text.match(/Could not find the '([^']+)'/i);

  return match?.[1] || "";
}

function logSupabaseError(label, error) {
  console.error(label, {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code
  });
}

function buildCandidateSnapshot() {
  return {
    full_name: candidateProfile.full_name || "Candidate",
    email: candidateProfile.email || currentUser.email || "",
    phone: candidateProfile.phone || "",
    location: candidateProfile.location || "",
    trade: candidateProfile.trade || "",
    experience: candidateProfile.experience || "",
    availability: candidateProfile.availability || "",
    skills: candidateProfile.skills || "",
    certifications: candidateProfile.certifications || "",
    resume_url: candidateProfile.resume_url || "",
    profile_photo_url: candidateProfile.profile_photo_url || ""
  };
}

function showFatalState(title, text) {
  if (jobSummary) {
    jobSummary.innerHTML = `
      <div class="empty-state">
        <strong>${escapeHTML(title)}</strong>
        <p>${escapeHTML(text)}</p>
      </div>
    `;
  }

  if (candidateSummary) {
    candidateSummary.innerHTML = `
      <div class="empty-state">${escapeHTML(text)}</div>
    `;
  }

  if (applicationForm) applicationForm.classList.add("hidden");
}

function getTags(profile) {
  const tags = [];

  if (profile.skills) tags.push(...String(profile.skills).split(","));
  if (profile.certifications) tags.push(...String(profile.certifications).split(","));

  return tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
}

function setMessage(message) {
  if (formMessage) formMessage.textContent = message;
}

function clearMessage() {
  setMessage("");
}

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

function getInitials(name) {
  return String(name || "PT")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
