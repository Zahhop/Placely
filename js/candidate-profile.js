const candidateSupabase = window.PlacelyAuth.client();

let currentUser = null;
let currentProfile = {};
let selectedPhotoPreviewUrl = "";
let isDeletingResume = false;
let isUploadingResume = false;
let isDeletingPhoto = false;
let profileViewState = "edit";
let profileEditScrollTop = 0;
let workExperiences = [];
let isSavingExperience = false;
let isDeletingExperience = false;
let experienceLoadError = null;

const profileSearchForm = getEl("profileSearchForm");
const profileSearchInput = getEl("profileSearchInput");

const PHOTO_BUCKET = "candidate_photos";
const RESUME_BUCKET = "candidate_resumes";
const MAX_RESUME_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_RESUME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);
const RESUME_SIGNED_URL_SECONDS = 10 * 60;
const WORK_EXPERIENCE_FIELDS = [
  "id",
  "candidate_id",
  "job_title",
  "company_name",
  "location",
  "employment_type",
  "start_month",
  "start_year",
  "end_month",
  "end_year",
  "is_current",
  "description",
  "created_at",
  "updated_at"
].join(",");
const EXPERIENCE_EMPLOYMENT_TYPES = [
  "Full-time",
  "Part-time",
  "Contract",
  "Temporary",
  "Casual",
  "Apprenticeship",
  "Internship",
  "Self-employed",
  "Other"
];
const MONTH_OPTIONS = [
  ["1", "January"],
  ["2", "February"],
  ["3", "March"],
  ["4", "April"],
  ["5", "May"],
  ["6", "June"],
  ["7", "July"],
  ["8", "August"],
  ["9", "September"],
  ["10", "October"],
  ["11", "November"],
  ["12", "December"]
];

function getEl(id) {
  return document.getElementById(id);
}

function showToast(message) {
  const toast = getEl("toast");

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

function value(id) {
  return getEl(id)?.value?.trim() || "";
}

function calculateStrength() {
  let score = 0;

  if (value("full_name")) score += 10;
  if (value("trade")) score += 15;
  if (value("location")) score += 10;
  if (value("bio")) score += 10;
  if (value("experience")) score += 15;
  if (value("skills")) score += 10;
  if (value("certifications")) score += 10;
  if (value("availability")) score += 10;
  if (value("email")) score += 5;
  if (value("phone")) score += 5;

  return Math.min(score, 100);
}

function updateStrength() {
  const score = calculateStrength();

  const number = getEl("profile_strength_number");
  const bar = document.querySelector(".score-track div");
  const hint = getEl("profileStrengthHint");

  if (number) number.textContent = `${score}%`;
  if (bar) bar.style.width = `${score}%`;
  if (hint) hint.textContent = getStrengthHint(score);
}

function updatePreview() {
  const fullName = value("full_name") || "Candidate Name";
  const trade = value("trade") || "Trade / Job Title";
  const location = value("location") || "Location";
  const profilePhotoUrl =
    selectedPhotoPreviewUrl ||
    getCandidatePhotoUrl(currentProfile.profile_photo_url || currentProfile.avatar_url) ||
    "";

  const previewName = getEl("preview_name");
  const previewMeta = getEl("preview_meta");
  const avatar = document.querySelector(".preview-avatar");

  if (previewName) previewName.textContent = fullName;
  if (previewMeta) previewMeta.textContent = `${trade} · ${location}`;
  renderProfileVerificationStatus();

  if (avatar) {
    const initials = window.CandidateProfilePreview?.getInitials(fullName) || "PT";

    if (profilePhotoUrl) {
      avatar.innerHTML = `<img src="${escapeAttribute(profilePhotoUrl)}" alt="${escapeAttribute(fullName)} profile photo">`;
      avatar.classList.add("has-image");
    } else {
      avatar.textContent = initials;
      avatar.classList.remove("has-image");
    }
  }

  updateStrength();
  updateVisibilityLabels();
}

function renderProfileVerificationStatus() {
  const statusEl = getEl("profileVerificationStatus");
  const previewBadge = getEl("previewVerificationBadge");
  const status = String(currentProfile.verification_status || "unverified").toLowerCase().trim();

  if (previewBadge) {
    previewBadge.innerHTML = window.PlacelyVerifiedBadge?.render(currentProfile) || "";
  }

  if (!statusEl) return;

  if (status === "verified") {
    const verifiedDate = currentProfile.verified_at ? `Verified on ${formatProfileDate(currentProfile.verified_at)}.` : "Your verified badge is visible to employers.";
    statusEl.innerHTML = `${window.PlacelyVerifiedBadge?.render(currentProfile) || "Verified by Placely"}<p>${escapeHTML(verifiedDate)}</p>`;
    return;
  }

  if (status === "pending") {
    statusEl.textContent = "Verification pending. We received your request and will contact you using the information on your profile.";
    return;
  }

  if (status === "rejected") {
    statusEl.innerHTML = `Verification was not approved. <a href="candidate-verification.html">Request another review</a>`;
    return;
  }

  statusEl.innerHTML = `<a href="candidate-verification.html" class="primary-btn compact">Get Verified</a>`;
}

async function loadWorkExperiences(candidateId) {
  experienceLoadError = null;

  try {
    const { data, error } = await candidateSupabase
      .from("candidate_work_experience")
      .select(WORK_EXPERIENCE_FIELDS)
      .eq("candidate_id", candidateId);

    if (error) throw error;
    workExperiences = sortWorkExperiences(data || []);
  } catch (error) {
    experienceLoadError = error;
    workExperiences = [];
    console.warn("Candidate work experience lookup failed", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint
    });
  }
}

function renderWorkExperienceSummary() {
  const summary = getEl("workExperienceSummary");
  if (!summary) return;

  const entries = sortWorkExperiences(workExperiences);

  if (experienceLoadError) {
    summary.innerHTML = `
      <article class="work-empty-row">
        <div>
          <strong>Work experience unavailable</strong>
          <p>We could not load detailed work history right now. Your profile fields are still available.</p>
        </div>
        <button type="button" class="work-add-btn">Add</button>
      </article>
    `;
    bindWorkSummaryEvents();
    return;
  }

  if (!entries.length) {
    summary.innerHTML = `
      <article class="work-empty-row">
        <div>
          <strong>Most Recent Position</strong>
          <p>Add your latest company, title, dates, and main responsibilities.</p>
        </div>
        <button type="button" class="work-edit-latest-btn">Edit</button>
      </article>
      <article class="work-empty-row">
        <div>
          <strong>Add another role</strong>
          <p>Build a stronger profile by showing previous jobs and trade experience.</p>
        </div>
        <button type="button" class="work-add-btn">Add</button>
      </article>
    `;
    bindWorkSummaryEvents();
    return;
  }

  const [latest, ...additional] = entries;
  summary.innerHTML = `
    <article class="work-summary-row">
      <div>
        <span class="work-row-label">Most Recent Position</span>
        ${renderWorkSummaryText(latest)}
      </div>
      <button type="button" class="work-edit-btn" data-experience-id="${escapeAttribute(latest.id)}">Edit</button>
    </article>
    ${additional.map((entry) => `
      <article class="work-summary-row compact">
        <div>
          ${renderWorkSummaryText(entry)}
        </div>
        <button type="button" class="work-edit-btn" data-experience-id="${escapeAttribute(entry.id)}">Edit</button>
      </article>
    `).join("")}
    <article class="work-empty-row">
      <div>
        <strong>Add another role</strong>
        <p>Build a stronger profile by showing previous jobs and trade experience.</p>
      </div>
      <button type="button" class="work-add-btn">Add</button>
    </article>
  `;
  bindWorkSummaryEvents();
}

