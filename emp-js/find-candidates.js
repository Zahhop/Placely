const employerSupabase = window.employerSupabase;

const candidatesGrid = document.getElementById("candidatesGrid");
const emptyState = document.getElementById("emptyState");
const resultsText = document.getElementById("resultsText");
const accessStateText = document.getElementById("accessStateText");
const activeFilterChips = document.getElementById("activeFilterChips");
const upgradeBanner = document.getElementById("upgradeBanner");

const recommendedSignal = document.getElementById("recommendedSignal");
const resultCount = document.getElementById("resultCount");
const savedCount = document.getElementById("savedCount");
const fastStartCount = document.getElementById("fastStartCount");
const newThisWeekCount = document.getElementById("newThisWeekCount");

const keywordInput = document.getElementById("keywordInput");
const tradeFilter = document.getElementById("tradeFilter");
const cityFilter = document.getElementById("cityFilter");
const experienceFilter = document.getElementById("experienceFilter");
const availabilityFilter = document.getElementById("availabilityFilter");
const certificationFilter = document.getElementById("certificationFilter");
const sortFilter = document.getElementById("sortFilter");
const candidateSearchForm = document.getElementById("candidateSearchForm");

const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const emptyClearBtn = document.getElementById("emptyClearBtn");
const upgradeAccessBtn = document.getElementById("upgradeAccessBtn");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const loadMoreWrap = document.getElementById("loadMoreWrap");

const candidateDetailPanel = document.getElementById("candidateDetailPanel");
const candidateDetailContent = document.getElementById("candidateDetailContent");
const closePanelBtn = document.getElementById("closePanelBtn");
const panelOverlay = document.getElementById("panelOverlay");
const logoutBtn = document.getElementById("logoutBtn");

let currentUser = null;
let employerAccess = {
  candidate_access: false
};
let candidateAccessState = { state: "denied", status: "missing", active: false, pending: false };
let hasCandidateAccess = false;
let loadedCandidates = [];
let filteredCandidates = [];
let savedCandidates = new Set();
let savedTalentRowsByCandidateId = new Map();
let saveMutationIds = new Set();
let activeSummaryFilter = "recommended";
let selectedCandidateId = null;
let visibleResultLimit = 50;
let lastFocusedElement = null;
let employerProfile = {};
let activeJobs = [];
let savedRefreshWarningShown = false;

const PAGE_SIZE = 50;
const NOT_LISTED = "Not listed";

document.addEventListener("DOMContentLoaded", initFindCandidates);

async function initFindCandidates() {
  setupEvents();

  const user = await requireEmployerLogin();
  if (!user) return;

  currentUser = user;
  candidateAccessState = await window.PlacelyAuth.requireEmployerCandidateAccess(employerSupabase, user.id, {
    attempts: 5,
    delayMs: 1800,
    onPending: () => renderPendingAccessState()
  });
  employerAccess = candidateAccessState;
  hasCandidateAccess = candidateAccessState.active;
  await loadEmployerRecruitingContext(user.id);

  renderAccessState();

  if (!hasCandidateAccess) {
    if (candidateAccessState.pending) {
      renderPendingAccessState(true);
      return;
    }

    redirectToCandidateAccess();
    return;
  }

  const loaded = await loadCandidates();
  if (!loaded) return;

  await loadSavedCandidates();
  applyFilters();
}

function setupEvents() {
  if (candidateSearchForm) {
    candidateSearchForm.addEventListener("submit", (event) => event.preventDefault());
  }

  const debouncedApplyFilters = debounce(() => applyFilters(), 240);

  [keywordInput, cityFilter, certificationFilter].forEach((input) => {
    if (!input) return;
    input.addEventListener("input", debouncedApplyFilters);
  });

  [tradeFilter, experienceFilter, availabilityFilter, sortFilter].forEach((input) => {
    if (!input) return;
    input.addEventListener("change", () => applyFilters());
  });

  if (clearFiltersBtn) clearFiltersBtn.addEventListener("click", clearFilters);
  if (emptyClearBtn) {
    emptyClearBtn.addEventListener("click", () => {
      if (emptyState?.dataset.state === "error") {
        loadCandidates();
        return;
      }

      if (emptyState?.dataset.state === "locked") {
        window.location.href = "employer-dashboard.html";
        return;
      }

      clearFilters();
    });
  }
  if (upgradeAccessBtn) upgradeAccessBtn.addEventListener("click", startCandidateCheckoutFromSearch);
  if (loadMoreBtn) loadMoreBtn.addEventListener("click", loadMoreCandidates);

  if (closePanelBtn) closePanelBtn.addEventListener("click", closeCandidatePanel);
  if (panelOverlay) panelOverlay.addEventListener("click", closeCandidatePanel);

  document.querySelectorAll(".summary-pill").forEach((button, index) => {
    const filter = ["recommended", "available", "new", "saved"][index] || "recommended";
    button.dataset.summaryFilter = filter;
    button.setAttribute("aria-pressed", filter === activeSummaryFilter ? "true" : "false");
    button.setAttribute("aria-label", `${getSummaryFilterLabel(filter)} view`);
    button.addEventListener("click", () => setSummaryFilter(filter));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && candidateDetailPanel?.classList.contains("open")) {
      closeCandidatePanel();
    }

    if (event.key === "Tab" && candidateDetailPanel?.classList.contains("open")) {
      trapDrawerFocus(event);
    }
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await window.PlacelyAuth.clearAuthState();
      window.location.replace("employer-login.html");
    });
  }
}

async function requireEmployerLogin() {
  return verifyEmployerAccess(employerSupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });
}

async function loadCandidates() {
  resultsText.textContent = "Loading candidates...";
  renderLoadingRows();

  const paidColumns = "*";
  const previewColumns = "id, trade, location, experience, availability, skills, certifications, created_at, profile_visible";

  try {
    const { data: candidates, error } = await employerSupabase
      .from("candidate_profiles")
      .select(hasCandidateAccess ? paidColumns : previewColumns)
      .eq("profile_visible", true)
      .order("created_at", { ascending: false });

    if (error) throw error;

    loadedCandidates = dedupeCandidates(candidates || []);
    filteredCandidates = [...loadedCandidates];

    populateTradeFilter();
    applyFilters();
    return true;
  } catch {
    loadedCandidates = [];
    filteredCandidates = [];
    updateStats();
    renderLoadError();
    return false;
  }
}

