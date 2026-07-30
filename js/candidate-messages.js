const candidateMessagesSupabase = window.PlacelyAuth.client();

const messagesLayout = document.getElementById("messagesLayout");
const conversationList = document.getElementById("conversationList");
const conversationSearch = document.getElementById("conversationSearch");
const conversationCount = document.getElementById("conversationCount");

const chatAvatar = document.getElementById("chatAvatar");
const chatEyebrow = document.getElementById("chatEyebrow");
const chatCompany = document.getElementById("chatCompany");
const chatRole = document.getElementById("chatRole");
const chatMessages = document.getElementById("chatMessages");
const chatActions = document.getElementById("chatActions");
const viewApplicationLink = document.getElementById("viewApplicationLink");
const viewJobLink = document.getElementById("viewJobLink");
const backToConversationsBtn = document.getElementById("backToConversationsBtn");

const form = document.getElementById("messageForm");
const input = document.getElementById("messageInput");
const sendMessageBtn = document.getElementById("sendMessageBtn");
const composerStatus = document.getElementById("composerStatus");
const messagesSearchForm = document.getElementById("messagesSearchForm");
const messagesSearchInput = document.getElementById("messagesSearchInput");

let currentUser = null;
let currentProfile = {};
let conversationsData = [];
let activeMessages = [];
let activeConversationId = null;
let activeRealtimeChannel = null;
let refreshTimer = null;
let isSendingMessage = false;
const resumeRequestsByConversationId = new Map();
const employerProfilesById = new Map();

document.addEventListener("DOMContentLoaded", initMessages);

async function initMessages() {
  setupEvents();

  try {
    const user = await verifyCandidateAccess(candidateMessagesSupabase, {
      loginPath: "candidate-login.html",
      employerDashboardPath: "../employers/employer-dashboard.html"
    });

    if (!user) return;
    currentUser = user;
    activeConversationId = new URLSearchParams(window.location.search).get("conversation");

    await loadCandidateProfile(user);

    await Promise.all([
      loadConversations(),
      loadHeaderCounts(user.id)
    ]);

    renderConversationList(getFilteredConversations());

    if (activeConversationId) {
      await openConversation(activeConversationId);
    } else {
      showNoConversationState();
    }

    startConversationPolling();
  } catch (error) {
    console.error("Candidate messages failed to load", {
      code: error?.code,
      message: error?.message
    });
    showNoConversationState("Could not load messages", "Please refresh the page and try again.");
  } finally {
    revealMessages();
  }
}

async function loadConversations() {
  const { data, error } = await candidateMessagesSupabase
    .from("conversations")
    .select("*")
    .eq("candidate_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    conversationsData = [];
    activeConversationId = null;
    showNoConversationState();
    return;
  }

  const rows = data || [];
  await loadEmployerProfilesForConversations(rows);

  conversationsData = await Promise.all(
    rows.map(async (conversation) => {
      const employerProfile = employerProfilesById.get(String(conversation.employer_id || "")) || null;
      const employerName =
        employerProfile?.company_name ||
        conversation.employer_name ||
        conversation.company_name ||
        "Employer";

      const logoUrl = getEmployerLogoUrl(
        window.PlacelyAuth.getPublicEmployerLogoValue(employerProfile) ||
        conversation.company_logo_url ||
        ""
      );

      const latest = await getLatestMessage(conversation.id);
      const unreadCount = await getUnreadCount(conversation.id);

      return {
        id: conversation.id,
        employerId: conversation.employer_id,
        jobId: conversation.job_id || conversation.related_job_id || "",
        employerName,
        initials: getInitials(employerName),
        logoUrl,
        role: conversation.candidate_role || conversation.job_title || "Opportunity",
        source: conversation.source || "Application",
        status: conversation.status || "Active",
        response: conversation.response || "New",
        latestMessage: latest?.message || "",
        latestAt: latest?.created_at || conversation.created_at,
        unreadCount
      };
    })
  );

  conversationsData.sort(sortByLatestActivity);

  if (!activeConversationId && !isMobileConversationLayout()) {
    activeConversationId = conversationsData[0]?.id || null;
  }
}