function renderWorkSummaryText(entry) {
  return `
    <strong>${escapeHTML(entry.job_title || "Role not listed")}</strong>
    <p>${escapeHTML([entry.company_name, entry.location].filter(Boolean).join(" - ") || "Company not listed")}</p>
    <p>${escapeHTML(formatExperienceDateRange(entry))}${entry.employment_type ? ` - ${escapeHTML(entry.employment_type)}` : ""}</p>
  `;
}

function bindWorkSummaryEvents() {
  document.querySelectorAll(".work-add-btn, #topAddExperienceBtn").forEach((button) => {
    button.onclick = () => openExperienceEditorState("new");
  });

  document.querySelectorAll(".work-edit-btn").forEach((button) => {
    button.onclick = () => openExperienceEditorState("edit", button.dataset.experienceId);
  });

  document.querySelectorAll(".work-edit-latest-btn").forEach((button) => {
    button.onclick = () => {
      const latest = sortWorkExperiences(workExperiences)[0];
      if (latest?.id) openExperienceEditorState("edit", latest.id);
      else openExperienceEditorState("new");
    };
  });
}

function sortWorkExperiences(entries = []) {
  return [...entries].sort((a, b) => {
    if (Boolean(a.is_current) !== Boolean(b.is_current)) return a.is_current ? -1 : 1;
    const aValue = (Number(a.start_year) || 0) * 100 + (Number(a.start_month) || 0);
    const bValue = (Number(b.start_year) || 0) * 100 + (Number(b.start_month) || 0);
    if (aValue !== bValue) return bValue - aValue;
    return String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""));
  });
}

function normalizeExperienceForPreview(entry) {
  return {
    id: entry.id,
    position: entry.job_title,
    employer: entry.company_name,
    location: entry.location,
    employment_type: entry.employment_type,
    start_date: formatMonthYear(entry.start_month, entry.start_year),
    end_date: entry.is_current ? "Present" : formatMonthYear(entry.end_month, entry.end_year),
    current: Boolean(entry.is_current),
    description: entry.description
  };
}

function formatExperienceDateRange(entry) {
  const start = formatMonthYear(entry.start_month, entry.start_year);
  const end = entry.is_current ? "Present" : formatMonthYear(entry.end_month, entry.end_year);
  return [start, end].filter(Boolean).join(" - ") || "Dates not listed";
}

function formatMonthYear(month, year) {
  const yearNumber = Number(year);
  if (!yearNumber) return "";
  const monthNumber = Number(month);
  const monthLabel = MONTH_OPTIONS.find(([value]) => Number(value) === monthNumber)?.[1] || "";
  return monthLabel ? `${monthLabel.slice(0, 3)} ${yearNumber}` : String(yearNumber);
}

function formatProfileDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function getStrengthHint(score) {
  if (score >= 90) return "Your profile is in strong shape for employer review.";
  if (score >= 70) return "Add a resume, certifications, or more detail to make the profile stronger.";
  if (score >= 45) return "Complete your experience, skills, and contact preferences to improve employer visibility.";
  return "Start with your role, location, summary, and availability so employers can understand your fit.";
}

function updateVisibilityLabels() {
  const isVisible = getEl("profile_visible")?.checked !== false;
  const visibilityChip = getEl("visibilityChip");
  const previewPill = getEl("previewVisibilityPill");

  [visibilityChip, previewPill].forEach((item) => {
    if (!item) return;
    item.textContent = isVisible ? "Visible to Employers" : "Hidden from Employers";
    item.classList.toggle("hidden", !isVisible);
  });
}

function getPreviewProfileFromForm() {
  return {
    ...currentProfile,
    full_name: value("full_name") || currentProfile.full_name || "Candidate Name",
    trade: value("trade_preference") || value("trade") || currentProfile.trade || "",
    willing_to_travel: value("willing_to_travel") || currentProfile.willing_to_travel || "",
    employment_type: value("employment_type") || currentProfile.employment_type || "",
    location: value("location") || currentProfile.location || "",
    bio: value("bio") || currentProfile.bio || "",
    experience: value("experience") || currentProfile.experience || "",
    skills: value("skills") || currentProfile.skills || "",
    certifications: value("certifications") || currentProfile.certifications || "",
    availability: value("availability") || currentProfile.availability || "",
    email: value("email") || currentProfile.email || currentUser?.email || "",
    phone: value("phone") || currentProfile.phone || "",
    contact_method: value("contact_method") || currentProfile.contact_method || "",
    shown_contact_method: window.PlacelyAuth.normalizeCandidateContactPreference(value("shown_contact_method") || currentProfile.shown_contact_method),
    profile_photo_url:
      selectedPhotoPreviewUrl ||
      getCandidatePhotoUrl(currentProfile.profile_photo_url || currentProfile.avatar_url) ||
      "",
    avatar_url: currentProfile.avatar_url || "",
    resume_path: getResumePath(currentProfile),
    resume_url: "",
    work_history: workExperiences.map(normalizeExperienceForPreview)
  };
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHTML(value).replaceAll("`", "&#096;");
}

