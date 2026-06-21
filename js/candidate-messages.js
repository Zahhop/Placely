const candidateMessagesSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const messagesLayout = document.getElementById("messagesLayout");

const conversationList = document.getElementById("conversationList");
const conversationSearch = document.getElementById("conversationSearch");
const conversationCount = document.getElementById("conversationCount");

const chatAvatar = document.getElementById("chatAvatar");
const chatCompany = document.getElementById("chatCompany");
const chatRole = document.getElementById("chatRole");
const chatMessages = document.getElementById("chatMessages");

const chatActions = document.getElementById("chatActions");
const replyHelpBtn = document.getElementById("replyHelpBtn");

const contextCompany = document.getElementById("contextCompany");
const contextRole = document.getElementById("contextRole");
const detailStatus = document.getElementById("detailStatus");
const detailResponse = document.getElementById("detailResponse");
const detailSource = document.getElementById("detailSource");
const nextStepTitle = document.getElementById("nextStepTitle");
const nextStepText = document.getElementById("nextStepText");

const form = document.getElementById("messageForm");
const input = document.getElementById("messageInput");

let currentUser = null;
let conversationsData = [];
let activeConversationId = null;
let activeRealtimeChannel = null;

document.addEventListener("DOMContentLoaded", initMessages);

async function initMessages() {
  const {
    data: { user },
    error
  } = await candidateMessagesSupabase.auth.getUser();

  if (error || !user) {
    window.location.href = "candidate-login.html";
    return;
  }

  currentUser = user;

  await loadConversations();
  renderConversationList(conversationsData);

  if (activeConversationId) {
    await openConversation(activeConversationId);
  } else {
    showNoConversationState();
  }

  setupEvents();
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
        conversation.employer_name ||
        "Employer";

      const companyLogo =
        employerProfile?.company_logo_url ||
        employerProfile?.logo_url ||
        employerProfile?.company_logo ||
        "";

      return {
        id: conversation.id,
        employerId: conversation.employer_id,
        employerName,
        initials: getInitials(employerName),
        logoUrl: companyLogo,
        role:
          conversation.candidate_role ||
          conversation.job_title ||
          "Opportunity",
        source: conversation.source || "Application",
        status: conversation.status || "Active",
        response: conversation.response || "Same day"
      };
    })
  );

  activeConversationId = conversationsData[0]?.id || null;
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
  if (conversationSearch) {
    conversationSearch.addEventListener("input", () => {
      const query = conversationSearch.value.toLowerCase().trim();

      const filtered = conversationsData.filter((conversation) => {
        return [
          conversation.employerName,
          conversation.role,
          conversation.source,
          conversation.status
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      });

      renderConversationList(filtered);

      if (filtered.length === 0 && conversationsData.length > 0) {
        showSearchEmptyState();
      }
    });
  }

  if (replyHelpBtn) {
    replyHelpBtn.addEventListener("click", () => {
      const conversation = getActiveConversation();
      if (!conversation || !input) return;

      input.focus();

      if (!input.value.trim()) {
        input.value =
          "Hi, thanks for reaching out. I’m interested and available to discuss the opportunity. What would be the best next step?";
      }
    });
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const text = input.value.trim();
      if (!text || !activeConversationId) return;

      const conversation = getActiveConversation();

      if (!conversation) {
        showNoConversationState();
        return;
      }

      const { error } = await candidateMessagesSupabase
        .from("messages")
        .insert([
          {
            conversation_id: activeConversationId,
            sender_type: "candidate",
            message: text,
            employer_id: conversation.employerId,
            candidate_id: currentUser.id,
            candidate_name: currentUser.email,
            candidate_role: conversation.role
          }
        ]);

      if (error) {
        console.error("Send message error:", error);
        alert("Message failed to send. Check console.");
        return;
      }

      input.value = "";

      renderConversationList(conversationsData);
      await openConversation(activeConversationId);
    });
  }
}

async function renderConversationList(list) {
  if (!conversationList) return;

  conversationList.innerHTML = "";

  if (conversationCount) {
    conversationCount.textContent = conversationsData.length;
  }

  if (!list || list.length === 0) {
    conversationList.innerHTML = `
      <div class="empty-list-state">
        <div class="empty-list-inner">
          <strong>No conversations yet</strong>
          <p>Employer messages and interview follow-ups will appear here.</p>
        </div>
      </div>
    `;
    return;
  }

  for (const conversation of list) {
    const latestMessage = await getLatestMessage(conversation.id);

    const row = document.createElement("div");
    row.className = `conversation ${
      conversation.id === activeConversationId ? "active" : ""
    }`;

    row.innerHTML = `
      <div class="avatar">
        ${
          conversation.logoUrl
            ? `<img src="${escapeHTML(conversation.logoUrl)}" class="message-avatar-img" alt="Company logo">`
            : escapeHTML(conversation.initials)
        }
      </div>

      <div class="conversation-info">
        <div class="conversation-top">
          <h3>${escapeHTML(conversation.employerName)}</h3>
          <span>${escapeHTML(formatConversationTime(latestMessage?.created_at, "New"))}</span>
        </div>

        <p>${escapeHTML(latestMessage?.message || `${conversation.role} opportunity`)}</p>
      </div>
    `;

    row.addEventListener("click", async () => {
      activeConversationId = conversation.id;
      renderConversationList(conversationsData);
      await openConversation(conversation.id);
    });

    conversationList.appendChild(row);
  }
}

