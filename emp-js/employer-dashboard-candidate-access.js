const dashboardAccessSupabase = window.employerSupabase;

if (typeof window.loadCandidatePreviewPool === "function") {
  window.loadCandidatePreviewPool = async function () {
    return [];
  };
}

document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click", guardLockedCandidateLinks, true);
});

async function startCandidateCheckout() {
  if (!dashboardAccessSupabase) {
    console.error("Employer Supabase client was not initialized.");
    showDashboardAccessToast("Could not start checkout. Please refresh and try again.");
    return;
  }

  const cta = document.getElementById("candidateAccessCta");
  const originalText = cta?.textContent || "GET ACCESS";

  try {
    if (cta) {
      cta.disabled = true;
      cta.classList.add("is-loading");
      cta.textContent = "Opening checkout...";
    }

    const { data, error } = await dashboardAccessSupabase.functions.invoke(
      "create-candidate-checkout",
      {
        body: {
          origin: window.location.origin,
          appPath: getPlacelyAppPath()
        }
      }
    );

    if (error) {
      console.error("Checkout function error:", error);
      const responseBody = await readFunctionErrorBody(error);
      if (responseBody) console.error("Checkout function response body:", responseBody);
      throw new Error(responseBody?.error || error.message || "Unable to start checkout.");
    }

    if (!data?.url) {
      throw new Error(data?.error || "Unable to start checkout.");
    }

    window.location.href = data.url;
  } catch (error) {
    console.error("Candidate checkout failed:", error);
    showDashboardAccessToast(error instanceof Error ? error.message : "Unable to start checkout.");

    if (cta) {
      cta.disabled = false;
      cta.classList.remove("is-loading");
      cta.textContent = originalText;
    }
  }
}

window.startCandidateCheckout = startCandidateCheckout;

async function readFunctionErrorBody(error) {
  try {
    if (!error?.context) return null;
    return await error.context.json();
  } catch {
    return null;
  }
}

function getPlacelyAppPath() {
  return window.location.pathname.startsWith("/Placely/") ? "/Placely" : "";
}

function handleLockedCandidateAction(event) {
  event.preventDefault();
  scrollToDashboardUpgradePanel();
  showDashboardAccessToast("Get Pro access before opening candidate search.");
}

function guardLockedCandidateLinks(event) {
  if (window.currentEmployerCandidateAccess === true) return;

  const link = event.target.closest?.('a[href="find-candidates.html"], a[href="saved-talent.html"], [data-plan-gated="candidate-network"]');
  if (!link) return;

  event.preventDefault();
  scrollToDashboardUpgradePanel();
  showDashboardAccessToast("Get Pro access before opening candidate search.");
}

function scrollToDashboardUpgradePanel() {
  const panel = document.getElementById("freeUpgradePanel")
    || document.getElementById("sidebarPlanCard")
    || document.getElementById("candidate-access");

  panel?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function showDashboardAccessToast(message) {
  const toast = document.getElementById("toast");

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
