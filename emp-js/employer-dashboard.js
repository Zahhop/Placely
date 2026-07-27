const placelySupabase = window.employerSupabase;

const ROUTES = {
  login: "employer-login.html",
  mainLogin: "../public/login.html",
  profile: "employer-profile.html"
};

const ARCHIVED_APPLICATION_STATUSES = ["rejected", "withdrawn", "candidate_deleted"];

let currentUser = null;
let employerProfile = {};
let employerJobs = [];
let activeJobs = [];
let applications = [];
let activeApplications = [];
let savedCandidates = [];
let conversations = [];
let latestMessages = [];
let unreadMessageCount = 0;
let sectionErrors = {};
let hasCandidateNetworkAccess = false;

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "";
}

function showToast(message) {
  const toast = document.getElementById("toast");

  if (!toast) {
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHTML(value).replaceAll("`", "&#096;");
}

function plural(count, singular, pluralLabel) {
  return `${count} ${count === 1 ? singular : pluralLabel || `${singular}s`}`;
}

function getInitials(name) {
  const initials = String(name || "PT")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "PT";
}

function getSafeImageUrl(value, bucket = "") {
  const url = String(value || "").trim();
  if (!url) return "";

  const lowered = url.toLowerCase();
  if (["null", "undefined", "none"].includes(lowered)) return "";
  if (lowered.startsWith("javascript:")) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (!/^https?:\/\//i.test(url) && bucket) {
    return window.PlacelyAuth?.getPublicImageUrl?.(placelySupabase, bucket, url) || "";
  }

  return url;
}

function renderAvatarMarkup(name, photoUrl, className = "avatar", altText = "") {
  const initials = getInitials(name);
  const safePhotoUrl = getSafeImageUrl(photoUrl, "candidate_photos");
  const fallback = `<span class="avatar-fallback">${escapeHTML(initials)}</span>`;

  if (!safePhotoUrl) {
    return `<span class="${escapeAttribute(className)}">${fallback}</span>`;
  }

  return `
    <span class="${escapeAttribute(className)}">
      ${fallback}
      <img src="${escapeAttribute(safePhotoUrl)}" alt="${escapeAttribute(altText || `${name || "Candidate"} photo`)}" loading="lazy" decoding="async" data-avatar-image>
    </span>
  `;
}

function normalizeJobStatus(status) {
  const value = String(status || "active").toLowerCase().trim();
  return ["paused", "inactive", "closed", "archived", "deleted"].includes(value) ? "paused" : "active";
}

function normalizeApplicationStatus(status) {
  const value = String(status || "submitted").toLowerCase().trim();

  if (["new", "applied", "submitted"].includes(value)) return "submitted";
  if (["review", "reviewing", "viewed", "in review", "under_review"].includes(value)) return "reviewing";
  if (["interview", "interviewing", "interview requested"].includes(value)) return "interview";
  if (["offer", "offered"].includes(value)) return "offer";
  if (["hired", "accepted"].includes(value)) return "hired";
  if (["rejected", "declined"].includes(value)) return "rejected";
  if (["withdrawn", "withdraw", "candidate_withdrew"].includes(value)) return "withdrawn";
  if (["candidate_deleted", "candidate_profile_deleted", "deleted"].includes(value)) return "candidate_deleted";

  return "submitted";
}

function getStatusLabel(status) {
  return {
    submitted: "New",
    reviewing: "Reviewing",
    interview: "Interview",
    offer: "Offer",
    hired: "Hired",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
    candidate_deleted: "Candidate Profile Deleted"
  }[status] || "New";
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

function formatRelativeDate(value, prefix = "") {
  if (!value) return prefix ? `${prefix} recently` : "Recently";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return prefix ? `${prefix} recently` : "Recently";

  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  const lead = prefix ? `${prefix} ` : "";

  if (days <= 0) return `${lead}today`;
  if (days === 1) return `${lead}yesterday`;
  if (days < 30) return `${lead}${days} days ago`;
  return `${lead}${formatDate(value)}`;
}

function renderEmpty(containerId, title, text, actionText, actionHref) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M9 6V5a3 3 0 0 1 3-3h1a3 3 0 0 1 3 3v1h3a2 2 0 0 1 2 2v10.5A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5V8a2 2 0 0 1 2-2h4Zm2 0h3V5a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1v1Z"/></svg>
      </span>
      <span class="empty-copy">
      <strong>${escapeHTML(title)}</strong>
      <p>${escapeHTML(text)}</p>
      </span>
      ${actionText ? `<a href="${escapeAttribute(actionHref)}" class="empty-action">${escapeHTML(actionText)}</a>` : ""}
    </div>
  `;
}

function renderSectionError(containerId, title, text, retryAction) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="empty-state error-state">
      <strong>${escapeHTML(title)}</strong>
      <p>${escapeHTML(text)}</p>
      ${retryAction ? `<button type="button" class="empty-action" data-dashboard-retry="${escapeAttribute(retryAction)}">Retry</button>` : ""}
    </div>
  `;
}

async function guardedLoad(key, loader) {
  try {
    sectionErrors[key] = null;
    await loader();
  } catch (error) {
    sectionErrors[key] = error;
  }
}

async function loadEmployerProfile(userId) {
  const { data, error } = await placelySupabase
    .from("employer_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    throw error || new Error("Employer profile was not found.");
  }

  employerProfile = data;
}

async function loadEmployerJobs(userId) {
  const { data, error } = await placelySupabase
    .from("jobs")
    .select("*")
    .eq("employer_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  employerJobs = data || [];
  activeJobs = employerJobs.filter((job) => normalizeJobStatus(job.status) === "active");
}

async function loadApplications(userId) {
  let rows = [];
  let directError = null;

  const direct = await placelySupabase
    .from("applications")
    .select("*")
    .eq("employer_id", userId)
    .order("created_at", { ascending: false });

  if (direct.error) {
    directError = direct.error;
  } else {
    rows = direct.data || [];
  }

  const jobIds = employerJobs.map((job) => job.id).filter(Boolean);
  if (!rows.length && jobIds.length) {
    const byJobs = await placelySupabase
      .from("applications")
      .select("*")
      .in("job_id", jobIds)
      .order("created_at", { ascending: false });

    if (byJobs.error) throw directError || byJobs.error;
    rows = byJobs.data || [];
  } else if (directError && !jobIds.length) {
    throw directError;
  }

  const allowedJobIds = new Set(jobIds.map(String));
  const scopedRows = rows.filter((app) => {
    if (app.employer_id && String(app.employer_id) === String(userId)) return true;
    return app.job_id && allowedJobIds.has(String(app.job_id));
  });

  applications = await hydrateApplications(scopedRows);
  activeApplications = applications.filter((app) => !ARCHIVED_APPLICATION_STATUSES.includes(app.normalized_status));
}

async function hydrateApplications(rows) {
  if (!rows.length) return [];

  const candidateIds = [...new Set(rows.map((app) => app.candidate_id).filter(Boolean))];
  const candidatesById = await loadCandidateProfiles(candidateIds);
  const jobsById = new Map(employerJobs.map((job) => [String(job.id), job]));

  return rows.map((app) => {
    const snapshot = parseSnapshot(app.candidate_snapshot);
    const candidate = candidatesById[String(app.candidate_id || "")] || {};
    const job = jobsById.get(String(app.job_id || "")) || {};
    const status = normalizeApplicationStatus(app.status || app.employer_status);

    return {
      ...app,
      normalized_status: status,
      job_title: app.job_title || job.job_title || "Untitled Job",
      job_location: job.location || app.location || "Location not listed",
      employment_type: job.employment_type || app.employment_type || "Type not listed",
      candidate_name: snapshot.full_name || app.candidate_name || candidate.full_name || "Candidate profile",
      candidate_trade: snapshot.trade || app.candidate_role || candidate.trade || "Trade not provided",
      candidate_location: snapshot.location || app.location || candidate.location || "Location not listed",
      candidate_photo: snapshot.profile_photo_url || snapshot.avatar_url || candidate.profile_photo_url || "",
      updated_at: app.updated_at || app.reviewed_at || app.created_at
    };
  });
}

async function loadCandidateProfiles(candidateIds) {
  if (!candidateIds.length) return {};

  const { data, error } = await placelySupabase
    .from("candidate_profiles")
    .select("id, full_name, trade, location, profile_photo_url")
    .in("id", candidateIds);

  if (error) {
    return {};
  }

  return Object.fromEntries((data || []).map((candidate) => [String(candidate.id), candidate]));
}

async function loadSavedCandidates(userId) {
  const savedRows = await loadSavedTalentRows(userId);
  const candidateIds = [
    ...new Set([
      ...savedRows.map((row) => String(row.candidate_id || "").trim()).filter(Boolean)
    ])
  ];

  if (!candidateIds.length) {
    savedCandidates = [];
    return;
  }

  const { data, error } = await placelySupabase
    .from("candidate_profiles")
    .select("id, full_name, trade, location, experience, availability, profile_photo_url, profile_visible")
    .in("id", candidateIds)
    .eq("profile_visible", true);

  if (error) throw error;

  const savedRowsByCandidateId = new Map();
  savedRows.forEach((row) => {
    const candidateId = String(row.candidate_id || "").trim();
    if (candidateId && !savedRowsByCandidateId.has(candidateId)) savedRowsByCandidateId.set(candidateId, row);
  });

  const savedDates = getSavedDates();
  savedCandidates = (data || [])
    .map((candidate) => ({
      ...candidate,
      saved_at: savedRowsByCandidateId.get(String(candidate.id))?.created_at || savedDates[String(candidate.id)] || ""
    }))
    .sort((a, b) => new Date(b.saved_at || 0) - new Date(a.saved_at || 0));
}

async function loadSavedTalentRows(userId) {
  const { data, error } = await placelySupabase
    .from("saved_talent")
    .select("*")
    .eq("employer_id", userId);

  if (error) {
    return [];
  }

  return data || [];
}

async function loadConversationsAndMessages(userId) {
  const { data, error } = await placelySupabase
    .from("conversations")
    .select("*")
    .eq("employer_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  conversations = data || [];

  const { data: messagesData, error: messagesError } = await placelySupabase
    .from("messages")
    .select("id, conversation_id, candidate_id, candidate_name, candidate_role, message, sender_type, created_at")
    .eq("employer_id", userId)
    .neq("sender_type", "employer")
    .order("created_at", { ascending: false })
    .limit(30);

  if (messagesError) {
    latestMessages = [];
  } else {
    latestMessages = await hydrateMessageCandidates(messagesData || []);
  }

  const { count, error: countError } = await placelySupabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("employer_id", userId)
    .neq("sender_type", "employer")
    .eq("read_by_employer", false);

  if (countError) {
    unreadMessageCount = 0;
    return;
  }

  unreadMessageCount = count || 0;
}

async function hydrateMessageCandidates(messages) {
  const candidateIds = [...new Set(messages.map((message) => message.candidate_id).filter(Boolean))];
  if (!candidateIds.length) return messages;

  const { data, error } = await placelySupabase
    .from("candidate_profiles")
    .select("id, full_name, trade")
    .in("id", candidateIds);

  if (error) {
    return messages;
  }

  const profilesById = new Map((data || []).map((profile) => [String(profile.id), profile]));

  return messages.map((message) => {
    const profile = profilesById.get(String(message.candidate_id || "")) || {};
    return {
      ...message,
      candidate_name: profile.full_name || message.candidate_name,
      candidate_role: profile.trade || message.candidate_role
    };
  });
}

function getLocalSavedCandidateIds() {
  try {
    const saved = JSON.parse(localStorage.getItem("placelySavedCandidates")) || [];
    return saved.map((item) => typeof item === "object" ? String(item.id || "") : String(item)).filter(Boolean);
  } catch {
    return [];
  }
}

function getSavedDates() {
  try {
    return JSON.parse(localStorage.getItem("placelySavedCandidateDates")) || {};
  } catch {
    return {};
  }
}

function parseSnapshot(snapshot) {
  if (!snapshot) return {};
  if (typeof snapshot === "object") return snapshot;

  try {
    return JSON.parse(snapshot);
  } catch {
    return {};
  }
}

function updateCompanyChrome() {
  const companyName = employerProfile.company_name || "Employer";
  const initials = getInitials(companyName);
  const accountEmail = employerProfile.company_email || currentUser?.email || "";

  setText("companyNameTitle", companyName);
  setText("topCompanyName", companyName);
  setText("dashboardGreeting", getTimeGreeting());

  renderCompanyAvatar("topCompanyAvatar", companyName, initials);
  window.updateEmployerAccountMenu?.({
    companyName,
    companyEmail: employerProfile.company_email || "",
    email: accountEmail
  });
}

function renderCompanyAvatar(id, companyName, initials) {
  const avatar = document.getElementById(id);
  if (!avatar) return;

  const logoUrl = employerProfile.company_logo_url
    || employerProfile.company_photo_url
    || employerProfile.logo_url
    || employerProfile.profile_photo_url
    || "";

  avatar.innerHTML = renderAvatarInner(companyName, logoUrl, `${companyName} logo`, initials);
}

function renderAvatarInner(name, photoUrl, altText, fallbackInitials) {
  const initials = fallbackInitials || getInitials(name);
  const safePhotoUrl = getSafeImageUrl(photoUrl, "employer-logos");
  const fallback = `<span class="avatar-fallback">${escapeHTML(initials)}</span>`;

  if (!safePhotoUrl) return fallback;

  return `${fallback}<img src="${escapeAttribute(safePhotoUrl)}" alt="${escapeAttribute(altText)}" loading="lazy" decoding="async" data-avatar-image>`;
}

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function updateHeroSummary() {
  if (!hasCandidateNetworkAccess) {
    setText(
      "heroSummary",
      "You're ready to hire. Create your first job posting to begin receiving qualified applicants."
    );

    const primary = document.getElementById("primaryDashboardAction");
    const secondary = document.getElementById("secondaryDashboardAction");

    if (primary) {
      primary.href = "manage-jobs.html?view=create";
      primary.textContent = "Post Job";
    }

    if (secondary) {
      secondary.removeAttribute("data-upgrade-action");
      secondary.href = "employer-profile.html";
      secondary.textContent = "Complete Profile";
    }

    return;
  }

  const reviewCount = getStageCount("submitted");
  const messagePart = unreadMessageCount > 0
    ? plural(unreadMessageCount, "unread message")
    : conversations.length
      ? plural(conversations.length, "active conversation")
      : "no active conversations";

  if (!activeJobs.length && !activeApplications.length && !unreadMessageCount) {
    setText(
      "heroSummary",
      "Post your first role to begin receiving applications."
    );
  } else if (reviewCount) {
    setText(
      "heroSummary",
      `You have ${plural(reviewCount, "new applicant")} to review and ${messagePart}.`
    );
  } else {
    setText(
      "heroSummary",
      activeJobs.length
        ? hasCandidateNetworkAccess
          ? `No new applicants are waiting for first review. You have ${messagePart}.`
          : "Your active roles are live. New applicants will appear here."
        : `No new applicants are waiting for first review. You have ${messagePart}.`
    );
  }

  const primary = document.getElementById("primaryDashboardAction");
  const secondary = document.getElementById("secondaryDashboardAction");

  if (primary) {
    primary.href = reviewCount ? "employer-applicants.html" : activeJobs.length ? "manage-jobs.html" : "manage-jobs.html?view=create";
    primary.textContent = hasCandidateNetworkAccess
      ? reviewCount ? "Review Applicants" : activeJobs.length ? "Manage Jobs" : "Post a Job"
      : reviewCount ? "REVIEW APPLICANTS" : activeJobs.length ? "MANAGE JOBS" : "POST A JOB";
  }

  if (secondary) {
    secondary.removeAttribute("data-upgrade-action");
    secondary.href = reviewCount
      ? "manage-jobs.html"
      : hasCandidateNetworkAccess
        ? "find-candidates.html"
        : "employer-profile.html";
    secondary.textContent = hasCandidateNetworkAccess
      ? reviewCount ? "Manage Jobs" : "Find Candidates"
      : reviewCount ? "MANAGE JOBS" : "COMPANY PROFILE";
  }
}

function getStageCount(status) {
  return activeApplications.filter((app) => app.normalized_status === status).length;
}

function updateCounts() {
  setText("activeJobsCount", activeJobs.length);
  setText("applicationsCount", getStageCount("submitted"));
  setText("interviewsCount", getStageCount("interview"));
  setText("messagesCount", conversations.length);
  setText("newApplicantsCount", getStageCount("submitted"));
  setText("reviewingCount", getStageCount("reviewing"));
  setText("interviewCount", getStageCount("interview"));
  setText("offerCount", getStageCount("offer"));
  setText("hiredCount", getStageCount("hired"));

  setText("activeJobsContext", activeJobs.length ? plural(activeJobs.length, "live role") : "No live roles");
  setText("applicationsContext", getStageCount("submitted") ? "Awaiting first review" : "No new applicants");
  setText("interviewsContext", getStageCount("interview") ? "In progress" : "No interviews yet");
  setText(
    "messagesContext",
    unreadMessageCount
      ? plural(unreadMessageCount, "unread message")
      : conversations.length
        ? "Active threads"
        : "No active conversations"
  );

  const unreadBadge = document.getElementById("topUnreadBadge");
  if (unreadBadge) {
    unreadBadge.hidden = unreadMessageCount <= 0;
    unreadBadge.textContent = hasCandidateNetworkAccess && unreadMessageCount > 9
      ? "9+"
      : unreadMessageCount > 99 ? "99+" : String(unreadMessageCount);
  }

  const notificationBadge = document.getElementById("topNotificationBadge");
  if (notificationBadge) {
    const attentionCount = getStageCount("submitted");
    notificationBadge.hidden = !hasCandidateNetworkAccess || attentionCount <= 0;
    notificationBadge.textContent = attentionCount > 9 ? "9+" : String(attentionCount);
  }

  const archivedCount = applications.filter((app) => ARCHIVED_APPLICATION_STATUSES.includes(app.normalized_status)).length;
  setText(
    "rejectedCountText",
    archivedCount ? `${plural(archivedCount, "archived applicant")} excluded from the active pipeline.` : ""
  );

  updateHeroSummary();
}

function renderPipeline() {
  if (sectionErrors.applications) {
    setText("pipelineQueueText", "Applicant queue unavailable");
    renderSectionError(
      "pipelineList",
      "Could not load applicants",
      "Your jobs and other dashboard sections are still available.",
      "applications"
    );
    return;
  }

  if (!activeApplications.length) {
    const container = document.getElementById("pipelineList");
    if (container) {
      container.dataset.previewCount = "0";
      container.dataset.actionableCount = "0";
    }
    setText("pipelineQueueText", "");
    renderEmpty(
      "pipelineList",
      hasCandidateNetworkAccess ? "No applicants are waiting for review." : "No applicants yet",
      hasCandidateNetworkAccess
        ? "New applicants from your active jobs will appear here."
        : "Publish your first job to begin receiving applications.",
      hasCandidateNetworkAccess
        ? activeJobs.length ? "Open Jobs" : "Post Job"
        : "Post Job",
      hasCandidateNetworkAccess && activeJobs.length ? "manage-jobs.html" : "manage-jobs.html?view=create"
    );
    return;
  }

  const actionableApplications = activeApplications.filter((app) => app.normalized_status !== "hired");
  const priority = actionableApplications
    .sort(sortApplicationsByPriority)
    .slice(0, hasCandidateNetworkAccess ? 3 : 5);

  const container = document.getElementById("pipelineList");
  if (!container) return;
  container.dataset.previewCount = String(priority.length);
  container.dataset.actionableCount = String(actionableApplications.length);

  if (!priority.length) {
    container.dataset.previewCount = "0";
    container.dataset.actionableCount = String(actionableApplications.length);
    setText("pipelineQueueText", "No active applicants need action.");
    renderEmpty(
      "pipelineList",
      "No active decisions pending",
      "Hired applicants are counted in outcomes, but they are not shown as needing review.",
      "OPEN APPLICANTS",
      "employer-applicants.html"
    );
    return;
  }

  setText("pipelineQueueText", `${plural(actionableApplications.length, "applicant")} waiting for your review.`);

  const rows = priority.map((app) => {
    const status = app.normalized_status;
    const actionLabel = getApplicantActionLabel(status);
    const applicantHref = app.job_id
      ? `employer-applicants.html?job=${encodeURIComponent(app.job_id)}`
      : "employer-applicants.html";

    return `
      <article class="list-row">
        <div class="row-main">
          ${renderAvatarMarkup(app.candidate_name, app.candidate_photo, "avatar", `${getPersonDisplayName(app.candidate_name)} profile photo`)}
          <div>
            <h3 class="row-title">${escapeHTML(getPersonDisplayName(app.candidate_name))}</h3>
            <p class="row-detail">${
              hasCandidateNetworkAccess
                ? `${escapeHTML(app.candidate_trade)} <span aria-hidden="true">&middot;</span> ${escapeHTML(app.job_title)}`
                : `${escapeHTML(app.job_title)} - ${escapeHTML(app.candidate_trade)}`
            }</p>
            <div class="row-meta">
              <span>${escapeHTML(formatRelativeDate(app.created_at, "Applied"))}</span>
              <span class="status-pill ${escapeAttribute(status)}">${escapeHTML(getStatusLabel(status))}</span>
            </div>
          </div>
        </div>
        <div class="row-side">
          <a href="${escapeAttribute(applicantHref)}" class="row-action ${status === "submitted" ? "primary" : ""}">${escapeHTML(actionLabel)}</a>
        </div>
      </article>
    `;
  }).join("");

  const overflowLink = hasCandidateNetworkAccess && actionableApplications.length > priority.length
    ? `<a class="pipeline-overflow-link" href="employer-applicants.html">View all ${escapeHTML(actionableApplications.length)} applicants</a>`
    : "";

  container.innerHTML = `${rows}${overflowLink}`;
}

function getApplicantActionLabel(status) {
  return {
    submitted: "Review",
    reviewing: "Continue review",
    interview: "Open applicant",
    offer: "Review offer",
    hired: "View"
  }[status] || "Open applicant";
}

function sortApplicationsByPriority(a, b) {
  const priority = {
    submitted: 0,
    interview: 1,
    offer: 2,
    reviewing: 3,
    hired: 4
  };

  const priorityDelta = (priority[a.normalized_status] ?? 9) - (priority[b.normalized_status] ?? 9);
  if (priorityDelta !== 0) return priorityDelta;

  return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
}

function renderActiveJobs() {
  if (sectionErrors.jobs) {
    renderSectionError(
      "activeJobsList",
      "Could not load jobs",
      "Refresh the dashboard or open Manage Jobs to review your postings.",
      "jobs"
    );
    return;
  }

  if (!activeJobs.length) {
    renderEmpty(
      "activeJobsList",
      hasCandidateNetworkAccess ? "You have no active job posts" : "No active jobs",
      hasCandidateNetworkAccess
        ? "Post a role to begin receiving applications."
        : "Create your first job posting to begin receiving applicants.",
      "Post Job",
      "manage-jobs.html?view=create"
    );
    return;
  }

  const countsByJob = getApplicationCountsByJob();
  const container = document.getElementById("activeJobsList");
  if (!container) return;

  const visibleJobs = activeJobs.slice(0, 5);
  const rows = visibleJobs.map((job) => {
    const jobId = String(job.id || "");
    const activeCount = countsByJob[jobId]?.active || 0;
    const newCount = countsByJob[jobId]?.newCount || 0;
    const manageHref = job.id ? `edit-jobs.html?id=${encodeURIComponent(job.id)}` : "manage-jobs.html";
    const applicantsHref = job.id ? `employer-applicants.html?job=${encodeURIComponent(job.id)}` : "employer-applicants.html";

    return `
      <tr>
        <td class="job-title-cell">
          <strong>${escapeHTML(job.job_title || "Untitled Job")}</strong>
          <span class="job-subtle">${escapeHTML(
            hasCandidateNetworkAccess
              ? plural(newCount, "new application")
              : newCount ? plural(newCount, "new application") : "No new applications"
          )}</span>
        </td>
        <td>${escapeHTML(job.location || "Location not listed")}</td>
        <td>${escapeHTML(job.employment_type || "Type not listed")}</td>
        <td>${escapeHTML(activeCount)}</td>
        <td>${escapeHTML(newCount)}</td>
        <td>${escapeHTML(formatRelativeDate(job.created_at, "Posted"))}</td>
        <td><span class="job-status active">Active</span></td>
        <td>
          <div class="job-actions">
            <a href="${escapeAttribute(applicantsHref)}" class="row-action primary">View Applicants</a>
            <a href="${escapeAttribute(manageHref)}" class="row-action">Manage</a>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  container.innerHTML = `
    <div class="job-table-wrap">
      <table class="job-table">
        <colgroup>
          <col class="job-col-title">
          <col class="job-col-location">
          <col class="job-col-type">
          <col class="job-col-count">
          <col class="job-col-count">
          <col class="job-col-posted">
          <col class="job-col-status">
          <col class="job-col-actions">
        </colgroup>
        <thead>
          <tr>
            <th>Job</th>
            <th>Location</th>
            <th>Type</th>
            <th>Applicants</th>
            <th>New</th>
            <th>Posted</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="job-table-footer">
        <span>Showing 1 to ${escapeHTML(visibleJobs.length)} of ${escapeHTML(activeJobs.length)} ${activeJobs.length === 1 ? "job" : "jobs"}</span>
      </div>
    </div>
  `;
}

function getApplicationCountsByJob() {
  return activeApplications.reduce((map, app) => {
    const jobId = String(app.job_id || "");
    if (!jobId) return map;
    if (!map[jobId]) map[jobId] = { active: 0, newCount: 0 };
    map[jobId].active += 1;
    if (app.normalized_status === "submitted") map[jobId].newCount += 1;
    return map;
  }, {});
}

function renderRecentActivity() {
  const container = document.getElementById("recentActivityList");
  if (!container) return;

  if (sectionErrors.applications && sectionErrors.jobs && sectionErrors.messages && sectionErrors.saved) {
    renderSectionError("recentActivityList", "Could not load activity", "The rest of your dashboard is still available.", null);
    return;
  }

  const activity = buildRecentActivity().slice(0, 5);

  if (!activity.length) {
    if (!hasCandidateNetworkAccess) {
      renderEmpty(
        "recentActivityList",
        "No activity yet",
        "Your hiring activity will appear here.",
        "Post Job",
        "manage-jobs.html?view=create"
      );
      return;
    }

    container.innerHTML = `
      <div class="empty-state">
        <strong>${hasCandidateNetworkAccess ? "No recent activity yet" : "No activity yet"}</strong>
        <p>${hasCandidateNetworkAccess ? "Applications, messages, and job activity will appear here." : "Your hiring activity will appear here."}</p>
        ${hasCandidateNetworkAccess && activeJobs.length ? "" : `<a href="manage-jobs.html?view=create" class="empty-action">Post Job</a>`}
      </div>
    `;
    return;
  }

  container.innerHTML = activity.map((item) => `
    <a class="activity-item" href="${escapeAttribute(item.href)}">
      <span class="activity-icon" aria-hidden="true">${escapeHTML(item.icon || getInitials(item.title))}</span>
      <span class="activity-copy">
        <strong>${escapeHTML(item.title)}</strong>
        <span class="activity-context">${escapeHTML(item.detail)}</span>
      </span>
      <span class="activity-time">${escapeHTML(formatRelativeDate(item.date))}</span>
    </a>
  `).join("");
}

function applyPlanChrome() {
  const plan = hasCandidateNetworkAccess ? "pro" : "free";
  document.body.dataset.plan = plan;
  window.currentEmployerCandidateAccess = hasCandidateNetworkAccess;

  const shell = document.querySelector(".employer-shell");
  if (shell) shell.dataset.plan = plan;

  document.querySelectorAll("[data-plan-gated='candidate-network']").forEach((link) => {
    link.classList.toggle("is-locked", !hasCandidateNetworkAccess);
    link.setAttribute("aria-disabled", hasCandidateNetworkAccess ? "false" : "true");
    link.setAttribute(
      "aria-label",
      hasCandidateNetworkAccess
        ? link.textContent.trim()
        : `${link.textContent.trim()} requires Pro`
    );
  });

  const candidateNetworkPanel = document.getElementById("candidateNetworkPanel");
  if (candidateNetworkPanel) candidateNetworkPanel.hidden = false;

  const freeUpgradePanel = document.getElementById("freeUpgradePanel");
  if (freeUpgradePanel) freeUpgradePanel.hidden = true;

  renderSidebarPlanCard();
  renderCandidateNetworkPanel();
}

function renderSidebarPlanCard() {
  const card = document.getElementById("sidebarPlanCard");
  if (!card) return;

  if (hasCandidateNetworkAccess) {
    card.hidden = true;
    card.replaceChildren();
    card.className = "sidebar-plan-card";
    return;
  }

  card.hidden = false;
  card.className = "sidebar-plan-card free";
  card.innerHTML = `
    <span class="plan-kicker">GET ACCESS</span>
    <h2>Unlock candidate search</h2>
    <p>Unlock:</p>
    <ul class="plan-feature-list">
      <li>Candidate Search</li>
      <li>Direct Messaging</li>
      <li>Saved Talent</li>
      <li>Talent Pipeline</li>
    </ul>
    <button type="button" class="plan-card-action" data-upgrade-action>Get Access</button>
  `;
}

function renderCandidateNetworkPanel() {
  const panel = document.getElementById("candidateNetworkPanel");
  if (!panel) return;

  panel.hidden = false;

  const eyebrow = panel.querySelector(".panel-eyebrow");
  const title = panel.querySelector("#candidateNetworkTitle");
  const description = panel.querySelector(".section-heading p");
  const featureLabels = panel.querySelectorAll(".candidate-network-features span");
  const action = panel.querySelector(".network-action");

  if (eyebrow) eyebrow.textContent = hasCandidateNetworkAccess ? "Pro" : "Free";
  if (title) title.textContent = "Candidate network";
  if (description) {
    description.textContent = hasCandidateNetworkAccess
      ? "Browse and connect with pre-screened candidates."
      : "Unlock instant access to verified skilled trades professionals.";
  }

  const labels = hasCandidateNetworkAccess
    ? ["Advanced search and filters", "Direct messaging", "Save top candidates", "Build your talent pipeline"]
    : ["Advanced candidate search", "Direct messaging", "Saved Talent", "Talent Pipeline"];

  featureLabels.forEach((label, index) => {
    label.textContent = labels[index] || label.textContent;
  });

  if (action) {
    action.textContent = hasCandidateNetworkAccess ? "Search Candidates" : "Get Access";
    action.href = hasCandidateNetworkAccess ? "find-candidates.html" : "#";
    action.toggleAttribute("data-upgrade-action", !hasCandidateNetworkAccess);
  }
}

function buildRecentActivity() {
  const applicantEvents = applications.map((app) => ({
    type: "application",
    icon: getInitials(app.candidate_name),
    title: `${getPersonDisplayName(app.candidate_name)} applied to ${app.job_title}`,
    detail: app.candidate_trade || "Application received",
    date: app.created_at,
    href: app.job_id ? `employer-applicants.html?job=${encodeURIComponent(app.job_id)}` : "employer-applicants.html"
  }));

  const jobEvents = employerJobs.map((job) => ({
    type: "job",
    icon: "J",
    title: `${job.job_title || "Untitled Job"} was posted`,
    detail: [job.location, job.employment_type].filter(Boolean).join(" - ") || "Job posting",
    date: job.created_at,
    href: job.id ? `edit-jobs.html?id=${encodeURIComponent(job.id)}` : "manage-jobs.html"
  }));

  const savedEvents = savedCandidates.map((candidate) => ({
    type: "saved",
    icon: getInitials(candidate.full_name),
    title: `${getPersonDisplayName(candidate.full_name)} was saved`,
    detail: [candidate.trade, candidate.location].filter(Boolean).join(" - ") || "Saved candidate",
    date: candidate.saved_at,
    href: "saved-talent.html"
  }));

  const messageEvents = getGroupedMessageEvents();

  const sortedActivity = [...applicantEvents, ...jobEvents, ...savedEvents, ...messageEvents]
    .filter((item) => item.date)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  if (!hasCandidateNetworkAccess) return sortedActivity;

  const seen = new Set();
  return sortedActivity.filter((item) => {
    const key = [item.type, item.title, item.detail, item.href].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getGroupedMessageEvents() {
  const groups = new Map();

  latestMessages.forEach((message) => {
    const key = String(message.conversation_id || message.candidate_id || message.id || "");
    if (!key) return;

    const current = groups.get(key) || {
      count: 0,
      latest: message,
      messages: []
    };

    current.count += 1;
    current.messages.push(message);
    if (new Date(message.created_at || 0) > new Date(current.latest?.created_at || 0)) {
      current.latest = message;
    }
    groups.set(key, current);
  });

  return [...groups.values()].map((group) => {
    const message = group.latest || {};
    const displayName = getPersonDisplayName(message.candidate_name);
    return {
      type: "message",
      icon: getInitials(displayName),
      title: group.count > 1
        ? `${displayName} sent ${group.count} messages`
        : `${displayName} sent a message`,
      detail: message.candidate_role || truncateActivityDetail(message.message) || "Candidate conversation",
      date: message.created_at,
      href: message.conversation_id ? `employer-messages.html?conversation=${encodeURIComponent(message.conversation_id)}` : "employer-messages.html"
    };
  });
}

function getPersonDisplayName(value) {
  const text = String(value || "").trim();
  if (!text) return "Candidate";

  if (text.includes("@")) {
    const local = text.split("@")[0] || "Candidate";
    return local
      .split(/[._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Candidate";
  }

  return text;
}

function truncateActivityDetail(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > 72 ? `${text.slice(0, 72).trim()}...` : text;
}

function renderDashboard() {
  applyPlanChrome();
  updateCompanyChrome();
  updateCounts();
  renderPipeline();
  renderRecentActivity();
  renderCandidateNetworkPanel();
  renderActiveJobs();
}

async function handleLogout() {
  await window.PlacelyAuth.clearAuthState();
  window.location.replace(ROUTES.mainLogin);
}

window.handleLogout = handleLogout;

function revealDashboardShell() {
  document.documentElement.classList.remove("dashboard-booting");
}

function cleanDashboardQueryParams() {
  const url = new URL(window.location.href);
  const checkoutState = url.searchParams.get("checkout");
  const transientParams = [
    "checkout_status",
    "checkout-cancelled",
    "checkout-canceled",
    "checkout_cancelled",
    "checkout_canceled",
    "checkout-success",
    "checkout_success",
    "session_id"
  ];
  let changed = false;

  if (checkoutState && /^(cancelled|canceled|success)$/i.test(checkoutState)) {
    url.searchParams.delete("checkout");
    changed = true;
  }

  transientParams.forEach((param) => {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      changed = true;
    }
  });

  if (changed) {
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, document.title, nextUrl);
  }
}

async function loadEmployerDashboard() {
  if (!placelySupabase) {
    revealDashboardShell();
    return;
  }

  const user = await verifyEmployerAccess(placelySupabase, {
    loginPath: ROUTES.login,
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });

  if (!user) return;
  currentUser = user;

  try {
    await loadEmployerProfile(user.id);
  } catch {
    window.location.href = ROUTES.login;
    return;
  }

  const hasCandidateAccess = window.PlacelyAuth.hasCandidateSearchAccess(employerProfile);
  hasCandidateNetworkAccess = hasCandidateAccess;
  window.applyCandidateAccessUI?.(hasCandidateNetworkAccess);
  applyPlanChrome();
  updateCompanyChrome();
  revealDashboardShell();

  await guardedLoad("jobs", () => loadEmployerJobs(user.id));

  savedCandidates = [];

  const sectionLoads = [
    guardedLoad("applications", () => loadApplications(user.id)),
    guardedLoad("messages", () => loadConversationsAndMessages(user.id))
  ];

  if (hasCandidateNetworkAccess) {
    sectionLoads.push(
      guardedLoad("saved", () => loadSavedCandidates(user.id))
    );
  }

  await Promise.allSettled(sectionLoads);

  renderDashboard();
}

document.addEventListener("DOMContentLoaded", () => {
  cleanDashboardQueryParams();
  loadEmployerDashboard();
  setupDashboardShell();

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

  document.addEventListener("click", async (event) => {
    const brokenAvatar = event.target.closest?.("[data-avatar-image]");
    if (brokenAvatar) return;

    const gatedLink = event.target.closest("[data-plan-gated='candidate-network'].is-locked");
    if (gatedLink) {
      event.preventDefault();
      openUpgradePrompt();
      return;
    }

    const upgradeAction = event.target.closest("[data-upgrade-action]");
    if (upgradeAction) {
      event.preventDefault();
      startUpgradeFlow();
      return;
    }

    const retry = event.target.closest("[data-dashboard-retry]")?.dataset.dashboardRetry;
    if (!retry || !currentUser) return;

    if (retry === "jobs") await guardedLoad("jobs", () => loadEmployerJobs(currentUser.id));
    if (retry === "applications") await guardedLoad("applications", () => loadApplications(currentUser.id));
    if (retry === "saved") await guardedLoad("saved", () => loadSavedCandidates(currentUser.id));
    if (retry === "messages") await guardedLoad("messages", () => loadConversationsAndMessages(currentUser.id));

    renderDashboard();
    showToast("Dashboard section refreshed.");
  });

  document.addEventListener("error", (event) => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.matches("[data-avatar-image]")) {
      image.remove();
    }
  }, true);
});

function setupDashboardShell() {
  const body = document.body;
  const sidebar = document.getElementById("dashboardSidebar");
  const toggle = document.getElementById("sidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");
  const searchForm = document.getElementById("dashboardSearchForm");
  const searchInput = document.getElementById("dashboardSearchInput");

  const closeSidebar = () => {
    body.classList.remove("sidebar-open");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    if (backdrop) backdrop.hidden = true;
  };

  const openSidebar = () => {
    body.classList.add("sidebar-open");
    if (toggle) toggle.setAttribute("aria-expanded", "true");
    if (backdrop) backdrop.hidden = false;
  };

  toggle?.addEventListener("click", () => {
    if (body.classList.contains("sidebar-open")) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  backdrop?.addEventListener("click", closeSidebar);

  sidebar?.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeSidebar();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSidebar();
  });

  searchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = String(searchInput?.value || "").trim();

    if (!hasCandidateNetworkAccess) {
      openUpgradePrompt();
      return;
    }

    window.location.href = query
      ? `find-candidates.html?query=${encodeURIComponent(query)}`
      : "find-candidates.html";
  });
}

function openUpgradePrompt() {
  const panel = document.getElementById("freeUpgradePanel") || document.getElementById("sidebarPlanCard");
  panel?.scrollIntoView({ behavior: "smooth", block: "center" });
  showToast("Get Pro access to search, save, and message candidates.");
}

function startUpgradeFlow() {
  if (hasCandidateNetworkAccess) {
    showToast("Your Pro access is already active.");
    return;
  }

  if (typeof window.startCandidateCheckout === "function") {
    window.startCandidateCheckout();
    return;
  }

  openUpgradePrompt();
}
