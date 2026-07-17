(function () {
  const resendCooldownMs = 60_000;
  const resendTimestamps = new Map();

  function client() {
    if (!window.placelySupabase && window.createPlacelySupabaseClient) {
      window.placelySupabase = window.createPlacelySupabaseClient();
      window.employerSupabase = window.placelySupabase;
    }

    return window.placelySupabase;
  }

  function setPersistence(keepSignedIn) {
    const value = keepSignedIn ? "local" : "session";
    localStorage.setItem(window.PLACELY_AUTH_PERSISTENCE_KEY, value);

    if (keepSignedIn) {
      sessionStorage.removeItem(window.PLACELY_AUTH_STORAGE_KEY);
    } else {
      localStorage.removeItem(window.PLACELY_AUTH_STORAGE_KEY);
    }

    if (window.placelySupabase?.auth) {
      window.placelySupabase.auth.stopAutoRefresh?.();
    }

    window.placelySupabase = window.createPlacelySupabaseClient();
    window.employerSupabase = window.placelySupabase;
    return window.placelySupabase;
  }

  function getAppBaseUrl() {
    const origin = window.location.origin;
    const path = window.location.pathname;
    const appPath = path.includes("/Placely/") || path.endsWith("/Placely")
      ? "/Placely"
      : "";

    return `${origin}${appPath}`;
  }

  function getAuthCallbackUrl(accountType) {
    const folder = accountType === "employer" ? "employers" : "candidates";
    return `${getAppBaseUrl()}/${folder}/auth-callback.html?type=${encodeURIComponent(accountType)}`;
  }

  function getResetRedirectUrl(accountType) {
    return `${getAppBaseUrl()}/public/reset-password.html?type=${encodeURIComponent(accountType || "candidate")}`;
  }

  function getVerifyEmailUrl(accountType) {
    return `${getAppBaseUrl()}/public/verify-email.html?type=${encodeURIComponent(accountType || "candidate")}`;
  }

  function getLoginUrl(accountType) {
    return accountType === "employer"
      ? `${getAppBaseUrl()}/employers/employer-login.html`
      : `${getAppBaseUrl()}/candidates/candidate-login.html`;
  }

  function isEmailConfirmed(user) {
    return Boolean(user?.email_confirmed_at || user?.confirmed_at);
  }

  function rememberPendingVerification(email, accountType) {
    sessionStorage.setItem("placelyPendingVerificationEmail", email || "");
    sessionStorage.setItem("placelyPendingVerificationType", accountType || "candidate");
  }

  function getPendingVerification() {
    return {
      email: sessionStorage.getItem("placelyPendingVerificationEmail") || "",
      accountType: sessionStorage.getItem("placelyPendingVerificationType") || getAccountTypeFromUrl()
    };
  }

  function clearPendingVerification() {
    sessionStorage.removeItem("placelyPendingVerificationEmail");
    sessionStorage.removeItem("placelyPendingVerificationType");
  }

  function getAccountTypeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const type = params.get("type");

    if (type === "employer" || window.location.pathname.includes("/employers/")) {
      return "employer";
    }

    return "candidate";
  }

  function isUnconfirmedError(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("email not confirmed") ||
      message.includes("not confirmed") ||
      message.includes("confirm your email");
  }

  async function resendVerification(email, accountType) {
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail) {
      throw new Error("Enter your email address first.");
    }

    const key = `${accountType}:${normalizedEmail}`;
    const now = Date.now();
    const lastSent = resendTimestamps.get(key) || Number(sessionStorage.getItem(`placelyResend:${key}`) || 0);
    const remainingMs = resendCooldownMs - (now - lastSent);

    if (remainingMs > 0) {
      const seconds = Math.ceil(remainingMs / 1000);
      throw new Error(`Please wait ${seconds} seconds before resending.`);
    }

    const { error } = await client().auth.resend({
      type: "signup",
      email: normalizedEmail,
      options: {
        emailRedirectTo: getAuthCallbackUrl(accountType)
      }
    });

    if (error) throw error;

    resendTimestamps.set(key, now);
    sessionStorage.setItem(`placelyResend:${key}`, String(now));
    rememberPendingVerification(normalizedEmail, accountType);
  }

  async function ensureAccountProfiles(user, accountType) {
    const supabase = client();
    const metadata = user.user_metadata || {};
    const email = user.email || metadata.email || "";

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile) {
      const { error } = await supabase.from("profiles").insert({
        id: user.id,
        email,
        role: accountType
      });

      if (error) throw error;
    }

    if (accountType === "candidate") {
      const { data: candidateProfile } = await supabase
        .from("candidate_profiles")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

      if (!candidateProfile) {
        const fullName = [metadata.first_name, metadata.last_name].filter(Boolean).join(" ").trim();
        const location = [metadata.city, metadata.postal_code].filter(Boolean).join(", ");

        const { error } = await supabase.from("candidate_profiles").insert({
          id: user.id,
          full_name: fullName,
          email,
          phone: metadata.phone || "",
          location
        });

        if (error) throw error;
      }
    }

    if (accountType === "employer") {
      const { data: employerProfile } = await supabase
        .from("employer_profiles")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

      if (!employerProfile) {
        const { error } = await supabase.from("employer_profiles").insert({
          id: user.id,
          company_name: metadata.company_name || "",
          company_email: email,
          contact_name: metadata.contact_name || "",
          phone: metadata.phone || "",
          industry: metadata.industry || "",
          hiring_needs: ""
        });

        if (error) throw error;
      }
    }
  }

  async function detectAccountType(user) {
    const supabase = client();

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.role === "candidate" || profile?.role === "employer") {
      return profile.role;
    }

    const { data: candidateProfile } = await supabase
      .from("candidate_profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (candidateProfile) return "candidate";

    const { data: employerProfile } = await supabase
      .from("employer_profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (employerProfile) return "employer";

    const metadataType = user.user_metadata?.account_type;
    return metadataType === "employer" ? "employer" : "candidate";
  }

  async function getPostAuthDestination(accountType) {
    const supabase = client();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) return getLoginUrl(accountType);

    if (accountType === "employer") {
      const { data: profile } = await supabase
        .from("employer_profiles")
        .select("company_location, company_description, main_hiring_industry")
        .eq("id", user.id)
        .maybeSingle();

      return profile?.company_location || profile?.company_description || profile?.main_hiring_industry
        ? `${getAppBaseUrl()}/employers/employer-dashboard.html`
        : `${getAppBaseUrl()}/employers/employer-setup.html`;
    }

    const { data: profile } = await supabase
      .from("candidate_profiles")
      .select("trade, experience, bio")
      .eq("id", user.id)
      .maybeSingle();

    return profile?.trade || profile?.experience || profile?.bio
      ? `${getAppBaseUrl()}/candidates/candidate-dashboard.html`
      : `${getAppBaseUrl()}/candidates/candidate-setup.html`;
  }

  async function routeAuthenticatedUser(accountTypeHint) {
    const supabase = client();
    const {
      data: { user },
      error
    } = await supabase.auth.getUser();

    if (error || !user) {
      throw new Error("This sign-in link is invalid or has expired.");
    }

    if (!isEmailConfirmed(user)) {
      rememberPendingVerification(user.email, accountTypeHint || user.user_metadata?.account_type || "candidate");
      window.location.href = getVerifyEmailUrl(accountTypeHint || "candidate");
      return;
    }

    const detectedType = await detectAccountType(user);
    const accountType = detectedType || accountTypeHint || "candidate";

    await ensureAccountProfiles(user, accountType);
    clearPendingVerification();

    window.location.href = await getPostAuthDestination(accountType);
  }

  async function clearAuthState() {
    const supabase = client();
    await supabase.auth.signOut();
    sessionStorage.removeItem(window.PLACELY_AUTH_STORAGE_KEY);
    localStorage.removeItem(window.PLACELY_AUTH_STORAGE_KEY);
    clearPendingVerification();
  }

  function setupPasswordToggles(root = document) {
    root.querySelectorAll("[data-password-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = document.getElementById(button.dataset.passwordToggle);

        if (!input) return;

        const show = input.type === "password";
        input.type = show ? "text" : "password";
        button.textContent = show ? "Hide" : "Show";
      });
    });
  }

  const passwordRequirementText = "Use at least 10 characters, including a letter and a number.";

  function validatePasswordRules(password) {
    const value = String(password || "");

    return {
      valid: value.length >= 10 && /[A-Za-z]/.test(value) && /\d/.test(value),
      hasValue: value.length > 0
    };
  }

  function setupPasswordValidation(options = {}) {
    const root = options.root || document;
    const passwordInput = root.getElementById?.(options.passwordId) || document.getElementById(options.passwordId);
    const confirmInput = options.confirmId
      ? (root.getElementById?.(options.confirmId) || document.getElementById(options.confirmId))
      : null;
    const submitButton = options.submitButton || null;
    const requirement = options.requirementId
      ? (root.getElementById?.(options.requirementId) || document.getElementById(options.requirementId))
      : null;
    const matchMessage = options.matchId
      ? (root.getElementById?.(options.matchId) || document.getElementById(options.matchId))
      : null;

    if (!passwordInput) {
      return {
        isValid: () => true,
        update: () => true
      };
    }

    passwordInput.minLength = 10;
    if (confirmInput) confirmInput.minLength = 10;
    if (requirement) requirement.textContent = passwordRequirementText;

    function update() {
      const password = passwordInput.value || "";
      const confirmPassword = confirmInput?.value || "";
      const rules = validatePasswordRules(password);
      const matches = !confirmInput || !confirmPassword || password === confirmPassword;
      const completeMatch = !confirmInput || (Boolean(confirmPassword) && password === confirmPassword);
      const valid = rules.valid && completeMatch;

      passwordInput.setCustomValidity(rules.hasValue && !rules.valid ? passwordRequirementText : "");
      if (confirmInput) {
        confirmInput.setCustomValidity(confirmPassword && !matches ? "Passwords do not match." : "");
      }

      if (requirement) {
        requirement.classList.toggle("is-valid", rules.valid);
        requirement.classList.toggle("is-invalid", rules.hasValue && !rules.valid);
      }

      if (matchMessage && confirmInput) {
        matchMessage.textContent = confirmPassword
          ? (matches ? "Passwords match." : "Passwords do not match.")
          : "";
        matchMessage.classList.toggle("is-valid", Boolean(confirmPassword) && matches);
        matchMessage.classList.toggle("is-invalid", Boolean(confirmPassword) && !matches);
      }

      if (submitButton && !options.skipSubmitToggle) {
        const canSubmit = typeof options.canSubmit === "function" ? options.canSubmit() : true;
        submitButton.disabled = !valid || !canSubmit;
      }

      return valid;
    }

    passwordInput.addEventListener("input", update);
    confirmInput?.addEventListener("input", update);
    update();

    return {
      isValid: update,
      requirementText: passwordRequirementText
    };
  }

  window.PlacelyAuth = {
    client,
    setPersistence,
    getAuthCallbackUrl,
    getResetRedirectUrl,
    getVerifyEmailUrl,
    getLoginUrl,
    getAccountTypeFromUrl,
    isEmailConfirmed,
    isUnconfirmedError,
    rememberPendingVerification,
    getPendingVerification,
    clearPendingVerification,
    resendVerification,
    ensureAccountProfiles,
    detectAccountType,
    getPostAuthDestination,
    routeAuthenticatedUser,
    clearAuthState,
    setupPasswordToggles,
    validatePasswordRules,
    setupPasswordValidation,
    passwordRequirementText
  };
})();
