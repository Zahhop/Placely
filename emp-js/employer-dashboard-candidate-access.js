const dashboardAccessSupabase = window.employerSupabase;

if (typeof window.loadCandidatePreviewPool === "function") {
  window.loadCandidatePreviewPool = async function () {
    return [];
  };
}

document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click", guardLockedCandidateLinks, true);
  updateDashboardStats();
  setTimeout(updateDashboardStats, 1200);
  setTimeout(updateDashboardStats, 3000);
});

async function startCandidateCheckout() {
  if (!dashboardAccessSupabase) {
    console.error("Employer Supabase client was not initialized.");
    showDashboardAccessToast("Could not start checkout. Please refresh and try again.");
    return;
  }

  const cta = document.getElementById("candidateAccessCta");
  const originalText = cta?.textContent || "Upgrade Access";

  try {
    if (cta) {
      cta.disabled = true;
      cta.classList.add("is-loading");
      cta.textContent = "Opening checkout...";
    }

    const { data, error } = await dashboardAccessSupabase.functions.invoke(
      "create-candidate-checkout",
      {
        body: {
          origin: window.location.origin,
          appPath: getPlacelyAppPath()
        }
      }
    );

    if (error) {
      console.error("Checkout function error:", error);
      const responseBody = await readFunctionErrorBody(error);
      if (responseBody) console.error("Checkout function response body:", responseBody);
      throw new Error(responseBody?.error || error.message || "Unable to start checkout.");
    }

    if (!data?.url) {
      throw new Error(data?.error || "Unable to start checkout.");
    }

    window.location.href = data.url;
  } catch (error) {
    console.error("Candidate checkout failed:", error);
    showDashboardAccessToast(error instanceof Error ? error.message : "Unable to start checkout.");

    if (cta) {
      cta.disabled = false;
      cta.classList.remove("is-loading");
      cta.textContent = originalText;
    }
  }
}

window.startCandidateCheckout = startCandidateCheckout;

async function readFunctionErrorBody(error) {
  try {
    if (!error?.context) return null;
    return await error.context.json();
  } catch {
    return null;
  }
}

function getPlacelyAppPath() {
  return window.location.pathname.startsWith("/Placely/") ? "/Placely" : "";
}

function handleLockedCandidateAction(event) {
  event.preventDefault();
  document.getElementById("candidate-access")?.scrollIntoView({ behavior: "smooth", block: "center" });
  showDashboardAccessToast("Upgrade Candidate Network access before opening candidate search.");
}

function guardLockedCandidateLinks(event) {
  if (window.currentEmployerCandidateAccess === true) return;

  const link = event.target.closest?.('a[href="find-candidates.html"]');
  if (!link) return;

  event.preventDefault();
  document.getElementById("candidate-access")?.scrollIntoView({ behavior: "smooth", block: "center" });
  showDashboardAccessToast("Upgrade Candidate Network access before opening candidate search.");
}

function showDashboardAccessToast(message) {
  const toast = document.getElementById("toast");

  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

function setDashboardAccessText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value || "";
}

async function updateDashboardStats() {
  if (!dashboardAccessSupabase) {
    console.error("Employer Supabase client was not initialized.");
    return;
  }

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
