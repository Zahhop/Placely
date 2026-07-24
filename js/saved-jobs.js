const savedSupabase = window.PlacelyAuth.client();

const SAVED_JOBS_SELECT = `
  id,
  saved_at,
  job_id,
  jobs (
    id,
    employer_id,
    job_title,
    company_name,
    location,
    employment_type,
    pay_range,
    experience_level,
    job_description,
    status,
    created_at
  )
`;

let currentUser = null;
let currentProfile = {};
let savedRows = [];
let appliedJobIds = [];
let employerProfilesById = {};
let activeBoostsByJob = {};
let pendingRemoveIds = new Set();

const JOB_BOOSTS_ENABLED = window.PLACELY_FEATURES?.jobBoosts === true;

const savedJobsList = document.getElementById("savedJobsList");
const savedCount = document.getElementById("savedCount");
const readyCount = document.getElementById("readyCount");
const newestSave = document.getElementById("newestSave");
const savedResultCount = document.getElementById("savedResultCount");
const savedSearchInput = document.getElementById("savedSearchInput");
const savedStatusFilter = document.getElementById("savedStatusFilter");
const savedHeaderSearchForm = document.getElementById("savedHeaderSearchForm");
const savedHeaderSearchInput = document.getElementById("savedHeaderSearchInput");

document.addEventListener("DOMContentLoaded", initSavedJobs);

async function initSavedJobs() {
  setupEvents();

  try {
    const user = await verifyCandidateAccess(savedSupabase, {
      loginPath: "../candidates/candidate-login.html",
      setupPath: "../candidates/candidate-setup.html",
      employerDashboardPath: "../employers/employer-dashboard.html"
    });

    if (!user) return;
    currentUser = user;

    await Promise.all([
      loadCandidateProfile(user),
      loadSavedJobs(),
      loadAppliedJobIds(user.id)
    ]);

    await Promise.all([
      loadEmployerProfiles(),
      loadActiveBoosts()
    ]);

    hydrateHeader();
    renderSavedJobs();
  } catch (error) {
    console.error("Saved Jobs failed to load", {
      code: error?.code,
      message: error?.message
    });
    renderErrorState();
  } finally {
    document.documentElement.classList.remove("saved-jobs-booting");
  }
}

function setupEvents() {
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
  document.getElementById("accountMenuLogoutBtn")?.addEventListener("click", handleLogout);
  bindAccountMenu();
  bindMobileSidebar();

  savedSearchInput?.addEventListener("input", renderSavedJobs);
  savedStatusFilter?.addEventListener("change", renderSavedJobs);

  savedHeaderSearchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!savedSearchInput || !savedHeaderSearchInput) return;
    savedSearchInput.value = savedHeaderSearchInput.value.trim();
    renderSavedJobs();
    savedSearchInput.focus();
  });
}

async function loadCandidateProfile(user) {
  const { data } = await savedSupabase
    .from("candidate_profiles")
    .select("id, full_name, email, profile_photo_url, profile_photo, avatar_url, photo_url")
    .eq("id", user.id)
    .maybeSingle();

  currentProfile = {
    ...(data || {}),
    email: data?.email || user.email || ""
  };
}

async function loadSavedJobs() {
  console.info("Saved Jobs query started", {
    table: "saved_jobs",
    ownerColumn: "candidate_id",
    select: SAVED_JOBS_SELECT
  });

  const { data, error } = await savedSupabase
    .from("saved_jobs")
    .select(SAVED_JOBS_SELECT)
    .eq("candidate_id", currentUser.id)
    .order("saved_at", { ascending: false });

  if (error) {
    console.error("Saved Jobs Supabase query failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      table: "saved_jobs",
      ownerColumn: "candidate_id"
    });
    throw error;
  }

  savedRows = data || [];
  console.info("Saved Jobs query completed", { count: savedRows.length });
}

