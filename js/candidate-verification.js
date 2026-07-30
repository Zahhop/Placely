const verificationSupabase = window.PlacelyAuth.client();

let verificationUser = null;
let verificationProfile = {};

const VERIFICATION_STATES = {
  unverified: {
    title: "Get Verified",
    subtitle: "Complete a short Placely screening to strengthen your profile and build trust with employers.",
    badge: "PLACELY VERIFICATION",
    heading: "Stand out as a trusted candidate",
    description: "Placely verification gives employers more confidence that your identity, experience, and profile information have been reviewed by our team.",
    icon: shieldIcon(),
    tone: "unverified",
    detailsHeading: "Profile information for review"
  },
  pending: {
    title: "Verification in Progress",
    subtitle: "Your request has been received and is being reviewed by the Placely team.",
    badge: "VERIFICATION PENDING",
    heading: "Your verification is being reviewed",
    description: "We received your request. The Placely team will contact you using the information on your profile if anything else is needed.",
    icon: clockIcon(),
    tone: "pending",
    detailsHeading: "Profile information under review"
  },
  verified: {
    title: "You're Verified!",
    subtitle: "You've taken an important step to stand out and build trust with employers on Placely.",
    badge: "VERIFIED BY PLACELY",
    heading: "You're now a verified candidate",
    description: "Your Placely badge shows employers that your profile has been reviewed by our team and helps you stand out across the platform.",
    icon: shieldCheckIcon(),
    tone: "verified",
    detailsHeading: "Your verified profile at a glance"
  },
  rejected: {
    title: "Verification Update",
    subtitle: "Your recent verification request has been reviewed.",
    badge: "VERIFICATION NOT APPROVED",
    heading: "Your profile was not verified at this time",
    description: "This does not prevent you from using Placely. Review your profile information and follow any instructions sent by the Placely team before requesting another review.",
    icon: shieldAlertIcon(),
    tone: "rejected",
    detailsHeading: "Profile information"
  }
};

document.addEventListener("DOMContentLoaded", initCandidateVerification);

async function initCandidateVerification() {
  bindVerificationShell();

  try {
    verificationUser = await verifyCandidateAccess(verificationSupabase, {
      loginPath: "candidate-login.html",
      employerDashboardPath: "../employers/employer-dashboard.html"
    });
    if (!verificationUser) return;

    await loadVerificationProfile();
    renderVerificationPage();
  } catch (error) {
    console.error("Candidate verification page failed to load", error);
    renderVerificationError();
  } finally {
    document.documentElement.classList.remove("dashboard-booting");
  }
}

function bindVerificationShell() {
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await window.PlacelyAuth.clearAuthState();
    window.location.replace("candidate-login.html");
  });
  document.getElementById("accountMenuLogoutBtn")?.addEventListener("click", async () => {
    await window.PlacelyAuth.clearAuthState();
    window.location.replace("candidate-login.html");
  });
  bindAccountMenu();
  bindMobileSidebar();

  document.getElementById("verificationSearchForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = document.getElementById("verificationSearchInput")?.value?.trim();
    const url = new URL("../public/find-jobs.html?role=candidate", window.location.href);
    if (query) url.searchParams.set("keyword", query);
    window.location.href = url.toString();
  });
}

async function loadVerificationProfile() {
  const { data, error } = await verificationSupabase
    .from("candidate_profiles")
    .select("*")
    .eq("id", verificationUser.id)
    .maybeSingle();

  if (error || !data) throw error || new Error("Candidate profile not found");
  verificationProfile = { ...data, email: data.email || verificationUser.email || "" };
}

function renderVerificationPage() {
  const fullName = verificationProfile.full_name || "Candidate";
  const firstName = fullName.split(" ")[0] || "Candidate";
  const status = normalizeVerificationStatus(verificationProfile.verification_status);
  const state = VERIFICATION_STATES[status] || VERIFICATION_STATES.unverified;
  const card = document.getElementById("verificationCard");

  setText("topCandidateName", firstName);
  setText("topCandidateAvatar", getInitials(fullName || verificationProfile.email));
  setText("accountMenuCandidateName", fullName);
  setText("accountMenuEmail", verificationProfile.email || verificationUser?.email || "No email on file");
  setText("verificationTitle", state.title);
  setText("verificationSubtitle", state.subtitle);

  document.title = `${state.title} | Placely Talent`;
  window.PlacelyCandidateSidebar?.updateVerificationStatus(status);

  if (!card) return;

  card.innerHTML = `
    ${renderHeroState(status, state)}
    ${renderStateBody(status, state)}
  `;

  bindVerificationActions(status);
}