async function loadCandidateProfile() {
  const user = await verifyCandidateAccess(candidateSupabase, {
    loginPath: "candidate-login.html",
    employerDashboardPath: "../employers/employer-dashboard.html"
  });

  if (!user) return;
  currentUser = user;

  const { data: profile, error } = await candidateSupabase
    .from("candidate_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    await window.PlacelyAuth.clearAuthState();
    window.location.replace("candidate-login.html");
    return;
  }

  currentProfile = profile;
  await loadWorkExperiences(user.id);
  currentProfile = {
    ...currentProfile,
    work_history: workExperiences.map(normalizeExperienceForPreview)
  };

  getEl("profile_photo_preview").src =
    getCandidatePhotoUrl(currentProfile.profile_photo_url || currentProfile.avatar_url) ||
    "https://placehold.co/180x180";

  renderResumeManager();

  getEl("full_name").value = currentProfile.full_name || "";
  getEl("trade").value = currentProfile.trade || "";
  getEl("trade_preference").value = currentProfile.trade || "";
  getEl("location").value = currentProfile.location || "";
  getEl("bio").value = currentProfile.bio || "";
  getEl("experience").value = currentProfile.experience || "";
  getEl("skills").value = currentProfile.skills || "";
  getEl("certifications").value = currentProfile.certifications || "";
  getEl("availability").value = currentProfile.availability || "";
  getEl("willing_to_travel").value = currentProfile.willing_to_travel || "";
  getEl("employment_type").value = currentProfile.employment_type || "";
  getEl("email").value = currentProfile.email || user.email || "";
  getEl("phone").value = currentProfile.phone || "";
  getEl("contact_method").value = currentProfile.contact_method || "Email";
  getEl("shown_contact_method").value = window.PlacelyAuth.normalizeCandidateContactPreference(currentProfile.shown_contact_method) || "email";
  getEl("profile_visible").checked = currentProfile.profile_visible ?? true;

  updatePreview();
  renderWorkExperienceSummary();
  hydrateHeader();
  await loadHeaderCounts(user.id);
  applyInitialProfileViewState();
}

function getCandidatePhotoUrl(value, cacheBust = "") {
  return window.PlacelyAuth.getPublicImageUrl(candidateSupabase, PHOTO_BUCKET, value, { cacheBust });
}

async function uploadCandidatePhoto(file, userId) {
  return window.PlacelyAuth.uploadOwnedImage(candidateSupabase, "candidatePhoto", file, userId);
}

async function uploadResume(file, userId) {
  validateUploadFile(RESUME_BUCKET, file);

  const cleanName = file.name
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]/g, "-")
    .replace(/-+/g, "-");
  const path = `${userId}/${Date.now()}-${cleanName}`;

  const { error } = await candidateSupabase.storage
    .from(RESUME_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });

  if (error) throw error;
  return path;
}

function validateUploadFile(bucket, file) {
  if (!file) return;

  if (bucket === RESUME_BUCKET) {
    if (!ALLOWED_RESUME_TYPES.has(file.type)) {
      throw new Error("Resume must be a PDF or DOCX file.");
    }

    if (file.size > MAX_RESUME_SIZE_BYTES) {
      throw new Error("Resume must be 10 MB or smaller.");
    }
  }
}

function getResumePath(profile = currentProfile) {
  return profile.resume_path || getResumePathFromLegacyUrl(profile.resume_url || "");
}

function getResumePathFromLegacyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (!/^https?:\/\//i.test(raw)) {
    return normalizeResumePath(raw);
  }

  try {
    const url = new URL(raw);
    const marker = "/candidate_resumes/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex === -1) return "";
    return normalizeResumePath(url.pathname.slice(markerIndex + marker.length));
  } catch {
    return "";
  }
}

