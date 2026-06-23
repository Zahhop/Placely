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
    `${jobs} active job${jobs === 1 ? "" : "s"} • ${pipeline} applicant${pipeline === 1 ? "" : "s"} needing review • ${saved} saved candidate${saved === 1 ? "" : "s"} • Candidate network preview enabled`
  );
}

function renderActiveJobs() {
  const container = document.getElementById("activeJobsList");
  if (!container) return;

  if (!activeJobs.length) {
    renderEmpty(
      "activeJobsList",
      "No active job posts yet",
      "Use your Manage Jobs page to create a detailed job post with the full posting form.",
      "Create Job Post",
      "manage-jobs.html"
    );
    return;
  }

  container.innerHTML = activeJobs.slice(0, 3).map(job => `
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
        <a href="manage-jobs.html" class="job-btn secondary">Manage</a>
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
      "Find Candidates",
      "find-candidates.html"
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
      "No applicants in review yet",
      "Applicants will appear here when candidates apply or when you move saved candidates into review.",
      "Open Applicants",
      "employer-applicants.html"
    );
    return;
  }

  container.innerHTML = pipelineCandidates.slice(0, 4).map(candidate => `
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
      title: activeJobs.length ? "Jobs are live" : "Create your first job post",
      text: activeJobs.length
        ? `${activeJobs.length} active role${activeJobs.length === 1 ? "" : "s"} currently listed.`
        : "Use Manage Jobs to publish a full job post.",
      href: "manage-jobs.html",
      done: activeJobs.length > 0
    },
    {
      title: pipelineCandidates.length ? "Review applicants" : "Watch applicant activity",
      text: pipelineCandidates.length
        ? `${pipelineCandidates.length} candidate${pipelineCandidates.length === 1 ? "" : "s"} currently in review.`
        : "New applicants will appear in your applicant queue.",
      href: "employer-applicants.html",
      done: pipelineCandidates.length > 0
    },
    {
      title: savedCandidates.length ? "Review saved talent" : "Build saved talent",
      text: savedCandidates.length
        ? `${savedCandidates.length} candidate${savedCandidates.length === 1 ? "" : "s"} saved for review.`
        : "Preview and save candidates for future outreach.",
      href: "saved-talent.html",
      done: savedCandidates.length > 0
    }
  ];

  container.innerHTML = actions.map(action => `
    <a href="${action.href}" class="action-card ${action.done ? "done" : ""}">
      <strong>${action.title}</strong>
      <p>${action.text}</p>
    </a>
  `).join("");
}

function updateCounts(messageCount = null) {
  setText("activeJobsCount", activeJobs.length);
  setText("savedCandidatesCount", savedCandidates.length);
  setText("applicationsCount", pipelineCandidates.length);

  if (messageCount !== null) {
    setText("messagesCount", messageCount);
  }

  setText("newApplicantsCount", pipelineCandidates.length);
  setText("reviewingCount", pipelineCandidates.length);
  setText("interviewCount", "0");

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

async function handleLogout() {
  await placelySupabase.auth.signOut();
  window.location.href = ROUTES.mainLogin;
}

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
  const industry = employerProfile.industry || "Not completed";

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

  await loadEmployerJobs(user.id);

  renderDashboard();
  updateCounts(unreadCount || 0);
}

document.addEventListener("DOMContentLoaded", () => {
  loadEmployerDashboard();

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

  const candidateSearchForm = document.getElementById("candidateSearchForm");
  if (candidateSearchForm) candidateSearchForm.addEventListener("submit", handleCandidateSearch);
});