function renderHeroState(status, state) {
  return `
    <section class="verification-hero ${escapeAttribute(state.tone)}" aria-labelledby="verificationStateHeading">
      <div class="verification-hero-glow" aria-hidden="true"></div>
      <div class="verification-state-header">
        <div class="verification-state-icon ${escapeAttribute(state.tone)}" aria-hidden="true">${state.icon}</div>
        <span class="verification-state-badge ${escapeAttribute(state.tone)}">${escapeHTML(state.badge)}</span>
        <h2 id="verificationStateHeading">${escapeHTML(state.heading)}</h2>
        <p>${escapeHTML(state.description)}</p>
        ${renderHeroMeta(status)}
        ${renderHeroActions(status)}
      </div>
    </section>
  `;
}

function renderHeroMeta(status) {
  if (status === "verified" && verificationProfile.verified_at) {
    return `
      <div class="verification-meta-row">
        <span>${calendarIcon()} Verified on ${escapeHTML(formatDate(verificationProfile.verified_at))}</span>
      </div>
    `;
  }

  if (status === "pending") {
    const requestedAt = verificationProfile.verification_requested_at || verificationProfile.requested_at;
    return requestedAt
      ? `
        <div class="verification-meta-row">
          <span>${calendarIcon()} Requested on ${escapeHTML(formatDate(requestedAt))}</span>
        </div>
      `
      : "";
  }

  return "";
}

function renderHeroActions(status) {
  if (status === "unverified") {
    return `
      <div class="verification-actions hero-actions">
        <button type="button" class="primary-btn" data-verification-action="request">Request Verification</button>
        <a href="${escapeAttribute(routeFor("profile"))}" class="secondary-btn">Edit Profile</a>
      </div>
    `;
  }

  if (status === "pending") {
    return `
      <div class="verification-actions hero-actions">
        <a href="${escapeAttribute(routeFor("profile"))}" class="primary-btn">View Profile</a>
        <a href="${escapeAttribute(routeFor("jobs"))}" class="secondary-btn">Find Jobs</a>
      </div>
    `;
  }

  if (status === "verified") {
    return `
      <div class="verification-actions hero-actions">
        <a href="${escapeAttribute(routeFor("profile"))}" class="primary-btn">View Full Profile</a>
        <a href="${escapeAttribute(routeFor("jobs"))}" class="secondary-btn">Find Jobs</a>
      </div>
    `;
  }

  return `
    <div class="verification-actions hero-actions">
      <a href="${escapeAttribute(routeFor("profile"))}" class="primary-btn">Edit Profile</a>
      <a href="${escapeAttribute(routeFor("support"))}" class="secondary-btn">Contact Support</a>
    </div>
  `;
}

