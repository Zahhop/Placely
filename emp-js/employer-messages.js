const employerMessagesSupabase = window.employerSupabase;

if (!employerMessagesSupabase) {
  console.error("Employer Supabase client was not initialized.");
}

const messagesLayout = document.getElementById("messagesLayout");

const conversationList = document.getElementById("conversationList");
const conversationSearch = document.getElementById("conversationSearch");
const inboxCount = document.getElementById("inboxCount");

const chatAvatar = document.getElementById("chatAvatar");
const chatName = document.getElementById("chatName");
const chatSubtitle = document.getElementById("chatSubtitle");
const chatMessages = document.getElementById("chatMessages");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");

const chatActions = document.getElementById("chatActions");
const followUpBtn = document.getElementById("followUpBtn");
const viewProfileBtn = document.getElementById("viewProfileBtn");

const contextPanel = document.getElementById("contextPanel");
const detailName = document.getElementById("detailName");
const detailRole = document.getElementById("detailRole");
const detailStatus = document.getElementById("detailStatus");
const detailSource = document.getElementById("detailSource");
const detailResponse = document.getElementById("detailResponse");
const nextStepTitle = document.getElementById("nextStepTitle");
const nextStepText = document.getElementById("nextStepText");

const logoutBtn = document.getElementById("logoutBtn");

let conversationsData = [];
let activeConversationId = null;
let activeRealtimeChannel = null;
let currentUser = null;
let refreshTimer = null;

document.addEventListener("DOMContentLoaded", initMessages);

async function initMessages() {
  const isLoggedIn = await setupAuth();
  if (!isLoggedIn) return;

  await handlePendingSavedTalentMessage();
  await loadConversations();

  renderConversationList(conversationsData);

  if (activeConversationId) {
    await openConversation(activeConversationId);
  } else {
    showNoConversationState();
  }

  setupEvents();
  startConversationPolling();
}

async function setupAuth() {
  const user = await verifyEmployerAccess(employerMessagesSupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });

  if (!user) {
    return false;
  }

  currentUser = user;
  return true;
}

async function handlePendingSavedTalentMessage() {
  const rawPendingCandidate = localStorage.getItem("placelyMessageCandidate");

  if (!rawPendingCandidate) return;

  let candidate = null;

  try {
    candidate = JSON.parse(rawPendingCandidate);
  } catch (error) {
    console.error("Pending candidate parse error:", error);
    localStorage.removeItem("placelyMessageCandidate");
    return;
  }

  if (!candidate?.id) {
    localStorage.removeItem("placelyMessageCandidate");
    return;
  }

  const { data: existingConversation, error: existingError } =
    await employerMessagesSupabase
      .from("conversations")
      .select("*")
      .eq("employer_id", currentUser.id)
      .eq("candidate_id", candidate.id)
      .maybeSingle();

  if (existingError) {
    console.error("Find existing conversation error:", existingError);
    localStorage.removeItem("placelyMessageCandidate");
    return;
  }

  if (existingConversation) {
    activeConversationId = existingConversation.id;
    localStorage.removeItem("placelyMessageCandidate");
    return;
  }

  const candidateName =
    candidate.name ||
    candidate.full_name ||
    candidate.fullName ||
    "Candidate";

  const candidateRole =
    candidate.trade ||
    candidate.role ||
    candidate.candidate_role ||
    "Trade not listed";

  const candidateLocation =
    candidate.location ||
    candidate.candidate_location ||
    "Location not listed";

  const { data: newConversation, error: createError } =
    await employerMessagesSupabase
      .from("conversations")
      .insert([
        {
          employer_id: currentUser.id,
          candidate_id: candidate.id,
          candidate_name: candidateName,
          candidate_initials: getInitials(candidateName),
          candidate_role: candidateRole,
          candidate_location: candidateLocation,
          source: "Saved Talent",
          status: "Active",
          response: "New"
        }
      ])
      .select()
      .single();

  if (createError) {
    console.error("Create conversation error:", createError);
    localStorage.removeItem("placelyMessageCandidate");
    return;
  }

  activeConversationId = newConversation.id;
  localStorage.removeItem("placelyMessageCandidate");
}

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
    conversationsData = [];
    activeConversationId = null;
    return;
  }

  conversationsData = await Promise.all(
    (data || []).map(async (conversation) => {
      const { data: candidateProfile } = await employerMessagesSupabase
        .from("candidate_profiles")
        .select("profile_photo_url")
        .eq("id", conversation.candidate_id)
        .maybeSingle();

      const latest = await getLatestMessage(conversation.id);

      return {
        id: conversation.id,
        candidateId: conversation.candidate_id,
        name: conversation.candidate_name || "Candidate",
        initials:
          conversation.candidate_initials ||
          getInitials(conversation.candidate_name),
        role: conversation.candidate_role || "Trade not listed",
        location: conversation.candidate_location || "Location not listed",
        photoUrl: candidateProfile?.profile_photo_url || "",
        time: "New",
        source: conversation.source || "Candidate Profile",
        status: conversation.status || "Active",
        response: conversation.response || "New",
        latestMessage: latest?.message || "",
        latestAt: latest?.created_at || conversation.created_at,
        nextStep: "Send a first message",
        nextText: "Start the conversation with this candidate."
      };
    })
  );

  conversationsData.sort(sortByLatestActivity);

  const requestedExists = conversationsData.some(
    (conversation) => conversation.id === requestedConversationId
  );

  const currentActiveExists = conversationsData.some(
    (conversation) => conversation.id === activeConversationId
  );

  if (requestedExists) {
    activeConversationId = requestedConversationId;
  } else if (!currentActiveExists) {
    activeConversationId = conversationsData[0]?.id || null;
  }
}