function normalizeResumePath(value) {
  const path = safeDecodeURIComponent(String(value || "").trim())
    .replace(/^\/+/, "")
    .replace(/^candidate_resumes\/+/, "");

  return path;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isOwnResumePath(path, userId) {
  return Boolean(path && userId && path.startsWith(`${userId}/`));
}

function getResumeFileName(path) {
  const fileName = String(path || "").split("/").pop() || "Resume uploaded";
  return decodeURIComponent(fileName);
}

function renderResumeManager(profile = currentProfile) {
  const resumePreview = getEl("resume_preview");
  const resumeFileName = getEl("resume_file_name");
  const resumePath = getResumePath(profile);

  if (!resumePreview || !resumeFileName) return;

  if (resumePath) {
    resumePreview.style.display = "flex";
    resumeFileName.textContent = getResumeFileName(resumePath);
  } else {
    resumePreview.style.display = "none";
    resumeFileName.textContent = "";
  }
}

async function refreshResumeManager() {
  if (!currentUser) return;

  const { data, error } = await candidateSupabase
    .from("candidate_profiles")
    .select("id, resume_path, resume_url")
    .eq("id", currentUser.id)
    .single();

  if (error) throw error;

  currentProfile = {
    ...currentProfile,
    resume_path: data.resume_path || null,
    resume_url: data.resume_url || null
  };

  renderResumeManager();
}

async function removeResumeObject(path) {
  if (!path) return;

  const { error } = await candidateSupabase.storage
    .from(RESUME_BUCKET)
    .remove([path]);

  if (error) {
    return;
  }
}

async function deleteCurrentResume() {
  if (isDeletingResume) return;

  const supabaseClient = candidateSupabase;
  const removeResumeBtn = getEl("remove_resume_btn");
  const resumeInput = getEl("resume_file");
  const originalText = removeResumeBtn?.textContent || "Remove";

  if (!window.confirm("Remove this resume?")) return;

  isDeletingResume = true;
  if (removeResumeBtn) {
    removeResumeBtn.disabled = true;
    removeResumeBtn.textContent = "Removing...";
  }

  try {
    const {
      data: { user },
      error: userError
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      throw userError || new Error("You must be signed in to remove your resume.");
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from("candidate_profiles")
      .select("id, resume_path, resume_url")
      .eq("id", user.id)
      .single();

    if (profileError) throw profileError;

    const resumePath = getResumePath(profile);

    if (!resumePath) {
      throw new Error("No stored resume path was found. The resume could not be deleted.");
    }

    if (!isOwnResumePath(resumePath, user.id)) {
      throw new Error("Stored resume path does not belong to the signed-in candidate.");
    }

    const { error } = await supabaseClient.storage
      .from("candidate_resumes")
      .remove([resumePath]);

    if (error) throw error;

    const { data: updatedProfile, error: updateError } = await supabaseClient
      .from("candidate_profiles")
      .update({
        resume_path: null,
        resume_url: null
      })
      .eq("id", user.id)
      .select()
      .single();

    if (updateError) throw updateError;

    currentUser = user;
    currentProfile = updatedProfile;
    if (resumeInput) resumeInput.value = "";

    updateStrength();
    updatePreview();
    await refreshResumeManager();
    showToast("Resume removed.");
  } catch (error) {
    showToast(getFriendlyProfileError(error, "Could not remove resume."));
  } finally {
    isDeletingResume = false;
    if (removeResumeBtn) {
      removeResumeBtn.disabled = false;
      removeResumeBtn.textContent = originalText;
    }
  }
}

async function uploadSelectedResume(file) {
  if (isUploadingResume) return;

  const resumeInput = getEl("resume_file");
  const removeResumeBtn = getEl("remove_resume_btn");
  const previousResumePath = getResumePath(currentProfile);

  isUploadingResume = true;
  if (removeResumeBtn) removeResumeBtn.disabled = true;

  try {
    const {
      data: { user },
      error: userError
    } = await candidateSupabase.auth.getUser();

    if (userError || !user) {
      throw userError || new Error("You must be signed in to upload your resume.");
    }

    currentUser = user;

    const resumePath = await uploadResume(file, user.id);

    const { data: updatedProfile, error: updateError } = await candidateSupabase
      .from("candidate_profiles")
      .update({
        resume_path: resumePath,
        resume_url: null
      })
      .eq("id", user.id)
      .select()
      .single();

    if (updateError) {
      await removeResumeObject(resumePath);
      throw updateError;
    }

    currentProfile = updatedProfile;
    if (resumeInput) resumeInput.value = "";

    if (previousResumePath && previousResumePath !== resumePath) {
      await removeResumeObject(previousResumePath);
    }

    await refreshResumeManager();
    updateStrength();
    updatePreview();
    showToast("Resume uploaded.");
  } catch (error) {
    if (resumeInput) resumeInput.value = "";
    renderResumeManager();
    showToast(getFriendlyProfileError(error, "Could not upload resume."));
  } finally {
    isUploadingResume = false;
    if (removeResumeBtn) removeResumeBtn.disabled = false;
  }
}

async function openOwnResume() {
  const path = getResumePath(currentProfile);

  if (!path) {
    showToast("No resume is uploaded yet.");
    return;
  }

  const { data, error } = await candidateSupabase.storage
    .from(RESUME_BUCKET)
    .createSignedUrl(path, RESUME_SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) {
    showToast("Could not open resume.");
    return;
  }

  window.open(data.signedUrl, "_blank", "noopener");
}

async function saveCandidateProfile() {
  if (!currentUser) {
    showToast("User not loaded yet.");
    return;
  }

  const saveButtons = document.querySelectorAll(".save-profile-btn, .save-top-btn");
  saveButtons.forEach(btn => {
    btn.disabled = true;
    btn.textContent = "Saving...";
  });

  try {
    let profilePhotoUrl = currentProfile.profile_photo_url || null;
    const previousPhotoValue = currentProfile.profile_photo_url || currentProfile.avatar_url || "";
    let uploadedPhotoPath = "";

    const photoFile = getEl("profile_photo_file")?.files[0];

    if (photoFile) {
      uploadedPhotoPath = await uploadCandidatePhoto(photoFile, currentUser.id);
      profilePhotoUrl = uploadedPhotoPath;
    }

    const updates = {
      id: currentUser.id,
      full_name: value("full_name"),
      trade: value("trade_preference") || value("trade"),
      willing_to_travel: value("willing_to_travel"),
      employment_type: value("employment_type"),
      location: value("location"),
      bio: value("bio"),
      experience: value("experience"),
      skills: value("skills"),
      certifications: value("certifications"),
      availability: value("availability"),
      email: value("email") || currentUser.email,
      phone: value("phone"),
      contact_method: value("contact_method"),
      shown_contact_method: window.PlacelyAuth.normalizeCandidateContactPreference(value("shown_contact_method")) || "email",
      profile_visible: getEl("profile_visible").checked,
      profile_photo_url: profilePhotoUrl
    };

    const willBeComplete = window.PlacelyAuth.isCandidateOnboardingComplete({
      ...currentProfile,
      ...updates
    });

    updates.onboarding_completed = willBeComplete;
    updates.onboarding_completed_at = willBeComplete
      ? (currentProfile.onboarding_completed_at || new Date().toISOString())
      : null;

    const { data, error } = await updateExistingCandidateProfile(updates);

    if (error) {
      throw error;
    }

    currentProfile = {
      ...data,
      resume_path: currentProfile.resume_path || null,
      resume_url: currentProfile.resume_url || null
    };

    selectedPhotoPreviewUrl = "";
    getEl("profile_photo_file").value = "";

    showToast("Profile saved successfully.");
    if (uploadedPhotoPath && previousPhotoValue && previousPhotoValue !== uploadedPhotoPath) {
      try {
        await window.PlacelyAuth.removeOwnedImage(candidateSupabase, PHOTO_BUCKET, previousPhotoValue, currentUser.id);
      } catch {}
    }
    if (currentProfile.profile_photo_url) {
      getEl("profile_photo_preview").src = getCandidatePhotoUrl(currentProfile.profile_photo_url, Date.now());
    }
    updatePreview();
  } catch (error) {
    showToast(getFriendlyProfileError(error, "Could not save profile."));
  } finally {
    saveButtons.forEach(btn => {
      btn.disabled = false;
      btn.textContent = "Save Changes";
    });
  }
}

async function updateExistingCandidateProfile(updates) {
  const result = await candidateSupabase
    .from("candidate_profiles")
    .update(updates)
    .eq("id", currentUser.id)
    .select()
    .single();

  if (!isMissingColumnError(result.error)) {
    return result;
  }

  const compatibleUpdates = { ...updates };
  delete compatibleUpdates.onboarding_completed;
  delete compatibleUpdates.onboarding_completed_at;

  return candidateSupabase
    .from("candidate_profiles")
    .update(compatibleUpdates)
    .eq("id", currentUser.id)
    .select()
    .single();
}

function isMissingColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "PGRST204" || message.includes("column") && message.includes("onboarding");
}

function getFriendlyProfileError(error, fallback) {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("must be a pdf") || message.includes("must be png") || message.includes("please upload a jpg") || message.includes("mb")) {
    return error.message;
  }

  if (window.PlacelyAuth?.isMissingRowError?.(error)) {
    return "We could not verify your candidate profile. Please log in again.";
  }

  return fallback;
}

