const placelySupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const hiringRequestForm = document.getElementById("hiringRequestForm");

hiringRequestForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const { data: { user }, error: userError } =
    await placelySupabase.auth.getUser();

  if (userError || !user) {
    alert("Please log in first.");
    return;
  }

  const workersNeededValue = document.getElementById("workersNeeded").value;

  const { error } = await placelySupabase
    .from("hiring_requests")
    .insert([
      {
        employer_id: user.id,
        company_name: document.getElementById("companyName").value,
        contact_name: document.getElementById("contactName").value,
        role_needed: document.getElementById("roleNeeded").value,
        workers_needed: workersNeededValue ? Number(workersNeededValue) : null,
        location: document.getElementById("location").value,
        start_timeline: document.getElementById("startTimeline").value,
        employment_type: document.getElementById("employmentType").value,
        experience_level: document.getElementById("experienceLevel").value,
        required_skills: document.getElementById("requiredSkills").value,
        help_needed: document.getElementById("helpNeeded").value,
        additional_notes: document.getElementById("additionalNotes").value,
        status: "new"
      }
    ]);

  if (error) {
    console.error(error);
    alert("Error submitting hiring request: " + error.message);
    return;
  }

  alert("Hiring request submitted successfully!");
  hiringRequestForm.reset();
  window.location.href = "employer-dashboard.html";
});