async function loadEmployerProfilesForConversations(conversations) {
  const employerIds = [...new Set(
    (conversations || [])
      .map((conversation) => String(conversation.employer_id || "").trim())
      .filter(Boolean)
  )];
  const missingEmployerIds = employerIds.filter((id) => !employerProfilesById.has(String(id)));

  if (!missingEmployerIds.length) return;

  const { data, error } = await candidateMessagesSupabase
    .from("employer_profiles")
    .select("id, company_name, company_logo_url")
    .in("id", missingEmployerIds);

  if (error) {
    console.error("Candidate messages: employer identity lookup failed", {
      employerIds: missingEmployerIds,
      code: error?.code,
      message: error?.message,
      details: error?.details
    });
    return;
  }

  (data || []).forEach((profile) => {
    if (profile?.id) employerProfilesById.set(String(profile.id), profile);
  });
}

async function loadCandidateProfile(user) {
  let identity = null;

  try {
    identity = await window.PlacelyAuth.loadCandidateIdentity?.(candidateMessagesSupabase, { user });
  } catch (error) {
    console.error("Candidate messages: candidate identity lookup failed", {
      userId: user?.id || "",
      code: error?.code,
      message: error?.message
    });
  }

  identity = identity || window.PlacelyAuth.getCachedCandidateIdentity?.() || {
    fullName: user?.email?.split("@")[0] || "Candidate",
    firstName: user?.email?.split("@")[0] || "Candidate",
    email: user?.email || "",
    initials: getInitials(user?.email || "Candidate"),
    photoUrl: ""
  };

  currentProfile = {
    full_name: identity.fullName,
    email: identity.email || user.email || "",
    profile_photo_url: identity.photoUrl || ""
  };
  window.PlacelyAuth.updateCandidateHeader?.(identity);
  bindCandidateHeaderPhotoFallback(identity);
}

async function loadHeaderCounts(userId) {
  const [{ count: unreadCount }, { count: notificationCount }, { count: resumeRequestCount }] = await Promise.all([
    candidateMessagesSupabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", userId)
      .eq("sender_type", "employer")
      .eq("read_by_candidate", false),
    candidateMessagesSupabase
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", userId)
      .in("status", ["reviewing", "interview", "offer"]),
    candidateMessagesSupabase
      .from("candidate_resume_requests")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", userId)
      .eq("status", "pending")
  ]);

  updateBadge("topUnreadBadge", unreadCount || 0);
  updateBadge("topNotificationBadge", (notificationCount || 0) + (resumeRequestCount || 0));
  window.PlacelyCandidateSidebar?.updateResumeRequestCount(resumeRequestCount || 0);
}

function setupEvents() {
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
  document.getElementById("accountMenuLogoutBtn")?.addEventListener("click", handleLogout);
  bindAccountMenu();
  bindMobileSidebar();
  bindHeaderSearch();

  conversationSearch?.addEventListener("input", () => {
    renderConversationList(getFilteredConversations());

    if (getFilteredConversations().length === 0 && conversationsData.length > 0) {
      showSearchEmptyState();
    }
  });

  backToConversationsBtn?.addEventListener("click", () => {
    messagesLayout?.classList.remove("conversation-open");
  });

  input?.addEventListener("input", updateSendAvailability);
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form?.requestSubmit();
    }
  });

  form?.addEventListener("submit", sendMessage);
}

function getFilteredConversations() {
  const query = (conversationSearch?.value || "").toLowerCase().trim();

  if (!query) return conversationsData;

  return conversationsData.filter((conversation) =>
    [
      conversation.employerName,
      conversation.role,
      conversation.source,
      conversation.status,
      conversation.latestMessage
    ]
      .join(" ")
      .toLowerCase()
      .includes(query)
  );
}

