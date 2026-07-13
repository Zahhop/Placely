const placelySupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const ROUTES = {
  login: "employer-login.html",
  mainLogin: "../public/login.html",
  profile: "employer-profile.html"
};

let currentUser = null;
let employerProfile = {};
let activeJobs = [];
let applications = [];
let savedCandidates = [];
let candidatePreviewPool = [];
let unreadMessageCount = 0;

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "";
}

function showToast(message) {
  const toast = document.getElementById("toast");

  if (!toast) {
    console.warn(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2400);
}

function getInitials(name) {
  return String(name || "PT")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderEmpty(containerId, title, text, actionText, actionHref) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="empty-state">
      <strong>${escapeHTML(title)}</strong>
      <p>${escapeHTML(text)}</p>
      ${actionText ? `<a href="${escapeHTML(actionHref)}" class="empty-action">${escapeHTML(actionText)}</a>` : ""}
    </div>
  `;
}

function normalizeJobStatus(status) {
  const value = String(status || "active").toLowerCase().trim();
  return ["paused", "inactive", "closed"].includes(value) ? "paused" : "active";
}

function normalizeApplicationStatus(status) {
  const value = String(status || "submitted").toLowerCase().trim();

  if (["applied", "submitted", "new"].includes(value)) return "submitted";
  if (["review", "reviewing", "viewed", "in review"].includes(value)) return "reviewing";
  if (["interview", "interviewing", "interview requested"].includes(value)) return "interview";
  if (["offer", "offered"].includes(value)) return "offer";
  if (["hired"].includes(value)) return "hired";
  if (["rejected", "declined"].includes(value)) return "rejected";
  if (["withdrawn", "withdraw", "candidate_withdrew"].includes(value)) return "withdrawn";
  if (["candidate_deleted", "candidate_profile_deleted", "deleted"].includes(value)) return "candidate_deleted";

  return "submitted";
}

function getStatusLabel(status) {
  const labels = {
    submitted: "New",
    reviewing: "Reviewing",
    interview: "Interview",
    offer: "Offer",
    hired: "Hired",
    rejected: "Rejected",
    withdrawn: "Candidate Withdrew Application",
    candidate_deleted: "Candidate Profile Deleted"
  };

  return labels[status] || "New";
}

function formatDate(value) {
  if (!value) return "Recently";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";

  return date.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric"
  });
}

function truncateText(value, limit) {
  const text = String(value || "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
}

function getSavedCandidateIds() {
  const keys = ["placelySavedCandidates", "placely_saved_candidates"];
  const ids = new Set();

  keys.forEach((key) => {
    try {
      const saved = JSON.parse(localStorage.getItem(key)) || [];

      saved.forEach((item) => {
        if (typeof item === "string" || typeof item === "number") {
          ids.add(String(item));
          return;
        }

        if (item?.id) ids.add(String(item.id));
      });
    } catch {
      // Ignore malformed legacy saved data.
    }
  });

  return [...ids];
}

function saveCandidateId(candidateId) {
  const ids = new Set(getSavedCandidateIds());
  ids.add(String(candidateId));

  localStorage.setItem("placelySavedCandidates", JSON.stringify([...ids]));

  const savedDates = getSavedDates();
  if (!savedDates[String(candidateId)]) {
    savedDates[String(candidateId)] = new Date().toISOString();
    localStorage.setItem("placelySavedCandidateDates", JSON.stringify(savedDates));
  }
}

function getSavedDates() {
  try {
    return JSON.parse(localStorage.getItem("placelySavedCandidateDates")) || {};
  } catch {
    return {};
  }
}

function updateHeroSummary() {
  const jobs = activeJobs.length;
  const applicantCount = applications.length;
  const saved = savedCandidates.length;

  setText(
    "heroSummary",
    `${jobs} active job${jobs === 1 ? "" : "s"} live, ${applicantCount} applicant${applicantCount === 1 ? "" : "s"} in your pipeline, ${saved} saved candidate${saved === 1 ? "" : "s"}, and ${unreadMessageCount} unread message${unreadMessageCount === 1 ? "" : "s"}.`
  );
}

function renderActiveJobs() {
  const container = document.getElementById("activeJobsList");
  if (!container) return;

  if (!activeJobs.length) {
    renderEmpty(
      "activeJobsList",
      "No active job posts yet",
      "Publish a role from Manage Jobs so candidates can apply directly through Placely Talent.",
      "Manage Jobs",
      "manage-jobs.html"
    );
    return;
  }

  container.innerHTML = activeJobs.slice(0, 4).map((job) => `
    <article class="job-card">
      <div>
        <h3>${escapeHTML(job.title)}</h3>
        <p class="meta">${escapeHTML(job.location)} &middot; ${escapeHTML(job.type)} &middot; ${escapeHTML(job.pay)}</p>
        <div class="tags">
          <span>Active</span>
          <span>${escapeHTML(formatDate(job.createdAt))}</span>
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
      "Save promising profiles from candidate search to build a shortlist for future outreach.",
      "Find Candidates",
      "find-candidates.html"
    );
    return;
  }

  container.innerHTML = savedCandidates.slice(0, 3).map((candidate) => `
    <article class="candidate-card">
      <div>
        <h3>${escapeHTML(candidate.full_name || "Unnamed Candidate")}</h3>
        <p>${escapeHTML(candidate.trade || "Trade not listed")} &middot; ${escapeHTML(candidate.location || "Location not listed")}</p>
        <div class="tags">
          <span>${escapeHTML(candidate.experience || "Experience not listed")}</span>
          <span>${escapeHTML(candidate.availability || "Availability not listed")}</span>
        </div>
      </div>
    </article>
  `).join("");
}

