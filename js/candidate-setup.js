const placelySupabase = window.PlacelyAuth.client();

const steps = document.querySelectorAll(".form-step");
const sidebarSteps = document.querySelectorAll(".step-item");
const backBtn = document.getElementById("backBtn");
const nextBtn = document.getElementById("nextBtn");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const skipOptionalBtn = document.getElementById("skipOptionalBtn");

let currentStep = 0;
let currentUser = null;
const MAX_RESUME_SIZE_BYTES = 10 * 1024 * 1024;

document.addEventListener("DOMContentLoaded", initCandidateSetup);

async function initCandidateSetup() {
  currentUser = await verifyCandidateAccess(placelySupabase, {
    loginPath: "candidate-login.html",
    employerDashboardPath: "../employers/employer-dashboard.html",
    requireOnboarding: false,
    requireIncompleteOnboarding: true
  });

  if (!currentUser) return;

  setupEvents();
  showStep(currentStep);
  await loadExistingProfile(currentUser);
}

function showStep(index) {
  steps.forEach((step, i) => {
    step.classList.toggle("active", i === index);
  });

  sidebarSteps.forEach((step, i) => {
    step.classList.toggle("active", i === index);
  });

  const progressPercent = ((index + 1) / steps.length) * 100;

  if (progressFill) {
    progressFill.style.width = `${progressPercent}%`;
  }

  if (progressText) {
    progressText.textContent = `Step ${index + 1} of ${steps.length}`;
  }

  backBtn.style.visibility = index === 0 ? "hidden" : "visible";
  nextBtn.textContent =
    index === steps.length - 1 ? "Finish & Go To Dashboard" : "Next";
}

function validateResumeFile(file) {
  if (!file) return true;

  const allowedTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ];

  return allowedTypes.includes(file.type) && file.size <= MAX_RESUME_SIZE_BYTES;
}

async function uploadCandidatePhoto(userId, file) {
  if (!file) return null;
  return window.PlacelyAuth.uploadOwnedImage(placelySupabase, "candidatePhoto", file, userId);
}

async function uploadResume(userId, file) {
  if (!file) return null;

  const fileExt = file.name.split(".").pop();
  const safeExt = String(fileExt || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
  const filePath = `${userId}/${Date.now()}.${safeExt || "pdf"}`;

  const { error: uploadError } = await placelySupabase.storage
    .from("candidate_resumes")
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });

  if (uploadError) {
    throw uploadError;
  }

  return filePath;
}

async function saveCandidateProfile() {
  const {
    data: { user },
    error: userError
  } = await placelySupabase.auth.getUser();

  if (userError || !user) {
    alert("You must be logged in to complete your profile.");
    return;
  }

  const resumeFile = document.getElementById("resume").files[0];
  const profilePhotoFile = document.getElementById("profilePhoto").files[0];

  if (!validateResumeFile(resumeFile)) {
    alert("Resume must be a PDF or DOCX file and 10 MB or smaller.");
    return;
  }

  if (!validateRequiredSetupFields()) {
    return;
  }

  nextBtn.disabled = true;
  nextBtn.textContent = "Saving...";

  try {
    await window.PlacelyAuth.validateImageFileForUpload(profilePhotoFile, "candidatePhoto");
    const resumePath = await uploadResume(user.id, resumeFile);
    const profilePhotoPath = await uploadCandidatePhoto(user.id, profilePhotoFile);

    const profileData = {
      id: user.id,
      email: user.email,

      trade: document.getElementById("trade").value,
      experience: document.getElementById("experience").value,
      bio: document.getElementById("bio").value.trim(),
      skills: document.getElementById("skills").value.trim(),
      certifications: document.getElementById("certifications").value.trim(),
      availability: document.getElementById("availability").value,
      contact_method: document.getElementById("contactMethod").value,
      shown_contact_method: window.PlacelyAuth.normalizeCandidateContactPreference(document.getElementById("shownContactMethod").value),
      profile_visible: document.getElementById("profileVisible").checked,
      onboarding_completed: true,
      onboarding_completed_at: new Date().toISOString()
    };

    if (resumePath) {
      profileData.resume_path = resumePath;
      profileData.resume_url = null;
    }

    if (profilePhotoPath) {
      profileData.profile_photo_url = profilePhotoPath;
    }

    const { error } = await updateCandidateProfile(profileData, user.id);

    if (error) {
      throw error;
    }

    const { data: savedProfile, error: savedProfileError } = await placelySupabase
      .from("candidate_profiles")
      .select("trade, experience, bio, availability, contact_method, shown_contact_method")
      .eq("id", user.id)
      .maybeSingle();

    if (savedProfileError || !window.PlacelyAuth.isCandidateOnboardingComplete(savedProfile)) {
      throw savedProfileError || new Error("Complete the required onboarding fields before opening the dashboard.");
    }

    window.location.replace("candidate-dashboard.html");
  } catch (error) {
    if (window.PlacelyAuth.isMissingRowError(error)) {
      await window.PlacelyAuth.clearAuthState();
      window.location.replace("candidate-login.html");
      return;
    }

    alert(error?.message || "We could not save your profile. Please check your information and try again.");
    nextBtn.disabled = false;
    nextBtn.textContent = "Finish & Go To Dashboard";
  }
}