function setupEvents() {
  getEl("logoutBtn")?.addEventListener("click", handleLogout);
  getEl("accountMenuLogoutBtn")?.addEventListener("click", handleLogout);
  bindAccountMenu();
  bindMobileSidebar();
  bindHeaderSearch();

  const uploadPhotoBtn = getEl("uploadPhotoBtn");
  const removePhotoBtn = getEl("removePhotoBtn");
  const photoInput = getEl("profile_photo_file");
  const resumeDrop = getEl("resumeDrop");
  const resumeInput = getEl("resume_file");
  const removeResumeBtn = getEl("remove_resume_btn");
  const downloadResumeBtn = getEl("download_resume_btn");

  if (uploadPhotoBtn && photoInput) {
    uploadPhotoBtn.addEventListener("click", () => {
      photoInput.click();
    });
  }

  if (photoInput) {
    photoInput.addEventListener("change", async () => {
      const file = photoInput.files[0];

      if (!file) return;

      try {
        await window.PlacelyAuth.validateImageFileForUpload(file, "candidatePhoto");
        if (selectedPhotoPreviewUrl) URL.revokeObjectURL(selectedPhotoPreviewUrl);
        selectedPhotoPreviewUrl = URL.createObjectURL(file);
        getEl("profile_photo_preview").src = selectedPhotoPreviewUrl;
        updateStrength();
        updatePreview();
      } catch (error) {
        photoInput.value = "";
        showToast(error?.message || "Please upload a JPG, PNG, or WebP image.");
      }
    });
  }

  removePhotoBtn?.addEventListener("click", removeCurrentPhoto);

  if (resumeDrop && resumeInput) {
    resumeDrop.addEventListener("click", () => {
      resumeInput.click();
    });
  }

  if (resumeInput) {
    resumeInput.addEventListener("change", async () => {
      const file = resumeInput.files[0];

      if (!file) return;

      await uploadSelectedResume(file);
    });
  }

  if (removeResumeBtn) {
    removeResumeBtn.addEventListener("click", deleteCurrentResume);
  }

  if (downloadResumeBtn) {
    downloadResumeBtn.addEventListener("click", openOwnResume);
  }

  document.querySelectorAll(".save-profile-btn, .save-top-btn").forEach(button => {
    button.addEventListener("click", saveCandidateProfile);
  });

  getEl("viewPreviewBtn")?.addEventListener("click", openPreviewState);
  getEl("headerPreviewBtn")?.addEventListener("click", openPreviewState);
  window.addEventListener("popstate", handleProfilePopState);

  document.querySelectorAll("input, textarea, select").forEach(input => {
    input.addEventListener("input", updatePreview);
    input.addEventListener("change", updatePreview);
  });

  getEl("trade_preference")?.addEventListener("input", () => {
    const trade = getEl("trade");
    const preference = getEl("trade_preference");
    if (trade && preference) trade.value = preference.value;
    updatePreview();
  });

  getEl("trade")?.addEventListener("input", () => {
    const trade = getEl("trade");
    const preference = getEl("trade_preference");
    if (trade && preference) preference.value = trade.value;
  });

  document.querySelectorAll(".tag-row span").forEach(tag => {
    tag.addEventListener("click", () => {
      const text = tag.textContent.trim();

      const skillsInput = getEl("skills");
      const certInput = getEl("certifications");

      const certWords = ["CSTS", "WHMIS", "Fall Protection", "First Aid"];

      if (certWords.includes(text)) {
        const existing = certInput.value.trim();
        certInput.value = existing ? `${existing}, ${text}` : text;
      } else {
        const existing = skillsInput.value.trim();
        skillsInput.value = existing ? `${existing}, ${text}` : text;
      }

      updatePreview();
    });
  });
}

function applyInitialProfileViewState() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "preview") {
    renderPreviewState({ replaceHistory: true });
  } else if (params.get("view") === "experience-new") {
    renderExperienceEditorState({ mode: "new", replaceHistory: true });
  } else if (params.get("view") === "experience-edit") {
    renderExperienceEditorState({ mode: "edit", experienceId: params.get("id"), replaceHistory: true });
  } else {
    renderEditState({ replaceHistory: true });
  }
}

function openPreviewState() {
  renderPreviewState();
}

