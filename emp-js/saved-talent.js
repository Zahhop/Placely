const savedSupabase = window.employerSupabase;

const savedTalentGrid = document.getElementById("savedTalentGrid");
const emptyState = document.getElementById("emptyState");
const resultsText = document.getElementById("resultsText");

const savedCount = document.getElementById("savedCount");
const readyCount = document.getElementById("readyCount");
const newThisWeekCount = document.getElementById("newThisWeekCount");
const topMatchesCount = document.getElementById("topMatchesCount");

const searchInput = document.getElementById("searchInput");
const locationFilter = document.getElementById("locationFilter");
const tradeFilter = document.getElementById("tradeFilter");
const experienceFilter = document.getElementById("experienceFilter");
const availabilityFilter = document.getElementById("availabilityFilter");
const sortFilter = document.getElementById("sortFilter");
const moreFiltersBtn = document.getElementById("moreFiltersBtn");
const clearAllFiltersBtn = document.getElementById("clearAllFiltersBtn");
const savedAccessState = document.getElementById("savedAccessState");
const savedPagination = document.getElementById("savedPagination");
const paginationSummary = document.getElementById("paginationSummary");
const pageSizeSelect = document.getElementById("pageSizeSelect");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageIndicator = document.getElementById("pageIndicator");

const candidateDetailPanel = document.getElementById("candidateDetailPanel");
const candidateDetailContent = document.getElementById("candidateDetailContent");
const closePanelBtn = document.getElementById("closePanelBtn");
const panelOverlay = document.getElementById("panelOverlay");
const logoutBtn = document.getElementById("logoutBtn");

let currentUser = null;
let allSavedCandidates = [];
let filteredSavedCandidates = [];
let hasCandidateAccess = false;
let candidateAccessState = { state: "denied", status: "missing", active: false, pending: false };
let savedTalentRowsByCandidateId = new Map();
<<<<<<< HEAD
let currentPage = 1;
let pageSize = 10;
let openMenuCandidateId = null;
let confirmRemoveCandidateId = null;
=======
let savedCandidateProfileWorkspace = null;
let savedTalentScrollTop = 0;
const SAVED_TALENT_CANDIDATE_COLUMNS = [
  "id",
  "full_name",
  "profile_photo_url",
  "trade",
  "location",
  "experience",
  "availability",
  "skills",
  "certifications",
  "created_at",
  "profile_visible",
  "verification_status"
].join(",");
>>>>>>> e60667c9b5836edbe76cb33628ad92f2f55a9a5a

document.addEventListener("DOMContentLoaded", initSavedTalent);

async function initSavedTalent() {
  setupEvents();

  const user = await requireEmployerLogin();
  if (!user) return;

  currentUser = user;
  candidateAccessState = await window.PlacelyAuth.requireEmployerCandidateAccess(savedSupabase, user.id, {
    attempts: 5,
    delayMs: 1800,
    onPending: () => renderLockedSavedTalent({
      title: "Payment is still processing",
      message: "Placely is waiting for Stripe to confirm your Candidate Access before opening saved talent."
    })
  });
  hasCandidateAccess = candidateAccessState.active;
  if (!hasCandidateAccess) {
    if (candidateAccessState.pending) {
      renderLockedSavedTalent({
        title: "Payment is still processing",
        message: "Stripe payment was received, but Candidate Access has not been activated yet. Return to the dashboard and try again in a moment."
      });
      return;
    }

    redirectToCandidateAccess();
    return;
  }
  await loadSavedTalent();
  setupSavedCandidateProfileWorkspace();
  await restoreSavedCandidateProfileRoute();
}

