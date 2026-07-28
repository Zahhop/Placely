const publicJobSupabase = window.PlacelyAuth.client();

const PUBLIC_JOB_COLUMNS = [
  "id",
  "employer_id",
  "job_title",
  "company_name",
  "location",
  "employment_type",
  "pay_range",
  "experience_level",
  "job_description",
  "required_skills",
  "benefits",
  "status",
  "created_at"
].join(", ");

const publicJobShell = document.getElementById("publicJobShell");

document.addEventListener("DOMContentLoaded", initPublicJobDetail);

async function initPublicJobDetail() {
  const jobId = window.PlacelyJobUrls.getJobIdFromLocation();

  if (!jobId) {
    renderUnavailable("Job not found", "This job link is missing a valid job identifier.");
    return;
  }

  const { data: job, error } = await publicJobSupabase
    .from("jobs")
    .select(PUBLIC_JOB_COLUMNS)
    .eq("id", jobId)
    .in("status", window.PlacelyCompanies?.ACTIVE_JOB_STATUSES || ["active"])
    .maybeSingle();

  if (error || !job || !isActiveJob(job)) {
    renderUnavailable("Job unavailable", "This job may be closed, paused, deleted, expired, or no longer accepting applications.");
    return;
  }

  const employerProfile = await loadEmployerProfile(job.employer_id);
  renderPublicJob(job, employerProfile);
  updateMetadata(job, employerProfile);
}

async function loadEmployerProfile(employerId) {
  if (!employerId) return {};

  const { data, error } = window.PlacelyCompanies?.runPublicCompanySingleQuery
    ? await window.PlacelyCompanies.runPublicCompanySingleQuery(
        publicJobSupabase,
        (query) => query.eq("id", employerId),
        { columns: "id, company_name, company_description, company_location, company_logo_url" }
      )
    : { data: null, error: null };

  return error ? {} : data || {};
}

function renderPublicJob(job, employerProfile) {
  const normalized = normalizeJob(job);
  const companyInfo = employerProfile.company_description || "Company information has not been added yet.";
  const applyUrl = `../candidates/apply-job.html?job_id=${encodeURIComponent(job.id)}`;
  const loginUrl = `../candidates/candidate-login.html?redirect=${encodeURIComponent(applyUrl)}`;

  publicJobShell.innerHTML = `
    <section class="job-detail-content">
      <div class="public-job-heading">
        ${renderCompanyAvatar(normalized, employerProfile)}
        <div>
          <span class="eyebrow">Open Role</span>
          <h1>${escapeHTML(normalized.title)}</h1>
          <p>${renderCompanyProfileAnchor(normalized, employerProfile)} - ${escapeHTML(normalized.location)}</p>
        </div>
      </div>

      <div class="public-job-meta">
        <span class="applied-tag">Open</span>
        <span class="job-tags"><span>${escapeHTML(normalized.pay)}</span></span>
        <span class="job-tags"><span>${escapeHTML(normalized.type)}</span></span>
        <span class="job-tags"><span>${escapeHTML(normalized.experience)}</span></span>
      </div>

      <div class="public-job-actions">
        <a class="primary-btn" href="${escapeHTML(loginUrl)}">Log in to Apply</a>
        <a class="secondary-btn" href="../candidates/candidate-signup.html">Create Candidate Account</a>
      </div>

      <div class="detail-grid">
        ${renderDetailItem("Company", normalized.company)}
        ${renderDetailItem("Location", normalized.location)}
        ${renderDetailItem("Compensation", normalized.pay)}
        ${renderDetailItem("Employment type", normalized.type)}
        ${renderDetailItem("Experience", normalized.experience)}
        ${renderDetailItem("Posted", formatDate(job.created_at))}
      </div>

      ${renderDetailSection("Job Description", normalized.description)}
      ${renderDetailSection("Required Skills and Certifications", normalized.requirements)}
      ${normalized.benefits ? renderDetailSection("Benefits or Perks", normalized.benefits) : ""}
      ${renderDetailSection("Company Summary", companyInfo)}
    </section>
  `;
}

function renderUnavailable(title, message) {
  publicJobShell.innerHTML = `
    <div class="job-details-empty">
      <span class="eyebrow">Job Details</span>
      <h1>${escapeHTML(title)}</h1>
      <p>${escapeHTML(message)}</p>
      <div class="public-job-actions">
        <a href="find-jobs.html?role=candidate" class="primary-btn">Browse Active Jobs</a>
      </div>
    </div>
  `;
}

