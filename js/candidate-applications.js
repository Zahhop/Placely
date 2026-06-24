const applicationsSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const applicationsList = document.getElementById("applications_list");
const applicationSearch = document.getElementById("applicationSearch");
const applicationFilter = document.getElementById("applicationFilter");

let currentUser = null;
let allApplications = [];

document.addEventListener("DOMContentLoaded", initApplications);

async function initApplications() {
  const {
    data: { user },
    error: userError
  } = await applicationsSupabase.auth.getUser();

  if (userError || !user) {
    window.location.href = "candidate-login.html";
    return;
  }

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
}

async function loadApplications() {
  const { data: applications, error } = await applicationsSupabase
    .from("applications")
    .select("*")
    .eq("candidate_id", currentUser.id)
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

  allApplications = applications || [];

  updateStats();
  updateNextAction();
  renderApplications();
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

  return `
    <article class="application-card">
      <div class="application-main">
        <div class="company-avatar">
          ${
            app.company_logo_url
              ? `<img src="${escapeHTML(app.company_logo_url)}" alt="${escapeHTML(companyName)} logo">`
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
        <button class="follow-up-btn" onclick="handleFollowUp('${escapeHTML(app.conversation_id || "")}')">
          Follow Up
        </button>

        <button class="card-btn" onclick="viewJob('${escapeHTML(app.job_id || "")}')">
          View Job
        </button>
      </div>
    </article>
  `;
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

function handleFollowUp(conversationId) {
  if (!conversationId) {
    alert("No conversation has been started with this employer yet.");
    return;
  }

  window.location.href = `candidate-messages.html?conversation=${conversationId}`;
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

  return new Date(value).toLocaleDateString([], {
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
