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
    ensureSidebarUtilitySection();
    ensureHeaderSupportLink();
    ensureTopAccountMenu();
    wireLogoutButton();
    hydrateEmployerAccountIdentity();
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
    if (options.active || section === activeSection) classes.push("active");
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

  async function hydrateEmployerAccountIdentity() {
    const employerClient = window.employerSupabase;
    if (!employerClient) return;

    try {
      const {
        data: { session },
        error: sessionError
      } = await employerClient.auth.getSession();

      if (sessionError || !session?.user) return;

      const { data: profile, error } = await employerClient
        .from("employer_profiles")
        .select("id, company_name, company_email, company_logo_url, candidate_access, subscription_status")
        .eq("id", session.user.id)
        .maybeSingle();

      if (error) {
        console.error("Employer account identity lookup failed", {
          code: error?.code,
          message: error?.message,
          details: error?.details,
          hint: error?.hint
        });
        applyEmployerAccountIdentity(null, session.user);
        return;
      }

      applyEmployerAccountIdentity(profile, session.user);
      window.applyCandidateAccessUI?.(hasCandidateSearchAccess(profile || {}));
    } catch (error) {
      console.error("Employer account identity hydration failed", {
        message: error?.message || String(error || "")
      });
    }
  }

  function applyEmployerAccountIdentity(profile = {}, user = {}) {
    const companyName = String(
      profile?.company_name ||
      user?.user_metadata?.company_name ||
      user?.email?.split("@")[0] ||
      "Employer"
    ).trim();
    const email = String(profile?.company_email || user?.email || "").trim();
    const initials = window.PlacelyAuth?.getInitials?.(companyName) || getInitials(companyName);
    const logoUrl = window.PlacelyAuth?.resolveEmployerLogoUrl?.(profile?.company_logo_url) || "";

    setText("topCompanyName", companyName);
    setText("companyNameTitle", companyName);

    document.querySelectorAll(".utility-actions .top-account, .utility-actions #topAccountButton").forEach((account) => {
      const avatar = account.querySelector(".account-avatar");
      const label = [...account.querySelectorAll("span")].find((span) => !span.classList.contains("account-avatar"));
      if (avatar) renderEmployerAvatar(avatar, companyName, initials, logoUrl);
      if (label) label.textContent = companyName;
    });

    document.querySelectorAll(".sidebar-account").forEach((account) => {
      const avatar = account.querySelector(".account-avatar");
      const name = account.querySelector(".account-copy strong");
      const caption = account.querySelector(".account-copy span");
      if (avatar) renderEmployerAvatar(avatar, companyName, initials, logoUrl);
      if (name) name.textContent = companyName;
      if (caption) caption.textContent = "Employer account";
    });

    updateTopAccountMenu({
      companyName,
      email,
      companyEmail: email
    });
  }

  function renderEmployerAvatar(avatar, companyName, initials, logoUrl) {
    avatar.textContent = "";
    avatar.innerHTML = logoUrl
      ? `<img src="${escapeHTML(logoUrl)}" alt="${escapeHTML(companyName)} logo" loading="lazy" decoding="async" onerror="this.parentElement.textContent='${escapeHTML(initials)}'">`
      : escapeHTML(initials);
  }

  function ensureSidebarUtilitySection() {
    const footer = document.querySelector(".sidebar-footer");
    if (!footer) return;

    footer.querySelectorAll(".sidebar-account, .sidebar-support-section, .sidebar-utility-section").forEach((element) => {
      element.remove();
    });

    const planCard = ensureSidebarPlanCard(footer);
    const logoutButton = ensureSidebarLogoutButton(footer);
    const utilitySection = document.createElement("section");
    utilitySection.className = "sidebar-utility-section";
    utilitySection.innerHTML = `
      ${renderSidebarLink("Support", "employer-support.html", "support", "M12 2a10 10 0 0 1 10 10v5a3 3 0 0 1-3 3h-2v-8h3a8 8 0 1 0-16 0h3v8H5a3 3 0 0 1-3-3v-5A10 10 0 0 1 12 2Zm-3 8h2v10H9V10Zm4 0h2v10h-2V10Z", { id: "employerSupportSidebarLink" })}
      ${renderSidebarLink("Settings", "employer-profile.html", "settings", "M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1a7.28 7.28 0 0 0-1.69-.98L14.5 2.42A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42L9.12 5.07c-.61.24-1.18.56-1.69.98l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.02.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.13.22.39.31.62.22l2.47-1c.51.4 1.07.73 1.69.98l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.61-.25 1.18-.58 1.69-.98l2.47 1c.23.09.49 0 .62-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z", { id: "employerSettingsSidebarLink", active: currentPage === "employer-profile.html" })}
    `;

    utilitySection.appendChild(logoutButton);
    footer.replaceChildren(...[planCard, utilitySection].filter(Boolean));
    wireLogoutButton();
  }

  function ensureSidebarPlanCard(footer) {
    let planCard = document.getElementById("sidebarPlanCard");

    if (!planCard) {
      planCard = document.createElement("section");
      planCard.id = "sidebarPlanCard";
      planCard.className = "sidebar-plan-card";
      planCard.setAttribute("aria-live", "polite");
    }

    if (!planCard.innerHTML.trim()) {
      planCard.hidden = true;
    }

    return planCard;
  }

  function ensureSidebarLogoutButton(footer) {
    const existing = footer.querySelector("#logoutBtn") || document.getElementById("logoutBtn");
    const logoutButton = existing instanceof HTMLButtonElement ? existing : document.createElement("button");
    logoutButton.type = "button";
    logoutButton.id = "logoutBtn";
    logoutButton.className = "logout-btn nav-logout";
    logoutButton.textContent = "Logout";
    return logoutButton;
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

  function ensureTopAccountMenu() {
    const topAccount = document.querySelector(".utility-actions .top-account");
    if (!topAccount || document.getElementById("employerAccountMenu")) return;

    const accountButton = document.createElement("button");
    accountButton.type = "button";
    accountButton.className = topAccount.className;
    accountButton.id = topAccount.id || "topAccountButton";
    accountButton.innerHTML = topAccount.innerHTML;
    accountButton.setAttribute("aria-haspopup", "menu");
    accountButton.setAttribute("aria-expanded", "false");
    accountButton.setAttribute("aria-controls", "employerAccountMenu");

    const wrap = document.createElement("div");
    wrap.className = "top-account-menu-wrap";

    const menu = document.createElement("div");
    menu.id = "employerAccountMenu";
    menu.className = "top-account-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Employer account menu");
    menu.innerHTML = renderTopAccountMenu();

    wrap.append(accountButton, menu);
    topAccount.replaceWith(wrap);

    accountButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setTopAccountMenuOpen(!isTopAccountMenuOpen());
    });

    menu.addEventListener("click", (event) => {
      const logoutAction = event.target.closest?.("[data-account-logout]");
      if (logoutAction) {
        event.preventDefault();
        setTopAccountMenuOpen(false);
        handleAccountMenuLogout();
        return;
      }

      if (event.target.closest?.("a[href]")) {
        setTopAccountMenuOpen(false);
      }
    });

    document.addEventListener("click", (event) => {
      if (!isTopAccountMenuOpen()) return;
      if (event.target.closest?.(".top-account-menu-wrap")) return;
      setTopAccountMenuOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !isTopAccountMenuOpen()) return;
      setTopAccountMenuOpen(false);
      accountButton.focus();
    });

    updateTopAccountMenu();
  }

  function renderTopAccountMenu() {
    return `
      <div class="top-account-menu-header">
        <strong id="accountMenuCompanyName">Employer</strong>
        <span id="accountMenuEmail">Account details loading</span>
      </div>
      <div class="top-account-menu-list">
        <a href="employer-profile.html" role="menuitem">Company Profile</a>
        <a href="employer-profile.html" role="menuitem">Settings</a>
        <a href="employer-dashboard.html#candidate-access" role="menuitem">Candidate Access</a>
        <a href="employer-support.html" role="menuitem">Support</a>
        <button type="button" role="menuitem" data-account-logout>Logout</button>
      </div>
    `;
  }

  function isTopAccountMenuOpen() {
    const menu = document.getElementById("employerAccountMenu");
    return Boolean(menu && !menu.hidden);
  }

  function setTopAccountMenuOpen(open) {
    const button = document.getElementById("topAccountButton");
    const menu = document.getElementById("employerAccountMenu");
    if (!button || !menu) return;

    button.setAttribute("aria-expanded", String(open));
    menu.hidden = !open;

    if (open) {
      closeOtherHeaderMenus(menu);
    }
  }

  function closeOtherHeaderMenus(currentMenu) {
    document.querySelectorAll(".top-account-menu").forEach((menu) => {
      if (menu !== currentMenu) menu.hidden = true;
    });
  }

  function updateTopAccountMenu(profile = {}) {
    const buttonName = document.getElementById("topCompanyName")?.textContent?.trim();
    const companyName = String(profile.companyName || buttonName || "Employer").trim();
    const accountEmail = String(profile.email || profile.companyEmail || "").trim();

    const nameElement = document.getElementById("accountMenuCompanyName");
    const emailElement = document.getElementById("accountMenuEmail");

    if (nameElement) nameElement.textContent = companyName;
    if (emailElement) emailElement.textContent = accountEmail || "Account details unavailable";
  }

  async function handleAccountMenuLogout() {
    if (typeof window.handleLogout === "function") {
      await window.handleLogout();
      return;
    }

    await handleLogout();
  }

  function applyCandidateAccessUI(hasAccess) {
    window.currentEmployerCandidateAccess = hasAccess === true;
    applyCandidateNavbarUI(hasAccess);
    applySidebarPlanCardUI(hasAccess);
    applyCandidateDashboardUI(hasAccess);
  }

  function applySidebarPlanCardUI(hasAccess) {
    const card = document.getElementById("sidebarPlanCard");
    if (!card) return;

    if (hasAccess) {
      card.hidden = true;
      card.replaceChildren();
      card.className = "sidebar-plan-card";
      return;
    }

    card.hidden = false;
    card.className = "sidebar-plan-card free";
    card.innerHTML = `
      <span class="plan-kicker">GET ACCESS</span>
      <h2>Unlock candidate search</h2>
      <p>Find, save, and message pre-screened talent from your employer workspace.</p>
      <a class="plan-card-action" href="employer-dashboard.html#candidate-access">GET ACCESS</a>
    `;
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

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value || "";
  }

  function getInitials(value) {
    const words = String(value || "Employer").trim().split(/\s+/).filter(Boolean);
    const initials = words.slice(0, 2).map((word) => word[0]?.toUpperCase() || "").join("");
    return initials || "E";
  }

  window.applyCandidateAccessUI = applyCandidateAccessUI;
  window.updateEmployerAccountMenu = updateTopAccountMenu;
  window.loadEmployerAccountIdentity = hydrateEmployerAccountIdentity;
})();
