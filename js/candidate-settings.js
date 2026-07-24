const settingsSupabase = window.PlacelyAuth.client();

let currentUser = null;
let currentProfile = null;

const settingsSearchForm = getEl("settingsSearchForm");
const settingsSearchInput = getEl("settingsSearchInput");

const notificationIds = [
  "notifyEmployerMessages",
  "notifyApplicationStatus",
  "notifySavedJobs"
];

function getEl(id) {
  return document.getElementById(id);
}

function showToast(message) {
  const toast = getEl("toast");

  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

function setText(id, value) {
  const el = getEl(id);
  if (el) el.textContent = value || "";
}

async function initSettings() {
  setupShellControls();

  try {
    currentUser = await verifyCandidateAccess(settingsSupabase, {
      loginPath: "candidate-login.html",
      employerDashboardPath: "../employers/employer-dashboard.html"
    });

    if (!currentUser) return;

    setupNotificationToggles();
    setupDeleteModal();
    await Promise.all([
      loadCandidateProfile(),
      loadHeaderCounts(currentUser.id)
    ]);
    hydrateHeader();
  } catch (error) {
    console.error("Candidate settings failed to load", {
      code: error?.code,
      message: error?.message
    });
    showToast("We could not load account settings. Please refresh and try again.");
  } finally {
    revealSettings();
  }
}

async function loadCandidateProfile() {
  const { data, error } = await settingsSupabase
    .from("candidate_profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error || !data) {
    await window.PlacelyAuth.clearAuthState();
    window.location.replace("candidate-login.html");
    return;
  }

  currentProfile = data;

  setText("settingsName", currentProfile.full_name || "Candidate");
  setText("settingsEmail", currentProfile.email || currentUser.email || "Not added");
  setText(
    "settingsVisibility",
    currentProfile.profile_visible === false ? "Hidden from employers" : "Visible to employers"
  );
}

async function loadHeaderCounts(userId) {
  const [{ count: unreadCount }, { count: notificationCount }] = await Promise.all([
    settingsSupabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", userId)
      .eq("sender_type", "employer")
      .eq("read_by_candidate", false),
    settingsSupabase
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", userId)
      .in("status", ["reviewing", "interview", "offer"])
  ]);

  updateBadge("topUnreadBadge", unreadCount || 0);
  updateBadge("topNotificationBadge", notificationCount || 0);
}

function setupNotificationToggles() {
  const saved = loadNotificationSettings();

  notificationIds.forEach((id) => {
    const input = getEl(id);
    if (!input) return;

    input.checked = saved[id] ?? true;
    input.addEventListener("change", saveNotificationSettings);
  });
}

function getNotificationStorageKey() {
  return `placelyCandidateNotificationSettings:${currentUser?.id || "anonymous"}`;
}

function loadNotificationSettings() {
  try {
    return JSON.parse(localStorage.getItem(getNotificationStorageKey())) || {};
  } catch {
    return {};
  }
}

function saveNotificationSettings() {
  const settings = {};

  notificationIds.forEach((id) => {
    settings[id] = Boolean(getEl(id)?.checked);
  });

  localStorage.setItem(getNotificationStorageKey(), JSON.stringify(settings));
  showToast("Notification preferences saved.");
}

function setupDeleteModal() {
  const deleteBtn = getEl("deleteProfileBtn");
  const cancelBtn = getEl("cancelDeleteProfileBtn");
  const overlay = getEl("deleteProfileOverlay");
  const input = getEl("deleteConfirmInput");
  const confirmBtn = getEl("confirmDeleteProfileBtn");

  if (deleteBtn) deleteBtn.addEventListener("click", openDeleteModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeDeleteModal);
  if (overlay) overlay.addEventListener("click", closeDeleteModal);

  if (input && confirmBtn) {
    input.addEventListener("input", () => {
      confirmBtn.disabled = input.value !== "DELETE";
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener("click", handleDeleteProfile);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDeleteModal();
  });
}

function openDeleteModal() {
  const modal = getEl("deleteProfileModal");
  const input = getEl("deleteConfirmInput");
  const confirmBtn = getEl("confirmDeleteProfileBtn");

  if (!modal) return;

  if (input) input.value = "";
  if (confirmBtn) confirmBtn.disabled = true;
  setModalMessage("");

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  input?.focus();
}

function closeDeleteModal() {
  const modal = getEl("deleteProfileModal");
  if (!modal) return;

  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function setModalMessage(message) {
  setText("deleteModalMessage", message);
}

async function handleDeleteProfile() {
  if (!currentUser || getEl("deleteConfirmInput")?.value !== "DELETE") return;

  const confirmBtn = getEl("confirmDeleteProfileBtn");
  const cancelBtn = getEl("cancelDeleteProfileBtn");

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Deleting...";
  }
  if (cancelBtn) cancelBtn.disabled = true;

  try {
    const deletedWithFunction = await tryDeleteWithEdgeFunction();

    if (!deletedWithFunction) {
      await fallbackDeleteCandidateProfile();
    }

    sessionStorage.setItem("placelyCandidateDeletionMessage", "Your profile has been deleted.");
    await window.PlacelyAuth.clearAuthState();
    window.location.replace("candidate-login.html");
  } catch {
    setModalMessage("Could not delete your profile. Please try again.");

    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Permanently Delete Profile";
    }
    if (cancelBtn) cancelBtn.disabled = false;
  }
}

async function tryDeleteWithEdgeFunction() {
  const { error } = await settingsSupabase.functions.invoke("delete-candidate-account");

  if (error) {
    return false;
  }

  return true;
}

async function fallbackDeleteCandidateProfile() {
  // Full auth-user deletion requires a Supabase Edge Function using the service role key.
  // This V1 fallback anonymizes candidate-owned records, preserves employer-owned jobs, and signs the user out.
  await Promise.allSettled([
    deleteSavedJobs(),
    anonymizeApplications(),
    anonymizeConversations(),
    deleteCandidateMessages()
  ]);

  await anonymizeCandidateProfile();
}

async function deleteSavedJobs() {
  const { error } = await settingsSupabase
    .from("saved_jobs")
    .delete()
    .eq("candidate_id", currentUser.id);

  if (error) throw error;
}

async function anonymizeApplications() {
  const deletedPayload = {
    status: "candidate_deleted",
    candidate_status: "candidate_deleted",
    employer_status: "candidate_profile_deleted",
    candidate_name: "Candidate profile deleted",
    candidate_email: null,
    candidate_phone: null,
    updated_at: new Date().toISOString()
  };

  const { error } = await settingsSupabase
    .from("applications")
    .update(deletedPayload)
    .eq("candidate_id", currentUser.id);

  if (!error) return;

  const { error: fallbackError } = await settingsSupabase
    .from("applications")
    .update({
      status: "withdrawn",
      candidate_status: "candidate_deleted",
      employer_status: "candidate_profile_deleted",
      candidate_name: "Candidate profile deleted",
      candidate_email: null,
      candidate_phone: null,
      updated_at: new Date().toISOString()
    })
    .eq("candidate_id", currentUser.id);

  if (!fallbackError) return;

  const { error: minimalError } = await settingsSupabase
    .from("candidate_profiles")
    .update({
      full_name: "Deleted Candidate",
      trade: "",
      location: "",
      bio: "",
      phone: "",
      profile_visible: false,
      profile_photo_url: null,
      resume_path: null,
      resume_url: null
    })
    .eq("id", currentUser.id);

  if (minimalError) throw minimalError;
}

async function anonymizeConversations() {
  const { error } = await settingsSupabase
    .from("conversations")
    .update({
      candidate_name: "Candidate profile deleted",
      candidate_role: "Candidate profile deleted",
      candidate_location: "",
      candidate_initials: "CD"
    })
    .eq("candidate_id", currentUser.id);

  if (error) return;
}

async function deleteCandidateMessages() {
  const { error } = await settingsSupabase
    .from("messages")
    .delete()
    .eq("candidate_id", currentUser.id);

  if (error) return;
}

async function anonymizeCandidateProfile() {
  const deletedAt = new Date().toISOString();
  const profilePayload = {
    full_name: "Deleted Candidate",
    trade: "",
    location: "",
    bio: "",
    experience: "",
    skills: "",
    certifications: "",
    availability: "",
    email: null,
    phone: "",
    contact_method: "",
    profile_visible: false,
    profile_photo_url: null,
    resume_url: null,
    resume_path: null,
    is_deleted: true,
    deleted_at: deletedAt
  };

  const { error } = await settingsSupabase
    .from("candidate_profiles")
    .update(profilePayload)
    .eq("id", currentUser.id);

  if (!error) return;

  const { error: fallbackError } = await settingsSupabase
    .from("candidate_profiles")
    .update({
      full_name: "Deleted Candidate",
      trade: "",
      location: "",
      bio: "",
      experience: "",
      skills: "",
      certifications: "",
      availability: "",
      email: null,
      phone: "",
      contact_method: "",
      profile_visible: false,
      profile_photo_url: null,
      resume_path: null,
      resume_url: null
    })
    .eq("id", currentUser.id);

  if (fallbackError) throw fallbackError;
}

function setupShellControls() {
  getEl("logoutBtn")?.addEventListener("click", handleLogout);
  getEl("accountMenuLogoutBtn")?.addEventListener("click", handleLogout);
  bindAccountMenu();
  bindMobileSidebar();
  bindHeaderSearch();
}

function hydrateHeader() {
  const fullName = currentProfile?.full_name || "Candidate";
  const firstName = fullName.split(" ")[0] || "Candidate";
  const email = currentProfile?.email || currentUser?.email || "No email on file";

  setText("topCandidateName", firstName);
  setText("accountMenuCandidateName", fullName);
  setText("accountMenuEmail", email);

  const avatar = getEl("topCandidateAvatar");
  if (!avatar) return;

  const initials = getInitials(fullName || email);
  const photoUrl = resolveCandidatePhotoUrl(currentProfile || {});
  avatar.innerHTML = photoUrl
    ? `<img src="${escapeHTML(photoUrl)}" alt="" loading="lazy" /><span class="avatar-fallback">${escapeHTML(initials)}</span>`
    : escapeHTML(initials);
}

function bindAccountMenu() {
  const button = getEl("candidateAccountButton");
  const menu = getEl("candidateAccountMenu");
  if (!button || !menu) return;

  const closeMenu = ({ restoreFocus = false } = {}) => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus) button.focus();
  };

  const openMenu = () => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    menu.querySelector("[role='menuitem']")?.focus();
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("click", (event) => {
    if (!menu.hidden && !event.target.closest(".top-account-menu-wrap")) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) closeMenu({ restoreFocus: true });
  });
}

