const verificationSupabase = window.PlacelyAuth.client();

let verificationUser = null;
let verificationProfile = {};

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

  document.getElementById("verificationRequestForm")?.addEventListener("submit", submitVerificationRequest);
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
  const card = document.getElementById("verificationCard");

  setText("topCandidateName", firstName);
  setText("topCandidateAvatar", getInitials(fullName || verificationProfile.email));
  setText("accountMenuCandidateName", fullName);
  setText("accountMenuEmail", verificationProfile.email || verificationUser?.email || "No email on file");

  window.PlacelyCandidateSidebar?.updateVerificationStatus(status);

  if (!card) return;

  if (status === "verified") {
    card.innerHTML = renderVerificationState({
      status,
      icon: "✓",
      label: "Verified by Placely",
      heading: "Your profile is verified",
      description: "Your verified badge is visible to employers across Placely.",
      body: `
        ${renderVerifiedMeta()}
        ${renderCandidateDetailsGrid()}
      `,
      actions: `
        <a href="candidate-profile.html" class="primary-btn">View Profile</a>
        <a href="../public/find-jobs.html?role=candidate" class="secondary-btn">Find Jobs</a>
      `
    });
    return;
  }

  if (status === "pending") {
    card.innerHTML = renderVerificationState({
      status,
      icon: "⌕",
      label: "Verification pending",
      heading: "Your request is being reviewed",
      description: "We received your verification request. The Placely team will contact you using the information on your profile.",
      body: `
        ${renderNextSteps()}
        ${renderCandidateDetailsGrid()}
      `,
      actions: `<a href="candidate-profile.html" class="secondary-btn">Edit Profile</a>`
    });
    return;
  }

  if (status === "rejected") {
    card.innerHTML = renderVerificationState({
      status,
      icon: "!",
      label: "Verification not approved",
      heading: "Your verification request was not approved",
      description: "Review your profile information and contact Placely support if you believe something needs to be updated.",
      body: renderCandidateDetailsGrid(),
      actions: `
        <a href="candidate-profile.html" class="primary-btn">Edit Profile</a>
        <a href="candidate-support.html" class="secondary-btn">Contact Support</a>
        <button type="button" class="secondary-btn" id="requestAgainBtn">Request Again</button>
      `
    });
    document.getElementById("requestAgainBtn")?.addEventListener("click", () => {
      verificationProfile.verification_status = "unverified";
      renderVerificationPage();
    });
    return;
  }

  card.innerHTML = renderVerificationState({
    status,
    icon: "✓",
    label: "Placely Verification",
    heading: "Stand out with a verified profile",
    description: "Complete a short screening call with Placely to add a verified badge to your profile and help employers feel more confident contacting you.",
    body: `
      ${renderBenefits()}
      ${renderCandidateDetailsGrid()}
      ${renderRequestForm()}
    `,
    actions: ""
  });

  document.getElementById("verificationRequestForm")?.addEventListener("submit", submitVerificationRequest);
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

function renderVerificationState({ status, icon, label, heading, description, body, actions }) {
  return `
    <div class="verification-state-header">
      <div class="verification-state-icon ${escapeAttribute(status)}" aria-hidden="true">${escapeHTML(icon)}</div>
      <span class="verification-state-badge ${escapeAttribute(status)}">${escapeHTML(label)}</span>
      <h2>${escapeHTML(heading)}</h2>
      <p>${escapeHTML(description)}</p>
    </div>
    ${body || ""}
    ${actions ? `<div class="verification-actions">${actions}</div>` : ""}
  `;
}