function renderPreviewState({ replaceHistory = false } = {}) {
  const editWorkspace = getEl("profileEditWorkspace");
  const previewWorkspace = getEl("profilePreviewWorkspace");
  const experienceWorkspace = getEl("profileExperienceWorkspace");
  if (!editWorkspace || !previewWorkspace || !experienceWorkspace) return;

  profileEditScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
  profileViewState = "preview";
  editWorkspace.hidden = true;
  previewWorkspace.hidden = false;
  experienceWorkspace.hidden = true;
  experienceWorkspace.innerHTML = "";
  previewWorkspace.innerHTML = renderProfilePreviewWorkspace();
  bindPreviewWorkspaceEvents();
  updateProfileUrl("preview", replaceHistory);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderEditState({ replaceHistory = false } = {}) {
  const editWorkspace = getEl("profileEditWorkspace");
  const previewWorkspace = getEl("profilePreviewWorkspace");
  const experienceWorkspace = getEl("profileExperienceWorkspace");
  if (!editWorkspace || !previewWorkspace || !experienceWorkspace) return;

  profileViewState = "edit";
  editWorkspace.hidden = false;
  previewWorkspace.hidden = true;
  experienceWorkspace.hidden = true;
  previewWorkspace.innerHTML = "";
  experienceWorkspace.innerHTML = "";
  renderWorkExperienceSummary();
  updateProfileUrl("edit", replaceHistory);
  window.setTimeout(() => window.scrollTo({ top: profileEditScrollTop || 0, behavior: "smooth" }), 0);
}

function openExperienceEditorState(mode = "new", experienceId = "") {
  renderExperienceEditorState({ mode, experienceId });
}

function renderExperienceEditorState({ mode = "new", experienceId = "", replaceHistory = false } = {}) {
  const editWorkspace = getEl("profileEditWorkspace");
  const previewWorkspace = getEl("profilePreviewWorkspace");
  const experienceWorkspace = getEl("profileExperienceWorkspace");
  if (!editWorkspace || !previewWorkspace || !experienceWorkspace) return;

  profileEditScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
  profileViewState = mode === "edit" ? "experience-edit" : "experience-new";
  editWorkspace.hidden = true;
  previewWorkspace.hidden = true;
  previewWorkspace.innerHTML = "";
  experienceWorkspace.hidden = false;

  const experience = mode === "edit"
    ? workExperiences.find((entry) => String(entry.id) === String(experienceId))
    : null;

  if (mode === "edit" && !experience) {
    experienceWorkspace.innerHTML = renderMissingExperienceState();
    bindExperienceWorkspaceEvents();
    updateProfileUrl("experience-edit", replaceHistory, experienceId);
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  experienceWorkspace.innerHTML = renderExperienceEditor({ mode, experience });
  bindExperienceWorkspaceEvents();
  updateEndDateState();
  updateProfileUrl(mode === "edit" ? "experience-edit" : "experience-new", replaceHistory, experienceId);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderMissingExperienceState() {
  return `
    <section class="dashboard-briefing profile-briefing" aria-labelledby="experienceUnavailableTitle">
      <div class="briefing-copy">
        <h1 id="experienceUnavailableTitle">Position unavailable</h1>
        <p>This work-experience entry could not be found.</p>
      </div>
      <div class="briefing-actions">
        <button type="button" class="secondary-btn back-to-profile-btn">${getBackIcon()} Back to Profile</button>
      </div>
    </section>
    <section class="panel experience-editor-card">
      <p class="panel-text">Return to your profile and choose another position, or add a new role.</p>
      <button type="button" class="primary-btn add-experience-from-empty">Add Work Experience</button>
    </section>
  `;
}

function renderExperienceEditor({ mode, experience }) {
  const isEdit = mode === "edit";
  const title = isEdit ? "Edit Work Experience" : "Add Work Experience";
  const description = isEdit
    ? "Update the details employers will see about this position."
    : "Add a previous or current role to help employers understand your background.";

  return `
    <section class="dashboard-briefing profile-briefing" aria-labelledby="experienceEditorTitle">
      <div class="briefing-copy">
        <h1 id="experienceEditorTitle">${escapeHTML(title)}</h1>
        <p>${escapeHTML(description)}</p>
      </div>
      <div class="briefing-actions">
        <button type="button" class="secondary-btn back-to-profile-btn">${getBackIcon()} Back to Profile</button>
      </div>
    </section>

    <form class="panel experience-editor-card" id="workExperienceForm" novalidate data-mode="${escapeAttribute(mode)}" data-experience-id="${escapeAttribute(experience?.id || "")}">
      <div class="experience-form-message" id="experienceFormMessage" role="alert" hidden></div>

      <section class="experience-form-section">
        <div class="panel-heading compact">
          <div>
            <span class="eyebrow">Role Details</span>
            <h2>Position information</h2>
          </div>
        </div>
        <div class="form-grid">
          ${renderExperienceField("experience_job_title", "Job title", "text", experience?.job_title || "", "e.g. HVAC Apprentice", true)}
          ${renderExperienceField("experience_company_name", "Company name", "text", experience?.company_name || "", "e.g. NorthX Systems", true)}
          ${renderExperienceField("experience_location", "Location", "text", experience?.location || "", "e.g. Calgary, AB")}
          <div>
            <label for="experience_employment_type">Employment type</label>
            <select id="experience_employment_type">
              <option value="">Select employment type</option>
              ${EXPERIENCE_EMPLOYMENT_TYPES.map((type) => `<option${type === experience?.employment_type ? " selected" : ""}>${escapeHTML(type)}</option>`).join("")}
            </select>
            <p class="field-error" id="experience_employment_type_error"></p>
          </div>
        </div>
      </section>

      <section class="experience-form-section">
        <div class="panel-heading compact">
          <div>
            <span class="eyebrow">Employment Period</span>
            <h2>Dates</h2>
          </div>
        </div>
        <div class="form-grid">
          ${renderMonthSelect("experience_start_month", "Start month", experience?.start_month, true)}
          ${renderYearInput("experience_start_year", "Start year", experience?.start_year, true)}
          ${renderMonthSelect("experience_end_month", "End month", experience?.end_month)}
          ${renderYearInput("experience_end_year", "End year", experience?.end_year)}
        </div>
        <label class="toggle-row experience-current-row" for="experience_is_current">
          <input id="experience_is_current" type="checkbox"${experience?.is_current ? " checked" : ""} />
          <span>I currently work here</span>
        </label>
      </section>

      <section class="experience-form-section">
        <div class="panel-heading compact">
          <div>
            <span class="eyebrow">Position Summary</span>
            <h2>Role description</h2>
          </div>
        </div>
        <label for="experience_description">Role description</label>
        <textarea id="experience_description" maxlength="1200" placeholder="Describe your responsibilities, daily work, accomplishments, equipment, projects, or skills used in this role.">${escapeHTML(experience?.description || "")}</textarea>
        <p class="field-helper">Describe your responsibilities, daily work, accomplishments, equipment, projects, or skills used in this role.</p>
      </section>

      <div class="experience-actions">
        ${isEdit ? '<button type="button" class="danger-outline-btn" id="removeExperienceBtn">Remove Position</button>' : ""}
        <div class="experience-actions-main">
          <button type="button" class="secondary-btn cancel-experience-btn">Cancel</button>
          <button type="submit" class="primary-btn" id="saveExperienceBtn">${isEdit ? "Save Changes" : "Save Experience"}</button>
        </div>
      </div>
    </form>
  `;
}

function renderExperienceField(id, label, type, currentValue, placeholder, required = false) {
  return `
    <div>
      <label for="${escapeAttribute(id)}">${escapeHTML(label)}</label>
      <input id="${escapeAttribute(id)}" type="${escapeAttribute(type)}" value="${escapeAttribute(currentValue)}" placeholder="${escapeAttribute(placeholder)}"${required ? " required" : ""} />
      <p class="field-error" id="${escapeAttribute(id)}_error"></p>
    </div>
  `;
}

function renderMonthSelect(id, label, currentValue, required = false) {
  const normalizedValue = String(currentValue || "");
  return `
    <div>
      <label for="${escapeAttribute(id)}">${escapeHTML(label)}</label>
      <select id="${escapeAttribute(id)}"${required ? " required" : ""}>
        <option value="">Select month</option>
        ${MONTH_OPTIONS.map(([value, text]) => `<option value="${escapeAttribute(value)}"${value === normalizedValue ? " selected" : ""}>${escapeHTML(text)}</option>`).join("")}
      </select>
      <p class="field-error" id="${escapeAttribute(id)}_error"></p>
    </div>
  `;
}

function renderYearInput(id, label, currentValue, required = false) {
  return `
    <div>
      <label for="${escapeAttribute(id)}">${escapeHTML(label)}</label>
      <input id="${escapeAttribute(id)}" type="number" min="1950" max="2100" step="1" value="${escapeAttribute(currentValue || "")}" placeholder="YYYY"${required ? " required" : ""} />
      <p class="field-error" id="${escapeAttribute(id)}_error"></p>
    </div>
  `;
}

function bindExperienceWorkspaceEvents() {
  document.querySelectorAll(".back-to-profile-btn, .cancel-experience-btn").forEach((button) => {
    button.addEventListener("click", () => renderEditState({ replaceHistory: true }));
  });

  document.querySelector(".add-experience-from-empty")?.addEventListener("click", () => openExperienceEditorState("new"));
  getEl("experience_is_current")?.addEventListener("change", updateEndDateState);
  getEl("workExperienceForm")?.addEventListener("submit", saveWorkExperience);
  getEl("removeExperienceBtn")?.addEventListener("click", removeWorkExperience);
}

function updateEndDateState() {
  const isCurrent = getEl("experience_is_current")?.checked === true;
  ["experience_end_month", "experience_end_year"].forEach((id) => {
    const input = getEl(id);
    if (!input) return;
    input.disabled = isCurrent;
    if (isCurrent) {
      input.value = "";
      setFieldError(id, "");
    }
  });
}

async function saveWorkExperience(event) {
  event?.preventDefault();
  if (!currentUser || isSavingExperience) return;

  const form = getEl("workExperienceForm");
  const saveButton = getEl("saveExperienceBtn");
  const mode = form?.dataset.mode === "edit" ? "edit" : "new";
  const experienceId = form?.dataset.experienceId || "";
  const originalText = saveButton?.textContent || "Save Experience";
  const validation = validateExperienceForm();

  if (!validation.valid) {
    setExperienceFormMessage("Please correct the highlighted fields.");
    return;
  }

  isSavingExperience = true;
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "Saving...";
  }

  try {
    const payload = {
      candidate_id: currentUser.id,
      ...validation.payload
    };

    let result;
    if (mode === "edit") {
      result = await candidateSupabase
        .from("candidate_work_experience")
        .update(validation.payload)
        .eq("id", experienceId)
        .eq("candidate_id", currentUser.id)
        .select(WORK_EXPERIENCE_FIELDS)
        .maybeSingle();
    } else {
      result = await candidateSupabase
        .from("candidate_work_experience")
        .insert(payload)
        .select(WORK_EXPERIENCE_FIELDS)
        .single();
    }

    if (result.error) throw result.error;
    if (!result.data) throw new Error("No owned work experience record was returned.");

    if (mode === "edit") {
      workExperiences = workExperiences.map((entry) => String(entry.id) === String(result.data.id) ? result.data : entry);
    } else {
      workExperiences = [...workExperiences, result.data];
    }

    workExperiences = sortWorkExperiences(workExperiences);
    currentProfile = {
      ...currentProfile,
      work_history: workExperiences.map(normalizeExperienceForPreview)
    };
    updatePreview();
    showToast(mode === "edit" ? "Experience updated." : "Experience added.");
    renderEditState({ replaceHistory: true });
    window.setTimeout(() => getEl("experience-section")?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
  } catch (error) {
    console.error("Work experience save failed", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint
    });
    setExperienceFormMessage("We could not save this experience. Please try again.");
  } finally {
    isSavingExperience = false;
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = originalText;
    }
  }
}

async function removeWorkExperience() {
  if (!currentUser || isDeletingExperience) return;
  const form = getEl("workExperienceForm");
  const experienceId = form?.dataset.experienceId || "";
  if (!experienceId) return;
  if (!window.confirm("Remove this position from your profile?")) return;

  isDeletingExperience = true;
  const removeButton = getEl("removeExperienceBtn");
  if (removeButton) {
    removeButton.disabled = true;
    removeButton.textContent = "Removing...";
  }

  try {
    const { error } = await candidateSupabase
      .from("candidate_work_experience")
      .delete()
      .eq("id", experienceId)
      .eq("candidate_id", currentUser.id);

    if (error) throw error;
    workExperiences = workExperiences.filter((entry) => String(entry.id) !== String(experienceId));
    currentProfile = {
      ...currentProfile,
      work_history: workExperiences.map(normalizeExperienceForPreview)
    };
    updatePreview();
    showToast("Experience removed.");
    renderEditState({ replaceHistory: true });
  } catch (error) {
    console.error("Work experience remove failed", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint
    });
    setExperienceFormMessage("We could not remove this position. Please try again.");
  } finally {
    isDeletingExperience = false;
    if (removeButton) {
      removeButton.disabled = false;
      removeButton.textContent = "Remove Position";
    }
  }
}

