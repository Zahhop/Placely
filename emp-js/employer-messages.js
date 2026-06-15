const employerMessagesSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);


//  Load Conversations  //


async function loadConversations() {
  const params = new URLSearchParams(window.location.search);
  const requestedConversationId = params.get("conversation");

  const { data, error } = await employerMessagesSupabase
    .from("conversations")
    .select("*")
    .eq("employer_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Load conversations error:", error);
    return;
  }

  conversationsData = (data || []).map((conversation) => ({
    id: conversation.id,
    candidateId: conversation.candidate_id,
    name: conversation.candidate_name || "Unnamed Candidate",
    initials: conversation.candidate_initials || getInitials(conversation.candidate_name),
    role: conversation.candidate_role || "No trade added",
    location: conversation.candidate_location || "Location not added",
    time: "New",
    source: conversation.source || "Candidate Profile",
    status: conversation.status || "Active",
    response: conversation.response || "New",
    nextStep: "Send a first message",
    nextText: "Start the conversation with this candidate."
  }));

  activeConversationId =
    requestedConversationId ||
    conversationsData[0]?.id ||
    null;
}

const conversationList = document.getElementById("conversationList");
const conversationSearch = document.getElementById("conversationSearch");
const inboxCount = document.getElementById("inboxCount");

const chatAvatar = document.getElementById("chatAvatar");
const chatName = document.getElementById("chatName");
const chatSubtitle = document.getElementById("chatSubtitle");
const chatMessages = document.getElementById("chatMessages");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");

const detailName = document.getElementById("detailName");
const detailRole = document.getElementById("detailRole");
const detailStatus = document.getElementById("detailStatus");
const detailSource = document.getElementById("detailSource");
const detailResponse = document.getElementById("detailResponse");
const nextStepTitle = document.getElementById("nextStepTitle");
const nextStepText = document.getElementById("nextStepText");

const viewProfileBtn = document.getElementById("viewProfileBtn");
const logoutBtn = document.getElementById("logoutBtn");

let conversationsData = [];
let activeConversationId = null;
let activeRealtimeChannel = null;
let currentUser = null;

document.addEventListener("DOMContentLoaded", initMessages);

async function initMessages() {
  const isLoggedIn = await setupAuth();

  if (!isLoggedIn) return;

  await loadConversations();

renderConversationList(conversationsData);

if (activeConversationId) {
  await openConversation(activeConversationId);
} else {
  chatMessages.innerHTML = "No conversations yet.";
}

setupEvents();
}

async function setupAuth() {
  const {
    data: { user },
    error
  } = await employerMessagesSupabase.auth.getUser();

  if (error || !user) {
    window.location.href = "employer-login.html";
    return false;
  }

  currentUser = user;
  return true;
}

function setupEvents() {
  conversationSearch.addEventListener("input", async () => {
    const query = conversationSearch.value.toLowerCase().trim();

    const filtered = conversationsData.filter((conversation) => {
      return [
        conversation.name,
        conversation.role,
        conversation.location,
        conversation.source
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });

    renderConversationList(filtered);
  });

  messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const text = messageInput.value.trim();
    if (!text) return;

    const conversation = getActiveConversation();
    if (!conversation) return;

    const { error } = await employerMessagesSupabase.from("messages").insert([
      {
  conversation_id: activeConversationId,
  sender_type: "employer",
  message: text,
  employer_id: currentUser.id,
  candidate_id: conversation.candidateId,
  candidate_name: conversation.name,
  candidate_role: conversation.role
}
    ]);

    if (error) {
      console.error("Message send error:", error);
      alert("Message failed to send. Check the console.");
      return;
    }

    messageInput.value = "";

    conversation.time = "Now";
    renderConversationList(conversationsData);
    await openConversation(activeConversationId);
  });

  viewProfileBtn.addEventListener("click", () => {
    window.location.href = "find-candidates.html";
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await employerMessagesSupabase.auth.signOut();
      window.location.href = "employer-login.html";
    });
  }
}

async function renderConversationList(list) {
  conversationList.innerHTML = "";
  inboxCount.textContent = conversationsData.length;

  for (const conversation of list) {
    const latestMessage = await getLatestMessage(conversation.id);

    const row = document.createElement("div");
    row.className = `conversation ${
      conversation.id === activeConversationId ? "active" : ""
    }`;

    row.innerHTML = `
      <div class="avatar">${escapeHTML(conversation.initials)}</div>

      <div class="conversation-info">
        <div class="conversation-top">
          <h3>${escapeHTML(conversation.name)}</h3>
          <span>${escapeHTML(formatConversationTime(latestMessage?.created_at, conversation.time))}</span>
        </div>

        <p>${escapeHTML(latestMessage?.message || "No messages yet.")}</p>
      </div>
    `;

    row.addEventListener("click", async () => {
      activeConversationId = conversation.id;
      renderConversationList(conversationsData);
      await openConversation(activeConversationId);
    });

    conversationList.appendChild(row);
  }
}

async function openConversation(id) {
  const conversation = conversationsData.find((item) => item.id === id);
  if (!conversation) return;

  chatAvatar.textContent = conversation.initials;
  chatName.textContent = conversation.name;
  chatSubtitle.textContent = `${conversation.role} • ${conversation.location}`;

  detailName.textContent = conversation.name;
  detailRole.textContent = conversation.role;
  detailStatus.textContent = conversation.status;
  detailSource.textContent = conversation.source;
  detailResponse.textContent = conversation.response;
  nextStepTitle.textContent = conversation.nextStep;
  nextStepText.textContent = conversation.nextText;

  const { data, error } = await employerMessagesSupabase
    .from("messages")
    .select("*")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Load messages error:", error);
    chatMessages.innerHTML = `<div class="empty-message">Could not load messages.</div>`;
    return;
  }

  chatMessages.innerHTML = "";

  if (!data || data.length === 0) {
    chatMessages.innerHTML = `<div class="empty-message">No messages yet.</div>`;
  }

  data.forEach((message) => {
    const bubble = document.createElement("div");

    bubble.className = `message ${
      message.sender_type === "employer" ? "sent" : "received"
    }`;

    bubble.innerHTML = `
      ${escapeHTML(message.message)}
      <span>${formatMessageTime(message.created_at)}</span>
    `;

    chatMessages.appendChild(bubble);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;

  subscribeToMessages(id);
}

function subscribeToMessages(conversationId) {
  if (activeRealtimeChannel) {
    employerMessagesSupabase.removeChannel(activeRealtimeChannel);
  }

  activeRealtimeChannel = employerMessagesSupabase
    .channel(`messages-${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`
      },
      async () => {
        await openConversation(conversationId);
        renderConversationList(conversationsData);
      }
    )
    .subscribe();
}

async function getLatestMessage(conversationId) {
  const { data, error } = await employerMessagesSupabase
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

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getInitials(name) {
  return String(name || "PT")
    .trim()
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}