function renderStateBody(status, state) {
  const sections = {
    unverified: `
      ${renderCardSection("Why get verified?", benefitCards([
        ["Build employer trust", "Show employers that your profile has been reviewed by Placely.", checkIcon()],
        ["Stand out in search", "Your verified badge appears across your profile and candidate listings.", searchIcon()],
        ["Strengthen your applications", "Employers can review your profile with greater confidence.", documentIcon()],
        ["Show you are serious", "Verification signals that you are actively preparing for new opportunities.", sparkIcon()]
      ]))}
      ${renderCardSection("What to expect", stepCards([
        ["Submit your request", "Confirm the profile information Placely should review."],
        ["Complete a short screening", "Our team will contact you to arrange a brief conversation."],
        ["Receive your verification status", "Your profile will be updated after the review is complete."]
      ]))}
      ${renderCandidateSummary(state.detailsHeading)}
      ${renderRequestPanel("Request Verification")}
      ${renderCallout("Make sure your profile is ready", "Complete your work history, contact information, and availability before requesting verification.", "Review Profile", routeFor("profile"))}
    `,
    pending: `
      ${renderCardSection("What happens next", stepCards([
        ["Placely reviews your profile", "We confirm that your profile contains enough information for the screening."],
        ["We contact you", "The team may reach out to arrange a brief screening conversation."],
        ["Your status is updated", "Your candidate profile will reflect the final decision once the review is complete."]
      ]))}
      ${renderInfoStrip([
        "Keep your contact information current",
        "Watch your email for a message from Placely",
        "Continue applying while your request is reviewed"
      ])}
      ${renderCandidateSummary(state.detailsHeading)}
      ${renderCallout("Your request is already in progress", "No additional action is required unless Placely contacts you.", "", "")}
    `,
    verified: `
      ${renderCardSection("Why verification matters", benefitCards([
        ["Builds trust instantly", "Employers can see that your profile has been reviewed by Placely.", checkIcon()],
        ["Stand out from others", "Your verified badge appears across your profile and candidate listings.", badgeIcon()],
        ["Stronger first impression", "Verification helps employers review your experience with greater confidence.", documentIcon()],
        ["More serious opportunities", "A complete, verified profile can help you present yourself more professionally.", sparkIcon()]
      ]))}
      ${renderCallout("You've strengthened your Placely profile", "Keep your experience, availability, and contact information current so employers always see accurate information.", "Browse Jobs", routeFor("jobs"))}
    `,
    rejected: `
      ${renderCardSection("Recommended next steps", benefitCards([
        ["Review your profile", "Make sure your experience, contact details, and availability are accurate.", documentIcon()],
        ["Update missing information", "Add details that help Placely and employers understand your background.", checkIcon()],
        ["Check your email", "Look for any follow-up instructions sent by the Placely team.", mailIcon()],
        ["Request another review when eligible", "Submit another request after your profile information is ready.", shieldIcon()]
      ]))}
      ${renderCandidateSummary(state.detailsHeading)}
      ${renderRequestPanel("Request Another Review")}
      ${renderCallout("Need help with your verification?", "Placely support can help you understand what to update before another review.", "Contact Support", routeFor("support"))}
    `
  };

  return `<div class="verification-content">${sections[status] || sections.unverified}</div>`;
}

function renderCardSection(title, content) {
  return `
    <section class="verification-section" aria-labelledby="${escapeAttribute(slugify(title))}">
      <h3 class="verification-section-title" id="${escapeAttribute(slugify(title))}">${escapeHTML(title)}</h3>
      ${content}
    </section>
  `;
}

function benefitCards(items) {
  return `
    <div class="verification-benefit-grid">
      ${items.map(([title, text, icon]) => `
        <article class="verification-info-card">
          <span class="verification-card-icon" aria-hidden="true">${icon}</span>
          <h4>${escapeHTML(title)}</h4>
          <p>${escapeHTML(text)}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function stepCards(items) {
  return `
    <div class="verification-step-grid">
      ${items.map(([title, text], index) => `
        <article class="verification-step-card">
          <span class="verification-step-number" aria-hidden="true">${index + 1}</span>
          <div>
            <h4>${escapeHTML(title)}</h4>
            <p>${escapeHTML(text)}</p>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderInfoStrip(items) {
  return `
    <section class="verification-info-strip" aria-label="Helpful reminders">
      ${items.map((item) => `
        <span>${checkIcon()} ${escapeHTML(item)}</span>
      `).join("")}
    </section>
  `;
}

function renderCandidateSummary(title) {
  const details = [
    ["Name", verificationProfile.full_name || "Candidate", userIcon()],
    ["Account email", verificationProfile.email || verificationUser?.email || "Not provided", mailIcon()],
    ["Phone", verificationProfile.phone || "Not provided", phoneIcon()],
    ["Target role", verificationProfile.trade || "Not listed", documentIcon()],
    ["Location", verificationProfile.location || "Not listed", locationIcon()],
    ["Availability", verificationProfile.availability || "Not listed", calendarIcon()]
  ];

  return `
    <section class="verification-summary-card" aria-labelledby="verificationDetailsTitle">
      <div class="verification-summary-heading">
        <span class="verification-card-icon small" aria-hidden="true">${userIcon()}</span>
        <h3 id="verificationDetailsTitle">${escapeHTML(title)}</h3>
      </div>
      <dl class="verification-details-grid">
        ${details.map(([label, value, iconMarkup]) => `
          <div class="verification-detail-item">
            <span class="verification-detail-icon" aria-hidden="true">${iconMarkup}</span>
            <dt>${escapeHTML(label)}</dt>
            <dd>${escapeHTML(value)}</dd>
          </div>
        `).join("")}
      </dl>
    </section>
  `;
}

function renderRequestPanel(buttonText) {
  return `
    <section class="verification-request-panel" aria-labelledby="verificationRequestTitle">
      <div>
        <h3 id="verificationRequestTitle">${escapeHTML(buttonText)}</h3>
        <p>We will contact you using the information on your profile.</p>
      </div>
      <form id="verificationRequestForm" class="verification-form">
        <label for="verificationMessage">Anything we should know before the call?</label>
        <textarea id="verificationMessage" maxlength="1200" placeholder="Add context about your experience, availability, or the best time to reach you."></textarea>

        <label class="verification-confirmation">
          <input type="checkbox" id="verificationConfirm" />
          <span>I confirm the information in my Placely profile is accurate.</span>
        </label>

        <div class="verification-actions form-actions">
          <a href="${escapeAttribute(routeFor("profile"))}" class="secondary-btn">Edit Profile</a>
          <button type="submit" id="verificationSubmitBtn" class="primary-btn">${escapeHTML(buttonText)}</button>
        </div>
      </form>
    </section>
  `;
}

function renderCallout(title, text, buttonText, href) {
  return `
    <section class="verification-callout">
      <div>
        <h3>${escapeHTML(title)}</h3>
        <p>${escapeHTML(text)}</p>
      </div>
      ${buttonText && href ? `<a href="${escapeAttribute(href)}" class="secondary-btn">${escapeHTML(buttonText)}</a>` : ""}
    </section>
  `;
}

function bindVerificationActions(status) {
  document.querySelectorAll('[data-verification-action="request"]').forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById("verificationRequestForm")?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("verificationConfirm")?.focus({ preventScroll: true });
    });
  });

  if (["unverified", "rejected"].includes(status)) {
    document.getElementById("verificationRequestForm")?.addEventListener("submit", submitVerificationRequest);
  }
}

