const placelySupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const ROUTES = {
  login: "employer-login.html",
  mainLogin: "../public/login.html",
  profile: "employer-profile.html"
};

let employerProfile = {};
let activeJobs = [];
let savedCandidates = JSON.parse(localStorage.getItem("placely_saved_candidates")) || [];
let pipelineCandidates = JSON.parse(localStorage.getItem("placely_employer_pipeline")) || [];

const demoCandidates = [
  {
    id: "cand-001",
    name: "Marcus R.",
    trade: "Journeyman Electrician",
    location: "Kelowna, BC",
    experience: "Journeyman",
    availability: "Available immediately",
    tags: ["Red Seal", "Commercial", "Service work"]
  },
  {
    id: "cand-002",
    name: "Tyler B.",
    trade: "Welder",
    location: "Penticton, BC",
    experience: "Apprentice",
    availability: "Open to full-time",
    tags: ["MIG", "Fabrication", "Shop work"]
  },
  {
    id: "cand-003",
    name: "Jordan S.",
    trade: "Construction Labourer",
    location: "West Kelowna, BC",
    experience: "Entry level",
    availability: "Available this week",
    tags: ["Reliable", "Site cleanup", "Material handling"]
  }
];

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "";
}

function showToast(message) {
  const toast = document.getElementById("toast");

  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2400);
}

function saveState() {
  localStorage.setItem("placely_saved_candidates", JSON.stringify(savedCandidates));
  localStorage.setItem("placely_employer_pipeline", JSON.stringify(pipelineCandidates));
}

function getInitials(name) {
  if (!name) return "PT";

  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0].toUpperCase())
    .join("");
}

