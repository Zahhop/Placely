const dashboardAccessSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

if (typeof window.loadCandidatePreviewPool === "function") {
  window.loadCandidatePreviewPool = async function () {
    return [];
  };
}

document.addEventListener("DOMContentLoaded", () => {
  refreshDashboardFromSupabase();
  setTimeout(refreshDashboardFromSupabase, 1200);
  setTimeout(refreshDashboardFromSupabase, 3000);
});

async function refreshDashboardFromSupabase() {
  await updateDashboardCandidateAccess();
  await updateDashboardStats();
}

async function updateDashboardCandidateAccess() {
  const freeState = {
    candidate_access: false,
    subscription_status: "free"
  };

  let accessState = freeState;

  try {
    const {
      data: { user },
      error: userError
    } = await dashboardAccessSupabase.auth.getUser();

    if (userError || !user) return;

    const { data, error } = await dashboardAccessSupabase
      .from("employer_profiles")
      .select("candidate_access, subscription_status")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (data) accessState = { ...freeState, ...data };
  } catch (error) {
    console.warn("Dashboard candidate access fields unavailable; defaulting to locked.", error);
  }

  renderDashboardCandidateAccess(hasUnlockedCandidateAccess(accessState));
}

function renderDashboardCandidateAccess(isUnlocked) {
  const cta = document.getElementById("candidateAccessCta");
  const previewCta = document.getElementById("candidatePreviewCta");
  const features = document.getElementById("candidateAccessFeatures");

  setDashboardAccessText(
    "candidateAccessTitle",
    isUnlocked ? "Candidate Access Active" : "Unlock Candidate Network"
  );

  setDashboardAccessText(
    "candidateAccessCopy",
    isUnlocked
      ? "Search the full candidate network, save talent, and message candidates from your recruiter workspace."
      : "Upgrade to search verified trades candidates, view full profiles, save talent, and message candidates."
  );

  if (cta) {
    cta.textContent = isUnlocked ? "Search Candidate Network" : "Upgrade Access";
    cta.href = "find-candidates.html";
  }

  if (previewCta) {
    previewCta.classList.toggle("hidden", isUnlocked);
  }

  if (features) {
    const featureLabels = isUnlocked
      ? ["Full candidate profiles", "Saved talent shortlist", "Candidate messaging"]
      : ["Candidate database", "Full profiles", "Contact + messaging"];

    features.innerHTML = featureLabels
      .map((label) => `<div class="network-feature ${isUnlocked ? "active" : "locked"}"><span>${escapeDashboardAccessHTML(label)}</span></div>`)
      .join("");
  }
}

function hasUnlockedCandidateAccess(profile) {
  return isTruthy(profile?.candidate_access) || cleanAccessValue(profile?.subscription_status) === "active";
}

function isTruthy(value) {
  if (value === true) return true;
  return ["true", "1", "yes", "active"].includes(cleanAccessValue(value));
}

function cleanAccessValue(value) {
  return String(value || "").toLowerCase().trim();
}

function setDashboardAccessText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value || "";
}

async function updateDashboardStats() {
  try {
    const {
      data: { user },
      error: userError
    } = await dashboardAccessSupabase.auth.getUser();

    if (userError || !user) return;

    const jobs = (await safeSelect("jobs", "*", (query) => query.eq("employer_id", user.id))) || [];
    const activeJobs = jobs.filter((job) => normalizeDashboardJobStatus(job.status) === "active");

    setDashboardAccessText("activeJobsCount", activeJobs.length);

    const applications = await loadDashboardApplications(user.id, jobs);
    setDashboardAccessText("applicationsCount", applications.length);

    const savedTalentCount = await loadDashboardSavedTalentCount(user.id);
    setDashboardAccessText("savedCandidatesCount", savedTalentCount);

    const messagesCount = await loadDashboardMessageCount(user.id);
    setDashboardAccessText("messagesCount", messagesCount);
    setDashboardAccessText(
      "heroSummary",
      `${activeJobs.length} active job${activeJobs.length === 1 ? "" : "s"} live, ${applications.length} applicant${applications.length === 1 ? "" : "s"} in your pipeline, ${savedTalentCount} saved candidate${savedTalentCount === 1 ? "" : "s"}, and ${messagesCount} conversation${messagesCount === 1 ? "" : "s"}.`
    );

    renderDashboardPipelineSummary(applications);
  } catch (error) {
    console.warn("Dashboard stat refresh failed gracefully.", error);
  }
}

async function safeSelect(table, columns, buildQuery) {
  try {
    let query = dashboardAccessSupabase.from(table).select(columns);
    if (buildQuery) query = buildQuery(query);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn(`Optional dashboard query failed for ${table}.`, error);
    return null;
  }
}

