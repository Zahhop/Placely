const setupSupabase = window.employerSupabase;

const employerSetupForm = document.getElementById("employerSetupForm");
const setupMessage = document.getElementById("setupMessage");

const formSteps = document.querySelectorAll(".form-step");
const stepItems = document.querySelectorAll(".step-item");
const backBtn = document.getElementById("backBtn");
const nextBtn = document.getElementById("nextBtn");
const stepBadge = document.getElementById("stepBadge");
const progressFill = document.getElementById("progressFill");
const skipOptionalBtn = document.getElementById("skipOptionalBtn");
const hiringRolesGroup = document.getElementById("hiringRolesGroup");
const hiringRoleOther = document.getElementById("hiringRoleOther");
const compensationType = document.getElementById("compensationType");
const compensationMin = document.getElementById("compensationMin");
const compensationMax = document.getElementById("compensationMax");

let currentStep = 0;
let isSavingSetup = false;
let currentProfile = {};

document.addEventListener("DOMContentLoaded", initEmployerSetup);

async function initEmployerSetup() {
  const user = await protectSetupPage();
  if (!user) return;

  renderHiringRoleOptions();
  setupStepClicks();
  setupCompensationInputs();
  await loadExistingProfile(user.id);
  showStep(0);
}

async function protectSetupPage() {
  return verifyEmployerAccess(setupSupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html",
    requireOnboarding: false,
    requireIncompleteOnboarding: true
  });
}

function setupStepClicks() {
  stepItems.forEach((item) => {
    item.addEventListener("click", () => {
      currentStep = Number(item.dataset.stepIndicator);
      showStep(currentStep);
    });
  });

  skipOptionalBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    currentStep = formSteps.length - 1;
    showStep(currentStep);
  });
}

nextBtn.addEventListener("click", async () => {
  if (currentStep < formSteps.length - 1) {
    currentStep++;
    showStep(currentStep);
    return;
  }

  await saveEmployerSetup();
});

backBtn.addEventListener("click", () => {
  if (currentStep === 0) return;

  currentStep--;
  showStep(currentStep);
});

function showStep(index) {
  formSteps.forEach((step, i) => {
    step.classList.toggle("active", i === index);
  });

  stepItems.forEach((item, i) => {
    item.classList.toggle("active", i === index);
  });

  backBtn.style.visibility = index === 0 ? "hidden" : "visible";
  nextBtn.textContent = index === formSteps.length - 1
    ? "Finish Setup"
    : "Next";

  stepBadge.textContent = `Step ${index + 1} of ${formSteps.length}`;
  progressFill.style.width = `${((index + 1) / formSteps.length) * 100}%`;

  setupMessage.textContent = "";
}

async function saveEmployerSetup() {
  if (isSavingSetup) return;

  setupMessage.textContent = "Saving your employer profile...";

  const {
    data: { user },
    error: userError
  } = await setupSupabase.auth.getUser();

  if (userError || !user) {
    window.location.href = "employer-login.html";
    return;
  }

  const compensation = window.PlacelyAuth.buildCompensationPayload(
    compensationType.value,
    compensationMin?.value,
    compensationMax?.value
  );
  const updates = {
    id: user.id,
    company_website: document.getElementById("companyWebsite").value.trim(),
    company_location: document.getElementById("companyLocation").value.trim(),
    company_description: document.getElementById("companyDescription").value.trim(),
    main_hiring_industry: document.getElementById("mainHiringIndustry").value.trim(),
    employment_type: document.getElementById("employmentType").value,
    hiring_roles: getSelectedKnownHiringRoles(),
    hiring_role_other: getOtherHiringRole(),
    hiring_needs: getSelectedHiringRoles().join(", "),
    ...(compensation.payload || {
      compensation_type: compensationType.value,
      compensation_min: getNumberValue(compensationMin),
      compensation_max: getNumberValue(compensationMax),
      pay_range: window.PlacelyAuth.formatCompensation(compensationType.value, getNumberValue(compensationMin), getNumberValue(compensationMax))
    }),
    hiring_timeline: window.PlacelyAuth.normalizeHiringTimeline(document.getElementById("hiringTimeline").value),
    candidate_qualities: document.getElementById("candidateQualities").value.trim(),
    onboarding_completed: true,
    onboarding_completed_at: new Date().toISOString()
  };

  if (!validateRequiredSetupFields()) {
    return;
  }

  isSavingSetup = true;
  nextBtn.disabled = true;
  nextBtn.textContent = "Saving...";

  const { data: savedProfile, error } = await updateEmployerSetup(updates, user.id);

  if (error) {
    if (window.PlacelyAuth.isMissingRowError(error)) {
      await window.PlacelyAuth.clearAuthState();
      window.location.replace("employer-login.html");
      return;
    }

    setupMessage.textContent = "Could not save setup. Please check the required fields and try again.";
    isSavingSetup = false;
    nextBtn.disabled = false;
    nextBtn.textContent = "Finish Setup";
    return;
  }

  if (!window.PlacelyAuth.isEmployerOnboardingComplete(savedProfile)) {
    setupMessage.textContent = "Complete the required setup fields before opening the dashboard.";
    isSavingSetup = false;
    nextBtn.disabled = false;
    nextBtn.textContent = "Finish Setup";
    return;
  }

  setupMessage.textContent = "Setup complete. Redirecting...";
  window.location.replace("employer-dashboard.html");
}

