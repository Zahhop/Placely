const employerSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const form = document.getElementById("employerProfileForm");
const logoutBtn = document.getElementById("logoutBtn");
const toast = document.getElementById("toast");

const companyNameInput = document.getElementById("company_name");
const industryInput = document.getElementById("industry");
const locationInput = document.getElementById("company_location");
const employmentInput = document.getElementById("employment_type");
const payInput = document.getElementById("pay_range");
const timelineInput = document.getElementById("hiring_timeline");

const uploadLogoBtn = document.getElementById("uploadLogoBtn");
const logoFileInput = document.getElementById("company_logo_file");
const logoPreview = document.getElementById("company_logo_preview");
const logoFrame = document.querySelector(".logo-frame");
const previewLogoImg = document.getElementById("previewLogoImg");
const previewLogoBox = document.querySelector(".preview-avatar");
const sectionButtons = document.querySelectorAll("[data-section-target]");
const profileSections = document.querySelectorAll(".profile-section");
const scoreList = document.getElementById("scoreList");

const PHOTO_BUCKET = "employer-logos";

let currentLogoUrl = "";
let isLogoUploading = false;

document.addEventListener("DOMContentLoaded", () => {
  setupSectionNavigation();
  loadEmployerProfile();
  setupLivePreview();
  setupLogoUpload();
  setupLogout();
});

async function loadEmployerProfile() {
  const user = await verifyEmployerAccess(employerSupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });

  if (!user) return;

  const { data: profile, error } = await employerSupabase
    .from("employer_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Error loading profile:", error);
    showToast("Could not load profile.");
    return;
  }

  if (!profile) {
    updatePreview();
    updateStrength();
    return;
  }

  setValue("company_name", profile.company_name);
  setValue("industry", profile.industry);
  setValue("company_email", profile.company_email || user.email);
  setValue("contact_name", profile.contact_name);
  setValue("phone", profile.phone);
  setValue("company_website", profile.company_website);
  setValue("company_location", profile.company_location);
  setValue("company_description", profile.company_description);
  setValue("main_hiring_industry", profile.main_hiring_industry);
  setValue("employment_type", profile.employment_type);
  setValue("pay_range", profile.pay_range);
  setValue("hiring_timeline", profile.hiring_timeline);
  setValue("candidate_qualities", profile.candidate_qualities);
  setValue("hiring_needs", profile.hiring_needs);

  currentLogoUrl = profile.company_logo_url || "";

  if (currentLogoUrl) {
    setLogoImage(currentLogoUrl);
  } else {
    clearLogoImage();
  }

  updatePreview();
  updateStrength();
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isLogoUploading) {
      showToast("Logo is still uploading. Please wait a second.");
      return;
    }

    const {
      data: { user },
      error: userError
    } = await employerSupabase.auth.getUser();

    if (userError || !user) {
      window.location.href = "employer-login.html";
      return;
    }

    const updates = {
      id: user.id,
      company_name: getValue("company_name"),
      industry: getValue("industry"),
      main_hiring_industry: getValue("main_hiring_industry"),
      company_email: getValue("company_email"),
      contact_name: getValue("contact_name"),
      phone: getValue("phone"),
      company_website: getValue("company_website"),
      company_location: getValue("company_location"),
      company_description: getValue("company_description"),
      employment_type: getValue("employment_type"),
      pay_range: getValue("pay_range"),
      hiring_timeline: getValue("hiring_timeline"),
      candidate_qualities: getValue("candidate_qualities"),
      hiring_needs: getValue("hiring_needs"),
      company_logo_url: currentLogoUrl
    };

    const { error } = await employerSupabase
      .from("employer_profiles")
      .upsert(updates, { onConflict: "id" });

    if (error) {
      console.error("Save error:", error);
      showToast("Error saving profile.");
      return;
    }

    showToast("Company profile saved.");
    updatePreview();
    updateStrength();
  });
}

