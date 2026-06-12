const employerSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const candidatesGrid = document.getElementById("candidatesGrid");
const emptyState = document.getElementById("emptyState");
const resultsText = document.getElementById("resultsText");

const totalCandidates = document.getElementById("totalCandidates");
const resultCount = document.getElementById("resultCount");
const savedCount = document.getElementById("savedCount");
const fastStartCount = document.getElementById("fastStartCount");

const keywordInput = document.getElementById("keywordInput");
const tradeFilter = document.getElementById("tradeFilter");
const cityFilter = document.getElementById("cityFilter");
const experienceFilter = document.getElementById("experienceFilter");
const availabilityFilter = document.getElementById("availabilityFilter");
const certificationFilter = document.getElementById("certificationFilter");
const sortFilter = document.getElementById("sortFilter");

const filterBtn = document.getElementById("filterBtn");
const filtersPanel = document.getElementById("filtersPanel");
const searchBtn = document.getElementById("searchBtn");
const applyFiltersBtn = document.getElementById("applyFiltersBtn");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const emptyClearBtn = document.getElementById("emptyClearBtn");

const candidateDetailPanel = document.getElementById("candidateDetailPanel");
const candidateDetailContent = document.getElementById("candidateDetailContent");
const closePanelBtn = document.getElementById("closePanelBtn");
const panelOverlay = document.getElementById("panelOverlay");
const logoutBtn = document.getElementById("logoutBtn");

let loadedCandidates = [];
let filteredCandidates = [];
let savedCandidates = new Set();

document.addEventListener("DOMContentLoaded", initFindCandidates);

async function initFindCandidates() {
  setupEvents();

  const user = await requireEmployerLogin();
  if (!user) return;

  loadSavedCandidates();
  await loadCandidates();
}

function setupEvents() {
  if (filterBtn) {
    filterBtn.addEventListener("click", () => {
      filtersPanel.classList.toggle("active");
    });
  }

  if (searchBtn) searchBtn.addEventListener("click", applyFilters);
  if (applyFiltersBtn) applyFiltersBtn.addEventListener("click", applyFilters);
  if (clearFiltersBtn) clearFiltersBtn.addEventListener("click", clearFilters);
  if (emptyClearBtn) emptyClearBtn.addEventListener("click", clearFilters);

  if (keywordInput) {
    keywordInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") applyFilters();
    });

    keywordInput.addEventListener("input", debounce(applyFilters, 250));
  }

  [tradeFilter, cityFilter, experienceFilter, availabilityFilter, certificationFilter, sortFilter].forEach((input) => {
    if (input) input.addEventListener("change", applyFilters);
  });

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
  const {
    data: { user },
    error
  } = await employerSupabase.auth.getUser();

  if (error || !user) {
    window.location.href = "employer-login.html";
    return null;
  }

  const { data: profile } = await employerSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role && profile.role !== "employer") {
    window.location.href = "../candidate/candidate-dashboard.html";
    return null;
  }

  return user;
}

async function loadCandidates() {
  resultsText.textContent = "Loading candidates...";

  const { data: candidates, error } = await employerSupabase
    .from("candidate_profiles")
    .select("*")
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
      candidate.full_name,
      candidate.trade,
      candidate.location,
      candidate.experience,
      candidate.availability,
      candidate.bio,
      candidate.skills,
      candidate.certifications,
      candidate.contact_method
    ].join(" "));

    const matchesKeyword = !keyword || searchable.includes(keyword);
    const matchesTrade = !trade || clean(candidate.trade).includes(trade) || clean(candidate.skills).includes(trade);
    const matchesCity = !city || clean(candidate.location).includes(city);
    const matchesExperience = !experience || clean(candidate.experience).includes(experience);
    const matchesAvailability = !availability || clean(candidate.availability).includes(availability);
    const matchesCertification = !certification || clean(candidate.certifications).includes(certification);

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
}

