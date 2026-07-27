const employerSupabase = window.employerSupabase;

const PHOTO_BUCKET = "employer-logos";
const ACTIVE_PUBLIC_JOB_STATUSES = ["active", "published", "open"];

const form = document.getElementById("employerProfileForm");
const toast = document.getElementById("toast");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const uploadLogoBtn = document.getElementById("uploadLogoBtn");
const removeLogoBtn = document.getElementById("removeLogoBtn");
const logoFileInput = document.getElementById("company_logo_file");
const logoPreview = document.getElementById("company_logo_preview");
const logoFrame = document.querySelector(".company-logo-frame");
const previewLogoImg = document.getElementById("previewLogoImg");
const previewLogoBox = document.querySelector(".preview-company-logo");
const hiringRolesGroup = document.getElementById("hiring_roles_group");
const hiringRoleOtherInput = document.getElementById("hiring_role_other");
const compensationTypeInput = document.getElementById("compensation_type");
const compensationMinInput = document.getElementById("compensation_min");
const compensationMaxInput = document.getElementById("compensation_max");
const activeJobsList = document.getElementById("activeJobsList");
const copyPublicLinkBtn = document.getElementById("copyPublicLinkBtn");

let currentUser = null;
let currentProfile = {};
let currentLogoUrl = "";
let activePublicJobs = [];
let hasCandidateNetworkAccess = false;
let isLogoUploading = false;
let isProfileSaving = false;

document.addEventListener("DOMContentLoaded", initEmployerProfilePage);

async function initEmployerProfilePage() {
  renderHiringRoleOptions();
  setupDashboardShell();
  setupLivePreview();
  setupStructuredFieldEvents();
  setupLogoUpload();
  setupPublicLinkActions();
  setupProfileSubmit();

  try {
    const user = await verifyEmployerAccess(employerSupabase, {
      loginPath: "employer-login.html",
      candidateDashboardPath: "../candidates/candidate-dashboard.html"
    });

    if (!user) return;
    currentUser = user;

    await loadEmployerProfile(user.id, user.email);
    updateCompanyChrome();
    updatePublicProfileLinks();

    await Promise.allSettled([
      loadActiveJobs(user.id),
      loadHeaderCounts(user.id)
    ]);

    renderActiveJobs();
    updatePreview();
    updateStrength();
  } catch (error) {
    console.error("Employer profile failed to load", {
      code: error?.code,
      message: error?.message
    });
    showToast("Could not load company profile.");
  } finally {
    document.documentElement.classList.remove("profile-booting");
  }
}

async function loadEmployerProfile(userId, accountEmail = "") {
  const { data: profile, error } = await employerSupabase
    .from("employer_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error || !profile) {
    await window.PlacelyAuth.clearAuthState();
    window.location.replace("employer-login.html");
    throw error || new Error("Employer profile was not found.");
  }

  currentProfile = profile;
  currentLogoUrl = profile.company_logo_url || "";
  hasCandidateNetworkAccess = window.PlacelyAuth.hasCandidateSearchAccess?.(profile) || false;
  document.body.dataset.plan = hasCandidateNetworkAccess ? "pro" : "free";
  window.applyCandidateAccessUI?.(hasCandidateNetworkAccess);

  setValue("company_name", profile.company_name);
  setValue("industry", profile.industry);
  setValue("main_hiring_industry", profile.main_hiring_industry);
  setValue("company_location", profile.company_location);
  setValue("company_website", profile.company_website);
  setValue("company_description", profile.company_description);
  setValue("employment_type", profile.employment_type);
  setValue("compensation_type", profile.compensation_type);
  setValue("compensation_min", profile.compensation_min);
  setValue("compensation_max", profile.compensation_max);
  setValue("hiring_timeline", window.PlacelyAuth.normalizeHiringTimeline(profile.hiring_timeline));
  setValue("candidate_qualities", profile.candidate_qualities);
  setValue("account_email", accountEmail);
  setValue("company_email", profile.company_email || accountEmail);
  setValue("contact_name", profile.contact_name);
  setValue("phone", profile.phone);
  setHiringRoles(window.PlacelyAuth.getEmployerHiringRoles(profile), profile.hiring_role_other);

  if (currentLogoUrl) setLogoImage(getEmployerLogoUrl(currentLogoUrl));
  else clearLogoImage();
}