function setupLogoUpload() {
  if (!uploadLogoBtn || !logoFileInput) return;

  uploadLogoBtn.addEventListener("click", () => {
    logoFileInput.click();
  });

  logoFileInput.addEventListener("change", async () => {
    const file = logoFileInput.files[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("Please upload an image file.");
      logoFileInput.value = "";
      return;
    }

    const {
      data: { user },
      error: userError
    } = await employerSupabase.auth.getUser();

    if (userError || !user) {
      window.location.href = "employer-login.html";
      return;
    }

    try {
      isLogoUploading = true;

      const previewUrl = URL.createObjectURL(file);
      setLogoImage(previewUrl);
      updateStrength();

      showToast("Uploading company logo...");

      const logoUrl = await uploadCompanyLogo(user.id, file);

      currentLogoUrl = logoUrl;
      setLogoImage(logoUrl);
      updateStrength();

      showToast("Logo uploaded. Click Save Changes to finish.");
    } catch (error) {
      console.error("Logo upload failed:", error);
      showToast(error?.message || "Logo upload failed.");

      if (currentLogoUrl) {
        setLogoImage(currentLogoUrl);
      } else {
        clearLogoImage();
      }
    } finally {
      isLogoUploading = false;
      logoFileInput.value = "";
    }
  });
}

async function uploadCompanyLogo(userId, file) {
  if (!file) {
    throw new Error("No logo file selected.");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Please upload an image file.");
  }

  const safeName = file.name
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]/g, "-")
    .replace(/-+/g, "-");

  const filePath = `${userId}/${Date.now()}-${safeName}`;

  console.log("Uploading logo:", {
    bucket: PHOTO_BUCKET,
    path: filePath,
    fileType: file.type,
    fileSize: file.size
  });

  const { data: uploadData, error: uploadError } = await employerSupabase.storage
    .from(PHOTO_BUCKET)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });

  console.log("Upload data:", uploadData);
  console.log("Upload error:", uploadError);

  if (uploadError) {
    throw new Error(uploadError.message || "Storage upload failed.");
  }

  const { data: publicData } = employerSupabase.storage
    .from(PHOTO_BUCKET)
    .getPublicUrl(filePath);

  if (!publicData || !publicData.publicUrl) {
    throw new Error("Could not get public logo URL.");
  }

  return publicData.publicUrl;
}

function setLogoImage(url) {
  if (!url || url.includes("placehold.co")) {
    clearLogoImage();
    return;
  }

  if (logoPreview && logoFrame) {
    logoPreview.onload = () => {
      logoFrame.classList.add("has-image");
    };

    logoPreview.onerror = () => {
      clearLogoImage();
    };

    logoPreview.src = url;
  }

  if (previewLogoImg && previewLogoBox) {
    previewLogoImg.onload = () => {
      previewLogoBox.classList.add("has-image");
    };

    previewLogoImg.onerror = () => {
      previewLogoBox.classList.remove("has-image");
    };

    previewLogoImg.src = url;
  }
}

function clearLogoImage() {
  if (logoPreview) logoPreview.removeAttribute("src");
  if (previewLogoImg) previewLogoImg.removeAttribute("src");

  if (logoFrame) logoFrame.classList.remove("has-image");
  if (previewLogoBox) previewLogoBox.classList.remove("has-image");
}

function setupLivePreview() {
  [
    companyNameInput,
    industryInput,
    locationInput,
    employmentInput,
    payInput,
    timelineInput
  ].forEach((input) => {
    if (!input) return;

    input.addEventListener("input", updatePreview);
    input.addEventListener("change", updatePreview);
  });

  document.querySelectorAll("input, textarea, select").forEach((input) => {
    input.addEventListener("input", updateStrength);
    input.addEventListener("change", updateStrength);
  });
}

function updatePreview() {
  const company = getValue("company_name") || "Company Name";
  const industry = getValue("industry") || "Industry";
  const location = getValue("company_location") || "Location";

  setText("previewCompanyName", company);
  setText("previewCompanyMeta", `${industry} - ${location}`);
  setText("previewEmployment", getValue("employment_type") || "Employment Type");
  setText("previewPay", getValue("pay_range") || "Pay Range");
  setText("previewTimeline", getValue("hiring_timeline") || "Hiring Timeline");

  const initials = getInitials(company);

  setText("companyLogo", initials);
  setText("previewLogo", initials);
}