function renderConversationList(list) {
  if (!conversationList) return;

  const unreadTotal = conversationsData.reduce((total, conversation) => total + (conversation.unreadCount || 0), 0);
  if (conversationCount) {
    conversationCount.textContent = unreadTotal ? `${unreadTotal} unread` : String(conversationsData.length);
  }

  conversationList.innerHTML = "";

  if (!list.length) {
    conversationList.innerHTML = `
      <div class="empty-list-state">
        <strong>${conversationsData.length ? "No matches" : "No conversations yet"}</strong>
        <p>${conversationsData.length ? "Try another employer, role, or message." : "When an employer contacts you or you follow up on an application, your messages will appear here."}</p>
      </div>
    `;
    return;
  }

  list.forEach((conversation) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `conversation-row${String(conversation.id) === String(activeConversationId) ? " active" : ""}${conversation.unreadCount ? " unread" : ""}`;
    row.innerHTML = `
      <span class="avatar">
        ${renderAvatar(conversation.logoUrl, conversation.initials, "Company logo")}
      </span>
      <span class="conversation-copy">
        <span class="conversation-top">
          <strong>${escapeHTML(conversation.employerName)}</strong>
          <span>${escapeHTML(formatConversationTime(conversation.latestAt, "New"))}</span>
        </span>
        <span class="conversation-meta">${escapeHTML(conversation.role)}${conversation.source ? ` - ${escapeHTML(conversation.source)}` : ""}</span>
        <span class="conversation-preview">${escapeHTML(conversation.latestMessage || "No messages yet.")}</span>
      </span>
      ${conversation.unreadCount ? `<span class="unread-dot">${conversation.unreadCount}</span>` : ""}
    `;

    row.addEventListener("click", async () => {
      await openConversation(conversation.id, { updateUrl: true });
    });

    conversationList.appendChild(row);
  });
}

async function openConversation(id, options = {}) {
  const conversation = conversationsData.find((item) => String(item.id) === String(id));

  if (!conversation) {
    showNoConversationState();
    return;
  }

  activeConversationId = conversation.id;
  setConversationMode();
  renderConversationChrome(conversation);
  renderThreadLoading();
  renderConversationList(getFilteredConversations());

  const messages = await loadMessages(conversation.id);
  await loadResumeRequestForConversation(conversation);
  activeMessages = messages;
  renderMessages(messages, conversation);
  await markConversationRead(conversation);
  conversation.unreadCount = 0;
  renderConversationList(getFilteredConversations());
  subscribeToMessages(conversation.id);

  if (options.updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("conversation", conversation.id);
    window.history.replaceState({}, "", url);
  }
}

function renderConversationChrome(conversation) {
  if (chatAvatar) {
    chatAvatar.innerHTML = renderAvatar(conversation.logoUrl, conversation.initials, "Company logo");
  }

  if (chatEyebrow) chatEyebrow.textContent = conversation.source ? `${conversation.source} conversation` : "Employer conversation";
  if (chatCompany) chatCompany.textContent = conversation.employerName;
  if (chatRole) chatRole.textContent = conversation.role;

  if (viewApplicationLink) {
    viewApplicationLink.href = "candidate-applications.html";
  }

  if (viewJobLink) {
    if (conversation.jobId) {
      viewJobLink.hidden = false;
      viewJobLink.href = `../public/find-jobs.html?role=candidate&job=${encodeURIComponent(conversation.jobId)}`;
    } else {
      viewJobLink.hidden = true;
      viewJobLink.removeAttribute("href");
    }
  }
}

async function loadMessages(conversationId) {
  const { data, error } = await candidateMessagesSupabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("candidate_id", currentUser.id)
    .order("created_at", { ascending: true });

  if (error) {
    chatMessages.innerHTML = `
      <div class="empty-message">
        <h3>Could not load messages</h3>
        <p>Please refresh the page and try again.</p>
      </div>
    `;
    return [];
  }

  return data || [];
}

