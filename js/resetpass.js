    const placelySupabase = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );

    const form = document.getElementById("resetPasswordForm");
    const message = document.getElementById("message");

    form.addEventListener("submit", async function (e) {
      e.preventDefault();

      message.classList.remove("error");
      message.textContent = "Updating password...";

      const newPassword = document.getElementById("newPassword").value;
      const confirmPassword = document.getElementById("confirmPassword").value;

      if (newPassword !== confirmPassword) {
        message.classList.add("error");
        message.textContent = "Passwords do not match.";
        return;
      }

      if (newPassword.length < 6) {
        message.classList.add("error");
        message.textContent = "Password must be at least 6 characters.";
        return;
      }

      const { error } = await placelySupabase.auth.updateUser({
        password: newPassword
      });

      if (error) {
        message.classList.add("error");
        message.textContent = error.message;
        return;
      }

      message.textContent = "Password updated successfully. Redirecting to login...";

      setTimeout(function () {
        window.location.href = "login.html";
      }, 1500);
    });