async function loadDashboardApplications(userId, jobs) {
  const direct = await safeSelect("applications", "*", (query) => query.eq("employer_id", userId));
  if (direct && direct.length) return sortApplicationsByNewest(direct);

  const jobIds = (jobs || []).map((job) => job.id).filter(Boolean);
  if (!jobIds.length) return [];

  const byJobs = await safeSelect("applications", "*", (query) => query.in("job_id", jobIds));
  return sortApplicationsByNewest(byJobs || []);
}

async function loadDashboardSavedTalentCount(userId) {
  const savedTalentRows = await safeSelect("saved_talent", "*", (query) => query.eq("employer_id", userId));
  if (savedTalentRows) return savedTalentRows.length;

  try {
    const saved = JSON.parse(localStorage.getItem("placelySavedCandidates")) || [];
    return saved.length;
  } catch {
    return 0;
  }
}

async function loadDashboardMessageCount(userId) {
  const conversations = await safeSelect("conversations", "*", (query) => query.eq("employer_id", userId));
  if (conversations) return conversations.length;

  // TODO: If conversations are unavailable, use messages as a temporary fallback until inbox schema is standardized.
  const unreadMessages = await safeSelect("messages", "*", (query) =>
    query
      .eq("employer_id", userId)
      .eq("sender_type", "candidate")
      .eq("read_by_employer", false)
  );

  return unreadMessages ? unreadMessages.length : 0;
}

function renderDashboardPipelineSummary(applications) {
  const statuses = applications.map((application) => ({
    ...application,
    normalized_status: normalizeDashboardApplicationStatus(application.status)
  }));

  const countStatus = (status) => statuses.filter((application) => application.normalized_status === status).length;

  setDashboardAccessText("newApplicantsCount", countStatus("submitted"));
  setDashboardAccessText("reviewingCount", countStatus("reviewing"));
  setDashboardAccessText("interviewCount", countStatus("interview"));
  setDashboardAccessText("offerCount", countStatus("offer"));
  setDashboardAccessText("hiredCount", countStatus("hired"));

  const rejectedCount = countStatus("rejected");
  setDashboardAccessText("rejectedCountText", rejectedCount ? `${rejectedCount} rejected applicant${rejectedCount === 1 ? "" : "s"} archived outside the main pipeline.` : "");

  const container = document.getElementById("pipelineList");
  if (!container) return;

  const actionable = statuses
    .filter((application) => application.normalized_status !== "rejected")
    .slice(0, 5);

  if (!actionable.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>No applicants need attention</strong>
        <p>New applicants and active hiring stages will appear here.</p>
        <a href="employer-applicants.html" class="empty-action">Review applicants</a>
      </div>
    `;
    return;
  }

  container.innerHTML = actionable.map((application) => {
    const status = application.normalized_status;
    const candidate = application.candidate_name || application.full_name || "Candidate";
    const trade = application.candidate_trade || application.candidate_role || application.trade || "Trade not listed";
    const job = application.job_title || application.title || "Untitled Job";

    return `
      <article class="activity-card">
        <div>
          <h3>${escapeDashboardAccessHTML(candidate)}</h3>
          <p>${escapeDashboardAccessHTML(trade)} &middot; ${escapeDashboardAccessHTML(job)}</p>
          <div class="tags">
            <span>Applied ${escapeDashboardAccessHTML(formatDashboardDate(application.created_at))}</span>
          </div>
        </div>
        <div class="activity-side">
          <span class="status-pill ${escapeDashboardAccessHTML(status)}">${escapeDashboardAccessHTML(getDashboardStatusLabel(status))}</span>
        </div>
      </article>
    `;
  }).join("");
}

function sortApplicationsByNewest(applications) {
  return [...applications].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

function normalizeDashboardApplicationStatus(status) {
  const value = String(status || "submitted").toLowerCase().trim();
  if (["applied", "submitted", "new"].includes(value)) return "submitted";
  if (["review", "reviewing", "viewed", "in review"].includes(value)) return "reviewing";
  if (["interview", "interviewing", "interview requested"].includes(value)) return "interview";
  if (["offer", "offered"].includes(value)) return "offer";
  if (["hired"].includes(value)) return "hired";
  if (["rejected", "declined"].includes(value)) return "rejected";
  return "submitted";
}

function getDashboardStatusLabel(status) {
  return {
    submitted: "New",
    reviewing: "Reviewing",
    interview: "Interview",
    offer: "Offer",
    hired: "Hired",
    rejected: "Rejected"
  }[status] || "New";
}

function formatDashboardDate(value) {
  if (!value) return "recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function normalizeDashboardJobStatus(status) {
  const value = String(status || "active").toLowerCase().trim();
  return ["paused", "inactive", "closed"].includes(value) ? "paused" : "active";
}

function escapeDashboardAccessHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
