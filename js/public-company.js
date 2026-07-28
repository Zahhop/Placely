const publicCompanySupabase = window.PlacelyAuth.client();
const publicCompanyShell = document.getElementById("publicCompanyShell");
const publicCompanyActions = document.getElementById("publicCompanyActions");
let currentCompany = null;
let currentVisitorType = "public";

document.addEventListener("DOMContentLoaded", initPublicCompanyProfile);

async function initPublicCompanyProfile() {
  updateCleanCanonicalFromLocation();
  renderContextualActions();
  resolveVisitorType().then((type) => {
    currentVisitorType = type;
    renderContextualActions();
  });

  const companyId = window.PlacelyCompanies.getCompanyIdFromLocation();

  if (!companyId) {
    renderUnavailable("Company not found", "This company link is missing a valid company identifier.");
    return;
  }

  const companyProfile = await loadCompanyProfile(companyId);
  if (!companyProfile) {
    renderUnavailable("Company unavailable", "This company profile is not public or does not have active roles right now.");
    return;
  }

  const jobs = await loadCompanyJobs(companyId);

  const company = window.PlacelyCompanies.mapPublicCompany(companyProfile, {
    supabase: publicCompanySupabase,
    activeJobCount: jobs.length
  });

  renderCompanyProfile(company, jobs.map(window.PlacelyCompanies.mapPublicJob));
  currentCompany = company;
  updateMetadata(company);
  renderContextualActions();
}

async function loadCompanyProfile(companyId) {
  const { data, error } = await window.PlacelyCompanies.runPublicCompanySingleQuery(
    publicCompanySupabase,
    (query) => query.eq("id", companyId)
  );

  return error ? null : data || null;
}

async function loadCompanyJobs(companyId) {
  const { data, error } = await publicCompanySupabase
    .from("jobs")
    .select(window.PlacelyCompanies.PUBLIC_JOB_COLUMNS)
    .eq("employer_id", companyId)
    .in("status", window.PlacelyCompanies.ACTIVE_JOB_STATUSES)
    .order("created_at", { ascending: false })
    .limit(30);

  return error ? [] : (data || []).filter((job) => window.PlacelyCompanies.isPublicActiveJob(job));
}

function renderCompanyProfile(company, jobs) {
  const website = company.company_website;
  const facts = [
    ["Industry", company.industry],
    ["Location", company.company_location],
    ["Hiring focus", company.main_hiring_industry],
    ["Employment type", company.employment_type],
    ["Compensation", company.compensation_summary],
    ["Current jobs", `${jobs.length} ${jobs.length === 1 ? "active role" : "active roles"}`]
  ].filter(([, value]) => value);

  publicCompanyShell.innerHTML = `
    <section class="company-profile-header">
      ${window.PlacelyCompanies.renderCompanyAvatar(company, { large: true })}
      <div class="company-profile-title">
        <span class="eyebrow">Company Profile</span>
        <h1>${window.PlacelyCompanies.escapeHTML(company.company_name)}</h1>
        <p>${window.PlacelyCompanies.escapeHTML([company.industry, company.company_location].filter(Boolean).join(" - ") || "Placely Talent employer")}</p>
      </div>
      <div class="company-profile-actions">
        ${website ? `<a class="secondary-btn" href="${window.PlacelyCompanies.escapeAttribute(website)}" target="_blank" rel="noopener noreferrer">Website</a>` : ""}
        <a class="primary-btn" href="#activeJobs">View Jobs</a>
      </div>
    </section>

    <section class="company-facts-grid" aria-label="Company details">
      ${facts.map(([label, value]) => `
        <div class="company-fact">
          <span>${window.PlacelyCompanies.escapeHTML(label)}</span>
          <strong>${window.PlacelyCompanies.escapeHTML(value)}</strong>
        </div>
      `).join("")}
    </section>

    <section class="company-detail-section">
      <h2>About ${window.PlacelyCompanies.escapeHTML(company.company_name)}</h2>
      <p>${window.PlacelyCompanies.escapeHTML(company.company_description || "Company information has not been added yet.")}</p>
    </section>

    ${company.hiring_timeline || company.main_hiring_industry ? `
      <section class="company-detail-section">
        <h2>Hiring Focus</h2>
        <p>${window.PlacelyCompanies.escapeHTML([company.main_hiring_industry, company.hiring_timeline].filter(Boolean).join(" - "))}</p>
      </section>
    ` : ""}

    <section class="company-detail-section" id="activeJobs">
      <div class="panel-heading tight">
        <div>
          <span class="eyebrow">Open Roles</span>
          <h2>Current Active Jobs</h2>
        </div>
      </div>
      <div class="company-jobs-list">
        ${jobs.length ? jobs.map(renderJobRow).join("") : `
          <div class="empty-state">
            <strong>No active jobs right now</strong>
            <p>Check back later for new opportunities with ${window.PlacelyCompanies.escapeHTML(company.company_name)}.</p>
          </div>
        `}
      </div>
    </section>
  `;
}