async function loadActiveJobs(userId) {
  const { data, error } = await employerSupabase
    .from("jobs")
    .select("*")
    .eq("employer_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    renderActiveJobsError();
    return;
  }

  activePublicJobs = (data || []).filter(isPublicActiveJob);
}

async function loadHeaderCounts(userId) {
  const [{ count: unreadCount }, { count: notificationCount }] = await Promise.all([
    employerSupabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("employer_id", userId)
      .eq("sender_type", "candidate")
      .eq("read_by_employer", false),
    employerSupabase
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("employer_id", userId)
      .in("status", ["submitted", "new", "reviewing", "interview", "offer"])
  ]);

  updateBadge("topUnreadBadge", unreadCount || 0);
  updateBadge("topNotificationBadge", notificationCount || 0);
}

function setupProfileSubmit() {
  form?.addEventListener("submit", saveEmployerProfile);
}

async function saveEmployerProfile(event) {
  event.preventDefault();

  if (isProfileSaving) return;

  if (isLogoUploading) {
    showToast("Logo is still uploading. Please wait a second.");
    return;
  }

  const {
    data: { user },
    error: userError
  } = await employerSupabase.auth.getUser();

  if (userError || !user) {
    window.location.href = "employer-login.html";
    return;
  }

  const companyName = getValue("company_name");
  if (!companyName) {
    showToast("Company name is required.");
    document.getElementById("company_name")?.focus();
    return;
  }

  const compensationError = validateCompensation();
  if (compensationError) {
    showToast(compensationError);
    return;
  }

  const compensation = window.PlacelyAuth.buildCompensationPayload(
    getValue("compensation_type"),
    compensationMinInput?.value,
    compensationMaxInput?.value
  );

  const updates = {
    id: user.id,
    company_name: companyName,
    industry: getValue("industry"),
    main_hiring_industry: getValue("main_hiring_industry"),
    company_website: getValue("company_website"),
    company_location: getValue("company_location"),
    company_description: getValue("company_description"),
    employment_type: getValue("employment_type"),
    hiring_roles: getSelectedKnownHiringRoles(),
    hiring_role_other: getOtherHiringRole(),
    hiring_needs: getSelectedHiringRoles().join(", "),
    ...(compensation.payload || {
      compensation_type: getValue("compensation_type"),
      compensation_min: getNumberValue(compensationMinInput),
      compensation_max: getNumberValue(compensationMaxInput),
      pay_range: window.PlacelyAuth.formatCompensation(
        getValue("compensation_type"),
        getNumberValue(compensationMinInput),
        getNumberValue(compensationMaxInput)
      )
    }),
    hiring_timeline: window.PlacelyAuth.normalizeHiringTimeline(getValue("hiring_timeline")),
    candidate_qualities: getValue("candidate_qualities"),
    company_email: getValue("company_email"),
    contact_name: getValue("contact_name"),
    phone: getValue("phone"),
    company_logo_url: currentLogoUrl
  };

  const willBeComplete = window.PlacelyAuth.isEmployerOnboardingComplete({
    ...currentProfile,
    ...updates,
    onboarding_completed: true
  });
  updates.onboarding_completed = willBeComplete;
  updates.onboarding_completed_at = willBeComplete ? new Date().toISOString() : null;

  isProfileSaving = true;
  const originalText = saveProfileBtn?.textContent || "Save Changes";
  if (saveProfileBtn) {
    saveProfileBtn.disabled = true;
    saveProfileBtn.textContent = "Saving...";
  }

  const { error } = await updateExistingEmployerProfile(updates, user.id);

  if (error) {
    if (window.PlacelyAuth.isMissingRowError(error)) {
      await window.PlacelyAuth.clearAuthState();
      window.location.replace("employer-login.html");
      return;
    }

    showToast("Could not save profile.");
    finishSaving(originalText);
    return;
  }

  currentProfile = {
    ...currentProfile,
    ...updates
  };

  updateCompanyChrome();
  updatePublicProfileLinks();
  updatePreview();
  updateStrength();
  showToast("Company profile saved.");
  finishSaving(originalText);
}