function renderPipeline() {
  const container = document.getElementById("pipelineList");
  if (!container) return;

  if (!applications.length) {
    renderEmpty(
      "pipelineList",
      "No applicants in review yet",
      "New candidates will appear here as soon as they apply to one of your active jobs.",
      "Open Applicants",
      "employer-applicants.html"
    );
    return;
  }

  container.innerHTML = applications.slice(0, 5).map((app) => {
    const status = normalizeApplicationStatus(app.status);

    return `
      <article class="activity-card">
        <div>
          <h3>${escapeHTML(app.candidate_name || "Candidate")}</h3>
          <p>${escapeHTML(app.candidate_trade || "Trade not listed")} &middot; ${escapeHTML(app.job_title || "Untitled Job")}</p>
          <div class="tags">
            <span>Applied ${escapeHTML(formatDate(app.created_at))}</span>
          </div>
        </div>

        <div class="activity-side">
          <span class="status-pill ${escapeHTML(status)}">${escapeHTML(getStatusLabel(status))}</span>
        </div>
      </article>
    `;
  }).join("");
}

function updateCounts() {
  const submitted = applications.filter((app) => normalizeApplicationStatus(app.status) === "submitted").length;
  const reviewing = applications.filter((app) => normalizeApplicationStatus(app.status) === "reviewing").length;
  const interview = applications.filter((app) => normalizeApplicationStatus(app.status) === "interview").length;

  setText("activeJobsCount", activeJobs.length);
  setText("applicationsCount", applications.length);
  setText("savedCandidatesCount", savedCandidates.length);
  setText("messagesCount", unreadMessageCount);
  setText("newApplicantsCount", submitted);
  setText("reviewingCount", reviewing);
  setText("interviewCount", interview);

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

  activeJobs = (data || [])
    .filter((job) => normalizeJobStatus(job.status) === "active")
    .map((job) => ({
      id: job.id,
      title: job.job_title || "Untitled Job",
      location: job.location || "Location not listed",
      pay: job.pay_range || "Pay not listed",
      type: job.employment_type || "Full-time",
      status: job.status || "active",
      createdAt: job.created_at
    }));
}

