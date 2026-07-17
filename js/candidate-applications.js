const applicationsSupabase = window.PlacelyAuth.client();

const applicationsList = document.getElementById("applications_list");
const applicationSearch = document.getElementById("applicationSearch");
const applicationFilter = document.getElementById("applicationFilter");
const applicationModal = document.getElementById("applicationModal");
const applicationModalOverlay = document.getElementById("applicationModalOverlay");
const closeApplicationModalBtn = document.getElementById("closeApplicationModalBtn");
const applicationDetail = document.getElementById("applicationDetail");
const withdrawModal = document.getElementById("withdrawModal");
const withdrawModalOverlay = document.getElementById("withdrawModalOverlay");
const cancelWithdrawBtn = document.getElementById("cancelWithdrawBtn");
const confirmWithdrawBtn = document.getElementById("confirmWithdrawBtn");

let currentUser = null;
let allApplications = [];
let selectedApplicationId = null;
let pendingWithdrawApplicationId = null;

document.addEventListener("DOMContentLoaded", initApplications);

async function initApplications() {
  const user = await verifyCandidateAccess(applicationsSupabase, {
    loginPath: "candidate-login.html",
    employerDashboardPath: "../employers/employer-dashboard.html"
  });

  if (!user) return;
  currentUser = user;

  setupEvents();
  await loadApplications();
}

function setupEvents() {
  if (applicationSearch) {
    applicationSearch.addEventListener("input", renderApplications);
  }

  if (applicationFilter) {
    applicationFilter.addEventListener("change", renderApplications);
  }

  if (applicationModalOverlay) applicationModalOverlay.addEventListener("click", closeApplicationModal);
  if (closeApplicationModalBtn) closeApplicationModalBtn.addEventListener("click", closeApplicationModal);
  if (withdrawModalOverlay) withdrawModalOverlay.addEventListener("click", closeWithdrawModal);
  if (cancelWithdrawBtn) cancelWithdrawBtn.addEventListener("click", closeWithdrawModal);
  if (confirmWithdrawBtn) confirmWithdrawBtn.addEventListener("click", confirmWithdrawApplication);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeApplicationModal();
      closeWithdrawModal();
    }
  });
}