async function openConversation(id) {
  const conversation = conversationsData.find((c) => c.id === id);

  if (!conversation) {
    showNoConversationState();
    return;
  }

  setConversationMode();

  if (chatAvatar) {
    chatAvatar.innerHTML = conversation.logoUrl
      ? `<img src="${escapeHTML(conversation.logoUrl)}" class="message-avatar-img" alt="Company logo">`
      : escapeHTML(conversation.initials);
  }

  if (chatCompany) chatCompany.textContent = conversation.employerName;
  if (chatRole) chatRole.textContent = `${conversation.role} opportunity`;

  if (contextCompany) contextCompany.textContent = conversation.employerName;
  if (contextRole) contextRole.textContent = conversation.role;
  if (detailStatus) detailStatus.textContent = conversation.status;
  if (detailResponse) detailResponse.textContent = conversation.response;
  if (detailSource) detailSource.textContent = conversation.source;

  if (nextStepTitle) nextStepTitle.textContent = "Confirm interview availability";
  if (nextStepText) {
    nextStepText.textContent =
      "Reply with a clear time window and your preferred contact method.";
  }

  const { data, error } = await candidateMessagesSupabase
    .from("messages")
    .select("*")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Message load error:", error);
    chatMessages.innerHTML = `
      <div class="empty-message">
        <div class="empty-card">
          <div class="empty-icon">!</div>
          <h3>Could not load messages</h3>
          <p>Please refresh the page and try again.</p>
        </div>
      </div>
    `;
    return;
  }

  const { error: updateError } = await candidateMessagesSupabase
    .from("messages")
    .update({ read_by_candidate: true })
    .eq("candidate_id", currentUser.id)
    .eq("sender_type", "employer")
    .select();

  if (updateError) {
    console.error("Candidate mark read error:", updateError);
  }

  chatMessages.innerHTML = "";

  if (!data || data.length === 0) {
    chatMessages.innerHTML = `
      <div class="empty-message">
        <div class="empty-card">
          <div class="empty-icon">✉</div>
          <h3>No messages yet</h3>
          <p>When ${escapeHTML(conversation.employerName)} sends a message, it will appear here.</p>
        </div>
      </div>
    `;
  } else {
    data.forEach((message) => {
      const bubble = document.createElement("div");

      bubble.className = `message ${
        message.sender_type === "candidate" ? "sent" : "received"
      }`;

      bubble.innerHTML = `
        ${escapeHTML(message.message)}
        <span>${formatMessageTime(message.created_at)}</span>
      `;

      chatMessages.appendChild(bubble);
    });
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;

  subscribeToMessages(id);
}

function showNoConversationState() {
  activeConversationId = null;

  if (activeRealtimeChannel) {
    candidateMessagesSupabase.removeChannel(activeRealtimeChannel);
    activeRealtimeChannel = null;
  }

  setEmptyMode();

  if (chatAvatar) {
    chatAvatar.innerHTML = "";
    chatAvatar.textContent = "";
  }

  if (chatCompany) chatCompany.textContent = "No conversation selected";
  if (chatRole) chatRole.textContent = "Employer messages will appear here.";

  if (contextCompany) contextCompany.textContent = "No employer selected";
  if (contextRole) contextRole.textContent = "";
  if (detailStatus) detailStatus.textContent = "—";
  if (detailResponse) detailResponse.textContent = "—";
  if (detailSource) detailSource.textContent = "—";

  if (nextStepTitle) nextStepTitle.textContent = "Wait for employer follow-up";
  if (nextStepText) {
    nextStepText.textContent =
      "When an employer messages you about a role, you can respond from this inbox.";
  }

  if (chatMessages) {
    chatMessages.innerHTML = `
      <div class="empty-message">
        <div class="empty-card">
          <div class="empty-icon">✉</div>
          <h3>No conversations yet</h3>
          <p>Your candidate inbox will show employer messages, interview follow-ups, and job opportunity updates.</p>

          <div class="empty-actions">
            <a href="../public/find-jobs.html?role=candidate" class="primary-link">Find Jobs</a>
            <a href="candidate-applications.html" class="secondary-btn">View Applications</a>
          </div>
        </div>
      </div>
    `;
  }
}

function showSearchEmptyState() {
  setEmptyMode();

  if (chatMessages) {
    chatMessages.innerHTML = `
      <div class="empty-message">
        <div class="empty-card">
          <div class="empty-icon">⌕</div>
          <h3>No matching conversations</h3>
          <p>Try another employer name, role, or conversation source.</p>
        </div>
      </div>
    `;
  }
}

function setEmptyMode() {
  if (messagesLayout) messagesLayout.classList.add("no-conversation");
  if (chatActions) chatActions.classList.add("disabled-area");
  if (form) form.classList.add("disabled-area");
}

function setConversationMode() {
  if (messagesLayout) messagesLayout.classList.remove("no-conversation");
  if (chatActions) chatActions.classList.remove("disabled-area");
  if (form) form.classList.remove("disabled-area");
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
      async () => {
        await loadConversations();
        renderConversationList(conversationsData);
        await openConversation(conversationId);
      }
    )
    .subscribe();
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

function getActiveConversation() {
  return conversationsData.find((item) => item.id === activeConversationId);
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