function renderEmpty(containerId, title, text, actionText, actionHref) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="empty-state">
      <strong>${title}</strong>
      <p>${text}</p>
      ${actionText ? `<a href="${actionHref}" class="empty-action">${actionText}</a>` : ""}
    </div>
  `;
}

function updateHeroSummary() {
  const jobs = activeJobs.length;
  const saved = savedCandidates.length;
  const pipeline = pipelineCandidates.length;

  setText(
    "heroSummary",
    `${jobs} active job${jobs === 1 ? "" : "s"} • ${saved} saved candidate${saved === 1 ? "" : "s"} • ${pipeline} candidate${pipeline === 1 ? "" : "s"} in review • Candidate preview enabled`
  );
}

function renderActiveJobs() {
  const container = document.getElementById("activeJobsList");
  if (!container) return;

  if (!activeJobs.length) {
    renderEmpty(
      "activeJobsList",
      "No active job posts yet",
      "Create your first job posting to begin receiving applications.",
      "Create Job Post",
      "#post-job"
    );
    return;
  }

  container.innerHTML = activeJobs.map(job => `
    <article class="job-card">
      <div>
        <h3>${job.title}</h3>
        <p class="meta">${job.location} · ${job.type} · ${job.pay || "Pay not listed"}</p>
        <div class="tags">
          <span>Active</span>
          <span>Accepting applicants</span>
        </div>
      </div>

      <div class="job-actions">
        <button type="button" class="job-btn secondary" onclick="handlePauseJob('${job.id}')">Pause</button>
      </div>
    </article>
  `).join("");
}

function renderSavedCandidates() {
  const container = document.getElementById("savedCandidatesList");
  if (!container) return;

  if (!savedCandidates.length) {
    renderEmpty(
      "savedCandidatesList",
      "No saved candidates yet",
      "Preview candidate matches and save strong profiles for later review.",
      "Preview Candidates",
      "#candidate-access"
    );
    return;
  }

  container.innerHTML = savedCandidates.slice(0, 3).map(candidate => `
    <article class="candidate-card">
      <div>
        <h3>${candidate.name}</h3>
        <p>${candidate.trade} · ${candidate.location}</p>
        <div class="tags">
          <span>${candidate.experience}</span>
          <span>${candidate.availability}</span>
        </div>
      </div>
    </article>
  `).join("");
}

function renderPipeline() {
  const container = document.getElementById("pipelineList");
  if (!container) return;

  if (!pipelineCandidates.length) {
    renderEmpty(
      "pipelineList",
      "No candidates in review yet",
      "Applicants and candidates you move into review will appear here.",
      "Preview Candidates",
      "#candidate-access"
    );
    return;
  }

  container.innerHTML = pipelineCandidates.map(candidate => `
    <article class="activity-card">
      <h3>${candidate.name}</h3>
      <p>${candidate.trade} · ${candidate.location} · Status: Reviewing</p>
    </article>
  `).join("");
}

function getFilteredCandidates() {
  const keyword = (document.getElementById("candidateKeyword")?.value || "").toLowerCase();
  const location = (document.getElementById("candidateLocation")?.value || "").toLowerCase();
  const experience = (document.getElementById("candidateExperience")?.value || "").toLowerCase();

  return demoCandidates.filter(candidate => {
    const text = [
      candidate.name,
      candidate.trade,
      candidate.location,
      candidate.experience,
      candidate.availability,
      ...candidate.tags
    ].join(" ").toLowerCase();

    return (
      (!keyword || text.includes(keyword)) &&
      (!location || candidate.location.toLowerCase().includes(location)) &&
      (!experience || candidate.experience.toLowerCase().includes(experience))
    );
  });
}

function renderCandidatePreview(results) {
  const container = document.getElementById("candidatePreviewResults");
  if (!container) return;

  if (!results.length) {
    container.innerHTML = `
      <strong>No preview matches found</strong>
      <p>Try a broader trade, nearby location, or different experience level.</p>
    `;
    return;
  }

  container.innerHTML = `
    <strong>${results.length} preview match${results.length === 1 ? "" : "es"}</strong>
    <p>Save strong candidates to your shortlist. Contact details unlock with employer access.</p>
    ${results.slice(0, 2).map(candidate => `
      <div class="preview-candidate">
        <strong>${candidate.name}</strong>
        <span>${candidate.trade} · ${candidate.location}</span>
        <button type="button" onclick="handleSavePreviewCandidate('${candidate.id}')">
          Save Candidate
        </button>
      </div>
    `).join("")}
  `;
}

function handleCandidateSearch(event) {
  event.preventDefault();

  const results = getFilteredCandidates();
  renderCandidatePreview(results);

  if (!results.length) {
    showToast("No preview matches found.");
    return;
  }

  showToast(`${results.length} preview match${results.length === 1 ? "" : "es"} found.`);
}

function handleSavePreviewCandidate(candidateId) {
  const candidate = demoCandidates.find(person => person.id === candidateId);
  if (!candidate) return;

  const alreadySaved = savedCandidates.some(saved => saved.id === candidate.id);

  if (alreadySaved) {
    showToast("Candidate is already saved.");
    return;
  }

  savedCandidates.unshift(candidate);
  renderDashboard();
  showToast(`${candidate.name} added to saved talent.`);
}

function renderPriorityActions() {
  const container = document.getElementById("priorityActions");
  if (!container) return;

  const actions = [
    {
      title: activeJobs.length ? "Job posts are active" : "Create your first job post",
      text: activeJobs.length
        ? `${activeJobs.length} active role${activeJobs.length === 1 ? "" : "s"} currently listed.`
        : "Create a job post so candidates can review and apply.",
      href: "#post-job",
      done: activeJobs.length > 0
    },
    {
      title: savedCandidates.length ? "Review saved talent" : "Build a saved talent list",
      text: savedCandidates.length
        ? `${savedCandidates.length} candidate${savedCandidates.length === 1 ? "" : "s"} saved for review.`
        : "Preview matches and save candidates worth reviewing later.",
      href: "#candidate-access",
      done: savedCandidates.length > 0
    },
    {
      title: pipelineCandidates.length ? "Review candidate pipeline" : "Check applicant pipeline",
      text: pipelineCandidates.length
        ? `${pipelineCandidates.length} candidate${pipelineCandidates.length === 1 ? "" : "s"} currently in review.`
        : "Applicants and moved candidates will appear in your review pipeline.",
      href: "#pipeline",
      done: pipelineCandidates.length > 0
    }
  ];

  container.innerHTML = actions.map(action => `
    <a href="${action.href}" class="action-card ${action.done ? "done" : ""}">
      <strong>${action.title}</strong>
      <p>${action.text}</p>
    </a>
  `).join("");
}

function updateCounts(messageCount = 0) {
  setText("activeJobsCount", activeJobs.length);
  setText("savedCandidatesCount", savedCandidates.length);
  setText("applicationsCount", pipelineCandidates.length);
  setText("messagesCount", messageCount);

  setText("newApplicantsCount", pipelineCandidates.length);
  setText("reviewingCount", pipelineCandidates.length);
  setText("interviewCount", "0");

  setText("activityJobs", activeJobs.length);
  setText("activitySaved", savedCandidates.length);
  setText("activityPipeline", pipelineCandidates.length);

  if (activeJobs.length || savedCandidates.length || pipelineCandidates.length) {
    setText("activityTip", "Your workspace is active. Continue reviewing candidates and keeping job posts current.");
  } else {
    setText("activityTip", "Create a job post and save candidates to start building your hiring workspace.");
  }

  updateHeroSummary();
}


async function loadEmployerJobs(userId) {
  const { data, error } = await placelySupabase
    .from("jobs")
    .select("*")
    .eq("employer_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Load employer jobs error:", error);
    activeJobs = [];
    return;
  }

  activeJobs = (data || []).map(job => ({
    id: job.id,
    title: job.job_title || "Untitled Job",
    location: job.location || "Location not listed",
    pay: job.pay_range || "Pay not listed",
    type: job.employment_type || "Full-time",
    description: job.job_description || "",
    status: job.status || "active",
    createdAt: job.created_at
  }));
}

function renderDashboard() {
  renderActiveJobs();
  renderSavedCandidates();
  renderPipeline();
  renderPriorityActions();
  updateCounts();
  saveState();
}

async function handleJobPost(event) {
  event.preventDefault();

  const title = document.getElementById("jobTitle")?.value.trim();
  const location = document.getElementById("jobLocation")?.value.trim();
  const pay = document.getElementById("jobPay")?.value.trim();
  const type = document.getElementById("jobType")?.value || "Full-time";
  const description = document.getElementById("jobDescription")?.value.trim();

  if (!title || !location) {
    showToast("Add a job title and location first.");
    return;
  }

  const { data: { user }, error: userError } = await placelySupabase.auth.getUser();

  if (userError || !user) {
    window.location.href = ROUTES.login;
    return;
  }

  const { error } = await placelySupabase
    .from("jobs")
    .insert({
      employer_id: user.id,
      job_title: title,
      company_name: employerProfile.company_name || "Employer",
      location,
      pay_range: pay,
      employment_type: type,
      job_description: description,
      status: "active"
    });

  if (error) {
    console.error("Post job error:", error);
    showToast("Could not post job.");
    return;
  }

  event.target.reset();

  await loadEmployerJobs(user.id);
  renderDashboard();

  showToast("Job post created.");
}

function handlePauseJob(jobId) {
  activeJobs = activeJobs.filter(job => job.id !== jobId);
  renderDashboard();
  showToast("Job post paused.");
}

async function handleLogout() {
  await placelySupabase.auth.signOut();
  window.location.href = ROUTES.mainLogin;
}

window.handlePauseJob = handlePauseJob;
window.handleSavePreviewCandidate = handleSavePreviewCandidate;
window.handleLogout = handleLogout;

async function loadEmployerDashboard() {
  const { data: { user }, error: userError } = await placelySupabase.auth.getUser();

  if (userError || !user) {
    window.location.href = ROUTES.login;
    return;
  }

  const { data: roleProfile, error: roleError } = await placelySupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (roleError || !roleProfile || roleProfile.role !== "employer") {
    await placelySupabase.auth.signOut();
    window.location.href = ROUTES.login;
    return;
  }

  const { data: employerData, error: employerError } = await placelySupabase
    .from("employer_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { count: unreadCount, error: unreadError } = await placelySupabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("employer_id", user.id)
    .eq("sender_type", "candidate")
    .eq("read_by_employer", false);

  if (unreadError) {
    console.error("Unread message count error:", unreadError);
  }

  if (employerError || !employerData) {
    console.error("Employer profile error:", employerError);

    employerProfile = {
      company_name: "Employer",
      company_email: user.email,
      contact_name: "Not completed",
      phone: "Not completed",
      industry: "Not completed",
      hiring_needs: "No hiring needs added yet.",
      company_logo_url: ""
    };

    showToast("Employer profile not completed yet.");
  } else {
    employerProfile = employerData;
  }

  const companyName = employerProfile.company_name || "Employer";
  const email = employerProfile.company_email || user.email || "Not available";
  const contactName = employerProfile.contact_name || "Not completed";
  const industry = employerProfile.industry || "Not completed";
  const phone = employerProfile.phone || "Not completed";

  setText("companyNameTitle", companyName);
  setText("companyNameSidebar", companyName);
  setText("industrySidebar", industry);
  setText("emailSidebar", email);

  const logoBox = document.getElementById("companyInitials");

  if (logoBox && employerProfile.company_logo_url) {
    logoBox.innerHTML = `
      <img 
        src="${employerProfile.company_logo_url}" 
        class="dashboard-company-logo" 
        alt="Company logo"
      />
    `;
  } else if (logoBox) {
    logoBox.textContent = getInitials(companyName);
  }

  setText("companyName", companyName);
  setText("contactName", contactName);
  setText("industry", industry);
  setText("phone", phone);
  setText("userEmail", email);

  await loadEmployerJobs(user.id);

  renderDashboard();

  setText("messagesCount", unreadCount || 0);
}

document.addEventListener("DOMContentLoaded", () => {
  loadEmployerDashboard();

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

  const jobPostForm = document.getElementById("jobPostForm");
  if (jobPostForm) jobPostForm.addEventListener("submit", handleJobPost);

  const candidateSearchForm = document.getElementById("candidateSearchForm");
  if (candidateSearchForm) candidateSearchForm.addEventListener("submit", handleCandidateSearch);
});