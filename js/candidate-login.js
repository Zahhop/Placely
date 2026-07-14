let placelySupabase = window.PlacelyAuth.client();

const form = document.getElementById("candidateLoginForm");
const errorMessage = document.getElementById("errorMessage");
const submitBtn = form?.querySelector(".login-btn");
const resendBtn = document.getElementById("resendVerificationBtn");
const keepSignedInInput = document.getElementById("keepSignedIn");

let isSubmitting = false;

window.PlacelyAuth.setupPasswordToggles();

function showError(message) {
  showMessage(message, "error");
}

function showSuccess(message) {
  showMessage(message, "success");
}

document.addEventListener("DOMContentLoaded", () => {
  const deletionMessage = sessionStorage.getItem("placelyCandidateDeletionMessage");

  if (deletionMessage) {
    sessionStorage.removeItem("placelyCandidateDeletionMessage");
    showSuccess(deletionMessage);
  }
});

form.addEventListener("submit", async function (e) {
  e.preventDefault();

  if (isSubmitting) return;

  hideMessage();
  setSubmitting(true);

  const email = document.getElementById("email").value.trim().toLowerCase();
  const password = document.getElementById("password").value;

  placelySupabase = window.PlacelyAuth.setPersistence(keepSignedInInput?.checked !== false);

  try {
    const { data, error } = await placelySupabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      if (window.PlacelyAuth.isUnconfirmedError(error)) {
        window.PlacelyAuth.rememberPendingVerification(email, "candidate");
        showUnverifiedState(email);
        return;
      }

      throw error;
    }

    if (!data.session || !data.user) {
      throw new Error("Could not start a valid session.");
    }

    if (!window.PlacelyAuth.isEmailConfirmed(data.user)) {
      window.PlacelyAuth.rememberPendingVerification(email, "candidate");
      showUnverifiedState(email);
      return;
    }

    const accountType = await window.PlacelyAuth.detectAccountType(data.user);

    if (accountType !== "candidate") {
      await window.PlacelyAuth.clearAuthState();
      showError("This login is for candidate accounts only.");
      return;
    }

    await window.PlacelyAuth.ensureAccountProfiles(data.user, "candidate");
    window.location.href = await window.PlacelyAuth.getPostAuthDestination("candidate");
  } catch (error) {
    showError(error.message || "Login failed.");
  } finally {
    setSubmitting(false);
  }
});

resendBtn?.addEventListener("click", async () => {
  const email = document.getElementById("email").value.trim().toLowerCase() ||
    window.PlacelyAuth.getPendingVerification().email;

  await resendFromLogin(email, "candidate");
});

async function resendFromLogin(email, accountType) {
  if (!resendBtn) return;

  resendBtn.disabled = true;
  resendBtn.textContent = "Sending...";

  try {
    await window.PlacelyAuth.resendVerification(email, accountType);
    showSuccess("Email sent. Check your inbox.");
    startResendCountdown(resendBtn);
  } catch (error) {
    showError(error.message || "Could not resend verification email.");
    resendBtn.disabled = false;
    resendBtn.textContent = "Resend verification email";
  }
}

function showUnverifiedState(email) {
  showError("Verify your email first, then log in.");
  if (resendBtn) {
    resendBtn.hidden = false;
    resendBtn.disabled = false;
    resendBtn.textContent = "Resend verification email";
  }
  window.PlacelyAuth.rememberPendingVerification(email, "candidate");
}

function startResendCountdown(button) {
  let remaining = 60;
  button.textContent = `Resend available in ${remaining}s`;

  const interval = setInterval(() => {
    remaining -= 1;
    button.textContent = `Resend available in ${remaining}s`;

    if (remaining <= 0) {
      clearInterval(interval);
      button.disabled = false;
      button.textContent = "Resend verification email";
    }
  }, 1000);
}

function setSubmitting(isBusy) {
  isSubmitting = isBusy;
  if (submitBtn) {
    submitBtn.disabled = isBusy;
    submitBtn.textContent = isBusy ? "Logging in..." : "Login to Candidate Account";
  }
}

function showMessage(message, type) {
  if (!errorMessage) {
    alert(message);
    return;
  }

  errorMessage.textContent = message;
  errorMessage.style.display = "block";
  errorMessage.style.color = type === "success" ? "#047857" : "";
}

function hideMessage() {
  if (!errorMessage) return;

  errorMessage.textContent = "";
  errorMessage.style.display = "none";
  errorMessage.style.color = "";
  if (resendBtn) resendBtn.hidden = true;
}
