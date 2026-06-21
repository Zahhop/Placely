const candidateSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const ROUTES = {
  login: "candidate-login.html",
  profile: "candidate-profile.html",
  messages: "candidate-messages.html",
  jobs: "../public/find-jobs.html?role=candidate",
  saved: "../public/saved-jobs.html",
  applications: "candidate-applications.html"
};

let dashboardProfile = {};
let matchedJobs = [];
let savedJobs = JSON.parse(localStorage.getItem("placely_saved_jobs")) || [];
let applications = JSON.parse(localStorage.getItem("placely_applications")) || [];

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
  }, 2500);
}

function saveState() {
  localStorage.setItem("placely_saved_jobs", JSON.stringify(savedJobs));
  localStorage.setItem("placely_applications", JSON.stringify(applications));
}

function getInitials(name) {
  if (!name || name === "Candidate") return "PT";

  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0].toUpperCase())
    .join("");
}

function calculateProfileStrength(profile) {
  let score = 0;

  if (profile.full_name) score += 10;
  if (profile.trade) score += 15;
  if (profile.location) score += 10;
  if (profile.experience) score += 15;
  if (profile.availability) score += 10;
  if (profile.phone) score += 10;
  if (profile.contact_method) score += 10;
  if (profile.resume_url) score += 15;
  if (profile.profile_photo_url) score += 5;

  return Math.min(score, 100);
}

function renderProfilePhoto(profile, fullName) {
  const image = document.getElementById("profile_photo_url");
  const initials = document.getElementById("profile_initials");

  if (!image || !initials) return;

  if (profile.profile_photo_url) {
    image.src = profile.profile_photo_url;
    image.style.display = "block";
    initials.style.display = "none";
  } else {
    image.removeAttribute("src");
    image.style.display = "none";
    initials.style.display = "grid";
    initials.textContent = getInitials(fullName);
  }
}

function renderEmpty(containerId, title, text, actionText, actionHref) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="empty-state compact-empty">
      <strong>${title}</strong>
      <p>${text}</p>
      ${actionText ? `<a href="${actionHref}" class="empty-action">${actionText}</a>` : ""}
    </div>
  `;
}

function getAllJobs(profile) {
  const location = profile.location || "British Columbia";
  const trade = profile.trade || "Trades";

  return [
    {
      id: "job-001",
      title: `${trade} Assistant`,
      company: "Local Trades Company",
      location,
      type: "Full-time",
      pay: "$24-$32/hr",
      match: "Profile match",
      reason: "Based on your trade and location",
      details: "Support crews, build hands-on experience, and work with experienced tradespeople on active job sites."
    },
    {
      id: "job-002",
      title: "Construction Labourer",
      company: "Commercial Build",
      location: "Kelowna, BC",
      type: "Full-time",
      pay: "$22-$30/hr",
      match: "Entry friendly",
      reason: "Good fit for hands-on trades experience",
      details: "Support site crews, move materials, assist trades, and build practical field experience on commercial projects."
    },
    {
      id: "job-003",
      title: "Apprentice Helper",
      company: "Regional Contractor",
      location: "Penticton, BC",
      type: "Apprenticeship",
      pay: "$20-$28/hr",
      match: "Growth role",
      reason: "Good path for building experience",
      details: "Learn on site, assist senior tradespeople, maintain tools, and develop practical skills in a structured work environment."
    }
  ];
}

function getFilteredJobs() {
  const keyword = (document.getElementById("job_keyword")?.value || "").toLowerCase();
  const location = (document.getElementById("job_location")?.value || "").toLowerCase();
  const type = (document.getElementById("job_type")?.value || "").toLowerCase();

  let jobs = getAllJobs(dashboardProfile);

  if (keyword) {
    jobs = jobs.filter(job =>
      job.title.toLowerCase().includes(keyword) ||
      job.company.toLowerCase().includes(keyword) ||
      job.type.toLowerCase().includes(keyword) ||
      job.details.toLowerCase().includes(keyword)
    );
  }

  if (location) {
    jobs = jobs.filter(job => job.location.toLowerCase().includes(location));
  }

  if (type) {
    jobs = jobs.filter(job => job.type.toLowerCase() === type);
  }

  return jobs;
}

function renderMatchedJobs() {
  const container = document.getElementById("matched_jobs_list");
  if (!container) return;

  matchedJobs = getFilteredJobs();

  if (!matchedJobs.length) {
    renderEmpty(
      "matched_jobs_list",
      "No matched jobs found",
      "Try changing your search or updating your profile details.",
      "Update profile",
      ROUTES.profile
    );
    return;
  }

  const savedIds = savedJobs.map(job => job.id);
  const appliedIds = applications.map(job => job.id);

  container.innerHTML = matchedJobs.map((job, index) => {
    const saved = savedIds.includes(job.id);
    const applied = appliedIds.includes(job.id);

    return `
      <article class="job-card">
        <div>
          <h3>${job.title}</h3>
          <div class="job-meta">${job.company} · ${job.location} · ${job.type} · ${job.pay}</div>

          <div class="job-tags">
            <span>${job.match}</span>
            <span>${job.reason}</span>
          </div>

          <div class="job-expanded" id="job_details_${index}" style="display:none;">
            ${job.details}
          </div>
        </div>

        <div class="job-actions">
          <button type="button" class="job-btn secondary" onclick="handleSaveJob(${index})">
            ${saved ? "Saved" : "Save"}
          </button>

          <button type="button" class="job-btn secondary" onclick="handleApplyJob(${index})">
            ${applied ? "Applied" : "Apply"}
          </button>

          <button type="button" class="job-btn" id="view_job_btn_${index}" onclick="handleViewJob(${index})">
            View
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function renderSavedJobs() {
  if (!savedJobs.length) {
    renderEmpty(
      "saved_jobs_list",
      "No saved jobs yet",
      "Save roles you want to review or apply to later.",
      "Browse matches",
      "#jobs"
    );
    return;
  }

  const container = document.getElementById("saved_jobs_list");
  if (!container) return;

  container.innerHTML = savedJobs.map(job => `
    <article class="job-card">
      <div>
        <h3>${job.title}</h3>
        <div class="job-meta">${job.company} · ${job.location} · ${job.type} · ${job.pay}</div>
      </div>

      <div class="job-actions">
        <button type="button" class="job-btn secondary" onclick="handleRemoveSavedJob('${job.id}')">
          Remove
        </button>
      </div>
    </article>
  `).join("");
}

