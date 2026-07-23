(function setupCandidateHeader() {
  const logoutBtn = document.getElementById("logoutBtn");

  if (
    !logoutBtn ||
    !window.PlacelyAuth
  ) {
    return;
  }

  logoutBtn.addEventListener("click", async () => {
    try {
      await window.PlacelyAuth.clearAuthState();
    } catch (error) {
      console.error("Candidate logout error:", error);
    }

    const inPublicFolder = window.location.pathname.includes("/public/");
    window.location.replace(inPublicFolder
      ? "../candidates/candidate-login.html"
      : "candidate-login.html");
  });
})();
