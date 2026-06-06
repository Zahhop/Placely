const placelySupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const jobForm = document.getElementById("jobForm");

jobForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const { data: { user }, error: userError } =
    await placelySupabase.auth.getUser();

  if (userError || !user) {
    alert("Please log in first.");
    return;
  }

  const { error } = await placelySupabase
    .from("jobs")
    .insert([
      {
        employer_id: user.id,
        job_title: document.getElementById("jobTitle").value,
        company_name: document.getElementById("companyName").value,
        location: document.getElementById("location").value,
        employment_type: document.getElementById("employmentType").value,
        pay_range: document.getElementById("payRange").value,
        experience_level: document.getElementById("experienceLevel").value,
        job_description: document.getElementById("jobDescription").value,
        required_skills: document.getElementById("requiredSkills").value,
        benefits: document.getElementById("benefits").value,
        status: "active"
      }
    ]);

  if (error) {
    console.error(error);
    alert("Error posting job: " + error.message);
    return;
  }

  alert("Job posted successfully!");

  jobForm.reset();

  window.location.href = "employer-dashboard.html";
});