const candidateSupabase = window.PlacelyAuth.client();

let currentUser = null;
let currentProfile = {};
let selectedPhotoPreviewUrl = "";
let isDeletingResume = false;
let isUploadingResume = false;
let isDeletingPhoto = false;

const PHOTO_BUCKET = "candidate_photos";
const RESUME_BUCKET = "candidate_resumes";
const MAX_RESUME_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_RESUME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);
const RESUME_SIGNED_URL_SECONDS = 10 * 60;

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

  if (number) number.textContent = `${score}%`;
  if (bar) bar.style.width = `${score}%`;
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
}

function getPreviewProfileFromForm() {
  return {
    ...currentProfile,
    full_name: value("full_name") || currentProfile.full_name || "Candidate Name",
    trade: value("trade") || currentProfile.trade || "",
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
    resume_url: ""
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

  getEl("profile_photo_preview").src =
    getCandidatePhotoUrl(currentProfile.profile_photo_url || currentProfile.avatar_url) ||
    "https://placehold.co/180x180";

  renderResumeManager();

  getEl("full_name").value = currentProfile.full_name || "";
  getEl("trade").value = currentProfile.trade || "";
  getEl("location").value = currentProfile.location || "";
  getEl("bio").value = currentProfile.bio || "";
  getEl("experience").value = currentProfile.experience || "";
  getEl("skills").value = currentProfile.skills || "";
  getEl("certifications").value = currentProfile.certifications || "";
  getEl("availability").value = currentProfile.availability || "";
  getEl("email").value = currentProfile.email || user.email || "";
  getEl("phone").value = currentProfile.phone || "";
  getEl("contact_method").value = currentProfile.contact_method || "Email";
  getEl("shown_contact_method").value = window.PlacelyAuth.normalizeCandidateContactPreference(currentProfile.shown_contact_method) || "email";
  getEl("profile_visible").checked = currentProfile.profile_visible ?? true;

  updatePreview();
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
      trade: value("trade"),
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
      btn.textContent = "Save Profile";
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

  getEl("viewPreviewBtn")?.addEventListener("click", () => {
    window.CandidateProfilePreview?.openModal(getPreviewProfileFromForm());
  });

  document.querySelectorAll("input, textarea, select").forEach(input => {
    input.addEventListener("input", updatePreview);
    input.addEventListener("change", updatePreview);
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

document.addEventListener("DOMContentLoaded", async () => {
  setupEvents();
  await loadCandidateProfile();
});
