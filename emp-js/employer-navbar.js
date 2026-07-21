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
    { label: "Company", href: "employer-profile.html", section: "company" }
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
    "employer-profile.html": "company"
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
    wireLogoutButton();
  }

  function renderNavbarMarkup() {
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
