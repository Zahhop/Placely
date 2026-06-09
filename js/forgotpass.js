    const placelySupabase = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );

    const form = document.getElementById("forgotPasswordForm");
    const message = document.getElementById("message");

    form.addEventListener("submit", async function (e) {
      e.preventDefault();

      message.classList.remove("error");
      message.textContent = "Sending reset link...";

      const email = document.getElementById("email").value;

      const { error } = await placelySupabase.auth.resetPasswordForEmail(email, {
        redirectTo: "https://zahhop.github.io/Placely/public/reset-password.html"
      });

      if (error) {
        message.classList.add("error");
        message.textContent = error.message;
        return;
      }

      message.textContent = "Reset link sent. Check your email.";
    });