function bindAccountMenu() {
  const button = document.getElementById("candidateAccountButton");
  const menu = document.getElementById("candidateAccountMenu");
  if (!button || !menu) return;

  const closeMenu = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
    button.setAttribute("aria-expanded", String(!menu.hidden));
  });

  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("click", () => closeMenu());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
}

function bindMobileSidebar() {
  const toggle = document.getElementById("sidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");
  if (!toggle || !backdrop) return;

  const setSidebarOpen = (isOpen) => {
    document.body.classList.toggle("sidebar-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    backdrop.hidden = !isOpen;
  };

  toggle.addEventListener("click", () => {
    setSidebarOpen(!document.body.classList.contains("sidebar-open"));
  });

  backdrop.addEventListener("click", () => setSidebarOpen(false));

  document.querySelectorAll(".candidate-nav-link").forEach((link) => {
    link.addEventListener("click", () => setSidebarOpen(false));
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) setSidebarOpen(false);
  });
}

function renderVerificationError() {
  const card = document.getElementById("verificationCard");
  setText("verificationTitle", "Get Verified");
  setText("verificationSubtitle", "Request a short Placely screening call to strengthen your profile and build trust with employers.");
  if (!card) return;

  card.innerHTML = `
    <section class="verification-error">
      <div class="verification-state-icon error" aria-hidden="true">${alertIcon()}</div>
      <span class="verification-state-badge rejected">Status unavailable</span>
      <h2>We could not load your verification status</h2>
      <p>Please refresh the page or try again shortly.</p>
      <div class="verification-actions">
        <button type="button" class="primary-btn" id="verificationRetryBtn">Retry</button>
      </div>
    </section>
  `;

  document.getElementById("verificationRetryBtn")?.addEventListener("click", initCandidateVerification);
}