function setupEvents() {
  [searchInput, locationFilter, tradeFilter, experienceFilter, availabilityFilter, sortFilter].forEach((input) => {
    if (!input) return;

    input.addEventListener("input", debounce(applyFilters, 200));
    input.addEventListener("change", applyFilters);
  });

  if (clearAllFiltersBtn) clearAllFiltersBtn.addEventListener("click", clearAllFilters);
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", () => {
      pageSize = Number(pageSizeSelect.value) || 10;
      currentPage = 1;
      renderSavedTalent();
    });
  }
  if (savedPagination) savedPagination.addEventListener("click", handlePaginationClick);
  if (moreFiltersBtn) {
    moreFiltersBtn.disabled = true;
    moreFiltersBtn.setAttribute("aria-disabled", "true");
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest?.(".saved-actions")) return;
    if (!openMenuCandidateId && !confirmRemoveCandidateId) return;
    openMenuCandidateId = null;
    confirmRemoveCandidateId = null;
    renderSavedTalent();
  });

  if (closePanelBtn) closePanelBtn.addEventListener("click", closeCandidatePanel);
  if (panelOverlay) panelOverlay.addEventListener("click", closeCandidatePanel);

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await window.PlacelyAuth.clearAuthState();
      window.location.replace("employer-login.html");
    });
  }
}

async function requireEmployerLogin() {
  return verifyEmployerAccess(savedSupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });
}

function redirectToCandidateAccess() {
  window.location.replace("employer-dashboard.html#candidate-access");
}

function renderLockedSavedTalent(options = {}) {
  allSavedCandidates = [];
  filteredSavedCandidates = [];
  savedTalentRowsByCandidateId = new Map();

  if (savedTalentGrid) savedTalentGrid.innerHTML = "";
  if (resultsText) resultsText.textContent = options.message || "Candidate Network access is required to view saved talent.";
  if (savedCount) savedCount.textContent = "0";
  if (readyCount) readyCount.textContent = "0";
  if (newThisWeekCount) newThisWeekCount.textContent = "0";
  if (topMatchesCount) topMatchesCount.textContent = "—";
  if (savedAccessState) savedAccessState.hidden = true;

  if (emptyState) {
    emptyState.classList.remove("hidden");
    const title = emptyState.querySelector("h3, strong");
    const copy = emptyState.querySelector("p");
    const action = emptyState.querySelector("a");
    if (title) title.textContent = options.title || "Candidate Network access required";
    if (copy) copy.textContent = options.message || "Get access from the employer dashboard before viewing saved candidates.";
    if (action) {
      action.textContent = "Return to Dashboard";
      action.href = "employer-dashboard.html#candidate-access";
    }
  }
}

async function loadSavedTalent() {
  resultsText.textContent = "Loading saved candidates...";
  setKpiLoadingState();
  updateAccessState();

  const savedRows = await loadSavedTalentRows();
  const candidateIds = [
    ...new Set([
      ...savedRows.map((row) => String(row.candidate_id || "").trim()).filter(Boolean)
    ])
  ];

  if (!candidateIds.length) {
    savedTalentRowsByCandidateId = new Map();
    allSavedCandidates = [];
    filteredSavedCandidates = [];
    renderSavedTalent();
    updateStats();
    return;
  }

  savedTalentRowsByCandidateId = new Map();
  savedRows.forEach((row) => {
    const candidateId = String(row.candidate_id || "").trim();
    if (!candidateId || savedTalentRowsByCandidateId.has(candidateId)) return;
    savedTalentRowsByCandidateId.set(candidateId, row);
  });

  const { data, error } = await savedSupabase
    .from("candidate_profiles")
    .select(SAVED_TALENT_CANDIDATE_COLUMNS)
    .in("id", candidateIds)
    .eq("profile_visible", true);

  if (error) {
    showToast("Could not load saved talent.");
    allSavedCandidates = [];
    filteredSavedCandidates = [];
    renderSavedTalent();
    updateStats();
    return;
  }

  allSavedCandidates = dedupeCandidates(data || []).map((candidate) => {
    const savedRow = savedTalentRowsByCandidateId.get(String(candidate.id));

    return {
      ...candidate,
      saved_record_id: savedRow?.id || "",
      saved_at: savedRow?.created_at || savedRow?.saved_at || getSavedDate(candidate.id)
    };
  });

  filteredSavedCandidates = [...allSavedCandidates];
  populateTradeFilter();
  applyFilters();
}

async function loadSavedTalentRows() {
  const { data, error } = await savedSupabase
    .from("saved_talent")
    .select("*")
    .eq("employer_id", currentUser.id);

  if (error) {
    return [];
  }

  return data || [];
}

