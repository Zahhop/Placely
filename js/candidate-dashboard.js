const candidateSupabase = window.PlacelyAuth.client();

const ROUTES = {
  login: "candidate-login.html",
  profile: "candidate-profile.html",
  messages: "candidate-messages.html",
  jobs: "../public/find-jobs.html?role=candidate",
  saved: "../public/saved-jobs.html",
  applications: "candidate-applications.html"
};

let currentUser = null;
let dashboardProfile = {};
let applications = [];
let conversations = [];

document.addEventListener("DOMContentLoaded", initDashboard);

async function initDashboard() {
  const user = await verifyCandidateAccess(candidateSupabase, {
    loginPath: ROUTES.login,
    employerDashboardPath: "../employers/employer-dashboard.html"
  });

  if (!user) return;

  currentUser = user;

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.onclick = handleLogout;

  await Promise.all([
    loadProfile(user),
    loadApplications(user.id),
    loadSavedCount(user.id),
    loadUnreadMessageCount(user.id),
    loadConversations(user.id)
  ]);

  renderDashboard();
}

async function loadProfile(user) {
  const { data, error } = await candidateSupabase
    .from("candidate_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Error loading candidate profile:", error);
  }

  dashboardProfile = data
    ? {
        ...data,
        email: data.email || user.email || ""
      }
    : {
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
    avatar_url: ""
  };
}

async function loadApplications(userId) {
  const { data, error } = await candidateSupabase
    .from("applications")
    .select("*")
    .eq("candidate_id", userId)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Candidate dashboard applications error:", error);
    applications = [];
    return;
  }

  applications = data || [];
}

async function loadSavedCount(userId) {
  const { count, error } = await candidateSupabase
    .from("saved_jobs")
    .select("*", { count: "exact", head: true })
    .eq("candidate_id", userId);

  if (error) {
    console.error("Saved jobs count error:", error);
    setText("saved_jobs_count", "0");
    return;
  }

  setText("saved_jobs_count", count || 0);
}

async function loadUnreadMessageCount(userId) {
  const { count, error } = await candidateSupabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("candidate_id", userId)
    .eq("sender_type", "employer")
    .eq("read_by_candidate", false);

  if (error) {
    console.error("Candidate unread message count error:", error);
    setText("candidateMessagesCount", "0");
    setText("messages_subtext", "No unread messages");
    return;
  }

  const unread = count || 0;
  setText("candidateMessagesCount", unread);
  setText(
    "messages_subtext",
    unread === 0 ? "No unread messages" : unread === 1 ? "1 unread message" : `${unread} unread messages`
  );
}

async function loadConversations(userId) {
  const { data, error } = await candidateSupabase
    .from("conversations")
    .select("*")
    .eq("candidate_id", userId)
    .order("created_at", { ascending: false })
    .limit(3);

  if (error) {
    console.error("Recent conversations error:", error);
    conversations = [];
    return;
  }

  conversations = await Promise.all(
    (data || []).map(async (conversation) => {
      const employer = await getEmployerProfile(conversation.employer_id);

      return {
        ...conversation,
        employer_name:
          employer?.company_name ||
          employer?.contact_name ||
          conversation.employer_name ||
          conversation.company_name ||
          "Employer"
      };
    })
  );
}

async function getEmployerProfile(employerId) {
  if (!employerId) return null;

  const { data, error } = await candidateSupabase
    .from("employer_profiles")
    .select("company_name, contact_name")
    .eq("id", employerId)
    .maybeSingle();

  if (error) {
    console.error("Employer profile load error:", error);
    return null;
  }

  return data;
}

function renderDashboard() {
  const fullName = dashboardProfile.full_name || "Candidate";
  const firstName = fullName.split(" ")[0];
  const completion = calculateProfileCompletion(dashboardProfile);

  setText("dashboard_first_name", firstName);
  setText("profile_completion_count", `${completion}%`);
  setText(
    "profile_completion_text",
    completion >= 100 ? "Profile Complete" : "Complete your profile"
  );
  setText("applications_count", applications.length);

  renderApplications();
  renderMessages();
  renderProfilePreview();
}

