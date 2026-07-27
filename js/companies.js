const companiesSupabase = window.PlacelyAuth.client();

const companiesList = document.getElementById("companiesList");
const companyResultCount = document.getElementById("companyResultCount");
const companySearchInput = document.getElementById("companySearchInput");
const companyLocationFilter = document.getElementById("companyLocationFilter");
const companyIndustryFilter = document.getElementById("companyIndustryFilter");
const companyHiringFilter = document.getElementById("companyHiringFilter");

let allCompanies = [];
let filteredCompanies = [];
let currentUser = null;

document.addEventListener("DOMContentLoaded", initCompaniesDirectory);

async function initCompaniesDirectory() {
  setupShellControls();
  setupDirectoryControls();

  try {
    const user = await verifyCandidateAccess(companiesSupabase, {
      loginPath: "candidate-login.html",
      employerDashboardPath: "../employers/employer-dashboard.html"
    });

    if (!user) return;
    currentUser = user;

    await Promise.all([
      loadCandidateChrome(user),
      loadHeaderCounts(user.id),
      loadCompanies()
    ]);

    populateFilters();
    hydrateDirectoryFromUrl();
    applyCompanyFilters();
  } catch (error) {
    console.error("Companies directory failed to load", {
      code: error?.code,
      message: error?.message
    });
    renderErrorState();
  } finally {
    document.documentElement.classList.remove("companies-booting");
  }
}

function setupShellControls() {
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
  document.getElementById("accountMenuLogoutBtn")?.addEventListener("click", handleLogout);
  bindAccountMenu();
  bindMobileSidebar();
}

function setupDirectoryControls() {
  const debouncedFilters = debounce(applyCompanyFilters, 220);
  companySearchInput?.addEventListener("input", debouncedFilters);
  [companyLocationFilter, companyIndustryFilter, companyHiringFilter].forEach((control) => {
    control?.addEventListener("change", applyCompanyFilters);
  });
}

async function loadCandidateChrome(user) {
  const identity = await window.PlacelyAuth.loadCandidateIdentity(companiesSupabase, { user });
  window.PlacelyAuth.updateCandidateHeader(identity);
}

async function loadHeaderCounts(userId) {
  const [{ count: unreadCount }, { count: notificationCount }] = await Promise.all([
    companiesSupabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", userId)
      .eq("sender_type", "employer")
      .eq("read_by_candidate", false),
    companiesSupabase
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", userId)
      .in("status", ["reviewing", "interview", "offer"])
  ]);

  updateBadge("topUnreadBadge", unreadCount || 0);
  updateBadge("topNotificationBadge", notificationCount || 0);
}

async function loadCompanies() {
  const { data, error, source } = await window.PlacelyCompanies.runPublicCompanyQuery(
    companiesSupabase,
    (query) => query.order("company_name", { ascending: true }).limit(80)
  );

  if (error) throw error;

  const jobCounts = await loadActiveJobCounts(data || []);
  allCompanies = (data || [])
    .filter((profile) => String(profile.company_name || "").trim())
    .map((profile) => window.PlacelyCompanies.mapPublicCompany(profile, {
      supabase: companiesSupabase,
      activeJobCount: jobCounts[String(profile.id)] || 0
    }));

  if (source === window.PlacelyCompanies.FALLBACK_COMPANY_SOURCE && !allCompanies.length) {
    console.warn("Companies directory fallback returned no public employer rows. A public company view or narrow RLS policy is required for public browsing.");
  }
}

async function loadActiveJobCounts(profiles) {
  const employerIds = [...new Set(profiles.map((profile) => profile.id).filter(Boolean))];
  const counts = {};
  if (!employerIds.length) return counts;

  const { data, error } = await companiesSupabase
    .from("jobs")
    .select("id, employer_id, status")
    .in("employer_id", employerIds)
    .in("status", window.PlacelyCompanies.ACTIVE_JOB_STATUSES);

  if (error) return counts;

  (data || []).forEach((job) => {
    if (!window.PlacelyCompanies.isPublicActiveJob(job)) return;
    const key = String(job.employer_id || "");
    counts[key] = (counts[key] || 0) + 1;
  });

  return counts;
}

function populateFilters() {
  populateSelect(companyLocationFilter, allCompanies.map((company) => company.company_location), "All locations");
  populateSelect(companyIndustryFilter, allCompanies.map((company) => company.industry), "All industries");
  populateSelect(companyHiringFilter, allCompanies.map((company) => company.main_hiring_industry), "All hiring focus");
}

function populateSelect(select, values, placeholder) {
  if (!select) return;

  const uniqueValues = [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  select.innerHTML = `<option value="">${window.PlacelyCompanies.escapeHTML(placeholder)}</option>`;
  uniqueValues.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });

  select.hidden = uniqueValues.length === 0;
  select.closest("label")?.toggleAttribute("hidden", uniqueValues.length === 0);
}

