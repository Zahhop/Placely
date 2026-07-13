const setupSupabase = window.employerSupabase;

if (!setupSupabase) {
  console.error("Employer Supabase client was not initialized.");
}

const employerSetupForm = document.getElementById("employerSetupForm");
const setupMessage = document.getElementById("setupMessage");

const formSteps = document.querySelectorAll(".form-step");
const stepItems = document.querySelectorAll(".step-item");
const backBtn = document.getElementById("backBtn");
const nextBtn = document.getElementById("nextBtn");
const stepBadge = document.getElementById("stepBadge");
const progressFill = document.getElementById("progressFill");

let currentStep = 0;

document.addEventListener("DOMContentLoaded", initEmployerSetup);

async function initEmployerSetup() {
  await protectSetupPage();
  setupStepClicks();
  showStep(0);
}

async function protectSetupPage() {
  const {
    data: { user },
    error
  } = await setupSupabase.auth.getUser();

  if (error || !user) {
    window.location.href = "employer-login.html";
  }
}

function setupStepClicks() {
  stepItems.forEach((item) => {
    item.addEventListener("click", () => {
      currentStep = Number(item.dataset.stepIndicator);
      showStep(currentStep);
    });
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
  setupMessage.textContent = "Saving your employer profile...";

  const {
    data: { user },
    error: userError
  } = await setupSupabase.auth.getUser();

  if (userError || !user) {
    window.location.href = "employer-login.html";
    return;
  }

  const updates = {
    id: user.id,
    company_website: document.getElementById("companyWebsite").value.trim(),
    company_location: document.getElementById("companyLocation").value.trim(),
    company_description: document.getElementById("companyDescription").value.trim(),
    main_hiring_industry: document.getElementById("mainHiringIndustry").value.trim(),
    employment_type: document.getElementById("employmentType").value,
    hiring_needs: document.getElementById("hiringNeeds").value.trim(),
    pay_range: document.getElementById("payRange").value.trim(),
    hiring_timeline: document.getElementById("hiringTimeline").value,
    candidate_qualities: document.getElementById("candidateQualities").value.trim()
  };

  const { error } = await setupSupabase
    .from("employer_profiles")
    .upsert(updates, { onConflict: "id" });

  if (error) {
    console.error("Employer setup error:", error);
    setupMessage.textContent = "Could not save setup. Check your Supabase policies.";
    return;
  }

  setupMessage.textContent = "Setup complete. Redirecting...";
  window.location.href = "employer-dashboard.html";
}