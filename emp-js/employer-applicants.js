const applicantsSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const applicantsList = document.getElementById("applicantsList");
const applicantDetail = document.getElementById("applicantDetail");
const searchInput = document.getElementById("searchInput");
const jobFilter = document.getElementById("jobFilter");
const statusFilter = document.getElementById("statusFilter");
const sortFilter = document.getElementById("sortFilter");
const refreshBtn = document.getElementById("refreshBtn");
const toast = document.getElementById("toast");
const logoutBtn = document.getElementById("logoutBtn");
const applicantModal = document.getElementById("applicantModal");
const modalOverlay = document.getElementById("modalOverlay");
const closeModalBtn = document.getElementById("closeModalBtn");
const pipelineChips = document.querySelectorAll(".pipeline-chip");

let currentUser = null;
let allApplications = [];
let selectedApplicationId = null;

document.addEventListener("DOMContentLoaded", initApplicants);

async function initApplicants() {
  const {
    data: { user },
    error
  } = await applicantsSupabase.auth.getUser();

  if (error || !user) {
    window.location.href = "employer-login.html";
    return;
  }

  currentUser = user;

  setupEvents();
  await loadApplicants();
}

function setupEvents() {
  [searchInput, jobFilter, statusFilter, sortFilter].forEach((el) => {
    if (el) el.addEventListener("input", renderApplicants);
    if (el) el.addEventListener("change", renderApplicants);
  });

  if (refreshBtn) refreshBtn.addEventListener("click", loadApplicants);
  if (modalOverlay) modalOverlay.addEventListener("click", closeApplicantModal);
  if (closeModalBtn) closeModalBtn.addEventListener("click", closeApplicantModal);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeApplicantModal();
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await applicantsSupabase.auth.signOut();
      window.location.href = "employer-login.html";
    });
  }

  pipelineChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const status = chip.dataset.status || "all";

      if (statusFilter) {
        statusFilter.value = status;
      }

      updateActivePipelineChip(status);
      renderApplicants();
    });
  });

  if (statusFilter) {
    statusFilter.addEventListener("change", () => {
      updateActivePipelineChip(statusFilter.value || "all");
    });
  }
}

async function loadApplicants() {
  const { data, error } = await applicantsSupabase
    .from("applications")
    .select("*")
    .eq("employer_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    logSupabaseError("Applicants load error:", error);
    applicantsList.innerHTML = `
      <div class="empty-state">
        <strong>Could not load applicants</strong>
        <p>Check your applications table, employer_id values, and RLS policies.</p>
      </div>
    `;
    return;
  }

  allApplications = await hydrateApplications(data || []);
  populateJobFilter();
  updateCounts();
  renderApplicants();

  if (selectedApplicationId && applicantModal?.classList.contains("open")) {
    renderDetail();
  }
}

async function hydrateApplications(applications) {
  return Promise.all(
    applications.map(async (app) => {
      const snapshot = parseSnapshot(app.candidate_snapshot);
      const candidate = await getCandidateProfile(app.candidate_id);

      return {
        ...app,
        candidate_name:
          snapshot.full_name ||
          app.candidate_name ||
          candidate?.full_name ||
          "Candidate",
        candidate_trade:
          snapshot.trade ||
          app.candidate_role ||
          candidate?.trade ||
          "Trade not listed",
        candidate_location:
          snapshot.location ||
          app.location ||
          candidate?.location ||
          "Location not listed",
        candidate_email:
          snapshot.email ||
          app.candidate_email ||
          candidate?.email ||
          "",
        candidate_phone:
          snapshot.phone ||
          app.candidate_phone ||
          candidate?.phone ||
          "",
        candidate_experience:
          snapshot.experience ||
          candidate?.experience ||
          "Experience not listed",
        candidate_availability:
          snapshot.availability ||
          candidate?.availability ||
          "Availability not listed",
        candidate_skills:
          snapshot.skills ||
          candidate?.skills ||
          "",
        candidate_certifications:
          snapshot.certifications ||
          candidate?.certifications ||
          "",
        candidate_photo:
          snapshot.profile_photo_url ||
          candidate?.profile_photo_url ||
          "",
        resume_url:
          snapshot.resume_url ||
          app.resume_url ||
          candidate?.resume_url ||
          "",
        additional_notes: app.additional_notes || ""
      };
    })
  );
}