function applyFilters() {
  const keyword = clean(searchInput?.value);
  const location = clean(locationFilter?.value);
  const trade = clean(tradeFilter?.value);
  const experience = clean(experienceFilter?.value);
  const availability = clean(availabilityFilter?.value);

  filteredSavedCandidates = allSavedCandidates.filter((candidate) => {
    const searchable = clean([
      candidate.full_name,
      candidate.trade,
      candidate.location,
      candidate.experience,
      candidate.availability,
      candidate.bio,
      candidate.skills,
      candidate.certifications
    ].join(" "));

    const matchesKeyword = !keyword || searchable.includes(keyword);
    const matchesLocation = !location || clean(candidate.location).includes(location);
    const matchesTrade =
      !trade ||
      clean(candidate.trade).includes(trade) ||
      clean(candidate.skills).includes(trade);
    const matchesExperience = !experience || candidateMatchesExperience(candidate, experience);

    const matchesAvailability = !availability || candidateMatchesAvailability(candidate, availability);

    return matchesKeyword && matchesLocation && matchesTrade && matchesExperience && matchesAvailability;
  });

  currentPage = 1;
  sortSavedCandidates();
  renderSavedTalent();
  updateStats();
}

function sortSavedCandidates() {
  const sort = sortFilter?.value || "newest";

  filteredSavedCandidates.sort((a, b) => {
    if (sort === "name") return clean(a.full_name).localeCompare(clean(b.full_name));
    if (sort === "availability") return getAvailabilitySortRank(a.availability) - getAvailabilitySortRank(b.availability);
    if (sort === "oldest") return new Date(a.saved_at || 0) - new Date(b.saved_at || 0);

    return new Date(b.saved_at || 0) - new Date(a.saved_at || 0);
  });
}

function clearAllFilters() {
  if (searchInput) searchInput.value = "";
  if (locationFilter) locationFilter.value = "";
  if (tradeFilter) tradeFilter.value = "";
  if (experienceFilter) experienceFilter.value = "";
  if (availabilityFilter) availabilityFilter.value = "";
  if (sortFilter) sortFilter.value = "newest";

  filteredSavedCandidates = [...allSavedCandidates];
  currentPage = 1;
  openMenuCandidateId = null;
  confirmRemoveCandidateId = null;
  sortSavedCandidates();
  renderSavedTalent();
  updateStats();
}

function renderSavedTalent() {
  savedTalentGrid.innerHTML = "";
  openMenuCandidateId = openMenuCandidateId && filteredSavedCandidates.some((candidate) => String(candidate.id) === openMenuCandidateId)
    ? openMenuCandidateId
    : null;
  confirmRemoveCandidateId = confirmRemoveCandidateId && filteredSavedCandidates.some((candidate) => String(candidate.id) === confirmRemoveCandidateId)
    ? confirmRemoveCandidateId
    : null;

  if (!filteredSavedCandidates.length) {
    emptyState.classList.remove("hidden");
    document.querySelector(".saved-table-wrap")?.classList.add("hidden");
    if (savedPagination) savedPagination.classList.add("hidden");
    resultsText.textContent = "0 saved candidates";
    renderEmptyState(allSavedCandidates.length > 0);
    return;
  }

  emptyState.classList.add("hidden");
  document.querySelector(".saved-table-wrap")?.classList.remove("hidden");
  resultsText.textContent = `${filteredSavedCandidates.length} saved candidate${filteredSavedCandidates.length === 1 ? "" : "s"}`;

  const totalPages = getTotalPages();
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const visibleCandidates = filteredSavedCandidates.slice(startIndex, startIndex + pageSize);

  visibleCandidates.forEach((candidate) => {
    savedTalentGrid.appendChild(createTalentRow(candidate));
  });

  renderPagination();
}

