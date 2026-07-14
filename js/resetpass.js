const placelySupabase = window.PlacelyAuth.client();

const form = document.getElementById("resetPasswordForm");
const message = document.getElementById("message");
const submitBtn = form?.querySelector(".submit-btn");
const accountType = window.PlacelyAuth.getAccountTypeFromUrl();

let isSubmitting = false;
let hasRecoverySession = false;

window.PlacelyAuth.setupPasswordToggles();
initRecoverySession();

form.addEventListener("submit", async function (e) {
  e.preventDefault();

  if (isSubmitting) return;

  setSubmitting(true);
  setMessage("Updating password...", "");

  const newPassword = document.getElementById("newPassword").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (newPassword !== confirmPassword) {
    setMessage("Passwords do not match.", "error");
    setSubmitting(false);
    return;
  }

  if (newPassword.length < 6) {
    setMessage("Password must be at least 6 characters.", "error");
    setSubmitting(false);
    return;
  }

  try {
    if (!hasRecoverySession) {
      throw new Error("This reset link is invalid or expired. Please request a new reset email.");
    }

    const { error } = await placelySupabase.auth.updateUser({
      password: newPassword
    });

    if (error) throw error;

    setMessage("Password updated successfully. Redirecting to login...", "success");

    setTimeout(async function () {
      await window.PlacelyAuth.clearAuthState();
      window.location.href = window.PlacelyAuth.getLoginUrl(accountType);
    }, 1500);
  } catch (error) {
    setMessage(error.message || "Could not update password.", "error");
    setSubmitting(false);
  }
});

async function initRecoverySession() {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if (code) {
      const { error } = await placelySupabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
    }

    const {
      data: { session },
      error
    } = await placelySupabase.auth.getSession();

    if (error) throw error;

    hasRecoverySession = Boolean(session);

    if (!hasRecoverySession) {
      setMessage("This reset link is invalid or expired. Please request a new reset email.", "error");
      submitBtn.disabled = true;
    }
  } catch (error) {
    setMessage(error.message || "This reset link is invalid or expired.", "error");
    if (submitBtn) submitBtn.disabled = true;
  }
}

function setSubmitting(isBusy) {
  isSubmitting = isBusy;
  if (submitBtn && hasRecoverySession) {
    submitBtn.disabled = isBusy;
    submitBtn.textContent = isBusy ? "Updating..." : "Update Password";
  }
}

function setMessage(text, type) {
  message.textContent = text;
  message.className = `message ${type || ""}`.trim();
}
