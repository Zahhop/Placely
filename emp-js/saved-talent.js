const savedSupabase = window.employerSupabase;

if (!savedSupabase) {
  console.error("Employer Supabase client was not initialized.");
}

const savedTalentGrid = document.getElementById("savedTalentGrid");
const emptyState = document.getElementById("emptyState");
const resultsText = document.getElementById("resultsText");

const savedCount = document.getElementById("savedCount");
const readyCount = document.getElementById("readyCount");
const tradeCount = document.getElementById("tradeCount");
const newestSave = document.getElementById("newestSave");

const searchInput = document.getElementById("searchInput");
const tradeFilter = document.getElementById("tradeFilter");
const availabilityFilter = document.getElementById("availabilityFilter");
const sortFilter = document.getElementById("sortFilter");

const candidateDetailPanel = document.getElementById("candidateDetailPanel");
const candidateDetailContent = document.getElementById("candidateDetailContent");
const closePanelBtn = document.getElementById("closePanelBtn");
const panelOverlay = document.getElementById("panelOverlay");
const logoutBtn = document.getElementById("logoutBtn");

let currentUser = null;
let allSavedCandidates = [];
let filteredSavedCandidates = [];
let hasCandidateAccess = false;

document.addEventListener("DOMContentLoaded", initSavedTalent);

async function initSavedTalent() {
  setupEvents();

  const user = await requireEmployerLogin();
  if (!user) return;

  currentUser = user;
  hasCandidateAccess = await loadEmployerCandidateAccess(user.id);
  await loadSavedTalent();
}

function setupEvents() {
  [searchInput, tradeFilter, availabilityFilter, sortFilter].forEach((input) => {
    if (!input) return;

    input.addEventListener("input", debounce(applyFilters, 200));
    input.addEventListener("change", applyFilters);
  });

  if (closePanelBtn) closePanelBtn.addEventListener("click", closeCandidatePanel);
  if (panelOverlay) panelOverlay.addEventListener("click", closeCandidatePanel);

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await savedSupabase.auth.signOut();
      window.location.href = "employer-login.html";
    });
  }
}

async function requireEmployerLogin() {
  return verifyEmployerAccess(savedSupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });
}

async function loadSavedTalent() {
  resultsText.textContent = "Loading saved candidates...";

  const savedIds = getLocalSavedCandidateIds();

  if (!savedIds.length) {
    allSavedCandidates = [];
    filteredSavedCandidates = [];
    renderSavedTalent();
    updateStats();
    return;
  }

  const columns = hasCandidateAccess
    ? "*"
    : "id, full_name, trade, location, experience, availability, skills, certifications, profile_photo_url, created_at, profile_visible";

  const { data, error } = await savedSupabase
    .from("candidate_profiles")
    .select(columns)
    .in("id", savedIds)
    .eq("profile_visible", true);

  if (error) {
    console.error("Error loading saved talent:", error);
    showToast("Could not load saved talent.");
    allSavedCandidates = [];
    filteredSavedCandidates = [];
    renderSavedTalent();
    updateStats();
    return;
  }

  allSavedCandidates = (data || []).map((candidate) => ({
    ...candidate,
    saved_at: getSavedDate(candidate.id)
  }));

  filteredSavedCandidates = [...allSavedCandidates];
  applyFilters();
}

function applyFilters() {
  const keyword = clean(searchInput.value);
  const trade = clean(tradeFilter.value);
  const availability = clean(availabilityFilter.value);

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
    const matchesTrade =
      !trade ||
      clean(candidate.trade).includes(trade) ||
      clean(candidate.skills).includes(trade);

    const matchesAvailability =
      !availability || clean(candidate.availability).includes(availability);

    return matchesKeyword && matchesTrade && matchesAvailability;
  });

  sortSavedCandidates();
  renderSavedTalent();
  updateStats();
}

function sortSavedCandidates() {
  const sort = sortFilter.value;

  filteredSavedCandidates.sort((a, b) => {
    if (sort === "name") return clean(a.full_name).localeCompare(clean(b.full_name));
    if (sort === "trade") return clean(a.trade).localeCompare(clean(b.trade));
    if (sort === "location") return clean(a.location).localeCompare(clean(b.location));

    return new Date(b.saved_at || 0) - new Date(a.saved_at || 0);
  });
}

function renderSavedTalent() {
  savedTalentGrid.innerHTML = "";

  if (!filteredSavedCandidates.length) {
    emptyState.classList.remove("hidden");
    resultsText.textContent = allSavedCandidates.length
      ? "No saved candidates match your filters."
      : "No saved candidates yet.";
    return;
  }

  emptyState.classList.add("hidden");
  resultsText.textContent = `${filteredSavedCandidates.length} saved candidate${filteredSavedCandidates.length === 1 ? "" : "s"}`;

  filteredSavedCandidates.forEach((candidate) => {
    savedTalentGrid.appendChild(createTalentCard(candidate));
  });
}