async function loadAppliedJobIds(userId) {
  const { data, error } = await savedSupabase
    .from("applications")
    .select("job_id, status")
    .eq("candidate_id", userId)
    .neq("status", "withdrawn");

  appliedJobIds = error ? [] : (data || []).map((row) => String(row.job_id));
}

async function loadEmployerProfiles() {
  const employerIds = [
    ...new Set(savedRows.map((row) => row.jobs?.employer_id).filter(Boolean))
  ];
  employerProfilesById = {};
  if (!employerIds.length) return;

  const { data, error } = await savedSupabase
    .from("public_employer_profiles")
    .select("id, company_name, company_logo_url, company_photo_url, logo_url, company_logo, company_logo_preview")
    .in("id", employerIds);

  if (error) return;

  (data || []).forEach((profile) => {
    employerProfilesById[String(profile.id)] = profile;
  });
}

async function loadActiveBoosts() {
  activeBoostsByJob = {};
  if (!JOB_BOOSTS_ENABLED) return;

  const jobIds = savedRows.map((row) => row.jobs?.id || row.job_id).filter(Boolean);
  if (!jobIds.length) return;

  const { data, error } = await savedSupabase
    .from("job_boosts")
    .select("id, job_id, status, ends_at")
    .in("job_id", jobIds)
    .eq("status", "active")
    .gt("ends_at", new Date().toISOString());

  if (error) return;

  (data || []).forEach((boost) => {
    if (boost.job_id) activeBoostsByJob[String(boost.job_id)] = boost;
  });
}

function renderSavedJobs() {
  const rows = getFilteredRows();

  updateStats();
  setText("savedResultCount", `${rows.length} saved`);

  if (!savedRows.length) {
    savedJobsList.innerHTML = `
      <div class="empty-state">
        <strong>No saved jobs yet</strong>
        <p>Save roles while browsing so you can compare them and apply later.</p>
        <a href="find-jobs.html?role=candidate" class="primary-btn">Find Jobs</a>
      </div>
    `;
    return;
  }

  if (!rows.length) {
    savedJobsList.innerHTML = `
      <div class="empty-state">
        <strong>No matching saved jobs</strong>
        <p>Try a different search or status filter.</p>
      </div>
    `;
    return;
  }

  savedJobsList.innerHTML = rows.map(renderSavedRow).join("");
}

function getFilteredRows() {
  const query = cleanText(savedSearchInput?.value);
  const filter = savedStatusFilter?.value || "all";

  return savedRows.filter((row) => {
    const job = normalizeSavedJob(row);
    const matchesQuery =
      !query ||
      cleanText([job.title, job.company, job.location, job.type, job.experience, job.pay].join(" ")).includes(query);
    const matchesFilter =
      filter === "all" ||
      (filter === "open" && job.isOpen && !job.alreadyApplied) ||
      (filter === "applied" && job.alreadyApplied) ||
      (filter === "closed" && !job.isOpen);

    return matchesQuery && matchesFilter;
  });
}

function renderSavedRow(row) {
  const job = normalizeSavedJob(row);

  if (!row.jobs) {
    return `
      <article class="saved-card">
        <div class="saved-identity">
          <div class="company-avatar">?</div>
          <div>
            <h3>Job no longer available</h3>
            <p class="saved-company">Saved job unavailable</p>
          </div>
        </div>
        <div class="saved-column">Not listed</div>
        <div class="saved-column">Not listed</div>
        <div class="saved-column">Saved ${escapeHTML(formatDate(row.saved_at))}</div>
        <div class="saved-column"><span class="status-pill closed">Unavailable</span></div>
        <div class="saved-actions">
          <button class="danger-btn" type="button" onclick="removeSavedJob('${escapeHTML(row.id)}')">Remove Saved</button>
        </div>
      </article>
    `;
  }

  return `
    <article class="saved-card">
      <div class="saved-identity">
        ${renderCompanyAvatar(job)}
        <div>
          <h3>${escapeHTML(job.title)}</h3>
          <p class="saved-company">${escapeHTML(job.company)}</p>
        </div>
      </div>
      <div class="saved-column saved-location">${escapeHTML(job.location)}<span>${escapeHTML(job.type)}</span></div>
      <div class="saved-column saved-pay">${escapeHTML(job.pay)}</div>
      <div class="saved-column saved-experience">${escapeHTML(job.experience)}</div>
      <div class="saved-column saved-date">Saved ${escapeHTML(formatDate(row.saved_at))}</div>
      <div class="saved-column saved-row-status">
        ${activeBoostsByJob[String(job.id)] ? `<span class="promoted-tag">Promoted</span>` : ""}
        <span class="status-pill ${job.isOpen ? "open" : "closed"}">${job.isOpen ? "Open" : "Unavailable"}</span>
        ${job.alreadyApplied ? `<span class="status-pill applied">Applied</span>` : ""}
      </div>
      <div class="saved-actions">
        ${renderPrimaryAction(job)}
        <button class="danger-btn" type="button" onclick="removeSavedJob('${escapeHTML(row.id)}')">Remove Saved</button>
      </div>
    </article>
  `;
}