async function loadApplications() {
  const { data: applications, error } = await applicationsSupabase
    .from("applications")
    .select("*")
    .eq("candidate_id", currentUser.id)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Applications load error:", error);

    applicationsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">!</div>
        <strong>Could not load applications</strong>
        <p>Please refresh the page and try again.</p>
      </div>
    `;
    return;
  }

  allApplications = await hydrateApplications(applications || []);

  updateStats();
  updateNextAction();
  renderApplications();
}

async function hydrateApplications(applications) {
  if (!applications.length) return [];

  const jobIds = [...new Set(applications.map((app) => app.job_id).filter(Boolean))];
  const jobsById = {};
  const employerProfilesById = {};

  if (jobIds.length) {
    const { data: jobs, error: jobsError } = await applicationsSupabase
      .from("jobs")
      .select("*")
      .in("id", jobIds);

    if (jobsError) {
      console.warn("Could not load application job details:", jobsError);
    } else {
      (jobs || []).forEach((job) => {
        jobsById[String(job.id)] = job;
      });
    }
  }

  const employerIds = [
    ...new Set(
      applications
        .map((app) => jobsById[String(app.job_id || "")]?.employer_id || app.employer_id)
        .filter(Boolean)
    )
  ];

  if (employerIds.length) {
    const { data: employerProfiles, error: employerError } = await applicationsSupabase
      .from("public_employer_profiles")
      .select("*")
      .in("id", employerIds);

    if (employerError) {
      console.warn("Could not load employer profile logos:", employerError);
    } else {
      (employerProfiles || []).forEach((profile) => {
        employerProfilesById[String(profile.id)] = profile;
      });
    }
  }

  return applications.map((app) => {
    const job = jobsById[String(app.job_id || "")] || {};
    const employerId = job.employer_id || app.employer_id;
    const employerProfile = employerProfilesById[String(employerId || "")] || {};

    return {
      ...app,
      employer_id: employerId || app.employer_id,
      job_title: app.job_title || job.job_title || "Untitled Job",
      company_name: app.company_name || job.company_name || employerProfile.company_name || "Company",
      location: app.location || job.location || employerProfile.location || "Location not listed",
      employment_type: app.employment_type || job.employment_type || "Job type not listed",
      pay_range: app.pay_range || job.pay_range || "Pay not listed",
      company_logo_url: app.company_logo_url || getCompanyLogoUrl(employerProfile),
      company_photo_url: app.company_photo_url || employerProfile.company_photo_url || ""
    };
  });
}

function renderApplications() {
  if (!applicationsList) return;

  let list = [...allApplications];

  const query = applicationSearch?.value?.toLowerCase().trim() || "";
  const filter = applicationFilter?.value || "all";

  if (query) {
    list = list.filter((app) =>
      [
        app.job_title,
        app.company_name,
        app.location,
        app.employment_type,
        app.pay_range,
        app.status,
        app.cover_letter,
        app.additional_notes
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }

  if (filter !== "all") {
    list = list.filter((app) => normalizeStatus(app.status) === filter);
  }

  if (!allApplications.length) {
    applicationsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">↗</div>
        <strong>No applications yet</strong>
        <p>When you apply to jobs, your applications will appear here.</p>
        <a href="../public/find-jobs.html?role=candidate">Browse Jobs</a>
      </div>
    `;
    return;
  }

  if (!list.length) {
    applicationsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⌕</div>
        <strong>No matching applications</strong>
        <p>Try searching another company, role, location, or status.</p>
      </div>
    `;
    return;
  }

  applicationsList.innerHTML = list.map(renderApplicationCard).join("");
}

function renderApplicationCard(app) {
  const status = normalizeStatus(app.status);
  const statusLabel = getStatusLabel(status);

  const companyName = app.company_name || "Company";
  const jobTitle = app.job_title || "Untitled Job";
  const location = app.location || "Location not listed";
  const employmentType = app.employment_type || "Job type not listed";
  const payRange = app.pay_range || "Pay not listed";
  const appliedDate = formatDate(app.created_at);
  const initials = getInitials(companyName);
  const companyLogoUrl = getCompanyLogoUrl(app);

  return `
    <article class="application-card">
      <div class="application-main">
        <div class="company-avatar">
          ${
            companyLogoUrl
              ? `<img src="${escapeHTML(companyLogoUrl)}" alt="${escapeHTML(companyName)} logo">`
              : escapeHTML(initials)
          }
        </div>

        <div class="application-info">
          <div class="application-title-row">
            <h3>${escapeHTML(jobTitle)}</h3>
            <span class="status-pill ${escapeHTML(status)}">${escapeHTML(statusLabel)}</span>
          </div>

          <div class="meta-line">
            ${escapeHTML(companyName)} · ${escapeHTML(location)} · ${escapeHTML(employmentType)} · ${escapeHTML(payRange)}
          </div>

          <div class="application-note">
            Applied ${escapeHTML(appliedDate)}
          </div>
        </div>
      </div>

      <div class="application-actions">
        <button class="card-btn" onclick="viewApplication('${escapeHTML(app.id)}')">
          View Application
        </button>

        <button class="danger-outline-btn" onclick="openWithdrawModal('${escapeHTML(app.id)}')">
          Withdraw Application
        </button>

        <button class="follow-up-btn" onclick="handleFollowUp('${escapeHTML(app.id)}')">
          Follow Up
        </button>

        <button class="card-btn" onclick="viewJob('${escapeHTML(app.job_id || "")}')">
          View Job
        </button>
      </div>
    </article>
  `;
}

function viewApplication(applicationId) {
  selectedApplicationId = applicationId;
  renderApplicationDetail();

  if (applicationModal) {
    applicationModal.classList.add("open");
    applicationModal.setAttribute("aria-hidden", "false");
  }
}

function closeApplicationModal() {
  if (!applicationModal) return;

  applicationModal.classList.remove("open");
  applicationModal.setAttribute("aria-hidden", "true");
}

function renderApplicationDetail() {
  if (!applicationDetail) return;

  const app = allApplications.find((item) => String(item.id) === String(selectedApplicationId));

  if (!app) {
    applicationDetail.innerHTML = `
      <div class="empty-state">
        <strong>Application not found</strong>
        <p>Please close this window and refresh your applications.</p>
      </div>
    `;
    return;
  }

  const status = normalizeStatus(app.status);
  const snapshot = parseSnapshot(app.candidate_snapshot);
  const tags = getSnapshotTags(snapshot);
  const candidateName = snapshot.full_name || app.candidate_name || "Candidate";
  const candidateTrade = snapshot.trade || app.candidate_role || "Trade not listed";
  const candidateLocation = snapshot.location || app.location || "Location not listed";

  applicationDetail.innerHTML = `
    <section class="readonly-section">
      <div class="readonly-heading">
        <div>
          <h3>${escapeHTML(app.job_title || "Untitled Job")}</h3>
          <p>${escapeHTML(app.company_name || "Company")} &middot; ${escapeHTML(app.location || "Location not listed")}</p>
        </div>
        <span class="status-pill ${escapeHTML(status)}">${escapeHTML(getStatusLabel(status))}</span>
      </div>

      <div class="readonly-grid">
        <div><span>Company</span><strong>${escapeHTML(app.company_name || "Company")}</strong></div>
        <div><span>Job Type</span><strong>${escapeHTML(app.employment_type || "Job type not listed")}</strong></div>
        <div><span>Pay</span><strong>${escapeHTML(app.pay_range || "Pay not listed")}</strong></div>
        <div><span>Submitted</span><strong>${escapeHTML(formatDate(app.created_at))}</strong></div>
        <div><span>Status</span><strong>${escapeHTML(getStatusLabel(status))}</strong></div>
        <div><span>Last Updated</span><strong>${escapeHTML(formatDate(app.updated_at))}</strong></div>
      </div>
    </section>

    <section class="readonly-section">
      <h3>Submitted candidate snapshot</h3>
      <div class="candidate-readonly">
        <div class="company-avatar snapshot-avatar">${escapeHTML(getInitials(candidateName))}</div>
        <div>
          <h4>${escapeHTML(candidateName)}</h4>
          <p>${escapeHTML(candidateTrade)} &middot; ${escapeHTML(candidateLocation)}</p>
          <div class="readonly-grid compact-grid">
            <div><span>Email</span><strong>${escapeHTML(snapshot.email || app.candidate_email || currentUser.email || "Not listed")}</strong></div>
            <div><span>Phone</span><strong>${escapeHTML(snapshot.phone || app.candidate_phone || "Not listed")}</strong></div>
            <div><span>Experience</span><strong>${escapeHTML(snapshot.experience || "Not listed")}</strong></div>
            <div><span>Availability</span><strong>${escapeHTML(snapshot.availability || "Not listed")}</strong></div>
            <div><span>Resume</span><strong>${escapeHTML((snapshot.resume_path || snapshot.resume_url || app.resume_path || app.resume_url) ? "Attached" : "Not uploaded")}</strong></div>
            <div><span>Location</span><strong>${escapeHTML(candidateLocation)}</strong></div>
          </div>
          <div class="tag-row">
            ${tags.length ? tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("") : "<span>No skills or certifications submitted</span>"}
          </div>
        </div>
      </div>
    </section>

    <section class="readonly-section">
      <h3>Message to employer</h3>
      <div class="readonly-message">${escapeHTML(app.cover_letter || "No message included.")}</div>
    </section>

    <section class="readonly-section">
      <h3>Additional notes</h3>
      <div class="readonly-message">${escapeHTML(app.additional_notes || "No additional notes included.")}</div>
    </section>
  `;
}

function openWithdrawModal(applicationId) {
  pendingWithdrawApplicationId = applicationId;

  if (withdrawModal) {
    withdrawModal.classList.add("open");
    withdrawModal.setAttribute("aria-hidden", "false");
  }
}

function closeWithdrawModal() {
  pendingWithdrawApplicationId = null;

  if (withdrawModal) {
    withdrawModal.classList.remove("open");
    withdrawModal.setAttribute("aria-hidden", "true");
  }

  if (confirmWithdrawBtn) {
    confirmWithdrawBtn.disabled = false;
    confirmWithdrawBtn.textContent = "Yes, withdraw";
  }
}

async function confirmWithdrawApplication() {
  if (!pendingWithdrawApplicationId || !currentUser) return;

  if (confirmWithdrawBtn) {
    confirmWithdrawBtn.disabled = true;
    confirmWithdrawBtn.textContent = "Withdrawing...";
  }

  const now = new Date().toISOString();
  const updatePayload = {
    status: "withdrawn",
    candidate_status: "withdrawn",
    withdrawn_at: now,
    updated_at: now
  };

  const { error } = await updateApplicationWithSchemaFallback(
    pendingWithdrawApplicationId,
    updatePayload
  );

  if (error) {
    logSupabaseError("Withdraw application error:", error);
    showToast("Could not withdraw application. Please try again.");

    if (confirmWithdrawBtn) {
      confirmWithdrawBtn.disabled = false;
      confirmWithdrawBtn.textContent = "Yes, withdraw";
    }
    return;
  }

  allApplications = allApplications.filter(
    (app) => String(app.id) !== String(pendingWithdrawApplicationId)
  );

  closeWithdrawModal();
  closeApplicationModal();
  updateStats();
  updateNextAction();
  renderApplications();
  showToast("Application withdrawn.");
}

async function updateApplicationWithSchemaFallback(applicationId, payload) {
  let safePayload = { ...payload };
  const removedColumns = [];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await applicationsSupabase
      .from("applications")
      .update(safePayload)
      .eq("id", applicationId)
      .eq("candidate_id", currentUser.id);

    if (!error) {
      if (removedColumns.length) {
        console.warn("Application withdrawn after removing missing columns:", removedColumns);
      }

      return { error: null };
    }

    logSupabaseError("Withdraw application error:", error);
    const missingColumn = getMissingColumnName(error);

    if (!missingColumn || !(missingColumn in safePayload)) {
      return { error };
    }

    removedColumns.push(missingColumn);
    delete safePayload[missingColumn];
  }

  return {
    error: {
      message: "Application update failed after removing missing columns.",
      details: removedColumns.join(", "),
      hint: "Run the Supabase applications hiring flow SQL file so withdrawal columns can be stored.",
      code: "SCHEMA_FALLBACK_LIMIT"
    }
  };
}

function updateStats() {
  const total = allApplications.length;

  const reviewing = allApplications.filter(
    (app) => normalizeStatus(app.status) === "reviewing"
  ).length;

  const interviewing = allApplications.filter(
    (app) => normalizeStatus(app.status) === "interview"
  ).length;

  const offers = allApplications.filter(
    (app) => normalizeStatus(app.status) === "offer"
  ).length;

  setText("applied_count", total);
  setText("reviewing_count", reviewing);
  setText("interviewing_count", interviewing);
  setText("offers_count", offers);
}

function updateNextAction() {
  const card = document.getElementById("nextActionCard");
  if (!card) return;

  const offers = allApplications.filter(
    (app) => normalizeStatus(app.status) === "offer"
  ).length;

  const interviews = allApplications.filter(
    (app) => normalizeStatus(app.status) === "interview"
  ).length;

  const active = allApplications.filter((app) =>
    ["submitted", "reviewing", "interview"].includes(normalizeStatus(app.status))
  ).length;

  if (offers > 0) {
    card.innerHTML = `
      <strong>You have an offer to review</strong>
      <p>Review the details carefully and respond quickly so the employer can move forward.</p>
    `;
    return;
  }

  if (interviews > 0) {
    card.innerHTML = `
      <strong>Prepare for your next interview</strong>
      <p>Review the job details, your certifications, availability, and recent work experience.</p>
    `;
    return;
  }

  if (active > 0) {
    card.innerHTML = `
      <strong>${active} active application${active === 1 ? "" : "s"}</strong>
      <p>Keep an eye on messages and follow up professionally if an employer has not responded yet.</p>
    `;
    return;
  }

  card.innerHTML = `
    <strong>Build your opportunity pipeline</strong>
    <p>Apply to strong matches and keep your profile ready for employers reviewing candidates.</p>
  `;
}

function normalizeStatus(status) {
  const value = String(status || "submitted").toLowerCase().trim();

  if (["new"].includes(value)) return "new";
  if (["applied", "submitted"].includes(value)) return "submitted";
  if (["review", "reviewing", "viewed", "in review"].includes(value)) return "reviewing";
  if (["interview", "interviewing", "interview requested"].includes(value)) return "interview";
  if (["offer", "offered"].includes(value)) return "offer";
  if (["hired"].includes(value)) return "hired";
  if (["rejected", "declined"].includes(value)) return "rejected";
  if (["withdrawn", "withdraw"].includes(value)) return "withdrawn";

  return "submitted";
}

function getStatusLabel(status) {
  const labels = {
    submitted: "Submitted",
    new: "New",
    reviewing: "Reviewing",
    interview: "Interview",
    offer: "Offer",
    hired: "Hired",
    rejected: "Rejected",
    withdrawn: "Withdrawn"
  };

  return labels[status] || "Submitted";
}

function getCompanyLogoUrl(source) {
  if (!source) return "";

  return (
    source.company_logo_url ||
    source.company_photo_url ||
    source.profile_photo_url ||
    source.logo_url ||
    source.company_logo ||
    source.company_logo_preview ||
    ""
  );
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

function getSnapshotTags(snapshot) {
  const tags = [];

  if (snapshot.skills) tags.push(...String(snapshot.skills).split(","));
  if (snapshot.certifications) tags.push(...String(snapshot.certifications).split(","));

  return tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 10);
}

async function handleFollowUp(applicationId) {
  const app = allApplications.find((item) => String(item.id) === String(applicationId));

  if (!app || !currentUser) {
    alert("Could not open this application conversation yet.");
    return;
  }

  if (!app.employer_id) {
    alert("This application is missing employer information.");
    return;
  }

  const { data: existingConversation, error: findError } = await applicationsSupabase
    .from("conversations")
    .select("*")
    .eq("candidate_id", currentUser.id)
    .eq("employer_id", app.employer_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) {
    console.error("Conversation lookup error:", findError);
    alert("Could not open this employer conversation. Please try again.");
    return;
  }

  if (existingConversation) {
    await applicationsSupabase
      .from("applications")
      .update({ conversation_id: existingConversation.id })
      .eq("id", app.id)
      .eq("candidate_id", currentUser.id);

    window.location.href = `candidate-messages.html?conversation=${existingConversation.id}`;
    return;
  }

  const { data: conversation, error } = await applicationsSupabase
    .from("conversations")
    .insert([
      {
        candidate_id: currentUser.id,
        employer_id: app.employer_id,
        job_id: app.job_id || null,
        job_title: app.job_title || null,
        candidate_name: app.candidate_name || currentUser.email || "Candidate",
        candidate_initials: getInitials(app.candidate_name || currentUser.email || "Candidate"),
        candidate_role: app.candidate_role || app.job_title || null,
        candidate_location: app.location || null,
        source: "Application",
        status: "Active",
        response: "New"
      }
    ])
    .select()
    .single();

  if (error) {
    console.error("Conversation create error:", error);
    alert("No conversation has been started with this employer yet.");
    return;
  }

  await applicationsSupabase
    .from("applications")
    .update({ conversation_id: conversation.id })
    .eq("id", app.id)
    .eq("candidate_id", currentUser.id);

  window.location.href = `candidate-messages.html?conversation=${conversation.id}`;
}

function viewJob(jobId) {
  if (!jobId) {
    window.location.href = "../public/find-jobs.html?role=candidate";
    return;
  }

  window.location.href = `../public/find-jobs.html?role=candidate&job=${jobId}`;
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

function getInitials(name) {
  return String(name || "PT")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
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
  }, 2600);
}

function getMissingColumnName(error) {
  const text = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" ");

  const match =
    text.match(/'([^']+)' column/i) ||
    text.match(/column "([^"]+)"/i) ||
    text.match(/Could not find the '([^']+)'/i);

  return match?.[1] || "";
}

function logSupabaseError(label, error) {
  console.error(label, {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code
  });
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.handleFollowUp = handleFollowUp;
window.viewJob = viewJob;
window.viewApplication = viewApplication;
window.openWithdrawModal = openWithdrawModal;
