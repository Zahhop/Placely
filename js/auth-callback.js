const callbackMessage = document.getElementById("message");

handleAuthCallback();

async function handleAuthCallback() {
  const accountType = window.PlacelyAuth.getAccountTypeFromUrl();
  const supabase = window.PlacelyAuth.client();

  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
    }

    setMessage("Verification complete. Routing your account...");
    await window.PlacelyAuth.routeAuthenticatedUser(accountType);
  } catch (error) {
    console.error("Auth callback failed:", error);
    setMessage(
      "This verification link is invalid or expired. Please request a new verification email.",
      "error"
    );

    const pending = window.PlacelyAuth.getPendingVerification();
    if (pending.email) {
      setTimeout(() => {
        window.location.href = window.PlacelyAuth.getVerifyEmailUrl(accountType);
      }, 1800);
    }
  }
}

function setMessage(text, type) {
  if (!callbackMessage) return;
  callbackMessage.textContent = text;
  callbackMessage.className = `message ${type || ""}`.trim();
}
