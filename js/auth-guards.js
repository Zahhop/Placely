(function () {
  const DEFAULT_ROUTES = {
    candidate: {
      loginPath: "candidate-login.html",
      setupPath: "candidate-setup.html",
      dashboardPath: "candidate-dashboard.html",
      oppositeDashboardPath: "../employers/employer-dashboard.html"
    },
    employer: {
      loginPath: "employer-login.html",
      setupPath: "employer-setup.html",
      dashboardPath: "employer-dashboard.html",
      oppositeDashboardPath: "../candidates/candidate-dashboard.html"
    }
  };

  function redirectTo(path) {
    if (!path) return;

    const target = new URL(path, window.location.href).href;
    if (target === window.location.href) return;

    sessionStorage.setItem("placelyAuthGuardRedirecting", "1");
    window.location.replace(target);
  }

  function revealProtectedPage() {
    sessionStorage.removeItem("placelyAuthGuardRedirecting");
    document.documentElement.classList.remove("auth-booting", "dashboard-booting");
  }

  function getRoutes(accountType, options = {}) {
    const defaults = DEFAULT_ROUTES[accountType];

    return {
      loginPath: options.loginPath || defaults.loginPath,
      setupPath: options.setupPath || defaults.setupPath,
      dashboardPath: options.dashboardPath || defaults.dashboardPath,
      oppositeDashboardPath:
        options.oppositeDashboardPath ||
        options.candidateDashboardPath ||
        options.employerDashboardPath ||
        defaults.oppositeDashboardPath
    };
  }

  async function signOutAndRedirect(loginPath) {
    try {
      await window.PlacelyAuth.clearAuthState();
    } catch {
      sessionStorage.removeItem("placelyAuthGuardRedirecting");
    }

    redirectTo(loginPath);
  }

  async function loadAccountState(supabaseClient, accountType, user) {
    const profileTable = accountType === "employer" ? "employer_profiles" : "candidate_profiles";

    const account = await supabaseClient
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle();

    if (account.error && !window.PlacelyAuth.isMissingRowError(account.error)) {
      throw account.error;
    }

    const role = account.data?.role || null;

    const profile = await supabaseClient
      .from(profileTable)
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (profile.error && !window.PlacelyAuth.isMissingRowError(profile.error)) {
      throw profile.error;
    }

    return {
      role,
      profile: profile.data || null,
      onboardingComplete: window.PlacelyAuth.isProfileOnboardingComplete(accountType, profile.data)
    };
  }

  async function verifyAuthAccess(supabaseClient, options = {}) {
    const accountType = options.accountType === "employer" ? "employer" : "candidate";
    const routes = getRoutes(accountType, options);
    const requireOnboarding = options.requireOnboarding !== false;
    const requireIncompleteOnboarding = options.requireIncompleteOnboarding === true;

    if (!supabaseClient) {
      await signOutAndRedirect(routes.loginPath);
      return null;
    }

    const {
      data: { user },
      error
    } = await supabaseClient.auth.getUser();

    if (error || !user) {
      await signOutAndRedirect(routes.loginPath);
      return null;
    }

    if (!window.PlacelyAuth.isEmailConfirmed(user)) {
      window.PlacelyAuth.rememberPendingVerification(user.email, accountType);
      redirectTo(window.PlacelyAuth.getVerifyEmailUrl(accountType));
      return null;
    }

    let state;
    try {
      state = await loadAccountState(supabaseClient, accountType, user);
    } catch {
      await signOutAndRedirect(routes.loginPath);
      return null;
    }

    if (!state.role) {
      await signOutAndRedirect(routes.loginPath);
      return null;
    }

    if (state.role !== accountType) {
      if (state.role === "employer" || state.role === "candidate") {
        redirectTo(routes.oppositeDashboardPath);
        return null;
      }

      await signOutAndRedirect(routes.loginPath);
      return null;
    }

    if (!state.profile) {
      await signOutAndRedirect(routes.loginPath);
      return null;
    }

    if (requireIncompleteOnboarding && state.onboardingComplete) {
      redirectTo(routes.dashboardPath);
      return null;
    }

    if (requireOnboarding && !state.onboardingComplete) {
      redirectTo(routes.setupPath);
      return null;
    }

    if (accountType === "candidate") {
      window.PlacelyAuth.primeCandidateIdentityCache?.(user, state.profile);
      window.PlacelyAuth.applyCachedCandidateHeader?.();
    }

    revealProtectedPage();
    return {
      user,
      profile: state.profile,
      role: state.role,
      onboardingComplete: state.onboardingComplete
    };
  }

  async function verifyCandidateAccess(supabaseClient, options = {}) {
    const result = await verifyAuthAccess(supabaseClient, {
      ...options,
      accountType: "candidate"
    });

    return result?.user || null;
  }

  async function verifyEmployerAccess(supabaseClient, options = {}) {
    const result = await verifyAuthAccess(supabaseClient, {
      ...options,
      accountType: "employer"
    });

    return result?.user || null;
  }

  window.verifyAuthAccess = verifyAuthAccess;
  window.verifyCandidateAccess = verifyCandidateAccess;
  window.verifyEmployerAccess = verifyEmployerAccess;
})();