async function getCandidateProfile(candidateId) {
  if (!candidateId) return null;

  const { data, error } = await applicantsSupabase
    .from("candidate_profiles")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle();

  if (error) {
    logSupabaseError("Candidate profile load error:", error);
    return null;
  }

  return data;
}

function populateJobFilter() {
  if (!jobFilter) return;

  const currentValue = jobFilter.value || "all";
  const urlJob = new URLSearchParams(window.location.search).get("job");
  const jobs = [...new Map(
    allApplications
      .filter((app) => app.job_id || app.job_title)
      .map((app) => [
        app.job_id || app.job_title,
        {
          id: app.job_id || app.job_title,
          title: app.job_title || "Untitled Job"
        }
      ])
  ).values()];

  jobFilter.innerHTML = `<option value="all">All jobs</option>`;

  jobs.forEach((job) => {
    const option = document.createElement("option");
    option.value = job.id;
    option.textContent = job.title;
    jobFilter.appendChild(option);
  });

  if (urlJob && jobs.some((job) => String(job.id) === String(urlJob))) {
    jobFilter.value = urlJob;
    return;
  }

  jobFilter.value = jobs.some((job) => String(job.id) === String(currentValue))
    ? currentValue
    : "all";
}

function renderApplicants() {
  if (!applicantsList) return;

  const list = getFilteredApplications();

  if (!allApplications.length) {
    applicantsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">PT</div>
        <strong>No applicants yet</strong>
        <p>When candidates apply to your jobs, they will appear here with profile snapshots and hiring actions.</p>
      </div>
    `;
    return;
  }

  if (!list.length) {
    applicantsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">?</div>
        <strong>No applicants match your filters</strong>
        <p>Try a broader search, a different job, or another hiring status.</p>
      </div>
    `;
    return;
  }

  applicantsList.innerHTML = list.map(renderApplicantCard).join("");

  document.querySelectorAll(".applicant-card").forEach((card) => {
    card.addEventListener("click", () => openApplicantModal(card.dataset.id));
  });
}

