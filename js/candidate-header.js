(function setupCandidateHeader() {
  const logoutBtn = document.getElementById("logoutBtn");

  if (
    !logoutBtn ||
    !window.supabase ||
    typeof SUPABASE_URL === "undefined" ||
    typeof SUPABASE_ANON_KEY === "undefined"
  ) {
    return;
  }

  const headerSupabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  logoutBtn.addEventListener("click", async () => {
    const { error } = await headerSupabase.auth.signOut();

    if (error) {
      console.error("Candidate logout error:", error);
    }

    const inPublicFolder = window.location.pathname.includes("/public/");
    window.location.href = inPublicFolder
      ? "../candidates/candidate-login.html"
      : "candidate-login.html";
  });
})();