function renderEmptyState(isFilteredEmpty) {
  const title = emptyState.querySelector("strong, h3");
  const copy = emptyState.querySelector("p");
  const action = emptyState.querySelector("a, button");

  if (isFilteredEmpty) {
    if (title) title.textContent = "No saved candidates match your filters";
    if (copy) copy.textContent = "Try adjusting or clearing your filters.";
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "empty-action";
      button.textContent = "Clear filters";
      button.addEventListener("click", clearAllFilters);
      action.replaceWith(button);
    }
    return;
  }

  if (title) title.textContent = "No saved candidates yet";
  if (copy) copy.textContent = "Save candidates from the candidate network and they will appear here.";
  if (action) {
    const link = document.createElement("a");
    link.href = "find-candidates.html";
    link.className = "empty-action";
    link.textContent = "Find Candidates";
    action.replaceWith(link);
  }
}

function renderPagination() {
  if (!savedPagination) return;

  const total = filteredSavedCandidates.length;
  if (total <= pageSize) {
    savedPagination.classList.add("hidden");
    if (paginationSummary) paginationSummary.textContent = total ? `Showing 1-${total} of ${total}` : "Showing 0-0 of 0";
    if (pageIndicator) pageIndicator.textContent = "Page 1 of 1";
    if (prevPageBtn) prevPageBtn.disabled = true;
    if (nextPageBtn) nextPageBtn.disabled = true;
    return;
  }

  const totalPages = getTotalPages();
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(total, currentPage * pageSize);

  savedPagination.classList.remove("hidden");
  if (paginationSummary) paginationSummary.textContent = `Showing ${start}-${end} of ${total}`;
  if (pageIndicator) pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
  if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
  if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages;
}

function handlePaginationClick(event) {
  const button = event.target.closest("button");
  if (!button || button.disabled) return;

  const totalPages = getTotalPages();
  if (button === prevPageBtn) {
    currentPage = Math.max(1, currentPage - 1);
  } else if (button === nextPageBtn) {
    currentPage = Math.min(totalPages, currentPage + 1);
  } else {
    return;
  }

  renderSavedTalent();
}

function getTotalPages() {
  return Math.max(1, Math.ceil(filteredSavedCandidates.length / pageSize));
}

