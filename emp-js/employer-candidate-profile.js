(function () {
  const profileCache = new Map();

  function createEmployerCandidateProfileWorkspace(options = {}) {
    const supabase = options.supabase || window.employerSupabase;
    const shell = document.querySelector(options.shellSelector || ".employer-shell, .page-shell, main");
    const source = options.source || "candidates";
    const backLabel = options.backLabel || "Back";
    const getEmployerId = options.getEmployerId || (() => "");
    const isSaved = options.isSaved || (() => false);
    const onBack = options.onBack || (() => {});
    const onSaveToggle = options.onSaveToggle || null;
    const onMessage = options.onMessage || null;
    let workspace = null;
    let hiddenChildren = [];
    let activeCandidateId = "";
    let activeContext = {};

    function ensureWorkspace() {
      if (workspace) return workspace;
      workspace = document.createElement("section");
      workspace.className = "employer-candidate-profile-workspace";
      workspace.hidden = true;
      shell?.appendChild(workspace);
      return workspace;
    }

    function showWorkspace() {
      if (!shell) return;
      workspace = ensureWorkspace();
      hiddenChildren = [...shell.children].filter((child) => child !== workspace && !child.hidden);
      hiddenChildren.forEach((child) => {
        child.hidden = true;
      });
      workspace.hidden = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function hideWorkspace({ replaceHistory = true } = {}) {
      if (!workspace) return;
      workspace.hidden = true;
      workspace.innerHTML = "";
      hiddenChildren.forEach((child) => {
        child.hidden = false;
      });
      hiddenChildren = [];
      activeCandidateId = "";
      activeContext = {};
      if (replaceHistory) updateUrl({});
      onBack();
    }

    async function open(candidateId, context = {}) {
      const id = String(candidateId || "").trim();
      if (!id) return;

      activeCandidateId = id;
      activeContext = { ...context };
      showWorkspace();
      renderLoading();
      updateUrl({
        candidateId: id,
        applicationId: context.applicationId,
        jobId: context.jobId,
        replaceHistory: context.replaceHistory
      });

      try {
        const profile = await fetchProfile(id, context);
        if (activeCandidateId !== id) return;
        renderProfile(profile);
      } catch (error) {
        if (activeCandidateId !== id) return;
        renderError(error);
      }
    }

    async function restoreFromUrl() {
      const params = new URLSearchParams(window.location.search);
      if (params.get("view") !== "profile") return false;
      const candidateId = params.get("candidate") || params.get("candidate_id") || "";
      if (!candidateId) return false;
      await open(candidateId, {
        replaceHistory: true,
        applicationId: params.get("application") || params.get("application_id") || "",
        jobId: params.get("job") || params.get("job_id") || ""
      });
      return true;
    }

    async function fetchProfile(candidateId, context = {}) {
      const cacheKey = [
        getEmployerId(),
        candidateId,
        context.applicationId || "",
        context.jobId || ""
      ].join(":");

      if (profileCache.has(cacheKey)) return profileCache.get(cacheKey);

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session) {
        throw createProfileError("AUTHENTICATION_REQUIRED", "Your session has expired. Please log in again.");
      }

      const { data, error } = await supabase.functions.invoke("get-employer-visible-candidate-profile", {
        body: {
          candidateId,
          source,
          applicationId: context.applicationId || null,
          jobId: context.jobId || null
        }
      });

      if (error || !data?.candidate) {
        const responseError = await readFunctionError(error);
        console.error("Employer candidate profile lookup failed", {
          code: responseError.code || data?.code || "",
          message: responseError.message || data?.error || error?.message || "",
          status: responseError.status || error?.context?.status || null
        });
        throw createProfileError(
          responseError.code || data?.code || "PROFILE_LOAD_FAILED",
          getFriendlyProfileError(responseError.code || data?.code, responseError.message || data?.error || error?.message)
        );
      }

      profileCache.set(cacheKey, data.candidate);
      return data.candidate;
    }

    function renderLoading() {
      workspace.innerHTML = `
        ${renderHeading()}
        <div class="employer-profile-skeleton" aria-busy="true">
          <div class="candidate-preview-hero">
            <span class="candidate-preview-photo skeleton-block"></span>
            <div class="skeleton-stack">
              <span class="skeleton-line wide"></span>
              <span class="skeleton-line"></span>
              <span class="skeleton-line short"></span>
            </div>
            <span class="candidate-preview-about skeleton-panel"></span>
          </div>
          <div class="candidate-preview-grid">
            <span class="candidate-preview-card skeleton-panel"></span>
            <span class="candidate-preview-card skeleton-panel"></span>
          </div>
        </div>
      `;
      bindBack();
    }

    function renderProfile(profile) {
      const profileForRender = {
        ...profile,
        resume_path: profile.resume_available ? "available" : "",
        resume_url: ""
      };

      workspace.innerHTML = `
        ${renderHeading()}
        <section class="employer-candidate-actions" aria-label="Candidate actions">
          ${onSaveToggle ? `<button type="button" class="secondary-btn" id="profileSaveCandidateBtn">${isSaved(profile.id) || profile.saved_by_employer ? "Saved" : "Save Candidate"}</button>` : ""}
          ${onMessage ? '<button type="button" class="primary-btn" id="profileMessageCandidateBtn">Message Candidate</button>' : ""}
        </section>
        ${window.CandidateProfilePreview?.renderCandidateProfile?.(profileForRender, {
          viewer: "employer",
          showContactAccordingToVisibility: true,
          showEmployerActions: false
        }) || ""}
      `;

      bindBack();
      document.getElementById("profileSaveCandidateBtn")?.addEventListener("click", async () => {
        await onSaveToggle(profile);
        renderProfile({ ...profile, saved_by_employer: isSaved(profile.id) });
      });
      document.getElementById("profileMessageCandidateBtn")?.addEventListener("click", () => onMessage(profile));
    }

    function renderError(error) {
      const message = String(error?.message || "");
      const code = error?.code || "";
      const isAccess = code === "CANDIDATE_ACCESS_REQUIRED" || /access|required|unauthorized|forbidden/i.test(message);
      const title = getProfileErrorTitle(code, message);
      const description = message || "Please try again.";

      workspace.innerHTML = `
        ${renderHeading()}
        <section class="employer-candidate-profile-error">
          <div class="empty-icon">PT</div>
          <h2>${escapeHTML(title)}</h2>
          <p>${escapeHTML(description)}</p>
          ${isAccess ? '<a class="primary-btn" href="employer-dashboard.html#candidate-access">View Candidate Access</a>' : ""}
        </section>
      `;
      bindBack();
    }

    function renderHeading() {
      return `
        <section class="dashboard-briefing employer-candidate-profile-briefing" aria-labelledby="employerCandidateProfileTitle">
          <div class="briefing-copy">
            <h1 id="employerCandidateProfileTitle">Candidate Profile</h1>
            <p>Review this candidate's experience, skills, availability, and verified profile information.</p>
          </div>
          <div class="briefing-actions">
            <button type="button" class="secondary-btn" id="backToEmployerSourceBtn">${getBackIcon()} ${escapeHTML(backLabel)}</button>
          </div>
        </section>
      `;
    }

    function bindBack() {
      document.getElementById("backToEmployerSourceBtn")?.addEventListener("click", () => hideWorkspace({ replaceHistory: true }));
    }

    function updateUrl(context = {}) {
      const url = new URL(window.location.href);
      url.searchParams.delete("view");
      url.searchParams.delete("candidate");
      url.searchParams.delete("candidate_id");
      url.searchParams.delete("application");
      url.searchParams.delete("application_id");

      if (context.candidateId) {
        url.searchParams.set("view", "profile");
        url.searchParams.set("candidate", context.candidateId);
        if (context.applicationId) url.searchParams.set("application", context.applicationId);
        if (context.jobId) url.searchParams.set("job", context.jobId);
      }

      const method = context.replaceHistory ? "replaceState" : "pushState";
      window.history[method]({ employerProfileView: Boolean(context.candidateId), source }, "", url);
    }

    window.addEventListener("popstate", () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("view") === "profile") {
        restoreFromUrl();
      } else if (workspace && !workspace.hidden) {
        hideWorkspace({ replaceHistory: false });
      }
    });

    return {
      open,
      restoreFromUrl,
      close: hideWorkspace,
      renderProfile
    };
  }

  function getBackIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16"><path fill="currentColor" d="m10.8 12 4.6 4.6L14 18l-6-6 6-6 1.4 1.4L10.8 12Z"/></svg>';
  }

  function escapeHTML(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function readFunctionError(error) {
    const response = error?.context;
    if (!response || typeof response.json !== "function") {
      return { code: "", message: error?.message || "", status: response?.status || null };
    }

    try {
      const body = await response.json();
      return {
        code: body?.code || "",
        message: body?.error || body?.message || "",
        status: response.status
      };
    } catch {
      return { code: "", message: error?.message || "", status: response.status };
    }
  }

  function createProfileError(code, message) {
    const error = new Error(message || "We could not load this candidate profile.");
    error.code = code || "";
    return error;
  }

  function getFriendlyProfileError(code, fallback = "") {
    const messages = {
      AUTHENTICATION_REQUIRED: "Your session has expired. Please log in again.",
      NOT_EMPLOYER: "Only employers can view candidate profiles.",
      EMPLOYER_PROFILE_NOT_FOUND: "We could not load your employer account.",
      EMPLOYER_PROFILE_LOOKUP_FAILED: "We could not load your employer account.",
      CANDIDATE_ACCESS_REQUIRED: "Candidate Access is required to view this profile.",
      APPLICANT_ACCESS_DENIED: "We could not confirm access to this applicant's profile.",
      CANDIDATE_NOT_VISIBLE: "This candidate is no longer visible to employers.",
      CANDIDATE_PROFILE_LOOKUP_FAILED: "We could not load this candidate profile. Please try again.",
      INVALID_CANDIDATE: "Candidate profile unavailable.",
      PROFILE_ACCESS_DENIED: "We could not load your employer account."
    };
    return messages[code] || fallback || "We could not load this candidate profile. Please try again.";
  }

  function getProfileErrorTitle(code, message = "") {
    if (code === "CANDIDATE_ACCESS_REQUIRED") return "Candidate Access required";
    if (code === "CANDIDATE_NOT_VISIBLE" || message.includes("visible")) return "Candidate profile unavailable";
    if (code === "EMPLOYER_PROFILE_NOT_FOUND" || code === "EMPLOYER_PROFILE_LOOKUP_FAILED" || code === "PROFILE_ACCESS_DENIED") return "Employer account unavailable";
    return "We could not load this candidate profile";
  }

  window.PlacelyEmployerCandidateProfile = {
    createEmployerCandidateProfileWorkspace
  };
})();