function validateExperienceForm() {
  clearExperienceErrors();

  const jobTitle = value("experience_job_title");
  const companyName = value("experience_company_name");
  const location = value("experience_location");
  const employmentType = value("experience_employment_type");
  const startMonth = Number(value("experience_start_month"));
  const startYear = Number(value("experience_start_year"));
  const isCurrent = getEl("experience_is_current")?.checked === true;
  const endMonthValue = value("experience_end_month");
  const endYearValue = value("experience_end_year");
  const endMonth = Number(endMonthValue);
  const endYear = Number(endYearValue);
  const description = value("experience_description");
  let valid = true;

  if (!jobTitle) valid = setFieldError("experience_job_title", "Job title is required.");
  if (!companyName) valid = setFieldError("experience_company_name", "Company name is required.");
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) valid = setFieldError("experience_start_month", "Select a start month.");
  if (!isValidYear(startYear)) valid = setFieldError("experience_start_year", "Enter a valid start year.");

  if (!isCurrent) {
    if (!Number.isInteger(endMonth) || endMonth < 1 || endMonth > 12) valid = setFieldError("experience_end_month", "Select an end month.");
    if (!isValidYear(endYear)) valid = setFieldError("experience_end_year", "Enter a valid end year.");
    if (valid && endYear * 100 + endMonth < startYear * 100 + startMonth) {
      valid = setFieldError("experience_end_month", "End date cannot be earlier than start date.");
      setFieldError("experience_end_year", "End date cannot be earlier than start date.");
    }
  }

  return {
    valid,
    payload: {
      job_title: jobTitle,
      company_name: companyName,
      location: location || null,
      employment_type: employmentType || null,
      start_month: startMonth,
      start_year: startYear,
      end_month: isCurrent ? null : endMonth,
      end_year: isCurrent ? null : endYear,
      is_current: isCurrent,
      description: description || null
    }
  };
}

function clearExperienceErrors() {
  document.querySelectorAll(".field-error").forEach((element) => {
    element.textContent = "";
  });
  setExperienceFormMessage("");
}

function setFieldError(id, message) {
  const error = getEl(`${id}_error`);
  const input = getEl(id);
  if (error) error.textContent = message || "";
  if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
  return false;
}

function setExperienceFormMessage(message) {
  const messageEl = getEl("experienceFormMessage");
  if (!messageEl) return;
  messageEl.hidden = !message;
  messageEl.textContent = message || "";
}

function isValidYear(year) {
  const currentYear = new Date().getFullYear() + 1;
  return Number.isInteger(year) && year >= 1950 && year <= currentYear;
}

function renderProfilePreviewWorkspace() {
  try {
    const profile = getPreviewProfileFromForm();

    return `
      <section class="dashboard-briefing profile-briefing profile-preview-briefing" aria-labelledby="profilePreviewTitle">
        <div class="briefing-copy">
          <h1 id="profilePreviewTitle">Profile Preview</h1>
          <p>This is how employers with Candidate Access will see your profile.</p>
        </div>
        <div class="briefing-actions">
          <button type="button" class="secondary-btn" id="backToEditProfileBtn">${getBackIcon()} Back to Edit Profile</button>
        </div>
      </section>
      ${window.CandidateProfilePreview?.renderCandidateProfile?.(profile, {
        viewer: "candidate-self",
        showContactAccordingToVisibility: true,
        showEmployerActions: false
      }) || ""}
    `;
  } catch (error) {
    console.error("Profile preview render failed", error);
    return `
      <section class="dashboard-briefing profile-briefing profile-preview-briefing" aria-labelledby="profilePreviewTitle">
        <div class="briefing-copy">
          <h1 id="profilePreviewTitle">Profile Preview</h1>
          <p>This is how employers with Candidate Access will see your profile.</p>
        </div>
      </section>
      <section class="panel profile-preview-error">
        <h2>We could not load your profile preview</h2>
        <p class="panel-text">Return to your profile and try again.</p>
        <button type="button" class="secondary-btn" id="backToEditProfileBtn">${getBackIcon()} Back to Edit Profile</button>
      </section>
    `;
  }
}

function getBackIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16"><path fill="currentColor" d="m10.8 12 4.6 4.6L14 18l-6-6 6-6 1.4 1.4L10.8 12Z"/></svg>';
}

function bindPreviewWorkspaceEvents() {
  getEl("backToEditProfileBtn")?.addEventListener("click", () => {
    renderEditState({ replaceHistory: true });
  });
}