function createTalentRow(candidate) {
  const row = document.createElement("tr");

  const id = String(candidate.id);
  const name = candidate.full_name || "Candidate";
  const trade = candidate.trade || "Trade not listed";
  const location = candidate.location || "Location not listed";
  const experience = candidate.experience || "Experience not listed";
  const availability = candidate.availability || "Availability not listed";
<<<<<<< HEAD
  const tags = getCandidateTags(candidate, 99);
  const visibleTags = tags.slice(0, 3);
  const remainingTags = Math.max(0, tags.length - visibleTags.length);
  const photoUrl = getCandidatePhotoUrl(candidate.profile_photo_url);
  const availabilityCategory = getAvailabilityCategory(candidate.availability);
  const isMenuOpen = openMenuCandidateId === id;
  const isConfirmOpen = confirmRemoveCandidateId === id;
=======
  const tags = getCandidateTags(candidate);
  const verifiedBadge = renderVerifiedBadge(candidate, { short: true });
>>>>>>> e60667c9b5836edbe76cb33628ad92f2f55a9a5a

  row.innerHTML = `
    <td><input type="checkbox" class="saved-select-checkbox" aria-label="Select ${escapeAttribute(name)}"></td>
    <td>
      <div class="saved-candidate-cell">
        <span class="saved-candidate-avatar">
          ${photoUrl ? `<img src="${escapeAttribute(photoUrl)}" alt="">` : escapeHTML(getInitials(name))}
        </span>
        <span class="saved-candidate-copy">
          <strong class="saved-candidate-name">${escapeHTML(name)}</strong>
          <span class="saved-candidate-meta">${escapeHTML(trade)} · ${escapeHTML(location)}</span>
          <button type="button" class="saved-profile-link" data-action="view" data-id="${escapeAttribute(id)}">View profile</button>
        </span>
      </div>
<<<<<<< HEAD
    </td>
    <td>
      <span class="table-stack">
        <strong class="table-primary">${escapeHTML(experience)}</strong>
        ${getExperienceLabel(experience) ? `<span class="experience-pill">${escapeHTML(getExperienceLabel(experience))}</span>` : ""}
      </span>
    </td>
    <td>
      <span class="table-stack availability-${escapeAttribute(availabilityCategory)}">
        <span class="availability-line"><span class="availability-dot" aria-hidden="true"></span><strong class="table-primary">${escapeHTML(availability)}</strong></span>
      </span>
    </td>
    <td>
      <div class="tag-row">
        ${visibleTags.length ? visibleTags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("") : `<span class="skills-empty">Skills not listed</span>`}
        ${remainingTags ? `<span>+${remainingTags}</span>` : ""}
=======

      <div>
        <h3>${escapeHTML(name)} ${verifiedBadge}</h3>
        <p>${escapeHTML(trade)}</p>
>>>>>>> e60667c9b5836edbe76cb33628ad92f2f55a9a5a
      </div>
    </td>
    <td>
      <span class="table-stack">
        <strong class="table-primary">—</strong>
        <span class="match-secondary">Not calculated</span>
      </span>
    </td>
    <td><span class="table-primary">${escapeHTML(formatRelativeSavedDate(candidate.saved_at))}</span></td>
    <td>
      <div class="saved-actions">
        <button type="button" class="saved-icon-btn is-saved" data-action="confirm-remove" data-id="${escapeAttribute(id)}" aria-label="Remove ${escapeAttribute(name)} from Saved Talent">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a2 2 0 0 1 2 2v16a1 1 0 0 1-1.55.83L12 17.53l-6.45 4.3A1 1 0 0 1 4 21V5a2 2 0 0 1 2-2Zm0 2v14.13l5.45-3.63a1 1 0 0 1 1.1 0L18 19.13V5H6Z"/></svg>
        </button>
        <button type="button" class="saved-icon-btn" data-action="toggle-menu" data-id="${escapeAttribute(id)}" aria-haspopup="menu" aria-expanded="${isMenuOpen}" aria-label="Open actions for ${escapeAttribute(name)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/></svg>
        </button>
        ${isMenuOpen ? renderOverflowMenu(id) : ""}
        ${isConfirmOpen ? renderRemoveConfirm(id) : ""}
      </div>
    </td>
  `;

  row.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;

    if (action === "confirm-remove") {
      event.stopPropagation();
      openMenuCandidateId = null;
      confirmRemoveCandidateId = confirmRemoveCandidateId === id ? null : id;
      renderSavedTalent();
      return;
    }

    if (action === "remove") {
      event.stopPropagation();
      removeSavedCandidate(id);
      return;
    }

    if (action === "message") {
      event.stopPropagation();
      startMessageWithCandidate(candidate);
      return;
    }

    if (action === "toggle-menu") {
      event.stopPropagation();
      confirmRemoveCandidateId = null;
      openMenuCandidateId = openMenuCandidateId === id ? null : id;
      renderSavedTalent();
      return;
    }

    if (action === "cancel-remove") {
      event.stopPropagation();
      confirmRemoveCandidateId = null;
      renderSavedTalent();
      return;
    }

    if (action === "view") {
      event.stopPropagation();
      openSavedCandidateProfile(candidate.id);
      return;
    }
  });

  return row;
}

function renderOverflowMenu(candidateId) {
  return `
    <div class="saved-overflow-menu" role="menu">
      <button type="button" data-action="view" data-id="${escapeAttribute(candidateId)}" role="menuitem">View profile</button>
      <button type="button" data-action="message" data-id="${escapeAttribute(candidateId)}" role="menuitem">Message candidate</button>
      <button type="button" class="danger-action" data-action="confirm-remove" data-id="${escapeAttribute(candidateId)}" role="menuitem">Remove from Saved Talent</button>
    </div>
  `;
}

function renderRemoveConfirm(candidateId) {
  return `
    <div class="saved-remove-confirm">
      <p>Remove this candidate from Saved Talent?</p>
      <button type="button" class="danger-action" data-action="remove" data-id="${escapeAttribute(candidateId)}">Confirm remove</button>
      <button type="button" data-action="cancel-remove" data-id="${escapeAttribute(candidateId)}">Cancel</button>
    </div>
  `;
}