function renderJobRow(job) {
  const jobUrl = window.PlacelyJobUrls.buildJobDetailUrl(job.raw, { basePath: "job.html" });

  return `
    <a class="company-job-row" href="${window.PlacelyCompanies.escapeAttribute(jobUrl)}">
      <span class="company-copy">
        <h3>${window.PlacelyCompanies.escapeHTML(job.title)}</h3>
        <p class="company-job-meta">${window.PlacelyCompanies.escapeHTML(job.location)} - ${window.PlacelyCompanies.escapeHTML(job.type)} - ${window.PlacelyCompanies.escapeHTML(job.experience)}</p>
        <span class="company-job-tags">
          <span>${window.PlacelyCompanies.escapeHTML(job.pay)}</span>
          <span>Posted ${window.PlacelyCompanies.escapeHTML(formatDate(job.created_at))}</span>
        </span>
      </span>
      <span class="primary-btn">View Job</span>
    </a>
  `;
}

function renderUnavailable(title, message) {
  publicCompanyShell.innerHTML = `
    <div class="job-details-empty">
      <span class="eyebrow">Company Profile</span>
      <h1>${window.PlacelyCompanies.escapeHTML(title)}</h1>
      <p>${window.PlacelyCompanies.escapeHTML(message)}</p>
      <div class="public-job-actions">
        <a href="find-jobs.html?role=candidate" class="primary-btn">Browse Active Jobs</a>
      </div>
    </div>
  `;
}

function updateMetadata(company) {
  const title = `${company.company_name} Jobs and Company Profile | Placely Talent`;
  const location = company.company_location || "their area";
  const description = `Learn about ${company.company_name}, explore current jobs in ${location}, and apply through Placely Talent.`;
  const canonical = new URL(window.PlacelyCompanies.buildCleanCompanyProfileUrl(company.raw, { basePath: "company.html" }), window.location.href).href;

  document.title = title;
  setMeta("name", "description", description);
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);
  document.getElementById("canonicalCompanyUrl")?.setAttribute("href", canonical);
}

function updateCleanCanonicalFromLocation() {
  const url = new URL(window.location.href);
  ["source", "returnTo", "selectedJobId"].forEach((key) => url.searchParams.delete(key));
  document.getElementById("canonicalCompanyUrl")?.setAttribute("href", `${url.origin}${url.pathname}${url.search}`);
}

async function resolveVisitorType() {
  try {
    const {
      data: { user }
    } = await publicCompanySupabase.auth.getUser();
    if (!user) return "public";

    const [employer, candidate] = await Promise.all([
      publicCompanySupabase.from("employer_profiles").select("id").eq("id", user.id).maybeSingle(),
      publicCompanySupabase.from("candidate_profiles").select("id").eq("id", user.id).maybeSingle()
    ]);

    if (employer.data?.id) return "employer";
    if (candidate.data?.id) return "candidate";
    return "authenticated";
  } catch {
    return "public";
  }
}

function renderContextualActions() {
  if (!publicCompanyActions) return;

  const context = getReturnContext();
  const cleanCompanyUrl = getCleanCurrentCompanyUrl();
  const actions = [];
  const suppressPublicActions = context && ["employer-profile", "companies", "find-jobs", "saved-jobs", "applications", "dashboard", "candidate"].includes(context.source);

  if (context) {
    actions.push(`
      <button type="button" class="secondary-btn company-back-btn" id="companyBackBtn">
        <span aria-hidden="true">←</span>${window.PlacelyCompanies.escapeHTML(context.label)}
      </button>
    `);
  }

  if (currentVisitorType === "public" && !suppressPublicActions) {
    actions.push(`<a href="find-jobs.html?role=candidate" class="secondary-btn">Browse Jobs</a>`);
    actions.push(`<a href="../candidates/candidate-login.html?redirect=${encodeURIComponent(cleanCompanyUrl)}" class="primary-btn">Candidate Login</a>`);
  }

  publicCompanyActions.innerHTML = actions.join("");
  document.getElementById("companyBackBtn")?.addEventListener("click", () => navigateBack(context));
}

