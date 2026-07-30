(function () {
  const ICONS = {
    dashboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h7V4H4v9Zm9 7h7v-7h-7v7ZM4 20h7v-5H4v5Zm9-9h7V4h-7v7Z"/></svg>',
    jobs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6V5a3 3 0 0 1 3-3h1a3 3 0 0 1 3 3v1h3a2 2 0 0 1 2 2v10.5A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5V8a2 2 0 0 1 2-2h4Zm2 0h3V5a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1v1Zm9 5H4v7.5c0 .28.22.5.5.5h15c.28 0 .5-.22.5-.5V11Z"/></svg>',
    companies: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V7l6-4 6 4v3h6v11h-7v-5H10v5H3Zm2-2h3v-5h8v5h3v-7h-6V8.07L9 5.4 5 8.07V19Zm2-8h2v2H7v-2Zm0-3h2v2H7V8Zm4 0h2v2h-2V8Zm0 3h2v2h-2v-2Z"/></svg>',
    applications: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10a2 2 0 0 1 2 2v18l-7-3-7 3V4a2 2 0 0 1 2-2Zm0 17 5-2.14L17 19V4H7v15Zm2-9h6v2H9v-2Zm0-4h6v2H9V6Z"/></svg>',
    saved: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a2 2 0 0 1 2 2v16a1 1 0 0 1-1.55.83L12 17.53l-6.45 4.3A1 1 0 0 1 4 21V5a2 2 0 0 1 2-2Zm0 2v14.13l5.45-3.63a1 1 0 0 1 1.1 0L18 19.13V5H6Z"/></svg>',
    messages: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9.8l-4.1 3.08A1.05 1.05 0 0 1 4 19.24V17a3 3 0 0 1-2-2.83V7a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1v2.25L9.13 15H19a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H5Z"/></svg>',
    profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.33 0-8 2.03-8 4.43V20a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.57C20 16.03 16.33 14 12 14Z"/></svg>',
    resume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l5 5v15H6V2Zm8 2H8v16h10V8h-4V4Zm-3 8h4v2h-4v-2Zm0 4h4v2h-4v-2ZM9 8h2v2H9V8Z"/></svg>',
    verification: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm0 2.15 6 2.25V11c0 3.9-2.45 7.6-6 8.9-3.55-1.3-6-5-6-8.9V6.4l6-2.25Zm3.7 5.7-4.35 4.35-2.05-2.05-1.4 1.42 3.45 3.43 5.75-5.75-1.4-1.4Z"/></svg>',
    support: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 1 10 10v5a3 3 0 0 1-3 3h-2v-8h3a8 8 0 1 0-16 0h3v8H5a3 3 0 0 1-3-3v-5A10 10 0 0 1 12 2Zm-3 8h2v10H9V10Zm4 0h2v10h-2V10Z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1a7.28 7.28 0 0 0-1.69-.98L14.5 2.42A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42L9.12 5.07c-.61.24-1.18.56-1.69.98l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.02.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.13.22.39.31.62.22l2.47-1c.51.4 1.07.73 1.69.98l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.61-.25 1.18-.58 1.69-.98l2.47 1c.23.09.49 0 .62-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"/></svg>'
  };

  const ROUTES = {
    dashboard: "candidates/candidate-dashboard.html",
    jobs: "public/find-jobs.html?role=candidate",
    companies: "candidates/companies.html",
    applications: "candidates/candidate-applications.html",
    saved: "public/saved-jobs.html",
    messages: "candidates/candidate-messages.html",
    profile: "candidates/candidate-profile.html",
    resume: "candidates/candidate-resume-requests.html",
    verification: "candidates/candidate-verification.html",
    support: "candidates/candidate-support.html",
    settings: "candidates/candidate-settings.html"
  };

  function renderCandidateSidebar(options = {}) {
    const sidebar = document.getElementById("candidateSidebar") || document.querySelector(".candidate-sidebar");
    if (!sidebar) return;

    const activePage = options.activePage || getActivePage();
    const verificationStatus = normalizeVerificationStatus(options.verificationStatus);
    const verificationLabel = verificationStatus === "unverified" ? "Get Verified" : "Verification";

    sidebar.setAttribute("aria-label", "Candidate navigation");
    sidebar.innerHTML = `
      <div class="sidebar-brand">
        <a href="${urlFor("dashboard")}" class="brand-mark" aria-label="Placely Talent candidate dashboard">P</a>
        <div>
          <a href="${urlFor("dashboard")}" class="brand-name">Placely Talent</a>
          <span>Talent Platform</span>
        </div>
      </div>

      <nav class="sidebar-nav" aria-label="Candidate sections">
        ${renderGroup("Overview", [
          navItem("dashboard", "Dashboard", "dashboard", activePage)
        ])}
        ${renderGroup("Jobs", [
          navItem("jobs", "Find Jobs", "jobs", activePage),
          navItem("companies", "Companies", "companies", activePage),
          navItem("applications", "Applications", "applications", activePage),
          navItem("saved", "Saved Jobs", "saved", activePage),
          navItem("messages", "Messages", "messages", activePage)
        ])}
        ${renderGroup("Profile", [
          navItem("profile", "Profile", "profile", activePage),
          navItem("resume", "Resume Requests", "resume", activePage),
          navItem("verification", verificationLabel, "verification", activePage, verificationStatus)
        ])}
      </nav>

      <div class="sidebar-footer">
        <div class="nav-group utility-group">
          <span class="nav-label">Company</span>
          ${navItem("support", "Support", "support", activePage)}
          ${navItem("settings", "Settings", "settings", activePage)}
          <button type="button" id="logoutBtn" class="candidate-logout-btn nav-item">Logout</button>
        </div>
      </div>
    `;
  }

  function updateVerificationNavStatus(status) {
    const item = document.querySelector('[data-candidate-nav="verification"]');

    const verificationStatus = normalizeVerificationStatus(status);
    updateVerificationHeaderBadge(verificationStatus);
    if (!item) return;

    const label = verificationStatus === "unverified" ? "Get Verified" : "Verification";
    const labelEl = item.querySelector("span:nth-child(2)");
    if (labelEl) labelEl.textContent = label;
    item.querySelector(".candidate-nav-status-dot")?.remove();
    if (!["unverified", "pending", "verified", "rejected"].includes(verificationStatus)) return;

    item.insertAdjacentHTML(
      "beforeend",
      `<span class="candidate-nav-status-dot ${verificationStatus}" aria-label="${escapeAttribute(getVerificationStatusCopy(verificationStatus).label)}"></span>`
    );
  }

  function updateResumeRequestCount(count) {
    const item = document.querySelector('[data-candidate-nav="resume"]');
    const value = Math.max(0, Number(count || 0));
    if (item) {
      item.querySelector(".candidate-nav-count")?.remove();
      if (value) {
        item.insertAdjacentHTML(
          "beforeend",
          `<span class="candidate-nav-count" aria-label="${value} pending resume request${value === 1 ? "" : "s"}">${value > 9 ? "9+" : value}</span>`
        );
      }
    }

    updateResumeNotificationLink(value);
  }

  function updateResumeNotificationLink(count) {
    const badge = document.getElementById("topNotificationBadge");
    const link = badge?.closest("a");
    if (!badge || !link || count <= 0) return;

    badge.hidden = false;
    badge.textContent = count > 9 ? "9+" : String(count);
    link.href = urlFor("resume");
    link.setAttribute("aria-label", `${count} pending resume request${count === 1 ? "" : "s"}`);
    link.title = "Resume request notification";
  }

  function ensureVerificationHeaderBadge() {
    const actions = document.querySelector(".utility-actions");
    if (!actions) return null;

    let badge = document.getElementById("candidateVerificationStatusBadge");
    if (badge) return badge;

    badge = document.createElement("a");
    badge.id = "candidateVerificationStatusBadge";
    badge.className = "candidate-verification-status-badge";
    badge.href = urlFor("verification");
    badge.hidden = true;

    const firstIcon = actions.querySelector(".utility-icon-link");
    actions.insertBefore(badge, firstIcon || actions.firstChild);
    return badge;
  }

  function updateVerificationHeaderBadge(status) {
    const badge = ensureVerificationHeaderBadge();
    if (!badge) return;

    const verificationStatus = normalizeVerificationStatus(status);
    if (verificationStatus === "unknown") {
      badge.hidden = true;
      badge.removeAttribute("aria-label");
      badge.innerHTML = "";
      return;
    }

    const copy = getVerificationStatusCopy(verificationStatus);
    badge.hidden = false;
    badge.className = `candidate-verification-status-badge ${verificationStatus}`;
    badge.href = urlFor("verification");
    badge.setAttribute("aria-label", `View verification status: ${copy.label}`);
    badge.title = copy.label;
    badge.innerHTML = `${copy.icon}<span>${copy.label}</span>`;
  }

  function getVerificationStatusCopy(status) {
    if (status === "verified") {
      return {
        label: "Verified by Placely",
        icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm3.7 7.85-4.35 4.35-2.05-2.05-1.4 1.42 3.45 3.43 5.75-5.75-1.4-1.4Z"/></svg>'
      };
    }

    if (status === "pending") {
      return {
        label: "Verification Pending",
        icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm1 5h-2v5.42l3.78 3.78 1.42-1.42-3.2-3.2V7Z"/></svg>'
      };
    }

    return {
      label: "Not Verified",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1 7h2v5h-2V9Zm0 7h2v2h-2v-2Z"/></svg>'
    };
  }

  function updateActivePage(activePage = getActivePage()) {
    document.querySelectorAll("[data-candidate-nav]").forEach((item) => {
      const isActive = item.getAttribute("data-candidate-nav") === activePage;
      item.classList.toggle("active", isActive);
      if (isActive) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }

  function renderGroup(label, items) {
    return `
      <div class="nav-group">
        <span class="nav-label">${label}</span>
        ${items.join("")}
      </div>
    `;
  }

  function navItem(key, label, icon, activePage, verificationStatus = "") {
    const active = activePage === key;
    const badge = key === "verification" && ["unverified", "pending", "verified", "rejected"].includes(verificationStatus)
      ? `<span class="candidate-nav-status-dot ${verificationStatus}" aria-label="${escapeAttribute(getVerificationStatusCopy(verificationStatus).label)}"></span>`
      : "";

    return `
      <a href="${urlFor(key)}" class="candidate-nav-link nav-item${active ? " active" : ""}" data-candidate-nav="${key}"${active ? ' aria-current="page"' : ""}>
        ${ICONS[icon]}
        <span>${label}</span>
        ${badge}
      </a>
    `;
  }

  function getActivePage() {
    const pathname = window.location.pathname.toLowerCase();
    const filename = pathname.split("/").pop() || "";

    if (filename === "candidate-dashboard.html") return "dashboard";
    if (filename === "find-jobs.html") return "jobs";
    if (filename === "companies.html" || filename === "candidates.html") return "companies";
    if (filename === "candidate-applications.html") return "applications";
    if (filename === "saved-jobs.html") return "saved";
    if (filename === "candidate-messages.html") return "messages";
    if (filename === "candidate-verification.html") return "verification";
    if (filename === "candidate-support.html") return "support";
    if (filename === "candidate-settings.html") return "settings";
    if (filename === "candidate-resume-requests.html") return "resume";
    if (filename === "candidate-profile.html" && window.location.hash === "#documents-section") return "resume";
    if (filename === "candidate-profile.html") return "profile";
    if (filename === "apply-job.html") return "jobs";

    return "dashboard";
  }

  function normalizeVerificationStatus(status) {
    const value = String(status || "unknown").toLowerCase().trim();
    return ["unverified", "pending", "verified", "rejected"].includes(value) ? value : "unknown";
  }

  function getPlacelyBasePath() {
    const path = window.location.pathname;
    const placelyIndex = path.toLowerCase().indexOf("/placely/");
    if (placelyIndex >= 0) return path.slice(0, placelyIndex + "/Placely/".length);
    return "/";
  }

  function urlFor(key) {
    const route = ROUTES[key] || ROUTES.dashboard;
    return `${getPlacelyBasePath()}${route}`;
  }

  window.PlacelyCandidateSidebar = {
    render: renderCandidateSidebar,
    updateVerificationStatus: updateVerificationNavStatus,
    updateResumeRequestCount,
    updateActivePage,
    getActivePage,
    urlFor
  };

  renderCandidateSidebar();
  loadVerificationNavStatus();
  loadPendingResumeRequestCount();
  window.addEventListener("hashchange", () => updateActivePage());

  async function loadVerificationNavStatus() {
    try {
      if (!window.PlacelyAuth?.client) return;
      const supabase = window.PlacelyAuth.client();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) return;

      const { data, error } = await supabase
        .from("candidate_profiles")
        .select("verification_status")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        console.warn("Candidate shell verification status failed to load", {
          code: error?.code,
          message: error?.message
        });
        updateVerificationNavStatus("unknown");
        return;
      }

      updateVerificationNavStatus(data?.verification_status || "unknown");
    } catch (error) {
      console.warn("Candidate shell verification status failed to load", {
        message: error?.message
      });
      updateVerificationNavStatus("unknown");
    }
  }

  async function loadPendingResumeRequestCount() {
    try {
      if (!window.PlacelyAuth?.client) return;
      const supabase = window.PlacelyAuth.client();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) return;

      const { count, error } = await supabase
        .from("candidate_resume_requests")
        .select("*", { count: "exact", head: true })
        .eq("candidate_id", user.id)
        .eq("status", "pending");

      if (error) {
        console.warn("Candidate shell resume request count failed to load", {
          code: error?.code,
          message: error?.message
        });
        updateResumeRequestCount(0);
        return;
      }

      updateResumeRequestCount(count || 0);
    } catch (error) {
      console.warn("Candidate shell resume request count failed to load", {
        message: error?.message
      });
      updateResumeRequestCount(0);
    }
  }

  function escapeAttribute(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
      .replaceAll("`", "&#096;");
  }
})();