async function updateCandidateProfile(profileData, userId) {
  const result = await placelySupabase
    .from("candidate_profiles")
    .update(profileData)
    .eq("id", userId)
    .select("trade, experience, bio, availability, contact_method, shown_contact_method")
    .single();

  if (!isMissingColumnError(result.error)) {
    return result;
  }

  const compatibleData = { ...profileData };
  delete compatibleData.onboarding_completed;
  delete compatibleData.onboarding_completed_at;

  return placelySupabase
    .from("candidate_profiles")
    .update(compatibleData)
    .eq("id", userId)
    .select("trade, experience, bio, availability, contact_method, shown_contact_method")
    .single();
}

function isMissingColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "PGRST204" || message.includes("column") && message.includes("onboarding");
}

function setupEvents() {
  nextBtn.addEventListener("click", async () => {
    if (currentStep < steps.length - 1) {
      currentStep++;
      showStep(currentStep);
    } else {
      await saveCandidateProfile();
    }
  });

  backBtn.addEventListener("click", () => {
    if (currentStep > 0) {
      currentStep--;
      showStep(currentStep);
    }
  });

  sidebarSteps.forEach((step, index) => {
    step.addEventListener("click", () => {
      currentStep = index;
      showStep(currentStep);
    });
  });

  skipOptionalBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    currentStep = steps.length - 1;
    showStep(currentStep);
  });
}

async function loadExistingProfile(user) {
  const { data, error } = await placelySupabase
    .from("candidate_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) return;

  document.getElementById("trade").value = data.trade || "";
  document.getElementById("experience").value = data.experience || "";
  document.getElementById("bio").value = data.bio || "";
  document.getElementById("skills").value = data.skills || "";
  document.getElementById("certifications").value = data.certifications || "";
  document.getElementById("availability").value = data.availability || "";
  document.getElementById("contactMethod").value = data.contact_method || "";
  document.getElementById("shownContactMethod").value = window.PlacelyAuth.normalizeCandidateContactPreference(data.shown_contact_method) || "";
  document.getElementById("profileVisible").checked = data.profile_visible !== false;
}

function validateRequiredSetupFields() {
  const requiredFields = [
    ["trade", "Primary profession is required."],
    ["experience", "Experience is required."],
    ["bio", "Professional summary is required."],
    ["availability", "Availability is required."],
    ["contactMethod", "Preferred contact method is required."],
    ["shownContactMethod", "Contact visibility is required."]
  ];

  for (const [id, message] of requiredFields) {
    const field = document.getElementById(id);
    if (String(field?.value || "").trim()) continue;

    alert(message);
    field?.focus();
    const step = field?.closest(".form-step");
    const index = [...steps].indexOf(step);
    if (index >= 0) {
      currentStep = index;
      showStep(currentStep);
    }
    return false;
  }

  return true;
}
