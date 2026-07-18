const placelySupabase = window.PlacelyAuth.client();

const form = document.getElementById("employerSignupForm");
const errorMessage = document.getElementById("errorMessage");
const submitBtn = form?.querySelector(".signup-btn");

let isSubmitting = false;

window.PlacelyAuth.setupPasswordToggles();
const passwordValidator = window.PlacelyAuth.setupPasswordValidation({
  passwordId: "password",
  confirmId: "confirmPassword",
  requirementId: "passwordRequirement",
  matchId: "passwordMatch",
  submitButton: submitBtn
});

form.addEventListener("submit", async function (e) {
  e.preventDefault();

  if (isSubmitting) return;

  hideMessage();

  const companyName = value("companyName");
  const contactName = value("contactName");
  const email = value("email").toLowerCase();
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;
  const phone = value("phone");
  const industry = value("industry");

  if (!passwordValidator.isValid()) {
    showMessage(window.PlacelyAuth.passwordRequirementText, "error");
    return;
  }

  if (password !== confirmPassword) {
    showMessage("Passwords do not match.", "error");
    return;
  }

  setSubmitting(true);

  try {
    const { data, error } = await placelySupabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.PlacelyAuth.getAuthCallbackUrl("employer"),
        data: {
          account_type: "employer",
          company_name: companyName,
          contact_name: contactName,
          phone,
          industry
        }
      }
    });

    if (error) throw error;

    window.PlacelyAuth.rememberPendingVerification(email, "employer");

    if (data.session && data.user && window.PlacelyAuth.isEmailConfirmed(data.user)) {
      await window.PlacelyAuth.ensureAccountProfiles(data.user, "employer");
      window.location.href = await window.PlacelyAuth.getPostAuthDestination("employer");
      return;
    }

    window.location.href = window.PlacelyAuth.getVerifyEmailUrl("employer");
  } catch (error) {
    showMessage(error.message || "Could not create your account.", "error");
    setSubmitting(false);
  }
});

function value(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function setSubmitting(isBusy) {
  isSubmitting = isBusy;

  if (submitBtn) {
    submitBtn.disabled = isBusy || !passwordValidator.isValid();
    submitBtn.textContent = isBusy ? "Creating account..." : "Continue to Employer Setup";
  }
}

function showMessage(message, type) {
  if (!errorMessage) return;

  errorMessage.textContent = message;
  errorMessage.style.display = "block";
  errorMessage.style.color = type === "success" ? "#047857" : "";
}

function hideMessage() {
  if (!errorMessage) return;

  errorMessage.textContent = "";
  errorMessage.style.display = "none";
  errorMessage.style.color = "";
}