async function submitVerificationRequest(event) {
  event.preventDefault();

  const confirmed = document.getElementById("verificationConfirm")?.checked;
  if (!confirmed) {
    showVerificationToast("Please confirm your profile information is accurate.");
    return;
  }

  const submit = document.getElementById("verificationSubmitBtn");
  const originalSubmitText = submit?.textContent || "Request Verification";
  if (submit?.disabled) return;
  if (submit) {
    submit.disabled = true;
    submit.textContent = "Submitting...";
  }

  try {
    const message = document.getElementById("verificationMessage")?.value?.trim() || "";
    const { data, error } = await verificationSupabase.functions.invoke("request-candidate-verification", {
      body: { request_message: message }
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    verificationProfile.verification_status = "pending";
    verificationProfile.verification_requested_at = data?.request?.requested_at || new Date().toISOString();
    showVerificationToast("Verification request submitted.");
    renderVerificationPage();
  } catch (error) {
    console.error("Candidate verification request failed", {
      message: error?.message,
      context: error?.context
    });
    showVerificationToast(error?.message || "We could not submit your verification request.");
    if (submit) {
      submit.disabled = false;
      submit.textContent = originalSubmitText;
    }
  }
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

function routeFor(key) {
  if (window.PlacelyCandidateSidebar?.urlFor) return window.PlacelyCandidateSidebar.urlFor(key);

  const fallback = {
    profile: "candidate-profile.html",
    jobs: "../public/find-jobs.html?role=candidate",
    support: "candidate-support.html"
  };

  return fallback[key] || "candidate-dashboard.html";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "";
}

function getInitials(value) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() : "PT";
}

function slugify(value) {
  return String(value || "section").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function showVerificationToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) {
    alert(message);
    return;
  }
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
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

function icon(path) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`;
}

function shieldIcon() {
  return icon('<path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm0 2.15 6 2.25V11c0 3.9-2.45 7.6-6 8.9-3.55-1.3-6-5-6-8.9V6.4l6-2.25Z"/>');
}

function shieldCheckIcon() {
  return icon('<path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm0 2.15 6 2.25V11c0 3.9-2.45 7.6-6 8.9-3.55-1.3-6-5-6-8.9V6.4l6-2.25Zm3.7 5.7-4.35 4.35-2.05-2.05-1.4 1.42 3.45 3.43 5.75-5.75-1.4-1.4Z"/>');
}

function shieldAlertIcon() {
  return icon('<path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm0 2.15 6 2.25V11c0 3.9-2.45 7.6-6 8.9-3.55-1.3-6-5-6-8.9V6.4l6-2.25Zm-1 4.85h2v5h-2V9Zm0 7h2v2h-2v-2Z"/>');
}

function clockIcon() {
  return icon('<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm1 3v4.58l3.2 3.2-1.42 1.42L11 12.42V7h2Z"/>');
}

function checkIcon() {
  return icon('<path d="m9.2 16.6-4.1-4.1 1.4-1.42 2.7 2.68 7.3-7.28 1.4 1.42-8.7 8.7Z"/>');
}

function searchIcon() {
  return icon('<path d="M10.5 3a7.5 7.5 0 0 1 5.97 12.04l3.25 3.24-1.42 1.42-3.24-3.25A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"/>');
}

function documentIcon() {
  return icon('<path d="M6 2h9l5 5v15H6V2Zm8 2H8v16h10V8h-4V4Zm-3 8h4v2h-4v-2Zm0 4h4v2h-4v-2Z"/>');
}

function sparkIcon() {
  return icon('<path d="M12 2 9.9 7.9 4 10l5.9 2.1L12 18l2.1-5.9L20 10l-5.9-2.1L12 2Zm6 12-1 2.8-2.8 1 2.8 1 1 2.8 1-2.8 2.8-1-2.8-1-1-2.8ZM5 14l-.8 2.2-2.2.8 2.2.8L5 20l.8-2.2L8 17l-2.2-.8L5 14Z"/>');
}

function badgeIcon() {
  return icon('<path d="M12 2a6 6 0 0 1 4.9 9.46L18 20l-6-2-6 2 1.1-8.54A6 6 0 0 1 12 2Zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/>');
}

function mailIcon() {
  return icon('<path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v.35l8 5.34 8-5.34V7H4Zm0 2.75V17h16V9.75l-7.45 4.97a1 1 0 0 1-1.1 0L4 9.75Z"/>');
}

function userIcon() {
  return icon('<path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.33 0-8 2.03-8 4.43V20a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.57C20 16.03 16.33 14 12 14Z"/>');
}

function phoneIcon() {
  return icon('<path d="M6.62 10.79a15.2 15.2 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.32.56 3.58.56a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.26.19 2.46.56 3.58a1 1 0 0 1-.24 1.01l-2.2 2.2Z"/>');
}

function locationIcon() {
  return icon('<path d="M12 2a7 7 0 0 1 7 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 0 1 7-7Zm0 2a5 5 0 0 0-5 5c0 2.55 2.85 6.95 5 9.72 2.15-2.77 5-7.17 5-9.72a5 5 0 0 0-5-5Zm0 2.5A2.5 2.5 0 1 1 12 11a2.5 2.5 0 0 1 0-5Z"/>');
}

function calendarIcon() {
  return icon('<path d="M7 2h2v2h6V2h2v2h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3V2Zm13 8H4v10h16V10ZM4 8h16V6H4v2Z"/>');
}

function alertIcon() {
  return icon('<path d="M11 7h2v7h-2V7Zm0 9h2v2h-2v-2ZM12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Z"/>');
}
