const verifyForm = document.getElementById("verifyEmailForm");
const emailInput = document.getElementById("email");
const message = document.getElementById("message");
const resendBtn = document.getElementById("resendBtn");
const loginLink = document.getElementById("loginLink");
const backToLoginLink = document.getElementById("backToLoginLink");
const changeEmailLink = document.getElementById("changeEmailLink");

const accountType = window.PlacelyAuth.getAccountTypeFromUrl();
const pending = window.PlacelyAuth.getPendingVerification();

emailInput.value = pending.email || "";
loginLink.href = window.PlacelyAuth.getLoginUrl(accountType);
backToLoginLink.href = window.PlacelyAuth.getLoginUrl(accountType);
changeEmailLink.href = accountType === "employer"
  ? "../employers/employer-signup.html"
  : "../candidates/candidate-signup.html";

verifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  resendBtn.disabled = true;
  resendBtn.textContent = "Sending...";
  setMessage("Sending verification email.", "");

  try {
    await window.PlacelyAuth.resendVerification(emailInput.value.trim(), accountType);
    setMessage("Email sent. Check your inbox.", "success");
    startCountdown();
  } catch (error) {
    setMessage(error.message || "Could not send verification email.", "error");
    resendBtn.disabled = false;
    resendBtn.textContent = "Resend verification email";
  }
});

function startCountdown() {
  let remaining = 60;
  resendBtn.textContent = `Resend available in ${remaining}s`;

  const interval = setInterval(() => {
    remaining -= 1;
    resendBtn.textContent = `Resend available in ${remaining}s`;

    if (remaining <= 0) {
      clearInterval(interval);
      resendBtn.disabled = false;
      resendBtn.textContent = "Resend verification email";
    }
  }, 1000);
}

function setMessage(text, type) {
  message.textContent = text;
  message.className = `message ${type || ""}`.trim();
}
