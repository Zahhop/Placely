const employerSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const candidatesGrid = document.getElementById("candidatesGrid");
const emptyState = document.getElementById("emptyState");
const resultsText = document.getElementById("resultsText");
const accessStateText = document.getElementById("accessStateText");
const activeFilterText = document.getElementById("activeFilterText");
const upgradeBanner = document.getElementById("upgradeBanner");

const totalCandidates = document.getElementById("totalCandidates");
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

const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const emptyClearBtn = document.getElementById("emptyClearBtn");
const upgradeAccessBtn = document.getElementById("upgradeAccessBtn");

const candidateDetailPanel = document.getElementById("candidateDetailPanel");
const candidateDetailContent = document.getElementById("candidateDetailContent");
const closePanelBtn = document.getElementById("closePanelBtn");
const panelOverlay = document.getElementById("panelOverlay");
const logoutBtn = document.getElementById("logoutBtn");

let currentUser = null;
let employerAccess = {
  subscription_status: "free",
  subscription_plan: "",
  candidate_access: false
};
let hasCandidateAccess = false;
let loadedCandidates = [];
let filteredCandidates = [];
let savedCandidates = new Set();
let selectedCandidateId = null;

document.addEventListener("DOMContentLoaded", initFindCandidates);

async function initFindCandidates() {
  setupEvents();

  const user = await requireEmployerLogin();
  if (!user) return;

  currentUser = user;
  await loadSavedCandidates();
  employerAccess = await loadEmployerAccess(user.id);
  hasCandidateAccess = hasUnlockedCandidateAccess(employerAccess);

  renderAccessState();
  await loadCandidates();
}

function setupEvents() {
  [keywordInput, tradeFilter, cityFilter, experienceFilter, availabilityFilter, certificationFilter, sortFilter].forEach((input) => {
    if (!input) return;

    input.addEventListener("input", debounce(applyFilters, 220));
    input.addEventListener("change", applyFilters);
  });

  if (clearFiltersBtn) clearFiltersBtn.addEventListener("click", clearFilters);
  if (emptyClearBtn) emptyClearBtn.addEventListener("click", clearFilters);
  if (upgradeAccessBtn) upgradeAccessBtn.addEventListener("click", showUpgradeComingSoon);

  if (closePanelBtn) closePanelBtn.addEventListener("click", closeCandidatePanel);
  if (panelOverlay) panelOverlay.addEventListener("click", closeCandidatePanel);

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await employerSupabase.auth.signOut();
      window.location.href = "employer-login.html";
    });
  }
}

async function requireEmployerLogin() {
  return verifyEmployerAccess(employerSupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });
}

async function loadEmployerAccess(userId) {
  const freeAccess = {
    subscription_status: "free",
    subscription_plan: "",
    candidate_access: false
  };

  try {
    const { data, error } = await employerSupabase
      .from("employer_profiles")
      .select("subscription_status, candidate_access, subscription_plan, subscription_started_at")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;
    if (data) return { ...freeAccess, ...data };
  } catch (error) {
    console.warn("Employer subscription fields unavailable; defaulting candidate access to free.", error);
    return freeAccess;
  }

  return freeAccess;
}

async function loadCandidates() {
  resultsText.textContent = "Loading candidates...";

  const paidColumns = "*";
  const previewColumns = "id, trade, location, experience, availability, skills, certifications, created_at, profile_visible";

  const { data: candidates, error } = await employerSupabase
    .from("candidate_profiles")
    .select(hasCandidateAccess ? paidColumns : previewColumns)
    .eq("profile_visible", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading candidates:", error);
    loadedCandidates = [];
    filteredCandidates = [];
    renderCandidates();
    updateStats();
    resultsText.textContent = "Could not load candidates.";
    return;
  }

  loadedCandidates = candidates || [];
  filteredCandidates = [...loadedCandidates];

  applyFilters();
}