function setupEvents() {
  if (conversationSearch) {
    conversationSearch.addEventListener("input", () => {
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

      if (filtered.length === 0 && conversationsData.length > 0) {
        showSearchEmptyState();
      }
    });
  }

  if (messageForm) {
    messageForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const text = messageInput.value.trim();
      if (!text) return;

      const conversation = getActiveConversation();

      if (!conversation) {
        showNoConversationState();
        return;
      }

      const optimisticMessage = {
        sender_type: "employer",
        message: text,
        created_at: new Date().toISOString()
      };

      appendMessageBubble(optimisticMessage);
      messageInput.value = "";

      const { data: sentMessage, error } = await employerMessagesSupabase.from("messages").insert([
        {
          conversation_id: activeConversationId,
          sender_type: "employer",
          message: text,
          employer_id: currentUser.id,
          candidate_id: conversation.candidateId,
          candidate_name: conversation.name,
          candidate_role: conversation.role
        }
      ]).select().single();

      if (error) {
        console.error("Message send error:", error);
        alert("Message failed to send. Check the console.");
        await openConversation(activeConversationId);
        return;
      }

      conversation.latestMessage = sentMessage?.message || text;
      conversation.latestAt = sentMessage?.created_at || optimisticMessage.created_at;
      conversationsData.sort(sortByLatestActivity);
      renderConversationList(conversationsData);
      await refreshActiveConversation();
    });
  }

  if (viewProfileBtn) {
    viewProfileBtn.addEventListener("click", () => {
      const conversation = getActiveConversation();

      if (!conversation) {
        window.location.href = "find-candidates.html";
        return;
      }

      window.location.href = `find-candidates.html?candidate=${encodeURIComponent(
        conversation.candidateId
      )}`;
    });
  }

  if (followUpBtn) {
    followUpBtn.addEventListener("click", () => {
      if (!messageInput) return;

      messageInput.focus();

      if (!messageInput.value.trim()) {
        messageInput.value =
          "Hi, thanks for connecting with us. I wanted to follow up and see if you're still interested.";
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await window.PlacelyAuth.clearAuthState();
      window.location.href = "employer-login.html";
    });
  }
}

