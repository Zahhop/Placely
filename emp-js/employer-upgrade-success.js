const upgradeSuccessSupabase = window.employerSupabase;

const statusText = document.getElementById("upgradeStatusText");
const findCandidatesBtn = document.getElementById("findCandidatesBtn");

document.addEventListener("DOMContentLoaded", initUpgradeSuccess);

async function initUpgradeSuccess() {
  const user = await verifyEmployerAccess(upgradeSuccessSupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });

  if (!user) return;

  await waitForCandidateAccess(user.id);
}

async function waitForCandidateAccess(userId) {
  const maxAttempts = 8;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const profile = await loadEmployerSubscription(userId);

    if (hasCandidateSearchAccess(profile)) {
      if (statusText) statusText.textContent = "Candidate Network access is active. Redirecting to candidate search...";
      if (findCandidatesBtn) findCandidatesBtn.classList.remove("hidden");

      window.setTimeout(() => {
        window.location.replace("find-candidates.html");
      }, 900);
      return;
    }

    if (statusText) {
      statusText.textContent =
        attempt < maxAttempts
          ? "Payment received. Waiting for subscription confirmation..."
          : "Payment is still being confirmed. You can return to the dashboard and try Candidate Network again in a moment.";
    }

    await delay(2000);
  }
}

async function loadEmployerSubscription(userId) {
  try {
    const { data, error } = await upgradeSuccessSupabase
      .from("employer_profiles")
      .select("candidate_access, subscription_status")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;
    return data || {};
  } catch {
    return {};
  }
}

function hasCandidateSearchAccess(profile) {
  return window.PlacelyAuth.hasCandidateSearchAccess(profile);
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