function renderPrimaryAction(job) {
  if (job.alreadyApplied) {
    return `<a class="primary-row-btn" href="../candidates/candidate-applications.html">View Application</a>`;
  }

  if (job.isOpen) {
    return `<a class="primary-row-btn" href="../candidates/apply-job.html?job_id=${encodeURIComponent(job.id)}">Apply</a>`;
  }

  return `<a class="secondary-btn" href="find-jobs.html?role=candidate&job=${encodeURIComponent(job.id)}">View Details</a>`;
}

function normalizeSavedJob(row) {
  const job = row.jobs || {};
  const employerProfile = employerProfilesById[String(job.employer_id || "")] || {};
  const company = job.company_name || employerProfile.company_name || "Company";
  const status = normalizeStatus(job.status);

  return {
    id: job.id || row.job_id || "",
    title: job.job_title || "Job no longer available",
    company,
    location: job.location || "Location not listed",
    type: job.employment_type || "Job type not listed",
    experience: job.experience_level || "Experience not listed",
    pay: window.PlacelyAuth.formatCompensationFromRecord(job, job.pay_range || "Pay not listed"),
    isOpen: Boolean(row.jobs) && status === "active",
    alreadyApplied: appliedJobIds.includes(String(job.id || row.job_id || "")),
    logoUrl: getCompanyLogoUrl(employerProfile)
  };
}

function updateStats() {
  const readyRows = savedRows.filter((row) => {
    const job = normalizeSavedJob(row);
    return job.isOpen && !job.alreadyApplied;
  });
  const newestTitle = savedRows.length ? normalizeSavedJob(savedRows[0]).title : "None yet";

  setText("savedCount", savedRows.length);
  setText("readyCount", readyRows.length);
  setText("newestSave", newestTitle || "None yet");
}

async function removeSavedJob(savedRowId) {
  if (!currentUser || !savedRowId || pendingRemoveIds.has(String(savedRowId))) return;

  const row = savedRows.find((item) => String(item.id) === String(savedRowId));
  const jobTitle = row ? normalizeSavedJob(row).title : "this saved job";

  if (!window.confirm(`Remove ${jobTitle} from saved jobs?`)) return;

  pendingRemoveIds.add(String(savedRowId));

  const { error } = await savedSupabase
    .from("saved_jobs")
    .delete()
    .eq("id", savedRowId)
    .eq("candidate_id", currentUser.id);

  pendingRemoveIds.delete(String(savedRowId));

  if (error) {
    showToast("Could not remove saved job.");
    return;
  }

  savedRows = savedRows.filter((item) => String(item.id) !== String(savedRowId));
  renderSavedJobs();
  showToast("Saved job removed.");
}

function renderErrorState() {
  if (!savedJobsList) return;

  savedJobsList.innerHTML = `
    <div class="empty-state">
      <strong>Could not load saved jobs</strong>
      <p>Please refresh the page and try again.</p>
      <button type="button" class="secondary-btn" onclick="window.location.reload()">Retry</button>
    </div>
  `;
}

