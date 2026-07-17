const settingsSupabase = window.PlacelyAuth.client();

let currentUser = null;
let currentProfile = null;

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
  currentUser = await verifyCandidateAccess(settingsSupabase, {
    loginPath: "candidate-login.html",
    employerDashboardPath: "../employers/employer-dashboard.html"
  });

  if (!currentUser) return;

  setupNotificationToggles();
  setupDeleteModal();
  await loadCandidateProfile();
}

async function loadCandidateProfile() {
  const { data, error } = await settingsSupabase
    .from("candidate_profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error("Settings profile load error:", error);
  }

  currentProfile = data || {};

  setText("settingsName", currentProfile.full_name || "Candidate");
  setText("settingsEmail", currentProfile.email || currentUser.email || "Not added");
  setText(
    "settingsVisibility",
    currentProfile.profile_visible === false ? "Hidden from employers" : "Visible to employers"
  );
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
    window.location.href = "candidate-login.html";
  } catch (error) {
    console.error("Delete profile error:", error);
    setModalMessage(error.message || "Could not delete your profile. Please try again.");

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
    console.warn("delete-candidate-account function unavailable; using client fallback.", error);
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

  console.warn("Candidate deleted status unavailable; preserving applications with withdrawn status.", error);

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

  console.warn("Profile email may be required; hiding profile with minimal anonymization.", fallbackError);

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

  if (error) {
    console.warn("Could not anonymize conversations. This may require an Edge Function.", error);
  }
}

async function deleteCandidateMessages() {
  const { error } = await settingsSupabase
    .from("messages")
    .delete()
    .eq("candidate_id", currentUser.id);

  if (error) {
    console.warn("Could not delete candidate messages. This may require an Edge Function.", error);
  }
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

  console.warn("Deletion marker columns unavailable; anonymizing existing candidate profile fields only.", error);

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

document.addEventListener("DOMContentLoaded", initSettings);