function renderApplications() {
  if (!applications.length) {
    renderEmpty(
      "applications_list",
      "No applications yet",
      "When you apply to jobs, your application status will show here.",
      "Browse matched jobs",
      "#jobs"
    );
    return;
  }

  const container = document.getElementById("applications_list");
  if (!container) return;

  container.innerHTML = applications.map(job => `
    <div class="activity-card">
      <span class="activity-dot"></span>
      <div>
        <strong>${job.title}</strong>
        <p>${job.company} · Applied today · Status: Submitted</p>
      </div>
    </div>
  `).join("");
}

function renderMessages() {
  renderEmpty(
    "messages_list",
    "No employer messages yet",
    "When employers reach out, your conversations will appear here.",
    "Open messages",
    ROUTES.messages
  );
}

function renderPriorityActions() {
  const container = document.getElementById("priority_actions");
  if (!container) return;

  const actions = [];

  if (!dashboardProfile.resume_url) {
    actions.push({
      title: "Upload your resume",
      text: "Profiles with resumes look more complete to employers.",
      href: ROUTES.profile
    });
  }

  if (!dashboardProfile.skills && !dashboardProfile.certifications) {
    actions.push({
      title: "Add skills and certifications",
      text: "Show employers what you can do before they message you.",
      href: ROUTES.profile
    });
  }

  if (!dashboardProfile.experience || !dashboardProfile.availability) {
    actions.push({
      title: "Complete work details",
      text: "Add experience and availability to improve your matches.",
      href: ROUTES.profile
    });
  }

  if (matchedJobs.length > 0) {
    actions.push({
      title: "Review today’s job matches",
      text: `${matchedJobs.length} role${matchedJobs.length === 1 ? "" : "s"} available based on your profile.`,
      href: "#jobs"
    });
  }

  container.innerHTML = actions.slice(0, 2).map(action => `
    <a class="action-card" href="${action.href}">
      <strong>${action.title}</strong>
      <p>${action.text}</p>
    </a>
  `).join("");
}

function updateCounts() {
  setText("matched_jobs_count", matchedJobs.length);
  setText("saved_jobs_count", savedJobs.length);
  setText("applications_count", applications.length);
  setText("messages_count", "0");

  setText("applied_count", applications.length);
  setText("interviewing_count", "0");
  setText("offers_count", "0");
}

function renderDashboard() {
  renderMatchedJobs();
  renderSavedJobs();
  renderApplications();
  renderMessages();
  renderPriorityActions();
  updateCounts();
  saveState();
}

