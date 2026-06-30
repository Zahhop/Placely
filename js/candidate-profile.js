const candidateSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

let currentUser = null;
let currentProfile = {};
let removeResume = false;
let selectedPhotoPreviewUrl = "";

const PHOTO_BUCKET = "candidate_photos";
const RESUME_BUCKET = "candidate_resumes";

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
    resume_url: removeResume ? "" : currentProfile.resume_url || ""
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

  if (currentProfile.resume_url) {
    const fileName = currentProfile.resume_url.split("/").pop();

    getEl("resume_preview").style.display = "flex";
    getEl("resume_file_name").textContent = decodeURIComponent(fileName);
  }

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
    let resumeUrl = currentProfile.resume_url || null;

    const photoFile = getEl("profile_photo_file")?.files[0];
    const resumeFile = getEl("resume_file")?.files[0];

    if (photoFile) {
      profilePhotoUrl = await uploadFile(PHOTO_BUCKET, photoFile, currentUser.id);
    }

    if (resumeFile) {
      resumeUrl = await uploadFile(RESUME_BUCKET, resumeFile, currentUser.id);
    }

    if (removeResume) {
      resumeUrl = null;
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
      profile_photo_url: profilePhotoUrl,
      resume_url: resumeUrl
    };

    const { data, error } = await candidateSupabase
      .from("candidate_profiles")
      .upsert(updates)
      .select()
      .single();

    if (error) {
      throw error;
    }

    currentProfile = data;
    removeResume = false;
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
    resumeInput.addEventListener("change", () => {
      const file = resumeInput.files[0];

      if (!file) return;

      removeResume = false;
      getEl("resume_preview").style.display = "flex";
      getEl("resume_file_name").textContent = file.name;
      updateStrength();
    });
  }

  if (removeResumeBtn) {
    removeResumeBtn.addEventListener("click", () => {
      removeResume = true;
      resumeInput.value = "";
      getEl("resume_preview").style.display = "none";
      getEl("resume_file_name").textContent = "";
      updateStrength();
    });
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