function renderProfilePreview() {
  const container = document.getElementById("dashboard_profile_preview");
  if (!container) return;

  const profile = {
    ...dashboardProfile,
    email: dashboardProfile.email || currentUser?.email || ""
  };
  const tags = window.CandidateProfilePreview?.getCandidateTags(profile, 4) || [];
  const tagHTML = tags.length
    ? tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("")
    : "<span>No skills added</span>";

  container.innerHTML = `
    <div class="dashboard-preview-card">
      ${window.CandidateProfilePreview?.renderAvatar(profile, "dashboard-preview-photo") || ""}
      <div class="dashboard-preview-info">
        <h3>${escapeHTML(profile.full_name || "Candidate Name")}</h3>
        <p>${escapeHTML(profile.trade || "Trade / Job Title")} &middot; ${escapeHTML(profile.location || "Location")}</p>
        <div class="dashboard-preview-tags">${tagHTML}</div>
      </div>
      <button type="button" class="job-btn secondary" id="dashboardViewPreviewBtn">View Full Preview</button>
    </div>
  `;

  document.getElementById("dashboardViewPreviewBtn")?.addEventListener("click", () => {
    window.CandidateProfilePreview?.openModal(profile);
  });
}

function renderApplications() {
  const container = document.getElementById("applications_list");
  if (!container) return;

  if (!applications.length) {
    renderEmpty(
      "applications_list",
      "No applications yet",
      "When you apply to jobs, your application status will show here.",
      "Find Jobs",
      ROUTES.jobs
    );
    return;
  }

  container.innerHTML = applications.slice(0, 3).map((app) => {
    const status = normalizeApplicationStatus(app.status);

    return `
      <article class="activity-card dashboard-application-card">
        <div>
          <h3>${escapeHTML(app.job_title || "Untitled Job")}</h3>
          <p>${escapeHTML(app.company_name || "Company")} &middot; ${escapeHTML(getApplicationStatusLabel(status))} &middot; Applied ${escapeHTML(formatDate(app.created_at))}</p>
        </div>
        <a class="job-btn secondary" href="${ROUTES.applications}">View</a>
      </article>
    `;
  }).join("");
}

function renderMessages() {
  const container = document.getElementById("messages_list");
  if (!container) return;

  if (!conversations.length) {
    container.innerHTML = `
      <div class="empty-state compact-empty">
        <strong>No recent conversations.</strong>
      </div>
    `;
    return;
  }

  container.innerHTML = conversations.slice(0, 3).map((conversation) => `
    <a class="message-card" href="${ROUTES.messages}?conversation=${encodeURIComponent(conversation.id)}">
      <h3>${escapeHTML(conversation.employer_name || "Employer")}</h3>
      <p>${escapeHTML(conversation.job_title || conversation.candidate_role || "Application conversation")}</p>
    </a>
  `).join("");
}

function renderEmpty(containerId, title, text, actionText, actionHref) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="empty-state compact-empty">
      <strong>${escapeHTML(title)}</strong>
      <p>${escapeHTML(text)}</p>
      ${actionText ? `<a href="${escapeHTML(actionHref)}" class="empty-action">${escapeHTML(actionText)}</a>` : ""}
    </div>
  `;
}

function calculateProfileCompletion(profile) {
  const fields = [
    "full_name",
    "trade",
    "location",
    "experience",
    "availability",
    "phone",
    "email",
    "resume_url",
    "skills",
    "certifications"
  ];

  const completed = fields.filter((field) => String(profile[field] || "").trim()).length;
  return Math.round((completed / fields.length) * 100);
}

function normalizeApplicationStatus(status) {
  const value = String(status || "submitted").toLowerCase().trim();

  if (["new"].includes(value)) return "new";
  if (["applied", "submitted"].includes(value)) return "submitted";
  if (["review", "reviewing", "viewed", "in review"].includes(value)) return "reviewing";
  if (["interview", "interviewing", "interview requested"].includes(value)) return "interview";
  if (["offer", "offered"].includes(value)) return "offer";
  if (["hired"].includes(value)) return "hired";
  if (["rejected", "declined"].includes(value)) return "rejected";

  return "submitted";
}

function getApplicationStatusLabel(status) {
  const labels = {
    new: "New",
    submitted: "Submitted",
    reviewing: "Reviewing",
    interview: "Interview",
    offer: "Offer",
    hired: "Hired",
    rejected: "Rejected"
  };

  return labels[status] || "Submitted";
}

function formatDate(value) {
  if (!value) return "recently";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "";
}

async function handleLogout() {
  try {
    await window.PlacelyAuth.clearAuthState();
  } catch (error) {
    console.error("Logout error:", error);
  }

  window.location.href = ROUTES.login;
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