function setupSavedCandidateProfileWorkspace() {
  if (savedCandidateProfileWorkspace || !window.PlacelyEmployerCandidateProfile) return;

  savedCandidateProfileWorkspace = window.PlacelyEmployerCandidateProfile.createEmployerCandidateProfileWorkspace({
    supabase: savedSupabase,
    shellSelector: ".page-shell",
    source: "saved-talent",
    backLabel: "Back to Saved Talent",
    getEmployerId: () => currentUser?.id || "",
    isSaved: (candidateId) => savedTalentRowsByCandidateId.has(String(candidateId || "")),
    onSaveToggle: async (candidate) => {
      if (savedTalentRowsByCandidateId.has(String(candidate.id))) {
        await removeSavedCandidate(candidate.id);
      }
    },
    onMessage: (candidate) => startMessageWithCandidate(candidate),
    onBack: () => {
      window.setTimeout(() => window.scrollTo({ top: savedTalentScrollTop || 0, behavior: "smooth" }), 0);
    }
  });
}

async function restoreSavedCandidateProfileRoute() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") !== "profile") return;
  const candidateId = params.get("candidate") || params.get("candidate_id") || "";
  if (!candidateId) return;
  setupSavedCandidateProfileWorkspace();
  await savedCandidateProfileWorkspace?.open(candidateId, { replaceHistory: true });
}

function openSavedCandidateProfile(candidateId) {
  savedTalentScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
  setupSavedCandidateProfileWorkspace();
  savedCandidateProfileWorkspace?.open(candidateId);
}

function openCandidatePanel(candidate) {
  openSavedCandidateProfile(candidate?.id);
  return;

  const tags = getCandidateTags(candidate);
  const contactLocked = !hasCandidateAccess;
  const visibleContact = window.PlacelyAuth.getVisibleCandidateContact(candidate);
  const verifiedBadge = renderVerifiedBadge(candidate);

  candidateDetailContent.innerHTML = `
    <img src="${escapeAttribute(getCandidatePhotoUrl(candidate.profile_photo_url) || "https://placehold.co/160x160?text=PT")}" class="detail-photo" alt="Candidate photo" />

    <h2 class="detail-name">${escapeHTML(candidate.full_name || "Candidate")}</h2>
    ${verifiedBadge}
    <div class="detail-trade">${escapeHTML(candidate.trade || "Trade not listed")}</div>

    <p class="detail-bio">${escapeHTML(candidate.bio || "No bio added yet.")}</p>

    <div class="detail-info-grid">
      <div class="detail-item">
        <span>Location</span>
        <strong>${escapeHTML(candidate.location || "Not added")}</strong>
      </div>

      <div class="detail-item">
        <span>Experience</span>
        <strong>${escapeHTML(candidate.experience || "Not added")}</strong>
      </div>

      <div class="detail-item">
        <span>Availability</span>
        <strong>${escapeHTML(candidate.availability || "Not added")}</strong>
      </div>
    </div>

    <div class="detail-info-grid contact-grid">
      <div class="detail-item">
        <span>Preferred Contact</span>
        <strong>${escapeHTML(contactLocked ? "Upgrade required" : candidate.contact_method || "Not added")}</strong>
      </div>

      ${!contactLocked && visibleContact.showEmail ? renderDetailItem("Email", candidate.email || "Email not listed") : ""}
      ${!contactLocked && visibleContact.showPhone ? renderDetailItem("Phone", candidate.phone || "Phone not listed") : ""}
    </div>

    <div class="tag-row">
      ${tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("")}
    </div>

    <div class="card-actions">
      <button type="button" class="primary-btn" id="detailMessageBtn">Message</button>
      <button type="button" class="remove-btn" id="detailRemoveBtn">Remove</button>
    </div>
  `;

  document.getElementById("detailMessageBtn").addEventListener("click", () => {
    startMessageWithCandidate(candidate);
  });

  document.getElementById("detailRemoveBtn").addEventListener("click", () => {
    removeSavedCandidate(candidate.id);
    closeCandidatePanel();
  });

  candidateDetailPanel.classList.add("open");
  panelOverlay.classList.add("open");
}