function renderMessages(messages, conversation) {
  if (!chatMessages) return;

  chatMessages.innerHTML = "";

  if (!messages.length) {
    chatMessages.innerHTML = `
      <div class="empty-message">
        <h3>No messages yet</h3>
        <p>When ${escapeHTML(conversation.employerName)} sends a message, it will appear here.</p>
      </div>
    `;
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return;
  }

  let previousDate = "";
  messages.forEach((message) => {
    const dateLabel = formatDateSeparator(message.created_at);
    if (dateLabel !== previousDate) {
      previousDate = dateLabel;
      const separator = document.createElement("div");
      separator.className = "date-separator";
      separator.textContent = dateLabel;
      chatMessages.appendChild(separator);
    }

    appendMessageBubble(message);
  });

  renderResumeRequestPanel(conversation);

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendMessageBubble(message) {
  if (!chatMessages) return;

  if (message.id && chatMessages.querySelector(`[data-message-id="${escapeSelectorValue(message.id)}"]`)) {
    return;
  }

  const emptyMessage = chatMessages.querySelector(".empty-message");
  if (emptyMessage) chatMessages.innerHTML = "";

  const bubble = document.createElement("div");
  const isSent = message.sender_type === "candidate";
  bubble.className = `message ${isSent ? "sent" : "received"}${message.pending ? " pending" : ""}`;
  bubble.dataset.messageId = message.id || "";
  bubble.innerHTML = `
    <div class="bubble-text">${escapeHTML(message.message)}</div>
    <span>${escapeHTML(formatMessageTime(message.created_at))}</span>
  `;

  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function loadResumeRequestForConversation(conversation) {
  if (!conversation?.id) return null;

  const { data, error } = await candidateMessagesSupabase
    .from("candidate_resume_requests")
    .select("id, employer_id, candidate_id, status, requested_at, responded_at, expires_at, revoked_at, conversation_id")
    .eq("candidate_id", currentUser.id)
    .eq("employer_id", conversation.employerId)
    .order("requested_at", { ascending: false })
    .limit(1);

  if (error) {
    console.warn("Candidate resume request lookup failed", {
      code: error?.code,
      message: error?.message
    });
    return null;
  }

  const request = data?.[0] || null;
  if (request) resumeRequestsByConversationId.set(String(conversation.id), request);
  else resumeRequestsByConversationId.delete(String(conversation.id));
  return request;
}

function renderResumeRequestPanel(conversation) {
  const request = resumeRequestsByConversationId.get(String(conversation?.id || ""));
  if (!request) return;

  const panel = document.createElement("div");
  panel.className = "resume-request-message-card";
  panel.innerHTML = `
    <strong>${escapeHTML(getResumeRequestTitle(request.status))}</strong>
    <p>${escapeHTML(getResumeRequestCopy(request.status, conversation.employerName))}</p>
    ${request.status === "pending" ? `
      <div class="resume-request-message-actions">
        <button type="button" class="secondary-btn" data-resume-review="decline" data-request-id="${escapeAttribute(request.id)}">Decline</button>
        <button type="button" class="primary-btn" data-resume-review="approve" data-request-id="${escapeAttribute(request.id)}">Approve</button>
      </div>
    ` : ""}
  `;
  chatMessages.appendChild(panel);
  panel.querySelectorAll("[data-resume-review]").forEach((button) => {
    button.addEventListener("click", () => reviewResumeRequest(button.dataset.requestId, button.dataset.resumeReview, conversation));
  });
}

function getResumeRequestTitle(status) {
  if (status === "approved") return "Resume access approved";
  if (status === "declined") return "Resume access declined";
  if (status === "revoked") return "Resume access revoked";
  if (status === "expired") return "Resume access expired";
  return "Resume access request";
}

function getResumeRequestCopy(status, employerName) {
  const name = employerName || "This employer";
  if (status === "approved") return `${name} can now review your resume from your candidate profile.`;
  if (status === "declined") return `${name} cannot access your resume.`;
  if (status === "revoked") return `${name} can no longer access your resume.`;
  if (status === "expired") return `${name}'s resume access has expired.`;
  return `${name} requested access to review your resume. You can approve or decline this request.`;
}

async function reviewResumeRequest(requestId, action, conversation) {
  if (!requestId || !["approve", "decline"].includes(action)) return;
  const buttons = chatMessages.querySelectorAll(`[data-request-id="${escapeSelectorValue(requestId)}"]`);
  buttons.forEach((button) => {
    button.disabled = true;
  });

  const { data, error } = await candidateMessagesSupabase.functions.invoke("review-candidate-resume-access", {
    body: { requestId, action }
  });

  if (error || !data?.request) {
    const message = await readFunctionError(error);
    if (composerStatus) composerStatus.textContent = message || "Could not update the resume request.";
    buttons.forEach((button) => {
      button.disabled = false;
    });
    return;
  }

  resumeRequestsByConversationId.set(String(conversation.id), data.request);
  await loadHeaderCounts(currentUser.id);
  await loadMessages(conversation.id).then((messages) => {
    activeMessages = messages;
    renderMessages(messages, conversation);
  });
}

async function markConversationRead(conversation) {
  const { error } = await candidateMessagesSupabase
    .from("messages")
    .update({ read_by_candidate: true })
    .eq("conversation_id", conversation.id)
    .eq("candidate_id", currentUser.id)
    .eq("sender_type", "employer");

  if (error) {
    return;
  }
}

async function sendMessage(event) {
  event.preventDefault();

  const conversation = getActiveConversation();
  const text = input?.value.trim();
  if (!conversation || !text || isSendingMessage) return;

  setSendingState(true);
  const tempMessage = {
    id: `temp-${Date.now()}`,
    conversation_id: conversation.id,
    sender_type: "candidate",
    message: text,
    created_at: new Date().toISOString(),
    pending: true
  };

  if (!activeMessages.length && chatMessages?.querySelector(".empty-message")) {
    chatMessages.innerHTML = "";
  }

  activeMessages.push(tempMessage);
  appendMessageBubble(tempMessage);
  input.value = "";
  updateSendAvailability();

  const { data, error } = await candidateMessagesSupabase
    .from("messages")
    .insert([
      {
        conversation_id: conversation.id,
        sender_type: "candidate",
        message: text,
        employer_id: conversation.employerId,
        candidate_id: currentUser.id,
        candidate_name: currentUser.email,
        candidate_role: conversation.role,
        read_by_candidate: true,
        read_by_employer: false
      }
    ])
    .select()
    .single();

  setSendingState(false);

  if (error) {
    activeMessages = activeMessages.filter((message) => message.id !== tempMessage.id);
    await openConversation(conversation.id);
    if (composerStatus) composerStatus.textContent = "Message could not be sent.";
    input.focus();
    return;
  }

  activeMessages = activeMessages.map((message) => message.id === tempMessage.id ? data : message);
  conversation.latestMessage = data?.message || text;
  conversation.latestAt = data?.created_at || tempMessage.created_at;
  conversationsData.sort(sortByLatestActivity);
  renderConversationList(getFilteredConversations());

  const pendingBubble = chatMessages.querySelector(`[data-message-id="${escapeSelectorValue(tempMessage.id)}"]`);
  if (pendingBubble) {
    pendingBubble.dataset.messageId = data?.id || "";
    pendingBubble.classList.remove("pending");
  }
}

function subscribeToMessages(conversationId) {
  if (activeRealtimeChannel) {
    candidateMessagesSupabase.removeChannel(activeRealtimeChannel);
  }

  activeRealtimeChannel = candidateMessagesSupabase
    .channel(`candidate-messages-${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`
      },
      async (payload) => {
        const message = payload.new;
        if (!message || String(message.candidate_id) !== String(currentUser.id) || activeMessages.some((item) => String(item.id) === String(message.id))) return;

        const pendingMatch = activeMessages.find((item) => (
          item.pending &&
          item.sender_type === message.sender_type &&
          item.message === message.message
        ));

        if (pendingMatch) {
          const pendingId = pendingMatch.id;
          Object.assign(pendingMatch, message, { pending: false });
          const pendingBubble = chatMessages.querySelector(`[data-message-id="${escapeSelectorValue(pendingId)}"]`);
          if (pendingBubble) {
            pendingBubble.dataset.messageId = message.id || "";
            pendingBubble.classList.remove("pending");
          }
          return;
        }

        activeMessages.push(message);
        appendMessageBubble(message);

        const conversation = getActiveConversation();
        if (conversation) {
          conversation.latestMessage = message.message || conversation.latestMessage;
          conversation.latestAt = message.created_at || conversation.latestAt;
          if (message.sender_type === "employer") {
            await markConversationRead(conversation);
          }
          renderConversationList(getFilteredConversations());
        }
      }
    )
    .subscribe();
}

function startConversationPolling() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(async () => {
    const currentId = activeConversationId;

    await loadConversations();
    if (currentId && conversationsData.some((conversation) => String(conversation.id) === String(currentId))) {
      activeConversationId = currentId;
    }

    renderConversationList(getFilteredConversations());
  }, 30000);
}