function updateMetadata(job, employerProfile) {
  const seo = window.PlacelyJobSeo.mapJobToSeoData(job, employerProfile);
  const description = seo.description
    ? truncateText(seo.description, 150)
    : `${seo.title} at ${seo.hiringOrganization}. View this public Placely Talent job posting.`;
  const canonical = new URL(window.PlacelyJobUrls.buildJobDetailUrl(job), window.location.href).href;

  document.title = `${seo.title} | Placely Talent`;
  setMeta("description", description);
  setMeta("property", "og:title", `${seo.title} | Placely Talent`);
  setMeta("property", "og:description", description);
  document.getElementById("canonicalJobUrl")?.setAttribute("href", canonical);

  const existingJsonLd = document.getElementById("jobPostingJsonLd");
  if (existingJsonLd) existingJsonLd.remove();

  const script = document.createElement("script");
  script.id = "jobPostingJsonLd";
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(window.PlacelyJobSeo.buildJobPostingJsonLd(job, employerProfile));
  document.head.appendChild(script);
}

function setMeta(attributeName, name, content) {
  const selector = attributeName === "property"
    ? `meta[property="${name}"]`
    : `meta[name="${name}"]`;
  const meta = document.querySelector(selector);
  if (meta) meta.setAttribute("content", content);
}

function normalizeJob(job) {
  return {
    id: job.id,
    employer_id: job.employer_id,
    title: job.job_title || "Untitled Job",
    company: job.company_name || "Employer",
    location: job.location || "Location not listed",
    type: job.employment_type || "Employment type not listed",
    pay: window.PlacelyAuth.formatCompensationFromRecord(job),
    experience: job.experience_level || "Experience not listed",
    description: job.job_description || "No description provided yet.",
    requirements: job.required_skills || "Requirements not listed.",
    benefits: job.benefits || ""
  };
}

function renderCompanyAvatar(job, employerProfile) {
  const logoUrl = getEmployerLogoUrl(window.PlacelyAuth.getPublicEmployerLogoValue(employerProfile));
  const companyUrl = getCompanyProfileUrl(job, employerProfile);

  if (logoUrl) {
    const initials = getInitials(job.company);
    return `
      <a class="company-avatar large" href="${escapeAttribute(companyUrl)}" aria-label="View ${escapeAttribute(job.company)} company profile">
        <img src="${escapeAttribute(logoUrl)}" alt="${escapeAttribute(job.company)} logo" loading="lazy" onerror="this.parentElement.textContent='${escapeAttribute(initials)}'">
      </a>
    `;
  }

  return `<a class="company-avatar large" href="${escapeAttribute(companyUrl)}" aria-label="View ${escapeAttribute(job.company)} company profile">${escapeHTML(getInitials(job.company))}</a>`;
}

function renderDetailItem(label, value) {
  return `
    <div>
      <span>${escapeHTML(label)}</span>
      <strong>${escapeHTML(value || "Not listed")}</strong>
    </div>
  `;
}

function renderDetailSection(label, value) {
  return `
    <section class="detail-section">
      <span>${escapeHTML(label)}</span>
      <p>${escapeHTML(value || "Not listed")}</p>
    </section>
  `;
}

function getEmployerLogoUrl(value) {
  return window.PlacelyAuth?.resolveEmployerLogoUrl?.(value, { supabase: publicJobSupabase }) || "";
}

function renderCompanyProfileAnchor(job, employerProfile) {
  return `<a class="company-profile-inline-link" href="${escapeAttribute(getCompanyProfileUrl(job, employerProfile))}">${escapeHTML(job.company)}</a>`;
}

function getCompanyProfileUrl(job, employerProfile = {}) {
  const profile = {
    ...employerProfile,
    id: employerProfile.id || job.employer_id,
    company_name: employerProfile.company_name || job.company
  };

  return window.PlacelyCompanies?.buildCompanyProfileUrl?.(profile, {
    basePath: "company.html",
    source: "public-job",
    selectedJobId: job.id,
    returnTo: getPublicJobReturnPath(job)
  }) || `company.html?id=${encodeURIComponent(job.employer_id || "")}`;
}

function getPublicJobReturnPath(job) {
  const url = new URL("public/job.html", window.location.origin);
  if (job?.id) url.searchParams.set("id", job.id);
  return `${url.pathname}${url.search}${url.hash}`;
}

function isActiveJob(job) {
  return window.PlacelyCompanies?.isPublicActiveJob?.(job) || String(job?.status || "").toLowerCase() === "active";
}

function formatDate(value) {
  if (!value) return "Date not listed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not listed";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function truncateText(value, limit) {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, limit).trim()}...`;
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

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHTML(value).replaceAll("`", "&#096;");
}
