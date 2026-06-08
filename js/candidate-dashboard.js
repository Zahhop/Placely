  const candidateSupabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  async function loadUser() {
    const { data: { user } } = await candidateSupabase.auth.getUser();

    if (!user) {
      window.location.href = "login.html";
      return;
    }

    
  const { data: profile, error } = await candidateSupabase
  .from("candidate_profiles")
  .select("*")
  .eq("id", user.id)
  .single();

if (error) {
  console.error("Error loading candidate profile:", error);
  return;
}

    document.getElementById("full_name").textContent = profile.full_name || "Candidate";

    document.getElementById("sidebar_trade").textContent = profile.trade || "Add your trade";
    document.getElementById("sidebar_location").textContent = profile.location || "Add location";
    document.getElementById("sidebar_email").textContent = profile.email || user.email || "Not available";

    document.getElementById("trade").textContent = profile.trade || "";
    document.getElementById("experience").textContent = profile.experience || "";
    document.getElementById("availability").textContent = profile.availability || "";
    document.getElementById("phone").textContent = profile.phone || "";
    document.getElementById("email").textContent = profile.email || "";
    document.getElementById("contact_method").textContent = profile.contact_method || "";
    document.getElementById("resume_status").textContent = profile.resume_url ? "Uploaded" : "Not uploaded";
    document.getElementById("profile_photo_url").src = profile.profile_photo_url || "https://via.placeholder.com/120";
  }

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "candidate-login.html";
  });

  loadUser();