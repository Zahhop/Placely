const placelySupabase = window.PlacelyAuth.client();

const form = document.getElementById("candidateSignupForm");
const errorMessage = document.getElementById("errorMessage");
const submitBtn = form?.querySelector(".signup-btn");

let isSubmitting = false;

window.PlacelyAuth.setupPasswordToggles();

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (isSubmitting) return;

  hideMessage();

  const firstName = value("firstName");
  const lastName = value("lastName");
  const phone = value("phone");
  const city = value("city");
  const postalCode = value("postalCode");
  const email = value("email").toLowerCase();
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

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
        emailRedirectTo: window.PlacelyAuth.getAuthCallbackUrl("candidate"),
        data: {
          account_type: "candidate",
          first_name: firstName,
          last_name: lastName,
          phone,
          city,
          postal_code: postalCode
        }
      }
    });

    if (error) throw error;

    localStorage.setItem(
      "candidate_basic_info",
      JSON.stringify({ firstName, lastName, phone, city, postalCode, email })
    );

    window.PlacelyAuth.rememberPendingVerification(email, "candidate");

    if (data.session && data.user && window.PlacelyAuth.isEmailConfirmed(data.user)) {
      await window.PlacelyAuth.ensureAccountProfiles(data.user, "candidate");
      window.location.href = await window.PlacelyAuth.getPostAuthDestination("candidate");
      return;
    }

    window.location.href = window.PlacelyAuth.getVerifyEmailUrl("candidate");
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
    submitBtn.disabled = isBusy;
    submitBtn.textContent = isBusy ? "Creating account..." : "Continue to Profile Setup";
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
