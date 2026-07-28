(function () {
  const draftByJobId = new Map();
  const schemaFallbackColumns = {};

  function createFindJobsApplicationFlow(options = {}) {
    const state = {
      supabase: options.supabase,
      container: options.container,
      user: options.user,
      job: null,
      displayJob: null,
      candidateProfile: null,
      existingApplication: null,
      isSubmitting: false,
      hasUnsavedText: false,
      onBack: options.onBack || (() => {}),
      onSubmitted: options.onSubmitted || (() => {}),
      paths: {
        applications: "../candidates/candidate-applications.html",
        profile: "../candidates/candidate-profile.html",
        login: "../candidates/candidate-login.html",
        ...options.paths
      }
    };

    return {
      async mount(job, displayJob = null) {
        state.job = normalizeRawJob(job, displayJob);
        state.displayJob = displayJob || state.job;

        if (!state.container) return;
        renderLoading(state);

        if (!state.supabase || !state.user) {
          renderFatal(state, "Your session has expired.", "Please log in again before applying.");
          return;
        }

        if (!state.job?.id) {
          renderFatal(state, "No job selected", "Return to Find Jobs and choose a role to apply for.");
          return;
        }

        if (!isAcceptingApplications(state.job)) {
          renderFatal(state, "This job is no longer accepting applications.", "Return to Find Jobs to choose another open role.");
          return;
        }

        const [profileResult, applicationResult] = await Promise.all([
          loadCandidateProfile(state),
          checkDuplicateApplication(state)
        ]);

        if (profileResult.error || !profileResult.data) {
          console.error("Candidate profile lookup failed", safeError(profileResult.error));
          renderFatal(state, "Your profile could not be loaded.", "Please update your profile and try again.");
          return;
        }

        state.candidateProfile = profileResult.data;
        state.existingApplication = applicationResult.data || null;

        if (applicationResult.error) {
          console.error("Application duplicate lookup failed", safeError(applicationResult.error));
        }

        renderCurrentState(state);
      },
      showSuccess(application = {}) {
        state.existingApplication = application;
        clearDraft(state.job?.id);
        renderSuccess(state, application);
      }
    };
  }

  async function loadCandidateProfile(state) {
    return state.supabase
      .from("candidate_profiles")
      .select("*")
      .eq("id", state.user.id)
      .maybeSingle();
  }

  async function checkDuplicateApplication(state) {
    return state.supabase
      .from("applications")
      .select("id, status, candidate_status, employer_status, withdrawn_at, created_at")
      .eq("candidate_id", state.user.id)
      .eq("job_id", state.job.id)
      .maybeSingle();
  }

  function renderCurrentState(state) {
    const status = normalizeApplicationStatus(state.existingApplication?.status);

    if (state.existingApplication && status !== "withdrawn") {
      renderDuplicate(state);
      return;
    }

    renderApplicationForm(state);
  }

  function renderLoading(state) {
    state.container.className = "";
    state.container.innerHTML = `
      <div class="application-panel-state">
        <div class="empty-state">
          <strong>Loading application</strong>
          <p>Preparing your profile snapshot and checking your application status.</p>
        </div>
      </div>
    `;
  }

  function renderFatal(state, title, message) {
    state.container.className = "";
    state.container.innerHTML = `
      <div class="application-panel-state">
        <button type="button" class="secondary-btn application-back-btn" data-application-back>Return to Find Jobs</button>
        <div class="empty-state">
          <strong>${escapeHTML(title)}</strong>
          <p>${escapeHTML(message)}</p>
        </div>
      </div>
    `;
    bindBack(state);
  }

  function renderDuplicate(state) {
    const app = state.existingApplication || {};
    state.container.className = "";
    state.container.innerHTML = `
      <div class="application-panel-state">
        ${renderApplicationHeader(state, "Application already submitted", "You have already applied to this job.")}
        <div class="application-success-card">
          <span class="applied-tag">Applied</span>
          <h3>Application already submitted</h3>
          <p>You submitted this application ${escapeHTML(formatDate(app.created_at))}. Current status: ${escapeHTML(formatStatusLabel(app.status))}.</p>
          <div class="application-actions-row">
            <a class="primary-btn" href="${escapeAttribute(state.paths.applications)}">View Application</a>
            <button type="button" class="secondary-btn" data-application-back>Return to Find Jobs</button>
          </div>
        </div>
      </div>
    `;
    bindBack(state);
  }

  function renderSuccess(state, application = {}) {
    state.container.className = "";
    state.container.innerHTML = `
      <div class="application-panel-state">
        ${renderApplicationHeader(state, "Application submitted", `Your application was sent to ${state.job.company_name || "the employer"}.`)}
        <div class="application-success-card">
          <span class="applied-tag">Applied</span>
          <h3>Application submitted</h3>
          <p>Your application was sent to ${escapeHTML(state.job.company_name || "the employer")}.</p>
          <div class="application-facts compact">
            ${renderFact("Job", state.job.job_title || "Untitled Job")}
            ${renderFact("Company", state.job.company_name || "Employer")}
            ${renderFact("Submitted", formatDate(application.created_at || new Date().toISOString()))}
            ${renderFact("Status", "Applied")}
          </div>
          <div class="application-actions-row">
            <a class="primary-btn" href="${escapeAttribute(state.paths.applications)}">View Application</a>
            <button type="button" class="secondary-btn" data-application-back>Return to Find Jobs</button>
          </div>
        </div>
      </div>
    `;

    bindBack(state);
    state.container.querySelector("[data-find-more-jobs]")?.addEventListener("click", () => {
      state.onBack({ findMore: true });
    });
  }

  function renderApplicationForm(state) {
    const draft = getDraft(state.job.id);
    state.container.className = "";
    state.container.innerHTML = `
      <div class="application-panel-state">
        ${renderApplicationHeader(state, `Apply for ${state.job.job_title || "this job"}`, `Review the information that will be sent to ${state.job.company_name || "the employer"} and complete your application.`)}
        ${renderSelectedJobSummary(state)}
        ${state.existingApplication && normalizeApplicationStatus(state.existingApplication.status) === "withdrawn" ? renderWithdrawnNotice() : ""}
        <section class="application-summary-card">
          <div class="application-section-heading">
            <div>
              <span class="eyebrow">Candidate Snapshot</span>
              <h3>Your profile details</h3>
            </div>
            <a class="secondary-btn small-btn" href="${escapeAttribute(getProfileEditUrl(state))}">Edit Profile</a>
          </div>
          ${renderCandidateSummary(state)}
        </section>

        <form class="inline-application-form" data-application-form>
          <label for="inlineCoverLetter">Message to employer</label>
          <textarea id="inlineCoverLetter" data-field="coverLetter" rows="6" maxlength="2000" placeholder="Introduce yourself, mention relevant experience, and explain why this role is a good fit.">${escapeHTML(draft.coverLetter || "")}</textarea>

          <label for="inlineAdditionalNotes">Additional notes</label>
          <textarea id="inlineAdditionalNotes" data-field="additionalNotes" rows="4" maxlength="1200" placeholder="Availability notes, schedule constraints, transportation, certifications in progress, or anything else relevant.">${escapeHTML(draft.additionalNotes || "")}</textarea>

          <label class="confirm-row inline-confirm-row">
            <input id="inlineConfirmInfo" data-field="confirmInfo" type="checkbox" ${draft.confirmInfo ? "checked" : ""} />
            <span>I confirm my profile, contact information, and resume details are ready to send.</span>
          </label>

          <div class="form-message" data-application-message role="status" aria-live="polite"></div>

          <div class="application-actions-row sticky-actions">
            <button type="button" class="secondary-btn" data-application-back>Cancel</button>
            <button type="submit" class="primary-btn" data-submit-application>Submit Application</button>
          </div>
        </form>
      </div>
    `;

    bindBack(state);
    bindApplicationForm(state);
  }

  function renderApplicationHeader(state, title, helper) {
    const job = state.job;
    const logo = resolveEmployerLogo(job);
    const initials = getInitials(job.company_name || "Employer");

    return `
      <div class="application-job-header">
        <div class="application-page-heading">
          <div>
            <span class="eyebrow">Application</span>
            <h2>${escapeHTML(title)}</h2>
            <p>${escapeHTML(helper)}</p>
          </div>
          <button type="button" class="secondary-btn application-back-btn" data-application-back>Back to Jobs</button>
        </div>
      </div>
    `;
  }

  function renderSelectedJobSummary(state) {
    const job = state.job;
    const logo = resolveEmployerLogo(job);
    const initials = getInitials(job.company_name || "Employer");

    return `
      <section class="application-summary-card selected-job-summary-card">
        <div class="application-job-title-row">
          <span class="company-avatar large">
            ${logo ? `<img src="${escapeAttribute(logo)}" alt="" loading="lazy" onerror="this.parentElement.textContent='${escapeAttribute(initials)}'">` : escapeHTML(initials)}
          </span>
          <div>
            <span class="eyebrow">Selected Job</span>
            <h3>${escapeHTML(job.job_title || "Untitled Job")}</h3>
            <p>${escapeHTML(job.company_name || "Employer")} - ${escapeHTML(job.location || "Location not listed")}</p>
            <div class="application-facts compact">
              ${renderFact("Compensation", window.PlacelyAuth.formatCompensationFromRecord(job))}
              ${renderFact("Employment type", job.employment_type || "Not listed")}
              ${renderFact("Experience", job.experience_level || "Not listed")}
              ${renderFact("Status", isAcceptingApplications(job) ? "Open" : "Unavailable")}
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderCandidateSummary(state) {
    const profile = state.candidateProfile || {};
    const contact = window.PlacelyAuth.getVisibleCandidateContact(profile);
    const name = profile.full_name || "Candidate";
    const photoUrl = resolveCandidatePhotoUrl(state, profile);
    const tags = getTags(profile);
    const resumePath = getResumePath(profile);

    return `
      <div class="inline-candidate-summary">
        <div class="candidate-photo compact">
          ${photoUrl ? `<img src="${escapeAttribute(photoUrl)}" alt="${escapeAttribute(name)}" onerror="this.parentElement.textContent='${escapeAttribute(getInitials(name))}'">` : escapeHTML(getInitials(name))}
        </div>
        <div>
          <h4>${escapeHTML(name)}</h4>
          <p>${escapeHTML(profile.trade || "Trade not listed")} - ${escapeHTML(profile.location || "Location not listed")}</p>
          <div class="application-facts">
            ${renderFact("Email", contact.showEmail ? profile.email || state.user.email || "Not listed" : "Hidden")}
            ${renderFact("Phone", contact.showPhone ? profile.phone || "Not listed" : "Hidden")}
            ${renderFact("Experience", profile.experience || "Not listed")}
            ${renderFact("Availability", profile.availability || "Not listed")}
            ${renderFact("Resume", resumePath ? "Attached" : "No resume uploaded")}
            ${renderFact("Contact", formatContactPreference(profile))}
          </div>
          <div class="tag-row compact">
            ${tags.length ? tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("") : "<span>No skills or certifications added</span>"}
          </div>
        </div>
      </div>
    `;
  }

  function renderWithdrawnNotice() {
    return `
      <div class="application-inline-notice">
        <strong>You previously withdrew from this job.</strong>
        <p>Submitting again will reopen your application and make it visible to the employer.</p>
      </div>
    `;
  }

  function bindBack(state) {
    state.container.querySelectorAll("[data-application-back]").forEach((button) => {
      button.addEventListener("click", () => {
        if (state.hasUnsavedText && !window.confirm("Discard this application draft and return to Find Jobs?")) {
          return;
        }
        state.hasUnsavedText = false;
        state.onBack({ jobId: state.job?.id });
      });
    });
  }

  function bindApplicationForm(state) {
    const form = state.container.querySelector("[data-application-form]");
    if (!form) return;

    form.addEventListener("input", () => saveDraftFromForm(state, form));
    form.addEventListener("change", () => saveDraftFromForm(state, form));
    form.addEventListener("submit", (event) => submitApplication(event, state, form));
  }

  async function submitApplication(event, state, form) {
    event.preventDefault();
    setMessage(form, "");

    if (state.isSubmitting) return;

    const submitButton = form.querySelector("[data-submit-application]");
    const confirm = form.querySelector("[data-field='confirmInfo']");

    if (!state.job || !state.candidateProfile || !state.user) {
      setMessage(form, "Your session has expired. Please log in again.");
      return;
    }

    if (!isAcceptingApplications(state.job)) {
      setMessage(form, "This job is no longer accepting applications.");
      return;
    }

    if (!confirm?.checked) {
      setMessage(form, "Please confirm your profile and resume details before submitting.");
      return;
    }

    state.isSubmitting = true;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Submitting...";
    }

    const duplicateResult = await checkDuplicateApplication(state);
    if (duplicateResult.error) {
      console.error("Application duplicate lookup failed", safeError(duplicateResult.error));
    }

    if (duplicateResult.data && normalizeApplicationStatus(duplicateResult.data.status) !== "withdrawn") {
      state.existingApplication = duplicateResult.data;
      state.isSubmitting = false;
      renderDuplicate(state);
      return;
    }

    const availabilityResult = await checkJobAvailability(state);
    if (availabilityResult.error || !availabilityResult.data || !isAcceptingApplications(availabilityResult.data)) {
      if (availabilityResult.error) console.error("Application job availability lookup failed", safeError(availabilityResult.error));
      state.isSubmitting = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Submit Application";
      }
      setMessage(form, "This job is no longer accepting applications.");
      return;
    }

    state.job = {
      ...state.job,
      status: availabilityResult.data.status,
      employer_id: availabilityResult.data.employer_id || state.job.employer_id
    };

    state.existingApplication = duplicateResult.data || state.existingApplication;
    const values = getFormValues(form);

    if (state.existingApplication && normalizeApplicationStatus(state.existingApplication.status) === "withdrawn") {
      const reapplyResult = await reapplyToJob(state, values);
      finishSubmission(state, form, submitButton, reapplyResult);
      return;
    }

    const payload = buildApplicationPayload(state, values);
    const insertResult = await insertApplicationWithSchemaFallback(state, payload);
    finishSubmission(state, form, submitButton, insertResult);
  }

  async function checkJobAvailability(state) {
    return state.supabase
      .from("jobs")
      .select("id, employer_id, status")
      .eq("id", state.job.id)
      .maybeSingle();
  }

  function finishSubmission(state, form, submitButton, result) {
    state.isSubmitting = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Submit Application";
    }

    if (result.error) {
      console.error("Application submission failed", safeError(result.error));

      if (result.error.code === "23505") {
        setMessage(form, "You have already applied to this job.");
      } else {
        setMessage(form, "We could not submit your application. Please try again.");
      }
      return;
    }

    const application = result.data || {
      id: state.existingApplication?.id || "",
      status: "submitted",
      created_at: new Date().toISOString()
    };

    state.hasUnsavedText = false;
    state.onSubmitted({ jobId: state.job.id, application });
    renderSuccess(state, application);
  }

  function getFormValues(form) {
    return {
      coverLetter: form.querySelector("[data-field='coverLetter']")?.value?.trim() || "",
      additionalNotes: form.querySelector("[data-field='additionalNotes']")?.value?.trim() || "",
      confirmInfo: Boolean(form.querySelector("[data-field='confirmInfo']")?.checked)
    };
  }

  function saveDraftFromForm(state, form) {
    if (!state.job?.id) return;
    const values = getFormValues(form);
    state.hasUnsavedText = Boolean(values.coverLetter || values.additionalNotes);
    draftByJobId.set(String(state.job.id), values);
  }

  function getDraft(jobId) {
    return draftByJobId.get(String(jobId || "")) || {};
  }

  function clearDraft(jobId) {
    draftByJobId.delete(String(jobId || ""));
  }

  async function reapplyToJob(state, values) {
    const now = new Date().toISOString();
    const payload = {
      status: "submitted",
      candidate_status: "submitted",
      cover_letter: values.coverLetter,
      additional_notes: values.additionalNotes,
      withdrawn_at: null,
      reapplied_at: now,
      updated_at: now
    };

    return updateApplicationWithSchemaFallback(state, state.existingApplication.id, payload);
  }

  function buildApplicationPayload(state, values) {
    const now = new Date().toISOString();
    const snapshot = buildCandidateSnapshot(state);

    return {
      candidate_id: state.user.id,
      employer_id: state.job.employer_id,
      job_id: state.job.id,
      job_title: state.job.job_title || "Untitled Job",
      company_name: state.job.company_name || "Employer",
      location: state.job.location || "",
      employment_type: state.job.employment_type || "",
      pay_range: window.PlacelyAuth.formatCompensationFromRecord(state.job, "") || state.job.pay_range || "",
      status: "submitted",
      cover_letter: values.coverLetter,
      additional_notes: values.additionalNotes,
      candidate_snapshot: snapshot,
      candidate_name: snapshot.full_name,
      candidate_email: snapshot.email || null,
      candidate_phone: snapshot.phone || null,
      candidate_role: snapshot.trade,
      resume_path: snapshot.resume_path,
      resume_url: null,
      created_at: now,
      updated_at: now
    };
  }

  async function insertApplicationWithSchemaFallback(state, payload) {
    let safePayload = { ...payload };
    const removedColumns = [];

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { data, error } = await state.supabase
        .from("applications")
        .insert(safePayload)
        .select("id, status, created_at")
        .single();

      if (!error) {
        if (removedColumns.length) schemaFallbackColumns.applicationInsert = removedColumns;
        return { data, error: null };
      }

      const missingColumn = getMissingColumnName(error);
      if (!missingColumn || !(missingColumn in safePayload)) return { data: null, error };

      removedColumns.push(missingColumn);
      delete safePayload[missingColumn];
    }

    return {
      data: null,
      error: {
        message: "Application insert failed after removing missing columns.",
        details: removedColumns.join(", "),
        hint: "Run the Supabase applications hiring flow SQL file so the full application payload can be stored.",
        code: "SCHEMA_FALLBACK_LIMIT"
      }
    };
  }

  async function updateApplicationWithSchemaFallback(state, applicationId, payload) {
    let safePayload = { ...payload };
    const removedColumns = [];

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { data, error } = await state.supabase
        .from("applications")
        .update(safePayload)
        .eq("id", applicationId)
        .eq("candidate_id", state.user.id)
        .select("id, status, created_at")
        .single();

      if (!error) {
        if (removedColumns.length) schemaFallbackColumns.applicationUpdate = removedColumns;
        return { data, error: null };
      }

      const missingColumn = getMissingColumnName(error);
      if (!missingColumn || !(missingColumn in safePayload)) return { data: null, error };

      removedColumns.push(missingColumn);
      delete safePayload[missingColumn];
    }

    return {
      data: null,
      error: {
        message: "Application update failed after removing missing columns.",
        details: removedColumns.join(", "),
        hint: "Run the Supabase applications hiring flow SQL file so reapply columns can be stored.",
        code: "SCHEMA_FALLBACK_LIMIT"
      }
    };
  }

  function buildCandidateSnapshot(state) {
    const profile = state.candidateProfile || {};
    const contact = window.PlacelyAuth.getVisibleCandidateContact(profile);
    const shownContactMethod = window.PlacelyAuth.normalizeCandidateContactPreference(profile.shown_contact_method) || contact.preference;

    return {
      full_name: profile.full_name || "Candidate",
      email: contact.showEmail ? profile.email || state.user.email || "" : "",
      phone: contact.showPhone ? profile.phone || "" : "",
      shown_contact_method: shownContactMethod,
      contact_method: profile.contact_method || "",
      location: profile.location || "",
      trade: profile.trade || "",
      experience: profile.experience || "",
      availability: profile.availability || "",
      skills: profile.skills || "",
      certifications: profile.certifications || "",
      resume_path: getResumePath(profile),
      resume_url: "",
      profile_photo_url: profile.profile_photo_url || ""
    };
  }

  function normalizeRawJob(job, displayJob = null) {
    const raw = job?.raw || job || {};
    return {
      ...raw,
      id: raw.id || displayJob?.id || "",
      employer_id: raw.employer_id || displayJob?.employer_id || "",
      job_title: raw.job_title || raw.title || displayJob?.title || "Untitled Job",
      company_name: raw.company_name || raw.company || displayJob?.company || "Employer",
      location: raw.location || displayJob?.location || "",
      employment_type: raw.employment_type || raw.type || displayJob?.type || "",
      pay_range: raw.pay_range || displayJob?.pay || "",
      experience_level: raw.experience_level || displayJob?.experience || "",
      job_description: raw.job_description || displayJob?.description || "",
      required_skills: raw.required_skills || displayJob?.requirements || "",
      benefits: raw.benefits || displayJob?.benefits || "",
      status: raw.status || displayJob?.status || "active"
    };
  }

  function isAcceptingApplications(job) {
    if (!job?.id || !job?.employer_id) return false;
    const status = String(job.status || "").toLowerCase().trim();
    return status === "active";
  }

  function getMissingColumnName(error) {
    const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
    const match =
      text.match(/'([^']+)' column/i) ||
      text.match(/column "([^"]+)"/i) ||
      text.match(/Could not find the '([^']+)'/i);
    return match?.[1] || "";
  }

  function getResumePath(profile = {}) {
    return profile.resume_path || getResumePathFromLegacyUrl(profile.resume_url || "");
  }

  function getResumePathFromLegacyUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+/, "");

    try {
      const url = new URL(raw);
      const marker = "/candidate_resumes/";
      const markerIndex = url.pathname.indexOf(marker);
      if (markerIndex === -1) return "";
      return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    } catch {
      return "";
    }
  }

  function resolveCandidatePhotoUrl(state, profile) {
    const rawUrl = profile.profile_photo_url || profile.profile_photo || profile.avatar_url || profile.photo_url || "";
    if (!rawUrl) return "";
    if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
    return window.PlacelyAuth.getPublicImageUrl(state.supabase, "candidate-photos", rawUrl);
  }

  function resolveEmployerLogo(job) {
    return window.PlacelyAuth.resolveEmployerLogoUrl?.(job.company_logo_url || job.logo_path || "", {}) || "";
  }

  function getProfileEditUrl(state) {
    const target = new URL(state.paths.profile, window.location.href);
    target.hash = "profile";
    target.searchParams.set("return", "find-jobs-apply");
    if (state.job?.id) target.searchParams.set("job", state.job.id);
    return `${target.pathname}${target.search}${target.hash}`;
  }

  function getTags(profile) {
    const tags = [];
    if (profile.skills) tags.push(...String(profile.skills).split(","));
    if (profile.certifications) tags.push(...String(profile.certifications).split(","));
    return tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
  }

  function formatContactPreference(profile) {
    const preference = window.PlacelyAuth.normalizeCandidateContactPreference(profile.shown_contact_method || profile.contact_method);
    if (preference === "email") return "Email only";
    if (preference === "phone") return "Phone only";
    return "Email and phone";
  }

  function renderFact(label, value) {
    return `
      <div>
        <span>${escapeHTML(label)}</span>
        <strong>${escapeHTML(value || "Not listed")}</strong>
      </div>
    `;
  }

  function setMessage(form, message) {
    const target = form.querySelector("[data-application-message]");
    if (target) target.textContent = message || "";
  }

  function normalizeApplicationStatus(status) {
    const value = String(status || "submitted").toLowerCase().trim();
    if (["withdrawn", "withdraw"].includes(value)) return "withdrawn";
    if (["new"].includes(value)) return "new";
    if (["applied", "submitted"].includes(value)) return "submitted";
    if (["review", "reviewing", "viewed", "in review"].includes(value)) return "reviewing";
    if (["interview", "interviewing", "interview requested"].includes(value)) return "interview";
    if (["offer", "offered"].includes(value)) return "offer";
    if (["hired"].includes(value)) return "hired";
    if (["rejected", "declined"].includes(value)) return "rejected";
    return "submitted";
  }

  function formatStatusLabel(status) {
    const normalized = normalizeApplicationStatus(status);
    const labels = {
      new: "New",
      submitted: "Applied",
      reviewing: "Reviewing",
      interview: "Interview",
      offer: "Offer",
      hired: "Hired",
      rejected: "Not selected",
      withdrawn: "Withdrawn"
    };
    return labels[normalized] || "Applied";
  }

  function formatDate(value) {
    if (!value) return "recently";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "recently";
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
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

  function safeError(error) {
    return {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint
    };
  }

  function redirectLegacyApplyPage(options = {}) {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get("job_id") || params.get("job") || params.get("id");
    const target = new URL(options.findJobsPath || "../public/find-jobs.html", window.location.href);
    target.searchParams.set("role", "candidate");
    if (jobId) {
      target.searchParams.set("job", jobId);
      target.searchParams.set("view", "apply");
    }

    const relativeTarget = `${target.pathname}${target.search}${target.hash}`;
    const continueLink = document.getElementById("continueLink");
    if (continueLink) continueLink.href = relativeTarget;
    window.location.replace(relativeTarget);
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

  window.PlacelyCandidateApplications = {
    createFindJobsApplicationFlow,
    redirectLegacyApplyPage
  };
})();
