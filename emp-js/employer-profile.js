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

const PHOTO_BUCKET = "photos";

let currentLogoUrl = "";

document.addEventListener("DOMContentLoaded", () => {
  loadEmployerProfile();
  setupLivePreview();
  setupLogoUpload();
  setupLogout();
});

async function loadEmployerProfile() {
  const {
    data: { user },
    error: userError
  } = await employerSupabase.auth.getUser();

  if (userError || !user) {
    window.location.href = "employer-login.html";
    return;
  }

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

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const {
    data: { user },
    error: userError
  } = await employerSupabase.auth.getUser();

  if (userError || !user) {
    window.location.href = "employer-login.html";
    return;
  }

  let logoUrl = currentLogoUrl;

  if (logoFileInput.files.length) {
    try {
      showToast("Uploading company logo...");
      logoUrl = await uploadCompanyLogo(user.id);
      currentLogoUrl = logoUrl;
      setLogoImage(logoUrl);
    } catch (error) {
      console.error("Logo upload error:", error);
      showToast("Logo upload failed. Check your photos bucket policies.");
      return;
    }
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
    company_logo_url: logoUrl
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

function setupLogoUpload() {
  if (!uploadLogoBtn || !logoFileInput) return;

  uploadLogoBtn.addEventListener("click", () => {
    logoFileInput.click();
  });

  logoFileInput.addEventListener("change", () => {
    const file = logoFileInput.files[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("Please upload an image file.");
      logoFileInput.value = "";
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setLogoImage(previewUrl);
    updateStrength();
  });
}

async function uploadCompanyLogo(userId) {
  const file = logoFileInput.files[0];

  if (!file) return currentLogoUrl;

  const fileExt = file.name.split(".").pop().toLowerCase();
  const safeExt = fileExt || "png";
  const filePath = `employer-logos/${userId}/${Date.now()}.${safeExt}`;

  const { error: uploadError } = await employerSupabase.storage
    .from(PHOTO_BUCKET)
    .upload(filePath, file, {
      upsert: true,
      contentType: file.type
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data } = employerSupabase.storage
    .from(PHOTO_BUCKET)
    .getPublicUrl(filePath);

  if (!data || !data.publicUrl) {
    throw new Error("Could not get public logo URL.");
  }

  return data.publicUrl;
}

function setLogoImage(url) {
  if (!url || url.includes("placehold.co")) {
    clearLogoImage();
    return;
  }

  logoPreview.onload = () => {
    logoFrame.classList.add("has-image");
  };

  previewLogoImg.onload = () => {
    previewLogoBox.classList.add("has-image");
  };

  logoPreview.onerror = () => {
    clearLogoImage();
  };

  previewLogoImg.onerror = () => {
    previewLogoBox.classList.remove("has-image");
  };

  logoPreview.src = url;
  previewLogoImg.src = url;
}

function clearLogoImage() {
  logoPreview.removeAttribute("src");
  previewLogoImg.removeAttribute("src");

  logoFrame.classList.remove("has-image");
  previewLogoBox.classList.remove("has-image");
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

  document.getElementById("previewCompanyName").textContent = company;
  document.getElementById("previewCompanyMeta").textContent = `${industry} · ${location}`;
  document.getElementById("previewEmployment").textContent = getValue("employment_type") || "Employment Type";
  document.getElementById("previewPay").textContent = getValue("pay_range") || "Pay Range";
  document.getElementById("previewTimeline").textContent = getValue("hiring_timeline") || "Hiring Timeline";

  const initials = getInitials(company);

  document.getElementById("companyLogo").textContent = initials;
  document.getElementById("previewLogo").textContent = initials;
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
  const hasLogo = Boolean(currentLogoUrl) || Boolean(logoFileInput.files.length);
  const total = fields.length + 1;
  const completed = filled + (hasLogo ? 1 : 0);
  const percent = Math.round((completed / total) * 100);

  document.getElementById("profileStrength").textContent = `${percent}%`;
  document.getElementById("strengthBar").style.width = `${percent}%`;
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

function getInitials(value) {
  return String(value || "PT")
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function showToast(message) {
  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2400);
}