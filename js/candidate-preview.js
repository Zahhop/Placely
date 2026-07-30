(function () {
  const fallbackProfile = {
    full_name: "Candidate Name",
    trade: "Trade / Job Title",
    location: "Location"
  };

  const icons = {
    location: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 1 7 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 0 1 7-7Zm0 9.5A2.5 2.5 0 1 0 12 6a2.5 2.5 0 0 0 0 5.5Z"/></svg>',
    experience: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6V5a3 3 0 0 1 3-3h1a3 3 0 0 1 3 3v1h3a2 2 0 0 1 2 2v10.5A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5V8a2 2 0 0 1 2-2h4Zm2 0h3V5a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1v1Zm9 5H4v7.5c0 .28.22.5.5.5h15c.28 0 .5-.22.5-.5V11Z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm1 5h-2v6l5 3 .95-1.76L13 11.9V7Z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c5.5 0 9 5.2 9 7s-3.5 7-9 7-9-5.2-9-7 3.5-7 9-7Zm0 2c-4 0-6.65 3.7-7 5 .35 1.3 3 5 7 5s6.65-3.7 7-5c-.35-1.3-3-5-7-5Zm0 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z"/></svg>',
    contact: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 3.2V18h16V7.2l-8 5.34L4 7.2Zm1.2-1.2L12 10.54 18.8 6H5.2Z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.6 15.6 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.3.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.27.2 2.46.57 3.58a1 1 0 0 1-.24 1.02L6.6 10.8Z"/></svg>',
    preferences: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h10v2H4V5Zm0 6h16v2H4v-2Zm0 6h12v2H4v-2Zm13-13a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg>',
    verification: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm0 2.15 6 2.25V11c0 3.9-2.45 7.6-6 8.9-3.55-1.3-6-5-6-8.9V6.4l6-2.25Zm3.7 5.7-4.35 4.35-2.05-2.05-1.4 1.42 3.45 3.43 5.75-5.75-1.4-1.4Z"/></svg>',
    resume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l5 5v15H6V2Zm8 2H8v16h10V8h-4V4Zm-3 8h4v2h-4v-2Zm0 4h4v2h-4v-2ZM9 8h2v2H9V8Z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2h1a2 2 0 0 1 2 2v8H4v-8a2 2 0 0 1 2-2h1Zm2 0h6V8a3 3 0 1 0-6 0v2Zm-3 2v6h12v-6H6Z"/></svg>',
    badge: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2h6v2h4v5h-2V6H7v3H5V4h4V2Zm-6 9h18v10H3V11Zm2 2v6h14v-6H5Z"/></svg>'
  };

  function renderCandidateProfile(profileInput = {}, options = {}) {
    const profile = { ...fallbackProfile, ...(profileInput || {}) };
    const viewer = options.viewer || "candidate-self";
    const showContactAccordingToVisibility = options.showContactAccordingToVisibility !== false;
    const showEmployerActions = options.showEmployerActions === true;
    const contact = showContactAccordingToVisibility
      ? getVisibleContact(profile)
      : { showEmail: true, showPhone: true, preference: profile.shown_contact_method || "both" };

    return `
      <div class="candidate-preview-profile" data-viewer="${escapeAttribute(viewer)}">
        ${renderProfileHero(profile)}
        <div class="candidate-preview-grid">
          <div class="candidate-preview-left">
            ${renderExperience(profile)}
            ${renderSkillsAndCertifications(profile)}
          </div>
          <div class="candidate-preview-right">
            ${renderContactInformation(profile, contact, { viewer })}
            ${renderWorkPreferences(profile)}
            ${renderVerification(profile, { viewer })}
        ${renderResumeStatus(profile, { viewer })}
          </div>
        </div>
        ${renderPrivateNotice({ viewer })}
        ${showEmployerActions ? renderEmployerActions() : ""}
      </div>
    `;
  }

  function renderProfileHero(profile) {
    const name = profile.full_name || "Candidate Name";
    const role = profile.trade || "Trade or role not listed";
    const location = profile.location || "Location not listed";
    const visibility = profile.profile_visible === false ? "Hidden from employers" : "Visible to employers";

    return `
      <section class="candidate-preview-hero">
        <div class="candidate-preview-photo-wrap">
          ${renderAvatar(profile, "candidate-preview-photo")}
        </div>
        <div class="candidate-preview-identity">
          <div class="candidate-preview-name-row">
            <h2>${escapeHTML(name)}</h2>
            ${renderAvailabilityBadge(profile)}
            ${renderVerificationBadgeInline(profile)}
          </div>
          <h3>${escapeHTML(role)}</h3>
          <p class="candidate-preview-location">${icons.location}${escapeHTML(location)}</p>
          <div class="candidate-preview-facts">
            ${renderHeroFact(icons.experience, profile.experience || "Not listed", "Experience")}
            ${renderHeroFact(icons.clock, profile.availability || "Not listed", "Availability")}
            ${renderHeroFact(icons.eye, visibility, "Profile visibility")}
          </div>
        </div>
        <aside class="candidate-preview-about">
          <h3>About Me</h3>
          <p>${escapeHTML(profile.bio || "No profile summary added yet.")}</p>
        </aside>
      </section>
    `;
  }

  function renderHeroFact(icon, value, label) {
    return `
      <div class="candidate-preview-fact">
        <span class="candidate-preview-fact-icon">${icon}</span>
        <div>
          <strong>${escapeHTML(value)}</strong>
          <span>${escapeHTML(label)}</span>
        </div>
      </div>
    `;
  }

  function renderAvailabilityBadge(profile) {
    const label = getAvailabilityBadge(profile.availability);
    if (!label) return "";
    return `<span class="candidate-preview-badge availability">${escapeHTML(label)}</span>`;
  }

  function renderVerificationBadgeInline(profile) {
    const status = normalizeVerificationStatus(profile.verification_status);
    if (status === "verified") return window.PlacelyVerifiedBadge?.render(profile) || "";
    if (status === "pending") return '<span class="candidate-preview-badge pending">Verification pending</span>';
    return "";
  }

  function renderExperience(profile) {
    const entries = getWorkHistory(profile);
    const empty = `
      ${profile.experience ? `<p class="candidate-preview-section-copy">${escapeHTML(profile.experience)}</p>` : ""}
      <p class="candidate-preview-empty">No detailed work experience has been added yet.</p>
    `;

    return renderPreviewCard("Experience", icons.experience, entries.length ? `
      <div class="candidate-preview-timeline">
        ${entries.map(renderExperienceEntry).join("")}
      </div>
    ` : empty, "experience-card");
  }

  function renderExperienceEntry(entry) {
    const title = entry.position || entry.title || entry.role || "Role";
    const company = entry.employer || entry.company || entry.organization || "";
    const location = entry.location || "";
    const meta = [formatDateRange(entry), entry.employment_type || entry.type || ""].filter(Boolean).join(" · ");
    const description = entry.description || entry.summary || entry.details || "";

    return `
      <article class="candidate-preview-timeline-item">
        <span class="timeline-dot" aria-hidden="true"></span>
        <div>
          <h3>${escapeHTML(title)}</h3>
          <p class="timeline-company">${escapeHTML([company, location].filter(Boolean).join(", ") || "Employer not listed")}</p>
          <p class="timeline-meta">${escapeHTML(meta || "Dates not listed")}</p>
          ${description ? `<p class="timeline-description">${escapeHTML(description)}</p>` : ""}
        </div>
      </article>
    `;
  }

  function renderSkillsAndCertifications(profile) {
    const skills = getSplitValues(profile.skills);
    const certifications = getSplitValues(profile.certifications);

    return renderPreviewCard("Skills & Certifications", icons.badge, `
      <div class="candidate-preview-chip-group">
        <h3>Skills</h3>
        ${renderChips(skills, "No skills added yet.")}
      </div>
      <div class="candidate-preview-chip-group">
        <h3>Certifications</h3>
        ${renderChips(certifications, "No certifications added yet.")}
      </div>
    `, "skills-card");
  }

  function renderContactInformation(profile, contact, options = {}) {
    const isEmployer = options.viewer === "employer";
    const rows = [];
    if (contact.showEmail) rows.push(renderInfoRow(icons.contact, "Email", profile.email || (isEmployer ? "Hidden by candidate" : "Not provided")));
    if (contact.showPhone) rows.push(renderInfoRow(icons.phone, "Phone", profile.phone || (isEmployer ? "Hidden by candidate" : "Not provided")));
    if (isEmployer && !contact.showEmail) rows.push(renderInfoRow(icons.contact, "Email", "Hidden by candidate"));
    if (isEmployer && !contact.showPhone) rows.push(renderInfoRow(icons.phone, "Phone", "Hidden by candidate"));
    rows.push(renderInfoRow(icons.clock, "Preferred Contact", profile.contact_method || formatContactPreference(contact.preference) || "Not listed"));

    if (!contact.showEmail && !contact.showPhone) {
      rows.unshift(renderInfoRow(icons.contact, "Contact", isEmployer ? "Contact this candidate through Placely Messaging." : "Contact through Placely messaging"));
    }

    return renderPreviewCard("Contact Information", icons.contact, rows.join(""));
  }

  function renderWorkPreferences(profile) {
    const rows = [
      renderInfoRow(icons.preferences, "Target Role", profile.trade || "Not listed"),
      renderInfoRow(icons.clock, "Availability", profile.availability || "Not listed"),
      renderInfoRow(icons.location, "Willing to Travel", profile.willing_to_travel || "Not listed"),
      renderInfoRow(icons.preferences, "Employment Type", profile.employment_type || "Not listed")
    ];

    if (hasOwnValue(profile, "work_preferences")) rows.push(renderInfoRow(icons.preferences, "Work Preferences", profile.work_preferences || "Not listed"));
    if (hasOwnValue(profile, "willing_to_relocate")) rows.push(renderInfoRow(icons.location, "Willing to Relocate", profile.willing_to_relocate || "Not listed"));

    return renderPreviewCard("Work Preferences", icons.preferences, rows.join(""));
  }

  function renderVerification(profile, options = {}) {
    const isEmployer = options.viewer === "employer";
    const status = normalizeVerificationStatus(profile.verification_status);
    let statusMarkup = "";
    let text = "";

    if (status === "verified") {
      statusMarkup = window.PlacelyVerifiedBadge?.render(profile) || '<span class="candidate-preview-status verified">Verified by Placely</span>';
      text = isEmployer
        ? `This candidate has been verified by the Placely team.${profile.verified_at ? `<br>Verified on ${escapeHTML(formatDate(profile.verified_at))}` : ""}`
        : `Your profile has been verified by the Placely team.${profile.verified_at ? `<br>Verified on ${escapeHTML(formatDate(profile.verified_at))}` : ""}`;
    } else if (status === "pending") {
      statusMarkup = '<span class="candidate-preview-status pending">Verification pending</span>';
      text = isEmployer
        ? "This candidate has submitted a verification request and it is currently under review by Placely."
        : "Your verification request is currently under review.";
    } else if (status === "rejected") {
      statusMarkup = '<span class="candidate-preview-status neutral">Verification not approved</span>';
      text = isEmployer
        ? "This candidate is not currently verified by Placely."
        : "Your verification request was not approved.";
    } else {
      statusMarkup = '<span class="candidate-preview-status neutral">Not verified</span>';
      text = "This profile has not yet been verified by Placely.";
    }

    return renderPreviewCard("Verification", icons.verification, `
      <div class="candidate-preview-status-row">${statusMarkup}</div>
      <p class="candidate-preview-section-copy">${text}</p>
    `);
  }

  function renderResumeStatus(profile, options = {}) {
    const isEmployer = options.viewer === "employer";
    const hasResume = Boolean(getResumePath(profile));
    const request = normalizeResumeRequest(profile.resume_request);
    const heading = getResumeHeading({ hasResume, request, isEmployer });
    const text = getResumeText({ hasResume, request, isEmployer });
    const actions = isEmployer ? renderEmployerResumeActions({ hasResume, request }) : "";

    return renderPreviewCard("Resume", icons.resume, `
      <div class="candidate-preview-resume">
        <div>
          <strong>${escapeHTML(heading)}</strong>
          <p>${escapeHTML(text)}</p>
          ${actions}
        </div>
        <div class="candidate-preview-document-icon">${icons.resume}</div>
      </div>
    `, "resume-card");
  }

  function renderPrivateNotice(options = {}) {
    const isEmployer = options.viewer === "employer";
    return `
      <section class="candidate-preview-secure">
        <span>${icons.lock}</span>
        <div>
          <strong>Private & Secure</strong>
          <p>${escapeHTML(isEmployer
            ? "Contact information and documents are displayed according to this candidate's privacy settings."
            : "Only employers with Candidate Access can view your profile. Your personal information is protected and only shown according to your visibility settings.")}</p>
        </div>
      </section>
    `;
  }

  function getResumeHeading({ hasResume, request, isEmployer }) {
    if (!isEmployer) return hasResume ? "Resume available by request" : "No resume uploaded";
    if (!hasResume) return "No resume uploaded";
    if (request.status === "approved") return "Resume Approved";
    if (request.status === "pending") return "Request Sent";
    if (request.status === "revoked") return "Resume Access Revoked";
    if (request.status === "expired") return "Resume Access Expired";
    return "Resume Available";
  }

  function getResumeText({ hasResume, request, isEmployer }) {
    if (!isEmployer) {
      return hasResume
        ? "Employers will need to request access to your resume."
        : "Upload a resume from your Profile to make it available for future requests.";
    }
    if (!hasResume) return "This candidate has not uploaded a resume.";
    if (request.status === "approved") return "This candidate approved resume access. Use the secure link below to review it.";
    if (request.status === "pending") return "This candidate has been notified. You can view the resume if they approve your request.";
    if (request.status === "declined") return "This candidate declined the resume request.";
    if (request.status === "revoked") return "This candidate revoked resume access.";
    if (request.status === "expired") return "Resume access expired. Request access again if needed.";
    return "Request access to review this candidate's resume. The candidate will be notified and can approve or decline your request.";
  }

  function renderEmployerResumeActions({ hasResume, request }) {
    if (!hasResume) return "";
    if (request.status === "approved") {
      return `
        <div class="candidate-preview-resume-actions">
          <button type="button" class="secondary-btn compact" data-resume-action="view">View Resume</button>
          <button type="button" class="secondary-btn compact" data-resume-action="download">Download Resume</button>
        </div>
      `;
    }
    if (request.status === "pending") {
      return `
        <div class="candidate-preview-resume-actions">
          <button type="button" class="secondary-btn compact" disabled>Request Sent</button>
        </div>
      `;
    }
    return `
      <div class="candidate-preview-resume-actions">
        <button type="button" class="secondary-btn compact" data-resume-action="request">Request Resume</button>
      </div>
    `;
  }

  function normalizeResumeRequest(value) {
    const request = value && typeof value === "object" ? value : {};
    let status = String(request.status || "").toLowerCase().trim();
    if (status === "approved") {
      if (request.revoked_at) status = "revoked";
      if (request.expires_at && new Date(request.expires_at).getTime() <= Date.now()) status = "expired";
    }
    return {
      ...request,
      status: ["pending", "approved", "declined", "revoked", "expired"].includes(status) ? status : ""
    };
  }

  function renderPreviewCard(title, icon, content, extraClass = "") {
    return `
      <section class="candidate-preview-card ${escapeAttribute(extraClass)}">
        <div class="candidate-preview-card-heading">
          <span class="candidate-preview-card-icon">${icon}</span>
          <h2>${escapeHTML(title)}</h2>
        </div>
        ${content}
      </section>
    `;
  }

  function renderInfoRow(icon, label, value) {
    return `
      <div class="candidate-preview-info-row">
        <span class="candidate-preview-row-icon">${icon}</span>
        <span>${escapeHTML(label)}</span>
        <strong>${escapeHTML(value || "Not listed")}</strong>
      </div>
    `;
  }

  function renderChips(values, emptyText) {
    if (!values.length) return `<p class="candidate-preview-empty">${escapeHTML(emptyText)}</p>`;
    return `<div class="candidate-preview-chip-row">${values.map((value) => `<span>${escapeHTML(value)}</span>`).join("")}</div>`;
  }

  function renderAvatar(profile, className = "candidate-preview-photo") {
    const name = profile?.full_name || fallbackProfile.full_name;
    const photoUrl = getProfilePhoto(profile);
    const initials = getInitials(name);

    if (photoUrl) {
      return `
        <div class="${escapeAttribute(className)} has-image">
          <img src="${escapeAttribute(photoUrl)}" alt="${escapeAttribute(name)} profile photo" loading="lazy" onerror="this.parentElement.classList.remove('has-image'); this.remove();" />
          <span>${escapeHTML(initials)}</span>
        </div>
      `;
    }

    return `<div class="${escapeAttribute(className)} initials" aria-hidden="true"><span>${escapeHTML(initials)}</span></div>`;
  }

  function renderEmployerActions() {
    return "";
  }

  function getAvailabilityBadge(availability) {
    const value = String(availability || "").toLowerCase();
    if (!value) return "";
    if (value.includes("immediate") || value.includes("available")) return "Available";
    if (value.includes("employed")) return "Currently employed";
    return "Available soon";
  }

  function getInitials(name) {
    return String(name || "PT")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "PT";
  }

  function getProfilePhoto(profile) {
    const value = profile?.profile_photo_url || profile?.avatar_url || "";
    if (!value) return "";
    if (/^blob:|^data:|^https?:\/\//i.test(value)) return value;

    return window.PlacelyAuth?.getPublicImageUrl?.(
      window.PlacelyAuth.client(),
      "candidate_photos",
      value
    ) || value;
  }

  function getCandidateTags(profile, limit = 5) {
    return [...getSplitValues(profile?.certifications), ...getSplitValues(profile?.skills)].slice(0, limit);
  }

  function getSplitValues(value) {
    if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
    return String(value || "")
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function getVisibleContact(profile) {
    return window.PlacelyAuth?.getVisibleCandidateContact?.(profile) || { showEmail: false, showPhone: false, preference: "" };
  }

  function formatContactPreference(value) {
    const normalized = String(value || "").toLowerCase();
    if (normalized === "both") return "Email and phone";
    if (normalized === "email") return "Email";
    if (normalized === "phone") return "Phone";
    return "";
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
      const marker = "/storage/v1/object/public/candidate_resumes/";
      const index = url.pathname.indexOf(marker);
      if (index >= 0) return decodeURIComponent(url.pathname.slice(index + marker.length));
    } catch {}

    return "";
  }

  function getWorkHistory(profile) {
    const values = [
      profile.work_history,
      profile.work_experience,
      profile.experience_entries,
      profile.employment_history
    ];

    for (const value of values) {
      const parsed = parseWorkHistory(value);
      if (parsed.length) return parsed;
    }

    return [];
  }

  function parseWorkHistory(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object");
    if (typeof value === "object") return Array.isArray(value.entries) ? value.entries : [];

    try {
      const parsed = JSON.parse(value);
      return parseWorkHistory(parsed);
    } catch {
      return [];
    }
  }

  function formatDateRange(entry) {
    return [entry.start_date || entry.startDate, entry.end_date || entry.endDate || (entry.current ? "Present" : "")]
      .filter(Boolean)
      .join(" - ") || "Dates not listed";
  }

  function hasOwnValue(profile, key) {
    return Object.prototype.hasOwnProperty.call(profile, key);
  }

  function normalizeVerificationStatus(status) {
    const value = String(status || "unverified").toLowerCase().trim();
    return ["pending", "verified", "rejected"].includes(value) ? value : "unverified";
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
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

  window.CandidateProfilePreview = {
    escapeHTML,
    getCandidateTags,
    getInitials,
    getProfilePhoto,
    renderAvatar,
    renderCandidateProfile
  };
})();
