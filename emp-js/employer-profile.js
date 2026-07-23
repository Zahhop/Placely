const employerSupabase = window.employerSupabase;

const form = document.getElementById("employerProfileForm");
const logoutBtn = document.getElementById("logoutBtn");
const toast = document.getElementById("toast");

const companyNameInput = document.getElementById("company_name");
const industryInput = document.getElementById("industry");
const locationInput = document.getElementById("company_location");
const employmentInput = document.getElementById("employment_type");
const compensationTypeInput = document.getElementById("compensation_type");
const compensationMinInput = document.getElementById("compensation_min");
const compensationMaxInput = document.getElementById("compensation_max");
const timelineInput = document.getElementById("hiring_timeline");
const hiringRolesGroup = document.getElementById("hiring_roles_group");
const hiringRoleOtherInput = document.getElementById("hiring_role_other");

const uploadLogoBtn = document.getElementById("uploadLogoBtn");
const removeLogoBtn = document.getElementById("removeLogoBtn");
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
let isProfileSaving = false;
let currentUser = null;
let currentProfile = {};

document.addEventListener("DOMContentLoaded", () => {
  renderHiringRoleOptions();
  setupSectionNavigation();
  loadEmployerProfile();
  setupLivePreview();
  setupStructuredFieldEvents();
  setupLogoUpload();
  setupLogout();
});

async function loadEmployerProfile() {
  const user = await verifyEmployerAccess(employerSupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });

  if (!user) return;
  currentUser = user;

  const { data: profile, error } = await employerSupabase
    .from("employer_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile) {
    await window.PlacelyAuth.clearAuthState();
    window.location.replace("employer-login.html");
    return;
  }

  currentProfile = profile;

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
  setValue("compensation_type", profile.compensation_type);
  setValue("compensation_min", profile.compensation_min);
  setValue("compensation_max", profile.compensation_max);
  setValue("hiring_timeline", window.PlacelyAuth.normalizeHiringTimeline(profile.hiring_timeline));
  setValue("candidate_qualities", profile.candidate_qualities);
  setHiringRoles(window.PlacelyAuth.getEmployerHiringRoles(profile), profile.hiring_role_other);

  currentLogoUrl = profile.company_logo_url || "";

  if (currentLogoUrl) {
    setLogoImage(getEmployerLogoUrl(currentLogoUrl));
  } else {
    clearLogoImage();
  }

  updatePreview();
  updateStrength();
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isProfileSaving) return;

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

    const compensation = window.PlacelyAuth.buildCompensationPayload(
      getValue("compensation_type"),
      compensationMinInput?.value,
      compensationMaxInput?.value
    );
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
      hiring_roles: getSelectedKnownHiringRoles(),
      hiring_role_other: getOtherHiringRole(),
      hiring_needs: getSelectedHiringRoles().join(", "),
      ...(compensation.payload || {
        compensation_type: getValue("compensation_type"),
        compensation_min: getNumberValue(compensationMinInput),
        compensation_max: getNumberValue(compensationMaxInput),
        pay_range: window.PlacelyAuth.formatCompensation(getValue("compensation_type"), getNumberValue(compensationMinInput), getNumberValue(compensationMaxInput))
      }),
      hiring_timeline: window.PlacelyAuth.normalizeHiringTimeline(getValue("hiring_timeline")),
      candidate_qualities: getValue("candidate_qualities"),
      company_logo_url: currentLogoUrl
    };

    const compensationError = validateCompensation();
    if (compensationError) {
      showToast(compensationError);
      return;
    }

    const willBeComplete = window.PlacelyAuth.isEmployerOnboardingComplete({
      ...updates,
      onboarding_completed: true
    });

    updates.onboarding_completed = willBeComplete;
    updates.onboarding_completed_at = willBeComplete ? new Date().toISOString() : null;

    isProfileSaving = true;
    const saveBtn = form.querySelector("[type='submit']");
    const originalText = saveBtn?.textContent || "Save Changes";
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
    }

    const { error } = await updateExistingEmployerProfile(updates, user.id);

    if (error) {
      if (window.PlacelyAuth.isMissingRowError(error)) {
        await window.PlacelyAuth.clearAuthState();
        window.location.replace("employer-login.html");
        return;
      }

      showToast("Could not save profile.");
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
      }
      isProfileSaving = false;
      return;
    }

    showToast("Company profile saved.");
    currentProfile = {
      ...currentProfile,
      ...updates
    };
    updatePreview();
    updateStrength();
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText;
    }
    isProfileSaving = false;
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
      uploadLogoBtn.disabled = true;
      uploadLogoBtn.textContent = "Uploading...";

      await window.PlacelyAuth.validateImageFileForUpload(file, "employerLogo");
      const previewUrl = URL.createObjectURL(file);
      setLogoImage(previewUrl);
      updateStrength();

      showToast("Uploading company logo...");

      const previousLogoValue = currentLogoUrl;
      const logoPath = await uploadCompanyLogo(user.id, file);
      const { error: profileError } = await updateExistingEmployerProfile({ company_logo_url: logoPath }, user.id);

      if (profileError) {
        await removeLogoObject(logoPath, user.id);
        throw new Error("Logo uploaded, but we could not save it to your profile.");
      }

      currentLogoUrl = logoPath;
      currentProfile = {
        ...currentProfile,
        company_logo_url: logoPath
      };
      setLogoImage(getEmployerLogoUrl(logoPath, Date.now()));
      updateStrength();
      if (previousLogoValue && previousLogoValue !== logoPath) {
        try {
          await removeLogoObject(previousLogoValue, user.id);
        } catch {}
      }

      showToast("Logo uploaded. Click Save Changes to finish.");
    } catch (error) {
      showToast(error?.message || "Logo upload failed.");

      if (currentLogoUrl) {
        setLogoImage(getEmployerLogoUrl(currentLogoUrl));
      } else {
        clearLogoImage();
      }
    } finally {
      isLogoUploading = false;
      uploadLogoBtn.disabled = false;
      uploadLogoBtn.textContent = "Upload Logo";
      logoFileInput.value = "";
    }
  });

  removeLogoBtn?.addEventListener("click", removeCurrentLogo);
}