function finishSaving(originalText) {
  if (saveProfileBtn) {
    saveProfileBtn.disabled = false;
    saveProfileBtn.textContent = originalText;
  }
  isProfileSaving = false;
}

async function updateExistingEmployerProfile(updates, userId) {
  const result = await employerSupabase
    .from("employer_profiles")
    .update(updates)
    .eq("id", userId)
    .select("id")
    .single();

  if (!isMissingColumnError(result.error)) return result;

  const compatibleUpdates = { ...updates };
  delete compatibleUpdates.onboarding_completed;
  delete compatibleUpdates.onboarding_completed_at;
  delete compatibleUpdates.hiring_roles;
  delete compatibleUpdates.hiring_role_other;
  delete compatibleUpdates.compensation_type;
  delete compatibleUpdates.compensation_min;
  delete compatibleUpdates.compensation_max;

  return employerSupabase
    .from("employer_profiles")
    .update(compatibleUpdates)
    .eq("id", userId)
    .select("id")
    .single();
}

function setupLogoUpload() {
  if (!uploadLogoBtn || !logoFileInput) return;

  uploadLogoBtn.addEventListener("click", () => {
    logoFileInput.click();
  });

  logoFileInput.addEventListener("change", async () => {
    const file = logoFileInput.files[0];
    if (!file) return;

    const {
      data: { user },
      error: userError
    } = await employerSupabase.auth.getUser();

    if (userError || !user) {
      window.location.href = "employer-login.html";
      return;
    }

    try {
      isLogoUploading = true;
      uploadLogoBtn.disabled = true;
      uploadLogoBtn.textContent = "Uploading...";

      await window.PlacelyAuth.validateImageFileForUpload(file, "employerLogo");
      const previewUrl = URL.createObjectURL(file);
      setLogoImage(previewUrl);
      updateStrength();
      showToast("Uploading company logo...");

      const previousLogoValue = currentLogoUrl;
      const logoPath = await uploadCompanyLogo(user.id, file);
      const { error: profileError } = await updateExistingEmployerProfile({ company_logo_url: logoPath }, user.id);

      if (profileError) {
        await removeLogoObject(logoPath, user.id);
        throw new Error("Logo uploaded, but we could not save it to your profile.");
      }

      currentLogoUrl = logoPath;
      currentProfile = {
        ...currentProfile,
        company_logo_url: logoPath
      };
      setLogoImage(getEmployerLogoUrl(logoPath, Date.now()));
      updateCompanyChrome();
      updatePreview();
      updateStrength();

      if (previousLogoValue && previousLogoValue !== logoPath) {
        try {
          await removeLogoObject(previousLogoValue, user.id);
        } catch {}
      }

      showToast("Logo uploaded.");
    } catch (error) {
      showToast(error?.message || "Logo upload failed.");
      if (currentLogoUrl) setLogoImage(getEmployerLogoUrl(currentLogoUrl));
      else clearLogoImage();
    } finally {
      isLogoUploading = false;
      uploadLogoBtn.disabled = false;
      uploadLogoBtn.textContent = "Upload Logo";
      logoFileInput.value = "";
    }
  });

  removeLogoBtn?.addEventListener("click", removeCurrentLogo);
}

async function uploadCompanyLogo(userId, file) {
  if (!file) throw new Error("No logo file selected.");
  return window.PlacelyAuth.uploadOwnedImage(employerSupabase, "employerLogo", file, userId);
}

async function removeCurrentLogo() {
  if (!currentUser || isLogoUploading || !currentLogoUrl) return;

  const previousLogoValue = currentLogoUrl;
  const wasOwned = window.PlacelyAuth.isOwnedStoragePath(previousLogoValue, PHOTO_BUCKET, currentUser.id);
  if (wasOwned) await removeLogoObject(previousLogoValue, currentUser.id);

  const { error } = await updateExistingEmployerProfile({ company_logo_url: null }, currentUser.id);
  if (error) {
    showToast("Could not remove logo. Please try again.");
    return;
  }

  currentLogoUrl = "";
  currentProfile = {
    ...currentProfile,
    company_logo_url: null
  };
  clearLogoImage();
  updateCompanyChrome();
  updatePreview();
  updateStrength();
  showToast("Logo removed.");
}

