(function () {
  const PUBLIC_COMPANY_COLUMNS = [
    "id",
    "company_name",
    "industry",
    "company_website",
    "company_location",
    "company_description",
    "employment_type",
    "pay_range",
    "hiring_timeline",
    "main_hiring_industry",
    "company_logo_url"
  ].join(", ");

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

  const ACTIVE_JOB_STATUSES = ["active", "published", "open"];
  const PUBLIC_COMPANY_SOURCE = "public_employer_profiles";
  const FALLBACK_COMPANY_SOURCE = "employer_profiles";

  function text(value) {
    return String(value || "").trim();
  }

  function slugifyCompanyPart(value) {
    const slugifier = window.PlacelyJobUrls?.slugifyJobPart;
    if (typeof slugifier === "function") return slugifier(value || "company") || "company";

    return text(value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "company";
  }

  function buildCompanySlug(company) {
    return slugifyCompanyPart(company?.company_name || company?.name || "company");
  }

  function getCompanyIdFromLocation(search = window.location.search) {
    const params = new URLSearchParams(search);
    return params.get("id") || params.get("company") || "";
  }

  function buildCompanyProfileUrl(company, options = {}) {
    const id = text(typeof company === "object" ? company?.id : company);
    const slug = buildCompanySlug(company);
    const basePath = options.basePath || "../public/company.html";
    const url = new URL(basePath, window.location.href);

    url.searchParams.set("id", id);
    url.searchParams.set("slug", slug);
    if (options.source) url.searchParams.set("source", text(options.source));
    if (options.selectedJobId) url.searchParams.set("selectedJobId", text(options.selectedJobId));
    if (options.returnTo) {
      const safeReturnTo = getProjectRelativeReturnDestination(options.returnTo);
      if (safeReturnTo) url.searchParams.set("returnTo", safeReturnTo);
    }
    return `${url.pathname}${url.search}`;
  }

  function getPlacelyBasePath() {
    const pathname = window.location.pathname || "/";
    const match = pathname.match(/^(.*?)(?:public|candidates|employers)\//);
    if (match) return match[1] || "/";
    if (pathname.startsWith("/Placely/")) return "/Placely/";
    return "/";
  }

  function placelyUrl(relativePath = "") {
    const cleanPath = String(relativePath || "").replace(/^\/+/, "");
    return `${getPlacelyBasePath()}${cleanPath}`;
  }

  function buildCleanCompanyProfileUrl(company, options = {}) {
    return buildCompanyProfileUrl(company, {
      basePath: options.basePath,
      source: "",
      returnTo: "",
      selectedJobId: ""
    });
  }

  function getSafeReturnDestination(value) {
    const destination = getProjectRelativeReturnDestination(value);
    return destination ? placelyUrl(destination) : "";
  }

  function getProjectRelativeReturnDestination(value) {
    const raw = text(value);
    if (!raw) return "";
    if (/^(javascript|data|vbscript):/i.test(raw) || raw.startsWith("//")) return "";

    const normalized = normalizeInternalPath(raw);
    if (!normalized) return "";
    if (!isAllowedReturnPath(normalized.pathname)) return "";
    if (hasSensitiveQuery(normalized.searchParams)) return "";

    const destination = `${normalized.pathname}${normalized.search}${normalized.hash}`;
    const current = normalizeInternalPath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    const currentDestination = current ? `${current.pathname}${current.search}${current.hash}` : "";
    if (destination === currentDestination) return "";

    return destination;
  }

  function normalizeInternalPath(raw) {
    let url;

    try {
      if (/^https?:\/\//i.test(raw)) {
        url = new URL(raw);
        if (url.origin !== window.location.origin) return null;
      } else {
        url = new URL(raw, window.location.origin);
      }
    } catch {
      return "";
    }

    const basePath = getPlacelyBasePath();
    let pathname = url.pathname || "/";
    if (basePath !== "/" && pathname.startsWith(basePath)) {
      pathname = pathname.slice(basePath.length);
    } else {
      pathname = pathname.replace(/^\/+/, "");
    }

    pathname = pathname.replace(/^\/+/, "");
    if (!pathname || pathname.includes("..")) return null;

    return {
      pathname,
      search: url.search || "",
      hash: url.hash || "",
      searchParams: url.searchParams
    };
  }

  function isAllowedReturnPath(pathname) {
    return [
      /^employers\/employer-profile\.html$/,
      /^employers\/manage-jobs\.html$/,
      /^employers\/edit-jobs\.html$/,
      /^candidates\/companies\.html$/,
      /^candidates\/candidate-resume-requests\.html$/,
      /^candidates\/candidate-dashboard\.html$/,
      /^candidates\/candidate-applications\.html$/,
      /^candidates\/candidate-messages\.html$/,
      /^public\/find-jobs\.html$/,
      /^public\/saved-jobs\.html$/,
      /^public\/job\.html$/,
      /^public\/company\.html$/
    ].some((pattern) => pattern.test(pathname));
  }

  function hasSensitiveQuery(params) {
    const sensitive = ["access_token", "refresh_token", "token", "code", "state", "error", "error_description"];
    return sensitive.some((key) => params.has(key));
  }

  function isActiveJobStatus(status) {
    return ACTIVE_JOB_STATUSES.includes(text(status).toLowerCase());
  }

  function isPublicActiveJob(job = {}) {
    if (!isActiveJobStatus(job.status)) return false;

    const deadline = text(job.application_deadline);
    if (!deadline) return true;

    const deadlineTime = new Date(deadline).getTime();
    if (Number.isNaN(deadlineTime)) return true;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return deadlineTime >= today.getTime();
  }

  function mapPublicCompany(profile = {}, options = {}) {
    const companyName = text(profile.company_name) || "Company";
    const logoValue = window.PlacelyAuth?.getPublicEmployerLogoValue?.(profile) || "";

    return {
      id: text(profile.id),
      slug: buildCompanySlug(profile),
      company_name: companyName,
      logo_url: window.PlacelyAuth?.resolveEmployerLogoUrl?.(logoValue, { supabase: options.supabase }) || "",
      initials: getInitials(companyName),
      industry: text(profile.industry),
      main_hiring_industry: text(profile.main_hiring_industry),
      company_website: normalizeWebsite(profile.company_website),
      company_location: text(profile.company_location),
      company_description: text(profile.company_description),
      employment_type: text(profile.employment_type),
      compensation_summary: text(profile.pay_range),
      hiring_timeline: text(profile.hiring_timeline),
      active_job_count: Number(options.activeJobCount || 0),
      raw: profile
    };
  }

  function mapPublicJob(job = {}) {
    return {
      id: text(job.id),
      employer_id: text(job.employer_id),
      title: text(job.job_title) || "Untitled Job",
      company: text(job.company_name) || "Employer",
      location: text(job.location) || "Location not listed",
      type: text(job.employment_type) || "Employment type not listed",
      pay: window.PlacelyAuth?.formatCompensationFromRecord?.(job) || text(job.pay_range) || "Pay not listed",
      experience: text(job.experience_level) || "Experience not listed",
      description: text(job.job_description) || "",
      requirements: text(job.required_skills) || "",
      benefits: text(job.benefits) || "",
      status: text(job.status) || "active",
      created_at: job.created_at || "",
      raw: job
    };
  }

  async function runPublicCompanyQuery(supabase, applyQuery, options = {}) {
    const sources = options.allowFallback === false
      ? [PUBLIC_COMPANY_SOURCE]
      : [PUBLIC_COMPANY_SOURCE, FALLBACK_COMPANY_SOURCE];
    let lastError = null;

    for (const source of sources) {
      let query = supabase.from(source).select(options.columns || PUBLIC_COMPANY_COLUMNS);
      query = typeof applyQuery === "function" ? applyQuery(query, source) : query;

      const { data, error } = await query;
      if (!error) return { data: data || [], source, error: null };

      lastError = error;
      if (source !== PUBLIC_COMPANY_SOURCE || !isMissingRelationError(error)) break;
    }

    return { data: [], source: "", error: lastError };
  }

  async function runPublicCompanySingleQuery(supabase, applyQuery, options = {}) {
    const result = await runPublicCompanyQuery(supabase, (query, source) => {
      const scoped = typeof applyQuery === "function" ? applyQuery(query, source) : query;
      return scoped.maybeSingle();
    }, options);

    return {
      data: Array.isArray(result.data) ? result.data[0] || null : result.data || null,
      source: result.source,
      error: result.error
    };
  }

  function isMissingRelationError(error = {}) {
    return ["PGRST205", "42P01"].includes(error.code)
      || /Could not find the table|schema cache|does not exist/i.test(error.message || "");
  }

  function normalizeWebsite(value) {
    const raw = text(value);
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://${raw}`;
  }

  function getInitials(value) {
    const words = text(value).split(/\s+/).filter(Boolean);
    if (!words.length) return "PT";
    return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
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

  function renderCompanyAvatar(company, options = {}) {
    const classes = options.large ? "company-avatar large" : "company-avatar";
    const initials = company?.initials || getInitials(company?.company_name || company?.name);

    if (company?.logo_url) {
      return `
        <div class="${classes}">
          <img src="${escapeAttribute(company.logo_url)}" alt="${escapeAttribute(company.company_name)} logo" loading="lazy" onerror="this.parentElement.textContent='${escapeAttribute(initials)}'">
        </div>
      `;
    }

    return `<div class="${classes}">${escapeHTML(initials)}</div>`;
  }

  window.PlacelyCompanies = {
    ACTIVE_JOB_STATUSES,
    PUBLIC_COMPANY_SOURCE,
    FALLBACK_COMPANY_SOURCE,
    PUBLIC_COMPANY_COLUMNS,
    PUBLIC_JOB_COLUMNS,
    buildCompanyProfileUrl,
    buildCleanCompanyProfileUrl,
    getPlacelyBasePath,
    placelyUrl,
    getSafeReturnDestination,
    buildCompanySlug,
    getCompanyIdFromLocation,
    isActiveJobStatus,
    isPublicActiveJob,
    runPublicCompanyQuery,
    runPublicCompanySingleQuery,
    mapPublicCompany,
    mapPublicJob,
    renderCompanyAvatar,
    escapeHTML,
    escapeAttribute
  };
})();
