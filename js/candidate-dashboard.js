  const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      window.location.href = "login.html";
      return;
    }

    document.getElementById("userEmail").textContent = user.email;
    document.getElementById("accountEmail").textContent = user.email;
  }

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "candidate-login.html";
  });

  loadUser();