function createTalentCard(candidate) {
  const card = document.createElement("article");
  card.className = "talent-card";

  const id = String(candidate.id);
  const name = candidate.full_name || "Candidate";
  const trade = candidate.trade || "Trade not listed";
  const location = candidate.location || "Location not listed";
  const experience = candidate.experience || "Experience not listed";
  const availability = candidate.availability || "Availability not listed";
  const tags = getCandidateTags(candidate);

  card.innerHTML = `
    <div class="talent-top">
      <div class="avatar">
        ${
          candidate.profile_photo_url
            ? `<img src="${escapeAttribute(candidate.profile_photo_url)}" alt="Candidate photo">`
            : `${getInitials(name)}`
        }
      </div>

      <div>
        <h3>${escapeHTML(name)}</h3>
        <p>${escapeHTML(trade)}</p>
      </div>
    </div>

    <div class="talent-details">
      <span>${escapeHTML(location)}</span>
      <span>${escapeHTML(experience)}</span>
      <span>${escapeHTML(availability)}</span>
      <span>Saved ${formatDate(candidate.saved_at)}</span>
    </div>

    <div class="tag-row">
      ${tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("")}
    </div>

    <div class="card-actions">
      <button type="button" class="primary-btn" data-action="view" data-id="${escapeAttribute(id)}">View Profile</button>
      <button type="button" class="secondary-btn" data-action="message" data-id="${escapeAttribute(id)}">Message</button>
      <button type="button" class="remove-btn" data-action="remove" data-id="${escapeAttribute(id)}">Remove</button>
    </div>
  `;

  card.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;

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

    if (action === "view") {
      event.stopPropagation();
      openCandidatePanel(candidate);
      return;
    }
  });

  return card;
}

function openCandidatePanel(candidate) {
  const tags = getCandidateTags(candidate);
  const contactLocked = !hasCandidateAccess;

  candidateDetailContent.innerHTML = `
    <img src="${escapeAttribute(candidate.profile_photo_url || "https://placehold.co/160x160?text=PT")}" class="detail-photo" alt="Candidate photo" />

    <h2 class="detail-name">${escapeHTML(candidate.full_name || "Candidate")}</h2>
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

      <div class="detail-item">
        <span>Email</span>
          <strong>${escapeHTML(contactLocked ? "Upgrade required" : candidate.email || "Email not listed")}</strong>
      </div>

      <div class="detail-item">
        <span>Phone</span>
          <strong>${escapeHTML(contactLocked ? "Upgrade required" : candidate.phone || "Phone not listed")}</strong>
      </div>
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

function startMessageWithCandidate(candidate) {
  if (!hasCandidateAccess) {
    showToast("Upgrade Candidate Network access to message saved talent.");
    return;
  }

  const messageCandidate = {
    id: candidate.id,
    name: candidate.full_name || "Candidate",
    trade: candidate.trade || "Trade not listed",
    location: candidate.location || "Location not listed",
    photo: candidate.profile_photo_url || ""
  };

  localStorage.setItem(
    "placelyMessageCandidate",
    JSON.stringify(messageCandidate)
  );

  window.location.href = "employer-messages.html";
}

function closeCandidatePanel() {
  candidateDetailPanel.classList.remove("open");
  panelOverlay.classList.remove("open");
}

function removeSavedCandidate(candidateId) {
  const id = String(candidateId);
  const savedIds = getLocalSavedCandidateIds().filter((savedId) => savedId !== id);

  localStorage.setItem("placelySavedCandidates", JSON.stringify(savedIds));

  const savedDates = getSavedDates();
  delete savedDates[id];
  localStorage.setItem("placelySavedCandidateDates", JSON.stringify(savedDates));

  allSavedCandidates = allSavedCandidates.filter((candidate) => String(candidate.id) !== id);
  filteredSavedCandidates = filteredSavedCandidates.filter((candidate) => String(candidate.id) !== id);

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

function updateStats() {
  savedCount.textContent = allSavedCandidates.length;

  readyCount.textContent = allSavedCandidates.filter((candidate) => {
    return clean(candidate.availability).includes("immediately");
  }).length;

  const trades = new Set(
    allSavedCandidates
      .map((candidate) => clean(candidate.trade))
      .filter(Boolean)
  );

  tradeCount.textContent = trades.size;

  if (!allSavedCandidates.length) {
    newestSave.textContent = "-";
    return;
  }

  const newest = [...allSavedCandidates].sort((a, b) => {
    return new Date(b.saved_at || 0) - new Date(a.saved_at || 0);
  })[0];

  newestSave.textContent = formatDate(newest.saved_at);
}

function getCandidateTags(candidate) {
  const tags = [];

  if (candidate.certifications) tags.push(...String(candidate.certifications).split(","));
  if (candidate.skills) tags.push(...String(candidate.skills).split(","));

  return tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 3);
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
    alert(message);
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
