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
const stageTabs = document.querySelectorAll(".stage-tab");

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

  if (refreshBtn) {
    refreshBtn.addEventListener("click", loadApplicants);
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await applicantsSupabase.auth.signOut();
      window.location.href = "employer-login.html";
    });
  }

  stageTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      stageTabs.forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");

      if (statusFilter) {
        statusFilter.value = tab.dataset.status || "all";
      }

      renderApplicants();
    });
  });
}

async function loadApplicants() {
  const { data, error } = await applicantsSupabase
    .from("applications")
    .select("*")
    .eq("employer_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Applicants load error:", error);
    applicantsList.innerHTML = `
      <div class="empty-state">
        <strong>Could not load applicants</strong>
        <p>Check your applications table, employer_id values, and RLS policies.</p>
      </div>
    `;
    return;
  }

  allApplications = await hydrateApplications(data || []);
  selectedApplicationId = allApplications[0]?.id || null;

  populateJobFilter();
  updateCounts();
  renderApplicants();
  renderDetail();
}

async function hydrateApplications(applications) {
  return Promise.all(
    applications.map(async (app) => {
      const candidate = await getCandidateProfile(app.candidate_id);

      return {
        ...app,
        candidate_name:
          candidate?.full_name ||
          app.candidate_name ||
          "Candidate",
        candidate_trade:
          candidate?.trade ||
          app.candidate_role ||
          "Trade not listed",
        candidate_location:
          candidate?.location ||
          app.location ||
          "Location not listed",
        candidate_email:
          candidate?.email ||
          app.candidate_email ||
          "",
        candidate_phone:
          candidate?.phone ||
          app.candidate_phone ||
          "",
        candidate_experience:
          candidate?.experience ||
          "Experience not listed",
        candidate_availability:
          candidate?.availability ||
          "Availability not listed",
        candidate_skills:
          candidate?.skills ||
          "",
        candidate_certifications:
          candidate?.certifications ||
          "",
        candidate_photo:
          candidate?.profile_photo_url ||
          "",
        resume_url:
          candidate?.resume_url ||
          app.resume_url ||
          ""
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
    console.error("Candidate profile load error:", error);
    return null;
  }

  return data;
}

function populateJobFilter() {
  if (!jobFilter) return;

  const currentValue = jobFilter.value || "all";
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

  const urlJob = new URLSearchParams(window.location.search).get("job");

  if (urlJob && jobs.some((job) => String(job.id) === String(urlJob))) {
    jobFilter.value = urlJob;
  } else {
    jobFilter.value = currentValue;
  }
}

function renderApplicants() {
  if (!applicantsList) return;

  let list = getFilteredApplications();

  if (!list.length) {
    applicantsList.innerHTML = `
      <div class="empty-state">
        <strong>No applicants found</strong>
        <p>Applicants will appear here when candidates apply to your job posts.</p>
      </div>
    `;
    return;
  }

  applicantsList.innerHTML = list.map(renderApplicantCard).join("");

  document.querySelectorAll(".applicant-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectedApplicationId = card.dataset.id;
      renderApplicants();
      renderDetail();
    });
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
        app.candidate_certifications
      ]
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }

  if (jobValue !== "all") {
    list = list.filter((app) => String(app.job_id || app.job_title) === String(jobValue));
  }

  if (statusValue !== "all") {
    list = list.filter((app) => normalizeStatus(app.status) === statusValue);
  }

  if (sortValue === "newest") {
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  if (sortValue === "oldest") {
    list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
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
  const selected = String(app.id) === String(selectedApplicationId);
  const initials = getInitials(app.candidate_name);

  return `
    <article class="applicant-card ${selected ? "active" : ""}" data-id="${escapeHTML(app.id)}">
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
          <p>${escapeHTML(app.candidate_trade)} · ${escapeHTML(app.candidate_location)}</p>
          <p>${escapeHTML(app.job_title || "Untitled Job")}</p>

          <div class="applicant-tags">
            <span>${escapeHTML(app.candidate_experience)}</span>
            <span>${escapeHTML(app.candidate_availability)}</span>
          </div>
        </div>
      </div>

      <div class="applicant-side">
        <span class="status-pill ${escapeHTML(status)}">${escapeHTML(getStatusLabel(status))}</span>
        <span class="applied-date">Applied ${escapeHTML(formatDate(app.created_at))}</span>
      </div>
    </article>
  `;
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

  applicantDetail.innerHTML = `
    <div class="detail-head">
      <div class="avatar">
        ${
          app.candidate_photo
            ? `<img src="${escapeHTML(app.candidate_photo)}" alt="${escapeHTML(app.candidate_name)}">`
            : escapeHTML(initials)
        }
      </div>

      <div>
        <h2>${escapeHTML(app.candidate_name)}</h2>
        <p class="detail-text">${escapeHTML(app.candidate_trade)} · ${escapeHTML(app.candidate_location)}</p>
        <span class="status-pill ${escapeHTML(status)}">${escapeHTML(getStatusLabel(status))}</span>
      </div>
    </div>

    <div class="detail-section">
      <h3>Application</h3>
      <div class="detail-grid">
        <div class="detail-row"><span>Job</span><strong>${escapeHTML(app.job_title || "Untitled Job")}</strong></div>
        <div class="detail-row"><span>Applied</span><strong>${escapeHTML(formatDate(app.created_at))}</strong></div>
        <div class="detail-row"><span>Status</span><strong>${escapeHTML(getStatusLabel(status))}</strong></div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Candidate profile</h3>
      <div class="detail-grid">
        <div class="detail-row"><span>Email</span><strong>${escapeHTML(app.candidate_email || "Not listed")}</strong></div>
        <div class="detail-row"><span>Phone</span><strong>${escapeHTML(app.candidate_phone || "Not listed")}</strong></div>
        <div class="detail-row"><span>Experience</span><strong>${escapeHTML(app.candidate_experience)}</strong></div>
        <div class="detail-row"><span>Availability</span><strong>${escapeHTML(app.candidate_availability)}</strong></div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Skills & certifications</h3>
      <p class="detail-text">${escapeHTML(app.candidate_skills || "No skills listed yet.")}</p>
      <p class="detail-text">${escapeHTML(app.candidate_certifications || "No certifications listed yet.")}</p>
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
          ? `<a class="profile-btn" href="${escapeHTML(app.resume_url)}" target="_blank">Open Resume</a>`
          : `<p class="detail-text">No resume uploaded.</p>`
      }
    </div>
  `;
}

async function updateApplicationStatus(applicationId, status) {
  const updatePayload = {
    status,
    updated_at: new Date().toISOString()
  };

  if (status === "reviewing") updatePayload.reviewed_at = new Date().toISOString();
  if (status === "interview") updatePayload.interview_date = new Date().toISOString();
  if (status === "offer") updatePayload.offer_sent_at = new Date().toISOString();
  if (status === "hired") updatePayload.hired_at = new Date().toISOString();

  const { error } = await applicantsSupabase
    .from("applications")
    .update(updatePayload)
    .eq("id", applicationId)
    .eq("employer_id", currentUser.id);

  if (error) {
    console.error("Status update error:", error);
    showToast("Could not update applicant status.");
    return;
  }

  showToast("Applicant status updated.");
  await loadApplicants();
  selectedApplicationId = applicationId;
  renderDetail();
}

async function messageCandidate(applicationId) {
  const app = allApplications.find((item) => String(item.id) === String(applicationId));

  if (!app) return;

  if (app.conversation_id) {
    window.location.href = `employer-messages.html?conversation=${app.conversation_id}`;
    return;
  }

  const { data: existingConversation } = await applicantsSupabase
    .from("conversations")
    .select("*")
    .eq("candidate_id", app.candidate_id)
    .eq("employer_id", currentUser.id)
    .maybeSingle();

  if (existingConversation) {
    await applicantsSupabase
      .from("applications")
      .update({ conversation_id: existingConversation.id })
      .eq("id", app.id);

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
        candidate_role: app.candidate_trade || app.job_title || null,
        source: "Application",
        status: "Active"
      }
    ])
    .select()
    .single();

  if (error) {
    console.error("Conversation create error:", error);
    showToast("Could not start conversation.");
    return;
  }

  await applicantsSupabase
    .from("applications")
    .update({ conversation_id: conversation.id })
    .eq("id", app.id);

  window.location.href = `employer-messages.html?conversation=${conversation.id}`;
}