async function uploadCompanyLogo(userId, file) {
  if (!file) {
    throw new Error("No logo file selected.");
  }

  return window.PlacelyAuth.uploadOwnedImage(employerSupabase, "employerLogo", file, userId);
}

async function removeCurrentLogo() {
  if (!currentUser || isLogoUploading || !currentLogoUrl) return;

  const previousLogoValue = currentLogoUrl;
  const wasOwned = window.PlacelyAuth.isOwnedStoragePath(previousLogoValue, PHOTO_BUCKET, currentUser.id);

  if (wasOwned) await removeLogoObject(previousLogoValue, currentUser.id);

  const { error } = await updateExistingEmployerProfile({ company_logo_url: null }, currentUser.id);
  if (error) {
    showToast("Could not remove logo. Please try again.");
    return;
  }

  currentLogoUrl = "";
  currentProfile = {
    ...currentProfile,
    company_logo_url: null
  };
  clearLogoImage();
  updateStrength();
  showToast("Logo removed.");
}

async function removeLogoObject(value, userId) {
  await window.PlacelyAuth.removeOwnedImage(employerSupabase, PHOTO_BUCKET, value, userId);
}

function getEmployerLogoUrl(value, cacheBust = "") {
  return window.PlacelyAuth.getPublicImageUrl(employerSupabase, PHOTO_BUCKET, value, { cacheBust });
}

async function updateExistingEmployerProfile(updates, userId) {
  const result = await employerSupabase
    .from("employer_profiles")
    .update(updates)
    .eq("id", userId)
    .select("id")
    .single();

  if (!isMissingColumnError(result.error)) return result;

  const compatibleUpdates = { ...updates };
  delete compatibleUpdates.onboarding_completed;
  delete compatibleUpdates.onboarding_completed_at;
  delete compatibleUpdates.hiring_roles;
  delete compatibleUpdates.hiring_role_other;
  delete compatibleUpdates.compensation_type;
  delete compatibleUpdates.compensation_min;
  delete compatibleUpdates.compensation_max;

  return employerSupabase
    .from("employer_profiles")
    .update(compatibleUpdates)
    .eq("id", userId)
    .select("id")
    .single();
}

function isMissingColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "PGRST204" || message.includes("column") || message.includes("could not find");
}

function renderHiringRoleOptions() {
  if (!hiringRolesGroup) return;

  hiringRolesGroup.innerHTML = window.PlacelyAuth.hiringRoleOptions.map((role) => `
    <label class="role-chip">
      <input type="checkbox" value="${escapeAttribute(role)}">
      <span>${escapeHTML(role)}</span>
    </label>
  `).join("");
}

function getSelectedHiringRoles() {
  if (!hiringRolesGroup) return [];

  const selected = getSelectedKnownHiringRoles();
  const other = getOtherHiringRole();
  return other ? [...selected, other] : selected;
}

function getSelectedKnownHiringRoles() {
  if (!hiringRolesGroup) return [];

  return [...hiringRolesGroup.querySelectorAll("input:checked")]
    .map((input) => input.value)
    .filter((role) => role !== "Other");
}

