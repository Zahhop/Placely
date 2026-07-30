const adminLoginSupabase = window.PlacelyAuth.client();

document.addEventListener("DOMContentLoaded", initAdminLogin);

async function initAdminLogin() {
  const form = document.getElementById("adminLoginForm");
  const params = new URLSearchParams(window.location.search);

  if (params.get("reason") === "access-denied") {
    setAdminLoginStatus("This account does not have Placely admin access.", "error");
  } else if (params.get("reason") === "session-expired") {
    setAdminLoginStatus("Your admin session expired. Please sign in again.", "error");
  }

  form?.addEventListener("submit", handleAdminLoginSubmit);
  await redirectAuthorizedAdmin();
}

async function redirectAuthorizedAdmin() {
  const { data, error } = await adminLoginSupabase.auth.getSession();
  const session = data?.session;

  if (error) {
    console.error("Admin login: session lookup failed", {
      message: error?.message
    });
    return;
  }

  if (!session?.access_token) return;

  setAdminLoginStatus("Checking admin access...", "loading");
  const result = await validateAdminAccess(session);

  if (result.ok) {
    window.location.replace("verification-requests.html");
    return;
  }

  if (result.status === 401 || result.status === 403) {
    await adminLoginSupabase.auth.signOut();
  }

  setAdminLoginStatus(
    result.status === 403
      ? "This account does not have Placely admin access."
      : "Please sign in with your Placely admin account.",
    result.status === 403 ? "error" : ""
  );
}

async function handleAdminLoginSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const submit = document.getElementById("adminLoginSubmit");
  const emailInput = form?.elements?.namedItem("email");
  const passwordInput = form?.elements?.namedItem("password");
  const email = String(emailInput?.value || "").trim();
  const password = String(passwordInput?.value || "");

  if (!email || !password) {
    setAdminLoginStatus("Enter your admin email and password.", "error");
    return;
  }

  submit.disabled = true;
  setAdminLoginStatus("Signing in...", "loading");

  try {
    const { data, error } = await adminLoginSupabase.auth.signInWithPassword({ email, password });

    if (error) {
      setAdminLoginStatus("Invalid email or password.", "error");
      return;
    }

    const session = data?.session || (await adminLoginSupabase.auth.getSession()).data?.session;
    if (!session?.access_token) {
      setAdminLoginStatus("Your session could not be created. Please try again.", "error");
      return;
    }

    setAdminLoginStatus("Checking admin access...", "loading");
    const result = await validateAdminAccess(session);

    if (result.ok) {
      window.location.replace("verification-requests.html");
      return;
    }

    await adminLoginSupabase.auth.signOut();
    setAdminLoginStatus(
      result.status === 401 || result.status === 403
        ? "This account does not have Placely admin access."
        : "We could not verify admin access. Please try again.",
      "error"
    );
  } catch (error) {
    console.error("Admin login failed", {
      message: error?.message
    });
    setAdminLoginStatus("Network issue. Please try again.", "error");
  } finally {
    submit.disabled = false;
  }
}

async function validateAdminAccess(session) {
  try {
    const { data, error } = await adminLoginSupabase.functions.invoke("list-candidate-verification-requests", {
      body: {},
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    });

    if (!error && !data?.error) return { ok: true };

    const details = await readFunctionError(error);
    console.warn("Admin login: access validation failed", {
      status: details.status,
      code: data?.code || details.code,
      message: data?.error || details.message
    });

    return {
      ok: false,
      status: details.status || 403,
      code: data?.code || details.code,
      message: data?.error || details.message
    };
  } catch (error) {
    console.error("Admin login: access validation request failed", {
      message: error?.message
    });
    return { ok: false, status: 0, message: "Network issue." };
  }
}

async function readFunctionError(error) {
  const response = error?.context;
  if (!response) return { status: 0, message: error?.message || "" };

  try {
    const payload = await response.clone().json();
    return {
      status: response.status,
      code: payload?.code,
      message: payload?.error || error?.message || ""
    };
  } catch {
    return { status: response.status, message: error?.message || "" };
  }
}

function setAdminLoginStatus(message, tone = "") {
  const status = document.getElementById("adminLoginStatus");
  if (!status) return;
  status.textContent = message || "";
  status.dataset.tone = tone;
}