function handleProfilePopState() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "preview") {
    renderPreviewState({ replaceHistory: true });
  } else if (params.get("view") === "experience-new") {
    renderExperienceEditorState({ mode: "new", replaceHistory: true });
  } else if (params.get("view") === "experience-edit") {
    renderExperienceEditorState({ mode: "edit", experienceId: params.get("id"), replaceHistory: true });
  } else {
    renderEditState({ replaceHistory: true });
  }
}

function updateProfileUrl(view, replaceHistory = false, experienceId = "") {
  const url = new URL(window.location.href);
  url.searchParams.delete("id");

  if (view === "preview") {
    url.searchParams.set("view", "preview");
  } else if (view === "experience-new") {
    url.searchParams.set("view", "experience-new");
  } else if (view === "experience-edit") {
    url.searchParams.set("view", "experience-edit");
    if (experienceId) url.searchParams.set("id", experienceId);
  } else {
    url.searchParams.delete("view");
  }

  const state = { profileView: view };
  if (replaceHistory) window.history.replaceState(state, "", url);
  else window.history.pushState(state, "", url);
}

async function removeCurrentPhoto() {
  if (!currentUser || isDeletingPhoto) return;

  const currentValue = currentProfile.profile_photo_url || currentProfile.avatar_url || "";
  if (!currentValue) return;
  if (!window.confirm("Remove this profile photo?")) return;

  isDeletingPhoto = true;
  const removePhotoBtn = getEl("removePhotoBtn");
  const uploadPhotoBtn = getEl("uploadPhotoBtn");
  if (removePhotoBtn) {
    removePhotoBtn.disabled = true;
    removePhotoBtn.textContent = "Removing...";
  }
  if (uploadPhotoBtn) uploadPhotoBtn.disabled = true;

  try {
    if (window.PlacelyAuth.isOwnedStoragePath(currentValue, PHOTO_BUCKET, currentUser.id)) {
      await window.PlacelyAuth.removeOwnedImage(candidateSupabase, PHOTO_BUCKET, currentValue, currentUser.id);
    }

    const { data, error } = await updateExistingCandidateProfile({
      id: currentUser.id,
      profile_photo_url: null,
      avatar_url: null
    });

    if (error) throw error;

    currentProfile = {
      ...currentProfile,
      ...data,
      profile_photo_url: null,
      avatar_url: null
    };
    if (selectedPhotoPreviewUrl) {
      URL.revokeObjectURL(selectedPhotoPreviewUrl);
      selectedPhotoPreviewUrl = "";
    }
    getEl("profile_photo_preview").src = "https://placehold.co/180x180";
    updatePreview();
    showToast("Profile photo removed.");
  } catch (error) {
    showToast("Could not remove profile photo. Please try again.");
  } finally {
    isDeletingPhoto = false;
    if (removePhotoBtn) {
      removePhotoBtn.disabled = false;
      removePhotoBtn.textContent = "Remove Photo";
    }
    if (uploadPhotoBtn) uploadPhotoBtn.disabled = false;
  }
}

async function loadHeaderCounts(userId) {
  const [{ count: unreadCount }, { count: notificationCount }] = await Promise.all([
    candidateSupabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", userId)
      .eq("sender_type", "employer")
      .eq("read_by_candidate", false),
    candidateSupabase
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", userId)
      .in("status", ["reviewing", "interview", "offer"])
  ]);

  updateBadge("topUnreadBadge", unreadCount || 0);
  updateBadge("topNotificationBadge", notificationCount || 0);
}

function hydrateHeader() {
  const fullName = currentProfile.full_name || "Candidate";
  const firstName = fullName.split(" ")[0] || "Candidate";
  const email = currentProfile.email || currentUser?.email || "No email on file";

  setText("topCandidateName", firstName);
  setText("accountMenuCandidateName", fullName);
  setText("accountMenuEmail", email);

  const avatar = getEl("topCandidateAvatar");
  if (!avatar) return;

  const initials = getInitials(fullName || email);
  const photoUrl = selectedPhotoPreviewUrl || getCandidatePhotoUrl(currentProfile.profile_photo_url || currentProfile.avatar_url) || "";
  avatar.innerHTML = photoUrl
    ? `<img src="${escapeAttribute(photoUrl)}" alt="" loading="lazy" /><span class="avatar-fallback">${escapeHTML(initials)}</span>`
    : escapeHTML(initials);
}

function bindAccountMenu() {
  const button = getEl("candidateAccountButton");
  const menu = getEl("candidateAccountMenu");
  if (!button || !menu) return;

  const closeMenu = ({ restoreFocus = false } = {}) => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus) button.focus();
  };

  const openMenu = () => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    menu.querySelector("[role='menuitem']")?.focus();
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("click", (event) => {
    if (!menu.hidden && !event.target.closest(".top-account-menu-wrap")) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) closeMenu({ restoreFocus: true });
  });
}

function bindMobileSidebar() {
  const toggle = getEl("sidebarToggle");
  const backdrop = getEl("sidebarBackdrop");
  if (!toggle || !backdrop) return;

  const setSidebarOpen = (isOpen) => {
    document.body.classList.toggle("sidebar-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    backdrop.hidden = !isOpen;
  };

  toggle.addEventListener("click", () => setSidebarOpen(!document.body.classList.contains("sidebar-open")));
  backdrop.addEventListener("click", () => setSidebarOpen(false));

  document.querySelectorAll(".candidate-nav-link").forEach((link) => {
    link.addEventListener("click", () => setSidebarOpen(false));
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) setSidebarOpen(false);
  });
}

function bindHeaderSearch() {
  if (!profileSearchForm || !profileSearchInput) return;

  profileSearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = profileSearchInput.value.trim();
    const url = new URL("../public/find-jobs.html?role=candidate", window.location.href);
    if (query) url.searchParams.set("keyword", query);
    window.location.href = url.toString();
  });
}

function updateBadge(id, value) {
  const badge = getEl(id);
  if (!badge) return;

  const count = Number(value) || 0;
  badge.hidden = count <= 0;
  badge.textContent = count > 9 ? "9+" : String(count);
}

function setText(id, text) {
  const element = getEl(id);
  if (element) element.textContent = text || "";
}

function getInitials(value) {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return "PT";
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

async function handleLogout() {
  try {
    await window.PlacelyAuth.clearAuthState();
  } catch {
    sessionStorage.removeItem("placelyAuthGuardRedirecting");
  }

  window.location.replace("candidate-login.html");
}

function revealProfile() {
  document.documentElement.classList.remove("profile-booting");
}

document.addEventListener("DOMContentLoaded", async () => {
  setupEvents();
  try {
    await loadCandidateProfile();
  } catch (error) {
    showToast(getFriendlyProfileError(error, "Could not load profile."));
  } finally {
    revealProfile();
  }
});