function showNoConversationState(title = null, message = null) {
  activeConversationId = null;
  activeMessages = [];
  setComposerEnabled(false);
  messagesLayout?.classList.remove("conversation-open");
  chatActions?.classList.add("disabled-area");

  if (activeRealtimeChannel) {
    candidateMessagesSupabase.removeChannel(activeRealtimeChannel);
    activeRealtimeChannel = null;
  }

  if (chatAvatar) chatAvatar.innerHTML = "";
  if (chatEyebrow) chatEyebrow.textContent = "Select a conversation";
  if (chatCompany) chatCompany.textContent = "No conversation selected";
  if (chatRole) chatRole.textContent = "Employer messages will appear here.";
  if (viewJobLink) {
    viewJobLink.hidden = true;
    viewJobLink.removeAttribute("href");
  }

  if (chatMessages) {
    const emptyTitle = title || (conversationsData.length ? "Select a conversation" : "No conversations yet");
    const emptyMessage = message || (conversationsData.length
      ? "Choose a conversation from the left to view messages."
      : "Messages from employers will appear here when they contact you about applications or opportunities.");

    chatMessages.innerHTML = `
      <div class="empty-message">
        <h3>${escapeHTML(emptyTitle)}</h3>
        <p>${escapeHTML(emptyMessage)}</p>
        ${conversationsData.length ? "" : `
          <div class="empty-actions">
            <a href="../public/find-jobs.html?role=candidate" class="primary-mini-btn">Find Jobs</a>
          </div>
        `}
      </div>
    `;
  }
}