async function renderConversationList(list) {
  if (!conversationList) return;

  conversationList.innerHTML = "";

  if (inboxCount) {
    inboxCount.textContent = conversationsData.length;
  }

  if (!list || list.length === 0) {
    conversationList.innerHTML = `
      <div class="empty-list-state">
        <div class="empty-list-inner">
          <strong>No conversations yet</strong>
          <p>Message a saved candidate to start building your hiring inbox.</p>
        </div>
      </div>
    `;
    return;
  }

  for (const conversation of list) {
    const row = document.createElement("div");
    row.className = `conversation ${
      conversation.id === activeConversationId ? "active" : ""
    }`;

    row.innerHTML = `
      <div class="avatar">
        ${
          conversation.photoUrl
            ? `<img src="${conversation.photoUrl}" class="message-avatar-img" alt="Candidate photo">`
            : escapeHTML(conversation.initials)
        }
      </div>

      <div class="conversation-info">
        <div class="conversation-top">
          <h3>${escapeHTML(conversation.name)}</h3>
          <span>${escapeHTML(
            formatConversationTime(conversation.latestAt, conversation.time)
          )}</span>
        </div>

        <p>${escapeHTML(conversation.latestMessage || "No messages yet.")}</p>
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

  if (!conversation) {
    showNoConversationState();
    return;
  }

  setConversationMode();

  if (chatAvatar) {
    chatAvatar.innerHTML = conversation.photoUrl
      ? `<img src="${conversation.photoUrl}" class="message-avatar-img" alt="Candidate photo">`
      : escapeHTML(conversation.initials);
  }

  if (chatName) chatName.textContent = conversation.name;
  if (chatSubtitle) {
    chatSubtitle.textContent = `${conversation.role} • ${conversation.location}`;
  }

  if (detailName) detailName.textContent = conversation.name;
  if (detailRole) detailRole.textContent = conversation.role;
  if (detailStatus) detailStatus.textContent = conversation.status;
  if (detailSource) detailSource.textContent = conversation.source;
  if (detailResponse) detailResponse.textContent = conversation.response;
  if (nextStepTitle) nextStepTitle.textContent = conversation.nextStep;
  if (nextStepText) nextStepText.textContent = conversation.nextText;

  const { data, error } = await employerMessagesSupabase
    .from("messages")
    .select("*")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Load messages error:", error);
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

  const { error: updateError } = await employerMessagesSupabase
    .from("messages")
    .update({ read_by_employer: true })
    .eq("candidate_id", conversation.candidateId)
    .eq("employer_id", currentUser.id)
    .select();

  if (updateError) {
    console.error("Mark read error:", updateError);
  }

  chatMessages.innerHTML = "";

  if (!data || data.length === 0) {
    chatMessages.innerHTML = `
      <div class="empty-message">
        <div class="empty-card">
          <div class="empty-icon">✉</div>
          <h3>No messages yet</h3>
          <p>Send the first message to start the conversation with ${escapeHTML(
            conversation.name
          )}.</p>
        </div>
      </div>
    `;
  } else {
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
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;

  subscribeToMessages(id);
}

function appendMessageBubble(message) {
  if (!chatMessages) return;

  const emptyMessage = chatMessages.querySelector(".empty-message");
  if (emptyMessage) chatMessages.innerHTML = "";

  const bubble = document.createElement("div");
  bubble.className = `message ${message.sender_type === "employer" ? "sent" : "received"}`;
  bubble.innerHTML = `
    ${escapeHTML(message.message)}
    <span>${formatMessageTime(message.created_at)}</span>
  `;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function refreshActiveConversation() {
  const currentId = activeConversationId;
  await loadConversations();
  renderConversationList(conversationsData);
  if (currentId) await openConversation(currentId);
}

function showNoConversationState() {
  activeConversationId = null;

  if (activeRealtimeChannel) {
    employerMessagesSupabase.removeChannel(activeRealtimeChannel);
    activeRealtimeChannel = null;
  }

  setEmptyMode();

  if (chatAvatar) {
    chatAvatar.innerHTML = "";
    chatAvatar.textContent = "";
  }

  if (chatName) chatName.textContent = "No conversation selected";
  if (chatSubtitle) {
    chatSubtitle.textContent =
      "Select a candidate conversation or message someone from Saved Talent.";
  }

  if (detailName) detailName.textContent = "No candidate selected";
  if (detailRole) detailRole.textContent = "";
  if (detailStatus) detailStatus.textContent = "—";
  if (detailSource) detailSource.textContent = "—";
  if (detailResponse) detailResponse.textContent = "—";
  if (nextStepTitle) nextStepTitle.textContent = "Start a conversation";
  if (nextStepText) {
    nextStepText.textContent =
      "Message a saved candidate or applicant when you're ready to follow up.";
  }

  if (chatMessages) {
    chatMessages.innerHTML = `
      <div class="empty-message">
        <div class="empty-card">
          <div class="empty-icon">✉</div>
          <h3>No conversations yet</h3>
          <p>Your employer inbox will show candidate conversations once you start messaging saved talent or applicants.</p>

          <div class="empty-actions">
            <a href="saved-talent.html" class="primary-link">Review Saved Talent</a>
            <a href="find-candidates.html" class="secondary-btn">Find Candidates</a>
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
          <p>Try another candidate name, trade, location, or source.</p>
        </div>
      </div>
    `;
  }
}

function setEmptyMode() {
  if (messagesLayout) messagesLayout.classList.add("no-conversation");
  if (chatActions) chatActions.classList.add("disabled-area");
  if (messageForm) messageForm.classList.add("disabled-area");
}

function setConversationMode() {
  if (messagesLayout) messagesLayout.classList.remove("no-conversation");
  if (chatActions) chatActions.classList.remove("disabled-area");
  if (messageForm) messageForm.classList.remove("disabled-area");
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
        await refreshActiveConversation();
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
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