async function updateEmployerSetup(updates, userId) {
  const selectColumns = "company_location, company_description, main_hiring_industry, employment_type, hiring_needs, hiring_roles, hiring_role_other, pay_range, compensation_type, compensation_min, compensation_max, hiring_timeline, candidate_qualities, onboarding_completed";
  const result = await setupSupabase
    .from("employer_profiles")
    .update(updates)
    .eq("id", userId)
    .select(selectColumns)
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

  return setupSupabase
    .from("employer_profiles")
    .update(compatibleUpdates)
    .eq("id", userId)
    .select("company_location, company_description, main_hiring_industry, employment_type, hiring_needs, pay_range, hiring_timeline, candidate_qualities")
    .single();
}

function isMissingColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "PGRST204" || message.includes("column") || message.includes("could not find");
}

function validateRequiredSetupFields() {
  const requiredFields = [
    ["companyLocation", "Company location is required."],
    ["companyDescription", "Company description is required."],
    ["mainHiringIndustry", "Main hiring industry is required."],
    ["employmentType", "Employment type is required."],
    ["hiringRolesGroup", "Select at least one hiring role."],
    ["compensationType", "Compensation type is required."],
    ["compensationMin", "Minimum compensation is required."],
    ["compensationMax", "Maximum compensation is required."],
    ["hiringTimeline", "Hiring timeline is required."],
    ["candidateQualities", "Ideal candidate qualities are required."]
  ];

  for (const [id, message] of requiredFields) {
    const field = document.getElementById(id);
    if (id === "hiringRolesGroup" && getSelectedHiringRoles().length) continue;
    if (id !== "hiringRolesGroup" && String(field?.value || "").trim()) continue;

    setupMessage.textContent = message;
    field?.focus();
    const step = field?.closest(".form-step");
    const index = [...formSteps].indexOf(step);
    if (index >= 0) {
      currentStep = index;
      showStep(currentStep);
      setupMessage.textContent = message;
    }
    return false;
  }

  const compensationError = validateCompensation();
  if (compensationError) {
    setupMessage.textContent = compensationError;
    currentStep = 2;
    showStep(currentStep);
    setupMessage.textContent = compensationError;
    return false;
  }

  return true;
}

function renderHiringRoleOptions() {
  if (!hiringRolesGroup) return;

  hiringRolesGroup.innerHTML = window.PlacelyAuth.hiringRoleOptions.map((role) => `
    <label class="role-chip">
      <input type="checkbox" value="${escapeAttribute(role)}">
      <span>${escapeHTML(role)}</span>
    </label>
  `).join("");

  hiringRolesGroup.addEventListener("change", () => {
    syncOtherRoleVisibility();
  });
}

function setupCompensationInputs() {
  compensationType?.addEventListener("change", () => {
    const isAnnual = compensationType.value === "annual";
    if (compensationMin) compensationMin.placeholder = isAnnual ? "50000" : "20";
    if (compensationMax) compensationMax.placeholder = isAnnual ? "80000" : "40";
    validateCompensation();
  });

  [compensationMin, compensationMax].forEach((input) => {
    input?.addEventListener("input", () => {
      input.value = input.value.replace(/[^\d.]/g, "");
      validateCompensation();
    });
  });
}

async function loadExistingProfile(userId) {
  const { data } = await setupSupabase
    .from("employer_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (!data) return;
  currentProfile = data;

  setValue("companyWebsite", data.company_website);
  setValue("companyLocation", data.company_location);
  setValue("companyDescription", data.company_description);
  setValue("mainHiringIndustry", data.main_hiring_industry);
  setValue("employmentType", data.employment_type);
  setHiringRoles(window.PlacelyAuth.getEmployerHiringRoles(data), data.hiring_role_other);
  setValue("compensationType", data.compensation_type);
  setValue("compensationMin", data.compensation_min);
  setValue("compensationMax", data.compensation_max);
  setValue("hiringTimeline", window.PlacelyAuth.normalizeHiringTimeline(data.hiring_timeline));
  setValue("candidateQualities", data.candidate_qualities);
}

function getSelectedHiringRoles() {
  const selected = getSelectedKnownHiringRoles();
  const other = getOtherHiringRole();
  return other ? [...selected, other] : selected;
}

function getSelectedKnownHiringRoles() {
  const selected = [...hiringRolesGroup.querySelectorAll("input:checked")]
    .map((input) => input.value)
    .filter((role) => role !== "Other");
  return selected;
}

function getOtherHiringRole() {
  const hasOther = Boolean(hiringRolesGroup?.querySelector('input[value="Other"]')?.checked);
  return hasOther ? String(hiringRoleOther?.value || "").trim() : "";
}

function setHiringRoles(roles, otherValue = "") {
  const knownRoles = new Set(window.PlacelyAuth.hiringRoleOptions);
  const unknownRoles = (roles || []).filter((role) => !knownRoles.has(role));
  const resolvedOther = otherValue || unknownRoles.join(", ");
  const roleSet = new Set(roles || []);
  [...hiringRolesGroup.querySelectorAll("input")].forEach((input) => {
    input.checked = roleSet.has(input.value) || (input.value === "Other" && Boolean(resolvedOther));
  });

  if (hiringRoleOther) hiringRoleOther.value = resolvedOther;
  syncOtherRoleVisibility();
}

function syncOtherRoleVisibility() {
  const hasOther = Boolean(hiringRolesGroup?.querySelector('input[value="Other"]')?.checked);
  if (hiringRoleOther) hiringRoleOther.hidden = !hasOther;
}

function validateCompensation() {
  if (!compensationType.value && !compensationMin?.value && !compensationMax?.value) return "";
  const result = window.PlacelyAuth.validateCompensationValues(
    compensationType.value,
    compensationMin?.value,
    compensationMax?.value
  );
  return result.valid ? "" : result.message;
}

function getNumberValue(input) {
  const value = Number(input?.value);
  return Number.isFinite(value) && input?.value !== "" ? value : null;
}

function setValue(id, value) {
  const field = document.getElementById(id);
  if (field) field.value = value ?? "";
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
