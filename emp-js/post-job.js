const placelySupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const jobForm = document.getElementById("jobForm");

function clean(value) {
  return value ? value.trim() : "";
}

function getFormFields() {
  const controls = Array.from(jobForm.querySelectorAll("input, select, textarea"));

  return {
    job_title: clean(controls[0]?.value),
    company_name: clean(controls[1]?.value),
    location: clean(controls[2]?.value),
    employment_type: clean(controls[3]?.value),
    pay_range: clean(controls[4]?.value),
    experience_level: clean(controls[5]?.value),
    job_description: clean(controls[6]?.value),
    required_skills: clean(controls[7]?.value),
    benefits: clean(controls[8]?.value)
  };
}

jobForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const { data: { user }, error: userError } =
    await placelySupabase.auth.getUser();

  if (userError || !user) {
    alert("Please log in first.");
    return;
  }

  const {
    job_title,
    company_name,
    location,
    employment_type,
    pay_range,
    experience_level,
    job_description,
    required_skills,
    benefits
  } = getFormFields();

  console.log("Posting job with:", {
    job_title,
    company_name,
    location,
    employment_type,
    pay_range,
    experience_level,
    job_description,
    required_skills,
    benefits
  });

  if (!job_title || !location || !job_description) {
    alert("Please fill out the job title, location, and job description.");
    return;
  }

  const { error } = await placelySupabase
    .from("jobs")
    .insert({
      employer_id: user.id,
      job_title,
      company_name,
      location,
      employment_type,
      pay_range,
      experience_level,
      job_description,
      required_skills,
      benefits,
      status: "active"
    });

  if (error) {
    console.error("Job posting error:", error);
    alert("Error posting job: " + error.message);
    return;
  }

  alert("Job posted successfully!");
  jobForm.reset();
  window.location.href = "employer-dashboard.html";
});