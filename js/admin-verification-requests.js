const adminSupabase = window.PlacelyAuth.client();
let adminSession = null;

document.addEventListener("DOMContentLoaded", initAdminVerificationRequests);

async function initAdminVerificationRequests() {
  document.getElementById("refreshRequestsBtn")?.addEventListener("click", loadVerificationRequests);
  document.getElementById("adminLogoutBtn")?.addEventListener("click", handleAdminLogout);

  adminSession = await requireAdminSession();
  if (!adminSession) return;

  await loadVerificationRequests();
}

async function requireAdminSession() {
  const { data, error } = await adminSupabase.auth.getSession();
  const session = data?.session;

  if (error) {
    console.error("Admin verification: session lookup failed", {
      message: error?.message
    });
  }

  if (!session?.access_token) {
    redirectToAdminLogin("session-expired");
    return null;
  }

  return session;
}

async function loadVerificationRequests() {
  setStatus("Loading requests...");

  try {
    if (!adminSession?.access_token) {
      adminSession = await requireAdminSession();
      if (!adminSession) return;
    }

    const { data, error } = await invokeAdminFunction("list-candidate-verification-requests", {
      body: {}
    });

    if (error || data?.error) {
      await handleAdminFunctionFailure(error, data, "You are not authorized to view verification requests.");
      return;
    }

    renderRequests(data?.requests || []);
  } catch (error) {
    console.error("Admin verification requests failed to load", {
      message: error?.message
    });
    setStatus(error?.message || "You are not authorized to view verification requests.");
  } finally {
    document.documentElement.classList.remove("auth-booting");
  }
}

function renderRequests(requests) {
  const list = document.getElementById("verificationRequestsList");
  if (!list) return;

  if (!requests.length) {
    list.innerHTML = "";
    setStatus("No pending verification requests.");
    return;
  }

  setStatus(`${requests.length} pending request${requests.length === 1 ? "" : "s"}.`);
  list.innerHTML = requests.map(renderRequestRow).join("");

  list.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => reviewRequest(button));
  });
}

function renderRequestRow(request) {
  const candidate = request.candidate || {};
  const profileUrl = `../candidates/candidate-profile.html?id=${encodeURIComponent(candidate.id || "")}`;

  return `
    <article class="admin-request-row" data-request-id="${escapeAttribute(request.id)}">
      <div>
        <h2>${escapeHTML(candidate.full_name || "Candidate")}</h2>
        <p>${escapeHTML(candidate.email || "Email not listed")}</p>
        <p>${escapeHTML(candidate.phone || "Phone not listed")}</p>
      </div>
      <div>
        <p><strong>Trade:</strong> ${escapeHTML(candidate.trade || "Not listed")}</p>
        <p><strong>Location:</strong> ${escapeHTML(candidate.location || "Not listed")}</p>
        <p><strong>Availability:</strong> ${escapeHTML(candidate.availability || "Not listed")}</p>
        <p><strong>Requested:</strong> ${escapeHTML(formatDate(request.requested_at))}</p>
        ${request.request_message ? `<p><strong>Message:</strong> ${escapeHTML(request.request_message)}</p>` : ""}
      </div>
      <div class="admin-request-actions">
        <a class="admin-link" href="${escapeAttribute(profileUrl)}" target="_blank" rel="noopener">View Candidate Profile</a>
        <textarea data-notes-for="${escapeAttribute(request.id)}" placeholder="Internal notes"></textarea>
        <div class="admin-button-row">
          <button type="button" data-action="approve" data-request-id="${escapeAttribute(request.id)}">Approve</button>
          <button type="button" class="danger" data-action="reject" data-request-id="${escapeAttribute(request.id)}">Reject</button>
        </div>
      </div>
    </article>
  `;
}

async function reviewRequest(button) {
  const requestId = button.dataset.requestId;
  const action = button.dataset.action;
  const row = button.closest("[data-request-id]");
  const notes = row?.querySelector(`[data-notes-for="${CSS.escape(requestId)}"]`)?.value?.trim() || "";

  row?.querySelectorAll("button").forEach((item) => {
    item.disabled = true;
  });

  try {
    if (!adminSession?.access_token) {
      adminSession = await requireAdminSession();
      if (!adminSession) return;
    }

    const { data, error } = await invokeAdminFunction("review-candidate-verification", {
      body: {
        request_id: requestId,
        action,
        internal_notes: notes
      }
    });

    if (error || data?.error) {
      await handleAdminFunctionFailure(error, data, "Could not review request.");
      return;
    }

    showToast(`Request ${action === "approve" ? "approved" : "rejected"}.`);
    await loadVerificationRequests();
  } catch (error) {
    console.error("Admin verification review failed", {
      message: error?.message
    });
    showToast(error?.message || "Could not review request.");
  } finally {
    row?.querySelectorAll("button").forEach((item) => {
      item.disabled = false;
    });
  }
}

async function invokeAdminFunction(functionName, options = {}) {
  return adminSupabase.functions.invoke(functionName, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${adminSession.access_token}`
    }
  });
}

async function handleAdminFunctionFailure(error, data, fallbackMessage) {
  const details = await readFunctionError(error);
  const status = details.status || 0;
  const code = data?.code || details.code || "";
  const message = data?.error || details.message || fallbackMessage;

  console.error("Admin verification function failed", {
    status,
    code,
    message
  });

  if (status === 401 || code === "ADMIN_AUTH_REQUIRED") {
    redirectToAdminLogin("session-expired");
    return;
  }

  if (status === 403 || code === "ADMIN_ACCESS_DENIED") {
    await adminSupabase.auth.signOut();
    redirectToAdminLogin("access-denied");
    return;
  }

  setStatus(message || fallbackMessage);
  showToast(message || fallbackMessage);
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

async function handleAdminLogout() {
  await adminSupabase.auth.signOut();
  window.location.replace("admin-login.html");
}

function redirectToAdminLogin(reason = "") {
  const suffix = reason ? `?reason=${encodeURIComponent(reason)}` : "";
  window.location.replace(`admin-login.html${suffix}`);
}

function setStatus(message) {
  const status = document.getElementById("adminStatus");
  if (status) status.textContent = message || "";
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHTML(value).replaceAll("`", "&#096;");
}