async function removeLogoObject(value, userId) {
  await window.PlacelyAuth.removeOwnedImage(employerSupabase, PHOTO_BUCKET, value, userId);
}

function getEmployerLogoUrl(value, cacheBust = "") {
  return window.PlacelyAuth.resolveEmployerLogoUrl?.(value, { supabase: employerSupabase, cacheBust })
    || window.PlacelyAuth.getPublicImageUrl(employerSupabase, PHOTO_BUCKET, value, { cacheBust });
}

function renderHiringRoleOptions() {
  if (!hiringRolesGroup) return;

  hiringRolesGroup.innerHTML = window.PlacelyAuth.hiringRoleOptions.map((role) => `
    <label class="role-chip">
      <input type="checkbox" value="${escapeAttribute(role)}">
      <span>${escapeHTML(role)}</span>
    </label>
  `).join("");
}

function setupLivePreview() {
  document.querySelectorAll("#employerProfileForm input, #employerProfileForm textarea, #employerProfileForm select").forEach((input) => {
    input.addEventListener("input", () => {
      updatePreview();
      updateStrength();
    });
    input.addEventListener("change", () => {
      updatePreview();
      updateStrength();
    });
  });
}

function setupStructuredFieldEvents() {
  hiringRolesGroup?.addEventListener("change", () => {
    syncOtherRoleVisibility();
    updatePreview();
    updateStrength();
  });

  compensationTypeInput?.addEventListener("change", () => {
    const isAnnual = compensationTypeInput.value === "annual";
    if (compensationMinInput) compensationMinInput.placeholder = isAnnual ? "50000" : "20";
    if (compensationMaxInput) compensationMaxInput.placeholder = isAnnual ? "80000" : "40";
  });

  [compensationMinInput, compensationMaxInput].forEach((input) => {
    input?.addEventListener("input", () => {
      input.value = input.value.replace(/[^\d.]/g, "");
    });
  });
}

function setupPublicLinkActions() {
  copyPublicLinkBtn?.addEventListener("click", async () => {
    const url = getPublicCompanyProfileUrl(true, { includeContext: false });
    try {
      await navigator.clipboard.writeText(url);
      showToast("Public profile link copied.");
    } catch {
      showToast("Could not copy link.");
    }
  });
}

function setupDashboardShell() {
  const body = document.body;
  const sidebar = document.getElementById("dashboardSidebar");
  const toggle = document.getElementById("sidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");
  const searchForm = document.getElementById("profileSearchForm");
  const searchInput = document.getElementById("profileSearchInput");
  setCompanyProfileActiveNav();

  const closeSidebar = () => {
    body.classList.remove("sidebar-open");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    if (backdrop) backdrop.hidden = true;
  };

  const openSidebar = () => {
    body.classList.add("sidebar-open");
    if (toggle) toggle.setAttribute("aria-expanded", "true");
    if (backdrop) backdrop.hidden = false;
  };

  toggle?.addEventListener("click", () => {
    if (body.classList.contains("sidebar-open")) closeSidebar();
    else openSidebar();
  });

  backdrop?.addEventListener("click", closeSidebar);
  sidebar?.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeSidebar();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSidebar();
  });

  searchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = String(searchInput?.value || "").trim();
    window.location.href = query
      ? `find-candidates.html?query=${encodeURIComponent(query)}`
      : "find-candidates.html";
  });

  document.addEventListener("error", (event) => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.matches("[data-profile-logo-image]")) {
      image.remove();
    }
  }, true);
}

function setCompanyProfileActiveNav() {
  document.querySelectorAll(".dashboard-sidebar .nav-item.active").forEach((link) => {
    link.classList.remove("active");
  });

  const companyProfileLink = document.querySelector('.dashboard-sidebar a[href="employer-profile.html"]:not(#employerSettingsSidebarLink)');
  companyProfileLink?.classList.add("active");
}