function showSearchEmptyState() {
  if (chatMessages) {
    chatMessages.innerHTML = `
      <div class="empty-message">
        <h3>No matching conversations</h3>
        <p>Try another employer name, role, or conversation source.</p>
      </div>
    `;
  }
}

function renderThreadLoading() {
  if (!chatMessages) return;

  chatMessages.innerHTML = `
    <div class="empty-message">
      <h3>Loading conversation</h3>
      <p>Getting the latest employer messages.</p>
    </div>
  `;
}

function setConversationMode() {
  if (messagesLayout) {
    messagesLayout.classList.remove("empty");
    messagesLayout.classList.add("conversation-open");
  }
  if (chatActions) chatActions.classList.remove("disabled-area");
  setComposerEnabled(true);
}

function isMobileConversationLayout() {
  return window.matchMedia?.("(max-width: 760px)")?.matches || false;
}

function setComposerEnabled(enabled) {
  if (input) input.disabled = !enabled;
  updateSendAvailability();
  if (composerStatus) composerStatus.textContent = "";
}

function setSendingState(isSending) {
  isSendingMessage = isSending;
  if (input) input.disabled = isSending;
  if (sendMessageBtn) {
    sendMessageBtn.disabled = isSending || !input?.value.trim();
    sendMessageBtn.textContent = isSending ? "Sending" : "Send";
  }
  if (composerStatus) {
    composerStatus.textContent = isSending ? "Sending message..." : "";
  }
}

function updateSendAvailability() {
  if (!sendMessageBtn) return;

  const canSend = Boolean(activeConversationId && input?.value.trim() && !isSendingMessage && !input.disabled);
  sendMessageBtn.disabled = !canSend;
}

async function getLatestMessage(conversationId) {
  const { data, error } = await candidateMessagesSupabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("candidate_id", currentUser.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return null;
  }

  return data;
}

async function getUnreadCount(conversationId) {
  const { count, error } = await candidateMessagesSupabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("candidate_id", currentUser.id)
    .eq("sender_type", "employer")
    .neq("read_by_candidate", true);

  if (error) {
    return 0;
  }

  return count || 0;
}

function renderAvatar(url, initials, altText) {
  if (url) {
    return `<img src="${escapeAttribute(url)}" class="message-avatar-img" alt="${escapeAttribute(altText || "Avatar")}" onerror="this.parentElement.textContent='${escapeAttribute(initials || "PT")}'">`;
  }

  return `<span>${escapeHTML(initials || "PT")}</span>`;
}

