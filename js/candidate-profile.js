const candidateSupabase = window.PlacelyAuth.client();

let currentUser = null;
let currentProfile = {};
let selectedPhotoPreviewUrl = "";
let isDeletingResume = false;
let isUploadingResume = false;

const PHOTO_BUCKET = "candidate_photos";
const RESUME_BUCKET = "candidate_resumes";
const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_RESUME_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
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
    currentProfile.profile_photo_url ||
    currentProfile.avatar_url ||
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
    profile_photo_url:
      selectedPhotoPreviewUrl ||
      currentProfile.profile_photo_url ||
      currentProfile.avatar_url ||
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

  if (error) {
    console.error("Error loading candidate profile:", error);
    currentProfile = {
      id: user.id,
      email: user.email,
      profile_visible: true
    };
  } else {
    currentProfile = profile;
  }

  console.log("Loaded candidate profile:", currentProfile);
  console.log("Loaded availability:", currentProfile.availability);

  getEl("profile_photo_preview").src =
    currentProfile.profile_photo_url ||
    currentProfile.avatar_url ||
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
  getEl("profile_visible").checked = currentProfile.profile_visible ?? true;

  updatePreview();
}

async function uploadFile(bucket, file, userId) {
  validateUploadFile(bucket, file);

  const cleanName = file.name.replace(/\s+/g, "-").toLowerCase();
  const path = `${userId}/${Date.now()}-${cleanName}`;

  const { error } = await candidateSupabase.storage
    .from(bucket)
    .upload(path, file, { upsert: true });

  if (error) {
    throw error;
  }

  const { data } = candidateSupabase.storage
    .from(bucket)
    .getPublicUrl(path);

  return data.publicUrl;
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
  console.log("Uploaded resume path:", path);
  return path;
}

function validateUploadFile(bucket, file) {
  if (!file) return;

  if (bucket === PHOTO_BUCKET) {
    if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
      throw new Error("Profile photo must be PNG, JPG, or WEBP.");
    }

    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      throw new Error("Profile photo must be 5 MB or smaller.");
    }
  }

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

  console.log("Stored candidate resume_path:", profile.resume_path || null);
  console.log("Resolved candidate resume path:", resumePath || null);

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
    console.warn("Could not remove previous resume object:", error);
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
    console.log("Deleting resume path:", resumePath);

    if (!resumePath) {
      throw new Error("No stored resume path was found. The resume could not be deleted.");
    }

    if (!isOwnResumePath(resumePath, user.id)) {
      throw new Error("Stored resume path does not belong to the signed-in candidate.");
    }

    const { data, error } = await supabaseClient.storage
      .from("candidate_resumes")
      .remove([resumePath]);

    console.log("Resume delete result:", data);
    if (error) {
      console.error("Resume delete error:", error);
    }

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
    console.error("Resume delete flow error:", error);
    showToast("Error removing resume: " + (error?.message || "Unknown error"));
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
    console.error("Resume upload error:", error);
    if (resumeInput) resumeInput.value = "";
    renderResumeManager();
    showToast("Error uploading resume: " + (error?.message || "Unknown error"));
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
    console.error("Resume signed URL error:", error);
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

    const photoFile = getEl("profile_photo_file")?.files[0];

    if (photoFile) {
      profilePhotoUrl = await uploadFile(PHOTO_BUCKET, photoFile, currentUser.id);
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
      profile_visible: getEl("profile_visible").checked,
      profile_photo_url: profilePhotoUrl
    };

    const { data, error } = await candidateSupabase
      .from("candidate_profiles")
      .upsert(updates)
      .select()
      .single();

    if (error) {
      throw error;
    }

    currentProfile = {
      ...data,
      resume_path: currentProfile.resume_path || null,
      resume_url: currentProfile.resume_url || null
    };

    selectedPhotoPreviewUrl = "";

    showToast("Profile saved successfully.");
    updatePreview();
  } catch (error) {
    console.error("Save error:", error);
    showToast("Error saving profile: " + error.message);
  } finally {
    saveButtons.forEach(btn => {
      btn.disabled = false;
      btn.textContent = "Save Profile";
    });
  }
}

function setupEvents() {
  const uploadPhotoBtn = getEl("uploadPhotoBtn");
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
    photoInput.addEventListener("change", () => {
      const file = photoInput.files[0];

      if (!file) return;

      selectedPhotoPreviewUrl = URL.createObjectURL(file);
      getEl("profile_photo_preview").src = selectedPhotoPreviewUrl;
      updateStrength();
      updatePreview();
    });
  }

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

document.addEventListener("DOMContentLoaded", async () => {
  setupEvents();
  await loadCandidateProfile();
});
