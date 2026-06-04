const placelySupabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  const form = document.getElementById("loginForm");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    // 1. Try login
    const { data, error } = await placelySupabase.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (error) {
      alert(error.message);
      return;
    }

    const userId = data.user.id;

    // 2. Get role from profiles
    const { data: profile, error: profileError } = await placelySupabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      alert("Profile not found");
      return;
    }

    // 3. ONLY allow employers
    if (profile.role !== "employer") {
      alert("This login is for employers only");
      await placelySupabase.auth.signOut(); // log them back out
      return;
    }

    // 4. Success → go to employer dashboard
    window.location.href = "employer-dashboard.html";
  });