function updatePreview() {
  const companyName = getValue("company_name") || currentProfile.company_name || "Company Name";
  const industry = getValue("industry") || currentProfile.industry || "Industry";
  const location = getValue("company_location") || currentProfile.company_location || "Location";
  const website = normalizeWebsite(getValue("company_website") || currentProfile.company_website);
  const description = getValue("company_description") || currentProfile.company_description || "Company description will appear here once added.";
  const roles = getSelectedHiringRoles();
  const compensation = getCompensationSummary();
  const employment = getValue("employment_type") || currentProfile.employment_type || "";
  const mainHiring = getValue("main_hiring_industry") || currentProfile.main_hiring_industry || "";
  const initials = getInitials(companyName);

  setText("companyLogo", initials);
  setText("previewLogo", initials);
  setText("previewCompanyName", companyName);
  setText("previewCompanyMeta", [industry, location].filter(Boolean).join(" - ") || "Placely Talent employer");
  setText("previewDescription", description);
  setText("previewActiveJobCount", String(activePublicJobs.length));

  const websiteLink = document.getElementById("previewWebsite");
  if (websiteLink) {
    websiteLink.hidden = !website;
    websiteLink.href = website || "#";
    websiteLink.textContent = website ? website.replace(/^https?:\/\//i, "") : "";
  }

  const tags = [
    mainHiring,
    employment,
    compensation,
    ...roles.slice(0, 5)
  ].filter(Boolean);

  const tagContainer = document.getElementById("previewTags");
  if (tagContainer) {
    tagContainer.innerHTML = tags.length
      ? tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("")
      : `<span>Hiring details coming soon</span>`;
  }
}

function updateStrength() {
  const completionItems = [
    ["company_name", "Add company name", "#publicProfile"],
    ["industry", "Add industry", "#publicProfile"],
    ["company_location", "Add location", "#publicProfile"],
    ["company_description", "Add company description", "#publicProfile"],
    ["main_hiring_industry", "Add hiring industry", "#publicProfile"],
    ["employment_type", "Add employment type", "#publicProfile"],
    ["company_website", "Add website", "#publicProfile"],
    ["hiring_timeline", "Add hiring timeline", "#privateHiring"],
    ["candidate_qualities", "Add candidate qualities", "#privateHiring"]
  ];

  const completed = completionItems.filter(([id]) => getValue(id)).length
    + (currentLogoUrl || isLogoUploading ? 1 : 0)
    + (getSelectedHiringRoles().length ? 1 : 0)
    + (getCompensationSummary() ? 1 : 0);
  const total = completionItems.length + 3;
  const percent = Math.round((completed / total) * 100);

  setText("profileStrength", `${percent}%`);
  const strengthBar = document.getElementById("strengthBar");
  if (strengthBar) strengthBar.style.width = `${percent}%`;

  const missing = [
    !currentLogoUrl && !isLogoUploading ? ["Add company logo", "#publicProfile"] : null,
    ...completionItems.filter(([id]) => !getValue(id)).map(([, label, href]) => [label, href]),
    !getSelectedHiringRoles().length ? ["Add hiring roles", "#publicProfile"] : null,
    !getCompensationSummary() ? ["Add compensation summary", "#publicProfile"] : null
  ].filter(Boolean).slice(0, 4);

  const scoreList = document.getElementById("scoreList");
  if (scoreList) {
    scoreList.innerHTML = missing.length
      ? missing.map(([label, href]) => `<a href="${escapeAttribute(href)}">${escapeHTML(label)}</a>`).join("")
      : `<a href="#publicPreview">Profile essentials complete</a>`;
  }
}

function updateCompanyChrome() {
  const companyName = getValue("company_name") || currentProfile.company_name || "Employer";
  const initials = getInitials(companyName);
  const accountEmail = getValue("company_email") || currentUser?.email || "";

  setText("topCompanyName", companyName);
  renderHeaderAvatar(companyName, initials);
  window.updateEmployerAccountMenu?.({
    companyName,
    companyEmail: getValue("company_email"),
    email: accountEmail
  });
}

function renderHeaderAvatar(companyName, initials) {
  const avatar = document.getElementById("topCompanyAvatar");
  if (!avatar) return;

  const logoUrl = currentLogoUrl ? getEmployerLogoUrl(currentLogoUrl) : "";
  const fallback = `<span class="avatar-fallback">${escapeHTML(initials)}</span>`;
  avatar.innerHTML = logoUrl
    ? `${fallback}<img src="${escapeAttribute(logoUrl)}" alt="${escapeAttribute(companyName)} logo" loading="lazy" decoding="async" data-profile-logo-image>`
    : fallback;
}

function renderActiveJobs() {
  if (!activeJobsList) return;
  updatePreview();

  if (!activePublicJobs.length) {
    activeJobsList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M9 6V5a3 3 0 0 1 3-3h1a3 3 0 0 1 3 3v1h3a2 2 0 0 1 2 2v10.5A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5V8a2 2 0 0 1 2-2h4Z"/></svg>
        </span>
        <span class="empty-copy">
          <strong>No active jobs right now</strong>
          <p>Post an active job to show opportunities on your public company profile.</p>
        </span>
        <a class="empty-action" href="manage-jobs.html?view=create">Post Job</a>
      </div>
    `;
    return;
  }

  activeJobsList.innerHTML = activePublicJobs.map((job) => {
    const publicUrl = buildJobPublicUrl(job);
    const editUrl = `edit-jobs.html?id=${encodeURIComponent(job.id)}`;
    const compensation = window.PlacelyAuth.formatCompensationFromRecord?.(job, "") || job.pay_range || "Compensation not listed";
    return `
      <article class="profile-job-row">
        <div class="profile-job-main">
          <strong>${escapeHTML(job.job_title || "Untitled Job")}</strong>
          <span>${escapeHTML([job.location, job.employment_type].filter(Boolean).join(" - ") || "Role details not listed")}</span>
        </div>
        <div class="profile-job-meta">
          <span>${escapeHTML(compensation)}</span>
          <span>Posted ${escapeHTML(formatDate(job.created_at))}</span>
          <span class="status-pill">${escapeHTML(getJobStatusLabel(job.status))}</span>
        </div>
        <div class="profile-job-actions">
          <a href="${escapeAttribute(publicUrl)}">View Job</a>
          <a href="${escapeAttribute(editUrl)}">Edit</a>
        </div>
      </article>
    `;
  }).join("");
}

function renderActiveJobsError() {
  if (!activeJobsList) return;
  activeJobsList.innerHTML = `
    <div class="empty-state error-state">
      <strong>Could not load active jobs</strong>
      <p>Your profile editor is still available. Refresh to try loading active jobs again.</p>
    </div>
  `;
}

function updatePublicProfileLinks() {
  const relativeUrl = getPublicCompanyProfileUrl(false, { includeContext: true });
  const absoluteUrl = getPublicCompanyProfileUrl(true, { includeContext: false });
  ["viewPublicProfileBtn", "previewPublicProfileBtn"].forEach((id) => {
    const link = document.getElementById(id);
    if (!link) return;
    link.href = relativeUrl;
  });
  setText("publicProfileUrlText", absoluteUrl);
}

function getPublicCompanyProfileUrl(absolute = false, options = {}) {
  const id = currentUser?.id || currentProfile.id || "";
  const slug = slugify(getValue("company_name") || currentProfile.company_name || "company");
  const context = options.includeContext === false
    ? ""
    : `&source=employer-profile&returnTo=${encodeURIComponent("employers/employer-profile.html")}`;
  const relative = `../public/company.html?id=${encodeURIComponent(id)}&slug=${encodeURIComponent(slug)}${context}`;
  return absolute ? new URL(relative, window.location.href).href : relative;
}

function buildJobPublicUrl(job) {
  const params = new URLSearchParams();
  if (job.id) params.set("id", job.id);
  return `../public/job.html?${params.toString()}`;
}

function isPublicActiveJob(job = {}) {
  if (!ACTIVE_PUBLIC_JOB_STATUSES.includes(String(job.status || "active").toLowerCase().trim())) return false;

  const deadline = job.application_deadline || job.expires_at || job.expiration_date;
  if (!deadline) return true;

  const deadlineTime = new Date(deadline).getTime();
  if (Number.isNaN(deadlineTime)) return true;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return deadlineTime >= today.getTime();
}

function setLogoImage(url) {
  if (!url) {
    clearLogoImage();
    return;
  }

  setImage(logoPreview, logoFrame, url);
  setImage(previewLogoImg, previewLogoBox, url);
}

function setImage(image, frame, url) {
  if (!image || !frame) return;

  image.onload = () => frame.classList.add("has-image");
  image.onerror = () => frame.classList.remove("has-image");
  image.dataset.profileLogoImage = "true";
  image.src = url;
}

function clearLogoImage() {
  if (logoPreview) logoPreview.removeAttribute("src");
  if (previewLogoImg) previewLogoImg.removeAttribute("src");
  logoFrame?.classList.remove("has-image");
  previewLogoBox?.classList.remove("has-image");
}

function setHiringRoles(roles, otherValue = "") {
  if (!hiringRolesGroup) return;

  const knownRoles = new Set(window.PlacelyAuth.hiringRoleOptions);
  const unknownRoles = (roles || []).filter((role) => !knownRoles.has(role));
  const resolvedOther = otherValue || unknownRoles.join(", ");
  const roleSet = new Set(roles || []);

  [...hiringRolesGroup.querySelectorAll("input")].forEach((input) => {
    input.checked = roleSet.has(input.value) || (input.value === "Other" && Boolean(resolvedOther));
  });

  if (hiringRoleOtherInput) hiringRoleOtherInput.value = resolvedOther;
  syncOtherRoleVisibility();
}

function syncOtherRoleVisibility() {
  const hasOther = Boolean(hiringRolesGroup?.querySelector('input[value="Other"]')?.checked);
  if (hiringRoleOtherInput) hiringRoleOtherInput.hidden = !hasOther;
}

function getSelectedHiringRoles() {
  const selected = getSelectedKnownHiringRoles();
  const other = getOtherHiringRole();
  return other ? [...selected, other] : selected;
}

function getSelectedKnownHiringRoles() {
  if (!hiringRolesGroup) return [];
  return [...hiringRolesGroup.querySelectorAll("input:checked")]
    .map((input) => input.value)
    .filter((role) => role !== "Other");
}

function getOtherHiringRole() {
  const hasOther = Boolean(hiringRolesGroup?.querySelector('input[value="Other"]')?.checked);
  return hasOther ? String(hiringRoleOtherInput?.value || "").trim() : "";
}

function validateCompensation() {
  const type = getValue("compensation_type");
  if (!type && !compensationMinInput?.value && !compensationMaxInput?.value) return "";

  const result = window.PlacelyAuth.validateCompensationValues(
    type,
    compensationMinInput?.value,
    compensationMaxInput?.value
  );

  return result.valid ? "" : result.message;
}

function getCompensationSummary() {
  return window.PlacelyAuth.formatCompensation(
    getValue("compensation_type"),
    getNumberValue(compensationMinInput),
    getNumberValue(compensationMaxInput),
    currentProfile.pay_range
  );
}

function getNumberValue(input) {
  const value = Number(input?.value);
  return Number.isFinite(value) && input?.value !== "" ? value : null;
}

function isMissingColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "PGRST204" || message.includes("column") || message.includes("could not find");
}

function updateBadge(id, value) {
  const badge = document.getElementById(id);
  if (!badge) return;
  const count = Number(value) || 0;
  badge.hidden = count <= 0;
  badge.textContent = count > 9 ? "9+" : String(count);
}

function setValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value ?? "";
}

function getValue(id) {
  const element = document.getElementById(id);
  return element ? String(element.value || "").trim() : "";
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value ?? "";
}

function getInitials(value) {
  return String(value || "PT")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "PT";
}

function normalizeWebsite(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function slugify(value) {
  return String(value || "company")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "company";
}

function getJobStatusLabel(status) {
  const value = String(status || "active").toLowerCase().trim();
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) : "Active";
}

function formatDate(value) {
  if (!value) return "recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
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

function showToast(message) {
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}
