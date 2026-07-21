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

  function isMissingRowError(error) {
    return error?.code === "PGRST116" || /no rows/i.test(error?.message || "");
  }

  function hasValue(value) {
    return String(value || "").trim().length > 0;
  }

  const hiringRoleOptions = [
    "Electrician",
    "Electrical Apprentice",
    "HVAC Technician",
    "HVAC Apprentice",
    "Plumber",
    "Plumbing Apprentice",
    "Carpenter",
    "Welder",
    "Millwright",
    "Heavy Equipment Operator",
    "General Labourer",
    "Construction Labourer",
    "Project Manager",
    "Site Supervisor",
    "Estimator",
    "Other"
  ];

  const hiringTimelineOptions = [
    { value: "immediately", label: "Immediately" },
    { value: "within_2_weeks", label: "Within 2 weeks" },
    { value: "within_1_month", label: "Within 1 month" },
    { value: "within_3_months", label: "Within 3 months" },
    { value: "always_hiring", label: "Always hiring" }
  ];

  function normalizeHiringTimeline(value) {
    const text = String(value || "")
      .trim()
      .toLowerCase()
      .replaceAll("&", "and")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");

    if (!text) return "";
    if (text === "immediately" || text.includes("asap") || text.includes("right away")) return "immediately";
    if (text.includes("2 week") || text.includes("two week") || text.includes("1 week") || text.includes("one week")) return "within_2_weeks";
    if (text.includes("1 month") || text.includes("one month") || text === "soon") return "within_1_month";
    if (text.includes("3 month") || text.includes("three month")) return "within_3_months";
    if (text.includes("always") || text.includes("ongoing") || text.includes("open")) return "always_hiring";
    return "";
  }

  function getHiringTimelineLabel(value) {
    const normalized = normalizeHiringTimeline(value);
    return hiringTimelineOptions.find((option) => option.value === normalized)?.label || String(value || "");
  }

  function parseHiringRoles(value) {
    if (Array.isArray(value)) {
      return value.map((role) => String(role || "").trim()).filter(Boolean);
    }

    if (value && typeof value === "object") {
      return Object.values(value).map((role) => String(role || "").trim()).filter(Boolean);
    }

    const raw = String(value || "").trim();
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parseHiringRoles(parsed);
    } catch {}

    return raw.split(/[,;\n]/).map((role) => role.trim()).filter(Boolean);
  }

  function getEmployerHiringRoles(profile = {}) {
    const roles = parseHiringRoles(profile.hiring_roles);
    const legacyRoles = roles.length ? roles : parseHiringRoles(profile.hiring_needs);
    const other = String(profile.hiring_role_other || "").trim();
    return [...new Set([...legacyRoles, other].filter(Boolean))];
  }

  function hasStructuredCompensation(profile = {}) {
    const type = normalizeCompensationType(profile.compensation_type);
    const min = Number(profile.compensation_min);
    const max = Number(profile.compensation_max);

    return Boolean(type) &&
      Number.isFinite(min) &&
      Number.isFinite(max) &&
      min > 0 &&
      max >= min;
  }

  function normalizeCompensationType(value) {
    const normalized = String(value || "").toLowerCase().trim();
    if (normalized === "hourly" || normalized === "hour" || normalized === "per_hour") return "hourly";
    if (normalized === "annual" || normalized === "salary" || normalized === "annual_salary" || normalized === "yearly") return "annual";
    return "";
  }

  function parseCompensationAmount(value) {
    const raw = String(value ?? "").trim();
    if (!raw || !/^\d+(\.\d{1,2})?$/.test(raw)) return null;

    const amount = Number(raw);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  function validateCompensationValues(type, minimum, maximum) {
    const normalizedType = normalizeCompensationType(type);
    const min = parseCompensationAmount(minimum);
    const max = parseCompensationAmount(maximum);

    if (!normalizedType) {
      return {
        valid: false,
        message: "Choose hourly or annual salary.",
        type: "",
        minimum: null,
        maximum: null
      };
    }

    if (min === null || max === null) {
      return {
        valid: false,
        message: "Enter valid positive numbers for minimum and maximum compensation.",
        type: normalizedType,
        minimum: min,
        maximum: max
      };
    }

    if (max < min) {
      return {
        valid: false,
        message: "Maximum compensation must be greater than or equal to minimum compensation.",
        type: normalizedType,
        minimum: min,
        maximum: max
      };
    }

    return {
      valid: true,
      message: "",
      type: normalizedType,
      minimum: min,
      maximum: max
    };
  }

  function buildCompensationPayload(type, minimum, maximum) {
    const result = validateCompensationValues(type, minimum, maximum);

    if (!result.valid) {
      return {
        valid: false,
        message: result.message,
        payload: null
      };
    }

    const payRange = formatCompensation(result.type, result.minimum, result.maximum);
    return {
      valid: true,
      message: "",
      payload: {
        compensation_type: result.type,
        compensation_min: result.minimum,
        compensation_max: result.maximum,
        pay_range: payRange
      }
    };
  }

  function formatCompensation(type, minimum, maximum, legacyValue = "") {
    const normalizedType = normalizeCompensationType(type);
    const min = Number(minimum);
    const max = Number(maximum);

    if (normalizedType &&
      Number.isFinite(min) &&
      Number.isFinite(max) &&
      min > 0 &&
      max >= min) {
      const formatter = new Intl.NumberFormat("en-US", {
        maximumFractionDigits: normalizedType === "hourly" ? 2 : 0
      });
      const suffix = normalizedType === "hourly" ? "/hour" : "/year";
      return `$${formatter.format(min)}–$${formatter.format(max)}${suffix}`;
    }

    return String(legacyValue || "").trim();
  }

  function formatCompensationFromRecord(record = {}, fallback = "Pay not listed") {
    return formatCompensation(
      record.compensation_type,
      record.compensation_min,
      record.compensation_max,
      record.pay_range
    ) || fallback;
  }

  const imageUploadConfig = {
    candidatePhoto: {
      bucket: "candidate_photos",
      maxBytes: 5 * 1024 * 1024,
      sizeMessage: "Profile photos must be smaller than 5 MB.",
      typeMessage: "Please upload a JPG, PNG, or WebP image.",
      baseName: "profile"
    },
    employerLogo: {
      bucket: "employer-logos",
      maxBytes: 2 * 1024 * 1024,
      sizeMessage: "Company logos must be smaller than 2 MB.",
      typeMessage: "Please upload a JPG, PNG, or WebP image.",
      baseName: "logo"
    }
  };

  const imageMimeExtensions = {
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"]
  };

  function getStorageBucketName(kindOrBucket) {
    if (imageUploadConfig[kindOrBucket]) return imageUploadConfig[kindOrBucket].bucket;
    if (kindOrBucket === "employer_logos") return "employer-logos";
    return String(kindOrBucket || "");
  }

  function getImageConfig(kind) {
    return imageUploadConfig[kind] || null;
  }

  function getFileExtension(file) {
    return String(file?.name || "").split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function getExtensionForMime(type) {
    return type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : type === "image/webp" ? "webp" : "";
  }

  function validateImageFile(file, kind) {
    const config = getImageConfig(kind);
    if (!config || !file) return { valid: true, message: "" };

    const allowedExtensions = imageMimeExtensions[file.type] || [];
    const extension = getFileExtension(file);

    if (!allowedExtensions.length || !allowedExtensions.includes(extension)) {
      return { valid: false, message: config.typeMessage };
    }

    if (file.size > config.maxBytes) {
      return { valid: false, message: config.sizeMessage };
    }

    return { valid: true, message: "" };
  }

  async function assertImageDecodes(file, message = "Please upload a JPG, PNG, or WebP image.") {
    if (!file) return;

    if ("createImageBitmap" in window) {
      try {
        const bitmap = await createImageBitmap(file);
        bitmap.close?.();
        return;
      } catch {
        throw new Error(message);
      }
    }

    await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(message));
      };
      image.src = url;
    });
  }

  async function validateImageFileForUpload(file, kind) {
    const result = validateImageFile(file, kind);
    if (!result.valid) throw new Error(result.message);
    await assertImageDecodes(file, getImageConfig(kind)?.typeMessage);
  }

  function buildOwnedImagePath(userId, file, kind) {
    const config = getImageConfig(kind);
    const extension = getExtensionForMime(file?.type);

    if (!config || !userId || !extension) {
      throw new Error(config?.typeMessage || "Please upload a JPG, PNG, or WebP image.");
    }

    return `${userId}/${config.baseName}.${extension}`;
  }

  function getStoragePathFromValue(value, bucket) {
    const raw = String(value || "").trim();
    const normalizedBucket = getStorageBucketName(bucket);
    if (!raw) return "";

    if (!/^https?:\/\//i.test(raw)) {
      return safeDecode(raw)
        .replace(/^\/+/, "")
        .replace(new RegExp(`^${escapeRegExp(normalizedBucket)}\/+`), "")
        .replace(new RegExp(`^${escapeRegExp(bucket)}\/+`), "");
    }

    try {
      const url = new URL(raw);
      const decodedPath = safeDecode(url.pathname);
      const markers = [
        `/object/public/${normalizedBucket}/`,
        `/object/sign/${normalizedBucket}/`,
        `/${normalizedBucket}/`,
        bucket && bucket !== normalizedBucket ? `/${bucket}/` : ""
      ].filter(Boolean);
      const marker = markers.find((item) => decodedPath.includes(item));
      if (!marker) return "";
      return decodedPath.slice(decodedPath.indexOf(marker) + marker.length).replace(/^\/+/, "");
    } catch {
      return "";
    }
  }

  function isOwnedStoragePath(value, bucket, userId) {
    const path = getStoragePathFromValue(value, bucket);
    return Boolean(path && userId && path.startsWith(`${userId}/`));
  }

  function getPublicImageUrl(supabase, bucket, value, options = {}) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    if (/^(blob:|data:image\/)/i.test(raw)) {
      return raw;
    }

    if (/^https?:\/\//i.test(raw)) {
      return addCacheBuster(raw, options.cacheBust);
    }

    const normalizedBucket = getStorageBucketName(bucket);
    const path = getStoragePathFromValue(raw, normalizedBucket);
    if (!path || !supabase?.storage) return raw;

    const { data } = supabase.storage.from(normalizedBucket).getPublicUrl(path);
    return addCacheBuster(data?.publicUrl || "", options.cacheBust);
  }

  async function uploadOwnedImage(supabase, kind, file, userId) {
    const config = getImageConfig(kind);
    if (!config) throw new Error("Unsupported image upload.");

    await validateImageFileForUpload(file, kind);
    const path = buildOwnedImagePath(userId, file, kind);
    const { error } = await supabase.storage
      .from(config.bucket)
      .upload(path, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type
      });

    if (error) throw error;
    return path;
  }

  async function removeOwnedImage(supabase, bucket, value, userId) {
    const normalizedBucket = getStorageBucketName(bucket);
    const path = getStoragePathFromValue(value, normalizedBucket);
    if (!path || !isOwnedStoragePath(path, normalizedBucket, userId)) return { skipped: true };

    const { error } = await supabase.storage.from(normalizedBucket).remove([path]);
    if (error) throw error;
    return { skipped: false };
  }

  function addCacheBuster(url, cacheBust) {
    if (!url || !cacheBust) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}v=${encodeURIComponent(cacheBust)}`;
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isCandidateOnboardingComplete(profile) {
    if (!profile) return false;

    const requiredFieldsComplete = [
      profile.trade,
      profile.experience,
      profile.bio,
      profile.availability,
      profile.contact_method
    ].every(hasValue) && hasValue(normalizeCandidateContactPreference(profile.shown_contact_method));

    const hasExplicitCompletionFlag = Object.prototype.hasOwnProperty.call(profile, "onboarding_completed") ||
      Object.prototype.hasOwnProperty.call(profile, "onboarding_complete");

    if (!hasExplicitCompletionFlag) return requiredFieldsComplete;

    return requiredFieldsComplete && (profile.onboarding_completed === true || profile.onboarding_complete === true);
  }

  function isEmployerOnboardingComplete(profile) {
    if (!profile) return false;

    const hasHiringNeeds = hasValue(profile.hiring_needs) || getEmployerHiringRoles(profile).length > 0;
    const hasPayRange = hasValue(profile.pay_range) || hasStructuredCompensation(profile);
    const requiredFieldsComplete = [
      profile.company_location,
      profile.company_description,
      profile.main_hiring_industry,
      profile.employment_type,
      profile.hiring_timeline,
      profile.candidate_qualities
    ].every(hasValue) && hasHiringNeeds && hasPayRange;

    const hasExplicitCompletionFlag = Object.prototype.hasOwnProperty.call(profile, "onboarding_completed") ||
      Object.prototype.hasOwnProperty.call(profile, "onboarding_complete");

    if (!hasExplicitCompletionFlag) return requiredFieldsComplete;

    return requiredFieldsComplete && (profile.onboarding_completed === true || profile.onboarding_complete === true);
  }

  function isProfileOnboardingComplete(accountType, profile) {
    return accountType === "employer"
      ? isEmployerOnboardingComplete(profile)
      : isCandidateOnboardingComplete(profile);
  }

  function normalizeCandidateContactPreference(value) {
    const text = String(value || "")
      .trim()
      .toLowerCase()
      .replaceAll("&", "and")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");

    if (!text) return "";
    if (["both", "email and phone", "phone and email", "email or phone", "email phone"].includes(text)) return "both";
    if (["email", "email only", "e mail", "mail"].includes(text)) return "email";
    if (["phone", "phone only", "text", "sms", "text only"].includes(text)) return "phone";
    if (text.includes("email") && text.includes("phone")) return "both";
    if (text.includes("email")) return "email";
    if (text.includes("phone") || text.includes("text")) return "phone";
    return "";
  }

  function getCandidateContactPreference(candidate = {}) {
    return normalizeCandidateContactPreference(
      candidate.shown_contact_method ||
      candidate.employer_contact_visibility ||
      candidate.contact_visibility ||
      candidate.preferred_contact ||
      candidate.contact_preference
    );
  }

  function getVisibleCandidateContact(candidate = {}) {
    const preference = getCandidateContactPreference(candidate);
    const hasEmail = Boolean(String(candidate.email || candidate.candidate_email || "").trim());
    const hasPhone = Boolean(String(candidate.phone || candidate.phone_number || candidate.candidate_phone || "").trim());

    if (preference === "email") {
      return { showEmail: hasEmail, showPhone: false, preference };
    }

    if (preference === "phone") {
      return { showEmail: false, showPhone: hasPhone, preference };
    }

    if (preference === "both") {
      return { showEmail: hasEmail, showPhone: hasPhone, preference };
    }

    return {
      showEmail: hasEmail,
      showPhone: !hasEmail && hasPhone,
      preference: hasEmail ? "email" : hasPhone ? "phone" : ""
    };
  }

  function hasCandidateSearchAccess(profile = {}) {
    if (profile.candidate_access !== true) return false;

    if (Object.prototype.hasOwnProperty.call(profile, "subscription_status")) {
      const status = String(profile.subscription_status || "").toLowerCase().trim();
      return status === "active" || status === "trialing";
    }

    return true;
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
        .select("company_location, company_description, main_hiring_industry, employment_type, hiring_needs, hiring_roles, hiring_role_other, pay_range, compensation_type, compensation_min, compensation_max, hiring_timeline, candidate_qualities, onboarding_completed")
        .eq("id", user.id)
        .maybeSingle();

      return isEmployerOnboardingComplete(profile)
        ? `${getAppBaseUrl()}/employers/employer-dashboard.html`
        : `${getAppBaseUrl()}/employers/employer-setup.html`;
    }

    const { data: profile } = await supabase
      .from("candidate_profiles")
      .select("trade, experience, bio, availability, contact_method, shown_contact_method")
      .eq("id", user.id)
      .maybeSingle();

    return isCandidateOnboardingComplete(profile)
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
    sessionStorage.removeItem("placelyAuthGuardRedirecting");
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
    isMissingRowError,
    isCandidateOnboardingComplete,
    isEmployerOnboardingComplete,
    isProfileOnboardingComplete,
    normalizeCandidateContactPreference,
    getCandidateContactPreference,
    getVisibleCandidateContact,
    hasCandidateSearchAccess,
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
    passwordRequirementText,
    hiringRoleOptions,
    hiringTimelineOptions,
    normalizeHiringTimeline,
    getHiringTimelineLabel,
    parseHiringRoles,
    getEmployerHiringRoles,
    hasStructuredCompensation,
    normalizeCompensationType,
    parseCompensationAmount,
    validateCompensationValues,
    buildCompensationPayload,
    formatCompensation,
    formatCompensationFromRecord,
    imageUploadConfig,
    validateImageFile,
    validateImageFileForUpload,
    buildOwnedImagePath,
    getStoragePathFromValue,
    isOwnedStoragePath,
    getPublicImageUrl,
    uploadOwnedImage,
    removeOwnedImage
  };
})();
