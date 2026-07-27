(function () {
  const SEARCH_DELAY_MS = 240;
  const RESULT_LIMIT = 5;
  const minQueryLength = 2;

  let searchSupabase = null;
  let activeTimer = null;

  document.addEventListener("DOMContentLoaded", initCandidateGlobalSearch);

  function initCandidateGlobalSearch() {
    const form = document.querySelector(".utility-search");
    const input = form?.querySelector("input[type='search']");
    if (!form || !input || !/jobs, companies, or messages/i.test(input.placeholder || "")) return;
    if (!window.PlacelyCompanies || !window.PlacelyJobUrls || !window.PlacelyAuth) return;

    searchSupabase = window.PlacelyAuth.client();
    form.classList.add("has-global-results");
    form.setAttribute("aria-haspopup", "listbox");

    const panel = document.createElement("div");
    panel.className = "global-search-results";
    panel.hidden = true;
    panel.setAttribute("role", "listbox");
    panel.setAttribute("aria-label", "Search results");
    form.appendChild(panel);

    input.addEventListener("input", () => {
      window.clearTimeout(activeTimer);
      activeTimer = window.setTimeout(() => updateResults(input, panel), SEARCH_DELAY_MS);
    });

    input.addEventListener("focus", () => {
      if (String(input.value || "").trim().length >= minQueryLength) updateResults(input, panel);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        panel.hidden = true;
        return;
      }

      if (event.key === "ArrowDown") {
        const first = panel.querySelector("a");
        if (first && !panel.hidden) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    panel.addEventListener("keydown", (event) => {
      const links = [...panel.querySelectorAll("a")];
      const index = links.indexOf(document.activeElement);
      if (event.key === "Escape") {
        panel.hidden = true;
        input.focus();
      } else if (event.key === "ArrowDown" && links[index + 1]) {
        event.preventDefault();
        links[index + 1].focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (links[index - 1]) links[index - 1].focus();
        else input.focus();
      }
    });

    document.addEventListener("click", (event) => {
      if (!form.contains(event.target)) panel.hidden = true;
    });

    form.addEventListener("submit", (event) => {
      const query = String(input.value || "").trim();
      if (!query) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.href = buildFindJobsSearchUrl(query);
    }, { capture: true });
  }

  async function updateResults(input, panel) {
    const query = String(input.value || "").trim();
    if (query.length < minQueryLength) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }

    panel.hidden = false;
    panel.innerHTML = `<div class="global-search-state">Searching...</div>`;

    const [jobs, companies, messages] = await Promise.all([
      searchJobs(query),
      searchCompanies(query),
      searchVisibleMessages(query)
    ]);

    if (!jobs.length && !companies.length && !messages.length) {
      panel.innerHTML = `<div class="global-search-state">No results found</div>`;
      return;
    }

    panel.innerHTML = [
      renderJobResults(jobs),
      renderCompanyResults(companies),
      renderMessageResults(messages)
    ].filter(Boolean).join("");
  }

  async function searchJobs(query) {
    const { data, error } = await searchSupabase
      .from("jobs")
      .select(window.PlacelyCompanies.PUBLIC_JOB_COLUMNS)
      .in("status", window.PlacelyCompanies.ACTIVE_JOB_STATUSES)
      .or(`job_title.ilike.%${escapeLike(query)}%,company_name.ilike.%${escapeLike(query)}%,location.ilike.%${escapeLike(query)}%`)
      .order("created_at", { ascending: false })
      .limit(RESULT_LIMIT);

    return error ? [] : (data || [])
      .filter((job) => window.PlacelyCompanies.isPublicActiveJob(job))
      .map(window.PlacelyCompanies.mapPublicJob);
  }

  async function searchCompanies(query) {
    const { data, error } = await window.PlacelyCompanies.runPublicCompanyQuery(
      searchSupabase,
      (companyQuery) => companyQuery
        .or(`company_name.ilike.%${escapeLike(query)}%,company_location.ilike.%${escapeLike(query)}%,industry.ilike.%${escapeLike(query)}%,main_hiring_industry.ilike.%${escapeLike(query)}%`)
        .order("company_name", { ascending: true })
        .limit(RESULT_LIMIT)
    );

    return error ? [] : (data || []).map((profile) => window.PlacelyCompanies.mapPublicCompany(profile, { supabase: searchSupabase }));
  }

  function searchVisibleMessages(query) {
    const rows = [...document.querySelectorAll(".conversation-row")];
    if (!rows.length) return [];

    const normalized = query.toLowerCase();
    return rows
      .filter((row) => row.textContent.toLowerCase().includes(normalized))
      .slice(0, 3)
      .map((row) => ({
        title: row.querySelector("strong")?.textContent?.trim() || "Message",
        meta: row.querySelector(".conversation-meta")?.textContent?.trim() || "Message",
        href: "candidate-messages.html"
      }));
  }

  function renderJobResults(jobs) {
    if (!jobs.length) return "";
    return `
      <section class="global-search-group">
        <span>Jobs</span>
        ${jobs.map((job) => `
          <a href="${window.PlacelyCompanies.escapeAttribute(window.PlacelyJobUrls.buildFindJobsUrl(job.raw, { basePath: getPublicPath("find-jobs.html") }))}" role="option">
            <strong>${window.PlacelyCompanies.escapeHTML(job.title)}</strong>
            <small>${window.PlacelyCompanies.escapeHTML(job.company)} - ${window.PlacelyCompanies.escapeHTML(job.location)}</small>
            <em>Job</em>
          </a>
        `).join("")}
      </section>
    `;
  }

  function renderCompanyResults(companies) {
    if (!companies.length) return "";
    return `
      <section class="global-search-group">
        <span>Companies</span>
        ${companies.map((company) => `
          <a href="${window.PlacelyCompanies.escapeAttribute(window.PlacelyCompanies.buildCompanyProfileUrl(company.raw, {
            basePath: getPublicPath("company.html"),
            source: "candidate",
            returnTo: getCurrentReturnPath()
          }))}" role="option" class="global-company-result">
            ${window.PlacelyCompanies.renderCompanyAvatar(company)}
            <span>
              <strong>${window.PlacelyCompanies.escapeHTML(company.company_name)}</strong>
              <small>${window.PlacelyCompanies.escapeHTML(company.company_location || company.industry || "Company profile")}</small>
            </span>
            <em>Company</em>
          </a>
        `).join("")}
      </section>
    `;
  }

  function renderMessageResults(messages) {
    if (!messages.length) return "";
    return `
      <section class="global-search-group">
        <span>Messages</span>
        ${messages.map((message) => `
          <a href="${window.PlacelyCompanies.escapeAttribute(message.href)}" role="option">
            <strong>${window.PlacelyCompanies.escapeHTML(message.title)}</strong>
            <small>${window.PlacelyCompanies.escapeHTML(message.meta)}</small>
            <em>Message</em>
          </a>
        `).join("")}
      </section>
    `;
  }

  function buildFindJobsSearchUrl(query) {
    const url = new URL(getPublicPath("find-jobs.html"), window.location.href);
    url.searchParams.set("role", "candidate");
    url.searchParams.set("keyword", query);
    return `${url.pathname}${url.search}`;
  }

  function getPublicPath(fileName) {
    return window.location.pathname.includes("/public/") ? fileName : `../public/${fileName}`;
  }

  function getCurrentReturnPath() {
    const basePath = window.PlacelyCompanies.getPlacelyBasePath?.() || "/";
    let pathname = window.location.pathname || "";
    if (basePath !== "/" && pathname.startsWith(basePath)) {
      pathname = pathname.slice(basePath.length);
    } else {
      pathname = pathname.replace(/^\/+/, "");
    }
    return `${pathname}${window.location.search}${window.location.hash}`;
  }

  function escapeLike(value) {
    return String(value || "").replace(/[%,]/g, " ").trim();
  }
})();