function updateStrength() {
  const fields = [
    "company_name",
    "industry",
    "company_email",
    "phone",
    "contact_name",
    "company_website",
    "company_location",
    "company_description",
    "main_hiring_industry",
    "employment_type",
    "pay_range",
    "hiring_timeline",
    "candidate_qualities",
    "hiring_needs"
  ];

  const filled = fields.filter((id) => getValue(id)).length;
  const hasLogo = Boolean(currentLogoUrl) || isLogoUploading;

  const total = fields.length + 1;
  const completed = filled + (hasLogo ? 1 : 0);
  const percent = Math.round((completed / total) * 100);

  setText("profileStrength", `${percent}%`);

  const strengthBar = document.getElementById("strengthBar");
  if (strengthBar) {
    strengthBar.style.width = `${percent}%`;
  }

  renderStrengthRecommendations(fields, hasLogo);
}

function setupSectionNavigation() {
  sectionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      showProfileSection(button.dataset.sectionTarget, {
        updateHash: true,
        focusPanel: button.closest(".sidebar-card") !== null
      });
    });
  });

  window.addEventListener("hashchange", () => {
    showProfileSection(getSectionFromHash(), { updateHash: false });
  });

  scoreList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-section-target]");
    if (!button) return;

    showProfileSection(button.dataset.sectionTarget, { updateHash: true, focusPanel: true });
  });

  showProfileSection(getSectionFromHash(), { updateHash: false });
}

function getSectionFromHash() {
  return getValidSectionId(window.location.hash.replace("#", "").trim());
}

function getValidSectionId(id) {
  return [...profileSections].some((section) => section.id === id) ? id : "overview";
}

function showProfileSection(sectionId, options = {}) {
  const nextId = getValidSectionId(sectionId);

  profileSections.forEach((section) => {
    const isActive = section.id === nextId;
    section.classList.toggle("active", isActive);
    section.classList.toggle("hidden", !isActive);
    section.hidden = !isActive;
  });

  document.querySelectorAll(".sidebar-card [data-section-target]").forEach((button) => {
    const isActive = button.dataset.sectionTarget === nextId;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  if (options.updateHash && window.location.hash !== `#${nextId}`) {
    window.history.pushState(null, "", `#${nextId}`);
  }

  if (options.focusPanel) {
    document.getElementById(nextId)?.querySelector("input, textarea, select, button")?.focus({ preventScroll: true });
  }
}

function renderStrengthRecommendations(fields, hasLogo) {
  if (!scoreList) return;

  const fieldSections = {
    company_name: ["Company name", "company-info"],
    industry: ["Industry focus", "company-info"],
    company_location: ["Company location", "company-info"],
    company_description: ["Company description", "company-info"],
    main_hiring_industry: ["Hiring industry", "hiring-section"],
    employment_type: ["Employment type", "hiring-section"],
    pay_range: ["Pay range", "hiring-section"],
    hiring_timeline: ["Hiring timeline", "hiring-section"],
    candidate_qualities: ["Candidate qualities", "candidate-section"],
    hiring_needs: ["Hiring needs", "hiring-section"],
    company_email: ["Company email", "contact-section"],
    phone: ["Phone number", "contact-section"],
    contact_name: ["Contact name", "contact-section"],
    company_website: ["Company website", "contact-section"]
  };

  const missing = fields.filter((id) => !getValue(id)).slice(0, 3);
  const logoItem = hasLogo
    ? `<button type="button" data-section-target="company-info"><span>Done</span> Company logo</button>`
    : `<button type="button" data-section-target="company-info"><span>Add</span> Company logo</button>`;

  scoreList.innerHTML = [
    logoItem,
    ...missing.map((id) => {
      const [label, section] = fieldSections[id] || [id, "company-info"];
      return `<button type="button" data-section-target="${section}"><span>Add</span> ${escapeHTML(label)}</button>`;
    })
  ].join("");
}

function setupLogout() {
  if (!logoutBtn) return;

  logoutBtn.addEventListener("click", async () => {
    await employerSupabase.auth.signOut();
    window.location.href = "employer-login.html";
  });
}

function setValue(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.value = value || "";
  }
}

function getValue(id) {
  const element = document.getElementById(id);

  return element ? element.value.trim() : "";
}

function setText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value || "";
  }
}

function getInitials(value) {
  return String(value || "PT")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function showToast(message) {
  if (!toast) {
    console.warn(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2400);
}
