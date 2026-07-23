(function () {
  const nav = document.querySelector("[data-employer-nav]");

  const links = [
    { label: "Dashboard", href: "employer-dashboard.html", section: "dashboard" },
    { label: "Jobs", href: "manage-jobs.html", section: "jobs" },
    { label: "Applicants", href: "employer-applicants.html", section: "applicants" },
    { label: "Interviews", href: "employer-applicants.html?stage=interview", section: "applicants" },
    {
      label: "Candidates",
      href: "find-candidates.html",
      section: "candidates",
      requiresCandidateAccess: true,
      id: "employerCandidatesNav",
      className: "employer-candidates-nav"
    },
    { label: "Saved Talent", href: "saved-talent.html", section: "saved", id: "employerSavedTalentNav", requiresCandidateAccess: true },
    { label: "Messages", href: "employer-messages.html", section: "messages" },
    { label: "Company", href: "employer-profile.html", section: "company" },
    { label: "Support", href: "employer-support.html", section: "support" }
  ];

  const activeSectionsByPage = {
    "employer-dashboard.html": "dashboard",
    "manage-jobs.html": "jobs",
    "post-job.html": "jobs",
    "edit-jobs.html": "jobs",
    "employer-applicants.html": "applicants",
    "find-candidates.html": "candidates",
    "saved-talent.html": "saved",
    "employer-messages.html": "messages",
    "employer-profile.html": "company",
    "employer-support.html": "support"
  };

  const currentPage = window.location.pathname.split("/").pop() || "employer-dashboard.html";
  const activeSection = activeSectionsByPage[currentPage] || "";

  if (nav) {
    ensureNavbarMarkup();
    if (currentPage !== "employer-dashboard.html") {
      loadCandidateAccess().then((hasAccess) => {
        window.applyCandidateAccessUI(hasAccess);
      });
    }
  }

  function ensureNavbarMarkup() {
    if (!document.getElementById("employerCandidatesNav") || nav.querySelector('a[href="hiring-requests.html"]')) {
      renderNavbarMarkup();
    }

    normalizeActiveLinks();
    ensureSidebarSupportLink();
    ensureHeaderSupportLink();
    wireLogoutButton();
  }

  function renderNavbarMarkup() {
    if (nav.closest(".dashboard-sidebar")) {
      renderSidebarNavbarMarkup();
      return;
    }

    const fragment = document.createDocumentFragment();

    links.forEach((link) => {
      const anchor = document.createElement("a");
      anchor.href = link.href;
      anchor.textContent = link.label;
      if (link.id) anchor.id = link.id;
      anchor.classList.add("employer-nav-link");
      if (link.className) anchor.classList.add(...link.className.split(" "));
      if (link.section === activeSection) anchor.classList.add("active");
      if (link.requiresCandidateAccess) anchor.dataset.planGated = "candidate-network";
      fragment.appendChild(anchor);
    });

    const logoutButton = document.createElement("button");
    logoutButton.type = "button";
    logoutButton.id = "logoutBtn";
    logoutButton.className = "logout-btn";
    logoutButton.textContent = "Logout";
    logoutButton.addEventListener("click", handleLogout);
    fragment.appendChild(logoutButton);

    nav.replaceChildren(fragment);
  }

  function renderSidebarNavbarMarkup() {
    nav.innerHTML = `
      <div class="nav-group">
        <span class="nav-label">Overview</span>
        ${renderSidebarLink("Dashboard", "employer-dashboard.html", "dashboard", "M4 13h7V4H4v9Zm9 7h7v-7h-7v7ZM4 20h7v-5H4v5Zm9-9h7V4h-7v7Z")}
      </div>
      <div class="nav-group">
        <span class="nav-label">Hiring</span>
        ${renderSidebarLink("Jobs", "manage-jobs.html", "jobs", "M9 6V5a3 3 0 0 1 3-3h1a3 3 0 0 1 3 3v1h3a2 2 0 0 1 2 2v10.5A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5V8a2 2 0 0 1 2-2h4Zm2 0h3V5a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1v1Zm9 5H4v7.5c0 .28.22.5.5.5h15c.28 0 .5-.22.5-.5V11Z")}
        ${renderSidebarLink("Applicants", "employer-applicants.html", "applicants", "M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.33 0-8 2.03-8 4.43V20a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.57C20 16.03 16.33 14 12 14Z")}
        ${renderSidebarLink("Interviews", "employer-applicants.html?stage=interview", "applicants", "M7 2h10a2 2 0 0 1 2 2v18l-7-3-7 3V4a2 2 0 0 1 2-2Zm0 17 5-2.14L17 19V4H7v15Zm2-9h6v2H9v-2Zm0-4h6v2H9V6Z")}
        ${renderSidebarLink("Messages", "employer-messages.html", "messages", "M5 4h14a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9.8l-4.1 3.08A1.05 1.05 0 0 1 4 19.24V17a3 3 0 0 1-2-2.83V7a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1v2.25L9.13 15H19a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H5Z")}
      </div>
      <div class="nav-group">
        <span class="nav-label">Talent</span>
        ${renderSidebarLink("Candidates", "find-candidates.html", "candidates", "M10.5 3a7.5 7.5 0 0 1 5.97 12.04l3.25 3.24a1 1 0 0 1-1.42 1.42l-3.24-3.25A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z", { id: "employerCandidatesNav", gated: true, extraClass: "employer-candidates-nav" })}
        ${renderSidebarLink("Saved Talent", "saved-talent.html", "saved", "M6 3h12a2 2 0 0 1 2 2v16a1 1 0 0 1-1.55.83L12 17.53l-6.45 4.3A1 1 0 0 1 4 21V5a2 2 0 0 1 2-2Zm0 2v14.13l5.45-3.63a1 1 0 0 1 1.1 0L18 19.13V5H6Z", { id: "employerSavedTalentNav", gated: true })}
      </div>
      <div class="nav-group">
        <span class="nav-label">Company</span>
        ${renderSidebarLink("Company Profile", "employer-profile.html", "company", "M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3h2a2 2 0 0 1 2 2v11h-6v-4H10v4H4Zm2-2h2v-4h8v4h2v-9h-4V5H6v14Zm2-11h2v2H8V8Zm0 4h2v2H8v-2Zm4-4h2v2h-2V8Zm0 4h2v2h-2v-2Z")}
      </div>
    `;
  }

  function renderSidebarLink(label, href, section, iconPath, options = {}) {
    const classes = ["employer-nav-link", "nav-item", options.extraClass || ""].filter(Boolean);
    if (section === activeSection) classes.push("active");
    const gated = options.gated ? ' data-plan-gated="candidate-network"' : "";
    const id = options.id ? ` id="${options.id}"` : "";
    const lock = options.gated ? '<span class="nav-lock" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 10V8a5 5 0 0 1 10 0v2h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V8a3 3 0 0 0-6 0v2Z"/></svg></span><span class="nav-pro-badge">Pro</span>' : "";

    return `
      <a href="${href}"${id} class="${classes.join(" ")}"${gated}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${iconPath}"/></svg>
        <span>${label}</span>
        ${lock}
      </a>
    `;
  }

  function normalizeActiveLinks() {
    const anchors = nav.querySelectorAll("a[href]");

    anchors.forEach((anchor) => {
      anchor.classList.add("employer-nav-link");
      const href = anchor.getAttribute("href") || "";
      const page = href.split("/").pop();
      const section = activeSectionsByPage[page] || "";
      anchor.classList.toggle("active", Boolean(section && section === activeSection));
    });
  }

  function wireLogoutButton() {
    const logoutButton = document.getElementById("logoutBtn");
    if (!logoutButton) return;

    logoutButton.type = "button";
    logoutButton.removeEventListener("click", handleLogout);
    logoutButton.addEventListener("click", handleLogout);
  }

  async function loadCandidateAccess() {
    const employerClient = window.employerSupabase;

    if (!employerClient) {
      return false;
    }

    try {
      const {
        data: { user },
        error: userError
      } = await employerClient.auth.getUser();

      if (userError || !user) {
        window.location.replace("employer-login.html");
        return false;
      }

      const { data, error } = await employerClient
        .from("employer_profiles")
        .select("candidate_access, subscription_status")
        .eq("id", user.id)
        .maybeSingle();

      if (error || !data) return false;
      return hasCandidateSearchAccess(data);
    } catch {
      return false;
    }
  }

  function ensureSidebarSupportLink() {
    const footer = document.querySelector(".sidebar-footer");
    if (!footer || document.getElementById("employerSupportSidebarLink")) return;

    const support = document.createElement("section");
    support.className = "sidebar-support-section";
    support.innerHTML = `
      <span class="nav-label">Support</span>
      <a href="employer-support.html" id="employerSupportSidebarLink" class="employer-nav-link nav-item ${activeSection === "support" ? "active" : ""}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 1 10 10v5a3 3 0 0 1-3 3h-2v-8h3a8 8 0 1 0-16 0h3v8H5a3 3 0 0 1-3-3v-5A10 10 0 0 1 12 2Zm-3 8h2v10H9V10Zm4 0h2v10h-2V10Z"/></svg>
        <span>Support</span>
      </a>
    `;

    footer.insertBefore(support, footer.firstElementChild);
  }

  function ensureHeaderSupportLink() {
    if (nav.closest(".dashboard-sidebar") || nav.querySelector('a[href="employer-support.html"]')) return;

    const support = document.createElement("a");
    support.href = "employer-support.html";
    support.textContent = "Support";
    support.className = `employer-nav-link${activeSection === "support" ? " active" : ""}`;

    const logout = nav.querySelector("#logoutBtn");
    nav.insertBefore(support, logout || null);
  }

  function applyCandidateAccessUI(hasAccess) {
    window.currentEmployerCandidateAccess = hasAccess === true;
    applyCandidateNavbarUI(hasAccess);
    applyCandidateDashboardUI(hasAccess);
  }

  function applyCandidateNavbarUI(hasAccess) {
    const candidatesNav = document.getElementById("employerCandidatesNav");
    const savedTalentNav = document.getElementById("employerSavedTalentNav");

    if (candidatesNav) {
      candidatesNav.hidden = false;
      candidatesNav.removeAttribute("hidden");
      candidatesNav.classList.remove("is-hidden");
      candidatesNav.classList.toggle("is-locked", !hasAccess);
      candidatesNav.setAttribute("aria-disabled", hasAccess ? "false" : "true");
      candidatesNav.style.removeProperty("display");
      candidatesNav.style.removeProperty("visibility");
      candidatesNav.style.removeProperty("opacity");

    }

    if (savedTalentNav) {
      savedTalentNav.classList.toggle("is-locked", !hasAccess);
      savedTalentNav.setAttribute("aria-disabled", hasAccess ? "false" : "true");
    }
  }

  function applyCandidateDashboardUI(hasAccess) {
    const panel = document.getElementById("candidate-access");
    const cta = document.getElementById("candidateAccessCta");
    const features = document.getElementById("candidateAccessFeatures");
    const quickAction = document.getElementById("dashboardFindCandidatesAction");
    const title = document.getElementById("candidateAccessTitle");
    const copy = document.getElementById("candidateAccessCopy");

    if (panel) {
      panel.classList.toggle("candidate-network-unlocked", hasAccess);
      panel.classList.toggle("candidate-network-locked", !hasAccess);
    }

    if (title) {
      title.textContent = hasAccess ? "Candidate Network Active" : "Unlock Candidate Network";
    }

    if (copy) {
      copy.textContent = hasAccess
        ? "Search the full candidate network, save talent, and message candidates from your recruiter workspace."
        : "Get Pro access to search verified trades candidates, view full profiles, save talent, and message candidates.";
    }

    if (cta) {
      cta.textContent = hasAccess ? "SEARCH CANDIDATES" : "GET ACCESS";
      cta.disabled = false;
      cta.classList.remove("is-loading");
      cta.onclick = hasAccess
        ? () => {
            window.location.href = "find-candidates.html";
          }
        : () => {
            if (typeof window.startCandidateCheckout === "function") {
              window.startCandidateCheckout();
              return;
            }

            window.location.href = "employer-dashboard.html#candidate-access";
          };
    }

    if (features) {
      const featureLabels = hasAccess
        ? ["Full candidate profiles", "Saved talent shortlist", "Candidate messaging"]
        : ["Candidate database", "Full profiles", "Contact + messaging"];

      features.innerHTML = featureLabels
        .map((label) => `<div class="network-feature ${hasAccess ? "active" : "locked"}"><span>${escapeHTML(label)}</span></div>`)
        .join("");
    }

    if (quickAction) {
      quickAction.classList.toggle("locked-action", !hasAccess);
      quickAction.setAttribute("aria-disabled", hasAccess ? "false" : "true");
      quickAction.onclick = hasAccess
        ? null
        : (event) => {
            event.preventDefault();
            document.getElementById("candidate-access")?.scrollIntoView({ behavior: "smooth", block: "center" });
          };
    }
  }

  function hasCandidateSearchAccess(profile) {
    return window.PlacelyAuth?.hasCandidateSearchAccess(profile) || false;
  }

  function escapeHTML(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function handleLogout() {
    if (!window.PlacelyAuth) {
      window.location.replace("employer-login.html");
      return;
    }

    try {
      await window.PlacelyAuth.clearAuthState();
    } finally {
      window.location.replace("employer-login.html");
    }
  }

  window.applyCandidateAccessUI = applyCandidateAccessUI;
})();
