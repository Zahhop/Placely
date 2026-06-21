const candidateMessagesSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const contextCompany = document.getElementById("contextCompany");
const contextRole = document.getElementById("contextRole");
const conversationList = document.getElementById("conversationList");
const chatCompany = document.getElementById("chatCompany");
const chatRole = document.getElementById("chatRole");
const chatMessages = document.getElementById("chatMessages");

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

  //remove after //
  console.log("Candidate auth user id:", currentUser.id);

  await loadConversations();

  renderConversationList();

  if (activeConversationId) {
    await openConversation(activeConversationId);
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
    return;
  }

  conversationsData = data || [];

  activeConversationId = conversationsData[0]?.id || null;
}

function renderConversationList() {
  conversationList.innerHTML = "";

  conversationsData.forEach((conversation) => {
    const row = document.createElement("div");

    row.className = `conversation ${
      conversation.id === activeConversationId ? "active" : ""
    }`;

    row.innerHTML = `
      <h3>${escapeHTML(conversation.employer_name || "Employer")}</h3>
      <p>${escapeHTML(conversation.candidate_role || "Opportunity")}</p>
    `;

    row.addEventListener("click", async () => {
      activeConversationId = conversation.id;

      renderConversationList();

      await openConversation(conversation.id);
    });

    conversationList.appendChild(row);
  });
}

async function openConversation(id) {
  const conversation = conversationsData.find((c) => c.id === id);

  if (!conversation) return;

  chatCompany.textContent =
    conversation.employer_name || "Employer";

  chatRole.textContent =
    `${conversation.candidate_role || "Opportunity"} opportunity`;

  contextCompany.textContent =
    conversation.employer_name || "Employer";

  contextRole.textContent =
    conversation.candidate_role || "Opportunity";

  const { data, error } = await candidateMessagesSupabase
    .from("messages")
    .select("*")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Message load error:", error);
    return;
  }

   const { data: updatedRows, error: updateError } = await candidateMessagesSupabase
  .from("messages")
  .update({ read_by_candidate: true })
  .eq("candidate_id", currentUser.id)
  .eq("sender_type", "employer")
  .select();

  console.log("Candidate marked read rows:", updatedRows);
  console.log("Candidate mark read error:", updateError);


  chatMessages.innerHTML = "";

  data.forEach((message) => {
    const row = document.createElement("div");

    row.className = `message-row ${
    message.sender_type === "candidate"
    ? "sent"
    : "received"
}`;

    row.innerHTML = `
      <div class="message-bubble">
        ${escapeHTML(message.message)}
      </div>
    `;

    chatMessages.appendChild(row);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;

  subscribeToMessages(id);
}

function setupEvents() {
 form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = input.value.trim();
  if (!text || !activeConversationId) return;

  const conversation = conversationsData.find(
    (c) => c.id === activeConversationId
  );

  const { error } = await candidateMessagesSupabase
    .from("messages")
    .insert([
      {
        conversation_id: activeConversationId,
        sender_type: "candidate",
        message: text,
        employer_id: conversation.employer_id,
        candidate_id: currentUser.id,
        candidate_name: conversation.candidate_name,
        candidate_role: conversation.candidate_role
      }
    ]);

  if (error) {
    console.error("Send message error:", error);
    alert("Message failed to send. Check console.");
    return;
  }

  input.value = "";

  await openConversation(activeConversationId);
});
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
        await openConversation(conversationId);
      }
    )
    .subscribe();
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}