function getFilteredApplications() {
  let list = [...allApplications];

  const search = searchInput?.value?.toLowerCase().trim() || "";
  const jobValue = jobFilter?.value || "all";
  const statusValue = statusFilter?.value || "all";
  const sortValue = sortFilter?.value || "newest";

  if (search) {
    list = list.filter((app) =>
      [
        app.candidate_name,
        app.candidate_trade,
        app.candidate_location,
        app.job_title,
        app.company_name,
        app.status,
        app.candidate_skills,
        app.candidate_certifications,
        app.cover_letter,
        app.additional_notes
      ]
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }

  if (jobValue !== "all") {
    list = list.filter((app) => String(app.job_id || app.job_title) === String(jobValue));
  }

  if (statusValue === "new") {
    list = list.filter((app) => ["new", "submitted"].includes(normalizeStatus(app.status)));
  } else if (statusValue !== "all") {
    list = list.filter((app) => normalizeStatus(app.status) === statusValue);
  }

  if (sortValue === "newest") {
    list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }

  if (sortValue === "oldest") {
    list.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  }

  if (sortValue === "candidate") {
    list.sort((a, b) =>
      String(a.candidate_name || "").localeCompare(String(b.candidate_name || ""))
    );
  }

  return list;
}

function renderApplicantCard(app) {
  const status = normalizeStatus(app.status);
  const initials = getInitials(app.candidate_name);

  return `
    <article class="applicant-card" data-id="${escapeHTML(app.id)}">
      <div class="applicant-main">
        <div class="avatar">
          ${
            app.candidate_photo
              ? `<img src="${escapeHTML(app.candidate_photo)}" alt="${escapeHTML(app.candidate_name)}">`
              : escapeHTML(initials)
          }
        </div>

        <div class="applicant-info">
          <h3>${escapeHTML(app.candidate_name)}</h3>
          <p>${escapeHTML(app.candidate_trade)} &middot; ${escapeHTML(app.candidate_location)}</p>
          <div class="applicant-tags">
            <span>${escapeHTML(app.candidate_experience)}</span>
            <span>${escapeHTML(app.candidate_availability)}</span>
          </div>
        </div>
      </div>

      <div class="queue-job">
        <span>Applied for</span>
        <strong>${escapeHTML(app.job_title || "Untitled Job")}</strong>
        <p class="queue-meta">${escapeHTML(app.company_name || "Company")}</p>
      </div>

      <div class="queue-date">
        <span>Applied</span>
        <strong>${escapeHTML(formatDate(app.created_at))}</strong>
      </div>

      <span class="status-pill ${escapeHTML(status)}">${escapeHTML(getStatusLabel(status))}</span>
    </article>
  `;
}

function openApplicantModal(applicationId) {
  selectedApplicationId = applicationId;
  renderDetail();

  if (applicantModal) {
    applicantModal.classList.add("open");
    applicantModal.setAttribute("aria-hidden", "false");
  }
}

function closeApplicantModal() {
  if (!applicantModal) return;

  applicantModal.classList.remove("open");
  applicantModal.setAttribute("aria-hidden", "true");
}

function renderDetail() {
  if (!applicantDetail) return;

  const app = allApplications.find((item) => String(item.id) === String(selectedApplicationId));

  if (!app) {
    applicantDetail.innerHTML = `
      <div class="empty-state compact-empty">
        <strong>Select an applicant</strong>
        <p>Choose a candidate from the queue to review details and update status.</p>
      </div>
    `;
    return;
  }

  const status = normalizeStatus(app.status);
  const initials = getInitials(app.candidate_name);
  const tags = getTags(app);

  applicantDetail.innerHTML = `
    <div class="detail-head">
      <div class="avatar large">
        ${
          app.candidate_photo
            ? `<img src="${escapeHTML(app.candidate_photo)}" alt="${escapeHTML(app.candidate_name)}">`
            : escapeHTML(initials)
        }
      </div>

      <div>
        <h2>${escapeHTML(app.candidate_name)}</h2>
        <p class="detail-text">${escapeHTML(app.candidate_trade)} &middot; ${escapeHTML(app.candidate_location)}</p>
        <span class="status-pill ${escapeHTML(status)}">${escapeHTML(getStatusLabel(status))}</span>
      </div>
    </div>

    <div class="detail-section">
      <h3>Application</h3>
      <div class="detail-grid">
        <div class="detail-row"><span>Job</span><strong>${escapeHTML(app.job_title || "Untitled Job")}</strong></div>
        <div class="detail-row"><span>Applied</span><strong>${escapeHTML(formatDate(app.created_at))}</strong></div>
        <div class="detail-row"><span>Status</span><strong>${escapeHTML(getStatusLabel(status))}</strong></div>
        <div class="detail-row"><span>Company</span><strong>${escapeHTML(app.company_name || "Company")}</strong></div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Cover letter</h3>
      <p class="detail-text detail-message">${escapeHTML(app.cover_letter || "No cover letter included.")}</p>
      ${
        app.additional_notes
          ? `<p class="detail-text detail-message">${escapeHTML(app.additional_notes)}</p>`
          : ""
      }
    </div>

    <div class="detail-section">
      <h3>Candidate profile snapshot</h3>
      <div class="detail-grid">
        <div class="detail-row"><span>Email</span><strong>${escapeHTML(app.candidate_email || "Not listed")}</strong></div>
        <div class="detail-row"><span>Phone</span><strong>${escapeHTML(app.candidate_phone || "Not listed")}</strong></div>
        <div class="detail-row"><span>Experience</span><strong>${escapeHTML(app.candidate_experience)}</strong></div>
        <div class="detail-row"><span>Availability</span><strong>${escapeHTML(app.candidate_availability)}</strong></div>
      </div>

      <div class="tag-row">
        ${tags.length ? tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("") : "<span>No skills or certifications listed</span>"}
      </div>
    </div>

    <div class="detail-section">
      <h3>Hiring timeline</h3>
      <div class="timeline-grid">
        <div class="timeline-row"><span>Updated</span><strong>${escapeHTML(formatDate(app.updated_at))}</strong></div>
        <div class="timeline-row"><span>Reviewed</span><strong>${escapeHTML(formatDate(app.reviewed_at))}</strong></div>
        <div class="timeline-row"><span>Interview</span><strong>${escapeHTML(formatDate(app.interview_date))}</strong></div>
        <div class="timeline-row"><span>Offer</span><strong>${escapeHTML(formatDate(app.offer_sent_at))}</strong></div>
        <div class="timeline-row"><span>Hired</span><strong>${escapeHTML(formatDate(app.hired_at))}</strong></div>
        <div class="timeline-row"><span>Rejected</span><strong>${escapeHTML(formatDate(app.rejected_at))}</strong></div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Hiring actions</h3>
      <div class="stage-actions">
        <button class="stage-action" onclick="updateApplicationStatus('${escapeHTML(app.id)}', 'reviewing')">Move to Review</button>
        <button class="stage-action" onclick="updateApplicationStatus('${escapeHTML(app.id)}', 'interview')">Interview</button>
        <button class="stage-action success" onclick="updateApplicationStatus('${escapeHTML(app.id)}', 'offer')">Offer</button>
        <button class="stage-action success" onclick="updateApplicationStatus('${escapeHTML(app.id)}', 'hired')">Hire</button>
        <button class="stage-action danger" onclick="updateApplicationStatus('${escapeHTML(app.id)}', 'rejected')">Reject</button>
        <button class="message-btn" onclick="messageCandidate('${escapeHTML(app.id)}')">Message</button>
      </div>
    </div>

    <div class="detail-section">
      <h3>Resume</h3>
      ${
        app.resume_url
          ? `<a class="profile-btn" href="${escapeHTML(app.resume_url)}" target="_blank" rel="noopener">Open Resume</a>`
          : `<span class="profile-btn disabled">No resume uploaded</span>`
      }
    </div>
  `;
}

async function updateApplicationStatus(applicationId, status) {
  const now = new Date().toISOString();
  const updatePayload = {
    status,
    updated_at: now
  };

  if (["reviewing", "interview", "offer", "hired", "rejected"].includes(status)) {
    updatePayload.reviewed_at = now;
  }

  if (status === "interview") updatePayload.interview_date = now;
  if (status === "offer") updatePayload.offer_sent_at = now;
  if (status === "hired") updatePayload.hired_at = now;
  if (status === "rejected") updatePayload.rejected_at = now;

  const { error } = await updateApplicationWithSchemaFallback(applicationId, updatePayload);

  if (error) {
    logSupabaseError("Status update error:", error);
    showToast("Could not update applicant status.");
    return;
  }

  const app = allApplications.find((item) => String(item.id) === String(applicationId));
  if (app) Object.assign(app, updatePayload);

  updateCounts();
  renderApplicants();
  renderDetail();
  showToast(`Applicant moved to ${getStatusLabel(status)}.`);
}

async function updateApplicationWithSchemaFallback(applicationId, payload) {
  let safePayload = { ...payload };
  const removedColumns = [];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await applicantsSupabase
      .from("applications")
      .update(safePayload)
      .eq("id", applicationId)
      .eq("employer_id", currentUser.id);

    if (!error) {
      if (removedColumns.length) {
        console.warn("Application status updated after removing missing columns:", removedColumns);
      }

      return { error: null };
    }

    logSupabaseError("Status update error:", error);
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
      hint: "Run the Supabase applications hiring flow SQL file so timeline columns can be stored.",
      code: "SCHEMA_FALLBACK_LIMIT"
    }
  };
}