function renderDetailItem(label, value) {
  return `
    <div class="detail-item">
      <span>${escapeHTML(label)}</span>
      <strong>${escapeHTML(value)}</strong>
    </div>
  `;
}

function startMessageWithCandidate(candidate) {
  if (!hasCandidateAccess) {
    showToast("Upgrade Candidate Network access to message saved talent.");
    return;
  }

  if (!candidate?.id) {
    showToast("Could not open this candidate.");
    return;
  }

  window.location.href = `employer-messages.html?candidate_id=${encodeURIComponent(candidate.id)}`;
}

function closeCandidatePanel() {
  candidateDetailPanel.classList.remove("open");
  panelOverlay.classList.remove("open");
}

async function removeSavedCandidate(candidateId) {
  const id = String(candidateId);
  const savedRow = savedTalentRowsByCandidateId.get(id);

  if (savedRow?.id) {
    const { error } = await savedSupabase
      .from("saved_talent")
      .delete()
      .eq("id", savedRow.id)
      .eq("employer_id", currentUser.id);

    if (error) {
      showToast("Could not remove candidate from saved talent.");
      return;
    }
  } else {
    const { error } = await savedSupabase
      .from("saved_talent")
      .delete()
      .eq("employer_id", currentUser.id)
      .eq("candidate_id", id);

    if (error) {
      showToast("Could not remove candidate from saved talent.");
      return;
    }
  }

  const savedIds = getLocalSavedCandidateIds().filter((savedId) => savedId !== id);

  localStorage.setItem("placelySavedCandidates", JSON.stringify(savedIds));

  const savedDates = getSavedDates();
  delete savedDates[id];
  localStorage.setItem("placelySavedCandidateDates", JSON.stringify(savedDates));

  allSavedCandidates = allSavedCandidates.filter((candidate) => String(candidate.id) !== id);
  filteredSavedCandidates = filteredSavedCandidates.filter((candidate) => String(candidate.id) !== id);
  savedTalentRowsByCandidateId.delete(id);
  openMenuCandidateId = null;
  confirmRemoveCandidateId = null;
  currentPage = Math.min(currentPage, getTotalPages());

  populateTradeFilter();
  renderSavedTalent();
  updateStats();
  showToast("Candidate removed from saved talent.");
}