function sortCandidates() {
  const sort = sortFilter.value;

  filteredCandidates.sort((a, b) => {
    if (sort === "name") return clean(a.full_name).localeCompare(clean(b.full_name));
    if (sort === "trade") return clean(a.trade).localeCompare(clean(b.trade));
    if (sort === "location") return clean(a.location).localeCompare(clean(b.location));

    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
}

function renderCandidates() {
  candidatesGrid.innerHTML = "";

  if (!filteredCandidates.length) {
    emptyState.classList.remove("hidden");
    resultsText.textContent = "No candidates match your current search.";
    return;
  }

  emptyState.classList.add("hidden");
  resultsText.textContent = `${filteredCandidates.length} candidate${filteredCandidates.length === 1 ? "" : "s"} found`;

  filteredCandidates.forEach((candidate) => {
    candidatesGrid.appendChild(createCandidateCard(candidate));
  });
}

function createCandidateCard(candidate) {
  const card = document.createElement("article");
  card.className = "candidate-card";

  const id = String(candidate.id);
  const name = candidate.full_name || "Unnamed Candidate";
  const trade = candidate.trade || "No trade added";
  const location = candidate.location || "Location not added";
  const experience = candidate.experience || "Experience not added";
  const availability = candidate.availability || "Availability not added";
  const bio = candidate.bio || "No bio added yet.";
  const tags = getCandidateTags(candidate);
  const isSaved = savedCandidates.has(id);

  card.innerHTML = `
    <div class="candidate-top">
      <img src="${escapeAttribute(candidate.profile_photo_url || "https://placehold.co/120x120?text=PT")}" class="avatar" alt="Candidate photo" />

      <div>
        <h3>${escapeHTML(name)}</h3>
        <p>${escapeHTML(trade)}</p>
      </div>
    </div>

    <div class="candidate-info">
      <span>${escapeHTML(location)}</span>
      <span>${escapeHTML(experience)}</span>
      <span>${escapeHTML(availability)}</span>
    </div>

    <p class="candidate-bio">${escapeHTML(truncateText(bio, 115))}</p>

    <div class="tag-row">
      ${tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("")}
    </div>

    <div class="card-actions">
      <button type="button" class="view-btn" data-action="view" data-id="${escapeAttribute(id)}">View Profile</button>
      <button type="button" class="save-btn ${isSaved ? "saved" : ""}" data-action="save" data-id="${escapeAttribute(id)}">
        ${isSaved ? "Saved" : "Save"}
      </button>
    </div>
  `;

  card.addEventListener("click", (event) => {
    const button = event.target.closest("button");

    if (button?.dataset.action === "save") {
      event.stopPropagation();
      toggleSaveCandidate(candidate);
      return;
    }

    openCandidatePanel(candidate);
  });

  return card;
}

function openCandidatePanel(candidate) {
  const tags = getCandidateTags(candidate);

  candidateDetailContent.innerHTML = `
    <img src="${escapeAttribute(candidate.profile_photo_url || "https://placehold.co/160x160?text=PT")}" class="detail-photo" alt="Candidate photo" />

    <h2 class="detail-name">${escapeHTML(candidate.full_name || "Unnamed Candidate")}</h2>
    <div class="detail-trade">${escapeHTML(candidate.trade || "No trade added")}</div>

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

      <div class="detail-item">
        <span>Preferred Contact</span>
        <strong>${escapeHTML(candidate.contact_method || "Not added")}</strong>
      </div>

      <div class="detail-item">
        <span>Email</span>
        <strong>${escapeHTML(candidate.email || "Locked / not added")}</strong>
      </div>

      <div class="detail-item">
        <span>Phone</span>
        <strong>${escapeHTML(candidate.phone || "Locked / not added")}</strong>
      </div>
    </div>

    <div class="detail-section">
      <h4>Skills & Certifications</h4>
      <div class="tag-row">
        ${tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("")}
      </div>
    </div>

    <div class="card-actions">
      <button type="button" class="view-btn" onclick="window.location.href='employer-messages.html'">Message Candidate</button>
      <button type="button" class="save-btn ${savedCandidates.has(String(candidate.id)) ? "saved" : ""}" id="detailSaveBtn">
        ${savedCandidates.has(String(candidate.id)) ? "Saved" : "Save Candidate"}
      </button>
    </div>
  `;

  document.getElementById("detailSaveBtn").addEventListener("click", () => {
    toggleSaveCandidate(candidate);
  });

  candidateDetailPanel.classList.add("open");
  panelOverlay.classList.add("open");
}

function closeCandidatePanel() {
  candidateDetailPanel.classList.remove("open");
  panelOverlay.classList.remove("open");
}

function toggleSaveCandidate(candidate) {
  const id = String(candidate.id);

  if (savedCandidates.has(id)) {
    savedCandidates.delete(id);
  } else {
    savedCandidates.add(id);
  }

  localStorage.setItem("placelySavedCandidates", JSON.stringify([...savedCandidates]));

  renderCandidates();
  updateStats();

  if (candidateDetailPanel.classList.contains("open")) {
    openCandidatePanel(candidate);
  }
}

function loadSavedCandidates() {
  try {
    const saved = JSON.parse(localStorage.getItem("placelySavedCandidates")) || [];
    savedCandidates = new Set(saved.map(String));
  } catch {
    savedCandidates = new Set();
  }
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
}

function updateStats() {
  totalCandidates.textContent = loadedCandidates.length;
  resultCount.textContent = filteredCandidates.length;
  savedCount.textContent = savedCandidates.size;

  fastStartCount.textContent = loadedCandidates.filter((candidate) => {
    return clean(candidate.availability).includes("immediately");
  }).length;
}

function getCandidateTags(candidate) {
  const tags = [];

  if (candidate.certifications) {
    tags.push(...String(candidate.certifications).split(","));
  }

  if (candidate.skills) {
    tags.push(...String(candidate.skills).split(","));
  }

  return tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function clean(value) {
  return String(value || "").toLowerCase().trim();
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