async function messageCandidate(applicationId) {
  const app = allApplications.find((item) => String(item.id) === String(applicationId));
  if (!app) return;

  if (app.conversation_id) {
    window.location.href = `employer-messages.html?conversation=${app.conversation_id}`;
    return;
  }

  const { data: existingConversation, error: findError } = await applicantsSupabase
    .from("conversations")
    .select("*")
    .eq("candidate_id", app.candidate_id)
    .eq("employer_id", currentUser.id)
    .maybeSingle();

  if (findError) {
    logSupabaseError("Conversation lookup error:", findError);
    window.location.href = buildMessageFallbackUrl(app);
    return;
  }

  if (existingConversation) {
    await applicantsSupabase
      .from("applications")
      .update({ conversation_id: existingConversation.id })
      .eq("id", app.id)
      .eq("employer_id", currentUser.id);

    window.location.href = `employer-messages.html?conversation=${existingConversation.id}`;
    return;
  }

  const { data: conversation, error } = await applicantsSupabase
    .from("conversations")
    .insert([
      {
        candidate_id: app.candidate_id,
        employer_id: currentUser.id,
        job_id: app.job_id || null,
        job_title: app.job_title || null,
        candidate_name: app.candidate_name || "Candidate",
        candidate_initials: getInitials(app.candidate_name),
        candidate_role: app.candidate_trade || app.job_title || null,
        candidate_location: app.candidate_location || null,
        source: "Application",
        status: "Active",
        response: "New"
      }
    ])
    .select()
    .single();

  if (error) {
    logSupabaseError("Conversation create error:", error);
    showToast("Opening messages with applicant context.");
    window.location.href = buildMessageFallbackUrl(app);
    return;
  }

  await applicantsSupabase
    .from("applications")
    .update({ conversation_id: conversation.id })
    .eq("id", app.id)
    .eq("employer_id", currentUser.id);

  window.location.href = `employer-messages.html?conversation=${conversation.id}`;
}