function applyFilters() {
  const keyword = clean(keywordInput.value);
  const trade = clean(tradeFilter.value);
  const city = clean(cityFilter.value);
  const experience = clean(experienceFilter.value);
  const availability = clean(availabilityFilter.value);
  const certification = clean(certificationFilter.value);

  filteredCandidates = loadedCandidates.filter((candidate) => {
    const searchable = clean([
      hasCandidateAccess ? candidate.full_name : "",
      candidate.trade,
      candidate.location,
      candidate.experience,
      candidate.availability,
      hasCandidateAccess ? candidate.bio : "",
      candidate.skills,
      candidate.certifications
    ].join(" "));

    const matchesKeyword = !keyword || searchable.includes(keyword);
    const matchesTrade = !trade || clean(candidate.trade).includes(trade) || clean(candidate.skills).includes(trade);
    const matchesCity = !city || clean(candidate.location).includes(city);
    const matchesExperience = !experience || clean(candidate.experience).includes(experience);
    const matchesAvailability = !availability || clean(candidate.availability).includes(availability);
    const matchesCertification =
      !certification ||
      clean(candidate.certifications).includes(certification) ||
      clean(candidate.skills).includes(certification);

    return (
      matchesKeyword &&
      matchesTrade &&
      matchesCity &&
      matchesExperience &&
      matchesAvailability &&
      matchesCertification
    );
  });

  sortCandidates();
  renderCandidates();
  updateStats();
  updateActiveFilterText();
}

