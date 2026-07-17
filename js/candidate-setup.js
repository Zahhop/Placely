const placelySupabase = window.PlacelyAuth.client();

const steps = document.querySelectorAll(".form-step");
const sidebarSteps = document.querySelectorAll(".step-item");
const backBtn = document.getElementById("backBtn");
const nextBtn = document.getElementById("nextBtn");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");

let currentStep = 0;
const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_RESUME_SIZE_BYTES = 10 * 1024 * 1024;

protectCandidateSetup();

async function protectCandidateSetup() {
  await verifyCandidateAccess(placelySupabase, {
    loginPath: "candidate-login.html",
    employerDashboardPath: "../employers/employer-dashboard.html"
  });
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

function validatePhotoFile(file) {
  if (!file) return true;

  const allowedTypes = ["image/png", "image/jpeg"];

  return allowedTypes.includes(file.type) && file.size <= MAX_PHOTO_SIZE_BYTES;
}

async function uploadFile(bucketName, userId, file) {
  if (!file) return null;

  const fileExt = file.name.split(".").pop();
  const filePath = `${userId}/${Date.now()}.${fileExt}`;

  const { error: uploadError } = await placelySupabase.storage
    .from(bucketName)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: true
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data } = placelySupabase.storage
    .from(bucketName)
    .getPublicUrl(filePath);

  return data.publicUrl;
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

  if (!validatePhotoFile(profilePhotoFile)) {
    alert("Profile photo must be PNG, JPG, or JPEG and 5 MB or smaller.");
    return;
  }

  nextBtn.disabled = true;
  nextBtn.textContent = "Saving...";

  try {
    const resumePath = await uploadResume(user.id, resumeFile);
    const profilePhotoUrl = await uploadFile("candidate_photos", user.id, profilePhotoFile);

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
      shown_contact_method: document.getElementById("shownContactMethod").value,
      profile_visible: document.getElementById("profileVisible").checked
    };

    if (resumePath) {
      profileData.resume_path = resumePath;
      profileData.resume_url = null;
    }

    if (profilePhotoUrl) {
      profileData.profile_photo_url = profilePhotoUrl;
    }

    console.log("Profile data being saved:", profileData);

    const { error } = await placelySupabase
      .from("candidate_profiles")
      .upsert(profileData);

    if (error) {
      throw error;
    }

    window.location.href = "candidate-dashboard.html";
  } catch (error) {
    console.error("Candidate profile save failed:", error);
    alert("Profile save failed: " + error.message);
    nextBtn.disabled = false;
    nextBtn.textContent = "Finish & Go To Dashboard";
  }
}

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

async function loadExistingProfile() {
  const user = await verifyCandidateAccess(placelySupabase, {
    loginPath: "candidate-login.html",
    employerDashboardPath: "../employers/employer-dashboard.html"
  });

  if (!user) return;

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
  document.getElementById("shownContactMethod").value = data.shown_contact_method || "";
  document.getElementById("profileVisible").checked = data.profile_visible !== false;
}

showStep(currentStep);
loadExistingProfile();
