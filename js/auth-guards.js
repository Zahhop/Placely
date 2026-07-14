async function verifyCandidateAccess(supabaseClient, options = {}) {
  const loginPath = options.loginPath || "candidate-login.html";
  const employerDashboardPath = options.employerDashboardPath || "../employers/employer-dashboard.html";

  const { data: { user }, error } = await supabaseClient.auth.getUser();

  if (error || !user) {
    window.location.href = loginPath;
    return null;
  }

  if (!window.PlacelyAuth.isEmailConfirmed(user)) {
    window.PlacelyAuth.rememberPendingVerification(user.email, "candidate");
    window.location.href = window.PlacelyAuth.getVerifyEmailUrl("candidate");
    return null;
  }

  const accountType = await window.PlacelyAuth.detectAccountType(user);

  if (accountType === "candidate") {
    return user;
  }

  if (accountType === "employer") {
    window.location.href = employerDashboardPath;
    return null;
  }

  await window.PlacelyAuth.clearAuthState();
  window.location.href = loginPath;
  return null;
}

async function verifyEmployerAccess(supabaseClient, options = {}) {
  const loginPath = options.loginPath || "employer-login.html";
  const candidateDashboardPath = options.candidateDashboardPath || "../candidates/candidate-dashboard.html";

  const { data: { user }, error } = await supabaseClient.auth.getUser();

  if (error || !user) {
    window.location.href = loginPath;
    return null;
  }

  if (!window.PlacelyAuth.isEmailConfirmed(user)) {
    window.PlacelyAuth.rememberPendingVerification(user.email, "employer");
    window.location.href = window.PlacelyAuth.getVerifyEmailUrl("employer");
    return null;
  }

  const accountType = await window.PlacelyAuth.detectAccountType(user);

  if (accountType === "employer") {
    return user;
  }

  if (accountType === "candidate") {
    window.location.href = candidateDashboardPath;
    return null;
  }

  await window.PlacelyAuth.clearAuthState();
  window.location.href = loginPath;
  return null;
}

window.verifyCandidateAccess = verifyCandidateAccess;
window.verifyEmployerAccess = verifyEmployerAccess;