function renderBenefits() {
  const benefits = [
    "Build trust with employers",
    "Stand out in candidate search",
    "Show that your profile was reviewed by Placely"
  ];

  return `
    <section class="verification-section" aria-labelledby="verificationBenefitsTitle">
      <h3 class="verification-section-title" id="verificationBenefitsTitle">Why request verification</h3>
      <div class="verification-benefits">
        ${benefits.map((benefit) => `
          <div class="verification-benefit">
            <span class="verification-benefit-icon" aria-hidden="true">✓</span>
            <span>${escapeHTML(benefit)}</span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderNextSteps() {
  const steps = [
    ["Placely reviews your request", "We check that your profile has enough information for review."],
    ["We contact you", "The team reaches out to arrange a short screening call."],
    ["Your profile is updated", "After review, your verification status is updated in Placely."]
  ];

  return `
    <section class="verification-section" aria-labelledby="verificationNextStepsTitle">
      <h3 class="verification-section-title" id="verificationNextStepsTitle">What happens next</h3>
      <div class="verification-next-steps">
        ${steps.map(([title, text], index) => `
          <div class="verification-next-step">
            <span class="verification-step-number" aria-hidden="true">${index + 1}</span>
            <strong>${escapeHTML(title)}</strong>
            <p>${escapeHTML(text)}</p>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderCandidateDetailsGrid() {
  const details = [
    ["Name", verificationProfile.full_name || "Candidate"],
    ["Account email", verificationProfile.email || verificationUser?.email || "Not provided"],
    ["Phone", verificationProfile.phone || "Not provided"],
    ["Trade/current role", verificationProfile.trade || "Not listed"],
    ["Location", verificationProfile.location || "Not listed"],
    ["Availability", verificationProfile.availability || "Not listed"]
  ];

  return `
    <section class="verification-section" aria-labelledby="verificationDetailsTitle">
      <h3 class="verification-section-title" id="verificationDetailsTitle">Profile information for review</h3>
      <dl class="verification-details-grid">
        ${details.map(([label, value]) => `
          <div class="verification-detail-item">
            <dt><span>${escapeHTML(label)}</span></dt>
            <dd><strong>${escapeHTML(value)}</strong></dd>
          </div>
        `).join("")}
      </dl>
    </section>
  `;
}

function renderRequestForm() {
  return `
    <form id="verificationRequestForm" class="verification-form verification-section">
      <label for="verificationMessage">Anything we should know before the call?</label>
      <textarea id="verificationMessage" maxlength="1200" placeholder="Add context about your experience, availability, or the best time to reach you."></textarea>

      <label class="verification-confirmation">
        <input type="checkbox" id="verificationConfirm" />
        <span>I confirm the information in my Placely profile is accurate.</span>
      </label>

      <p class="verification-helper-text">We will contact you using the information on your profile.</p>

      <div class="verification-actions">
        <a href="candidate-profile.html" class="secondary-btn">Edit Profile</a>
        <button type="submit" id="verificationSubmitBtn" class="primary-btn">Request Verification</button>
      </div>
    </form>
  `;
}

function renderVerifiedMeta() {
  const verifiedDate = verificationProfile.verified_at ? formatDate(verificationProfile.verified_at) : "";

  return `
    <section class="verification-section verified-preview" aria-label="Verified profile status">
      ${window.PlacelyVerifiedBadge?.render(verificationProfile) || ""}
      ${verifiedDate ? `<span class="verification-helper-text">Verified on ${escapeHTML(verifiedDate)}</span>` : ""}
    </section>
  `;
}

function renderVerificationError() {
  const card = document.getElementById("verificationCard");
  if (!card) return;

  card.innerHTML = `
    <div class="verification-error">
      <div class="verification-state-icon error" aria-hidden="true">!</div>
      <span class="verification-state-badge rejected">Status unavailable</span>
      <h2>We could not load your verification status</h2>
      <p>Please refresh the page or try again shortly.</p>
      <div class="verification-actions">
        <button type="button" class="primary-btn" id="verificationRetryBtn">Retry</button>
      </div>
    </div>
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
      submit.textContent = "Request Verification";
    }
  }
}

function normalizeVerificationStatus(status) {
  const value = String(status || "unverified").toLowerCase().trim();
  return ["pending", "verified", "rejected"].includes(value) ? value : "unverified";
}

function getVerificationStatusLabel(status) {
  return {
    unverified: "Unverified",
    pending: "Verification pending",
    verified: "Verified by Placely",
    rejected: "Verification not approved"
  }[status] || "Unverified";
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "";
}

function getInitials(value) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() : "PT";
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