function goToSection(id) {
  const section = document.querySelector(id);
  if (!section) return;

  section.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function handleSearchJobs() {
  renderDashboard();
  goToSection("#jobs");
  showToast("Search filters applied.");
}

async function handleLogout() {
  const { error } = await candidateSupabase.auth.signOut();

  if (error) {
    console.error("Logout error:", error);
    showToast("Could not log out. Try again.");
    return;
  }

  window.location.href = ROUTES.login;
}

function handleSaveJob(index) {
  const job = matchedJobs[index];
  if (!job) return;

  const exists = savedJobs.some(saved => saved.id === job.id);

  if (!exists) {
    savedJobs.push(job);
    showToast("Job saved.");
  } else {
    showToast("Job already saved.");
  }

  renderDashboard();
}

function handleApplyJob(index) {
  const job = matchedJobs[index];
  if (!job) return;

  const exists = applications.some(app => app.id === job.id);

  if (!exists) {
    applications.push(job);
    showToast("Application submitted.");
  } else {
    showToast("You already applied to this role.");
  }

  renderDashboard();
}

function handleViewJob(index) {
  const details = document.getElementById(`job_details_${index}`);
  const button = document.getElementById(`view_job_btn_${index}`);

  if (!details || !button) return;

  const isOpen = details.style.display === "block";

  details.style.display = isOpen ? "none" : "block";
  button.textContent = isOpen ? "View" : "Hide";
}

function handleRemoveSavedJob(jobId) {
  savedJobs = savedJobs.filter(job => job.id !== jobId);
  showToast("Saved job removed.");
  renderDashboard();
}

window.handleSearchJobs = handleSearchJobs;
window.handleLogout = handleLogout;
window.handleSaveJob = handleSaveJob;
window.handleApplyJob = handleApplyJob;
window.handleViewJob = handleViewJob;
window.handleRemoveSavedJob = handleRemoveSavedJob;

async function loadUser() {
  const { data: { user }, error: userError } = await candidateSupabase.auth.getUser();

  if (userError || !user) {
    window.location.href = ROUTES.login;
    return;
  }

  const { count: unreadCandidateMessages, error: unreadCandidateError } =
  await candidateSupabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("candidate_id", user.id)
    .eq("sender_type", "employer")
    .eq("read_by_candidate", false);

if (unreadCandidateError) {
  console.error("Candidate unread message count error:", unreadCandidateError);
} else {
  document.getElementById("candidateMessagesCount").textContent =
    unreadCandidateMessages || 0;
}

  const { data: profile, error } = await candidateSupabase
    .from("candidate_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Error loading candidate profile:", error);
    showToast("Profile details could not be loaded.");
  }

  dashboardProfile = profile || {
    id: user.id,
    full_name: user.email?.split("@")[0] || "Candidate",
    email: user.email,
    trade: "",
    location: "",
    experience: "",
    availability: "",
    phone: "",
    contact_method: "",
    resume_url: "",
    profile_photo_url: "",
    profile_visible: true
  };

  const fullName = dashboardProfile.full_name || "Candidate";
  const firstName = fullName.split(" ")[0];
  const email = dashboardProfile.email || user.email || "Not available";
  const resumeStatus = dashboardProfile.resume_url ? "Uploaded" : "Not uploaded";
  const visibilityOn = dashboardProfile.profile_visible !== false;
  const strength = calculateProfileStrength(dashboardProfile);

  setText("dashboard_first_name", firstName);
  setText("full_name", fullName);
  setText("sidebar_trade", dashboardProfile.trade || "Add your trade");
  setText("sidebar_location", dashboardProfile.location || "Add location");
  setText("sidebar_email", email);

  setText("trade", dashboardProfile.trade || "Not added");
  setText("experience", dashboardProfile.experience || "Not added");
  setText("availability", dashboardProfile.availability || "Not added");
  setText("phone", dashboardProfile.phone || "Not added");
  setText("email", email);
  setText("contact_method", dashboardProfile.contact_method || "Not added");
  setText("resume_status", resumeStatus);

  setText("visibility_status", visibilityOn ? "On" : "Off");
  setText("profile_status_label", visibilityOn ? "Active" : "Hidden");
  setText("visibility_title", visibilityOn ? "Visible" : "Hidden");
  setText("open_to_work", visibilityOn ? "Enabled" : "Disabled");

  setText(
    "visibility_description",
    visibilityOn
      ? "Your profile can be discovered by employers looking for trades candidates."
      : "Your profile is currently hidden from employer searches."
  );

  setText("profile_strength_text", `${strength}%`);

  const bar = document.getElementById("profile_strength_bar");
  if (bar) bar.style.width = `${strength}%`;

  if (strength >= 80) {
    setText("profile_tip", "Your profile is strong. Keep your resume and availability current.");
    setText("match_strength", "High");
  } else if (strength >= 50) {
    setText("profile_tip", "Add missing details to improve employer visibility.");
    setText("match_strength", "Medium");
  } else {
    setText("profile_tip", "Complete your profile to appear in better employer searches.");
    setText("match_strength", "Low");
  }

  setText("profile_freshness", strength >= 70 ? "Current" : "Needs update");

  renderProfilePhoto(dashboardProfile, fullName);
  renderDashboard();
}

document.addEventListener("DOMContentLoaded", () => {
  loadUser();

  const searchBtn = document.getElementById("searchJobsBtn");
  if (searchBtn) searchBtn.onclick = handleSearchJobs;

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.onclick = handleLogout;
});