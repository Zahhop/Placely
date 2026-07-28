const adminSupabase = window.PlacelyAuth.client();

document.addEventListener("DOMContentLoaded", initAdminVerificationRequests);

async function initAdminVerificationRequests() {
  document.getElementById("refreshRequestsBtn")?.addEventListener("click", loadVerificationRequests);
  await loadVerificationRequests();
}

async function loadVerificationRequests() {
  setStatus("Loading requests...");

  try {
    const { data, error } = await adminSupabase.functions.invoke("list-candidate-verification-requests", {
      body: {}
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    renderRequests(data?.requests || []);
  } catch (error) {
    console.error("Admin verification requests failed to load", {
      message: error?.message,
      context: error?.context
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
    const { data, error } = await adminSupabase.functions.invoke("review-candidate-verification", {
      body: {
        request_id: requestId,
        action,
        internal_notes: notes
      }
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    showToast(`Request ${action === "approve" ? "approved" : "rejected"}.`);
    await loadVerificationRequests();
  } catch (error) {
    console.error("Admin verification review failed", {
      message: error?.message,
      context: error?.context
    });
    showToast(error?.message || "Could not review request.");
    row?.querySelectorAll("button").forEach((item) => {
      item.disabled = false;
    });
  }
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
