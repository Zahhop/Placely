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

  const {
    data: { user }
} = await supabase.auth.getUser();

await supabase
.from("jobs")
.insert({
    employer_id: user.id,

    job_title,
    company_name,
    location,
    employment_type,
    pay_range,
    job_description,
    required_skills,
    benefits,

    status: "active"
});

  if (error) {
    console.error(error);
    alert("Error posting job: " + error.message);
    return;
  }

  alert("Job posted successfully!");

  jobForm.reset();

  window.location.href = "employer-dashboard.html";
});