function getOtherHiringRole() {
  const hasOther = Boolean(hiringRolesGroup?.querySelector('input[value="Other"]')?.checked);
  return hasOther ? String(hiringRoleOtherInput?.value || "").trim() : "";
}

function setHiringRoles(roles, otherValue = "") {
  if (!hiringRolesGroup) return;

  const knownRoles = new Set(window.PlacelyAuth.hiringRoleOptions);
  const unknownRoles = (roles || []).filter((role) => !knownRoles.has(role));
  const resolvedOther = otherValue || unknownRoles.join(", ");
  const roleSet = new Set(roles || []);
  [...hiringRolesGroup.querySelectorAll("input")].forEach((input) => {
    input.checked = roleSet.has(input.value) || (input.value === "Other" && Boolean(resolvedOther));
  });

  if (hiringRoleOtherInput) hiringRoleOtherInput.value = resolvedOther;
  syncOtherRoleVisibility();
}

function syncOtherRoleVisibility() {
  const hasOther = Boolean(hiringRolesGroup?.querySelector('input[value="Other"]')?.checked);
  if (hiringRoleOtherInput) hiringRoleOtherInput.hidden = !hasOther;
}

function validateCompensation() {
  const type = getValue("compensation_type");

  if (!type && !compensationMinInput?.value && !compensationMaxInput?.value) return "";
  const result = window.PlacelyAuth.validateCompensationValues(
    type,
    compensationMinInput?.value,
    compensationMaxInput?.value
  );
  return result.valid ? "" : result.message;
}

function getNumberValue(input) {
  const value = Number(input?.value);
  return Number.isFinite(value) && input?.value !== "" ? value : null;
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
    compensationTypeInput,
    compensationMinInput,
    compensationMaxInput,
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

function setupStructuredFieldEvents() {
  hiringRolesGroup?.addEventListener("change", () => {
    syncOtherRoleVisibility();
    updateStrength();
  });

  compensationTypeInput?.addEventListener("change", () => {
    const isAnnual = compensationTypeInput.value === "annual";
    if (compensationMinInput) compensationMinInput.placeholder = isAnnual ? "50000" : "20";
    if (compensationMaxInput) compensationMaxInput.placeholder = isAnnual ? "80000" : "40";
    updatePreview();
    updateStrength();
  });

  [compensationMinInput, compensationMaxInput].forEach((input) => {
    input?.addEventListener("input", () => {
      input.value = input.value.replace(/[^\d.]/g, "");
      updatePreview();
      updateStrength();
    });
  });
}

function updatePreview() {
  const company = getValue("company_name") || "Company Name";
  const industry = getValue("industry") || "Industry";
  const location = getValue("company_location") || "Location";

  setText("previewCompanyName", company);
  setText("previewCompanyMeta", `${industry} - ${location}`);
  setText("previewEmployment", getValue("employment_type") || "Employment Type");
  setText("previewPay", window.PlacelyAuth.formatCompensation(getValue("compensation_type"), getNumberValue(compensationMinInput), getNumberValue(compensationMaxInput), currentProfile.pay_range) || "Pay Range");
  setText("previewTimeline", window.PlacelyAuth.getHiringTimelineLabel(getValue("hiring_timeline")) || "Hiring Timeline");

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
    "compensation_type",
    "compensation_min",
    "compensation_max",
    "hiring_timeline",
    "candidate_qualities"
  ];

  const filled = fields.filter((id) => getValue(id)).length + (getSelectedHiringRoles().length ? 1 : 0);
  const hasLogo = Boolean(currentLogoUrl) || isLogoUploading;

  const total = fields.length + 2;
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
    compensation_type: ["Compensation type", "hiring-section"],
    compensation_min: ["Minimum compensation", "hiring-section"],
    compensation_max: ["Maximum compensation", "hiring-section"],
    hiring_timeline: ["Hiring timeline", "hiring-section"],
    candidate_qualities: ["Candidate qualities", "candidate-section"],
    company_email: ["Company email", "contact-section"],
    phone: ["Phone number", "contact-section"],
    contact_name: ["Contact name", "contact-section"],
    company_website: ["Company website", "contact-section"]
  };

  const missing = [
    ...fields.filter((id) => !getValue(id)),
    !getSelectedHiringRoles().length ? "hiring_roles" : ""
  ].filter(Boolean).slice(0, 3);
  fieldSections.hiring_roles = ["Hiring roles", "hiring-section"];
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
    await window.PlacelyAuth.clearAuthState();
    window.location.replace("employer-login.html");
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

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHTML(value).replaceAll("`", "&#096;");
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
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2400);
}