function getLocalSavedCandidateIds() {
  try {
    const saved = JSON.parse(localStorage.getItem("placelySavedCandidates")) || [];
    return saved.map(String);
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

function getSavedDate(candidateId) {
  const savedDates = getSavedDates();
  return savedDates[String(candidateId)] || new Date().toISOString();
}

function setKpiLoadingState() {
  if (savedCount) savedCount.textContent = "—";
  if (readyCount) readyCount.textContent = "—";
  if (newThisWeekCount) newThisWeekCount.textContent = "—";
  if (topMatchesCount) topMatchesCount.textContent = "—";
}

function updateAccessState() {
  if (!savedAccessState) return;
  savedAccessState.hidden = !hasCandidateAccess;
}

function updateStats() {
  savedCount.textContent = allSavedCandidates.length;

  readyCount.textContent = allSavedCandidates.filter((candidate) => {
    return candidateMatchesAvailability(candidate, "open-now");
  }).length;

  newThisWeekCount.textContent = allSavedCandidates.filter((candidate) => isWithinLastDays(candidate.saved_at, 7)).length;
  topMatchesCount.textContent = "—";
}

function getAvailabilitySortRank(value) {
  const category = getAvailabilityCategory(value);
  const ranks = {
    immediately: 1,
    open: 2,
    "1-week": 3,
    "2-weeks": 4,
    "1-month": 5,
    other: 6,
    "not-listed": 7
  };

  return ranks[category] || 6;
}

function getExperienceLabel(value) {
  const range = getExperienceRange(value);
  const text = clean(value);

  if (!text || text.includes("not listed")) return "";
  if (range.max === 0 || text.includes("entry") || text.includes("no experience")) return "Entry level";
  if (range.max < 2) return "Developing";
  if (range.max < 5) return "Experienced";
  if (range.max < 10) return "Highly experienced";
  return "Very experienced";
}

function candidateMatchesExperience(candidate, filter) {
  const range = getExperienceRange(candidate.experience);
  const text = clean(candidate.experience);

  if (filter === "entry") return range.max === 0 || text.includes("entry") || text.includes("no experience");
  if (filter === "under-2") return range.min < 2 && range.max > 0;
  if (filter === "2-5") return range.max >= 2 && range.min <= 5;
  if (filter === "5-10") return range.max >= 5 && range.min <= 10;
  if (filter === "10+") return range.min >= 10 || text.includes("10+");

  return !filter || text.includes(filter);
}

function candidateMatchesAvailability(candidate, filter) {
  const category = getAvailabilityCategory(candidate.availability);

  if (filter === "open-now") return category === "immediately" || category === "open";
  if (filter === "immediately") return category === "immediately";
  if (filter === "open") return category === "open";

  return !filter || clean(candidate.availability).includes(clean(filter));
}

function getAvailabilityCategory(value) {
  const text = clean(value);

  if (!text) return "not-listed";
  if (["immediate", "immediately", "available now", "asap", "start now", "right away"].some((term) => text.includes(term))) {
    return "immediately";
  }
  if (["open", "opportunities", "new role", "new opportunities"].some((term) => text.includes(term))) {
    return "open";
  }
  if (["1 week", "one week", "within a week"].some((term) => text.includes(term))) return "1-week";
  if (["2 week", "two week"].some((term) => text.includes(term))) return "2-weeks";
  if (["1 month", "one month", "month"].some((term) => text.includes(term))) return "1-month";

  return "other";
}

function getExperienceRange(value) {
  const text = clean(value);

  if (!text || text.includes("entry") || text.includes("no experience")) return { min: 0, max: 0 };
  if (text.includes("10+")) return { min: 10, max: Number.POSITIVE_INFINITY };

  const matches = text.match(/\d+/g);
  if (!matches?.length) return { min: 0, max: 0 };

  const values = matches.map(Number).sort((a, b) => a - b);
  return { min: values[0], max: values[values.length - 1] };
}

function getCandidateTags(candidate, limit = 3) {
  const tags = [];

  if (candidate.certifications) tags.push(...String(candidate.certifications).split(","));
  if (candidate.skills) tags.push(...String(candidate.skills).split(","));

  return tags.map((tag) => tag.trim()).filter(Boolean).slice(0, limit);
}

function dedupeCandidates(candidates) {
  const seen = new Set();

  return candidates.filter((candidate) => {
    const id = String(candidate.id || "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function populateTradeFilter() {
  if (!tradeFilter) return;

  const current = tradeFilter.value;
  const trades = [...new Set(allSavedCandidates.map((candidate) => String(candidate.trade || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  tradeFilter.innerHTML = `
    <option value="">All trades</option>
    ${trades.map((trade) => `<option value="${escapeAttribute(trade)}">${escapeHTML(trade)}</option>`).join("")}
  `;

  if (trades.some((trade) => clean(trade) === clean(current))) {
    tradeFilter.value = current;
  }
}

function getInitials(name) {
  return String(name || "PT")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
  }, 2400);
}

function clean(value) {
  return String(value || "").toLowerCase().trim();
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric"
  });
}

function formatRelativeSavedDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startOfToday - startOfDate) / 86400000);

  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";

  return date.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric"
  });
}

function isWithinLastDays(value, days) {
  if (!value) return false;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

function truncateText(text, limit) {
  const value = String(text || "");

  if (value.length <= limit) return value;

  return `${value.slice(0, limit).trim()}...`;
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

function escapeAttribute(value) {
  return escapeHTML(value).replaceAll("`", "&#096;");
}

function getCandidatePhotoUrl(value) {
  return window.PlacelyAuth?.getPublicImageUrl?.(savedSupabase, "candidate_photos", value) || String(value || "");
}

function renderVerifiedBadge(candidate, options = {}) {
  return window.PlacelyVerifiedBadge?.render(candidate, options) || "";
}