function getEmployerLogoUrl(value) {
  return window.PlacelyAuth?.resolveEmployerLogoUrl?.(value, { supabase: candidateMessagesSupabase }) || "";
}

function getActiveConversation() {
  return conversationsData.find((item) => String(item.id) === String(activeConversationId));
}

function bindAccountMenu() {
  const button = document.getElementById("candidateAccountButton");
  const menu = document.getElementById("candidateAccountMenu");
  if (!button || !menu) return;

  const closeMenu = ({ restoreFocus = false } = {}) => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus) button.focus();
  };

  const openMenu = () => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    menu.querySelector("[role='menuitem']")?.focus();
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("click", (event) => {
    if (!menu.hidden && !event.target.closest(".top-account-menu-wrap")) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) closeMenu({ restoreFocus: true });
  });
}

function bindMobileSidebar() {
  const toggle = document.getElementById("sidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");
  if (!toggle || !backdrop) return;

  const setSidebarOpen = (isOpen) => {
    document.body.classList.toggle("sidebar-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    backdrop.hidden = !isOpen;
  };

  toggle.addEventListener("click", () => setSidebarOpen(!document.body.classList.contains("sidebar-open")));
  backdrop.addEventListener("click", () => setSidebarOpen(false));

  document.querySelectorAll(".candidate-nav-link").forEach((link) => {
    link.addEventListener("click", () => setSidebarOpen(false));
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) setSidebarOpen(false);
  });
}

function bindHeaderSearch() {
  if (!messagesSearchForm || !messagesSearchInput) return;

  messagesSearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = messagesSearchInput.value.trim();
    const url = new URL("../public/find-jobs.html?role=candidate", window.location.href);
    if (query) url.searchParams.set("keyword", query);
    window.location.href = url.toString();
  });
}

function updateBadge(id, value) {
  const badge = document.getElementById(id);
  if (!badge) return;

  const count = Number(value) || 0;
  badge.hidden = count <= 0;
  badge.textContent = count > 9 ? "9+" : String(count);
}

function bindCandidateHeaderPhotoFallback(identity) {
  const avatar = document.getElementById("topCandidateAvatar");
  const image = avatar?.querySelector("img");
  if (!image) return;

  image.addEventListener("error", () => {
    console.warn("Candidate messages: candidate photo failed to load", {
      hasStoredPhotoValue: Boolean(identity?.photoUrl)
    });
    image.hidden = true;
  }, { once: true });
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "";
}

function resolveCandidatePhotoUrl(profile) {
  const rawUrl = profile.profile_photo_url || profile.profile_photo || profile.avatar_url || profile.photo_url || "";
  if (!rawUrl) return "";
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  return window.PlacelyAuth.getPublicImageUrl(candidateMessagesSupabase, "candidate_photos", rawUrl);
}

async function handleLogout() {
  try {
    await window.PlacelyAuth.clearAuthState();
  } catch {
    sessionStorage.removeItem("placelyAuthGuardRedirecting");
  }

  window.location.replace("candidate-login.html");
}

function revealMessages() {
  document.documentElement.classList.remove("messages-booting");
}

function formatMessageTime(value) {
  if (!value) return "";

  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatConversationTime(value, fallback) {
  if (!value) return fallback || "";

  const date = new Date(value);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
}

function formatDateSeparator(value) {
  if (!value) return "";

  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric"
  });
}

function sortByLatestActivity(a, b) {
  const aTime = new Date(a?.latestAt || 0).getTime();
  const bTime = new Date(b?.latestAt || 0).getTime();

  return bTime - aTime;
}

function getInitials(name) {
  return String(name || "PT")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHTML(value).replaceAll("`", "&#096;");
}

function escapeSelectorValue(value) {
  const stringValue = String(value || "");
  if (window.CSS?.escape) return window.CSS.escape(stringValue);

  return stringValue.replace(/["\\]/g, "\\$&");
}

async function readFunctionError(error) {
  const response = error?.context;
  if (response && typeof response.json === "function") {
    try {
      const body = await response.json();
      return body?.error || body?.message || error?.message || "";
    } catch {}
  }
  return error?.message || "";
}
