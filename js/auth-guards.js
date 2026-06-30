async function verifyCandidateAccess(supabaseClient, options = {}) {
  const loginPath = options.loginPath || "candidate-login.html";
  const employerDashboardPath = options.employerDashboardPath || "../employers/employer-dashboard.html";

  const { data: { user }, error } = await supabaseClient.auth.getUser();

  if (error || !user) {
    window.location.href = loginPath;
    return null;
  }

  const { data: candidateProfile, error: candidateError } = await supabaseClient
    .from("candidate_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!candidateError && candidateProfile) {
    return user;
  }

  const { data: employerProfile } = await supabaseClient
    .from("employer_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (employerProfile) {
    window.location.href = employerDashboardPath;
    return null;
  }

  await supabaseClient.auth.signOut();
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

  const { data: employerProfile, error: employerError } = await supabaseClient
    .from("employer_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!employerError && employerProfile) {
    return user;
  }

  const { data: candidateProfile } = await supabaseClient
    .from("candidate_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (candidateProfile) {
    window.location.href = candidateDashboardPath;
    return null;
  }

  await supabaseClient.auth.signOut();
  window.location.href = loginPath;
  return null;
}

window.verifyCandidateAccess = verifyCandidateAccess;
window.verifyEmployerAccess = verifyEmployerAccess;