async function loadEmployerRecruitingContext(userId) {
  employerProfile = {};
  activeJobs = [];

  try {
    const [profileResult, jobsResult] = await Promise.all([
      employerSupabase
        .from("employer_profiles")
        .select("company_location, industry, main_hiring_industry, employment_type, hiring_timeline, candidate_qualities")
        .eq("id", userId)
        .maybeSingle(),
      employerSupabase
        .from("jobs")
        .select("id, job_title, location, required_skills, experience_level, employment_type, status, created_at")
        .eq("employer_id", userId)
        .order("created_at", { ascending: false })
    ]);

    if (!profileResult.error && profileResult.data) employerProfile = profileResult.data;

    if (!jobsResult.error) {
      activeJobs = (jobsResult.data || []).filter((job) => normalizeJobStatus(job.status) === "active");
    }
  } catch {
    employerProfile = {};
    activeJobs = [];
  }
}

function applyFilters() {
  visibleResultLimit = PAGE_SIZE;
  const keyword = clean(keywordInput.value);
  const trade = clean(tradeFilter.value);
  const city = clean(cityFilter.value);
  const experience = clean(experienceFilter.value);
  const availability = clean(availabilityFilter.value);
  const certification = clean(certificationFilter.value);

  filteredCandidates = loadedCandidates.filter((candidate) => {
    const skills = getSplitValues(candidate.skills).join(" ");
    const certifications = getSplitValues(candidate.certifications).join(" ");
    const searchable = clean([
      hasCandidateAccess ? candidate.full_name : "",
      candidate.trade,
      candidate.location,
      candidate.experience,
      candidate.availability,
      hasCandidateAccess ? candidate.bio : "",
      skills,
      certifications
    ].join(" "));

    const matchesKeyword = !keyword || searchable.includes(keyword);
    const matchesTrade = !trade || clean(candidate.trade) === trade || clean(candidate.trade).includes(trade) || clean(skills).includes(trade);
    const matchesCity = !city || clean(candidate.location).includes(city);
    const matchesExperience = !experience || candidateMatchesExperience(candidate, experience);
    const matchesAvailability = !availability || candidateMatchesAvailability(candidate, availability);
    const matchesCertification =
      !certification ||
      clean(certifications).includes(certification) ||
      clean(skills).includes(certification);
    const matchesSummary = matchesSummaryFilter(candidate);

    return (
      matchesKeyword &&
      matchesTrade &&
      matchesCity &&
      matchesExperience &&
      matchesAvailability &&
      matchesCertification &&
      matchesSummary
    );
  });

  sortCandidates();
  renderCandidates();
  updateStats();
  renderActiveFilterChips();
  updateSummaryPills();
}

