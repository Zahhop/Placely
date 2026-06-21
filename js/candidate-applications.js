const applicationsSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const applicationsList = document.getElementById("applications_list");

async function loadApplications() {
  const { data: { user }, error: userError } =
    await applicationsSupabase.auth.getUser();

  if (userError || !user) {
    window.location.href = "candidate-login.html";
    return;
  }

  const { data: applications, error } = await applicationsSupabase
    .from("applications")
    .select("*")
    .eq("candidate_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Applications load error:", error);
    applicationsList.innerHTML = `
      <div class="empty-state">
        Could not load applications.
      </div>
    `;
    return;
  }

  document.getElementById("applied_count").textContent = applications.length;
  document.getElementById("interviewing_count").textContent =
    applications.filter(app => app.status === "Interviewing").length;
  document.getElementById("offers_count").textContent =
    applications.filter(app => app.status === "Offer").length;
  document.getElementById("followups_count").textContent = applications.length;

  if (!applications.length) {
    applicationsList.innerHTML = `
      <div class="empty-state">
        <strong>No applications yet</strong>
        <p>When you apply to jobs, your applications will appear here.</p>
        <a href="../public/find-jobs.html?role=candidate">Browse Jobs</a>
      </div>
    `;
    return;
  }

  applicationsList.innerHTML = applications.map(app => `
    <article class="application-card">
      <div>
        <h3>${app.job_title || "Untitled Job"}</h3>
        <p>
          ${app.company_name || "Company"} ·
          ${app.location || "Location not listed"} ·
          ${app.employment_type || "Job type not listed"} ·
          ${app.pay_range || "Pay not listed"}
        </p>

        <div class="tags">
          <span>${app.status || "Submitted"}</span>
          <span>Follow up soon</span>
        </div>
      </div>

      <div class="application-actions">
        <button
          class="follow-up-btn"
          onclick="handleFollowUp('${app.conversation_id || ""}')"
        >
          Follow Up
        </button>

        <div class="status-pill">${app.status || "Applied"}</div>
      </div>
    </article>
  `).join("");
}

function handleFollowUp(conversationId) {
  if (!conversationId) {
    alert("No conversation has been started with this employer yet.");
    return;
  }

  window.location.href = `candidate-messages.html?conversation=${conversationId}`;
}

window.handleFollowUp = handleFollowUp;

loadApplications();