function bindMobileSidebar() {
  const toggle = getEl("sidebarToggle");
  const backdrop = getEl("sidebarBackdrop");
  if (!toggle || !backdrop) return;

  const setSidebarOpen = (isOpen) => {
    document.body.classList.toggle("sidebar-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    backdrop.hidden = !isOpen;
  };

  toggle.addEventListener("click", () => setSidebarOpen(!document.body.classList.contains("sidebar-open")));
  backdrop.addEventListener("click", () => setSidebarOpen(false));

  document.querySelectorAll(".candidate-nav-link").forEach((link) => {
    link.addEventListener("click", () => setSidebarOpen(false));
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) setSidebarOpen(false);
  });
}

function bindHeaderSearch() {
  if (!settingsSearchForm || !settingsSearchInput) return;

  settingsSearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = settingsSearchInput.value.trim();
    const url = new URL("../public/find-jobs.html?role=candidate", window.location.href);
    if (query) url.searchParams.set("keyword", query);
    window.location.href = url.toString();
  });
}

function updateBadge(id, value) {
  const badge = getEl(id);
  if (!badge) return;

  const count = Number(value) || 0;
  badge.hidden = count <= 0;
  badge.textContent = count > 9 ? "9+" : String(count);
}

function resolveCandidatePhotoUrl(profile) {
  const rawUrl = profile.profile_photo_url || profile.profile_photo || profile.avatar_url || profile.photo_url || "";
  if (!rawUrl) return "";
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  return window.PlacelyAuth.getPublicImageUrl(settingsSupabase, "candidate-photos", rawUrl);
}

function getInitials(value) {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return "PT";
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

async function handleLogout() {
  try {
    await window.PlacelyAuth.clearAuthState();
  } catch {
    sessionStorage.removeItem("placelyAuthGuardRedirecting");
  }

  window.location.replace("candidate-login.html");
}

function revealSettings() {
  document.documentElement.classList.remove("settings-booting");
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener("DOMContentLoaded", initSettings);
