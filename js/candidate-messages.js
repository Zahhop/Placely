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
const replyHelpBtn = document.getElementById("replyHelpBtn");

const form = document.getElementById("messageForm");
const input = document.getElementById("messageInput");
const sendMessageBtn = document.getElementById("sendMessageBtn");
const composerStatus = document.getElementById("composerStatus");

let currentUser = null;
let conversationsData = [];
let activeMessages = [];
let activeConversationId = null;
let activeRealtimeChannel = null;
let refreshTimer = null;
let isSendingMessage = false;

document.addEventListener("DOMContentLoaded", initMessages);

async function initMessages() {
  const user = await verifyCandidateAccess(candidateMessagesSupabase, {
    loginPath: "candidate-login.html",
    employerDashboardPath: "../employers/employer-dashboard.html"
  });

  if (!user) return;
  currentUser = user;
  activeConversationId = new URLSearchParams(window.location.search).get("conversation");

  setupEvents();
  await loadConversations();
  renderConversationList(getFilteredConversations());

  if (activeConversationId) {
    await openConversation(activeConversationId);
  } else {
    showNoConversationState();
  }

  startConversationPolling();
}

async function loadConversations() {
  const { data, error } = await candidateMessagesSupabase
    .from("conversations")
    .select("*")
    .eq("candidate_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Conversation load error:", error);
    conversationsData = [];
    activeConversationId = null;
    return;
  }

  conversationsData = await Promise.all(
    (data || []).map(async (conversation) => {
      const employerProfile = await getEmployerProfile(conversation.employer_id);
      const employerName =
        employerProfile?.company_name ||
        employerProfile?.contact_name ||
        conversation.employer_name ||
        conversation.company_name ||
        "Employer";

      const logoUrl =
        employerProfile?.company_logo_url ||
        employerProfile?.logo_url ||
        employerProfile?.company_logo ||
        employerProfile?.company_logo_preview ||
        conversation.company_logo_url ||
        conversation.logo_url ||
        "";

      const latest = await getLatestMessage(conversation.id);
      const unreadCount = await getUnreadCount(conversation.id);

      return {
        id: conversation.id,
        employerId: conversation.employer_id,
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

  if (!activeConversationId) {
    activeConversationId = conversationsData[0]?.id || null;
  }
}

async function getEmployerProfile(employerId) {
  if (!employerId) return null;

  const { data, error } = await candidateMessagesSupabase
    .from("employer_profiles")
    .select("*")
    .eq("id", employerId)
    .maybeSingle();

  if (error) {
    console.error("Employer profile load error:", error);
    return null;
  }

  return data;
}

function setupEvents() {
  conversationSearch?.addEventListener("input", () => {
    renderConversationList(getFilteredConversations());

    if (getFilteredConversations().length === 0 && conversationsData.length > 0) {
      showSearchEmptyState();
    }
  });

  replyHelpBtn?.addEventListener("click", () => {
    const conversation = getActiveConversation();
    if (!conversation || !input) return;

    input.focus();

    if (!input.value.trim()) {
      input.value =
        "Hi, thanks for reaching out. I'm interested and available to discuss the opportunity. What would be the best next step?";
      updateSendAvailability();
    }
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
}

async function loadMessages(conversationId) {
  const { data, error } = await candidateMessagesSupabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Message load error:", error);
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

async function markConversationRead(conversation) {
  const { error } = await candidateMessagesSupabase
    .from("messages")
    .update({ read_by_candidate: true })
    .eq("conversation_id", conversation.id)
    .eq("candidate_id", currentUser.id)
    .eq("sender_type", "employer");

  if (error) {
    console.error("Mark read error:", error);
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
    console.error("Send message error:", error);
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
        if (!message || activeMessages.some((item) => String(item.id) === String(message.id))) return;

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

function showNoConversationState() {
  activeConversationId = null;
  activeMessages = [];
  setComposerEnabled(false);

  if (activeRealtimeChannel) {
    candidateMessagesSupabase.removeChannel(activeRealtimeChannel);
    activeRealtimeChannel = null;
  }

  if (chatAvatar) chatAvatar.innerHTML = "";
  if (chatEyebrow) chatEyebrow.textContent = "Select a conversation";
  if (chatCompany) chatCompany.textContent = "No conversation selected";
  if (chatRole) chatRole.textContent = "Employer messages will appear here.";

  if (chatMessages) {
    chatMessages.innerHTML = `
      <div class="empty-message">
        <h3>No conversations yet</h3>
        <p>When an employer contacts you or you follow up on an application, your messages will appear here.</p>
        <div class="empty-actions">
          <a href="../public/find-jobs.html?role=candidate" class="primary-link">Find Jobs</a>
          <a href="candidate-applications.html" class="secondary-link">Applications</a>
        </div>
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
  if (messagesLayout) messagesLayout.classList.remove("empty");
  if (chatActions) chatActions.classList.remove("disabled-area");
  setComposerEnabled(true);
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
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Latest message error:", error);
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
    console.error("Unread count error:", error);
    return 0;
  }

  return count || 0;
}

function renderAvatar(url, initials, altText) {
  if (url) {
    return `<img src="${escapeAttribute(url)}" class="message-avatar-img" alt="${escapeAttribute(altText || "Avatar")}">`;
  }

  return `<span>${escapeHTML(initials || "PT")}</span>`;
}

function getActiveConversation() {
  return conversationsData.find((item) => String(item.id) === String(activeConversationId));
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