async function loadApplications(userId) {
  const { data, error } = await placelySupabase
    .from("applications")
    .select("*")
    .eq("employer_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Load dashboard applications error:", error);
    applications = [];
    return;
  }

  applications = await Promise.all(
    (data || []).map(async (app) => {
      const candidate = await getCandidateProfile(app.candidate_id);

      return {
        ...app,
        candidate_name: candidate?.full_name || app.candidate_name || "Candidate",
        candidate_trade: candidate?.trade || app.candidate_role || "Trade not listed",
        candidate_location: candidate?.location || app.location || "Location not listed"
      };
    })
  );
}

async function getCandidateProfile(candidateId) {
  if (!candidateId) return null;

  const { data, error } = await placelySupabase
    .from("candidate_profiles")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle();

  if (error) {
    console.error("Candidate profile load error:", error);
    return null;
  }

  return data;
}

async function loadSavedCandidates() {
  const savedRows = currentUser ? await loadSavedTalentRows(currentUser.id) : [];
  const savedIds = savedRows.length
    ? savedRows.map((row) => String(row.candidate_id || "").trim()).filter(Boolean)
    : getSavedCandidateIds();

  if (!savedIds.length) {
    savedCandidates = [];
    return;
  }

  const { data, error } = await placelySupabase
    .from("candidate_profiles")
    .select("*")
    .in("id", savedIds)
    .eq("profile_visible", true);

  if (error) {
    console.error("Dashboard saved talent error:", error);
    savedCandidates = [];
    return;
  }

  const rowsByCandidateId = new Map();
  savedRows.forEach((row) => {
    const candidateId = String(row.candidate_id || "").trim();
    if (candidateId && !rowsByCandidateId.has(candidateId)) rowsByCandidateId.set(candidateId, row);
  });

  const savedDates = getSavedDates();

  savedCandidates = (data || [])
    .map((candidate) => ({
      ...candidate,
      saved_at: rowsByCandidateId.get(String(candidate.id))?.created_at || savedDates[String(candidate.id)] || new Date().toISOString()
    }))
    .sort((a, b) => new Date(b.saved_at || 0) - new Date(a.saved_at || 0));
}

async function loadSavedTalentRows(userId) {
  const { data, error } = await placelySupabase
    .from("saved_talent")
    .select("*")
    .eq("employer_id", userId);

  if (error) {
    console.warn("Dashboard saved_talent table load failed; using local cache.", error);
    return [];
  }

  return data || [];
}

async function loadUnreadMessages(userId) {
  const { count, error } = await placelySupabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("employer_id", userId)
    .eq("sender_type", "candidate")
    .eq("read_by_employer", false);

  if (error) {
    console.error("Unread message count error:", error);
    unreadMessageCount = 0;
    return;
  }

  unreadMessageCount = count || 0;
}

async function loadCandidatePreviewPool() {
  const { data, error } = await placelySupabase
    .from("candidate_profiles")
    .select("id, full_name, trade, location, experience, availability, skills, certifications, profile_visible")
    .eq("profile_visible", true)
    .limit(24);

  if (error) {
    console.error("Candidate preview load error:", error);
    candidatePreviewPool = [];
    return;
  }

  candidatePreviewPool = data || [];
}

function getFilteredCandidates() {
  const keyword = (document.getElementById("candidateKeyword")?.value || "").toLowerCase().trim();
  const location = (document.getElementById("candidateLocation")?.value || "").toLowerCase().trim();
  const experience = (document.getElementById("candidateExperience")?.value || "").toLowerCase().trim();

  return candidatePreviewPool.filter((candidate) => {
    const text = [
      candidate.full_name,
      candidate.trade,
      candidate.location,
      candidate.experience,
      candidate.availability,
      candidate.skills,
      candidate.certifications
    ].join(" ").toLowerCase();

    return (
      (!keyword || text.includes(keyword)) &&
      (!location || String(candidate.location || "").toLowerCase().includes(location)) &&
      (!experience || String(candidate.experience || "").toLowerCase().includes(experience))
    );
  });
}

