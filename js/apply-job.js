const applySupabase = window.PlacelyAuth.client();

const jobSummary = document.getElementById("jobSummary");
const candidateSummary = document.getElementById("candidateSummary");
const applicationForm = document.getElementById("applicationForm");
const coverLetter = document.getElementById("coverLetter");
const additionalNotes = document.getElementById("additionalNotes");
const confirmInfo = document.getElementById("confirmInfo");
const formMessage = document.getElementById("formMessage");
const submitApplicationBtn = document.getElementById("submitApplicationBtn");
const duplicateNotice = document.getElementById("duplicateNotice");
const reapplyModal = document.getElementById("reapplyModal");
const reapplyModalOverlay = document.getElementById("reapplyModalOverlay");
const cancelReapplyBtn = document.getElementById("cancelReapplyBtn");
const confirmReapplyBtn = document.getElementById("confirmReapplyBtn");

let currentUser = null;
let selectedJob = null;
let candidateProfile = null;
let existingApplication = null;
const schemaFallbackColumns = {};

document.addEventListener("DOMContentLoaded", initApplyPage);

async function initApplyPage() {
  const jobId = new URLSearchParams(window.location.search).get("job_id");

  if (!jobId) {
    showFatalState("No job selected", "Return to Find Jobs and choose a role to apply for.");
    return;
  }

  const user = await verifyCandidateAccess(applySupabase, {
    loginPath: "candidate-login.html",
    employerDashboardPath: "../employers/employer-dashboard.html"
  });

  if (!user) return;
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

  if (error) return true;

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

  if (reapplyModalOverlay) reapplyModalOverlay.addEventListener("click", closeReapplyModal);
  if (cancelReapplyBtn) cancelReapplyBtn.addEventListener("click", closeReapplyModal);
  if (confirmReapplyBtn) confirmReapplyBtn.addEventListener("click", reapplyToJob);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeReapplyModal();
  });
}

async function loadJob(jobId) {
  const { data, error } = await applySupabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !data) {
    showFatalState("Job could not be loaded", "This posting may have been removed or is no longer available.");
    return;
  }

  if (data.status && data.status !== "active") {
    showFatalState("This job is no longer open", "The employer has closed this posting, so new applications are not available.");
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

  if (error || !data) {
    await window.PlacelyAuth.clearAuthState();
    window.location.replace("candidate-login.html");
    return;
  }

  candidateProfile = data;
}

async function checkDuplicateApplication(jobId, candidateId) {
  const { data, error } = await applySupabase
    .from("applications")
    .select("id, status, candidate_status, employer_status, withdrawn_at, created_at")
    .eq("candidate_id", candidateId)
    .eq("job_id", jobId)
    .maybeSingle();

  if (error) {
    showToast("Could not check your application status.");
    return;
  }

  existingApplication = data || null;
}

function updateDuplicateState() {
  if (!existingApplication) return;

  const status = normalizeApplicationStatus(existingApplication.status);

  if (duplicateNotice) {
    duplicateNotice.classList.remove("hidden");

    if (status === "withdrawn") {
      duplicateNotice.innerHTML = `
        <div>
          <strong>You previously withdrew from this job.</strong>
          <p>You can review your previous application or re-apply to make it visible to the employer again.</p>
        </div>

        <div class="notice-actions">
          <a href="candidate-applications.html" class="secondary-btn">View Applications</a>
          <button id="reapplyBtn" type="button" class="primary-btn">Re Apply</button>
        </div>
      `;

      const reapplyBtn = document.getElementById("reapplyBtn");
      if (reapplyBtn) reapplyBtn.addEventListener("click", openReapplyModal);
    } else {
      duplicateNotice.innerHTML = `
        <div>
          <strong>You already applied to this job.</strong>
          <p>You can review this application from your application tracker.</p>
        </div>
        <a href="candidate-applications.html" class="primary-btn">View Applications</a>
      `;
    }
  }

  if (submitApplicationBtn) submitApplicationBtn.disabled = true;
  if (applicationForm) applicationForm.classList.add("hidden");
}

function openReapplyModal() {
  if (!existingApplication || normalizeApplicationStatus(existingApplication.status) !== "withdrawn") return;

  if (reapplyModal) {
    reapplyModal.classList.add("open");
    reapplyModal.setAttribute("aria-hidden", "false");
  }
}

function closeReapplyModal() {
  if (reapplyModal) {
    reapplyModal.classList.remove("open");
    reapplyModal.setAttribute("aria-hidden", "true");
  }

  if (confirmReapplyBtn) {
    confirmReapplyBtn.disabled = false;
    confirmReapplyBtn.textContent = "Re Apply";
  }
}

async function reapplyToJob() {
  if (!existingApplication || !currentUser) return;

  if (confirmReapplyBtn) {
    confirmReapplyBtn.disabled = true;
    confirmReapplyBtn.textContent = "Re-applying...";
  }

  const now = new Date().toISOString();
  const updatePayload = {
    status: "submitted",
    candidate_status: "submitted",
    withdrawn_at: null,
    reapplied_at: now,
    updated_at: now
  };

  const { error } = await updateApplicationWithSchemaFallback(existingApplication.id, updatePayload);

  if (error) {
    showToast("Could not re-apply to this job.");

    if (confirmReapplyBtn) {
      confirmReapplyBtn.disabled = false;
      confirmReapplyBtn.textContent = "Re Apply";
    }
    return;
  }

  existingApplication = {
    ...existingApplication,
    ...updatePayload
  };

  closeReapplyModal();
  showToast("Application reopened.");
  window.location.href = "candidate-applications.html";
}