function sortCandidates() {
  const sort = sortFilter.value;

  filteredCandidates.sort((a, b) => {
    if (sort === "experience") return getExperienceYears(b.experience) - getExperienceYears(a.experience);
    if (sort === "availability") return getAvailabilityRank(a.availability) - getAvailabilityRank(b.availability);
    if (sort === "match") return getMatchScore(b) - getMatchScore(a);

    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
}

function renderCandidates() {
  candidatesGrid.innerHTML = "";

  if (!filteredCandidates.length) {
    emptyState.classList.remove("hidden");
    resultsText.textContent = "No candidates match your current search.";
    selectedCandidateId = null;
    renderDetailEmpty();
    return;
  }

  emptyState.classList.add("hidden");
  resultsText.textContent = `${filteredCandidates.length} candidate${filteredCandidates.length === 1 ? "" : "s"} found`;

  if (selectedCandidateId && !filteredCandidates.some((candidate) => String(candidate.id) === String(selectedCandidateId))) {
    selectedCandidateId = null;
  }

  filteredCandidates.forEach((candidate, index) => {
    candidatesGrid.appendChild(createCandidateRow(candidate, index));
  });
}

function createCandidateRow(candidate, index) {
  const row = document.createElement("article");

  const id = String(candidate.id);
  const isSelected = String(selectedCandidateId) === id;
  const name = hasCandidateAccess ? cleanFallback(candidate.full_name, "Candidate") : getPreviewName(index);
  const trade = cleanFallback(candidate.trade, "Trade not listed");
  const location = cleanFallback(candidate.location, "Location not listed");
  const experience = cleanFallback(candidate.experience, "Experience not listed");
  const availability = cleanFallback(candidate.availability, "Availability not listed");
  const tags = getCandidateTags(candidate);
  const isSaved = savedCandidates.has(id);

  row.className = `candidate-row${hasCandidateAccess ? "" : " locked"}${isSelected ? " active" : ""}`;
  row.dataset.id = id;

  row.innerHTML = `
    <div class="candidate-identity">
      <div class="avatar">
        ${
          candidate.profile_photo_url
            ? `<img src="${escapeAttribute(candidate.profile_photo_url)}" alt="Candidate photo">`
            : `${escapeHTML(getInitials(name))}`
        }
      </div>

      <div>
        <h3 class="candidate-name">${escapeHTML(name)}</h3>
        <p class="candidate-title">${escapeHTML(trade)}</p>
        <p class="candidate-meta sensitive">${escapeHTML(location)}</p>
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
      <button type="button" class="row-chevron" data-action="view" data-id="${escapeAttribute(id)}" aria-label="View candidate">&gt;</button>
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
  const isSaved = savedCandidates.has(String(candidate.id));

  candidateDetailContent.innerHTML = `
    <div class="detail-head">
      <div class="avatar large">
        ${
          candidate.profile_photo_url
            ? `<img src="${escapeAttribute(candidate.profile_photo_url)}" alt="Candidate photo">`
            : `${escapeHTML(getInitials(candidate.full_name))}`
        }
      </div>

      <div>
        <h2 class="detail-name">${escapeHTML(cleanFallback(candidate.full_name, "Candidate"))}</h2>
        <div class="detail-trade">${escapeHTML(cleanFallback(candidate.trade, "Trade not listed"))}</div>
      </div>
    </div>

    <div class="detail-quick-meta">
      <span class="tag-row"><span>${escapeHTML(cleanFallback(candidate.location, "Location not listed"))}</span></span>
      <span class="tag-row"><span>${escapeHTML(cleanFallback(candidate.availability, "Availability not listed"))}</span></span>
      <span class="tag-row"><span>${escapeHTML(cleanFallback(candidate.experience, "Experience not listed"))}</span></span>
    </div>

    <p class="detail-bio">${escapeHTML(cleanFallback(candidate.bio, "Profile summary not listed."))}</p>

    <div class="detail-section">
      <h3>Profile details</h3>
      <div class="detail-grid">
        <div class="detail-item">
          <span>Location</span>
          <strong>${escapeHTML(cleanFallback(candidate.location, "Location not listed"))}</strong>
        </div>

        <div class="detail-item">
          <span>Experience</span>
          <strong>${escapeHTML(cleanFallback(candidate.experience, "Experience not listed"))}</strong>
        </div>

        <div class="detail-item">
          <span>Availability</span>
          <strong>${escapeHTML(cleanFallback(candidate.availability, "Availability not listed"))}</strong>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Contact</h3>
      <div class="contact-grid">
        <div class="detail-item">
          <span>Preferred Contact</span>
          <strong>${escapeHTML(cleanFallback(candidate.contact_method, "Contact method not listed"))}</strong>
        </div>

        <div class="detail-item">
          <span>Email</span>
          <strong>${escapeHTML(cleanFallback(candidate.email, "Email not listed"))}</strong>
        </div>

        <div class="detail-item">
          <span>Phone</span>
          <strong>${escapeHTML(cleanFallback(candidate.phone, "Phone not listed"))}</strong>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Skills</h3>
      <div class="tag-row">
        ${skills.length ? skills.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("") : `<span>Skills not listed</span>`}
      </div>
    </div>

    <div class="detail-section">
      <h3>Certifications</h3>
      <div class="tag-row">
        ${certifications.length ? certifications.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("") : `<span>Certifications not listed</span>`}
      </div>
    </div>

    <div class="detail-actions">
      <button type="button" class="row-action ${isSaved ? "saved" : ""}" id="detailSaveBtn">${isSaved ? "Saved" : "Save Candidate"}</button>
      <button type="button" class="row-action primary" id="detailMessageBtn">Message Candidate</button>
    </div>
  `;

  document.getElementById("detailSaveBtn").addEventListener("click", () => {
    toggleSaveCandidate(candidate);
  });

  document.getElementById("detailMessageBtn").addEventListener("click", () => {
    startMessageWithCandidate(candidate);
  });

  candidateDetailPanel.setAttribute("aria-hidden", "false");
  candidateDetailPanel.classList.add("open");
  panelOverlay.classList.add("open");
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

  const savedDates = getSavedDates();

  if (savedCandidates.has(id)) {
    const removed = await removeSavedTalentRecord(id);
    if (!removed) return;

    savedCandidates.delete(id);
    delete savedDates[id];
    showToast("Candidate removed from saved talent.");
  } else {
    const saved = await saveTalentRecord(id);
    if (!saved) return;

    savedCandidates.add(id);
    savedDates[id] = new Date().toISOString();
    showToast("Candidate saved.");
  }

  localStorage.setItem("placelySavedCandidates", JSON.stringify([...savedCandidates]));
  localStorage.setItem("placelySavedCandidateDates", JSON.stringify(savedDates));

  renderCandidates();
  updateStats();

  if (candidateDetailPanel.classList.contains("open")) {
    renderSelectedCandidateDetail();
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

async function getEmployerName(userId) {
  const { data: profileById } = await employerSupabase
    .from("employer_profiles")
    .select("company_name")
    .eq("id", userId)
    .maybeSingle();

  return profileById?.company_name || "Employer";
}

async function loadSavedCandidates() {
  savedCandidates = new Set(getLocalSavedCandidateIds());

  if (!currentUser) return;

  const { data, error } = await employerSupabase
    .from("saved_talent")
    .select("candidate_id")
    .eq("employer_id", currentUser.id);

  if (error) {
    console.warn("Saved talent table unavailable; using local saved candidate cache.", error);
    return;
  }

  savedCandidates = new Set((data || []).map((row) => String(row.candidate_id)).filter(Boolean));
  localStorage.setItem("placelySavedCandidates", JSON.stringify([...savedCandidates]));
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
    .select("id")
    .eq("employer_id", currentUser.id)
    .eq("candidate_id", candidateId)
    .limit(1);

  if (existingError) {
    console.error("Find saved talent record error:", existingError);
    showToast("Could not save candidate.");
    return false;
  }

  if (existing?.length) return true;

  const { error } = await employerSupabase
    .from("saved_talent")
    .insert([{ employer_id: currentUser.id, candidate_id: candidateId }]);

  if (error) {
    console.error("Save candidate error:", error);
    showToast("Could not save candidate.");
    return false;
  }

  return true;
}

async function removeSavedTalentRecord(candidateId) {
  const { error } = await employerSupabase
    .from("saved_talent")
    .delete()
    .eq("employer_id", currentUser.id)
    .eq("candidate_id", candidateId);

  if (error) {
    console.error("Remove saved candidate error:", error);
    showToast("Could not remove candidate.");
    return false;
  }

  return true;
}

function clearFilters() {
  keywordInput.value = "";
  tradeFilter.value = "";
  cityFilter.value = "";
  experienceFilter.value = "";
  availabilityFilter.value = "";
  certificationFilter.value = "";
  sortFilter.value = "newest";

  filteredCandidates = [...loadedCandidates];

  sortCandidates();
  renderCandidates();
  updateStats();
  updateActiveFilterText();
}

function updateStats() {
  totalCandidates.textContent = loadedCandidates.length;
  resultCount.textContent = filteredCandidates.length;
  savedCount.textContent = savedCandidates.size;

  fastStartCount.textContent = loadedCandidates.filter((candidate) => {
    return clean(candidate.availability).includes("immediately");
  }).length;

  if (newThisWeekCount) {
    newThisWeekCount.textContent = loadedCandidates.filter((candidate) => {
      return isWithinLastDays(candidate.created_at, 7);
    }).length;
  }
}

function renderAccessState() {
  if (hasCandidateAccess) {
    upgradeBanner.classList.add("hidden");
    accessStateText.textContent = "Full candidate access enabled";
    return;
  }

  upgradeBanner.classList.remove("hidden");
  accessStateText.textContent = "Locked preview: upgrade to view full profiles, save, or message";
}

function updateActiveFilterText() {
  const active = [
    keywordInput.value && "keyword",
    cityFilter.value && "location",
    tradeFilter.value && "trade",
    experienceFilter.value && "experience",
    availabilityFilter.value && "availability",
    certificationFilter.value && "skills/certifications"
  ].filter(Boolean);

  activeFilterText.textContent = active.length
    ? `${active.length} filter${active.length === 1 ? "" : "s"} applied`
    : "No filters applied";
}

function showUpgradeComingSoon() {
  // TODO: Replace this placeholder with Stripe checkout or a hosted billing flow.
  showToast("Billing is coming soon. Candidate Network access will unlock full profiles, saving, and messaging.");
}

function getCandidateTags(candidate) {
  return [...getSplitValues(candidate.skills), ...getSplitValues(candidate.certifications)].slice(0, 2);
}

function getSplitValues(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function hasUnlockedCandidateAccess(profile) {
  return isTruthy(profile?.candidate_access) || clean(profile?.subscription_status) === "active";
}

function isTruthy(value) {
  if (value === true) return true;
  return ["true", "1", "yes", "active"].includes(clean(value));
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

  const match = text.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function getAvailabilityRank(value) {
  const text = clean(value);
  if (text.includes("immediately")) return 0;
  if (text.includes("1 week")) return 1;
  if (text.includes("2 week")) return 2;
  if (text.includes("month")) return 3;
  if (text.includes("employed")) return 4;
  return 5;
}

function getMatchScore(candidate) {
  const keyword = clean(keywordInput.value);
  const trade = clean(tradeFilter.value);
  const city = clean(cityFilter.value);
  const availability = clean(availabilityFilter.value);
  const certification = clean(certificationFilter.value);
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

  return [
    keyword && searchable.includes(keyword),
    trade && clean(candidate.trade).includes(trade),
    city && clean(candidate.location).includes(city),
    availability && clean(candidate.availability).includes(availability),
    certification && searchable.includes(certification)
  ].filter(Boolean).length;
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

function cleanFallback(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
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

function showToast(message) {
  const toast = document.getElementById("toast");

  if (!toast) {
    console.warn(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

// TODO: Enforce Candidate Network access in Supabase RLS or RPC before returning
// full candidate profile and contact columns. This frontend gate prevents unpaid
// employers from requesting contact fields now, but server-side authorization
// should be the source of truth before billing launches.
