const placelySupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const jobForm = document.getElementById("jobForm");
const formMessage = document.getElementById("formMessage");
const logoutBtn = document.getElementById("logoutBtn");

function value(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function setMessage(message, type = "error") {
  if (!formMessage) {
    if (message) alert(message);
    return;
  }

  formMessage.textContent = message;
  formMessage.classList.toggle("success", type === "success");
}

function getFormFields() {
  return {
    job_title: value("jobTitle"),
    company_name: value("companyName"),
    location: value("location"),
    employment_type: value("employmentType"),
    pay_range: value("payRange"),
    experience_level: value("experienceLevel"),
    job_description: value("jobDescription"),
    required_skills: value("requiredSkills"),
    benefits: value("benefits"),
    status: value("jobStatus") || "active"
  };
}

jobForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");

  const { data: { user }, error: userError } =
    await placelySupabase.auth.getUser();

  if (userError || !user) {
    setMessage("Please log in before posting a job.");
    return;
  }

  const payload = getFormFields();

  if (!payload.job_title || !payload.location || !payload.job_description) {
    setMessage("Please fill out the job title, location, and job description.");
    return;
  }

  const submitBtn = jobForm.querySelector(".submit-btn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Posting...";
  }

  const { error } = await placelySupabase
    .from("jobs")
    .insert({
      employer_id: user.id,
      ...payload
    });

  if (error) {
    console.error("Job posting error:", {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code
    });

    setMessage("Could not post job. Check required fields and Supabase permissions.");

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Post Job";
    }

    return;
  }

  setMessage("Job posted successfully. Opening Manage Jobs...", "success");
  jobForm.reset();

  setTimeout(() => {
    window.location.href = "manage-jobs.html";
  }, 700);
});

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await placelySupabase.auth.signOut();
    window.location.href = "employer-login.html";
  });
}