function sortCandidates() {
  const sort = sortFilter.value;

  filteredCandidates.sort((a, b) => {
    if (sort === "recommended") return getCandidateRecommendationRank(b) - getCandidateRecommendationRank(a);
    if (sort === "experience") return getExperienceYears(b.experience) - getExperienceYears(a.experience);
    if (sort === "availability") return getAvailabilityRank(a.availability) - getAvailabilityRank(b.availability);
    if (sort === "name") return getDisplayName(a).localeCompare(getDisplayName(b));

    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
}

function renderCandidates() {
  candidatesGrid.innerHTML = "";
  candidatesGrid.removeAttribute("aria-busy");
  emptyState.dataset.state = "";

  if (!filteredCandidates.length) {
    emptyState.classList.remove("hidden");
    loadMoreWrap?.classList.add("hidden");
    resultsText.textContent = getEmptyResultsText();
    selectedCandidateId = null;
    renderDetailEmpty();
    return;
  }

  emptyState.classList.add("hidden");
  resultsText.textContent = getResultsText();

  if (selectedCandidateId && !filteredCandidates.some((candidate) => String(candidate.id) === String(selectedCandidateId))) {
    selectedCandidateId = null;
  }

  filteredCandidates.slice(0, visibleResultLimit).forEach((candidate, index) => {
    candidatesGrid.appendChild(createCandidateRow(candidate, index));
  });

  if (loadMoreWrap && loadMoreBtn) {
    const hasMore = filteredCandidates.length > visibleResultLimit;
    loadMoreWrap.classList.toggle("hidden", !hasMore);
    loadMoreBtn.textContent = `Load more candidates (${filteredCandidates.length - visibleResultLimit} remaining)`;
  }
}

function createCandidateRow(candidate, index) {
  const row = document.createElement("article");

  const id = String(candidate.id);
  const isSelected = String(selectedCandidateId) === id;
  const name = getDisplayName(candidate, index);
  const trade = formatDisplayValue(candidate.trade, "Trade not listed");
  const location = formatDisplayValue(candidate.location, "Location not listed");
  const experience = normalizeExperienceLabel(candidate.experience);
  const availability = normalizeAvailabilityLabel(candidate.availability);
  const tags = getCandidateTags(candidate);
  const isSaved = isCandidateSaved(id);
  const contextLabel = getCandidateContextLabel(candidate);

  row.className = `candidate-row${hasCandidateAccess ? "" : " locked"}${isSelected ? " active" : ""}`;
  row.dataset.id = id;
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", `${hasCandidateAccess ? `View ${name}'s profile` : "Preview locked candidate profile"}`);

  row.innerHTML = `
    <div class="candidate-identity">
      <div class="avatar">
        ${
          hasCandidateAccess && getCandidatePhotoUrl(candidate.profile_photo_url)
            ? `<img src="${escapeAttribute(getCandidatePhotoUrl(candidate.profile_photo_url))}" alt="Candidate photo">`
            : `${escapeHTML(getInitials(name))}`
        }
      </div>

      <div>
        <h3 class="candidate-name">${escapeHTML(name)}</h3>
        <p class="candidate-title">${escapeHTML(trade)}</p>
        <p class="candidate-meta sensitive">${escapeHTML(location)}</p>
        ${contextLabel ? `<p class="candidate-context-label">${escapeHTML(contextLabel)}</p>` : ""}
      </div>
    </div>

    <div class="candidate-cell experience-cell">
      <strong>${escapeHTML(experience)}</strong>
    </div>

    <div class="candidate-cell">
      <strong>${escapeHTML(availability)}</strong>
    </div>

    <div>
      <div class="tag-row">
        ${tags.length ? tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("") : `<span>Skills not listed</span>`}
      </div>
    </div>

    <div class="row-status">
      ${isSaved ? `<span class="saved-pill">Saved</span>` : ""}
      ${hasCandidateAccess ? "" : `<span class="locked-pill">Unlock</span>`}
      <button type="button" class="row-chevron" data-action="view" data-id="${escapeAttribute(id)}" aria-label="${escapeAttribute(hasCandidateAccess ? `View ${name}'s profile` : "Preview candidate profile")}">
        <span aria-hidden="true">&rsaquo;</span>
      </button>
    </div>
  `;

  row.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    const action = button?.dataset.action;

    selectedCandidateId = id;
    renderCandidates();

    if (action === "save") {
      event.stopPropagation();
      toggleSaveCandidate(candidate);
      return;
    }

    if (action === "message") {
      event.stopPropagation();
      startMessageWithCandidate(candidate);
      return;
    }

    openCandidatePanel();
  });

  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectedCandidateId = id;
    renderCandidates();
    openCandidatePanel();
  });

  return row;
}

function renderSelectedCandidateDetail() {
  const selected = filteredCandidates.find((candidate) => String(candidate.id) === String(selectedCandidateId));

  if (!selected) {
    renderDetailEmpty();
    return;
  }

  if (!hasCandidateAccess) {
    renderLockedDetail();
    return;
  }

  renderCandidateDetail(selected);
}

function renderCandidateDetail(candidate) {
  const skills = getSplitValues(candidate.skills);
  const certifications = getSplitValues(candidate.certifications);
  const candidateId = String(candidate.id);
  const isSaved = isCandidateSaved(candidateId);
  const isSaving = saveMutationIds.has(candidateId);
  const name = formatDisplayValue(candidate.full_name, "Candidate");
  const trade = formatDisplayValue(candidate.trade, "Trade not listed");
  const location = formatDisplayValue(candidate.location, "Location not listed");
  const availability = normalizeAvailabilityLabel(candidate.availability);
  const experience = normalizeExperienceLabel(candidate.experience);
  const bio = formatLongDisplayValue(candidate.bio, "No profile summary listed yet.");
  const preferredContact = formatDisplayValue(candidate.contact_method || candidate.shown_contact_method, "Not listed");
  const email = formatDisplayValue(candidate.email, "Email not listed");
  const phone = formatDisplayValue(candidate.phone, "Phone not listed");
  const visibleContact = window.PlacelyAuth.getVisibleCandidateContact(candidate);
  const hasResume = Boolean(normalizeText(candidate.resume_path || candidate.resume_url));
  const createdAt = formatDate(candidate.created_at);

  candidateDetailContent.innerHTML = `
    <div class="profile-drawer">
      <div class="profile-drawer-header">
        <div class="detail-head">
          <div class="avatar large">
            ${
              getCandidatePhotoUrl(candidate.profile_photo_url)
                ? `<img src="${escapeAttribute(getCandidatePhotoUrl(candidate.profile_photo_url))}" alt="Candidate photo">`
                : `${escapeHTML(getInitials(name))}`
            }
          </div>

          <div>
            <h2 class="detail-name">${escapeHTML(name)}</h2>
            <div class="detail-trade">${escapeHTML(trade)}</div>
            <p class="drawer-location">${escapeHTML(location)}</p>
          </div>
        </div>

        <div class="detail-quick-meta">
          <span>${escapeHTML(availability)}</span>
          <span>${escapeHTML(experience)}</span>
        </div>
      </div>

      <div class="drawer-action-bar">
        <button
          type="button"
          class="row-action ${isSaved ? "saved" : ""}"
          id="detailSaveBtn"
          aria-pressed="${isSaved ? "true" : "false"}"
          aria-label="${escapeAttribute(isSaved ? `Remove ${name} from saved talent` : `Save ${name} to saved talent`)}"
          ${isSaving ? "disabled" : ""}
        >${escapeHTML(getSaveButtonText(isSaved, isSaving))}</button>
        <button type="button" class="row-action primary" id="detailMessageBtn">Message Candidate</button>
      </div>

      <section class="profile-section about-section">
        <div class="section-kicker">About</div>
        <p class="profile-about" id="profileAboutText">${escapeHTML(bio)}</p>
      </section>

      <section class="profile-section">
        <div class="section-kicker">Profile Snapshot</div>
        <dl class="profile-snapshot">
          ${renderSnapshotItem("Location", location)}
          ${renderSnapshotItem("Experience", experience)}
          ${renderSnapshotItem("Availability", availability)}
          ${renderSnapshotItem("Preferred contact", preferredContact)}
          ${createdAt !== "-" ? renderSnapshotItem("Joined", createdAt) : ""}
        </dl>
      </section>

      <section class="profile-section">
        <div class="section-kicker">Contact</div>
        <div class="profile-contact-list">
          ${renderContactRow("Preferred contact", preferredContact)}
          ${visibleContact.showEmail ? renderContactRow("Email", email) : ""}
          ${visibleContact.showPhone ? renderContactRow("Phone", phone) : ""}
        </div>
      </section>

      <section class="profile-section">
        <div class="section-heading-row">
          <div class="section-kicker">Skills</div>
          ${skills.length > 8 ? `<button type="button" class="chip-toggle" data-chip-toggle="skills">Show all</button>` : ""}
        </div>
        <div class="drawer-chip-row" data-chip-list="skills">
          ${renderDrawerChips(skills, "No skills listed")}
        </div>
      </section>

      <section class="profile-section">
        <div class="section-heading-row">
          <div class="section-kicker">Certifications</div>
          ${certifications.length > 8 ? `<button type="button" class="chip-toggle" data-chip-toggle="certifications">Show all</button>` : ""}
        </div>
        <div class="drawer-chip-row" data-chip-list="certifications">
          ${renderDrawerChips(certifications, "No certifications listed")}
        </div>
      </section>

      ${
        hasResume
          ? `<section class="profile-section resume-section">
              <div>
                <div class="section-kicker">Resume</div>
                <p>Open the candidate's uploaded resume.</p>
              </div>
              <button class="row-action" type="button" data-resume-candidate-id="${escapeAttribute(candidate.id)}">View resume</button>
            </section>`
          : ""
      }
    </div>
  `;

  document.getElementById("detailSaveBtn").addEventListener("click", () => {
    toggleSaveCandidate(candidate);
  });

  document.getElementById("detailMessageBtn").addEventListener("click", () => {
    startMessageWithCandidate(candidate);
  });

  candidateDetailContent.querySelector("[data-resume-candidate-id]")?.addEventListener("click", () => {
    openCandidateResume(candidate.id);
  });

  candidateDetailContent.querySelectorAll("[data-chip-toggle]").forEach((button) => {
    button.addEventListener("click", () => toggleChipList(button));
  });

  candidateDetailPanel.setAttribute("aria-hidden", "false");
  candidateDetailPanel.classList.add("open");
  panelOverlay.classList.add("open");
  focusDrawer();
}

function renderLockedDetail() {
  candidateDetailContent.innerHTML = `
    <div class="locked-detail-card">
      <div class="empty-icon">PT</div>
      <h3>Unlock Candidate Network</h3>
      <p>Search verified trades candidates, view full profiles, save talent, and message candidates.</p>
      <div class="detail-actions">
        <button type="button" class="row-action primary" id="detailUpgradeBtn">Upgrade Access</button>
      </div>
    </div>
  `;

  document.getElementById("detailUpgradeBtn").addEventListener("click", showUpgradeComingSoon);
  candidateDetailPanel.setAttribute("aria-hidden", "false");
  candidateDetailPanel.classList.add("open");
  panelOverlay.classList.add("open");
  focusDrawer();
}

function renderDetailEmpty() {
  candidateDetailContent.innerHTML = `
    <div class="empty-detail-card">
      <div class="empty-icon">PT</div>
      <h3>Select a candidate to view profile details</h3>
      <p>Profile details, skills, certifications, and contact options will appear here after you choose someone from the list.</p>
    </div>
  `;
}

function openCandidatePanel() {
  renderSelectedCandidateDetail();
}

function closeCandidatePanel() {
  candidateDetailPanel.classList.remove("open");
  candidateDetailPanel.setAttribute("aria-hidden", "true");
  panelOverlay.classList.remove("open");
  if (lastFocusedElement?.focus) {
    lastFocusedElement.focus();
    lastFocusedElement = null;
  }
}

async function toggleSaveCandidate(candidate) {
  if (!hasCandidateAccess) {
    showUpgradeComingSoon();
    return;
  }

  const id = String(candidate.id);
  if (!id) {
    showToast("Could not save this candidate.");
    return;
  }

  if (saveMutationIds.has(id)) return;

  const savedDates = getSavedDates();
  const previousSavedCandidates = new Set(savedCandidates);
  const previousSavedRows = new Map(savedTalentRowsByCandidateId);
  const wasSaved = isCandidateSaved(id);

  saveMutationIds.add(id);
  renderSaveState(candidate);

  if (wasSaved) {
    savedCandidates.delete(id);
    savedTalentRowsByCandidateId.delete(id);
  } else {
    savedCandidates.add(id);
  }

  renderSaveState(candidate);

  try {
    if (wasSaved) {
      const removed = await removeSavedTalentRecord(id, previousSavedRows.get(id));
      if (!removed) throw new Error("No saved talent row was deleted.");

      delete savedDates[id];
      showToast("Candidate removed from saved talent.");
    } else {
      const savedRow = await saveTalentRecord(id);
      if (!savedRow) throw new Error("Saved talent row was not returned.");

      savedTalentRowsByCandidateId.set(id, savedRow);
      savedCandidates.add(id);
      savedDates[id] = savedRow.created_at || new Date().toISOString();
      showToast("Candidate saved.");
    }

    localStorage.setItem("placelySavedCandidates", JSON.stringify([...savedCandidates]));
    localStorage.setItem("placelySavedCandidateDates", JSON.stringify(savedDates));
  } catch {
    savedCandidates = previousSavedCandidates;
    savedTalentRowsByCandidateId = previousSavedRows;
    showToast(wasSaved ? "Could not remove candidate." : "Could not save candidate.");
  } finally {
    saveMutationIds.delete(id);
    renderSaveState(candidate);
  }
}

async function startMessageWithCandidate(candidate) {
  if (!hasCandidateAccess) {
    showUpgradeComingSoon();
    return;
  }

  if (!currentUser) return;

  if (!candidate?.id) {
    showToast("Could not open this candidate.");
    return;
  }

  window.location.href = `employer-messages.html?candidate_id=${encodeURIComponent(candidate.id)}`;
}

async function openCandidateResume(candidateId) {
  if (!hasCandidateAccess) {
    showUpgradeComingSoon();
    return;
  }

  if (!candidateId) {
    showToast("Resume could not be opened.");
    return;
  }

  const { data, error } = await employerSupabase.functions.invoke("get-candidate-resume-url", {
    body: {
      candidate_id: candidateId
    }
  });

  if (error || !data?.url) {
    showToast(data?.error || "Resume could not be opened.");
    return;
  }

  window.open(data.url, "_blank", "noopener");
}

async function getEmployerName(userId) {
  const { data: profileById } = await employerSupabase
    .from("employer_profiles")
    .select("company_name")
    .eq("id", userId)
    .maybeSingle();

  return profileById?.company_name || "Employer";
}

async function loadSavedCandidates() {
  savedCandidates = new Set();
  savedTalentRowsByCandidateId = new Map();

  if (!currentUser) return;

  try {
    const { data, error } = await employerSupabase
      .from("saved_talent")
      .select("*")
      .eq("employer_id", currentUser.id);

    if (error) throw error;

    savedTalentRowsByCandidateId = buildSavedTalentMap(data || []);
    savedCandidates = new Set(savedTalentRowsByCandidateId.keys());
    localStorage.setItem("placelySavedCandidates", JSON.stringify([...savedCandidates]));
    savedRefreshWarningShown = false;
  } catch {
    if (!savedRefreshWarningShown) {
      showToast("Saved candidates could not be refreshed.");
      savedRefreshWarningShown = true;
    }
    return;
  }
}

function getLocalSavedCandidateIds() {
  try {
    const saved = JSON.parse(localStorage.getItem("placelySavedCandidates")) || [];
    return saved.map(String);
  } catch {
    return [];
  }
}

async function saveTalentRecord(candidateId) {
  const { data: existing, error: existingError } = await employerSupabase
    .from("saved_talent")
    .select("*")
    .eq("employer_id", currentUser.id)
    .eq("candidate_id", candidateId)
    .limit(10);

  if (existingError) {
    throw existingError;
  }

  if (existing?.length) {
    const map = buildSavedTalentMap(existing);
    const row = map.get(String(candidateId)) || existing[0];
    return row;
  }

  const { data, error } = await employerSupabase
    .from("saved_talent")
    .insert([{ employer_id: currentUser.id, candidate_id: candidateId }])
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || {
    employer_id: currentUser.id,
    candidate_id: candidateId,
    created_at: new Date().toISOString()
  };
}

async function removeSavedTalentRecord(candidateId, savedRowOverride = null) {
  const id = String(candidateId);
  const savedRow = savedRowOverride || savedTalentRowsByCandidateId.get(id);

  let deletedRows = [];

  if (savedRow?.id) {
    const { data, error } = await employerSupabase
      .from("saved_talent")
      .delete()
      .eq("id", savedRow.id)
      .eq("employer_id", currentUser.id)
      .select("id, candidate_id, employer_id");

    if (error) throw error;
    deletedRows = data || [];
  }

  if (!deletedRows.length) {
    const { data, error } = await employerSupabase
      .from("saved_talent")
      .delete()
      .eq("employer_id", currentUser.id)
      .eq("candidate_id", id)
      .select("id, candidate_id, employer_id");

    if (error) throw error;
    deletedRows = data || [];
  }

  return deletedRows.length > 0;
}

function clearFilters() {
  keywordInput.value = "";
  tradeFilter.value = "";
  cityFilter.value = "";
  experienceFilter.value = "";
  availabilityFilter.value = "";
  certificationFilter.value = "";
  sortFilter.value = "recommended";
  activeSummaryFilter = "recommended";
  visibleResultLimit = PAGE_SIZE;

  filteredCandidates = [...loadedCandidates];

  sortCandidates();
  renderCandidates();
  updateStats();
  renderActiveFilterChips();
  updateSummaryPills();
}

function updateStats() {
  if (recommendedSignal) recommendedSignal.textContent = "View";
  const showCount = shouldShowResultCount();
  if (resultCount?.parentElement) resultCount.parentElement.hidden = !showCount;
  resultCount.textContent = showCount ? filteredCandidates.length : "";
  savedCount.textContent = savedCandidates.size;

  fastStartCount.textContent = "Ready";

  if (newThisWeekCount) {
    newThisWeekCount.textContent = "New";
  }
}

function renderAccessState() {
  if (hasCandidateAccess) {
    upgradeBanner.classList.add("hidden");
    accessStateText.textContent = "Full candidate access enabled";
    return;
  }

  upgradeBanner.classList.remove("hidden");
  accessStateText.textContent = candidateAccessState.pending
    ? "Payment is still processing"
    : "Candidate Network access required";
}

function redirectToCandidateAccess() {
  window.location.replace("employer-dashboard.html#candidate-access");
}

function renderPendingAccessState(finalAttempt = false) {
  candidateAccessState = {
    state: "pending",
    status: "pending",
    active: false,
    pending: true,
    message: "Payment is still processing."
  };
  hasCandidateAccess = false;
  renderAccessState();
  renderLockedNetworkState({
    title: "Payment is still processing",
    message: finalAttempt
      ? "Stripe payment was received, but Candidate Access has not been activated yet. Return to the dashboard and try again in a moment."
      : "Placely is waiting for Stripe to confirm your Candidate Access before opening candidate search.",
    action: finalAttempt ? "Return to Dashboard" : "Checking access..."
  });
}

function renderLockedNetworkState(options = {}) {
  loadedCandidates = [];
  filteredCandidates = [];
  savedCandidates = new Set();
  savedTalentRowsByCandidateId = new Map();

  candidatesGrid.innerHTML = "";
  candidatesGrid.removeAttribute("aria-busy");
  loadMoreWrap?.classList.add("hidden");
  if (activeFilterChips) activeFilterChips.innerHTML = "";

  if (resultCount?.parentElement) resultCount.parentElement.hidden = true;
  resultsText.textContent = options.message || "Upgrade Candidate Network access to search and view candidate profiles.";
  if (recommendedSignal) recommendedSignal.textContent = "Locked";
  if (fastStartCount) fastStartCount.textContent = "Locked";
  if (newThisWeekCount) newThisWeekCount.textContent = "Locked";
  if (savedCount) savedCount.textContent = "0";

  if (emptyState) {
    emptyState.dataset.state = "locked";
    emptyState.classList.remove("hidden");
  }

  const emptyTitle = emptyState?.querySelector("h3");
  const emptyMessage = emptyState?.querySelector("p");

  if (emptyTitle) emptyTitle.textContent = options.title || "Candidate Network access required";
  if (emptyMessage) emptyMessage.textContent = options.message || "Upgrade access to search visible candidate profiles, save talent, and message candidates.";
  if (emptyClearBtn) emptyClearBtn.textContent = options.action || "Back to Dashboard";
}

function setSummaryFilter(filter) {
  activeSummaryFilter = filter || "recommended";
  if (filter === "recommended" && sortFilter.value !== "recommended") {
    sortFilter.value = "recommended";
  }
  applyFilters();
}

function updateSummaryPills() {
  document.querySelectorAll(".summary-pill").forEach((button) => {
    const isActive = button.dataset.summaryFilter === activeSummaryFilter;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function matchesSummaryFilter(candidate) {
  if (activeSummaryFilter === "available") return candidateMatchesAvailability(candidate, "immediately");
  if (activeSummaryFilter === "saved") return isCandidateSaved(candidate.id);
  if (activeSummaryFilter === "new") return isWithinLastDays(candidate.created_at, 7);
  return true;
}

function renderActiveFilterChips() {
  if (!activeFilterChips) return;

  const chips = [
    keywordInput.value && { label: `Keyword: ${normalizeText(keywordInput.value)}`, action: () => (keywordInput.value = "") },
    cityFilter.value && { label: `Location: ${normalizeText(cityFilter.value)}`, action: () => (cityFilter.value = "") },
    tradeFilter.value && { label: `Trade: ${getSelectedLabel(tradeFilter)}`, action: () => (tradeFilter.value = "") },
    experienceFilter.value && { label: `Experience: ${getSelectedLabel(experienceFilter)}`, action: () => (experienceFilter.value = "") },
    availabilityFilter.value && { label: `Availability: ${getSelectedLabel(availabilityFilter)}`, action: () => (availabilityFilter.value = "") },
    certificationFilter.value && { label: `Skills: ${normalizeText(certificationFilter.value)}`, action: () => (certificationFilter.value = "") },
    activeSummaryFilter !== "recommended" && { label: `View: ${getSummaryFilterLabel(activeSummaryFilter)}`, action: () => (activeSummaryFilter = "recommended") }
  ].filter(Boolean);

  activeFilterChips.innerHTML = "";

  chips.forEach((chip) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip";
    button.innerHTML = `<span>${escapeHTML(chip.label)}</span><span aria-hidden="true">&times;</span>`;
    button.setAttribute("aria-label", `Remove ${chip.label} filter`);
    button.addEventListener("click", () => {
      chip.action();
      applyFilters();
    });
    activeFilterChips.appendChild(button);
  });

  if (chips.length) {
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "filter-chip clear-chip";
    clearButton.textContent = "Clear all";
    clearButton.addEventListener("click", clearFilters);
    activeFilterChips.appendChild(clearButton);
  }
}

function renderSaveState(candidate) {
  renderCandidates();
  updateStats();
  renderActiveFilterChips();
  updateSummaryPills();

  if (candidateDetailPanel.classList.contains("open")) {
    renderSelectedCandidateDetail();
  }
}

function shouldShowResultCount() {
  return Boolean(
    keywordInput.value ||
    cityFilter.value ||
    tradeFilter.value ||
    experienceFilter.value ||
    availabilityFilter.value ||
    certificationFilter.value ||
    activeSummaryFilter === "available" ||
    activeSummaryFilter === "new" ||
    activeSummaryFilter === "saved"
  );
}

function getCandidateRecommendationRank(candidate) {
  let rank = 0;

  if (matchesActiveJobTrade(candidate)) rank += 40;
  if (matchesActiveJobSkills(candidate)) rank += 28;
  if (matchesActiveJobLocation(candidate)) rank += 20;
  if (candidateMatchesAvailability(candidate, "immediately")) rank += 12;
  if (isCandidateSaved(candidate.id)) rank += 8;
  rank += getProfileCompletenessScore(candidate);
  if (isWithinLastDays(candidate.created_at, 14)) rank += 4;
  rank += Math.min(getExperienceYears(candidate.experience), 10);

  const createdAt = new Date(candidate.created_at || 0).getTime();
  return rank * 10000000000000 + (Number.isFinite(createdAt) ? createdAt : 0);
}

function getCandidateContextLabel(candidate) {
  if (isCandidateSaved(candidate.id)) return "Saved";
  if (matchesActiveJobTrade(candidate) || matchesActiveJobSkills(candidate)) return "Matches an active job";
  if (matchesActiveJobLocation(candidate)) return "Near a job location";
  if (candidateMatchesAvailability(candidate, "immediately")) return "Available now";
  if (isWithinLastDays(candidate.created_at, 14)) return "Recently joined";
  return "";
}

function matchesActiveJobTrade(candidate) {
  const candidateTrade = clean(candidate.trade);
  if (!candidateTrade) return false;

  return activeJobs.some((job) => {
    return clean([job.job_title, job.required_skills, job.experience_level].join(" ")).includes(candidateTrade) ||
      candidateTrade.includes(clean(job.job_title));
  }) || clean(employerProfile.main_hiring_industry || employerProfile.industry).includes(candidateTrade);
}

function matchesActiveJobSkills(candidate) {
  const candidateSkills = getSplitValues(candidate.skills).map(clean);
  const candidateCerts = getSplitValues(candidate.certifications).map(clean);
  const candidateTerms = [...candidateSkills, ...candidateCerts].filter(Boolean);
  if (!candidateTerms.length) return false;

  return activeJobs.some((job) => {
    const jobText = clean([job.required_skills, job.job_title].join(" "));
    return candidateTerms.some((term) => term.length > 2 && jobText.includes(term));
  });
}

function matchesActiveJobLocation(candidate) {
  const candidateLocation = clean(candidate.location);
  if (!candidateLocation) return false;

  const jobLocations = [
    ...activeJobs.map((job) => job.location),
    employerProfile.company_location
  ].map(clean).filter(Boolean);

  return jobLocations.some((location) => locationsOverlap(candidateLocation, location));
}

function locationsOverlap(candidateLocation, jobLocation) {
  if (!candidateLocation || !jobLocation) return false;
  if (candidateLocation.includes(jobLocation) || jobLocation.includes(candidateLocation)) return true;

  const candidateParts = candidateLocation.split(/[,/|-]/).map((part) => part.trim()).filter((part) => part.length > 2);
  const jobParts = jobLocation.split(/[,/|-]/).map((part) => part.trim()).filter((part) => part.length > 2);

  return candidateParts.some((part) => jobParts.includes(part));
}

function getProfileCompletenessScore(candidate) {
  return [
    candidate.full_name,
    candidate.trade,
    candidate.location,
    candidate.experience,
    candidate.availability,
    candidate.bio,
    getSplitValues(candidate.skills).length,
    getSplitValues(candidate.certifications).length
  ].filter((value) => {
    if (typeof value === "number") return value > 0;
    return Boolean(normalizeText(value));
  }).length;
}

function normalizeJobStatus(status) {
  const value = clean(status || "active");
  return ["paused", "inactive", "closed"].includes(value) ? "paused" : "active";
}

function isCandidateSaved(candidateId) {
  const id = String(candidateId || "");
  return savedTalentRowsByCandidateId.has(id) || savedCandidates.has(id);
}

function getSaveButtonText(isSaved, isSaving) {
  if (isSaving) return isSaved ? "Removing..." : "Saving...";
  return isSaved ? "Saved" : "Save Candidate";
}

function buildSavedTalentMap(rows) {
  const rowsByCandidateId = new Map();

  (rows || []).forEach((row) => {
    const candidateId = String(row?.candidate_id || "").trim();
    if (!candidateId) return;

    const existing = rowsByCandidateId.get(candidateId);
    if (!existing) {
      rowsByCandidateId.set(candidateId, row);
      return;
    }

    const existingDate = new Date(existing.created_at || existing.saved_at || 0).getTime();
    const rowDate = new Date(row.created_at || row.saved_at || 0).getTime();

    if (rowDate > existingDate) rowsByCandidateId.set(candidateId, row);
  });

  return rowsByCandidateId;
}

function renderSnapshotItem(label, value) {
  return `
    <div>
      <dt>${escapeHTML(label)}</dt>
      <dd>${escapeHTML(value)}</dd>
    </div>
  `;
}

function renderContactRow(label, value) {
  return `
    <div class="profile-contact-row">
      <span>${escapeHTML(label)}</span>
      <strong>${escapeHTML(value)}</strong>
    </div>
  `;
}

function renderDrawerChips(values, emptyText) {
  if (!values.length) return `<span class="drawer-empty-text">${escapeHTML(emptyText)}</span>`;

  return values
    .map((tag, index) => `<span class="${index >= 8 ? "is-extra" : ""}">${escapeHTML(tag)}</span>`)
    .join("");
}

function toggleChipList(button) {
  const listName = button.dataset.chipToggle;
  const list = candidateDetailContent.querySelector(`[data-chip-list="${listName}"]`);
  if (!list) return;

  const isExpanded = list.classList.toggle("expanded");
  button.textContent = isExpanded ? "Show fewer" : "Show all";
}

function getSelectedLabel(select) {
  return select?.selectedOptions?.[0]?.textContent || select?.value || "";
}

function getSummaryFilterLabel(filter) {
  if (filter === "available") return "Available now";
  if (filter === "saved") return "Saved talent";
  if (filter === "new") return "Recently joined";
  return "Recommended";
}

function loadMoreCandidates() {
  visibleResultLimit += PAGE_SIZE;
  renderCandidates();
}

function renderLoadingRows() {
  if (!candidatesGrid) return;

  emptyState.dataset.state = "";
  candidatesGrid.setAttribute("aria-busy", "true");
  emptyState?.classList.add("hidden");
  loadMoreWrap?.classList.add("hidden");
  candidatesGrid.innerHTML = Array.from({ length: 6 }, () => `
    <div class="candidate-row skeleton-row" aria-hidden="true">
      <div class="candidate-identity">
        <div class="avatar skeleton-block"></div>
        <div class="skeleton-stack">
          <span class="skeleton-line wide"></span>
          <span class="skeleton-line"></span>
          <span class="skeleton-line short"></span>
        </div>
      </div>
      <span class="skeleton-line"></span>
      <span class="skeleton-line"></span>
      <span class="skeleton-line wide"></span>
      <span class="skeleton-dot"></span>
    </div>
  `).join("");
}

function renderLoadError() {
  candidatesGrid.innerHTML = "";
  candidatesGrid.removeAttribute("aria-busy");
  loadMoreWrap?.classList.add("hidden");

  if (emptyState) {
    emptyState.dataset.state = "error";
    emptyState.classList.remove("hidden");
  }

  resultsText.textContent = "Could not load candidates.";

  const emptyTitle = emptyState?.querySelector("h3");
  const emptyMessage = emptyState?.querySelector("p");

  if (emptyTitle) emptyTitle.textContent = "Could not load candidates";
  if (emptyMessage) emptyMessage.textContent = "Something went wrong while loading the candidate network. Try again in a moment.";
  if (emptyClearBtn) emptyClearBtn.textContent = "Retry";

  showToast("Could not load candidates.");
}

function getResultsText() {
  const count = filteredCandidates.length;
  const parts = [];

  if (keywordInput.value) parts.push(`matching "${normalizeText(keywordInput.value)}"`);
  if (cityFilter.value) parts.push(`in ${normalizeText(cityFilter.value)}`);
  if (activeSummaryFilter === "saved") parts.push("saved by you");
  if (activeSummaryFilter === "available") parts.push("available now");
  if (activeSummaryFilter === "new") parts.push("recently joined");

  if (!shouldShowResultCount()) {
    return activeJobs.length
      ? "Recommended candidates based on your active jobs."
      : "Recommended candidates from the visible talent network.";
  }

  return `${count} candidate${count === 1 ? "" : "s"}${parts.length ? ` ${parts.join(", ")}` : ""}`;
}

function getEmptyResultsText() {
  const emptyTitle = emptyState?.querySelector("h3");
  const emptyMessage = emptyState?.querySelector("p");

  if (emptyTitle) emptyTitle.textContent = "No candidates found";
  if (emptyMessage) emptyMessage.textContent = "Try clearing filters or searching a broader trade, city, skill, or certification.";
  if (emptyClearBtn) emptyClearBtn.textContent = "Clear search";

  if (activeSummaryFilter === "saved") {
    return savedCandidates.size ? "No saved candidates match your filters." : "No saved talent yet.";
  }
  if (activeSummaryFilter === "available") return "No immediately available candidates match your filters.";
  if (activeSummaryFilter === "new") return "No recently joined candidates match your filters.";
  if (!loadedCandidates.length) return "No visible candidates are available yet.";
  return "No candidates match your current search.";
}

function populateTradeFilter() {
  if (!tradeFilter) return;

  const current = tradeFilter.value;
  const normalizedTrades = new Map();

  loadedCandidates.forEach((candidate) => {
    const trade = formatDisplayValue(candidate.trade, "");
    if (!trade) return;
    const key = clean(trade);
    if (!normalizedTrades.has(key)) normalizedTrades.set(key, trade);
  });

  const trades = [...normalizedTrades.values()].sort((a, b) => a.localeCompare(b));

  tradeFilter.innerHTML = `
    <option value="">Any trade</option>
    ${trades.map((trade) => `<option value="${escapeAttribute(clean(trade))}">${escapeHTML(trade)}</option>`).join("")}
  `;

  if (trades.some((trade) => clean(trade) === clean(current))) {
    tradeFilter.value = clean(current);
  }
}

function candidateMatchesExperience(candidate, filter) {
  const years = getExperienceYears(candidate.experience);
  const text = clean(candidate.experience);

  if (filter === "entry") return years === 0 || text.includes("entry") || text.includes("no experience");
  if (filter === "under-2") return years > 0 && years < 2;
  if (filter === "2-5") return years >= 2 && years <= 5;
  if (filter === "5-10") return years >= 5 && years <= 10;
  if (filter === "10+") return years >= 10;
  return true;
}

function candidateMatchesAvailability(candidate, filter) {
  const category = getAvailabilityCategory(candidate.availability);
  return category === filter;
}

function getAvailabilityCategory(value) {
  const text = clean(value);

  if (!text || isMalformedValue(text)) return "not-listed";
  if (["immediate", "immediately", "available now", "asap", "right away", "now"].some((term) => text.includes(term))) return "immediately";
  if (["1 week", "one week", "2 week", "two week", "soon", "month", "notice"].some((term) => text.includes(term))) return "soon";
  if (["open", "opportunit", "exploring"].some((term) => text.includes(term))) return "open";
  if (["employed", "working", "currently"].some((term) => text.includes(term))) return "employed";
  return "not-listed";
}

function normalizeAvailabilityLabel(value) {
  const category = getAvailabilityCategory(value);

  if (category === "immediately") return "Available immediately";
  if (category === "soon") return "Available soon";
  if (category === "open") return "Open to opportunities";
  if (category === "employed") return "Currently employed";
  return NOT_LISTED;
}

function normalizeExperienceLabel(value) {
  const text = normalizeText(value);
  const years = getExperienceYears(text);

  if (!text || isMalformedValue(text)) return NOT_LISTED;
  if (clean(text).includes("entry") || clean(text).includes("no experience")) return "Entry level";
  if (years >= 10) return "10+ years";
  if (years >= 5) return "5-10 years";
  if (years >= 3) return "3-5 years";
  if (years >= 1) return `${years} year${years === 1 ? "" : "s"}`;
  return toTitleCaseSafe(text);
}

function formatDisplayValue(value, fallback = NOT_LISTED) {
  const text = normalizeText(value);
  if (!text || isMalformedValue(text)) return fallback;
  return truncateText(toTitleCaseSafe(text), 96);
}

function formatLongDisplayValue(value, fallback = NOT_LISTED) {
  const text = normalizeText(value);
  if (!text || isMalformedValue(text)) return fallback;
  return text;
}

function truncateText(value, limit) {
  const text = normalizeText(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
}

function getDisplayName(candidate, index = 0) {
  return hasCandidateAccess
    ? formatDisplayValue(candidate.full_name, "Candidate")
    : getPreviewName(index);
}

function normalizeText(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return "";
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toTitleCaseSafe(value) {
  const text = normalizeText(value);
  if (!text || /[A-Z]{2,}/.test(text)) return text;

  return text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function isMalformedValue(value) {
  const text = clean(value);
  return !text || text === "null" || text === "undefined" || text === "[]" || text === "[object object]" || text === "{}";
}

function dedupeCandidates(candidates) {
  const seen = new Set();

  return candidates.filter((candidate) => {
    const id = String(candidate.id || "").trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function focusDrawer() {
  lastFocusedElement = document.activeElement;
  window.setTimeout(() => {
    const focusTarget = candidateDetailPanel.querySelector("button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])");
    focusTarget?.focus();
  }, 0);
}

function trapDrawerFocus(event) {
  const focusable = [...candidateDetailPanel.querySelectorAll("button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])")]
    .filter((element) => !element.disabled && element.offsetParent !== null);

  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function showUpgradeComingSoon() {
  startCandidateCheckoutFromSearch();
}

function getCandidateTags(candidate) {
  return [...getSplitValues(candidate.skills), ...getSplitValues(candidate.certifications)].slice(0, 3);
}

function getSplitValues(value) {
  const rawValues = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();

  return rawValues
    .map((tag) => normalizeText(tag))
    .filter((tag) => tag && !isMalformedValue(tag))
    .map(toTitleCaseSafe)
    .filter((tag) => {
      const key = clean(tag);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function startCandidateCheckoutFromSearch() {
  if (typeof window.startCandidateCheckout === "function") {
    window.startCandidateCheckout();
    return;
  }

  window.location.href = "employer-dashboard.html#candidate-access";
}

function isWithinLastDays(value, days) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function getExperienceYears(value) {
  const text = clean(value);
  if (text.includes("10")) return 10;

  const matches = text.match(/\d+/g);
  return matches?.length ? Math.max(...matches.map(Number)) : 0;
}

function getAvailabilityRank(value) {
  const category = getAvailabilityCategory(value);
  if (category === "immediately") return 0;
  if (category === "soon") return 1;
  if (category === "open") return 2;
  if (category === "employed") return 3;
  return 5;
}

function getPreviewName(index) {
  return `Candidate ${String(index + 1).padStart(2, "0")}`;
}

function getSavedDates() {
  try {
    return JSON.parse(localStorage.getItem("placelySavedCandidateDates")) || {};
  } catch {
    return {};
  }
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function clean(value) {
  return String(value || "").toLowerCase().trim();
}

function debounce(callback, delay) {
  let timeout;

  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback.apply(this, args), delay);
  };
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getInitials(name) {
  return String(name || "PT")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function escapeAttribute(value) {
  return escapeHTML(value).replaceAll("`", "&#096;");
}

function getCandidatePhotoUrl(value) {
  return window.PlacelyAuth?.getPublicImageUrl?.(employerSupabase, "candidate_photos", value) || String(value || "");
}

function showToast(message) {
  const toast = document.getElementById("toast");

  if (!toast) {
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

// TODO: Enforce Candidate Network access in Supabase RLS or RPC so the database
// is also the source of truth for protected candidate profile and contact fields.