function updateCounts() {
  const total = allApplications.length;
  const submitted = countStatus("submitted");
  const reviewing = countStatus("reviewing");
  const interview = countStatus("interview");
  const offer = countStatus("offer");

  setText("totalApplicants", total);
  setText("newApplicants", submitted);
  setText("interviewApplicants", interview);
  setText("offerApplicants", offer);

  setText("countAll", total);
  setText("countSubmitted", submitted);
  setText("countReviewing", reviewing);
  setText("countInterview", interview);
  setText("countOffer", offer);
}

function countStatus(status) {
  return allApplications.filter((app) => normalizeStatus(app.status) === status).length;
}

function normalizeStatus(status) {
  const value = String(status || "submitted").toLowerCase().trim();

  if (["applied", "submitted", "new"].includes(value)) return "submitted";
  if (["review", "reviewing", "viewed", "in review"].includes(value)) return "reviewing";
  if (["interview", "interviewing", "interview requested"].includes(value)) return "interview";
  if (["offer", "offered"].includes(value)) return "offer";
  if (["hired"].includes(value)) return "hired";
  if (["rejected", "declined"].includes(value)) return "rejected";

  return "submitted";
}

function getStatusLabel(status) {
  const labels = {
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

function showToast(message) {
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
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

window.updateApplicationStatus = updateApplicationStatus;
window.messageCandidate = messageCandidate;