function hydrateHeader() {
  const fullName = currentProfile.full_name || "Candidate";
  const firstName = fullName.split(" ")[0] || "Candidate";
  const email = currentProfile.email || currentUser?.email || "No email on file";

  setText("topCandidateName", firstName);
  setText("accountMenuCandidateName", fullName);
  setText("accountMenuEmail", email);

  const avatar = document.getElementById("topCandidateAvatar");
  if (!avatar) return;

  const initials = getInitials(fullName || email);
  const photoUrl = resolveCandidatePhotoUrl(currentProfile);
  avatar.innerHTML = photoUrl
    ? `<img src="${escapeHTML(photoUrl)}" alt="" loading="lazy" /><span class="avatar-fallback">${escapeHTML(initials)}</span>`
    : escapeHTML(initials);
}

function bindAccountMenu() {
  const button = document.getElementById("candidateAccountButton");
  const menu = document.getElementById("candidateAccountMenu");
  if (!button || !menu) return;

  const closeMenu = ({ restoreFocus = false } = {}) => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus) button.focus();
  };

  const openMenu = () => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    menu.querySelector("[role='menuitem']")?.focus();
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("click", (event) => {
    if (!menu.hidden && !event.target.closest(".top-account-menu-wrap")) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) closeMenu({ restoreFocus: true });
  });
}

function bindMobileSidebar() {
  const toggle = document.getElementById("sidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");
  if (!toggle || !backdrop) return;

  const setSidebarOpen = (isOpen) => {
    document.body.classList.toggle("sidebar-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    backdrop.hidden = !isOpen;
  };

  toggle.addEventListener("click", () => setSidebarOpen(!document.body.classList.contains("sidebar-open")));
  backdrop.addEventListener("click", () => setSidebarOpen(false));

  document.querySelectorAll(".candidate-nav-link").forEach((link) => {
    link.addEventListener("click", () => setSidebarOpen(false));
  });
}

function renderCompanyAvatar(job) {
  if (job.logoUrl) {
    return `
      <div class="company-avatar">
        <img src="${escapeHTML(job.logoUrl)}" alt="${escapeHTML(job.company)} logo" loading="lazy">
      </div>
    `;
  }

  return `<div class="company-avatar">${escapeHTML(getInitials(job.company))}</div>`;
}

function getCompanyLogoUrl(source) {
  if (!source) return "";

  const value =
    source.company_logo_url ||
    source.company_photo_url ||
    source.logo_url ||
    source.company_logo ||
    source.company_logo_preview ||
    "";

  if (!value) return "";
  if (/^https?:\/\//i.test(String(value))) return value;
  return window.PlacelyAuth?.getPublicImageUrl?.(savedSupabase, "employer-logos", value) || String(value || "");
}

function resolveCandidatePhotoUrl(profile) {
  const rawUrl = profile.profile_photo_url || profile.profile_photo || profile.avatar_url || profile.photo_url || "";
  if (!rawUrl) return "";
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  return window.PlacelyAuth.getPublicImageUrl(savedSupabase, "candidate-photos", rawUrl);
}

function normalizeStatus(status) {
  const clean = String(status || "active").toLowerCase().trim();
  if (["draft", "drafts"].includes(clean)) return "draft";
  if (["paused", "inactive", "closed", "archived", "deleted", "removed", "expired"].includes(clean)) return "closed";
  return "active";
}

function cleanText(value) {
  return String(value || "").toLowerCase().trim();
}

function formatDate(value) {
  if (!value) return "Not listed";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not listed";

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function getInitials(name) {
  return String(name || "PT")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2500);
}

async function handleLogout() {
  try {
    await window.PlacelyAuth.clearAuthState();
  } catch {
    sessionStorage.removeItem("placelyAuthGuardRedirecting");
  }

  window.location.replace("../candidates/candidate-login.html");
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.removeSavedJob = removeSavedJob;