function renderJobSummary() {
  if (!jobSummary || !selectedJob) return;

  const title = selectedJob.job_title || "Untitled Job";
  const company = selectedJob.company_name || "Employer";
  const location = selectedJob.location || "Location not listed";
  const type = selectedJob.employment_type || "Job type not listed";
  const pay = window.PlacelyAuth.formatCompensationFromRecord(selectedJob);
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
        getCandidatePhotoUrl(candidateProfile.profile_photo_url)
          ? `<img src="${escapeHTML(getCandidatePhotoUrl(candidateProfile.profile_photo_url))}" alt="${escapeHTML(name)}">`
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
        <div class="summary-item"><span>Resume</span><strong>${escapeHTML(getResumePath(candidateProfile) ? "Attached" : "Not uploaded")}</strong></div>
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
    if (normalizeApplicationStatus(existingApplication.status) === "withdrawn") {
      submitApplicationBtn.disabled = false;
      submitApplicationBtn.textContent = "Submit Application";
      openReapplyModal();
      return;
    }

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
    if (normalizeApplicationStatus(existingApplication.status) === "withdrawn") {
      submitApplicationBtn.disabled = false;
      submitApplicationBtn.textContent = "Submit Application";
      openReapplyModal();
      return;
    }

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
    pay_range: window.PlacelyAuth.formatCompensationFromRecord(selectedJob, "") || selectedJob.pay_range || "",
    status: "submitted",
    cover_letter: coverLetter.value.trim(),
    additional_notes: additionalNotes.value.trim(),
    candidate_snapshot: snapshot,
    candidate_name: snapshot.full_name,
    candidate_email: snapshot.email || null,
    candidate_phone: snapshot.phone || null,
    candidate_role: snapshot.trade,
    resume_path: snapshot.resume_path,
    resume_url: null,
    updated_at: now
  };

  const { error } = await insertApplicationWithSchemaFallback(applicationPayload);

  if (error) {
    submitApplicationBtn.disabled = false;
    submitApplicationBtn.textContent = "Submit Application";

    if (error.code === "23505") {
      await checkDuplicateApplication(selectedJob.id, currentUser.id);
      updateDuplicateState();

      if (existingApplication && normalizeApplicationStatus(existingApplication.status) === "withdrawn") {
        openReapplyModal();
        return;
      }

      showToast("You already applied to this job.");
      return;
    }

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
        schemaFallbackColumns.applicationInsert = removedColumns;
      }

      return { error: null };
    }

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

async function updateApplicationWithSchemaFallback(applicationId, payload) {
  let safePayload = { ...payload };
  const removedColumns = [];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await applySupabase
      .from("applications")
      .update(safePayload)
      .eq("id", applicationId)
      .eq("candidate_id", currentUser.id);

    if (!error) {
      if (removedColumns.length) {
        schemaFallbackColumns.applicationUpdate = removedColumns;
      }

      return { error: null };
    }

    const missingColumn = getMissingColumnName(error);

    if (!missingColumn || !(missingColumn in safePayload)) {
      return { error };
    }

    removedColumns.push(missingColumn);
    delete safePayload[missingColumn];
  }

  return {
    error: {
      message: "Application re-apply failed after removing missing columns.",
      details: removedColumns.join(", "),
      hint: "Run the Supabase applications hiring flow SQL file so reapply columns can be stored.",
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


function buildCandidateSnapshot() {
  const contact = window.PlacelyAuth.getVisibleCandidateContact(candidateProfile);
  const shownContactMethod = window.PlacelyAuth.normalizeCandidateContactPreference(candidateProfile.shown_contact_method) || contact.preference;

  return {
    full_name: candidateProfile.full_name || "Candidate",
    email: contact.showEmail ? candidateProfile.email || currentUser.email || "" : "",
    phone: contact.showPhone ? candidateProfile.phone || "" : "",
    shown_contact_method: shownContactMethod,
    contact_method: candidateProfile.contact_method || "",
    location: candidateProfile.location || "",
    trade: candidateProfile.trade || "",
    experience: candidateProfile.experience || "",
    availability: candidateProfile.availability || "",
    skills: candidateProfile.skills || "",
    certifications: candidateProfile.certifications || "",
    resume_path: getResumePath(candidateProfile),
    resume_url: "",
    profile_photo_url: candidateProfile.profile_photo_url || ""
  };
}

function getResumePath(profile = {}) {
  return profile.resume_path || getResumePathFromLegacyUrl(profile.resume_url || "");
}

function getResumePathFromLegacyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (!/^https?:\/\//i.test(raw)) {
    return raw.replace(/^\/+/, "");
  }

  try {
    const url = new URL(raw);
    const marker = "/candidate_resumes/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex === -1) return "";
    return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
  } catch {
    return "";
  }
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

function normalizeApplicationStatus(status) {
  const value = String(status || "submitted").toLowerCase().trim();

  if (["withdrawn", "withdraw"].includes(value)) return "withdrawn";
  if (["new"].includes(value)) return "new";
  if (["applied", "submitted"].includes(value)) return "submitted";
  if (["review", "reviewing", "viewed", "in review"].includes(value)) return "reviewing";
  if (["interview", "interviewing", "interview requested"].includes(value)) return "interview";
  if (["offer", "offered"].includes(value)) return "offer";
  if (["hired"].includes(value)) return "hired";
  if (["rejected", "declined"].includes(value)) return "rejected";

  return "submitted";
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

function getCandidatePhotoUrl(value) {
  return window.PlacelyAuth?.getPublicImageUrl?.(applySupabase, "candidate_photos", value) || String(value || "");
}