function buildMessageFallbackUrl(app) {
  const params = new URLSearchParams({
    candidate_id: app.candidate_id || "",
    application_id: app.id || "",
    job_id: app.job_id || ""
  });

  return `employer-messages.html?${params.toString()}`;
}

function updateCounts() {
  setText("totalApplicants", allApplications.length);
  setText("newApplicants", countStatus("new") + countStatus("submitted"));
  setText("reviewingApplicants", countStatus("reviewing"));
  setText("interviewApplicants", countStatus("interview"));
  setText("offerApplicants", countStatus("offer"));
  setText("hiredApplicants", countStatus("hired"));
  setText("rejectedApplicants", countStatus("rejected"));
  updateActivePipelineChip(statusFilter?.value || "all");
}

function updateActivePipelineChip(status) {
  pipelineChips.forEach((chip) => {
    chip.classList.toggle("active", (chip.dataset.status || "all") === status);
  });
}

function countStatus(status) {
  return allApplications.filter((app) => normalizeStatus(app.status) === status).length;
}

function normalizeStatus(status) {
  const value = String(status || "submitted").toLowerCase().trim();

  if (value === "new") return "new";
  if (["applied", "submitted"].includes(value)) return "submitted";
  if (["review", "reviewing", "viewed", "in review"].includes(value)) return "reviewing";
  if (["interview", "interviewing", "interview requested"].includes(value)) return "interview";
  if (["offer", "offered"].includes(value)) return "offer";
  if (value === "hired") return "hired";
  if (["rejected", "declined"].includes(value)) return "rejected";
  if (value === "withdrawn") return "withdrawn";

  return "submitted";
}

function getStatusLabel(status) {
  const labels = {
    new: "New",
    submitted: "Submitted",
    reviewing: "Reviewing",
    interview: "Interview",
    offer: "Offer",
    hired: "Hired",
    rejected: "Rejected",
    withdrawn: "Withdrawn"
  };

  return labels[status] || "Submitted";
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

function getTags(app) {
  const tags = [];

  if (app.candidate_skills) tags.push(...String(app.candidate_skills).split(","));
  if (app.candidate_certifications) tags.push(...String(app.candidate_certifications).split(","));

  return tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 10);
}

function formatDate(value) {
  if (!value) return "Not set";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";

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
  if (!toast) return;

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

window.updateApplicationStatus = updateApplicationStatus;
window.messageCandidate = messageCandidate;