function applyCompanyFilters() {
  const query = cleanText(companySearchInput?.value);
  const location = companyLocationFilter?.value || "";
  const industry = companyIndustryFilter?.value || "";
  const hiring = companyHiringFilter?.value || "";

  filteredCompanies = allCompanies.filter((company) => {
    const matchesQuery = !query || cleanText(company.company_name).includes(query);
    const matchesLocation = !location || company.company_location === location;
    const matchesIndustry = !industry || company.industry === industry;
    const matchesHiring = !hiring || company.main_hiring_industry === hiring;
    return matchesQuery && matchesLocation && matchesIndustry && matchesHiring;
  });

  renderCompanies();
}

function renderCompanies() {
  if (!companiesList || !companyResultCount) return;

  companyResultCount.textContent = `${filteredCompanies.length} ${filteredCompanies.length === 1 ? "company" : "companies"}`;

  if (!allCompanies.length) {
    companiesList.innerHTML = `
      <div class="empty-state">
        <strong>No public companies yet</strong>
        <p>Companies will appear here once their public profile is available.</p>
      </div>
    `;
    return;
  }

  if (!filteredCompanies.length) {
    companiesList.innerHTML = `
      <div class="empty-state">
        <strong>No companies found</strong>
        <p>Try another company name, location, industry, or hiring focus.</p>
      </div>
    `;
    return;
  }

  companiesList.innerHTML = filteredCompanies.map(renderCompanyRow).join("");
}

function renderCompanyRow(company) {
  const url = window.PlacelyCompanies.buildCompanyProfileUrl(company.raw, {
    source: "companies",
    returnTo: getCompaniesReturnPath()
  });
  const summary = company.company_description || "Company profile details are coming soon.";
  const meta = [company.industry, company.company_location, company.main_hiring_industry].filter(Boolean).join(" - ") || "Company profile";

  return `
    <a class="company-row" href="${window.PlacelyCompanies.escapeAttribute(url)}">
      ${window.PlacelyCompanies.renderCompanyAvatar(company)}
      <span class="company-copy">
        <h3>${window.PlacelyCompanies.escapeHTML(company.company_name)}</h3>
        <p class="company-meta">${window.PlacelyCompanies.escapeHTML(meta)}</p>
        <p class="company-description">${window.PlacelyCompanies.escapeHTML(truncate(summary, 170))}</p>
      </span>
      <span class="company-row-actions">
        <span class="company-count">${company.active_job_count} ${company.active_job_count === 1 ? "job" : "jobs"}</span>
        <span class="secondary-btn">View Company</span>
      </span>
    </a>
  `;
}

function getCompaniesReturnPath() {
  const url = new URL("candidates/companies.html", window.location.origin);
  const query = String(companySearchInput?.value || "").trim();
  const location = companyLocationFilter?.value || "";
  const industry = companyIndustryFilter?.value || "";
  const hiring = companyHiringFilter?.value || "";

  if (query) url.searchParams.set("q", query);
  if (location) url.searchParams.set("location", location);
  if (industry) url.searchParams.set("industry", industry);
  if (hiring) url.searchParams.set("hiring", hiring);
  if (window.scrollY > 0) url.searchParams.set("scrollY", String(Math.round(window.scrollY)));
  return `${url.pathname}${url.search}${url.hash}`;
}

function hydrateDirectoryFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (companySearchInput && params.has("q")) companySearchInput.value = params.get("q") || "";
  if (companyLocationFilter && params.has("location")) companyLocationFilter.value = params.get("location") || "";
  if (companyIndustryFilter && params.has("industry")) companyIndustryFilter.value = params.get("industry") || "";
  if (companyHiringFilter && params.has("hiring")) companyHiringFilter.value = params.get("hiring") || "";

  const scrollY = Number(params.get("scrollY") || 0);
  if (Number.isFinite(scrollY) && scrollY > 0) {
    window.requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "auto" }));
  }
}

function renderErrorState() {
  if (!companiesList) return;
  companiesList.innerHTML = `
    <div class="empty-state">
      <strong>Could not load companies</strong>
      <p>Please refresh the page and try again.</p>
    </div>
  `;
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

function updateBadge(id, value) {
  const badge = document.getElementById(id);
  if (!badge) return;

  const count = Number(value) || 0;
  badge.hidden = count <= 0;
  badge.textContent = count > 9 ? "9+" : String(count);
}

async function handleLogout() {
  try {
    await window.PlacelyAuth.clearAuthState();
  } catch {
    sessionStorage.removeItem("placelyAuthGuardRedirecting");
  }

  window.location.replace("candidate-login.html");
}

function cleanText(value) {
  return String(value || "").toLowerCase().trim();
}

function truncate(value, limit) {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, limit).trim()}...`;
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}
