const placelySupabase = window.PlacelyAuth.client();

const form = document.getElementById("forgotPasswordForm");
const message = document.getElementById("message");
const accountTypeInput = document.getElementById("accountType");
const submitBtn = form?.querySelector(".submit-btn");

const accountType = window.PlacelyAuth.getAccountTypeFromUrl();
accountTypeInput.value = accountType;

let isSubmitting = false;

form.addEventListener("submit", async function (e) {
  e.preventDefault();

  if (isSubmitting) return;

  setSubmitting(true);
  setMessage("Sending reset link...", "");

  const email = document.getElementById("email").value.trim().toLowerCase();

  try {
    const { error } = await placelySupabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.PlacelyAuth.getResetRedirectUrl(accountType)
    });

    if (error) throw error;

    setMessage("If an account exists for that email, a reset link has been sent.", "success");
    form.reset();
  } catch (error) {
    setMessage(error.message || "Could not send reset link.", "error");
  } finally {
    setSubmitting(false);
  }
});

function setSubmitting(isBusy) {
  isSubmitting = isBusy;
  if (submitBtn) {
    submitBtn.disabled = isBusy;
    submitBtn.textContent = isBusy ? "Sending..." : "Send Reset Link";
  }
}

function setMessage(text, type) {
  message.textContent = text;
  message.className = `message ${type || ""}`.trim();
}