function renderCandidatePreview(results) {
  const container = document.getElementById("candidatePreviewResults");
  if (!container) return;

  if (!candidatePreviewPool.length) {
    container.innerHTML = `
      <strong>No visible candidates yet</strong>
      <p>Candidate previews will appear here once searchable candidate profiles are available.</p>
    `;
    return;
  }

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
    ${results.slice(0, 3).map((candidate) => `
      <div class="preview-candidate">
        <strong>${escapeHTML(candidate.full_name || "Unnamed Candidate")}</strong>
        <span>${escapeHTML(candidate.trade || "Trade not listed")} &middot; ${escapeHTML(candidate.location || "Location not listed")}</span>
        <button type="button" data-save-candidate-id="${escapeHTML(candidate.id)}">
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

async function handleSavePreviewCandidate(candidateId) {
  const candidate = candidatePreviewPool.find((person) => String(person.id) === String(candidateId));
  if (!candidate) return;

  const existingRows = currentUser ? await loadSavedTalentRows(currentUser.id) : [];
  const alreadySaved = existingRows.some((row) => String(row.candidate_id) === String(candidate.id)) ||
    getSavedCandidateIds().includes(String(candidate.id));

  if (alreadySaved) {
    showToast("Candidate is already saved.");
    return;
  }

  if (currentUser) {
    const { error } = await placelySupabase
      .from("saved_talent")
      .insert([{ employer_id: currentUser.id, candidate_id: candidate.id }]);

    if (error) {
      console.error("Dashboard save candidate error:", error);
      showToast("Could not save candidate.");
      return;
    }
  }

  saveCandidateId(candidate.id);
  await loadSavedCandidates();
  renderSavedCandidates();
  updateCounts();
  showToast(`${candidate.full_name || "Candidate"} added to saved talent.`);
}

function renderDashboard() {
  renderActiveJobs();
  renderSavedCandidates();
  renderPipeline();
  updateCounts();
}

async function handleLogout() {
  await placelySupabase.auth.signOut();
  window.location.href = ROUTES.mainLogin;
}

window.handleSavePreviewCandidate = handleSavePreviewCandidate;
window.handleLogout = handleLogout;

async function loadEmployerDashboard() {
  const user = await verifyEmployerAccess(placelySupabase, {
    loginPath: ROUTES.login,
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });

  if (!user) return;
  currentUser = user;

  const { data: employerData, error: employerError } = await placelySupabase
    .from("employer_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (employerError || !employerData) {
    console.error("Employer profile error:", employerError);
    window.location.href = ROUTES.login;
    return;
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
        src="${escapeHTML(employerProfile.company_logo_url)}"
        class="dashboard-company-logo"
        alt="Company logo"
      />
    `;
  } else if (logoBox) {
    logoBox.textContent = getInitials(companyName);
  }

  await Promise.all([
    loadEmployerJobs(user.id),
    loadApplications(user.id),
    loadSavedCandidates(),
    loadUnreadMessages(user.id),
    loadCandidatePreviewPool()
  ]);

  renderDashboard();
}

document.addEventListener("DOMContentLoaded", () => {
  loadEmployerDashboard();

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

  const previewContainer = document.getElementById("candidatePreviewResults");
  if (previewContainer) {
    previewContainer.addEventListener("click", (event) => {
      const button = event.target.closest("[data-save-candidate-id]");
      if (!button) return;
      handleSavePreviewCandidate(button.dataset.saveCandidateId);
    });
  }

  const candidateSearchForm = document.getElementById("candidateSearchForm");
  if (candidateSearchForm) candidateSearchForm.addEventListener("submit", handleCandidateSearch);
});
