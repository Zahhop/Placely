const placelySupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const jobsGrid = document.getElementById("jobsGrid");

async function loadJobs() {
  const { data: jobs, error } = await placelySupabase
    .from("jobs")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    jobsGrid.innerHTML = `
      <div class="job-card">
        Could not load jobs.
      </div>
    `;
    return;
  }

  if (!jobs || jobs.length === 0) {
    jobsGrid.innerHTML = `
      <div class="job-card">
        No jobs have been posted yet.
      </div>
    `;
    return;
  }

  jobsGrid.innerHTML = "";

  jobs.forEach((job) => {
    jobsGrid.innerHTML += `
      <div class="job-card">
        <div class="job-top">
          <div>
            <div class="job-title">${job.job_title || "Untitled Job"}</div>
            <div class="company">${job.company_name || "Company not listed"}</div>
            <div class="location">${job.location || "Location not listed"}</div>
          </div>

          <div class="job-type">${job.employment_type || "Job"}</div>
        </div>

        <div class="description">
          ${job.job_description || "No description provided."}
        </div>

        <div class="bottom-row">
          <div class="salary">${job.pay_range || "Pay not listed"}</div>

          <div class="buttons">
            <button class="apply-btn">Apply Now</button>
            <button class="remove-btn">Save</button>
          </div>
        </div>
      </div>
    `;
  });
}

loadJobs();