function getReturnContext() {
  const explicit = getExplicitReturnContext();
  if (explicit) return explicit;

  const stateContext = getHistoryStateReturnContext();
  if (stateContext) return stateContext;

  const referrerContext = getReferrerReturnContext();
  if (referrerContext) return referrerContext;

  return null;
}

function getExplicitReturnContext() {
  const params = new URLSearchParams(window.location.search);
  const source = String(params.get("source") || "").trim();
  const selectedJobId = String(params.get("selectedJobId") || "").trim();
  const returnTo = window.PlacelyCompanies.getSafeReturnDestination(params.get("returnTo"));

  if (source === "employer-profile") {
    return makeReturnContext("Back to Company Profile", returnTo || "employers/employer-profile.html", "employer-profile");
  }

  if (source === "companies") {
    return makeReturnContext("Back to Companies", returnTo || "candidates/companies.html", "companies");
  }

  if (["find-jobs", "job", "public-job", "saved-jobs", "applications", "dashboard"].includes(source)) {
    const fallback = selectedJobId
      ? `public/find-jobs.html?role=candidate&job=${encodeURIComponent(selectedJobId)}`
      : "";
    return makeReturnContext("Back to Job", returnTo || fallback, source);
  }

  if (source === "candidate") {
    return makeReturnContext("Back", returnTo, source);
  }

  if (returnTo) return makeReturnContext(inferBackLabel(returnTo), returnTo, source || "returnTo");
  return null;
}

function getHistoryStateReturnContext() {
  const state = history.state || {};
  const destination = window.PlacelyCompanies.getSafeReturnDestination(state.returnTo);
  if (!destination) return null;

  return makeReturnContext(state.label || inferBackLabel(destination), destination, state.source || "history", true);
}

function getReferrerReturnContext() {
  const destination = window.PlacelyCompanies.getSafeReturnDestination(document.referrer);
  if (!destination) return null;
  return makeReturnContext(inferBackLabel(destination), destination, "referrer", true);
}

function makeReturnContext(label, destination, source, preferHistory = false) {
  const safeDestination = window.PlacelyCompanies.getSafeReturnDestination(destination);
  if (!safeDestination) return null;
  if (isCompanyPageDestination(safeDestination)) return null;
  return {
    label,
    destination: safeDestination,
    source,
    preferHistory
  };
}

function isCompanyPageDestination(destination) {
  let pathname = "";
  try {
    pathname = new URL(destination, window.location.origin).pathname;
  } catch {
    return false;
  }

  const basePath = window.PlacelyCompanies.getPlacelyBasePath?.() || "/";
  if (basePath !== "/" && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length);
  } else {
    pathname = pathname.replace(/^\/+/, "");
  }

  return pathname === "public/company.html";
}

function inferBackLabel(destination) {
  if (/\/employers\/employer-profile\.html/.test(destination)) return "Back to Company Profile";
  if (/\/candidates\/companies\.html/.test(destination)) return "Back to Companies";
  if (/\/public\/job\.html|\/public\/find-jobs\.html|\/public\/saved-jobs\.html|\/candidates\/candidate-applications\.html|\/candidates\/candidate-dashboard\.html/.test(destination)) return "Back to Job";
  return "Back";
}

function navigateBack(context) {
  if (!context?.destination) return;

  if (context.preferHistory && history.length > 1 && document.referrer) {
    history.back();
    return;
  }

  window.location.href = context.destination;
}

function getCleanCurrentCompanyUrl() {
  if (currentCompany) {
    return window.PlacelyCompanies.buildCleanCompanyProfileUrl(currentCompany.raw, { basePath: "company.html" });
  }

  const url = new URL(window.location.href);
  ["source", "returnTo", "selectedJobId"].forEach((key) => url.searchParams.delete(key));
  return `${url.pathname}${url.search}`;
}

function setMeta(attributeName, name, content) {
  const selector = attributeName === "property"
    ? `meta[property="${name}"]`
    : `meta[name="${name}"]`;
  const meta = document.querySelector(selector);
  if (meta) meta.setAttribute("content", content);
}

function formatDate(value) {
  if (!value) return "recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
